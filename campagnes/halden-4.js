'use strict';
/* =====================================================================
   FRONT DE SEL — Campagne Halden « Le contrat de Varenne »
   Mission 4 : « Port-Calmes »
   Mission finale, exigeante. Base complète contre une armée Karsk
   retranchée autour de l'usine de dessalement. La station de pompage
   de l'usine (camp N) ne doit pas être détruite — y compris par nos
   propres frappes. Victoire : détruire toutes les forces Karsk.
   Données pures : aucune fonction, lues par le moteur (jeu.js).
   ===================================================================== */

enregistrerMission({
  id: 'halden-4', campagne: 'halden', numero: 4,
  titre: 'Port-Calmes',
  lieu: 'Port-Calmes, usine de dessalement',
  date: '2 juin 2034',

  // -------------------------------------------------------------------
  //  CARTE : la ville portuaire vue depuis l'ouest. L'usine et ses quais
  //  au centre-sud, la ville et la raffinerie à l'est, la base Karsk sur
  //  les hauteurs du nord-est. Deux crêtes ouvrent trois approches vers
  //  l'usine : le nord (batterie), le centre et la corniche du sud.
  // -------------------------------------------------------------------
  carte: {
    id: 'portCalmesSud', nom: 'Port-Calmes, les quais',
    graine: 20346,
    ambiance: 'crepuscule',
    cote: { base: 1800, ondes: [[90, 420, 0.4], [40, 130, 2.0]] },
    rivieres: [],
    ponts: [],
    cretes: [
      [900, 250, 1100, 850, 7],      // crête nord-ouest
      [900, 1250, 1150, 1550, 4],    // crête de la corniche
      [2000, 650, 2150, 1000, 4],    // rebord des hauteurs Karsk
    ],
    rochers: 35,
    bosquets: [
      { x: 500, y: 480, r: 120 },
      { x: 600, y: 1480, r: 100 },
      { x: 1300, y: 300, r: 100 },
      { x: 2900, y: 950, r: 120 },
      { x: 2250, y: 880, r: 80 },
    ],
    routes: [
      [[0, 1000], [500, 1020], [1000, 1060], [1400, 1100], [1600, 1250], [1600, 1430]],    // route de l'ouest jusqu'à l'usine
      [[1600, 1250], [2000, 1200], [2250, 1180], [2700, 1250], [3200, 1300]],              // route de la ville
      [[2250, 1180], [2350, 800], [2500, 520], [2600, 420]],                               // montée vers les hauteurs
      [[0, 140], [800, 120], [1600, 200], [2300, 260], [2560, 330]],                       // route du nord
    ],
    noeuds: [
      [350, 650, 3000], [300, 1250, 3000], [700, 850, 2500], [720, 1250, 2500], [200, 330, 3000],      // base Halden
      [1300, 1000, 3000], [1250, 620, 2500], [1950, 1350, 3000],                     // centre
      [2900, 450, 3000], [3000, 720, 3000], [2420, 1000, 3000], [2650, 1080, 2500],  // hauteurs Karsk et ville
    ],
    structures: [
      { type: 'usine_dessal', x: 1450, y: 1440, l: 300, h: 150, nom: 'Usine de dessalement' },
      { type: 'port', x: 1800, y: 1560, l: 300, h: 240, nom: 'Quais' },
      { type: 'village', x: 2250, y: 1300, l: 380, h: 200, nom: 'Port-Calmes' },
      { type: 'raffinerie', x: 2800, y: 1380, l: 220, h: 150, nom: 'Raffinerie' },
      { type: 'phare', x: 220, y: 1690, l: 80, h: 80, nom: 'Phare de la Pointe' },
    ],
    bases: { J: { c: 6, r: 20 }, I: { c: 64, r: 7 } },
  },

  joueur: 'halden', adversaire: 'karsk',

  briefing: {
    intervenant: 'Inès Varga, directrice des opérations',
    texte: [
      'Nous y sommes. Après la Sarne, le colonel Brannik a jeté tout ce qui lui restait sur Port-Calmes. Son armée s’est retranchée autour de l’usine de dessalement, la plus grande de la côte. Sa base est sur les hauteurs, au nord-est de la ville.',
      'Les antennes sont réparées : vous avez de nouveau vos Faucheur, et toute la gamme. Vous avez aussi la base la plus chère de l’histoire du Groupe. Ne me faites pas regretter le devis.',
      'Une règle, une seule : la station de pompage de l’usine ne doit pas tomber. Sans elle, l’usine ne sert à rien, ni à eux ni à nous. Et une frappe ne fait pas la différence entre un bunker et une pompe. Vous non plus, si vous visez mal.',
      'Objectif : détruire toutes les forces Karsk à Port-Calmes. Le contrat de Varenne se termine ce soir, d’une manière ou d’une autre.',
    ],
  },
  fin: {
    victoire: 'À minuit, le dernier char Karsk se rend sur la route du nord. La station de pompage tourne, le port se rallume, et Port-Calmes boit. Le colonel Brannik repart à pied vers la frontière avec ses hommes, gourdes vides. Inès Varga signe le procès-verbal de fin de contrat, puis le suivant : le gouvernement de Varenne renouvelle pour dix ans. Personne ne demande encore à quel prix.',
    defaite: 'Port-Calmes est perdu. Le Groupe Halden rapatrie ce qui peut l’être, et le gouvernement de Varenne découvre que les contrats ont des clauses de sortie. L’eau coulera désormais vers le nord.',
  },

  reserves: { J: 3000, I: 1200 },
  popMax: 70,
  pouvoirs: { J: true, I: false },   // le Marteau Karsk est scénarisé loin de la station (déclencheur marteauAnnonce)
  relations: {},
  ia: { construit: true, revenu: 0.65, vagues: { premiere: 420, taille: 6, croissance: 2, intervalle: 180 }, cible: null },
  musique: 'tension',

  // -------------------------------------------------------------------
  //  FORCES DE DÉPART
  // -------------------------------------------------------------------
  depart: {
    J: [
      { type: 'qg', c: 6, r: 20, nom: 'qg' },
      { type: 'caserne', c: 12, r: 16 },
      { type: 'relais', c: 10, r: 27 },
      // 8 techniciens : nombre fixé quand les ouvriers récoltaient encore. Depuis l'économie à
      // collecteurs (novembre 2026), ils ne font plus que bâtir et réparer ; le revenu vient des
      // deux collecteurs ajoutés par le moteur au lancement.
      { type: 'technicien', x: 380, y: 980, nb: 8 },
      { type: 'operateur', x: 680, y: 1060, nb: 6, nom: 'avantGarde' },
      { type: 'lynx', x: 780, y: 960, nb: 3, nom: 'avantGarde' },
      { type: 'bastion', x: 600, y: 900, nb: 2, nom: 'avantGarde' },
    ],
    I: [
      // Base des hauteurs
      { type: 'qg', c: 64, r: 7 },
      { type: 'caserne', c: 58, r: 8 },
      { type: 'usine', c: 66, r: 13 },
      { type: 'depot', c: 60, r: 14 },
      { type: 'sapeur', x: 2500, y: 480, nb: 5 },
      // Deux bunkers sur la montée (ajoutés avec le moteur « défenseurs en laisse ») : les
      // défenseurs ne volent plus au secours de la base depuis loin, et elle pouvait tomber en une
      // minute. Une garde d'infanterie en plus rendait la fin trop inégale (essais à 12 et 23+ min).
      { type: 'bunker', c: 57, r: 12, nom: 'gardeHauteurs' },
      { type: 'bunker', c: 62, r: 17, nom: 'gardeHauteurs' },
      // Retranchement de l'usine
      { type: 'depot', c: 33, r: 31, nom: 'retranchement' },
      { type: 'bunker', c: 35, r: 28, nom: 'retranchement' },
      { type: 'bunker', c: 42, r: 30, nom: 'retranchement' },
      { type: 'bunker', c: 44, r: 34, nom: 'retranchement' },
      { type: 'ours', x: 1680, y: 1140, nb: 2, nom: 'garnisonUsine' },
      { type: 'conscrit', x: 1480, y: 1150, nb: 6, nom: 'garnisonUsine' },
      { type: 'grele', x: 1820, y: 1060, nb: 1, nom: 'garnisonUsine' },
      { type: 'sentinelle', x: 1580, y: 1040, nb: 1, nom: 'garnisonUsine' },
      // Batterie du nord
      { type: 'bunker', c: 41, r: 15, nom: 'batterieNord' },
      { type: 'grele', x: 1600, y: 520, nb: 2, nom: 'batterieNord' },
    ],
    N: [
      { type: 'station', c: 38, r: 33, nom: 'stationUsine' },
    ],
  },

  // -------------------------------------------------------------------
  //  OBJECTIFS
  // -------------------------------------------------------------------
  objectifs: [
    { id: 'karsk', type: 'detruireTout', camp: 'I',
      texte: 'Détruire toutes les forces Karsk à Port-Calmes.' },
    { id: 'station', type: 'proteger', nom: 'stationUsine',
      texte: 'La station de pompage de l’usine ne doit pas être détruite (attention à vos propres frappes).' },
    { id: 'batterie', type: 'detruire', nom: 'batterieNord', principal: false,
      texte: 'Faire taire la batterie Grêle du nord.' },
    { id: 'retranchement', type: 'detruire', nom: 'retranchement', principal: false,
      texte: 'Briser le retranchement autour de l’usine.' },
  ],

  // -------------------------------------------------------------------
  //  DÉCLENCHEURS
  // -------------------------------------------------------------------
  declencheurs: [
    // --- Ouverture ---
    { id: 'intro', quand: { temps: 2 }, faire: [
      { zone: { id: 'zUsine', x: 1600, y: 1300, r: 260, texte: 'Usine de dessalement' } },
      { radio: { qui: 'Inès Varga', texte: 'Varga. Dernier acte, commandant. Tout le monde nous regarde : Varenne, la Régie, nos actionnaires et le Nord.' } },
      { radio: { qui: 'Oskar Lind', texte: 'Brannik est là en personne. Sa base est sur les hauteurs du nord-est, et son meilleur bataillon autour de l’usine.' } },
      { radio: { qui: 'Noor Salem', texte: 'Salem. Trois chemins vers l’usine : le nord, le centre entre les crêtes, et la corniche au sud. Aucun n’est gratuit.' } },
    ] },
    { id: 'aramont', quand: { temps: 45 }, faire: [
      { radio: { qui: 'Lucie Aramont', texte: 'Ici Lucie Aramont, maire de Sorbe, sur toutes les fréquences. Quel que soit le vainqueur ce soir, cette usine abreuve nos deux rives.' } },
      { radio: { qui: 'Lucie Aramont', texte: 'Je vous en prie. Battez-vous si vous y tenez. Mais ne brûlez pas l’eau.' } },
      { radio: { qui: 'Inès Varga', texte: 'Elle a raison, et c’est contractuel. Pas d’Essaim, pas de frappe près de la station.' } },
    ] },
    { id: 'batterieSignal', quand: { temps: 90 }, faire: [
      { zone: { id: 'zBatterie', x: 1640, y: 560, r: 180, texte: 'Batterie du nord' } },
      { radio: { qui: 'Oskar Lind', texte: 'Deux Grêle et un bunker au nord, derrière la crête. Ils couvrent l’approche centrale. Les faire taire nous simplifierait la vie.' } },
    ] },

    // --- Batterie et retranchement ---
    { id: 'batterieTombee', quand: { objectif: 'batterie', etat: 'reussi' }, faire: [
      { zoneRetirer: 'zBatterie' },
      { points: { camp: 'J', montant: 5 } },
      { radio: { qui: 'Noor Salem', texte: 'Batterie détruite. Le ciel du centre est à nous.' } },
      { radio: { qui: 'Oskar Lind', texte: 'Et cinq points de commandement de mieux. À dépenser loin de la station, merci.' } },
    ] },
    { id: 'approcheUsine', quand: { zone: { x: 1600, y: 1250, r: 380 }, camp: 'J', nombre: 4 }, faire: [
      { musique: 'combat' },
      { radio: { qui: 'Noor Salem', texte: 'On est au contact du retranchement. Visez les bunkers un par un, et gardez les Bastion devant.' } },
    ] },
    { id: 'retranchementBrise', quand: { objectif: 'retranchement', etat: 'reussi' }, faire: [
      { zoneRetirer: 'zUsine' },
      { reserves: { camp: 'J', montant: 1000 } },
      { radio: { qui: 'Inès Varga', texte: 'Le retranchement est brisé. La Régie débloque mille de crédit. Elle commence à croire qu’on va gagner.' } },
    ] },

    // --- La station en danger ---
    { id: 'stationTouchee', quand: { pvSous: { nom: 'stationUsine', ratio: 0.75 } }, faire: [
      { radio: { qui: 'Joël Mercadier', texte: 'Mercadier, à la station ! Oui, encore moi, j’ai demandé ma mutation. La station prend des éclats, arrêtez de tirer par ici !' } },
    ] },
    { id: 'stationCritique', quand: { pvSous: { nom: 'stationUsine', ratio: 0.4 } }, faire: [
      { radio: { qui: 'Inès Varga', texte: 'La station est à quarante pour cent. Si elle tombe, nous avons perdu, même avec la ville. Éloignez le combat.' } },
    ] },

    // Cause précise sur l'écran de fin (évalué avant le contrôle de défaite automatique).
    { id: 'stationPerdue', quand: { objectif: 'station', etat: 'echoue' }, faire: [
      { defaite: 'La station de pompage de l’usine est détruite.' },
    ] },

    // --- Le Marteau sur le centre ---
    { id: 'marteauAnnonce', quand: { temps: 480 }, faire: [
      { radio: { qui: 'Oskar Lind', texte: 'Signature d’artillerie lourde ! Le Marteau, entre les crêtes, au centre. Dégagez le passage !' } },
      { attendre: 6 },
      { pouvoir: { camp: 'I', cle: 'marteau', x: 1000, y: 1060 } },
    ] },

    // --- La contre-attaque de Brannik ---
    { id: 'contreAttaque', quand: { un: [ { temps: 720 }, { objectif: 'retranchement', etat: 'reussi' } ] }, faire: [
      { radio: { qui: 'Interception Karsk', texte: 'Brannik à toutes les unités : « Nous ne repartirons pas les gourdes vides. Tout le monde en avant. »' } },
      { renforts: { camp: 'I', unites: [ { type: 'ours', nb: 2 }, { type: 'conscrit', nb: 8 }, { type: 'sentinelle', nb: 1 } ],
                    depuis: { x: 3150, y: 300 }, vers: { x: 400, y: 950 }, ordre: 'attaqueDeplacement', nom: 'contreAttaque' } },
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 6 }, { type: 'grele', nb: 1 } ],
                    depuis: { x: 3150, y: 1280 }, vers: { x: 400, y: 1250 }, ordre: 'attaqueDeplacement', nom: 'contreAttaque' } },
      { musique: 'combat' },
      { radio: { qui: 'Oskar Lind', texte: 'Deux colonnes : deux Ours par la route du nord, de l’infanterie par la ville. Toutes deux visent notre base.' } },
      { radio: { qui: 'Inès Varga', texte: 'Tenez la base. Une contre-attaque comme celle-là, c’est leur dernière. Après, ils n’ont plus rien.' } },
    ] },
    { id: 'contreAttaqueBrisee', quand: { detruit: 'contreAttaque' }, faire: [
      { points: { camp: 'J', montant: 6 } },
      { ia: { revenu: 0.4, vagues: null } },   // Karsk a jeté ses dernières réserves : sa production s'essouffle
      // Rallonge : sans elle, un joueur qui a beaucoup perdu reconstruisait pendant dix minutes avec le seul revenu des champs de minerai.
      { reserves: { camp: 'J', montant: 1500 } },
      { radio: { qui: 'Noor Salem', texte: 'Contre-attaque brisée. Ils n’ont plus de réserve. À nous d’aller chercher le reste sur les hauteurs.' } },
      { radio: { qui: 'Inès Varga', texte: 'Le gouvernement de Varenne vient de voter une rallonge : mille cinq cents. Dépensez-les avant qu’il ne change d’avis.' } },
    ] },
    { id: 'qgMenace', quand: { pvSous: { nom: 'qg', ratio: 0.5 } }, faire: [
      { radio: { qui: 'Inès Varga', texte: 'Le QG est à moitié détruit. Si vous le perdez, je perds mon poste. Puis vous le vôtre.' } },
    ] },

    // --- Fin de partie ---
    { id: 'hauteurs', quand: { zone: { x: 2560, y: 450, r: 350 }, camp: 'J', nombre: 5 }, faire: [
      { radio: { qui: 'Interception Karsk', texte: 'Lieutenante Szell : « Colonel, ils sont sur les hauteurs. » Brannik : « Alors nous tiendrons les hauteurs. »' } },
    ] },
    // Seulement s'il reste des unités Karsk : quand le dernier bâtiment tombe en dernier (cas le plus
    // courant), « les derniers blindés se replient » contredisait la victoire annoncée dans la seconde.
    { id: 'sansBase', quand: { tous: [ { campSansBatiment: 'I' }, { objectif: 'karsk', etat: 'actif' } ] }, faire: [
      { radio: { qui: 'Oskar Lind', texte: 'Plus un bâtiment Karsk debout. Les derniers blindés se replient vers la route du nord.' } },
    ] },
    { id: 'fin', quand: { objectif: 'karsk', etat: 'reussi' }, faire: [
      { musique: 'calme' },
      { radio: { qui: 'Inès Varga', texte: 'C’est fini. Port-Calmes est à Varenne. Contrat rempli, commandant. Allez dormir, la facture attendra demain.' } },
    ] },
  ],
});
