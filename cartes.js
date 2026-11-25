'use strict';
/* =====================================================================
   FRONT DE SEL — cartes d'escarmouche.
   Chaque carte est un objet de données pur (aucune fonction) : le moteur
   (jeu.js, section CARTE) en tire la grille de passage, les rochers, les
   rivières, les ponts, les bois et les structures neutres.
   Les cartes de mission sont écrites directement dans les fichiers
   campagnes/<id>.js, dans le même format.

   Format (rappel) :
   {
     id, nom, graine,                       // graine du tirage des rochers isolés
     ambiance: 'midi' | 'aube' | 'crepuscule' | 'brume',
     cote: { base, ondes: [[amplitude, periode, phase], ...] } | null,
                                            // mer au sud : y > base + Σ amplitude·sin(x/periode + phase)
     rivieres: [ { points: [[x,y], ...], largeur } ],
     ponts: [ { x, y, angle, longueur, largeur } ],
     cretes: [ [x0, y0, x1, y1, n] ],       // alignements de gros rochers
     rochers: n,                            // rochers isolés dispersés
     zoneRochers: { x, y, l, h },           // facultatif : rectangle de dispersion
                                            //   (défaut : toute la carte moins 150 px / 120 px de bord)
     margeRoutes: 70,                       // facultatif : distance minimale rochers isolés / routes (0 = aucune)
     zonesSansRochers: [ { x, y, l, h } ],  // facultatif : rectangles sans rochers isolés
     bosquets: [ { x, y, r } ],
     routes: [ [[x,y], ...] ],
     noeuds: [ [x, y, quantite] ],          // champs de minerai (cristaux de sel et de lithium), récoltés par les collecteurs
     structures: [ { type, x, y, l, h, nom? } ],
     description: '…',                      // facultatif : une phrase, affichée au choix de la carte
     bases: { J: { c, r }, I: { c, r } }    // QG d'escarmouche (coin haut-gauche, en tuiles)
       // ou bien une liste de quatre emplacements : [ {c, r}, {c, r}, {c, r}, {c, r} ].
       // Les emplacements 0 et 1 sont opposés (escarmouche à deux : le joueur au 0,
       // l'ordinateur au 1) ; 2 et 3 forment l'autre paire, réservée à un futur mode
       // à quatre camps. Chaque emplacement a ses champs de minerai et la place
       // de bâtir une base complète (aéroport de 4 × 4 compris).
   }
   La carte d'escarmouche se choisit à l'écran de l'escarmouche, ou par
   l'adresse : front-de-sel.html?carte=<id> (ex. ?carte=gorgesVarseche).
   ===================================================================== */

var CARTES = {};

// ---------------------------------------------------------------------
//  Port-Calmes : la carte d'origine du prototype.
//  Deux bases face à face, trois passages entre les crêtes, l'usine de
//  dessalement au sud sur la côte. Les valeurs reproduisent exactement la
//  carte générée par les versions précédentes (même graine, même ordre).
// ---------------------------------------------------------------------
CARTES.portCalmes = {
  id: 'portCalmes',
  nom: 'Port-Calmes',
  graine: 20341,
  ambiance: 'midi',
  cote: { base: 1890, ondes: [[60, 250, 0], [35, 90, 1.3]] },
  rivieres: [],
  ponts: [],
  // Ordre important : il fixe le tirage pseudo-aléatoire.
  cretes: [
    [1150, 40, 1080, 720, 10],
    [1100, 1130, 1160, 1480, 6],
    [2050, 40, 2120, 720, 10],
    [2100, 1130, 2040, 1480, 6],
  ],
  rochers: 26,
  zoneRochers: { x: 150, y: 120, l: 2900, h: 1650 },
  // La carte d'origine dégageait une bande horizontale autour de la route principale
  // (et non une marge autour de chaque route) : on la reproduit telle quelle.
  margeRoutes: 0,
  zonesSansRochers: [ { x: 0, y: 930, l: 3200, h: 140 } ],
  bosquets: [],
  routes: [
    [[0, 1020], [420, 1020], [900, 960], [1600, 1000], [2300, 960], [2780, 1020], [3200, 1020]],
    [[1600, 1000], [1600, 1650]],
  ],
  // Champs de minerai symétriques. Les deux paires du sud (1440/1760) sont volontairement
  // doublées : la carte d'origine les plaçait deux fois, ce qui double leur réserve
  // (deux champs superposés au même point).
  noeuds: [
    [230, 800, 3000],   [2970, 800, 3000],
    [250, 1230, 3000],  [2950, 1230, 3000],
    [620, 1270, 3000],  [2580, 1270, 3000],
    [850, 420, 2500],   [2350, 420, 2500],
    [850, 1600, 2500],  [2350, 1600, 2500],
    [1600, 560, 5000],
    [1600, 1220, 5000],
    [1440, 1500, 4000], [1760, 1500, 4000],
    [1760, 1500, 4000], [1440, 1500, 4000],
    // Ajoutés en novembre 2026 pour l'emplacement 2 (fond de la poche nord, entre les crêtes).
    [1340, 300, 4000],  [1860, 300, 4000],
  ],
  structures: [
    { type: 'usine_dessal', x: 1470, y: 1655, l: 260, h: 130, nom: 'Usine de dessalement de Port-Calmes' },
  ],
  // 0 ouest contre 1 est (le duel d'origine) ; 2 au fond de la poche nord et 3 dans la poche sud
  // (entre les crêtes, au-dessus de l'usine), ajoutés en novembre 2026 pour l'escarmouche à trois ou
  // quatre camps : les quatre bases forment un losange, chacune à 1 250-1 450 px de ses voisines
  // (0 et 1 restent à 2 360 px). Avant, 2 et 3 étaient au nord-ouest et au nord-est, à 720 px seulement
  // de 0 et de 1. La poche sud a les champs riches du centre ; la poche nord a reçu deux champs.
  bases: [ { c: 9, r: 24 }, { c: 68, r: 24 }, { c: 38, r: 3 }, { c: 38, r: 36 } ],
};

// ---------------------------------------------------------------------
//  Gorges de Varsèche : plateau désertique de l'arrière-pays, coupé du
//  nord au sud par un canyon que l'on ne franchit qu'à trois passages.
//  Tactique : tenir les cols ; le passage du centre mène aux champs riches.
//  Quatre bases aux coins, symétriques. Midi.
// ---------------------------------------------------------------------
CARTES.gorgesVarseche = {
  id: 'gorgesVarseche',
  nom: 'Gorges de Varsèche',
  description: 'Plateau désertique coupé par un canyon : trois cols à tenir, les champs riches au passage du centre.',
  graine: 41207,
  ambiance: 'midi',
  cote: null,
  rivieres: [],
  ponts: [],
  cretes: [
    // Parois du canyon (deux rangs), ouvertes aux cols nord (y 420), centre (y 1120) et sud (y 1820)
    [1570, -20, 1570, 250, 6],   [1630, -20, 1630, 250, 6],
    [1570, 590, 1570, 950, 8],   [1630, 590, 1630, 950, 8],
    [1570, 1290, 1570, 1650, 8], [1630, 1290, 1630, 1650, 8],
    [1570, 1990, 1570, 2260, 6], [1630, 1990, 1630, 2260, 6],
    // Mesas des bords ouest et est
    [120, 1060, 380, 1180, 4],   [3080, 1060, 2820, 1180, 4],
  ],
  rochers: 28,
  bosquets: [
    { x: 1000, y: 600, r: 60 }, { x: 2200, y: 600, r: 60 },     // oasis
    { x: 1000, y: 1640, r: 60 }, { x: 2200, y: 1640, r: 60 },
  ],
  routes: [
    [[460, 420], [1600, 420], [2740, 420]],
    [[460, 1820], [1600, 1820], [2740, 1820]],
    [[340, 500], [700, 880], [1300, 1120], [1900, 1120], [2500, 880], [2860, 500]],
    [[340, 1740], [700, 1360], [1300, 1120]],
    [[1900, 1120], [2500, 1360], [2860, 1740]],
  ],
  noeuds: [
    [720, 260, 3000],  [300, 720, 3000],     // nord-ouest
    [2480, 260, 3000], [2900, 720, 3000],    // nord-est
    [720, 1980, 3000], [300, 1520, 3000],    // sud-ouest
    [2480, 1980, 3000], [2900, 1520, 3000],  // sud-est
    [1250, 700, 3500], [1950, 700, 3500], [1250, 1540, 3500], [1950, 1540, 3500],
    [1390, 1120, 5000], [1810, 1120, 5000],  // de part et d'autre du col du centre
  ],
  structures: [
    { type: 'ruines', x: 800, y: 1060, l: 180, h: 110, nom: 'Ksar d’Azir' },
    { type: 'raffinerie', x: 2220, y: 1060, l: 180, h: 110, nom: 'Raffinerie de Sel-Haut' },
  ],
  // 0 nord-ouest contre 1 sud-est ; 2 nord-est contre 3 sud-ouest
  bases: [ { c: 7, r: 6 }, { c: 70, r: 46 }, { c: 70, r: 6 }, { c: 7, r: 46 } ],
};

// ---------------------------------------------------------------------
//  Delta de l'Ombrine : le fleuve arrive du nord et se jette dans la mer
//  par trois bras. Huit ponts, aucun gué. Tactique : tenir les ponts.
//  Bases : les deux rives (ouest, est) et les deux îles du delta. Aube.
// ---------------------------------------------------------------------
CARTES.deltaOmbrine = {
  id: 'deltaOmbrine',
  nom: 'Delta de l’Ombrine',
  description: 'Un fleuve à trois bras se jette dans la mer : huit ponts, aucun gué, chaque passage se défend.',
  graine: 52981,
  ambiance: 'aube',
  cote: { base: 2010, ondes: [[35, 310, 0.4], [20, 120, 2.1]] },
  rivieres: [
    { points: [[1600, -40], [1590, 420], [1600, 820]], largeur: 110 },                 // l'Ombrine
    { points: [[1600, 820], [1250, 1150], [900, 1550], [780, 2240]], largeur: 90 },    // bras de l'ouest
    { points: [[1600, 820], [1950, 1150], [2300, 1550], [2420, 2240]], largeur: 90 },  // bras de l'est
    { points: [[1600, 820], [1600, 1450], [1610, 2240]], largeur: 80 },                // bras du milieu
  ],
  ponts: [
    { x: 1594, y: 250, angle: 0, longueur: 190, largeur: 60 },
    { x: 1597, y: 620, angle: 0, longueur: 190, largeur: 80 },
    { x: 1425, y: 985, angle: 0.814, longueur: 180, largeur: 80 },
    { x: 1075, y: 1350, angle: 0.719, longueur: 180, largeur: 80 },
    { x: 1775, y: 985, angle: -0.814, longueur: 180, largeur: 80 },
    { x: 2125, y: 1350, angle: -0.719, longueur: 180, largeur: 80 },
    { x: 1600, y: 1150, angle: 0, longueur: 160, largeur: 60 },
    { x: 1604, y: 1800, angle: 0, longueur: 160, largeur: 60 },
  ],
  cretes: [],
  rochers: 14,
  bosquets: [
    { x: 1300, y: 420, r: 70 }, { x: 1900, y: 420, r: 70 },     // saules
    { x: 560, y: 1050, r: 90 }, { x: 2640, y: 1050, r: 90 },
    { x: 1000, y: 1000, r: 80 }, { x: 2200, y: 1000, r: 80 },
  ],
  routes: [
    [[460, 380], [1000, 330], [1594, 250], [2200, 330], [2740, 380]],
    [[340, 520], [900, 650], [1597, 620], [2300, 650], [2860, 520]],
    [[340, 520], [760, 900], [1075, 1350], [1140, 1620]],
    [[2860, 520], [2440, 900], [2125, 1350], [2060, 1620]],
    [[1075, 1350], [1600, 1150], [2125, 1350]],
    [[1240, 1740], [1604, 1800], [1960, 1740]],
  ],
  noeuds: [
    [720, 330, 3000], [330, 800, 3000],      // rive ouest
    [2480, 330, 3000], [2870, 800, 3000],    // rive est
    [1330, 1450, 3000], [1330, 1860, 3000],  // île ouest
    [1870, 1450, 3000], [1870, 1860, 3000],  // île est
    [1250, 780, 4000], [1950, 780, 4000],    // au confluent
    [700, 1500, 3500], [2500, 1500, 3500],   // basses terres
  ],
  structures: [
    { type: 'village', x: 380, y: 1250, l: 220, h: 130, nom: 'Ombrine' },
    { type: 'ferme', x: 2620, y: 1260, l: 160, h: 100, nom: 'Mas des Saulniers' },
    { type: 'phare', x: 200, y: 1840, l: 80, h: 80, nom: 'Feu de la Passe' },
  ],
  // 0 rive ouest contre 1 rive est ; 2 île ouest contre 3 île est
  bases: [ { c: 7, r: 8 }, { c: 70, r: 8 }, { c: 27, r: 42 }, { c: 50, r: 42 } ],
};

// ---------------------------------------------------------------------
//  Isthme de Cap-Morvent : deux presqu'îles au sud, l'étang de Morvent au
//  nord ; entre les deux, un isthme d'une dizaine de cases est le seul
//  passage entre l'ouest et l'est. Tactique : le tenir, ou le contourner
//  par les airs. Brume de mer.
// ---------------------------------------------------------------------
CARTES.capMorvent = {
  id: 'capMorvent',
  nom: 'Isthme de Cap-Morvent',
  description: 'Deux presqu’îles dans la brume, reliées par un isthme étroit : le seul passage terrestre entre l’ouest et l’est.',
  graine: 63119,
  ambiance: 'brume',
  cote: { base: 1800, ondes: [[560, 286.5, -0.873], [28, 95, 0.5]] },
  rivieres: [
    { points: [[1600, -80], [1590, 300], [1600, 640]], largeur: 380 },   // étang de Morvent
  ],
  ponts: [],
  cretes: [
    [150, 1350, 350, 1420, 3], [3050, 1350, 2850, 1420, 3],
  ],
  rochers: 14,
  bosquets: [
    { x: 1000, y: 1800, r: 70 }, { x: 2200, y: 1800, r: 70 },   // pinèdes des presqu'îles
    { x: 1100, y: 620, r: 90 }, { x: 2100, y: 620, r: 90 },
  ],
  routes: [
    [[700, 1640], [900, 1300], [1300, 1080], [1900, 1080], [2300, 1300], [2500, 1640]],
    [[340, 420], [600, 800], [1300, 1080]],
    [[2860, 420], [2600, 800], [1900, 1080]],
  ],
  noeuds: [
    [500, 1550, 3000], [910, 1560, 3000],    // presqu'île ouest
    [2700, 1550, 3000], [2290, 1560, 3000],  // presqu'île est
    [720, 280, 3000], [320, 720, 3000],      // nord-ouest
    [2480, 280, 3000], [2880, 720, 3000],    // nord-est
    [1600, 960, 5000],                       // sur l'isthme
    [1180, 980, 3500], [2020, 980, 3500],
    [1150, 400, 3000], [2050, 400, 3000],    // rives de l'étang
  ],
  structures: [
    { type: 'phare', x: 660, y: 2120, l: 80, h: 80, nom: 'Phare de Morvent' },
    { type: 'port', x: 2440, y: 2090, l: 140, h: 100, nom: 'Port de Cap-Brune' },
    { type: 'village', x: 240, y: 1040, l: 200, h: 120, nom: 'Morvent' },
    { type: 'ferme', x: 2800, y: 1050, l: 160, h: 100, nom: 'Mas de la Grève' },
  ],
  // 0 presqu'île ouest contre 1 presqu'île est ; 2 nord-ouest contre 3 nord-est
  bases: [ { c: 16, r: 43 }, { c: 61, r: 43 }, { c: 7, r: 6 }, { c: 70, r: 6 } ],
};

// ---------------------------------------------------------------------
//  Val des Brunelles : vallée boisée au crépuscule. Les bois ne laissent
//  que quelques allées vers la clairière du prieuré, où dorment les quatre
//  champs les plus riches de la carte. Tactique : la clairière se prend et
//  se reprend ; les allées se prêtent aux embuscades.
// ---------------------------------------------------------------------
CARTES.valBrunelles = {
  id: 'valBrunelles',
  nom: 'Val des Brunelles',
  description: 'Vallée boisée au crépuscule : des allées entre les bois mènent à la clairière du prieuré et à ses champs riches.',
  graine: 74453,
  ambiance: 'crepuscule',
  cote: null,
  rivieres: [],
  ponts: [],
  cretes: [],
  rochers: 22,
  // Anneau de bois autour de la clairière, ouvert seulement par quatre allées en diagonale
  // (vers chaque base) ; bois extérieurs entre les bases, le long des bords.
  bosquets: [
    { x: 1280, y: 620, r: 110 }, { x: 1440, y: 590, r: 110 }, { x: 1600, y: 580, r: 115 }, { x: 1760, y: 590, r: 110 }, { x: 1920, y: 620, r: 110 },
    { x: 1280, y: 1620, r: 110 }, { x: 1440, y: 1650, r: 110 }, { x: 1600, y: 1660, r: 115 }, { x: 1760, y: 1650, r: 110 }, { x: 1920, y: 1620, r: 110 },
    { x: 1000, y: 930, r: 110 }, { x: 960, y: 1120, r: 120 }, { x: 1000, y: 1310, r: 110 },
    { x: 2200, y: 930, r: 110 }, { x: 2240, y: 1120, r: 120 }, { x: 2200, y: 1310, r: 110 },
    { x: 1350, y: 250, r: 110 }, { x: 1600, y: 180, r: 140 }, { x: 1850, y: 250, r: 110 },
    { x: 1350, y: 1990, r: 110 }, { x: 1600, y: 2060, r: 140 }, { x: 1850, y: 1990, r: 110 },
    { x: 520, y: 980, r: 110 }, { x: 540, y: 1270, r: 110 },
    { x: 2680, y: 980, r: 110 }, { x: 2660, y: 1270, r: 110 },
  ],
  routes: [
    [[340, 420], [800, 600], [1140, 775], [1330, 1000]],
    [[2860, 1780], [2400, 1640], [2060, 1465], [1870, 1240]],
    [[2860, 420], [2400, 600], [2060, 775], [1870, 1000]],
    [[340, 1780], [800, 1640], [1140, 1465], [1330, 1240]],
  ],
  noeuds: [
    [720, 280, 3000], [320, 720, 3000],      // nord-ouest
    [2480, 280, 3000], [2880, 720, 3000],    // nord-est
    [720, 1960, 3000], [320, 1520, 3000],    // sud-ouest
    [2480, 1960, 3000], [2880, 1520, 3000],  // sud-est
    [1440, 990, 5000], [1760, 990, 5000], [1440, 1250, 5000], [1760, 1250, 5000],   // clairière
  ],
  structures: [
    { type: 'ruines', x: 1550, y: 1070, l: 100, h: 100, nom: 'Prieuré des Brunelles' },
    { type: 'village', x: 150, y: 1050, l: 200, h: 130, nom: 'Brunelles' },
    { type: 'ferme', x: 2860, y: 1060, l: 160, h: 100, nom: 'Mas Sombral' },
  ],
  // 0 nord-ouest contre 1 sud-est ; 2 nord-est contre 3 sud-ouest
  bases: [ { c: 7, r: 6 }, { c: 70, r: 46 }, { c: 70, r: 6 }, { c: 7, r: 46 } ],
};

// ---------------------------------------------------------------------
//  Couronne de Varenne (novembre 2026) : grande carte à huit camps, escarmouche hors ligne.
//  Huit bases en couronne, une ville au centre. Données fabriquées par
//  travaux/carte8/fabrique_carte.py (non publié). Champ « taille » : voir jeu.js, section 1.
// ---------------------------------------------------------------------
// >>> Couronne de Varenne : bloc fabriqué, ne pas modifier à la main
CARTES.couronneVarenne = {
  id: 'couronneVarenne',
  nom: 'Couronne de Varenne',
  description: 'Grande carte à huit bases en couronne autour d’une ville ; les champs riches sont en ville. Hors ligne seulement.',
  taille: { cols: 140, lignes: 98 },   // les autres cartes font 80 × 56
  horsLigne: true,                     // absente des parties en ligne
  graine: 80825,
  ambiance: 'midi',
  cote: null,
  rivieres: [],
  ponts: [],
  // Crêtes entre deux bases voisines : on passe d'une base à l'autre par l'intérieur de la couronne.
  cretes: [
    [4428, 2393, 5275, 2619, 9],
    [3474, 3006, 3825, 3550, 9],
    [2126, 3006, 1775, 3550, 9],
    [1172, 2393, 325, 2619, 9],
    [1172, 1527, 325, 1301, 9],
    [2126, 914, 1775, 370, 9],
    [3474, 914, 3825, 370, 9],
    [4428, 1527, 5275, 1301, 9],
  ],
  rochers: 80,
  zonesSansRochers: [ { x: 1900, y: 1400, l: 1800, h: 1120 } ],   // la ville et ses portes
  bosquets: [
    { x: 4016, y: 2284, r: 70 },
    { x: 3304, y: 2741, r: 70 },
    { x: 2296, y: 2741, r: 70 },
    { x: 1584, y: 2284, r: 70 },
    { x: 1584, y: 1636, r: 70 },
    { x: 2296, y: 1179, r: 70 },
    { x: 3304, y: 1179, r: 70 },
    { x: 4016, y: 1636, r: 70 },
    { x: 1283, y: 2167, r: 55 },
    { x: 4317, y: 1753, r: 55 },
    { x: 2478, y: 985, r: 55 },
    { x: 3122, y: 2935, r: 55 },
    { x: 1499, y: 1417, r: 55 },
    { x: 4101, y: 2503, r: 55 },
    { x: 3645, y: 1124, r: 55 },
    { x: 1955, y: 2796, r: 55 },
  ],
  routes: [
    [[610, 1979], [2180, 1965]],
    [[4990, 1979], [3420, 1965]],
    [[2782, 610], [2792, 1340]],
    [[2782, 3310], [2792, 2580]],
    [[1266, 981], [2277, 1626]],
    [[4334, 2939], [3323, 2294]],
    [[4334, 981], [3323, 1626]],
    [[1266, 2939], [2277, 2294]],
    [[3787, 1960], [3655, 2277], [3294, 2509], [2800, 2594], [2306, 2509], [1945, 2277], [1813, 1960], [1945, 1643], [2306, 1411], [2800, 1326], [3294, 1411], [3655, 1643], [3787, 1960]],
    [[2180, 1960], [3420, 1960]],
    [[2800, 1560], [2800, 2360]],
  ],
  // Contenu doublé par rapport aux autres cartes (lot 2, 25 novembre 2026) : 6 000 et 5 000 par base,
  // 12 000 sur la place, 10 000 aux portes de la ville.
  noeuds: [
    [657, 1632, 6000],   // base ouest
    [663, 2325, 6000],   // base ouest
    [1192, 2183, 5000],   // avance ouest
    [4937, 2325, 6000],   // base est
    [4943, 1632, 6000],   // base est
    [4411, 1764, 5000],   // avance est
    [3129, 655, 6000],   // base nord
    [2436, 665, 6000],   // base nord
    [2580, 1193, 5000],   // avance nord
    [2436, 3255, 6000],   // base sud
    [3129, 3265, 6000],   // base sud
    [2999, 2732, 5000],   // avance sud
    [1495, 716, 6000],   // base nord-ouest
    [1122, 1300, 6000],   // base nord-ouest
    [1643, 1470, 5000],   // avance nord-ouest
    [4105, 3204, 6000],   // base sud-est
    [4478, 2620, 6000],   // base sud-est
    [3957, 2450, 5000],   // avance sud-est
    [4478, 1300, 6000],   // base nord-est
    [4105, 716, 6000],   // base nord-est
    [3732, 1117, 5000],   // avance nord-est
    [1122, 2620, 6000],   // base sud-ouest
    [1495, 3204, 6000],   // base sud-ouest
    [1868, 2803, 5000],   // avance sud-ouest
    [2800, 1960, 12000],   // place de la ville
    [2040, 1530, 10000],   // porte de la ville
    [3560, 1530, 10000],   // porte de la ville
    [2040, 2390, 10000],   // porte de la ville
    [3560, 2390, 10000],   // porte de la ville
  ],
  structures: [
    { type: 'ferme', x: 1744, y: 2088, l: 150, h: 100, nom: 'Mas de la Croix' },
    { type: 'village', x: 3704, y: 1743, l: 160, h: 110, nom: 'Les Salines' },
    { type: 'ferme', x: 2547, y: 1282, l: 150, h: 100, nom: 'Mas du Levant' },
    { type: 'village', x: 2882, y: 2537, l: 160, h: 110, nom: 'Font-Claire' },
    { type: 'village', x: 1931, y: 1603, l: 160, h: 110, nom: 'Les Aubiers' },
    { type: 'ferme', x: 3514, y: 2212, l: 150, h: 100, nom: 'Mas des Genets' },
    { type: 'village', x: 3326, y: 1317, l: 160, h: 110, nom: 'Roquebrune' },
    { type: 'ferme', x: 2119, y: 2498, l: 150, h: 100, nom: 'Mas du Couchant' },
    { type: 'village', x: 2260, y: 1660, l: 180, h: 120, nom: 'Quartier des Tanneurs' },
    { type: 'village', x: 2560, y: 1660, l: 180, h: 120, nom: 'Quartier de la Halle' },
    { type: 'village', x: 2860, y: 1660, l: 180, h: 120, nom: 'Quartier du Beffroi' },
    { type: 'village', x: 3160, y: 1660, l: 180, h: 120, nom: 'Quartier des Sauniers' },
    { type: 'village', x: 2260, y: 1900, l: 180, h: 120, nom: 'Quartier du Lavoir' },
    { type: 'village', x: 3160, y: 1900, l: 180, h: 120, nom: 'Quartier de la Gare' },
    { type: 'village', x: 2260, y: 2140, l: 180, h: 120, nom: 'Quartier des Citernes' },
    { type: 'village', x: 2560, y: 2140, l: 180, h: 120, nom: 'Quartier du Marche' },
    { type: 'village', x: 2860, y: 2140, l: 180, h: 120, nom: 'Quartier des Remparts' },
    { type: 'village', x: 3160, y: 2140, l: 180, h: 120, nom: 'Quartier du Canal' },
  ],
  // 0 ouest contre 1 est, 2 nord contre 3 sud, 4 nord-ouest contre 5 sud-est, 6 nord-est contre 7 sud-ouest
  bases: [ { c: 10, r: 48 }, { c: 127, r: 48 }, { c: 68, r: 10 }, { c: 68, r: 85 }, { c: 27, r: 21 }, { c: 110, r: 74 }, { c: 110, r: 21 }, { c: 27, r: 74 } ],
};
// <<< Couronne de Varenne
