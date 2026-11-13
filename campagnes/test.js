'use strict';
/* =====================================================================
   FRONT DE SEL — mission de test du moteur (non incluse dans le HTML).
   Ouverture : front-de-sel.html?mission=test (le moteur charge alors ce
   fichier tout seul). Elle exerce chaque type d'objectif, chaque condition
   et chaque action, ainsi que les éléments de carte (rivière, ponts, bois,
   structures). Deux déclencheurs volontairement faux vérifient que le
   moteur les signale en console sans planter.

   Raccourcis de test :
   - aller au coin nord-est (3100, 120) avec une unité : victoire immédiate ;
   - aller au coin sud-ouest (120, 1900) : défaite immédiate.
   ===================================================================== */

enregistrerMission({
  id: 'test', campagne: 'test', numero: 1,
  titre: 'Banc d’essai', lieu: 'Terrain d’essai de la Régie', date: '1er janvier 2034',

  carte: {
    id: 'essai', nom: 'Terrain d’essai',
    graine: 77, ambiance: 'aube',
    cote: { base: 2050, ondes: [[40, 300, 0]] },
    rivieres: [ { points: [[0, 1100], [1200, 1150], [2000, 1050], [3200, 1120]], largeur: 70 } ],
    ponts: [
      { x: 1600, y: 1100, angle: 1.5708, longueur: 160, largeur: 60 },
      { x: 600, y: 1125, angle: 1.5708, longueur: 160, largeur: 60 },
    ],
    cretes: [ [2400, 300, 2600, 700, 6] ],
    rochers: 20,
    bosquets: [ { x: 900, y: 500, r: 110 }, { x: 2300, y: 1550, r: 90 } ],
    routes: [ [[300, 400], [600, 900], [1600, 1000], [1600, 1300], [2700, 1500]] ],
    noeuds: [ [480, 520, 3000], [700, 1500, 3000], [2700, 700, 3000], [2500, 1700, 3000] ],
    structures: [
      { type: 'village', x: 1800, y: 1400, l: 200, h: 140, nom: 'Village d’essai' },
      { type: 'phare', x: 2900, y: 1750, l: 80, h: 80 },
      { type: 'ferme', x: 300, y: 1700, l: 160, h: 120 },
      { type: 'ruines', x: 1300, y: 300, l: 160, h: 120 },
    ],
  },

  joueur: 'halden', adversaire: 'karsk',
  briefing: {
    intervenant: 'Banc d’essai du moteur',
    texte: [ 'Mission technique : elle vérifie objectifs, conditions et actions.', 'Coin nord-est : victoire. Coin sud-ouest : défaite.' ],
  },
  fin: { victoire: 'Essai réussi.', defaite: 'Essai échoué.' },
  reserves: { J: 1500, I: 800 }, popMax: 40, pouvoirs: true,
  autorises: { batiments: ['caserne', 'relais', 'tourelle'], unites: ['technicien', 'operateur'] },
  relations: { I_attaque_N: true },
  ia: { construit: false, revenu: 1, vagues: null, cible: null },
  musique: 'calme',

  depart: {
    J: [
      { type: 'qg', c: 6, r: 6 },
      { type: 'technicien', x: 420, y: 460, nb: 2, nom: 'techs' },
      { type: 'operateur', x: 500, y: 760, nb: 6, nom: 'escouade' },
      { type: 'lynx', x: 600, y: 800, nb: 2, ordre: { type: 'aller', x: 700, y: 850 } },
    ],
    I: [
      { type: 'qg', c: 66, r: 36 },
      { type: 'caserne', c: 60, r: 38, nom: 'avantPoste' },
      { type: 'conscrit', x: 1750, y: 1280, nb: 4, nom: 'eclaireurs' },
    ],
    N: [
      { type: 'station', c: 38, r: 16, nom: 'station' },
      { type: 'convoi', x: 300, y: 900, nb: 2, nom: 'convoi' },
      { type: 'inconnu', x: 100, y: 100 },                 // volontairement faux : avertissement attendu
    ],
  },

  objectifs: [
    { id: 'o_station', type: 'proteger', nom: 'station', texte: 'Protéger la station de pompage.' },
    { id: 'o_convoi', type: 'escorter', nom: 'convoi', zone: { x: 1650, y: 1330, r: 150 }, minimum: 1, texte: 'Escorter au moins un convoi au village.' },
    { id: 'o_caserne', type: 'construire', batiment: 'caserne', nombre: 1, texte: 'Construire une caserne.' },
    { id: 'o_eclaireurs', type: 'detruire', nom: 'eclaireurs', texte: 'Détruire les éclaireurs.' },
    { id: 'o_recolte', type: 'recolter', montant: 100, principal: false, texte: 'Récolter 100 de réserves.' },
    { id: 'o_pont', type: 'atteindre', zone: { x: 1600, y: 1100, r: 120 }, camp: 'J', nombre: 2, principal: false, texte: 'Amener deux unités sur le pont.' },
    { id: 'o_tenir', type: 'tenir', zone: { x: 1600, y: 1250, r: 150 }, duree: 20, cache: true, texte: 'Tenir la tête de pont 20 s.' },
    { id: 'o_bonus1', type: 'survivre', duree: 9999, principal: false, texte: 'Bonus réussi par action.' },
    { id: 'o_bonus2', type: 'survivre', duree: 9999, principal: false, texte: 'Bonus échoué par action.' },
  ],

  declencheurs: [
    { id: 'd_debut', quand: { temps: 0 }, faire: [
      { radio: { qui: 'Banc d’essai', texte: 'Début du test. Le convoi part vers le pont.' } },
      { zone: { id: 'zPont', x: 1600, y: 1100, r: 120, texte: 'Pont' } },
      { musique: 'calme' },
      { camera: { x: 600, y: 700 } },
      { deplacer: { nom: 'convoi', chemin: [ { x: 600, y: 920 }, { x: 1600, y: 1000 }, { x: 1600, y: 1200 }, [1650, 1330] ] } },
    ] },
    { id: 'd_attendre', quand: { temps: 1 }, faire: [
      { radio: { qui: 'Banc d’essai', texte: 'Message A, puis 4 s d’attente.' } },
      { attendre: 4 },
      { radio: { qui: 'Banc d’essai', texte: 'Message B après l’attente.' } },
      { objectif: { reussir: 'o_bonus1' } },
      { objectif: { echouer: 'o_bonus2' } },
    ] },
    { id: 'd_tous', quand: { tous: [ { temps: 5 }, { zone: { x: 1600, y: 1050, r: 400 }, camp: 'N', nom: 'convoi' } ] }, faire: [
      { radio: { qui: 'Banc d’essai', texte: 'Condition « tous » : le convoi approche du pont.' } },
    ] },
    { id: 'd_zone', quand: { zone: { x: 1600, y: 1100, r: 150 }, camp: 'J', nombre: 1 }, faire: [
      { objectif: { ajouter: { id: 'o_tenir' } } },
      { zoneRetirer: 'zPont' },
      { zone: { id: 'zTenir', x: 1600, y: 1250, r: 150, texte: 'Tête de pont', couleur: '#7dd3ff' } },
    ] },
    { id: 'd_detruit', quand: { detruit: 'eclaireurs' }, faire: [
      { reserves: { camp: 'J', montant: 200 } },
      { points: { camp: 'J', montant: 5 } },
      { radio: { qui: 'Banc d’essai', texte: 'Éclaireurs détruits : +200 réserves, +5 points.' } },
    ] },
    { id: 'd_pv', quand: { pvSous: { nom: 'station', ratio: 0.95 } }, faire: [
      { radio: { qui: 'Banc d’essai', texte: 'La station est touchée.' } },
    ] },
    { id: 'd_obj', quand: { objectif: 'o_caserne', etat: 'reussi' }, faire: [
      { deverrouiller: { batiments: ['usine'], unites: ['lynx', 'bastion'] } },
    ] },
    { id: 'd_construit', quand: { construit: { type: 'relais', nombre: 1 } }, faire: [
      { points: { camp: 'J', montant: 3 } },
      { radio: { qui: 'Banc d’essai', texte: 'Condition « construit » : relais terminé.' } },
    ] },
    { id: 'd_tenu', quand: { objectif: 'o_tenir', etat: 'reussi' }, faire: [
      { objectif: { ajouter: { id: 'o_survivre', type: 'survivre', duree: 30, texte: 'Survivre 30 s.' } } },
      { renforts: { camp: 'I', unites: [ { type: 'conscrit', nb: 4 }, { type: 'ours', nb: 1 } ], depuis: { x: 3150, y: 1300 },
                    vers: { x: 1600, y: 1250 }, ordre: 'attaqueDeplacement', nom: 'vague1' } },
      { ia: { vagues: { premiere: 10, taille: 2, croissance: 1, intervalle: 30 }, cible: { x: 1600, y: 1250 } } },
      { pouvoir: { camp: 'I', cle: 'renforts' } },
      { musique: 'tension' },
    ] },
    { id: 'd_delai', quand: { declencheur: 'd_tenu', delai: 8 }, faire: [
      { batiment: { camp: 'I', type: 'bunker', c: 50, r: 34, nom: 'bunkerTest' } },
      { attaque: { camp: 'I', nom: 'vague1', vers: { x: 1600, y: 1200 } } },
      { attaque: { camp: 'I', tous: true, vers: { x: 1600, y: 1200 } } },
    ] },
    { id: 'd_survie', quand: { objectif: 'o_survivre', etat: 'reussi' }, faire: [
      { objectif: { ajouter: { id: 'o_base', type: 'detruireTout', camp: 'I', texte: 'Détruire tous les bâtiments ennemis.' } } },
      { ia: { construit: true } },
      { musique: 'combat' },
    ] },
    { id: 'd_sansbat', quand: { campSansBatiment: 'I' }, faire: [ { radio: { qui: 'Banc d’essai', texte: 'Plus aucun bâtiment ennemi.' } } ] },
    { id: 'd_sansunite', quand: { un: [ { campSansUnite: 'I' }, { temps: 99999 } ] }, faire: [ { radio: { qui: 'Banc d’essai', texte: 'Plus aucune unité ennemie.' } } ] },
    { id: 'd_repete', repetable: true, quand: { zone: { x: 480, y: 520, r: 120 }, camp: 'J' }, faire: [
      { radio: { qui: 'Banc d’essai', texte: 'Déclencheur répétable : citerne nord.' } },
    ] },
    { id: 'd_victoire', quand: { zone: { x: 3100, y: 120, r: 90 }, camp: 'J' }, faire: [ { victoire: true } ] },
    { id: 'd_defaite', quand: { zone: { x: 120, y: 1900, r: 90 }, camp: 'J' }, faire: [ { defaite: 'Désertion constatée.' } ] },
    // Volontairement faux : le moteur doit avertir en console sans planter.
    { id: 'd_faux', quand: { inconnue: 1 }, faire: [ { bidule: 1 } ] },
    { id: 'd_faux2', quand: { temps: 2 }, faire: [ { renforts: { camp: 'X', unites: [] } }, { objectif: { reussir: 'absent' } }, { radio: {} } ] },
  ],
});
