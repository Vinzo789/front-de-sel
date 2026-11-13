'use strict';
/* =====================================================================
   FRONT DE SEL — Campagne Halden « Le contrat de Varenne »
   Mission 3 : « Le pont de la Sarne »
   Tenir le pont principal contre des vagues Karsk, puis détruire la
   tête de pont sur l'autre rive. Les Bastion sont débloqués en cours
   de mission. Pas de Faucheur : les antennes du plateau sont tombées.
   Données pures : aucune fonction, lues par le moteur (jeu.js).
   ===================================================================== */

enregistrerMission({
  id: 'halden-3', campagne: 'halden', numero: 3,
  titre: 'Le pont de la Sarne',
  lieu: 'Basse vallée de la Sarne',
  date: '26 mai 2034',

  // -------------------------------------------------------------------
  //  CARTE : la Sarne coupe la carte du nord (barrage à sec) au sud
  //  (embouchure). Deux ponts : le pont principal au centre, large, et
  //  la passerelle de Lisle au nord, étroite. Halden tient la rive ouest,
  //  Karsk a jeté une tête de pont sur la rive est, juste en face.
  // -------------------------------------------------------------------
  carte: {
    id: 'sarne', nom: 'Basse Sarne',
    graine: 26052,
    ambiance: 'aube',
    cote: { base: 2090, ondes: [[50, 300, 0], [25, 80, 1]] },
    rivieres: [
      { points: [[1570, 0], [1600, 280], [1545, 620], [1600, 1000], [1680, 1380], [1640, 1700], [1700, 2240]], largeur: 90 },
    ],
    ponts: [
      { x: 1600, y: 1000, angle: 0, longueur: 180, largeur: 80 },   // pont principal de la Sarne (deux voies)
      { x: 1584, y: 380, angle: 0, longueur: 170, largeur: 50 },    // passerelle de Lisle (une voie)
    ],
    cretes: [
      [950, 1650, 1300, 1830, 4],     // butte de la rive ouest
      [2300, 430, 2700, 560, 5],      // coteau de la rive est
      [2250, 1550, 2450, 1800, 3],
    ],
    rochers: 30,
    bosquets: [
      { x: 1360, y: 260, r: 90 },     // peupliers de la rive ouest
      { x: 1850, y: 1520, r: 90 },
      { x: 500, y: 380, r: 120 },
      { x: 2850, y: 1700, r: 120 },
      { x: 1300, y: 1300, r: 70 },
    ],
    routes: [
      [[0, 1000], [600, 990], [1200, 1000], [1510, 1000], [1690, 1000], [2100, 960], [2600, 1000], [3200, 1040]],   // route du pont principal
      [[1200, 1000], [1350, 600], [1490, 380], [1680, 380], [1900, 300], [2400, 200], [3200, 180]],                  // route de Lisle
      [[2100, 960], [2350, 1300], [2500, 1400]],                                                                      // vers le village de Sarne
    ],
    noeuds: [
      [300, 700, 3000], [350, 1350, 3000], [800, 800, 2500], [900, 1250, 2500], [1150, 560, 2000], [1250, 1550, 2500],   // rive ouest
      [2000, 700, 3000], [2150, 1300, 3000], [2650, 800, 3000], [2750, 1250, 2500], [1950, 1700, 2000],                    // rive est
    ],
    structures: [
      { type: 'barrage', x: 1460, y: 30, l: 230, h: 70, nom: 'Barrage de la Sarne' },
      { type: 'village', x: 2500, y: 1400, l: 260, h: 160, nom: 'Sarne' },
      { type: 'ferme', x: 650, y: 1550, l: 180, h: 110, nom: 'Mas Lisle' },
      { type: 'ruines', x: 1820, y: 230, l: 160, h: 100, nom: 'Moulin de Lisle' },
    ],
    bases: { J: { c: 8, r: 23 }, I: { c: 56, r: 22 } },
  },

  joueur: 'halden', adversaire: 'karsk',

  briefing: {
    intervenant: 'Inès Varga, directrice des opérations',
    texte: [
      'Hier soir, des sapeurs Karsk ont fait sauter nos trois antennes relais sur le plateau de Coupure. Depuis, nos drones volent à l’aveugle. Pas de Faucheur dans cette mission : je refuse d’en perdre d’autres contre des rochers.',
      'Karsk a profité de la nuit pour franchir la Sarne. Leur tête de pont est sur la rive est, juste en face du pont principal. S’ils le traversent en force, la route de la côte est ouverte jusqu’à Port-Calmes.',
      'Votre mission : tenir l’extrémité ouest du pont le temps que le conseil signe l’avenant sur les blindés lourds. Ensuite, vous traversez et vous rasez la tête de pont.',
      'Oskar Lind pense qu’ils tenteront aussi la passerelle de Lisle, au nord. Oskar Lind pense beaucoup de choses. Celle-là, je la crois.',
    ],
  },
  fin: {
    victoire: 'La tête de pont est rasée et le pont de la Sarne tient toujours, troué comme une passoire. Le colonel Brannik a perdu son raccourci vers la côte. Il ne lui reste qu’une route : droit sur Port-Calmes, droit sur l’usine. Inès Varga a déjà commandé les Bastion supplémentaires. Le conseil a déjà signé la facture.',
    defaite: 'Les chars Karsk franchissent la Sarne au lever du jour. La route de la côte est ouverte et Port-Calmes se prépare à un siège. Le conseil d’administration convoque une réunion de crise, sans vous.',
  },

  reserves: { J: 2000, I: 300 },
  popMax: 60,
  pouvoirs: { J: true, I: false },   // le Marteau Karsk est scénarisé (déclencheur marteauAnnonce), pas laissé à l'IA
  autorises: { batiments: ['caserne', 'usine', 'relais', 'tourelle'], unites: ['technicien', 'operateur', 'lynx'] },
  relations: {},
  // Revenu bas : la tête de pont est à moins de 550 px de la zone à tenir, donc toute unité
  // qu'elle produit vient au contact. Un revenu de 0,5 noyait le pont avant la 2e vague.
  ia: { construit: true, revenu: 0.3, vagues: { premiere: 600, taille: 6, croissance: 2, intervalle: 180 }, cible: { x: 1420, y: 1000 } },
  musique: 'tension',

  // -------------------------------------------------------------------
  //  FORCES DE DÉPART
  // -------------------------------------------------------------------
  depart: {
    J: [
      { type: 'qg', c: 8, r: 23, nom: 'qg' },
      { type: 'caserne', c: 14, r: 19 },
      { type: 'usine', c: 14, r: 26 },
      { type: 'relais', c: 29, r: 19, nom: 'relaisPont' },
      { type: 'technicien', x: 420, y: 1120, nb: 4 },
      { type: 'operateur', x: 1400, y: 960, nb: 6, nom: 'gardePont' },
      { type: 'lynx', x: 1360, y: 1060, nb: 3, nom: 'gardePont' },
      { type: 'bastion', x: 1250, y: 1000, nb: 1, nom: 'gardePont' },
    ],
    I: [
      { type: 'qg', c: 56, r: 22, nom: 'tetePont' },
      { type: 'caserne', c: 46, r: 20, nom: 'tetePont' },
      { type: 'depot', c: 46, r: 27, nom: 'tetePont' },
      { type: 'usine', c: 50, r: 23, nom: 'tetePont' },
      // Bunkers reculés de 3 tuiles (étaient en c: 44) : en c: 44, leur portée (220) couvrait le
      // bord est de la zone à tenir et tout le pont ; les défenseurs y fondaient avant la 1re vague.
      { type: 'bunker', c: 47, r: 23, nom: 'tetePont' },
      { type: 'bunker', c: 47, r: 25, nom: 'tetePont' },
      { type: 'sapeur', x: 2200, y: 1100, nb: 4 },
      { type: 'conscrit', x: 1980, y: 1120, nb: 5 },
    ],
  },

  // -------------------------------------------------------------------
  //  OBJECTIFS
  // -------------------------------------------------------------------
  objectifs: [
    // 240 s : à 150 s, l'objectif tombait avant la 2e vague, et la passerelle, le Marteau et la
    // 4e vague arrivaient après coup (« réoccupez la zone » ne voulait plus rien dire).
    // Les vagues sont calées pour tomber pendant ces 4 minutes.
    { id: 'tenir', type: 'tenir', zone: { x: 1420, y: 1000, r: 150 }, duree: 240,
      texte: 'Tenir l’extrémité ouest du pont de la Sarne (4 min cumulées, sans ennemi dans la zone).' },
    // Présent dès le départ (et non ajouté plus tard) : ainsi, la réussite de « tenir » ne peut
    // jamais déclencher une victoire prématurée avant que la suite de la mission ne soit posée.
    { id: 'tetePont', type: 'detruire', nom: 'tetePont',
      texte: 'Ensuite : traverser la Sarne et détruire la tête de pont Karsk.' },
    { id: 'tourelles', type: 'construire', batiment: 'tourelle', nombre: 2, principal: false,
      texte: 'Construire deux tourelles pour couvrir la rive ouest.' },
  ],

  // -------------------------------------------------------------------
  //  DÉCLENCHEURS
  // -------------------------------------------------------------------
  declencheurs: [
    // --- Mise en place ---
    { id: 'intro', quand: { temps: 2 }, faire: [
      { zone: { id: 'zPont', x: 1420, y: 1000, r: 150, texte: 'Pont de la Sarne' } },
      { camera: { x: 1420, y: 1000 } },
      { radio: { qui: 'Noor Salem', texte: 'Salem, au pont. Six opérateurs, trois Lynx et un Bastion, le seul que la direction ait bien voulu prêter.' } },
      { radio: { qui: 'Inès Varga', texte: 'Tenez l’entrée ouest du pont. Chaque seconde sans Karsk dans la zone compte. Il en faut deux cent quarante.' } },
      { radio: { qui: 'Oskar Lind', texte: 'Ne restez pas collés au pont : les bunkers d’en face tirent à deux cents mètres. Le terrain se tient de ce côté-ci.' } },
    ] },
    { id: 'conseilTourelles', quand: { temps: 30 }, faire: [
      { radio: { qui: 'Inès Varga', texte: 'Vos techniciens peuvent bâtir des tourelles automatiques. Deux, de part et d’autre de la route, feraient un bon bouchon.' } },
    ] },
    { id: 'tourellesFaites', quand: { construit: { type: 'tourelle', nombre: 2 } }, faire: [
      { objectif: { reussir: 'tourelles' } },
      { reserves: { camp: 'J', montant: 400 } },
      { radio: { qui: 'Inès Varga', texte: 'Tourelles en place. Le service achats vous rembourse quatre cents. C’est historique.' } },
    ] },

    // --- Les vagues sur le pont ---
    { id: 'vague1', quand: { temps: 45 }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 5 } ], depuis: { x: 3150, y: 1040 }, vers: { x: 1350, y: 1000 },
                    ordre: 'attaqueDeplacement', nom: 'vague' } },
      { musique: 'combat' },
      { radio: { qui: 'Oskar Lind', texte: 'Première vague. Infanterie, cinq hommes, par la route de l’est. Ils chantent. Ce n’est pas bon signe.' } },
    ] },
    { id: 'vague2', quand: { temps: 105 }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 6 }, { type: 'ours', nb: 1 } ], depuis: { x: 3150, y: 1040 }, vers: { x: 1350, y: 1000 },
                    ordre: 'attaqueDeplacement', nom: 'vague' } },
      { radio: { qui: 'Oskar Lind', texte: 'Deuxième vague, avec un Ours. Le Bastion peut le prendre, à condition de ne pas être seul.' } },
    ] },
    { id: 'lisle', quand: { temps: 145 }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 5 }, { type: 'ours', nb: 1 } ], depuis: { x: 3150, y: 200 }, vers: { x: 700, y: 900 },
                    ordre: 'attaqueDeplacement', nom: 'flanc' } },
      { zone: { id: 'zLisle', x: 1584, y: 380, r: 140, texte: 'Passerelle de Lisle' } },
      { radio: { qui: 'Noor Salem', texte: 'Mouvement au nord ! Ils passent par la passerelle de Lisle. Direction : notre base.' } },
      { radio: { qui: 'Oskar Lind', texte: 'Je l’avais dit. Je le note pour mon entretien annuel.' } },
    ] },
    { id: 'vague3', quand: { temps: 180 }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 6 }, { type: 'ours', nb: 1 }, { type: 'grele', nb: 1 } ], depuis: { x: 3150, y: 1040 }, vers: { x: 1350, y: 1000 },
                    ordre: 'attaqueDeplacement', nom: 'vague' } },
      { radio: { qui: 'Oskar Lind', texte: 'Troisième vague. Un Ours, et une Grêle derrière. Elle tire de loin : allez la chercher.' } },
    ] },
    { id: 'marteauAnnonce', quand: { temps: 215 }, faire: [
      { radio: { qui: 'Oskar Lind', texte: 'Signature d’artillerie lourde ! Le Marteau, sur l’entrée du pont ! Sortez de la zone, tout de suite !' } },
      { attendre: 6 },
      { pouvoir: { camp: 'I', cle: 'marteau', x: 1420, y: 1000 } },
    ] },
    { id: 'apresMarteau', quand: { declencheur: 'marteauAnnonce', delai: 14 }, faire: [
      { radio: { qui: 'Noor Salem', texte: 'Ici Salem. On est sonnés, mais on est là. Réoccupez la zone avant leur infanterie !' } },
    ] },
    // Seulement si le pont n'est pas encore tenu (sinon « Encore une » tombe après la victoire d'étape).
    { id: 'vague4', quand: { tous: [ { temps: 245 }, { objectif: 'tenir', etat: 'actif' } ] }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 6 }, { type: 'ours', nb: 1 }, { type: 'sentinelle', nb: 1 } ], depuis: { x: 3150, y: 1040 }, vers: { x: 1350, y: 1000 },
                    ordre: 'attaqueDeplacement', nom: 'vague' } },
      { radio: { qui: 'Oskar Lind', texte: 'Encore une. Je commence à admirer leur logistique.' } },
    ] },
    { id: 'pontEnDanger', quand: { zone: { x: 1300, y: 1000, r: 260 }, camp: 'I', nombre: 6 }, faire: [
      { radio: { qui: 'Inès Varga', texte: 'Ils sont sur notre rive ! Repoussez-les, sinon le compteur ne bouge plus.' } },
    ] },
    { id: 'qgMenace', quand: { pvSous: { nom: 'qg', ratio: 0.6 } }, faire: [
      { radio: { qui: 'Inès Varga', texte: 'Le QG prend des coups. Sans lui, plus de réseau, plus de production. Rapatriez du monde.' } },
    ] },

    // --- Le pont tient : Bastion débloqué, contre-attaque ---
    { id: 'pontTenu', quand: { objectif: 'tenir', etat: 'reussi' }, faire: [
      { zoneRetirer: 'zPont' },
      { deverrouiller: { unites: ['bastion'] } },
      { reserves: { camp: 'J', montant: 1000 } },
      { radio: { qui: 'Inès Varga', texte: 'L’avenant est signé. Vous avez les Bastion, et mille de crédit supplémentaire. Votre usine peut les produire dès maintenant.' } },
      { zone: { id: 'zTete', x: 1960, y: 1000, r: 300, texte: 'Tête de pont Karsk' } },
      { radio: { qui: 'Noor Salem', texte: 'On passe à l’offensive. Les bunkers d’abord, à l’entrée du pont. Puis l’usine.' } },
      { musique: 'tension' },
    ] },
    { id: 'traversee', quand: { zone: { x: 1900, y: 1000, r: 250 }, camp: 'J', nombre: 5 }, faire: [
      { musique: 'combat' },
      { radio: { qui: 'Oskar Lind', texte: 'Interception Karsk. Une certaine lieutenante Szell réclame des sapeurs pour faire sauter le pont. Elle n’en aura pas.' } },
    ] },
    // « pvSous » est vrai dès qu'UN bâtiment du groupe passe sous le seuil : sans la première
    // condition, les tirs du Bastion sur un bunker le déclenchaient dès la 40e seconde.
    { id: 'repli', quand: { tous: [ { objectif: 'tenir', etat: 'reussi' }, { pvSous: { nom: 'tetePont', ratio: 0.5 } } ] }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 6 }, { type: 'ours', nb: 1 } ], depuis: { x: 3150, y: 1040 }, vers: { x: 2100, y: 1000 },
                    ordre: 'attaqueDeplacement', nom: 'derniersRenforts' } },
      { radio: { qui: 'Oskar Lind', texte: 'Ils jettent leurs dernières réserves sur la rive est. Si la tête de pont tombe, Brannik n’a plus de raccourci.' } },
    ] },
    { id: 'fin', quand: { objectif: 'tetePont', etat: 'reussi' }, faire: [
      { musique: 'calme' },
      { zoneRetirer: 'zTete' },
      { radio: { qui: 'Inès Varga', texte: 'Tête de pont rasée. La Sarne est à nous. Prochaine étape : Port-Calmes. Ils y seront tous.' } },
    ] },
  ],
});
