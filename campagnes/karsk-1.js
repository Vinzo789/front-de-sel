/* =====================================================================
   FRONT DE SEL — Campagne Karsk « La marche du Nord »
   Mission 1 : « Le col de Brèche »
   ---------------------------------------------------------------------
   Mission d'apprentissage, très guidée par la radio : sélection,
   déplacement, attaque, portée de la Grêle, récolte, construction,
   production et pouvoir « Renforts ».
   Données pures : aucun calcul, aucune fonction. Dans ce fichier,
   J = République de Karsk (joueur), I = Groupe Halden, N = Régie des eaux.
   ===================================================================== */

enregistrerMission({
  id: 'karsk-1', campagne: 'karsk', numero: 1,
  titre: 'Le col de Brèche',
  lieu: 'Col de Brèche, frontière nord de Varenne',
  date: '9 mai 2034',

  // ------------------------------------------------------------------
  //  CARTE : un col de montagne à l'aube. Le Nord (Karsk) en haut,
  //  une barrière rocheuse percée d'un col au centre et d'un sentier de
  //  chèvres à l'ouest, puis la vallée de Brèche où s'installe la base.
  // ------------------------------------------------------------------
  carte: {
    id: 'colDeBreche', nom: 'Col de Brèche',
    graine: 7341,
    ambiance: 'aube',
    cote: null,
    // Torrent de la Brèche, à l'est de la vallée.
    rivieres: [
      { points: [[3200, 1080], [2920, 1340], [2770, 1650], [2810, 1950], [2720, 2240]], largeur: 80 },
    ],
    ponts: [
      { x: 2785, y: 1790, angle: 0, longueur: 150, largeur: 50 },
    ],
    cretes: [
      // Barrière principale (ouest), interrompue par le sentier de chèvres (x 420 → 700)
      [0, 780, 420, 830, 7],
      [700, 840, 1380, 820, 11],
      // Barrière principale (est) : le col s'ouvre entre x 1380 et 1820
      [1820, 820, 3200, 770, 21],
      // Parois du couloir du col, côté vallée
      [1330, 900, 1280, 1260, 6],
      [1870, 900, 1930, 1260, 6],
      // Éperons du versant nord (décor, donnent du relief au départ)
      [300, 520, 700, 430, 6],
      [2500, 560, 2900, 470, 6],
    ],
    rochers: 28,
    bosquets: [
      // Pins du versant nord
      { x: 850, y: 250, r: 120 }, { x: 2350, y: 300, r: 150 }, { x: 2950, y: 260, r: 110 },
      { x: 300, y: 250, r: 100 }, { x: 1150, y: 150, r: 80 },
      // Vallée
      { x: 2350, y: 1330, r: 100 }, { x: 450, y: 1350, r: 100 },
      { x: 1100, y: 2050, r: 110 }, { x: 2150, y: 2150, r: 90 },
    ],
    routes: [
      // Route du col, du nord vers la vallée
      [[1640, 0], [1580, 300], [1650, 600], [1600, 900], [1560, 1150], [1620, 1400], [1600, 1800], [1520, 2240]],
      // Sentier de chèvres (ouest)
      [[1580, 300], [1150, 420], [760, 600], [560, 800], [620, 1050], [900, 1350], [1300, 1500]],
      // Route du hameau, à l'est, par le pont du torrent
      [[1600, 1800], [2200, 1760], [2785, 1790], [3200, 1760]],
    ],
    noeuds: [
      [1350, 1520, 3000], [2050, 1520, 3000], [1720, 1990, 3500],
      [1000, 1850, 2500], [2300, 1900, 2500],
    ],
    structures: [
      { type: 'ruines', x: 1800, y: 520, l: 120, h: 80, nom: 'Ancienne douane' },
      { type: 'ferme', x: 560, y: 1620, l: 180, h: 110, nom: 'Bergerie des Prés' },
      { type: 'village', x: 2900, y: 1940, l: 200, h: 130, nom: 'Hameau de Brèche' },
    ],
    bases: { J: { c: 41, r: 40 }, I: { c: 39, r: 26 } },
  },

  joueur: 'karsk', adversaire: 'halden',

  briefing: {
    intervenant: 'Colonel Teodor Brannik, 3e brigade de Karsk',
    texte: [
      'Trois étés sans pluie. Au Nord, on rationne l’eau au gobelet, et les puits de Karsk crachent du sable. Au Sud, Varenne dessale la mer et vend son eau à qui paie — et paie ceux qui la gardent.',
      'Il y a trois semaines, le Groupe Halden a installé un poste-frontière au col de Brèche. Deux tourelles, une caserne, une antenne. Personne ne nous a demandé notre avis. Ce matin, nous le leur donnons.',
      'Vous commandez le détachement de tête : des conscrits, trois sapeurs du génie, et bientôt deux lance-roquettes Grêle. La lieutenante Szell vous guidera à la radio. Écoutez-la : elle a construit la moitié des ponts du Nord et n’a jamais perdu un homme par impatience.',
      'Objectif : percer le col, puis installer une base dans la vallée de Brèche. C’est la porte du Sud. Une fois ouverte, elle ne se referme plus.',
    ],
  },

  fin: {
    victoire: 'Le col de Brèche est ouvert. Dans la vallée, les sapeurs ont déjà creusé leurs latrines et baptisé la caserne « Chez Orin », ce que le sergent nie farouchement. Le colonel Brannik a fait envoyer un seul message à l’état-major : « La porte est ouverte. » Plus au sud, à Cap Ferrand, une escouade Halden reçoit au même moment l’ordre de se tenir prête.',
    defaite: 'Le détachement reflue vers le Nord. Le poste Halden tient le col, et ses tourelles se remettent à tourner lentement dans le petit matin. Le colonel Brannik ne dit rien. C’est pire que s’il criait.',
  },

  reserves: { J: 0, I: 0 },
  popMax: 40,
  pouvoirs: { J: true, I: false },   // mission d'apprentissage : Halden n'utilise pas ses pouvoirs
  autorises: { batiments: ['caserne', 'depot'], unites: ['sapeur', 'conscrit'] },
  ia: { construit: false, revenu: 1, vagues: null, cible: null },
  musique: 'calme',

  // ------------------------------------------------------------------
  //  DÉPART
  // ------------------------------------------------------------------
  depart: {
    J: [
      { type: 'conscrit', x: 1600, y: 380, nb: 10, nom: 'detachement' },
      { type: 'sapeur', x: 1460, y: 250, nb: 3, nom: 'sapeurs' },
    ],
    I: [
      // Poste-frontière du col
      { type: 'tourelle', c: 36, r: 24, nom: 'poste' },
      { type: 'tourelle', c: 43, r: 24, nom: 'poste' },
      { type: 'caserne', c: 39, r: 28, nom: 'poste' },
      // Garnison réduite à 2 (mission d'apprentissage) : à 4, plus les 2 gardes du radar,
      // elle décimait le détachement dès son arrivée devant le col (les tireurs portent plus loin).
      { type: 'operateur', x: 1600, y: 1060, nb: 2, nom: 'garnison' },
      // Antenne radar, derrière la paroi ouest du couloir
      { type: 'relais', c: 27, r: 25, nom: 'radar' },
      // Un seul garde. Garnison et garde sont étiquetés : depuis la révision du moteur (novembre 2026),
      // ils ne sortent plus défendre le poste, ils ripostent sur place (laisse de 250 m).
      { type: 'operateur', x: 1080, y: 1170, nb: 1, nom: 'garde_radar' },
    ],
    N: [],
  },

  // ------------------------------------------------------------------
  //  OBJECTIFS
  //  « caserne » est visible dès le départ : il ne peut pas être rempli
  //  avant l'arrivée du QG (réserves nulles), ce qui évite toute victoire
  //  prématurée au moment où le poste tombe.
  // ------------------------------------------------------------------
  objectifs: [
    { id: 'percer', type: 'detruire', nom: 'poste',
      texte: 'Percer le col : détruire les deux tourelles et la caserne du poste Halden' },
    { id: 'sapeurs', type: 'proteger', nom: 'sapeurs', minimum: 1,
      texte: 'Garder au moins un sapeur en vie jusqu’à l’ouverture du col' },
    // NB : le contrat nomme « type » le type de bâtiment, ce qui entre en collision avec le type
    // d'objectif ; on le donne donc dans « batiment ».
    { id: 'caserne', type: 'construire', batiment: 'caserne', nombre: 1,
      texte: 'Construire une caserne dans la vallée de Brèche' },
    { id: 'radar', type: 'detruire', nom: 'radar', principal: false,
      texte: 'Abattre l’antenne radar Halden, derrière la paroi ouest du col' },
    // Objectifs cachés, révélés plus tard par les déclencheurs (action objectif.ajouter).
    { id: 'greles_vivantes', type: 'proteger', nom: 'greles', minimum: 1, principal: false, cache: true,
      texte: 'Ramener au moins une Grêle' },
    { id: 'depot', type: 'construire', batiment: 'depot', nombre: 1, cache: true,
      texte: 'Construire un dépôt de ravitaillement' },
    { id: 'patrouille', type: 'detruire', nom: 'patrouille', cache: true,
      texte: 'Repousser la patrouille Halden qui remonte de Varenne' },
  ],

  // ------------------------------------------------------------------
  //  DÉCLENCHEURS
  // ------------------------------------------------------------------
  declencheurs: [
    // --- Accueil et sélection ---
    { id: 'intro', quand: { temps: 1 }, faire: [
      { camera: { x: 1600, y: 420 } },
      // Point de rassemblement hors de portée des tourelles, d'où les Grêle (440 m) frappent le
      // poste sans que les conscrits ne soient attirés dans le couloir.
      { zone: { id: 'z_rassemblement', x: 1600, y: 560, r: 110, texte: 'Rassemblement' } },
      { radio: { qui: 'Col. Brannik', texte: 'Ici Brannik. Le col est droit devant, au sud. Halden y a planté son drapeau sans nous demander. On va le lui rendre.' } },
      { radio: { qui: 'Lt Szell', texte: 'Lieutenante Szell, génie. Je vous accompagne. Pour commencer, sélectionnez vos conscrits : clic gauche sur l’un d’eux, ou maintenez le bouton et glissez pour encadrer tout le groupe.' } },
      { radio: { qui: 'Lt Szell', texte: 'Ensuite, clic droit sur le terrain : les unités sélectionnées s’y rendent. Descendez la route jusqu’au cercle « Rassemblement », devant le col, et attendez-y les Grêle.' } },
      { radio: { qui: 'Sgt Orin', texte: 'Sergent Orin, à vos ordres. Les gars ont froid et ils ont soif. Ils marcheront d’autant plus vite.' } },
    ] },
    // Astuce reportée après l'installation de la base : à 35 s, elle retardait toute la file radio.
    { id: 'groupes', quand: { declencheur: 'qg_former', delai: 25 }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Astuce : Ctrl + 1 enregistre la sélection comme groupe 1, la touche 1 la rappelle. Les flèches ou le bord de l’écran déplacent la vue, la molette zoome.' } },
    ] },

    // --- Première vue du poste : l'attaque ---
    // Zone assez au sud pour ne pas se déclencher dès le premier pas (départ à y 380),
    // et pas avant la fin des consignes d'accueil.
    { id: 'vue_col', quand: { tous: [ { zone: { x: 1600, y: 560, r: 130 }, camp: 'J' }, { declencheur: 'intro', delai: 20 } ] }, faire: [
      { musique: 'tension' },
      { radio: { qui: 'Sgt Orin', texte: 'Poste en vue. Deux tourelles à canon à l’entrée du col, une caserne derrière. Ils ont même planté des géraniums.' } },
      { radio: { qui: 'Lt Szell', texte: 'Pour attaquer : clic droit sur une cible ennemie. Ou touche A puis clic au sol : l’attaque-déplacement, vos hommes avancent et engagent tout ce qu’ils croisent.' } },
      { radio: { qui: 'Lt Szell', texte: 'Mais ces tourelles portent à 260 mètres et déchirent l’infanterie. N’y envoyez pas les conscrits seuls. Restez au rassemblement et laissez venir leur garnison.' } },
    ] },

    // --- Arrivée des Grêle (au plus tard à 2 min 30) ---
    { id: 'greles', quand: { un: [ { declencheur: 'vue_col', delai: 8 }, { temps: 90 } ] }, faire: [
      { renforts: { camp: 'J', unites: [{ type: 'grele', nb: 2 }], depuis: { x: 1640, y: 40 }, vers: { x: 1600, y: 520 }, ordre: 'aller', nom: 'greles' } },
      { radio: { qui: 'Col. Brannik', texte: 'Deux Grêle descendent la route derrière vous. Ce sont les seules de la brigade. Ramenez-les-moi.' } },
      { radio: { qui: 'Lt Szell', texte: 'Une Grêle tire ses roquettes à 440 mètres, bien plus loin que les tourelles. Mais elle est aveugle au contact : gardez-la derrière l’infanterie.' } },
      { radio: { qui: 'Lt Szell', texte: 'Sélectionnez les Grêle, approchez-les à environ 400 mètres d’une tourelle, puis clic droit sur la tourelle. Patience : quatre salves suffisent.' } },
      { objectif: { ajouter: { id: 'greles_vivantes', type: 'proteger', nom: 'greles', minimum: 1, principal: false,
        texte: 'Ramener au moins une Grêle' } } },
    ] },

    // --- Le sentier de chèvres et le radar ---
    { id: 'sentier', quand: { temps: 80 }, faire: [
      { radio: { qui: 'Sgt Orin', texte: 'Mon grand-père passait des chèvres par un sentier, à l’ouest, sous la crête. Ça grimpe, mais ça passe. Leur antenne radar est juste derrière.' } },
      { radio: { qui: 'Lt Szell', texte: 'Dans son rayon, l’antenne donne vingt-cinq pour cent de puissance en plus à leur tourelle ouest. La couper d’abord serait élégant. Pas obligatoire.' } },
    ] },
    { id: 'radar_mort', quand: { detruit: 'radar' }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Antenne abattue. Le réseau Halden vient de perdre un œil.' } },
      { radio: { qui: 'Col. Brannik', texte: 'Bien. Personne au Nord ne pleurera ce radar.' } },
      { points: { camp: 'J', montant: 1 } },
    ] },
    { id: 'garnison_sort', quand: { pvSous: { nom: 'poste', ratio: 0.6 } }, faire: [
      { radio: { qui: 'Sgt Orin', texte: 'Leur poste flanche ! Encore quelques salves.' } },
    ] },

    // --- Filet de sécurité : sans conscrits ni Grêle, les sapeurs seuls ne peuvent pas percer
    //     (ils n'ont pas d'arme). La brigade envoie sa réserve plutôt que de laisser la
    //     mission bloquée sans issue.
    { id: 'reserve_brigade', quand: { tous: [ { detruit: 'detachement' }, { detruit: 'greles' } ] }, faire: [
      { radio: { qui: 'Col. Brannik', texte: 'Le détachement est anéanti. Je vous envoie la réserve de la brigade, la dernière. Cette fois, attendez-les au rassemblement.' } },
      { renforts: { camp: 'J', unites: [{ type: 'conscrit', nb: 8 }, { type: 'grele', nb: 1 }], depuis: { x: 1640, y: 40 }, vers: { x: 1600, y: 500 }, ordre: 'aller', nom: 'reserve' } },
    ] },

    // --- Joueur qui n'avance pas (ajouté après essai, passe 3 du moteur) ---
    // Les Grêle arrivées au rassemblement abattent seules les tourelles, mais la caserne du poste
    // est hors de leur portée : un joueur qui ne donne aucun ordre restait indéfiniment bloqué,
    // sans victoire ni défaite. Rappel à 8 min, échec à 12 min (délai large : mission d'apprentissage).
    { id: 'relance_col', quand: { tous: [ { temps: 480 }, { objectif: 'percer', etat: 'actif' } ] }, faire: [
      { radio: { qui: 'Col. Brannik', texte: 'Le col ne se prendra pas tout seul. Halden fait monter des renforts depuis Varenne : s’ils arrivent avant que le poste tombe, nous rentrons au Nord.' } },
      { radio: { qui: 'Lt Szell', texte: 'Approchez les Grêle à environ 400 mètres du poste, puis clic droit sur une tourelle ou sur la caserne. Les conscrits finiront le travail.' } },
    ] },
    { id: 'col_perdu', quand: { tous: [ { temps: 720 }, { objectif: 'percer', etat: 'actif' } ] }, faire: [
      { radio: { qui: 'Col. Brannik', texte: 'Leurs renforts sont au col. C’est fini pour aujourd’hui : tout le monde se replie.' } },
      { defaite: 'Le col n’a pas été pris à temps.' },
    ] },

    // --- Le col tombe : la base ---
    { id: 'perce', quand: { objectif: 'percer', etat: 'reussi' }, faire: [
      { zoneRetirer: 'z_rassemblement' },
      { objectif: { reussir: 'sapeurs' } },
      { musique: 'calme' },
      { batiment: { camp: 'J', type: 'qg', c: 41, r: 40, fini: true, nom: 'qg_breche' } },
      { reserves: { camp: 'J', montant: 900 } },
      { objectif: { ajouter: { id: 'depot', type: 'construire', batiment: 'depot', nombre: 1,
        texte: 'Construire un dépôt de ravitaillement' } } },
      // La patrouille Halden n'entre plus en scène ici mais dans « patrouille_attaque » : présente
      // dès la chute du col, elle pouvait être détruite avant son attaque, et la fin de mission
      // tombait alors au milieu des consignes (ou la radio « Contact ! » parlait d'une patrouille morte).
      { radio: { qui: 'Col. Brannik', texte: 'Le col est à nous. Le génie descend avec un quartier général de campagne. Installez-vous dans la vallée.' } },
      { camera: { x: 1700, y: 1640 } },
      { radio: { qui: 'Lt Szell', texte: 'Le QG est déployé, avec deux collecteurs. Ils vont seuls aux champs de minerai de la vallée et rapportent leur charge au QG. Les réserves s’affichent en haut de l’écran.' } },
      { radio: { qui: 'Lt Szell', texte: 'Les sapeurs, eux, ne récoltent pas : ils construisent et réparent. Pour bâtir, cliquez sur « Caserne » dans la barre de construction, en bas à droite, puis posez-la près du QG d’un clic gauche. Le sapeur le plus proche se met au travail.' } },
    ] },
    { id: 'qg_former', quand: { declencheur: 'perce', delai: 40 }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Le QG forme aussi des collecteurs : sélectionnez-le et cliquez sur « Collecteur ». Plus de collecteurs, plus de minerai, plus de tout. Clic droit sur un champ avec des collecteurs sélectionnés : ils iront y récolter.' } },
    ] },
    { id: 'caserne_ok', quand: { construit: { type: 'caserne', nombre: 1 } }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Caserne terminée. Sélectionnez-la et cliquez sur « Conscrit » pour en former. Clic droit sur le terrain, bâtiment sélectionné : point de ralliement des recrues.' } },
      { radio: { qui: 'Sgt Orin', texte: 'Des bleus. Parfait. Je leur apprendrai à se baisser.' } },
    ] },
    { id: 'depot_ok', quand: { construit: { type: 'depot', nombre: 1 } }, faire: [
      { radio: { qui: 'Lt Szell', texte: 'Dépôt opérationnel. Près d’un dépôt ou du QG, nos unités sont ravitaillées : elles tirent plus vite et se réparent lentement. Battez-vous chez vous quand vous le pouvez.' } },
    ] },

    // --- La patrouille attaque ---
    { id: 'patrouille_attaque', quand: { un: [
        { tous: [ { construit: { type: 'caserne', nombre: 1 } }, { construit: { type: 'depot', nombre: 1 } } ] },
        { declencheur: 'perce', delai: 240 } ] }, faire: [
      // L'objectif est révélé en premier : la base terminée remplit tous les autres objectifs
      // principaux, et la victoire automatique ne doit pas tomber avant la patrouille.
      { objectif: { ajouter: { id: 'patrouille', type: 'detruire', nom: 'patrouille',
        texte: 'Repousser la patrouille Halden qui remonte de Varenne' } } },
      // La patrouille entre sur l'autre rive du torrent, à l'est, et attaque 20 s plus tard par le pont.
      { renforts: { camp: 'I', unites: [{ type: 'operateur', nb: 4 }, { type: 'lynx', nb: 1 }],
        depuis: { x: 3150, y: 1740 }, vers: { x: 3050, y: 1720 }, ordre: 'aller', nom: 'patrouille' } },
      { radio: { qui: 'Inès Varga (canal Halden intercepté)', texte: 'Patrouille Brèche, ici Varga. Évaluez et rendez compte. Ne vous accrochez pas : ce col ne figure pas au contrat.' } },
      { radio: { qui: 'Col. Brannik', texte: 'Au contrat. Ils parlent de notre frontière comme d’une ligne de facture.' } },
    ] },
    // L'assaut de la patrouille, séparé de son entrée (essai de novembre 2026) : il attend aussi la
    // fin des consignes de base (« groupes » + 25 s). Un joueur rapide (caserne et dépôt 40 s après
    // la chute du col) faisait attaquer la patrouille alors que cinq consignes attendaient encore
    // leur tour : la radio avait 35 s de retard, et à la victoire la réplique du colonel (« Au
    // contrat… ») était coupée, « Contact au sud-est ! » et les consignes suivantes jamais lus.
    // (L'entrée et l'objectif restent au déclencheur précédent : retarder l'objectif laissait
    // tomber la victoire automatique avant la patrouille.)
    { id: 'patrouille_assaut', quand: { un: [
        { tous: [ { declencheur: 'patrouille_attaque', delai: 20 }, { declencheur: 'groupes', delai: 25 } ] },
        { declencheur: 'patrouille_attaque', delai: 75 } ] }, faire: [
      // Les points et la consigne « Renforts » arrivent pendant l'approche : au moment du combat,
      // la file radio ne garde que deux messages courts, et la réplique finale du colonel est
      // lue avant le débriefing (le moteur attend la file vide, au plus 12 s).
      { points: { camp: 'J', montant: 3 } },
      { radio: { qui: 'Lt Szell', texte: 'L’état-major vous accorde des points de commandement. Le bouton « Renforts », en haut, fait arriver cinq conscrits au QG. Utilisez-le maintenant.' } },
      { attendre: 12 },
      { musique: 'combat' },
      { radio: { qui: 'Sgt Orin', texte: 'Contact au sud-est ! Une patrouille Halden remonte la vallée : des tireurs et un blindé Lynx.' } },
      { attaque: { camp: 'I', nom: 'patrouille', vers: { x: 1700, y: 1660 } } },
      { radio: { qui: 'Lt Szell', texte: 'Le Lynx est rapide et blindé : concentrez le feu de tout le groupe sur lui, clic droit dessus.' } },
    ] },
    { id: 'fin_mission', quand: { objectif: 'patrouille', etat: 'reussi' }, faire: [
      { musique: 'calme' },
      // Répit ramené de 8 à 2 s (passe 3 du moteur) : à la victoire, le moteur retire désormais les
      // consignes encore en file et coupe celle qui est affichée au plus 2 s plus tard ; la réplique
      // du colonel, dans cette séquence, est gardée et lue avant le débriefing. Les 2 s laissent voir
      // tomber le dernier ennemi. Pendant l'attente, la victoire automatique est suspendue
      // (séquence décisive en cours).
      { attendre: 2 },
      { radio: { qui: 'Col. Brannik', texte: 'La vallée est tenue. Beau travail. Demain, Sorbe.' } },
      // Victoire forcée : le dépôt ou la caserne peuvent manquer si la patrouille attaque au
      // délai de 240 s.
      { victoire: true },
    ] },
  ],
});
