'use strict';
/* =====================================================================
   FRONT DE SEL — rendu 3D des effets visuels.
   Tirs (traçantes, flammes de bouche), explosions (éclair, boule de feu,
   étincelles, braises, débris, onde de choc, colonne de fumée, gerbe d'eau),
   fumée, feu, poussière, projectiles du moteur (roquettes, missiles air-air,
   bombes guidées, tirs de plasma), missile de frappe, marqueurs de pouvoirs,
   retours d'ordre.

   Principes :
   - Les visuels vivent leur propre vie : à l'apparition d'un objet effet
     du jeu (repéré par un WeakSet), on émet des particules et des débris
     qui ont leur propre durée (fumée persistante, débris qui retombent).
   - Aucune allocation par image : réserves fixes (particules en anneau,
     débris, traçantes, projectiles, décalques au sol, lumières).
   - dt = 0 (pause) : tout se fige, rien n'est émis.
   - Seul r3d-scene.js règle les lumières générales et le brouillard ; ici
     on se contente de quatre PointLight recyclées pour les flashs.
   - Sobriété lumineuse : ce qui est additif est soit très bref (éclair
     d'explosion, flamme de bouche), soit petit (étincelles, braises), soit
     peu opaque (halos). Le feu qui dure est peint en mélange normal, avec
     une intensité supérieure à 1 à sa naissance : le post-traitement
     (r3d-post.js) en tire son halo sans que l'image sature.
   - La fumée et la poussière sont éclairées par le soleil de la scène
     (R3D.dirSoleil, couleur et intensité des lumières) : elles suivent
     donc l'ambiance de la carte et l'assombrissement du ciel.
   - Robustesse : un effet ou un projectile de type inconnu est ignoré sans
     erreur (les effets 'rayon', 'chargeSol' et 'bouclier' sont rendus par
     r3d-aliens.js) ; un effet mal formé ne peut pas interrompre l'image.

   Projectiles du moteur (liste « projectiles » de jeu.js) :
     {sx, sy, tx, ty, t, duree, auteur, camp, ...} et, facultatifs,
     genre ('missileAir' | 'bombe' | 'plasma' ; absent = roquette d'artillerie),
     h1 / h2 (hauteurs de départ / d'arrivée au-dessus du sol), cible (entité).
     Sans h1, la hauteur de départ est l'altitude du tireur (auteur.alt).

   Repère : jeu (x, y) -> three (X = x, Y = hauteur, Z = y).
   ===================================================================== */
(function(){
  const R3D = window.R3D = window.R3D || {};

  // =====================================================================
  //  RÉGLAGES
  // =====================================================================
  const MAX_ADDITIF = 2000;    // particules lumineuses (feu, étincelles, flashs, plasma)
  const MAX_NORMAL = 3200;     // particules opaques (fumée, poussière, eau, boule de feu)
  const MAX_ORBES = 128;       // lueurs tenues par les projectiles (plasma, tuyères)
  const MAX_TRAITS = 192;      // traçantes simultanées
  const MAX_DEBRIS = 240;      // débris physiques
  const MAX_ROQUETTES = 64;
  const MAX_MISSILES_AIR = 48;
  const MAX_BOMBES = 24;
  const MAX_MISSILES = 4;      // missiles de frappe de précision
  const MAX_ONDES = 14;        // ondes de choc au sol
  const MAX_ORDRES = 8;        // retours d'ordre
  const MAX_MARQUEURS = 4;     // zones de pouvoir
  const MAX_EMETTEURS = 96;    // émetteurs internes (colonnes de fumée, fumigènes)
  const MAX_DIFFERES = 16;     // explosions secondaires programmées (chapelet des très grosses explosions)
  // Deux lumières (quatre jusqu'en novembre 2026) : chaque PointLight, même éteinte, est calculée pour
  // chaque pixel de chaque matière éclairée (sol compris). Mesuré sur carte graphique intégrée, en
  // alternance dans la même page : environ 2 ms de GPU par image de moins en passant de 4 à 2.
  const NB_LUMIERES = 2;
  const BUDGET_EXTERNE = 90;   // particules / image accordées aux émetteurs appelés par les autres modules
  const VENT = [10, 0, -5];    // dérive commune de la fumée (unités / s) : donne une cohérence à la scène
  const GRAVITE = -330;
  const HAUT_VOL = 55;         // altitude d'une entité aérienne sans champ « alt » (HAUTEUR_VOL du moteur)
  const R_MAX = 90;            // rayon visuel maximal d'une explosion ; au-delà : chapelet d'explosions secondaires

  // Qualité graphique (R3D.qualite, réglée par r3d-scene.js) : densité des particules, volume de la fumée,
  // espacement des traînées, durée de la fumée.
  const QUALITES = {
    basse:   {dens:0.55, volume:false, pas:1.7, vie:0.8},
    moyenne: {dens:1.0,  volume:true,  pas:1.0, vie:1.0},
    haute:   {dens:1.3,  volume:true,  pas:0.8, vie:1.1},
  };
  let Q = QUALITES.moyenne, qualiteActive = 'moyenne';

  let pret = false;
  let groupe = null;
  let temoinVolume = null;     // matériau témoin de l'autre variante de fumée (voir prechauffer)
  const aRemasquer = [];       // objets rendus visibles par prechauffer, à remasquer au prochain sync
  let horloge = 0;             // horloge propre des effets (figée en pause)
  let cycle = 0;               // numéro de l'image en cours
  let budgetExterne = 0;
  let solCourant = 0;          // hauteur du sol sous le lot de particules en cours d'émission
  let effetsCourants = null;   // liste des effets du moteur pour l'image en cours

  const dejaVus = new WeakSet();   // objets effets du jeu déjà mis en scène
  const AUCUN = [];

  // =====================================================================
  //  OUTILS
  // =====================================================================
  const alea = (a, b) => a + Math.random()*(b - a);
  const nombre = v => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
  const lin = hex => { const c = new THREE.Color(hex).convertSRGBToLinear(); return [c.r, c.g, c.b]; };
  // Nombre de particules d'un lot, selon la qualité (arrondi tiré au sort : la moyenne reste exacte).
  function nb(n){ const v = n*Q.dens, e = Math.floor(v); return e + (Math.random() < v - e ? 1 : 0); }
  // Couleur '#rrggbb' -> triplet linéaire, avec mémoire (les tirs répètent toujours les mêmes teintes).
  const memoCouleurs = new Map();
  function couleurLin(hex){
    let c = memoCouleurs.get(hex);
    if(!c){
      if(memoCouleurs.size > 64) memoCouleurs.clear();
      c = lin(hex === undefined || hex === null ? '#ffffff' : hex);
      if(!nombre(c[0]) || !nombre(c[1]) || !nombre(c[2])) c = [1, 1, 1];
      memoCouleurs.set(hex, c);
    }
    return c;
  }
  // Hauteur de référence de TOUS les effets : le terrain, ou la surface de l'eau quand le terrain
  // est immergé. C'est la même référence que les modèles (aérien : max(hauteurSol, niveauMer) + altitude),
  // si bien qu'explosions, traçantes, éclairs, projectiles et décalques coïncident au-dessus de la mer
  // comme sur terre (et que la fumée, l'eau ou les étincelles s'arrêtent à la surface, pas au fond).
  function sol(x, y){
    const h = R3D.hauteurSol ? (R3D.hauteurSol(x, y) || 0) : 0;
    const mer = R3D.niveauMer !== undefined && R3D.niveauMer !== null ? R3D.niveauMer : 0;
    return h > mer ? h : mer;
  }
  function estMer(x, y){
    if(typeof grille === 'undefined') return false;
    const c = Math.floor(x / TUILE), r = Math.floor(y / TUILE);
    if(c < 0 || r < 0 || c >= COLS || r >= LIGNES) return y > (typeof cote === 'function' ? cote(x) : 1e9);
    return grille[r*COLS + c] === 1;
  }
  // Direction aléatoire sur la sphère (résultat dans DX, DY, DZ, sans allocation).
  let DX = 0, DY = 0, DZ = 0;
  function dirAlea(){
    const u = Math.random()*2 - 1, a = Math.random()*6.283185, s = Math.sqrt(1 - u*u);
    DX = s*Math.cos(a); DY = u; DZ = s*Math.sin(a);
  }
  // Couleur de camp (#rrggbb) -> 'bleu' ou 'rouge' pour choisir les gabarits teintés.
  function teinte(hex){
    const c = new THREE.Color(hex || '#ffffff');
    return c.b > c.r ? 'bleu' : 'rouge';
  }
  // Un effet mal formé ne doit jamais interrompre la boucle d'affichage : on le signale une fois.
  let nAvertis = 0;
  function avertir(err, quoi){ if(nAvertis++ < 5 && typeof console !== 'undefined') console.warn('[Effets] ' + quoi + ' ignoré :', err); }

  // Fusion de géométries non indexées avec couleur de sommet (BufferGeometryUtils n'est pas dans le core r128).
  function fusionner(parties){
    const geos = []; let total = 0;
    for(const p of parties){
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if(p.m) g.applyMatrix4(p.m);
      geos.push([g, new THREE.Color(p.c).convertSRGBToLinear()]);
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total*3), nor = new Float32Array(total*3), col = new Float32Array(total*3);
    let o = 0;
    for(const [g, c] of geos){
      const P = g.attributes.position.array, N = g.attributes.normal.array, n = g.attributes.position.count;
      pos.set(P, o*3); nor.set(N, o*3);
      for(let i=0;i<n;i++){ col[(o+i)*3] = c.r; col[(o+i)*3+1] = c.g; col[(o+i)*3+2] = c.b; }
      o += n; g.dispose();
    }
    const res = new THREE.BufferGeometry();
    res.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    res.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    res.setAttribute('color', new THREE.BufferAttribute(col, 3));
    res.computeBoundingSphere();
    return res;
  }
  const M4 = () => new THREE.Matrix4();

  // =====================================================================
  //  GLSL COMMUN : brouillard (réglé par r3d-scene.js) sans dépendre des
  //  noms internes des morceaux de shader de three.
  // =====================================================================
  const BRUME_V = `
    #ifdef USE_FOG
      varying float vProf;
    #endif`;
  const BRUME_V_MAIN = `
    #ifdef USE_FOG
      vProf = -mv.z;
    #endif`;
  const BRUME_F = `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying float vProf;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
    #endif
    float facteurBrume(){
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          return 1.0 - exp(-fogDensity*fogDensity*vProf*vProf);
        #else
          return smoothstep(fogNear, fogFar, vProf);
        #endif
      #else
        return 0.0;
      #endif
    }`;
  function uniformes(propres){ return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, propres]); }

  // =====================================================================
  //  ATLAS DE TEXTURES (canvas 512 × 512, 16 cases de 128)
  //  0 fumée douce · 1 fumée grumeleuse · 2 flamme · 3 étincelle (lueur)
  //  4 éclat en étoile · 5 gouttes · 6 poussière granuleuse · 7 fumée filandreuse
  //  8 anneau · 9 second nuage · 10 reflet en croix · 11 trait d'étincelle
  //  12 fuseau de fumée · 13 globe
  //  Texture de masque (blanc + alpha, nuances de gris) lue par un shader maison :
  //  elle reste en encodage linéaire, la couleur vient des particules.
  // =====================================================================
  function creerAtlas(){
    const C = 128, cv = document.createElement('canvas');
    cv.width = C*4; cv.height = C*4;
    const g = cv.getContext('2d');
    let graine = 12345;
    const rnd = () => (graine = (graine*16807) % 2147483647) / 2147483647;
    function tache(cx, cy, r, a, gris, dur){
      const v = gris === undefined ? 255 : gris|0;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(${v},${v},${v},${a})`);
      gr.addColorStop(dur ? 0.7 : 0.45, `rgba(${v},${v},${v},${a*(dur ? 0.85 : 0.55)})`);
      gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill();
    }
    function cellule(i, fn){
      const ox = (i % 4)*C, oy = Math.floor(i / 4)*C;
      g.save(); g.beginPath(); g.rect(ox + 3, oy + 3, C - 6, C - 6); g.clip(); g.translate(ox, oy); fn(); g.restore();
    }
    // Bouffée « chou-fleur » : silhouette bosselée faite de lobes à bord assez franc, et un
    // grain interne. Le shader relit ce masque décalé vers le soleil : des lobes bien marqués
    // donnent des ombres propres et une vraie impression de volume.
    function bouffee(nLobes, rMin, rMax, dMax, a, coeur){
      tache(64, 64, 40, coeur, 255);
      for(let k=0;k<nLobes;k++){
        const ang = rnd()*6.28, d = Math.sqrt(rnd())*dMax, rl = rMin + rnd()*(rMax - rMin)*(1 - d/(dMax*1.6));
        tache(64 + Math.cos(ang)*d, 64 + Math.sin(ang)*d, rl, a, 200 + rnd()*55, true);
      }
      // grain : petites taches claires et sombres qui cassent l'aspect « flou gaussien »
      for(let k=0;k<70;k++){
        const ang = rnd()*6.28, d = Math.sqrt(rnd())*34;
        tache(64 + Math.cos(ang)*d, 64 + Math.sin(ang)*d, 3 + rnd()*7, 0.18, rnd() < 0.5 ? 150 : 255);
      }
    }
    // 0 — fumée : bouffée bosselée, assez douce
    cellule(0, () => bouffee(16, 12, 22, 34, 0.42, 0.45));
    // 1 — fumée grumeleuse : amas dense à bord franc (boule de feu, nuage épais)
    cellule(1, () => bouffee(22, 10, 19, 36, 0.6, 0.6));
    // 2 — flamme : goutte inversée, pointe en haut
    cellule(2, () => {
      g.filter = 'blur(5px)';
      const gr = g.createLinearGradient(0, 12, 0, 116);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.65)');
      gr.addColorStop(0.8, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0.2)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(64, 14);
      g.bezierCurveTo(80, 44, 102, 78, 64, 112); g.bezierCurveTo(26, 78, 48, 44, 64, 14); g.fill();
      g.filter = 'none';
      tache(64, 84, 22, 0.8);
    });
    // 3 — étincelle / lueur : cœur dense, halo exponentiel
    cellule(3, () => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 60);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.1, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.28, 'rgba(255,255,255,0.4)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.08)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, C, C);
    });
    // 4 — éclat en étoile (flamme de bouche, flash)
    cellule(4, () => {
      g.filter = 'blur(2px)'; g.fillStyle = 'rgba(255,255,255,0.9)';
      for(let k=0;k<7;k++){
        const a = k/7*6.2832 + rnd()*0.3, L = 34 + rnd()*24, l = 5 + rnd()*4;
        g.beginPath(); g.moveTo(64 + Math.cos(a + 1.57)*l, 64 + Math.sin(a + 1.57)*l);
        g.lineTo(64 + Math.cos(a)*L, 64 + Math.sin(a)*L);
        g.lineTo(64 + Math.cos(a - 1.57)*l, 64 + Math.sin(a - 1.57)*l); g.fill();
      }
      g.filter = 'none';
      tache(64, 64, 30, 1, 255, true);
    });
    // 5 — gouttes (gerbe d'eau)
    cellule(5, () => {
      tache(64, 64, 46, 0.3);
      for(let k=0;k<46;k++){
        const a = rnd()*6.28, d = Math.sqrt(rnd())*46, r = 1.5 + rnd()*3.5;
        g.fillStyle = `rgba(255,255,255,${(0.95*(1 - d/56)).toFixed(3)})`;
        g.beginPath(); g.arc(64 + Math.cos(a)*d, 64 + Math.sin(a)*d, r, 0, 6.2832); g.fill();
      }
    });
    // 6 — poussière granuleuse
    cellule(6, () => {
      tache(64, 64, 54, 0.5);
      for(let k=0;k<5;k++){ const a = rnd()*6.28, d = rnd()*18; tache(64 + Math.cos(a)*d, 64 + Math.sin(a)*d, 22 + rnd()*14, 0.25, 215 + rnd()*40); }
      for(let k=0;k<150;k++){
        const a = rnd()*6.28, d = Math.sqrt(rnd())*48, v = 180 + rnd()*75|0;
        g.fillStyle = `rgba(${v},${v},${v},${(0.35*(1 - d/52)).toFixed(3)})`;
        g.fillRect(64 + Math.cos(a)*d, 64 + Math.sin(a)*d, 1 + rnd()*2.5, 1 + rnd()*2.5);
      }
    });
    // 7 — fumée filandreuse (traînées)
    cellule(7, () => {
      for(let k=0;k<7;k++){
        g.save(); g.translate(64 + (rnd() - 0.5)*24, 64 + (rnd() - 0.5)*24); g.rotate(rnd()*3.14); g.scale(1, 0.45);
        tache(0, 0, 30 + rnd()*14, 0.4, 215 + rnd()*40); g.restore();
      }
    });
    // 8 — anneau (onde d'éclatement en l'air, impact de plasma)
    cellule(8, () => {
      const gr = g.createRadialGradient(64, 64, 26, 64, 64, 60);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.14)');
      gr.addColorStop(0.8, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.5)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, C, C);
    });
    // 9 — second nuage (autre tirage : casse la répétition dans les grosses fumées)
    cellule(9, () => bouffee(19, 11, 21, 35, 0.5, 0.5));
    // 10 — reflet en croix (éclair d'une grosse explosion, impact de plasma)
    cellule(10, () => {
      function branche(ang, L, l, a){
        g.save(); g.translate(64, 64); g.rotate(ang);
        const gr = g.createLinearGradient(-L, 0, L, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, L, l, 0, 0, 6.2832); g.fill(); g.restore();
      }
      branche(0, 58, 2.8, 0.95); branche(1.5708, 42, 2.3, 0.8); branche(0.7854, 22, 1.8, 0.4); branche(-0.7854, 22, 1.8, 0.4);
      tache(64, 64, 17, 1, 255);
    });
    // 11 — trait d'étincelle : fuseau allongé selon x (le shader l'oriente selon la vitesse à l'écran)
    cellule(11, () => {
      g.save(); g.translate(64, 64); g.scale(1, 0.17);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 58);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 58, 0, 6.2832); g.fill(); g.restore();
    });
    // 12 — fuseau de fumée allongé selon x (sillage des missiles : posé dans l'axe du vol, il fait un
    //      trait continu avec trois à quatre fois moins de particules que des bouffées rondes)
    cellule(12, () => {
      for(let k=0;k<11;k++){
        const u = (k/10 - 0.5)*2, cx = 64 + u*44, cy = 64 + (rnd() - 0.5)*5;
        tache(cx, cy, (11 + rnd()*4)*(1 - 0.3*u*u), 0.5, 215 + rnd()*40, true);
      }
      for(let k=0;k<26;k++) tache(64 + (rnd() - 0.5)*92, 64 + (rnd() - 0.5)*12, 2.5 + rnd()*4, 0.16, rnd() < 0.5 ? 165 : 255);
    });
    // 13 — globe : boule pleine à bord doux (tir de plasma ; peinte en mélange normal, elle garde sa
    //      teinte même sur le sable clair, là où une lueur additive vire au blanc)
    cellule(13, () => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 58);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.42, 'rgba(225,225,225,0.96)');
      gr.addColorStop(0.62, 'rgba(190,190,190,0.5)'); gr.addColorStop(0.8, 'rgba(170,170,170,0.14)');
      gr.addColorStop(1, 'rgba(160,160,160,0)');
      g.fillStyle = gr; g.fillRect(0, 0, C, C);
    });
    const t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    return t;
  }

  // =====================================================================
  //  GABARITS DE PARTICULES
  //  add : réserve additive ; cadre : case de l'atlas ; t0/t1 : taille relative
  //  début/fin ; a0 : opacité ; fi : fraction d'apparition ; fo : exposant de
  //  disparition ; drag : freinage ; grav : poussée verticale ; vent : part de
  //  dérive ; rot : vitesse de rotation max ; rebond : collision au sol ;
  //  c0 → cm (à la fraction km) → c1 : couleur au fil de la vie ; e0/e1 : intensité
  //  lumineuse (au-delà de 1 : matière incandescente, que le post-traitement fait
  //  rayonner) ; l0/l1 : part d'éclairage par le soleil (0 = lumineux par lui-même,
  //  1 = fumée ou poussière éclairée) ; droit : sprite jamais tourné ; aligne :
  //  sprite orienté selon sa vitesse à l'écran (traits d'étincelle).
  //  Tous les gabarits sortent du même moule (mêmes champs, même ordre) : la boucle
  //  des particules lit ainsi des objets de forme unique, ce qui la garde rapide.
  // =====================================================================
  const GAB = [], G = {};
  function gabarit(nom, o){
    const c0 = lin(o.c0), c1 = lin(o.c1 || o.c0), cm = o.cm ? lin(o.cm) : c0, add = o.add ? 1 : 0;
    const g = {
      id: GAB.length, add, cadre: o.cadre,
      t0: o.t0, t1: o.t1, a0: o.a0 === undefined ? 1 : o.a0,
      fi: o.fi || 0, fo: o.fo === undefined ? 1 : o.fo,
      drag: o.drag || 0, grav: o.grav || 0, vent: o.vent || 0, rot: o.rot || 0,
      rebond: o.rebond ? 1 : 0, droit: o.droit ? 1 : 0, aligne: o.aligne ? 1 : 0,
      vie0: o.vie[0], vie1: o.vie[1],
      r0: c0[0], g0: c0[1], b0: c0[2], rm: cm[0], gm: cm[1], bm: cm[2], r1: c1[0], g1: c1[1], b1: c1[2],
      km: o.cm ? (o.km || 0.4) : 0,
      e0: o.e0 === undefined ? 1 : o.e0, e1: o.e1 === undefined ? 1 : o.e1,
      l0: o.l0 === undefined ? (add ? 0 : 1) : o.l0, l1: o.l1 === undefined ? (add ? 0 : 1) : o.l1,
      plancher: add ? 0.3 : 0.28,
    };
    GAB.push(g); G[nom] = g;
  }
  // --- Lumineux (additifs) : brefs, petits ou peu opaques ---
  gabarit('eclat',      {add:1, cadre:3, t0:0.6, t1:1.25, c0:'#fff6dc', c1:'#ffc878', e0:2.6, e1:1.0, vie:[0.06, 0.09]});
  gabarit('reflet',     {add:1, cadre:10, droit:1, t0:0.7, t1:1.2, a0:0.85, c0:'#fff4dc', c1:'#ffc890', e0:1.8, e1:1.0, vie:[0.12, 0.18], fo:1.6});
  gabarit('flash',      {add:1, cadre:4, t0:0.8, t1:1.3, c0:'#fff8e0', c1:'#ffb050', vie:[0.09, 0.13], fo:1.4});
  gabarit('halo',       {add:1, cadre:3, t0:0.7, t1:1.5, a0:0.5, c0:'#ffc878', c1:'#ff4810', vie:[0.22, 0.32], fo:1.5});
  gabarit('haloTir',    {add:1, cadre:3, t0:0.7, t1:1.4, a0:0.3, c0:'#ffc878', c1:'#ff6a20', vie:[0.08, 0.12], fo:1.3});
  gabarit('anneauChoc', {add:1, cadre:8, t0:0.3, t1:1.4, a0:0.3, c0:'#fff2dc', c1:'#ffb070', vie:[0.2, 0.3], fo:1.2});
  gabarit('flamme',     {add:1, cadre:1, t0:0.55, t1:1.25, a0:0.5, c0:'#ffc868', c1:'#7a1800', vie:[0.22, 0.42], fi:0.04, fo:1.5, drag:3.6, grav:22, rot:1.6});
  gabarit('feu',        {add:1, cadre:2, droit:1, t0:1.0, t1:0.35, a0:0.9, c0:'#ffd27a', c1:'#c02800', vie:[0.35, 0.62], fi:0.12, drag:1.2, grav:34, vent:0.3});
  gabarit('lueurFeu',   {add:1, cadre:3, t0:0.9, t1:1.1, a0:0.26, c0:'#ff9a40', c1:'#ff4a10', vie:[0.3, 0.45], fi:0.3, fo:1.2});
  gabarit('etincelle',  {add:1, cadre:11, aligne:1, t0:3.2, t1:1.6, c0:'#fff4b8', c1:'#ff6a18', e0:1.6, e1:1.0, vie:[0.35, 0.85], drag:0.9, grav:GRAVITE*0.8, rebond:1});
  gabarit('braise',     {add:1, cadre:3, t0:1.0, t1:0.3, c0:'#ffb050', c1:'#ff2a00', e0:1.5, e1:1.0, vie:[1.0, 1.9], drag:1.3, grav:26, vent:0.7});
  gabarit('bouche',     {add:1, cadre:4, t0:1.0, t1:0.75, c0:'#fff6c8', c1:'#ff9a38', vie:[0.05, 0.08], fo:0.8});
  gabarit('boucheAA',   {add:1, cadre:4, t0:1.0, t1:0.75, c0:'#eaf6ff', c1:'#68b4ff', vie:[0.05, 0.08], fo:0.8});
  gabarit('propulseur', {add:1, cadre:3, t0:1.0, t1:0.35, c0:'#fff2c4', c1:'#ff5a10', vie:[0.07, 0.13]});
  gabarit('impact',     {add:1, cadre:3, t0:1.0, t1:0.4, c0:'#fff8d0', c1:'#ffa040', vie:[0.06, 0.1]});
  gabarit('scintBleu',  {add:1, cadre:3, t0:1.0, t1:0.3, c0:'#d8f0ff', c1:'#2f8fff', vie:[0.5, 0.9], drag:0.5, grav:60});
  gabarit('scintRouge', {add:1, cadre:3, t0:1.0, t1:0.3, c0:'#ffe0c8', c1:'#ff3a1a', vie:[0.5, 0.9], drag:0.5, grav:60});
  // --- Plasma des envahisseurs (teinte #7df9d0) : éclats additifs ---
  gabarit('bouchePlasma', {add:1, cadre:4, t0:1.0, t1:0.75, c0:'#eafff8', c1:'#7df9d0', vie:[0.06, 0.09], fo:0.8});
  gabarit('plasmaEclat',  {add:1, cadre:10, droit:1, t0:0.7, t1:1.2, a0:0.9, c0:'#f0fffa', c1:'#7df9d0', e0:1.8, e1:1.0, vie:[0.11, 0.16], fo:1.5});
  gabarit('plasmaHalo',   {add:1, cadre:3, t0:0.6, t1:1.4, a0:0.45, c0:'#a8ffe6', c1:'#12806a', vie:[0.22, 0.32], fo:1.5});
  gabarit('scintPlasma',  {add:1, cadre:11, aligne:1, t0:2.6, t1:1.2, c0:'#d9fff4', c1:'#2fd0a8', e0:1.5, e1:1.0, vie:[0.4, 0.8], drag:1.0, grav:GRAVITE*0.5, rebond:1});
  // --- Opaques (mélange normal) ---
  // Boule de feu : incandescente et lumineuse par elle-même à sa naissance, elle refroidit en suie
  // que le soleil éclaire. Peinte en mélange normal, elle garde sa couleur même sur le sable clair
  // (l'additif seul y vire au blanc).
  gabarit('bouleFeu',   {cadre:1, t0:0.45, t1:1.5, a0:0.96, c0:'#fff0b8', cm:'#ea6a16', km:0.35, c1:'#17110e', e0:2.4, e1:0.9, l0:0, l1:1,
                         vie:[0.6, 1.05], fi:0.03, fo:1.1, drag:3.2, grav:30, rot:1.2});
  gabarit('fumeeNoire', {cadre:0, t0:0.5, t1:1.7, a0:0.78, c0:'#2c2824', c1:'#8c867c', vie:[2.4, 3.8], fi:0.07, fo:1.4, drag:1.3, grav:12, vent:1, rot:0.35});
  gabarit('fumeeDense', {cadre:9, t0:0.5, t1:1.9, a0:0.8, c0:'#26221f', c1:'#7d776e', vie:[2.8, 4.4], fi:0.06, fo:1.5, drag:1.5, grav:16, vent:1, rot:0.3});
  gabarit('colonne',    {cadre:1, t0:0.6, t1:2.3, a0:0.62, c0:'#4a443d', c1:'#b2ab9f', vie:[4.0, 6.5], fi:0.1, fo:1.5, drag:0.8, grav:24, vent:1, rot:0.25});
  gabarit('fumeeGrise', {cadre:0, t0:0.5, t1:1.8, a0:0.45, c0:'#9a958c', c1:'#c9c3b8', vie:[0.9, 1.5], fi:0.05, fo:1.3, drag:2.6, grav:6, vent:1, rot:0.4});
  gabarit('poussiere',  {cadre:6, t0:0.5, t1:1.7, a0:0.6, c0:'#a88c60', c1:'#cbb48a', vie:[1.1, 1.9], fi:0.05, fo:1.3, drag:2.3, grav:4, vent:0.6, rot:0.3});
  // Poussière des chenilles et des roues : nappe douce qui s'étale, et quelques grains près du sol.
  // (teintes plus claires que le sable : au soleil, un nuage de poussière se détache en clair sur le sol)
  gabarit('poussiereRoule', {cadre:0, t0:0.45, t1:1.9, a0:0.68, c0:'#d2b98a', c1:'#ead9b4', vie:[1.2, 2.0], fi:0.12, fo:1.3, drag:1.5, grav:4, vent:0.8, rot:0.3});
  gabarit('poussiereGrain', {cadre:6, t0:0.6, t1:1.5, a0:0.55, c0:'#c6ac7e', c1:'#e2d0a8', vie:[0.7, 1.2], fi:0.15, fo:1.2, drag:1.8, grav:5, vent:0.8, rot:0.3});
  gabarit('poussiereLourde', {cadre:1, t0:0.5, t1:2.0, a0:0.75, c0:'#9e8662', c1:'#cdbb98', vie:[3.8, 6.5], fi:0.04, fo:1.6, drag:1.7, grav:7, vent:0.7, rot:0.2});
  gabarit('poussiereOnde', {cadre:0, t0:0.5, t1:2.3, a0:0.5, c0:'#b9a37c', c1:'#d8c8a6', vie:[1.2, 2.0], fi:0.06, fo:1.4, drag:2.6, grav:3, vent:0.4, rot:0.3});
  gabarit('trainee',    {cadre:0, t0:0.45, t1:1.9, a0:0.62, c0:'#b4afa6', c1:'#e2ded6', vie:[0.9, 1.5], fi:0.05, fo:1.3, drag:1.0, grav:5, vent:0.8, rot:0.5});
  gabarit('traineeMissile', {cadre:0, t0:0.5, t1:2.2, a0:0.8, c0:'#d8d6d0', c1:'#f0eee8', vie:[1.8, 2.8], fi:0.03, fo:1.4, drag:0.9, grav:4, vent:0.9, rot:0.3});
  // Sillage blanc et persistant des missiles air-air.
  gabarit('traineeAir', {cadre:12, t0:0.8, t1:1.55, a0:0.85, c0:'#f4f4f2', c1:'#ffffff', vie:[2.2, 3.1], fi:0.03, fo:1.5, drag:1.2, grav:1.5, vent:0.5});
  gabarit('vapeur',     {cadre:12, t0:0.7, t1:1.3, a0:0.36, c0:'#f4f4f2', c1:'#ffffff', vie:[0.4, 0.7], fi:0.1, fo:1.3, drag:1.0, vent:0.5});
  gabarit('vapeurPlasma', {cadre:0, t0:0.5, t1:1.7, a0:0.32, c0:'#9fd8c8', c1:'#d8ece6', vie:[0.8, 1.3], fi:0.08, fo:1.4, drag:2.0, grav:8, vent:0.7, rot:0.4});
  // Plasma peint en mélange normal et lumineux par lui-même (l0 = l1 = 0) : sur le sable clair, une lueur
  // additive turquoise vire au blanc jaunâtre ; ainsi la teinte des envahisseurs reste franche partout.
  gabarit('plasmaTraine', {cadre:11, t0:1.0, t1:0.35, a0:0.8, c0:'#9dffe2', c1:'#1fb894', e0:1.4, e1:1.0, l0:0, l1:0, vie:[0.22, 0.32], fo:1.2});
  gabarit('plasmaLueur',  {cadre:13, t0:0.5, t1:1.5, a0:0.8, c0:'#b4ffe8', c1:'#27c49c', e0:1.6, e1:1.0, l0:0, l1:0, vie:[0.16, 0.24], fo:1.6});
  gabarit('plasmaAnneau', {cadre:8, t0:0.35, t1:1.3, a0:0.85, c0:'#c8fff0', c1:'#3fd8b0', e0:1.4, e1:1.0, l0:0, l1:0, vie:[0.28, 0.38], fo:1.3});
  gabarit('eau',        {cadre:5, t0:0.6, t1:1.5, a0:0.9, c0:'#ffffff', c1:'#cfeef2', vie:[0.8, 1.3], fo:1.2, drag:0.5, grav:GRAVITE*0.75, rot:0.5});
  gabarit('brumeEau',   {cadre:0, t0:0.6, t1:2.0, a0:0.5, c0:'#eef8fa', c1:'#ffffff', vie:[1.4, 2.4], fi:0.08, fo:1.4, drag:2.0, grav:5, vent:0.6, rot:0.3});
  gabarit('flak',       {cadre:1, t0:0.4, t1:1.2, a0:0.85, c0:'#1c1a18', c1:'#4a4642', vie:[0.8, 1.3], fo:1.3, drag:3.0, grav:3, vent:0.6, rot:0.6});
  gabarit('fumigeneRouge', {cadre:0, t0:0.35, t1:2.1, a0:0.62, c0:'#d0402e', c1:'#e0a294', vie:[2.4, 3.4], fi:0.06, fo:1.4, drag:0.7, grav:28, vent:1.3, rot:0.4});
  gabarit('fumigeneBleu',  {cadre:0, t0:0.35, t1:2.1, a0:0.6, c0:'#3a8ee0', c1:'#a8d0f0', vie:[2.4, 3.4], fi:0.06, fo:1.4, drag:0.7, grav:28, vent:1.3, rot:0.4});

  // =====================================================================
  //  RÉSERVES DE PARTICULES (THREE.Points + ShaderMaterial)
  // =====================================================================
  const PART_V = `
    attribute vec4 aCouleur;
    attribute vec4 aDonnees;        // taille (monde), rotation, case d'atlas, part d'éclairage solaire
    uniform float uEchelle;
    uniform float uTailleMax;
    varying vec4 vCouleur;
    varying vec2 vRot;
    varying vec2 vCase;
    varying float vSoleil;
    ${BRUME_V}
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = min(aDonnees.x * uEchelle / max(1.0, -mv.z), uTailleMax);
      vCouleur = aCouleur;
      vRot = vec2(cos(aDonnees.y), sin(aDonnees.y));
      vCase = vec2(mod(aDonnees.z, 4.0), floor(aDonnees.z / 4.0));
      vSoleil = aDonnees.w;
      ${BRUME_V_MAIN}
    }`;
  const PART_F = `
    uniform sampler2D uAtlas;
    uniform vec2 uSoleil;               // direction du soleil projetée à l'écran (repère gl_PointCoord)
    uniform vec3 uLumiere;              // teinte du côté éclairé (soleil + ciel)
    uniform vec3 uOmbre;                // teinte du côté à l'ombre (ciel seul)
    varying vec4 vCouleur;
    varying vec2 vRot;
    varying vec2 vCase;
    varying float vSoleil;
    ${BRUME_F}
    vec2 uvCase(vec2 r){ return vec2((vCase.x + r.x + 0.5) * 0.25, 1.0 - (vCase.y + r.y + 0.5) * 0.25); }
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      vec2 r = vec2(c.x*vRot.x - c.y*vRot.y, c.x*vRot.y + c.y*vRot.x);
      if(abs(r.x) > 0.49 || abs(r.y) > 0.49) discard;
      vec4 t = texture2D(uAtlas, uvCase(r));
      float a = t.a * vCouleur.a;
      if(a < 0.003) discard;
      vec3 col = vCouleur.rgb * t.rgb;
      float f = facteurBrume();
      #ifdef ADDITIF
        col *= (1.0 - f);
        gl_FragColor = linearToOutputTexel(vec4(col, a));
      #else
        #ifdef VOLUME
          // Volume simulé : on relit le masque un peu plus loin vers le soleil. Si la matière y est
          // plus dense, ce point est à l'ombre de la bouffée ; sinon il est éclairé (bord côté soleil).
          vec2 cs = c + uSoleil * 0.13;
          vec2 rs = vec2(cs.x*vRot.x - cs.y*vRot.y, cs.x*vRot.y + cs.y*vRot.x);
          float as = (abs(rs.x) < 0.49 && abs(rs.y) < 0.49) ? texture2D(uAtlas, uvCase(rs)).a : 0.0;
          float lum = clamp(0.92 - (as - t.a) * 2.6 - as * 0.25, 0.0, 1.0);
          lum = clamp(lum + (-c.y) * 0.35, 0.0, 1.0);    // le haut de la bouffée prend un peu plus le soleil
        #else
          // Qualité basse : simple dégradé vers le soleil (une seule lecture de texture).
          float lum = clamp(0.6 + dot(c, uSoleil) * 1.1 - c.y * 0.3, 0.0, 1.0);
        #endif
        // vSoleil = 0 : matière lumineuse par elle-même (boule de feu) ; 1 : fumée éclairée par la scène.
        vec3 eclairage = mix(uOmbre, uLumiere, lum);
        col *= mix(vec3(1.0), eclairage, vSoleil);
        // Boule de feu qui refroidit (vSoleil entre 0 et 1) : le cœur dense de la bouffée reste incandescent,
        // ses bords minces noircissent en premier. C'est ce contraste qui donne le roulis d'une explosion.
        float feu = step(vSoleil, 0.999);
        float bord = clamp((0.85 - t.a) * 2.6, 0.0, 1.0);
        float froid = clamp(vSoleil * 5.5 * bord, 0.0, 1.0) * feu;
        col *= 1.0 + feu * (1.0 - vSoleil) * (1.0 - bord) * 0.5;
        col = mix(col, vec3(0.05, 0.045, 0.04) * eclairage, froid);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        gl_FragColor = linearToOutputTexel(gl_FragColor);
        #ifdef USE_FOG
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, f);
        #endif
      #endif
    }`;

  let atlas = null;
  // Uniformes partagés par les réserves ; mis à jour juste avant chaque rendu (voir avantRendu).
  const uniEchelle = {value: 600};
  const uniTailleMax = {value: 1024};
  const uniSoleil = {value: new THREE.Vector2(-0.6, -0.8)};
  const uniLumiere = {value: new THREE.Vector3(1.30, 1.20, 1.04)};
  const uniOmbre = {value: new THREE.Vector3(0.50, 0.54, 0.62)};
  let poolAdd = null, poolNorm = null;

  function creerPool(N, additif){
    const P = {N, prochain:0, actives:0,
      pos: new Float32Array(N*3), vel: new Float32Array(N*3),
      age: new Float32Array(N), vie: new Float32Array(N), ech: new Float32Array(N),
      rot: new Float32Array(N), vrot: new Float32Array(N), lum: new Float32Array(N),
      sol: new Float32Array(N), gab: new Uint8Array(N)};
    const geo = new THREE.BufferGeometry();
    P.aPos = new THREE.BufferAttribute(new Float32Array(N*3), 3).setUsage(THREE.DynamicDrawUsage);
    P.aCoul = new THREE.BufferAttribute(new Float32Array(N*4), 4).setUsage(THREE.DynamicDrawUsage);
    P.aDon = new THREE.BufferAttribute(new Float32Array(N*4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', P.aPos); geo.setAttribute('aCouleur', P.aCoul); geo.setAttribute('aDonnees', P.aDon);
    geo.setDrawRange(0, 0);
    const defs = {};
    if(additif) defs.ADDITIF = 1; else if(Q.volume) defs.VOLUME = 1;
    const mat = new THREE.ShaderMaterial({
      uniforms: uniformes({uAtlas:{value:null}, uEchelle:{value:600}, uTailleMax:{value:1024},
        uSoleil:{value:new THREE.Vector2()}, uLumiere:{value:new THREE.Vector3()}, uOmbre:{value:new THREE.Vector3()}}),
      vertexShader: PART_V, fragmentShader: PART_F,
      transparent: true, depthWrite: false, fog: true,
      blending: additif ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: defs,
    });
    mat.uniforms.uAtlas.value = atlas;
    mat.uniforms.uEchelle = uniEchelle;           // uniformes partagés
    mat.uniforms.uTailleMax = uniTailleMax;
    mat.uniforms.uSoleil = uniSoleil;
    mat.uniforms.uLumiere = uniLumiere;
    mat.uniforms.uOmbre = uniOmbre;
    P.geo = geo;
    P.points = new THREE.Points(geo, mat);
    P.points.frustumCulled = false;
    P.points.renderOrder = additif ? 6 : 3;
    P.points.onBeforeRender = avantRendu;
    groupe.add(P.points);
    return P;
  }

  // Émet une particule du gabarit g (réserve en anneau : la plus ancienne est recyclée si pleine).
  // rotImposee : angle du sprite à l'écran pour le lot en cours (fuseaux de sillage) ; NaN = au hasard.
  let rotImposee = NaN;
  const ALPHA_INVISIBLE = 0.01;
  function emettre(g, x, y, z, vx, vy, vz, ech, vieMul){
    if(!g) return;
    const P = g.add ? poolAdd : poolNorm;
    const i = P.prochain; P.prochain = (i + 1) % P.N;
    const i3 = i*3;
    P.pos[i3] = x; P.pos[i3+1] = y; P.pos[i3+2] = z;
    P.vel[i3] = vx; P.vel[i3+1] = vy; P.vel[i3+2] = vz;
    P.age[i] = 0; P.vie[i] = (g.vie0 + Math.random()*(g.vie1 - g.vie0)) * (vieMul || 1);
    P.ech[i] = ech; P.rot[i] = g.droit ? 0 : rotImposee === rotImposee ? rotImposee : Math.random()*6.2832;
    P.vrot[i] = (Math.random()*2 - 1) * g.rot;
    P.lum[i] = 0.85 + Math.random()*0.3;
    P.sol[i] = solCourant; P.gab[i] = g.id;
  }

  // Axes « droite » et « haut » de la caméra dans le monde (orientation des traits d'étincelle).
  let cdx = 1, cdy = 0, cdz = 0, chx = 0, chy = 1, chz = 0;

  function majPool(P, dt){
    const pos = P.pos, vel = P.vel, age = P.age, vie = P.vie, rotP = P.rot, solP = P.sol, gabP = P.gab;
    const aP = P.aPos.array, aC = P.aCoul.array, aD = P.aDon.array;
    const wx = VENT[0], wy = VENT[1], wz = VENT[2], N = P.N;
    let n = 0;
    for(let i=0;i<N;i++){
      const v = vie[i];
      if(v <= 0) continue;
      const g = GAB[gabP[i]], i3 = i*3;
      let a = age[i];
      if(dt > 0){
        a += dt;
        if(a >= v){ vie[i] = 0; continue; }
        age[i] = a;
        let am = 1 - g.drag*dt; if(am < 0) am = 0;
        const ux = vel[i3]*am, uy = vel[i3+1]*am + g.grav*dt, uz = vel[i3+2]*am, w = g.vent;
        vel[i3] = ux; vel[i3+1] = uy; vel[i3+2] = uz;
        pos[i3]   += (ux + wx*w)*dt;
        pos[i3+1] += (uy + wy*w)*dt;
        pos[i3+2] += (uz + wz*w)*dt;
        rotP[i] += P.vrot[i]*dt;
      }
      const k = a / v, ke = 1 - (1 - k)*(1 - k);
      let taille = P.ech[i] * (g.t0 + (g.t1 - g.t0)*ke);
      // Collision au sol : rebond pour les étincelles, flottaison pour la fumée (évite la coupe nette du sprite).
      if(g.rebond){
        const bas = solP[i] + 0.5;
        if(pos[i3+1] < bas){ pos[i3+1] = bas; if(vel[i3+1] < 0) vel[i3+1] *= -0.35; vel[i3] *= 0.6; vel[i3+2] *= 0.6; }
      } else {
        const plancher = solP[i] + taille*g.plancher;
        if(pos[i3+1] < plancher){ pos[i3+1] = plancher; if(vel[i3+1] < 0) vel[i3+1] = 0; }
      }
      // Trait d'étincelle : orienté selon la vitesse vue par la caméra, raccourci quand il ralentit.
      if(g.aligne){
        const ux = vel[i3], uy = vel[i3+1], uz = vel[i3+2];
        const ex = ux*cdx + uy*cdy + uz*cdz, ey = ux*chx + uy*chy + uz*chz;
        if(ex*ex + ey*ey > 1) rotP[i] = Math.atan2(ey, ex);
        const vit = Math.sqrt(ux*ux + uy*uy + uz*uz);
        if(vit < 140) taille *= 0.3 + vit*0.005;
      }
      const fi = g.fi > 0 && k < g.fi ? k / g.fi : 1;
      const alpha = g.a0 * fi * (g.fo === 1 ? 1 - k : Math.pow(1 - k, g.fo));
      // Particule presque transparente (début de fondu d'entrée, fin de fondu de sortie) : elle continue
      // de vivre mais n'est pas dessinée. Son sprite entier passerait par la carte graphique pour un apport
      // inférieur à 1 % (novembre 2026, surdessin des grosses batailles).
      if(alpha < ALPHA_INVISIBLE) continue;
      // Couleur : c0 → c1, ou c0 → cm → c1 quand le gabarit a une couleur médiane.
      let cr, cg, cb;
      const km = g.km;
      if(km > 0){
        if(k < km){ const t = k/km; cr = g.r0 + (g.rm - g.r0)*t; cg = g.g0 + (g.gm - g.g0)*t; cb = g.b0 + (g.bm - g.b0)*t; }
        else { const t = (k - km)/(1 - km); cr = g.rm + (g.r1 - g.rm)*t; cg = g.gm + (g.g1 - g.gm)*t; cb = g.bm + (g.b1 - g.bm)*t; }
      } else { cr = g.r0 + (g.r1 - g.r0)*k; cg = g.g0 + (g.g1 - g.g0)*k; cb = g.b0 + (g.b1 - g.b0)*k; }
      const l = P.lum[i] * (g.e0 + (g.e1 - g.e0)*k);
      const o3 = n*3, o4 = n*4;
      aP[o3] = pos[i3]; aP[o3+1] = pos[i3+1]; aP[o3+2] = pos[i3+2];
      aC[o4] = cr*l; aC[o4+1] = cg*l; aC[o4+2] = cb*l; aC[o4+3] = alpha;
      aD[o4] = taille; aD[o4+1] = rotP[i]; aD[o4+2] = g.cadre; aD[o4+3] = g.l0 + (g.l1 - g.l0)*k*k;    // k² : le feu reste lumineux un moment avant de devenir fumée
      n++;
    }
    P.actives = n;
    P.geo.setDrawRange(0, n);
    P.points.visible = n > 0;
    if(n > 0){
      // Seule la partie vivante des tampons est envoyée à la carte graphique.
      P.aPos.updateRange.count = n*3; P.aCoul.updateRange.count = n*4; P.aDon.updateRange.count = n*4;
      P.aPos.needsUpdate = true; P.aCoul.needsUpdate = true; P.aDon.needsUpdate = true;
    }
  }

  // =====================================================================
  //  ORBES : lueurs tenues par les projectiles (globe de plasma, tuyère de
  //  missile). Réécrites à chaque image depuis la liste des projectiles :
  //  pas de scintillement lié au débit d'images, contrairement à des
  //  particules très brèves réémises en continu.
  // =====================================================================
  let orbesAdd = null, orbesNorm = null;      // lueurs additives ; globes en mélange normal (plasma)
  const C_PLASMA_COEUR = lin('#f2fffb'), C_PLASMA = lin('#7df9d0'), C_PLASMA_GLOBE = lin('#55efc4');
  const C_TUYERE_COEUR = lin('#fff4d8'), C_TUYERE = lin('#ffa858');
  function creerOrbes(pool, ordre){
    const geo = new THREE.BufferGeometry();
    const O = {n:0, geo,
      aPos: new THREE.BufferAttribute(new Float32Array(MAX_ORBES*3), 3).setUsage(THREE.DynamicDrawUsage),
      aCoul: new THREE.BufferAttribute(new Float32Array(MAX_ORBES*4), 4).setUsage(THREE.DynamicDrawUsage),
      aDon: new THREE.BufferAttribute(new Float32Array(MAX_ORBES*4), 4).setUsage(THREE.DynamicDrawUsage)};
    geo.setAttribute('position', O.aPos); geo.setAttribute('aCouleur', O.aCoul); geo.setAttribute('aDonnees', O.aDon);
    geo.setDrawRange(0, 0);
    O.points = new THREE.Points(geo, pool.points.material);        // même matériau (donc même programme) que la réserve
    O.points.frustumCulled = false; O.points.renderOrder = ordre; O.points.visible = false;
    O.points.onBeforeRender = avantRendu;
    groupe.add(O.points);
    return O;
  }
  function orbe(O, x, y, z, taille, c, intensite, alpha, cadre){
    if(O.n >= MAX_ORBES) return;
    const i = O.n++, i3 = i*3, i4 = i*4, P = O.aPos.array, C = O.aCoul.array, D = O.aDon.array;
    P[i3] = x; P[i3+1] = y; P[i3+2] = z;
    C[i4] = c[0]*intensite; C[i4+1] = c[1]*intensite; C[i4+2] = c[2]*intensite; C[i4+3] = alpha;
    D[i4] = taille; D[i4+1] = 0; D[i4+2] = cadre; D[i4+3] = 0;       // w = 0 : lumineux par lui-même
  }
  function finOrbes(O){
    const n = O.n;
    O.geo.setDrawRange(0, n); O.points.visible = n > 0;
    if(n > 0){
      O.aPos.updateRange.count = n*3; O.aCoul.updateRange.count = n*4; O.aDon.updateRange.count = n*4;
      O.aPos.needsUpdate = O.aCoul.needsUpdate = O.aDon.needsUpdate = true;
    }
  }

  // =====================================================================
  //  TRAÇANTES (InstancedBufferGeometry : ruban orienté caméra par instance)
  // =====================================================================
  const TRAIT_V = `
    attribute vec3 iA;
    attribute vec3 iB;
    attribute vec4 iCoul;
    attribute float iLarg;
    varying vec2 vC;
    varying vec4 vCoul;
    ${BRUME_V}
    void main(){
      vec4 a = modelViewMatrix * vec4(iA, 1.0);
      vec4 b = modelViewMatrix * vec4(iB, 1.0);
      vec4 mv = mix(a, b, position.x);
      vec3 d = b.xyz - a.xyz + vec3(1e-4, 0.0, 0.0);
      vec3 cote = normalize(cross(d, mv.xyz));
      mv.xyz += cote * iLarg * position.y;
      mv.xyz += normalize(d) * iLarg * (position.x*2.0 - 1.0) * 0.8;   // bouts arrondis
      gl_Position = projectionMatrix * mv;
      vC = position.xy;
      vCoul = iCoul;
      ${BRUME_V_MAIN}
    }`;
  // Cœur blanc incandescent (plus vif vers la tête du trait), gaine à la couleur du tir.
  const TRAIT_F = `
    varying vec2 vC;
    varying vec4 vCoul;
    ${BRUME_F}
    void main(){
      float s = vC.y;
      float coeur = exp(-s*s*18.0);
      float halo = exp(-s*s*3.2);
      float queue = smoothstep(0.0, 0.9, vC.x) * (1.0 - smoothstep(0.94, 1.0, vC.x));
      float tete = smoothstep(0.5, 0.95, vC.x);
      vec3 col = vCoul.rgb * halo * 1.1 + vec3(1.0, 0.97, 0.88) * coeur * (1.0 + 0.9*tete);
      float a = vCoul.a * queue * (halo*0.8 + coeur);
      col *= (1.0 - facteurBrume());
      gl_FragColor = linearToOutputTexel(vec4(col, a));
    }`;
  const TR = {ax:new Float32Array(MAX_TRAITS*3), bx:new Float32Array(MAX_TRAITS*3), age:new Float32Array(MAX_TRAITS),
    vie:new Float32Array(MAX_TRAITS), lg:new Float32Array(MAX_TRAITS), larg:new Float32Array(MAX_TRAITS),
    coul:new Float32Array(MAX_TRAITS*3), prochain:0, actifs:0};
  let geoTraits = null, meshTraits = null, attA, attB, attC, attL;

  function creerTraits(){
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0,-1,0, 1,-1,0, 1,1,0, 0,1,0], 3));
    g.setIndex([0,1,2, 0,2,3]);
    attA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRAITS*3), 3).setUsage(THREE.DynamicDrawUsage);
    attB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRAITS*3), 3).setUsage(THREE.DynamicDrawUsage);
    attC = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRAITS*4), 4).setUsage(THREE.DynamicDrawUsage);
    attL = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRAITS), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', attA); g.setAttribute('iB', attB); g.setAttribute('iCoul', attC); g.setAttribute('iLarg', attL);
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: uniformes({}), vertexShader: TRAIT_V, fragmentShader: TRAIT_F,
      transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide}));
    m.frustumCulled = false; m.renderOrder = 7; m.visible = false;
    groupe.add(m);
    geoTraits = g; meshTraits = m;
  }

  function ajouterTrait(x1, y1, z1, x2, y2, z2, hex, largeur, vie, longueur){
    const i = TR.prochain; TR.prochain = (i + 1) % MAX_TRAITS;
    const i3 = i*3, c = couleurLin(hex || '#fff1a8');
    TR.ax[i3] = x1; TR.ax[i3+1] = y1; TR.ax[i3+2] = z1;
    TR.bx[i3] = x2; TR.bx[i3+1] = y2; TR.bx[i3+2] = z2;
    TR.coul[i3] = c[0]; TR.coul[i3+1] = c[1]; TR.coul[i3+2] = c[2];
    TR.age[i] = 0; TR.vie[i] = vie; TR.larg[i] = largeur; TR.lg[i] = longueur;
  }

  function majTraits(dt){
    const A = attA.array, B = attB.array, C = attC.array, L = attL.array;
    let n = 0;
    for(let i=0;i<MAX_TRAITS;i++){
      if(TR.vie[i] <= 0) continue;
      TR.age[i] += dt;
      if(TR.age[i] >= TR.vie[i]){ TR.vie[i] = 0; continue; }
      const k = TR.age[i] / TR.vie[i], i3 = i*3;
      const dx = TR.bx[i3] - TR.ax[i3], dy = TR.bx[i3+1] - TR.ax[i3+1], dz = TR.bx[i3+2] - TR.ax[i3+2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const frac = Math.min(1, TR.lg[i] / len);
      // La tête parcourt le segment pendant 65 % de la vie, la queue la suit.
      const tete = Math.min(1, k / 0.65) * (1 + frac) ;
      const t1 = Math.min(1, tete), t0 = Math.max(0, tete - frac);
      if(t1 - t0 < 0.002) continue;
      const o3 = n*3, o4 = n*4;
      A[o3] = TR.ax[i3] + dx*t0; A[o3+1] = TR.ax[i3+1] + dy*t0; A[o3+2] = TR.ax[i3+2] + dz*t0;
      B[o3] = TR.ax[i3] + dx*t1; B[o3+1] = TR.ax[i3+1] + dy*t1; B[o3+2] = TR.ax[i3+2] + dz*t1;
      C[o4] = TR.coul[i3]; C[o4+1] = TR.coul[i3+1]; C[o4+2] = TR.coul[i3+2];
      C[o4+3] = k < 0.75 ? 1 : (1 - k)/0.25;
      L[n] = TR.larg[i];
      n++;
    }
    TR.actifs = n;
    geoTraits.instanceCount = n; meshTraits.visible = n > 0;
    if(n > 0){ attA.needsUpdate = attB.needsUpdate = attC.needsUpdate = attL.needsUpdate = true; }
  }

  // =====================================================================
  //  DÉBRIS (InstancedMesh, gravité, rebond, rotation)
  // =====================================================================
  const DB = {pos:new Float32Array(MAX_DEBRIS*3), vel:new Float32Array(MAX_DEBRIS*3), rot:new Float32Array(MAX_DEBRIS*3),
    vrot:new Float32Array(MAX_DEBRIS*3), ech:new Float32Array(MAX_DEBRIS), age:new Float32Array(MAX_DEBRIS),
    vie:new Float32Array(MAX_DEBRIS), sol:new Float32Array(MAX_DEBRIS), chaud:new Uint8Array(MAX_DEBRIS),
    coul:new Float32Array(MAX_DEBRIS*3), prochain:0, actifs:0};
  let meshDebris = null;
  const PAL_VEHICULE = ['#3a3834', '#5a5850', '#706d62', '#4a453c', '#80745c'].map(lin);
  const PAL_BETON = ['#9b9488', '#b9b2a4', '#7d776d', '#5e5a54', '#8a8f94'].map(lin);
  const PAL_TERRE = ['#c2a678', '#b0946a', '#d2bc92', '#9a8058'].map(lin);   // mottes de sable : proches du sol pour ne pas faire de « cailloux noirs »
  const factice = new THREE.Object3D(), couleurTmp = new THREE.Color();

  function creerDebris(){
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({color:'#ffffff', roughness:0.9, metalness:0.0, flatShading:true});
    meshDebris = new THREE.InstancedMesh(geo, mat, MAX_DEBRIS);
    meshDebris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for(let i=0;i<MAX_DEBRIS;i++) meshDebris.setColorAt(i, couleurTmp.setRGB(1, 1, 1));   // crée instanceColor avant le 1er rendu
    meshDebris.count = 0; meshDebris.castShadow = true; meshDebris.frustumCulled = false; meshDebris.visible = false;
    groupe.add(meshDebris);
  }

  function lancerDebris(x, y, z, n, vitesse, palette, ech, partChaude){
    for(let k=0;k<n;k++){
      const i = DB.prochain; DB.prochain = (i + 1) % MAX_DEBRIS;
      const i3 = i*3, a = Math.random()*6.2832, h = vitesse*alea(0.25, 1);
      DB.pos[i3] = x + Math.cos(a)*ech; DB.pos[i3+1] = y; DB.pos[i3+2] = z + Math.sin(a)*ech;
      DB.vel[i3] = Math.cos(a)*h; DB.vel[i3+1] = vitesse*alea(0.5, 1.3); DB.vel[i3+2] = Math.sin(a)*h;
      for(let j=0;j<3;j++){ DB.rot[i3+j] = Math.random()*6.28; DB.vrot[i3+j] = alea(-12, 12); }
      DB.ech[i] = ech*alea(0.45, 1.25); DB.age[i] = 0; DB.vie[i] = alea(2.2, 3.6);
      DB.sol[i] = solCourant; DB.chaud[i] = Math.random() < (partChaude || 0) ? 1 : 0;
      const c = palette[(Math.random()*palette.length)|0];
      DB.coul[i3] = c[0]; DB.coul[i3+1] = c[1]; DB.coul[i3+2] = c[2];
    }
  }

  function majDebris(dt){
    let n = 0;
    for(let i=0;i<MAX_DEBRIS;i++){
      if(DB.vie[i] <= 0) continue;
      const i3 = i*3;
      if(dt > 0){
        DB.age[i] += dt;
        if(DB.age[i] >= DB.vie[i]){ DB.vie[i] = 0; continue; }
        DB.vel[i3+1] += GRAVITE*dt;
        DB.pos[i3] += DB.vel[i3]*dt; DB.pos[i3+1] += DB.vel[i3+1]*dt; DB.pos[i3+2] += DB.vel[i3+2]*dt;
        const bas = DB.sol[i] + DB.ech[i]*0.4;
        if(DB.pos[i3+1] < bas){
          DB.pos[i3+1] = bas;
          if(DB.vel[i3+1] < -25){
            DB.vel[i3+1] *= -0.32; DB.vel[i3] *= 0.55; DB.vel[i3+2] *= 0.55;
            for(let j=0;j<3;j++) DB.vrot[i3+j] *= 0.5;
          } else { DB.vel[i3] = DB.vel[i3+1] = DB.vel[i3+2] = 0; for(let j=0;j<3;j++) DB.vrot[i3+j] = 0; DB.chaud[i] = 0; }
        }
        for(let j=0;j<3;j++) DB.rot[i3+j] += DB.vrot[i3+j]*dt;
        // Débris en feu : traînée de fumée tant qu'ils volent.
        if(DB.chaud[i] && Math.random() < dt*22*Q.dens){
          solCourant = DB.sol[i];
          emettre(G.fumeeNoire, DB.pos[i3], DB.pos[i3+1], DB.pos[i3+2], 0, 4, 0, 5 + DB.ech[i]*1.2, 0.45);
          if(Math.random() < 0.5) emettre(G.feu, DB.pos[i3], DB.pos[i3+1], DB.pos[i3+2], 0, 0, 0, 4 + DB.ech[i], 0.5);
        }
      }
      const reste = DB.vie[i] - DB.age[i], s = DB.ech[i] * Math.min(1, reste / 0.6);
      factice.position.set(DB.pos[i3], DB.pos[i3+1], DB.pos[i3+2]);
      factice.rotation.set(DB.rot[i3], DB.rot[i3+1], DB.rot[i3+2]);
      factice.scale.set(s, s*0.55, s*0.8);
      factice.updateMatrix();
      meshDebris.setMatrixAt(n, factice.matrix);
      meshDebris.setColorAt(n, couleurTmp.setRGB(DB.coul[i3], DB.coul[i3+1], DB.coul[i3+2]));
      n++;
    }
    DB.actifs = n;
    meshDebris.count = n; meshDebris.visible = n > 0;      // invisible = aucun appel de dessin (ni ombre)
    if(n > 0){ meshDebris.instanceMatrix.needsUpdate = true; meshDebris.instanceColor.needsUpdate = true; }
  }

  // =====================================================================
  //  LUMIÈRES RECYCLÉES (toujours présentes dans la scène, intensité 0 au repos :
  //  ajouter / retirer des lumières forcerait la recompilation de tous les shaders)
  // =====================================================================
  const lumieres = [];
  const COUL_FEU = new THREE.Color('#ffa448'), COUL_TIR = new THREE.Color('#ffc070');
  const COUL_BOMBE = new THREE.Color('#ffb868'), COUL_PLASMA = new THREE.Color('#7df9d0');
  function creerLumieres(){
    lumieres.length = 0;
    for(let i=0;i<NB_LUMIERES;i++){
      const L = new THREE.PointLight('#ffa040', 0, 100, 2);
      L.castShadow = false;
      groupe.add(L);
      lumieres.push({L, age:0, vie:0, i0:0, prio:0});
    }
  }
  function flashLumiere(x, y, z, couleur, intensite, portee, vie, prio){
    if(!(nombre(x) && nombre(y) && nombre(z))) return;      // une lumière mal placée corromprait l'éclairage de toute la scène
    let choix = null, pire = Infinity;
    for(const l of lumieres){
      const restant = l.vie - l.age;
      if(restant <= 0){ choix = l; break; }
      const valeur = l.prio * restant;
      if(valeur < pire){ pire = valeur; choix = l; }
    }
    if(!choix || (choix.vie - choix.age > 0 && choix.prio > prio)) return;
    choix.L.position.set(x, y, z); choix.L.color.copy(couleur); choix.L.distance = portee;
    choix.age = 0; choix.vie = vie; choix.i0 = intensite; choix.prio = prio;
    choix.L.intensity = intensite;
  }
  function majLumieres(dt){
    for(const l of lumieres){
      if(l.vie <= 0){ l.L.intensity = 0; continue; }
      l.age += dt;
      const k = l.age / l.vie;
      if(k >= 1){ l.vie = 0; l.L.intensity = 0; continue; }
      l.L.intensity = l.i0 * (1 - k)*(1 - k);
    }
  }

  // =====================================================================
  //  DÉCALQUES AU SOL (onde de choc, retour d'ordre, marqueur de pouvoir)
  //  et faisceau vertical. Un quadrilatère + un shader par élément.
  // =====================================================================
  const QUAD_V = `
    varying vec2 vUv;
    ${BRUME_V}
    void main(){
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      ${BRUME_V_MAIN}
    }`;
  // Onde de choc : front net qui s'élargit, liseré clair à l'avant, traîne de poussière derrière.
  const ONDE_F = `
    uniform vec3 uCouleur; uniform float uK; uniform float uAlpha;
    varying vec2 vUv;
    ${BRUME_F}
    void main(){
      vec2 p = vUv*2.0 - 1.0; float d = length(p);
      float ke = 1.0 - (1.0 - uK)*(1.0 - uK);
      float rr = mix(0.10, 0.96, ke);
      float w = mix(0.26, 0.10, uK);                       // largeur de la traîne derrière le front
      float x = d - rr;                                    // > 0 : devant le front
      float traine = smoothstep(-w, 0.0, x) * (1.0 - smoothstep(0.0, 0.03, x));
      float lisere = 1.0 - smoothstep(0.0, 0.024, abs(x));
      float voile = (1.0 - smoothstep(0.0, rr, d)) * 0.18 * (1.0 - uK);
      float a = (traine*0.6 + lisere*0.55 + voile) * pow(1.0 - uK, 1.3) * uAlpha;
      if(a < 0.003) discard;
      vec3 col = uCouleur * (1.0 + lisere*0.3);
      #ifdef USE_FOG
        col = mix(col, fogColor, facteurBrume());
      #endif
      gl_FragColor = linearToOutputTexel(vec4(col, a));
    }`;
  // Retour d'ordre : anneau qui se resserre + quatre chevrons qui convergent.
  const ORDRE_F = `
    uniform vec3 uCouleur; uniform float uK;
    varying vec2 vUv;
    ${BRUME_F}
    void main(){
      vec2 p = (vUv*2.0 - 1.0) * 1.25; float d = length(p);
      float ke = 1.0 - pow(1.0 - uK, 3.0);
      float rr = mix(1.0, 0.32, ke);
      float lw = 0.075;
      float anneau = smoothstep(lw, lw*0.4, abs(d - rr));
      float ombreA = smoothstep(lw*2.6, lw, abs(d - rr));
      vec2 q = abs(p);
      float u = (q.x + q.y)*0.70711, v = abs(q.x - q.y)*0.70711;
      float cr = mix(1.22, 0.5, ke);
      float dd = abs((u - cr) - v*0.95) * 0.72;
      float bras = step(v, 0.24) * step(cr - 0.05, u);
      float chevron = smoothstep(0.07, 0.035, dd) * bras;
      float ombreC = smoothstep(0.15, 0.06, dd) * bras;
      float point = smoothstep(0.1, 0.06, d) * step(0.35, uK);
      float trait = max(max(anneau, chevron), point);
      float ombre = max(ombreA, ombreC);
      float fondu = (1.0 - smoothstep(0.65, 1.0, uK)) * smoothstep(0.0, 0.08, uK);
      float a = max(trait, ombre*0.38) * fondu;
      if(a < 0.003) discard;
      vec3 col = mix(vec3(0.02, 0.03, 0.02), mix(uCouleur, vec3(1.0), 0.25), trait);
      #ifdef USE_FOG
        col = mix(col, fogColor, facteurBrume());
      #endif
      gl_FragColor = linearToOutputTexel(vec4(col, a));
    }`;
  // Marqueur de pouvoir : cercle pulsant, segments en rotation, graduations, réticule,
  // onde de balayage ; uStyle : 0 frappe, 1 essaim (balayage radar), 2 marteau (hachures).
  const MARQ_F = `
    uniform vec3 uCouleur; uniform float uK; uniform float uT; uniform float uAlpha; uniform float uR; uniform float uStyle; uniform float uEpais;
    varying vec2 vUv;
    ${BRUME_F}
    float ligne(float x, float c, float w){ return smoothstep(w, w*0.35, abs(x - c)); }
    void main(){
      vec2 p = (vUv*2.0 - 1.0) * 1.3;
      float d = length(p);
      float ang = atan(p.y, p.x) / 6.28318 + 0.5;
      float lw = uEpais / uR;            // épaisseur des traits en unités monde, élargie quand on dézoome
      float vitesse = 0.12 + uK*0.9;
      float pouls = 0.65 + 0.35*sin(uT*(5.0 + uK*14.0));
      // Cercle principal et son ombre portée (lisibilité sur sable clair)
      float cercle = ligne(d, 1.0, lw*1.5);
      float ombre = ligne(d, 1.0, lw*4.0);
      // Segments en rotation (anneau extérieur)
      float seg = step(0.42, fract(ang*6.0 + uT*vitesse));
      float anneauSeg = ligne(d, 1.13, lw*1.6) * seg;
      ombre = max(ombre, ligne(d, 1.13, lw*3.5) * seg);
      // Graduations contrarotatives
      float grad = step(0.72, fract(ang*48.0 - uT*0.25)) * smoothstep(0.86, 0.87, d) * smoothstep(0.94, 0.93, d);
      // Onde de balayage qui converge vers le centre
      float wr = 1.0 - fract(uT*(0.45 + uK*1.4));
      float onde = ligne(d, wr, lw*2.5) * wr * 0.7;
      // Réticule
      float croix = (ligne(p.x, 0.0, lw) * step(abs(p.y), 0.78) + ligne(p.y, 0.0, lw) * step(abs(p.x), 0.78))
                    * step(0.16, d);
      float centre = ligne(d, 0.1, lw) + smoothstep(0.05, 0.02, d) * pouls;
      float encoches = (ligne(p.x, 0.0, lw*1.4) + ligne(p.y, 0.0, lw*1.4)) * step(0.92, d) * step(d, 1.24);
      // Remplissage
      float dedans = smoothstep(1.0, 0.98, d);
      float remp = dedans * (0.06 + 0.2*uK*uK);
      if(uStyle > 0.5 && uStyle < 1.5){
        float bal = fract(ang - uT*0.55);
        remp += dedans * smoothstep(0.82, 1.0, bal) * 0.35;
      } else if(uStyle > 1.5){
        remp += dedans * step(0.5, fract((p.x + p.y)*3.2 + uT*0.6)) * (0.06 + 0.12*uK);
      }
      float traits = clamp(cercle*pouls + anneauSeg + grad*0.8 + onde + croix*0.85 + centre + encoches, 0.0, 1.0);
      float inten = 0.6 + 0.4*uK;
      float a = max(traits * inten, max(remp, ombre*0.35*(1.0 - traits))) * uAlpha;
      if(a < 0.003) discard;
      vec3 col = mix(vec3(0.03), mix(uCouleur, vec3(1.0), traits*0.35*uK + cercle*0.2), max(traits, remp*2.5));
      #ifdef USE_FOG
        col = mix(col, fogColor, facteurBrume());
      #endif
      gl_FragColor = linearToOutputTexel(vec4(col, a));
    }`;
  // Faisceau vertical (cylindre ouvert, additif)
  const FAISCEAU_F = `
    uniform vec3 uCouleur; uniform float uK; uniform float uT; uniform float uAlpha;
    varying vec2 vUv;
    ${BRUME_F}
    void main(){
      float v = vUv.y;
      float bandes = 0.7 + 0.3*sin(v*60.0 - uT*14.0);
      float a = pow(1.0 - v, 2.2) * (0.18 + 0.5*uK*uK) * bandes * uAlpha;
      vec3 col = (uCouleur * 0.9 + vec3(0.25)*uK) * a;
      col *= (1.0 - facteurBrume());
      gl_FragColor = linearToOutputTexel(vec4(col, a));
    }`;

  const ondes = [], ordres = [], marqueurs = [];
  let geoQuad = null, geoFaisceau = null;
  const C_ONDE_CLAIRE = lin('#fff0d0'), C_ONDE_SABLE = lin('#e6d2ac'), C_ONDE_EAU = lin('#f4fbff'), C_ONDE_PLASMA = lin('#a8ffe6');
  let clarteScene = 1;         // 1 en plein jour ; baisse quand la scène s'assombrit (les décalques clairs suivent)

  function matDecal(frag, extra, additif){
    return new THREE.ShaderMaterial({
      uniforms: uniformes(Object.assign({uCouleur:{value:new THREE.Color()}, uK:{value:0}, uAlpha:{value:1}}, extra || {})),
      vertexShader: QUAD_V, fragmentShader: frag, transparent: true, depthWrite: false, fog: true,
      blending: additif ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  }
  function creerDecalques(){
    ondes.length = 0; ordres.length = 0; marqueurs.length = 0;
    geoQuad = new THREE.PlaneGeometry(2, 2); geoQuad.rotateX(-Math.PI/2);
    geoFaisceau = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true); geoFaisceau.translate(0, 0.5, 0);
    const mOnde = matDecal(ONDE_F), mOrdre = matDecal(ORDRE_F);
    const mMarq = matDecal(MARQ_F, {uT:{value:0}, uR:{value:100}, uStyle:{value:0}, uEpais:{value:2.4}});
    const mFais = matDecal(FAISCEAU_F, {uT:{value:0}}, true);
    mFais.polygonOffset = false;
    for(let i=0;i<MAX_ONDES;i++){
      const m = new THREE.Mesh(geoQuad, mOnde.clone()); m.visible = false; m.renderOrder = 1; m.frustumCulled = false;
      groupe.add(m); ondes.push({m, age:0, vie:0});
    }
    for(let i=0;i<MAX_ORDRES;i++){
      const m = new THREE.Mesh(geoQuad, mOrdre.clone()); m.visible = false; m.renderOrder = 2; m.frustumCulled = false;
      groupe.add(m); ordres.push({m, age:0, vie:0});
    }
    for(let i=0;i<MAX_MARQUEURS;i++){
      const m = new THREE.Mesh(geoQuad, mMarq.clone()); m.visible = false; m.renderOrder = 2; m.frustumCulled = false;
      const f = new THREE.Mesh(geoFaisceau, mFais.clone()); f.visible = false; f.renderOrder = 8; f.frustumCulled = false;
      groupe.add(m); groupe.add(f);
      marqueurs.push({m, f, e:null, vu:false, fondu:0, age:0, x:0, y:0, r:1, style:0, teinte:'bleu', acc:0});
    }
  }
  // Hauteur d'un décalque : au-dessus du point le plus haut de sa zone (le sol n'est pas forcément plat).
  function hauteurDecal(x, y, r){
    return Math.max(sol(x, y), sol(x + r, y), sol(x - r, y), sol(x, y + r), sol(x, y - r)) + 1.2;
  }
  // c : triplet linéaire (voir C_ONDE_*).
  function ajouterOnde(x, y, rayon, c, vie, alpha){
    let s = ondes[0];
    for(const o of ondes){ if(o.vie <= 0){ s = o; break; } if(o.age/o.vie > s.age/s.vie) s = o; }
    s.age = 0; s.vie = vie; s.m.visible = true;
    s.m.position.set(x, hauteurDecal(x, y, rayon*0.5) + Math.random()*0.3, y);
    s.m.scale.setScalar(rayon);
    s.m.material.uniforms.uCouleur.value.setRGB(c[0]*clarteScene, c[1]*clarteScene, c[2]*clarteScene);
    s.m.material.uniforms.uAlpha.value = alpha;
    s.m.material.uniforms.uK.value = 0;
  }
  function ajouterOrdre(x, y, hex){
    if(!(nombre(x) && nombre(y))) return;
    let s = ordres[0];
    for(const o of ordres){ if(o.vie <= 0){ s = o; break; } if(o.age/o.vie > s.age/s.vie) s = o; }
    s.age = 0; s.vie = 0.55; s.m.visible = true;
    s.m.position.set(x, hauteurDecal(x, y, 10) + 0.4, y);
    s.m.scale.setScalar(15 * Math.max(1, (R3D.vue ? R3D.vue.distance : 820) / 900));   // reste lisible dézoomé
    const c = couleurLin(hex || '#7dff8a');
    s.m.material.uniforms.uCouleur.value.setRGB(c[0], c[1], c[2]);
    s.m.material.uniforms.uK.value = 0;
  }
  function majListeDecal(liste, dt){
    for(const o of liste){
      if(o.vie <= 0) continue;
      o.age += dt;
      if(o.age >= o.vie){ o.vie = 0; o.m.visible = false; continue; }
      o.m.material.uniforms.uK.value = o.age / o.vie;
    }
  }
  // (deux appels plutôt qu'un tableau [ondes, ordres] recréé à chaque image)
  function majOndesOrdres(dt){ majListeDecal(ondes, dt); majListeDecal(ordres, dt); }

  // ----- Marqueurs de pouvoir : liés à l'objet du jeu tant qu'il existe, puis fondu rapide -----
  const STYLE = {frappe:0, essaim:1, marteau:2};
  function marqueurDe(e){
    for(const s of marqueurs) if(s.e === e) return s;
    let s = null;
    for(const c of marqueurs) if(!c.e && c.fondu <= 0){ s = c; break; }
    if(!s){ s = marqueurs[0]; for(const c of marqueurs) if(!c.e && c.fondu < s.fondu) s = c; }
    s.e = e; s.age = 0; s.fondu = 1; s.x = e.x; s.y = e.y; s.r = e.r > 0 ? e.r : 60; s.acc = 0;
    s.style = STYLE[e.pouvoir] === 0 || STYLE[e.pouvoir] === 1 || STYLE[e.pouvoir] === 2 ? STYLE[e.pouvoir] : 0;
    s.teinte = teinte(e.couleur);
    const H = hauteurDecal(e.x, e.y, s.r);
    s.m.position.set(e.x, H, e.y); s.m.scale.setScalar(s.r*1.3); s.m.visible = true;
    s.f.position.set(e.x, H - 1, e.y); s.f.visible = true;
    const U = s.m.material.uniforms, F = s.f.material.uniforms;
    const c = couleurLin(e.couleur || '#ffd27a');
    U.uCouleur.value.setRGB(c[0], c[1], c[2]); U.uR.value = s.r*1.3; U.uStyle.value = s.style;
    F.uCouleur.value.copy(U.uCouleur.value);
    return s;
  }
  function majMarqueurs(dt){
    for(const s of marqueurs){
      if(!s.e && s.fondu <= 0) continue;
      if(s.e && !s.vu) s.e = null;           // l'effet a disparu du jeu : fondu de sortie
      s.vu = false;
      if(!s.e){ s.fondu -= dt*4; if(s.fondu <= 0){ s.m.visible = s.f.visible = false; continue; } }
      s.age += dt;
      const k = s.e && s.e.max > 0 ? Math.max(0, Math.min(1, 1 - s.e.vie / s.e.max)) : 1;
      const apparition = Math.min(1, s.age / 0.25);
      const U = s.m.material.uniforms, F = s.f.material.uniforms;
      U.uK.value = k; U.uT.value = horloge; U.uAlpha.value = apparition * Math.max(0, s.fondu);
      U.uEpais.value = Math.max(2.4, (R3D.vue ? R3D.vue.distance : 820)*0.0042);
      F.uK.value = k; F.uT.value = horloge; F.uAlpha.value = U.uAlpha.value;
      const rf = (s.style === 0 ? 1.2 : 2) + k*k*(s.style === 0 ? 3 : 5);
      s.f.scale.set(rf, 260 + 260*apparition, rf);
      // Particules d'accompagnement : étincelles qui montent du cercle, fumigène de marquage (marteau).
      if(dt > 0 && s.e){
        s.acc += dt * (10 + 30*k) * Q.dens;
        const H = s.m.position.y;
        solCourant = H;
        while(s.acc >= 1){
          s.acc -= 1;
          const a = Math.random()*6.2832;
          emettre(s.teinte === 'bleu' ? G.scintBleu : G.scintRouge, s.x + Math.cos(a)*s.r, H + 2, s.y + Math.sin(a)*s.r,
            0, alea(20, 50), 0, alea(4, 7));
        }
        if(s.style === 2 && Math.random() < dt*14)
          emettre(s.teinte === 'bleu' ? G.fumigeneBleu : G.fumigeneRouge, s.x + alea(-3, 3), H + 3, s.y + alea(-3, 3), alea(-6, 6), alea(20, 34), alea(-6, 6), alea(14, 20));
      }
    }
  }

  // =====================================================================
  //  PROJECTILES DU MOTEUR ET MISSILE DE FRAPPE
  //  (InstancedMesh, géométries fusionnées à couleurs de sommets)
  //  Genres : roquette d'artillerie (champ genre absent), missile air-air,
  //  bombe guidée, tir de plasma. Tout autre genre est ignoré.
  // =====================================================================
  const ROQ = 0, AIR = 1, BOM = 2, PLA = 3;
  const DEPART_SOL = [0, 9, 9, 13];           // hauteur de départ par défaut d'un tireur terrestre, par genre
  let meshRoquettes = null, meshMissilesAir = null, meshBombes = null, meshMissiles = null;
  const etats = new Map();            // objet projectile du moteur -> état visuel
  const libres = [];                  // états recyclés (pas d'objet créé par tir une fois la réserve constituée)
  const missiles = new Map();         // objet effet 'missile' -> état visuel
  const vTmp = new THREE.Vector3(), vDir = new THREE.Vector3(), vAux = new THREE.Vector3();
  const qTmp = new THREE.Quaternion(), axeX = new THREE.Vector3(1, 0, 0);
  const mTmp = new THREE.Matrix4(), unite = new THREE.Vector3(1, 1, 1);

  function geoProjectile(L, R, couleurs){
    const rotZ = M4().makeRotationZ(-Math.PI/2);
    const parties = [
      {geo:new THREE.CylinderGeometry(R, R, L, 8), c:couleurs.corps, m:rotZ.clone()},
      {geo:new THREE.ConeGeometry(R, L*0.32, 8), c:couleurs.nez, m:M4().makeTranslation(L*0.5 + L*0.16, 0, 0).multiply(rotZ)},
      {geo:new THREE.CylinderGeometry(R*1.02, R*1.02, L*0.1, 8), c:couleurs.bande, m:M4().makeTranslation(L*0.22, 0, 0).multiply(rotZ)},
      {geo:new THREE.CylinderGeometry(R*0.7, R*0.85, L*0.08, 8), c:'#1e1e1e', m:M4().makeTranslation(-L*0.54, 0, 0).multiply(rotZ)},
      {geo:new THREE.BoxGeometry(L*0.22, R*3.6, R*0.25), c:couleurs.ailettes, m:M4().makeTranslation(-L*0.38, 0, 0)},
      {geo:new THREE.BoxGeometry(L*0.22, R*0.25, R*3.6), c:couleurs.ailettes, m:M4().makeTranslation(-L*0.38, 0, 0)},
    ];
    return fusionner(parties);
  }
  // Missile air-air : fuseau fin et clair, autodirecteur sombre, empennage en croix, gouvernes à l'avant.
  function geoMissileAir(){
    const L = 11, R = 0.62, rotZ = M4().makeRotationZ(-Math.PI/2);
    return fusionner([
      {geo:new THREE.CylinderGeometry(R, R, L, 8), c:'#e9ebee', m:rotZ.clone()},
      {geo:new THREE.ConeGeometry(R, L*0.2, 8), c:'#4a4e55', m:M4().makeTranslation(L*0.6, 0, 0).multiply(rotZ)},
      {geo:new THREE.CylinderGeometry(R*1.05, R*1.05, L*0.06, 8), c:'#8d949c', m:M4().makeTranslation(L*0.16, 0, 0).multiply(rotZ)},
      {geo:new THREE.CylinderGeometry(R*0.75, R*0.9, L*0.05, 8), c:'#1e1e1e', m:M4().makeTranslation(-L*0.525, 0, 0).multiply(rotZ)},
      {geo:new THREE.BoxGeometry(L*0.16, R*5.6, R*0.22), c:'#9aa1a8', m:M4().makeTranslation(-L*0.4, 0, 0)},
      {geo:new THREE.BoxGeometry(L*0.16, R*0.22, R*5.6), c:'#9aa1a8', m:M4().makeTranslation(-L*0.4, 0, 0)},
      {geo:new THREE.BoxGeometry(L*0.09, R*3.6, R*0.2), c:'#9aa1a8', m:M4().makeTranslation(L*0.3, 0, 0)},
      {geo:new THREE.BoxGeometry(L*0.09, R*0.2, R*3.6), c:'#9aa1a8', m:M4().makeTranslation(L*0.3, 0, 0)},
    ]);
  }
  // Bombe guidée : corps trapu kaki, ogive, bande jaune de munition, cône arrière et empennage en X.
  function geoBombe(){
    const L = 13, R = 1.8, rotZ = M4().makeRotationZ(-Math.PI/2), rotX = M4().makeRotationX(Math.PI/4);
    return fusionner([
      {geo:new THREE.CylinderGeometry(R, R, L*0.46, 10), c:'#565d50', m:rotZ.clone()},
      {geo:new THREE.ConeGeometry(R, L*0.26, 10), c:'#454b41', m:M4().makeTranslation(L*0.36, 0, 0).multiply(rotZ)},
      {geo:new THREE.CylinderGeometry(R*1.03, R*1.03, L*0.05, 10), c:'#d0a82e', m:M4().makeTranslation(L*0.15, 0, 0).multiply(rotZ)},
      {geo:new THREE.CylinderGeometry(R, R*0.42, L*0.28, 10), c:'#4c5247', m:M4().makeTranslation(-L*0.37, 0, 0).multiply(rotZ)},
      {geo:new THREE.BoxGeometry(L*0.2, R*3.4, R*0.2), c:'#3c4139', m:M4().makeTranslation(-L*0.44, 0, 0).multiply(rotX)},
      {geo:new THREE.BoxGeometry(L*0.2, R*0.2, R*3.4), c:'#3c4139', m:M4().makeTranslation(-L*0.44, 0, 0).multiply(rotX)},
      {geo:new THREE.BoxGeometry(L*0.1, R*2.6, R*0.16), c:'#3c4139', m:M4().makeTranslation(L*0.2, 0, 0)},
    ]);
  }
  function instances(geo, mat, max, ombre){
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.castShadow = !!ombre; m.frustumCulled = false; m.visible = false;
    groupe.add(m);
    return m;
  }
  function creerProjectiles(){
    const mat = new THREE.MeshStandardMaterial({vertexColors:true, roughness:0.45, metalness:0.35});
    // Roquette d'artillerie (proportions exagérées pour la lisibilité)
    meshRoquettes = instances(geoProjectile(12, 1.15, {corps:'#7c7a64', nez:'#c4402c', bande:'#c4402c', ailettes:'#45443a'}), mat, MAX_ROQUETTES, true);
    meshMissilesAir = instances(geoMissileAir(), mat, MAX_MISSILES_AIR, false);
    meshBombes = instances(geoBombe(), mat, MAX_BOMBES, true);       // l'ombre qui converge vers le point d'impact annonce la chute
    // Missile de frappe de précision
    meshMissiles = instances(geoProjectile(24, 2.0, {corps:'#e6eaee', nez:'#bfc8d0', bande:'#3fa7ff', ailettes:'#56636e'}), mat, MAX_MISSILES, true);
  }
  function finInstances(m, n){ m.count = n; m.visible = n > 0; if(n > 0) m.instanceMatrix.needsUpdate = true; }

  // ----- Lecture défensive des objets du moteur -----
  function genreDe(p){
    const g = p.genre;
    if(g === undefined || g === null || g === 'roquette') return ROQ;
    if(g === 'missileAir') return AIR;
    if(g === 'bombe') return BOM;
    if(g === 'plasma') return PLA;
    return -1;                                    // genre inconnu : ignoré
  }
  // Hauteur d'une entité au-dessus du sol : son champ alt, sinon l'altitude de vol par défaut ; -1 si terrestre.
  function altitudeDe(e){
    if(!e || typeof e !== 'object') return -1;
    if(nombre(e.alt)) return e.alt < 0 ? 0 : e.alt;
    const d = e.def;
    if(d && d.aerien) return nombre(d.alt) && d.alt > 0 ? d.alt : HAUT_VOL;
    return -1;
  }
  // Hauteur du point visé sur une entité.
  function hauteurCible(c){
    const a = altitudeDe(c);
    if(a >= 0) return a > 6 ? a : 6;
    return c.est === 'batiment' ? 18 : 9;
  }
  // Entité vivante la plus proche d'un point (liste « ents » du moteur, si elle existe).
  function entiteProche(x, y, rayon, aerienSeul, campExclu){
    let liste = null;
    try { liste = typeof ents !== 'undefined' ? ents : null; } catch(err){ liste = null; }
    if(!liste || typeof liste.length !== 'number') return null;
    let best = null, bd = rayon;
    for(let i=0;i<liste.length;i++){
      const e = liste[i];
      if(!e || e.mort || !nombre(e.x) || !nombre(e.y)) continue;
      if(campExclu !== undefined && e.camp === campExclu) continue;
      if(aerienSeul && !(e.def && e.def.aerien)) continue;
      const d = Math.hypot(e.x - x, e.y - y) - (e.rayon > 0 ? e.rayon*0.8 : 0);
      if(d < bd){ bd = d; best = e; }
    }
    return best;
  }

  function nouvelEtat(p){
    const st = libres.pop() || {vu:0, genre:-1, parti:false, semis:false, acc:0, H0:0, H1:0, ha:0, sol1:0, bosse:0, arc:0,
      chute:false, suivi:false, ex:0, ey:0, qx:0, qy:0, qz:0, cible:null, ech:1};
    st.parti = false; st.semis = false; st.acc = 0; st.cible = null; st.suivi = false; st.ech = 1; st.chute = false;
    let genre = genreDe(p);
    if(!(nombre(p.sx) && nombre(p.sy) && nombre(p.tx) && nombre(p.ty))) genre = -1;
    st.genre = genre;
    if(genre < 0) return st;
    // Départ : hauteur donnée par le moteur (h1), sinon altitude du tireur, sinon hauteur d'un tireur au sol.
    const altTireur = altitudeDe(p.auteur);
    const enVol = nombre(p.h1) ? p.h1 > 20 : altTireur > 6;
    const hd = nombre(p.h1) ? Math.max(0, p.h1) : altTireur > 6 ? altTireur - 3 : DEPART_SOL[genre];
    st.H0 = sol(p.sx, p.sy) + hd;
    st.bosse = genre === ROQ && !enVol ? 10 : 0;          // la roquette d'artillerie sort de son tube au-dessus du véhicule
    st.arc = enVol ? 0.05 : 0.22;                         // cloche de la trajectoire (tir en l'air : presque tendu)
    // Arrivée : hauteur donnée par le moteur (h2), sinon celle de la cible, sinon le sol.
    st.ex = p.tx; st.ey = p.ty; st.sol1 = sol(p.tx, p.ty);
    let ha = nombre(p.h2) ? Math.max(0, p.h2) : 0;
    if(genre === AIR || genre === PLA){
      let c = p.cible;
      if(c && typeof c === 'object' && nombre(c.x) && nombre(c.y)) st.suivi = genre === AIR;
      else c = entiteProche(p.tx, p.ty, genre === AIR ? 70 : 45, genre === AIR, p.camp);
      st.cible = c || null;
      if(!nombre(p.h2)) ha = c ? hauteurCible(c) : genre === AIR ? (hd > 30 ? hd : HAUT_VOL) : 5;
    }
    st.ha = ha;
    st.H1 = st.sol1 + ha;
    st.chute = genre === BOM && st.H0 - st.H1 > 20;
    if(genre === PLA) st.ech = Math.max(0.8, Math.min(2.2, 0.8 + (p.zone > 0 ? p.zone : 0)/70));
    return st;
  }
  // Point d'arrivée courant d'un missile ou d'un tir de plasma : il suit sa cible tant qu'elle vit.
  function viser(p, st){
    const c = st.cible;
    st.ex = p.tx; st.ey = p.ty;
    if(c){
      if(c.mort) st.cible = null;
      else {
        if(st.suivi && nombre(c.x) && nombre(c.y)){ st.ex = c.x; st.ey = c.y; }
        st.ha = hauteurCible(c);
      }
    }
    st.sol1 = sol(st.ex, st.ey);
    st.H1 = st.sol1 + st.ha;
  }
  // Position du projectile à la fraction k de son vol.
  function posProjectile(p, st, k, out){
    const sx = p.sx, sy = p.sy;
    if(st.genre === ROQ){
      const tx = p.tx, ty = p.ty, d = Math.hypot(tx - sx, ty - sy);
      out.set(sx + (tx - sx)*k, st.H0 + (st.H1 - st.H0)*k + st.bosse*(1 - k) + Math.sin(k*Math.PI)*d*st.arc, sy + (ty - sy)*k);
    } else if(st.genre === BOM){
      const tx = p.tx, ty = p.ty;
      // Larguée en vol : elle garde la vitesse de l'avion et tombe de plus en plus vite. Tirée du sol : cloche.
      const y = st.chute ? st.H0 + (st.H1 - st.H0)*k*k : st.H0 + (st.H1 - st.H0)*k + Math.sin(k*Math.PI)*Math.hypot(tx - sx, ty - sy)*0.2;
      out.set(sx + (tx - sx)*k, y, sy + (ty - sy)*k);
    } else {
      // Missile : il accélère ; plasma : vitesse constante.
      const ke = st.genre === AIR ? k*(0.55 + 0.45*k) : k;
      out.set(sx + (st.ex - sx)*ke, st.H0 + (st.H1 - st.H0)*ke, sy + (st.ey - sy)*ke);
    }
    return out;
  }
  // Remplit vTmp (position) et vDir (direction unitaire du déplacement).
  function cadrer(p, st, k){
    posProjectile(p, st, k, vTmp);
    const k2 = k + 0.02 > 1 ? 1 : k + 0.02, k1 = k2 - 0.02;
    posProjectile(p, st, k2, vDir); posProjectile(p, st, k1, vAux);
    vDir.sub(vAux);
    const l = vDir.length();
    if(l > 1e-6) vDir.multiplyScalar(1/l); else vDir.set(1, 0, 0);
  }
  // Traînée continue : une bouffée tous les « pas » de trajet, réparties entre la position précédente
  // et l'actuelle (pas de trous quel que soit le débit d'images ou la vitesse).
  function semer(st, g, qx, qy, qz, pas, ech0, ech1, ecart, maxi, vieMul){
    if(!st.semis){ st.semis = true; st.qx = qx; st.qy = qy; st.qz = qz; }
    const dx = qx - st.qx, dy = qy - st.qy, dz = qz - st.qz, d = Math.hypot(dx, dy, dz);
    st.acc += d / pas;
    let j = 0;
    while(st.acc >= 1 && j < maxi){
      st.acc -= 1; j++;
      const f = d > 0 ? Math.min(1, st.acc * pas / d) : 0;
      emettre(g, qx - dx*f + alea(-ecart, ecart), qy - dy*f + alea(-ecart, ecart), qz - dz*f + alea(-ecart, ecart),
        alea(-3, 3), alea(-2, 3), alea(-3, 3), alea(ech0, ech1), vieMul);
    }
    if(st.acc > 1) st.acc = 1;
    st.qx = qx; st.qy = qy; st.qz = qz;
  }

  let nRoq = 0, nAir = 0, nBom = 0;
  function poserInstance(mesh, n){
    qTmp.setFromUnitVectors(axeX, vDir);
    mTmp.compose(vTmp, qTmp, unite);
    mesh.setMatrixAt(n, mTmp);
  }
  function dessinerRoquette(p, st, k, dt){
    if(nRoq >= MAX_ROQUETTES) return;
    cadrer(p, st, k);
    poserInstance(meshRoquettes, nRoq++);
    if(dt <= 0) return;
    if(!st.parti){
      // Départ : éclair, souffle arrière, poussière soulevée si le tireur est au sol
      st.parti = true;
      const S = sol(p.sx, p.sy);
      solCourant = S;
      emettre(G.flash, p.sx, st.H0 + st.bosse, p.sy, 0, 0, 0, 16);
      if(st.bosse > 0) for(let j=nb(5);j>0;j--) emettre(G.poussiere, p.sx + alea(-8, 8), S + 4, p.sy + alea(-8, 8), alea(-30, 30), alea(5, 20), alea(-30, 30), alea(12, 20));
      for(let j=nb(3);j>0;j--) emettre(G.fumeeGrise, p.sx, st.H0 + st.bosse, p.sy, -vDir.x*40 + alea(-10, 10), alea(5, 15), -vDir.z*40 + alea(-10, 10), alea(12, 18));
    }
    // Propulseur (tuyère à l'arrière) et traînée
    const qx = vTmp.x - vDir.x*7.5, qy = vTmp.y - vDir.y*7.5, qz = vTmp.z - vDir.z*7.5;
    solCourant = st.sol1;
    emettre(G.propulseur, qx, qy, qz, -vDir.x*20, -vDir.y*20, -vDir.z*20, alea(10, 14));
    semer(st, G.trainee, qx, qy, qz, 5*Q.pas, 6.5, 9.5, 1, 16, 1);
  }
  function dessinerMissileAir(p, st, k, dt){
    viser(p, st);
    cadrer(p, st, k);
    if(nAir < MAX_MISSILES_AIR) poserInstance(meshMissilesAir, nAir++);
    // Lueur tenue de la tuyère : cœur blanc chaud, petit halo orangé
    const qx = vTmp.x - vDir.x*6.2, qy = vTmp.y - vDir.y*6.2, qz = vTmp.z - vDir.z*6.2;
    const pouls = 0.9 + 0.1*Math.sin(horloge*70 + st.H0);
    orbe(orbesAdd, qx, qy, qz, 17*pouls, C_TUYERE, 1, 0.42, 3);
    orbe(orbesAdd, qx, qy, qz, 7.5*pouls, C_TUYERE_COEUR, 1.5, 1, 3);
    if(dt <= 0) return;
    solCourant = st.sol1;
    if(!st.parti){
      // Mise à feu sous l'aile : éclair bref et bouffée blanche
      st.parti = true;
      emettre(G.bouche, p.sx, st.H0, p.sy, 0, 0, 0, 11);
      for(let j=nb(2);j>0;j--) emettre(G.traineeAir, p.sx + alea(-2, 2), st.H0 + alea(-1, 1), p.sy + alea(-2, 2), -vDir.x*25 + alea(-6, 6), alea(-4, 4), -vDir.z*25 + alea(-6, 6), alea(7, 9), 0.6);
    }
    emettre(G.propulseur, qx, qy, qz, -vDir.x*30, -vDir.y*30, -vDir.z*30, alea(6, 8.5));
    // Sillage : fuseaux posés dans l'axe du vol tel que la caméra le voit
    rotImposee = Math.atan2(vDir.x*chx + vDir.y*chy + vDir.z*chz, vDir.x*cdx + vDir.y*cdy + vDir.z*cdz);
    semer(st, G.traineeAir, qx, qy, qz, 11*Q.pas, 19, 23, 0.4, 12, Q.vie);
    rotImposee = NaN;
  }
  function dessinerBombe(p, st, k, dt){
    cadrer(p, st, k);
    if(nBom < MAX_BOMBES) poserInstance(meshBombes, nBom++);
    if(dt <= 0) return;
    st.parti = true;
    // Fin filet de vapeur aux empennages, dans l'axe de la chute : rend la trajectoire lisible sans l'alourdir
    solCourant = st.sol1;
    rotImposee = Math.atan2(vDir.x*chx + vDir.y*chy + vDir.z*chz, vDir.x*cdx + vDir.y*cdy + vDir.z*cdz);
    semer(st, G.vapeur, vTmp.x - vDir.x*7, vTmp.y - vDir.y*7, vTmp.z - vDir.z*7, 10*Q.pas, 13, 16, 0.3, 6, 1);
    rotImposee = NaN;
  }
  function dessinerPlasma(p, st, k, dt){
    viser(p, st);
    cadrer(p, st, k);
    const e = st.ech, pouls = 0.88 + 0.12*Math.sin(horloge*46 + st.H0*3.1);
    // Globe turquoise (mélange normal : la teinte tient sur fond clair), halo discret et cœur presque blanc (additifs)
    orbe(orbesNorm, vTmp.x, vTmp.y, vTmp.z, 14*e*pouls, C_PLASMA_GLOBE, 1.5, 0.95, 13);
    orbe(orbesAdd, vTmp.x, vTmp.y, vTmp.z, 26*e*pouls, C_PLASMA, 1, 0.3, 3);
    orbe(orbesAdd, vTmp.x, vTmp.y, vTmp.z, 8*e, C_PLASMA_COEUR, 1.4, 0.9, 3);
    if(dt <= 0) return;
    solCourant = st.sol1;
    if(!st.parti){
      st.parti = true;
      emettre(G.bouchePlasma, p.sx, st.H0, p.sy, 0, 0, 0, 15*e);
      emettre(G.plasmaLueur, p.sx, st.H0, p.sy, 0, 0, 0, 11*e, 0.7);
    }
    // Traîne : fuseaux lumineux posés dans l'axe du tir, qui s'amenuisent
    rotImposee = Math.atan2(vDir.x*chx + vDir.y*chy + vDir.z*chz, vDir.x*cdx + vDir.y*cdy + vDir.z*cdz);
    semer(st, G.plasmaTraine, vTmp.x - vDir.x*5*e, vTmp.y - vDir.y*5*e, vTmp.z - vDir.z*5*e, 7*Q.pas, 17*e, 21*e, 0.3, 12, 1);
    rotImposee = NaN;
  }

  // Première passe de l'image : crée l'état des nouveaux projectiles et repère ceux qui viennent de
  // disparaître (impact). Elle précède la lecture des effets : l'impact d'une bombe, d'un missile ou d'un
  // tir de plasma peut ainsi reprendre à son compte l'explosion générique que le moteur pose au même endroit.
  function suivreProjectiles(projectiles){
    for(let i=0;i<projectiles.length;i++){
      const p = projectiles[i];
      if(!p || typeof p !== 'object') continue;
      let st = etats.get(p);
      if(!st){
        try { st = nouvelEtat(p); } catch(err){ avertir(err, 'projectile'); st = {vu:0, genre:-1, cible:null}; }
        etats.set(p, st);
      }
      st.vu = cycle;
    }
    if(etats.size) etats.forEach(purgerEtat);      // rappel fixe : pas de couple [clé, valeur] alloué par entrée
  }
  function purgerEtat(st, p){
    if(st.vu === cycle) return;
    etats.delete(p);
    if(st.genre > ROQ && (p.fini === true || p.t >= p.duree - 0.15)){
      try { impact(st, p); } catch(err){ avertir(err, 'impact'); }
    }
    st.cible = null;
    if(st.genre >= 0 && libres.length < 96) libres.push(st);
  }
  // Seconde passe : place les modèles, tient les lueurs et sème les traînées.
  function majProjectiles(projectiles, dt){
    nRoq = nAir = nBom = 0;
    for(let i=0;i<projectiles.length;i++){
      const p = projectiles[i];
      const st = p && typeof p === 'object' ? etats.get(p) : null;
      if(!st || st.genre < 0) continue;
      if(!(p.t >= 0)) continue;                    // pas encore parti (salve échelonnée)
      const k = p.duree > 0 ? Math.min(1, p.t / p.duree) : 1;
      try {
        if(st.genre === ROQ) dessinerRoquette(p, st, k, dt);
        else if(st.genre === AIR) dessinerMissileAir(p, st, k, dt);
        else if(st.genre === BOM) dessinerBombe(p, st, k, dt);
        else dessinerPlasma(p, st, k, dt);
      } catch(err){ avertir(err, 'projectile'); st.genre = -1; rotImposee = NaN; }
    }
    finInstances(meshRoquettes, nRoq); finInstances(meshMissilesAir, nAir); finInstances(meshBombes, nBom);
  }

  // ----- Impacts des projectiles -----
  // Le moteur pose une explosion générique (au sol, de taille moyenne) à la fin de chaque projectile.
  // À l'impact, on cherche cette explosion parmi les effets pas encore mis en scène et on la reprend à
  // notre compte : à la bonne altitude pour un missile, en plasma pour un tir d'envahisseur, en grosse
  // explosion avec onde de choc pour une bombe. S'il n'y en a pas, l'impact est mis en scène quand même.
  const EX = {type:'explosion', x:0, y:0, h:0, r:12, grande:false, batiment:false};
  let grosProche = false;
  function absorberExplosions(x, y, x2, y2, rayon){
    grosProche = false;
    const L = effetsCourants;
    let rmax = 0;
    if(!L) return 0;
    for(let i=0;i<L.length;i++){
      const e = L[i];
      if(!e || e.type !== 'explosion' || dejaVus.has(e)) continue;
      const pres = (Math.abs(e.x - x) < rayon && Math.abs(e.y - y) < rayon) || (Math.abs(e.x - x2) < rayon && Math.abs(e.y - y2) < rayon);
      if(!pres) continue;
      const r = e.r > 0 ? e.r : 12;
      if(e.grande || e.batiment || r >= 30){ grosProche = true; continue; }     // mort d'une cible ou grosse explosion : laissée telle quelle
      dejaVus.add(e);
      if(r > rmax) rmax = r;
    }
    return rmax;
  }
  function impact(st, p){
    const x = st.ex, z = st.ey;
    if(!(nombre(x) && nombre(z))) return;
    if(st.genre === BOM){
      absorberExplosions(x, z, p.tx, p.ty, 18);
      if(!grosProche){ EX.x = x; EX.y = z; EX.h = 0; EX.r = 36; EX.grande = true; EX.batiment = false; explosion(EX); }
      supplementBombe(x, z, 36);
    } else if(st.genre === AIR){
      const r = absorberExplosions(x, z, p.tx, p.ty, 18);
      EX.x = x; EX.y = z; EX.h = Math.max(0, st.H1 - sol(x, z)); EX.r = Math.max(13, r); EX.grande = false; EX.batiment = false;
      explosion(EX);
    } else if(st.genre === PLA){
      const r = absorberExplosions(x, z, p.tx, p.ty, 18);
      eclatPlasma(x, st.H1, z, Math.max(11, r)*st.ech);
    }
  }

  // Missile : descend du ciel en diagonale (venant du nord-ouest : il entre par le haut de l'écran) et touche à la fin.
  // Parcours par forEach + rappel fixe (état de l'image dans nMis / dtMis) : aucune allocation par image.
  let nMis = 0, dtMis = 0;
  function majMissiles(dt){
    nMis = 0; dtMis = dt;
    if(missiles.size) missiles.forEach(majUnMissile);
    finInstances(meshMissiles, nMis);
  }
  function majUnMissile(st, e){
    const dt = dtMis;
    st.t += dt;
    const k = Math.min(1, st.t / st.duree);
    if(k >= 1 || nMis >= MAX_MISSILES){ if(k >= 1) missiles.delete(e); return; }
    const ke = Math.pow(k, 1.7);       // accélération en piqué
    vTmp.set(st.sx + (st.ex - st.sx)*ke, st.sy + (st.ey - st.sy)*ke, st.sz + (st.ez - st.sz)*ke);
    vDir.set(st.ex - st.sx, st.ey - st.sy, st.ez - st.sz).normalize();
    qTmp.setFromUnitVectors(axeX, vDir);
    mTmp.compose(vTmp, qTmp, unite);
    meshMissiles.setMatrixAt(nMis++, mTmp);
    if(dt > 0){
      const qx = vTmp.x - vDir.x*14, qy = vTmp.y - vDir.y*14, qz = vTmp.z - vDir.z*14;
      solCourant = st.ey;
      emettre(G.propulseur, qx, qy, qz, -vDir.x*30, -vDir.y*30, -vDir.z*30, alea(16, 22));
      emettre(G.halo, qx, qy, qz, 0, 0, 0, 22, 0.35);
      // Traînée : espacement régulier quel que soit le débit d'images
      const pas = 4*Q.pas;
      st.acc += Math.hypot(vTmp.x - st.px, vTmp.y - st.py, vTmp.z - st.pz) / pas;
      let j = 0;
      while(st.acc >= 1 && j < 30){
        st.acc -= 1; j++;
        const recul = st.acc * pas;      // répartit les bouffées le long du chemin parcouru depuis l'image précédente
        emettre(G.traineeMissile, qx - vDir.x*recul, qy - vDir.y*recul, qz - vDir.z*recul, alea(-4, 4), alea(-2, 4), alea(-4, 4), alea(13, 17));
      }
      if(st.acc > 1) st.acc = 1;
      st.px = vTmp.x; st.py = vTmp.y; st.pz = vTmp.z;
    }
  }
  function nouveauMissile(e){
    if(!(nombre(e.x) && nombre(e.y))) return;
    const H = sol(e.x, e.y);
    const st = {t:0, duree:e.max > 0 ? e.max : e.duree > 0 ? e.duree : 1.2, sx:e.x - 320, sy:H + 680, sz:e.y - 220, ex:e.x, ey:H, ez:e.y, acc:0};
    st.px = st.sx; st.py = st.sy; st.pz = st.sz;
    missiles.set(e, st);
  }

  // =====================================================================
  //  ÉMETTEURS INTERNES (colonnes de fumée qui persistent, panaches)
  //  ET EXPLOSIONS DIFFÉRÉES (chapelet des très grosses explosions)
  // =====================================================================
  const emetteurs = [];
  for(let i=0;i<MAX_EMETTEURS;i++) emetteurs.push({reste:0, duree:1, x:0, y:0, z:0, sol:0, g:null, taux:0, acc:0, ech:10, disp:5, vy:10});
  function emetteur(g, x, y, z, duree, taux, ech, disp, vy){
    let s = null;
    for(const e of emetteurs) if(e.reste <= 0){ s = e; break; }
    if(!s){ s = emetteurs[0]; for(const e of emetteurs) if(e.reste < s.reste) s = e; }
    s.g = g; s.x = x; s.y = y; s.z = z; s.sol = solCourant; s.duree = s.reste = duree; s.taux = taux;
    s.acc = 0; s.ech = ech; s.disp = disp; s.vy = vy;
  }
  function majEmetteurs(dt){
    if(dt <= 0) return;
    for(const e of emetteurs){
      if(e.reste <= 0) continue;
      e.reste -= dt;
      const f = Math.max(0, e.reste / e.duree);           // le débit et la taille faiblissent avec le temps
      e.acc += dt * e.taux * (0.35 + 0.65*f) * Q.dens;
      solCourant = e.sol;
      const feu = e.g === G.feu;
      while(e.acc >= 1){
        e.acc -= 1;
        // répartition resserrée vers le centre (somme de deux tirages) : un foyer cohérent plutôt que des gouttes éparses
        const ox = (alea(-1, 1) + alea(-1, 1))*0.5*e.disp, oz = (alea(-1, 1) + alea(-1, 1))*0.5*e.disp;
        emettre(e.g, e.x + ox, e.y, e.z + oz,
          alea(-4, 4), e.vy*alea(0.7, 1.3), alea(-4, 4), e.ech*alea(0.75, 1.2)*(0.6 + 0.4*f));
        // Foyer : lueur orangée au ras du sol qui lie les flammes entre elles
        if(feu && Math.random() < 0.3) emettre(G.lueurFeu, e.x + ox*0.5, e.y + 1, e.z + oz*0.5, 0, 0, 0, (e.disp*2.6 + e.ech)*(0.5 + 0.5*f));
      }
    }
  }

  const differes = [];
  for(let i=0;i<MAX_DIFFERES;i++) differes.push({t:0, x:0, y:0, h:0, r:0, grande:false});
  const EX2 = {type:'explosion', x:0, y:0, h:0, r:12, grande:false, batiment:false};
  function differer(delai, x, y, h, r, grande){
    for(const d of differes) if(d.t <= 0){ d.t = delai; d.x = x; d.y = y; d.h = h; d.r = r; d.grande = grande; return; }
  }
  // Explosion plus grande que R_MAX (vaisseau, très grand bâtiment) : plutôt que des sprites démesurés,
  // qui coûteraient cher à remplir, un chapelet d'explosions secondaires réparties dans son rayon.
  function chapelet(e, r){
    const n = Math.min(MAX_DIFFERES, Math.round(4 + r/45));
    const h = e.h > 0 ? e.h : 0;
    for(let k=0;k<n;k++){
      const a = Math.random()*6.2832, d = Math.sqrt(Math.random())*r*0.55;
      differer(0.12 + k*0.16 + Math.random()*0.2, e.x + Math.cos(a)*d, e.y + Math.sin(a)*d, Math.max(0, h + alea(-0.08, 0.04)*r), alea(34, 62), k % 2 === 0);
    }
  }
  function majDifferes(dt){
    if(dt <= 0) return;
    for(const d of differes){
      if(d.t <= 0) continue;
      d.t -= dt;
      if(d.t > 0) continue;
      d.t = 0;
      EX2.x = d.x; EX2.y = d.y; EX2.h = d.h; EX2.r = d.r; EX2.grande = d.grande; EX2.batiment = false;
      explosion(EX2);
    }
  }

  // =====================================================================
  //  RECETTES : mise en scène d'un nouvel objet effet du jeu
  // =====================================================================
  function explosion(e){
    const x = e.x, z = e.y;
    if(!(nombre(x) && nombre(z))) return;
    let r = e.r > 0 ? +e.r : 12;
    if(!nombre(r)) r = 12;
    if(r > R_MAX){ chapelet(e, r); r = R_MAX; }
    const s = r / 16;
    // Taille visuelle de la fumée : croît moins vite que r (au-delà de 30, un nuage géant masquerait le champ de bataille)
    const rf = r <= 30 ? r : 30 + (r - 30)*0.5;
    const mer = estMer(x, z);
    const H = sol(x, z);         // déjà borné à la surface de l'eau
    const h = e.h > 0 && nombre(e.h) ? e.h : 0, y = H + h;
    const auSol = h < 6, enAir = h > 30;
    solCourant = H;

    // --- Petite explosion : mort de fantassin (r ≈ 7) : bouffée de poussière, petit éclat ---
    if(r <= 8){
      emettre(G.impact, x, y + 3, z, 0, 0, 0, 12);
      for(let k=nb(5);k>0;k--) emettre(mer ? G.brumeEau : G.poussiere, x + alea(-4, 4), H + 3, z + alea(-4, 4), alea(-18, 18), alea(6, 18), alea(-18, 18), alea(8, 13));
      for(let k=nb(3);k>0;k--){ dirAlea(); emettre(G.etincelle, x, y + 4, z, DX*70, Math.abs(DY)*90 + 20, DZ*70, 2.5); }
      return;
    }

    // --- Éclair : très lumineux et très bref (c'est lui que le post-traitement fait rayonner), puis halo ---
    emettre(G.eclat, x, y + r*0.3, z, 0, 0, 0, rf*3.0);
    emettre(G.flash, x, y + r*0.3, z, 0, 0, 0, rf*2.7);
    emettre(G.halo, x, y + r*0.3, z, 0, 0, 0, rf*4.0);
    flashLumiere(x, y + r*0.8 + 6, z, COUL_FEU, 2.2 + r*0.06, r*8 + 50, 0.24 + s*0.1, r);

    const eau = mer && auSol;
    // --- Fumée sombre qui reste (émise AVANT la boule de feu : la réserve n'est pas triée,
    //     l'ordre d'émission fixe l'ordre d'affichage ; ainsi le feu reste devant sa propre fumée) ---
    const nS = nb(Math.min(24, 3 + r*0.35) * (eau ? 0.3 : 1));
    const vieS = (e.grande ? 1.2 : 0.8) * Q.vie;
    for(let k=0;k<nS;k++){
      dirAlea();
      emettre(k % 3 === 0 ? G.fumeeDense : G.fumeeNoire, x + DX*r*0.5, y + Math.abs(DY)*r*0.4 + 2, z + DZ*r*0.5, DX*r*0.8, alea(8, 22) + Math.abs(DY)*r*0.6, DZ*r*0.8,
        rf*alea(0.9, 1.5), vieS);
    }
    // --- Panache : le cœur chaud de la fumée s'élève en colonne avant de se dissiper ---
    if(r >= 14 && !eau){
      for(let k=nb(Math.min(8, 2 + r*0.12));k>0;k--)
        emettre(G.fumeeDense, x + alea(-0.2, 0.2)*r, y + r*0.3, z + alea(-0.2, 0.2)*r, alea(-6, 6), r*alea(1.6, 3.2), alea(-6, 6), rf*alea(0.8, 1.2), vieS);
    }
    // --- Boule de feu (réduite à la surface de l'eau : la gerbe domine). Trois quarts de matière
    //     incandescente en mélange normal, un quart de flammes additives pour la lueur ---
    const nF = nb(Math.min(34, 6 + r*0.65) * (eau ? 0.3 : 1));
    for(let k=0;k<nF;k++){
      dirAlea();
      // un tiers de la matière reste près du centre : cœur dense, bien plus lumineux que la périphérie
      const v = r*alea(1.6, 4.2)*(k % 3 === 1 ? 0.35 : 1), up = auSol ? Math.abs(DY)*0.8 + 0.25 : DY;
      emettre(k % 4 === 0 ? G.flamme : G.bouleFeu, x + DX*r*0.25, y + (auSol ? r*0.25 : 0) + up*r*0.2, z + DZ*r*0.25, DX*v, up*v, DZ*v, r*alea(0.9, 1.5), 0.85 + s*0.15);
    }
    // --- Étincelles (traits orientés selon leur course) ---
    const nE = nb(Math.min(36, 6 + r*0.7));
    for(let k=0;k<nE;k++){
      dirAlea();
      const v = alea(90, 230)*Math.sqrt(s);
      emettre(G.etincelle, x, y + 2, z, DX*v, (auSol ? Math.abs(DY) + 0.3 : DY)*v, DZ*v, alea(2.5, 4.5) * Math.min(1.6, 0.8 + s*0.3));
    }
    // --- Braises qui retombent lentement ---
    if(r >= 14){
      const nBr = nb(e.grande ? Math.min(24, 6 + r*0.3) : Math.min(8, r*0.25));
      for(let k=0;k<nBr;k++){ dirAlea(); emettre(G.braise, x, y + 4, z, DX*r*1.6, Math.abs(DY)*r*2.5 + 30, DZ*r*1.6, alea(2.5, 4)); }
    }
    // --- Au sol : projection de terre et onde de choc / gerbe d'eau ---
    if(auSol && !mer){
      const nP = nb(Math.min(18, 4 + r*0.3));
      for(let k=0;k<nP;k++){
        const a = Math.random()*6.2832, v = r*alea(1.5, 3.5);
        emettre(G.poussiere, x + Math.cos(a)*r*0.3, H + 3, z + Math.sin(a)*r*0.3, Math.cos(a)*v, alea(5, 25), Math.sin(a)*v, r*alea(0.9, 1.5));
      }
      if(r >= 12 && !e.grande) ajouterOnde(x, z, r*2.5, C_ONDE_CLAIRE, 0.36, 0.42);
    }
    if(mer && auSol){
      const nG = nb(Math.min(60, 16 + r*1.2));
      for(let k=0;k<nG;k++){
        const a = Math.random()*6.2832, rad = alea(0, 0.6);
        emettre(G.eau, x + Math.cos(a)*r*rad*0.5, H + 2, z + Math.sin(a)*r*rad*0.5,
          Math.cos(a)*alea(10, 40)*Math.sqrt(s), alea(150, 300)*Math.sqrt(s), Math.sin(a)*alea(10, 40)*Math.sqrt(s), r*alea(0.6, 1.1));
      }
      for(let k=nb(8);k>0;k--){ const a = Math.random()*6.2832; emettre(G.brumeEau, x + Math.cos(a)*r*0.6, H + 3, z + Math.sin(a)*r*0.6, Math.cos(a)*r*1.5, alea(4, 14), Math.sin(a)*r*1.5, r*alea(1, 1.6)); }
      ajouterOnde(x, z, r*2.6, C_ONDE_EAU, 1.1, 0.75);
    }
    // --- En l'air : anneau de l'éclatement, fumée qui reste suspendue ---
    if(enAir){
      emettre(G.anneauChoc, x, y, z, 0, 0, 0, r*3.4);
      if(e.grande) emetteur(G.fumeeNoire, x, y, z, 1.4, 9, rf*0.7, r*0.3, 5);
    }
    // --- Débris ---
    if(r >= 11 && !mer){
      const nD = Math.min(e.batiment ? 30 : 20, Math.round(r*(e.batiment ? 0.45 : 0.5)));
      const v = alea(120, 180)*Math.sqrt(s), taille = Math.min(4.5, 1 + r*0.07);
      if(e.batiment) lancerDebris(x, y + 2, z, nD, v, PAL_BETON, taille, 0.35);
      else if(e.grande && r < 40){
        // Mort de véhicule ou d'aéronef (r 26–38) : tôles sombres, dont une partie en feu, et un peu de terre
        const nV = enAir ? nD : Math.round(nD*0.6);
        lancerDebris(x, y + 2, z, nV, v, PAL_VEHICULE, taille, enAir ? 0.55 : 0.4);
        if(!enAir) lancerDebris(x, H + 2, z, nD - nV, v*0.8, PAL_TERRE, taille*0.6, 0);
      }
      // Éclatement en l'air : quelques éclats sombres
      else if(enAir) lancerDebris(x, y, z, Math.round(nD*0.4), v, PAL_VEHICULE, taille*0.5, 0.2);
      // Impact au sol (obus, roquette, pouvoir) : mottes de terre plus petites, couleur du sable
      else lancerDebris(x, H + 2, z, nD, v, PAL_TERRE, taille*0.6, e.grande ? 0.15 : 0);
    }
    // --- Grandes explosions près du sol : onde de choc, colonne de fumée et foyer persistants ---
    if(e.grande && !enAir){
      if(!mer) ajouterOnde(x, z, r*3.4, C_ONDE_CLAIRE, 0.6, 0.7);
      if(!eau) emetteur(G.colonne, x, H + rf*0.3, z, (e.batiment ? 9 : 3.5 + s*1.2)*Q.vie, 4 + r*0.08, rf*(e.batiment ? 0.95 : 0.9), r*0.3, 20 + r*0.2);
      if(!mer) emetteur(G.feu, x, H + 2, z, e.batiment ? 6 : 1.6 + s*0.4, 24 + r*0.5, rf*0.38, r*0.35, 12);
    }
    // --- Bâtiment détruit : nuage de poussière massif ---
    if(e.batiment){
      for(let k=nb(40);k>0;k--){
        const a = Math.random()*6.2832, v = r*alea(0.8, 2.6);
        emettre(G.poussiereLourde, x + Math.cos(a)*r*0.5, H + alea(4, r*0.6), z + Math.sin(a)*r*0.5,
          Math.cos(a)*v, alea(4, 30), Math.sin(a)*v, r*alea(1.0, 1.6));
      }
      ajouterOnde(x, z, r*3.8, C_ONDE_SABLE, 1.1, 0.8);
    }
  }

  // Bombe guidée : ce qui s'ajoute à l'explosion elle-même. Éclair en croix, lumière forte, double onde de
  // choc (front rapide et clair, puis anneau de poussière), jupe de poussière chassée au ras du sol, gerbe
  // de terre et de feu projetée à la verticale.
  function supplementBombe(x, z, r){
    const H = sol(x, z), mer = estMer(x, z);
    solCourant = H;
    emettre(G.reflet, x, H + r*0.5, z, 0, 0, 0, r*7);
    emettre(G.eclat, x, H + r*0.4, z, 0, 0, 0, r*4.2);
    flashLumiere(x, H + r + 10, z, COUL_BOMBE, 5.5, r*11 + 80, 0.45, 200);
    if(mer){ ajouterOnde(x, z, r*4.5, C_ONDE_EAU, 1.3, 0.8); return; }
    ajouterOnde(x, z, r*4.6, C_ONDE_CLAIRE, 0.55, 0.75);
    ajouterOnde(x, z, r*3.2, C_ONDE_SABLE, 1.1, 0.65);
    const n = nb(22);
    for(let k=0;k<n;k++){
      const a = k/n*6.2832 + alea(-0.15, 0.15), v = r*alea(3.2, 5.2);
      emettre(G.poussiereOnde, x + Math.cos(a)*r*0.5, H + 3, z + Math.sin(a)*r*0.5, Math.cos(a)*v, alea(2, 10), Math.sin(a)*v, r*alea(0.55, 0.9));
    }
    for(let k=nb(12);k>0;k--) emettre(G.poussiereLourde, x + alea(-0.2, 0.2)*r, H + 4, z + alea(-0.2, 0.2)*r, alea(-12, 12), alea(70, 170), alea(-12, 12), r*alea(0.5, 0.8), 0.7);
    for(let k=nb(8);k>0;k--) emettre(G.bouleFeu, x + alea(-4, 4), H + r*0.3, z + alea(-4, 4), alea(-10, 10), alea(90, 170), alea(-10, 10), r*alea(0.5, 0.8), 1.1);
    for(let k=nb(14);k>0;k--){ dirAlea(); emettre(G.braise, x, H + 6, z, DX*r*2.2, Math.abs(DY)*r*3 + 40, DZ*r*2.2, alea(2.5, 4)); }
    lancerDebris(x, H + 2, z, 14, 190, PAL_TERRE, 2.4, 0.2);
  }

  // Impact d'un tir de plasma : éclair turquoise en croix, anneau, gerbe de scintilles, vapeur pâle.
  function eclatPlasma(x, y, z, r){
    if(!(nombre(x) && nombre(y) && nombre(z))) return;
    const H = sol(x, z), auSol = y - H < 14;
    solCourant = H;
    emettre(G.plasmaLueur, x, y + 2, z, 0, 0, 0, r*1.9);
    emettre(G.plasmaAnneau, x, y + 2, z, 0, 0, 0, r*2.3);
    emettre(G.plasmaEclat, x, y + 2, z, 0, 0, 0, r*2.8);
    emettre(G.plasmaHalo, x, y + 2, z, 0, 0, 0, r*3.2);
    flashLumiere(x, y + 10, z, COUL_PLASMA, 2.4, r*7 + 50, 0.22, r);
    for(let k=nb(Math.min(16, 5 + r*0.5));k>0;k--){
      dirAlea();
      const v = alea(70, 190);
      emettre(G.scintPlasma, x, y + 2, z, DX*v, (auSol ? Math.abs(DY) + 0.2 : DY)*v, DZ*v, alea(2.5, 4));
    }
    for(let k=nb(4);k>0;k--){ dirAlea(); emettre(G.vapeurPlasma, x + DX*4, y + 3, z + DZ*4, DX*14, alea(6, 18), DZ*14, r*alea(0.9, 1.3)); }
    if(auSol && !estMer(x, z)) ajouterOnde(x, z, r*2.2, C_ONDE_PLASMA, 0.4, 0.55);
  }

  function trait(e){
    if(!(nombre(e.x1) && nombre(e.y1) && nombre(e.x2) && nombre(e.y2))) return;
    const H1 = sol(e.x1, e.y1), H2 = sol(e.x2, e.y2);
    const y1 = H1 + (nombre(e.h1) ? e.h1 : 8), y2 = H2 + (nombre(e.h2) ? e.h2 : 8);
    const plasma = e.arme === 'plasma' || e.genre === 'plasma';
    const arme = plasma ? 'plasma' : (e.arme || 'balle');
    const larg = (e.largeur > 0 ? e.largeur : plasma ? 2.2 : 1.5) * (arme === 'obus' ? 1.5 : 1.45);
    const vie = arme === 'obus' || plasma ? 0.16 : arme === 'aa' ? 0.14 : arme === 'drone' ? 0.2 : 0.1;
    const lg = arme === 'obus' ? 90 : plasma ? 70 : arme === 'aa' ? 60 : arme === 'drone' ? 110 : 46;
    ajouterTrait(e.x1, y1, e.y1, e.x2, y2, e.y2, e.couleur || (plasma ? '#7df9d0' : '#fff1a8'), larg, vie, lg);
    solCourant = H2;
    if(arme === 'balle'){
      // Impact : petite étincelle, poussière si au sol
      emettre(G.impact, e.x2, y2, e.y2, 0, 0, 0, 5);
      if(Math.random() < 0.6){ dirAlea(); emettre(G.etincelle, e.x2, y2, e.y2, DX*60, Math.abs(DY)*70 + 10, DZ*60, 2); }
      if(y2 - H2 < 20 && Math.random() < 0.5*Q.dens) emettre(G.poussiere, e.x2 + alea(-3, 3), H2 + 2, e.y2 + alea(-3, 3), alea(-8, 8), alea(4, 10), alea(-8, 8), alea(5, 8), 0.6);
    } else if(arme === 'aa'){
      // Éclatement de la munition antiaérienne : bouffée noire et étincelle
      emettre(G.impact, e.x2, y2, e.y2, 0, 0, 0, 9);
      emettre(G.flak, e.x2 + alea(-4, 4), y2 + alea(-3, 3), e.y2 + alea(-4, 4), 0, 2, 0, alea(9, 13));
    } else if(arme === 'obus'){
      // Fine fumée le long du trajet de l'obus
      for(let k=1;k<=4;k++){ const f = k/5; emettre(G.trainee, e.x1 + (e.x2 - e.x1)*f, y1 + (y2 - y1)*f, e.y1 + (e.y2 - e.y1)*f, 0, 2, 0, 4, 0.5); }
    } else if(plasma){
      // Tir de plasma instantané : petit éclat turquoise au point touché
      emettre(G.plasmaHalo, e.x2, y2, e.y2, 0, 0, 0, 14, 0.7);
      for(let k=nb(3);k>0;k--){ dirAlea(); emettre(G.scintPlasma, e.x2, y2, e.y2, DX*80, Math.abs(DY)*90 + 10, DZ*80, 2.2); }
    }
  }

  function eclair(e){
    if(!(nombre(e.x) && nombre(e.y))) return;
    const H = sol(e.x, e.y), y = H + (nombre(e.h) ? e.h : 8);
    const plasma = e.arme === 'plasma' || e.genre === 'plasma';
    const arme = plasma ? 'plasma' : (e.arme || 'balle');
    solCourant = H;
    const taille = arme === 'obus' ? 26 : arme === 'aa' || plasma ? 13 : arme === 'drone' ? 10 : 8;
    if(plasma){
      emettre(G.bouchePlasma, e.x, y, e.y, 0, 0, 0, taille);
      emettre(G.plasmaHalo, e.x, y, e.y, 0, 0, 0, taille*1.2, 0.5);
      return;
    }
    emettre(arme === 'aa' || arme === 'drone' ? G.boucheAA : G.bouche, e.x, y, e.y, 0, 0, 0, taille);
    emettre(G.haloTir, e.x, y, e.y, 0, 0, 0, taille*1.5);
    if(arme === 'obus'){
      flashLumiere(e.x, y + 6, e.y, COUL_TIR, 1.6, 100, 0.1, 2);
      for(let k=nb(4);k>0;k--) emettre(G.fumeeGrise, e.x + alea(-3, 3), y, e.y + alea(-3, 3), alea(-20, 20), alea(4, 14), alea(-20, 20), alea(10, 15));
      if(y - H < 30) for(let k=nb(4);k>0;k--){ const a = Math.random()*6.2832; emettre(G.poussiere, e.x + Math.cos(a)*10, H + 3, e.y + Math.sin(a)*10, Math.cos(a)*50, alea(3, 10), Math.sin(a)*50, alea(12, 18), 0.7); }
    } else if(arme === 'aa'){
      emettre(G.boucheAA, e.x + alea(-2, 2), y + alea(-1, 1), e.y + alea(-2, 2), 0, 0, 0, taille*0.8);
      if(Math.random() < 0.4) emettre(G.fumeeGrise, e.x, y, e.y, 0, 8, 0, 7, 0.6);
    }
  }

  function fumee(e){
    if(!(nombre(e.x) && nombre(e.y))) return;
    const H = sol(e.x, e.y);
    solCourant = H;
    for(let k=nb(3);k>0;k--) emettre(G.fumeeNoire, e.x + alea(-5, 5), H + 6, e.y + alea(-5, 5), alea(-6, 6), alea(14, 24), alea(-6, 6), alea(18, 26));
    emetteur(G.fumeeNoire, e.x, H + 5, e.y, (e.duree > 0 ? e.duree : 2) + 2.5, 8, 22, 5, 22);
  }

  // Types d'effets mis en scène ici. Tout autre type est ignoré sans erreur : inconnu, ou rendu par un
  // autre module ('rayon', 'chargeSol' et 'bouclier' appartiennent à r3d-aliens.js).
  const CONNUS = {explosion:1, trait:1, eclair:1, fumee:1, ordre:1, missile:1};
  function nouvelEffet(e){
    switch(e.type){
      case 'explosion': explosion(e); break;
      case 'trait': trait(e); break;
      case 'eclair': eclair(e); break;
      case 'fumee': fumee(e); break;
      case 'ordre': ajouterOrdre(e.x, e.y, e.couleur); break;
      case 'missile': nouveauMissile(e); break;
    }
  }

  // =====================================================================
  //  ÉMETTEURS EXTERNES : file fixe de demandes (type, x, y, h, intensité)
  //  Les autres modules appellent emettreFumee / emettrePoussiere / emettreFeu
  //  comme ils veulent : à chaque image (épave d'avion qui tombe), à intervalles
  //  (véhicule qui roule, bâtiment qui brûle) ou en rafale dans la même image
  //  (impact d'une épave, effondrement). Pour que le résultat soit juste dans les
  //  trois cas, chaque demande touche un crédit tenu par case de terrain : le
  //  temps écoulé depuis la dernière émission au même endroit, multiplié par le
  //  débit voulu, plafonné à une bouffée. Un appel par image donne un filet
  //  continu, un appel de temps en temps une bouffée complète, et les demandes
  //  répétées au même endroit dans la même image valent chacune une bouffée.
  //  Le tout reste plafonné par un budget global par image.
  // =====================================================================
  const MAX_DEMANDES = 512;
  const DEM = new Float32Array(MAX_DEMANDES*5);
  let nDem = 0;
  const TAILLE_CASE = 24, NB_CASES = 4096;
  const derniere = [new Float64Array(NB_CASES).fill(-1e6), new Float64Array(NB_CASES).fill(-1e6), new Float64Array(NB_CASES).fill(-1e6)];
  function credit(type, x, y, taux, plafond, rafale){
    const cx = Math.floor(x / TAILLE_CASE), cy = Math.floor(y / TAILLE_CASE);
    const i = ((cx*73856093) ^ (cy*19349663)) & (NB_CASES - 1);
    const T = derniere[type], avant = T[i];
    T[i] = horloge;
    // Plusieurs demandes au même endroit dans la même image : rafale voulue par l'appelant (impact
    // d'une épave, effondrement), chaque demande vaut alors une bouffée.
    if(avant === horloge) return rafale;
    let n = (horloge - avant) * taux;
    if(!(n > 0)) return 0;
    if(n > plafond) n = plafond;
    const ent = Math.floor(n);
    return ent + (Math.random() < n - ent ? 1 : 0);
  }
  function demander(type, x, y, h, intensite){
    if(!pret || nDem >= MAX_DEMANDES || !(nombre(x) && nombre(y))) return;
    const o = (nDem++)*5;
    DEM[o] = type; DEM[o+1] = x; DEM[o+2] = y; DEM[o+3] = nombre(h) ? h : 0; DEM[o+4] = intensite > 0 ? intensite : 1;
  }
  function traiterDemandes(dt){
    budgetExterne = BUDGET_EXTERNE;
    if(dt > 0){
      for(let i=0;i<nDem && budgetExterne > 0;i++){
        const o = i*5, t = DEM[o];
        if(t === 0) fumeeExterne(DEM[o+1], DEM[o+2], DEM[o+3], DEM[o+4]);
        else if(t === 1) poussiereExterne(DEM[o+1], DEM[o+2], DEM[o+4]);
        else feuExterne(DEM[o+1], DEM[o+2], DEM[o+3], DEM[o+4]);
      }
    }
    nDem = 0;          // dt = 0 : les demandes de l'image sont abandonnées, rien n'est émis
  }
  function fumeeExterne(x, y, h, intensite){
    const I = Math.max(0.1, Math.min(3, intensite));
    let n = credit(0, x, y, (4 + 8*I)*Q.dens, I > 0.6 ? 2 : 1, 1);
    if(n <= 0) return;
    const H = sol(x, y); solCourant = H;
    while(n-- > 0 && budgetExterne > 0){
      budgetExterne--;
      emettre(G.fumeeNoire, x + alea(-3, 3), H + h, y + alea(-3, 3), alea(-4, 4), alea(14, 26), alea(-4, 4), (10 + 7*I)*alea(0.8, 1.2), (0.75 + 0.15*I)*Q.vie);
    }
  }
  function poussiereExterne(x, y, intensite){
    const I = Math.max(0.1, Math.min(2, intensite));
    let n = credit(1, x, y, 16*I*Q.dens, 2.4, 1);
    if(n <= 0) return;
    const H = sol(x, y); solCourant = H;
    while(n-- > 0 && budgetExterne > 0){
      budgetExterne--;
      emettre(G.poussiereRoule, x + alea(-4, 4), H + 3, y + alea(-4, 4), alea(-8, 8), alea(3, 9), alea(-8, 8), (14 + 10*I)*alea(0.8, 1.2));
      if(I > 0.5 && Math.random() < 0.4) emettre(G.poussiereGrain, x + alea(-3, 3), H + 2, y + alea(-3, 3), alea(-10, 10), alea(2, 7), alea(-10, 10), (7 + 5*I)*alea(0.8, 1.2));
    }
  }
  function feuExterne(x, y, h, intensite){
    const I = Math.max(0.1, Math.min(3, intensite));
    let n = credit(2, x, y, (10 + 12*I)*Q.dens, 3, 2);
    if(n <= 0) return;
    const H = sol(x, y), base = H + h; solCourant = H;
    const lot = n;
    while(n-- > 0 && budgetExterne > 0){
      budgetExterne--;
      emettre(G.feu, x + alea(-3, 3)*I, base + alea(0, 2), y + alea(-3, 3)*I, alea(-3, 3), alea(10, 22), alea(-3, 3), (8 + 5*I)*alea(0.8, 1.25));
    }
    // Accompagnement, au prorata des flammes émises : fumée, lueur du foyer, braises
    if(budgetExterne > 0 && Math.random() < lot*(0.1 + 0.15*I)){ budgetExterne--; emettre(G.fumeeNoire, x, base + 6, y, 0, alea(16, 26), 0, (9 + 6*I)*alea(0.8, 1.2), 0.8*Q.vie); }
    if(budgetExterne > 0 && Math.random() < lot*0.2){ budgetExterne--; emettre(G.lueurFeu, x, base + 1, y, 0, 0, 0, (14 + 8*I)*alea(0.8, 1.2)); }
    if(budgetExterne > 0 && Math.random() < lot*0.07*I){ budgetExterne--; emettre(G.braise, x, base + 3, y, alea(-15, 15), alea(30, 60), alea(-15, 15), alea(2, 3)); }
  }

  // =====================================================================
  //  LUMIÈRE DE LA SCÈNE, CAMÉRA, QUALITÉ
  // =====================================================================
  // Soleil et ciel posés par r3d-scene.js (on les lit sans jamais les modifier) : leur couleur et leur
  // intensité teintent la fumée et la poussière, qui suivent ainsi l'ambiance et l'assombrissement du ciel.
  let lumSoleil = null, lumCiel = null, rechercheT = 0;
  function chercherLumieres(){
    lumSoleil = null; lumCiel = null;
    const voir = o => {
      if(o.isDirectionalLight && (!lumSoleil || (o.castShadow && !lumSoleil.castShadow) || (o.castShadow === lumSoleil.castShadow && o.intensity > lumSoleil.intensity))) lumSoleil = o;
      if(o.isHemisphereLight && !lumCiel) lumCiel = o;
    };
    for(const o of R3D.scene.children) voir(o);
    if(!lumSoleil || !lumCiel) R3D.scene.traverse(voir);
  }
  function majEclairage(){
    if((!lumSoleil || !lumSoleil.parent) && rechercheT-- <= 0){ rechercheT = 120; chercherLumieres(); }
    // Valeurs par défaut : celles de l'ambiance « midi »
    let sr = 2.35, sg = 2.03, sb = 1.60, cr = 0.42, cg = 0.47, cb = 0.50, tr = 0.26, tg = 0.21, tb = 0.15;
    if(lumSoleil){ const i = lumSoleil.visible ? lumSoleil.intensity : 0, c = lumSoleil.color; sr = c.r*i; sg = c.g*i; sb = c.b*i; }
    if(lumCiel){
      const i = lumCiel.visible ? lumCiel.intensity : 0, c = lumCiel.color, t = lumCiel.groundColor;
      cr = c.r*i; cg = c.g*i; cb = c.b*i; tr = t.r*i; tg = t.g*i; tb = t.b*i;
    }
    // Côté éclairé : soleil (un peu désaturé, la fumée diffuse la lumière) + ciel. Côté ombre : ciel + un peu de sol.
    const l = 0.2126*sr + 0.7152*sg + 0.0722*sb;
    const L = uniLumiere.value, O = uniOmbre.value;
    L.set(0.42*(sr*0.6 + l*0.4) + 0.7*cr, 0.42*(sg*0.6 + l*0.4) + 0.7*cg, 0.42*(sb*0.6 + l*0.4) + 0.7*cb);
    O.set(Math.min(1.15*cr + 0.1*tr, 0.8*L.x), Math.min(1.15*cg + 0.1*tg, 0.8*L.y), Math.min(1.15*cb + 0.1*tb, 0.8*L.z));
    clarteScene = Math.max(0.2, Math.min(1, (0.2126*L.x + 0.7152*L.y + 0.0722*L.z) / 1.15));
    // Axes de la caméra (orientation des traits d'étincelle)
    const cam = R3D.camera;
    if(cam && cam.matrixWorld){ const m = cam.matrixWorld.elements; cdx = m[0]; cdy = m[1]; cdz = m[2]; chx = m[4]; chy = m[5]; chz = m[6]; }
  }

  // Juste avant le rendu d'une réserve : échelle des sprites selon la cible de rendu réellement utilisée
  // (tampon d'écran, ou cible du post-traitement, de taille éventuellement différente) et direction du
  // soleil à l'écran pour la caméra qui dessine (caméra du jeu ou caméra d'une cinématique).
  const tailleTampon = new THREE.Vector2(), vSol = new THREE.Vector3();
  let cadreVu = -1, camVue = null, cibleVue = null;
  function avantRendu(renderer, scene, camera){
    const cadre = renderer.info.render.frame, cible = renderer.getRenderTarget();
    if(cadre !== cadreVu || camera !== camVue || cible !== cibleVue){
      cadreVu = cadre; camVue = camera; cibleVue = cible;
      let hpx;
      if(cible) hpx = cible.height; else { renderer.getDrawingBufferSize(tailleTampon); hpx = tailleTampon.y; }
      const fov = camera.isPerspectiveCamera ? camera.fov : 40;
      uniEchelle.value = hpx / (2*Math.tan(fov*Math.PI/360));
      uniTailleMax.value = Math.max(64, Math.min(1024, hpx*0.8));     // borne le coût de remplissage des très gros sprites
      const d = R3D.dirSoleil;
      if(d && d.isVector3) vSol.copy(d);
      else if(lumSoleil) vSol.copy(lumSoleil.position).sub(lumSoleil.target.position);
      else vSol.set(-0.8, 0.62, 0.3);
      vSol.normalize().transformDirection(camera.matrixWorldInverse);
      const l = Math.hypot(vSol.x, vSol.y);
      if(l > 1e-3) uniSoleil.value.set(vSol.x / l, -vSol.y / l);     // gl_PointCoord : y vers le bas
    }
    this.material.uniformsNeedUpdate = true;      // uniformes partagés : à renvoyer même si le matériau n'a pas changé
  }

  function appliquerQualite(q){
    if(!QUALITES[q]) return;
    Q = QUALITES[q]; qualiteActive = q;
    if(poolNorm){
      const mat = poolNorm.points.material, a = !!mat.defines.VOLUME;
      if(a !== Q.volume){
        if(Q.volume) mat.defines.VOLUME = 1; else delete mat.defines.VOLUME;
        mat.needsUpdate = true;
      }
    }
  }

  // =====================================================================
  //  INTERFACE
  // =====================================================================
  R3D.Effets = {
    init(){
      // Rechargement à chaud (mise au point) : on retire le groupe d'une instance précédente.
      const ancien = R3D.scene.getObjectByName('effets');
      if(ancien) R3D.scene.remove(ancien);
      if(QUALITES[R3D.qualite]){ Q = QUALITES[R3D.qualite]; qualiteActive = R3D.qualite; }
      temoinVolume = null; aRemasquer.length = 0;
      groupe = new THREE.Group(); groupe.name = 'effets';
      R3D.scene.add(groupe);
      atlas = creerAtlas();
      poolNorm = creerPool(MAX_NORMAL, false);
      poolAdd = creerPool(MAX_ADDITIF, true);
      orbesNorm = creerOrbes(poolNorm, 4); orbesAdd = creerOrbes(poolAdd, 7);
      creerTraits(); creerDebris(); creerLumieres(); creerDecalques(); creerProjectiles();
      chercherLumieres();
      pret = true;
    },

    // Préchauffage (contrat commun, appelé par R3D.prechauffer pendant « Chargement… », avant
    // renderer.compile) : toutes les réserves (particules, orbes, traçantes, débris, projectiles,
    // décalques, faisceaux) sont rendues visibles mais vides ou transparentes, pour que leurs
    // programmes soient compilés et leurs tampons envoyés maintenant. Un matériau témoin garde en
    // plus la variante « fumée en volume » que la qualité courante n'utilise pas : changer de qualité
    // ne recompile alors plus rien (le témoin n'est jamais libéré, son programme reste en cache).
    // Le prochain sync remet chaque objet dans l'état où il était.
    prechauffer(){
      if(!pret) return 0;
      if(!temoinVolume && poolNorm){
        const ref = poolNorm.points.material, m = ref.clone();
        m.uniforms = ref.uniforms;                         // mêmes uniformes (pas de copie de l'atlas)
        m.defines = Object.assign({}, ref.defines);
        if(m.defines.VOLUME) delete m.defines.VOLUME; else m.defines.VOLUME = 1;
        temoinVolume = new THREE.Points(poolNorm.geo, m);
        temoinVolume.frustumCulled = false; temoinVolume.visible = false; temoinVolume.renderOrder = 3;
        temoinVolume.onBeforeRender = avantRendu;
        groupe.add(temoinVolume);
      }
      let n = 0;
      groupe.traverse(o => {
        if(o === groupe || o.visible || o.isLight) return;
        const u = o.material && o.material.uniforms;
        const alpha = u && u.uAlpha ? u.uAlpha.value : undefined;
        if(u && u.uAlpha) u.uAlpha.value = 0;              // décalques : dessinés entièrement transparents
        aRemasquer.push({o, alpha});
        o.visible = true; n++;
      });
      return n;
    },

    sync(effets, projectiles, temps, dt){
      if(!pret) return;
      if(aRemasquer.length){
        for(const r of aRemasquer){ r.o.visible = false; if(r.alpha !== undefined) r.o.material.uniforms.uAlpha.value = r.alpha; }
        aRemasquer.length = 0;
      }
      dt = dt > 0 ? Math.min(dt, 0.1) : 0;
      cycle++;
      horloge += dt;
      if(R3D.qualite !== qualiteActive && QUALITES[R3D.qualite]) appliquerQualite(R3D.qualite);
      majEclairage();
      effetsCourants = effets && typeof effets.length === 'number' ? effets : AUCUN;
      const projs = projectiles && typeof projectiles.length === 'number' ? projectiles : AUCUN;
      // Projectiles, première passe : nouveaux venus et impacts (avant les effets, voir suivreProjectiles)
      suivreProjectiles(projs);
      // Nouveaux effets du jeu (en pause, aucun nouvel effet n'apparaît de toute façon)
      for(let i=0;i<effetsCourants.length;i++){
        const e = effetsCourants[i];
        if(!e || typeof e !== 'object') continue;
        const type = e.type;
        try {
          if(type === 'marqueur'){ if(nombre(e.x) && nombre(e.y)){ const s = marqueurDe(e); s.vu = true; } continue; }
          if(CONNUS[type] !== 1 || dejaVus.has(e)) continue;
          dejaVus.add(e);
          nouvelEffet(e);
        } catch(err){ avertir(err, 'effet « ' + type + ' »'); }
      }
      traiterDemandes(dt);
      majDifferes(dt);
      orbesAdd.n = 0; orbesNorm.n = 0;
      majProjectiles(projs, dt);
      finOrbes(orbesAdd); finOrbes(orbesNorm);
      majMissiles(dt);
      majMarqueurs(dt);
      majEmetteurs(dt);
      majOndesOrdres(dt);
      majLumieres(dt);
      majDebris(dt);
      majTraits(dt);
      majPool(poolNorm, dt);
      majPool(poolAdd, dt);
    },

    // Émetteurs continus appelés par les autres modules (r3d-unites, r3d-batiments), AVANT Effets.sync
    // dans la même image, à chaque image ou à intervalles (voir « ÉMETTEURS EXTERNES »). h est une hauteur
    // au-dessus du sol. Ils ne font que déposer une demande dans une file fixe, traitée dans sync() avec
    // le dt de l'image COURANTE : avec dt = 0 (pause, fin de partie) rien n'est émis.
    emettreFumee(x, y, h, intensite){ demander(0, x, y, h, intensite); },
    emettrePoussiere(x, y, intensite){ demander(1, x, y, 0, intensite); },
    emettreFeu(x, y, h, intensite){ demander(2, x, y, h, intensite); },

    // Qualité : appliquée d'office quand R3D.qualite change ; peut aussi être forcée ici.
    definirQualite(q){ appliquerQualite(q); },

    // Diagnostic : ce qui est en scène à cet instant.
    stats(){
      if(!pret) return null;
      let nOndes = 0, nLum = 0;
      for(const o of ondes) if(o.vie > 0) nOndes++;
      for(const l of lumieres) if(l.vie > 0) nLum++;
      return {qualite:qualiteActive, opaques:poolNorm.actives, additives:poolAdd.actives, orbes:orbesAdd.n + orbesNorm.n, tracantes:TR.actifs, debris:DB.actifs,
        projectiles:etats.size, roquettes:nRoq, missilesAir:nAir, bombes:nBom, ondes:nOndes, lumieres:nLum};
    },
  };
})();
