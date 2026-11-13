'use strict';
/* =====================================================================
   FRONT DE SEL — moteur du jeu (cartes, règles, IA, missions, interface,
   commandes, musique). Le rendu 3D est délégué aux modules r3d-*.js
   (objet global R3D). Univers, camps et unités originaux.

   Sections :
     1. Constantes et tables (unités, bâtiments, factions, pouvoirs)
     2. État du jeu et outils
     3. Carte (chargement d'une carte au format de cartes.js)
     4. Recherche de chemin
     5. Entités, relations entre camps
     6. Logique des unités et des bâtiments, combat, pouvoirs
     7. Intelligence artificielle (escarmouche et missions)
     8. Effets et messages
     9. Rendu (calque 2D, minicarte)
    10. Interface (barre, panneau)
    11. Commandes du joueur
    12. Moteur de missions (objectifs, conditions, actions, déclencheurs)
    13. Interface des missions (objectifs, radio, menus, briefing, débriefing)
    14. Musique (pilotage de musique.js)
    15. Boucle principale et démarrage
   ===================================================================== */

// =====================================================================
//  1. CONSTANTES ET TABLES
// =====================================================================
const TUILE = 40, COLS = 80, LIGNES = 56;
const LARG = COLS * TUILE, HAUT = LIGNES * TUILE;
let popMax = 60;          // effectif maximal par camp (une mission peut le changer)
const HAUTEUR_VOL = 55;   // altitude des unités aériennes sans champ « alt » (drones)
const ALT_CROISIERE = 90; // altitude de vol des avions (champ u.alt, 0 au sol)
// Distance du centre de l'unité à la bouche de son arme (départ des traçantes et des flammes).
const LONG_CANON = {operateur:8, conscrit:8, javelot:9, grenadier:9, traqueur:13, guetteur:13, lynx:17, bastion:26, ours:23, sentinelle:15, faucheur:8, grele:10,
  tourelle:24, bunker:16, f15:14, f35:12, rafale:13, rempart:16, frelon:16, busard:14, taon:16, vautour:14, batterie:18};
const ALT_HELICO = 45;    // altitude de vol des hélicoptères (champ u.alt) : vol bas, sous les avions

// Générateur pseudo-aléatoire à graine : la carte est toujours la même pour une graine donnée.
let graine = 20341;
function alea(){ graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; }

// ---------- Tables d'efficacité : arme -> blindage ----------
// Blindage « air » : drones ; « avion » : avions de chasse en vol (un avion posé compte comme « leger »).
// Toujours lire cette table avec efficacite(arme, cible) : une case absente vaut 1, jamais NaN.
// Blindage « vaisseau » : le vaisseau-mère des envahisseurs (mode Surprises). Seules les armes qui
// tirent en l'air, les avions et les pouvoirs l'atteignent (colonne à 0 pour toutes les autres).
const EFFICACITE = {
  balle:     {infanterie:1,    leger:0.6,  lourd:0.25, air:1,   avion:0.6, batiment:0.3, vaisseau:0.3},   // armes légères : égratignent le vaisseau-mère
  obus:      {infanterie:0.45, leger:1,    lourd:1,    air:0,   avion:0,   batiment:0.9, vaisseau:0},
  roquette:  {infanterie:1,    leger:0.9,  lourd:0.7,  air:0,   avion:0,   batiment:1.2, vaisseau:0},
  aa:        {infanterie:0.3,  leger:0.3,  lourd:0.1,  air:1.6, avion:0.33, batiment:0.1, vaisseau:0.45},   // avion 1.0 -> 0.33 (13 nov. 2026 : 3 avions tombaient sans dégât devant la DCA à budget égal)
  drone:     {infanterie:1,    leger:1.1,  lourd:0.7,  air:0,   avion:0,   batiment:0.6, vaisseau:0},
  frappe:    {infanterie:1,    leger:1,    lourd:1,    air:0.8, avion:0,   batiment:1,   vaisseau:0.8},
  // Armes de l'infanterie spécialisée (rôles 'bazooka' et 'sniper', voir UNITES[...].role)
  roquetteAT:{infanterie:0.25, leger:1.8,  lourd:1.15, air:0.9, avion:0,   batiment:1.1, vaisseau:0},     // lance-roquettes d'épaule
  precision: {infanterie:1,    leger:0.08, lourd:0.03, air:0,   avion:0,   batiment:0.03, vaisseau:0},    // fusil de précision
  // Armes des avions
  missileAir:{infanterie:0,    leger:0,    lourd:0,    air:1.4, avion:1,   batiment:0,   vaisseau:0.9},   // missile air-air
  bombe:     {infanterie:0.7,  leger:0.8,  lourd:1.15, air:0,   avion:0,   batiment:1.4, vaisseau:0},     // bombe guidée
  canonAir:  {infanterie:0.9,  leger:0.5,  lourd:0.15, air:1,   avion:0.7, batiment:0.2, vaisseau:0.3},   // canon de bord
  // Armes des hélicoptères (novembre 2026) : mitrailleuse de sabord et missiles antichars
  mitrailleuse:{infanterie:1,  leger:0.7,  lourd:0.15, air:0,   avion:0,   batiment:0.25, vaisseau:0},
  missileSol:{infanterie:0.35, leger:1,    lourd:1.3,  air:0,   avion:0,   batiment:1.2, vaisseau:0},
  // Armes des envahisseurs : tir de plasma (dards, rôdeurs, défense du vaisseau) et rayon principal
  plasma:    {infanterie:1,    leger:1,    lourd:0.8,  air:1.2, avion:1.1, batiment:0.18, vaisseau:0},
  rayon:     {infanterie:1,    leger:1,    lourd:1,    air:0,   avion:0,   batiment:1,   vaisseau:0},
};
// Blindage « helico » (novembre 2026) : hélicoptères en vol bas, mieux protégés qu'un drone. Réglé par
// duels (voir NOTES-CONCEPTION.md) : avec la colonne « air » des drones, 3 hélicoptères tombaient en
// 5 s devant 2 DCA. Toute arme absente de cette liste ne les atteint pas (0).
// (13 novembre 2026, second réglage : aa 1.35 -> 0.55, avec plus de PV et de portée pour les
// hélicoptères ; à budget égal la DCA détruisait les hélicoptères en 3 à 4 s sans aucune perte. Elle
// gagne toujours, en perdant 30 à 50 % de sa valeur. La batterie mixte garde son effet : bonusHelico.)
(function(){
  const HELICO = {balle:0.7, aa:0.55, frappe:0.8, roquetteAT:0.8, missileAir:1.2, canonAir:0.8, plasma:1.1};
  for(const k in EFFICACITE) EFFICACITE[k].helico = HELICO[k] || 0;
})();

// ---------- Unités ----------
const UNITES = {
  // Groupe Halden
  technicien:{nom:'Technicien', cout:50, temps:7, pv:70, vitesse:75, rayon:8, forme:'ouvrier', blindage:'infanterie',
    ouvrier:true, desc:'Ouvrier de Halden. Construit les bâtiments et répare ceux qui sont abîmés, gratuitement. Sans arme : protégez-le. Il ne récolte pas, c’est le rôle du collecteur.'},
  // Infanterie : trois rôles par camp (champ role : 'mitraillette', 'bazooka', 'sniper'), lus par le rendu
  // pour choisir la silhouette et l'arme visibles. Bazooka et sniper : interdits en mission par défaut
  // (RESERVES_ESCARMOUCHE), comme l'aviation.
  //   pasAvion : tire sur les cibles aériennes lentes (drones, dards) mais jamais sur les avions ni sur
  //   le vaisseau-mère.
  operateur:{nom:'Opérateur', cout:110, temps:9, pv:95, vitesse:62, rayon:7, forme:'infanterie', blindage:'infanterie', role:'mitraillette',
    arme:'balle', degats:15, cadence:0.9, portee:200, sol:true, air:true,
    desc:'Fantassin à mitraillette, la base de l’armée. Fort contre l’infanterie et les drones ; en nombre, abat les hélicoptères lance-missiles. Faible contre les chars, les bâtiments et les hélicoptères à mitrailleuse.'},
  javelot:{nom:'Javelot', cout:200, temps:11, pv:95, vitesse:55, rayon:7, forme:'infanterie', blindage:'infanterie', role:'bazooka',
    arme:'roquetteAT', degats:60, cadence:2.8, portee:230, sol:true, air:true, pasAvion:true,
    desc:'Fantassin à bazooka guidé. Fort contre les blindés légers, les drones et les hélicoptères lance-missiles ; abîme les chars et les bâtiments (à prix égal, le char l’emporte). Faible contre l’infanterie et les hélicoptères à mitrailleuse ; ne vise pas les avions.'},
  traqueur:{nom:'Traqueur', cout:180, temps:11, pv:60, vitesse:58, rayon:7, forme:'infanterie', blindage:'infanterie', role:'sniper',
    arme:'precision', degats:100, cadence:3.0, portee:340, sol:true, air:false,   // 100 : un tir abat l'opérateur (95 PV) ou le conscrit (80 PV)
    desc:'Tireur de précision. Abat un fantassin d’un seul coup, de très loin. Inutile contre les blindés et les bâtiments ; ne tire pas en l’air. Fragile : gardez-le derrière la ligne.'},
  // Réparateur (novembre 2026) : sans arme (repare:true). soin : PV rendus par seconde à une unité ;
  // soinBat : PV rendus par seconde à un bâtiment ; soigne : 'infanterie' (fantassin) ou 'vehicules'
  // (véhicule de dépannage). Conduit par majReparateur. Escarmouche seulement.
  mecano:{nom:'Mécano', cout:120, temps:9, pv:80, vitesse:62, rayon:7, forme:'infanterie', blindage:'infanterie', role:'reparateur',
    repare:true, soigne:'infanterie', soin:14, soinBat:12,
    desc:'Fantassin de soutien, sans arme. Soigne l’infanterie blessée et répare les bâtiments ; il soigne seul les alliés proches quand il n’a pas d’ordre. Clic droit sur un allié : le soigner.'},
  lynx:{nom:'Lynx', cout:240, temps:13, pv:280, vitesse:125, rayon:13, forme:'vehicule', blindage:'leger',
    arme:'balle', degats:13, cadence:0.3, portee:210, sol:true, air:true,   // bonus antiaérien retiré (nov. 2026) : la DCA Rempart prend ce rôle
    desc:'Blindé léger rapide à canon automatique. Fort contre l’infanterie et les drones ; bonne escorte contre les hélicoptères, surtout ceux à mitrailleuse. Faible contre les chars, les bazookas et les hélicoptères lance-missiles ; ne remplace pas la DCA contre les avions.'},
  faucheur:{nom:'Faucheur', cout:300, temps:14, pv:150, vitesse:165, rayon:11, forme:'drone', blindage:'air', aerien:true,
    arme:'drone', degats:30, cadence:1.1, portee:150, sol:true, air:false,
    desc:'Drone d’attaque rapide qui survole le relief. Bon pour harceler les véhicules et l’infanterie. Fragile face à la DCA, aux mitraillettes et aux bazookas.'},
  bastion:{nom:'Bastion', cout:520, temps:21, pv:720, vitesse:72, rayon:17, forme:'char', blindage:'lourd',
    arme:'obus', degats:72, cadence:2.0, portee:235, sol:true, air:false,
    desc:'Char moderne, cher et polyvalent. Fort contre les véhicules, les bazookas isolés et les bâtiments. Faible contre les bazookas en nombre, les hélicoptères à missiles et les avions : il ne tire pas en l’air.'},
  rempart:{nom:'Rempart', cout:300, temps:14, pv:320, vitesse:95, rayon:14, forme:'antiair', blindage:'leger',
    arme:'aa', degats:28, cadence:0.45, portee:330, sol:false, air:true,
    desc:'DCA à roues : canons jumelés guidés par radar. Abat drones, hélicoptères et avions, et atteint le vaisseau-mère. Ne tire jamais au sol : escortez-la.'},
  atelier:{nom:'Atelier mobile', cout:350, temps:15, pv:380, vitesse:85, rayon:14, forme:'atelier', blindage:'leger',
    repare:true, soigne:'vehicules', soin:28, soinBat:18,
    desc:'Véhicule de dépannage à grue, sans arme. Répare les véhicules, les hélicoptères et les bâtiments ; seul, il remet en état les alliés proches. Clic droit sur un allié : le réparer.'},
  // République de Karsk
  sapeur:{nom:'Sapeur', cout:50, temps:7, pv:85, vitesse:68, rayon:8, forme:'ouvrier', blindage:'infanterie',
    ouvrier:true, desc:'Ouvrier de Karsk, un peu plus robuste. Construit les bâtiments et répare ceux qui sont abîmés, gratuitement. Sans arme. Il ne récolte pas, c’est le rôle du collecteur.'},
  conscrit:{nom:'Conscrit', cout:65, temps:5, pv:80, vitesse:60, rayon:7, forme:'infanterie', blindage:'infanterie', role:'mitraillette',
    arme:'balle', degats:9, cadence:0.8, portee:165, sol:true, air:true, bonusVaisseau:0.5,   // en masse, ils abattaient le vaisseau-mère en 6 min
    desc:'Fantassin bon marché, rapide à former. Fort en nombre contre l’infanterie ; tire aussi sur les drones et les hélicoptères, sans grand effet. Faible seul, contre les chars et contre les hélicoptères.'},
  grenadier:{nom:'Grenadier', cout:150, temps:9, pv:90, vitesse:54, rayon:7, forme:'infanterie', blindage:'infanterie', role:'bazooka',
    arme:'roquetteAT', degats:50, cadence:2.8, portee:210, sol:true, air:true, pasAvion:true,
    desc:'Fantassin à bazooka, bon marché. Fort contre les blindés, les drones et les hélicoptères lance-missiles ; abîme les bâtiments. Faible contre l’infanterie, l’artillerie et les hélicoptères à mitrailleuse ; ne vise pas les avions.'},
  guetteur:{nom:'Guetteur', cout:140, temps:9, pv:65, vitesse:56, rayon:7, forme:'infanterie', blindage:'infanterie', role:'sniper',
    arme:'precision', degats:96, cadence:3.2, portee:320, sol:true, air:false,    // 96 : un tir abat l'opérateur (95 PV) ou le conscrit
    desc:'Tireur d’élite. Décime l’infanterie de très loin, un fantassin par tir. Sans effet sur les blindés et les bâtiments ; ne tire pas en l’air. Fragile.'},
  infirmier:{nom:'Infirmier', cout:90, temps:8, pv:80, vitesse:60, rayon:7, forme:'infanterie', blindage:'infanterie', role:'reparateur',
    repare:true, soigne:'infanterie', soin:12, soinBat:10,
    desc:'Fantassin de soutien, sans arme. Soigne l’infanterie blessée et répare les bâtiments ; il soigne seul les alliés proches quand il n’a pas d’ordre. Clic droit sur un allié : le soigner.'},
  ours:{nom:'Ours', cout:480, temps:21, pv:980, vitesse:55, rayon:19, forme:'char', blindage:'lourd',
    arme:'obus', degats:78, cadence:2.4, portee:215, sol:true, air:false,
    desc:'Char lourd, lent et très résistant. Fort contre les véhicules et les bâtiments. Faible contre les bazookas, les hélicoptères à missiles et les avions : il ne tire pas en l’air.'},
  grele:{nom:'Grêle', cout:440, temps:19, pv:230, vitesse:62, rayon:15, forme:'artillerie', blindage:'leger',
    arme:'roquette', degats:30, salve:4, zone:60, cadence:4.5, portee:440, porteeMin:130, sol:true, air:false,
    desc:'Lance-roquettes multiple à très longue portée : écrase les groupes et les défenses de loin. Ne peut pas tirer de près (moins de 130) ni en l’air. Fragile au contact.'},
  sentinelle:{nom:'Sentinelle', cout:280, temps:13, pv:330, vitesse:85, rayon:14, forme:'antiair', blindage:'leger',
    arme:'aa', degats:26, cadence:0.45, portee:320, sol:false, air:true,
    desc:'DCA de Karsk. Abat drones, hélicoptères et avions, et atteint le vaisseau-mère. Ne tire jamais au sol : escortez-la.'},
  depanneuse:{nom:'Dépanneuse', cout:300, temps:14, pv:420, vitesse:75, rayon:15, forme:'atelier', blindage:'leger',
    repare:true, soigne:'vehicules', soin:24, soinBat:15,
    desc:'Véhicule de dépannage à grue, sans arme. Répare les véhicules, les hélicoptères et les bâtiments ; seule, elle remet en état les alliés proches. Clic droit sur un allié : le réparer.'},
  // Collecteur (les deux camps, produit au QG, livrée du camp) : véhicule de récolte sans arme, conduit
  // par majCollecteur. capacite : chargement maximal ; chargement : unités prélevées par seconde sur un
  // champ de minerai ; dechargement : secondes passées au dépôt. Champs tenus : u.charge (0 à capacite),
  // u.recolteT (instant du dernier prélèvement, horloge temps : anime le bras ou la benne).
  collecteur:{nom:'Collecteur', cout:400, temps:16, pv:520, vitesse:58, rayon:15, forme:'collecteur', blindage:'leger',
    collecteur:true, capacite:50, chargement:12.5, dechargement:2.5,   // réglé pour un revenu proche de celui des ouvriers (voir compte rendu)
    desc:'Véhicule de récolte, sans arme : votre seule source de revenu. Fait seul la navette entre le champ de minerai et le dépôt ou le QG. Robuste, mais protégez-le des raids.'},
  // Civil (Régie des eaux de Varenne, ou toute faction dans une mission)
  convoi:{nom:'Convoi d’eau', cout:0, temps:0, pv:450, vitesse:52, rayon:14, forme:'camion', blindage:'leger',
    desc:'Camion-citerne civil. Sans arme : il faut l’escorter.'},
  // Aviation (les deux camps, produite par l'aéroport). Voir la section « Aviation » du moteur.
  //   avion      : modèle de vol des avions (majAvion) ; le modèle 3D est choisi par le type.
  //   armeAir / armeSol : {arme, degats, cadence, portee[, zone, cone]} contre les cibles en vol / au sol.
  //   arme, portee, sol, air : résumé lu par le reste du moteur (unité armée, cibles possibles).
  //   munitions  : tirs par sortie, avant le retour à l'aéroport ; virage : rad/s ; detection : px.
  //   chasse     : en attente, n'engage de lui-même que des cibles aériennes.
  //   furtif     : distance (px) au-delà de laquelle un ennemi ne peut pas le prendre pour cible en vol.
  f15:{nom:'F-15', cout:700, temps:26, pv:360, vitesse:330, rayon:15, forme:'avion', blindage:'avion', aerien:true, avion:true,
    arme:'missileAir', portee:380, sol:true, air:true, chasse:true, munitions:6, virage:1.5, detection:560,
    armeAir:{arme:'missileAir', degats:120, cadence:1.2, portee:380, cone:0.5},
    armeSol:{arme:'canonAir', degats:18, cadence:0.25, portee:220},
    desc:'Chasseur, le plus rapide. Fort contre tout ce qui vole : avions, hélicoptères, drones. Faible contre le sol (petit canon). Rentre se réarmer à l’aéroport.'},
  // F-35 : 240 PV avant le 13 novembre 2026 (abattu par la DCA avant son premier largage).
  f35:{nom:'F-35', cout:800, temps:28, pv:320, vitesse:270, rayon:14, forme:'avion', blindage:'avion', aerien:true, avion:true,
    arme:'bombe', portee:180, sol:true, air:false, munitions:2, virage:1.5, detection:460, furtif:220,
    armeSol:{arme:'bombe', degats:340, zone:50, cadence:1.5, portee:180},
    desc:'Furtif d’attaque. Deux bombes guidées très puissantes contre les bâtiments et les blindés. Repéré seulement de près ; sans défense contre les chasseurs, et une DCA nombreuse l’abat avant qu’il ait tout largué.'},
  rafale:{nom:'Rafale', cout:650, temps:24, pv:320, vitesse:300, rayon:14, forme:'avion', blindage:'avion', aerien:true, avion:true,
    arme:'missileAir', portee:330, sol:true, air:true, munitions:4, virage:1.6, detection:500,
    armeAir:{arme:'missileAir', degats:85, cadence:1.6, portee:330, cone:0.5},
    armeSol:{arme:'bombe', degats:220, zone:44, cadence:1.5, portee:170},   // 240, puis 170 quand le Lynx était la parade de Halden ; 220 depuis que le Rempart l'est (13 nov. 2026)
    desc:'Avion polyvalent : missiles contre ce qui vole, bombes contre le sol. Moyen partout, utile quand on ne sait pas ce qui vient. Craint la DCA.'},
  // Hélicoptères (novembre 2026, escarmouche seulement), produits à l'aéroport : aerien, forme 'helico',
  // role 'mitrailleur' ou 'missiles'. Contrairement aux avions, ils font du surplace, volent bas
  // (alt ALT_HELICO), n'ont besoin ni de piste ni de réarmement : ils suivent la logique commune des
  // unités (majUnite), comme les drones. Ils ne prennent pas de place d'avion : HELICOS_PAR_AEROPORT
  // au plus par aéroport (u.heliport). missile : tir guidé (projectile), dégâts à l'impact.
  // (13 novembre 2026 : PV et portées relevés, de 380/420/420/480 PV et 210/260/200/250 de portée,
  // avec la baisse de la DCA contre eux ; les lance-missiles restent sous la portée de la batterie, 300.)
  frelon:{nom:'Frelon', cout:450, temps:18, pv:450, vitesse:150, rayon:14, forme:'helico', role:'mitrailleur', blindage:'helico', aerien:true, alt:ALT_HELICO,
    arme:'mitrailleuse', degats:14, cadence:0.25, portee:230, sol:true, air:false,
    desc:'Hélicoptère à mitrailleuse. Fort contre l’infanterie, bazookas compris ; fait du surplace et franchit le relief. Peu efficace contre les chars (dégâts faibles). Faible contre la DCA, les défenses mixtes, les blindés légers à canon et les chasseurs.'},
  busard:{nom:'Busard', cout:600, temps:22, pv:620, vitesse:130, rayon:15, forme:'helico', role:'missiles', blindage:'helico', aerien:true, alt:ALT_HELICO,
    arme:'missileSol', missile:true, degats:70, cadence:2.2, portee:290, sol:true, air:false,
    desc:'Hélicoptère lance-missiles. Fort contre les chars, les blindés légers et les bâtiments ; fait du surplace et franchit le relief. Faible contre l’infanterie (bazookas et mitraillettes en nombre), la DCA, les défenses mixtes et les chasseurs.'},
  taon:{nom:'Taon', cout:380, temps:16, pv:480, vitesse:140, rayon:14, forme:'helico', role:'mitrailleur', blindage:'helico', aerien:true, alt:ALT_HELICO,
    arme:'mitrailleuse', degats:12, cadence:0.25, portee:220, sol:true, air:false,
    desc:'Hélicoptère à mitrailleuse, rustique et bon marché. Fort contre l’infanterie, bazookas compris. Peu efficace contre les chars (dégâts faibles). Faible contre la DCA, les défenses mixtes, les blindés légers à canon et les chasseurs.'},
  vautour:{nom:'Vautour', cout:520, temps:20, pv:680, vitesse:120, rayon:16, forme:'helico', role:'missiles', blindage:'helico', aerien:true, alt:ALT_HELICO,
    arme:'missileSol', missile:true, degats:62, cadence:2.2, portee:280, sol:true, air:false,
    desc:'Hélicoptère lance-missiles, lourd et blindé. Fort contre les chars, les blindés légers et les bâtiments. Faible contre les bazookas, la DCA, les défenses mixtes et les chasseurs.'},
  // Envahisseurs (camp X, mode Surprises de l'escarmouche). Jamais produits par un bâtiment.
  //   Le vaisseau-mère est conduit par majVaisseauMere (section 14 bis) et rendu par r3d-aliens.js
  //   (rendu:'aliens') ; ses PV et son bouclier viennent de DIFFICULTES[...].invasion.
  vaisseauMere:{nom:'Vaisseau-mère', cout:3000, temps:0, pv:20000, vitesse:14, rayon:260, forme:'vaisseauMere', rendu:'aliens',
    blindage:'vaisseau', aerien:true, alt:240, arme:'plasma', degats:34, cadence:0.5, portee:320, sol:true, air:true, bouclier:6000,
    desc:'Vaisseau des Veilleurs. Bouclier puis coque, sans aucune réparation : chaque coup porté compte. Rayon dévastateur. Seuls l’antiaérien, les avions et les pouvoirs l’atteignent.'},
  dard:{nom:'Dard', cout:120, temps:0, pv:110, vitesse:210, rayon:9, forme:'dard', blindage:'air', aerien:true,
    arme:'plasma', degats:8, cadence:0.8, portee:170, sol:true, air:true,
    desc:'Chasseur des Veilleurs, rapide et fragile. Lâché en escadrilles par le vaisseau-mère.'},
  rodeur:{nom:'Rôdeur', cout:300, temps:0, pv:440, vitesse:62, rayon:16, forme:'rodeur', blindage:'leger',
    arme:'plasma', degats:24, cadence:1.6, portee:200, sol:true, air:false,
    desc:'Marcheur à quatre pattes des Veilleurs, déposé au sol par le vaisseau-mère.'},
};

// ---------- Bâtiments ----------
const BATIMENTS = {
  qg:{nom:'Quartier général', taille:3, pv:3000, cout:0, temps:0, depot:true, aura:true,
    desc:'Cœur de la base : s’il tombe avec le reste, la partie est perdue. Forme les ouvriers et les collecteurs, reçoit le minerai.'},
  caserne:{nom:'Caserne', taille:2, pv:1100, cout:300, temps:22, desc:'Forme l’infanterie : mitraillettes, bazookas, tireurs d’élite et soutien. Premier bâtiment à construire ; elle ouvre l’usine.'},
  usine:{nom:'Usine de blindés', taille:3, pv:1600, cout:600, temps:32, requiert:'caserne',
    desc:'Produit les véhicules : blindés, chars, drones, DCA et dépannage. Ouvre l’aéroport et la batterie mixte.'},
  relais:{nom:'Antenne relais', taille:2, pv:500, cout:200, temps:14, aura:true,
    desc:'Propre à Halden. Vos unités à portée de l’antenne ou du QG font +25 % de dégâts. Fragile : placez-la à l’abri.'},
  depot:{nom:'Dépôt de ravitaillement', taille:2, pv:850, cout:250, temps:16, aura:true, depot:true,
    desc:'Reçoit le minerai des collecteurs (posez-le près d’un champ) et en produit. Pour Karsk, ravitaille aussi les unités proches : tir plus rapide et soin lent.'},
  // Défenses fixes (un bâtiment armé acquiert ses cibles et tire comme une unité)
  tourelle:{nom:'Tourelle automatique', taille:1, pv:900, cout:400, temps:18,
    arme:'obus', degats:40, cadence:1.6, portee:260, sol:true, air:false,
    desc:'Défense fixe de Halden à canon. Forte contre les véhicules et les chars. Faible contre l’infanterie en nombre ; ne tire pas en l’air.'},
  bunker:{nom:'Bunker', taille:1, pv:1300, cout:350, temps:16,
    arme:'balle', degats:12, cadence:0.35, portee:220, sol:true, air:true,
    desc:'Défense fixe de Karsk, très solide, à mitrailleuses. Forte contre l’infanterie ; tire aussi en l’air. Faible contre les chars et l’artillerie.'},
  // Batterie mixte (novembre 2026, les deux camps, escarmouche seulement) : canon automatique (armeSol)
  // et lance-missiles (armeAir) sur un même affût. arme / degats / cadence : résumé (arme antiaérienne).
  batterie:{nom:'Batterie mixte', taille:1, pv:1100, cout:550, temps:22, requiert:'usine',
    arme:'aa', degats:34, cadence:0.7, portee:300, sol:true, air:true,
    armeSol:{arme:'obus', degats:26, cadence:1.0}, armeAir:{arme:'aa', degats:34, cadence:0.7, missile:true, bonusHelico:2.4},   // 2,4 × 0,55 : son effet d'avant (1,35) sur les hélicoptères
    desc:'Défense fixe à canon et lance-missiles. Forte contre tout ce qui vole, hélicoptères et avions compris ; dégâts moyens au sol. Plus chère que la tourelle et le bunker.'},
  // Aéroport (les deux camps) : emprise 160 x 160 px. Piste d'est en ouest au sud, trois places de
  // stationnement (PLACES_AEROPORT), hangars au nord. Trois avions au plus par aéroport, et quatre
  // hélicoptères (HELICOS_PAR_AEROPORT), qui ne prennent pas de place d'avion.
  aeroport:{nom:'Aéroport', taille:4, pv:2000, cout:900, temps:30, requiert:'usine', aeroport:true,
    desc:'Produit les avions (trois places, réarmement et réparation au sol) et les hélicoptères (quatre au plus, sans place). Grand et précieux : défendez-le contre les airs.'},
  // Bâtiments civils de la Régie des eaux (non constructibles)
  station:{nom:'Station de pompage', taille:2, pv:2500, cout:0, temps:0, neutre:true,
    desc:'Pompe l’eau de la nappe pour les villages de la côte.'},
  entrepot:{nom:'Entrepôt de la Régie', taille:2, pv:1600, cout:0, temps:0, neutre:true,
    desc:'Vivres et réserves d’eau des habitants.'},
};

// ---------- Factions ----------
const FACTIONS = {
  halden:{nom:'Groupe Halden', couleur:'#3fa7ff', fonce:'#1c4f80', clair:'#a8d8ff',
    ouvrier:'technicien', special:'relais', defense:'tourelle', rayonAura:380,
    auraTexte:'Dans le réseau de relais : +25 % de dégâts.',
    // Dépôt : constructible par Halden aussi (point de déchargement hors du QG, production de collecteurs),
    // sans l'aura de ravitaillement, propre à Karsk (voir auraActive). En mission : seulement si la
    // mission le nomme dans ses bâtiments autorisés (voir batimentsConstructibles).
    extras:['depot'], antiair:'rempart', reparateurs:['mecano', 'atelier'], helicos:['frelon', 'busard'],
    production:{qg:['technicien','collecteur'], depot:['collecteur'], caserne:['operateur','javelot','traqueur','mecano'],
      usine:['lynx','faucheur','bastion','rempart','atelier'], aeroport:['f15','f35','rafale','frelon','busard']},
    iaVehicules:['lynx','bastion','faucheur','bastion','lynx','faucheur'],
    iaInfanterie:['operateur','javelot','operateur','traqueur','operateur','javelot'],
    victoire:'Les usines de Port-Calmes sont sécurisées. Le contrat est rempli — et la facture sera salée.',
    defaite:'Halden se retire de Port-Calmes. Les actionnaires apprécieront peu.'},
  karsk:{nom:'République de Karsk', couleur:'#e2533f', fonce:'#7e2418', clair:'#ffb4a8',
    ouvrier:'sapeur', special:'depot', defense:'bunker', rayonAura:330,
    auraTexte:'Ravitaillé : tir plus rapide et réparation lente.',
    antiair:'sentinelle', reparateurs:['infirmier', 'depanneuse'], helicos:['taon', 'vautour'],
    production:{qg:['sapeur','collecteur'], depot:['collecteur'], caserne:['conscrit','grenadier','guetteur','infirmier'],
      usine:['ours','grele','sentinelle','depanneuse'], aeroport:['f15','f35','rafale','taon','vautour']},
    iaVehicules:['ours','grele','ours','sentinelle'],
    iaInfanterie:['conscrit','conscrit','grenadier','conscrit','guetteur','conscrit','grenadier'],
    victoire:'Le drapeau de Karsk flotte sur Port-Calmes. L’eau coulera désormais vers le nord.',
    defaite:'Les divisions de Karsk refluent vers la frontière. La côte leur échappe.'},
  neutre:{nom:'Régie des eaux de Varenne', couleur:'#e8eef2', fonce:'#5d7380', clair:'#ffffff',
    ouvrier:null, special:null, defense:null, rayonAura:0, auraTexte:'',
    production:{}, iaVehicules:[], victoire:'', defaite:''},
  // Envahisseurs du mode Surprises (camp X) : aucune base, aucune production.
  aliens:{nom:'Les Veilleurs', couleur:'#7df9d0', fonce:'#1b2a33', clair:'#d9fff4',
    ouvrier:null, special:null, defense:null, rayonAura:0, auraTexte:'',
    production:{}, iaVehicules:[], victoire:'', defaite:''},
};

// ---------- Pouvoirs (points de commandement) ----------
const POUVOIRS = {
  halden:[
    {cle:'frappe', nom:'Frappe de précision', cout:3, recharge:35, rayon:70, cible:true,
      desc:'Un missile guidé frappe une petite zone après une seconde.'},
    {cle:'essaim', nom:'Essaim', cout:10, recharge:150, rayon:180, cible:true, super:true,
      desc:'Super-arme : une nuée de micro-drones s’abat sur une large zone.'},
  ],
  karsk:[
    {cle:'renforts', nom:'Renforts', cout:3, recharge:45, cible:false,
      desc:'Cinq conscrits arrivent immédiatement au QG.'},
    {cle:'marteau', nom:'Marteau', cout:10, recharge:150, rayon:220, cible:true, super:true,
      desc:'Super-arme : barrage d’artillerie lourde sur une large zone.'},
  ],
  neutre:[],
  aliens:[],
};

// vagueMul : multiplie la taille des vagues de mission.
// invasion : réglages des envahisseurs du mode Surprises (voir majVaisseauMere) :
//   pv, bouclier : du vaisseau-mère ; ni le bouclier ni les PV ne se régénèrent (demande du propriétaire,
//   novembre 2026 : « pas de récupération de vie ») ;
//   rayonDeg, rayonZone : dégâts et rayon (px) du rayon principal ; charge : s d'alerte avant l'impact ;
//   rayonRecharge : s entre deux tirs ; defDeg : dégâts d'un tir de défense rapprochée (deux cibles par salve) ;
//   escadrille / dardsMax / dardsT : dards lâchés par escadrille, plafond de dards vivants, intervalle (s) ;
//   rodeurs / rodeursMax / rodeursT : de même pour les rôdeurs déposés au sol ;
//   vitesse : px/s ; observation : s d'immobilité (sans rayon) après l'arrivée.
// Réglage « normal » par simulations (robot joueur raisonnable, alliance, arrivée à 5 min de jeu) :
// victoire en 6 à 12 min après l'arrivée avec une base très entamée, ou défaite ; voir le compte rendu.
// Adouci en novembre 2026 (« trop fort ») : plus de régénération, rayon principal environ 25 % moins
// fréquent (rayonRecharge 50 -> 67, 34 -> 45), largages de dards et de rôdeurs espacés d'environ 15 %.
// Novembre 2026, second adoucissement (Halden perdait encore avec l'alliance) : PV et bouclier abaissés
// (normal 25 000 + 6 000 -> 7 000 + 2 000 ; facile et difficile dans les mêmes proportions environ),
// avec l'alternance des bases et l'allié qui attaque vraiment. Essais testerInvasion (robot raisonnable,
// alliance, arrivée à 300 s, normal) : Halden gagne 509 s après l'arrivée, Karsk 558 s (avant la
// correction des tireurs d'élite : 779 s et 901 s).
const DIFFICULTES = {
  facile:   {revenu:0.7, premiereVague:330, vague:5, vagueMul:0.7,
    invasion:{pv:5600, bouclier:1500, rayonDeg:320, rayonZone:95, charge:4.5, rayonRecharge:67, defDeg:9,
      escadrille:2, dardsMax:4, dardsT:98, rodeurs:1, rodeursMax:2, rodeursT:110, vitesse:12, observation:90}},
  normal:   {revenu:1.0, premiereVague:210, vague:7, vagueMul:1,
    invasion:{pv:7000, bouclier:2000, rayonDeg:400, rayonZone:100, charge:4, rayonRecharge:67, defDeg:12,
      escadrille:2, dardsMax:5, dardsT:80, rodeurs:1, rodeursMax:2, rodeursT:86, vitesse:14, observation:60}},
  difficile:{revenu:1.35, premiereVague:150, vague:8, vagueMul:1.3,
    invasion:{pv:10000, bouclier:2500, rayonDeg:500, rayonZone:110, charge:4, rayonRecharge:45, defDeg:16,
      escadrille:3, dardsMax:9, dardsT:64, rodeurs:2, rodeursMax:5, rodeursT:69, vitesse:16, observation:40}},
};
// Ultra (novembre 2026, décision du propriétaire : « très intelligent et rusé », AUCUNE TRICHE) : revenu 1,
// exactement comme le joueur ; rythme de Difficile pour la première vague ; vaisseau du mode Surprises de
// Difficile. Ses comportements propres sont dans la section 7 ter (majUltra). En mission, Ultra reprend
// Difficile tel quel (voir reglagesMission et niveauIA) : les missions sont scénarisées.
DIFFICULTES.ultra = {revenu:1.0, premiereVague:150, vague:8, vagueMul:1.3, invasion:DIFFICULTES.difficile.invasion};
// Réglages de difficulté d'une mission (seules les missions l'appellent) : Ultra y vaut Difficile.
function reglagesMission(){ return DIFFICULTES[difficulte === 'ultra' ? 'difficile' : difficulte] || DIFFICULTES.normal; }

// =====================================================================
//  2. ÉTAT DU JEU ET OUTILS
// =====================================================================
let ents = [], projectiles = [], effets = [], evenements = [], messages = [];
let prochainId = 1, temps = 0, enJeu = false, enPause = false, partieFinie = false;
let camps = {}, selection = [], groupes = {};
let mode = null;               // {type:'placer', bat} | {type:'pouvoir', cle} | {type:'attaque'}
let alerte = {t:-99, x:0, y:0};
let population = {J:0, I:0, K:0, L:0, N:0, X:0};
let RELATIONS = {};            // {I_attaque_N: true, ...} : par défaut personne n'attaque le camp neutre
let issuePartie = null;        // escarmouche terminée : {victoire, alliance, t, camps} (outils de test)
let alliance = false;          // mode Surprises : trêve générale de tous les camps (J, I, K, L) contre les envahisseurs (X)
let pouvoirsActifs = {J:true, I:true, K:true, L:true};
// ---------- Camps ----------
// Deux notions distinctes, à ne pas confondre :
//  - le camp du JOUEUR LOCAL (campJoueur / campLocal()) : celui que l'interface montre et commande
//    (barre, sélection, messages « notre base », minicarte). C'est la seule source de cette information :
//    le futur mode en ligne n'aura qu'à la fixer autrement sur chaque poste.
//  - les relations entre camps (hostile, allies, equipeDe) : elles ne supposent jamais que l'adversaire
//    est I. En escarmouche, deux camps sont alliés quand ils ont la même équipe ; en mission, J et I
//    restent ennemis (relations de la mission pour le camp neutre N).
// camps[id] = {id, faction, equipe ('A'..'D'), couleur ('#rrggbb'), ia (ordinateur ?), elimine, elimineT,
//   reserves, points, recharges}. Un camp « ia:false » autre que campJoueur sera tenu par un humain distant.
let campJoueur = 'J';
function campLocal(){ return campJoueur; }
const CAMPS_JOUEURS = ['J', 'I', 'K', 'L'];              // ordre fixe : emplacements, bandeau, boucles
const COULEURS_CAMPS = {J:'#3fa7ff', I:'#e2533f', K:'#58c96b', L:'#e8c33f'};
const NOMS_COULEURS = {J:'Bleu', I:'Rouge', K:'Vert', L:'Jaune'};
// Camps de joueurs présents dans la partie (2 en mission et en duel, jusqu'à 4 en escarmouche).
function campsEnJeu(){ return CAMPS_JOUEURS.filter(id => camps[id]); }
function campsIA(){ return campsEnJeu().filter(id => camps[id].ia); }
function enVie(id){ return !!camps[id] && !camps[id].elimine; }
// Équipe d'un camp : son champ equipe, sinon son propre identifiant (missions : J et I s'opposent).
function equipeDe(id){ const c = camps[id]; return c && c.equipe ? c.equipe : id; }
function nomCamp(id){ return NOMS_COULEURS[id] || id; }
function couleurCamp(id){ const c = camps[id]; return c && typeof c.couleur === 'string' ? c.couleur : null; }
let difficulte = 'normal';
const stats = {produites:0, perdues:0, detruites:0};
const souris = {x:0, y:0, mx:0, my:0, bas:false, dx:0, dy:0, dedans:false, miniBas:false};
const touches = {};

const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const distBord = (a,b) => Math.hypot(a.x-b.x, a.y-b.y) - (b.rayon||0);
function diffAngle(a,b){ let d = (b-a) % (Math.PI*2); if(d > Math.PI) d -= Math.PI*2; if(d < -Math.PI) d += Math.PI*2; return d; }
function tournerVers(a,b,max){ const d = diffAngle(a,b); return Math.abs(d) <= max ? b : a + Math.sign(d)*max; }
function faction(campId){ return FACTIONS[(camps[campId] || camps.N || {faction:'neutre'}).faction] || FACTIONS.neutre; }
function enMinSec(t){ const m = Math.floor(t/60), s = Math.floor(t%60); return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'); }
function echapper(t){ return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
// Altitude d'une entité : 0 au sol ; champ « alt » s'il existe (avions), sinon HAUTEUR_VOL (drones).
function altitudeDe(e){
  if(!e || !e.def || !e.def.aerien) return 0;
  return typeof e.alt === 'number' ? e.alt : HAUTEUR_VOL;
}
// Entité réellement en l'air : une unité aérienne, sauf un avion posé ou qui roule (alt proche de 0),
// qui est alors une cible au sol comme une autre.
function enVol(e){ return !!(e && e.def && e.def.aerien) && altitudeDe(e) >= 6; }
// Hauteur (en 3D) du point de visée d'une entité : sert aux tracés de tir et aux explosions.
function hauteurVisee(e){
  if(!e || !e.def) return 8;
  if(e.est === 'batiment') return 18;
  if(e.def.aerien) return Math.max(6, altitudeDe(e));
  return {infanterie:8, ouvrier:8, vehicule:10, char:12, artillerie:11, antiair:11, camion:11, atelier:12}[e.def.forme] || 8;
}
// Distance d'un point à une ligne brisée [[x,y], ...].
function distPolyligne(x, y, pts){
  let best = Infinity;
  if(!pts || !pts.length) return best;
  if(pts.length === 1) return Math.hypot(x-pts[0][0], y-pts[0][1]);
  for(let i=0; i<pts.length-1; i++){
    const [ax,ay] = pts[i], [bx,by] = pts[i+1], dx = bx-ax, dy = by-ay, l2 = dx*dx + dy*dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x-ax)*dx + (y-ay)*dy)/l2)) : 0;
    best = Math.min(best, Math.hypot(x-(ax+dx*t), y-(ay+dy*t)));
  }
  return best;
}

// =====================================================================
//  3. CARTE
//  Globales lues par les modules 3D : CARTE, grille, cote(x), roches,
//  bosquets, RIVIERES, PONTS, STRUCTURES, ROUTES, noeuds.
// =====================================================================
const grille = new Uint8Array(COLS*LIGNES);   // 0 libre, 1 eau, 2 obstacle (roche, bois, structure), 3 bâtiment
var CARTE = null;
var roches = [], bosquets = [], RIVIERES = [], PONTS = [], STRUCTURES = [], ROUTES = [], noeuds = [];
let coteBase = Infinity, coteOndes = null;
let basesCarte = {J:{c:9, r:24}, I:{c:68, r:24}};
const TYPES_STRUCTURES = ['usine_dessal', 'village', 'port', 'raffinerie', 'ruines', 'phare', 'ferme', 'barrage'];
const MARGE_ROUTE = 70;   // les rochers isolés restent à cette distance des routes

// Ligne de côte : la mer occupe y > cote(x). Sans mer, renvoie Infinity.
function cote(x){
  if(!coteOndes) return coteBase;
  let y = coteBase;
  for(const o of coteOndes) y += o[0]*Math.sin(x/o[1] + o[2]);
  return y;
}
function crete(x0,y0,x1,y1,n){
  for(let i=0;i<n;i++){
    const t = n > 1 ? i/(n-1) : 0;
    roches.push({x:x0+(x1-x0)*t+(alea()-.5)*40, y:y0+(y1-y0)*t+(alea()-.5)*30, r:40+alea()*26});
  }
}
function nombre(v, def){ return (typeof v === 'number' && isFinite(v)) ? v : def; }
function dansPont(p, x, y){
  const a = nombre(p.angle, 0), dx = x - p.x, dy = y - p.y;
  const long = dx*Math.cos(a) + dy*Math.sin(a), trav = -dx*Math.sin(a) + dy*Math.cos(a);
  return Math.abs(long) <= nombre(p.longueur, 140)/2 && Math.abs(trav) <= Math.max(nombre(p.largeur, 50)/2, 28);
}
function avertirCarte(texte){ console.warn('[Carte ' + (CARTE && CARTE.id || '?') + '] ' + texte); }
// Emplacements de départ d'une carte, dans l'ordre : ancien format {J, I} (missions, Port-Calmes) ou
// liste de quatre emplacements [{c, r}, ...] (0 et 1 opposés pour l'escarmouche à deux, 2 et 3 en réserve
// pour un futur mode à quatre camps). Fonction pure.
function emplacementsCarte(carte){
  const b = carte && carte.bases, ok = e => e && isFinite(e.c) && isFinite(e.r);
  if(Array.isArray(b)) return b.filter(ok);
  if(b && typeof b === 'object') return ['J', 'I'].map(k => b[k]).filter(ok);
  return [];
}

// Charge une carte (objet de données) : remplit les globales et la grille.
// « evitements » : cercles {x, y, r} où ne pas poser de rochers (départ d'une mission).
function chargerCarte(carte, evitements){
  CARTE = carte;
  graine = nombre(carte.graine, 20341);
  roches.length = 0; noeuds.length = 0;
  ROUTES = Array.isArray(carte.routes) ? carte.routes.filter(rt => Array.isArray(rt) && rt.length >= 2) : [];
  RIVIERES = Array.isArray(carte.rivieres) ? carte.rivieres.filter(rv => rv && Array.isArray(rv.points) && rv.points.length >= 2)
    .map(rv => ({points:rv.points, largeur:nombre(rv.largeur, 70)})) : [];
  PONTS = Array.isArray(carte.ponts) ? carte.ponts.filter(p => p && isFinite(p.x) && isFinite(p.y))
    .map(p => ({x:p.x, y:p.y, angle:nombre(p.angle, 0), longueur:nombre(p.longueur, 140), largeur:nombre(p.largeur, 50)})) : [];
  bosquets = Array.isArray(carte.bosquets) ? carte.bosquets.filter(b => b && isFinite(b.x) && isFinite(b.y) && b.r > 0) : [];
  STRUCTURES = [];
  for(const s of (Array.isArray(carte.structures) ? carte.structures : [])){
    if(!s || !isFinite(s.x) || !isFinite(s.y) || !(s.l > 0) || !(s.h > 0)){ avertirCarte('structure invalide ignorée : ' + JSON.stringify(s)); continue; }
    if(!TYPES_STRUCTURES.includes(s.type)) avertirCarte('type de structure inconnu « ' + s.type + ' » (gardée comme obstacle).');
    STRUCTURES.push({type:s.type, x:s.x, y:s.y, l:s.l, h:s.h, nom:s.nom || null});
  }
  if(carte.cote && isFinite(carte.cote.base)){
    coteBase = carte.cote.base;
    coteOndes = (Array.isArray(carte.cote.ondes) ? carte.cote.ondes : []).filter(o => Array.isArray(o) && o.length >= 2)
      .map(o => [nombre(o[0], 0), nombre(o[1], 100) || 100, nombre(o[2], 0)]);
  } else { coteBase = Infinity; coteOndes = null; }
  const empl = emplacementsCarte(carte);
  if(empl.length >= 2) basesCarte = {J:empl[0], I:empl[1]};
  // Champs de minerai (cristaux de sel et de lithium). rayon : rayon logique (sélection, ordres) ;
  // le rendu les dessine sur environ 110 px de diamètre (R3D.Batiments.sync).
  for(const n of (Array.isArray(carte.noeuds) ? carte.noeuds : [])){
    if(!Array.isArray(n) || !isFinite(n[0]) || !isFinite(n[1])){ avertirCarte('champ de minerai invalide ignoré : ' + JSON.stringify(n)); continue; }
    const q = nombre(n[2], 3000);
    noeuds.push({x:n[0], y:n[1], reste:q, max:q, rayon:40});
  }
  // Crêtes rocheuses, puis rochers isolés (le tirage suit la graine : ordre important)
  for(const c of (Array.isArray(carte.cretes) ? carte.cretes : [])){
    if(Array.isArray(c) && c.length >= 5) crete(c[0], c[1], c[2], c[3], Math.max(1, Math.round(c[4])));
    else avertirCarte('crête invalide ignorée : ' + JSON.stringify(c));
  }
  const bases = empl.map(b => ({x:(b.c+1.5)*TUILE, y:(b.r+1.5)*TUILE}));
  const evit = evitements || [];
  const Z = carte.zoneRochers || {x:150, y:120, l:LARG-300, h:HAUT-240};
  const voulu = roches.length + Math.max(0, Math.round(nombre(carte.rochers, 0)));
  const maxEssais = Math.max(500, (voulu - roches.length)*12);
  const margeRoutes = nombre(carte.margeRoutes, MARGE_ROUTE);
  const sansRochers = (Array.isArray(carte.zonesSansRochers) ? carte.zonesSansRochers : []).filter(z => z && isFinite(z.x) && isFinite(z.y) && z.l > 0 && z.h > 0);
  let essais = 0;
  while(roches.length < voulu && essais++ < maxEssais){
    const x = Z.x + alea()*Z.l, y = Z.y + alea()*Z.h, r = 22 + alea()*22;
    if(y > cote(x) - 120) continue;
    if(bases.some(b => Math.hypot(x-b.x, y-b.y) < 480)) continue;
    if(evit.some(z => Math.hypot(x-z.x, y-z.y) < z.r)) continue;
    if(noeuds.some(n => Math.hypot(n.x-x, n.y-y) < 140)) continue;
    if(STRUCTURES.some(s => x > s.x-80 && x < s.x+s.l+80 && y > s.y-80 && y < s.y+s.h+80)) continue;
    if(margeRoutes > 0 && ROUTES.some(rt => distPolyligne(x, y, rt) < margeRoutes)) continue;
    if(sansRochers.some(z => x > z.x && x < z.x+z.l && y > z.y && y < z.y+z.h)) continue;
    if(RIVIERES.some(rv => distPolyligne(x, y, rv.points) < rv.largeur/2 + r + 30)) continue;
    if(PONTS.some(p => Math.hypot(x-p.x, y-p.y) < p.longueur/2 + 80)) continue;
    if(bosquets.some(b => Math.hypot(x-b.x, y-b.y) < b.r + r + 20)) continue;
    roches.push({x, y, r});
  }
  // Grille de passage
  for(let r=0;r<LIGNES;r++) for(let c=0;c<COLS;c++){
    const x = (c+.5)*TUILE, y = (r+.5)*TUILE;
    let v = 0;
    if(y > cote(x) - 10) v = 1;
    else if(STRUCTURES.some(s => x > s.x && x < s.x+s.l && y > s.y && y < s.y+s.h)) v = 2;
    else if(roches.some(k => Math.hypot(k.x-x,k.y-y) < k.r)) v = 2;
    else if(bosquets.some(b => Math.hypot(b.x-x, b.y-y) < b.r)) v = 2;
    else if(RIVIERES.some(rv => distPolyligne(x, y, rv.points) < rv.largeur/2)) v = 1;
    if(v === 1 && y <= cote(x) - 10 && PONTS.some(p => dansPont(p, x, y))) v = 0;   // les ponts franchissent les rivières
    grille[r*COLS+c] = v;
  }
}
function libreC(c,r){ return c>=0 && r>=0 && c<COLS && r<LIGNES && grille[r*COLS+c] === 0; }
function libre(x,y){ return libreC(Math.floor(x/TUILE), Math.floor(y/TUILE)); }
function plusProcheLibre(c,r){
  if(libreC(c,r)) return [c,r];
  for(let d=1; d<25; d++){
    let best = null, bd = 1e9;
    for(let dc=-d; dc<=d; dc++) for(let dr=-d; dr<=d; dr++){
      if(Math.max(Math.abs(dc),Math.abs(dr)) !== d) continue;
      if(libreC(c+dc,r+dr)){ const dd = dc*dc+dr*dr; if(dd < bd){ bd = dd; best = [c+dc,r+dr]; } }
    }
    if(best) return best;
  }
  return null;
}
// Point libre le plus proche (coordonnées de jeu).
function pointLibre(x, y){
  const c = Math.max(0, Math.min(COLS-1, Math.floor(x/TUILE))), r = Math.max(0, Math.min(LIGNES-1, Math.floor(y/TUILE)));
  if(libreC(c, r)) return {x, y};
  const p = plusProcheLibre(c, r);
  return p ? {x:(p[0]+.5)*TUILE, y:(p[1]+.5)*TUILE} : {x, y};
}

// =====================================================================
//  4. RECHERCHE DE CHEMIN (A* sur la grille)
// =====================================================================
const NB = COLS*LIGNES;
const gS = new Float32Array(NB), fS = new Float32Array(NB), parent = new Int32Array(NB), etatA = new Uint8Array(NB);
const VOISINS = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.414],[1,-1,1.414],[-1,1,1.414],[-1,-1,1.414]];
let tas = [];
function tasAjouter(i){
  tas.push(i); let k = tas.length-1;
  while(k > 0){ const p = (k-1)>>1; if(fS[tas[p]] <= fS[tas[k]]) break; [tas[p],tas[k]] = [tas[k],tas[p]]; k = p; }
}
function tasRetirer(){
  const haut = tas[0], dernier = tas.pop();
  if(tas.length){
    tas[0] = dernier; let k = 0;
    for(;;){
      const l = 2*k+1, r = l+1; let m = k;
      if(l < tas.length && fS[tas[l]] < fS[tas[m]]) m = l;
      if(r < tas.length && fS[tas[r]] < fS[tas[m]]) m = r;
      if(m === k) break; [tas[m],tas[k]] = [tas[k],tas[m]]; k = m;
    }
  }
  return haut;
}
function ligneLibre(x0,y0,x1,y1){
  const d = Math.hypot(x1-x0,y1-y0), n = Math.ceil(d/10);
  const px = d ? -(y1-y0)/d*9 : 0, py = d ? (x1-x0)/d*9 : 0;
  for(let k=1;k<=n;k++){
    const x = x0+(x1-x0)*k/n, y = y0+(y1-y0)*k/n;
    if(!libre(x,y) || !libre(x+px,y+py) || !libre(x-px,y-py)) return false;
  }
  return true;
}
function trouverChemin(x0,y0,x1,y1){
  const s = plusProcheLibre(Math.floor(x0/TUILE), Math.floor(y0/TUILE));
  const t = plusProcheLibre(Math.max(0,Math.min(COLS-1,Math.floor(x1/TUILE))), Math.max(0,Math.min(LIGNES-1,Math.floor(y1/TUILE))));
  if(!s || !t) return null;
  const [tc,tr] = t, deb = s[1]*COLS+s[0], fin = tr*COLS+tc;
  const h = (c,r) => { const dx = Math.abs(c-tc), dy = Math.abs(r-tr); return dx+dy - 0.586*Math.min(dx,dy); };
  etatA.fill(0); tas.length = 0;
  gS[deb] = 0; fS[deb] = h(s[0],s[1]); parent[deb] = -1; etatA[deb] = 1; tasAjouter(deb);
  let iter = 0, trouve = false;
  while(tas.length && iter++ < 7000){
    const cur = tasRetirer();
    if(etatA[cur] === 2) continue;
    etatA[cur] = 2;
    if(cur === fin){ trouve = true; break; }
    const cc = cur % COLS, cr = (cur/COLS)|0;
    for(const [dc,dr,cout] of VOISINS){
      const nc = cc+dc, nr = cr+dr;
      if(!libreC(nc,nr)) continue;
      if(dc && dr && (!libreC(cc+dc,cr) || !libreC(cc,cr+dr))) continue;
      const ni = nr*COLS+nc;
      if(etatA[ni] === 2) continue;
      const ng = gS[cur] + cout;
      if(etatA[ni] === 1 && ng >= gS[ni]) continue;
      gS[ni] = ng; fS[ni] = ng + h(nc,nr); parent[ni] = cur; etatA[ni] = 1; tasAjouter(ni);
    }
  }
  if(!trouve) return null;
  const pts = [];
  for(let k = fin; k !== -1; k = parent[k]) pts.push({x:(k%COLS+.5)*TUILE, y:(((k/COLS)|0)+.5)*TUILE});
  pts.reverse();
  if(libre(x1,y1)) pts[pts.length-1] = {x:x1, y:y1};
  const lisse = []; let i = 0, ox = x0, oy = y0;
  while(i < pts.length){
    let j = pts.length-1;
    while(j > i && !ligneLibre(ox,oy,pts[j].x,pts[j].y)) j--;
    lisse.push(pts[j]); ox = pts[j].x; oy = pts[j].y; i = j+1;
  }
  return lisse;
}

// =====================================================================
//  5. ENTITÉS ET RELATIONS ENTRE CAMPS
// =====================================================================
function creerBatiment(type, camp, c, r, fini){
  const D = BATIMENTS[type], t = D.taille;
  const b = {id:prochainId++, est:'batiment', type, def:D, camp, c, r,
    x:(c+t/2)*TUILE, y:(r+t/2)*TUILE, rayon:t*TUILE/2,
    pvMax:D.pv, pv: fini ? D.pv : D.pv*0.1, enCours:!fini, progres: fini ? 1 : 0,
    file:[], prodT:0, rally:null, mort:false,
    // armement éventuel (tourelle, bunker) : mêmes champs qu'une unité
    angleT:Math.PI/2, tirT:-99, recharge:0, scan:Math.random()*0.3, cible:null, rang:0, kills:0,
    dansAura:false, auraT:0, toucheT:-99, nom:null};
  for(let rr=Math.max(0,r); rr<Math.min(LIGNES,r+t); rr++) for(let cc=Math.max(0,c); cc<Math.min(COLS,c+t); cc++) grille[rr*COLS+cc] = 3;
  ents.push(b);
  return b;
}
function creerUnite(type, camp, x, y){
  const D = UNITES[type];
  const u = {id:prochainId++, est:'unite', type, def:D, camp, x, y, rayon:D.rayon,
    pv:D.pv, pvMax:D.pv, angle:Math.PI/2, angleT:Math.PI/2, ordre:null, cible:null, chemin:null, dest:null,
    repath:0, recharge:0, scan:Math.random()*0.3, kills:0, rang:0, charge:0, minage:0, dansAura:false, auraT:0,
    enVague:false, mort:false, toucheT:-99, tirT:-99, nom:null};
  // Avion : créé en vol, en attente autour de son point de création, sans aéroport attitré
  // (un avion produit par un aéroport est ensuite posé sur sa place par stationnerAvion).
  if(D.avion) Object.assign(u, {alt:ALT_CROISIERE, vit:D.vitesse*0.7, auSol:false, phase:'vol', base:null, place:-1,
    munitions:D.munitions, attente:{x, y}, rearmeT:0, pretT:temps, passe:null, passeT:0, degage:0, poursuiteT:0,
    sensPiste:1, coteApproche:1, sensOrbite:prochainId % 2 ? 1 : -1, remises:0, rechercheT:0});
  // Hélicoptère : en vol bas dès sa sortie (aucune phase au sol) ; heliport : aéroport d'origine (limite).
  if(D.forme === 'helico') Object.assign(u, {alt:D.alt || ALT_HELICO, heliport:null});
  // Réparateur : instant du dernier soin (horloge temps) et entité soignée, lus par le rendu.
  if(D.repare) Object.assign(u, {repareT:-99, cibleSoin:null});
  ents.push(u);
  if(camp === campJoueur) stats.produites++;
  return u;
}
function positionSortie(b){
  const p = plusProcheLibre(Math.floor(b.x/TUILE), Math.floor((b.y+b.rayon+20)/TUILE));
  return p ? {x:(p[0]+.5)*TUILE + (Math.random()-.5)*10, y:(p[1]+.5)*TUILE + (Math.random()-.5)*10} : {x:b.x, y:b.y+b.rayon+20};
}
function emplacementValide(type, c, r, marge){
  const t = BATIMENTS[type].taille, m = marge ? 1 : 0;
  for(let rr=r-m; rr<r+t+m; rr++) for(let cc=c-m; cc<c+t+m; cc++){
    if(cc<0 || rr<0 || cc>=COLS || rr>=LIGNES) return false;
    if(grille[rr*COLS+cc] !== 0) return false;
  }
  const cx = (c+t/2)*TUILE, cy = (r+t/2)*TUILE, demi = t*TUILE/2 + 28;
  if(noeuds.some(n => Math.abs(n.x-cx) < demi && Math.abs(n.y-cy) < demi)) return false;
  return true;
}
function construireBatiment(camp, type, c, r, ouvriers){
  const D = BATIMENTS[type], C = camps[camp];
  if(C.reserves < D.cout) return null;
  C.reserves -= D.cout;
  const b = creerBatiment(type, camp, c, r, false);
  for(const o of ouvriers){ o.ordre = {type:'construire', bat:b}; o.chemin = null; o.cible = null; }
  return b;
}
function commander(b, typeU){
  const C = camps[b.camp], D = UNITES[typeU];
  if(b.enCours) return false;
  if(b.file.length >= 5){ if(b.camp===campJoueur) message('La file de production est pleine.'); return false; }
  // Un aéroport n'a que trois places : avions présents + avions commandés.
  if(D.avion && aeroportPlein(b)){
    if(b.camp===campJoueur) message('Les trois places de cet aéroport sont prises.');
    return false;
  }
  // Hélicoptères : quatre au plus par aéroport (présents + commandés), hors des places d'avions.
  if(D.forme === 'helico' && helicosPlein(b)){
    if(b.camp===campJoueur) message('Cet aéroport a déjà ' + HELICOS_PAR_AEROPORT + ' hélicoptères (présents et commandés).');
    return false;
  }
  if(C.reserves < D.cout){ if(b.camp===campJoueur) message('Réserves insuffisantes.', 'alerte'); return false; }
  C.reserves -= D.cout; b.file.push(typeU);
  return true;
}
// Le camp a attaque-t-il le camp b ? Par défaut, personne n'attaque le camp neutre N
// et N n'attaque personne ; une mission peut l'autoriser (relations.I_attaque_N...).
// Les envahisseurs (X) sont hostiles à tous les camps de joueurs, pas au camp neutre. Entre camps de
// joueurs : hostiles quand leurs équipes diffèrent (equipeDe : en mission, J et I s'opposent toujours).
// La trêve du mode Surprises (alliance) met fin à toutes les hostilités entre camps de joueurs.
function hostile(a, b){
  if(a === b) return false;
  if(a === 'N' || b === 'N') return !!RELATIONS[a + '_attaque_' + b];
  if(a === 'X' || b === 'X') return true;
  if(alliance) return false;
  return equipeDe(a) !== equipeDe(b);
}
// Deux camps de joueurs distincts du même côté (même équipe, ou trêve contre les envahisseurs).
function allies(a, b){
  if(a === b || a === 'N' || b === 'N' || a === 'X' || b === 'X') return false;
  return alliance || equipeDe(a) === equipeDe(b);
}
// Les bâtiments et unités du joueur et ce qu'il peut voir d'autre sont-ils autorisés en mission ?
// L'aviation est réservée à l'escarmouche : en mission, l'aéroport et les avions sont interdits par
// défaut, même quand la mission ne définit pas « autorises ». Seule une mission qui les nomme
// (dans « autorises » ou par une action « deverrouiller ») les ouvre, pour le joueur comme pour l'IA.
// Même règle pour l'infanterie spécialisée (bazooka, sniper) ajoutée en novembre 2026 : les huit missions
// gardent leur équilibre. Le collecteur, lui, est toujours autorisé (c'est la seule source de revenu).
// Novembre 2026 (second lot) : DCA Rempart, hélicoptères, réparateurs et batterie mixte, de même.
const RESERVES_ESCARMOUCHE = {batiments:new Set(['aeroport', 'batterie']),
  unites:new Set(['f15', 'f35', 'rafale', 'javelot', 'traqueur', 'grenadier', 'guetteur',
    'rempart', 'frelon', 'busard', 'taon', 'vautour', 'mecano', 'atelier', 'infirmier', 'depanneuse'])};
function autorise(genre, type){
  if(!MISSION) return true;
  if(genre === 'unites' && type === 'collecteur') return true;
  const liste = MS.autorises && MS.autorises[genre];
  if(liste) return liste.has(type);
  return !(RESERVES_ESCARMOUCHE[genre] && RESERVES_ESCARMOUCHE[genre].has(type)) || MS.debloques.has(genre + ':' + type);
}

// =====================================================================
//  6. LOGIQUE DES UNITÉS ET DES BÂTIMENTS
// =====================================================================
// Aura d'un bâtiment : le dépôt ne ravitaille que pour la faction dont c'est le bâtiment spécial (Karsk).
function auraActive(b){ return !!b.def.aura && (b.type !== 'depot' || faction(b.camp).special === 'depot'); }
// Bâtiments que le joueur (ou l'IA) peut construire. Les extras de faction (dépôt de Halden) restent
// hors des missions, sauf mission qui les nomme dans ses bâtiments autorisés.
function batimentsConstructibles(F){
  const extras = (F.extras || []).filter(t => !MISSION || (MS.autorises && MS.autorises.batiments && MS.autorises.batiments.has(t)));
  return ['caserne', 'usine', F.special, ...extras, F.defense, 'batterie', 'aeroport'];
}
function dansAura(u){
  const r2 = (faction(u.camp).rayonAura || 0) ** 2;
  if(!r2) return false;
  for(const b of ents){
    if(b.est !== 'batiment' || b.camp !== u.camp || b.enCours || b.mort || !auraActive(b)) continue;
    if((b.x-u.x)**2 + (b.y-u.y)**2 < r2) return true;
  }
  return false;
}
function peutCibler(u, e){
  if(e.mort || e.demo || !hostile(u.camp, e.camp)) return false;   // e.demo : figurant de la vitrine
  if(e.est === 'batiment') return !!u.def.sol;
  if(!enVol(e)) return !!u.def.sol;       // unité terrestre, ou avion posé
  // Appareil furtif : en vol, il n'est repéré (donc visé) qu'à courte distance.
  // Un antiaérien dédié (arme 'aa') le repère de plus loin (PORTEE_REPERAGE_AA) ; un avion armé contre
  // le ciel peut aussi le viser s'il est repéré par une unité ou un bâtiment de son camp (repere).
  if(e.def.furtif && Math.hypot(e.x-u.x, e.y-u.y) > distanceReperage(u, e) && !(u.def.avion && u.def.armeAir && repere(u.camp, e))) return false;
  // Lance-roquettes d'épaule : cibles aériennes lentes seulement (ni avions ni vaisseau-mère).
  if(u.def.pasAvion && (e.def.avion || e.def.blindage === 'vaisseau')) return false;
  return !!u.def.air;
}
const PORTEE_REPERAGE_AA = 300;
function distanceReperage(u, e){ return u.def.arme === 'aa' ? Math.max(e.def.furtif, PORTEE_REPERAGE_AA) : e.def.furtif; }
// Appareil furtif repéré par le camp : à portée de repérage d'une de ses unités ou d'un de ses bâtiments.
function repere(camp, e){
  for(const v of ents){
    if(v.mort || v.camp !== camp || v.enCours || v === e) continue;
    if(Math.hypot(v.x-e.x, v.y-e.y) <= distanceReperage(v, e)) return true;
  }
  return false;
}
// auRepos : unité sans ordre — les bâtiments ne sont retenus qu'à portée réelle.
function chercherCible(u, rayon, auRepos){
  let best = null, bs = Infinity;
  for(const e of ents){
    if(!peutCibler(u,e)) continue;
    const d = distBord(u,e);
    if(d > rayon) continue;
    if(auRepos && e.est === 'batiment' && d > u.def.portee) continue;
    if(u.def.porteeMin && d < u.def.porteeMin) continue;
    let score = d + (e.est === 'batiment' ? 160 : 0) + (e.def.ouvrier ? 40 : 0);
    // Spécialistes : le tireur de précision préfère l'infanterie, le lance-roquettes les blindés.
    const role = u.def.role;
    if(role === 'sniper' && blindageDe(e) !== 'infanterie') score += 400;
    else if(role === 'bazooka' && blindageDe(e) === 'infanterie') score += 150;
    if(score < bs){ bs = score; best = e; }
  }
  return best;
}
function deplacer(u, dt){
  if(!u.chemin || !u.chemin.length) return true;
  const p = u.chemin[0], dx = p.x-u.x, dy = p.y-u.y, d = Math.hypot(dx,dy), v = u.def.vitesse*dt;
  if(d <= Math.max(v,4)){
    if(libre(p.x,p.y) || !libre(u.x,u.y)){ u.x = p.x; u.y = p.y; }
    u.chemin.shift();
    return !u.chemin.length;
  }
  u.angle = tournerVers(u.angle, Math.atan2(dy,dx), dt*7);
  const nx = u.x+dx/d*v, ny = u.y+dy/d*v;
  if(libre(nx,ny) || !libre(u.x,u.y)){ u.x = nx; u.y = ny; }
  else if(libre(nx,u.y)) u.x = nx;
  else if(libre(u.x,ny)) u.y = ny;
  else { u.chemin = null; u.repath = 0; }
  return false;
}
function allerVers(u, x, y, dt){
  if(u.def.aerien){
    const dx = x-u.x, dy = y-u.y, d = Math.hypot(dx,dy);
    if(d < 4) return true;
    const v = Math.min(d, u.def.vitesse*dt);
    u.x += dx/d*v; u.y += dy/d*v;
    u.angle = tournerVers(u.angle, Math.atan2(dy,dx), dt*5);
    return false;
  }
  const dest = u.dest;
  if(!u.chemin || u.repath <= 0 || (dest && Math.hypot(dest.x-x, dest.y-y) > 48 && u.repath < 1.2)){
    u.chemin = trouverChemin(u.x,u.y,x,y) || [{x,y}];
    u.dest = {x,y}; u.repath = 1.5 + Math.random()*0.5;
  }
  return deplacer(u, dt);
}
// Suivi d'une suite de points (action « deplacer » d'une mission).
function suivreChemin(u, dt){
  const o = u.ordre, p = o.points[o.i];
  if(!p){ u.ordre = null; u.chemin = null; return; }
  if(allerVers(u, p.x, p.y, dt) || Math.hypot(p.x-u.x, p.y-u.y) < 26){
    o.i++; u.chemin = null; u.repath = 0;
    if(o.i >= o.points.length){ u.ordre = null; }
  }
}
function majUnite(u, dt){
  const D = u.def;
  u.recharge -= dt; u.repath -= dt; u.scan -= dt; u.auraT -= dt;
  // Régénération d'élite (avions compris), jamais pour le vaisseau-mère (aucune récupération).
  if(u.rang === 2 && D.forme !== 'vaisseauMere') u.pv = Math.min(u.pvMax, u.pv + 1*dt);
  if(D.avion){ majAvion(u, dt); return; }   // modèle de vol propre (ni aura ni point de repos)
  if(D.forme === 'vaisseauMere'){ majVaisseauMere(u, dt); return; }   // mode Surprises (section 14 bis)
  if(u.demo){ u.cible = null; return; }   // vitrine (?demo) : envahisseur immobile, qui n'attaque pas
  if(u.auraT <= 0){ u.auraT = 0.5; u.dansAura = dansAura(u); }
  const fac = camps[u.camp] ? camps[u.camp].faction : 'neutre';
  if(u.dansAura && fac === 'karsk' && temps - u.toucheT > 4) u.pv = Math.min(u.pvMax, u.pv + 3*dt);
  if(D.ouvrier){ majOuvrier(u, dt); return; }
  if(D.collecteur){ majCollecteur(u, dt); return; }
  if(D.repare){ majReparateur(u, dt); return; }

  const o = u.ordre;
  if(!D.arme){
    // Unité sans arme (convoi) : se déplace seulement.
    if(o && o.type === 'chemin') suivreChemin(u, dt);
    else if(o && (o.type === 'aller' || o.type === 'attaqueDeplacement')){ if(allerVers(u, o.x, o.y, dt)){ u.ordre = null; u.chemin = null; } }
    else if(o) u.ordre = null;
    return;
  }
  // Point de repos : position prise quand l'unité se retrouve sans ordre (oublié dès qu'elle en reçoit un).
  if(o) u.repos = null;
  else if(!u.repos){ u.repos = {x:u.x, y:u.y}; u.retourRepos = false; }
  if(o && o.type === 'attaquer'){
    // Cible détruite, ou qui ne peut plus être visée (avion qui s'est posé ou qui a décollé,
    // appareil furtif hors de vue) : l'ordre est terminé.
    if(o.cible.mort || !peutCibler(u, o.cible)){ u.ordre = null; u.cible = null; } else u.cible = o.cible;
  } else if(o && o.type === 'aller'){
    u.cible = null;
  } else {
    // Défenseur de l'IA qui rentre à son poste (ordre de retour de majIAMission) : il riposte
    // seulement à portée réelle, sans reprendre de poursuite (cible hors portée → abandonnée).
    const rentre = !!o && o === u.ordreRetour;
    if(u.cible && (!peutCibler(u, u.cible) || distBord(u,u.cible) > (rentre ? D.portee : D.portee + (o ? 260 : 200)))) u.cible = null;
    if(u.cible && D.porteeMin && distBord(u,u.cible) < D.porteeMin) u.cible = null;
    if(!o && u.cible && !cibleAuRepos(u, u.cible)){ u.cible = null; u.retourRepos = true; }
    if(!u.cible && u.scan <= 0){
      u.scan = 0.3 + Math.random()*0.2;
      // Au retour vers son point de repos, l'unité ne riposte qu'à portée réelle (pas de nouvelle poursuite).
      u.cible = chercherCible(u, D.portee + (rentre ? 0 : o ? 180 : (u.retourRepos ? 0 : 120)), !o);
    }
  }

  if(u.cible){
    const c = u.cible, d = distBord(u,c), ang = Math.atan2(c.y-u.y, c.x-u.x);
    u.angleT = tournerVers(u.angleT, ang, dt*5);
    // porteeAir : portée propre contre les cibles en vol (canon antiaérien du Lynx).
    if(d <= (D.porteeAir && enVol(c) ? D.porteeAir : D.portee)){
      u.chemin = null;
      if(D.forme === 'infanterie' || D.forme === 'artillerie') u.angle = tournerVers(u.angle, ang, dt*4);
      if(u.recharge <= 0 && Math.abs(diffAngle(u.angleT, ang)) < 0.3 && (!D.porteeMin || d >= D.porteeMin)){
        let cad = D.cadence;
        if(u.dansAura && fac === 'karsk') cad *= 0.75;
        u.recharge = cad;
        tirer(u, c);
      }
    } else {
      allerVers(u, c.x, c.y, dt);
    }
    return;
  }
  u.angleT = tournerVers(u.angleT, u.angle, dt*3);
  if(o && (o.type === 'aller' || o.type === 'attaqueDeplacement')){
    if(allerVers(u, o.x, o.y, dt)){ u.ordre = null; u.chemin = null; }
  } else if(o && o.type === 'chemin') suivreChemin(u, dt);
  else if(!o && u.repos){
    // Sans ordre ni cible : retour au point de repos après une poursuite (les petites poussées
    // entre unités voisines, sous REPOS_TOLERANCE, ne déclenchent rien).
    const d = Math.hypot(u.repos.x - u.x, u.repos.y - u.y);
    if(d > REPOS_TOLERANCE) u.retourRepos = true;
    if(u.retourRepos){
      if(d < 16 || allerVers(u, u.repos.x, u.repos.y, dt)){ u.retourRepos = false; u.chemin = null; }
    }
  }
}
// Laisse des unités sans ordre : elles ripostent et poursuivent jusqu'à LAISSE_REPOS px de leur
// point de repos, puis y reviennent. Elles n'attaquent d'elles-mêmes un bâtiment qu'à portée réelle
// (un bâtiment ne bouge pas : seul un ordre du joueur ou du script doit les y envoyer).
// Les ordres explicites (attaquer, attaque-déplacement, chemin de mission) ne sont pas limités.
const LAISSE_REPOS = 250, REPOS_TOLERANCE = 80;
function cibleAuRepos(u, c){
  const d = distBord(u, c);
  if(d <= u.def.portee) return true;   // à portée : on tire, où qu'on soit
  if(c.est === 'batiment') return false;
  if(u.retourRepos || !u.repos) return false;
  return Math.hypot(u.x - u.repos.x, u.y - u.repos.y) < LAISSE_REPOS;
}
function depotProche(u){
  let best = null, bd = Infinity;
  for(const b of ents){
    if(b.est !== 'batiment' || b.camp !== u.camp || b.enCours || b.mort || !b.def.depot) continue;
    const d = dist(u,b); if(d < bd){ bd = d; best = b; }
  }
  return best;
}
function noeudProche(e){
  let best = null, bd = Infinity;
  for(const n of noeuds){ if(n.reste <= 0) continue; const d = dist(e,n); if(d < bd){ bd = d; best = n; } }
  return best;
}
// Bâtiment de son camp à réparer près de l'ouvrier (après un chantier) : à moins de 450 px, entamé
// (moins de 90 % de ses PV), fini. null sinon.
const REPARATION_RAYON = 450;
function batimentAReparer(u, rayon){
  let best = null, bd = rayon || REPARATION_RAYON;
  for(const b of ents){
    if(b.est !== 'batiment' || b.mort || b.enCours || b.camp !== u.camp || b.pv >= b.pvMax*0.9) continue;
    const d = dist(u, b); if(d < bd){ bd = d; best = b; }
  }
  return best;
}
// Ouvriers (technicien, sapeur) : ils construisent et réparent ; ils ne récoltent plus (le collecteur
// s'en charge). Un ordre « recolter » hérité (ancien robot, ancienne mission) est simplement oublié.
function majOuvrier(u, dt){
  const o = u.ordre;
  u.travaille = false;
  if(!o) return;
  if(o.type === 'aller' || o.type === 'attaqueDeplacement'){ if(allerVers(u, o.x, o.y, dt)){ u.ordre = null; u.chemin = null; } return; }
  if(o.type === 'chemin'){ suivreChemin(u, dt); return; }
  if(o.type === 'construire'){
    const b = o.bat;
    if(b.mort || !b.enCours){
      u.ordre = null;
      // Chantier fini : un chantier voisin sans ouvrier, sinon un bâtiment entamé ; sinon il reste sur place.
      const ch = ents.find(e => e.est === 'batiment' && e.enCours && !e.mort && e.camp === u.camp && dist(u, e) < 600 &&
        !ents.some(v => v !== u && v.ordre && v.ordre.type === 'construire' && v.ordre.bat === e));
      if(ch) u.ordre = {type:'construire', bat:ch};
      else { const r = batimentAReparer(u); if(r) u.ordre = {type:'reparer', bat:r}; }
      return;
    }
    if(distBord(u,b) > 30){ allerVers(u, b.x, b.y, dt); return; }
    u.chemin = null; u.travaille = true;
    u.angle = Math.atan2(b.y-u.y, b.x-u.x);
    b.progres += dt / b.def.temps;
    b.pv = Math.min(b.pvMax, b.pv + b.pvMax*0.9*dt/b.def.temps);
    if(b.progres >= 1){
      b.progres = 1; b.enCours = false;
      if(b.camp === campJoueur) message(b.def.nom + ' : construction terminée.', 'succes');
    }
    return;
  }
  if(o.type === 'reparer'){
    // Réparation gratuite : la moitié des PV du bâtiment en un temps de construction (au moins 20 s).
    const b = o.bat;
    if(!b || b.mort || b.enCours || b.pv >= b.pvMax){ u.ordre = null; return; }
    if(distBord(u,b) > 30){ allerVers(u, b.x, b.y, dt); return; }
    u.chemin = null; u.travaille = true;
    u.angle = Math.atan2(b.y-u.y, b.x-u.x);
    b.pv = Math.min(b.pvMax, b.pv + b.pvMax*0.5*dt/Math.max(20, b.def.temps || 40));
    return;
  }
  u.ordre = null;   // ordre inconnu des ouvriers (dont l'ancien « recolter »)
}

// ---------- Réparateurs (mécano, infirmier, atelier mobile, dépanneuse) ----------
// Jamais d'arme. Le fantassin (soigne 'infanterie') soigne l'infanterie et répare les bâtiments ; le
// véhicule (soigne 'vehicules') répare les véhicules, les drones, les hélicoptères et les bâtiments.
// Ni les avions (réparés à l'aéroport) ni le vaisseau-mère. Patients : son camp et ses alliés.
// Ordres compris : 'soigner' {cible} (clic droit sur un allié), 'aller', 'attaqueDeplacement' (il
// soigne en chemin les blessés proches, puis reprend sa route), 'chemin' (missions). Sans ordre : soin
// automatique du blessé le plus proche à moins de SOIN_AUTO px de son point de repos, puis retour.
// Champs tenus pour le rendu : u.repareT (instant du dernier soin, horloge temps), u.cibleSoin.
const SOIN_CONTACT = 40, SOIN_AUTO = 320, SOIN_EN_ROUTE = 200;
function peutSoigner(u, e){
  if(!e || e === u || e.mort || e.demo || e.pv >= e.pvMax - 0.5) return false;
  if(e.camp !== u.camp && !allies(u.camp, e.camp)) return false;
  if(e.est === 'batiment') return !e.enCours && !e.def.neutre;
  const D = e.def;
  if(D.avion || D.forme === 'vaisseauMere') return false;
  const fantassin = D.blindage === 'infanterie';
  return u.def.soigne === 'infanterie' ? fantassin : !fantassin;
}
// Motif de refus d'un ordre « soigner » (fonction pure) : texte à afficher quand la sélection compte des
// réparateurs mais qu'aucun ne peut soigner cet allié, null sinon (soin possible, cible ennemie,
// pas de réparateur, ou autre unité de la sélection qui sait le soigner).
function refusSoin(unites, cible){
  const rep = unites.filter(u => u.def.repare);
  if(!rep.length || !cible || cible.mort || cible.est !== 'unite') return null;
  if(cible.camp !== rep[0].camp && !allies(rep[0].camp, cible.camp)) return null;
  if(rep.some(u => peutSoigner(u, cible))) return null;
  if(rep.includes(cible) && rep.length === 1) return null;
  const D = cible.def;
  if(D.avion) return 'Les avions se réparent à l’aéroport, pas sur le terrain.';
  if(D.forme === 'vaisseauMere') return null;
  const fantassin = D.blindage === 'infanterie';
  const F = camps[rep[0].camp] && FACTIONS[camps[rep[0].camp].faction];
  const [repInf, repVeh] = (F && F.reparateurs) || ['mecano', 'atelier'];
  const nom = t => (UNITES[t] && UNITES[t].nom) || t;
  if(fantassin && rep.every(u => u.def.soigne !== 'infanterie'))
    return rep[0].def.nom + ' répare les véhicules, les hélicoptères et les bâtiments, pas l’infanterie : pour soigner un fantassin, il faut un ' + nom(repInf) + '.';
  if(!fantassin && rep.every(u => u.def.soigne === 'infanterie'))
    return rep[0].def.nom + ' soigne l’infanterie et répare les bâtiments, pas les véhicules : pour ' + D.nom + ', il faut ' + (repVeh === 'depanneuse' ? 'une ' : 'un ') + nom(repVeh) + '.';
  return null;
}
function patientProche(u, cx, cy, rayon){
  let best = null, bd = Infinity;
  for(const e of ents){
    if(!peutSoigner(u, e)) continue;
    const d = Math.hypot(e.x - cx, e.y - cy) - (e.rayon || 0);
    if(d > rayon) continue;
    // Les unités passent avant les bâtiments, et les plus entamées d'abord.
    const s = d + (e.est === 'batiment' ? 150 : 0) + 120*(e.pv/e.pvMax);
    if(s < bd){ bd = s; best = e; }
  }
  return best;
}
// Une étape de soin : approche du patient, puis PV rendus au contact. Vrai tant que le soin continue.
function soigner(u, e, dt){
  if(!peutSoigner(u, e)){ u.cibleSoin = null; return false; }
  u.cibleSoin = e;
  if(distBord(u, e) > SOIN_CONTACT){ allerVers(u, e.x, e.y, dt); return true; }
  u.chemin = null;
  const ang = Math.atan2(e.y - u.y, e.x - u.x);
  u.angle = tournerVers(u.angle, ang, dt*6); u.angleT = u.angle;
  const k = e.est === 'batiment' ? u.def.soinBat : u.def.soin;
  e.pv = Math.min(e.pvMax, e.pv + k*dt);
  u.repareT = temps; u.travaille = true;
  return e.pv < e.pvMax - 0.5;
}
function majReparateur(u, dt){
  const o = u.ordre;
  u.travaille = false;
  if(o) u.repos = null; else if(!u.repos) u.repos = {x:u.x, y:u.y};
  if(o && o.type === 'soigner'){
    if(!soigner(u, o.cible, dt)){ u.ordre = null; u.cibleSoin = null; }
    return;
  }
  // Soin en cours (automatique ou en route) : il continue tant que le patient en a besoin.
  if(u.cibleSoin && (!o || o.type === 'attaqueDeplacement')){
    if(soigner(u, u.cibleSoin, dt)) return;
    u.cibleSoin = null;
  }
  if((!o || o.type === 'attaqueDeplacement') && u.scan <= 0){
    u.scan = 0.4 + Math.random()*0.2;
    const p = !o ? patientProche(u, u.repos.x, u.repos.y, SOIN_AUTO) : patientProche(u, u.x, u.y, SOIN_EN_ROUTE);
    if(p){ u.cibleSoin = p; soigner(u, p, dt); return; }
  }
  if(o && o.type === 'chemin'){ suivreChemin(u, dt); return; }
  if(o && (o.type === 'aller' || o.type === 'attaqueDeplacement')){
    if(allerVers(u, o.x, o.y, dt)){ u.ordre = null; u.chemin = null; }
    return;
  }
  if(o){ u.ordre = null; return; }   // ordre inconnu (attaquer...) : oublié, il n'a pas d'arme
  // Retour au point de repos après un soin automatique.
  const d = Math.hypot(u.repos.x - u.x, u.repos.y - u.y);
  if(d > REPOS_TOLERANCE){ if(allerVers(u, u.repos.x, u.repos.y, dt)) u.chemin = null; }
}

// ---------- Collecteurs ----------
// Navette automatique : champ de minerai -> chargement progressif (def.chargement par seconde) -> dépôt
// ou QG le plus proche -> déchargement (def.dechargement s) -> retour au champ. Champ épuisé : le
// collecteur passe au champ le plus proche. Sans dépôt ni QG, il attend sur place, chargé, et repart dès
// qu'un dépôt existe. Sans ordre, il reprend la récolte de lui-même après COLLECTE_REPRISE s, sauf
// s'il a été garé par le bouton Arrêt (u.gare). Ordres compris : 'recolter' {noeud}, 'aller',
// 'attaqueDeplacement' (traité comme 'aller'), 'chemin' (missions).
const COLLECTE_DIST = 30, COLLECTE_DEPOT = 34, COLLECTE_REPRISE = 1.5, COLLECTE_MENACE = 420;
// Champ choisi : le plus proche, en évitant ceux qu'une défense ennemie tient sous son feu.
function champPour(u){
  let best = null, bs = Infinity;
  for(const n of noeuds){
    if(n.reste <= 0) continue;
    let s = dist(u, n);
    if(s - 900 >= bs) continue;
    // Ultra : champ signalé menacé par l'analyse (defendreUltra), évité un moment.
    const SU = etatsIA[u.camp] && etatsIA[u.camp].ultra;
    if(SU && SU.champsMenaces.has(n) && SU.champsMenaces.get(n) > temps) s += 900;
    // Ultra : un champ plus proche d'un bâtiment ennemi que du collecteur est un champ disputé, pris en dernier.
    if(SU && SU.analyse && Object.values(SU.analyse.ennemis).some(K => K.bats.some(b => dist(b, n) < dist(u, n)))) s += 500;
    if(ents.some(b => b.est === 'batiment' && !b.mort && b.def.arme && hostile(u.camp, b.camp) && dist(b, n) < COLLECTE_MENACE)) s += 900;
    if(s < bs){ bs = s; best = n; }
  }
  return best;
}
function ordreRecolte(n){ return {type:'recolter', noeud:n, ox:(Math.random()-.5)*44, oy:(Math.random()-.5)*44, retour:false, decharge:0}; }
function majCollecteur(u, dt){
  const D = u.def;
  let o = u.ordre;
  u.travaille = false; u.attenteDepot = false;
  if(o && (o.type === 'aller' || o.type === 'attaqueDeplacement')){
    if(allerVers(u, o.x, o.y, dt)){ u.ordre = null; u.chemin = null; u.inactifT = 0; }
    return;
  }
  if(o && o.type === 'chemin'){ suivreChemin(u, dt); return; }
  if(o && o.type !== 'recolter'){ u.ordre = o = null; }
  if(!o){
    if(u.gare) return;
    u.inactifT = (u.inactifT || 0) + dt;
    if(u.inactifT < COLLECTE_REPRISE) return;
    u.inactifT = 0;
    const n = champPour(u);
    if(!n && !(u.charge > 0)) return;          // plus aucun champ : il attend
    u.ordre = o = ordreRecolte(n);
    if(u.charge > 0) o.retour = true;
  }
  // Retour au dépôt : plein, ou chargé sans plus aucun champ.
  if(u.charge >= D.capacite - 1e-6) o.retour = true;
  if(!o.retour && (!o.noeud || o.noeud.reste <= 0)){
    const n = champPour(u);
    if(n){ Object.assign(o, ordreRecolte(n)); }
    else if(u.charge > 0) o.retour = true;
    else { u.ordre = null; u.chemin = null; return; }
  }
  if(o.retour){
    const d = depotProche(u);
    if(!d){ u.chemin = null; u.attenteDepot = true; return; }   // comportement sûr : il attend un dépôt
    if(distBord(u, d) > COLLECTE_DEPOT){ allerVers(u, d.x, d.y, dt); o.decharge = 0; return; }
    u.chemin = null; u.travaille = true;
    o.decharge += dt;
    if(o.decharge < D.dechargement) return;
    const mult = camps[u.camp] && camps[u.camp].ia ? etatIA(u.camp).revenu : 1;   // bonus de difficulté des ordinateurs
    const gain = Math.round(u.charge * mult);
    if(camps[u.camp]) camps[u.camp].reserves += gain;
    if(u.camp === campJoueur) MS.recolte += gain;
    u.charge = 0; o.retour = false; o.decharge = 0;
    return;
  }
  const n = o.noeud, tx = n.x + o.ox, ty = n.y + o.oy;
  if(dist(u, n) > COLLECTE_DIST + 14 && Math.hypot(tx - u.x, ty - u.y) > 10){ allerVers(u, tx, ty, dt); return; }
  u.chemin = null; u.travaille = true;
  const q = Math.min(D.chargement*dt, D.capacite - u.charge, n.reste);
  n.reste = Math.max(0, n.reste - q); u.charge += q; u.recolteT = temps;
}
function majBatiment(b, dt){
  if(b.enCours) return;
  if(b.def.arme) majDefense(b, dt);
  if(!b.file.length) return;
  const type = b.file[0], D = UNITES[type];
  // b.blocage : motif de la suspension ('effectif' ou 'places'), pour le texte du panneau.
  if(population[b.camp] >= popMax){ b.bloque = true; b.blocage = 'effectif'; return; }
  if(D.avion && placeLibre(b) < 0){ b.bloque = true; b.blocage = 'places'; return; }
  b.bloque = false;
  b.prodT += dt;
  if(b.prodT < D.temps) return;
  b.prodT = 0; b.file.shift();
  if(D.avion){
    // L'avion sort du hangar sur une place libre ; un point de ralliement devient son point d'attente.
    const u = creerUnite(type, b.camp, b.x, b.y);
    stationnerAvion(u, b, placeLibre(b));
    population[b.camp]++;
    if(b.rally) u.ordre = {type:'aller', x:b.rally.x, y:b.rally.y};
    if(b.camp === campJoueur) message(D.nom + ' prêt à l’aéroport.', 'succes');
    return;
  }
  const p = D.aerien ? {x:b.x, y:b.y+b.rayon+10} : positionSortie(b);
  const u = creerUnite(type, b.camp, p.x, p.y);
  population[b.camp]++;
  if(D.forme === 'helico') u.heliport = b;
  if(D.collecteur){
    // Collecteur : vers le champ du point de ralliement s'il y en a un, sinon le plus proche.
    const n = b.rally ? noeuds.find(k => k.reste > 0 && Math.hypot(k.x-b.rally.x, k.y-b.rally.y) < k.rayon + 20) : null;
    const c = n || champPour(u);
    if(c) u.ordre = ordreRecolte(c);
    if(b.camp === campJoueur) message('Collecteur prêt : il part récolter.', 'succes');
  } else if(D.ouvrier){
    if(b.rally) u.ordre = {type:'aller', x:b.rally.x, y:b.rally.y};
  } else if(b.rally){
    u.ordre = {type:'attaqueDeplacement', x:b.rally.x + (Math.random()-.5)*40, y:b.rally.y + (Math.random()-.5)*40};
  } else {
    u.ordre = {type:'aller', x:p.x + (Math.random()-.5)*60, y:p.y + 30 + Math.random()*30};
  }
}
// Défense fixe : acquiert et tire comme une unité immobile (b.angleT, b.tirT pour le rendu).
function majDefense(b, dt){
  const D = b.def;
  b.recharge -= dt; b.scan -= dt; b.auraT -= dt;
  if(b.auraT <= 0){ b.auraT = 0.5; b.dansAura = dansAura(b); }
  if(b.cible && (b.cible.mort || !peutCibler(b, b.cible) || distBord(b, b.cible) > D.portee)) b.cible = null;
  if(!b.cible && b.scan <= 0){ b.scan = 0.3 + Math.random()*0.2; b.cible = chercherCible(b, D.portee); }
  if(!b.cible) return;
  const c = b.cible, ang = Math.atan2(c.y-b.y, c.x-b.x);
  b.angleT = tournerVers(b.angleT, ang, dt*4);
  if(b.recharge <= 0 && Math.abs(diffAngle(b.angleT, ang)) < 0.25){
    let cad = armeContre(b, c).cadence;
    if(b.dansAura && camps[b.camp] && camps[b.camp].faction === 'karsk') cad *= 0.75;
    b.recharge = cad;
    tirer(b, c);
  }
}

// ---------- Aviation ----------
// Modèle de vol volontairement simple : en vol, un avion avance toujours (jamais de surplace) et
// tourne à taux limité (def.virage, rad/s). Champs tenus sur chaque avion et lus par le rendu 3D :
//   u.alt (0 au sol, ALT_CROISIERE en vol), u.auSol (vrai quand il est stationné ou se réarme),
//   u.vit (vitesse courante, px/s), u.angle (cap), u.tirT (instant du dernier tir).
// Autres champs : u.phase, u.base (son aéroport, ou null), u.place (0 à 2), u.munitions,
//   u.attente ({x, y} : point d'attente ; null = il rentre se poser quand il n'a plus rien à faire).
// Phases (u.phase) :
//   'sol'        stationné sur sa place : réarmement, réparation ; il décolle s'il a un ordre ou un
//                point d'attente, une fois réarmé ;
//   'sortie'     roule de sa place au seuil de piste ;
//   'decollage'  accélère sur la piste, puis monte dans l'axe ;
//   'vol'        vol libre : ordres, passes d'attaque, cercle autour du point d'attente ;
//   'approche'   rejoint l'entrée de l'axe de piste ;
//   'finale'     descend le long de l'axe jusqu'au seuil ;
//   'roulage'    freine sur la piste ;
//   'rangement'  roule jusqu'à sa place et se tourne nez au sud.
// Ordres compris (u.ordre) : 'aller' (nouveau point d'attente), 'attaqueDeplacement' (point d'attente
// offensif : il engage tout ce qu'il repère autour), 'attaquer' (passes sur la cible, reprises après
// chaque réarmement tant qu'elle vit), 'rentrer' (retour à l'aéroport ; il y reste), 'chemin' (missions).
const PLACES_AEROPORT = [{x:-55, y:-15}, {x:-15, y:-15}, {x:25, y:-15}];   // décalages / centre, nez au sud
const PISTE_Y = 52;          // axe de la piste, d'est en ouest (décalage y par rapport au centre)
const PISTE_SEUIL = 66;      // toucher des roues et départ de la course (décalage x, du côté d'où l'on vient)
const PISTE_ENVOL = 80;      // course au sol avant de quitter la piste (px)
const TAXI = 70, ACCEL_PISTE = 260, FREINAGE = 200, ACCEL_VOL = 150, MONTEE = 70, DESCENTE_MAX = 90;
const APPROCHE_DIST = 430;   // entrée de l'axe de piste : distance au seuil (px)
const FINALE_PENTE = 380;    // la descente occupe les derniers px avant le seuil
const REARMEMENT = 6;        // secondes au sol pour refaire le plein de munitions
const REPARATION_SOL = 10;   // PV rendus par seconde à un avion stationné
const PISTE_DELAI_DECOLLAGE = 2.6, PISTE_DELAI_ATTERRISSAGE = 4;   // espacement des mouvements sur une piste (s)
const VITESSE_MISSILE = 640, GUIDAGE_BOMBE = 110;   // px/s
const LAISSE_AVION = 700;    // un avion en attente n'engage pas au-delà de cette distance de son point d'attente
const MARGE_CARTE_VOL = 260; // un avion sorti de la carte de plus de cette marge fait demi-tour

function avionsDe(b){ const l = []; for(const u of ents) if(!u.mort && u.base === b) l.push(u); return l; }
// Places d'avions prises : avions présents + avions en file (les hélicoptères en file ne comptent pas).
function aeroportPlein(b){ return avionsDe(b).length + b.file.filter(t => UNITES[t] && UNITES[t].avion).length >= PLACES_AEROPORT.length; }
// Hélicoptères : HELICOS_PAR_AEROPORT au plus par aéroport, présents (u.heliport) + en file.
const HELICOS_PAR_AEROPORT = 4;
function helicosDe(b){ let n = 0; for(const u of ents) if(!u.mort && u.heliport === b) n++; return n; }
function helicosPlein(b){ return helicosDe(b) + b.file.filter(t => UNITES[t] && UNITES[t].forme === 'helico').length >= HELICOS_PAR_AEROPORT; }
// Première place de stationnement libre de l'aéroport (0 à 2), ou -1.
function placeLibre(b){
  let prises = 0;
  for(const u of ents) if(!u.mort && u.base === b && u.place >= 0) prises |= 1 << u.place;
  for(let i=0; i<PLACES_AEROPORT.length; i++) if(!(prises & (1 << i))) return i;
  return -1;
}
// Pose un avion sur une place de l'aéroport b, armé et prêt à partir (production, vitrine, missions).
function stationnerAvion(u, b, place){
  u.base = b; u.place = place >= 0 ? place : 0;
  const p = PLACES_AEROPORT[u.place];
  u.x = b.x + p.x; u.y = b.y + p.y; u.angle = u.angleT = Math.PI/2;
  u.alt = 0; u.vit = 0; u.auSol = true; u.phase = 'sol';
  u.attente = null; u.cible = null; u.passe = null;
  u.munitions = u.def.munitions; u.rearmeT = 0; u.pretT = temps;
  return u;
}
// Aéroport d'un avion : le sien ; sinon le plus proche de son camp qui a une place libre, qu'il
// adopte. null s'il n'y en a aucun : l'avion reste en l'air et cherche de nouveau chaque seconde.
function baseAvion(u){
  if(u.base && !u.base.mort) return u.base;
  u.base = null; u.place = -1;
  if(temps < u.rechercheT) return null;
  u.rechercheT = temps + 1;
  let best = null, bd = Infinity;
  for(const b of ents){
    if(b.est !== 'batiment' || !b.def.aeroport || b.camp !== u.camp || b.mort || b.enCours) continue;
    if(aeroportPlein(b)) continue;
    const d = dist(u, b);
    if(d < bd){ bd = d; best = b; }
  }
  if(best){ u.base = best; u.place = placeLibre(best); }
  return best;
}
// Vol : tourne vers le cap voulu (taux de virage limité) et avance toujours.
// kv : fraction de la vitesse maximale visée. sansRappel : pas de demi-tour hors carte (approche).
function volVers(u, cap, dt, kv, sansRappel){
  const D = u.def;
  if(!sansRappel && (u.x < -MARGE_CARTE_VOL || u.y < -MARGE_CARTE_VOL || u.x > LARG + MARGE_CARTE_VOL || u.y > HAUT + MARGE_CARTE_VOL))
    cap = Math.atan2(HAUT/2 - u.y, LARG/2 - u.x);
  u.angle = tournerVers(u.angle, cap, D.virage*dt);
  const dv = D.vitesse*kv - u.vit;
  u.vit = Math.max(90, u.vit + Math.max(-ACCEL_VOL*dt, Math.min(ACCEL_VOL*dt, dv)));
  u.x += Math.cos(u.angle)*u.vit*dt; u.y += Math.sin(u.angle)*u.vit*dt;
}
// Cercle de rayon R autour de (px, py), parcouru dans le sens donné (+1 ou -1) à la fraction kv de
// la vitesse maximale. De loin, l'avion vient droit sur le centre ; de près, il suit la tangente,
// corrigée vers l'intérieur ou l'extérieur selon son écart au cercle.
function orbiter(u, px, py, dt, R, sens, kv, sansRappel){
  const dx = u.x - px, dy = u.y - py, d = Math.hypot(dx, dy);
  if(d > R*2.2){ volVers(u, Math.atan2(-dy, -dx), dt, 1, sansRappel); return; }
  const ecart = Math.max(-1, Math.min(1, 1.5*(d - R)/R));
  volVers(u, Math.atan2(dy, dx) + sens*(Math.PI/2 + ecart), dt, kv, sansRappel);
}
// Rayons des cercles : 1,3 fois le rayon de virage à la vitesse du cercle (attente : 70 % de la
// vitesse maximale ; approche : 60 %), pour que l'avion tienne le cercle sans forcer.
function rayonOrbite(u){ return Math.max(150, 1.3*0.7*u.def.vitesse/u.def.virage); }
function rayonApproche(u){ return Math.max(130, 1.3*0.6*u.def.vitesse/u.def.virage); }
function attendre(u, dt){ orbiter(u, u.attente.x, u.attente.y, dt, rayonOrbite(u), u.sensOrbite || 1, 0.7); }
// Cible qu'un avion en attente engage de lui-même : la mieux placée dans son rayon de détection,
// à moins de LAISSE_AVION px de son point d'attente. offensif (attaque-déplacement) : tout ce qu'il
// peut viser ; sinon un chasseur ne s'occupe que du ciel et personne ne s'en prend aux bâtiments désarmés.
function chercherCibleAvion(u, offensif){
  const D = u.def, A = u.attente;
  let best = null, bs = Infinity;
  for(const e of ents){
    if(!peutCibler(u, e)) continue;
    const vole = enVol(e);
    if(!offensif && ((!vole && D.chasse) || (e.est === 'batiment' && !e.def.arme))) continue;
    // Chasseur en attaque-déplacement : au sol, seulement une proie que son canon blesse vraiment
    // (efficacité d'au moins 0,5), jamais un bâtiment ni une unité qui tire en l'air (il y laissait
    // ses avions sans rien tuer). Un ordre « attaquer » explicite du joueur ne passe pas par ici.
    if(!vole && D.chasse && (e.est === 'batiment' || (e.def.arme && e.def.air) || !D.armeSol || efficacite(D.armeSol.arme, e) < 0.5)) continue;
    const d = Math.hypot(e.x-u.x, e.y-u.y);
    if(d > D.detection) continue;
    if(A && Math.hypot(e.x-A.x, e.y-A.y) > LAISSE_AVION) continue;
    let score = d;
    if(vole) score -= 400;                                           // le ciel d'abord
    else if(e.est === 'batiment') score += 120;
    else if(D.armeSol && D.armeSol.arme === 'bombe' && e.def.blindage === 'infanterie') score += 220;   // une bombe vaut mieux qu'un fantassin
    if(score < bs){ bs = score; best = e; }
  }
  return best;
}
// Tir d'un avion avec l'arme A (def.armeAir ou def.armeSol) : missile, bombe ou canon de bord.
// Seules les armes à munitions comptées (missiles, bombes) décrémentent u.munitions : le canon de bord
// (canonAir) tire sans compter et ne vide pas la réserve de missiles.
function tirerAvion(u, c, A, d){
  u.tirT = temps; u.recharge = A.cadence; u.poursuiteT = 0;
  if(A.arme === 'missileAir' || A.arme === 'bombe') u.munitions--;
  const deg = A.degats * (1 + 0.2*(u.rang || 0));
  const h1 = Math.max(4, u.alt - 3);
  if(A.arme === 'missileAir'){
    projectiles.push({genre:'missileAir', arme:A.arme, sx:u.x, sy:u.y, tx:c.x, ty:c.y, h1, h2:hauteurVisee(c), t:0,
      duree:Math.max(0.25, d/VITESSE_MISSILE), degats:deg, zone:0, camp:u.camp, auteur:u, cible:c});
  } else if(A.arme === 'bombe'){
    projectiles.push({genre:'bombe', arme:A.arme, sx:u.x, sy:u.y, tx:c.x, ty:c.y, h1, h2:0, t:0,
      duree:Math.max(0.6, d/Math.max(120, u.vit)), degats:deg, zone:A.zone || 50, camp:u.camp, auteur:u, cible:c});
  } else {
    infliger(c, deg * efficacite(A.arme, c), u);
    const lg = LONG_CANON[u.type] || 12, ex = u.x + Math.cos(u.angle)*lg, ey = u.y + Math.sin(u.angle)*lg;
    effet('trait', {x1:ex, y1:ey, h1, x2:c.x, y2:c.y, h2:hauteurVisee(c), duree:0.07, couleur:'#fff1a8', largeur:1.5, arme:'balle'});
    effet('eclair', {x:ex, y:ey, h:h1, duree:0.06, arme:'balle'});
  }
}
// Passe d'attaque : l'avion fonce sur la cible, tire dès qu'elle est à portée et dans l'axe, la
// dépasse, dégage tout droit, puis revient pour la passe suivante.
function passeAttaque(u, c, dt){
  const D = u.def, vole = enVol(c), A = vole ? D.armeAir : D.armeSol;
  if(!A){ u.cible = null; return; }
  // Cible immense (vaisseau-mère) : distances comptées depuis sa coque, pour tirer à portée réelle et
  // dégager avant de survoler sa défense rapprochée (sinon l'avion fonçait jusqu'à son centre).
  const dx = c.x - u.x, dy = c.y - u.y, cap = Math.atan2(dy, dx);
  const d = Math.max(1, Math.hypot(dx, dy) - ((c.rayon || 0) > 60 ? c.rayon*0.8 : 0));
  u.angleT = cap;
  if(u.passe === 'degagement'){
    u.passeT -= dt;
    if(u.passeT > 0 && d < u.degage){ volVers(u, u.angle, dt, 1); return; }
    u.passe = null;
  }
  volVers(u, cap, dt, 1);
  const ecart = Math.abs(diffAngle(u.angle, cap)), virage = D.vitesse/D.virage;
  if(d <= A.portee && ecart < (A.cone || 0.3) && u.recharge <= 0 && u.munitions > 0) tirerAvion(u, c, A, d);
  u.poursuiteT += dt;
  // Fin de passe : cible dépassée, ou coincée à l'intérieur de son cercle de virage (il lui tournerait
  // autour sans jamais l'avoir dans l'axe) ; une poursuite qui s'éternise est rompue de la même façon.
  const depassee = d < ((c.rayon || 0) > 60 ? 170 : vole ? 70 : 45), coincee = d < virage*2 && ecart > 1.1, longue = vole && u.poursuiteT > 6 + (u.id % 5)*0.6;
  if(depassee || coincee || longue){
    u.passe = 'degagement'; u.poursuiteT = 0;
    u.degage = vole ? virage*2.4 : A.portee + virage*1.25;
    u.passeT = vole ? 1.2 + Math.random()*1.2 : 5;
  }
}
// Stationné : réarmement, réparation, puis décollage dès qu'il a une raison de voler.
function avionAuSol(u, dt){
  const D = u.def, b = u.base;
  if(!b){ u.phase = 'vol'; u.auSol = false; return; }   // filet : jamais d'avion posé sans aéroport
  u.auSol = true; u.alt = 0; u.vit = 0; u.cible = null; u.passe = null;
  u.angle = tournerVers(u.angle, Math.PI/2, dt*3);
  if(u.pv < u.pvMax) u.pv = Math.min(u.pvMax, u.pv + REPARATION_SOL*dt);
  if(u.munitions < D.munitions){
    u.rearmeT -= dt;
    if(u.rearmeT > 0) return;
    u.munitions = D.munitions; u.pretT = temps;
  }
  let o = u.ordre;
  if(o && (o.type === 'rentrer' || (o.type === 'attaquer' && (o.cible.mort || !peutCibler(u, o.cible))))) u.ordre = o = null;
  const but = o ? (o.type === 'attaquer' ? o.cible : o.type === 'chemin' ? o.points[o.i] : o) : u.attente;
  if(!o && u.pv < u.pvMax*0.66) return;   // sans ordre, il ne repart qu'aux deux tiers de ses PV
  if(!but || !isFinite(but.x) || temps < (b.pisteT || 0)) return;
  // Départ, face au côté où se trouve sa destination ; un seul mouvement à la fois sur la piste.
  b.pisteT = temps + PISTE_DELAI_DECOLLAGE;
  u.sensPiste = but.x >= b.x ? 1 : -1;
  u.phase = 'sortie'; u.auSol = false;
}
function avionDecolle(u, dt){
  const D = u.def, b = u.base, s = u.sensPiste || 1;
  if(!b){ u.phase = 'vol'; return; }
  const cap = s > 0 ? 0 : Math.PI, xSeuil = b.x - s*PISTE_SEUIL, yAxe = b.y + PISTE_Y;
  if(u.phase === 'sortie'){
    const dx = xSeuil - u.x, dy = yAxe - u.y, d = Math.hypot(dx, dy);
    if(d > 2){
      u.vit = TAXI;
      u.angle = tournerVers(u.angle, Math.atan2(dy, dx), dt*5);
      const v = Math.min(d, TAXI*dt); u.x += dx/d*v; u.y += dy/d*v;
    } else {
      u.x = xSeuil; u.y = yAxe; u.vit = 0;
      u.angle = tournerVers(u.angle, cap, dt*4);
      if(Math.abs(diffAngle(u.angle, cap)) < 0.03){ u.angle = cap; u.phase = 'decollage'; }
    }
    return;
  }
  // Course sur la piste, puis montée dans l'axe ; le vol libre commence une fois la piste dégagée.
  u.vit = Math.min(D.vitesse, u.vit + ACCEL_PISTE*dt);
  u.x += s*u.vit*dt;
  if((u.x - xSeuil)*s > PISTE_ENVOL) u.alt = Math.min(ALT_CROISIERE, u.alt + MONTEE*dt);
  if(u.alt >= 28) u.phase = 'vol';
}
// Début d'approche. Sens d'atterrissage (u.sensPiste) : face à l'est (+1) quand l'avion arrive par
// l'ouest, et inversement. L'avion rejoint ensuite un cercle d'approche tangent à l'axe de piste au
// point d'entrée (à APPROCHE_DIST px du seuil), du côté de l'axe où il se trouve (u.coteApproche :
// +1 au sud, -1 au nord) : il en sort aligné sur la piste. Si la piste est prise, il refait un tour.
function engagerApproche(u, b){
  let s = u.x <= b.x ? 1 : -1;
  const xEntree = b.x - s*(PISTE_SEUIL + APPROCHE_DIST);
  if(xEntree < 0 || xEntree > LARG) s = -s;            // l'entrée de l'axe reste au-dessus de la carte
  u.sensPiste = s; u.coteApproche = u.y >= b.y + PISTE_Y ? 1 : -1;
  u.phase = 'approche'; u.cible = null; u.passe = null;
}
function avionSePose(u, dt){
  const D = u.def, b = u.base;
  if(!b){ u.phase = 'vol'; u.place = -1; return; }      // aéroport détruit pendant l'approche
  const s = u.sensPiste || 1, cap = s > 0 ? 0 : Math.PI, xSeuil = b.x - s*PISTE_SEUIL, yAxe = b.y + PISTE_Y;
  const o = u.ordre, rappel = u.munitions > 0 && !!o && o.type !== 'rentrer';   // nouvel ordre : il repart
  if(u.phase === 'approche'){
    if(rappel){ u.phase = 'vol'; return; }
    if(u.alt < ALT_CROISIERE) u.alt = Math.min(ALT_CROISIERE, u.alt + MONTEE*dt);   // après une remise de gaz
    // Cercle d'approche, tangent à l'axe au point d'entrée (xe, yAxe) ; son sens de rotation fait
    // passer l'avion par ce point avec le cap de la piste. Il part en finale à ce passage, si la
    // piste est libre ; sinon il refait un tour.
    const xe = xSeuil - s*APPROCHE_DIST, R = rayonApproche(u), cote = u.coteApproche || 1;
    if(Math.abs(u.x - xe) < 80 && Math.abs(u.y - yAxe) < 55 && Math.abs(diffAngle(u.angle, cap)) < 0.4 && temps >= (b.pisteT || 0)){
      b.pisteT = temps + PISTE_DELAI_ATTERRISSAGE; u.phase = 'finale';
      return;
    }
    orbiter(u, xe, yAxe + cote*R, dt, R, s*cote, 0.6, true);
    return;
  }
  if(u.phase === 'finale'){
    if(rappel && u.alt > 30){ u.phase = 'vol'; return; }
    const dAxe = (xSeuil - u.x)*s, lat = u.y - yAxe;     // distance au seuil le long de l'axe, écart latéral
    // Suivi de l'axe : il vise un point de l'axe situé un peu devant lui.
    volVers(u, Math.atan2(yAxe - u.y, s*120), dt, 0.55, true);
    // Descente régulière jusqu'au seuil.
    const voulue = ALT_CROISIERE*Math.max(0, Math.min(1, dAxe/FINALE_PENTE));
    u.alt = Math.max(voulue, u.alt - DESCENTE_MAX*dt);
    if(dAxe < 170){
      // Courte finale. Trop de travers : remise de gaz (deux au plus), il refait son approche.
      const travers = Math.abs(lat) > 45 || Math.abs(diffAngle(u.angle, cap)) > 0.7;
      if(dAxe > 110 && travers && u.remises < 2){ u.remises++; engagerApproche(u, b); return; }
      // Calage sur l'axe : filet qui garantit un toucher sur la piste.
      u.y -= lat*Math.min(1, dt*5);
      u.angle = tournerVers(u.angle, cap, dt*2.5);
    }
    if(dAxe <= 0){ u.alt = 0; u.y = yAxe; u.angle = cap; u.remises = 0; u.phase = 'roulage'; }
    return;
  }
  if(u.phase === 'roulage'){
    u.alt = 0; u.angle = cap; u.y = yAxe;
    u.vit = Math.max(TAXI, u.vit - FREINAGE*dt);
    u.x += s*u.vit*dt;
    if(u.vit <= TAXI + 1 || (u.x - b.x)*s > PISTE_SEUIL - 10){ u.vit = TAXI; u.phase = 'rangement'; }
    return;
  }
  // Rangement : roule jusqu'à sa place, puis pivote nez au sud.
  if(u.place < 0) u.place = Math.max(0, placeLibre(b));
  const p = PLACES_AEROPORT[u.place], dx = b.x + p.x - u.x, dy = b.y + p.y - u.y, d = Math.hypot(dx, dy);
  u.alt = 0;
  if(d > 2){
    u.vit = TAXI;
    u.angle = tournerVers(u.angle, Math.atan2(dy, dx), dt*5);
    const v = Math.min(d, TAXI*dt); u.x += dx/d*v; u.y += dy/d*v;
  } else {
    u.x = b.x + p.x; u.y = b.y + p.y; u.vit = 0;
    u.angle = tournerVers(u.angle, Math.PI/2, dt*4);
    if(Math.abs(diffAngle(u.angle, Math.PI/2)) < 0.05){
      u.angle = Math.PI/2; u.phase = 'sol'; u.auSol = true;
      u.rearmeT = u.munitions < D.munitions ? REARMEMENT : 0;
      if(u.munitions >= D.munitions) u.pretT = temps;
      if(u.ordre && u.ordre.type === 'rentrer') u.ordre = null;
    }
  }
}
function avionEnVol(u, dt){
  const D = u.def;
  if(u.alt < ALT_CROISIERE) u.alt = Math.min(ALT_CROISIERE, u.alt + MONTEE*dt);   // fin de montée
  let o = u.ordre;
  // Avion très entamé (sous 35 % de ses PV, tout camp ; l'IA le décidait déjà dans majIAAviation) :
  // il rentre se faire réparer et réarmer, son point d'attente gardé pour y retourner ensuite.
  if(u.pv < u.pvMax*0.35 && baseAvion(u) && (!o || o.type !== 'rentrer')){ u.ordre = o = {type:'rentrer'}; u.cible = null; u.passe = null; }
  // --- Retour à la base : munitions épuisées, ou ordre « rentrer » ---
  if(u.munitions <= 0 || (o && o.type === 'rentrer')){
    u.cible = null; u.passe = null;
    const b = baseAvion(u);
    if(b){ engagerApproche(u, b); return; }
    // Aucun aéroport pour l'accueillir : il attend en l'air, jusqu'à ce qu'il y en ait un.
    if(o && o.type === 'rentrer') u.ordre = null;
    if(!u.attente) u.attente = {x:Math.max(0, Math.min(LARG, u.x)), y:Math.max(0, Math.min(HAUT, u.y))};
    attendre(u, dt);
    return;
  }
  // --- Ordres ---
  if(o && o.type === 'attaquer'){
    if(o.cible.mort || !peutCibler(u, o.cible)){ u.ordre = o = null; u.cible = null; u.passe = null; }
    else u.cible = o.cible;
  } else if(o && (o.type === 'aller' || o.type === 'chemin')){
    // Déplacement : nouveau point d'attente (dernier point d'un chemin de mission), sans combat en route.
    const p = o.type === 'chemin' ? o.points[o.i] : o;
    u.cible = null; u.passe = null;
    if(!p){ u.ordre = null; }
    else if(Math.hypot(p.x - u.x, p.y - u.y) < rayonOrbite(u)*1.3){
      if(o.type === 'chemin' && ++o.i < o.points.length) return;
      u.attente = {x:p.x, y:p.y}; u.ordre = null;
    } else { volVers(u, Math.atan2(p.y - u.y, p.x - u.x), dt, 1); return; }
  } else {
    if(o && o.type === 'attaqueDeplacement'){
      if(!u.attente || u.attente.x !== o.x || u.attente.y !== o.y) u.attente = {x:o.x, y:o.y};
    } else if(o) u.ordre = o = null;                     // ordre inconnu : ignoré
    // Engagement automatique autour du point d'attente
    const c = u.cible;
    if(c && (!peutCibler(u, c) || (u.attente && Math.hypot(c.x - u.attente.x, c.y - u.attente.y) > LAISSE_AVION + 150))){ u.cible = null; u.passe = null; }
    if(!u.cible && u.scan <= 0){ u.scan = 0.4 + Math.random()*0.2; u.cible = chercherCibleAvion(u, !!o); }
  }
  if(u.cible){ passeAttaque(u, u.cible, dt); return; }
  u.poursuiteT = 0;
  // Plus rien à faire et pas de point d'attente : il rentre se poser.
  if(!u.attente){ u.ordre = {type:'rentrer'}; volVers(u, u.angle, dt, 0.8); return; }
  attendre(u, dt);
}
function majAvion(u, dt){
  if(u.base && u.base.mort){ u.base = null; u.place = -1; }
  switch(u.phase){
    case 'sol': avionAuSol(u, dt); break;
    case 'sortie': case 'decollage': avionDecolle(u, dt); break;
    case 'approche': case 'finale': case 'roulage': case 'rangement': avionSePose(u, dt); break;
    default: avionEnVol(u, dt);
  }
}

// ---------- Combat ----------
// Un avion posé ou qui roule est aussi vulnérable qu'un véhicule léger.
function blindageDe(e){ return e.est === 'batiment' ? 'batiment' : (e.def.avion && !enVol(e)) ? 'leger' : e.def.blindage; }
// Multiplicateur de dégâts d'une arme contre une cible (1 si la table n'a pas la case : jamais NaN).
function efficacite(arme, c){
  const ligne = EFFICACITE[arme], k = ligne ? ligne[blindageDe(c)] : undefined;
  return typeof k === 'number' ? k : 1;
}
// Bonus d'une arme à rôle antiaérien (champs bonusAir et bonusVaisseau de la fiche, ex. le Lynx) contre
// une cible en vol : avions, drones, dards (bonusAir) ou vaisseau-mère (bonusVaisseau).
// bonusVaisseau seul (sans bonusAir) sert aussi de correctif : < 1, il réduit l'effet d'une unité de
// masse contre le vaisseau-mère (Conscrit, équilibre du mode Surprises).
function bonusAntiaerien(D, c){
  if(!D.bonusAir && !D.bonusVaisseau) return 1;
  if(blindageDe(c) === 'vaisseau') return D.bonusVaisseau || 1;
  return D.bonusAir && enVol(c) ? D.bonusAir : 1;
}
// Arme employée contre une cible : la fiche elle-même, sauf pour une défense à deux armes (batterie
// mixte : armeAir contre ce qui vole, armeSol sinon). Renvoie {arme, degats, cadence[, missile]}.
function armeContre(u, c){
  const D = u.def;
  if(u.est === 'batiment' && D.armeSol && D.armeAir) return enVol(c) ? D.armeAir : D.armeSol;
  return D;
}
function tirer(u, c){
  const D = u.def, A = armeContre(u, c);
  u.tirT = temps;   // instant du dernier tir (sert au recul du canon dans le rendu)
  let deg = A.degats * (1 + 0.2*(u.rang || 0));
  // Bonus propre à une arme contre les hélicoptères (lance-missiles de la batterie mixte, 13 novembre
  // 2026) : la colonne « helico » de l'arme aa a été baissée pour la DCA mobile, la batterie garde son effet.
  if(A.bonusHelico && blindageDe(c) === 'helico') deg *= A.bonusHelico;
  if(u.dansAura && camps[u.camp] && camps[u.camp].faction === 'halden') deg *= 1.25;
  if(D.arme === 'plasma'){ tirPlasma(u, c, deg); return; }   // envahisseurs : projectile guidé (section 14 bis)
  if(A.missile){
    // Missile guidé (hélicoptère lance-missiles, lance-missiles de la batterie) : dégâts à l'impact.
    const lg = LONG_CANON[u.type] || 10;
    const ex = u.x + Math.cos(u.angleT)*lg, ey = u.y + Math.sin(u.angleT)*lg;
    const h1 = hauteurVisee(u), h2 = hauteurVisee(c), d = Math.hypot(c.x - ex, c.y - ey, h2 - h1);
    projectiles.push({genre:'missileAir', arme:A.arme, sx:ex, sy:ey, tx:c.x, ty:c.y, h1:h1 + 2, h2, t:0,
      duree:Math.max(0.15, d/480), degats:deg, zone:0, camp:u.camp, auteur:u, cible:c, role:D.role || null});
    effet('eclair', {x:ex, y:ey, h:h1, duree:0.08, arme:'balle'});
    return;
  }
  if(D.arme === 'roquette'){
    for(let k=0; k<(D.salve||1); k++){
      const tx = c.x + (Math.random()-.5)*50, ty = c.y + (Math.random()-.5)*50;
      projectiles.push({sx:u.x, sy:u.y, tx, ty, t:-k*0.13, duree:Math.hypot(tx-u.x,ty-u.y)/330 + 0.25,
        degats:deg, zone:D.zone, arme:'roquette', camp:u.camp, auteur:u});
    }
    return;
  }
  const lg = LONG_CANON[u.type] || 10;
  const ex = u.x + Math.cos(u.angleT)*lg, ey = u.y + Math.sin(u.angleT)*lg;
  const h1 = hauteurVisee(u), h2 = hauteurVisee(c);
  if(D.arme === 'roquetteAT'){
    // Roquette d'épaule : projectile guidé (rendu comme un petit missile), dégâts à l'impact.
    const d = Math.hypot(c.x - ex, c.y - ey, h2 - h1);
    projectiles.push({genre:'missileAir', arme:'roquetteAT', sx:ex, sy:ey, tx:c.x, ty:c.y, h1:h1 + 4, h2, t:0,
      duree:Math.max(0.12, d/420), degats:deg, zone:0, camp:u.camp, auteur:u, cible:c, role:'bazooka'});
    effet('eclair', {x:ex, y:ey, h:h1 + 4, duree:0.08, arme:'balle'});
    return;
  }
  infliger(c, deg * efficacite(A.arme, c) * bonusAntiaerien(D, c), u);
  // Fusil de précision : un seul trait, plus long à s'effacer (arme de rendu 'balle', role 'sniper').
  // Mitrailleuse d'hélicoptère : rendue comme une balle.
  const armeRendu = A.arme === 'precision' || A.arme === 'mitrailleuse' ? 'balle' : A.arme;
  effet('trait', {x1:ex, y1:ey, h1, x2:c.x, y2:c.y, h2, duree:A.arme === 'obus' || A.arme === 'precision' ? 0.12 : 0.06,
    couleur: A.arme === 'aa' ? '#bfe9ff' : '#fff1a8', largeur: A.arme === 'obus' ? 3 : 1.5, arme:armeRendu, role:D.role});
  effet('eclair', {x:ex, y:ey, h:h1, duree:0.06, arme:armeRendu});
  if(A.arme === 'obus' || A.arme === 'drone') effet('explosion', {x:c.x, y:c.y, h:h2, r:A.arme === 'obus' ? 16 : 11, duree:0.35});
}
function infliger(c, deg, auteur){
  if(c.mort || deg <= 0) return;
  if(c.def.bouclier && c.bouclier > 0){ deg = absorberBouclier(c, deg, auteur); if(deg <= 0) return; }   // section 14 bis
  c.pv -= deg; c.toucheT = temps;
  noterCombat(c, auteur, deg);
  // Agresseurs récents d'un camp (lu par choisirCampCible : riposte) : dégâts cumulés, oubliés après 90 s.
  if(auteur && auteur.camp && auteur.camp !== c.camp && camps[c.camp] && camps[auteur.camp]){
    const s = camps[c.camp].subi || (camps[c.camp].subi = {}), v = s[auteur.camp];
    s[auteur.camp] = {t:temps, deg:(v && temps - v.t < 90 ? v.deg : 0) + deg};
  }
  if(c.camp === campJoueur && (c.est === 'batiment' || c.def.ouvrier || c.def.collecteur) && temps - alerte.t > 15){
    alerte = {t:temps, x:c.x, y:c.y};
    if(!window.MODE_DEMO) message(c.est === 'batiment' ? 'Notre base est attaquée ! (Espace pour y aller)' :
      c.def.collecteur ? 'Un collecteur est attaqué ! (Espace)' : 'Nos ouvriers sont attaqués ! (Espace)', 'alerte');
  }
  if(c.est === 'unite' && c.def.arme && auteur && (auteur.est === 'unite' || auteur.est === 'batiment') && !auteur.mort
     && !c.cible && !c.ordre && !c.def.ouvrier && peutCibler(c, auteur)) c.cible = auteur;
  if(c.pv <= 0) tuer(c, auteur);
}
function tuer(c, auteur){
  c.mort = true; c.pv = 0;
  const grand = c.est === 'batiment' ? 1 : (c.def.forme === 'infanterie' || c.def.forme === 'ouvrier') ? 0 : 0.5;
  const h = hauteurVisee(c);
  if(c.def.rendu === 'aliens'){
    // Vaisseau-mère : sa destruction est mise en scène par r3d-aliens.js.
  } else if(grand > 0){
    effet('explosion', {x:c.x, y:c.y, h, r:c.est === 'batiment' ? c.rayon*1.2 : c.rayon*2, duree:0.8, grande:true,
      batiment:c.est === 'batiment'});
    for(let k=0;k<(c.est==='batiment'?6:2);k++) effet('fumee', {x:c.x+(Math.random()-.5)*c.rayon, y:c.y+(Math.random()-.5)*c.rayon, duree:1.6+Math.random()});
    if(!enVol(c)) brulure(c.x, c.y, c.rayon*(c.est === 'batiment' ? 1.3 : 1.6));
  } else {
    effet('explosion', {x:c.x, y:c.y, h, r:7, duree:0.3});
  }
  if(c.est === 'batiment'){
    const t = c.def.taille;
    for(let rr=Math.max(0,c.r); rr<Math.min(LIGNES,c.r+t); rr++) for(let cc=Math.max(0,c.c); cc<Math.min(COLS,c.c+t); cc++) grille[rr*COLS+cc] = 0;
    if(c.camp === campJoueur) message(c.def.nom + ' détruit(e) !', 'alerte');
    // Aéroport détruit : les avions encore au sol (stationnés ou sur la piste) sont perdus avec lui ;
    // ceux qui volent n'ont plus de base et en chercheront une autre (voir baseAvion).
    if(c.def.aeroport) for(const u of ents){
      if(u.mort || u.base !== c) continue;
      if(enVol(u)){ u.base = null; u.place = -1; } else tuer(u, auteur);
    }
  }
  if(auteur && auteur.camp && auteur.camp !== c.camp && camps[auteur.camp]){
    camps[auteur.camp].points += (c.def.cout || 800) / (c.est === 'batiment' ? 180 : 220);
    if(auteur.est === 'unite' && !auteur.mort){
      auteur.kills++;
      const r = auteur.kills >= 6 ? 2 : auteur.kills >= 2 ? 1 : 0;
      if(r > auteur.rang){
        auteur.rang = r;
        if(auteur.camp === campJoueur) message(auteur.def.nom + ' promu(e) ' + (r === 1 ? 'vétéran.' : 'élite.'), 'succes');
      }
    }
  }
  // Statistiques du joueur local : ses pertes, et les pertes des camps adverses (équipe différente) et des envahisseurs.
  if(c.camp === campJoueur) stats.perdues++;
  else if(c.camp === 'X' || (CAMPS_JOUEURS.includes(c.camp) && equipeDe(c.camp) !== equipeDe(campJoueur))) stats.detruites++;
  if(c.def.forme === 'vaisseauMere') vaisseauDetruit(c);   // mode Surprises (section 14 bis)
}
// Les explosions de zone touchent tout ce qui n'est pas du camp de l'auteur, neutres compris
// (dégâts collatéraux : attention au Marteau près d'une station de pompage).
// bord : part des dégâts qui reste au bord de la zone (0,5 par défaut ; 0,1 pour une bombe guidée,
// précise : forte sur sa cible, faible sur ses voisines).
function explosionZone(x, y, r, deg, arme, auteur, bord){
  const perte = 1 - (typeof bord === 'number' ? bord : 0.5);
  for(const e of ents){
    // Un allié n'est jamais touché ; les envahisseurs épargnent le camp neutre.
    if(e.mort || e.camp === auteur.camp || allies(e.camp, auteur.camp) || (auteur.camp === 'X' && e.camp === 'N')) continue;
    const d = Math.max(0, Math.hypot(e.x-x, e.y-y) - e.rayon*0.5);
    if(d > r) continue;
    // Le vaisseau-mère ne craint, parmi les explosions, que celles des pouvoirs (efficacité « frappe »).
    const a = e.def.blindage === 'vaisseau' && auteur.pouvoir ? 'frappe' : arme;
    infliger(e, deg * (1 - perte*d/r) * efficacite(a, e), auteur);
  }
}
function brulure(x, y, r){ if(window.R3D && R3D.ajouterBrulure) R3D.ajouterBrulure(x, y, r); }

// ---------- Pouvoirs ----------
function planifier(delai, fn){ evenements.push({t:delai, fn}); }
// Bâtiment où arrivent les renforts : le QG, sinon n'importe quel bâtiment du camp (null si aucun).
function batimentRenforts(campId){
  return ents.find(b => b.est === 'batiment' && b.camp === campId && b.type === 'qg' && !b.mort)
      || ents.find(b => b.est === 'batiment' && b.camp === campId && !b.mort) || null;
}
// Le pouvoir peut-il produire son effet ? Renvoie null si oui, sinon la raison (texte pour le joueur).
// Vérifié AVANT de prélever points et recharge : un pouvoir sans effet ne coûte rien.
function empechementPouvoir(campId, P, x, y){
  if(P.cible){
    if(!isFinite(x) || !isFinite(y) || x < 0 || y < 0 || x > LARG || y > HAUT) return 'Cible hors de la carte.';
  }
  if(P.cle === 'renforts' && !batimentRenforts(campId)) return 'Aucun bâtiment pour accueillir les renforts.';
  return null;
}
// gratuit : déclenché par une mission (sans coût ni recharge).
// Renvoie false (sans rien prélever) si le pouvoir est inconnu, indisponible ou sans effet possible.
function activerPouvoir(campId, cle, x, y, gratuit){
  const C = camps[campId];
  if(!C) return false;
  const P = (POUVOIRS[C.faction] || []).find(p => p.cle === cle);
  if(!P) return false;
  const empeche = empechementPouvoir(campId, P, x, y);
  if(empeche){
    if(campId === campJoueur && !gratuit) message(empeche, 'alerte');
    return false;
  }
  if(!gratuit){
    if(!pouvoirsActifs[campId] || C.points < P.cout || (C.recharges[cle]||0) > 0) return false;
    C.points -= P.cout; C.recharges[cle] = P.recharge;
  }
  const auteur = {camp:campId, est:'pouvoir', pouvoir:true};
  if(campId === campJoueur) message(P.nom + ' déclenché(e).', 'succes');
  else if(allies(campId, campJoueur)) message('Notre allié déclenche : ' + P.nom + '.', 'succes');
  else if(P.cible) message('Alerte : ' + P.nom + ' ennemi(e) en approche !', 'alerte');
  else message('L’ennemi reçoit des renforts.', 'alerte');
  const coul = FACTIONS[C.faction].couleur;
  switch(cle){
    case 'frappe':
      effet('marqueur', {x, y, camp:campId, r:P.rayon, duree:1.2, couleur:coul, pouvoir:cle});
      effet('missile', {x, y, duree:1.2});
      planifier(1.2, () => { explosionZone(x, y, P.rayon, 300, 'frappe', auteur); effet('explosion', {x, y, h:0, r:P.rayon, duree:0.9, grande:true}); brulure(x, y, P.rayon*0.8); });
      break;
    case 'essaim':
      effet('marqueur', {x, y, camp:campId, r:P.rayon, duree:2.2, couleur:coul, pouvoir:cle});
      for(let k=0;k<26;k++) planifier(2.2 + k*0.11, () => {
        const a = Math.random()*Math.PI*2, d = Math.sqrt(Math.random())*P.rayon;
        const px = x+Math.cos(a)*d, py = y+Math.sin(a)*d;
        effet('trait', {x1:px-50, y1:py-50, h1:240, x2:px, y2:py, h2:0, duree:0.18, couleur:'#a8d8ff', largeur:1.5, arme:'drone'});
        effet('explosion', {x:px, y:py, h:0, r:22, duree:0.4});
        explosionZone(px, py, 50, 60, 'frappe', auteur);
      });
      break;
    case 'marteau':
      effet('marqueur', {x, y, camp:campId, r:P.rayon, duree:2.6, couleur:coul, pouvoir:cle});
      for(let k=0;k<16;k++) planifier(2.6 + k*0.22, () => {
        const a = Math.random()*Math.PI*2, d = Math.sqrt(Math.random())*P.rayon;
        const px = x+Math.cos(a)*d, py = y+Math.sin(a)*d;
        effet('explosion', {x:px, y:py, h:0, r:40, duree:0.7, grande:true});
        brulure(px, py, 26);
        explosionZone(px, py, 80, 140, 'roquette', auteur);
      });
      break;
    case 'renforts': {
      const qg = batimentRenforts(campId);   // jamais null ici : vérifié par empechementPouvoir
      if(qg) for(let k=0;k<5;k++){
        const p = positionSortie(qg);
        const u = creerUnite('conscrit', campId, p.x + (k-2)*16, p.y);
        u.ordre = {type:'aller', x:p.x + (k-2)*22, y:p.y + 40};
      }
      break;
    }
  }
  return true;
}

// =====================================================================
//  7. INTELLIGENCE ARTIFICIELLE (adversaire, camp I)
// =====================================================================
// En mission : construit (gère base et production), vagues {premiere, taille, croissance, intervalle}, cible {x,y}.
// État de l'IA : un par camp ordinateur (etatIA(id)). En mission, seul I est un ordinateur : la variable
// « ia » désigne son état (moteur de missions, configurerIA). En escarmouche, majIA fait tourner chaque
// camp ordinateur avec son propre état (économie, vagues, aviation, pouvoirs, cible du moment).
function nouvelEtatIA(){
  return {t:0, vague:7, premiereVague:210, revenu:1, indexVeh:0, indexInf:0, indexAvion:0, tourAvion:true, nAvions:0, besoin:null, active:true,
    construit:true, vagues:null, cible:null, prochaineVague:Infinity, nVagues:0, attenteVague:0, frappeT:0, campCible:null};
}
let etatsIA = {};
function etatIA(id){ return etatsIA[id] || (etatsIA[id] = nouvelEtatIA()); }
let ia = etatIA('I');
function reinitialiserIA(){ etatsIA = {}; ia = etatIA('I'); }

// Économie : ouvriers, chantiers, plan de construction, production.
// Collecteurs voulus par l'IA (rachetés quand ils sont détruits), selon la difficulté.
const IA_COLLECTEURS = {facile:2, normal:3, difficile:3, ultra:3};   // ultra : voir collecteursUltra
const IA_HELICOS = {facile:1, normal:2, difficile:3, ultra:3};   // hélicoptères d'appui voulus (escarmouche)
// Difficulté d'un camp ordinateur : la sienne (etatIA(id).niveau, posée par les outils de test pour un duel
// d'ordinateurs à difficultés différentes), sinon celle du menu. En mission, Ultra vaut Difficile.
function niveauIA(id){
  const E = etatsIA[id], n = (E && E.niveau) || difficulte;
  return n === 'ultra' && MISSION ? 'difficile' : n;
}
// Les règles réservées jusqu'ici à Difficile s'appliquent aussi à Ultra (même rythme, sans bonus de revenu).
function niveauDur(id){ const n = niveauIA(id); return n === 'difficile' || n === 'ultra'; }
function estUltra(id){ return !MISSION && niveauIA(id) === 'ultra'; }
const RESERVE_COLLECTEUR = 400;   // gardé de côté tant qu'il manque un collecteur (voir economieIA)
const IA_OUVRIERS_MAX = 4;
function economieIA(C, F, bats, ouvriers, armee, qg){
  const ia = etatIA(C.id);
  const libre = o => !o.ordre || o.ordre.type === 'reparer';
  const chantiers = bats.filter(b => b.enCours);
  for(const b of chantiers){
    if(!ouvriers.some(o => o.ordre && o.ordre.type === 'construire' && o.ordre.bat === b)){
      const o = ouvriers.find(libre);
      if(o){ o.ordre = {type:'construire', bat:b}; o.chemin = null; }
    }
  }
  // Ouvriers sans ordre : réparation d'un bâtiment entamé (n'importe où dans la base).
  for(const o of ouvriers) if(!o.ordre){ const r = batimentAReparer(o, 1400); if(r) o.ordre = {type:'reparer', bat:r}; }
  // Collecteurs : ils travaillent seuls (majCollecteur) ; l'IA en rachète tant qu'il reste du minerai.
  const collecteurs = ents.filter(e => e.camp === C.id && e.est === 'unite' && !e.mort && e.def.collecteur).length;
  // Collecteurs en file : au QG et dans les dépôts (qui en produisent aussi, novembre 2026).
  const prodC = bats.filter(b => !b.enCours && (F.production[b.type] || []).includes('collecteur'));
  const enFileC = prodC.reduce((n, b) => n + b.file.filter(t => t === 'collecteur').length, 0);
  const U = estUltra(C.id);   // difficulté Ultra (section 7 ter) : mêmes règles, meilleures décisions
  const voulu = noeuds.some(n => n.reste > 0) ? (U ? collecteursUltra(C.id, bats) : (IA_COLLECTEURS[niveauIA(C.id)] || 3)) : 0;
  // Rachat des collecteurs avant tout le reste : tant qu'il en manque, RESERVE_COLLECTEUR est gardé de
  // côté (bâtiments, avions et unités n'y touchent pas). Avant, réserves vides, l'IA ne les rachetait
  // plus et son revenu s'effondrait.
  const manqueC = prodC.length > 0 && collecteurs + enFileC < voulu && autorise('unites', 'collecteur');
  const gardeC = manqueC ? (U ? gardeCollecteurUltra(C.id, collecteurs) : RESERVE_COLLECTEUR) : 0;
  if(manqueC){
    const p = prodC.filter(b => !b.file.length).sort((a, c) => (a.type === 'qg' ? 0 : 1) - (c.type === 'qg' ? 0 : 1))[0];
    if(p) commander(p, 'collecteur');
    // Plus aucun collecteur ni en service ni en file : aucune autre dépense (bâtiments, unités, avions,
    // épargne d'avion) tant que le premier n'est pas commandé (revenu de secours : voir revenuSecours).
    if(collecteurs === 0 && !prodC.some(b => b.file.includes('collecteur'))) return;
  } else if(qg && !qg.enCours && qg.file.length < 1 && ouvriers.length < (U ? ouvriersUltra(C.id, ouvriers.length) : IA_OUVRIERS_MAX)) commander(qg, F.ouvrier);
  // L'aéroport vient une fois la base complète (deux casernes, deux bâtiments spéciaux, une usine),
  // avant la seconde usine et la défense fixe : placé tout à la fin, il n'arrivait qu'après dix
  // minutes de jeu et l'ordinateur ne volait presque jamais. Interdit en mission, sauf mission qui
  // l'autorise (voir autorise) : le plan des missions actuelles est donc inchangé.
  // (Aéroport avancé d'un cran, avant la seconde caserne : il arrivait vers 5 minutes et l'adversaire le
  // rasait avant la première sortie.)
  // Batterie mixte (novembre 2026) : en fin de plan, après la défense fixe ; interdite en mission.
  // (Essai du 13 novembre 2026 : en dernier, l'ordinateur n'en bâtissait aucune en 15 minutes, faute de
  // réserves ; elle passe donc juste après l'aéroport dès que l'adversaire a un aéroport ou des appareils.)
  const menaceAir = ents.some(e => !e.mort && hostile(C.id, e.camp) && e.camp !== 'X' &&
    ((e.est === 'batiment' && e.def.aeroport) || (e.est === 'unite' && e.def.aerien)));
  const plan = (U ? planUltra(C.id, F, bats, menaceAir)
    : menaceAir ? ['caserne', F.special, 'usine', F.special, 'aeroport', 'batterie', 'caserne', 'usine', F.defense]
                : ['caserne', F.special, 'usine', F.special, 'aeroport', 'caserne', 'usine', F.defense, 'batterie'])
    .filter(t => t && BATIMENTS[t] && ((t !== 'aeroport' && t !== 'batterie') || autorise('batiments', t)));
  // Aviation : avion à commander (null : rien pour l'instant). Un aéroport prêt, avec une place libre
  // et rien en commande, veut un chasseur si le joueur a des appareils et qu'elle n'en a pas (urgent),
  // sinon des avions d'attaque. Le tout premier avion passe avant la suite du plan de construction.
  const aero = bats.find(b => b.def.aeroport && !b.enCours && !b.file.length && avionsDe(b).length < PLACES_AEROPORT.length);
  let avionVoulu = null, urgent = false;
  if(aero){
    // Chasseur seulement contre une aviation adverse réelle : un avion en vol, ou en production dans un
    // aéroport adverse (les drones ne comptent pas : le F-15 ne leur sert à rien de plus qu'un Rafale).
    const aviationAdverse = ents.some(e => !e.mort && hostile(C.id, e.camp) &&
      ((e.est === 'unite' && e.def.avion && enVol(e)) || (e.est === 'batiment' && e.def.aeroport && e.file.some(t => UNITES[t] && UNITES[t].avion))));
    urgent = aviationAdverse && !ents.some(e => e.camp === C.id && e.type === 'f15' && !e.mort);
    avionVoulu = urgent ? 'f15' : IA_AVIONS[ia.indexAvion % IA_AVIONS.length];
    if(!autorise('unites', avionVoulu)) avionVoulu = null;
    // Ultra : un avion seulement s'il sert (chasseur contre une aviation adverse, ou frappe quand l'armée de
    // terre est formée et que l'antiaérien adverse reste faible).
    if(U && avionVoulu && !avionUtileUltra(C.id, urgent, armee)) avionVoulu = null;
  }
  // « Premier avion » : aussi quand l'aéroport s'est vidé (avions abattus) ; il repasse avant les bâtiments.
  const premierAvion = !!avionVoulu && (ia.nAvions === 0 || avionsDe(aero).length === 0);
  ia.besoin = null;
  let iBesoin = -1;   // rang du bâtiment voulu dans le plan
  if(!chantiers.length && !premierAvion){
    const compte = {};
    for(let i = 0; i < plan.length; i++){
      const t = plan[i];
      compte[t] = (compte[t]||0) + 1;
      if(bats.filter(b => b.type === t).length < compte[t]){ ia.besoin = t; iBesoin = i; break; }
    }
    // Ultra sous la menace : seuls les bâtiments vitaux (première caserne, première usine, batterie contre
    // des appareils ou le vaisseau) ; le reste attend, et son prix n'est pas mis de côté.
    if(U && ia.besoin && !batimentPermisUltra(C.id, ia.besoin, bats)){ ia.besoin = null; iBesoin = -1; }
    if(ia.besoin){
      const D = BATIMENTS[ia.besoin];
      const ok = !D.requiert || bats.some(b => b.type === D.requiert && !b.enCours);
      if(ok && C.reserves - gardeC >= D.cout && ouvriers.length >= 1){
        const pos = trouverEmplacement(ia.besoin, U ? centreChantierUltra(C.id, ia.besoin, qg || bats[0]) : (qg || bats[0]));
        const o = ouvriers.find(libre) || ouvriers[0];
        if(pos && o) construireBatiment(C.id, ia.besoin, pos.c, pos.r, [o]);
      }
    }
  }
  // Réserve gardée pour le prochain bâtiment du plan, sauf pour ceux qui suivent l'aéroport (seconde
  // usine, défense fixe) : ils ne retiennent plus l'achat des avions ni des unités.
  const iAero = plan.indexOf('aeroport');
  // (Exception : la batterie mixte, sinon jamais financée — avions et hélicoptères passaient toujours avant.)
  const apresAero = iAero >= 0 && iBesoin > iAero && ia.besoin !== 'batterie';
  // (Avant les collecteurs, le seuil était « six ouvriers » : l'économie installée.)
  const reserveMin = (ia.besoin && collecteurs >= 2 && !apresAero ? BATIMENTS[ia.besoin].cout : 0) + gardeC;
  const infanterie = armee.filter(u => u.def.forme === 'infanterie').length;
  const aUsine = bats.some(b => b.type === 'usine' && !b.enCours);
  // Blindés de combat (armés, au sol, hors DCA et dépannage). Hors mission, tant qu'il y en a moins de
  // trois et qu'une usine est libre, le prix d'un char est mis de côté avant les avions (sauf chasseur
  // urgent) et les hélicoptères (13 novembre 2026 : avec un revenu d'environ 10 par seconde, l'ordinateur
  // n'alignait qu'un ou deux blindés en 10 minutes).
  const blindeCombat = t => !!(UNITES[t] && UNITES[t].arme && UNITES[t].sol && !UNITES[t].aerien && UNITES[t].forme !== 'infanterie');
  const blindes = armee.filter(u => blindeCombat(u.type)).length;
  const reserveChar = !MISSION && blindes < 3 && bats.some(b => b.type === 'usine' && !b.enCours && !b.file.length) ? 480 : 0;
  // Aviation d'abord : l'avion voulu est acheté dès que les réserves le permettent. D'ici là son prix
  // est mis de côté (« epargne » : les usines attendent), mais une fois sur deux seulement : après
  // chaque avion, un véhicule passe avant l'avion suivant (ia.tourAvion), pour que l'armée de terre
  // ne soit pas sacrifiée. Un avion à la fois.
  let epargne = 0;
  // Tant que l'aéroport a moins de deux avions, l'avion voulu est acheté dès que les réserves couvrent
  // son prix (ni tour de rôle ni réserve de bâtiment). En difficile, plus de véhicule obligatoire entre
  // deux avions.
  if(!aUsine || niveauDur(C.id)) ia.tourAvion = true;
  const peuDAvions = !!aero && avionsDe(aero).length < 2;
  if(avionVoulu && (urgent || premierAvion || ia.tourAvion || peuDAvions)){
    if(C.reserves - UNITES[avionVoulu].cout >= (peuDAvions ? gardeC : reserveMin) + (urgent ? 0 : reserveChar)){
      if(commander(aero, avionVoulu)){ ia.tourAvion = false; ia.nAvions++; if(!urgent) ia.indexAvion++; }
    } else if(premierAvion || peuDAvions || armee.length >= 6) epargne = UNITES[avionVoulu].cout;
  }
  // Hélicoptères d'appui (novembre 2026) : IA_HELICOS selon la difficulté, en alternant mitrailleur et
  // lance-missiles ; ils rejoignent l'armée de terre (vagues, défense). Le premier est acheté dès que les
  // réserves le couvrent (hors rachat de collecteur) ; les suivants passent après l'avion voulu.
  // (Premier essai : seulement après l'épargne des avions ; en 18 minutes l'ordinateur n'en achetait aucun.)
  const mesHelicos = armee.filter(u => u.def.forme === 'helico').length + bats.reduce((n, b) => n + b.file.filter(t => UNITES[t] && UNITES[t].forme === 'helico').length, 0);
  const aeroH = bats.find(b => b.def.aeroport && !b.enCours && b.file.length < 2 && !helicosPlein(b));
  if(aeroH && armee.length >= 4 && mesHelicos < (IA_HELICOS[niveauIA(C.id)] || 2) && !U){   // Ultra : hélicoptères choisis par productionUltra
    const types = (F.helicos || []).filter(t => autorise('unites', t));
    if(types.length){
      const t = types[(ia.indexHelico || 0) % types.length];
      const seuil = (mesHelicos === 0 ? gardeC : reserveMin + epargne) + reserveChar;
      if(C.reserves - UNITES[t].cout >= seuil && commander(aeroH, t)) ia.indexHelico = (ia.indexHelico || 0) + 1;
    }
  }
  // Appareils adverses (drones, hélicoptères, avions en vol ou en production) et DCA du camp : la DCA
  // n'est produite que contre une menace aérienne réelle, une par tranche de deux appareils adverses
  // (quatre au plus) ; la Sentinelle de la liste de Karsk reste produite à son tour s'il y a des appareils.
  // (Essai du 13 novembre 2026 : les files des aéroports adverses comptaient aussi ; face à un joueur
  // qui garnissait les siennes, toute la production de l'usine partait en DCA, 3 Sentinelles et aucun
  // char en 10 minutes. Désormais : appareils existants seulement, et DCA plafonnée au tiers des
  // véhicules produits par le camp, ia.nVeh et ia.nDCA.)
  const appareilsAdverses = ents.filter(e => !e.mort && e.est === 'unite' && e.def.aerien && e.def.forme !== 'vaisseauMere' && hostile(C.id, e.camp)).length;
  const enFile = t => bats.reduce((n, b) => n + b.file.filter(x => x === t).length, 0);
  const mesDCA = armee.filter(u => u.type === F.antiair).length + enFile(F.antiair);
  ia.nVeh = ia.nVeh || 0; ia.nDCA = ia.nDCA || 0;
  const dcaPermise = () => (ia.nDCA + 1) * 3 <= ia.nVeh + 1;   // après cette commande, au plus un tiers de DCA
  // Véhicules à dépanner (hélicoptères compris).
  const aDepanner = armee.filter(u => u.def.forme !== 'infanterie' && !u.def.repare && u.def.arme).length;
  const [repInf, repVeh] = (F.reparateurs || []).map(t => autorise('unites', t) ? t : null);
  // Ultra : production par analyse de l'adversaire (contres, réparateurs, DCA), sans les tours de rôle.
  if(U){ productionUltra(C, F, bats, armee, gardeC, reserveMin, epargne); return; }
  // Char attendu par une usine libre : la caserne le laisse passer (sinon les fantassins, moins chers,
  // prenaient chaque crédit dès qu'il rentrait et l'usine ne produisait jamais).
  let charAttendu = 0;
  for(const b of MISSION ? bats : bats.slice().sort((a, c) => (c.type === 'usine') - (a.type === 'usine'))){   // usines d'abord (hors mission)
    if(b.enCours || b.file.length >= 2) continue;
    let choix = null, dcaUrgente = false, prioriteChar = false;
    if(b.type === 'caserne'){
      // Mélange d'infanterie (F.iaInfanterie), limité à ce que la mission autorise.
      if(!aUsine || infanterie < 8 || C.reserves > 900){
        const liste = (F.iaInfanterie || []).filter(t => autorise('unites', t));
        choix = liste.length ? liste[(ia.indexInf || 0) % liste.length] : F.production.caserne[0];   // repli : comme avant
        // Soutien : deux fantassins réparateurs dès que l'infanterie compte cinq hommes.
        if(repInf && infanterie >= 5 && armee.filter(u => u.type === repInf).length < 2 && (ia.indexInf || 0) % 3 === 2) choix = repInf;
      }
    } else if(b.type === 'usine'){
      // (En mission, liste et règles d'avant novembre 2026 : les huit missions ne changent pas.)
      const liste = MISSION ? F.iaVehicules : F.iaVehicules.filter(t => autorise('unites', t));
      choix = liste.length ? liste[ia.indexVeh % liste.length] : null;
      const dcaOk = F.antiair && autorise('unites', F.antiair);
      // DCA : seulement contre des appareils adverses (sinon un char à la place).
      if(choix === F.antiair && (!appareilsAdverses || (!MISSION && !dcaPermise()))) choix = liste.find(t => t !== F.antiair) || null;
      if(!MISSION && dcaOk && appareilsAdverses >= 1 && mesDCA < Math.min(4, Math.ceil(appareilsAdverses/2)) && dcaPermise()){ choix = F.antiair; dcaUrgente = true; }
      // Mode Surprises : face au vaisseau-mère, un véhicule sur deux est l'antiaérien de la faction.
      if(dcaOk && ia.indexVeh % 2 === 0 && vaisseauMere()) choix = F.antiair;
      // Dépannage : un véhicule réparateur (deux en difficile) dès trois véhicules armés (hélicoptères
      // compris : il les répare aussi), dont deux blindés de combat. (Avant : trois véhicules au sol
      // hors hélicoptères, jamais atteint tant que l'usine ne faisait que de la DCA.)
      else if(repVeh && aDepanner >= 3 && blindes >= 2 && armee.filter(u => u.type === repVeh).length + enFile(repVeh) < (niveauDur(C.id) ? 2 : 1)) choix = repVeh;
      // Production de blindés garantie hors mission : moins de quatre blindés de combat, le char passe
      // avant l'épargne d'un avion et la caserne l'attend ; moins de deux, il passe aussi avant le
      // prochain bâtiment du plan (à moins de trois, l'aéroport arrivait une minute plus tard) (revenu d'environ 10 par seconde : sinon l'aéroport, la batterie et
      // les fantassins prenaient tout et l'ordinateur n'alignait qu'un char en 10 minutes).
      // (Le véhicule de dépannage aussi passe avant l'épargne : sinon il bloquait l'usine.)
      prioriteChar = !MISSION && ((blindeCombat(choix) && blindes < 4) || (choix && choix === repVeh));
      if(prioriteChar && !b.file.length) charAttendu = Math.max(charAttendu, UNITES[choix].cout);
    }
    // L'épargne pour un avion retient les usines, et les casernes dès que quatre fantassins gardent la base.
    // La DCA réclamée par des appareils adverses passe avant (seul le rachat d'un collecteur la retient).
    const seuil = dcaUrgente && choix === F.antiair ? gardeC
      : prioriteChar ? (blindes < 2 && blindeCombat(choix) ? gardeC : reserveMin)
      : reserveMin + (b.type === 'usine' || infanterie >= 4 ? epargne : 0) + (b.type === 'caserne' && infanterie >= 4 ? charAttendu : 0);
    if(choix && C.reserves - UNITES[choix].cout >= seuil){
      const ok = commander(b, choix);
      if(ok && b.type === 'usine'){ ia.indexVeh++; ia.tourAvion = true; ia.nVeh++; if(choix === F.antiair) ia.nDCA++; }
      if(ok && b.type === 'caserne') ia.indexInf = (ia.indexInf || 0) + 1;
    }
  }
}
// ---------- Aviation de l'IA ----------
// Interceptions : tout appareil ennemi en vol à moins de IA_INTERCEPTION px d'un de ses bâtiments est
// pris en chasse par ses avions armés contre le ciel. Appui : ses avions d'attaque au sol engagent les
// intrus terrestres près de la base. Frappes : sinon, DELAI_SORTIE s après leur réarmement, ses avions
// d'attaque prêts partent ensemble sur un bâtiment du joueur (cibleFrappe : de valeur, et dont
// l'approche n'est pas trop défendue pour leur nombre ; sinon ils attendent une occasion).
// Un avion sans munitions rentre de lui-même (majAvion) et repart quand il est réarmé.
const IA_AVIONS = ['rafale', 'f35', 'rafale'];
const IA_INTERCEPTION = 1100;
const DELAI_SORTIE = {facile:30, normal:14, difficile:6, ultra:6};
const ATTENTE_FRAPPE = 3.5;   // s entre deux recherches de frappe infructueuses (économie de calcul)
// Défense antiaérienne acceptée sur le trajet d'une frappe (voir couvertureAA) : 4 pour un avion seul,
// 2 de plus par avion supplémentaire. Au-delà, les avions seraient abattus avant d'avoir largué.
const risqueAccepte = n => 4 + 2*Math.max(0, n - 1);
// Défense antiaérienne adverse autour d'un point : nombre d'unités et de défenses capables de tirer
// en l'air qui l'ont à portée (une Sentinelle compte triple). liste : défenses déjà relevées par
// defensesAA (facultatif ; sinon elles sont recherchées dans toutes les entités).
function defensesAA(camp){
  return ents.filter(e => !e.mort && !e.enCours && e.def.arme && e.def.air && !e.def.avion && !e.def.pasAvion && hostile(e.camp, camp));
}
function couvertureAA(camp, x, y, liste){
  let n = 0;
  for(const e of liste || defensesAA(camp)){
    if(Math.hypot(e.x - x, e.y - y) < e.def.portee + 60) n += e.def.arme === 'aa' ? 3 : 1;
  }
  return n;
}
// Risque d'une frappe : la plus forte défense antiaérienne rencontrée sur les 700 derniers px du
// trajet en ligne droite, cible comprise.
function risqueFrappe(camp, depuis, cible, liste){
  const dx = cible.x - depuis.x, dy = cible.y - depuis.y, d = Math.hypot(dx, dy) || 1;
  const aa = liste || defensesAA(camp);
  let pire = 0;
  for(let k = 0; k <= 5; k++){
    const t = Math.min(d, k*140);
    pire = Math.max(pire, couvertureAA(camp, cible.x - dx/d*t, cible.y - dy/d*t, aa));
  }
  return pire;
}
// Bâtiment adverse à frapper : le plus intéressant (aéroport, défense, usine d'abord ; bâtiment déjà
// entamé ; trajet court et peu défendu). risqueMax : au-delà, la cible est écartée (null si aucune ne reste).
function cibleFrappe(camp, depuis, risqueMax, aa){
  aa = aa || defensesAA(camp);
  let best = null, bs = -Infinity;
  for(const e of ents){
    if(e.mort || e.est !== 'batiment' || !hostile(camp, e.camp)) continue;
    const risque = risqueFrappe(camp, depuis, e, aa);
    if(risqueMax != null && risque > risqueMax) continue;
    const valeur = e.def.aeroport ? 5 : (e.def.arme || e.type === 'usine') ? 4 : e.type === 'qg' ? 2 : 3;
    const s = valeur*100 - risque*40 - dist(depuis, e)*0.04 + (e.pv < e.pvMax*0.5 ? 60 : 0);
    if(s > bs){ bs = s; best = e; }
  }
  return best;
}
// Repli quand toute la base adverse est trop bien défendue : une unité terrestre adverse à découvert
// (blindé de préférence), dont l'approche reste sous risqueMax. Sans ce repli, les avions d'attaque
// de l'IA restaient au sol des minutes entières face à une base garnie de fantassins antiaériens.
function cibleFrappeUnite(camp, depuis, risqueMax, aa){
  aa = aa || defensesAA(camp);
  let best = null, bs = -Infinity;
  for(const e of ents){
    if(e.mort || e.est !== 'unite' || e.def.aerien || !hostile(camp, e.camp) || !peutCibler(depuis, e)) continue;
    const risque = risqueFrappe(camp, depuis, e, aa);
    if(risque > risqueMax) continue;
    const valeur = e.def.blindage === 'lourd' ? 4 : e.def.blindage === 'leger' ? 3 : e.def.ouvrier ? 1 : 2;
    const s = valeur*100 - risque*40 - dist(depuis, e)*0.04;
    if(s > bs){ bs = s; best = e; }
  }
  return best;
}
function plusProcheDe(u, liste){
  let best = null, bd = Infinity;
  for(const e of liste){ const d = dist(u, e); if(d < bd && peutCibler(u, e)){ bd = d; best = e; } }
  return best;
}
function majIAAviation(camp, bats, avions, menacesSol){
  if(!avions.length) return;
  const ia = etatIA(camp);
  const intrus = ents.filter(e => !e.mort && e.est === 'unite' && hostile(camp, e.camp) && enVol(e) &&
    bats.some(b => dist(b, e) < IA_INTERCEPTION));
  const prets = [];   // avions d'attaque stationnés, réarmés et sans mission : candidats à une frappe
  for(const u of avions){
    const D = u.def, o = u.ordre;
    if(u.phase !== 'sol' && u.phase !== 'vol') continue;                  // sur la piste ou en approche
    if(u.munitions <= 0 || (u.phase === 'sol' && u.munitions < D.munitions)) continue;   // rentre ou se réarme
    // Avion très entamé : il rentre se faire réparer et ne repart qu'aux deux tiers de ses PV.
    if(u.phase === 'vol' && u.pv < u.pvMax*0.35){ if(!o || o.type !== 'rentrer'){ u.ordre = {type:'rentrer'}; u.cible = null; u.attente = null; } continue; }
    if(u.phase === 'sol' && u.pv < u.pvMax*0.66) continue;
    const enMission = o && o.type === 'attaquer' && !o.cible.mort;
    // Interception : elle passe avant une frappe en cours.
    if(D.armeAir && intrus.length && !(enMission && enVol(o.cible))){
      const c = plusProcheDe(u, intrus);
      if(c){ u.ordre = {type:'attaquer', cible:c}; continue; }
    }
    if(enMission || !D.armeSol || D.chasse) continue;
    if(menacesSol.length){
      const c = plusProcheDe(u, menacesSol);
      if(c){ u.ordre = {type:'attaquer', cible:c}; continue; }
    }
    if(u.phase === 'sol' && !o && temps - u.pretT >= DELAI_SORTIE[niveauIA(camp)]) prets.push(u);
  }
  // Frappe groupée : pas avant la première vague terrestre (en escarmouche), et seulement si une
  // cible reste abordable pour le nombre d'avions prêts.
  // Coût : la liste des défenses antiaériennes adverses est relevée une seule fois par évaluation, et
  // après une évaluation sans cible abordable, la suivante attend ATTENTE_FRAPPE s.
  if(prets.length && (MISSION || temps >= ia.premiereVague) && temps >= (ia.frappeT || 0)){
    const risqueMax = risqueAccepte(prets.length), aa = defensesAA(camp);
    const c = cibleFrappe(camp, prets[0], risqueMax, aa) || cibleFrappeUnite(camp, prets[0], risqueMax, aa);
    if(c) for(const u of prets) u.ordre = {type:'attaquer', cible:c};
    else ia.frappeT = temps + ATTENTE_FRAPPE;
  }
}
function pouvoirsIA(C, menaces, armee){
  const id = C.id;
  if(!pouvoirsActifs[id]) return;
  const Ps = POUVOIRS[C.faction] || [], sup = Ps.find(p => p.super);
  for(const P of Ps){
    if(C.points < P.cout || (C.recharges[P.cle]||0) > 0) continue;
    if(!P.super && sup && (C.recharges[sup.cle]||0) <= 0) continue;
    if(!P.cible){ if(menaces.length || armee.length < 4) activerPouvoir(id, P.cle); continue; }
    // Le groupe adverse le plus dense, parmi tous ses ennemis : camps adverses et envahisseurs.
    let g = null;
    for(const camp of [...campsEnJeu(), 'X']) if(hostile(id, camp) && camp !== 'N'){ const h = meilleurGroupe(camp); if(h && (!g || h.score > g.score)) g = h; }
    if(g && g.score >= (P.super ? 6 : 3)) activerPouvoir(id, P.cle, g.x, g.y);
  }
}
// Chaque camp ordinateur réfléchit toutes les 0,8 s, avec son propre état (décalé d'un camp à l'autre
// pour étaler le calcul sur les images). En mission, seul l'ordinateur I existe (majIAMission).
function majIA(dt){
  if(MISSION){
    if(!ia.active) return;
    ia.t -= dt; if(ia.t > 0) return; ia.t = 0.8;
    majIAMission(); return;
  }
  // Fluidité : jamais deux réflexions dans le même pas. Si deux camps tombent sur le même pas (cela
  // n'arrive pas avec les décalages de départ : 0 sur 4 800 pas mesurés à quatre camps), le second
  // attend le pas suivant (50 ms), sans que son calcul change.
  let reflechi = false;
  for(const id of campsIA()){
    const E = etatIA(id);
    if(!E.active || camps[id].elimine) continue;
    if(E.t > 0) E.t -= dt;
    if(E.t > 0 || reflechi) continue;
    E.t = 0.8; reflechi = true;
    majIACamp(id, E);
  }
}
// Camp ennemi visé par les vagues d'un ordinateur : parmi les camps adverses encore en jeu, le plus proche
// ou le plus faible (distance de sa base + force de son armée), avec une préférence pour celui qu'un allié
// attaque déjà (on attaque ensemble). Le choix est revu à chaque vague, et quand la cible tombe : il ne
// s'acharne pas sur le joueur. null : aucun camp adverse (trêve, ou plus d'ennemi).
function choisirCampCible(id, centre){
  const ennemis = campsEnJeu().filter(c => enVie(c) && hostile(id, c));
  if(ennemis.length <= 1) return ennemis[0] || null;
  let best = null, bs = Infinity;
  for(const c of ennemis){
    let d = Infinity, force = 0, pression = 0;
    for(const e of ents){
      if(e.mort) continue;
      if(e.camp === c){
        if(e.est === 'batiment') d = Math.min(d, dist(e, centre));
        else if(e.def.arme && !e.def.ouvrier) force += e.def.cout || 0;
      } else if(e.est === 'unite' && e.enVague && e.camp !== id && allies(id, e.camp) && e.ordre && e.ordre.type === 'attaqueDeplacement'){
        // Vague alliée en route vers une base de c ?
        if(ents.some(b => b.camp === c && b.est === 'batiment' && Math.hypot(b.x - e.ordre.x, b.y - e.ordre.y) < 500)) pression++;
      }
    }
    // Riposte (novembre 2026) : un camp qui l'a frappé dans les 90 dernières secondes est préféré, d'autant
    // plus qu'il a fait de dégâts. Un camp déjà visé par un autre ordinateur adverse l'est un peu moins
    // (pas d'acharnement à plusieurs), et la part de hasard est plus forte qu'avant (250 px) : les
    // ordinateurs ne restent pas figés sur le joueur.
    const subi = camps[id].subi && camps[id].subi[c];
    const riposte = subi && temps - subi.t < 90 ? (350 + Math.min(subi.deg, 2000)*0.2) * (1 - (temps - subi.t)/90) : 0;
    const deja = campsEnJeu().filter(o => o !== id && o !== c && o !== campJoueur && etatsIA[o] && etatsIA[o].campCible === c && !allies(id, o)).length;
    const s = d + force*0.08 - Math.min(pression, 6)*120 - riposte + deja*150 + Math.random()*600;
    if(s < bs){ bs = s; best = c; }
  }
  return best;
}
function majIACamp(id, ia){
  const C = camps[id], F = FACTIONS[C.faction];
  const bats = ents.filter(e => e.camp === id && e.est === 'batiment' && !e.mort);
  const uns = ents.filter(e => e.camp === id && e.est === 'unite' && !e.mort);
  // Les avions ont leur propre conduite (majIAAviation) : ils ne suivent ni vagues ni rassemblement.
  const ouvriers = uns.filter(u => u.def.ouvrier);
  let armee = uns.filter(u => !u.def.ouvrier && !u.def.avion && !u.def.collecteur);
  const avions = uns.filter(u => u.def.avion);
  const qg = bats.find(b => b.type === 'qg');
  if(!bats.length) return;
  esquiverRayon(uns);   // mode Surprises : sortir des cercles d'alerte du rayon du vaisseau-mère
  // Ultra : l'analyse précède l'économie (productionUltra choisit les contres d'après elle).
  const U = estUltra(id);
  if(U) analyserUltra(id, etatUltra(id), bats, uns);
  economieIA(C, F, bats, ouvriers, armee, qg);
  const centre = qg || bats[0];
  // Rassemblement : 280 px devant la base, vers le centre de la carte (à deux camps : vers l'autre moitié,
  // comme avant novembre 2026).
  let rassemblement;
  if(campsEnJeu().length <= 2) rassemblement = {x:centre.x + (centre.x > LARG/2 ? -280 : 280), y:centre.y};
  else {
    const dx = LARG/2 - centre.x, dy = HAUT/2 - centre.y, d = Math.hypot(dx, dy) || 1;
    rassemblement = pointLibre(centre.x + dx/d*280, centre.y + dy/d*280);
  }
  if(U){ majUltra(id, ia, {C, F, bats, uns, armee, avions, qg, centre, rassemblement}); return; }
  // Un avion en vol n'est pas une menace pour l'armée de terre : elle ne court pas après lui.
  // Menaces : unités ennemies près de la base (camps adverses, et en mode Surprises les envahisseurs).
  const menaces = ents.filter(e => hostile(id, e.camp) && !e.mort && e.est === 'unite' && !(e.def.avion && enVol(e)) && bats.some(b => dist(b,e) < 550));
  majIAAviation(id, bats, avions, menaces);
  // Alliance (mode Surprises) : tout ce qui peut toucher le vaisseau-mère l'attaque (unités au sol qui
  // tirent en l'air, avions à missiles air-air prêts au sol), où qu'il soit ; le reste de l'armée défend
  // la base menacée ou vient aider le joueur. Avant novembre 2026, l'allié ne s'en prenait au vaisseau
  // que s'il survolait une base, et le gros de ses troupes restait au rassemblement.
  const vm = alliance ? vaisseauMere() : null;
  const contreVaisseau = new Set();
  if(vm){
    for(const u of armee){
      if(!peutCibler(u, vm) || efficacite(u.def.arme, vm) <= 0) continue;
      contreVaisseau.add(u);
      const o = u.ordre;
      if(o && o.type === 'aller') continue;                       // esquive du rayon en cours
      if(!(o && o.type === 'attaquer' && o.cible === vm)){ u.ordre = {type:'attaquer', cible:vm}; u.chemin = null; }
    }
    for(const u of avions){
      const D = u.def;
      if(D.armeAir && u.phase === 'sol' && !u.ordre && u.munitions >= D.munitions && u.pv >= u.pvMax*0.66 && peutCibler(u, vm))
        u.ordre = {type:'attaquer', cible:vm};
    }
  }
  const armeeAll = armee;
  armee = armee.filter(u => !contreVaisseau.has(u));
  // Quand sa base n'est pas menacée, l'ordinateur vient défendre celle de ses alliés (joueur ou autre
  // ordinateur de son équipe ; tous les camps pendant la trêve du mode Surprises).
  let aide = null;
  if(!menaces.length){
    const batsAllies = ents.filter(e => e.est === 'batiment' && !e.mort && allies(id, e.camp));
    if(batsAllies.length){
      const menace = e => !e.mort && e.est === 'unite' && hostile(id, e.camp) && !(e.def.avion && enVol(e)) && batsAllies.some(b => dist(b,e) < 550);
      aide = ents.find(e => e.def.forme !== 'vaisseauMere' && menace(e)) || ents.find(e => e.def.forme === 'vaisseauMere' && menace(e)) || null;
    }
  }
  if(menaces.length){
    // Le vaisseau-mère passe après les envahisseurs au sol : sous lui, une armée de terre est surtout une cible.
    const m = menaces.find(e => e.def.forme !== 'vaisseauMere') || menaces[0];
    for(const u of armee) if((!u.enVague || dist(u,m) < 900) && !u.cible) u.ordre = {type:'attaqueDeplacement', x:m.x, y:m.y};
  } else if(aide){
    for(const u of armee) if(!u.cible && (!u.ordre || u.ordre.type !== 'attaqueDeplacement' || Math.hypot(u.ordre.x - aide.x, u.ordre.y - aide.y) > 300))
      u.ordre = {type:'attaqueDeplacement', x:aide.x + (Math.random()-.5)*120, y:aide.y + (Math.random()-.5)*120};
  } else {
    const dispo = armee.filter(u => !u.enVague);
    if(temps > ia.premiereVague && dispo.length >= ia.vague){
      for(const u of dispo) u.enVague = true;
      ia.vague = Math.min(22, ia.vague + 2);
      ia.campCible = choisirCampCible(id, centre);   // nouvelle vague : la cible est revue
    }
    for(const u of dispo) if(!u.ordre && !u.cible && dist(u, rassemblement) > 220)
      u.ordre = {type:'aller', x:rassemblement.x + (Math.random()-.5)*160, y:rassemblement.y + (Math.random()-.5)*200};
  }
  if(!ia.campCible || !enVie(ia.campCible) || !hostile(id, ia.campCible)) ia.campCible = choisirCampCible(id, centre);
  // Pendant la trêve, il dirige ses vagues contre les envahisseurs (le vaisseau-mère d'abord).
  const cibleJ = alliance ? (ents.find(e => e.camp === 'X' && !e.mort && e.def.forme === 'vaisseauMere') || cibleVague(centre, id))
    : ia.campCible ? cibleVague(centre, id, ia.campCible) : null;
  for(const u of armee) if(u.enVague && !u.ordre && !u.cible && cibleJ)
    u.ordre = {type:'attaqueDeplacement', x:cibleJ.x + (Math.random()-.5)*80, y:cibleJ.y + (Math.random()-.5)*80};
  pouvoirsIA(C, menaces, armeeAll);
}
// IA d'une mission : base facultative, vagues programmées, point d'attaque préféré.
const LAISSE_DEFENSE = 700, DEFENSE_RAYON = 700, RETOUR_POSTE_MAX = 25, RETOUR_FINAL_MAX = 20;
// Menaces : une unité armée du joueur menace à moins de MENACE_RAYON px d'un bâtiment ; un ouvrier ou
// une unité sans arme seulement à moins de MENACE_RAYON_DESARME px (un sapeur qui récolte près d'une
// tourelle ne fait pas sortir la garnison). Les intrus voisins (chaîne de moins de MENACE_GROUPE px)
// forment une même menace, dont la force est la somme des coûts (moitié pour une unité sans arme).
const MENACE_RAYON = 550, MENACE_RAYON_DESARME = 250, MENACE_GROUPE = 220;
// Effectif engagé sur une menace : jusqu'à DEFENSE_PROPORTION fois sa force (en coûts), les plus
// proches d'abord. Une unité déjà affectée garde sa menace avec un bonus de AFFECTATION_BONUS px
// (pas de va-et-vient pour une petite différence) ; une unité plus proche d'une autre menace de
// plus de REAFFECTATION_ECART px est gardée pour celle-ci (sauf manque d'effectif).
// Les distances se mesurent depuis la position actuelle de l'unité ; son poste ne sert qu'à la laisse.
const DEFENSE_PROPORTION = 1.5, AFFECTATION_BONUS = 150, REAFFECTATION_ECART = 300;
// Une unité qui a rompu sa laisse n'est de nouveau candidate qu'une fois revenue à moins de
// LAISSE_DEFENSE - LAISSE_REPRISE px de son poste (sans cet écart, elle oscillerait au bout de sa laisse).
const LAISSE_REPRISE = 150;
const estArmee = e => !!e.def.arme && !e.def.ouvrier;
const valeurUnite = e => Math.max(30, e.def.cout || 0);
function menacesDe(campDefenseur, bats){
  if(!bats.length) return [];
  return ents.filter(e => e.est === 'unite' && !e.mort && e.camp === campJoueur && hostile(campDefenseur, e.camp) &&
    !(e.def.avion && enVol(e)) &&   // un avion en vol ne fait pas sortir la garnison
    bats.some(b => dist(b, e) < (estArmee(e) ? MENACE_RAYON : MENACE_RAYON_DESARME)));
}
function grouperMenaces(menaces, bats){
  const groupes = [], vu = new Set();
  for(const m of menaces){
    if(vu.has(m)) continue;
    const membres = [m]; vu.add(m);
    for(let k = 0; k < membres.length; k++) for(const n of menaces)
      if(!vu.has(n) && dist(membres[k], n) < MENACE_GROUPE){ vu.add(n); membres.push(n); }
    let force = 0;
    for(const e of membres) force += estArmee(e) ? valeurUnite(e) : valeurUnite(e)*0.5;
    // Tête de la menace : l'intrus le plus proche d'un bâtiment (le point que les défenseurs engagent).
    let bat = null, tete = null, bd = Infinity;
    for(const b of bats) for(const e of membres){ const d = dist(b, e); if(d < bd){ bd = d; bat = b; tete = e; } }
    groupes.push({membres:new Set(membres), force, bat, tete, d:bd});
  }
  // Les plus fortes d'abord, puis les plus serrées.
  return groupes.sort((a, c) => c.force - a.force || a.d - c.d);
}
// Répartition des défenseurs entre les menaces (recalculée à chaque passage de l'IA).
// Le classement se fait sur la position ACTUELLE de chaque unité, déjà engagée ou non : le poste
// d'un défenseur ne sert qu'à sa laisse (voir eligible). Deux temps :
// 1. Maintien : un défenseur qui a une cible vivante dans une menace y reste, tant que le besoin de
//    cette menace n'est pas dépassé de plus d'un défenseur. Une recrue, même plus proche de la tête
//    de la menace, n'évince donc pas un défenseur au contact.
// 2. Complément : les autres candidats, les plus proches d'abord, jusqu'au besoin.
function repartirDefense(groupes, candidats){
  const affect = new Map(), pris = new Set(), engages = new Map();
  const eligible = (u, g) => u.posteDefense
    ? dist(g.tete, u.posteDefense) <= LAISSE_DEFENSE + u.def.portee
    : dist(u, g.bat) < DEFENSE_RAYON && dist(u, g.tete) <= LAISSE_DEFENSE + u.def.portee;
  for(const g of groupes){
    const besoin = DEFENSE_PROPORTION * g.force;
    const tenus = candidats.filter(u => !pris.has(u) && u.posteDefense && u.cible && !u.cible.mort && g.membres.has(u.cible) && eligible(u, g))
      .sort((a, c) => dist(a, a.cible) - dist(c, c.cible));
    let engage = 0, surplus = 0;
    for(const u of tenus){
      if(engage >= besoin && surplus++ >= 1) break;      // besoin couvert : un seul défenseur de plus
      affect.set(u, g); pris.add(u); engage += valeurUnite(u);
    }
    engages.set(g, engage);
  }
  for(const g of groupes){
    const besoin = DEFENSE_PROPORTION * g.force;
    const liste = candidats.filter(u => !pris.has(u) && eligible(u, g))
      .map(u => ({u, s:dist(u, g.tete) - (u.menaceBloc && g.membres.has(u.menaceBloc) ? AFFECTATION_BONUS : 0)}))
      .sort((a, c) => a.s - c.s);
    // Unités nettement plus proches d'une autre menace : prises seulement en dernier recours.
    const ailleurs = u => groupes.some(h => h !== g && eligible(u, h) && dist(u, h.tete) < dist(u, g.tete) - REAFFECTATION_ECART);
    const premiers = liste.filter(x => !ailleurs(x.u)), derniers = liste.filter(x => ailleurs(x.u));
    let engage = engages.get(g);
    for(const {u} of premiers.concat(derniers)){
      if(engage >= besoin) break;
      affect.set(u, g); pris.add(u); engage += valeurUnite(u);
    }
  }
  return affect;
}
function leverLaisse(u){
  u.posteDefense = null; u.retourPoste = false; u.ordreRetour = null; u.menaceBloc = null; u.retourFinal = null;
  u.ruptureLaisse = false;
}
// Un ennemi est-il à portée réelle de tir de l'unité (sa cible actuelle, ou un autre) ?
function ennemiAPortee(u){
  const c = u.cible, D = u.def;
  if(c && peutCibler(u, c)){
    const d = distBord(u, c);
    if(d <= D.portee && (!D.porteeMin || d >= D.porteeMin)) return true;
  }
  return !!chercherCible(u, D.portee);
}
function majIAMission(){
  const C = camps.I, F = FACTIONS[C.faction];
  const bats = ents.filter(e => e.camp === 'I' && e.est === 'batiment' && !e.mort);
  const uns = ents.filter(e => e.camp === 'I' && e.est === 'unite' && !e.mort);
  const ouvriers = uns.filter(u => u.def.ouvrier), armee = uns.filter(u => !u.def.ouvrier && u.def.arme && !u.def.avion);
  const avions = uns.filter(u => u.def.avion && !u.nom);   // seulement si la mission autorise l'aviation
  const qg = bats.find(b => b.type === 'qg');
  if(ia.construit && bats.length) economieIA(C, F, bats, ouvriers, armee, qg);
  const scripte = u => u.ordre && u.ordre.type === 'chemin';
  // Défense : les unités proches réagissent aux intrus près des bâtiments.
  // - Les unités étiquetées (nom) n'y sont jamais enrôlées : elles n'obéissent qu'au script
  //   (elles ripostent seulement sur place si on les attaque, voir majUnite).
  // - Un défenseur hors vague est tenu en laisse : il ne poursuit pas au-delà de LAISSE_DEFENSE px
  //   de son poste (position au moment de l'enrôlement) et y revient quand la menace a disparu
  //   ou s'est éloignée. Les unités des vagues d'attaque gardent l'ancien comportement.
  // - Défense proportionnée (menacesDe, grouperMenaces, repartirDefense) : les intrus sont regroupés
  //   en menaces ; chaque menace, de la plus forte à la plus faible, reçoit jusqu'à
  //   DEFENSE_PROPORTION fois sa force en défenseurs (les plus proches d'abord, à moins de
  //   DEFENSE_RAYON px du bâtiment menacé) ; les suivants vont à la menace suivante, le reste ne
  //   bouge pas. La répartition est refaite à chaque passage : une unité change de menace si une
  //   menace plus forte en a besoin ou si une autre est nettement plus proche d'elle ; un défenseur
  //   au contact (cible vivante dans la menace) n'est pas retiré au profit d'une recrue.
  //   Les défenseurs d'une même menace engagent ensemble son intrus de tête.
  // - Retour au poste en attaque-déplacement, quand il n'y a plus rien à défendre, que l'unité n'est
  //   plus nécessaire ou qu'elle a rompu sa laisse. Si elle a un ennemi à portée de tir à ce moment
  //   (ou plus tard sur le chemin du retour), elle ne rentre pas sous le feu : sa laisse est levée
  //   sur place, son poste devient sa position actuelle, et elle se bat là comme une unité au repos.
  //   Une unité en retour reste candidate tant qu'elle est dans sa laisse : si la menace grossit,
  //   elle est rappelée (voir LAISSE_REPRISE pour celle qui avait rompu sa laisse).
  //   La laisse est levée à l'arrivée (ordre de retour terminé) ; si l'unité est encore en route
  //   après RETOUR_POSTE_MAX s (chemin bouché), elle reçoit un ordre « aller » final vers le point
  //   libre le plus proche du poste, et la laisse est levée quand celui-ci est terminé (ou après
  //   RETOUR_FINAL_MAX s de plus) : jamais d'unité abandonnée en chemin.
  const menaces = menacesDe('I', bats);
  const groupes = menaces.length ? grouperMenaces(menaces, bats) : [];
  const candidats = armee.filter(u => !u.nom && !scripte(u) && !u.enVague &&
    (!u.posteDefense || dist(u, u.posteDefense) <= LAISSE_DEFENSE - (u.retourPoste && u.ruptureLaisse ? LAISSE_REPRISE : 0)));
  const affect = groupes.length ? repartirDefense(groupes, candidats) : new Map();
  for(const u of armee){
    if(u.nom || scripte(u)) continue;
    if(u.enVague){
      if(!menaces.length || u.cible) continue;
      const m = menaces[0];
      if(dist(u, m) < 900) u.ordre = {type:'attaqueDeplacement', x:m.x, y:m.y};
      continue;
    }
    const g = affect.get(u);
    if(g){
      const m = g.tete;
      if(!u.posteDefense){
        // Enrôlement : le poste est la position actuelle.
        u.posteDefense = {x:u.x, y:u.y};
        u.ordre = {type:'attaqueDeplacement', x:m.x + (Math.random()-.5)*40, y:m.y + (Math.random()-.5)*40};
      } else if(u.retourPoste){
        // Rappelé pendant son retour (la menace a grossi) : il garde son poste et repart.
        u.retourPoste = false; u.ordreRetour = null; u.retourFinal = null; u.ruptureLaisse = false;
        u.ordre = {type:'attaqueDeplacement', x:m.x, y:m.y}; u.chemin = null;
      } else if(!u.cible && (!u.ordre || u.ordre.type !== 'attaqueDeplacement' || Math.hypot(u.ordre.x - m.x, u.ordre.y - m.y) > 60))
        u.ordre = {type:'attaqueDeplacement', x:m.x, y:m.y};
      u.menaceBloc = m;
      continue;
    }
    const poste = u.posteDefense;
    if(!poste) continue;
    // Ennemi à portée au moment de rentrer, ou sur le chemin du retour : pas de retraite sous le
    // feu. La laisse est levée sur place (son poste devient sa position actuelle).
    if(ennemiAPortee(u)){
      u.ordre = null; u.chemin = null;
      leverLaisse(u);
      continue;
    }
    if(!u.retourPoste){
      // Rupture de laisse, plus rien à défendre ou plus besoin de lui : retour au poste.
      u.retourPoste = true; u.retourDebut = temps; u.retourFinal = null; u.menaceBloc = null;
      u.ruptureLaisse = dist(u, poste) > LAISSE_DEFENSE;
      u.ordreRetour = {type:'attaqueDeplacement', x:poste.x, y:poste.y};
      u.ordre = u.ordreRetour; u.cible = null; u.chemin = null;
      continue;
    }
    if(u.retourFinal){
      // Ordre « aller » final : la laisse est levée quand il est terminé (ou remplacé).
      if(u.ordre !== u.retourFinal || temps - u.retourFinalDebut > RETOUR_FINAL_MAX){
        if(u.ordre === u.retourFinal) u.ordre = null;
        leverLaisse(u);
      }
      continue;
    }
    // Arrivée : ordre de retour terminé (au plus près, par exemple si un bâtiment a été construit sur
    // le poste) ou remplacé. Jamais de nouvel ordre de retour : pas d'oscillation.
    if(dist(u, poste) <= 60 || (u.ordre !== u.ordreRetour && !u.cible)){
      if(u.ordre === u.ordreRetour) u.ordre = null;
      leverLaisse(u);
      continue;
    }
    if(temps - (u.retourDebut || 0) > RETOUR_POSTE_MAX){
      const p = pointLibre(poste.x, poste.y);
      u.retourFinal = {type:'aller', x:p.x, y:p.y}; u.retourFinalDebut = temps;
      u.ordre = u.retourFinal; u.cible = null; u.chemin = null;
    }
  }
  // Rassemblement près de la base (seulement si l'IA construit)
  const centre = qg || bats[0] || null;
  if(ia.construit && centre && !menaces.length){
    const rassemblement = {x:centre.x + (centre.x > LARG/2 ? -280 : 280), y:centre.y};
    for(const u of armee) if(!u.enVague && !u.nom && !u.ordre && !u.cible && dist(u, rassemblement) > 220)
      u.ordre = {type:'aller', x:rassemblement.x + (Math.random()-.5)*160, y:rassemblement.y + (Math.random()-.5)*200};
  }
  // Vagues programmées (les unités étiquetées n'y participent pas : elles suivent le script)
  if(ia.vagues && temps >= ia.prochaineVague){
    const V = ia.vagues;
    const taille = Math.max(1, Math.round((nombre(V.taille, 6) + nombre(V.croissance, 0)*ia.nVagues) * reglagesMission().vagueMul));
    const dispo = armee.filter(u => !u.enVague && !u.nom && !scripte(u));
    ia.attenteVague += 0.8;
    // Avec une base, on attend d'avoir assez d'unités (au plus la moitié de l'intervalle) ;
    // sans base, on envoie ce qu'il y a.
    const assez = dispo.length >= taille || (dispo.length && (!ia.construit || ia.attenteVague > nombre(V.intervalle, 150)/2));
    if(assez){
      for(const u of dispo.slice(0, taille)){ u.enVague = true; u.ordre = null; leverLaisse(u); }
      ia.nVagues++; ia.attenteVague = 0;
      ia.prochaineVague = temps + Math.max(10, nombre(V.intervalle, 150));
    } else if(!dispo.length && !ia.construit){
      ia.prochaineVague = temps + 10; ia.attenteVague = 0;
    }
  }
  // Unités en vague : vers le point d'attaque, puis vers l'ennemi le plus proche.
  for(const u of armee){
    if(!u.enVague || u.ordre || u.cible) continue;
    let but = ia.cible && Math.hypot(ia.cible.x-u.x, ia.cible.y-u.y) > 160 ? ia.cible : null;
    if(!but) but = cibleVague(centre || u, 'I');
    if(but) u.ordre = {type:'attaqueDeplacement', x:but.x + (Math.random()-.5)*80, y:but.y + (Math.random()-.5)*80};
  }
  if(avions.length && bats.length) majIAAviation('I', bats, avions, menaces);
  pouvoirsIA(C, menaces, armee);
}
// Emplacement d'un bâtiment de l'IA. Premier passage : on évite aussi les tuiles occupées par des
// unités (marge EMPLACEMENT_MARGE_UNITE px) et les postes de défense (marge EMPLACEMENT_MARGE_POSTE px),
// pour ne pas bâtir sur sa garnison ni sur l'endroit où un défenseur doit revenir. Cet évitement ne
// déplace le bâtiment que de quelques cases (voir trouverEmplacement) ; si rien ne convient, on bâtit
// sans cette contrainte : l'IA n'est jamais empêchée de construire.
const EMPLACEMENT_MARGE_UNITE = 20, EMPLACEMENT_MARGE_POSTE = 60;
function emplacementLibreIA(type, c, r){
  const t = BATIMENTS[type].taille;
  const x0 = c*TUILE, y0 = r*TUILE, x1 = (c+t)*TUILE, y1 = (r+t)*TUILE;
  const dedans = (p, m) => p.x > x0 - m && p.x < x1 + m && p.y > y0 - m && p.y < y1 + m;
  for(const e of ents){
    if(e.mort || e.est !== 'unite') continue;
    if(dedans(e, EMPLACEMENT_MARGE_UNITE + (e.rayon || 0))) return false;
    if(e.posteDefense && dedans(e.posteDefense, EMPLACEMENT_MARGE_POSTE)) return false;
  }
  return true;
}
// L'évitement ne doit pas repousser le bâtiment loin : on cherche d'abord le meilleur emplacement
// sans contrainte, puis un emplacement qui évite les unités à au plus EMPLACEMENT_ECART_MAX cases de
// celui-ci (le plus proche) ; à défaut, on prend l'emplacement sans contrainte.
const EMPLACEMENT_ECART_MAX = 3;
function trouverEmplacement(type, centre){
  const t = BATIMENTS[type].taille, cc = Math.floor(centre.x/TUILE), cr = Math.floor(centre.y/TUILE);
  let base = null;
  for(let rad=4; rad<16 && !base; rad++) for(let k=0;k<20;k++){
    const a = k/20*Math.PI*2 + rad;
    const c = Math.round(cc + Math.cos(a)*rad - t/2), r = Math.round(cr + Math.sin(a)*rad - t/2);
    if(emplacementValide(type, c, r, true)){ base = {c, r}; break; }
  }
  if(!base) return null;
  for(let d=0; d<=EMPLACEMENT_ECART_MAX; d++){
    let best = null, bd = Infinity;
    for(let dc=-d; dc<=d; dc++) for(let dr=-d; dr<=d; dr++){
      if(Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
      const c = base.c + dc, r = base.r + dr, dd = dc*dc + dr*dr;
      if(dd < bd && emplacementValide(type, c, r, true) && emplacementLibreIA(type, c, r)){ bd = dd; best = {c, r}; }
    }
    if(best) return best;
  }
  return base;
}
// Cible d'une vague : ennemi le plus proche du centre, bâtiments d'abord.
// camp : camp qui attaque (toute entité qui lui est hostile, neutres compris si la relation le permet) ;
// seul : ne viser que ce camp-là (escarmouche : le camp ennemi choisi par choisirCampCible).
function cibleVague(centre, camp, seul){
  let best = null, bd = Infinity;
  for(const e of ents){
    if(e.mort || (e.def.avion && enVol(e))) continue;   // une vague ne court pas après un avion en vol
    if(seul ? e.camp !== seul : camp ? !hostile(camp, e.camp) : e.camp !== campJoueur) continue;
    const d = dist(e, centre) + (e.est === 'batiment' ? 0 : 400);
    if(d < bd){ bd = d; best = e; }
  }
  return best;
}
function meilleurGroupe(camp){
  const liste = ents.filter(e => e.camp === camp && !e.mort && !(e.def.avion && enVol(e)));
  let best = null;
  for(const e of liste){
    let s = 0;
    for(const f of liste) if(Math.hypot(f.x-e.x, f.y-e.y) < 170) s += f.est === 'batiment' ? 2 : f.def.forme === 'vaisseauMere' ? 6 : 1;
    if(!best || s > best.score) best = {x:e.x, y:e.y, score:s};
  }
  return best;
}

// =====================================================================
//  7 ter. DIFFICULTÉ ULTRA (escarmouche) : un ordinateur rusé, sans aucune triche
// =====================================================================
// Décision du propriétaire (novembre 2026) : « très intelligent et rusé », et AUCUNE TRICHE. L'ordinateur
// Ultra a exactement le revenu (DIFFICULTES.ultra.revenu = 1), les prix, les durées, la limite d'effectifs
// et les règles du joueur. Il voit la carte comme le joueur la voit (le jeu n'a pas de brouillard). Tout
// ce qu'il obtient passe par commander, construireBatiment et activerPouvoir, comme le joueur.
// Les trois difficultés existantes ne passent jamais par ce code (estUltra). En mission, Ultra vaut Difficile.
// Une réflexion par camp toutes les 0,8 s (majIA), dans cet ordre :
//   analyserUltra   un seul passage sur les entités : forces de chaque ennemi, composition, zones annoncées,
//                   grille de voisinage (cases de ULTRA.CASE px) qui sert à toutes les recherches suivantes ;
//   economieIA      avec collecteursUltra, planUltra, centreChantierUltra, productionUltra, avionUtileUltra ;
//   defendreUltra   garnison proportionnée sur chaque menace (base, collecteurs, alliés), collecteurs détournés ;
//   harcelerUltra   petit groupe rapide contre collecteurs et bâtiments isolés, avec détour et repli ;
//   attaquerUltra   regroupement, choix de l'ennemi et de l'objectif, diversion, marche groupée, retraite ;
//   combattreUltra  tir concentré, recul des unités à longue portée, esquive, repli des blessés ;
//   soutenirUltra   réparateurs qui suivent l'armée ;
//   pouvoirsUltra   pouvoirs sur les combats au contact, puis les groupes serrés, puis les bâtiments clés.
// Mode Surprises, trêve acceptée : treveUltra, productionTreveUltra (antiaérien d'abord), eloignerDuVaisseauUltra.
// Journal des décisions (tests) : window.JOURNAL_ULTRA = true (lignes dans JOURNAL_IA) ou 'console'.
const ULTRA = {
  CASE:320,                 // px : côté d'une case de la grille de voisinage
  RAYON_BASE:600,           // px : un ennemi à cette distance d'un bâtiment menace la base
  RAYON_COLLECTEUR:380,     // px : ... d'un collecteur
  GROUPE_MENACE:320,        // px : deux intrus plus proches forment une même menace
  DEFENSE_PROPORTION:1.6,   // valeur engagée / valeur de la menace
  ASSAUT_MARGE:1.35,        // valeur de l'armée / défense de l'objectif, pour lancer l'assaut
  ASSAUT_MIN:1500,          // valeur minimale d'une armée d'assaut
  RETRAITE:1.6,             // retraite quand la force ennemie locale dépasse ce multiple de la nôtre
  GARNISON:0.15,            // part de l'armée laissée à la base pendant un assaut (au moins)
  DIVERSION_AVANCE:6,       // s entre la diversion et l'assaut principal
  HARCELEURS:3,             // taille du groupe de harcèlement
  HARCELEMENT_REPOS:25,     // s d'attente après un harcèlement
  REPLI_PV:0.3, REPRISE_PV:0.8, REPLI_MAX:45,   // repli des blessés (part des PV, durée maximale en s)
  SURVIE:0.02,              // terme de survie de la note de production (1/s)
  CHAMP_MENACE:25,          // s pendant lesquels un champ menacé est évité par les collecteurs
  // Correctifs du 13 novembre 2026 (relecture et essais indépendants) :
  APPROCHE:1300,            // px : armée adverse « qui approche » (aucune expansion économique)
  ARMEE_MIN:600,            // valeur d'armée minimale avant toute expansion (plus 3/4 de la plus forte adverse, lissée)
  OUVRIERS:2,               // ouvriers tant que l'économie ne s'étend pas (un de plus ensuite)
  REGROUPE_MIN:18,          // s de regroupement et de réparation après une retraite, avant tout nouvel assaut
  ECHEC_MEMOIRE:180,        // s pendant lesquels un objectif repoussé exige le rapport de forces rétabli
  GARDES_CHAMP:2,           // défenseurs postés près d'un champ harcelé
  GARDE_MEMOIRE:150,        // s pendant lesquels un champ harcelé garde ses défenseurs
};
// Expansion économique permise (dépôt avancé, collecteurs au-delà de 4, ouvriers au-delà de 2, bâtiments
// hors cœur) : aucune menace sur la base, rien qui approche, et une armée d'au moins ARMEE_MIN plus les
// trois quarts de la plus forte armée adverse (valeur lissée, plusForteRef). (Essai indépendant du 13 novembre 2026 : Karsk Ultra mettait un
// dépôt dès le troisième bâtiment, plus des dépôts avancés, des collecteurs et des sapeurs, et n'avait
// à 6 minutes que 5 unités, d'une valeur de 400, contre 1 482 pour Difficile.)
function expansionUltra(id){
  const S = etatUltra(id), A = S.analyse;
  if(!A || S.menace > 0 || A.approche > 250) return false;
  return (S.monArmee || 0) >= ULTRA.ARMEE_MIN + (S.plusForteRef || 0)*0.75;
}
// Mode Surprises, trêve acceptée et vaisseau-mère présent (finitions du 13 novembre 2026, contre-essai
// indépendant : avec le vaisseau à 30 s, Ultra n'achetait rien, gardait 400 pour racheter des collecteurs
// que les dards abattaient aussitôt, et était éliminé en 240 à 360 s).
function treveUltra(){ return alliance ? vaisseauMere() : null; }
// Réserve gardée pour racheter un collecteur : en trêve, rien tant qu'il en reste deux (la défense
// antiaérienne passe avant : un collecteur racheté sans défense était abattu par les dards).
function gardeCollecteurUltra(id, collecteurs){
  return treveUltra() && collecteurs >= 2 ? 0 : RESERVE_COLLECTEUR;
}
// Aviation permise (13 novembre 2026, contre-essai : presque aucun appareil, même face à un antiaérien
// nul) : aucune DCA adverse (unité ou bâtiment à arme « aa »), peu d'autres armes antiaériennes, pas de
// menace sur la base, et une armée de terre qui tient (ARMEE_MIN plus la moitié de la plus forte adverse).
// Ne dépend plus de l'expansion économique.
function aviationUltra(id){
  const S = etatUltra(id), A = S.analyse;
  if(!A || S.menace > 0 || treveUltra() || temps < 200) return false;
  return A.dcaEnnemie === 0 && A.aaEnnemie < 6 && (S.monArmee || 0) >= ULTRA.ARMEE_MIN + (S.plusForteRef || 0)*0.5;
}
let JOURNAL_IA = [];
function journalUltra(id, texte){
  if(typeof window === 'undefined' || !window.JOURNAL_ULTRA) return;
  const l = enMinSec(temps) + ' ' + id + ' ' + texte;
  JOURNAL_IA.push(l); if(JOURNAL_IA.length > 3000) JOURNAL_IA.shift();
  if(window.JOURNAL_ULTRA === 'console') console.log('[Ultra] ' + l);
}
function etatUltra(id){
  const E = etatIA(id);
  return E.ultra || (E.ultra = {analyse:null, phase:'regroupe', cible:null, campCible:null, assautT:0, retraiteT:0,
    valeurDepart:0, harcelement:null, harceleT:0, champsMenaces:new Map(), axe:{x:0, y:0}, champLointain:null});
}
// ---------- Outils de calcul (fonctions pures sur les fiches) ----------
// Dégâts par seconde de la fiche Da contre la fiche Db (Db.aerien : cible en vol ; blindage absent :
// bâtiment). Avions : divisés par trois (ils passent l'essentiel du temps en route ou au réarmement).
function dpsContre(Da, Db){
  const air = !!Db.aerien;   // vaisseau-mère compris
  if(air ? !Da.air : !Da.sol) return 0;
  if(Da.pasAvion && (Db.avion || Db.forme === 'vaisseauMere')) return 0;
  const W = (Da.armeSol || Da.armeAir) ? (air ? Da.armeAir : Da.armeSol) : Da;
  if(!W) return 0;
  const arme = W.arme || Da.arme, ligne = EFFICACITE[arme], blind = Db.blindage || 'batiment';
  const k = ligne && typeof ligne[blind] === 'number' ? ligne[blind] : 1;
  let d = (W.degats || 0) * (W.salve || Da.salve || 1) / (W.cadence || Da.cadence || 1) * k;
  if(W.bonusHelico && blind === 'helico') d *= W.bonusHelico;
  if(Da.avion) d /= 3;
  return d;
}
// Valeur de combat d'une entité (coût pondéré par l'état) ; 0 pour ce qui ne se bat pas.
function valeurCombat(e){
  if(e.est === 'batiment') return e.def.arme && !e.enCours ? (e.def.cout || 400) + e.pvMax*0.4 : 0;
  if(!e.def.arme || e.def.ouvrier) return 0;
  const v = Math.max(30, e.def.cout || 0) * (0.35 + 0.65*e.pv/e.pvMax);
  return e.def.avion ? v*0.5 : v;
}
function cleCase(x, y){ return Math.floor(x/ULTRA.CASE) + Math.floor(y/ULTRA.CASE)*1000; }
// Parcourt les entités ennemies de la grille à moins de r px de (x, y).
function voisinsUltra(A, x, y, r, fn){
  const c0 = Math.floor((x - r)/ULTRA.CASE), c1 = Math.floor((x + r)/ULTRA.CASE);
  const l0 = Math.floor((y - r)/ULTRA.CASE), l1 = Math.floor((y + r)/ULTRA.CASE);
  for(let l = l0; l <= l1; l++) for(let c = c0; c <= c1; c++){
    const liste = A.grille.get(c + l*1000); if(!liste) continue;
    for(const e of liste) if(!e.mort && Math.hypot(e.x - x, e.y - y) <= r) fn(e);
  }
}
// Force ennemie (valeur de combat) à moins de r px d'un point.
function forceEnnemie(A, x, y, r){ let s = 0; voisinsUltra(A, x, y, r, e => { s += valeurCombat(e); }); return s; }
function barycentre(liste){
  let x = 0, y = 0; for(const u of liste){ x += u.x; y += u.y; }
  return liste.length ? {x:x/liste.length, y:y/liste.length} : null;
}
// ---------- Analyse (une par réflexion) ----------
function analyserUltra(id, S, bats, uns){
  const A = {ennemis:{}, grille:new Map(), zones:[], cibles:new Map(), appareils:0, aaEnnemie:0, dcaEnnemie:0, mesAppareils:0};
  for(const e of ents){
    if(e.mort || e.demo || e.camp === 'N' || !hostile(id, e.camp)) continue;
    const K = A.ennemis[e.camp] || (A.ennemis[e.camp] = {camp:e.camp, armee:[], bats:[], eco:[], valeur:0});
    if(e.est === 'batiment') K.bats.push(e);
    else if(e.def.collecteur || e.def.ouvrier) K.eco.push(e);
    else if(e.def.arme){ K.armee.push(e); K.valeur += valeurCombat(e); }
    if(e.est === 'unite' && e.def.aerien && e.def.forme !== 'vaisseauMere') A.appareils++;
    if(e.def.arme && e.def.air && !e.def.avion && !e.def.pasAvion) A.aaEnnemie += e.def.arme === 'aa' ? 3 : 1;
    if(e.def.arme === 'aa' && e.camp !== 'X') A.dcaEnnemie++;
    // Composition adverse, en coûts par type (bâtiments sans arme comptés au quart : il faut aussi les raser).
    const cout = Math.max(30, e.def.cout || (e.est === 'batiment' ? 600 : 200));
    const poids = e.est === 'batiment' ? (e.def.arme ? cout : cout*0.25) : (e.def.arme || e.def.collecteur ? cout : 0);
    if(poids){ const k = (e.est === 'batiment' ? 'b:' : '') + e.type, c = A.cibles.get(k); if(c) c.poids += poids; else A.cibles.set(k, {def:e.def, poids}); }
    const k = cleCase(e.x, e.y), l = A.grille.get(k); if(l) l.push(e); else A.grille.set(k, [e]);
  }
  // Connaissance a priori : un peu de chaque unité de base des factions ennemies (début de partie).
  for(const K of Object.values(A.ennemis)){
    const F = camps[K.camp] && FACTIONS[camps[K.camp].faction];
    if(F && F.iaVehicules) for(const t of F.iaVehicules.concat(F.iaInfanterie || [])){
      const c = A.cibles.get(t); if(c) c.poids += 60; else A.cibles.set(t, {def:UNITES[t], poids:60});
    }
  }
  for(const u of uns) if(u.def.aerien) A.mesAppareils++;
  // Plus forte armée adverse (envahisseurs exclus) et armée adverse qui approche (à moins de
  // ULTRA.APPROCHE px d'un de nos bâtiments) : l'économie ne s'étend que si rien n'approche.
  A.plusForte = 0; A.approche = 0;
  for(const K of Object.values(A.ennemis)){
    if(K.camp !== 'X') A.plusForte = Math.max(A.plusForte, K.valeur);
    for(const e of K.armee) if(!(e.def.avion && enVol(e)) && bats.some(b => dist(b, e) < ULTRA.APPROCHE)) A.approche += valeurCombat(e);
  }
  // Référence lissée (demi-vie d'environ une minute) : une armée adverse décimée se reconstruit vite, et
  // l'expansion ne doit pas s'ouvrir pour autant (essai du 13 novembre 2026).
  S.plusForteRef = Math.max(A.plusForte, (S.plusForteRef || 0)*0.99);
  // Zones annoncées : pouvoirs adverses (marqueurs) et rayon du vaisseau-mère (cercles d'alerte), avec la
  // portée réelle des impacts (explosionZone : chaque impact touche à son propre rayon autour d'un point tiré
  // dans le cercle, et compte la moitié du rayon de l'unité) : Frappe au rayon, Essaim à rayon + 50,
  // Marteau à rayon + 80.
  const debord = {frappe:0, essaim:50, marteau:80};
  for(const f of effets){
    if(f.type === 'marqueur' && f.pouvoir && f.camp && f.camp !== id && !allies(id, f.camp)) A.zones.push({x:f.x, y:f.y, r:f.r + (debord[f.pouvoir] || 80) + 15});
    else if(f.type === 'chargeSol') A.zones.push({x:f.x, y:f.y, r:f.rayon + 15});
  }
  S.analyse = A;
  return A;
}
// ---------- Économie ----------
// Collecteurs voulus : deux de plus que de champs proches de nos dépôts, plafonnés selon l'effectif permis.
function collecteursUltra(id, bats){
  const depots = bats.filter(b => b.def.depot && !b.enCours);
  let n = 0;
  for(const nd of noeuds) if(nd.reste > 0 && depots.some(d => dist(d, nd) < 1500)) n++;
  const plafond = popMax >= 60 ? 7 : popMax >= 40 ? 5 : 4;
  // Montée progressive (un de plus toutes les 90 s, à partir de 4) : une armée d'abord, sinon la première
  // attaque adverse trouvait la base vide (essai du 13 novembre 2026). Sous la menace, pas d'achat de plus.
  // (13 novembre 2026, second essai : au-delà de 4, un collecteur de plus seulement quand l'économie peut
  // s'étendre, expansionUltra ; la rampe n'avance que pendant ces moments-là.)
  const S = etatUltra(id);
  if(S.rampeT === undefined){ S.rampeT = temps; S.rampe = 4; }
  if(expansionUltra(id)){ if(temps - S.rampeT >= 90){ S.rampe++; S.rampeT = temps; } }
  else S.rampeT = Math.max(S.rampeT, temps - 60);   // l'attente ne s'accumule pas pendant les menaces
  // (Essai : le quatrième collecteur après l'usine faisait perdre davantage, 1 sur 6 au lieu de 2 sur 6.)
  const rampe = S.rampe;
  const actuels = ents.filter(e => e.camp === id && !e.mort && e.def.collecteur).length;
  const voulu = Math.max(3, Math.min(plafond, n + 2, rampe));
  // Trêve : tant que la défense antiaérienne est faible (moins de quatre unités qui tirent en l'air), pas
  // plus de collecteurs qu'il n'en reste (deux au moins).
  if(treveUltra() && (S.antiAirTreve || 0) < 4) return Math.min(voulu, Math.max(2, actuels));
  // Ouverture (contre-essai du 13 novembre 2026, Val des Brunelles : à 3 minutes, Karsk Ultra alignait 475
  // en coût d'unités armées contre 1 170 pour son adversaire Difficile ; le quatrième collecteur, acheté à
  // 16 s, coûtait 400 avant toute unité) : trois collecteurs tant que la première usine n'a pas sorti
  // deux blindés de combat. Karsk seulement : pour Halden, déjà fragile contre Karsk Difficile, les quatre
  // duels de contrôle avec cette règle n'ont donné qu'une victoire sur quatre (13 novembre 2026).
  const blindes = camps[id].faction !== 'karsk' ? 2 : ents.filter(e => e.camp === id && !e.mort && e.est === 'unite' && e.def.arme && e.def.sol && !e.def.aerien && e.def.forme !== 'infanterie' && !e.def.repare).length;
  if(temps < 300 && blindes < 2) return Math.min(voulu, 3);
  return S.menace > 0 ? Math.min(voulu, Math.max(3, actuels)) : voulu;
}
// Plan de construction : usine tôt (les blindés décident des combats), dépôt avancé quand un champ riche
// est loin de tout dépôt, batterie tôt contre une aviation adverse.
function planUltra(id, F, bats, menaceAir){
  const S = etatUltra(id);
  // Avec un revenu d'environ 10 par seconde, une caserne et une usine produisent déjà plus vite que l'argent
  // ne rentre : la seconde usine, l'aéroport et les défenses fixes ne viennent que quand l'armée domine
  // (S.domine, posé par productionUltra) ou qu'il y a beaucoup d'argent ; la batterie tôt contre une aviation
  // adverse. (Premier essai avec le plan complet : 4 000 en bâtiments, deux minutes sans aucune unité.)
  const riche = S.domine || camps[id].reserves > 1500;
  // Armée d'abord (13 novembre 2026, second essai) : le bâtiment spécial de Karsk est un dépôt, qui ne vient
  // donc qu'avec l'expansion ; l'antenne de Halden (aura, 200) reste en troisième place.
  const expansion = expansionUltra(id), A = S.analyse;
  const plan = ['caserne', 'usine'];
  // Trêve : usine (pour la DCA), puis la défense fixe qui tire en l'air (bunker de Karsk), puis des batteries.
  if(treveUltra()){
    const defAir = F.defense && BATIMENTS[F.defense] && BATIMENTS[F.defense].air;
    if(defAir) plan.push(F.defense);
    plan.push('batterie');
    if(defAir) plan.push(F.defense);
    plan.push('batterie', 'batterie');
    return plan;
  }
  if(F.special && (F.special !== 'depot' || expansion)) plan.push(F.special);
  if(menaceAir || vaisseauMere()) plan.push('batterie');   // la batterie atteint aussi le vaisseau-mère
  // Aviation avancée quand l'antiaérien adverse est faible et que l'armée de terre est formée.
  // (Contre-essai du 13 novembre 2026 : liée à l'expansion, cette condition n'était presque jamais remplie ;
  // désormais aviationUltra : aucune DCA adverse et une armée de terre qui tient.)
  if(!riche && temps <= 600 && aviationUltra(id)) plan.push('aeroport');
  if(riche || temps > 600) plan.push('aeroport', 'usine', F.defense, 'caserne', F.special, 'batterie');
  // Dépôt avancé : un champ de plus de 600 de minerai, à plus de 650 px de tout dépôt et à moins de 1 800 px
  // du QG, loin des défenses ennemies ; seulement pendant l'expansion.
  S.champLointain = null;
  if(expansion && autorise('batiments', 'depot')){
    const depots = bats.filter(b => b.def.depot), qg = bats.find(b => b.type === 'qg') || bats[0];
    let best = null, bd = Infinity;
    for(const nd of noeuds){
      // (Seuil 650 px au premier essai ; un collecteur ne roule qu'à 58 px/s, chaque aller-retour compte.)
      if(nd.reste < 600 || depots.some(d => dist(d, nd) < 450)) continue;
      const d = dist(qg, nd);
      if(d > 1800 || d >= bd) continue;
      if(S.analyse && forceEnnemie(S.analyse, nd.x, nd.y, 500) > 300) continue;
      // De notre côté seulement : nettement plus près de notre QG que de tout bâtiment ennemi (essai du
      // 13 novembre 2026 : un dépôt au champ central, détruit et rebâti trois fois, ruinait le revenu).
      if(S.analyse && Object.values(S.analyse.ennemis).some(K => K.bats.some(b => dist(b, nd) < d*1.25))) continue;
      bd = d; best = nd;
    }
    if(best){
      S.champLointain = best;
      const voulus = Math.min(3, bats.filter(b => b.type === 'depot').length + 1);
      for(let k = plan.filter(t => t === 'depot').length; k < voulus; k++) plan.splice(3, 0, 'depot');
    }
  }
  return plan;
}
// Ouvriers voulus : un seul sous la menace (s'il n'en reste aucun), ULTRA.OUVRIERS hors expansion, un de
// plus pendant l'expansion.
function ouvriersUltra(id){
  const S = etatUltra(id);
  if(treveUltra()) return 2;   // trêve : un ouvrier de plus pour réparer sous les dards
  if(S.menace > 0) return 1;
  return expansionUltra(id) ? ULTRA.OUVRIERS + 1 : ULTRA.OUVRIERS;
}
// Bâtiment permis sous la menace : seulement ce qui est vital.
function batimentPermisUltra(id, type, bats){
  const S = etatUltra(id), A = S.analyse;
  if(!(S.menace > 0)) return true;
  if((type === 'caserne' || type === 'usine') && !bats.some(b => b.type === type)) return true;
  if(treveUltra() && BATIMENTS[type] && BATIMENTS[type].air) return true;   // bunker de Karsk en trêve
  return type === 'batterie' && (!!vaisseauMere() || !!(A && A.appareils));
}
// Emplacement : le dépôt près du champ lointain, les défenses fixes sur l'axe d'où vient la menace.
function centreChantierUltra(id, type, defaut){
  const S = etatUltra(id), F = faction(id);
  if(type === 'depot' && S.champLointain){
    const n = S.champLointain, dx = defaut.x - n.x, dy = defaut.y - n.y, d = Math.hypot(dx, dy) || 1;
    return {x:n.x + dx/d*120, y:n.y + dy/d*120};
  }
  if(type === F.defense || type === 'batterie'){
    let ax = S.axe.x, ay = S.axe.y;
    if(Math.hypot(ax, ay) < 1){
      // Pas encore d'attaque subie : vers la base ennemie la plus proche.
      const e = cibleVague(defaut, id); if(e){ ax = e.x - defaut.x; ay = e.y - defaut.y; }
    }
    const d = Math.hypot(ax, ay) || 1;
    journalUltra(id, 'défense fixe ' + type + ' sur l’axe (' + Math.round(ax/d*100)/100 + ', ' + Math.round(ay/d*100)/100 + ')');
    return {x:defaut.x + ax/d*220, y:defaut.y + ay/d*220};
  }
  return defaut;
}
function avionUtileUltra(id, urgent, armee){
  const A = etatUltra(id).analyse;
  if(urgent) return true;
  // (13 novembre 2026 : un seul appareil en 30 parties avec « 8 unités et antiaérien < 8 » ; seuils
  // abaissés, mais jamais sous la menace ni avant que l'armée de terre permette l'expansion.)
  if(!A || etatUltra(id).menace > 0) return false;
  return armee.length >= 6 && aviationUltra(id);
}
// Note d'une unité à produire contre l'ennemi observé : dégâts infligés à sa composition (pondérée par les
// coûts), divisés par le coût et par les dégâts qu'elle subirait ; un type déjà très représenté est pénalisé
// (pour ne pas tout miser sur ce que l'ennemi peut contrer). Fonction pure.
function noteProductionUltra(t, cibles, mesCouts, total){
  const D = UNITES[t];
  let off = 0, men = 0;
  for(const {def:Db, poids} of cibles.values()){
    off += poids * dpsContre(D, Db) / Math.max(1, Db.pv || 1000);
    men += poids / Math.max(30, Db.cout || 300) * dpsContre(Db, D) / D.pv;
  }
  const part = (mesCouts[t] || 0) / Math.max(1, total);
  return off * (1 + (D.portee || 150)/700) / (D.cout * (men + ULTRA.SURVIE)) / (1 + 4*part*part);
}
function productionUltra(C, F, bats, armee, gardeC, reserveMin, epargne){
  const id = C.id, A = etatUltra(id).analyse;
  if(!A) return;
  const mesCouts = {}, nb = {}; let total = 0, veh = 0, inf = 0;
  const compter = t => { const D = UNITES[t]; if(!D) return; mesCouts[t] = (mesCouts[t] || 0) + D.cout; nb[t] = (nb[t] || 0) + 1; total += D.cout; };
  for(const u of armee){
    compter(u.type);
    if(u.def.arme && u.def.forme !== 'infanterie') veh++;
    if(u.def.arme && u.def.forme === 'infanterie') inf++;
  }
  for(const b of bats) for(const t of b.file) compter(t);
  if(treveUltra()){ productionTreveUltra(C, F, bats, armee, gardeC); return; }
  const [repInf, repVeh] = (F.reparateurs || []).map(t => t && autorise('unites', t) ? t : null);
  const mesDCA = nb[F.antiair] || 0;
  const vm = vaisseauMere();
  const dcaManque = F.antiair && autorise('unites', F.antiair) && A.appareils > 0 && mesDCA < Math.min(4, Math.ceil(A.appareils/2));
  // Un seul ordre en file par bâtiment : l'argent reste disponible pour le meilleur choix suivant.
  const offres = [];
  for(const b of bats){
    if(b.enCours || b.file.length >= 1) continue;
    let liste;
    if(b.type === 'caserne' || b.type === 'usine') liste = (F.production[b.type] || []).filter(t => UNITES[t] && !UNITES[t].collecteur && !UNITES[t].ouvrier && !UNITES[t].avion);
    else if(b.def.aeroport && !helicosPlein(b) && armee.length >= 4 && aviationUltra(id)) liste = (F.helicos || []).slice();
    else continue;
    let best = null, bs = 0;
    for(const t of liste){
      if(!autorise('unites', t)) continue;
      let s;
      if(t === repVeh) s = veh >= 3 && (nb[t] || 0) < Math.min(2, 1 + Math.floor(veh/5)) ? 1e6 : 0;
      else if(t === repInf) s = inf >= 5 && (nb[t] || 0) < Math.min(2, 1 + Math.floor(inf/7)) ? 1e6 : 0;
      else if(t === F.antiair && !A.appareils && !vm) s = 0;
      else if(t === F.antiair && (dcaManque || (vm && mesDCA < 3))) s = 1e5;   // vaisseau-mère : trois DCA d'abord
      else s = noteProductionUltra(t, A.cibles, mesCouts, total);
      if(s > bs){ bs = s; best = t; }
    }
    if(best) offres.push({b, t:best, s:bs});
  }
  // Armée minimale avant les bâtiments et l'épargne : 600 plus la moitié de la plus forte armée adverse.
  // Sous la menace, on achète tout ce qui peut sortir, du plus rapide à produire au plus lent.
  const S = etatUltra(id);
  let monArmee = 0; for(const u of armee) monArmee += valeurCombat(u);
  let plusForte = 0; for(const K of Object.values(A.ennemis)) if(K.camp !== 'X') plusForte = Math.max(plusForte, K.valeur);
  // (Sans usine, l'urgence ne vaut que sous la menace : sinon l'infanterie prenait tout et l'usine ne
  // venait jamais, essai du 13 novembre 2026.)
  const sansUsine = !bats.some(b => b.type === 'usine');
  // (Mode Surprises : les dards rôdent sans cesse près de la base ; sans cette limite, l'ordinateur ne
  // bâtissait jamais l'usine, donc jamais de DCA contre le vaisseau.)
  const urgence = (S.menace > 0 && !(sansUsine && (monArmee >= 700 || vm))) || monArmee < 300 || (!sansUsine && monArmee < 600 + plusForte*0.5);
  S.monArmee = monArmee;
  // Ordre des offres : DCA réclamée, puis la meilleure note ; sous la menace, les réparateurs passent en
  // dernier. La première offre qui n'est pas payable est ATTENDUE (épargne), on n'achète pas à sa place la
  // moins chère. (Essai indépendant du 13 novembre 2026 : sous la menace, toute offre trop chère était
  // sautée, l'argent partait en sapeurs, dépôts et collecteurs, et l'usine ne produisait jamais.)
  // (Hélicoptères : au rang des besoins quand l'aviation est permise, sinon l'offre de l'aéroport venait
  // toujours après celles des usines et n'était jamais payée ; contre-essai du 13 novembre 2026.)
  const rang = o => o.s >= 1e6 ? (S.menace > 0 ? 2 : 0) : o.s >= 1e5 || o.b.def.aeroport ? 0 : 1;
  offres.sort((a, c) => rang(a) - rang(c) || c.s - a.s);
  // Réserve du prochain bâtiment : toujours pour la première caserne, la première usine et le dépôt avancé ;
  // pour les autres (aéroport, seconde usine, défenses...), seulement quand notre armée domine nettement la
  // plus forte armée adverse. Même règle pour l'épargne d'un avion. (Essai du 13 novembre 2026 : réserve
  // toujours gardée, l'ordinateur ne produisait plus rien pendant trois minutes.)
  const besoin = etatIA(id).besoin;
  // (Contre-essai du 13 novembre 2026 : aviation permise pendant dix minutes, mais jamais d'aéroport, son
  // prix n'étant pas mis de côté ; le premier aéroport compte désormais parmi les bâtiments du cœur.)
  const coeur = besoin && (((besoin === 'caserne' || besoin === 'usine') && !bats.some(b => b.type === besoin)) || (besoin === 'depot' && S.champLointain)
    || (besoin === 'aeroport' && !bats.some(b => b.def.aeroport) && aviationUltra(id)));
  const domine = monArmee >= plusForte*1.2 + 800;
  S.domine = domine;
  const resBat = besoin && !coeur && !domine ? Math.max(0, reserveMin - BATIMENTS[besoin].cout) : reserveMin;
  // Hors urgence, priorité stricte : la meilleure offre attend ses crédits plutôt que de céder la place.
  // Même en urgence, le rachat d'un collecteur manquant (gardeC) reste prioritaire. (Avant le 13 novembre
  // 2026 : seuil 0 en urgence, les collecteurs perdus n'étaient jamais rachetés quand l'armée était en
  // retard, et le revenu s'effondrait, essai à graine fixe sur Port-Calmes.)
  // Première usine : son prix est mis de côté même en urgence, sauf attaque au sol contre une armée de
  // moins de 300. (Mode Surprises, vaisseau à 30 s : l'infanterie prenait chaque crédit, aucune usine ni DCA
  // en 12 minutes, et l'ordinateur était éliminé ; essai du 13 novembre 2026.)
  const usineAttendue = besoin === 'usine' && sansUsine && bats.some(b => b.type === 'caserne' && !b.enCours)
    && !(S.menace > 0 && !vm && monArmee < 300);
  const seuil = usineAttendue ? Math.max(reserveMin, BATIMENTS.usine.cout) : urgence ? gardeC : resBat + (armee.length >= 8 && domine ? epargne : 0);
  for(const o of offres){
    if(C.reserves - UNITES[o.t].cout < (o.s >= 1e5 && o.s < 1e6 ? Math.min(gardeC, seuil) : seuil)){ if(S.menace > 0 && rang(o) === 2) continue; break; }
    if(commander(o.b, o.t)){ compter(o.t); journalUltra(id, 'produit ' + o.t + ' (' + o.b.type + ', note ' + (o.s >= 1e5 ? 'besoin' : o.s.toFixed(3)) + ')'); }
  }
  journalReposUltra(id, S, bats, offres, seuil, C.reserves);
}
// Journal (contre-essai du 13 novembre 2026) : une ligne, au plus toutes les 5 s, quand une usine reste au
// repos sous la menace, avec les réserves, l'offre attendue et le seuil : distingue le manque d'argent
// (réserves < coût + seuil) d'un défaut de décision (aucune offre, ou offre payable non achetée).
function journalReposUltra(id, S, bats, offres, seuil, reserves){
  if(typeof window === 'undefined' || !window.JOURNAL_ULTRA || !(S.menace > 0) || temps - (S.reposT || -99) < 5) return;
  const u = bats.find(b => b.type === 'usine' && !b.enCours && !b.file.length);
  if(!u) return;
  S.reposT = temps;
  const o = offres.find(x => x.b === u), cout = o ? UNITES[o.t].cout : 0;
  journalUltra(id, 'usine au repos sous la menace : réserves ' + Math.round(reserves) + (o ? ', offre ' + o.t + ' (' + cout + '), seuil ' + Math.round(seuil) +
    (reserves - cout < seuil ? ' : manque d’argent' : ' : payable, non achetée') : ', aucune offre : défaut de décision'));
}
// Production pendant la trêve : tout pour l'antiaérien déjà accessible. Sans usine, quatre fantassins qui
// tirent en l'air d'abord (contre les dards), puis l'argent va à l'usine ; avec l'usine, la DCA (jusqu'à
// huit) puis des fantassins antiaériens, en gardant le prix d'un bunker ou d'une batterie quand on en a
// déjà six. Rien qui ne puisse tirer en l'air.
function productionTreveUltra(C, F, bats, armee, gardeC){
  const id = C.id, S = etatUltra(id), besoin = etatIA(id).besoin;
  let monArmee = 0; for(const u of armee) monArmee += valeurCombat(u);
  S.monArmee = monArmee; S.domine = false;
  const enFile = t => bats.reduce((n, b) => n + b.file.filter(x => x === t).length, 0);
  const antiAir = armee.filter(u => u.def.arme && u.def.air && !u.def.avion).length
    + bats.reduce((n, b) => n + b.file.filter(t => UNITES[t] && UNITES[t].air).length, 0);
  S.antiAirTreve = antiAir;
  const dard = UNITES.dard, sansUsine = !bats.some(b => b.type === 'usine' && !b.enCours);
  const dca = F.antiair && autorise('unites', F.antiair) ? F.antiair : null;
  const nDCA = armee.filter(u => u.type === dca).length + (dca ? enFile(dca) : 0);
  const offres = [];
  for(const b of bats){
    if(b.enCours || b.file.length >= 1) continue;
    if(b.type === 'usine' && dca && nDCA < 8){ offres.push({b, t:dca, rang:0}); continue; }
    if(b.type !== 'caserne' && b.type !== 'usine') continue;
    let best = null, bs = 0;
    for(const t of F.production[b.type] || []){
      const D = UNITES[t];
      if(!D || !D.air || D.collecteur || D.ouvrier || D.avion || !autorise('unites', t)) continue;
      const s = dpsContre(D, dard) / D.cout;
      if(s > bs){ bs = s; best = t; }
    }
    if(best) offres.push({b, t:best, rang:1});
  }
  offres.sort((a, c) => a.rang - c.rang);
  for(const o of offres){
    let seuil = gardeC;
    if(o.rang === 1){
      if(sansUsine && antiAir >= 3) seuil = Math.max(seuil, BATIMENTS.usine.cout);   // l'usine d'abord
      // Puis la DCA : la caserne attend son prix (premier essai : les fantassins, abattus aussitôt, prenaient
      // chaque crédit et aucune Sentinelle ne sortait).
      else if(!sansUsine && dca && nDCA < 8 && antiAir >= 1) seuil = Math.max(seuil, UNITES[dca].cout);
      else if(besoin && antiAir >= 6) seuil = Math.max(seuil, BATIMENTS[besoin].cout);
      if(antiAir >= 14) continue;
    }
    if(C.reserves - UNITES[o.t].cout < seuil) continue;
    if(commander(o.b, o.t)) journalUltra(id, 'trêve : produit ' + o.t + ' (' + antiAir + ' unités antiaériennes)');
  }
  journalReposUltra(id, S, bats, offres, gardeC, C.reserves);
}
// ---------- Réflexion principale ----------
function majUltra(id, ia, ctx){
  const S = etatUltra(id), A = S.analyse, {C, bats, armee, avions} = ctx;
  // Aviation : un avion abîmé (moins de la moitié de ses PV) rentre ; le reste suit majIAAviation
  // (interceptions, frappes là où l'antiaérien adverse est faible).
  for(const u of avions) if(u.phase === 'vol' && u.pv < u.pvMax*0.5 && (!u.ordre || u.ordre.type !== 'rentrer')){ u.ordre = {type:'rentrer'}; u.cible = null; u.attente = null; }
  const menacesSol = [];
  for(const K of Object.values(A.ennemis)) for(const e of K.armee)
    if(!(e.def.avion && enVol(e)) && bats.some(b => dist(b, e) < 550)) menacesSol.push(e);
  majIAAviation(id, bats, avions, menacesSol);
  // Les rôles d'une réflexion à l'autre : repli (blessés), harcèlement, diversion ; le reste est libre.
  const combattants = armee.filter(u => u.def.arme), reparateurs = armee.filter(u => u.def.repare);
  // Mode Surprises, trêve : tout ce qui touche le vaisseau l'attaque ; le reste garde les bases.
  const vm = alliance ? vaisseauMere() : null;
  let libres = combattants;
  if(vm){
    const contre = [];
    // (Contre-essai du 13 novembre 2026.) Seules les armes qui entament vraiment le vaisseau (efficacité
    // d'au moins 0,4 : DCA, missiles air-air) vont à sa rencontre ; les armes légères (0,3) ne tirent sur lui
    // que s'il est au-dessus de notre base, et gardent sinon la base contre les dards. Ce qui ne peut pas
    // le toucher ne lui est jamais envoyé, et s'écarte de lui (rayon et défense rapprochée).
    // Les armes légères ne s'y mettent qu'en nombre (six au moins) et quand il vise notre base.
    const legeres = combattants.filter(u => peutCibler(u, vm) && efficacite(u.def.arme, vm) > 0 && efficacite(u.def.arme, vm) < 0.4).length;
    const surNous = vm.campVise === id && bats.some(b => dist(b, vm) < 700) && legeres >= 6;
    for(const u of combattants){
      if(!peutCibler(u, vm) || efficacite(u.def.arme, vm) <= 0){ if(!u.def.air) eloignerDuVaisseauUltra(u, vm); continue; }
      if(efficacite(u.def.arme, vm) < 0.4 && !(surNous && dist(u, vm) < 650)){
        if(u.ordre && u.ordre.type === 'attaquer' && u.ordre.cible === vm){ u.ordre = null; u.cible = null; }
        eloignerDuVaisseauUltra(u, vm);
        continue;
      }
      contre.push(u);
      if(u.ordre && u.ordre.type === 'aller') continue;   // esquive en cours
      if(!(u.ordre && u.ordre.type === 'attaquer' && u.ordre.cible === vm)){ u.ordre = {type:'attaquer', cible:vm}; u.chemin = null; }
    }
    for(const u of avions){
      const D = u.def;
      if(D.armeAir && u.phase === 'sol' && !u.ordre && u.munitions >= D.munitions && u.pv >= u.pvMax*0.66 && peutCibler(u, vm)) u.ordre = {type:'attaquer', cible:vm};
    }
    libres = combattants.filter(u => !contre.includes(u));
    S.phase = 'regroupe';
    if(!S.treve){
      S.treve = true; journalUltra(id, 'trêve : ' + contre.length + ' unités antiaériennes sur le vaisseau, le reste garde la base');
      // Marques de harcèlement et de diversion effacées : ces unités reviennent garder la base.
      S.harcelement = null; S.harceleT = temps + ULTRA.HARCELEMENT_REPOS;
      for(const u of combattants) if(u.ultra === 'harcelement' || u.ultra === 'diversion' || u.ultra === 'assaut'){ u.ultra = null; if(!contre.includes(u)){ u.ordre = null; u.cible = null; } }
    }
  }
  if(vm){
    // Collecteurs et ouvriers : esquive du rayon ; les champs à moins de 650 px du vaisseau sont évités.
    esquiverZonesUltra(ctx.uns.filter(u => u.def.collecteur || u.def.ouvrier), A.zones);
    for(const n of noeuds) if(n.reste > 0 && dist(n, vm) < 650) S.champsMenaces.set(n, temps + 6);
    // (Premier essai : les collecteurs écartés à 700 px du vaisseau ne pouvaient plus décharger quand il
    // planait sur le QG, et le revenu tombait à zéro ; seuls l'esquive du rayon et le choix des champs restent.)
  }
  esquiverZonesUltra(armee, A.zones);
  libres = replierBlessesUltra(id, S, libres, reparateurs, ctx);
  libres = defendreUltra(id, S, A, ctx, libres);
  libres = gardesChampUltra(id, S, ctx, libres, !!vm);
  if(!vm){
    libres = harcelerUltra(id, S, A, ctx, libres);
    attaquerUltra(id, S, A, ctx, libres);
  } else for(const u of libres) if(!u.ordre && !u.cible && dist(u, ctx.rassemblement) > 220)
    u.ordre = {type:'aller', x:ctx.rassemblement.x + (Math.random()-.5)*160, y:ctx.rassemblement.y + (Math.random()-.5)*160};
  combattreUltra(id, S, A, combattants);
  soutenirUltra(id, S, reparateurs, ctx);
  pouvoirsUltra(C, S, A, ctx);
}
// Trêve : une unité qui ne peut pas toucher le vaisseau, à moins de 600 px de lui, s'en écarte (700 px,
// à l'opposé) ; un collecteur est marqué en détour (defendreUltra lève le détour après 12 s).
function eloignerDuVaisseauUltra(u, vm){
  if(u.mort || enVol(u)) return;
  const dx = u.x - vm.x, dy = u.y - vm.y, d = Math.hypot(dx, dy);
  if(d > 600 || (u.ordre && u.ordre.type === 'aller' && Math.hypot(u.ordre.x - vm.x, u.ordre.y - vm.y) > 600)) return;
  const k = 700/(d || 1), p = pointLibre(vm.x + (d ? dx : 1)*k, vm.y + dy*k);
  u.ordre = {type:'aller', x:p.x, y:p.y}; u.cible = null; u.chemin = null;
  if(u.def.collecteur) u.ultraDetour = temps;
}
// Esquive des zones annoncées (pouvoirs adverses, rayon du vaisseau) : sortir du cercle par le plus court.
function esquiverZonesUltra(unites, zones){
  if(!zones.length) return;
  for(const u of unites){
    if(u.mort || enVol(u)) continue;
    for(const z of zones){
      const dx = u.x - z.x, dy = u.y - z.y, d = Math.hypot(dx, dy);
      if(d > z.r + 10) continue;   // z.r : portée réelle des impacts (analyserUltra)
      const k = (z.r + 40)/(d || 1), p = pointLibre(z.x + (d ? dx : 1)*k, z.y + dy*k);
      u.ordre = {type:'aller', x:p.x, y:p.y}; u.cible = null; u.chemin = null; u.ultraEsquive = temps;
      break;
    }
  }
}
// Repli des unités très endommagées vers un réparateur adapté (ou vers l'aura de soin de Karsk).
function replierBlessesUltra(id, S, combattants, reparateurs, ctx){
  const karsk = ctx.C.faction === 'karsk';
  const reste = [];
  for(const u of combattants){
    if(u.ultraRepli){
      if(u.pv >= u.pvMax*ULTRA.REPRISE_PV || temps - u.ultraRepli > ULTRA.REPLI_MAX){ u.ultraRepli = 0; u.ordre = null; }
      else continue;
    }
    if(u.pv < u.pvMax*ULTRA.REPLI_PV && u.def.forme !== 'antiair'){
      const genre = u.def.forme === 'infanterie' ? 'infanterie' : 'vehicules';
      const rep = plusProche(u, reparateurs.filter(r => r.def.soigne === genre));
      const abri = rep || (karsk ? depotProche(u) : null);
      if(abri && dist(u, abri) > 120){
        u.ultraRepli = temps; u.cible = null; u.chemin = null;
        const p = pointLibre(abri.x + (Math.random()-.5)*60, abri.y + (Math.random()-.5)*60);
        u.ordre = {type:'aller', x:p.x, y:p.y};
        journalUltra(id, 'repli de ' + u.type + ' (' + Math.round(u.pv) + ' PV) vers ' + (rep ? rep.type : 'le dépôt'));
        continue;
      }
    }
    reste.push(u);
  }
  return reste;
}
function plusProche(u, liste){ let best = null, bd = Infinity; for(const e of liste){ const d = dist(u, e); if(d < bd){ bd = d; best = e; } } return best; }
// Défense : chaque menace (intrus voisins regroupés) reçoit DEFENSE_PROPORTION fois sa valeur en défenseurs,
// les plus proches d'abord. Une petite menace (feinte) ne vide pas la base ni ne rappelle l'assaut ; une
// menace qui dépasse la moitié de notre armée fait rentrer tout le monde. Les menaces sur les bases alliées
// sont servies ensuite, avec ce qui reste. Renvoie les unités non engagées.
function defendreUltra(id, S, A, ctx, libres){
  const proteges = ctx.bats, collecteurs = ctx.uns.filter(u => u.def.collecteur);
  const intrus = [];
  for(const K of Object.values(A.ennemis)) for(const e of K.armee.concat(K.eco)){
    if(e.def.avion && enVol(e)) continue;
    if(e.def.forme === 'vaisseauMere' && alliance) continue;   // trêve : le vaisseau a son propre traitement (majUltra)
    if(!e.def.arme && !proteges.some(b => dist(b, e) < 250)) continue;
    let pres = proteges.some(b => dist(b, e) < ULTRA.RAYON_BASE);
    if(!pres && e.def.arme) pres = collecteurs.some(c => dist(c, e) < ULTRA.RAYON_COLLECTEUR);
    if(pres) intrus.push(e);
  }
  // Menaces sur les bases alliées (après les nôtres).
  const intrusAllies = [];
  if(!intrus.length){
    const batsAllies = ents.filter(b => b.est === 'batiment' && !b.mort && b.camp !== id && allies(id, b.camp));
    if(batsAllies.length) for(const K of Object.values(A.ennemis)) for(const e of K.armee)
      if(!(e.def.avion && enVol(e)) && batsAllies.some(b => dist(b, e) < 550)) intrusAllies.push(e);
  }
  // Collecteurs menacés : retour au dépôt, et le champ est évité un moment.
  for(const c of collecteurs){
    const m = intrus.find(e => e.def.arme && dist(c, e) < 320);
    if(!m){
      // Fin du détour : plus de menace proche, ou 12 s passées (le point visé pouvait être inaccessible).
      if(c.ultraDetour && c.ordre && c.ordre.type === 'aller' && temps - c.ultraDetour > 12){ c.ordre = null; c.chemin = null; c.ultraDetour = 0; }
      continue;
    }
    const n = noeudProche(c); if(n && dist(c, n) < 200){ S.champsMenaces.set(n, temps + ULTRA.CHAMP_MENACE); S.champHarcele = {n, t:temps}; }
    const d = depotProche(c);
    if(d && dist(c, d) > 150 && !(c.ordre && c.ordre.type === 'aller')){
      // Point libre au bord du dépôt, côté collecteur. (Avant le 13 novembre 2026 : d.x + 40, d.y + 40, à
      // l'intérieur du QG ; le collecteur n'y arrivait jamais et restait immobile : revenu nul pendant des
      // minutes, essai à graine fixe sur Port-Calmes.)
      const dx = c.x - d.x, dy = c.y - d.y, dd = Math.hypot(dx, dy) || 1, k = (d.rayon || 60) + 50;
      const p = pointLibre(d.x + dx/dd*k, d.y + dy/dd*k);
      c.ordre = {type:'aller', x:p.x, y:p.y}; c.chemin = null; c.ultraDetour = temps;
      journalUltra(id, 'collecteur détourné (menace ' + m.type + ')');
    }
  }
  const tous = intrus.length ? intrus : intrusAllies;
  if(!tous.length){ S.menace = 0; return libres; }
  const groupes = [], vu = new Set();
  for(const m of tous){
    if(vu.has(m)) continue;
    const membres = [m]; vu.add(m);
    for(let k = 0; k < membres.length; k++) for(const n of tous) if(!vu.has(n) && dist(membres[k], n) < ULTRA.GROUPE_MENACE){ vu.add(n); membres.push(n); }
    let force = 0; for(const e of membres) force += Math.max(80, valeurCombat(e));
    groupes.push({membres, force, tete:barycentre(membres)});
  }
  groupes.sort((a, c) => c.force - a.force);
  let total = 0; for(const u of libres) total += valeurCombat(u);
  const menaceTotale = groupes.reduce((s, g) => s + g.force, 0);
  S.menace = intrus.length ? menaceTotale : 0;
  // Axe de la menace (pour les défenses fixes) : moyenne glissante de la direction des intrus.
  if(intrus.length && ctx.centre){
    const g = groupes[0], dx = g.tete.x - ctx.centre.x, dy = g.tete.y - ctx.centre.y, d = Math.hypot(dx, dy) || 1;
    S.axe.x = S.axe.x*0.9 + dx/d; S.axe.y = S.axe.y*0.9 + dy/d;
  }
  // Grosse menace sur notre base : l'assaut est abandonné (on ne perd pas la base pour une attaque).
  if(intrus.length && menaceTotale > total*0.5 && S.phase !== 'regroupe'){
    journalUltra(id, 'assaut abandonné : base menacée (' + Math.round(menaceTotale) + ' contre ' + Math.round(total) + ')');
    S.phase = 'regroupe';
    for(const u of libres) if(u.ultra === 'assaut') u.ultra = null;
  }
  const pris = new Set();
  for(const g of groupes){
    const besoin = ULTRA.DEFENSE_PROPORTION * g.force * (intrus.length ? 1 : 0.8);
    // Candidats : hors assaut d'abord ; en assaut seulement si la menace vise notre base et qu'il en manque.
    // (13 novembre 2026) Seules les unités capables de toucher un membre du groupe sont envoyées : le
    // vaisseau-mère n'est pas un intrus pour qui ne tire pas en l'air. Contre un raid sur les collecteurs
    // loin de la base, pas de poursuite depuis plus de 1 100 px (les gardes de champ s'en chargent).
    const surBase = g.membres.some(e => proteges.some(b => dist(b, e) < ULTRA.RAYON_BASE));
    const cand = libres.filter(u => !pris.has(u) && u.ultra !== 'harcelement' && u.ultra !== 'diversion'
        && (u.ultra !== 'garde' || dist(u, g.tete) < 700) && g.membres.some(m => peutCibler(u, m) && efficacite(u.def.arme, m) > 0))
      .map(u => ({u, d:dist(u, g.tete) + (u.ultra === 'assaut' ? 1500 : 0)})).sort((a, c) => a.d - c.d);
    let engage = 0;
    for(const {u, d} of cand){
      if(engage >= besoin) break;
      if(u.ultra === 'assaut' && (!intrus.length || d - 1500 > 1400)) continue;
      if(!intrus.length && d > 2000) continue;
      if(intrus.length && !surBase && d > 1100) continue;
      pris.add(u); engage += valeurCombat(u);
      if(u.ultra === 'assaut') u.ultra = null;
      if(!u.cible || !g.membres.includes(u.cible))
        if(!u.ordre || u.ordre.type !== 'attaqueDeplacement' || Math.hypot(u.ordre.x - g.tete.x, u.ordre.y - g.tete.y) > 120){
          u.ordre = {type:'attaqueDeplacement', x:g.tete.x, y:g.tete.y}; u.chemin = null;
        }
    }
    if(engage && temps - (S.journalDefenseT || -99) > 5) S.journalDefenseT = temps, journalUltra(id, 'défense : ' + Math.round(engage) + ' engagés contre une menace de ' + Math.round(g.force) + (intrus.length ? '' : ' (base alliée)'));
  }
  return libres.filter(u => !pris.has(u));
}
// Gardes de champ (13 novembre 2026) : après un raid sur nos collecteurs, une ou deux unités rapides ou à
// longue portée restent postées entre le champ harcelé et le dépôt le plus proche, au lieu que l'armée
// poursuive en vain des unités plus rapides qu'elle. Levées après GARDE_MEMOIRE s sans nouveau raid.
function gardesChampUltra(id, S, ctx, libres, treve){
  const H = S.champHarcele;
  const actif = !treve && H && H.n.reste > 0 && temps - H.t < ULTRA.GARDE_MEMOIRE && libres.length >= 6;
  if(!actif){ for(const u of libres) if(u.ultra === 'garde') u.ultra = null; return libres; }
  const gardes = libres.filter(u => u.ultra === 'garde');
  if(gardes.length < ULTRA.GARDES_CHAMP){
    const cand = libres.filter(u => !u.ultra && u.def.sol && u.def.forme !== 'antiair' && !u.def.repare && (u.def.vitesse >= 115 || u.def.portee >= 300))
      .sort((a, c) => dist(a, H.n) - dist(c, H.n));
    for(const u of cand.slice(0, ULTRA.GARDES_CHAMP - gardes.length)){ u.ultra = 'garde'; gardes.push(u); journalUltra(id, 'garde de champ : ' + u.type); }
  }
  const d = depotProche({x:H.n.x, y:H.n.y, camp:id}) || ctx.centre;
  const p = d ? {x:H.n.x + (d.x - H.n.x)*0.3, y:H.n.y + (d.y - H.n.y)*0.3} : H.n;
  for(const u of gardes) if(!u.cible && dist(u, p) > 160 && (!u.ordre || Math.hypot(u.ordre.x - p.x, u.ordre.y - p.y) > 120)){
    const q = pointLibre(p.x + (Math.random()-.5)*100, p.y + (Math.random()-.5)*100);
    u.ordre = {type:'attaqueDeplacement', x:q.x, y:q.y}; u.chemin = null;
  }
  return libres.filter(u => u.ultra !== 'garde');
}
// Harcèlement : 2 à 3 unités rapides contre la cible la moins défendue (collecteurs d'abord), par un
// détour si la ligne droite passe près des défenses ; repli dès qu'une force supérieure approche.
function harcelerUltra(id, S, A, ctx, libres){
  const H = S.harcelement;
  if(H){
    const membres = libres.filter(u => H.ids.has(u.id));
    if(!membres.length || temps - H.t0 > 100){ S.harcelement = null; S.harceleT = temps + ULTRA.HARCELEMENT_REPOS; for(const u of membres) u.ultra = null; }
    else {
      const c = barycentre(membres);
      let mien = 0; for(const u of membres) mien += valeurCombat(u);
      if(forceEnnemie(A, c.x, c.y, 450) > mien*0.9){
        journalUltra(id, 'harcèlement : repli devant une force supérieure');
        for(const u of membres){ u.ultra = null; u.cible = null; u.ordre = {type:'aller', x:ctx.rassemblement.x, y:ctx.rassemblement.y}; u.chemin = null; }
        S.harcelement = null; S.harceleT = temps + ULTRA.HARCELEMENT_REPOS;
      } else {
        if(!H.cible || H.cible.mort){ H.cible = cibleHarcelement(id, A, c, mien); H.wp = null; if(!H.cible){ for(const u of membres) u.ultra = null; S.harcelement = null; S.harceleT = temps + 10; return libres; } }
        if(H.wp && Math.hypot(c.x - H.wp.x, c.y - H.wp.y) < 150) H.wp = null;
        for(const u of membres){
          if(u.cible && !u.cible.mort) continue;
          const p = H.wp || H.cible;
          if(!u.ordre || Math.hypot(u.ordre.x - p.x, u.ordre.y - p.y) > 60) { u.ordre = {type:H.wp ? 'aller' : 'attaqueDeplacement', x:p.x, y:p.y}; u.chemin = null; }
        }
      }
    }
    return libres.filter(u => u.ultra !== 'harcelement');
  }
  for(const u of libres) if(u.ultra === 'harcelement') u.ultra = null;   // reste d'un groupe dissous
  if(temps < S.harceleT || libres.length < 6 || temps < 100) return libres;
  const rapides = libres.filter(u => u.def.vitesse >= 115 && u.def.sol && u.def.forme !== 'antiair' && u.pv > u.pvMax*0.7 && u.ultra !== 'assaut');
  if(rapides.length < 2) return libres;
  const membres = rapides.sort((a, c) => c.def.vitesse - a.def.vitesse).slice(0, ULTRA.HARCELEURS);
  const c = barycentre(membres); let mien = 0; for(const u of membres) mien += valeurCombat(u);
  const cible = cibleHarcelement(id, A, c, mien);
  if(!cible) { S.harceleT = temps + 8; return libres; }
  // Détour : si le milieu du trajet est défendu, un point décalé de 500 px sur le côté le moins défendu.
  const mx = (c.x + cible.x)/2, my = (c.y + cible.y)/2, dx = cible.x - c.x, dy = cible.y - c.y, d = Math.hypot(dx, dy) || 1;
  let wp = null;
  if(forceEnnemie(A, mx, my, 450) > mien*0.4){
    const cotes = [1, -1].map(s => pointLibre(mx - dy/d*500*s, my + dx/d*500*s)).map(p => ({p, f:forceEnnemie(A, p.x, p.y, 450)})).sort((a, b) => a.f - b.f);
    wp = cotes[0].p;
  }
  S.harcelement = {ids:new Set(membres.map(u => u.id)), cible, wp, t0:temps};
  for(const u of membres){ u.ultra = 'harcelement'; u.ordre = null; }
  journalUltra(id, 'harcèlement : ' + membres.map(u => u.type).join(', ') + ' vers ' + cible.type + ' de ' + cible.camp + (wp ? ' par un détour' : ''));
  return libres.filter(u => u.ultra !== 'harcelement');
}
function cibleHarcelement(id, A, depuis, mien){
  let best = null, bs = 0;
  for(const K of Object.values(A.ennemis)){
    if(K.camp === 'X') continue;
    for(const e of K.eco.concat(K.bats)){
      if(e.est === 'batiment' && e.def.arme) continue;
      const danger = forceEnnemie(A, e.x, e.y, 450);
      if(danger > mien*0.5) continue;
      const v = e.def.collecteur ? 900 : e.def.ouvrier ? 300 : e.def.aeroport || e.type === 'depot' || e.type === 'relais' ? 500 : 250;
      const s = v / (400 + dist(depuis, e));
      if(s > bs){ bs = s; best = e; }
    }
  }
  return best;
}
// Attaque : regroupement, objectif le plus faible (défense locale, distance, pression des alliés), assaut
// quand la marge est suffisante (ou que l'armée adverse est loin), diversion quelques secondes avant,
// marche groupée, retraite si le rapport de forces s'effondre.
// minBesoin : la défense compte double (effectif plein : l'objectif le moins défendu, même loin).
function choisirObjectifUltra(id, S, A, depuis, minBesoin){
  let best = null, bs = Infinity;
  for(const K of Object.values(A.ennemis)){
    if(K.camp === 'X' || !enVie(K.camp) || !K.bats.length) continue;
    // Pression alliée : un ordinateur allié attaque déjà ce camp.
    let pression = 0;
    for(const o of campsEnJeu()) if(o !== id && allies(id, o) && etatsIA[o] && etatsIA[o].ultra && etatsIA[o].ultra.phase === 'assaut' && etatsIA[o].ultra.campCible === K.camp) pression++;
    const subi = camps[id].subi && camps[id].subi[K.camp];
    const riposte = subi && temps - subi.t < 90 ? 400 : 0;
    for(const b of K.bats){
      const defense = forceEnnemie(A, b.x, b.y, 550);
      // Armée adverse proche (moins de 1 200 px) : elle reviendra défendre. (Comptée pour moitié au premier
      // essai : l'assaut tombait sur l'armée revenue et battait en retraite.) Loin de sa base, elle ne compte pas.
      let retour = 0; for(const e of K.armee) if(dist(e, b) < 1200 && dist(e, b) >= 550) retour += valeurCombat(e);
      const cle = b.def.aeroport || b.type === 'usine' ? 300 : b.type === 'qg' ? 150 : 0;
      // Objectif repoussé récemment : il exige au moins la force ennemie qui nous a fait reculer.
      let besoin = defense + retour;
      if(S.echec && temps - S.echec.t < ULTRA.ECHEC_MEMOIRE && dist(b, S.echec) < 900) besoin = Math.max(besoin, S.echec.ennemi);
      const s = (minBesoin ? besoin*2 : besoin) + dist(depuis, b)*0.35 - cle - pression*600 - riposte;
      if(s < bs){ bs = s; best = {b, camp:K.camp, besoin, pression}; }
    }
  }
  return best;
}
function attaquerUltra(id, S, A, ctx, libres){
  const R = ctx.rassemblement;
  // Diversion terminée (ordre accompli) : l'unité rejoint l'assaut, ou la réserve.
  for(const u of libres) if(u.ultra === 'diversion' && !u.ordre && !u.cible) u.ultra = S.phase === 'assaut' ? 'assaut' : null;
  if(S.phase === 'regroupe') for(const u of libres) if(u.ultra === 'assaut') u.ultra = null;
  let total = 0; for(const u of libres) total += valeurCombat(u);
  const enAssaut = libres.filter(u => u.ultra === 'assaut'), reserve = libres.filter(u => u.ultra !== 'assaut' && u.ultra !== 'diversion');
  const auRassemblement = () => { for(const u of reserve) if(!u.ordre && !u.cible && dist(u, R) > 220) u.ordre = {type:'aller', x:R.x + (Math.random()-.5)*160, y:R.y + (Math.random()-.5)*200}; };
  if(S.phase === 'regroupe'){
    auRassemblement();
    if(temps < debutAssautsUltra(id)) return;
    // Après une retraite : délai de regroupement et de réparation, puis la plupart des unités au
    // rassemblement (au plus 40 s d'attente pour les retardataires). (Essai indépendant du 13 novembre
    // 2026 : un nouvel assaut repartait deux secondes après la fin de la retraite, unités encore en route.)
    if(temps < (S.regroupeJusqua || 0)) return;
    if(temps - (S.regroupeDepuis || 0) < 40){
      let loin = 0; for(const u of libres) if(dist(u, R) > 500) loin++;
      if(loin > libres.length*0.3) return;
    }
    const plein = population[id] >= popMax - 2;
    const obj = choisirObjectifUltra(id, S, A, R, plein);
    if(!obj) return;
    // Seuil du premier assaut : contre une armée adverse faible, dès que la nôtre vaut deux fois la plus
    // forte armée adverse ; à effectif plein, on choisit l'objectif le moins défendu au lieu d'attendre.
    const minimum = plein ? 800 : Math.max(600, Math.min(ULTRA.ASSAUT_MIN, 2*A.plusForte));
    const marge = obj.pression ? 1.1 : plein ? 0.8 : ULTRA.ASSAUT_MARGE;
    if(total < Math.max(minimum, marge*obj.besoin)) return;
    // Garnison : les fantassins les moins chers restent, jusqu'à GARNISON de la valeur.
    const tri = libres.slice().sort((a, c) => (a.def.cout || 0) - (c.def.cout || 0));
    let garde = 0; const garnison = new Set();
    for(const u of tri){ if(garde >= total*ULTRA.GARNISON || u.def.forme !== 'infanterie') break; garnison.add(u); garde += valeurCombat(u); }
    const assaut = libres.filter(u => !garnison.has(u));
    // Diversion : deux unités rapides sur un autre bâtiment du même camp, loin de l'objectif.
    let diversion = null;
    if(assaut.length >= 8){
      const K = A.ennemis[obj.camp];
      const autre = K.bats.filter(b => dist(b, obj.b) > 700).sort((a, c) => forceEnnemie(A, a.x, a.y, 450) - forceEnnemie(A, c.x, c.y, 450))[0];
      if(autre){
        diversion = assaut.slice().sort((a, c) => c.def.vitesse - a.def.vitesse).slice(0, 2);
        for(const u of diversion){ u.ultra = 'diversion'; u.ordre = {type:'attaqueDeplacement', x:autre.x, y:autre.y}; u.chemin = null; }
      }
    }
    for(const u of assaut) if(!diversion || !diversion.includes(u)) u.ultra = 'assaut';
    S.cible = obj.b; S.campCible = obj.camp; S.valeurDepart = total - garde;
    S.phase = diversion ? 'diversion' : 'assaut'; S.assautT = temps + (diversion ? ULTRA.DIVERSION_AVANCE : 0);
    journalUltra(id, 'assaut décidé contre ' + obj.camp + ' (' + obj.b.type + ') : ' + Math.round(total - garde) + ' contre une défense de ' + Math.round(obj.besoin) +
      (diversion ? ', diversion de ' + diversion.length : '') + (obj.pression ? ', avec un allié' : ''));
    return;
  }
  if(S.phase === 'diversion'){
    auRassemblement();
    if(temps >= S.assautT){ S.phase = 'assaut'; journalUltra(id, 'assaut principal lancé'); }
    return;
  }
  if(S.phase === 'retraite'){
    for(const u of libres) if(u.ultra === 'assaut') u.ultra = null;
    // Fin de la retraite mesurée sur les seules unités qui étaient à l'assaut (pas sur la réserve restée au
    // rassemblement), puis délai de regroupement et de réparation (ULTRA.REGROUPE_MIN).
    const repliees = libres.filter(u => S.retraiteIds && S.retraiteIds.has(u.id));
    let loin = 0; for(const u of repliees) if(dist(u, R) > 450) loin++;
    if(loin <= repliees.length*0.2 || temps - S.retraiteT > 40){
      S.phase = 'regroupe'; S.regroupeJusqua = temps + ULTRA.REGROUPE_MIN; S.regroupeDepuis = temps; S.retraiteIds = null;
      journalUltra(id, 'retraite terminée : regroupement jusqu’à ' + enMinSec(S.regroupeJusqua));
    }
    else for(const u of repliees) if(!u.cible && dist(u, R) > 300 && (!u.ordre || u.ordre.type !== 'aller')) { u.ordre = {type:'aller', x:R.x + (Math.random()-.5)*160, y:R.y + (Math.random()-.5)*160}; u.chemin = null; }
    return;
  }
  // Assaut en cours.
  auRassemblement();
  if(!enAssaut.length){ S.phase = 'regroupe'; return; }
  if(!S.cible || S.cible.mort){
    const c0 = barycentre(enAssaut);
    S.cible = enVie(S.campCible) ? cibleVague(c0, id, S.campCible) : null;
    if(!S.cible){ const o = choisirObjectifUltra(id, S, A, c0); S.cible = o && o.b; S.campCible = o && o.camp; }
    if(!S.cible){ S.phase = 'regroupe'; return; }
    journalUltra(id, 'objectif suivant : ' + S.cible.type + ' de ' + S.cible.camp);
  }
  // Groupe principal : les unités à moins de 700 px du barycentre (les autres le rejoignent).
  const c = barycentre(enAssaut);
  let mien = 0, mienTotal = 0;
  for(const u of enAssaut){ const v = valeurCombat(u); mienTotal += v; if(dist(u, c) < 600) mien += v; }
  const ennemi = forceEnnemie(A, c.x, c.y, 650);
  if((mien > 0 && ennemi > ULTRA.RETRAITE*mien) || mienTotal < S.valeurDepart*0.3){
    journalUltra(id, 'retraite générale : ' + Math.round(mien) + ' contre ' + Math.round(ennemi));
    S.phase = 'retraite'; S.retraiteT = temps; S.retraiteIds = new Set(enAssaut.map(u => u.id));
    // Mémoire de l'échec : pas de nouvel assaut sur ce secteur sans rapport de forces rétabli.
    S.echec = {x:S.cible ? S.cible.x : c.x, y:S.cible ? S.cible.y : c.y, t:temps, ennemi:Math.max(ennemi, S.valeurDepart*0.8)};
    for(const u of enAssaut){ u.cible = null; u.ordre = {type:'aller', x:R.x + (Math.random()-.5)*160, y:R.y + (Math.random()-.5)*160}; u.chemin = null; }
    return;
  }
  const dx = S.cible.x - c.x, dy = S.cible.y - c.y, d = Math.hypot(dx, dy) || 1;
  const pas = Math.min(d, 320), wp = d < 520 ? {x:S.cible.x, y:S.cible.y} : {x:c.x + dx/d*pas, y:c.y + dy/d*pas};
  for(const u of enAssaut){
    if(u.cible && !u.cible.mort) continue;
    if(u.ultraEsquive && temps - u.ultraEsquive < 2) continue;
    if(u.ultraRecul && temps - u.ultraRecul < 1.5) continue;
    const p = dist(u, c) > 380 ? c : wp;
    if(!u.ordre || u.ordre.type !== 'attaqueDeplacement' || Math.hypot(u.ordre.x - p.x, u.ordre.y - p.y) > 80){
      u.ordre = {type:'attaqueDeplacement', x:p.x + (Math.random()-.5)*60, y:p.y + (Math.random()-.5)*60}; u.chemin = null;
    }
  }
}
// Pas d'assaut avant 80 % de la première vague de Difficile (120 s) : l'économie d'abord.
function debutAssautsUltra(id){ return (etatIA(id).premiereVague || 150) * 0.8; }
// Combat : chaque unité au contact choisit la cible qui rapporte le plus (valeur détruite par seconde, DCA
// quand on a des appareils, artillerie, réparateurs, unités presque détruites), sans s'acharner à plusieurs
// sur une cible déjà condamnée ; les unités à longue portée reculent devant un ennemi de portée plus courte.
function prioriteCibleUltra(e, mesAppareils){
  const D = e.def;
  let p = e.est === 'batiment' ? (D.arme ? 600 : 80) : Math.max(30, D.cout || 200);
  if(D.arme === 'aa' && e.est === 'unite' && mesAppareils) p *= 2.2;
  if(D.forme === 'artillerie') p *= 1.8;
  if(D.repare) p *= 1.8;
  if(D.collecteur) p *= 1.3;
  if(e.pv < e.pvMax*0.35) p *= 1.6;
  return p;
}
function combattreUltra(id, S, A, combattants){
  const assigne = new Map();   // cible -> dégâts par seconde déjà promis
  for(const u of combattants){
    const D = u.def;
    if(u.mort || D.avion || u.ultraRepli || (u.ordre && u.ordre.type === 'aller') || (u.ordre && u.ordre.type === 'attaquer' && u.ordre.cible && u.ordre.cible.def.forme === 'vaisseauMere')) continue;
    const portee = D.portee + 60;
    let best = null, bs = 0, actuel = 0, menace = null, dm = Infinity;
    voisinsUltra(A, u.x, u.y, Math.max(portee, 380), e => {
      const d = distBord(u, e);
      // Recul : ennemi au sol armé, de portée plus courte, qui nous a presque à portée.
      if(D.portee >= 300 && e.est === 'unite' && e.def.arme && e.def.sol && !e.def.aerien && e.def.portee < D.portee - 40 && d < e.def.portee + 70 && d < dm){ dm = d; menace = e; }
      if(d > portee || !peutCibler(u, e) || (D.porteeMin && d < D.porteeMin)) return;
      const k = efficacite(D.arme, e);
      if(k <= 0) return;
      const dps = D.degats * (D.salve || 1) / D.cadence * k;
      let s = prioriteCibleUltra(e, A.mesAppareils) * dps / Math.max(1, e.pv);
      if(d > D.portee) s *= 0.6;
      const deja = assigne.get(e) || 0;
      if(deja*2 > e.pv) s *= 0.3;   // déjà condamnée : inutile de s'y mettre à plusieurs
      if(e === u.cible) actuel = s;
      if(s > bs){ bs = s; best = e; }
    });
    if(menace && D.portee >= 300){
      const dx = u.x - menace.x, dy = u.y - menace.y, d = Math.hypot(dx, dy) || 1;
      const p = pointLibre(u.x + dx/d*150, u.y + dy/d*150);
      if(libre(p.x, p.y)){ u.ordre = {type:'aller', x:p.x, y:p.y}; u.cible = null; u.chemin = null; u.ultraRecul = temps; continue; }
    }
    if(best && best !== u.cible && bs > actuel*1.25) u.cible = best;
    const c = u.cible;
    if(c && !c.mort){ const k = efficacite(D.arme, c); assigne.set(c, (assigne.get(c) || 0) + D.degats * (D.salve || 1) / D.cadence * k); }
  }
}
// Réparateurs : ils suivent l'armée d'assaut, un peu en arrière, et soignent en chemin (majReparateur).
function soutenirUltra(id, S, reparateurs, ctx){
  if(!reparateurs.length) return;
  const assaut = ctx.armee.filter(u => u.ultra === 'assaut' && !u.mort);
  const c = S.phase === 'assaut' && assaut.length >= 3 ? barycentre(assaut) : null;
  for(const r of reparateurs){
    if(r.cibleSoin && !r.cibleSoin.mort) continue;
    const p = c ? {x:c.x + (ctx.rassemblement.x - c.x)*0.12, y:c.y + (ctx.rassemblement.y - c.y)*0.12} : ctx.rassemblement;
    if(dist(r, p) > 200 && (!r.ordre || Math.hypot(r.ordre.x - p.x, r.ordre.y - p.y) > 150)){ r.ordre = {type:'attaqueDeplacement', x:p.x, y:p.y}; r.chemin = null; }
  }
}
// Pouvoirs : sur le groupe adverse le plus précieux à portée du rayon du pouvoir (unités, défenses, bâtiments
// clés), y compris sur un combat au contact (les pouvoirs épargnent leur camp) ; la super-arme seulement
// pour une cible qui la vaut.
function pouvoirsUltra(C, S, A, ctx){
  const id = C.id;
  if(!pouvoirsActifs[id]) return;
  const Ps = POUVOIRS[C.faction] || [], sup = Ps.find(p => p.super);
  for(const P of Ps){
    if(C.points < P.cout || (C.recharges[P.cle] || 0) > 0) continue;
    // Points gardés pour la super-arme prête, sauf s'il y en a assez pour les deux.
    if(!P.super && sup && (C.recharges[sup.cle] || 0) <= 0 && C.points < sup.cout + P.cout) continue;
    if(!P.cible){
      if((S.menace > 0 || S.phase === 'assaut') && population[id] < popMax - 5){ activerPouvoir(id, P.cle); journalUltra(id, 'pouvoir ' + P.nom); }
      continue;
    }
    const seuil = P.super ? 1800 : 500;
    const z = meilleureZoneUltra(id, A, P.rayon, ctx, !!P.super, seuil);
    if(z){
      if(activerPouvoir(id, P.cle, z.x, z.y)) journalUltra(id, 'pouvoir ' + P.nom + ' sur une zone de valeur ' + Math.round(z.valeur) +
        [' (cible éloignée)', ' (groupe serré)', ' (combat au contact)'][z.prio] + (z.cle ? ' (bâtiment clé)' : ''));
    }
  }
}
// lourd : super-arme (les bâtiments comptent) ; sinon petit pouvoir (300 dégâts) : seulement ce qu'il peut
// détruire ou presque (bâtiments à moins de 400 PV, unités pondérées par la part de PV qu'il leur ôte).
function meilleureZoneUltra(id, A, rayon, ctx, lourd, seuil){
  seuil = seuil || 0;
  const valeurZone = e => e.est === 'batiment'
    ? (lourd || e.pv < 400 ? (e.def.cout || 600)*0.6 + (e.def.aeroport || e.type === 'usine' || e.type === 'qg' ? 600 : e.def.arme ? 400 : 0) : 0)
    : Math.max(30, e.def.cout || 0) * (e.def.avion && enVol(e) ? 0 : lourd ? 1 : Math.min(1, 300/Math.max(1, e.pv)));
  // Pas de pénalité pour nos unités dans le rayon : un pouvoir ne blesse jamais son camp ni ses alliés
  // (explosionZone). (Avant le 13 novembre 2026, deux fois leur coût était retiré : Ultra ne tirait donc
  // jamais un pouvoir sur un combat au contact.)
  // Priorités (contre-essai du 13 novembre 2026 : sur deux parties, aucun pouvoir sur un combat en cours,
  // tous sur des bâtiments éloignés) : 2 = groupe ennemi engagé contre nos troupes ou notre base (à moins
  // de 300 px d'une de nos unités ou d'un de nos bâtiments), 1 = groupe serré (trois unités ou plus dans le
  // rayon), 0 = le reste (bâtiments clés). Seules comptent les zones qui atteignent le seuil du pouvoir ;
  // à priorité égale, la plus précieuse.
  const miens = ctx.uns.filter(u => !enVol(u)).concat(ctx.bats);
  const engage = (x, y) => miens.some(m => Math.hypot(m.x - x, m.y - y) < 300 + (m.rayon || 0));
  let best = null;
  for(const K of Object.values(A.ennemis)){
    for(const c of K.armee.concat(K.bats)){
      if(c.def.forme === 'vaisseauMere' || (c.def.avion && enVol(c))) continue;
      let v = 0, cle = false, n = 0;
      voisinsUltra(A, c.x, c.y, rayon*0.9, e => { v += valeurZone(e); if(e.est === 'unite' && valeurZone(e) > 0) n++; if(e.est === 'batiment' && (e.def.aeroport || e.type === 'usine' || e.type === 'qg')) cle = true; });
      if(v < seuil && !(lourd && cle && v >= 1100)) continue;
      const prio = c.est === 'unite' && engage(c.x, c.y) ? 2 : n >= 3 ? 1 : 0;
      if(!best || prio > best.prio || (prio === best.prio && v > best.valeur)) best = {x:c.x, y:c.y, valeur:v, cle, prio};
    }
  }
  return best;
}

// =====================================================================
//  8. EFFETS ET MESSAGES
// =====================================================================
// Un effet est une simple donnée ; le module r3d-effets.js le met en scène.
function effet(type, p){ effets.push(Object.assign({type, vie:p.duree, max:p.duree}, p)); }
function message(texte, genre){
  messages.push({texte, genre:genre||'info', t:performance.now()});
  if(messages.length > 5) messages.shift();
  afficherMessages();
}
function afficherMessages(){
  const maintenant = performance.now();
  messages = messages.filter(m => maintenant - m.t < 6000);
  const zone = document.getElementById('messages');
  zone.innerHTML = '';
  for(const m of messages){ const d = document.createElement('div'); d.className = m.genre; d.textContent = m.texte; zone.appendChild(d); }
}
setInterval(() => { if(messages.length) afficherMessages(); }, 1000);

// =====================================================================
//  9. RENDU : 3D (modules R3D) + calque 2D (barres de vie, cadres, zones)
// =====================================================================
const cv = document.getElementById('jeu');
const calque = document.getElementById('calque'), kctx = calque.getContext('2d');
const miniCv = document.getElementById('miniCv'), mctx = miniCv.getContext('2d');
const miniFond = document.createElement('canvas'); miniFond.width = 240; miniFond.height = 168;
const ECH = 240 / LARG;
let largEcran = 0, hautEcran = 0;

function redimensionner(){
  const dpr = window.devicePixelRatio || 1;
  largEcran = innerWidth; hautEcran = innerHeight;
  calque.width = largEcran*dpr; calque.height = hautEcran*dpr;
  calque.style.width = largEcran+'px'; calque.style.height = hautEcran+'px';
  kctx.setTransform(dpr,0,0,dpr,0,0);
  if(window.R3D && R3D.redimensionner) R3D.redimensionner(largEcran, hautEcran);
}
addEventListener('resize', redimensionner);
function rond(g,x,y,r){ g.beginPath(); g.arc(x,y,r,0,Math.PI*2); }

// Fond de la minicarte (vue du dessus simplifiée, dessinée une fois).
function dessinerFondMinicarte(){
  const g = miniFond.getContext('2d'), k = ECH;
  g.fillStyle = '#b6a377'; g.fillRect(0,0,240,168);
  g.fillStyle = '#5f7a45';
  for(const b of bosquets){ rond(g, b.x*k, b.y*k, Math.max(2, b.r*k)); g.fill(); }
  g.strokeStyle = '#2f6f92'; g.lineCap = 'round'; g.lineJoin = 'round';
  for(const rv of RIVIERES){ g.lineWidth = Math.max(2, rv.largeur*k); g.beginPath(); rv.points.forEach(([x,y],i) => i ? g.lineTo(x*k,y*k) : g.moveTo(x*k,y*k)); g.stroke(); }
  g.strokeStyle = '#6b6152'; g.lineWidth = 2;
  for(const rt of ROUTES){ g.beginPath(); rt.forEach(([x,y],i) => i ? g.lineTo(x*k,y*k) : g.moveTo(x*k,y*k)); g.stroke(); }
  g.strokeStyle = '#8a6f4a'; g.lineWidth = 3;
  for(const p of PONTS){
    const dx = Math.cos(p.angle)*p.longueur/2, dy = Math.sin(p.angle)*p.longueur/2;
    g.beginPath(); g.moveTo((p.x-dx)*k, (p.y-dy)*k); g.lineTo((p.x+dx)*k, (p.y+dy)*k); g.stroke();
  }
  g.lineCap = 'butt'; g.lineJoin = 'miter';
  g.fillStyle = '#7b7365';
  for(const r of roches){ rond(g, r.x*k, r.y*k, Math.max(1.5, r.r*k)); g.fill(); }
  g.fillStyle = '#c9cdcf';
  for(const s of STRUCTURES) g.fillRect(s.x*k, s.y*k, s.l*k, s.h*k);
  if(isFinite(cote(0))){
    g.beginPath(); g.moveTo(0,168);
    for(let x=0;x<=LARG;x+=20) g.lineTo(x*k, Math.min(168, cote(x)*k));
    g.lineTo(240,168); g.closePath(); g.fillStyle = '#245f80'; g.fill();
  }
}
const vue = () => R3D.vue;
// Hauteur (3D) où placer la barre de vie : fournie par les modules de rendu s'ils la connaissent.
// La hauteur d'un modèle est demandée une seule fois par type à son module de rendu ; si celui-ci
// ne la connaît pas (ou échoue), une valeur par défaut la remplace : le calque 2D n'en dépend jamais.
const hauteursModele = {};
function hauteurModele(rendu, genre, type){
  const cle = genre + ':' + type;
  if(hauteursModele[cle] === undefined){
    let h = 0;
    try { h = (rendu && rendu.hauteurBarre && rendu.hauteurBarre(type)) || 0; }
    catch(err){ console.warn('[Rendu] hauteur de barre inconnue pour « ' + type + ' » :', err); }
    hauteursModele[cle] = h;
  }
  return hauteursModele[cle];
}
function hauteurBarre(e){
  if(e.est === 'batiment') return hauteurModele(R3D.Batiments, 'batiment', e.type) || e.def.taille*TUILE*0.55;
  // Entités rendues par r3d-aliens.js (def.rendu === 'aliens') : hauteur fournie par ce module.
  const h = hauteurModele(e.def.rendu === 'aliens' ? R3D.Aliens : R3D.Unites, 'unite', e.type);
  if(h) return h + altitudeDe(e);
  if(e.def.aerien) return altitudeDe(e) + 18;
  return {infanterie:22, ouvrier:22, vehicule:24, char:28, artillerie:26, antiair:26, camion:26, atelier:28}[e.def.forme] || 24;
}
function barreVie(g, x, y, l, k, epaisse){
  const h = epaisse ? 5 : 3;
  g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(x-l/2-1, y-1, l+2, h+2);
  g.fillStyle = k > .6 ? '#6fd67c' : k > .3 ? '#e8c34a' : '#ef5a43'; g.fillRect(x-l/2, y, l*Math.max(0,k), h);
}
function cercleSol(g, x, y, r, n){
  g.beginPath();
  for(let i=0;i<=n;i++){
    const a = i/n*Math.PI*2, p = R3D.solVersEcran(x+Math.cos(a)*r, y+Math.sin(a)*r, 1);
    i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
  }
}
// Zones d'objectif affichées au sol (actions « zone » des missions).
function dessinerZones(g){
  for(const z of MS.zones){
    const coul = z.couleur || '#ffd27a';
    g.save();
    g.strokeStyle = coul; g.fillStyle = coul; g.lineWidth = 2;
    cercleSol(g, z.x, z.y, z.r, 64);
    g.globalAlpha = 0.10; g.fill();
    g.globalAlpha = 0.9; g.setLineDash([12,8]); g.lineDashOffset = -temps*14; g.stroke();
    g.setLineDash([]);
    if(z.texte){
      const p = R3D.solVersEcran(z.x, z.y, 4);
      if(p.devant && p.x > -200 && p.x < largEcran+200 && p.y > -50 && p.y < hautEcran+50){
        g.globalAlpha = 1; g.font = 'bold 13px Segoe UI, sans-serif'; g.textAlign = 'center';
        const l = g.measureText(z.texte).width + 14;
        g.fillStyle = 'rgba(10,12,14,.72)'; g.fillRect(p.x - l/2, p.y - 11, l, 21);
        g.fillStyle = coul; g.fillText(z.texte, p.x, p.y + 4);
        g.textAlign = 'left';
      }
    }
    g.restore();
  }
}
function dessinerCalque(){
  const g = kctx;
  g.clearRect(0,0,largEcran,hautEcran);
  if(MS.zones.length) dessinerZones(g);
  // Cercles d'aura (pose d'un bâtiment à aura, ou bâtiment à aura sélectionné)
  const montrerAura = (mode && mode.type === 'placer' && BATIMENTS[mode.bat].aura) ||
                      selection.some(e => e.camp === campJoueur && e.est === 'batiment' && auraActive(e));
  if(montrerAura){
    const F = faction(campJoueur);
    g.strokeStyle = couleurCamp(campJoueur) || F.couleur; g.globalAlpha = 0.6; g.lineWidth = 1.5; g.setLineDash([6,8]);
    for(const b of ents) if(b.camp === campJoueur && b.est === 'batiment' && auraActive(b) && !b.enCours){ cercleSol(g, b.x, b.y, F.rayonAura, 64); g.stroke(); }
    if(mode && mode.type === 'placer' && BATIMENTS[mode.bat].aura){
      const {c, r, t} = cellulePlacement(); cercleSol(g, (c+t/2)*TUILE, (r+t/2)*TUILE, F.rayonAura, 64); g.stroke();
    }
    g.setLineDash([]); g.globalAlpha = 1;
  }
  // Portée d'une défense fixe (en placement, ou sélectionnée)
  const portees = [];
  if(mode && mode.type === 'placer' && BATIMENTS[mode.bat].arme){ const {c, r, t} = cellulePlacement(); portees.push({x:(c+t/2)*TUILE, y:(r+t/2)*TUILE, p:BATIMENTS[mode.bat].portee}); }
  for(const e of selection) if(e.est === 'batiment' && e.def.arme) portees.push({x:e.x, y:e.y, p:e.def.portee, c:couleurCamp(e.camp)});
  if(portees.length){
    g.globalAlpha = 0.55; g.lineWidth = 1.5; g.setLineDash([4,6]);
    for(const q of portees){ g.strokeStyle = q.c || '#ffb36b'; cercleSol(g, q.x, q.y, q.p, 56); g.stroke(); }
    g.setLineDash([]); g.globalAlpha = 1;
  }
  if(mode && mode.type === 'pouvoir'){
    const P = POUVOIRS[camps[campJoueur].faction].find(p => p.cle === mode.cle);
    g.strokeStyle = '#ffd27a'; g.lineWidth = 2; g.setLineDash([8,6]); cercleSol(g, souris.mx, souris.my, P.rayon, 48); g.stroke(); g.setLineDash([]);
  }
  // Barres de vie et galons
  // Au dézoom, seules les unités sélectionnées ou sérieusement blessées gardent leur barre,
  // pour ne pas couvrir le champ de bataille d'un tapis de barres.
  const loin = R3D.vue.distance > 1200;
  for(const e of ents){
    const bouclier = !!e.def.bouclier && e.bouclierMax > 0;   // vaisseau-mère : barre toujours visible, bouclier au-dessus
    if(!(e.selectionne || bouclier || e.pv < e.pvMax || (e.est === 'unite' && e.rang > 0))) continue;
    if(loin && e.est === 'unite' && !e.selectionne && !bouclier && e.pv >= e.pvMax*0.5) continue;
    const p = R3D.solVersEcran(e.x, e.y, hauteurBarre(e));
    if(!p.devant || p.x < -50 || p.y < -50 || p.x > largEcran+50 || p.y > hautEcran+50) continue;
    // Longueur de la barre = largeur du modèle projetée à l'écran (elle suit donc le zoom).
    const large = e.est === 'batiment' || bouclier;
    const r = e.est === 'batiment' ? e.def.taille*TUILE*0.45 : e.rayon*1.1;
    const a = R3D.solVersEcran(e.x - r, e.y, 0), b = R3D.solVersEcran(e.x + r, e.y, 0);
    const l = Math.max(large ? 24 : 10, Math.min(bouclier ? 200 : large ? 140 : 60, Math.hypot(b.x-a.x, b.y-a.y)));
    if(e.selectionne || bouclier || e.pv < e.pvMax){
      barreVie(g, p.x, p.y, l, e.pv/e.pvMax, large);
      // Pastille aux couleurs du camp, à gauche de la barre (escarmouche).
      const cc = couleurCamp(e.camp);
      if(cc){ const h = large ? 5 : 3; g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(p.x - l/2 - 7, p.y - 1, 5, h + 2); g.fillStyle = cc; g.fillRect(p.x - l/2 - 6, p.y, 3, h); }
    }
    if(bouclier){
      g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(p.x-l/2-1, p.y-7, l+2, 5);
      g.fillStyle = FACTIONS.aliens.couleur; g.fillRect(p.x-l/2, p.y-6, l*Math.max(0, e.bouclier/e.bouclierMax), 3);
    }
    if(e.est === 'batiment' && e.camp === campJoueur && !e.enCours && e.file.length){
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(p.x-l/2-1, p.y+5, l+2, 4);
      g.fillStyle = e.bloque ? '#ff7a5c' : '#e0b04a'; g.fillRect(p.x-l/2, p.y+6, l*e.prodT/UNITES[e.file[0]].temps, 2);
    }
    if(e.est === 'batiment' && e.enCours){
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(p.x-l/2-1, p.y+5, l+2, 4);
      g.fillStyle = '#e0b04a'; g.fillRect(p.x-l/2, p.y+6, l*e.progres, 2);
    }
    if(e.est === 'unite' && e.rang > 0){
      g.fillStyle = '#f2c94c';
      for(let i=0;i<e.rang;i++){ const x = p.x + l/2 + 3, y = p.y - 2 + i*5;
        g.beginPath(); g.moveTo(x,y); g.lineTo(x+4,y+3); g.lineTo(x+8,y); g.lineTo(x+8,y+2); g.lineTo(x+4,y+5); g.lineTo(x,y+2); g.closePath(); g.fill(); }
    }
  }
  // Cadre de sélection
  if(souris.bas && (Math.abs(souris.x-souris.dx) > 5 || Math.abs(souris.y-souris.dy) > 5)){
    g.strokeStyle = '#7dff8a'; g.lineWidth = 1; g.fillStyle = 'rgba(125,255,138,.08)';
    const x = Math.min(souris.x, souris.dx), y = Math.min(souris.y, souris.dy), w = Math.abs(souris.x-souris.dx), h = Math.abs(souris.y-souris.dy);
    g.fillRect(x,y,w,h); g.strokeRect(x,y,w,h);
  }
  if(enPause && !partieFinie){
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0,0,largEcran,hautEcran);
    g.fillStyle = '#e8e3d6'; g.font = 'bold 34px Segoe UI, sans-serif'; g.textAlign = 'center';
    g.fillText('PAUSE', largEcran/2, hautEcran/2); g.textAlign = 'left';
  }
}
function cellulePlacement(){
  const t = BATIMENTS[mode.bat].taille;
  return {c:Math.round(souris.mx/TUILE - t/2), r:Math.round(souris.my/TUILE - t/2), t};
}
function dessiner(dt){
  R3D.majCamera();
  if(mode && mode.type === 'placer'){
    const {c, r} = cellulePlacement();
    R3D.Batiments.fantome(mode.bat, camps[campJoueur].faction, c, r, emplacementValide(mode.bat, c, r, false));
  } else R3D.Batiments.fantome(null);
  R3D.Unites.sync(ents, temps, dt);
  R3D.Batiments.sync(ents, noeuds, temps, dt);
  if(R3D.Aliens && R3D.Aliens.sync) R3D.Aliens.sync(ents, effets, temps, dt);   // module facultatif (r3d-aliens.js)
  R3D.Effets.sync(effets, projectiles, temps, dt);
  R3D.rendre(temps, dt);
  dessinerCalque();
  // Minicarte (fluidité) : redessinée au plus 8 fois par seconde de temps réel, ou tout de suite quand
  // la vue bouge (le cadre de la vue suit alors la caméra sans retard).
  const v = R3D.vue, maintenant = performance.now();
  if(maintenant - miniDerniere >= 125 || v.x !== miniVue.x || v.y !== miniVue.y || v.distance !== miniVue.d || v.angle !== miniVue.a){
    miniDerniere = maintenant; miniVue.x = v.x; miniVue.y = v.y; miniVue.d = v.distance; miniVue.a = v.angle;
    dessinerMinicarte();
  }
}
let miniDerniere = -1e9;
const miniVue = {x:NaN, y:NaN, d:NaN, a:NaN};
// Teintes de la minicarte qui ne sont celles d'aucun camp (COULEURS_CAMPS : bleu, rouge, vert, jaune ;
// l'allié des missions : violet clair).
const COULEUR_MINERAI_MINI = '#efe6d2';   // blanc cassé
const COULEUR_ALERTE_MINI = '#ff4fd8';    // magenta vif
function dessinerMinicarte(){
  const g = mctx;
  g.drawImage(miniFond, 0, 0);
  // Champs de minerai : petit losange blanc cassé (avant : carré bleu ciel, confondu avec le bleu du joueur).
  g.fillStyle = COULEUR_MINERAI_MINI;
  for(const n of noeuds) if(n.reste > 0){
    const x = n.x*ECH, y = n.y*ECH;
    g.beginPath(); g.moveTo(x, y-2.2); g.lineTo(x+1.6, y); g.lineTo(x, y+2.2); g.lineTo(x-1.6, y); g.closePath(); g.fill();
  }
  for(const z of MS.zones){ g.strokeStyle = z.couleur || '#ffd27a'; g.lineWidth = 1; rond(g, z.x*ECH, z.y*ECH, Math.max(3, z.r*ECH)); g.stroke(); }
  for(const e of ents){
    const F = faction(e.camp);
    // Couleur du camp (escarmouche) ; sans elle (missions) : allié en couleur propre, sinon celle de la faction.
    const coulCamp = couleurCamp(e.camp);
    g.fillStyle = coulCamp || (allies(e.camp, campJoueur) ? COULEUR_ALLIE : F.couleur);
    if(e.def.forme === 'vaisseauMere'){
      // Vaisseau-mère : son emprise, cerclée, et un point central.
      g.strokeStyle = F.couleur; g.lineWidth = 1.5; rond(g, e.x*ECH, e.y*ECH, Math.max(5, e.rayon*ECH*0.8)); g.stroke();
      rond(g, e.x*ECH, e.y*ECH, 2.5); g.fill();
      if(e.cibleRayon){ g.strokeStyle = '#ff7a5c'; rond(g, e.cibleRayon.x*ECH, e.cibleRayon.y*ECH, 4); g.stroke(); }
    }
    else if(e.est === 'batiment'){ const t = e.def.taille*TUILE*ECH; g.fillRect(e.x*ECH-t/2, e.y*ECH-t/2, t, t); }
    else if(e.def.avion && enVol(e)){
      // Avion en vol : petit losange clair, pour le distinguer des unités au sol
      const x = Math.max(2, Math.min(238, e.x*ECH)), y = Math.max(2, Math.min(166, e.y*ECH));
      g.fillStyle = coulCamp || (allies(e.camp, campJoueur) ? COULEUR_ALLIE : F.clair);
      g.beginPath(); g.moveTo(x, y-2.6); g.lineTo(x+2.6, y); g.lineTo(x, y+2.6); g.lineTo(x-2.6, y); g.closePath(); g.fill();
    }
    else g.fillRect(e.x*ECH-1, e.y*ECH-1, 2.5, 2.5);
  }
  for(const e of effets) if(e.type === 'marqueur'){ g.strokeStyle = COULEUR_ALERTE_MINI; rond(g, e.x*ECH, e.y*ECH, e.r*ECH); g.stroke(); }
  const coins = R3D.empriseVue();
  if(coins){
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath();
    for(let i = 0; i < coins.length; i++){ const p = coins[i]; if(i) g.lineTo(p.x*ECH, p.y*ECH); else g.moveTo(p.x*ECH, p.y*ECH); }
    g.closePath(); g.stroke();
  }
}

// =====================================================================
//  10. INTERFACE : BARRE, PANNEAU, POUVOIRS
// =====================================================================
const el = id => document.getElementById(id);
let signaturePanneau = null;   // null : le panneau vide (aide de départ) est construit à la première image
// Fluidité : le DOM n'est touché que si la valeur change (une écriture identique force quand même
// le navigateur à recalculer la page).
function ecrireTexte(n, t){ if(n){ t = String(t); if(n.textContent !== t) n.textContent = t; } }
function majBarre(){
  const C = camps[campJoueur];
  ecrireTexte(el('hRes'), Math.floor(C.reserves));
  ecrireTexte(el('hPts'), Math.floor(C.points));
  ecrireTexte(el('hPop'), (population[campJoueur] || 0) + ' / ' + popMax);
  majBandeauCamps();
  ecrireTexte(el('hTemps'), enMinSec(temps));
  for(const P of POUVOIRS[C.faction]){
    const b = el('pv_'+P.cle); if(!b) continue;
    const rc = C.recharges[P.cle] || 0;
    const off = C.points < P.cout || rc > 0;
    if(b.disabled !== off) b.disabled = off;
    ecrireTexte(b.querySelector('.c'), rc > 0 ? 'recharge ' + Math.ceil(rc) + ' s' : P.cout + ' points');
    b.classList.toggle('actif', !!(mode && mode.type === 'pouvoir' && mode.cle === P.cle));
  }
}
// Bandeau des camps (escarmouche) : une ligne par camp, avec sa couleur, sa faction, son équipe et son
// état (en jeu, éliminé, trêve). Reconstruit seulement quand l'un d'eux change.
let signatureBandeau = '';
function construireBandeauCamps(){
  const b = el('bandeauCamps'); if(!b) return;
  signatureBandeau = '';
  b.classList.toggle('cache', !!MISSION || !campsEnJeu().length || !!window.MODE_DEMO);
  majBandeauCamps();
}
function majBandeauCamps(){
  const b = el('bandeauCamps'); if(!b || MISSION || b.classList.contains('cache')) return;
  const ids = campsEnJeu();
  const sig = ids.map(id => id + (camps[id].elimine ? 'x' : '')).join('') + (alliance ? 'T' : '');
  if(sig === signatureBandeau) return;
  signatureBandeau = sig;
  b.innerHTML = ids.map(id => {
    const C = camps[id], moi = id === campJoueur, ami = allies(id, campJoueur);
    const rel = moi ? 'vous' : ami ? (equipeDe(id) === equipeDe(campJoueur) ? 'allié' : 'trêve') : 'ennemi';
    return `<div class="campB${C.elimine ? ' elimine' : ''}" title="${echapper(nomCamp(id) + ' — ' + faction(id).nom + ', équipe ' + equipeDe(id) + (C.ia ? ', ordinateur' : ''))}">` +
      `<span class="pastille" style="background:${couleurCamp(id) || faction(id).couleur}"></span>` +
      `<span class="fac">${echapper(faction(id).nom)}</span><span class="eq">${echapper(equipeDe(id))}</span>` +
      `<span class="etat">${C.elimine ? 'éliminé' : rel}</span></div>`;
  }).join('');
}
function construireBarrePouvoirs(){
  const zone = el('pouvoirs'); zone.innerHTML = '';
  if(!pouvoirsActifs[campJoueur]) return;
  for(const P of POUVOIRS[camps[campJoueur].faction]){
    const b = document.createElement('button');
    b.className = 'pouvoir' + (P.super ? ' super' : ''); b.id = 'pv_'+P.cle; b.title = P.desc;
    b.innerHTML = `<b>${P.nom}</b><br><span class="c"></span>`;
    b.onclick = () => {
      if(!P.cible){ activerPouvoir(campJoueur, P.cle); return; }
      mode = {type:'pouvoir', cle:P.cle}; message('Choisissez la cible (clic gauche). Clic droit pour annuler.');
    };
    zone.appendChild(b);
  }
}
function etatAvion(u){
  switch(u.phase){
    case 'sol': return u.munitions < u.def.munitions ? 'Réarmement (' + Math.ceil(Math.max(0, u.rearmeT)) + ' s)' : 'Stationné, prêt à décoller';
    case 'sortie': return 'Roule vers la piste';
    case 'decollage': return 'Décollage';
    case 'approche': return 'Retour à l’aéroport';
    case 'finale': return 'Atterrissage';
    case 'roulage': case 'rangement': return 'Roule vers sa place';
  }
  if(u.munitions <= 0) return u.base ? 'Retour à l’aéroport' : 'Sans munitions : aucun aéroport libre';
  if(u.cible) return 'Passe d’attaque';
  if(u.ordre) return u.ordre.type === 'rentrer' ? 'Retour à l’aéroport' : u.ordre.type === 'attaqueDeplacement' ? 'Patrouille offensive' : 'En route';
  return 'En attente (cercle)';
}
function etatUnite(u){
  if(u.def.avion) return etatAvion(u);
  if(u.def.ouvrier){
    if(!u.ordre) return 'Disponible';
    if(u.ordre.type === 'construire') return 'Construction';
    if(u.ordre.type === 'reparer') return 'Réparation';
    return 'En mouvement';
  }
  if(u.def.collecteur){
    const ch = Math.floor(u.charge || 0) + ' / ' + u.def.capacite;
    if(u.attenteDepot) return 'Chargé (' + ch + ') : aucun dépôt ni QG pour décharger';
    const o = u.ordre;
    if(!o) return u.gare ? 'À l’arrêt (clic droit sur un champ pour reprendre)' : (noeuds.some(n => n.reste > 0) ? 'Reprend la récolte…' : 'Plus aucun champ de minerai');
    if(o.type !== 'recolter') return 'En mouvement (' + ch + ')';
    if(o.retour) return u.travaille ? 'Déchargement (' + ch + ')' : 'Rapporte le minerai (' + ch + ')';
    return u.travaille ? 'Chargement (' + ch + ')' : 'Vers le champ de minerai (' + ch + ')';
  }
  if(u.def.repare){
    const p = u.cibleSoin;
    if(p && !p.mort) return (u.travaille ? (u.def.soigne === 'infanterie' && p.est !== 'batiment' ? 'Soigne : ' : 'Répare : ') : 'Rejoint : ') + p.def.nom;
    return u.ordre ? 'En mouvement' : 'Disponible : soigne seul les alliés proches';
  }
  if(u.cible) return 'Au combat';
  if(u.ordre) return u.ordre.type === 'attaqueDeplacement' ? 'Progression offensive' : 'En mouvement';
  return 'En position';
}
function suffixeCamp(e){
  if(e.camp === campJoueur) return '';
  if(e.camp === 'N') return ' (' + FACTIONS.neutre.nom + ')';
  const coul = !MISSION && couleurCamp(e.camp) ? ', ' + nomCamp(e.camp).toLowerCase() : '';
  return allies(e.camp, campJoueur) ? ' (allié' + coul + ')' : ' (ennemi' + coul + ')';
}
function construirePanneau(){
  const infos = el('infos'), actions = el('actions');
  infos.innerHTML = ''; actions.innerHTML = '';
  if(!selection.length){
    infos.innerHTML = `<h3>${faction(campJoueur).nom}</h3><div class="desc">Sélectionnez une unité ou un bâtiment.<br>
      Clic gauche : sélectionner · Clic droit : ordonner · Glisser : sélection multiple.<br>
      Barre du bas : construire et produire sans rien sélectionner (F1 à F4 : onglets).</div>`;
    return;
  }
  const e = selection[0], mien = e.camp === campJoueur;
  if(selection.length > 1){
    const compte = {};
    for(const s of selection) compte[s.def.nom] = (compte[s.def.nom]||0) + 1;
    infos.innerHTML = `<h3>${selection.length} unités</h3><div class="desc">` +
      Object.entries(compte).map(([n,k]) => `${k} × ${n}`).join('<br>') + '</div>';
  } else if(e.est === 'unite'){
    infos.innerHTML = `${htmlVignette('unite', e.type, factionVignette(e), 'vign')}<h3>${e.def.nom}${suffixeCamp(e)}</h3><div class="desc">${e.def.desc}</div>
      <div class="barrePv"><i id="ipv"></i></div><div class="ligne" id="ipvt"></div>
      <div class="ligne" id="ietat"></div><div class="ligne" id="iaura"></div>`;
  } else {
    infos.innerHTML = `${htmlVignette('batiment', e.type, factionVignette(e), 'vign')}<h3>${e.def.nom}${suffixeCamp(e)}</h3><div class="desc">${e.def.desc}</div>
      <div class="barrePv"><i id="ipv"></i></div><div class="ligne" id="ipvt"></div><div class="ligne" id="ietat"></div>`;
  }
  if(!mien) return;
  const F = faction(campJoueur);
  const ajouter = (html, titre, fn, extra) => {
    const b = document.createElement('button'); b.className = 'act'; b.innerHTML = html; b.title = titre || '';
    b.onclick = fn; if(extra) extra(b); actions.appendChild(b); return b;
  };
  const unites = selection.filter(s => s.est === 'unite');
  if(unites.length && unites.every(u => u.def.ouvrier)){
    for(const t of batimentsConstructibles(F)){
      if(!t || !BATIMENTS[t] || !autorise('batiments', t)) continue;
      const D = BATIMENTS[t];
      ajouter(`${D.nom}<span class="c">${D.cout} réserves</span>`, D.desc + (D.requiert ? ' Nécessite : ' + BATIMENTS[D.requiert].nom + '.' : ''),
        () => { mode = {type:'placer', bat:t}; },
        b => { b.dataset.cout = D.cout; if(D.requiert) b.dataset.requiert = D.requiert; });
    }
  }
  if(unites.length && unites.some(u => (u.def.arme || u.def.repare) && !u.def.ouvrier)){
    ajouter('Attaque-déplacement<span class="c">touche A</span>', 'Les unités avancent et engagent tout ennemi en chemin ; les réparateurs soignent les blessés en route.', () => { mode = {type:'attaque'}; });
  }
  if(unites.length){
    if(unites.every(u => u.def.avion)) ajouter('Retour à l’aéroport<span class="c">touche S</span>', 'Les avions rentrent se poser et attendent sur leur place.', arreter);
    else ajouter('Arrêt<span class="c">touche S</span>', 'Annule les ordres en cours.' + (unites.some(u => u.def.avion) ? ' Les avions rentrent à leur aéroport.' : ''), arreter);
  }
  if(selection.length === 1 && e.est === 'batiment' && !e.enCours){
    const prod = (F.production[e.type] || []).filter(t => autorise('unites', t));
    for(const t of prod){
      const D = UNITES[t];
      ajouter(`${D.nom}<span class="c">${D.cout} réserves</span><span class="n" data-type="${t}"></span>`,
        D.desc + ' Clic droit : retirer de la file.', () => commander(e, t),
        b => { b.dataset.cout = D.cout; if(D.avion) b.dataset.avion = '1'; if(D.forme === 'helico') b.dataset.helico = '1'; b.oncontextmenu = ev => { ev.preventDefault(); const i = e.file.lastIndexOf(t);
          if(i >= 0){ e.file.splice(i,1); camps[campJoueur].reserves += D.cout; if(i === 0) e.prodT = 0; } }; });
    }
    if(prod.length){
      const f = document.createElement('div'); f.className = 'file'; f.id = 'ifile'; actions.appendChild(f);
    }
  }
}
function rafraichirPanneau(){
  const e = selection[0];
  if(e && selection.length === 1){
    const k = e.pv/e.pvMax, b = el('ipv');
    if(b){
      const w = (k*100)+'%', c = k > .6 ? '#6fd67c' : k > .3 ? '#e8c34a' : '#ef5a43';
      if(b._w !== w){ b._w = w; b.style.width = w; }
      if(b._c !== c){ b._c = c; b.style.background = c; }
    }
    const t = el('ipvt'); if(t) ecrireTexte(t, 'Points de vie : ' + Math.ceil(e.pv) + ' / ' + e.pvMax + (e.rang ? ' · ' + (e.rang === 1 ? 'Vétéran' : 'Élite') : ''));
    const s = el('ietat');
    if(s){
      if(e.est === 'unite') ecrireTexte(s, 'État : ' + etatUnite(e));
      else if(e.enCours) ecrireTexte(s, 'En construction : ' + Math.floor(e.progres*100) + ' %');
      else if(e.def.arme) ecrireTexte(s, (e.cible ? 'Engage une cible' : 'En veille') + ' · portée ' + e.def.portee);
      else if(e.file.length) ecrireTexte(s, e.bloque ? (e.blocage === 'places' ? 'Production suspendue : aucune place libre' : 'Production suspendue : effectif maximal atteint')
        : 'Production : ' + UNITES[e.file[0]].nom + ' (' + Math.floor(e.prodT/UNITES[e.file[0]].temps*100) + ' %)');
      else if(e.def.aeroport) ecrireTexte(s, 'Avions : ' + avionsDe(e).length + ' / ' + PLACES_AEROPORT.length + ' · hélicoptères : ' + helicosDe(e) + ' / ' + HELICOS_PAR_AEROPORT);
      else ecrireTexte(s, (e.def.neutre ? 'Installation civile' : 'Inactif') + (BATIMENTS[e.type].depot ? ' · reçoit les réserves' : ''));
    }
    const a = el('iaura');
    if(a && e.def.avion) ecrireTexte(a, 'Munitions : ' + Math.max(0, e.munitions) + ' / ' + e.def.munitions);   // les avions n'ont pas d'aura
    else if(a) ecrireTexte(a, e.camp === campJoueur && !e.def.ouvrier && e.def.arme ? (e.dansAura ? faction(campJoueur).auraTexte : 'Hors de portée du ' + (camps[campJoueur].faction === 'halden' ? 'réseau de relais.' : 'ravitaillement.')) : '');
    const f = el('ifile');
    if(f) ecrireTexte(f, e.file.length ? 'File : ' + e.file.map(t => UNITES[t].nom).join(', ') : 'File vide · clic droit sur la carte : point de ralliement');
  }
  for(const b of el('actions').querySelectorAll('button.act')){
    if(b.dataset.cout){
      const manque = b.dataset.requiert && !ents.some(x => x.camp === campJoueur && x.type === b.dataset.requiert && !x.enCours);
      const off = camps[campJoueur].reserves < +b.dataset.cout || !!manque;
      if(b.disabled !== off) b.disabled = off;
      // Avion : grisé quand les trois places de l'aéroport sont prises (avions + file). Classe plutôt
      // que « disabled » : le clic droit doit rester possible pour retirer un avion de la file.
      if(b.dataset.avion && e && e.def.aeroport) b.classList.toggle('grise', aeroportPlein(e));
      if(b.dataset.helico && e && e.def.aeroport) b.classList.toggle('grise', helicosPlein(e));
    }
    const n = b.querySelector('.n');
    if(n && e) { let k = 0; for(const t of e.file) if(t === n.dataset.type) k++; ecrireTexte(n, k ? k : ''); }
  }
}
function majPanneau(){
  const sig = selection.map(e => e.id + (e.enCours ? 'c' : '')).join(',');
  if(sig !== signaturePanneau){ signaturePanneau = sig; construirePanneau(); }
  rafraichirPanneau();
}
// ---------- Barre de construction (en bas à droite, toujours visible en jeu) ----------
// Quatre onglets ; chaque bouton commande sans rien sélectionner : un bâtiment passe en placement (le
// fantôme habituel) et l'ouvrier libre le plus proche s'en charge ; une unité est mise en file dans le
// bâtiment producteur le moins chargé (clic droit : retirée de la file, réserves rendues). Un bouton
// grisé (classe « grise », pour garder le clic droit) donne sa raison au survol et au clic.
// Tout passe par autorise() : en mission, ce qui est interdit n'apparaît pas.
const ONGLETS_FAB = [{cle:'batiments', nom:'Bâtiments', touche:'F1'}, {cle:'infanterie', nom:'Infanterie', touche:'F2'},
  {cle:'vehicules', nom:'Véhicules', touche:'F3'}, {cle:'avions', nom:'Aviation', touche:'F4'}];
// ---------- Vignettes (images des modèles 3D, module facultatif r3d-vignettes.js) ----------
// R3D.Vignettes.image(genre, type, faction) : URL de données, ou null tant que l'image n'est pas prête.
// En attendant (ou sans le module), un pictogramme neutre. L'événement window « vignettes » signale de
// nouvelles images : majVignettes() complète alors toutes les <img data-vg> de la page.
const PICTOS = {
  batiment:'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><g fill="none" stroke="#9aa3a8" stroke-width="2.5" stroke-linejoin="round"><path d="M10 40V22l14-8 14 8v18z"/><path d="M38 40V28h16v12z"/><path d="M6 40h52"/><path d="M20 40v-9h8v9"/></g></svg>'),
  unite:'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><g fill="none" stroke="#9aa3a8" stroke-width="2.5" stroke-linejoin="round"><path d="M10 34h44l-5-9H15z"/><path d="M22 25l4-7h12l4 7"/><path d="M32 21h20"/><circle cx="18" cy="37" r="4"/><circle cx="32" cy="37" r="4"/><circle cx="46" cy="37" r="4"/></g></svg>'),
};
let vignettesInit = false;
function vignette(genre, type, fac){
  try {
    if(!window.R3D || !R3D.Vignettes || typeof R3D.Vignettes.image !== 'function') return null;
    if(!vignettesInit && typeof R3D.Vignettes.init === 'function'){ vignettesInit = true; R3D.Vignettes.init(); }
    return R3D.Vignettes.image(genre, type, fac) || null;
  } catch(err){ return null; }
}
// Balise <img> d'une vignette (pictogramme tant que l'image n'est pas prête).
function htmlVignette(genre, type, fac, classe){
  const src = vignette(genre, type, fac);
  return `<img class="${classe || ''}${src ? '' : ' picto'}" alt="" data-vg="${genre}|${type}|${fac || ''}" src="${src || PICTOS[genre] || PICTOS.unite}">`;
}
function majVignettes(){
  for(const img of document.querySelectorAll('img.picto[data-vg]')){
    const [g, t, f] = img.dataset.vg.split('|');
    const src = vignette(g, t, f || null);
    if(src){ img.src = src; img.classList.remove('picto'); }
  }
}
addEventListener('vignettes', majVignettes);
function factionVignette(e){
  const f = camps[e.camp] && camps[e.camp].faction;
  return f === 'halden' || f === 'karsk' ? f : 'halden';
}
let ongletFab = 'batiments', signatureFab = '';
function elementsOnglet(cle){
  const F = faction(campJoueur), liste = [];
  if(cle === 'batiments'){
    for(const t of batimentsConstructibles(F))
      if(t && BATIMENTS[t] && autorise('batiments', t)) liste.push({genre:'batiment', type:t});
    return liste;
  }
  const prendre = (bat, filtre) => { for(const t of F.production[bat] || []) if(UNITES[t] && filtre(UNITES[t]) && autorise('unites', t)) liste.push({genre:'unite', type:t, producteur:bat}); };
  if(cle === 'infanterie'){ prendre('qg', D => D.ouvrier); prendre('caserne', () => true); }
  else if(cle === 'vehicules'){ prendre('qg', D => D.collecteur); prendre('usine', () => true); }
  else prendre('aeroport', () => true);
  return liste;
}
// Bâtiments finis du joueur capables de produire ce type d'unité.
function producteursDe(type){
  const F = faction(campJoueur);
  return ents.filter(b => b.est === 'batiment' && b.camp === campJoueur && !b.mort && !b.enCours && (F.production[b.type] || []).includes(type));
}
// État d'un bouton : raison du grisé (null s'il est utilisable), nombre en file ou en chantier, avancement.
function etatFab(it){
  const C = camps[campJoueur];
  if(it.genre === 'batiment'){
    const D = BATIMENTS[it.type];
    const chantiers = ents.filter(b => b.est === 'batiment' && b.camp === campJoueur && !b.mort && b.type === it.type && b.enCours);
    const progres = chantiers.reduce((m, b) => Math.max(m, b.progres), 0);
    let raison = null;
    if(D.requiert && !ents.some(b => b.camp === campJoueur && b.type === D.requiert && !b.enCours && !b.mort)) raison = 'Nécessite : ' + BATIMENTS[D.requiert].nom + '.';
    else if(C.reserves < D.cout) raison = 'Réserves insuffisantes (' + D.cout + ' nécessaires).';
    return {raison, n:chantiers.length, progres: chantiers.length ? progres : 0};
  }
  const D = UNITES[it.type], prods = producteursDe(it.type);
  let n = 0, progres = 0;
  for(const b of prods){
    n += b.file.filter(t => t === it.type).length;
    if(b.file[0] === it.type) progres = Math.max(progres, b.prodT / D.temps);
  }
  let raison = null;
  if(!prods.length) raison = 'Nécessite : ' + BATIMENTS[it.producteur].nom + '.';
  else if(D.avion && prods.every(aeroportPlein)) raison = 'Aéroport plein : trois avions au plus par aéroport (avions présents et commandés).';
  else if(D.forme === 'helico' && prods.every(helicosPlein)) raison = 'Quatre hélicoptères au plus par aéroport (présents et commandés).';
  else if(prods.every(b => b.file.length >= 5)) raison = 'Files de production pleines.';
  else if(C.reserves < D.cout) raison = 'Réserves insuffisantes (' + D.cout + ' nécessaires).';
  return {raison, n, progres};
}
// Ouvrier qui prendra le chantier : le plus proche des libres (sans ordre, ou qui répare / se déplace),
// sinon le plus proche de tous. null s'il n'y en a aucun.
function ouvrierPour(x, y){
  const ouvriers = ents.filter(u => u.est === 'unite' && u.camp === campJoueur && !u.mort && u.def.ouvrier);
  const libres = ouvriers.filter(u => !u.ordre || u.ordre.type === 'reparer' || u.ordre.type === 'aller');
  const proche = l => { let best = null, bd = Infinity; for(const u of l){ const d = Math.hypot(u.x - x, u.y - y); if(d < bd){ bd = d; best = u; } } return best; };
  return proche(libres) || proche(ouvriers);
}
function clicFab(it){
  const et = etatFab(it);
  if(et.raison){ message(et.raison, 'alerte'); return; }
  if(it.genre === 'batiment'){
    if(!ents.some(u => u.est === 'unite' && u.camp === campJoueur && !u.mort && u.def.ouvrier)){
      message('Aucun ouvrier pour construire : formez-en un au QG (onglet Infanterie).', 'alerte'); return;
    }
    mode = {type:'placer', bat:it.type, barre:true};
    message('Placez le bâtiment (clic gauche). Clic droit ou Échap : annuler. Maj : en placer plusieurs.');
    return;
  }
  // Le producteur le moins chargé (pour un avion : parmi les aéroports qui ont encore une place).
  let prods = producteursDe(it.type).filter(b => b.file.length < 5);
  if(UNITES[it.type].avion) prods = prods.filter(b => !aeroportPlein(b));
  if(UNITES[it.type].forme === 'helico') prods = prods.filter(b => !helicosPlein(b));
  prods.sort((a, b) => a.file.length - b.file.length);
  if(prods.length) commander(prods[0], it.type);
}
function retirerFab(it){
  if(it.genre !== 'unite') return;
  // Le producteur qui en a le plus en file ; on retire la dernière commande (réserves rendues).
  let best = null, bk = 0;
  for(const b of producteursDe(it.type)){ const k = b.file.filter(t => t === it.type).length; if(k > bk){ bk = k; best = b; } }
  if(!best) return;
  const i = best.file.lastIndexOf(it.type);
  best.file.splice(i, 1); camps[campJoueur].reserves += UNITES[it.type].cout;
  if(i === 0) best.prodT = 0;
}
function choisirOngletFab(cle){ if(ONGLETS_FAB.some(o => o.cle === cle)){ ongletFab = cle; signatureFab = ''; } }
function construireFabrique(items){
  const tabs = el('ongletsFab'), zone = el('boutonsFab');
  if(!tabs || !zone) return;
  tabs.innerHTML = ''; zone.innerHTML = '';
  for(const o of ONGLETS_FAB){
    const b = document.createElement('button');
    b.className = 'onglet' + (o.cle === ongletFab ? ' actif' : ''); b.innerHTML = echapper(o.nom) + '<span class="tch">' + o.touche + '</span>';
    b.title = o.nom + ' (' + o.touche + ')';
    b.onclick = () => choisirOngletFab(o.cle);
    tabs.appendChild(b);
  }
  cacherInfobulle();
  if(!items.length){
    const v = document.createElement('div'); v.className = 'vide';
    v.textContent = MISSION ? 'Rien de disponible dans cet onglet pour cette mission.' : 'Rien de disponible dans cet onglet.';
    zone.appendChild(v); return;
  }
  const fac = camps[campJoueur].faction;
  for(const it of items){
    const D = it.genre === 'batiment' ? BATIMENTS[it.type] : UNITES[it.type];
    const b = document.createElement('button');
    b.className = 'fab'; b.dataset.type = it.type;
    b.innerHTML = htmlVignette(it.genre, it.type, fac) +
      `<span class="nom">${echapper(D.nom)}</span><span class="c">${D.cout}</span><span class="n"></span><i class="prog"><b></b></i>`;
    b.onclick = () => clicFab(it);
    b.oncontextmenu = ev => { ev.preventDefault(); retirerFab(it); };
    b.onmouseenter = () => montrerInfobulle(b);
    b.onmouseleave = cacherInfobulle;
    b._item = it;
    zone.appendChild(b);
  }
}
// ---------- Infobulle de la barre de construction ----------
// Image, nom, prix, durée, bâtiment requis, points de vie, portée, cibles (sol, air), puis la
// description ; en tête, la raison d'un bouton grisé. Rafraîchie par majFabrique tant qu'elle est visible.
let infobulleBouton = null, signatureInfobulle = '';
function ciblesTexte(D){
  if(D.repare) return D.soigne === 'infanterie' ? 'aucune (soigne l’infanterie, répare les bâtiments)' : 'aucune (répare véhicules, hélicoptères, bâtiments)';
  if(!D.arme) return 'aucune (sans arme)';
  const air = D.air ? (D.pasAvion ? 'air (sauf avions)' : 'air') : null;
  return [D.sol ? 'sol' : null, air].filter(Boolean).join(' et ') || 'aucune';
}
function contenuInfobulle(it, raison){
  const bat = it.genre === 'batiment', D = bat ? BATIMENTS[it.type] : UNITES[it.type];
  const requis = bat ? (D.requiert ? BATIMENTS[D.requiert].nom : 'aucun') : BATIMENTS[it.producteur].nom;
  const lignes = [['Durée', D.temps + ' s'], [bat ? 'Requiert' : 'Produit par', requis], ['Points de vie', D.pv]];
  if(bat) lignes.push(['Taille', D.taille + ' × ' + D.taille + ' cases']);
  if(D.arme || D.repare) lignes.push(['Portée', D.arme ? D.portee + (D.porteeMin ? ' (pas sous ' + D.porteeMin + ')' : '') : 'contact']);
  lignes.push(['Cibles', ciblesTexte(D)]);
  if(D.forme === 'helico') lignes.push(['Limite', HELICOS_PAR_AEROPORT + ' par aéroport']);
  if(D.avion) lignes.push(['Limite', PLACES_AEROPORT.length + ' avions par aéroport']);
  return htmlVignette(it.genre, it.type, camps[campJoueur].faction) +
    `<div class="corps"><h4>${echapper(D.nom)}<span class="prix">${D.cout} réserves</span></h4>` +
    (raison ? `<div class="raison">${echapper(raison)}</div>` : '') +
    `<div class="carac">${lignes.map(([k, v]) => `<span>${k}</span><b>${echapper(v)}</b>`).join('')}</div>` +
    `<div class="desc">${echapper(D.desc)}</div>` +
    `<div class="aide">${bat ? 'Clic : placer le bâtiment ; l’ouvrier libre le plus proche le construit.' : 'Clic : mettre en file · clic droit : retirer de la file.'}</div></div>`;
}
function montrerInfobulle(b){
  infobulleBouton = b; signatureInfobulle = '';
  majInfobulle();
}
function cacherInfobulle(){
  infobulleBouton = null;
  const t = el('infobulle'); if(t) t.classList.add('cache');
}
function majInfobulle(){
  const t = el('infobulle'), b = infobulleBouton;
  if(!t) return;
  if(!b || !b.isConnected){ if(b) cacherInfobulle(); return; }
  const et = etatFab(b._item), sig = b._item.type + '|' + (et.raison || '');
  if(sig !== signatureInfobulle){ signatureInfobulle = sig; t.innerHTML = contenuInfobulle(b._item, et.raison); }
  t.classList.remove('cache');
  // Au-dessus du bouton, sans sortir de la fenêtre.
  const r = b.getBoundingClientRect(), h = t.offsetHeight, w = t.offsetWidth;
  t.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width/2 - w/2)) + 'px';
  t.style.top = Math.max(52, r.top - h - 8) + 'px';
}
function majFabrique(){
  const zone = el('boutonsFab');
  if(!zone || !camps[campJoueur]) return;
  const items = elementsOnglet(ongletFab);
  const sig = ongletFab + '|' + camps[campJoueur].faction + '|' + items.map(i => i.type).join(',');
  if(sig !== signatureFab){ signatureFab = sig; construireFabrique(items); }
  for(const b of zone.querySelectorAll('button.fab')){
    const it = b._item, et = etatFab(it);
    b.classList.toggle('grise', !!et.raison);
    b.classList.toggle('actif', !!(mode && mode.type === 'placer' && mode.bat === it.type));
    const n = b.querySelector('.n'), t = et.n ? String(et.n) : '';
    if(n.textContent !== t) n.textContent = t;
    const pg = b.querySelector('.prog b'), w = Math.round(Math.min(1, et.progres)*100) + '%';
    if(pg && pg._w !== w){ pg._w = w; pg.style.width = w; }
  }
  if(infobulleBouton) majInfobulle();
}
function arreter(){
  for(const u of selection) if(u.est === 'unite' && u.camp === campJoueur){
    u.ordre = null; u.cible = null; u.chemin = null;
    if(u.def.collecteur) u.gare = true;   // garé : il ne reprend la récolte que sur un nouvel ordre
    // Un avion ne s'arrête pas en l'air : il oublie son point d'attente et rentre se poser.
    if(u.def.avion){ u.attente = null; u.passe = null; if(u.phase !== 'sol') u.ordre = {type:'rentrer'}; }
  }
}

// =====================================================================
//  11. COMMANDES DU JOUEUR
// =====================================================================
function versMonde(sx, sy){ return R3D.ecranVersSol(sx, sy) || {x:-9999, y:-9999}; }
// Entité sous un point du sol (coordonnées de jeu).
function entiteSous(x, y){
  let best = null, bd = Infinity;
  for(const e of ents){
    if(e.est === 'unite'){
      const d = Math.hypot(e.x-x, e.y-y);
      if(d < e.rayon+6 && d < bd){ bd = d; best = e; }
    }
  }
  if(best) return best;
  for(const e of ents) if(e.est === 'batiment' && Math.abs(e.x-x) < e.rayon && Math.abs(e.y-y) < e.rayon) return e;
  return null;
}
// Entité sous le curseur (pixels écran) : lancer de rayon 3D d'abord, puis repli au sol.
function entiteSousEcran(sx, sy){
  let racines = R3D.Unites.racines().concat(R3D.Batiments.racines());
  if(R3D.Aliens && R3D.Aliens.racines) racines = racines.concat(R3D.Aliens.racines() || []);
  const id = R3D.pick(sx, sy, racines);
  if(id != null){ const e = ents.find(x => x.id === id); if(e) return e; }
  // Repli pour les appareils en vol : leur point au sol est loin de leur image à l'écran, on compare
  // donc en pixels, à leur altitude.
  let best = null, bd = 22;
  for(const e of ents){
    if(e.est !== 'unite' || e.mort || !enVol(e)) continue;
    const p = R3D.solVersEcran(e.x, e.y, altitudeDe(e));
    if(!p.devant) continue;
    const d = Math.hypot(p.x - sx, p.y - sy);
    if(d < bd){ bd = d; best = e; }
  }
  if(best) return best;
  const m = versMonde(sx, sy);
  return entiteSous(m.x, m.y);
}
function surEcran(e){
  const p = R3D.solVersEcran(e.x, e.y, e.def.aerien ? altitudeDe(e) : 6);
  return p.devant ? p : null;
}
function selectionner(liste){
  for(const e of selection) e.selectionne = false;
  selection = liste;
  for(const e of selection) e.selectionne = true;
}
function ordonnerFormation(unites, x, y, type){
  const n = unites.length, w = Math.ceil(Math.sqrt(n)), h = Math.ceil(n/w), esp = 34;
  unites.forEach((u, i) => {
    const ox = (i%w - (w-1)/2)*esp, oy = (Math.floor(i/w) - (h-1)/2)*esp;
    u.ordre = {type, x:x+ox, y:y+oy}; u.cible = null; u.chemin = null;
  });
}
function ordreDroit(x, y, cibleForcee){
  const mes = selection.filter(e => e.camp === campJoueur);
  if(!mes.length) return;
  const unites = mes.filter(e => e.est === 'unite');
  if(!unites.length){
    for(const b of mes) if(b.est === 'batiment' && !b.def.arme) b.rally = {x, y};
    effet('ordre', {x, y, duree:0.5, couleur:'#7dff8a'});
    return;
  }
  const cible = cibleForcee !== undefined ? cibleForcee : entiteSous(x, y);
  const n = noeuds.find(k => k.reste > 0 && Math.hypot(k.x-x, k.y-y) < k.rayon+10);
  const ouvriers = unites.filter(u => u.def.ouvrier), collecteurs = unites.filter(u => u.def.collecteur);
  for(const u of collecteurs) u.gare = false;   // tout nouvel ordre lève l'arrêt
  let reste = unites;
  // Réparateur sur un allié qu'il ne sait pas soigner (13 novembre 2026 : l'ordre était ignoré sans
  // un mot) : on le dit, puis l'ordre suit son cours normal (déplacement).
  const motif = cible ? refusSoin(unites, cible) : null;
  if(motif) message(motif);
  if(cible && hostile(campJoueur,cible.camp)){
    const att = unites.filter(u => u.def.arme && peutCibler(u, cible));
    for(const u of att){ u.ordre = {type:'attaquer', cible}; u.cible = cible; u.chemin = null; }
    reste = unites.filter(u => !att.includes(u));
    effet('ordre', {x:cible.x, y:cible.y, duree:0.5, couleur:'#ff6b4a'});
  } else if(n && collecteurs.length){
    // Collecteurs sur un champ de minerai : ils y récoltent (les autres unités s'y rendent).
    for(const u of collecteurs){ u.ordre = ordreRecolte(n); if(u.charge >= u.def.capacite) u.ordre.retour = true; u.chemin = null; }
    reste = unites.filter(u => !u.def.collecteur);
    effet('ordre', {x:n.x, y:n.y, duree:0.5, couleur:'#5fc3e4'});
  } else if(cible && unites.some(u => u.def.repare && peutSoigner(u, cible))){
    // Réparateurs sur un allié blessé (unité ou bâtiment) : ils vont le soigner ; les autres s'y rendent.
    const soignants = unites.filter(u => u.def.repare && peutSoigner(u, cible));
    for(const u of soignants){ u.ordre = {type:'soigner', cible}; u.cibleSoin = cible; u.chemin = null; }
    reste = unites.filter(u => !soignants.includes(u));
    effet('ordre', {x:cible.x, y:cible.y, duree:0.5, couleur:'#7dff8a'});
  } else if(cible && cible.camp === campJoueur && cible.est === 'batiment' && cible.enCours && ouvriers.length){
    for(const u of ouvriers){ u.ordre = {type:'construire', bat:cible}; u.chemin = null; }
    reste = unites.filter(u => !u.def.ouvrier);
  } else if(cible && cible.camp === campJoueur && cible.est === 'batiment' && !cible.enCours && cible.pv < cible.pvMax && ouvriers.length){
    for(const u of ouvriers){ u.ordre = {type:'reparer', bat:cible}; u.chemin = null; }
    reste = unites.filter(u => !u.def.ouvrier);
    effet('ordre', {x:cible.x, y:cible.y, duree:0.5, couleur:'#7dff8a'});
  } else if(cible && cible.camp === campJoueur && cible.est === 'batiment' && cible.def.depot && !cible.enCours && collecteurs.some(u => u.charge > 0)){
    // Collecteurs sur un dépôt : ils rentrent décharger, puis reprennent la récolte.
    for(const u of collecteurs){ const o = u.ordre && u.ordre.type === 'recolter' ? u.ordre : (u.ordre = ordreRecolte(champPour(u))); o.retour = u.charge > 0; u.chemin = null; }
    reste = unites.filter(u => !u.def.collecteur);
  }
  if(n && ouvriers.length && !collecteurs.length) message('Les ouvriers ne récoltent pas : produisez des collecteurs au QG.');
  if(reste.length){
    ordonnerFormation(reste, x, y, 'aller');
    effet('ordre', {x, y, duree:0.5, couleur:'#7dff8a'});
  }
}
function ordreAttaqueDeplacement(x, y, cible){
  const unites = selection.filter(e => e.camp === campJoueur && e.est === 'unite' && !e.def.ouvrier && (e.def.arme || e.def.repare));
  if(cible && hostile(campJoueur,cible.camp)){ for(const u of unites) if(u.def.arme && peutCibler(u, cible)){ u.ordre = {type:'attaquer', cible}; u.cible = cible; } }
  else ordonnerFormation(unites, x, y, 'attaqueDeplacement');
  effet('ordre', {x, y, duree:0.5, couleur:'#ff6b4a'});
}
function tenterPlacement(){
  const {c, r} = cellulePlacement(), D = BATIMENTS[mode.bat];
  if(!emplacementValide(mode.bat, c, r, false)){ message('Emplacement impossible.', 'alerte'); return; }
  if(camps[campJoueur].reserves < D.cout){ message('Réserves insuffisantes.', 'alerte'); return; }
  const D2 = D.requiert && !ents.some(b => b.camp === campJoueur && b.type === D.requiert && !b.enCours && !b.mort);
  if(D2){ message('Nécessite : ' + BATIMENTS[D.requiert].nom + '.', 'alerte'); mode = null; return; }
  let ouvriers = selection.filter(e => e.camp === campJoueur && e.est === 'unite' && e.def.ouvrier);
  // Sans ouvrier sélectionné (barre de construction) : l'ouvrier libre le plus proche du chantier.
  if(!ouvriers.length){
    const o = ouvrierPour((c + D.taille/2)*TUILE, (r + D.taille/2)*TUILE);
    if(!o){ message('Aucun ouvrier pour construire : formez-en un au QG (onglet Infanterie).', 'alerte'); mode = null; return; }
    ouvriers = [o];
  }
  construireBatiment(campJoueur, mode.bat, c, r, ouvriers);
  if(!touches.Shift) mode = null;
}

cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  if(!enJeu || partieFinie || surprise.gel) return;
  const m = versMonde(e.clientX, e.clientY);
  souris.mx = m.x; souris.my = m.y;
  if(e.button === 0){
    if(mode && mode.type === 'placer'){ tenterPlacement(); return; }
    if(mode && mode.type === 'pouvoir'){ if(activerPouvoir(campJoueur, mode.cle, m.x, m.y)) mode = null; return; }
    if(mode && mode.type === 'attaque'){ ordreAttaqueDeplacement(m.x, m.y, entiteSousEcran(e.clientX, e.clientY)); mode = null; return; }
    souris.bas = true; souris.dx = e.clientX; souris.dy = e.clientY;
  } else if(e.button === 2){
    if(mode){ mode = null; return; }
    ordreDroit(m.x, m.y, entiteSousEcran(e.clientX, e.clientY));
  }
});
addEventListener('mouseup', e => {
  if(e.button !== 0 || !souris.bas) return;
  souris.bas = false;
  if(Math.abs(souris.x-souris.dx) > 5 || Math.abs(souris.y-souris.dy) > 5){
    const x0 = Math.min(souris.x,souris.dx), x1 = Math.max(souris.x,souris.dx), y0 = Math.min(souris.y,souris.dy), y1 = Math.max(souris.y,souris.dy);
    let liste = ents.filter(u => {
      if(u.camp !== campJoueur || u.est !== 'unite') return false;
      const p = surEcran(u);
      return p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    });
    // Cadre de sélection : les combattants passent avant les ouvriers et les collecteurs.
    if(liste.some(u => u.def.arme)) liste = liste.filter(u => u.def.arme || u.def.repare);   // réparateurs : suivent l'armée
    else if(liste.some(u => !u.def.ouvrier)) liste = liste.filter(u => !u.def.ouvrier);
    if(e.shiftKey) liste = [...new Set([...selection.filter(s => s.est === 'unite'), ...liste])];
    selectionner(liste);
  } else {
    const cible = entiteSousEcran(souris.x, souris.y);
    if(!cible) selectionner([]);
    else if(e.shiftKey && cible.camp === campJoueur && cible.est === 'unite' && selection.every(s => s.camp === campJoueur && s.est === 'unite')){
      selectionner(selection.includes(cible) ? selection.filter(s => s !== cible) : [...selection, cible]);
    } else if(e.detail >= 2 && cible.camp === campJoueur && cible.est === 'unite'){
      selectionner(ents.filter(u => {
        if(u.camp !== campJoueur || u.type !== cible.type) return false;
        const p = surEcran(u); return p && p.x > 0 && p.x < largEcran && p.y > 0 && p.y < hautEcran;
      }));
    } else selectionner([cible]);
  }
});
addEventListener('mousemove', e => {
  souris.x = e.clientX; souris.y = e.clientY; souris.dedans = true; souris.sortie = null;
  souris.surInterface = e.target !== cv;   // barre, panneau, minicarte, bandeau... (le calque 2D ne capte rien)
  if(window.R3D && R3D.vue){ const m = versMonde(souris.x, souris.y); souris.mx = m.x; souris.my = m.y; }
  if(souris.miniBas) deplacerCameraMini(e);
});
document.addEventListener('mouseleave', () => { souris.dedans = false; });
document.addEventListener('mouseout', e => {   // curseur sorti de la fenêtre
  if(e.relatedTarget) return;
  souris.dedans = false;
  // Sorti par un bord (hors plein écran : onglets du navigateur en haut, barre des tâches en bas) : le
  // défilement continue quelques secondes dans ce sens, comme si le curseur poussait encore le bord.
  const dx = e.clientX <= 2 ? -1 : e.clientX >= innerWidth - 2 ? 1 : 0, dy = e.clientY <= 2 ? -1 : e.clientY >= innerHeight - 2 ? 1 : 0;
  souris.sortie = (dx || dy) ? {dx, dy, t:performance.now()} : null;
});
addEventListener('blur', () => { souris.dedans = false; souris.sortie = null; });
let survolT = 0;
cv.addEventListener('mousemove', e => {
  if(!enJeu) return;
  const t = performance.now(); if(t - survolT < 80) return; survolT = t;
  const c = entiteSousEcran(e.clientX, e.clientY);
  cv.style.cursor = mode ? 'crosshair' : (c && hostile(campJoueur,c.camp) && selection.some(s => s.camp === campJoueur && s.est === 'unite')) ? 'crosshair' : (c ? 'pointer' : 'default');
});
// Zoom : multiplie la distance de la caméra, entre les bornes de la vue (les mêmes pour la molette et le clavier).
function zoomer(facteur){
  const v = R3D.vue;
  v.distance = Math.max(v.distanceMin, Math.min(v.distanceMax, v.distance * facteur));
}
cv.addEventListener('wheel', e => {
  e.preventDefault();
  if(!enJeu) return;
  zoomer(e.deltaY > 0 ? 1.12 : 1/1.12);
}, {passive:false});
// Zoom au clavier : + et - (rangée principale et pavé numérique), Page précédente / Page suivante.
// Les touches enfoncées sont suivies par leur position physique (e.code), pour qu'un relâchement de
// Maj avant la touche ne laisse pas le zoom bloqué ; le sens vient du caractère (e.key), qui dépend
// de la disposition du clavier (« = » est la touche « + » sans Maj sur un clavier belge ou américain).
// Valeur : -1 = rapprocher, +1 = éloigner. Zoom progressif, appliqué à chaque image (zoomClavier).
const touchesZoom = {};
const ZOOM_CLAVIER = 1.15;   // la distance est multipliée ou divisée par e^ZOOM_CLAVIER par seconde (environ x 3)
function sensZoomTouche(e){
  if(e.ctrlKey || e.metaKey || e.altKey) return 0;            // Ctrl + « + » : zoom du navigateur
  if(e.code === 'NumpadAdd' || e.key === '+' || e.key === '=' || e.key === 'PageUp') return -1;
  if(e.code === 'NumpadSubtract' || e.key === '-' || e.key === 'PageDown') return 1;
  return 0;
}
function zoomClavier(dt){
  let sens = 0;
  for(const code in touchesZoom) sens += touchesZoom[code];
  if(sens) zoomer(Math.exp(Math.sign(sens) * ZOOM_CLAVIER * dt));
}
addEventListener('blur', () => { for(const code in touchesZoom) delete touchesZoom[code]; });
function deplacerCameraMini(e){
  const r = miniCv.getBoundingClientRect();
  R3D.vue.x = (e.clientX - r.left)/ECH; R3D.vue.y = (e.clientY - r.top)/ECH;
  bornerCamera();
}
miniCv.addEventListener('contextmenu', e => e.preventDefault());
miniCv.addEventListener('mousedown', e => {
  const r = miniCv.getBoundingClientRect();
  if(e.button === 0){ souris.miniBas = true; deplacerCameraMini(e); }
  else if(e.button === 2) ordreDroit((e.clientX - r.left)/ECH, (e.clientY - r.top)/ECH);
});
addEventListener('mouseup', () => { souris.miniBas = false; });

addEventListener('keydown', e => {
  touches[e.key] = true;
  const k = e.key.toLowerCase();
  if(k === 'm' && !e.ctrlKey && !e.altKey && !e.metaKey && !(e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range')){
    basculerMusique(); return;
  }
  if(e.key === 'F8'){ e.preventDefault(); reglerAffichagePerf(!afficherPerf, true); return; }   // affichage des performances
  if(!enJeu || partieFinie) return;
  // Mode Surprises : Échap ou Espace passe la cinématique ; rien d'autre pendant la cinématique ou le dialogue.
  if(surprise.gel){
    if(surprise.etat === 'cinematique' && (k === 'escape' || k === ' ')){ e.preventDefault(); passerCinematique(); }
    return;
  }
  // Zoom au clavier (voir zoomClavier). Pas dans un champ de saisie ; sur le curseur de volume,
  // seules les touches Page sont laissées au curseur (elles en changent la valeur).
  const sensZoom = sensZoomTouche(e), champ = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) ? e.target : null;
  if(sensZoom && (!champ || (champ.type === 'range' && !e.key.startsWith('Page')))){
    touchesZoom[e.code || e.key] = sensZoom;
    e.preventDefault();
    return;
  }
  const fn = /^F([1-4])$/.exec(e.key);
  if(fn && !e.ctrlKey && !e.altKey && !e.metaKey){ e.preventDefault(); choisirOngletFab(ONGLETS_FAB[+fn[1] - 1].cle); return; }
  if(k === 'escape'){ mode = null; }
  else if(k === 'p'){ basculerPause(); }
  else if(k === 's'){ arreter(); }
  else if(k === 'a'){ if(selection.some(u => u.camp === campJoueur && u.est === 'unite' && (u.def.arme || u.def.repare) && !u.def.ouvrier)) mode = {type:'attaque'}; }
  else if(k === 'h'){ const q = ents.find(b => b.camp === campJoueur && b.type === 'qg'); if(q) centrerSur(q.x, q.y); }
  else if(k === ' '){ e.preventDefault(); if(temps - alerte.t < 60) centrerSur(alerte.x, alerte.y); }
  else if(k === 'o' && MISSION){ basculerObjectifs(); }
  else if(/^[1-9]$/.test(e.key)){
    if(e.ctrlKey){ e.preventDefault(); groupes[e.key] = selection.filter(s => s.camp === campJoueur && s.est === 'unite'); message('Groupe ' + e.key + ' enregistré.'); }
    else { const g = groupes[e.key] = (groupes[e.key]||[]).filter(u => !u.mort); if(g.length) selectionner(g); }
  }
  if(e.key.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => { touches[e.key] = false; delete touchesZoom[e.code || e.key]; });

function centrerSur(x, y){ R3D.vue.x = x; R3D.vue.y = y; bornerCamera(); }
function bornerCamera(){
  const v = R3D.vue;
  v.x = Math.max(0, Math.min(LARG, v.x));
  v.y = Math.max(0, Math.min(HAUT + 200, v.y));
}
// Défilement au bord (option du menu, activée par défaut, mémorisée) : la vue suit le curseur qui touche
// un bord de la fenêtre, diagonales comprises, à une vitesse proportionnée au zoom (comme les flèches).
// Sur la vue 3D, la bande sensible fait BORD_DEFILEMENT px. Sur l'interface (barre du haut, panneau du
// bas, minicarte), seule la toute dernière bande de BORD_INTERFACE px compte : le curseur poussé contre
// le bord de l'écran fait défiler, mais viser un bouton de la barre ou du panneau ne déplace jamais la
// vue (la barre du haut couvre tout le bord supérieur : sans cette bande, impossible de remonter).
// Jamais pendant une pause, un dialogue, une cinématique, ni quand le curseur a quitté la fenêtre.
const BORD_DEFILEMENT = 15, BORD_INTERFACE = 6, SORTIE_DEFILEMENT = 4;   // px, px, secondes
const CLE_DEFILEMENT = 'frontDeSel.defilementBord';
let defilementBord = true;
try { defilementBord = localStorage.getItem(CLE_DEFILEMENT) !== 'non'; } catch(err){ /* sans mémorisation */ }
function reglerDefilementBord(oui){
  defilementBord = !!oui;
  try { localStorage.setItem(CLE_DEFILEMENT, oui ? 'oui' : 'non'); } catch(err){}
}
function dialogueOuvert(){
  return ['aide', 'alliance', 'fin', 'menu'].some(id => { const d = el(id); return d && !d.classList.contains('cache'); });
}
// Direction du défilement au bord (fonction pure) : position du curseur, taille de la fenêtre, curseur
// sur l'interface ou non -> {dx, dy} dans {-1, 0, 1}.
function sensBord(x, y, larg, haut, surInterface){
  const m = surInterface ? BORD_INTERFACE : BORD_DEFILEMENT;
  return {dx: x < m ? -1 : x >= larg - m ? 1 : 0, dy: y < m ? -1 : y >= haut - m ? 1 : 0};
}
function deplacerCamera(dt){
  const v = R3D.vue.distance*1.1*dt; let dx = 0, dy = 0;
  if(touches.ArrowLeft) dx -= v; if(touches.ArrowRight) dx += v;
  if(touches.ArrowUp) dy -= v; if(touches.ArrowDown) dy += v;
  if(defilementBord && souris.dedans && document.hasFocus() && !enPause && !partieFinie && !surprise.gel && !dialogueOuvert()){
    const s = sensBord(souris.x, souris.y, innerWidth, innerHeight, souris.surInterface);
    // Diagonale : même vitesse que sur un seul axe.
    const k = s.dx && s.dy ? Math.SQRT1_2 : 1;
    dx += s.dx*v*k; dy += s.dy*v*k;
  } else if(defilementBord && souris.sortie && document.hasFocus() && !enPause && !partieFinie && !surprise.gel && !dialogueOuvert()){
    const s = souris.sortie;
    if(performance.now() - s.t > SORTIE_DEFILEMENT*1000) souris.sortie = null;
    else { const k = s.dx && s.dy ? Math.SQRT1_2 : 1; dx += s.dx*v*k; dy += s.dy*v*k; }
  }
  R3D.vue.x += dx; R3D.vue.y += dy; bornerCamera();
  zoomClavier(dt);
}
function basculerPause(){ enPause = !enPause; el('bPause').textContent = enPause ? 'Reprendre (P)' : 'Pause (P)'; }

// =====================================================================
//  12. MOTEUR DE MISSIONS
//  Une mission (campagnes/<id>.js) décrit le départ, les objectifs et des
//  déclencheurs « quand condition, faire actions ». Le moteur est tolérant :
//  un élément mal écrit est ignoré avec un avertissement en console.
// =====================================================================
let MISSION = null;
const MS = {
  objectifs:[], declencheurs:[], sequences:[], zones:[],
  radio:{file:[], courant:null, finT:0},
  recolte:0, etiquettes:{}, vivants:{}, avertis:new Set(), autorises:null,
  debloques:new Set(),   // « genre:type » réservés à l'escarmouche et ouverts par « deverrouiller » (voir autorise)
  evalT:0, fin:null, victoireDepuis:null, objectifsReplies:false, idsPrevus:new Set(),
};
// Objectifs « de maintien » : satisfaits tant qu'ils n'ont pas échoué.
const TYPES_MAINTIEN = ['proteger'];
const TYPES_OBJECTIFS = ['detruireTout','detruire','proteger','survivre','atteindre','escorter','construire','tenir','recolter'];

function avertir(element, texte){
  const cle = element + '|' + texte;
  if(MS.avertis.has(cle)) return;
  MS.avertis.add(cle);
  console.warn('[Mission ' + (MISSION ? MISSION.id : '?') + '] ' + element + ' : ' + texte);
}
function etiqueter(e, nom){
  if(nom == null || nom === '') return;
  e.nom = String(nom);
  const s = MS.etiquettes[e.nom] || (MS.etiquettes[e.nom] = {total:0, pvMaxTotal:0});
  s.total++;
  s.pvMaxTotal += e.pvMax || 0;   // sert à pvSous « ensemble » (les entités détruites comptent pour 0 PV)
}
// Index des entités vivantes par étiquette (recalculé à chaque évaluation).
function indexerEtiquettes(){
  const v = {};
  for(const e of ents) if(!e.mort && e.nom) (v[e.nom] || (v[e.nom] = [])).push(e);
  MS.vivants = v;
}
const vivantsDe = nom => MS.vivants[nom] || [];
function zoneValide(z, ctx){
  if(z && isFinite(z.x) && isFinite(z.y) && z.r > 0) return true;
  avertir(ctx, 'zone invalide (attendu {x, y, r}) : ' + JSON.stringify(z));
  return false;
}
const dansZone = (e, z) => Math.hypot(e.x - z.x, e.y - z.y) <= z.r + (e.est === 'batiment' ? e.rayon*0.5 : 0);
// Unités (et, avec une étiquette, entités) d'un camp ou d'une étiquette dans une zone.
function compterDansZone(z, camp, nom){
  let n = 0;
  if(nom){ for(const e of vivantsDe(nom)) if(dansZone(e, z)) n++; return n; }
  for(const e of ents) if(!e.mort && e.est === 'unite' && e.camp === camp && dansZone(e, z)) n++;
  return n;
}
function batimentsFinis(camp, type){ return ents.filter(e => !e.mort && e.est === 'batiment' && e.camp === camp && e.type === type && !e.enCours).length; }
function campAEntite(camp, est){ return ents.some(e => !e.mort && e.camp === camp && e.est === est); }
const listeOuVide = v => Array.isArray(v) ? v : [];
const pointDe = p => Array.isArray(p) ? {x:p[0], y:p[1]} : (p && isFinite(p.x) && isFinite(p.y) ? {x:p.x, y:p.y} : null);
const CAMPS_VALIDES = ['J','I','N'];

// ---------- Conditions ----------
function evaluerCondition(q, ctx){
  try {
    if(!q || typeof q !== 'object'){ avertir(ctx, 'condition absente ou invalide'); return false; }
    if('tous' in q) return listeOuVide(q.tous).every(c => evaluerCondition(c, ctx));
    if('un' in q) return listeOuVide(q.un).some(c => evaluerCondition(c, ctx));
    if('temps' in q) return temps >= nombre(q.temps, 0);
    if('zone' in q){
      if(!zoneValide(q.zone, ctx)) return false;
      return compterDansZone(q.zone, q.camp || 'J', q.nom) >= nombre(q.nombre, 1);
    }
    if('detruit' in q){
      const s = MS.etiquettes[q.detruit];
      return !!s && s.total > 0 && vivantsDe(q.detruit).length === 0;
    }
    if('pvSous' in q){
      // Par défaut : vrai dès qu'UNE entité du groupe passe sous le seuil (ou est détruite).
      // Avec « ensemble: true » : PV cumulés du groupe / PV max cumulés (détruites à 0 PV).
      const p = q.pvSous || {}, s = MS.etiquettes[p.nom];
      if(!s) return false;
      const v = vivantsDe(p.nom), ratio = nombre(p.ratio, 0.5);
      if(p.ensemble === true){
        if(!(s.pvMaxTotal > 0)) return false;
        return v.reduce((t, e) => t + Math.max(0, e.pv), 0) / s.pvMaxTotal < ratio;
      }
      if(p.ensemble !== undefined && p.ensemble !== false) avertir(ctx, 'pvSous : « ensemble » attend true ou false');
      return v.length < s.total || v.some(e => e.pv / e.pvMax < ratio);
    }
    if('objectif' in q){
      const o = MS.objectifs.find(x => x.id === q.objectif);
      if(!o){ if(!MS.idsPrevus.has(q.objectif)) avertir(ctx, 'objectif inconnu « ' + q.objectif + ' »'); return false; }
      return o.etat === (q.etat || 'reussi');
    }
    if('campSansBatiment' in q) return !campAEntite(q.campSansBatiment, 'batiment');
    if('campSansUnite' in q) return !campAEntite(q.campSansUnite, 'unite');
    if('construit' in q){
      const c = q.construit || {};
      return batimentsFinis(c.camp || 'J', c.type) >= nombre(c.nombre, 1);
    }
    if('declencheur' in q){
      const d = MS.declencheurs.find(x => x.id === q.declencheur);
      if(!d){ avertir(ctx, 'déclencheur inconnu « ' + q.declencheur + ' »'); return false; }
      return d.executeT != null && temps >= d.executeT + nombre(q.delai, 0);
    }
    avertir(ctx, 'condition inconnue : ' + JSON.stringify(q));
    return false;
  } catch(err){
    avertir(ctx, 'erreur dans la condition ' + JSON.stringify(q) + ' — ' + err.message);
    return false;
  }
}

// ---------- Objectifs ----------
function creerObjectif(def, visible){
  return {id:def.id, def, etat:'actif', visible, debut: visible ? temps : null, cumul:0, arrives:new Set(), nouveauT: visible ? temps : -99};
}
function principal(o){ return o.def.principal !== false; }
function changerEtat(o, etat){
  if(o.etat !== 'actif') return;
  if(MS.fin) return;   // issue de la mission acquise : les objectifs sont figés
  o.etat = etat; o.finT = temps;
  if(!o.visible){ o.visible = true; o.debut = temps; }
  message((etat === 'reussi' ? 'Objectif accompli : ' : 'Objectif échoué : ') + (o.def.texte || o.id), etat === 'reussi' ? 'succes' : 'alerte');
  majObjectifsDOM(true);
}
function ajouterObjectif(def, ctx){
  if(!def || typeof def !== 'object' || !def.id){ avertir(ctx, 'objectif sans identifiant'); return; }
  const existant = MS.objectifs.find(o => o.id === def.id);
  if(existant){
    if(existant.visible){ avertir(ctx, 'objectif « ' + def.id + ' » déjà affiché'); return; }
    Object.assign(existant.def, def);
    existant.visible = true; existant.debut = temps; existant.nouveauT = temps;
  } else {
    if(!TYPES_OBJECTIFS.includes(def.type)) avertir(ctx, 'type d’objectif inconnu « ' + def.type + ' »');
    MS.objectifs.push(creerObjectif(def, true));
  }
  const d = existant ? existant.def : def;
  message('Nouvel objectif : ' + (d.texte || d.id), 'succes');
  majObjectifsDOM(true);
}
const typeConstruit = D => D.batiment || D.typeBatiment || (D.type !== 'construire' ? D.type : null);
function evaluerObjectif(o, dt){
  const D = o.def, ctx = 'objectif « ' + o.id + ' »';
  switch(D.type){
    case 'detruireTout':
      if(!campAEntite(D.camp || 'I', 'batiment')) changerEtat(o, 'reussi');
      break;
    case 'detruire': {
      const s = MS.etiquettes[D.nom];
      if(!s){ avertir(ctx, 'aucune entité étiquetée « ' + D.nom + ' » pour l’instant'); break; }
      if(!vivantsDe(D.nom).length) changerEtat(o, 'reussi');
      break;
    }
    case 'proteger': {
      const s = MS.etiquettes[D.nom];
      if(!s){ avertir(ctx, 'aucune entité étiquetée « ' + D.nom + ' » pour l’instant'); break; }
      if(vivantsDe(D.nom).length < nombre(D.minimum, s.total)) changerEtat(o, 'echoue');
      break;
    }
    case 'survivre':
      if(temps - o.debut >= nombre(D.duree, 60)) changerEtat(o, 'reussi');
      break;
    case 'atteindre':
      if(!zoneValide(D.zone, ctx)) break;
      if(compterDansZone(D.zone, D.camp || 'J', D.nom) >= nombre(D.nombre, 1)) changerEtat(o, 'reussi');
      break;
    case 'escorter': {
      if(!zoneValide(D.zone, ctx)) break;
      const s = MS.etiquettes[D.nom];
      if(!s){ avertir(ctx, 'aucune entité étiquetée « ' + D.nom + ' » pour l’instant'); break; }
      const v = vivantsDe(D.nom);
      for(const e of v) if(dansZone(e, D.zone)) o.arrives.add(e.id);
      const min = Math.min(nombre(D.minimum, s.total), s.total);
      if(o.arrives.size >= min) changerEtat(o, 'reussi');
      else {
        const possibles = new Set(o.arrives); for(const e of v) possibles.add(e.id);
        if(possibles.size < min) changerEtat(o, 'echoue');
      }
      break;
    }
    case 'construire':
      // Le type de bâtiment est dans « batiment » (« type » désigne déjà le genre d'objectif).
      if(!BATIMENTS[typeConstruit(D)]){ avertir(ctx, 'bâtiment à construire inconnu (champ « batiment ») : ' + typeConstruit(D)); break; }
      if(batimentsFinis('J', typeConstruit(D)) >= nombre(D.nombre, 1)) changerEtat(o, 'reussi');
      break;
    case 'tenir': {
      if(!zoneValide(D.zone, ctx)) break;
      const amis = compterDansZone(D.zone, campJoueur);
      const ennemis = ents.some(e => !e.mort && e.est === 'unite' && e.camp !== campJoueur && hostile(e.camp, campJoueur) && e.def.arme && dansZone(e, D.zone));
      o.conteste = amis > 0 && ennemis;
      if(amis > 0 && !ennemis) o.cumul += dt;
      if(o.cumul >= nombre(D.duree, 60)) changerEtat(o, 'reussi');
      break;
    }
    case 'recolter':
      if(MS.recolte >= nombre(D.montant, 1000)) changerEtat(o, 'reussi');
      break;
    default:
      avertir(ctx, 'type d’objectif inconnu « ' + D.type + ' »');
  }
}

// ---------- Actions ----------
function placerUnites(camp, type, nb, x, y, ordre, nom, ctx){
  if(!UNITES[type]){ avertir(ctx, 'type d’unité inconnu « ' + type + ' »'); return []; }
  const res = [], n = Math.max(1, Math.round(nombre(nb, 1))), w = Math.ceil(Math.sqrt(n)), esp = 28;
  for(let i=0;i<n;i++){
    const ox = (i%w - (w-1)/2)*esp, oy = (Math.floor(i/w) - (Math.ceil(n/w)-1)/2)*esp;
    const p = UNITES[type].aerien ? {x:x+ox, y:y+oy} : pointLibre(x+ox, y+oy);
    const u = creerUnite(type, camp, Math.max(4, Math.min(LARG-4, p.x)), Math.max(4, Math.min(HAUT-4, p.y)));
    etiqueter(u, nom);
    if(ordre && (ordre.type === 'aller' || ordre.type === 'attaqueDeplacement') && isFinite(ordre.x) && isFinite(ordre.y)){
      u.ordre = {type:ordre.type, x:ordre.x + ox, y:ordre.y + oy};
      if(camp === 'I' && ordre.type === 'attaqueDeplacement') u.enVague = true;
    } else if(ordre) avertir(ctx, 'ordre invalide : ' + JSON.stringify(ordre));
    res.push(u);
  }
  return res;
}
function placerBatiment(camp, entree, ctx){
  const B = BATIMENTS[entree.type];
  if(!B){ avertir(ctx, 'type de bâtiment inconnu « ' + entree.type + ' »'); return null; }
  const c = Math.round(nombre(entree.c, -1)), r = Math.round(nombre(entree.r, -1));
  if(c < 0 || r < 0 || c + B.taille > COLS || r + B.taille > LIGNES){ avertir(ctx, 'bâtiment hors carte : ' + JSON.stringify(entree)); return null; }
  for(let rr=r; rr<r+B.taille; rr++) for(let cc=c; cc<c+B.taille; cc++)
    if(grille[rr*COLS+cc] === 3){ avertir(ctx, 'bâtiment posé sur un autre : ' + JSON.stringify(entree)); return null; }
  const b = creerBatiment(entree.type, camp, c, r, entree.fini !== false);
  etiqueter(b, entree.nom);
  return b;
}
function campValide(camp, ctx){
  if(CAMPS_VALIDES.includes(camp) && camps[camp]) return true;
  avertir(ctx, 'camp invalide « ' + camp + ' » (attendu J, I ou N)');
  return false;
}
function executerAction(a, seq){
  const ctx = 'déclencheur « ' + seq.source + ' »';
  if(!a || typeof a !== 'object'){ avertir(ctx, 'action invalide'); return; }
  const cles = Object.keys(a);
  if(cles.length !== 1) avertir(ctx, 'une action doit avoir une seule clé : ' + JSON.stringify(a));
  const cle = cles[0], v = a[cle];
  try {
    switch(cle){
      case 'radio':
        if(!v || !v.texte){ avertir(ctx, 'radio sans texte'); break; }
        MS.radio.file.push({qui:v.qui || '', texte:String(v.texte), t:temps, seq});
        if(MS.fin) MS.fin.derniereRepliqueT = temps;   // réplique finale : le plafond se compte d'ici
        break;
      case 'attendre':
        seq.attente = Math.max(0, nombre(v, 0));
        break;
      case 'renforts': {
        if(!v || !campValide(v.camp, ctx)) break;
        const depuis = pointDe(v.depuis);
        if(!depuis){ avertir(ctx, 'renforts sans point de départ (depuis)'); break; }
        const vers = pointDe(v.vers);
        const ordre = vers ? {type:v.ordre === 'attaqueDeplacement' ? 'attaqueDeplacement' : 'aller', x:vers.x, y:vers.y} : null;
        let total = 0, k = 0;
        for(const g of listeOuVide(v.unites)){
          // Les groupes successifs sont légèrement décalés pour ne pas s'empiler.
          const dx = (k % 3 - 1)*60, dy = Math.floor(k/3)*60; k++;
          total += placerUnites(v.camp, g.type, g.nb, depuis.x + dx, depuis.y + dy, ordre && {type:ordre.type, x:ordre.x + dx, y:ordre.y + dy}, v.nom, ctx).length;
        }
        if(v.camp === campJoueur && total) message('Renforts : ' + total + ' unité' + (total > 1 ? 's' : '') + ' en approche.', 'succes');
        break;
      }
      case 'batiment':
        if(!v || !campValide(v.camp, ctx)) break;
        {
          // Premier QG d'un camp (J ou I) apparu par une action : deux collecteurs l'accompagnent.
          const sansQG = v.type === 'qg' && (v.camp === campJoueur || v.camp === 'I') && !ents.some(b => !b.mort && b.camp === v.camp && b.type === 'qg');
          const b = placerBatiment(v.camp, v, ctx);
          if(b && sansQG && !b.enCours) doterCollecteurs(v.camp, b);
        }
        break;
      case 'objectif':
        if(!v){ avertir(ctx, 'action objectif vide'); break; }
        if(v.ajouter) ajouterObjectif(v.ajouter, ctx);
        else if(v.reussir || v.echouer){
          const id = v.reussir || v.echouer, o = MS.objectifs.find(x => x.id === id);
          if(!o){ avertir(ctx, 'objectif inconnu « ' + id + ' »'); break; }
          changerEtat(o, v.reussir ? 'reussi' : 'echoue');
        } else avertir(ctx, 'action objectif sans ajouter / reussir / echouer');
        break;
      case 'reserves':
        if(!v || !campValide(v.camp, ctx)) break;
        camps[v.camp].reserves = Math.max(0, camps[v.camp].reserves + nombre(v.montant, 0));
        if(v.camp === campJoueur && nombre(v.montant, 0) > 0) message('Réserves reçues : +' + nombre(v.montant, 0) + '.', 'succes');
        break;
      case 'points':
        if(!v || !campValide(v.camp, ctx)) break;
        camps[v.camp].points = Math.max(0, camps[v.camp].points + nombre(v.montant, 0));
        break;
      case 'deverrouiller': {
        if(!v) break;
        // Sans liste « autorises », tout est déjà autorisé, sauf ce qui est réservé à l'escarmouche
        // (aéroport, avions) : ces types-là sont notés dans MS.debloques.
        const noms = [];
        const ouvrir = (genre, t, nom) => {
          const liste = MS.autorises && MS.autorises[genre];
          if(liste){ if(!liste.has(t)){ liste.add(t); noms.push(nom); } }
          else if(RESERVES_ESCARMOUCHE[genre].has(t) && !MS.debloques.has(genre + ':' + t)){ MS.debloques.add(genre + ':' + t); noms.push(nom); }
        };
        for(const t of listeOuVide(v.batiments)){
          if(!BATIMENTS[t]){ avertir(ctx, 'bâtiment inconnu « ' + t + ' »'); continue; }
          ouvrir('batiments', t, BATIMENTS[t].nom);
        }
        for(const t of listeOuVide(v.unites)){
          if(!UNITES[t]){ avertir(ctx, 'unité inconnue « ' + t + ' »'); continue; }
          ouvrir('unites', t, UNITES[t].nom);
        }
        if(noms.length) message('Nouveau : ' + noms.join(', ') + (noms.length > 1 ? ' disponibles.' : ' disponible.'), 'succes');
        signaturePanneau = '';
        break;
      }
      case 'ia':
        if(!v) break;
        configurerIA(v, true);
        break;
      case 'attaque': {
        if(!v || !campValide(v.camp, ctx)) break;
        const vers = pointDe(v.vers);
        if(!vers){ avertir(ctx, 'attaque sans destination (vers)'); break; }
        const liste = v.nom ? vivantsActuels(v.nom).filter(u => u.camp === v.camp)
                            : (v.tous ? ents.filter(e => !e.mort && e.camp === v.camp && e.est === 'unite') : []);
        if(!v.nom && !v.tous) avertir(ctx, 'attaque sans nom ni tous: true');
        const armee = liste.filter(u => u.est === 'unite' && u.def.arme && !u.def.ouvrier);
        armee.forEach(u => {
          u.ordre = {type:'attaqueDeplacement', x:vers.x + (Math.random()-.5)*90, y:vers.y + (Math.random()-.5)*90};
          u.cible = null; u.chemin = null;
          if(v.camp === 'I') u.enVague = true;
        });
        break;
      }
      case 'deplacer': {
        if(!v || !v.nom){ avertir(ctx, 'deplacer sans nom'); break; }
        const pts = listeOuVide(v.chemin).map(pointDe).filter(Boolean);
        if(!pts.length){ avertir(ctx, 'deplacer sans chemin'); break; }
        const liste = vivantsActuels(v.nom).filter(u => u.est === 'unite');
        if(!liste.length) avertir(ctx, 'aucune unité étiquetée « ' + v.nom + ' » à déplacer');
        liste.forEach((u, i) => {
          // Petit décalage par unité pour qu'un groupe ne vise pas exactement le même point.
          const ox = liste.length > 1 ? ((i%3)-1)*22 : 0, oy = liste.length > 1 ? (Math.floor(i/3)%3-1)*22 : 0;
          u.ordre = {type:'chemin', points:pts.map(p => ({x:p.x + ox, y:p.y + oy})), i:0};
          u.cible = null; u.chemin = null;
        });
        break;
      }
      case 'camera': {
        const p = pointDe(v);
        if(p) centrerSur(p.x, p.y); else avertir(ctx, 'camera sans x, y');
        break;
      }
      case 'pouvoir':
        if(!v || !campValide(v.camp, ctx)) break;
        if(!activerPouvoir(v.camp, v.cle, nombre(v.x, LARG/2), nombre(v.y, HAUT/2), true)){
          const P = (POUVOIRS[camps[v.camp].faction] || []).find(p => p.cle === v.cle);
          avertir(ctx, P ? 'pouvoir « ' + v.cle + ' » sans effet : ' + empechementPouvoir(v.camp, P, nombre(v.x, LARG/2), nombre(v.y, HAUT/2))
                         : 'pouvoir « ' + v.cle + ' » inconnu pour ce camp');
        }
        break;
      case 'zone': {
        if(!v || !v.id){ avertir(ctx, 'zone sans identifiant'); break; }
        if(!zoneValide(v, ctx)) break;
        MS.zones = MS.zones.filter(z => z.id !== v.id);
        MS.zones.push({id:v.id, x:v.x, y:v.y, r:v.r, texte:v.texte || '', couleur:v.couleur || null});
        break;
      }
      case 'zoneRetirer':
        MS.zones = MS.zones.filter(z => z.id !== v);
        break;
      case 'musique':
        jouerMusique(v);
        break;
      case 'victoire':
        if(v) finMission(true, null, seq);
        break;
      case 'defaite':
        finMission(false, typeof v === 'string' ? v : null, seq);
        break;
      default:
        avertir(ctx, 'action inconnue « ' + cle + ' »');
    }
  } catch(err){
    avertir(ctx, 'erreur dans l’action « ' + cle + ' » — ' + err.message);
  }
}
// Étiquette recalculée immédiatement (une action peut suivre une création dans la même séquence).
function vivantsActuels(nom){ return ents.filter(e => !e.mort && e.nom === nom); }

// Applique une configuration d'IA ({construit, vagues, cible, revenu}).
// depuisAction : « premiere » est alors comptée à partir de maintenant.
function configurerIA(c, depuisAction){
  if('construit' in c) ia.construit = !!c.construit;
  if('revenu' in c) ia.revenu = nombre(c.revenu, 1) * reglagesMission().revenu;
  if('cible' in c) ia.cible = pointDe(c.cible);
  if('vagues' in c){
    ia.vagues = c.vagues && typeof c.vagues === 'object' ? c.vagues : null;
    ia.nVagues = 0; ia.attenteVague = 0;
    ia.prochaineVague = ia.vagues ? (depuisAction ? temps : 0) + nombre(ia.vagues.premiere, nombre(ia.vagues.intervalle, 150)) : Infinity;
  }
}

// Une séquence d'actions bloque-t-elle encore la victoire automatique ?
function sequenceDecisive(s){
  for(let i=s.i; i<s.actions.length; i++){
    const a = s.actions[i];
    if(a && (a.objectif && a.objectif.ajouter || 'victoire' in a || 'defaite' in a)) return true;
  }
  return false;
}
// Une évaluation toutes les 0,25 s de jeu : objectifs, déclencheurs, victoire ou défaite.
function majMission(dt){
  // Séquences d'actions (à chaque image, pour que « attendre » soit précis)
  for(const s of MS.sequences){
    s.attente -= dt;
    let garde = 0;
    while(s.attente <= 0 && s.i < s.actions.length && garde++ < 200) executerAction(s.actions[s.i++], s);
  }
  MS.sequences = MS.sequences.filter(s => s.i < s.actions.length || s.attente > 0);
  MS.evalT -= dt;
  if(MS.evalT > 0 || MS.fin) return;
  const pas = 0.25 - MS.evalT; MS.evalT = 0.25;
  indexerEtiquettes();
  for(const o of MS.objectifs){
    if(!o.visible || o.etat !== 'actif') continue;
    try { evaluerObjectif(o, pas); } catch(err){ avertir('objectif « ' + o.id + ' »', 'erreur — ' + err.message); }
  }
  for(const d of MS.declencheurs){
    if(d.fait && !d.def.repetable) continue;
    const vrai = d.def.quand === undefined ? (avertir('déclencheur « ' + d.id + ' »', 'pas de condition « quand » : exécuté au départ'), true)
                                           : evaluerCondition(d.def.quand, 'déclencheur « ' + d.id + ' »');
    if(vrai && (!d.def.repetable || (!d.etaitVrai && temps - d.dernierT >= 1))){
      d.fait = true; d.executeT = temps; d.dernierT = temps;
      MS.sequences.push({actions:listeOuVide(d.def.faire), i:0, attente:0, source:d.id, t:temps});
      if(!Array.isArray(d.def.faire)) avertir('déclencheur « ' + d.id + ' »', '« faire » doit être une liste d’actions');
    }
    d.etaitVrai = vrai;
  }
  // Exécute tout de suite les séquences nouvelles (une action « objectif ajouter » ne doit pas arriver trop tard)
  for(const s of MS.sequences){ let garde = 0; while(s.attente <= 0 && s.i < s.actions.length && garde++ < 200) executerAction(s.actions[s.i++], s); }
  MS.sequences = MS.sequences.filter(s => s.i < s.actions.length || s.attente > 0);
  verifierMission();
}
function texteEchecObjectif(o){
  const D = o.def || {}, lib = String(D.texte || o.id || '').replace(/[.\s]+$/, '');
  const motif = D.type === 'proteger' ? 'Nous n’avons pas su protéger ce qu’il fallait'
    : D.type === 'escorter' ? 'L’escorte a échoué : trop de pertes en route' : 'Un objectif essentiel a échoué';
  return lib ? motif + ' (objectif : « ' + lib + ' »).' : motif + '.';
}
function verifierMission(){
  if(MS.fin) return;
  const principaux = MS.objectifs.filter(o => o.visible && principal(o));
  // Objectif principal échoué : si aucun déclencheur n'a posé la cause (finMission(false, texte) appelé
  // avant), texte par défaut tiré du libellé de l'objectif (halden-2, convois perdus : écran de fin vide avant).
  const rate = principaux.find(o => o.etat === 'echoue');
  if(rate){ finMission(false, texteEchecObjectif(rate)); return; }
  if(temps > 3 && !campAEntite('J', 'unite') && !campAEntite('J', 'batiment')){
    finMission(false, 'Toutes nos forces ont été détruites.'); return;
  }
  const aRemplir = principaux.filter(o => !TYPES_MAINTIEN.includes(o.def.type));
  const ok = aRemplir.length > 0 && aRemplir.every(o => o.etat === 'reussi') && !MS.sequences.some(sequenceDecisive);
  if(!ok){ MS.victoireDepuis = null; return; }
  if(MS.victoireDepuis == null) MS.victoireDepuis = temps;
  if(temps - MS.victoireDepuis >= 1) finMission(true);
}
// Fin de mission : l'issue est acquise dès cet appel (aucune victoire ou défaite ultérieure ne la
// renverse : finMission ne fait plus rien et les objectifs sont figés). La partie continue ensuite
// au moins FIN_DELAI_MIN s de jeu (le temps de voir l'explosion), puis jusqu'à ce que la file radio
// soit vide et le dernier message lu ; alors vient le débriefing.
// Séquences « de fin » : celle qui appelle « victoire » / « defaite » (forme « radio, victoire » ou
// « attendre, radio, victoire ») ; pour une fin automatique, celles mises en file depuis l'instant où
// la condition de fin est devenue vraie (MS.victoireDepuis ; le déclencheur « fin » d'un objectif
// réussi tombe dans la même évaluation).
// Séquences arrêtées : toutes les autres séquences en cours, sauf celles qui contiennent encore une
// action de la même issue (« victoire » pour une victoire, « defaite » pour une défaite) — plus de
// renforts, d'objectifs ni de radio hors sujet après la fin. Une séquence qui ne mène qu'à l'issue
// contraire est arrêtée aussi (sa radio annoncerait une défaite après la victoire, ou l'inverse).
// Purge radio : les messages en file qui ne viennent pas d'une séquence de fin sont retirés. Sont
// donc « répliques finales » ceux des séquences de fin et tous ceux ajoutés après la fin.
// Le message affiché, s'il n'est pas une réplique finale, est coupé au plus FIN_COUPURE s plus tard.
// Plafond : FIN_DELAI_MAX s comptées à partir du plus tard de ces deux instants : entrée en file de
// la dernière réplique finale (ou la fin s'il n'y en a pas), coupure du message en cours (s'il n'est
// pas final) ; et jamais plus de FIN_DELAI_ABSOLU s après la fin.
// Compatible avec « radio, attendre, victoire » : la réplique est alors déjà affichée et finit.
const FIN_DELAI_MIN = 2.5, FIN_DELAI_MAX = 12, FIN_DELAI_ABSOLU = 25, FIN_COUPURE = 2;
function sequenceMeneA(s, victoire){
  for(let i=s.i; i<s.actions.length; i++){
    const a = s.actions[i];
    if(!a || typeof a !== 'object') continue;
    if(victoire ? ('victoire' in a && a.victoire) : 'defaite' in a) return true;
  }
  return false;
}
function finMission(victoire, texte, seq){
  if(MS.fin || !MISSION) return;
  // Séquences de fin (voir ci-dessus).
  const seuil = !seq && victoire && MS.victoireDepuis != null ? MS.victoireDepuis : temps;
  const deFin = s => !!s && (seq ? s === seq : (s.t != null && s.t >= seuil));
  // Arrêt des autres séquences, sur place : finMission peut être appelée depuis la boucle des séquences.
  for(const s of MS.sequences){
    if(deFin(s) || sequenceMeneA(s, victoire)) continue;
    s.i = s.actions.length; s.attente = 0; s.arretee = true;
  }
  const finale = e => !!e && deFin(e.seq);
  const R = MS.radio;
  R.file = R.file.filter(finale);
  let coupureT = null;
  if(R.courant && !finale(R.courant)){ R.finT = Math.min(R.finT, temps + FIN_COUPURE); coupureT = R.finT; }
  let derniere = null;
  for(const e of R.file) derniere = derniere == null ? e.t : Math.max(derniere, e.t);
  if(R.courant && finale(R.courant)) derniere = derniere == null ? R.courant.t : Math.max(derniere, R.courant.t);
  MS.fin = {victoire, texte:texte || null, tJeu:temps, immediat:false, derniereRepliqueT:derniere, coupureT};
  message(victoire ? 'Mission accomplie.' : 'Mission échouée.', victoire ? 'succes' : 'alerte');
  if(victoire) enregistrerVictoire(MISSION.id, temps);
}
// Le débriefing peut-il s'afficher ? (appelé par la logique ET par la boucle d'affichage)
function debriefingPret(){
  const f = MS.fin;
  if(!f) return false;
  if(f.immediat) return true;   // abandon : tout de suite
  const ecoule = temps - f.tJeu;
  if(ecoule >= FIN_DELAI_ABSOLU) return true;
  const repere = Math.max(f.tJeu, f.derniereRepliqueT != null ? f.derniereRepliqueT : f.tJeu, f.coupureT != null ? f.coupureT : f.tJeu);
  if(temps - repere >= FIN_DELAI_MAX) return true;
  if(ecoule < FIN_DELAI_MIN) return false;
  const R = MS.radio;
  return !R.file.length && (!R.courant || temps >= R.finT);
}
function verifierDebriefing(){
  if(MISSION && MS.fin && !partieFinie && debriefingPret()) afficherDebriefing();
}

// Départ d'une mission : camps, IA, entités, objectifs, déclencheurs.
function demarrerMission(){
  const M = MISSION, R = M.reserves || {};
  const facJ = FACTIONS[M.joueur] ? M.joueur : 'halden';
  const facI = FACTIONS[M.adversaire] ? M.adversaire : (facJ === 'halden' ? 'karsk' : 'halden');
  if(facJ !== M.joueur) avertir('mission', 'faction du joueur inconnue « ' + M.joueur + ' »');
  if(facI !== M.adversaire) avertir('mission', 'faction adverse inconnue « ' + M.adversaire + ' »');
  // Missions : toujours J (le joueur) contre I (l'ordinateur), sans équipe ni couleur de camp.
  camps = {};
  reinitialiserIA();
  secoursCamps = new Set(); secoursT = 0;   // revenu de secours (voir revenuSecours)
  campJoueur = 'J';
  camps.J = {id:'J', faction:facJ, reserves:nombre(R.J, 1000), points:0, recharges:{}, ia:false};
  camps.I = {id:'I', faction:facI, reserves:nombre(R.I, 1000), points:0, recharges:{}, ia:true};
  camps.N = {id:'N', faction:'neutre', reserves:0, points:0, recharges:{}};
  RELATIONS = Object.assign({}, M.relations || {});
  popMax = Math.max(5, Math.round(nombre(M.popMax, 60)));
  const P = M.pouvoirs;
  pouvoirsActifs = P && typeof P === 'object' ? {J:P.J !== false, I:P.I !== false} : {J:P !== false, I:P !== false};
  MS.autorises = null; MS.debloques = new Set();
  if(M.autorises){
    MS.autorises = {
      batiments: Array.isArray(M.autorises.batiments) ? new Set(M.autorises.batiments) : null,
      unites: Array.isArray(M.autorises.unites) ? new Set(M.autorises.unites) : null,
    };
  }
  // IA
  const diff = reglagesMission();
  ia.active = true; ia.construit = false; ia.vagues = null; ia.cible = null; ia.prochaineVague = Infinity;
  ia.revenu = diff.revenu;
  configurerIA(Object.assign({construit:false, revenu:1}, M.ia || {}), false);
  // Départ
  const depart = M.depart || {};
  for(const camp of CAMPS_VALIDES){
    for(const e of listeOuVide(depart[camp])){
      const ctx = 'départ ' + camp;
      if(!e || !e.type){ avertir(ctx, 'entrée sans type'); continue; }
      if(BATIMENTS[e.type] && e.c != null) placerBatiment(camp, e, ctx);
      else if(UNITES[e.type]) placerUnites(camp, e.type, e.nb, nombre(e.x, LARG/2), nombre(e.y, HAUT/2), e.ordre, e.nom, ctx);
      else avertir(ctx, 'type inconnu « ' + e.type + ' » (ou bâtiment sans c, r)');
    }
  }
  // Économie à collecteurs (novembre 2026) : tout camp qui a un QG reçoit deux collecteurs près de lui,
  // s'il y a des champs de minerai sur la carte. Ils ne portent pas d'étiquette (ni objectif ni script).
  for(const camp of ['J', 'I']){
    const qg = ents.find(b => !b.mort && b.camp === camp && b.type === 'qg');
    if(qg) doterCollecteurs(camp, qg);
  }
  stats.produites = 0;
  // Objectifs et déclencheurs
  MS.objectifs = [];
  for(const d of listeOuVide(M.objectifs)){
    if(!d || !d.id){ avertir('objectifs', 'objectif sans identifiant ignoré'); continue; }
    if(!TYPES_OBJECTIFS.includes(d.type)) avertir('objectif « ' + d.id + ' »', 'type inconnu « ' + d.type + ' »');
    MS.objectifs.push(creerObjectif(Object.assign({}, d), !d.cache));
  }
  MS.declencheurs = listeOuVide(M.declencheurs).map((d, i) => ({def:d || {}, id:(d && d.id) || ('declencheur-' + (i+1)),
    fait:false, executeT:null, etaitVrai:false, dernierT:-99}));
  MS.evalT = 0;
  // Identifiants d'objectifs connus (déclarés ou ajoutés plus tard par une action) : évite les faux avertissements.
  MS.idsPrevus = new Set(MS.objectifs.map(o => o.id));
  for(const d of MS.declencheurs) for(const a of listeOuVide(d.def.faire))
    if(a && a.objectif && a.objectif.ajouter && a.objectif.ajouter.id) MS.idsPrevus.add(a.objectif.ajouter.id);
}

// =====================================================================
//  13. INTERFACE DES MISSIONS ET MENUS
// =====================================================================
const CLE_PROGRESSION = 'frontDeSel.progression';
// Progression : null si le stockage du navigateur est inaccessible.
function lireProgression(){
  let brut;
  try { brut = localStorage.getItem(CLE_PROGRESSION); } catch(err){ return null; }
  try { const p = brut ? JSON.parse(brut) : null; return p && typeof p === 'object' && p.missions ? p : {missions:{}}; }
  catch(err){ return {missions:{}}; }
}
function enregistrerVictoire(id, duree){
  try {
    const p = lireProgression(); if(!p) return;
    const m = p.missions[id] || {};
    m.gagnee = true;
    m.meilleurTemps = m.meilleurTemps ? Math.min(m.meilleurTemps, Math.round(duree)) : Math.round(duree);
    // En mission, Ultra vaut Difficile (niveauIA) : la progression enregistre ce que l'ordinateur a joué.
    m.difficulte = difficulte === 'ultra' && MISSION ? 'difficile' : difficulte;
    p.missions[id] = m;
    localStorage.setItem(CLE_PROGRESSION, JSON.stringify(p));
  } catch(err){ /* le jeu fonctionne sans sauvegarde */ }
}
function missionGagnee(id){ const p = lireProgression(); return !!(p && p.missions[id] && p.missions[id].gagnee); }
// Une mission est ouverte si c'est la première, si la précédente est gagnée,
// ou si le stockage est inaccessible (on ne bloque pas le joueur).
function missionOuverte(m){
  if(!m || (m.numero || 1) <= 1) return true;
  const p = lireProgression();
  if(!p) return true;
  const prec = missionsDeCampagneSure(m.campagne).find(x => x.numero === m.numero - 1);
  return !prec || missionGagnee(prec.id);
}
function missionsDeCampagneSure(id){ return typeof missionsDeCampagne === 'function' ? missionsDeCampagne(id) : []; }
function missionSuivante(m){ return missionsDeCampagneSure(m.campagne).find(x => x.numero === m.numero + 1) || null; }
// L'autre campagne (même guerre, camp opposé) : {id, nom} ou null.
function autreCampagne(id){
  if(typeof CAMPAGNES === 'undefined' || !CAMPAGNES) return null;
  const fac = CAMPAGNES[id] ? CAMPAGNES[id].faction : null;
  const cles = Object.keys(CAMPAGNES).filter(k => k !== id && CAMPAGNES[k]);
  const cle = cles.find(k => CAMPAGNES[k].faction !== fac) || cles[0];
  return cle ? {id:cle, nom:CAMPAGNES[cle].nom || cle} : null;
}
// Campagne finie : toutes ses missions connues sont gagnées (faux si le stockage est inaccessible).
function campagneFinie(id){
  const ms = missionsDeCampagneSure(id);
  return lireProgression() !== null && ms.length > 0 && ms.every(m => missionGagnee(m.id));
}
// Dernière mission de sa campagne : son numéro atteint le nombre prévu et aucune mission ne la suit.
function estDerniereMission(m){
  const nb = typeof MISSIONS_PAR_CAMPAGNE !== 'undefined' ? MISSIONS_PAR_CAMPAGNE : 4;
  const ms = missionsDeCampagneSure(m.campagne);
  const dernier = ms.reduce((a, x) => Math.max(a, x.numero || 0), 0);
  return !missionSuivante(m) && (m.numero || 0) >= Math.max(nb, dernier);
}
function urlAvec(params){
  const q = new URLSearchParams(params);
  q.set('diff', difficulte);
  return location.pathname + '?' + q.toString();
}

// ---------- Écrans du menu ----------
const ECRANS = ['ecranAccueil', 'ecranEscarmouche', 'ecranCampagne', 'ecranBriefing'];
function montrerEcran(id){
  el('menu').classList.remove('cache');
  for(const e of ECRANS) el(e).classList.toggle('cache', e !== id);
  el('menu').scrollTop = 0;
}
function afficherAccueil(){
  montrerEcran('ecranAccueil');
  el('sousTitre').textContent = 'STRATÉGIE EN TEMPS RÉEL · CÔTE DE VARENNE, 2034';
  jouerMusique('menu');
}
function afficherEscarmouche(){
  montrerEcran('ecranEscarmouche');
  el('sousTitre').textContent = 'ESCARMOUCHE · CARTE : ' + (CARTE ? CARTE.nom : '').toUpperCase();
  construireChoixCarte();
  construireEmplacements();
  jouerMusique('menu');
}

// ---------- Escarmouche : emplacements, factions et équipes ----------
// Quatre emplacements. Le premier est le joueur (Halden ou Karsk, équipe A à D) ; les trois autres :
// Halden, Karsk, Aléatoire ou Fermé, et une équipe. Les camps ouverts reçoivent, dans l'ordre, les
// identifiants I, K et L (et leurs couleurs). Configuration mémorisée dans le navigateur (CLE_CAMPS).
const CLE_CAMPS = 'frontDeSel.camps';
const CHOIX_EMPLACEMENT = [['halden', 'Halden'], ['karsk', 'Karsk'], ['aleatoire', 'Aléatoire'], ['ferme', 'Fermé']];
const CONFIG_DEFAUT = {joueur:{faction:'halden', equipe:'A'}, autres:[{choix:'karsk', equipe:'B'}, {choix:'ferme', equipe:'C'}, {choix:'ferme', equipe:'D'}]};
let configEcran = null;
function lireConfigCamps(){
  let c = null;
  try { c = JSON.parse(localStorage.getItem(CLE_CAMPS) || 'null'); } catch(err){ c = null; }
  const ok = c && c.joueur && ['halden', 'karsk'].includes(c.joueur.faction) && EQUIPES.includes(c.joueur.equipe) && Array.isArray(c.autres) && c.autres.length === 3 &&
    c.autres.every(a => a && CHOIX_EMPLACEMENT.some(x => x[0] === a.choix) && EQUIPES.includes(a.equipe));
  return JSON.parse(JSON.stringify(ok ? c : CONFIG_DEFAUT));
}
function memoriserConfigCamps(){ try { localStorage.setItem(CLE_CAMPS, JSON.stringify(configEcran)); } catch(err){ /* sans mémorisation */ } }
// Configuration de l'écran -> liste des camps pour demarrer (le tirage « Aléatoire » est fait ici).
function listeDepuisConfig(cfg, tirer){
  const liste = [{id:'J', faction:cfg.joueur.faction, equipe:cfg.joueur.equipe, ia:false}];
  const ids = ['I', 'K', 'L'];
  for(const a of cfg.autres){
    if(a.choix === 'ferme') continue;
    const f = a.choix === 'aleatoire' ? (tirer ? (Math.random() < 0.5 ? 'halden' : 'karsk') : 'halden') : a.choix;
    liste.push({id:ids[liste.length - 1], faction:f, equipe:a.equipe, ia:true});
  }
  return liste;
}
// Raccourcis : ils ouvrent ou ferment les emplacements et répartissent les équipes.
const RACCOURCIS_CAMPS = [
  ['duel', 'Duel', ['A', 'B', null, null]],
  ['chacun', 'Chacun pour soi', ['A', 'B', 'C', 'D']],
  ['2c2', '2 contre 2', ['A', 'B', 'A', 'B']],
  ['1c3', '1 contre 3', ['A', 'B', 'B', 'B']],
  ['2c1', '2 contre 1', ['A', 'B', 'A', null]],
];
function appliquerRaccourci(cle){
  const R = RACCOURCIS_CAMPS.find(r => r[0] === cle); if(!R) return;
  const eq = R[2];
  configEcran.joueur.equipe = eq[0];
  configEcran.autres.forEach((a, i) => {
    const e = eq[i + 1];
    if(e === null){ a.choix = 'ferme'; return; }
    // « Duel » : l'Ordinateur 1 prend toujours le camp contraire à celui du joueur.
    if(a.choix === 'ferme' || (cle === 'duel' && i === 0)) a.choix = i === 0 ? (configEcran.joueur.faction === 'halden' ? 'karsk' : 'halden') : 'aleatoire';
    a.equipe = e;
  });
  memoriserConfigCamps(); construireEmplacements();
}
function construireEmplacements(){
  const boite = el('emplacementsCamps'); if(!boite) return;
  if(!configEcran) configEcran = lireConfigCamps();
  const racc = el('raccourcisCamps');
  if(racc && !racc.childElementCount) for(const [cle, nom] of RACCOURCIS_CAMPS){
    const b = document.createElement('button'); b.type = 'button'; b.className = 'petit'; b.textContent = nom;
    b.onclick = () => appliquerRaccourci(cle); racc.appendChild(b);
  }
  const optEq = v => EQUIPES.map(e => `<option value="${e}"${e === v ? ' selected' : ''}>Équipe ${e}</option>`).join('');
  const ids = ['I', 'K', 'L'];
  let n = 0;
  const lignes = [`<div class="empl"><span class="pastille" style="background:${COULEURS_CAMPS.J}"></span><b class="qui">Vous</b>
    <select data-i="j" data-k="faction"><option value="halden"${configEcran.joueur.faction === 'halden' ? ' selected' : ''}>Halden</option>
    <option value="karsk"${configEcran.joueur.faction === 'karsk' ? ' selected' : ''}>Karsk</option></select>
    <select data-i="j" data-k="equipe">${optEq(configEcran.joueur.equipe)}</select></div>`];
  configEcran.autres.forEach((a, i) => {
    const ouvert = a.choix !== 'ferme', id = ouvert ? ids[n++] : null;
    lignes.push(`<div class="empl${ouvert ? '' : ' ferme'}"><span class="pastille" style="background:${id ? COULEURS_CAMPS[id] : 'transparent'}"></span>
      <b class="qui">Ordinateur ${i + 1}</b>
      <select data-i="${i}" data-k="choix">${CHOIX_EMPLACEMENT.map(([v, t]) => `<option value="${v}"${v === a.choix ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <select data-i="${i}" data-k="equipe"${ouvert ? '' : ' disabled'}>${optEq(a.equipe)}</select></div>`);
  });
  boite.innerHTML = lignes.join('');
  for(const s of boite.querySelectorAll('select')) s.onchange = () => {
    const cible = s.dataset.i === 'j' ? configEcran.joueur : configEcran.autres[+s.dataset.i];
    // Le joueur change de camp : l'Ordinateur 1, s'il avait le camp opposé à l'ancien, bascule aussi.
    if(s.dataset.i === 'j' && s.dataset.k === 'faction' && s.value !== cible.faction){
      const o1 = configEcran.autres[0], oppose = f => f === 'halden' ? 'karsk' : 'halden';
      if(o1 && o1.choix === oppose(cible.faction)) o1.choix = oppose(s.value);
    }
    cible[s.dataset.k] = s.value;
    memoriserConfigCamps(); construireEmplacements();
  };
  const pb = problemeConfiguration(listeDepuisConfig(configEcran, false), CARTE ? emplacementsCarte(CARTE).length : 2);
  const zone = el('problemeCamps'); if(zone) zone.textContent = pb || '';
  const lancer = el('bLancerEscarmouche'); if(lancer) lancer.disabled = !!pb;
}
function lancerEscarmoucheDepuisEcran(){
  if(!configEcran) configEcran = lireConfigCamps();
  const liste = listeDepuisConfig(configEcran, true);
  const pb = problemeConfiguration(liste, emplacementsCarte(CARTE).length);
  if(pb){ const z = el('problemeCamps'); if(z) z.textContent = pb; return; }
  demarrer(liste[0].faction, liste);
}

// ---------- Choix de la carte d'escarmouche ----------
// Le décor 3D n'est construit qu'une fois par chargement : changer de carte recharge la page avec
// ?carte=<id>. Le dernier choix est mémorisé (CLE_CARTE) et repris à l'ouverture de l'escarmouche ;
// l'écran d'accueil garde Port-Calmes en fond.
const CLE_CARTE = 'frontDeSel.carte';
function cartesEscarmouche(){
  if(typeof CARTES === 'undefined' || !CARTES) return [];
  return Object.keys(CARTES).map(k => CARTES[k]).filter(c => c && c.id && emplacementsCarte(c).length >= 2);
}
function lireCarteMemorisee(){
  let id = null;
  try { id = localStorage.getItem(CLE_CARTE); } catch(err){ return null; }
  return id && typeof CARTES !== 'undefined' && CARTES[id] && emplacementsCarte(CARTES[id]).length >= 2 ? id : null;
}
function memoriserCarte(id){ try { localStorage.setItem(CLE_CARTE, id); } catch(err){ /* le jeu fonctionne sans mémorisation */ } }
// Recharge la page sur l'écran de l'escarmouche, avec la carte demandée (réglages du menu conservés).
function rechargerAvecCarte(id){
  const p = new URLSearchParams(location.search);
  for(const k of ['mission', 'campagne', 'demo', 'surprises']) p.delete(k);
  p.set('carte', id); p.set('diff', difficulte);
  const c = el('modeSurprises'); if(c && c.checked && !p.has('surprise')) p.set('surprises', '1');
  location.href = location.pathname + '?' + p.toString();
}
function construireChoixCarte(){
  const boite = el('choixCarte'); if(!boite) return;
  boite.innerHTML = '';
  for(const c of cartesEscarmouche()){
    const b = document.createElement('button');
    b.className = 'carteEsc' + (CARTE && CARTE.id === c.id ? ' choisie' : '');
    b.type = 'button';
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = 168;
    try { dessinerApercuCarte(cv, c); } catch(err){ console.warn('[Carte ' + c.id + '] aperçu impossible :', err); }
    const nom = document.createElement('div'); nom.className = 'nomCarte'; nom.textContent = c.nom || c.id;
    const desc = document.createElement('div'); desc.className = 'descCarte'; desc.textContent = c.description || '';
    const etat = document.createElement('div'); etat.className = 'etatCarte'; etat.textContent = CARTE && CARTE.id === c.id ? 'CARTE CHOISIE' : '';
    b.append(cv, nom, desc, etat);
    b.title = c.nom + ' — carré blanc : votre base ; orange : l’ordinateur ; carrés creux : emplacements libres.';
    b.onclick = () => {
      memoriserCarte(c.id);
      if(!CARTE || CARTE.id !== c.id) rechargerAvecCarte(c.id);
    };
    boite.appendChild(b);
  }
}
// Aperçu schématique d'une carte (données seules, sans le tirage des rochers isolés) : mer, rivières,
// ponts, routes, bois, crêtes, structures, champs de minerai et emplacements de départ (pleins : les deux
// de l'escarmouche ; creux : les deux autres).
function dessinerApercuCarte(cv, carte){
  const g = cv.getContext('2d'), k = cv.width / LARG, H = cv.height;
  const T = (x, y) => [x*k, y*k];
  g.fillStyle = {midi:'#c2ad7c', aube:'#b49c86', crepuscule:'#8f7a62', brume:'#a9a690'}[carte.ambiance] || '#b6a377';
  g.fillRect(0, 0, cv.width, H);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = '#5f7a45';
  for(const b of carte.bosquets || []){ rond(g, b.x*k, b.y*k, Math.max(2, b.r*k)); g.fill(); }
  g.strokeStyle = '#6b6152'; g.lineWidth = 1.5;
  for(const rt of carte.routes || []){ g.beginPath(); rt.forEach(([x, y], i) => i ? g.lineTo(...T(x, y)) : g.moveTo(...T(x, y))); g.stroke(); }
  g.strokeStyle = '#2f6f92';
  for(const rv of carte.rivieres || []){
    if(!rv || !Array.isArray(rv.points)) continue;
    g.lineWidth = Math.max(2, nombre(rv.largeur, 70)*k);
    g.beginPath(); rv.points.forEach(([x, y], i) => i ? g.lineTo(...T(x, y)) : g.moveTo(...T(x, y))); g.stroke();
  }
  g.strokeStyle = '#8a6f4a'; g.lineWidth = 3; g.lineCap = 'butt';
  for(const p of carte.ponts || []){
    const a = nombre(p.angle, 0), d = nombre(p.longueur, 140)/2;
    g.beginPath(); g.moveTo(...T(p.x - Math.cos(a)*d, p.y - Math.sin(a)*d)); g.lineTo(...T(p.x + Math.cos(a)*d, p.y + Math.sin(a)*d)); g.stroke();
  }
  g.fillStyle = '#6f675a';
  for(const c of carte.cretes || []){
    if(!Array.isArray(c) || c.length < 5) continue;
    const n = Math.max(1, Math.round(c[4]));
    for(let i=0;i<n;i++){ const t = n > 1 ? i/(n-1) : 0; rond(g, (c[0] + (c[2]-c[0])*t)*k, (c[1] + (c[3]-c[1])*t)*k, Math.max(2, 50*k)); g.fill(); }
  }
  g.fillStyle = '#d6d8d4';
  for(const s of carte.structures || []) g.fillRect(s.x*k, s.y*k, Math.max(2, s.l*k), Math.max(2, s.h*k));
  if(carte.cote && isFinite(carte.cote.base)){
    const ondes = (carte.cote.ondes || []).filter(o => Array.isArray(o) && o.length >= 2);
    const yc = x => ondes.reduce((y, o) => y + nombre(o[0], 0)*Math.sin(x/(nombre(o[1], 100) || 100) + nombre(o[2], 0)), carte.cote.base);
    g.beginPath(); g.moveTo(0, H);
    for(let x = 0; x <= LARG; x += 20) g.lineTo(x*k, Math.min(H, yc(x)*k));
    g.lineTo(cv.width, H); g.closePath(); g.fillStyle = '#245f80'; g.fill();
  }
  g.fillStyle = '#7fe0ff';
  for(const n of carte.noeuds || []) if(Array.isArray(n)){ rond(g, n[0]*k, n[1]*k, 2.6); g.fill(); }
  emplacementsCarte(carte).forEach((b, i) => {
    const x = (b.c + 1.5)*TUILE*k, y = (b.r + 1.5)*TUILE*k, r = 6;
    g.lineWidth = 2; g.strokeStyle = '#111';
    if(i < 2){ g.fillStyle = i === 0 ? '#f4f1e4' : '#ff7a2e'; g.fillRect(x - r, y - r, 2*r, 2*r); g.strokeRect(x - r, y - r, 2*r, 2*r); }
    else { g.strokeStyle = '#f2f2ea'; g.strokeRect(x - r + 1, y - r + 1, 2*r - 2, 2*r - 2); }
  });
}
function afficherCampagne(id){
  const C = (typeof CAMPAGNES !== 'undefined' && CAMPAGNES) ? CAMPAGNES[id] : null;
  if(!C){ afficherAccueil(); return; }
  montrerEcran('ecranCampagne');
  const F = FACTIONS[C.faction] || FACTIONS.halden;
  el('sousTitre').textContent = 'CAMPAGNE · ' + F.nom.toUpperCase();
  el('campTitre').textContent = C.nom; el('campTitre').style.color = F.couleur;
  el('campIntro').textContent = C.intro || '';
  const liste = el('campListe'); liste.innerHTML = '';
  const nb = typeof MISSIONS_PAR_CAMPAGNE !== 'undefined' ? MISSIONS_PAR_CAMPAGNE : 4;
  const missions = missionsDeCampagneSure(id);
  const total = Math.max(nb, missions.length ? missions[missions.length-1].numero || 0 : 0);
  const stockage = lireProgression() !== null;
  for(let n=1; n<=total; n++){
    const m = missions.find(x => x.numero === n);
    const d = document.createElement('div'); d.className = 'mission';
    if(!m){
      d.classList.add('verrou');
      d.innerHTML = `<div class="num">${n}</div><div class="corps"><b>Mission ${n}</b><div class="info">Indisponible : fichier de mission absent.</div></div>`;
    } else {
      const gagnee = missionGagnee(m.id), ouverte = missionOuverte(m);
      if(!ouverte) d.classList.add('verrou');
      if(gagnee) d.classList.add('gagnee');
      d.innerHTML = `<div class="num">${n}</div><div class="corps"><b>${echapper(m.titre || m.id)}</b>
        <div class="info">${echapper(m.lieu || '')}${m.date ? ' · ' + echapper(m.date) : ''}</div>
        <div class="etat">${gagnee ? 'Accomplie' : ouverte ? 'Disponible' : 'Verrouillée : gagnez la mission précédente'}</div></div>`;
      if(ouverte){
        const b = document.createElement('button'); b.textContent = gagnee ? 'Rejouer' : 'Jouer';
        b.onclick = () => { location.href = urlAvec({mission:m.id}); };
        d.appendChild(b);
      }
    }
    liste.appendChild(d);
  }
  el('campNote').textContent = stockage ? '' : 'La progression ne peut pas être enregistrée dans ce navigateur : toutes les missions sont ouvertes.';
  jouerMusique('menu');
}
function texteObjectifBriefing(d){ return (d.principal !== false ? '' : '(secondaire) ') + (d.texte || d.id); }
function afficherBriefing(){
  const M = MISSION, C = (typeof CAMPAGNES !== 'undefined' && CAMPAGNES[M.campagne]) || null;
  montrerEcran('ecranBriefing');
  const F = FACTIONS[M.joueur] || FACTIONS.halden;
  el('sousTitre').textContent = (C ? C.nom.toUpperCase() + ' · ' : '') + 'MISSION ' + (M.numero || '');
  el('briefTitre').textContent = M.titre || M.id; el('briefTitre').style.color = F.couleur;
  el('briefLieu').textContent = [M.lieu, M.date].filter(Boolean).join(' · ');
  const B = M.briefing || {};
  el('briefQui').textContent = B.intervenant || '';
  el('briefTexte').innerHTML = listeOuVide(typeof B.texte === 'string' ? [B.texte] : B.texte).map(p => '<p>' + echapper(p) + '</p>').join('');
  el('briefObjectifs').innerHTML = listeOuVide(M.objectifs).filter(o => o && !o.cache)
    .map(o => '<li>' + echapper(texteObjectifBriefing(o)) + '</li>').join('') || '<li>Les objectifs vous seront transmis par radio.</li>';
  // Le bouton reste désactivé (« Chargement… ») jusqu'à ce que la scène ait rendu sa première image :
  // c'est ce rendu (compilation des shaders) qui peut bloquer la page une ou deux secondes.
  // Filet : activation forcée après 2 s si la boucle d'affichage ne tourne pas (onglet en arrière-plan).
  briefingPret = false;
  el('bCommencer').onclick = commencerMission;
  setTimeout(activerCommencer, 2000);
  el('bBriefRetour').onclick = () => { location.href = urlAvec({campagne:M.campagne}); };
  jouerMusique('briefing');
}
let briefingPret = true;   // vrai quand le bouton « Commencer » est utilisable (ou sans objet)
function activerCommencer(){
  if(briefingPret) return;
  briefingPret = true;
  const b = el('bCommencer');
  b.disabled = false; b.textContent = 'Commencer';
}
let missionLancee = false;
function commencerMission(){
  if(missionLancee || !MISSION) return;      // un seul lancement, même en cas de double clic
  missionLancee = true;
  el('menu').classList.add('cache');
  for(const id of ['barre','panneau','mini','objectifs']) el(id).classList.remove('cache');
  el('bAbandon').textContent = 'Abandonner'; el('bAbandon').title = 'Abandonner la mission (deux clics)';
  demarrerMission();
  construireBarrePouvoirs();
  R3D.vue.distance = 820;
  const q = ents.find(b => b.camp === campJoueur && b.est === 'batiment') || ents.find(u => u.camp === campJoueur);
  if(q) centrerSur(q.x, q.y + 80);
  enJeu = true;
  majObjectifsDOM(true);
  jouerMusique(MISSION.musique || 'calme');
}

// ---------- Panneau d'objectifs ----------
let signatureObjectifs = '';
function basculerObjectifs(){
  MS.objectifsReplies = !MS.objectifsReplies;
  el('objectifs').classList.toggle('replie', MS.objectifsReplies);
  if(!MS.objectifsReplies) el('objNouveau').textContent = '';
}
function detailObjectif(o){
  const D = o.def;
  if(o.etat !== 'actif') return '';
  switch(D.type){
    case 'survivre': return ' — ' + enMinSec(Math.max(0, nombre(D.duree, 60) - (temps - o.debut)));
    case 'tenir': return ' — ' + Math.floor(o.cumul) + ' / ' + nombre(D.duree, 60) + ' s' + (o.conteste ? ' (contesté)' : '');
    case 'escorter': { const s = MS.etiquettes[D.nom]; return s ? ' — ' + o.arrives.size + ' / ' + Math.min(nombre(D.minimum, s.total), s.total) : ''; }
    case 'proteger': { const s = MS.etiquettes[D.nom]; return s && s.total > 1 ? ' — ' + vivantsDe(D.nom).length + ' / ' + s.total : ''; }
    case 'recolter': return ' — ' + Math.min(MS.recolte, nombre(D.montant, 0)) + ' / ' + nombre(D.montant, 0);
    case 'construire': return nombre(D.nombre, 1) > 1 ? ' — ' + batimentsFinis('J', typeConstruit(D)) + ' / ' + D.nombre : '';
    case 'atteindre': return nombre(D.nombre, 1) > 1 ? ' — ' + compterDansZone(D.zone, D.camp || 'J', D.nom) + ' / ' + D.nombre : '';
    case 'detruire': { const s = MS.etiquettes[D.nom]; return s && s.total > 1 ? ' — ' + (s.total - vivantsDe(D.nom).length) + ' / ' + s.total : ''; }
  }
  return '';
}
function majObjectifsDOM(force){
  if(!MISSION) return;
  // Index à jour avant les compteurs (sinon « 5 / 5 » au lieu de « 0 / 5 » juste après le départ
  // ou un objectif ajouté, tant que majMission n'a pas encore réindexé).
  indexerEtiquettes();
  const vis = MS.objectifs.filter(o => o.visible);
  const html = vis.map(o => {
    const cl = o.etat === 'reussi' ? 'reussi' : o.etat === 'echoue' ? 'echoue' : '';
    const nouveau = temps - o.nouveauT < 8 && o.etat === 'actif' ? ' nouveau' : '';
    const case_ = o.etat === 'reussi' ? '☑' : o.etat === 'echoue' ? '☒' : '☐';
    return `<div class="obj ${cl}${nouveau}${principal(o) ? '' : ' secondaire'}"><span class="case">${case_}</span>` +
      `<span>${echapper(o.def.texte || o.id)}${principal(o) ? '' : ' <i>(secondaire)</i>'}<span class="det">${echapper(detailObjectif(o))}</span></span></div>`;
  }).join('');
  if(html !== signatureObjectifs || force){ signatureObjectifs = html; el('objListe').innerHTML = html || '<div class="obj">En attente d’ordres…</div>'; }
  if(force && MS.objectifsReplies && vis.some(o => temps - o.nouveauT < 1 || (o.finT && temps - o.finT < 1))) el('objNouveau').textContent = ' · nouveau';
}

// ---------- Radio ----------
function majRadio(){
  const R = MS.radio;
  if(R.courant && temps >= R.finT) R.courant = null;
  if(!R.courant && R.file.length){
    R.courant = R.file.shift();
    R.finT = temps + Math.min(12, Math.max(5, R.courant.texte.length / 18));
    el('radioQui').textContent = R.courant.qui;
    el('radioTexte').textContent = R.courant.texte;
    el('radio').classList.remove('cache');
  }
  if(!R.courant) el('radio').classList.add('cache');
  else el('radioSuite').textContent = R.file.length ? '+' + R.file.length + ' message' + (R.file.length > 1 ? 's' : '') + ' · clic pour passer' : 'clic pour passer';
}

// ---------- Débriefing ----------
function afficherDebriefing(){
  partieFinie = true;
  const M = MISSION, f = MS.fin, F = faction(campJoueur);
  const fin = M.fin || {};
  const texte = f.victoire ? (fin.victoire || 'Mission accomplie.') : (f.texte ? f.texte + (fin.defaite ? ' ' + fin.defaite : '') : (fin.defaite || 'Mission échouée.'));
  const suiv = f.victoire ? missionSuivante(M) : null;
  // Fin de campagne : victoire sur la dernière mission (aucune mission suivante).
  const C = (typeof CAMPAGNES !== 'undefined' && CAMPAGNES && CAMPAGNES[M.campagne]) || null;
  const finCampagne = !!(f.victoire && C && estDerniereMission(M));
  const autre = finCampagne ? autreCampagne(M.campagne) : null;
  const autreFinie = autre ? campagneFinie(autre.id) : false;
  const texteFinCampagne = !finCampagne ? '' :
    `<div class="finCampagne"><h2>Campagne terminée</h2>
    <p>La campagne « ${echapper(C.nom || M.campagne)} » est achevée. ${autre
      ? (autreFinie ? 'Vous avez aussi terminé « ' + echapper(autre.nom) + ' » : vous connaissez désormais les deux versions de cette guerre.'
                    : 'La campagne « ' + echapper(autre.nom) + ' » raconte la même guerre depuis l’autre camp.')
      : ''}</p></div>`;
  // En cas de victoire, un objectif de maintien encore valide (protéger) est rempli.
  const etatFinal = o => (f.victoire && o.etat === 'actif' && TYPES_MAINTIEN.includes(o.def.type)) ? 'reussi' : o.etat;
  const objectifs = MS.objectifs.filter(o => o.visible).map(o => {
    const e = etatFinal(o), c = e === 'reussi' ? '☑' : e === 'echoue' ? '☒' : '☐';
    return `<li class="${e}">${c} ${echapper(o.def.texte || o.id)}${principal(o) ? '' : ' <i>(secondaire)</i>'}</li>`;
  }).join('');
  el('finContenu').innerHTML = `<div class="sous">${echapper(M.titre || M.id)} · ${echapper(F.nom)}</div>
    <h1 style="color:${f.victoire ? '#6fd67c' : '#ff7a5c'}">${f.victoire ? 'VICTOIRE' : 'DÉFAITE'}</h1>
    <p class="recit">${echapper(texte)}</p>
    ${texteFinCampagne}
    <ul class="bilan">${objectifs}</ul>
    <table><tr><td>Durée</td><td><b>${enMinSec(temps)}</b></td></tr>
    <tr><td>Unités produites</td><td><b>${stats.produites}</b></td></tr>
    <tr><td>Pertes (unités et bâtiments)</td><td><b>${stats.perdues}</b></td></tr>
    <tr><td>Ennemis détruits (unités et bâtiments)</td><td><b>${stats.detruites}</b></td></tr></table>
    <div class="boutons">
      <button class="grand" id="bRejouer">Rejouer</button>
      ${suiv ? '<button class="grand principal" id="bSuivante">Mission suivante</button>' : ''}
      ${autre ? '<button class="grand principal" id="bAutreCamp">Voir la même guerre depuis l’autre camp</button>' : ''}
      ${finCampagne ? '<button class="grand" id="bRetourMenu">Retour au menu</button>'
                    : '<button class="grand" id="bRetourCamp">Retour aux campagnes</button>'}
    </div>`;
  el('bRejouer').onclick = () => { location.href = urlAvec({mission:M.id}); };
  if(suiv) el('bSuivante').onclick = () => { location.href = urlAvec({mission:suiv.id}); };
  if(autre) el('bAutreCamp').onclick = () => { location.href = urlAvec({campagne:autre.id}); };
  if(finCampagne) el('bRetourMenu').onclick = () => { location.href = location.pathname + '?diff=' + difficulte; };
  else el('bRetourCamp').onclick = () => { location.href = urlAvec({campagne:M.campagne}); };
  el('fin').classList.remove('cache');
  el('radio').classList.add('cache');
  jouerMusique(f.victoire ? 'victoire' : 'defaite');
}
let abandonArme = 0;
function abandonner(){
  if(!enJeu || partieFinie) return;
  const b = el('bAbandon');
  if(performance.now() - abandonArme > 4000){
    abandonArme = performance.now();
    b.textContent = 'Confirmer ?';
    setTimeout(() => { if(performance.now() - abandonArme >= 3900) b.textContent = MISSION ? 'Abandonner' : 'Quitter'; }, 4000);
    return;
  }
  if(MISSION){ finMission(false, 'Mission abandonnée.'); MS.fin.immediat = true; verifierDebriefing(); }
  else location.href = location.pathname;
}

// =====================================================================
//  14. MUSIQUE (musique.js expose window.Musique ; tout appel est protégé)
// =====================================================================
const CLE_MUSIQUE = 'frontDeSel.musique';
const prefMusique = {coupee:false, volume:0.6};
try { const p = JSON.parse(localStorage.getItem(CLE_MUSIQUE) || 'null'); if(p){ prefMusique.coupee = !!p.coupee; if(isFinite(p.volume)) prefMusique.volume = Math.max(0, Math.min(1, p.volume)); } } catch(err){}
let musiquePrete = false, pisteVoulue = null, chaleurCombat = 0, musiqueT = 0;
function appelMusique(fn, ...args){
  try { if(window.Musique && typeof window.Musique[fn] === 'function') return window.Musique[fn](...args); }
  catch(err){ console.warn('[Musique] ' + fn + ' :', err); }
}
function sauverPrefMusique(){ try { localStorage.setItem(CLE_MUSIQUE, JSON.stringify(prefMusique)); } catch(err){} }
// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur.
function initMusique(){
  if(musiquePrete || !window.Musique) return;
  musiquePrete = true;
  appelMusique('init');
  appelMusique('volume', prefMusique.volume);
  appelMusique('couper', prefMusique.coupee);
  if(pisteVoulue) appelMusique('jouer', pisteVoulue);
}
addEventListener('pointerdown', initMusique, true);
addEventListener('keydown', initMusique, true);
function jouerMusique(nom){
  if(!nom) return;
  pisteVoulue = nom;
  if(musiquePrete) appelMusique('jouer', nom);
}
function basculerMusique(){
  prefMusique.coupee = !prefMusique.coupee;
  initMusique();
  appelMusique('couper', prefMusique.coupee);
  sauverPrefMusique(); majBoutonsMusique();
}
function reglerVolume(v){
  prefMusique.volume = Math.max(0, Math.min(1, v));
  if(prefMusique.coupee && v > 0){ prefMusique.coupee = false; appelMusique('couper', false); }
  initMusique();
  appelMusique('volume', prefMusique.volume);
  sauverPrefMusique(); majBoutonsMusique();
}
function majBoutonsMusique(){
  const dispo = !!window.Musique;
  for(const id of ['bMusique', 'bMusiqueMenu']){
    const b = el(id); if(!b) continue;
    b.textContent = !dispo ? 'Musique indisponible' : prefMusique.coupee ? 'Musique : non' : 'Musique : oui';
    b.title = 'Couper ou rétablir la musique (touche M)';
    b.disabled = !dispo; b.classList.toggle('coupee', prefMusique.coupee);
  }
  for(const id of ['volMusique', 'volMusiqueMenu']){ const r = el(id); if(r){ r.value = Math.round(prefMusique.volume*100); r.disabled = !dispo; } }
}
// Combats récents visibles ou impliquant le joueur -> intensité de la musique.
function noterCombat(c, auteur, deg){
  const v = window.R3D && R3D.vue;
  const implique = c.camp === campJoueur || (auteur && auteur.camp === campJoueur);
  const visible = v && Math.hypot(c.x - v.x, c.y - v.y) < v.distance*0.9;
  if(implique || visible) chaleurCombat += Math.min(3, 0.3 + deg/30);
}
function majMusique(dtReel){
  musiqueT -= dtReel;
  if(musiqueT > 0) return;
  musiqueT = 1;
  chaleurCombat *= 0.8;
  if(musiquePrete && enJeu && !partieFinie) appelMusique('intensite', Math.min(1, chaleurCombat/18));
}

// ---------- Qualité graphique (liste « Graphismes » du menu) ----------
// Le choix est mémorisé dans le navigateur et appliqué au chargement, par R3D.definirQualite
// (r3d-scene.js) si cette fonction existe. ?qualite=basse|moyenne|haute dans l'adresse force un
// niveau pour la session, sans le mémoriser.
const CLE_QUALITE = 'frontDeSel.qualite';
const QUALITES = ['basse', 'moyenne', 'haute'];
let qualiteGraphique = 'moyenne';
try { const q = localStorage.getItem(CLE_QUALITE); if(QUALITES.includes(q)) qualiteGraphique = q; } catch(err){}
function appliquerQualite(q, memoriser){
  qualiteGraphique = QUALITES.includes(q) ? q : 'moyenne';
  if(memoriser){ try { localStorage.setItem(CLE_QUALITE, qualiteGraphique); } catch(err){ /* le jeu fonctionne sans mémorisation */ } }
  try { if(window.R3D && typeof R3D.definirQualite === 'function') R3D.definirQualite(qualiteGraphique); }
  catch(err){ console.warn('[Graphismes] definirQualite :', err); }
  const s = el('qualite'); if(s) s.value = qualiteGraphique;
  // Changement de qualité choisi au menu : les nouveaux shaders sont compilés tout de suite, au clic,
  // plutôt qu'à la première image de la partie (au chargement, suiteLancement s'en charge).
  if(memoriser) prechaufferRendu();
}

// =====================================================================
//  14 bis. MODE SURPRISES (escarmouche seulement) : l'invasion des Veilleurs
// =====================================================================
// Déroulement : réglage sur l'écran de choix du camp (case « Mode Surprises ») ; à un instant tiré
// entre SURPRISE_MIN et SURPRISE_MAX s de jeu, la surprise se déclenche, précédée de signes
// avant-coureurs (« avance » secondes). Pour l'invasion : cinématique d'arrivée (simulation figée),
// proposition d'alliance (jeu en pause), puis combat contre le vaisseau-mère et ses unités (camp X).
// Essais : ?surprise=<secondes> active le mode et fixe l'instant ; declencherSurprise() le lance tout de suite.
// SURPRISES est une liste extensible : chaque entrée a une clé, un nom, ses signes et son déclenchement.
const SURPRISES = [
  {cle:'invasion', nom:'Invasion', avance:20, signes:signesInvasion, declencher:lancerInvasion},
];
const SURPRISE_MIN = 240, SURPRISE_MAX = 420;
const COULEUR_ALLIE = '#c39bff';          // l'allié sur la minicarte
const ENTREE_VAISSEAU = 280;              // le vaisseau s'arrête à cette distance (px) du bord de carte
const PORTEE_RAYON = 540;                 // le rayon principal vise jusqu'à cette distance du centre du vaisseau
const VITESSE_PLASMA = 520;               // px/s
const PREFERENCE_JOUEUR = 0;              // voir baseVisee (400 avant : le vaisseau visait le joueur toute la partie)
const ALTERNANCE_DUREE = 150;             // s sur une même base avant de passer à l'autre (voir baseVisee)
const ALTERNANCE_DEGATS = 0.2;            // ou dès cette part de sa santé de départ perdue sur cette base
// etat : 'aucune' | 'attente' | 'signes' | 'cinematique' | 'dialogue' | 'combat'
// gel : simulation figée (cinématique, dialogue) ; arrivee : le vaisseau-mère est entré en jeu.
const surprise = {demandee:false, actif:false, def:null, instant:Infinity, etat:'aucune', gel:false, arrivee:false,
  vaisseauDetruit:false, refusee:false, signeI:0, secours:false, cineT:0, jalonSecours:0, plan:null, majT:0, alerteT:-99};
let instantForce = null;                  // ?surprise=<secondes>

const SIGNES_INVASION = [
  'Radio : « …kssh… vigie de Cap-Sorel… anomalie en haute altitude… on perd le… »',
  'Radio : « …toutes les fréquences saturent… la pression chute sur toute la côte… »',
  'Radio : « …répétez… un objet… non, quelque chose de bien plus gros… chhh… »',
  'Radio : « …à toutes les unités… levez les yeux… »',
];
const SOUS_TITRES_INVASION = {
  ciel:'« Vigie de Cap-Sorel. Le ciel… le ciel change de couleur. »',
  nuages:'« Quelque chose pousse les nuages devant lui. Quelque chose d’immense. »',
  percee:'« Contact. Aucune signature connue. Il ne répond sur aucune fréquence. »',
  survol:'« Il ne choisit pas de camp. Il est venu pour la côte entière. »',
  fin:'« Les Veilleurs sont arrivés. »',
};

// Nom d'une faction avec son article : forme 'le' (« la République de Karsk ») ou 'a' (« au Groupe Halden »).
const ARTICLES_FACTIONS = {halden:{le:'le Groupe Halden', a:'au Groupe Halden'}, karsk:{le:'la République de Karsk', a:'à la République de Karsk'}};
function nomFaction(camp, forme, majuscule){
  const c = camps[camp], t = c && ARTICLES_FACTIONS[c.faction];
  const s = t ? t[forme] : faction(camp).nom;
  return majuscule ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function paramsInvasion(){ return (DIFFICULTES[difficulte] || DIFFICULTES.normal).invasion; }
const ASSOMBRI_COMBAT = 0.5;   // niveau du ciel pendant le combat contre le vaisseau (1 = cinématique)
function assombrir(k){
  try { if(window.R3D && typeof R3D.assombrir === 'function') R3D.assombrir(k); }
  catch(err){ console.warn('[Surprises] assombrir :', err); }
}
function vaisseauMere(){ return ents.find(e => e.camp === 'X' && !e.mort && e.def.forme === 'vaisseauMere') || null; }

// Interface : case à cocher, paramètre d'adresse, boutons d'alliance (appelé une fois, au lancement).
function initInterfaceSurprises(params){
  const s = params.get('surprise');
  if(s !== null && isFinite(parseFloat(s))){ instantForce = Math.max(1, parseFloat(s)); surprise.demandee = true; }
  else if(params.get('surprises') === '1') surprise.demandee = true;   // case cochée avant un changement de carte
  const c = el('modeSurprises');
  if(c){ c.checked = surprise.demandee; c.onchange = () => { surprise.demandee = c.checked; }; }
  const b = el('bAlliance'); if(b) b.onclick = () => proposerAlliance();
  const o = el('bFaireAlliance'); if(o) o.onclick = () => repondreAlliance(true);
  const n = el('bRefuserAlliance'); if(n) n.onclick = () => repondreAlliance(false);
}
// Début d'une escarmouche (appelé par demarrer) : tirage de la surprise et de son instant.
function preparerSurprises(){
  alliance = false;
  Object.assign(surprise, {actif:false, def:null, instant:Infinity, etat:'aucune', gel:false, arrivee:false,
    vaisseauDetruit:false, refusee:false, signeI:0, secours:false, cineT:0, jalonSecours:0, plan:null, majT:0, alerteT:-99});
  const b = el('bAlliance'); if(b) b.classList.add('cache');
  if(!surprise.demandee || MISSION) return;
  surprise.actif = true;
  surprise.def = SURPRISES[Math.floor(Math.random()*SURPRISES.length)];
  surprise.instant = instantForce != null ? instantForce : SURPRISE_MIN + Math.random()*(SURPRISE_MAX - SURPRISE_MIN);
  surprise.etat = 'attente';
  // Construit le vaisseau et compile ses matériaux dès maintenant : pas d'à-coup au début de la cinématique.
  try { if(window.R3D && R3D.Aliens && R3D.Aliens.preparer) R3D.Aliens.preparer(); }
  catch(err){ console.warn('[Surprises] préparation du rendu des envahisseurs :', err); }
}
// Pour les essais : déclenche tout de suite (active le mode si besoin). Renvoie vrai si c'est parti.
function declencherSurprise(){
  if(!enJeu || MISSION || partieFinie || window.MODE_DEMO) return false;
  if(!surprise.actif){ surprise.actif = true; surprise.def = SURPRISES[0]; surprise.etat = 'attente'; }
  if(surprise.etat !== 'attente' && surprise.etat !== 'signes') return false;
  surprise.instant = temps;
  surprise.def.declencher();
  return true;
}
window.declencherSurprise = declencherSurprise;
// Appelé par miseAJour (escarmouche, mode actif).
function majSurprise(dt){
  const S = surprise;
  if(S.etat === 'attente' || S.etat === 'signes'){
    const reste = S.instant - temps;
    if(S.etat === 'attente' && reste <= (S.def.avance || 0)){ S.etat = 'signes'; S.signeI = 0; }
    if(S.etat === 'signes' && S.def.signes) S.def.signes(reste);
    if(reste <= 0){
      // Partie déjà jouée (un camp n'a plus de bâtiment) : la fin normale passe avant l'événement.
      const aBat = c => ents.some(e => e.camp === c && e.est === 'batiment' && !e.mort);
      if(aBat(campJoueur) && campsEnJeu().some(c => hostile(campJoueur, c) && aBat(c))) S.def.declencher(); else S.instant = temps + 1;
    }
  } else if(S.etat === 'combat') majEnvahisseurs(dt);
}

// ---------- Invasion : signes, cinématique, alliance ----------
function signesInvasion(reste){
  const avance = surprise.def.avance || 20, k = Math.max(0, Math.min(1, 1 - reste/avance));
  assombrir(0.45*k);
  const i = Math.floor((avance - reste)/(avance/SIGNES_INVASION.length));
  while(surprise.signeI <= i && surprise.signeI < SIGNES_INVASION.length) message(SIGNES_INVASION[surprise.signeI++], 'alerte');
}
// Trajectoire d'arrivée : par le milieu du bord de carte le plus éloigné des deux bases à la fois (le plus
// grand des deux minimums), en écartant un bord en mer ; le vaisseau s'arrête à l'entrée de la carte.
function planArrivee(){
  const centreDe = camp => { const q = ents.find(b => b.camp === camp && b.type === 'qg' && !b.mort) || ents.find(b => b.camp === camp && b.est === 'batiment' && !b.mort);
    const d = basesCarte[camp]; return q ? {x:q.x, y:q.y} : {x:(d.c + 1.5)*TUILE, y:(d.r + 1.5)*TUILE}; };
  const bases = campsEnJeu().filter(enVie).map(centreDe);
  const bords = [{x:LARG/2, y:0, nx:0, ny:1}, {x:LARG/2, y:HAUT, nx:0, ny:-1}, {x:0, y:HAUT/2, nx:1, ny:0}, {x:LARG, y:HAUT/2, nx:-1, ny:0}];
  let best = bords[0], bs = -Infinity;
  for(const b of bords){
    const enMer = isFinite(cote(b.x)) && b.y + b.ny*ENTREE_VAISSEAU > cote(b.x) - 10;
    const s = Math.min(...bases.map(p => Math.hypot(p.x - b.x, p.y - b.y))) - (enMer ? 1e6 : 0);
    if(s > bs){ bs = s; best = b; }
  }
  const arrivee = {x:best.x + best.nx*ENTREE_VAISSEAU, y:best.y + best.ny*ENTREE_VAISSEAU};
  return {bases, arrivee, depart:{x:best.x - best.nx*2400, y:best.y - best.ny*2400}, angle:Math.atan2(best.ny, best.nx),
    vueFin:{x:arrivee.x + best.nx*520, y:arrivee.y + best.ny*520, distance:1500}};
}
function lancerInvasion(){
  const S = surprise;
  if(S.etat === 'cinematique' || S.etat === 'dialogue' || S.etat === 'combat') return;
  S.etat = 'cinematique'; S.gel = true; S.secours = false; S.passee = false; S.cineT = 0; S.jalonSecours = 0;
  mode = null; souris.bas = false;
  for(const k in touchesZoom) delete touchesZoom[k];
  S.plan = planArrivee();
  for(const id of ['barre', 'panneau', 'mini', 'messages', 'aide']) el(id).classList.add('cache');
  const cine = el('cine'), texte = el('cineTexte');
  cine.classList.remove('cache', 'secours'); texte.textContent = ''; texte.classList.remove('vu');
  jouerMusique('invasion');
  const C = window.R3D && R3D.Cinematique;
  let lancee = false;
  if(C && typeof C.jouer === 'function'){
    try {
      lancee = C.jouer('arrivee', {depart:S.plan.depart, arrivee:S.plan.arrivee, bases:S.plan.bases, alt:UNITES.vaisseauMere.alt,
        vueFin:S.plan.vueFin, surJalon:jalonCinematique}, finCinematique) !== false;
    } catch(err){ console.warn('[Surprises] cinématique impossible :', err); lancee = false; }
  }
  // Sans module de cinématique (ou s'il a échoué avant de commencer) : simple fondu avec le texte.
  if(!lancee && S.etat === 'cinematique'){ S.secours = true; cine.classList.add('secours'); jalonCinematique('ciel'); }
}
function jalonCinematique(nom){
  const t = SOUS_TITRES_INVASION[nom], zone = el('cineTexte');
  if(!t || !zone) return;
  zone.textContent = t; zone.classList.add('vu');
}
// Une image de cinématique (appelée par la boucle, ou à la main dans les essais) : dtReel en secondes.
const JALONS_SECOURS = [['ciel', 0], ['percee', 2.5], ['fin', 5]], DUREE_SECOURS = 7.5;
function avancerCinematique(dtReel){
  const S = surprise;
  if(S.etat !== 'cinematique') return;
  S.cineT += dtReel;
  if(S.secours){
    while(S.jalonSecours < JALONS_SECOURS.length && S.cineT >= JALONS_SECOURS[S.jalonSecours][1]) jalonCinematique(JALONS_SECOURS[S.jalonSecours++][0]);
    if(S.cineT >= DUREE_SECOURS){ finCinematique(); return; }
    R3D.majCamera();
  } else {
    try { R3D.Cinematique.maj(dtReel); }
    catch(err){ console.warn('[Surprises] cinématique interrompue :', err); finCinematique(); return; }
    if(S.etat !== 'cinematique') return;     // terminée pendant cette image
  }
  // Le monde reste figé (dt = 0) ; seule la cinématique avance.
  R3D.Unites.sync(ents, temps, 0);
  R3D.Batiments.sync(ents, noeuds, temps, 0);
  if(R3D.Aliens && R3D.Aliens.sync) R3D.Aliens.sync(ents, effets, temps, 0);
  R3D.Effets.sync(effets, projectiles, temps, 0);
  R3D.rendre(temps, dtReel);
  kctx.clearRect(0, 0, largEcran, hautEcran);
}
function passerCinematique(){
  const S = surprise;
  if(S.etat !== 'cinematique') return;
  S.passee = true;
  if(!S.secours){
    try { if(R3D.Cinematique && R3D.Cinematique.active) R3D.Cinematique.passer(); }
    catch(err){ console.warn('[Surprises] passer la cinématique :', err); }
  }
  if(S.etat === 'cinematique') finCinematique();
}
// Fin de la cinématique : le vaisseau-mère entre en jeu là où la cinématique l'a laissé, puis la
// proposition d'alliance s'affiche, jeu en pause.
function finCinematique(){
  const S = surprise;
  if(S.etat !== 'cinematique') return;
  el('cine').classList.add('cache');
  for(const id of ['barre', 'panneau', 'mini', 'messages']) el(id).classList.remove('cache');
  const P = paramsInvasion(), D = UNITES.vaisseauMere;
  // Pose laissée par le module (à params.arrivee, même après passer()) : l'entité naît sous le modèle.
  const pose = (!S.secours && window.R3D && R3D.Cinematique && R3D.Cinematique.pose) || null;
  const x = pose && isFinite(pose.x) ? pose.x : S.plan.arrivee.x, y = pose && isFinite(pose.y) ? pose.y : S.plan.arrivee.y;
  const v = creerUnite('vaisseauMere', 'X', x, y);
  Object.assign(v, {alt:pose && pose.alt > 0 ? pose.alt : D.alt, angle:pose && isFinite(pose.angle) ? pose.angle : S.plan.angle,
    pv:P.pv, pvMax:P.pv, bouclier:P.bouclier, bouclierMax:P.bouclier, charge:0, cibleRayon:null,
    rayonEtat:'recharge', rayonT:P.rayonRecharge*0.6, rayonScan:0, rayonFinT:0, chargeT:0,
    dardT:8, rodeurT:16, campVise:null, batVise:null, viseT:0, eclatT:-9, defT:0, observeT:P.observation || 0});
  v.angleT = v.angle;
  S.arrivee = true;
  assombrir(ASSOMBRI_COMBAT);
  if(S.secours){ const f = S.plan.vueFin; R3D.vue.x = f.x; R3D.vue.y = f.y; R3D.vue.distance = f.distance; bornerCamera(); }
  S.etat = 'dialogue';
  ouvrirDialogueAlliance();
}
// Autres camps encore en jeu ; à deux camps, l'adversaire unique (textes du duel inchangés).
function autresCampsVivants(){ return campsEnJeu().filter(c => c !== campJoueur && enVie(c)); }
function treveGenerale(){ return autresCampsVivants().length > 1; }
function ouvrirDialogueAlliance(){
  if(treveGenerale()){
    const liste = autresCampsVivants().map(c => echapper(nomCamp(c).toLowerCase() + ' (' + faction(c).nom + ')')).join(', ');
    el('allianceTitre').textContent = 'Proposer une trêve générale ?';
    el('allianceTexte').innerHTML =
      `<p>Un vaisseau d’origine inconnue s’est immobilisé au-dessus de ${echapper(CARTE.nom)}. Il attaquera toutes les bases, l’une après l’autre.</p>
       <p class="choix"><b>Faire alliance</b> : trêve immédiate et définitive entre tous les camps encore en jeu (${liste}).
       Toutes les forces se tournent contre les envahisseurs ; chacun vient défendre les bases menacées quand la sienne est tranquille.
       Tous les camps gagnent ensemble si le vaisseau-mère est détruit. Si votre base tombe, c’est la défaite.</p>
       <p class="choix"><b>Refuser</b> : chacun garde ses équipes, et les envahisseurs frappent tout le monde. Pour gagner, il faudra
       détruire le vaisseau-mère <b>et</b> toutes les bases adverses. Vous pourrez encore proposer la trêve plus tard, depuis la barre du haut.</p>`;
    el('alliance').classList.remove('cache');
    return;
  }
  const adv = autresCampsVivants()[0] || 'I';
  const nom = echapper(nomFaction(adv, 'le', true)), nom2 = echapper(nomFaction(adv, 'le'));
  el('allianceTitre').textContent = 'Proposer une alliance ' + nomFaction(adv, 'a') + ' ?';
  el('allianceTexte').innerHTML =
    `<p>Un vaisseau d’origine inconnue s’est immobilisé au-dessus de ${echapper(CARTE.nom)}. Il attaquera les deux bases, l’une après l’autre.</p>
     <p class="choix"><b>Faire alliance</b> : le cessez-le-feu est immédiat et définitif. ${nom} accepte, tourne ses forces contre
     les envahisseurs et vient défendre votre base quand la sienne n’est pas menacée. Vous gagnez ensemble si le vaisseau-mère
     est détruit. Si votre base tombe, c’est la défaite.</p>
     <p class="choix"><b>Refuser</b> : guerre à trois. Les envahisseurs frappent les deux camps et ${nom2} continue de vous
     attaquer. Pour gagner, il faudra détruire le vaisseau-mère <b>et</b> la base adverse : c’est très peu probable.
     Vous pourrez encore proposer l’alliance plus tard, depuis la barre du haut.</p>`;
  el('alliance').classList.remove('cache');
}
function repondreAlliance(oui){
  const S = surprise;
  if(S.etat !== 'dialogue') return;
  el('alliance').classList.add('cache');
  S.gel = false; S.etat = 'combat';
  if(oui) conclureAlliance();
  else {
    S.refusee = true;
    el('bAlliance').classList.remove('cache');
    el('bAlliance').textContent = treveGenerale() ? 'Proposer une trêve' : 'Proposer une alliance';
    if(treveGenerale()) message('Trêve refusée : les envahisseurs attaquent tout le monde, et chaque équipe poursuit sa guerre.', 'alerte');
    else message('Guerre à trois : les envahisseurs attaquent tout le monde, et ' + nomFaction(autresCampsVivants()[0] || 'I', 'le') + ' aussi.', 'alerte');
  }
}
function proposerAlliance(){
  if(surprise.etat !== 'combat' || alliance || partieFinie) return;
  conclureAlliance();
}
// Alliance : trêve générale, plus aucun camp de joueur n'est hostile à un autre (dans les deux sens) ;
// les tirs en cours entre eux sont annulés.
function conclureAlliance(){
  const treve = treveGenerale(), adv = autresCampsVivants()[0] || 'I';
  alliance = true;
  el('bAlliance').classList.add('cache');
  for(const u of ents){
    if(u.mort) continue;
    if(u.cible && !hostile(u.camp, u.cible.camp)) u.cible = null;
    const o = u.ordre;
    if(o && o.type === 'attaquer' && o.cible && !hostile(u.camp, o.cible.camp)) u.ordre = null;
    // Les vagues de l'ordinateur en route vers la base du joueur sont rappelées (majIA les redirige).
    if(camps[u.camp] && camps[u.camp].ia && u.est === 'unite' && o && o.type === 'attaqueDeplacement'){ u.ordre = null; u.chemin = null; }
  }
  projectiles = projectiles.filter(p => !(p.cible && allies(p.camp, p.cible.camp)));
  if(treve) message('Tous les camps acceptent la trêve. Cessez-le-feu général : toutes les forces contre le vaisseau-mère !', 'succes');
  else message(nomFaction(adv, 'le', true) + ' accepte l’alliance. Cessez-le-feu : toutes les forces contre le vaisseau-mère !', 'succes');
}

// ---------- Envahisseurs : vaisseau-mère, dards, rôdeurs ----------
// Tir de plasma (dards, rôdeurs, défense rapprochée du vaisseau) : projectile guidé, lent et visible.
function tirPlasma(u, c, deg){
  let sx = u.x, sy = u.y, h1 = hauteurVisee(u);
  if(u.def.forme === 'vaisseauMere'){
    const a = Math.atan2(c.y - u.y, c.x - u.x);
    sx = u.x + Math.cos(a)*u.rayon*0.55; sy = u.y + Math.sin(a)*u.rayon*0.55; h1 = Math.max(20, u.alt - 40);
  }
  const h2 = hauteurVisee(c), d = Math.hypot(c.x - sx, c.y - sy, h2 - h1);
  projectiles.push({genre:'plasma', arme:'plasma', sx, sy, tx:c.x, ty:c.y, h1, h2, t:0, duree:Math.max(0.15, d/VITESSE_PLASMA),
    degats:deg, zone:0, camp:u.camp, auteur:u, cible:c});
}
// Bouclier : il absorbe les dégâts tant qu'il tient (éclat visible à l'impact, une fois par 0,2 s au plus).
// Renvoie les dégâts qui le traversent.
function absorberBouclier(c, deg, auteur){
  const pris = Math.min(c.bouclier, deg);
  c.bouclier -= pris; c.toucheT = temps;
  noterCombat(c, auteur, pris);
  if(temps - (c.eclatT || -9) > 0.2){
    c.eclatT = temps;
    let x = c.x, y = c.y;
    if(auteur && isFinite(auteur.x)){ const dx = auteur.x - c.x, dy = auteur.y - c.y, d = Math.hypot(dx, dy) || 1, r = Math.min(d, c.rayon); x += dx/d*r; y += dy/d*r; }
    effet('bouclier', {x, y, h:altitudeDe(c), t:temps, duree:0.6});
  }
  return deg - pris;
}
// Camp et bâtiment visés : la base la plus proche d'abord, puis l'une après l'autre (comme l'annonce le
// dialogue d'alliance) : le vaisseau change de base après ALTERNANCE_DUREE s, ou dès qu'il a subi
// ALTERNANCE_DEGATS (part de ses PV et bouclier de départ) depuis le dernier changement. Une base rasée
// lui fait viser l'autre. (Avant novembre 2026 : il restait sur la première base jusqu'à la raser, et la
// préférence pour le joueur le faisait viser le camp J toute la partie.)
function baseVisee(u){
  const aDesBats = camp => ents.some(b => b.camp === camp && b.est === 'batiment' && !b.mort);
  const sante = (u.pv || 0) + (u.bouclier || 0);
  let changer = !u.campVise || !aDesBats(u.campVise);
  if(!changer && (temps >= (u.alterneT || 0) || (u.santeVisee || 0) - sante >= ALTERNANCE_DEGATS*((u.pvMax || 0) + (u.bouclierMax || 0)))){
    const autre = campsEnJeu().find(c => c !== u.campVise && hostile('X', c) && aDesBats(c));
    if(autre) changer = true; else { u.alterneT = temps + ALTERNANCE_DUREE; u.santeVisee = sante; }
  }
  if(changer){
    let best = null, bd = Infinity;
    // Premier choix : la base la plus proche (PREFERENCE_JOUEUR px d'avance au joueur, à 0 désormais).
    // Changements suivants : l'autre base, si elle a encore des bâtiments.
    const exclu = u.campVise && aDesBats(u.campVise) ? u.campVise : null;
    // À plus de deux camps : la base visitée il y a le plus longtemps (jamais visitée d'abord), puis la plus
    // proche, pour faire le tour de toutes les bases.
    u.vises = u.vises || {};
    for(const b of ents) if(b.est === 'batiment' && !b.mort && hostile('X', b.camp) && b.camp !== exclu){
      const d = dist(u, b) - (b.camp === campJoueur ? PREFERENCE_JOUEUR : 0) + (u.vises[b.camp] != null ? 1e6 + u.vises[b.camp]*1e3 : 0);
      if(d < bd){ bd = d; best = b.camp; }
    }
    if(best) u.vises[best] = temps;
    if(!best) best = exclu;
    u.alterneT = temps + ALTERNANCE_DUREE; u.santeVisee = sante;
    if(best !== u.campVise && best){
      message(best === campJoueur ? 'Le vaisseau-mère se dirige vers notre base !' :
        'Le vaisseau-mère se dirige vers la base ' + (allies(best, campJoueur) ? 'alliée' : 'adverse') +
        (campsEnJeu().length > 2 ? ' (' + nomCamp(best).toLowerCase() + ').' : '.'), best === campJoueur ? 'alerte' : 'info');
    }
    u.campVise = best; u.batVise = null;
  }
  if(!u.campVise) return null;
  if(!u.batVise || u.batVise.mort || temps >= u.viseT){
    u.viseT = temps + 2;
    let best = null, bd = Infinity;
    for(const b of ents) if(b.est === 'batiment' && !b.mort && b.camp === u.campVise){ const d = dist(u, b); if(d < bd){ bd = d; best = b; } }
    u.batVise = best;
  }
  return u.batVise;
}
// Point d'impact du rayon : là où il fait le plus de mal (bâtiments surtout) ; un groupe d'unités seul
// doit compter au moins trois unités. null si rien ne vaut un tir.
function cibleDuRayon(u, P){
  let best = null, bs = 0;
  for(const c of ents){
    if(c.mort || !hostile('X', c.camp) || enVol(c) || dist(u, c) > PORTEE_RAYON) continue;
    let s = 0;
    for(const e of ents){
      if(e.mort || !hostile('X', e.camp) || enVol(e)) continue;
      if(Math.hypot(e.x - c.x, e.y - c.y) - (e.rayon || 0)*0.5 <= P.rayonZone) s += e.est === 'batiment' ? 3 : 1;
    }
    if(c.est === 'batiment' && c === u.batVise) s += 2;
    if(s > bs && s >= (c.est === 'batiment' ? 3 : 5)){ bs = s; best = c; }
  }
  return best;
}
// Cibles de la défense rapprochée : les appareils en vol d'abord, puis les unités au sol, à portée
// (comptée depuis le centre). Les fantassins, qui visent le bord du vaisseau, peuvent tirer juste hors
// de cette portée : c'est voulu (essais : l'allonger rendait l'invasion presque imbattable).
function ciblesDefense(u, n){
  // Portée comptée depuis la coque (et non depuis le centre) : sinon les fantassins, qui visent le bord
  // de l'immense vaisseau, le criblaient de hors de portée de sa défense rapprochée.
  const choix = [], portee = u.def.portee + (u.rayon || 0)*0.25;
  for(const e of ents){
    if(e.est !== 'unite' || e.def.ouvrier || !peutCibler(u, e)) continue;   // les ouvriers ne sont pas visés
    const d = dist(u, e);
    if(d > portee) continue;
    // Les collecteurs (sans arme) ne passent qu'après tout le reste : ils étaient criblés en premier.
    const s = d - (enVol(e) ? 400 : 0) + (e.def.collecteur ? 2000 : 0);
    choix.push({e, s});
  }
  choix.sort((a, b) => a.s - b.s);
  return choix.slice(0, n).map(c => c.e);
}
// L'ordinateur esquive le rayon comme le ferait un joueur attentif : chaque unité au sol prise dans un
// cercle d'alerte en sort par le chemin le plus court (les avions en vol ne craignent rien).
function esquiverRayon(unites){
  let cercles = null;
  for(const f of effets) if(f.type === 'chargeSol'){ (cercles || (cercles = [])).push(f); }
  if(!cercles) return;
  for(const u of unites){
    if(u.mort || enVol(u)) continue;
    for(const c of cercles){
      const dx = u.x - c.x, dy = u.y - c.y, d = Math.hypot(dx, dy);
      if(d > c.rayon + 25) continue;
      const k = (c.rayon + 80)/(d || 1), p = pointLibre(c.x + (d ? dx : 1)*k, c.y + dy*k);
      u.ordre = {type:'aller', x:p.x, y:p.y}; u.cible = null; u.chemin = null;
      break;
    }
  }
}
function compterX(type){ let n = 0; for(const e of ents) if(e.camp === 'X' && !e.mort && e.type === type) n++; return n; }
function majVaisseauMere(u, dt){
  if(u.demo){ u.angle += dt*0.02; return; }   // vitrine (?demo) : il plane sans combattre
  const P = paramsInvasion();
  // Aucune récupération : ni le bouclier ni la coque ne se régénèrent (voir aussi majUnite : pas de
  // régénération d'élite pour le vaisseau).
  // Observation : à son arrivée, il reste immobile et ne tire pas son rayon pendant P.observation s
  // (le temps, pour les joueurs, de préparer leur défense antiaérienne).
  if(u.observeT > 0){
    u.observeT -= dt;
    if(u.observeT <= 0) message('Le vaisseau-mère se met en mouvement.', 'alerte');
  }
  // Déplacement : très lent, vers le bâtiment visé ; il s'immobilise au-dessus de lui.
  const b = u.observeT > 0 ? null : baseVisee(u);
  if(b){
    const dx = b.x - u.x, dy = b.y - u.y, d = Math.hypot(dx, dy);
    u.angle = tournerVers(u.angle, Math.atan2(dy, dx), dt*0.15);
    if(d > 140){ const v = Math.min(d - 140, P.vitesse*dt); u.x += dx/d*v; u.y += dy/d*v; }
  }
  // Rayon principal : repos -> montée en puissance (cercle d'alerte au sol, P.charge s) -> impact.
  if(u.rayonEtat === 'recharge'){
    u.rayonT -= dt;
    if(u.cibleRayon && temps >= u.rayonFinT) u.cibleRayon = null;
    if(u.rayonT <= 0) u.rayonEtat = 'pret';
  } else if(u.rayonEtat === 'pret' && !(u.observeT > 0)){
    u.rayonScan -= dt;
    if(u.rayonScan <= 0){
      u.rayonScan = 0.5;
      const c = cibleDuRayon(u, P);
      if(c){
        u.cibleRayon = {x:c.x, y:c.y}; u.rayonEtat = 'charge'; u.chargeT = 0; u.charge = 0;
        effet('chargeSol', {x:c.x, y:c.y, rayon:P.rayonZone, t:temps, duree:P.charge});
        const visesJ = ents.some(e => e.camp === campJoueur && !e.mort && Math.hypot(e.x - c.x, e.y - c.y) < P.rayonZone + 60);
        if(visesJ && temps - surprise.alerteT > 10){
          surprise.alerteT = temps; alerte = {t:temps, x:c.x, y:c.y};
          message('Le vaisseau-mère charge son rayon : sortez du cercle ! (Espace pour y aller)', 'alerte');
        }
      }
    }
  } else if(u.rayonEtat === 'charge'){
    u.chargeT += dt; u.charge = Math.min(1, u.chargeT/P.charge);
    if(u.chargeT >= P.charge){
      const c = u.cibleRayon;
      effet('rayon', {x1:u.x, y1:u.y, h1:Math.max(20, u.alt - 30), x2:c.x, y2:c.y, h2:0, t:temps, duree:1.5, largeur:32});
      explosionZone(c.x, c.y, P.rayonZone, P.rayonDeg, 'rayon', u, 0.55);
      effet('explosion', {x:c.x, y:c.y, h:0, r:P.rayonZone*0.8, duree:1, grande:true});
      brulure(c.x, c.y, P.rayonZone*0.7);
      u.rayonEtat = 'recharge'; u.rayonT = P.rayonRecharge; u.charge = 0; u.rayonFinT = temps + 1.5; u.tirT = temps;
    }
  }
  // Défense rapprochée : deux tirs de plasma par salve.
  u.defT -= dt;
  if(u.defT <= 0){
    u.defT = u.def.cadence;
    for(const c of ciblesDefense(u, 2)) tirPlasma(u, c, P.defDeg);
  }
  // Escadrilles de dards et rôdeurs déposés au sol.
  u.dardT -= dt;
  if(u.dardT <= 0){
    u.dardT = P.dardsT;
    const n = Math.min(P.escadrille, P.dardsMax - compterX('dard'));
    for(let k = 0; k < n; k++){
      const a = u.angle + (k - (n - 1)/2)*0.45;
      const d = creerUnite('dard', 'X', u.x + Math.cos(a)*110, u.y + Math.sin(a)*110);
      d.angle = d.angleT = u.angle;
    }
  }
  u.rodeurT -= dt;
  if(u.rodeurT <= 0){
    u.rodeurT = P.rodeursT;
    const n = Math.min(P.rodeurs, P.rodeursMax - compterX('rodeur'));
    for(let k = 0; k < n; k++){
      const a = u.angle + Math.PI*0.5 + k*2.1, p = pointLibre(u.x + Math.cos(a)*90, u.y + Math.sin(a)*90);
      const r = creerUnite('rodeur', 'X', p.x, p.y);
      r.angle = r.angleT = u.angle;
      effet('fumee', {x:p.x, y:p.y, duree:1.4});
    }
  }
}
// Conduite des dards et des rôdeurs : sans ordre ni cible, ils marchent sur la base visée par le vaisseau.
function majEnvahisseurs(dt){
  const S = surprise;
  S.majT -= dt; if(S.majT > 0) return; S.majT = 1;
  const v = vaisseauMere();
  for(const e of ents){
    if(e.camp !== 'X' || e.mort || e.est !== 'unite' || e === v || e.ordre || e.cible) continue;
    const c = cibleVague(v && v.batVise ? v.batVise : e, 'X');
    if(c) e.ordre = {type:'attaqueDeplacement', x:c.x + (Math.random() - .5)*120, y:c.y + (Math.random() - .5)*120};
  }
}
function vaisseauDetruit(c){
  if(c.demo) return;
  surprise.vaisseauDetruit = true;
  message('Le vaisseau-mère est abattu ! Ses dards et ses rôdeurs perdent leur guidage.', 'succes');
  for(const e of ents) if(e.camp === 'X' && !e.mort && e !== c){
    const x = e;
    planifier(0.6 + Math.random()*3, () => { if(!x.mort) tuer(x, null); });
  }
  assombrir(0);
  if(!alliance) jouerMusique('calme');
}
// Fin de partie en mode Surprises, une fois le vaisseau-mère arrivé : false si le mode n'a pas d'effet
// (règle habituelle), null si la partie continue, sinon {victoire, texte}.
function finInvasion(batsJ, batsI){
  const S = surprise;
  if(!S.actif || !S.arrivee) return false;
  if(S.gel) return null;
  const FJ = faction(campJoueur), carte = echapper(CARTE.nom);
  if(campsEnJeu().length > 2){
    if(!batsJ) return {victoire:false, texte:S.vaisseauDetruit ? FJ.defaite :
      `Votre base n’est plus que cendres. Au-dessus de ${carte}, le vaisseau-mère des Veilleurs poursuit sa garde silencieuse.`};
    if(alliance) return S.vaisseauDetruit ? {victoire:true, texte:
      `Le vaisseau-mère s’est écrasé. Les camps encore debout ont tenu la côte ensemble ; reste à savoir qui la gardera demain.`} : null;
    return S.vaisseauDetruit && !batsI ? {victoire:true, texte:
      `Le vaisseau-mère abattu, les bases adverses rasées : votre équipe reste seule sur ${carte}. Une victoire que personne ne voudra croire.`} : null;
  }
  const adv = campsEnJeu().find(c => c !== campJoueur) || 'I';
  const J = nomFaction(campJoueur, 'le', true), Ile = nomFaction(adv, 'le'), Ide = (camps[adv] && camps[adv].faction === 'karsk') ? 'de la République de Karsk' : 'du Groupe Halden';
  if(!batsJ) return {victoire:false, texte:S.vaisseauDetruit ? FJ.defaite :
    `Votre base n’est plus que cendres. Au-dessus de ${carte}, le vaisseau-mère des Veilleurs poursuit sa garde silencieuse.`};
  if(alliance) return S.vaisseauDetruit ? {victoire:true, texte:
    `Le vaisseau-mère s’est écrasé. ${J} et ${Ile} ont tenu la côte ensemble ; reste à savoir qui la gardera demain.`} : null;
  return S.vaisseauDetruit && !batsI ? {victoire:true, texte:
    `Le vaisseau-mère abattu, la base ${Ide} rasée : ${nomFaction(campJoueur, 'le')} reste seul sur ${carte}. Une victoire que personne ne voudra croire.`} : null;
}

// =====================================================================
//  15. BOUCLE PRINCIPALE ET DÉMARRAGE
// =====================================================================
let dernierTs = 0, verifT = 0;
// Revenu de secours (escarmouche, novembre 2026) : un camp qui a un QG ou un dépôt prêt mais plus aucun
// collecteur, ni en service ni en file, et moins que le prix d'un collecteur en réserve, reçoit
// REVENU_SECOURS par seconde, de quoi en racheter un en une minute environ. Avant, un camp ruiné ne se
// relevait plus (fréquent à plusieurs camps). Le joueur en est averti une fois par partie. Pas en
// mission : leur équilibre est réglé sans lui. Rien quand il ne reste plus de minerai sur la carte.
const REVENU_SECOURS = 7;
let secoursT = 0, secoursCamps = new Set();
function revenuSecours(dt){
  if(MISSION || window.MODE_DEMO) return;
  secoursT -= dt;
  if(secoursT <= 0){
    // Revu une fois par seconde (économie de calcul).
    secoursT = 1; secoursCamps = new Set();
    if(!noeuds.some(n => n.reste > 0)) return;
    const prix = UNITES.collecteur.cout;
    for(const id of campsEnJeu()){
      const C = camps[id];
      if(!enVie(id) || C.reserves >= prix) continue;
      const prod = FACTIONS[C.faction].production;
      let aProd = false, aColl = false;
      for(const e of ents){
        if(e.mort || e.camp !== id) continue;
        if(e.est === 'unite'){ if(e.def.collecteur){ aColl = true; break; } }
        else if(!e.enCours && (prod[e.type] || []).includes('collecteur')){
          aProd = true;
          if(e.file.includes('collecteur')){ aColl = true; break; }
        }
      }
      if(aProd && !aColl){
        secoursCamps.add(id);
        if(id === campJoueur && !C.secoursAverti){
          C.secoursAverti = true;
          message('Plus aucun collecteur : un revenu de secours vous permet d’en racheter un au QG ou au dépôt.', 'alerte');
        }
      }
    }
  }
  for(const id of secoursCamps) if(camps[id]) camps[id].reserves += REVENU_SECOURS*dt;
}
// Compaction sur place (fluidité) : garde, dans l'ordre, les éléments pour lesquels garder(x) est vrai,
// sans créer de nouveau tableau. Fonctions de tri nommées une fois pour toutes (aucune fermeture par pas).
function compacter(t, garder){
  let j = 0;
  for(let i = 0; i < t.length; i++){ const x = t[i]; if(garder(x)) t[j++] = x; }
  t.length = j;
  return t;
}
const projectileEnVol = p => !p.fini, evenementAVenir = ev => !ev.fait, effetVivant = f => f.vie > 0, entiteVivante = e => !e.mort;
function miseAJour(dt){
  if(surprise.gel) return;  // cinématique ou dialogue du mode Surprises : la simulation est figée
  temps += dt;
  for(const k in population) population[k] = 0;
  for(const e of ents) if(e.est === 'unite' && !e.mort) population[e.camp] = (population[e.camp] || 0) + 1;
  for(const id of campsEnJeu()){
    const C = camps[id];
    C.points += dt/45;
    for(const k in C.recharges) C.recharges[k] = Math.max(0, C.recharges[k] - dt);
  }
  revenuSecours(dt);
  for(let i=0; i<ents.length; i++){
    const e = ents[i]; if(e.mort) continue;
    if(e.est === 'unite') majUnite(e, dt); else majBatiment(e, dt);
  }
  separer(dt);
  // Fluidité (13 novembre 2026) : les tableaux sont compactés sur place au lieu d'être recréés par
  // filter à chaque pas. Même ordre de traitement qu'avant : la boucle à index suit la longueur
  // courante, comme for…of, donc un projectile ou un événement ajouté pendant la boucle est traité
  // dans le même pas ; et si le tableau a été remplacé entre-temps, c'est le nouveau qui est compacté.
  const P = projectiles;
  for(let i = 0; i < P.length; i++){
    const p = P[i];
    p.t += dt;
    if(p.cible) guiderProjectile(p, dt);
    if(p.t >= p.duree){ p.fini = true; impactProjectile(p); }
  }
  compacter(projectiles, projectileEnVol);
  const E = evenements;
  for(let i = 0; i < E.length; i++){ const ev = E[i]; ev.t -= dt; if(ev.t <= 0){ ev.fait = true; ev.fn(); } }
  compacter(evenements, evenementAVenir);
  for(let i = 0; i < effets.length; i++) effets[i].vie -= dt;
  compacter(effets, effetVivant);
  let morts = false;
  for(let i = 0; i < ents.length; i++) if(ents[i].mort){ morts = true; break; }
  if(morts){
    compacter(ents, entiteVivante);
    if(selection.some(e => e.mort)) selectionner(selection.filter(e => !e.mort));
  }
  majIA(dt);
  if(MISSION){
    majMission(dt);
    // La radio et la fin de mission avancent avec le temps de jeu, même sans boucle d'affichage
    // (onglet en arrière-plan, simulations de test).
    majRadio();
    verifierDebriefing();
  } else {
    if(surprise.actif) majSurprise(dt);
    verifT -= dt;
    if(verifT <= 0){ verifT = 1; verifierFin(); }
  }
}
// Projectiles. Structure commune : {sx, sy, tx, ty, t, duree, degats, zone, arme, camp, auteur}.
// Champs facultatifs : genre ('missileAir', 'bombe', 'plasma' ; absent = roquette d'artillerie),
// cible (entité suivie : projectile guidé), h1 / h2 (hauteurs de départ et d'arrivée, pour le rendu).
// Guidage : une bombe corrige sa chute vers une cible qui bouge, dans la limite de GUIDAGE_BOMBE px/s ;
// tout autre projectile guidé suit exactement sa cible (missile air-air, tir à tête chercheuse).
function guiderProjectile(p, dt){
  const c = p.cible;
  if(c.mort){ p.cible = null; return; }
  if(p.genre === 'bombe'){
    const dx = c.x - p.tx, dy = c.y - p.ty, d = Math.hypot(dx, dy), v = GUIDAGE_BOMBE*dt;
    if(d <= v){ p.tx = c.x; p.ty = c.y; } else { p.tx += dx/d*v; p.ty += dy/d*v; }
  } else { p.tx = c.x; p.ty = c.y; p.h2 = hauteurVisee(c); }
}
// Arrivée d'un projectile : explosion de zone (roquette, bombe, tout projectile qui a une zone),
// sinon coup direct sur la cible suivie (missile air-air), si elle vit encore.
function impactProjectile(p){
  const auteur = p.auteur && !p.auteur.mort ? p.auteur : {camp:p.camp, est:'pouvoir'};
  if(!(p.zone > 0)){
    const c = p.cible;
    if(c && !c.mort) infliger(c, p.degats * efficacite(p.arme, c), auteur);
    effet('explosion', {x:p.tx, y:p.ty, h:p.h2 || 0, r:13, duree:0.35});
    return;
  }
  explosionZone(p.tx, p.ty, p.zone, p.degats, p.arme, auteur, p.genre === 'bombe' ? 0.1 : undefined);
  if(p.genre === 'bombe'){
    effet('explosion', {x:p.tx, y:p.ty, h:0, r:p.zone*0.75, duree:0.8, grande:true});
    brulure(p.tx, p.ty, p.zone*0.45);
  } else effet('explosion', {x:p.tx, y:p.ty, h:0, r:20, duree:0.45});
}
const NAPPE_SOL = [], NAPPE_AIR = [], NAPPE_AVIONS = [];
function separer(dt){
  // Trois nappes qui ne se gênent pas : le sol, les drones, les avions en vol libre (un avion posé,
  // qui roule, décolle ou se pose suit sa trajectoire sans être poussé).
  // Fluidité : un seul passage sur ents remplit trois tableaux réutilisés d'un pas à l'autre (avant :
  // trois filter par pas). Mêmes critères et même ordre qu'avant.
  const sol = NAPPE_SOL, air = NAPPE_AIR, avions = NAPPE_AVIONS;
  sol.length = 0; air.length = 0; avions.length = 0;
  for(let i = 0; i < ents.length; i++){
    const e = ents[i];
    if(e.est !== 'unite') continue;
    if(!e.def.aerien) sol.push(e);
    else if(!e.def.avion && e.def.forme !== 'vaisseauMere') air.push(e);
    if(e.def.avion && e.phase === 'vol') avions.push(e);
  }
  const k = Math.min(1, dt*10);
  for(let n = 0; n < 3; n++){
    const liste = n === 0 ? sol : n === 1 ? air : avions;
    for(let i=0; i<liste.length; i++){
      const a = liste[i];
      for(let j=i+1; j<liste.length; j++){
        const b = liste[j], dx = b.x-a.x, dy = b.y-a.y, min = a.rayon + b.rayon;
        if(Math.abs(dx) > min || Math.abs(dy) > min) continue;
        let d = Math.hypot(dx,dy);
        if(d >= min) continue;
        let ux, uy;
        if(d < 0.01){ ux = Math.random()-.5; uy = Math.random()-.5; d = 0.01; const n = Math.hypot(ux,uy); ux/=n; uy/=n; }
        else { ux = dx/d; uy = dy/d; }
        const p = (min - d)/2 * k;
        const ax = a.x - ux*p, ay = a.y - uy*p, bx = b.x + ux*p, by = b.y + uy*p;
        if(a.def.aerien || libre(ax,ay)){ a.x = ax; a.y = ay; }
        if(b.def.aerien || libre(bx,by)){ b.x = bx; b.y = by; }
      }
    }
  }
  for(const u of sol){
    if(libre(u.x,u.y)) continue;
    const p = plusProcheLibre(Math.floor(u.x/TUILE), Math.floor(u.y/TUILE));
    if(!p) continue;
    const tx = (p[0]+.5)*TUILE, ty = (p[1]+.5)*TUILE, d = Math.hypot(tx-u.x, ty-u.y), v = 160*dt;
    if(d <= v){ u.x = tx; u.y = ty; } else { u.x += (tx-u.x)/d*v; u.y += (ty-u.y)/d*v; }
  }
}
// Éliminations : un camp sans bâtiment est éliminé (message à tous) ; son ordinateur s'arrête, ses
// unités restantes combattent encore. Appelé chaque seconde par verifierFin.
function verifierEliminations(){
  for(const id of campsEnJeu()){
    const C = camps[id];
    if(C.elimine || ents.some(e => e.camp === id && e.est === 'batiment' && !e.mort)) continue;
    C.elimine = true; C.elimineT = temps;
    const qui = id === campJoueur ? 'Votre camp' : 'Le camp ' + nomCamp(id).toLowerCase() + ' (' + faction(id).nom + (camps[id].equipe ? ', équipe ' + camps[id].equipe : '') + ')';
    message(qui + ' est éliminé.', id === campJoueur || allies(id, campJoueur) ? 'alerte' : 'succes');
  }
}
// Sort de chaque camp, pour l'écran de fin et les outils de test.
function sortDesCamps(){
  const r = {};
  for(const id of campsEnJeu()){ const C = camps[id]; r[id] = {faction:C.faction, equipe:equipeDe(id), ia:!!C.ia, elimine:!!C.elimine, t:C.elimine ? Math.round(C.elimineT) : null}; }
  return r;
}
function tableauCamps(victoire){
  const lignes = campsEnJeu().map(id => {
    const C = camps[id], coul = couleurCamp(id) || faction(id).couleur;
    const etat = C.elimine ? 'éliminé à ' + enMinSec(C.elimineT) : (equipeDe(id) === equipeDe(campJoueur) ? (victoire ? 'vainqueur' : 'vaincu') : (victoire ? 'vaincu' : 'vainqueur'));
    return `<tr><td><span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:${coul};margin-right:6px"></span>${echapper(nomCamp(id))}${id === campJoueur ? ' (vous)' : ''}</td>
      <td>${echapper(faction(id).nom)}</td><td>équipe ${echapper(equipeDe(id))}</td><td><b>${etat}</b></td></tr>`;
  }).join('');
  return `<table>${lignes}</table>`;
}
// Fin d'une escarmouche. L'équipe du joueur gagne quand toutes les équipes adverses sont éliminées.
// Le joueur éliminé perd la partie, même si un allié tient encore (choix par défaut, à confirmer).
function verifierFin(){
  if(window.MODE_DEMO) return;
  verifierEliminations();
  const batsJ = enVie(campJoueur);
  const batsI = campsEnJeu().some(id => enVie(id) && equipeDe(id) !== equipeDe(campJoueur));
  // Mode Surprises, envahisseurs arrivés : voir finInvasion (null tant que la partie continue).
  const finX = finInvasion(batsJ, batsI);
  if(finX === null) return;
  if(!finX && batsJ && batsI) return;
  partieFinie = true;
  const victoire = finX ? finX.victoire : !batsI, F = faction(campJoueur);
  const recit = finX ? finX.texte : (victoire ? F.victoire : F.defaite);
  issuePartie = {victoire, alliance, t:temps, camps:sortDesCamps()};   // lu par les outils de test (testerEscarmouche)
  if(window.R3D && typeof R3D.assombrir === 'function' && (!finX || finX.victoire)){ try { R3D.assombrir(0); } catch(err){} }
  el('finContenu').innerHTML = `<h1 style="color:${victoire ? '#6fd67c' : '#ff7a5c'}">${victoire ? 'VICTOIRE' : 'DÉFAITE'}</h1>
    <p class="recit">${recit}</p>
    ${campsEnJeu().length > 2 || couleurCamp(campJoueur) ? tableauCamps(victoire) : ''}
    <table><tr><td>Durée</td><td><b>${enMinSec(temps)}</b></td></tr>
    <tr><td>Unités produites</td><td><b>${stats.produites}</b></td></tr>
    <tr><td>Pertes (unités et bâtiments)</td><td><b>${stats.perdues}</b></td></tr>
    <tr><td>Ennemis détruits (unités et bâtiments)</td><td><b>${stats.detruites}</b></td></tr></table>
    <button class="grand" onclick="location.href=location.pathname">Retour au menu</button>`;
  el('fin').classList.remove('cache');
  jouerMusique(victoire ? 'victoire' : 'defaite');
}
function boucle(ts){
  const brut = dernierTs ? (ts - dernierTs)/1000 : 0;
  dernierTs = ts;
  const dt = Math.min(0.05, brut);
  if(enJeu && surprise.etat === 'cinematique'){
    avancerCinematique(Math.min(0.1, brut));   // mode Surprises : la cinématique pilote caméra et rendu
  } else if(enJeu){
    if(!enPause && !partieFinie) miseAJour(dt);
    deplacerCamera(Math.min(0.05, brut));
    dessiner(enPause || partieFinie ? 0 : dt);   // tout se fige en pause et après la fin de partie
    // Barre du haut, panneau et barre de construction (fluidité) : 10 fois par seconde, et tout de
    // suite après un clic ou une touche (interfaceAJour), pour que la réponse reste immédiate.
    if(interfaceAJour || ts - interfaceT >= 100 || ts < interfaceT){
      interfaceAJour = false; interfaceT = ts;
      majBarre();
      majPanneau();
      majFabrique();
    }
    if(MISSION){
      majRadio();
      if(Math.floor(ts/500) !== Math.floor((ts - brut*1000)/500)) majObjectifsDOM(false);
      verifierDebriefing();   // aussi appelé par miseAJour : afficherDebriefing ne passe qu'une fois (partieFinie)
    }
  } else if(window.R3D && R3D.pret){
    // Fond animé derrière le menu
    R3D.vue.x = LARG/2 + Math.sin(ts/9000)*500; R3D.vue.y = 1250;
    R3D.majCamera(); R3D.Batiments.sync(ents, noeuds, ts/1000, dt); R3D.rendre(ts/1000, dt);
    if(!briefingPret) activerCommencer();   // première image rendue : le briefing peut être validé
  }
  majMusique(Math.min(0.25, brut));
  majSuspensionVignettes(ts);
  majAffichagePerf(ts, brut);
  requestAnimationFrame(boucle);
}
// ---------- Fluidité (13 novembre 2026) ----------
// Interface : rafraîchie au plus 10 fois par seconde, et tout de suite après une action du joueur.
let interfaceT = -1e9, interfaceAJour = true;
for(const t of ['pointerdown', 'pointerup', 'keydown', 'wheel']) addEventListener(t, () => { interfaceAJour = true; }, {capture:true, passive:true});
// Onglet caché : le navigateur suspend la boucle d'affichage ; au retour, la première image repart
// d'un écart nul (aucun pas de rattrapage, aucun saut de musique ni de caméra).
document.addEventListener('visibilitychange', () => { dernierTs = 0; interfaceAJour = true; });
// Vignettes des boutons (r3d-vignettes.js) : leur production est suspendue pendant le chargement
// (jusqu'à 1,5 s après la première image), les cinématiques et les grosses batailles (au moins
// SEUIL_BATAILLE projectiles et effets en cours ; reprise après 3 s sous ce seuil).
const SEUIL_BATAILLE = 40;
let vignettesSuspendues = null, chargementFinT = null, batailleT = -1e9;
function suspendreVignettes(oui){
  if(vignettesSuspendues === oui) return;
  vignettesSuspendues = oui;
  try { if(window.R3D && R3D.Vignettes && typeof R3D.Vignettes.suspendre === 'function') R3D.Vignettes.suspendre(oui); }
  catch(err){ console.warn('[R3D.Vignettes] suspendre :', err); }
}
function majSuspensionVignettes(ts){
  if(chargementFinT === null && window.R3D && R3D.pret) chargementFinT = ts + 1500;
  if(enJeu && projectiles.length + effets.length >= SEUIL_BATAILLE) batailleT = ts;
  const charge = chargementFinT === null || ts < chargementFinT;
  const cine = enJeu && surprise.etat === 'cinematique';
  suspendreVignettes(charge || cine || (enJeu && ts - batailleT < 3000));
}
// Préchauffage des shaders (contrat commun, r3d-scene.js) : toutes les compilations ont lieu pendant
// « Chargement… », pas en pleine partie. Sans R3D.prechauffer (module plus ancien), rien ne se passe.
function prechaufferRendu(){
  if(!window.R3D || typeof R3D.prechauffer !== 'function') return;
  const t = performance.now();
  try { R3D.prechauffer(); } catch(err){ console.warn('[R3D] préchauffage impossible :', err); }
  dureePrechauffage = Math.round(performance.now() - t);
}
let dureePrechauffage = null;
// Résolution adaptative (case du menu, activée par défaut, mémorisée) : règle R3D.adaptatif.
const CLE_ADAPTATIF = 'frontDeSel.resolutionAdaptative';
let resolutionAdaptative = true;
try { resolutionAdaptative = localStorage.getItem(CLE_ADAPTATIF) !== 'non'; } catch(err){ /* sans mémorisation */ }
function reglerAdaptatif(oui, memoriser){
  resolutionAdaptative = !!oui;
  if(memoriser){ try { localStorage.setItem(CLE_ADAPTATIF, oui ? 'oui' : 'non'); } catch(err){} }
  if(window.R3D) R3D.adaptatif = resolutionAdaptative;
}
// Affichage des performances (case de la fenêtre Commandes, mémorisée ; touche F8) : images par
// seconde, millisecondes par image, appels de dessin, triangles et résolution, 4 fois par seconde.
const CLE_PERF = 'frontDeSel.afficherPerf';
let afficherPerf = false;
try { afficherPerf = localStorage.getItem(CLE_PERF) === 'oui'; } catch(err){}
const compteurPerf = {t0:0, images:0, msLisse:0};
function reglerAffichagePerf(oui, memoriser){
  afficherPerf = !!oui;
  if(memoriser){ try { localStorage.setItem(CLE_PERF, oui ? 'oui' : 'non'); } catch(err){} }
  const c = el('perfCase'); if(c) c.checked = afficherPerf;
  const p = el('perfAff'); if(p) p.classList.toggle('cache', !afficherPerf);
  compteurPerf.t0 = 0;
}
function majAffichagePerf(ts, brut){
  if(!afficherPerf) return;
  const C = compteurPerf;
  C.images++;
  if(brut > 0) C.msLisse = C.msLisse ? C.msLisse*0.9 + brut*1000*0.1 : brut*1000;
  if(!C.t0){ C.t0 = ts; C.images = 0; return; }
  if(ts - C.t0 < 250) return;
  const ips = C.images*1000/(ts - C.t0);
  C.t0 = ts; C.images = 0;
  let P = null;
  try { if(window.R3D && typeof R3D.perf === 'function') P = R3D.perf(); } catch(err){ P = null; }
  const info = window.R3D && R3D.renderer && R3D.renderer.info ? R3D.renderer.info.render : null;
  const ms = P && isFinite(P.ms) ? P.ms : C.msLisse;
  const appels = P && isFinite(P.appels) ? P.appels : info ? info.calls : null;
  const tri = P && isFinite(P.triangles) ? P.triangles : info ? info.triangles : null;
  const ech = P && isFinite(P.echelle) ? P.echelle : (window.R3D && R3D.renderer ? R3D.renderer.getPixelRatio() : null);
  const cv3 = window.R3D && R3D.renderer ? R3D.renderer.domElement : null;
  const lignes = [Math.round(ips) + ' images/s · ' + ms.toFixed(1) + ' ms',
    'appels : ' + (appels == null ? '?' : appels) + ' · triangles : ' + (tri == null ? '?' : (tri >= 1e6 ? (tri/1e6).toFixed(2) + ' M' : Math.round(tri/1000) + ' k')),
    'résolution : ' + (ech == null ? '?' : '×' + ech.toFixed(2)) + (cv3 ? ' (' + cv3.width + '×' + cv3.height + ')' : '') + ' · ' + qualiteGraphique];
  ecrireTexte(el('perfAff'), lignes.join('\n'));
}

const TEXTE_COMMANDES = `
 <b>Clic gauche</b> : sélectionner · <b>glisser</b> : sélection multiple<br>
 <b>Double-clic</b> : toutes les unités du même type à l’écran<br>
 <b>Maj + clic</b> : ajouter / retirer de la sélection<br>
 <b>Clic droit</b> : se déplacer, attaquer ; collecteurs sur un champ de minerai : y récolter ;
 ouvriers sur un bâtiment entamé : le réparer<br>
 <b>Barre de construction</b> (en bas, à droite) : onglets Bâtiments, Infanterie, Véhicules, Aviation.
 Clic : construire ou mettre en file (l’ouvrier libre ou le bâtiment le moins chargé s’en charge) ·
 clic droit : retirer de la file · survol : fiche détaillée · <b>F1 à F4</b> : changer d’onglet<br>
 <b>Réparateurs</b> (mécano, infirmier, atelier, dépanneuse) : clic droit sur un allié blessé pour le soigner ;
 sans ordre, ils soignent seuls les blessés proches<br>
 <b>Clic droit</b> avec un bâtiment sélectionné : point de ralliement<br>
 <b>A</b> puis clic : attaque-déplacement · <b>S</b> : arrêt (avions : retour à l’aéroport)<br>
 <b>Ctrl + 1…9</b> : créer un groupe · <b>1…9</b> : le rappeler<br>
 <b>Flèches</b>, ou <b>curseur contre un bord</b> de la fenêtre (diagonales comprises) : déplacer la vue ;
 option « Défilement au bord » du menu ou de la fenêtre Commandes<br>
 <b>Molette</b>, <b>+</b> / <b>−</b> ou <b>Page préc.</b> / <b>Page suiv.</b> : zoom (maintenir la touche)<br>
 <b>Minicarte</b> : clic pour s’y rendre, clic droit pour y envoyer la sélection<br>
 <b>H</b> : revenir au QG · <b>Espace</b> : aller à la dernière alerte<br>
 <b>P</b> : pause · <b>Échap</b> ou clic droit : annuler<br>
 <b>Maj</b> en plaçant un bâtiment : en placer plusieurs<br>
 <b>M</b> : musique · <b>O</b> : replier les objectifs (mission) · <b>F8</b> : afficher les performances<br>
 <b>Avions</b> : clic droit au sol : point d’attente, ils y tournent en cercle ·
 clic droit sur un ennemi : passes d’attaque · <b>S</b> : retour à l’aéroport<br>
 <b>Escarmouche</b> : détruire tous les bâtiments adverses.`;

// Deux collecteurs près du QG d'un camp (départ d'escarmouche, de mission, ou QG apparu en mission),
// s'il reste du minerai sur la carte. Ils partent d'eux-mêmes vers le champ le plus proche.
function doterCollecteurs(camp, qg){
  if(!qg || !camps[camp] || !noeuds.some(n => n.reste > 0)) return [];
  const res = [];
  for(let k=0;k<2;k++){
    const p = positionSortie(qg);
    const u = creerUnite('collecteur', camp, p.x + (k ? 34 : -34), p.y + 10);
    const n = champPour(u); if(n) u.ordre = ordreRecolte(n);
    res.push(u);
  }
  return res;
}
// ---------- Configuration des camps d'escarmouche ----------
// Une configuration est la liste ordonnée des camps : [{id, faction, equipe, ia}, ...]. Le premier est
// le joueur local (id 'J'), les suivants I, K, L. Sans configuration : duel classique J contre I.
const EQUIPES = ['A', 'B', 'C', 'D'];
// Effectif maximal par camp selon le nombre de camps (fluidité). Baissé le 13 novembre 2026 (avant :
// 45 et 35) après une mesure à 4 camps : le décor seul fait ~150 appels de dessin et 1,3 million de
// triangles ; une unité, moins d'un appel (modèles instanciés) et 1 000 à 3 400 triangles ; un
// bâtiment, 6 à 15 appels. Le gain de cette baisse reste modeste (voir NOTES-CONCEPTION.md).
const POP_PAR_CAMPS = {2:60, 3:40, 4:30};
function configurationDuel(facJ){
  const f = FACTIONS[facJ] && facJ !== 'neutre' && facJ !== 'aliens' ? facJ : 'halden';
  return [{id:'J', faction:f, equipe:'A', ia:false}, {id:'I', faction:f === 'halden' ? 'karsk' : 'halden', equipe:'B', ia:true}];
}
// Contrôle d'une configuration (fonction pure) : renvoie null si elle est jouable, sinon la raison.
function problemeConfiguration(liste, nbEmplacements){
  if(!Array.isArray(liste) || liste.length < 2) return 'Il faut au moins deux camps.';
  if(liste.length > CAMPS_JOUEURS.length) return 'Quatre camps au plus.';
  if(!liste[0] || liste[0].id !== 'J' || liste[0].ia) return 'Le premier camp doit être le joueur (J).';
  const ids = new Set();
  for(const k of liste){
    if(!k || !CAMPS_JOUEURS.includes(k.id) || ids.has(k.id)) return 'Camp invalide : ' + (k && k.id);
    ids.add(k.id);
    if(k.faction !== 'halden' && k.faction !== 'karsk') return 'Faction invalide pour ' + k.id + '.';
    if(!EQUIPES.includes(k.equipe)) return 'Équipe invalide pour ' + k.id + '.';
  }
  if(!liste.some(k => k.equipe !== liste[0].equipe)) return 'Aucun ennemi : mettez au moins un camp dans une autre équipe.';
  if(nbEmplacements != null && liste.length > nbEmplacements) return 'Cette carte n’a que ' + nbEmplacements + ' emplacements de départ.';
  return null;
}
// Répartition des emplacements de départ (fonction pure) : liste des camps, emplacements [{c, r}] ->
// indice d'emplacement pour chaque camp, dans l'ordre de la liste. À deux camps : emplacements 0 et 1
// (comme avant). Au-delà : la répartition qui éloigne le plus les ennemis et rapproche le plus les alliés
// (somme des distances entre ennemis moins somme des distances entre alliés) ; à égalité, la première
// trouvée (le joueur d'abord sur l'emplacement 0).
function repartirEmplacements(liste, empl){
  const n = liste.length;
  if(empl.length < n) return null;
  if(n === 2) return [0, 1];
  const P = empl.map(b => ({x:(b.c + 1.5)*TUILE, y:(b.r + 1.5)*TUILE}));
  let best = null, bs = -Infinity;
  const choix = [];
  const essayer = () => {
    if(choix.length === n){
      let s = 0;
      for(let i = 0; i < n; i++) for(let j = i + 1; j < n; j++){
        const d = Math.hypot(P[choix[i]].x - P[choix[j]].x, P[choix[i]].y - P[choix[j]].y);
        s += liste[i].equipe === liste[j].equipe ? -d : d;
      }
      if(s > bs + 1e-6){ bs = s; best = choix.slice(); }
      return;
    }
    for(let k = 0; k < empl.length; k++) if(!choix.includes(k)){ choix.push(k); essayer(); choix.pop(); }
  };
  essayer();
  return best;
}
function demarrer(facJ, config){
  const diff = DIFFICULTES[difficulte];
  const empl = emplacementsCarte(CARTE);
  let liste = Array.isArray(config) ? config : configurationDuel(facJ);
  const pb = problemeConfiguration(liste, Math.max(2, empl.length));
  if(pb){ console.warn('[Escarmouche] configuration refusée (' + pb + ') : duel classique.'); liste = configurationDuel(liste && liste[0] ? liste[0].faction : facJ); }
  camps = {};
  reinitialiserIA();
  secoursCamps = new Set(); secoursT = 0;   // revenu de secours (voir revenuSecours)
  campJoueur = 'J';
  liste.forEach((k, i) => {
    camps[k.id] = {id:k.id, faction:k.faction, equipe:k.equipe, couleur:k.couleur || COULEURS_CAMPS[k.id], ia:!!k.ia,
      elimine:false, elimineT:null, emplacement:null, reserves:1000, points:0, recharges:{}};
    pouvoirsActifs[k.id] = true;
    if(k.ia){
      const E = etatIA(k.id);
      // k.niveau (outils de test) : difficulté propre à ce camp ; sinon celle du menu.
      if(k.niveau && DIFFICULTES[k.niveau]) E.niveau = k.niveau;
      const dk = DIFFICULTES[E.niveau] || diff;
      E.revenu = dk.revenu; E.premiereVague = dk.premiereVague; E.vague = dk.vague; E.frappeT = 0;
      E.t = Math.max(0, (i - 1)*0.2);   // réflexions décalées d'un ordinateur à l'autre
    }
  });
  camps.N = {id:'N', faction:'neutre', reserves:0, points:0, recharges:{}};
  camps.X = {id:'X', faction:'aliens', reserves:0, points:0, recharges:{}};   // envahisseurs (mode Surprises)
  popMax = POP_PAR_CAMPS[liste.length] || 60;
  if(!CARTE.bases) avertirCarte('pas de bases d’escarmouche : emplacements par défaut.');
  const rep = empl.length >= liste.length ? repartirEmplacements(liste, empl) : null;
  const departs = liste.map((k, i) => {
    const base = rep ? empl[rep[i]] : (i === 0 ? basesCarte.J : basesCarte.I);
    camps[k.id].emplacement = rep ? rep[i] : i;
    basesCarte[k.id] = base;
    return [k.id, base];
  });
  for(const [camp, base] of departs){
    const F = faction(camp), qg = creerBatiment('qg', camp, base.c, base.r, true);
    // Trois ouvriers (ils construisent et réparent) et deux collecteurs (ils récoltent).
    for(let k=0;k<3;k++){
      const p = positionSortie(qg);
      creerUnite(F.ouvrier, camp, p.x + (k-1)*18, p.y);
    }
    doterCollecteurs(camp, qg);
    const fant = F.production.caserne[0];
    for(let k=0;k<3;k++){ const p = positionSortie(qg); creerUnite(fant, camp, p.x + (k-1)*20, p.y + 40); }
  }
  stats.produites = 0; stats.perdues = 0; stats.detruites = 0;
  el('menu').classList.add('cache');
  for(const id of ['barre','panneau','mini']) el(id).classList.remove('cache');
  el('bAbandon').textContent = 'Quitter';
  construireBarrePouvoirs();
  R3D.vue.distance = 820;
  const q = ents.find(b => b.camp === campJoueur && b.type === 'qg'); centrerSur(q.x, q.y + 120);
  enJeu = true;
  if(liste.length <= 2) message(CARTE.nom + '. Tenez les champs de minerai et détruisez la base adverse.', 'succes');
  else {
    const n = liste.filter(k => k.equipe !== liste[0].equipe).length, a = liste.length - 1 - n;
    message(CARTE.nom + '. ' + liste.length + ' camps : ' + n + ' adversaire' + (n > 1 ? 's' : '') + (a ? ', ' + a + ' allié' + (a > 1 ? 's' : '') : '') +
      '. Détruisez toutes les bases adverses.', 'succes');
  }
  construireBandeauCamps();
  jouerMusique('calme');
  if(!window.MODE_DEMO) preparerSurprises();
}

// ---------- Mode démonstration (?demo) : vitrine de toutes les unités et de tous les bâtiments ----------
// Sert à vérifier le rendu (carte Port-Calmes). Points de vue : demoVue('combat' | 'baseJ' | 'baseI' | 'usine' | 'cote' |
// 'unites' | 'defenses' | 'aeroport' | 'aeroportI' | 'aliens').
const VUES_DEMO = {
  combat:{x:1600, y:1000, d:700}, baseJ:{x:560, y:1000, d:760}, baseI:{x:2640, y:1000, d:760},
  usine:{x:1600, y:1700, d:650}, cote:{x:900, y:1800, d:900}, unites:{x:1600, y:780, d:420}, large:{x:1600, y:1100, d:1700},
  defenses:{x:1600, y:1380, d:520}, aeroport:{x:800, y:900, d:470}, aeroportI:{x:2440, y:900, d:470},
  aliens:{x:1600, y:230, d:1250},
};
function demoVue(nom){ const v = VUES_DEMO[nom] || VUES_DEMO.combat; R3D.vue.x = v.x; R3D.vue.y = v.y; R3D.vue.distance = v.d; R3D.majCamera(); }
function lancerDemo(){
  window.MODE_DEMO = true;
  difficulte = 'normal';
  demarrer('halden');
  ia.active = false;
  camps[campJoueur].reserves = camps.I.reserves = 99999; camps[campJoueur].points = camps.I.points = 30;
  // Bases complètes des deux camps
  const bJ = [['caserne',14,19],['usine',14,26],['relais',9,19],['caserne',5,28]];
  const bI = [['caserne',64,19],['usine',63,26],['depot',69,19],['depot',73,28]];
  for(const [t,c,r] of bJ) creerBatiment(t, 'J', c, r, true);
  for(const [t,c,r] of bI) creerBatiment(t, 'I', c, r, true);
  const chJ = creerBatiment('caserne', 'J', 5, 14, false); chJ.progres = 0.45;
  const chI = creerBatiment('usine', 'I', 70, 32, false); chI.progres = 0.7;
  for(const ch of [chJ, chI]) ch.pv = ch.pvMax*(0.1 + 0.9*ch.progres);
  const uJ = ents.find(b => b.camp === campJoueur && b.type === 'usine'); uJ.file = ['bastion']; uJ.prodT = 5;
  // Défenses et installations civiles (vue 'defenses')
  creerBatiment('tourelle', 'J', 37, 33, true); creerBatiment('bunker', 'I', 42, 33, true);
  creerBatiment('batterie', 'J', 39, 33, true); creerBatiment('batterie', 'I', 44, 33, true);
  creerBatiment('station', 'N', 36, 36, true); creerBatiment('entrepot', 'N', 42, 36, true);
  for(let k=0;k<2;k++){ const u = creerUnite('convoi', 'N', 1560 + k*60, 1300); u.angle = 0; }
  // Aviation (vues 'aeroport' et 'aeroportI') : un aéroport par camp, deux avions stationnés et un
  // en vol, qui tourne autour de son point d'attente au-dessus de la base. Les trois types sont
  // visibles au sol, sur l'un ou l'autre aéroport.
  const aviation = [['J', 18, 20, ['f15', 'f35'], 'rafale', 800, 640], ['I', 59, 20, ['rafale', 'f15'], 'f35', 2440, 640]];
  for(const [camp, c, r, auSol, enLAir, ax, ay] of aviation){
    const a = creerBatiment('aeroport', camp, c, r, true);
    auSol.forEach((t, i) => stationnerAvion(creerUnite(t, camp, a.x, a.y), a, i));
    const u = creerUnite(enLAir, camp, ax, ay);      // créé en vol, en attente autour de (ax, ay)
    u.base = a; u.place = 2;
  }
  // Vitrine alignée de toutes les unités (vue 'unites')
  // Deux rangées par camp : ouvrier et infanterie (mitraillette, bazooka, sniper), puis véhicules.
  // (Novembre 2026 : réparateurs, DCA Rempart et hélicoptères en bout de rangée.)
  const tous = [['technicien','operateur','javelot','traqueur','mecano','frelon'], ['collecteur','lynx','faucheur','bastion','rempart','atelier','busard'],
    ['sapeur','conscrit','grenadier','guetteur','infirmier','taon'], ['collecteur','ours','grele','sentinelle','depanneuse','vautour']];
  tous.forEach((rangee, j) => rangee.forEach((t, i) => {
    const camp = j < 2 ? 'J' : 'I';
    const u = creerUnite(t, camp, 1440 + i*80, 660 + j*65);
    u.angle = u.angleT = camp === campJoueur ? 0 : Math.PI;
    if(u.def.collecteur){ u.charge = u.def.capacite*0.6; u.recolteT = 0; u.gare = true; }
  }));
  // Combat au centre (vue 'combat')
  const groupeJ = ['bastion','bastion','lynx','lynx','faucheur','faucheur','operateur','operateur','operateur','operateur'];
  const groupeI = ['ours','ours','grele','sentinelle','conscrit','conscrit','conscrit','conscrit','conscrit','conscrit'];
  groupeJ.forEach((t,i) => { const u = creerUnite(t, 'J', 1420 + (i%3)*40, 950 + Math.floor(i/3)*40); u.ordre = {type:'attaqueDeplacement', x:1800, y:1000}; });
  groupeI.forEach((t,i) => { const u = creerUnite(t, 'I', 1790 + (i%3)*40, 950 + Math.floor(i/3)*40); u.ordre = {type:'attaqueDeplacement', x:1400, y:1000}; });
  selectionner(ents.filter(u => u.camp === campJoueur && u.type === 'bastion'));
  // Envahisseurs du mode Surprises (vue 'aliens') : le vaisseau-mère au nord, des dards et des rôdeurs
  // sous lui. Vitrine seulement : le vaisseau plane sans combattre (champ demo), et le groupe se tient
  // hors de portée de la vitrine des unités.
  const vm = creerUnite('vaisseauMere', 'X', 1600, 120);
  Object.assign(vm, {demo:true, alt:UNITES.vaisseauMere.alt, angle:0.3, bouclier:6000, bouclierMax:6000, charge:0, cibleRayon:null});
  // Dards et rôdeurs : figurants (champ demo), ni attaquants ni cibles.
  for(let k=0;k<5;k++){ const d = creerUnite('dard', 'X', 1480 + k*60, 380 - Math.abs(k-2)*25); d.angle = d.angleT = Math.PI/2; d.demo = true; }
  for(let k=0;k<3;k++){ const p = pointLibre(1500 + k*100, 340); const r = creerUnite('rodeur', 'X', p.x, p.y); r.angle = r.angleT = Math.PI/2; r.demo = true; }
  // Quelques traces de bataille
  for(const [x,y] of [[1550,1080],[1680,930],[1620,1150]]) brulure(x, y, 30);
  demoVue('combat');
  if(/pause/.test(location.search)) basculerPause();
}

// Version des fichiers (paramètre ?v=… de la balise <script src="jeu.js?v=…"> de front-de-sel.html),
// reprise pour les fichiers de mission chargés à la demande.
const VERSION_FICHIERS = ((document.currentScript && /[?&]v=([^&#]+)/.exec(document.currentScript.src)) || [])[1] || '';
// Charge un fichier de mission absent du HTML (ex. campagnes/test.js) puis continue.
function chargerScriptMission(id, suite){
  const s = document.createElement('script');
  s.src = 'campagnes/' + id + '.js' + (VERSION_FICHIERS ? '?v=' + encodeURIComponent(VERSION_FICHIERS) : '');
  s.onload = suite;
  s.onerror = suite;
  document.head.appendChild(s);
}
function erreurMission(texte){
  console.warn('[Missions] ' + texte);
  MISSION = null;
  return texte;
}
function lancement(){
  el('texteCommandes').innerHTML = TEXTE_COMMANDES;
  el('texteCommandes2').innerHTML = TEXTE_COMMANDES;
  el('bPause').onclick = basculerPause;
  el('bAide').onclick = () => { if(!enPause) basculerPause(); el('aide').classList.remove('cache'); };
  el('bFermerAide').onclick = () => { el('aide').classList.add('cache'); if(enPause) basculerPause(); };
  el('bAbandon').onclick = abandonner;
  el('objTete').onclick = basculerObjectifs;
  el('radio').onclick = () => { MS.radio.finT = temps; };
  for(const id of ['bMusique', 'bMusiqueMenu']) el(id).onclick = basculerMusique;
  for(const id of ['volMusique', 'volMusiqueMenu']) el(id).oninput = ev => reglerVolume(ev.target.value/100);
  majBoutonsMusique();
  const params = new URLSearchParams(location.search);
  if(DIFFICULTES[params.get('diff')]) difficulte = params.get('diff');
  el('difficulte').value = difficulte;
  // Ultra : une phrase sous les réglages rappelle que l'ordinateur ne triche pas (et ce qu'il fait en mission).
  const noteUltra = () => { const n = el('noteUltra'); if(n) n.classList.toggle('cache', difficulte !== 'ultra'); };
  el('difficulte').onchange = () => { difficulte = el('difficulte').value; noteUltra(); };
  noteUltra();
  initInterfaceSurprises(params);
  if(QUALITES.includes(params.get('qualite'))) qualiteGraphique = params.get('qualite');
  const listeQualite = el('qualite');
  if(listeQualite){ listeQualite.value = qualiteGraphique; listeQualite.onchange = () => appliquerQualite(listeQualite.value, true); }
  // Deux cases pour un même réglage : menu d'accueil et fenêtre Commandes en jeu (13 novembre 2026).
  const casesBord = ['defilementBord', 'defilementBord2'].map(el).filter(Boolean);
  for(const c of casesBord){
    c.checked = defilementBord;
    c.onchange = () => { reglerDefilementBord(c.checked); for(const d of casesBord) d.checked = defilementBord; };
  }
  // Fluidité (13 novembre 2026) : résolution adaptative (menu) et affichage des performances (Commandes, F8).
  const caseAdapt = el('resAdaptative');
  if(caseAdapt){ caseAdapt.checked = resolutionAdaptative; caseAdapt.onchange = () => reglerAdaptatif(caseAdapt.checked, true); }
  const casePerf = el('perfCase');
  if(casePerf) casePerf.onchange = () => reglerAffichagePerf(casePerf.checked, true);
  reglerAffichagePerf(afficherPerf, false);
  // Modules indispensables : three.js et les quatre modules de rendu de base. Les autres scripts
  // (musique.js, r3d-post.js, r3d-aliens.js) sont facultatifs : le jeu démarre sans eux.
  if(typeof THREE === 'undefined' || !window.R3D || !R3D.init || !R3D.Unites || !R3D.Batiments || !R3D.Effets){
    el('menu').classList.add('cache');
    el('erreur3d').classList.remove('cache');
    return;
  }
  const idMission = params.get('mission');
  if(idMission && /^[a-z0-9_-]+$/i.test(idMission) && (typeof MISSIONS === 'undefined' || !MISSIONS[idMission])){
    if(typeof enregistrerMission === 'function'){ chargerScriptMission(idMission, () => suiteLancement(params)); return; }
  }
  suiteLancement(params);
}
function suiteLancement(params){
  const idMission = params.get('mission');
  let probleme = null;
  if(idMission){
    const M = typeof MISSIONS !== 'undefined' ? MISSIONS[idMission] : null;
    if(!M) probleme = erreurMission('mission introuvable : « ' + idMission + ' ».');
    else if(!M.carte || typeof M.carte !== 'object') probleme = erreurMission('la mission « ' + idMission + ' » n’a pas de carte.');
    else MISSION = M;
  }
  const carte = MISSION ? MISSION.carte : (typeof CARTES !== 'undefined' && (CARTES[params.get('carte')] || CARTES.portCalmes));
  if(!carte){ el('menu').classList.add('cache'); el('erreur3d').classList.remove('cache'); console.warn('[Carte] cartes.js absent.'); return; }
  // Rochers : on évite le départ de la mission (bâtiments et unités).
  const evit = [];
  if(MISSION) for(const camp of CAMPS_VALIDES) for(const e of listeOuVide((MISSION.depart || {})[camp])){
    if(!e) continue;
    if(BATIMENTS[e.type] && e.c != null){ const t = BATIMENTS[e.type].taille; evit.push({x:(e.c+t/2)*TUILE, y:(e.r+t/2)*TUILE, r:t*TUILE/2 + 110}); }
    else if(isFinite(e.x) && isFinite(e.y)) evit.push({x:e.x, y:e.y, r:110});
  }
  try { chargerCarte(carte, evit); }
  catch(err){ console.warn('[Carte] erreur au chargement, retour à Port-Calmes :', err); MISSION = null; chargerCarte(CARTES.portCalmes); }
  camps.N = {id:'N', faction:'neutre', reserves:0, points:0, recharges:{}};
  dessinerFondMinicarte();
  R3D.init(cv);
  R3D.Unites.init();
  R3D.Batiments.init();
  R3D.Effets.init();
  // Module facultatif (r3d-aliens.js) : son absence ou une panne à l'initialisation ne bloque pas le jeu.
  try { if(R3D.Aliens && R3D.Aliens.init) R3D.Aliens.init(); }
  catch(err){ console.warn('[R3D.Aliens] initialisation impossible, module ignoré :', err); R3D.Aliens = null; }
  // Vignettes des boutons (r3d-vignettes.js, facultatif) : produites en tâche de fond dès maintenant.
  // Fluidité : suspendues pendant tout le chargement (voir majSuspensionVignettes).
  suspendreVignettes(true);
  try { if(R3D.Vignettes && R3D.Vignettes.init && !vignettesInit){ vignettesInit = true; R3D.Vignettes.init(); } }
  catch(err){ console.warn('[R3D.Vignettes] initialisation impossible, pictogrammes à la place :', err); R3D.Vignettes = null; }
  if(vignettesSuspendues) { vignettesSuspendues = null; suspendreVignettes(true); }   // au cas où init remet la production en route
  appliquerQualite(qualiteGraphique, false);
  redimensionner();
  reglerAdaptatif(resolutionAdaptative, false);
  prechaufferRendu();   // compilation de tous les shaders pendant « Chargement… »
  // Cartes des factions : elles choisissent le camp du joueur ; « Lancer la partie » démarre avec les emplacements.
  for(const b of document.querySelectorAll('.carte button[data-faction]')) b.onclick = () => {
    if(!configEcran) configEcran = lireConfigCamps();
    configEcran.joueur.faction = b.dataset.faction; memoriserConfigCamps(); construireEmplacements();
  };
  const bLancer = el('bLancerEscarmouche'); if(bLancer) bLancer.onclick = lancerEscarmoucheDepuisEcran;
  el('bModeHalden').onclick = () => afficherCampagne('halden');
  el('bModeKarsk').onclick = () => afficherCampagne('karsk');
  el('bModeEscarmouche').onclick = () => {
    // Carte mémorisée (choix précédent) : on recharge la page avec elle si ce n'est pas la carte en place.
    const memo = lireCarteMemorisee();
    if(memo && memo !== CARTE.id){ rechargerAvecCarte(memo); return; }
    if(CARTE.id !== 'portCalmes' && !CARTE.bases){ location.href = location.pathname + '?diff=' + difficulte; return; }
    afficherEscarmouche();
  };
  for(const b of document.querySelectorAll('.bRetourAccueil')) b.onclick = () => {
    // L'accueil garde Port-Calmes en fond : depuis une mission ou une autre carte, on recharge la page.
    if(MISSION || CARTE.id !== 'portCalmes') location.href = location.pathname + '?diff=' + difficulte; else afficherAccueil();
  };
  if(/demo/.test(location.search)){ el('menu').classList.add('cache'); lancerDemo(); }
  else if(MISSION) afficherBriefing();
  else if(params.get('carte') && CARTE.id === params.get('carte')) afficherEscarmouche();
  else if(params.get('campagne')) afficherCampagne(params.get('campagne'));
  else afficherAccueil();
  if(probleme){ message('Impossible de charger la mission : ' + probleme, 'alerte'); }
  requestAnimationFrame(boucle);
}
lancement();
