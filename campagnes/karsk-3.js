/* =====================================================================
   FRONT DE SEL — Campagne Karsk « La marche du Nord »
   Mission 3 : « Coupure »
   ---------------------------------------------------------------------
   Raid au crépuscule. Trois antennes relais Halden guident les drones
   sur tout le plateau de l'Escalle. Les détruire toutes les trois, avec
   l'appui des Grêle. Une forte contre-attaque Halden arrive dès que
   deux antennes sont tombées (ou au plus tard à 9 minutes).
   Données pures. J = Karsk (joueur), I = Halden, N = Régie des eaux.
   ===================================================================== */

enregistrerMission({
  id: 'karsk-3', campagne: 'karsk', numero: 3,
  titre: 'Coupure',
  lieu: 'Plateau de l’Escalle',
  date: '29 mai 2034',

  // ------------------------------------------------------------------
  //  CARTE : plateau calcaire au crépuscule. Base Karsk au nord-ouest.
  //  Antenne de la Cabane au sud-ouest (par le Pas de l'Escalle),
  //  antenne du Centre sur une butte ceinte de rochers (deux entrées :
  //  nord-ouest et sud-est), antenne de l'Est derrière la falaise
  //  (par la brèche de Cornas). Halden arrive de l'est et du sud-est.
  // ------------------------------------------------------------------
  carte: {
    id: 'plateauEscalle', nom: 'Plateau de l’Escalle',
    graine: 9907,
    ambiance: 'crepuscule',
    cote: null,
    rivieres: [],
    ponts: [],
    cretes: [
      // Escarpement ouest, percé par le Pas de l'Escalle (x 560 → 900)
      [0, 1260, 560, 1300, 9],
      [900, 1320, 1220, 1560, 6],
      // Ceinture de la butte centrale
      [1430, 780, 1940, 800, 8],
      [2000, 860, 2000, 1240, 6],
      [1860, 1420, 1360, 1400, 8],
      [1300, 1340, 1300, 1000, 6],
      // Falaise de l'est : brèche de Cornas (y 560 → 880) et col du Midi (y 1500 → 1800)
      [2250, 0, 2280, 560, 8],
      [2290, 880, 2320, 1500, 9],
      [2330, 1800, 2360, 2240, 7],
    ],
    rochers: 30,
    bosquets: [
      { x: 1000, y: 200, r: 100 }, { x: 1900, y: 300, r: 120 }, { x: 2700, y: 1400, r: 130 },
      { x: 1200, y: 2000, r: 120 }, { x: 300, y: 1000, r: 90 }, { x: 2000, y: 1900, r: 100 },
      { x: 2950, y: 1120, r: 90 },
    ],
    routes: [
      // Route du plateau, de la base vers l'est par la brèche de Cornas
      [[440, 400], [1000, 600], [1500, 650], [2265, 720], [2700, 800], [3200, 850]],
      // Descente vers le sud par le Pas de l'Escalle
      [[700, 700], [730, 1300], [700, 1700], [600, 2240]],
      // Piste de la butte centrale (entrée nord-ouest)
      [[1500, 650], [1370, 880], [1450, 1000]],
      // Piste du sud-est, de la butte à la zone d'atterrissage Halden par le col du Midi
      [[1930, 1330], [2310, 1650], [2700, 1900], [3100, 2240]],
    ],
    noeuds: [
      [720, 200, 3000], [200, 760, 3000], [950, 420, 2500],
      [1150, 950, 2500], [1600, 1650, 3500], [2150, 500, 3000],
      [700, 1950, 2500], [2700, 1000, 3000], [2700, 1900, 2500],
    ],
    structures: [
      { type: 'ruines', x: 500, y: 1820, l: 100, h: 70, nom: 'Cabane du berger' },
      { type: 'ferme', x: 2500, y: 220, l: 180, h: 110, nom: 'Ferme du Plateau' },
      { type: 'ruines', x: 1050, y: 1700, l: 120, h: 80, nom: 'Bergerie effondrée' },
    ],
    bases: { J: { c: 8, r: 8 }, I: { c: 40, r: 26 } },
  },

  joueur: 'karsk', adversaire: 'halden',

  briefing: {
    intervenant: 'Lieutenante Mira Szell, génie de la 3e brigade',
    texte: [
      'Vallauris a été un échec. Nos embuscades ont arrêté un convoi sur trois ; les deux autres sont passés, escortés par Halden. Le colonel ne dort plus beaucoup.',
      'J’ai passé la semaine à écouter leurs drones. Ils ne voient rien par eux-mêmes : tout passe par trois antennes relais plantées sur le plateau de l’Escalle. Coupez les trois, et leurs Faucheurs volent à l’aveugle sur toute la vallée de la Sarne.',
      'La première est près de la cabane du berger, au sud-ouest. La deuxième sur la butte centrale, derrière une ceinture de rochers et des tourelles. La troisième à l’est, derrière la falaise.',
      'Vos Grêle portent à 440 mètres : c’est plus loin que leurs tourelles, et que leurs tireurs. Gardez-les derrière, protégez-les des drones avec les Sentinelles. Et attendez-vous à une riposte : Halden ne laissera pas couper son réseau sans répondre.',
    ],
  },

  fin: {
    victoire: 'Les trois antennes de l’Escalle sont à terre. Pendant quarante heures, les drones Halden ne voient plus rien au nord de la Sarne. Le colonel Brannik a écouté le silence radio du plateau comme on écoute la pluie. Il a dit : « Maintenant, les ponts. » Szell a déjà sorti ses cartes.',
    defaite: 'L’opération a échoué. Les antennes de l’Escalle tournent toujours, et chaque mouvement de la brigade s’affiche quelque part sur un écran Halden. Le colonel Brannik a fait rappeler la lieutenante Szell au quartier général. Il ne lui a fait aucun reproche. Elle se les est faits toute seule.',
  },

  reserves: { J: 1800, I: 0 },
  popMax: 60,
  // Halden n'utilise que la frappe scénarisée de la contre-attaque : avec ses pouvoirs libres,
  // l'IA cumulait les points des pertes Karsk et lâchait l'Essaim sur les sapeurs vers 2 min.
  pouvoirs: { J: true, I: false },
  ia: { construit: false, revenu: 1, vagues: null, cible: { x: 380, y: 380 } },
  musique: 'tension',

  // ------------------------------------------------------------------
  //  DÉPART
  // ------------------------------------------------------------------
  depart: {
    J: [
      { type: 'qg', c: 8, r: 8 },
      { type: 'caserne', c: 14, r: 7 },
      { type: 'usine', c: 13, r: 11 },
      { type: 'depot', c: 7, r: 13 },
      { type: 'conscrit', x: 700, y: 720, nb: 8 },
      { type: 'ours', x: 860, y: 560, nb: 2 },
      { type: 'grele', x: 480, y: 760, nb: 3, nom: 'greles' },
      { type: 'sentinelle', x: 850, y: 760, nb: 2 },
      { type: 'sapeur', x: 220, y: 480, nb: 4 },
    ],
    I: [
      // Antenne de la Cabane (sud-ouest)
      { type: 'relais', c: 9, r: 43, nom: 'antenne_cabane' },
      { type: 'tourelle', c: 7, r: 40 },
      { type: 'tourelle', c: 13, r: 41 },
      // Garnisons renforcées (passe 4 du moteur, défense proportionnée) : avec les effectifs
      // d'origine, l'armée de départ abattait les trois antennes en 80 s, sans production.
      // Les drones de garde obligent à escorter les Grêle avec les Sentinelles (briefing).
      { type: 'operateur', x: 400, y: 1660, nb: 6 },
      { type: 'lynx', x: 640, y: 1740, nb: 3 },
      { type: 'faucheur', x: 520, y: 1700, nb: 2 },
      // Antenne du Centre (butte)
      // Antenne descendue de deux cases (r 26 → 28), passe 4 du moteur : à r 26, les Grêle
      // l'abattaient depuis la route du plateau (417 m, sous leur portée de 440 m) sans jamais
      // entrer dans la ceinture de rochers ; le « Centre forteresse » tombait au passage.
      { type: 'relais', c: 40, r: 28, nom: 'antenne_centre' },
      { type: 'tourelle', c: 37, r: 24 },
      { type: 'tourelle', c: 44, r: 24 },
      { type: 'tourelle', c: 41, r: 31 },
      // Essai de novembre 2026 (défense proportionnée, fin de mission différée) : un robot qui
      // abat les tourelles avant chaque antenne gagnait en 3 min à 3 min 50 (Cabane vers 50 s,
      // Centre 30 à 60 s plus tard, ses Grêle hachant la garnison regroupée). Garnison du Centre
      // renforcée de deux Bastion et trois tireurs, celle de l'Est d'un Bastion et trois tireurs, la Cabane d'un
      // Lynx. (Avec deux Bastion et trois tireurs de plus à l'Est, la dernière antenne résistait
      // jusqu'à 20 min.)
      // (Essai écarté : étiqueter la garnison du Centre ; immobile et groupée, elle fondait encore
      // plus vite sous les salves des Grêle.)
      { type: 'operateur', x: 1540, y: 1060, nb: 6 },
      { type: 'operateur', x: 1720, y: 1060, nb: 3 },
      { type: 'bastion', x: 1760, y: 1200, nb: 3 },
      { type: 'bastion', x: 1520, y: 1220, nb: 2 },
      { type: 'faucheur', x: 1650, y: 1150, nb: 3 },
      // Antenne de l'Est (derrière la falaise)
      { type: 'relais', c: 70, r: 9, nom: 'antenne_est' },
      { type: 'tourelle', c: 67, r: 13 },
      { type: 'tourelle', c: 73, r: 13 },
      { type: 'operateur', x: 2820, y: 620, nb: 5 },
      { type: 'lynx', x: 2980, y: 660, nb: 3 },
      { type: 'operateur', x: 2700, y: 560, nb: 3 },
      { type: 'bastion', x: 2760, y: 700, nb: 1 },
      { type: 'faucheur', x: 2900, y: 560, nb: 2 },
    ],
    N: [],
  },

  // ------------------------------------------------------------------
  //  OBJECTIFS
  // ------------------------------------------------------------------
  objectifs: [
    { id: 'cabane', type: 'detruire', nom: 'antenne_cabane',
      texte: 'Détruire l’antenne relais de la Cabane (sud-ouest)' },
    { id: 'centre', type: 'detruire', nom: 'antenne_centre',
      texte: 'Détruire l’antenne relais de la butte centrale' },
    { id: 'est', type: 'detruire', nom: 'antenne_est',
      texte: 'Détruire l’antenne relais de l’Est, derrière la falaise' },
    { id: 'greles', type: 'proteger', nom: 'greles', minimum: 1, principal: false,
      texte: 'Garder au moins une des trois Grêle d’origine' },
    { id: 'combe', type: 'tenir', zone: { x: 1600, y: 1650, r: 160 }, duree: 60, principal: false,
      texte: 'Tenir la Combe des Puits pendant une minute (ravitaillement)' },
    // Révélé à l'arrivée de la contre-attaque.
    { id: 'contre', type: 'detruire', nom: 'contre', principal: false, cache: true,
      texte: 'Briser la colonne blindée de Cap Ferrand' },
  ],

  // ------------------------------------------------------------------
  //  DÉCLENCHEURS
  // ------------------------------------------------------------------
  declencheurs: [
    { id: 'intro', quand: { temps: 1 }, faire: [
      { camera: { x: 700, y: 650 } },
      { zone: { id: 'z_combe', x: 1600, y: 1650, r: 160, texte: 'Combe des Puits' } },
      { radio: { qui: 'Col. Brannik', texte: 'Le soleil se couche sur l’Escalle. Leurs caméras thermiques vont adorer. Faites vite et faites propre.' } },
      { radio: { qui: 'Lt Szell', texte: 'Trois antennes, trois objectifs. L’ordre vous appartient. Ma préférence : la Cabane d’abord, la plus isolée. Le Centre est une forteresse.' } },
      { radio: { qui: 'Sgt Orin', texte: 'Les Grêle sont chargées, les gars aussi. Enfin, chargés de munitions. Pour le reste, on verra après.' } },
    ] },
    { id: 'rappel_greles', quand: { temps: 40 }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Rappel : une Grêle ne tire pas à moins de 130 mètres. Placez l’infanterie devant, les Grêle derrière, les Sentinelles à côté des Grêle.' } },
    ] },
    { id: 'combe_info', quand: { temps: 90 }, faire: [
      { radio: { qui: 'Sgt Orin', texte: 'Il y a des puits dans la combe au sud de la butte. Si on la tient une minute, le génie y pose une pompe et la brigade nous envoie de quoi faire.' } },
    ] },

    // --- Harcèlement Halden ---
    // Premier harcèlement : à 3 min 20, ou 15 s après la chute de la première antenne.
    { id: 'harcelement_1', quand: { un: [ { temps: 200 }, { declencheur: 'cabane_tombe', delai: 15 },
        { declencheur: 'centre_tombe', delai: 15 }, { declencheur: 'est_tombe', delai: 15 } ] }, faire: [
      { renforts: { camp: 'I', unites: [{ type: 'faucheur', nb: 3 }],
        depuis: { x: 3180, y: 1200 }, vers: { x: 600, y: 600 }, ordre: 'attaqueDeplacement', nom: 'harcelement' } },
      { radio: { qui: 'Lt Szell', texte: 'Trois drones viennent de l’est, droit sur la base. Les Sentinelles, vite.' } },
    ] },
    { id: 'harcelement_2', quand: { temps: 380 }, faire: [
      { renforts: { camp: 'I', unites: [{ type: 'lynx', nb: 2 }, { type: 'operateur', nb: 3 }],
        depuis: { x: 3000, y: 2200 }, vers: { x: 700, y: 700 }, ordre: 'attaqueDeplacement', nom: 'harcelement_sol' } },
      { radio: { qui: 'Sgt Orin', texte: 'Patrouille motorisée au sud-est. Elle monte vers la base par le col du Midi.' } },
    ] },

    // --- Chaque antenne ---
    { id: 'cabane_tombe', quand: { detruit: 'antenne_cabane' }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Antenne de la Cabane : détruite. Un tiers du réseau en moins.' } },
      { radio: { qui: 'Oskar Lind (canal Halden intercepté)', texte: 'Perte du relais Cabane. Je répète : ils ne visent que les relais. Quelqu’un chez eux sait lire une carte.' } },
      { points: { camp: 'J', montant: 2 } },
    ] },
    { id: 'centre_tombe', quand: { detruit: 'antenne_centre' }, faire: [
      { radio: { qui: 'Sgt Orin', texte: 'La butte est à nous ! Leur antenne s’est couchée comme un vieux pin.' } },
      { radio: { qui: 'Col. Brannik', texte: 'Bien. Le Centre était le plus dur. Ne relâchez rien.' } },
      { points: { camp: 'J', montant: 2 } },
    ] },
    { id: 'est_tombe', quand: { detruit: 'antenne_est' }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Antenne de l’Est détruite. Derrière cette falaise, ils se croyaient à l’abri.' } },
      { points: { camp: 'J', montant: 2 } },
    ] },

    // --- Halden renforce les relais restants dès la chute du premier (passe 4 du moteur) ---
    //     Chaque renfort n'est envoyé que si son antenne est encore debout (objectif actif).
    { id: 'relais_alerte', quand: { un: [ { detruit: 'antenne_cabane' }, { detruit: 'antenne_centre' }, { detruit: 'antenne_est' } ] }, faire: [
      { attendre: 6 },
      { radio: { qui: 'Oskar Lind (canal Halden intercepté)', texte: 'Toutes les réserves du plateau sur les relais restants. S’ils veulent les deux autres, qu’ils viennent les chercher.' } },
    ] },
    { id: 'renfort_centre', quand: { tous: [ { un: [ { detruit: 'antenne_cabane' }, { detruit: 'antenne_est' } ] }, { objectif: 'centre', etat: 'actif' } ] }, faire: [
      { renforts: { camp: 'I', unites: [{ type: 'operateur', nb: 4 }, { type: 'lynx', nb: 2 }, { type: 'faucheur', nb: 2 }],
        depuis: { x: 3100, y: 2200 }, vers: { x: 1700, y: 1180 }, ordre: 'aller' } },
    ] },
    { id: 'renfort_est', quand: { tous: [ { un: [ { detruit: 'antenne_cabane' }, { detruit: 'antenne_centre' } ] }, { objectif: 'est', etat: 'actif' } ] }, faire: [
      { renforts: { camp: 'I', unites: [{ type: 'operateur', nb: 4 }, { type: 'lynx', nb: 2 }, { type: 'faucheur', nb: 2 }],
        depuis: { x: 3180, y: 700 }, vers: { x: 2860, y: 640 }, ordre: 'aller' } },
    ] },
    { id: 'renfort_cabane', quand: { tous: [ { un: [ { detruit: 'antenne_centre' }, { detruit: 'antenne_est' } ] }, { objectif: 'cabane', etat: 'actif' } ] }, faire: [
      { renforts: { camp: 'I', unites: [{ type: 'operateur', nb: 4 }, { type: 'lynx', nb: 2 }, { type: 'faucheur', nb: 2 }],
        depuis: { x: 600, y: 2200 }, vers: { x: 460, y: 1700 }, ordre: 'aller' } },
    ] },

    // --- La contre-attaque : deux antennes tombées, ou 9 minutes ---
    //     Colonne allégée et 20 s d'alerte : dans sa version d'origine (3 Bastion, 8 tireurs,
    //     5 drones, 8 s d'alerte), elle rasait la base d'un joueur rapide en une minute et demie.
    //     Revérifiée avec le moteur de novembre 2026 : un joueur qui ramène son armée près des
    //     bunkers et du dépôt à l'alerte brise la colonne en 35 à 60 s ; celui qui reste en
    //     campagne (souvent à la brèche de Cornas, sur son chemin) perd tout.
    { id: 'contre_alerte', quand: { un: [
        { tous: [ { detruit: 'antenne_cabane' }, { detruit: 'antenne_centre' } ] },
        { tous: [ { detruit: 'antenne_cabane' }, { detruit: 'antenne_est' } ] },
        { tous: [ { detruit: 'antenne_centre' }, { detruit: 'antenne_est' } ] },
        { temps: 540 } ] }, faire: [
      { musique: 'combat' },
      { radio: { qui: 'Inès Varga (canal Halden intercepté)', texte: 'Ici Varga. Le plateau de l’Escalle n’est pas négociable. Colonne Cap Ferrand, vous montez. Tout ce que vous avez.' } },
      { radio: { qui: 'Lt Szell', texte: 'Colonne Cap Ferrand : ce sont ceux qui ont chassé nos éclaireurs de Cap Ferrand au début du mois. Gros blindés, drones, et une frappe aérienne autorisée.' } },
      // 20 s pour réagir à l'alerte avant l'entrée de la colonne sur la carte.
      { attendre: 20 },
      { renforts: { camp: 'I', unites: [{ type: 'bastion', nb: 2 }, { type: 'lynx', nb: 4 }, { type: 'operateur', nb: 6 }],
        depuis: { x: 3180, y: 1200 }, vers: { x: 700, y: 650 }, ordre: 'attaqueDeplacement', nom: 'contre' } },
      { renforts: { camp: 'I', unites: [{ type: 'faucheur', nb: 4 }],
        depuis: { x: 3180, y: 900 }, vers: { x: 560, y: 520 }, ordre: 'attaqueDeplacement', nom: 'contre_drones' } },
      { objectif: { ajouter: { id: 'contre', type: 'detruire', nom: 'contre', principal: false,
        texte: 'Briser la colonne blindée de Cap Ferrand' } } },
      { radio: { qui: 'Col. Brannik', texte: 'Ils montent vers notre base par la brèche de Cornas. Laissez une garde au QG, ou il n’y aura plus de QG.' } },
    ] },
    // Frappe calée sur l'arrivée de la colonne (entrée sur la carte à +20 s).
    { id: 'contre_frappe', quand: { declencheur: 'contre_alerte', delai: 32 }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Missile en approche sur l’usine ! Écartez ce qui peut bouger !' } },
      { pouvoir: { camp: 'I', cle: 'frappe', x: 580, y: 500 } },
    ] },
    { id: 'contre_brisee', quand: { objectif: 'contre', etat: 'reussi' }, faire: [
      { musique: 'tension' },
      { radio: { qui: 'Sgt Orin', texte: 'La colonne de Cap Ferrand a fait demi-tour. Ce qu’il en reste, en tout cas.' } },
      { reserves: { camp: 'J', montant: 600 } },
    ] },

    // --- La Combe des Puits ---
    { id: 'combe_tenue', quand: { objectif: 'combe', etat: 'reussi' }, faire: [
      { zoneRetirer: 'z_combe' },
      { radio: { qui: 'Lt Szell', texte: 'La pompe de la Combe débite. La brigade nous envoie des réserves, et deux Ours en prime.' } },
      { reserves: { camp: 'J', montant: 1200 } },
      { renforts: { camp: 'J', unites: [{ type: 'ours', nb: 2 }], depuis: { x: 60, y: 600 }, vers: { x: 700, y: 820 }, ordre: 'aller' } },
    ] },
    { id: 'greles_perdues', quand: { objectif: 'greles', etat: 'echoue' }, faire: [
      { radio: { qui: 'Col. Brannik', texte: 'Les trois Grêle sont perdues. Construisez-en d’autres à l’usine, mais je n’aime pas ce genre de comptes.' } },
    ] },
    { id: 'fin', quand: { tous: [ { detruit: 'antenne_cabane' }, { detruit: 'antenne_centre' }, { detruit: 'antenne_est' } ] }, faire: [
      { musique: 'calme' },
      // La chute de la dernière antenne met déjà une ou deux répliques en file (jusqu'à 11 s) :
      // 6 s de répit les laissent passer à l'antenne avant la conclusion de Szell. Depuis la passe 3
      // du moteur, ce répit n'est plus nécessaire pour que la conclusion soit lue (à la victoire, le
      // moteur retire les messages en file et coupe celui qui est affiché au plus 2 s plus tard ; la
      // réplique de cette séquence est gardée) : il sert seulement à ne pas couper l'annonce de la
      // dernière antenne. Revérifié : antenne de l'Est en dernier, son annonce puis la conclusion
      // sont lues en entier, débriefing 11 s après la chute.
      { attendre: 6 },
      { radio: { qui: 'Lt Szell', texte: 'Plus un seul relais sur le plateau. Écoutez… Le silence complet sur leurs fréquences de guidage.' } },
      { victoire: true },
    ] },
  ],
});
