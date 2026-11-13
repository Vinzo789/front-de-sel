'use strict';
/* =====================================================================
   FRONT DE SEL — post-traitement de l'image (R3D.Post)
   three.js r128 (global THREE). Aucun script d'exemple de three : les cibles
   de rendu et les ShaderMaterial sont écrits ici. Aucun stockage navigateur.

   Principe : la scène est rendue dans une cible en demi-précision AVEC son ton
   habituel (ACES et sRGB appliqués par les matériaux, exactement comme à
   l'écran : la cible porte l'encodage sRGB). Les étages travaillent donc sur
   l'image « prête à afficher », et la passe finale l'écrit telle quelle :
   ni second ton, ni seconde correction gamma.

   Étages, chacun pouvant être coupé (R3D.Post.etages) :
     bloom       seuil élevé, pyramide de réductions (1/2 … 1/64) puis remontée douce
     ao          occlusion ambiante tirée de la profondeur, demi-résolution, floutée (qualité haute)
     fxaa        anticrénelage de type FXAA, dans la passe finale
     etalonnage  courbe de contraste douce, noirs relevés, saturation, sable moins jaune,
                 ombres froides et lumières chaudes
     vignette    assombrissement discret des coins
     grain       grain d'image très léger, dans la passe finale (qualité haute seulement)
   Coût en qualité moyenne : la scène (sans anticrénelage matériel), environ
   3,5 lectures de texture par pixel pour le bloom, une passe finale plein écran.

   Résolution adaptative : R3D.echelleScene (entre 0 et 1, fixé par r3d-scene.js) réduit la cible de
   la scène (et le bloom, l'occlusion qui en dérivent) ; le canevas garde sa taille.

   Interface : R3D.Post = { init(renderer, scene, camera), redimensionner(l, h),
   rendre(dt), definirQualite(q), regler(obj), etages, reglages, info() }.
   rendre renvoie false quand le post-traitement est coupé ou en panne : l'appelant
   (R3D.rendre) dessine alors la scène directement.
   ===================================================================== */
(function(){
  const R3D = window.R3D = window.R3D || {};
  if(typeof THREE === 'undefined') return;

  const NIVEAUX_MAX = 6;                      // niveaux de la pyramide du bloom : 1/2, 1/4, … 1/64
  const QUALITES = {
    basse:   {actif:false, bloom:false, fxaa:false, etalonnage:false, vignette:false, ao:false, grain:false},
    moyenne: {actif:true,  bloom:true,  fxaa:true,  etalonnage:true,  vignette:true,  ao:false, grain:false},
    haute:   {actif:true,  bloom:true,  fxaa:true,  etalonnage:true,  vignette:true,  ao:true,  grain:true},
  };
  // Étages actifs (modifiables un par un : R3D.Post.etages.bloom = false).
  const E = Object.assign({}, QUALITES.moyenne);
  // Réglages de l'image. Les couleurs sont des facteurs (1 = neutre).
  const REGLAGES = {
    seuil:0.74, genou:0.14,                   // seuil du bloom, en lumière linéaire approchée (0,74 ≈ 86 % à l'écran)
    bloom:0.6, rayon:0.62,                    // intensité du halo, part des niveaux larges
    contraste:0.20, saturation:1.04, gain:1.0,
    ombres:[0.92, 0.985, 1.09], lumieres:[1.04, 1.012, 0.955],
    noirs:0.022,                              // relevé des noirs (0 = noir pur conservé), légèrement froid
    sable:0.18,                             // part de couleur retirée aux jaunes moyennement saturés (le sable)
    vignette:0.24,
    grain:0.03,                               // amplitude du grain (qualité haute), atténuée dans les lumières
    ao:1.2, aoRayon:30,                       // force de l'occlusion (ombres de contact), rayon en unités du monde
  };

  let renderer = null, scene = null, camera = null, pret = false, panne = false, verifie = 0;
  let aoVerifiee = false, aoPanne = false;    // l'occlusion a ses propres programmes : en cas de refus, elle seule est coupée
  let qualite = 'moyenne';
  let larg = 0, haut = 0, demiPrecision = false, profondeurDispo = false, profondeurTexture = false, typeCouleur = THREE.UnsignedByteType;
  let cibleScene = null, pyramide = [], cibleAO = null, cibleAO2 = null;
  let scenePost = null, camPost = null, triangle = null;
  let matClair, matReduire, matRemonter, matFinal, matAO = null, matFlouAO = null;
  let clefFinal = '', tempsGrain = 0;
  const _taille = new THREE.Vector2();

  // -----------------------------------------------------------------
  //  Shaders
  // -----------------------------------------------------------------
  const VS = `
    varying vec2 vUv;
    void main(){ vUv = position.xy*0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  // Passe claire : ne garde que ce qui dépasse le seuil (tirs, explosions, feux, lumières, reflets du
  // soleil), en moyenne de 4 lectures bilinéaires (bloc de 4 x 4 pixels : rien n'est sauté).
  const FS_CLAIR = `
    uniform sampler2D tSource;
    uniform vec2 uTexel;
    uniform float uSeuil, uGenou;
    varying vec2 vUv;
    vec3 clair(vec2 uv){
      vec3 c = min(texture2D(tSource, uv).rgb, vec3(4.0));
      c *= c;                                              // sRGB -> lumière linéaire (approché)
      float b = max(c.r, max(c.g, c.b));
      float g = clamp(b - uSeuil + uGenou, 0.0, 2.0*uGenou);
      float k = max(g*g/(4.0*uGenou + 1e-4), b - uSeuil)/max(b, 1e-4);
      return c*k;
    }
    void main(){
      vec3 s = clair(vUv + uTexel*vec2(-1.0, -1.0)) + clair(vUv + uTexel*vec2(1.0, -1.0))
             + clair(vUv + uTexel*vec2(-1.0, 1.0)) + clair(vUv + uTexel*vec2(1.0, 1.0));
      gl_FragColor = vec4(s*0.25, 1.0);
    }`;

  // Réduction de moitié : 13 lectures pondérées (stable quand un point lumineux se déplace).
  const FS_REDUIRE = `
    uniform sampler2D tSource;
    uniform vec2 uTexel;
    varying vec2 vUv;
    vec3 L(float x, float y){ return texture2D(tSource, vUv + uTexel*vec2(x, y)).rgb; }
    void main(){
      vec3 c = L(0.0, 0.0)*0.125;
      c += (L(-2.0, -2.0) + L(2.0, -2.0) + L(-2.0, 2.0) + L(2.0, 2.0))*0.03125;
      c += (L(0.0, -2.0) + L(-2.0, 0.0) + L(2.0, 0.0) + L(0.0, 2.0))*0.0625;
      c += (L(-1.0, -1.0) + L(1.0, -1.0) + L(-1.0, 1.0) + L(1.0, 1.0))*0.125;
      gl_FragColor = vec4(c, 1.0);
    }`;

  // Remontée : le niveau plus petit est fondu dans le niveau courant (mélange par alpha = uRayon).
  const FS_REMONTER = `
    uniform sampler2D tSource;
    uniform vec2 uTexel;
    uniform float uRayon;
    varying vec2 vUv;
    void main(){
      vec2 d = uTexel*0.5;
      vec3 s = texture2D(tSource, vUv + vec2(-d.x, -d.y)).rgb + texture2D(tSource, vUv + vec2(d.x, -d.y)).rgb
             + texture2D(tSource, vUv + vec2(-d.x, d.y)).rgb + texture2D(tSource, vUv + vec2(d.x, d.y)).rgb;
      gl_FragColor = vec4(s*0.25, uRayon);
    }`;

  // Occlusion ambiante : pour chaque pixel, position et normale reconstruites depuis la profondeur,
  // puis 8 points voisins en spirale ; ce qui dépasse du plan tangent assombrit.
  const FS_AO = `
    uniform sampler2D tProfondeur;
    uniform mat4 uProjInv;
    uniform vec2 uTexel;                                    // 1 / taille de la carte de profondeur
    uniform vec2 uEchelle;                                  // demi-hauteur de l'image en pixels / tan(angle), rayon monde
    uniform vec2 uLoin;                                     // distance où l'effet s'éteint (début, fin)
    varying vec2 vUv;
    vec3 pos(vec2 uv){
      float z = texture2D(tProfondeur, uv).x;
      vec4 p = uProjInv * vec4(uv*2.0 - 1.0, z*2.0 - 1.0, 1.0);
      return p.xyz/p.w;
    }
    void main(){
      float z0 = texture2D(tProfondeur, vUv).x;
      if(z0 >= 0.9999){ gl_FragColor = vec4(1.0); return; }  // ciel
      vec3 P = pos(vUv);
      float dist = -P.z;
      // Normale : on prend de chaque côté la différence la plus courte (pas de bavure aux arêtes).
      vec3 dxa = pos(vUv + vec2(uTexel.x, 0.0)) - P, dxb = P - pos(vUv - vec2(uTexel.x, 0.0));
      vec3 dya = pos(vUv + vec2(0.0, uTexel.y)) - P, dyb = P - pos(vUv - vec2(0.0, uTexel.y));
      vec3 dx = abs(dxa.z) < abs(dxb.z) ? dxa : dxb, dy = abs(dya.z) < abs(dyb.z) ? dya : dyb;
      vec3 N = normalize(cross(dx, dy));
      float rayon = uEchelle.y;
      float rEcran = clamp(rayon*uEchelle.x/dist, 4.0, 72.0);   // rayon en pixels de la carte de profondeur
      // Rotation du motif d'un pixel à l'autre (bruit régulier, effacé ensuite par le flou).
      float angle = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))*6.2832;
      float occ = 0.0;
      for(int i = 0; i < 8; i++){
        float fi = float(i);
        float a = angle + fi*2.39996;                           // angle d'or : spirale régulière
        float r = rEcran*sqrt((fi + 0.5)/8.0);
        vec3 V = pos(vUv + vec2(cos(a), sin(a))*r*uTexel) - P;
        float d2 = dot(V, V);
        float portee = max(1.0 - d2/(rayon*rayon*2.25), 0.0);
        // Sinus de l'élévation du voisin au-dessus du plan tangent (un petit seuil ignore le relief doux).
        occ += portee*portee * max(dot(N, V)/sqrt(d2 + 1e-3) - 0.1, 0.0);
      }
      float ao = clamp(1.0 - occ*0.42, 0.0, 1.0);
      ao = mix(ao, 1.0, smoothstep(uLoin.x, uLoin.y, dist));
      gl_FragColor = vec4(ao, dist/uLoin.y, 0.0, 1.0);
    }`;

  // Flou de l'occlusion : le centre et 4 lectures bilinéaires autour, pondérées par la ressemblance
  // de distance (l'ombre d'un objet ne bave pas sur ce qui est devant ou derrière lui).
  const FS_FLOU_AO = `
    uniform sampler2D tSource;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main(){
      vec2 c = texture2D(tSource, vUv).rg;
      float s = c.r, w = 1.0;
      for(int i = 0; i < 4; i++){
        vec2 o = vec2(i == 0 || i == 2 ? -1.2 : 1.2, i < 2 ? -1.2 : 1.2);
        vec2 t = texture2D(tSource, vUv + o*uTexel).rg;
        float k = max(0.0, 1.0 - abs(t.g - c.g)/(c.g*0.02 + 1e-4)) + 0.02;
        s += t.r*k; w += k;
      }
      gl_FragColor = vec4(s/w, c.g, 0.0, 1.0);
    }`;

  // Passe finale : anticrénelage, occlusion, bloom, étalonnage, vignettage, tramage.
  const FS_FINAL = `
    uniform sampler2D tScene, tBloom, tAO;
    uniform vec2 uTexel;
    uniform float uBloom, uContraste, uSaturation, uGain, uVignette, uAO, uNoirs, uSable, uGrain, uTemps;
    uniform vec3 uOmbres, uLumieres;
    varying vec2 vUv;
    const vec3 LUMA = vec3(0.299, 0.587, 0.114);
    vec3 lire(vec2 uv){ return min(texture2D(tScene, uv).rgb, vec3(1.0)); }
    #ifdef FXAA
    // Anticrénelage : on cherche la direction du contour dans les lumas voisines,
    // puis on moyenne le long de ce contour.
    vec3 lisser(){
      vec3 m = lire(vUv);
      float lNO = dot(lire(vUv + uTexel*vec2(-1.0, 1.0)), LUMA), lNE = dot(lire(vUv + uTexel*vec2(1.0, 1.0)), LUMA);
      float lSO = dot(lire(vUv + uTexel*vec2(-1.0, -1.0)), LUMA), lSE = dot(lire(vUv + uTexel*vec2(1.0, -1.0)), LUMA);
      float lM = dot(m, LUMA);
      float lMin = min(lM, min(min(lNO, lNE), min(lSO, lSE)));
      float lMax = max(lM, max(max(lNO, lNE), max(lSO, lSE)));
      if(lMax - lMin < max(0.035, lMax*0.11)) return m;      // zone lisse : rien à faire
      vec2 dir = vec2((lSO + lSE) - (lNO + lNE), (lNO + lSO) - (lNE + lSE));
      float att = max((lNO + lNE + lSO + lSE)*0.03125, 0.0078125);
      dir = clamp(dir/(min(abs(dir.x), abs(dir.y)) + att), -8.0, 8.0)*uTexel;
      vec3 a = 0.5*(lire(vUv - dir*(1.0/6.0)) + lire(vUv + dir*(1.0/6.0)));
      vec3 b = a*0.5 + 0.25*(lire(vUv - dir*0.5) + lire(vUv + dir*0.5));
      float lB = dot(b, LUMA);
      return (lB < lMin || lB > lMax) ? a : b;
    }
    #endif
    void main(){
      #ifdef FXAA
        vec3 col = lisser();
      #else
        vec3 col = lire(vUv);
      #endif
      #ifdef AO
        col *= max(mix(1.0, texture2D(tAO, vUv).r, uAO), 0.0);    // uAO > 1 : ombres de contact appuyées
      #endif
      #ifdef BLOOM
        col = sqrt(col*col + texture2D(tBloom, vUv).rgb*uBloom);   // addition en lumière linéaire (approchée)
      #endif
      col = clamp(col*uGain, 0.0, 1.0);
      #ifdef ETALONNAGE
        float y = dot(col, LUMA);
        col *= mix(uOmbres, uLumieres, smoothstep(0.05, 0.9, y));  // ombres froides, lumières chaudes
        // Sable moins jaune : seuls les jaunes moyennement saturés perdent de la couleur. Les
        // jaunes et orangés vifs (couleurs de camp, tirs, feux) sont hors de la plage et ne bougent pas.
        float jaune = min(col.r, col.g) - col.b;
        float ks = uSable*smoothstep(0.03, 0.14, jaune)*(1.0 - smoothstep(0.30, 0.48, jaune));
        col = mix(col, vec3(dot(col, LUMA)), ks);
        col = mix(vec3(dot(col, LUMA)), col, uSaturation);
        col = clamp(col, 0.0, 1.0);
        col = mix(col, col*col*(3.0 - 2.0*col), uContraste);       // courbe en S, douce
        col = col*(1.0 - uNoirs) + uNoirs*vec3(0.86, 1.0, 1.18);   // noirs relevés, un peu froids
      #endif
      #ifdef VIGNETTE
        vec2 q = vUv - 0.5;
        col *= 1.0 - uVignette*smoothstep(0.1, 0.55, dot(q, q));
      #endif
      #ifdef GRAIN
        // Grain : bruit par pixel renouvelé à chaque image, plus discret dans les lumières.
        float g = fract(sin(dot(gl_FragCoord.xy + uTemps*vec2(37.0, 17.0), vec2(12.9898, 78.233)))*43758.5453) - 0.5;
        col += g*uGrain*(1.0 - 0.6*dot(col, LUMA));
      #endif
      // Tramage d'un demi-niveau : pas de bandes dans les dégradés du ciel et de la brume.
      col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)))*43758.5453) - 0.5)/255.0;
      gl_FragColor = vec4(col, 1.0);
    }`;

  function materiau(fs, uniforms, opts){
    return new THREE.ShaderMaterial(Object.assign({uniforms, vertexShader:VS, fragmentShader:fs,
      depthTest:false, depthWrite:false, toneMapped:false, fog:false}, opts || {}));
  }

  // -----------------------------------------------------------------
  //  Cibles de rendu
  // -----------------------------------------------------------------
  function cible(l, h, type){
    const c = new THREE.WebGLRenderTarget(Math.max(1, l), Math.max(1, h), {minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
      format:THREE.RGBAFormat, type:type || typeCouleur, depthBuffer:false, stencilBuffer:false});
    c.texture.generateMipmaps = false;
    return c;
  }
  function liberer(){
    if(cibleScene){ if(cibleScene.depthTexture) cibleScene.depthTexture.dispose(); cibleScene.dispose(); cibleScene = null; }
    for(const c of pyramide) c.dispose();
    pyramide = [];
    if(cibleAO){ cibleAO.dispose(); cibleAO = null; }
    if(cibleAO2){ cibleAO2.dispose(); cibleAO2 = null; }
  }
  function dimensionner(l, h){
    liberer();
    larg = l; haut = h;
    // Scène : couleur en demi-précision si possible, profondeur sur 24 bits lisible par l'occlusion.
    cibleScene = new THREE.WebGLRenderTarget(l, h, {minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
      format:THREE.RGBAFormat, type:typeCouleur, depthBuffer:true, stencilBuffer:!profondeurDispo});
    cibleScene.texture.generateMipmaps = false;
    cibleScene.texture.encoding = THREE.sRGBEncoding;       // même sortie des matériaux qu'à l'écran
    // Texture de profondeur seulement quand l'occlusion s'en sert (qualité haute) : sinon un simple
    // tampon de profondeur, que la carte graphique peut compresser.
    profondeurTexture = profondeurDispo && E.ao;
    if(profondeurTexture){
      const d = new THREE.DepthTexture(l, h, THREE.UnsignedIntType);
      d.minFilter = d.magFilter = THREE.NearestFilter;
      cibleScene.depthTexture = d;
    }
    let pl = l, ph = h;
    for(let i = 0; i < NIVEAUX_MAX; i++){
      pl = Math.floor(pl/2); ph = Math.floor(ph/2);
      if(pl < 8 || ph < 8) break;
      pyramide.push(cible(pl, ph));
    }
  }
  // Occlusion : deux cibles en demi-résolution, créées seulement quand l'étage sert (qualité haute).
  // Le second canal porte la distance (précise en demi-précision).
  function ciblesOcclusion(){
    if(cibleAO) return;
    cibleAO = cible(Math.floor(larg/2), Math.floor(haut/2));
    cibleAO2 = cible(Math.floor(larg/2), Math.floor(haut/2));
  }

  // -----------------------------------------------------------------
  //  Initialisation
  // -----------------------------------------------------------------
  function init(r, s, c){
    renderer = r; scene = s; camera = c;
    panne = false; verifie = 0; aoVerifiee = false; aoPanne = false;
    const cap = r.capabilities, ext = r.extensions;
    const a = nom => { try { return ext.has ? ext.has(nom) : !!ext.get(nom); } catch(err){ return false; } };
    demiPrecision = cap.isWebGL2 ? a('EXT_color_buffer_float')
      : (a('OES_texture_half_float') && a('OES_texture_half_float_linear') && a('EXT_color_buffer_half_float'));
    typeCouleur = demiPrecision ? THREE.HalfFloatType : THREE.UnsignedByteType;
    profondeurDispo = cap.isWebGL2 || a('WEBGL_depth_texture');

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    triangle = new THREE.Mesh(geo, null);
    triangle.frustumCulled = false;
    scenePost = new THREE.Scene();
    scenePost.add(triangle);
    camPost = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const T = () => ({value:new THREE.Vector2()});
    matClair = materiau(FS_CLAIR, {tSource:{value:null}, uTexel:T(), uSeuil:{value:REGLAGES.seuil}, uGenou:{value:REGLAGES.genou}});
    matReduire = materiau(FS_REDUIRE, {tSource:{value:null}, uTexel:T()});
    matRemonter = materiau(FS_REMONTER, {tSource:{value:null}, uTexel:T(), uRayon:{value:REGLAGES.rayon}},
      {transparent:true, blending:THREE.NormalBlending});
    matAO = materiau(FS_AO, {tProfondeur:{value:null}, uProjInv:{value:new THREE.Matrix4()}, uTexel:T(), uEchelle:T(), uLoin:T()});
    matFlouAO = materiau(FS_FLOU_AO, {tSource:{value:null}, uTexel:T()});
    matFinal = materiau(FS_FINAL, {
      tScene:{value:null}, tBloom:{value:null}, tAO:{value:null}, uTexel:T(),
      uBloom:{value:0}, uContraste:{value:0}, uSaturation:{value:1}, uGain:{value:1}, uVignette:{value:0}, uAO:{value:0},
      uNoirs:{value:0}, uSable:{value:0}, uGrain:{value:0}, uTemps:{value:0},
      uOmbres:{value:new THREE.Vector3(1, 1, 1)}, uLumieres:{value:new THREE.Vector3(1, 1, 1)},
    });
    clefFinal = '';
    larg = haut = 0;
    pret = true;
  }

  function passe(mat, c){
    mat.uniformsNeedUpdate = true;
    triangle.material = mat;
    renderer.setRenderTarget(c);
    renderer.render(scenePost, camPost);
  }

  // Variante de la passe finale selon les étages actifs (recompilée seulement quand ils changent).
  function majFinal(ao){
    const grain = E.grain && REGLAGES.grain > 0;
    const clef = (E.fxaa ? 'F' : '') + (E.bloom ? 'B' : '') + (ao ? 'A' : '') + (E.etalonnage ? 'E' : '') + (E.vignette ? 'V' : '') + (grain ? 'G' : '');
    if(clef === clefFinal) return;
    clefFinal = clef;
    if(verifie > 1) verifie = 1;              // nouvelle variante du programme : elle sera vérifiée à son tour
    const d = {};
    if(E.fxaa) d.FXAA = 1;
    if(E.bloom) d.BLOOM = 1;
    if(ao) d.AO = 1;
    if(E.etalonnage) d.ETALONNAGE = 1;
    if(E.vignette) d.VIGNETTE = 1;
    if(grain) d.GRAIN = 1;
    matFinal.defines = d;
    matFinal.needsUpdate = true;
  }

  // Un programme qui n'a pas pu être compilé ou lié met le post-traitement en panne (rendu direct) ;
  // ceux de l'occlusion ambiante ne coupent que l'occlusion.
  function programmesValides(liste){
    for(const m of liste){
      const p = renderer.properties.get(m), prog = p && (p.currentProgram || p.program);
      if(prog && prog.diagnostics && prog.diagnostics.runnable === false) return false;
    }
    return true;
  }

  // -----------------------------------------------------------------
  //  Rendu d'une image
  // -----------------------------------------------------------------
  function rendre(dt){
    if(!pret || panne || !E.actif) return false;
    const r = renderer;
    r.getDrawingBufferSize(_taille);
    if(_taille.x < 2 || _taille.y < 2) return false;
    // Résolution adaptative (R3D.echelleScene, qualité Élevée sur écran dense) : seule la cible de la
    // scène et les étages qui en dérivent changent de taille ; le canevas, jamais. La passe finale
    // agrandit l'image à la taille de l'écran.
    const ech = R3D.echelleScene > 0 && R3D.echelleScene < 1 ? R3D.echelleScene : 1;
    const tl = Math.max(2, Math.round(_taille.x*ech)), th = Math.max(2, Math.round(_taille.y*ech));
    if(tl !== larg || th !== haut || !cibleScene) dimensionner(tl, th);
    const autoClear = r.autoClear;
    try {
      r.autoClear = true;
      r.setRenderTarget(cibleScene);
      if(verifie === 0){
        // Première image : la cible en demi-précision est-elle acceptée par la carte graphique ?
        const gl = r.getContext();
        r.clear();
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE){
          if(typeCouleur !== THREE.UnsignedByteType){
            typeCouleur = THREE.UnsignedByteType; demiPrecision = false;
            dimensionner(larg, haut); r.setRenderTarget(cibleScene);
          } else throw new Error('cible de rendu refusée');
        }
      }
      r.render(scene, camera);
      r.autoClear = false;

      const n = pyramide.length, bloom = E.bloom && n >= 2;
      if(bloom){
        let u = matClair.uniforms;
        u.tSource.value = cibleScene.texture; u.uTexel.value.set(1/larg, 1/haut);
        u.uSeuil.value = REGLAGES.seuil; u.uGenou.value = REGLAGES.genou;
        passe(matClair, pyramide[0]);
        u = matReduire.uniforms;
        for(let i = 1; i < n; i++){
          const src = pyramide[i - 1];
          u.tSource.value = src.texture; u.uTexel.value.set(1/src.width, 1/src.height);
          passe(matReduire, pyramide[i]);
        }
        u = matRemonter.uniforms;
        u.uRayon.value = REGLAGES.rayon;
        for(let i = n - 2; i >= 0; i--){
          const src = pyramide[i + 1];
          u.tSource.value = src.texture; u.uTexel.value.set(1/src.width, 1/src.height);
          passe(matRemonter, pyramide[i]);
        }
      }
      let ao = E.ao && !aoPanne && profondeurDispo && !!cibleScene.depthTexture && REGLAGES.ao > 0;
      if(ao){
        ciblesOcclusion();
        let u = matAO.uniforms;
        u.tProfondeur.value = cibleScene.depthTexture;
        u.uProjInv.value.copy(camera.projectionMatrixInverse);
        u.uTexel.value.set(1/larg, 1/haut);
        // Pixels (de la carte de profondeur) par unité du monde à la distance 1.
        u.uEchelle.value.set(0.5*haut*camera.projectionMatrix.elements[5], REGLAGES.aoRayon);
        const loin = scene.fog && scene.fog.far ? scene.fog.far : camera.far;
        u.uLoin.value.set(loin*0.45, loin*0.8);
        passe(matAO, cibleAO);
        u = matFlouAO.uniforms;
        u.tSource.value = cibleAO.texture; u.uTexel.value.set(1/cibleAO.width, 1/cibleAO.height);
        passe(matFlouAO, cibleAO2);
        if(!aoVerifiee){
          // Premier passage : si la carte graphique a refusé un des deux programmes, l'image
          // serait noircie. On coupe alors l'occlusion, et elle seule.
          aoVerifiee = true;
          if(!programmesValides([matAO, matFlouAO])){
            aoPanne = true; ao = false;
            if(typeof console !== 'undefined') console.warn('[Post] occlusion ambiante coupée : shader refusé');
          }
        }
      }
      majFinal(ao);
      const u = matFinal.uniforms;
      u.tScene.value = cibleScene.texture;
      u.tBloom.value = bloom ? pyramide[0].texture : null;
      u.tAO.value = ao ? cibleAO2.texture : null;
      u.uTexel.value.set(1/larg, 1/haut);
      u.uBloom.value = REGLAGES.bloom; u.uAO.value = REGLAGES.ao;
      u.uContraste.value = REGLAGES.contraste; u.uSaturation.value = REGLAGES.saturation; u.uGain.value = REGLAGES.gain;
      u.uVignette.value = REGLAGES.vignette;
      u.uNoirs.value = REGLAGES.noirs; u.uSable.value = REGLAGES.sable; u.uGrain.value = REGLAGES.grain;
      tempsGrain = (tempsGrain + 1) % 97;                   // une valeur par image : le grain ne reste pas figé
      u.uTemps.value = tempsGrain;
      u.uOmbres.value.fromArray(REGLAGES.ombres); u.uLumieres.value.fromArray(REGLAGES.lumieres);
      passe(matFinal, null);
      if(verifie < 3 && ++verifie === 3 && !programmesValides([matClair, matReduire, matRemonter, matFinal])) throw new Error('shader de post-traitement refusé');
    } catch(err){
      panne = true;
      r.setRenderTarget(null); r.autoClear = autoClear;
      if(typeof console !== 'undefined') console.warn('[Post] post-traitement coupé : ' + (err && err.message));
      return false;
    }
    r.setRenderTarget(null);
    r.autoClear = autoClear;
    return true;
  }

  function definirQualite(q){
    if(!QUALITES[q]) q = 'moyenne';
    qualite = q;
    Object.assign(E, QUALITES[q]);
    if(cibleScene && profondeurTexture !== (profondeurDispo && E.ao)) larg = haut = 0;   // cible refaite à l'image suivante
  }
  // Modifie des réglages : R3D.Post.regler({bloom:0.8, vignette:0.3}).
  function regler(o){
    if(!o) return REGLAGES;
    for(const k of Object.keys(o)){
      if(!(k in REGLAGES)) continue;
      if(Array.isArray(REGLAGES[k])){ if(o[k] && o[k].length >= 3){ REGLAGES[k][0] = +o[k][0]; REGLAGES[k][1] = +o[k][1]; REGLAGES[k][2] = +o[k][2]; } }
      else if(isFinite(o[k])) REGLAGES[k] = +o[k];
    }
    return REGLAGES;
  }

  R3D.Post = {
    init, rendre, definirQualite, regler,
    // Les cibles sont recréées à la taille du tampon de dessin à l'image suivante.
    redimensionner(l, h){ larg = haut = 0; },
    etages:E, reglages:REGLAGES,
    get actif(){ return pret && !panne && E.actif; },
    get qualite(){ return qualite; },
    info(){ return {actif:pret && !panne && E.actif, panne, aoPanne, qualite, demiPrecision, profondeur:profondeurDispo, taille:[larg, haut],
      niveaux:pyramide.length, etages:Object.assign({}, E)}; },
  };
})();
