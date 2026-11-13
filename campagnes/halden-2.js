'use strict';
/* =====================================================================
   FRONT DE SEL — Campagne Halden « Le contrat de Varenne »
   Mission 2 : « Le convoi de Vallauris »
   Escorte : trois convois d'eau de la Régie (camp N) traversent une
   vallée sèche jusqu'au village de Vallauris. Au moins deux doivent
   arriver. Les convois avancent par étapes, quand la route est dégagée.
   Données pures : aucune fonction, lues par le moteur (jeu.js).
   ===================================================================== */

// Étapes de la route des convois (rappel) :
//   départ (300, 1790) → A « Gué sec » (950, 1560) → B « Castel » (1560, 1010)
//   → C (2290, 1070) → village de Vallauris (2950, 560).

enregistrerMission({
  id: 'halden-2', campagne: 'halden', numero: 2,
  titre: 'Le convoi de Vallauris',
  lieu: 'Vallée de la Lastre, arrière-pays de Varenne',
  date: '19 mai 2034',

  // -------------------------------------------------------------------
  //  CARTE : vallée intérieure, sans mer. Une route sinueuse monte du
  //  sud-ouest (dépôt de la Régie) au nord-est (village de Vallauris).
  //  Au nord, un plateau tenu par Karsk domine la vallée ; on y monte
  //  par une large brèche au centre. Les crêtes cadrent les embuscades.
  // -------------------------------------------------------------------
  carte: {
    id: 'valLastre', nom: 'Vallée de la Lastre',
    graine: 77310,
    ambiance: 'brume',
    cote: null,
    rivieres: [],
    ponts: [],
    cretes: [
      [150, 1300, 850, 1180, 7],     // rebord nord de la vallée basse
      [900, 2150, 1500, 1700, 6],    // rebord sud
      [1000, 800, 1500, 700, 5],     // falaise ouest du plateau
      [2000, 760, 2450, 600, 5],     // falaise est du plateau
      [2700, 1300, 3000, 1650, 4],   // éboulis au sud-est
    ],
    rochers: 35,
    bosquets: [
      { x: 400, y: 900, r: 110 },    // chênes verts au nord-ouest
      { x: 650, y: 2100, r: 100 },
      { x: 1900, y: 1500, r: 120 },
      { x: 2500, y: 1800, r: 120 },
      { x: 1200, y: 300, r: 110 },
      { x: 2850, y: 150, r: 90 },
    ],
    routes: [
      [[0, 1880], [300, 1800], [650, 1720], [950, 1560], [1150, 1350], [1300, 1150], [1550, 1000],
       [1850, 980], [2100, 1100], [2350, 1050], [2550, 850], [2700, 650], [2850, 520], [3000, 470], [3200, 430]],
      [[1750, 990], [1760, 700], [1850, 450], [1900, 330]],     // piste vers le plateau
      [[2100, 1100], [2300, 1450], [2400, 2240]],               // route du sud
    ],
    noeuds: [
      [600, 1500, 3000], [250, 1650, 2500], [650, 1960, 2500],   // autour de la base Halden
      [1150, 1650, 3000], [1300, 1450, 2500],                    // milieu de vallée
      [1500, 300, 3000], [2300, 420, 3000],                      // plateau Karsk
      [2420, 1350, 3000], [2750, 950, 2500],                     // abords de Vallauris
    ],
    structures: [
      { type: 'village', x: 2850, y: 250, l: 300, h: 170, nom: 'Vallauris' },
      { type: 'ruines', x: 1350, y: 860, l: 200, h: 120, nom: 'Castel' },
      { type: 'ferme', x: 1950, y: 1150, l: 150, h: 100, nom: 'Mas Brûlé' },
    ],
    bases: { J: { c: 8, r: 38 }, I: { c: 46, r: 5 } },
  },

  joueur: 'halden', adversaire: 'karsk',

  briefing: {
    intervenant: 'Inès Varga, directrice des opérations',
    texte: [
      'Mauvaise semaine. Karsk a pris Sorbe et l’entrepôt de la Régie qui nourrissait l’arrière-pays. Notre contre-attaque de drones s’y est cassé les dents. Les villages de la vallée de la Lastre n’ont plus que les camions de la Régie.',
      'Trois convois d’eau partent du dépôt de Salvan pour Vallauris. Karsk tient le plateau au-dessus de la vallée et compte bien les arrêter. Il en faut au moins deux à destination : en dessous, Vallauris est évacué et la vallée tombe d’elle-même.',
      'Les convois avancent par étapes, quand la route est dégagée. Ouvrez-la devant eux. Vous avez une base légère, une escorte et de quoi produire des Lynx.',
      'L’ingénieur Mercadier a été muté à Vallauris. Il vous attend. Il vous attend toujours, d’ailleurs.',
    ],
  },
  fin: {
    victoire: 'Les camions de la Régie entrent dans Vallauris sous les applaudissements, ce qui n’arrive jamais aux convois militaires. Joël Mercadier a rempli les citernes du village en une nuit. Oskar Lind signale pourtant un mouvement inquiétant : des sapeurs Karsk sur le plateau des antennes, à l’est. Ils ne cherchent pas l’eau. Ils cherchent nos yeux.',
    defaite: 'Trop de camions brûlent dans la vallée. Vallauris est évacué vers la côte, et la Lastre devient une route militaire. La Régie résilie le volet « escorte » du contrat.',
  },

  reserves: { J: 1200, I: 1000 },
  popMax: 50,
  pouvoirs: true,
  autorises: { batiments: ['caserne', 'usine', 'relais', 'tourelle'], unites: ['technicien', 'operateur', 'lynx'] },
  relations: { I_attaque_N: true },
  ia: { construit: true, revenu: 0.6, vagues: { premiere: 300, taille: 5, croissance: 1, intervalle: 210 }, cible: null },
  musique: 'calme',

  // -------------------------------------------------------------------
  //  FORCES DE DÉPART
  // -------------------------------------------------------------------
  depart: {
    J: [
      { type: 'qg', c: 8, r: 38, nom: 'qg' },
      { type: 'technicien', x: 380, y: 1700, nb: 3 },
      { type: 'operateur', x: 560, y: 1620, nb: 5, nom: 'escorte' },
      { type: 'lynx', x: 700, y: 1680, nb: 2, nom: 'escorte' },
    ],
    I: [
      { type: 'qg', c: 46, r: 5, nom: 'campNord' },
      { type: 'caserne', c: 40, r: 9, nom: 'campNord' },
      { type: 'depot', c: 51, r: 7, nom: 'campNord' },
      { type: 'sapeur', x: 1900, y: 420, nb: 4 },
      { type: 'conscrit', x: 1780, y: 560, nb: 4 },
      // Barrage routier à l'approche de Vallauris
      { type: 'bunker', c: 60, r: 20, nom: 'barrage' },
      { type: 'bunker', c: 65, r: 16, nom: 'barrage' },
      { type: 'conscrit', x: 2620, y: 820, nb: 6, nom: 'barrage' },
    ],
    N: [
      { type: 'entrepot', c: 3, r: 46, nom: 'depotRegie' },
      { type: 'convoi', x: 300, y: 1790, nb: 3, nom: 'convoi' },
    ],
  },

  // -------------------------------------------------------------------
  //  OBJECTIFS
  // -------------------------------------------------------------------
  objectifs: [
    { id: 'convois', type: 'escorter', nom: 'convoi', zone: { x: 2950, y: 560, r: 150 }, minimum: 2,
      texte: 'Escorter les convois de la Régie jusqu’à Vallauris (au moins 2 sur 3).' },
    { id: 'campNord', type: 'detruire', nom: 'campNord', principal: false,
      texte: 'Détruire le camp Karsk du plateau nord.' },
  ],

  // -------------------------------------------------------------------
  //  DÉCLENCHEURS
  // -------------------------------------------------------------------
  declencheurs: [
    // --- Mise en place ---
    { id: 'intro', quand: { temps: 2 }, faire: [
      { zone: { id: 'zA', x: 950, y: 1560, r: 200, texte: 'Gué sec' } },
      { zone: { id: 'zVallauris', x: 2950, y: 560, r: 150, texte: 'Vallauris' } },
      { radio: { qui: 'Inès Varga', texte: 'Varga. Les camions de la Régie sont au dépôt de Salvan, moteurs chauds. Ils partent dès que le Gué sec est sûr.' } },
      { radio: { qui: 'Noor Salem', texte: 'Salem. J’ai cinq opérateurs et deux Lynx. Je propose d’ouvrir la route au Gué sec avant qu’ils ne s’engagent.' } },
      { radio: { qui: 'Oskar Lind', texte: 'Lind. Karsk tient le plateau au nord. Depuis Sorbe, ils ont le moral et l’entrepôt. Nous, on a des camions.' } },
      { radio: { qui: 'Inès Varga', texte: 'Développez la base pendant ce temps : une usine vous donnera des Lynx. Les convois ne vous attendront pas plus de deux minutes.' } },
    ] },

    // --- Étape 1 : vers le Gué sec ---
    { id: 'etape1', quand: { un: [ { zone: { x: 950, y: 1560, r: 220 }, camp: 'J', nombre: 2 }, { temps: 120 } ] }, faire: [
      { radio: { qui: 'Convoi de la Régie', texte: 'Convoi de la Régie, trois citernes pleines. On part. Ne nous perdez pas de vue, on n’est pas blindés.' } },
      { deplacer: { nom: 'convoi', chemin: [ { x: 500, y: 1760 }, { x: 800, y: 1660 }, { x: 950, y: 1580 } ] } },
    ] },
    { id: 'embuscade1', quand: { zone: { x: 950, y: 1560, r: 240 }, camp: 'N', nom: 'convoi' }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 8 } ], depuis: { x: 820, y: 640 }, vers: { x: 950, y: 1560 },
                    ordre: 'attaqueDeplacement', nom: 'embuscade1' } },
      { musique: 'combat' },
      { radio: { qui: 'Oskar Lind', texte: 'Mouvement au nord du gué ! Huit fantassins descendent par la brèche. Ils visent les camions.' } },
      { radio: { qui: 'Noor Salem', texte: 'Tout le monde entre eux et les citernes. Feu à volonté.' } },
    ] },
    { id: 'etape2', quand: { un: [ { detruit: 'embuscade1' }, { declencheur: 'embuscade1', delai: 120 } ] }, faire: [
      { musique: 'tension' },
      { zoneRetirer: 'zA' },
      { zone: { id: 'zB', x: 1560, y: 1010, r: 200, texte: 'Ruines de Castel' } },
      { radio: { qui: 'Convoi de la Régie', texte: 'On repart vers les ruines de Castel. Si quelqu’un a une prière pour les pneus, c’est le moment.' } },
      { deplacer: { nom: 'convoi', chemin: [ { x: 1150, y: 1360 }, { x: 1300, y: 1160 }, { x: 1560, y: 1020 } ] } },
      { deverrouiller: { unites: ['faucheur'] } },
      { radio: { qui: 'Oskar Lind', texte: 'Bonne nouvelle : la direction débloque les Faucheur. À Sorbe, nous en avons perdu un essaim entier. Ménagez ceux-là.' } },
    ] },

    // --- Étape 2 : la gorge de Castel ---
    { id: 'embuscade2', quand: { zone: { x: 1560, y: 1010, r: 240 }, camp: 'N', nom: 'convoi' }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'grele', nb: 2 } ], depuis: { x: 1760, y: 520 }, vers: { x: 1720, y: 660 },
                    ordre: 'aller', nom: 'embuscade2' } },
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 6 }, { type: 'ours', nb: 1 } ], depuis: { x: 2200, y: 1350 }, vers: { x: 1560, y: 1010 },
                    ordre: 'attaqueDeplacement', nom: 'embuscade2' } },
      { musique: 'combat' },
      { radio: { qui: 'Oskar Lind', texte: 'Deux menaces. Fantassins par le sud-est, un Ours, et deux Grêle sur la brèche du plateau. Elles tirent de très loin.' } },
      { radio: { qui: 'Inès Varga', texte: 'Une Grêle est inutile au contact. Envoyez des Lynx sur elles, ou une frappe. Les camions ne survivront pas à trois salves.' } },
    ] },
    { id: 'grele', quand: { tous: [ { pvSous: { nom: 'convoi', ratio: 0.6 } }, { objectif: 'convois', etat: 'actif' } ] }, faire: [
      { radio: { qui: 'Convoi de la Régie', texte: 'On fuit par tous les tuyaux ! Littéralement !' } },
    ] },
    { id: 'etape3', quand: { un: [ { detruit: 'embuscade2' }, { declencheur: 'embuscade2', delai: 150 } ] }, faire: [
      { musique: 'tension' },
      { zoneRetirer: 'zB' },
      { radio: { qui: 'Convoi de la Régie', texte: 'Route dégagée. On continue vers l’est, jusqu’au Mas Brûlé.' } },
      { deplacer: { nom: 'convoi', chemin: [ { x: 1850, y: 990 }, { x: 2100, y: 1060 }, { x: 2290, y: 1070 } ] } },
    ] },

    // --- Étape 3 : le barrage routier ---
    { id: 'barrage', quand: { zone: { x: 2290, y: 1070, r: 220 }, camp: 'N', nom: 'convoi' }, faire: [
      { zone: { id: 'zBarrage', x: 2540, y: 780, r: 200, texte: 'Barrage routier' } },
      { objectif: { ajouter: { id: 'barrage', type: 'detruire', nom: 'barrage',
                               texte: 'Détruire le barrage routier Karsk avant Vallauris.' } } },
      { radio: { qui: 'Noor Salem', texte: 'Barrage routier. Deux bunkers et du monde derrière. Les camions s’arrêtent ici, ils ne passeront pas sous ce feu.' } },
      { radio: { qui: 'Joël Mercadier', texte: 'Mercadier, à Vallauris. Je vous vois aux jumelles. Le réservoir du village est à sec depuis lundi.' } },
      // Conseil autrefois différé de 45 s (déclencheur « aideBarrage ») : il tombait souvent après la
      // chute du barrage et retardait la réplique finale, lue avant le débriefing depuis le correctif
      // du moteur. Il est maintenant donné d'emblée.
      { radio: { qui: 'Oskar Lind', texte: 'Les bunkers encaissent. Groupez au moins huit unités, et gardez vos points pour une frappe de précision.' } },
    ] },
    { id: 'etape4', quand: { detruit: 'barrage' }, faire: [
      { zoneRetirer: 'zBarrage' },
      { radio: { qui: 'Noor Salem', texte: 'Barrage tombé. Convois, la route est à vous.' } },
      { deplacer: { nom: 'convoi', chemin: [ { x: 2400, y: 1000 }, { x: 2550, y: 860 }, { x: 2700, y: 660 }, { x: 2860, y: 560 }, { x: 2950, y: 560 } ] } },
    ] },
    // Contre-attaque vers les camions : 90 s après l'arrêt au barrage, ou dès que la route s'ouvre
    // (sinon un joueur rapide atteignait Vallauris avant que l'Ours ne serve à quelque chose).
    { id: 'ours', quand: { un: [ { declencheur: 'barrage', delai: 90 }, { declencheur: 'etape4', delai: 3 } ] }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'ours', nb: 1 }, { type: 'conscrit', nb: 5 } ], depuis: { x: 3150, y: 760 }, vers: { x: 2300, y: 1060 },
                    ordre: 'attaqueDeplacement', nom: 'derniereChance' } },
      { musique: 'combat' },
      { radio: { qui: 'Oskar Lind', texte: 'Un Ours à l’est du village, il descend la route vers les camions ! Je ne sais pas où ils l’avaient caché. Je vais le noter quelque part.' } },
      { radio: { qui: 'Inès Varga', texte: 'Frappe autorisée. Interceptez-le avant qu’il n’atteigne les camions.' } },
    ] },

    // --- Réactions ---
    { id: 'campDetruit', quand: { objectif: 'campNord', etat: 'reussi' }, faire: [
      { reserves: { camp: 'J', montant: 800 } },
      { radio: { qui: 'Inès Varga', texte: 'Plateau nettoyé. La Régie verse une prime : huit cents. Elle n’est pas généreuse d’habitude.' } },
    ] },
    // Seulement tant que l'escorte est en cours : un camion perdu (ou très abîmé) au moment où les deux
    // autres entrent dans Vallauris faisait lire « il en faut deux » comme réplique finale, après la victoire.
    { id: 'convoiPerdu', quand: { tous: [ { pvSous: { nom: 'convoi', ratio: 0.4 } }, { objectif: 'convois', etat: 'actif' } ] }, faire: [
      { radio: { qui: 'Inès Varga', texte: 'Les convois sont en lambeaux. Il en faut deux à Vallauris, commandant. Pas un de moins.' } },
    ] },
    { id: 'arrivee', quand: { objectif: 'convois', etat: 'reussi' }, faire: [
      { musique: 'calme' },
      { radio: { qui: 'Joël Mercadier', texte: 'Les camions sont dans la cour ! Vallauris boit ce soir. Vous direz à votre directrice que la Régie vous doit une bière. Sans eau.' } },
    ] },
  ],
});
