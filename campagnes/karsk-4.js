/* =====================================================================
   FRONT DE SEL — Campagne Karsk « La marche du Nord »
   Mission 4 : « Les quais de Port-Calmes »
   ---------------------------------------------------------------------
   Assaut final, mission exigeante. Halden est retranché autour de
   l'usine de dessalement de Port-Calmes, avec une base complète et
   active. Il faut tout détruire SANS détruire la station de pompage de
   l'usine (camp neutre) : le Marteau et les salves des Grêle tuent
   aussi ce qu'ils ne visent pas.
   Même bataille que la mission Halden 4, vue du nord : deux issues
   possibles d'un même jour.
   Données pures. J = Karsk (joueur), I = Halden, N = Régie des eaux.
   ===================================================================== */

enregistrerMission({
  id: 'karsk-4', campagne: 'karsk', numero: 4,
  titre: 'Les quais de Port-Calmes',
  lieu: 'Port-Calmes, côte de Varenne',
  date: '12 juin 2034',

  // ------------------------------------------------------------------
  //  CARTE : Port-Calmes vu du nord, dans la brume de mer. La base
  //  Karsk sur les hauteurs, une ligne de collines percée de trois
  //  passages (ouest par les Salines, centre par la grand-route, est
  //  par la vieille ville), puis la base Halden sur la bande côtière,
  //  autour de l'usine de dessalement et de sa station de pompage.
  // ------------------------------------------------------------------
  carte: {
    id: 'quaisPortCalmes', nom: 'Quais de Port-Calmes',
    graine: 3034,
    ambiance: 'brume',
    cote: { base: 1890, ondes: [[55, 280, 0.6], [28, 95, 2.1]] },
    rivieres: [],
    ponts: [],
    cretes: [
      // Ligne de collines : passages ouest (x 300 → 720), centre (x 1320 → 1900), est (x 2480 → 2900)
      [0, 1050, 300, 1100, 5],
      [720, 1080, 1320, 1150, 9],
      [1900, 1150, 2480, 1080, 9],
      [2900, 1080, 3200, 1040, 5],
      // Hauteurs du nord (décor)
      [150, 550, 450, 700, 5],
      [2700, 300, 3000, 500, 5],
    ],
    rochers: 26,
    bosquets: [
      // Pins d'Alep sur les hauteurs, figuiers près de la ville
      { x: 900, y: 330, r: 100 }, { x: 2280, y: 280, r: 110 }, { x: 1050, y: 1360, r: 90 },
      { x: 3050, y: 1300, r: 100 }, { x: 300, y: 1300, r: 90 },
    ],
    routes: [
      // Grand-route : de la base Karsk au cœur de la base Halden, puis à l'usine
      [[1680, 0], [1680, 300], [1600, 520], [1600, 900], [1700, 1180], [1720, 1300], [1720, 1600]],
      // Route des Salines (ouest), vers le dépôt pétrolier
      [[1600, 520], [900, 600], [500, 900], [500, 1100], [600, 1400]],
      // Route de la vieille ville (est), jusqu'aux quais
      [[1600, 520], [2300, 600], [2700, 900], [2700, 1100], [2800, 1300], [2800, 1550], [2300, 1650]],
    ],
    noeuds: [
      // Hauteurs (Karsk)
      [1150, 350, 3000], [1950, 340, 3000], [700, 500, 2500], [2550, 650, 2500], [400, 900, 2000],
      // Terrain disputé
      [1050, 980, 3000], [2200, 950, 3000], [1600, 820, 4000],
      // Bande côtière (Halden)
      [1250, 1560, 3500], [1950, 1560, 3500], [2250, 1320, 3000],
    ],
    structures: [
      { type: 'usine_dessal', x: 1460, y: 1620, l: 280, h: 140, nom: 'Usine de dessalement de Port-Calmes' },
      { type: 'port', x: 1900, y: 1700, l: 380, h: 200, nom: 'Quais nord' },
      { type: 'raffinerie', x: 450, y: 1500, l: 280, h: 170, nom: 'Dépôt pétrolier des Salines' },
      { type: 'village', x: 2450, y: 1350, l: 260, h: 160, nom: 'Port-Calmes — vieille ville' },
      { type: 'phare', x: 3020, y: 1640, l: 60, h: 60, nom: 'Phare de la Pointe' },
      { type: 'ruines', x: 1000, y: 780, l: 140, h: 90, nom: 'Faubourg bombardé' },
      { type: 'ferme', x: 2350, y: 450, l: 170, h: 100, nom: 'Mas des Salines' },
    ],
    bases: { J: { c: 38, r: 4 }, I: { c: 39, r: 31 } },
  },

  joueur: 'karsk', adversaire: 'halden',

  briefing: {
    intervenant: 'Colonel Teodor Brannik, 3e brigade de Karsk',
    texte: [
      'Nous avons perdu la Sarne. Halden a tenu le pont principal et nous a renvoyés sur l’autre rive. Alors nous passons par le nord, par les collines, et nous descendons droit sur les quais de Port-Calmes.',
      'L’usine de dessalement est là, au bord de l’eau. C’est pour elle que nous marchons depuis Brèche. Halden s’est retranché tout autour : tourelles à chaque passage, chars, drones, et leur fameux Essaim.',
      'Écoutez-moi bien. La station de pompage de l’usine ne doit pas être détruite. Sans elle, l’usine ne sert à rien, ni à eux, ni à nous, ni à personne au nord. Si elle saute, nous aurons fait cette guerre pour rien.',
      'Le Marteau ne fait pas de différence entre un char Halden et une pompe. Les Grêle non plus. Szell a tracé un périmètre autour de la station : n’y lâchez pas d’artillerie. Pour le reste, détruisez tout ce qui porte leur couleur.',
    ],
  },

  fin: {
    victoire: 'Le drapeau de Karsk flotte sur les quais de Port-Calmes. La station de pompage ronronne, intacte, et la première citerne de la brigade repart vers le nord avant la nuit. La lieutenante Szell a remis les vannes en service elle-même ; le sergent Orin a dormi douze heures. Le colonel Brannik, lui, est resté longtemps sur le quai à regarder la mer qu’on transforme en eau. Il a dit : « Maintenant, il va falloir la partager. » Personne n’a su s’il parlait aux siens ou à lui-même.',
    defaite: 'L’assaut sur Port-Calmes a échoué. Halden tient les quais, et la brigade reflue vers les collines en laissant ses épaves dans la brume. À Karsk, on rationnera encore l’été prochain. Quelque part sur une terrasse de l’usine, Inès Varga signe le rapport d’une main sûre : « Contrat rempli. »',
  },

  // Réserves Halden relevées (1500 -> 2500) : l'IA dépensait tout en bâtiments dans la
  // première minute et ne pouvait plus reconstituer d'armée après sa première sortie.
  reserves: { J: 2000, I: 2500 },
  popMax: 60,
  pouvoirs: true,
  ia: { construit: true, revenu: 1.1, vagues: { premiere: 420, taille: 8, croissance: 2, intervalle: 180 }, cible: { x: 1580, y: 300 } },
  musique: 'tension',

  // ------------------------------------------------------------------
  //  DÉPART
  // ------------------------------------------------------------------
  depart: {
    J: [
      { type: 'qg', c: 38, r: 4 },
      { type: 'caserne', c: 32, r: 5 },
      { type: 'usine', c: 43, r: 4 },
      { type: 'depot', c: 36, r: 10 },
      // L'armée se tient à plus de 550 m de toute installation Halden : au-delà, leur garnison ne réagit pas.
      // Départ remonté de 100 m après essai : à y 540, la moindre dispersion du groupe (60 m de marge)
      // suffisait à faire sortir toute leur garnison dès les premières secondes.
      { type: 'conscrit', x: 1600, y: 430, nb: 12 },
      { type: 'ours', x: 1880, y: 400, nb: 3 },
      { type: 'grele', x: 1280, y: 390, nb: 2 },
      { type: 'sentinelle', x: 1800, y: 470, nb: 2 },
      { type: 'sapeur', x: 1600, y: 340, nb: 5 },
    ],
    I: [
      // Cœur de la base
      { type: 'qg', c: 39, r: 31, nom: 'qg_halden' },
      { type: 'usine', c: 44, r: 33 },
      // Seconde usine posée d'avance (passe 3 du moteur) : l'IA la bâtissait elle-même vers 1 min,
      // et l'évitement de ses unités la repoussait jusqu'au passage central (1460, 1020), à moins
      // de 550 m de l'armée Karsk immobile : sa défense en bloc sortait et déclenchait la sortie
      // de la garnison contre un joueur qui n'avait encore rien fait. Son plan de construction
      // étant ainsi complet, elle ne bâtit plus que pour remplacer un bâtiment détruit.
      { type: 'usine', c: 45, r: 37 },
      { type: 'caserne', c: 33, r: 32 },
      { type: 'caserne', c: 48, r: 31 },
      { type: 'relais', c: 41, r: 28 },
      { type: 'relais', c: 52, r: 36 },
      // Radar du phare (objectif facultatif)
      { type: 'relais', c: 72, r: 39, nom: 'radar_phare' },
      // Tourelles : passage central, passage ouest, passage est, quais
      { type: 'tourelle', c: 36, r: 28 }, { type: 'tourelle', c: 43, r: 28 },
      { type: 'tourelle', c: 11, r: 30 }, { type: 'tourelle', c: 18, r: 31 },
      { type: 'tourelle', c: 64, r: 29 }, { type: 'tourelle', c: 70, r: 29 },
      { type: 'tourelle', c: 52, r: 40 },
      // Défenses fixes du cœur de la base, ajoutées après essai : les unités Halden sortent
      // toutes à la rencontre de l'armée Karsk (comportement du moteur) ; une fois battues,
      // rien ne protégeait plus le QG, qui tombait en deux minutes. La tourelle 34,36 couvre
      // la station : elle se prend à l'infanterie et aux Ours, pas aux Grêle.
      { type: 'tourelle', c: 38, r: 29 }, { type: 'tourelle', c: 47, r: 34 }, { type: 'tourelle', c: 34, r: 36 },
      // Garnison. Légèrement renforcée après essai (+1 tireur, +1 drone) : dans sa version
      // d'origine, dès qu'elle sortait, elle se faisait battre en rase campagne et le QG Halden
      // tombait vers 1 min 10. Avec 8 tireurs, 4 Lynx et 3 Bastion, elle rasait au contraire
      // la base Karsk en deux minutes : la marge est étroite.
      // Moteur de novembre 2026 : la garnison est étiquetée et sort EN BLOC sur ordre du script
      // (déclencheur « sortie_garnison »). Non étiquetée, chaque unité était tenue en laisse
      // (700 m de son poste) et sortait seule vers le carrefour : la garnison s'y faisait battre
      // par petits paquets, et l'armée de départ abattait le QG vers 1 min 20.
      // Passe 3 du moteur (défense en bloc) : l'étiquette reste utile. Non étiquetée, la garnison
      // défendrait désormais en bloc, mais seulement autour des bâtiments et dans sa laisse : elle
      // ne viendrait plus chasser l'armée Karsk du carrefour, ce qu'annonce la radio à 25 s.
      // Même chose pour la garde du QG : non étiquetée, elle serait enrôlée dès qu'une unité
      // Karsk approche d'une tourelle du passage central, et quitterait la cour.
      { type: 'operateur', x: 1720, y: 1490, nb: 7, nom: 'garnison' },
      { type: 'lynx', x: 2150, y: 1220, nb: 3, nom: 'garnison' },
      { type: 'bastion', x: 1480, y: 1210, nb: 2, nom: 'garnison' },
      { type: 'faucheur', x: 1720, y: 1260, nb: 3, nom: 'garnison' },
      { type: 'technicien', x: 1350, y: 1480, nb: 5 },
      // Garde rapprochée du QG (même révision) : elle ne sort pas avec la garnison, reste dans la
      // cour et n'intervient que sur ordre du script (déclencheur « garde_qg »).
      { type: 'bastion', x: 1600, y: 1440, nb: 2, nom: 'garde_qg' },
      { type: 'operateur', x: 1700, y: 1460, nb: 4, nom: 'garde_qg' },
    ],
    N: [
      { type: 'station', c: 37, r: 38, nom: 'station' },
    ],
  },

  // ------------------------------------------------------------------
  //  OBJECTIFS
  // ------------------------------------------------------------------
  objectifs: [
    { id: 'aneantir', type: 'detruireTout', camp: 'I',
      texte: 'Détruire toutes les installations Halden de Port-Calmes' },
    { id: 'station', type: 'proteger', nom: 'station',
      texte: 'La station de pompage de l’usine ne doit pas être détruite. Prudence avec le Marteau et les Grêle' },
    { id: 'salines', type: 'tenir', zone: { x: 1600, y: 760, r: 150 }, duree: 60, principal: false,
      texte: 'Tenir le carrefour des Salines pendant une minute' },
    { id: 'phare', type: 'detruire', nom: 'radar_phare', principal: false,
      texte: 'Abattre le radar du phare, qui couvre les quais' },
  ],

  // ------------------------------------------------------------------
  //  DÉCLENCHEURS
  // ------------------------------------------------------------------
  declencheurs: [
    { id: 'intro', quand: { temps: 1 }, faire: [
      { camera: { x: 1600, y: 500 } },
      { zone: { id: 'perimetre', x: 1520, y: 1560, r: 300, texte: 'Station de pompage : aucune artillerie', couleur: '#ffd27a' } },
      { zone: { id: 'z_salines', x: 1600, y: 760, r: 150, texte: 'Carrefour des Salines' } },
      { radio: { qui: 'Col. Brannik', texte: 'Port-Calmes. Je ne ferai pas de discours. Vous savez pourquoi nous sommes ici.' } },
      { radio: { qui: 'Lt Szell', texte: 'Le cercle jaune, c’est le périmètre de la station de pompage. Pas de Marteau, pas de salve de Grêle à l’intérieur. Le reste de la côte est à vous.' } },
      { radio: { qui: 'Sgt Orin', texte: 'Et s’ils se cachent derrière la station, mon colonel ?' } },
      { radio: { qui: 'Col. Brannik', texte: 'Alors vous irez les chercher à la baïonnette, sergent.' } },
    ] },
    { id: 'reconnaissance', quand: { temps: 25 }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Trois passages dans les collines : ouest par les Salines, centre par la grand-route, est par la vieille ville. Deux tourelles à chacun. Le centre mène droit à leur QG.' } },
      { radio: { qui: 'Lt Szell', texte: 'Au carrefour des Salines, une minute de présence et la brigade nous fera suivre des renforts. Attention : c’est à leur porte, comme le champ de minerai voisin. Toute leur garnison sortira pour nous en chasser. Choisissez votre moment.' } },
    ] },
    // Leur garnison sort en bloc dès que trois unités Karsk approchent du carrefour (passage
    // central), qu'une unité de la garnison est touchée, ou que leur QG est entamé. Elle charge
    // alors vers le carrefour, puis continue vers la base Karsk (comportement des unités lancées
    // par une action « attaque »). Depuis l'économie à collecteurs (novembre 2026), seuls les
    // collecteurs récoltent ; ils évitent les champs sous le feu d'une défense ennemie et ne vont
    // donc pas d'eux-mêmes au champ du carrefour : c'est le joueur qui choisit son moment.
    // Rayon ramené de 330 à 260 m (bord nord à y 560 au lieu de 490) : l'armée de départ (y 430)
    // n'avait qu'à se déployer de 60 m pour la déclencher sans le vouloir. Elle couvre toujours
    // entièrement la zone à tenir des Salines (centre 1600, 760, rayon 150).
    { id: 'sortie_garnison', quand: { un: [
        { zone: { x: 1600, y: 820, r: 260 }, camp: 'J', nombre: 3 },
        { pvSous: { nom: 'garnison', ratio: 0.8 } },
        { pvSous: { nom: 'qg_halden', ratio: 0.95 } } ] }, faire: [
      { attaque: { camp: 'I', nom: 'garnison', vers: { x: 1600, y: 700 } } },
      { radio: { qui: 'Sgt Orin', texte: 'Leur garnison sort par la grand-route ! Tout le monde près du dépôt et des bunkers : on les reçoit chez nous, pas chez eux.' } },
    ] },
    { id: 'varga_intro', quand: { temps: 45 }, faire: [
      { radio: { qui: 'Inès Varga (canal Halden intercepté)', texte: 'Toutes les unités : Karsk descend des collines. Tenez les passages. La station est hors cible, pour eux comme pour nous. Je veux ce contrat propre.' } },
      { radio: { qui: 'Oskar Lind (canal Halden intercepté)', texte: 'Pour info : c’est la même ingénieure que sur l’Escalle. Elle nous écoute sûrement. Bonjour, lieutenante.' } },
      { radio: { qui: 'Lt Szell', texte: 'Bonjour, Oskar.' } },
    ] },
    { id: 'conseil_ia', quand: { temps: 120 }, faire: [
      { radio: { qui: 'Col. Brannik', texte: 'Leur base produit sans arrêt. Plus vous attendez, plus elle grossit. Mais ne lancez pas tout d’un coup sans Sentinelles : leurs drones vont fondre sur les Grêle.' } },
    ] },

    // --- La station ---
    { id: 'station_70', quand: { pvSous: { nom: 'station', ratio: 0.7 } }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'La station est touchée ! Qui tire à côté ? Cessez l’artillerie près de l’usine !' } },
    ] },
    { id: 'station_40', quand: { pvSous: { nom: 'station', ratio: 0.4 } }, faire: [
      { radio: { qui: 'Col. Brannik', texte: 'La station tombe en morceaux. Encore un coup et nous aurons marché jusqu’ici pour une ruine. Plus un obus dans ce secteur !' } },
    ] },

    // --- L'Essaim ---
    { id: 'essaim_alerte', quand: { temps: 500 }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Pic d’activité sur leurs fréquences de drones. Ils préparent l’Essaim. Ne restez pas groupés au carrefour !' } },
    ] },
    { id: 'essaim', quand: { temps: 510 }, faire: [
      { musique: 'combat' },
      { pouvoir: { camp: 'I', cle: 'essaim', x: 1600, y: 760 } },
    ] },

    // --- Débarquement par la mer ---
    // À 9 min 50, ou dès que leur QG est entamé : sans cela, un joueur qui avait brisé la
    // sortie de leur garnison rasait la base en quatre minutes sans plus rien rencontrer.
    // Passe 3 du moteur : déclenché dès que leur QG est entamé (90 %, avec la garde) et non plus à
    // 50 %. Après une sortie de garnison battue chez nous, l'armée de départ et ses Grêle abattaient
    // le QG (3000 PV) en une quarantaine de secondes, vers 1 min 40 : à 50 %, les barges arrivaient
    // après sa chute.
    { id: 'debarquement_alerte', quand: { un: [ { temps: 590 }, { declencheur: 'garde_qg', delai: 0 } ] }, faire: [
      { radio: { qui: 'Sgt Orin', texte: 'Des barges sur les quais ! Ils débarquent des renforts par la mer !' } },
    ] },
    { id: 'debarquement', quand: { declencheur: 'debarquement_alerte', delai: 8 }, faire: [
      { renforts: { camp: 'I', unites: [{ type: 'lynx', nb: 3 }, { type: 'operateur', nb: 6 }, { type: 'bastion', nb: 2 }],
        depuis: { x: 2050, y: 1640 }, vers: { x: 1600, y: 700 }, ordre: 'attaqueDeplacement', nom: 'debarquement' } },
      { radio: { qui: 'Inès Varga (canal Halden intercepté)', texte: 'Détachement de la Sarne, débarquement terminé. Remontez vers leurs collines et frappez leur base.' } },
      { radio: { qui: 'Col. Brannik', texte: 'Les vainqueurs de la Sarne. Évidemment. Une garde au QG, tout de suite.' } },
    ] },

    // --- Objectifs facultatifs ---
    { id: 'salines_tenues', quand: { objectif: 'salines', etat: 'reussi' }, faire: [
      { zoneRetirer: 'z_salines' },
      { radio: { qui: 'Lt Szell', texte: 'Le carrefour est à nous. La brigade envoie deux Ours et une Grêle par la grand-route.' } },
      { renforts: { camp: 'J', unites: [{ type: 'ours', nb: 2 }, { type: 'grele', nb: 1 }], depuis: { x: 1680, y: 40 }, vers: { x: 1600, y: 700 }, ordre: 'aller' } },
    ] },
    { id: 'phare_tombe', quand: { detruit: 'radar_phare' }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Radar du phare détruit. Leurs drones perdent les quais de vue, et l’état-major vous accorde des points de commandement.' } },
      { points: { camp: 'J', montant: 4 } },
    ] },

    // --- La chute du QG Halden ---
    { id: 'garde_qg', quand: { pvSous: { nom: 'qg_halden', ratio: 0.9 } }, faire: [
      { attaque: { camp: 'I', nom: 'garde_qg', vers: { x: 1620, y: 1150 } } },
      { radio: { qui: 'Inès Varga (canal Halden intercepté)', texte: 'Garde du quartier général, sortez dans la cour. Personne ne touche à ce bâtiment.' } },
    ] },
    { id: 'qg_touche', quand: { pvSous: { nom: 'qg_halden', ratio: 0.5 } }, faire: [
      { radio: { qui: 'Oskar Lind (canal Halden intercepté)', texte: 'Inès, leur infanterie est dans la cour. Je recommande d’évacuer les serveurs. Et moi avec, si possible.' } },
    ] },
    { id: 'qg_tombe', quand: { detruit: 'qg_halden' }, faire: [
      { musique: 'combat' },
      { radio: { qui: 'Inès Varga (canal Halden intercepté)', texte: 'Le quartier général est perdu. Toutes les unités : repli sur les quais. Ne touchez pas à la station. C’est un ordre, pas une suggestion.' } },
      { radio: { qui: 'Col. Brannik', texte: 'Au moins sommes-nous d’accord sur une chose. Finissez-les.' } },
    ] },
    { id: 'fin', quand: { objectif: 'aneantir', etat: 'reussi' }, faire: [
      { musique: 'calme' },
      // Le dernier bâtiment est souvent le radar du phare : sa réplique (près de 7 s) passe à
      // l'antenne. 5 s de répit la laissent presque finir (le moteur, à la victoire, retire les
      // messages en file et coupe celui qui est affiché au plus 2 s plus tard), puis le colonel
      // conclut et le débriefing suit sa réplique.
      // Essai de novembre 2026 : avec 5 s, la réplique du radar (6,7 s à l'antenne) était encore
      // coupée d'une demi-seconde ; 7 s la laissent finir.
      { attendre: 7 },
      { radio: { qui: 'Col. Brannik', texte: 'Port-Calmes est à nous. Szell, ouvrez les vannes.' } },
      { victoire: true },
    ] },
  ],
});
