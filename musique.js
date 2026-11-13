/* ============================================================================
   Front de Sel — musique.js
   Musique 100 % générée par la Web Audio API : aucun fichier audio, aucune
   bibliothèque. Style : rock industriel électronique de jeu de stratégie de la
   fin des années 1990 (boîte à rythmes lourde, caisses claires martiales,
   basse saturée, accords de puissance distordus, coups d'orchestre, nappes).
   Toutes les mélodies, tous les riffs et toutes les suites d'accords de ce
   fichier sont des compositions originales écrites pour Front de Sel.

   Interface publique : window.Musique
     init()            crée l'AudioContext (à appeler après un geste utilisateur)
     jouer(nom)        'menu' | 'briefing' | 'calme' | 'tension' | 'combat' |
                       'victoire' | 'defaite' | 'invasion' ; null ou 'silence'
                       pour arrêter
     intensite(x)      0..1 ; en jeu, choisit calme / tension / combat
                       (avec hystérésis : pas de va-et-vient) ; pendant
                       'invasion', fait passer de la menace à l'assaut
     volume(v)         0..1
     couper(b)         true : coupe le son (et suspend le calcul audio)
     estCoupee()
     courante()        nom de la piste en cours (ou null)
     pistes, titres    liste des pistes et leurs titres
     exporterWav(nom, secondes)   télécharge un .wav de la piste (rendu hors ligne)
     rendre(nom, secondes, options)  rendu hors ligne (AudioBuffer), pour les tests
   Tout est sûr si appelé avant init() : les réglages sont mémorisés.

   Organisation :
     1. Outils (hasard à graine, notes, accords, motifs)
     2. Chaîne maître (compresseur, limiteur, écrêteur doux, réverbération)
     3. Tranches de console (canaux persistants par piste)
     4. Instruments (une fonction par son)
     5. Compositions (les huit pistes, en données)
     6. Lecteur (ordonnancement pas à pas, forme, variations, paliers)
     7. Moteur (fondus enchaînés, intensité et hystérésis)
     8. Rendu hors ligne et export WAV
     9. Interface publique
   ============================================================================ */
(function () {
  'use strict';

  /* ==========================================================================
     1. OUTILS
     ========================================================================== */

  // Générateur pseudo-aléatoire à graine (mulberry32) : mêmes variations pour
  // une même graine, ce qui rend les rendus de test reproductibles.
  function aleaGraine(graine) {
    let s = (graine >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NOTES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
    G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

  function frequence(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  // « E5 » → numéro MIDI (C4 = 60).
  function noteMidi(nom) {
    const m = /^([A-G][#b]?)(-?\d)$/.exec(nom);
    if (!m) { console.warn('[Musique] note illisible :', nom); return 60; }
    return NOTES[m[1]] + 12 * (parseInt(m[2], 10) + 1);
  }

  // Qualités d'accord : intervalles en demi-tons depuis la fondamentale.
  const QUALITES = {
    '': [0, 4, 7], m: [0, 3, 7], '5': [0, 7, 12], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
    m9: [0, 3, 7, 10, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], '7': [0, 4, 7, 10],
    add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
    // Grappe dissonante (invasion) : seconde mineure, triton, quinte.
    grp: [0, 1, 6, 7]
  };
  const cacheAccords = {};
  // « Am/G » → { pc: 9, intervalles: [0,3,7], basse: 7, nom: 'Am/G' }
  function lireAccord(nom) {
    if (cacheAccords[nom]) return cacheAccords[nom];
    const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(nom);
    let acc;
    if (!m || !(m[2] in QUALITES)) {
      console.warn('[Musique] accord illisible :', nom);
      acc = { pc: 0, intervalles: [0, 4, 7], basse: 0, nom };
    } else {
      acc = { pc: NOTES[m[1]], intervalles: QUALITES[m[2]],
        basse: m[3] ? NOTES[m[3]] : NOTES[m[1]], nom };
    }
    cacheAccords[nom] = acc;
    return acc;
  }

  // Registres : fondamentales ramenées dans une octave fixe par instrument.
  const regGuitare = pc => 40 + ((pc - 4 + 12) % 12);   // mi 2 … ré# 3
  const regBasse = pc => 28 + ((pc - 4 + 12) % 12);     // mi 1 … ré# 2
  const regNappe = pc => 48 + pc;                        // do 3 … si 3
  const regArp = pc => 57 + ((pc - 9 + 12) % 12);       // la 3 … sol# 4
  const regCloche = pc => 69 + ((pc - 9 + 12) % 12);    // la 4 … sol# 5
  const regCoup = pc => 48 + ((pc - 7 + 12) % 12);      // sol 3 … fa# 4

  // Phrase mélodique : « E5:2 r:1 G5:4 | … » (durées en doubles-croches).
  function lirePhrase(texte) {
    const evts = [];
    let pas = 0;
    for (const jeton of texte.split(/\s+/)) {
      if (!jeton || jeton === '|') continue;
      const [note, dureeTxt] = jeton.split(':');
      const duree = parseInt(dureeTxt, 10) || 1;
      if (note !== 'r') evts.push({ pas, duree, midi: noteMidi(note) });
      pas += duree;
    }
    if (pas % 16 !== 0) console.warn('[Musique] phrase de longueur non entière :', pas, texte);
    return { evts, longueur: pas };
  }

  // Caractères des motifs (16 caractères = une mesure de doubles-croches).
  // Batterie : force de frappe.
  const FORCE = { X: 1, x: 0.72, g: 0.3, o: 0.7, r: 0.55, f: 0.9 };
  // Basse et guitare : décalage par rapport à la fondamentale de l'accord.
  // Minuscule = note courte (étouffée pour la guitare) ; majuscule = note
  // tenue (guitare) ou octave supérieure (basse). « _ » prolonge la note.
  // (« l » = triton, pour la basse de l'invasion.)
  const DECALAGE = { x: 0, b: 1, d: 2, t: 3, j: 4, s: 5, l: 6, q: 7, h: 8, n: -2, u: -5 };
  // Toms : hauteur.
  const TOMS = { b: 72, m: 108, x: 108, h: 158 };

  function tenue(motif, s) {
    let n = 1;
    while (s + n < 16 && motif[s + n] === '_') n++;
    return n;
  }

  const borne = (x, a, b) => Math.max(a, Math.min(b, x));

  /* ==========================================================================
     2. CHAÎNE MAÎTRE
     ========================================================================== */

  // Compteur de nœuds créés (mesure du coût), rangé sur le contexte.
  function compter(c) { c._fdsN = (c._fdsN || 0) + 1; }
  // Sources sonores vivantes (démarrées et pas encore terminées) : mesure des
  // fuites. Le compteur doit rester stable d'un cycle à l'autre.
  function suivreSource(c, s) { c._fdsV = (c._fdsV || 0) + 1; s.addEventListener('ended', () => { c._fdsV--; }); }
  function nOsc(c, type, f) { compter(c); const o = c.createOscillator(); o.type = type; o.frequency.value = f; suivreSource(c, o); return o; }
  function nGain(c, v) { compter(c); const g = c.createGain(); g.gain.value = v == null ? 1 : v; return g; }
  function nFiltre(c, type, f, q) {
    compter(c);
    const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f;
    if (q != null) b.Q.value = q;
    return b;
  }

  // Déconnecte une chaîne de nœuds quand la source s'arrête (libération mémoire).
  // Plusieurs appels sur la même source s'additionnent.
  function liberer(source, noeuds) {
    if (!source._aLiberer) {
      source._aLiberer = [];
      source.onended = function () {
        for (const n of source._aLiberer) { try { n.disconnect(); } catch (e) { /* déjà fait */ } }
        source._aLiberer = null;
      };
    }
    for (const n of noeuds) if (source._aLiberer.indexOf(n) < 0) source._aLiberer.push(n);
  }

  const cacheCourbes = {};
  // Saturation douce (tangente hyperbolique) d'intensité k.
  function courbeDisto(k) {
    if (cacheCourbes[k]) return cacheCourbes[k];
    const n = 2048, a = new Float32Array(n), tk = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i * 2 / (n - 1) - 1; a[i] = Math.tanh(k * x) / tk; }
    cacheCourbes[k] = a;
    return a;
  }
  // Écrêteur de sécurité : linéaire jusqu'à 0,8 (-1,9 dBFS), genou doux,
  // plafond 0,88 (-1,1 dBFS). Le limiteur plafonne vers -2,3 dBFS (seuil
  // -6 dB plus le gain de compensation automatique du navigateur) : l'écrêteur
  // ne travaille donc que sur les rares pics qui échappent au limiteur.
  function courbeEcretage() {
    const n = 4096, a = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * 2 / (n - 1) - 1, ax = Math.abs(x);
      const y = ax <= 0.8 ? ax : 0.8 + 0.08 * Math.tanh((ax - 0.8) / 0.08);
      a[i] = x < 0 ? -y : y;
    }
    return a;
  }

  // Réponse impulsionnelle générée : bruit qui décroît et s'assombrit,
  // pré-délai et quelques réflexions précoces. Stéréo décorrélée.
  function reponseImpulsionnelle(c, duree) {
    const sr = c.sampleRate, n = Math.floor(sr * duree), buf = c.createBuffer(2, n, sr);
    const r = aleaGraine(4242), pre = Math.floor(0.018 * sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const x = (i - pre) / (n - pre);
        const env = Math.pow(1 - x, 1.6) * Math.exp(-x * 3.2);
        const a = 0.75 - 0.62 * x;
        lp += a * ((r() * 2 - 1) - lp);
        d[i] = lp * env;
      }
      for (let j = 0; j < 8; j++) {
        const p = pre + Math.floor(r() * 0.07 * sr);
        d[p] += (r() < 0.5 ? -1 : 1) * (0.5 - j * 0.04);
      }
    }
    return buf;
  }

  function bruitBlanc(c, duree) {
    const n = Math.floor(c.sampleRate * duree), buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0), r = aleaGraine(99);
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
    return buf;
  }

  function construireMaitre(c, volume) {
    const entree = nGain(c, 0.5);
    compter(c); const comp = c.createDynamicsCompressor();      // « colle » du mixage
    comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 3;
    comp.attack.value = 0.008; comp.release.value = 0.25;
    compter(c); const lim = c.createDynamicsCompressor();       // limiteur
    lim.threshold.value = -6; lim.knee.value = 2; lim.ratio.value = 20;
    lim.attack.value = 0.001; lim.release.value = 0.08;
    compter(c); const ecreteur = c.createWaveShaper();
    ecreteur.curve = courbeEcretage(); ecreteur.oversample = '2x';
    const vol = nGain(c, volume);
    const muet = nGain(c, 1);
    entree.connect(comp); comp.connect(lim); lim.connect(ecreteur);
    ecreteur.connect(vol); vol.connect(muet); muet.connect(c.destination);
    // Réverbération partagée (envoi auxiliaire), graves coupés avant.
    const revEntree = nFiltre(c, 'highpass', 250, 0.7);
    compter(c); const conv = c.createConvolver();
    conv.buffer = reponseImpulsionnelle(c, 1.8);
    const revRetour = nGain(c, 0.55);
    revEntree.connect(conv); conv.connect(revRetour); revRetour.connect(entree);
    return { entree, revEntree, vol, muet, bruit: bruitBlanc(c, 2.5) };
  }

  /* ==========================================================================
     3. TRANCHES DE CONSOLE
     Chaque piste crée (à la demande) ses canaux persistants : filtres,
     saturation, panoramique, écho, envoi de réverbération. Les notes ne
     créent que leurs oscillateurs et enveloppes : c'est économique.
     ========================================================================== */

  const CANAUX = {
    kick:     { niveau: 1.0, distorsion: 1.6 },
    caisse:   { niveau: 2.1, distorsion: 2, envoi: 0.25 },
    martiale: { niveau: 0.5, envoi: 0.3, pan: -0.2 },
    charley:  { niveau: 0.45, passeHaut: 7000, pan: 0.3, envoi: 0.06 },
    toms:     { niveau: 0.8, envoi: 0.3, pan: -0.1 },
    metal:    { niveau: 0.28, passeHaut: 400, envoi: 0.5, pan: -0.35 },
    basse:    { niveau: 0.45, distorsion: 3, passeBas: 1800 },
    guitareG: { niveau: 0.26, passeHaut: 100, distorsion: 14, post: 1, surech: '2x', passeBas: 4800, creux: true, pan: -0.75, envoi: 0.08 },
    guitareD: { niveau: 0.26, passeHaut: 100, distorsion: 14, post: 1, surech: '2x', passeBas: 4800, creux: true, pan: 0.75, envoi: 0.08 },
    nappe:    { niveau: 0.35, passeBas: 1300, lfo: true, envoi: 0.6 },
    lead:     { niveau: 0.8, distorsion: 1.8, passeBas: 3800, envoi: 0.3, echo: 3, pan: 0.05 },
    cuivre:   { niveau: 0.45, envoi: 0.4, pan: -0.1 },
    arp:      { niveau: 0.35, echo: 3, envoi: 0.35, pan: 0.2 },
    cloche:   { niveau: 0.3, echo: 6, envoi: 0.6, pan: 0.25 },
    coups:    { niveau: 1.1, distorsion: 1.5, envoi: 0.45 },
    fx:       { niveau: 0.6, envoi: 0.55 },
    // Invasion : nappe grave saturée, tôle géante, signal des Veilleurs.
    bourdon:  { niveau: 0.55, distorsion: 2.5, passeBas: 1400, envoi: 0.3 },
    plaque:   { niveau: 0.5, passeHaut: 50, envoi: 0.6, pan: 0.3 },
    signal:   { niveau: 0.6, passeBas: 6000, envoi: 0.5, echo: 3, pan: 0.12 },
    // Nouvelles pistes : grand tambour, claquement industriel, basse acide,
    // séquence en créneaux, chœur synthétique (formants), flûte de brume.
    taiko:    { niveau: 0.9, distorsion: 1.3, envoi: 0.4, pan: 0.1 },
    clap:     { niveau: 1.0, passeHaut: 450, envoi: 0.35, pan: -0.05 },
    acide:    { niveau: 0.5, distorsion: 2.2, passeBas: 4200, envoi: 0.1 },
    pulse:    { niveau: 0.55, passeBas: 5000, echo: 3, envoi: 0.3, pan: -0.25 },
    choeur:   { niveau: 0.8, passeBas: 3600, envoi: 0.7 },
    flute:    { niveau: 0.45, envoi: 0.5, echo: 4, pan: 0.15 }
  };

  function construireCanal(P, nom) {
    const c = P.c, cfg = CANAUX[nom];
    const mix = (P.def.mix && P.def.mix[nom] != null) ? P.def.mix[nom] : 1;
    const solo = P.mt.solo && P.mt.solo !== nom;
    const entree = nGain(c, 1);
    const noeuds = [entree], oscs = [];
    let n = entree;
    const relier = x => { n.connect(x); n = x; noeuds.push(x); };
    if (cfg.passeHaut) relier(nFiltre(c, 'highpass', cfg.passeHaut, 0.7));
    if (cfg.distorsion) {
      compter(c);
      const s = c.createWaveShaper();
      s.curve = courbeDisto(cfg.distorsion);
      s.oversample = cfg.surech || 'none';
      relier(s);
      relier(nGain(c, cfg.post != null ? cfg.post : Math.tanh(cfg.distorsion) / cfg.distorsion));
    }
    if (cfg.passeBas) {
      const f = nFiltre(c, 'lowpass', (nom === 'nappe' && P.def.nappeFiltre) || cfg.passeBas, 0.7);
      relier(f);
      if (cfg.lfo) {   // filtre de nappe qui respire lentement
        const lfo = nOsc(c, 'sine', 0.06 + P.alea() * 0.04), prof = nGain(c, f.frequency.value * 0.45);
        lfo.connect(prof); prof.connect(f.frequency); lfo.start(P.t0);
        oscs.push(lfo); noeuds.push(lfo, prof);
      }
    }
    if (cfg.creux) {   // « baffle » : creux dans les bas-médiums, présence vers 2,4 kHz
      const p1 = nFiltre(c, 'peaking', 650, 1); p1.gain.value = -5; relier(p1);
      const p2 = nFiltre(c, 'peaking', 2400, 1.2); p2.gain.value = 3; relier(p2);
    }
    compter(c);
    const pan = c.createStereoPanner(); pan.pan.value = cfg.pan || 0; relier(pan);
    const sortie = nGain(c, solo ? 0 : (cfg.niveau || 1) * mix); relier(sortie);
    sortie.connect(P.bus);
    if (cfg.envoi && !solo) {
      const e = nGain(c, cfg.envoi); sortie.connect(e); e.connect(P.busRev); noeuds.push(e);
    }
    if (cfg.echo && !solo) {   // écho ping-pong filtré, calé sur le tempo
      compter(c);
      const d = c.createDelay(2); d.delayTime.value = Math.min(1.9, cfg.echo * P.pas);
      const fb = nGain(c, 0.32), lp = nFiltre(c, 'lowpass', 2800, 0.7), ret = nGain(c, 0.3);
      compter(c);
      const pan2 = c.createStereoPanner(); pan2.pan.value = -(cfg.pan || 0) - 0.3;
      sortie.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
      lp.connect(ret); ret.connect(pan2); pan2.connect(P.bus);
      noeuds.push(d, fb, lp, ret, pan2);
    }
    return { entree, noeuds, oscs };
  }

  // Accès paresseux : un canal n'existe que si la piste s'en sert.
  function canal(P, nom) {
    if (!P.k[nom]) P.k[nom] = construireCanal(P, nom);
    return P.k[nom].entree;
  }

  /* ==========================================================================
     4. INSTRUMENTS
     Chaque fonction programme un son à l'instant t (secondes du contexte).
     Toutes les enveloppes partent de 0 et y reviennent : pas de clics.
     ========================================================================== */

  function nBruit(P, t, duree) {
    const c = P.c; compter(c);
    const s = c.createBufferSource();
    suivreSource(c, s);
    s.buffer = P.mt.maitre.bruit;
    const decal = P.alea() * Math.max(0, s.buffer.duration - duree - 0.05);
    s.start(t, decal, duree + 0.02);
    return s;
  }

  // Enveloppe percussive : montée brève puis décroissance exponentielle.
  function percu(g, t, v, attaque, fin) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + attaque);
    g.gain.exponentialRampToValueAtTime(0.0008, fin - 0.004);
    g.gain.linearRampToValueAtTime(0, fin);
  }
  // Enveloppe tenue : montée, palier, relâchement.
  function tenueEnv(g, t, v, attaque, palier, finTenue, relache) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + attaque);
    if (finTenue > t + attaque + 0.02) {
      g.gain.linearRampToValueAtTime(v * palier, Math.min(finTenue, t + attaque + 0.15));
      g.gain.setValueAtTime(v * palier, finTenue);
    }
    g.gain.exponentialRampToValueAtTime(0.0008, finTenue + relache);
    g.gain.linearRampToValueAtTime(0, finTenue + relache + 0.01);
    return finTenue + relache + 0.02;
  }

  function sKick(P, t, v) {
    const c = P.c, dest = canal(P, 'kick');
    const o = nOsc(c, 'sine', 155), g = nGain(c, 0);
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.38);
    percu(g, t, v, 0.002, t + 0.42);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.43);
    liberer(o, [o, g]);
    const b = nBruit(P, t, 0.02), f = nFiltre(c, 'highpass', 1800, 0.7), gb = nGain(c, 0);
    percu(gb, t, v * 0.35, 0.001, t + 0.018);
    b.connect(f); f.connect(gb); gb.connect(dest);
    liberer(b, [b, f, gb]);
  }

  function sCaisse(P, t, v) {
    const c = P.c, dest = canal(P, 'caisse');
    const o = nOsc(c, 'triangle', 190), g = nGain(c, 0);
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    percu(g, t, v * 0.55, 0.002, t + 0.13);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.14);
    liberer(o, [o, g]);
    const b = nBruit(P, t, 0.24), f = nFiltre(c, 'highpass', 900, 0.7), gb = nGain(c, 0);
    percu(gb, t, v * 0.8, 0.001, t + 0.22);
    b.connect(f); f.connect(gb); gb.connect(dest);
    liberer(b, [b, f, gb]);
  }

  // Caisse claire militaire : plus aiguë, plus sèche, faite pour les roulements.
  function sMartiale(P, t, v) {
    const c = P.c, dest = canal(P, 'martiale');
    const b = nBruit(P, t, 0.1), f = nFiltre(c, 'bandpass', 3800, 0.9), gb = nGain(c, 0);
    percu(gb, t, v, 0.001, t + 0.09);
    b.connect(f); f.connect(gb); gb.connect(dest);
    liberer(b, [b, f, gb]);
    const o = nOsc(c, 'triangle', 340), g = nGain(c, 0);
    percu(g, t, v * 0.4, 0.001, t + 0.04);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.045);
    liberer(o, [o, g]);
  }

  function sCharley(P, t, v, ouvert) {
    const c = P.c, d = ouvert ? 0.26 : 0.045;
    const b = nBruit(P, t, d), g = nGain(c, 0);
    percu(g, t, v, 0.001, t + d);
    b.connect(g); g.connect(canal(P, 'charley'));
    liberer(b, [b, g]);
  }

  function sTom(P, t, f, v) {
    const c = P.c, dest = canal(P, 'toms');
    const o = nOsc(c, 'sine', f * 1.6), g = nGain(c, 0);
    o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    percu(g, t, v, 0.002, t + 0.5);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.51);
    liberer(o, [o, g]);
    const b = nBruit(P, t, 0.06), fl = nFiltre(c, 'lowpass', 900, 0.7), gb = nGain(c, 0);
    percu(gb, t, v * 0.5, 0.001, t + 0.05);
    b.connect(fl); fl.connect(gb); gb.connect(dest);
    liberer(b, [b, fl, gb]);
  }

  // Frappe métallique (enclume, tôle) : partiels inharmoniques.
  const PARTIELS = [1, 1.483, 2.031, 2.712, 3.368];
  function sMetal(P, t, v) {
    const c = P.c, dest = canal(P, 'metal'), g = nGain(c, 0), base = 300 + P.alea() * 60;
    percu(g, t, v * 0.5, 0.001, t + 0.75);
    g.connect(dest);
    let dernier = null;
    PARTIELS.forEach((r, i) => {
      const o = nOsc(c, i % 2 ? 'triangle' : 'square', base * r);
      const gi = nGain(c, 1 / (i + 1.5));
      o.connect(gi); gi.connect(g); o.start(t); o.stop(t + 0.76);
      liberer(o, [o, gi]);
      dernier = o;
    });
    liberer(dernier, [g]);
  }

  function sCrash(P, t, v) {
    const c = P.c;
    const b = nBruit(P, t, 1.8), f = nFiltre(c, 'highpass', 4200, 0.6), g = nGain(c, 0);
    percu(g, t, v, 0.002, t + 1.8);
    b.connect(f); f.connect(g); g.connect(canal(P, 'metal'));
    liberer(b, [b, f, g]);
  }

  // Basse synthé : dent de scie + sinus, filtre à enveloppe, saturée au canal.
  function sBasse(P, t, midi, duree, v) {
    const c = P.c, f = frequence(midi);
    const o1 = nOsc(c, 'sawtooth', f), o2 = nOsc(c, 'sine', f), g2 = nGain(c, 0.7);
    const fl = nFiltre(c, 'lowpass', 300, 2), g = nGain(c, 0);
    fl.frequency.setValueAtTime(260 + v * 2400, t);
    fl.frequency.exponentialRampToValueAtTime(280, t + 0.18);
    const fin = tenueEnv(g, t, v, 0.004, 0.75, t + Math.max(0.05, duree * 0.92), 0.04);
    o1.connect(fl); o2.connect(g2); g2.connect(fl); fl.connect(g); g.connect(canal(P, 'basse'));
    o1.start(t); o2.start(t); o1.stop(fin); o2.stop(fin);
    liberer(o1, [o1, o2, g2, fl, g]);
  }

  // Accord de puissance (fondamentale, quinte, octave), doublé gauche/droite
  // avec un léger désaccord et un décalage : c'est la « double prise ».
  // Étouffé (palm mute) = court et sombre ; ouvert = tenu et brillant.
  function sGuitare(P, t, midi, duree, v, ouvert) {
    const c = P.c;
    [['guitareG', -7, 0], ['guitareD', 7, 0.007]].forEach(([nomCanal, desacc, decal]) => {
      const t0 = t + decal;
      const fl = nFiltre(c, 'lowpass', 1000, 0.8), g = nGain(c, 0);
      const fin = ouvert
        ? tenueEnv(g, t0, v * 0.3, 0.004, 0.8, t0 + duree * 0.96, 0.08)
        : tenueEnv(g, t0, v * 0.3, 0.003, 0.6, t0 + Math.min(duree, P.pas) * 0.7, 0.03);
      if (ouvert) {
        fl.frequency.setValueAtTime(3400, t0);
        fl.frequency.exponentialRampToValueAtTime(1800, t0 + Math.max(0.2, duree));
      } else {
        fl.frequency.setValueAtTime(1500, t0);
        fl.frequency.exponentialRampToValueAtTime(500, t0 + 0.09);
      }
      fl.connect(g); g.connect(canal(P, nomCanal));
      let premier = null;
      [0, 7, 12].forEach(iv => {
        const o = nOsc(c, 'sawtooth', frequence(midi + iv));
        o.detune.value = desacc + (P.alea() - 0.5) * 4;
        o.connect(fl); o.start(t0); o.stop(fin);
        if (!premier) premier = o; else liberer(o, [o]);
      });
      liberer(premier, [premier, fl, g]);
    });
  }

  // Nappe : dents de scie désaccordées, attaque lente, filtre qui respire.
  function sNappe(P, t, acc, duree, v) {
    const c = P.c, g = nGain(c, 0), racine = regNappe(acc.pc);
    const fin = tenueEnv(g, t, v * 0.16, 0.7, 1, t + duree, 1.1);
    g.connect(canal(P, 'nappe'));
    const tons = acc.intervalles.slice(0, 4).map(iv => { let m = racine + iv; if (m > 74) m -= 12; return m; });
    let dernier = null;
    tons.forEach(m => {
      [-9, 9].forEach(d => {
        const o = nOsc(c, 'sawtooth', frequence(m)); o.detune.value = d;
        o.connect(g); o.start(t); o.stop(fin); liberer(o, [o]); dernier = o;
      });
    });
    const sub = nOsc(c, 'triangle', frequence(regNappe(acc.basse) - 12)), gs = nGain(c, 0.8);
    sub.connect(gs); gs.connect(g); sub.start(t); sub.stop(fin); liberer(sub, [sub, gs]);
    liberer(dernier, [g]);
  }

  // Lead : scie + carré, vibrato retardé.
  function sLead(P, t, midi, duree, v) {
    const c = P.c, f = frequence(midi);
    const o1 = nOsc(c, 'sawtooth', f), o2 = nOsc(c, 'square', f); o2.detune.value = 7;
    const g2 = nGain(c, 0.5), fl = nFiltre(c, 'lowpass', 4200, 1), g = nGain(c, 0);
    fl.frequency.setValueAtTime(4800, t); fl.frequency.exponentialRampToValueAtTime(2400, t + 0.3);
    const fin = tenueEnv(g, t, v * 0.32, 0.012, 0.8, t + duree * 0.95, 0.09);
    const lfo = nOsc(c, 'sine', 5.4), lg = nGain(c, 0);
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(0, t + 0.22);
    lg.gain.linearRampToValueAtTime(14, t + 0.5);
    lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
    o1.connect(fl); o2.connect(g2); g2.connect(fl); fl.connect(g); g.connect(canal(P, 'lead'));
    [o1, o2, lfo].forEach(o => { o.start(t); o.stop(fin); });
    liberer(o1, [o1, o2, g2, fl, g, lfo, lg]);
  }

  // Cuivre synthétique : le filtre s'ouvre comme un souffle.
  function sCuivre(P, t, midi, duree, v) {
    const c = P.c, f = frequence(midi);
    const fl = nFiltre(c, 'lowpass', 300, 1.5), g = nGain(c, 0);
    fl.frequency.setValueAtTime(300, t);
    fl.frequency.linearRampToValueAtTime(600 + v * 2400, t + 0.12);
    fl.frequency.exponentialRampToValueAtTime(1300, t + 0.6);
    const fin = tenueEnv(g, t, v * 0.3, 0.06, 0.85, t + duree * 0.96, 0.18);
    fl.connect(g); g.connect(canal(P, 'cuivre'));
    let premier = null;
    [-5, 5].forEach(d => {
      const o = nOsc(c, 'sawtooth', f); o.detune.value = d;
      o.connect(fl); o.start(t); o.stop(fin);
      if (!premier) premier = o; else liberer(o, [o]);
    });
    liberer(premier, [premier, fl, g]);
  }

  // Arpège pincé.
  function sArp(P, t, midi, duree, v) {
    const c = P.c, f = frequence(midi);
    const o1 = nOsc(c, 'sawtooth', f), o2 = nOsc(c, 'triangle', f * 2), g2 = nGain(c, 0.4);
    const fl = nFiltre(c, 'lowpass', 3000, 3), g = nGain(c, 0);
    fl.frequency.setValueAtTime(2800, t); fl.frequency.exponentialRampToValueAtTime(350, t + 0.22);
    const fin = t + Math.max(0.25, Math.min(duree, 0.6));
    percu(g, t, v * 0.3, 0.003, fin);
    o1.connect(fl); o2.connect(g2); g2.connect(fl); fl.connect(g); g.connect(canal(P, 'arp'));
    o1.start(t); o2.start(t); o1.stop(fin); o2.stop(fin);
    liberer(o1, [o1, o2, g2, fl, g]);
  }

  // Cloche synthétique (modulation de fréquence, rapport 3,5 : timbre métallique).
  function sCloche(P, t, midi, duree, v) {
    const c = P.c, f = frequence(midi), fin = t + Math.max(1.6, duree);
    const porteuse = nOsc(c, 'sine', f), mod = nOsc(c, 'sine', f * 3.5), im = nGain(c, 0), g = nGain(c, 0);
    im.gain.setValueAtTime(f * 2.2, t); im.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.2);
    mod.connect(im); im.connect(porteuse.frequency);
    percu(g, t, v * 0.3, 0.002, fin);
    porteuse.connect(g); g.connect(canal(P, 'cloche'));
    porteuse.start(t); mod.start(t); porteuse.stop(fin); mod.stop(fin);
    liberer(porteuse, [porteuse, mod, im, g]);
  }

  // « Coup d'orchestre » synthétique : accord large et bref, attaque de
  // souffle (bruit filtré) et timbale grave.
  function sCoup(P, t, acc, v) {
    const c = P.c, dest = canal(P, 'coups'), r = regCoup(acc.pc);
    const tiers = acc.intervalles.length > 1 && acc.intervalles[1] < 7 ? acc.intervalles[1] : 7;
    const tons = [r - 12, r, r + 7, r + 12, r + 12 + tiers, r + 19, r + 24];
    const fl = nFiltre(c, 'lowpass', 7000, 1), g = nGain(c, 0);
    fl.frequency.setValueAtTime(7000, t); fl.frequency.exponentialRampToValueAtTime(900, t + 0.28);
    percu(g, t, v * 0.13, 0.004, t + 0.55);
    fl.connect(g); g.connect(dest);
    let premier = null;
    tons.forEach((m, i) => {
      const o = nOsc(c, i === 0 ? 'square' : 'sawtooth', frequence(m));
      o.detune.value = (P.alea() - 0.5) * 14;
      o.connect(fl); o.start(t); o.stop(t + 0.56);
      if (!premier) premier = o; else liberer(o, [o]);
    });
    liberer(premier, [premier, fl, g]);
    const b = nBruit(P, t, 0.08), fb = nFiltre(c, 'bandpass', 1500, 0.8), gb = nGain(c, 0);
    percu(gb, t, v * 0.5, 0.001, t + 0.07);
    b.connect(fb); fb.connect(gb); gb.connect(dest); liberer(b, [b, fb, gb]);
    sTom(P, t, frequence(regBasse(acc.pc) + 12) * 0.9, v * 0.8);
  }

  // Montée de bruit filtré, sur la durée donnée.
  function sMontee(P, t, duree, v) {
    const c = P.c, b = nBruit(P, t, duree);
    const f = nFiltre(c, 'bandpass', 300, 3), g = nGain(c, 0);
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(6500, t + duree);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + duree - 0.02);
    g.gain.linearRampToValueAtTime(0, t + duree);
    b.connect(f); f.connect(g); g.connect(canal(P, 'fx')); liberer(b, [b, f, g]);
  }

  // Impact : grosse chute de hauteur, souffle grave, cymbale.
  function sImpact(P, t, v) {
    const c = P.c, dest = canal(P, 'fx');
    const o = nOsc(c, 'sine', 70), g = nGain(c, 0);
    o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    percu(g, t, v * 0.9, 0.003, t + 1.8);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 1.81); liberer(o, [o, g]);
    const b = nBruit(P, t, 0.9), f = nFiltre(c, 'lowpass', 500, 0.7), gb = nGain(c, 0);
    percu(gb, t, v * 0.6, 0.002, t + 0.85);
    b.connect(f); f.connect(gb); gb.connect(dest); liberer(b, [b, f, gb]);
    sCrash(P, t, v * 0.7);
  }

  /* --- Invasion : trois sons propres aux Veilleurs --- */

  // Bourdon : nappe grave et dissonante. Fondamentale en dents de scie
  // désaccordées et octave grave ; si « dissonant », un triton et une
  // neuvième mineure enflent lentement par-dessus. Le filtre s'ouvre puis se
  // referme comme une respiration ; la saturation du canal fait grogner les
  // battements. Montée et retombée linéaires : deux bourdons qui se suivent
  // se fondent l'un dans l'autre.
  function sBourdon(P, t, midi, duree, v, dissonant) {
    const c = P.c, fl = nFiltre(c, 'lowpass', 160, 2), g = nGain(c, 0);
    const attaque = Math.min(1.2, duree * 0.35), relache = 1.6, fin = t + duree + relache + 0.02;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.22, t + attaque);
    g.gain.setValueAtTime(v * 0.22, t + duree);
    g.gain.linearRampToValueAtTime(0, t + duree + relache);
    fl.frequency.setValueAtTime(160, t);
    fl.frequency.linearRampToValueAtTime(380 + v * 520, t + duree * 0.6);
    fl.frequency.linearRampToValueAtTime(180, fin);
    fl.connect(g); g.connect(canal(P, 'bourdon'));
    // [demi-tons, désaccord (cents), forme d'onde, niveau, enfle ?]
    const voix = [[0, -11, 'sawtooth', 1, false], [0, 9, 'sawtooth', 1, false],
      [-12, 0, 'triangle', 1.3, false], [12, 4, 'sawtooth', 0.3, false]];
    if (dissonant) voix.push([6, -5, 'sawtooth', 0.55, true], [13, 6, 'sawtooth', 0.5, true]);
    let premier = null;
    voix.forEach(([iv, desacc, forme, niv, enfle]) => {
      const o = nOsc(c, forme, frequence(midi + iv)), gi = nGain(c, enfle ? 0 : niv);
      o.detune.value = desacc + (P.alea() - 0.5) * 3;
      if (enfle) {
        gi.gain.setValueAtTime(0, t);
        gi.gain.linearRampToValueAtTime(niv, t + duree * 0.6);
        gi.gain.linearRampToValueAtTime(niv * 0.4, t + duree);
      }
      o.connect(gi); gi.connect(fl); o.start(t); o.stop(fin);
      if (!premier) { premier = o; liberer(o, [o, gi, fl, g]); } else liberer(o, [o, gi]);
    });
  }

  // Plaque de tôle géante (gong industriel) : partiels inharmoniques graves
  // qui se détendent en retombant, filtre qui se referme, longue résonance.
  const PARTIELS_PLAQUE = [1, 1.347, 1.762, 2.418, 3.164, 4.283, 5.71];
  function sPlaque(P, t, v) {
    const c = P.c, dest = canal(P, 'plaque'), base = 82 + P.alea() * 9, fin = t + 3.4;
    const fl = nFiltre(c, 'lowpass', 5000, 0.7), g = nGain(c, 0);
    fl.frequency.setValueAtTime(900 + v * 4600, t);
    fl.frequency.exponentialRampToValueAtTime(380, t + 2.6);
    percu(g, t, v * 0.4, 0.005, fin);
    fl.connect(g); g.connect(dest);
    let premier = null;
    PARTIELS_PLAQUE.forEach((r, i) => {
      const f = base * r, o = nOsc(c, i % 3 === 1 ? 'square' : 'triangle', f), gi = nGain(c, 1 / (1 + i * 0.45));
      o.frequency.setValueAtTime(f * 1.03, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.6);
      o.connect(gi); gi.connect(fl); o.start(t); o.stop(fin + 0.01);
      if (!premier) { premier = o; liberer(o, [o, gi, fl, g]); } else liberer(o, [o, gi]);
    });
    // La frappe elle-même : un souffle bref, dans le médium.
    const b = nBruit(P, t, 0.09), fb = nFiltre(c, 'bandpass', 700, 0.8), gb = nGain(c, 0);
    percu(gb, t, v * 0.5, 0.001, t + 0.08);
    b.connect(fb); fb.connect(gb); gb.connect(dest); liberer(b, [b, fb, gb]);
  }

  // Signal des Veilleurs : timbre vitreux (modulation de fréquence, rapport
  // légèrement faux), note qui « glisse » en place, tremblement rapide.
  function sSignal(P, t, midi, duree, v) {
    const c = P.c, f = frequence(midi);
    const porteuse = nOsc(c, 'sine', f), mod = nOsc(c, 'sine', f * 2.006), im = nGain(c, 0);
    const octave = nOsc(c, 'triangle', f * 2), go = nGain(c, 0.16);
    const trem = nOsc(c, 'sine', 7.5), gt = nGain(c, 0.22), corps = nGain(c, 0.78), g = nGain(c, 0);
    porteuse.frequency.setValueAtTime(f * 0.945, t);
    porteuse.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    octave.frequency.setValueAtTime(f * 1.89, t);
    octave.frequency.exponentialRampToValueAtTime(f * 2, t + 0.06);
    im.gain.setValueAtTime(f * 2.6, t);
    im.gain.exponentialRampToValueAtTime(f * 0.45, t + 0.4);
    mod.connect(im); im.connect(porteuse.frequency);
    trem.connect(gt); gt.connect(corps.gain);
    const fin = tenueEnv(g, t, v * 0.3, 0.01, 0.8, t + duree * 0.9, 0.3);
    porteuse.connect(corps); octave.connect(go); go.connect(corps); corps.connect(g); g.connect(canal(P, 'signal'));
    [porteuse, mod, octave, trem].forEach(o => { o.start(t); o.stop(fin); });
    liberer(porteuse, [porteuse, mod, im, octave, go, trem, gt, corps, g]);
  }

  /* --- Instruments des nouvelles pistes --- */

  // Grand tambour (taiko) : fondamentale qui tombe, peau, souffle grave.
  function sTaiko(P, t, v) {
    const c = P.c, dest = canal(P, 'taiko');
    const o = nOsc(c, 'sine', 110), g = nGain(c, 0);
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(58, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.7);
    percu(g, t, v, 0.003, t + 0.95);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.96); liberer(o, [o, g]);
    const o2 = nOsc(c, 'triangle', 190), g2 = nGain(c, 0);
    o2.frequency.setValueAtTime(190, t); o2.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    percu(g2, t, v * 0.35, 0.002, t + 0.2);
    o2.connect(g2); g2.connect(dest); o2.start(t); o2.stop(t + 0.21); liberer(o2, [o2, g2]);
    const b = nBruit(P, t, 0.12), f = nFiltre(c, 'lowpass', 700, 0.7), gb = nGain(c, 0);
    percu(gb, t, v * 0.6, 0.001, t + 0.1);
    b.connect(f); f.connect(gb); gb.connect(dest); liberer(b, [b, f, gb]);
  }

  // Claquement industriel : trois éclats de bruit rapprochés puis une queue.
  function sClap(P, t, v) {
    const c = P.c, b = nBruit(P, t, 0.22), f = nFiltre(c, 'bandpass', 1350, 1.1), g = nGain(c, 0), G = g.gain;
    G.setValueAtTime(0, t);
    G.linearRampToValueAtTime(v * 0.8, t + 0.001); G.linearRampToValueAtTime(v * 0.15, t + 0.010);
    G.linearRampToValueAtTime(v * 0.8, t + 0.012); G.linearRampToValueAtTime(v * 0.15, t + 0.021);
    G.linearRampToValueAtTime(v, t + 0.024);
    G.exponentialRampToValueAtTime(0.0008, t + 0.2); G.linearRampToValueAtTime(0, t + 0.205);
    b.connect(f); f.connect(g); g.connect(canal(P, 'clap')); liberer(b, [b, f, g]);
  }

  // Basse acide : dent de scie dans un filtre résonant qui se referme vite.
  function sAcide(P, t, midi, duree, v, accent) {
    const c = P.c, f = frequence(midi);
    const o = nOsc(c, 'sawtooth', f), fl = nFiltre(c, 'lowpass', 300, accent ? 11 : 7), g = nGain(c, 0);
    fl.frequency.setValueAtTime(220 + v * (accent ? 2600 : 1300), t);
    fl.frequency.exponentialRampToValueAtTime(190, t + (accent ? 0.22 : 0.13));
    const fin = tenueEnv(g, t, v * 0.5, 0.003, 0.8, t + Math.max(0.04, duree * 0.85), 0.03);
    o.connect(fl); fl.connect(g); g.connect(canal(P, 'acide'));
    o.start(t); o.stop(fin); liberer(o, [o, fl, g]);
  }

  // Séquence en créneaux : deux carrés désaccordés, filtre qui claque.
  function sPulse(P, t, midi, duree, v) {
    const c = P.c, f = frequence(midi);
    const o1 = nOsc(c, 'square', f), o2 = nOsc(c, 'square', f); o1.detune.value = -6; o2.detune.value = 6;
    const fl = nFiltre(c, 'lowpass', 2400, 2), g = nGain(c, 0);
    fl.frequency.setValueAtTime(2600, t); fl.frequency.exponentialRampToValueAtTime(500, t + 0.16);
    const fin = t + Math.max(0.12, Math.min(duree, 0.3));
    percu(g, t, v * 0.22, 0.002, fin);
    o1.connect(fl); o2.connect(fl); fl.connect(g); g.connect(canal(P, 'pulse'));
    o1.start(t); o2.start(t); o1.stop(fin); o2.stop(fin);
    liberer(o1, [o1, o2, fl, g]);
  }

  // Chœur synthétique : dents de scie filtrées par trois formants (voyelle
  // « a »), vibrato commun, attaque lente. Joue l'accord, comme la nappe.
  const FORMANTS = [[730, 1, 6], [1090, 0.55, 8], [2440, 0.25, 10]];
  function sChoeur(P, t, acc, duree, v) {
    const c = P.c, g = nGain(c, 0), somme = nGain(c, 1), racine = regNappe(acc.pc);
    const fin = tenueEnv(g, t, v * 0.5, 0.9, 1, t + duree, 1.4);
    g.connect(canal(P, 'choeur'));
    const filtres = [];
    FORMANTS.forEach(([fr, niv, q]) => {
      const b = nFiltre(c, 'bandpass', fr, q), gn = nGain(c, niv);
      somme.connect(b); b.connect(gn); gn.connect(g); filtres.push(b, gn);
    });
    const lfo = nOsc(c, 'sine', 4.6 + P.alea() * 0.6), lg = nGain(c, 9);
    lfo.connect(lg); lfo.start(t); lfo.stop(fin);
    let dernier = lfo;
    acc.intervalles.slice(0, 3).forEach(iv => {
      [-12, 12].forEach(d => {
        const o = nOsc(c, 'sawtooth', frequence(racine + iv)); o.detune.value = d;
        lg.connect(o.detune); o.connect(somme); o.start(t); o.stop(fin); liberer(o, [o]); dernier = o;
      });
    });
    liberer(dernier, [g, somme, lfo, lg].concat(filtres));
  }

  // Flûte de brume : triangle et octave douce, souffle à l'attaque, vibrato tardif.
  function sFlute(P, t, midi, duree, v) {
    const c = P.c, f = frequence(midi);
    const o = nOsc(c, 'triangle', f), o2 = nOsc(c, 'sine', f * 2), g2 = nGain(c, 0.18), g = nGain(c, 0);
    const fin = tenueEnv(g, t, v * 0.38, 0.06, 0.85, t + duree * 0.92, 0.18);
    const vib = nOsc(c, 'sine', 5.1), vg = nGain(c, 0);
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(0, t + 0.3); vg.gain.linearRampToValueAtTime(11, t + 0.7);
    vib.connect(vg); vg.connect(o.detune); vg.connect(o2.detune);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(canal(P, 'flute'));
    [o, o2, vib].forEach(x => { x.start(t); x.stop(fin); });
    liberer(o, [o, o2, g2, g, vib, vg]);
    const b = nBruit(P, t, 0.16), fb = nFiltre(c, 'bandpass', Math.min(8000, f * 2), 2), gb = nGain(c, 0);
    percu(gb, t, v * 0.12, 0.02, t + 0.15);
    b.connect(fb); fb.connect(gb); gb.connect(canal(P, 'flute')); liberer(b, [b, fb, gb]);
  }

  const regPulse = pc => 64 + ((pc - 4 + 12) % 12);    // mi 4 … ré# 5

  const INSTRUMENTS_MELODIQUES = { lead: sLead, cuivre: sCuivre, cloche: sCloche, arp: sArp, signal: sSignal,
    pulse: sPulse, flute: sFlute };

  /* ==========================================================================
     5. COMPOSITIONS
     Une piste = tempo, sections, forme. Une section décrit ses couches :
       chaîne de 16 caractères (chaque mesure), tableau (mesure i → élément
       i modulo la longueur ; null = silence), ou { choix: [...] } (première
       mesure = premier motif, puis tirage à la graine).
     Options de section : accords, mesures, nappe (niveau), melodie (liste de
     phrases enchaînées), instr, transp, double { instr, transp }, fill,
     crash, impact, montee, coupures (probabilité d'un « stop » d'un temps),
     fantomes (notes fantômes ajoutées à la caisse), crescendo, fondu, niveaux,
     bourdon (nappe grave ; majuscule = dissonante), bourdonMesures (sa durée),
     plaque (tôle géante).
     Option de piste : paliers { assaut: [première, dernière section], sortie,
     garde } : la forme suit l'intensité (voir suivreIntensite, section 6).
     ========================================================================== */

  const PHRASES = {
    // --- Menu : « Front de Sel » (ré mineur harmonique) ---
    appel: 'D4:8 A4:4 F4:4 | E4:8 D4:4 A3:4 | D4:6 F4:2 Bb4:8 | A4:8 F4:4 D4:4 | ' +
           'G4:8 Bb4:4 D5:4 | C5:6 Bb4:2 A4:4 G4:4 | A4:8 C#5:4 E5:4 | E5:12 r:4',
    theme: 'D5:6 A4:2 D5:2 E5:2 F5:4 | E5:4 D5:2 C5:2 A4:8 | D5:6 F5:2 Bb5:4 A5:2 G5:2 | ' +
           'A5:6 G5:2 E5:4 C5:4 | D5:6 A4:2 D5:2 E5:2 F5:4 | G5:4 F5:2 E5:2 F5:4 A5:4 | ' +
           'Bb5:6 A5:2 G5:4 D5:4 | C#5:6 E5:2 A5:8',
    themeB: 'G5:8 F5:4 D5:4 | Bb4:16 | Eb5:8 G5:4 Bb5:4 | A5:12 G5:4 | F5:8 D5:4 F5:4 | ' +
            'G5:8 E5:8 | E5:4 C#5:4 E5:4 A5:4 | A5:16',
    // --- Briefing (mi phrygien) ---
    brief1: 'r:8 B4:4 C5:4 | B4:16 | r:8 A4:4 C5:4 | B4:12 r:4 | r:8 E5:4 F5:4 | E5:8 D5:8 | ' +
            'r:8 C5:4 A4:4 | B4:16',
    brief2: 'E5:16 | F5:12 E5:4 | E5:16 | r:16 | B4:8 C5:8 | D5:16 | C5:8 A4:8 | B4:16',
    // --- Calme (la mineur) ---
    calme1: 'A5:6 G5:2 E5:8 | F5:8 E5:4 C5:4 | E5:12 r:4 | B4:16 | A5:6 G5:2 E5:8 | ' +
            'F5:8 A5:4 C6:4 | B5:8 G#5:8 | E5:16',
    // --- Tension (do mineur, couleur phrygienne) ---
    tension1: 'G5:12 Ab5:4 | G5:8 F5:4 Eb5:4 | Db5:12 C5:4 | r:16',
    tension2: 'C6:16 | Bb5:8 Ab5:8 | G5:16 | F5:8 Ab5:8 | F5:16 | Ab5:8 F5:8 | D5:16 | B4:16',
    tension3: 'G4:4 Ab4:4 G4:8 | r:16 | G4:4 Ab4:4 C5:8 | r:16',
    // --- Combat (mi) ---
    combat1: 'E5:2 r:1 E5:1 G5:2 F#5:2 E5:2 B4:2 D5:2 E5:2 | r:2 G5:2 A5:2 B5:3 A5:1 G5:2 F#5:1 G5:1 F#5:2',
    combat1b: 'E5:2 r:1 E5:1 G5:2 A5:2 B5:4 C6:2 B5:2 | A5:2 G5:2 F#5:2 D5:2 E5:8',
    combat2: 'E5:8 D5:4 C5:4 | B4:12 A4:4 | E5:8 F#5:4 G5:4 | A5:12 G5:2 F#5:2 | F#5:8 E5:4 D5:4 | ' +
             'A5:16 | B5:8 A5:4 F#5:4 | D#5:16',
    combatPont: 'B5:4 G5:4 D5:8 | D6:4 B5:4 G5:8 | A5:4 F5:4 C5:8 | C6:4 A5:4 F5:8 | G5:4 E5:4 C5:8 | ' +
                'E5:8 G5:8 | F#5:8 A5:8 | D#5:8 F#5:8',
    // --- Victoire (ré mixolydien) ---
    fanfare: 'D5:4 A5:4 F#5:6 E5:2 | E5:4 G5:4 E5:6 C5:2 | D5:4 G5:4 B5:6 A5:2 | A5:16',
    finalV: 'D5:24 r:8',
    // --- Défaite (ré mineur) ---
    chute: 'A4:8 F4:4 D4:4 | C4:8 E4:8 | D4:8 Bb3:8 | A3:8 C#4:8',
    finD: 'D4:28 r:4',
    // --- Invasion (gamme à huit sons sur fa# : fa# sol la la# do do# ré# mi) ---
    // Une seule cellule de trois notes qui monte, en 3 + 3 + 2.
    presage: 'r:16 | r:16 | F#4:6 G4:6 A4:4 | r:16',
    // Veille : la cellule piétine, puis monte d'un cran toutes les deux mesures.
    veilleurs1: 'F#4:3 G4:3 A4:2 r:8 | F#4:3 G4:3 A4:2 r:8 | G4:3 A4:3 A#4:2 r:8 | G4:3 A4:3 A#4:10 | ' +
                'A4:3 A#4:3 C5:2 r:8 | A4:3 A#4:3 C5:2 r:8 | A#4:3 C5:3 C#5:2 r:8 | A#4:3 C5:3 C#5:10',
    // Approche : un cran à chaque mesure.
    veilleurs2: 'F#4:3 G4:3 A4:2 r:8 | G4:3 A4:3 A#4:2 r:8 | A4:3 A#4:3 C5:2 r:8 | A#4:3 C5:3 C#5:10 | ' +
                'C5:3 C#5:3 D#5:2 r:8 | C#5:3 D#5:3 E5:2 r:8 | D#5:3 E5:3 F#5:2 r:8 | E5:3 F#5:3 G5:10',
    // Élévation : un cran à chaque demi-mesure.
    veilleurs3: 'F#4:3 G4:3 A4:2 G4:3 A4:3 A#4:2 | A4:3 A#4:3 C5:2 A#4:3 C5:3 C#5:2 | ' +
                'C5:3 C#5:3 D#5:2 C#5:3 D#5:3 E5:2 | D#5:3 E5:3 F#5:2 E5:3 F#5:3 G5:2',
    // Dernier carré : deux marches en avant, une en arrière, sans fin.
    veilleurs4: 'F#4:3 G4:3 A4:2 G4:3 A4:3 A#4:2 | A4:3 A#4:3 C5:2 A#4:3 C5:3 C#5:2 | ' +
                'A4:3 A#4:3 C5:2 A#4:3 C5:3 C#5:2 | C5:3 C#5:3 D#5:2 C#5:3 D#5:3 E5:2 | ' +
                'C5:3 C#5:3 D#5:2 C#5:3 D#5:3 E5:2 | D#5:3 E5:3 F#5:2 E5:3 F#5:3 G5:2 | ' +
                'D#5:3 E5:3 F#5:2 E5:3 F#5:3 G5:2 | F#5:3 G5:3 A5:2 G5:3 A5:3 A#5:2',
    // Assaut : la cellule en rafales ; l'appui reste, la dernière note grimpe.
    rafales: 'F#5:1 G5:1 A5:4 r:2 F#5:1 G5:1 A#5:4 r:2 | F#5:1 G5:1 C6:4 r:2 F#5:1 G5:1 C#6:4 r:2 | ' +
             'D#5:1 E5:1 F#5:4 r:2 D#5:1 E5:1 G5:4 r:2 | D#5:1 E5:1 A5:4 r:2 D#5:1 E5:1 A#5:4 r:2 | ' +
             'C5:1 C#5:1 D#5:4 r:2 C5:1 C#5:1 E5:4 r:2 | C5:1 C#5:1 F#5:4 r:2 C5:1 C#5:1 G5:4 r:2 | ' +
             'A4:1 A#4:1 C5:4 r:2 A4:1 A#4:1 C#5:4 r:2 | G4:1 A4:1 A#4:2 C5:2 C#5:2 D#5:2 E5:2 F#5:4',
    // Rempart : le thème des défenseurs (fa# mineur), sur le rythme de la cellule.
    rempart: 'A5:3 G#5:3 A5:2 C#6:8 | B5:3 A5:3 G#5:2 F#5:8 | C#6:3 B5:3 C#6:2 E6:8 | D6:3 C#6:3 B5:2 A5:8 | ' +
             'B5:3 A5:3 B5:2 D6:8 | C#6:3 B5:3 A5:2 F#5:8 | A5:3 B5:3 C#6:2 D6:4 E6:4 | F6:10 C#6:6',
    // Repli : deux soupirs d'un demi-ton, le second une octave plus bas.
    repli: 'G5:8 F#5:8 | r:16 | G4:8 F#4:8 | r:16',

    /* --- Nouvelles pistes (compositions originales) --- */
    // Calme 2 « Salines à perte de vue » (si dorien), flûte.
    salines1: 'F#5:12 E5:4 | D5:8 C#5:4 B4:4 | C#5:16 | r:8 A4:4 B4:4 | D5:12 E5:4 | F#5:8 A5:4 G#5:4 | F#5:16 | r:16',
    salines2: 'B5:8 A5:4 F#5:4 | G#5:12 E5:4 | F#5:6 E5:2 D5:8 | C#5:16 | D5:8 E5:4 F#5:4 | A5:8 G#5:4 E5:4 | F#5:24 r:8',
    salines3: 'r:8 F#5:4 E5:4 | C#5:16 | r:8 E5:4 D5:4 | B4:16',
    // Calme 3 « Patrouille de nuit » (mi bémol lydien).
    patrouille1: 'G5:4 Bb5:4 A5:8 | G5:4 F5:4 D5:8 | Eb5:4 F5:4 G5:4 C5:4 | F5:16 | G5:4 Bb5:4 C6:8 | ' +
                 'Bb5:4 A5:4 F5:8 | G5:6 F5:2 Eb5:8 | Eb5:16',
    patrouille2: 'C5:16 | D5:16 | D5:16 | Eb5:16 | C5:16 | F5:16 | Ab5:8 G5:8 | F5:16',
    // Tension 2 « Brume sur les digues » (fa mineur, couleur phrygienne).
    digues1: 'C4:12 Db4:4 | C4:8 Ab3:8 | F3:16 | r:16 | C4:12 Db4:4 | Eb4:8 Db4:4 C4:4 | Bb3:8 Db4:8 | C4:16',
    digues2: 'Ab5:12 G5:4 | F5:8 Eb5:8 | Bb5:12 Ab5:4 | G5:16 | C6:8 Db6:8 | C6:8 Bb5:4 Ab5:4 | Db6:12 C6:4 | C6:16',
    // Combat 2 « Marteau d'acier » (sol mineur).
    marteau1: 'G5:2 r:2 G5:2 Bb5:2 D6:4 C6:2 Bb5:2 | A5:2 r:2 A5:2 C6:2 F5:8',
    marteau1b: 'G5:2 r:2 G5:2 Bb5:2 D6:4 Eb6:2 D6:2 | C6:4 Bb5:4 A5:4 F#5:4',
    marteau2: 'G5:8 Bb5:8 | Eb6:16 | Eb6:8 D6:8 | C6:16 | D6:8 F6:8 | Bb5:16 | A5:8 C6:8 | D6:16',
    // Combat 3 « Ligne de feu » (do# mineur).
    feu1: 'C#5:12 E5:4 | G#5:8 F#5:4 E5:4 | A5:12 G#5:4 | E5:16 | F#5:6 E5:2 D#5:4 C#5:4 | B4:8 C#5:4 D#5:4 | ' +
          'C5:12 D#5:4 | G#5:16',
    feu2: 'G#5:4 B5:4 E6:8 | D#6:4 C#6:4 B5:8 | F#5:4 B5:4 D#6:8 | C#6:4 B5:4 F#5:8 | E5:4 A5:4 C#6:8 | ' +
          'B5:4 A5:4 E5:8 | D#5:4 G#5:4 C6:8 | D#6:16',
    // Menu 2 « Les Sentinelles de sel » (si bémol mineur).
    sentinelles: 'Bb4:8 F5:8 | Gb5:6 F5:2 Db5:8 | Eb5:8 Gb5:4 Bb5:4 | Db5:16 | Bb5:8 Ab5:4 F5:4 | Gb5:8 Eb5:8 | ' +
                 'F5:6 Eb5:2 Db5:4 C5:4 | A4:16',
    marche: 'F5:4 F5:2 Gb5:2 F5:4 Db5:4 | Gb5:4 Gb5:2 Ab5:2 Bb5:8 | Ab5:4 Ab5:2 F5:2 Ab5:4 Db6:4 | C6:12 A5:4 | ' +
            'Db6:4 Db6:2 C6:2 Bb5:4 F5:4 | Gb5:4 Bb5:4 Db6:8 | Eb6:4 Db6:4 Bb5:4 Gb5:4 | F5:8 A5:8'
  };

  // Motifs de batterie récurrents.
  const VIDE = '................';

  const PISTES = {

    /* ---------------- MENU : thème principal, épique et sombre ---------------- */
    menu: {
      titre: 'Front de Sel (thème principal)', bpm: 124, graine: 1101, gain: 0.95,
      fonduEntree: 1.5,
      sections: {
        intro: {
          mesures: 8, accords: ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A'], nappe: 0.8, impact: true,
          toms: ['B.....b.B.......', 'B.....b.B..b.mhh'], metal: ['x...............', VIDE],
          coups: ['X...............', null, null, null, 'X...............', null, null, null],
          melodie: ['appel'], instr: 'cuivre', montee: true
        },
        A: {
          mesures: 8, accords: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'], nappe: 0.45, crash: true, fill: true,
          kick: { choix: ['X..x....X.x.....', 'X..x....X.x...x.', 'X..x..x.X.x.....'] },
          caisse: { choix: ['....X.......X...', '....X..g....X..g', '....X.......X.g.'] },
          charley: { choix: ['x.x.x.x.x.x.x.x.', 'x.xgx.x.x.xgx.x.', 'x.x.x.x.x.x.x.o.'] },
          basse: { choix: ['x_x_x_xXx_x_x_Xx', 'x_x_x_x_x_xxX_x_'] },
          guitare: { choix: ['x.xx.xx.X___x.x.', 'x.xx.xx.X_____..', 'x.xx.xx.x.xxX___'] },
          melodie: ['theme'], coupures: 0.08, fantomes: 0.05
        },
        A2: {
          mesures: 8, accords: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'], nappe: 0.45, crash: true, fill: true,
          kick: { choix: ['X..x....X.x.....', 'X..x..x.X.x...x.'] },
          caisse: { choix: ['....X.......X...', '....X..g....X.gx'] },
          charley: { choix: ['xgxgxgxgxgxgxgxg', 'xgxgxgxgxgxgxgog'] },
          basse: { choix: ['x_x_x_xXx_x_x_Xx', 'x_xxx_X_x_xxx_Xx'] },
          guitare: { choix: ['x.xx.xx.X___x.x.', 'x.xx.xx.x.xxX___'] },
          coups: ['X...............', null, null, null, 'X...............', null, 'X.....X.........', 'X...............'],
          melodie: ['theme'], double: { instr: 'cuivre', transp: -12 }, coupures: 0.1, fantomes: 0.06
        },
        B: {
          mesures: 8, accords: ['Gm', 'Gm', 'Eb', 'Eb', 'Bb', 'C', 'A', 'A'], nappe: 0.6, crash: true, fill: true,
          kick: { choix: ['X.......X.......', 'X.....x.X.......'] },
          caisse: '....X.......X...', charley: 'x.x.x.x.x.x.x.x.',
          martiale: { choix: ['x.xxx.xxx.xxx.rr', 'x.xxx.xxx.xxrrrr'] }, niveaux: { martiale: 0.6 },
          guitare: ['X_______X_______', 'X_______X___x.x.'], basse: 'x_______x___x_x_',
          coups: [null, null, null, null, null, null, 'X.....X...X.....', 'X...............'],
          melodie: ['themeB']
        },
        pont: {
          mesures: 8, accords: ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A'], nappe: 0.8, crash: true,
          kick: ['X...............', 'X.......X.......'], martiale: 'x.xxx.xxx.xxx.xx', crescendo: true,
          toms: ['B.....b.........', 'B.....b...m.m...'], metal: ['x...............', '........x.......'],
          basse: 'x_______________', melodie: ['appel'], instr: 'cuivre', montee: true
        }
      },
      forme: ['intro', 'A', 'A2', 'B', 'pont', ['A', 'A2'], 'A2', 'B'], boucle: 1
    },

    /* ---------------- BRIEFING : tendu, en retrait, laisse lire ---------------- */
    briefing: {
      titre: 'Ordres de mission', bpm: 92, graine: 2202, gain: 2.1, fonduEntree: 2,
      mix: { kick: 0.6, basse: 0.55, guitareG: 0.5, guitareD: 0.5, toms: 0.6 },
      nappeFiltre: 900,
      sections: {
        intro: { mesures: 2, accords: ['Em', 'Em'], nappe: 0.7, cloche: ['0...............', VIDE] },
        A: {
          mesures: 8, accords: ['Em', 'Em', 'F', 'Em', 'Em', 'Em', 'Dm', 'F'], nappe: 0.6,
          basse: 'x.x.x.x.x.x.x.x.', niveaux: { basse: 0.7 },
          kick: { choix: ['X.........x.....', 'X.........x...x.'] },
          charley: { choix: ['....g.......g...', '..g...g...g...g.'] },
          toms: [null, null, null, '..........b..b..'],
          melodie: ['brief1'], instr: 'cloche'
        },
        B: {
          mesures: 8, accords: ['Am', 'Am', 'G', 'F', 'Dm', 'Dm', 'F', 'Em'], nappe: 0.6,
          kick: 'X.......X.......', basse: 'x.x.x.x.x.x.x.x.',
          martiale: { choix: ['g.g.ggg.g.g.ggg.', 'g.g.ggg.g.g.g.rr'] }, niveaux: { martiale: 0.7, basse: 0.7 },
          metal: ['x...............', null, null, null],
          guitare: ['X_______________', null, null, null], arp: '0.2.3.2.0.2.3.2.'
        },
        C: {
          mesures: 8, accords: ['Em', 'Em', 'F', 'F', 'Em', 'Em', 'Dm', 'Dm'], nappe: 0.75,
          basse: 'x.x.x.x.x.x.x.x.', niveaux: { basse: 0.6 }, toms: 'b...............',
          metal: [null, 'x...............'], melodie: ['brief2'], instr: 'cloche'
        }
      },
      forme: ['intro', 'A', 'B', 'C', ['A', 'B'], 'B', 'C'], boucle: 1
    },

    /* ---------------- CALME : exploration, ambiance pulsée ---------------- */
    calme: {
      titre: 'Côte sèche', bpm: 104, graine: 3303, gain: 2.2, fonduEntree: 3, entreeJeu: 'A',
      mix: { kick: 0.65, basse: 0.6 },
      sections: {
        intro: {
          mesures: 4, accords: ['Am9', 'Am/G', 'FM7', 'Esus4'], nappe: 0.7,
          arp: { choix: ['0..2..3..1..4.2.', '0..2..3..4..3.1.'] }
        },
        A: {
          mesures: 8, accords: ['Am9', 'Am/G', 'FM7', 'Esus4', 'Am9', 'Am/G', 'Dm9', 'E'], nappe: 0.5,
          arp: { choix: ['0..2..3..1..4.2.', '0..2..3..4..3.1.', '0..2..1..3..4.3.'] },
          kick: 'x.......x.......', charley: { choix: ['g.g.g.g.g.g.g.g.', 'g.gxg.g.g.gxg.g.'] },
          caisse: '............g...', basse: 'x_______x_____q_'
        },
        B: {
          mesures: 8, accords: ['Dm9', 'FM7', 'Am9', 'Em', 'Dm9', 'FM7', 'Esus4', 'E'], nappe: 0.5,
          kick: 'x.....x.x.......', charley: 'g.g.g.g.g.g.g.g.', toms: ['........m.......', null],
          basse: 'x_______x_______', arp: { choix: ['0...2...3...2...', '0..2..3..1..4.2.'] },
          melodie: ['calme1'], instr: 'cloche'
        },
        pont: {
          mesures: 4, accords: ['FM7', 'FM7', 'Esus4', 'E'], nappe: 0.8,
          cloche: ['0.......2.......', '4...............'], metal: [null, null, null, 'x...............']
        }
      },
      forme: ['intro', 'A', 'B', 'A', 'pont', ['B', 'A'], 'B'], boucle: 1
    },

    /* ---------------- TENSION : montée, menace ---------------- */
    tension: {
      titre: 'Mouvements au nord', bpm: 112, graine: 4404, gain: 1.3, fonduEntree: 1.5, entreeJeu: 'A',
      nappeFiltre: 1000,
      sections: {
        intro: {
          mesures: 4, accords: ['Cm', 'Cm', 'Db', 'Cm'], nappe: 0.7, kick: 'X..x............',
          metal: ['x...............', null], montee: true, basse: 'x_______________'
        },
        A: {
          mesures: 8, accords: ['Cm', 'Cm', 'Db', 'Cm', 'Cm', 'Cm', 'Ab', 'G'], nappe: 0.5, fill: true,
          kick: { choix: ['X.....x...X.....', 'X.....x...X...x.'] },
          toms: { choix: ['b.......b..b....', 'b.....b.b..b..m.'] }, charley: '..x...x...x...x.',
          basse: 'x_x_x_x_x_x_b_x_', guitare: ['X_______________', null],
          melodie: ['tension1'], instr: 'lead', niveaux: { toms: 0.7 }
        },
        B: {
          mesures: 8, accords: ['Ab', 'Ab', 'Fm', 'Fm', 'Db', 'Db', 'G', 'G'], nappe: 0.5, crash: true, montee: true,
          kick: 'X...X...X...X.x.', caisse: '........X.......', martiale: 'x.xxx.xxx.xxx.xx', crescendo: true,
          guitare: 'x.x.x.x.x.x.x.x.', basse: 'x_x_x_x_x_x_x_x_', charley: 'x.x.x.x.x.x.x.x.',
          coups: [null, null, null, null, null, null, 'X.......X.......', 'X...X...X.X.X.X.'],
          melodie: ['tension2'], instr: 'lead'
        },
        pont: {
          mesures: 4, accords: ['Cm', 'Db', 'Cm', 'Db'], nappe: 0.7, metal: 'x.......x.......',
          toms: 'b...............', melodie: ['tension3'], instr: 'cloche', niveaux: { metal: 0.6 }
        }
      },
      forme: ['intro', 'A', 'B', 'pont', 'A', 'B'], boucle: 1
    },

    /* ---------------- COMBAT : pleine énergie ---------------- */
    combat: {
      titre: 'Front de Sel — assaut', bpm: 140, graine: 5505, gain: 1.0, fonduEntree: 0.05, entreeJeu: 'intro',
      sections: {
        intro: {
          mesures: 2, accords: ['E5', 'E5'], impact: true, crash: true,
          kick: ['X.......X.......', 'X...X...X.X.X.X.'], caisse: [VIDE, '........x.xxXXXX'],
          toms: ['B.......B.......', VIDE], guitare: ['X_______________', 'X_______x.x.xxxx'],
          coups: ['X...............', null], basse: ['x_______________', 'x_______x.x.xxxx'], nappe: 0.4
        },
        A: {
          mesures: 8, accords: ['E5', 'E5', 'E5', 'E5', 'C5', 'D5', 'E5', 'E5'], nappe: 0.3, crash: true, fill: true,
          kick: { choix: ['X..x..x...x..x..', 'X..x..x...xx.x..', 'X..x..x.X.x..x.x'] },
          caisse: { choix: ['....X.......X...', '....X..g....X..g', '....X.g.....X.gx'] },
          charley: { choix: ['xgxgxgxgxgxgxgxg', 'xgxgxgxgxgxgxgog'] },
          basse: { choix: ['x_x_x_X_x_x_x_X_', 'x_xxx_X_x_xxx_Xx'] },
          guitare: ['x.xxx.xX__.x.xB_', 'x.xxx.xX__.xt.T_', 'x.xxx.xX__.x.xB_', 'x.x.xxx.x.xxS_Q_',
            'x.xx.xxxX___x.x.', 'x.xx.xxxX___x.x.', 'x.xxx.xX__.x.xB_', 'xxxxxxxxX___N_U_'],
          coupures: 0.12, fantomes: 0.05
        },
        A2: {
          mesures: 8, accords: ['E5', 'E5', 'E5', 'E5', 'C5', 'D5', 'E5', 'E5'], nappe: 0.3, crash: true, fill: true,
          kick: { choix: ['X..x..x...x..x..', 'X..x..x...xx.x..', 'X..x..x.X.x..x.x'] },
          caisse: { choix: ['....X.......X...', '....X..g....X..g', '....X.g.....X.gx'] },
          charley: { choix: ['xgxgxgxgxgxgxgxg', 'xgxgxgxgxgxgxgog'] },
          basse: { choix: ['x_x_x_X_x_x_x_X_', 'x_xxx_X_x_xxx_Xx'] },
          guitare: ['x.xxx.xX__.x.xB_', 'x.xxx.xX__.xt.T_', 'x.xxx.xX__.x.xB_', 'x.x.xxx.x.xxS_Q_',
            'x.xx.xxxX___x.x.', 'x.xx.xxxX___x.x.', 'x.xxx.xX__.x.xB_', 'xxxxxxxxX___N_U_'],
          melodie: ['combat1', 'combat1', 'combat1', 'combat1b'], instr: 'lead', coupures: 0.1
        },
        B: {
          mesures: 8, accords: ['A5', 'A5', 'C5', 'C5', 'D5', 'D5', 'B5', 'B5'], nappe: 0.5, crash: true, fill: true, montee: true,
          kick: { choix: ['X.......X.x.....', 'X.....x.X.x.....'] }, caisse: '....X.......X...',
          charley: 'x.x.x.x.x.x.x.x.', martiale: { choix: ['..g...g...g.g.rr', '..g...g...g...g.'] },
          guitare: ['X_______X___x.x.', 'X_______X_______'], basse: 'x_x_x_x_x_x_x_x_',
          coups: ['X.....X.....X...', null, 'X.....X.....X...', null, 'X.....X.....X...', null, 'X...X...X...X...', 'X...X...X.X.X.X.'],
          melodie: ['combat2'], instr: 'lead'
        },
        coupure: {
          mesures: 4, accords: ['E5', 'E5', 'E5', 'E5'], nappe: 0.4, crash: true,
          kick: 'X.......X.......', caisse: '........X.......', toms: ['........b.....b.', '........b...m.h.'],
          guitare: ['X___......x.x.x.', 'X___......xxxxxx'], basse: ['x___......x.x.x.', 'x___......xxxxxx'],
          coups: ['X...............', null, 'X...............', 'X...X...X...X.X.'], metal: 'x...............'
        },
        pont: {
          mesures: 8, accords: ['G5', 'G5', 'F5', 'F5', 'C5', 'C5', 'D5', 'B5'], nappe: 0.5, crash: true, fill: true,
          kick: 'X...X...X...X...', toms: { choix: ['m..m..m.b.b.m..m', 'm..m..m.b.b.mmhh'] },
          caisse: '............X...', metal: 'x.......x.......', niveaux: { metal: 0.7 },
          guitare: 'x.x.x.x.X___X___', basse: 'x_x_x_x_X___X___',
          melodie: ['combatPont'], instr: 'lead'
        },
        C: {
          mesures: 8, accords: ['E5', 'E5', 'E5', 'E5', 'C5', 'D5', 'E5', 'E5'], nappe: 0.3, crash: true, fill: true,
          kick: { choix: ['X..x..x...x..x..', 'X..x..x.X.x..x.x'] },
          caisse: { choix: ['....X.......X...', '....X..g....X.gx'] },
          charley: 'XxXxXxXxXxXxXxXx', basse: { choix: ['x_xxx_X_x_xxx_Xx'] },
          guitare: ['x.xxx.xX__.x.xB_', 'x.xxx.xX__.xt.T_', 'x.xxx.xX__.x.xB_', 'x.x.xxx.x.xxS_Q_',
            'x.xx.xxxX___x.x.', 'x.xx.xxxX___x.x.', 'x.xxx.xX__.x.xB_', 'xxxxxxxxX___N_U_'],
          coups: ['X...............', null, null, null, 'X.....X.........', 'X.....X.........', null, 'X...X...X.X.X.X.'],
          melodie: ['combat1', 'combat1', 'combat1', 'combat1b'], instr: 'lead', transp: 12,
          double: { instr: 'cuivre', transp: 0 }
        }
      },
      forme: ['intro', 'A', ['A2', 'C'], 'B', 'coupure', 'A2', 'pont', 'C', 'B'], boucle: 1
    },

    /* ---------------- VICTOIRE : court thème, puis nappe qui s'éteint ---------------- */
    victoire: {
      titre: 'Contrat rempli', bpm: 116, graine: 6606, gain: 1.0, fonduEntree: 0.05,
      sections: {
        fanfare: {
          mesures: 4, accords: ['D', 'C', 'G', 'D'], nappe: 0.5, crash: true, impact: true,
          kick: 'X...X...X...X.x.', toms: 'b...b...b...m.h.', martiale: 'x.xxx.xxx.xxrrrr',
          guitare: 'X_______X_______', basse: 'x_______x_______',
          coups: ['X.......X.......', 'X.......X.......', 'X.......X.....X.', 'X...............'],
          melodie: ['fanfare'], instr: 'lead', double: { instr: 'cuivre', transp: -12 }
        },
        final: {
          mesures: 2, accords: ['D5', 'D5'], nappe: 0.8, crash: true, impact: true,
          coups: ['X...............', null], guitare: ['X_______________', null], basse: ['x_______________', null],
          melodie: ['finalV'], instr: 'cuivre'
        },
        coda: {
          mesures: 4, accords: ['Dsus2', 'Dsus2', 'Dsus2', 'Dsus2'], nappe: 0.8, fondu: true,
          cloche: ['0...2...4.......', null, null, null]
        }
      },
      forme: ['fanfare', 'final', 'coda'], boucle: null
    },

    /* ---------------- DÉFAITE : thème lourd et descendant ---------------- */
    defaite: {
      titre: 'Repli', bpm: 72, graine: 7707, gain: 1.0, fonduEntree: 0.05,
      sections: {
        chute: {
          mesures: 4, accords: ['Dm', 'Dm/C', 'Bb', 'A'], nappe: 0.8, impact: true,
          coups: ['X...............', null, null, 'X...............'], toms: 'B.......b.......',
          martiale: [null, null, null, 'g.g.g.g.x.x.xxrr'], crescendo: true, basse: 'x_______________',
          guitare: ['X_______________', null, 'X_______________', 'X_______________'],
          melodie: ['chute'], instr: 'cuivre'
        },
        fin: {
          mesures: 2, accords: ['Dm', 'Dm'], nappe: 0.9, impact: true, coups: ['X...............', null],
          guitare: ['X_______________', null], basse: ['x_______________', null],
          melodie: ['finD'], instr: 'cuivre'
        },
        coda: { mesures: 3, accords: ['Dm', 'Dm', 'Dm'], nappe: 0.7, fondu: true }
      },
      forme: ['chute', 'fin', 'coda'], boucle: null
    },

    /* ---------------- INVASION : les Veilleurs ----------------
       Une menace colossale et inconnue, puis un combat désespéré. Tout sort
       d'une seule cellule de trois notes qui monte (rythme 3 + 3 + 2), dans
       une gamme à huit sons. Elle grimpe de plus en plus vite : toutes les
       deux mesures (veille), chaque mesure (approche), chaque demi-mesure
       (élévation), puis en rafales (assaut). Le thème des défenseurs
       (« rempart », fa# mineur) lui répond sur le même rythme.
       La forme réagit à l'intensité sans changer de piste : voir « paliers »
       et suivreIntensite() dans le lecteur. */
    invasion: {
      titre: 'Les Veilleurs', bpm: 108, graine: 8808, gain: 1.2, fonduEntree: 0.05,
      nappeFiltre: 1100,
      paliers: { assaut: ['assaut', 'dernierCarre'], sortie: 'repli', garde: 20 },
      sections: {
        // Le ciel s'assombrit : la nappe grave seule, une tôle lointaine, et
        // la cellule énoncée une seule fois, deux fois plus lentement.
        presage: {
          mesures: 4, accords: ['F#grp', 'F#grp', 'F#grp', 'F#grp'], nappe: 0.5, montee: true,
          bourdon: ['X_______________', null], bourdonMesures: 2,
          plaque: ['X...............', null, 'x...............', null],
          metal: [null, '..........x.....', null, '......x...x.....'], niveaux: { metal: 0.5 },
          toms: [null, null, null, '............b.B.'],
          melodie: ['presage'], instr: 'signal'
        },
        // Pulsation lente et lourde (pédale de fa#) ; la cellule piétine.
        veille: {
          mesures: 8, accords: ['F#grp', 'F#grp', 'Ggrp/F#', 'Ggrp/F#', 'F#grp', 'F#grp', 'Agrp/F#', 'Ggrp/F#'], nappe: 0.4,
          bourdon: ['X_______________', null], bourdonMesures: 2,
          kick: 'X.......x.......',
          toms: ['B.......b.......', 'B.......b.......', 'B.......b.......', 'B.......b.....b.'],
          basse: 'x___....x___....',
          metal: { choix: ['....x.......x...', '....x.....x.x...', '....x.......x..x'] }, niveaux: { metal: 0.55 },
          plaque: ['X...............', null, null, null],
          melodie: ['veilleurs1'], instr: 'signal'
        },
        // La basse se met en marche (elle monte par tierces mineures), la
        // caisse militaire approche, les cuivres doublent la cellule.
        approche: {
          mesures: 8, accords: ['F#grp', 'F#grp', 'Agrp', 'Agrp', 'Cgrp', 'Cgrp', 'D#grp', 'D#grp'], nappe: 0.4, crash: true,
          bourdon: ['X_______________', null], bourdonMesures: 2,
          kick: { choix: ['X.....x.X.......', 'X.....x.X.....x.'] },
          toms: { choix: ['B.......b.......', 'B.......b...m.b.'] },
          basse: 'x_____x_x_______', guitare: ['X_______________', null],
          martiale: 'g.g.ggg.g.g.ggg.', crescendo: true,
          metal: { choix: ['....x.......x...', '....x..x....x...', '....x.......x.x.'] },
          plaque: ['X...............', null, null, null],
          niveaux: { metal: 0.6, martiale: 0.7, guitare: 0.7 },
          melodie: ['veilleurs2'], instr: 'signal', double: { instr: 'cuivre', transp: -12 }
        },
        // Tout enfle, la cellule à chaque demi-mesure : l'attaque arrive.
        elevation: {
          mesures: 4, accords: ['F#grp', 'Agrp', 'Cgrp', 'D#grp'], nappe: 0.5, crash: true, montee: true,
          bourdon: 'X_______________',
          kick: 'X...X...X...X...',
          toms: ['b.......b.......', 'b.......b.....m.', 'b...b...b...b...', 'b.b.m.m.b.b.mmhh'],
          martiale: 'x.xxx.xxx.xxx.xx', crescendo: true,
          basse: 'x_x_x_x_x_x_x_x_', guitare: 'x.x.x.x.x.x.x.x.',
          coups: [null, null, null, 'X.......X.......'],
          niveaux: { martiale: 0.7 },
          melodie: ['veilleurs3'], instr: 'signal', double: { instr: 'cuivre', transp: -12 }
        },
        // Assaut : la basse descend par tierces mineures pendant que la
        // cellule, en rafales, pousse sa dernière note toujours plus haut.
        assaut: {
          mesures: 8, accords: ['F#5', 'F#5', 'D#5', 'D#5', 'C5', 'C5', 'A5', 'G5'], nappe: 0.3,
          impact: true, crash: true, fill: true,
          kick: { choix: ['X..x..x.X..x..x.', 'X..x..x.X..x.xx.'] },
          caisse: { choix: ['....X.......X...', '....X.......X.gx'] },
          charley: 'x.x.x.x.x.x.x.x.', martiale: 'g.ggg.ggg.ggg.gg',
          basse: ['x__x__b_x__x__l_', 'x__x__b_x__x__l_', 'x__x__b_x__x__l_', 'x__x__b_x__x__l_',
            'x__x__b_x__x__l_', 'x__x__b_x__x__l_', 'x__x__b_x__x__l_', 'x__x__x_x_x_xxxx'],
          guitare: 'X_xX_xX_X_xX_xX_',
          metal: 'x.......x.......', plaque: ['X...............', null, null, null],
          coups: ['X...............', null, 'X...............', null, 'X...............', null, 'X...............', 'X.....X.....X.X.'],
          niveaux: { martiale: 0.45, metal: 0.5 },
          melodie: ['rafales'], instr: 'signal', double: { instr: 'cuivre', transp: -12 }
        },
        // Le dernier rempart : le thème des défenseurs.
        rempart: {
          mesures: 8, accords: ['F#5', 'F#5', 'A5', 'A5', 'B5', 'B5', 'D5', 'C#5'], nappe: 0.4, crash: true, fill: true,
          kick: { choix: ['X..x..x.X.x.....', 'X..x..x.X.x...x.'] },
          caisse: { choix: ['....X.......X...', '....X..g....X..g'] }, charley: 'xgxgxgxgxgxgxgxg',
          basse: 'x_xxx_xxx_xxx_xx', guitare: ['x.xxx.xxX___x.xx', 'x.xxx.xxx.xxX___'],
          coups: [null, null, null, null, null, null, 'X.......X.......', 'X...X...X.X.X.X.'],
          melodie: ['rempart'], instr: 'lead', double: { instr: 'cuivre', transp: -12 }
        },
        // Dernier carré : tout l'orchestre martèle la cellule, sur une basse
        // qui monte sans fin.
        dernierCarre: {
          mesures: 8, accords: ['F#5', 'F#5', 'A5', 'A5', 'C5', 'C5', 'D#5', 'D#5'], nappe: 0.4,
          impact: true, crash: true, fill: true, montee: true,
          kick: 'X...X...X...X.x.', caisse: '....X.......X...',
          toms: { choix: ['m..m..m.b..b..b.', 'm..m..m.b..b.mhh'] },
          martiale: 'x.xxx.xxx.xxx.rr', metal: 'x.......x.......', plaque: ['X...............', null],
          guitare: 'X_xX_xX_X_xX_xX_', basse: 'x__x__x_x__x__x_',
          coups: ['X...............', 'X.......X.......'],
          niveaux: { martiale: 0.5, metal: 0.6, toms: 0.8 },
          melodie: ['veilleurs4'], instr: 'signal', double: { instr: 'lead', transp: 0 }
        },
        // Repli : le fracas retombe, il ne reste que la masse et son souffle.
        repli: {
          mesures: 4, accords: ['F#grp', 'F#grp', 'Ggrp/F#', 'F#grp'], nappe: 0.5, impact: true,
          bourdon: ['X_______________', null], bourdonMesures: 2,
          kick: ['X...............', null, 'X.......x.......', 'X.......x.......'],
          toms: ['B...............', null, 'B.......b.......', 'B.......b...b.B.'],
          metal: ['....x.......x...', '........x.......'], niveaux: { metal: 0.5 },
          plaque: ['X...............', null, null, null],
          melodie: ['repli'], instr: 'signal'
        }
      },
      forme: ['presage', 'veille', 'approche', 'elevation', 'assaut', 'rempart', 'dernierCarre', 'repli'], boucle: 1
    },

    /* ==================== NOUVELLES PISTES ====================
       Chacune appartient à une famille (« famille ») : quand le jeu demande
       'calme', le moteur choisit l'une des pistes de la famille et passe à
       une autre à la fin d'un cycle complet (voir choisirPiste). */

    /* ---- CALME 2 : lent, aérien. Si dorien, 84 bpm, chœur, flûte, grand
       tambour lointain ; pas de batterie ni d'arpège. ---- */
    calme2: {
      famille: 'calme', titre: 'Salines à perte de vue', bpm: 84, graine: 9101, gain: 1.7, fonduEntree: 3, entreeJeu: 'A',
      sections: {
        intro: {
          mesures: 4, accords: ['Bm9', 'Bm9', 'E/B', 'E/B'], choeur: 0.7,
          taiko: ['X...............', VIDE, VIDE, '........x.......'], niveaux: { taiko: 0.4 }
        },
        A: {
          mesures: 8, accords: ['Bm9', 'E/B', 'Bm9', 'E/B', 'GM7', 'Asus4', 'Bm9', 'F#m7'], choeur: 0.55,
          taiko: ['X.........x.....', '........x.......'], basse: ['x_______________', 'x_______q_______'],
          niveaux: { taiko: 0.4, basse: 0.35 },
          melodie: ['salines1'], instr: 'flute'
        },
        B: {
          mesures: 8, accords: ['GM7', 'A', 'F#m7', 'Bm9', 'GM7', 'A', 'Bsus4', 'Bm'], choeur: 0.6,
          taiko: { choix: ['X.....x...x.....', 'X.........x..x..'] }, charley: '..g...g...g...g.',
          basse: 'x_______x_______', niveaux: { taiko: 0.45, basse: 0.35, charley: 1 },
          melodie: ['salines2'], instr: 'flute'
        },
        souffle: {
          mesures: 4, accords: ['GM7', 'GM7', 'Asus4', 'Asus4'], choeur: 0.75,
          metal: [null, '........x.......', null, null], niveaux: { metal: 0.4 },
          melodie: ['salines3'], instr: 'flute'
        },
        A2: {
          mesures: 8, accords: ['Bm9', 'E/B', 'Bm9', 'E/B', 'GM7', 'Asus4', 'Bm9', 'F#m7'], choeur: 0.55,
          taiko: { choix: ['X.....x...x.....', 'X.........x..x..'] }, charley: '..g...g...g...g.',
          basse: ['x_______________', 'x_______q_______'], niveaux: { taiko: 0.45, basse: 0.35, charley: 1 },
          melodie: ['salines1'], instr: 'flute', double: { instr: 'flute', transp: -12 }
        }
      },
      forme: ['intro', 'A', 'B', 'souffle', 'A2', 'B'], boucle: 1
    },

    /* ---- CALME 3 : électronique pulsée et claire. Mi bémol lydien, 120 bpm,
       séquence en créneaux, basse acide douce, claquements, synthé lead
       discret ; pas de cloche ni d'arpège pincé. ---- */
    calme3: {
      famille: 'calme', titre: 'Patrouille de nuit', bpm: 120, graine: 9202, gain: 3.0, fonduEntree: 2.5, entreeJeu: 'A',
      nappeFiltre: 1600, mix: { kick: 0.6 },
      sections: {
        intro: {
          mesures: 4, accords: ['Ebadd9', 'F/Eb', 'Cm7', 'Bbsus4'], nappe: 0.6,
          pulse: ['0.2.1.3.0.2.4.3.', '0.2.1.3.2.4.3.1.'], niveaux: { pulse: 0.7 }, montee: true
        },
        A: {
          mesures: 8, accords: ['Ebadd9', 'F/Eb', 'Cm7', 'Bbsus4', 'Ebadd9', 'F/Eb', 'Cm7', 'Bbsus4'], nappe: 0.4,
          pulse: { choix: ['0.2.1.3.0.2.4.3.', '0.2.1.3.2.4.3.1.', '0.1.2.0.3.2.4.2.'] },
          acide: ['x.......x.....x.', 'x.......x...x.q.'], kick: 'x.......x.......',
          charley: { choix: ['g.g.g.g.g.g.g.g.', 'g.g.g.g.g.g.ggg.'] },
          niveaux: { acide: 0.55, kick: 0.8 }
        },
        A2: {
          mesures: 8, accords: ['Ebadd9', 'F/Eb', 'Cm7', 'Bbsus4', 'Ebadd9', 'F/Eb', 'Cm7', 'Bbsus4'], nappe: 0.4,
          pulse: { choix: ['0.2.1.3.0.2.4.3.', '0.2.1.3.2.4.3.1.', '0.1.2.0.3.2.4.2.'] },
          acide: ['x.......x.....x.', 'x.......x...x.q.'], kick: 'x.......x.......',
          charley: 'g.g.g.g.g.g.g.g.', clap: '............x...',
          niveaux: { acide: 0.55, kick: 0.8, clap: 0.5, melodie: 0.5 },
          melodie: ['patrouille1'], instr: 'lead'
        },
        B: {
          mesures: 8, accords: ['AbM7', 'Bb', 'Gm7', 'Cm7', 'AbM7', 'Bb', 'Fm7', 'Bbsus4'], nappe: 0.5, crash: true,
          pulse: { choix: ['0213021302130214', '0213021302134231'] },
          acide: { choix: ['x_..x_..x_..x_q.', 'x_..x_..x_..x.Xq'] }, kick: 'x...x...x...x...',
          clap: '....x.......x...', charley: '..x...x...x...x.',
          niveaux: { acide: 0.55, kick: 0.75, clap: 0.6, pulse: 0.8 },
          melodie: ['patrouille2'], instr: 'cuivre'
        },
        veille: {
          mesures: 4, accords: ['Cm7', 'Cm7', 'Bbsus4', 'Bbsus4'], nappe: 0.7,
          pulse: ['0.......2.......', '0...1...2...3...'], metal: [null, null, null, '........x.......'],
          niveaux: { metal: 0.4 }, montee: true
        }
      },
      forme: ['intro', 'A', 'A2', 'B', 'veille', 'A2', 'B'], boucle: 1
    },

    /* ---- TENSION 2 : menace sourde. Fa mineur (seconde bémol), 96 bpm,
       grand tambour en ostinato, tic-tac de créneaux, basse acide qui
       glisse d'un demi-ton, chœur ; les guitares n'arrivent qu'au sommet. ---- */
    tension2: {
      famille: 'tension', titre: 'Brume sur les digues', bpm: 96, graine: 9303, gain: 2.0, fonduEntree: 1.5, entreeJeu: 'A',
      sections: {
        intro: {
          mesures: 4, accords: ['Fm', 'Fm', 'Gb/F', 'Fm'], choeur: 0.5, montee: true,
          taiko: ['X...............', null, 'X...............', '........X...x.x.'],
          pulse: '0.......0.......', niveaux: { pulse: 0.6 }
        },
        A: {
          mesures: 8, accords: ['Fm', 'Fm', 'Gb/F', 'Fm', 'Fm', 'Fm', 'Db/F', 'C'], choeur: 0.4, fill: true,
          taiko: { choix: ['X.....x.....x...', 'X.....x.....x.x.'] },
          pulse: '0.0.0.0.0.0.0.0.', acide: { choix: ['x..x..b.x..x..b.', 'x..x..b.x..x.bx.'] },
          metal: [null, null, null, '............x...'],
          niveaux: { pulse: 0.55, acide: 0.6, metal: 0.5 }
        },
        B: {
          mesures: 8, accords: ['Fm', 'Fm', 'Gb/F', 'Fm', 'Fm', 'Fm', 'Db/F', 'C'], choeur: 0.5, fill: true,
          taiko: { choix: ['X.....x.....x...', 'X..x..x.....x.x.'] }, kick: 'X...............',
          pulse: '0000000000000000', acide: { choix: ['X..x..B.x..xb.x.', 'X..x..B.x..x..b.'] },
          clap: '........x.......', metal: '........x.......',
          niveaux: { pulse: 0.45, acide: 0.65, metal: 0.45, clap: 0.5 },
          melodie: ['digues1'], instr: 'cuivre'
        },
        C: {
          mesures: 8, accords: ['Db', 'Db', 'Eb', 'Eb', 'Fm', 'Fm', 'Gb', 'C'], choeur: 0.6, crash: true, fill: true, montee: true,
          taiko: 'X..x..x.X..x..x.', kick: 'X.......X.......', martiale: 'g.g.g.g.g.g.gggg', crescendo: true,
          guitare: ['X_______________', null], acide: 'X..x..x.x..x..x.', pulse: '0.0.0.0.0.0.0.0.',
          niveaux: { acide: 0.6, pulse: 0.45, martiale: 0.6, guitare: 0.7 },
          melodie: ['digues2'], instr: 'lead'
        },
        digue: {
          mesures: 4, accords: ['Gb/F', 'Gb/F', 'Fm', 'C'], choeur: 0.6,
          taiko: ['X.....x.....x...', 'X.....x.....x...', 'X.....x.....x...', 'X..x..x.x.x.xxxx'],
          metal: ['x...............', null], niveaux: { metal: 0.5 }
        }
      },
      forme: ['intro', 'A', 'B', 'C', 'digue', 'B', 'C'], boucle: 1
    },

    /* ---- COMBAT 2 : techno industrielle. Sol mineur, 152 bpm, grosse caisse
       à chaque temps, claquements, basse acide en doubles-croches, guitares
       en coups décalés (pas de rythmique continue), lead en créneaux. ---- */
    combat2: {
      famille: 'combat', titre: "Marteau d'acier", bpm: 152, graine: 9404, gain: 1.12, fonduEntree: 0.05, entreeJeu: 'intro',
      sections: {
        intro: {
          mesures: 2, accords: ['Gm', 'D'], impact: true, nappe: 0.3,
          acide: 'xXxxtxXxxXxxsxQx', kick: [VIDE, 'X...X...X.X.XXXX'], clap: [VIDE, '............XXXX'],
          coups: ['X...............', null], niveaux: { clap: 0.7 }
        },
        A: {
          mesures: 8, accords: ['Gm', 'Gm', 'Eb', 'F', 'Gm', 'Gm', 'Bb', 'D'], nappe: 0.25, crash: true, fill: true,
          kick: { choix: ['X...X...X...X...', 'X...X...X...X.x.', 'X...X..xX...X...'] },
          clap: '....X.......X...', charley: { choix: ['..x...x...x...x.', '..x...x...x..xx.'] },
          acide: { choix: ['xXxxtxXxxXxxsxQx', 'xXxxtxXxxXxxnxux'] },
          guitare: { choix: ['..X_..x...X_..x.', '..X_..x...X_.xX_'] },
          niveaux: { guitare: 0.8, clap: 0.8 }, coupures: 0.1
        },
        A2: {
          mesures: 8, accords: ['Gm', 'Gm', 'Eb', 'F', 'Gm', 'Gm', 'Bb', 'D'], nappe: 0.25, crash: true, fill: true,
          kick: { choix: ['X...X...X...X...', 'X...X...X...X.x.'] },
          clap: '....X.......X...', charley: 'x.x.x.x.x.x.x.x.',
          acide: { choix: ['xXxxtxXxxXxxsxQx', 'xXxxtxXxxXxxnxux'] },
          guitare: { choix: ['..X_..x...X_..x.', '..X_..x...X_.xX_'] },
          niveaux: { guitare: 0.8, clap: 0.8 }, coupures: 0.08,
          melodie: ['marteau1', 'marteau1', 'marteau1', 'marteau1b'], instr: 'lead', double: { instr: 'pulse', transp: 12 }
        },
        B: {
          mesures: 8, accords: ['Eb', 'Eb', 'Cm', 'Cm', 'Bb', 'Bb', 'D', 'D'], nappe: 0.5, crash: true, montee: true,
          kick: 'X.........X.....', clap: '........X.......', acide: 'X_______x...x...',
          pulse: '0123012301230123', metal: 'x...............',
          coups: [null, null, null, null, null, null, 'X.......X.......', 'X...X...X.X.X.X.'],
          niveaux: { pulse: 0.7, metal: 0.5, acide: 0.8 },
          melodie: ['marteau2'], instr: 'cuivre', transp: -12
        },
        presse: {
          mesures: 2, accords: ['Gm', 'D'], nappe: 0.3, montee: true,
          kick: ['X.......X.......', 'X...X...X.X.XXXX'], toms: ['........b..b.m.m', 'h.h.m.m.b.b.BBBB'],
          acide: ['x.x.x.x.x.x.x.x.', 'xxxxxxxxXXXXXXXX']
        },
        C: {
          mesures: 8, accords: ['Gm', 'Gm', 'Eb', 'F', 'Gm', 'Gm', 'Bb', 'D'], nappe: 0.3, impact: true, fill: true,
          kick: { choix: ['X...X...X...X...', 'X...X...X...X.x.'] },
          clap: '....X.......X...', charley: 'XxXxXxXxXxXxXxXx',
          acide: { choix: ['xXxxtxXxxXxxsxQx', 'xXxxtxXxxXxxnxux'] },
          guitare: 'x.xxX_x.xxX_x.X_',
          coups: ['X...............', null, null, null, 'X...............', null, null, 'X.....X.....X...'],
          niveaux: { guitare: 0.85, clap: 0.8, charley: 0.7 },
          melodie: ['marteau1', 'marteau1', 'marteau1', 'marteau1b'], instr: 'lead', double: { instr: 'cuivre', transp: -12 }
        }
      },
      forme: ['intro', 'A', 'A2', 'B', 'presse', 'C', 'A2', 'B', 'C'], boucle: 1
    },

    /* ---- COMBAT 3 : charge martiale. Do# mineur, 128 bpm en demi-mesure
       lourde puis au galop, grands tambours, caisse militaire continue,
       chœur et cuivres héroïques ; pas de basse acide ni de claquements. ---- */
    combat3: {
      famille: 'combat', titre: 'Ligne de feu', bpm: 128, graine: 9505, gain: 1.0, fonduEntree: 0.05, entreeJeu: 'intro',
      sections: {
        intro: {
          mesures: 2, accords: ['C#m', 'G#'], impact: true, choeur: 0.5,
          taiko: ['X..x..x.X..x..x.', 'X..x..x.X.x.XXXX'], coups: ['X...............', 'X.......X.......'],
          martiale: [VIDE, 'x.x.x.x.rrrrrrrr'], crescendo: true, guitare: ['X_______________', 'X_______X_______']
        },
        A: {
          mesures: 8, accords: ['C#m', 'C#m', 'A', 'A', 'F#m', 'F#m', 'G#', 'G#'], choeur: 0.4, crash: true, fill: true,
          kick: { choix: ['X.........X.....', 'X.........X..x..'] }, caisse: '........X.......',
          taiko: { choix: ['X..x..x.........', 'X..x..x...x..x..'] }, martiale: 'g.g.g.g.g.g.g.g.',
          guitare: { choix: ['X___x.x.X___x.xx', 'X___x.x.X___xxxx'] }, basse: 'x___x.x.x___x.x.',
          niveaux: { martiale: 0.55, taiko: 0.8 },
          melodie: ['feu1'], instr: 'cuivre'
        },
        B: {
          mesures: 8, accords: ['E', 'E', 'B', 'B', 'A', 'A', 'G#', 'G#'], choeur: 0.45, crash: true, fill: true,
          kick: { choix: ['X..x....X..x....', 'X..x....X..x..x.'] }, caisse: '....X.......X...',
          martiale: '..x.rr..x.rr..xx', charley: 'x.x.x.x.x.x.x.x.',
          guitare: 'x.xxx.xxx.xxX___', basse: 'x.xxx.xxx.xxx___',
          coups: [null, null, null, 'X...............', null, null, null, 'X...X...X.X.X.X.'],
          niveaux: { martiale: 0.6 },
          melodie: ['feu2'], instr: 'lead', double: { instr: 'cuivre', transp: -12 }
        },
        tranchee: {
          mesures: 4, accords: ['C#m', 'C#m', 'G#', 'G#'], choeur: 0.6, montee: true,
          taiko: ['X..x..x.X.......', 'X..x..x.X..x....', 'X..x..x.X..x..x.', 'X.x.X.x.XxXxXXXX'],
          martiale: 'x.xxx.xxx.xxx.xx', crescendo: true, basse: 'x_______________',
          niveaux: { martiale: 0.7 }
        },
        A2: {
          mesures: 8, accords: ['C#m', 'C#m', 'A', 'A', 'F#m', 'F#m', 'G#', 'G#'], choeur: 0.4, impact: true, fill: true,
          kick: 'X.........X..x..', caisse: '........X.......',
          taiko: 'X..x..x...x..x..', martiale: 'g.g.g.g.g.g.gggg',
          guitare: { choix: ['X___x.x.X___x.xx', 'X___x.x.X___xxxx'] }, basse: 'x___x.x.x___x.x.',
          coups: ['X...............', null, 'X...............', null, 'X...............', null, 'X.......X.......', 'X...X...X...X.X.'],
          niveaux: { martiale: 0.55, taiko: 0.8 },
          melodie: ['feu1'], instr: 'lead', transp: 12, double: { instr: 'cuivre', transp: 0 }
        }
      },
      forme: ['intro', 'A', 'B', 'tranchee', 'A2', 'B'], boucle: 1
    },

    /* ---- MENU 2 : hymne lent puis marche. Si bémol mineur, 96 bpm, chœur et
       grands tambours, thème aux cuivres, marche à la caisse militaire. ---- */
    menu2: {
      famille: 'menu', titre: 'Les Sentinelles de sel', bpm: 96, graine: 9606, gain: 0.9, fonduEntree: 2,
      sections: {
        intro: {
          mesures: 8, accords: ['Bbm', 'Bbm', 'Gb', 'Gb', 'Ebm', 'Ebm', 'F', 'F'], choeur: 0.6, impact: true, montee: true,
          taiko: ['X...............', null, 'X.......x.......', null], guitare: ['X_______________', null],
          niveaux: { taiko: 0.8, guitare: 0.6 },
          melodie: ['sentinelles'], instr: 'cuivre'
        },
        marche: {
          mesures: 8, accords: ['Bbm', 'Gb', 'Db', 'F', 'Bbm', 'Gb', 'Ebm', 'F'], nappe: 0.4, crash: true, fill: true,
          kick: { choix: ['X.......X.......', 'X.......X.....x.'] }, caisse: '....X.......X...',
          martiale: { choix: ['f..x..x.f..x.xrr', 'f..x..x.f..x..x.'] }, taiko: 'x.......x.......',
          basse: 'x_____x_x_q_x___', guitare: 'X_____x.X_____x.',
          niveaux: { martiale: 0.6, taiko: 0.6, guitare: 0.8 },
          melodie: ['marche'], instr: 'lead'
        },
        hymne: {
          mesures: 8, accords: ['Bbm', 'Bbm', 'Gb', 'Gb', 'Ebm', 'Ebm', 'F', 'F'], choeur: 0.55, crash: true, fill: true,
          kick: 'X.......X.......', caisse: '....X.......X...', charley: 'x.x.x.x.x.x.x.x.',
          taiko: { choix: ['X.....x.X.......', 'X.....x.X.....x.'] }, basse: 'x_______x_______', guitare: 'X_______X___x.x.',
          coups: ['X...............', null, 'X...............', null, 'X...............', null, 'X.......X.......', 'X...X...X.X.X.X.'],
          niveaux: { taiko: 0.7 },
          melodie: ['sentinelles'], instr: 'lead', double: { instr: 'cuivre', transp: -12 }
        },
        repos: {
          mesures: 4, accords: ['Gb', 'Gb', 'F', 'F'], choeur: 0.7,
          cloche: ['0...............', null, '2...............', null], taiko: [null, 'X...............', null, '........x...x.x.'],
          niveaux: { taiko: 0.6 }, montee: true
        }
      },
      forme: ['intro', 'marche', 'hymne', 'repos', 'marche', 'hymne'], boucle: 1
    }
  };

  // Pré-analyse des phrases et vérification des motifs au chargement.
  const PHRASES_LUES = {};
  for (const nom in PHRASES) PHRASES_LUES[nom] = lirePhrase(PHRASES[nom]);
  // Familles : une ambiance demandée par le jeu ('calme', 'combat'…) → les
  // pistes qui la servent, la piste d'origine en premier. Une piste sans
  // champ « famille » forme sa propre famille.
  const FAMILLES = {};
  const COUCHES = ['kick', 'caisse', 'charley', 'toms', 'metal', 'martiale', 'basse', 'guitare', 'coups', 'arp', 'cloche',
    'bourdon', 'plaque', 'taiko', 'clap', 'acide', 'pulse'];
  (function verifier() {
    for (const nomPiste in PISTES) {
      const def = PISTES[nomPiste];
      def.nom = nomPiste;
      def.famille = def.famille || nomPiste;
      if (!FAMILLES[def.famille]) FAMILLES[def.famille] = [];
      FAMILLES[def.famille].push(nomPiste);
      for (const nomSec in def.sections) {
        const S = def.sections[nomSec];
        const motifs = [];
        COUCHES.forEach(k => {
          const v = S[k];
          if (typeof v === 'string') motifs.push(v);
          else if (Array.isArray(v)) v.forEach(x => x && motifs.push(x));
          else if (v && v.choix) v.choix.forEach(x => motifs.push(x));
        });
        motifs.forEach(m => { if (m.length !== 16) console.warn('[Musique] motif de longueur', m.length, nomPiste, nomSec, m); });
        S.accords.forEach(lireAccord);
        (S.melodie || []).forEach(p => { if (!PHRASES_LUES[p]) console.warn('[Musique] phrase inconnue', p); });
      }
      def.forme.forEach(e => [].concat(e).forEach(n => { if (!def.sections[n]) console.warn('[Musique] section inconnue', nomPiste, n); }));
      if (def.paliers) {   // zones nommées → indices dans la forme
        const pal = def.paliers;
        pal.debut = def.forme.indexOf(pal.assaut[0]); pal.fin = def.forme.indexOf(pal.assaut[1]);
        pal.iSortie = def.forme.indexOf(pal.sortie);
        if (pal.debut < 0 || pal.fin < pal.debut || pal.iSortie < 0) console.warn('[Musique] paliers illisibles', nomPiste);
      }
    }
  })();

  // Breaks de batterie : seconde moitié de la dernière mesure d'une section.
  const BREAKS = [
    { caisse: 'x.xxX.XX', toms: '........' },
    { caisse: 'X.......', toms: '..hhmmbB' },
    { caisse: 'rrrrrrrX', toms: '........' },
    { caisse: 'X...x.x.', toms: '.h.m.bbB' }
  ];

  /* ==========================================================================
     6. LECTEUR
     Une instance de piste en cours : sa forme, sa mesure, ses canaux.
     ========================================================================== */

  function creerLecteur(mt, def, t0, options) {
    const c = mt.c;
    const P = {
      mt, c, def, t0, tDebut: t0,
      pas: 60 / def.bpm / 4,
      alea: aleaGraine(options.graine != null ? options.graine : def.graine),
      k: {}, formeIdx: 0, boucles: 0, mesureSec: 0, pasMesure: 0,
      tProchain: t0, arret: Infinity, termine: false, sortant: false, accordPrec: null,
      calmeDepuis: null
    };
    P.mesureDuree = P.pas * 16;
    P.bus = nGain(c, def.gain); P.busRev = nGain(c, def.gain);
    P.fondu = nGain(c, 0); P.fonduRev = nGain(c, 0);
    P.bus.connect(P.fondu); P.busRev.connect(P.fonduRev);
    P.fondu.connect(mt.maitre.entree); P.fonduRev.connect(mt.maitre.revEntree);
    // Entrée directe dans une section (passage calme → combat, par exemple).
    const i = options.section ? def.forme.findIndex(e => [].concat(e).indexOf(options.section) >= 0) : -1;
    if (i >= 0) {
      P.formeIdx = i;
      entrerSection(P, options.section);
    } else {
      P.formeIdx = 0;
      entrerSection(P, choisirSection(P, def.forme[0]));
    }
    return P;
  }

  function choisirSection(P, entree) {
    return Array.isArray(entree) ? entree[Math.floor(P.alea() * entree.length)] : entree;
  }

  function entrerSection(P, nom) {
    P.nomSection = nom;
    P.section = P.def.sections[nom];
    P.mesureSec = 0;
    // Mélodie : phrases enchaînées et répétées sur toute la section.
    P.melo = new Map();
    const S = P.section;
    if (S.melodie && S.melodie.length) {
      const total = S.mesures * 16;
      let debut = 0, i = 0, garde = 0;
      while (debut < total && garde++ < 64) {
        const ph = PHRASES_LUES[S.melodie[i % S.melodie.length]];
        if (!ph || !ph.longueur) break;
        for (const e of ph.evts) {
          const p = debut + e.pas;
          if (p >= total) continue;
          if (!P.melo.has(p)) P.melo.set(p, []);
          P.melo.get(p).push(e);
        }
        debut += ph.longueur; i++;
      }
    }
  }

  // Pistes « à paliers » (invasion) : la forme réagit à l'intensité sans
  // changer de piste, avec les mêmes seuils que calme / tension / combat.
  //   - intensité forte hors de la zone d'assaut : saut vers l'assaut dès la
  //     prochaine barre de mesure (on monte vite) ;
  //   - intensité encore forte à la fin de la zone d'assaut : l'assaut reboucle ;
  //   - intensité restée basse assez longtemps : l'assaut s'abrège, on passe
  //     à la section de sortie dès la fin de la section en cours.
  // Sinon la forme se déroule en entier. Les « garde » premières secondes
  // sont protégées : l'entrée de la piste n'est jamais sautée.
  function allerA(P, idx, t) {
    P.formeIdx = idx;
    entrerSection(P, choisirSection(P, P.def.forme[idx]));
    if (P.mt.journal) P.mt.journal.push({ demande: t, bascule: t, nom: P.def.nom, section: P.nomSection, palier: true });
  }

  // Appelée à chaque barre de mesure d'une piste à paliers.
  function suivreIntensite(P, t) {
    const pal = P.def.paliers, x = P.mt.intens || 0;
    if (x < DESCENTE[2]) { if (P.calmeDepuis == null) P.calmeDepuis = t; } else P.calmeDepuis = null;
    const dansAssaut = P.formeIdx >= pal.debut && P.formeIdx <= pal.fin;
    if (!dansAssaut && x >= MONTEE[2] && t - P.tDebut >= pal.garde) allerA(P, pal.debut, t);
  }

  function sectionSuivante(P) {
    const pal = P.def.paliers;
    if (pal && P.formeIdx >= pal.debut && P.formeIdx <= pal.fin) {
      const calme = P.calmeDepuis != null && P.tProchain - P.calmeDepuis >= ATTENTE_DESCENTE[2];
      if (calme) { allerA(P, pal.iSortie, P.tProchain); return true; }
      if (P.formeIdx === pal.fin && (P.mt.intens || 0) >= MONTEE[2]) { allerA(P, pal.debut, P.tProchain); return true; }
    }
    if (P.formeIdx + 1 >= P.def.forme.length && P.rotation && !P.sortant && P.mt.courante === P) {
      // Cycle complet d'une piste d'une famille à plusieurs pistes : elle
      // s'achève ici (fondu de ses queues) et le moteur enchaîne une autre
      // piste de la famille sur cette barre de mesure (voir moteurAvancer).
      P.finCycle = true;
      return false;
    }
    P.formeIdx++;
    if (P.formeIdx >= P.def.forme.length) {
      if (P.def.boucle == null) return false;
      P.formeIdx = P.def.boucle; P.boucles++;
    }
    entrerSection(P, choisirSection(P, P.def.forme[P.formeIdx]));
    return true;
  }

  function cycle(v, m) { return v[m % v.length]; }

  function motifMesure(couche, m, alea) {
    if (couche == null) return null;
    if (typeof couche === 'string') return couche;
    if (Array.isArray(couche)) return cycle(couche, m);
    if (couche.choix) return m === 0 ? couche.choix[0] : couche.choix[Math.floor(alea() * couche.choix.length)];
    return null;
  }

  // Début de mesure : on fige l'accord et les motifs, on ajoute les variations.
  function debutMesure(P, t, muet) {
    const S = P.section, m = P.mesureSec, r = P.alea;
    const B = P.barre = {};
    B.accord = lireAccord(cycle(S.accords, m));
    B.derniere = m === S.mesures - 1;
    COUCHES.forEach(k => { B[k] = motifMesure(S[k], m, r); });
    B.coupure = !B.derniere && m > 0 && S.coupures && r() < S.coupures;
    if (B.derniere && S.fill) {
      const F = BREAKS[Math.floor(r() * BREAKS.length)];
      B.caisse = (B.caisse || VIDE).slice(0, 8) + F.caisse;
      B.toms = (B.toms || VIDE).slice(0, 8) + F.toms;
    }
    if (B.caisse && S.fantomes) {
      let s2 = '';
      for (let i = 0; i < 16; i++) s2 += (B.caisse[i] === '.' && i % 4 !== 0 && r() < S.fantomes) ? 'g' : B.caisse[i];
      B.caisse = s2;
    }
    if (B.charley && !B.derniere && r() < 0.15 && B.charley[14] !== '.') B.charley = B.charley.slice(0, 14) + 'o' + B.charley[15];
    if (muet) { P.accordPrec = B.accord.nom; return; }
    if (m === 0) {
      if (S.impact) sImpact(P, t, 1);
      else if (S.crash) sCrash(P, t, 0.55);
      if (S.fondu && !P.sortant) {
        fixerA(P.fondu.gain, 1, t); rampeA(P.fondu.gain, 0, t + S.mesures * P.mesureDuree);
        fixerA(P.fonduRev.gain, 1, t); rampeA(P.fonduRev.gain, 0, t + S.mesures * P.mesureDuree + 1);
      }
    }
    if ((S.nappe || S.choeur) && (m === 0 || B.accord.nom !== P.accordPrec)) {
      let n = 1;
      while (m + n < S.mesures && cycle(S.accords, m + n) === B.accord.nom) n++;
      if (S.nappe) sNappe(P, t, B.accord, n * P.mesureDuree, S.nappe);
      if (S.choeur) sChoeur(P, t, B.accord, n * P.mesureDuree, S.choeur);
    }
    P.accordPrec = B.accord.nom;
    if (B.derniere && S.montee) sMontee(P, t, P.mesureDuree, 0.35);
  }

  function niveau(S, k) { return (S.niveaux && S.niveaux[k] != null) ? S.niveaux[k] : 1; }

  // Un pas de double-croche.
  function jouerPas(P, t, s) {
    const B = P.barre, S = P.section, r = P.alea, m = P.mesureSec;
    const coupe = B.coupure && s >= 12;
    const hum = v => v * (0.9 + 0.2 * r());
    const dt = () => (r() - 0.5) * 0.004;
    let ch;
    if (!coupe) {
      if (B.kick && FORCE[ch = B.kick[s]]) sKick(P, t, hum(FORCE[ch]) * niveau(S, 'kick'));
      if (B.caisse && FORCE[ch = B.caisse[s]]) {
        const v = hum(FORCE[ch]) * niveau(S, 'caisse');
        if (ch === 'r') { sCaisse(P, t, v); sCaisse(P, t + P.pas / 2, v * 0.85); } else sCaisse(P, t + dt(), v);
      }
      if (B.charley && FORCE[ch = B.charley[s]]) sCharley(P, t + dt(), hum(FORCE[ch]) * niveau(S, 'charley'), ch === 'o');
      if (B.toms && (ch = B.toms[s]) && TOMS[ch.toLowerCase()]) {
        sTom(P, t + dt(), TOMS[ch.toLowerCase()], hum(ch === ch.toUpperCase() ? 1 : 0.7) * niveau(S, 'toms'));
      }
      if (B.metal && FORCE[ch = B.metal[s]]) sMetal(P, t, hum(FORCE[ch]) * niveau(S, 'metal'));
      if (B.plaque && FORCE[ch = B.plaque[s]]) sPlaque(P, t, hum(FORCE[ch]) * niveau(S, 'plaque'));
      if (B.martiale && FORCE[ch = B.martiale[s]]) {
        const cresc = S.crescendo ? 0.35 + 0.65 * ((m * 16 + s) / (S.mesures * 16)) : 1;
        const v = hum(FORCE[ch]) * niveau(S, 'martiale') * cresc;
        if (ch === 'r') { sMartiale(P, t, v); sMartiale(P, t + P.pas / 2, v * 0.85); }
        else if (ch === 'f') { sMartiale(P, t - 0.012, v * 0.4); sMartiale(P, t, v); }
        else sMartiale(P, t + dt(), v);
      }
    }
    if (B.basse && (ch = B.basse[s]) && DECALAGE[ch.toLowerCase()] != null) {
      const haut = ch !== ch.toLowerCase() ? 12 : 0;
      const midi = regBasse(B.accord.basse) + DECALAGE[ch.toLowerCase()] + haut;
      sBasse(P, t, midi, tenue(B.basse, s) * P.pas, 0.8 * niveau(S, 'basse') * (0.92 + 0.08 * r()));
    }
    if (B.guitare && (ch = B.guitare[s]) && DECALAGE[ch.toLowerCase()] != null) {
      const ouvert = ch !== ch.toLowerCase();
      const midi = regGuitare(B.accord.pc) + DECALAGE[ch.toLowerCase()];
      sGuitare(P, t, midi, tenue(B.guitare, s) * P.pas, (ouvert ? 1 : 0.85) * niveau(S, 'guitare'), ouvert);
    }
    if (B.bourdon && (ch = B.bourdon[s]) && DECALAGE[ch.toLowerCase()] != null) {
      // Majuscule : avec les voix dissonantes. bourdonMesures : durée imposée.
      const duree = S.bourdonMesures ? S.bourdonMesures * P.mesureDuree : tenue(B.bourdon, s) * P.pas;
      sBourdon(P, t, regBasse(B.accord.basse) + 12 + DECALAGE[ch.toLowerCase()], duree, niveau(S, 'bourdon'), ch !== ch.toLowerCase());
    }
    if (B.coups && FORCE[ch = B.coups[s]]) sCoup(P, t, B.accord, FORCE[ch] * niveau(S, 'coups'));
    // Couches des nouvelles pistes (absentes des huit pistes d'origine : aucun
    // tirage au hasard supplémentaire pour elles, leur rendu reste identique).
    if (!coupe) {
      if (B.taiko && FORCE[ch = B.taiko[s]]) sTaiko(P, t, hum(FORCE[ch]) * niveau(S, 'taiko'));
      if (B.clap && FORCE[ch = B.clap[s]]) sClap(P, t + dt(), hum(FORCE[ch]) * niveau(S, 'clap'));
    }
    if (B.acide && (ch = B.acide[s]) && DECALAGE[ch.toLowerCase()] != null) {
      // Majuscule : accent (filtre plus ouvert, plus résonant).
      const midi = regBasse(B.accord.basse) + 12 + DECALAGE[ch.toLowerCase()];
      sAcide(P, t, midi, tenue(B.acide, s) * P.pas, 0.8 * niveau(S, 'acide'), ch !== ch.toLowerCase());
    }
    ['arp', 'cloche', 'pulse'].forEach(k => {
      const motif = B[k];
      if (!motif || !/[0-9]/.test(ch = motif[s])) return;
      const acc = B.accord, iv = acc.intervalles, idx = parseInt(ch, 10);
      const base = (k === 'arp' ? regArp : k === 'cloche' ? regCloche : regPulse)(acc.pc);
      const midi = base + iv[idx % iv.length] + 12 * Math.floor(idx / iv.length);
      (k === 'arp' ? sArp : k === 'cloche' ? sCloche : sPulse)(P, t, midi, tenue(motif, s) * P.pas, (0.75 + 0.25 * r()) * niveau(S, k));
    });
    const evts = P.melo.get(m * 16 + s);
    if (evts) {
      for (const e of evts) {
        const f = INSTRUMENTS_MELODIQUES[S.instr || 'lead'];
        const v = (s === 0 ? 0.9 : 0.8) * niveau(S, 'melodie');
        f(P, t, e.midi + (S.transp || 0), e.duree * P.pas, v);
        if (S.double) INSTRUMENTS_MELODIQUES[S.double.instr](P, t, e.midi + (S.double.transp || 0), e.duree * P.pas, v * 0.8);
      }
    }
  }

  // Programme toutes les doubles-croches qui tombent avant « horizon ».
  // Les pas déjà passés (retard du minuteur) avancent la forme sans son.
  // Plafond de polyphonie (garde-fou) : au-delà de PLAFOND_VOIX sources vivantes,
  // les pas avancent la forme sans son. Rendus mesurés (13/11/2026) : 123 sources
  // au plus, donc jamais atteint en jeu normal ; il borne seulement un emballement.
  const PLAFOND_VOIX = 400;
  function planifierJusqua(P, horizon, maintenant) {
    let garde = 0;
    while (!P.termine && P.tProchain < horizon && P.tProchain < P.arret && garde++ < 4096) {
      const t = P.tProchain, muet = t < maintenant - 0.005 || (P.c && P.c._fdsV > PLAFOND_VOIX);
      if (P.pasMesure === 0) {
        if (P.def.paliers) suivreIntensite(P, t);
        debutMesure(P, t, muet);
      }
      if (!muet) jouerPas(P, t, P.pasMesure);
      P.pasMesure++;
      P.tProchain += P.pas;
      if (P.pasMesure >= 16) {
        P.pasMesure = 0; P.mesureSec++;
        if (P.mesureSec >= P.section.mesures && !sectionSuivante(P)) {
          P.termine = true; P.tFin = P.tProchain;
          // Fin naturelle (victoire, défaite) : léger fondu pour les queues.
          [P.fondu.gain, P.fonduRev.gain].forEach(g => {
            maintenirA(g, P.tFin); rampeA(g, 0, P.tFin + 2.5);
          });
        }
      }
    }
  }

  // Fige la valeur d'un paramètre à l'instant t (sans saut), pour enchaîner
  // un nouveau fondu même si un autre est en cours.
  //
  // Piège corrigé : quand t tombe APRÈS le dernier événement programmé (fondu
  // d'entrée terminé depuis longtemps), cancelAndHoldAtTime n'insère aucun
  // point d'ancrage (c'est le comportement prévu par la norme) ; la rampe
  // suivante partait alors de l'ancien événement et la valeur sautait d'un
  // coup (mesuré : 1 → 0,32 en un échantillon), d'où un clic à chaque
  // changement de piste. Les paramètres de fondu et de volume passent donc
  // par fixerA / rampeA, qui retiennent leur dernier événement : après lui,
  // la valeur est connue et on l'ancre explicitement.
  function fixerA(param, v, t) {
    param.setValueAtTime(v, t);
    if (param._fdsFin == null || t >= param._fdsFin) { param._fdsFin = t; param._fdsVal = v; }
  }
  function rampeA(param, v, t) {
    param.linearRampToValueAtTime(v, t);
    param._fdsFin = t; param._fdsVal = v;
  }
  function maintenirA(param, t) {
    if (param._fdsFin != null && t >= param._fdsFin) {
      param.cancelScheduledValues(t); param.setValueAtTime(param._fdsVal, t);
      param._fdsFin = t;
      return;
    }
    if (param._fdsFin == null) {
      // Jamais automatisé : sa valeur fixe est exacte.
      param.cancelScheduledValues(t); param.setValueAtTime(param.value, t);
      param._fdsFin = t; param._fdsVal = param.value;
      return;
    }
    if (param.cancelAndHoldAtTime) { param.cancelAndHoldAtTime(t); return; }
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
  }

  function libererLecteur(P) {
    for (const nom in P.k) {
      const k = P.k[nom];
      k.oscs.forEach(o => { try { o.stop(); } catch (e) { /* déjà arrêté */ } });
      k.noeuds.forEach(n => { try { n.disconnect(); } catch (e) { /* rien */ } });
    }
    [P.bus, P.busRev, P.fondu, P.fonduRev].forEach(n => { try { n.disconnect(); } catch (e) { /* rien */ } });
    P.k = {};
  }

  /* ==========================================================================
     7. MOTEUR : enchaînements et intensité
     ========================================================================== */

  const JEU = ['calme', 'tension', 'combat'];
  const MONTEE = [0, 0.35, 0.65];          // seuil pour monter vers ce niveau
  const DESCENTE = [0, 0.15, 0.4];         // en dessous : on peut redescendre
  const ATTENTE_DESCENTE = [0, 20, 12];    // secondes sous le seuil avant de redescendre
  const SEJOUR_MIN = 20;                   // durée minimale d'une piste avant de redescendre
  const SEJOUR_MONTEE = 6;                 // durée minimale avant de monter (sauf urgence)

  function creerMoteur(c, volume) {
    c._fdsN = 0;
    return { c, maitre: construireMaitre(c, volume), lecteurs: [], courante: null, intens: 0, basDepuis: null, solo: null,
      choix: {}, quitte: {}, aTourner: {} };
  }

  // Rotation dans une famille.
  //  - Premier passage : une piste au hasard (en rendu de test à graine fixe :
  //    la piste d'origine, pour des rendus reproductibles).
  //  - Retour à la famille moins de RETOUR_MEME secondes après l'avoir
  //    quittée : la même piste (pas de changement à chaque aller-retour).
  //  - Sinon, ou après un cycle complet : une autre piste que la précédente.
  const RETOUR_MEME = 45;
  function choisirPiste(mt, famille, maintenant) {
    const liste = FAMILLES[famille];
    if (liste.length === 1) return liste[0];
    const fixe = mt.graineFixe != null, prec = mt.choix[famille];
    if (!prec) return fixe ? liste[0] : liste[Math.floor(Math.random() * liste.length)];
    const recent = mt.quitte[famille] == null || maintenant - mt.quitte[famille] < RETOUR_MEME;
    if (!mt.aTourner[famille] && recent) return prec;
    mt.aTourner[famille] = false;
    if (fixe) return liste[(liste.indexOf(prec) + 1) % liste.length];
    const autres = liste.filter(k => k !== prec);
    return autres[Math.floor(Math.random() * autres.length)];
  }

  // Prochain point de bascule : la prochaine barre de mesure (ou, si elle
  // est trop loin dans un tempo lent, le prochain temps).
  function prochaineBascule(P, t) {
    let tb = P.t0 + Math.ceil((t - P.t0) / P.mesureDuree - 1e-6) * P.mesureDuree;
    if (tb - t > 2.2) {
      const temps = P.pas * 4;
      tb = P.t0 + Math.ceil((t - P.t0) / temps - 1e-6) * temps;
    }
    return Math.max(tb, t);
  }

  function sortir(P, t, duree) {
    P.sortant = true;
    [P.fondu.gain, P.fonduRev.gain].forEach(g => { maintenirA(g, t); rampeA(g, 0, t + duree); });
    P.arret = t + duree + 0.05;
  }

  // nom : une famille ('calme'…) ou une piste précise ('calme2'…).
  // opts.exacte : jouer cette piste-là, sans rotation (banc d'écoute) ;
  // opts.rotation : avec exacte, laisser quand même tourner la famille ;
  // opts.t : instant de départ imposé (enchaînement de fin de cycle).
  function moteurJouer(mt, nom, maintenant, opts) {
    opts = opts || {};
    const anc = mt.courante, ancActive = anc && !anc.termine && !anc.sortant;
    if (nom == null || nom === 'silence') {
      if (ancActive) { mt.quitte[anc.def.famille] = maintenant; sortir(anc, maintenant + 0.02, 1.5); }
      mt.courante = null;
      return null;
    }
    const exacte = !!opts.exacte || !FAMILLES[nom];
    if (exacte && !PISTES[nom]) { console.warn('[Musique] piste inconnue :', nom); return null; }
    if (!exacte && ancActive && anc.def.famille === nom) return anc;
    if (exacte && ancActive && anc.def === PISTES[nom]) return anc;
    const cle = exacte ? nom : choisirPiste(mt, nom, maintenant);
    const def = PISTES[cle];
    let t, section = null, fonduEntree = def.fonduEntree != null ? def.fonduEntree : 1;
    if (ancActive) {
      t = prochaineBascule(anc, maintenant + 0.06);
      if (JEU.indexOf(anc.def.famille) >= 0 && JEU.indexOf(def.famille) >= 0) section = def.entreeJeu || null;
      if (anc.def.famille !== def.famille) mt.quitte[anc.def.famille] = t;
      sortir(anc, t, borne(anc.mesureDuree * 0.5, 0.8, 2.5));
    } else if (opts.t != null) {
      t = Math.max(opts.t, maintenant + 0.02);
    } else {
      t = maintenant + 0.08;
    }
    const graine = (def.graine + Math.floor(Math.random() * 1e6)) >>> 0;
    const P = creerLecteur(mt, def, t, { graine: mt.graineFixe != null ? mt.graineFixe + def.graine : graine, section });
    [P.fondu.gain, P.fonduRev.gain].forEach(g => {
      fixerA(g, 0, t); rampeA(g, 1, t + Math.max(0.02, fonduEntree));
    });
    P.rotation = FAMILLES[def.famille].length > 1 && (!exacte || !!opts.rotation);
    mt.choix[def.famille] = cle;
    mt.quitte[def.famille] = null;
    mt.lecteurs.push(P);
    mt.courante = P;
    mt.basDepuis = null;
    if (mt.journal) mt.journal.push({ demande: maintenant, bascule: t, nom: cle, section: P.nomSection });
    return P;
  }

  // Choix automatique calme / tension / combat, avec hystérésis :
  // on monte vite (danger), on redescend lentement (après un temps calme).
  function evaluerIntensite(mt, maintenant) {
    const P = mt.courante;
    if (!P || P.termine || P.sortant) return;
    const i = JEU.indexOf(P.def.famille);
    if (i < 0) return;
    const x = mt.intens, sejour = maintenant - P.tDebut;
    let cible = i;
    if (i < 2 && x >= MONTEE[i + 1]) {
      cible = x >= MONTEE[2] ? 2 : 1;
      if (sejour < SEJOUR_MONTEE && !(cible === 2 && x >= 0.85)) cible = i;
    }
    if (cible === i && i > 0) {
      if (x < DESCENTE[i]) {
        if (mt.basDepuis == null) mt.basDepuis = maintenant;
        if (maintenant - mt.basDepuis >= ATTENTE_DESCENTE[i] && sejour >= SEJOUR_MIN) cible = i - 1;
      } else mt.basDepuis = null;
    }
    if (cible !== i) moteurJouer(mt, JEU[cible], maintenant);
  }

  function moteurAvancer(mt, horizon, maintenant) {
    evaluerIntensite(mt, maintenant);
    for (const P of mt.lecteurs) planifierJusqua(P, horizon, maintenant);
    // Fin de cycle d'une piste en rotation : la suivante de la famille part
    // sur la barre de mesure où la précédente s'achève (celle-ci éteint ses
    // queues en 2,5 s, la nouvelle entre avec son propre fondu).
    const Pc = mt.courante;
    if (Pc && Pc.termine && Pc.finCycle && !Pc.relaye) {
      Pc.relaye = true;
      mt.aTourner[Pc.def.famille] = true;
      const nouveau = moteurJouer(mt, Pc.def.famille, maintenant, { t: Pc.tFin });
      if (nouveau) planifierJusqua(nouveau, horizon, maintenant);
    }
    // Libération des pistes éteintes (queues de réverbération comprises).
    mt.lecteurs = mt.lecteurs.filter(P => {
      const finie = (P.sortant && maintenant > P.arret + 4) || (P.termine && maintenant > P.tFin + 6);
      if (finie) { libererLecteur(P); if (mt.courante === P) mt.courante = null; }
      return !finie;
    });
  }

  /* ==========================================================================
     8. RENDU HORS LIGNE ET EXPORT WAV
     ========================================================================== */

  // options : { scenario: [{ t, nom } | { t, intensite }], solo: 'guitareG', graine, volume }
  function rendre(nom, secondes, options) {
    options = options || {};
    secondes = secondes || 60;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error('OfflineAudioContext indisponible'));
    const sr = 44100, c = new OAC(2, Math.ceil(sr * secondes), sr);
    const mt = creerMoteur(c, options.volume != null ? options.volume : 1);
    mt.solo = options.solo || null;
    mt.graineFixe = options.graine != null ? options.graine : 0;
    // Un nom de famille suit la rotation ; un nom de piste précis ('combat2')
    // joue cette piste seule, sauf { rotation: true } (dans l'événement ou
    // dans les options).
    const scenario = (options.scenario || [{ t: 0, nom, rotation: options.rotation }]).map(e => Object.assign({ fait: false }, e));
    const PAS = 0.5;
    const debutCalcul = performance.now();
    mt.suivi = [];
    function traiter(t) {
      for (const e of scenario) {
        if (e.fait || e.t > t + 1e-6) continue;
        e.fait = true;
        if (e.intensite != null) mt.intens = e.intensite;
        if (e.nom !== undefined) moteurJouer(mt, e.nom, t, (e.nom && !FAMILLES[e.nom]) ? { exacte: true, rotation: !!e.rotation } : null);
      }
      moteurAvancer(mt, t + PAS + 0.25, t);
      // Suivi : sources vivantes, nœuds créés, piste en cours.
      mt.suivi.push({ t, vivants: c._fdsV || 0, crees: c._fdsN, piste: mt.courante ? mt.courante.def.nom : null });
    }
    mt.journal = [];
    traiter(0);
    for (let k = 1; k * PAS < secondes; k++) {
      const tk = k * PAS;
      c.suspend(tk).then(() => { traiter(tk); c.resume(); });
    }
    return c.startRendering().then(buffer => ({
      buffer, noeuds: c._fdsN, journal: mt.journal, suivi: mt.suivi, dureeCalcul: (performance.now() - debutCalcul) / 1000
    }));
  }

  function encoderWav(buffer) {
    const nc = buffer.numberOfChannels, n = buffer.length, sr = buffer.sampleRate;
    const octets = 44 + n * nc * 2, ab = new ArrayBuffer(octets), dv = new DataView(ab);
    const ecrire = (p, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
    ecrire(0, 'RIFF'); dv.setUint32(4, octets - 8, true); ecrire(8, 'WAVE');
    ecrire(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true);
    ecrire(36, 'data'); dv.setUint32(40, n * nc * 2, true);
    const canaux = [];
    for (let ch = 0; ch < nc; ch++) canaux.push(buffer.getChannelData(ch));
    let p = 44;
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < nc; ch++) {
        const x = borne(canaux[ch][i] || 0, -1, 1);
        dv.setInt16(p, x < 0 ? x * 0x8000 : x * 0x7FFF, true); p += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function exporterWav(nom, secondes) {
    if (!PISTES[nom]) return Promise.reject(new Error('piste inconnue : ' + nom));
    return rendre(nom, secondes || 90, { volume: 1 }).then(res => {
      const url = URL.createObjectURL(encoderWav(res.buffer));
      const a = document.createElement('a');
      a.href = url; a.download = 'front-de-sel-' + nom + '.wav';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return res;
    });
  }

  /* ==========================================================================
     9. INTERFACE PUBLIQUE
     ========================================================================== */

  // Cadence de l'ordonnanceur (13/11/2026, allègement du fil principal) :
  // minuterie de 50 ms (au lieu de 25) et anticipation d'au moins 0,2 s (au
  // lieu de 0,12) : deux fois moins d'appels, et une marge plus grande contre
  // les images longues. Les notes restent posées sur l'horloge audio : le
  // signal ne change pas (rendus hors ligne comparés avant / après).
  const etat = { mt: null, vol: 0.7, coupe: false, voulue: null, exacte: false, intens: 0, minuterie: null, dernierTic: 0,
    intervalle: 50, anticipMin: 0.2, anticipation: 0.2, horizon: 0,
    mesure: { tics: 0, ms: 0, msMax: 0 } };

  function tic() {
    const mt = etat.mt;
    if (!mt || mt.c.state !== 'running') return;
    const debut = performance.now();
    const maintenant = mt.c.currentTime, horloge = debut;
    // Onglet en arrière-plan (ou image très longue) : le minuteur est ralenti, on anticipe davantage.
    let ecart = etat.intervalle / 1000;
    if (etat.dernierTic) {
      ecart = (horloge - etat.dernierTic) / 1000;
      etat.anticipation = borne(Math.max(etat.anticipation * 0.9, ecart * 1.5), etat.anticipMin, 1.5);
    }
    etat.dernierTic = horloge;
    mt.intens = etat.intens;
    // Petites tranches régulières : après un retard, on ne programme d'un coup que
    // ce qui est nécessaire (anticipation minimale) plus le temps écoulé ; le reste
    // de l'avance est rattrapé aux tics suivants plutôt qu'en un seul paquet.
    const plein = maintenant + etat.anticipation;
    const tranche = Math.max(maintenant + etat.anticipMin + 0.05, etat.horizon + ecart + 0.1);
    const horizon = Math.min(plein, tranche);
    etat.horizon = Math.max(etat.horizon, horizon);
    moteurAvancer(mt, horizon, maintenant);
    const duree = performance.now() - debut, M = etat.mesure;
    M.tics++; M.ms += duree; if (duree > M.msMax) M.msMax = duree;
  }
  function demarrerMinuterie() {
    if (etat.minuterie) return;
    etat.dernierTic = 0;
    etat.minuterie = setInterval(tic, etat.intervalle);
  }
  function arreterMinuterie() {
    if (etat.minuterie) { clearInterval(etat.minuterie); etat.minuterie = null; }
  }

  const Musique = {
    // Les ambiances que le jeu demande (inchangé : les huit noms d'origine).
    pistes: Object.keys(FAMILLES),
    // Titres de toutes les pistes, nouvelles comprises (clé = nom de piste).
    titres: Object.keys(PISTES).reduce((o, k) => { o[k] = PISTES[k].titre; return o; }, {}),
    // Toutes les pistes, et les pistes de chaque famille (piste d'origine en tête).
    toutesPistes: Object.keys(PISTES),
    familles: Object.keys(FAMILLES).reduce((o, f) => { o[f] = FAMILLES[f].slice(); return o; }, {}),
    pistesFamille(f) { return FAMILLES[f] ? FAMILLES[f].slice() : []; },
    familleDe(cle) { return PISTES[cle] ? PISTES[cle].famille : null; },

    // Banc d'écoute : joue exactement cette piste, sans rotation.
    jouerPiste(cle) {
      if (!PISTES[cle]) { console.warn('[Musique] piste inconnue :', cle); return; }
      etat.voulue = cle; etat.exacte = true;
      if (!etat.mt) return;
      moteurJouer(etat.mt, cle, etat.mt.c.currentTime, { exacte: true });
      tic();
    },
    // Nom précis de la piste en cours ('combat2'…), ou null.
    courantePiste() {
      const P = etat.mt && etat.mt.courante;
      return P && !P.termine ? P.def.nom : null;
    },

    init() {
      if (etat.mt) {
        if (!etat.coupe && etat.mt.c.state === 'suspended') etat.mt.c.resume();
        if (!etat.coupe) demarrerMinuterie();
        return true;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      let c;
      try { c = new AC({ latencyHint: 'playback' }); } catch (e) {
        try { c = new AC(); } catch (e2) { return false; }
      }
      etat.mt = creerMoteur(c, etat.vol);
      etat.mt.maitre.muet.gain.value = etat.coupe ? 0 : 1;
      if (etat.coupe) c.suspend(); else if (c.state === 'suspended') c.resume();
      // Musique coupée : aucune minuterie (rien à calculer) ; relancée par couper(false).
      if (!etat.coupe) demarrerMinuterie();
      if (etat.voulue) moteurJouer(etat.mt, etat.voulue, c.currentTime, { exacte: etat.exacte });
      return true;
    },

    jouer(nom) {
      if (nom != null && nom !== 'silence' && !PISTES[nom] && !FAMILLES[nom]) { console.warn('[Musique] piste inconnue :', nom); return; }
      etat.voulue = nom == null ? null : nom;
      etat.exacte = false;
      if (!etat.mt) return;
      moteurJouer(etat.mt, etat.voulue, etat.mt.c.currentTime);
      tic();
    },

    arreter() { Musique.jouer(null); },

    intensite(x) { etat.intens = borne(+x || 0, 0, 1); },

    volume(v) {
      etat.vol = borne(+v || 0, 0, 1);
      if (!etat.mt) return;
      const g = etat.mt.maitre.vol.gain, t = etat.mt.c.currentTime;
      maintenirA(g, t); rampeA(g, etat.vol, t + 0.1);
    },

    couper(b) {
      etat.coupe = !!b;
      if (!etat.mt) return;
      const c = etat.mt.c, g = etat.mt.maitre.muet.gain;
      if (etat.coupe) {
        maintenirA(g, c.currentTime); rampeA(g, 0, c.currentTime + 0.3);
        setTimeout(() => {
          if (!etat.coupe) return;
          if (c.state === 'running') c.suspend();
          arreterMinuterie();
        }, 400);
      } else {
        demarrerMinuterie();
        c.resume().then(() => {
          maintenirA(g, c.currentTime); rampeA(g, 1, c.currentTime + 0.3);
          tic();
        });
      }
    },

    estCoupee() { return etat.coupe; },

    courante() {
      const P = etat.mt && etat.mt.courante;
      // Nom de l'ambiance (famille), comme avant : 'combat' même si c'est 'combat2' qui joue.
      return P && !P.termine ? P.def.famille : (etat.mt ? null : (etat.voulue && PISTES[etat.voulue] ? PISTES[etat.voulue].famille : etat.voulue));
    },

    // Diagnostic (page de test) : nœuds créés, pistes actives, anticipation.
    stats() {
      if (!etat.mt) return { init: false };
      return { init: true, etat: etat.mt.c.state, noeudsCrees: etat.mt.c._fdsN, lecteurs: etat.mt.lecteurs.length,
        courante: Musique.courante(), piste: Musique.courantePiste(), vivants: etat.mt.c._fdsV || 0, anticipation: etat.anticipation, intensite: etat.intens,
        minuterie: !!etat.minuterie, intervalle: etat.intervalle, tics: etat.mesure.tics, ticMs: +etat.mesure.ms.toFixed(3), ticMsMax: +etat.mesure.msMax.toFixed(3) };
    },
    // Banc d'essai : remise à zéro des compteurs, et réglage de la cadence
    // ({ intervalle: ms, anticipation: s }) pour comparer deux réglages dans la même page.
    _mesure(regl) {
      etat.mesure = { tics: 0, ms: 0, msMax: 0 };
      if (regl) {
        if (regl.anticipation != null) etat.anticipMin = borne(+regl.anticipation, 0.05, 1.5);
        if (regl.intervalle != null) {
          etat.intervalle = borne(+regl.intervalle | 0, 10, 200);
          if (etat.minuterie) { arreterMinuterie(); demarrerMinuterie(); }
        }
      }
    },

    rendre,
    // Accès de diagnostic (banc d'essai uniquement) : réglages des canaux.
    _interne: { CANAUX, PISTES },
    exporterWav
  };

  window.Musique = Musique;
})();
