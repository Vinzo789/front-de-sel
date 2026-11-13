'use strict';
/* =====================================================================
   FRONT DE SEL — rendu 3D des bâtiments, chantiers, décombres et champs de minerai.
   Camps : Halden, Karsk et la Régie des eaux (camp neutre « neutre »). Types : qg, caserne,
   usine, relais, depot, aeroport (Halden et Karsk), station et entrepot (Régie), tourelle
   (Halden), bunker (Karsk) et batterie sol-air (les deux) ; les défenses fixes portent une arme
   animée (anim « arme » : suit b.angleT, recul et lueur de départ via b.tirT).

   Principe : chaque modèle (type × camp) est construit UNE fois par un
   « bâtisseur » qui fusionne des primitives en quelques géométries à couleurs
   de sommets, une par « canal » (opaque, métal, vitre, lumières…). Chaque
   bâtiment du jeu n'est qu'un jeu de maillages qui partagent ces géométries
   et des matériaux communs.

   Fluidité (novembre 2026) : à l'affichage, les canaux sont FUSIONNÉS (fusionner) en un seul
   maillage « corps » par ensemble, qui porte son canal d'origine par sommet (aCanal) ; un seul
   matériau (creerCorps) en déduit rugosité, métal, reflets, lueur des vitrages, couleur brute des
   lumières, clignotement des feux. Les pièces tournantes (anims « rotation » et « balayage »)
   sont réunies en un maillage animé dans le shader (animsFusionnees). Seuls les corps projettent
   une ombre (plus le drapeau). Mesuré sur la vitrine ?demo (20 bâtiments, deux chantiers) :
   245 appels de dessin (148 couleur + 97 ombre) avant, 136 (80 + 56) après. Le fantôme de
   placement garde les canaux séparés (instancier(…, sansFusion)).

   Matériaux : physiques (rugosité, métal). Quand la scène fournit une carte d'environnement
   (R3D.scene.environment), les vitrages et les métaux la réfléchissent ; sinon on garde des
   réglages plus mats, lisibles sans reflets (voir PHYS).

   Éclairage de nuit : deux canaux additifs, « nuit » (fenêtres allumées, taches de lumière au
   sol, halos, faisceaux) et « nuitF » (halos des feux clignotants). Ils sont masqués en plein
   jour (aucun appel de dessin) et montent à l'aube, au crépuscule, dans la brume (R3D.ambiance)
   et quand le ciel s'assombrit (R3D.assombrir). Les fenêtres allumées sont déduites
   automatiquement de chaque vitrage posé avec boite('vitre', …). Branchées par sync() depuis
   novembre 2026 (majNuit n'était appelée nulle part) et en qualité élevée seulement : jusqu'à deux
   appels de dessin de plus par bâtiment quand elles sont allumées ; aucun en plein jour, et
   aucune écriture quand rien ne change.

   Repère local d'un modèle : centré sur le bâtiment, X = est, Y = hauteur,
   Z = sud (façade principale tournée vers la caméra, au sud).
   Les couleurs hexadécimales sont converties en linéaire (sortie sRGB).

   Aéroport (emprise 4 × 4 tuiles, 160 × 160) — disposition fixée par le moteur, à ne pas
   déplacer : piste d'est en ouest sur z de +30 à +75 ; trois places de stationnement en
   (-55, -15), (-15, -15), (25, -15), nez au sud ; hangars au nord (z de -78 à -40, x de -78 à
   40) ; tour de contrôle vers (60, -58). Le tarmac et la piste sont à R3D.Batiments.HAUTEUR_PISTE
   au-dessus du sol : rien de haut n'y est posé, les avions y roulent.
   ===================================================================== */
(function(){
  const R3D = window.R3D = window.R3D || {};

  // =================================================================
  //  1. OUTILS : couleurs, hasard reproductible, gabarits
  // =================================================================
  const cacheLin = {};
  function lin(hex){ return cacheLin[hex] || (cacheLin[hex] = new THREE.Color(hex).convertSRGBToLinear()); }
  // Générateur à graine (indépendant de alea() du jeu : ne perturbe pas la carte).
  function rng(graine){ let s = (graine >>> 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

  const GAB = {};
  function gab(cle, f){ return GAB[cle] || (GAB[cle] = f()); }
  function nonIndexe(g){ return g.index ? g.toNonIndexed() : g; }
  function facettes(g){ g = nonIndexe(g); g.computeVertexNormals(); return g; }   // normales par face
  // Tous les gabarits sont de taille unité, centrés (y ∈ [-0.5, 0.5] sauf mention).
  const gBoite   = () => gab('boite', () => nonIndexe(new THREE.BoxGeometry(1,1,1)));
  const gCyl     = (seg, k, plat) => gab('cyl'+seg+'_'+k+(plat?'p':''), () => {
    const g = new THREE.CylinderGeometry(0.5*k, 0.5, 1, seg, 1); return plat ? facettes(g) : nonIndexe(g); });
  const gPyr     = k => gab('pyr'+k, () => facettes(new THREE.CylinderGeometry(0.5*k*Math.SQRT2, 0.5*Math.SQRT2, 1, 4, 1).rotateY(Math.PI/4)));
  // Voûte (demi-cylindre) : axe Z, arc vers le haut, y ∈ [0, 0.5].
  const gVoute   = seg => gab('voute'+seg, () => facettes(new THREE.CylinderGeometry(0.5,0.5,1,seg,1,true,-Math.PI/2,Math.PI).rotateX(-Math.PI/2)));
  const gDemiDisque = seg => gab('dd'+seg, () => nonIndexe(new THREE.CircleGeometry(0.5, seg, 0, Math.PI)));
  // Calotte de parabole : creux vers +Y, sommet en 0.
  const gCalotte = () => gab('calotte', () => nonIndexe(new THREE.SphereGeometry(1, 18, 5, 0, Math.PI*2, 0, 0.62).rotateX(Math.PI).translate(0,1,0)));
  const gSac     = () => gab('sac', () => facettes(new THREE.CylinderGeometry(0.5,0.5,1,6).rotateZ(Math.PI/2)));
  const gCaillou = () => gab('caillou', () => facettes(new THREE.IcosahedronGeometry(0.5, 0)));
  const gPlan    = () => gab('plan', () => nonIndexe(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2)));
  const gTore    = () => gab('tore', () => nonIndexe(new THREE.TorusGeometry(0.5, 0.1, 6, 14).rotateX(Math.PI/2)));
  const gCone    = seg => gab('cone'+seg, () => nonIndexe(new THREE.ConeGeometry(0.5, 1, seg)));
  // Voûte à normales lissées (coque moderne) : mêmes dimensions que gVoute.
  const gVouteLisse = seg => gab('vouteL'+seg, () => nonIndexe(new THREE.CylinderGeometry(0.5,0.5,1,seg,1,true,-Math.PI/2,Math.PI).rotateX(-Math.PI/2)));
  // Halo : disque à dégradé radial pour les canaux de nuit (additifs). L'intensité est codée dans
  // la hauteur locale y (0,5 au centre, -0,5 au bord) et relue par poser() avec ao = 1 ; le disque
  // est ensuite aplati par une échelle y quasi nulle. Profil : 1 au centre, 0,3 au tiers, 0 au bord.
  const gHalo = seg => gab('halo'+seg, () => {
    const p = [], n = [], k = 0.34, y1 = -0.2;
    for(let i = 0; i < seg; i++){
      const a0 = i/seg*Math.PI*2, a1 = (i+1)/seg*Math.PI*2;
      const c0 = Math.cos(a0)*0.5, s0 = Math.sin(a0)*0.5, c1 = Math.cos(a1)*0.5, s1 = Math.sin(a1)*0.5;
      p.push(0, 0.5, 0,  c1*k, y1, s1*k,  c0*k, y1, s0*k);
      p.push(c0*k, y1, s0*k,  c1*k, y1, s1*k,  c1, -0.5, s1);
      p.push(c0*k, y1, s0*k,  c1, -0.5, s1,  c0, -0.5, s0);
    }
    for(let i = 0; i < p.length; i += 3) n.push(0, 1, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return g;
  });
  // La caméra du jeu regarde toujours vers le nord, inclinée d'environ 0,9 rad : un halo penché de
  // cet angle lui fait face sans avoir à être réorienté à chaque image.
  const PENTE_HALO = Math.PI/2 - 0.92;
  // Canaux de nuit (additifs, masqués en plein jour) : ils échappent au canal unique des pièces animées.
  const CANAUX_NUIT = {nuit:1, nuitF:1};

  // =================================================================
  //  2. BÂTISSEUR : fusion de primitives par canal (couleurs de sommets)
  // =================================================================
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler();
  const _pos = new THREE.Vector3(), _ech = new THREE.Vector3(), _nm = new THREE.Matrix3();
  const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(), _Y = new THREE.Vector3(0,1,0);

  class Bati {
    // canalUnique : force toutes les pièces dans un seul canal (pièces animées, grue) pour
    // n'avoir qu'un maillage par sous-ensemble et tenir le budget de ≤ 12 maillages par bâtiment.
    constructor(graine, canalUnique){
      this.canaux = {}; this.h = rng(graine || 7); this.unique = canalUnique || null;
      // Fenêtres allumées la nuit : réglages du camp (posés par modele()), tirage au sort séparé
      // de this.h pour ne pas décaler les teintes et positions aléatoires du modèle.
      this.fenetres = null; this.hf = rng((graine || 7)*31 + 5);
    }
    tampon(n){ if(this.unique && !CANAUX_NUIT[n]) n = this.unique; return this.canaux[n] || (this.canaux[n] = {p:[], n:[], c:[], u:[]}); }
    // Cœur : ajoute un gabarit transformé par la matrice m.
    // o.ao : assombrissement au pied de la pièce (occlusion simulée) ; o.rayures : 2e teinte alternée
    // par paire de triangles (tôle ondulée) ; o.uv : rectangle d'atlas [u0,v0,u1,v1] ;
    // o.gain : facteur d'intensité (canaux de nuit).
    poser(canal, geo, couleur, m, o){
      o = o || {};
      const t = this.tampon(canal);
      const P = geo.attributes.position, N = geo.attributes.normal, UV = geo.attributes.uv;
      _nm.getNormalMatrix(m);
      const ao = o.ao === undefined ? 0.22 : o.ao;
      const cA = lin(couleur), cB = o.rayures ? lin(o.rayures) : null, parTri = o.parTri || 2;
      const kv = (o.varia ? 1 + (this.h() - 0.5) * o.varia : 1) * (o.gain === undefined ? 1 : o.gain);
      for(let i = 0; i < P.count; i++){
        _va.fromBufferAttribute(P, i);
        const ly = _va.y;
        _va.applyMatrix4(m);
        t.p.push(_va.x, _va.y, _va.z);
        _vb.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
        t.n.push(_vb.x, _vb.y, _vb.z);
        const c = (cB && (Math.floor(Math.floor(i/3)/parTri) % 2)) ? cB : cA;
        const f = (1 - ao*(0.5 - Math.min(0.5, ly))) * kv;
        t.c.push(c.r*f, c.g*f, c.b*f);
        if(o.uv) t.u.push(o.uv[0] + UV.getX(i)*(o.uv[2]-o.uv[0]), o.uv[1] + UV.getY(i)*(o.uv[3]-o.uv[1]));
      }
      return this;
    }
    piece(canal, geo, couleur, x, y, z, sx, sy, sz, rx, ry, rz, o){
      _pos.set(x, y, z); _ech.set(sx, sy, sz); _eu.set(rx||0, ry||0, rz||0, 'YXZ'); _q.setFromEuler(_eu);
      _m4.compose(_pos, _q, _ech); return this.poser(canal, geo, couleur, _m4, o);
    }
    // Boîte par coins opposés. Un vitrage (canal « vitre ») reçoit d'office ses fenêtres allumées
    // la nuit, sauf o.nuit === 0 (eau d'un bassin, panneau solaire…).
    boite(canal, couleur, x0, y0, z0, x1, y1, z1, o){
      if(canal === 'vitre' && this.fenetres && !this.unique && !(o && o.nuit === 0)) this.eclairerVitrage(x0, y0, z0, x1, y1, z1);
      return this.piece(canal, gBoite(), couleur, (x0+x1)/2, (y0+y1)/2, (z0+z1)/2,
        Math.abs(x1-x0)||0.05, Math.abs(y1-y0)||0.05, Math.abs(z1-z0)||0.05, 0, 0, 0, o);
    }
    // Boîte centrée, tournée autour de Y. Un feu clignotant (canal « feux ») reçoit son halo de nuit.
    boiteC(canal, couleur, x, y, z, sx, sy, sz, ry, o){
      if(canal === 'feux' && !this.unique) this.halo(x, y, z, 3.4 + Math.max(sx, sz), couleur, 'nuitF', 0.9);
      return this.piece(canal, gBoite(), couleur, x, y, z, sx, sy, sz, 0, ry||0, 0, o);
    }
    // ---- Lumières de nuit (canaux additifs « nuit » / « nuitF ») ----
    // Halo tourné vers la caméra, autour d'une source ponctuelle.
    halo(x, y, z, r, couleur, canal, gain){
      return this.piece(canal || 'nuit', gHalo(10), couleur, x, y, z, 2*r, 0.001, 2*r, PENTE_HALO, 0, 0, {ao:1, gain:gain === undefined ? 1 : gain});
    }
    // Tache de lumière au sol (disque horizontal, ou ellipse si rz est donné).
    flaque(x, y, z, r, couleur, gain, rz){
      return this.piece('nuit', gHalo(14), couleur, x, y, z, 2*r, 0.001, 2*(rz || r), 0, 0, 0, {ao:1, gain:gain === undefined ? 0.4 : gain});
    }
    // Faisceau : cône lumineux de la lampe (xa, ya, za) vers le centre de sa tache (xb, yb, zb), de
    // rayon r à l'arrivée ; vif à la lampe, éteint à l'arrivée.
    faisceau(xa, ya, za, xb, yb, zb, r, couleur, gain){
      _vc.set(xa-xb, ya-yb, za-zb); const L = _vc.length(); if(L < 1e-4) return this;
      _vc.divideScalar(L); _q.setFromUnitVectors(_Y, _vc);
      _pos.set((xa+xb)/2, (ya+yb)/2, (za+zb)/2); _ech.set(2*r, L, 2*r);
      _m4.compose(_pos, _q, _ech); return this.poser('nuit', gCone(12), couleur, _m4, {ao:1, gain:gain === undefined ? 0.2 : gain});
    }
    // Fenêtres allumées derrière un vitrage : un vitrage mince (façade) est découpé en travées et en
    // étages dont une partie, tirée au sort, s'allume ; un volume vitré (atrium, vigie) luit en entier.
    eclairerVitrage(x0, y0, z0, x1, y1, z1){
      const F = this.fenetres, h = this.hf;
      const dx = Math.abs(x1-x0), dy = Math.abs(y1-y0), dz = Math.abs(z1-z0);
      if(dy < 1.2) return;                               // verrière à plat : pas de fenêtre
      const xa = Math.min(x0, x1), ya = Math.min(y0, y1), za = Math.min(z0, z1), d = 0.12;   // d : débord devant la vitre
      const teinte = () => F.teintes[Math.floor(h()*F.teintes.length) % F.teintes.length];
      if(Math.min(dx, dz) > 1.6){                        // volume vitré
        this.piece('nuit', gBoite(), teinte(), xa + dx/2, ya + dy/2, za + dz/2, dx + 2*d, Math.max(0.4, dy - 0.3), dz + 2*d, 0, 0, 0, {ao:0, gain:0.5*F.gain});
        return;
      }
      if(Math.max(dx, dz) < 1.5) return;
      const selonX = dx >= dz, L = selonX ? dx : dz, e = selonX ? dz : dx;
      const nu = Math.max(1, Math.round(L/F.pas)), nv = Math.max(1, Math.round(dy/F.etage));
      const lu = L/nu, lv = dy/nv, mu = Math.min(0.3, lu*0.1), mv = Math.min(0.25, lv*0.1);
      for(let j = 0; j < nv; j++) for(let i = 0; i < nu; i++){
        if(h() > F.taux) continue;
        const c = teinte(), g = (0.5 + 0.5*h())*F.gain;
        const u = (i + 0.5)*lu, v = ya + (j + 0.5)*lv;
        if(selonX) this.piece('nuit', gBoite(), c, xa + u, v, za + e/2, lu - 2*mu, lv - 2*mv, e + 2*d, 0, 0, 0, {ao:0, gain:g});
        else this.piece('nuit', gBoite(), c, xa + e/2, v, za + u, e + 2*d, lv - 2*mv, lu - 2*mu, 0, 0, 0, {ao:0, gain:g});
      }
    }
    // Cylindre vertical posé en y0. o.effile : rapport rayon haut / rayon bas ; o.plat : facettes.
    cyl(canal, couleur, x, y0, z, r, h, seg, o){
      o = o || {};
      return this.piece(canal, gCyl(seg||16, o.effile||1, o.plat), couleur, x, y0 + h/2, z, 2*r, h, 2*r, 0, 0, 0, o);
    }
    // Cylindre horizontal d'axe X ou Z.
    cylH(canal, couleur, x, y, z, r, long, axe, seg, o){
      o = Object.assign({ao:0}, o);
      return axe === 'x' ? this.piece(canal, gCyl(seg||16, 1), couleur, x, y, z, 2*r, long, 2*r, 0, 0, Math.PI/2, o)
                         : this.piece(canal, gCyl(seg||16, 1), couleur, x, y, z, 2*r, long, 2*r, Math.PI/2, 0, 0, o);
    }
    // Poutre de section carrée entre deux points.
    poutre(canal, couleur, x1, y1, z1, x2, y2, z2, ep, o){
      _vc.set(x2-x1, y2-y1, z2-z1); const L = _vc.length(); if(L < 1e-4) return this;
      _vc.divideScalar(L); _q.setFromUnitVectors(_Y, _vc);
      _pos.set((x1+x2)/2, (y1+y2)/2, (z1+z2)/2); _ech.set(ep, L, ep);
      _m4.compose(_pos, _q, _ech); return this.poser(canal, gBoite(), couleur, _m4, Object.assign({ao:0}, o));
    }
    // Marquage plaqué (atlas de faction), vu d'en haut, haut de l'image au nord.
    decal(x, y, z, sx, sz, region, ry){ return this.piece('decal', gPlan(), '#ffffff', x, y, z, sx, 1, sz, 0, ry||0, 0, {uv:region, ao:0}); }
    // Triangle libre (les deux faces).
    tri2(canal, couleur, a, b, c){ this.tri(canal, couleur, a, b, c); return this.tri(canal, couleur, a, c, b); }
    tri(canal, couleur, a, b, c){
      const t = this.tampon(canal), col = lin(couleur);
      _va.set(b[0]-a[0], b[1]-a[1], b[2]-a[2]); _vb.set(c[0]-a[0], c[1]-a[1], c[2]-a[2]); _va.cross(_vb).normalize();
      for(const p of [a, b, c]){ t.p.push(p[0], p[1], p[2]); t.n.push(_va.x, _va.y, _va.z); t.c.push(col.r, col.g, col.b); }
      return this;
    }
    // Nappe drapée (filet de camouflage) : grille de triangles aux teintes tirées au hasard.
    nappe(canal, x0, z0, x1, z1, nx, nz, hauteur, teintes){
      const P = [];
      for(let j = 0; j <= nz; j++) for(let i = 0; i <= nx; i++){
        const x = x0 + (x1-x0)*i/nx, z = z0 + (z1-z0)*j/nz; P.push([x, hauteur(x, z), z]);
      }
      const id = (i, j) => P[j*(nx+1) + i];
      for(let j = 0; j < nz; j++) for(let i = 0; i < nx; i++){
        const a = id(i,j), b = id(i+1,j), c = id(i,j+1), d = id(i+1,j+1);
        this.tri(canal, teintes[Math.floor(this.h()*teintes.length)], a, c, b);
        this.tri(canal, teintes[Math.floor(this.h()*teintes.length)], b, c, d);
      }
      return this;
    }
    construire(){
      const out = {};
      for(const n in this.canaux){
        const t = this.canaux[n]; if(!t.p.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(t.p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(t.n, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(t.c, 3));
        if(t.u.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(t.u, 2));
        g.computeBoundingBox(); g.computeBoundingSphere();
        out[n] = g;
      }
      return out;
    }
  }

  // ---- Fusion des canaux (novembre 2026, fluidité) : un seul maillage « corps » par ensemble.
  // Les canaux éclairés (opaque, métal, métal2, vitre, filet) et les canaux lumineux (emis,
  // couvercle, jauge, feux) partagent un seul matériau : chaque sommet porte son canal d'origine
  // (attribut aCanal) et le shader en déduit rugosité, métal, reflets, lueur des vitrages, ou rend
  // la couleur brute d'un canal lumineux (voir creerCorps). Les canaux à double face (métal2,
  // filet) sont doublés par des triangles retournés (aCanal + 10) : même rendu qu'un DoubleSide.
  // Restent à part : les marquages (texture), le drapeau (ondulant) et les canaux de nuit (additifs).
  const CANAL_CORPS = {opaque:0, metal:1, metal2:2, vitre:3, filet:4, emis:5, couvercle:6, jauge:7, feux:8};
  const DOUBLE_FACE = {metal2:1, filet:1};
  const FUSIONS = new WeakMap();
  function fusionner(geos){
    if(!geos) return geos;
    if(FUSIONS.has(geos)) return FUSIONS.get(geos);
    const out = {}, parts = [];
    let n = 0;
    for(const c in geos){
      if(CANAL_CORPS[c] === undefined){ out[c] = geos[c]; continue; }
      const nb = geos[c].attributes.position.count;
      parts.push([c, geos[c], false]); n += nb;
      if(DOUBLE_FACE[c]){ parts.push([c, geos[c], true]); n += nb; }
    }
    if(parts.length){
      const P = new Float32Array(n*3), N = new Float32Array(n*3), C = new Float32Array(n*3), K = new Float32Array(n);
      let o = 0;
      for(const [c, g, copie] of parts){
        const p = g.attributes.position.array, nm = g.attributes.normal.array, col = g.attributes.color.array, nb = p.length/3;
        const k = CANAL_CORPS[c] + (copie ? 10 : 0);
        for(let i = 0; i < nb; i++){
          // Copie retournée : ordre des sommets inversé dans chaque triangle, normale opposée
          const s = copie ? (i - i%3) + 2 - i%3 : i, d = (o + i)*3;
          P[d] = p[s*3]; P[d+1] = p[s*3+1]; P[d+2] = p[s*3+2];
          const f = copie ? -1 : 1;
          N[d] = f*nm[s*3]; N[d+1] = f*nm[s*3+1]; N[d+2] = f*nm[s*3+2];
          C[d] = col[s*3]; C[d+1] = col[s*3+1]; C[d+2] = col[s*3+2];
          K[o + i] = k;
        }
        o += nb;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.BufferAttribute(C, 3));
      g.setAttribute('aCanal', new THREE.BufferAttribute(K, 1));
      g.computeBoundingBox(); g.computeBoundingSphere();
      out.corps = g;
    }
    FUSIONS.set(geos, out);
    return out;
  }

  // =================================================================
  //  3. ÉLÉMENTS RÉUTILISABLES (treillis, paraboles, sacs, caisses…)
  // =================================================================
  // Pylône en treillis à section carrée, de y0 à y1, largeur l0 -> l1.
  function treillis(B, canal, couleurs, cx, cz, y0, y1, l0, l1, etages, ep){
    const col = i => Array.isArray(couleurs) ? couleurs[i % couleurs.length] : couleurs;
    const S = [[-1,-1],[1,-1],[1,1],[-1,1]];
    const coin = (y, l, s) => [cx + s[0]*l/2, y, cz + s[1]*l/2];
    for(let i = 0; i < etages; i++){
      const ya = y0 + (y1-y0)*i/etages, yb = y0 + (y1-y0)*(i+1)/etages;
      const la = l0 + (l1-l0)*i/etages, lb = l0 + (l1-l0)*(i+1)/etages;
      for(let k = 0; k < 4; k++){
        const a = coin(ya, la, S[k]), b = coin(yb, lb, S[k]), c = coin(yb, lb, S[(k+1)%4]), d = coin(ya, la, S[(k+1)%4]);
        B.poutre(canal, col(i), ...a, ...b, ep*1.5);
        B.poutre(canal, col(i), ...b, ...c, ep);
        if((i + k) % 2) B.poutre(canal, col(i), ...a, ...c, ep*0.7); else B.poutre(canal, col(i), ...d, ...b, ep*0.7);
      }
    }
  }
  // Parabole centrée en (x,y,z), rayon r, élévation et azimut (0 = +X, π/2 = nord).
  function parabole(B, x, y, z, r, elev, az, couleur){
    const th = Math.PI/2 - elev;
    B.piece('metal2', gCalotte(), couleur || '#e4e7e6', x, y, z, r, r, r, 0, az, -th, {ao:0});
    const ax = Math.sin(th)*Math.cos(az), ay = Math.cos(th), azz = -Math.sin(th)*Math.sin(az);
    const fx = x + ax*r*0.8, fy = y + ay*r*0.8, fz = z + azz*r*0.8;
    B.poutre('metal2', '#33383d', x, y, z, fx, fy, fz, r*0.07);
    B.boiteC('metal2', '#33383d', fx, fy, fz, r*0.2, r*0.2, r*0.2);
  }
  // Rangée de sacs de sable de (xa,za) à (xb,zb), posée en y0.
  function sacs(B, xa, za, xb, zb, rangs, y0){
    const L = Math.hypot(xb-xa, zb-za), n = Math.max(1, Math.round(L/3.3)), ang = Math.atan2(zb-za, xb-xa);
    for(let r = 0; r < rangs; r++) for(let i = 0; i < n - (r%2); i++){
      const f = (i + 0.5 + (r%2)*0.5) / n;
      B.piece('opaque', gSac(), B.h() < 0.5 ? '#b6a57c' : '#a08f66', xa + (xb-xa)*f, (y0||1.4) + 0.65 + r*1.2, za + (zb-za)*f,
        3.3, 1.35, 2.2, 0, -ang + (B.h()-0.5)*0.16, 0, {ao:0.3, varia:0.12});
    }
  }
  function caisse(B, x, y, z, s, couleur, ry){
    B.boiteC('opaque', couleur, x, y + s*0.4, z, s*1.3, s*0.8, s, ry, {varia:0.15});
    B.boiteC('opaque', '#3d3a2c', x, y + s*0.8 + 0.08, z, s*1.32, 0.16, s*0.25, ry, {ao:0});
  }
  function fut(B, x, y, z, couleur){
    B.cyl('metal', couleur, x, y, z, 1.35, 3.4, 10, {varia:0.15});
    B.cyl('metal', '#2f2f2a', x, y+3.4, z, 1.1, 0.12, 10, {ao:0});
  }
  // Lampadaire : mât de hauteur h posé en y0 (1,4 par défaut), lanterne vers l'est.
  // La nuit : halo autour de la lanterne, faisceau discret et tache de lumière au sol.
  function lampadaire(B, x, z, h, lumiere, couleur, y0){
    y0 = y0 === undefined ? 1.4 : y0; const d = y0 - 1.4;
    B.cyl('metal', couleur || '#4a5056', x, y0, z, 0.35, h, 6);
    B.boite('metal', couleur || '#4a5056', x-0.3, h+1+d, z-0.3, x+2.6, h+1.6+d, z+0.3);
    B.boite('emis', lumiere, x+1.2, h+0.6+d, z-0.6, x+2.8, h+1.0+d, z+0.6);
    B.halo(x+2, h+0.8+d, z, 3.6, lumiere, 'nuit', 0.8);
    B.faisceau(x+2, h+0.6+d, z, x+2.4, y0+0.2, z, 6.5, lumiere, 0.12);
    B.flaque(x+2.4, y0+0.34, z, 10.5, lumiere, 0.42);
  }
  // Projecteur : boîtier sur un support, verre lumineux, faisceau et tache de lumière au sol en
  // (xb, yb, zb). Sert aux aires de travail (portes d'usine, tarmac).
  function projecteur(B, x, y, z, xb, yb, zb, r, lumiere, couleur, gain){
    B.boiteC('metal', couleur || '#3a4046', x, y, z, 1.6, 1.1, 1.3);
    B.boiteC('emis', lumiere, x + Math.sign(xb - x)*0.2, y - 0.5, z + Math.sign(zb - z)*0.45, 1.2, 0.5, 0.7);
    B.halo(x, y - 0.3, z + 0.5, 3, lumiere, 'nuit', 0.75);
    B.faisceau(x, y - 0.4, z, xb, yb, zb, r*0.55, lumiere, (gain || 1)*0.11);
    B.flaque(xb, yb + 0.34, zb, r, lumiere, (gain || 1)*0.34);
  }
  // Petit véhicule de décor (corps, cabine vitrée, roues).
  function vehicule(B, x, z, ry, corps, long, larg){
    long = long || 9; larg = larg || 4.2;
    const c = Math.cos(ry), s = Math.sin(ry), P = (dx, dz) => [x + dx*c + dz*s, z - dx*s + dz*c];
    let p = P(0, 0); B.boiteC('opaque', corps, p[0], 2.9, p[1], long, 2.2, larg, ry);
    p = P(long*0.12, 0); B.boiteC('vitre', '#2b3c4a', p[0], 4.6, p[1], long*0.45, 1.3, larg*0.9, ry, {ao:0});
    for(const dx of [-long*0.32, long*0.32]) for(const dz of [-larg/2, larg/2]){
      p = P(dx, dz); B.piece('opaque', gCyl(10,1), '#1e1f20', p[0], 1.9, p[1], 2.1, 0.9, 2.1, Math.PI/2, ry, 0, {ao:0});
    }
  }
  function camion(B, x, z, ry, corps, bache){
    const c = Math.cos(ry), s = Math.sin(ry), P = (dx, dz) => [x + dx*c + dz*s, z - dx*s + dz*c];
    let p = P(5.5, 0); B.boiteC('opaque', corps, p[0], 4, p[1], 4, 4.4, 4.6, ry);
    p = P(6.4, 0); B.boiteC('vitre', '#28332f', p[0], 5, p[1], 2.4, 1.4, 4.7, ry, {ao:0});
    p = P(-1.5, 0); B.boiteC('opaque', bache, p[0], 4.8, p[1], 9.5, 4.6, 4.9, ry, {varia:0.1});
    p = P(1, 0); B.boiteC('opaque', '#2a2a24', p[0], 2.1, p[1], 15, 1, 3.6, ry, {ao:0});
    for(const dx of [-4.5, -1.8, 5.5]) for(const dz of [-2.3, 2.3]){
      p = P(dx, dz); B.piece('opaque', gCyl(10,1), '#1e1f20', p[0], 1.9, p[1], 2.6, 1, 2.6, Math.PI/2, ry, 0, {ao:0});
    }
  }
  // Tôle ondulée plane : nervures parallèles à Z.
  function toleOndulee(B, canal, c1, c2, x0, z0, x1, z1, y){
    B.boite(canal, c1, x0, y, z0, x1, y+0.4, z1, {ao:0});
    for(let x = x0 + 0.9; x < x1 - 0.4; x += 1.8) B.boite(canal, c2, x-0.35, y+0.4, z0, x+0.35, y+0.85, z1, {ao:0});
  }

  // Dalle de fondation : talus biseauté qui se fond dans le sol, dalles de béton aux teintes
  // légèrement variées séparées par des joints en creux, et bordure de camp sur le pourtour
  // (liseré lumineux bleu pour Halden, bordures peintes rouge et blanc pour Karsk).
  // d : demi-côté du dessus ; h : hauteur du dessus (les pièces posées dessus partent de h).
  // o.enterre : profondeur du talus sous le sol (0,6 par défaut ; davantage pour une grande emprise).
  function dalle(B, P, d, h, teinte, o){
    o = o || {};
    // Trois styles : Halden (liseré lumineux), Karsk (bordures rouge et blanc), Régie (bordures bleu et blanc).
    const S = P.style || 'neutre', H = S === 'halden', K = S === 'karsk';
    const base = teinte || P.dalle, joint = H ? '#7d7a72' : K ? '#6f6650' : '#7f7d76';
    // Talus : tronc de pyramide (enterré de 0,6 pour épouser les petits reliefs du sol)
    const D = d + 3.2, ent = o.enterre || 0.6;
    B.piece('opaque', gPyr(d/D), H ? '#8f8b80' : K ? '#857a5e' : '#8c897f', 0, (h - 0.25 - ent)/2, 0, 2*D, h - 0.25 + ent, 2*D, 0, 0, 0, {ao:0.5});
    B.boite('opaque', joint, -d, h - 0.6, -d, d, h - 0.25, d, {ao:0});
    // Détails de sol (tirage propre à la dalle : ne décale pas l'aléa du modèle). Ils sont posés au
    // ras des dalles : tout enrobé ou bâtiment construit par-dessus les recouvre.
    const hs = rng(Math.round(d*131 + h*977) + (H ? 1 : K ? 2 : 3));
    if(d > 20){
      if(!H){
        // Karsk et Régie : reprises de béton et taches (dalle qui a vécu)
        const taches = K ? ['#8a7d5f', '#7f7358', '#a39573'] : ['#aaa79d', '#a09d94', '#c6c3b9'];
        for(let i = 0, n = Math.round(d/5); i < n; i++){
          const x = (hs() - 0.5)*2*(d - 6), z = (hs() - 0.5)*2*(d - 6);
          B.boiteC('opaque', taches[i % 3], x, h + 0.03, z, 3 + hs()*7, 0.06, 2 + hs()*5, Math.floor(hs()*4)*Math.PI/2, {ao:0});
        }
      } else {
        // Halden : regards techniques (trappes métalliques cerclées) et repères d'angle peints
        for(let i = 0; i < 3; i++){
          const x = (hs() - 0.5)*2*(d - 8), z = d - 4 - hs()*6;
          B.boiteC('metal', '#5c666e', x, h + 0.04, z, 3.2, 0.08, 3.2, 0, {ao:0});
          B.boiteC('opaque', '#3a4147', x, h + 0.05, z, 2.5, 0.1, 2.5, 0, {ao:0});
        }
        for(const sx of [-1, 1]) for(const sz of [-1, 1]){
          B.boite('opaque', P.ligne, sx*(d - 2.2), h, sz*(d - 2.2) - 0.25, sx*(d - 7.5), h + 0.07, sz*(d - 2.2) + 0.25, {ao:0});
          B.boite('opaque', P.ligne, sx*(d - 2.2) - 0.25, h, sz*(d - 2.2), sx*(d - 2.2) + 0.25, h + 0.07, sz*(d - 7.5), {ao:0});
        }
      }
    }
    // Nuit : le liseré lumineux Halden éclaire le sol tout autour de la dalle
    if(H){
      for(const s of [-1, 1]){
        B.flaque(0, h + 0.34, s*(d + 0.2), d*1.02, P.accent, 0.3, 5.5);
        B.flaque(s*(d + 0.2), h + 0.34, 0, 5.5, P.accent, 0.3, d*1.02);
      }
    }
    // Dalles (≈ 19 de côté), teintes variées : le sol ne paraît plus être un aplat
    const n = Math.max(2, Math.round(2*d/19)), pas = 2*d/n, j = 0.45;
    for(let i = 0; i < n; i++) for(let k = 0; k < n; k++){
      const x0 = -d + i*pas + j, z0 = -d + k*pas + j;
      B.boite('opaque', base, x0, h - 0.5, z0, x0 + pas - 2*j, h, z0 + pas - 2*j, {ao:0, varia:H ? 0.07 : K ? 0.13 : 0.08});
    }
    // Bordure de camp
    if(H){
      for(const [a, b, c, e] of [[-d-0.6, -d-0.6, d+0.6, -d+0.4], [-d-0.6, d-0.4, d+0.6, d+0.6], [-d-0.6, -d, -d+0.4, d], [d-0.4, -d, d+0.6, d]])
        B.boite('opaque', P.acierF, a, h - 0.7, b, c, h + 0.15, e, {ao:0});
      for(const [a, b, c, e] of [[-d-0.2, -d-0.2, d+0.2, -d+0.15], [-d-0.2, d-0.15, d+0.2, d+0.2], [-d-0.2, -d, -d+0.15, d], [d-0.15, -d, d+0.2, d]])
        B.boite('emis', P.accent, a, h + 0.15, b, c, h + 0.3, e, {ao:0});
    } else {
      const L = 4.2, blanc = K ? '#ddd5c2' : '#f0f3f4';
      for(let s = -d; s < d - 0.1; s += L){
        const coul = Math.round((s + d)/L) % 2 ? P.accent : blanc, e = Math.min(d, s + L) - 0.15;
        B.boite('opaque', coul, s, h - 0.6, -d - 0.6, e, h + 0.5, -d + 0.5, {ao:0.2});
        B.boite('opaque', coul, s, h - 0.6, d - 0.5, e, h + 0.5, d + 0.6, {ao:0.2});
        // Côtés ouest / est raccourcis aux angles : pas de faces superposées (scintillement)
        const s2 = Math.max(s, -d + 0.5), e2 = Math.min(e, d - 0.5);
        B.boite('opaque', coul, -d - 0.6, h - 0.6, s2, -d + 0.5, h + 0.5, e2, {ao:0.2});
        B.boite('opaque', coul, d - 0.5, h - 0.6, s2, d + 0.6, h + 0.5, e2, {ao:0.2});
      }
    }
  }

  // =================================================================
  //  4. ATLAS DE MARQUAGES (héliport, emblème, drapeau, bandes) par camp
  // =================================================================
  const ATLAS = {};
  const reg = (x, y, w, h) => [x/512, 1-(y+h)/512, (x+w)/512, 1-y/512];
  const R_HELI = reg(0, 0, 256, 256), R_EMBLEME = reg(256, 0, 256, 256), R_DRAPEAU = reg(0, 256, 256, 160),
        R_DANGER = reg(256, 256, 256, 64), R_ANNEAU = reg(256, 320, 192, 192);
  // Aéroport : numéros de piste (09 à l'ouest, 27 à l'est) et numéros des trois places.
  const R_PISTE09 = reg(0, 416, 96, 96), R_PISTE27 = reg(96, 416, 96, 96),
        R_PLACES = [reg(448, 320, 64, 64), reg(448, 384, 64, 64), reg(448, 448, 64, 64)];
  function poly(g, n, r, rot){ g.beginPath(); for(let i = 0; i < n; i++){ const a = rot + i/n*Math.PI*2; g.lineTo(Math.cos(a)*r, Math.sin(a)*r); } g.closePath(); }
  function lettreH(g, coul){ g.fillStyle = coul; g.fillRect(-40,-56,22,112); g.fillRect(18,-56,22,112); g.fillRect(-18,-11,36,22); }
  // Emblème Halden (inventé) : hexagone, trois barres montantes (« réseau »).
  function emblemeHalden(g, F, r){
    poly(g, 6, r, Math.PI/6); g.fillStyle = F.fonce; g.fill();
    g.lineWidth = r*0.13; g.strokeStyle = F.couleur; g.stroke();
    g.fillStyle = '#f2f6f8';
    const b = r*0.17; for(let i = 0; i < 3; i++){ const h = r*(0.35 + i*0.22); g.fillRect(-r*0.42 + i*b*1.45, r*0.42 - h, b, h); }
    g.fillStyle = F.couleur; g.beginPath(); g.arc(r*0.42, -r*0.3, r*0.12, 0, Math.PI*2); g.fill();
  }
  // Emblème Karsk (inventé) : losange rouge, bastion blanc à trois gradins.
  function emblemeKarsk(g, F, r){
    poly(g, 4, r, 0); g.fillStyle = F.couleur; g.fill(); g.lineWidth = r*0.11; g.strokeStyle = F.fonce; g.stroke();
    g.fillStyle = '#f1ebdd';
    g.fillRect(-r*0.42, r*0.05, r*0.84, r*0.2); g.fillRect(-r*0.3, -r*0.17, r*0.6, r*0.2); g.fillRect(-r*0.16, -r*0.39, r*0.32, r*0.2);
    g.fillStyle = '#66653f'; g.fillRect(-r*0.42, r*0.3, r*0.84, r*0.08);
  }
  // Emblème de la Régie des eaux (inventé) : disque bleu, goutte blanche, deux ondes.
  const BLEU_REGIE = '#2b7bbd';
  function emblemeRegie(g, F, r){
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI*2); g.fillStyle = BLEU_REGIE; g.fill();
    g.lineWidth = r*0.1; g.strokeStyle = '#f4f8fa'; g.stroke();
    g.fillStyle = '#f4f8fa'; g.beginPath();
    g.moveTo(0, -r*0.62); g.bezierCurveTo(r*0.18, -r*0.3, r*0.4, -r*0.05, r*0.4, r*0.14);
    g.arc(0, r*0.14, r*0.4, 0, Math.PI); g.bezierCurveTo(-r*0.4, -r*0.05, -r*0.18, -r*0.3, 0, -r*0.62); g.fill();
    g.strokeStyle = BLEU_REGIE; g.lineWidth = r*0.07;
    for(const y of [r*0.12, r*0.3]){ g.beginPath(); for(let x = -r*0.32; x <= r*0.32; x += r*0.04) g.lineTo(x, y + Math.sin(x/r*14)*r*0.035); g.stroke(); }
  }
  function atlas(fac){
    if(ATLAS[fac]) return ATLAS[fac];
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d'), F = infoFaction(fac), H = facBase(fac) === 'halden', N = !H && facBase(fac) !== 'karsk';
    // Héliport
    g.save(); g.translate(128, 128);
    if(N){
      g.fillStyle = '#b9bcb8'; g.beginPath(); g.arc(0, 0, 126, 0, Math.PI*2); g.fill();
      g.strokeStyle = BLEU_REGIE; g.lineWidth = 12; g.beginPath(); g.arc(0, 0, 96, 0, Math.PI*2); g.stroke();
      lettreH(g, '#f4f6f6');
    } else if(H){
      poly(g, 8, 126, Math.PI/8); g.fillStyle = '#2d3237'; g.fill();
      g.strokeStyle = F.couleur; g.lineWidth = 11; g.beginPath(); g.arc(0, 0, 92, 0, Math.PI*2); g.stroke();
      g.strokeStyle = '#e8ebe8'; g.lineWidth = 4; g.setLineDash([14, 10]); poly(g, 8, 114, Math.PI/8); g.stroke(); g.setLineDash([]);
      lettreH(g, '#f0f4f6');
    } else {
      g.fillStyle = '#8a8576'; g.beginPath(); g.arc(0, 0, 126, 0, Math.PI*2); g.fill();
      const h = rng(5); for(let i = 0; i < 70; i++){ g.fillStyle = `rgba(40,35,25,${0.05 + h()*0.08})`; g.beginPath(); g.arc((h()-.5)*220, (h()-.5)*220, 4 + h()*16, 0, Math.PI*2); g.fill(); }
      g.strokeStyle = F.couleur; g.lineWidth = 13; g.strokeRect(-78, -78, 156, 156);
      lettreH(g, '#efe9dc');
    }
    g.restore();
    // Emblème
    g.save(); g.translate(384, 128); (N ? emblemeRegie : H ? emblemeHalden : emblemeKarsk)(g, F, 112); g.restore();
    // Drapeau
    g.save(); g.translate(0, 256);
    if(N){
      // Champ blanc, onde bleue en pied, emblème à la hampe
      g.fillStyle = '#f2f5f6'; g.fillRect(0, 0, 256, 160);
      g.fillStyle = BLEU_REGIE; g.beginPath(); g.moveTo(0, 160);
      for(let x = 0; x <= 256; x += 8) g.lineTo(x, 112 + Math.sin(x/256*Math.PI*3)*10);
      g.lineTo(256, 160); g.closePath(); g.fill();
      g.translate(62, 64); emblemeRegie(g, F, 40);
    } else if(H){
      g.fillStyle = F.fonce; g.fillRect(0, 0, 256, 160);
      g.fillStyle = F.couleur; g.beginPath(); g.moveTo(0, 160); g.lineTo(70, 160); g.lineTo(256, 30); g.lineTo(256, 0); g.lineTo(200, 0); g.closePath(); g.fill();
      g.translate(62, 52); emblemeHalden(g, F, 36);
    } else {
      // Trois bandes horizontales rouge / olive / rouge, emblème inventé (losange au bastion)
      // centré : composition propre au camp, sans rappel d'un drapeau national réel.
      g.fillStyle = F.couleur; g.fillRect(0, 0, 256, 160);
      g.fillStyle = '#66653f'; g.fillRect(0, 50, 256, 60);
      g.fillStyle = F.fonce; g.fillRect(0, 48, 256, 3); g.fillRect(0, 109, 256, 3);
      g.translate(128, 80); emblemeKarsk(g, F, 54);
    }
    g.restore();
    // Bandes de danger
    g.save(); g.beginPath(); g.rect(256, 256, 256, 64); g.clip();
    g.fillStyle = '#d8a52c'; g.fillRect(256, 256, 256, 64); g.fillStyle = '#1f1d1a';
    for(let x = 236; x < 540; x += 40){ g.beginPath(); g.moveTo(x, 320); g.lineTo(x+20, 320); g.lineTo(x+84, 256); g.lineTo(x+64, 256); g.fill(); }
    g.restore();
    // Anneau de sol (pied de pylône)
    g.save(); g.translate(352, 416);
    g.strokeStyle = N ? BLEU_REGIE : F.couleur; g.lineWidth = 9; g.beginPath(); g.arc(0, 0, 86, 0, Math.PI*2); g.stroke();
    g.lineWidth = 3; g.setLineDash([10, 8]); g.beginPath(); g.arc(0, 0, 72, 0, Math.PI*2); g.stroke(); g.setLineDash([]);
    g.restore();
    // Aéroport : numéros de piste (peinture claire) et numéros de place (jaune de roulage)
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = H ? '#ecece6' : N ? '#f2f2ec' : '#d9d2c0';
    g.font = 'bold 76px Arial, Helvetica, sans-serif';
    g.save(); g.translate(48, 468); g.rotate(Math.PI); g.fillText('09', 0, 0, 88); g.restore(); g.fillText('27', 144, 468, 88);
    g.fillStyle = H ? '#e9bd3c' : N ? '#e9bd3c' : '#cfa94a';
    g.font = 'bold 54px Arial, Helvetica, sans-serif';
    for(let i = 0; i < 3; i++) g.fillText(String(i + 1), 480, 354 + i*64, 56);
    g.restore();
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    if(R3D.renderer) tex.anisotropy = Math.min(8, R3D.renderer.capabilities.getMaxAnisotropy());
    return (ATLAS[fac] = tex);
  }

  // =================================================================
  //  5. MATÉRIAUX PARTAGÉS (états : normal, abîmé, critique, rouillé)
  // =================================================================
  // Teintes de dommages volontairement douces (une fois linéarisées, '#d6cdc2' ≈ 0,64 et
  // '#a39a90' ≈ 0,33) : le bâtiment s'assombrit sans perdre ses accents de camp ; ce sont la
  // fumée et le feu qui disent la gravité.
  const TEINTES = {normal:'#ffffff', abime:'#d6cdc2', critique:'#a39a90', rouille:'#93705a'};
  const OMBRE = {opaque:true, metal:true, metal2:true, vitre:true, filet:true};
  const LUMINEUX = {emis:1, feux:1, couvercle:1, jauge:1, nuit:1, nuitF:1};
  // Ombres portées par canal. Essai mesuré (novembre 2026, captures comparées au même cadrage) :
  // retirer l'ombre des vitrages ou des pièces « metal2 » (paraboles, radars) ôte 35 appels de
  // dessin sur 96 dans la passe d'ombre, mais efface des taches d'ombre visibles (jusqu'à 0,07 % des
  // pixels, écart de couleur maximal 404/765) : écarté. Toutes les pièces fixes gardent leur ombre.
  function ombreCanal(canal){ return !!OMBRE[canal]; }
  // Novembre 2026 (fluidité) : seul le corps fusionné d'un ensemble projette une ombre (une passe
  // par bâtiment et par pièce animée au lieu d'une par canal) ; le drapeau garde la sienne.
  const OMBRE_DRAPEAU = true;
  const MATS = {};
  function materiau(canal, fac, etat){
    const marquage = canal === 'decal' || canal === 'drapeau';
    if(marquage) etat = 'normal';   // emblèmes, marquages et drapeaux ne sont jamais teintés
    const cle = marquage ? canal + '_' + fac : canal;
    const ens = MATS[etat] || (MATS[etat] = {});
    return ens[cle] || (ens[cle] = creerMateriau(canal, fac, etat));
  }
  // Réglages physiques par canal : [rugosité, métal, intensité des reflets d'environnement].
  // « sans » : pas de carte d'environnement (une métallicité forte ne ferait qu'assombrir la teinte) ;
  // « env » : la scène fournit R3D.scene.environment, vitrages et métaux deviennent réfléchissants.
  // La carte d'environnement éclaire aussi les surfaces mates (lumière du ciel) : on la dose par
  // canal pour que les murs ne soient pas délavés.
  const PHYS = {
    opaque: {sans:[0.88, 0.02, 1], env:[0.84, 0.02, 0.45]},
    metal:  {sans:[0.48, 0.38, 1], env:[0.36, 0.72, 1.0]},
    metal2: {sans:[0.45, 0.30, 1], env:[0.34, 0.60, 0.9]},
    vitre:  {sans:[0.10, 0.75, 1], env:[0.05, 0.92, 1.35]},
    filet:  {sans:[1.00, 0.00, 1], env:[1.00, 0.00, 0.3]},
    decal:  {sans:[0.80, 0.00, 1], env:[0.80, 0.00, 0.4]},
    drapeau:{sans:[0.90, 0.00, 1], env:[0.90, 0.00, 0.4]},
  };
  // Lueur propre des vitrages : sans reflets, c'est elle qui leur donne vie ; avec reflets, on la baisse.
  const LUEUR_VITRE = {sans:{normal:'#123047', abime:'#0f283c', critique:'#0b1d2c'}, env:{normal:'#0b2233', abime:'#091b29', critique:'#06121c'}};
  const REGISTRE = [];     // {mat, canal, etat} : tous les matériaux physiques, à réaccorder si l'environnement change
  let envVu = null;        // dernière carte d'environnement vue (null : aucune)
  function accorder(r){
    if(r.canal === 'corps' || r.canal === 'corpsAnim'){ accorderCorps(r); return; }
    const p = PHYS[r.canal]; if(!p) return;
    const v = envVu ? p.env : p.sans, m = r.mat;
    m.roughness = v[0]; m.metalness = v[1];
    // Un bâtiment abîmé perd de son éclat (vitres sales, tôles noircies)
    m.envMapIntensity = v[2] * (r.etat === 'abime' ? 0.7 : r.etat === 'critique' ? 0.45 : 1);
    if(r.canal === 'vitre') m.emissive.copy(lin((envVu ? LUEUR_VITRE.env : LUEUR_VITRE.sans)[r.etat] || '#0b1d2c'));
  }
  function inscrire(mat, canal, etat){ const r = {mat, canal, etat}; REGISTRE.push(r); accorder(r); return mat; }
  // À appeler à chaque image : ne fait quelque chose que si la scène a changé de carte d'environnement.
  function suivreEnvironnement(){
    const env = (R3D.scene && R3D.scene.environment) || null;
    if(env === envVu) return;
    envVu = env;
    for(const r of REGISTRE) accorder(r);
  }
  // Matériaux de nuit (additifs). Leur couleur porte l'intensité courante : voir majNuit().
  const MATS_NUIT = [];
  function materiauNuit(etat){
    const m = new THREE.MeshBasicMaterial({vertexColors:true, toneMapped:false, transparent:true, blending:THREE.AdditiveBlending,
      depthWrite:false, side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1});
    // Brume : une lumière additive ne doit pas virer à la couleur du brouillard, seulement faiblir
    // (elle perce la brume mieux que le bâtiment qui la porte).
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>',
        'vec3 lumiereNuit = gl_FragColor.rgb;\n#include <fog_fragment>\n#ifdef USE_FOG\n  gl_FragColor.rgb = lumiereNuit * (1.0 - 0.75*fogFactor);\n#endif');
    };
    m.customProgramCacheKey = () => 'nuit-additif';
    // Un bâtiment abîmé perd une partie de ses lumières ; en feu, il n'en garde presque plus.
    m.userData.gain = etat === 'abime' ? 0.55 : etat === 'critique' ? 0.25 : 1;
    m.visible = false;
    MATS_NUIT.push(m);
    return m;
  }
  // Témoin de préchauffage : même programme, toujours visible, jamais réglé par majNuit.
  let matTemoinNuit = null;
  function temoinNuit(){
    if(matTemoinNuit) return matTemoinNuit;
    const m = materiauNuit('normal'); MATS_NUIT.splice(MATS_NUIT.indexOf(m), 1);
    m.visible = true; m.color.setScalar(0);
    return (matTemoinNuit = m);
  }
  function creerMateriau(canal, fac, etat){
    const teinte = lin(TEINTES[etat]);
    switch(canal){
      case 'opaque': return inscrire(new THREE.MeshStandardMaterial({vertexColors:true, color:teinte}), canal, etat);
      case 'metal':  return inscrire(new THREE.MeshStandardMaterial({vertexColors:true, color:teinte}), canal, etat);
      case 'metal2': return inscrire(new THREE.MeshStandardMaterial({vertexColors:true, color:teinte, side:THREE.DoubleSide}), canal, etat);
      // Vitrages : sans carte d'environnement, leur aspect tient surtout à l'émissif ; on l'atténue
      // sans l'éteindre quand le bâtiment est abîmé (l'éteindre rendait les façades vitrées Halden
      // presque noires).
      case 'vitre':  return inscrire(new THREE.MeshStandardMaterial({vertexColors:true, color:teinte, emissive:lin('#123047').clone()}), canal, etat);
      case 'filet':  return inscrire(new THREE.MeshStandardMaterial({vertexColors:true, color:teinte, side:THREE.DoubleSide}), canal, etat);
      case 'decal':  return inscrire(new THREE.MeshStandardMaterial({map:atlas(fac), color:teinte, alphaTest:0.5,
                       polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}), canal, etat);
      case 'drapeau':return inscrire(new THREE.MeshStandardMaterial({map:atlas(fac), color:teinte, side:THREE.DoubleSide}), canal, etat);
      case 'corps':  return inscrire(creerCorps(etat, null), canal, etat);
      case 'corpsAnim': return inscrire(creerCorps(etat, null, true), canal, etat);
      case 'nuit': case 'nuitF': return materiauNuit(etat);
      default:       // canaux lumineux : non affectés par l'éclairage ni par la tonalité
        return new THREE.MeshBasicMaterial({vertexColors:true, toneMapped:false,
          color:lin(etat === 'normal' ? '#ffffff' : etat === 'abime' ? '#8c8c8c' : '#333333')});
    }
  }
  // ---- Matériau « corps » (canaux fusionnés, voir fusionner). Un seul programme pour tous les
  // camps et tous les états : l'état ne change que des uniformes (teinte, lueur, reflets, mode).
  // Mode : 0 normal ; 1 critique (les lumières « emis » vacillent) ; 2 chantier (canaux lumineux
  // et copies retournées masqués : le matériau de chantier est déjà à double face).
  // Une pièce masquée est rejetée au sommet (hors du volume de vue), jamais par discard : le test
  // de profondeur anticipé de la carte graphique reste actif.
  // Phase propre à chaque bâtiment (clignotement des feux, vacillement) : tirée de sa position,
  // la même formule sert en JavaScript (phaseLumieres) pour les halos de nuit des feux.
  const U_TEMPS = {value:0};
  const CANAUX_PHYS = ['opaque', 'metal', 'metal2', 'vitre', 'filet'];
  const GLSL_MASQUE = `
    float cBrut = aCanal, copie = step(9.5, cBrut), cc = cBrut - 10.0*copie;
    float lum = step(4.5, cc);
    vec4 mw = modelMatrix[3];
    float phaseB = fract(mw.x*0.01371 + mw.z*0.02913);
    float cache = 0.0;
    if(abs(cc - 8.0) < 0.5) cache = step(0.4, fract(uTemps*0.8 + phaseB));
    if(uMode > 1.5) cache = max(cache, max(lum, copie));
    else if(uMode > 0.5 && abs(cc - 5.0) < 0.5) cache = max(cache, step(sin(uTemps*23.0 + phaseB*40.0), 0.3));
    if(cache > 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);`;
  function phaseLumieres(x, z){ const v = x*0.01371 + z*0.02913; return v - Math.floor(v); }
  // Pièces tournantes (anims « rotation » et « balayage », fonctions du seul temps) : regroupées
  // en un maillage par bâtiment, animé dans le shader. Chaque sommet porte son pivot et sa vitesse
  // (aPivot), son amplitude, son angle de base et son type (aAnimB : 1 rotation, 2 balayage).
  // Même loi qu'avant (majBatiment), la phase du bâtiment étant tirée de sa position.
  const GLSL_ANIM_DECL = `
    attribute vec4 aPivot;
    attribute vec3 aAnimB;
    uniform float uTempsA;
    vec3 tournerY(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c*v.x + s*v.z, v.y, -s*v.x + c*v.z); }
    float angleAnim(){
      vec4 mw = modelMatrix[3];
      float ph = fract(mw.x*0.01371 + mw.z*0.02913)*6.28;
      return aAnimB.z < 1.5 ? ph + uTempsA*aPivot.w : aAnimB.y + sin(uTempsA*aPivot.w + ph)*aAnimB.x;
    }`;
  const GLSL_ANIM_POS = '\n  float angA = angleAnim();\n  transformed = tournerY(transformed - aPivot.xyz, angA) + aPivot.xyz;';
  function shaderAnim(sh, normales){
    sh.uniforms.uTempsA = U_TEMPS;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + GLSL_ANIM_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + GLSL_ANIM_POS);
    if(normales) sh.vertexShader = sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = tournerY(objectNormal, angleAnim());');
  }
  function shaderCorps(sh, u){
    sh.uniforms.uPhys = u.uPhys; sh.uniforms.uLum = u.uLum; sh.uniforms.uMode = u.uMode; sh.uniforms.uTemps = U_TEMPS;
    if(u.anim) shaderAnim(sh, true);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCanal;\nuniform vec3 uPhys[5];\nuniform float uMode;\nuniform float uTemps;\nvarying vec4 vMat;\nvarying float vLum;')
      .replace('#include <project_vertex>', '#include <project_vertex>' + GLSL_MASQUE +
        '\n    vLum = lum;\n    int ic = int(min(cc, 4.0) + 0.5);\n    vMat = vec4(uPhys[ic], step(2.5, cc)*step(cc, 3.5));');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLum;\nvarying vec4 vMat;\nvarying float vLum;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vMat.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vMat.y;')
      .replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment.replace(/envMapIntensity;/g, '(envMapIntensity*vMat.z);'))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vMat.w;')
      // Canal lumineux : couleur brute, ni éclairage, ni ombre, ni tonalité (comme MeshBasicMaterial)
      .replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>\nif(vLum > 0.5) gl_FragColor = vec4(vColor*uLum, 1.0);');
  }
  function creerCorps(etat, uCoupe, anim){
    const m = new THREE.MeshStandardMaterial({vertexColors:true, color:lin(TEINTES[etat]), roughness:1, metalness:1, emissive:lin('#123047').clone()});
    const u = {uPhys:{value:CANAUX_PHYS.map(() => new THREE.Vector3())},
      uLum:{value:lin(etat === 'normal' ? '#ffffff' : etat === 'abime' ? '#8c8c8c' : '#333333').clone()},
      uMode:{value:uCoupe ? 2 : etat === 'critique' ? 1 : 0}, anim:!!anim};
    m.userData.u = u;
    m.onBeforeCompile = sh => shaderCorps(sh, u);
    const cle = anim ? 'corps-bati-anim' : 'corps-bati';
    m.customProgramCacheKey = () => cle;
    if(uCoupe) rendreCoupable(m, uCoupe, true);
    return m;
  }
  function accorderCorps(r){
    const m = r.mat, u = m.userData.u;
    m.roughness = 1; m.metalness = 1;
    CANAUX_PHYS.forEach((c, i) => { const v = envVu ? PHYS[c].env : PHYS[c].sans; u.uPhys.value[i].set(v[0], v[1], v[2]); });
    m.envMapIntensity = r.etat === 'abime' ? 0.7 : r.etat === 'critique' ? 0.45 : 1;
    m.emissive.copy(lin((envVu ? LUEUR_VITRE.env : LUEUR_VITRE.sans)[r.etat] || '#0b1d2c'));
  }
  // Ombre du corps : une seule passe par bâtiment. Les canaux lumineux n'en projettent pas (comme
  // avant) ; les copies retournées restent (elles rendent l'ombre d'une pièce à double face).
  const matsOmbreCorps = {};
  function ombreCorps(anim){
    const k = anim ? 'anim' : 'fixe';
    if(matsOmbreCorps[k]) return matsOmbreCorps[k];
    const m = new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
    m.onBeforeCompile = sh => {
      sh.uniforms.uTemps = U_TEMPS;
      if(anim) shaderAnim(sh, false);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCanal;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  float cc = aCanal - 10.0*step(9.5, aCanal);\n  if(cc > 4.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);');
    };
    const cle = 'ombre-corps-bati-' + k;
    m.customProgramCacheKey = () => cle;
    return (matsOmbreCorps[k] = m);
  }
  // Maillage de corps : seul porteur d'ombre de son ensemble.
  function maillageCorps(geo, mat, canal){
    const me = new THREE.Mesh(geo, mat);
    me.userData.canal = canal || 'corps'; me.castShadow = true; me.receiveShadow = true;
    me.customDepthMaterial = ombreCorps(!!geo.attributes.aPivot);
    return me;
  }
  // Pièces tournantes d'un modèle réunies en une géométrie (voir GLSL_ANIM_DECL). Une anim n'y
  // entre que si elle n'a que des canaux du corps et pas de sous-ensemble. Mis en cache sur le modèle.
  function animShader(a){ return (a.type === 'rotation' || a.type === 'balayage') && a.geos && !a.enfant; }
  function animsFusionnees(m){
    if(m.animsF !== undefined) return m.animsF;
    const parts = [];
    for(const a of m.anims){
      if(!animShader(a)) continue;
      const f = fusionner(a.geos), cles = Object.keys(f);
      if(cles.length !== 1 || !f.corps) continue;
      parts.push([a, f.corps]);
    }
    if(!parts.length) return (m.animsF = null);
    let n = 0; for(const [, g] of parts) n += g.attributes.position.count;
    const P = new Float32Array(n*3), N = new Float32Array(n*3), C = new Float32Array(n*3), K = new Float32Array(n),
          PV = new Float32Array(n*4), AB = new Float32Array(n*3);
    let o = 0;
    for(const [a, g] of parts){
      const nb = g.attributes.position.count;
      const p = g.attributes.position.array;
      for(let i = 0; i < nb; i++){
        P[(o+i)*3] = p[i*3] + a.x; P[(o+i)*3+1] = p[i*3+1] + a.y; P[(o+i)*3+2] = p[i*3+2] + a.z;
        PV[(o+i)*4] = a.x; PV[(o+i)*4+1] = a.y; PV[(o+i)*4+2] = a.z; PV[(o+i)*4+3] = a.vitesse;
        AB[(o+i)*3] = a.amplitude || 0; AB[(o+i)*3+1] = a.base || 0; AB[(o+i)*3+2] = a.type === 'rotation' ? 1 : 2;
      }
      N.set(g.attributes.normal.array, o*3); C.set(g.attributes.color.array, o*3); K.set(g.attributes.aCanal.array, o);
      o += nb;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('aCanal', new THREE.BufferAttribute(K, 1));
    g.setAttribute('aPivot', new THREE.BufferAttribute(PV, 4));
    g.setAttribute('aAnimB', new THREE.BufferAttribute(AB, 3));
    // Enveloppe : chaque pièce peut tourner autour de son pivot (rayon horizontal max)
    g.computeBoundingBox();
    const bb = g.boundingBox;
    for(const [a, gg] of parts){
      gg.computeBoundingBox(); const b = gg.boundingBox;
      const r = Math.max(Math.hypot(b.min.x, b.min.z), Math.hypot(b.max.x, b.max.z), Math.hypot(b.min.x, b.max.z), Math.hypot(b.max.x, b.min.z));
      bb.expandByPoint(new THREE.Vector3(a.x - r, a.y + b.min.y, a.z - r)); bb.expandByPoint(new THREE.Vector3(a.x + r, a.y + b.max.y, a.z + r));
    }
    g.boundingSphere = bb.getBoundingSphere(new THREE.Sphere());
    return (m.animsF = {g, anims:new Set(parts.map(([a]) => a))});
  }
  // ---- Niveau de nuit : 0 en plein jour, 1 au crépuscule ; suit aussi l'assombrissement du ciel.
  const NUIT_AMBIANCE = {midi:0, aube:0.5, crepuscule:1, brume:0.65};
  let nuit = -1, sombreCible = 0, tNuit = 0;
  // La scène assombrit le ciel par R3D.assombrir(k) sans publier le niveau courant : on enveloppe la
  // fonction pour le connaître (sans rien changer à son effet) et allumer les lumières en conséquence.
  function suivreAssombrissement(){
    const f = R3D.assombrir;
    if(typeof f !== 'function' || f.suiviBatiments) return;
    const g = function(k){ sombreCible = Math.max(0, Math.min(1, +k || 0)); return f.apply(this, arguments); };
    g.suiviBatiments = true;
    R3D.assombrir = g;
  }
  function majNuit(){
    suivreAssombrissement();
    const base = NUIT_AMBIANCE[R3D.ambiance];
    const cible = Math.max(base === undefined ? 0.3 : base, sombreCible);
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now())/1000;
    const dt = Math.max(0, Math.min(0.1, t - tNuit)); tNuit = t;
    nuit = nuit < 0 ? cible : nuit + (cible - nuit)*Math.min(1, dt*0.9);
    if(Math.abs(cible - nuit) < 0.003) nuit = cible;
    // Qualités basse et moyenne : pas de lumières additives (jusqu'à deux appels de dessin de plus
    // par bâtiment au crépuscule) ; la qualité élevée garde tout.
    const actif = nuit > 0.02 && R3D.qualite === 'haute';
    // Rien n'a changé depuis l'appel précédent : aucune écriture (cas courant en plein jour)
    const sig = actif ? nuit : -1;
    if(sig === sigNuit && MATS_NUIT.length === nbMatsNuit) return;
    sigNuit = sig; nbMatsNuit = MATS_NUIT.length;
    for(const m of MATS_NUIT){ m.visible = actif; if(actif) m.color.setScalar(nuit*m.userData.gain); }
  }
  let sigNuit = null, nbMatsNuit = 0;
  // Coupe horizontale (chantier) : tout fragment au-dessus de uCoupe (hauteur monde) est écarté ;
  // une fine bande incandescente marque le front de construction ; l'intérieur est assombri.
  function rendreCoupable(m, uniforme, enchainer){
    const avant = enchainer ? m.onBeforeCompile : null;   // corps : garder le shader des canaux fusionnés
    m.onBeforeCompile = sh => {
      if(avant) avant(sh);
      sh.uniforms.uCoupe = uniforme;
      sh.vertexShader = 'varying float vHautMonde;\n' + sh.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n  vHautMonde = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = 'uniform float uCoupe;\nvarying float vHautMonde;\n' + sh.fragmentShader
        .replace('void main() {', 'void main() {\n  if(vHautMonde > uCoupe) discard;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if(!gl_FrontFacing) gl_FragColor.rgb *= 0.35;\n' +
          '  if(vHautMonde > uCoupe - 0.7) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.72, 0.32), 0.75);');
    };
    const cleAvant = avant ? m.customProgramCacheKey() : '';
    m.customProgramCacheKey = () => avant ? 'coupe-chantier-' + cleAvant : 'coupe-chantier';
    m.side = THREE.DoubleSide;
    m.needsUpdate = true;
  }
  // Matériaux « coupables » : mis en cache PERMANENT, jamais libérés (dispose).
  // Libérer les clones à la fin d'un chantier faisait tomber à zéro le compteur d'usage des
  // programmes shader : three les détruisait et les recompilait au chantier suivant (gel d'une image).
  // Organisation : un « poste » de chantier = une hauteur de coupe (uniforme) + ses matériaux
  // (un par canal × camp). Les postes sont recyclés d'un chantier à l'autre. On ne partage pas
  // un même matériau entre deux chantiers simultanés : three r128 ne renvoie les uniformes au GPU
  // que lorsqu'il change de matériau entre deux appels de dessin, si bien qu'une hauteur propre à
  // chaque maillage (onBeforeRender) ne serait pas fiable sur des maillages consécutifs.
  // Tous les postes partagent les mêmes programmes (même clé 'coupe-chantier') : créer un poste
  // ne compile rien, il ne fait que réutiliser les programmes précompilés à l'init.
  const POSTES = [];   // {u:{value}, mats:{canal_fac: matériau}, libre}
  function prendrePoste(){
    let p = POSTES.find(q => q.libre);
    if(!p){ p = {u:{value:0}, mats:{}, libre:true}; POSTES.push(p); }
    p.libre = false; return p;
  }
  function rendrePoste(p){ if(p){ p.libre = true; p.u.value = -1e6; } }
  function matCoupable(p, canal, fac){
    const cle = canal + '_' + fac;
    if(!p.mats[cle] && (canal === 'corps' || canal === 'corpsAnim')) p.mats[cle] = inscrire(creerCorps('normal', p.u, canal === 'corpsAnim'), canal, 'normal');
    if(!p.mats[cle]){
      p.mats[cle] = materiau(canal, fac, 'normal').clone(); rendreCoupable(p.mats[cle], p.u);
      inscrire(p.mats[cle], canal, 'normal');   // le clone suit lui aussi la carte d'environnement
    }
    return p.mats[cle];
  }
  // Canaux qui peuvent être coupés (tous sauf les canaux lumineux, masqués pendant un chantier).
  const CANAUX_COUPABLES = ['corps', 'corpsAnim', 'decal', 'drapeau'];

  // =================================================================
  //  6. MODÈLES DES BÂTIMENTS
  //  Chaque fabrique remplit m.statique (Bati) et m.anims, et déclare :
  //  m.corps [x0,z0,x1,z1,h] (volume principal : échafaudage, pointage),
  //  m.points (foyers de fumée / feu), m.cheminees.
  // =================================================================
  const PAL = {
    // Toits Halden en membrane graphite (et non gris clair) : contraste fort avec le sable et
    // les façades claires, le bleu de camp ressort même dézoomé.
    halden:{dalle:'#b3b0a6', asphalte:'#3f4246', panneau:'#e1e4e5', panneau2:'#c4cbd0', acier:'#56636e', acierF:'#363e46',
      acierC:'#9aa5ae', toit:'#4c565f', accent:'#3fa7ff', accentF:'#1c4f80', vitre:'#3d6585', lumiere:'#79ccff', ligne:'#ecece6'},
    // Béton Karsk plus sombre et plus chaud : les volumes (bunker biseauté) se lisent mieux.
    karsk:{dalle:'#9a8c6c', asphalte:'#57534a', beton:'#8a826d', beton2:'#6f6a5a', olive:'#66653f', oliveF:'#4a4930',
      tole:'#807c64', tole2:'#69664f', rouille:'#8a5a3a', accent:'#e2533f', accentF:'#7e2418', vitre:'#25302f', lumiere:'#ffcf7a', ligne:'#e6dfcf', bois:'#8b6b46'},
    // Régie des eaux de Varenne (camp neutre) : façades blanches, bleu « eau » plus profond que le
    // bleu Halden pour ne pas confondre les deux. Palette COMPLÈTE (clés des deux camps) : elle sert
    // aussi de complément pour tout modèle construit avec la palette d'un autre camp.
    neutre:{dalle:'#bab7ae', asphalte:'#4a4d50', panneau:'#eef1f2', panneau2:'#d3dbe0', acier:'#6b7b86', acierF:'#3e4a53',
      acierC:'#a9b5bd', toit:'#5d7380', accent:'#2b7bbd', accentF:'#174c74', vitre:'#4a6f8a', lumiere:'#cfe9ff', ligne:'#f2f2ec',
      beton:'#aaa698', beton2:'#8d8a7e', olive:'#7f8c94', oliveF:'#5d6a72', tole:'#c9ced0', tole2:'#aeb5b8', rouille:'#8a6a52',
      bois:'#9a7a52', conduite:'#3a77a6', eau:'#2f6d8c'},
  };
  PAL.halden.style = 'halden'; PAL.karsk.style = 'karsk'; PAL.neutre.style = 'neutre';
  // Palette effective d'un camp : ses propres teintes, complétées par celles de la Régie
  // (un modèle d'un camp construit pour un autre ne reçoit jamais de couleur indéfinie).
  // ---- Couleurs de camp (escarmouche à 2-4 camps). Un modèle est mis en cache par VARIANTE :
  // « halden », « karsk », ou « halden@#58c96b » quand le camp porte une couleur autre que la teinte
  // de sa faction. La variante ne change que les teintes d'accent (bandeaux, toits marqués, liserés
  // de dalle, fanions, emblèmes) ; la livrée et la géométrie restent celles de la faction (même graine).
  // Un duel Halden bleu contre Karsk rouge retombe donc exactement sur les modèles d'origine.
  const SEP_VAR = '@';
  function facBase(cle){ const i = cle.indexOf(SEP_VAR); return i < 0 ? cle : cle.slice(0, i); }
  function couleurVar(cle){ const i = cle.indexOf(SEP_VAR); return i < 0 ? null : cle.slice(i + 1); }
  // Teinte foncée d'accompagnement (≈ rapport accentF / accent des palettes d'origine).
  const FONCES = {};
  function foncer(hex){ return FONCES[hex] || (FONCES[hex] = '#' + new THREE.Color(hex).multiplyScalar(0.47).getHexString()); }
  // Variante d'un camp : seuls les camps Halden et Karsk portent une couleur propre ; le camp
  // neutre, les envahisseurs et tout camp sans couleur gardent l'aspect de leur faction.
  function variante(campId){
    const c = typeof camps !== 'undefined' && camps[campId];
    if(!c) return 'neutre';
    const fac = c.faction;
    if(fac !== 'halden' && fac !== 'karsk') return fac;
    const coul = typeof c.couleur === 'string' && /^#[0-9a-f]{6}$/i.test(c.couleur) ? c.couleur.toLowerCase() : null;
    return !coul || coul === PAL[fac].accent ? fac : fac + SEP_VAR + coul;
  }
  const PALC = {};
  function palette(fac){
    if(PALC[fac]) return PALC[fac];
    const base = facBase(fac), coul = couleurVar(fac);
    const P = Object.assign({}, PAL.neutre, PAL[base] || {});
    if(coul){ P.accent = coul; P.accentF = foncer(coul); }
    return (PALC[fac] = P);
  }
  // Bâtiments de la Régie construits pour un autre camp : teintes Régie, accents du camp.
  function paletteRegie(P){ return P.style === 'neutre' ? P : Object.assign({}, PAL.neutre, {accent:P.accent, accentF:P.accentF, style:P.style}); }
  // Description d'un camp ; repli si le moteur n'a pas (encore) déclaré FACTIONS.neutre.
  const REGIE_DEFAUT = {nom:'Régie des eaux de Varenne', couleur:'#e8eef2', fonce:'#5d7380', clair:'#ffffff'};
  const INFOV = {};
  function infoFaction(fac){
    const coul = couleurVar(fac), F = (typeof FACTIONS !== 'undefined' && FACTIONS[facBase(fac)]) || REGIE_DEFAUT;
    if(!coul) return F;
    return INFOV[fac] || (INFOV[fac] = Object.assign({}, F, {couleur:coul, fonce:foncer(coul)}));
  }
  const FILET = ['#5e5f3f', '#4b4c32', '#77724d', '#3e3f2a', '#686545'];
  // Fenêtres allumées la nuit, par style : part des travées allumées, largeur d'une travée, hauteur
  // d'un étage, intensité et teintes (Halden : bureaux blanc chaud et écrans froids ; Karsk : ampoules
  // ambrées ; Régie : blanc chaud).
  const FENETRES = {
    halden:{taux:0.5, pas:4.6, etage:4.6, gain:0.9, teintes:['#ffe6bd', '#fff1d8', '#cfe6ff', '#ffe6bd']},
    karsk: {taux:0.42, pas:4.2, etage:4.2, gain:0.95, teintes:['#ffc46b', '#ffb655', '#ffd590']},
    neutre:{taux:0.45, pas:4.4, etage:4.4, gain:0.85, teintes:['#ffe9c4', '#fff1d6', '#ffdca6']},
  };

  // --------------------------------------------------- QG HALDEN
  function qgHalden(m, P){
    const B = m.statique;
    dalle(B, P, 58, 1.5);
    B.boite('opaque', P.asphalte, -56, 1.5, 22, 56, 1.65, 56, {ao:0});
    B.boite('opaque', '#d2cfc6', -56, 1.5, 17, 56, 2.2, 22, {ao:0.1});
    for(let i = 0; i < 6; i++) B.boite('opaque', P.ligne, 21.6 + i*6, 1.65, 42, 22.2 + i*6, 1.75, 54, {ao:0});
    B.boite('opaque', P.accent, -40, 1.65, 34, -8, 1.75, 36, {ao:0});
    // Podium principal
    B.boite('opaque', P.panneau, -52, 1.5, -52, 16, 19, 16);
    for(const [y0, y1] of [[5, 9], [12.4, 16.4]]){
      B.boite('vitre', P.vitre, -50, y0, 16, 14, y1, 16.6, {ao:0});
      B.boite('vitre', P.vitre, -52.6, y0, -50, -52, y1, 14, {ao:0});
      B.boite('vitre', P.vitre, 16, y0, -50, 16.6, y1, 14, {ao:0});
    }
    for(let x = -50; x <= 14; x += 6.4) B.boite('metal', P.acierC, x-0.3, 4.4, 16, x+0.3, 17, 17, {ao:0});
    for(let z = -50; z <= 14; z += 6.4){
      B.boite('metal', P.acierC, -53, 4.4, z-0.3, -52, 17, z+0.3, {ao:0});
      B.boite('metal', P.acierC, 16, 4.4, z-0.3, 17, 17, z+0.3, {ao:0});
    }
    B.boite('opaque', P.toit, -51.5, 19, -51.5, 15.5, 19.4, 15.5, {ao:0});
    for(const [a, b, c, d] of [[-52.5,-52.5,16.5,-51],[-52.5,15,16.5,16.5],[-52.5,-52.5,-51,16.5],[15,-52.5,16.5,16.5]])
      B.boite('opaque', P.acier, a, 19, b, c, 21, d, {ao:0});
    B.boite('emis', P.lumiere, -52.5, 21, 15.8, 16.5, 21.5, 16.5);
    B.boite('emis', P.lumiere, 15.8, 21, -52.5, 16.5, 21.5, 16.5);
    B.decal(2, 19.45, -1, 22, 22, R_EMBLEME);
    for(const [x, z] of [[-6, -46], [4, -46]]){ B.boite('metal', '#b9c0c4', x, 19.4, z, x+7, 23, z+5); B.cyl('metal', '#3c4248', x+3.5, 23, z+2.5, 1.8, 0.4, 10, {ao:0}); }
    // Toit du podium : verrières, groupes de climatisation, chemin de circulation
    for(const z of [-9, 2]) for(let i = 0; i < 4; i++){
      const x = -47 + i*8;
      B.boite('metal', P.acierC, x - 0.4, 19.4, z - 0.4, x + 6.4, 20.2, z + 4.4, {ao:0});
      B.piece('vitre', gBoite(), '#5d8fb5', x + 3, 20.6, z + 2, 6.2, 0.3, 4.2, 0.28, 0, 0, {ao:0});
    }
    for(const [x, z] of [[-48, 9.5], [-40, 9.5], [-32, 9.5]]){
      B.boite('metal', '#c3c9cd', x, 19.4, z, x + 6.5, 22.2, z + 4.5);
      B.cyl('metal', '#2d3338', x + 3.25, 22.2, z + 2.25, 1.6, 0.3, 10, {ao:0});
    }
    B.boite('opaque', '#79838b', -12, 19.4, -14.6, 15, 19.55, -12.6, {ao:0});
    B.boite('opaque', '#79838b', -24, 19.4, -16, -21.6, 19.55, 14, {ao:0});
    // Tour vitrée
    B.boite('opaque', P.panneau2, -48, 19, -48, -14, 46, -16);
    B.boite('vitre', P.vitre, -47, 21, -16, -15, 44, -15.4, {ao:0});
    B.boite('vitre', P.vitre, -14, 21, -47, -13.4, 44, -17, {ao:0});
    for(let y = 21; y <= 44.2; y += 4.6){
      B.boite('metal', P.acierC, -47.6, y, -15.6, -14.4, y+0.6, -15, {ao:0});
      B.boite('metal', P.acierC, -13.6, y, -47.6, -13, y+0.6, -16.4, {ao:0});
    }
    for(let x = -46; x <= -16; x += 5) B.boite('metal', P.acierC, x-0.25, 21, -15.8, x+0.25, 44, -15, {ao:0});
    B.boite('opaque', P.acierF, -49, 46, -49, -13, 48, -15);
    B.boite('emis', P.lumiere, -49.2, 46.6, -15.3, -12.8, 47.4, -14.7);
    B.boite('emis', P.lumiere, -13.3, 46.6, -49.2, -12.7, 47.4, -14.8);
    B.boite('metal', P.acierC, -45, 48, -45, -35, 52, -37);
    // Mât d'antennes
    treillis(B, 'metal', P.acierC, -23, -26, 48, 84, 5, 1.8, 6, 0.45);
    B.cyl('metal', P.acierC, -23, 84, -26, 0.35, 9, 6);
    B.cyl('metal', P.acierC, -42, 48, -21, 0.3, 14, 5);
    B.cyl('metal', P.acierC, -19, 48, -42, 0.3, 11, 5);
    B.boiteC('feux', '#ff3626', -23, 93.6, -26, 1.6, 1.6, 1.6);
    B.boiteC('feux', '#ff3626', -23, 66, -26, 2.6, 1.2, 2.6);
    // Héliport surélevé
    for(const [x, z] of [[26, -50], [50, -50], [26, -24], [50, -24]]) B.cyl('metal', P.acier, x, 1.5, z, 1.3, 11, 8);
    B.poutre('metal', P.acier, 26, 6, -50, 50, 11, -50, 0.6); B.poutre('metal', P.acier, 26, 11, -24, 50, 6, -24, 0.6);
    B.cyl('opaque', P.acierF, 38, 12.5, -37, 18, 1.8, 8, {plat:true, ao:0.1});
    B.decal(38, 14.32, -37, 31, 31, R_HELI);
    for(let i = 0; i < 8; i++){ const a = i/8*Math.PI*2 + Math.PI/8; B.boiteC('emis', i % 2 ? '#7dff9a' : P.lumiere, 38 + Math.cos(a)*16.6, 14.6, -37 + Math.sin(a)*16.6, 1, 0.6, 1); }
    B.boite('metal', P.acierC, 16, 13, -41, 22.5, 13.6, -35, {ao:0});
    B.poutre('metal', P.acierC, 22, 13.3, -21, 22, 1.8, -10, 2.2);
    // Garage des véhicules
    B.boite('opaque', P.panneau2, 20, 1.5, -14, 56, 13, 17);
    for(let i = 0; i < 3; i++){
      B.boite('metal', '#8f9aa2', 22.5 + i*11.3, 1.5, 17, 31.5 + i*11.3, 10, 17.5, {ao:0.15, rayures:'#7b858d', parTri:2});
    }
    B.boite('emis', P.lumiere, 20, 11, 17, 56, 11.6, 17.6);
    B.boite('opaque', P.toit, 20.5, 13, -13.5, 55.5, 13.4, 16.5, {ao:0});
    for(let r = 0; r < 3; r++){
      B.piece('vitre', gBoite(), '#1d3450', 38, 15.2, -8 + r*8.6, 32, 0.35, 6.2, 0.32, 0, 0, {ao:0});
      B.boite('metal', P.acier, 23, 13.4, -8.6 + r*8.6, 53, 14.6, -7.6 + r*8.6, {ao:0});
    }
    // Entrée principale
    B.boite('metal', P.acier, -38, 9, 16, -10, 9.8, 27);
    B.boite('emis', P.lumiere, -38, 8.7, 26.4, -10, 9.1, 27);
    B.boite('metal', P.acierC, -37, 1.5, 26, -36.3, 9, 26.7); B.boite('metal', P.acierC, -11.7, 1.5, 26, -11, 9, 26.7);
    B.boite('vitre', P.vitre, -32, 1.5, 16, -16, 8.5, 16.9, {ao:0});
    for(const x of [-50, -26, 2]) lampadaire(B, x, 29, 9, P.lumiere, P.acier);
    vehicule(B, 25, 48, Math.PI/2, '#2d343b'); vehicule(B, 37, 48, Math.PI/2, '#e5e8ea'); vehicule(B, 49, 48, Math.PI/2, '#2d343b');
    // Bornes et totem
    B.boite('opaque', P.acierF, -48, 1.6, 23, -45, 12, 25); B.boite('emis', P.accent, -47.6, 6, 25, -45.4, 11, 25.3);
    m.corps = [-52, -52, 16, 16, 21];
    m.points = [[-30, 47, -30], [-10, 20, -20], [38, 15, -37], [36, 13.5, 0], [-40, 20, 4]];
    // Animations : radar sur la tour, deux paraboles sur le podium
    const radar = new Bati(0, 'metal2'); radar.cyl('metal', P.acierF, 0, 0, 0, 0.8, 2.5, 8);
    radar.boiteC('metal', '#dfe3e5', 0, 3.2, 0, 13, 1.6, 0.9); radar.boiteC('emis', P.lumiere, 0, 4.1, 0, 12, 0.3, 0.4);
    m.anims.push({type:'rotation', vitesse:1.4, x:-40, y:52, z:-41, bati:radar});
    const p1 = new Bati(0, 'metal2'); p1.cyl('metal', P.acier, 0, 0, 0, 1, 4, 8); parabole(p1, 0, 5.2, 0, 5.5, 0.75, 0, '#eef0ef');
    m.anims.push({type:'balayage', vitesse:0.35, amplitude:0.9, base:0.6, x:8, y:19.4, z:-26, bati:p1});
    const p2 = new Bati(0, 'metal2'); p2.cyl('metal', P.acier, 0, 0, 0, 0.8, 3, 8); parabole(p2, 0, 4, 0, 3.8, 0.5, 0, '#eef0ef');
    m.anims.push({type:'rotation', vitesse:-0.3, x:-6, y:19.4, z:-34, bati:p2});
  }

  // --------------------------------------------------- QG KARSK
  function qgKarsk(m, P){
    const B = m.statique;
    dalle(B, P, 58, 1.4);
    B.boite('opaque', P.asphalte, -56, 1.4, 26, 56, 1.55, 56, {ao:0});
    for(let i = 0; i < 4; i++) B.boite('opaque', P.ligne, -50 + i*9, 1.55, 40, -46 + i*9, 1.62, 41, {ao:0});
    // Bunker principal en tronc de pyramide
    // Talus en béton plus sombre que la dalle supérieure : le biseau se lit même sous un soleil zénithal.
    B.piece('opaque', gPyr(0.86), '#6c6553', -18, 9.2, -16, 72, 15.6, 64, 0, 0, 0, {ao:0.35});
    B.boite('opaque', P.beton, -48.6, 16.6, -43.2, 12.6, 17.4, 11.2, {ao:0});
    B.boite('opaque', P.accent, -48.8, 17.4, 9.6, 12.8, 17.7, 11.4, {ao:0});
    // Toit du bunker : bouches d'aération, nid de mitrailleuse en sacs de sable, caisses de munitions
    for(const z of [-5, 1, 7]){ B.cyl('metal', '#5b5a48', -46, 17.4, z, 1.3, 2.6, 8); B.cyl('metal', '#2f2e26', -46, 20, z, 1.6, 0.5, 8, {ao:0}); }
    for(let i = 0; i < 10; i++){ const a0 = i/10*Math.PI*2, a1 = a0 + 0.55; sacs(B, -14 + Math.cos(a0)*6, 1 + Math.sin(a0)*6, -14 + Math.cos(a1)*6, 1 + Math.sin(a1)*6, 2, 17.4); }
    B.cyl('metal', '#34352b', -14, 17.4, 1, 0.6, 3.4, 6);
    B.poutre('metal', '#2a2a23', -14, 20.6, 1, -7.5, 21.2, 5, 0.5);
    for(let i = 0; i < 3; i++) caisse(B, -25 + i*3.6, 17.4, -5.5, 2.6, P.olive, 0.1*i);
    B.decal(-34, 17.45, 2, 15, 15, R_EMBLEME);
    // Poste de commandement
    B.boite('opaque', P.beton2, -44, 17.4, -42, 2, 30, -8);
    for(let x = -40; x < 0; x += 6) B.boite('vitre', P.vitre, x, 22.5, -8, x+3.6, 25, -7.4, {ao:0});
    B.boite('opaque', P.accent, -44.4, 27, -8.6, 2.4, 29, -7.4, {ao:0});
    toleOndulee(B, 'metal', P.tole, P.tole2, -45, -43, 3, -7, 30);
    B.boite('opaque', P.accent, -45.2, 30.9, -27, 3.2, 31.3, -21, {ao:0});
    // Tour d'observation
    B.boite('opaque', P.beton, -12, 30, -40, 0, 37, -28);
    B.boite('vitre', P.vitre, -12.3, 33, -40.3, 0.3, 35.5, -27.7, {ao:0});
    B.boite('opaque', P.beton2, -13, 37, -41, 1, 38, -27, {ao:0});
    sacs(B, -12, -27.5, 0, -27.5, 1, 38);
    // Mât haubané rouge et blanc
    treillis(B, 'metal', [P.accent, '#dcd6c8'], -30, -32, 31, 86, 3.2, 2.2, 7, 0.5);
    for(const [x, z] of [[-44, -42], [2, -42], [-44, -8], [2, -8]]) B.poutre('metal', '#35352f', -30, 72, -32, x, 31, z, 0.18);
    B.boiteC('feux', '#ff3626', -30, 87.4, -32, 1.6, 1.6, 1.6);
    B.boiteC('feux', '#ff3626', -30, 60, -32, 2.6, 1.2, 2.6);
    // Héliport au sol, ceint de sacs de sable
    B.cyl('opaque', P.beton, 36, 1.4, -36, 18, 0.8, 24, {ao:0});
    B.decal(36, 2.24, -36, 32, 32, R_HELI);
    for(let i = 0; i < 9; i++){ const a0 = Math.PI*(0.9 + i*0.13), a1 = a0 + 0.12; sacs(B, 36 + Math.cos(a0)*20.5, -36 + Math.sin(a0)*20.5, 36 + Math.cos(a1)*20.5, -36 + Math.sin(a1)*20.5, 2, 1.4); }
    // Hangar ouvert des véhicules
    for(const x of [16, 36, 56]) for(const z of [-10, 22]) B.boite('metal', P.oliveF, x-0.8, 1.4, z-0.8, x+0.8, 12, z+0.8);
    toleOndulee(B, 'metal', P.olive, P.oliveF, 14, -12, 57, 24, 12);
    B.boite('opaque', P.accent, 14, 13.25, 4, 57, 13.5, 8, {ao:0});
    camion(B, 26, 6, Math.PI/2, P.olive, '#6f6b48'); camion(B, 46, 6, Math.PI/2, P.olive, '#5d5a3c');
    // Sacs de sable en façade
    sacs(B, -56, 24, -22, 24, 2, 1.4); sacs(B, -10, 24, 10, 24, 2, 1.4);
    // Parking sous filet de camouflage
    for(const [x, z] of [[20, 30], [54, 30], [20, 54], [54, 54], [37, 42]]) B.cyl('metal', P.oliveF, x, 1.4, z, 0.4, x === 37 ? 11 : 8.5, 5);
    B.nappe('filet', 18, 28, 56, 56, 12, 9, (x, z) => 7.5 + 3.2*Math.exp(-((x-37)**2 + (z-42)**2)/60) + Math.sin(x*0.9)*0.3 + Math.cos(z*1.1)*0.3, FILET);
    camion(B, 37, 36, 0, P.olive, '#5d5a3c');
    // Fûts, groupe électrogène, projecteurs
    for(let i = 0; i < 6; i++) fut(B, -52 + (i%3)*3, 1.4, 30 + Math.floor(i/3)*3, i % 2 ? P.olive : P.rouille);
    B.boite('metal', '#5b5c49', -30, 1.4, 30, -20, 5.6, 36); B.cyl('metal', '#2f302a', -22, 5.6, 32, 0.6, 3, 6);
    for(const x of [-52, 0]) lampadaire(B, x, 20, 8, P.lumiere, P.oliveF);
    m.corps = [-54, -48, 18, 16, 18];
    m.points = [[-22, 31, -26], [-6, 38, -34], [-40, 18, 0], [36, 13, 6], [10, 18, -2]];
    const p1 = new Bati(0, 'metal2'); p1.cyl('metal', P.oliveF, 0, 0, 0, 1.2, 4, 8); parabole(p1, 0, 5.5, 0, 6.5, 0.7, 0, '#cfcbb8');
    m.anims.push({type:'balayage', vitesse:0.25, amplitude:1.1, base:-0.4, x:-8, y:31.2, z:-16, bati:p1});
    const radar = new Bati(0, 'metal2'); radar.cyl('metal', P.oliveF, 0, 0, 0, 0.8, 2.5, 8);
    radar.piece('metal2', gBoite(), '#a9a58f', 0, 4, 0, 1, 3, 11, 0.25, 0, 0); radar.boiteC('emis', P.lumiere, 0, 2.6, 0, 1.2, 0.5, 1.2);
    m.anims.push({type:'rotation', vitesse:1.1, x:-6, y:38, z:-34, bati:radar});
    const p2 = new Bati(0, 'metal2'); p2.cyl('metal', P.oliveF, 0, 0, 0, 0.7, 2.6, 8); parabole(p2, 0, 3.6, 0, 3.2, 0.4, 0, '#cfcbb8');
    m.anims.push({type:'rotation', vitesse:0.22, x:4, y:17.4, z:4, bati:p2});
  }

  // --------------------------------------------------- CASERNE HALDEN
  function caserneHalden(m, P){
    const B = m.statique;
    dalle(B, P, 38, 1.5);
    B.boite('opaque', P.asphalte, 6, 1.5, 4, 36, 1.65, 36, {ao:0});
    for(const [a, b, c, d] of [[8,6,34,6.6],[8,33.4,34,34],[8,6,8.6,34],[33.4,6,34,34],[20.7,6,21.3,34]]) B.boite('opaque', P.ligne, a, 1.65, b, c, 1.75, d, {ao:0});
    // Module nord
    B.boite('opaque', P.panneau, -36, 1.5, -36, 30, 14, -14);
    B.boite('vitre', P.vitre, -34, 5.5, -14, 28, 10, -13.4, {ao:0});
    B.boite('emis', P.lumiere, -36, 11.6, -13.9, 30, 12.2, -13.3);
    for(let x = -34; x <= 28; x += 7.75) B.boite('metal', P.acierC, x-0.3, 1.5, -13.9, x+0.3, 14, -13.2, {ao:0});
    B.boite('opaque', P.toit, -35.5, 14, -35.5, 29.5, 14.4, -14.5, {ao:0});
    B.boite('opaque', P.accent, -35.5, 14.4, -18.5, 29.5, 14.7, -15, {ao:0});
    // Étage de commandement en retrait (silhouette plus affirmée, emblème au sommet)
    B.boite('opaque', P.panneau, -35, 14.4, -35, -6, 22, -17);
    B.boite('vitre', P.vitre, -34, 16.4, -17, -7, 20.2, -16.4, {ao:0});
    B.boite('vitre', P.vitre, -6, 16.4, -34, -5.4, 20.2, -18, {ao:0});
    for(let x = -34; x <= -7; x += 4.5) B.boite('metal', P.acierC, x-0.25, 14.4, -17.1, x+0.25, 22, -16.3, {ao:0});
    B.boite('emis', P.lumiere, -35, 20.8, -16.9, -6, 21.3, -16.3);
    B.boite('opaque', P.toit, -34.6, 22, -34.6, -6.4, 22.4, -17.4, {ao:0});
    for(const [a, b, c, d] of [[-35.2,-35.2,-5.8,-34.2],[-35.2,-18,-5.8,-16.8],[-35.2,-35.2,-34.2,-16.8],[-6.8,-35.2,-5.8,-16.8]])
      B.boite('opaque', P.acier, a, 22, b, c, 23.2, d, {ao:0});
    B.boite('opaque', P.accent, -34.2, 22.4, -20.6, -6.8, 22.7, -18, {ao:0});
    B.decal(-20.5, 22.45, -27.2, 12, 12, R_EMBLEME);
    for(const x of [-2, 8, 18]){ B.boite('metal', '#b9c0c4', x, 14.4, -32, x+6, 17.4, -26); B.cyl('metal', '#3c4248', x+3, 17.4, -29, 1.6, 0.3, 10, {ao:0}); }
    // Module sud-ouest
    B.boite('opaque', P.panneau2, -36, 1.5, -4, 2, 11, 33);
    B.boite('vitre', P.vitre, 2, 5, -2, 2.6, 8.5, 31, {ao:0});
    B.boite('vitre', P.vitre, -34, 5, 33, 0, 8.5, 33.6, {ao:0});
    B.boite('emis', P.lumiere, 2, 9.4, -4, 2.7, 10, 33);
    B.boite('opaque', P.toit, -35.5, 11, -3.5, 1.5, 11.4, 32.5, {ao:0});
    B.boite('opaque', P.accent, -2.5, 11.4, -3.5, 1.5, 11.7, 32.5, {ao:0});
    B.boite('metal', '#b9c0c4', -26, 11.4, 8, -16, 14, 16);
    // Atrium vitré
    B.boite('vitre', P.vitre, -22, 1.5, -14, -6, 9.5, -4, {ao:0});
    for(const x of [-22, -14, -6]) B.boite('metal', P.acier, x-0.4, 1.5, -14, x+0.4, 10, -4, {ao:0});
    B.boite('metal', P.acier, -22.4, 9.5, -14, -5.6, 10.2, -4, {ao:0});
    // Cour : obstacles d'entraînement, mât de drapeau
    for(const z of [12, 20, 28]) B.boite('opaque', '#9aa2a8', 11, 1.65, z, 18, 3.4, z+1);
    B.cyl('metal', '#c8cdd0', 30, 1.5, 10, 0.45, 30, 8);
    B.cyl('opaque', P.acierF, 30, 1.5, 10, 1.6, 1, 8);
    lampadaire(B, 34, 30, 8, P.lumiere, P.acier);
    m.corps = [-36, -36, 30, 33, 14.5];
    m.points = [[-20, 22.5, -26], [10, 14.5, -20], [-18, 11.5, 14]];
    m.anims.push({type:'drapeau', x:30.4, y:31, z:10, long:13, haut:8.5});
  }

  // --------------------------------------------------- CASERNE KARSK
  function caserneKarsk(m, P){
    const B = m.statique;
    dalle(B, P, 38, 1.4);
    B.boite('opaque', P.asphalte, 12, 1.4, -6, 37, 1.55, 37, {ao:0});
    // Baraquements en demi-lune (tôle ondulée)
    const hutte = (x0, x1, z, r) => {
      const cx = (x0 + x1)/2, L = x1 - x0;
      B.boite('opaque', P.beton2, x0-0.8, 1.4, z-r-0.8, x1+0.8, 2.2, z+r+0.8, {ao:0});
      B.piece('opaque', gVoute(28), P.tole, cx, 2.2, z, 2*r, 2*r, L, 0, Math.PI/2, 0, {rayures:P.tole2, ao:0.2});
      for(const dx of [-L*0.25, L*0.25]) B.piece('opaque', gVoute(28), P.accent, cx + dx, 2.2, z, 2*r + 0.5, 2*r + 0.5, 3.2, 0, Math.PI/2, 0, {ao:0.15});
      B.piece('opaque', gDemiDisque(28), P.beton2, x1, 2.2, z, 2*r, 2*r, 1, 0, Math.PI/2, 0, {ao:0.1});
      B.piece('opaque', gDemiDisque(28), P.beton2, x0, 2.2, z, 2*r, 2*r, 1, 0, -Math.PI/2, 0, {ao:0.1});
      B.boite('opaque', P.accentF, x1, 2.2, z-2.6, x1+0.5, 8.5, z+2.6, {ao:0});
      B.boite('emis', P.lumiere, x1+0.3, 9.2, z-0.7, x1+0.9, 9.8, z+0.7);
      for(let x = x0 + 6; x < x1 - 3; x += 8) B.boite('vitre', P.vitre, x, 4, z+r*0.84, x+2.4, 6, z+r*0.96, {ao:0});
    };
    hutte(-35, 16, -22, 12.5);
    hutte(-35, 8, 15, 10.5);
    // Mirador en bois
    for(const [x, z] of [[24, -34], [33, -34], [24, -25], [33, -25]]) B.poutre('opaque', P.bois, x, 1.4, z, x + (x < 28 ? 1.2 : -1.2), 19, z + (z < -30 ? 1.2 : -1.2), 0.9);
    B.boite('opaque', P.bois, 23.5, 19, -34, 33.5, 20, -24.6, {ao:0});
    sacs(B, 24, -25, 33, -25, 1, 20); sacs(B, 33, -34, 33, -25, 1, 20);
    for(const [x, z] of [[24.5, -33.5], [32.5, -33.5], [24.5, -25.1], [32.5, -25.1]]) B.boite('opaque', P.bois, x-0.3, 20, z-0.3, x+0.3, 24.5, z+0.3, {ao:0});
    toleOndulee(B, 'metal', P.olive, P.oliveF, 22.5, -35, 34.5, -23.6, 24.5);
    B.boite('emis', P.lumiere, 27.5, 23.5, -25, 29.5, 24, -24.4);
    // Emblème peint au sol, mât et drapeau
    B.decal(24, 1.6, 6, 15, 15, R_EMBLEME);
    B.cyl('metal', '#bdb8a8', 26, 1.4, 26, 0.45, 30, 8);
    B.cyl('opaque', P.beton2, 26, 1.4, 26, 2, 1, 8);
    sacs(B, 18, 34, 36, 34, 2, 1.4);
    sacs(B, -36, 35, 4, 35, 2, 1.4);
    for(let i = 0; i < 4; i++) caisse(B, 13 + (i%2)*4, 1.55 + Math.floor(i/2)*2.6, 20 + (i%2), 3, i % 2 ? P.olive : '#5a5938', i*0.2);
    for(let i = 0; i < 4; i++) fut(B, 14 + i*3, 1.55, 30, i % 2 ? P.rouille : P.olive);
    lampadaire(B, 10, -6, 8, P.lumiere, P.oliveF);
    m.corps = [-35, -35, 16, 26, 15];
    m.points = [[-10, 15, -22], [-14, 13, 15], [28, 24, -29]];
    m.anims.push({type:'drapeau', x:26.4, y:31, z:26, long:13, haut:8.5});
  }

  // --------------------------------------------------- USINE HALDEN
  function usineHalden(m, P){
    const B = m.statique;
    dalle(B, P, 58, 1.5);
    B.boite('opaque', P.asphalte, -56, 1.5, 25, 56, 1.65, 56, {ao:0});
    B.boite('opaque', P.asphalte, 29, 1.5, -12, 56, 1.65, 25, {ao:0});
    for(let z = -10; z < 54; z += 8) B.boite('opaque', P.ligne, 42.6, 1.65, z, 43.4, 1.75, z+4, {ao:0});
    // Hall principal
    B.boite('opaque', P.panneau2, -54, 1.5, -52, 28, 26, 24);
    for(let y = 6; y < 25; y += 5){ B.boite('metal', '#aeb7bd', -54.4, y, 24, 28.4, y+0.4, 24.4, {ao:0}); B.boite('metal', '#aeb7bd', -54.4, y, -52, -54, y+0.4, 24, {ao:0}); }
    B.boite('emis', P.lumiere, -54.4, 25, 24.2, 28.4, 25.7, 24.8);
    // Grande porte
    B.boite('opaque', '#15181b', -40, 1.5, 24.1, -4, 22, 24.4, {ao:0});
    B.boite('metal', P.acier, -42, 1.5, 24, -40, 23.5, 25.2); B.boite('metal', P.acier, -4, 1.5, 24, -2, 23.5, 25.2);
    B.boite('metal', P.acier, -42, 22, 24, -2, 24, 25.2);
    B.boite('emis', P.lumiere, -42.2, 2, 25.2, -41.6, 23.4, 25.5); B.boite('emis', P.lumiere, -2.4, 2, 25.2, -1.8, 23.4, 25.5);
    B.decal(-22, 1.72, 28.5, 36, 6, R_DANGER);
    // Toit en sheds, vitrages tournés vers le sud
    for(let k = 0; k < 5; k++){
      const z0 = -52 + k*15.2, z1 = z0 + 15.2, L = Math.hypot(15.2, 7), a = Math.atan2(7, 15.2);
      B.piece('opaque', gBoite(), P.toit, -13, 29.5, (z0+z1)/2, 82.6, 0.6, L, -a, 0, 0, {ao:0});
      B.boite('vitre', P.vitre, -54, 26, z1-0.5, 28, 33, z1, {ao:0});
      for(const x of [-54.3, 28.3]) B.tri2('opaque', P.panneau2, [x, 26, z0], [x, 26, z1], [x, 33, z1]);
      if(k === 2) B.piece('opaque', gBoite(), P.accent, -13, 29.85, (z0+z1)/2, 82.8, 0.2, 4, -a, 0, 0, {ao:0});
    }
    // Cheminées
    for(const x of [-47, -36]){
      B.cyl('metal', P.acierC, x, 26, -46, 2.6, 26, 14);
      B.cyl('opaque', P.accent, x, 47, -46, 2.75, 2, 14, {ao:0});
      B.cyl('metal', P.acierF, x, 52, -46, 2.9, 0.8, 14, {ao:0});
      m.cheminees.push([x, 53, -46]);
    }
    // Bureaux
    B.boite('opaque', P.panneau, 30, 1.5, -52, 56, 17, -14);
    for(const y of [5, 11]){ B.boite('vitre', P.vitre, 31, y, -14, 55, y+3.4, -13.4, {ao:0}); B.boite('vitre', P.vitre, 56, y, -51, 56.6, y+3.4, -15, {ao:0}); }
    B.boite('opaque', P.toit, 30.5, 17, -51.5, 55.5, 17.4, -14.5, {ao:0});
    B.boite('emis', P.lumiere, 30, 17.4, -14.6, 56, 17.9, -14);
    B.decal(43, 17.45, -33, 19, 19, R_EMBLEME);
    // Pont roulant extérieur (rails sur poteaux)
    for(const x of [32, 54]){
      for(const z of [-9, 21, 52]) B.boite('metal', P.acier, x-1, 1.5, z-1, x+1, 22, z+1);
      B.boite('metal', P.acierF, x-1.2, 22, -10, x+1.2, 23.6, 53, {ao:0});
    }
    // Caisse de blindé en cours d'assemblage + plaques
    B.boite('metal', '#59646d', 37, 1.65, 26, 49, 6, 44, {ao:0.25});
    B.boite('metal', '#4b555d', 39, 6, 31, 47, 8.4, 40);
    for(let i = 0; i < 4; i++) B.boite('metal', '#7f8b94', 33.5, 1.65 + i*0.8, 2 + i*0.3, 41, 2.35 + i*0.8, 10 - i*0.3, {ao:0});
    for(const x of [-54, -14]) lampadaire(B, x, 30, 9, P.lumiere, P.acier);
    m.corps = [-54, -52, 28, 24, 33];
    m.points = [[-30, 33, -20], [0, 33, -40], [43, 17.5, -30], [-10, 33, 10], [-45, 33, -10]];
    const pont = new Bati(0, 'metal');
    pont.boite('opaque', P.accent, -12, 0, -1.2, 12, 2.2, 1.2);
    pont.boite('metal', P.acierF, -2, -1.6, -2, 2, 0.2, 2);
    pont.poutre('metal', '#25292d', 0, -1.6, 0, 0, -13, 0, 0.25);
    pont.boite('metal', '#d8a52c', -1.2, -15, -1.2, 1.2, -13, 1.2);
    m.anims.push({type:'pont', x:43, y:23.6, z:18, amplitude:22, bati:pont});
    const porte = new Bati(0, 'metal');
    porte.boite('metal', '#a8b2b9', -18, -20.5, 0, 18, 0, 0.6, {ao:0.15, rayures:'#929da5', parTri:2});
    porte.boite('opaque', P.accent, -18, -12, 0.62, 18, -10.5, 0.75, {ao:0});
    m.anims.push({type:'porte', x:-22, y:22, z:24.5, bati:porte});
  }

  // --------------------------------------------------- USINE KARSK
  function usineKarsk(m, P){
    const B = m.statique;
    dalle(B, P, 58, 1.4);
    B.boite('opaque', P.beton2, -56, 1.4, 23, 56, 1.55, 56, {ao:0});
    B.boite('opaque', P.beton2, 28, 1.4, -18, 56, 1.55, 23, {ao:0});
    // Hall : murs de béton, contreforts, voûte en tôle
    B.boite('opaque', P.beton, -54, 1.4, -52, 26, 20, 22);
    for(let x = -54; x <= 26; x += 10) B.boite('opaque', P.beton2, x-1.2, 1.4, 22, x+1.2, 20, 23.6, {ao:0.25});
    B.piece('opaque', gVoute(30), P.tole, -14, 20, -15, 80, 26, 74, 0, 0, 0, {rayures:P.tole2, ao:0.2});
    for(const z of [-35, -12]) B.piece('opaque', gVoute(30), P.accent, -14, 20, z, 80.6, 26.6, 4, 0, 0, 0, {ao:0.1});
    B.piece('opaque', gDemiDisque(30), P.beton2, -14, 20, 22, 80, 26, 1, 0, 0, 0, {ao:0.1});
    B.piece('opaque', gDemiDisque(30), P.beton2, -14, 20, -52, 80, 26, 1, 0, Math.PI, 0, {ao:0.1});
    for(let x = -48; x < 20; x += 9) B.boite('vitre', P.vitre, x, 13, 22, x+5, 17, 22.8, {ao:0});
    // Grande porte
    B.boite('opaque', '#151512', -36, 1.4, 22.2, 0, 17, 22.6, {ao:0});
    B.boite('opaque', P.accent, -38, 1.4, 22, -36, 19, 24.4, {ao:0}); B.boite('opaque', P.accent, 0, 1.4, 22, 2, 19, 24.4, {ao:0});
    B.boite('opaque', P.accentF, -38, 17, 22, 2, 19.5, 24.4, {ao:0});
    B.boite('emis', P.lumiere, -19, 20.2, 23.4, -17, 21, 24.4);
    B.decal(-18, 1.62, 27, 36, 6, R_DANGER);
    sacs(B, -52, 27, -40, 27, 2, 1.55); sacs(B, 4, 27, 16, 27, 2, 1.55);
    // Chaufferie et cheminées de brique
    B.boite('opaque', P.beton2, 30, 1.4, -52, 56, 14, -22);
    toleOndulee(B, 'metal', P.olive, P.oliveF, 29.5, -52.5, 56.5, -21.5, 14);
    for(const x of [37, 49]){
      B.cyl('opaque', '#8c5444', x, 14, -44, 3.4, 44, 14, {effile:0.78, ao:0.15});
      for(const y of [40, 50]) B.cyl('opaque', y === 50 ? '#dcd6c8' : P.accent, x, y, -44, 3.4*(1 - 0.22*(y-14)/44) + 0.15, 3, 14, {ao:0, effile:0.98});
      B.cyl('opaque', '#2c2a26', x, 57.7, -44, 2.75, 0.6, 14, {ao:0});
      m.cheminees.push([x, 58.5, -44]);
    }
    B.decal(43, 14.9, -30, 12, 12, R_EMBLEME);
    // Pont roulant
    for(const x of [31, 54]){
      for(const z of [-16, 18, 52]) B.boite('metal', P.oliveF, x-1, 1.55, z-1, x+1, 21, z+1);
      B.boite('metal', '#3f3e2b', x-1.2, 21, -17, x+1.2, 22.6, 53, {ao:0});
    }
    // Caisse de char et ferraille
    B.boite('metal', '#5b5a3a', 36, 1.55, 28, 49, 6.5, 46, {ao:0.25});
    B.cyl('metal', '#4e4d33', 42.5, 6.5, 37, 5, 2.6, 12);
    for(let i = 0; i < 9; i++) B.piece('metal', gCaillou(), i % 2 ? P.rouille : '#5d5a48', -50 + B.h()*14, 2.2, 36 + B.h()*16, 3 + B.h()*3, 1.6 + B.h()*2, 3 + B.h()*3, 0, B.h()*3, 0);
    for(let i = 0; i < 6; i++) fut(B, -30 + (i%3)*3, 1.55, 34 + Math.floor(i/3)*3, i % 2 ? P.olive : P.rouille);
    for(let i = 0; i < 4; i++) caisse(B, -14 + i*4.2, 1.55, 40, 3.2, P.olive, 0);
    for(const x of [-54, 22]) lampadaire(B, x, 30, 9, P.lumiere, P.oliveF);
    m.corps = [-54, -52, 26, 22, 33];
    m.points = [[-30, 31, -20], [0, 31, -38], [43, 15, -30], [-10, 33, 0], [-45, 26, -10]];
    const pont = new Bati(0, 'metal');
    pont.boite('opaque', P.accent, -12.5, 0, -1.2, 12.5, 2.2, 1.2, {rayures:'#e8e2d2', parTri:4});
    pont.boite('metal', P.oliveF, -2, -1.6, -2, 2, 0.2, 2);
    pont.poutre('metal', '#25292d', 0, -1.6, 0, 0, -12, 0, 0.25);
    pont.boite('metal', '#d8a52c', -1.2, -14, -1.2, 1.2, -12, 1.2);
    m.anims.push({type:'pont', x:42.5, y:22.6, z:18, amplitude:24, bati:pont});
    const porte = new Bati(0, 'metal');
    porte.boite('metal', P.olive, -18, -15.6, 0, 18, 0, 0.6, {ao:0.15, rayures:P.oliveF, parTri:2});
    m.anims.push({type:'porte', x:-18, y:17, z:22.7, bati:porte});
  }

  // --------------------------------------------------- RELAIS (Halden)
  function relaisHalden(m, P){
    const B = m.statique;
    dalle(B, P, 38, 1.5, '#aaa69b');
    B.decal(6, 1.55, -6, 34, 34, R_ANNEAU);
    // Clôture
    for(let i = -36; i <= 36; i += 6){
      for(const [x, z] of [[i, -36], [i, 36], [-36, i], [36, i]]) if(!(z === 36 && i > 8 && i < 22)) B.boite('metal', P.acierC, x-0.25, 1.5, z-0.25, x+0.25, 6, z+0.25, {ao:0});
    }
    for(const y of [3, 5.8]){
      B.boite('metal', P.acierC, -36, y, -36.15, 36, y+0.2, -35.85, {ao:0}); B.boite('metal', P.acierC, -36.15, y, -36, -35.85, y+0.2, 36, {ao:0});
      B.boite('metal', P.acierC, 35.85, y, -36, 36.15, y+0.2, 36, {ao:0}); B.boite('metal', P.acierC, -36, y, 35.85, 8, y+0.2, 36.15, {ao:0});
      B.boite('metal', P.acierC, 22, y, 35.85, 36, y+0.2, 36.15, {ao:0});
    }
    // Pylône
    for(const [x, z] of [[-5, -17], [17, -17], [-5, 5], [17, 5]]) B.boite('opaque', '#c9c6bd', x-2, 1.5, z-2, x+2, 3, z+2);
    treillis(B, 'metal', ['#aab4bc', '#aab4bc', '#aab4bc', P.accent], 6, -6, 2.5, 88, 22, 4, 8, 0.6);
    B.boiteC('metal', P.acierF, 6, 46, -6, 15, 0.6, 15);
    B.boiteC('metal', P.acierF, 6, 72, -6, 10, 0.6, 10);
    B.cyl('metal', P.acierC, 6, 88, -6, 0.4, 7, 6);
    B.boiteC('feux', '#ff3626', 6, 95.6, -6, 1.8, 1.8, 1.8);
    for(const [dx, dz] of [[-7, -7], [7, 7], [-7, 7], [7, -7]]) B.boiteC('feux', '#ff3626', 6+dx, 46.8, -6+dz, 1, 1, 1);
    // Panneaux sectoriels fixes
    for(const a of [0, 2.1, 4.2]) B.boiteC('metal', '#e9ecee', 6 + Math.cos(a)*3.2, 78, -6 - Math.sin(a)*3.2, 0.8, 7, 2.4, a);
    // Abri technique
    B.boite('opaque', P.panneau, -33, 1.5, 8, -9, 11, 32);
    B.boite('emis', P.lumiere, -33, 8.8, 32, -9, 9.4, 32.6); B.boite('emis', P.lumiere, -9, 8.8, 8, -8.4, 9.4, 32);
    B.boite('metal', P.acier, -24, 1.5, 32, -19, 7.6, 32.5);
    B.boite('opaque', P.toit, -32.5, 11, 8.5, -9.5, 11.4, 31.5, {ao:0});
    B.decal(-21, 11.45, 20, 15, 15, R_EMBLEME);
    B.boite('metal', '#b9c0c4', -31, 11.4, 10, -26, 14, 15);
    B.poutre('metal', P.acierF, -9, 7, 14, 2, 7, 4, 1.2);
    // Groupe électrogène en conteneur, armoires de batteries et chemin de câbles vers le pylône
    B.boite('opaque', P.panneau2, -33, 1.5, -33, -13, 9, -23);
    B.boite('opaque', P.toit, -33.3, 9, -33.3, -12.7, 9.5, -22.7, {ao:0});
    B.boite('opaque', P.accent, -33.3, 9.5, -25.4, -12.7, 9.8, -23.6, {ao:0});
    for(let x = -31; x < -14; x += 2.2) B.boite('metal', P.acierC, x, 3, -22.9, x + 1.2, 8, -22.6, {ao:0});
    B.cyl('metal', P.acierF, -16, 9.5, -30, 0.8, 4, 8); B.cyl('metal', '#2a2f33', -16, 13.5, -30, 1, 0.4, 8, {ao:0});
    for(let i = 0; i < 4; i++){
      const x = -32 + i*5;
      B.boite('metal', '#d7dcdf', x, 1.5, -16, x + 4, 6.5, -11);
      B.boite('emis', i % 2 ? '#7dff9a' : P.lumiere, x + 0.6, 5.2, -11, x + 1.6, 5.8, -10.7);
    }
    B.boite('metal', P.acierF, -13, 2.6, -28.5, -5, 3.2, -27, {ao:0});
    B.boite('metal', P.acierF, -6.5, 2.6, -28.5, -5, 3.2, -15, {ao:0});
    // Champ solaire
    for(let r = 0; r < 3; r++){
      B.piece('vitre', gBoite(), '#1d3450', 20, 4, 14 + r*7.5, 26, 0.35, 5.4, 0.35, 0, 0, {ao:0});
      B.boite('metal', P.acier, 8, 1.5, 13.8 + r*7.5, 9, 3.8, 14.8 + r*7.5); B.boite('metal', P.acier, 31, 1.5, 13.8 + r*7.5, 32, 3.8, 14.8 + r*7.5);
    }
    m.corps = [-14, -24, 26, 12, 30];
    m.points = [[6, 46, -6], [-21, 11.5, 20], [6, 72, -6]];
    const tete = new Bati(0, 'metal2'); tete.cyl('metal', P.acierF, 0, 0, 0, 1, 2, 8);
    for(const a of [0, Math.PI*2/3, Math.PI*4/3]){ tete.boiteC('metal', '#eef0f1', Math.cos(a)*3, 2.5, Math.sin(a)*3, 1, 5, 3, -a + Math.PI/2); }
    tete.boiteC('emis', P.lumiere, 0, 2.4, 0, 1.6, 0.6, 1.6);
    m.anims.push({type:'rotation', vitesse:0.5, x:6, y:84, z:-6, bati:tete});
    const pa = new Bati(0, 'metal2'); pa.poutre('metal', P.acierF, 0, 0, 0, 7, 0, 0, 0.6); parabole(pa, 8.5, 0, 0, 4.6, 0.25, 0, '#eef0ef');
    m.anims.push({type:'balayage', vitesse:0.3, amplitude:0.7, base:0, x:6, y:60, z:-6, bati:pa});
    const pb = new Bati(0, 'metal2'); pb.poutre('metal', P.acierF, 0, 0, 0, 8, 0, 0, 0.6); parabole(pb, 10, 0, 0, 5.6, 0.35, 0, '#eef0ef');
    m.anims.push({type:'rotation', vitesse:0.16, x:6, y:40, z:-6, bati:pb});
  }

  // --------------------------------------------------- DÉPÔT (Karsk)
  function depotKarsk(m, P){
    const B = m.statique;
    dalle(B, P, 38, 1.4);
    B.boite('opaque', P.beton2, -32, 1.4, -32, 18, 1.6, -8, {ao:0});
    // Citerne de carburant horizontale
    for(const x of [-22, -6, 10]) B.boite('opaque', P.beton, x-2, 1.6, -26, x+2, 5, -14);
    B.cylH('opaque', P.olive, -6, 12, -20, 8.5, 42, 'x', 22);
    for(const x of [-27, 15]) B.cylH('opaque', P.oliveF, x, 12, -20, 7.6, 1.2, 'x', 22);
    for(const x of [-16, 4]) B.cylH('opaque', P.accent, x, 12, -20, 8.7, 1.6, 'x', 22);
    B.boite('opaque', P.accent, -27, 20.3, -21.5, 15, 20.7, -18.5, {ao:0});
    B.boite('metal', '#4a4a3a', -20, 20.7, -24, 6, 21, -22, {ao:0});
    for(let x = -20; x <= 6; x += 2.6) B.boite('metal', '#4a4a3a', x-0.15, 21, -24, x+0.15, 22.4, -23.7, {ao:0});
    B.poutre('metal', '#4a4a3a', 8, 1.6, -11, 6, 20.8, -22.5, 0.4); B.poutre('metal', '#4a4a3a', 10, 1.6, -11, 8, 20.8, -22.5, 0.4);
    B.cyl('metal', '#4a4a3a', 0, 20.6, -20, 1.6, 1.4, 10);
    // Petite citerne verticale
    B.cyl('opaque', P.olive, 24, 1.4, -24, 7.5, 18, 20);
    B.cyl('opaque', P.accent, 24, 17, -24, 7.65, 2, 20, {ao:0});
    B.piece('opaque', gCone(20), P.oliveF, 24, 21.1, -24, 15.2, 2.4, 15.2, 0, 0, 0, {ao:0});
    B.poutre('metal', '#4a4a3a', 15, 6, -21, 17, 6, -22, 1.4);
    // Pompe et tuyaux
    B.boite('metal', '#5a5a44', 18, 1.4, -6, 24, 7, -2);
    B.boite('emis', '#ff3a2a', 19, 7, -4.6, 20.4, 7.6, -3.4);
    B.poutre('metal', '#3a3a30', 10, 3, -12, 18, 3, -4, 0.9);
    B.poutre('metal', '#2b2b26', 24, 3, -4, 30, 1.6, 2, 0.6);
    // Caisses sous filet de camouflage
    for(let i = 0; i < 14; i++){
      const cx = -32 + (i % 5)*6.4, cz = 8 + Math.floor(i/5)*8, n = 1 + (i*7 % 3);
      for(let k = 0; k < n; k++) caisse(B, cx + (k%2)*0.6, 1.4 + k*3, cz, 3.8, (i + k) % 3 === 0 ? P.bois : (i + k) % 3 === 1 ? P.olive : '#55553a', (B.h()-0.5)*0.3);
    }
    for(const [x, z] of [[-35, 5], [1, 5], [-35, 33], [1, 33], [-17, 19]]) B.cyl('metal', P.oliveF, x, 1.4, z, 0.4, x === -17 ? 13 : 10, 5);
    B.nappe('filet', -37, 4, 3, 35, 13, 10, (x, z) => 9.5 + 3.4*Math.exp(-((x+17)**2 + (z-19)**2)/70) - 0.6*Math.cos(x*0.7) + Math.sin(z*0.8)*0.4, FILET);
    // Fûts
    for(let i = 0; i < 12; i++) fut(B, 10 + (i%4)*3, 1.4, 10 + Math.floor(i/4)*3, [P.olive, P.rouille, P.accent, '#4b4c3a'][i % 4]);
    B.decal(26, 1.5, 24, 13, 13, R_EMBLEME);
    sacs(B, 6, 35, 36, 35, 2, 1.4); sacs(B, 35, 8, 35, 32, 2, 1.4);
    camion(B, 22, -10, 0, P.olive, '#5f5c3e');
    lampadaire(B, -34, -4, 8, P.lumiere, P.oliveF);
    m.corps = [-30, -32, 32, -6, 22];
    m.points = [[-6, 20, -20], [24, 22, -24], [-17, 12, 19], [16, 5, 14]];
  }

  // Camion-citerne de décor (cabine, châssis, cuve horizontale) ; ry : orientation, cabine vers +X local.
  function camionCiterne(B, x, z, ry, cabine, cuve, bande){
    const c = Math.cos(ry), s = Math.sin(ry), P = (dx, dz) => [x + dx*c + dz*s, z - dx*s + dz*c];
    let p = P(6, 0); B.boiteC('opaque', cabine, p[0], 4.1, p[1], 4.2, 4.6, 4.8, ry);
    p = P(7.1, 0); B.boiteC('vitre', '#2b3c4a', p[0], 5.2, p[1], 2.2, 1.5, 4.9, ry, {ao:0});
    p = P(0, 0); B.boiteC('opaque', '#2a2c2e', p[0], 2.2, p[1], 17, 1, 3.6, ry, {ao:0});
    p = P(-2.4, 0); B.piece('opaque', gCyl(16, 1), cuve, p[0], 5.4, p[1], 5.4, 10.5, 5.4, 0, ry, Math.PI/2, {ao:0});
    if(bande) B.piece('opaque', gCyl(16, 1), bande, p[0], 5.4, p[1], 5.55, 1.6, 5.55, 0, ry, Math.PI/2, {ao:0});
    for(const dx of [-6, -3.6, 6]) for(const dz of [-2.3, 2.3]){
      p = P(dx, dz); B.piece('opaque', gCyl(10,1), '#1e1f20', p[0], 1.9, p[1], 2.6, 1, 2.6, Math.PI/2, ry, 0, {ao:0});
    }
  }
  // Palette de bidons d'eau (bleus, bouchons blancs) ; couches : 1 ou 2.
  function paletteBidons(B, x, y, z, P, couches){
    B.boite('opaque', P.bois, x-3, y, z-2.4, x+3, y+0.8, z+2.4, {varia:0.15});
    for(let k = 0; k < couches; k++) for(let i = 0; i < 3; i++) for(let j = 0; j < 2; j++){
      const bx = x - 2 + i*2, bz = z - 1.1 + j*2.2, by = y + 0.8 + k*2.6;
      B.cyl('opaque', '#4f9fd3', bx, by, bz, 0.95, 2.3, 8, {varia:0.1, ao:0.15});
      B.cyl('opaque', '#eef1f2', bx, by + 2.3, bz, 0.35, 0.3, 6, {ao:0});
    }
  }

  // --------------------------------------------------- STATION DE POMPAGE (Régie des eaux)
  // Salle des pompes au nord-ouest, château d'eau au nord-est, trois groupes de pompage et leur
  // collecteur dans la cour, bassin de réserve au sud-est.
  function stationRegie(m, P0){
    const B = m.statique, P = paletteRegie(P0), h0 = 1.4;
    dalle(B, P, 38, h0);
    // Salle des pompes
    B.boite('opaque', '#9ea19b', -35, h0, -35, 4, 3.2, -9, {ao:0.1});              // soubassement
    B.boite('opaque', P.panneau, -34.6, 3.2, -34.6, 3.6, 13, -9.4);
    B.boite('opaque', P.accent, -34.9, 10.6, -34.9, 3.9, 11.8, -9.1, {ao:0});       // bandeau bleu Régie
    B.boite('opaque', P.toit, -34.2, 13, -34.2, 3.2, 13.4, -9.8, {ao:0});
    for(const [a, b, c, d] of [[-34.6,-34.6,3.6,-33.8],[-34.6,-10.2,3.6,-9.4],[-34.6,-34.6,-33.8,-9.4],[2.8,-34.6,3.6,-9.4]])
      B.boite('opaque', P.panneau2, a, 13, b, c, 14.2, d, {ao:0});                  // acrotère
    for(let x = -32; x < 0; x += 6) if(x < -16 || x > -6) B.boite('vitre', P.vitre, x, 5.6, -9.4, x + 3.6, 8.8, -8.9, {ao:0});
    for(let z = -32; z < -11; z += 6) B.boite('vitre', P.vitre, 3.6, 5.6, z, 4.1, 8.8, z + 3.6, {ao:0});
    // Porte double, encadrement bleu, éclairage
    B.boite('metal', '#9aa4aa', -15, h0, -9.4, -7, 8.4, -8.8, {ao:0.1, rayures:'#8b959b', parTri:2});
    B.boite('opaque', P.accent, -15.6, 8.4, -9.4, -6.4, 9.2, -8.6, {ao:0});
    B.boite('emis', P.lumiere, -14, 9.2, -8.9, -8, 9.6, -8.3);
    // Toit : caissons de ventilation (pales animées), emblème
    for(const z of [-32, -20]) B.boite('metal', '#c3c9cd', -14, 13.4, z, -6, 15.4, z + 8);
    B.decal(-25, 13.45, -22, 14, 14, R_EMBLEME);
    // Château d'eau
    B.cyl('opaque', '#d5d6d0', 22, h0, -20, 3.4, 25, 16, {plat:true});
    B.cyl('opaque', P.panneau, 22, 26.4, -20, 4, 6, 20, {effile:2.5, plat:true, ao:0.1});
    B.cyl('opaque', P.panneau, 22, 32.4, -20, 10, 8, 20, {ao:0.05});
    B.cyl('opaque', P.accent, 22, 35.4, -20, 10.15, 1.8, 20, {ao:0});
    B.cyl('metal', P.acierF, 22, 32.2, -20, 11.2, 0.4, 20, {ao:0});                  // coursive
    B.piece('opaque', gCone(20), P.panneau2, 22, 41.6, -20, 21, 2.4, 21, 0, 0, 0, {ao:0});
    B.cyl('metal', P.acierC, 22, 42.8, -20, 0.25, 3, 6);
    B.boiteC('feux', '#ff3626', 22, 46, -20, 1.2, 1.2, 1.2);
    for(const dx of [-0.8, 0.8]) B.boite('metal', '#5c6469', 22 + dx - 0.15, h0, -16.6, 22 + dx + 0.15, 32.2, -16.3, {ao:0});
    for(let y = 3; y < 32; y += 1.8) B.boite('metal', '#5c6469', 21, y, -16.5, 23, y + 0.2, -16.3, {ao:0});
    // Conduites : salle des pompes → château d'eau
    B.cylH('metal', P.conduite, 15.6, 4.2, -24, 1.3, 23, 'x', 12);
    B.cyl('metal', P.conduite, 26.2, h0, -24, 1.3, 26, 12);
    for(const x of [8, 18]) B.boite('opaque', '#9ea19b', x - 1, h0, -25.5, x + 1, 3, -22.5);
    B.piece('metal', gTore(), '#d23a2a', 9.5, 6.4, -24, 3, 3, 3, 0, 0, 0, {ao:0});
    B.cyl('metal', '#3a3f43', 9.5, 4.8, -24, 0.3, 1.6, 6);
    // Groupes de pompage et collecteur
    for(let i = 0; i < 3; i++){
      const x = -28 + i*11;
      B.boite('opaque', '#a9aaa3', x - 4.5, h0, 2, x + 4.5, 2.6, 10);
      B.cylH('metal', P.accent, x + 1.6, 5, 6, 2.1, 5.4, 'x', 14);                   // moteur électrique
      for(let k = 0; k < 4; k++) B.cylH('metal', P.accentF, x - 0.2 + k*1.2, 5, 6, 2.25, 0.3, 'x', 14);
      B.boite('metal', '#4d565c', x - 0.6, 2.6, 4.4, x + 4.6, 3.2, 7.6, {ao:0});
      B.cyl('metal', '#5a6a74', x - 2.6, 2.6, 6, 1.9, 4, 12);                        // corps de pompe
      B.cylH('metal', P.conduite, x - 2.6, 4.2, -2.6, 0.9, 13.2, 'z', 10);           // refoulement vers la salle
      B.cylH('metal', P.conduite, x - 2.6, 3.4, 12, 0.9, 8, 'z', 10);                // aspiration
      B.cyl('metal', '#3a3f43', x - 2.6, 6.6, 6, 0.25, 1.4, 6);
      B.piece('metal', gTore(), '#d23a2a', x - 2.6, 8.1, 6, 2.4, 2.4, 2.4, 0, 0, 0, {ao:0});
    }
    B.cylH('metal', P.conduite, -8.5, 3.4, 16, 1.7, 57, 'x', 14);
    for(let x = -34; x <= 18; x += 8) B.boite('opaque', '#9ea19b', x - 1, h0, 14.5, x + 1, 2.2, 17.5);
    B.cylH('metal', P.conduite, 20, 3.4, 19.5, 1.7, 7, 'z', 14);
    // Bassin de réserve
    for(const [a, b, c, d] of [[12,22,35,23.6],[12,34,35,35.6],[12,23.6,13.6,34],[33.4,23.6,35,34]])
      B.boite('opaque', '#c9c6bc', a, h0, b, c, 3.8, d, {ao:0.2});
    B.boite('vitre', P.eau, 13.6, h0, 23.6, 33.4, 3.1, 34, {ao:0});
    for(let x = 14; x < 34; x += 2.4) B.boite('metal', P.acierC, x, 3.8, 22.6, x + 0.25, 5.2, 22.9, {ao:0});
    B.boite('metal', P.acierC, 12, 5.2, 22.6, 35, 5.45, 22.9, {ao:0});
    // Armoires électriques, transformateur, véhicule de service
    for(let i = 0; i < 3; i++){
      const x = -2 + i*4.4;
      B.boite('metal', '#d7dcdf', x, h0, -4, x + 3.6, 7, -1.2);
      B.boite('emis', i % 2 ? '#7dff9a' : P.lumiere, x + 0.6, 5.6, -1.2, x + 1.6, 6.2, -0.9);
    }
    B.boite('metal', '#6f7a80', 4, h0, 4, 10, 8, 10);
    for(const x of [5, 7, 9]) B.cyl('metal', '#c4b49a', x, 8, 7, 0.45, 2.4, 6);
    vehicule(B, -20, 28, 0, '#eef1f2');
    B.boite('opaque', P.accent, -24.5, 3.95, 25.9, -15.5, 4.3, 30.1, {ao:0});
    lampadaire(B, -34, 20, 8, P.lumiere, P.acier); lampadaire(B, 6, 31, 8, P.lumiere, P.acier);
    m.corps = [-35, -35, 4, -9, 14];
    m.points = [[-16, 14, -22], [22, 40, -20], [-17, 6, 6], [0, 7, -2]];
    for(const z of [-28, -16]){
      const v = new Bati(0, 'metal2');
      v.cyl('metal', '#3a4046', 0, 0, 0, 0.6, 0.6, 8);
      for(let k = 0; k < 4; k++) v.boiteC('metal', '#9aa4aa', 0, 0.4, 0, 6.4, 0.2, 1.2, k*Math.PI/4);
      m.anims.push({type:'rotation', vitesse:5, x:-10, y:15.4, z, bati:v});
    }
  }

  // --------------------------------------------------- ENTREPÔT (Régie des eaux)
  // Hangar à voûte en tôle ondulée, quai de chargement couvert à l'est avec camion-citerne,
  // palettes de bidons d'eau dans la cour, bureau et mât de drapeau au sud-est.
  function entrepotRegie(m, P0){
    const B = m.statique, P = paletteRegie(P0), h0 = 1.4;
    dalle(B, P, 38, h0);
    // Hangar : murs bas, voûte nervurée, pignons
    const x0 = -35, x1 = 5, z0 = -35, z1 = 5, hm = 9, fl = 10, cx = (x0 + x1)/2;
    B.boite('opaque', P.beton2, x0, h0, z0, x1, 3, z1, {ao:0.1});
    B.boite('opaque', P.panneau, x0 + 0.2, 3, z0 + 0.2, x1 - 0.2, hm, z1 - 0.2);
    B.boite('opaque', P.accent, x0, hm - 1.4, z0, x1, hm - 0.4, z1, {ao:0});
    B.piece('opaque', gVoute(18), P.tole, cx, hm, (z0 + z1)/2, x1 - x0, 2*fl, z1 - z0, 0, 0, 0, {rayures:P.tole2, parTri:2, ao:0});
    B.piece('opaque', gDemiDisque(18), P.panneau2, cx, hm, z1 - 0.15, x1 - x0, 2*fl, 1, 0, 0, 0, {ao:0});
    B.piece('opaque', gDemiDisque(18), P.panneau2, cx, hm, z0 + 0.15, x1 - x0, 2*fl, 1, 0, Math.PI, 0, {ao:0});
    // Lanterneau translucide au faîte
    B.boite('vitre', '#8fb3c9', x0 + 2, hm + fl - 0.4, -26, x1 - 2, hm + fl + 0.5, -14, {ao:0});
    // Grande porte roulante au sud, encadrement bleu
    B.boite('metal', '#a8b2b9', -25, h0, z1 - 0.2, -5, 8.2, z1 + 0.4, {ao:0.15, rayures:'#929da5', parTri:2});
    B.boite('opaque', P.accent, -26, 8.2, z1 - 0.2, -4, 9.2, z1 + 0.6, {ao:0});
    B.boite('opaque', P.accent, -26, h0, z1 - 0.2, -25, 8.2, z1 + 0.6, {ao:0});
    B.boite('opaque', P.accent, -5, h0, z1 - 0.2, -4, 8.2, z1 + 0.6, {ao:0});
    B.boite('emis', P.lumiere, -20, 13.2, z1 + 0.1, -10, 13.7, z1 + 0.6);
    // Bandes vitrées hautes sur le flanc ouest
    for(let z = -32; z < 2; z += 6) B.boite('vitre', P.vitre, x0 - 0.5, 5.4, z, x0, 7.2, z + 4, {ao:0});
    // Quai de chargement couvert (est)
    B.boite('opaque', P.beton, x1, h0, -31, 20, 4.6, 2, {ao:0.2});
    B.boite('opaque', '#d8a52c', 19.4, 4.6, -31, 20, 4.75, 2, {ao:0});
    for(const z of [-27, -19, -11, -3]) B.boite('opaque', '#1f2022', 20, 2.4, z - 1.4, 20.8, 4.2, z + 1.4, {ao:0});
    for(const z of [-26, -12]) B.boite('metal', '#9aa4aa', x1, 4.6, z, x1 + 0.5, 8.6, z + 8, {ao:0.1, rayures:'#8b959b', parTri:2});
    B.boite('opaque', P.beton2, 20, h0, -31, 26, 4.6, -27, {ao:0});                  // rampe (marche)
    for(const z of [-31.5, -14, 3]) B.cyl('metal', P.acier, 21.5, h0, z, 0.45, 11.6, 8);
    toleOndulee(B, 'metal', P.tole, P.tole2, x1, -33, 23, 4.5, 12.6);                  // auvent en tôle claire
    B.boite('opaque', P.accent, 22.4, 12.4, -33, 23, 13, 4.5, {ao:0});
    B.boite('emis', P.lumiere, 10, 12.6, -20, 16, 13, -18);
    paletteBidons(B, 11, 4.6, -24, P, 2); paletteBidons(B, 11, 4.6, -16, P, 1); paletteBidons(B, 16, 4.6, -8, P, 2);
    camionCiterne(B, 30, -19, 0, P.panneau, '#dfe5e8', P.accent);
    // Cour : palettes de bidons, cartons, chariot élévateur
    for(let i = 0; i < 8; i++){
      const x = -30 + (i % 4)*8, z = 13 + Math.floor(i/4)*8;
      if(i === 5) continue;
      if(i % 3 === 2){
        B.boite('opaque', P.bois, x - 3, h0, z - 2.4, x + 3, h0 + 0.8, z + 2.4, {varia:0.15});
        for(let k = 0; k < 2; k++) caisse(B, x + (k ? 1.2 : -1.3), h0 + 0.8, z, 2.6, '#c4a679', (B.h() - 0.5)*0.4);
      } else paletteBidons(B, x, h0, z, P, 1 + (i % 2));
    }
    // Chariot élévateur (orange de sécurité)
    B.boite('opaque', '#e0912c', -11.5, 2.4, 19, -6.5, 5, 22.6);
    B.boite('metal', '#2d3135', -10.5, 5, 19.4, -8, 8.6, 22.2, {ao:0});
    B.boite('metal', '#2d3135', -12.4, h0, 19.2, -11.7, 10, 22.4, {ao:0});
    for(const z of [19.6, 22]) B.boite('metal', '#4a4f53', -15.6, h0 + 0.3, z - 0.3, -12.4, h0 + 0.6, z + 0.3, {ao:0});
    for(const x of [-11, -7]) for(const z of [18.9, 22.7]) B.piece('opaque', gCyl(10,1), '#1e1f20', x, 2.4, z, 2, 0.6, 2, Math.PI/2, 0, 0, {ao:0});
    // Bureau et mât de drapeau
    B.boite('opaque', P.panneau, 24, h0, 9, 36, 8, 22);
    B.boite('opaque', P.accent, 23.8, 6.2, 8.8, 36.2, 7, 22.2, {ao:0});
    B.boite('opaque', P.toit, 24.2, 8, 9.2, 35.8, 8.4, 21.8, {ao:0});
    for(const x of [26, 31]) B.boite('vitre', P.vitre, x, 3.4, 22, x + 3.4, 5.6, 22.5, {ao:0});
    B.boite('metal', P.acier, 24, h0, 15, 23.5, 6, 18, {ao:0});
    B.decal(30, 8.45, 15.5, 10, 10, R_EMBLEME);
    B.cyl('metal', '#c8cdd0', 30, h0, 29, 0.45, 30, 8);
    B.cyl('opaque', P.acierF, 30, h0, 29, 1.6, 1, 8);
    vehicule(B, 10, 30, 0, '#eef1f2');
    lampadaire(B, -34, 9, 8, P.lumiere, P.acier); lampadaire(B, 2, 34, 8, P.lumiere, P.acier);
    m.corps = [-35, -35, 5, 5, 19];
    m.points = [[-15, 19, -15], [12, 13, -14], [-18, 4, 18], [30, 8, 15]];
    m.anims.push({type:'drapeau', x:30.4, y:30.4, z:29, long:13, haut:8.5});
  }

  // --------------------------------------------------- TOURELLE AUTOMATIQUE (Halden)
  // Socle octogonal à liseré lumineux, tourelle anguleuse téléopérée (capteur optique),
  // canon automatique qui pivote vers b.angleT et recule au tir. Emprise 40 × 40.
  function tourelleHalden(m, P){
    const B = m.statique;
    dalle(B, P, 17, 1.5);
    B.cyl('opaque', P.acierF, 0, 1.5, 0, 13, 1.4, 8, {plat:true, ao:0.2});
    B.cyl('opaque', P.panneau2, 0, 2.9, 0, 12, 2.6, 8, {plat:true, effile:0.86});
    B.cyl('emis', P.accent, 0, 3.9, 0, 11.75, 0.35, 8, {plat:true, effile:0.98});
    B.cyl('metal', P.acier, 0, 5.5, 0, 7.6, 0.6, 16, {ao:0});
    // Trappe d'accès, boîtier de capteurs, chemin de câbles
    B.boite('metal', P.acierC, 6, 2.9, 5, 9, 4.8, 8.2, {ao:0.1});
    B.boite('metal', P.acierF, -14.5, 1.5, -14.5, -10.5, 5.5, -10.5);
    B.boite('emis', '#7dff9a', -13.6, 4.2, -10.5, -12.6, 4.8, -10.2);
    B.boite('metal', P.acierF, -10.5, 1.55, -12.8, -6, 2.1, -11.8, {ao:0});
    for(const [x, z] of [[14, -14], [-14, 14], [14, 14]]) B.boite('opaque', '#d2cfc6', x - 0.8, 1.5, z - 0.8, x + 0.8, 3.4, z + 0.8, {ao:0.2});
    m.corps = [-13, -13, 13, 13, 11];
    m.points = [[0, 10, 0], [-5, 5, 6]];
    // Tourelle (pivot) : caisse anguleuse en tronc de pyramide, glacis avant, capteur
    const T = new Bati(0, 'metal');
    T.cyl('metal', P.acierF, 0, 0, 0, 6.4, 1.2, 16, {ao:0});
    T.piece('metal', gPyr(0.72), P.panneau, -0.6, 3.6, 0, 11.5, 4.8, 9.5, 0, 0, 0, {ao:0.2});
    T.piece('metal', gBoite(), P.panneau2, 4.6, 3.2, 0, 3.4, 4.2, 7.4, 0, 0, -0.55, {ao:0.1});
    T.boite('metal', P.accent, -4.6, 5.95, -3.1, 1.8, 6.15, -1.9, {ao:0});
    T.boite('metal', P.accent, -4.6, 5.95, 1.9, 1.8, 6.15, 3.1, {ao:0});
    T.boite('metal', P.acierF, -4.2, 6, -1.4, -0.4, 7.8, 1.4);                         // capteur optique
    T.boite('emis', P.lumiere, -0.45, 6.5, -0.9, -0.1, 7.3, 0.9);
    T.boite('metal', P.acierF, -7, 2.2, -2.2, -5.4, 5, 2.2);                           // caisson de munitions arrière
    T.cyl('metal', P.acierC, -5.6, 7.8, 2.4, 0.15, 3.2, 5);                           // antenne
    // Canon (enfant, recule le long de -X)
    const C = new Bati(0, 'metal');
    C.cylH('metal', P.acierF, 1.8, 0, 0, 1.25, 4, 'x', 12);
    C.cylH('metal', '#2d3338', 8.5, 0, 0, 0.62, 12, 'x', 10);
    C.boiteC('metal', '#2d3338', 14.6, 0, 0, 1.8, 1.5, 1.5);
    for(const x of [6, 10]) C.cylH('metal', P.acier, x, 0, 0, 0.85, 0.5, 'x', 10);
    m.anims.push({type:'arme', x:0, y:6.1, z:0, bati:T, enfant:{x:3.6, y:3.4, z:0, bati:C}, recul:2.2});
  }

  // --------------------------------------------------- BUNKER (Karsk)
  // Casemate de béton biseautée à demi enterrée dans un talus de terre, sacs de sable en façade,
  // meurtrières, mitrailleuses jumelées sous bouclier qui pivotent vers b.angleT. Emprise 40 × 40.
  function bunkerKarsk(m, P){
    const B = m.statique;
    // Talus de terre (pas de dalle : l'ouvrage est enterré)
    B.piece('opaque', gPyr(0.5), '#8a7c58', 0, 1.3, 0, 38, 3.8, 38, 0, 0, 0, {ao:0.45, varia:0.05});
    B.piece('opaque', gPyr(0.8), '#7d7151', 0, 3.6, 0, 24, 1.6, 24, 0, 0, 0, {ao:0.2});
    // Casemate octogonale biseautée
    B.cyl('opaque', P.beton, 0, 1, 0, 12.6, 8, 8, {plat:true, effile:0.8, ao:0.35});
    B.cyl('opaque', P.beton2, 0, 9, 0, 10.4, 0.9, 8, {plat:true, effile:0.96, ao:0});
    B.cyl('opaque', P.accent, 0, 9.9, 0, 9.98, 0.22, 8, {plat:true, ao:0});
    B.cyl('opaque', P.beton, 0, 10.12, 0, 9.6, 0.25, 8, {plat:true, ao:0});
    // Meurtrières sur les faces avant et latérales (faces de l'octogone : normales à k·π/4 + π/8)
    for(let k = 0; k < 8; k++){
      const a = k*Math.PI/4 + Math.PI/8;
      if(Math.sin(a) < -0.5) continue;   // pas de meurtrière côté nord (entrée)
      // Rayon de l'apothème à mi-hauteur de la meurtrière ; inclinaison = pente des faces (≈ 0,31 rad)
      const r = 10.35, x = Math.cos(a)*r, z = Math.sin(a)*r;
      B.piece('opaque', gBoite(), '#1b1a16', x, 5.6, z, 0.9, 1.1, 4.2, 0, -a, 0.31, {ao:0});
    }
    // Entrée au nord : avant-corps en béton, porte blindée
    B.boite('opaque', P.beton2, -4, 0, -15.5, 4, 6.4, -9.5, {ao:0.3});
    B.boite('opaque', P.beton, -4.4, 6.4, -16, 4.4, 7.2, -9.5, {ao:0});
    B.boite('metal', P.oliveF, -2.2, 0.8, -15.8, 2.2, 5.4, -15.4, {ao:0.1});
    B.boite('opaque', P.accent, -2.6, 5.4, -15.9, 2.6, 5.9, -15.4, {ao:0});
    // Sacs de sable sur l'avant (posés sur le talus)
    for(let i = 0; i < 9; i++){
      const a0 = Math.PI*(0.05 + i*0.1), a1 = a0 + 0.1;
      sacs(B, Math.cos(a0)*16, Math.sin(a0)*16, Math.cos(a1)*16, Math.sin(a1)*16, 2, 0.8);
    }
    sacs(B, -16, -2, -16, -9, 2, 0.8); sacs(B, 16, -2, 16, -9, 2, 0.8);
    // Caisses de munitions et fûts près de l'entrée
    caisse(B, -8, 1.5, -15, 2.6, P.olive, 0.2); caisse(B, -5.6, 1.5, -16.4, 2.4, P.olive, -0.1);
    fut(B, 7, 1.5, -15, P.olive); fut(B, 9.6, 1.5, -14, P.rouille);
    B.decal(-4.4, 10.42, -4.4, 5.5, 5.5, R_EMBLEME);
    m.corps = [-12, -12, 12, 12, 10];
    m.points = [[0, 10, 0], [-7, 6, 4], [6, 6, 5]];
    // Affût (pivot) : couronne, bouclier, caisse de bandes
    const T = new Bati(0, 'metal');
    T.cyl('metal', P.oliveF, 0, 0, 0, 3.2, 1, 12, {ao:0});
    T.cyl('metal', '#3a3a30', 0, 1, 0, 0.6, 2, 8);
    T.piece('metal', gBoite(), P.olive, 3.4, 3.4, 0, 0.6, 3.4, 7.2, 0, 0, 0.18, {ao:0.1});
    T.boite('metal', P.accent, 3.1, 4.9, -3.6, 3.9, 5.3, 3.6, {ao:0});
    T.boite('metal', '#4a4a3a', -1.8, 2.2, 1.6, 0.6, 3.6, 3.4);
    T.boite('metal', P.oliveF, -3, 1, -1.2, -1.4, 3.6, 1.2);                          // poignées / tireur
    // Mitrailleuses jumelées (enfant, léger recul)
    const C = new Bati(0, 'metal');
    for(const dz of [-1.1, 1.1]){
      C.boite('metal', '#2e2f2a', -1.6, -0.6, dz - 0.5, 1.4, 0.6, dz + 0.5);
      C.cylH('metal', '#23241f', 4.6, 0, dz, 0.42, 7, 'x', 8);
      C.cylH('metal', '#3d3e36', 2.2, 0, dz, 0.62, 2.2, 'x', 8);
    }
    C.boite('metal', '#4a4a3a', -0.8, -1.6, -2.4, 0.8, -0.4, -1.4);
    m.anims.push({type:'arme', x:0, y:10.3, z:0, bati:T, enfant:{x:0.8, y:3, z:0, bati:C}, recul:0.6});
  }

  // --------------------------------------------------- BATTERIE MIXTE (les deux camps)
  // Défense sol-air : bastion de béton surélevé, affût haut perché sur un fût, canon automatique
  // jumelé à droite et caisson de quatre missiles incliné vers le ciel à gauche, antenne radar
  // tournante sur mât d'angle. Se lit d'emblée comme différente de la tourelle (socle octogonal bas,
  // canon unique) et du bunker (talus de terre). Halden : bastion carré, livrée claire, liseré
  // lumineux ; Karsk : bastion hexagonal, sacs de sable, livrée olive et bandes rouges. Emprise 40 × 40.
  function batterie(m, P, K){
    const B = m.statique, beton = K ? P.beton : '#b4b0a4', beton2 = K ? P.beton2 : '#98958a';
    const coque = K ? P.olive : P.panneau, coque2 = K ? P.oliveF : P.panneau2, sombre = K ? '#3a3a30' : P.acierF;
    dalle(B, P, 17, 1.5);
    // Bastion (le volume qui porte l'affût en hauteur)
    if(K){
      B.cyl('opaque', beton, 0, 1.5, 0, 14, 3.8, 6, {plat:true, effile:0.86, ao:0.35});
      B.cyl('opaque', P.accent, 0, 4.5, 0, 12.25, 0.6, 6, {plat:true, ao:0});
      B.cyl('opaque', beton2, 0, 5.1, 0, 12.1, 0.4, 6, {plat:true, ao:0});
      for(let k = 0; k < 6; k++){
        if(k === 4) continue;   // passage côté nord-ouest vers le mât radar
        const a0 = k*Math.PI/3 + 0.12, a1 = (k + 1)*Math.PI/3 - 0.12, r = 9.2;
        sacs(B, Math.cos(a0)*r, Math.sin(a0)*r, Math.cos(a1)*r, Math.sin(a1)*r, 1, 5.5);
      }
    } else {
      B.piece('opaque', gPyr(0.88), beton, 0, 3.3, 0, 25, 3.6, 25, 0, 0, 0, {ao:0.35});
      B.boite('emis', P.accent, -11.3, 4.35, -11.3, 11.3, 4.75, 11.3, {ao:0});
      B.boite('opaque', beton2, -10.6, 5.1, -10.6, 10.6, 5.5, 10.6, {ao:0});
      // Bandes de danger peintes au pied du fût
      for(const [x, z] of [[-6, 0], [6, 0], [0, -6], [0, 6]]) B.boiteC('opaque', '#e8c23a', x, 5.55, z, Math.abs(x) ? 0.8 : 3.4, 0.08, Math.abs(z) ? 0.8 : 3.4, 0, {ao:0});
    }
    // Fût de l'affût
    B.cyl('metal', sombre, 0, 5.5, 0, 3.4, 1, 12, {ao:0.2});
    B.cyl('metal', K ? '#4a4a3a' : P.acier, 0, 6.5, 0, 2.5, 2.5, 12, {ao:0});
    // Mât radar d'angle (nord-ouest) et armoire électronique
    const mx = -8.2, mz = -8.2, hm = 15;
    B.cyl('metal', sombre, mx, 5.5, mz, 1.3, 1, 8, {ao:0});
    if(K){
      for(const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [0, 1]]) B.poutre('metal', '#4a4a3a', mx + dx*1.6, 6.5, mz + dz*1.6, mx, hm, mz, 0.35);
    } else B.cyl('metal', P.acierC, mx, 6.5, mz, 0.5, hm - 6.5, 8);
    B.boite('metal', coque2, mx + 2.2, 5.5, mz - 1.2, mx + 5.6, 8.6, mz + 1.4, {ao:0.15});
    B.boite('emis', K ? '#ffcf7a' : '#7dff9a', mx + 5.6, 7.4, mz - 0.6, mx + 5.8, 7.9, mz + 0.2, {ao:0});
    // Caisses de munitions sur le pont, emblème
    caisse(B, 7.6, 5.5, -7.4, 2.4, K ? P.olive : P.acierF, 0.2);
    caisse(B, 7.8, 5.5, -4.8, 2.2, K ? P.olive : P.acierF, -0.1);
    B.decal(-6.8, 5.6, 7, 5, 5, R_EMBLEME);
    m.corps = [-12.5, -12.5, 12.5, 12.5, 15];
    m.points = [[0, 13, 0], [-8, 13, -8], [5, 7, 6]];
    // Antenne radar tournante (panneau plat incliné, plus une ligne de rayonnement)
    const R = new Bati(0);
    R.cyl('metal', sombre, 0, 0, 0, 0.9, 0.8, 8);
    R.piece('metal', gBoite(), coque, 0.6, 2.6, 0, 0.5, 3.6, 8, 0, 0, -0.3, {ao:0});
    R.piece('metal', gBoite(), K ? P.accent : P.accent, 0.82, 4.3, 0, 0.55, 0.5, 8.1, 0, 0, -0.3, {ao:0});
    R.boite('metal', sombre, -1.4, 0.8, -0.6, 0.2, 2, 0.6);
    m.anims.push({type:'rotation', vitesse:K ? 1.6 : 2.1, x:mx, y:hm, z:mz, bati:R});
    // Affût (pivot) : plateau tournant, berceau central, caisson de missiles côté -Z
    const T = new Bati(0);
    T.cyl('metal', sombre, 0, 0, 0, 4.4, 0.9, 14, {ao:0});
    T.boite('metal', coque, -2.8, 0.9, -1.8, 2.4, 4.8, 1.8, {ao:0.15});
    T.boite('metal', sombre, -4.6, 1.1, -1.4, -2.8, 3.8, 1.4, {ao:0});                         // caisson de bandes arrière
    T.boite('metal', P.accent, -2.85, 4.1, -1.85, 2.45, 4.5, 1.85, {ao:0});                    // bandeau de camp
    T.boite('metal', sombre, -0.8, 1.6, -2.6, 0.8, 4.2, 2.6, {ao:0});                          // tourillons
    const t = 0.48, ca = Math.cos(t), sa = Math.sin(t), cx = 0.6, cy = 4.4, cz = -4.6, L = 7.4;
    T.piece('metal', gBoite(), coque2, cx, cy, cz, L, 3.8, 3.6, 0, 0, t, {ao:0.1});
    T.piece('metal', gBoite(), P.accent, cx - ca*1.4, cy - sa*1.4, cz, 1.1, 3.95, 3.75, 0, 0, t, {ao:0});
    for(const dn of [-0.9, 0.9]) for(const dz of [-0.85, 0.85]){
      const px = cx + ca*(L/2) - sa*dn, py = cy + sa*(L/2) + ca*dn;
      T.piece('metal', gCyl(10, 1), '#15181a', px, py, cz + dz, 1.3, 0.12, 1.3, 0, 0, t - Math.PI/2, {ao:0});
      T.piece('emis', gCyl(8, 0.4), K ? '#ffb04a' : '#ff6a4a', px + ca*0.3, py + sa*0.3, cz + dz, 1, 0.5, 1, 0, 0, t - Math.PI/2, {ao:0});   // ogives
    }
    // Carter du canon côté +Z
    T.boite('metal', coque, -2.6, 1.8, 2.4, 2.8, 4.8, 5.4, {ao:0.1});
    T.boite('metal', sombre, -0.5, 4.8, 3, 1.5, 5.8, 4.8);                                     // viseur
    T.boite('emis', K ? P.lumiere : P.lumiere, 1.5, 5.05, 3.4, 1.6, 5.55, 4.4, {ao:0});
    // Canon automatique jumelé (enfant, recule le long de -X)
    const C = new Bati(0, 'metal');
    C.cylH('metal', sombre, 1.2, 0, 0, 1.05, 2.6, 'x', 10);
    for(const dz of [-0.62, 0.62]){
      C.cylH('metal', '#2a2f33', 5.6, 0, dz, 0.36, 9, 'x', 8);
      C.cylH('metal', '#3b4246', 9.6, 0, dz, 0.55, 1.4, 'x', 8);
    }
    // Lueur de départ (enfant du canon, visible un instant après b.tirT)
    const E = new Bati(0, 'emis');
    E.boiteC('emis', '#ffe1a0', 0, 0, 0, 3, 0.9, 2.4, 0, {ao:0});
    E.piece('emis', gBoite(), '#ffb85a', 0.4, 0, 0, 1.6, 2.2, 1.2, 0, 0, 0, {ao:0});
    m.anims.push({type:'arme', x:0, y:9, z:0, bati:T, enfant:{x:2.6, y:3.3, z:3.9, bati:C, eclair:{x:11.6, y:0, z:0, bati:E}}, recul:1.6});
  }
  function batterieHalden(m, P){ batterie(m, P, false); }
  function batterieKarsk(m, P){ batterie(m, P, true); }

  // =================================================================
  //  AÉROPORT (Halden et Karsk) — emprise 160 × 160
  // =================================================================
  // Disposition imposée par le moteur (décalages par rapport au centre, +x = est, +z = sud).
  const H_PISTE = 1.0;      // hauteur du tarmac et de la piste au-dessus du sol (dalle plus basse que
                            // celle des autres bâtiments : les avions y roulent)
  const AERO = {places:[[-55, -15], [-15, -15], [25, -15]], tour:[60, -58]};

  // Sol commun aux deux camps : dalle, piste balisée (marquages, feux), tarmac à trois places.
  // S : teintes du camp {asphalte, asphalte2, gomme, ligne, jaune, rouge, feuBord, projecteur, reprises}.
  function solAeroport(B, P, S){
    const h = H_PISTE, ya = h + 0.14, yl = ya + 0.09, yj = h + 0.09;
    dalle(B, P, 78, h, null, {enterre:2.6});
    const L = (x0, z0, x1, z1, c) => B.boite('opaque', c || S.ligne, x0, ya, z0, x1, yl, z1, {ao:0});   // peinture sur la piste
    const J = (x0, z0, x1, z1, c) => B.boite('opaque', c || S.jaune, x0, h, z0, x1, yj, z1, {ao:0});    // peinture sur le tarmac
    // ---- Piste d'est en ouest : enrobé, reprises, traces de gomme aux zones de toucher
    B.boite('opaque', S.asphalte, -77.5, h, 30, 77.5, ya, 75, {ao:0});
    for(const [x0, z0, x1, z1] of S.reprises) B.boite('opaque', S.asphalte2, x0, h, z0, x1, ya + 0.035, z1, {ao:0});
    for(const sx of [-1, 1]) for(const [z, l] of [[49.6, 30], [50.9, 22], [54.2, 26], [55.5, 34]])
      B.boite('opaque', S.gomme, sx*12, h, z - 0.3, sx*(12 + l), ya + 0.065, z + 0.3, {ao:0});
    // ---- Marquages : bandes latérales, axe, peignes de seuil, zones de toucher, numéros
    L(-75.5, 31.2, 75.5, 31.9); L(-75.5, 73.1, 75.5, 73.8);
    for(let cx = -42; cx <= 42; cx += 14) L(cx - 4, 52.1, cx + 4, 52.9);
    for(const sx of [-1, 1]){
      for(const zc of [36.5, 40.5, 44.5, 48.5, 56.5, 60.5, 64.5, 68.5]) L(sx*62, zc - 1.2, sx*73, zc + 1.2);
      for(const [z0, z1] of [[43.5, 47], [58, 61.5]]) L(sx*26, z0, sx*34, z1);
    }
    B.decal(-54, ya + 0.05, 52.5, 13, 13, R_PISTE09, -Math.PI/2);   // se lit en roulant vers l'est
    B.decal(54, ya + 0.05, 52.5, 13, 13, R_PISTE27, Math.PI/2);     // se lit en roulant vers l'ouest
    // ---- Balisage lumineux (bas : rien ne dépasse de plus de 1 au-dessus de la piste)
    const feu = (x, y, z, c, t, r, g) => {
      B.boiteC('emis', c, x, y + t*0.4, z, t, t*0.8, t);
      B.halo(x, y + t, z, r, c, 'nuit', g === undefined ? 0.85 : g);
    };
    for(let x = -66; x <= 66; x += 12){ feu(x, ya, 30.55, S.feuBord, 0.9, 3.2); feu(x, ya, 74.45, S.feuBord, 0.9, 3.2); }   // feux de bord
    for(let i = 0; i < 8; i++){ const z = 34 + i*5.3; feu(-76.6, ya, z, '#49ff8c', 0.8, 2.7); feu(76.6, ya, z, '#ff4f3d', 0.8, 2.7); }   // seuil vert, extrémité rouge
    for(let x = -35; x <= 35; x += 14) feu(x, ya - 0.2, 52.5, '#fff6dd', 0.6, 1.9, 0.6);                                    // feux d'axe encastrés
    // Indicateur de pente d'approche : quatre boîtiers, deux rouges et deux blancs
    for(let i = 0; i < 4; i++){
      const x = -61 + i*3.2, c = i < 2 ? '#ff4f3d' : '#fff6dd';
      B.boite('metal', '#3a3f45', x - 0.8, h, 76, x + 0.8, h + 1, 77.1);
      B.boite('emis', c, x - 0.55, h + 0.35, 76.9, x + 0.55, h + 1.06, 77.2);
      B.halo(x, h + 0.9, 77.2, 1.8, c, 'nuit', 0.6);
    }
    // ---- Tarmac : trois places, nez au sud
    AERO.places.forEach(([px, pz], i) => {
      J(px - 0.3, pz - 18, px + 0.3, 25.4);                                         // axe de roulage vers la piste
      J(px - 4, pz + 21, px + 4, pz + 21.6);                                        // barre d'arrêt du train avant
      J(px - 7, 25.4, px + 7, 26); J(px - 7, 26.8, px + 7, 27.4);                   // point d'attente : deux traits pleins…
      for(let k = 0; k < 4; k++) J(px - 6.7 + k*3.6, 28.2, px - 4.1 + k*3.6, 28.8); // … et un trait interrompu
      // Cadre de la place : quatre équerres claires
      const l = 5, e = 0.25;
      for(const [cx, sx] of [[px - 17, 1], [px + 17, -1]]) for(const [cz, sz] of [[pz - 19, 1], [pz + 19, -1]]){
        J(cx, cz - e, cx + sx*l, cz + e, S.ligne); J(cx - e, cz, cx + e, cz + sz*l, S.ligne);
      }
      B.decal(px + 5.5, h + 0.05, pz + 27, 7, 7, R_PLACES[i]);                      // numéro de la place
      for(const z of [pz + 25, pz + 35]) for(const sx of [-1, 1]) feu(px + sx*11, h, z, '#4f8dff', 0.6, 2.1, 0.7);   // balises bleues de la voie
      B.flaque(px, h + 0.34, pz, 21, S.projecteur, 0.26);                           // la place est éclairée la nuit
    });
    for(const x of [-35, 5]) for(let z = -33; z < 3; z += 5) J(x - 0.2, z, x + 0.2, z + 2.6, S.rouge);   // limite entre deux places
    B.decal(-35, h + 0.05, 15, 13, 13, R_EMBLEME);
  }
  // Manche à air : mât, feu de tête, manche rayée qui oscille dans le vent (anim « balayage »).
  function mancheAir(m, B, x, z, y0, coulMat){
    B.cyl('opaque', '#8a8f94', x, y0, z, 1.4, 0.5, 8, {ao:0});
    B.cyl('metal', coulMat, x, y0, z, 0.3, 13.4, 6);
    B.boiteC('emis', '#ff5a3a', x, y0 + 13.8, z, 0.7, 0.7, 0.7);
    B.halo(x, y0 + 13.8, z, 2.6, '#ff5a3a', 'nuit', 0.7);
    B.decal(x, y0 + 0.05, z, 10, 10, R_ANNEAU);
    const M = new Bati(0, 'metal2');
    M.piece('metal2', gTore(), '#3a3f43', 1.1, 0, 0, 3.4, 3.4, 3.4, 0, 0, Math.PI/2, {ao:0});     // cerceau
    let px = 1.2, py = 0, r = 1.55;
    for(let i = 0; i < 5; i++){
      const lg = 2.3, d = 0.05 + i*0.07, ax = Math.cos(d), ay = -Math.sin(d);                     // la manche retombe un peu
      M.piece('metal2', gCyl(8, 0.86), i % 2 ? '#f4f1ea' : '#f0762b', px + ax*lg/2, py + ay*lg/2, 0, 2*r, lg, 2*r, 0, 0, -Math.PI/2 - d, {ao:0});
      px += ax*lg; py += ay*lg; r *= 0.86;
    }
    m.anims.push({type:'balayage', vitesse:0.9, amplitude:0.3, base:0.12, x, y:y0 + 12.4, z, bati:M});
  }
  // Phare d'aérodrome : deux faisceaux opposés, blanc et vert, portés par l'antenne tournante
  // (canal « nuit » : visibles à la tombée du jour seulement).
  function phareAerodrome(R, y, blanc, vert){
    R.faisceau(0.8, y, 0, 54, y - 10, 0, 9, blanc, 0.2);
    R.faisceau(-0.8, y, 0, -54, y - 10, 0, 9, vert, 0.2);
  }

  // --------------------------------------------------- AÉROPORT HALDEN
  // Trois hangars-coques à tympan vitré et arc lumineux, tour octogonale à vigie inclinée,
  // dépôt de carburant à deux cuves.
  function aeroportHalden(m, P){
    const B = m.statique, h = H_PISTE;
    solAeroport(B, P, {asphalte:'#34373b', asphalte2:'#3e4246', gomme:'#25272a', ligne:P.ligne, jaune:'#e9bd3c', rouge:'#d8473a',
      feuBord:'#fff3d6', projecteur:'#dfeeff', reprises:[[-30, 58, -8, 66], [18, 35, 44, 42]]});
    // ---- Hangars
    const porte = new Bati(0, 'metal');
    const z0 = -76.5, z1 = -41, zm = (z0 + z1)/2, hm = 8.6, fl = 6.6;      // hm : haut des murs ; fl : flèche de la coque
    AERO.places.forEach(([cx], i) => {
      // murs latéraux, fond, liseré de camp
      B.boite('opaque', P.panneau, cx - 15, h, z0, cx - 13.8, hm, z1);
      B.boite('opaque', P.panneau, cx + 13.8, h, z0, cx + 15, hm, z1);
      B.boite('opaque', P.panneau2, cx - 15, h, z0, cx + 15, hm, z0 + 1);
      B.piece('opaque', gDemiDisque(20), P.panneau2, cx, hm, z0 + 0.1, 30, 2*fl, 1, 0, Math.PI, 0, {ao:0});
      for(const sx of [-1, 1]) B.boite('opaque', P.accent, cx + sx*14.9, hm - 2.2, z0 + 1, cx + sx*15.15, hm - 1.2, z1 - 0.4, {ao:0});
      // coque métallique, arcs d'accent, arc lumineux de façade
      B.piece('metal', gVouteLisse(20), P.toit, cx, hm, zm, 30.6, 2*fl, z1 - z0 + 0.6, 0, 0, 0, {ao:0, rayures:'#434c55', parTri:2});
      for(const z of [z0 + 5, z1 - 5]) B.piece('opaque', gVoute(20), P.accent, cx, hm, z, 31.1, 2*fl + 0.5, 1.4, 0, 0, 0, {ao:0});
      B.piece('emis', gVoute(20), P.lumiere, cx, hm + 0.05, z1 + 0.15, 30.9, 2*fl + 0.3, 0.5, 0, 0, 0, {ao:0});
      // tympan vitré (il luit la nuit) et meneaux
      B.piece('vitre', gDemiDisque(20), P.vitre, cx, hm + 0.3, z1 - 0.35, 28.4, 2*fl - 1.2, 1, 0, 0, 0, {ao:0});
      B.piece('nuit', gDemiDisque(20), '#ffdfae', cx, hm + 0.35, z1 - 0.3, 27.6, 2*fl - 1.8, 1, 0, 0, 0, {ao:0, gain:0.5});
      for(const dx of [-9, -3, 3, 9]){
        const yy = hm + 0.3 + (fl - 0.6)*Math.sqrt(1 - (dx/14.2)*(dx/14.2));
        B.boite('metal', P.acierC, cx + dx - 0.2, hm, z1 - 0.4, cx + dx + 0.2, yy, z1 - 0.1, {ao:0});
      }
      // linteau, bandeau lumineux, tableaux de la porte
      B.boite('metal', P.acier, cx - 14, hm - 0.5, z1 - 0.9, cx + 14, hm + 0.3, z1 + 0.2);
      B.boite('emis', P.lumiere, cx - 11.5, hm - 0.85, z1 - 0.2, cx + 11.5, hm - 0.5, z1 + 0.15);
      for(const sx of [-1, 1]) B.boite('opaque', P.panneau2, cx + sx*12, h, z1 - 1.2, cx + sx*13.8, hm - 0.5, z1);
      // intérieur (visible quand la porte se lève) : fond sombre, sol, éclairage de nuit
      B.boite('opaque', '#0f1215', cx - 13.8, h, z1 - 9, cx + 13.8, hm - 0.5, z1 - 8.6, {ao:0});
      B.boite('opaque', '#23282d', cx - 13.8, h, z1 - 8.6, cx + 13.8, h + 0.12, z1 - 0.8, {ao:0});
      B.piece('nuit', gBoite(), '#ffdfae', cx, (h + hm - 0.5)/2, z1 - 8.5, 23.6, hm - 0.9 - h, 0.1, 0, 0, 0, {ao:0, gain:0.3});
      // porte sectionnelle : une seule pièce animée pour les trois hangars (elle se lève quand l'aéroport produit)
      porte.boite('metal', '#b3bcc3', cx - 12, h - (hm - 0.5), 0, cx + 12, 0, 0.45, {ao:0.12, rayures:'#9fa9b1', parTri:2});
      porte.boite('metal', P.accent, cx - 12, h - (hm - 0.5) + 2.6, 0.45, cx + 12, h - (hm - 0.5) + 3.3, 0.52, {ao:0});
      // projecteurs de façade tournés vers la place
      for(const sx of [-1, 1]) projecteur(B, cx + sx*10.5, hm + 1.1, z1 + 0.5, cx + sx*6, h, -24, 14, '#eaf4ff', P.acierF, 0.9);
      // toiture : aérateur ; feu d'obstacle sur le hangar central
      B.boite('metal', '#b9c0c4', cx - 3, hm + fl - 0.5, zm - 9, cx + 3, hm + fl + 1.2, zm - 4);
      B.cyl('metal', '#3c4248', cx, hm + fl + 1.2, zm - 6.5, 1.5, 0.3, 10, {ao:0});
      if(i === 1) B.boiteC('feux', '#ff3626', cx, hm + fl + 0.9, z1 - 4, 1.2, 1.2, 1.2);
      B.decal(cx, h + 0.05, z1 + 3, 24, 3.4, R_DANGER);                                           // seuil : bande de danger
    });
    m.anims.push({type:'porte', x:0, y:hm - 0.5, z:z1 - 0.75, bati:porte});
    // Entre les hangars : groupes de parc, caisses, tracteurs d'avion
    for(const x of [-35, 5]){
      B.boite('metal', '#d7dcdf', x - 3.4, h, -60, x + 3.4, h + 4.6, -52);
      B.boite('opaque', P.accent, x - 3.5, h + 2.2, -60.1, x + 3.5, h + 2.9, -51.9, {ao:0});
      B.boite('emis', '#7dff9a', x - 2.6, h + 3.4, -52, x - 1.6, h + 4, -51.8);
      B.cylH('metal', P.acierF, x, h + 1, -49.5, 0.5, 5, 'z', 8);
      for(let k = 0; k < 3; k++) caisse(B, x - 2.4 + k*2.4, h, -68 - (k % 2), 2.6, k % 2 ? '#c9ced2' : P.acierC, 0.1*k);
    }
    vehicule(B, -35, -45.5, 0, '#e9c53a', 7, 3.6);
    vehicule(B, 5, -45.5, Math.PI, '#eef1f2', 7, 3.6);
    // ---- Tour de contrôle : bloc technique, fût octogonal, vigie vitrée inclinée, radar tournant
    const [tx, tz] = AERO.tour;
    const octo = (canal, couleur, y0, r, hh, effile, o) => B.piece(canal, gCyl(8, effile || 1, true), couleur, tx, y0 + hh/2, tz, 2*r, hh, 2*r, 0, Math.PI/8, 0, o);
    B.boite('opaque', P.panneau, tx - 10, h, tz - 10, tx + 10, 8.5, tz + 10);
    B.boite('vitre', P.vitre, tx - 8.5, 3.8, tz + 10, tx + 8.5, 6.6, tz + 10.5, {ao:0});
    B.boite('vitre', P.vitre, tx - 10.5, 3.8, tz - 8.5, tx - 10, 6.6, tz + 8.5, {ao:0});
    B.boite('emis', P.lumiere, tx - 10, 7.3, tz + 10, tx + 10, 7.8, tz + 10.5);
    B.boite('metal', P.acier, tx - 1.8, h, tz + 10, tx + 1.8, 3.5, tz + 10.4, {ao:0.1});
    B.boite('opaque', P.toit, tx - 9.6, 8.5, tz - 9.6, tx + 9.6, 8.9, tz + 9.6, {ao:0});
    for(const [a, b, c, d] of [[-10.2,-10.2,10.2,-9.4],[-10.2,9.4,10.2,10.2],[-10.2,-10.2,-9.4,10.2],[9.4,-10.2,10.2,10.2]])
      B.boite('opaque', P.acier, tx + a, 8.5, tz + b, tx + c, 9.7, tz + d, {ao:0});
    B.boite('metal', '#b9c0c4', tx + 3.5, 8.9, tz - 8.5, tx + 8.5, 11.4, tz - 4.5);
    B.cyl('metal', '#3c4248', tx + 6, 11.4, tz - 6.5, 1.5, 0.3, 10, {ao:0});
    octo('opaque', P.panneau2, 8.5, 4.6, 29.5, 1, {ao:0.12});
    for(const y of [16, 24, 32]) octo('metal', P.acierC, y, 4.85, 0.6, 1, {ao:0});
    B.boite('vitre', P.vitre, tx - 1, 10.5, tz + 4.1, tx + 1, 36.5, tz + 4.45, {ao:0});              // cage d'escalier vitrée
    B.boite('emis', P.accent, tx + 1.6, 10.5, tz + 4.15, tx + 1.9, 36.5, tz + 4.42);                  // filet lumineux
    octo('opaque', P.acierF, 38, 4.6, 3.6, 1.52, {ao:0.1});                                           // encorbellement
    octo('metal', P.acier, 41.6, 8.6, 0.5, 1, {ao:0});                                                // coursive
    for(let i = 0; i < 8; i++){
      const a0 = Math.PI/8 + i*Math.PI/4, a1 = a0 + Math.PI/4, r = 8.4;
      B.poutre('metal', P.acierC, tx + Math.sin(a0)*r, 43.4, tz + Math.cos(a0)*r, tx + Math.sin(a1)*r, 43.4, tz + Math.cos(a1)*r, 0.22);
      B.poutre('metal', P.acierC, tx + Math.sin(a0)*r, 42.1, tz + Math.cos(a0)*r, tx + Math.sin(a0)*r, 43.4, tz + Math.cos(a0)*r, 0.22);
    }
    octo('opaque', P.panneau, 42.1, 7, 1, 1, {ao:0});                                                 // allège
    octo('vitre', P.vitre, 43.1, 6.9, 5.4, 1.28, {ao:0});                                             // vitrage incliné vers l'extérieur
    octo('nuit', '#bfe4ff', 43.3, 6.98, 5, 1.28, {ao:0, gain:0.3});                                   // lueur des écrans
    for(let i = 0; i < 8; i++){
      const a = Math.PI/8 + i*Math.PI/4;
      B.poutre('metal', P.acierF, tx + Math.sin(a)*6.95, 43.1, tz + Math.cos(a)*6.95, tx + Math.sin(a)*8.9, 48.5, tz + Math.cos(a)*8.9, 0.4);
    }
    octo('emis', P.accent, 48.3, 9.3, 0.35, 1, {ao:0});                                               // anneau lumineux sous la casquette
    octo('opaque', P.toit, 48.6, 9.9, 1.1, 0.9, {ao:0});
    B.halo(tx, 48.4, tz + 9, 7, P.accent, 'nuit', 0.5);
    B.cyl('metal', P.acierC, tx + 4, 49.7, tz - 4, 0.25, 9.5, 5);
    B.cyl('metal', P.acierC, tx - 4.5, 49.7, tz + 2, 0.2, 6, 5);
    B.boiteC('feux', '#ff3626', tx + 4, 59.6, tz - 4, 1.3, 1.3, 1.3);
    B.boite('metal', '#c3c9cd', tx - 5.5, 49.7, tz - 5.5, tx - 2, 51.6, tz - 2.5);
    const radar = new Bati(0, 'metal2');
    radar.cyl('metal', P.acierF, 0, 0, 0, 0.9, 2.4, 8);
    radar.piece('metal', gBoite(), '#dfe3e5', 0, 3.6, 0, 11, 2.6, 0.7, 0.22, 0, 0);
    radar.boiteC('metal', P.accent, 0, 5, 0.32, 11, 0.3, 0.5);
    radar.boite('metal', P.acierF, -0.5, 1.6, -1.6, 0.5, 2.6, 0);
    phareAerodrome(radar, 1.4, '#f2fff2', '#5dffa0');
    m.anims.push({type:'rotation', vitesse:1.1, x:tx, y:49.7, z:tz, bati:radar});
    // ---- Dépôt de carburant : cuvette de rétention, deux cuves, groupe de pompage, camion-citerne
    for(const [a, b, c, d] of [[50, -38, 76, -37], [50, -13, 76, -12], [50, -38, 51, -12], [75, -38, 76, -12]])
      B.boite('opaque', '#c9c6bd', a, h, b, c, h + 1.5, d, {ao:0.2});
    B.boite('opaque', '#8f8b82', 51, h, -37, 75, h + 0.12, -13, {ao:0});
    for(const x of [57, 69]){
      B.cyl('metal', '#e9edef', x, h, -27, 5.4, 12, 18, {ao:0.25});
      B.cyl('opaque', P.accent, x, h + 8.4, -27, 5.52, 1.6, 18, {ao:0});
      B.piece('metal', gCone(18), '#dfe4e7', x, h + 12.9, -27, 10.9, 1.8, 10.9, 0, 0, 0, {ao:0});
      B.cyl('metal', P.acierF, x, h + 13.6, -27, 0.5, 0.8, 8);
      for(const dx of [-0.8, 0.8]) B.boite('metal', '#5c6469', x + dx - 0.15, h, -21.5, x + dx + 0.15, h + 12, -21.2, {ao:0});
      for(let y = h + 1.4; y < h + 12; y += 1.7) B.boite('metal', '#5c6469', x - 0.9, y, -21.45, x + 0.9, y + 0.2, -21.25, {ao:0});
      B.cylH('metal', P.acierC, x, h + 1.3, -18, 0.55, 8, 'z', 8);
    }
    B.cylH('metal', P.acierC, 63, h + 1.3, -14.4, 0.55, 12.6, 'x', 8);
    B.cylH('metal', P.acierC, 63, h + 1.3, -12.6, 0.55, 3.6, 'z', 8);
    B.boite('metal', '#6f7a80', 60, h, -11, 66, h + 3.6, -7);
    B.boite('emis', '#7dff9a', 60.6, h + 2.6, -7, 61.6, h + 3.2, -6.8);
    B.piece('metal', gTore(), '#d23a2a', 64.5, h + 4.3, -9, 2.2, 2.2, 2.2, 0, 0, 0, {ao:0});
    B.decal(63, h + 0.05, -3.5, 22, 3.2, R_DANGER);
    camionCiterne(B, 62, 5, Math.PI, P.panneau, '#dfe5e8', P.accent);
    // ---- Manche à air, lampadaires (en bordure : le tarmac reste dégagé)
    mancheAir(m, B, 73, 22, h, '#d7dcdf');
    lampadaire(B, -76.6, -22, 9, P.lumiere, P.acier, h); lampadaire(B, -76.6, 12, 9, P.lumiere, P.acier, h);
    lampadaire(B, 73.5, -5, 9, P.lumiere, P.acier, h); lampadaire(B, 46, -40, 9, P.lumiere, P.acier, h);
    m.corps = [-70, z0, 40, z1, hm + fl + 0.4];
    m.volumes = [[-70, z0, 40, z1, hm + fl], [tx - 10, tz - 10, tx + 10, tz + 10, 50], [50, -38, 76, -12, h + 14], [-77, -77, 77, 77, h + 0.8]];
    m.points = [[-55, 15, zm], [-15, 15, zm], [25, 15, zm], [tx, 47, tz], [63, 14, -27], [tx, 10, tz + 5]];
  }

  // --------------------------------------------------- AÉROPORT KARSK
  // Trois abris bétonnés en voûte (portes blindées, murs pare-souffle, merlons de terre, filet de
  // camouflage), tour de béton à vigie en encorbellement et mât haubané, cuve couchée sur berceaux.
  function aeroportKarsk(m, P){
    const B = m.statique, h = H_PISTE;
    solAeroport(B, P, {asphalte:'#474339', asphalte2:'#3b382f', gomme:'#2a2823', ligne:'#d9d2c0', jaune:'#cfa94a', rouge:'#b9432f',
      feuBord:'#ffd38a', projecteur:'#ffe2b0', reprises:[[-52, 34, -30, 41], [-6, 57, 22, 68], [40, 44, 58, 50], [-70, 60, -58, 70]]});
    // ---- Abris bétonnés
    const porte = new Bati(0, 'metal');
    const z0 = -76, z1 = -41.5, zm = (z0 + z1)/2, fl = 12.5, hp = 8.4;     // fl : flèche de la voûte ; hp : haut de la porte
    AERO.places.forEach(([cx], i) => {
      B.piece('opaque', gVoute(14), P.beton, cx, h, zm, 29, 2*fl, z1 - z0, 0, 0, 0, {ao:0.3});
      for(const z of [z0 + 1, z0 + 12, zm + 5.5, z1 - 1]) B.piece('opaque', gVoute(14), P.beton2, cx, h, z, 30, 2*fl + 0.8, 2, 0, 0, 0, {ao:0.2});
      B.piece('opaque', gDemiDisque(14), P.beton2, cx, h, z0 + 0.1, 29, 2*fl, 1, 0, Math.PI, 0, {ao:0.1});
      // façade : mur, ouverture sombre (éclairée la nuit), piédroits, linteau, bandeau de camp
      B.piece('opaque', gDemiDisque(14), '#7d7663', cx, h, z1 - 1.6, 28.6, 2*fl - 0.4, 1, 0, 0, 0, {ao:0.15});
      B.boite('opaque', '#12110e', cx - 10.5, h, z1 - 1.55, cx + 10.5, hp, z1 - 1.35, {ao:0});
      B.piece('nuit', gBoite(), '#ffc56e', cx, (h + hp)/2, z1 - 1.3, 20.4, hp - h - 0.4, 0.06, 0, 0, 0, {ao:0, gain:0.32});
      for(const sx of [-1, 1]){
        B.boite('opaque', P.beton, cx + sx*10.5, h, z1 - 1.6, cx + sx*12.7, 9.8, z1 + 0.2, {ao:0.25});
        B.boite('opaque', P.beton2, cx + sx*12.7, h, z1 - 0.6, cx + sx*14.4, 6.2, z1 + 2.2, {ao:0.3});     // murs pare-souffle en gradins
        B.boite('opaque', P.beton2, cx + sx*12.9, h, z1 + 2.2, cx + sx*14.4, 3.4, z1 + 4.6, {ao:0.3});
      }
      B.boite('opaque', P.beton, cx - 12.7, hp, z1 - 1.6, cx + 12.7, 10.2, z1 + 0.4, {ao:0});
      B.boite('opaque', P.accent, cx - 12.9, 10.2, z1 - 1.4, cx + 12.9, 10.6, z1 + 0.6, {ao:0});
      // lampe au-dessus de la porte
      B.boite('metal', P.oliveF, cx - 1.5, 10.6, z1 - 0.4, cx + 1.5, 11.7, z1 + 0.5);
      B.boite('emis', P.lumiere, cx - 1.1, 10.8, z1 + 0.5, cx + 1.1, 11.5, z1 + 0.7);
      B.halo(cx, 11.2, z1 + 0.9, 4, P.lumiere, 'nuit', 0.8);
      B.faisceau(cx, 11, z1 + 0.6, cx, h, z1 + 10, 9, P.lumiere, 0.11);
      B.flaque(cx, h + 0.34, z1 + 10, 14, P.lumiere, 0.36);
      // porte blindée : une seule pièce animée pour les trois abris (elle se lève quand l'aéroport produit)
      porte.boite('metal', P.olive, cx - 10.5, h - hp, 0, cx + 10.5, 0, 0.5, {ao:0.15, rayures:P.oliveF, parTri:2});
      porte.boite('metal', P.accent, cx - 10.5, h - hp + 5, 0.5, cx + 10.5, h - hp + 5.8, 0.58, {ao:0});
      B.decal(cx, h + 0.05, z1 + 6.6, 22, 3.2, R_DANGER);
    });
    m.anims.push({type:'porte', x:0, y:hp, z:z1 - 1.2, bati:porte});
    // Merlons de terre entre les abris, mur de sacs à l'est, filet de camouflage sur l'abri central
    for(const x of [-35, 5, -72.5]) B.piece('opaque', gPyr(0.35), '#857a5a', x, h + 3.2, -59, x < -70 ? 7 : 12, 6.4, 33, 0, 0, 0, {ao:0.4});
    sacs(B, 40.6, -74, 40.6, -45, 3, h);
    B.nappe('filet', -32.5, -73, 2.5, -46, 12, 8, (x, z) => {
      const u = (x + 15)/15.4, arc = u*u < 1 ? Math.sqrt(1 - u*u) : 0;
      return h + Math.max(0.6, 13*arc + 1.3) + Math.sin(x*0.8 + z*0.3)*0.3 + Math.cos(z*0.9)*0.25;
    }, FILET);
    // Chariots à bombes au pied des merlons, caisses de munitions à l'ouest
    for(const x of [-35, 5]){
      B.boite('metal', P.oliveF, x - 3.6, h + 0.9, -39.4, x + 3.6, h + 1.4, -36.2, {ao:0});
      for(const dz of [-0.9, 0.9]){
        B.cylH('metal', '#5d5f4a', x, h + 2, -37.8 + dz, 0.62, 5.6, 'x', 8);
        B.cylH('metal', '#d8a52c', x - 2.1, h + 2, -37.8 + dz, 0.64, 0.5, 'x', 8);
      }
      for(const dx of [-2.6, 2.6]) for(const dz of [-1.7, 1.7]) B.piece('opaque', gCyl(8, 1), '#1e1f20', x + dx, h + 0.55, -37.8 + dz, 1.1, 0.4, 1.1, Math.PI/2, 0, 0, {ao:0});
    }
    for(let i = 0; i < 5; i++) caisse(B, -75, h + Math.floor(i/3)*2.5, -37 + (i % 3)*4.2 + Math.floor(i/3)*2, 3, i % 2 ? P.olive : '#5a5938', 0.12*i);
    // ---- Tour de contrôle : socle, fût de béton, vigie en encorbellement, mât haubané
    const [tx, tz] = AERO.tour;
    B.boite('opaque', P.beton2, tx - 8, h, tz - 8, tx + 8, 4.2, tz + 8, {ao:0.3});
    B.boite('metal', P.oliveF, tx - 1.6, h, tz + 8, tx + 1.6, 3.5, tz + 8.3, {ao:0.1});
    B.boite('opaque', P.accent, tx - 2, 3.5, tz + 8, tx + 2, 3.9, tz + 8.4, {ao:0});
    sacs(B, tx - 9.5, tz + 9.8, tx - 3, tz + 9.8, 2, h); sacs(B, tx + 3, tz + 9.8, tx + 9.5, tz + 9.8, 2, h);
    B.boite('opaque', P.beton, tx - 4.6, 4.2, tz - 4.6, tx + 4.6, 30, tz + 4.6, {ao:0.2});
    for(let y = 9; y < 26; y += 5.2) B.boite('opaque', P.beton2, tx - 4.75, y, tz - 4.75, tx + 4.75, y + 0.35, tz + 4.75, {ao:0});     // reprises de coffrage
    for(const y of [11, 16.2, 21.4]) B.boite('vitre', P.vitre, tx - 0.8, y, tz + 4.6, tx + 0.8, y + 2.6, tz + 4.85, {ao:0});           // meurtrières vitrées
    B.boite('opaque', P.accent, tx - 4.8, 26.4, tz - 4.8, tx + 4.8, 28.2, tz + 4.8, {ao:0});
    B.boite('opaque', '#dcd6c8', tx - 4.8, 28.2, tz - 4.8, tx + 4.8, 30, tz + 4.8, {ao:0});
    B.piece('opaque', gPyr(1.75), P.beton2, tx, 31.4, tz, 9.6, 2.8, 9.6, 0, 0, 0, {ao:0.2});          // encorbellement
    B.boite('opaque', P.beton, tx - 8.6, 32.8, tz - 8.6, tx + 8.6, 33.9, tz + 8.6, {ao:0});            // allège
    B.boite('vitre', P.vitre, tx - 8.1, 33.9, tz - 8.1, tx + 8.1, 37, tz + 8.1, {ao:0});               // bandeau vitré (il luit la nuit)
    for(const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.boite('opaque', P.beton, tx + sx*8 - 0.6, 33.9, tz + sz*8 - 0.6, tx + sx*8 + 0.6, 37, tz + sz*8 + 0.6, {ao:0});
    for(const d of [-2.7, 2.7]){
      B.boite('opaque', P.beton, tx + d - 0.25, 33.9, tz + 8, tx + d + 0.25, 37, tz + 8.4, {ao:0});
      B.boite('opaque', P.beton, tx - 8.4, 33.9, tz + d - 0.25, tx - 8, 37, tz + d + 0.25, {ao:0});
      B.boite('opaque', P.beton, tx + 8, 33.9, tz + d - 0.25, tx + 8.4, 37, tz + d + 0.25, {ao:0});
    }
    B.boite('opaque', P.beton2, tx - 9.6, 37, tz - 9.6, tx + 9.6, 38.1, tz + 9.6, {ao:0});             // dalle de toit débordante
    B.boite('opaque', P.accent, tx - 9.7, 37.3, tz + 9.6, tx + 9.7, 37.8, tz + 9.75, {ao:0});
    sacs(B, tx - 8.6, tz + 8.6, tx + 8.6, tz + 8.6, 1, 38.1); sacs(B, tx + 8.6, tz - 8.6, tx + 8.6, tz + 8.6, 1, 38.1);
    treillis(B, 'metal', [P.accent, '#dcd6c8'], tx + 5, tz - 5, 38.1, 58, 2.6, 1.5, 5, 0.4);
    for(const [x, z] of [[tx - 9, tz - 9], [tx + 9, tz + 9], [tx - 9, tz + 9]]) B.poutre('metal', '#35352f', tx + 5, 53, tz - 5, x, 38.1, z, 0.16);
    B.boiteC('feux', '#ff3626', tx + 5, 58.9, tz - 5, 1.4, 1.4, 1.4);
    const radar = new Bati(0, 'metal2');
    radar.cyl('metal', P.oliveF, 0, 0, 0, 0.9, 2.6, 8);
    radar.piece('metal2', gBoite(), '#a9a58f', 0, 4.4, 0, 1, 3.6, 12, 0.22, 0, 0);
    for(const dz of [-4, 0, 4]) radar.boite('metal', '#5b5a48', -0.7, 2.8, dz - 0.2, 0.7, 6, dz + 0.2);
    phareAerodrome(radar, 1.6, '#fff0d0', '#7dffb0');
    m.anims.push({type:'rotation', vitesse:0.9, x:tx - 3, y:38.1, z:tz + 2, bati:radar});
    // ---- Dépôt de carburant : cuve couchée sur berceaux, pompe, fûts, murs de sacs, camion-citerne
    for(const x of [56, 63, 70]) B.boite('opaque', P.beton, x - 1.6, h, -32, x + 1.6, h + 3.4, -22);
    B.cylH('opaque', P.olive, 63, h + 7.6, -27, 5.2, 22, 'x', 18);
    for(const x of [52.4, 73.6]) B.cylH('opaque', P.oliveF, x, h + 7.6, -27, 4.6, 1, 'x', 18);
    for(const x of [58, 68]) B.cylH('opaque', P.accent, x, h + 7.6, -27, 5.32, 1.3, 'x', 18);
    B.boite('metal', '#4a4a3a', 55, h + 12.8, -27.8, 71, h + 13.05, -26.2, {ao:0});
    for(let x = 55; x <= 71; x += 2.6) B.boite('metal', '#4a4a3a', x - 0.12, h + 13.05, -27.8, x + 0.12, h + 14.3, -27.6, {ao:0});
    B.cyl('metal', '#4a4a3a', 63, h + 12.6, -27, 1.3, 1.2, 10);
    B.boite('metal', '#5a5a44', 55, h, -18.5, 61, h + 4.2, -14.5);
    B.boite('emis', '#ff3a2a', 56, h + 4.2, -17, 57.4, h + 4.8, -15.8);
    B.halo(56.7, h + 4.8, -16.4, 2.6, '#ff3a2a', 'nuit', 0.7);
    B.poutre('metal', '#3a3a30', 58, h + 2.4, -22.5, 58, h + 2.4, -18.5, 0.9);
    for(let i = 0; i < 8; i++) fut(B, 65.5 + (i % 4)*2.9, h, -19 + Math.floor(i/4)*2.9, [P.olive, P.rouille, P.accent, '#4b4c3a'][i % 4]);
    sacs(B, 51, -11, 77, -11, 2, h); sacs(B, 50.4, -37, 50.4, -13, 2, h);
    B.decal(63, h + 0.05, -6, 22, 3.2, R_DANGER);
    camionCiterne(B, 62, 4, Math.PI, P.olive, P.oliveF, P.accent);
    // ---- Manche à air, lampadaires (en bordure : le tarmac reste dégagé)
    mancheAir(m, B, 73, 22, h, '#bdb8a8');
    lampadaire(B, -76.6, 12, 9, P.lumiere, P.oliveF, h); lampadaire(B, 73.5, -5.5, 9, P.lumiere, P.oliveF, h);
    lampadaire(B, 46, -39.5, 9, P.lumiere, P.oliveF, h);
    m.corps = [-69.5, z0, 39.5, z1, h + fl + 0.4];
    m.volumes = [[-69.5, z0, 39.5, z1, h + fl], [tx - 9.6, tz - 9.6, tx + 9.6, tz + 9.6, 39], [50, -37, 77, -11, h + 14], [-77, -77, 77, 77, h + 0.8]];
    m.points = [[-55, 14, zm], [-15, 15, zm], [25, 14, zm], [tx, 38, tz], [63, 14, -27], [tx, 20, tz + 5]];
  }

  // Décombres d'aéroport : la disposition reste lisible (piste criblée de cratères, nervures de
  // hangars restées debout, tour abattue vers le sud, dépôt de carburant calciné).
  function decombresAeroport(B, fac){
    const h = B.h, F = infoFaction(fac), d = 77, K = facBase(fac) === 'karsk';
    const calcine = '#' + new THREE.Color(F.fonce).multiplyScalar(0.5).getHexString();
    const teintes = ['#2c2723', '#3d3630', '#4f463d', '#5f564c', '#383430'];
    const T = () => teintes[Math.floor(h()*5)];
    const gravat = (x, z, s, tas) => B.piece('opaque', gCaillou(), h() < 0.1 ? calcine : T(), x, 1 + s*0.2 + (tas || 0), z, s, s*(0.5 + h()*0.5), s*(0.7 + h()*0.6), h()*3, h()*3, h()*3, {ao:0.4});
    B.boite('opaque', '#2f2a25', -d - 2, 0, -d - 2, d + 2, 0.9, d + 2, {ao:0});
    // Piste : enrobé noirci, restes de marquage, cratères bordés de gravats
    B.boite('opaque', '#211e1b', -d, 0.9, 30, d, 1.05, 75, {ao:0});
    for(let cx = -42; cx <= 42; cx += 14) if(h() < 0.65) B.boite('opaque', '#6f6a60', cx - 4, 1.05, 52.1, cx - 1 + h()*5, 1.12, 52.9, {ao:0});
    for(const [x, z, r] of [[-48, 50, 9], [-12, 62, 7], [20, 44, 10], [52, 60, 8], [-30, 12, 8], [34, -6, 7]]){
      B.cyl('opaque', '#141210', x, 0.95, z, r, 0.22, 14, {ao:0});
      for(let i = 0; i < 12; i++){ const a = i/12*Math.PI*2 + h(); gravat(x + Math.cos(a)*(r + 0.5), z + Math.sin(a)*(r + 0.5), 2 + h()*3); }
    }
    // Hangars : nervures de voûte restées debout (segments épais, certains manquent), gravats, tôles tordues
    for(const [cx] of AERO.places){
      const zm = -58.5, R = 14.5, Hf = K ? 12 : 14;
      for(const zr of [zm - 11, zm + 9]){
        const n = 9, cassure = 2 + Math.floor(h()*5);
        for(let k = 0; k < n; k++){
          if(k === cassure || k === cassure + 1 || h() < 0.12) continue;
          const a0 = Math.PI*k/n, a1 = Math.PI*(k + 1)/n;
          B.poutre('opaque', K ? '#514b40' : '#41464b', cx - Math.cos(a0)*R, 0.9 + Math.sin(a0)*Hf, zr, cx - Math.cos(a1)*R, 0.9 + Math.sin(a1)*Hf, zr + (h() - 0.5)*1.5, 2.2, {ao:0.3});
        }
      }
      for(let i = 0; i < 44; i++){ const x = cx + (h() - 0.5)*30, z = zm + (h() - 0.5)*34; gravat(x, z, 3 + h()*8, Math.max(0, 1 - Math.abs(x - cx)/15)*6*h()); }
      for(let i = 0; i < 5; i++){
        const x = cx + (h() - 0.5)*26, z = zm + (h() - 0.5)*30;
        B.piece('opaque', gBoite(), h() < 0.4 ? calcine : '#4a443d', x, 3, z, 8 + h()*10, 0.6, 5 + h()*5, (h() - 0.5)*1.2, h()*3, (h() - 0.5)*1.2, {ao:0});
        B.poutre('metal', '#3a2c24', x, 1, z, x + (h() - 0.5)*14, 3 + h()*12, z + (h() - 0.5)*14, 0.7);
      }
    }
    // Tour : moignon, tronçon couché vers le sud, vigie écrasée
    const [tx, tz] = AERO.tour, gFut = K ? gBoite() : gCyl(8, 1, true);
    B.boite('opaque', T(), tx - 8, 0.9, tz - 8, tx + 8, 3.4, tz + 8, {ao:0.4});
    B.piece('opaque', gFut, '#4a443d', tx, 7.4, tz, 9, 13, 9, 0.08, 0.3, -0.1, {ao:0.4});
    B.piece('opaque', gFut, calcine, tx + 3, 4.6, tz + 22, 9, 16, 9, Math.PI/2 - 0.12, 0.2, 0.3, {ao:0.3});
    B.piece('opaque', gBoite(), '#3d3630', tx + 6, 4.4, tz + 37, 15, 6, 14, 0.2, 0.5, 0.25, {ao:0.4});
    for(let i = 0; i < 26; i++) gravat(tx + (h() - 0.5)*30, tz + 4 + h()*38, 2 + h()*5);
    // Dépôt de carburant : sol calciné, cuves éventrées
    B.cyl('opaque', '#141210', 63, 0.95, -25, 16, 0.2, 16, {ao:0});
    for(const x of [57, 69]) B.cyl('metal', '#2a2420', x, 0.9, -27, 5.4, 2.4 + h()*3, 12, {ao:0.3, effile:0.9 + Math.floor(h()*3)*0.1});
    // Débris épars sur le tarmac
    for(let i = 0; i < 40; i++) gravat((h() - 0.5)*2*d, -40 + h()*68, 1.5 + h()*3.5);
    eclatsCamp(B, fac, 8, d*0.8, 1);
    return B.construire();
  }

  // --------------------------------------------------- CITERNE (ressource)
  function fabriquerCiterne(){
    const B = new Bati(31), J = new Bati(), C = new Bati();
    B.cyl('opaque', '#b6af9e', 0, 0, 0, 21, 1.2, 28, {ao:0});
    B.cyl('opaque', '#8e8676', 0, 0, 0, 22, 0.6, 28, {ao:0});
    const cuves = [[-8, -7], [8, -7], [0, 6]];
    for(const [x, z] of cuves){
      B.cyl('opaque', '#ddd8c9', x, 1.2, z, 6.4, 14, 22, {ao:0.3});
      for(const y of [3, 12]) B.cyl('opaque', '#7fa0b3', x, 1.2 + y, z, 6.55, 0.9, 22, {ao:0});
      B.piece('opaque', gCone(22), '#cfc9b9', x, 16.3, z, 13, 2.2, 13, 0, 0, 0, {ao:0});
      C.cyl('couvercle', '#5fc2ff', x, 17.1, z, 1.9, 0.5, 12, {ao:0});
      B.poutre('metal', '#6f7a80', x, 3.2, z, 0, 3.2, -2.6, 1.1);
    }
    // Collecteur et vanne
    B.cyl('metal', '#6f7a80', 0, 1.2, -2.6, 1.4, 6, 10);
    B.piece('metal', gTore(), '#d23a2a', 0, 7.6, -2.6, 3.6, 3.6, 3.6, 0, 0, 0, {ao:0});
    B.cyl('metal', '#3a3f43', 0, 7.2, -2.6, 0.3, 0.8, 6);
    // Échelle sur la première cuve
    for(const dx of [-1, 1]) B.boite('metal', '#5c6469', -8 + dx - 0.15, 1.2, -0.45, -8 + dx + 0.15, 16, -0.15, {ao:0});
    for(let y = 2.5; y < 16; y += 1.6) B.boite('metal', '#5c6469', -9, y, -0.4, -7, y+0.2, -0.2, {ao:0});
    // Groupe de pompage
    B.boite('metal', '#7c8a8f', 12, 1.2, 4, 17, 5, 9); B.cylH('metal', '#5a6468', 10, 3, 6.5, 0.7, 5, 'x', 8);
    // Jauge (plaque sombre + barre bleue animée)
    B.boite('opaque', '#24282b', -11, 1.2, 14.3, 11, 2, 18, {ao:0});
    J.boite('jauge', '#3fb4ff', 0, 0, 0, 1, 0.5, 2.9, {ao:0});
    return {statique:B.construire(), jauge:J.construire().jauge, couvercles:C.construire().couvercle};
  }

  // --------------------------------------------------- DÉCOMBRES
  function fabriquerDecombres(taille, fac, graine, type){
    if(type === 'aeroport') return decombresAeroport(new Bati(graine), fac);
    const B = new Bati(graine), t = taille*TUILE, d = t/2 - 6, h = B.h, F = infoFaction(fac);
    // Échelles selon la taille : 3 et 2 inchangées ; 1 (tourelle, bunker) en modèle réduit.
    const k1 = taille === 1;
    const calcine = '#' + new THREE.Color(F.fonce).multiplyScalar(0.5).getHexString();
    const teintes = ['#2c2723', '#3d3630', '#4f463d', '#5f564c', '#383430'];
    B.boite('opaque', '#2f2a25', -d-3, 0, -d-3, d+3, 1.1, d+3, {ao:0});
    // Murs effondrés sur le pourtour
    for(const cote of [0, 1, 2, 3]) for(let k = -d; k < d; k += 7 + h()*5){
      if(h() < 0.3) continue;
      const hh = 2 + h()*h()*(taille === 3 ? 16 : k1 ? 5 : 10), l = (k1 ? 3 : 4) + h()*(k1 ? 3 : 6), ep = 1.6;
      const x = cote < 2 ? k + l/2 : (cote === 2 ? -d : d), z = cote < 2 ? (cote === 0 ? -d : d) : k + l/2;
      B.boiteC('opaque', teintes[Math.floor(h()*5)], x, 1.1 + hh/2, z, cote < 2 ? l : ep, hh, cote < 2 ? ep : l, (h()-0.5)*0.2);
    }
    // Amas de gravats
    const n = taille === 3 ? 120 : k1 ? 26 : 65;
    for(let i = 0; i < n; i++){
      const r = Math.sqrt(h())*d*0.95, a = h()*Math.PI*2, s = (k1 ? 2 : 3) + h()*(taille === 3 ? 10 : k1 ? 4 : 7);
      const col = h() < 0.1 ? calcine : teintes[Math.floor(h()*5)];
      const tas = (1 - r/d)*(taille === 3 ? 9 : k1 ? 3 : 6);   // amas plus haut au centre
      B.piece('opaque', gCaillou(), col, Math.cos(a)*r, 1 + s*0.2 + tas*h(), Math.sin(a)*r, s, s*(0.5 + h()*0.5), s*(0.7 + h()*0.6), h()*3, h()*3, h()*3, {ao:0.4});
    }
    // Panneaux et poutrelles tordus
    const kp = k1 ? 0.5 : 1;
    for(let i = 0; i < (taille === 3 ? 10 : k1 ? 3 : 6); i++){
      const x = (h()-0.5)*d*1.6, z = (h()-0.5)*d*1.6;
      B.piece('opaque', gBoite(), h() < 0.4 ? calcine : '#4a443d', x, 3*kp, z, (8 + h()*10)*kp, 0.6, (5 + h()*5)*kp, (h()-0.5)*1.2, h()*3, (h()-0.5)*1.2, {ao:0});
      B.poutre('metal', '#3a2c24', x, 1, z, x + (h()-0.5)*14*kp, 3 + h()*12*kp, z + (h()-0.5)*14*kp, 0.7);
    }
    eclatsCamp(B, fac, taille === 3 ? 11 : k1 ? 3 : 7, d, kp);
    return B.construire();
  }
  // Éclats de bardage aux couleurs du camp (bandeaux arrachés), pour qu'on sache à qui étaient
  // les décombres. Tirage sur une graine propre : le reste des décombres ne bouge pas.
  function eclatsCamp(B, fac, n, d, kp){
    const base = facBase(fac);
    if(base !== 'halden' && base !== 'karsk') return;
    const P = palette(fac), h = rng(977 + n*31), sale = '#' + new THREE.Color(P.accent).multiplyScalar(0.8).getHexString();
    for(let i = 0; i < n; i++){
      const x = (h()-0.5)*d*1.5, z = (h()-0.5)*d*1.5;
      B.piece('opaque', gBoite(), i % 3 === 2 ? P.accentF : sale, x, 2.2*kp + h()*2, z, (8 + h()*8)*kp, 0.8, (3.2 + h()*2.4)*kp, (h()-0.5)*0.9, h()*3, (h()-0.5)*0.9, {ao:0.2});
    }
  }

  const FABRIQUES = {
    qg:{halden:qgHalden, karsk:qgKarsk}, caserne:{halden:caserneHalden, karsk:caserneKarsk},
    usine:{halden:usineHalden, karsk:usineKarsk}, relais:{halden:relaisHalden, karsk:relaisHalden},
    depot:{halden:depotKarsk, karsk:depotKarsk},
    aeroport:{halden:aeroportHalden, karsk:aeroportKarsk},
    // Bâtiments de la Régie : un seul modèle, teintes Régie et accents du camp propriétaire.
    station:{neutre:stationRegie}, entrepot:{neutre:entrepotRegie},
    // Défenses fixes : modèle du camp qui les construit, repris tel quel par les autres camps.
    tourelle:{halden:tourelleHalden}, bunker:{karsk:bunkerKarsk},
    // Batterie mixte sol-air : un modèle par camp.
    batterie:{halden:batterieHalden, karsk:batterieKarsk},
  };
  function fabrique(type, fac){
    const F = FABRIQUES[type];
    if(!F) return null;
    return F[fac] || F.halden || F[Object.keys(F)[0]];
  }

  // =================================================================
  //  7. CACHE DES MODÈLES (type × camp), échafaudages, grues
  // =================================================================
  const MODELES = {};
  function modele(type, fac){
    const cle = type + '_' + fac;
    if(MODELES[cle]) return MODELES[cle];
    const taille = BATIMENTS[type].taille;
    // fac : variante (faction, éventuellement « @couleur ») ; la graine et la fabrique ne dépendent
    // que de la faction, pour qu'une variante de couleur ait exactement la même géométrie.
    const base = facBase(fac);
    const m = {type, fac, base, taille, statique:new Bati(type.length*97 + base.length), anims:[], points:[], cheminees:[], corps:[-30,-30,30,30,20]};
    const f = fabrique(type, base);
    m.statique.fenetres = FENETRES[palette(fac).style] || FENETRES.neutre;   // fenêtres allumées la nuit
    if(f) f(m, palette(fac));
    else {
      // Type sans modèle (ajouté au moteur mais pas encore ici) : bloc neutre, plutôt que rien.
      const P = palette(fac), d = taille*TUILE/2 - 2;
      dalle(m.statique, P, d, 1.4);
      m.statique.boite('opaque', P.panneau2, -d*0.7, 1.4, -d*0.7, d*0.7, 12, d*0.7);
      m.statique.boite('opaque', P.accent, -d*0.72, 10, -d*0.72, d*0.72, 11, d*0.72, {ao:0});
      m.corps = [-d*0.7, -d*0.7, d*0.7, d*0.7, 12]; m.points = [[0, 12, 0]];
    }
    if(couleurVar(fac) && base === 'halden' && f && type !== 'aeroport') cadreCamp(m, palette(fac));
    m.geos = m.statique.construire();
    for(const a of m.anims){
      if(a.bati) a.geos = a.bati.construire();
      if(a.enfant && a.enfant.bati) a.enfant.geos = a.enfant.bati.construire();
      // Lueur de départ (hors hauteur du chantier) : n'existe qu'au tir
      if(a.enfant && a.enfant.eclair) a.enfant.eclair.geos = a.enfant.eclair.bati.construire();
    }
    // Hauteur totale (fin du chantier) : les marquages et les lumières de nuit (halos, faisceaux) ne comptent pas.
    m.hMax = 0;
    for(const c in m.geos) if(c !== 'decal' && !CANAUX_NUIT[c]) m.hMax = Math.max(m.hMax, m.geos[c].boundingBox.max.y);
    for(const a of m.anims){
      if(a.geos) for(const c in a.geos) if(!CANAUX_NUIT[c]) m.hMax = Math.max(m.hMax, a.y + a.geos[c].boundingBox.max.y);
      if(a.enfant && a.enfant.geos) for(const c in a.enfant.geos) m.hMax = Math.max(m.hMax, a.y + a.enfant.y + a.enfant.geos[c].boundingBox.max.y);
    }
    m.echafaudage = fabriquerEchafaudage(m);
    return (MODELES[cle] = m);
  }
  // Marque de camp renforcée, pour les seules variantes de couleur : un acrotère peint (cadre
  // large en couronne du volume principal). Les accents d'origine (bandeaux, liserés) restent
  // discrets sous la livrée Halden, riche en bleus (vitrages, bardage) : sans ce cadre, deux camps
  // Halden de couleurs différentes ne se distinguaient pas au zoom de jeu. Les modèles d'origine
  // (Halden bleu, Karsk rouge) n'en portent pas : le duel classique garde son aspect. Karsk n'en a
  // pas besoin (ses bandes d'accent couvrent déjà hangars et façades) et ses toits en voûte le
  // feraient flotter ; l'aéroport, étalé, porte la couleur par ses marquages au sol.
  function cadreCamp(m, P){
    const [x0, z0, x1, z1, h] = m.corps, B = m.statique, o = 0.5;
    const l = Math.max(2.5, Math.min(5, Math.min(x1 - x0, z1 - z0)*0.09)), y0 = h - 1.6, y1 = h + 0.7;
    const c = P.accent;
    B.boite('opaque', c, x0 - o, y0, z0 - o, x1 + o, y1, z0 - o + l, {ao:0});
    B.boite('opaque', c, x0 - o, y0, z1 + o - l, x1 + o, y1, z1 + o, {ao:0});
    B.boite('opaque', c, x0 - o, y0, z0 - o + l, x0 - o + l, y1, z1 + o - l, {ao:0});
    B.boite('opaque', c, x1 + o - l, y0, z0 - o + l, x1 + o, y1, z1 + o - l, {ao:0});
  }
  function fabriquerEchafaudage(m){
    const [x0, z0, x1, z1, h] = m.corps, o = 2.4, B = new Bati(3), N = new Bati(), G = new Bati(0, 'metal'), F = new Bati(0, 'metal');
    const cote = (xa, za, xb, zb) => {
      const L = Math.hypot(xb-xa, zb-za), n = Math.max(2, Math.ceil(L/8));
      for(let i = 0; i <= n; i++){
        const x = xa + (xb-xa)*i/n, z = za + (zb-za)*i/n;
        B.boite('metal', '#9aa0a4', x-0.3, 1.4, z-0.3, x+0.3, h + 3, z+0.3, {ao:0});
        if(i < n){ const xn = xa + (xb-xa)*(i+1)/n, zn = za + (zb-za)*(i+1)/n; B.poutre('metal', '#8d9397', x, 1.6, z, xn, Math.min(h, 8), zn, 0.25); }
      }
      for(let y = 6; y <= h + 1; y += 6){
        B.poutre('metal', '#d6a83a', xa, y + 1.2, za, xb, y + 1.2, zb, 0.3);
        const nx = (zb - za)/L, nz = -(xb - xa)/L;   // normale extérieure (sens horaire)
        B.poutre('metal', '#a8824a', xa + nx*0.9, y, za + nz*0.9, xb + nx*0.9, y, zb + nz*0.9, 1.8);
      }
    };
    cote(x0 - o, z1 + o, x1 + o, z1 + o);     // sud
    cote(x1 + o, z1 + o, x1 + o, z0 - o);     // est
    cote(x0 - o, z0 - o, x0 - o, z1 + o);     // ouest
    // Niveau de travail (cadre qui monte avec le front de construction)
    for(const [a, b, c, d] of [[x0-1, z0-1, x1+1, z0], [x0-1, z1, x1+1, z1+1], [x0-1, z0, x0, z1], [x1, z0, x1+1, z1]])
      N.boite('metal', '#e8b23a', a, -0.6, b, c, 0.6, d, {ao:0});
    // Grue à tour (mât fixe, flèche animée)
    const t = m.taille*TUILE, gx = -t/2 + 5, gz = -t/2 + 5, hg = Math.min(80, Math.max(h + 22, 40));
    treillis(G, 'metal', '#e0b13a', gx, gz, 1.4, hg, 3.2, 3.2, Math.round(hg/6), 0.35);
    G.boite('opaque', '#8a8f94', gx-3, 1.4, gz-3, gx+3, 3, gz+3);
    const L = t*0.82;
    F.boite('metal', '#e0b13a', -1.4, 0, -1.4, 1.4, 3, 1.4);
    F.boite('metal', '#3a3f45', 0.6, 3, -1.6, 3.6, 6, 1.6);
    F.boite('vitre', '#2b3c4a', 3.6, 3.6, -1.4, 3.8, 5.6, 1.4, {ao:0});
    for(const dz of [-0.9, 0.9]) F.poutre('metal', '#e0b13a', 0, 6.6, dz, L, 6.6, dz, 0.35);
    F.poutre('metal', '#e0b13a', 0, 9, 0, L*0.7, 7, 0, 0.25);
    F.poutre('metal', '#e0b13a', 0, 6.6, 0, -12, 6.6, 0, 0.9);
    F.boite('opaque', '#8a8f94', -13, 4.4, -1.8, -9, 7.4, 1.8);
    F.boite('metal', '#e0b13a', -0.6, 6.6, -0.6, 0.6, 10, 0.6);
    F.boite('metal', '#3a3f45', L*0.62 - 1, 5.4, -1, L*0.62 + 1, 6.4, 1);
    F.poutre('metal', '#202326', L*0.62, 5.4, 0, L*0.62, 5.4 - hg*0.55, 0, 0.18);
    F.boite('metal', '#d8a52c', L*0.62 - 0.9, 3.6 - hg*0.55, -0.9, L*0.62 + 0.9, 5.4 - hg*0.55, 0.9);
    return {echaf:B.construire(), niveau:N.construire(), mat:G.construire(), fleche:F.construire(), grue:{x:gx, y:hg, z:gz}};
  }

  // Drapeaux : une géométrie ondulante par camp, mise à jour une fois par image.
  const DRAPEAUX = {};
  function geoDrapeau(fac){
    if(DRAPEAUX[fac]) return DRAPEAUX[fac];
    const L = 13, H = 8.5, g = new THREE.PlaneGeometry(L, H, 12, 6);
    g.translate(L/2, -H/2, 0);
    const uv = g.attributes.uv;
    for(let i = 0; i < uv.count; i++) uv.setXY(i, R_DRAPEAU[0] + uv.getX(i)*(R_DRAPEAU[2]-R_DRAPEAU[0]), R_DRAPEAU[1] + uv.getY(i)*(R_DRAPEAU[3]-R_DRAPEAU[1]));
    const base = Float32Array.from(g.attributes.position.array);
    return (DRAPEAUX[fac] = {g, base, L, t:-1});
  }
  function onduler(d, temps){
    if(d.t === temps) return; d.t = temps;
    const p = d.g.attributes.position, b = d.base;
    for(let i = 0; i < p.count; i++){
      const x = b[i*3], y = b[i*3+1], k = x / d.L;
      p.setXYZ(i, x - k*k*0.8, y - k*1.2 + Math.sin(x*0.5 - temps*4.6 + y*0.2)*0.4*k, Math.sin(x*0.42 - temps*5.2)*1.5*k + Math.sin(x*0.9 - temps*7.1)*0.4*k);
    }
    p.needsUpdate = true; d.g.computeVertexNormals();
  }

  // =================================================================
  //  8. INSTANCIATION D'UN MODÈLE
  // =================================================================
  const matInvisible = new THREE.MeshBasicMaterial({visible:false});
  let groupe, geoProxy;
  // sansFusion : canaux séparés comme avant (fantôme de placement : ses matériaux sont à face
  // simple et teintent toutes les pièces, lumineuses comprises).
  function instancier(m, fnMat, sansFusion){
    const g = new THREE.Group(), meshes = [];
    const ajouter = (parent, geos) => {
      if(!sansFusion) geos = fusionner(geos);
      for(const canal in geos){
        const me = canal === 'corps' ? maillageCorps(geos[canal], fnMat(canal)) : new THREE.Mesh(geos[canal], fnMat(canal));
        me.userData.canal = canal;
        if(canal !== 'corps'){ me.castShadow = sansFusion ? ombreCanal(canal) : false; me.receiveShadow = !LUMINEUX[canal]; }
        // Pièce fixe dans son groupe (transformation identité) : matrice locale calculée une fois.
        me.matrixAutoUpdate = false;
        parent.add(me); meshes.push(me);
      }
    };
    ajouter(g, m.geos);
    // Pièces tournantes : un seul maillage animé dans le shader (hors fantôme)
    const AF = sansFusion || (R3D.Batiments && R3D.Batiments.animsJS) ? null : animsFusionnees(m);   // animsJS : essai A/B seulement
    if(AF){ const me = maillageCorps(AF.g, fnMat('corpsAnim'), 'corpsAnim'); me.matrixAutoUpdate = false; g.add(me); meshes.push(me); }
    const anims = m.anims.filter(a => !(AF && AF.anims.has(a))).map(a => {
      const p = new THREE.Group(); p.position.set(a.x, a.y, a.z); g.add(p);
      if(a.type === 'drapeau'){
        const me = new THREE.Mesh(geoDrapeau(m.base).g,fnMat('drapeau')); me.userData.canal = 'drapeau';
        me.castShadow = OMBRE_DRAPEAU && !sansFusion; p.add(me); meshes.push(me);
      } else ajouter(p, a.geos);
      // Sous-ensemble porté par le pivot (canon qui recule dans la tourelle qui pivote)
      let enfant = null;
      if(a.enfant && a.enfant.geos){
        enfant = new THREE.Group(); enfant.position.set(a.enfant.x, a.enfant.y, a.enfant.z);
        p.add(enfant); ajouter(enfant, a.enfant.geos);
      }
      // Lueur de départ : groupe réduit à rien hors du tir (l'échelle, pas la visibilité, que
      // l'état « critique » fait déjà clignoter sur les lumières)
      let eclair = null;
      if(enfant && a.enfant.eclair && a.enfant.eclair.geos){
        const E = a.enfant.eclair;
        eclair = new THREE.Group(); eclair.position.set(E.x, E.y, E.z); eclair.scale.setScalar(0.001);
        enfant.add(eclair); ajouter(eclair, E.geos);
      }
      return {def:a, pivot:p, enfant, eclair};
    });
    return {groupe:g, meshes, anims};
  }

  // Crochets de sélection (un jeu de géométries par taille).
  const SEL = {};
  let matSelJ, matSelI, matSelN;
  function geoSelection(taille){
    if(SEL[taille]) return SEL[taille];
    const B = new Bati(), d = taille*TUILE/2 + 3, l = taille*TUILE*0.22, e = 2.2;
    for(const sx of [-1, 1]) for(const sz of [-1, 1]){
      B.boite('emis', '#ffffff', sx*d - (sx > 0 ? l : 0), 0, sz*d - e/2, sx*d + (sx < 0 ? l : 0), 0.4, sz*d + e/2, {ao:0});
      B.boite('emis', '#ffffff', sx*d - e/2, 0, sz*d - (sz > 0 ? l : 0), sx*d + e/2, 0.4, sz*d + (sz < 0 ? l : 0), {ao:0});
    }
    return (SEL[taille] = B.construire().emis);
  }

  // =================================================================
  //  9. ÉTAT DES BÂTIMENTS
  // =================================================================
  const etats = new Map();   // id -> état visuel
  function creer(b){
    const fac = variante(b.camp), m = modele(b.type, fac), t = m.taille*TUILE;
    degagerEmprise(b.x, b.y, m.taille);   // un nouveau bâtiment ne s'affiche jamais mêlé à des décombres
    const racine = new THREE.Group(); racine.userData.entId = b.id;
    const inst = instancier(m, canal => materiau(canal, fac, 'normal'));
    racine.add(inst.groupe);
    // Volume de pointage (invisible au rendu, mais touché par le rayon). Par défaut, une boîte sur
    // toute l'emprise. Un modèle étalé (aéroport) déclare m.volumes [x0, z0, x1, z1, h] : ses
    // bâtiments, plus une plaque mince au sol, pour que le rayon atteigne d'abord un avion stationné.
    let proxy;
    if(m.volumes){
      proxy = new THREE.Group();
      for(const [x0, z0, x1, z1, hv] of m.volumes){
        const v = new THREE.Mesh(geoProxy, matInvisible);
        v.scale.set(x1 - x0, hv, z1 - z0); v.position.set((x0 + x1)/2, hv/2, (z0 + z1)/2);
        proxy.add(v);
      }
    } else {
      proxy = new THREE.Mesh(geoProxy, matInvisible);
      proxy.scale.set(t - 6, m.corps[4] + 4, t - 6); proxy.position.y = (m.corps[4] + 4)/2;
    }
    proxy.userData.entId = b.id; racine.add(proxy);
    const sel = new THREE.Mesh(geoSelection(m.taille), b.camp === 'J' ? matSelJ : b.camp === 'N' ? matSelN : matSelI);
    sel.position.y = 1.9; sel.visible = false; racine.add(sel);
    groupe.add(racine);
    return {b, fac, m, racine, inst, proxy, sel, etat:'normal', chantier:null, porte:0,
      activite:(!b.enCours && b.file && b.file.length) ? 1 : 0,
      phase:(b.id*0.618) % 1, tFumee:Math.random()*0.3, tFeu:0, tChem:0, rally:null,
      feux:inst.meshes.filter(me => me.userData.canal === 'feux' || me.userData.canal === 'nuitF'),
      lumieres:inst.meshes.filter(me => me.userData.canal === 'emis' || me.userData.canal === 'nuit')};
  }
  function appliquerEtat(s){
    const etat = s.etat;
    for(const me of s.inst.meshes) me.material = materiau(me.userData.canal, s.fac, etat);
  }
  // ---- Chantier
  function demarrerChantier(s){
    const poste = prendrePoste(), E = s.m.echafaudage, objets = [];
    for(const me of s.inst.meshes){
      const c = me.userData.canal;
      if(LUMINEUX[c]){ me.visible = false; continue; }
      me.material = matCoupable(poste, c, s.fac); me.castShadow = false;
    }
    const mk = (geos, parent) => { geos = fusionner(geos); for(const c in geos) parent.add(c === 'corps' ? maillageCorps(geos[c], materiau(c, s.fac, 'normal')) : new THREE.Mesh(geos[c], materiau(c, s.fac, 'normal'))); };
    const echaf = new THREE.Group(); mk(E.echaf, echaf); s.racine.add(echaf); objets.push(echaf);
    const niveau = new THREE.Group(); mk(E.niveau, niveau); s.racine.add(niveau); objets.push(niveau);
    const grue = new THREE.Group(); mk(E.mat, grue); s.racine.add(grue); objets.push(grue);
    const fleche = new THREE.Group(); mk(E.fleche, fleche); fleche.position.set(E.grue.x, E.grue.y, E.grue.z); grue.add(fleche);
    s.chantier = {u:poste.u, poste, objets, niveau, fleche};
  }
  function finirChantier(s){
    const C = s.chantier; if(!C) return;
    for(const o of C.objets) s.racine.remove(o);
    rendrePoste(C.poste);   // matériaux conservés (pas de dispose) : programmes gardés en vie
    for(const me of s.inst.meshes){ me.visible = true; me.castShadow = me.userData.canal === 'corps'; }
    s.chantier = null;
    appliquerEtat(s);
  }
  // ---- Ralliement (drapeau 3D + ligne pointillée)
  let geoRallyMat, geoRallyFanion, geoRallyAnneau, matRallyMat, matRallyFanion, matRallyAnneau, matRallyLigne;
  function creerRally(){
    const g = new THREE.Group();
    const mat = new THREE.Mesh(geoRallyMat, matRallyMat); mat.position.y = 12; mat.castShadow = true; g.add(mat);
    const fan = new THREE.Mesh(geoRallyFanion, matRallyFanion); fan.position.y = 23.5; g.add(fan);
    const an = new THREE.Mesh(geoRallyAnneau, matRallyAnneau); an.rotation.x = -Math.PI/2; an.position.y = 0.6; g.add(an);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,1], 3));
    const ligne = new THREE.Line(lg, matRallyLigne); ligne.frustumCulled = false;
    groupe.add(g); groupe.add(ligne);
    return {g, fan, an, ligne};
  }
  function majRally(s, b, temps){
    const montrer = b.camp === 'J' && b.selectionne && b.rally;
    if(!montrer){ if(s.rally){ s.rally.g.visible = s.rally.ligne.visible = false; } return; }
    if(!s.rally) s.rally = creerRally();
    const R = s.rally, H = R3D.hauteurSol(b.rally.x, b.rally.y);
    R.g.visible = R.ligne.visible = true;
    R.g.position.set(b.rally.x, H, b.rally.y);
    R.fan.rotation.y = Math.sin(temps*3)*0.25;
    R.an.scale.setScalar(1 + 0.15*Math.sin(temps*4));
    const p = R.ligne.geometry.attributes.position;
    const dx = b.rally.x - b.x, dy = b.rally.y - b.y, L = Math.hypot(dx, dy) || 1, r0 = Math.min(L, s.m.taille*TUILE/2 + 4);
    p.setXYZ(0, b.x + dx/L*r0, R3D.hauteurSol(b.x, b.y) + 1.2, b.y + dy/L*r0); p.setXYZ(1, b.rally.x, H + 1.2, b.rally.y);
    p.needsUpdate = true; R.ligne.computeLineDistances();
  }
  function retirer(s){
    groupe.remove(s.racine);
    if(s.chantier){ rendrePoste(s.chantier.poste); s.chantier = null; }
    if(s.rally){ groupe.remove(s.rally.g); groupe.remove(s.rally.ligne); s.rally.ligne.geometry.dispose(); }
  }

  // Émetteurs d'effets (protégés : le module d'effets peut être absent).
  const E = () => R3D.Effets;
  function fumee(x, y, h, k){ const e = E(); if(e && e.emettreFumee) e.emettreFumee(x, y, h, k); }
  function feu(x, y, h, k){ const e = E(); if(e && e.emettreFeu) e.emettreFeu(x, y, h, k); }

  function majBatiment(s, b, temps, dt){
    const H = R3D.hauteurSol(b.x, b.y), m = s.m, phL = phaseLumieres(b.x, b.y);
    s.racine.position.set(b.x, H, b.y);
    // Chantier : le bâtiment se révèle de bas en haut
    if(b.enCours && !s.chantier) demarrerChantier(s);
    if(!b.enCours && s.chantier) finirChantier(s);
    if(s.chantier){
      // Le volume principal monte pendant 85 % du chantier, les superstructures (mâts, cheminées) ensuite.
      const p = Math.max(0, Math.min(1, b.progres)), hc0 = m.corps[4] + 2;
      const C = s.chantier, hc = p < 0.85 ? 1.7 + (p/0.85)*(hc0 - 1.7) : hc0 + (p - 0.85)/0.15*(m.hMax - hc0 + 0.5);
      C.u.value = H + hc;
      C.niveau.visible = hc < m.corps[4] + 0.5;
      C.niveau.position.y = Math.min(hc, m.corps[4]);
      C.fleche.rotation.y = -0.8 + Math.sin(temps*0.22 + s.phase*6)*0.9;
    }
    // État de dégâts (pendant un chantier, on rapporte les PV à ceux attendus)
    const ref = b.pvMax * (b.enCours ? 0.1 + 0.9*Math.min(1, b.progres) : 1);
    const k = b.pv / Math.max(1, ref);
    // Un chantier ne prend pas feu (il n'y a encore rien à brûler) : au pire il fume.
    const etat = k < 0.25 && !b.enCours ? 'critique' : k < 0.5 ? 'abime' : 'normal';
    if(etat !== s.etat){ s.etat = etat; if(!s.chantier) appliquerEtat(s); }
    if(dt > 0 && etat !== 'normal' && m.points.length){
      s.tFumee -= dt;
      if(s.tFumee <= 0){
        s.tFumee = etat === 'critique' ? 0.16 : 0.3;
        const p = m.points[Math.floor(Math.random()*m.points.length)];
        fumee(b.x + p[0] + (Math.random()-.5)*6, b.y + p[2] + (Math.random()-.5)*6, H + p[1], etat === 'critique' ? 0.9 : 0.55);
      }
      if(etat === 'critique'){
        s.tFeu -= dt;
        if(s.tFeu <= 0){
          s.tFeu = 0.14;
          const p = m.points[Math.floor(Math.random()*Math.min(3, m.points.length))];
          feu(b.x + p[0] + (Math.random()-.5)*8, b.y + p[2] + (Math.random()-.5)*8, H + p[1], 0.8);
        }
      }
    }
    // Production (usine) : porte, pont roulant, cheminées
    const prod = !b.enCours && b.file && b.file.length > 0;
    if(dt > 0) s.activite += ((prod ? 1 : 0) - s.activite) * Math.min(1, dt*1.2);
    if(prod && dt > 0 && m.cheminees.length){
      s.tChem -= dt;
      if(s.tChem <= 0){ s.tChem = 0.22; for(const c of m.cheminees) fumee(b.x + c[0], b.y + c[2], H + c[1], 0.45); }
    }
    // Animations
    for(const a of s.inst.anims){
      const d = a.def;
      // (phase tirée de la position, comme les pièces tournantes animées dans le shader)
      if(d.type === 'rotation') a.pivot.rotation.y = phL*6.28 + temps*d.vitesse;
      else if(d.type === 'balayage') a.pivot.rotation.y = d.base + Math.sin(temps*d.vitesse + phL*6.28)*d.amplitude;
      else if(d.type === 'porte') a.pivot.scale.y = Math.max(0.06, 1 - 0.94*s.activite);
      else if(d.type === 'pont') a.pivot.position.z = d.z + Math.sin(temps*0.45 + s.phase*6.28)*d.amplitude*s.activite;
      else if(d.type === 'arme'){
        // Défense fixe : l'arme suit b.angleT (repère du jeu : 0 = est, π/2 = sud), recul au tir.
        const ang = typeof b.angleT === 'number' ? b.angleT : Math.PI/2;
        a.pivot.rotation.y = -ang;
        if(a.enfant){
          const tir = temps - (typeof b.tirT === 'number' ? b.tirT : -99);
          const k = (tir >= 0 && tir < 0.15) ? 1 - tir/0.15 : 0;
          a.enfant.position.x = d.enfant.x - k*(d.recul || 0);
          if(a.eclair){
            const on = k > 0.25 && !s.chantier;
            a.eclair.scale.setScalar(on ? 0.5 + k*0.7 : 0.001);
            if(on) a.eclair.rotation.x = temps*37 % 6.28;
          }
        }
      }
    }
    // Feux d'obstacle clignotants ; lumières instables quand le bâtiment brûle
    // (les feux et les lumières « emis » du corps suivent la même règle dans son shader, avec la
    // même phase tirée de la position : voir GLSL_MASQUE)
    const allume = ((temps*0.8 + phL) % 1) < 0.4;
    for(const f of s.feux) f.visible = !s.chantier && allume;
    if(!s.chantier && etat === 'critique'){ const vac = Math.sin(temps*23 + phL*40) > 0.3; for(const l of s.lumieres) l.visible = vac; }
    else if(!s.chantier) for(const l of s.lumieres) l.visible = true;
    // Sélection et ralliement
    s.sel.visible = !!b.selectionne;
    majRally(s, b, temps);
  }

  // =================================================================
  //  10. DÉCOMBRES (pool limité)
  // =================================================================
  // Durée de vie : les décombres fument ~22 s, restent en place, puis s'enfoncent progressivement
  // dans le sol pendant les dernières secondes avant d'être retirés (≈ 90 s au total).
  const MAX_DECOMBRES = 20, decombres = [], GEO_DECOMBRES = {};
  const VIE_DECOMBRES = 90, ENFONCEMENT = 18, PROFONDEUR = 26;
  function poserDecombres(s){
    // Décombres propres à l'aéroport (ils gardent sa disposition, donc son orientation).
    const b = s.b, taille = s.m.taille, v = b.id % 2, aero = s.m.type === 'aeroport', cle = (aero ? 'aero' : taille) + s.fac + v;
    // Cas limite : un bâtiment a déjà été posé sur l'emprise avant la pose des décombres → on n'en pose pas.
    const demiB = taille*TUILE/2;
    for(const [id, o] of etats) if(o !== s && !o.b.mort &&
      Math.abs(o.b.x - b.x) < demiB + o.m.taille*TUILE/2 - 3 && Math.abs(o.b.y - b.y) < demiB + o.m.taille*TUILE/2 - 3) return;
    const geos = geoDecombres(taille, s.fac, v, s.m.type);
    if(decombres.length >= MAX_DECOMBRES) enleverDecombres(decombres[0]);
    const g = new THREE.Group();
    const fg = fusionner(geos);
    for(const c in fg){ const me = c === 'corps' ? maillageCorps(fg[c], materiau(c, s.fac, 'normal')) : new THREE.Mesh(fg[c], materiau(c, s.fac, 'normal')); me.receiveShadow = true; g.add(me); }
    const sol = R3D.hauteurSol(b.x, b.y);
    g.position.set(b.x, sol, b.y);
    g.rotation.y = aero ? 0 : Math.floor(Math.random()*4)*Math.PI/2;
    groupe.add(g);
    // demi : demi-côté de l'emprise au sol (dalle des décombres comprise)
    decombres.push({g, x:b.x, y:b.y, sol, demi:taille*TUILE/2 - 3, r:taille*TUILE*0.3, reste:22, t:1.5, age:0});
  }
  // Géométries de décombres, en cache par (taille ou aéroport) × camp × variante (0 / 1). Le
  // préchauffage les fabrique d'avance : la première destruction ne coûte plus leur construction.
  function geoDecombres(taille, fac, v, type){
    const aero = type === 'aeroport', cle = (aero ? 'aero' : taille) + fac + v;
    return GEO_DECOMBRES[cle] || (GEO_DECOMBRES[cle] = fabriquerDecombres(taille, fac, 101 + taille*13 + v*7 + facBase(fac).length, type));
  }
  function enleverDecombres(d){
    const i = decombres.indexOf(d); if(i < 0) return;
    decombres.splice(i, 1); groupe.remove(d.g);   // géométries et matériaux partagés : rien à libérer
  }
  // Retire les décombres dont l'emprise chevauche celle d'un bâtiment (x, y au centre, taille en tuiles).
  function degagerEmprise(x, y, taille){
    const demi = taille*TUILE/2;
    for(const d of decombres.slice())
      if(Math.abs(d.x - x) < demi + d.demi && Math.abs(d.y - y) < demi + d.demi) enleverDecombres(d);
  }
  function majDecombres(dt){
    if(dt <= 0) return;
    for(const d of decombres.slice()){
      d.age += dt;
      if(d.age >= VIE_DECOMBRES){ enleverDecombres(d); continue; }
      const k = (d.age - (VIE_DECOMBRES - ENFONCEMENT)) / ENFONCEMENT;   // 0 → 1 pendant l'enfoncement
      if(k > 0) d.g.position.y = d.sol - k*k*PROFONDEUR;
      if(d.reste <= 0) continue;
      d.reste -= dt; d.t -= dt;
      if(d.t <= 0){ d.t = 0.9; fumee(d.x + (Math.random()-.5)*d.r, d.y + (Math.random()-.5)*d.r, 4, 0.1 + 0.25*d.reste/22); }
    }
  }

  // =================================================================
  //  11. CHAMPS DE MINERAI (ressources)
  // =================================================================
  // Chaque nœud de ressource (x, y, reste, max) est un champ de cristaux de sel et de lithium
  // d'environ 110 px de diamètre, posé sur une tache de terrain décolorée. Coût fixe pour toute la
  // carte : deux appels de dessin (une InstancedMesh pour tous les cristaux, une géométrie fusionnée
  // pour toutes les taches). Rien n'est alloué par image : la disposition est tirée une seule fois
  // (graine = position du champ), puis seules les matrices des champs dont le stock a changé sont
  // réécrites. Le champ s'éclaircit à mesure que reste / max baisse (les cristaux rétrécissent puis
  // s'éteignent, de la périphérie vers le cœur) et s'efface entièrement, tache comprise, à zéro.
  // (L'ancien modèle de citerne, fabriquerCiterne, reste dans le fichier mais n'est plus utilisé ici.)
  const CR_PAR_CHAMP = 36,RAYON_CHAMP = 48, RAYON_TACHE = 58, SECT_TACHE = 18, STRIDE_CR = 10;
  const COUL_CRISTAUX = [lin('#f4f2ee'), lin('#f2bccb'), lin('#aee9e1')];   // blanc, rosé, turquoise clair
  // Lueur propre (émissif discret) : presque nulle à midi, plus visible à l'aube, au crépuscule, dans la brume
  const LUEUR_AMBIANCE = {midi:0.04, aube:0.2, crepuscule:0.28, brume:0.22};
  let champs = null, geoCristal = null, matCristal = null, matTache = null;
  const _cP = new THREE.Vector3(), _cQ = new THREE.Quaternion(), _cS = new THREE.Vector3(),
        _cM = new THREE.Matrix4(), _cE = new THREE.Euler(), _mZ = new THREE.Matrix4().makeScale(0, 0, 0);
  // Générateur pseudo-aléatoire à graine (mulberry32) : même champ, même disposition, à chaque partie
  function aleaGraine(graine){
    let s = (graine >>> 0) || 1;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  // Cristal unitaire : prisme hexagonal évasé à la base, pointe décentrée, facettes plates
  // (non indexé : normales par face). Rayon 1, hauteur 1, base enfoncée sous le sol.
  function fabriquerCristal(){
    const pos = [], nf = 6, yb = -0.25, yh = 0.7, rh = 0.78, pointe = [0.08, 1, -0.05];
    const pt = (r, a, y) => [r*Math.cos(a), y, r*Math.sin(a)];
    for(let i = 0; i < nf; i++){
      const a0 = i/nf*Math.PI*2, a1 = (i + 1)/nf*Math.PI*2;
      const b0 = pt(1, a0, yb), b1 = pt(1, a1, yb), h0 = pt(rh, a0, yh), h1 = pt(rh, a1, yh);
      pos.push(...b0, ...h0, ...b1,  ...b1, ...h0, ...h1,  ...h0, ...pointe, ...h1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }
  function materiauxChamps(){
    geoCristal = fabriquerCristal();
    matCristal = new THREE.MeshStandardMaterial({color:0xffffff, roughness:0.3, metalness:0,
      emissive:lin('#dff3f5'), emissiveIntensity:LUEUR_AMBIANCE.midi});
    // Tache : dégradé radial porté par u (0 au centre, 1 au bord), alpha décroissant vers le bord
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 4;
    const cx = cv.getContext('2d'), gr = cx.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.92)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 4);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    matTache = new THREE.MeshStandardMaterial({color:lin('#bdb7ad'), map:tex, transparent:true, depthWrite:false,
      roughness:1, metalness:0, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2});
  }
  function construireChamps(liste){
    if(!geoCristal) materiauxChamps();
    if(champs){ groupe.remove(champs.cristaux); groupe.remove(champs.tache); champs.tache.geometry.dispose(); }
    const N = liste.length, NC = N*CR_PAR_CHAMP;
    const D = new Float32Array(NC*STRIDE_CR), sig = new Float32Array(N*2);
    const cristaux = new THREE.InstancedMesh(geoCristal, matCristal, NC);
    cristaux.castShadow = true; cristaux.receiveShadow = true;
    cristaux.frustumCulled = false;   // la sphère englobante d'une InstancedMesh r128 ne couvre pas les instances
    // Tache : par champ, un centre + deux anneaux (milieu, bord) épousant le relief
    const VPC = 1 + 2*SECT_TACHE, posT = new Float32Array(N*VPC*3), uvT = new Float32Array(N*VPC*2), idx = [];
    for(let i = 0; i < N; i++){
      const n = liste[i]; sig[i*2] = n.x; sig[i*2 + 1] = n.y;
      const r = aleaGraine(Math.imul(Math.round(n.x), 73856093) ^ Math.imul(Math.round(n.y), 19349663) ^ 0x5a17);
      // Amas : 3 à 5 grappes, la première près du centre
      const nbAmas = 3 + Math.floor(r()*3), amas = [];
      for(let a = 0; a < nbAmas; a++){
        const d = a === 0 ? r()*8 : 16 + r()*20, an = r()*Math.PI*2;
        amas.push(Math.cos(an)*d, Math.sin(an)*d);
      }
      // Mélange de couleurs propre au champ (plus rosé ici, plus turquoise là)
      const pb = 0.35 + r()*0.4, pr = r()*0.55, pt = r()*0.55, tot = pb + pr + pt;
      for(let j = 0; j < CR_PAR_CHAMP; j++){
        // Les derniers cristaux sont des éclats isolés semés sur toute la tache
        const a = j % nbAmas, coeur = j < nbAmas, epars = j >= CR_PAR_CHAMP - 8;
        const d = epars ? 0 : Math.pow(r(), 0.7)*(coeur ? 2 : 15), an = r()*Math.PI*2;
        let px = amas[a*2] + Math.cos(an)*d, pz = amas[a*2 + 1] + Math.sin(an)*d;
        if(epars){ const re = RAYON_CHAMP*Math.sqrt(r()), ae = r()*Math.PI*2; px = Math.cos(ae)*re; pz = Math.sin(ae)*re; }
        const dc = Math.hypot(px, pz);
        if(dc > RAYON_CHAMP){ px *= RAYON_CHAMP/dc; pz *= RAYON_CHAMP/dc; }
        const eclat = epars || (!coeur && r() < 0.28);   // éclats bas et trapus
        const h = eclat ? 2.5 + r()*2 : (6 + r()*12)*(coeur ? 1.35 : 1.15 - d/13*0.4);
        const ray = eclat ? h*(0.6 + r()*0.3) : h*(0.2 + r()*0.12);
        // Rang d'extinction : périphérie d'abord, cœur des amas en dernier ; le premier cristal jamais avant zéro
        const rang = j === 0 ? 0 : coeur ? r()*0.08 : Math.min(0.97, Math.min(1, dc/RAYON_CHAMP)*0.7 + r()*0.3);
        _cE.set((r() - 0.5)*0.8, r()*Math.PI*2, (r() - 0.5)*0.8); _cQ.setFromEuler(_cE);
        const o = (i*CR_PAR_CHAMP + j)*STRIDE_CR, wx = n.x + px, wz = n.y + pz;
        D[o] = wx; D[o + 1] = R3D.hauteurSol(wx, wz); D[o + 2] = wz;
        D[o + 3] = _cQ.x; D[o + 4] = _cQ.y; D[o + 5] = _cQ.z; D[o + 6] = _cQ.w;
        D[o + 7] = ray; D[o + 8] = h; D[o + 9] = rang;
        const c = r()*tot;
        cristaux.setColorAt(i*CR_PAR_CHAMP + j, COUL_CRISTAUX[c < pb ? 0 : c < pb + pr ? 1 : 2]);
        cristaux.setMatrixAt(i*CR_PAR_CHAMP + j, _mZ);
      }
      // Tache au contour irrégulier
      const v0 = i*VPC;
      const poser = (v, x, z, u) => { posT[v*3] = x; posT[v*3 + 1] = R3D.hauteurSol(x, z) + 0.5; posT[v*3 + 2] = z; uvT[v*2] = u; uvT[v*2 + 1] = 0.5; };
      poser(v0, n.x, n.y, 0);
      for(let s = 0; s < SECT_TACHE; s++){
        const an = s/SECT_TACHE*Math.PI*2, R = RAYON_TACHE*(0.82 + r()*0.3);
        poser(v0 + 1 + s, n.x + Math.cos(an)*R*0.5, n.y + Math.sin(an)*R*0.5, 0.5);
        poser(v0 + 1 + SECT_TACHE + s, n.x + Math.cos(an)*R, n.y + Math.sin(an)*R, 1);
        const s1 = (s + 1) % SECT_TACHE, m0 = v0 + 1 + s, m1 = v0 + 1 + s1, e0 = m0 + SECT_TACHE, e1 = m1 + SECT_TACHE;
        idx.push(v0, m1, m0,  m0, m1, e1,  m0, e1, e0);   // faces vers le haut
      }
    }
    cristaux.instanceMatrix.needsUpdate = true;
    if(cristaux.instanceColor) cristaux.instanceColor.needsUpdate = true;
    const gT = new THREE.BufferGeometry();
    gT.setAttribute('position', new THREE.BufferAttribute(posT, 3));
    gT.setAttribute('uv', new THREE.BufferAttribute(uvT, 2));
    gT.setIndex(idx); gT.computeVertexNormals();
    const tache = new THREE.Mesh(gT, matTache);
    tache.receiveShadow = true; tache.renderOrder = -1; tache.frustumCulled = false;
    groupe.add(tache); groupe.add(cristaux);
    champs = {liste, N, VPC, D, sig, cristaux, tache, posRef:posT.slice(), k:new Float32Array(N).fill(-1)};
  }
  function majChamps(liste){
    if(!groupe) return;
    if(!liste || !liste.length){ if(champs) champs.cristaux.visible = champs.tache.visible = false; return; }
    // La liste du moteur est vidée puis remplie à chaque partie : on compare aussi les positions
    let refaire = !champs || champs.liste !== liste || champs.N !== liste.length;
    if(!refaire) for(let i = 0; i < champs.N; i++)
      if(champs.sig[i*2] !== liste[i].x || champs.sig[i*2 + 1] !== liste[i].y){ refaire = true; break; }
    if(refaire) construireChamps(liste);
    const C = champs; C.cristaux.visible = C.tache.visible = true;
    const lueur = LUEUR_AMBIANCE[R3D.ambiance];
    matCristal.emissiveIntensity = lueur === undefined ? 0.1 : lueur;
    let mM = false, mT = false;
    const pos = C.tache.geometry.attributes.position;
    for(let i = 0; i < C.N; i++){
      const n = liste[i];
      const k = n.reste <= 0 ? 0 : Math.max(0.01, Math.round((n.max > 0 ? Math.min(1, n.reste/n.max) : 0)*100)/100);
      if(k === C.k[i]) continue;
      const etaitVide = C.k[i] === 0;
      C.k[i] = k; mM = true;
      const taille = 0.7 + 0.3*k;
      for(let j = 0; j < CR_PAR_CHAMP; j++){
        const o = (i*CR_PAR_CHAMP + j)*STRIDE_CR;
        const s = k <= 0 ? 0 : Math.min(1, (k - C.D[o + 9]*0.65)/0.12);
        if(s <= 0){ C.cristaux.setMatrixAt(i*CR_PAR_CHAMP + j, _mZ); continue; }
        const f = (0.35 + 0.65*s)*taille;
        _cP.set(C.D[o], C.D[o + 1], C.D[o + 2]); _cQ.set(C.D[o + 3], C.D[o + 4], C.D[o + 5], C.D[o + 6]);
        _cS.set(C.D[o + 7]*f, C.D[o + 8]*f, C.D[o + 7]*f);
        C.cristaux.setMatrixAt(i*CR_PAR_CHAMP + j, _cM.compose(_cP, _cQ, _cS));
      }
      // Tache : effacée à zéro (sommets ramenés au centre), rétablie si le stock revient
      if(k === 0 || etaitVide){
        const a = pos.array, v0 = i*C.VPC*3;
        for(let v = 0; v < C.VPC*3; v++) a[v0 + v] = k === 0 ? C.posRef[v0 + (v % 3)] : C.posRef[v0 + v];
        mT = true;
      }
    }
    if(mM) C.cristaux.instanceMatrix.needsUpdate = true;
    if(mT) pos.needsUpdate = true;
  }

  // =================================================================
  //  12. FANTÔME DE PLACEMENT
  // =================================================================
  let temoins = null, imagesTemoins = 0;
  let fantomeObj = null, fantomeCle = "", matFantomeOK, matFantomeKO, matFantomeOKu, matFantomeKOu, matGrille, matEmprise;
  const GRILLES = {};
  function grilleEmprise(taille){
    if(GRILLES[taille]) return GRILLES[taille];
    const t = taille*TUILE, pts = [];
    for(let i = 0; i <= taille; i++){ const v = -t/2 + i*TUILE; pts.push(v, 0, -t/2, v, 0, t/2, -t/2, 0, v, t/2, 0, v); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const plan = new THREE.PlaneGeometry(t, t).rotateX(-Math.PI/2);
    return (GRILLES[taille] = {lignes:g, plan});
  }
  function construireFantome(type, fac){
    const m = modele(type, fac), racine = new THREE.Group();
    const inst = instancier(m, () => matFantomeOK, true);
    // Ni marquages ni lumières de nuit sur le fantôme (ils se dessineraient en aplats)
    for(const me of inst.meshes){ me.castShadow = me.receiveShadow = false; if(me.userData.canal === 'decal' || CANAUX_NUIT[me.userData.canal]) me.visible = false; }
    racine.add(inst.groupe);
    const G = grilleEmprise(m.taille);
    const lignes = new THREE.LineSegments(G.lignes, matGrille); lignes.position.y = 1.2; racine.add(lignes);
    const plan = new THREE.Mesh(G.plan, matEmprise); plan.position.y = 1.0; racine.add(plan);
    racine.userData.inst = inst;
    return racine;
  }

  // =================================================================
  //  12 bis. PRÉCHAUFFAGE (contrat commun : R3D.prechauffer, pendant « Chargement… »)
  // =================================================================
  // Fabrique d'avance tous les modèles (type × variante de camp présente), leurs échafaudages et
  // leurs décombres, puis pose hors champ (y = -10 000, frustumCulled = false : envoyés à la carte
  // graphique, mais aucun pixel dessiné) un maillage de chaque géométrie avec chaque matériau qu'il
  // pourra porter (normal, abîmé, critique), plus ceux du fantôme, de la sélection et du
  // ralliement. Ces maillages sont dans la vraie scène (mêmes lumières, ombres, brouillard) : le
  // renderer.compile de R3D.prechauffer compile les bons programmes, et les premières images
  // envoient géométries et textures. Le groupe est retiré de la scène après IMAGES_PRECHAUFFE
  // appels de sync ; rien n'est libéré (dispose) : programmes et tampons restent en vie.
  // Il n'entre jamais dans `etats`, ni dans racines() (pointage), ni dans la minicarte.
  const IMAGES_PRECHAUFFE = 3;
  let prechauffe = null, imagesPrechauffe = 0;
  // Variantes à fabriquer : les trois factions d'origine (au chargement, la partie n'est pas encore
  // configurée ; un duel Halden bleu contre Karsk rouge n'emploie que celles-là), plus celles des
  // camps de la partie en cours (couleurs de camp). Les envahisseurs n'ont pas de bâtiments.
  function variantesPresentes(){
    const v = new Set(['halden', 'karsk', 'neutre']);
    if(typeof camps !== 'undefined' && camps) for(const id in camps){
      try { const f = variante(id); if(PAL[facBase(f)]) v.add(f); } catch(e){ /* camp incomplet */ }
    }
    return [...v];
  }
  // Types qu'un camp de cette faction peut posséder : les communs, plus ses bâtiments propres
  // (special, defense, extras de FACTIONS) ; pas ceux propres à une autre faction. La Régie : ses
  // bâtiments civils.
  function typesPossibles(base){
    const out = [];
    if(typeof BATIMENTS === 'undefined') return out;
    const F = typeof FACTIONS !== 'undefined' ? FACTIONS : {};
    const propres = f => { const x = F[f] || {}; return [x.special, x.defense].concat(x.extras || []).filter(Boolean); };
    const miens = new Set(propres(base)), autres = new Set();
    for(const f in F) if(f !== base) for(const t of propres(f)) autres.add(t);
    for(const type in BATIMENTS){
      if(!!BATIMENTS[type].neutre !== (base === 'neutre')) continue;
      if(autres.has(type) && !miens.has(type)) continue;
      out.push(type);
    }
    return out;
  }
  function prechaufferBatiments(){
    if(!groupe || typeof BATIMENTS === 'undefined') return null;
    const t0 = performance.now();
    if(prechauffe){ groupe.remove(prechauffe); prechauffe = null; }
    const P = new THREE.Group(); P.name = 'prechauffage-batiments'; P.position.set(0, -10000, 0);
    let nbModeles = 0, nbMaillages = 0;
    const poser = (geo, mat, ombre) => {
      const me = new THREE.Mesh(geo, mat);
      me.frustumCulled = false; me.castShadow = !!ombre; me.receiveShadow = true;
      if(geo.attributes.aCanal) me.customDepthMaterial = ombreCorps(!!geo.attributes.aPivot);   // ombre du corps : son propre programme
      P.add(me); nbMaillages++;
    };
    // États abîmé et critique : mêmes réglages que l'état normal, donc même programme ; leurs
    // matériaux sont créés ici (inscrits au registre) mais sans maillage de plus.
    const poserGeos = (geos, fac) => {
      if(!geos) return;
      geos = fusionner(geos);
      for(const c in geos){
        if(CANAUX_NUIT[c]) continue;   // canaux de nuit : un témoin par programme suffit (plus bas)
        poser(geos[c], materiau(c, fac, 'normal'), c === 'corps' || (c === 'drapeau' && OMBRE_DRAPEAU));
        materiau(c, fac, 'abime'); materiau(c, fac, 'critique');
      }
    };
    const variantes = variantesPresentes();
    let msModeles = 0;
    for(const fac of variantes){
      for(const type of typesPossibles(facBase(fac))){
        let m, a0 = performance.now();
        try { m = modele(type, fac); } catch(e){ continue; }
        msModeles += performance.now() - a0;
        nbModeles++;
        poserGeos(m.geos, fac);
        const AF = animsFusionnees(m);
        if(AF){ poser(AF.g, materiau('corpsAnim', fac, 'normal'), true); materiau('corpsAnim', fac, 'abime'); materiau('corpsAnim', fac, 'critique'); }
        for(const a of m.anims){
          if(a.type === 'drapeau') poser(geoDrapeau(m.base).g, materiau('drapeau', fac, 'normal'), true);
          if(!(AF && AF.anims.has(a))) poserGeos(a.geos, fac);
          if(a.enfant){ poserGeos(a.enfant.geos, fac); if(a.enfant.eclair) poserGeos(a.enfant.eclair.geos, fac); }
        }
        const E = m.echafaudage;
        if(E){ poserGeos(E.echaf, fac); poserGeos(E.niveau, fac); poserGeos(E.mat, fac); poserGeos(E.fleche, fac); }
        // Décombres : PAS fabriqués ici. Mesuré : 330 ms pour les 40 géométries de cinq variantes de
        // camp, soit environ 8 ms en moyenne pour celle fabriquée à la première destruction.
        // Leurs matériaux sont ceux des bâtiments, donc déjà compilés.
      }
    }
    // Chaque matériau de canal, même si aucun modèle fabriqué ne l'emploie encore : la clé d'un
    // programme ne dépend que du matériau, une boîte suffit pour le compiler.
    // Le corps a besoin de son attribut aCanal : témoin fusionné d'un gabarit de boîte.
    const temoinCorps = fusionner(new Bati(1).boite('opaque', '#888888', 0, 0, 0, 1, 1, 1).construire());
    for(const fac of variantes){
      poser(temoinCorps.corps, materiau('corps', fac, 'normal'), true);
      materiau('corps', fac, 'abime'); materiau('corps', fac, 'critique');
      for(const c of ['decal', 'drapeau']) poser(geoProxy, materiau(c, fac, 'normal'), c === 'drapeau' && OMBRE_DRAPEAU);
    }
    // Lumières de nuit (additives) : un témoin toujours visible, même programme que les vraies
    // (même fonction, même clé), qui ne s'allument qu'au crépuscule ou dans la brume.
    poser(geoProxy, temoinNuit());
    // Fantôme de placement (couleurs de sommets ou non), crochets de sélection, ralliement
    const tailles = new Set(); for(const type in BATIMENTS) tailles.add(BATIMENTS[type].taille);
    const unModele = MODELES[Object.keys(MODELES)[0]];
    if(unModele && unModele.geos.opaque){ poser(unModele.geos.opaque, matFantomeOK, false); poser(unModele.geos.opaque, matFantomeKO, false); }
    poser(geoProxy, matFantomeOKu, false); poser(geoProxy, matFantomeKOu, false);
    for(const t of tailles){
      const sg = geoSelection(t); poser(sg, matSelJ); poser(sg, matSelI); poser(sg, matSelN);
      const G = grilleEmprise(t), l = new THREE.LineSegments(G.lignes, matGrille); l.frustumCulled = false; P.add(l);
      poser(G.plan, matEmprise);
    }
    poser(geoRallyMat, matRallyMat, true); poser(geoRallyFanion, matRallyFanion); poser(geoRallyAnneau, matRallyAnneau);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,1], 3));
    const ligne = new THREE.Line(lg, matRallyLigne); ligne.computeLineDistances(); ligne.frustumCulled = false; P.add(ligne);
    groupe.add(P); prechauffe = P; imagesPrechauffe = IMAGES_PRECHAUFFE;
    if(temoins){ temoins.visible = true; imagesTemoins = Math.max(imagesTemoins, IMAGES_PRECHAUFFE); }
    return {modeles:nbModeles, maillages:nbMaillages, variantes:variantes.length, ms:Math.round(performance.now() - t0),
      msModeles:Math.round(msModeles)};
  }
  // Modèles des camps arrivés après le préchauffage (couleurs de camp choisies au menu, partie
  // lancée ensuite) : fabriqués en tâche de fond, un par appel de sync, avant qu'on en ait besoin
  // (sans cela, la première caserne d'un camp coloré coûtait 57 à 61 ms de processeur en pleine
  // partie). Les camps sont relus tous les 15 appels seulement.
  let fileModeles = [], signatureCamps = '', tourCamps = 0;
  function majFileModeles(){
    if(++tourCamps < 15) return;
    tourCamps = 0;
    if(typeof camps === 'undefined' || !camps) return;
    let sig = '';
    for(const id in camps){ try { sig += variante(id) + ','; } catch(e){ /* camp incomplet */ } }
    if(sig === signatureCamps) return;
    signatureCamps = sig; fileModeles = [];
    for(const fac of variantesPresentes()) for(const type of typesPossibles(facBase(fac)))
      if(!MODELES[type + '_' + fac]) fileModeles.push([type, fac]);
  }
  function avancerFileModeles(){
    majFileModeles();
    while(fileModeles.length){
      const [type, fac] = fileModeles.shift();
      if(MODELES[type + '_' + fac]) continue;
      try { modele(type, fac); } catch(e){ /* modèle impossible : il sera tenté à la demande */ }
      return;
    }
  }

  // =================================================================
  //  13. INTERFACE PUBLIQUE
  // =================================================================
  R3D.Batiments = {
    // Hauteur du tarmac et de la piste de l'aéroport au-dessus du sol (les avions y roulent)
    HAUTEUR_PISTE: H_PISTE,
    init(){
      groupe = new THREE.Group(); groupe.name = 'batiments'; R3D.scene.add(groupe);
      geoProxy = new THREE.BoxGeometry(1, 1, 1);
      matSelJ = new THREE.MeshBasicMaterial({color:lin('#5dff7c'), transparent:true, opacity:0.9, depthWrite:false, toneMapped:false});
      matSelI = new THREE.MeshBasicMaterial({color:lin('#ff5a43'), transparent:true, opacity:0.9, depthWrite:false, toneMapped:false});
      // Camp neutre (Régie) : crochets bleu pâle, ni « ami » ni « ennemi »
      matSelN = new THREE.MeshBasicMaterial({color:lin('#bfe3ff'), transparent:true, opacity:0.9, depthWrite:false, toneMapped:false});
      // Fantôme : couleurs de sommets du vrai modèle teintées vert / rouge, écriture de profondeur
      // active (seules les faces avant se voient) : les volumes et les détails restent lisibles.
      const fant = (c, em, vc) => new THREE.MeshStandardMaterial({color:lin(c), emissive:lin(em), vertexColors:vc,
        roughness:0.7, transparent:true, opacity:0.62});
      matFantomeOK = fant('#9dffb0', '#145a24', true);  matFantomeKO = fant('#ff9a8a', '#6a140c', true);
      matFantomeOKu = fant('#5dff7c', '#1f7a35', false); matFantomeKOu = fant('#ff4a3a', '#8a2014', false);
      matGrille = new THREE.LineBasicMaterial({color:lin('#5dff7c'), transparent:true, opacity:0.85, depthWrite:false, toneMapped:false});
      matEmprise = new THREE.MeshBasicMaterial({color:lin('#5dff7c'), transparent:true, opacity:0.16, depthWrite:false, toneMapped:false});
      // Ralliement
      // Fanion assez grand pour rester lisible au zoom par défaut (~25 px à l'écran)
      geoRallyMat = new THREE.CylinderGeometry(0.8, 0.8, 24, 6);
      geoRallyFanion = new THREE.BufferGeometry();
      geoRallyFanion.setAttribute('position', new THREE.Float32BufferAttribute([0,0.5,0, 0,-8.5,0, 16,-4,0, 0,0.5,0, 16,-4,0, 0,-8.5,0], 3));
      geoRallyFanion.computeVertexNormals();
      geoRallyAnneau = new THREE.RingGeometry(6.5, 9.5, 32);
      matRallyMat = new THREE.MeshStandardMaterial({color:lin('#d9dcdc'), roughness:0.5});
      matRallyFanion = new THREE.MeshBasicMaterial({color:lin('#5dff7c'), side:THREE.DoubleSide, toneMapped:false});
      matRallyAnneau = new THREE.MeshBasicMaterial({color:lin('#5dff7c'), transparent:true, opacity:0.8, depthWrite:false, toneMapped:false, side:THREE.DoubleSide});
      matRallyLigne = new THREE.LineDashedMaterial({color:lin('#5dff7c'), dashSize:8, gapSize:6, transparent:true, opacity:0.85, toneMapped:false});
      // Champs de minerai présents dès le menu
      if(typeof noeuds !== 'undefined') majChamps(noeuds);
      // Précompilation des programmes « coupe-chantier » : un poste témoin permanent dont les
      // maillages (un triangle dégénéré, coupe à -1e6 : rien n'est jamais dessiné) sont rendus
      // pendant les premières images, puis masqués. Leurs matériaux ne sont jamais libérés, ce qui
      // garde les programmes en vie pour toute la partie. (Pas de renderer.compile ici : les
      // lumières du module d'effets n'existent pas encore, le programme compilé serait le mauvais.)
      const temoin = prendrePoste(); temoin.u.value = -1e6;
      const geoTemoin = new THREE.BufferGeometry();
      geoTemoin.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0, 0,0,0], 3));
      geoTemoin.setAttribute('normal', new THREE.Float32BufferAttribute([0,1,0, 0,1,0, 0,1,0], 3));
      geoTemoin.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 0,0, 0,0], 2));
      geoTemoin.setAttribute('color', new THREE.Float32BufferAttribute([1,1,1, 1,1,1, 1,1,1], 3));
      geoTemoin.setAttribute('aCanal', new THREE.Float32BufferAttribute([0, 0, 0], 1));   // corps fusionné
      geoTemoin.setAttribute('aPivot', new THREE.Float32BufferAttribute(new Array(12).fill(0), 4));   // pièces tournantes
      geoTemoin.setAttribute('aAnimB', new THREE.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1], 3));
      temoins = new THREE.Group(); temoins.name = 'temoins-chantier';
      for(const fac of Object.keys(FACTIONS)) for(const c of CANAUX_COUPABLES){
        const me = new THREE.Mesh(geoTemoin, matCoupable(temoin, c, fac));
        me.frustumCulled = false; me.castShadow = false; me.receiveShadow = true; temoins.add(me);
      }
      groupe.add(temoins); imagesTemoins = 3;
    },
    // Hauteur (unités three, au-dessus du sol) où placer la barre de vie d'un bâtiment :
    // haut du volume principal (sans mâts ni antennes) + 6. Sans camp précisé, on prend le plus
    // haut des modèles propres à ce type (un par camp qui en a un) pour que la barre ne coupe
    // jamais un toit, sans fabriquer de modèle inutile.
    hauteurBarre(type, fac){
      if(!BATIMENTS[type]) return 0;
      const facs = fac && FACTIONS[fac] ? [fac] : FABRIQUES[type] ? Object.keys(FABRIQUES[type]) : Object.keys(FACTIONS);
      let h = 0;
      for(const f of facs) h = Math.max(h, modele(type, f).corps[4]);
      return h + 6;
    },
    sync(ents, listeNoeuds, temps, dt){
      if(!groupe) return;
      if(imagesTemoins > 0 && --imagesTemoins === 0) temoins.visible = false;
      if(imagesPrechauffe > 0 && --imagesPrechauffe === 0 && prechauffe){ groupe.remove(prechauffe); prechauffe = null; }
      for(const fac in DRAPEAUX) onduler(DRAPEAUX[fac], temps);
      U_TEMPS.value = temps;   // feux et vacillement des lumières du corps (shader)
      majNuit();
      const pulse = 0.7 + 0.3*Math.sin(temps*6);
      matSelJ.opacity = matSelI.opacity = matSelN.opacity = pulse;
      const vus = new Set();
      for(const b of ents){
        if(b.est !== 'batiment' || !camps[b.camp]) continue;
        vus.add(b.id);
        let s = etats.get(b.id);
        if(!s){ s = creer(b); etats.set(b.id, s); }
        majBatiment(s, b, temps, dt);
      }
      for(const [id, s] of etats) if(!vus.has(id)){ retirer(s); if(s.b.mort) poserDecombres(s); etats.delete(id); }
      majDecombres(dt);
      majChamps(listeNoeuds);
      if(dt > 0) avancerFileModeles();
    },
    // Fantôme de placement : type null = masquer. valide : vert / rouge.
    // campId (facultatif) : camp qui place le bâtiment ; à défaut, le joueur local (campJoueur,
    // sinon 'J'), retenu seulement s'il est de cette faction. Le fanion du fantôme garde alors la
    // couleur du camp.
    fantome(type, facKey, c, r, valide, campId){
      if(!groupe) return;
      if(!type || !BATIMENTS[type]){ if(fantomeObj) fantomeObj.visible = false; return; }
      const id = campId || (typeof campJoueur !== 'undefined' ? campJoueur : 'J');
      const v = id && typeof camps !== 'undefined' && camps[id] && camps[id].faction === facKey ? variante(id) : facKey;
      const cle = type + '_' + v;
      if(cle !== fantomeCle){
        if(fantomeObj) groupe.remove(fantomeObj);
        fantomeObj = construireFantome(type, v); fantomeCle = cle;
        groupe.add(fantomeObj);
      }
      const t = BATIMENTS[type].taille, x = (c + t/2)*TUILE, y = (r + t/2)*TUILE;
      fantomeObj.visible = true;
      fantomeObj.position.set(x, R3D.hauteurSol(x, y), y);
      for(const me of fantomeObj.userData.inst.meshes)
        me.material = me.userData.canal === 'drapeau' ? materiau('drapeau', v, 'normal')
          : me.geometry.attributes.color ? (valide ? matFantomeOK : matFantomeKO) : (valide ? matFantomeOKu : matFantomeKOu);
      const coul = lin(valide ? '#5dff7c' : '#ff4a3a');
      matGrille.color.copy(coul); matEmprise.color.copy(coul);
    },
    racines(){ const out = []; for(const s of etats.values()) out.push(s.proxy); return out; },
    // Contrat commun : appelé par R3D.prechauffer() pendant « Chargement… », avant renderer.compile.
    // Renvoie {modeles, maillages, variantes, ms} (ms : temps processeur de la fabrication).
    prechauffer(){ try { return (this.dernierPrechauffage = prechaufferBatiments()); } catch(e){ if(typeof console !== 'undefined') console.error('Batiments.prechauffer', e); return null; } },
  };
})();
