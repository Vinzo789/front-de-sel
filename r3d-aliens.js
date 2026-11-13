'use strict';
/* =====================================================================
   FRONT DE SEL — rendu 3D des envahisseurs (three.js r128).
   Le vaisseau-mère des Veilleurs, ses effets propres (rayon principal,
   cercle d'alerte au sol, éclats de bouclier) et la cinématique d'arrivée.

   Conception originale, « l'Œil brisé » : un moyeu facetté couvert de
   plaques de blindage aux joints lumineux, un cœur ventral gardé par des
   griffes qui s'écartent quand le rayon se charge, trois anneaux brisés
   (deux tournent lentement en sens contraires, le troisième porte les
   éperons) et de longs éperons dissymétriques : proue basse à bâbord,
   corne haute à tribord, épine dorsale vers la poupe.

   Organisation :
     1. Outils et accumulateur de géométrie (« Maille », facettes plates).
     2. Modèle du vaisseau (construit à la demande, une seule fois).
     3. Matériaux : coque (MeshStandardMaterial enrichi), cœur, bouclier.
     4. Réserves partagées : particules en quads instanciés (additives et
        opaques), rubans, débris, décalques au sol, deux lumières.
     5. Vaisseau : assemblage, animation, dégâts, destruction.
     6. Effets du moteur : 'rayon', 'chargeSol', 'bouclier'.
     7. Interface R3D.Aliens.
     8. Cinématique d'arrivée, interface R3D.Cinematique.

   Principes : aucune allocation par image (réserves fixes), dt = 0 fige
   tout (pause), rien ne dépend de requestAnimationFrame.
   Repères : jeu (x, y) -> three (X = x, Y = hauteur, Z = y) ; modèle :
   proue vers +X, hauteur +Y, tribord = +Z ; rotation.y = -angle.
   L'altitude du vaisseau est absolue (Y = alt) : sous lui la zone de jeu
   est plate, et il ne doit pas onduler au-dessus du relief hors carte.
   ===================================================================== */
(function(){
  const R3D = window.R3D = window.R3D || {};

  // =================================================================
  //  RÉGLAGES
  // =================================================================
  const TEINTE = '#7df9d0', TEINTE_CLAIRE = '#d9fff4';
  const ALT_JEU = 240;                 // altitude de jeu par défaut (UNITES.vaisseauMere.alt)
  const Y_COEUR = -30;                 // hauteur du cœur dans le repère du modèle
  const NB_GRIFFES = 7;
  const BOUCLIER_R = [350, 132, 300];  // demi-axes de la bulle du bouclier
  const SOMMET = 70;                   // point le plus haut du modèle au-dessus de son centre
  const MAX_ADD = 1100, SIM_ADD = 860; // sprites additifs (dont SIM_ADD particules simulées)
  const MAX_NORM = 720, SIM_NORM = 520;// sprites opaques (fumée, poussière, nuages)
  const MAX_RUBANS = 96, MAX_DEBRIS = 150, MAX_ONDES = 5, MAX_ALERTES = 3, MAX_IMPACTS = 6;
  const GRAVITE = -330;
  const DUREE_EPAVE = 16, DUREE_ENFONCE = 9;

  let pret = false, groupe = null, atlas = null;
  let horloge = 0;                     // horloge propre du module (figée en pause)
  let vaisseau = null;                 // l'unique vaisseau-mère (construit à la demande)
  let secousse = 0;                    // secousse de caméra en jeu (impact du rayon, écrasement)
  const vivantes = [];                 // racines pointables (R3D.pick)

  // =================================================================
  //  1. OUTILS
  // =================================================================
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lisse = (a, b, v) => { const t = clamp((v - a)/(b - a), 0, 1); return t*t*(3 - 2*t); };
  const lisse5 = t => { t = clamp(t, 0, 1); return t*t*t*(t*(6*t - 15) + 10); };
  const mel = (a, b, t) => a + (b - a)*t;
  const alea = (a, b) => a + Math.random()*(b - a);
  const RAD = Math.PI/180;
  function ecartAngle(a, b){ let d = (b - a) % (Math.PI*2); if(d > Math.PI) d -= Math.PI*2; if(d < -Math.PI) d += Math.PI*2; return d; }
  // Générateur pseudo-aléatoire à graine : le modèle est toujours le même.
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
  const cacheLin = {};
  // Couleur hexadécimale sRGB -> triplet linéaire.
  function lin(hex){
    if(cacheLin[hex]) return cacheLin[hex];
    const c = new THREE.Color(hex).convertSRGBToLinear();
    return (cacheLin[hex] = [c.r, c.g, c.b]);
  }
  const VERT = lin(TEINTE), VERT_CLAIR = lin(TEINTE_CLAIRE);
  // Référence de hauteur des effets : le terrain, ou la surface de l'eau (comme r3d-effets.js).
  function sol(x, y){
    const h = R3D.hauteurSol ? (R3D.hauteurSol(x, y) || 0) : 0;
    const m = R3D.niveauMer !== undefined && R3D.niveauMer !== null ? R3D.niveauMer : 0;
    return h > m ? h : m;
  }
  function hauteurDecal(x, y, r){
    return Math.max(sol(x, y), sol(x + r, y), sol(x - r, y), sol(x, y + r), sol(x, y - r)) + 1.3;
  }
  const qualite = () => R3D.qualite || 'moyenne';
  const debit = () => qualite() === 'basse' ? 0.5 : 1;       // facteur d'émission des particules
  const rien = function(){};
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();

  // Petits vecteurs [x, y, z] : utilisés à la construction du modèle seulement.
  const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vMul = (a, k) => [a[0]*k, a[1]*k, a[2]*k];
  const vMad = (a, b, k) => [a[0] + b[0]*k, a[1] + b[1]*k, a[2] + b[2]*k];
  const vDot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const vCross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
  const vNorm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
  const pol = (r, a, y) => [Math.cos(a)*r, y, Math.sin(a)*r];
  function centreDe(pts){
    const c = [0, 0, 0];
    for(const p of pts){ c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    return [c[0]/pts.length, c[1]/pts.length, c[2]/pts.length];
  }
  // Vrai si le triangle (a, b, c) tourne le dos au point ref.
  function dehors(a, b, c, ref){
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    return nx*((a[0] + b[0] + c[0])/3 - ref[0]) + ny*((a[1] + b[1] + c[1])/3 - ref[1]) + nz*((a[2] + b[2] + c[2])/3 - ref[2]) >= 0;
  }

  // -----------------------------------------------------------------
  //  Maille : accumulateur de triangles à facettes plates.
  //  Par sommet : position, couleur, aLum (> 0 : feu vert des Veilleurs ;
  //  < 0 : braise d'une plaie, visible une fois le blindage arraché),
  //  aPan (0 : permanent ; 1 : arraché sous 50 % ; 2 : arraché sous 25 %).
  // -----------------------------------------------------------------
  function Maille(rnd){
    this.p = []; this.c = []; this.l = []; this.g = [];
    this.rnd = rnd; this.coul = lin('#1b2a33'); this.lum = 0; this.pan = 0; this.varie = 0.14;
  }
  const Mp = Maille.prototype;
  Mp.style = function(hex, lum, varie){ this.coul = lin(hex); this.lum = lum || 0; this.varie = varie === undefined ? 0.14 : varie; return this; };
  Mp.nuance = function(){ return 1 + (this.rnd() - 0.5)*2*this.varie; };
  Mp.sommet = function(v, k){
    this.p.push(v[0], v[1], v[2]);
    this.c.push(this.coul[0]*k, this.coul[1]*k, this.coul[2]*k);
    this.l.push(this.lum); this.g.push(this.pan);
  };
  Mp.tri = function(a, b, c, k){ if(k === undefined) k = this.nuance(); this.sommet(a, k); this.sommet(b, k); this.sommet(c, k); return this; };
  // Triangle / quadrilatère orienté dos au point ref (inv : face au point ref).
  Mp.triD = function(a, b, c, ref, k, inv){ return (dehors(a, b, c, ref) !== !!inv) ? this.tri(a, b, c, k) : this.tri(a, c, b, k); };
  Mp.quadD = function(a, b, c, d, ref, inv){ const k = this.nuance(); this.triD(a, b, c, ref, k, inv); this.triD(a, c, d, ref, k, inv); return this; };
  // Peau tendue entre des sections successives (polygones de même nombre de points).
  Mp.loft = function(secs){
    const n = secs[0].length;
    for(let i = 0; i < secs.length - 1; i++){
      const A = secs[i], B = secs[i + 1], ref = centreDe(A.concat(B));
      for(let k = 0; k < n; k++){ const k2 = (k + 1) % n; this.quadD(A[k], A[k2], B[k2], B[k], ref); }
    }
    return this;
  };
  // Bouchon en éventail d'une section, dos à la section voisine.
  Mp.bout = function(sec, voisine){
    const c = centreDe(sec), ref = centreDe(voisine), n = sec.length;
    for(let k = 0; k < n; k++) this.triD(sec[k], sec[(k + 1) % n], c, ref);
    return this;
  };
  // Boîte orientée : centre c, demi-axes ax, ay, az.
  Mp.boiteAxes = function(c, ax, ay, az){
    const P = (i, j, k) => [c[0] + ax[0]*i + ay[0]*j + az[0]*k, c[1] + ax[1]*i + ay[1]*j + az[1]*k, c[2] + ax[2]*i + ay[2]*j + az[2]*k];
    const s = [P(-1,-1,-1), P(1,-1,-1), P(1,1,-1), P(-1,1,-1), P(-1,-1,1), P(1,-1,1), P(1,1,1), P(-1,1,1)];
    for(const f of [[0,1,2,3], [4,5,6,7], [0,1,5,4], [2,3,7,6], [1,2,6,5], [0,3,7,4]]) this.quadD(s[f[0]], s[f[1]], s[f[2]], s[f[3]], c);
    return this;
  };
  Mp.triangles = function(){ return this.p.length/9; };
  Mp.geometrie = function(){
    const pos = new Float32Array(this.p), n = pos.length/3, nor = new Float32Array(n*3);
    for(let i = 0; i < n; i += 3){
      const o = i*3;
      const ux = pos[o+3] - pos[o], uy = pos[o+4] - pos[o+1], uz = pos[o+5] - pos[o+2];
      const vx = pos[o+6] - pos[o], vy = pos[o+7] - pos[o+1], vz = pos[o+8] - pos[o+2];
      let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for(let k = 0; k < 3; k++){ nor[o + k*3] = nx; nor[o + k*3 + 1] = ny; nor[o + k*3 + 2] = nz; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setAttribute('aLum', new THREE.BufferAttribute(new Float32Array(this.l), 1));
    g.setAttribute('aPan', new THREE.BufferAttribute(new Float32Array(this.g), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };

  // =================================================================
  //  2. MODÈLE DU VAISSEAU
  // =================================================================
  const TEINTES_COQUE = ['#1b2a33', '#213440', '#19252e', '#27394a', '#2b2540'];
  const FEU = '#0c2a26';      // teinte de base (sombre) des surfaces lumineuses
  const PLAIE = '#0c0e11';    // métal à nu, calciné

  // Section hexagonale aplatie d'un anneau : rayon R, angle a, hauteur y, demi-tailles rx (radiale), ry.
  const HEXA = [[1, 0], [0.5, 1], [-0.5, 1], [-1, 0], [-0.5, -1], [0.5, -1]];
  function sectionArc(R, a, y, rx, ry){
    const c = Math.cos(a), s = Math.sin(a), pts = [];
    for(const [u, v] of HEXA){ const r = R + u*rx; pts.push([c*r, y + v*ry, s*r]); }
    return pts;
  }

  // Arc d'anneau de a0 à a1 (degrés). o : {pas, casse0, casse1 : bouts déchiquetés, ailettes : pas des
  // ailettes dorsales (degrés), hAilette, nu : sans liserés}.
  function arcAnneau(M, R, y, rx, ry, a0, a1, o){
    o = o || {};
    const rnd = M.rnd, pas = o.pas || 4, n = Math.max(2, Math.round((a1 - a0)/pas)), secs = [], angs = [];
    for(let i = 0; i <= n; i++){
      const a = a0 + (a1 - a0)*i/n;
      let k = 1, dy = 0, dr = 0;
      for(const [casse, ecart] of [[o.casse0, a - a0], [o.casse1, a1 - a]]){
        if(!casse || ecart >= 12) continue;
        const t = ecart/12;
        k *= 0.4 + 0.6*t*t + (rnd() - 0.5)*0.2*(1 - t); dy += (rnd() - 0.5)*7*(1 - t); dr += (rnd() - 0.5)*7*(1 - t);
      }
      secs.push(sectionArc(R + dr, a*RAD, y + dy, rx*k, ry*k)); angs.push(a*RAD);
    }
    // Coque, par tronçons de teintes différentes (plaques).
    let i = 0;
    while(i < n){
      const l = Math.min(n - i, 2 + Math.floor(rnd()*4));
      M.style(TEINTES_COQUE[Math.floor(rnd()*TEINTES_COQUE.length)], 0);
      M.loft(secs.slice(i, i + l + 1));
      i += l;
    }
    M.style(PLAIE, -0.9, 0.3);
    M.bout(secs[0], secs[1]); M.bout(secs[n], secs[n - 1]);
    if(!o.nu){
      // Liserés lumineux et feux de ventre (pas sur les bouts déchiquetés).
      const marge = 13*RAD, deb = a0*RAD + (o.casse0 ? marge : 0), fin = a1*RAD - (o.casse1 ? marge : 0), axe = [0, y, 0];
      for(let j = 0; j < n; j++){
        const b0 = angs[j], b1 = angs[j + 1];
        if(b0 < deb - 1e-6 || b1 > fin + 1e-6) continue;
        if(j % 4 !== 3){
          const Re = R + rx + 0.4;
          M.style(FEU, 1, 0);
          M.quadD(pol(Re, b0, y + 1.3), pol(Re, b1, y + 1.3), pol(Re, b1, y - 1.3), pol(Re, b0, y - 1.3), axe);
        }
        const Ri = R - rx - 0.4;
        M.style(FEU, 0.5, 0);
        M.quadD(pol(Ri, b0, y + 0.9), pol(Ri, b1, y + 0.9), pol(Ri, b1, y - 0.9), pol(Ri, b0, y - 0.9), axe, true);
        if(j % 3 === 1){
          const yb = y - ry - 0.35, bm = (b0 + b1)/2, db = (b1 - b0)*0.3;
          M.style(FEU, 0.95, 0);
          M.quadD(pol(R - 2.4, bm - db, yb), pol(R + 2.4, bm - db, yb), pol(R + 2.4, bm + db, yb), pol(R - 2.4, bm + db, yb), [0, y + 60, 0]);
        }
      }
    }
    if(o.ailettes){
      for(let a = a0 + (o.casse0 ? 16 : 4); a < a1 - (o.casse1 ? 16 : 4); a += o.ailettes){
        const b = a*RAD, er = [Math.cos(b), 0, Math.sin(b)], et = [-Math.sin(b), 0, Math.cos(b)];
        const h = (o.hAilette || 5)*(0.5 + rnd()), lr = rx*(0.3 + rnd()*0.35), lt = 1.2 + rnd()*2.2;
        M.style(TEINTES_COQUE[Math.floor(rnd()*TEINTES_COQUE.length)], 0);
        M.boiteAxes([er[0]*R, y + ry + h*0.5 - 0.5, er[2]*R], vMul(er, lr), [0, h*0.5, 0], vMul(et, lt));
      }
    }
    return secs;
  }

  // Éperon : peau en losange le long d'un chemin. tailles[i] = [demi-largeur, hauteur dessus, hauteur dessous].
  // o : {bouts : 1 début, 2 fin, 3 les deux ; nervure : 'cotes' | 'haut' (liseré lumineux)}.
  function eperon(M, chemin, tailles, o){
    o = o || {};
    const n = chemin.length, secs = [], S = [], V = [];
    // Axe de référence choisi une fois pour tout le chemin (pas de vrille).
    const g = vNorm(vSub(chemin[n - 1], chemin[0])), ref = Math.abs(g[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    for(let i = 0; i < n; i++){
      const t = vNorm(vSub(chemin[Math.min(n - 1, i + 1)], chemin[Math.max(0, i - 1)]));
      const s = vNorm(vCross(t, ref)), v = vCross(s, t), p = chemin[i], [w, hh, hb] = tailles[i];
      secs.push([vMad(p, s, w), vMad(p, v, hh), vMad(p, s, -w), vMad(p, v, -hb)]);
      S.push(s); V.push(v);
    }
    const coul = M.coul, lum = M.lum, varie = M.varie;
    M.loft(secs);
    const bouts = o.bouts === undefined ? 2 : o.bouts;
    if(bouts & 1) M.bout(secs[0], secs[1]);
    if(bouts & 2) M.bout(secs[n - 1], secs[n - 2]);
    if(o.nervure){
      M.style(FEU, 1, 0);
      for(let i = 0; i < n - 1; i++){
        const e0 = clamp(tailles[i][0]*0.13, 0.25, 1.4), e1 = clamp(tailles[i + 1][0]*0.13, 0.2, 1.4);
        if(o.nervure === 'haut'){
          const a = vMad(secs[i][1], V[i], 0.35), b = vMad(secs[i + 1][1], V[i + 1], 0.35);
          M.quadD(vMad(a, S[i], e0), vMad(b, S[i + 1], e1), vMad(b, S[i + 1], -e1), vMad(a, S[i], -e0), chemin[i]);
        } else for(const [k, sg] of [[0, 1], [2, -1]]){
          const a = vMad(secs[i][k], S[i], 0.35*sg), b = vMad(secs[i + 1][k], S[i + 1], 0.35*sg);
          M.quadD(vMad(a, V[i], e0), vMad(b, V[i + 1], e1), vMad(b, V[i + 1], -e1), vMad(a, V[i], -e0), chemin[i]);
        }
      }
    }
    M.coul = coul; M.lum = lum; M.varie = varie;
    return secs;
  }

  // Plaque de blindage posée sur le quadrilatère q (4 points), en relief de epais.
  function plaque(M, q, epais, retrait, ref){
    const c = centreDe(q);
    let n = vNorm(vCross(vSub(q[1], q[0]), vSub(q[3], q[0])));
    if(vDot(n, vSub(c, ref)) < 0) n = vMul(n, -1);
    const bas = q.map(p => vAdd(c, vMul(vSub(p, c), 1 - retrait*0.55)));
    const haut = q.map(p => vMad(vAdd(c, vMul(vSub(p, c), 1 - retrait)), n, epais));
    M.quadD(haut[0], haut[1], haut[2], haut[3], vMad(c, n, -30));
    const coul = M.coul;
    M.coul = [coul[0]*0.55, coul[1]*0.55, coul[2]*0.55];
    for(let k = 0; k < 4; k++){ const k2 = (k + 1) % 4; M.quadD(bas[k], bas[k2], haut[k2], haut[k], c); }
    M.coul = coul;
    return {c, n, haut, cHaut:vMad(c, n, epais)};
  }
  // Hublot : petit quadrilatère lumineux, centre c, axes u (largeur l) et v (hauteur h), normale n.
  function hublot(M, c, u, v, n, l, h){
    const a = vMad(vMad(c, u, -l/2), v, -h/2), b = vMad(vMad(c, u, l/2), v, -h/2);
    const d = vMad(vMad(c, u, l/2), v, h/2), e = vMad(vMad(c, u, -l/2), v, h/2);
    M.quadD(a, b, d, e, vMad(c, n, -10));
  }

  // Points du modèle où s'accrochent les traînées de plasma de la rentrée atmosphérique : [x, y, z, poids].
  const POINTS_PLASMA = [[318, -38, -54, 1], [236, 62, 75, 0.6], [150, -98, 33, 0.5], [135, 6, 193, 0.7], [135, 6, -193, 0.7],
    [-70, 56, -232, 0.4], [118, -6, 0, 0.9], [0, -72, 0, 0.8], [41, 6, 232, 0.5], [41, 6, -232, 0.5]];

  function construireModele(){
    const rnd = generateur(77413);
    const C = new Maille(rnd), A = new Maille(rnd), B = new Maille(rnd), G = new Maille(rnd);
    const plaies = [[], [], []];      // centres des pans arrachés, par niveau de dégâts
    const foyers = [];                // incendies : {p:[x, y, z], n:niveau}
    const teinte = () => TEINTES_COQUE[Math.floor(rnd()*TEINTES_COQUE.length)];
    const ORIG = [0, 8, 0];

    // ---------- Moyeu : dôme facetté, allongé vers la proue ----------
    const NS = 14, EX = 1.28;
    const PROFIL = [[20, 60], [54, 50], [84, 31], [101, 9], [94, -9], [68, -25], [42, -34]];   // [rayon, hauteur]
    const DEC = [-14, -10, -5, 0, 2, 4, 4];                                                    // décalage vers la poupe
    const irreg = []; for(let i = 0; i < NS; i++) irreg.push(1 + (rnd() - 0.5)*0.12);
    const pt = (i, j) => {
      const a = (i % NS)/NS*Math.PI*2, f = irreg[i % NS];
      return [Math.cos(a)*PROFIL[j][0]*EX*f + DEC[j], PROFIL[j][1], Math.sin(a)*PROFIL[j][0]*f];
    };
    const panDe = (i, j) => {
      if((i === 1 || i === 2) && j >= 1 && j <= 3) return 1;
      if(i === 7 && (j === 2 || j === 3)) return 1;
      if(i >= 9 && i <= 11 && j <= 2) return 2;
      if(i === 5 && (j === 3 || j === 4)) return 2;
      return 0;
    };
    for(let j = 0; j < PROFIL.length - 1; j++) for(let i = 0; i < NS; i++){
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], pan = panDe(i, j);
      // Sous-couche : joints lumineux entre les plaques, ou plaie incandescente sous un pan arrachable.
      C.pan = 0;
      if(pan) C.style(PLAIE, -0.9, 0.35); else C.style('#0f1a20', 0.42, 0.1);
      C.quadD(q[0], q[1], q[2], q[3], ORIG);
      C.pan = pan; C.style(teinte(), 0);
      const pl = plaque(C, q, j >= 4 ? 1.8 : 2.6, 0.07, ORIG);
      if(pan){
        plaies[pan].push(pl.c);
        if(rnd() < 0.8) foyers.push({p:vMad(pl.c, pl.n, 2), n:pan});
      }
      const u = vNorm(vSub(pl.haut[1], pl.haut[0])), v = vNorm(vSub(pl.haut[3], pl.haut[0]));
      const larg = Math.hypot(pl.haut[1][0] - pl.haut[0][0], pl.haut[1][1] - pl.haut[0][1], pl.haut[1][2] - pl.haut[0][2]);
      if(j === 2 || j === 3){
        // Hublots de la ceinture (certains éteints).
        for(let k = 0; k < 4; k++){
          const allume = rnd() < 0.72;
          C.style(allume ? FEU : '#06090b', allume ? 0.55 + rnd()*0.45 : 0, 0);
          hublot(C, vMad(vMad(pl.cHaut, u, (k - 1.5)*larg*0.19), pl.n, 0.3), u, v, pl.n, larg*0.11, 2.4);
        }
      } else if(j <= 1 && rnd() < 0.75){
        // Excroissances du dessus (arrachées avec leur plaque).
        const hh = 1.5 + rnd()*4, sx = larg*(0.1 + rnd()*0.16), sz = 3 + rnd()*6;
        C.style(teinte(), 0);
        C.boiteAxes(vMad(vMad(pl.cHaut, u, (rnd() - 0.5)*larg*0.3), pl.n, hh), vMul(u, sx), vMul(pl.n, hh), vMul(v, sz));
      }
    }
    C.pan = 0; C.style('#213440', 0);
    const apex = [DEC[0] - 2, 67, 0];
    for(let i = 0; i < NS; i++) C.triD(pt(i, 0), pt(i + 1, 0), apex, ORIG);
    // Gorge lumineuse autour du cœur.
    const J = PROFIL.length - 1;
    const gorge = i => { const a = (i % NS)/NS*Math.PI*2; return [Math.cos(a)*29*EX*0.92 + 4, -18, Math.sin(a)*29]; };
    C.style('#123a3a', 0.6, 0.1);
    for(let i = 0; i < NS; i++) C.quadD(pt(i, J), pt(i + 1, J), gorge(i + 1), gorge(i), [0, -80, 0], true);
    // Nacelles lumineuses sous la lèvre.
    for(let k = 0; k < 10; k++){
      const a = (k + 0.5)/10*Math.PI*2, er = [Math.cos(a), 0, Math.sin(a)], et = [-Math.sin(a), 0, Math.cos(a)];
      C.style(FEU, 0.9, 0);
      C.boiteAxes([er[0]*55*EX + 4, -31, er[2]*55], vMul(er, 4), [0, 1.8, 0], vMul(et, 2.4));
    }
    // Couronne de lames, plus hautes vers la poupe.
    for(let k = 0; k < 9; k++){
      const a = k/9*Math.PI*2 + 0.25, ca = Math.cos(a), sa = Math.sin(a);
      const h = (14 + 36*(0.5 - 0.5*ca))*(0.7 + rnd()*0.5);
      const b = [ca*36*EX + DEC[0], 52, sa*36];
      C.style(teinte(), 0);
      eperon(C, [b, [b[0] + ca*h*0.18 - h*0.25, b[1] + h, b[2] + sa*h*0.18]], [[5.5, 3.2, 3.2], [0.5, 0.4, 0.4]], {bouts:2, nervure:'cotes'});
    }

    // ---------- Éperons ----------
    // Proue basse, à bâbord : passe sous les anneaux tournants.
    C.style('#213440', 0);
    eperon(C, [[56, -36, -26], [128, -58, -36], [192, -62, -44], [258, -50, -50], [304, -40, -53], [320, -37, -54]],
      [[20, 10, 16], [17, 10, 22], [13, 8, 17], [8, 6, 9], [3, 3, 3], [0.4, 0.4, 0.4]], {bouts:2, nervure:'cotes'});
    C.style('#19252e', 0);
    eperon(C, [[118, -70, -36], [148, -88, -40], [172, -104, -43]], [[5, 6, 6], [3.5, 5, 5], [0.5, 0.5, 0.5]], {bouts:2});
    // Corne haute, à tribord (la pointe se brise sous 25 %).
    C.style('#27394a', 0);
    eperon(C, [[46, 38, 46], [120, 52, 56], [185, 60, 66]], [[13, 8, 7], [10, 7, 6], [6, 5, 4]], {bouts:2, nervure:'cotes'});
    C.pan = 2;
    eperon(C, [[185, 60, 66], [214, 62, 71], [238, 62, 75]], [[6, 5, 4], [3.4, 3, 2.4], [0.4, 0.4, 0.4]], {bouts:2, nervure:'cotes'});
    plaies[2].push([210, 62, 70]);
    C.pan = 0;
    // Croc ventral.
    C.style('#1b2a33', 0);
    eperon(C, [[66, -34, 24], [104, -58, 30], [138, -82, 33], [150, -98, 33]], [[9, 6, 8], [7, 5, 7], [4, 3, 4], [0.4, 0.4, 0.4]], {bouts:2, nervure:'cotes'});
    // Épine dorsale vers la poupe, avec ses piquants.
    C.style('#213440', 0);
    const epine = [[-62, 40, 10], [-125, 52, 18], [-185, 60, 24], [-245, 58, 30], [-284, 48, 34], [-302, 43, 36]];
    eperon(C, epine, [[15, 10, 7], [13, 9, 6], [10, 8, 5], [7, 6, 4], [3, 3, 2], [0.4, 0.4, 0.4]], {bouts:2, nervure:'haut'});
    for(let k = 1; k <= 4; k++){
      const p = epine[k], h = 30 - k*4;
      C.style(teinte(), 0);
      eperon(C, [[p[0], p[1] + 4, p[2]], [p[0] - h*0.6, p[1] + 4 + h, p[2] + 2]], [[4, 3, 3], [0.4, 0.4, 0.4]], {bouts:2});
    }
    // Aile courte à bâbord.
    C.style('#27394a', 0);
    eperon(C, [[-10, 34, -70], [-30, 50, -125], [-52, 58, -185], [-70, 56, -232]], [[10, 6, 5], [8, 5, 4], [5, 4, 3], [0.4, 0.4, 0.4]], {bouts:2, nervure:'cotes'});

    // ---------- Anneau extérieur (fixe), brisé à l'avant ----------
    const RC = 236, YC = 6, RXC = 17, RYC = 12;
    arcAnneau(C, RC, YC, RXC, RYC, 55, 150, {casse0:true, ailettes:9, hAilette:9});
    C.pan = 2;
    arcAnneau(C, RC, YC, RXC, RYC, 150, 172, {});
    plaies[2].push(pol(RC, 161*RAD, YC));
    foyers.push({p:pol(RC, 152*RAD, YC + 8), n:2}, {p:pol(RC, 171*RAD, YC + 8), n:2});
    C.pan = 0;
    // Treillis mis à nu quand ce tronçon est arraché.
    C.style(PLAIE, -0.8, 0.3);
    for(const [dr, dy] of [[-8, 4], [8, 4], [0, -6]]){
      const secs = [];
      for(let a = 149; a <= 173; a += 4) secs.push(sectionArc(RC + dr, a*RAD, YC + dy, 2.2, 2.2));
      C.loft(secs);
    }
    arcAnneau(C, RC, YC, RXC, RYC, 172, 305, {casse1:true, ailettes:9, hAilette:9});
    arcAnneau(C, RC + 12, YC - 9, RXC*0.85, RYC*0.85, 318, 343, {casse0:true, casse1:true});   // fragment détaché
    // Rails extérieurs et leurs entretoises.
    for(const [a0, a1] of [[82, 141], [200, 270]]){
      arcAnneau(C, 263, YC + 2, 4, 3, a0, a1, {casse0:true, casse1:true, pas:5, nu:true});
      for(let a = a0 + 8; a < a1 - 6; a += 12){
        const b = a*RAD, er = [Math.cos(b), 0, Math.sin(b)], et = [-Math.sin(b), 0, Math.cos(b)];
        C.style('#19252e', 0);
        C.boiteAxes([er[0]*256.5, YC + 2, er[2]*256.5], vMul(er, 4.5), [0, 1.4, 0], vMul(et, 1.4));
      }
    }
    // Crocs sous l'anneau, lames au-dessus.
    for(const [a, len] of [[70, 34], [96, 58], [124, 30], [198, 46], [224, 72], [252, 38], [288, 54]]){
      const b = a*RAD, ca = Math.cos(b), sa = Math.sin(b), r1 = RC + len*0.12;
      C.style(teinte(), 0);
      eperon(C, [[ca*RC, YC - 10, sa*RC], [ca*r1, YC - 12 - len, sa*r1]], [[7.5, 6, 6], [0.4, 0.4, 0.4]], {bouts:2, nervure:'cotes'});
    }
    for(const [a, len] of [[110, 26], [186, 44], [242, 30], [276, 20]]){
      const b = a*RAD, ca = Math.cos(b), sa = Math.sin(b), r1 = RC - len*0.15;
      C.style(teinte(), 0);
      eperon(C, [[ca*RC, YC + 10, sa*RC], [ca*r1, YC + 12 + len, sa*r1]], [[6, 5, 5], [0.4, 0.4, 0.4]], {bouts:2});
    }
    // Nervures : arcs-boutants du moyeu à l'anneau extérieur, par-dessus les anneaux tournants.
    for(const a of [80, 130, 178, 228, 282]){
      const b = a*RAD, ca = Math.cos(b), sa = Math.sin(b), k0 = 80*Math.hypot(ca*EX, sa);
      const P = (r, y) => [ca*r, y, sa*r];
      C.pan = a === 228 ? 1 : 0; C.style(teinte(), 0);
      eperon(C, [P(k0, 30), P(k0 + 38, 50), P(170, 59), P(206, 52), P(225, 24), P(232, 14)],
        [[5.5, 6, 4], [4.8, 5, 3.5], [4.2, 5, 3], [4.2, 5, 3], [4.8, 5, 3.5], [5.5, 5, 4]], {bouts:0, nervure:'haut'});
      if(C.pan){ plaies[1].push(P(170, 59)); foyers.push({p:P(k0 + 6, 34), n:1}); }
    }
    C.pan = 0;

    // ---------- Anneaux tournants (repère propre : leur plan) ----------
    arcAnneau(A, 128, 0, 12, 8.5, 12, 150, {casse0:true, casse1:true, ailettes:11, hAilette:4});
    arcAnneau(A, 128, 0, 12, 8.5, 198, 326, {casse0:true, casse1:true, ailettes:11, hAilette:4});
    arcAnneau(B, 182, 0, 15, 10, -32, 78, {casse0:true, casse1:true, ailettes:10, hAilette:5});
    arcAnneau(B, 182, 0, 15, 10, 118, 190, {casse0:true, casse1:true, ailettes:10, hAilette:5});
    arcAnneau(B, 182, 0, 15, 10, 226, 300, {casse0:true, casse1:true, ailettes:10, hAilette:5});

    // ---------- Griffe du cœur (charnière à l'origine, pointe vers le bas et l'axe) ----------
    G.style('#213440', 0);
    eperon(G, [[0, 0, 0], [3, -15, 0], [-3, -31, 0], [-15, -45, 0]], [[5, 4.5, 4.5], [4.2, 3.6, 4], [2.6, 2.4, 2.6], [0.4, 0.4, 0.4]], {bouts:3, nervure:'cotes'});

    // Points de la coque où éclatent les explosions de la destruction.
    const points = [];
    for(let k = 0; k < 48; k++){ const i = Math.floor(rnd()*(C.p.length/3))*3; points.push([C.p[i], C.p[i + 1], C.p[i + 2]]); }
    const triangles = {corps:C.triangles(), anneauA:A.triangles(), anneauB:B.triangles(), griffes:G.triangles()*NB_GRIFFES};
    return {corps:C.geometrie(), anneauA:A.geometrie(), anneauB:B.geometrie(), griffe:G.geometrie(), plaies, foyers, points, triangles};
  }

  // =================================================================
  //  3. MATÉRIAUX
  // =================================================================
  // Brouillard (réglé par r3d-scene.js), sans dépendre des noms internes des morceaux de shader de three.
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
  const uniformes = u => THREE.UniformsUtils.merge([THREE.UniformsLib.fog, u]);

  // Carte d'environnement propre à la coque : ciel sarcelle, horizon clair, dessous violet.
  // Les facettes prennent ainsi des reflets différents selon leur orientation : c'est l'irisation.
  let envCoque = null;
  function creerEnvCoque(){
    if(envCoque || !R3D.renderer || !THREE.PMREMGenerator) return envCoque;
    try {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
      const g = cv.getContext('2d'), d = g.createLinearGradient(0, 0, 0, 128);
      d.addColorStop(0, '#04121a'); d.addColorStop(0.24, '#0e3a44'); d.addColorStop(0.43, '#2f8c8a'); d.addColorStop(0.495, '#d6fff0');
      d.addColorStop(0.53, '#5a3d86'); d.addColorStop(0.72, '#24183e'); d.addColorStop(1, '#06060c');
      g.fillStyle = d; g.fillRect(0, 0, 256, 128);
      for(const [x, y, r, c0, c1] of [[0.3, 0.2, 34, 'rgba(255,217,160,0.9)', 'rgba(255,217,160,0)'], [0.78, 0.64, 30, 'rgba(192,96,255,0.55)', 'rgba(192,96,255,0)']]){
        const s = g.createRadialGradient(x*256, y*128, 0, x*256, y*128, r);
        s.addColorStop(0, c0); s.addColorStop(1, c1); g.fillStyle = s; g.fillRect(0, 0, 256, 128);
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.encoding = THREE.sRGBEncoding; tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(R3D.renderer);
      envCoque = pm.fromEquirectangular(tex).texture;
      pm.dispose(); tex.dispose();
    } catch(err){ envCoque = null; }      // sans carte : rendu correct, simplement plus mat
    return envCoque;
  }

  // Coque : MeshStandardMaterial enrichi (feux et braises par sommet, pans arrachés, irisation
  // rasante, échauffement de la rentrée atmosphérique, transparence tramée, carbonisation).
  function creerMatCoque(U){
    const mat = new THREE.MeshStandardMaterial({vertexColors:true, roughness:0.4, metalness:0.7, envMap:creerEnvCoque(), envMapIntensity:1.1});
    mat.onBeforeCompile = sh => {
      for(const k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aLum;
          attribute float aPan;
          uniform float uDegats;
          uniform vec3 uPosCoeur;
          varying float vLum;
          varying vec3 vNormM;
          varying vec3 vPosM;
          varying vec3 vVersCoeur;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLum = aLum; vPosM = position;
          vec4 posMonde = vec4(position, 1.0);
          vec3 norMonde = normal;
          #ifdef USE_INSTANCING
            posMonde = instanceMatrix * posMonde;
            norMonde = mat3(instanceMatrix) * norMonde;
          #endif
          vNormM = normalize(mat3(modelMatrix) * norMonde);
          vVersCoeur = uPosCoeur - (modelMatrix * posMonde).xyz;
          if(aPan > 0.5 && uDegats > aPan - 0.5) transformed *= 0.0;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uPulse;
          uniform float uBraise;
          uniform float uChauffe;
          uniform float uTempsV;
          uniform float uVoile;
          uniform float uCarbon;
          uniform vec3 uDirChauffe;
          uniform vec3 uCoulLum;
          uniform float uLumC;
          varying float vLum;
          varying vec3 vNormM;
          varying vec3 vPosM;
          varying vec3 vVersCoeur;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if(uVoile < 0.995){
            float trame = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if(trame > uVoile) discard;
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float feuV = max(vLum, 0.0), braise = max(-vLum, 0.0);
            float scint = 0.86 + 0.14*sin(uTempsV*3.1 + vPosM.x*0.21 + vPosM.z*0.17);
            totalEmissiveRadiance += uCoulLum*feuV*uPulse*scint*2.3;
            float rougeoie = 0.62 + 0.24*sin(uTempsV*4.3 + vPosM.x*0.13 + vPosM.y*0.19) + 0.14*sin(uTempsV*7.9 - vPosM.z*0.17 + vPosM.y*0.11);
            totalEmissiveRadiance += vec3(1.0, 0.30, 0.05)*braise*uBraise*rougeoie*1.8;
            float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
            vec3 iris = 0.5 + 0.5*cos(6.2832*(vec3(0.0, 0.33, 0.67) + nv*1.4 + vPosM.y*0.004));
            totalEmissiveRadiance += iris*vec3(0.22, 0.55, 0.62)*pow(1.0 - nv, 2.2)*0.16*(1.0 - uCarbon);
            float ch = max(dot(normalize(vNormM), uDirChauffe), 0.0);
            totalEmissiveRadiance += (vec3(1.0, 0.40, 0.10)*pow(ch, 1.5)*1.7 + vec3(1.0, 0.9, 0.7)*pow(ch, 6.0))*uChauffe;
            // Lueur du cœur sur la coque (tient lieu de lumière ponctuelle, sans en ajouter à la scène).
            float distC = max(length(vVersCoeur), 1.0);
            float versC = max(dot(normalize(vNormM), vVersCoeur/distC), 0.0)*pow(1.0 - smoothstep(40.0, 560.0, distC), 2.0);
            totalEmissiveRadiance += uCoulLum*(diffuseColor.rgb*2.5 + 0.035)*versC*uLumC*(1.0 - uCarbon);
            diffuseColor.rgb *= 1.0 - 0.7*uCarbon;
          }`);
    };
    mat.customProgramCacheKey = () => 'veilleur-coque';
    return mat;
  }

  function creerMatCoeur(){
    return new THREE.ShaderMaterial({
      uniforms:{uT:{value:0}, uCharge:{value:0}, uTir:{value:0}, uVie:{value:1}, uCoul:{value:new THREE.Color(TEINTE).convertSRGBToLinear()}},
      vertexShader:`
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        void main(){
          vP = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader:`
        uniform float uT;
        uniform float uCharge;
        uniform float uTir;
        uniform float uVie;
        uniform vec3 uCoul;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        void main(){
          float nv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
          float veines = 0.5 + 0.5*sin(vP.y*0.42 + uT*2.4 + 2.5*sin(vP.x*0.27 + uT*0.9) + 2.0*sin(vP.z*0.31 - uT*1.3));
          float pouls = 0.75 + 0.25*sin(uT*(2.0 + 9.0*uCharge));
          vec3 chaud = mix(uCoul, vec3(1.0), clamp(uCharge*uCharge + uTir, 0.0, 1.0));
          vec3 col = chaud*(0.35 + 0.65*veines)*pouls*(0.55 + 2.4*uCharge + 2.5*uTir);
          col += uCoul*pow(1.0 - nv, 2.0)*0.9;
          col = mix(vec3(0.015, 0.02, 0.025), col, uVie);
          gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
        }`,
      toneMapped:false,
    });
  }

  // Bouclier : bulle invisible au repos. Une onde alvéolée part de chaque impact ; frisson
  // général quand il encaisse, alvéoles qui s'éteignent une à une quand il cède.
  function creerMatBouclier(){
    const imp = []; for(let i = 0; i < MAX_IMPACTS; i++) imp.push(new THREE.Vector4(0, 1, 0, -1));
    return new THREE.ShaderMaterial({
      uniforms:{uImp:{value:imp}, uT:{value:0}, uFrisson:{value:0}, uRupture:{value:0}, uEtat:{value:1}, uSouffle:{value:0},
        uCoul:{value:new THREE.Color(TEINTE).convertSRGBToLinear()}},
      vertexShader:`
        varying vec3 vDir;
        varying vec3 vN;
        varying vec3 vV;
        void main(){
          vDir = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader:`
        uniform vec4 uImp[${MAX_IMPACTS}];
        uniform float uT;
        uniform float uFrisson;
        uniform float uRupture;
        uniform float uEtat;
        uniform float uSouffle;
        uniform vec3 uCoul;
        varying vec3 vDir;
        varying vec3 vN;
        varying vec3 vV;
        float hexa(vec2 p, out vec2 id){
          const vec2 s = vec2(1.0, 1.7320508);
          vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0))/s.xyxy) + 0.5;
          vec4 h = vec4(p - hC.xy*s, p - (hC.zw + 0.5)*s);
          bool premier = dot(h.xy, h.xy) < dot(h.zw, h.zw);
          vec2 q = abs(premier ? h.xy : h.zw);
          id = premier ? hC.xy : hC.zw + 0.5;
          return max(dot(q, s*0.5), q.x);
        }
        float hasard(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          vec2 id;
          float h = hexa(vec2(atan(d.z, d.x)/6.2831853*44.0, asin(clamp(d.y, -1.0, 1.0))*9.0), id);
          float bord = smoothstep(0.40, 0.49, h);
          float total = 0.0;
          for(int i = 0; i < ${MAX_IMPACTS}; i++){
            float age = uImp[i].w;
            if(age < 0.0) continue;
            float dist = acos(clamp(dot(d, uImp[i].xyz), -1.0, 1.0));
            float anneau = 1.0 - smoothstep(0.0, 0.16, abs(dist - age*1.25));
            float coeur = (1.0 - smoothstep(0.0, 0.5, dist))*exp(-age*4.0);
            total += (anneau*0.8*exp(-age*2.4) + coeur*1.4)*(1.0 - smoothstep(0.9, 1.6, age));
          }
          float nv = abs(dot(normalize(vN), normalize(vV)));
          float fres = pow(1.0 - nv, 2.5);
          float faible = 1.0 - uEtat;
          float scint = 0.72 + 0.28*sin(uT*31.0 + id.x*17.0 + id.y*23.0);
          float a = total*(0.30 + 0.70*bord)*mix(1.0, scint, faible);
          a += uFrisson*fres*(0.18 + 0.5*bord);
          a += step(1.0 - uRupture, hasard(id)*0.999)*step(0.001, uRupture)*(0.2 + 0.8*bord)*(0.35 + 0.65*uRupture);
          a += uSouffle*(0.35 + 0.65*bord);
          vec3 col = mix(uCoul, vec3(0.85, 0.75, 1.0), faible*0.45);
          col = mix(col, vec3(1.0), clamp(total*0.5 + uRupture*0.3, 0.0, 0.8));
          if(a < 0.004) discard;
          gl_FragColor = linearToOutputTexel(vec4(col, min(a, 1.0)));
        }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false,
    });
  }

  // =================================================================
  //  4. RÉSERVES PARTAGÉES
  // =================================================================
  // ----- Atlas 2 × 2 : lueur douce, bouffée, étincelle, hexagone -----
  function creerAtlas(){
    const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N*2;
    const g = cv.getContext('2d'), rnd = generateur(4242);
    const origine = (cx, cy) => [cx*N, (1 - cy)*N];      // la texture est retournée verticalement (flipY)
    let [ox, oy] = origine(0, 0);
    let d = g.createRadialGradient(ox + N/2, oy + N/2, 0, ox + N/2, oy + N/2, N/2);
    d.addColorStop(0, 'rgba(255,255,255,1)'); d.addColorStop(0.18, 'rgba(255,255,255,0.72)'); d.addColorStop(0.42, 'rgba(255,255,255,0.24)');
    d.addColorStop(0.7, 'rgba(255,255,255,0.06)'); d.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = d; g.fillRect(ox, oy, N, N);
    [ox, oy] = origine(1, 0);
    for(let k = 0; k < 38; k++){
      const a = rnd()*6.2832, e = Math.pow(rnd(), 0.7)*N*0.24, r = N*(0.10 + rnd()*0.12), x = ox + N/2 + Math.cos(a)*e, y = oy + N/2 + Math.sin(a)*e;
      const q = g.createRadialGradient(x, y, 0, x, y, r);
      q.addColorStop(0, 'rgba(255,255,255,0.30)'); q.addColorStop(0.6, 'rgba(255,255,255,0.14)'); q.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = q; g.fillRect(x - r, y - r, 2*r, 2*r);
    }
    [ox, oy] = origine(0, 1);
    d = g.createRadialGradient(ox + N/2, oy + N/2, 0, ox + N/2, oy + N/2, N*0.2);
    d.addColorStop(0, 'rgba(255,255,255,1)'); d.addColorStop(0.4, 'rgba(255,255,255,0.5)'); d.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = d; g.fillRect(ox, oy, N, N);
    for(const vertical of [false, true]){
      const l = g.createLinearGradient(ox + (vertical ? N/2 : 4), oy + (vertical ? 4 : N/2), ox + (vertical ? N/2 : N - 4), oy + (vertical ? N - 4 : N/2));
      l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(0.5, 'rgba(255,255,255,0.85)'); l.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = l;
      if(vertical) g.fillRect(ox + N/2 - 1.5, oy + 4, 3, N - 8); else g.fillRect(ox + 4, oy + N/2 - 1.5, N - 8, 3);
    }
    [ox, oy] = origine(1, 1);
    const hexagone = r => { g.beginPath(); for(let k = 0; k < 6; k++){ const a = k/6*6.2832; const x = ox + N/2 + Math.cos(a)*r, y = oy + N/2 + Math.sin(a)*r; if(k) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); };
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 8;
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 4; hexagone(N*0.34); g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 2; hexagone(N*0.2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.10)'; hexagone(N*0.34); g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    return tex;
  }

  // ----- Sprites : quads instanciés face à la caméra (pas de limite de taille, contrairement aux points) -----
  const SPRITE_V = `
    attribute vec3 iPos;
    attribute vec4 iCoul;
    attribute vec4 iDon;                 // taille (monde), rotation, case d'atlas, avance (en tailles)
    varying vec2 vUv;
    varying vec4 vCoul;
    varying vec2 vCase;
    ${BRUME_V}
    void main(){
      vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
      float c = cos(iDon.y), s = sin(iDon.y);
      mv.xy += vec2(position.x*c - position.y*s, position.x*s + position.y*c) * iDon.x;
      gl_Position = projectionMatrix * mv;
      if(iDon.w > 0.0){
        // Avance : pour le test de profondeur seulement, le halo est rapproché de la caméra. Un grand
        // éclat posé au sol n'est plus tranché net par le terrain qui passe devant sa moitié basse.
        vec4 pr = projectionMatrix * vec4(mv.xy, min(mv.z + iDon.w*iDon.x, mv.z*0.3), 1.0);
        gl_Position.z = pr.z/pr.w*gl_Position.w;
      }
      vUv = uv; vCoul = iCoul;
      vCase = vec2(mod(iDon.z, 2.0), floor(iDon.z*0.5));
      ${BRUME_V_MAIN}
    }`;
  const SPRITE_F = `
    uniform sampler2D uAtlas;
    varying vec2 vUv;
    varying vec4 vCoul;
    varying vec2 vCase;
    ${BRUME_F}
    void main(){
      float masque = texture2D(uAtlas, (vCase + clamp(vUv, 0.02, 0.98))*0.5).a;
      float a = masque * vCoul.a;
      if(a < 0.004) discard;
      float f = facteurBrume();
      #ifdef ADDITIF
        gl_FragColor = linearToOutputTexel(vec4(vCoul.rgb*(1.0 - f), a));
      #else
        gl_FragColor = vec4(vCoul.rgb*(0.78 + 0.5*(vUv.y - 0.5)), a);     // le haut de la bouffée prend la lumière
        #if defined( TONE_MAPPING )
          gl_FragColor.rgb = toneMapping(gl_FragColor.rgb);
        #endif
        gl_FragColor = linearToOutputTexel(gl_FragColor);
        #ifdef USE_FOG
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, f);
        #endif
      #endif
    }`;
  let lotAdd = null, lotNorm = null;
  function creerLot(max, nSim, additif){
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5,-0.5,0, 0.5,-0.5,0, 0.5,0.5,0, -0.5,0.5,0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 1,1, 0,1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const L = {max, nSim, prochain:0, nImm:0,
      pos:new Float32Array(nSim*3), vel:new Float32Array(nSim*3), age:new Float32Array(nSim), vie:new Float32Array(nSim),
      ech:new Float32Array(nSim), rot:new Float32Array(nSim), vrot:new Float32Array(nSim), sol:new Float32Array(nSim), gab:new Uint8Array(nSim),
      imm:new Float32Array((max - nSim)*11)};
    L.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max*3), 3).setUsage(THREE.DynamicDrawUsage);
    L.aCoul = new THREE.InstancedBufferAttribute(new Float32Array(max*4), 4).setUsage(THREE.DynamicDrawUsage);
    L.aDon = new THREE.InstancedBufferAttribute(new Float32Array(max*4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', L.aPos); geo.setAttribute('iCoul', L.aCoul); geo.setAttribute('iDon', L.aDon);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms:uniformes({uAtlas:{value:null}}), vertexShader:SPRITE_V, fragmentShader:SPRITE_F,
      transparent:true, depthWrite:false, fog:true, toneMapped:!additif,
      blending:additif ? THREE.AdditiveBlending : THREE.NormalBlending, defines:additif ? {ADDITIF:1} : {},
    });
    mat.uniforms.uAtlas.value = atlas;
    L.geo = geo; L.mesh = new THREE.Mesh(geo, mat);
    L.mesh.frustumCulled = false; L.mesh.raycast = rien; L.mesh.renderOrder = additif ? 7 : 4; L.mesh.visible = false;
    groupe.add(L.mesh);
    return L;
  }

  // Gabarits de particules (mêmes paramètres que r3d-effets.js : taille t0 -> t1, couleur c0 -> c1...).
  const GAB = {}, GABS = [];
  function gabarit(nom, o){
    const g = {id:GABS.length, add:o.add ? 1 : 0, cadre:o.cadre || 0, t0:o.t0 === undefined ? 1 : o.t0, t1:o.t1 === undefined ? 1 : o.t1,
      a0:o.a0 === undefined ? 1 : o.a0, c0:lin(o.c0), c1:lin(o.c1), vie:o.vie, fi:o.fi || 0, fo:o.fo || 1,
      drag:o.drag || 0, grav:o.grav || 0, rot:o.rot || 0, rebond:o.rebond || 0, avance:o.avance || 0};
    GAB[nom] = g; GABS.push(g);
  }
  gabarit('eclat',        {add:1, cadre:0, t0:0.7, t1:1.5, c0:'#ffffff', c1:TEINTE, vie:[0.10, 0.18], fo:1.3, avance:0.6});
  gabarit('eclatFeu',     {add:1, cadre:0, t0:0.6, t1:1.5, a0:0.9, c0:'#fff2cc', c1:'#ff6a18', vie:[0.16, 0.3], fo:1.4, avance:0.6});
  gabarit('etincelle',    {add:1, cadre:2, t0:1, t1:0.4, c0:'#ffffff', c1:TEINTE, vie:[0.4, 0.95], drag:0.8, grav:GRAVITE*0.9, rebond:1});
  gabarit('etincelleFeu', {add:1, cadre:2, t0:1, t1:0.4, c0:'#fff0b0', c1:'#ff5a14', vie:[0.45, 1.0], drag:0.8, grav:GRAVITE*0.9, rebond:1});
  gabarit('feu',          {add:1, cadre:1, t0:0.9, t1:0.4, a0:0.85, c0:'#ffd27a', c1:'#c02800', vie:[0.35, 0.7], fi:0.12, drag:1.2, grav:34, rot:1});
  gabarit('bouleFeu',     {add:1, cadre:1, t0:0.5, t1:1.5, a0:0.9, c0:'#ffe0a0', c1:'#a02400', vie:[0.4, 0.8], fi:0.04, fo:1.3, drag:3.2, grav:20, rot:1.2});
  gabarit('plasma',       {add:1, cadre:0, t0:1, t1:0.3, a0:0.9, c0:TEINTE_CLAIRE, c1:'#16a383', vie:[0.45, 0.9], fi:0.15});
  gabarit('chaleur',      {add:1, cadre:1, t0:0.6, t1:1.6, a0:0.7, c0:'#fff0c8', c1:'#ff5210', vie:[0.25, 0.55], fi:0.05, fo:1.4, drag:1.5, rot:1.5});
  gabarit('fumee',        {cadre:1, t0:0.5, t1:1.9, a0:0.7, c0:'#16181c', c1:'#5e6268', vie:[2.6, 4.6], fi:0.08, fo:1.4, drag:1.0, grav:14, rot:0.4});
  gabarit('poussiere',    {cadre:1, t0:0.5, t1:2.0, a0:0.65, c0:'#9c8662', c1:'#cbb894', vie:[1.8, 3.4], fi:0.05, fo:1.5, drag:1.6, grav:5, rot:0.3});
  gabarit('vapeur',       {cadre:1, t0:0.5, t1:2.4, a0:0.42, c0:'#cfd6dc', c1:'#8d949c', vie:[2.2, 4.0], fi:0.1, fo:1.3, drag:0.8, grav:2, rot:0.3});

  let solCourant = -1e9;        // plancher des particules en cours d'émission (-1e9 : aucun, en plein ciel)
  let DX = 0, DY = 0, DZ = 0;   // direction aléatoire sur la sphère, sans allocation
  function dirAlea(){
    const u = Math.random()*2 - 1, a = Math.random()*6.283185, s = Math.sqrt(1 - u*u);
    DX = s*Math.cos(a); DY = u; DZ = s*Math.sin(a);
  }
  // Particule simulée (réserve en anneau : la plus ancienne est recyclée).
  function emettre(g, x, y, z, vx, vy, vz, taille, vieMul){
    const L = g.add ? lotAdd : lotNorm, i = L.prochain, i3 = i*3;
    L.prochain = (i + 1) % L.nSim;
    L.pos[i3] = x; L.pos[i3 + 1] = y; L.pos[i3 + 2] = z;
    L.vel[i3] = vx; L.vel[i3 + 1] = vy; L.vel[i3 + 2] = vz;
    L.age[i] = 0; L.vie[i] = alea(g.vie[0], g.vie[1])*(vieMul || 1); L.ech[i] = taille;
    L.rot[i] = Math.random()*6.2832; L.vrot[i] = (Math.random()*2 - 1)*g.rot; L.sol[i] = solCourant; L.gab[i] = g.id;
  }
  // Sprite immédiat : redéposé à chaque image par son propriétaire (halos, éclats, nuages).
  // avance : voir le shader (0 par défaut ; 0,6 à 1 pour un grand halo posé au sol).
  function sprite(L, x, y, z, taille, r, g, b, a, cadre, rot, avance){
    if(L.nImm >= L.max - L.nSim) return;
    const o = L.nImm++*11, I = L.imm;
    I[o] = x; I[o + 1] = y; I[o + 2] = z; I[o + 3] = taille; I[o + 4] = r; I[o + 5] = g; I[o + 6] = b; I[o + 7] = a; I[o + 8] = cadre || 0; I[o + 9] = rot || 0;
    I[o + 10] = avance || 0;
  }
  function lueur(x, y, z, taille, r, g, b, a, cadre, rot, avance){ sprite(lotAdd, x, y, z, taille, r, g, b, a, cadre, rot, avance); }
  function voile(x, y, z, taille, r, g, b, a, cadre, rot){ sprite(lotNorm, x, y, z, taille, r, g, b, a, cadre, rot, 0); }

  function majLot(L, dt){
    const pos = L.pos, vel = L.vel, aP = L.aPos.array, aC = L.aCoul.array, aD = L.aDon.array;
    let n = 0;
    for(let i = 0; i < L.nSim; i++){
      if(L.vie[i] <= 0) continue;
      const g = GABS[L.gab[i]], i3 = i*3;
      if(dt > 0){
        L.age[i] += dt;
        if(L.age[i] >= L.vie[i]){ L.vie[i] = 0; continue; }
        const am = Math.max(0, 1 - g.drag*dt);
        vel[i3] *= am; vel[i3 + 1] = vel[i3 + 1]*am + g.grav*dt; vel[i3 + 2] *= am;
        pos[i3] += vel[i3]*dt; pos[i3 + 1] += vel[i3 + 1]*dt; pos[i3 + 2] += vel[i3 + 2]*dt;
        L.rot[i] += L.vrot[i]*dt;
      }
      const k = L.age[i]/L.vie[i], ke = 1 - (1 - k)*(1 - k), taille = L.ech[i]*(g.t0 + (g.t1 - g.t0)*ke);
      if(g.rebond){
        if(pos[i3 + 1] < L.sol[i] + 0.5){ pos[i3 + 1] = L.sol[i] + 0.5; if(vel[i3 + 1] < 0) vel[i3 + 1] *= -0.35; vel[i3] *= 0.6; vel[i3 + 2] *= 0.6; }
      } else {
        const plancher = L.sol[i] + taille*0.28;
        if(pos[i3 + 1] < plancher){ pos[i3 + 1] = plancher; if(vel[i3 + 1] < 0) vel[i3 + 1] = 0; }
      }
      const fi = g.fi > 0 ? Math.min(1, k/g.fi) : 1, c0 = g.c0, c1 = g.c1, o3 = n*3, o4 = n*4;
      aP[o3] = pos[i3]; aP[o3 + 1] = pos[i3 + 1]; aP[o3 + 2] = pos[i3 + 2];
      aC[o4] = c0[0] + (c1[0] - c0[0])*k; aC[o4 + 1] = c0[1] + (c1[1] - c0[1])*k; aC[o4 + 2] = c0[2] + (c1[2] - c0[2])*k;
      aC[o4 + 3] = g.a0*fi*Math.pow(1 - k, g.fo);
      aD[o4] = taille; aD[o4 + 1] = L.rot[i]; aD[o4 + 2] = g.cadre; aD[o4 + 3] = g.avance;
      n++;
    }
    const I = L.imm;
    for(let j = 0; j < L.nImm; j++){
      const o = j*11, o3 = n*3, o4 = n*4;
      aP[o3] = I[o]; aP[o3 + 1] = I[o + 1]; aP[o3 + 2] = I[o + 2];
      aC[o4] = I[o + 4]; aC[o4 + 1] = I[o + 5]; aC[o4 + 2] = I[o + 6]; aC[o4 + 3] = I[o + 7];
      aD[o4] = I[o + 3]; aD[o4 + 1] = I[o + 9]; aD[o4 + 2] = I[o + 8]; aD[o4 + 3] = I[o + 10];
      n++;
    }
    L.nImm = 0;
    L.geo.instanceCount = n; L.mesh.visible = n > 0;
    if(n > 0){ L.aPos.needsUpdate = true; L.aCoul.needsUpdate = true; L.aDon.needsUpdate = true; }
  }
  function viderLot(L){ L.vie.fill(0); L.nImm = 0; L.geo.instanceCount = 0; L.mesh.visible = false; }

  // ----- Rubans : segments lumineux orientés vers la caméra, redéposés à chaque image -----
  // genre 0 : traînée (tête vive, queue qui s'efface) ; 1 : faisceau ; 2 : filet de visée en pointillés.
  const RB = {n:0};
  function creerRubans(){
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0,-0.5,0, 1,-0.5,0, 1,0.5,0, 0,0.5,0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    RB.aA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RUBANS*3), 3).setUsage(THREE.DynamicDrawUsage);
    RB.aB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RUBANS*3), 3).setUsage(THREE.DynamicDrawUsage);
    RB.aCoul = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RUBANS*4), 4).setUsage(THREE.DynamicDrawUsage);
    RB.aDon = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RUBANS*4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', RB.aA); geo.setAttribute('iB', RB.aB); geo.setAttribute('iCoul', RB.aCoul); geo.setAttribute('iDon', RB.aDon);
    geo.instanceCount = 0;
    RB.mat = new THREE.ShaderMaterial({
      uniforms:uniformes({uT:{value:0}}),
      vertexShader:`
        attribute vec3 iA;
        attribute vec3 iB;
        attribute vec4 iCoul;
        attribute vec4 iDon;             // largeur, genre, phase, longueur
        varying vec2 vC;
        varying vec4 vCoul;
        varying vec3 vDon;
        ${BRUME_V}
        void main(){
          vec4 a = modelViewMatrix * vec4(iA, 1.0);
          vec4 b = modelViewMatrix * vec4(iB, 1.0);
          vec4 mv = mix(a, b, position.x);
          vec3 d = b.xyz - a.xyz + vec3(1e-4, 0.0, 0.0);
          mv.xyz += normalize(cross(d, mv.xyz)) * iDon.x * position.y;
          gl_Position = projectionMatrix * mv;
          vC = vec2(position.x, position.y*2.0); vCoul = iCoul; vDon = iDon.yzw;
          ${BRUME_V_MAIN}
        }`,
      fragmentShader:`
        uniform float uT;
        varying vec2 vC;
        varying vec4 vCoul;
        varying vec3 vDon;
        ${BRUME_F}
        void main(){
          float v = abs(vC.y), u = vC.x, a;
          if(vDon.x < 0.5){
            a = pow(1.0 - v, 2.0)*pow(1.0 - u, 1.6)*smoothstep(0.0, 0.04, u);
          } else if(vDon.x < 1.5){
            float coeur = exp(-v*v*14.0), halo = exp(-v*v*2.6)*0.35;
            float onde = 0.86 + 0.14*sin(u*vDon.z*0.09 - uT*46.0 + vDon.y);
            float bouts = smoothstep(0.0, 0.03, u)*(0.6 + 0.4*(1.0 - smoothstep(0.97, 1.0, u)));
            a = (coeur + halo)*onde*bouts*(1.0 - smoothstep(0.85, 1.0, v));
          } else {
            a = pow(1.0 - v, 1.5)*(0.35 + 0.65*step(0.45, fract(u*vDon.z*0.035 - uT*2.2)));
          }
          a *= vCoul.a;
          if(a < 0.003) discard;
          gl_FragColor = linearToOutputTexel(vec4(vCoul.rgb*(1.0 - facteurBrume()), min(a, 1.0)));
        }`,
      transparent:true, depthWrite:false, fog:true, toneMapped:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
    });
    RB.geo = geo; RB.mesh = new THREE.Mesh(geo, RB.mat);
    RB.mesh.frustumCulled = false; RB.mesh.raycast = rien; RB.mesh.renderOrder = 8; RB.mesh.visible = false;
    groupe.add(RB.mesh);
  }
  function ruban(ax, ay, az, bx, by, bz, largeur, r, g, b, a, genre, phase){
    if(RB.n >= MAX_RUBANS) return;
    const i = RB.n++, i3 = i*3, i4 = i*4;
    RB.aA.array[i3] = ax; RB.aA.array[i3 + 1] = ay; RB.aA.array[i3 + 2] = az;
    RB.aB.array[i3] = bx; RB.aB.array[i3 + 1] = by; RB.aB.array[i3 + 2] = bz;
    RB.aCoul.array[i4] = r; RB.aCoul.array[i4 + 1] = g; RB.aCoul.array[i4 + 2] = b; RB.aCoul.array[i4 + 3] = a;
    RB.aDon.array[i4] = largeur; RB.aDon.array[i4 + 1] = genre || 0; RB.aDon.array[i4 + 2] = phase || 0;
    RB.aDon.array[i4 + 3] = Math.hypot(bx - ax, by - ay, bz - az);
  }
  function majRubans(){
    RB.geo.instanceCount = RB.n; RB.mesh.visible = RB.n > 0;
    if(RB.n > 0){ RB.aA.needsUpdate = true; RB.aB.needsUpdate = true; RB.aCoul.needsUpdate = true; RB.aDon.needsUpdate = true; }
    RB.mat.uniforms.uT.value = horloge;
    RB.n = 0;
  }

  // ----- Débris physiques (un InstancedMesh, couleur par instance : incandescents puis refroidis) -----
  const DB = {prochain:0};
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
  const DEB_CHAUD = [3.2, 1.3, 0.35], DEB_FROID = lin('#27333b');
  function creerDebris(){
    const geo = new THREE.TetrahedronGeometry(1, 0); geo.scale(1.7, 0.45, 1);
    const mat = new THREE.MeshStandardMaterial({color:0xffffff, roughness:0.55, metalness:0.35});
    DB.mesh = new THREE.InstancedMesh(geo, mat, MAX_DEBRIS);
    DB.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    DB.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS*3), 3).setUsage(THREE.DynamicDrawUsage);
    DB.mesh.count = 0; DB.mesh.frustumCulled = false; DB.mesh.raycast = rien; DB.mesh.castShadow = false; DB.mesh.visible = false;
    DB.pos = new Float32Array(MAX_DEBRIS*3); DB.vel = new Float32Array(MAX_DEBRIS*3); DB.rot = new Float32Array(MAX_DEBRIS*3); DB.vrot = new Float32Array(MAX_DEBRIS*3);
    DB.ech = new Float32Array(MAX_DEBRIS); DB.age = new Float32Array(MAX_DEBRIS); DB.vie = new Float32Array(MAX_DEBRIS); DB.sol = new Float32Array(MAX_DEBRIS);
    groupe.add(DB.mesh);
  }
  // n débris depuis (x, y, z) ; haut : part de la vitesse dirigée vers le ciel (impact au sol).
  function debris(x, y, z, n, vitesse, taille, haut){
    const hs = sol(x, z);
    n = Math.round(n*debit());
    for(let k = 0; k < n; k++){
      const i = DB.prochain, i3 = i*3; DB.prochain = (i + 1) % MAX_DEBRIS;
      dirAlea();
      const v = vitesse*alea(0.35, 1);
      DB.pos[i3] = x; DB.pos[i3 + 1] = y; DB.pos[i3 + 2] = z;
      DB.vel[i3] = DX*v; DB.vel[i3 + 1] = (haut ? Math.abs(DY)*0.6 + haut : DY)*v; DB.vel[i3 + 2] = DZ*v;
      DB.rot[i3] = alea(0, 6.28); DB.rot[i3 + 1] = alea(0, 6.28); DB.rot[i3 + 2] = alea(0, 6.28);
      DB.vrot[i3] = alea(-7, 7); DB.vrot[i3 + 1] = alea(-7, 7); DB.vrot[i3 + 2] = alea(-7, 7);
      DB.ech[i] = taille*alea(0.45, 1.3); DB.age[i] = 0; DB.vie[i] = alea(3, 5); DB.sol[i] = hs;
    }
  }
  function majDebris(dt){
    let n = 0;
    const col = DB.mesh.instanceColor.array;
    for(let i = 0; i < MAX_DEBRIS; i++){
      if(DB.vie[i] <= 0) continue;
      const i3 = i*3;
      if(dt > 0){
        DB.age[i] += dt;
        if(DB.age[i] >= DB.vie[i]){ DB.vie[i] = 0; continue; }
        if(DB.pos[i3 + 1] > DB.sol[i] + 1 || DB.vel[i3 + 1] > 0){
          DB.vel[i3 + 1] += GRAVITE*dt;
          DB.pos[i3] += DB.vel[i3]*dt; DB.pos[i3 + 1] += DB.vel[i3 + 1]*dt; DB.pos[i3 + 2] += DB.vel[i3 + 2]*dt;
          DB.rot[i3] += DB.vrot[i3]*dt; DB.rot[i3 + 1] += DB.vrot[i3 + 1]*dt; DB.rot[i3 + 2] += DB.vrot[i3 + 2]*dt;
          if(DB.pos[i3 + 1] <= DB.sol[i] + 1){
            DB.pos[i3 + 1] = DB.sol[i] + 1;
            if(DB.vel[i3 + 1] < -70){ DB.vel[i3 + 1] *= -0.3; DB.vel[i3] *= 0.5; DB.vel[i3 + 2] *= 0.5; }
            else { DB.vel[i3] = DB.vel[i3 + 1] = DB.vel[i3 + 2] = 0; }
          }
        }
      }
      const s = DB.ech[i]*Math.min(1, (DB.vie[i] - DB.age[i])/0.6), k = clamp(DB.age[i]/1.6, 0, 1);
      _m.compose(_v.set(DB.pos[i3], DB.pos[i3 + 1], DB.pos[i3 + 2]), _q.setFromEuler(_e.set(DB.rot[i3], DB.rot[i3 + 1], DB.rot[i3 + 2])), _s.set(s, s, s));
      DB.mesh.setMatrixAt(n, _m);
      col[n*3] = mel(DEB_CHAUD[0], DEB_FROID[0], k); col[n*3 + 1] = mel(DEB_CHAUD[1], DEB_FROID[1], k); col[n*3 + 2] = mel(DEB_CHAUD[2], DEB_FROID[2], k);
      n++;
    }
    DB.mesh.count = n; DB.mesh.visible = n > 0;
    if(n > 0){ DB.mesh.instanceMatrix.needsUpdate = true; DB.mesh.instanceColor.needsUpdate = true; }
  }

  // ----- Décalques au sol (quads plats : la zone de jeu l'est) -----
  const DECAL_V = `
    varying vec2 vP;
    ${BRUME_V}
    void main(){
      vP = position.xz;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      ${BRUME_V_MAIN}
    }`;
  // Disque dégradé : ombre douce (mélange normal, teinte sombre) ou flaque de lumière (mélange additif).
  // uForme : x = rayon du plateau central (0 à 1), y = exposant de la décroissance vers le bord.
  const DISQUE_F = `
    uniform float uAlpha;
    uniform vec3 uCoul;
    uniform vec2 uForme;
    varying vec2 vP;
    ${BRUME_F}
    void main(){
      float a = uAlpha*pow(1.0 - smoothstep(uForme.x, 1.0, length(vP)), uForme.y)*(1.0 - facteurBrume());
      if(a < 0.003) discard;
      gl_FragColor = vec4(uCoul, a);
    }`;
  const ONDE_F = `
    uniform float uK;
    uniform float uAlpha;
    uniform vec3 uCoul;
    varying vec2 vP;
    ${BRUME_F}
    void main(){
      float r = length(vP), e = 0.05 + 0.10*(1.0 - uK);
      float a = smoothstep(uK - e*2.2, uK, r)*(1.0 - smoothstep(uK, uK + e*0.35, r));
      a = (a + (1.0 - smoothstep(0.0, uK + 0.001, r))*0.10)*(1.0 - uK)*(1.0 - uK)*uAlpha*(1.0 - facteurBrume());
      if(a < 0.003) discard;
      gl_FragColor = linearToOutputTexel(vec4(uCoul, min(a, 1.0)));
    }`;
  const ALERTE_F = `
    uniform float uK;
    uniform float uT;
    uniform float uR0;
    uniform float uAlpha;
    uniform vec3 uCoul;
    varying vec2 vP;
    ${BRUME_F}
    float bande(float r, float c, float e){ return 1.0 - smoothstep(e*0.5, e, abs(r - c)); }
    void main(){
      float r = length(vP), ang = atan(vP.y, vP.x)/6.2831853;
      float kk = pow(uK, 0.8);
      float anneau = bande(r, mix(0.96, uR0, kk), 0.035 + 0.02*kk)*(0.5 + 0.5*step(0.4, fract(ang*18.0 + uT*0.3)));
      float anneau2 = bande(r, mix(0.96, uR0, kk*kk), 0.016)*0.6;
      float cible = bande(r, uR0, 0.022);
      float pouls = 0.5 + 0.5*sin(uT*(5.0 + 34.0*uK*uK));
      float fond = (1.0 - smoothstep(uR0 - 0.02, uR0, r))*(0.08 + 0.30*uK*pouls);
      float trait = (1.0 - smoothstep(0.02, 0.04, abs(fract(ang*12.0) - 0.5)))*step(uR0*1.04, r)*(1.0 - step(uR0*1.22, r));
      float a = clamp(anneau + anneau2 + cible*0.9 + fond + trait*0.7, 0.0, 1.0)*uAlpha*(1.0 - smoothstep(0.97, 1.0, r));
      if(a < 0.004) discard;
      vec3 col = mix(uCoul, vec3(1.0), clamp(uK*uK*0.7 + cible*0.3*pouls, 0.0, 1.0));
      gl_FragColor = linearToOutputTexel(vec4(col, a));
    }`;
  let geoQuad = null, ombre = null, flaqueCoeur = null, flaqueFlash = null;
  const ondes = [], alertes = [];
  function matDecal(frag, uni){
    return new THREE.ShaderMaterial({uniforms:uniformes(uni), vertexShader:DECAL_V, fragmentShader:frag, transparent:true, depthWrite:false,
      fog:true, toneMapped:false, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4});
  }
  // Les trois disques partagent le même programme : seuls le mélange et les uniformes diffèrent.
  function matDisque(additif){
    const m = matDecal(DISQUE_F, {uAlpha:{value:0}, uCoul:{value:new THREE.Color(0, 0.008, 0.015)}, uForme:{value:new THREE.Vector2(0.25, 1)}});
    if(additif){ m.blending = THREE.AdditiveBlending; m.uniforms.uForme.value.set(0, 2); m.uniforms.uCoul.value.set(TEINTE); }
    return m;
  }
  function creerDecalques(){
    geoQuad = new THREE.PlaneGeometry(2, 2); geoQuad.rotateX(-Math.PI/2);
    const decal = (mat, ordre) => { const m = new THREE.Mesh(geoQuad, mat); m.visible = false; m.frustumCulled = false; m.raycast = rien; m.renderOrder = ordre; groupe.add(m); return m; };
    ombre = decal(matDisque(false), 1);
    flaqueCoeur = decal(matDisque(true), 3);
    flaqueFlash = decal(matDisque(true), 3);
    for(let i = 0; i < MAX_ONDES; i++) ondes.push({m:decal(matDecal(ONDE_F, {uK:{value:0}, uAlpha:{value:1}, uCoul:{value:new THREE.Color()}}), 2), age:0, vie:0});
    for(let i = 0; i < MAX_ALERTES; i++) alertes.push(decal(matDecal(ALERTE_F, {uK:{value:0}, uT:{value:0}, uR0:{value:1/2.3}, uAlpha:{value:1}, uCoul:{value:new THREE.Color(TEINTE).convertSRGBToLinear()}}), 2));
  }
  function ajouterOnde(x, y, rayon, hex, vie, alpha){
    let s = ondes[0];
    for(const o of ondes){ if(o.vie <= 0){ s = o; break; } if(o.age/o.vie > s.age/s.vie) s = o; }
    s.age = 0; s.vie = vie; s.m.visible = true;
    s.m.position.set(x, hauteurDecal(x, y, Math.min(rayon, 200)*0.5) + Math.random()*0.3, y);
    s.m.scale.setScalar(rayon);
    s.m.material.uniforms.uCoul.value.set(hex).convertSRGBToLinear();
    s.m.material.uniforms.uAlpha.value = alpha; s.m.material.uniforms.uK.value = 0;
  }
  function majOndes(dt){
    for(const o of ondes){
      if(o.vie <= 0) continue;
      o.age += dt;
      if(o.age >= o.vie){ o.vie = 0; o.m.visible = false; continue; }
      o.m.material.uniforms.uK.value = 1 - Math.pow(1 - o.age/o.vie, 2);
    }
  }

  // ----- Lumières simulées -----
  // Aucune vraie lumière ici : en ajouter une seule à la scène fait recompiler tous les matériaux
  // éclairés du jeu (plusieurs secondes de gel mesurées), et chaque lumière se paie ensuite sur chaque
  // pixel, que les envahisseurs soient là ou non. À la place : deux flaques de lumière additives posées
  // au sol (sous le cœur, et à l'endroit du dernier éclair), et la coque s'éclaire elle-même à la lueur
  // de son cœur (uLumC et uPosCoeur, dans son shader).
  const flash = {age:0, vie:0, i0:0, a0:0};
  // Éclair en (x, y = hauteur, z) : intensité de 1 (petite explosion) à 18 (écrasement), portée en px.
  function eclairLumiere(x, y, z, hex, intensite, portee, vie){
    if(!flaqueFlash) return;
    if(flash.vie > 0 && flash.i0*Math.pow(1 - flash.age/flash.vie, 2) > intensite) return;
    const hs = sol(x, z), r = portee*0.5;
    // Plus l'éclair est haut au-dessus du sol, plus sa flaque est pâle.
    flash.a0 = clamp(intensite/16, 0, 1)*clamp(1 - (y - hs)/(portee*0.8), 0, 1);
    flash.age = 0; flash.vie = vie; flash.i0 = intensite;
    flaqueFlash.position.set(x, hauteurDecal(x, z, Math.min(r, 200)*0.5) + 0.5, z); flaqueFlash.scale.setScalar(r);
    flaqueFlash.material.uniforms.uCoul.value.set(hex);
  }
  function majLumieres(dt){
    if(!flaqueFlash) return;
    if(flash.vie > 0){ flash.age += dt; if(flash.age >= flash.vie) flash.vie = 0; }
    const a = flash.vie > 0 ? flash.a0*Math.pow(1 - flash.age/flash.vie, 2) : 0;
    flaqueFlash.visible = a > 0.01;
    flaqueFlash.material.uniforms.uAlpha.value = a;
  }

  // ----- Préchauffage des shaders -----
  // Un shader n'est compilé qu'à la première image où son objet est dessiné, et cette compilation peut
  // figer le jeu un long moment. Après preparer(), on rend donc UNE image où tout le module est « visible »
  // sans rien montrer (vaisseau très loin sous le sol, décalques transparents, réserves vides) : c'est le
  // vrai circuit de rendu qui compile, post-traitement compris, donc exactement les bonnes variantes.
  let chauffe = 0;              // 0 : jamais demandé ; 1 : demandé ; 2 : image de chauffe en cours ; 3 : fait
  let vaisseauChauffe = false;  // vrai quand une image de chauffe a inclus le vaisseau
  const forces = [], decoupes = [];
  function forcer(o){ if(o && !o.visible){ o.visible = true; forces.push(o); } }
  function rechauffer(){
    chauffe = 2;
    const V = vaisseau;
    if(V){
      vaisseauChauffe = true;
      if(!V.racine.visible){ V.racine.position.set(0, -1e5, 0); V.racine.updateMatrixWorld(true); }
      for(const m of [V.corps, V.anA, V.anB, V.coeur, V.bouclier]) if(m.frustumCulled){ m.frustumCulled = false; decoupes.push(m); }
      forcer(V.racine); forcer(V.bouclier);
    }
    forcer(lotAdd.mesh); forcer(lotNorm.mesh); forcer(RB.mesh); forcer(DB.mesh);
    // Décalques au repos : rendus une fois, entièrement transparents.
    for(const m of [ombre, flaqueCoeur, flaqueFlash]) if(!m.visible){ m.material.uniforms.uAlpha.value = 0; forcer(m); }
    for(const o of ondes) if(!o.m.visible){ o.m.material.uniforms.uK.value = 1; forcer(o.m); }
    for(const m of alertes) if(!m.visible){ m.material.uniforms.uAlpha.value = 0; forcer(m); }
  }
  // À appeler au début de tout appel public qui suit l'image de chauffe : remet tout comme avant.
  function finChauffe(){
    chauffe = 3;
    for(const o of forces) o.visible = false;
    for(const m of decoupes) m.frustumCulled = true;
    forces.length = 0; decoupes.length = 0;
  }

  // Explosion : éclat, boules de feu, étincelles, fumée, lumière. force : 1 petite ... 4 énorme.
  function explosion(x, y, z, force, feu){
    solCourant = sol(x, z);
    emettre(feu ? GAB.eclatFeu : GAB.eclat, x, y, z, 0, 0, 0, 70*force, 1 + force*0.2);
    const nb = Math.round(6*force*debit());
    for(let k = 0; k < nb; k++){
      dirAlea();
      emettre(GAB.bouleFeu, x + DX*6*force, y + DY*6*force, z + DZ*6*force, DX*40*force, DY*40*force + 10, DZ*40*force, alea(22, 38)*force);
    }
    for(let k = 0; k < nb*1.5; k++){
      dirAlea(); const v = alea(120, 300);
      emettre(feu ? GAB.etincelleFeu : GAB.etincelle, x, y, z, DX*v, DY*v + 60, DZ*v, alea(3, 6));
    }
    for(let k = 0; k < Math.ceil(2*force*debit()); k++)
      emettre(GAB.fumee, x + alea(-8, 8)*force, y + alea(0, 8), z + alea(-8, 8)*force, alea(-8, 8), alea(8, 20), alea(-8, 8), alea(26, 44)*force);
    eclairLumiere(x, y, z, feu ? '#ffb060' : TEINTE_CLAIRE, 3 + 2.5*force, 420 + 160*force, 0.35);
  }

  // =================================================================
  //  5. VAISSEAU : assemblage, animation, dégâts, destruction
  // =================================================================
  const TILT_A = 6*RAD, TILT_B = -9*RAD;       // inclinaison fixe du plan des deux anneaux tournants
  function creerVaisseau(){
    const mod = construireModele();
    const U = {uDegats:{value:0}, uPulse:{value:1}, uBraise:{value:0}, uChauffe:{value:0}, uDirChauffe:{value:new THREE.Vector3(1, 0, 0)},
      uTempsV:{value:0}, uVoile:{value:1}, uCarbon:{value:0}, uCoulLum:{value:new THREE.Color(TEINTE).convertSRGBToLinear()},
      uLumC:{value:0}, uPosCoeur:{value:new THREE.Vector3()}};
    const mat = creerMatCoque(U);
    const racine = new THREE.Group(); racine.name = 'vaisseauMere'; racine.visible = false;
    const assiette = new THREE.Group(); racine.add(assiette);
    const piece = (geo, porteOmbre) => { const m = new THREE.Mesh(geo, mat); m.castShadow = porteOmbre; m.receiveShadow = true; m.raycast = rien; return m; };
    const corps = piece(mod.corps, true); assiette.add(corps);
    const pivotA = new THREE.Group(), pivotB = new THREE.Group(); assiette.add(pivotA); assiette.add(pivotB);
    const anA = piece(mod.anneauA, true), anB = piece(mod.anneauB, true); pivotA.add(anA); pivotB.add(anB);
    const griffes = new THREE.InstancedMesh(mod.griffe, mat, NB_GRIFFES);
    griffes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); griffes.receiveShadow = true; griffes.raycast = rien; griffes.frustumCulled = false;
    assiette.add(griffes);
    const matCoeur = creerMatCoeur();
    const coeur = new THREE.Mesh(new THREE.IcosahedronGeometry(27, 2), matCoeur);
    coeur.position.y = Y_COEUR; coeur.raycast = rien; assiette.add(coeur);
    const matBouclier = creerMatBouclier();
    const bouclier = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), matBouclier);
    bouclier.position.set(10, 0, 0); bouclier.visible = false; bouclier.raycast = rien; bouclier.renderOrder = 6; racine.add(bouclier);
    // Boîte de sélection : non dessinée, mais touchée par le raycaster de R3D.pick.
    const pointage = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({visible:false}));
    pointage.scale.set(300, 82, 262); racine.add(pointage);
    groupe.add(racine);
    const V = {mod, U, mat, racine, assiette, corps, pivotA, anA, pivotB, anB, griffes, coeur, matCoeur, bouclier, matBouclier,
      impacts:matBouclier.uniforms.uImp.value, posCoeur:new THREE.Vector3(),
      etat:'cache', ent:null, x:0, y:0, alt:ALT_JEU, angle:0, rotA:0, rotB:0, tAttente:0};
    remettreANeuf(V);
    return V;
  }
  function remettreANeuf(V){
    const U = V.U;
    V.niveau = 0; V.vie = 1; V.tang = 0; V.roulis = 0; V.gite = 0; V.chargeC = 0; V.chargeL = 0; V.tirL = 0; V.cible = null;
    V.kb = 0; V.frisson = 0; V.tRupture = -1; V.souffle = -1; V.voile = 1; V.vitA = 0.10; V.vitB = 0.07; V.vieOmbre = 1;
    V.tM = 0; V.detone = false; V.impact = false; V.tImpact = 0; V.vx = 0; V.vy = 0; V.vz = 0; V.prochaine = 0;
    V.flot = 1;                 // part du balancement vertical du vol stationnaire (0 pendant la cinématique)
    U.uDegats.value = 0; U.uPulse.value = 1; U.uBraise.value = 0; U.uChauffe.value = 0; U.uCarbon.value = 0; U.uVoile.value = 1;
    V.pivotA.position.set(0, 0, 0); V.pivotA.rotation.set(TILT_A, 0, 0);
    V.pivotB.position.set(0, 0, 0); V.pivotB.rotation.set(0, 0, TILT_B);
    V.assiette.rotation.set(0, 0, 0);
    for(const im of V.impacts) im.w = -1;
    V.bouclier.visible = false; V.bouclier.scale.set(BOUCLIER_R[0], BOUCLIER_R[1], BOUCLIER_R[2]);
    V.matBouclier.uniforms.uSouffle.value = 0;
  }
  function cacher(V){
    V.etat = 'cache'; V.ent = null; V.racine.visible = false; V.bouclier.visible = false;
    delete V.racine.userData.entId;
    if(ombre) ombre.visible = false;
    if(flaqueCoeur) flaqueCoeur.visible = false;
  }
  function niveauDe(e){
    const m = e.pvMax || (e.def && e.def.pv) || 0;
    if(!(m > 0) || typeof e.pv !== 'number') return 0;
    const k = e.pv/m;
    return k < 0.25 ? 2 : k < 0.5 ? 1 : 0;
  }
  function ratioBouclier(e){ const m = e.bouclierMax || 0; return m > 0 ? clamp((e.bouclier || 0)/m, 0, 1) : 0; }

  // Incendies aux plaies ouvertes (niveau de dégâts niv), intensité k.
  function incendies(V, niv, dt, k){
    const M = V.assiette.matrixWorld, d = debit()*k;
    solCourant = -1e9;
    for(const f of V.mod.foyers){
      if(f.n > niv) continue;
      _v.set(f.p[0], f.p[1], f.p[2]).applyMatrix4(M);
      if(Math.random() < dt*13*d) emettre(GAB.feu, _v.x + alea(-4, 4), _v.y + alea(0, 4), _v.z + alea(-4, 4), alea(-4, 4), alea(14, 30), alea(-4, 4), alea(14, 26));
      if(Math.random() < dt*4.5*d) emettre(GAB.fumee, _v.x, _v.y + 8, _v.z, alea(3, 13), alea(16, 30), alea(-9, 1), alea(22, 38));
      if(Math.random() < dt*1.5*d) emettre(GAB.etincelleFeu, _v.x, _v.y, _v.z, alea(-40, 40), alea(10, 60), alea(-40, 40), alea(2.5, 4.5));
    }
  }
  // Un pan de blindage est arraché : explosion et débris à cet endroit (p en repère modèle).
  function arracher(V, p){
    _w.set(p[0], p[1], p[2]).applyMatrix4(V.assiette.matrixWorld);
    explosion(_w.x, _w.y, _w.z, 1.3, true);
    debris(_w.x, _w.y, _w.z, 5, 150, 7, 0);
  }

  // Le vaisseau suit son entité (champs du contrat : x, y, alt, angle, pv, pvMax, bouclier, bouclierMax,
  // charge, cibleRayon, mort).
  function suivreEntite(V, e, dt){
    const alt = typeof e.alt === 'number' ? e.alt : ALT_JEU, niv = niveauDe(e), kb = ratioBouclier(e), U = V.U;
    if(V.etat !== 'vol' || V.ent !== e){
      // Adoption. Après la cinématique, le modèle est déjà en place : on garde son état (aucun saut).
      const continu = V.etat === 'attente' && Math.hypot(e.x - V.x, e.y - V.y) < 240;
      if(!continu){ remettreANeuf(V); V.x = e.x; V.y = e.y; V.alt = alt; V.angle = e.angle || 0; }
      V.racine.visible = true; V.etat = 'vol'; V.ent = e; V.racine.userData.entId = e.id;
      V.niveau = niv; V.kb = kb; U.uDegats.value = niv; U.uBraise.value = niv ? 1 : 0;
    }
    const d = Math.hypot(e.x - V.x, e.y - V.y);
    if(d > 320){ V.x = e.x; V.y = e.y; V.alt = alt; V.angle = e.angle || 0; }
    else if(dt > 0){
      const k = 1 - Math.exp(-dt*8);
      V.x += (e.x - V.x)*k; V.y += (e.y - V.y)*k; V.alt += (alt - V.alt)*k;
      V.angle += ecartAngle(V.angle, e.angle || 0)*(1 - Math.exp(-dt*3));
    }
    V.tang -= V.tang*Math.min(1, dt*2); V.roulis -= V.roulis*Math.min(1, dt*2);
    V.chargeC = clamp(e.charge || 0, 0, 1);
    V.cible = e.cibleRayon || null;
    // Dégâts : sous 50 % puis 25 % des points de vie, des pans de blindage sont arrachés.
    if(dt > 0){
      if(niv > V.niveau){
        for(let l = V.niveau + 1; l <= niv; l++) for(const p of V.mod.plaies[l]) arracher(V, p);
        secousse = Math.max(secousse, 0.35);
      }
      V.niveau = niv;
      incendies(V, niv, dt, 1);
    }
    U.uDegats.value = V.niveau;
    U.uBraise.value += ((V.niveau ? 1 : 0) - U.uBraise.value)*Math.min(1, dt*2);
    U.uPulse.value = V.niveau === 2 ? (Math.sin(horloge*37) + Math.sin(horloge*23.3) > 1.1 ? 0.25 : 0.8) : V.niveau === 1 ? 0.88 + 0.12*Math.sin(horloge*11) : 1;
    V.gite += ((V.niveau === 2 ? 0.075 : V.niveau === 1 ? 0.028 : 0) - V.gite)*Math.min(1, dt*0.8);
    V.vitA = V.niveau === 2 ? 0.035 : 0.10; V.vitB = V.niveau === 2 ? 0.12 : 0.07;
    // Bouclier : il frissonne quand il encaisse, se disloque quand il cède.
    if(V.kb > 0 && kb <= 0) V.tRupture = 0;
    else if(kb < V.kb - 1e-5 || (kb > 0 && V.kb <= 0)) V.frisson = Math.min(1, V.frisson + 0.6);
    V.kb = kb;
  }

  // Pose, animation et accessoires du vaisseau (halo du cœur, lumière, bouclier, ombre) pour cette image.
  function animerVaisseau(V, dt){
    const U = V.U, t = horloge, enJeu = V.etat === 'vol' || V.etat === 'attente';
    V.chargeL += (V.chargeC - V.chargeL)*Math.min(1, dt*6);
    V.tirL = Math.max(0, V.tirL - dt*3.5);
    V.rotA += dt*V.vitA; V.rotB -= dt*V.vitB;
    // Le balancement du vol stationnaire s'installe et s'efface en douceur (pas de saut à la fin de la
    // cinématique ni au début de la chute).
    V.flot += ((enJeu ? 1 : 0) - V.flot)*Math.min(1, dt*1.2);
    V.racine.position.set(V.x, V.alt + Math.sin(t*0.6)*3*V.flot, V.y);
    V.racine.rotation.y = -V.angle;
    V.assiette.rotation.set(V.roulis + V.gite*(1 + 0.25*Math.sin(t*0.7)), 0, V.tang);
    V.anA.rotation.y = V.rotA; V.anB.rotation.y = V.rotB;
    // Griffes : elles s'écartent avec la charge.
    const ouv = 0.10 + 0.95*V.chargeL + 0.3*V.tirL;
    for(let k = 0; k < NB_GRIFFES; k++){
      const a = k/NB_GRIFFES*Math.PI*2 + 0.2;
      _m.makeRotationY(-a).multiply(_m2.makeTranslation(41, -33, 0)).multiply(_m3.makeRotationZ(ouv + 0.04*Math.sin(t*1.7 + k*2.1)));
      V.griffes.setMatrixAt(k, _m);
    }
    V.griffes.instanceMatrix.needsUpdate = true;
    V.racine.updateMatrixWorld(true);
    const c = V.posCoeur.set(0, Y_COEUR, 0).applyMatrix4(V.assiette.matrixWorld), ch = V.chargeL;
    U.uTempsV.value = t;
    const MC = V.matCoeur.uniforms;
    MC.uT.value = t; MC.uCharge.value = ch; MC.uTir.value = V.tirL; MC.uVie.value = V.vie;
    if(V.vie > 0.02){
      lueur(c.x, c.y - 8, c.z, 90 + 250*ch + 280*V.tirL, VERT[0], VERT[1], VERT[2], Math.min(1, 0.2 + 0.6*ch + V.tirL)*V.vie, 0, 0);
      if(ch > 0.35) lueur(c.x, c.y - 8, c.z, 260*ch, 1, 1, 1, Math.min(1, (ch - 0.35)*1.2)*V.vie, 2, t*0.7);
      if(dt > 0 && ch > 0.08){
        // Énergie aspirée vers le cœur pendant la charge.
        let n = dt*46*ch*debit();
        solCourant = -1e9;
        while(n > 0){
          if(n < 1 && Math.random() > n) break;
          n -= 1; dirAlea();
          const r = alea(70, 120);
          emettre(GAB.plasma, c.x + DX*r, c.y - 8 + DY*r*0.7, c.z + DZ*r, -DX*r/0.7, -DY*r, -DZ*r/0.7, alea(5, 10));
        }
      }
    }
    // Lueur du cœur : sur la coque (dans son shader) et en flaque au sol, sous le vaisseau.
    const lum = V.vie*(0.5 + 5*ch*ch + 7*V.tirL), hsC = sol(c.x, c.z);
    U.uLumC.value = lum; U.uPosCoeur.value.set(c.x, c.y - 30, c.z);
    const aF = clamp(lum/12, 0, 0.85)*(1 - lisse(300, 700, c.y - hsC));
    flaqueCoeur.visible = aF > 0.01;
    if(flaqueCoeur.visible){
      flaqueCoeur.position.set(c.x, hauteurDecal(c.x, c.z, 160) + 0.6, c.z); flaqueCoeur.scale.setScalar(300 + 160*ch);
      flaqueCoeur.material.uniforms.uAlpha.value = aF;
    }
    // Filet de visée : il relie le cœur à la cible pendant la charge.
    if(V.cible && ch > 0.05 && V.tirL < 0.05 && V.etat === 'vol'){
      const cx = V.cible.x, cy = V.cible.y;
      ruban(c.x, c.y - 24, c.z, cx, sol(cx, cy) + 1, cy, 3 + 7*ch, VERT[0], VERT[1], VERT[2], 0.12 + 0.55*ch*ch, 2, 0);
    }
    // Transparence tramée quand le vaisseau masque ce que regarde le joueur (jamais pendant la cinématique).
    let cibleVoile = 1;
    const cam = R3D.camera, vue = R3D.vue;
    if(enJeu && Aliens.transparence && cam && vue && cam.position.y > V.alt + 60){
      const k = cam.position.y/(cam.position.y - V.alt);       // point du sol masqué par le centre du vaisseau
      const gx = cam.position.x + (V.x - cam.position.x)*k, gz = cam.position.z + (V.y - cam.position.z)*k;
      const parFoyer = lisse(250*k, 420*k, Math.hypot(gx - vue.x, gz - vue.y));
      const parZoom = lisse(1050, 1500, cam.position.distanceTo(V.racine.position));
      cibleVoile = mel(0.42, 1, Math.max(parFoyer, parZoom));
    }
    V.voile = enJeu ? V.voile + (cibleVoile - V.voile)*0.12 : 1;
    U.uVoile.value = V.voile;
    // Bouclier.
    let actif = V.frisson > 0.01 || V.tRupture >= 0 || V.souffle >= 0;
    for(let i = 0; i < MAX_IMPACTS; i++){
      const im = V.impacts[i];
      if(im.w < 0) continue;
      im.w += dt;
      if(im.w > 1.6) im.w = -1; else actif = true;
    }
    V.frisson *= Math.exp(-dt*3);
    if(V.tRupture >= 0){ V.tRupture += dt; if(V.tRupture > 1.1) V.tRupture = -1; }
    const MB = V.matBouclier.uniforms;
    let ech = 1;
    if(V.souffle >= 0){
      // Souffle de la détonation du cœur : la bulle enfle et s'efface.
      V.souffle += dt;
      const k = V.souffle/1.3;
      if(k >= 1){ V.souffle = -1; MB.uSouffle.value = 0; }
      else { MB.uSouffle.value = (1 - k)*(1 - k); ech = 0.25 + 2.3*(1 - (1 - k)*(1 - k)); }
    }
    V.bouclier.visible = actif;
    V.bouclier.scale.set(BOUCLIER_R[0]*ech, BOUCLIER_R[1]*ech, BOUCLIER_R[2]*ech);
    MB.uT.value = t; MB.uFrisson.value = V.frisson; MB.uRupture.value = V.tRupture >= 0 ? 1 - V.tRupture/1.1 : 0;
    MB.uEtat.value = V.souffle >= 0 ? 1 : V.kb;
    // Ombre : la carte d'ombres du soleil donne la silhouette ; ce disque doux ajoute la pénombre
    // (et tient lieu d'ombre quand les ombres réelles sont coupées).
    const ds = R3D.dirSoleil, haut = Math.max(0, V.alt - sol(V.x, V.y));
    let ox = 0, oz = 0;
    if(ds && ds.y > 0.05){ ox = -ds.x/ds.y*haut; oz = -ds.z/ds.y*haut; }
    const reelles = !!(R3D.renderer && R3D.renderer.shadowMap.enabled) && qualite() !== 'basse';
    const aO = (reelles ? 0.30 : 0.52)*(1 - lisse(420, 900, haut))*V.vieOmbre;
    ombre.visible = aO > 0.01;
    if(ombre.visible){
      const px = V.x + ox, pz = V.y + oz;
      ombre.position.set(px, hauteurDecal(px, pz, 160), pz); ombre.scale.setScalar(350 + haut*0.2);
      ombre.material.uniforms.uAlpha.value = aO;
    }
  }

  // ----- Destruction en plusieurs temps : explosions en chaîne, détonation du cœur, chute, écrasement, épave -----
  function lancerDestruction(V){
    V.etat = 'chute'; V.tM = 0; V.detone = false; V.impact = false; V.vy = 0; V.prochaine = 0.05; V.vieOmbre = 1;
    V.vx = Math.cos(V.angle)*16; V.vz = Math.sin(V.angle)*16;
    V.cible = null; V.tRupture = -1; V.frisson = 0; V.ent = null;
    delete V.racine.userData.entId;
  }
  function explosionCoque(V, force){
    const p = V.mod.points[Math.floor(Math.random()*V.mod.points.length)];
    _w.set(p[0], p[1], p[2]).applyMatrix4(V.assiette.matrixWorld);
    explosion(_w.x, _w.y, _w.z, force, true);
    debris(_w.x, _w.y, _w.z, 3, 170, 7, 0);
  }
  function ecrasement(V, hs){
    V.impact = true; V.tImpact = V.tM; V.etat = 'epave';
    const x = V.x, y = V.y;
    solCourant = hs;
    emettre(GAB.eclatFeu, x, hs + 40, y, 0, 0, 0, 900, 2.4);
    emettre(GAB.eclat, x, hs + 60, y, 0, 0, 0, 600, 2);
    for(let k = 0; k < 5; k++){
      const a = Math.random()*6.283, r = alea(40, 220);
      explosion(x + Math.cos(a)*r, hs + alea(20, 70), y + Math.sin(a)*r, alea(2.2, 3.6), true);
    }
    solCourant = hs;
    const nP = Math.round(46*debit());
    for(let k = 0; k < nP; k++){       // mur de poussière
      const a = k/nP*6.283 + alea(-0.05, 0.05), r = alea(160, 280), v = alea(120, 230);
      emettre(GAB.poussiere, x + Math.cos(a)*r, hs + alea(6, 26), y + Math.sin(a)*r, Math.cos(a)*v, alea(10, 40), Math.sin(a)*v, alea(60, 110), 1.3);
    }
    for(let k = 0; k < Math.round(12*debit()); k++){
      const a = Math.random()*6.283, r = alea(0, 200);
      emettre(GAB.fumee, x + Math.cos(a)*r, hs + alea(20, 60), y + Math.sin(a)*r, alea(-10, 10), alea(20, 44), alea(-10, 10), alea(70, 120), 1.4);
    }
    debris(x, hs + 30, y, 60, 420, 11, 0.5);
    ajouterOnde(x, y, 760, TEINTE_CLAIRE, 1.9, 0.85);
    ajouterOnde(x, y, 520, '#ffb070', 2.6, 0.6);
    flash.vie = 0;
    eclairLumiere(x, hs + 120, y, '#ffd0a0', 18, 1700, 1.3);
    if(R3D.ajouterBrulure){
      R3D.ajouterBrulure(x, y, 170);
      for(let k = 0; k < 7; k++){ const a = k/7*6.283, r = alea(140, 250); R3D.ajouterBrulure(x + Math.cos(a)*r, y + Math.sin(a)*r, alea(50, 95)); }
    }
    secousse = 1.4;
  }
  function majDestruction(V, dt){
    if(dt <= 0) return;
    const U = V.U;
    V.tM += dt;
    const t = V.tM;
    if(!V.impact){
      // 1. Explosions en chaîne sur la coque, feux qui vacillent, cœur qui s'emballe.
      V.prochaine -= dt;
      if(V.prochaine <= 0){
        V.prochaine = t < 2.6 ? alea(0.14, 0.34) : alea(0.1, 0.22);
        explosionCoque(V, t < 2.6 ? alea(1, 1.8) : alea(1.4, 2.4));
        secousse = Math.max(secousse, 0.2);
      }
      U.uBraise.value = 1;
      if(t > 0.9) U.uDegats.value = Math.max(U.uDegats.value, 1);
      if(t > 1.8) U.uDegats.value = 2;
      U.uPulse.value = t < 2.6 ? (Math.random() < 0.5 ? 1.25 : 0.12) : Math.max(0, 0.5 - (t - 2.6)*0.4)*(Math.random() < 0.6 ? 1 : 0.2);
      V.chargeC = t < 2.6 ? 0.4 + 0.6*t/2.6 : 0;
      incendies(V, 2, dt, 1.2);
      // 2. Détonation du cœur.
      if(!V.detone && t >= 2.6){
        V.detone = true; V.vie = 0; V.souffle = 0; V.chargeL = 0;
        const c = V.posCoeur;
        explosion(c.x, c.y, c.z, 4, false); explosion(c.x, c.y + 30, c.z, 3, true);
        solCourant = -1e9;
        emettre(GAB.eclat, c.x, c.y, c.z, 0, 0, 0, 520, 2.2);
        debris(c.x, c.y, c.z, 26, 260, 10, 0);
        flash.vie = 0;
        eclairLumiere(c.x, c.y, c.z, TEINTE_CLAIRE, 16, 1500, 0.9);
        secousse = 1;
        V.vitA = 0.6; V.vitB = 0.45;
      }
      // 3. Chute : le vaisseau pique du nez, s'incline, ses anneaux se disloquent.
      if(t >= 2.6){
        V.vy = Math.max(V.vy - 78*dt, -230);
        V.alt += V.vy*dt; V.x += V.vx*dt; V.y += V.vz*dt;
        V.tang += (-0.26 - V.tang)*Math.min(1, dt*0.5); V.roulis += (0.22 - V.roulis)*Math.min(1, dt*0.4);
        V.pivotA.rotation.x += dt*0.10; V.pivotA.position.y += dt*5;
        V.pivotB.rotation.z -= dt*0.07; V.pivotB.position.y -= dt*7;
        const hs = sol(V.x, V.y);
        if(V.alt <= hs + 48){ V.alt = hs + 48; ecrasement(V, hs); }
      }
    } else {
      // 4. Épave : elle brûle, se carbonise, puis s'enfonce.
      const ta = t - V.tImpact;
      U.uPulse.value = 0; U.uCarbon.value = lisse(0, 3.5, ta); U.uBraise.value = 1 - 0.6*lisse(4, DUREE_EPAVE, ta);
      V.tang += (-0.20 - V.tang)*Math.min(1, dt*3); V.roulis += (0.15 - V.roulis)*Math.min(1, dt*3);
      V.vitA *= Math.exp(-dt*1.5); V.vitB *= Math.exp(-dt*1.5);
      const k = 1 - lisse(DUREE_EPAVE*0.5, DUREE_EPAVE, ta);
      if(k > 0.02) incendies(V, 2, dt, 0.9*k);
      if(ta > DUREE_EPAVE){
        const e = (ta - DUREE_EPAVE)/DUREE_ENFONCE;
        V.alt -= 150/DUREE_ENFONCE*dt; V.vieOmbre = Math.max(0, 1 - e*1.3);
        if(Math.random() < dt*10*debit()){
          const a = Math.random()*6.283, r = alea(60, 260), hs = sol(V.x, V.y);
          solCourant = hs;
          emettre(GAB.poussiere, V.x + Math.cos(a)*r, hs + 6, V.y + Math.sin(a)*r, Math.cos(a)*20, alea(8, 22), Math.sin(a)*20, alea(40, 70));
        }
        if(e >= 1) cacher(V);
      }
    }
  }

  // =================================================================
  //  6. EFFETS DU MOTEUR : 'rayon', 'chargeSol', 'bouclier'
  //  Champs du contrat : t = instant de création sur l'horloge du moteur, duree en secondes.
  // =================================================================
  gabarit('hexa', {add:1, cadre:3, t0:0.6, t1:1.6, c0:'#ffffff', c1:TEINTE, vie:[0.3, 0.45], fo:1.2});
  const vus = new WeakSet(), suivis = new WeakMap();
  function ageDe(e, temps){
    if(typeof e.t === 'number') return temps - e.t;
    if(typeof e.max === 'number' && typeof e.vie === 'number') return e.max - e.vie;     // effets classiques du moteur
    return 0;
  }

  // Rayon principal : colonne d'énergie du cœur jusqu'au sol, impact, débris, lumière.
  function rayon(e, age, dt){
    const D = e.duree || 1.5, L = e.largeur || 26, V = vaisseau;
    const env = lisse(0, 0.14, age)*(1 - lisse(D - 0.3, D, age));
    let ax, ay, az;
    if(V && V.racine.visible && V.etat === 'vol' && Math.hypot(e.x1 - V.x, e.y1 - V.y) < 340){
      // Le rayon part du cœur du modèle, où qu'en soit son balancement.
      ax = V.posCoeur.x; ay = V.posCoeur.y - 22; az = V.posCoeur.z;
      V.tirL = Math.max(V.tirL, env);
    } else { ax = e.x1; az = e.y1; ay = sol(ax, az) + (e.h1 || 0); }
    const bx = e.x2, bz = e.y2, hs = sol(bx, bz), by = hs + (e.h2 || 0);
    if(!vus.has(e)){
      vus.add(e);
      suivis.set(e, {x:bx, y:bz, cadence:0});
      if(dt > 0){
        solCourant = hs;
        emettre(GAB.eclat, bx, by + 10, bz, 0, 0, 0, L*16, 1.6);
        ajouterOnde(bx, bz, L*7, TEINTE_CLAIRE, 0.7, 0.9);
        if(R3D.ajouterBrulure) R3D.ajouterBrulure(bx, bz, L*1.9);
        debris(bx, by + 4, bz, 10, 240, 5, 0.6);
        secousse = Math.max(secousse, 0.6);
      }
    }
    if(env <= 0.003) return;
    const scint = 0.86 + 0.14*Math.sin(horloge*61 + bx);
    ruban(ax, ay, az, bx, by, bz, L*3.4, VERT[0], VERT[1], VERT[2], 0.55*env, 1, 0);
    ruban(ax, ay, az, bx, by, bz, L*1.25*(0.7 + 0.3*env)*scint, 0.85, 1, 0.95, env, 1, 1.7);
    lueur(ax, ay, az, L*6*scint, VERT[0], VERT[1], VERT[2], 0.9*env, 0, 0);
    lueur(bx, by + L*0.9, bz, L*10*scint, 0.8, 1, 0.92, env, 0, 0, 0.8);
    lueur(bx, by + L*0.9, bz, L*16, 1, 1, 1, 0.8*env*scint, 2, horloge*2.3, 0.8);
    lueur(bx, by + L*0.9, bz, L*26, VERT[0], VERT[1], VERT[2], 0.22*env, 0, 0, 0.8);
    eclairLumiere(bx, by + 40, bz, TEINTE_CLAIRE, 9*env*scint, 760, 0.18);
    if(dt <= 0) return;
    secousse = Math.max(secousse, 0.22*env);
    solCourant = hs;
    let n = dt*70*env*debit();
    while(n > 0){
      if(n < 1 && Math.random() > n) break;
      n -= 1; dirAlea();
      const v = alea(140, 380);
      emettre(GAB.etincelle, bx, by + 3, bz, DX*v, Math.abs(DY)*v + 80, DZ*v, alea(3, 6.5));
    }
    if(Math.random() < dt*16*debit()){
      const a = Math.random()*6.283, r = alea(0, L), v = alea(30, 90);
      emettre(GAB.poussiere, bx + Math.cos(a)*r, by + 6, bz + Math.sin(a)*r, Math.cos(a)*v, alea(20, 60), Math.sin(a)*v, alea(26, 48));
    }
    if(Math.random() < dt*9*debit()) emettre(GAB.fumee, bx + alea(-L, L)*0.5, by + 10, bz + alea(-L, L)*0.5, alea(-8, 8), alea(24, 50), alea(-8, 8), alea(26, 44));
    if(Math.random() < dt*30*debit()){ dirAlea(); emettre(GAB.plasma, bx + DX*L, by + Math.abs(DY)*L*2, bz + DZ*L, DX*30, alea(40, 120), DZ*30, alea(10, 20)); }
    const s = suivis.get(e);
    if(s){
      s.cadence -= dt;
      if(s.cadence <= 0){ s.cadence = 0.14; debris(bx, by + 4, bz, 2, 230, 4.5, 0.7); }
      // Si le rayon balaie le sol, il laisse une traînée de brûlures.
      if(Math.hypot(bx - s.x, bz - s.y) > L*1.1){ s.x = bx; s.y = bz; if(R3D.ajouterBrulure) R3D.ajouterBrulure(bx, bz, L*1.5); }
    }
  }

  // Cercle d'alerte au sol : il se resserre sur le point d'impact pendant la durée de l'effet.
  function alerte(m, e, age, dt){
    const D = e.duree || 4, R = e.rayon || 120, k = clamp(age/D, 0, 1), hs = sol(e.x, e.y);
    m.visible = true;
    m.position.set(e.x, hauteurDecal(e.x, e.y, R) + 0.4, e.y); m.scale.setScalar(R*2.3);
    const U = m.material.uniforms;
    U.uK.value = k; U.uT.value = horloge; U.uAlpha.value = lisse(0, 0.25, age)*0.95;
    lueur(e.x, hs + 5, e.y, R*1.5*(0.6 + 0.4*k), VERT[0], VERT[1], VERT[2], 0.08 + 0.22*k*k, 0, 0);
    if(dt > 0 && Math.random() < dt*(6 + 30*k)*debit()){
      const a = Math.random()*6.283, r = Math.sqrt(Math.random())*R*(1.6 - 0.6*k);
      solCourant = hs;
      emettre(GAB.plasma, e.x + Math.cos(a)*r, hs + 2, e.y + Math.sin(a)*r, 0, alea(30, 90)*(0.5 + k), 0, alea(4, 9));
    }
  }

  // Éclat de bouclier : onde alvéolée sur la bulle, éclat hexagonal et étincelles au point d'impact.
  function eclatBouclier(e){
    const V = vaisseau;
    let px = e.x, pz = e.y, py;
    if(V && V.racine.visible && V.etat === 'vol' && Math.hypot(e.x - V.x, e.y - V.y) < 460){
      py = typeof e.h === 'number' ? sol(px, pz) + e.h : V.alt;
      _v.set(px, py, pz); V.bouclier.worldToLocal(_v);
      if(_v.lengthSq() < 0.05 && R3D.camera){ _v.copy(R3D.camera.position); V.bouclier.worldToLocal(_v); }   // point donné au centre : face à la caméra
      _v.normalize();
      let s = V.impacts[0];
      for(const im of V.impacts){ if(im.w < 0){ s = im; break; } if(im.w > s.w) s = im; }
      s.set(_v.x, _v.y, _v.z, 0);
      _w.copy(_v); V.bouclier.localToWorld(_w);
      px = _w.x; py = _w.y; pz = _w.z;
      V.frisson = Math.min(1, V.frisson + 0.35);
    } else py = sol(px, pz) + (e.h || 0);
    solCourant = -1e9;
    emettre(GAB.eclat, px, py, pz, 0, 0, 0, 46);
    emettre(GAB.hexa, px, py, pz, 0, 0, 0, 84);
    for(let k = 0; k < 6; k++){ dirAlea(); emettre(GAB.etincelle, px, py, pz, DX*120, DY*120, DZ*120, alea(2.5, 4.5), 0.6); }
  }

  function majEffetsJeu(effets, temps, dt){
    let nAl = 0, nRay = 0;
    if(effets) for(let i = 0; i < effets.length; i++){
      const e = effets[i];
      if(!e) continue;
      if(e.type === 'rayon'){ if(nRay < 3){ nRay++; rayon(e, ageDe(e, temps), dt); } }
      else if(e.type === 'chargeSol'){ if(nAl < MAX_ALERTES) alerte(alertes[nAl++], e, ageDe(e, temps), dt); }
      else if(e.type === 'bouclier'){ if(!vus.has(e)){ vus.add(e); if(dt > 0) eclatBouclier(e); } }
    }
    for(let i = nAl; i < MAX_ALERTES; i++) alertes[i].visible = false;
  }

  // Simulation commune : à appeler une fois par image, après que tout le monde a déposé ses sprites et rubans.
  function majCommun(dt){
    majOndes(dt); majLumieres(dt); majDebris(dt);
    majLot(lotNorm, dt); majLot(lotAdd, dt); majRubans();
    // Secousse de caméra en jeu (rayon, écrasement). R3D.majCamera replace la caméra à l'image suivante.
    if(secousse > 0.01 && dt > 0 && !CINE.active && R3D.camera){
      const a = secousse*4.5, t = horloge, cam = R3D.camera;
      cam.position.x += a*Math.sin(t*47.1)*Math.sin(t*13.3 + 1);
      cam.position.y += a*0.7*Math.sin(t*39.7 + 2)*Math.sin(t*17.9);
      cam.position.z += a*Math.sin(t*43.3 + 4)*Math.sin(t*11.7 + 3);
      cam.updateMatrixWorld();
    }
    secousse = secousse > 0.01 ? secousse*Math.exp(-dt*2.6) : 0;
  }

  // =================================================================
  //  7. INTERFACE R3D.Aliens
  // =================================================================
  const Aliens = R3D.Aliens = {
    // Vrai : la coque devient à demi transparente (trame) quand elle masque le point que regarde le joueur.
    transparence:true,

    init(){
      if(pret || !R3D.scene || typeof THREE === 'undefined') return;
      groupe = new THREE.Group(); groupe.name = 'aliens';
      R3D.scene.add(groupe);
      atlas = creerAtlas();
      lotNorm = creerLot(MAX_NORM, SIM_NORM, false);
      lotAdd = creerLot(MAX_ADD, SIM_ADD, true);
      creerRubans(); creerDebris(); creerDecalques();
      pret = true;
    },

    // Facultatif : construit le vaisseau et fait compiler tous les shaders du module à la prochaine image
    // rendue (voir « Préchauffage »). À appeler au lancement d'une partie où l'invasion peut survenir,
    // pendant l'écran de chargement : sinon cet à-coup a lieu à la première image de la cinématique.
    preparer(){
      if(!pret) this.init();
      if(!pret) return;
      if(!vaisseau) vaisseau = creerVaisseau();
      // (aussi après un préchauffage fait sans vaisseau, par une version antérieure de prechauffer)
      if(chauffe === 0 || (chauffe === 3 && !vaisseauChauffe)) chauffe = 1;
    },

    // Préchauffage (contrat commun, appelé par R3D.prechauffer pendant « Chargement… », avant
    // renderer.compile) : si une invasion peut survenir dans cette partie, construit le vaisseau ; puis
    // rend tout le module « visible » sans rien montrer (voir rechauffer), tout de suite et non à la
    // fin du prochain sync, pour que renderer.compile et l'image de préchauffage le compilent.
    // Le prochain appel public (sync, jouer…) remet tout comme avant (finChauffe).
    // Le vaisseau est construit dans tous les cas : au chargement de la page, on ne sait pas encore
    // si la partie qui suivra aura une invasion.
    prechauffer(){
      if(!pret) this.init();
      if(!pret) return false;
      if(!vaisseau) vaisseau = creerVaisseau();
      if(chauffe === 2) finChauffe();
      rechauffer();
      return true;
    },

    // ents : entités du moteur ; effets : liste d'effets du moteur ; temps : horloge du moteur ; dt : 0 en pause.
    sync(ents, effets, temps, dt){
      if(!pret) return;
      if(chauffe === 2) finChauffe();
      dt = dt > 0 ? Math.min(dt, 0.1) : 0;
      if(CINE.active) return;                 // la cinématique anime tout elle-même
      horloge += dt;
      let ent = null;
      if(ents) for(let i = 0; i < ents.length; i++){
        const e = ents[i];
        if(e && e.def && (e.def.rendu === 'aliens' || e.def.forme === 'vaisseauMere')){ ent = e; break; }
      }
      vivantes.length = 0;
      let V = vaisseau;
      if(ent && !ent.mort){
        if(!V) V = vaisseau = creerVaisseau();
        suivreEntite(V, ent, dt);
        vivantes.push(V.racine);
      } else if(V){
        if(V.etat === 'vol'){
          const e = ent || V.ent;
          if(e && (e.mort || e.pv <= 0)) lancerDestruction(V); else cacher(V);
        } else if(V.etat === 'attente'){
          // Après la cinématique : le modèle reste en place jusqu'à ce que le moteur crée l'entité.
          V.tAttente += dt;
          if(V.tAttente > 15) cacher(V);
        }
      }
      if(V && (V.etat === 'chute' || V.etat === 'epave')) majDestruction(V, dt);
      if(V && V.etat !== 'cache') animerVaisseau(V, dt);
      majEffetsJeu(effets, temps || 0, dt);
      majCommun(dt);
      if(chauffe === 1) rechauffer();
    },

    racines(){ return vivantes; },

    // Hauteur conseillée de la barre de vie, au-dessus du centre du modèle (sommet + marge). Comme pour
    // R3D.Unites.hauteurBarre, l'altitude n'est PAS comprise : le moteur l'ajoute (altitudeDe, jeu.js).
    hauteurBarre(type){
      return SOMMET + 12;
    },

    // Remet le module à zéro (nouvelle partie) : plus de vaisseau, plus d'effets.
    reinitialiser(){
      if(!pret) return;
      if(chauffe === 2) finChauffe();
      if(CINE.active) CINE.passer();
      if(vaisseau) cacher(vaisseau);
      viderLot(lotAdd); viderLot(lotNorm);
      DB.vie.fill(0); DB.mesh.count = 0; DB.mesh.visible = false;
      for(const o of ondes){ o.vie = 0; o.m.visible = false; }
      for(const m of alertes) m.visible = false;
      RB.n = 0; majRubans();
      flash.vie = 0; flaqueFlash.visible = false; flaqueCoeur.visible = false;
      secousse = 0; vivantes.length = 0;
    },

    // Diagnostic : triangles du modèle, état, sprites en cours.
    infos(){
      return {pret, etat:vaisseau ? vaisseau.etat : 'absent', triangles:vaisseau ? vaisseau.mod.triangles : null,
        sprites:pret ? [lotAdd.geo.instanceCount, lotNorm.geo.instanceCount] : null, chauffe};
    },
  };

  // =================================================================
  //  8. CINÉMATIQUE D'ARRIVÉE
  //  Tout avance par maj(dtReel) : aucune dépendance à requestAnimationFrame.
  //  Le vaisseau suit une loi de vol analytique (etatVol), la caméra passe d'un
  //  plan au suivant par fondus amortis, sans coupure.
  // =================================================================
  const JALONS = [['ciel', 0], ['nuages', 4.0], ['percee', 8.0], ['survol', 13.0], ['fin', 21.0]];
  const T_FIN = 23.5, T_DEP = 5.4, T_ARR = 20.5;           // fin, départ et arrivée du vaisseau (secondes)
  const RECUL = 900, ALT_ENTREE = 900, RECUL_NUAGES = 300; // le vaisseau part de 900 px derrière le bord de carte, à 900 d'altitude
  // Plans de caméra : [instant, numéro de pose]. Entre deux instants, fondu de la pose a vers la pose b.
  // 0 vue de jeu · 1 horizon · 2 nuages · 3 percée (téléobjectif) · 4 contre-plongée au sol · 5 plan large · 6 vue de jeu finale.
  // (De la contre-plongée au plan large, la caméra parcourt 2 000 px et se retourne : 2,6 s, pas moins.)
  const PLANS = [[0, 0], [3.6, 1], [7.6, 2], [11.0, 3], [12.4, 3], [14.2, 4], [17.0, 4], [19.6, 5], [21.0, 5], [T_FIN, 6]];
  const S = {x:0, y:0, alt:0, D:0, vit:0, vAlt:0};          // état de vol à l'instant courant
  const PA = {p:new THREE.Vector3(), c:new THREE.Vector3(), fov:40}, PB = {p:new THREE.Vector3(), c:new THREE.Vector3(), fov:40};
  const CN = {
    params:null, surFin:null, jalon:0, fin:false,
    dep:{x:0, y:0}, arr:{x:0, y:0}, dx:1, dy:0, lx:0, ly:1, L:1000, alt:ALT_JEU, angle:0,
    cam0:{p:new THREE.Vector3(), c:new THREE.Vector3(), fov:40, near:10, far:9000},      // caméra de jeu au départ
    jeu:{p:new THREE.Vector3(), c:new THREE.Vector3()},                                   // caméra de jeu à l'arrivée
    vue0:{x:0, y:0, distance:820}, vueFin:{x:0, y:0, distance:820},
    brume0:{near:0, far:0}, brumeFin:{near:0, far:0},
    pos:new THREE.Vector3(), cib:new THREE.Vector3(), fov:40,                             // caméra amortie
    Gs:{x:0, y:0}, E:{nx:0, ny:1, dist:1500},
    nuages:[], prochainEclair:0, regard:false, sombre0:0,
  };

  // Loi de vol : distance D le long de l'axe (0 = bord de carte, L = arrivée), altitude, vitesses.
  function etatVol(t, o){
    const s = clamp((t - T_DEP)/(T_ARR - T_DEP), 0, 1), q = 1 - s, u = 1 - Math.pow(q, 1.6), Dt = RECUL + CN.L;
    const du = s < 1 ? 1.6*Math.pow(q, 0.6)/(T_ARR - T_DEP) : 0, dh = ALT_ENTREE - CN.alt;
    o.D = -RECUL + u*Dt;
    o.x = CN.dep.x + CN.dx*o.D; o.y = CN.dep.y + CN.dy*o.D;
    o.alt = CN.alt + dh*Math.pow(1 - u, 2.2);
    o.vit = du*Dt; o.vAlt = -2.2*dh*Math.pow(1 - u, 1.2)*du;
    return o;
  }
  function altitudeEn(D){
    const u = clamp((D + RECUL)/(RECUL + CN.L), 0, 1);
    return CN.alt + (ALT_ENTREE - CN.alt)*Math.pow(1 - u, 2.2);
  }

  function calculerReperes(){
    const LX = typeof LARG !== 'undefined' ? LARG : 3200, LY = typeof HAUT !== 'undefined' ? HAUT : 2240;
    // Contre-plongée : au sol, sous la trajectoire, décalée du côté où tombe l'ombre du vaisseau
    // (et jamais à moins de 105 px de l'axe : le vaisseau ne passe pas exactement au zénith).
    const ds = R3D.dirSoleil;
    let gx = 0, gy = 0;
    if(ds && ds.y > 0.05){ gx = -ds.x/ds.y*CN.alt*0.45; gy = -ds.z/ds.y*CN.alt*0.45; }
    const gl = Math.hypot(gx, gy);
    if(gl > 170){ gx *= 170/gl; gy *= 170/gl; }
    const lat = gx*CN.lx + gy*CN.ly;
    if(Math.abs(lat) < 105){ const m = (105 - Math.abs(lat))*(lat >= 0 ? 1 : -1); gx += CN.lx*m; gy += CN.ly*m; }
    CN.Gs.x = clamp(CN.dep.x + CN.dx*0.74*CN.L + gx, 60, LX - 60);
    CN.Gs.y = clamp(CN.dep.y + CN.dy*0.74*CN.L + gy, 60, LY - 60);
    // Plan large : perpendiculaire à l'axe des deux bases, de préférence au sud (côté de la caméra de jeu).
    const b = CN.params.bases && CN.params.bases.length >= 2 ? CN.params.bases : [{x:CN.arr.x - 800, y:CN.arr.y}, {x:CN.arr.x + 800, y:CN.arr.y}];
    let bx = b[1].x - b[0].x, by = b[1].y - b[0].y;
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    let nx = -by, ny = bx;
    if(ny < 0 || (ny === 0 && nx < 0)){ nx = -nx; ny = -ny; }
    let etendue = 420;
    for(const p of b) etendue = Math.max(etendue, Math.abs((p.x - CN.arr.x)*bx + (p.y - CN.arr.y)*by) + 160);
    CN.E.nx = nx; CN.E.ny = ny;
    CN.E.dist = clamp(etendue*1.08/(Math.tan(22*RAD)*(R3D.camera.aspect || 1.7)), 1050, 2700);
  }

  // Masse nuageuse au bord de la carte, autour de l'axe d'entrée.
  function creerNuages(){
    const rnd = generateur(9091), N = qualite() === 'basse' ? 52 : 88;
    CN.nuages.length = 0;
    for(let i = 0; i < N; i++){
      const centre = i < N*0.45, lat = (rnd()*2 - 1)*(centre ? 560 : 1750);
      CN.nuages.push({lat, w:-420 + rnd()*800, alt:400 + rnd()*500 + (centre ? 0 : rnd()*120), taille:360 + rnd()*440,
        rot:rnd()*6.28, vrot:(rnd() - 0.5)*0.12, ton:0.55 + rnd()*0.6, delai:rnd()*1.4 + Math.abs(lat)/1750*1.6, ecart:0, eclair:0, phase:rnd()*6.28});
    }
    CN.prochainEclair = 0;
  }
  function majNuages(t, dt, sombre){
    const N = CN.nuages;
    if(!N.length) return;
    // Éclairs dans la masse.
    if(dt > 0 && t > 2.6 && t < 14){
      CN.prochainEclair -= dt;
      if(CN.prochainEclair <= 0){
        CN.prochainEclair = alea(0.18, 0.7)*(t > 7 ? 0.6 : 1);
        N[Math.floor(Math.random()*N.length*0.45)].eclair = 1;
        N[Math.floor(Math.random()*N.length)].eclair = 0.6;
      }
    }
    const depart = t >= T_DEP ? 1 : 0, eteint = 1 - lisse(18.5, 22.5, t), clarte = 1 - 0.6*sombre;
    for(let i = 0; i < N.length; i++){
      const n = N[i], Dn = -RECUL_NUAGES + n.w;
      const dh = n.alt - altitudeEn(Dn), r0 = Math.hypot(n.lat, dh) || 1;
      // Déchirure : le vaisseau repousse les nuages et laisse un trou derrière lui.
      const prox = lisse(-560, -120, S.D - Dn)*depart;
      n.ecart += (330*Math.exp(-(r0*r0)/(340*340))*prox - n.ecart)*Math.min(1, dt*2.2);
      n.eclair = Math.max(0, n.eclair - dt*6);
      const app = lisse(0.8 + n.delai, 4.2 + n.delai, t);
      const a = app*(0.82 - 0.5*Math.exp(-(r0*r0)/(250*250))*prox)*eteint;
      if(a < 0.01) continue;
      const k = n.ecart/r0, lat = n.lat*(1 + k), Dv = Dn - 500*(1 - app);
      const x = CN.dep.x + CN.dx*Dv + CN.lx*lat, z = CN.dep.y + CN.dy*Dv + CN.ly*lat;
      const y = n.alt + dh*k*0.8 + Math.sin(t*0.3 + n.phase)*8;
      // Embrasement autour de l'axe d'entrée.
      const feu = lisse(3.8, 8.4, t)*Math.exp(-(r0*r0)/(640*640))*(1 - 0.75*lisse(11, 17, t))*(0.8 + 0.2*Math.sin(t*5.3 + n.phase*3));
      const base = 0.15*n.ton*clarte;
      voile(x, y, z, n.taille*(0.7 + 0.3*app)*(1 + k*0.25), base + feu*1.25 + n.eclair*0.35, base*1.05 + feu*0.40 + n.eclair*0.8, base*1.25 + feu*0.07 + n.eclair*0.7, a, 1, n.rot + t*n.vrot);
      if(n.eclair > 0.05) lueur(x, y, z, n.taille*1.3, 0.5, 1, 0.85, n.eclair*0.35*eteint, 0, 0);
    }
    // Brasier au cœur de la masse, là où le vaisseau va percer.
    const g = lisse(4.2, 8.2, t)*(1 - lisse(9.5, 14, t));
    if(g > 0.01){
      const Dc = -RECUL_NUAGES + 100, x = CN.dep.x + CN.dx*Dc, z = CN.dep.y + CN.dy*Dc, y = altitudeEn(Dc);
      const p = 0.85 + 0.15*Math.sin(t*7.1)*Math.sin(t*3.3 + 1);
      lueur(x, y, z, 950*g*p, 1, 0.42, 0.10, 0.5*g, 0, 0);
      lueur(x, y + 20, z, 520*p, 1, 0.75, 0.40, 0.42*g, 0, 0);
    }
  }
  // Rentrée atmosphérique : la coque rougit côté vent, des traînées de plasma partent des éperons.
  function majPlasma(V, chauffe, dt){
    const vx = CN.dx*S.vit, vz = CN.dy*S.vit, vy = S.vAlt, vl = Math.hypot(vx, vy, vz) || 1;
    const ux = vx/vl, uy = vy/vl, uz = vz/vl;
    V.U.uDirChauffe.value.set(ux, uy, uz); V.U.uChauffe.value = chauffe;
    if(chauffe < 0.01) return;
    const M = V.assiette.matrixWorld, d = debit();
    solCourant = -1e9;
    for(let i = 0; i < POINTS_PLASMA.length; i++){
      const p = POINTS_PLASMA[i], f = 0.8 + 0.2*Math.sin(horloge*23 + i*1.7);
      _v.set(p[0], p[1], p[2]).applyMatrix4(M);
      const len = (300 + 260*p[3])*chauffe*f, larg = 34 + 40*p[3];
      ruban(_v.x, _v.y, _v.z, _v.x - ux*len, _v.y - uy*len + len*0.06, _v.z - uz*len, larg, 1, 0.55, 0.2, 0.55*chauffe, 0, 0);
      ruban(_v.x, _v.y, _v.z, _v.x - ux*len*0.45, _v.y - uy*len*0.45, _v.z - uz*len*0.45, larg*0.4, 1, 0.92, 0.75, 0.8*chauffe, 0, 0);
      lueur(_v.x, _v.y, _v.z, (70 + 80*p[3])*f, 1, 0.7, 0.35, 0.9*chauffe, 0, 0);
      if(dt > 0 && Math.random() < dt*14*d) emettre(GAB.chaleur, _v.x, _v.y, _v.z, -ux*S.vit*0.4 + alea(-20, 20), -uy*S.vit*0.4 + alea(-20, 20), -uz*S.vit*0.4 + alea(-20, 20), alea(40, 80));
      if(dt > 0 && Math.random() < dt*5*d) emettre(GAB.vapeur, _v.x - ux*60, _v.y - uy*60, _v.z - uz*60, alea(-10, 10), alea(-4, 10), alea(-10, 10), alea(90, 160));
    }
  }

  // Poses de caméra (position p, point visé c, ouverture fov) à l'instant t.
  function versSol(o, k, h){
    const x = mel(CN.cam0.p.x, CN.Gs.x, k), z = mel(CN.cam0.p.z, CN.Gs.y, k);
    o.p.set(x, sol(x, z) + h, z);
  }
  function pose(i, t, o){
    const xn = CN.dep.x - CN.dx*RECUL_NUAGES, zn = CN.dep.y - CN.dy*RECUL_NUAGES;
    switch(i){
      case 0: o.p.copy(CN.cam0.p); o.c.copy(CN.cam0.c); o.fov = CN.cam0.fov; break;
      case 1: versSol(o, 0.30, 230); o.c.set(xn, 540, zn); o.fov = 42; break;                                       // la caméra se tourne vers l'horizon
      case 2: versSol(o, 0.52, 165); o.c.set(xn + CN.lx*60, 610, zn + CN.ly*60); o.fov = 36; break;                 // la masse nuageuse
      case 3: versSol(o, 0.78, 105); o.c.set(S.x + CN.dx*230, S.alt - 20, S.y + CN.dy*230); o.fov = 27; break;      // la proue perce
      case 4: o.p.set(CN.Gs.x, sol(CN.Gs.x, CN.Gs.y) + 8, CN.Gs.y); o.c.set(S.x, S.alt - 90, S.y); o.fov = 62; break;   // contre-plongée
      case 5: {                                                                                                     // plan large, les deux bases
        const E = CN.E, a = (t - 19)*0.03, ca = Math.cos(a), sa = Math.sin(a);
        const px = CN.arr.x + (E.nx*ca - E.ny*sa)*E.dist*0.94, pz = CN.arr.y + (E.nx*sa + E.ny*ca)*E.dist*0.94;
        o.p.set(px, Math.max(E.dist*0.34, sol(px, pz) + 80), pz); o.c.set(CN.arr.x, 130, CN.arr.y); o.fov = 44; break;
      }
      default: o.p.copy(CN.jeu.p); o.c.copy(CN.jeu.c); o.fov = CN.cam0.fov;
    }
  }
  function signaler(nom){
    try { if(CN.params && typeof CN.params.surJalon === 'function') CN.params.surJalon(nom); }
    catch(err){ if(typeof console !== 'undefined') console.warn('[Cinématique] jalon « ' + nom + ' » :', err); }
  }
  // État final : vaisseau à l'arrivée, à son altitude de jeu ; caméra de jeu restaurée.
  function terminer(){
    if(CN.fin) return;
    CN.fin = true;
    const V = vaisseau, cam = R3D.camera, vue = R3D.vue;
    // Pose finale d'abord (modèle et R3D.Cinematique.pose à params.arrivee) : un jalon signalé
    // ci-dessous, ou le moteur appelé par passer(), trouve déjà le vaisseau à sa place d'arrivée.
    V.x = CN.arr.x; V.y = CN.arr.y; V.alt = CN.alt; V.angle = CN.angle; V.tang = 0; V.roulis = 0;
    CINE.pose = {x:CN.arr.x, y:CN.arr.y, alt:CN.alt, angle:CN.angle};
    while(CN.jalon < JALONS.length) signaler(JALONS[CN.jalon++][0]);
    if(typeof R3D.assombrir === 'function') R3D.assombrir(1);
    CN.nuages.length = 0;
    V.U.uChauffe.value = 0;
    V.x = CN.arr.x; V.y = CN.arr.y; V.alt = CN.alt; V.angle = CN.angle; V.tang = 0; V.roulis = 0;
    V.vitA = 0.10; V.vitB = 0.07; V.chargeC = 0;
    V.racine.visible = true; V.etat = 'attente'; V.tAttente = 0;
    cam.fov = CN.cam0.fov; cam.near = CN.cam0.near; cam.far = CN.cam0.far; cam.updateProjectionMatrix();
    vue.x = CN.vueFin.x; vue.y = CN.vueFin.y;
    vue.distance = CN.vueFin.distance + 1; R3D.majCamera();      // force R3D.majCamera à recalculer ses plans de coupe
    vue.distance = CN.vueFin.distance; R3D.majCamera();
    CINE.active = false;
    CINE.pose = {x:CN.arr.x, y:CN.arr.y, alt:CN.alt, angle:CN.angle};
    animerVaisseau(V, 0); majCommun(0);
    const f = CN.surFin;
    CN.surFin = null; CN.params = null; CN.fin = false;
    if(typeof f === 'function'){
      try { f(); } catch(err){ if(typeof console !== 'undefined') console.warn('[Cinématique] surFin :', err); }
    }
  }

  const CINE = R3D.Cinematique = {
    active:false,
    temps:0,            // instant courant (secondes)
    duree:T_FIN,
    pose:null,          // après la fin : {x, y, alt, angle} du vaisseau, pour créer l'entité sans saut

    // nom : 'arrivee'. params : {depart:{x, y}, arrivee:{x, y}, bases:[{x, y}, {x, y}], surJalon(nom)}
    // et, facultatifs, alt (altitude de jeu) et vueFin:{x, y, distance} (vue de jeu à rendre à la fin ;
    // par défaut celle du début). Jalons : 'ciel', 'nuages', 'percee', 'survol', 'fin'.
    jouer(nom, params, surFin){
      if(!pret) Aliens.init();
      if(chauffe === 2) finChauffe();
      if(nom !== 'arrivee' || !pret || !R3D.camera || !R3D.vue || !params || !params.depart || !params.arrivee){
        if(typeof surFin === 'function') surFin();
        return false;
      }
      if(CINE.active) CINE.passer();
      Aliens.preparer();
      const V = vaisseau, cam = R3D.camera, vue = R3D.vue, fog = R3D.scene.fog;
      CN.params = params; CN.surFin = surFin || null; CN.jalon = 0; CN.fin = false; CN.regard = false;
      CN.arr.x = params.arrivee.x; CN.arr.y = params.arrivee.y;
      let dx = CN.arr.x - params.depart.x, dy = CN.arr.y - params.depart.y, L = Math.hypot(dx, dy);
      if(L < 1){ dx = 0; dy = 1; L = 1; }
      CN.dx = dx/L; CN.dy = dy/L; CN.lx = -CN.dy; CN.ly = CN.dx; CN.L = Math.max(L, 500);
      CN.dep.x = CN.arr.x - CN.dx*CN.L; CN.dep.y = CN.arr.y - CN.dy*CN.L;
      const def = typeof UNITES !== 'undefined' && UNITES ? UNITES.vaisseauMere : null;
      CN.alt = params.alt || (def && def.alt) || ALT_JEU;
      CN.angle = Math.atan2(CN.dy, CN.dx);
      // Caméra de jeu : état de départ, et état à rendre à la fin.
      CN.cam0.p.copy(cam.position); CN.cam0.c.set(vue.x, 0, vue.y);
      CN.cam0.fov = cam.fov; CN.cam0.near = cam.near; CN.cam0.far = cam.far;
      CN.vue0.x = vue.x; CN.vue0.y = vue.y; CN.vue0.distance = vue.distance;
      const vf = params.vueFin || CN.vue0;
      CN.vueFin.x = vf.x; CN.vueFin.y = vf.y; CN.vueFin.distance = vf.distance || CN.vue0.distance;
      if(fog && fog.isFog){ CN.brume0.near = fog.near; CN.brume0.far = fog.far; }
      vue.x = CN.vueFin.x; vue.y = CN.vueFin.y; vue.distance = CN.vueFin.distance;
      R3D.majCamera();
      CN.jeu.p.copy(cam.position); CN.jeu.c.set(vue.x, 0, vue.y);
      if(fog && fog.isFog){ CN.brumeFin.near = fog.near; CN.brumeFin.far = fog.far; }
      CN.pos.copy(CN.cam0.p); CN.cib.copy(CN.cam0.c); CN.fov = CN.cam0.fov;
      calculerReperes();
      creerNuages();
      remettreANeuf(V);
      V.etat = 'cinema'; V.ent = null; V.racine.visible = false; V.angle = CN.angle; V.flot = 0;
      // Si des signes avant-coureurs ont déjà assombri le ciel, on part de ce niveau (il ne s'éclaircit pas).
      CN.sombre0 = typeof R3D.assombrissement === 'function' ? clamp(+R3D.assombrissement() || 0, 0, 1) : 0;
      delete V.racine.userData.entId;
      vivantes.length = 0;
      CINE.active = true; CINE.temps = 0; CINE.pose = null;
      CINE.maj(0);
      // maj déplace R3D.vue pour cadrer les ombres. Si le moteur dessine encore une image ordinaire avant
      // sa première image de cinématique (il a lancé jouer() au milieu de sa mise à jour), elle doit
      // montrer la vue de jeu de départ, pas ce cadrage : on la lui rend.
      vue.x = CN.vue0.x; vue.y = CN.vue0.y; vue.distance = CN.vue0.distance;
      R3D.majCamera();
      return true;
    },

    // À appeler à chaque image pendant la cinématique, avant R3D.rendre. dtReel en secondes.
    maj(dtReel){
      if(!CINE.active) return;
      if(chauffe === 2) finChauffe();
      const dt = dtReel > 0 ? Math.min(dtReel, 0.1) : 0, V = vaisseau, cam = R3D.camera, vue = R3D.vue;
      horloge += dt; CINE.temps += dt;
      const t = CINE.temps;
      while(CINE.active && CN.jalon < JALONS.length && t >= JALONS[CN.jalon][1]) signaler(JALONS[CN.jalon++][0]);
      if(!CINE.active) return;                          // un jalon a pu appeler passer()
      if(t >= T_FIN){ terminer(); return; }
      // Le ciel s'assombrit.
      const sombre = mel(CN.sombre0, 1, lisse(0.3, 6.5, t));
      if(typeof R3D.assombrir === 'function') R3D.assombrir(sombre);
      // Le vaisseau.
      etatVol(t, S);
      const visible = t >= T_DEP, elan = lisse(40, 230, S.vit);
      V.racine.visible = visible;
      V.x = S.x; V.y = S.y; V.alt = S.alt; V.angle = CN.angle;
      V.tang = Math.atan2(S.vAlt, Math.max(S.vit, 1))*0.8;
      V.roulis = 0.05*Math.sin(t*0.9)*elan;
      V.vitA = 0.10 + 0.5*elan; V.vitB = 0.07 + 0.35*elan;
      // « Regard » : arrivé au-dessus du champ de bataille, le cœur s'ouvre un instant et balaie le sol.
      V.chargeC = 0.06 + 0.7*lisse(19.2, 20.2, t)*(1 - lisse(20.6, 22.2, t));
      if(!CN.regard && t >= 20.25){ CN.regard = true; ajouterOnde(CN.arr.x, CN.arr.y, 980, TEINTE, 2.4, 0.55); }
      if(visible){
        animerVaisseau(V, dt);
        majPlasma(V, lisse(T_DEP + 0.4, 7.4, t)*(1 - lisse(11.5, 15.5, t)), dt);
      } else { ombre.visible = false; flaqueCoeur.visible = false; }
      majNuages(t, dt, sombre);
      // La caméra : fondu entre les deux poses du plan courant, puis amorti.
      let i = 0;
      while(i < PLANS.length - 2 && t >= PLANS[i + 1][0]) i++;
      const w = lisse5((t - PLANS[i][0])/(PLANS[i + 1][0] - PLANS[i][0]));
      pose(PLANS[i][1], t, PA);
      if(PLANS[i + 1][1] !== PLANS[i][1]){ pose(PLANS[i + 1][1], t, PB); PA.p.lerp(PB.p, w); PA.c.lerp(PB.c, w); PA.fov = mel(PA.fov, PB.fov, w); }
      const serre = lisse(21.4, 23.3, t);               // l'amorti se resserre à l'approche de la vue de jeu
      const kp = dt > 0 ? 1 - Math.exp(-dt/mel(0.28, 0.03, serre)) : 0, kc = dt > 0 ? 1 - Math.exp(-dt/mel(0.22, 0.03, serre)) : 0;
      CN.pos.lerp(PA.p, kp); CN.cib.lerp(PA.c, kc); CN.fov += (PA.fov - CN.fov)*kp;
      // R3D.majCamera cadre la carte d'ombres et le brouillard autour de l'action...
      const D_OMBRE = 1500;
      if(t < 21.6){
        let fx = CN.cib.x - CN.pos.x, fz = CN.cib.z - CN.pos.z;
        const fl = Math.hypot(fx, fz) || 1, wS = lisse(9.5, 13, t);
        fx /= fl; fz /= fl;
        vue.x = mel(CN.pos.x + fx*500, S.x, wS); vue.y = mel(CN.pos.z + fz*500, S.y, wS) + 0.24*D_OMBRE; vue.distance = D_OMBRE;
      } else { vue.x = CN.vueFin.x; vue.y = CN.vueFin.y; vue.distance = CN.vueFin.distance; }
      R3D.majCamera();
      // ... puis la cinématique reprend la main sur la caméra (secousses légères comprises).
      const proche = Math.exp(-Math.pow(Math.hypot(S.x - CN.pos.x, S.y - CN.pos.z)/420, 2))*lisse(12.5, 13.5, t);
      const grondement = (0.5*lisse(3.5, 7.5, t) + lisse(7.6, 9, t)*(1 - lisse(11.5, 14, t)) + 1.5*proche)*(1 - lisse(19.5, 21.5, t));
      const a = grondement*1.1;
      cam.position.set(CN.pos.x + a*Math.sin(t*31.7)*Math.sin(t*7.3 + 1), CN.pos.y + a*0.8*Math.sin(t*27.1 + 2)*Math.sin(t*9.1), CN.pos.z + a*Math.sin(t*29.3 + 4)*Math.sin(t*6.7 + 3));
      const hsCam = sol(cam.position.x, cam.position.z);
      if(cam.position.y < hsCam + 4) cam.position.y = hsCam + 4;
      cam.lookAt(CN.cib);
      cam.rotateZ(grondement*0.004*Math.sin(t*23.3 + 1.3));
      cam.fov = CN.fov; cam.near = clamp((cam.position.y - hsCam)*0.25, 1.5, 30); cam.far = 16000;
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      const fog = R3D.scene.fog;
      if(fog && fog.isFog){
        const e = lisse(0, 3, t), s = lisse(21, T_FIN, t);
        fog.near = mel(mel(CN.brume0.near, 1000, e), CN.brumeFin.near, s);
        fog.far = mel(mel(CN.brume0.far, 9500, e), CN.brumeFin.far, s);
      }
      majCommun(dt);
      if(chauffe === 1) rechauffer();
    },

    // Saute proprement à l'état final : les jalons restants sont signalés dans l'ordre, puis surFin.
    passer(){
      if(!CINE.active || CN.fin) return;
      if(chauffe === 2) finChauffe();
      CINE.temps = T_FIN;
      viderLot(lotAdd); viderLot(lotNorm);
      terminer();
    },
  };
})();
