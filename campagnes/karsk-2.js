/* =====================================================================
   FRONT DE SEL — Campagne Karsk « La marche du Nord »
   Mission 2 : « Sorbe »
   ---------------------------------------------------------------------
   Défense. Karsk occupe le village de Sorbe. Halden contre-attaque par
   vagues, drones en tête, et veut détruire l'entrepôt de la Régie qui
   ravitaille désormais Karsk. Le joueur doit tenir 9 minutes sans
   perdre l'entrepôt (l'eau et les vivres des habitants).
   La Sentinelle (antiaérien) est débloquée en cours de mission.
   Données pures. J = Karsk (joueur), I = Halden, N = Régie des eaux.
   ===================================================================== */

enregistrerMission({
  id: 'karsk-2', campagne: 'karsk', numero: 2,
  titre: 'Sorbe',
  lieu: 'Sorbe, plaine de l’Arnelle',
  date: '17 mai 2034',

  // ------------------------------------------------------------------
  //  CARTE : plaine d'oliviers en plein midi. Le village de Sorbe au
  //  centre, la base Karsk au nord, une rivière à l'est franchie par
  //  deux ponts, la colline de Mourre au sud-ouest (antenne Halden).
  // ------------------------------------------------------------------
  carte: {
    id: 'sorbe', nom: 'Sorbe',
    graine: 5512,
    ambiance: 'midi',
    cote: null,
    rivieres: [
      { points: [[2560, 0], [2480, 400], [2540, 800], [2420, 1200], [2460, 1600], [2380, 2000], [2420, 2240]], largeur: 90 },
    ],
    ponts: [
      { x: 2450, y: 1100, angle: 0, longueur: 160, largeur: 50 },
      { x: 2400, y: 1900, angle: 0, longueur: 160, largeur: 50 },
    ],
    cretes: [
      // Collines du nord
      [200, 300, 700, 200, 8],
      [2000, 150, 2300, 380, 6],
      // Colline de Mourre (sud-ouest) : ouverte vers l'ouest et le sud
      [350, 1540, 780, 1520, 7],
      [850, 1580, 870, 1900, 5],
      // Buttes qui découpent les approches sud
      [1100, 1560, 1280, 1720, 4],
      [1940, 1720, 2160, 1600, 4],
    ],
    rochers: 26,
    bosquets: [
      // Oliveraies
      { x: 2150, y: 1260, r: 90 }, { x: 1000, y: 1150, r: 70 }, { x: 2820, y: 1500, r: 130 },
      { x: 2900, y: 350, r: 110 }, { x: 420, y: 900, r: 110 }, { x: 1300, y: 2050, r: 100 },
      { x: 1950, y: 2060, r: 110 },
    ],
    routes: [
      // Grand-rue nord-sud : traverse Sorbe par la ruelle centrale
      [[1600, 0], [1580, 400], [1620, 700], [1625, 1000], [1600, 1350], [1650, 1700], [1600, 2240]],
      // Route de l'est, par le pont du Lauzon
      [[1625, 1000], [2000, 1050], [2450, 1100], [3200, 1150]],
      // Route du sud-ouest
      [[1600, 1350], [1000, 1600], [600, 2000], [200, 2240]],
      // Route du sud-est, par le pont de la Gravière
      [[1650, 1700], [2400, 1900], [3200, 2050]],
    ],
    noeuds: [
      [1150, 560, 3000], [2000, 560, 3000], [1580, 300, 4000],
      [950, 950, 2500], [2150, 880, 2500], [1600, 1650, 3000],
      [300, 1250, 2000], [2900, 700, 2500],
    ],
    structures: [
      { type: 'village', x: 1340, y: 900, l: 220, h: 170, nom: 'Sorbe — quartier haut' },
      { type: 'village', x: 1690, y: 920, l: 210, h: 160, nom: 'Sorbe — quartier de l’église' },
      { type: 'ferme', x: 1050, y: 1350, l: 170, h: 110, nom: 'Mas Aramont' },
      { type: 'ruines', x: 2050, y: 1480, l: 140, h: 90, nom: 'Ancienne coopérative' },
    ],
    bases: { J: { c: 38, r: 14 }, I: { c: 14, r: 42 } },
  },

  joueur: 'karsk', adversaire: 'halden',

  briefing: {
    intervenant: 'Lieutenante Mira Szell, génie de la 3e brigade',
    texte: [
      'Depuis Brèche, la brigade est descendue jusqu’à Sorbe sans tirer un coup de feu. Le village nous a regardés passer derrière ses volets. Le colonel a installé le quartier général au nord, sur la route.',
      'Au bas de la grand-rue se trouve l’entrepôt de la Régie des eaux de Varenne : citernes, vivres, pièces de pompes. Le colonel a décidé d’en prélever une part pour la troupe. Madame Aramont, la maire, a décidé de compter chaque bidon.',
      'Nos écoutes sont formelles : Halden prépare une contre-attaque, drones en tête. Pour eux, cet entrepôt est désormais du ravitaillement ennemi. Ils comptent le détruire. Les habitants, eux, n’ont rien d’autre.',
      'Tenez Sorbe jusqu’à l’arrivée de la deuxième colonne, dans neuf minutes. Les conscrits et les bunkers tirent sur les drones. Le génie finit de monter les premières Sentinelles antiaériennes : je vous les envoie dès que possible.',
    ],
  },

  fin: {
    victoire: 'La deuxième colonne entre dans Sorbe sous les applaudissements de personne. L’entrepôt est debout, criblé d’éclats. Madame Aramont a fait dresser l’inventaire et l’a remis en main propre au colonel Brannik : il manque un tiers des stocks. « Un quart, avait dit le colonel. » « Un tiers, a-t-elle répondu. Je sais compter. » Plus au sud, la Régie prépare déjà trois convois pour Vallauris.',
    defaite: 'Sorbe est perdue. L’entrepôt de la Régie brûle, et avec lui l’eau d’un village entier. Madame Aramont ne dira pas qui a tiré le premier. Elle dira seulement qu’on s’est battu chez elle.',
  },

  reserves: { J: 1500, I: 0 },
  popMax: 50,
  pouvoirs: { J: true, I: false },   // Halden : seulement la frappe scénarisée de la vague 4
  autorises: { batiments: ['caserne', 'depot', 'usine', 'bunker'], unites: ['sapeur', 'conscrit', 'ours'] },
  relations: { I_attaque_N: true },
  ia: { construit: false, revenu: 1, vagues: null, cible: { x: 1520, y: 1200 } },
  musique: 'tension',

  // ------------------------------------------------------------------
  //  DÉPART
  // ------------------------------------------------------------------
  depart: {
    J: [
      { type: 'qg', c: 38, r: 14 },
      { type: 'caserne', c: 33, r: 15 },
      { type: 'depot', c: 44, r: 15 },
      { type: 'bunker', c: 34, r: 29 },
      { type: 'bunker', c: 43, r: 28 },
      // La garde est postée devant l'entrepôt, au bas de la grand-rue.
      { type: 'conscrit', x: 1540, y: 1340, nb: 8, nom: 'garde' },
      { type: 'ours', x: 1720, y: 1320, nb: 2 },
      { type: 'sapeur', x: 1260, y: 480, nb: 4, nom: 'sapeurs' },
    ],
    I: [
      // Antenne de guidage des drones, sur la colline de Mourre
      { type: 'relais', c: 14, r: 42, nom: 'mourre' },
      { type: 'tourelle', c: 12, r: 40, nom: 'mourre_def' },
      { type: 'tourelle', c: 18, r: 44, nom: 'mourre_def' },
      { type: 'operateur', x: 600, y: 1880, nb: 3, nom: 'mourre_garde' },
    ],
    N: [
      { type: 'entrepot', c: 37, r: 29, nom: 'entrepot' },
      { type: 'convoi', x: 1625, y: 990, nom: 'regie' },   // garé dans la ruelle centrale
    ],
  },

  // ------------------------------------------------------------------
  //  OBJECTIFS
  // ------------------------------------------------------------------
  objectifs: [
    { id: 'tenir', type: 'survivre', duree: 540,
      texte: 'Tenir Sorbe jusqu’à l’arrivée de la deuxième colonne (9 minutes)' },
    { id: 'entrepot', type: 'proteger', nom: 'entrepot',
      texte: 'L’entrepôt de la Régie ne doit pas être détruit : c’est l’eau des habitants' },
    { id: 'mourre', type: 'detruire', nom: 'mourre', principal: false,
      texte: 'Détruire l’antenne Halden de la colline de Mourre, qui guide leurs drones' },
    { id: 'camion', type: 'proteger', nom: 'regie', principal: false,
      texte: 'Préserver le camion-citerne de la Régie garé dans la grand-rue' },
  ],

  // ------------------------------------------------------------------
  //  DÉCLENCHEURS
  //  Vagues Halden scénarisées (renforts) : 1 min 10, 2 min 40, 4 min 20,
  //  6 min, 7 min 30. Sentinelle débloquée à 3 min 10.
  // ------------------------------------------------------------------
  declencheurs: [
    { id: 'intro', quand: { temps: 1 }, faire: [
      { camera: { x: 1600, y: 1000 } },
      { zone: { id: 'z_entrepot', x: 1520, y: 1200, r: 150, texte: 'Entrepôt de la Régie', couleur: '#e8eef2' } },
      { radio: { qui: 'Col. Brannik', texte: 'Sorbe est à nous, pour l’instant. Halden va revenir, et plus vite qu’on ne le voudrait.' } },
      { radio: { qui: 'Lucie Aramont, maire de Sorbe', texte: 'Colonel, cet entrepôt nourrit huit cents personnes. Vos soldats y ont pris quarante bidons ce matin. J’ai noté les numéros.' } },
      { radio: { qui: 'Col. Brannik', texte: 'Madame la maire, mes soldats boivent aussi. Mais personne ne touchera à votre entrepôt. Pas même Halden.' } },
    ] },
    { id: 'conseils', quand: { temps: 20 }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Conseil du génie : construisez une usine de blindés dès maintenant. Les plans de la Sentinelle arrivent dans trois minutes, il faudra une usine pour la produire.' } },
      { radio: { qui: 'Lt Szell', texte: 'Et des bunkers : sélectionnez un sapeur, bouton « Bunker ». Ses mitrailleuses tirent aussi sur les drones. Vos collecteurs récoltent seuls les champs de minerai du nord, qui sont sûrs ; gardez les sapeurs pour bâtir et réparer.' } },
    ] },

    // --- Vague 1 : sud ---
    { id: 'avant_v1', quand: { temps: 60 }, faire: [
      { radio: { qui: 'Sgt Orin', texte: 'Ça bourdonne au sud. Des drones, et des tireurs derrière.' } },
    ] },
    { id: 'v1', quand: { temps: 70 }, faire: [
      { musique: 'combat' },
      { renforts: { camp: 'I', unites: [{ type: 'operateur', nb: 4 }, { type: 'faucheur', nb: 2 }],
        depuis: { x: 1600, y: 2200 }, vers: { x: 1560, y: 1300 }, ordre: 'attaqueDeplacement', nom: 'v1' } },
      { radio: { qui: 'Oskar Lind (canal Halden intercepté)', texte: 'Objectif confirmé : entrepôt au bas de la grand-rue. Les civils ont été prévenus par haut-parleur. Enfin, ceux qui écoutent.' } },
      { radio: { qui: 'Lt Szell', texte: 'Ils visent l’entrepôt. Interposez-vous : tout ce qui tire sur un drone, sur un drone.' } },
    ] },
    { id: 'v1_fin', quand: { declencheur: 'v1', delai: 60 }, faire: [
      { musique: 'tension' },
      { radio: { qui: 'Lucie Aramont, maire de Sorbe', texte: 'Ils visaient nos réserves. Les nôtres. Je croyais que Halden était payé pour protéger l’eau de Varenne.' } },
      { radio: { qui: 'Col. Brannik', texte: 'Ils sont payés pour protéger l’eau de ceux qui paient, madame.' } },
    ] },

    // --- Vague 2 : est, par le pont du Lauzon ---
    { id: 'v2', quand: { temps: 160 }, faire: [
      { musique: 'combat' },
      { renforts: { camp: 'I', unites: [{ type: 'lynx', nb: 2 }, { type: 'operateur', nb: 3 }, { type: 'faucheur', nb: 2 }],
        depuis: { x: 3150, y: 1150 }, vers: { x: 1700, y: 1150 }, ordre: 'attaqueDeplacement', nom: 'v2' } },
      { radio: { qui: 'Sgt Orin', texte: 'Blindés à l’est ! Ils passent par le pont du Lauzon. Deux Lynx, de l’infanterie, des drones au-dessus.' } },
      { radio: { qui: 'Lt Szell', texte: 'Un pont est un goulet. Un Ours en sortie de pont, et ils passeront un par un.' } },
    ] },

    // --- La Sentinelle ---
    { id: 'sentinelle', quand: { temps: 190 }, faire: [
      { deverrouiller: { unites: ['sentinelle'] } },
      { radio: { qui: 'Lt Szell', texte: 'Les plans de la Sentinelle sont arrivés. Véhicule antiaérien : portée 320 mètres, il ne tire que sur ce qui vole, et il le fait très bien. Produisez-la à l’usine.' } },
      { radio: { qui: 'Sgt Orin', texte: 'Enfin. Je commençais à regarder le ciel plus souvent que mes hommes.' } },
      { musique: 'tension' },
    ] },
    { id: 'conseil_mourre', quand: { temps: 215 }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'J’ai trouvé ce qui guide leurs drones : une antenne relais sur la colline de Mourre, au sud-ouest. Deux tourelles la gardent. La détruire nous vaudrait la reconnaissance de l’état-major. Et des points de commandement.' } },
    ] },

    // --- Vague 3 : sud-ouest et sud ---
    { id: 'v3', quand: { temps: 260 }, faire: [
      { musique: 'combat' },
      { renforts: { camp: 'I', unites: [{ type: 'operateur', nb: 4 }, { type: 'faucheur', nb: 4 }, { type: 'lynx', nb: 1 }],
        depuis: { x: 250, y: 2150 }, vers: { x: 1500, y: 1300 }, ordre: 'attaqueDeplacement', nom: 'v3' } },
      { renforts: { camp: 'I', unites: [{ type: 'lynx', nb: 2 }],
        depuis: { x: 1600, y: 2200 }, vers: { x: 1560, y: 1300 }, ordre: 'attaqueDeplacement', nom: 'v3b' } },
      { radio: { qui: 'Sgt Orin', texte: 'Deux colonnes, sud et sud-ouest ! Ils ont compris qu’on les attendait dans la grand-rue.' } },
    ] },
    { id: 'aramont_aide', quand: { declencheur: 'v3', delai: 45 }, faire: [
      { radio: { qui: 'Lucie Aramont, maire de Sorbe', texte: 'Colonel, les pompiers du village ont un camion-citerne et des lances. Ils protègent l’entrepôt contre le feu. Pas contre les drones. Faites le reste.' } },
      { reserves: { camp: 'J', montant: 400 } },
      { radio: { qui: 'Col. Brannik', texte: 'Merci, madame. Szell, les habitants nous cèdent quatre cents unités de leurs propres réserves. Ne les gaspillez pas.' } },
    ] },

    // --- Vague 4 : est, avec frappe de précision ---
    { id: 'v4_alerte', quand: { temps: 350 }, faire: [
      { musique: 'tension' },
      { radio: { qui: 'Inès Varga (canal Halden intercepté)', texte: 'Sorbe tient plus longtemps que prévu. Frappe de précision autorisée sur leurs défenses. Évitez les maisons, la presse regarde.' } },
    ] },
    { id: 'v4', quand: { temps: 360 }, faire: [
      { musique: 'combat' },
      { pouvoir: { camp: 'I', cle: 'frappe', x: 1740, y: 1140 } },
      { renforts: { camp: 'I', unites: [{ type: 'faucheur', nb: 5 }, { type: 'bastion', nb: 1 }, { type: 'lynx', nb: 2 }],
        depuis: { x: 3150, y: 1150 }, vers: { x: 1650, y: 1200 }, ordre: 'attaqueDeplacement', nom: 'v4' } },
      { radio: { qui: 'Lt Szell', texte: 'Missile sur le bunker est ! Et un char Bastion avec eux : blindage lourd, visez-le avec les Ours.' } },
    ] },

    // --- Vague 5 : tout le monde ---
    { id: 'v5_alerte', quand: { temps: 440 }, faire: [
      { radio: { qui: 'Sgt Orin', texte: 'Tout le sud se met à bouger. C’est leur dernier coup, ils mettent tout dedans.' } },
      { radio: { qui: 'Col. Brannik', texte: 'La deuxième colonne est à vingt kilomètres. Encore une minute et demie. Tenez.' } },
    ] },
    { id: 'v5', quand: { temps: 450 }, faire: [
      { renforts: { camp: 'I', unites: [{ type: 'faucheur', nb: 6 }, { type: 'operateur', nb: 6 }, { type: 'bastion', nb: 2 }, { type: 'lynx', nb: 2 }],
        depuis: { x: 1600, y: 2200 }, vers: { x: 1560, y: 1250 }, ordre: 'attaqueDeplacement', nom: 'v5' } },
      { renforts: { camp: 'I', unites: [{ type: 'lynx', nb: 2 }, { type: 'operateur', nb: 3 }],
        depuis: { x: 3150, y: 2060 }, vers: { x: 1700, y: 1250 }, ordre: 'attaqueDeplacement', nom: 'v5b' } },
    ] },

    // --- Événements liés aux objectifs ---
    { id: 'mourre_tombe', quand: { detruit: 'mourre' }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'L’antenne de Mourre est à terre. Leurs drones vont devoir viser à l’œil nu.' } },
      { radio: { qui: 'Oskar Lind (canal Halden intercepté)', texte: 'Relais Mourre hors ligne. Ils ont une ingénieure qui lit nos fréquences. Je la déteste déjà un peu.' } },
      { reserves: { camp: 'J', montant: 800 } },
      { points: { camp: 'J', montant: 5 } },
      { radio: { qui: 'Col. Brannik', texte: 'L’état-major vous accorde des points de commandement : de quoi lancer le Marteau, notre barrage d’artillerie lourde. Pas sur le village, est-ce clair ?' } },
    ] },
    { id: 'entrepot_touche', quand: { pvSous: { nom: 'entrepot', ratio: 0.6 } }, faire: [
      { radio: { qui: 'Lucie Aramont, maire de Sorbe', texte: 'L’entrepôt brûle sur le côté ! Colonel, vous aviez promis !' } },
      { radio: { qui: 'Lt Szell', texte: 'Ramenez des unités devant l’entrepôt. Un sapeur peut aussi construire un bunker juste à côté.' } },
    ] },
    { id: 'entrepot_critique', quand: { pvSous: { nom: 'entrepot', ratio: 0.3 } }, faire: [
      { radio: { qui: 'Col. Brannik', texte: 'L’entrepôt ne tiendra plus longtemps. Tout le monde au bas de la grand-rue !' } },
    ] },
    { id: 'camion_perdu', quand: { detruit: 'regie' }, faire: [
      { radio: { qui: 'Lucie Aramont, maire de Sorbe', texte: 'Le camion de la Régie… C’était le seul qui montait encore aux fermes du plateau.' } },
    ] },
    { id: 'fin', quand: { objectif: 'tenir', etat: 'reussi' }, faire: [
      { musique: 'calme' },
      { radio: { qui: 'Col. Brannik', texte: 'La deuxième colonne est là. Sorbe tient. Bien joué, tous.' } },
      // Le moteur attend que la réplique du colonel soit lue avant le débriefing.
      { victoire: true },
    ] },
  ],
});
