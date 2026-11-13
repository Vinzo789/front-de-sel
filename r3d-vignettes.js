/* =====================================================================
   FRONT DE SEL — VIGNETTES DES UNITÉS ET DES BÂTIMENTS (r3d-vignettes.js)
   ---------------------------------------------------------------------
   R3D.Vignettes = { init(), image(genre, type, faction) }
     genre   : 'unite' | 'batiment'
     faction : 'halden' | 'karsk'
   image() renvoie une URL d'image (blob:, ou data: si toBlob manque ; photo du vrai modèle 3D, vu de trois
   quarts sur fond sombre) ou null tant qu'elle n'est pas prête (ou si le
   type est inconnu / en erreur). Les images sont produites une à une en
   tâche de fond, mises en cache (clé genre|type|faction), et un événement
   window 'vignettes' (detail.cles : clés prêtes) est émis, groupé, quand de
   nouvelles images sont prêtes.

   Principe : les modèles ne sont pas recopiés. On recharge r3d-unites.js et
   r3d-batiments.js une seconde fois dans un « bac à sable » : pendant
   l'exécution de ces deux scripts (et seulement pendant), window.R3D désigne
   un objet local dont la scène, la caméra et les effets sont propres aux
   vignettes. Ces copies des modules fabriquent donc les modèles par leur
   chemin normal (sync d'une fausse entité), sans jamais rien ajouter à la
   scène du jeu ni toucher à son état (unités, bâtiments, effets).
   Fonctionne aussi en file:// (pas de fetch).

   Rendu : moteur de rendu du jeu (R3D.renderer), cible hors écran 320 × 240
   réduite à 160 × 120 (anticrénelage), deux lumières, fond dégradé. L'état
   du moteur de rendu (cible, couleur et opacité de fond, ombres, effacement
   automatique, compteurs) est restauré exactement après chaque image.
   Cadence (v24) : toutes les images sont produites hors partie (chargement,
   menu, briefing), une toutes les 100 ms, en temps libre ; leurs shaders sont
   compilés d'un coup avant la première (compilerShaders). En partie non mise
   en pause : rien, sauf les clés passées par autoriser() (onglet que le joueur
   vient d'ouvrir), une image au plus toutes les 3 s. Jamais pendant une
   cinématique, une suspension (suspendre(true)) ni quand l'onglet est masqué.
   ===================================================================== */
(function(){
  'use strict';
  const R3D = window.R3D = window.R3D || {};

  const LARGEUR = 160, HAUTEUR = 120, SURECH = 2;      // image finale ; rendu à 2× puis réduit
  const LR = LARGEUR*SURECH, HR = HAUTEUR*SURECH;
  const INTERVALLE = 100;                              // ms minimum entre deux images
  const FACS = ['halden', 'karsk'];
  // Vue de trois quarts : caméra au sud-est, 30° au-dessus de l'horizon ; les unités regardent
  // un peu à gauche de la caméra (on voit l'avant et le flanc).
  const AZIMUT = 0.78, ELEVATION = 0.5, ANGLE_UNITE = -0.25, FOV = 26, MARGE = 0.9;
  const AZIMUT_BAT = 0.62, ELEVATION_BAT = 0.46, MARGE_BAT = 1.1;   // bâtiments : vue moins symétrique

  const cache = new Map();          // clé -> URL de données, ou null (échec définitif)
  const file = [];                  // clés en attente
  const enFile = new Set();
  const erreurs = [];               // diagnostic (clé, message), sans bruit en console
  let etat = 'rien';                // 'rien' | 'chargement' | 'pret' | 'echec'
  let bac = null;                   // {R, scene, camera, rt, pixels, toile, ctx, petite, pctx}
  let minuteur = null, dernier = 0, idFictif = 1;
  let cleNouvelles = [], dernierEnvoi = 0, minuteurEnvoi = null;

  const cleDe = (genre, type, fac) => genre + '|' + type + '|' + fac;

  // ---------------------------------------------------------------
  // 1. BAC À SABLE : seconde exécution des modules de modèles
  // ---------------------------------------------------------------
  function sourceDe(nom){
    const re = new RegExp('(^|/)' + nom.replace('.', '\\.') + '(\\?|#|$)');
    for(const s of document.getElementsByTagName('script')) if(s.src && re.test(s.src)) return s.src;
    return null;
  }
  // Exécute le script `src` pendant que window.R3D vaut `local` POUR CE SCRIPT SEULEMENT
  // (document.currentScript) ; tout autre code (jeu, autres modules) voit le vrai R3D.
  function executerIsole(src, local){
    return new Promise((ok, ko) => {
      const sc = document.createElement('script');
      const d = Object.getOwnPropertyDescriptor(window, 'R3D');
      if(!d || !d.configurable){ ko(new Error('R3D non configurable')); return; }
      let reel = window.R3D, fini = false;
      Object.defineProperty(window, 'R3D', {configurable:true, enumerable:d.enumerable,
        get(){ return document.currentScript === sc ? local : reel; },
        set(v){ if(document.currentScript !== sc) reel = v; }});
      const finir = (err) => {
        if(fini) return; fini = true;
        Object.defineProperty(window, 'R3D', {configurable:true, enumerable:d.enumerable, writable:true, value:reel});
        if(sc.parentNode) sc.parentNode.removeChild(sc);
        err ? ko(err) : ok();
      };
      sc.onload = () => finir(null);
      sc.onerror = () => finir(new Error('chargement ' + src));
      sc.src = src;
      (document.head || document.body).appendChild(sc);
    });
  }
  function fondDegrade(){
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const d = g.createLinearGradient(0, 0, 0, 64);
    d.addColorStop(0, '#2c3a47'); d.addColorStop(0.62, '#1a222b'); d.addColorStop(1, '#0e1318');
    g.fillStyle = d; g.fillRect(0, 0, 64, 64);
    const r = g.createRadialGradient(32, 26, 2, 32, 30, 40);
    r.addColorStop(0, 'rgba(120,150,170,0.22)'); r.addColorStop(1, 'rgba(120,150,170,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  async function preparer(){
    const srcU = sourceDe('r3d-unites.js'), srcB = sourceDe('r3d-batiments.js');
    if(!srcU || !srcB) throw new Error('modules de modèles introuvables');
    const scene = new THREE.Scene();
    scene.background = fondDegrade();
    const camera = new THREE.PerspectiveCamera(FOV, LARGEUR/HAUTEUR, 1, 4000);
    // Deux lumières : soleil chaud de trois quarts avant, ciel/sol en remplissage.
    const soleil = new THREE.DirectionalLight(0xfff1dc, 2.3);
    soleil.castShadow = false;
    const ciel = new THREE.HemisphereLight(0xc9dcf0, 0x4a4036, 1.25);
    scene.add(soleil); scene.add(soleil.target); scene.add(ciel);
    // R3D local : hérite du vrai (fonctions utilitaires, qualité), mais scène, caméra, sol plat,
    // plein jour, et AUCUN effet (fumée, brûlures) : rien ne remonte vers le jeu.
    const R = Object.create(R3D);
    Object.assign(R, {scene, camera, Effets:null, Aliens:null, ajouterBrulure:null,
      hauteurSol:() => 0, niveauMer:-1e4, ambiance:'midi', assombrir:function(){ return 0; },
      Unites:undefined, Batiments:undefined, Vignettes:undefined});
    await executerIsole(srcU, R);
    await executerIsole(srcB, R);
    if(!R.Unites || !R.Batiments || R.Unites === R3D.Unites || R.Batiments === R3D.Batiments)
      throw new Error('modules isolés absents');
    R.Unites.init();
    R.Batiments.init();
    // Vider tout de suite ce que l'init a pu poser (champs de minerai de la carte courante).
    R.Batiments.sync([], [], 0, 0); R.Unites.sync([], 0, 0);
    const rt = new THREE.WebGLRenderTarget(LR, HR, {minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
      format:THREE.RGBAFormat, depthBuffer:true, stencilBuffer:false});
    rt.texture.encoding = THREE.sRGBEncoding;
    rt.texture.generateMipmaps = false;
    const toile = document.createElement('canvas'); toile.width = LR; toile.height = HR;
    const petite = document.createElement('canvas'); petite.width = LARGEUR; petite.height = HAUTEUR;
    bac = {R, scene, camera, soleil, rt, pixels:new Uint8Array(LR*HR*4), toile, ctx:toile.getContext('2d'),
      img:null, petite, pctx:petite.getContext('2d')};
    bac.img = bac.ctx.createImageData(LR, HR);
    // Fond seul (scène vide), pour mesurer l'emprise réelle des modèles (voir recadrer).
    bac.fond = null;
    try { rendrePixels(); bac.fond = bac.pixels.slice(); } catch(e){ erreurs.push(['fond', String(e && e.message || e)]); }
  }

  // ---------------------------------------------------------------
  // 2. FAUSSES ENTITÉS (mêmes champs que creerUnite / creerBatiment de jeu.js)
  // ---------------------------------------------------------------
  function fausseUnite(type, D, camp){
    return {id:idFictif++, est:'unite', type, def:D, camp, x:0, y:0, rayon:D.rayon || 8,
      pv:D.pv || 100, pvMax:D.pv || 100, angle:ANGLE_UNITE, angleT:ANGLE_UNITE, ordre:null, cible:null,
      chemin:null, dest:null, recharge:0, scan:0, kills:0, rang:0, charge:0, minage:0, dansAura:false,
      auraT:0, enVague:false, mort:false, toucheT:-99, tirT:-99, nom:null, selectionne:false,
      // aéronefs posés (train sorti) ; hélicoptères au sol, rotor visible
      alt:0, vit:0, auSol:true, phase:'sol', base:null, place:-1, munitions:D.munitions || 0,
      repareT:-99, cibleSoin:null};
  }
  function fauxBatiment(type, D, camp){
    const t = D.taille || 1;
    return {id:idFictif++, est:'batiment', type, def:D, camp, c:0, r:0, x:0, y:0, rayon:t*16,
      pvMax:D.pv || 100, pv:D.pv || 100, enCours:false, progres:1, file:[], prodT:0, rally:null, mort:false,
      angleT:Math.PI*0.75, tirT:-99, recharge:0, scan:0, cible:null, rang:0, kills:0,
      dansAura:false, auraT:0, toucheT:-99, nom:null, selectionne:false};
  }

  // ---------------------------------------------------------------
  // 3. CADRAGE : boîte englobante des pièces visibles du modèle
  // ---------------------------------------------------------------
  const _b = new THREE.Box3(), _bt = new THREE.Box3();
  function visibleJusquA(o, racine){
    for(let p = o; p && p !== racine.parent; p = p.parent) if(p.visible === false) return false;
    return true;
  }
  function boiteDe(racine, filtre){
    racine.updateMatrixWorld(true);
    _b.makeEmpty();
    racine.traverse(o => {
      const g = o.geometry;
      if(!g || !filtre(o) || !visibleJusquA(o, racine)) return;
      if(o.material && o.material.visible === false) return;
      if(!g.boundingBox) g.computeBoundingBox();
      if(!g.boundingBox || g.boundingBox.isEmpty()) return;
      _bt.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      _b.union(_bt);
    });
    return _b.isEmpty() ? null : _b.clone();
  }
  const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _h = new THREE.Vector3(),
        _p = new THREE.Vector3(), _v = new THREE.Vector3();
  // marge : part de l'image occupée par le modèle (> 1 : la dalle d'un bâtiment peut déborder
  // un peu aux coins, pour que le volume bâti reste lisible).
  function cadrer(camera, boite, azimut, elevation, marge){
    boite.getCenter(_c);
    _d.set(Math.cos(azimut)*Math.cos(elevation), Math.sin(elevation), Math.sin(azimut)*Math.cos(elevation));
    _r.crossVectors(_v.copy(_d).negate(), THREE.Object3D.DefaultUp).normalize();   // droite écran
    _h.crossVectors(_r, _v).normalize();                                             // haut écran
    const tanV = Math.tan(FOV*Math.PI/360), tanH = tanV*LARGEUR/HAUTEUR;
    const coins = [];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for(let i = 0; i < 8; i++){
      _p.set(i & 1 ? boite.max.x : boite.min.x, i & 2 ? boite.max.y : boite.min.y, i & 4 ? boite.max.z : boite.min.z).sub(_c);
      const x = _p.dot(_r), y = _p.dot(_h), z = _p.dot(_d);
      coins.push([x, y, z]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    // recentrage sur l'emprise projetée (et non sur le centre de la boîte)
    const mx = (x0 + x1)/2, my = (y0 + y1)/2;
    _c.addScaledVector(_r, mx).addScaledVector(_h, my);
    let dist = 1;
    for(const [x, y, z] of coins)
      dist = Math.max(dist, z + Math.abs(x - mx)/(tanH*marge), z + Math.abs(y - my)/(tanV*marge));
    camera.position.copy(_c).addScaledVector(_d, dist);
    camera.near = Math.max(0.5, dist*0.08); camera.far = dist*6 + 200;
    camera.updateProjectionMatrix();
    camera.lookAt(_c);
    camera.updateMatrixWorld(true);
    return {centre:_c.clone(), dist};
  }

  // ---------------------------------------------------------------
  // 4. PRODUCTION D'UNE IMAGE
  // ---------------------------------------------------------------
  // Rendu de la scène des vignettes dans B.pixels (lignes de bas en haut), état du moteur restauré.
  function rendrePixels(){
    const r = R3D.renderer, B = bac, t0 = performance.now();
    try { rendrePixels0(r, B); } finally { phases.rendu += performance.now() - t0; phases.passes++; }
  }
  const phases = {rendu:0, passes:0, png:0, emprise:0};
  function rendrePixels0(r, B){
    // --- état à restaurer
    const sauve = {
      cible:r.getRenderTarget(), coul:r.getClearColor(new THREE.Color()), alpha:r.getClearAlpha(),
      autoClear:r.autoClear, ombreAuto:r.shadowMap.autoUpdate, ombreMaj:r.shadowMap.needsUpdate,
      ombreOn:r.shadowMap.enabled,
      appels:r.info.render.calls, triangles:r.info.render.triangles, points:r.info.render.points,
      lignes:r.info.render.lines, image:r.info.render.frame,
    };
    try {
      r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false;   // pas de passe d'ombre
      r.autoClear = true;
      r.setClearColor(0x0e1318, 1);
      r.setRenderTarget(B.rt);
      r.clear(true, true, true);
      r.render(B.scene, B.camera);
      r.readRenderTargetPixels(B.rt, 0, 0, LR, HR, B.pixels);
    } finally {
      r.setRenderTarget(sauve.cible);
      r.setClearColor(sauve.coul, sauve.alpha);
      r.autoClear = sauve.autoClear;
      r.shadowMap.enabled = sauve.ombreOn;
      r.shadowMap.autoUpdate = sauve.ombreAuto;
      r.shadowMap.needsUpdate = sauve.ombreMaj;
      const I = r.info.render;
      I.calls = sauve.appels; I.triangles = sauve.triangles; I.points = sauve.points; I.lines = sauve.lignes; I.frame = sauve.image;
    }
  }
  // Emprise réelle du modèle à l'image : pixels qui diffèrent du fond seul (bac.fond, rendu une fois
  // sans modèle). Renvoie {x0, x1, y0, y1} en pixels du rendu (y vers le haut), ou null.
  function emprise(){
    const p = bac.pixels, f = bac.fond;
    if(!f) return null;
    let x0 = LR, x1 = -1, y0 = HR, y1 = -1;
    for(let y = 0; y < HR; y++){
      const l = y*LR*4;
      for(let x = 0; x < LR; x++){
        const i = l + x*4;
        if(Math.abs(p[i] - f[i]) + Math.abs(p[i+1] - f[i+1]) + Math.abs(p[i+2] - f[i+2]) > 30){
          if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : {x0, x1, y0, y1};
  }
  // Recadrage d'après l'emprise réelle (13 novembre 2026) : la boîte des pièces surestimait certains
  // modèles (hélicoptères, infanterie : un tiers de l'image). On recentre la caméra sur l'emprise et on
  // règle la distance pour que le plus grand côté occupe OCCUPATION de l'image ; deux passes.
  const OCCUPATION = 0.8;
  // Renvoie vrai quand B.pixels montre déjà le cadrage final (caméra inchangée depuis la dernière passe).
  function recadrer(camera, centre, dist){
    const tanV = Math.tan(FOV*Math.PI/360), tanH = tanV*LARGEUR/HAUTEUR;
    // repère écran de la caméra (cadrer l'a orientée vers centre)
    const droite = new THREE.Vector3(), haut = new THREE.Vector3(), dir = new THREE.Vector3();
    for(let passe = 0; passe < 2; passe++){
      rendrePixels();
      const e = emprise();
      if(!e) return true;
      const fx = (e.x1 - e.x0 + 1)/LR, fy = (e.y1 - e.y0 + 1)/HR;
      const occ = Math.max(fx, fy);
      const cx = ((e.x0 + e.x1 + 1)/2/LR - 0.5)*2, cy = ((e.y0 + e.y1 + 1)/2/HR - 0.5)*2;
      if(Math.abs(occ - OCCUPATION) < 0.04 && Math.abs(cx) < 0.04 && Math.abs(cy) < 0.04) return true;
      camera.matrixWorld.extractBasis(droite, haut, dir);   // dir : de la cible vers la caméra
      centre.addScaledVector(droite, cx*tanH*dist).addScaledVector(haut, cy*tanV*dist);
      dist *= Math.min(3, Math.max(0.25, occ/OCCUPATION));
      camera.position.copy(centre).addScaledVector(dir, dist);
      camera.near = Math.max(0.5, dist*0.08); camera.far = dist*6 + 200;
      camera.updateProjectionMatrix();
      camera.lookAt(centre);
      camera.updateMatrixWorld(true);
    }
    return false;
  }
  // dejaRendu : B.pixels correspond déjà à la caméra actuelle (dernière passe de recadrer),
  // on évite une passe de rendu et une lecture de pixels de plus.
  // Renvoie une promesse d'URL : l'encodage PNG se fait hors du fil principal (toBlob),
  // l'URL est alors une URL d'objet (blob:), utilisable comme une URL de données dans <img>.
  function rendre(dejaRendu){
    const B = bac;
    if(!dejaRendu) rendrePixels();
    // --- pixels (bas en haut) -> toile 2D, puis réduction à 160 × 120
    const src = B.pixels, dst = B.img.data, ligne = LR*4;
    for(let y = 0; y < HR; y++){
      const a = (HR - 1 - y)*ligne, b = y*ligne;
      for(let i = 0; i < ligne; i += 4){
        dst[b+i] = src[a+i]; dst[b+i+1] = src[a+i+1]; dst[b+i+2] = src[a+i+2]; dst[b+i+3] = 255;
      }
    }
    B.ctx.putImageData(B.img, 0, 0);
    B.pctx.imageSmoothingEnabled = true;
    if('imageSmoothingQuality' in B.pctx) B.pctx.imageSmoothingQuality = 'high';
    B.pctx.clearRect(0, 0, LARGEUR, HAUTEUR);
    B.pctx.drawImage(B.toile, 0, 0, LR, HR, 0, 0, LARGEUR, HAUTEUR);
    const t0 = performance.now();
    if(typeof B.petite.toBlob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL){
      // toBlob copie l'image au moment de l'appel : la toile peut être réutilisée aussitôt.
      const p = new Promise(ok => B.petite.toBlob(b => ok(b ? URL.createObjectURL(b) : null), 'image/png'));
      phases.png += performance.now() - t0;
      return p;
    }
    const url = B.petite.toDataURL('image/png');
    phases.png += performance.now() - t0;
    return Promise.resolve(url);
  }
  function produire(genre, type, fac){
    if(typeof camps === 'undefined' || !camps) return null;
    const R = bac.R, idCamp = '§vignette-' + fac;
    const avant = Object.prototype.hasOwnProperty.call(camps, idCamp) ? camps[idCamp] : undefined;
    camps[idCamp] = {id:idCamp, faction:fac, nom:'', ia:false};   // le temps de cet appel synchrone seulement
    try {
      let racine = null, boite = null;
      if(genre === 'unite'){
        const D = typeof UNITES !== 'undefined' ? UNITES[type] : null;
        if(!D || D.rendu === 'aliens') return null;
        R.Unites.sync([fausseUnite(type, D, idCamp)], 0, 0);
        racine = R.Unites.racines()[0];
        // pièces = ancres (Object3D portant .geometry) ; le volume de pointage (Mesh) est exclu
        if(racine) boite = boiteDe(racine, o => !o.isMesh && !o.isInstancedMesh);
      } else if(genre === 'batiment'){
        const D = typeof BATIMENTS !== 'undefined' ? BATIMENTS[type] : null;
        if(!D) return null;
        R.Batiments.sync([fauxBatiment(type, D, idCamp)], [], 0, 0);
        const proxy = R.Batiments.racines()[0];
        racine = proxy && proxy.parent;
        if(racine) boite = boiteDe(racine.children[0] || racine, o => o.isMesh && o.userData && o.userData.canal !== 'nuit' && o.userData.canal !== 'nuitF');
      } else return null;
      if(!racine || !boite) return null;
      const cad = genre === 'unite' ? cadrer(bac.camera, boite, AZIMUT, ELEVATION, MARGE)
                                    : cadrer(bac.camera, boite, AZIMUT_BAT, ELEVATION_BAT, MARGE_BAT);
      // soleil : de trois quarts avant gauche, au-dessus
      const c = boite.getCenter(new THREE.Vector3()), t = boite.getSize(new THREE.Vector3()).length();
      bac.soleil.position.set(c.x + t*0.2, c.y + t*1.2, c.z + t*0.9);
      bac.soleil.target.position.copy(c); bac.soleil.target.updateMatrixWorld();
      // Unités : recadrage sur l'emprise réelle à l'image (les bâtiments gardent leur cadrage, dalle
      // volontairement un peu débordante).
      const dejaRendu = genre === 'unite' ? recadrer(bac.camera, cad.centre, cad.dist) : false;
      return rendre(dejaRendu);
    } finally {
      try { R.Unites.sync([], 0, 0); R.Batiments.sync([], [], 0, 0); } catch(e){ /* rien */ }
      if(avant === undefined) delete camps[idCamp]; else camps[idCamp] = avant;
    }
  }

  // Préchauffage des shaders des vignettes (v24) : une seule fois, dès que le bac à sable est prêt
  // (chargement ou menu, jamais en pleine partie non mise en pause), tous les modèles des deux
  // factions sont posés ensemble dans la scène des vignettes et compilés d'un coup
  // (renderer.compile, même cible et mêmes lumières que les images) : aucune image produite ensuite
  // ne compile de programme. Mesure : shaders.ms, shaders.programmes (etat()).
  let shadersCompiles = false;
  const shaders = {ms:0, programmes:0, modeles:0};
  function compilerShaders(){
    shadersCompiles = true;
    if(typeof camps === 'undefined' || !camps) return;
    const r = R3D.renderer, R = bac.R, t0 = performance.now();
    const p0 = r.info.programs ? r.info.programs.length : 0;
    const ajoutes = [];
    for(const fac of FACS){
      const id = '§vignette-' + fac;
      if(!Object.prototype.hasOwnProperty.call(camps, id)){ camps[id] = {id, faction:fac, nom:'', ia:false}; ajoutes.push(id); }
    }
    const sauveCible = r.getRenderTarget();
    try {
      const unites = [], bats = [];
      for(const cle of file){
        const [genre, type, fac] = cle.split('|'), idCamp = '§vignette-' + fac;
        if(genre === 'unite' && typeof UNITES !== 'undefined' && UNITES[type] && UNITES[type].rendu !== 'aliens')
          unites.push(fausseUnite(type, UNITES[type], idCamp));
        else if(genre === 'batiment' && typeof BATIMENTS !== 'undefined' && BATIMENTS[type])
          bats.push(fauxBatiment(type, BATIMENTS[type], idCamp));
      }
      shaders.modeles = unites.length + bats.length;
      R.Unites.sync(unites, 0, 0);
      R.Batiments.sync(bats, [], 0, 0);
      r.setRenderTarget(bac.rt);
      r.compile(bac.scene, bac.camera);
    } catch(e){ erreurs.push(['shaders', String(e && e.message || e)]); }
    finally {
      try { R.Unites.sync([], 0, 0); R.Batiments.sync([], [], 0, 0); } catch(e){ /* rien */ }
      r.setRenderTarget(sauveCible);
      for(const id of ajoutes) delete camps[id];
    }
    shaders.ms = Math.round(performance.now() - t0);
    shaders.programmes = (r.info.programs ? r.info.programs.length : 0) - p0;
  }

  // ---------------------------------------------------------------
  // 5. FILE D'ATTENTE ET CADENCE
  // ---------------------------------------------------------------
  function enCinematique(){
    try { return typeof surprise !== 'undefined' && !!surprise && surprise.etat === 'cinematique'; }
    catch(e){ return false; }
  }
  function planifier(delai){
    if(minuteur || etat !== 'pret' || !file.length) return;
    minuteur = setTimeout(() => {
      if(!accelere && typeof requestIdleCallback === 'function') requestIdleCallback(pompe, {timeout:700});
      else pompe();
    }, Math.max(0, delai));
  }
  // Règle de production (v24, 13/11/2026) : une vignette bloque le fil principal 40 à 344 ms.
  // - Hors partie (chargement, menu, briefing) et partie en pause : production continue, une image
  //   toutes les INTERVALLE ms (aucune attente pendant l'écran de lancement : accelerer(true)).
  // - En partie non mise en pause : AUCUNE production, sauf pour les clés autorisées par le jeu
  //   (autoriser : images manquantes de l'onglet de la barre de construction que le joueur vient
  //   d'ouvrir), et alors une image au plus toutes les INTERVALLE_PARTIE ms.
  // Jamais pendant une suspension demandée par le jeu (R3D.Vignettes.suspendre) ; en partie,
  // seulement si l'image précédente du jeu a été rapide (R3D.perf().ms, s'il existe), avec un
  // garde-fou : sur une machine durablement lente, on produit quand même après ATTENTE_MAX ms.
  const INTERVALLE_PARTIE = 3000, SEUIL_RAPIDE = 28, ATTENTE_MAX = 4000;
  let suspendu = false, attenteDepuis = 0, accelere = false;
  let permises = new Set();         // clés autorisées en pleine partie (onglet ouvert par le joueur)
  const mesure = {n:0, ms:0, msMax:0, refusLent:0, liste:[], enPartie:0, enPause:0, horsPartie:0};
  function enPartie(){
    try { return typeof enJeu !== 'undefined' && !!enJeu && !(typeof partieFinie !== 'undefined' && partieFinie); }
    catch(e){ return false; }
  }
  // 'libre' (hors partie), 'pause' (partie en pause) ou 'partie' (partie en cours).
  function regime(){
    if(!enPartie()) return 'libre';
    try { if(typeof enPause !== 'undefined' && enPause) return 'pause'; } catch(e){ /* rien */ }
    return 'partie';
  }
  function imageRapide(){
    try {
      if(typeof R3D.perf !== 'function') return true;
      const p = R3D.perf();
      return !p || !isFinite(p.ms) || p.ms <= SEUIL_RAPIDE;
    } catch(e){ return true; }
  }
  let enCours = false;              // une image en cours d'encodage : aucune autre ne démarre
  function pompe(){
    if(enCours) return;             // un rappel en double (minuteur + temps libre) : finir() replanifie
    minuteur = null;
    if(etat !== 'pret' || !file.length) return;
    if(suspendu || enCinematique() || document.hidden){ planifier(500); return; }
    const reg = regime();
    if(!shadersCompiles && reg !== 'partie'){ compilerShaders(); planifier(accelere ? 0 : INTERVALLE); return; }
    // En partie : seulement une clé autorisée ; sinon on revérifie une fois par seconde (pause, onglet).
    let indice = 0;
    if(reg === 'partie'){
      indice = file.findIndex(c => permises.has(c));
      if(indice < 0){ planifier(1000); return; }
    }
    const maintenant = performance.now();
    const ecart = maintenant - dernier, mini = reg === 'partie' ? INTERVALLE_PARTIE : accelere ? 0 : INTERVALLE;
    if(ecart < mini){ planifier(Math.min(1000, mini - ecart)); return; }
    if(reg === 'partie' && !imageRapide()){
      if(!attenteDepuis) attenteDepuis = maintenant;
      if(maintenant - attenteDepuis < ATTENTE_MAX){ mesure.refusLent++; planifier(120); return; }
    }
    attenteDepuis = 0;
    const cle = file.splice(indice, 1)[0];   // reste dans enFile jusqu'à la fin de l'encodage (pas de doublon)
    permises.delete(cle);
    mesure[reg === 'partie' ? 'enPartie' : reg === 'pause' ? 'enPause' : 'horsPartie']++;
    const [genre, type, fac] = cle.split('|');
    let res = null;
    const t0 = performance.now();
    enCours = true; dernier = t0;
    try { res = produire(genre, type, fac); }
    catch(e){ res = null; erreurs.push([cle, String(e && e.message || e)]); }
    const duree = performance.now() - t0;
    mesure.n++; mesure.ms += duree; if(mesure.liste.length < 80) mesure.liste.push(Math.round(duree)); if(duree > mesure.msMax) mesure.msMax = duree;
    const finir = url => {
      enCours = false;
      enFile.delete(cle);
      cache.set(cle, url || null);
      dernier = performance.now();
      if(url) annoncer(cle);
      planifier(reg === 'partie' ? Math.min(1000, INTERVALLE_PARTIE) : accelere ? 0 : INTERVALLE);
    };
    // Encodage PNG asynchrone : la vignette suivante attend la fin de celui-ci (minuteur nul entre-temps).
    if(res && typeof res.then === 'function'){
      minuteur = -1;
      res.then(u => { minuteur = null; finir(u); },
               e => { minuteur = null; erreurs.push([cle, String(e && e.message || e)]); finir(null); });
    } else finir(res);
  }
  // Événement groupé : au plus un toutes les 400 ms, et un dernier quand la file se vide.
  function annoncer(cle){
    cleNouvelles.push(cle);
    const envoyer = () => {
      minuteurEnvoi = null;
      if(!cleNouvelles.length) return;
      const cles = cleNouvelles; cleNouvelles = []; dernierEnvoi = performance.now();
      try { window.dispatchEvent(new CustomEvent('vignettes', {detail:{cles}})); } catch(e){ /* rien */ }
    };
    if(!file.length || performance.now() - dernierEnvoi > 400){ if(minuteurEnvoi){ clearTimeout(minuteurEnvoi); } envoyer(); }
    else if(!minuteurEnvoi) minuteurEnvoi = setTimeout(envoyer, 400);
  }
  function demander(cle, devant){
    if(cache.has(cle)) return;
    if(enFile.has(cle)){
      if(devant){ const i = file.indexOf(cle); if(i > 0){ file.splice(i, 1); file.unshift(cle); } }
      return;
    }
    enFile.add(cle);
    devant ? file.unshift(cle) : file.push(cle);
    planifier(0);
  }
  // Préchauffage : tout ce que les menus peuvent montrer (unités produites par chaque camp,
  // tous les bâtiments pour les deux camps), à la suite des demandes explicites.
  function prechauffer(){
    try {
      for(const fac of FACS){
        const F = typeof FACTIONS !== 'undefined' && FACTIONS[fac];
        const types = new Set();
        if(F){
          if(F.ouvrier) types.add(F.ouvrier);
          for(const k in (F.production || {})) for(const t of F.production[k]) types.add(t);
        }
        for(const t of types) if(typeof UNITES !== 'undefined' && UNITES[t]) demander(cleDe('unite', t, fac), false);
      }
      if(typeof BATIMENTS !== 'undefined')
        for(const fac of FACS) for(const t in BATIMENTS) demander(cleDe('batiment', t, fac), false);
    } catch(e){ /* rien */ }
  }

  // ---------------------------------------------------------------
  // 6. INTERFACE
  // ---------------------------------------------------------------
  R3D.Vignettes = {
    LARGEUR, HAUTEUR,
    init(){
      if(etat !== 'rien') return;
      if(typeof THREE === 'undefined' || !R3D.renderer){ return; }   // réessayé au prochain image()
      etat = 'chargement';
      // Shaders des vignettes compilés tout de suite, pendant le chargement, avec ceux du jeu.
      preparer().then(() => { etat = 'pret'; prechauffer(); if(regime() !== 'partie') compilerShaders(); planifier(0); })
        .catch(e => { etat = 'echec'; bac = null; erreurs.push(['init', String(e && e.message || e)]); });
    },
    image(genre, type, faction){
      if(genre !== 'unite' && genre !== 'batiment') return null;
      const fac = faction === 'karsk' ? 'karsk' : 'halden';
      const cle = cleDe(genre, type, fac);
      if(cache.has(cle)) return cache.get(cle);
      if(etat === 'rien') this.init();
      if(etat === 'echec') return null;
      demander(cle, true);
      return null;
    },
    // Contrat commun : le jeu suspend la production pendant les moments chargés
    // (préchauffage, cinématique…) ; suspendre(false) la relance.
    suspendre(b){
      suspendu = !!b;
      if(!suspendu){ attenteDepuis = 0; planifier(0); }
    },
    estSuspendu(){ return suspendu; },
    // En pleine partie, seules ces clés (genre|type|faction) peuvent être produites, une image au plus
    // toutes les 3 s : le jeu passe les images manquantes de l'onglet que le joueur vient d'ouvrir.
    // Chaque appel remplace la liste précédente.
    autoriser(cles){
      permises = new Set((cles || []).filter(c => !cache.has(c)));
      for(const c of permises) demander(c, false);
      planifier(0);
    },
    // Écran de lancement : production sans attente entre deux images (accelerer(true)), le temps de finir.
    accelerer(b){ accelere = !!b; if(accelere){ if(minuteur && minuteur !== -1){ clearTimeout(minuteur); minuteur = null; } planifier(0); } },
    // Vrai quand plus rien n'est à produire (ou quand le module ne peut pas produire).
    termine(){ return etat === 'echec' || (etat === 'pret' && !file.length && !enFile.size); },
    // Diagnostic (tests) : {etat, pretes, enFile, erreurs, suspendu, produites, msMoyen, msMax, refusLent}
    etat(){ let n = 0; for(const v of cache.values()) if(v) n++;
      return {etat, pretes:n, enFile:file.length, erreurs:erreurs.slice(), suspendu, accelere, permises:permises.size,
        shaders:Object.assign({compiles:shadersCompiles}, shaders),
        parRegime:{horsPartie:mesure.horsPartie, enPause:mesure.enPause, enPartie:mesure.enPartie},
        phases:{renduMs:+phases.rendu.toFixed(1), passes:phases.passes, pngMs:+phases.png.toFixed(1)},
        produites:mesure.n, msMoyen:mesure.n ? +(mesure.ms/mesure.n).toFixed(2) : 0, msMax:+mesure.msMax.toFixed(2), refusLent:mesure.refusLent, durees:mesure.liste.slice()}; },
  };
})();
