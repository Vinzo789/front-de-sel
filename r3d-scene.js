'use strict';
/* =====================================================================
   FRONT DE SEL — rendu 3D : scène, caméra, lumière, ciel, terrain, mer,
   rivières et ponts, décor, structures neutres (usine de dessalement,
   village, port, raffinerie, ruines, phare, ferme, barrage).
   Repère : jeu (x, y) -> three (X = x, Y = hauteur, Z = y). 1 pixel de jeu = 1 unité.
   three.js r128 (global THREE). Aucun stockage navigateur.

   La scène est GÉNÉRIQUE : elle se construit, au moment de R3D.init, à partir
   de la carte courante exposée par le moteur (globale CARTE et globales
   associées : cote, grille, roches, bosquets, RIVIERES, PONTS, STRUCTURES,
   ROUTES, noeuds). Sans ces globales, elle se rabat sur des valeurs sûres.

   Organisation :
     1. Outils (aléatoire, bruit, couleurs, fusion de géométries)
     2. Lecture de la carte (normalisation des globales du moteur)
     3. Ambiances (midi, aube, crépuscule, brume)
     4. Relief (hauteurSol exact par rapport au maillage, ponts compris)
     5. Texture du sol (canvas procédural) et texture de détail
     6. Ciel, mer, rivières, brume basse, terrain
     7. Rochers, décor (blocs fusionnés), bosquets, roseaux, maisons hors carte
     8. Structures neutres et ponts
     9. Lumières d'ambiance (halos, faisceau du phare, torchères)
    10. Brûlures (pool recyclé)
    11. Caméra, ombres, interface publique (pick, ecranVersSol, ...)
   ===================================================================== */
(function(){
  const R3D = window.R3D = window.R3D || {};

  // ---------------------------------------------------------------
  //  Réglages généraux
  // ---------------------------------------------------------------
  const NIV_MER = -1.4;                       // hauteur de la surface de la mer
  const NIV_RIV = -2.6;                       // surface des rivières
  const FOND_RIV = -8;                        // fond du lit des rivières
  const PONT_H = 1.2;                         // hauteur de la chaussée des ponts (les unités roulent dessus)
  const PONT_RAMPE = 16;                      // longueur des rampes d'accès aux extrémités d'un pont
  // Zone couverte par la texture détaillée du sol (au-delà : couleurs de sommets).
  const TX0 = -900, TY0 = -700, TW = 5000;
  const TEX_L = 4096, TEX_H = 2704;
  const TS = TEX_L / TW, TH = TEX_H / TS;
  // Grille du maillage de terrain (pas de 20 = une demi-tuile : berges et rivages plus fins).
  const GX0 = -2000, GZ0 = -1800, GPAS = 20, GNX = 360, GNZ = 290;
  const MAX_BRULURES = 150;

  let renderer, scene, camera, soleil, appoint, hemi;
  let ciel, mer, sol, matMer = null, matCiel, matRiv = null, matBrumeBasse = null, brulures, nbBrulures = 0;
  let matFeux = null, matFixes = null, matFlammes = null, faisceaux = [], halosObj = null;
  let hauteurs = null;                        // Float32Array des hauteurs aux nœuds de la grille
  // Environnement (reflets et lumière du ciel), uniformes du ciel partagés par le ciel, la mer,
  // les rivières et la carte d'environnement, assombrissement du ciel (R3D.assombrir).
  let pmrem = null, envCible = null, sceneEnv = null, matEnv = null;
  let envJour = null, envNuit = null, matMelangeEnv = null, sceneMelange = null, camMelange = null;
  let U_CIEL = null;
  let sombreCible = 0, sombre = 0, sombreApplique = -1, sombreEnv = 0, tSombre = 0;
  let hemiBase = 0, appointBase = 0;
  const COUL = {};                            // couleurs de référence de l'ambiance (jour) et leurs cibles sombres
  const raycaster = new THREE.Raycaster();
  const planSol = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
  const v2 = new THREE.Vector2(), v3 = new THREE.Vector3();
  // Direction vers le soleil (fixée par l'ambiance au moment de init).
  const dirSoleil = new THREE.Vector3(-0.80, 0.62, 0.30).normalize();

  // Point visé au sol (coordonnées de jeu), distance caméra, inclinaison (recalculée selon la distance).
  R3D.vue = {x:1600, y:1100, distance:820, distanceMin:380, distanceMax:1700, inclinaison:0.95};
  R3D.niveauMer = NIV_MER;
  R3D.niveauRiviere = NIV_RIV;
  R3D.dirSoleil = dirSoleil.clone();

  // =================================================================
  //  1. OUTILS
  // =================================================================
  // Générateur pseudo-aléatoire propre au rendu (ne touche pas à alea() du moteur).
  function generateur(graine){
    let s = graine >>> 0;
    return function(){
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lisse = (a, b, v) => { const t = clamp((v - a)/(b - a), 0, 1); return t*t*(3 - 2*t); };

  function hash2(i, j){
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h & 0xffffff) / 0xffffff;
  }
  function hash3(i, j, k){ return hash2(i + Math.imul(k, 1013), j - Math.imul(k, 7919)); }
  function bruit2(x, y){
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const u = fx*fx*(3 - 2*fx), v = fy*fy*(3 - 2*fy);
    const a = hash2(i, j), b = hash2(i+1, j), c = hash2(i, j+1), d = hash2(i+1, j+1);
    return a + (b - a)*u + (c - a)*v + (a - b - c + d)*u*v;
  }
  function fbm2(x, y, oct){
    let s = 0, a = 0.5, n = 0, f = 1;
    for(let o = 0; o < oct; o++){ s += a*bruit2(x*f + o*17.3, y*f - o*9.1); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  function bruit3(x, y, z){
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const fx = x - i, fy = y - j, fz = z - k;
    const u = fx*fx*(3-2*fx), v = fy*fy*(3-2*fy), w = fz*fz*(3-2*fz);
    const l = (a, b, t) => a + (b - a)*t;
    const x00 = l(hash3(i,j,k),     hash3(i+1,j,k),     u), x10 = l(hash3(i,j+1,k),   hash3(i+1,j+1,k),   u);
    const x01 = l(hash3(i,j,k+1),   hash3(i+1,j,k+1),   u), x11 = l(hash3(i,j+1,k+1), hash3(i+1,j+1,k+1), u);
    return l(l(x00, x10, v), l(x01, x11, v), w);
  }
  // Bruit périodique (texture de détail répétable sans couture).
  function bruit2P(x, y, p){
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const u = fx*fx*(3 - 2*fx), v = fy*fy*(3 - 2*fy);
    const m = n => ((n % p) + p) % p;
    const a = hash2(m(i), m(j)), b = hash2(m(i+1), m(j)), c = hash2(m(i), m(j+1)), d = hash2(m(i+1), m(j+1));
    return a + (b - a)*u + (c - a)*v + (a - b - c + d)*u*v;
  }

  // Couleurs : les couleurs de sommets/instances sont en espace linéaire.
  const cacheCouleurs = {};
  function lin(hex){
    if(cacheCouleurs[hex]) return cacheCouleurs[hex];
    return (cacheCouleurs[hex] = new THREE.Color(hex).convertSRGBToLinear());
  }
  const rgb = (r, g, b) => [r, g, b];
  function mixRgb(a, b, t){ return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t]; }
  const s2l = c => { c /= 255; return c <= 0.04045 ? c/12.92 : Math.pow((c + 0.055)/1.055, 2.4); };

  // -----------------------------------------------------------------
  //  Fusion de géométries : positions / normales / couleurs de sommets,
  //  non indexées. Remplace BufferGeometryUtils (absent du cœur r128).
  // -----------------------------------------------------------------
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _haut = new THREE.Vector3(0,1,0);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
  const geoCache = {};
  function geoBase(cle, f){ return geoCache[cle] || (geoCache[cle] = f()); }

  class Fusion {
    constructor(){ this.pos = []; this.nor = []; this.col = []; }
    // Ajoute une géométrie transformée par la matrice m. coul : '#hex' | THREE.Color | function(x,y,z,nx,ny,nz) -> Color.
    geo(g, m, coul, plat){
      let h = g.index ? g.toNonIndexed() : g.clone();
      h.applyMatrix4(m);
      if(plat) h.computeVertexNormals();
      const P = h.attributes.position.array, N = h.attributes.normal.array;
      if(coul === undefined || coul === null) coul = '#ffffff';
      const fixe = typeof coul === 'function' ? null : (typeof coul === 'string' ? lin(coul) : coul);
      for(let i = 0; i < P.length; i += 3){
        this.pos.push(P[i], P[i+1], P[i+2]);
        this.nor.push(N[i], N[i+1], N[i+2]);
        const c = fixe || coul(P[i], P[i+1], P[i+2], N[i], N[i+1], N[i+2]);
        this.col.push(c.r, c.g, c.b);
      }
      h.dispose();
      return this;
    }
    // Boîte : (x, z) centre au sol, y = base, rotation ry autour de la verticale.
    boite(l, h, p, x, y, z, coul, ry){
      _m.compose(_p.set(x, y + h/2, z), _q.setFromEuler(_e.set(0, ry || 0, 0)), _s.set(l, h, p));
      return this.geo(geoBase('boite', () => new THREE.BoxGeometry(1,1,1)), _m, coul);
    }
    // Boîte centrée en (x, y, z), rotation libre (débris, dalles effondrées).
    boiteR(l, h, p, x, y, z, coul, rx, ry, rz){
      _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), _s.set(l, h, p));
      return this.geo(geoBase('boite', () => new THREE.BoxGeometry(1,1,1)), _m, coul);
    }
    // Cylindre vertical : base à y.
    cyl(rH, rB, h, x, y, z, coul, seg){
      seg = seg || 12;
      const g = geoBase('cyl' + seg + '_' + (rH/rB).toFixed(3), () => new THREE.CylinderGeometry(rH/rB, 1, 1, seg, 1));
      _m.compose(_p.set(x, y + h/2, z), _q.identity(), _s.set(rB, h, rB));
      return this.geo(g, _m, coul);
    }
    // Tube entre deux points [x,y,z].
    tube(a, b, r, coul, seg){
      seg = seg || 8;
      _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
      const L = _a.distanceTo(_b);
      if(L < 1e-4) return this;
      _c.subVectors(_b, _a).normalize();
      _q.setFromUnitVectors(_haut, _c);
      _p.addVectors(_a, _b).multiplyScalar(0.5);
      _m.compose(_p, _q, _s.set(r, L, r));
      return this.geo(geoBase('tube' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1)), _m, coul);
    }
    sphere(r, x, y, z, coul, sy){
      _m.compose(_p.set(x, y, z), _q.identity(), _s.set(r, r*(sy || 1), r));
      return this.geo(geoBase('sph', () => new THREE.SphereGeometry(1, 10, 6)), _m, coul);
    }
    // Triangle libre (normale de face), couleurs par sommet facultatives.
    tri(a, b, c, ca, cb, cc){
      _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]); _c.set(c[0], c[1], c[2]);
      _n.subVectors(_c, _b).cross(_p.subVectors(_a, _b)).normalize();
      const A = typeof ca === 'string' ? lin(ca) : ca;
      const B = cb ? (typeof cb === 'string' ? lin(cb) : cb) : A, C = cc ? (typeof cc === 'string' ? lin(cc) : cc) : A;
      for(const [v, k] of [[_a, A], [_b, B], [_c, C]]){
        this.pos.push(v.x, v.y, v.z); this.nor.push(_n.x, _n.y, _n.z); this.col.push(k.r, k.g, k.b);
      }
      return this;
    }
    quad(a, b, c, d, ca, cb, cc, cd){ this.tri(a, b, c, ca, cb, cc); this.tri(a, c, d, ca, cc, cd || cc); return this; }
    // Quadrilatère visible des deux côtés (toits fins, rampes).
    quad2(a, b, c, d, coul){ this.quad(a, b, c, d, coul); this.quad(a, d, c, b, coul); return this; }
    // Décale horizontalement tout ce qui a été ajouté depuis l'indice debut.
    decaler(debut, dx, dz){ for(let i = debut; i < this.pos.length; i += 3){ this.pos[i] += dx; this.pos[i+2] += dz; } }
    vide(){ return this.pos.length === 0; }
    geometrie(){
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.computeBoundingSphere();
      return g;
    }
  }

  // Géométrie d'eau (rivières, bassins, déversoirs) : un seul maillage, matériau animé.
  // uv = (abscisse le long du courant, écart en travers) en pixels ; aInfo = (vitesse, demi-largeur) ;
  // aDir = direction du courant au sol.
  class FusionEau {
    constructor(){ this.pos = []; this.uv = []; this.info = []; this.dir = []; }
    sommet(x, y, z, u, v, vit, demi, dx, dz){
      this.pos.push(x, y, z); this.uv.push(u, v); this.info.push(vit, demi); this.dir.push(dx, dz);
    }
    // Quadrilatère plan ou incliné : coins [x,y,z] dans l'ordre, uv correspondants.
    quad(P, U, vit, demi, dx, dz){
      for(const k of [0, 1, 2, 0, 2, 3]) this.sommet(P[k][0], P[k][1], P[k][2], U[k][0], U[k][1], vit, demi, dx, dz);
    }
    vide(){ return this.pos.length === 0; }
    geometrie(){
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 2));
      g.setAttribute('aDir', new THREE.Float32BufferAttribute(this.dir, 2));
      g.computeBoundingSphere();
      return g;
    }
  }

  // Géométrie : distance d'un point à une ligne brisée, à un rectangle.
  function distSegment(x, y, x0, y0, x1, y1){
    const dx = x1 - x0, dy = y1 - y0, l2 = dx*dx + dy*dy || 1;
    const t = clamp(((x - x0)*dx + (y - y0)*dy)/l2, 0, 1);
    return Math.hypot(x - x0 - dx*t, y - y0 - dy*t);
  }
  function distLigne(pts, x, y){
    let d = Infinity;
    for(let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSegment(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]));
    return d;
  }
  function distRect(x, y, x0, y0, x1, y1){
    const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
    return Math.hypot(dx, dy);
  }
  function polyligne(g, pts){ g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); }
  // Polyligne décalée latéralement (bords de route).
  function decaler(pts, d){
    const res = [];
    for(let i = 0; i < pts.length; i++){
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      res.push([p[0] - ty*d, p[1] + tx*d]);
    }
    return res;
  }
  // Rééchantillonne une polyligne tous les pas pixels : [x, y, angle, abscisse].
  function echantillonner(pts, pas){
    const res = [];
    let s = 0;
    for(let i = 0; i < pts.length - 1; i++){
      const [x0, y0] = pts[i], [x1, y1] = pts[i+1], L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L/pas));
      for(let k = 0; k < n; k++){ const t = k/n; res.push([x0 + (x1 - x0)*t, y0 + (y1 - y0)*t, Math.atan2(y1 - y0, x1 - x0), s + L*t]); }
      s += L;
    }
    const d = pts[pts.length - 1]; res.push([d[0], d[1], res.length ? res[res.length - 1][2] : 0, s]);
    return res;
  }

  // =================================================================
  //  2. LECTURE DE LA CARTE
  // =================================================================
  // Les globales du moteur sont des const/let de script : on les lit par typeof, à l'abri
  // d'un try (une variable pas encore initialisée lèverait une erreur).
  const LIRE = {
    CARTE:        () => typeof CARTE !== 'undefined' ? CARTE : undefined,
    cote:         () => typeof cote !== 'undefined' ? cote : undefined,
    grille:       () => typeof grille !== 'undefined' ? grille : undefined,
    roches:       () => typeof roches !== 'undefined' ? roches : undefined,
    bosquets:     () => typeof bosquets !== 'undefined' ? bosquets : undefined,
    RIVIERES:     () => typeof RIVIERES !== 'undefined' ? RIVIERES : undefined,
    PONTS:        () => typeof PONTS !== 'undefined' ? PONTS : undefined,
    STRUCTURES:   () => typeof STRUCTURES !== 'undefined' ? STRUCTURES : undefined,
    ROUTES:       () => typeof ROUTES !== 'undefined' ? ROUTES : undefined,
    noeuds:       () => typeof noeuds !== 'undefined' ? noeuds : undefined,
    USINE_DESSAL: () => typeof USINE_DESSAL !== 'undefined' ? USINE_DESSAL : undefined,
    TUILE:        () => typeof TUILE !== 'undefined' ? TUILE : undefined,
    COLS:         () => typeof COLS !== 'undefined' ? COLS : undefined,
    LIGNES:       () => typeof LIGNES !== 'undefined' ? LIGNES : undefined,
  };
  function lire(nom){ try { return LIRE[nom](); } catch(e){ return undefined; } }
  const tableau = v => Array.isArray(v) ? v : [];

  // Carte normalisée, utilisée par toute la scène.
  let M = null;
  let T_TUILE = 40, NC = 80, NL = 56, LX = 3200, LY = 2240;
  let coteF = () => Infinity;                  // y du rivage pour une abscisse x (Infinity : pas de mer)
  let RIVS = [], PONTS_R = [], STRS = [], RTES = [], BASES = [], VALLEES = [];

  function lireCarte(){
    T_TUILE = lire('TUILE') || 40; NC = lire('COLS') || 80; NL = lire('LIGNES') || 56;
    LX = NC*T_TUILE; LY = NL*T_TUILE;
    const C = lire('CARTE') || null;
    const fCote = lire('cote');
    // Paramètres de la côte : ceux de la carte, ou ceux de Port-Calmes si le moteur ne fournit
    // que l'ancienne fonction cote() (sans objet CARTE).
    let coteP = null;
    if(C) coteP = C.cote || null;
    else if(typeof fCote === 'function' && isFinite(fCote(0))) coteP = {base:1890, ondes:[[60, 250, 0], [35, 90, 1.3]]};
    const coteParam = coteP ? (x => { let y = coteP.base; for(const o of tableau(coteP.ondes)) y += o[0]*Math.sin(x/o[1] + (o[2] || 0)); return y; }) : (() => Infinity);
    coteF = typeof fCote === 'function' ? (x => { const v = fCote(x); return typeof v === 'number' && !isNaN(v) ? v : Infinity; }) : coteParam;
    if(!coteP) coteF = () => Infinity;

    let structures = lire('STRUCTURES') || (C && C.structures);
    if(!structures){
      const U = lire('USINE_DESSAL');
      structures = U ? [{type:'usine_dessal', x:U.x, y:U.y, l:U.l, h:U.h}] : [];
    }
    let routes = lire('ROUTES') || (C && C.routes) || [];
    const nds = tableau(lire('noeuds') || (C && C.noeuds)).map(n => Array.isArray(n) ? {x:n[0], y:n[1]} : n).filter(n => n && isFinite(n.x));
    let bases = [];
    if(C && C.bases){
      for(const k of Object.keys(C.bases)){ const b = C.bases[k]; if(b && isFinite(b.c)) bases.push([(b.c + 1.5)*T_TUILE, (b.r + 1.5)*T_TUILE]); }
    } else if(!C && lire('USINE_DESSAL')) bases = [[420, 1020], [2780, 1020]];   // ancienne carte unique
    const ambForcee = R3D.ambianceForcee;
    M = {
      id: C && C.id || 'carte',
      ambiance: AMBIANCES[ambForcee] ? ambForcee : (C && AMBIANCES[C.ambiance] ? C.ambiance : 'midi'),
      graine: (C && C.graine) || 9017,
      mer: !!coteP,
      coteP: coteP || {base:1e9, ondes:[]},
      grille: lire('grille') || null,
      roches: tableau(lire('roches')).filter(r => r && isFinite(r.x)),
      // Rayon borné : la plantation parcourt une grille de pas 19 sur tout le disque.
      bosquets: tableau(lire('bosquets') || (C && C.bosquets)).filter(b => b && isFinite(b.x) && isFinite(b.y))
        .map(b => Object.assign({}, b, {r: isFinite(b.r) && b.r > 0 ? Math.min(b.r, 900) : 100})),
      rivieres: tableau(lire('RIVIERES') || (C && C.rivieres)),
      ponts: tableau(lire('PONTS') || (C && C.ponts)),
      structures: tableau(structures).filter(s => s && isFinite(s.x)),
      routes: tableau(routes).filter(r => Array.isArray(r) && r.length >= 2),
      noeuds: nds,
      bases,
    };
    preparer();
  }

  // Prolonge une ligne brisée hors de la carte lorsqu'une extrémité touche un bord.
  function prolonger(pts, L){
    const bord = p => p[0] <= 60 || p[0] >= LX - 60 || p[1] <= 60 || p[1] >= LY - 60;
    const r = pts.map(p => [p[0], p[1]]);
    const ext = (a, b, s) => {
      const dx = a[0] - b[0], dy = a[1] - b[1], l = Math.hypot(dx, dy) || 1, ux = dx/l, uy = dy/l;
      // Deux points, avec un léger méandre pour éviter une ligne parfaitement droite.
      return [[a[0] + ux*L*0.5 - uy*s*60, a[1] + uy*L*0.5 + ux*s*60], [a[0] + ux*L - uy*s*20, a[1] + uy*L + ux*s*20]];
    };
    if(r.length >= 2 && bord(r[0])){ const [p1, p2] = ext(r[0], r[1], 1); r.unshift(p2, p1); }
    if(r.length >= 2 && bord(r[r.length - 1])){ const [p1, p2] = ext(r[r.length - 1], r[r.length - 2], -1); r.push(p1, p2); }
    return r;
  }
  function boiteLigne(pts, m){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for(const [x, y] of pts){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0 - m, y0 - m, x1 + m, y1 + m];
  }
  // Lissage de Chaikin (coins arrondis) : le cours d'eau ne ressemble plus à un canal.
  // Écart au tracé du moteur faible (quelques dizaines de pixels au plus, aux coudes vifs).
  function chaikin(pts, n){
    let p = pts;
    for(let k = 0; k < n; k++){
      const r = [p[0]];
      for(let i = 0; i < p.length - 1; i++){
        const [x0, y0] = p[i], [x1, y1] = p[i+1];
        r.push([x0*0.75 + x1*0.25, y0*0.75 + y1*0.25], [x0*0.25 + x1*0.75, y0*0.25 + y1*0.75]);
      }
      r.push(p[p.length - 1]);
      p = r;
    }
    return p;
  }
  function preparer(){
    RIVS = M.rivieres.filter(r => r && Array.isArray(r.points) && r.points.length >= 2).map(r => {
      const pts = chaikin(prolonger(r.points, 1700), 3), demi = (r.largeur || 70)/2;
      return {pts, demi, boite: boiteLigne(pts, demi + 700)};
    });
    PONTS_R = M.ponts.filter(p => p && isFinite(p.x)).map(p => ({
      x:p.x, y:p.y, a:p.angle || 0, ca:Math.cos(p.angle || 0), sa:Math.sin(p.angle || 0),
      L:p.longueur || 140, W:p.largeur || 50,
    }));
    // Dimensions bornées : une structure aberrante (taille nulle, négative, infinie) ne doit pas
    // emballer les boucles de construction qui dépendent de sa surface.
    const dimension = v => isFinite(v) && v > 0 ? clamp(v, 12, 1600) : 100;
    STRS = M.structures.filter(s => isFinite(s.y)).map(s => ({type:s.type, x:s.x, y:s.y, l:dimension(s.l), h:dimension(s.h), nom:s.nom}));
    RTES = M.routes.map(rt => prolonger(rt, 1400));
    VALLEES = RTES.map(rt => ({pts:rt, boite:boiteLigne(rt, 400)}));
    BASES = M.bases.slice();
  }
  // Écart au bord de l'eau de la rivière la plus proche (négatif dans l'eau).
  function ecartRiviere(x, y){
    let e = Infinity;
    for(const R of RIVS){
      const b = R.boite;
      if(x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      e = Math.min(e, distLigne(R.pts, x, y) - R.demi);
    }
    return e;
  }
  function distRoutes(x, y, liste){
    let d = Infinity;
    for(const V of liste){
      const b = V.boite;
      if(x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      d = Math.min(d, distLigne(V.pts, x, y));
    }
    return d;
  }
  function procheRoute(rt, x, y, m){ return distLigne(rt, x, y) < 18 + m; }
  const surRoute = (x, y, m) => RTES.some(rt => procheRoute(rt, x, y, m));
  function dansStructure(x, y, m){
    for(const s of STRS) if(x > s.x - m && x < s.x + s.l + m && y > s.y - m && y < s.y + s.h + m) return s;
    return null;
  }
  // Position sur un pont : renvoie le pont et les coordonnées locales (u le long, v en travers).
  function surPont(x, y, m){
    for(const P of PONTS_R){
      const dx = x - P.x, dy = y - P.y, u = dx*P.ca + dy*P.sa, v = -dx*P.sa + dy*P.ca;
      if(Math.abs(u) <= P.L/2 + (m || 0) && Math.abs(v) <= P.W/2 + (m || 0)) return {P, u, v};
    }
    return null;
  }
  // Distance hors de la carte jouable (0 dedans).
  function horsCarte(x, y){ return Math.max(-x, x - LX, -y, y - LY, 0); }

  // =================================================================
  //  3. AMBIANCES
  // =================================================================
  // fog : [proche, loin] en multiples de la distance caméra en jeu, puis [proche, loin] absolus au menu.
  // Lumière (réglages « légers » du 13 novembre 2026) : soleil plus franc, ciel (hémisphère) et
  // appoint réduits, pour des ombres plus marquées. Valeurs d'avant, pour mémoire (soleil / ciel /
  // appoint) : midi 2,35 / 0,55 / 0,32 ; aube 2,7 / 0,66 / 0,30 ; crépuscule 3,2 / 0,52 / 0,40 ;
  // brume 1,3 / 0,95 / 0,30. L'écart est plus faible au crépuscule (soleil rasant, ombres déjà
  // longues) et dans la brume (lumière diffuse), pour ne pas boucher les ombres.
  const AMBIANCES = {
    midi:{
      soleil:[-0.80, 0.62, 0.30], coulSoleil:'#ffdcae', intSoleil:2.77,
      hemi:['#c4d8ea', '#7a6044', 0.36], appoint:['#9fb8d8', 0.16, [0.7, 0.5, -0.6]],
      brume:'#d6ccb6', fog:[0.95, 4.6, 1100, 6800], expo:0.74,
      zenith:'#5d8fc4', horizon:'#d6ccb6', halo:'#ffd9a0', disque:1,
      mer:{ciel:'#9cb9cc', lagon:'#3fb3b0', peu:'#1f8aa0', profond:'#0b3c62'},
      riv:{clair:'#6f8f7c', sombre:'#2e5656', ciel:'#a9c0c8'},
      brumeBasse:0, coulBrumeBasse:'#e6dcc8', lumieres:0, fixes:0.85, biais:-0.0004, normalBiais:0.6,
    },
    aube:{
      soleil:[0.86, 0.27, 0.24], coulSoleil:'#ffa286', intSoleil:3.1,
      hemi:['#b6c0e2', '#7a5656', 0.46], appoint:['#a59ed4', 0.17, [-0.7, 0.4, -0.5]],
      brume:'#e0bfb8', fog:[0.8, 4.0, 900, 6000], expo:0.82,
      zenith:'#6f88bb', horizon:'#efc4b4', halo:'#ffbe9c', disque:1,
      mer:{ciel:'#d8bcbc', lagon:'#4aa3a4', peu:'#2a7d92', profond:'#163f63'},
      riv:{clair:'#7a8c88', sombre:'#34505a', ciel:'#dcc0c0'},
      brumeBasse:0.55, coulBrumeBasse:'#f2ddd6', lumieres:0.35, fixes:1, biais:-0.0006, normalBiais:1.0,
    },
    crepuscule:{
      soleil:[-0.93, 0.19, 0.31], coulSoleil:'#ff9044', intSoleil:3.55,
      hemi:['#7b8ab8', '#5a3c2c', 0.40], appoint:['#6c7cc4', 0.26, [0.7, 0.45, -0.55]],
      brume:'#cf9468', fog:[0.9, 4.2, 1000, 6200], expo:0.84,
      zenith:'#33487c', horizon:'#ee985a', halo:'#ffac56', disque:1.2,
      mer:{ciel:'#e2a072', lagon:'#3a8a8c', peu:'#1f5876', profond:'#0b2846'},
      riv:{clair:'#7c7a64', sombre:'#2a3c48', ciel:'#e0a070'},
      brumeBasse:0.16, coulBrumeBasse:'#dca07c', lumieres:1, fixes:1, biais:-0.0008, normalBiais:1.3,
    },
    brume:{
      soleil:[-0.55, 0.72, 0.42], coulSoleil:'#efe9df', intSoleil:1.4,
      hemi:['#dde3e6', '#857b6c', 0.80], appoint:['#c8d4dc', 0.22, [0.7, 0.5, -0.6]],
      brume:'#c7cbc9', fog:[0.35, 2.3, 400, 3200], expo:0.8,
      zenith:'#adb7bc', horizon:'#cdd1ce', halo:'#f2efe4', disque:0.2,
      mer:{ciel:'#c4cccc', lagon:'#5e9c98', peu:'#3e7c86', profond:'#2c4c5c'},
      riv:{clair:'#728c88', sombre:'#3e5a5e', ciel:'#c8d0d0'},
      brumeBasse:0.75, coulBrumeBasse:'#e2e6e5', lumieres:0.6, fixes:1, biais:-0.0004, normalBiais:0.6,
    },
  };
  // Réglages du rendu par ambiance :
  //   chaud / froid : teinte de la brume de distance et de l'horizon, vers le soleil et à l'opposé
  //   brumeH        : hauteur caractéristique de la brume (elle s'éclaircit en altitude)
  //   hemiK, appointK : part gardée à la lumière d'hémisphère et à l'appoint quand la carte
  //                   d'environnement (ciel filtré) éclaire déjà la scène
  //   envGain       : luminosité de la carte d'environnement
  //   etal          : étalonnage de l'image (appliqué par R3D.Post s'il est présent) ; noirs = relevé
  //                   des noirs, sable = part de couleur retirée aux jaunes du sable
  //   brumeLoin     : densité du voile du lointain (progressif, teinté par le ciel)
  //   nuages        : force des ombres de nuages (part du soleil masquée sous un nuage ; 0 = aucune)
  const RENDU = {
    midi:{
      chaud:[1.07, 1.01, 0.90], froid:[0.93, 0.98, 1.06], brumeH:520, hemiK:0.5, appointK:0.7, envGain:1.0, brumeLoin:0.40, nuages:0.34,
      etal:{contraste:0.20, saturation:1.04, ombres:[0.92, 0.985, 1.09], lumieres:[1.04, 1.012, 0.955], vignette:0.24, bloom:0.6, noirs:0.022, sable:0.18},
    },
    aube:{
      chaud:[1.10, 1.00, 0.90], froid:[0.90, 0.96, 1.08], brumeH:420, hemiK:0.5, appointK:0.7, envGain:1.0, brumeLoin:0.45, nuages:0.26,
      etal:{contraste:0.19, saturation:1.04, ombres:[0.92, 0.97, 1.10], lumieres:[1.05, 1.0, 0.955], vignette:0.26, bloom:0.7, noirs:0.022, sable:0.20},
    },
    crepuscule:{
      chaud:[1.14, 1.00, 0.84], froid:[0.84, 0.92, 1.10], brumeH:460, hemiK:0.5, appointK:0.7, envGain:1.0, brumeLoin:0.45, nuages:0.24,
      etal:{contraste:0.21, saturation:1.06, ombres:[0.90, 0.96, 1.12], lumieres:[1.06, 1.0, 0.93], vignette:0.30, bloom:0.8, noirs:0.026, sable:0.16},
    },
    brume:{
      chaud:[1.03, 1.01, 0.98], froid:[0.98, 1.00, 1.02], brumeH:900, hemiK:0.55, appointK:0.8, envGain:1.0, brumeLoin:0.15, nuages:0.10,
      etal:{contraste:0.15, saturation:0.96, ombres:[0.96, 1.0, 1.05], lumieres:[1.02, 1.01, 0.99], vignette:0.22, bloom:0.75, noirs:0.016, sable:0.14},
    },
  };
  for(const k of Object.keys(RENDU)) Object.assign(AMBIANCES[k], RENDU[k]);
  // Ciel d'invasion (R3D.assombrir(1)) : couleurs visées, à l'écran.
  const NUIT = {
    horizon:[0.085, 0.11, 0.115], zenith:[0.016, 0.022, 0.032],
    soleil:'#8fa6c0', hemiCiel:'#3c4c5c', hemiSol:'#1c2024', appoint:'#58b8a8', brumeBasse:'#2a3436',
    etal:{contraste:0.34, saturation:0.9, ombres:[0.86, 0.98, 1.10], lumieres:[0.98, 1.03, 1.0], vignette:0.42, bloom:0.95, noirs:0.012, sable:0.10},
  };
  // Part de la lumière du ciel et de l'appoint gardée sous le ciel d'invasion, par ambiance
  // [ciel, appoint]. Calculée pour retrouver les niveaux d'avant le 13 novembre 2026
  // (ciel × 0,65 et appoint × 1,25 des anciennes valeurs de jour).
  const NUIT_LUMIERE = {midi:[0.99, 2.5], aube:[0.93, 2.2], crepuscule:[0.845, 1.92], brume:[0.77, 1.7]};
  let A = AMBIANCES.midi;

  // Couleur du ciel dans une direction, partagée par le ciel, les reflets de l'eau et la carte
  // d'environnement. Uniformes : ceux de U_CIEL (créés dans R3D.init).
  const GLSL_CIEL = `
    uniform vec3 uSoleil, uZenith, uHorizon, uHalo, uTeinteChaude, uTeinteFroide;
    uniform vec2 uAzSoleil;
    uniform float uDisque, uSombre;
    vec3 horizonCiel(vec3 d){
      float sa = dot(d.xz/max(length(d.xz), 1e-3), uAzSoleil)*0.5 + 0.5;
      return uHorizon*mix(uTeinteFroide, uTeinteChaude, sa*sa);
    }
    vec3 nuitCiel(float h){
      return mix(vec3(${NUIT.horizon.join(', ')}), vec3(${NUIT.zenith.join(', ')}), smoothstep(-0.05, 0.55, h));
    }
    vec3 couleurCiel(vec3 d){
      float h = d.y;
      vec3 hor = horizonCiel(d);
      vec3 col = mix(hor, uZenith, pow(smoothstep(-0.02, 0.75, h), 0.6));
      col = mix(col, hor*0.92, smoothstep(0.0, -0.25, h));
      float s = max(dot(d, uSoleil), 0.0);
      col += uHalo*(pow(s, 6.0)*0.28 + pow(s, 60.0)*0.35)*uDisque*(1.0 - uSombre);
      return mix(col, nuitCiel(h), uSombre*0.96);
    }`;

  // Brume atmosphérique de distance. Elle remplace, pour TOUS les matériaux qui emploient le
  // brouillard de three (scène, unités, bâtiments, effets), le brouillard uniforme par une brume :
  //   - mesurée à la vraie distance de la caméra (et non à la profondeur de l'image) ;
  //   - teintée comme l'horizon du ciel : plus chaude dans l'azimut du soleil, plus froide à l'opposé ;
  //   - plus dense au ras du sol : les reliefs lointains et ce qui vole en émergent ;
  //   - doublée d'un voile du lointain (brumeLoin) qui s'installe progressivement dès les distances
  //     moyennes et tire vers la couleur du ciel : presque nul au point visé en jeu, net au menu
  //     et dans les cinématiques.
  // Les bornes (fogNear, fogFar) et la couleur de base (fogColor) restent celles de scene.fog,
  // réglées à chaque image par majCamera : la visibilité en jeu ne change pas.
  // Les constantes de l'ambiance sont inscrites dans le texte des shaders : à appeler avant le
  // premier rendu (les programmes ne sont compilés qu'ensuite).
  function installerBrume(){
    const C = THREE.ShaderChunk, v = a => 'vec3(' + a.map(x => (+x).toFixed(4)).join(', ') + ')';
    const az = new THREE.Vector2(dirSoleil.x, dirSoleil.z);
    if(az.lengthSq() < 1e-6) az.set(1, 0);
    az.normalize();
    // Teinte du voile aux distances moyennes : celle du ciel un peu au-dessus de l'horizon,
    // rapportée à la couleur de l'horizon (tout au fond, la brume rejoint exactement l'horizon).
    const ch = new THREE.Color(A.horizon), cz = new THREE.Color(A.zenith);
    const cielK = ['r', 'g', 'b'].map(k => clamp((ch[k] + (cz[k] - ch[k])*0.32)/Math.max(ch[k], 0.05), 0.6, 1.25));
    C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float fogDepth;\n\tvarying vec3 vFogDir;\n#endif';
    C.fog_vertex = '#ifdef USE_FOG\n\tfogDepth = - mvPosition.z;\n\tvFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;\n#endif';
    C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float fogDepth;
	varying vec3 vFogDir;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
    C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );
		vec3 fogTeinte = fogColor;
	#else
		float fogDist = length( vFogDir );
		float fogFactor = smoothstep( fogNear, fogFar, fogDist );
		float fogCiel = 1.0 - fogFactor;
		float fogLoin = ${(+A.brumeLoin).toFixed(3)} * ( 1.0 - exp( - max( fogDist - 0.85 * fogNear, 0.0 ) / ( 0.45 * ( fogFar - fogNear ) ) ) );
		fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - fogLoin );
		fogFactor *= mix( 1.0, exp( - max( cameraPosition.y + vFogDir.y - 12.0, 0.0 ) / ${(+A.brumeH).toFixed(1)} ), 0.85 );
		float fogAz = dot( vFogDir.xz / max( length( vFogDir.xz ), 1e-3 ), vec2( ${az.x.toFixed(4)}, ${az.y.toFixed(4)} ) ) * 0.5 + 0.5;
		vec3 fogTeinte = fogColor * mix( ${v(A.froid)}, ${v(A.chaud)}, fogAz * fogAz ) * mix( vec3( 1.0 ), ${v(cielK)}, fogCiel );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTeinte, fogFactor );
#endif`;
  }

  // Ombres de nuages. De grandes taches d'ombre glissent lentement sur le sol et sur tout ce qui
  // est éclairé par le soleil : la lumière du soleil (première lumière directionnelle) est
  // multipliée par un bruit à deux échelles, calculé à partir de la position du pixel dans le
  // monde. Aucune texture, aucune passe : huit tirages de bruit par pixel éclairé.
  // Comme la brume, le code est inscrit dans les shaders communs de three : il vaut pour le sol,
  // les unités, les bâtiments et les effets, sans toucher à leurs matériaux (la mer et les
  // rivières, qui ont leurs propres shaders, ne sont pas concernées).
  // Le décalage (vent) et la force passent par le premier coefficient d'une sonde de lumière
  // (THREE.LightProbe), que three transmet déjà à tous les matériaux éclairés ; le jeu n'emploie
  // pas de sonde pour éclairer, son calcul est donc retiré des shaders. Force nulle (qualité
  // Basse, ou scène sans sonde) : le calcul est sauté, il ne reste qu'un test.
  const NUAGES = {taille:620, vent:[0.021, 0.008]};          // taille d'un nuage (unités du monde), dérive (cases de bruit par seconde)
  let sondeNuages = null, tNuages = 0;
  const CHUNKS_ORIGINE = {};
  function installerNuages(){
    const C = THREE.ShaderChunk;
    if(!CHUNKS_ORIGINE.pars){ CHUNKS_ORIGINE.pars = C.lights_pars_begin; CHUNKS_ORIGINE.frag = C.lights_fragment_begin; }
    const appel = 'getDirectionalDirectLightIrradiance( directionalLight, geometry, directLight );';
    const sonde = 'irradiance += getLightProbeIrradiance( lightProbe, geometry );';
    if(CHUNKS_ORIGINE.frag.indexOf(appel) < 0 || CHUNKS_ORIGINE.frag.indexOf(sonde) < 0 || CHUNKS_ORIGINE.pars.indexOf('lightProbe') < 0){
      if(typeof console !== 'undefined') console.warn('[R3D] ombres de nuages non installées : shaders de three inattendus');
      return false;
    }
    // Point du sol qui reçoit le même rayon de soleil : les objets hauts restent cohérents avec le sol.
    const px = dirSoleil.x/Math.max(dirSoleil.y, 0.1), pz = dirSoleil.z/Math.max(dirSoleil.y, 0.1);
    C.lights_pars_begin = CHUNKS_ORIGINE.pars + `
#ifndef FDS_NUAGES
#define FDS_NUAGES
float fdsHasard( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float fdsBruit( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( fdsHasard( i ), fdsHasard( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( fdsHasard( i + vec2( 0.0, 1.0 ) ), fdsHasard( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float fdsOmbreNuages( vec3 posVue ) {
	vec3 n = lightProbe[ 0 ];
	if ( n.z <= 0.0 ) return 1.0;
	vec3 pm = cameraPosition + ( vec4( posVue, 0.0 ) * viewMatrix ).xyz;
	vec2 p = ( pm.xz - pm.y * vec2( ${px.toFixed(4)}, ${pz.toFixed(4)} ) ) * ${(1/NUAGES.taille).toFixed(6)} + n.xy;
	float b = fdsBruit( p ) * 0.68 + fdsBruit( p * 2.3 + 7.1 ) * 0.32;
	return 1.0 - n.z * smoothstep( 0.47, 0.71, b );
}
#endif`;
    C.lights_fragment_begin = CHUNKS_ORIGINE.frag
      .replace(sonde, '/* sonde de lumiere : sert aux ombres de nuages (r3d-scene.js) */')
      .replace(appel, appel + '\n\t\t#if UNROLLED_LOOP_INDEX == 0\n\t\tdirectLight.color *= fdsOmbreNuages( geometry.position );\n\t\t#endif');
    return true;
  }
  // À chaque image : dérive des nuages et force. Rien en qualité Basse ; les ombres de nuages
  // s'effacent quand le ciel d'invasion se ferme (il n'y a plus de soleil franc à masquer).
  function majNuages(tt){
    if(!sondeNuages) return;
    if(!tNuages) tNuages = tt;
    const t = tt - tNuages, e = sombre*sombre*(3 - 2*sombre);
    const force = R3D.qualite === 'basse' ? 0 : (A.nuages || 0)*(1 - e);
    sondeNuages.sh.coefficients[0].set(t*NUAGES.vent[0], t*NUAGES.vent[1], force);
  }

  // =================================================================
  //  4. RELIEF
  // =================================================================
  // Hauteur analytique (avant échantillonnage sur la grille).
  function hauteurBrute(x, y){
    // Micro-relief de la zone jouable : ±1,6 au plus, très doux.
    let h = (fbm2(x/520 + 3.1, y/520 + 7.7, 3) - 0.5) * 3.4;
    let att = 1;
    for(const [bx, by] of BASES) att = Math.min(att, 0.25 + 0.75*lisse(140, 360, Math.hypot(x - bx, y - by)));
    for(const s of STRS){
      const usine = s.type === 'usine_dessal';
      att = Math.min(att, lisse(10, 140, distRect(x, y, s.x - 10, s.y - (usine ? 50 : 10), s.x + s.l + 10, usine ? s.y + 645 : s.y + s.h + 10)));
    }
    const er = ecartRiviere(x, y);
    if(er < 160) att = Math.min(att, lisse(-10, 160, er));        // berges lisses
    h *= att;
    // Hors carte : collines, vallées des routes et des rivières, plaine côtière.
    const o = horsCarte(x, y);
    if(o > 0){
      let amp = lisse(60, 820, o) * (M.mer ? 1 : 1.35);
      const vRiv = 0.15 + 0.85*lisse(30, 420, er);
      amp *= (0.1 + 0.9*lisse(70, 340, distRoutes(x, y, VALLEES))) * vRiv;
      amp *= lisse(80, 560, coteF(x) - y);
      const c = fbm2(x/400 + 11, y/400 - 5, 4);
      const crete = 1 - Math.abs(fbm2(x/240 - 40, y/240 + 13, 3)*2 - 1);
      h += amp * (20 + 230*c*c + 80*crete*crete*crete);
      // Bordure lointaine relevée : ferme l'horizon du menu.
      const bord = lisse(1100, 1750, -y) * 180 + lisse(1300, 1900, Math.max(-x, x - LX)) * 160 + (M.mer ? 0 : lisse(1100, 1750, y - LY) * 180);
      h += bord * (0.2 + 0.8*lisse(30, 600, er));
    }
    // Plage puis fond marin.
    const dm = y - coteF(x);
    // Pente LINÉAIRE et douce autour du rivage : le maillage la reproduit fidèlement,
    // donc la ligne d'eau (sol = NIV_MER, vers dm ≈ -5) suit cote(x) sans crénelage.
    if(dm > -200){
      const plage = dm < 40 ? -1.4 - (dm + 5)*0.02 : -2.3 - (dm - 40)*0.09;
      if(dm < -80){ const t = lisse(-200, -80, dm); h = h*(1 - t) + 0.1*t; }
      else h = Math.max(-48, plage);
    }
    // Lit des rivières : fond plat, berges en pente (plus larges hors carte, où le relief monte).
    if(er < 6 + o*0.2){
      const t = 1 - lisse(-18, 6 + o*0.2, er);
      h = h*(1 - t) + FOND_RIV*t;
    }
    return h;
  }
  function construireHauteurs(){
    hauteurs = new Float32Array((GNX + 1)*(GNZ + 1));
    for(let j = 0; j <= GNZ; j++) for(let i = 0; i <= GNX; i++)
      hauteurs[j*(GNX + 1) + i] = hauteurBrute(GX0 + i*GPAS, GZ0 + j*GPAS);
  }
  // Interpolation EXACTE du maillage (mêmes triangles : diagonale b(i,j+1) – d(i+1,j)).
  function hauteurMaillage(x, y){
    if(!hauteurs) return 0;
    const fi = (x - GX0)/GPAS, fj = (y - GZ0)/GPAS;
    if(fi < 0 || fj < 0 || fi >= GNX || fj >= GNZ) return hauteurBrute(x, y);
    const i = Math.floor(fi), j = Math.floor(fj), fx = fi - i, fz = fj - j, L = GNX + 1;
    const Ha = hauteurs[j*L + i], Hd = hauteurs[j*L + i + 1], Hb = hauteurs[(j+1)*L + i], Hc = hauteurs[(j+1)*L + i + 1];
    if(fx + fz <= 1) return Ha + (Hd - Ha)*fx + (Hb - Ha)*fz;
    return Hc + (Hb - Hc)*(1 - fx) + (Hd - Hc)*(1 - fz);
  }
  // Sol vu par les unités : le maillage, ou la chaussée d'un pont (rampes comprises).
  R3D.hauteurSol = function(x, y){
    const h = hauteurMaillage(x, y);
    if(!PONTS_R.length) return h;
    const p = surPont(x, y, 0);
    if(!p) return h;
    const k = clamp((p.P.L/2 - Math.abs(p.u))/PONT_RAMPE, 0, 1);
    return Math.max(h, h*(1 - k) + PONT_H*k);
  };
  const hSol = (x, y) => R3D.hauteurSol(x, y);
  // Case de la grille du jeu : 0 libre (rien de haut), autre ou hors carte : objets hauts permis.
  function caseValeur(x, y){
    const c = Math.floor(x/T_TUILE), r = Math.floor(y/T_TUILE);
    if(c < 0 || r < 0 || c >= NC || r >= NL || !M.grille) return -1;
    return M.grille[r*NC + c];
  }
  const caseLibre = (x, y) => caseValeur(x, y) === 0;

  // =================================================================
  //  5. TEXTURE DU SOL
  // =================================================================
  // Palette (sRGB 0–255), volontairement assez sombre : le soleil et ACES éclaircissent.
  const P_SABLE = rgb(176,148,104), P_SABLE_CL = rgb(190,165,120), P_TERRE = rgb(141,108,74),
        P_ROUGE = rgb(152,114,82), P_HERBE = rgb(146,134,82), P_OLIVE = rgb(92,96,56),
        P_PLAGE = rgb(208,190,148), P_MOUILLE = rgb(128,108,80), P_FOND = rgb(118,128,104),
        P_ROCHE = rgb(150,138,118), P_GRAVIER = rgb(132,120,100), P_BERGE = rgb(112,112,72),
        P_LIT = rgb(96,92,74);
  // Couleur de base du sol (basse fréquence) : partagée par la texture et les sommets lointains.
  function couleurSol(x, y){
    const n1 = fbm2(x/650, y/650, 3), n2 = fbm2(x/210 + 31, y/210 + 17, 3), n3 = bruit2(x/70 + 71, y/70 + 5);
    let c = mixRgb(P_SABLE, P_SABLE_CL, lisse(0.35, 0.68, n1));
    c = mixRgb(c, P_TERRE, lisse(0.52, 0.76, n2)*0.85);
    c = mixRgb(c, P_GRAVIER, lisse(0.6, 0.8, fbm2(x/380 - 70, y/380 + 33, 3))*0.6);
    c = mixRgb(c, P_ROUGE, lisse(0.6, 0.78, fbm2(x/480 + 200, y/480 + 90, 2))*0.65);
    const o = horsCarte(x, y);
    const herbe = lisse(0.56, 0.74, fbm2(x/300 + 400, y/300 - 80, 3)) * (0.75 + 0.25*lisse(0, 300, o));
    c = mixRgb(c, P_HERBE, herbe*0.7);
    // Hors carte : collines plus végétales, crêtes rocheuses claires.
    const veg = lisse(30, 600, o);
    if(veg > 0){
      c = mixRgb(c, mixRgb(P_OLIVE, P_HERBE, n2*0.6), veg*0.86);
      const h = hauteurs ? hauteurMaillage(x, y) : hauteurBrute(x, y);   // maillage déjà calculé : bien plus rapide
      c = mixRgb(c, P_ROCHE, lisse(120, 260, h)*0.45);
    }
    // Rivières : herbe plus verte sur les berges, lit sombre.
    if(RIVS.length){
      const er = ecartRiviere(x, y);
      if(er < 140){
        c = mixRgb(c, P_BERGE, (1 - lisse(10, 140, er))*0.55);
        c = mixRgb(c, P_LIT, 1 - lisse(-14, 4, er));
      }
    }
    // Bord de mer : sable de plage, sable humide, fond marin.
    const dm = y - coteF(x);
    if(dm > -280){
      c = mixRgb(c, P_PLAGE, lisse(-280, -130, dm)*(1 - lisse(-40, -14, dm))*0.85);
      c = mixRgb(c, P_MOUILLE, lisse(-42, -10, dm));
      c = mixRgb(c, P_FOND, lisse(-2, 70, dm));
    }
    const k = 0.92 + 0.16*n3;
    return [c[0]*k, c[1]*k, c[2]*k];
  }

  // Terre craquelée : cellules de Voronoï calculées par pixel sur un petit canvas, posées en fondu.
  function craquelures(g, px, py, pr, rnd){
    const n = Math.ceil(2*pr*TS), c = document.createElement('canvas'); c.width = c.height = n;
    const cg = c.getContext('2d'), img = cg.createImageData(n, n), D = img.data;
    const pas = 11 + rnd()*7, graine = Math.floor(rnd()*1000);
    for(let j = 0; j < n; j++) for(let i = 0; i < n; i++){
      const wx = (i + 0.5)/TS, wy = (j + 0.5)/TS;                   // coordonnées locales en pixels de jeu
      // Contour irrégulier (bruit) au lieu d'un disque : plus de « tampon » circulaire visible.
      const dc = Math.hypot(wx - pr, wy - pr)/pr * (0.78 + 0.5*bruit2(wx/28 + graine, wy/28)); if(dc > 1) continue;
      // Léger gauchissement du domaine : cellules moins régulières.
      const wgx = wx + (bruit2(wx/19 + 5, wy/19 + graine) - 0.5)*7, wgy = wy + (bruit2(wx/19 - graine, wy/19 + 3) - 0.5)*7;
      const gx = wgx/pas, gy = wgy/pas, ci = Math.floor(gx), cj = Math.floor(gy);
      let d1 = 1e9, d2 = 1e9;
      for(let a = -1; a <= 1; a++) for(let b = -1; b <= 1; b++){
        const ki = ci + a, kj = cj + b;
        const ox = ki + 0.15 + 0.7*hash2(ki + graine, kj), oy = kj + 0.15 + 0.7*hash2(kj - graine, ki + 7);
        const d = (gx - ox)*(gx - ox) + (gy - oy)*(gy - oy);
        if(d < d1){ d2 = d1; d1 = d; } else if(d < d2) d2 = d;
      }
      const e = (Math.sqrt(d2) - Math.sqrt(d1))*pas;              // écart au bord de cellule (pixels de jeu)
      const fondu = 1 - lisse(0.55, 1, dc);
      const o = (j*n + i)*4;
      // Fissures adoucies (la texture n'a que ~0,8 texel par pixel de jeu : un trait dur crénelait).
      if(e < 1.3){ D[o] = 70; D[o+1] = 52; D[o+2] = 36; D[o+3] = (110 - 50*e)*fondu; }
      else if(e < 2.6){ D[o] = 200; D[o+1] = 178; D[o+2] = 138; D[o+3] = 40*fondu; }   // rebord clair des plaques
    }
    cg.putImageData(img, 0, 0);
    g.drawImage(c, px - pr, py - pr, 2*pr, 2*pr);
  }

  function peindreSol(){
    const cv = document.createElement('canvas'); cv.width = TEX_L; cv.height = TEX_H;
    const g = cv.getContext('2d');
    const rnd = generateur(M.graine);
    // --- Fond basse résolution (bruit) agrandi ---
    // (512 texels sur 5000 px suffisent : les détails fins sont peints ensuite.)
    const bl = 512, bh = Math.round(TEX_H/8);
    const cb = document.createElement('canvas'); cb.width = bl; cb.height = bh;
    const gb = cb.getContext('2d'), img = gb.createImageData(bl, bh);
    for(let j = 0; j < bh; j++) for(let i = 0; i < bl; i++){
      const x = TX0 + (i + 0.5)*TW/bl, y = TY0 + (j + 0.5)*TH/bh;
      const c = couleurSol(x, y), o = (j*bl + i)*4;
      img.data[o] = c[0]; img.data[o+1] = c[1]; img.data[o+2] = c[2]; img.data[o+3] = 255;
    }
    gb.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(cb, 0, 0, TEX_L, TEX_H);
    // À partir d'ici on dessine directement en coordonnées de jeu.
    g.setTransform(TS, 0, 0, TS, -TX0*TS, -TY0*TS);
    const X1 = TX0 + TW;
    const auHasard = () => [TX0 + rnd()*TW, TY0 + rnd()*TH];
    const terre = (x, y) => y < coteF(x) - 30 && (!RIVS.length || ecartRiviere(x, y) > 2);

    // --- Moucheture fine (grains clairs et sombres) ---
    for(let k = 0; k < 140000; k++){
      const [x, y] = auHasard(); if(!terre(x, y)) continue;
      const v = rnd();
      g.fillStyle = v < 0.5 ? 'rgba(70,52,34,0.22)' : 'rgba(232,214,176,0.22)';
      const t = 0.8 + rnd()*1.6; g.fillRect(x, y, t, t);
    }
    // --- Plaques de terre craquelée ---
    const plaques = [];
    for(let k = 0; k < 220 && plaques.length < 10; k++){
      const x = 120 + rnd()*(LX - 240), y = 80 + rnd()*(LY - 160);
      if(y > coteF(x) - 200 || surRoute(x, y, 90) || dansStructure(x, y, 60) || ecartRiviere(x, y) < 90) continue;
      if(M.roches.some(r => Math.hypot(r.x - x, r.y - y) < r.r + 70)) continue;
      if(M.bosquets.some(b => Math.hypot(b.x - x, b.y - y) < b.r + 60)) continue;
      plaques.push([x, y, 60 + rnd()*110]);
    }
    for(let k = 0; k < 10; k++){ const [x, y] = auHasard(); if(horsCarte(x, y) > 40 && terre(x, y) && ecartRiviere(x, y) > 120) plaques.push([x, y, 80 + rnd()*140]); }
    for(const [px, py, pr] of plaques){
      g.save();
      const gr = g.createRadialGradient(px, py, pr*0.2, px, py, pr);
      gr.addColorStop(0, 'rgba(150,118,84,0.55)'); gr.addColorStop(1, 'rgba(150,118,84,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(px, py, pr, pr*0.75, rnd()*3, 0, Math.PI*2); g.fill();
      g.restore();
      craquelures(g, px, py, pr, rnd);
    }
    // --- Herbe sèche peinte (touffes dans les zones herbeuses, plus dense près de l'eau) ---
    g.lineCap = 'round';
    for(let k = 0; k < 45000; k++){
      const [x, y] = auHasard(); if(!terre(x, y)) continue;
      const m = lisse(0.52, 0.7, fbm2(x/300 + 400, y/300 - 80, 3)) + lisse(100, 600, horsCarte(x, y))*0.6
              + (RIVS.length ? (1 - lisse(10, 120, ecartRiviere(x, y)))*0.8 : 0);
      if(rnd() > m*0.9) continue;
      const v = rnd();
      g.strokeStyle = v < 0.4 ? 'rgba(96,88,48,0.55)' : (v < 0.8 ? 'rgba(170,150,90,0.5)' : 'rgba(205,186,120,0.45)');
      g.lineWidth = 0.7;
      g.beginPath();
      for(let b = 0; b < 4; b++){ const a = -Math.PI/2 + (rnd() - 0.5)*2.2, l = 2 + rnd()*3.5; g.moveTo(x, y); g.lineTo(x + Math.cos(a)*l, y + Math.sin(a)*l*0.7); }
      g.stroke();
    }
    // --- Éboulis autour des rochers ---
    for(const r of M.roches){
      const gr = g.createRadialGradient(r.x, r.y, r.r*0.5, r.x, r.y, r.r*1.55);
      gr.addColorStop(0, 'rgba(110,98,84,0.6)'); gr.addColorStop(1, 'rgba(110,98,84,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(r.x, r.y, r.r*1.55, 0, Math.PI*2); g.fill();
      for(let k = 0; k < r.r*5; k++){
        const a = rnd()*Math.PI*2, d = r.r*(0.7 + rnd()*0.9), x = r.x + Math.cos(a)*d, y = r.y + Math.sin(a)*d, t = 0.8 + rnd()*2.2;
        g.fillStyle = 'rgba(60,52,44,0.35)'; g.fillRect(x + 0.6, y + 0.4, t, t*0.8);
        g.fillStyle = rnd() < 0.5 ? 'rgba(178,168,150,0.8)' : 'rgba(140,128,110,0.8)'; g.fillRect(x, y, t, t*0.8);
      }
    }
    // --- Litière d'aiguilles et d'ombre sous les bosquets ---
    for(const b of M.bosquets){
      const gr = g.createRadialGradient(b.x, b.y, b.r*0.3, b.x, b.y, b.r*1.2);
      gr.addColorStop(0, 'rgba(78,66,40,0.62)'); gr.addColorStop(0.75, 'rgba(92,80,50,0.4)'); gr.addColorStop(1, 'rgba(92,80,50,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, b.r*1.2, 0, Math.PI*2); g.fill();
      for(let k = 0; k < b.r*b.r*0.06; k++){
        const a = rnd()*Math.PI*2, d = Math.sqrt(rnd())*b.r*1.1, x = b.x + Math.cos(a)*d, y = b.y + Math.sin(a)*d;
        g.fillStyle = rnd() < 0.5 ? 'rgba(140,108,62,0.5)' : 'rgba(58,50,30,0.45)';
        g.fillRect(x, y, 1 + rnd()*2.5, 0.6 + rnd());
      }
    }
    // --- Cailloux épars ---
    for(let k = 0; k < 42000; k++){
      const [x, y] = auHasard(); if(!terre(x, y)) continue;
      const t = 0.7 + rnd()*rnd()*3;
      g.fillStyle = 'rgba(52,40,28,0.35)'; g.beginPath(); g.ellipse(x + t*0.35, y + t*0.2, t, t*0.7, 0, 0, Math.PI*2); g.fill();
      const v = 150 + rnd()*70;
      g.fillStyle = `rgba(${v|0},${(v*0.93)|0},${(v*0.82)|0},0.85)`; g.beginPath(); g.ellipse(x, y, t, t*0.7, 0, 0, Math.PI*2); g.fill();
    }
    // --- Sol compacté autour des bases ---
    for(const [bx, by] of BASES){
      const gr = g.createRadialGradient(bx, by, 60, bx, by, 330);
      gr.addColorStop(0, 'rgba(196,176,138,0.42)'); gr.addColorStop(0.7, 'rgba(180,160,124,0.2)'); gr.addColorStop(1, 'rgba(180,160,124,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(bx, by, 330, 0, Math.PI*2); g.fill();
    }
    // --- Traces de pneus et de chenilles (depuis les bases, ou depuis les citernes sans base) ---
    const departs = BASES.length ? BASES : (M.noeuds.length ? M.noeuds.map(n => [n.x, n.y]) : [[LX*0.25, LY*0.5], [LX*0.75, LY*0.5]]);
    const traces = [];
    for(let k = 0; k < 34; k++){
      const base = departs[Math.floor(rnd()*departs.length)];
      const vers = rnd() < 0.6 ? [LX*0.25 + rnd()*LX*0.5, LY*0.22 + rnd()*LY*0.5] : auHasard();
      const dep = rnd() < 0.55 ? [base[0] + (rnd() - 0.5)*300, base[1] + (rnd() - 0.5)*300] : auHasard();
      traces.push([dep, vers]);
    }
    for(const [[x0, y0], [x3, y3]] of traces){
      const x1 = x0 + (x3 - x0)*0.33 + (rnd() - 0.5)*300, y1 = y0 + (y3 - y0)*0.33 + (rnd() - 0.5)*300, x2 = x0 + (x3 - x0)*0.66 + (rnd() - 0.5)*300, y2 = y0 + (y3 - y0)*0.66 + (rnd() - 0.5)*300;
      const pts = [];
      for(let t = 0; t <= 1.0001; t += 0.02){
        const u = 1 - t;
        pts.push([u*u*u*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3, u*u*u*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3]);
      }
      const chenille = rnd() < 0.4, e = chenille ? 6 : 4.5;
      g.strokeStyle = chenille ? 'rgba(78,60,42,0.12)' : 'rgba(84,66,46,0.09)';
      g.lineWidth = chenille ? 3.4 : 2.2;
      g.setLineDash(chenille ? [1.6, 1.2] : []);
      for(const d of [-e, e]){ polyligne(g, decaler(pts, d)); g.stroke(); }
    }
    g.setLineDash([]);
    // --- Taches d'humidité autour des citernes ---
    for(const n of M.noeuds){
      const gr = g.createRadialGradient(n.x, n.y, 10, n.x, n.y, 58);
      gr.addColorStop(0, 'rgba(84,70,50,0.45)'); gr.addColorStop(1, 'rgba(84,70,50,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(n.x, n.y, 58, 0, Math.PI*2); g.fill();
    }
    // --- Emprises des structures (dalles, ruelles, champs, gravats) ---
    for(const s of STRS) peindreStructure(g, s, rnd);
    // --- Routes : bas-côtés, asphalte usé, marquages ---
    const routes = RTES;
    g.lineJoin = 'round'; g.lineCap = 'round';
    for(const rt of routes){
      g.strokeStyle = 'rgba(160,142,112,0.85)'; g.lineWidth = 62; polyligne(g, rt); g.stroke();
      g.strokeStyle = 'rgba(132,116,92,0.6)'; g.lineWidth = 48; polyligne(g, rt); g.stroke();
    }
    for(const rt of routes){ g.strokeStyle = '#4c4a46'; g.lineWidth = 36; polyligne(g, rt); g.stroke(); }
    // Usure longitudinale : bandes de roulement plus sombres, axe central plus clair (poussière).
    for(const rt of routes){
      g.strokeStyle = 'rgba(28,27,26,0.16)'; g.lineWidth = 5;
      for(const d of [-11, -4, 4, 11]){ polyligne(g, decaler(rt, d)); g.stroke(); }
      g.strokeStyle = 'rgba(150,138,118,0.08)'; g.lineWidth = 3; polyligne(g, rt); g.stroke();
    }
    for(const rt of routes){
      const pts = echantillonner(rt, 6);
      for(const [x, y, a] of pts){
        // Rapiéçages (rares, irréguliers, aux bords adoucis).
        if(rnd() < 0.045){
          const l = 14 + rnd()*40, p = 6 + rnd()*12, o = (rnd() - 0.5)*14;
          g.save(); g.translate(x - Math.sin(a)*o, y + Math.cos(a)*o); g.rotate(a + (rnd() - 0.5)*0.15);
          g.fillStyle = rnd() < 0.6 ? 'rgba(36,35,33,0.22)' : 'rgba(112,106,98,0.16)';
          g.beginPath();
          for(let s = 0; s < 8; s++){ const t = s/8*Math.PI*2, rr = 0.8 + rnd()*0.35; g.lineTo(Math.cos(t)*l/2*rr, Math.sin(t)*p/2*rr); }
          g.fill(); g.restore();
        }
        // Bords érodés : le sable mord l'asphalte
        for(const cote2 of [-1, 1]) if(rnd() < 0.55){
          const o = cote2*(16 + rnd()*3), r = 1.5 + rnd()*4;
          g.fillStyle = rnd() < 0.5 ? 'rgba(150,132,104,0.85)' : 'rgba(120,106,84,0.7)';
          g.beginPath(); g.arc(x - Math.sin(a)*o, y + Math.cos(a)*o, r, 0, Math.PI*2); g.fill();
        }
        if(rnd() < 0.12){
          g.strokeStyle = 'rgba(28,27,25,0.6)'; g.lineWidth = 0.6; g.beginPath();
          let cx = x + (rnd() - 0.5)*24, cy = y + (rnd() - 0.5)*24; g.moveTo(cx, cy);
          for(let s = 0; s < 4; s++){ cx += (rnd() - 0.5)*10; cy += (rnd() - 0.5)*10; g.lineTo(cx, cy); }
          g.stroke();
        }
      }
      // Lignes de rive (usées) et ligne médiane pointillée
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(214,208,190,0.55)'; g.lineWidth = 1.5; g.setLineDash([40, 3, 22, 6, 30, 9]);
      for(const d of [-14.5, 14.5]){ polyligne(g, decaler(rt, d)); g.stroke(); }
      g.strokeStyle = 'rgba(222,196,118,0.7)'; g.lineWidth = 1.6; g.setLineDash([16, 20]);
      polyligne(g, rt); g.stroke();
      g.setLineDash([]); g.lineCap = 'round';
    }
    // Traces de poussière sur l'asphalte
    for(const rt of routes){
      const pts = echantillonner(rt, 3), n = Math.round(pts.length*0.35);
      for(let k = 0; k < n; k++){
        const p = pts[Math.floor(rnd()*pts.length)], o = (rnd() - 0.5)*30;
        g.fillStyle = 'rgba(170,150,116,0.1)'; g.beginPath();
        g.ellipse(p[0] - Math.sin(p[2])*o, p[1] + Math.cos(p[2])*o, 4 + rnd()*12, 1.2 + rnd()*2.5, p[2], 0, Math.PI*2); g.fill();
      }
    }
    // --- Rivières : berges humides, galets, lit (peints après les routes : le lit les recouvre) ---
    for(const R of RIVS){
      g.lineJoin = 'round'; g.lineCap = 'round';
      // Bandes successives peu opaques : bord fondu, sans trait net.
      for(const [w, a] of [[150, 0.06], [110, 0.07], [80, 0.08], [56, 0.1]]){
        g.strokeStyle = `rgba(100,94,58,${a})`; g.lineWidth = 2*R.demi + w; polyligne(g, R.pts); g.stroke();
      }
      g.strokeStyle = 'rgba(92,78,56,0.3)'; g.lineWidth = 2*R.demi + 34; polyligne(g, R.pts); g.stroke();
      g.strokeStyle = 'rgba(92,78,56,0.35)'; g.lineWidth = 2*R.demi + 20; polyligne(g, R.pts); g.stroke();
      g.strokeStyle = 'rgba(150,140,118,0.75)'; g.lineWidth = 2*R.demi + 6; polyligne(g, R.pts); g.stroke();
      g.strokeStyle = 'rgb(88,86,68)'; g.lineWidth = 2*R.demi - 14; polyligne(g, R.pts); g.stroke();
      // Galets et graviers sur les rives
      for(const [x, y, a] of echantillonner(R.pts, 4)){
        for(const sd of [-1, 1]){
          if(rnd() < 0.5) continue;
          const o = sd*(R.demi - 6 + rnd()*14), t = 0.8 + rnd()*2.4;
          const px = x - Math.sin(a)*o, py = y + Math.cos(a)*o;
          g.fillStyle = 'rgba(48,40,30,0.4)'; g.fillRect(px + 0.5, py + 0.4, t, t*0.8);
          g.fillStyle = rnd() < 0.5 ? 'rgba(196,186,164,0.85)' : 'rgba(150,140,122,0.8)'; g.fillRect(px, py, t, t*0.8);
        }
      }
    }
    // --- Laisse de mer et brillance du sable mouillé ---
    if(M.mer){
      for(let couche = 0; couche < 3; couche++){
        g.strokeStyle = couche === 0 ? 'rgba(72,58,40,0.35)' : 'rgba(232,226,206,0.25)';
        g.lineWidth = couche === 0 ? 1.4 : 2.2;
        g.beginPath();
        for(let x = TX0; x <= X1; x += 6){
          const y = coteF(x) - (couche === 0 ? 20 : 8 + couche*5) + (bruit2(x/40, couche*7) - 0.5)*9;
          x === TX0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      }
      for(let k = 0; k < 2500; k++){
        const x = TX0 + rnd()*TW, y = coteF(x) - 30 - rnd()*rnd()*140;
        g.fillStyle = rnd() < 0.5 ? 'rgba(240,232,214,0.6)' : 'rgba(90,72,50,0.4)';
        g.fillRect(x, y, 1.2, 1.2);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  // Emprise peinte au sol de chaque structure.
  function peindreStructure(g, s, rnd){
    const {x, y, l, h} = s;
    const tache = (n, cx0, cy0, cl, ch, coul) => {
      for(let k = 0; k < n; k++){
        const px = cx0 + rnd()*cl, py = cy0 + rnd()*ch, r = 3 + rnd()*12;
        g.fillStyle = coul; g.beginPath(); g.ellipse(px, py, r, r*0.7, rnd()*3, 0, Math.PI*2); g.fill();
      }
    };
    const dalle = (x0, y0, l0, h0, coul, pas) => {
      g.fillStyle = coul; g.fillRect(x0, y0, l0, h0);
      g.strokeStyle = 'rgba(70,66,60,0.3)'; g.lineWidth = 0.8;
      for(let px = x0; px <= x0 + l0; px += pas){ g.beginPath(); g.moveTo(px, y0); g.lineTo(px, y0 + h0); g.stroke(); }
      for(let py = y0; py <= y0 + h0; py += pas){ g.beginPath(); g.moveTo(x0, py); g.lineTo(x0 + l0, py); g.stroke(); }
    };
    switch(s.type){
      case 'usine_dessal': {
        dalle(x - 14, y - 12, l + 28, h + 24, '#a9a59b', 20);
        g.fillStyle = '#9e9a90'; g.fillRect(x + 85, y - 58, 120, 48);
        g.strokeStyle = 'rgba(235,232,220,0.7)'; g.lineWidth = 1.2;
        for(let k = 0; k < 10; k++){ const px = x + 92 + k*11; g.beginPath(); g.moveTo(px, y - 54); g.lineTo(px, y - 38); g.stroke(); }
        if(M.mer) for(const qx of [x + 35, x + 220]){
          g.fillStyle = '#a6a297';
          const c = Math.min(coteF(qx), y + h + 600);
          g.beginPath(); g.moveTo(qx - 20, y + h); g.lineTo(qx + 20, y + h); g.lineTo(qx + 20, c + 10); g.lineTo(qx - 20, c + 10); g.fill();
        }
        tache(60, x, y, l, h, 'rgba(60,58,52,0.12)');
        break;
      }
      case 'village': {
        g.fillStyle = 'rgba(196,178,142,0.7)';
        g.beginPath(); g.ellipse(x + l/2, y + h/2, l*0.62, h*0.62, 0, 0, Math.PI*2); g.fill();
        dalle(x, y, l, h, 'rgba(168,152,124,0.7)', 8);
        tache(40, x, y, l, h, 'rgba(90,80,64,0.1)');
        break;
      }
      case 'port': {
        const c = (px) => Math.min(y + h, coteF(px) + 30);
        g.fillStyle = '#a19d93';
        g.beginPath(); g.moveTo(x - 8, y - 8); g.lineTo(x + l + 8, y - 8);
        for(let px = x + l + 8; px >= x - 8; px -= 10) g.lineTo(px, c(px));
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(214,180,70,0.7)'; g.lineWidth = 1.4;
        for(let py = y + 20; py < y + h; py += 34){ g.beginPath(); g.moveTo(x + 10, py); g.lineTo(x + l - 10, py); g.stroke(); }
        tache(70, x, y, l, h, 'rgba(50,48,44,0.14)');
        break;
      }
      case 'raffinerie': {
        dalle(x - 10, y - 10, l + 20, h + 20, '#9b978d', 24);
        tache(90, x, y, l, h, 'rgba(36,32,28,0.16)');
        break;
      }
      case 'ruines': {
        g.fillStyle = 'rgba(130,124,112,0.55)'; g.fillRect(x - 6, y - 6, l + 12, h + 12);
        tache(140, x - 20, y - 20, l + 40, h + 40, 'rgba(66,62,56,0.25)');
        tache(40, x, y, l, h, 'rgba(26,22,20,0.3)');
        for(let k = 0; k < l*h*0.02; k++){
          const px = x - 20 + rnd()*(l + 40), py = y - 20 + rnd()*(h + 40), t = 0.8 + rnd()*3;
          g.fillStyle = rnd() < 0.5 ? 'rgba(186,178,164,0.8)' : 'rgba(110,104,96,0.8)'; g.fillRect(px, py, t, t*0.7);
        }
        break;
      }
      case 'phare': {
        g.fillStyle = 'rgba(150,142,128,0.6)';
        g.beginPath(); g.ellipse(x + l/2, y + h/2, l*0.6, h*0.6, 0, 0, Math.PI*2); g.fill();
        break;
      }
      case 'ferme': {
        // Champs labourés autour de la ferme (décor au sol, franchissable).
        for(const [fx, fy, fl, fh, a] of [[x - 150, y - 20, 140, h + 40, 0.05], [x + l + 12, y - 30, 150, h*0.8, -0.04], [x - 40, y + h + 14, l + 80, 110, 0.02]]){
          if(fx + fl < 0 || fy + fh < 0 || fx > LX || fy > LY) continue;
          g.save(); g.translate(fx + fl/2, fy + fh/2); g.rotate(a);
          g.fillStyle = 'rgba(132,100,66,0.55)'; g.fillRect(-fl/2, -fh/2, fl, fh);
          g.strokeStyle = 'rgba(86,64,42,0.45)'; g.lineWidth = 1.6;
          for(let px = -fl/2 + 3; px < fl/2; px += 6){ g.beginPath(); g.moveTo(px, -fh/2 + 2); g.lineTo(px, fh/2 - 2); g.stroke(); }
          g.strokeStyle = 'rgba(150,140,80,0.35)'; g.lineWidth = 1;
          for(let px = -fl/2 + 6; px < fl/2; px += 6){ g.beginPath(); g.moveTo(px, -fh/2 + 2); g.lineTo(px, fh/2 - 2); g.stroke(); }
          g.restore();
        }
        g.fillStyle = 'rgba(176,150,112,0.75)'; g.fillRect(x, y, l, h);
        tache(40, x, y, l, h, 'rgba(90,70,48,0.15)');
        break;
      }
      case 'barrage': {
        dalle(x - 8, y - 8, l + 16, h + 16, '#a29e94', 16);
        break;
      }
    }
  }

  // Texture de détail répétée (gris neutre ~0,5) : netteté au zoom proche.
  function textureDetail(){
    const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), img = g.createImageData(N, N), rnd = generateur(77);
    for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
      let a = 0, b = 0;
      a += bruit2P(i/32, j/32, 8)*0.45 + bruit2P(i/16, j/16, 16)*0.3 + bruit2P(i/8, j/8, 32)*0.25;
      b += bruit2P(i/16 + 3, j/16 + 9, 16)*0.4 + bruit2P(i/6, j/6, 256/6 | 0)*0.3 + rnd()*0.3;
      const o = (j*N + i)*4;
      img.data[o] = clamp(a*255, 0, 255); img.data[o+1] = clamp(b*255, 0, 255); img.data[o+2] = 128; img.data[o+3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  // Normales de détail répétées : pentes (rouge = x, vert = z, 128 = à plat) d'un relief de bruit
  // périodique (grains, croûtes, petites bosses). Le sol accroche ainsi la lumière rasante.
  function textureNormalesDetail(){
    const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), img = g.createImageData(N, N), H = new Float32Array(N*N);
    for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
      // Bosses larges, grain moyen, et crêtes fines (valeur absolue : arêtes de croûte de sel).
      const cr = 1 - Math.abs(bruit2P(i/20 + 5, j/20 + 2, 12)*2 - 1);
      H[j*N + i] = bruit2P(i/40, j/40, 6)*0.9 + bruit2P(i/13 + 7, j/13 + 3, 19)*0.5 + cr*cr*0.45 + bruit2P(i/5 + 1, j/5 + 8, 51)*0.22;
    }
    const h = (i, j) => H[((j + N) % N)*N + ((i + N) % N)];
    for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
      const o = (j*N + i)*4;
      img.data[o] = clamp(128 + (h(i + 1, j) - h(i - 1, j))*420, 0, 255);
      img.data[o+1] = clamp(128 + (h(i, j + 1) - h(i, j - 1))*420, 0, 255);
      img.data[o+2] = clamp(h(i, j)*120, 0, 255); img.data[o+3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  // =================================================================
  //  6. CIEL, MER, RIVIÈRES, BRUME BASSE, TERRAIN
  // =================================================================
  // Uniformes du ciel : les mêmes objets servent au ciel, à l'eau (reflets) et à l'environnement.
  function creerUniformesCiel(){
    const az = new THREE.Vector2(dirSoleil.x, dirSoleil.z);
    if(az.lengthSq() < 1e-6) az.set(1, 0);
    az.normalize();
    U_CIEL = {
      uSoleil:{value:dirSoleil}, uZenith:{value:new THREE.Color(A.zenith)}, uHorizon:{value:new THREE.Color(A.horizon)},
      uHalo:{value:new THREE.Color(A.halo)}, uDisque:{value:A.disque}, uSombre:{value:0}, uAzSoleil:{value:az},
      uTeinteChaude:{value:new THREE.Vector3().fromArray(A.chaud)}, uTeinteFroide:{value:new THREE.Vector3().fromArray(A.froid)},
    };
  }
  function creerCiel(){
    matCiel = new THREE.ShaderMaterial({
      uniforms:Object.assign({uTemps:{value:0}}, U_CIEL),
      vertexShader:`
        varying vec3 vDir;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDir = normalize(wp.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_Position.z = gl_Position.w * 0.99999;
        }`,
      fragmentShader:`
        uniform float uTemps;
        varying vec3 vDir;
        ${GLSL_CIEL}
        ${GLSL_BRUIT}
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = couleurCiel(d);
          float s = max(dot(d, uSoleil), 0.0);
          col += vec3(1.0, 0.96, 0.88) * smoothstep(0.9993, 0.9998, s) * min(uDisque, 1.0) * (1.0 - uSombre);
          if(uSombre > 0.002){
            // Ciel d'invasion : plafond de nuages lourds qui dérive, lueur blafarde au ras de l'horizon.
            vec2 q = d.xz/(abs(d.y) + 0.2);
            float n = vb(q*1.3 + uTemps*0.011)*0.55 + vb(q*3.1 - uTemps*0.019)*0.3 + vb(q*7.3 + uTemps*0.03)*0.15;
            vec3 nuit = nuitCiel(d.y) * (0.5 + 1.1*smoothstep(0.32, 0.74, n));
            nuit += vec3(0.04, 0.10, 0.085) * pow(1.0 - clamp(abs(d.y), 0.0, 1.0), 7.0);
            col = mix(col, nuit, uSombre*0.97);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      side:THREE.BackSide, depthWrite:false, fog:false, toneMapped:false,
    });
    ciel = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), matCiel);
    // Dessiné après les objets opaques : le test de profondeur écarte tout ce que le terrain cache
    // (en vue de jeu, le ciel n'occupe aucun pixel et ne coûte donc rien).
    ciel.renderOrder = 1000; ciel.frustumCulled = false;
    scene.add(ciel);
  }

  // Carte d'environnement : le ciel de l'ambiance (soleil compris) et, sous l'horizon, la couleur
  // moyenne du sol éclairé, filtrés par PMREM. Elle donne aux matériaux standard de toute la scène
  // leurs reflets et une lumière diffuse qui varie avec l'orientation (R3D.scene.environment).
  //
  // Deux cartes sont filtrées une fois pour toutes au chargement : celle du jour et celle du ciel
  // d'invasion. R3D.scene.environment est une TROISIÈME carte, toujours la même, dans laquelle
  // une passe très légère écrit le mélange des deux quand le ciel s'assombrit (R3D.assombrir).
  // Deux raisons : refaire le filtrage coûte cher sur une carte graphique intégrée, et changer
  // l'objet scene.environment oblige three à réinitialiser tous les matériaux standard de la
  // scène (une centaine de millisecondes par changement : la transition saccadait).
  function creerEnvironnement(){
    for(const c of [envCible, envJour, envNuit]) if(c) c.dispose();
    if(matMelangeEnv) matMelangeEnv.dispose();
    envCible = envJour = envNuit = null; matMelangeEnv = null; sceneMelange = null;
    scene.environment = null;
    sombreEnv = 0;
    if(!THREE.PMREMGenerator || !renderer) return;
    // Le filtre de three contient une boucle que le traducteur de shaders de Windows signale par
    // un avertissement sans conséquence (X3595) : on suspend le relevé des journaux de compilation
    // le temps du filtrage, pour garder la console propre.
    const releve = renderer.debug.checkShaderErrors;
    try {
      renderer.debug.checkShaderErrors = false;
      pmrem = new THREE.PMREMGenerator(renderer);
      matEnv = new THREE.ShaderMaterial({
        uniforms:Object.assign({uGain:{value:A.envGain}, uSol:{value:new THREE.Vector3(0.30, 0.215, 0.125)}}, U_CIEL),
        vertexShader:`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }`,
        fragmentShader:`
          uniform float uGain;
          uniform vec3 uSol;
          varying vec3 vDir;
          ${GLSL_CIEL}
          void main(){
            vec3 d = normalize(vDir);
            vec3 col = couleurCiel(d);
            float s = max(dot(d, uSoleil), 0.0);
            col += uHalo * pow(s, 220.0) * 0.9 * min(uDisque, 1.0) * (1.0 - uSombre);
            col = pow(col, vec3(2.2));                              // de l'écran vers la lumière linéaire
            vec3 sol = uSol * mix(1.0, 0.16, uSombre);
            col = mix(col, sol, smoothstep(0.04, -0.1, d.y));
            gl_FragColor = vec4(col*uGain, 1.0);
            #include <encodings_fragment>
          }`,
        side:THREE.BackSide, depthWrite:false, fog:false, toneMapped:false,
      });
      const geoEnv = new THREE.SphereGeometry(50, 32, 16);
      sceneEnv = new THREE.Scene();
      sceneEnv.add(new THREE.Mesh(geoEnv, matEnv));
      U_CIEL.uSombre.value = 0;
      envJour = pmrem.fromScene(sceneEnv, 0.03, 1, 200);
      U_CIEL.uSombre.value = 1;
      envNuit = pmrem.fromScene(sceneEnv, 0.03, 1, 200);
      U_CIEL.uSombre.value = 0;
      renderer.debug.checkShaderErrors = releve;
      // Le filtre ne resservira pas : on libère ses programmes et la scène du ciel.
      pmrem.dispose(); pmrem = null;
      matEnv.dispose(); geoEnv.dispose(); matEnv = null; sceneEnv = null;

      // Carte du mélange : mêmes caractéristiques que les cartes filtrées (three la lit de la même façon).
      const t = envJour.texture;
      envCible = new THREE.WebGLRenderTarget(envJour.width, envJour.height, {
        magFilter:t.magFilter, minFilter:t.minFilter, generateMipmaps:false, type:t.type, format:t.format,
        encoding:t.encoding, depthBuffer:false, stencilBuffer:false});
      envCible.texture.mapping = t.mapping;
      envCible.texture.name = 'environnement';
      // Les cartes filtrées par three r128 sont codées en RGBE (mantisse et exposant) : on décode,
      // on mélange en lumière linéaire, on recode. Autre codage : mélange direct.
      matMelangeEnv = new THREE.ShaderMaterial({
        uniforms:{tJour:{value:envJour.texture}, tNuit:{value:envNuit.texture}, uK:{value:0}},
        defines:t.encoding === THREE.RGBEEncoding ? {CODAGE_RGBE:1} : {},
        vertexShader:`varying vec2 vUv; void main(){ vUv = position.xy*0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader:`
          uniform sampler2D tJour, tNuit;
          uniform float uK;
          varying vec2 vUv;
          #ifdef CODAGE_RGBE
            vec3 decoder(vec4 v){ return v.rgb * exp2(v.a*255.0 - 128.0); }
            vec4 coder(vec3 c){
              float e = clamp(ceil(log2(max(max(c.r, max(c.g, c.b)), 1e-9))), -128.0, 127.0);
              return vec4(c/exp2(e), (e + 128.0)/255.0);
            }
          #else
            vec3 decoder(vec4 v){ return v.rgb; }
            vec4 coder(vec3 c){ return vec4(c, 1.0); }
          #endif
          void main(){
            gl_FragColor = coder(mix(decoder(texture2D(tJour, vUv)), decoder(texture2D(tNuit, vUv)), uK));
          }`,
        depthTest:false, depthWrite:false, toneMapped:false, fog:false,
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      const tri = new THREE.Mesh(geo, matMelangeEnv);
      tri.frustumCulled = false;
      sceneMelange = new THREE.Scene();
      sceneMelange.add(tri);
      camMelange = camMelange || new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      melangerEnvironnement(0);
      scene.environment = envCible.texture;
    } catch(e){
      // Mélange impossible : on garde la carte du jour telle quelle. Sans carte du tout : rendu
      // correct, simplement plus mat.
      if(scene) scene.environment = envJour ? envJour.texture : null;
      envCible = null;
    }
    renderer.debug.checkShaderErrors = releve;
  }
  // Écrit dans la carte d'environnement le mélange jour / ciel d'invasion (k de 0 à 1) : une seule
  // passe sur une petite texture, sans effet sur les programmes des matériaux.
  function melangerEnvironnement(k){
    if(!envCible || !matMelangeEnv || !sceneMelange) return;
    matMelangeEnv.uniforms.uK.value = k;
    const cible = renderer.getRenderTarget();
    renderer.setRenderTarget(envCible);
    renderer.render(sceneMelange, camMelange);
    renderer.setRenderTarget(cible);
    sombreEnv = k;
  }

  // Bruit de valeur et pentes partagés par les shaders d'eau.
  const GLSL_BRUIT = `
    float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
    float vb(vec2 p){
      vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
      return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y);
    }`;

  function creerMer(){
    if(!M.mer) return;
    // Rivage du shader : mêmes paramètres que cote(x) du moteur (jusqu'à 4 ondes).
    const ondes = [];
    for(let k = 0; k < 4; k++){
      const o = M.coteP.ondes[k];
      ondes.push(o ? new THREE.Vector3(o[0], o[1], o[2] || 0) : new THREE.Vector3(0, 1, 0));
    }
    matMer = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uTemps:{value:0}, uCoteBase:{value:M.coteP.base}, uOndes:{value:ondes},
        uLagon:{value:new THREE.Color(A.mer.lagon)},
        uPeu:{value:new THREE.Color(A.mer.peu)}, uProfond:{value:new THREE.Color(A.mer.profond)},
        uReflet:{value:new THREE.Color(A.coulSoleil)},
      }, U_CIEL),
      vertexShader:`
        varying vec3 vPos;
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vPos = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader:`
        uniform float uTemps, uCoteBase;
        uniform vec3 uOndes[4];
        uniform vec3 uLagon, uPeu, uProfond, uReflet;
        varying vec3 vPos;
        #include <fog_pars_fragment>
        ${GLSL_CIEL}
        float cote(float x){
          float y = uCoteBase;
          for(int i = 0; i < 4; i++) y += uOndes[i].x * sin(x/uOndes[i].y + uOndes[i].z);
          return y;
        }
        ${GLSL_BRUIT}
        // Somme de vagues directionnelles : renvoie la pente (dérivées en x et z).
        vec2 vague(vec2 p, vec2 dir, float freq, float amp, float vit){
          float ph = dot(p, dir)*freq + uTemps*vit;
          return dir * (amp*freq*cos(ph));
        }
        void main(){
          vec2 p = vPos.xz;
          float d = vPos.z - cote(vPos.x);         // > 0 au large
          if(d < -6.0) discard;                     // côté terre : ni couleur ni profondeur (rivières visibles)
          vec3 versCam = cameraPosition - vPos;
          float dist = length(versCam);
          vec3 V = versCam/dist;
          // Les vagues fines s'effacent au loin : plus petites qu'un pixel, elles ne feraient que fourmiller.
          float fin = 1.0 - smoothstep(900.0, 2600.0, dist);
          vec2 g = vec2(0.0);
          g += vague(p, normalize(vec2(0.25, -1.0)), 0.045, 1.1, 1.3);
          g += vague(p, normalize(vec2(-0.6, -0.8)), 0.071, 0.55, 1.7);
          g += vague(p, normalize(vec2(0.9, -0.45)), 0.13, 0.25, 2.3);
          g += vague(p, normalize(vec2(-0.2, 1.0)), 0.21, 0.12, 2.9);
          vec2 gf = vague(p, normalize(vec2(0.7, 0.7)), 0.33, 0.06, 3.1);
          gf += vague(p, normalize(vec2(-0.9, 0.3)), 0.47, 0.045, 3.7);
          gf += vague(p, normalize(vec2(0.1, 0.99)), 0.61, 0.03, 4.3);
          gf += vague(p, normalize(vec2(-0.5, -0.85)), 0.83, 0.024, 5.1);
          gf += vague(p, normalize(vec2(0.95, -0.2)), 1.13, 0.015, 6.3);
          g += gf*fin;
          g *= 0.8 + 0.4*vb(p*0.012 + uTemps*0.03);
          // La houle s'amortit en arrivant sur la plage.
          g *= 0.45 + 0.55*smoothstep(0.0, 120.0, d);
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          float jour = 1.0 - uSombre;

          // Profondeur de l'eau (même profil que le fond modelé par le terrain), puis couleur :
          // le sable transparaît près du bord, l'eau absorbe le rouge puis le vert en s'approfondissant.
          float prof = d < 40.0 ? max(d + 5.0, 0.0)*0.02 : 0.9 + (d - 40.0)*0.09;
          vec3 trans = exp(-prof*vec3(0.55, 0.16, 0.11));
          vec3 eau = mix(uLagon, uPeu, smoothstep(0.3, 5.0, prof));
          eau = mix(eau, uProfond, smoothstep(4.0, 34.0, prof));
          eau *= 0.9 + 0.2*vb(p*0.006);
          float diff = 0.78 + 0.32*max(dot(n, uSoleil), 0.0);
          // Lumière qui traverse la crête des vagues, face au soleil.
          float crete = max(dot(normalize(g + 1e-4), -normalize(uSoleil.xz + 1e-4)), 0.0) * min(length(g)*1.6, 1.0);
          vec3 col = eau*diff + uLagon*crete*0.16*smoothstep(1.0, 12.0, prof);
          // Réseau de lumière sur le fond, là où l'eau est peu profonde.
          float ca = 1.0 - abs(vb(p*0.085 + n.xz*1.5 + uTemps*0.11) - vb(p*0.085 - uTemps*0.09 + 4.7))*2.2;
          col += vec3(0.85, 0.95, 0.8) * pow(max(ca, 0.0), 6.0) * 0.13 * trans.g * smoothstep(-2.0, 12.0, d);
          col *= mix(1.0, 0.3, uSombre);

          // Reflet du ciel dans la direction réfléchie par les vagues (plus fort en vue rasante).
          vec3 R = reflect(-V, n);
          R.y = abs(R.y);
          float fres = 0.03 + 0.97*pow(1.0 - max(dot(n, V), 0.0), 4.0);
          col = mix(col, couleurCiel(R), clamp(fres, 0.0, 0.8));
          // Soleil : éclats sur les facettes bien orientées, traînée plus large autour.
          vec3 H = normalize(uSoleil + V);
          float nh = max(dot(n, H), 0.0);
          col += mix(vec3(1.0, 0.92, 0.78), uReflet, 0.5) * (pow(nh, 600.0)*2.6 + pow(nh, 60.0)*0.2) * jour * min(uDisque, 1.0);

          // Écume : liseré du rivage, rouleaux qui arrivent sur la plage et leur traîne, moutons au large.
          float br = vb(p*0.05 + vec2(uTemps*0.05, 0.0));
          float dent = 0.45 + 0.55*vb(p*0.42 + vec2(uTemps*0.21, -uTemps*0.13)) * (0.6 + 0.8*vb(p*1.3 - uTemps*0.3)*fin);
          float ecume = (1.0 - smoothstep(1.5, 7.0 + br*8.0, d)) * (0.5 + 0.5*vb(p*0.15 + uTemps*0.3));
          float phase = d*0.13 - uTemps*1.1 + br*4.0;
          float zone = (1.0 - smoothstep(4.0, 60.0, d)) * smoothstep(0.42, 0.68, vb(p*0.05 + vec2(uTemps*0.08, 0.0)));
          float rouleau = smoothstep(0.84, 0.97, sin(phase)) * zone;
          float traine = smoothstep(-0.2, 0.9, sin(phase + 1.1)) * zone * 0.5 * smoothstep(0.5, 0.8, dent);
          float tache = smoothstep(0.7, 0.85, vb(p*0.2 + vec2(uTemps*0.2, uTemps*0.1))) * (1.0 - smoothstep(10.0, 90.0, d)) * 0.2;
          float mouton = smoothstep(0.075, 0.11, length(g)) * smoothstep(0.62, 0.8, vb(p*0.23 + uTemps*0.12)) * smoothstep(60.0, 200.0, d) * 0.5 * fin;
          float f = clamp((ecume*0.9 + rouleau*0.65 + traine + tache + mouton) * (0.55 + 0.6*dent), 0.0, 1.0);
          col = mix(col, vec3(0.94, 0.96, 0.94) * mix(1.0, 0.42, uSombre), f);

          // Transparence : le fond se voit près du bord, puis l'eau devient opaque.
          float alpha = clamp(1.0 - trans.r*0.92, 0.0, 0.97);
          alpha = max(max(alpha, clamp(fres, 0.0, 0.8)*0.6), f*0.95);
          // Bord de l'eau fondu : l'intersection avec le sol (dm ≈ -5) ne dessine pas d'arête nette.
          alpha *= smoothstep(-5.5, -1.0, d);
          if(alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
      transparent:true, depthWrite:true, fog:true, toneMapped:false,
    });
    const g = new THREE.PlaneGeometry(36000, 36000, 1, 1);
    g.rotateX(-Math.PI/2);
    mer = new THREE.Mesh(g, matMer);
    mer.position.set(LX/2, NIV_MER, LY/2);
    mer.renderOrder = -10;
    scene.add(mer);
  }

  // Eau douce : rivières (courant), bassins et déversoirs. Un seul maillage pour toute la carte.
  const EAU = {f:null};
  function rubanRivieres(){
    for(const R of RIVS){
      const pts = echantillonner(R.pts, 16), w = R.demi + 12;
      // Directions lissées (moyenne des segments voisins) : pas de pli aux coudes.
      const dirs = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        return [dx/l, dy/l];
      });
      for(let i = 0; i < pts.length - 1; i++){
        const [x0, y0, , s0] = pts[i], [x1, y1, , s1] = pts[i+1], [tx0, ty0] = dirs[i], [tx1, ty1] = dirs[i+1];
        const P = [[x0 + ty0*w, NIV_RIV, y0 - tx0*w], [x1 + ty1*w, NIV_RIV, y1 - tx1*w], [x1 - ty1*w, NIV_RIV, y1 + tx1*w], [x0 - ty0*w, NIV_RIV, y0 + tx0*w]];
        const U = [[s0, -w], [s1, -w], [s1, w], [s0, w]];
        const dx = (tx0 + tx1)/2, dz = (ty0 + ty1)/2;
        // Triangles orientés vers le haut (ordre anti-horaire vu d'en haut).
        for(const k of [0, 2, 1, 0, 3, 2]) EAU.f.sommet(P[k][0], P[k][1], P[k][2], U[k][0], U[k][1], 30, R.demi, dx, dz);
      }
    }
  }
  function creerEau(){
    if(EAU.f.vide()) return;
    matRiv = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uTemps:{value:0},
        uClair:{value:new THREE.Color(A.riv.clair)}, uFonce:{value:new THREE.Color(A.riv.sombre)},
        uReflet:{value:new THREE.Color(A.coulSoleil)},
      }, U_CIEL),
      vertexShader:`
        attribute vec2 aInfo;
        attribute vec2 aDir;
        varying vec2 vUv; varying vec2 vInfo; varying vec2 vDir; varying vec3 vPos;
        #include <fog_pars_vertex>
        void main(){
          vUv = uv; vInfo = aInfo; vDir = aDir;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vPos = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader:`
        uniform float uTemps;
        uniform vec3 uClair, uFonce, uReflet;
        varying vec2 vUv; varying vec2 vInfo; varying vec2 vDir; varying vec3 vPos;
        #include <fog_pars_fragment>
        ${GLSL_CIEL}
        ${GLSL_BRUIT}
        // Rides étirées dans le sens du courant.
        float rides(vec2 c){ return vb(c*vec2(0.045, 0.16))*0.6 + vb(c*vec2(0.11, 0.33) + 3.1)*0.4; }
        void main(){
          float vit = vInfo.x, demi = vInfo.y;
          vec2 c = vec2(vUv.x - uTemps*vit, vUv.y) + uTemps*vec2(1.7, 1.1);
          float e = 0.8;
          float hx = rides(c + vec2(e, 0.0)) - rides(c - vec2(e, 0.0));
          float hy = rides(c + vec2(0.0, e)) - rides(c - vec2(0.0, e));
          vec2 T = normalize(vDir + vec2(1e-5)), Nl = vec2(-T.y, T.x);
          vec2 gr = (hx*T + hy*Nl) * 2.2;
          vec3 n = normalize(vec3(-gr.x, 1.0, -gr.y));
          vec3 V = normalize(cameraPosition - vPos);
          float a = abs(vUv.y);
          // Profondeur : nulle sur les rives, pleine au milieu du lit. Eau claire au bord (le fond
          // transparaît), plus sombre et plus opaque au centre.
          float prof = 1.0 - smoothstep(0.0, demi, a);
          vec3 col = mix(uClair, uFonce, smoothstep(0.0, 0.8, prof)*0.9) * (0.85 + 0.25*vb(vPos.xz*0.02));
          col *= 0.82 + 0.3*max(dot(n, uSoleil), 0.0);
          float ca = 1.0 - abs(vb(c*0.11 + n.xz*1.5) - vb(c*0.11 + vec2(4.7, uTemps*0.4)))*2.4;
          col += vec3(0.8, 0.9, 0.78) * pow(max(ca, 0.0), 6.0) * 0.14 * (1.0 - prof);
          col *= mix(1.0, 0.32, uSombre);
          // Reflet du ciel dans la direction réfléchie par les rides.
          vec3 R = reflect(-V, n);
          R.y = abs(R.y);
          float fres = 0.03 + 0.97*pow(1.0 - max(dot(n, V), 0.0), 4.0);
          col = mix(col, couleurCiel(R), clamp(fres*0.9, 0.0, 0.6));
          vec3 H = normalize(uSoleil + V);
          float nh = max(dot(n, H), 0.0);
          col += mix(vec3(1.0, 0.94, 0.82), uReflet, 0.5) * (pow(nh, 400.0)*1.9 + pow(nh, 40.0)*0.13) * (1.0 - uSombre) * min(uDisque, 1.0);
          // Écume : liseré des rives, traînées du courant, déversoirs rapides.
          float dent = 0.5 + 0.5*vb(c*vec2(0.3, 0.6) + 2.0);
          float trainee = smoothstep(0.62, 0.8, vb(c*vec2(0.03, 0.2))) * min(vit/30.0, 1.0) * 0.14;
          float rive = smoothstep(demi - 12.0, demi - 3.0, a) * (0.4 + 0.6*vb(c*0.2));
          float rapide = smoothstep(50.0, 110.0, vit) * (0.55 + 0.45*vb(c*vec2(0.05, 0.4)));
          float f = clamp((trainee + rive*0.4)*(0.5 + 0.7*dent) + rapide, 0.0, 1.0);
          col = mix(col, vec3(0.9, 0.92, 0.9) * mix(1.0, 0.42, uSombre), f);
          float bord = 1.0 - smoothstep(demi + 4.0, demi + 12.0, a);
          float alpha = mix(0.66, 0.96, smoothstep(0.0, 0.7, prof)) * bord;
          alpha = max(alpha, f*0.9*bord);
          if(alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
      transparent:true, depthWrite:false, fog:true, toneMapped:false, side:THREE.DoubleSide,
    });
    const m = new THREE.Mesh(EAU.f.geometrie(), matRiv);
    m.renderOrder = -5;
    scene.add(m);
  }

  // Brume basse : deux nappes horizontales bruitées. Hors carte, elle remplit les vallées
  // (le relief la coupe) ; dans la carte, elle reste légère pour ne pas masquer les unités.
  function creerBrumeBasse(){
    if(!A.brumeBasse) return;
    matBrumeBasse = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTemps:{value:0}, uDens:{value:A.brumeBasse}, uCoul:{value:new THREE.Color(A.coulBrumeBasse)},
        uCarte:{value:new THREE.Vector4(0, 0, LX, LY)},
      }]),
      vertexShader:`
        varying vec3 vPos;
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vPos = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader:`
        uniform float uTemps, uDens;
        uniform vec3 uCoul;
        uniform vec4 uCarte;
        varying vec3 vPos;
        #include <fog_pars_fragment>
        ${GLSL_BRUIT}
        void main(){
          vec2 p = vPos.xz;
          float n = vb(p*0.0022 + vec2(uTemps*0.006, uTemps*0.002))*0.6 + vb(p*0.007 - vec2(uTemps*0.01, 0.0))*0.4;
          vec2 dh = max(uCarte.xy - p, p - uCarte.zw);
          float hors = smoothstep(0.0, 500.0, max(max(dh.x, dh.y), 0.0));
          float a = uDens * smoothstep(0.28, 0.72, n) * mix(0.3, 1.0, hors);
          if(a < 0.004) discard;
          gl_FragColor = vec4(uCoul, a);
          #include <fog_fragment>
        }`,
      transparent:true, depthWrite:false, fog:true, toneMapped:false,
    });
    const F = [];
    for(const [hy, dec] of [[6, 0], [17, 900]]){
      const g = new THREE.PlaneGeometry(9000, 8000, 1, 1); g.rotateX(-Math.PI/2); g.translate(LX/2 + dec*0.2, hy, LY/2 - dec*0.1);
      F.push(g);
    }
    for(const g of F){ const m = new THREE.Mesh(g, matBrumeBasse); m.renderOrder = 5; scene.add(m); }
  }

  function creerTerrain(){
    let t = performance.now();
    construireHauteurs();
    R3D.durees.hauteurs = Math.round(performance.now() - t);
    const L = GNX + 1, nV = L*(GNZ + 1);
    const pos = new Float32Array(nV*3), uv = new Float32Array(nV*2), col = new Float32Array(nV*3);
    for(let j = 0; j <= GNZ; j++) for(let i = 0; i <= GNX; i++){
      const k = j*L + i, x = GX0 + i*GPAS, y = GZ0 + j*GPAS;
      pos[k*3] = x; pos[k*3+1] = hauteurs[k]; pos[k*3+2] = y;
      uv[k*2] = (x - TX0)/TW; uv[k*2+1] = 1 - (y - TY0)/TH;
      const c = couleurSol(x, y);
      col[k*3] = s2l(c[0]); col[k*3+1] = s2l(c[1]); col[k*3+2] = s2l(c[2]);
    }
    // Triangles rangés bloc par bloc (BLOC_SOL x BLOC_SOL cases) : chaque bloc devient un maillage
    // à part, qui partage les mêmes tampons (sommets et indices envoyés une seule fois à la carte
    // graphique) et ne dessine que sa tranche d'indices. Les blocs hors de l'image sont écartés par
    // le découpage habituel de three (boîte englobante exacte de chaque bloc).
    const idx = new Uint32Array(GNX*GNZ*6), blocs = [];
    let n = 0;
    for(let bj = 0; bj < GNZ; bj += BLOC_SOL) for(let bi = 0; bi < GNX; bi += BLOC_SOL){
      const debut = n, i1 = Math.min(GNX, bi + BLOC_SOL), j1 = Math.min(GNZ, bj + BLOC_SOL);
      let y0 = Infinity, y1 = -Infinity;
      for(let j = bj; j < j1; j++) for(let i = bi; i < i1; i++){
        const a = j*L + i, b = (j+1)*L + i, c = (j+1)*L + i + 1, d = j*L + i + 1;
        idx[n++] = a; idx[n++] = b; idx[n++] = d; idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
      for(let j = bj; j <= j1; j++) for(let i = bi; i <= i1; i++){ const h = hauteurs[j*L + i]; if(h < y0) y0 = h; if(h > y1) y1 = h; }
      blocs.push({debut, nb:n - debut, boite:new THREE.Box3(new THREE.Vector3(GX0 + bi*GPAS, y0, GZ0 + bj*GPAS), new THREE.Vector3(GX0 + i1*GPAS, y1, GZ0 + j1*GPAS))});
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aCouleur', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const tDetail = textureDetail(), tNormales = textureNormalesDetail();
    // Rivage (mêmes paramètres que la mer) : le sable mouillé suit la ligne d'eau.
    const ondes = [];
    for(let k = 0; k < 4; k++){
      const o = M.coteP.ondes[k];
      ondes.push(o ? new THREE.Vector3(o[0], o[1], o[2] || 0) : new THREE.Vector3(0, 1, 0));
    }
    const mat = new THREE.MeshStandardMaterial({map:peindreSol(), roughness:0.96, metalness:0});
    // Matière du sol :
    //   - teinte : texture peinte, nuancée par une texture de détail (deux échelles) ;
    //   - relief : normales de détail (deux échelles), estompées avec la distance ;
    //   - matière : sable mat, bitume un peu plus lisse, sable mouillé sombre et brillant au bord de
    //     la mer et des rivières (il reflète le ciel par la carte d'environnement).
    mat.onBeforeCompile = sh => {
      sh.uniforms.tDetail = {value:tDetail};
      sh.uniforms.tNormales = {value:tNormales};
      sh.uniforms.uCoteSol = {value:new THREE.Vector2(M.coteP.base, M.mer ? 1 : 0)};
      sh.uniforms.uOndesSol = {value:ondes};
      sh.uniforms.uNivEau = {value:new THREE.Vector2(NIV_MER, NIV_RIV)};
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aCouleur;\nvarying vec3 vCouleur;\nvarying vec3 vPosM;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCouleur = aCouleur;\nvPosM = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tDetail, tNormales;
          uniform vec2 uCoteSol, uNivEau;
          uniform vec3 uOndesSol[4];
          varying vec3 vCouleur;
          varying vec3 vPosM;
          float solHumide = 0.0, solBitume = 0.0;`)
        .replace('#include <map_fragment>', `
          vec4 texelColor = mapTexelToLinear(texture2D(map, vUv));
          vec2 bb = smoothstep(vec2(0.0), vec2(0.04), vUv) * smoothstep(vec2(0.0), vec2(0.04), 1.0 - vUv);
          vec3 base = mix(vCouleur, texelColor.rgb, bb.x*bb.y);
          float gris = dot(base, vec3(0.3, 0.59, 0.11));
          // Bitume : sombre et sans couleur.
          solBitume = (1.0 - smoothstep(0.035, 0.11, gris)) * (1.0 - smoothstep(0.012, 0.05, max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b))));
          // Sol un peu plus sombre et plus saturé : les unités ressortent, le sol ne « brûle » plus en blanc.
          base = max(mix(vec3(gris), base, 1.12), 0.0) * 0.84;
          float det = texture2D(tDetail, vPosM.xz/83.0).r*0.55 + texture2D(tDetail, vPosM.xz/21.0 + 0.37).g*0.45;
          // Sable mouillé : bande au-dessus de la ligne d'eau de la mer, berges des rivières.
          float rive = 1.0 - smoothstep(uNivEau.y + 0.3, uNivEau.y + 1.1, vPosM.y);
          if(uCoteSol.y > 0.5){
            float yc = uCoteSol.x;
            for(int i = 0; i < 4; i++) yc += uOndesSol[i].x * sin(vPosM.x/uOndesSol[i].y + uOndesSol[i].z);
            float dm = vPosM.z - yc;
            solHumide = smoothstep(-22.0 - 8.0*det, -8.0, dm) * (1.0 - smoothstep(-4.0, 8.0, dm));
            rive *= 1.0 - smoothstep(-60.0, -30.0, dm);        // pas de « berge » sur le fond marin
          }
          solHumide = max(solHumide, rive);
          diffuseColor.rgb *= base * (0.6 + 0.8*det) * mix(1.0, 0.68, solHumide);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(mix(roughnessFactor, 0.72, solBitume), 0.3, solHumide);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            float loin = 1.0 - smoothstep(700.0, 2400.0, length(vViewPosition));
            vec2 pn = (texture2D(tNormales, vPosM.xz/67.0).rg - 0.5)*1.5 + (texture2D(tNormales, vPosM.xz/19.0 + 0.23).rg - 0.5)*0.9;
            pn *= loin * (1.0 - 0.75*solBitume) * (1.0 - 0.6*solHumide);
            normal = normalize(normal - (viewMatrix * vec4(pn.x, 0.0, pn.y, 0.0)).xyz);
          }`);
    };
    // Variante légère pour la qualité Basse : éclairage par sommet (Lambert), même teinte du sol
    // (texture, détail, bitume, sable mouillé assombri) ; sans relief fin ni brillant du sable mouillé.
    // La carte d'environnement ne l'éclaire pas : uTeinteSol compense l'écart de couleur moyen,
    // mesuré une fois sur l'image (calibrerSol).
    const obc = mat.onBeforeCompile;
    matSolS = mat;
    matSolL = new THREE.MeshLambertMaterial({map:mat.map});
    matSolL.onBeforeCompile = sh => {
      obc(sh);
      sh.uniforms.uTeinteSol = U_TEINTE_SOL;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uTeinteSol;')
        .replace('#include <aomap_fragment>', 'reflectedLight.directDiffuse *= uTeinteSol; reflectedLight.indirectDiffuse *= uTeinteSol;\n#include <aomap_fragment>');
    };
    solCalibre = false; essaisSol = 0;
    sol = new THREE.Group();
    for(const b of blocs){
      const gb = new THREE.BufferGeometry();
      for(const nom of ['position', 'normal', 'uv', 'aCouleur']) gb.setAttribute(nom, g.attributes[nom]);
      gb.setIndex(g.index);
      gb.setDrawRange(b.debut, b.nb);
      gb.boundingBox = b.boite;
      gb.boundingSphere = b.boite.getBoundingSphere(new THREE.Sphere());
      const m = new THREE.Mesh(gb, mat);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      sol.add(m);
    }
    scene.add(sol);
  }
  const BLOC_SOL = 40;                   // côté d'un bloc du sol, en cases (40 x 20 = 800 unités)
  let matSolS = null, matSolL = null, solCalibre = false;
  const U_TEINTE_SOL = {value:new THREE.Vector3(1, 1, 1)};
  // Matière du sol selon la qualité.
  function majMatiereSol(){
    if(!sol || !matSolS) return;
    const m = R3D.qualite === 'basse' && matSolL ? matSolL : matSolS;
    for(const c of sol.children) c.material = m;
  }
  // Teinte de la variante Lambert : on rend le sol seul (petite image hors écran), avec la matière
  // complète puis la variante, et on corrige l'écart de couleur moyen, canal par canal.
  let essaisSol = 0;
  function calibrerSol(){
    if(solCalibre || !sol || !matSolL || !renderer || essaisSol >= 3) return;
    solCalibre = true; essaisSol++;
    // Rendu à l'écran (même variante de programme que le jeu en Basse : ton ACES, sortie sRGB), dans
    // un petit coin de l'image, lu aussitôt ; l'image suivante le recouvre.
    const caches = [], ombres = renderer.shadowMap.autoUpdate, rt = renderer.getRenderTarget();
    const fond = scene.background, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    const vp = renderer.getViewport(new THREE.Vector4()), sc = renderer.getScissor(new THREE.Vector4()), st = renderer.getScissorTest();
    const gl = renderer.getContext(), pr = renderer.getPixelRatio();
    try {
      for(const o of scene.children) if(o !== sol && o.visible && !o.isLight){ o.visible = false; caches.push(o); }
      renderer.shadowMap.autoUpdate = false;
      scene.background = null; renderer.setClearColor(0x000000, 0);   // seuls les pixels du sol comptent (alpha 1)
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, 160, 100); renderer.setScissor(0, 0, 160, 100); renderer.setScissorTest(true);
      const W = Math.max(1, Math.floor(160*pr)), H = Math.max(1, Math.floor(100*pr));
      const px = new Uint8Array(W*H*4);
      const moyenne = m => {
        for(const c of sol.children) c.material = m;
        renderer.clear(); renderer.render(scene, camera);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const s = [0, 0, 0]; let nb = 0;
        for(let i = 0; i < px.length; i += 4) if(px[i+3] > 250){ s[0] += px[i]; s[1] += px[i+1]; s[2] += px[i+2]; nb++; }
        if(nb < 200) throw new Error('sol hors champ');
        return s.map(v => Math.pow(Math.max(v/nb, 1)/255, 2.2));
      };
      const ref = moyenne(matSolS), k = U_TEINTE_SOL.value;
      k.set(1, 1, 1);
      for(let it = 0; it < 3; it++){
        const l = moyenne(matSolL);
        k.set(k.x*Math.pow(ref[0]/l[0], 1.3), k.y*Math.pow(ref[1]/l[1], 1.3), k.z*Math.pow(ref[2]/l[2], 1.3));
      }
      k.set(clamp(k.x, 0.4, 2.5), clamp(k.y, 0.4, 2.5), clamp(k.z, 0.4, 2.5));
    } catch(e){
      U_TEINTE_SOL.value.set(1, 1, 1);
      solCalibre = false;                 // nouvel essai à la prochaine occasion
    } finally {
      scene.background = fond; renderer.setClearColor(cc, ca);
      renderer.setViewport(vp); renderer.setScissor(sc); renderer.setScissorTest(st);
      for(const o of caches) o.visible = true;
      renderer.shadowMap.autoUpdate = ombres;
      renderer.setRenderTarget(rt);
      majMatiereSol();
    }
  }

  // =================================================================
  //  7. ROCHERS ET DÉCOR
  // =================================================================
  const TEINTES_ROCHE = ['#625d57', '#58544f', '#6a625a', '#62544a', '#54524f', '#6e645a', '#5e5852'];   // un peu plus froids et sombres que le sol ocre : les crêtes se détachent
  // Bloc rocheux : icosaèdre déformé par bruit, ombrage plat, strates, poussière sur le dessus.
  function blocRocheux(F, x, z, rx, ry, rz, rot, teinte, graine, y0){
    const g = new THREE.IcosahedronGeometry(1, 1);
    const P = g.attributes.position;
    const plans = [];
    for(let k = 0; k < 6; k++){
      const a = hash2(k, graine*13|0)*Math.PI*2, el = 0.15 + hash2(k + 50, graine*7|0)*1.2;
      plans.push([Math.cos(a)*Math.cos(el), Math.sin(el), Math.sin(a)*Math.cos(el), 0.55 + hash2(k + 9, graine|0)*0.3]);
    }
    plans.push([0, 1, 0, 0.5 + hash2(3, graine|0)*0.25]);   // sommet
    for(let i = 0; i < P.count; i++){
      const px = P.getX(i), py = P.getY(i), pz = P.getZ(i);
      let k = 1 + (bruit3(px*1.6 + graine, py*1.6, pz*1.6 - graine) - 0.5)*0.75 + (bruit3(px*4 + graine, py*4 + 3, pz*4) - 0.5)*0.32;
      let nx = px*k, ny = py*k, nz = pz*k;
      // Plans de clivage : on rabote le bloc selon quelques plans aléatoires (facettes nettes).
      for(const [ax, ay, az, dd] of plans){
        const e = nx*ax + ny*ay + nz*az - dd;
        if(e > 0){ nx -= ax*e; ny -= ay*e; nz -= az*e; }
      }
      if(ny < -0.15) ny = -0.15 + (ny + 0.15)*0.3;    // base enfoncée
      P.setXYZ(i, nx, ny, nz);
    }
    _m.compose(_p.set(x, 0, z), _q.setFromEuler(_e.set(0, rot, 0)), _s.set(rx, ry, rz));
    const base = lin(teinte), poussiere = lin('#b39c78'), sombre = lin('#3a332d');
    const c = new THREE.Color();
    const h0 = y0 !== undefined ? y0 : hSol(x, z);
    _m.elements[13] = h0 + ry*0.1;
    // Couleur par face : calculée sur le centre de la face (rendu facetté).
    const debut = F.pos.length;
    F.geo(g, _m, '#ffffff', true);
    for(let i = debut; i < F.pos.length; i += 9){
      const cy = (F.pos[i+1] + F.pos[i+4] + F.pos[i+7])/3 - h0, ny = F.nor[i+1];
      const bande = 0.88 + 0.12*Math.sin(cy*0.42 + graine);
      c.copy(base).multiplyScalar(bande * (0.92 + 0.16*hash2(i, graine|0)));
      if(cy < 4) c.lerp(sombre, (1 - cy/4)*0.35);
      if(ny > 0.8) c.lerp(poussiere, 0.3);
      for(let v = 0; v < 3; v++){ F.col[i + v*3] = c.r; F.col[i + v*3 + 1] = c.g; F.col[i + v*3 + 2] = c.b; }
    }
    g.dispose();
  }
  function creerRochers(){
    const F = new Fusion(), rnd = generateur(4242 + M.graine);
    const roches = M.roches;
    const tous = roches.slice();
    // Affleurements hors carte (collines ; plus nombreux sur une carte de montagne)
    const nHors = M.mer ? 70 : 110;
    for(let k = 0; k < nHors*3 && tous.length < roches.length + nHors; k++){
      const x = -1400 + rnd()*(LX + 2800), y = -1300 + rnd()*(LY + 2600);
      if(horsCarte(x, y) < 120 || y > coteF(x) - 300 || ecartRiviere(x, y) < 80 || surRoute(x, y, 60)) continue;
      tous.push({x, y, r:20 + rnd()*(M.mer ? 50 : 70), hors:true});
    }
    for(const r of tous){
      const teinte = TEINTES_ROCHE[Math.floor(rnd()*TEINTES_ROCHE.length)];
      // Orientation suivant la crête : direction du voisin le plus proche.
      let rot = rnd()*Math.PI, best = 1e9;
      for(const o of roches) if(o !== r){ const d = Math.hypot(o.x - r.x, o.y - r.y); if(d < best && d < 160){ best = d; rot = -Math.atan2(o.y - r.y, o.x - r.x); } }
      const crete = r.r >= 40 && !r.hors;
      const haut = r.r * (crete ? 0.72 + rnd()*0.3 : 0.5 + rnd()*0.3);
      blocRocheux(F, r.x, r.y, r.r*1.02, r.r*0.24, r.r*0.9, rot, teinte, rnd()*100);
      blocRocheux(F, r.x + (rnd() - 0.5)*r.r*0.2, r.y + (rnd() - 0.5)*r.r*0.2, r.r*(crete ? 0.9 : 0.8), haut, r.r*(crete ? 0.55 : 0.7), rot, teinte, rnd()*100);
      const n = crete ? 2 + Math.floor(rnd()*2) : Math.floor(rnd()*2);
      for(let k = 0; k < n; k++){
        const a = rot + (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5)*0.8, d = r.r*(0.35 + rnd()*0.35);
        const s = r.r*(0.3 + rnd()*0.25);
        blocRocheux(F, r.x + Math.cos(a)*d, r.y - Math.sin(a)*d, s, haut*(0.6 + rnd()*0.5), s*0.8, rnd()*3, teinte, rnd()*100);
      }
    }
    // Rochers d'assise des phares (préparés par la section 8).
    for(const [x, z, rr, hh, y0] of ROCS_PHARES) blocRocheux(F, x, z, rr, hh, rr*0.9, rnd()*3, '#6a625a', rnd()*100, y0);
    if(F.vide()) return;
    const m = new THREE.Mesh(F.geometrie(), new THREE.MeshStandardMaterial({vertexColors:true, roughness:0.93, metalness:0}));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // ----- Modèles de décor (géométries fusionnées à couleurs de sommets, partagées) -----
  function modeleTouffe(){
    const F = new Fusion();
    const pied = lin('#5a5430'), pointe = lin('#c9b37a');
    for(let b = 0; b < 6; b++){
      const a = b/6*Math.PI*2 + 0.3*b, l = 0.5 + (b % 3)*0.15;
      const bx = Math.cos(a)*0.18, bz = Math.sin(a)*0.18, tx = Math.cos(a)*l, tz = Math.sin(a)*l;
      const px = -Math.sin(a)*0.13, pz = Math.cos(a)*0.13;
      F.tri([bx - px, 0, bz - pz], [bx + px, 0, bz + pz], [tx, 0.8 + (b % 2)*0.35, tz], pied, pied, pointe);
    }
    return F.geometrie();
  }
  // Roseaux : tiges fines et hautes, plumets bruns.
  function modeleRoseau(){
    const F = new Fusion();
    const pied = lin('#4f5a2c'), milieu = lin('#7f8a46'), pointe = lin('#a08a5a');
    for(let b = 0; b < 9; b++){
      const a = b*2.4, r = 0.15 + (b % 3)*0.12, hx = Math.cos(a)*r, hz = Math.sin(a)*r;
      const inc = 0.12 + (b % 4)*0.06, tx = hx + Math.cos(a)*inc, tz = hz + Math.sin(a)*inc, hh = 0.75 + (b % 3)*0.15;
      const px = -Math.sin(a)*0.035, pz = Math.cos(a)*0.035;
      F.tri([hx - px, 0, hz - pz], [hx + px, 0, hz + pz], [tx, hh, tz], pied, pied, b % 3 ? milieu : pointe);
      F.tri([hx + px, 0, hz + pz], [hx - px, 0, hz - pz], [tx, hh, tz], pied, pied, b % 3 ? milieu : pointe);
    }
    return F.geometrie();
  }
  function modeleCaillou(){
    const g = new THREE.OctahedronGeometry(1, 0);
    const F = new Fusion();
    _m.compose(_p.set(0, 0.15, 0), _q.identity(), _s.set(1, 0.5, 0.8));
    F.geo(g, _m, '#ffffff', true);
    return F.geometrie();
  }
  function blob(F, x, y, z, sx, sy, sz, coul, graine, detail){
    const g = new THREE.IcosahedronGeometry(1, detail || 0);
    const P = g.attributes.position;
    for(let i = 0; i < P.count; i++){
      const px = P.getX(i), py = P.getY(i), pz = P.getZ(i);
      const k = 1 + (bruit3(px*2 + graine, py*2, pz*2) - 0.5)*0.55;
      P.setXYZ(i, px*k, py*k, pz*k);
    }
    _m.compose(_p.set(x, y, z), _q.identity(), _s.set(sx, sy, sz));
    F.geo(g, _m, typeof coul === 'function' ? coul : (cx, cy, cz, nx, ny) => {
      return new THREE.Color().copy(lin(coul)).multiplyScalar(0.72 + 0.4*Math.max(0, ny));
    }, true);
    g.dispose();
  }
  function modeleArbuste(){
    const F = new Fusion();
    blob(F, 0, 2.6, 0, 4.2, 3.0, 3.8, '#6f6a3e', 1);
    blob(F, 2.2, 2.0, 1.2, 2.8, 2.2, 2.6, '#7d7346', 5);
    return F.geometrie();
  }
  function modeleOlivier(){
    const F = new Fusion();
    F.tube([0, -1, 0], [0.8, 5, 0.3], 1.1, '#5d4c3b', 5);
    F.tube([0.8, 5, 0.3], [-1.2, 9, 0.8], 0.7, '#5d4c3b', 4);
    blob(F, 0, 11, 0, 6.5, 4.2, 6.0, '#7c8a5e', 2);
    blob(F, -0.5, 13, 0.8, 4.5, 3.2, 4.5, '#86946a', 14);
    blob(F, 3.5, 9.5, 1.5, 4.0, 3.0, 4.0, '#8b9868', 6);
    blob(F, -3.2, 9.8, -1.6, 4.2, 3.2, 3.8, '#6d7b52', 11);
    return F.geometrie();
  }
  function modelePin(){
    const F = new Fusion();
    // Pin parasol : tronc court et fourchu, houppier large et épais en plusieurs masses.
    F.tube([0, -1, 0], [1.2, 12, 0.4], 1.6, '#5e4432', 5);
    F.tube([1.2, 12, 0.4], [4.5, 19, 1.5], 1.0, '#5e4432', 5);
    F.tube([1.2, 12, 0.4], [-3, 18.5, -1], 0.9, '#5e4432', 5);
    const ombre = base => (x, y, z, nx, ny) => new THREE.Color().copy(lin(base)).multiplyScalar(0.45 + 0.75*Math.max(0, ny));
    blob(F, 1, 22, 0.5, 15, 6.5, 13.5, ombre('#4a5c31'), 3);
    blob(F, 8, 21, 4, 9, 5, 8.5, ombre('#56693a'), 12);
    blob(F, -7, 20.5, -3, 8.5, 4.6, 8.5, ombre('#4f6236'), 8);
    blob(F, 2, 24.5, -6, 7.5, 4, 7, ombre('#5b6e3e'), 17);
    return F.geometrie();
  }
  function modeleCypres(){
    const F = new Fusion();
    F.tube([0, -1, 0], [0, 4, 0], 0.9, '#5a4634', 5);
    blob(F, 0, 15, 0, 4.2, 13, 4.2, (x, y, z, nx, ny) => new THREE.Color().copy(lin('#3f4f2e')).multiplyScalar(0.6 + 0.012*y + 0.25*Math.max(0, ny)), 4);
    return F.geometrie();
  }
  function modeleArbreMort(){
    const F = new Fusion(), c = '#8d847a';
    F.tube([0, -1, 0], [0.5, 12, 0.2], 1.0, c, 6);
    F.tube([0.5, 12, 0.2], [-0.5, 19, 0.5], 0.55, c, 5);
    F.tube([0.3, 8, 0.1], [5, 14, 1], 0.45, c, 5);
    F.tube([0.4, 11, 0.2], [-4.5, 16, -1.5], 0.4, c, 5);
    F.tube([0.0, 16, 0.3], [3, 20, -2], 0.3, c, 4);
    F.tube([5, 14, 1], [7, 15, 3], 0.25, c, 4);
    return F.geometrie();
  }
  function modelePalmier(){
    const F = new Fusion();
    let px = 0, py = -1, pz = 0, r = 1.4;
    for(let s = 0; s < 6; s++){
      const nx = px + 0.5 + s*0.35, ny = py + 4.8, nz = pz;
      F.tube([px, py, pz], [nx, ny, nz], r, s % 2 ? '#7d6a52' : '#6e5d48', 5);
      px = nx; py = ny; pz = nz; r *= 0.93;
    }
    F.sphere(1.8, px, py, pz, '#6d5a32');
    const vert = lin('#6f8a36'), vertC = lin('#9aa94e'), sec = lin('#9a8148');
    for(let f = 0; f < 9; f++){
      const a = f/9*Math.PI*2 + 0.4, L = 13 + (f % 3)*2, ca = Math.cos(a), sa = Math.sin(a);
      const morte = f === 4;
      let prev = null;
      for(let t = 0; t <= 3; t++){
        const u = t/3, d = L*u, w = 2.6*Math.sin(Math.PI*(0.15 + u*0.85))*(morte ? 0.7 : 1);
        const y = py + 2.5*u - (morte ? 11 : 7.5)*u*u;
        const cx = px + ca*d, cz = pz + sa*d;
        const cur = {c:[cx, y + 0.5, cz], g:[cx - sa*w, y - 0.4, cz + ca*w], d:[cx + sa*w, y - 0.4, cz - ca*w]};
        if(prev){
          const k1 = morte ? sec : vert, k2 = morte ? sec : vertC;
          F.quad(prev.g, prev.c, cur.c, cur.g, k1, k2, k2, k1);
          F.quad(prev.c, prev.d, cur.d, cur.c, k2, k1, k1, k2);
        }
        prev = cur;
      }
    }
    return F.geometrie();
  }
  function modelePoteau(){
    const F = new Fusion();
    F.cyl(0.55, 0.8, 34, 0, -1, 0, '#5b4a3a', 6);
    F.boite(0.9, 0.9, 14, 0, 30, 0, '#4f4032');
    for(const z of [-6, 0, 6]) F.cyl(0.35, 0.45, 1.6, 0, 30.9, z, '#cfd2c8', 5);
    return F.geometrie();
  }

  // Décor répété : chaque modèle est recopié instance par instance dans des blocs de TAILLE_BLOC
  // pixels, fusionnés en UNE géométrie par bloc. Un bloc = un appel de dessin, écarté s'il est hors champ.
  const TAILLE_BLOC = 800;
  function fusionnerParBlocs(groupes, mat, ombre){
    const blocs = new Map();
    for(const {geo, liste} of groupes){
      const nb = geo.attributes.position.count;
      for(const o of liste){
        const cle = Math.floor(o.x/TAILLE_BLOC) + ':' + Math.floor(o.y/TAILLE_BLOC);
        let b = blocs.get(cle);
        if(!b){ b = {elems:[], n:0}; blocs.set(cle, b); }
        b.elems.push([geo, o]); b.n += nb;
      }
    }
    const nm = new THREE.Matrix3();
    for(const b of blocs.values()){
      const pos = new Float32Array(b.n*3), nor = new Float32Array(b.n*3), col = new Float32Array(b.n*3);
      let k = 0;
      for(const [geo, o] of b.elems){
        _m.compose(_p.set(o.x, o.h, o.y), _q.setFromEuler(_e.set(o.ix || 0, o.rot, o.iz || 0)), _s.set(o.s, o.s*(o.sy || 1), o.s));
        nm.getNormalMatrix(_m);
        const e = _m.elements, f = nm.elements;
        const P = geo.attributes.position.array, N = geo.attributes.normal.array, C = geo.attributes.color.array;
        for(let i = 0; i < P.length; i += 3, k += 3){
          const x = P[i], y = P[i+1], z = P[i+2];
          pos[k] = e[0]*x + e[4]*y + e[8]*z + e[12];
          pos[k+1] = e[1]*x + e[5]*y + e[9]*z + e[13];
          pos[k+2] = e[2]*x + e[6]*y + e[10]*z + e[14];
          const a = N[i], bb = N[i+1], c = N[i+2];
          let nx = f[0]*a + f[3]*bb + f[6]*c, ny = f[1]*a + f[4]*bb + f[7]*c, nz = f[2]*a + f[5]*bb + f[8]*c;
          const l = Math.hypot(nx, ny, nz) || 1;
          nor[k] = nx/l; nor[k+1] = ny/l; nor[k+2] = nz/l;
          col[k] = C[i]*o.cr; col[k+1] = C[i+1]*o.cg; col[k+2] = C[i+2]*o.cb;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = ombre; m.receiveShadow = true;
      scene.add(m);
    }
  }

  // Décor demandé par les structures (oliviers d'une cour, palmiers d'une entrée...).
  let DECOR_SUPP = [];

  function creerDecor(){
    const rnd = generateur(31337 + M.graine);
    const L = {touffe:[], caillou:[], roseau:[], arbuste:[], olivier:[], pin:[], cypres:[], mort:[], palmier:[], poteau:[]};
    const zonesInterdites = [];   // emprises des maisons (hors carte)
    const interdit = (x, y, m) => zonesInterdites.some(z => x > z[0] - m && x < z[2] + m && y > z[1] - m && y < z[3] + m);
    function poser(type, x, y, s, var_, extra){
      const v = 1 - var_/2 + rnd()*var_;
      const o = {x, y, h:hSol(x, y), s, rot:rnd()*Math.PI*2, cr:v, cg:v, cb:v*(0.95 + rnd()*0.1)};
      if(extra) Object.assign(o, extra);
      L[type].push(o);
    }
    // Zone d'eau ou de construction : ni herbe ni caillou.
    const eau = (x, y, m) => y > coteF(x) - m || ecartRiviere(x, y) < m - 30;
    const occupe = (x, y, m) => dansStructure(x, y, m) || surPont(x, y, m);
    creerMaisons(zonesInterdites);

    // --- Détails bas sur toute la carte ---
    for(let k = 0; k < 30000 && L.touffe.length < 7000; k++){
      const x = -1200 + rnd()*(LX + 2400), y = -900 + rnd()*(LY + 1200);
      if(eau(x, y, 35)) continue;
      const herbe = lisse(0.5, 0.7, fbm2(x/300 + 400, y/300 - 80, 3)) + lisse(50, 500, horsCarte(x, y))*0.5;
      if(rnd() > 0.15 + herbe*0.85) continue;
      if(surRoute(x, y, 30) || occupe(x, y, 6)) continue;
      poser('touffe', x, y, 2.6 + rnd()*3.2, 0.5, {sy:0.8 + rnd()*0.6});
    }
    for(let k = 0; k < 6000 && L.caillou.length < 2200; k++){
      const x = -1000 + rnd()*(LX + 2000), y = -700 + rnd()*(LY + 1000);
      if(eau(x, y, 25)) continue;
      if(surRoute(x, y, 20) || occupe(x, y, 4)) continue;
      const pres = M.roches.some(r => Math.hypot(r.x - x, r.y - y) < r.r*1.8);
      if(!pres && rnd() < 0.55) continue;
      poser('caillou', x, y, 0.8 + rnd()*rnd()*(pres ? 3.5 : 2.2), 0.45, {ix:(rnd() - 0.5)*0.5, iz:(rnd() - 0.5)*0.5});
    }
    // --- Objets hauts dans la carte : seulement sur cases non libres (pourtour des rochers) ---
    for(const r of M.roches){
      for(let k = 0; k < 7; k++){
        const a = rnd()*Math.PI*2, d = r.r*(0.75 + rnd()*0.3), x = r.x + Math.cos(a)*d, y = r.y + Math.sin(a)*d;
        if(caseLibre(x, y) || eau(x, y, 10)) continue;
        if(rnd() < 0.12) poser('mort', x, y, 0.6 + rnd()*0.4, 0.2);
        else poser('arbuste', x, y, 0.6 + rnd()*0.6, 0.35);
      }
    }
    // --- Bosquets : pins parasols et oliviers serrés (cases bloquées par le moteur) ---
    const montagne = !M.mer || M.ambiance === 'aube';
    for(const b of M.bosquets){
      const pas = 19, partPin = montagne ? 0.8 : 0.5;
      for(let gx = b.x - b.r; gx <= b.x + b.r; gx += pas) for(let gy = b.y - b.r; gy <= b.y + b.r; gy += pas){
        const x = gx + (rnd() - 0.5)*pas*0.8, y = gy + (rnd() - 0.5)*pas*0.8, d = Math.hypot(x - b.x, y - b.y);
        if(d > b.r - 4 || eau(x, y, 10)) continue;
        const t = rnd();
        if(t < partPin) poser('pin', x, y, 0.7 + rnd()*0.45, 0.3);
        else if(t < 0.95) poser('olivier', x, y, 0.85 + rnd()*0.5, 0.3);
        else poser('cypres', x, y, 0.8 + rnd()*0.3, 0.25);
      }
      // Sous-bois et lisière
      for(let k = 0; k < b.r*0.6; k++){
        const a = rnd()*Math.PI*2, d = Math.sqrt(rnd())*b.r, x = b.x + Math.cos(a)*d, y = b.y + Math.sin(a)*d;
        if(!caseLibre(x, y) && !eau(x, y, 10)) poser('arbuste', x, y, 0.6 + rnd()*0.6, 0.35);
      }
    }
    // --- Rivières : roseaux au bord de l'eau, tamaris, peupliers hors carte ---
    for(const R of RIVS){
      for(const [x0, y0, a] of echantillonner(R.pts, 7)){
        for(const sd of [-1, 1]){
          if(bruit2(x0/60 + sd*13, y0/60) < 0.38 || rnd() < 0.3) continue;
          const o = sd*(R.demi - 8 + rnd()*10), x = x0 - Math.sin(a)*o, y = y0 + Math.cos(a)*o;
          if(y > coteF(x) - 20 || occupe(x, y, 10) || surRoute(x, y, 8)) continue;
          poser('roseau', x, y, 8 + rnd()*7, 0.35, {sy:0.9 + rnd()*0.5});
        }
        for(const sd of [-1, 1]){
          if(rnd() > 0.09) continue;
          const o = sd*(R.demi + 14 + rnd()*40), x = x0 - Math.sin(a)*o, y = y0 + Math.cos(a)*o;
          if(y > coteF(x) - 40 || occupe(x, y, 12) || surRoute(x, y, 14) || interdit(x, y, 10)) continue;
          if(horsCarte(x, y) > 30){
            if(rnd() < 0.55) poser('cypres', x, y, 0.95 + rnd()*0.35, 0.2, {cr:1.35, cg:1.5, cb:1.0});    // peupliers
            else poser('arbuste', x, y, 0.8 + rnd()*0.7, 0.4);
          } else if(!caseLibre(x, y)) poser('arbuste', x, y, 0.6 + rnd()*0.5, 0.35);
        }
      }
    }
    // --- Décor demandé par les structures ---
    for(const d of DECOR_SUPP) if(L[d.type]) poser(d.type, d.x, d.y, d.s, d.v || 0.25, d.extra);

    // --- Hors carte : végétation dense ---
    // Plafonds (ceux de Port-Calmes, comptés en plus de ce qui est déjà posé) : la recopie
    // des sommets de végétation est l'étape la plus longue de la construction.
    const seuilPin = montagne ? 0.48 : 0.54;
    const cap = {pin:L.pin.length + 1500, olivier:L.olivier.length + 1400, arbuste:L.arbuste.length + 4200, cypres:L.cypres.length + 320};
    for(let k = 0; k < 120000; k++){
      const x = -1900 + rnd()*(LX + 3800), y = -1700 + rnd()*(LY + 3400);
      const o = horsCarte(x, y);
      if(o < 22) continue;
      const dm = y - coteF(x);
      if(dm > -45) continue;
      // Tirage d'abord (rejette la plupart des essais), contrôles coûteux ensuite.
      const t = rnd();
      if(t >= 0.16) continue;
      if(ecartRiviere(x, y) < 12 || surRoute(x, y, 32) || interdit(x, y, 12)) continue;
      const foret = fbm2(x/360 + 5, y/360 - 3, 3), h = hSol(x, y);
      if(dm > -300){
        if(t < 0.05 && L.palmier.length < 260) poser('palmier', x, y, 0.85 + rnd()*0.35, 0.2);
        else if(t < 0.16 && L.arbuste.length < cap.arbuste) poser('arbuste', x, y, 0.7 + rnd()*0.7, 0.4);
        continue;
      }
      if(foret > seuilPin && t < 0.16 && L.pin.length < cap.pin) poser('pin', x, y, 0.75 + rnd()*0.45, 0.3);
      else if(foret > 0.42 && foret < 0.6 && t < 0.09 && L.olivier.length < cap.olivier) poser('olivier', x, y, 0.8 + rnd()*0.5, 0.3);
      else if(t < 0.012 && L.cypres.length < cap.cypres) poser('cypres', x, y, 0.8 + rnd()*0.4, 0.25);
      else if(t < 0.07 && L.arbuste.length < cap.arbuste) poser('arbuste', x, y, 0.7 + rnd()*0.9, 0.4);
      else if(t < 0.074 && h < 120 && L.mort.length < 140) poser('mort', x, y, 0.8 + rnd()*0.5, 0.2);
    }
    // Oliveraies en rangées (ouest et est, hors carte)
    for(const [ox, oy, a] of [[-620, LY*0.25, 0.15], [-520, LY*0.62, -0.1], [LX + 500, LY*0.23, -0.2], [LX + 420, LY*0.63, 0.1]]){
      for(let i = 0; i < 7; i++) for(let j = 0; j < 6; j++){
        const lx = (i - 3)*34 + (rnd() - 0.5)*5, ly = (j - 2.5)*34 + (rnd() - 0.5)*5;
        const x = ox + lx*Math.cos(a) - ly*Math.sin(a), y = oy + lx*Math.sin(a) + ly*Math.cos(a);
        if(horsCarte(x, y) > 30 && !interdit(x, y, 8) && !eau(x, y, 60) && !surRoute(x, y, 20)) poser('olivier', x, y, 0.75 + rnd()*0.3, 0.2);
      }
    }
    // Cyprès en alignement le long des routes, hors carte ; lignes électriques le long des routes.
    const lignes = [[]];
    for(let x = -1400; x <= LX + 1400; x += 150){
      const y = -160 + Math.sin(x/700)*30;
      if(ecartRiviere(x, y) > 20) lignes[0].push([x, y]);
    }
    for(const rt of RTES){
      let ligne = [];
      for(const [x, y, a, s] of echantillonner(rt, 70)){
        if(horsCarte(x, y) < 80){ if(ligne.length > 1) lignes.push(ligne); ligne = []; continue; }
        for(const sd of [-1, 1]) if(rnd() < 0.7){
          const px = x - Math.sin(a)*sd*(48 + rnd()*8), py = y + Math.cos(a)*sd*(48 + rnd()*8);
          if(!eau(px, py, 50) && !interdit(px, py, 6)) poser('cypres', px, py, 0.9 + rnd()*0.3, 0.2);
        }
        if(Math.round(s/70) % 2 === 0){
          const px = x - Math.sin(a)*82, py = y + Math.cos(a)*82;
          if(!eau(px, py, 40)) ligne.push([px, py]);
        }
      }
      if(ligne.length > 1) lignes.push(ligne);
    }
    const fils = [];
    for(const ligne of lignes){
      ligne.forEach(([x, y], i) => {
        const suiv = ligne[Math.min(i + 1, ligne.length - 1)], prec = ligne[Math.max(i - 1, 0)];
        const rot = -Math.atan2(suiv[1] - prec[1], suiv[0] - prec[0]);
        poser('poteau', x, y, 1, 0.1, {rot});
        if(i < ligne.length - 1){
          const [x2, y2] = suiv, h1 = hSol(x, y), h2 = hSol(x2, y2);
          for(const off of [-6, 0, 6]){
            const nx = -Math.sin(-rot)*off, nz = Math.cos(-rot)*off;
            let px = x + nx, py = h1 + 32.3, pz = y + nz;
            for(let s = 1; s <= 8; s++){
              const t = s/8, qx = x + (x2 - x)*t + nx, qz = y + (y2 - y)*t + nz;
              const qy = h1 + (h2 - h1)*t + 32.3 - Math.sin(Math.PI*t)*5;
              fils.push(px, py, pz, qx, qy, qz); px = qx; py = qy; pz = qz;
            }
          }
        }
      });
    }
    if(fils.length){
      const gf = new THREE.BufferGeometry(); gf.setAttribute('position', new THREE.Float32BufferAttribute(fils, 3));
      scene.add(new THREE.LineSegments(gf, new THREE.LineBasicMaterial({color:'#2b2826'})));
    }

    // --- Matériaux et blocs ---
    const matV = new THREE.MeshStandardMaterial({vertexColors:true, roughness:0.9, metalness:0, side:THREE.DoubleSide});
    for(const o of L.caillou){ const v = 0.45 + rnd()*0.35; o.cr = v*1.05; o.cg = v; o.cb = v*0.85; }
    // Détails bas (sans ombre portée) puis végétation et poteaux (avec ombre).
    fusionnerParBlocs([{geo:modeleTouffe(), liste:L.touffe}, {geo:modeleCaillou(), liste:L.caillou}, {geo:modeleRoseau(), liste:L.roseau}], matV, false);
    fusionnerParBlocs([
      {geo:modeleArbuste(), liste:L.arbuste}, {geo:modeleOlivier(), liste:L.olivier}, {geo:modelePin(), liste:L.pin},
      {geo:modeleCypres(), liste:L.cypres}, {geo:modeleArbreMort(), liste:L.mort}, {geo:modelePalmier(), liste:L.palmier},
      {geo:modelePoteau(), liste:L.poteau}], matV, true);
  }

  // ----- Maison basse méditerranéenne (hors carte et villages) -----
  // o : {l, p, etages, terrasse, mur, volet, h0, quatre (fenêtres sur les 4 façades), F}
  const MURS = ['#e9e4d8', '#efe9dc', '#e2d6bf', '#d9c7a4', '#ece2cc', '#d8d2c6'];
  const VOLETS = ['#3d6f7a', '#4f7a5a', '#2f5b78', '#7a4f3a', '#556b74'];
  function maison(F, x, y, rot, rnd, o){
    o = o || {};
    const l = o.l || 28 + rnd()*24, p = o.p || 22 + rnd()*16, etages = o.etages || (rnd() < 0.35 ? 2 : 1), h = etages*10 + 1;
    const h0 = o.h0 !== undefined ? o.h0 : Math.min(hSol(x - l/2, y), hSol(x + l/2, y), hSol(x, y - p/2), hSol(x, y + p/2)) - 3;
    const mur = o.mur || MURS[Math.floor(rnd()*MURS.length)], volet = o.volet || VOLETS[Math.floor(rnd()*VOLETS.length)];
    const c = Math.cos(rot), s = Math.sin(rot);
    const pt = (lx, lz) => [x + lx*c + lz*s, y - lx*s + lz*c];
    const B = (bl, bh, bp, lx, by, lz, coul, FF) => { const [px, pz] = pt(lx, lz); (FF || F).boite(bl, bh, bp, px, by, pz, coul, rot); };
    B(l, h + 3, p, 0, h0, 0, mur);
    const terrasse = o.terrasse !== undefined ? o.terrasse : rnd() < 0.55;
    if(terrasse){
      // Toit-terrasse avec acrotère, édicule d'escalier, chauffe-eau solaire ou citerne
      B(l + 0.6, 1.2, p + 0.6, 0, h0 + h + 3, 0, '#d6cfc0');
      B(l*0.3, 3, p*0.3, l*0.2, h0 + h + 3, -p*0.15, mur);
      const r2 = rnd();
      if(r2 < 0.35){ const [px, pz] = pt(-l*0.25, p*0.2); F.cyl(1.6, 1.6, 2.5, px, h0 + h + 4, pz, '#e8e8e8', 8); }
      else if(r2 < 0.6){
        const [px, pz] = pt(-l*0.22, p*0.18);
        F.boiteR(5, 0.4, 3.4, px, h0 + h + 5.2, pz, '#26313a', 0, rot, 0.5);
        F.tube([px - 2, h0 + h + 6.6, pz - 1.6], [px + 2, h0 + h + 6.6, pz - 1.6], 0.9, '#d8d8d4', 6);
      }
      if(rnd() < 0.25){ const [px, pz] = pt(l*0.32, p*0.28); F.boiteR(0.4, 3.2, 3.2, px, h0 + h + 6.2, pz, '#e0e0dc', 0.3, rot, 0); }   // antenne parabolique
    } else {
      // Toit en tuiles : deux pans si la maison est allongée, sinon pyramide à 4 pans.
      // (La pyramide est tournée de 45° AVANT l'étirement : ses arêtes tombent sur les coins.)
      const tuile = rnd() < 0.5 ? '#b05f3c' : '#a5583a';
      if(l > p*1.5) toit2pans(F, x, y, l + 1.2, p + 1.6, h0 + h + 3, Math.min(7, p*0.35), tuile, rot, mur);
      else if(p > l*1.5) toit2pans(F, x, y, p + 1.6, l + 1.2, h0 + h + 3, Math.min(7, l*0.35), tuile, rot + Math.PI/2, mur);
      else {
        _m.compose(_p.set(x, h0 + h + 3 + 3.5, y), _q.setFromEuler(_e.set(0, rot, 0)), _s.set(l*0.74, 7, p*0.74));
        F.geo(geoBase('toit45', () => { const g = new THREE.ConeGeometry(1, 1, 4, 1); g.rotateY(Math.PI/4); return g; }), _m, tuile, true);
      }
    }
    // Fenêtres et volets (éclairées le soir pour une part)
    const allume = () => A.lumieres >= 0.6 && rnd() < 0.3*A.lumieres;
    const fenetre = (lx, by, lz, rx) => {
      const lum = allume();
      const [px, pz] = pt(lx, lz);
      (lum ? FS.F : F).boite(rx ? 0.6 : 3.2, 3.6, rx ? 3.2 : 0.6, px, by, pz, lum ? '#ffc070' : '#2a3236', rot);
      if(lum) HALOS.push([px, by + 1.8, pz, 0.25]);
    };
    const nf = Math.max(1, Math.floor(l/9));
    for(let e = 0; e < etages; e++) for(let k = 0; k < nf; k++){
      const lx = (k - (nf - 1)/2)*(l/nf);
      for(const sz of [-1, 1]){
        fenetre(lx, h0 + 6 + e*9, sz*(p/2 + 0.1), false);
        B(1.3, 3.8, 0.7, lx - 2.4, h0 + 5.9 + e*9, sz*(p/2 + 0.15), volet);
        B(1.3, 3.8, 0.7, lx + 2.4, h0 + 5.9 + e*9, sz*(p/2 + 0.15), volet);
      }
    }
    if(o.quatre){
      const nfz = Math.max(1, Math.floor(p/11));
      for(let e = 0; e < etages; e++) for(let k = 0; k < nfz; k++){
        const lz = (k - (nfz - 1)/2)*(p/nfz);
        for(const sx of [-1, 1]) fenetre(sx*(l/2 + 0.1), h0 + 6 + e*9, lz, true);
      }
    }
    B(3.4, 6, 0.8, l*0.3, h0 + 3, p/2 + 0.2, '#5a4030');
    if(o.muret !== false && rnd() < 0.6){
      const jl = l + 16, jp = p + 18;
      B(jl, 2.6, 1.2, 0, h0 + 2, jp/2, mur); B(jl, 2.6, 1.2, 0, h0 + 2, -jp/2, mur);
      B(1.2, 2.6, jp, jl/2, h0 + 2, 0, mur); B(1.2, 2.6, jp, -jl/2, h0 + 2, 0, mur);
    }
    return [x - l/2 - 10, y - p/2 - 10, x + l/2 + 10, y + p/2 + 10];
  }

  // ----- Maisons, hameaux et épaves hors carte (une seule géométrie) -----
  function creerMaisons(zones){
    const F = new Fusion(), rnd = generateur(555 + M.graine);
    const valide = (x, y, m) => horsCarte(x, y) > 60 && y < coteF(x) - 70 && ecartRiviere(x, y) > m && !surRoute(x, y, m)
                              && !zones.some(z => x > z[0] - 8 && x < z[2] + 8 && y > z[1] - 8 && y < z[3] + 8);
    const poser = (x, y, rot) => { if(valide(x, y, 40)) zones.push(maison(F, x, y, rot, rnd)); };
    // Villages côtiers à l'ouest et à l'est
    if(M.mer){
      for(const [x0, x1] of [[-1150, -110], [LX + 110, LX + 1150]]){
        for(let x = x0; x < x1; x += 44 + rnd()*30){
          const y = coteF(x) - 120 - rnd()*170;
          poser(x, y, (rnd() - 0.5)*0.4);
          if(rnd() < 0.5) poser(x + (rnd() - 0.5)*20, y - 70 - rnd()*60, (rnd() - 0.5)*0.5);
        }
      }
    }
    // Fermes isolées et hameaux (plus nombreux sans mer)
    const fermes = [[-260, LY*0.37], [-330, LY*0.56], [-700, 300], [LX + 280, LY*0.37], [LX + 360, LY*0.55], [LX + 650, 300],
                    [LX*0.19, -320], [LX*0.42, -420], [LX*0.78, -360], [LX*0.94, -700], [LX*0.06, -800]];
    if(!M.mer) fermes.push([LX*0.3, LY + 380], [LX*0.62, LY + 460], [LX*0.85, LY + 340], [-420, LY + 300], [LX + 380, LY + 420]);
    for(const [x, y] of fermes){
      const nb = M.mer ? 1 : 2 + Math.floor(rnd()*3);
      for(let k = 0; k < nb; k++) poser(x + (rnd() - 0.5)*(40 + k*50), y + (rnd() - 0.5)*(40 + k*50), (rnd() - 0.5)*1.2);
    }
    // Épaves de voitures au bord des routes hors carte
    let n = 0;
    for(const rt of RTES) for(const [x0, y0, a] of echantillonner(rt, 180)){
      if(horsCarte(x0, y0) < 120 || rnd() > 0.35 || n > 8) continue;
      const sd = rnd() < 0.5 ? -1 : 1, x = x0 - Math.sin(a)*sd*34, y = y0 + Math.cos(a)*sd*34;
      if(ecartRiviere(x, y) < 20 || y > coteF(x) - 30) continue;
      n++;
      const r = -a + (rnd() - 0.5)*0.8, h0 = hSol(x, y) - 0.5, c = Math.cos(r), s = Math.sin(r);
      F.boite(18, 5, 8.5, x, h0 + 1.2, y, '#6b4a35', r);
      F.boite(9, 3.6, 7.6, x - c*1.5, h0 + 6.2, y + s*1.5, '#5a4f48', r);
      F.boite(8.6, 0.4, 8, x - c*1.5, h0 + 9.8, y + s*1.5, '#4a3628', r);
      for(const [lx, lz] of [[-6, 4.5], [6, 4.5], [-6, -4.5], [6, -4.5]])
        F.boite(3, 3, 1.2, x + lx*c + lz*s, h0, y - lx*s + lz*c, '#26221f', r);
    }
    if(F.vide()) return null;
    const m = new THREE.Mesh(F.geometrie(), new THREE.MeshStandardMaterial({vertexColors:true, roughness:0.85, metalness:0}));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // =================================================================
  //  8. STRUCTURES NEUTRES ET PONTS
  // =================================================================
  // Fusions partagées par toutes les structures : opaque, vitrages, feux clignotants,
  // lumières fixes, flammes. HALOS : [x, y, z, intensité] des sources lumineuses.
  const FS = {O:null, V:null, L:null, F:null, Fl:null};
  let HALOS = [], ROCS_PHARES = [], PHARES = [];
  const BETON = '#b4b0a6', BETON_F = '#8f8b82', ACIER = '#6c7478', SOMBRE = '#3b3f42', GRIS_F = '#8e9497', BLANC = '#cfccc4';

  // Lampadaire : mât, crosse, lampe ; halo le soir.
  function lampadaire(x, z, y0, h, rot){
    h = h || 13;
    FS.O.cyl(0.35, 0.5, h, x, y0, z, ACIER, 5);
    const dx = Math.cos(rot || 0)*1.6, dz = -Math.sin(rot || 0)*1.6;
    FS.O.boite(3.5, 0.7, 1.2, x + dx, y0 + h, z + dz, ACIER, rot || 0);
    FS.F.boite(2.6, 0.3, 1.0, x + dx, y0 + h - 0.25, z + dz, '#fff3c8', rot || 0);
    HALOS.push([x + dx, y0 + h - 1, z + dz, 1]);
  }
  // Toit à deux pans, faîtage selon l'axe local X ; pignons fermés.
  function toit2pans(F, cx, cz, l, p, y0, hf, coul, ry, coulPignon){
    const c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    const P = (lx, y, lz) => [cx + lx*c + lz*s, y, cz - lx*s + lz*c];
    const a1 = P(-l/2, y0, p/2), a2 = P(l/2, y0, p/2), f1 = P(-l/2, y0 + hf, 0), f2 = P(l/2, y0 + hf, 0), b1 = P(-l/2, y0, -p/2), b2 = P(l/2, y0, -p/2);
    F.quad2(a1, a2, f2, f1, coul); F.quad2(b2, b1, f1, f2, coul);
    F.tri(a1, f1, b1, coulPignon || coul); F.tri(a1, b1, f1, coulPignon || coul);
    F.tri(a2, b2, f2, coulPignon || coul); F.tri(a2, f2, b2, coulPignon || coul);
  }
  // Toit cintré (demi-cylindre) d'axe local X.
  function toitCintre(F, cx, y0, cz, l, r, coul, ry){
    _m.compose(_p.set(cx, y0, cz), _q.setFromEuler(_e.set(0, ry || 0, Math.PI/2, 'YXZ')), _s.set(r, l, r));
    F.geo(geoBase('demiCyl', () => new THREE.CylinderGeometry(1, 1, 1, 14, 1, true, 0, Math.PI)), _m, coul, false);
  }

  // ---------- Usine de dessalement (modèle de Port-Calmes, centré dans son rectangle) ----------
  function creerUsine(U){
    const O = FS.O, V = FS.V, Lm = FS.L, Lf = FS.F;
    // Le modèle est écrit dans les coordonnées de Port-Calmes (centre 1600, 1720) puis décalé.
    const dx = U.x + U.l/2 - 1600, dz = U.y + U.h/2 - 1720;
    const debuts = [O.pos.length, V.pos.length, Lm.pos.length, Lf.pos.length], h0 = HALOS.length;
    const coteL = x => coteF(x + dx) - dz;
    const u0 = {x:1470, y:1655, l:260, h:130};
    const y0 = 0.4;
    const GRIS = '#bfc3c4', METAL = '#9aa2a6', SARCELLE = '#3e8a86';
    O.boite(u0.l + 12, 1.2, u0.h + 12, u0.x + u0.l/2, y0 - 1, u0.y + u0.h/2, BETON);
    // --- Hall d'osmose inverse ---
    const hx0 = 1478, hx1 = 1598, hz0 = 1663, hz1 = 1722, hh = 22;
    O.boite(hx1 - hx0, hh, hz1 - hz0, (hx0 + hx1)/2, y0, (hz0 + hz1)/2, BLANC);
    for(let x = hx0 + 6; x < hx1; x += 10){
      O.boite(1.4, hh - 1, 1.2, x, y0, hz1 + 0.4, GRIS);
      O.boite(1.4, hh - 1, 1.2, x, y0, hz0 - 0.4, GRIS);
    }
    V.boite(hx1 - hx0 - 4, 3.4, 0.8, (hx0 + hx1)/2, y0 + 14, hz1 + 0.6);
    V.boite(hx1 - hx0 - 4, 3.4, 0.8, (hx0 + hx1)/2, y0 + 14, hz0 - 0.6);
    O.boite(hx1 - hx0 + 1, 1.6, hz1 - hz0 + 1, (hx0 + hx1)/2, y0 + hh, (hz0 + hz1)/2, '#a7abab');
    O.boite(hx1 - hx0 + 1.2, 2.2, 1.4, (hx0 + hx1)/2, y0 + hh - 3, hz1 + 0.8, SARCELLE);
    for(let k = 0; k < 4; k++){
      const x = hx0 + 16 + k*28;
      O.boite(12, 4, 8, x, y0 + hh + 1.6, hz0 + 16, METAL);
      O.cyl(2.6, 2.6, 0.6, x - 2.8, y0 + hh + 5.6, hz0 + 16, SOMBRE, 10);
      O.cyl(2.6, 2.6, 0.6, x + 2.8, y0 + hh + 5.6, hz0 + 16, SOMBRE, 10);
    }
    for(let k = 0; k < 5; k++) V.boite(16, 0.6, 9, hx0 + 14 + k*23, y0 + hh + 1.9, hz1 - 10);
    for(const x of [hx0 + 20, hx0 + 50]) O.boite(12, 11, 0.8, x, y0, hz1 + 0.9, '#7f878b');
    // --- Bâtiment de commande (vitré) ---
    const bx0 = 1478, bx1 = 1530, bz0 = 1732, bz1 = 1778;
    O.boite(bx1 - bx0, 13, bz1 - bz0, (bx0 + bx1)/2, y0, (bz0 + bz1)/2, '#c6c5bd');
    (A.lumieres >= 0.6 ? Lf : V).boite(bx1 - bx0 - 6, 8, 0.8, (bx0 + bx1)/2, y0 + 3, bz1 + 0.5, A.lumieres >= 0.6 ? '#ffd9a0' : undefined);
    V.boite(0.8, 8, bz1 - bz0 - 8, bx1 + 0.5, y0 + 3, (bz0 + bz1)/2);
    O.boite(bx1 - bx0 + 2, 1.4, bz1 - bz0 + 2, (bx0 + bx1)/2, y0 + 13, (bz0 + bz1)/2, '#a9aba8');
    O.boite(bx1 - bx0 + 4, 0.8, 8, (bx0 + bx1)/2, y0 + 10.5, bz1 + 4, '#cfd0cc');
    O.cyl(0.4, 0.5, 18, bx0 + 8, y0 + 14, bz0 + 8, METAL, 5);
    O.boite(6, 0.4, 6, bx0 + 8, y0 + 30, bz0 + 8, METAL);
    // --- Station de pompage ---
    O.boite(56, 10, 36, 1571, y0, 1760, '#bcbfbe');
    O.boite(57, 1.2, 37, 1571, y0 + 10, 1760, '#a0a3a3');
    for(let k = 0; k < 3; k++) V.boite(8, 3, 0.6, 1552 + k*18, y0 + 5, 1778.4);
    // --- Grands réservoirs d'eau produite ---
    for(const [x, z, r, h] of [[1634, 1694, 22, 26], [1682, 1694, 22, 26], [1716, 1671, 12, 20]]){
      O.cyl(r, r, h, x, y0, z, BLANC, 28);
      O.cyl(r + 0.4, r + 0.4, 1.6, x, y0 + h*0.62, z, SARCELLE, 28);
      O.cyl(r*0.25, r + 0.3, 3.5, x, y0 + h, z, '#bfc1bf', 28);
      O.cyl(r + 0.6, r + 0.6, 0.6, x, y0 + h - 0.2, z, GRIS, 28);
      for(let k = 0; k < 10; k++){
        const a = 2.2 + k*0.16, rr = r + 0.8;
        O.boite(3, 0.4, 1.2, x + Math.cos(a)*rr, y0 + 2 + k*(h - 3)/10, z + Math.sin(a)*rr, GRIS_F, -a + Math.PI/2);
      }
      Lm.sphere(0.9, x, y0 + h + 3.8, z, '#ff3b2f');
    }
    // --- Bassins de filtration (eau visible) ---
    for(let k = 0; k < 4; k++){
      const x = 1622 + k*28, z = 1748;
      O.boite(27, 3, 26, x, y0, z, BETON);
      O.boite(23, 0.5, 22, x, y0 + 2.6, z, '#2f7b84');
    }
    // --- Cuves sous pression ---
    for(let k = 0; k < 5; k++){
      const x = 1618 + k*22;
      O.cyl(3.6, 3.6, 13, x, y0, 1768, '#dfe2e2', 12);
      O.sphere(3.6, x, y0 + 13, 1768, '#dfe2e2', 0.6);
      O.tube([x, y0 + 4, 1764], [x, y0 + 4, 1752], 0.7, METAL, 6);
    }
    for(let k = 0; k < 3; k++) O.tube([1606, y0 + 2 + k*2.6, 1719], [1660, y0 + 2 + k*2.6, 1719], 1.1, '#e8eaea', 10);
    // --- Rack de tuyauteries ---
    for(let x = 1532; x <= 1724; x += 16){
      O.boite(0.8, 9, 0.8, x, y0, 1724, ACIER); O.boite(0.8, 9, 0.8, x, y0, 1730, ACIER);
      O.boite(0.8, 0.8, 7, x, y0 + 8.6, 1727, ACIER);
    }
    O.tube([1530, y0 + 10.2, 1725.5], [1726, y0 + 10.2, 1725.5], 1.3, '#4f86a0', 8);
    O.tube([1530, y0 + 10.2, 1728.5], [1726, y0 + 10.2, 1728.5], 1.1, '#d9d9d2', 8);
    O.tube([1530, y0 + 12.4, 1727], [1726, y0 + 12.4, 1727], 0.8, '#8c6a4a', 8);
    // --- Clôture périphérique ---
    const cl = [[u0.x + 2, u0.y + 2], [u0.x + u0.l - 2, u0.y + 2], [u0.x + u0.l - 2, u0.y + u0.h - 2], [u0.x + 2, u0.y + u0.h - 2], [u0.x + 2, u0.y + 2]];
    for(let s = 0; s < 4; s++){
      const [ax, az] = cl[s], [bx, bz] = cl[s + 1], L = Math.hypot(bx - ax, bz - az), n = Math.round(L/12);
      for(let k = 0; k <= n; k++){
        const t = k/n, x = ax + (bx - ax)*t, z = az + (bz - az)*t;
        if(s === 0 && Math.abs(x - 1600) < 14) continue;
        O.cyl(0.35, 0.35, 8, x, y0, z, GRIS_F, 4);
      }
      const segs = s === 0 ? [[ax, 1586], [1614, bx]] : [[0, 1]];
      for(const sg of segs){
        const p0 = s === 0 ? [sg[0], az] : [ax, az], p1 = s === 0 ? [sg[1], bz] : [bx, bz];
        for(const hy of [2.2, 5, 7.8]) O.tube([p0[0], y0 + hy, p0[1]], [p1[0], y0 + hy, p1[1]], 0.18, GRIS_F, 3);
      }
    }
    O.boite(1.2, 9, 1.2, 1586, y0, u0.y + 2, SARCELLE); O.boite(1.2, 9, 1.2, 1614, y0, u0.y + 2, SARCELLE);
    O.boite(30, 1.2, 1.4, 1600, y0 + 8, u0.y + 2, SARCELLE);
    // --- Lampadaires dans l'enceinte ---
    for(const [x, z] of [[1540, 1730], [1606, 1662], [1606, 1782], [1726, 1782], [1726, 1662]]) lampadaire(x, z, y0, 15, 0);
    // --- Côté mer : conduites, quais sur pilotis, prise d'eau, grue, pétrolier ---
    const cw = coteL(1505), ce = coteL(1690);
    if(isFinite(cw) && isFinite(ce) && cw < u0.y + 700 && ce < u0.y + 700){
      for(const [x, z0, z1, r] of [[1500, 1786, cw + 30, 1.8], [1510, 1786, cw + 30, 1.4], [1686, 1786, ce + 20, 1.8], [1695, 1786, ce + 20, 1.4]]){
        O.tube([x, y0 + r + 0.3, z0], [x, y0 + r + 0.3, z1], r, x < 1600 ? '#4f86a0' : '#c9cbc6', 10);
        for(let z = z0 + 6; z < z1; z += 14) O.boite(r*2.8, 0.8, 1.6, x, y0 - 0.2, z, BETON);
      }
      const finO = cw + 197, finE = ce + 190;
      for(const [qx, z0, z1, w] of [[1505, cw - 14, finO, 24], [1690, ce - 14, finE, 24]]){
        const deck = 2.2;
        O.boite(w, 1.6, z1 - z0, qx, deck - 1.6, (z0 + z1)/2, '#9d998f');
        O.boite(w + 0.6, 0.5, z1 - z0, qx, deck - 1.8, (z0 + z1)/2, '#7d7a72');
        for(let z = z0 + 12; z < z1; z += 20) for(const s of [-1, 1]) O.cyl(1.3, 1.3, 18, qx + s*(w/2 - 2), deck - 19.6, z, '#6f6a60', 8);
        for(let z = z0 + 20; z < z1; z += 22) for(const s of [-1, 1]) O.cyl(0.8, 1.0, 1.6, qx + s*(w/2 - 1.2), deck, z, '#3c3f40', 8);
        for(let z = z0 + 30; z < z1; z += 48){
          O.cyl(0.3, 0.4, 13, qx - w/2 + 1, deck, z, ACIER, 5);
          Lf.boite(2.4, 0.3, 1.0, qx - w/2 + 2, deck + 12.8, z, '#fff3c8');
          HALOS.push([qx - w/2 + 2, deck + 12, z, 1]);
        }
        O.tube([qx + w/2 - 4, deck + 1.6, z0], [qx + w/2 - 4, deck + 1.6, z1 - 6], 1.2, '#4f86a0', 8);
      }
      O.boite(70, 1.6, 22, 1505, 0.6, finO - 5, '#9d998f');
      O.boite(22, 9, 22, 1505, 2.2, cw + 20, '#c8c8c0');
      O.boite(24, 1, 24, 1505, 11.2, cw + 20, '#a9aaa4');
      O.tube([1505, -4, cw + 31], [1505, -4, cw + 110], 2.4, '#3d6d80', 10);
      O.boite(10, 4, 10, 1505, -6, cw + 112, '#6a6a62');
      const gz = ce + 125, gx = 1696, gd = 2.2;
      O.boite(8, 3, 8, gx, gd, gz, '#c9a43a');
      O.boite(3.2, 26, 3.2, gx, gd + 3, gz, '#d1aa3c');
      O.boite(3.6, 4, 5, gx, gd + 28, gz, '#c9a43a');
      O.tube([gx, gd + 30, gz], [gx - 30, gd + 22, gz + 4], 1.0, '#d1aa3c', 4);
      O.tube([gx, gd + 30, gz], [gx + 8, gd + 30, gz], 1.2, '#7d7d78', 4);
      O.tube([gx - 28, gd + 22, gz + 4], [gx - 28, gd + 9, gz + 4], 0.15, SOMBRE, 3);
      Lm.sphere(0.8, gx, gd + 32.5, gz, '#ff3b2f');
      navire(1690 - 12 - 2 - 13, ce + 45, 130, 26, 1690 - 10.8);
    }
    // Palmiers de l'entrée (cases bloquées par l'usine)
    for(const [x, z] of [[1578, 1661], [1622, 1661], [1536, 1781]]) DECOR_SUPP.push({type:'palmier', x:x + dx, y:z + dz, s:1});
    // Décalage vers l'emplacement réel
    O.decaler(debuts[0], dx, dz); V.decaler(debuts[1], dx, dz); Lm.decaler(debuts[2], dx, dz); Lf.decaler(debuts[3], dx, dz);
    for(let i = h0; i < HALOS.length; i++){ HALOS[i][0] += dx; HALOS[i][2] += dz; }
  }
  // Coque effilée : boîte subdivisée resserrée à la proue (sud), arrondie à la poupe (nord).
  // quaiX : abscisse des bollards du quai (aussières).
  function navire(cx, z0, L, B, quaiX, coulCoque){
    const O = FS.O, V = FS.V, Lm = FS.L;
    const g = new THREE.BoxGeometry(B, 13, L, 2, 2, 16);
    const P = g.attributes.position;
    for(let i = 0; i < P.count; i++){
      let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const u = (z + L/2)/L;
      let w = 1;
      if(u > 0.72) w = Math.max(0.04, Math.cos((u - 0.72)/0.28*Math.PI/2));
      if(u < 0.08) w = 0.75 + 0.25*Math.sin(u/0.08*Math.PI/2);
      const bas = (y + 6.5)/13;
      w *= 0.72 + 0.28*Math.sqrt(bas);
      if(u > 0.85) y += (u - 0.85)*14*bas;
      P.setXYZ(i, x*w, y, z);
    }
    _m.compose(_p.set(cx, 1.5, z0 + L/2), _q.identity(), _s.set(1, 1, 1));
    const coque = lin(coulCoque || '#2f3638'), carene = lin('#5d2a24'), liseret = lin('#d8d8d0');
    O.geo(g, _m, (x, y) => y < 0.2 ? carene : (y > 6.2 && y < 6.9 ? liseret : coque), true);
    g.dispose();
    const pont = 8.0 + 1.5;
    O.boite(B*0.82, 0.4, L*0.66, cx, pont - 0.9, z0 + L*0.46, '#5f6b58');
    for(const ddx of [-4, 0, 4]) O.tube([cx + ddx, pont + 0.4, z0 + 28], [cx + ddx, pont + 0.4, z0 + L*0.82], 0.7, '#c8c2b0', 6);
    O.tube([cx - 7, pont + 2, z0 + 30], [cx - 7, pont + 2, z0 + L*0.8], 0.25, '#d8d8d0', 3);
    O.boite(B*0.7, 2.2, 3, cx, pont, z0 + L*0.5, '#8a8f88');
    O.boite(1.4, 9, 1.4, cx + 6, pont, z0 + L*0.5, '#b9a13a');
    O.tube([cx + 6, pont + 8, z0 + L*0.5], [cx - 6, pont + 6, z0 + L*0.5 + 10], 0.5, '#b9a13a', 4);
    O.boite(B*0.86, 7, 18, cx, pont - 0.8, z0 + 13, '#ecebe4');
    O.boite(B*0.74, 6, 14, cx, pont + 6.2, z0 + 12, '#ecebe4');
    O.boite(B + 4, 4.2, 8, cx, pont + 12.2, z0 + 15, '#e6e5de');
    V.boite(B + 3.4, 1.8, 0.5, cx, pont + 13.6, z0 + 19.1);
    V.boite(B*0.7, 1.5, 0.5, cx, pont + 2.4, z0 + 22.1);
    V.boite(B*0.6, 1.5, 0.5, cx, pont + 8.8, z0 + 19.1);
    O.boite(6, 9, 6, cx, pont + 12, z0 + 6, '#3a3d40');
    O.boite(6.2, 2, 6.2, cx, pont + 16.5, z0 + 6, '#d8d8d0');
    O.boite(6.3, 1.2, 6.3, cx, pont + 20, z0 + 6, '#1d1f20');
    O.cyl(0.25, 0.3, 10, cx, pont + 16.4, z0 + 15, '#d8d8d0', 4);
    O.boite(5, 0.5, 0.8, cx, pont + 25, z0 + 15, '#d8d8d0');
    Lm.sphere(0.6, cx, pont + 26.6, z0 + 15, '#fff3c8');
    O.cyl(0.25, 0.3, 9, cx, pont + 1, z0 + L - 10, '#d8d8d0', 4);
    Lm.sphere(0.5, cx, pont + 10.2, z0 + L - 10, '#fff3c8');
    HALOS.push([cx, pont + 14, z0 + 19, 0.6]);
    const sens = quaiX < cx ? -1 : 1;
    for(const dzz of [8, L*0.3, L*0.7, L - 8]) O.tube([cx + sens*B*0.45, pont, z0 + dzz], [quaiX, 3.8, z0 + dzz + (dzz < L/2 ? -10 : 10)], 0.2, '#ddd6c0', 3);
  }
  // Petit bateau de pêche (coque, timonerie, mât), à flot.
  function bateau(x, z, ry, rnd){
    const O = FS.O, c = Math.cos(ry), s = Math.sin(ry);
    const P = (lx, lz) => [x + lx*c + lz*s, z - lx*s + lz*c];
    const coul = ['#e8e4da', '#3e6f8a', '#b84a32', '#2f5a4a'][Math.floor(rnd()*4)];
    let [px, pz] = P(0, 0); O.boite(16, 3.2, 5.6, px, NIV_MER - 1.4, pz, coul, ry);
    [px, pz] = P(7.5, 0); O.boiteR(3.6, 3.2, 3.6, px, NIV_MER + 0.2, pz, coul, 0, ry + Math.PI/4, 0);
    [px, pz] = P(-2, 0); O.boite(5, 4, 4.2, px, NIV_MER + 1.8, pz, '#ecebe4', ry);
    FS.V.boite(5.2, 1.2, 4.4, px, NIV_MER + 4, pz, undefined, ry);
    [px, pz] = P(3, 0); O.cyl(0.2, 0.25, 10, px, NIV_MER + 1.8, pz, '#d8d8d0', 4);
  }

  // ---------- Village : îlots de maisons mitoyennes, ruelles, place, église, château d'eau ----------
  function creerVillage(S, rnd){
    const ilots = [];
    const decouper = (x0, z0, x1, z1, prof) => {
      const l = x1 - x0, p = z1 - z0;
      if(prof > 5 || Math.min(l, p) < 44 || (l*p < 4800 && Math.max(l, p) < 120)){ ilots.push([x0, z0, x1, z1]); return; }
      const ru = 9 + rnd()*5;
      if(l >= p){ const c = x0 + l*(0.38 + rnd()*0.24); decouper(x0, z0, c - ru/2, z1, prof + 1); decouper(c + ru/2, z0, x1, z1, prof + 1); }
      else { const c = z0 + p*(0.38 + rnd()*0.24); decouper(x0, z0, x1, c - ru/2, prof + 1); decouper(x0, c + ru/2, x1, z1, prof + 1); }
    };
    decouper(S.x + 6, S.y + 6, S.x + S.l - 6, S.y + S.h - 6, 0);
    const cx = S.x + S.l/2, cz = S.y + S.h/2, aire = S.l*S.h;
    // La place : l'îlot le plus central ; l'église : un grand îlot voisin ; le château d'eau : un îlot de bord.
    const dC = b => Math.hypot((b[0] + b[2])/2 - cx, (b[1] + b[3])/2 - cz);
    ilots.sort((a, b) => dC(a) - dC(b));
    const place = ilots.length >= 4 ? ilots[0] : null;
    let eglise = null, chateau = null;
    if(ilots.length >= 6 && aire > 30000) eglise = ilots.slice(1).find(b => b[2] - b[0] >= 40 && b[3] - b[1] >= 40) || null;
    if(aire > 24000) chateau = ilots[ilots.length - 1] !== eglise ? ilots[ilots.length - 1] : null;
    const y0 = hSol(cx, cz);
    for(const b of ilots){
      const [x0, z0, x1, z1] = b, l = x1 - x0, p = z1 - z0;
      if(b === place){
        // Place pavée : fontaine-lavoir, olivier, bancs, lampadaires, voitures garées
        FS.O.boite(l, 0.5, p, (x0 + x1)/2, y0, (z0 + z1)/2, '#bdb3a0');
        const fx = (x0 + x1)/2, fz = (z0 + z1)/2;
        FS.O.cyl(6, 6.4, 2.2, fx, y0 + 0.5, fz, '#cbbfa8', 16);
        FS.O.cyl(1, 1.2, 4.5, fx, y0 + 0.5, fz, '#b8ad98', 8);
        bassinEau(fx - 5.2, fz - 5.2, fx + 5.2, fz + 5.2, y0 + 2.4);
        DECOR_SUPP.push({type:'olivier', x:x0 + 8, y:z0 + 8, s:1.0});
        if(l > 40) DECOR_SUPP.push({type:'olivier', x:x1 - 8, y:z1 - 8, s:0.9});
        FS.O.boite(7, 1.4, 1.6, fx, y0 + 0.5, z1 - 4, '#7a6a52'); FS.O.boite(7, 1.4, 1.6, fx, y0 + 0.5, z0 + 4, '#7a6a52');
        lampadaire(x0 + 3, z1 - 3, y0, 9, 0); lampadaire(x1 - 3, z0 + 3, y0, 9, Math.PI);
        if(l > 46) voiture(x1 - 10, (z0 + z1)/2, Math.PI/2, y0 + 0.5, rnd);
        continue;
      }
      if(b === eglise){
        // Église : nef, chevet, clocher à flèche, parvis
        const nl = Math.min(l - 6, 56), np = Math.min(p - 10, 24), ex = (x0 + x1)/2, ez = (z0 + z1)/2;
        FS.O.boite(nl, 15, np, ex, y0, ez, '#e2d6bf');
        toit2pans(FS.O, ex, ez, nl + 1, np + 2, y0 + 15, 7, '#a5583a', 0, '#e2d6bf');
        FS.O.cyl(np/2 - 1, np/2 - 1, 13, ex + nl/2, y0, ez, '#e2d6bf', 12);
        FS.O.boite(9, 26, 9, ex - nl/2 + 4.5, y0, ez - np/2 + 1, '#ddd0b6');
        FS.O.boite(9.6, 1, 9.6, ex - nl/2 + 4.5, y0 + 26, ez - np/2 + 1, '#cbbfa6');
        FS.O.boite(3.2, 4.5, 9.8, ex - nl/2 + 4.5, y0 + 20, ez - np/2 + 1, '#2a2622');
        _m.compose(_p.set(ex - nl/2 + 4.5, y0 + 31.5, ez - np/2 + 1), _q.setFromEuler(_e.set(0, Math.PI/4, 0)), _s.set(6.6, 10, 6.6));
        FS.O.geo(geoBase('toit', () => new THREE.ConeGeometry(1, 1, 4, 1)), _m, '#a5583a', true);
        for(let k = 0; k < 3; k++) FS.V.boite(2.4, 6, 0.6, ex - nl/4 + k*nl/4, y0 + 6, ez + np/2 + 0.3);
        FS.O.boite(4.5, 8, 0.8, ex - nl/2 - 0.2, y0, ez + 2, '#5a4030', Math.PI/2);
        continue;
      }
      if(b === chateau){
        // Château d'eau de la Régie (béton, cuve évasée, liseré bleu)
        const tx = (x0 + x1)/2, tz = (z0 + z1)/2;
        FS.O.cyl(3.2, 3.6, 24, tx, y0, tz, '#c9c4b8', 12);
        FS.O.cyl(9, 4, 6, tx, y0 + 24, tz, '#d8d4ca', 18);
        FS.O.cyl(9, 9, 6, tx, y0 + 30, tz, '#dedad0', 18);
        FS.O.cyl(9.2, 9.2, 1.4, tx, y0 + 33, tz, '#3e7ea0', 18);
        FS.O.cyl(5, 9.2, 2, tx, y0 + 36, tz, '#c8c4ba', 18);
        FS.L.sphere(0.7, tx, y0 + 39, tz, '#ff3b2f');
        for(let k = 0; k < l*p/900; k++) DECOR_SUPP.push({type:'arbuste', x:x0 + 4 + rnd()*(l - 8), y:z0 + 4 + rnd()*(p - 8), s:0.6 + rnd()*0.5});
        continue;
      }
      // Îlot ordinaire : maisons mitoyennes le long de l'axe long, en une ou deux rangées.
      const enX = l >= p, long = enX ? l : p, court = enX ? p : l;
      const rangs = court > 64 ? 2 : 1;
      for(let rg = 0; rg < rangs; rg++){
        let pos = 0, garde = 0;
        // Garde : au plus 400 maisons par rangée (une longueur aberrante ne peut pas figer la page).
        while(pos < long - 8 && garde++ < 400){
          const lg = Math.max(1, Math.min(long - pos, 22 + rnd()*20)), pr = court/rangs - (rangs === 2 ? 0 : 0);
          const ux = enX ? x0 + pos + lg/2 : x0 + (rg + 0.5)*court/rangs;
          const uz = enX ? z0 + (rg + 0.5)*court/rangs : z0 + pos + lg/2;
          const L2 = enX ? lg : pr, P2 = enX ? pr : lg;
          if(rnd() < 0.08 && long > 60){
            // Cour intérieure avec arbre
            FS.O.boite(L2, 2.6, 1.2, ux, y0, uz + P2/2 - 0.6, MURS[0]);
            DECOR_SUPP.push({type:rnd() < 0.5 ? 'olivier' : 'palmier', x:ux, y:uz, s:0.75});
          } else {
            maison(FS.O, ux, uz, 0, rnd, {l:L2 - 0.4, p:P2 - 0.4, h0:y0 - 3, quatre:true, muret:false});
          }
          pos += lg;
        }
      }
    }
    // Lampadaires aux carrefours des ruelles
    for(let k = 0; k < Math.min(10, ilots.length); k++){
      const b = ilots[Math.floor(rnd()*ilots.length)];
      lampadaire(b[0] - 3, b[1] - 3, y0, 9, rnd()*6);
    }
  }
  function voiture(x, z, ry, y0, rnd){
    const O = FS.O, c = Math.cos(ry), s = Math.sin(ry);
    const coul = ['#8a2e28', '#d8d6cf', '#3b4d63', '#5b6b4a', '#2b2b2b'][Math.floor(rnd()*5)];
    O.boite(14, 3.6, 6.6, x, y0 + 1.2, z, coul, ry);
    O.boite(7.6, 2.8, 6.2, x - c*1, y0 + 4.8, z + s*1, coul, ry);
    FS.V.boite(7.8, 2, 6.3, x - c*1, y0 + 5.1, z + s*1, undefined, ry);
    for(const [lx, lz] of [[-4.6, 3.4], [4.6, 3.4], [-4.6, -3.4], [4.6, -3.4]]) O.boite(3, 2.6, 1, x + lx*c + lz*s, y0, z - lx*s + lz*c, '#1e1c1a', ry);
  }
  // Petit bassin d'eau dormante (fontaine, lavoir, retenue).
  function bassinEau(x0, z0, x1, z1, y){
    const f = EAU.f, l = x1 - x0, p = z1 - z0;
    f.quad([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], [[0, -p/2], [0, p/2], [l, p/2], [l, -p/2]], 0, 1e4, 1, 0);
  }

  // ---------- Port : quais, môles, grues, entrepôts, conteneurs, navires ----------
  function creerPort(S, rnd){
    const O = FS.O, x0 = S.x, x1 = S.x + S.l, z0 = S.y, z1 = S.y + S.h;
    let cMoy = 0, n = 0;
    for(let x = x0; x <= x1; x += 10){ cMoy += Math.min(coteF(x), 1e6); n++; }
    cMoy /= n;
    const aMer = M.mer && cMoy < z1 - 20;
    const finTerre = x => aMer ? Math.min(z1, coteF(x) - 14) : z1;
    const y0 = 0.4, deck = 2.2;
    // Dalle sur la partie terrestre (colonnes de 20 px qui suivent le rivage)
    for(let x = x0; x < x1; x += 20){
      const zf = finTerre(x + 10);
      if(zf > z0 + 4) O.boite(20.5, 1.2, zf - z0, x + 10, y0 - 1, (z0 + zf)/2, '#a7a398');
    }
    if(aMer){
      // Quai le long du rivage, sur pilotis, avec bollards et bordure jaune
      for(let x = x0; x < x1; x += 20){
        const c = coteF(x + 10), a = c - 22, b = Math.min(c + 16, z1);
        if(b <= a) continue;
        O.boite(20.5, 2.2, b - a, x + 10, deck - 2.2, (a + b)/2, '#9d998f');
        O.boite(20.5, 0.3, 1.2, x + 10, deck, b - 0.6, '#d4aa3a');
        O.cyl(0.8, 1.0, 1.6, x + 10, deck, b - 2.5, '#3c3f40', 8);
        for(const zz of [a + 8, b - 4]) O.cyl(1.2, 1.2, 16, x + 10, deck - 17.8, zz, '#6f6a60', 8);
      }
      // Môles : un ou deux, perpendiculaires au rivage
      const moles = S.l > 220 ? [x0 + S.l*0.28, x0 + S.l*0.74] : [x0 + S.l*0.5];
      moles.forEach((mx, k) => {
        const a = coteF(mx) + 10, b = z1 - 4, w = 24;
        if(b - a < 40) return;
        O.boite(w, 2.2, b - a, mx, deck - 2.2, (a + b)/2, '#9d998f');
        O.boite(w + 0.6, 0.6, b - a, mx, deck - 2.6, (a + b)/2, '#7d7a72');
        for(let z = a + 10; z < b; z += 20) for(const s of [-1, 1]) O.cyl(1.2, 1.2, 18, mx + s*(w/2 - 2), deck - 19.6, z, '#6f6a60', 8);
        for(let z = a + 14; z < b; z += 22) for(const s of [-1, 1]) O.cyl(0.8, 1.0, 1.6, mx + s*(w/2 - 1.2), deck, z, '#3c3f40', 8);
        for(let z = a + 30; z < b; z += 50) lampadaire(mx - w/2 + 1.5, z, deck, 12, Math.PI);
        FS.L.sphere(0.7, mx, deck + 5, b - 2, k ? '#3cff6a' : '#ff3b2f');
        O.cyl(0.8, 1, 5, mx, deck, b - 2, '#e8e4da', 8);
        // Navire de charge ou bateaux de pêche le long du môle
        const Ln = Math.min(140, b - a - 16);
        if(k === 0 && Ln >= 70){
          const B = 24, cxn = mx + w/2 + 2 + B/2;
          if(cxn + B/2 < x1 + 60) navire(cxn, a + 10, Ln, B, mx + w/2 - 1.2, '#3a4a5a');
          else navire(mx - w/2 - 2 - B/2, a + 10, Ln, B, mx - w/2 + 1.2, '#3a4a5a');
        } else {
          for(let z = a + 20; z < b - 10; z += 24) if(rnd() < 0.7) bateau(mx + (rnd() < 0.5 ? -1 : 1)*(w/2 + 5), z, Math.PI/2 + (rnd() - 0.5)*0.2, rnd);
        }
      });
      // Portique à conteneurs à cheval sur le quai
      const gx = x0 + S.l*0.5 + (moles.length === 1 ? 50 : 0), gc = coteF(gx);
      if(gc > z0 + 40 && gc < z1 + 30){
        const jaune = '#d39a2c';
        for(const [lx, lz] of [[-9, -18], [9, -18], [-9, 8], [9, 8]]) O.boite(2.4, 34, 2.4, gx + lx, deck, gc + lz, jaune);
        O.boite(22, 3, 3, gx, deck + 34, gc - 18, jaune); O.boite(22, 3, 3, gx, deck + 34, gc + 8, jaune);
        O.boite(3, 3, 70, gx - 9, deck + 37, gc + 4, jaune); O.boite(3, 3, 70, gx + 9, deck + 37, gc + 4, jaune);
        O.boite(6, 5, 6, gx, deck + 30, gc + 14, '#e8e4da');
        O.boite(20, 6, 10, gx, deck + 40, gc - 22, '#c7c2b4');
        O.tube([gx, deck + 37, gc + 14], [gx, deck + 18, gc + 14], 0.2, SOMBRE, 3);
        FS.L.sphere(0.8, gx, deck + 47, gc - 22, '#ff3b2f');
      }
    }
    // Entrepôts sur l'arrière-port
    const profTerre = (aMer ? Math.min(cMoy, z1) : z1) - z0;
    const nE = Math.max(1, Math.floor(S.l/95));
    for(let k = 0; k < nE; k++){
      const ex = x0 + (k + 0.5)*S.l/nE, el = Math.min(S.l/nE - 12, 78), ep = Math.min(40, profTerre*0.38);
      if(ep < 16) break;
      const ez = z0 + 6 + ep/2, eh = 12 + rnd()*4;
      O.boite(el, eh, ep, ex, y0, ez, k % 2 ? '#b9b4a8' : '#a9b0b2');
      toit2pans(O, ex, ez, el + 1, ep + 1.5, y0 + eh, 5, '#8c9294', 0, k % 2 ? '#b9b4a8' : '#a9b0b2');
      for(let d = -el/2 + 10; d < el/2 - 6; d += 16) O.boite(9, 9, 0.6, ex + d, y0, ez + ep/2 + 0.3, '#6f777b');
      O.boite(el + 0.4, 1.2, 0.8, ex, y0 + eh - 2.5, ez + ep/2 + 0.3, '#3e7ea0');
      lampadaire(ex - el/2 + 3, ez + ep/2 + 4, y0, 10, 0);
    }
    // Conteneurs empilés entre entrepôts et quai
    const zc0 = z0 + 10 + Math.min(40, profTerre*0.38), zc1 = (aMer ? cMoy - 30 : z1 - 8);
    const couls = ['#94503c', '#46677a', '#a68a4c', '#5a6e52', '#8a8f92', '#b4b2ac', '#6e5058', '#7a4a36'];   // teintes délavées par le sel
    for(let z = zc0 + 4; z < zc1 - 8; z += 9){
      for(let x = x0 + 14; x < x1 - 28; x += 32){
        if(rnd() < 0.3) continue;
        const nb = 1 + Math.floor(rnd()*3);
        for(let e = 0; e < nb; e++) O.boite(26, 5.6, 7.4, x + 13, y0 + e*5.8, z, couls[Math.floor(rnd()*couls.length)]);
      }
    }
    // Bureaux de la capitainerie et mâts d'éclairage
    O.boite(22, 9, 14, x1 - 16, y0, z0 + 12, '#d8d4ca');
    FS.V.boite(18, 2.6, 0.6, x1 - 16, y0 + 5, z0 + 19.2);
    O.boite(23, 0.8, 15, x1 - 16, y0 + 9, z0 + 12, '#a9aba8');
    for(let k = 0; k < 3; k++){
      const mx = x0 + 20 + k*(S.l - 40)/2, mz = (zc0 + zc1)/2;
      O.cyl(0.6, 0.9, 24, mx, y0, mz, ACIER, 6);
      for(const d of [-2, 0, 2]){ FS.F.boite(1.6, 1.2, 0.6, mx + d, y0 + 24, mz, '#fff3c8'); }
      HALOS.push([mx, y0 + 23, mz, 1.4]);
    }
  }

  // ---------- Raffinerie : parc de cuves, unité de distillation, torchère ----------
  function creerRaffinerie(S, rnd){
    const O = FS.O, x0 = S.x, x1 = S.x + S.l, z0 = S.y, z1 = S.y + S.h, y0 = hSol(S.x + S.l/2, S.y + S.h/2) + 0.2;
    O.boite(S.l + 8, 0.8, S.h + 8, (x0 + x1)/2, y0 - 0.8, (z0 + z1)/2, '#a8a49a');
    // Parc de cuves (partie ouest), dans une cuvette de rétention
    const xa1 = x0 + S.l*0.55;
    const rT = clamp(Math.min(xa1 - x0, S.h)/5.2, 9, 22);
    const pasT = rT*2.5;
    const nx = Math.max(1, Math.floor((xa1 - x0 - 8)/pasT)), nz = Math.max(1, Math.floor((S.h - 8)/pasT));
    const ox = x0 + 4 + (xa1 - x0 - 8 - nx*pasT)/2, oz = z0 + 4 + (S.h - 8 - nz*pasT)/2;
    for(let i = 0; i < nx; i++) for(let j = 0; j < nz; j++){
      const cx = ox + (i + 0.5)*pasT, cz = oz + (j + 0.5)*pasT, r = rT*(0.82 + rnd()*0.18), h = 12 + rnd()*8;
      const coul = rnd() < 0.7 ? '#dcdcd6' : '#c9c2b0';
      O.cyl(r, r, h, cx, y0, cz, coul, 24);
      O.cyl(r - 0.6, r - 0.6, 0.6, cx, y0 + h - 1.2, cz, '#9ea2a2', 24);       // toit flottant
      O.cyl(r + 0.4, r + 0.4, 0.5, cx, y0 + h, cz, GRIS_F, 24);                   // garde-corps
      O.cyl(r + 0.25, r + 0.25, 1.2, cx, y0 + h*0.3, cz, '#3e7ea0', 24);
      for(let k = 0; k < 8; k++){ const a = 0.6 + k*0.2; O.boite(2.6, 0.4, 1.1, cx + Math.cos(a)*(r + 0.8), y0 + 1.5 + k*(h - 2)/8, cz + Math.sin(a)*(r + 0.8), GRIS_F, -a + Math.PI/2); }
      O.tube([cx + r, y0 + 2, cz], [xa1 + 4, y0 + 2, cz], 0.9, '#7a7a74', 6);
    }
    // Murets de rétention
    for(const [l, p, x, z] of [[xa1 - x0, 1.4, (x0 + xa1)/2, z0 + 1], [xa1 - x0, 1.4, (x0 + xa1)/2, z1 - 1], [1.4, S.h, x0 + 1, (z0 + z1)/2], [1.4, S.h, xa1, (z0 + z1)/2]])
      O.boite(l, 2.4, p, x, y0, z, BETON_F);
    // Unité de distillation (partie est)
    const xb = xa1 + 10, lb = x1 - xb - 6, zm = (z0 + z1)/2;
    const colonnes = [[xb + lb*0.2, zm - S.h*0.12, 4.2, 52], [xb + lb*0.38, zm - S.h*0.16, 3.4, 40], [xb + lb*0.3, zm + S.h*0.12, 5, 34]];
    for(const [cx, cz, r, h] of colonnes){
      O.cyl(r, r, h, cx, y0, cz, '#c8ccce', 14);
      O.sphere(r, cx, y0 + h, cz, '#c8ccce', 0.5);
      for(let yy = 10; yy < h; yy += 11){
        O.cyl(r + 2.2, r + 2.2, 0.5, cx, y0 + yy, cz, GRIS_F, 14);
        if(A.lumieres > 0){ FS.F.boite(0.8, 0.8, 0.8, cx + r + 2, y0 + yy + 1, cz, '#ffd890'); HALOS.push([cx + r + 2, y0 + yy + 1, cz, 0.35]); }
      }
      O.boite(0.8, h, 1.6, cx - r - 0.8, y0, cz, GRIS_F);
    }
    // Four et cheminées
    const fx = xb + lb*0.7, fz = zm + S.h*0.15;
    O.boite(18, 14, 12, fx, y0, fz, '#8c6a52');
    for(const d of [-5, 5]){
      O.cyl(1.6, 1.9, 36, fx + d, y0 + 14, fz, '#d8d8d2', 10);
      O.cyl(1.7, 1.7, 2, fx + d, y0 + 44, fz, '#b8432f', 10);
      FS.L.sphere(0.6, fx + d, y0 + 50.5, fz, '#ff3b2f');
    }
    // Échangeurs (cylindres horizontaux) et sphère de gaz
    for(let k = 0; k < 4; k++){ const ex = xb + lb*0.55, ez = z0 + 12 + k*7; O.tube([ex - 8, y0 + 3.5, ez], [ex + 8, y0 + 3.5, ez], 2.6, '#bfc4c6', 10); O.boite(1.2, 2.4, 4, ex - 5, y0, ez, GRIS_F); O.boite(1.2, 2.4, 4, ex + 5, y0, ez, GRIS_F); }
    const sx = xb + lb*0.8, sz = z0 + S.h*0.25;
    O.sphere(9, sx, y0 + 13, sz, '#e4e4de');
    for(let k = 0; k < 6; k++){ const a = k/6*Math.PI*2; O.cyl(0.6, 0.6, 12, sx + Math.cos(a)*7.5, y0, sz + Math.sin(a)*7.5, GRIS_F, 5); }
    // Rack de tuyauteries traversant le site
    for(let x = xa1; x <= x1 - 8; x += 14){ O.boite(0.8, 8, 0.8, x, y0, zm - 2, ACIER); O.boite(0.8, 8, 0.8, x, y0, zm + 2, ACIER); O.boite(0.8, 0.8, 5, x, y0 + 7.6, zm, ACIER); }
    for(const [dz, r, c] of [[-1.2, 1.1, '#7a7a74'], [0.4, 0.9, '#d9d9d2'], [1.6, 0.7, '#3e6d80']]) O.tube([xa1, y0 + 9, zm + dz], [x1 - 8, y0 + 9, zm + dz], r, c, 8);
    // Salle de contrôle
    const sc = [x1 - 20, z1 - 14];
    O.boite(26, 8, 16, sc[0], y0, sc[1], '#d6d2c8');
    (A.lumieres >= 0.6 ? FS.F : FS.V).boite(22, 2.4, 0.6, sc[0], y0 + 4, sc[1] - 8.2, A.lumieres >= 0.6 ? '#ffd9a0' : undefined);
    // Torchère haubanée au coin nord-est, flamme animée
    const tx = x1 - 10, tz = z0 + 10, th = 74;
    O.cyl(1.1, 1.6, th, tx, y0, tz, '#c8c8c2', 8);
    for(let yy = 12; yy < th; yy += 16) O.cyl(1.5, 1.5, 1.2, tx, y0 + yy, tz, '#b8432f', 8);
    for(let k = 0; k < 3; k++){ const a = k/3*Math.PI*2 + 0.5; O.tube([tx, y0 + th*0.8, tz], [tx + Math.cos(a)*24, y0 + 0.5, tz + Math.sin(a)*24], 0.12, SOMBRE, 3); }
    FS.L.sphere(0.6, tx + 1.6, y0 + th - 6, tz, '#ff3b2f');
    flamme(tx, y0 + th + 0.5, tz, 1);
    for(let k = 0; k < 4; k++) lampadaire(x0 + 10 + k*S.l/4, z1 + 2, y0, 12, 0);
  }
  // Flamme de torchère : cônes additifs (intensité animée dans rendre).
  function flamme(x, y, z, k){
    FS.Fl.cyl(0.3, 2.6*k, 9*k, x, y, z, '#ffd27a', 8);
    FS.Fl.cyl(0.2, 1.8*k, 14*k, x + 0.6, y + 1, z, '#ff9a3a', 8);
    FS.Fl.cyl(0.1, 1.2*k, 18*k, x - 0.4, y + 2, z + 0.3, '#ff6a2a', 6);
    HALOS.push([x, y + 6*k, z, 2.2]);
  }

  // ---------- Ruines : bâtiments effondrés, gravats, épaves ----------
  function creerRuines(S, rnd){
    const O = FS.O, y0 = hSol(S.x + S.l/2, S.y + S.h/2) - 0.3;
    const PLATRE = ['#cfc6b4', '#bfb6a2', '#b8b0a2', '#a8a090'], SUIE = lin('#3a3632');
    const ilots = [];
    const decouper = (x0, z0, x1, z1, prof) => {
      const l = x1 - x0, p = z1 - z0;
      if(prof > 3 || Math.min(l, p) < 50 || l*p < 5200){ ilots.push([x0, z0, x1, z1]); return; }
      const ru = 14 + rnd()*8;
      if(l >= p){ const c = x0 + l*(0.4 + rnd()*0.2); decouper(x0, z0, c - ru/2, z1, prof + 1); decouper(c + ru/2, z0, x1, z1, prof + 1); }
      else { const c = z0 + p*(0.4 + rnd()*0.2); decouper(x0, z0, x1, c - ru/2, prof + 1); decouper(x0, c + ru/2, x1, z1, prof + 1); }
    };
    decouper(S.x + 4, S.y + 4, S.x + S.l - 4, S.y + S.h - 4, 0);
    // Mur ruiné : segments de hauteur irrégulière, haut noirci par le feu.
    const mur = (ax, az, bx, bz, hMax, coul, ep) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L/5)), ry = -Math.atan2(bz - az, bx - ax);
      let hc = hMax*(0.4 + rnd()*0.6);
      for(let k = 0; k < n; k++){
        hc = clamp(hc + (rnd() - 0.5)*hMax*0.5, 0, hMax);
        if(hc < 1.2 || rnd() < 0.12) continue;
        const t = (k + 0.5)/n, x = ax + (bx - ax)*t, z = az + (bz - az)*t, base = lin(coul);
        O.geo(geoBase('boite', () => new THREE.BoxGeometry(1,1,1)), _m.compose(_p.set(x, y0 + hc/2, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(L/n + 0.1, hc, ep)),
          (px, py) => new THREE.Color().copy(base).lerp(SUIE, lisse(hc*0.5, hc, py - y0)*0.65));
        if(rnd() < 0.15) O.tube([x, y0 + hc, z], [x + (rnd() - 0.5)*3, y0 + hc + 2 + rnd()*3, z + (rnd() - 0.5)*3], 0.15, '#6a3a24', 3);   // fers à béton
      }
    };
    for(const [x0, z0, x1, z1] of ilots){
      const ins = 3 + rnd()*5, bx0 = x0 + ins, bz0 = z0 + ins, bx1 = x1 - ins, bz1 = z1 - ins;
      const hMax = (rnd() < 0.4 ? 20 : 11) * (0.7 + rnd()*0.5), coul = PLATRE[Math.floor(rnd()*PLATRE.length)];
      O.boite(bx1 - bx0, 0.6, bz1 - bz0, (bx0 + bx1)/2, y0, (bz0 + bz1)/2, '#9a958c');
      const cotes = [[bx0, bz0, bx1, bz0], [bx1, bz0, bx1, bz1], [bx1, bz1, bx0, bz1], [bx0, bz1, bx0, bz0]];
      cotes.forEach(c => { if(rnd() < 0.8) mur(c[0], c[1], c[2], c[3], hMax, coul, 1.4); });
      // Mur de refend et dalle effondrée en biais
      if(rnd() < 0.6) mur((bx0 + bx1)/2, bz0, (bx0 + bx1)/2, bz1, hMax*0.8, coul, 1.2);
      if(hMax > 14){
        const sl = (bx1 - bx0)*0.6, sp = (bz1 - bz0)*0.5;
        O.boiteR(sl, 1.2, sp, (bx0 + bx1)/2 + (rnd() - 0.5)*6, y0 + hMax*0.3, (bz0 + bz1)/2, '#9d978c', (rnd() - 0.5)*0.5, rnd()*0.4, 0.3 + rnd()*0.3);
      }
      // Tas de gravats
      const ng = 10 + Math.floor((bx1 - bx0)*(bz1 - bz0)/120);
      for(let k = 0; k < ng; k++){
        const gx = bx0 + rnd()*(bx1 - bx0), gz = bz0 + rnd()*(bz1 - bz0), t = 1.2 + rnd()*4.5;
        O.boiteR(t, t*0.6, t*0.8, gx, y0 + t*0.25, gz, rnd() < 0.5 ? '#a49d90' : '#827b70', rnd()*2, rnd()*3, rnd()*2);
      }
      blob(O, (bx0 + bx1)/2 + (rnd() - 0.5)*8, y0, (bz0 + bz1)/2 + (rnd() - 0.5)*8, (bx1 - bx0)*0.3, 3 + rnd()*3, (bz1 - bz0)*0.3, '#8e877a', rnd()*50, 1);
    }
    // Épave calcinée et poteau électrique tombé
    const ex = S.x + S.l*(0.2 + rnd()*0.6), ez = S.y + S.h*(0.2 + rnd()*0.6), r = rnd()*3;
    O.boite(18, 5, 8.5, ex, y0 + 0.8, ez, '#3a3028', r);
    O.boite(9, 3.4, 7.6, ex - Math.cos(r)*1.5, y0 + 5.8, ez + Math.sin(r)*1.5, '#2c2622', r);
    O.boiteR(1.2, 1.2, 30, S.x + 10, y0 + 1, S.y + S.h - 18, '#5b4a3a', 0, 0.6, 0.06);
  }

  // ---------- Phare : tour à bandes, lanterne, maison du gardien, faisceau tournant ----------
  function creerPhare(S, rnd){
    const O = FS.O, cx = S.x + S.l/2, cz = S.y + S.h/2;
    const sol0 = hSol(cx, cz), ras = Math.min(S.l, S.h);
    // Assise rocheuse : surtout si le phare est sur la mer ou au bord.
    const enMer = sol0 < NIV_MER + 1;
    const y0 = enMer ? 4 : Math.max(sol0, 0) + 0.5;
    if(enMer || cz + ras*0.4 > coteF(cx) - 30){
      ROCS_PHARES.push([cx, cz, ras*0.48, 9, Math.min(sol0, -6)]);
      ROCS_PHARES.push([cx + ras*0.3, cz + ras*0.25, ras*0.3, 6, Math.min(hSol(cx + ras*0.3, cz + ras*0.25), -4)]);
    }
    if(enMer) O.cyl(ras*0.32, ras*0.36, y0 + 6, cx, -6, cz, '#a8a090', 16);
    const H = 48, rB = 7, rH = 5;
    // Fût en tronçons alternés blanc / rouge
    const n = 6;
    for(let k = 0; k < n; k++){
      const a = k/n, b = (k + 1)/n, ra = rB + (rH - rB)*a, rb = rB + (rH - rB)*b;
      O.cyl(rb, ra, H/n, cx, y0 + a*H, cz, k % 2 ? '#b8382c' : '#eeebe4', 16);
    }
    O.cyl(rH + 2.4, rH + 1.4, 1.4, cx, y0 + H, cz, '#3c3f40', 16);              // coursive
    O.cyl(rH + 2.4, rH + 2.4, 1.6, cx, y0 + H + 1.4, cz, '#2a2c2e', 16);
    FS.V.cyl(3.6, 3.6, 5.5, cx, y0 + H + 1.4, cz, undefined, 12);              // lanterne
    FS.F.sphere(2.2, cx, y0 + H + 4, cz, '#fff6d0');
    O.sphere(4, cx, y0 + H + 7, cz, '#b8382c', 0.6);
    O.cyl(0.2, 0.3, 3, cx, y0 + H + 9, cz, SOMBRE, 4);
    HALOS.push([cx, y0 + H + 4, cz, 2.6]);
    PHARES.push([cx, y0 + H + 4, cz]);
    // Maison du gardien et muret, côté terre (nord)
    const mz = cz - ras*0.32 - 10;
    if(hSol(cx, mz) > NIV_MER + 0.5) maison(O, cx - 4, mz, 0, rnd, {l:24, p:14, etages:1, terrasse:false, mur:'#ece6d8', volet:'#3d6f7a'});
  }

  // ---------- Ferme : mas en L, hangar cintré, silos, bottes de foin, enclos ----------
  function creerFerme(S, rnd){
    const O = FS.O, x0 = S.x, x1 = S.x + S.l, z0 = S.y, z1 = S.y + S.h, y0 = hSol((x0 + x1)/2, (z0 + z1)/2);
    const PIERRE = '#d8c8a8';
    // Mas : corps principal au nord, aile à l'ouest
    const ml = S.l*0.5, mp = clamp(S.h*0.22, 14, 22);
    maison(O, x0 + 6 + ml/2, z0 + 6 + mp/2, 0, rnd, {l:ml, p:mp, etages:2, terrasse:false, mur:PIERRE, volet:'#6a5a3a', h0:y0 - 3, muret:false});
    const al = clamp(S.l*0.18, 12, 18), ap = S.h*0.4;
    maison(O, x0 + 6 + al/2, z0 + 6 + mp + ap/2, 0, rnd, {l:al, p:ap, etages:1, terrasse:false, mur:PIERRE, volet:'#6a5a3a', h0:y0 - 3, muret:false, quatre:true});
    // Hangar ouvert à toit cintré (est)
    const hx0 = x0 + S.l*0.6, hx1 = x1 - 6, hz0 = z0 + 8, hz1 = z0 + 8 + clamp(S.h*0.38, 20, 36), hr = (hz1 - hz0)/2;
    // Cinq rangées de poteaux. Pas calculé une fois : une ferme étroite (hx1 ≈ hx0) donnait
    // un pas nul, donc une boucle sans fin.
    for(let k = 0; k <= 4; k++){ const x = hx0 + (hx1 - hx0)*k/4; for(const z of [hz0, hz1]) O.boite(0.9, 7, 0.9, x, y0, z, ACIER); }
    toitCintre(O, (hx0 + hx1)/2, y0 + 7, (hz0 + hz1)/2, hx1 - hx0 + 2, hr, '#9ca2a2', 0);
    // Tracteur et bottes de foin sous le hangar
    const tx = hx0 + 10, tz = (hz0 + hz1)/2;
    O.boite(10, 4, 5, tx, y0 + 1.5, tz, '#b8432f'); O.boite(4, 4, 4.4, tx - 2.5, y0 + 5.5, tz, '#b8432f');
    FS.V.boite(4.2, 2.4, 4.6, tx - 2.5, y0 + 6.5, tz);
    O.tube([tx - 3, y0 + 3, tz - 3.2], [tx - 3, y0 + 3, tz + 3.2], 3, '#1e1c1a', 10);
    O.tube([tx + 3.5, y0 + 1.8, tz - 3], [tx + 3.5, y0 + 1.8, tz + 3], 1.8, '#1e1c1a', 8);
    for(let k = 0; k < 6; k++){ const bx = hx0 + 22 + (k % 3)*7, bz = hz0 + 5 + Math.floor(k/3)*7; if(bx < hx1 - 3) O.tube([bx, y0 + 2.8, bz - 2.8], [bx, y0 + 2.8, bz + 2.8], 2.8, '#c9a85a', 10); }
    // Silos et château d'eau sur pieds
    const sx = x1 - 14;
    for(const [dz, r] of [[S.h*0.62, 5.5], [S.h*0.62 + 14, 4.5]]){
      if(z0 + dz + r > z1 - 4) continue;
      O.cyl(r, r, 22, sx, y0, z0 + dz, '#c8ccce', 14);
      O.cyl(0.6, r, 4, sx, y0 + 22, z0 + dz, '#a8acae', 14);
    }
    const wx = x0 + 14, wz = z1 - 16;
    for(const [lx, lz] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) O.boite(0.6, 12, 0.6, wx + lx, y0, wz + lz, ACIER);
    O.cyl(5, 5, 6, wx, y0 + 12, wz, '#d8d8d2', 14); O.cyl(5.1, 5.1, 1, wx, y0 + 15, wz, '#3e7ea0', 14);
    // Enclos (clôture de bois) au sud-est, bottes de foin rondes
    const ex0 = x0 + S.l*0.35, ex1 = x1 - 26, ez0 = z0 + S.h*0.6, ez1 = z1 - 6;
    if(ex1 - ex0 > 20 && ez1 - ez0 > 14){
      for(const [ax, az, bx, bz] of [[ex0, ez0, ex1, ez0], [ex1, ez0, ex1, ez1], [ex1, ez1, ex0, ez1], [ex0, ez1, ex0, ez0]]){
        const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L/6));
        for(let k = 0; k <= n; k++) O.boite(0.6, 3.4, 0.6, ax + (bx - ax)*k/n, y0, az + (bz - az)*k/n, '#6a5440');
        for(const hy of [1.4, 2.8]) O.tube([ax, y0 + hy, az], [bx, y0 + hy, bz], 0.2, '#7a6450', 3);
      }
      for(let k = 0; k < 4; k++) O.tube([ex0 + 8 + k*9, y0 + 2.4, ez0 + 6 - 2], [ex0 + 8 + k*9, y0 + 2.4, ez0 + 6 + 2], 2.4, '#c9a85a', 10);
    }
    // Cour : charrette, abreuvoir ; oliviers au bout de la parcelle
    O.boite(10, 1.6, 2.4, x0 + S.l*0.35, y0, z0 + S.h*0.45, '#9a9a94');
    bassinEau(x0 + S.l*0.35 - 4.5, z0 + S.h*0.45 - 0.9, x0 + S.l*0.35 + 4.5, z0 + S.h*0.45 + 0.9, y0 + 1.7);
    for(let k = 0; k < 4; k++) DECOR_SUPP.push({type:'olivier', x:x0 + 8 + rnd()*S.l*0.25, y:z0 + S.h*0.72 + rnd()*S.h*0.22, s:0.7 + rnd()*0.3});
    lampadaire(x0 + S.l*0.5, z0 + S.h*0.4, y0, 7, 0);
  }

  // ---------- Barrage : mur-poids, vannes, retenue en digue, déversoir, bassin de dissipation ----------
  function creerBarrage(S, rnd){
    const O = FS.O, cx = S.x + S.l/2, cz = S.y + S.h/2;
    const horizontal = S.l >= S.h, Lw = horizontal ? S.l : S.h, D = horizontal ? S.h : S.l;
    const U = horizontal ? [1, 0] : [0, 1];
    // Amont : du côté du premier point d'une rivière qui traverse le barrage, sinon nord / ouest.
    let W = horizontal ? [0, -1] : [-1, 0];
    for(const R of RIVS){
      if(distRect(R.pts[0][0], R.pts[0][1], S.x, S.y, S.x + S.l, S.y + S.h) > 0 && R.pts.some(p => distRect(p[0], p[1], S.x - 200, S.y - 200, S.x + S.l + 200, S.y + S.h + 200) === 0)){
        const p0 = R.pts[0];
        const cote2 = (p0[0] - cx)*W[0] + (p0[1] - cz)*W[1];
        if(cote2 < 0) W = [-W[0], -W[1]];
        break;
      }
    }
    const P = (u, w) => [cx + u*U[0] + w*W[0], cz + u*U[1] + w*W[1]];
    const ry = -Math.atan2(U[1], U[0]);
    // Boîte en repère local : l le long du mur, p en travers.
    const Bx = (l, h, p, u, y, w, coul, F) => { const [x, z] = P(u, w); (F || O).boite(l, h, p, x, y, z, coul, ry); };
    const y0 = hSol(cx, cz);
    const BETON_B = '#bdb8ac';
    // Hauteurs : couronnement à HC au-dessus du sol (lisible depuis la caméra du jeu).
    const HC = 18, NIV = HC - 4.5;
    // Mur-poids (profil en gradins, parement aval assombri par les coulures) et couronnement
    const coulures = (base) => { const b = lin(base), s = lin('#7d786e'); return (px, py, pz, nx, ny, nz) => {
      const aval = (nx*W[0] + nz*W[1]) < -0.5;
      return aval ? new THREE.Color().copy(b).lerp(s, 0.25 + 0.3*hash2(Math.floor(px/3), Math.floor(pz/3))) : b; }; };
    const BxF = (l, h, p, u, y, w, f) => { const [x, z] = P(u, w); _m.compose(_p.set(x, y + h/2, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(l, h, p)); O.geo(geoBase('boite', () => new THREE.BoxGeometry(1,1,1)), _m, f); };
    BxF(Lw - 8, y0 + 7, 26, 0, -7, 0, coulures(BETON_B));
    BxF(Lw - 8, HC - 5, 16, 0, y0, 2, coulures(BETON_B));
    BxF(Lw - 8, 5, 9, 0, y0 + HC - 5, 3, coulures('#c9c4b8'));
    Bx(Lw - 8, 0.3, 6, 0, y0 + HC, 3, '#55534e');                                      // chaussée du couronnement
    for(const sw of [-1, 1]){
      Bx(Lw - 8, 1.2, 0.8, 0, y0 + HC, 3 + sw*4, '#d8d4ca');
      for(let u = -Lw/2 + 8; u < Lw/2 - 8; u += 6){ const [x, z] = P(u, 3 + sw*4.2); O.boite(0.4, 2.2, 0.4, x, y0 + HC, z, GRIS_F); }
      const [ax, az] = P(-Lw/2 + 6, 3 + sw*4.2), [bx, bz] = P(Lw/2 - 6, 3 + sw*4.2);
      O.tube([ax, y0 + HC + 2, az], [bx, y0 + HC + 2, bz], 0.15, GRIS_F, 3);
    }
    // Pertuis vannés au centre : piles, vannes d'acier, treuils
    const Sv = Math.min(Lw*0.42, 90), nv = 4, pasV = Sv/nv;
    for(let k = 0; k <= nv; k++){
      const u = -Sv/2 + k*pasV;
      Bx(3.4, 9, 13, u, y0 + HC, 3, '#c9c4b8');
      if(k < nv){
        Bx(pasV - 3.6, HC - 6, 0.8, u + pasV/2, y0 + 4, 9.6, '#4e6470');
        Bx(pasV - 3.6, 2.4, 3.4, u + pasV/2, y0 + HC + 7, 5, '#8a6a3a');
      }
    }
    Bx(Sv + 4, 1.2, 13, 0, y0 + HC + 9, 3, '#a9a59a');
    // Retenue amont dans ses digues (eau au-dessus du terrain), talus et enrochements
    const wa = 10, wb = D/2 - 5, ua = Lw/2 - 7, niveau = y0 + NIV;
    for(const [u, w, l, p] of [[0, wb, Lw - 8, 8], [-ua, (wa + wb)/2, 8, wb - wa], [ua, (wa + wb)/2, 8, wb - wa]]){
      Bx(l, HC - 3, p, u, y0, w, '#9c9484');
      Bx(l, 0.4, p - 2, u, y0 + HC - 3, w, '#b6ad98');
      for(let k = 0; k < (l + p)/3; k++){
        const uu = u + (rnd() - 0.5)*l, ww = w + (rnd() - 0.5)*p, [x, z] = P(uu, ww), t = 1.5 + rnd()*2.5;
        O.boiteR(t, t*0.7, t, x, y0 + NIV + rnd()*2, z, rnd() < 0.5 ? '#8a8276' : '#a29a8c', rnd()*2, rnd()*3, rnd()*2);
      }
    }
    {
      const c = [P(-ua + 4, wa), P(ua - 4, wa), P(ua - 4, wb - 4), P(-ua + 4, wb - 4)];
      EAU.f.quad([[c[0][0], niveau, c[0][1]], [c[3][0], niveau, c[3][1]], [c[2][0], niveau, c[2][1]], [c[1][0], niveau, c[1][1]]],
        [[0, -40], [0, 40], [Lw, 40], [Lw, -40]], 0, 1e4, -W[0], -W[1]);
    }
    // Déversoir : coursier incliné (béton et lame d'eau rapide) puis bassin de dissipation
    const wc = -8, wd = Math.max(-D/2 + 20, wc - 28);
    {
      const a = P(-Sv/2 + 2, wc), b = P(Sv/2 - 2, wc), c = P(Sv/2 - 2, wd), d = P(-Sv/2 + 2, wd);
      O.quad2([a[0], y0 + HC - 6, a[1]], [b[0], y0 + HC - 6, b[1]], [c[0], y0 + 0.4, c[1]], [d[0], y0 + 0.4, d[1]], '#a8a398');
      EAU.f.quad([[a[0], y0 + HC - 5.6, a[1]], [d[0], y0 + 0.8, d[1]], [c[0], y0 + 0.8, c[1]], [b[0], y0 + HC - 5.6, b[1]]],
        [[0, -Sv/2], [Math.abs(wd - wc)*3, -Sv/2], [Math.abs(wd - wc)*3, Sv/2], [0, Sv/2]], 140, 1e4, -W[0], -W[1]);
      for(const s of [-1, 1]) Bx(1.6, HC - 5, Math.abs(wd - wc), s*(Sv/2 - 1), y0, (wc + wd)/2, '#b4afa3');
    }
    const we = -D/2 + 5;
    if(wd - we > 6){
      Bx(Sv + 6, 0.6, wd - we, 0, y0 - 0.2, (wd + we)/2, '#8f8b82');
      for(const s of [-1, 1]) Bx(1.6, 2.6, wd - we, s*(Sv/2 + 2), y0, (wd + we)/2, '#b4afa3');
      Bx(Sv + 6, 1.8, 1.6, 0, y0, we, '#b4afa3');
      const a = P(-Sv/2 - 1, wd), b = P(Sv/2 + 1, wd), c = P(Sv/2 + 1, we + 1), d = P(-Sv/2 - 1, we + 1);
      EAU.f.quad([[a[0], y0 + 1.4, a[1]], [d[0], y0 + 1.4, d[1]], [c[0], y0 + 1.4, c[1]], [b[0], y0 + 1.4, b[1]]],
        [[0, -Sv/2], [wd - we, -Sv/2], [wd - we, Sv/2], [0, Sv/2]], 55, 1e4, -W[0], -W[1]);
    }
    // Tour de commande à une extrémité, lampadaires, balise
    const [tx, tz] = P(Lw/2 - 14, 3);
    O.boite(12, 22, 12, tx, y0 + HC, tz, '#d6d2c8', ry);
    O.boite(13, 1, 13, tx, y0 + HC + 22, tz, '#a9aba8', ry);
    (A.lumieres >= 0.6 ? FS.F : FS.V).boite(12.4, 2.6, 12.4, tx, y0 + HC + 16, tz, A.lumieres >= 0.6 ? '#ffd9a0' : undefined, ry);
    FS.L.sphere(0.7, tx, y0 + HC + 24, tz, '#ff3b2f');
    for(const u of [-Lw/2 + 12, -Sv/2 - 8, Sv/2 + 8]){ const [x, z] = P(u, 7.5); lampadaire(x, z, y0 + HC, 8, ry + Math.PI/2); }
  }

  // ---------- Pont : tablier, rampes, poutres, piles, garde-corps, lampadaires ----------
  function creerPont(Pn, rnd){
    const O = FS.O, {x, y, ca, sa, L, W} = Pn, ry = -Pn.a;
    const P = (u, v) => [x + u*ca - v*sa, y + u*sa + v*ca];
    const Bx = (l, h, p, u, by, v, coul) => { const [px, pz] = P(u, v); O.boite(l, h, p, px, by, pz, coul, ry); };
    const Lp = L - 2*PONT_RAMPE, top = PONT_H;
    // Tablier : dalle, chaussée, bordures, marquages
    Bx(Lp, 2.6, W, 0, top - 2.75, 0, '#aaa69c');
    Bx(Lp, 0.15, W - 7, 0, top - 0.15, 0, '#4b4945');
    for(const sv of [-1, 1]) Bx(Lp, 0.9, 3.2, 0, top - 0.15, sv*(W/2 - 1.6), '#bab5aa');
    for(let u = -Lp/2 + 6; u < Lp/2 - 6; u += 16) Bx(8, 0.05, 0.8, u + 4, top, 0, '#d8c070');
    for(const sv of [-1, 1]) Bx(Lp, 0.05, 0.6, 0, top, sv*(W/2 - 4.4), '#dcd8cc');
    // Rampes d'accès (surface inclinée jusqu'au sol de la berge) et culées
    for(const su of [-1, 1]){
      const ua = su*Lp/2, ub = su*L/2;
      const ha = top - 0.05;
      const [bx0, bz0] = P(ub, 0), hb = hauteurMaillage(bx0, bz0) + 0.05;
      const c1 = P(ua, -W/2 + 1), c2 = P(ua, W/2 - 1), c3 = P(ub, W/2 - 1), c4 = P(ub, -W/2 + 1);
      O.quad2([c1[0], ha, c1[1]], [c2[0], ha, c2[1]], [c3[0], hb, c3[1]], [c4[0], hb, c4[1]], '#4e4c48');
      const hmin = Math.min(hb, hauteurMaillage(...P(ua, 0))) - 6;
      Bx(PONT_RAMPE + 4, (top - 0.3) - hmin, W - 1, (ua + ub)/2, hmin, 0, '#b0aca2');
      for(const sv of [-1, 1]){
        const s1 = P(ua, sv*(W/2 - 0.6)), s2 = P(ub, sv*(W/2 - 0.6));
        O.tube([s1[0], ha + 1.2, s1[1]], [s2[0], hb + 1.2, s2[1]], 0.6, '#bab5aa', 4);
      }
    }
    // Poutres sous le tablier
    for(const sv of [-1, 1]) Bx(Lp, 3.6, 3.2, 0, top - 2.75 - 3.6, sv*(W/2 - 5), '#9e9a90');
    // Piles dans le lit, avant-becs arrondis
    const n = Math.max(1, Math.round(Lp/55));
    for(let k = 0; k < n; k++){
      const u = -Lp/2 + (k + 0.5)*Lp/n, base = FOND_RIV - 1, hp = (top - 2.75 - 3.6) - base;
      Bx(5, hp, W*0.62, u, base, 0, '#a8a49a');
      for(const sv of [-1, 1]){ const [px, pz] = P(u, sv*W*0.31); O.cyl(2.5, 2.5, hp, px, base, pz, '#a8a49a', 10); }
      Bx(6.4, 1, W*0.7, u, top - 2.75 - 3.6 - 1, 0, '#b8b4aa');
    }
    // Garde-corps et lampadaires
    for(const sv of [-1, 1]){
      const v = sv*(W/2 - 0.7);
      for(let u = -Lp/2; u <= Lp/2 + 0.01; u += 5){ const [px, pz] = P(u, v); O.boite(0.45, 3.4, 0.45, px, top + 0.75, pz, '#7a8084'); }
      for(const hy of [2.4, 4.0]){ const a = P(-Lp/2, v), b = P(Lp/2, v); O.tube([a[0], top + 0.75 + hy - 0.8, a[1]], [b[0], top + 0.75 + hy - 0.8, b[1]], 0.2, '#8a9094', 4); }
      for(const u of [-Lp/4, Lp/4]){ const [px, pz] = P(u, sv*(W/2 + 0.2)); lampadaire(px, pz, top + 0.75, 9, ry + (sv > 0 ? Math.PI/2 : -Math.PI/2)); }
    }
  }

  function creerStructures(){
    const rnd = generateur(2718 + M.graine);
    for(const S of STRS){
      switch(S.type){
        case 'usine_dessal': creerUsine(S); break;
        case 'village': creerVillage(S, rnd); break;
        case 'port': creerPort(S, rnd); break;
        case 'raffinerie': creerRaffinerie(S, rnd); break;
        case 'ruines': creerRuines(S, rnd); break;
        case 'phare': creerPhare(S, rnd); break;
        case 'ferme': creerFerme(S, rnd); break;
        case 'barrage': creerBarrage(S, rnd); break;
      }
    }
    for(const P of PONTS_R) creerPont(P, rnd);
  }
  // Maillages des structures (après creerStructures et creerRochers).
  function maillerStructures(){
    if(!FS.O.vide()){
      const opaque = new THREE.Mesh(FS.O.geometrie(), new THREE.MeshStandardMaterial({vertexColors:true, roughness:0.66, metalness:0.06}));
      opaque.castShadow = opaque.receiveShadow = true;
      scene.add(opaque);
    }
    if(!FS.V.vide()){
      const verre = new THREE.Mesh(FS.V.geometrie(), new THREE.MeshStandardMaterial({color:'#24384a', roughness:0.12, metalness:0.75, emissive:'#0d1a24'}));
      verre.receiveShadow = true;
      scene.add(verre);
    }
    if(!FS.L.vide()){
      matFeux = new THREE.MeshBasicMaterial({vertexColors:true, toneMapped:false});
      scene.add(new THREE.Mesh(FS.L.geometrie(), matFeux));
    }
    if(!FS.F.vide()){
      matFixes = new THREE.MeshBasicMaterial({vertexColors:true, toneMapped:false});
      matFixes.color.setScalar(A.fixes);
      scene.add(new THREE.Mesh(FS.F.geometrie(), matFixes));
    }
    if(!FS.Fl.vide()){
      matFlammes = new THREE.MeshBasicMaterial({vertexColors:true, toneMapped:false, transparent:true, opacity:0.9, blending:THREE.AdditiveBlending, depthWrite:false});
      const m = new THREE.Mesh(FS.Fl.geometrie(), matFlammes); m.renderOrder = 6;
      scene.add(m);
    }
  }

  // =================================================================
  //  9. LUMIÈRES D'AMBIANCE : halos, faisceau du phare
  // =================================================================
  function textureHalo(){
    const N = 64, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(N/2, N/2, 0, N/2, N/2, N/2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,240,200,0.55)');
    gr.addColorStop(0.5, 'rgba(255,210,150,0.14)'); gr.addColorStop(1, 'rgba(255,200,140,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    return new THREE.CanvasTexture(cv);
  }
  function creerHalos(){
    // Flammes de torchère : halo toujours visible ; lampes : seulement aube, crépuscule, brume.
    const pts = HALOS.filter(h => A.lumieres > 0 || h[3] >= 2.2);
    if(!pts.length) return;
    const pos = [], col = [];
    const chaud = new THREE.Color('#ffc880'), blanc = new THREE.Color('#fff2d8');
    for(const [x, y, z, k] of pts){
      pos.push(x, y, z);
      const c = (k >= 2.2 ? chaud : blanc).clone().multiplyScalar(Math.min(1, 0.35 + 0.4*k) * Math.max(A.lumieres, k >= 2.2 ? 0.6 : 0));
      col.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({size:42, map:textureHalo(), vertexColors:true, transparent:true, depthWrite:false,
      blending:THREE.AdditiveBlending, sizeAttenuation:true, toneMapped:false, fog:true});
    halosObj = new THREE.Points(g, mat);
    halosObj.renderOrder = 7;
    scene.add(halosObj);
  }
  function creerFaisceaux(){
    if(!PHARES.length || A.lumieres <= 0) return;
    const geo = new THREE.ConeGeometry(16, 260, 18, 1, true);
    geo.translate(0, -130, 0);              // sommet du cône à l'origine (la lanterne)
    geo.rotateZ(Math.PI/2);                 // axe du cône à l'horizontale (+X)
    const mat = new THREE.ShaderMaterial({
      uniforms:{uOp:{value:0.13*A.lumieres + 0.03}, uCoul:{value:new THREE.Color('#fff0c8')}},
      vertexShader:`varying float vT; void main(){ vT = clamp(position.x/260.0, 0.0, 1.0); gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }`,
      fragmentShader:`uniform float uOp; uniform vec3 uCoul; varying float vT; void main(){ gl_FragColor = vec4(uCoul, uOp*(1.0 - vT)*(1.0 - vT)); }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, toneMapped:false,
    });
    for(const [x, y, z] of PHARES){
      const g = new THREE.Group();
      const a = new THREE.Mesh(geo, mat), b = new THREE.Mesh(geo, mat);
      b.rotation.y = Math.PI;
      a.rotation.z = b.rotation.z = -0.05;
      g.add(a, b); g.position.set(x, y, z);
      g.renderOrder = 8;
      scene.add(g); faisceaux.push(g);
    }
  }

  // =================================================================
  //  10. BRÛLURES (pool recyclé d'instances, une seule draw call)
  // =================================================================
  function creerBrulures(){
    const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), rnd = generateur(99);
    const gr = g.createRadialGradient(N/2, N/2, 2, N/2, N/2, N/2);
    gr.addColorStop(0, 'rgba(38,28,20,0.6)'); gr.addColorStop(0.35, 'rgba(46,33,22,0.5)');
    gr.addColorStop(0.62, 'rgba(92,62,36,0.32)'); gr.addColorStop(0.82, 'rgba(128,88,52,0.16)');
    gr.addColorStop(1, 'rgba(128,88,52,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    g.strokeStyle = 'rgba(34,24,16,0.16)'; g.lineCap = 'round';
    for(let k = 0; k < 16; k++){
      const a = rnd()*Math.PI*2, l = N*(0.25 + rnd()*0.22);
      const d0 = N*(0.08 + rnd()*0.08);
      g.lineWidth = 1 + rnd()*3; g.beginPath(); g.moveTo(N/2 + Math.cos(a)*d0, N/2 + Math.sin(a)*d0); g.lineTo(N/2 + Math.cos(a)*l, N/2 + Math.sin(a)*l); g.stroke();
    }
    for(let k = 0; k < 40; k++){
      const a = rnd()*Math.PI*2, d = rnd()*N*0.36, r = 2 + rnd()*7;
      g.fillStyle = 'rgba(30,22,15,0.08)'; g.beginPath(); g.arc(N/2 + Math.cos(a)*d, N/2 + Math.sin(a)*d, r, 0, Math.PI*2); g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    const masque = g.createRadialGradient(N/2, N/2, N*0.3, N/2, N/2, N/2);
    masque.addColorStop(0, 'rgba(0,0,0,1)'); masque.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = masque; g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'source-over';
    const img = g.getImageData(0, 0, N, N), px = img.data, AMAX = Math.round(0.6*255);
    for(let i = 3; i < px.length; i += 4) if(px[i] > AMAX) px[i] = AMAX;
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    const geo = new THREE.PlaneGeometry(2, 2); geo.rotateX(-Math.PI/2);
    const mat = new THREE.MeshBasicMaterial({map:tex, color:'#ffffff', transparent:true, depthWrite:false,
      polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4});
    brulures = new THREE.InstancedMesh(geo, mat, MAX_BRULURES);
    brulures.count = 0; brulures.frustumCulled = false; brulures.renderOrder = 2;
    scene.add(brulures);
  }
  const _rndB = generateur(2024);
  R3D.ajouterBrulure = function(x, y, r){
    if(!brulures) return;
    r = Math.max(4, r || 20) * (0.9 + _rndB()*0.3);
    let h = -1e9;
    for(const [dx, dy] of [[0,0],[r*0.7,0],[-r*0.7,0],[0,r*0.7],[0,-r*0.7]]) h = Math.max(h, hSol(x + dx, y + dy));
    if(h < NIV_MER) return;                                     // pas de brûlure sur l'eau
    _m.compose(_p.set(x, h + 0.25, y), _q.setFromEuler(_e.set(0, _rndB()*Math.PI*2, 0)), _s.set(r, 1, r*(0.85 + _rndB()*0.3)));
    brulures.setMatrixAt(nbBrulures % MAX_BRULURES, _m);
    nbBrulures++;
    brulures.count = Math.min(nbBrulures, MAX_BRULURES);
    brulures.instanceMatrix.needsUpdate = true;
  };

  // =================================================================
  //  11. INITIALISATION, CAMÉRA, OMBRES, INTERFACE
  // =================================================================
  R3D.init = function(canvas){
    lireCarte();
    A = AMBIANCES[M.ambiance];
    R3D.ambiance = M.ambiance;
    dirSoleil.set(A.soleil[0], A.soleil[1], A.soleil[2]).normalize();
    R3D.dirSoleil = dirSoleil.clone();
    HALOS = []; ROCS_PHARES = []; PHARES = []; DECOR_SUPP = []; faisceaux = [];
    FS.O = new Fusion(); FS.V = new Fusion(); FS.L = new Fusion(); FS.F = new Fusion(); FS.Fl = new Fusion();
    EAU.f = new FusionEau();

    renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
    renderer.setPixelRatio(densitePixels());
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = A.expo;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(A.brume);
    scene.fog = new THREE.Fog(A.brume, 1200, 5000);
    camera = new THREE.PerspectiveCamera(40, innerWidth/innerHeight, 10, 9000);
    R3D.scene = scene; R3D.camera = camera; R3D.renderer = renderer;

    // Durées de construction (ms), consultables par R3D.durees pour le diagnostic.
    R3D.durees = {};
    const etape = (nom, f) => { const t = performance.now(); f(); R3D.durees[nom] = Math.round(performance.now() - t); };

    // Brume de distance (shaders communs à toute la scène), ciel, carte d'environnement.
    installerBrume();
    const nuagesPrets = installerNuages();
    creerUniformesCiel();
    sombreCible = sombre = sombreEnv = 0; sombreApplique = -1;
    etape('ciel', creerCiel);
    etape('environnement', creerEnvironnement);

    // Lumières : soleil (ombres portées), ciel hémisphérique, appoint opposé. La carte
    // d'environnement apporte déjà la lumière du ciel selon l'orientation des surfaces :
    // l'hémisphère et l'appoint ne gardent alors qu'une part (hemiK, appointK), ce qui
    // creuse les ombres sans assombrir l'ensemble.
    const env = !!scene.environment;
    hemiBase = A.hemi[2] * (env ? A.hemiK : 1);
    appointBase = A.appoint[1] * (env ? A.appointK : 1);
    hemi = new THREE.HemisphereLight(A.hemi[0], A.hemi[1], hemiBase);
    scene.add(hemi);
    soleil = new THREE.DirectionalLight(A.coulSoleil, A.intSoleil);
    soleil.castShadow = true;
    soleil.shadow.mapSize.set(QUALITES[R3D.qualite].ombres, QUALITES[R3D.qualite].ombres);
    soleil.shadow.bias = A.biais;
    soleil.shadow.normalBias = A.normalBiais;
    const sc = soleil.shadow.camera; sc.near = 50; sc.far = 6000;
    scene.add(soleil); scene.add(soleil.target);
    appoint = new THREE.DirectionalLight(A.appoint[0], appointBase);
    appoint.position.set(A.appoint[2][0], A.appoint[2][1], A.appoint[2][2]);
    scene.add(appoint);
    // Sonde de lumière : elle n'éclaire rien, elle porte le décalage et la force des ombres de nuages.
    sondeNuages = null; tNuages = 0;
    if(nuagesPrets && THREE.LightProbe){ sondeNuages = new THREE.LightProbe(); sondeNuages.intensity = 1; scene.add(sondeNuages); }
    // Couleurs de référence (jour) et cibles du ciel d'invasion, pour R3D.assombrir.
    COUL.brume = new THREE.Color(A.brume); COUL.brumeNuit = new THREE.Color().fromArray(NUIT.horizon);
    COUL.soleil = new THREE.Color(A.coulSoleil); COUL.soleilNuit = new THREE.Color(NUIT.soleil);
    COUL.hemiCiel = new THREE.Color(A.hemi[0]); COUL.hemiCielNuit = new THREE.Color(NUIT.hemiCiel);
    COUL.hemiSol = new THREE.Color(A.hemi[1]); COUL.hemiSolNuit = new THREE.Color(NUIT.hemiSol);
    COUL.appoint = new THREE.Color(A.appoint[0]); COUL.appointNuit = new THREE.Color(NUIT.appoint);
    COUL.brumeBasse = new THREE.Color(A.coulBrumeBasse); COUL.brumeBasseNuit = new THREE.Color(NUIT.brumeBasse);

    etape('terrain', creerTerrain);
    etape('mer', creerMer);
    etape('rivieres', rubanRivieres);
    etape('structures', creerStructures);     // remplit aussi DECOR_SUPP, ROCS_PHARES, HALOS et l'eau des bassins
    etape('rochers', creerRochers);
    etape('decor', creerDecor);
    etape('maillage', maillerStructures);
    etape('eau', creerEau);
    etape('brume', creerBrumeBasse);
    etape('halos', creerHalos);
    etape('faisceaux', creerFaisceaux);
    etape('brulures', creerBrulures);

    etape('decoupage', decouperFusions);

    // Compteurs de rendu cumulés sur toute l'image (scène + passes de post-traitement).
    renderer.info.autoReset = false;
    postPret = false; postPanne = false;
    R3D.redimensionner(innerWidth, innerHeight);
    appliquerQualite();
    R3D.majCamera();
    R3D.pret = true;
  };

  // Découpage des grands maillages fusionnés (rochers, maisons, structures…) en blocs de
  // BLOC_FUSION unités, selon le centre de chaque triangle : un bloc hors de l'image, ou hors du
  // cadre de la carte d'ombre, n'est plus dessiné. Mêmes triangles, même matière, même ordre de
  // dessin : l'image est identique. Seuls les maillages opaques, non indexés et étendus sont visés.
  const BLOC_FUSION = 700;
  function decouperFusions(){
    for(const o of scene.children.slice()){
      const g = o.geometry, m = o.material;
      if(!o.isMesh || o.isInstancedMesh || !g || g.index || !g.attributes.position || Array.isArray(m) || m.transparent || o.children.length) continue;
      if(!g.boundingSphere) g.computeBoundingSphere();
      const P = g.attributes.position, nTri = P.count/3;
      if(g.boundingSphere.radius < 900 || nTri < 4000 || g.groups.length || g.morphAttributes.position) continue;
      const cases = new Map(), a = P.array;
      for(let t = 0; t < nTri; t++){
        const i = t*9, cx = (a[i] + a[i+3] + a[i+6])/3, cz = (a[i+2] + a[i+5] + a[i+8])/3;
        const k = Math.floor(cx/BLOC_FUSION) + ',' + Math.floor(cz/BLOC_FUSION);
        let l = cases.get(k); if(!l){ l = []; cases.set(k, l); } l.push(t);
      }
      if(cases.size < 2) continue;
      const noms = Object.keys(g.attributes);
      for(const l of cases.values()){
        const gb = new THREE.BufferGeometry();
        for(const nom of noms){
          const s = g.attributes[nom], n = s.itemSize, src = s.array, dst = new src.constructor(l.length*3*n);
          for(let j = 0; j < l.length; j++) dst.set(src.subarray(l[j]*3*n, (l[j] + 1)*3*n), j*3*n);
          gb.setAttribute(nom, new THREE.BufferAttribute(dst, n, s.normalized));
        }
        gb.computeBoundingBox(); gb.computeBoundingSphere();
        const mb = new THREE.Mesh(gb, m);
        mb.castShadow = o.castShadow; mb.receiveShadow = o.receiveShadow; mb.renderOrder = o.renderOrder;
        mb.frustumCulled = o.frustumCulled; mb.visible = o.visible; mb.name = o.name;
        mb.position.copy(o.position); mb.quaternion.copy(o.quaternion); mb.scale.copy(o.scale);
        mb.updateMatrix(); mb.matrixAutoUpdate = false;
        scene.add(mb);
      }
      scene.remove(o);
      g.dispose();
    }
  }

  // -----------------------------------------------------------------
  //  Qualité graphique : 'basse' | 'moyenne' | 'haute' (défaut 'moyenne')
  //    basse   : pas de post-traitement, ombres réduites, densité de pixels 1, pas d'ombres de nuages
  //    moyenne : bloom, étalonnage, anticrénelage FXAA, ombres de nuages
  //    haute   : tout (occlusion ambiante et grain compris), ombres plus fines
  //  Le post-traitement lui-même est dans r3d-post.js (R3D.Post), facultatif.
  // -----------------------------------------------------------------
  const QUALITES = {
    basse:   {ratio:1,    ombres:1024},
    moyenne: {ratio:1.5,  ombres:2048},
    haute:   {ratio:1.75, ombres:4096},
  };
  let postPret = false, postPanne = false;
  R3D.qualite = QUALITES[R3D.qualite] ? R3D.qualite : 'moyenne';
  R3D.definirQualite = function(q){
    R3D.qualite = QUALITES[q] ? q : 'moyenne';
    try { if(R3D.Post && R3D.Post.definirQualite) R3D.Post.definirQualite(R3D.qualite); } catch(e){ /* post-traitement facultatif */ }
    appliquerQualite();
    return R3D.qualite;
  };
  function appliquerQualite(){
    if(!renderer) return;
    const Q = QUALITES[R3D.qualite];
    // Résolution adaptative : chaque qualité repart de son plafond.
    if(R3D.qualite !== qualiteAdapt){ qualiteAdapt = R3D.qualite; echelle = 1; adapt.haut = adapt.bas = 0; adapt.attente = 1; }
    if(R3D.qualite === 'basse') calibrerSol();
    majMatiereSol();
    // Densité de pixels : appliquée par R3D.redimensionner (elle dépend aussi de l'écran).
    if(largVue && renderer.getPixelRatio() !== densitePixels()) R3D.redimensionner(largVue, hautVue);
    const o = soleil.shadow;
    if(o.mapSize.x !== Q.ombres){
      o.mapSize.set(Q.ombres, Q.ombres);
      if(o.map){ o.map.dispose(); o.map = null; }           // recréée à la bonne taille à l'image suivante
    }
  }
  // -----------------------------------------------------------------
  //  Assombrissement du ciel : R3D.assombrir(k), k de 0 (ambiance normale) à 1 (ciel d'invasion,
  //  très sombre). La consigne est suivie en douceur (environ 2 s pour une transition complète) :
  //  ciel, brume, soleil, hémisphère, exposition, eau, étalonnage de l'image, puis reflets.
  // -----------------------------------------------------------------
  R3D.assombrir = function(k){ sombreCible = clamp(+k || 0, 0, 1); return sombreCible; };
  // Niveau courant (lissé), pour les modules qui veulent s'accorder au ciel.
  R3D.assombrissement = function(){ return sombre; };
  const melange = (a, b, t) => a + (b - a)*t;
  const _etal = {contraste:0, saturation:1, vignette:0, bloom:0, noirs:0, sable:0, ombres:[1, 1, 1], lumieres:[1, 1, 1]};
  function appliquerEtalonnage(e){
    const P = R3D.Post;
    if(!P || !P.regler || !A.etal) return;
    const j = A.etal, n = NUIT.etal;
    for(const c of ['contraste', 'saturation', 'vignette', 'bloom', 'noirs', 'sable']) _etal[c] = melange(j[c], n[c], e);
    for(let i = 0; i < 3; i++){ _etal.ombres[i] = melange(j.ombres[i], n.ombres[i], e); _etal.lumieres[i] = melange(j.lumieres[i], n.lumieres[i], e); }
    try { P.regler(_etal); } catch(err){ /* facultatif */ }
  }
  function appliquerAssombrissement(k){
    sombreApplique = k;
    const e = k*k*(3 - 2*k);
    U_CIEL.uSombre.value = e;
    scene.fog.color.copy(COUL.brume).lerp(COUL.brumeNuit, e*0.96);
    scene.background.copy(scene.fog.color);
    soleil.color.copy(COUL.soleil).lerp(COUL.soleilNuit, e);
    soleil.intensity = A.intSoleil*(1 - 0.74*e);
    hemi.color.copy(COUL.hemiCiel).lerp(COUL.hemiCielNuit, e);
    hemi.groundColor.copy(COUL.hemiSol).lerp(COUL.hemiSolNuit, e);
    // Sous le ciel d'invasion, le ciel et l'appoint retrouvent leur niveau d'avant les réglages de
    // lumière du jour (NUIT_LUMIERE) : la nuit n'est pas plus sombre qu'avant, les unités restent lisibles.
    const nl = NUIT_LUMIERE[R3D.ambiance] || NUIT_LUMIERE.midi;
    hemi.intensity = hemiBase*melange(1, nl[0], e);
    appoint.color.copy(COUL.appoint).lerp(COUL.appointNuit, e);
    appoint.intensity = appointBase*melange(1, nl[1], e);
    renderer.toneMappingExposure = A.expo*(1 - 0.14*e);
    if(matBrumeBasse) matBrumeBasse.uniforms.uCoul.value.copy(COUL.brumeBasse).lerp(COUL.brumeBasseNuit, e);
    appliquerEtalonnage(e);
    // Reflets et lumière du ciel : la carte d'environnement suit, par simple mélange de ses deux
    // versions filtrées au chargement (jour, ciel d'invasion).
    if(e !== sombreEnv) melangerEnvironnement(e);
  }
  function majAssombrissement(){
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now())/1000;
    const dt = clamp(t - tSombre, 0, 0.1);
    tSombre = t;
    if(sombre !== sombreCible){
      const pas = Math.max(dt, 0.004)*0.5;
      sombre = Math.abs(sombreCible - sombre) <= pas ? sombreCible : sombre + Math.sign(sombreCible - sombre)*pas;
    }
    if(sombre !== sombreApplique) appliquerAssombrissement(sombre);
  }

  // Rendu de l'image : par le post-traitement s'il est présent et actif, sinon directement.
  function rendreImage(dt){
    const P = R3D.Post;
    if(P && P.rendre && !postPanne && R3D.qualite !== 'basse'){
      try {
        if(!postPret){ postPret = true; P.init(renderer, scene, camera); P.definirQualite(R3D.qualite); }
        if(P.rendre(dt) !== false) return;
      } catch(e){
        postPanne = true;
        renderer.setRenderTarget(null);
        if(typeof console !== 'undefined') console.warn('[R3D] post-traitement coupé : ' + (e && e.message));
      }
    }
    renderer.render(scene, camera);
  }

  // Interface qui recouvre le canevas (plein écran) : barre en haut, panneau en bas.
  const UI_HAUT = 44, UI_BAS = 150;
  let largVue = 0, hautVue = 0, decalageActif = null;
  function appliquerDecalage(){
    if(!camera || !hautVue) return;
    const dy = enMenu() ? 0 : Math.round((UI_BAS - UI_HAUT)/2);
    const cle = largVue + 'x' + hautVue + '/' + dy;
    if(cle === decalageActif) return;
    decalageActif = cle;
    camera.aspect = largVue/hautVue;
    if(dy) camera.setViewOffset(largVue, hautVue, 0, dy, largVue, hautVue);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  // Densité de pixels du rendu : celle de l'écran, plafonnée par la qualité choisie, puis réduite
  // par la résolution adaptative (echelle).
  function densitePlafond(){
    return Math.min(window.devicePixelRatio || 1, QUALITES[R3D.qualite].ratio);
  }
  function densitePixels(){
    const p = densitePlafond();
    return Math.round(p*(R3D.adaptatif === false ? 1 : echelle)*1000)/1000;
  }

  // -----------------------------------------------------------------
  //  Résolution adaptative (qualités Moyenne et Élevée) et mesure du temps par image.
  //  Le temps entre deux images est lissé (moyenne glissante exponentielle). Au-dessus de 33 ms
  //  pendant 1,5 s cumulée, la densité de pixels baisse d'un palier ; sous 22 ms pendant 4 s, elle
  //  remonte d'un palier. Entre deux changements, 2 s d'attente (le temps lissé se recale). Une
  //  remontée suivie d'une baisse en moins de 12 s double la durée exigée pour la remontée
  //  suivante : pas d'oscillation. Les écarts de plus de 250 ms (onglet caché, chargement,
  //  pause du navigateur) sont ignorés.
  // -----------------------------------------------------------------
  const PALIERS = [1, 0.88, 0.77, 0.67, 0.58];
  const ADAPT = {lent:33, rapide:22, tBaisse:1.5, tHausse:4, attente:2, plancher:0.7};
  let echelle = 1, qualiteAdapt = null, tPrec = 0, msLisse = 16.7;
  const adapt = {haut:0, bas:0, attente:1, dureeHausse:ADAPT.tHausse, tHausse:-1e9, horloge:0};
  R3D.adaptatif = true;
  function changerEchelle(e){
    echelle = e;
    adapt.haut = adapt.bas = 0; adapt.attente = ADAPT.attente;
    if(largVue) R3D.redimensionner(largVue, hautVue);
  }
  function majAdaptatif(ms){
    const dtS = ms/1000;
    adapt.horloge += dtS;
    const actif = R3D.adaptatif !== false && R3D.qualite !== 'basse';
    if(!actif){ if(echelle !== 1) changerEchelle(1); return; }
    if(adapt.attente > 0){ adapt.attente -= dtS; return; }
    if(msLisse > ADAPT.lent){ adapt.haut += dtS; adapt.bas = 0; }
    else if(msLisse < ADAPT.rapide){ adapt.bas += dtS; adapt.haut = Math.max(0, adapt.haut - dtS); }
    else { adapt.haut = Math.max(0, adapt.haut - dtS*0.5); adapt.bas = 0; }
    const p = densitePlafond(), k = PALIERS.indexOf(echelle);
    if(adapt.haut >= ADAPT.tBaisse && k < PALIERS.length - 1 && p*PALIERS[k + 1] >= Math.min(p, ADAPT.plancher) - 1e-6){
      if(adapt.horloge - adapt.tHausse < 12) adapt.dureeHausse = Math.min(adapt.dureeHausse*2, 64);
      changerEchelle(PALIERS[k + 1]);
    } else if(adapt.bas >= adapt.dureeHausse && k > 0){
      adapt.tHausse = adapt.horloge;
      changerEchelle(PALIERS[k - 1]);
    }
  }
  function mesurerImage(){
    const t = performance.now();
    if(tPrec){
      const ms = t - tPrec;
      if(ms > 0 && ms < 250){
        msLisse += (ms - msLisse)*0.08;
        majAdaptatif(ms);
      }
    }
    tPrec = t;
  }
  // Diagnostic : temps lissé entre deux images (ms), rapport de résolution courant, appels de dessin
  // et triangles de la dernière image.
  R3D.perf = function(){
    const i = renderer ? renderer.info.render : null;
    return {ms:+msLisse.toFixed(2), echelle:R3D.adaptatif === false ? 1 : echelle, appels:i ? i.calls : 0, triangles:i ? i.triangles : 0};
  };
  R3D.redimensionner = function(l, h){
    if(!renderer) return;
    // La densité de l'écran peut avoir changé (zoom du navigateur, fenêtre passée sur un autre écran).
    const ratio = densitePixels();
    if(renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.setSize(l, h, false);
    largVue = l; hautVue = h; decalageActif = null;
    appliquerDecalage();
    try { if(R3D.Post && R3D.Post.redimensionner) R3D.Post.redimensionner(l, h); } catch(e){ /* facultatif */ }
  };

  function enMenu(){
    try { return typeof enJeu !== 'undefined' && !enJeu; } catch(e){ return false; }
  }
  const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _ctr = new THREE.Vector3();
  let derniereProj = '';
  R3D.majCamera = function(){
    if(!camera) return;
    const v = R3D.vue, menu = enMenu();
    const d = menu ? 1050 : v.distance;
    // Plus rasant de près (0,84 rad ≈ 48°), plus plongeant de loin (1,0 rad ≈ 57°). Menu : vue panoramique.
    const t = clamp((v.distance - v.distanceMin)/(v.distanceMax - v.distanceMin), 0, 1);
    const incl = menu ? 0.3 : 0.84 + 0.16*t;
    v.inclinaison = incl;
    camera.position.set(v.x, Math.sin(incl)*d, v.y + Math.cos(incl)*d);
    camera.lookAt(v.x, 0, v.y);
    const near = menu ? 20 : Math.max(8, d*0.05), far = menu ? 9000 : d*6 + 2500;
    const cle = near.toFixed(1) + '/' + far.toFixed(0);
    if(cle !== derniereProj){ camera.near = near; camera.far = far; camera.updateProjectionMatrix(); derniereProj = cle; }
    appliquerDecalage();
    camera.updateMatrixWorld();
    // Brouillard : proportionnel au zoom en jeu, fixe au menu ; densité selon l'ambiance.
    if(menu){ scene.fog.near = A.fog[2]; scene.fog.far = A.fog[3]; }
    else { scene.fog.near = d*A.fog[0]; scene.fog.far = d*A.fog[1]; }
    cadrerOmbres(v, d, menu);
  };

  // Ombres : le cadre de la carte d'ombre épouse la tranche de terrain réellement visible
  // (les quatre rayons des coins de l'image, entre le sol et la hauteur des plus grands objets),
  // mesurée dans le repère de la lumière. Toute la carte d'ombre sert donc à ce qu'on voit :
  // les ombres sont plus nettes qu'avec un carré centré sur le point visé.
  // Sans scintillement : la taille du cadre ne dépend que du zoom (elle ne varie pas quand la
  // caméra défile) et elle est arrondie par paliers ; son centre est aligné sur les texels.
  const H_OMBRE = 170, B_OMBRE = -12, PALIER_OMBRE = 40;
  const _coin = new THREE.Vector3(), _ray = new THREE.Vector3();
  let ombreL = 0, ombreH = 0;
  function cadrerOmbres(v, d, menu){
    const sc = soleil.shadow.camera, cam = camera.position;
    _X.crossVectors(_haut, dirSoleil).normalize();
    _Y.crossVectors(dirSoleil, _X).normalize();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    if(menu){
      // Vue panoramique : l'horizon est dans l'image, on garde un grand carré devant la caméra.
      _ctr.set(v.x, 0, v.y - 900);
      const px = _ctr.dot(_X), py = _ctr.dot(_Y);
      x0 = px - 1500; x1 = px + 1500; y0 = py - 1500; y1 = py + 1500;
    } else {
      const portee = d*3.2;
      for(let k = 0; k < 4; k++){
        _coin.set(k & 1 ? 1 : -1, k & 2 ? 1 : -1, 0.5).unproject(camera);
        _ray.copy(_coin).sub(cam).normalize();
        for(let n = 0; n < 2; n++){
          const h = n ? H_OMBRE : B_OMBRE;
          let t = _ray.y < -0.02 ? (h - cam.y)/_ray.y : portee;
          if(t > portee) t = portee;
          const wx = cam.x + _ray.x*t, wy = cam.y + _ray.y*t, wz = cam.z + _ray.z*t;
          const px = wx*_X.x + wy*_X.y + wz*_X.z, py = wx*_Y.x + wy*_Y.y + wz*_Y.z;
          if(px < x0) x0 = px; if(px > x1) x1 = px; if(py < y0) y0 = py; if(py > y1) y1 = py;
        }
      }
    }
    // Taille par paliers, avec hystérésis : elle ne change que lorsque le zoom change vraiment.
    const bl = (x1 - x0)*1.04, bh = (y1 - y0)*1.04;
    if(bl > ombreL || bl < ombreL - 2*PALIER_OMBRE) ombreL = Math.ceil(bl/PALIER_OMBRE)*PALIER_OMBRE;
    if(bh > ombreH || bh < ombreH - 2*PALIER_OMBRE) ombreH = Math.ceil(bh/PALIER_OMBRE)*PALIER_OMBRE;
    if(sc.right !== ombreL/2 || sc.top !== ombreH/2){
      sc.left = -ombreL/2; sc.right = ombreL/2; sc.top = ombreH/2; sc.bottom = -ombreH/2;
      sc.updateProjectionMatrix();
    }
    // Centre aligné sur les texels de la carte d'ombre.
    const n = soleil.shadow.mapSize.x, tx = ombreL/n, ty = ombreH/n;
    const cx = Math.round((x0 + x1)/2/tx)*tx, cy = Math.round((y0 + y1)/2/ty)*ty;
    // Le long de la lumière, le cadre reste à la hauteur du point visé (sans effet sur l'alignement).
    _ctr.set(0, 0, 0).addScaledVector(_X, cx).addScaledVector(_Y, cy).addScaledVector(dirSoleil, v.x*dirSoleil.x + v.y*dirSoleil.z);
    soleil.position.copy(_ctr).addScaledVector(dirSoleil, 3000);
    soleil.target.position.copy(_ctr);
    soleil.updateMatrixWorld(); soleil.target.updateMatrixWorld();
  }

  function versNdc(sx, sy){
    const r = renderer.domElement.getBoundingClientRect();
    v2.set((sx - r.left)/r.width*2 - 1, -((sy - r.top)/r.height)*2 + 1);
    return v2;
  }
  R3D.ecranVersSol = function(sx, sy){
    if(!renderer) return null;
    raycaster.setFromCamera(versNdc(sx, sy), camera);
    const p = raycaster.ray.intersectPlane(planSol, v3);
    return p ? {x:p.x, y:p.z} : null;
  };
  R3D.solVersEcran = function(x, y, h){
    v3.set(x, (h || 0) + R3D.hauteurSol(x, y), y).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return {x:(v3.x + 1)/2*r.width + r.left, y:(1 - v3.y)/2*r.height + r.top, devant:v3.z < 1};
  };
  R3D.pick = function(sx, sy, racines){
    if(!renderer || !racines || !racines.length) return null;
    raycaster.setFromCamera(versNdc(sx, sy), camera);
    const hits = raycaster.intersectObjects(racines, true);
    for(const h of hits){
      let o = h.object, garde = 0;
      while(o && (o.userData.entId === undefined) && garde++ < 64) o = o.parent;
      if(o && o.userData.entId === undefined) o = null;
      if(o && o.visible) return o.userData.entId;
    }
    return null;
  };
  // Longueur en pixels à l'écran d'un segment de longueur r posé au sol en (x, y).
  R3D.distanceEcran = function(x, y, r){
    if(!renderer) return r || 0;
    const a = R3D.solVersEcran(x - r/2, y), b = R3D.solVersEcran(x + r/2, y);
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  // Emprise de la vue au sol. Les coins qui visent l'horizon sont bornés à une distance raisonnable.
  R3D.empriseVue = function(){
    if(!renderer) return null;
    const r = renderer.domElement.getBoundingClientRect();
    const haut = r.top + UI_HAUT, bas = Math.max(haut + 1, r.bottom - UI_BAS);
    const coins = [[r.left, haut], [r.right, haut], [r.right, bas], [r.left, bas]];
    const maxD = R3D.vue.distance*3;
    const cam = camera.position;
    return coins.map(([x, y]) => {
      raycaster.setFromCamera(versNdc(x, y), camera);
      const dir = raycaster.ray.direction;
      let t = dir.y < -1e-4 ? -cam.y/dir.y : Infinity;
      const horiz = Math.hypot(dir.x, dir.z) || 1e-6;
      if(t*horiz > maxD) t = maxD/horiz;
      return {x:cam.x + dir.x*t, y:cam.z + dir.z*t};
    });
  };

  R3D.rendre = function(temps, dt){
    if(!renderer) return;
    const tt = (typeof performance !== 'undefined' ? performance.now() : Date.now())/1000;
    if(matMer) matMer.uniforms.uTemps.value = tt;
    if(matRiv) matRiv.uniforms.uTemps.value = tt;
    if(matBrumeBasse) matBrumeBasse.uniforms.uTemps.value = tt;
    if(matCiel) matCiel.uniforms.uTemps.value = tt;
    majAssombrissement();
    majNuages(tt);
    ciel.position.copy(camera.position);
    if(matFeux){ const k = 0.55 + 0.45*Math.max(0, Math.sin(tt*2.4)); matFeux.color.setRGB(k, k, k); }
    if(matFlammes) matFlammes.opacity = 0.7 + 0.25*Math.sin(tt*13.1)*Math.sin(tt*7.3 + 1);
    for(const f of faisceaux) f.rotation.y = tt*0.9;
    if(R3D.qualite === 'basse' && !solCalibre && !enMenu()) calibrerSol();
    mesurerImage();
    renderer.info.reset();
    rendreImage(dt);
  };

  // -----------------------------------------------------------------
  //  Préchauffage (appelé une fois pendant « Chargement… ») : chaque module crée hors champ un
  //  exemplaire de ses modèles et matières, puis tous les programmes de shaders de la scène sont
  //  compilés et une image est rendue hors écran, sans découpage par le champ de la caméra, pour
  //  envoyer aussi géométries et textures à la carte graphique. Rien n'est compilé en pleine partie.
  // -----------------------------------------------------------------
  R3D.prechauffer = function(){
    if(!renderer) return null;
    const t0 = performance.now(), p0 = renderer.info.programs ? renderer.info.programs.length : 0;
    for(const nom of ['Unites', 'Batiments', 'Effets', 'Aliens']){
      const mod = R3D[nom];
      try { if(mod && typeof mod.prechauffer === 'function') mod.prechauffer(); }
      catch(e){ if(typeof console !== 'undefined') console.warn('[R3D] préchauffage ' + nom + ' : ' + (e && e.message)); }
    }
    const caches = [], decoupes = [], rt = renderer.getRenderTarget();
    let cible = null;
    try {
      // Tout ce qui est caché (réserves d'effets, etc.) est compilé aussi : visible le temps du préchauffage.
      scene.traverse(o => {
        if(!o.visible){ o.visible = true; caches.push(o); }
        if(o.frustumCulled && (o.isMesh || o.isPoints || o.isLine || o.isSprite)){ o.frustumCulled = false; decoupes.push(o); }
      });
      // Les programmes dépendent de la destination : avec le post-traitement, la scène est dessinée
      // dans une cible (sans ton à ce stade, sortie sRGB) ; en Basse, directement à l'écran.
      const viaPost = R3D.qualite !== 'basse' && R3D.Post && R3D.Post.rendre && !postPanne;
      if(viaPost){
        cible = new THREE.WebGLRenderTarget(64, 64, {depthBuffer:true, stencilBuffer:false});
        cible.texture.encoding = THREE.sRGBEncoding;
      }
      majMatiereSol();
      renderer.setRenderTarget(cible);
      renderer.compile(scene, camera);
      // Une image sans découpage par le champ : envoi des tampons et textures, programmes des ombres.
      // (Hors écran avec le post-traitement ; à l'écran en Basse, sous l'écran de chargement.)
      renderer.render(scene, camera);
    } catch(e){
      if(typeof console !== 'undefined') console.warn('[R3D] préchauffage : ' + (e && e.message));
    } finally {
      for(const o of caches) o.visible = false;
      for(const o of decoupes) o.frustumCulled = true;
      renderer.setRenderTarget(rt);
      if(cible) cible.dispose();
    }
    // Post-traitement : ses programmes (qualité courante) sont compilés par une première image complète.
    try { renderer.info.reset(); rendreImage(0); } catch(e){ /* facultatif */ }
    if(R3D.qualite === 'basse') calibrerSol();
    tPrec = 0;
    const res = {ms:Math.round(performance.now() - t0), programmes:(renderer.info.programs ? renderer.info.programs.length : 0) - p0};
    R3D.durees.prechauffage = res.ms;
    return res;
  };
  // Diagnostic : nombre d'appels de dessin de la dernière image.
  R3D.infoRendu = function(){ return renderer ? {appels:renderer.info.render.calls, triangles:renderer.info.render.triangles, ambiance:M && M.ambiance, carte:M && M.id} : null; };
})();
