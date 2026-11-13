'use strict';
/* =====================================================================
   FRONT DE SEL — rendu 3D des unités (three.js r128).

   Organisation :
     1. Outils : couleurs, matrices, « Piece » (fusion de géométries non
        indexées avec position / normale / couleur de sommet / uv / matière),
        coques lissées (fuselages) et voilures (ailes, dérives).
     2. Textures procédurales (atlas d'ombres de contact, anneau, chenille).
     3. Matériaux partagés : rugosité et métal PAR SOMMET (attribut aMatiere),
        un seul matériau par famille ; reflets pris sur R3D.scene.environment
        quand la scène en fournit un (sinon carte d'environnement de repli).
     4. Modèles : fantassins (dont réparateurs mécano / infirmier), véhicules /
        drone (dont DCA Rempart, dépanneuses atelier / dépanneuse), camion du
        convoi, avions (F-15, F-35, Rafale, en livrée Halden ou Karsk),
        hélicoptères (frelon, busard, taon, vautour) et envahisseurs (dard,
        rôdeur), construits une seule fois puis partagés.
        Réparateurs : u.cibleSoin (entité soignée) et u.repareT (instant du
        dernier soin, horloge « temps ») pilotent l'arc de soudure ou la lueur.
     5. Instanciation d'une unité (graphe de scène, boîte de pointage).
     6. Animation par image (marche, roulement, tourelle, recul, drone, vol
        des avions, marche procédurale du rôdeur...).
     7. Morts et épaves (dont la chute des aéronefs abattus).
     8. Ombres de contact, anneaux de sélection, traînées (3 objets globaux).
     9. Interface R3D.Unites.

   Repère des modèles : face à +X, hauteur +Y, droite du modèle = +Z.

   Contrat avec le moteur (jeu.js) pour l'aviation :
     u.alt   altitude courante (0 au sol ; absente : HAUTEUR_VOL) ;
     u.auSol vrai quand l'avion est stationné ou se réarme (moteurs coupés) ;
     u.vit   vitesse courante en px/s (absente : déduite du déplacement) ;
     u.angle cap ; u.tirT instant du dernier tir.
   Les entités dont def.rendu === 'aliens' (vaisseau-mère) sont ignorées :
   elles sont rendues par r3d-aliens.js.
   ===================================================================== */
(function(){
  const R3D = window.R3D = window.R3D || {};

  // =================================================================
  // 1. OUTILS
  // =================================================================
  const cacheCouleurs = {};
  // Couleur hexadécimale (sRGB) -> couleur linéaire (le renderer sort en sRGB).
  function couleur(hex){
    return cacheCouleurs[hex] || (cacheCouleurs[hex] = new THREE.Color(hex).convertSRGBToLinear());
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
  const AXE_X = new THREE.Vector3(1, 0, 0);
  function matrice(x, y, z, rx, ry, rz, sx, sy, sz){
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
    _p.set(x, y, z); _s.set(sx, sy, sz);
    return _m.compose(_p, _q, _s);
  }
  const rien = function(){};
  function bornes(v, a, b){ return v < a ? a : v > b ? b : v; }
  function ecartAngle(a, b){ let d = (b - a) % (Math.PI*2); if(d > Math.PI) d -= Math.PI*2; if(d < -Math.PI) d += Math.PI*2; return d; }

  // Prototypes de géométries (unitaires, mises à l'échelle par matrice).
  const BOITE = new THREE.BoxGeometry(1, 1, 1);
  const cylindres = {};
  function geoCyl(seg, rHaut){ const k = seg + ':' + rHaut; return cylindres[k] || (cylindres[k] = new THREE.CylinderGeometry(rHaut, 1, 1, seg)); }
  const SPHERE0 = new THREE.IcosahedronGeometry(1, 0), SPHERE1 = new THREE.IcosahedronGeometry(1, 1);
  const SPHERE_LISSE = new THREE.SphereGeometry(1, 10, 7);

  // Boîte « à biseau » : face supérieure réduite et/ou décalée (blindages inclinés).
  // o = {hl, hp : facteurs longueur / profondeur du haut ; dx : décalage du haut (fraction de l) ; bl, bp : idem bas}
  function geoBiseau(o){
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), a = g.attributes.position;
    const hl = o.hl === undefined ? 1 : o.hl, hp = o.hp === undefined ? 1 : o.hp;
    const bl = o.bl === undefined ? 1 : o.bl, bp = o.bp === undefined ? 1 : o.bp, dx = o.dx || 0;
    for(let i = 0; i < a.count; i++){
      let x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      if(y > 0){ x = x*hl + dx; z *= hp; } else { x *= bl; z *= bp; }
      a.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }

  // Matière d'une teinte : [rugosité, métal]. Chaque sommet porte la matière de sa couleur
  // (table remplie après les palettes, section 4), ce qui permet à UN matériau par famille
  // de rendre à la fois une vitre brillante, un pneu mat et un blindage satiné.
  const MATIERES = {}, MATIERE_DEFAUT = [0.7, 0.1];
  function matieres(rugosite, metal, teintes){ for(const t of teintes) MATIERES[t] = [rugosite, metal]; }

  // Accumulateur de géométrie fusionnée.
  // Niveau de détail (novembre 2026) : chaque primitive ajoutée par g() note sa plage de sommets et
  // sa taille ; geo() en tire une seconde géométrie, geo.lod, sans les petites pièces et avec des
  // cylindres et sphères moins facettés (voir geoLod). Les coques, voilures et triangles bruts sont
  // gardés tels quels (silhouette).
  function Piece(){ this.p = []; this.n = []; this.c = []; this.u = []; this.m = []; this.mt = null; this.s = []; }
  // Impose une matière aux ajouts suivants (sans argument : retour à la table des teintes).
  Piece.prototype.matiere = function(rugosite, metal){ this.mt = rugosite === undefined ? null : [rugosite, metal]; return this; };
  Piece.prototype.g = function(geo, coul, m, chenille){
    if(!this.lodEnCours){
      // taille de la primitive : boîte du prototype × échelle de la matrice (dimensions triées)
      if(!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox, e = m ? m.elements : null;
      const k = j => e ? Math.hypot(e[j*4], e[j*4+1], e[j*4+2]) : 1;
      const d = [(bb.max.x - bb.min.x)*k(0), (bb.max.y - bb.min.y)*k(1), (bb.max.z - bb.min.z)*k(2)].sort((a, b) => b - a);
      let rempl = null;
      const P0 = geo.parameters;
      if(geo.type === 'CylinderGeometry' && P0 && P0.radiusBottom === 1 && P0.height === 1 && P0.radialSegments > (lodFort ? 4 : 6))
        rempl = geoCyl(Math.max(lodFort ? 4 : 6, Math.round(P0.radialSegments/2)), P0.radiusTop);
      else if(geo === SPHERE1 || geo === SPHERE_LISSE) rempl = SPHERE0;
      this.s.push({debut:this.p.length/3, fin:0, d0:d[0], d1:d[1], rempl, coul, m:rempl && m ? m.clone() : null, chenille, mt:this.mt});
    }
    const seg = this.lodEnCours ? null : this.s[this.s.length - 1];
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if(m) g.applyMatrix4(m);
    const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv ? g.attributes.uv.array : null;
    const col = couleur(coul), n = P.length / 3, mt = this.mt || MATIERES[coul] || MATIERE_DEFAUT;
    for(let i = 0; i < P.length; i++){ this.p.push(P[i]); this.n.push(N[i]); }
    for(let k = 0; k < n; k++){
      this.c.push(col.r, col.g, col.b);
      this.m.push(mt[0], mt[1]);
      // uv : bande de chenille (v dans [0 ; 0,5], u répété) ou zone unie (v = 0,75)
      if(chenille && U) this.u.push(U[2*k]*chenille, U[2*k+1]*0.5); else this.u.push(0.5, 0.78);
    }
    g.dispose();
    if(seg) seg.fin = this.p.length/3;
    return this;
  };
  // Triangle brut (sommets [x, y, z]) à facette plane ; « vers » : direction approximative de la
  // normale voulue (l'ordre des sommets est inversé au besoin).
  Piece.prototype.tri = function(a, b, c, coul, vers){
    let nx = (b[1]-a[1])*(c[2]-a[2]) - (b[2]-a[2])*(c[1]-a[1]);
    let ny = (b[2]-a[2])*(c[0]-a[0]) - (b[0]-a[0])*(c[2]-a[2]);
    let nz = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    const L = Math.hypot(nx, ny, nz);
    if(L < 1e-9) return this;
    nx /= L; ny /= L; nz /= L;
    if(vers && nx*vers[0] + ny*vers[1] + nz*vers[2] < 0){ const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
    const col = couleur(coul), mt = this.mt || MATIERES[coul] || MATIERE_DEFAUT;
    for(const s of [a, b, c]){
      this.p.push(s[0], s[1], s[2]); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b);
      this.u.push(0.5, 0.78); this.m.push(mt[0], mt[1]);
    }
    return this;
  };
  Piece.prototype.quad = function(a, b, c, d, coul, vers){ return this.tri(a, b, c, coul, vers).tri(a, c, d, coul, vers); };

  // Coque : anneaux successifs le long de X, reliés entre eux (fuselages, carapaces).
  //   S : sections {x, y, l, h, b, c, v} — centre (x, y), demi-largeur l, demi-hauteur au-dessus h
  //       et au-dessous b (défaut h), teinte du dessus c et du ventre v (défaut : celles de o) ;
  //   o : {profil (demi-profil [z, y] normalisé, du sommet au ventre), lisse (normales adoucies),
  //        dessus, ventre, seuil (ordonnée normalisée sous laquelle la teinte de ventre s'applique),
  //        bouchon (teinte des deux extrémités fermées ; absent : extrémités ouvertes)}.
  Piece.prototype.coque = function(S, o){
    // version simplifiée : un point de profil sur deux (extrémités gardées), mêmes sections
    if(!this.lodEnCours && o.profil.length >= 5){
      const pr = o.profil.filter((q, i) => i % 2 === 0 || i === o.profil.length - 1);
      const seg = {debut:this.p.length/3, fin:0, d0:Infinity, d1:Infinity, mt:this.mt, refaire:L => L.coque(S, Object.assign({}, o, {profil:pr}))};
      this.s.push(seg);
      this.lodEnCours = true;
      try { this.coque(S, o); } finally { this.lodEnCours = false; }
      seg.fin = this.p.length/3;
      return this;
    }
    const prof = o.profil, k = prof.length, nA = 2*k - 2, pos = [], cols = [], nor = [];
    const seuil = o.seuil === undefined ? -0.3 : o.seuil;
    for(const s of S){
      const bas = s.b === undefined ? s.h : s.b;
      for(let j = 0; j < nA; j++){
        const q = j < k ? prof[j] : prof[nA - j], sg = j < k ? 1 : -1;
        pos.push(s.x, s.y + (q[1] >= 0 ? q[1]*s.h : q[1]*bas), sg*q[0]*s.l);
        cols.push(q[1] < seuil ? (s.v || o.ventre || s.c || o.dessus) : (s.c || o.dessus));
        nor.push(0, 0, 0);
      }
    }
    // Sens des triangles : la normale doit s'éloigner de l'axe (dépend du sens de parcours en X).
    const inverse = S[S.length - 1].x < S[0].x, tris = [];
    for(let i = 0; i < S.length - 1; i++) for(let j = 0; j < nA; j++){
      const a = i*nA + j, b = i*nA + (j + 1)%nA, c = (i + 1)*nA + (j + 1)%nA, d = (i + 1)*nA + j;
      if(inverse) tris.push(a, c, b, a, d, c); else tris.push(a, b, c, a, c, d);
    }
    const fn = new Float32Array(tris.length);     // normale (non normée : pondérée par l'aire) de chaque triangle
    for(let t = 0; t < tris.length; t += 3){
      const a = tris[t]*3, b = tris[t+1]*3, c = tris[t+2]*3;
      const ux = pos[b] - pos[a], uy = pos[b+1] - pos[a+1], uz = pos[b+2] - pos[a+2];
      const vx = pos[c] - pos[a], vy = pos[c+1] - pos[a+1], vz = pos[c+2] - pos[a+2];
      const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      fn[t] = nx; fn[t+1] = ny; fn[t+2] = nz;
      for(const s of [a, b, c]){ nor[s] += nx; nor[s+1] += ny; nor[s+2] += nz; }
    }
    for(let t = 0; t < tris.length; t += 3){
      const L = Math.hypot(fn[t], fn[t+1], fn[t+2]);
      if(L < 1e-7) continue;                       // triangle dégénéré (pointe du nez)
      for(let q = 0; q < 3; q++){
        const iv = tris[t + q], s = iv*3;
        let nx = fn[t]/L, ny = fn[t+1]/L, nz = fn[t+2]/L;
        if(o.lisse){ const l = Math.hypot(nor[s], nor[s+1], nor[s+2]) || 1; nx = nor[s]/l; ny = nor[s+1]/l; nz = nor[s+2]/l; }
        const col = couleur(cols[iv]), mt = this.mt || MATIERES[cols[iv]] || MATIERE_DEFAUT;
        this.p.push(pos[s], pos[s+1], pos[s+2]); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b);
        this.u.push(0.5, 0.78); this.m.push(mt[0], mt[1]);
      }
    }
    if(o.bouchon){
      for(const i of [0, S.length - 1]){
        const s = S[i], autre = S[i === 0 ? 1 : S.length - 2], dir = [s.x >= autre.x ? 1 : -1, 0, 0];
        const centre = [s.x, s.y + (s.h - (s.b === undefined ? s.h : s.b))/2, 0];
        for(let j = 0; j < nA; j++){
          const a = (i*nA + j)*3, b = (i*nA + (j + 1)%nA)*3;
          this.tri(centre, [pos[a], pos[a+1], pos[a+2]], [pos[b], pos[b+1], pos[b+2]], o.bouchon, dir);
        }
      }
    }
    return this;
  };
  // Voilure mince (aile, dérive, plan canard) tendue entre la corde d'emplanture A (bord d'attaque)
  // -> B (bord de fuite) et la corde de saumon C -> D. Profil en losange (épaisseur maximale à 35 %
  // de la corde), épaisseurs eE (emplanture) et eS (saumon) mesurées le long de la normale N.
  //   bandes : [[t0, t1, teinte du dessus], ...] le long de l'envergure (0 = emplanture, 1 = saumon) ;
  //   dessous : teinte de la face opposée à N (défaut : celle de la bande).
  Piece.prototype.voilure = function(A, B, C, D, eE, eS, N, bandes, dessous){
    const entre = (p, q, t) => [p[0] + (q[0]-p[0])*t, p[1] + (q[1]-p[1])*t, p[2] + (q[2]-p[2])*t];
    const decale = (p, e) => [p[0] + N[0]*e, p[1] + N[1]*e, p[2] + N[2]*e];
    const nN = [-N[0], -N[1], -N[2]], bout = [C[0]-A[0], C[1]-A[1], C[2]-A[2]];
    for(const [t0, t1, teinte] of bandes){
      const a0 = entre(A, C, t0), b0 = entre(B, D, t0), a1 = entre(A, C, t1), b1 = entre(B, D, t1);
      const e0 = (eE + (eS - eE)*t0)/2, e1 = (eE + (eS - eE)*t1)/2;
      const m0 = entre(a0, b0, 0.35), m1 = entre(a1, b1, 0.35);
      const h0 = decale(m0, e0), h1 = decale(m1, e1), g0 = decale(m0, -e0), g1 = decale(m1, -e1);
      const cd = dessous || teinte;
      this.quad(a0, h0, h1, a1, teinte, N).quad(h0, b0, b1, h1, teinte, N);
      this.quad(a0, g0, g1, a1, cd, nN).quad(g0, b0, b1, g1, cd, nN);
      if(t1 >= 1) this.tri(a1, h1, g1, teinte, bout).tri(h1, b1, g1, teinte, bout);
    }
    return this;
  };
  // Demi-profil en super-ellipse : n + 1 points [z, y] du sommet (0, 1) au ventre (0, -1).
  // e = 2 : ellipse ; e > 2 : section plus carrée ; e = 1 : losange.
  function profilEllipse(n, e){
    const P = [], k = 2/e;
    for(let i = 0; i <= n; i++){
      const a = i/n*Math.PI, s = Math.sin(a), c = Math.cos(a);
      P.push([i === 0 || i === n ? 0 : Math.pow(Math.abs(s), k), (c < 0 ? -1 : 1)*Math.pow(Math.abs(c), k)]);
    }
    return P;
  }
  // Boîte centrée en (x,y,z), dimensions l (X) × h (Y) × p (Z).
  Piece.prototype.b = function(x, y, z, l, h, p, coul, rx, ry, rz){ return this.g(BOITE, coul, matrice(x, y, z, rx, ry, rz, l, h, p)); };
  Piece.prototype.bz = function(x, y, z, l, h, p, coul, o, rx, ry, rz){ return this.g(geoBiseau(o), coul, matrice(x, y, z, rx, ry, rz, l, h, p)); };
  // Cylindre de rayon r, longueur h, selon l'axe 'x' | 'y' | 'z' (le bout « haut » vers +axe).
  Piece.prototype.cy = function(x, y, z, r, h, coul, axe, seg, kHaut, chenille){
    const rx = axe === 'z' ? Math.PI/2 : 0, rz = axe === 'x' ? -Math.PI/2 : 0;
    return this.g(geoCyl(seg || 10, kHaut === undefined ? 1 : kHaut), coul, matrice(x, y, z, rx, 0, rz, r, h, r), chenille);
  };
  Piece.prototype.sp = function(x, y, z, sx, sy, sz, coul, lisse){ return this.g(lisse === 2 ? SPHERE_LISSE : lisse ? SPHERE1 : SPHERE0, coul, matrice(x, y, z, 0, 0, 0, sx, sy, sz)); };
  // Barre (boîte) entre deux points, section e × e2.
  Piece.prototype.seg = function(x1, y1, z1, x2, y2, z2, e, coul, e2){
    _v.set(x2 - x1, y2 - y1, z2 - z1); const L = _v.length(); _v.normalize();
    _q.setFromUnitVectors(AXE_X, _v);
    _p.set((x1 + x2)/2, (y1 + y2)/2, (z1 + z2)/2); _s.set(L, e, e2 || e);
    return this.g(BOITE, coul, _m.compose(_p, _q, _s));
  };
  Piece.prototype.geo = function(){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('aMatiere', new THREE.Float32BufferAttribute(this.m, 2));
    g.setAttribute('aAccent', new THREE.BufferAttribute(new Float32Array(this.p.length/3), 1));   // voir marquer
    g.computeBoundingSphere(); g.computeBoundingBox();
    if(!this.lodEnCours) g.lod = this.geoLod(g.boundingBox);
    return g;
  };
  // Géométrie simplifiée (vue éloignée et passe d'ombres). On retire les primitives petites devant
  // la pièce (plus grande dimension < 10 % de la pièce, ou deuxième dimension < 3,5 %) ; cylindres et
  // sphères passent à moins de facettes ; les coques (fuselages) gardent un point de profil sur deux. Renvoie null si le gain est trop faible (la pièce sert alors telle quelle).
  // Fantassins (lodFort, posé par modele) : seuils plus forts, car un soldat ne fait que 7 à 10 pixels
  // de haut en vue éloignée.
  const LOD_PETIT = 0.1, LOD_MINCE = 0.035, LOD_PETIT_F = 0.16, LOD_MINCE_F = 0.07;
  let lodFort = false;
  Piece.prototype.geoLod = function(bb){
    const S = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    const kP = lodFort ? LOD_PETIT_F : LOD_PETIT, kM = lodFort ? LOD_MINCE_F : LOD_MINCE;
    const L = new Piece(); L.lodEnCours = true;
    const src = this, copier = (a, b) => {
      for(let i = a*3; i < b*3; i++){ L.p.push(src.p[i]); L.n.push(src.n[i]); L.c.push(src.c[i]); }
      for(let i = a*2; i < b*2; i++){ L.u.push(src.u[i]); L.m.push(src.m[i]); }
    };
    let cur = 0;
    for(const s of this.s){
      if(s.debut > cur) copier(cur, s.debut);
      cur = s.fin;
      if(s.d0 < S*kP || s.d1 < S*kM) continue;
      if(s.refaire){ L.mt = s.mt; s.refaire(L); }
      else if(s.rempl){ L.mt = s.mt; L.g(s.rempl, s.coul, s.m, s.chenille); }
      else copier(s.debut, s.fin);
    }
    const n = this.p.length/3;
    if(n > cur) copier(cur, n);
    this.s = [];
    if(L.p.length > this.p.length*0.85 || !L.p.length) return null;
    return L.geo();
  };
  Piece.prototype.vide = function(){ return this.p.length === 0; };

  // Occlusion ambiante « cuite » dans les couleurs de sommets (aucun coût au rendu) :
  // dégradé vertical (bas sombre -> haut clair, en repère modèle : y + dy) et
  // correction selon l'orientation (dessous assombris, dessus légèrement éclaircis).
  // Donne du volume et ancre les modèles au sol, surtout vus de haut.
  function ombrer(geo, dy, bas, haut, min, kDessus){
    if(geo && geo.lod) ombrer(geo.lod, dy, bas, haut, min, kDessus);
    if(!geo || geo.userData.ombre) return;
    geo.userData.ombre = true;
    const P = geo.attributes.position.array, N = geo.attributes.normal.array, C = geo.attributes.color.array;
    const dessus = kDessus === undefined ? 1.12 : kDessus;
    for(let i = 0; i < P.length; i += 3){
      let t = (P[i+1] + dy - bas) / (haut - bas); t = t < 0 ? 0 : t > 1 ? 1 : t;
      t = t*t*(3 - 2*t);
      let k = min + (1 - min)*t;
      const ny = N[i+1];
      if(ny < -0.3) k *= 0.6; else if(ny > 0.6) k *= dessus;
      C[i] *= k; C[i+1] *= k; C[i+2] *= k;
    }
    geo.attributes.color.needsUpdate = true;
  }

  // =================================================================
  // 2. TEXTURES PROCÉDURALES
  // =================================================================
  function toile(l, h, dessin){ const c = document.createElement('canvas'); c.width = l; c.height = h; dessin(c.getContext('2d'), l, h); return c; }

  // Ombres de contact : atlas de 4 silhouettes floues (cases de 64 px, lues par leur alpha).
  //   0 disque (fantassins, drone, rôdeur) · 1 rectangle arrondi (véhicules)
  //   2 avion à aile en flèche (F-15, F-35) · 3 aile delta (Rafale, dard)
  // Chaque silhouette occupe OMBRE_UTILE de sa case (le reste sert au flou) ; nez vers +u.
  const OMBRE_UTILE = 0.72, OMBRE_CASES = 4;
  const OMBRE = {disque:0, rectangle:1, avion:2, delta:3};
  const texOmbre = new THREE.CanvasTexture(toile(64*OMBRE_CASES, 64, (g) => {
    const C = 64, m = C*(1 - OMBRE_UTILE)/2, t = C*OMBRE_UTILE;
    // case 0 : dégradé radial (cœur dense, pénombre large)
    const d = g.createRadialGradient(C/2, C/2, 0, C/2, C/2, C/2);
    d.addColorStop(0, 'rgba(0,0,0,0.9)'); d.addColorStop(0.4, 'rgba(0,0,0,0.6)');
    d.addColorStop(0.75, 'rgba(0,0,0,0.16)'); d.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = d; g.fillRect(0, 0, C, C);
    // cases 1 à 3 : silhouette pleine dessinée hors champ, seule son ombre portée floue tombe dans la case
    const HORS = 1000;
    function flou(k, rayon, tracer){
      g.save();
      g.beginPath(); g.rect(k*C, 0, C, C); g.clip();
      g.shadowColor = 'rgba(0,0,0,1)'; g.shadowBlur = rayon; g.shadowOffsetX = HORS; g.shadowOffsetY = 0;
      g.fillStyle = '#000'; g.translate(k*C - HORS, 0);
      g.beginPath(); tracer(); g.fill();
      g.restore();
    }
    const poly = pts => { pts.forEach(([u, v], i) => { const x = m + u*t, y = m + v*t; if(i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); };
    // le v de la texture est inversé à l'écran (flipY) : silhouettes symétriques, sans importance
    for(const rayon of [7, 3]) flou(1, rayon, () => {           // deux passes : pénombre large + cœur net
      const r = 9, x = m, y = m, w = t, h = t;
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    });
    for(const rayon of [6, 2.5]) flou(2, rayon, () => poly([[1, 0.5], [0.8, 0.43], [0.62, 0.4], [0.32, 0.02], [0.22, 0.02], [0.3, 0.38],
      [0.12, 0.36], [0.02, 0.2], [0, 0.2], [0.03, 0.5], [0, 0.8], [0.02, 0.8], [0.12, 0.64], [0.3, 0.62], [0.22, 0.98], [0.32, 0.98],
      [0.62, 0.6], [0.8, 0.57]]));
    for(const rayon of [6, 2.5]) flou(3, rayon, () => poly([[1, 0.5], [0.72, 0.42], [0.62, 0.28], [0.56, 0.4], [0.16, 0.02], [0.08, 0.02],
      [0.1, 0.4], [0, 0.44], [0, 0.56], [0.1, 0.6], [0.08, 0.98], [0.16, 0.98], [0.56, 0.6], [0.62, 0.72], [0.72, 0.58]]));
  }));

  // Anneau de sélection : cercle net + halo + 4 encoches (la rotation se voit).
  const texAnneau = new THREE.CanvasTexture(toile(128, 128, (g, l) => {
    const c = l/2;
    const halo = g.createRadialGradient(c, c, c*0.62, c, c, c*0.98);
    halo.addColorStop(0, 'rgba(255,255,255,0)'); halo.addColorStop(0.55, 'rgba(255,255,255,0.35)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = halo; g.fillRect(0, 0, l, l);
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 5;
    for(let i = 0; i < 4; i++){ g.beginPath(); g.arc(c, c, c*0.8, i*Math.PI/2 + 0.16, (i+1)*Math.PI/2 - 0.16); g.stroke(); }
    g.lineWidth = 2; g.beginPath(); g.arc(c, c, c*0.68, 0, Math.PI*2); g.globalAlpha = 0.5; g.stroke();
  }));
  texAnneau.encoding = THREE.sRGBEncoding;

  // Chenille : moitié haute = patins (répétés en u), moitié basse = teinte unie.
  const toileChenille = toile(32, 32, (g) => {
    g.fillStyle = '#9a978f'; g.fillRect(0, 16, 32, 16);           // zone unie (v > 0,5)
    g.fillStyle = '#4a4844'; g.fillRect(0, 0, 32, 16);            // fond des patins
    g.fillStyle = '#a6a39b'; g.fillRect(2, 0, 16, 16);            // patin
    g.fillStyle = '#d0cdc4'; g.fillRect(2, 0, 3, 16);             // arête claire
    g.fillStyle = '#2a2826'; g.fillRect(20, 0, 3, 16);            // creux
  });
  const PHASES_CHENILLE = 16, texChenilles = [];
  for(let i = 0; i < 1; i++){     // une seule texture : la phase est un décalage par instance (matChenille)
    const t = new THREE.CanvasTexture(toileChenille);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.encoding = THREE.sRGBEncoding; t.offset.x = i / PHASES_CHENILLE; t.anisotropy = 4;
    texChenilles.push(t);
  }
  const PAS_CHENILLE = 3.2;   // longueur d'un patin (unités de jeu)

  // =================================================================
  // 3. MATÉRIAUX PARTAGÉS (créés une fois)
  // =================================================================
  // Matériaux physiques. La rugosité et le métal viennent des sommets (attribut aMatiere,
  // voir MATIERES) : ceux du matériau servent de multiplicateurs par famille.
  //   Halden : acier satiné, reflets nets ; Karsk : peinture mate ; fantassins : tissu.
  // Sans carte d'environnement, un métal ne fait qu'assombrir la teinte : les reflets sont pris
  // sur R3D.scene.environment quand la scène en fournit un, sinon sur une petite carte de repli
  // (ciel / horizon / sable, voir creerEnvironnement).
  function parSommet(mat, iris){
    mat.onBeforeCompile = function(sh){
      teinteCampShader(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aMatiere;\nvarying vec2 vMatiere;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMatiere = aMatiere;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMatiere;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vMatiere.x;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vMatiere.y;');
      // Irisation (envahisseurs) : la teinte du métal glisse du sarcelle au violet puis au bronze
      // selon l'angle de vue, avec une très légère lueur propre qui survit sous un ciel sombre.
      if(iris) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float irisF = 1.0 - abs(dot(normal, normalize(vViewPosition)));
        vec3 irisC = 0.5 + 0.5*cos(6.2832*(irisF*1.25 + vec3(0.52, 0.30, 0.12)));
        float irisK = vMatiere.y * (0.25 + 0.6*irisF);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*0.35 + irisC*0.5, irisK);
        totalEmissiveRadiance += irisC * irisF*irisF * vMatiere.y * 0.06;`);
    };
    // (la clé de cache du programme tient compte du texte de onBeforeCompile : les deux variantes sont distinctes)
    mat.customProgramCacheKey = function(){ return iris ? 'matiere-iris-camp' : 'matiere-camp'; };
    return mat;
  }
  const matCorps = parSommet(new THREE.MeshStandardMaterial({vertexColors:true, roughness:1, metalness:1, envMapIntensity:1.0}));
  const matCorpsK = parSommet(new THREE.MeshStandardMaterial({vertexColors:true, roughness:1, metalness:1, envMapIntensity:0.75}));
  const TYPES_KARSK = {sapeur:1, conscrit:1, grenadier:1, guetteur:1, ours:1, grele:1, sentinelle:1,
    infirmier:1, depanneuse:1, taon:1, vautour:1};
  const matFantassin = parSommet(new THREE.MeshStandardMaterial({vertexColors:true, roughness:1, metalness:0.35, envMapIntensity:0.6}));
  // Envahisseurs : métal sombre irisé (voir parSommet).
  const matAlien = parSommet(new THREE.MeshStandardMaterial({vertexColors:true, roughness:1, metalness:1, envMapIntensity:1.25}), true);
  // Éléments lumineux (phares, voyants, visières) : teinte poussée au-delà de 1 pour ressortir
  // avec le halo du post-traitement (sans lui, la teinte est simplement saturée).
  const matLum = new THREE.MeshBasicMaterial({vertexColors:true, toneMapped:false, color:new THREE.Color(1.35, 1.35, 1.35)});
  // Flammes de tuyère, éclairs de tir, lueurs des envahisseurs : additif, sans écriture de profondeur.
  const matFeu = new THREE.MeshBasicMaterial({vertexColors:true, toneMapped:false, transparent:true, depthWrite:false,
    blending:THREE.AdditiveBlending, side:THREE.DoubleSide, fog:false, color:new THREE.Color(1.25, 1.25, 1.25)});
  const matEpave = new THREE.MeshStandardMaterial({vertexColors:true, color:couleur('#5c4e42'), roughness:0.95, metalness:0.1});   // calciné mais lisible (pas un « trou » noir)
  // Teinte de camp par instance (voir marquer) : feux et épaves aussi.
  matLum.onBeforeCompile = sh => teinteCampShader(sh); matLum.customProgramCacheKey = () => 'lum-camp';
  matEpave.onBeforeCompile = sh => teinteCampShader(sh); matEpave.customProgramCacheKey = () => 'epave-camp';
  const MATS_CAMP = new Set([matCorps, matCorpsK, matFantassin, matLum, matEpave]);   // lots munis d'un indice de camp
  // Chenilles : une seule matière ; le défilement des patins est un décalage de texture PAR INSTANCE
  // (attribut aDecal, voir agrandir). Avant novembre 2026 : 16 matières (une par phase), donc
  // jusqu'à 16 lots et appels de dessin par type de char.
  const matChenille = new THREE.MeshStandardMaterial({vertexColors:true, map:texChenilles[0], roughness:0.9, metalness:0.25});
  matChenille.onBeforeCompile = function(sh){
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDecal;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_UV\nvUv.x += aDecal;\n#endif');
  };
  matChenille.customProgramCacheKey = function(){ return 'chenille-decal'; };
  const matsChenille = [matChenille];
  const matFlou = new THREE.MeshBasicMaterial({color:couleur('#2a3138'), transparent:true, opacity:0.28, depthWrite:false});
  const matPointage = new THREE.MeshBasicMaterial({visible:false});   // non dessiné, mais touché par le raycaster
  const LUMINEUX = new Set([matLum, matFeu, matFlou]);                 // pièces éteintes à la mort, sans ombre reçue
  // Ombres de contact : une case de l'atlas et une opacité PAR INSTANCE (attribut aDon), fondu dans la brume.
  const BRUME_DECL = `
    #ifdef USE_FOG
      varying float vProf;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear; uniform float fogFar;
      #endif
    #endif
    float brume(){
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
  const matOmbre = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {uAtlas:{value:null}}]),
    vertexShader: `
      attribute vec2 aDon;               // case de l'atlas, opacité
      varying vec2 vUv; varying float vA;
      #ifdef USE_FOG
        varying float vProf;
      #endif
      void main(){
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vUv = vec2((aDon.x + 0.015 + uv.x*0.97) / ${OMBRE_CASES}.0, uv.y);
        vA = aDon.y;
        #ifdef USE_FOG
          vProf = -mv.z;
        #endif
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas;
      varying vec2 vUv; varying float vA;
      ${BRUME_DECL}
      void main(){
        float a = texture2D(uAtlas, vUv).a * vA * (1.0 - brume());
        if(a < 0.004) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      }`,
    transparent:true, depthWrite:false, fog:true, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2});
  matOmbre.uniforms.uAtlas.value = texOmbre;
  const matAnneau = new THREE.MeshBasicMaterial({map:texAnneau, transparent:true, depthWrite:false, toneMapped:false,
    polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4});
  // Traînées (saumons d'aile, sillage des dards) : rubans à couleur prémultipliée, ce qui permet
  // de mêler dans UN SEUL objet des rubans « fumée » (aAdd = 0) et des rubans lumineux (aAdd = 1).
  const matTrainee = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: `
      attribute vec4 aCoul; attribute float aAdd;
      varying vec4 vCoul; varying float vAdd;
      #ifdef USE_FOG
        varying float vProf;
      #endif
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vCoul = aCoul; vAdd = aAdd;
        #ifdef USE_FOG
          vProf = -mv.z;
        #endif
      }`,
    fragmentShader: `
      varying vec4 vCoul; varying float vAdd;
      ${BRUME_DECL}
      void main(){
        float a = vCoul.a * (1.0 - brume());
        vec4 c = linearToOutputTexel(vec4(vCoul.rgb, 1.0));
        gl_FragColor = vec4(c.rgb * a, a * (1.0 - vAdd));
      }`,
    transparent:true, depthWrite:false, fog:true, side:THREE.DoubleSide,
    blending:THREE.CustomBlending, blendEquation:THREE.AddEquation, blendSrc:THREE.OneFactor, blendDst:THREE.OneMinusSrcAlphaFactor});

  // Carte d'environnement de repli, propre aux unités : dégradé équirectangulaire
  // ciel -> horizon chaud -> sable, préfiltré par PMREM (r128). Elle n'est créée et employée
  // que si la scène ne fournit pas R3D.scene.environment.
  const MATS_REFLETS = [matCorps, matCorpsK, matFantassin, matAlien, matEpave].concat(matsChenille);
  let envRepli = null, envCourant;
  matEpave.envMapIntensity = 0.35;
  for(const m of matsChenille) m.envMapIntensity = 0.45;
  function creerEnvironnement(renderer){
    if(!renderer || !THREE.PMREMGenerator) return null;
    try {
      const tex = new THREE.CanvasTexture(toile(256, 128, (g, l, h) => {
        const d = g.createLinearGradient(0, 0, 0, h);
        d.addColorStop(0, '#6f9fcf'); d.addColorStop(0.38, '#b9d2e6'); d.addColorStop(0.49, '#f4e2c4');
        d.addColorStop(0.53, '#c9a878'); d.addColorStop(1, '#7a6040');
        g.fillStyle = d; g.fillRect(0, 0, l, h);
        // soleil diffus (côté ouest / haut) pour un reflet chaud sur les surfaces supérieures
        const s = g.createRadialGradient(l*0.3, h*0.22, 0, l*0.3, h*0.22, h*0.3);
        s.addColorStop(0, 'rgba(255,240,210,0.95)'); s.addColorStop(1, 'rgba(255,240,210,0)');
        g.fillStyle = s; g.fillRect(0, 0, l, h);
      }));
      tex.encoding = THREE.sRGBEncoding;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      const rt = pm.fromEquirectangular(tex);
      pm.dispose(); tex.dispose();
      return rt.texture;
    } catch(err){ return null; /* sans carte d'environnement : rendu correct, simplement plus mat */ }
  }
  // À chaque image (comparaison d'une référence) : l'environnement de la scène prime dès qu'il existe.
  function majEnvironnement(){
    const scene = R3D.scene;
    if(!scene) return;
    let voulu = null;                                  // null : le matériau prend scene.environment
    if(!scene.environment){
      if(envRepli === null) envRepli = creerEnvironnement(R3D.renderer) || false;
      voulu = envRepli || null;
    }
    if(voulu === envCourant) return;
    envCourant = voulu;
    for(const m of MATS_REFLETS){ m.envMap = voulu; m.needsUpdate = true; }
  }

  // =================================================================
  // 4. MODÈLES
  // =================================================================
  // Palettes (sRGB, converties à l'usage)
  const H = {acier:'#56636e', acierF:'#3c4751', acierC:'#7d8b97', clair:'#a9b5be', noir:'#1b2025', bleu:'#3fa7ff',
    bleuF:'#1c4f80', lum:'#7fd6ff', vitre:'#1a2a38', pneu:'#1c1e20', tenue:'#38434d', gilet:'#56636e', peau:'#c79a78',
    combi:'#c9d1d7', casqueBlanc:'#e9edf0'};
  // Karsk : olive plus froide et plus claire que l'ancienne (#66653f), qui se fondait dans le
  // sable au zoom par défaut ; le rouge (#e2533f) couvre désormais les surfaces vues d'en haut
  // (toits de tourelle, caisson, casques) pour que le camp se lise d'un coup d'œil.
  const K = {olive:'#5a6a4a', oliveF:'#3f4b35', oliveC:'#72805e', kaki:'#7c8462', rouge:'#e2533f', rougeF:'#8e2c1e',
    acier:'#383b36', bois:'#6e4c2c', toile:'#6c735a', sac:'#9a9a7a', pneu:'#211f1b', vitre:'#1f2a2c', noir:'#22211c',
    peau:'#b98a68', tenue:'#55643f', panta:'#465237'};
  // Envahisseurs (« Les Veilleurs ») : carapace sombre irisée, os pâle, lueurs sarcelle.
  const X = {fonce:'#1b2a33', nuit:'#141a26', violet:'#2c2247', bronze:'#4b3c2c', os:'#66747a', osF:'#39454c',
    lum:'#7df9d0', lumC:'#d9fff4', coeur:'#3fe0b4'};
  // Feux communs
  const FEU = {phare:'#ffe2a8', arriere:'#ff5a3c', ambre:'#ffb340', vert:'#5dff8a', rouge:'#ff4a3a', blanc:'#ffffff'};

  // Matières des teintes : [rugosité, métal] (voir MATIERES). Les teintes absentes prennent MATIERE_DEFAUT.
  matieres(0.44, 0.5,  [H.acier, H.acierF, H.acierC, H.clair]);          // acier satiné Halden (H.gilet = même teinte)
  matieres(0.5,  0.65, [H.noir, K.noir, K.acier, '#3d3f40', '#3a3830']);  // métal nu sombre : tubes, armes, chenilles
  matieres(0.32, 0.3,  [H.bleu, H.bleuF]);                               // laque bleue
  matieres(0.07, 0.92, [H.vitre, K.vitre]);                              // vitrages : miroir du ciel
  matieres(0.92, 0.0,  [H.pneu, K.pneu, K.bois, K.toile, K.sac, H.tenue, K.tenue, K.panta]);   // caoutchouc, bois, toile
  matieres(0.65, 0.0,  [H.peau, K.peau]);
  matieres(0.55, 0.05, [H.combi, H.casqueBlanc]);
  matieres(0.78, 0.08, [K.olive, K.oliveF, K.oliveC, K.kaki]);            // peinture mate Karsk
  matieres(0.48, 0.14, [K.rouge, K.rougeF]);                              // émail rouge
  matieres(0.38, 0.12, ['#e8eef2', '#ffffff', '#2f7fc1']);               // camions de la Régie : peinture propre
  matieres(0.24, 0.92, [X.fonce, X.nuit, X.violet, X.bronze]);            // carapace des envahisseurs
  matieres(0.5,  0.55, [X.os, X.osF]);

  // ---------- 4.a Fantassins ----------
  // Jambe (origine à la hanche, pend vers -Y). Hanche à y = 6,5.
  function geoJambe(panta, genou, botte){
    const P = new Piece();
    P.bz(0, -1.7, 0, 2.2, 3.5, 2.0, panta, {bl:0.85, bp:0.9});
    P.b(0.15, -4.4, 0, 1.8, 2.6, 1.75, panta);
    P.b(0.75, -3.2, 0, 0.6, 1.0, 1.5, genou);
    P.b(0.45, -6.05, 0, 2.7, 1.1, 1.9, botte);
    return P.geo();
  }
  const HANCHE = 6.5;

  // Tronc commun (bassin, torse, cou, tête). z = droite.
  function tronc(P, t){
    P.b(0, 7.1, 0, 2.2, 1.5, 3.7, t.panta);                                   // bassin
    P.bz(0, 9.3, 0, 2.5, 3.4, 4.0, t.tenue, {hp:1.08, bp:0.9});               // torse
    P.b(0, 11.2, 0, 1.2, 0.6, 1.2, t.peau);                                   // cou
    P.sp(0.15, 12.25, 0, 1.25, 1.35, 1.2, t.peau, 1);                         // tête
  }
  // Bras en deux segments : épaule -> coude -> main.
  function bras(P, e, c, m, coul, gant){
    P.seg(e[0], e[1], e[2], c[0], c[1], c[2], 1.15, coul);
    P.seg(c[0], c[1], c[2], m[0], m[1], m[2], 1.0, coul);
    P.sp(m[0], m[1], m[2], 0.6, 0.6, 0.6, gant);
  }

  // Opérateur Halden : gilet modulaire, casque à visière lumineuse, fusil long à lunette.
  function modeleOperateur(){
    const t = {panta:H.tenue, tenue:H.tenue, peau:H.peau};
    const jambe = geoJambe(H.tenue, H.acierF, H.noir);
    function torse(visee){
      const P = new Piece(); tronc(P, t);
      P.bz(0.25, 9.5, 0, 3.0, 3.2, 4.3, H.gilet, {hl:0.9, hp:0.95});         // gilet pare-balles
      for(const z of [-1.2, 0, 1.2]) P.b(1.85, 8.6, z, 0.7, 1.2, 1.0, H.acierF); // poches
      P.b(-1.75, 9.6, 0, 1.3, 3.0, 3.0, H.acierF);                             // sac d'assaut
      P.b(-1.8, 11.15, 0, 1.2, 0.35, 2.6, H.bleu);                             // bande bleue (dessus du sac)
      for(const s of [-1, 1]) P.bz(0, 11.0, s*2.35, 2.3, 0.9, 1.5, H.bleu, {hl:0.8, hp:0.8});   // épaulières (accent)
      P.sp(0, 12.75, 0, 1.6, 1.15, 1.55, H.acierF, 1);                         // casque
      P.b(-0.1, 13.75, 0, 1.4, 0.3, 1.0, H.bleu);                              // liseré bleu sur le casque
      P.b(1.3, 12.35, 0, 0.5, 0.75, 2.3, H.lum);                               // visière
      P.b(0.6, 12.9, 1.55, 1.2, 0.6, 0.5, H.noir);                             // capteur latéral
      if(visee){
        bras(P, [0.2, 10.9, 2.2], [1.0, 10.1, 2.2], [2.0, 10.6, 0.8], H.tenue, H.noir);
        bras(P, [0.2, 10.9, -2.2], [2.4, 10.3, -1.4], [4.0, 10.7, 0.5], H.tenue, H.noir);
        P.seg(-0.3, 10.9, 0.95, 8.4, 10.95, 0.75, 0.75, H.noir, 0.55);          // fusil épaulé
        P.b(2.6, 11.55, 0.9, 2.2, 0.6, 0.5, H.acier);                            // lunette
        P.b(1.8, 10.1, 0.9, 0.6, 1.4, 0.4, H.noir);                              // chargeur
        P.b(5.6, 10.95, 0.75, 1.4, 0.45, 0.45, H.bleu);                          // garde-main (accent)
      } else {
        bras(P, [0.2, 10.9, 2.2], [0.6, 9.0, 2.4], [1.8, 8.6, 1.0], H.tenue, H.noir);
        bras(P, [0.2, 10.9, -2.2], [1.3, 9.6, -2.0], [2.6, 9.9, 0.0], H.tenue, H.noir);
        P.seg(0.2, 8.0, 1.3, 7.4, 10.8, -0.6, 0.75, H.noir, 0.55);              // fusil en travers
        P.seg(2.3, 9.4, 0.8, 4.4, 10.2, 0.2, 0.55, H.acier);                     // lunette
        P.seg(4.8, 9.9, 0.0, 5.9, 10.4, -0.3, 0.5, H.bleu);
      }
      return P.geo();
    }
    // lueurs : visière et voyant du capteur latéral
    const lum = new Piece();
    lum.b(1.6, 12.35, 0, 0.1, 0.5, 2.0, H.lum);
    lum.b(1.25, 12.9, 1.82, 0.3, 0.3, 0.08, H.lum);
    return {genre:'fantassin', jambe, torse:{normal:torse(false), visee:torse(true)}, outil:null, lum:lum.geo()};
  }

  // Conscrit Karsk : casque rond, capote olive, gros paquetage, fusil à crosse bois.
  function modeleConscrit(){
    const t = {panta:K.panta, tenue:K.tenue, peau:K.peau};
    const jambe = geoJambe(K.panta, K.panta, K.noir);
    function torse(visee){
      const P = new Piece(); tronc(P, t);
      P.bz(0.1, 8.6, 0, 2.9, 2.2, 4.3, K.tenue, {bl:1.15, bp:1.1});          // pans de capote
      P.seg(0.4, 11.0, -1.9, 1.4, 7.8, 1.8, 0.5, K.oliveF);                   // brelage
      P.b(1.4, 8.0, -1.2, 0.8, 1.0, 1.2, K.oliveF); P.b(1.4, 8.0, 1.2, 0.8, 1.0, 1.2, K.oliveF);
      P.b(-2.0, 9.7, 0, 1.9, 3.4, 3.4, K.toile);                               // paquetage
      P.cy(-2.1, 11.85, 0, 0.85, 4.2, K.kaki, 'z', 8);                         // couverture roulée
      for(const s of [-1, 1]) P.b(0, 11.05, s*2.25, 2.0, 0.6, 1.3, K.rouge);  // pattes d'épaule rouges
      P.sp(0.05, 12.85, 0, 1.75, 1.05, 1.75, K.rouge, 1);                      // casque rond rouge (lisible d'en haut)
      P.cy(0.05, 12.5, 0, 1.8, 0.45, K.rougeF, 'y', 14);                       // bord du casque
      if(visee){
        bras(P, [0.2, 10.9, 2.2], [0.9, 9.9, 2.3], [1.9, 10.5, 0.9], K.tenue, K.peau);
        bras(P, [0.2, 10.9, -2.2], [2.2, 10.1, -1.3], [3.6, 10.6, 0.5], K.tenue, K.peau);
        P.seg(-0.4, 10.6, 1.0, 2.6, 10.85, 0.8, 0.85, K.bois, 0.6);            // crosse bois
        P.seg(2.6, 10.85, 0.8, 7.2, 10.95, 0.6, 0.5, K.noir);                  // canon
        P.b(2.6, 10.1, 0.8, 0.6, 1.3, 0.4, K.noir);
      } else {
        bras(P, [0.2, 10.9, 2.2], [0.5, 9.0, 2.4], [1.6, 8.6, 1.1], K.tenue, K.peau);
        bras(P, [0.2, 10.9, -2.2], [1.2, 9.6, -2.0], [2.4, 9.9, -0.1], K.tenue, K.peau);
        P.seg(0.3, 8.1, 1.4, 3.3, 9.3, 0.5, 0.85, K.bois, 0.6);
        P.seg(3.3, 9.3, 0.5, 6.4, 10.6, -0.5, 0.5, K.noir);
      }
      return P.geo();
    }
    return {genre:'fantassin', jambe, torse:{normal:torse(false), visee:torse(true)}, outil:null};
  }

  // ---------- Infanterie spécialisée (rôles 'bazooka' et 'sniper') ----------
  // Cylindre d'axe X incliné de « incl » (nez vers le haut si incl > 0), centré en (x, y, z).
  function tubeIncline(P, x, y, z, r, L, coul, incl, seg, kHaut){
    return P.g(geoCyl(seg || 10, kHaut === undefined ? 1 : kHaut), coul, matrice(x, y, z, 0, 0, -Math.PI/2 + (incl || 0), r, L, r));
  }
  // Éclair de départ (bouche, x = xAv) et souffle arrière (x = xAr) d'un lance-roquettes épaulé.
  function geoSouffle(xAv, xAr, y, z, t){
    const P = new Piece();
    P.sp(xAv + 0.5, y, z, t*0.55, t*0.55, t*0.55, '#fff0c0', 1);
    P.b(xAv + t*0.9, y, z, t*1.8, 0.14, t*0.85, '#ff9c4a'); P.b(xAv + t*0.9, y, z, t*1.8, t*0.85, 0.14, '#ff9c4a');
    P.g(CONE_FLAMME, '#ffb35a', matrice(xAr - t*1.7, y, z, 0, 0, -Math.PI/2, t*1.2, t*3.4, t*1.2));   // souffle évasé vers l'arrière
    P.g(CONE_FLAMME, '#fff0c0', matrice(xAr - t*0.8, y, z, 0, 0, -Math.PI/2, t*0.5, t*1.6, t*0.5));
    return P.geo();
  }
  // Taches de camouflage (boîtes plates) sur le torse et les jambes d'un tireur d'élite.
  function taches(P, couls, n, graine){
    let s = graine;
    const rnd = () => { s = (s*16807) % 2147483647; return (s % 1000)/1000; };
    for(let i = 0; i < n; i++){
      const y = 7.6 + rnd()*3.6, z = (rnd() - 0.5)*3.6, cote = rnd() < 0.5 ? 1 : -1;
      P.b(cote*1.32, y, z, 0.12, 0.6 + rnd()*0.8, 0.7 + rnd()*1.0, couls[i % couls.length]);
    }
  }
  const ROLE_TUBE = 2.35;     // décalage latéral (z) du tube porté sur l'épaule droite

  // Javelot (Halden, rôle 'bazooka') : équipement de l'opérateur, lance-roquettes gris acier
  // à bague bleue sur l'épaule, étui dorsal à deux roquettes à coiffe bleue.
  function modeleJavelot(){
    const t = {panta:H.tenue, tenue:H.tenue, peau:H.peau}, z = ROLE_TUBE;
    const jambe = geoJambe(H.tenue, H.acierF, H.noir);
    function torse(visee){
      const P = new Piece(); tronc(P, t);
      P.bz(0.25, 9.5, 0, 3.0, 3.2, 4.3, H.gilet, {hl:0.9, hp:0.95});
      for(const zz of [-1.2, 0]) P.b(1.85, 8.6, zz, 0.7, 1.2, 1.0, H.acierF);
      // étui dorsal : deux roquettes dépassent, coiffes bleues
      P.b(-1.95, 9.7, 0, 1.7, 3.6, 3.4, H.acierF);
      for(const s of [-1, 1]){
        P.cy(-2.0, 12.0, s*0.85, 0.6, 1.6, H.acier, 'y', 8);
        P.cy(-2.0, 13.2, s*0.85, 0.6, 0.9, H.bleu, 'y', 8, 0);
      }
      P.bz(0, 11.0, -2.35, 2.3, 0.9, 1.5, H.bleu, {hl:0.8, hp:0.8});          // épaulière gauche (accent)
      P.sp(0, 12.75, 0, 1.6, 1.15, 1.55, H.acierF, 1);                         // casque
      P.b(-0.1, 13.75, 0, 1.4, 0.3, 1.0, H.bleu);
      P.b(1.3, 12.35, 0, 0.5, 0.75, 2.3, H.lum);                               // visière
      if(visee){
        // tube horizontal épaulé : bouche x 7, évasement arrière x -5
        P.cy(1.0, 12.1, z, 0.95, 12, H.acierF, 'x', 10);
        P.cy(-5.0, 12.1, z, 1.25, 1.0, H.noir, 'x', 10);                      // évasement arrière
        P.cy(6.8, 12.1, z, 1.1, 0.7, H.noir, 'x', 10);                        // bouche
        P.cy(3.8, 12.1, z, 1.02, 0.9, H.bleu, 'x', 10);                       // bague bleue
        P.b(2.4, 12.4, z - 1.25, 2.0, 1.0, 0.7, H.acier);                     // viseur (côté visage)
        P.b(1.6, 10.7, z, 0.6, 1.6, 0.5, H.noir);                             // poignée
        bras(P, [0.2, 10.9, 2.2], [0.9, 9.9, 2.6], [1.6, 10.6, z], H.tenue, H.noir);
        bras(P, [0.2, 10.9, -2.2], [2.2, 10.2, -0.8], [3.6, 11.1, z - 0.8], H.tenue, H.noir);
      } else {
        // porté sur l'épaule, nez relevé
        tubeIncline(P, -0.2, 12.3, z, 0.95, 12, H.acierF, 0.3);
        tubeIncline(P, -5.9, 10.55, z, 1.25, 1.0, H.noir, 0.3);
        tubeIncline(P, 2.6, 13.15, z, 1.02, 0.9, H.bleu, 0.3);
        bras(P, [0.2, 10.9, 2.2], [1.2, 9.6, 2.7], [1.8, 11.4, z], H.tenue, H.noir);
        bras(P, [0.2, 10.9, -2.2], [0.8, 9.2, -2.3], [1.4, 8.4, -1.6], H.tenue, H.noir);
      }
      return P.geo();
    }
    const lum = new Piece();
    lum.b(1.6, 12.35, 0, 0.1, 0.5, 2.0, H.lum);
    lum.b(3.42, 12.4, z - 1.25, 0.08, 0.5, 0.4, H.lum);                        // lentille du viseur (épaulé)
    return {genre:'fantassin', role:'bazooka', jambe, torse:{normal:torse(false), visee:torse(true)}, outil:null, lum:lum.geo(),
      feu:geoSouffle(7.2, -5.6, 12.1, z, 1.5), arriere:[-6, 12.1, z]};
  }

  // Grenadier (Karsk, rôle 'bazooka') : capote et casque rouge du conscrit, tube olive
  // à ogive conique, musette dorsale garnie de trois ogives.
  function modeleGrenadier(){
    const t = {panta:K.panta, tenue:K.tenue, peau:K.peau}, z = ROLE_TUBE;
    const jambe = geoJambe(K.panta, K.panta, K.noir);
    function torse(visee){
      const P = new Piece(); tronc(P, t);
      P.bz(0.1, 8.6, 0, 2.9, 2.2, 4.3, K.tenue, {bl:1.15, bp:1.1});
      P.seg(0.4, 11.0, -1.9, 1.4, 7.8, 1.8, 0.5, K.oliveF);
      P.b(-2.0, 9.6, 0, 1.9, 3.6, 3.6, K.toile);                               // musette à ogives
      for(const zz of [-1.1, 0, 1.1]){
        P.cy(-2.0, 12.0, zz, 0.5, 1.3, K.oliveF, 'y', 8);
        P.cy(-2.0, 13.15, zz, 0.75, 1.1, K.olive, 'y', 8, 0);
      }
      P.b(0, 11.05, -2.25, 2.0, 0.6, 1.3, K.rouge);                            // patte d'épaule gauche
      P.sp(0.05, 12.85, 0, 1.75, 1.05, 1.75, K.rouge, 1);                      // casque rond rouge
      P.cy(0.05, 12.5, 0, 1.8, 0.45, K.rougeF, 'y', 14);
      if(visee){
        P.cy(0.6, 12.1, z, 0.75, 10.5, K.oliveF, 'x', 10);                    // tube
        P.cy(-4.8, 12.1, z, 1.05, 1.2, K.noir, 'x', 10, 0.7);                 // évasement arrière
        P.cy(6.6, 12.1, z, 1.1, 1.6, K.olive, 'x', 10);                       // ogive : corps
        P.cy(8.4, 12.1, z, 1.1, 2.0, K.oliveC, 'x', 10, 0);                   // ogive : pointe
        P.cy(1.6, 12.1, z, 0.82, 0.8, K.rouge, 'x', 10);                      // bague rouge
        P.b(1.2, 10.8, z, 0.6, 1.6, 0.5, K.bois);                             // poignée bois
        bras(P, [0.2, 10.9, 2.2], [0.9, 9.9, 2.6], [1.3, 10.7, z], K.tenue, K.peau);
        bras(P, [0.2, 10.9, -2.2], [2.2, 10.2, -0.8], [3.4, 11.3, z - 0.7], K.tenue, K.peau);
      } else {
        tubeIncline(P, -0.4, 12.3, z, 0.75, 10.5, K.oliveF, 0.3);
        tubeIncline(P, -5.5, 10.75, z, 1.05, 1.2, K.noir, 0.3, 10, 0.7);
        tubeIncline(P, 5.6, 14.15, z, 1.1, 1.6, K.olive, 0.3);
        tubeIncline(P, 7.3, 14.66, z, 1.1, 2.0, K.oliveC, 0.3, 10, 0);
        bras(P, [0.2, 10.9, 2.2], [1.2, 9.6, 2.7], [1.8, 11.4, z], K.tenue, K.peau);
        bras(P, [0.2, 10.9, -2.2], [0.8, 9.2, -2.3], [1.4, 8.4, -1.6], K.tenue, K.peau);
      }
      return P.geo();
    }
    return {genre:'fantassin', role:'bazooka', jambe, torse:{normal:torse(false), visee:torse(true)}, outil:null,
      feu:geoSouffle(9.5, -5.5, 12.1, z, 1.5), arriere:[-6, 12.1, z]};
  }

  // Tireur d'élite. C : {camo:[teintes], tenue, panta, capuche, accent, arme, crosse, peau, botte}.
  // Tenue tachetée, capuche (pas de casque), long fusil à lunette et bipied.
  function modeleTireur(C, graine){
    const t = {panta:C.panta, tenue:C.tenue, peau:C.peau};
    const jambe = (() => {
      const P = new Piece();
      P.bz(0, -1.7, 0, 2.2, 3.5, 2.0, C.panta, {bl:0.85, bp:0.9});
      P.b(0.15, -4.4, 0, 1.8, 2.6, 1.75, C.panta);
      P.b(0.75, -3.2, 0, 0.6, 1.0, 1.5, C.camo[1]);                            // genouillère
      P.b(1.15, -1.6, 0, 0.12, 1.2, 1.2, C.camo[0]);                           // tache
      P.b(0.45, -6.05, 0, 2.7, 1.1, 1.9, C.botte);
      return P.geo();
    })();
    function torse(visee){
      const P = new Piece(); tronc(P, t);
      P.bz(0.1, 9.2, 0, 2.8, 3.6, 4.2, C.tenue, {hl:0.92, hp:0.95});         // vareuse
      taches(P, C.camo, 10, graine);
      // filet de camouflage : touffes sur les épaules et le dos
      for(let i = 0; i < 7; i++){
        const a = i*0.9;
        P.b(-1.1 + Math.cos(a)*0.4, 11.0 + (i%3)*0.35, Math.sin(a)*2.0, 1.4, 0.5, 1.1, C.camo[i % C.camo.length], 0, a, 0.3);
      }
      P.b(-1.9, 9.6, 0, 1.2, 2.6, 2.6, C.camo[1]);                             // sac léger
      P.b(0, 11.05, -2.3, 1.6, 0.5, 1.2, C.accent);                            // brassard (couleur du camp)
      P.sp(-0.15, 12.55, 0, 1.55, 1.5, 1.5, C.capuche, 1);                     // capuche
      P.b(0.95, 12.1, 0, 0.5, 0.6, 1.9, C.camo[2]);                            // cache-nez
      P.b(-0.2, 13.85, 0, 1.6, 0.25, 0.6, C.accent);                           // liseré (lisible d'en haut)
      if(visee){
        bras(P, [0.2, 10.9, 2.2], [1.0, 10.1, 2.2], [2.0, 10.6, 0.8], C.tenue, C.botte);
        bras(P, [0.2, 10.9, -2.2], [2.8, 10.3, -1.3], [5.0, 10.7, 0.6], C.tenue, C.botte);
        P.seg(-0.6, 10.75, 0.95, 2.6, 10.9, 0.85, 0.95, C.crosse, 0.6);       // crosse
        P.seg(2.6, 10.9, 0.85, 14.8, 11.0, 0.75, 0.5, C.arme);                 // long canon
        P.cy(15.0, 11.0, 0.75, 0.42, 1.3, C.arme, 'x', 6);                     // frein de bouche
        P.cy(3.6, 11.75, 0.85, 0.5, 4.2, C.arme, 'x', 8);                      // lunette
        P.cy(1.4, 11.75, 0.85, 0.62, 0.5, C.arme, 'x', 8);
        P.cy(5.8, 11.75, 0.85, 0.66, 0.6, C.arme, 'x', 8);
        P.seg(9.8, 10.8, 0.75, 11.0, 8.6, 1.4, 0.3, C.arme);                   // bipied replié vers l'avant
        P.seg(9.8, 10.8, 0.75, 11.0, 8.6, 0.1, 0.3, C.arme);
      } else {
        bras(P, [0.2, 10.9, 2.2], [0.6, 9.0, 2.4], [1.8, 8.6, 1.0], C.tenue, C.botte);
        bras(P, [0.2, 10.9, -2.2], [1.3, 9.6, -2.0], [2.6, 9.9, 0.0], C.tenue, C.botte);
        P.seg(-1.0, 7.8, 1.6, 2.4, 8.9, 1.1, 0.95, C.crosse, 0.6);
        P.seg(2.4, 8.9, 1.1, 12.6, 12.4, -1.0, 0.5, C.arme);
        P.seg(2.4, 9.8, 1.0, 6.4, 11.2, 0.6, 0.6, C.arme);                     // lunette
      }
      return P.geo();
    }
    return {genre:'fantassin', role:'sniper', jambe, torse:{normal:torse(false), visee:torse(true)}, outil:null};
  }
  // Traqueur (Halden) : tachetée gris-vert, capuche acier, brassard bleu.
  function modeleTraqueur(){
    return modeleTireur({camo:['#5d6b62', '#3c4741', '#7d877a'], tenue:'#4a5650', panta:'#434e48', capuche:'#56625a',
      accent:H.bleu, arme:H.noir, crosse:H.acierF, peau:H.peau, botte:H.noir}, 1234);
  }
  // Guetteur (Karsk) : tachetée olive et terre, capuche olive, brassard rouge, crosse bois.
  function modeleGuetteur(){
    return modeleTireur({camo:['#6b6a3e', '#4a5236', '#86774f'], tenue:K.tenue, panta:K.panta, capuche:K.oliveC,
      accent:K.rouge, arme:K.noir, crosse:K.bois, peau:K.peau, botte:K.noir}, 4321);
  }

  // ---------- Réparateurs (rôle 'reparateur', champ repare) ----------
  // Effets communs (matériau additif) : faisceau unitaire le long de +X (étiré jusqu'à la cible),
  // source (lueur au bout de l'outil) et impact (étincelles de soudure ou halo de soin).
  // M.soin : {faisceau, source, impact, type:'soudure'|'soin', bout:{ancre:'corps'|'canon', p:[x, y, z]}}.
  const BLANC_CASSE = '#e9edf0', BLANC_KARSK = '#e2dfcc';
  matieres(0.6, 0.02, [BLANC_KARSK]);
  function effetsSoin(type, bout){
    const f = new Piece(), s = new Piece(), i = new Piece();
    if(type === 'soudure'){
      f.b(0.5, 0, 0, 1, 0.2, 0.2, '#2c5a6c');                                           // arc fin, bleu-blanc, discret
      f.b(0.5, 0, 0, 1, 0.06, 0.06, '#bfe6f5');
      s.sp(0, 0, 0, 0.7, 0.7, 0.7, '#cfefff', 1);
      i.sp(0, 0, 0, 1.1, 1.1, 1.1, '#fff6d8', 1);                                       // point de soudure
      for(let k = 0; k < 9; k++){                                                       // gerbe d'étincelles
        const a = k*2.39, b = 0.25 + (k%3)*0.35, L = 2.2 + (k%4)*0.9;
        i.seg(0, 0, 0, Math.cos(a)*Math.cos(b)*L, Math.sin(b)*L*1.2, Math.sin(a)*Math.cos(b)*L, 0.16, k%2 ? '#ffd27a' : '#ffb347');
      }
    } else {
      f.b(0.5, 0, 0, 1, 0.55, 0.55, '#1f5a3e');                                         // faisceau doux, vert pâle
      f.b(0.5, 0, 0, 1, 0.16, 0.16, '#8fe8b8');
      s.sp(0, 0, 0, 0.8, 0.8, 0.8, '#c8ffe0', 1);
      i.sp(0, 0, 0, 2.6, 2.6, 2.6, '#1e5a3c', 1);                                       // halo
      i.sp(0, 0, 0, 1.1, 1.1, 1.1, '#9af0c4', 1);
    }
    return {faisceau:f.geo(), source:s.geo(), impact:i.geo(), type, bout};
  }

  // Mécano (Halden) : gilet de travail clair à bandes bleues, bouteilles de gaz dorsales, masque de
  // soudeur relevé, caisse à outils bleue à la main gauche, chalumeau à la droite, brassards blancs.
  function modeleMecano(){
    const t = {panta:H.tenue, tenue:H.tenue, peau:H.peau};
    const jambe = geoJambe(H.tenue, H.acierC, H.noir);
    function torse(soin){
      const P = new Piece(); tronc(P, t);
      P.bz(0.2, 9.3, 0, 2.9, 3.0, 4.25, H.acierC, {hl:0.92, hp:0.95});                  // gilet de travail
      P.b(0, 8.4, 0, 3.0, 0.45, 4.35, H.bleu);                                           // bandes (accent)
      P.b(0, 10.0, 0, 3.0, 0.35, 4.35, H.bleu);
      for(const z of [-0.75, 0.8]) P.cy(-1.95, 10.1, z, 0.72, 4.4, z < 0 ? H.clair : H.acierF, 'y', 8);   // bouteilles
      P.cy(-1.95, 12.5, 0, 0.25, 0.8, H.noir, 'y', 6);                                    // détendeur
      P.sp(0, 12.75, 0, 1.6, 1.1, 1.55, H.acierF, 1);                                     // casque
      P.bz(0.5, 13.85, 0, 1.9, 0.45, 2.7, H.noir, {hl:0.8}, 0, 0, 0.55);                  // masque de soudeur relevé
      P.b(0.95, 14.0, 0, 0.2, 0.35, 1.4, H.bleu, 0, 0, 0.55);
      for(const s of [-1, 1]){                                                            // brassards blancs à bande bleue
        P.b(0.3, 10.0, s*2.45, 1.45, 1.1, 1.45, BLANC_CASSE);
        P.b(0.3, 10.0, s*2.45, 1.55, 0.36, 1.55, H.bleu);
      }
      // main gauche : caisse à outils bleue (lisible d'en haut)
      bras(P, [0.2, 10.9, -2.2], [0.4, 9.0, -2.7], [0.6, 7.6, -2.9], H.tenue, H.noir);
      P.b(0.6, 6.3, -3.1, 3.0, 1.7, 1.4, H.bleu);
      P.b(0.6, 7.25, -3.1, 3.05, 0.2, 1.45, H.acierF);
      P.b(0.6, 7.6, -3.1, 1.6, 0.5, 0.3, H.noir);                                         // poignée
      if(soin){
        // bras droit tendu, chalumeau pointé vers l'avant
        bras(P, [0.2, 10.9, 2.2], [2.0, 10.3, 2.0], [3.8, 10.0, 1.2], H.tenue, H.noir);
        P.seg(3.6, 10.1, 1.2, 5.6, 9.6, 1.0, 0.42, H.noir);
        P.cy(5.9, 9.55, 1.0, 0.18, 0.7, H.acierC, 'x', 6);
        P.seg(-1.9, 8.0, 0.6, 3.4, 9.9, 1.3, 0.22, H.noir);                               // tuyau
      } else {
        bras(P, [0.2, 10.9, 2.2], [0.6, 9.0, 2.5], [1.5, 8.2, 2.1], H.tenue, H.noir);
        P.seg(1.5, 8.2, 2.1, 3.2, 7.0, 2.0, 0.42, H.noir);                                // chalumeau baissé
        P.seg(-1.9, 8.0, 0.6, 1.4, 8.0, 2.0, 0.22, H.noir);
      }
      return P.geo();
    }
    const lum = new Piece();
    lum.b(1.62, 12.9, 0, 0.12, 0.35, 0.7, '#fff2c4');                                     // lampe frontale
    lum.b(0.6, 6.7, -3.82, 1.4, 0.2, 0.06, H.lum);                                        // voyant de la caisse
    const normal = torse(false);
    return {genre:'fantassin', role:'reparateur', reparateur:true, jambe, torse:{normal, visee:normal, soin:torse(true)}, outil:null, lum:lum.geo(),
      soin:effetsSoin('soudure', {ancre:'corps', p:[6.3, 9.55, 1.0]})};
  }

  // Infirmier (Karsk) : capote olive, casque rouge cerclé de blanc, grand sac de soins blanc à bande
  // rouge, brassards blancs (sans emblème réel), lampe de soin à la main droite.
  function modeleInfirmier(){
    const t = {panta:K.panta, tenue:K.tenue, peau:K.peau};
    const jambe = geoJambe(K.panta, K.panta, K.noir);
    function torse(soin){
      const P = new Piece(); tronc(P, t);
      P.bz(0.1, 8.6, 0, 2.9, 2.2, 4.3, K.tenue, {bl:1.15, bp:1.1});                      // pans de capote
      P.seg(0.4, 11.0, 1.9, 1.4, 7.8, -1.8, 0.5, K.oliveF);                              // bandoulière
      P.b(-2.1, 9.6, 0, 2.1, 3.3, 3.8, BLANC_KARSK);                                     // sac de soins
      P.b(-2.1, 9.6, 0, 2.15, 0.7, 3.85, K.rouge);                                       // bande rouge (accent)
      P.b(-2.1, 11.35, 0, 1.6, 0.25, 3.2, K.rouge);                                      // rabat (lisible d'en haut)
      P.b(1.2, 7.7, -2.0, 1.4, 1.5, 0.9, BLANC_KARSK);                                   // trousse de ceinture
      P.sp(0.05, 12.85, 0, 1.75, 1.05, 1.75, K.rouge, 1);                                // casque rouge
      P.cy(0.05, 12.75, 0, 1.8, 0.5, BLANC_KARSK, 'y', 14);                              // cercle blanc
      P.cy(0.05, 12.45, 0, 1.82, 0.3, K.rougeF, 'y', 14);
      for(const s of [-1, 1]){
        P.b(0.3, 10.0, s*2.45, 1.45, 1.1, 1.45, BLANC_KARSK);
        P.b(0.3, 10.0, s*2.45, 1.55, 0.36, 1.55, K.rouge);
      }
      bras(P, [0.2, 10.9, -2.2], [0.7, 9.1, -2.6], [1.4, 8.3, -2.2], K.tenue, K.peau);
      if(soin){
        bras(P, [0.2, 10.9, 2.2], [2.0, 10.4, 2.0], [3.9, 10.2, 1.1], K.tenue, K.peau);
        P.b(4.6, 10.2, 1.0, 1.6, 0.8, 0.8, K.noir);                                       // lampe de soin
        P.cy(5.45, 10.2, 1.0, 0.45, 0.2, K.acier, 'x', 8);
      } else {
        bras(P, [0.2, 10.9, 2.2], [0.6, 9.0, 2.5], [1.6, 8.4, 2.0], K.tenue, K.peau);
        P.b(2.0, 8.2, 2.0, 1.4, 0.8, 0.8, K.noir);
      }
      return P.geo();
    }
    const normal = torse(false);
    return {genre:'fantassin', role:'reparateur', reparateur:true, matK:true, jambe, torse:{normal, visee:normal, soin:torse(true)}, outil:null,
      soin:effetsSoin('soin', {ancre:'corps', p:[5.65, 10.2, 1.0]})};
  }

  // Ouvriers : bras droit + outil séparé (animé), bidon d'eau quand chargé.
  function modeleOuvrier(halden){
    const C = halden ? {combi:H.combi, bande:H.bleu, casque:H.casqueBlanc, top:H.bleu, peau:H.peau, botte:H.noir, ceinture:H.acierF}
                     : {combi:K.olive, bande:K.kaki, casque:K.rouge, top:K.rouge, peau:K.peau, botte:K.noir, ceinture:K.oliveF};
    const t = {panta:C.combi, tenue:C.combi, peau:C.peau};
    const jambe = geoJambe(C.combi, C.bande, C.botte);
    function torse(charge){
      const P = new Piece(); tronc(P, t);
      P.b(0, 7.75, 0, 2.5, 0.6, 3.9, C.ceinture);                              // ceinture à outils
      P.b(1.2, 7.5, -1.3, 0.8, 1.0, 1.0, C.ceinture);
      P.b(0, 9.0, 0, 2.6, 0.55, 4.1, C.bande);                                 // bande réfléchissante
      P.b(0, 10.4, 0, 2.6, 0.45, 4.1, C.bande);
      // casque de chantier + visière
      P.sp(0.05, 12.75, 0, 1.55, 1.05, 1.5, C.casque, 1);
      P.cy(0.25, 12.4, 0, 1.95, 0.25, C.casque, 'y', 14);
      P.b(0, 13.6, 0, 1.6, 0.45, 0.7, C.top);                                  // arête du casque (accent)
      // bras gauche (le droit est l'outil animé)
      if(charge && halden){
        bras(P, [0.1, 10.9, -2.2], [0.3, 9.0, -2.9], [0.4, 7.3, -3.0], C.combi, C.ceinture);
        // bidon d'eau bleu tenu à la main
        P.b(0.3, 5.6, -3.15, 2.6, 3.2, 1.4, H.bleu);
        P.b(0.3, 7.35, -3.15, 1.6, 0.4, 0.5, H.acierF);
        P.cy(1.2, 7.3, -3.15, 0.35, 0.5, H.casqueBlanc, 'y', 6);
      } else if(charge){
        bras(P, [0.1, 10.9, -2.2], [-1.0, 11.8, -2.3], [-2.0, 12.6, -1.4], C.combi, C.peau);
        // jerrican sur l'épaule / le dos
        P.b(-2.3, 10.6, 0, 1.6, 3.8, 3.2, K.sac);
        P.b(-2.3, 12.65, 0.6, 0.9, 0.5, 1.4, K.rouge);
        P.seg(-1.5, 9.0, 0, -1.5, 12.0, 0, 0.3, K.oliveF);
      } else {
        bras(P, [0.1, 10.9, -2.2], [0.4, 9.0, -2.5], [1.0, 7.8, -2.2], C.combi, C.ceinture);
      }
      if(halden){
        P.b(-1.65, 9.6, 0, 0.9, 2.6, 2.6, H.acierC);                           // boîtier d'outillage dorsal
        P.b(-2.15, 10.5, 0, 0.2, 0.8, 1.6, H.lum);
      } else {
        P.b(-1.75, 9.4, 0, 1.2, 2.6, 2.6, K.toile);                            // musette
        for(const s of [-1, 1]) P.b(0, 11.05, s*2.25, 2.0, 0.6, 1.3, K.rouge);  // brassards / pattes d'épaule rouges
      }
      return P.geo();
    }
    // Bras droit + outil (origine à l'épaule)
    const O = new Piece();
    O.seg(0, 0, 0, 0.5, -2.2, 0.15, 1.15, C.combi);
    O.seg(0.5, -2.2, 0.15, 2.0, -3.0, -0.4, 1.0, C.combi);
    O.sp(2.0, -3.0, -0.4, 0.6, 0.6, 0.6, halden ? H.noir : C.peau);
    if(halden){
      // visseuse / outil multifonction
      O.b(2.4, -2.8, -0.4, 1.0, 1.6, 0.8, H.acierF);
      O.b(3.0, -2.15, -0.4, 1.8, 0.9, 0.9, H.bleu);
      O.cy(4.2, -2.15, -0.4, 0.22, 1.2, H.clair, 'x', 6);
    } else {
      // pioche
      O.seg(1.0, -3.6, -0.4, 4.8, -1.4, -0.4, 0.45, K.bois);
      O.seg(4.0, -0.2, -0.4, 5.6, -2.8, -0.4, 0.55, K.acier);
    }
    const outil = {geo:O.geo(), x:0.15, y:10.85, z:2.25};
    // lueurs : lampe frontale du casque ; Halden : voyant du boîtier dorsal
    const lum = new Piece();
    lum.b(1.72, 12.95, 0, 0.12, 0.4, 0.7, halden ? '#fff2c4' : FEU.phare);
    if(halden) lum.b(-2.28, 10.5, 0, 0.08, 0.7, 1.4, H.lum);
    return {genre:'fantassin', ouvrier:true, jambe, torse:{normal:torse(false), charge:torse(true)}, outil, lum:lum.geo()};
  }

  // ---------- 4.b Véhicules ----------
  // Géométrie de chenilles (les deux côtés) avec uv répétés pour le défilement.
  function geoChenilles(L, h, larg, zc, yc, coul){
    const P = new Piece(), r = h/2, Lc = L - h;
    for(const s of [-1, 1]){
      P.g(BOITE, coul, matrice(0, yc, s*zc, 0, 0, 0, Lc, h, larg), Lc / PAS_CHENILLE);
      for(const e of [-1, 1]) P.g(geoCyl(12, 1), coul, matrice(e*Lc/2, yc, s*zc, Math.PI/2, 0, 0, r, larg, r), Math.PI*r / PAS_CHENILLE);
    }
    return P.geo();
  }
  // Galets / barbotins visibles sur le flanc extérieur (statiques, fusionnés à la coque).
  function galets(P, n, L, r, y, z, coul, moyeu){
    for(const s of [-1, 1]) for(let i = 0; i < n; i++){
      const x = -L/2 + r + i*(L - 2*r)/(n - 1);
      P.cy(x, y, s*z, r, 0.6, coul, 'z', 10);
      P.cy(x, y, s*(z + 0.35), r*0.45, 0.3, moyeu, 'z', 6);
    }
  }
  // Roue (instanciée) : pneu + jante + rayons (rotation visible).
  function geoRoue(r, larg, jante, rayon){
    const P = new Piece();
    P.cy(0, 0, 0, r, larg, H.pneu, 'z', 14);
    P.cy(0, 0, 0, r*0.55, larg + 0.25, jante, 'z', 8);
    for(let k = 0; k < 3; k++) P.b(0, 0, 0, r*1.2, 0.5, larg + 0.4, rayon, 0, 0, k*Math.PI/3);
    P.cy(0, 0, 0, r*0.18, larg + 0.6, rayon, 'z', 6);
    return P.geo();
  }

  // Bastion (Halden) : char moderne anguleux, briques réactives, long canon.
  function modeleBastion(){
    const C = H, coque = new Piece(), lum = new Piece(), tour = new Piece(), canon = new Piece();
    coque.b(0, 5.0, 0, 33, 3.6, 13.5, C.acierF);                                      // caisse basse
    coque.bz(0.2, 8.3, 0, 36, 3.2, 21.6, C.acier, {hl:0.88, dx:-0.05, hp:0.95});      // caisse haute
    coque.bz(17.6, 5.6, 0, 4.2, 3.6, 15, C.acierF, {hl:0.25, dx:-0.38});              // nez incliné
    for(const s of [-1, 1]){
      coque.b(0.5, 6.1, s*11.1, 31, 4.0, 0.9, C.acier);                               // jupe
      for(let i = 0; i < 7; i++) coque.bz(-11.2 + i*3.95, 6.55, s*11.75, 3.5, 2.9, 0.9, C.acierC, {hl:0.88, hp:0.7});
      coque.b(0.5, 8.25, s*11.4, 31, 0.5, 1.4, C.acierF);
      lum.b(16.6, 8.8, s*8.4, 0.5, 0.6, 3.6, C.lum);                                   // feux avant (bande)
      lum.b(-17.9, 8.6, s*8.6, 0.4, 0.5, 2.4, '#ff5a3c');                             // feux arrière
      lum.b(-4, 8.55, s*12.15, 18, 0.25, 0.25, C.lum);                                 // liseré latéral
    }
    for(let i = -2; i <= 2; i++) coque.bz(12.8, 10.05, i*3.6, 4.2, 0.9, 3.2, C.acierC, {hl:0.75, hp:0.85});   // briques du glacis
    for(let i = 0; i < 5; i++) coque.b(-11.5 - i*1.4, 10.0, 0, 0.7, 0.3, 13, C.noir);  // grille moteur
    coque.b(-13.2, 10.05, 7.6, 7.5, 0.25, 3.0, C.bleu); coque.b(-13.2, 10.05, -7.6, 7.5, 0.25, 3.0, C.bleu); // accents dessus
    coque.b(-17.5, 7.5, 0, 1.2, 2.5, 8, C.acierF);
    coque.cy(-17, 10.2, 6.5, 0.7, 2.5, C.acierF, 'x', 6);
    // train : chenilles + galets
    const train = geoChenilles(36, 5.4, 5.2, 8.4, 2.7, '#3d3f40');
    // tourelle (pivot x -1, y 9.9)
    tour.bz(0.5, 2.3, 0, 16, 4.6, 15, C.acier, {hl:0.8, hp:0.86, dx:-0.06});
    for(const s of [-1, 1]) tour.bz(6.4, 2.2, s*4.3, 6, 4.2, 6.4, C.acier, {hl:0.6, dx:-0.15, bl:1, hp:0.8}, 0, -s*0.42, 0);   // joues en flèche
    tour.bz(-9.2, 2.4, 0, 6.4, 3.8, 12.5, C.acierF, {hl:0.9, hp:0.9});               // panier arrière
    for(const s of [-1, 1]) for(let i = 0; i < 3; i++) tour.b(-1 + i*3.4, 2.3, s*7.35, 3.0, 3.0, 0.8, C.acierC);  // briques latérales
    tour.b(-0.8, 4.75, 0, 10.5, 0.3, 11, C.bleu);                                     // toit bleu (accent, couleur du camp ; élargi pour se lire au zoom de jeu)
    tour.b(-0.8, 4.95, 0, 5.5, 0.15, 1.2, C.clair);
    tour.b(-4.2, 5.6, -3.6, 3.0, 1.6, 2.6, C.acierF);                                 // tourelleau téléopéré
    tour.cy(-2.2, 5.9, -3.6, 0.3, 3.4, C.noir, 'x', 6);
    tour.b(3.2, 5.6, 3.4, 2.2, 1.8, 2.2, C.acierF);                                   // viseur
    lum.vide();
    tour.b(4.35, 5.7, 3.4, 0.2, 0.9, 1.3, C.lum);
    tour.cy(-10.5, 7.5, 4.8, 0.12, 6, C.noir, 'y', 4);                                // antenne
    // canon (pivot à x 9, y 2.4 du repère tourelle)
    canon.b(0, 0, 0, 3.4, 3.4, 5.0, C.acierF);                                        // masque
    canon.cy(9.5, 0, 0, 1.3, 16, C.acier, 'x', 10);                                   // manchon thermique
    canon.cy(10, 0, 0, 1.0, 19.5, C.acierF, 'x', 10);                                 // tube
    canon.cy(19.4, 0, 0, 1.35, 1.6, C.noir, 'x', 10);                                 // bouche
    canon.cy(6.5, 0, 0, 1.7, 2.4, C.acierF, 'x', 10);                                 // évacuateur
    return {genre:'vehicule', coque:coque.geo(), lum:lum.geo(), train:{type:'chenilles', geo:train}, tourelle:tour.geo(), canon:canon.geo(),
      pivotT:[-1, 9.9, 0], pivotC:[9, 2.4, 0], recul:3.2, l:38, p:22, h:16, poussiere:1.1, fumeeH:12};
  }

  // Ours (Karsk) : char lourd massif, tourelle coulée, jupes, fûts, gros canon.
  function modeleOurs(){
    const C = K, coque = new Piece(), lum = new Piece(), tour = new Piece(), canon = new Piece();
    coque.b(0, 5.3, 0, 38, 4.2, 15.5, C.oliveF);
    coque.bz(-0.5, 9.0, 0, 39, 3.6, 26, C.olive, {hl:0.9, dx:-0.03, hp:0.97});
    coque.bz(19.6, 6.3, 0, 4.6, 4.8, 18, C.oliveF, {hl:0.2, dx:-0.4});                 // glacis
    for(const s of [-1, 1]){
      for(let i = 0; i < 6; i++) coque.bz(-15.2 + i*6.15, 6.6, s*13.35, 5.9, 5.2, 1.3, i%2 ? C.olive : C.oliveC, {hl:1, hp:0.8});   // jupes segmentées
      coque.b(-0.5, 9.25, s*13.5, 37, 0.6, 1.6, C.oliveF);
      coque.b(16.5, 11.0, s*10.5, 2.0, 0.9, 2.0, C.noir);                                // boîtiers de phares
      lum.b(17.58, 11.0, s*10.5, 0.2, 0.6, 1.5, FEU.phare);                              // phares (verres)
      lum.b(-20.15, 8.9, s*11.4, 0.3, 0.6, 1.6, FEU.arriere);                            // feux arrière
    }
    for(let i = 0; i < 4; i++) coque.b(14.8, 11.0, -6 + i*4, 2.8, 0.6, 3.4, C.acier);   // maillons de rechange
    coque.b(10.5, 10.95, 0, 3.0, 0.3, 14, C.rouge);                                     // bande rouge sur le glacis
    for(let i = 0; i < 2; i++) coque.cy(-20.0, 10.6, -6 + i*12, 1.9, 9, C.oliveC, 'z', 10);   // fûts arrière
    coque.cy(-20.0, 10.6, 0, 0.6, 26, C.acier, 'z', 6);
    for(let i = 0; i < 4; i++) coque.b(-11 - i*1.8, 10.95, 0, 1.0, 0.35, 14, C.noir);   // grilles
    coque.b(-6, 11.2, 9.5, 12, 1.2, 3.0, C.toile);                                      // filet roulé
    coque.b(-2, 11.0, -10, 9, 1.0, 2.2, C.bois);                                        // rondin
    const train = geoChenilles(40, 6.2, 6, 10, 3.1, '#3a3830');
    // tourelle coulée (pivot x -2.5, y 10.8)
    tour.sp(0, 2.9, 0, 11, 4.4, 10.2, C.rouge, 1);                                     // dôme entièrement rouge (identité Karsk vue d'en haut)
    tour.b(0, 1.0, 0, 18, 2.0, 17, C.oliveF);
    tour.b(-11, 2.6, 0, 6, 3.0, 13, C.acier);                                           // panier de rangement
    tour.b(-11.2, 4.2, 0, 5.5, 0.6, 12.4, C.toile);
    tour.b(-12.5, 4.6, -3, 3.5, 1.6, 4.5, C.sac);                                       // bâche / sacs
    for(const s of [-1, 1]) tour.b(-3.5, 7.1, s*2.2, 9, 0.3, 1.6, C.rougeF);               // deux bandes sombres (relief du toit rouge)
    tour.cy(-3.5, 7.4, 4.3, 1.9, 1.6, C.oliveC, 'y', 10);                               // tourelleau
    tour.cy(-3.5, 8.3, 4.3, 1.4, 0.5, C.oliveF, 'y', 10);
    tour.cy(-0.5, 8.9, 4.3, 0.35, 6.5, C.noir, 'x', 6);                                  // mitrailleuse lourde
    tour.cy(-3, 7.3, -4.5, 1.5, 1.0, C.oliveF, 'y', 8);
    for(const s of [-1, 1]) for(let i = 0; i < 3; i++) tour.cy(5.5, 4.4 + i*0.9, s*8.8, 0.45, 1.6, C.noir, 'x', 6);  // lance-pots
    tour.cy(-9, 9, -5.5, 0.12, 8, C.noir, 'y', 4);
    // canon (pivot x 8.5, y 3)
    canon.bz(0, 0, 0, 4.5, 4.4, 7, C.oliveF, {hl:0.8, hp:0.85});                         // masque massif
    canon.cy(9, 0, 0, 1.3, 15, C.olive, 'x', 10);
    canon.cy(8.8, 0, 0, 1.9, 3.6, C.oliveC, 'x', 10);                                   // évacuateur de fumée
    canon.cy(16, 0, 0, 1.15, 3, C.oliveF, 'x', 10);
    canon.cy(17.6, 0, 0, 1.4, 0.8, C.noir, 'x', 10);
    return {genre:'vehicule', coque:coque.geo(), lum:lum.geo(), train:{type:'chenilles', geo:train}, tourelle:tour.geo(), canon:canon.geo(),
      pivotT:[-2.5, 10.8, 0], pivotC:[8.5, 3, 0], recul:3.6, l:42, p:27, h:18, poussiere:1.3, fumeeH:13};
  }

  // Lynx (Halden) : blindé 6×6 à tourelle de canon automatique.
  function modeleLynx(){
    const C = H, coque = new Piece(), lum = new Piece(), tour = new Piece(), canon = new Piece();
    coque.bz(0, 5.4, 0, 29, 3.6, 12.5, C.acierF, {bp:0.7});                            // coque en V
    coque.bz(0.2, 9.0, 0, 31, 3.8, 16.8, C.acier, {hl:0.82, dx:-0.07, hp:0.9});         // caisse
    coque.bz(15.4, 6.6, 0, 3.2, 3.2, 13.5, C.acierF, {hl:0.2, dx:-0.4});               // nez
    for(const s of [-1, 1]){
      for(const x of [-10, -0.5, 9]) coque.bz(x, 7.6, s*8.0, 7.2, 1.0, 3.4, C.acierF, {hl:0.75});   // garde-boue
      coque.b(-3, 9.0, s*8.6, 14, 2.6, 0.5, C.acierC);                                   // panneaux latéraux
      coque.b(10, 10.4, s*5.8, 4, 0.4, 2.2, C.vitre);                                    // épiscopes
      lum.b(15.0, 8.6, s*5.6, 0.4, 0.6, 3.2, C.lum);
      lum.b(-15.6, 8.6, s*6.2, 0.3, 0.5, 2.0, '#ff5a3c');
      lum.b(-2, 10.95, s*7.25, 22, 0.2, 0.3, C.lum);                                     // liseré lumineux du toit
    }
    coque.b(-11.5, 10.95, 0, 6, 0.25, 9, C.bleu);                                        // bande bleue arrière (dessus)
    coque.b(11.2, 10.9, 0, 2.5, 0.25, 9.5, C.bleu);
    coque.b(-15.4, 8.3, 0, 0.6, 4.2, 7, C.acierF);                                       // porte arrière
    coque.cy(-13, 11.3, -6, 0.1, 6, C.noir, 'y', 4);
    const roue = geoRoue(3.9, 3.0, C.acierC, C.acierF);
    const roues = [];
    for(const x of [-10, -0.5, 9]) for(const s of [-1, 1]) roues.push([x, 3.9, s*7.7]);
    // tourelle (pivot x -1.5, y 10.9)
    tour.bz(0, 1.8, 0, 11, 3.6, 9.5, C.acier, {hl:0.75, hp:0.8, dx:-0.05});
    tour.bz(5.5, 1.6, 0, 3, 3.0, 7, C.acier, {hl:0.3, dx:-0.35});
    tour.b(-0.5, 3.7, 0, 7.5, 0.25, 7.2, C.bleu);                                       // toit bleu (couleur du camp)
    tour.b(-1, 4.6, 2.6, 2.4, 1.8, 2.2, C.acierF);                                      // viseur panoramique
    tour.b(0.25, 4.6, 2.6, 0.2, 1.0, 1.4, C.lum);
    for(const s of [-1, 1]) tour.b(-6.3, 2.0, s*3, 1.8, 2.2, 2.4, C.acierF);            // coffres
    for(const s of [-1, 1]) for(let i = 0; i < 2; i++) tour.cy(2.5, 2.6 + i*0.8, s*4.9, 0.35, 1.2, C.noir, 'x', 6);
    // canon automatique (pivot x 6, y 1.8)
    canon.b(0, 0, 0, 2.2, 1.9, 2.6, C.acierF);
    canon.cy(7.5, 0, 0, 0.8, 14, C.acierF, 'x', 8);                                     // tube (épaissi : lisible vu de haut)
    canon.cy(3.4, 0, 0, 1.15, 4.4, C.acier, 'x', 8);                                    // manchon
    canon.cy(14.6, 0, 0, 1.1, 1.8, C.noir, 'x', 8);                                      // frein de bouche
    canon.cy(4, 0.9, 1.0, 0.25, 4, C.noir, 'x', 6);                                      // coaxiale
    return {genre:'vehicule', coque:coque.geo(), lum:lum.geo(), train:{type:'roues', geo:roue, pos:roues, r:3.9}, tourelle:tour.geo(), canon:canon.geo(),
      pivotT:[-1.5, 10.9, 0], pivotC:[6, 1.8, 0], recul:1.3, l:32, p:17.5, h:15, poussiere:0.9, fumeeH:11};
  }

  // Grêle (Karsk) : camion 6×6 lance-roquettes, caisson qui se lève.
  function modeleGrele(){
    const C = K, coque = new Piece(), lum = new Piece(), tour = new Piece(), canon = new Piece();
    coque.b(0, 4.6, 0, 34, 1.6, 7, C.acier);                                             // châssis
    // cabine
    coque.bz(12.2, 8.6, 0, 9, 7.2, 15, C.olive, {hl:0.78, dx:-0.1, hp:0.95});
    coque.bz(16.4, 9.2, 0, 1.0, 3.2, 13, C.vitre, {hl:0.4, dx:-0.6}, 0, 0, 0);         // pare-brise
    coque.b(11.3, 12.3, 0, 7.2, 0.3, 14.4, C.rouge);                                     // toit de cabine entièrement rouge
    coque.b(17.2, 5.3, 0, 1.2, 1.6, 15.5, C.noir);                                       // pare-chocs
    for(let i = -1; i <= 1; i++) lum.b(14.6, 12.6, i*3.2, 0.5, 0.3, 0.8, FEU.ambre);     // feux de gabarit du toit
    for(const s of [-1, 1]){
      coque.b(16.9, 7.0, s*5.8, 0.4, 1.3, 1.9, C.noir);                                   // boîtiers de phares
      lum.b(17.15, 7.0, s*5.8, 0.25, 1.0, 1.6, FEU.phare);                                // phares
      lum.b(-18.15, 7.3, s*6.4, 0.3, 0.7, 1.4, FEU.arriere);                              // feux arrière
      coque.b(-4.5, 6.6, s*7.3, 27, 1.0, 1.4, C.oliveF);                                  // longerons / garde-boue
      coque.bz(11, 6.4, s*7.4, 7, 1.2, 1.8, C.oliveF, {hl:0.7});
      coque.b(4.5, 7.1, s*7.0, 3.0, 2.4, 1.6, C.oliveC);                                  // coffres
      coque.b(-2, 6.3, s*7.6, 2.2, 3.0, 1.2, C.toile);                                    // jerricans
    }
    coque.b(-5, 7.0, 0, 26, 1.2, 14.5, C.oliveF);                                         // plateau
    coque.b(5.6, 9.6, 0, 1.8, 4.2, 14, C.oliveC);                                         // écran pare-souffle
    for(const s of [-1, 1]) coque.b(-17.5, 7.8, s*5.5, 1.2, 2.4, 1.2, C.acier);           // vérins de calage
    const roue = geoRoue(3.9, 3.0, C.oliveC, C.oliveF);
    const roues = [];
    for(const x of [11.5, -5.5, -12.5]) for(const s of [-1, 1]) roues.push([x, 3.9, s*7.2]);
    // plateforme tournante (pivot x -6, y 7.6)
    tour.cy(0, 0.9, 0, 4.2, 1.8, C.acier, 'y', 12);
    tour.b(-2.5, 2.6, 0, 6, 2.4, 7, C.oliveF);
    for(const s of [-1, 1]) tour.b(-4, 3.8, s*4.0, 4.5, 3.2, 1.0, C.olive);               // flasques
    // caisson de tubes (pivot à l'arrière : x -6.5, y 4.6 du repère tourelle)
    canon.b(8.5, 2.6, 0, 17, 5.2, 11, C.olive);
    canon.b(8.5, 5.3, 0, 17, 0.3, 11.4, C.rouge);                                          // dessus du caisson rouge
    canon.b(15, 5.5, 0, 3.0, 0.25, 11.4, C.rougeF);                                        // repère sombre (dessus)
    for(let i = 0; i < 4; i++) for(let j = 0; j < 5; j++)
      canon.cy(17.05, 0.65 + i*1.3, -4.2 + j*2.1, 0.62, 0.3, C.noir, 'x', 8);              // bouches des tubes
    for(let j = 0; j < 4; j++) canon.b(8.5, 2.6, -3.15 + j*2.1, 17.2, 5.25, 0.25, C.oliveF);  // séparations
    return {genre:'vehicule', coque:coque.geo(), lum:lum.geo(), train:{type:'roues', geo:roue, pos:roues, r:3.9}, tourelle:tour.geo(), canon:canon.geo(),
      pivotT:[-6, 7.6, 0], pivotC:[-6.5, 4.6, 0], recul:0.8, elevation:0.62, l:36, p:16, h:15, poussiere:1.0, fumeeH:10};
  }

  // Sentinelle (Karsk) : chenillé antiaérien, tourelle bitube et radar tournant.
  function modeleSentinelle(){
    const C = K, coque = new Piece(), lum = new Piece(), tour = new Piece(), canon = new Piece(), radar = new Piece();
    coque.b(0, 5.0, 0, 29, 4.0, 13, C.oliveF);
    coque.bz(-0.3, 8.3, 0, 31, 2.8, 20, C.olive, {hl:0.9, dx:-0.04, hp:0.95});
    coque.bz(15.6, 5.8, 0, 3.6, 3.6, 14, C.oliveF, {hl:0.2, dx:-0.4});
    galets(coque, 5, 28, 2.4, 3.0, 10.4, C.oliveF, C.acier);
    for(const s of [-1, 1]){
      coque.b(-0.3, 8.0, s*10.3, 30, 0.5, 1.6, C.oliveF);
      coque.b(-8, 10.0, s*8.2, 7, 1.6, 2.6, C.oliveC);                                       // coffres
      coque.b(14.2, 9.9, s*7.5, 1.4, 0.8, 1.5, C.noir);                                       // boîtiers de phares
      lum.b(14.98, 9.9, s*7.5, 0.2, 0.5, 1.1, FEU.phare);                                     // phares
      lum.b(-15.85, 8.4, s*8.6, 0.3, 0.5, 1.4, FEU.arriere);                                  // feux arrière
    }
    lum.b(-13.6, 9.85, 5.6, 0.5, 0.3, 0.5, FEU.vert);                                        // voyant « radar en veille »
    coque.b(10.5, 9.8, 0, 3, 0.25, 12, C.rouge);                                            // bande rouge avant
    for(let i = 0; i < 4; i++) coque.b(-10.5 - i*1.5, 9.8, 0, 0.7, 0.3, 8, C.noir);
    coque.b(3.2, 10.6, -6.6, 4, 1.4, 4.2, C.toile);
    const train = geoChenilles(30, 5.0, 4.6, 8.0, 2.5, '#3a3830');
    // tourelle (pivot x -2.5, y 9.7)
    tour.bz(0, 3.1, 0, 12.5, 6.2, 11.5, C.olive, {hl:0.82, hp:0.85, dx:-0.04});
    tour.b(-0.5, 6.3, 0, 10.4, 0.3, 9.9, C.rouge);                                          // toit de tourelle entièrement rouge
    for(const s of [-1, 1]) tour.b(1, 3.6, s*6.4, 5, 3.4, 1.6, C.oliveF);                   // tourillons
    tour.b(-7.6, 3.2, 0, 3, 4.5, 8, C.oliveF);                                              // mât du radar
    tour.b(4.2, 5.8, 3.0, 2.4, 1.2, 2.0, C.oliveC);                                          // radar de poursuite
    tour.cy(5.5, 5.8, 3.0, 0.9, 0.5, C.noir, 'x', 8);
    // bitube (pivot x 1, y 3.6) — deux canons sur les flancs
    for(const s of [-1, 1]){
      canon.b(1.2, 0, s*7.5, 5.5, 2.2, 2.0, C.olive);
      canon.cy(9.0, 0.2, s*7.5, 0.62, 13, C.noir, 'x', 6);
      canon.cy(5.5, 0.2, s*7.5, 0.95, 3.2, C.oliveF, 'x', 8);
      canon.cy(15.3, 0.2, s*7.5, 0.85, 1.4, C.acier, 'x', 8);
    }
    // radar de veille (tourne en continu ; pivot x -7.6, y 6)
    radar.cy(0, 0.6, 0, 0.4, 1.2, C.acier, 'y', 6);
    radar.bz(0, 2.4, 0, 1.4, 3.0, 10, C.oliveC, {hl:0.4, hp:0.95}, 0, 0, 0.2);
    radar.b(0.65, 2.4, 0, 0.15, 2.4, 9.2, C.noir, 0, 0, 0.2);
    radar.b(-0.3, 4.0, 0, 0.6, 0.3, 10.2, C.rouge);
    return {genre:'vehicule', coque:coque.geo(), lum:lum.geo(), train:{type:'chenilles', geo:train}, tourelle:tour.geo(), canon:canon.geo(),
      radar:{geo:radar.geo(), pos:[-7.6, 6, 0]}, pivotT:[-2.5, 9.7, 0], pivotC:[1, 3.6, 0], recul:1.4, elevation:0.75, elevationRepos:0.18,
      l:32, p:21, h:18, poussiere:0.95, fumeeH:12};
  }

  // Rempart (Halden, forme 'antiair') : blindé 8×8 antiaérien. Contrairement à la Sentinelle
  // (chenillée, canons sur les flancs, antenne courbe), canons jumelés rapprochés AU-DESSUS d'un
  // berceau central, radar de veille plat et rectangulaire sur mât, radar de poursuite rond à l'avant.
  function modeleRempart(){
    const C = H, coque = new Piece(), lum = new Piece(), tour = new Piece(), canon = new Piece(), radar = new Piece();
    coque.bz(0, 5.6, 0, 33, 3.6, 12.5, C.acierF, {bp:0.7});                             // coque en V
    coque.bz(0.2, 9.1, 0, 35, 3.6, 17, C.acier, {hl:0.86, dx:-0.05, hp:0.9});            // caisse
    coque.bz(17.2, 6.8, 0, 3.0, 3.4, 13.5, C.acierF, {hl:0.2, dx:-0.4});                 // nez
    for(const s of [-1, 1]){
      for(const x of [-11.5, -4.2, 4.2, 11.5]) coque.bz(x, 7.7, s*8.0, 6.4, 0.9, 3.4, C.acierF, {hl:0.75});   // garde-boue
      coque.b(0, 9.2, s*8.55, 20, 2.2, 0.5, C.acierC);                                  // panneaux latéraux
      coque.b(-12.5, 11.4, s*6.2, 6, 0.9, 2.4, C.acierC);                               // coffres arrière
      coque.b(12.5, 10.6, s*5.8, 3.6, 0.4, 2.0, C.vitre);                               // épiscopes
      lum.b(16.9, 8.7, s*5.6, 0.4, 0.6, 3.0, C.lum);
      lum.b(-17.6, 8.7, s*6.2, 0.3, 0.5, 2.0, FEU.arriere);
      lum.b(-1, 10.95, s*7.6, 26, 0.2, 0.3, C.lum);                                     // liseré lumineux du toit
    }
    coque.b(13.2, 10.95, 0, 2.6, 0.25, 10, C.bleu);                                       // bande bleue avant (dessus)
    coque.b(-14.6, 10.95, 0, 4.4, 0.25, 9, C.bleu);                                       // bande bleue arrière
    coque.cy(-15, 11.5, 6.4, 0.1, 6, C.noir, 'y', 4);                                     // antenne radio
    const roue = geoRoue(3.5, 2.8, C.acierC, C.acierF), roues = [];
    for(const x of [-11.5, -4.2, 4.2, 11.5]) for(const s of [-1, 1]) roues.push([x, 3.5, s*7.7]);
    // tourelle (pivot x -2, y 10.9) : caisse anguleuse, toit bleu, mât du radar de veille à l'arrière
    tour.bz(0, 2.4, 0, 12.5, 4.8, 10.5, C.acier, {hl:0.8, hp:0.82, dx:-0.04});
    tour.b(-0.6, 4.86, 0, 9.0, 0.3, 8.2, C.bleu);                                         // toit bleu (couleur du camp)
    for(const s of [-1, 1]) tour.b(-3, 2.4, s*5.6, 5, 3.4, 1.0, C.acierC);               // caissons à munitions
    tour.b(-6.8, 6.4, 0, 1.6, 3.6, 1.6, C.acierF);                                        // mât
    tour.cy(5.6, 3.6, 0, 1.5, 0.7, C.acierF, 'x', 12);                                    // radar de poursuite (rond)
    tour.cy(6.0, 3.6, 0, 1.15, 0.2, C.noir, 'x', 12);
    tour.b(-1.5, 5.6, -3.3, 2.2, 1.4, 2.0, C.acierF);                                     // viseur optronique
    tour.b(-0.35, 5.6, -3.3, 0.15, 0.8, 1.3, C.lum);
    // berceau et canons jumelés (pivot x 1.5, y 5.2 du repère tourelle)
    canon.b(0, 0, 0, 4.4, 2.6, 5.6, C.acierF);
    canon.b(0.2, 1.35, 0, 3.6, 0.2, 4.6, C.bleu);
    for(const s of [-1, 1]){
      canon.cy(3.6, 0.3, s*1.5, 0.95, 4.2, C.acier, 'x', 8);                             // manchons
      canon.cy(8.8, 0.3, s*1.5, 0.48, 11, C.noir, 'x', 6);                               // tubes
      canon.cy(14.5, 0.3, s*1.5, 0.66, 1.3, C.acierF, 'x', 8);                           // freins de bouche
    }
    // radar de veille plat (tourne en continu ; pivot x -6.8, y 8.2 du repère tourelle)
    radar.cy(0, 0.3, 0, 0.45, 0.6, C.acier, 'y', 6);
    radar.b(0, 2.1, 0, 0.7, 3.0, 9.4, C.acierC, 0, 0, 0.18);
    radar.b(0.4, 2.1, 0, 0.1, 2.6, 8.8, C.noir, 0, 0, 0.18);
    radar.b(-0.25, 3.7, 0, 0.5, 0.3, 9.6, C.bleu);
    return {genre:'vehicule', coque:coque.geo(), lum:lum.geo(), train:{type:'roues', geo:roue, pos:roues, r:3.5}, tourelle:tour.geo(), canon:canon.geo(),
      radar:{geo:radar.geo(), pos:[-6.8, 8.2, 0]}, pivotT:[-2, 10.9, 0], pivotC:[1.5, 5.2, 0], recul:1.0, elevation:0.8, elevationRepos:0.22,
      l:36, p:18, h:19, poussiere:0.9, fumeeH:11};
  }

  // Faucheur (Halden) : drone quadrirotor d'attaque.
  function modeleFaucheur(){
    const C = H, corps = new Piece(), lum = new Piece(), flou = new Piece();
    corps.bz(0, 0, 0, 11, 2.8, 5.6, C.acier, {hl:0.7, hp:0.75, bl:0.85, bp:0.85});    // fuselage
    corps.bz(4.9, -0.1, 0, 3.2, 2.2, 4.4, C.acierF, {hl:0.4, dx:-0.3, bl:0.6});        // nez
    corps.b(-0.5, 1.5, 0, 6.5, 0.35, 3.4, C.bleu);                                     // dos bleu (accent)
    corps.b(-4.5, 1.2, 0, 2.2, 0.6, 2.2, C.acierF);
    corps.sp(4.3, -1.6, 0, 1.2, 1.2, 1.2, C.noir, 1);                                   // boule optronique
    corps.b(5.35, -1.6, 0, 0.3, 0.6, 0.6, C.lum);
    for(const s of [-1, 1]){
      corps.cy(0.5, -1.9, s*2.6, 0.55, 6, C.acierC, 'x', 6);                          // roquettes / missiles
      corps.cy(3.8, -1.9, s*2.6, 0.55, 0.8, '#ff5a3c', 'x', 6, 0.2);
      corps.seg(-3, -1.4, s*1.6, -3.2, -3.6, s*2.6, 0.4, C.noir);                      // patins
      corps.seg(3, -1.4, s*1.6, 3.2, -3.6, s*2.6, 0.4, C.noir);
      corps.b(0, -3.6, s*2.65, 8.5, 0.4, 0.5, C.noir);
    }
    const moteurs = [];
    for(const sx of [-1, 1]) for(const sz of [-1, 1]){
      const mx = sx*6.2, mz = sz*6.2;
      corps.seg(sx*1.5, 0.3, sz*1.5, mx, 0.6, mz, 1.1, C.acierF, 0.7);                 // bras
      corps.cy(mx, 0.9, mz, 1.0, 1.6, C.acier, 'y', 8);                                 // nacelle moteur
      corps.cy(mx, 1.8, mz, 0.35, 0.6, C.noir, 'y', 6);
      lum.cy(mx, 0.0, mz, 0.5, 0.5, sx > 0 ? C.lum : '#ff5a3c', 'y', 6);                // feux de navigation
      flou.g(new THREE.CircleGeometry(4.0, 20), '#ffffff', matrice(mx, 2.15, mz, -Math.PI/2, 0, 0, 1, 1, 1));
      moteurs.push([mx, 2.1, mz]);
    }
    const pale = new Piece();
    pale.b(0, 0, 0, 7.8, 0.22, 0.9, C.noir); pale.b(0, 0, 0, 0.9, 0.24, 0.9, C.acierC);
    return {genre:'drone', corps:corps.geo(), lum:lum.geo(), flou:flou.geo(), pale:pale.geo(), moteurs, l:20, p:20, h:9};
  }

  // ---------- 4.c Camion-citerne (convoi d'eau) ----------
  // Camion civil 6 roues : cabine avancée, citerne cylindrique couchée, passerelle,
  // gyrophares. Palette selon le camp : Régie des eaux (blanc, bande bleue, logo
  // goutte), Halden (acier, bleu) ou Karsk (olive, rouge).
  const PALETTES_CAMION = {
    neutre:{caisse:'#e8eef2', cabine:'#e8eef2', toit:'#2f7fc1', bande:'#2f7fc1', cerclage:'#5d7380', chassis:'#3b4a54',
      jante:'#aab6bf', rayon:'#5d7380', logo:'#2f7fc1', fond:'#ffffff', gris:'#aab6bf', vitre:'#1a2a38', noir:'#1c2126', gyro:'#ffb340'},
    halden:{caisse:H.acierC, cabine:H.acier, toit:H.bleu, bande:H.bleu, cerclage:H.acierF, chassis:H.noir,
      jante:H.acierC, rayon:H.acierF, logo:H.bleu, fond:H.clair, gris:H.clair, vitre:H.vitre, noir:H.noir, gyro:H.lum},
    karsk:{caisse:K.oliveC, cabine:K.olive, toit:K.rouge, bande:K.rouge, cerclage:K.oliveF, chassis:K.acier,
      jante:K.oliveC, rayon:K.oliveF, logo:K.rouge, fond:K.sac, gris:K.sac, vitre:K.vitre, noir:K.noir, gyro:'#ffb340'},
  };
  // Goutte (logo inventé de la Régie) : sphère + cône aplatis.
  // normale 'z' (flanc, s = +1 / -1) ou 'y' (posée à plat, pointe vers l'avant +X).
  function goutte(P, x, y, z, t, coul, normale, s){
    if(normale === 'y'){
      P.sp(x, y, z, t, 0.3, t, coul, 2);
      P.g(geoCyl(10, 0), coul, matrice(x + t*1.2, y, z, -Math.PI/2, 0, -Math.PI/2, t*0.92, t*1.6, 0.3));
    } else {
      P.sp(x, y, z, t, t, 0.3, coul, 2);
      P.g(geoCyl(10, 0), coul, matrice(x, y + t*1.2, z + (s || 1)*0.01, 0, 0, 0, t*0.92, t*1.6, 0.3));
    }
  }
  function modeleCamion(faction){
    const C = PALETTES_CAMION[faction] || PALETTES_CAMION.halden;
    const coque = new Piece(), lum = new Piece(), gyro = new Piece(), tour = new Piece(), canon = new Piece();
    // châssis, pare-chocs
    coque.b(0, 4.6, 0, 35, 1.6, 7, C.chassis);
    coque.b(17.6, 5.4, 0, 1.2, 1.8, 15, C.noir);
    coque.b(-17.5, 5.0, 0, 1.0, 1.4, 14, C.noir);
    // cabine avancée
    coque.bz(13, 9.2, 0, 8.5, 8.4, 14, C.cabine, {hl:0.82, dx:-0.09, hp:0.95});
    coque.bz(16.9, 10.8, 0, 0.8, 3.4, 12.2, C.vitre, {hl:0.4, dx:-0.6});            // pare-brise
    coque.b(12.6, 13.5, 0, 6.6, 0.3, 13, C.toit);                                    // toit de cabine (lisible d'en haut)
    goutte(coque, 11.8, 13.72, 0, 1.6, C.fond, 'y');                                 // logo sur le toit
    coque.b(17.35, 7.6, 0, 0.4, 2.4, 8, C.gris);                                     // calandre
    for(const s of [-1, 1]){
      coque.b(13.6, 10.9, s*7.0, 4.2, 2.6, 0.2, C.vitre);                            // vitres latérales
      coque.b(16.2, 11.0, s*7.4, 0.5, 1.6, 0.9, C.noir);                             // rétroviseurs
      coque.bz(12.5, 6.9, s*7.3, 7.4, 1.0, 1.8, C.chassis, {hl:0.7});                // garde-boue avant
      coque.b(-9.5, 6.9, s*7.3, 12, 0.8, 1.8, C.chassis);                            // garde-boue arrière
      coque.b(2.5, 6.5, s*6.6, 6, 2.2, 1.4, C.cerclage);                             // coffre à flexibles
      lum.b(17.45, 7.2, s*5.6, 0.4, 1.0, 1.8, '#f2e6b0');                            // phares
      lum.b(-18.05, 6.0, s*5.5, 0.3, 0.8, 1.6, '#ff5a3c');                           // feux arrière
      gyro.b(15.0, 13.95, s*4.6, 1.2, 0.9, 1.2, C.gyro);                             // gyrophares (clignotent)
    }
    // citerne : berceau, selles, corps cylindrique, fonds bombés
    coque.b(-5, 6.0, 0, 24, 1.2, 9, C.cerclage);
    for(const x of [-13, -5, 3]) coque.b(x, 7.0, 0, 1.2, 2.4, 10.5, C.chassis);
    coque.cy(-5, 11.2, 0, 5.6, 23, C.caisse, 'x', 18);
    coque.sp(6.5, 11.2, 0, 1.4, 5.6, 5.6, C.caisse, 2);
    coque.sp(-16.5, 11.2, 0, 1.4, 5.6, 5.6, C.caisse, 2);
    for(const x of [-14, 4]) coque.cy(x, 11.2, 0, 5.75, 0.8, C.cerclage, 'x', 18);  // cerclages
    for(const s of [-1, 1]){
      coque.b(-5, 11.2, s*5.62, 21, 1.5, 0.3, C.bande);                              // bande latérale
      coque.cy(-5, 11.2, s*5.66, 2.4, 0.3, C.fond, 'z', 16);                         // médaillon
      goutte(coque, -5, 10.5, s*5.86, 1.0, C.logo, 'z', s);                          // logo goutte
    }
    coque.cy(-17.9, 7.6, 0, 0.8, 1.6, C.cerclage, 'x', 8);                            // vanne de vidange
    for(let i = 0; i < 4; i++) coque.b(-18.0, 8.5 + i*1.6, 3.6, 0.3, 0.25, 1.8, C.gris);   // échelle arrière
    // roues 6×4
    const roue = geoRoue(3.6, 2.6, C.jante, C.rayon);
    const roues = [];
    for(const x of [12.5, -7, -12.2]) for(const s of [-1, 1]) roues.push([x, 3.6, s*7.0]);
    // dessus de citerne (pivot x -5, y 16.8) : trous d'homme, passerelle, garde-corps
    for(const x of [-6, 0, 6]){ tour.cy(x, 0.1, 0, 1.4, 0.6, C.cerclage, 'y', 10); tour.cy(x, 0.45, 0, 0.9, 0.2, C.gris, 'y', 10); }
    tour.b(0, -0.25, -2.4, 18, 0.3, 1.6, C.gris);
    tour.b(0, 1.4, -3.1, 18, 0.25, 0.25, C.gris);
    for(const x of [-8.6, 0, 8.6]) tour.b(x, 0.6, -3.1, 0.25, 1.6, 0.25, C.gris);
    // dévidoir de flexible à l'avant de la citerne (pivot x 10.5, y -1)
    canon.cy(0, 0, 0, 1.2, 4, C.noir, 'z', 10);
    canon.cy(0, 0, 0, 1.35, 0.3, C.cerclage, 'z', 10);
    return {genre:'vehicule', sansArme:true, coque:coque.geo(), lum:lum.geo(), gyro:gyro.geo(), train:{type:'roues', geo:roue, pos:roues, r:3.6},
      tourelle:tour.geo(), canon:canon.geo(), pivotT:[-5, 16.8, 0], pivotC:[10.5, -1, 0], recul:0, l:36, p:16, h:17, poussiere:1.0, fumeeH:12,
      matK:faction === 'karsk'};
  }

  // ---------- 4.c bis Collecteur (récolte des champs de minerai) ----------
  // Véhicule 6×6 sans arme : cabine décalée à gauche, capot moteur à droite, grande benne
  // ouverte à l'arrière (chargement visible), bras articulé à l'avant terminé par un tambour
  // de fraisage denté, gyrophare ambre. Livrées : Halden (acier, bleu), Karsk (olive, rouge),
  // neutre (dérivée de la livrée Halden par neutraliserModele).
  // M.charge : tas de cristaux (origine au fond de la benne), mis à l'échelle en Y selon u.charge.
  function modeleCollecteur(faction){
    const C = faction === 'karsk'
      ? {chassis:K.oliveF, caisse:K.olive, cabine:K.oliveC, accent:K.rouge, accentF:K.rougeF, vitre:K.vitre, noir:K.noir, metal:K.acier, jante:K.oliveC}
      : {chassis:H.acierF, caisse:H.acier, cabine:H.acierC, accent:H.bleu, accentF:H.bleuF, vitre:H.vitre, noir:H.noir, metal:H.acierF, jante:H.clair};
    const coque = new Piece(), lum = new Piece(), gyro = new Piece(), tour = new Piece(), bras = new Piece(), tas = new Piece();
    // châssis, pare-chocs
    coque.b(-1, 4.8, 0, 34, 1.8, 9, C.chassis);
    coque.b(16.2, 5.6, 0, 1.4, 2.2, 15, C.noir);
    coque.b(-18.2, 5.2, 0, 1.0, 1.6, 14, C.noir);
    // cabine à gauche (z < 0), capot moteur à droite
    coque.bz(9.5, 9.7, -3.4, 7.5, 7.6, 7.6, C.cabine, {hl:0.84, dx:-0.1, hp:0.92});
    coque.bz(13.1, 10.9, -3.4, 0.6, 3.6, 6.4, C.vitre, {hl:0.5, dx:-0.6});    // pare-brise
    coque.b(9.3, 13.6, -3.4, 5.6, 0.35, 7.0, C.accent);             // toit de cabine (accent, lisible d'en haut)
    coque.b(9.6, 11.2, -7.25, 4.4, 2.4, 0.2, C.vitre);                        // vitre latérale
    coque.bz(10, 7.9, 3.9, 8.5, 4.2, 6.6, C.caisse, {hl:0.86, hp:0.9});       // capot moteur
    for(let i = 0; i < 4; i++) coque.b(8.4 + i*1.3, 10.05, 3.9, 0.6, 0.2, 5.2, C.noir);   // grille
    coque.cy(6.6, 12.6, 6.3, 0.45, 5.2, C.noir, 'y', 6);                       // échappement
    coque.cy(6.6, 15.3, 6.3, 0.55, 0.5, C.metal, 'y', 6);
    for(const s of [-1, 1]){
      coque.bz(9.5, 6.9, s*7.4, 7.6, 1.0, 1.8, C.chassis, {hl:0.7});          // garde-boue avant
      coque.b(-9.8, 6.4, s*7.4, 14, 0.7, 1.8, C.chassis);                      // garde-boue arrière
      lum.b(16.95, 7.6, s*5.6, 0.3, 1.0, 1.8, FEU.phare);                       // phares
      lum.b(-18.75, 6.0, s*5.6, 0.3, 0.8, 1.6, FEU.arriere);                   // feux arrière
    }
    // benne ouverte : fond, parois, rebord accent, nervures
    const xb = -7.6, Lb = 18.6, yF = 7.4, Hp = 6.4;
    coque.b(xb, yF - 0.4, 0, Lb, 0.8, 15, C.caisse);
    for(const s of [-1, 1]){
      coque.b(xb, yF + Hp/2, s*7.1, Lb, Hp, 0.8, C.caisse);
      coque.b(xb, yF + Hp + 0.2, s*7.1, Lb + 0.4, 0.5, 1.2, C.accent);
      for(let i = 0; i < 5; i++) coque.b(xb - Lb/2 + 1.6 + i*(Lb - 3.2)/4, yF + Hp/2, s*7.65, 0.6, Hp, 0.4, C.chassis);
      coque.b(xb, yF + 1.4, s*7.6, Lb, 0.6, 0.3, C.accentF);
    }
    coque.b(xb + Lb/2, yF + Hp/2 + 0.5, 0, 0.8, Hp + 1, 15, C.caisse);      // paroi avant (garde-cabine)
    coque.b(xb - Lb/2, yF + Hp/2, 0, 0.8, Hp, 15, C.caisse);                 // hayon
    coque.b(xb - Lb/2 - 0.5, yF + Hp - 0.6, 0, 0.3, 0.5, 13, C.accent);
    for(let i = 0; i < 4; i++) coque.b(xb - Lb/2 - 0.5, 6.2 + i*1.5, -5.4, 0.25, 0.25, 1.6, C.metal);   // échelle
    // roues 6×6
    const roue = geoRoue(3.5, 2.8, C.jante, C.metal);
    const roues = [];
    for(const x of [9.5, -6.2, -13.4]) for(const s of [-1, 1]) roues.push([x, 3.5, s*7.4]);
    // gyrophare sur la cabine (clignote) + son socle
    coque.b(9.5, 13.95, -3.4, 1.8, 0.4, 1.8, C.noir);
    gyro.cy(9.5, 14.7, -3.4, 0.75, 1.1, FEU.ambre, 'y', 8);
    // support du bras (pivot de « tourelle » fixe : x 15, y 7.4)
    tour.b(0, 0, 0, 2.6, 2.4, 9.5, C.chassis);
    for(const s of [-1, 1]) tour.b(0.4, 0.6, s*4.0, 2.0, 3.2, 1.0, C.metal);
    // bras de collecte (pivot x 1, y 0.6) : deux longerons, vérin, tambour denté sous capot
    for(const s of [-1, 1]){
      bras.seg(0, 0, s*3.6, 6.4, -3.6, s*3.6, 1.2, C.caisse, 1.0);
      bras.seg(-0.6, 1.4, s*2.4, 3.6, -1.2, s*2.4, 0.55, C.noir);             // vérins
      bras.b(6.9, -3.9, s*5.6, 1.6, 2.8, 0.5, C.accent);                       // flasques (accent)
    }
    bras.cy(6.9, -3.9, 0, 2.0, 11, C.metal, 'z', 12);                         // tambour
    for(let k = 0; k < 8; k++){
      const a = k*Math.PI/4;
      for(let j = -2; j <= 2; j++) bras.b(6.9 + Math.cos(a)*2.05, -3.9 + Math.sin(a)*2.05, j*2.1 + (k%2)*0.8, 0.55, 0.55, 0.9, C.noir, 0, 0, a);
    }
    bras.bz(6.4, -1.4, 0, 4.6, 1.0, 11.6, C.caisse, {hl:0.8, hp:0.9});        // capot du tambour
    bras.b(5.0, -0.85, 0, 1.6, 0.2, 9.0, C.accent);
    // chargement : fond plat + cristaux de sel (blanc) et de lithium (rosé), plus hauts au centre
    const coul = ['#e9f1f4', '#d6e8ef', '#f3dbe4', '#c9dde6'];
    tas.matiere(0.25, 0.05);
    tas.b(0, 0.6, 0, Lb - 1.2, 1.2, 13.2, '#cfdde3');
    let s = 977;
    const rnd = () => { s = (s*16807) % 2147483647; return (s % 1000)/1000; };
    for(let i = 0; i < 46; i++){
      const x = (rnd() - 0.5)*(Lb - 3), z = (rnd() - 0.5)*11.6;
      const bombe = 1 - 0.55*Math.min(1, Math.hypot(x/(Lb/2), z/6.5));
      const h = (1.6 + rnd()*2.6)*bombe + 1.2, r = 0.7 + rnd()*0.7;
      tas.g(geoCyl(5, 0.15), coul[i % 4], matrice(x, h/2, z, (rnd() - 0.5)*0.6, rnd()*3, (rnd() - 0.5)*0.6, r, h, r));
    }
    return {genre:'vehicule', sansArme:true, collecteur:true, coque:coque.geo(), lum:lum.geo(), gyro:gyro.geo(),
      train:{type:'roues', geo:roue, pos:roues, r:3.5}, tourelle:tour.geo(), canon:bras.geo(), charge:tas.geo(), yCharge:yF,
      pivotT:[15, 7.4, 0], pivotC:[1, 0.6, 0], recul:0, l:40, p:17, h:16, poussiere:1.1, fumeeH:12, matK:faction === 'karsk'};
  }

  // ---------- 4.c ter Véhicules de dépannage (forme 'atelier', rôle réparateur) ----------
  // Tourelle = couronne de grue ; canon = flèche (repère : pivot de la flèche, flèche vers +X).
  // Au repos la flèche est dans l'axe (reposT : angle relatif), elle se lève (elevSoin) et se tourne
  // vers la cible pendant une réparation. M.soin.bout : crochet, dans le repère de la flèche.
  // Atelier (Halden) : camion 6×6 à cabine avancée, plateau à coffres d'outillage, grue couchée
  // vers l'arrière au-dessus du plateau.
  function modeleAtelier(){
    const C = H, coque = new Piece(), lum = new Piece(), gyro = new Piece(), tour = new Piece(), fleche = new Piece();
    coque.b(0, 4.6, 0, 34, 1.6, 7, C.noir);                                              // châssis
    coque.b(17.4, 5.4, 0, 1.2, 1.8, 15, C.noir);                                         // pare-chocs
    coque.bz(12.6, 9.1, 0, 8.4, 8.2, 14, C.acier, {hl:0.82, dx:-0.09, hp:0.95});         // cabine
    coque.bz(16.6, 10.6, 0, 0.8, 3.2, 12.2, C.vitre, {hl:0.4, dx:-0.6});                 // pare-brise
    coque.b(12.2, 13.35, 0, 6.4, 0.3, 12.8, C.bleu);                                     // toit bleu
    coque.b(-5, 6.7, 0, 24, 1.2, 14.5, C.acierF);                                        // plateau
    for(const s of [-1, 1]){
      coque.b(13.4, 10.8, s*7.0, 4.0, 2.4, 0.2, C.vitre);                                // vitres latérales
      coque.b(-3.5, 9.2, s*6.1, 15, 3.8, 2.4, C.acierC);                                 // coffres à outils
      coque.b(-3.5, 11.2, s*6.1, 15.2, 0.35, 2.5, C.bleu);                               // bande bleue (dessus)
      for(let i = 0; i < 3; i++) coque.b(-9 + i*5.5, 9.2, s*7.33, 0.25, 3.2, 0.1, C.acierF);   // portes de coffre
      coque.bz(12.5, 6.9, s*7.3, 7.4, 1.0, 1.8, C.noir, {hl:0.7});                       // garde-boue
      coque.b(-9.3, 6.9, s*7.3, 12, 0.8, 1.8, C.noir);
      coque.b(-16.2, 5.0, s*7.6, 1.8, 1.4, 2.6, C.acierF);                               // stabilisateurs
      lum.b(17.45, 7.4, s*5.6, 0.4, 1.0, 1.8, FEU.phare);
      lum.b(-17.55, 6.2, s*5.5, 0.3, 0.8, 1.6, FEU.arriere);
      coque.b(15.0, 13.7, s*4.2, 1.4, 0.4, 1.4, C.noir);
      gyro.b(15.0, 14.2, s*4.2, 1.1, 0.8, 1.1, FEU.ambre);                               // gyrophares (pendant la réparation)
    }
    coque.cy(-15.8, 9.0, 0, 3.0, 1.4, H.pneu, 'z', 12);                                  // roue de secours
    coque.cy(-15.8, 9.0, 0, 1.5, 1.6, C.acierC, 'z', 8);
    const roue = geoRoue(3.6, 2.6, C.acierC, C.acierF), roues = [];
    for(const x of [12.5, -6, -12.5]) for(const s of [-1, 1]) roues.push([x, 3.6, s*7.0]);
    // couronne (pivot x 4, y 7.3), juste derrière la cabine
    tour.cy(0, 0.6, 0, 3.4, 1.2, C.acierF, 'y', 12);
    tour.b(0, 2.6, 0, 4.4, 3.0, 4.6, C.acier);
    tour.b(0, 4.15, 0, 3.6, 0.3, 3.8, C.bleu);
    tour.b(-1.2, 2.2, 2.9, 2.0, 2.0, 1.2, C.acierF);                                     // pupitre de commande
    // flèche (pivot x 0.5, y 3.6) : caisson, rallonge, vérin, câble et crochet
    fleche.b(7.5, 0, 0, 15.5, 1.9, 1.8, C.acierC);
    fleche.b(3.5, 0.98, 0, 4, 0.12, 1.85, C.bleu);
    fleche.b(16.2, 0, 0, 3.2, 1.3, 1.3, C.acier);
    fleche.seg(1.0, -1.6, 0, 6.5, -0.5, 0, 0.8, C.noir);
    fleche.b(17.4, -1.9, 0, 0.14, 3.0, 0.14, C.noir);
    fleche.b(17.4, -3.7, 0, 0.9, 0.9, 0.5, C.acierF);
    fleche.b(17.4, -4.3, 0, 0.3, 0.6, 0.3, C.noir);
    return {genre:'vehicule', sansArme:true, reparateur:true, coque:coque.geo(), lum:lum.geo(), gyro:gyro.geo(),
      train:{type:'roues', geo:roue, pos:roues, r:3.6}, tourelle:tour.geo(), canon:fleche.geo(),
      pivotT:[4, 7.3, 0], pivotC:[0.5, 3.6, 0], recul:0, reposT:Math.PI, elevationRepos:0.1, elevSoin:0.5,
      l:36, p:16, h:16, poussiere:1.0, fumeeH:11, soin:effetsSoin('soudure', {ancre:'canon', p:[17.4, -4.7, 0]})};
  }
  // Dépanneuse (Karsk) : camion à capot long, cabine rouge sur le toit, lourd contrepoids, grue
  // de relevage tournée vers l'arrière au repos, crochet de remorquage.
  function modeleDepanneuse(){
    const C = K, coque = new Piece(), lum = new Piece(), gyro = new Piece(), tour = new Piece(), fleche = new Piece();
    coque.b(0, 4.8, 0, 36, 1.8, 7.5, C.acier);
    coque.b(18.4, 5.6, 0, 1.4, 2.0, 15, C.noir);
    coque.bz(14.6, 7.9, 0, 6.6, 4.0, 11.5, C.olive, {hl:0.88, hp:0.9});                  // capot moteur
    for(let i = 0; i < 4; i++) coque.b(17.9, 7.4 + i*0.8, 0, 0.3, 0.35, 7, C.noir);      // calandre
    coque.bz(8.2, 10.0, 0, 7.2, 7.8, 14.5, C.olive, {hl:0.84, dx:-0.06, hp:0.95});       // cabine
    coque.bz(11.6, 11.3, 0, 0.7, 3.0, 12.6, C.vitre, {hl:0.4, dx:-0.6});
    coque.b(7.8, 14.05, 0, 5.8, 0.3, 13.6, C.rouge);                                     // toit rouge
    coque.b(-6, 7.0, 0, 21, 1.4, 14.5, C.oliveF);                                         // plateau
    coque.b(1.6, 9.6, 0, 3.0, 3.8, 14, C.oliveC);                                         // contrepoids / coffre avant
    coque.b(1.6, 11.6, 0, 3.1, 0.3, 14.1, C.rouge);
    for(const s of [-1, 1]){
      coque.b(8.6, 11.7, s*7.3, 3.8, 2.2, 0.2, C.vitre);
      coque.bz(14.4, 6.9, s*6.9, 6.4, 1.2, 1.8, C.oliveF, {hl:0.7});
      coque.b(-8, 6.6, s*7.4, 16, 0.9, 1.8, C.oliveF);
      coque.b(-6, 8.6, s*6.6, 9, 2.0, 1.4, C.oliveC);                                    // coffres latéraux
      coque.b(-6, 8.3, s*7.35, 2.0, 2.4, 0.4, C.toile);                                  // jerricans
      coque.seg(-17.5, 6.0, s*3.2, -19.4, 4.4, s*1.0, 0.6, C.acier);                      // barre de remorquage
      lum.b(18.05, 8.4, s*4.8, 0.3, 1.0, 1.4, FEU.phare);
      lum.b(-17.4, 7.6, s*6.4, 0.3, 0.7, 1.4, FEU.arriere);
      gyro.b(8.0, 14.6, s*4.6, 1.1, 0.8, 1.1, FEU.ambre);
    }
    coque.b(-19.6, 4.4, 0, 1.0, 1.2, 3.4, C.acier);                                       // crochet de remorquage
    coque.cy(-3.0, 9.3, 0, 2.6, 1.2, K.pneu, 'z', 12);                                    // roue de secours couchée
    const roue = geoRoue(3.9, 3.0, C.oliveC, C.oliveF), roues = [];
    for(const x of [13.6, -7.5, -13.8]) for(const s of [-1, 1]) roues.push([x, 3.9, s*7.2]);
    // couronne (pivot x -11, y 7.7)
    tour.cy(0, 0.7, 0, 3.8, 1.4, C.acier, 'y', 12);
    tour.bz(0, 3.0, 0, 5.4, 3.4, 5.6, C.olive, {hl:0.8, hp:0.85});
    tour.b(0, 4.8, 0, 4.2, 0.3, 4.4, C.rouge);
    // flèche (pivot x 1, y 3.4) : poutre en A à deux longerons, poulie, crochet lourd
    for(const s of [-1, 1]) fleche.seg(0, 0, s*1.6, 13.5, 0.6, s*0.5, 1.4, C.oliveC, 1.0);
    fleche.b(6.5, 0.9, 0, 5, 0.25, 3.2, C.rouge);
    fleche.cy(14.0, 0.5, 0, 1.0, 1.6, C.acier, 'z', 10);                                  // poulie
    fleche.seg(1.6, -1.8, 0, 7.5, -0.2, 0, 1.0, C.noir);                                  // vérin
    fleche.b(14.4, -1.8, 0, 0.18, 4.0, 0.18, C.noir);
    fleche.b(14.4, -4.2, 0, 1.2, 1.1, 0.7, C.acier);
    fleche.b(14.4, -5.0, 0, 0.4, 0.8, 0.4, C.noir);
    return {genre:'vehicule', sansArme:true, reparateur:true, matK:true, coque:coque.geo(), lum:lum.geo(), gyro:gyro.geo(),
      train:{type:'roues', geo:roue, pos:roues, r:3.9}, tourelle:tour.geo(), canon:fleche.geo(),
      pivotT:[-11, 7.7, 0], pivotC:[1, 3.4, 0], recul:0, reposT:Math.PI, elevationRepos:0.22, elevSoin:0.55,
      l:39, p:16, h:16, poussiere:1.1, fumeeH:12, soin:effetsSoin('soudure', {ancre:'canon', p:[14.4, -5.4, 0]})};
  }

  // ---------- 4.d Avions ----------
  // Trois appareils réels demandés par le propriétaire du projet : silhouettes reconnaissables,
  // mais AUCUNE marque nationale (ni cocarde, ni étoile, ni drapeau) — livrées aux couleurs des
  // camps du jeu. Échelle : envergure d'environ 30 unités, cohérente avec les chars du jeu.
  // Repère : l'axe du fuselage est à y = 0 ; au sol, cet axe est à M.yAxe au-dessus des roues.
  function livreeAvion(faction){
    return faction === 'karsk'
      ? {dessus:K.olive, dessus2:K.oliveF, ventre:'#98a184', nez:'#3a4532', accent:K.rouge, metal:'#2e2d28', sombre:K.noir,
         verre:'#2b2414', verreOr:'#3a2f16', arme:'#c4c9b4', jambe:'#9a9a8c', lum:'#ffb36b', flamme:'#ff8a3c'}
      : {dessus:'#66737f', dessus2:'#4b5661', ventre:'#a3afb9', nez:'#39434c', accent:H.bleu, metal:'#2b3138', sombre:H.noir,
         verre:'#152430', verreOr:'#3a2f16', arme:'#e2e7eb', jambe:'#c5ccd2', lum:H.lum, flamme:'#ff8a3c'};
  }
  matieres(0.5,  0.3,  ['#66737f', '#4b5661', '#a3afb9', '#39434c']);     // peinture satinée des avions Halden
  matieres(0.74, 0.05, ['#98a184', '#3a4532']);                           // peinture mate des avions Karsk
  matieres(0.3,  0.9,  ['#2e2d28', '#2b3138']);                           // tuyères
  matieres(0.05, 0.95, ['#2b2414', '#152430', '#3a2f16']);                // verrières teintées
  matieres(0.4,  0.5,  ['#c4c9b4', '#e2e7eb', '#9a9a8c', '#c5ccd2']);      // missiles, jambes de train

  // Géométries communes aux livrées d'un même appareil (flammes, éclair de tir) : une par clé.
  const communes = {};
  function commune(cle, fabrique){ return communes[cle] || (communes[cle] = fabrique()); }

  // Missile sous voilure : corps, ogive, empennages en croix.
  function missile(P, x, y, z, L, r, V){
    P.cy(x, y, z, r, L, V.arme, 'x', 6);
    P.cy(x + L/2 + r*1.4, y, z, r, r*2.8, V.arme, 'x', 6, 0.08);
    P.b(x - L/2 + 0.7, y, z, 1.3, r*4.4, 0.12, V.dessus2); P.b(x - L/2 + 0.7, y, z, 1.3, 0.12, r*4.4, V.dessus2);
    P.b(x + L*0.2, y, z, 0.9, r*3.2, 0.1, V.dessus2); P.b(x + L*0.2, y, z, 0.9, 0.1, r*3.2, V.dessus2);
  }
  // Train d'atterrissage (repère : y = 0 au point d'attache, vers le bas ; l'ancre est écrasée en Y
  // pour le rentrer). jambes : [x, z, longueur jusqu'au sol, rayon de roue, roues jumelées].
  function geoTrain(jambes, V){
    const P = new Piece();
    for(const [x, z, L, r, jumelees] of jambes){
      const yR = -(L - r);
      P.cy(x, yR/2, z, 0.3, -yR, V.jambe, 'y', 6);                                         // jambe
      P.seg(x - 1.5, -0.1, z, x, yR*0.62, z, 0.22, V.jambe);                               // contrefiche
      P.b(x + 0.4, -0.75, z + (z < 0 ? 0.8 : -0.8), 2.6, 1.5, 0.12, V.dessus2);            // trappe ouverte
      for(const d of (jumelees ? [-0.42, 0.42] : [0])){
        P.cy(x, yR, z + d, r, 0.55, H.pneu, 'z', 10);
        P.cy(x, yR, z + d, r*0.45, 0.62, V.jambe, 'z', 6);
      }
    }
    return P.geo();
  }
  // Feu des tuyères (repère : x = 0 au plan de sortie ; tuyeres : [y, z, rayon]). Matériau additif :
  // le noir est invisible, la teinte s'éteint donc vers la pointe du dard de flamme. L'ancre est
  // étirée en X selon les gaz ; le disque incandescent, lui, reste au fond de la tuyère.
  const CONE_FLAMME = new THREE.ConeGeometry(1, 1, 10, 1, true);
  function geoFeu(tuyeres, ext, coeur, L){
    const P = new Piece();
    for(const [y, z, r] of tuyeres){
      P.g(new THREE.CircleGeometry(r*0.9, 12), coeur, matrice(-0.08, y, z, 0, -Math.PI/2, 0, 1, 1, 1));
      P.g(CONE_FLAMME, ext, matrice(-L/2, y, z, 0, 0, Math.PI/2, r*0.82, L, r*0.82));
      P.g(CONE_FLAMME, coeur, matrice(-L*0.28, y, z, 0, 0, Math.PI/2, r*0.45, L*0.56, r*0.45));
    }
    const g = P.geo(), p = g.attributes.position.array, c = g.attributes.color.array;
    for(let i = 0; i < p.length; i += 3){ const k = Math.pow(bornes(1 + p[i]/L, 0, 1), 1.6); c[i] *= k; c[i+1] *= k; c[i+2] *= k; }
    return g;
  }
  // Éclair de départ de missile / de tir (additif) : cœur clair et deux lames croisées vers l'avant.
  function geoEclair(t, coeur, lame){
    const P = new Piece();
    P.sp(0, 0, 0, t*0.5, t*0.5, t*0.5, coeur || '#fff0c0', 1);
    P.b(t*0.7, 0, 0, t*2.6, 0.14, t*0.9, lame || '#ff9c4a'); P.b(t*0.7, 0, 0, t*2.6, t*0.9, 0.14, lame || '#ff9c4a');
    return P.geo();
  }

  // F-15 : grand biréacteur à aile haute en flèche, entrées d'air en caisson, deux dérives verticales.
  function modeleF15(faction){
    const V = livreeAvion(faction), P = new Piece(), lum = new Piece();
    const rond = profilEllipse(6, 2.3), plat = profilEllipse(6, 3.6);
    // radôme et fuselage avant
    P.coque([
      {x:23.2, y:-0.55, l:0.1, h:0.1, c:V.nez, v:V.nez}, {x:21.6, y:-0.5, l:0.62, h:0.62, c:V.nez, v:V.nez},
      {x:19.4, y:-0.4, l:1.15, h:1.18, c:V.nez, v:V.nez}, {x:17.6, y:-0.3, l:1.5, h:1.55, c:V.nez, v:V.nez},
      {x:17.5, y:-0.3, l:1.52, h:1.57}, {x:14.0, y:0.0, l:1.95, h:2.1, b:2.0}, {x:9.5, y:0.2, l:2.25, h:2.35, b:2.3},
      {x:5.0, y:0.3, l:2.4, h:2.2, b:2.4}, {x:1.0, y:0.3, l:2.5, h:1.9, b:2.4},
    ], {profil:rond, lisse:true, dessus:V.dessus, ventre:V.ventre});
    // fuselage central et arrière : large et plat, entre les deux réacteurs
    P.coque([
      {x:8.6, y:0.0, l:2.6, h:1.6, b:2.0}, {x:5.5, y:0.15, l:4.9, h:1.85, b:2.3}, {x:-3.0, y:0.2, l:5.3, h:1.8, b:2.3},
      {x:-11.0, y:0.1, l:5.2, h:1.6, b:2.1}, {x:-16.5, y:0.0, l:4.9, h:1.35, b:1.8},
    ], {profil:plat, lisse:true, dessus:V.dessus, ventre:V.ventre, bouchon:V.dessus2});
    for(const s of [-1, 1]){
      // entrées d'air : caissons à lèvre supérieure avancée
      P.bz(7.4, 0.0, s*3.75, 5.0, 3.5, 2.5, V.dessus, {dx:0.16});
      P.bz(10.0, 0.0, s*3.75, 0.25, 3.0, 2.0, V.sombre, {dx:3.2});
      // réacteurs : carénage, couronne, tuyère à pétales
      P.cy(-14.0, -0.25, s*2.6, 2.3, 8.0, V.dessus2, 'x', 12);
      P.cy(-17.9, -0.25, s*2.6, 2.36, 0.5, V.sombre, 'x', 12);
      P.cy(-19.6, -0.25, s*2.6, 1.85, 3.4, V.metal, 'x', 12, 1.2);
      // voilure haute en flèche, bande d'identification vers le saumon
      P.voilure([6.8, 1.35, s*4.7], [-9.6, 1.35, s*4.7], [-4.9, 1.1, s*15.4], [-9.2, 1.1, s*15.4], 1.0, 0.28, [0, 1, 0],
        [[0, 0.64, V.dessus], [0.64, 0.84, V.accent], [0.84, 1, V.dessus]], V.ventre);
      // empennage horizontal monobloc
      P.voilure([-12.6, 0.15, s*5.0], [-20.6, 0.15, s*5.0], [-19.4, 0.05, s*10.4], [-23.2, 0.05, s*10.4], 0.6, 0.2, [0, 1, 0],
        [[0, 0.68, V.dessus], [0.68, 1, V.accent]], V.ventre);
      // dérives jumelles, verticales
      P.voilure([-8.2, 1.5, s*4.75], [-18.4, 1.5, s*4.75], [-15.4, 10.2, s*4.75], [-19.6, 10.2, s*4.75], 0.7, 0.25, [0, 0, s],
        [[0, 0.7, V.dessus], [0.7, 1, V.accent]]);
      P.cy(-17.4, 10.35, s*4.75, 0.3, 3.4, V.dessus2, 'x', 6);                         // carénage d'antenne en tête de dérive
      // armement : deux missiles d'angle de fuselage, un pylône d'aile à deux rails
      missile(P, 1.5, -2.45, s*4.55, 8.5, 0.36, V);
      missile(P, -8.5, -2.3, s*4.6, 8.5, 0.36, V);
      P.b(-1.6, 0.5, s*9.2, 4.6, 1.2, 0.4, V.dessus2);
      missile(P, -1.2, -0.3, s*8.55, 6.4, 0.28, V); missile(P, -1.2, -0.3, s*9.85, 6.4, 0.28, V);
      // lueurs : bandes de formation, feu de queue
      lum.b(13.0, 0.4, s*2.14, 3.2, 0.3, 0.1, V.lum);
      lum.b(-14.2, 5.4, s*5.12, 3.0, 0.3, 0.08, V.lum);
      lum.b(-19.9, 10.3, s*4.75, 0.3, 0.3, 0.3, FEU.blanc);
    }
    // verrière en bulle, arceau, carénage dorsal
    P.sp(11.9, 1.95, 0, 5.3, 1.85, 1.6, V.verre, 2);
    P.b(14.3, 2.6, 0, 0.22, 1.5, 2.3, V.dessus2);
    P.bz(3.2, 2.2, 0, 8.0, 1.0, 2.6, V.dessus, {hl:0.75, hp:0.55});
    P.b(4.2, 2.76, 0, 2.2, 0.12, 1.5, V.accent);
    lum.b(-7.2, 1.15, 15.55, 1.6, 0.3, 0.25, FEU.vert); lum.b(-7.2, 1.15, -15.55, 1.6, 0.3, 0.25, FEU.rouge);   // feux de navigation
    return {genre:'avion', corps:P.geo(), lum:lum.geo(),
      trainA:geoTrain([[12.5, 0, 4.8, 0.8], [-3.5, 4.3, 4.8, 1.05], [-3.5, -4.3, 4.8, 1.05]], V), yTrain:-1.6,
      feu:commune('f15feu', () => geoFeu([[-0.25, 2.6, 1.8], [-0.25, -2.6, 1.8]], V.flamme, '#ffe9c0', 11)), xFeu:-21.3,
      eclair:commune('eclairAvion', () => geoEclair(2.2)), posEclair:[9, -2.3, 0],
      yAxe:6.4, l:46.5, env:31, h:17, bouts:[[-7.4, 1.1, 15.4], [-7.4, 1.1, -15.4]], ombre:OMBRE.avion, fumeeH:6, matK:faction === 'karsk'};
  }

  // F-35 : monoréacteur furtif, fuselage à arêtes vives, aile trapézoïdale, dérives inclinées.
  function modeleF35(faction){
    const V = livreeAvion(faction), P = new Piece(), lum = new Piece();
    const furtif = [[0, 1], [0.46, 0.78], [1, 0.02], [0.52, -0.82], [0, -1]];       // demi-profil à facettes (bouchain marqué)
    P.coque([
      {x:20.0, y:-0.35, l:0.1, h:0.08}, {x:17.2, y:-0.3, l:1.25, h:0.75, b:0.7}, {x:13.6, y:-0.1, l:2.2, h:1.5, b:1.2},
      {x:8.5, y:0.0, l:3.1, h:2.1, b:1.7}, {x:4.5, y:0.05, l:4.7, h:2.3, b:2.1}, {x:-2.0, y:0.05, l:5.1, h:2.25, b:2.2},
      {x:-8.5, y:0.0, l:4.7, h:2.1, b:2.0}, {x:-13.0, y:0.0, l:3.3, h:1.9, b:1.7}, {x:-15.4, y:0.0, l:2.3, h:1.75, b:1.65},
    ], {profil:furtif, lisse:false, dessus:V.dessus, ventre:V.dessus2, seuil:-0.5, bouchon:V.dessus2});
    // tuyère unique
    P.cy(-15.3, 0, 0, 2.05, 0.5, V.sombre, 'x', 12);
    P.cy(-16.9, 0, 0, 1.6, 3.4, V.metal, 'x', 12, 1.22);
    const c = 0.42;                                                                    // dévers des dérives (rad)
    for(const s of [-1, 1]){
      // entrées d'air latérales
      P.bz(5.4, -0.25, s*3.9, 4.6, 2.3, 1.9, V.dessus, {dx:-0.22, hp:0.7});
      P.bz(7.75, -0.25, s*3.95, 0.22, 1.8, 1.4, V.sombre, {dx:-4.6, hp:0.7});
      // aile trapézoïdale
      P.voilure([4.6, 0.25, s*4.7], [-7.4, 0.25, s*4.7], [-1.4, 0.1, s*13.5], [-5.2, 0.1, s*13.5], 0.8, 0.22, [0, 1, 0],
        [[0, 0.7, V.dessus], [0.7, 0.86, V.accent], [0.86, 1, V.dessus]], V.dessus2);
      // empennage horizontal, qui déborde en arrière de la tuyère
      P.voilure([-10.4, 0.1, s*3.5], [-18.8, 0.1, s*3.5], [-14.2, 0.0, s*8.6], [-17.8, 0.0, s*8.6], 0.55, 0.2, [0, 1, 0],
        [[0, 1, V.dessus]], V.dessus2);
      // dérives inclinées vers l'extérieur
      const pied = x => [x, 1.5, s*3.2], tete = x => [x, 1.5 + Math.cos(c)*7.6, s*(3.2 + Math.sin(c)*7.6)];
      P.voilure(pied(-5.6), pied(-14.6), tete(-11.2), tete(-15.6), 0.6, 0.22, [0, -Math.sin(c), s*Math.cos(c)],
        [[0, 0.72, V.dessus], [0.72, 1, V.accent]]);
      // lueurs : bandes de formation (fuselage, dérives), feux de queue
      lum.b(12.6, 0.15, s*2.5, 2.6, 0.22, 0.1, V.lum);
      lum.b(-10.6, 1.5 + Math.cos(c)*3.6 - Math.sin(c)*0.3, s*(3.2 + Math.sin(c)*3.6 + Math.cos(c)*0.3), 2.6, 0.26, 0.1, V.lum, s*c);
      lum.b(-18.9, 0.1, s*3.6, 0.3, 0.25, 0.3, FEU.blanc);
    }
    // verrière teintée, arceau, capteur optronique sous le nez
    P.sp(11.0, 1.35, 0, 4.9, 1.55, 1.55, V.verreOr, 2);
    P.b(12.7, 2.15, 0, 0.2, 1.3, 2.0, V.dessus2);
    P.b(15.6, -1.0, 0, 1.6, 0.5, 1.1, V.verre);
    lum.b(-3.3, 0.1, 13.6, 1.4, 0.25, 0.25, FEU.vert); lum.b(-3.3, 0.1, -13.6, 1.4, 0.25, 0.25, FEU.rouge);
    return {genre:'avion', corps:P.geo(), lum:lum.geo(),
      trainA:geoTrain([[10.5, 0, 3.8, 0.7], [-3.0, 3.4, 3.8, 0.95], [-3.0, -3.4, 3.8, 0.95]], V), yTrain:-1.6,
      feu:commune('f35feu', () => geoFeu([[0, 0, 1.55]], V.flamme, '#ffe9c0', 11)), xFeu:-18.6,
      eclair:commune('eclairAvion', () => geoEclair(2.2)), posEclair:[4, -2.4, 0],
      yAxe:5.4, l:40, env:27, h:14, bouts:[[-3.3, 0.1, 13.5], [-3.3, 0.1, -13.5]], ombre:OMBRE.avion, fumeeH:6, matK:faction === 'karsk'};
  }

  // Rafale : aile delta et plans canard, deux réacteurs rapprochés, dérive unique, perche de ravitaillement fixe.
  function modeleRafale(faction){
    const V = livreeAvion(faction), P = new Piece(), lum = new Piece();
    const rond = profilEllipse(6, 2.25);
    P.coque([
      {x:20.2, y:-0.3, l:0.1, h:0.1, c:V.nez, v:V.nez}, {x:18.4, y:-0.25, l:0.72, h:0.72, c:V.nez, v:V.nez},
      {x:16.0, y:-0.15, l:1.25, h:1.25, c:V.nez, v:V.nez}, {x:15.9, y:-0.15, l:1.27, h:1.27},
      {x:12.0, y:0.0, l:1.85, h:1.9, b:1.6}, {x:7.0, y:0.1, l:2.5, h:2.2, b:1.95}, {x:2.0, y:0.1, l:3.3, h:2.1, b:2.3},
      {x:-5.0, y:0.0, l:3.75, h:1.95, b:2.25}, {x:-12.0, y:-0.05, l:3.6, h:1.7, b:1.95}, {x:-15.8, y:-0.1, l:3.35, h:1.5, b:1.6},
    ], {profil:rond, lisse:true, dessus:V.dessus, ventre:V.ventre, bouchon:V.dessus2});
    for(const s of [-1, 1]){
      // tuyères jumelles rapprochées
      P.cy(-15.7, -0.15, s*1.7, 1.66, 0.5, V.sombre, 'x', 12);
      P.cy(-17.3, -0.15, s*1.7, 1.35, 3.4, V.metal, 'x', 12, 1.18);
      // entrées d'air semi-ventrales en demi-lune
      P.cy(4.6, -1.25, s*2.75, 1.45, 5.6, V.dessus, 'x', 10);
      P.cy(7.45, -1.25, s*2.75, 1.18, 0.2, V.sombre, 'x', 10);
      // aile delta
      P.voilure([4.8, -0.55, s*3.2], [-10.6, -0.55, s*3.2], [-6.9, -0.75, s*13.3], [-10.2, -0.75, s*13.3], 0.9, 0.22, [0, 1, 0],
        [[0, 0.66, V.dessus], [0.66, 0.84, V.accent], [0.84, 1, V.dessus]], V.ventre);
      // plan canard : plus haut que l'aile, juste devant elle
      P.voilure([9.6, 0.95, s*2.3], [5.6, 0.95, s*2.3], [5.9, 1.2, s*6.7], [4.2, 1.2, s*6.7], 0.4, 0.14, [0, 1, 0],
        [[0, 0.6, V.dessus], [0.6, 1, V.accent]], V.ventre);
      // missile en bout d'aile, pylône et missile sous voilure
      missile(P, -7.6, -0.75, s*13.75, 7.4, 0.3, V);
      P.b(-3.0, -1.3, s*7.6, 4.2, 1.1, 0.35, V.dessus2);
      missile(P, -2.6, -2.05, s*7.6, 7.0, 0.32, V);
      // lueurs
      lum.b(12.2, 0.3, s*1.92, 2.6, 0.22, 0.1, V.lum);
      lum.b(-11.4, 6.0, s*0.4, 3.0, 0.3, 0.08, V.lum);
    }
    // dérive unique et son carénage de tête
    P.voilure([-3.4, 1.8, 0], [-15.0, 1.6, 0], [-13.0, 10.4, 0], [-16.8, 10.4, 0], 0.75, 0.25, [0, 0, 1],
      [[0, 0.7, V.dessus], [0.7, 1, V.accent]]);
    P.bz(-15.0, 9.7, 0, 3.6, 1.0, 0.7, V.dessus2, {hl:0.8});
    // verrière, arceau, perche de ravitaillement (fixe, à droite du nez), capteurs optroniques
    P.sp(10.6, 1.75, 0, 4.3, 1.7, 1.45, V.verre, 2);
    P.b(12.5, 2.4, 0, 0.2, 1.4, 2.0, V.dessus2);
    P.seg(13.8, 1.5, 1.35, 17.2, 2.5, 1.5, 0.3, V.dessus2); P.cy(17.5, 2.58, 1.52, 0.24, 0.8, V.sombre, 'x', 6);
    P.sp(15.0, 1.2, -0.45, 0.5, 0.45, 0.45, V.sombre, 1); P.sp(15.0, 1.2, 0.3, 0.4, 0.4, 0.4, V.verre, 1);
    // réservoir ventral
    P.sp(-1.5, -2.95, 0, 6.6, 0.95, 0.95, V.ventre, 2); P.b(-1.5, -2.2, 0, 4, 0.9, 0.3, V.dessus2);
    lum.b(-6.6, -0.6, 13.2, 1.2, 0.25, 0.25, FEU.vert); lum.b(-6.6, -0.6, -13.2, 1.2, 0.25, 0.25, FEU.rouge);
    lum.b(-17.0, 10.4, 0, 0.3, 0.3, 0.3, FEU.blanc);
    return {genre:'avion', corps:P.geo(), lum:lum.geo(),
      trainA:geoTrain([[9.5, 0, 3.9, 0.7, true], [-3.2, 3.0, 3.9, 0.95], [-3.2, -3.0, 3.9, 0.95]], V), yTrain:-1.7,
      feu:commune('rafalefeu', () => geoFeu([[-0.15, 1.7, 1.3], [-0.15, -1.7, 1.3]], V.flamme, '#ffe9c0', 10)), xFeu:-19.0,
      eclair:commune('eclairAvion', () => geoEclair(2.2)), posEclair:[2, -2.6, 0],
      yAxe:5.6, l:40, env:28, h:16, bouts:[[-10.4, -0.75, 13.6], [-10.4, -0.75, -13.6]], ombre:OMBRE.delta, fumeeH:6, matK:faction === 'karsk'};
  }

  // ---------- 4.d bis Hélicoptères (forme 'helico', rôle 'mitrailleur' ou 'missiles') ----------
  // Appareils inventés. Repère : axe du fuselage à y = 0 ; posé, cet axe est à M.yAxe au-dessus du sol.
  // Pièces animées : rotor principal (M.rotor, tourne autour de Y en M.posRotor), disque flou (M.flou),
  // rotor de queue (M.queue, tourne autour de Z en M.posQueue), arme de nez orientable (M.arme en M.posArme).
  //   Mitrailleur (frelon, taon) : léger, verrière en bulle, patins, canon rotatif sous le nez.
  //   Missiles (busard, vautour) : plus massif, biplace en tandem, ailettes à paniers de roquettes
  //   et missiles en bout, roues fixes, dérive haute.
  const matFlouRotor = new THREE.MeshBasicMaterial({color:couleur('#20262c'), transparent:true, opacity:0.13, depthWrite:false, side:THREE.DoubleSide});
  LUMINEUX.add(matFlouRotor);
  const ALT_HELICO = 45;
  function livreeHelico(faction){
    return faction === 'karsk'
      ? {dessus:K.olive, dessus2:K.oliveF, ventre:K.oliveC, accent:K.rouge, sombre:K.noir, vitre:K.vitre, metal:'#2e2d28', arme:'#c4c9b4', lum:'#ffb36b'}
      : {dessus:H.acier, dessus2:H.acierF, ventre:H.acierC, accent:H.bleu, sombre:H.noir, vitre:H.vitre, metal:'#2b3138', arme:'#e2e7eb', lum:H.lum};
  }
  function geoRotor(R, n, V, corde){
    const P = new Piece();
    P.cy(0, 0, 0, 1.0, 0.8, V.dessus2, 'y', 8);
    P.b(0, 0.55, 0, 1.3, 0.5, 1.3, V.metal);
    for(let k = 0; k < n; k++){
      const a = k*Math.PI*2/n, c = Math.cos(a), s = -Math.sin(a);
      P.b(c*(R/2 + 0.5), 0, s*(R/2 + 0.5), R - 1, 0.18, corde, V.dessus2, 0, a, 0);
      P.b(c*(R - 0.9), 0.02, s*(R - 0.9), 1.3, 0.25, corde + 0.05, V.accent, 0, a, 0);   // bouts de pale (couleur du camp)
    }
    return P.geo();
  }
  function geoQueue(r, n, V){
    const P = new Piece();
    P.cy(0, 0, 0, 0.45, 0.6, V.metal, 'z', 8);
    for(let k = 0; k < n; k++) P.b(0, 0, 0, 0.7, r*2, 0.16, V.sombre, 0, 0, k*Math.PI/n);
    return P.geo();
  }
  function modeleHelico(faction, role){
    const V = livreeHelico(faction), k = faction === 'karsk', lourd = role === 'missiles';
    const P = new Piece(), lum = new Piece(), arme = new Piece(), eclair = new Piece();
    const rond = profilEllipse(7, 2.2);
    let M;
    if(!lourd){
      const yAxe = 4.6, R = k ? 14.5 : 15.5;
      P.coque([
        {x:9.6, y:-0.4, l:0.3, h:0.3}, {x:8.6, y:-0.3, l:2.0, h:2.0, b:1.9}, {x:6.2, y:0.1, l:2.9, h:2.9, b:2.6},
        {x:2.5, y:0.4, l:3.2, h:3.3, b:2.8}, {x:-2.0, y:0.6, l:3.0, h:3.1, b:2.4}, {x:-5.6, y:1.0, l:2.0, h:2.3, b:1.3},
        {x:-8.4, y:1.3, l:1.0, h:1.1, b:0.8},
      ], {profil:rond, lisse:true, dessus:V.dessus, ventre:V.ventre, bouchon:V.dessus2});
      P.sp(6.1, 0.8, 0, 4.0, 2.75, 3.08, V.vitre, 2);                                     // verrière en bulle
      P.b(4.0, 3.15, 0, 0.35, 0.5, 3.2, V.dessus2);                                       // arceau
      P.bz(-1.5, 3.7, 0, 6.5, 1.8, 3.4, V.dessus2, {hl:0.7, hp:0.75});                   // capot moteur
      P.b(-1.8, 4.62, 0, 4.2, 0.18, 1.7, V.accent);                                       // dos (couleur du camp)
      P.cy(0, 5.3, 0, 0.45, 1.6, V.sombre, 'y', 8);                                       // mât
      P.cy(-5.4, 3.9, 0, 0.55, 1.8, V.sombre, 'x', 8);                                    // tuyère
      P.cy(-16.4, 1.4, 0, 0.5, 16.5, V.dessus, 'x', 8, 1.7);                              // poutre de queue
      P.cy(-13.6, 1.42, 0, 0.84, 2.2, V.accent, 'x', 8);                                  // bague (couleur du camp)
      P.voilure([-22.4, 1.7, 0], [-25.0, 1.7, 0], [-24.6, 6.4, 0], [-26.2, 6.4, 0], 0.4, 0.25, [0, 0, 1],
        [[0, 0.74, V.dessus], [0.74, 1, V.accent]]);                                      // dérive
      P.voilure([-23.0, 1.1, 0], [-25.0, 1.1, 0], [-24.8, -1.8, 0], [-25.6, -1.8, 0], 0.35, 0.2, [0, 0, 1], [[0, 1, V.dessus2]]);
      for(const s of [-1, 1]){
        P.voilure([-19.5, 1.3, s*0.5], [-22.0, 1.3, s*0.5], [-20.7, 1.3, s*3.6], [-22.3, 1.3, s*3.6], 0.3, 0.2, [0, 1, 0],
          [[0, 0.7, V.dessus], [0.7, 1, V.accent]], V.ventre);                            // empennage
        P.b(0.5, -4.2, s*3.1, 11, 0.4, 0.45, V.sombre);                                    // patins
        P.seg(6.0, -4.2, s*3.1, 7.6, -3.3, s*3.1, 0.4, V.sombre);
        P.seg(3.2, -2.0, s*1.7, 3.4, -4.1, s*3.1, 0.35, V.sombre);
        P.seg(-2.8, -1.8, s*1.7, -3.0, -4.1, s*3.1, 0.35, V.sombre);
        if(k) P.bz(1.6, 0.2, s*3.05, 6.4, 2.6, 0.45, V.dessus2, {hl:0.85});               // Karsk : plaques de blindage
        lum.b(-11.5, 1.75, s*0.62, 3.0, 0.16, 0.06, V.lum);                                // bandes de formation
      }
      if(!k){                                                                             // Halden : viseur de mât
        P.cy(0, 7.6, 0, 0.22, 1.6, V.sombre, 'y', 6);
        P.sp(0, 8.6, 0, 0.95, 0.75, 0.95, V.dessus2, 1);
        lum.b(0.9, 8.6, 0, 0.1, 0.4, 0.8, V.lum);
      } else {
        P.cy(-4.6, 4.2, 1.2, 0.45, 1.6, V.sombre, 'x', 8);                                 // Karsk : seconde tuyère
      }
      lum.b(-21.5, 1.3, 3.65, 0.8, 0.2, 0.2, FEU.vert); lum.b(-21.5, 1.3, -3.65, 0.8, 0.2, 0.2, FEU.rouge);
      lum.b(-25.6, 6.5, 0, 0.3, 0.3, 0.3, FEU.blanc); lum.b(0, -2.75, 0, 0.6, 0.2, 0.6, FEU.rouge);
      // canon rotatif sous le nez (repère : pivot de la tourelle)
      arme.sp(0, 0, 0, 1.1, 0.9, 1.1, V.dessus2, 1);
      arme.cy(1.4, -0.2, 0, 0.55, 1.4, V.metal, 'x', 8);
      for(let j = 0; j < 3; j++){ const a = j*Math.PI*2/3; arme.cy(3.2, -0.2 + Math.cos(a)*0.22, Math.sin(a)*0.22, 0.13, 3.6, V.sombre, 'x', 5); }
      eclair.sp(0, 0, 0, 0.8, 0.8, 0.8, '#fff0c0', 1);
      eclair.b(1.2, 0, 0, 2.6, 0.12, 0.9, '#ff9c4a'); eclair.b(1.2, 0, 0, 2.6, 0.9, 0.12, '#ff9c4a');
      eclair.b(9, 0, 0, 14, 0.2, 0.2, '#ffd27a');                                         // traçante
      M = {genre:'helico', role:'mitrailleur', yAxe, posRotor:[0, 6.2, 0], posQueue:[-24.7, 4.3, 1.0], posArme:[7.6, -2.6, 0],
        rotor:geoRotor(R, k ? 4 : 3, V, k ? 0.85 : 0.95), rR:R, queue:geoQueue(2.6, 2, V), eclairSurArme:true, posEclair:[5.2, -0.2, 0],
        pods:[], l:36, p:10, env:R*1.15, h:12, fumeeH:6};
    } else {
      const yAxe = 5.6, R = k ? 18.5 : 19.5;
      P.coque([
        {x:12.6, y:-0.8, l:0.3, h:0.3}, {x:11.4, y:-0.6, l:1.3, h:1.4, b:1.4}, {x:8.8, y:-0.2, l:1.9, h:2.3, b:2.2},
        {x:4.0, y:0.3, l:2.4, h:3.2, b:2.6}, {x:-1.5, y:0.5, l:2.6, h:3.3, b:2.6}, {x:-6.5, y:0.9, l:2.1, h:2.6, b:1.7},
        {x:-9.5, y:1.3, l:1.2, h:1.4, b:1.0},
      ], {profil:rond, lisse:true, dessus:V.dessus, ventre:V.ventre, bouchon:V.dessus2});
      P.bz(8.4, 2.3, 0, 4.2, 1.7, 2.5, V.vitre, {hl:0.6, hp:0.7, dx:0.05});              // verrières en tandem
      P.bz(4.3, 3.6, 0, 4.0, 1.9, 2.7, V.vitre, {hl:0.7, hp:0.75});
      P.b(6.35, 3.05, 0, 0.35, 1.6, 2.5, V.dessus2);
      P.bz(-1.0, 4.0, 0, 7.5, 1.7, 2.9, V.dessus, {hl:0.75, hp:0.7});                    // carénage dorsal
      P.b(-1.2, 4.88, 0, 4.6, 0.18, 1.7, V.accent);
      P.cy(-0.5, 5.6, 0, 0.55, 2.2, V.sombre, 'y', 8);                                    // mât
      P.cy(-18.0, 1.5, 0, 0.6, 17, V.dessus, 'x', 8, 1.7);                                // poutre de queue
      P.cy(-15.0, 1.55, 0, 0.94, 2.2, V.accent, 'x', 8);
      P.voilure([-24.0, 1.8, 0], [-27.4, 1.8, 0], [-27.0, 7.8, 0], [-28.6, 7.8, 0], 0.5, 0.3, [0, 0, 1],
        [[0, 0.72, V.dessus], [0.72, 1, V.accent]]);                                      // dérive haute
      P.seg(-22.8, 1.0, 0, -23.2, -4.7, 0, 0.35, V.sombre);                               // roulette de queue
      P.cy(-23.2, -5.0, 0, 0.6, 0.45, H.pneu, 'z', 8);
      for(const s of [-1, 1]){
        P.cy(-1.0, 3.2, s*2.5, 1.2, 7.0, V.dessus2, 'x', 10);                             // turbines
        P.cy(2.6, 3.2, s*2.5, 0.9, 0.3, V.sombre, 'x', 10);
        P.bz(-5.2, 3.6, s*2.9, 2.2, 1.2, 1.4, V.metal, {hl:0.7});                         // déflecteurs
        P.voilure([-24.6, 1.4, s*0.6], [-27.0, 1.4, s*0.6], [-25.7, 1.4, s*4.2], [-27.2, 1.4, s*4.2], 0.35, 0.22, [0, 1, 0],
          [[0, 0.7, V.dessus], [0.7, 1, V.accent]], V.ventre);
        // ailettes, paniers de roquettes, missiles en bout
        P.voilure([1.6, -0.4, s*2.2], [-2.6, -0.4, s*2.2], [0.8, -0.9, s*8.4], [-1.8, -0.9, s*8.4], 0.7, 0.35, [0, 1, 0],
          [[0, 0.8, V.dessus], [0.8, 1, V.accent]], V.ventre);
        P.b(-0.4, -1.45, s*4.6, 1.8, 1.1, 0.4, V.dessus2);
        P.cy(-0.3, -2.6, s*4.6, 1.15, 5.0, V.dessus2, 'x', 10);
        P.cy(2.3, -2.6, s*4.6, 1.2, 0.3, V.accent, 'x', 10);
        P.cy(-3.3, -2.6, s*4.6, 0.7, 1.0, V.dessus2, 'x', 10, 1.64);
        for(let j = 0; j < 7; j++){
          const a = j*Math.PI/3, rr = j === 6 ? 0 : 0.62;
          P.cy(2.48, -2.6 + Math.sin(a)*rr, s*4.6 + Math.cos(a)*rr, 0.22, 0.12, V.sombre, 'x', 6);
        }
        P.b(-0.4, -1.25, s*7.9, 4.6, 0.55, 0.35, V.dessus2);
        missile(P, -0.4, -1.75, s*7.9, 5.4, 0.3, V);
        // train fixe
        P.seg(3.0, -2.2, s*1.8, 3.4, -4.6, s*2.8, 0.4, V.sombre);
        P.cy(3.4, -4.7, s*2.95, 0.9, 0.55, H.pneu, 'z', 10);
        if(k) P.bz(5.6, -0.4, s*2.25, 8.4, 3.0, 0.5, V.dessus2, {hl:0.9});                // Karsk : baignoire blindée
        lum.b(-13.0, 1.9, s*0.75, 3.0, 0.16, 0.06, V.lum);
      }
      if(!k){ P.cy(-0.5, 8.3, 0, 0.25, 1.4, V.sombre, 'y', 6); P.sp(-0.5, 9.2, 0, 1.1, 0.8, 1.1, V.dessus2, 1); lum.b(0.55, 9.2, 0, 0.1, 0.45, 0.9, V.lum); }
      P.sp(10.6, -2.0, 0, 1.0, 0.9, 1.0, V.dessus2, 1);                                   // boule optronique
      lum.b(11.55, -2.0, 0, 0.1, 0.5, 0.6, V.lum);
      lum.b(-1.0, -0.9, 8.5, 0.8, 0.2, 0.2, FEU.vert); lum.b(-1.0, -0.9, -8.5, 0.8, 0.2, 0.2, FEU.rouge);
      lum.b(-28.0, 7.9, 0, 0.3, 0.3, 0.3, FEU.blanc);
      arme.b(0, 0, 0, 1.6, 1.1, 1.6, V.dessus2);
      arme.cy(2.6, -0.1, 0, 0.3, 4.8, V.sombre, 'x', 6);
      // éclair : départ des roquettes aux deux paniers (repère du corps)
      for(const s of [-1, 1]){
        eclair.sp(2.9, -2.6, s*4.6, 1.2, 1.2, 1.2, '#fff0c0', 1);
        eclair.b(4.4, -2.6, s*4.6, 3.4, 0.16, 1.4, '#ff9c4a'); eclair.b(4.4, -2.6, s*4.6, 3.4, 1.4, 0.16, '#ff9c4a');
        eclair.g(CONE_FLAMME, '#ffb35a', matrice(-5.4, -2.6, s*4.6, 0, 0, -Math.PI/2, 0.9, 3.2, 0.9));   // souffle arrière
      }
      M = {genre:'helico', role:'missiles', yAxe, posRotor:[-0.5, 7.0, 0], posQueue:[-27.6, 5.0, -1.0], posArme:[8.6, -2.9, 0],
        rotor:geoRotor(R, k ? 5 : 4, V, k ? 0.95 : 1.05), rR:R, queue:geoQueue(3.2, k ? 3 : 2, V), eclairSurArme:false, posEclair:[0, 0, 0],
        pods:[[3, -2.6, 4.6], [3, -2.6, -4.6], [-4, -2.6, 4.6], [-4, -2.6, -4.6]], l:42, p:18, env:R*1.1, h:14, fumeeH:7};
    }
    const flou = new Piece();
    flou.g(new THREE.RingGeometry(M.rR*0.1, M.rR, 40), '#ffffff', matrice(0, 0.1, 0, -Math.PI/2, 0, 0, 1, 1, 1));
    return Object.assign(M, {corps:P.geo(), lum:lum.geo(), arme:arme.geo(), eclair:eclair.geo(), flou:flou.geo(),
      ombre:OMBRE.disque, matK:k});
  }

  // ---------- 4.e Envahisseurs (« Les Veilleurs ») ----------
  // Conception originale : ni vaisseau ni créature repris d'une œuvre existante.
  const ARETE = [[0, 1], [1, 0], [0, -1]];                                             // section en losange

  // Dard : chasseur effilé. Longue épine à arêtes vives, écailles lisses sur le dos, deux lames
  // recourbées vers l'avant qui encadrent la pointe, aiguillon traînant à l'arrière.
  function modeleDard(){
    const P = new Piece(), lum = new Piece();
    P.coque([
      {x:19.0, y:0.0, l:0.06, h:0.06}, {x:12.0, y:0.1, l:1.0, h:0.75, c:X.violet}, {x:5.0, y:0.3, l:2.3, h:1.5, b:1.1},
      {x:-1.5, y:0.4, l:3.3, h:2.2, b:1.5, c:X.nuit}, {x:-7.0, y:0.3, l:2.5, h:1.7, b:1.2},
      {x:-11.0, y:0.2, l:1.2, h:1.0, b:0.8, c:X.bronze}, {x:-16.0, y:0.5, l:0.45, h:0.5}, {x:-22.5, y:1.4, l:0.05, h:0.05, c:X.os},
    ], {profil:ARETE, lisse:false, dessus:X.fonce, ventre:X.nuit});
    // écailles dorsales (lisses, se chevauchent vers l'arrière)
    P.sp(2.0, 1.25, 0, 4.4, 1.3, 2.3, X.violet, 2);
    P.sp(-3.4, 1.45, 0, 3.5, 1.25, 2.2, X.fonce, 2);
    P.sp(-7.6, 1.2, 0, 2.6, 0.95, 1.6, X.bronze, 2);
    for(const s of [-1, 1]){
      // lame : pan intérieur puis griffe recourbée vers l'avant
      P.voilure([2.5, 0.2, s*2.2], [-7.5, 0.2, s*2.2], [4.0, 0.6, s*7.5], [-2.5, 0.6, s*7.5], 0.75, 0.45, [0, 1, 0],
        [[0, 0.6, X.fonce], [0.6, 1, X.violet]], X.nuit);
      P.voilure([4.0, 0.6, s*7.5], [-2.5, 0.6, s*7.5], [14.2, 0.0, s*10.3], [12.8, 0.0, s*10.9], 0.45, 0.06, [0, 1, 0],
        [[0, 0.45, X.violet], [0.45, 1, X.os]], X.osF);
      // barbillon arrière
      P.voilure([-8.0, 0.3, s*1.5], [-11.5, 0.3, s*1.2], [-15.6, 0.9, s*5.0], [-16.3, 0.9, s*4.8], 0.4, 0.06, [0, 1, 0],
        [[0, 1, X.osF]], X.nuit);
      // lueurs : fentes des « yeux », nervures du bord d'attaque
      lum.b(8.2, 0.75, s*1.05, 2.6, 0.2, 0.22, X.lum, 0, s*-0.12, 0);
      lum.seg(2.6, 0.62, s*2.4, 4.1, 0.9, s*7.4, 0.24, X.lum);
      lum.seg(4.2, 0.9, s*7.5, 13.4, 0.2, s*10.4, 0.18, X.lum);
    }
    lum.sp(-2.0, -1.25, 0, 1.8, 0.5, 1.2, X.coeur, 1);                                  // cœur ventral
    lum.sp(-22.3, 1.4, 0, 0.55, 0.55, 0.55, X.lumC, 1);                                 // pointe de l'aiguillon
    return {genre:'dard', corps:P.geo(), lum:lum.geo(),
      feu:geoFeu([[0.3, 0, 1.15]], X.lum, X.lumC, 9), xFeu:-10.6, eclair:geoEclair(2.0, X.lumC, X.lum), posEclair:[17, 0, 0],
      echelle:0.8, l:41.5, env:22, h:5, bouts:[[-22.3, 1.4, 0]], ombre:OMBRE.delta, fumeeH:5};
  }

  // Rôdeur : marcheur à quatre pattes, plus haut qu'un char. Carapace ovoïde à écailles, tête basse
  // en coin, lance dorsale orientable, pattes à deux segments posées par cinématique inverse.
  const HANCHES_RODEUR = [[6.5, 6.2], [6.5, -6.2], [-6.5, 6.2], [-6.5, -6.2]];          // (x, z) dans le repère du corps
  const PIEDS_RODEUR = [[16, 15.5], [16, -15.5], [-15, 15.5], [-15, -15.5]];            // appuis au repos (x, z)
  function modeleRodeur(){
    const coque = new Piece(), lum = new Piece(), tete = new Piece(), lumT = new Piece(), cuisse = new Piece(), tibia = new Piece();
    const L1 = 14, L2 = 24;
    coque.sp(0, 0, 0, 11.5, 4.6, 7.6, X.fonce, 2);
    coque.sp(3.5, 2.2, 0, 7.0, 3.0, 5.8, X.violet, 2);                                  // écaille dorsale avant
    coque.sp(-4.5, 2.0, 0, 6.5, 2.8, 5.4, X.nuit, 2);                                   // écaille dorsale arrière
    coque.sp(-10.0, 0.6, 0, 3.6, 2.2, 3.2, X.bronze, 2);                                // abdomen
    coque.bz(11.5, -1.2, 0, 7.0, 3.4, 6.4, X.fonce, {hl:0.45, hp:0.6, dx:-0.2, bl:0.9, bp:0.8});   // tête en coin
    for(const s of [-1, 1]) coque.seg(13.0, -2.6, s*2.2, 17.5, -4.4, s*1.2, 0.7, X.os);  // mandibules
    for(let i = 0; i < 4; i++) coque.bz(-7 + i*4.2, 4.9 - Math.abs(i - 1.5)*0.5, 0, 2.6, 1.8, 0.5, X.os, {hl:0.3, dx:-0.3});   // crête d'os
    for(const [hx, hz] of HANCHES_RODEUR) coque.sp(hx, -0.6, hz, 2.3, 2.3, 2.3, X.osF, 1);                                       // rotules des hanches
    // lueurs : fente du regard (sur la face inclinée de la tête), yeux latéraux, nervures, cœur ventral
    lum.b(13.2, -1.0, 0, 0.2, 1.0, 3.4, X.lum, 0, 0, 0.71);
    for(const s of [-1, 1]){
      lum.sp(11.4, 0.2, s*2.6, 0.5, 0.4, 0.5, X.lumC, 1);
      lum.seg(-8, 1.0, s*5.9, 7, 1.2, s*6.7, 0.3, X.lum);
    }
    lum.sp(0, -4.3, 0, 3.2, 0.9, 2.4, X.coeur, 1);
    // lance dorsale (repère : pivot) : socle, bulbe, deux branches qui se rejoignent, cristal entre elles
    tete.cy(0, 0.6, 0, 2.6, 1.2, X.osF, 'y', 10);
    tete.sp(0, 1.8, 0, 2.4, 1.6, 2.4, X.violet, 2);
    for(const s of [-1, 1]){
      tete.seg(0.5, 2.0, s*1.3, 9.5, 2.6, s*0.9, 0.7, X.os, 0.5);
      tete.seg(9.5, 2.6, s*0.9, 14.0, 2.4, s*0.25, 0.45, X.osF, 0.35);
    }
    lumT.sp(5.0, 0, 0, 1.6, 0.55, 0.55, X.lum, 1);                                      // (repère : axe de la lance, à yLumT du pivot)
    lumT.sp(13.7, 0.1, 0, 0.7, 0.45, 0.45, X.lumC, 1);
    // cuisse : de la hanche (origine) vers +X ; tibia : du genou (origine) vers +X, en lame effilée
    cuisse.bz(L1/2, 0, 0, L1, 2.4, 2.0, X.fonce, {hl:0.9, hp:0.6});
    cuisse.b(L1*0.5, 1.35, 0, L1*0.6, 0.4, 0.6, X.os);
    cuisse.sp(L1, 0, 0, 1.9, 1.9, 1.9, X.osF, 1);
    tibia.coque([{x:0, y:0, l:0.9, h:1.2}, {x:4, y:0, l:1.05, h:1.55}, {x:L2*0.7, y:0, l:0.6, h:0.8}, {x:L2, y:0, l:0.05, h:0.05}],
      {profil:ARETE, lisse:false, dessus:X.fonce, ventre:X.os, seuil:0.5});
    tibia.seg(3.0, 1.2, 0, 0.4, 3.6, 0, 0.5, X.os);                                     // ergot du genou
    return {genre:'marcheur', coque:coque.geo(), lum:lum.geo(), tete:tete.geo(), lumT:lumT.geo(), cuisse:cuisse.geo(), tibia:tibia.geo(),
      L1, L2, yCorps:21, yHanche:-0.6, pivotT:[-1, 4.6, 0], yLumT:2.3, recul:1.6, l:34, p:34, h:32, rAnneau:24, ombre:OMBRE.disque, fumeeH:10};
  }

  // ---------- 4.f Variante « neutre » (Régie des eaux) des modèles existants ----------
  // Recoloration des couleurs de sommets (linéaires) : teintes de camp (bleu Halden,
  // rouge Karsk) -> bleu ardoise ; teintes chaudes (peau, bois) conservées ;
  // le reste -> gris clair à blanc, les noirs restent sombres.
  const ARDOISE = couleur('#5d7380');
  function neutraliser(geo){
    if(geo && geo.lod) neutraliser(geo.lod);
    if(!geo || !geo.attributes.color) return;
    const C = geo.attributes.color.array;
    for(let i = 0; i < C.length; i += 3){
      const r = C[i], g = C[i+1], b = C[i+2], L = 0.2126*r + 0.7152*g + 0.0722*b;
      if((b > r*2.5 && b > 0.12) || (r > 0.2 && r > g*3 && r > b*3)){ C[i] = ARDOISE.r; C[i+1] = ARDOISE.g; C[i+2] = ARDOISE.b; continue; }
      if(r > b*2.2 && r > g*1.15) continue;                                          // peau, bois
      const l = L < 0.02 ? L : Math.min(0.82, 0.05 + L*2.6);
      C[i] = l*0.95; C[i+1] = l*0.99; C[i+2] = l*1.05;
    }
    geo.attributes.color.needsUpdate = true;
  }
  function neutraliserModele(M){
    if(M.genre === 'fantassin'){
      neutraliser(M.jambe);
      for(const k in M.torse) neutraliser(M.torse[k]);
      if(M.outil) neutraliser(M.outil.geo);
    } else if(M.genre === 'drone'){
      neutraliser(M.corps); neutraliser(M.pale);
    } else if(M.genre === 'avion'){
      neutraliser(M.corps);
    } else if(M.genre === 'helico'){
      neutraliser(M.corps); neutraliser(M.rotor); neutraliser(M.queue); neutraliser(M.arme);
    } else if(M.genre === 'vehicule'){
      neutraliser(M.coque); neutraliser(M.tourelle); neutraliser(M.canon);
      if(M.radar) neutraliser(M.radar.geo);
      if(M.train.type === 'roues') neutraliser(M.train.geo);   // (chenilles : teinte portée par la texture)
    }
  }

  // ---------- 4.g Couleur de camp (escarmouche à 2-4 camps) ----------
  // La livrée reste celle de la faction ; seules les teintes d'ACCENT (bleu Halden, rouge Karsk :
  // toits de tourelle, bandes de coque, casques, brassards, épaulières…) prennent la couleur du
  // camp, lue dans camps[id].couleur. Recoloration exacte des couleurs de sommets AVANT l'occlusion
  // cuite : une variante de modèle par (type, faction, couleur), géométries partagées entre les
  // unités de cette variante, rien au rendu par image. Les feux Halden (cyan) suivent, éclaircis.
  const ACCENTS = [couleur(H.bleu), couleur(K.rouge)], ACCENTS_F = [couleur(H.bleuF), couleur(K.rougeF)];
  const LUM_H = couleur(H.lum);
  function memeTeinte(C, i, t){ return Math.abs(C[i] - t.r) < 2e-4 && Math.abs(C[i+1] - t.g) < 2e-4 && Math.abs(C[i+2] - t.b) < 2e-4; }
  function recolorer(geo, vif, fonce, lum){
    if(geo && geo.lod) recolorer(geo.lod, vif, fonce, lum);
    if(!geo || !geo.attributes.color) return;
    const C = geo.attributes.color.array;
    for(let i = 0; i < C.length; i += 3){
      const t = (memeTeinte(C, i, ACCENTS[0]) || memeTeinte(C, i, ACCENTS[1])) ? vif
              : (memeTeinte(C, i, ACCENTS_F[0]) || memeTeinte(C, i, ACCENTS_F[1])) ? fonce
              : (lum && memeTeinte(C, i, LUM_H)) ? lum : null;
      if(t){ C[i] = t.r; C[i+1] = t.g; C[i+2] = t.b; }
    }
    geo.attributes.color.needsUpdate = true;
  }
  // Teinte sRGB '#rrggbb' mélangée vers le blanc (k = 0 : inchangée), en couleur linéaire.
  const cacheClaires = {};
  function claire(hex, k){
    const cle = hex + k;
    if(cacheClaires[cle]) return cacheClaires[cle];
    const c = new THREE.Color(hex); c.r += (1 - c.r)*k; c.g += (1 - c.g)*k; c.b += (1 - c.b)*k;
    return (cacheClaires[cle] = c.convertSRGBToLinear());
  }
  // Novembre 2026 : la couleur de camp n'est plus cuite dans une copie des géométries par camp
  // (4 camps = 4 jeux de lots et d'appels de dessin par type). Les sommets d'accent sont MARQUÉS
  // (attribut aAccent : 1 bleu, 2 rouge, 3 bleu foncé, 4 rouge foncé, 5 feu Halden) et le shader les
  // multiplie, PAR INSTANCE, par le rapport (teinte du camp / teinte d'origine) : même résultat
  // qu'avant à la précision du calcul près. L'instance porte l'indice du camp dans PALETTE
  // (instanceColor.x ; 0 = couleurs d'origine). Les calculs de teintes sont ceux de colorerModele.
  const ORIG_ACCENTS = [ACCENTS[0], ACCENTS[1], ACCENTS_F[0], ACCENTS_F[1], LUM_H];
  function marquer(geo, lum){
    if(!geo) return;
    if(geo.lod) marquer(geo.lod, lum);
    const A = geo.attributes.aAccent, Cc = geo.attributes.color;
    if(!A || !Cc) return;
    const C = Cc.array, F = A.array;
    for(let i = 0, v = 0; i < C.length; i += 3, v++){
      F[v] = memeTeinte(C, i, ACCENTS[0]) ? 1 : memeTeinte(C, i, ACCENTS[1]) ? 2
           : memeTeinte(C, i, ACCENTS_F[0]) ? 3 : memeTeinte(C, i, ACCENTS_F[1]) ? 4
           : (lum && memeTeinte(C, i, LUM_H)) ? 5 : F[v];
    }
    A.needsUpdate = true;
  }
  function marquerModele(M){
    const R = g => marquer(g, false), RL = g => marquer(g, true);
    if(M.genre === 'fantassin'){
      R(M.jambe); for(const k in M.torse) R(M.torse[k]);
      if(M.outil) R(M.outil.geo);
      RL(M.lum);
    } else if(M.genre === 'drone'){
      R(M.corps); R(M.pale); RL(M.lum);
    } else if(M.genre === 'avion'){
      R(M.corps); RL(M.lum);
    } else if(M.genre === 'helico'){
      R(M.corps); R(M.rotor); R(M.queue); R(M.arme); RL(M.lum);
    } else if(M.genre === 'vehicule'){
      R(M.coque); R(M.tourelle); R(M.canon); R(M.charge);
      if(M.radar) R(M.radar.geo);
      if(M.train.type === 'roues') R(M.train.geo);
      RL(M.lum); RL(M.gyro);
    }
  }
  const MAX_TEINTES = 8;
  const MULT_CAMP = {value:[]};
  for(let i = 0; i < MAX_TEINTES*5; i++) MULT_CAMP.value.push(new THREE.Vector3(1, 1, 1));
  const palette = new Map();      // '#rrggbb' -> indice (1 … MAX_TEINTES - 1)
  function indiceTeinte(hex){
    if(!hex) return 0;
    let i = palette.get(hex);
    if(i !== undefined) return i;
    if(palette.size >= MAX_TEINTES - 1) palette.clear();    // (nouvelle partie aux couleurs inédites : on repart à zéro)
    i = palette.size + 1;
    palette.set(hex, i);
    const vif = couleur(hex), bleu = hex === H.bleu, rouge = hex === K.rouge;
    const fonce = bleu ? couleur(H.bleuF) : rouge ? couleur(K.rougeF) : new THREE.Color(vif.r*0.28, vif.g*0.28, vif.b*0.28);
    const lum = bleu ? LUM_H : claire(hex, 0.45);
    const cible = [vif, vif, fonce, fonce, lum];
    for(let f = 0; f < 5; f++){
      const o = ORIG_ACCENTS[f], c = cible[f];
      MULT_CAMP.value[i*5 + f].set(c.r/Math.max(o.r, 1e-6), c.g/Math.max(o.g, 1e-6), c.b/Math.max(o.b, 1e-6));
    }
    return i;
  }
  // Remplacement de color_vertex (three r128) : couleur de sommet, puis teinte de camp des accents.
  const COULEUR_CAMP_VS = `
    #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
      vColor = vec3( 1.0 );
    #endif
    #ifdef USE_COLOR
      vColor *= color;
    #endif
    #ifdef USE_INSTANCING_COLOR
    {
      int ciCamp = int( instanceColor.x + 0.5 ), flCamp = int( aAccent + 0.5 );
      if( ciCamp > 0 && flCamp > 0 ) vColor *= uMultCamp[ ciCamp*5 + flCamp - 1 ];
    }
    #endif`;
  function teinteCampShader(sh){
    sh.uniforms.uMultCamp = MULT_CAMP;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAccent;\n#ifdef USE_INSTANCING_COLOR\nuniform vec3 uMultCamp[' + MAX_TEINTES*5 + '];\n#endif')
      .replace('#include <color_vertex>', COULEUR_CAMP_VS);
  }
  function colorerModele(M, hex){
    // Couleurs par défaut des factions : teintes d'origine exactes (un duel bleu/rouge ne change pas).
    const vif = couleur(hex), bleu = hex === H.bleu, rouge = hex === K.rouge;
    const fonce = bleu ? couleur(H.bleuF) : rouge ? couleur(K.rougeF) : new THREE.Color(vif.r*0.28, vif.g*0.28, vif.b*0.28);
    const lum = bleu ? LUM_H : claire(hex, 0.45);
    const R = g => recolorer(g, vif, fonce, null), RL = g => recolorer(g, vif, fonce, lum);
    if(M.genre === 'fantassin'){
      R(M.jambe); for(const k in M.torse) R(M.torse[k]);
      if(M.outil) R(M.outil.geo);
      RL(M.lum);
    } else if(M.genre === 'drone'){
      R(M.corps); R(M.pale); RL(M.lum);
    } else if(M.genre === 'avion'){
      R(M.corps); RL(M.lum);
    } else if(M.genre === 'helico'){
      R(M.corps); R(M.rotor); R(M.queue); R(M.arme); RL(M.lum);
    } else if(M.genre === 'vehicule'){
      R(M.coque); R(M.tourelle); R(M.canon); R(M.charge);
      if(M.radar) R(M.radar.geo);
      if(M.train.type === 'roues') R(M.train.geo);
      RL(M.lum); RL(M.gyro);
    }
  }
  // Couleur du camp d'une unité ('#rrggbb' en minuscules) ou null : camp neutre, envahisseurs,
  // camp inconnu ou couleur absente (le rendu garde alors l'aspect d'origine).
  const RE_HEX = /^#[0-9a-f]{6}$/;
  function couleurCampDe(u){
    if(!u || u.camp === 'N' || u.camp === 'X') return null;
    let c = null;
    try { c = (typeof camps !== 'undefined' && camps) ? camps[u.camp] : null; } catch(err){ c = null; }
    if(!c || typeof c.couleur !== 'string') return null;
    const brut = c.couleur;
    if(brut in hexNormes) return hexNormes[brut];
    const hex = brut.toLowerCase();
    return (hexNormes[brut] = RE_HEX.test(hex) ? hex : null);
  }
  const hexNormes = {};   // chaîne fournie -> forme normalisée (ou null si invalide)

  const FABRIQUES = {
    technicien:() => modeleOuvrier(true), sapeur:() => modeleOuvrier(false),
    operateur:modeleOperateur, conscrit:modeleConscrit,
    javelot:modeleJavelot, traqueur:modeleTraqueur, grenadier:modeleGrenadier, guetteur:modeleGuetteur,
    lynx:modeleLynx, bastion:modeleBastion, ours:modeleOurs, grele:modeleGrele, sentinelle:modeleSentinelle,
    faucheur:modeleFaucheur, dard:modeleDard, rodeur:modeleRodeur,
    rempart:modeleRempart, mecano:modeleMecano, infirmier:modeleInfirmier, atelier:modeleAtelier, depanneuse:modeleDepanneuse,
    frelon:() => modeleHelico('halden', 'mitrailleur'), busard:() => modeleHelico('halden', 'missiles'),
    taon:() => modeleHelico('karsk', 'mitrailleur'), vautour:() => modeleHelico('karsk', 'missiles'),
  };
  // Avions : le modèle dépend du type ET de la livrée (faction du camp).
  const AVIONS = {f15:modeleF15, f35:modeleF35, rafale:modeleRafale};
  // Forme d'un type d'après les données du moteur (si l'appelant ne la donne pas).
  function formeDe(type){
    return (typeof UNITES !== 'undefined' && UNITES && UNITES[type]) ? UNITES[type].forme : undefined;
  }
  // Faction d'une unité : celle de son camp (camps est une globale de jeu.js) ;
  // repli : camp N -> 'neutre', sinon faction « naturelle » du type.
  function factionDe(u){
    let c = null;
    try { c = (typeof camps !== 'undefined' && camps) ? camps[u.camp] : null; } catch(err){ c = null; }
    if(c && c.faction) return c.faction;
    if(u.camp === 'N') return 'neutre';
    return TYPES_KARSK[u.type] ? 'karsk' : 'halden';
  }
  // Fusion de géométries de Piece translatées : [[geo, x, y, z], ...].
  function fusionner(liste){
    const noms = ['position', 'normal', 'color', 'uv', 'aMatiere', 'aAccent'], tab = {};
    for(const k of noms) tab[k] = [];
    for(const [g0, x, y, z] of liste){
      const g = g0;     // géométries complètes : une ombre simplifiée assombrissait le fantassin (ombre propre décalée)
      for(const k of noms){
        const A = g.attributes[k];
        if(!A){ tab[k] = null; continue; }
        if(!tab[k]) continue;
        const a = A.array, T = tab[k];
        if(k === 'position') for(let i = 0; i < a.length; i += 3) T.push(a[i] + x, a[i+1] + y, a[i+2] + z);
        else for(let i = 0; i < a.length; i++) T.push(a[i]);
      }
    }
    const g = new THREE.BufferGeometry();
    for(const k of noms) if(tab[k]) g.setAttribute(k, new THREE.Float32BufferAttribute(tab[k], k === 'aAccent' ? 1 : k === 'uv' || k === 'aMatiere' ? 2 : 3));
    g.computeBoundingSphere();
    return g;
  }
  const modeles = {};
  // Modèle d'un type pour une faction. Les 10 types d'origine gardent leurs couleurs
  // propres pour Halden et Karsk ; seule la faction 'neutre' en a une variante.
  // Le camion (convoi) existe en trois livrées.
  // teinte : couleur du camp ('#rrggbb') ou null/absente (couleurs d'origine).
  function modele(type, forme, faction, teinte){
    if(forme === undefined) forme = formeDe(type);
    const collecteur = type === 'collecteur' || forme === 'collecteur';
    const camion = collecteur || type === 'convoi' || forme === 'camion';   // (livrée selon la faction)
    const avion = AVIONS[type] || (forme === 'avion' ? modeleF15 : null);
    const alien = type === 'dard' || type === 'rodeur' || forme === 'dard' || forme === 'rodeur';
    const variante = camion ? (faction === 'karsk' || faction === 'neutre' ? faction : 'halden')
                   : avion ? (faction === 'karsk' ? 'karsk' : faction === 'neutre' ? 'neutre' : 'halden')
                   : alien ? '' : (faction === 'neutre' ? 'neutre' : '');
    if(alien || variante === 'neutre') teinte = null;                       // ni Régie ni envahisseurs
    const cle = type + '|' + variante;     // (la teinte de camp est appliquée par instance : voir marquer)
    if(modeles[cle]) return modeles[cle];
    let f = collecteur ? () => modeleCollecteur(variante) : camion ? () => modeleCamion(variante) : avion ? () => avion(variante) : FABRIQUES[type];
    if(!f && forme === 'infanterie'){ // fantassin d'un type inconnu : silhouette selon son rôle et sa faction
      const role = (typeof UNITES !== 'undefined' && UNITES && UNITES[type]) ? UNITES[type].role : undefined, k = faction === 'karsk';
      f = role === 'bazooka' ? (k ? modeleGrenadier : modeleJavelot) : role === 'sniper' ? (k ? modeleGuetteur : modeleTraqueur)
        : role === 'reparateur' ? (k ? modeleInfirmier : modeleMecano) : (k ? modeleConscrit : modeleOperateur);
    }
    if(!f){ // type inconnu : repli selon la forme
      const k = faction === 'karsk';
      const role = (typeof UNITES !== 'undefined' && UNITES && UNITES[type]) ? UNITES[type].role : undefined;
      f = forme === 'ouvrier' ? () => modeleOuvrier(true) : forme === 'infanterie' ? modeleOperateur
        : forme === 'drone' ? modeleFaucheur : forme === 'artillerie' ? modeleGrele
        : forme === 'antiair' ? (k ? modeleSentinelle : modeleRempart)
        : forme === 'helico' ? () => modeleHelico(k ? 'karsk' : 'halden', role === 'missiles' ? 'missiles' : 'mitrailleur')
        : forme === 'atelier' ? (k ? modeleDepanneuse : modeleAtelier)
        : forme === 'dard' ? modeleDard : forme === 'rodeur' ? modeleRodeur : modeleLynx;
    }
    const tM = performance.now();
    lodFort = forme === 'infanterie' || forme === 'ouvrier';
    let M;
    try { M = f(); } finally { lodFort = false; }
    diagImg.modele = (diagImg.modele || 0) + performance.now() - tM;
    if(camion || avion){ if(variante === 'neutre') neutraliserModele(M); M.mat = M.matK ? matCorpsK : matCorps; }
    else if(alien) M.mat = matAlien;
    else if(variante === 'neutre'){ neutraliserModele(M); M.mat = matCorps; }
    else M.mat = (TYPES_KARSK[type] || M.matK || f === modeleGrele || f === modeleSentinelle) ? matCorpsK : matCorps;
    if(!alien && variante !== 'neutre'){ marquerModele(M); M.teintable = true; }   // avant l'occlusion cuite
    // Occlusion ambiante cuite (voir ombrer)
    if(M.genre === 'fantassin'){
      ombrer(M.jambe, HANCHE, 0, 12.5, 0.55);
      for(const k in M.torse) ombrer(M.torse[k], 0, 0, 12.5, 0.55);
      if(M.outil) ombrer(M.outil.geo, M.outil.y, 0, 12.5, 0.55);
    } else if(M.genre === 'drone'){
      ombrer(M.corps, 0, -3.6, 2.2, 0.6);
      ombrer(M.pale, 0, -1, 1, 1);
    } else if(M.genre === 'avion' || M.genre === 'dard'){
      ombrer(M.corps, 0, -3.2, 2.4, 0.72, 1.06);
    } else if(M.genre === 'helico'){
      ombrer(M.corps, 0, -M.yAxe, 4.5, 0.62, 1.06);
      ombrer(M.arme, M.posArme[1], -M.yAxe, 4.5, 0.62, 1.06);
    } else if(M.genre === 'marcheur'){
      ombrer(M.coque, 0, -5, 5, 0.5); ombrer(M.tete, M.pivotT[1], -5, 5, 0.5);
      ombrer(M.cuisse, 0, -3, 2, 0.75, 1.05); ombrer(M.tibia, 0, -3, 2, 0.75, 1.05);
    } else {
      const yT = M.pivotT[1], yC = yT + M.pivotC[1], hh = M.h*0.72;
      ombrer(M.coque, 0, 1.5, hh, 0.42);
      ombrer(M.tourelle, yT, 1.5, hh + 3, 0.42);
      ombrer(M.canon, yC, 1.5, hh + 3, 0.42);
      if(M.radar) ombrer(M.radar.geo, yT + M.radar.pos[1], 1.5, hh + 3, 0.42);
      ombrer(M.train.geo, M.train.type === 'roues' ? M.train.r : 0, 0, 8, 0.55, 1);
    }
    // Fantassin : ombre portée par UNE silhouette fixe (torse au repos et deux jambes droites)
    // au lieu de trois ou quatre pièces : un seul lot d'ombre par type.
    if(M.genre === 'fantassin'){
      const pose = [[M.torse.normal, 0, 0, 0], [M.jambe, 0, HANCHE, -1.15], [M.jambe, 0, HANCHE, 1.15]];
      if(M.outil) pose.push([M.outil.geo, M.outil.x, M.outil.y, M.outil.z]);
      M.silhouette = fusionner(pose);
    }
    // Les InstancedMesh (roues, pales) sont cullés via la sphère de leur géométrie : on l'élargit au véhicule.
    if(M.train && M.train.type === 'roues'){ const lodR = M.train.geo.lod; M.train.geo = M.train.geo.clone(); M.train.geo.lod = lodR || null; M.train.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), M.l*0.6); }
    if(M.pale){ M.pale.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 14); }
    return (modeles[cle] = M);
  }

  // =================================================================
  // 5. INSTANCIATION D'UNE UNITÉ
  // =================================================================
  let groupe = null;
  const objets = new Map();   // id d'entité -> état de rendu
  const epaves = [];          // états de rendu des morts (épaves, chutes)
  const vivantes = [];        // racines pointables (renvoyées par racines())
  const geoPointage = new THREE.BoxGeometry(1, 1, 1);
  const ECHELLE_DRONE = 1.3;
  let marque = 0, horloge = 0;

  // ---------------------------------------------------------------
  // Rendu par LOTS : chaque pièce d'unité est une simple « ancre » (Object3D
  // sans géométrie) qui porte .geometry / .material / .visible. À chaque image,
  // la matrice monde de chaque ancre est copiée dans un InstancedMesh partagé
  // par couple (géométrie, matériau). Le nombre d'appels de dessin ne dépend
  // donc plus du nombre d'unités (≈ 1 appel par type de pièce visible).
  // ---------------------------------------------------------------
  const lots = new Map();     // clé géométrie|matériau -> {im, n, cap}
  let partsCourantes = null;  // tableau des pièces de l'unité en cours de création
  function maillage(geo, mat, ombre){
    const a = new THREE.Object3D();
    a.geometry = geo; a.material = mat; a.ombre = ombre === 'seule' ? 'seule' : ombre !== false;
    partsCourantes.push(a);
    return a;
  }
  // Chaque lot a DEUX InstancedMesh qui partagent le même tampon d'instances : im (géométrie
  // complète, vue rapprochée) et imL (géométrie simplifiée geo.lod, ou la même s'il n'y en a pas).
  //   vue rapprochée : im dessiné à l'écran, imL seulement dans la passe d'ombres ;
  //   vue éloignée   : imL seul, à l'écran et dans les ombres.
  // La passe d'ombres n'utilise donc jamais que la version simplifiée. ombre === 'seule' : pièce
  // qui ne sert qu'à l'ombre (silhouette des fantassins), jamais dessinée à l'écran.
  // Les deux objets de chaque lot sont créés au préchauffage : aucun programme neuf en partie.
  function lot(geo, mat, ombre){
    const cle = geo.uuid + '|' + mat.uuid;
    let L = lots.get(cle);
    if(!L){
      L = {geo, geoL:geo.lod || geo, mat, ombre:ombre !== false, seule:ombre === 'seule', im:null, imL:null, n:0, cap:0,
        neuf:true, vL:false, decal:null};
      lots.set(cle, L);
      agrandir(L, CAP_LOT);
    }
    return L;
  }
  const CAP_LOT = 32;
  function agrandir(L, cap){
    diagImg.nAgrandir = (diagImg.nAgrandir || 0) + 1;
    if(L.im){ groupe.remove(L.im); groupe.remove(L.imL); L.im.dispose && L.im.dispose(); }
    const im = new THREE.InstancedMesh(L.geo, L.mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false; im.raycast = rien;
    im.matrixAutoUpdate = false;       // toujours à l'origine du groupe : pas de recomposition par image
    im.castShadow = false; im.receiveShadow = !LUMINEUX.has(L.mat);
    im.count = 0;
    const imL = new THREE.InstancedMesh(L.geoL, L.mat, 0);
    imL.instanceMatrix = im.instanceMatrix;
    imL.frustumCulled = false; imL.raycast = rien; imL.matrixAutoUpdate = false;
    imL.castShadow = L.ombre; imL.receiveShadow = im.receiveShadow;
    imL.count = 0; imL.visible = false;
    // chenilles : décalage de texture par instance (défilement des patins), une seule matière
    if(L.mat === matChenille){
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      a.setUsage(THREE.DynamicDrawUsage);
      if(L.decal) a.array.set(L.decal.array.subarray(0, Math.min(L.decal.count, cap)));
      L.decal = a;
      L.geo.setAttribute('aDecal', a); L.geoL.setAttribute('aDecal', a);
    }
    // matières teintables : indice de camp par instance (instanceColor.x, voir marquer)
    if(MATS_CAMP.has(L.mat)){
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap*3), 3);
      a.setUsage(THREE.DynamicDrawUsage);
      if(L.camp) a.array.set(L.camp.array.subarray(0, Math.min(L.camp.array.length, cap*3)));
      L.camp = im.instanceColor = imL.instanceColor = a;
      for(const g of [L.geo, L.geoL]) if(!g.attributes.aAccent) g.setAttribute('aAccent', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    }
    groupe.add(im); groupe.add(imL);
    L.im = im; L.imL = imL; L.cap = cap;
  }
  function deposer(a, ci){
    let L = a.lot;
    if(!L || a.lotG !== a.geometry || a.lotM !== a.material){ L = a.lot = lot(a.geometry, a.material, a.ombre); a.lotG = a.geometry; a.lotM = a.material; }
    if(L.n >= L.cap){
      const ancien = L.im.instanceMatrix.array, n = L.n;
      agrandir(L, L.cap * 2);
      L.im.instanceMatrix.array.set(ancien.subarray(0, n*16));
    }
    L.im.instanceMatrix.array.set(a.matrixWorld.elements, L.n*16);
    if(L.decal) L.decal.array[L.n] = a.decal || 0;
    if(L.camp) L.camp.array[L.n*3] = ci || 0;
    L.n++;
  }
  // Vue éloignée (géométries simplifiées), avec hystérésis : pas de va-et-vient au seuil.
  const LOD_LOIN = 1100, LOD_PRES = 1000;
  let loin = false;
  function majLoin(){
    const mode = R3D.Unites && R3D.Unites.lod;
    if(mode === 'non'){ loin = false; return; }
    if(mode === 'oui'){ loin = true; return; }
    const d = R3D.vue && typeof R3D.vue.distance === 'number' ? R3D.vue.distance : 0;
    if(!loin && d > LOD_LOIN) loin = true;
    else if(loin && d < LOD_PRES) loin = false;
  }
  // Passe d'ombres : les versions simplifiées des lots porteurs d'ombre y sont visibles le temps de
  // la passe (le rendu principal a déjà établi sa liste d'objets quand three.js la lance).
  let rendererCrochet = null;
  function poserCrochetOmbres(){
    const R = R3D.renderer;
    if(!R || !R.shadowMap || rendererCrochet === R) return;
    rendererCrochet = R;
    const sm = R.shadowMap, f = sm.render;
    sm.render = function(){
      for(const L of lotsActifs) if(L.ombre && L.n > 0) L.imL.visible = true;
      try { return f.apply(this, arguments); }
      finally { for(const L of lotsActifs) L.imL.visible = L.vL; }
    };
  }
  const lotsActifs = [];
  function deposerUnite(o){
    o.racine.updateMatrixWorld(true);
    const P = o.parts, ci = indiceTeinte(o.hex);
    for(let i = 0; i < P.length; i++){
      const a = P[i];
      if(!a.visible) continue;
      // une pièce dont un parent est masqué est masquée aussi
      deposer(a, ci);
    }
  }

  function creer(u){
    const hex = couleurCampDe(u);
    const M = modele(u.type, u.def && u.def.forme, factionDe(u), hex);
    const racine = new THREE.Group(); racine.userData.entId = u.id;
    const o = {u, M, racine, px:u.x, py:u.y, ang:u.angle, vit:0, vitF:0, acc:0, roul:0, pas:Math.random()*6, ampl:0,
      tPouss:Math.random()*0.1, tFumee:Math.random()*0.3, mort:false, tMort:0, vu:0, aerien:!!u.def.aerien,
      h0:0, inclX:0, inclZ:0, rotor:Math.random()*6, elev:0, radarA:Math.random()*6, phase:Math.random()*10, parts:[],
      ombreCase:OMBRE.rectangle, ombreK:0.75, hex:M.teintable ? hex : null};
    partsCourantes = o.parts;
    const pointage = new THREE.Mesh(geoPointage, matPointage);
    racine.add(pointage);

    if(M.genre === 'fantassin'){
      const corps = new THREE.Group(); racine.add(corps);
      // (ombre portée : la silhouette seule, voir modele)
      o.torse = maillage(M.torse.normal, matFantassin, false); corps.add(o.torse);
      o.jambeG = maillage(M.jambe, matFantassin, false); o.jambeG.position.set(0, HANCHE, -1.15); corps.add(o.jambeG);
      o.jambeD = maillage(M.jambe, matFantassin, false); o.jambeD.position.set(0, HANCHE, 1.15); corps.add(o.jambeD);
      if(M.outil){ o.outil = maillage(M.outil.geo, matFantassin, false); o.outil.position.set(M.outil.x, M.outil.y, M.outil.z); corps.add(o.outil); }
      if(M.silhouette){ o.mSil = maillage(M.silhouette, matFantassin, 'seule'); corps.add(o.mSil); }
      if(M.lum){ o.mLum = maillage(M.lum, matLum, false); corps.add(o.mLum); }
      // lance-roquettes : éclair de bouche + souffle arrière (montrés au tir)
      if(M.feu){ o.mEclair = maillage(M.feu, matFeu, false); o.mEclair.visible = false; corps.add(o.mEclair); o.tirVu = u.tirT; }
      o.bas = 0;     // tireur d'élite : 0 debout … 1 accroupi
      o.corps = corps;
      pointage.scale.set(16, 20, 16); pointage.position.y = 9;
      o.ombreL = 9; o.ombreP = 9; o.ombreCase = OMBRE.disque;
    } else if(M.genre === 'drone'){
      const corps = new THREE.Group(); racine.add(corps);
      o.mCorps = maillage(M.corps, matCorps); corps.add(o.mCorps);
      o.mLum = maillage(M.lum, matLum, false); o.mLum.receiveShadow = false; corps.add(o.mLum);
      o.mFlou = maillage(M.flou, matFlou, false); o.mFlou.receiveShadow = false; corps.add(o.mFlou);
      o.pales = M.moteurs.map(p => { const a = maillage(M.pale, matCorps); a.position.set(p[0], p[1], p[2]); corps.add(a); return a; });
      corps.scale.setScalar(ECHELLE_DRONE);
      o.corps = corps;
      pointage.scale.set(24, 14, 24);
      o.ombreL = 18; o.ombreP = 18; o.ombreCase = OMBRE.disque;
    } else if(M.genre === 'avion' || M.genre === 'dard'){
      // Avion : la racine est au sol de référence + altitude ; le corps, à l'axe du fuselage, porte
      // tangage (Z) puis roulis (X). Dard : même montage, sans train, à l'échelle M.echelle.
      const avion = M.genre === 'avion', ech = M.echelle || 1;
      const corps = new THREE.Group(); corps.rotation.order = 'ZYX'; racine.add(corps);
      corps.position.y = avion ? M.yAxe : 0; corps.scale.setScalar(ech);
      o.mCorps = maillage(M.corps, M.mat); corps.add(o.mCorps);
      o.mLum = maillage(M.lum, matLum, false); corps.add(o.mLum);
      o.mFeu = maillage(M.feu, matFeu, false); o.mFeu.position.x = M.xFeu; corps.add(o.mFeu);
      o.mEclair = maillage(M.eclair, matFeu, false); o.mEclair.position.set(M.posEclair[0], M.posEclair[1], M.posEclair[2]); o.mEclair.visible = false; corps.add(o.mEclair);
      if(avion){ o.mTrain = maillage(M.trainA, M.mat); o.mTrain.position.y = M.yTrain; corps.add(o.mTrain); }
      o.corps = corps;
      o.alt = typeof u.alt === 'number' ? u.alt : (u.auSol ? 0 : altitudeVol());
      o.vAlt = 0; o.roulis = 0; o.tang = 0; o.gaz = 0.4; o.train = o.alt < 14 ? 1 : 0; o.base = null; o.tBase = 0; o.secousse = 0; o.tSecousse = 1 + Math.random()*2;
      pointage.scale.set(M.l*ech*0.95, avion ? 9 : 7, M.env*ech*0.92); pointage.position.y = corps.position.y;
      o.ombreL = M.l*ech/OMBRE_UTILE; o.ombreP = M.env*ech/OMBRE_UTILE; o.ombreCase = M.ombre; o.ombreK = 0.6;
      o.trainees = null;                      // rubans attribués au premier vol (voir traineesAeronef)
    } else if(M.genre === 'helico'){
      // Hélicoptère : racine au sol de référence + altitude ; corps à l'axe du fuselage (tangage Z, roulis X).
      const corps = new THREE.Group(); corps.rotation.order = 'ZYX'; corps.position.y = M.yAxe; racine.add(corps);
      o.mCorps = maillage(M.corps, M.mat); corps.add(o.mCorps);
      o.mLum = maillage(M.lum, matLum, false); corps.add(o.mLum);
      o.rotorP = maillage(M.rotor, M.mat); o.rotorP.position.set(M.posRotor[0], M.posRotor[1], M.posRotor[2]); corps.add(o.rotorP);
      o.mFlou = maillage(M.flou, matFlouRotor, false); o.mFlou.position.copy(o.rotorP.position); corps.add(o.mFlou);
      o.rotorQ = maillage(M.queue, M.mat); o.rotorQ.position.set(M.posQueue[0], M.posQueue[1], M.posQueue[2]); corps.add(o.rotorQ);
      o.mArme = maillage(M.arme, M.mat); o.mArme.position.set(M.posArme[0], M.posArme[1], M.posArme[2]); corps.add(o.mArme);
      o.mEclair = maillage(M.eclair, matFeu, false); o.mEclair.visible = false;
      o.mEclair.position.set(M.posEclair[0], M.posEclair[1], M.posEclair[2]);
      (M.eclairSurArme ? o.mArme : corps).add(o.mEclair);
      o.corps = corps; o.tirVu = u.tirT; o.nTirs = 0;
      o.alt = typeof u.alt === 'number' ? u.alt : ALT_HELICO;
      o.vAlt = 0; o.roulis = 0; o.tang = 0; o.vfF = 0; o.vlF = 0; o.armeA = 0; o.rotorV = 26;
      pointage.scale.set(M.l*0.9, 9, M.p*1.4); pointage.position.y = M.yAxe;
      o.ombreL = M.l*0.8/OMBRE_UTILE; o.ombreP = M.p*1.1/OMBRE_UTILE; o.ombreCase = M.ombre; o.ombreK = 0.6;
    } else if(M.genre === 'marcheur'){
      const corps = new THREE.Group(); corps.position.y = M.yCorps; racine.add(corps);
      o.mCoque = maillage(M.coque, M.mat); corps.add(o.mCoque);
      o.mLum = maillage(M.lum, matLum, false); corps.add(o.mLum);
      const tourelle = new THREE.Group(); tourelle.position.set(M.pivotT[0], M.pivotT[1], M.pivotT[2]); corps.add(tourelle);
      o.mTete = maillage(M.tete, M.mat); tourelle.add(o.mTete);
      o.mLumT = maillage(M.lumT, matLum, false); o.mLumT.position.y = M.yLumT; tourelle.add(o.mLumT);
      // pattes : hanche (lacet) -> cuisse (tangage) -> tibia (pli du genou)
      o.pattes = HANCHES_RODEUR.map((h, i) => {
        const hanche = new THREE.Group(); hanche.position.set(h[0], M.yHanche, h[1]); corps.add(hanche);
        const cuisse = maillage(M.cuisse, M.mat); hanche.add(cuisse);
        const tibia = maillage(M.tibia, M.mat); tibia.position.x = M.L1; cuisse.add(tibia);
        // trot : les pattes en diagonale (0 et 3, 1 et 2) vont ensemble
        return {hanche, cuisse, tibia, hx:h[0], hz:h[1], px:PIEDS_RODEUR[i][0], pz:PIEDS_RODEUR[i][1], dephasage:(i === 0 || i === 3) ? 0 : 0.5};
      });
      o.corps = corps; o.tourelle = tourelle; o.yCorps = M.yCorps; o.pas = Math.random();
      pointage.scale.set(M.l, M.h*0.8, M.p*0.8); pointage.position.y = M.h*0.45;
      o.ombreL = M.l*1.5; o.ombreP = M.p*1.5; o.ombreCase = OMBRE.disque; o.ombreK = 0.5;
      poserPattes(o, u, 0);
    } else {
      if(M.train.type === 'chenilles'){ o.chenilles = maillage(M.train.geo, matsChenille[0], false); racine.add(o.chenilles); }
      else o.roues = M.train.pos.map(p => { const a = maillage(M.train.geo, M.mat, false); a.position.set(p[0], p[1], p[2]); racine.add(a); return a; });
      const corps = new THREE.Group(); racine.add(corps);
      o.mCoque = maillage(M.coque, M.mat); corps.add(o.mCoque);
      if(M.lum){ o.mLum = maillage(M.lum, matLum, false); o.mLum.receiveShadow = false; corps.add(o.mLum); }
      if(M.gyro){ o.mGyro = maillage(M.gyro, matLum, false); corps.add(o.mGyro); }
      const tourelle = new THREE.Group(); tourelle.position.set(M.pivotT[0], M.pivotT[1], M.pivotT[2]); corps.add(tourelle);
      o.mTourelle = maillage(M.tourelle, M.mat); tourelle.add(o.mTourelle);
      const pivotC = new THREE.Group(); pivotC.position.set(M.pivotC[0], M.pivotC[1], M.pivotC[2]); tourelle.add(pivotC);
      o.mCanon = maillage(M.canon, M.mat); pivotC.add(o.mCanon);
      if(M.radar){ o.mRadar = maillage(M.radar.geo, M.mat); o.mRadar.position.set(M.radar.pos[0], M.radar.pos[1], M.radar.pos[2]); tourelle.add(o.mRadar); }
      if(M.charge){ o.mCharge = maillage(M.charge, M.mat); o.mCharge.position.y = M.yCharge; o.mCharge.visible = false; corps.add(o.mCharge); o.recolte = 0; o.phaseBras = 0; }
      o.corps = corps; o.tourelle = tourelle; o.pivotC = pivotC;
      o.elev = M.elevationRepos || 0;
      pointage.scale.set(M.l*1.05, M.h, M.p*1.1); pointage.position.y = M.h/2;
      // silhouette rectangulaire arrondie, à peine plus grande que la caisse : seule sa frange floue dépasse
      o.ombreL = M.l*1.06/OMBRE_UTILE; o.ombreP = M.p*1.1/OMBRE_UTILE;
      if(M.reparateur){ o.relGrue = M.reposT || 0; o.elev = M.elevationRepos || 0; }
      majRoues(o);
    }
    // réparateurs : faisceau, source et impact (enfants de la racine, placés par majSoin)
    if(M.soin){
      o.mFaisceau = maillage(M.soin.faisceau, matFeu, false); o.mSource = maillage(M.soin.source, matFeu, false);
      o.mImpact = maillage(M.soin.impact, matFeu, false);
      for(const a of [o.mFaisceau, o.mSource, o.mImpact]){ a.visible = false; racine.add(a); }
      o.soin = 0;
    }
    groupe.add(racine);
    return o;
  }

  function liberer(o){
    if(o.trainees){ for(const T of o.trainees) lacherTrainee(T); o.trainees = null; }
    groupe.remove(o.racine);
  }

  // =================================================================
  // 6. ANIMATION PAR IMAGE
  // =================================================================
  function majRoues(o){
    if(!o.roues) return;
    const a = -o.roul / o.M.train.r;
    for(let i = 0; i < o.roues.length; i++) o.roues[i].rotation.z = a + i*0.7;
  }

  const Fx = () => R3D.Effets;

  // Altitude de vol (définie par le moteur dans jeu.js ; repli si absente).
  const altitudeVol = () => (typeof HAUTEUR_VOL !== 'undefined' ? HAUTEUR_VOL : 55);
  const niveauMer = () => (R3D.niveauMer !== undefined && R3D.niveauMer !== null ? R3D.niveauMer : 0);
  // Surface sous une unité aérienne : max(sol, niveau de la mer).
  function solAerien(x, y){
    const s = R3D.hauteurSol ? R3D.hauteurSol(x, y) : 0;
    return Math.max(s, niveauMer());
  }
  function surMer(x, y){ return !!R3D.hauteurSol && R3D.hauteurSol(x, y) < niveauMer(); }
  // Hauteur à passer aux émetteurs de R3D.Effets (mesurée depuis le terrain brut) pour une altitude Y donnée.
  function hauteurEffet(Y, x, y){ return Y - (R3D.hauteurSol ? R3D.hauteurSol(x, y) : 0); }

  // ---------- Avions et dards ----------
  // Surface de roulement d'un aéroport, au-dessus du sol de son centre (dalle + revêtement).
  // R3D.Batiments peut préciser la valeur exacte par R3D.Batiments.hauteurAire.
  const hautAire = () => (R3D.Batiments && typeof R3D.Batiments.hauteurAire === 'number') ? R3D.Batiments.hauteurAire : 1.6;
  let entsCourants = null;      // liste d'entités de l'image en cours (pour retrouver l'aéroport sous un avion)
  function aeroportSous(x, y){
    const E = entsCourants;
    if(!E) return null;
    for(let i = 0; i < E.length; i++){
      const b = E[i];
      if(b.est === 'batiment' && b.type === 'aeroport' && !b.mort && Math.abs(b.x - x) <= 84 && Math.abs(b.y - y) <= 84) return b;
    }
    return null;
  }
  // Sol de référence d'un avion : le terrain (ou la mer) ; près du sol, la piste de l'aéroport sous lui.
  function solAvion(o, u, alt, dt){
    let h = o.h0;
    if(alt < 30){
      let b = o.base;
      if(b && (b.mort || Math.abs(b.x - u.x) > 84 || Math.abs(b.y - u.y) > 84)) b = o.base = null;
      if(!b){ o.tBase -= dt; if(o.tBase <= 0){ o.tBase = 0.25; b = o.base = aeroportSous(u.x, u.y); } }
      if(b && R3D.hauteurSol) h += (R3D.hauteurSol(b.x, b.y) + hautAire() - h) * bornes(1 - (alt - 4)/26, 0, 1);
    } else o.base = null;
    return h;
  }
  function animerAeronef(o, u, dt, virage, ftir){
    const M = o.M, avion = M.genre === 'avion', racine = o.racine, corps = o.corps;
    const alt = typeof u.alt === 'number' ? u.alt : (u.auSol ? 0 : altitudeVol());
    if(dt > 0) o.vAlt += ((alt - o.alt)/dt - o.vAlt) * Math.min(1, dt*6);
    o.alt = alt;
    const vit = typeof u.vit === 'number' ? u.vit : o.vitF;
    const enVol = bornes(alt/22, 0, 1);
    const base = avion ? solAvion(o, u, alt, dt) : o.h0;
    o.phase += dt;
    // roulis : l'appareil s'incline dans le virage ; tangage : cabré quand il monte (décollage)
    let cibleR = bornes(virage*(avion ? 0.6 : 0.85), -1.15, 1.15) * enVol;
    let cibleT = (alt > 0.4 ? bornes(o.vAlt*0.012, -0.2, 0.42) : 0) + Math.abs(o.roulis)*0.08*enVol;
    let dy = 0;
    if(avion){
      dy = Math.sin(o.phase*1.7 + u.id)*0.5*enVol;                        // léger flottement
    } else {
      // dard : vol nerveux — frémissements continus, soubresauts brusques et espacés
      o.tSecousse -= dt;
      if(o.tSecousse <= 0){ o.tSecousse = 0.5 + Math.random()*1.6; o.secousse = (Math.random() < 0.5 ? -1 : 1)*(0.35 + Math.random()*0.5); }
      o.secousse *= Math.max(0, 1 - dt*3.5);
      cibleR += o.secousse + Math.sin(o.phase*9.1 + u.id)*0.07;
      cibleT += Math.sin(o.phase*6.3 + u.id*1.3)*0.05;
      dy = Math.sin(o.phase*5.2 + u.id)*1.1 + Math.sin(o.phase*11.7 + u.id*2.1)*0.5;
    }
    o.roulis += (cibleR - o.roulis) * Math.min(1, dt*(avion ? 3.5 : 7));
    o.tang += (cibleT - o.tang) * Math.min(1, dt*(avion ? 3 : 6));
    racine.position.set(u.x, base + alt + dy, u.y);
    racine.rotation.y = -u.angle;
    corps.rotation.set(o.roulis, 0, o.tang);
    // gaz : pleins gaz en montée, à l'accélération et au roulage de décollage ; coupés au parking
    const moteur = !avion || !u.auSol || vit > 6;
    const cibleG = !moteur ? 0 : avion ? bornes(0.5 + o.vAlt*0.02 + o.acc*0.004 + (alt < 2 && vit > 20 ? 0.5 : 0), 0.25, 1.15)
                                        : 0.7 + Math.sin(o.phase*8 + u.id)*0.2;
    o.gaz += (cibleG - o.gaz) * Math.min(1, dt*2.5);
    o.mFeu.visible = moteur && o.gaz > 0.03;
    if(o.mFeu.visible) o.mFeu.scale.x = (0.22 + o.gaz*0.95) * (0.92 + 0.08*Math.sin(o.phase*47 + u.id));
    // train : sorti près du sol, rentré en vol
    if(o.mTrain){
      const cible = alt < 14 ? 1 : 0;
      o.train += (cible - o.train) * Math.min(1, dt*2.2);
      if(Math.abs(cible - o.train) < 0.01) o.train = cible;
      o.mTrain.visible = o.train > 0.02;
      o.mTrain.scale.y = Math.max(0.02, o.train);
    }
    // éclair au tir
    o.mEclair.visible = ftir > 0;
    if(ftir > 0) o.mEclair.scale.setScalar(0.5 + ftir*0.9);
    const E = Fx();
    if(dt > 0 && E){
      // fumée d'un appareil très endommagé
      if(u.pv < u.pvMax*0.35 && E.emettreFumee){
        o.tFumee -= dt;
        if(o.tFumee <= 0){ o.tFumee = 0.1; E.emettreFumee(u.x, u.y, hauteurEffet(racine.position.y + corps.position.y, u.x, u.y), 0.7); }
      }
      // poussière soulevée au roulage rapide
      if(avion && alt < 4 && vit > 50 && !surMer(u.x, u.y) && E.emettrePoussiere){
        o.tPouss -= dt;
        if(o.tPouss <= 0){ o.tPouss = 0.1; E.emettrePoussiere(u.x - Math.cos(u.angle)*M.l*0.45, u.y - Math.sin(u.angle)*M.l*0.45, 0.6); }
      }
    }
  }
  // Traînées : tourbillons de saumon d'aile (avions), sillage lumineux (dard). Appelé après le
  // calcul des matrices de l'unité (les points d'émission sont lus dans le repère du corps).
  function traineesAeronef(o, u){
    const M = o.M, avion = M.genre === 'avion';
    const vit = typeof u.vit === 'number' ? u.vit : o.vitF;
    if(!(o.alt > 12 && vit > 30) || R3D.qualite === 'basse'){
      if(o.trainees){ for(const T of o.trainees) lacherTrainee(T); o.trainees = null; }
      return;
    }
    if(!o.trainees) o.trainees = M.bouts.map(() => avion ? prendreTrainee(0.92, 0.96, 1.0, 0, 2.4, 6) : prendreTrainee(0.49, 0.98, 0.82, 1, 3.6, 5));
    const I = avion ? bornes(0.14 + Math.abs(o.roulis)*0.7 + Math.abs(o.vAlt)*0.006, 0, 0.8) : 0.85;
    for(let i = 0; i < M.bouts.length; i++){
      const T = o.trainees[i];
      if(!T) continue;
      const b = M.bouts[i];
      _v.set(b[0], b[1], b[2]).applyMatrix4(o.corps.matrixWorld);
      nourrirTrainee(T, _v.x, _v.y, _v.z, I);
    }
  }

  // ---------- Rôdeur ----------
  // Pose les quatre pattes par cinématique inverse (deux segments, genou vers le haut). Le pied en
  // appui recule sous le corps à la vitesse du déplacement (il ne glisse donc pas), puis revient
  // en l'air ; il épouse le relief. affaisse : 0 debout … 1 effondré (pattes écartées, à plat).
  function poserPattes(o, u, affaisse){
    const M = o.M, c = Math.cos(u.angle), s = Math.sin(u.angle), yH = o.corps.position.y + M.yHanche;
    const S = 18 * (1 - affaisse), ecart = 1 + affaisse*0.7;        // foulée : 60 % d'un cycle de 30 px
    for(let i = 0; i < 4; i++){
      const P = o.pattes[i];
      let p = (o.pas + P.dephasage) % 1; if(p < 0) p += 1;
      let fx, leve = 0;
      if(p < 0.6) fx = 0.5 - p/0.6;                                             // appui
      else { const t = (p - 0.6)/0.4; fx = -0.5 + t*t*(3 - 2*t); leve = Math.sin(Math.PI*t); }   // transfert
      const X = P.px*ecart + fx*S, Z = P.pz*ecart;
      let ySol = 0;
      if(R3D.hauteurSol) ySol = bornes(R3D.hauteurSol(u.x + c*X - s*Z, u.y + s*X + c*Z) - o.h0, -9, 9);
      const Y = ySol + leve*6*o.ampl*(1 - affaisse) + 0.3;
      const dx = X - P.hx, dz = Z - P.hz, dy = Y - yH, dh = Math.hypot(dx, dz);
      const D = bornes(Math.hypot(dh, dy), M.L2 - M.L1 + 0.5, M.L1 + M.L2 - 0.2);
      const alpha = Math.acos(bornes((M.L1*M.L1 + D*D - M.L2*M.L2)/(2*M.L1*D), -1, 1));
      const beta = Math.acos(bornes((M.L1*M.L1 + M.L2*M.L2 - D*D)/(2*M.L1*M.L2), -1, 1));
      P.hanche.rotation.y = -Math.atan2(dz, dx);
      P.cuisse.rotation.z = Math.atan2(dy, dh) + alpha;
      P.tibia.rotation.z = beta - Math.PI;
    }
  }
  function animerMarcheur(o, u, dt, d, ftir){
    const M = o.M;
    o.racine.position.set(u.x, o.h0, u.y);
    o.racine.rotation.y = -u.angle;
    o.ampl += (bornes(o.vitF/30, 0, 1) - o.ampl) * Math.min(1, dt*5);
    o.pas += d / 30;                                    // un cycle de marche tous les 30 px (foulée de 18 px sur 60 % du cycle)
    o.phase += dt;
    // corps : balancement de la marche, respiration à l'arrêt, tassement au tir
    const w = o.pas*Math.PI*4;
    o.corps.position.y = M.yCorps + Math.sin(w)*0.9*o.ampl + Math.sin(o.phase*1.3)*0.5*(1 - o.ampl);
    o.corps.rotation.set(Math.sin(w*0.5)*0.035*o.ampl, 0, Math.cos(w)*0.02*o.ampl - ftir*0.05);
    poserPattes(o, u, 0);
    // lance dorsale : orientation, recul, cristal qui enfle au tir
    o.tourelle.rotation.y = -(typeof u.angleT === 'number' ? u.angleT - u.angle : 0);
    o.mTete.position.x = o.mLumT.position.x = -M.recul*ftir;
    const e = 1 + ftir*1.5; o.mLumT.scale.set(1, e, e);
    const E = Fx();
    if(dt > 0 && u.pv < u.pvMax*0.35 && E && E.emettreFumee){
      o.tFumee -= dt;
      if(o.tFumee <= 0){ o.tFumee = 0.35; E.emettreFumee(u.x, u.y, M.yCorps, 1 - u.pv/(u.pvMax*0.35)*0.6); }
    }
  }

  // ---------- Hélicoptères ----------
  // Surplace, vol bas (u.alt, défaut ALT_HELICO), rotors toujours en marche, nez baissé en
  // translation, inclinaison en virage et en glissade, canon de nez orienté vers la cible.
  function animerHelico(o, u, dt, temps, virage, ftir, dx, dy, tir){
    const M = o.M, R = o.racine, corps = o.corps;
    const alt = typeof u.alt === 'number' ? u.alt : ALT_HELICO;
    if(dt > 0) o.vAlt += ((alt - o.alt)/dt - o.vAlt) * Math.min(1, dt*6);
    o.alt = alt;
    o.phase += dt;
    const enVol = bornes(alt/8, 0, 1), c = Math.cos(u.angle), s = Math.sin(u.angle);
    let vf = 0, vl = 0;
    if(dt > 0){ vf = (dx*c + dy*s)/dt; vl = (-dx*s + dy*c)/dt; }
    const kv = Math.min(1, dt*3);
    o.vfF += (vf - o.vfF)*kv; o.vlF += (vl - o.vlF)*kv;
    const cibleT = (-bornes(o.vfF*0.0042, -0.12, 0.3) - bornes(o.acc*0.0012, -0.1, 0.1) + Math.sin(o.phase*0.9 + u.id)*0.015) * enVol;
    const cibleR = (bornes(virage*0.32, -0.38, 0.38) + bornes(o.vlF*0.004, -0.25, 0.25) + Math.sin(o.phase*0.7 + u.id*1.7)*0.02) * enVol;
    const k = Math.min(1, dt*3);
    o.tang += (cibleT - o.tang)*k; o.roulis += (cibleR - o.roulis)*k;
    const bob = (Math.sin(o.phase*1.3 + u.id)*0.9 + Math.sin(o.phase*2.9 + u.id*0.7)*0.3) * enVol;
    R.position.set(u.x, o.h0 + alt + bob, u.y);
    R.rotation.y = -u.angle;
    corps.rotation.set(o.roulis, 0, o.tang - ftir*0.03);
    // rotors (toujours en marche)
    o.rotor += dt*o.rotorV;
    o.rotorP.rotation.y = o.rotor;
    o.rotorQ.rotation.z = -o.rotor*4.3;
    // canon de nez : vers la cible, sinon dans l'axe
    const rel = (u.cible && typeof u.angleT === 'number') ? bornes(ecartAngle(u.angle, u.angleT), -1.7, 1.7) : 0;
    o.armeA += (rel - o.armeA)*Math.min(1, dt*6);
    o.mArme.rotation.y = -o.armeA;
    // éclair au tir ; lance-roquettes : côté alterné et bouffées de fumée aux paniers
    o.mEclair.visible = ftir > 0;
    if(ftir > 0){
      if(M.eclairSurArme) o.mEclair.scale.setScalar(0.6 + ftir*0.7);
      else o.mEclair.scale.set(0.5 + ftir*0.8, 0.5 + ftir*0.8, 1);
    }
    const E = Fx();
    if(u.tirT !== o.tirVu){
      o.tirVu = u.tirT; o.nTirs++;
      if(tir >= 0 && tir < 0.3 && E && E.emettreFumee && M.pods.length){
        R.updateMatrixWorld(true);
        for(const i of [2, 3]){                                // arrière des deux paniers
          const q = M.pods[i];
          _v.set(q[0], q[1], q[2]).applyMatrix4(corps.matrixWorld);
          E.emettreFumee(_v.x, _v.z, hauteurEffet(_v.y, _v.x, _v.z), 0.5);
        }
      }
    }
    if(dt > 0 && E){
      // souffle du rotor : poussière soulevée quand l'appareil vole bas au-dessus de la terre ferme
      const hSol = R.position.y - o.h0;
      if(hSol < 70 && !o.surMer && E.emettrePoussiere && R3D.qualite !== 'basse'){
        o.tPouss -= dt;
        if(o.tPouss <= 0){
          o.tPouss = 0.22 + hSol*0.006;
          const a = Math.random()*Math.PI*2, r = M.rR*(0.5 + Math.random()*0.5);
          E.emettrePoussiere(u.x + Math.cos(a)*r, u.y + Math.sin(a)*r, bornes(0.75 - hSol/110, 0.15, 0.7));
        }
      }
      if(u.pv < u.pvMax*0.35 && E.emettreFumee){
        o.tFumee -= dt;
        if(o.tFumee <= 0){ o.tFumee = 0.12; E.emettreFumee(u.x - c*6, u.y - s*6, hauteurEffet(R.position.y + M.yAxe + 3, u.x, u.y), 0.7); }
      }
    }
  }

  // ---------- Réparateurs ----------
  // Réparation en cours : u.cibleSoin vivante et dernier soin (u.repareT, horloge « temps ») récent.
  const DUREE_SOIN = 0.7;
  function soinActif(u, temps){
    const c = u.cibleSoin, t = typeof u.repareT === 'number' ? temps - u.repareT : -1;
    return !!c && !c.mort && t >= 0 && t < DUREE_SOIN;
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _inv = new THREE.Matrix4();
  // Place faisceau, source et impact entre le bout de l'outil et la surface de la cible.
  function majSoin(o, u, temps, dt){
    const M = o.M, S = M.soin, actif = soinActif(u, temps);
    o.soin += ((actif ? 1 : 0) - o.soin)*Math.min(1, dt*10);
    const vu = actif && o.soin > 0.15;
    o.mFaisceau.visible = o.mSource.visible = o.mImpact.visible = vu;
    if(!vu) return;
    const c = u.cibleSoin;
    // point visé : hauteur du modèle de la cible (unité) ou mi-hauteur d'un bâtiment
    const oc = c.est === 'unite' ? objets.get(c.id) : null;
    let cy;
    if(oc){
      const Mc = oc.M;
      cy = oc.racine.position.y + (Mc.genre === 'fantassin' ? 8 : Mc.yAxe !== undefined ? Mc.yAxe : Mc.genre === 'drone' ? 0 : (Mc.h || 12)*0.5);
    } else cy = (R3D.hauteurSol ? R3D.hauteurSol(c.x, c.y) : 0) + (c.est === 'batiment' ? 11 : 6);
    const ddx = c.x - u.x, ddz = c.y - u.y, D = Math.hypot(ddx, ddz);
    const ray = c.est === 'batiment' ? (c.rayon || 30)*0.75 : ((c.def && c.def.rayon) || 8)*0.7;
    const kD = D > 1 ? Math.max(0, D - Math.min(ray, D*0.85))/D : 0;
    o.racine.updateMatrixWorld(true);
    _inv.copy(o.racine.matrixWorld).invert();
    _b.set(u.x + ddx*kD, cy, u.y + ddz*kD).applyMatrix4(_inv);                 // impact (repère racine)
    const ancre = S.bout.ancre === 'canon' ? o.mCanon : o.corps;
    _a.set(S.bout.p[0], S.bout.p[1], S.bout.p[2]).applyMatrix4(ancre.matrixWorld).applyMatrix4(_inv);   // source
    o.mSource.position.copy(_a);
    o.mImpact.position.copy(_b);
    _v.subVectors(_b, _a);
    const L = _v.length();
    if(L < 0.5){ o.mFaisceau.visible = false; return; }
    o.mFaisceau.position.copy(_a);
    o.mFaisceau.quaternion.setFromUnitVectors(AXE_X, _v.multiplyScalar(1/L));
    const t = horloge*31 + u.id;
    if(S.type === 'soudure'){
      // arc qui grésille, gerbe d'étincelles qui change à chaque image
      const g = 0.6 + 0.6*Math.abs(Math.sin(t*1.7));
      o.mFaisceau.scale.set(L, g, g);
      o.mFaisceau.visible = Math.sin(t*2.3) > -0.6;
      o.mImpact.rotation.set(Math.random()*6.3, Math.random()*6.3, Math.random()*6.3);
      o.mImpact.scale.setScalar(0.65 + Math.random()*0.6);
      o.mSource.scale.setScalar(0.7 + Math.random()*0.5);
    } else {
      // soin : faisceau doux qui pulse, halo qui respire
      const p = 0.5 + 0.5*Math.sin(horloge*5 + u.id);
      o.mFaisceau.scale.set(L, 0.8 + p*0.5, 0.8 + p*0.5);
      o.mImpact.rotation.set(0, 0, 0);
      o.mImpact.scale.setScalar(0.8 + p*0.45);
      o.mSource.scale.setScalar(0.8 + p*0.3);
    }
  }

  function animer(o, u, temps, dt){
    const M = o.M;
    // --- vitesse déduite du déplacement ---
    let dx = u.x - o.px, dy = u.y - o.py, d = Math.hypot(dx, dy);
    if(d > 60){ dx = dy = d = 0; }                          // téléportation : on ignore
    o.px = u.x; o.py = u.y;
    const avance = dx*Math.cos(u.angle) + dy*Math.sin(u.angle);
    if(dt > 0){
      const v = Math.min(d / dt, 400), vPrec = o.vitF;
      o.vit = v;
      o.vitF += (v - o.vitF) * Math.min(1, dt*6);
      o.acc += (((o.vitF - vPrec) / dt) - o.acc) * Math.min(1, dt*5);
    }
    const virage = dt > 0 ? ecartAngle(o.ang, u.angle) / dt : 0;
    o.ang = u.angle;
    o.roul += avance;
    // Référence verticale : le sol pour les unités terrestres ; pour les unités aériennes,
    // la surface (sol ou mer, la plus haute) — hauteurSol descend jusqu'au fond marin.
    const h0 = o.aerien ? solAerien(u.x, u.y) : (R3D.hauteurSol ? R3D.hauteurSol(u.x, u.y) : 0);
    o.h0 = h0;
    if(o.aerien) o.surMer = surMer(u.x, u.y);
    const racine = o.racine;
    const tir = temps - u.tirT, ftir = (tir >= 0 && tir < 0.15) ? 1 - tir/0.15 : 0;

    if(M.genre === 'avion' || M.genre === 'dard'){ animerAeronef(o, u, dt, virage, ftir); return; }
    if(M.genre === 'helico'){ animerHelico(o, u, dt, temps, virage, ftir, dx, dy, tir); return; }
    const soigne = !!M.soin && soinActif(u, temps);
    const capSoin = soigne ? Math.atan2(u.cibleSoin.y - u.y, u.cibleSoin.x - u.x) : 0;
    if(M.genre === 'marcheur'){ animerMarcheur(o, u, dt, d, ftir); return; }

    if(M.genre === 'fantassin'){
      const vise = !!u.cible && !M.ouvrier;
      racine.position.set(u.x, h0, u.y);
      racine.rotation.y = -(vise ? u.angleT : u.angle);
      // marche : phase proportionnelle à la distance parcourue
      const cible = bornes(o.vitF / 40, 0, 1);
      o.ampl += (cible - o.ampl) * Math.min(1, dt*8);
      o.pas += d * 0.32;
      const sw = Math.sin(o.pas) * 0.62 * o.ampl;
      o.jambeG.rotation.z = sw; o.jambeD.rotation.z = -sw;
      o.corps.position.y = Math.abs(Math.cos(o.pas)) * 0.55 * o.ampl;
      o.corps.rotation.z = -0.08 * o.ampl;                     // légère inclinaison en avant
      o.corps.position.x = 0;
      if(M.ouvrier){
        const g = u.charge > 0 ? M.torse.charge : M.torse.normal;
        if(o.torse.geometry !== g) o.torse.geometry = g;
        if(u.travaille && o.ampl < 0.3){
          // coups d'outil
          o.phase += dt * 7.5;
          const c = Math.sin(o.phase);
          o.outil.rotation.z = 0.55 + c*0.85;
          o.corps.rotation.z = -0.12 - Math.max(0, -c)*0.12;
        } else {
          o.outil.rotation.z = -sw * 0.8;
        }
      } else if(M.reparateur){
        // réparateur : face à la cible, outil tendu pendant le soin
        const g = soigne ? M.torse.soin : M.torse.normal;
        if(o.torse.geometry !== g) o.torse.geometry = g;
        if(soigne){
          racine.rotation.y = -capSoin;
          o.corps.rotation.z = 0.05 + Math.sin(horloge*9 + u.id)*0.015;
        }
      } else {
        const g = vise ? M.torse.visee : M.torse.normal;
        if(o.torse.geometry !== g) o.torse.geometry = g;
        if(vise){ o.corps.rotation.z = 0; o.corps.position.x = -0.5 * ftir; }
        // tireur d'élite : posture basse (un genou à terre) dès qu'il s'arrête
        if(M.role === 'sniper'){
          o.bas += ((o.ampl < 0.2 ? 1 : 0) - o.bas) * Math.min(1, dt*5);
          const b = o.bas;
          if(b > 0.005){
            o.corps.position.y = o.corps.position.y*(1 - b) - 3.2*b;
            o.jambeD.rotation.z = -sw*(1 - b) + 1.2*b;        // jambe droite en avant, pied à plat
            o.jambeG.rotation.z = sw*(1 - b) - 1.45*b;        // jambe gauche en arrière, genou au sol
            o.corps.rotation.z -= 0.1*b;
          }
        }
        // lance-roquettes : éclair et souffle arrière, bouffée de fumée à chaque départ
        if(o.mEclair){
          o.mEclair.visible = vise && ftir > 0;
          if(u.tirT !== o.tirVu){
            o.tirVu = u.tirT;
            const E = Fx();
            if(vise && tir >= 0 && tir < 0.3 && E && E.emettreFumee){
              const a = u.angleT, c = Math.cos(a), s = Math.sin(a), q = M.arriere;
              E.emettreFumee(u.x + q[0]*c - q[2]*s, u.y + q[0]*s + q[2]*c, q[1], 0.55);
            }
          }
        }
      }
      return;
    }

    if(M.genre === 'drone'){
      const yaw = u.cible ? u.angleT : u.angle;
      // inclinaison dans le sens du mouvement (repère local du drone)
      let vf = 0, vl = 0;
      if(dt > 0){ vf = (dx*Math.cos(yaw) + dy*Math.sin(yaw)) / dt; vl = (-dx*Math.sin(yaw) + dy*Math.cos(yaw)) / dt; }
      const k = Math.min(1, dt*4);
      o.inclZ += (bornes(-vf*0.0026, -0.38, 0.38) - o.inclZ) * k;
      o.inclX += (bornes(vl*0.0026, -0.38, 0.38) - o.inclX) * k;
      o.phase += dt;
      racine.position.set(u.x, h0 + (typeof u.alt === 'number' ? u.alt : altitudeVol()) + Math.sin(o.phase*2.2 + u.id)*1.3, u.y);
      racine.rotation.y = -yaw;
      o.corps.rotation.set(o.inclX, 0, o.inclZ + ftir*0.12);
      o.rotor += dt * 55;
      for(let i = 0; i < 4; i++) o.pales[i].rotation.y = (i === 0 || i === 3 ? 1 : -1)*o.rotor + i;
      return;
    }

    // --- véhicules ---
    racine.position.set(u.x, h0, u.y);
    racine.rotation.y = -u.angle;
    // tangage (accélération), roulis (virage), vibrations du moteur
    const mouv = bornes(o.vitF / 60, 0, 1);
    o.phase += dt * (8 + o.vitF*0.25);
    const vib = Math.sin(o.phase*2.3) * 0.006 * mouv;
    // sans arme (convoi) ou orientation d'arme absente : tourelle dans l'axe
    const rel = (M.sansArme || typeof u.angleT !== 'number') ? 0 : u.angleT - u.angle, kick = ftir * (M.recul > 2 ? 0.07 : 0.03);
    o.corps.rotation.z = bornes(o.acc * 0.0011, -0.05, 0.05) + vib + kick*Math.cos(rel);
    o.corps.rotation.x = bornes(-virage * o.vitF * 0.00035, -0.04, 0.04) - kick*Math.sin(rel) + Math.cos(o.phase*1.7)*0.004*mouv;
    o.corps.position.y = Math.sin(o.phase*3.1) * 0.12 * mouv;
    // tourelle (rotation relative au corps)
    o.tourelle.rotation.y = -rel;
    // dépanneuse : la grue se tourne vers la cible et la flèche se lève ; repos dans l'axe
    if(M.reparateur){
      const vise = soigne ? ecartAngle(u.angle, capSoin) : M.reposT || 0;
      o.relGrue += ecartAngle(o.relGrue, vise)*Math.min(1, dt*2.5);
      o.tourelle.rotation.y = -o.relGrue;
      o.elev += ((soigne ? M.elevSoin : M.elevationRepos || 0) - o.elev)*Math.min(1, dt*2);
      o.pivotC.rotation.z = o.elev;
    }
    // élévation (Grêle : caisson ; Sentinelle : bitube)
    if(M.elevation){
      const vise = u.cible ? M.elevation : (M.elevationRepos || 0.02);
      o.elev += (vise - o.elev) * Math.min(1, dt*2.2);
      o.pivotC.rotation.z = o.elev;
    }
    // recul du canon
    o.mCanon.position.x = -M.recul * ftir;
    if(o.mRadar){ o.radarA += dt * 2.6; o.mRadar.rotation.y = o.radarA; }
    // gyrophares du convoi : clignotement (décalé d'une unité à l'autre)
    // (dépanneuses : seulement pendant une réparation)
    if(o.mGyro) o.mGyro.visible = (!M.reparateur || soigne) && Math.sin(horloge*7 + u.id*1.7) > -0.2;
    // collecteur : benne remplie selon la charge ; bras qui fraise juste après un prélèvement
    if(o.mCharge){
      const def = u.def || {}, cap = def.capacite > 0 ? def.capacite : 1;
      const r = bornes((u.charge || 0)/cap, 0, 1);
      o.mCharge.visible = r > 0.01;
      o.mCharge.scale.y = Math.max(0.05, r);
      const rec = typeof u.recolteT === 'number' ? temps - u.recolteT : 1e9, actif = rec >= 0 && rec < 0.8;
      o.recolte += ((actif ? 1 : 0) - o.recolte) * Math.min(1, dt*4);
      o.phaseBras += dt*5;
      o.pivotC.rotation.z = 0.3*(1 - o.recolte) + o.recolte*(-0.1 + 0.1*Math.sin(o.phaseBras));
      const E = Fx();
      if(actif && dt > 0 && E && E.emettrePoussiere){
        o.tPouss -= dt;
        if(o.tPouss <= 0){
          o.tPouss = 0.22;
          const av = M.pivotT[0] + M.pivotC[0] + 7, c = Math.cos(u.angle), s = Math.sin(u.angle);
          E.emettrePoussiere(u.x + c*av, u.y + s*av, 0.45);
        }
      }
    }
    // train de roulement
    if(o.chenilles){
      const ph = ((o.roul / PAS_CHENILLE) % 1 + 1) % 1;
      o.chenilles.decal = Math.floor(ph * PHASES_CHENILLE) / PHASES_CHENILLE;   // mêmes 16 crans qu'avant
    } else if(d > 0) majRoues(o);
    // poussière
    const E = Fx();
    if(dt > 0 && o.vitF > 18 && E && E.emettrePoussiere){
      o.tPouss -= dt;
      if(o.tPouss <= 0){
        o.tPouss = 0.14 + Math.random()*0.06;
        const ar = M.l*0.45, c = Math.cos(u.angle), s = Math.sin(u.angle);
        const lat = (Math.random() < 0.5 ? -1 : 1) * M.p*0.35;
        E.emettrePoussiere(u.x - c*ar - s*lat, u.y - s*ar + c*lat, bornes(o.vitF/110, 0.2, 1) * M.poussiere);
      }
    }
    // fumée d'un véhicule très endommagé
    if(dt > 0 && u.pv < u.pvMax*0.35 && E && E.emettreFumee){
      o.tFumee -= dt;
      if(o.tFumee <= 0){ o.tFumee = 0.35; E.emettreFumee(u.x, u.y, M.fumeeH, 1 - u.pv/(u.pvMax*0.35)*0.6); }
    }
  }

  // =================================================================
  // 7. MORTS ET ÉPAVES
  // =================================================================
  const DUREE_EPAVE = 25, DUREE_ENFONCE = 3, MAX_EPAVES = 40;

  function mourir(o){
    o.mort = true; o.tMort = 0;
    delete o.racine.userData.entId;
    if(o.trainees){ for(const T of o.trainees) lacherTrainee(T); o.trainees = null; }
    const M = o.M;
    o.chuteDir = Math.random() < 0.5 ? 1 : -1;
    if(o.mFaisceau) o.mFaisceau.visible = o.mSource.visible = o.mImpact.visible = false;
    if(M.genre === 'fantassin'){
      o.jambeG.rotation.z = 0.2; o.jambeD.rotation.z = -0.1;
      if(o.mLum) o.mLum.visible = false;
      if(o.mEclair) o.mEclair.visible = false;
    } else {
      // version calcinée : matériaux assombris, feux et lueurs éteints
      for(const a of o.parts){ if(LUMINEUX.has(a.material)) a.visible = false; else a.material = matEpave; }   // (matCorps, matCorpsK, matAlien, chenilles)
      if(M.genre === 'vehicule'){
        // tourelle de travers
        o.tourelle.rotation.y += (Math.random() - 0.5) * 1.2;
        o.tourelle.position.y -= 0.6;
        o.pivotC.rotation.z = M.elevation ? 0.05 : -0.08;
        o.mCanon.position.x = 0;
        o.corps.rotation.set((Math.random() - 0.5)*0.06, 0, (Math.random() - 0.5)*0.05);
        o.corps.position.y = -0.8;
      } else if(M.genre === 'drone'){
        o.chute = true; o.vChute = 0; o.spin = o.chuteDir * (5 + Math.random()*4);
      } else if(M.genre === 'helico'){
        if(o.racine.position.y - o.h0 > 6){
          // abattu en vol : le rotor de queue ne compense plus, l'appareil part en vrille et tombe
          const u = o.u, v = o.vitF*0.6;
          o.chute = true; o.vChute = 0; o.spin = o.chuteDir*(3.2 + Math.random()*2);
          o.vx = Math.cos(u.angle)*v; o.vz = Math.sin(u.angle)*v; o.tFeu = 0;
        } else {
          o.corps.rotation.set(o.chuteDir*0.3, 0, -0.06);
          o.corps.position.y = M.yAxe*0.8;
          o.yEpave = o.racine.position.y; o.rotorV = 0;
        }
      } else if(M.genre === 'avion' || M.genre === 'dard'){
        const hAxe = M.yAxe || 0;
        if(o.racine.position.y + hAxe - o.h0 > hAxe + 5){
          // abattu en vol : il poursuit sur sa lancée, part en vrille et pique (voir majEpaves)
          const u = o.u, v = typeof u.vit === 'number' ? u.vit : o.vitF;
          o.chute = true;
          o.vx = Math.cos(u.angle)*v; o.vz = Math.sin(u.angle)*v; o.vy = bornes(o.vAlt*0.5, -40, 40);
          o.spin = o.chuteDir * (1.6 + Math.random()*2.2);
          if(o.mTrain) o.mTrain.visible = false;
        } else {
          // détruit au sol : une jambe de train cède
          o.corps.rotation.set(o.chuteDir*0.16, 0, -0.03);
          o.corps.position.y -= 1.3;
          o.yEpave = o.racine.position.y;
        }
      } else if(M.genre === 'marcheur'){
        o.ampl = 0; o.pose = false;
        o.tourelle.rotation.y += (Math.random() - 0.5) * 1.2;
      }
    }
    epaves.push(o);
    while(epaves.length > MAX_EPAVES){ const v = epaves.shift(); liberer(v); }
  }

  function majEpaves(dt){
    const E = Fx();
    for(let i = epaves.length - 1; i >= 0; i--){
      const o = epaves[i], M = o.M;
      o.tMort += dt;
      const t = o.tMort, R = o.racine;
      if(M.genre === 'fantassin'){
        // chute sur le côté, puis s'enfonce et disparaît
        const k = bornes(t / 0.45, 0, 1);
        o.corps.rotation.set(o.chuteDir * k * k * 1.45, 0, 0);
        o.corps.position.y = 0;
        if(t > 2.5) R.position.y = o.h0 - (t - 2.5) * 6;
        if(t > 3.5){ liberer(o); epaves.splice(i, 1); }
        continue;
      }
      if(o.chute && (M.genre === 'avion' || M.genre === 'dard')){
        // aéronef abattu : trajectoire balistique, vrille, piqué, panache de fumée et de flammes
        const hAxe = M.yAxe || 0, frein = Math.max(0, 1 - dt*0.35);
        o.vy -= 115*dt; o.vx *= frein; o.vz *= frein;
        R.position.x += o.vx*dt; R.position.z += o.vz*dt; R.position.y += o.vy*dt;
        o.roulis += o.spin*dt; o.tang = Math.max(-1.1, o.tang - dt*0.6);
        o.corps.rotation.set(o.roulis, 0, o.tang);
        const x = R.position.x, y = R.position.z;
        o.h0 = solAerien(x, y); o.surMer = surMer(x, y);
        if(dt > 0 && E){
          const h = hauteurEffet(R.position.y + hAxe, x, y);
          if(E.emettreFumee) E.emettreFumee(x, y, h, 1.6);
          if(E.emettreFeu) E.emettreFeu(x, y, h, 0.6);
        }
        if(R.position.y + hAxe <= o.h0 + 2.5){
          // à la mer : l'épave disparaît dans l'eau
          if(o.surMer){ liberer(o); epaves.splice(i, 1); continue; }
          // impact : l'épave se pose sur le ventre, de travers ; poussière, flammes, sol brûlé
          o.chute = false; o.tMort = 0; o.tFumee = 0;
          R.position.y = o.yEpave = o.h0 - hAxe + 2.2;
          o.corps.rotation.set(o.chuteDir*(0.2 + Math.random()*0.35), 0, -0.1);
          if(R3D.ajouterBrulure) R3D.ajouterBrulure(x, y, M.genre === 'avion' ? 28 : 18);
          if(E){
            for(let n = 0; n < 26; n++){
              const a = n*2.4, r = 6 + (n%5)*4;
              if(E.emettrePoussiere) E.emettrePoussiere(x + Math.cos(a)*r, y + Math.sin(a)*r, 2);
              if(n < 12 && E.emettreFeu) E.emettreFeu(x + Math.cos(a)*r*0.5, y + Math.sin(a)*r*0.5, 3, 3);
            }
          }
        }
        continue;
      }
      if(o.chute && M.genre === 'helico'){
        // hélicoptère abattu : vrille de plus en plus rapide, chute, rotor qui ralentit, fumée et flammes
        const frein = Math.max(0, 1 - dt*0.8);
        o.vChute += 70*dt; o.vx *= frein; o.vz *= frein;
        R.position.x += o.vx*dt; R.position.z += o.vz*dt; R.position.y -= o.vChute*dt;
        o.spin *= 1 + dt*0.4;
        R.rotation.y += o.spin*dt;
        o.corps.rotation.x = bornes(o.corps.rotation.x + o.chuteDir*dt*0.35, -0.5, 0.5);
        o.corps.rotation.z = Math.max(-0.35, o.corps.rotation.z - dt*0.25);
        o.rotorV *= Math.max(0, 1 - dt*0.5); o.rotor += o.rotorV*dt;
        o.rotorP.rotation.y = o.rotor;
        const x = R.position.x, y = R.position.z;
        o.h0 = solAerien(x, y); o.surMer = surMer(x, y);
        o.tFeu -= dt;
        if(dt > 0 && E && o.tFeu <= 0){
          o.tFeu = 0.05;
          const h = hauteurEffet(R.position.y + M.yAxe + 2, x, y);
          if(E.emettreFumee) E.emettreFumee(x, y, h, 1.3);
          if(E.emettreFeu) E.emettreFeu(x, y, h, 0.5);
        }
        if(R.position.y <= o.h0 + 0.5){
          if(o.surMer){ liberer(o); epaves.splice(i, 1); continue; }
          // impact : couché sur le flanc, rotor tordu, poussière, flammes, sol brûlé
          o.chute = false; o.tMort = 0; o.tFumee = 0; o.rotorV = 0;
          R.position.y = o.yEpave = o.h0;
          o.corps.rotation.set(o.chuteDir*(0.95 + Math.random()*0.25), 0, -0.08);
          o.corps.position.y = M.yAxe*0.62;
          o.rotorP.rotation.z = o.chuteDir*0.35;
          o.rotorQ.visible = false;
          if(R3D.ajouterBrulure) R3D.ajouterBrulure(x, y, 20);
          if(E){
            for(let n = 0; n < 18; n++){
              const a = n*2.4, r = 5 + (n%4)*4;
              if(E.emettrePoussiere) E.emettrePoussiere(x + Math.cos(a)*r, y + Math.sin(a)*r, 1.6);
              if(n < 8 && E.emettreFeu) E.emettreFeu(x + Math.cos(a)*r*0.5, y + Math.sin(a)*r*0.5, 3, 2.5);
            }
          }
        }
        continue;
      }
      if(M.genre === 'marcheur' && !o.pose){
        // rôdeur : les pattes cèdent, le corps s'affaisse et bascule
        const k = bornes(t / 0.8, 0, 1), kk = k*k*(3 - 2*k);
        o.corps.position.y = M.yCorps + (6.5 - M.yCorps)*kk*kk;
        o.corps.rotation.set(o.chuteDir*0.2*kk, 0, -0.12*kk);
        poserPattes(o, o.u, kk);
        if(k >= 1){
          o.pose = true;
          if(E && E.emettrePoussiere) for(let n = 0; n < 14; n++) E.emettrePoussiere(R.position.x + Math.cos(n*2.4)*14, R.position.z + Math.sin(n*2.4)*14, 1.6);
        }
      }
      if(o.chute){
        // drone : chute rapide en vrille, puis épave au sol
        o.vChute += 260 * dt;
        R.position.y -= o.vChute * dt;
        R.rotation.y += o.spin * dt;
        o.corps.rotation.z += dt * 1.8; o.corps.rotation.x += dt * 0.9;
        // o.h0 = max(sol, mer) : au-dessus de la mer, l'épave s'arrête à la surface
        // et disparaît dans l'eau au lieu de tomber jusqu'au fond.
        if(o.surMer && R.position.y <= o.h0 + 1){
          liberer(o); epaves.splice(i, 1);
          continue;
        }
        if(!o.surMer && R.position.y <= o.h0 + 4){
          R.position.y = o.h0 + 4; o.chute = false; o.tMort = 0;
          o.corps.rotation.set(0.35 + Math.random()*0.2, 0, -0.25);
          if(E && E.emettrePoussiere) E.emettrePoussiere(R.position.x, R.position.z, 0.9);
        }
        continue;
      }
      // fumée et flammes au début de l'épave (débit limité)
      if(dt > 0 && t < 10 && E){
        o.tFumee -= dt;
        if(o.tFumee <= 0){
          o.tFumee = 0.28;
          const x = R.position.x, y = R.position.z, h = (M.fumeeH || 6) * 0.8;
          if(E.emettreFumee) E.emettreFumee(x, y, h, 1 - t/10);
          if(t < 5 && E.emettreFeu) E.emettreFeu(x, y, h*0.7, 1 - t/5);
        }
      }
      // (une épave d'avion repose plus bas que sa racine : on part de la hauteur où elle s'est posée)
      if(t > DUREE_EPAVE) R.position.y = (o.yEpave !== undefined ? o.yEpave : o.h0) - (t - DUREE_EPAVE) / DUREE_ENFONCE * (M.h || 12);
      if(t > DUREE_EPAVE + DUREE_ENFONCE){ liberer(o); epaves.splice(i, 1); }
    }
  }

  // =================================================================
  // 8. OMBRES DE CONTACT, ANNEAUX DE SÉLECTION, TRAÎNÉES (1 appel de dessin chacun)
  // =================================================================
  const MAX_OMBRES = 600, MAX_ANNEAUX = 300;
  let ombres = null, anneaux = null, nOmbres = 0, nAnneaux = 0, donOmbres = null;
  const COUL_J = couleur('#7dff8a'), COUL_I = couleur('#ff8f7a'), COUL_N = couleur('#dfe6ea');   // N (Régie) : gris clair
  const COUL_X = couleur('#7df9d0');                                                              // X : envahisseurs
  const hauteursBarre = {};   // cache de R3D.Unites.hauteurBarre (par type)

  function creerInstancies(){
    const gPlan = new THREE.PlaneGeometry(1, 1); gPlan.rotateX(-Math.PI/2);
    const gOmbre = gPlan.clone();
    donOmbres = new THREE.InstancedBufferAttribute(new Float32Array(MAX_OMBRES*2), 2);
    donOmbres.setUsage(THREE.DynamicDrawUsage);
    gOmbre.setAttribute('aDon', donOmbres);
    ombres = new THREE.InstancedMesh(gOmbre, matOmbre, MAX_OMBRES);
    ombres.frustumCulled = false; ombres.raycast = rien; ombres.renderOrder = 1; ombres.count = 0;
    ombres.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    anneaux = new THREE.InstancedMesh(gPlan, matAnneau, MAX_ANNEAUX);
    anneaux.frustumCulled = false; anneaux.raycast = rien; anneaux.renderOrder = 2; anneaux.count = 0;
    anneaux.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    anneaux.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ANNEAUX*3), 3);
    anneaux.instanceColor.setUsage(THREE.DynamicDrawUsage);
    groupe.add(ombres); groupe.add(anneaux);
  }
  // Plan horizontal : T(x,y,z)·Ry(a)·S(sx,1,sz)
  function ecrirePlan(im, i, x, y, z, a, sx, sz){
    const c = Math.cos(a), s = Math.sin(a), e = im.instanceMatrix.array, k = i*16;
    e[k] = c*sx; e[k+1] = 0; e[k+2] = -s*sx; e[k+3] = 0; e[k+4] = 0; e[k+5] = 1; e[k+6] = 0; e[k+7] = 0;
    e[k+8] = s*sz; e[k+9] = 0; e[k+10] = c*sz; e[k+11] = 0; e[k+12] = x; e[k+13] = y; e[k+14] = z; e[k+15] = 1;
  }
  // Ombre de contact d'une unité ; k : fondu (1 = pleine, 0 = absente).
  function ombre(o, k){
    if(nOmbres >= MAX_OMBRES || k <= 0) return;
    const R = o.racine;
    let x = R.position.x, z = R.position.z, y = o.h0, L = o.ombreL, P = o.ombreP, a = o.ombreK*k;
    if(o.aerien){
      // Unité aérienne : l'ombre est projetée au sol dans la direction opposée au soleil. Elle
      // s'éloigne donc de l'appareil quand il monte, pâlit et s'élargit un peu avec l'altitude.
      // Au sol (avion stationné), elle reste sous lui, sur la piste.
      const haut = R.position.y - o.h0 - 3;
      if(haut > 0.5){
        const S = R3D.dirSoleil;
        if(S){ const ky = Math.max(0.25, S.y); x -= S.x/ky*haut; z -= S.z/ky*haut; }
        y = solAerien(x, z);
        const f = bornes(1 - haut/170, 0.3, 1), g = 1.25 - f*0.25;
        a *= f; L *= g; P *= g;
      } else y = Math.max(o.h0, R.position.y);
    }
    donOmbres.array[nOmbres*2] = o.ombreCase; donOmbres.array[nOmbres*2 + 1] = a;
    ecrirePlan(ombres, nOmbres++, x, y + 0.45, z, R.rotation.y, L, P);
  }
  // Couleur d'anneau : celle du camp, éclaircie (cache par teinte, aucune allocation par image).
  // Novembre 2026 : plus d'exception pour le joueur (son anneau vert se confondait avec le camp K
  // vert de l'escarmouche à quatre) ; seuls les camps sans couleur gardent les anneaux d'origine.
  function couleurAnneau(u){
    if(u.camp === 'N') return COUL_N;
    if(u.camp === 'X') return COUL_X;
    const hex = couleurCampDe(u);
    if(!hex) return u.camp === 'J' ? COUL_J : COUL_I;
    return claire(hex, 0.35);
  }
  function anneau(o, u){
    if(nAnneaux >= MAX_ANNEAUX) return;
    const R = o.racine, M = o.M;
    const r = Math.max((u.def.rayon || 10) + (M.genre === 'fantassin' ? 5 : 6), M.rAnneau || 0, M.env ? M.env*(M.echelle || 1)*0.64 : 0);
    // Unité aérienne : l'anneau l'entoure à SON altitude (au sol quand elle y est posée).
    let y = o.h0 + 0.8;
    if(o.aerien) y = R.position.y - o.h0 > 8 ? R.position.y + (M.yAxe !== undefined ? M.yAxe - 0.6 : -2) : R.position.y + 0.8;
    const puls = 1 + Math.sin(horloge*4 + u.id)*0.035;
    ecrirePlan(anneaux, nAnneaux, R.position.x, y, R.position.z, horloge*0.6 + u.id, r*2.2*puls, r*2.2*puls);
    const c = couleurAnneau(u), a = anneaux.instanceColor.array, k = nAnneaux*3;
    a[k] = c.r; a[k+1] = c.g; a[k+2] = c.b;
    nAnneaux++;
  }

  // ---------- Traînées ----------
  // Rubans de TR_PTS points : le point 0 suit l'émetteur à chaque image, les suivants sont un
  // historique échantillonné tous les « pas » parcourus. Trois sommets par point (bord, cœur, bord :
  // les bords sont transparents), orientés face à la caméra. Tampons alloués une fois pour toutes.
  const TR_PTS = 16, TR_MAX = 40;
  const trainees = [], _pt = new Float32Array(4);
  let meshTrainees = null, trPos = null, trCoul = null, trAdd = null;
  function creerTrainees(){
    trainees.length = 0;
    for(let i = 0; i < TR_MAX; i++) trainees.push({libre:true, neuf:true, orphelin:false, n:0, frac:0, fondu:1,
      pts:new Float32Array((TR_PTS - 1)*4), tx:0, ty:0, tz:0, tI:0, r:1, g:1, b:1, add:0, larg:1, pas:6});
    const g = new THREE.BufferGeometry(), nS = TR_MAX*TR_PTS*3;
    trPos = new THREE.BufferAttribute(new Float32Array(nS*3), 3).setUsage(THREE.DynamicDrawUsage);
    trCoul = new THREE.BufferAttribute(new Float32Array(nS*4), 4).setUsage(THREE.DynamicDrawUsage);
    trAdd = new THREE.BufferAttribute(new Float32Array(nS), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', trPos); g.setAttribute('aCoul', trCoul); g.setAttribute('aAdd', trAdd);
    const idx = new Uint16Array(TR_MAX*(TR_PTS - 1)*12);
    let k = 0;
    for(let r = 0; r < TR_MAX; r++) for(let i = 0; i < TR_PTS - 1; i++){
      const a = (r*TR_PTS + i)*3, b = a + 3;                 // a : bord gauche, a + 1 : cœur, a + 2 : bord droit
      idx[k++] = a; idx[k++] = a + 1; idx[k++] = b + 1;  idx[k++] = a; idx[k++] = b + 1; idx[k++] = b;
      idx[k++] = a + 1; idx[k++] = a + 2; idx[k++] = b + 2;  idx[k++] = a + 1; idx[k++] = b + 2; idx[k++] = b + 1;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    meshTrainees = new THREE.Mesh(g, matTrainee);
    meshTrainees.frustumCulled = false; meshTrainees.raycast = rien; meshTrainees.renderOrder = 3;
    groupe.add(meshTrainees);
  }
  // Réserve un ruban (null si tous sont pris). add : 0 = voile clair (alpha), 1 = lueur (additif).
  function prendreTrainee(r, g, b, add, larg, pas){
    for(let i = 0; i < trainees.length; i++){
      const T = trainees[i];
      if(!T.libre) continue;
      T.libre = false; T.neuf = true; T.orphelin = false; T.n = 0; T.frac = 0; T.fondu = 1;
      T.r = r; T.g = g; T.b = b; T.add = add; T.larg = larg; T.pas = pas;
      return T;
    }
    return null;
  }
  function nourrirTrainee(T, x, y, z, I){
    const P = T.pts;
    if(T.neuf || Math.abs(x - T.tx) + Math.abs(z - T.tz) > 120){ T.n = 0; T.neuf = false; }     // premier point, ou saut : on repart de zéro
    T.tx = x; T.ty = y; T.tz = z; T.tI = I;
    const dx = x - P[0], dy = y - P[1], dz = z - P[2], d2 = dx*dx + dy*dy + dz*dz;
    if(T.n === 0 || d2 > T.pas*T.pas){
      P.copyWithin(4, 0, (TR_PTS - 2)*4);
      P[0] = x; P[1] = y; P[2] = z; P[3] = I;
      if(T.n < TR_PTS - 1) T.n++;
      T.frac = 0;
    } else T.frac = Math.sqrt(d2)/T.pas;
  }
  // L'émetteur a disparu : le ruban s'efface en une demi-seconde puis retourne à la réserve.
  function lacherTrainee(T){ if(T && !T.libre) T.orphelin = true; }
  // Point j d'un ruban dans _pt : 0 = tête (position courante), j >= 1 = historique.
  function pointTrainee(T, j){
    if(j <= 0 && !T.orphelin){ _pt[0] = T.tx; _pt[1] = T.ty; _pt[2] = T.tz; _pt[3] = T.tI; return; }
    const q = (Math.min(Math.max(j, 1), T.n) - 1)*4, H = T.pts;
    _pt[0] = H[q]; _pt[1] = H[q+1]; _pt[2] = H[q+2]; _pt[3] = H[q+3];
  }
  function majTrainees(dt){
    if(!meshTrainees) return;
    const cam = R3D.camera ? R3D.camera.position : null, P = trPos.array, C = trCoul.array, A = trAdd.array;
    let r = 0;
    for(let i = 0; i < trainees.length; i++){
      const T = trainees[i];
      if(T.libre) continue;
      if(T.orphelin){ T.fondu -= dt*2; if(T.fondu <= 0){ T.libre = true; continue; } }
      if(T.n < 1) continue;
      let sx = 0, sy = 0, sz = 1;                                // dernier vecteur latéral valide
      for(let j = 0; j < TR_PTS; j++){
        const jj = Math.min(j, T.n);                               // au-delà de la fin : points confondus (triangles dégénérés)
        pointTrainee(T, jj - 1); const ax = _pt[0], ay = _pt[1], az = _pt[2];
        pointTrainee(T, jj + 1); const bx = _pt[0], by = _pt[1], bz = _pt[2];
        pointTrainee(T, jj); const x = _pt[0], y = _pt[1], z = _pt[2], I = _pt[3];
        // latéral = direction du ruban × direction de la caméra
        const dx = ax - bx, dy = ay - by, dz = az - bz;
        const vx = cam ? cam.x - x : 0, vy = cam ? cam.y - y : 1, vz = cam ? cam.z - z : 0;
        const lx = dy*vz - dz*vy, ly = dz*vx - dx*vz, lz = dx*vy - dy*vx, L = Math.hypot(lx, ly, lz);
        if(L > 1e-5){ sx = lx/L; sy = ly/L; sz = lz/L; }
        const age = jj === 0 ? 0 : (jj - 1 + T.frac)/(TR_PTS - 1);  // 0 (tête) … 1 (point sur le point de disparaître)
        const w = T.larg*0.5*(0.55 + age*1.5);                      // le ruban s'élargit en vieillissant
        const alpha = j > T.n ? 0 : I * T.fondu * Math.pow(Math.max(0, 1 - age), 1.4) * (jj === 0 ? 0.5 : 1);
        const s = r*TR_PTS + j, o3 = s*9, o4 = s*12, o1 = s*3;
        P[o3] = x - sx*w; P[o3+1] = y - sy*w; P[o3+2] = z - sz*w;
        P[o3+3] = x; P[o3+4] = y; P[o3+5] = z;
        P[o3+6] = x + sx*w; P[o3+7] = y + sy*w; P[o3+8] = z + sz*w;
        for(let q = 0; q < 3; q++){
          C[o4 + q*4] = T.r; C[o4 + q*4 + 1] = T.g; C[o4 + q*4 + 2] = T.b; C[o4 + q*4 + 3] = q === 1 ? alpha : 0;
          A[o1 + q] = T.add;
        }
      }
      r++;
    }
    meshTrainees.geometry.setDrawRange(0, r*(TR_PTS - 1)*12);
    meshTrainees.visible = r > 0;
    if(r > 0){ trPos.needsUpdate = true; trCoul.needsUpdate = true; trAdd.needsUpdate = true; }
  }

  // =================================================================
  // 8 bis. PRÉCONSTRUCTION DES MODÈLES (contre les à-coups de première apparition)
  // Un modèle (type × faction × couleur de camp) est construit à la première unité qui le montre, et
  // chacune de ses pièces crée alors un lot (InstancedMesh) : construction des géométries, envoi à la
  // carte graphique, et compilation si la matière est nouvelle. On le fait d'avance : tout au
  // préchauffage, puis, quand les camps de la partie sont connus, quelques millisecondes par image.
  // =================================================================
  const TYPES_ALIENS = {dard:1, rodeur:1}, TYPES_NEUTRES = {convoi:1, collecteur:1};
  const PRECONSTRUCTION_MS = 2;          // budget par image de la préconstruction en partie
  let idFictif = -1e9, signatureCamps = '', filePrecon = [];
  const dejaPrecrees = new Set(), lotsVus = new Set(), geosEpave = new Set();
  function campsDuJeu(){ try { return (typeof camps !== 'undefined' && camps) ? camps : null; } catch(err){ return null; } }
  // Types qu'un camp peut montrer : ceux que cite sa faction (production, extras, IA…), ceux qu'il a
  // déjà en jeu (missions), le convoi ; null si la faction est inconnue (on prend alors tout).
  function typesDuCamp(C, id){
    let F = null;
    try { F = (typeof FACTIONS !== 'undefined' && FACTIONS && C[id]) ? FACTIONS[C[id].faction] : null; } catch(err){ F = null; }
    if(!F) return null;
    const S = new Set(['convoi']);
    const voir = v => { if(typeof v === 'string'){ if(UNITES[v]) S.add(v); } else if(v && typeof v === 'object') for(const k in v) voir(v[k]); };
    voir(F);
    try { if(typeof ents !== 'undefined' && ents) for(const e of ents) if(e && e.est === 'unite' && e.camp === id) S.add(e.type); } catch(err){ /* rien */ }
    return S;
  }
  // Couples [camp, type] à préconstruire. tous : y compris les camps N et X (préchauffage).
  function aConstruire(tous){
    const C = campsDuJeu(), out = [];
    if(!C || typeof UNITES === 'undefined' || !UNITES) return out;
    for(const id in C){
      if(!tous && (id === 'N' || id === 'X')) continue;
      const permis = id === 'N' || id === 'X' ? null : typesDuCamp(C, id);
      for(const type in UNITES){
        const D = UNITES[type];
        if(!D || D.rendu === 'aliens') continue;
        // camp X : ses unités terrestres ; camp N : ses convois ; camps colorés : ceux de leur faction
        if(id === 'X' ? !TYPES_ALIENS[type] : id === 'N' ? !TYPES_NEUTRES[type] : (permis ? !permis.has(type) : TYPES_ALIENS[type])) continue;
        const u = {camp:id, type};
        const cle = type + '|' + factionDe(u);     // (un modèle sert à toutes les couleurs de camp)
        if(dejaPrecrees.has(cle)) continue;
        dejaPrecrees.add(cle);
        out.push([id, type]);
      }
    }
    return out;
  }
  // Construit le modèle et les lots de toutes ses pièces (y compris cachées au départ : éclairs de
  // bouche, faisceaux de soin ; et matières des épaves et des chenilles), sans rien laisser en scène.
  // Les lots neufs restent visibles (vides) jusqu'au sync suivant : une image les compile et les envoie.
  function precreer(paire){
    const camp = paire[0], type = paire[1], D = UNITES[type];
    if(!D) return;
    const u = {id:idFictif++, est:'unite', type, def:D, camp, x:0, y:0, rayon:D.rayon || 8, pv:D.pv || 100, pvMax:D.pv || 100,
      angle:0, angleT:0, ordre:null, cible:null, chemin:null, mort:false, tirT:-99, toucheT:-99, repareT:-99,
      selectionne:false, alt:0, vit:0, auSol:true, phase:'sol', base:null, place:-1, munitions:D.munitions || 0, cibleSoin:null};
    const partsAvant = partsCourantes;
    let o = null;
    try { o = creer(u); }
    catch(err){ if(typeof console !== 'undefined') console.warn('[Unites] préconstruction de « ' + type + ' » ignorée :', err); }
    finally { partsCourantes = partsAvant; }
    if(!o) return;
    for(const a of o.parts){
      const cle = a.geometry.uuid + '|' + a.material.uuid;
      if(lotsVus.has(cle)) continue;
      lotsVus.add(cle);
      lot(a.geometry, a.material, a.ombre);
      if(!LUMINEUX.has(a.material) && !geosEpave.has(a.geometry)){ geosEpave.add(a.geometry); lot(a.geometry, matEpave, a.ombre); }
    }
    liberer(o);
  }
  // En partie (fin de sync) : toutes les 30 images, regarde si les camps ont changé (nouvelle partie,
  // couleurs choisies à l'écran d'escarmouche) ; puis préconstruit dans un budget de quelques ms.
  function preconstruire(){
    if(R3D !== window.R3D) return;          // copie isolée (r3d-vignettes.js) : rien à préparer
    if(!filePrecon.length){
      if(marque % 30 !== 1) return;
      const C = campsDuJeu();
      if(!C) return;
      const s = signatureDe(C);
      if(s === signatureCamps) return;
      signatureCamps = s;
      filePrecon = aConstruire(false);
      if(!filePrecon.length) return;
    }
    const t0 = performance.now();
    do {
      const p = filePrecon.pop(), t = performance.now();
      precreer(p);
      const d = performance.now() - t;
      if(d > precon.max){ precon.max = d; precon.type = p[1]; }
      precon.n++; precon.total += d;
    } while(filePrecon.length && performance.now() - t0 < PRECONSTRUCTION_MS);
  }
  const precon = {n:0, total:0, max:0, type:null};      // diagnostic (R3D.Unites.preconstruction())
  function signatureDe(C){
    let s = '';
    for(const id in C){ const c = C[id]; s += id + ':' + (c && c.faction) + ':' + (c && c.couleur) + ';'; }
    return s;
  }

  // =================================================================
  // 9. INTERFACE
  // =================================================================
  const diag = {pire:{ms:0}}, diagImg = {};
  R3D.Unites = {
    init(){
      groupe = new THREE.Group(); groupe.name = 'unites';
      R3D.scene.add(groupe);
      creerInstancies();
      creerTrainees();
    },
    sync(ents, temps, dt){
      if(!groupe) return;
      const tSync = performance.now();
      diagImg.creer = diagImg.nCreer = diagImg.mourir = diagImg.nAgrandir = diagImg.precon = diagImg.modele = diagImg.anim = diagImg.dep = 0;
      try { this.syncInterne(ents, temps, dt); }
      finally {
        const d = performance.now() - tSync;
        if(d > diag.pire.ms){ diag.pire = Object.assign({ms:+d.toFixed(2), t:+(+temps || 0).toFixed(2)}, diagImg); }
      }
    },
    // Diagnostic : pire sync depuis le dernier appel (ms) et sa décomposition (création d'unités,
    // de lots, morts, modèles, préconstruction). raz : remet à zéro.
    diagnostic(raz){ const r = diag.pire; if(raz) diag.pire = {ms:0}; return r; },
    // Niveau de détail : 'auto' (selon le recul de la caméra), 'non' (toujours complet), 'oui' (toujours simplifié).
    lod:'auto',
    syncInterne(ents, temps, dt){
      dt = dt || 0;
      majLoin(); poserCrochetOmbres();
      horloge += dt;
      marque++;
      vivantes.length = 0; nOmbres = 0; nAnneaux = 0;
      majEnvironnement();
      entsCourants = ents;
      for(const L of lots.values()) L.n = 0;
      for(let i = 0; i < ents.length; i++){
        const u = ents[i];
        if(u.est !== 'unite') continue;
        if(u.def && u.def.rendu === 'aliens') continue;      // vaisseau-mère : rendu par R3D.Aliens
        let o = objets.get(u.id);
        if(!o){ const t = performance.now(); o = creer(u); objets.set(u.id, o); diagImg.creer += performance.now() - t; diagImg.nCreer++; }
        o.u = u; o.vu = marque;
        const t1 = performance.now();
        animer(o, u, temps, dt);
        if(o.mFaisceau) majSoin(o, u, temps, dt);
        vivantes.push(o.racine);
        const t2 = performance.now();
        deposerUnite(o);
        diagImg.anim += t2 - t1; diagImg.dep += performance.now() - t2;
        if(o.M.genre === 'avion' || o.M.genre === 'dard') traineesAeronef(o, u);
        ombre(o, 1);
        if(u.selectionne) anneau(o, u);
      }
      for(const [id, o] of objets){
        if(o.vu === marque) continue;
        objets.delete(id);
        const t = performance.now();
        if(o.u.mort) mourir(o); else liberer(o);
        diagImg.mourir += performance.now() - t;
      }
      majEpaves(dt);
      for(const o of epaves){
        deposerUnite(o);
        if(o.M.genre === 'fantassin') ombre(o, bornes(1 - (o.tMort - 2.2), 0, 1));
        else if(!o.chute) ombre(o, o.tMort > DUREE_EPAVE ? bornes(1 - (o.tMort - DUREE_EPAVE)/DUREE_ENFONCE, 0, 1) : 1);
        else ombre(o, 1);
      }
      entsCourants = null;
      majTrainees(dt);
      // Lots : la version complète ou simplifiée selon la vue ; un lot neuf reste visible (vide) à sa
      // première image, pour que ses géométries partent vers la carte graphique avant tout usage.
      lotsActifs.length = 0;
      for(const L of lots.values()){
        const n = L.n, neuf = L.neuf;
        L.im.count = L.imL.count = n; L.neuf = false;
        if(n){ L.im.instanceMatrix.needsUpdate = true; if(L.decal) L.decal.needsUpdate = true; if(L.camp) L.camp.needsUpdate = true; lotsActifs.push(L); }
        L.im.visible = n > 0 ? !loin && !L.seule : neuf;
        L.vL = L.imL.visible = n > 0 ? loin && !L.seule : neuf;
      }
      ombres.count = nOmbres; ombres.instanceMatrix.needsUpdate = true;
      anneaux.count = nAnneaux; anneaux.instanceMatrix.needsUpdate = true; anneaux.instanceColor.needsUpdate = true;
      const tp = performance.now();
      preconstruire();      // après la mise à jour des lots : les lots neufs restent visibles (vides) une image
      diagImg.precon += performance.now() - tp;
    },
    // Préparation des camps (à appeler par le moteur pendant l'écran de lancement, une fois les camps
    // de la partie connus, couleurs comprises) : construit d'un coup tous les modèles aux couleurs des
    // camps et leurs lots, au lieu de les répartir sur les premières images de la partie (jusqu'à
    // 70 ms sur une image auparavant). Les lots neufs restent visibles (vides) à la première image,
    // qui envoie leurs géométries ; aucun programme n'est compilé (matières déjà préchauffées).
    // Renvoie {modeles, lots, ms}.
    preparerCamps(){
      if(!groupe) return null;
      const t0 = performance.now(), n0 = lots.size;
      const C = campsDuJeu();
      if(!C) return null;
      signatureCamps = signatureDe(C);
      const liste = filePrecon.concat(aConstruire(false));
      filePrecon = [];
      for(let i = 0; i < liste.length; i++) precreer(liste[i]);
      return {modeles:liste.length, lots:lots.size - n0, ms:Math.round(performance.now() - t0)};
    },
    racines(){ return vivantes; },
    // Diagnostic de la préconstruction en partie : modèles faits, temps total et pire cas (ms), reste à faire.
    preconstruction(){ return {faits:precon.n, totalMs:+precon.total.toFixed(1), maxMs:+precon.max.toFixed(1), pire:precon.type, reste:filePrecon.length, lots:lots.size}; },
    // Préchauffage (contrat commun, appelé par R3D.prechauffer pendant « Chargement… ») : construit
    // tous les modèles que la partie peut montrer (chaque type pour chaque camp en jeu, donc chaque
    // faction et couleur de camp) et crée leurs lots, y compris pour les pièces cachées au départ
    // (éclairs de bouche, faisceaux de soin) et pour les matières des épaves et des chenilles.
    // Aucune unité fictive ne reste dans la scène ni dans racines() : seules les réserves d'instances
    // (vides, count = 0) sont laissées visibles jusqu'au prochain sync, pour que renderer.compile et
    // l'image de préchauffage compilent leurs programmes et envoient leurs géométries.
    // Renvoie le nombre de lots créés.
    // Au menu (camps de la partie encore inconnus), deux camps fictifs sans couleur, un par faction,
    // suffisent à compiler tous les programmes (les matières ne dépendent pas de la couleur du camp) ;
    // les modèles aux couleurs des camps réels sont ensuite préconstruits pendant la partie, un peu à
    // chaque image (voir preconstruire, appelé par sync).
    prechauffer(){
      if(!groupe) return 0;
      const n0 = lots.size;
      let C = null;
      try { C = (typeof camps !== 'undefined' && camps) ? camps : null; } catch(err){ C = null; }
      const fictifs = [];
      if(C) for(const f of ['halden', 'karsk']){ const id = '\u0001' + f; if(!C[id]){ C[id] = {id, faction:f}; fictifs.push(id); } }
      if(C && !C.X){ C.X = {id:'X', faction:'aliens'}; fictifs.push('X'); }     // envahisseurs (camp créé par l'invasion)
      try {
        const liste = aConstruire(true);
        for(let i = 0; i < liste.length; i++) precreer(liste[i]);
      } finally {
        for(const id of fictifs) delete C[id];
      }
      for(const L of lots.values()){ L.im.visible = true; L.imL.visible = true; }
      if(meshTrainees) meshTrainees.visible = true;
      signatureCamps = '';            // la partie suivante revérifie ses camps
      return lots.size - n0;
    },
    // Hauteur (unités three, au-dessus de la référence de sol de l'unité) du sommet du
    // modèle + 4 : position verticale conseillée pour la barre de vie. Pour une unité
    // aérienne, l'altitude n'est PAS incluse : le moteur l'ajoute (altitudeDe, jeu.js).
    // Calculée une fois par type (mise en cache). Vaisseau-mère : voir R3D.Aliens.hauteurBarre.
    hauteurBarre(type, forme){
      const cle = type + '|' + (forme || '');
      if(hauteursBarre[cle] !== undefined) return hauteursBarre[cle];
      const M = modele(type, forme);
      const haut = g => { if(!g) return -Infinity; if(!g.boundingBox) g.computeBoundingBox(); return g.boundingBox.max.y; };
      let h;
      if(M.genre === 'fantassin'){
        h = Math.max(haut(M.torse.normal), haut(M.torse.visee), haut(M.torse.charge)) + 0.55;   // + rebond de la marche
      } else if(M.genre === 'drone'){
        h = 1.3 + haut(M.corps) * ECHELLE_DRONE;                                               // + oscillation du vol
      } else if(M.genre === 'avion' || M.genre === 'dard'){
        // axe du fuselage (au sol) + sommet de la dérive ; l'oscillation du vol est couverte par la marge
        h = (M.genre === 'avion' ? M.yAxe : 0) + haut(M.corps) * (M.echelle || 1) + (M.genre === 'dard' ? 1.6 : 0.5);
      } else if(M.genre === 'marcheur'){
        h = M.yCorps + 0.9 + Math.max(haut(M.coque), M.pivotT[1] + haut(M.tete));
      } else if(M.genre === 'helico'){
        // axe (posé) + sommet du fuselage ou du moyeu ; + balancement du vol stationnaire
        h = M.yAxe + Math.max(haut(M.corps), M.posRotor[1] + haut(M.rotor)) + 1.2;
      } else {
        const yT = M.pivotT[1];
        // canon / caisson / flèche : on tient compte de l'élévation maximale (Grêle, Sentinelle, dépanneuses)
        if(!M.canon.boundingBox) M.canon.computeBoundingBox();
        const bb = M.canon.boundingBox, e = Math.max(M.elevation || 0, M.elevationRepos || 0, M.elevSoin || 0);
        let hc = -Infinity;
        for(const x of [bb.min.x, bb.max.x]) for(const y of [bb.min.y, bb.max.y]) hc = Math.max(hc, x*Math.sin(e) + y*Math.cos(e));
        h = Math.max(haut(M.coque), yT + haut(M.tourelle), yT + M.pivotC[1] + hc,
          M.radar ? yT + M.radar.pos[1] + haut(M.radar.geo) : -Infinity);
      }
      return (hauteursBarre[cle] = h + 4);
    },
  };
})();
