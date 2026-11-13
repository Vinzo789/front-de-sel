'use strict';
/* =====================================================================
   FRONT DE SEL — Campagne Halden « Le contrat de Varenne »
   Mission 1 : « Premier contrat » — Cap Ferrand
   Mission d'apprentissage : la radio explique sélection, déplacement,
   attaque, récolte par les collecteurs, construction et pouvoirs.
   Données pures : aucune fonction, lues par le moteur (jeu.js).
   ===================================================================== */

enregistrerMission({
  id: 'halden-1', campagne: 'halden', numero: 1,
  titre: 'Premier contrat',
  lieu: 'Cap Ferrand, côte ouest de Varenne',
  date: '14 mai 2034',

  // -------------------------------------------------------------------
  //  CARTE : côte rocheuse. Un cap large au sud-ouest porte le phare ;
  //  une baie à l'est abrite la petite station de pompage. Au nord-est,
  //  un plateau fermé par deux crêtes cache l'avant-poste Karsk : on y
  //  entre par un col étroit (route) ou par l'est, le long de la crête.
  // -------------------------------------------------------------------
  carte: {
    id: 'capFerrand', nom: 'Cap Ferrand',
    graine: 51402,
    ambiance: 'midi',
    cote: { base: 1650, ondes: [[300, 380, -1.06], [35, 75, 0.7]] },
    rivieres: [],
    ponts: [],
    cretes: [
      [2150, 80, 2300, 560, 7],      // flanc ouest du plateau nord-est
      [2380, 850, 2900, 910, 6],     // flanc sud du plateau (le col est entre les deux)
      [1250, 240, 1400, 520, 4],     // éperon au nord de la route
    ],
    rochers: 30,
    bosquets: [
      { x: 420, y: 240, r: 110 },    // pinède du nord-ouest
      { x: 1100, y: 160, r: 100 },
      { x: 1750, y: 300, r: 95 },
      { x: 720, y: 1300, r: 80 },    // oliveraie du mas
      { x: 800, y: 1560, r: 85 },    // pins du cap
      { x: 1350, y: 1700, r: 60 },
    ],
    routes: [
      [[0, 760], [500, 780], [900, 860], [1400, 900], [1800, 980], [2000, 1010]],   // route côtière jusqu'à la station
      [[1800, 980], [2150, 860], [2340, 720], [2580, 570], [2760, 500]],             // montée vers le plateau, par le col
      [[900, 860], [980, 1250], [1050, 1600], [1010, 1760]],                          // chemin du phare
      [[2000, 1010], [2500, 1150], [3200, 1260]],                                     // route de l'est
    ],
    noeuds: [
      [560, 480, 2500], [900, 440, 2500], [600, 960, 2500],          // autour du futur QG
      [1500, 720, 3000], [1500, 1250, 3000], [1780, 1230, 2500],     // centre et baie
      [2550, 300, 2500], [2960, 640, 2000],                          // plateau Karsk
    ],
    structures: [
      { type: 'phare', x: 960, y: 1780, l: 80, h: 80, nom: 'Phare de Cap Ferrand' },
      { type: 'village', x: 1150, y: 1480, l: 200, h: 120, nom: 'Ferrand' },
      { type: 'ferme', x: 470, y: 1100, l: 160, h: 100, nom: 'Mas des Aiguiers' },
    ],
    bases: { J: { c: 17, r: 13 } },
  },

  joueur: 'halden', adversaire: 'karsk',

  briefing: {
    intervenant: 'Inès Varga, directrice des opérations',
    texte: [
      'Commandant, bienvenue au Groupe Halden. Votre premier contrat commence sur un caillou : Cap Ferrand, un phare, un hameau et une petite station de pompage qui alimente toute la côte ouest.',
      'Avant-hier, l’armée de Karsk a enfoncé notre poste-frontière du col de Brèche. Depuis, ses éclaireurs descendent vers la mer et reniflent nos installations. Ils ont monté un avant-poste sur le plateau, au nord-est du cap.',
      'Vous partez avec une escouade légère et sans base : la commandante adjointe Salem est avec vous. Rejoignez la station, protégez-la, puis nous vous enverrons de quoi vous installer. Ensuite, vous rasez l’avant-poste.',
      'Une dernière chose : la station appartient à la Régie des eaux, pas à nous. Ce qui casse, nous le payons.',
    ],
  },
  fin: {
    victoire: 'L’avant-poste du plateau n’est plus qu’un tas de béton. La station de Cap Ferrand pompe toujours, et l’ingénieur Mercadier a signé le procès-verbal sans trop râler. Oskar Lind a relevé sur les décombres des ordres datés du col de Brèche : Karsk ne teste pas la côte, il la prépare. Prochaine étape : Vallauris, où l’eau commence à manquer.',
    defaite: 'Cap Ferrand est perdu. La Régie suspend les paiements, et le conseil d’administration demande un rapport. Inès Varga vous demande de le rédiger vous-même.',
  },

  reserves: { J: 0, I: 0 },
  popMax: 30,
  pouvoirs: { J: true, I: false },   // mission d'apprentissage : pas de renforts Karsk par pouvoir
  autorises: { batiments: ['caserne'], unites: ['technicien', 'operateur'] },
  relations: { I_attaque_N: true },
  ia: { construit: false, revenu: 1, vagues: null, cible: null },
  musique: 'calme',

  // -------------------------------------------------------------------
  //  FORCES DE DÉPART
  // -------------------------------------------------------------------
  depart: {
    J: [
      { type: 'operateur', x: 240, y: 760, nb: 4, nom: 'escouade' },
      { type: 'lynx', x: 320, y: 820, nb: 1, nom: 'escouade' },
    ],
    I: [
      { type: 'caserne', c: 66, r: 10, nom: 'avantPoste' },
      { type: 'depot', c: 70, r: 7, nom: 'avantPoste' },
      { type: 'bunker', c: 63, r: 14, nom: 'avantPoste' },
      { type: 'bunker', c: 68, r: 15, nom: 'avantPoste' },
      { type: 'conscrit', x: 2780, y: 560, nb: 5, nom: 'garnison' },
    ],
    N: [
      { type: 'station', c: 52, r: 26, nom: 'station' },
    ],
  },

  // -------------------------------------------------------------------
  //  OBJECTIFS
  // -------------------------------------------------------------------
  objectifs: [
    { id: 'station', type: 'proteger', nom: 'station',
      texte: 'La station de pompage de Cap Ferrand doit rester debout.' },
    { id: 'rejoindre', type: 'atteindre', zone: { x: 2000, y: 1130, r: 170 }, camp: 'J', nombre: 3, principal: false,
      texte: 'Rejoindre la station de pompage, au bout de la route côtière.' },
    { id: 'avantPoste', type: 'detruire', nom: 'avantPoste',
      texte: 'Détruire l’avant-poste Karsk du plateau nord-est.' },
  ],

  // -------------------------------------------------------------------
  //  DÉCLENCHEURS
  // -------------------------------------------------------------------
  declencheurs: [
    // --- Mise en route : sélection et déplacement ---
    { id: 'intro', quand: { temps: 2 }, faire: [
      { zone: { id: 'zStation', x: 2000, y: 1130, r: 170, texte: 'Station de Cap Ferrand' } },
      { radio: { qui: 'Inès Varga', texte: 'Ici Varga. Commandant, vous êtes sur le terrain. On commence par les bases, je n’aime pas les surprises.' } },
      { radio: { qui: 'Inès Varga', texte: 'Clic gauche sur une unité pour la sélectionner. Pour en prendre plusieurs, maintenez le bouton et tracez un cadre autour d’elles.' } },
      { radio: { qui: 'Inès Varga', texte: 'Ensuite, clic droit sur le terrain : la sélection s’y rend. Suivez la route côtière jusqu’à la station, à l’est.' } },
      { radio: { qui: 'Noor Salem', texte: 'Salem. Escouade prête. Quatre opérateurs, un Lynx et un soleil de plomb.' } },
    ] },
    // Juste après l'introduction (environ 26 s de radio), avant les éclaireurs.
    { id: 'aideCamera', quand: { temps: 24 }, faire: [
      { radio: { qui: 'Inès Varga', texte: 'Astuce : les flèches ou le bord de l’écran déplacent la vue, la molette zoome. La minicarte, en bas, sert aussi à se déplacer.' } },
    ] },

    // --- Arrivée à la station (ou retard) : les éclaireurs ---
    { id: 'eclaireurs', quand: { un: [ { objectif: 'rejoindre', etat: 'reussi' }, { temps: 150 } ] }, faire: [
      { radio: { qui: 'Joël Mercadier', texte: 'Mercadier, ingénieur de la Régie. Vous êtes la sécurité ? On m’avait promis un bataillon.' } },
      { radio: { qui: 'Noor Salem', texte: 'Vous avez cinq soldats et moi, monsieur Mercadier. Ça devrait suffire.' } },
      { musique: 'tension' },
      { radio: { qui: 'Oskar Lind', texte: 'Lind, renseignement. Cinq fantassins Karsk sur la route de l’est. Ils cherchent la station, pas le dialogue.' } },
      { radio: { qui: 'Inès Varga', texte: 'Vos unités tirent seules dès qu’un ennemi est à portée. Clic droit sur un ennemi pour concentrer le feu sur lui.' } },
      { radio: { qui: 'Inès Varga', texte: 'Autre ordre utile : touche A puis clic au sol. L’escouade avance et engage tout ce qu’elle croise. S pour arrêter.' } },
      // Les éclaireurs n'apparaissent qu'une fois les conseils de combat lus (sinon le combat est fini avant la leçon).
      { attendre: 24 },
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 5 } ], depuis: { x: 3150, y: 1240 }, vers: { x: 2060, y: 1120 },
                    ordre: 'attaqueDeplacement', nom: 'eclaireurs' } },
      { objectif: { ajouter: { id: 'eclaireurs', type: 'detruire', nom: 'eclaireurs',
                               texte: 'Repousser les éclaireurs Karsk venus de la route de l’est.' } } },
    ] },
    { id: 'contact', quand: { zone: { x: 2150, y: 1150, r: 330 }, camp: 'I', nom: 'eclaireurs' }, faire: [
      { musique: 'combat' },
      { radio: { qui: 'Noor Salem', texte: 'Contact ! Visez celui qui tire sur les pompes.' } },
    ] },
    { id: 'alerteStation', quand: { pvSous: { nom: 'station', ratio: 0.7 } }, faire: [
      { radio: { qui: 'Joël Mercadier', texte: 'Ils tirent sur mes pompes ! Une pompe, ça ne se commande pas sur catalogue, vous savez !' } },
    ] },

    // Cause précise sur l'écran de fin (évalué avant le contrôle de défaite automatique).
    { id: 'stationPerdue', quand: { objectif: 'station', etat: 'echoue' }, faire: [
      { defaite: 'La station de pompage de Cap Ferrand est détruite.' },
    ] },

    // --- Installation : QG (le moteur y ajoute deux collecteurs), récolte, caserne ---
    { id: 'installation', quand: { objectif: 'eclaireurs', etat: 'reussi' }, faire: [
      { musique: 'calme' },
      { zoneRetirer: 'zStation' },
      { radio: { qui: 'Inès Varga', texte: 'Propre. Le QG modulaire est largué au nord-ouest, avec deux collecteurs et trois techniciens. Voilà votre base, commandant.' } },
      { batiment: { camp: 'J', type: 'qg', c: 17, r: 13, fini: true, nom: 'qg' } },
      { renforts: { camp: 'J', unites: [ { type: 'technicien', nb: 3 } ], depuis: { x: 40, y: 740 }, vers: { x: 740, y: 700 }, ordre: 'aller', nom: 'techniciens' } },
      { reserves: { camp: 'J', montant: 600 } },
      { camera: { x: 740, y: 640 } },
      { radio: { qui: 'Inès Varga', texte: 'Les champs de minerai font nos réserves. Les collecteurs y vont seuls et rapportent au QG ; clic droit sur un autre champ pour les y envoyer.' } },
      { radio: { qui: 'Inès Varga', texte: 'Les techniciens, eux, bâtissent et réparent. Choisissez la caserne dans la barre de construction, puis cliquez sur un terrain libre près du QG.' } },
      { objectif: { ajouter: { id: 'caserne', type: 'construire', batiment: 'caserne', nombre: 1,
                               texte: 'Construire une caserne près du QG.' } } },
      { objectif: { ajouter: { id: 'recolte', type: 'recolter', montant: 400, principal: false,
                               texte: 'Récolter 400 de réserves.' } } },
    ] },
    { id: 'recolteFaite', quand: { objectif: 'recolte', etat: 'reussi' }, faire: [
      { radio: { qui: 'Inès Varga', texte: 'Quatre cents. Le conseil d’administration adore les chiffres ronds. Continuez.' } },
    ] },

    // --- La caserne : production et cap sur l'avant-poste ---
    { id: 'caserneFaite', quand: { construit: { type: 'caserne', nombre: 1 } }, faire: [
      { objectif: { reussir: 'caserne' } },
      { deverrouiller: { batiments: ['relais', 'tourelle'] } },
      { radio: { qui: 'Inès Varga', texte: 'Caserne opérationnelle. Sélectionnez-la et formez des opérateurs. Clic droit au sol, caserne sélectionnée : point de ralliement.' } },
      { radio: { qui: 'Inès Varga', texte: 'Vous pouvez aussi bâtir une antenne relais : nos unités font plus mal dans son réseau. Et des tourelles, pour garder la base.' } },
      { renforts: { camp: 'J', unites: [ { type: 'lynx', nb: 2 } ], depuis: { x: 40, y: 760 }, vers: { x: 900, y: 820 }, ordre: 'aller', nom: 'lynxRenfort' } },
      { radio: { qui: 'Inès Varga', texte: 'Et la direction vous prête deux Lynx de plus. Prêtés, commandant. Rendez-les entiers.' } },
      { zone: { id: 'zAvant', x: 2700, y: 470, r: 260, texte: 'Avant-poste Karsk' } },
      { radio: { qui: 'Oskar Lind', texte: 'L’avant-poste est sur le plateau : une caserne, un dépôt, deux bunkers. On y monte par le col de la route ou par l’est.' } },
      { radio: { qui: 'Oskar Lind', texte: 'Les bunkers tirent loin et encaissent. Je conseille d’y aller à huit ou dix. Je conseille beaucoup, c’est mon métier.' } },
      { radio: { qui: 'Noor Salem', texte: 'Et laissez deux ou trois fusils à la station. Karsk adore s’en prendre aux pompes quand on regarde ailleurs.' } },
    ] },
    // Suggestion du phare un peu plus tard : la radio de la caserne est déjà chargée.
    { id: 'conseilPhare', quand: { declencheur: 'caserneFaite', delai: 40 }, faire: [
      { objectif: { ajouter: { id: 'phare', type: 'atteindre', zone: { x: 1000, y: 1700, r: 130 }, camp: 'J', nombre: 1, principal: false,
                               texte: 'Poster un observateur au phare de Cap Ferrand.' } } },
      { radio: { qui: 'Oskar Lind', texte: 'Petite suggestion : un observateur au phare, au bout du cap, nous donnerait des angles de tir. Utile pour une frappe.' } },
    ] },
    { id: 'phareTenu', quand: { objectif: 'phare', etat: 'reussi' }, faire: [
      { points: { camp: 'J', montant: 6 } },
      { radio: { qui: 'Oskar Lind', texte: 'Observateur en place. Vous avez des points de commandement : la Frappe de précision est dans la barre des pouvoirs.' } },
      { radio: { qui: 'Inès Varga', texte: 'Choisissez la frappe, puis cliquez sur la cible. Un missile, une seconde de vol. Visez les bunkers, pas la station.' } },
    ] },

    // --- Harcèlement de la base ---
    { id: 'patrouille1', quand: { declencheur: 'caserneFaite', delai: 100 }, faire: [
      // Par le nord, loin de la station : cette patrouille vise la base, pas les pompes.
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 4 } ], depuis: { x: 1950, y: 60 }, vers: { x: 800, y: 640 },
                    ordre: 'attaqueDeplacement', nom: 'patrouille' } },
      { radio: { qui: 'Oskar Lind', texte: 'Patrouille Karsk en route vers votre base, par le nord. Quatre fantassins, peu motivés mais armés.' } },
    ] },
    { id: 'patrouille2', quand: { declencheur: 'patrouille1', delai: 160 }, faire: [
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 6 } ], depuis: { x: 3150, y: 1240 }, vers: { x: 2060, y: 1120 },
                    ordre: 'attaqueDeplacement', nom: 'patrouille' } },
      { radio: { qui: 'Oskar Lind', texte: 'Six autres par la route de l’est. Ils retournent à la station. Ils sont têtus, c’est une qualité nationale.' } },
      { radio: { qui: 'Joël Mercadier', texte: 'Ils reviennent ! Je ferme les vannes et je me cache sous le bureau. Faites vite.' } },
    ] },

    // --- Assaut de l'avant-poste ---
    { id: 'assaut', quand: { zone: { x: 2620, y: 560, r: 300 }, camp: 'J', nombre: 3 }, faire: [
      { musique: 'combat' },
      { radio: { qui: 'Noor Salem', texte: 'On est sur le plateau. Bunkers en vue. On attaque d’abord celui qui couvre le col.' } },
      { points: { camp: 'J', montant: 3 } },
      { radio: { qui: 'Inès Varga', texte: 'Je vous accorde trois points de commandement : de quoi tirer une Frappe de précision. Barre des pouvoirs, puis clic sur un bunker.' } },
    ] },
    { id: 'appelKarsk', quand: { pvSous: { nom: 'avantPoste', ratio: 0.75 } }, faire: [
      { radio: { qui: 'Oskar Lind', texte: 'Interception : l’avant-poste réclame du renfort au col de Brèche. Réponse du col : « Tenez. » Charmant.' } },
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 4 } ], depuis: { x: 3150, y: 260 }, vers: { x: 2760, y: 420 },
                    ordre: 'aller', nom: 'renfortsCol' } },
      { radio: { qui: 'Oskar Lind', texte: 'Quatre de plus arrivent du nord-est. Ils ont dû courir. Respect.' } },
    ] },
    // Victoire explicite, seconde réplique mise en file APRÈS la fin : le plafond du débriefing
    // (12 s après la dernière réplique entrée en file) repart d'elle. Avec les deux répliques en file
    // dès la fin, une consigne en cours (coupée 2 s plus tard) + 2 × 5 s dépassaient ce plafond et
    // tronquaient la réplique de Mercadier.
    { id: 'fin', quand: { objectif: 'avantPoste', etat: 'reussi' }, faire: [
      { musique: 'calme' },
      { radio: { qui: 'Inès Varga', texte: 'Avant-poste rasé. Beau travail, commandant. Vous venez de rembourser votre prime d’embauche.' } },
      { victoire: true },
      { attendre: 4 },
      { radio: { qui: 'Joël Mercadier', texte: 'La station tourne. Merci. Je vous enverrai la facture des vitres quand même.' } },
    ] },
  ],
});
