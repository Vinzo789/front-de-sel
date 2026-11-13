# Front de Sel — notes de conception

Jeu de stratégie en temps réel original, dans un univers contemporain fictif.
Il s'inspire du genre (ouvriers bâtisseurs, factions asymétriques, points de
commandement, super-armes) sans reprendre aucun jeu existant : noms, camps,
unités, cartes, musiques et graphismes sont inventés. Seuls les trois avions
(F-15, F-35, Rafale) sont des appareils réels, sans insigne national.

État au 11 novembre 2026. C'est un prototype de loisir : il n'a été joué que
par des robots de test, jamais encore par un joueur à la souris.

## Lancer le jeu

Double-cliquer sur `front-de-sel.html`. Aucune installation n'est nécessaire,
mais **une connexion Internet est requise** : la bibliothèque 3D (three.js,
version r128) est chargée depuis cdnjs.cloudflare.com au démarrage. Sans
connexion, un message l'explique à l'écran.

Le menu propose deux campagnes, l'escarmouche, la difficulté, le volume de la
musique et la qualité des graphismes (Basse, Moyenne, Élevée). Sur un portable
à carte graphique intégrée, commencer par Moyenne, puis Basse si l'image
saccade.

## Organisation des fichiers

| Fichier | Rôle |
|---|---|
| `front-de-sel.html` | Page, styles de l'interface, chargement des scripts |
| `jeu.js` | Moteur : règles, unités, aviation, IA, missions, mode Surprises, interface, minicarte, calque 2D |
| `cartes.js` | Catalogue des cartes (format commun aux missions et à l'escarmouche) |
| `campagnes/campagnes.js` | Catalogue des campagnes et documentation du format des missions |
| `campagnes/halden-1.js` … `karsk-4.js` | Les 8 missions, en données pures |
| `musique.js` | Musique originale synthétisée dans le navigateur (8 pistes) |
| `r3d-scene.js` | Rendu 3D : caméra, lumière, ciel, terrain, mer, rivières, décor, qualité, assombrissement |
| `r3d-post.js` | Post-traitement : halo lumineux, étalonnage des couleurs, anticrénelage, occlusion ambiante |
| `r3d-unites.js` | Modèles 3D et animations des unités, des avions, des dards et des rôdeurs |
| `r3d-batiments.js` | Bâtiments des deux camps et de la Régie, aéroport, chantiers, décombres |
| `r3d-effets.js` | Particules : tirs, missiles, bombes, plasma, explosions, fumée, feu |
| `r3d-aliens.js` | Vaisseau-mère des envahisseurs, rayon, bouclier, cinématique d'arrivée |
| `r3d-vignettes.js` | Images des boutons de construction et de la fiche de sélection, tirées des vrais modèles 3D (facultatif) |

Principe : le moteur ne dessine rien en 3D. Il tient des listes d'entités et
d'effets, et les modules 3D les mettent en scène à chaque image, à travers
l'objet global `R3D`. On peut donc modifier les règles sans toucher au rendu,
et inversement.

Chaque balise `<script>` porte un numéro de version (`?v=21` au 13 novembre 2026 : équilibrage des camps mis en pause et retiré du jeu, voir plus bas). **Il faut
l'augmenter à chaque modification d'un fichier**, sinon le navigateur garde
l'ancienne version en mémoire.

## L'histoire

En 2034, après dix ans de sécheresse, la côte de Varenne abrite les trois plus
grandes usines de dessalement du continent. Le traité qui partageait la côte
expire.

- **Groupe Halden** : société militaire privée, mandatée par Varenne. Sa force
  est la technologie.
- **République de Karsk** : le voisin du nord. Sa force est le nombre.
- **Régie des eaux de Varenne** : camp civil neutre (stations, entrepôts,
  convois).
- **Réseau Mistral** : la résistance des villes portuaires, prévue pour une
  version ultérieure.
- **Les Veilleurs** : les envahisseurs du mode Surprises.

## Contenu

### Escarmouche

Une partie libre contre l'ordinateur, dans l'un des deux camps, en quatre
difficultés (Facile, Normale, Difficile, Ultra : voir plus bas). Chaque camp a trois fantassins de combat et un de soutien, des
véhicules et drones (dont une DCA et un véhicule de dépannage), deux défenses
fixes, un aéroport avec trois avions et deux hélicoptères, deux
pouvoirs dont une super-arme, et une mécanique propre (réseau de relais pour
Halden, ravitaillement pour Karsk).

Cinq cartes, au choix sur l'écran de l'escarmouche (aperçu schématique, choix
mémorisé dans le navigateur) :

| Carte (`?carte=`) | Ambiance | Caractère |
|---|---|---|
| Port-Calmes (`portCalmes`) | midi | La carte d'origine : trois passages entre les crêtes, usine sur la côte |
| Gorges de Varsèche (`gorgesVarseche`) | midi | Plateau désertique coupé par un canyon à trois cols ; champs riches au col du centre |
| Delta de l'Ombrine (`deltaOmbrine`) | aube | Fleuve à trois bras, huit ponts, aucun gué |
| Isthme de Cap-Morvent (`capMorvent`) | brume | Deux presqu'îles ; un isthme d'une dizaine de cases, seul passage terrestre ouest-est |
| Val des Brunelles (`valBrunelles`) | crépuscule | Anneau de bois ouvert par quatre allées ; quatre champs riches dans la clairière |

Les quatre nouvelles cartes ont quatre emplacements de départ (`bases` en liste
dans `cartes.js`) : l'escarmouche à deux utilise les emplacements 0 et 1 ; les
deux autres préparent un futur mode à quatre camps. Changer de carte recharge
la page (`?carte=<id>`), car le décor 3D n'est construit qu'une fois ; l'écran
d'accueil garde Port-Calmes en fond. Vérifié le 13 novembre 2026 par
simulation : bases toutes reliées, champs accessibles, l'ordinateur bâtit son
aéroport et attaque vers 3 min 30 (5 min sur Cap-Morvent quand l'ordinateur joue Halden), mode
Surprises essayé sur Cap-Morvent. Jamais jouées à la souris ; l'équité des
emplacements 2 et 3 du delta (sur les îles, plus petites) reste à juger.

### Escarmouche à 2-4 camps

- **Configuration** : sur l'écran de l'escarmouche, le joueur choisit son camp
  et son équipe ; trois emplacements d'ordinateur (Halden, Karsk, aléatoire ou
  fermé), chacun avec son équipe. Raccourcis : Duel (l'Ordinateur 1 prend
  toujours le camp contraire au joueur), Chacun pour soi, 2 contre 2, 1 contre
  3, 2 contre 1. Changer le camp du joueur fait basculer l'Ordinateur 1 s'il
  avait le camp opposé. Couleurs de camp : bleu (joueur), rouge, vert, jaune,
  jusque sur l'anneau de sélection.
- **Équipes** : les alliés ne se tirent pas dessus et l'ordinateur défend les
  bases alliées. Les emplacements sont répartis pour éloigner les adversaires
  et rapprocher les équipiers. Chaque ordinateur choisit sa cible à chaque
  vague : proximité, faiblesse, riposte contre qui l'a frappé dans les 90
  dernières secondes, et une bonne part de hasard (il ne reste pas figé sur le
  joueur).
- **Élimination** : un camp qui n'a plus de bâtiment est éliminé ; la partie
  s'arrête quand le joueur est éliminé (défaite) ou quand il ne reste plus
  aucun camp adverse à son équipe (victoire).
- **Mode Surprises** : à l'arrivée du vaisseau, l'alliance est une trêve
  générale entre tous les camps.
- **Port-Calmes à quatre** (13 novembre 2026) : les emplacements 2 et 3 sont
  passés au fond de la poche nord et dans la poche sud (losange, 1 250 à
  1 450 px entre voisins) ; deux champs ajoutés au nord. La poche sud garde
  les champs riches du centre : un léger avantage pour l'emplacement 3, à juger
  en jeu.
- **Effectifs** : 60 par camp à deux, 40 à trois, 30 à quatre (fluidité).
- **Limites connues** : le joueur éliminé perd la partie même si son allié tient
  encore ; les parties longues ont tendance à stagner (bases qui se
  reconstruisent, attaques dispersées) ; fluidité à vérifier sur le portable
  (mesure du 13 novembre 2026 : le décor seul fait environ 150 appels de dessin
  et 1,3 million de triangles ; un bâtiment 6 à 15 appels, une unité moins d'un
  appel et 1 000 à 3 400 triangles ; les marques de couleur de camp sont déjà
  dans la géométrie des modèles, sans maillage en plus). Baisser les effectifs
  ne gagne donc que peu : le décor et les bâtiments pèsent davantage.

### Difficulté Ultra (13 novembre 2026)

Quatrième choix de la liste « Difficulté » du menu. Demande du propriétaire :
un ordinateur « très intelligent et rusé », et **aucune triche**. Une phrase
sous les réglages le dit au joueur quand Ultra est choisi.

- **Mêmes règles que le joueur** : revenu ×1 (Difficile a ×1,35), mêmes prix,
  durées, limite d'effectifs ; tout passe par les mêmes fonctions que le
  joueur (commander, construireBatiment, activerPouvoir). Il voit la carte
  comme le joueur (le jeu n'a pas de brouillard). Rythme de Difficile pour la
  première vague, vaisseau du mode Surprises de Difficile.
- **En mission**, Ultra reprend Difficile tel quel (revenu ×1,35 compris), et
  la progression enregistre « difficile » pour une mission gagnée avec le
  menu sur Ultra (`enregistrerVictoire`, depuis le 13 novembre au soir),
  sans les comportements ci-dessous : les missions sont scénarisées
  (`reglagesMission`, `niveauIA`).
- **Code** : `jeu.js`, section « 7 ter » (`majUltra` et ses fonctions
  nommées, réglages regroupés dans l'objet `ULTRA`). Facile, Normal et
  Difficile ne passent jamais par ce code (`estUltra`).

Ce qu'il fait, à chaque réflexion (une par camp toutes les 0,8 s) :

1. **Analyse** (`analyserUltra`) : un seul passage sur les entités ; force et
   composition de chaque ennemi, zones annoncées, grille de voisinage de
   320 px qui sert ensuite à toutes les recherches de proximité.
2. **Économie : l'armée d'abord** (revu le soir du 13 novembre, voir
   « Corrections » plus bas). Quatre collecteurs ; au-delà, ainsi que le
   dépôt avancé, un troisième ouvrier et le dépôt de Karsk (son bâtiment
   spécial), seulement pendant l'**expansion** (`expansionUltra`) : aucune
   menace sur la base, aucune armée adverse à moins de 1 300 px, et une armée
   d'au moins 600 plus les trois quarts de la plus forte armée adverse
   (valeur lissée sur une minute environ). Un collecteur de plus par 90 s
   d'expansion (7 au plus à deux camps, 5 à trois, 4 à quatre). Plan serré :
   caserne, usine, antenne (Halden) ; aéroport avancé quand l'expansion dure,
   après 4 min, contre un antiaérien adverse faible ; seconde usine et
   défenses quand son armée domine, qu'il est riche ou après 10 min.
   **Sous la menace** : ni ouvrier (sauf s'il n'en reste aucun), ni bâtiment
   hors première caserne, première usine et batterie contre des appareils
   ou le vaisseau. Production : la meilleure offre attend ses crédits (on
   n'achète pas le moins cher à sa place) ; le rachat d'un collecteur perdu
   et la première usine passent avant, même en urgence. Collecteurs détournés
   d'un champ menacé vers un point libre au bord du dépôt, puis remis au
   travail ; champs disputés pris en dernier.
3. **Adaptation** (`noteProductionUltra`, fonction pure) : chaque unité
   possible est notée d'après les dégâts qu'elle ferait à la composition
   observée de l'ennemi, divisés par son coût et par ce qu'elle subirait ;
   un type déjà très représenté est pénalisé. DCA quand l'ennemi a des
   appareils, réparateurs selon la taille de l'armée, chasseur contre une
   aviation adverse, avions d'attaque quand son armée compte au moins six
   unités, que l'antiaérien adverse reste faible et qu'il n'y a pas de
   menace (expansion).
4. **Harcèlement** : deux ou trois unités rapides vers la cible la moins
   défendue (collecteurs d'abord), par un détour si le trajet direct est
   défendu, repli dès qu'une force supérieure approche. Après un raid sur
   ses collecteurs, une ou deux unités rapides ou à longue portée restent
   postées près du champ harcelé (150 s) au lieu que l'armée poursuive.
5. **Attaque** : regroupement ; objectif choisi d'après la défense locale,
   l'armée adverse proche, la distance, les bâtiments clés, la riposte et
   l'assaut d'un allié Ultra sur le même camp ; assaut si son armée dépasse
   1,35 fois cette défense et vaut au moins 1 500, ou deux fois la plus forte
   armée adverse si celle-ci est faible (600 au moins) ; à effectif plein,
   l'objectif le moins défendu, à 0,8 fois sa défense ; une partie de
   l'infanterie reste en garnison ; diversion de deux unités sur un autre
   bâtiment 6 s avant ; marche groupée ; retraite générale si la force
   ennemie locale dépasse 1,6 fois la sienne. Après une retraite : fin
   mesurée sur les seules unités qui étaient à l'assaut, 18 s de
   regroupement et de réparation, retardataires attendus (40 s au plus), et
   pendant 3 min le secteur repoussé exige au moins la force qui l'a
   repoussé.
6. **Combat** : tir concentré sur ce qui rapporte le plus (DCA s'il a des
   appareils, artillerie, réparateurs, unités presque détruites), sans
   s'acharner à plusieurs sur une cible condamnée ; recul des unités à longue
   portée ; esquive des pouvoirs annoncés et du rayon du vaisseau, selon la
   portée réelle des impacts (Frappe : rayon ; Essaim : rayon + 50 ; Marteau :
   rayon + 80 ; plus une marge) ; repli des
   unités à moins de 30 % vers un réparateur (ou l'aura de Karsk) ;
   réparateurs qui suivent l'armée.
7. **Pouvoirs et aviation** : petit pouvoir seulement sur ce qu'il peut
   détruire, super-arme sur un groupe de grande valeur ou un bâtiment clé,
   y compris sur un combat au contact (les pouvoirs n'atteignent jamais leur
   camp ni ses alliés : `explosionZone`) ; avions abîmés (moins de 50 %)
   rentrés.
8. **Défense** : chaque menace (base, collecteurs, puis bases alliées)
   reçoit 1,6 fois sa valeur en défenseurs capables de toucher un de ses
   membres, les plus proches d'abord (contre un raid loin de la base, pas
   au-delà de 1 100 px) ; une
   petite menace ne rappelle pas l'assaut ; une menace qui dépasse la moitié
   de son armée l'annule. Défenses fixes placées sur l'axe d'où viennent les
   attaques.
9. **Mode Surprises** : pendant la trêve, tout ce qui touche le vaisseau
   l'attaque, le reste garde la base (harcèlement, diversion et assaut
   annulés à l'entrée en trêve) ; batterie ajoutée au plan ; trois DCA
   d'abord ; le prix de la première usine est mis de côté même sous la
   pression des dards.

Journal de décisions (tests) : `window.JOURNAL_ULTRA = true` (lignes dans
`JOURNAL_IA`) ou `'console'`.

**Ce que valaient les premiers résultats.** Le premier tableau de l'auteur
(14 victoires sur 15 contre Difficile) n'a pas tenu : un testeur
indépendant n'a mesuré que 8 victoires sur 13, avec des défaites dans les
deux camps et sur trois cartes. Une relecture a trouvé les causes (dépôt de
Karsk dès le troisième bâtiment, usine qui ne produisait jamais sous la
menace, assauts relancés deux secondes après une retraite, pouvoirs jamais
tirés sur un combat au contact, entre autres). Corrigé le soir du
13 novembre (`?v=18`) ; les essais à graine fixe ont révélé en plus deux
défauts qui coupaient le revenu : un collecteur détourné vers un point situé
dans le QG y restait bloqué, et en urgence les collecteurs perdus n'étaient
jamais rachetés.

**Preuves après corrections (13 novembre 2026 au soir, simulation sans
rendu, parties limitées à 25 min)** — outils `duelIA(niveauJ, niveauI,
factionJ, durée)` et `partieOrdinateurs(liste, durée, options)` de
`verif-missions-moteur.js` (`duelUltra(adversaire, ultraEnJ, factionUltra)`
résume une partie ; `avecGraine(n, fn)` la rejoue à hasard fixé). « (J) » : Ultra à gauche (camp J), « (I) » :
Ultra à droite. Hasard libre (pas de graine) ; toutes les parties jouées
avec la version finale sont données, défaites comprises.

**Résultats retenus (`?v=18`) : ceux du contre-essai indépendant.** Le
tableau de 32 parties publié ici le 13 novembre au soir a été retiré : un
contre-essai indépendant a trouvé plusieurs de ses chiffres impossibles à
reproduire. Le contre-essai a mesuré, en hasard libre, avec `duelUltra` :
contre Difficile **18 victoires sur 22** (Ultra Karsk 11 sur 11, Ultra
Halden 7 sur 11) ; contre Normal 4 sur 4 ; contre le robot joueur 4 sur 4.
Il a relevé en outre les défauts corrigés en `?v=19` (ci-dessous).

**Finitions du 13 novembre 2026 (`?v=19`), d'après ce contre-essai.**

1. *Trêve du mode Surprises* (`treveUltra`, `productionTreveUltra`) : dès la
   trêve, toutes les réserves vont à l'antiaérien déjà accessible (trois
   fantassins qui tirent en l'air, puis l'usine, puis la DCA jusqu'à huit,
   le bunker de Karsk et des batteries) ; plus de 400 gardés pour racheter
   des collecteurs que les dards abattaient aussitôt ; seules les armes
   d'efficacité 0,4 au moins contre le vaisseau (DCA, missiles air-air) vont
   à sa rencontre, les armes légères seulement à six ou plus et quand il
   plane sur notre base ; ce qui ne peut pas le toucher s'en écarte ;
   collecteurs et ouvriers esquivent le rayon, les champs proches du
   vaisseau sont évités ; deux ouvriers pour réparer. (Essai abandonné :
   écarter les collecteurs à 700 px du vaisseau les empêchait de décharger
   quand il planait sur le QG, revenu nul.)
2. *Pouvoirs* (`meilleureZoneUltra`) : parmi les zones qui atteignent le
   seuil du pouvoir, priorité aux groupes ennemis engagés (à moins de
   300 px d'une de nos unités ou d'un de nos bâtiments), puis aux groupes
   serrés (trois unités ou plus), puis au reste ; le journal précise
   « (combat au contact) », « (groupe serré) » ou « (cible éloignée) ».
3. *Aviation* (`aviationUltra`) : ne dépend plus de l'expansion ; aéroport
   et appareils quand l'adversaire n'a aucune DCA (unité ou bâtiment à arme
   « aa »), peu d'autres armes antiaériennes, pas de menace sur la base et
   une armée d'au moins 600 plus la moitié de la plus forte adverse ; le
   premier aéroport a son prix mis de côté ; les hélicoptères passent au
   rang des besoins. Arrêt dès que l'ennemi aligne une DCA.
4. *Ouverture de Karsk* (`collecteursUltra`) : trois collecteurs (au lieu de
   quatre) tant que deux blindés de combat ne sont pas sortis, avant 5 min.
   Karsk seulement : appliquée aussi à Halden, elle a donné 1 victoire sur
   4 contre Difficile (essai intermédiaire), et Halden garde donc
   l'ouverture précédente.
5. *Journal* : ligne « usine au repos sous la menace : réserves …, offre …
   (coût), seuil … : manque d'argent / payable, non achetée / aucune offre :
   défaut de décision », au plus toutes les 5 s.

**Mesures de la version finale (`?v=19`)**, simulation sans rendu, hasard
libre sauf mention, `duelUltra(adversaire, ultraEnJ, factionUltra)` (25 min
au plus). « (J) » : Ultra à gauche, « (I) » : à droite. Toutes les parties
jouées avec la version finale sont données.

Contre Difficile (8 parties, deux par carte, camps et côtés alternés) :
**8 victoires sur 8**.

| Carte | Ultra Karsk | Ultra Halden |
|---|---|---|
| Port-Calmes | (J) gagné 530 s | (I) gagné 998 s |
| Gorges de Varsèche | (I) gagné 491 s | (J) gagné 734 s |
| Delta de l'Ombrine | (J) gagné 657 s | (I) gagné 556 s |
| Val des Brunelles | (I) gagné 569 s | (J) gagné 1 300 s |

Huit parties seulement : le taux réel de Halden contre Karsk Difficile reste
celui du contre-essai (7 sur 11) tant qu'un échantillon plus large ne dit
pas autre chose. Contre Normal : 2 sur 2 (Port-Calmes, Halden (J), 553 s ;
Delta, Karsk (I), 506 s). Contre le robot joueur (Ultra à droite) : 2 sur 2
(Port-Calmes, Karsk, 377 s ; Gorges, Halden, 822 s).

Aviation (appareils produits par Ultra, compteur de `duelUltra`) : 6 sur
ces 12 parties (contre Difficile : 1 en Karsk à Port-Calmes, 2 en Halden à
Port-Calmes, 0 dans les six autres ; contre Normal : 2 et 0 ; contre le
robot : 0 et 1). Encore peu : contre Karsk Difficile, l'armée de Halden ne
dépasse souvent pas le seuil, et les parties de Karsk finissent tôt.

Pouvoirs : 6 tirs « (combat au contact) » dans les journaux de ces parties
(`window.JOURNAL_ULTRA = true`) : Port-Calmes, Halden (I) contre Difficile,
Frappe de précision à 9:27 (zone de valeur 512) et à 12:53 (865) ; Val des
Brunelles, Halden (J) contre Difficile, Frappe à 13:27 (627) et Essaim à
20:13 (1 465) ; Port-Calmes, Halden (J) contre Normal, Frappe à 6:45 (606) ;
Gorges, Halden (I) contre le robot, Frappe à 11:40 (698). Aucun dans les
parties de Karsk, courtes, où le
Marteau et les autres pouvoirs n'ont trouvé aucun combat au contact qui
atteigne leur seuil (500, 1 800 pour la super-arme).

Ouverture de Karsk (Val des Brunelles, Ultra Karsk (J) contre Difficile
Halden, `duelIA('ultra', 'difficile', 'karsk', durée)`, métrique : somme des
coûts des unités armées en vie, ouvriers et collecteurs exclus) : avant,
475 à 3 min (trois parties identiques) et 455, 1 400, 1 410 à 6 min ; après,
**955 à 3 min** (l'adversaire Difficile : 1 170) et 1 250, 660, 900 à 6 min
(adversaire : 1 380, 240, 1 380). Pour comparaison, Difficile Karsk à la
même place : 290 à 3 min, 1 245 à 6 min. (À 3 min, ces parties ont donné
trois fois le même résultat malgré le hasard libre.)

**Mode Surprises** (`testerInvasion` sur `?verif&surprise=<s>`, Port-Calmes,
robot joueur allié en J, Ultra en I, trêve acceptée, normal ; hasard libre ;
aucune erreur) :

| Arrivée | Ultra | Partie 1 | Partie 2 | Partie 3 |
|---|---|---|---|---|
| 30 s | Karsk | vaisseau détruit à 485 s, personne éliminé | détruit à 763 s, personne éliminé | détruit à 330 s, personne éliminé |
| 30 s | Halden | **Ultra éliminé à 652 s** (vaisseau 1 589 PV, bouclier 0), vaisseau détruit par l'allié vers 870 s | détruit à 352 s, personne éliminé | détruit à 295 s, personne éliminé |
| 300 s | Karsk | détruit à 491 s, personne éliminé | détruit à 478 s, personne éliminé | détruit à 504 s, personne éliminé |
| 300 s | Halden | détruit à 457 s, personne éliminé | détruit à 449 s, personne éliminé | détruit à 442 s, personne éliminé |

Avant ces finitions, Karsk Ultra avec le vaisseau à 30 s : éliminé à 652 s
et 785 s dans deux essais intermédiaires, et dans la version `?v=18`
l'ordinateur n'achetait aucune unité (contre-essai : éliminé en 240 à 360 s).

Absence de triche, sur chacun des 12 duels : écarts inexpliqués des
réserves 0 pour les deux camps, aucune unité sans commande payée ou
pouvoir, crédits par unité de minerai déchargée 1 pour Ultra.

**Référence de non-régression** (Normal et Difficile ne passent jamais par
la section 7 ter) : sur `?verif` (Port-Calmes),
`avecGraine(7, () => duelIA('normal', 'difficile', 'karsk', 360))` et
`avecGraine(7, () => duelIA('difficile', 'difficile', 'halden', 360))` ;
format par camp : [valeur des entités, réserves, collecte, dépenses]. Avant
et après les finitions, identique : J [4025, 270, 4200, 4930],
I [4310, 406, 4556, 5150] ; puis J [4720, 750, 5100, 5350],
I [5150, 60, 4420, 5360]. Les huit missions, une minute chacune
(`demarrerMission(); simuler(60)`) : aucune erreur.

Coût de calcul : non remesuré pour `?v=19` (dernière mesure, `?v=18` :
0,48 ms par pas avec robot + trois Ultra, Val des Brunelles).

Limites connues :

- **Halden Ultra reste fragile contre Karsk Difficile** (contre-essai : 7 sur
  11) ; et à niveau égal **Karsk bat Halden presque toujours** : équilibre des
  camps à trancher par le propriétaire. (Après l'équilibrage du 13 novembre,
  `?v=20` : Halden gagne 12 parties sur 60 à niveau égal ; voir
  « Équilibrage des camps ».)
- Mode Surprises : une élimination de Halden Ultra sur six parties (vaisseau
  à 30 s) ; une seule carte essayée, et douze parties en tout.
- Aviation encore rare (6 appareils en 12 parties).
- Jamais joué contre un humain ; les robots ne savent pas exploiter ses
  faiblesses.
- Ultra n'a pas été essayé sur Cap-Morvent, ni à trois ou quatre camps.

### Équilibrage des camps (13 novembre 2026, `?v=20`)

> **Travail mis en pause le 13 novembre 2026, à la demande du propriétaire.**
> Les valeurs décrites ci-dessous ont été **retirées du jeu** (`?v=21` : le jeu
> est revenu aux valeurs de `?v=19`, les dernières vérifiées sur les 8 missions).
> La cible n'était pas atteinte et les missions n'avaient pas été rejouées.
> La copie de travail est gardée dans `travaux/equilibrage-en-pause/jeu-v20.js`.
> Les mesures « avant » et les essais ci-dessous restent valables pour reprendre.

Demande du propriétaire : équilibrer Halden et Karsk sans effacer leur
identité (Halden peu nombreux, cher, précis ; Karsk nombreux, bon marché,
rustique). **Résultat : la cible (45 à 55 % de victoires à niveau égal) n'est
pas atteinte.** Les duels d'unités sont désormais proches ou favorables à
Halden, mais l'ordinateur Halden perd toujours presque toutes ses parties
contre l'ordinateur Karsk. Les mesures montrent que la cause principale est
dans la conduite de l'ordinateur, pas dans les valeurs des unités (voir
« Ce que montrent les mesures »).

**Méthode.** Simulation sans rendu dans le navigateur, outils de
`verif-missions-moteur.js` ajoutés pour l'occasion :
`serieEquilibre(niveau, graines, durée, instants)` et sa forme résumée
`serieCourte(niveau)` (graines 1, 2 et 3 fixées par `avecGraine`, chaque
graine jouée Halden à gauche puis Karsk à gauche, 25 min au plus, relevés à
3, 6 et 9 min) ; `duelBudget(factionJ, compoJ, compoI, options)` et
`duelsEquilibre(aura)` (graine 5) pour les duels à budget voisin, les deux
groupes posés à 450 px, chaque camp attaquant à son tour ; `tache(clé, fn)`
pour les calculs longs. Une page rechargée par carte (`?verif&carte=<id>`).
Les parties sont reproductibles : deux exécutions de la même graine dans la
même page ont donné le même résultat.

**Mesures avant (`?v=19`).** Mesurées avec les valeurs d'origine (pour
Gorges, Delta, Cap-Morvent et Val des Brunelles, valeurs d'origine remises
dans la console avant la série, ce qui revient au même moteur). Vainqueur
sur 6 parties par carte et par niveau (graines 1 à 3, deux côtés) :

| Carte | Normal contre Normal | Difficile contre Difficile |
|---|---|---|
| Port-Calmes | Karsk 6 | Karsk 5, nulle 1 (25 min) |
| Gorges de Varsèche | Karsk 6 | Karsk 6 |
| Delta de l'Ombrine | Karsk 6 | Karsk 6 |
| Isthme de Cap-Morvent | Karsk 6 | Karsk 6 |
| Val des Brunelles | Karsk 6 | Karsk 5, Halden 1 |
| **Total** | **Halden 0 sur 30** | **Halden 1 sur 30** |

Économie avant (moyennes des 6 parties ; « armée » : coût des unités armées
en vie, ouvriers, collecteurs et réparateurs exclus ; « collecte » : crédits
reçus depuis le début). Port-Calmes, Difficile : à 3 min armée Halden 832 /
Karsk 313, collecte 2 255 / 2 301 ; à 6 min 1 322 / 1 748, 4 488 / 4 749 ;
à 9 min (3 parties encore en cours) 187 / 1 683. Même allure sur les autres
cartes : Halden en avance à 3 min, Karsk devant dès 6 min, à collecte presque
égale. Exception : **Cap-Morvent**, où la collecte de Halden à 3 min est la
moitié de celle de Karsk (Normal 983 contre 1 875 ; Difficile 1 462 contre
2 663). Ouvertures (bâtiments finis à 3 min, Port-Calmes et Val des
Brunelles) : Halden QG, caserne, deux antennes, usine ; Karsk QG, caserne,
dépôt, usine, et souvent un second dépôt.

Duels avant (graine 5, sans aura ; « reste » : valeur et PV restants du
vainqueur). 12 Opérateurs (1 320) contre 20 Conscrits (1 300) : Karsk gagne
dans les deux sens (reste 31 % et 28 % des PV). 6 Javelots contre 8
Grenadiers (1 200 chacun) : Karsk (33 %, 28 %). 7 Traqueurs contre 9
Guetteurs (1 260) : Halden (43 %, 29 %). 5 Bastions (2 600) contre 5 Ours
(2 400) : Karsk (31 %, 30 %). 6 contre 6 : Karsk (30 %, 32 %). Infanterie de
base (8 Op. + 2 Jav., 1 280 ; contre 14 Consc. + 2 Gren., 1 210) : Karsk (30 %,
21 %). Infanterie et blindés (2 580 contre 2 670) : Karsk (28 %, 50 %).
Blindés lourds et bazookas : Karsk (35 %, 35 %). Artillerie et escorte (1) :
Karsk (8 %, 26 %) ; (2) : Halden (17 %, 20 %). Défenses fixes : 3 Bastions
battent 4 Bunkers (72 % des PV restants) ; 4 Tourelles battent 3 Ours et 20
Conscrits ; 4 Bunkers battent 12 Opérateurs (87 %). Pouvoirs (même groupe,
16 conscrits ou 9 chars espacés de 70 px, graines 3 et 4) : le Marteau fait
1,3 à 2 fois les dégâts de l'Essaim (ex. 9 Ours : 2 395 contre 1 249).

Ces duels d'avant ont été joués avec une version de `duelBudget` où, avec
aura, les unités tiraient aussi sur le bâtiment d'aura adverse ; seuls les
duels sans aura d'avant sont donc retenus.

**Ce que montrent les mesures.**

1. *Valeurs des unités* : à budget égal, chaque paire comparable sauf les
   tireurs tournait à l'avantage de Karsk. En coût, Karsk avait un meilleur
   rapport (dégâts par seconde × PV) / coût² : Conscrit 0,21 contre
   Opérateur 0,13 ; Ours 0,14 contre Bastion 0,10 ; Grenadier 0,071 contre
   Javelot 0,051. C'est corrigé (tableau des valeurs ci-dessous).
2. *Conduite de l'ordinateur* : **même avec des unités de Halden très
   au-dessus de la normale, l'ordinateur Halden perd.** Essais de
   sensibilité sur Port-Calmes (12 parties, graines 1 à 3, deux côtés,
   Normal et Difficile, valeurs changées dans la console seulement et
   retirées ensuite ; joués sur une version intermédiaire : valeurs
   d'unités finales, ravitaillement à 0,8, listes de production essayées,
   qui donnait elle-même 1 sur 12) : PV de toutes les unités de Halden ×1,3 : Halden 1 sur
   12 ; PV ×1,3 et dégâts ×1,5 : 4 sur 12 ; sans aucun pouvoir pour les deux
   camps : 1 sur 12 ; portée de la Grêle 440 → 300 : 1 sur 12 ; Karsk sans
   Grêle : 2 sur 12 ; seuil de vague de Halden ×0,6 : 1 sur 12 ; seuil de
   vague de Karsk ×1,6 : 2 sur 12 ; listes de production de Halden avec plus
   de chars et de Javelots, ou avec plus de drones, ou moins : 1 sur 12.
   L'issue ne dépend donc presque pas de la force des unités.
3. *Ce qui a été observé dans une partie suivie* (Port-Calmes, Normal,
   graine 1, Karsk à gauche, même version intermédiaire) : l'armée de Halden ne s'approche jamais à moins
   de 800 px du QG de Karsk ; elle attend au point de rassemblement, serrée,
   puis disparaît en 30 à 40 s quand une vague de Karsk arrive, sous le
   Marteau (1 211 dégâts sur ses unités dans la fenêtre observée), les Ours
   et la Grêle, sans que ses Bastions tirent beaucoup (356 dégâts en deux
   minutes). Les vagues de l'ordinateur partent à un **nombre** d'unités
   (7, puis 9, 11… jusqu'à 22 ; 8 en Difficile), ce qui avantage le camp
   aux unités bon marché. Corriger cela demande de revoir la conduite des
   vagues et de la défense de l'ordinateur pour les deux camps : c'est une
   décision de conception, laissée au propriétaire.
4. *Économie* : collecte presque égale sur quatre cartes ; Cap-Morvent est
   l'exception (voir plus haut), non corrigée.

**Valeurs changées** (toutes commentées dans `jeu.js`) :

| Élément | Avant | Après | Raison |
|---|---|---|---|
| Opérateur : coût | 110 | 100 | Rapport force / coût très inférieur au Conscrit |
| Opérateur : dégâts | 15 | 17 | Idem |
| Opérateur : cadence (s entre deux tirs) | 0,9 | 0,8 | Idem ; PV inchangés (95), le Guetteur l'abat toujours d'un tir |
| Javelot : coût | 200 | 180 | Perdait contre les Grenadiers à budget égal |
| Javelot : dégâts | 60 | 66 | Idem |
| Bastion : PV | 720 | 820 | Perdait contre l'Ours à budget voisin (5 contre 5, 6 contre 6) |
| Bastion : dégâts | 72 | 80 | Idem |
| Essaim : dégâts par impact | 60 | 80 | Le Marteau faisait 1,3 à 2 fois plus de dégâts sur un même groupe |
| Plan de l'ordinateur Halden (Normal, Difficile, escarmouche seulement) | caserne, antenne, usine, antenne, … | caserne, dépôt, usine, antenne, … | Deux antennes près du QG (qui a déjà l'aura) ne servaient presque à rien ; Karsk ouvre par un dépôt (revenu) |

Essayés puis retirés : ravitaillement de Karsk 0,75 → 0,8 (affaiblir Karsk
plutôt que renforcer Halden ; une fois les unités de Halden renforcées, les
duels avec aura étaient déjà favorables à Halden, et le retour à 0,75 ne les
a presque pas changés) ; listes de production
de l'ordinateur Halden (moins de drones, moins de Javelots) : aucun effet
mesurable. Ultra n'a pas été touché.

**Mesures après (`?v=20`, version finale)**, même série que « avant »
(mêmes graines 1 à 3, mêmes côtés, `serieCourte`) :

| Carte | Normal contre Normal | Difficile contre Difficile |
|---|---|---|
| Port-Calmes | Halden 1, Karsk 4, nulle 1 | Karsk 6 |
| Gorges de Varsèche | Karsk 6 | Halden 2, Karsk 3, nulle 1 |
| Delta de l'Ombrine | Halden 3, Karsk 3 | Karsk 5, nulle 1 |
| Isthme de Cap-Morvent | Halden 1, Karsk 5 | Halden 2, Karsk 4 |
| Val des Brunelles | Halden 2, Karsk 4 | Halden 1, Karsk 3, nulles 2 |
| **Total** | **Halden 7, Karsk 22, nulle 1 (sur 30)** | **Halden 5, Karsk 21, nulles 4 (sur 30)** |

Soit 12 victoires de Halden sur 60 (20 %) contre 1 sur 60 avant : **loin de
la cible de 45 à 55 %**. Économie après : Port-Calmes Difficile, armée à
3 min Halden 840 / Karsk 313, à 6 min 1 167 / 1 402, à 9 min (5 parties)
360 / 2 332, collecte 2 255 / 2 312, 4 567 / 4 771, 6 678 / 6 977 ;
Cap-Morvent Difficile, collecte à 3 min **2 527 / 2 618** (avant 1 462 /
2 663 : l'ouverture par un dépôt a comblé l'écart de revenu sur cette carte).

Duels après (graine 5, `duelsEquilibre`, budgets H / K ; vainqueur et part
des PV restants, Halden attaquant puis Karsk attaquant) :

| Duel | Budgets | Sans aura | Avec les deux auras |
|---|---|---|---|
| 12 Opérateurs / 20 Conscrits | 1 200 / 1 300 | Halden 29 %, Halden 34 % | Halden 48 %, Halden 47 % |
| 6 Javelots / 8 Grenadiers | 1 080 / 1 200 | Karsk 23 %, Karsk 35 % | Karsk 24 %, Karsk 15 % |
| 7 Traqueurs / 9 Guetteurs | 1 260 / 1 260 | Halden 43 %, Halden 29 % | Karsk 11 %, Karsk 22 % |
| 5 Bastions / 5 Ours | 2 600 / 2 400 | Halden 15 %, Halden 9 % | Halden 27 %, Halden 36 % |
| 6 Bastions / 6 Ours | 3 120 / 2 880 | Karsk 0 % (dernier char), Halden 11 % | Halden 22 %, Halden 40 % |
| Infanterie de base | 1 160 / 1 210 | Halden 19 %, Halden 29 % | Halden 46 %, Halden 61 % |
| Infanterie et blindés | 2 480 / 2 670 | Halden 26 %, Halden 1 % | Halden 12 %, Halden 31 % |
| Blindés lourds et bazookas | 2 620 / 2 520 | Karsk 5 %, Halden 2 % | Halden 27 %, Halden 46 % |
| Artillerie et escorte (1) | 1 580 / 1 620 | Halden 4 %, Halden 6 % | Halden 28 %, Karsk 19 % |
| Artillerie et escorte (2) | 1 960 / 1 710 | Halden 35 %, Halden 35 % | Halden 35 %, Halden 30 % |

Défenses fixes après (graine 5, défenses posées finies) : Karsk (14 Consc.,
2 Gren., 2 Ours, 2 170) bat 4 Opérateurs et 2 Tourelles (1 200) avec 87 %
des PV ; Halden (6 Op., 2 Jav., 2 Lynx, 1 Bastion, 1 960) bat 6 Conscrits et
2 Bunkers (1 090) avec 70 % ; 3 Bastions battent 4 Bunkers (78 %) ; 4
Tourelles battent 3 Ours (30 %) et 20 Conscrits (45 %) ; 4 Bunkers battent
12 Opérateurs (84 %). Super-armes après (graines 3 et 4, même groupe espacé
de 70 px) : 16 Conscrits, Essaim 1 148 et 822, Marteau 1 109 et 1 195 ;
9 Ours, Essaim 1 665 et 1 549, Marteau 2 395 et 1 468.

Ultra contre Difficile, Val des Brunelles, graines 1 et 2, Ultra à gauche
puis à droite (`duelUltra`, 25 min au plus) : **après**, Ultra Halden 4 sur
4 (1 031, 639, 975, 457 s), Ultra Karsk 3 sur 4 (perdu en 552 s à gauche
avec la graine 1) ; **avant** (mêmes parties, valeurs d'origine remises dans
la console, ancien plan pour l'adversaire Halden Difficile), Ultra Halden 3
sur 4 (1 287, 843, 903 s ; perdu en 804 s à droite avec la graine 2), Ultra
Karsk 4 sur 4. Huit parties par mesure : l'écart s'est inversé sans qu'on
puisse en conclure davantage. Contrôle d'absence de triche sur les 8 parties
d'après : écarts inexpliqués 0, unités sans commande 0, 1 crédit par unité
de minerai pour Ultra.

Missions : les 8 missions tournent une minute (`demarrerMission();
simuler(60)`, page rechargée entre chaque) sans erreur. Rien n'a été laissé
dans le stockage du navigateur.

**Limites.**

- La cible n'est pas atteinte : 20 % de victoires pour Halden à niveau égal.
  La cause restante est la conduite de l'ordinateur (vagues au nombre
  d'unités, armée serrée qui attend au rassemblement, défense), pas les
  valeurs : la corriger touche les deux camps et la logique commune de
  l'ordinateur, à décider par le propriétaire.
- Les duels d'unités penchent désormais vers Halden (sauf les bazookas, et
  les tireurs avec aura) : un joueur humain avec Halden est sans doute plus
  fort qu'avant. Aucun duel entre unités comparables ne finit à plus de
  48 % des PV restants, mais l'infanterie de base avec aura atteint 61 %
  quand Karsk attaque.
- Les missions utilisent les mêmes unités : l'Essaim (mission `karsk-4`) et
  les Opérateurs, Javelots et Bastions de Halden sont plus forts. Seule
  l'absence d'erreur a été vérifiée, pas la difficulté des missions.
- Six parties par carte et par niveau : un écart de une ou deux victoires
  n'est pas significatif.
- Les descriptions des unités changées ne citent pas de chiffres et restent
  justes ; celles des auras sont inchangées (le ravitaillement est revenu à
  sa valeur d'origine).

### Barre de construction

En bas à droite, toujours visible en jeu : quatre onglets (Bâtiments,
Infanterie, Véhicules, Aviation ; touches F1 à F4). Un clic sur un bâtiment
lance son placement, et l'ouvrier libre le plus proche le construit. Un clic
sur une unité la met en file dans le bâtiment le moins chargé ; un clic droit
la retire.

Refaite le 13 novembre 2026 (l'aéroport était coupé à droite) : grille de
quatre colonnes sur deux rangées, huit boutons au plus par onglet, sans
défilement de 1280 à 1920 px de large (le plus chargé, Bâtiments de Halden,
en compte sept). Chaque bouton montre l'image du modèle 3D (`r3d-vignettes.js`
; un pictogramme neutre en attendant), le nom, le prix, la file et
l'avancement. Au survol, une infobulle donne l'image, le nom, le prix, la
durée, le bâtiment requis, les points de vie, la portée, les cibles (sol, air)
et la description ; grisé, elle donne aussi la raison. La fiche de la
sélection (en bas à gauche) montre la même image. Les descriptions ont été
réécrites pour un débutant : rôle, forces, faiblesses, particularité.
Vérifié par capture dans les deux camps à 1280 × 720 et 1920 × 1080.

### Défilement au bord

Quand le curseur touche un bord de la fenêtre (15 px), la vue se déplace dans
cette direction, diagonales comprises, à une vitesse proportionnelle au zoom
(la même que les flèches du clavier, qui restent actives). Pas de défilement
pendant une pause, un dialogue, une cinématique, quand la fenêtre n'a pas le
focus ou quand le curseur l'a quittée. Sur la barre du haut, le panneau du
bas et la minicarte, il ne se déclenche que dans les 3 derniers pixels du bord :
sans cela, ces bandes couvrant tout le haut et tout le bas, on ne pourrait
jamais défiler vers le haut ou le bas à la souris (choix à valider en jeu).
Option « Défilement au bord » dans les réglages du menu, activée par défaut,
mémorisée dans le navigateur.

### Économie

Les ressources sont des champs de minerai (cristaux de sel et de lithium).
Des collecteurs, produits au quartier général ou dans un dépôt, font seuls la
navette entre le champ et le dépôt ou le QG le plus proche. Chaque camp en
reçoit deux au départ. Les ouvriers ne récoltent plus : ils construisent et
réparent. Les deux camps peuvent construire un dépôt.

### Infanterie

| Rôle | Halden | Karsk | Emploi |
|---|---|---|---|
| Mitraillette | Opérateur | Conscrit | Polyvalent, tire aussi en l'air |
| Bazooka | Javelot | Grenadier | Chars, bâtiments, drones ; faible contre l'infanterie |
| Sniper | Traqueur | Guetteur | Très longue portée, un tir par fantassin ; inutile contre les blindés |

Bazookas et snipers n'existent qu'en escarmouche, comme l'aviation.

### Aviation

L'aéroport (4 × 4 cases, après l'usine) accueille 3 avions au plus.

- **F-15** : chasseur, le plus rapide, fait pour abattre ce qui vole.
- **F-35** : furtif, bombe guidée contre bâtiments et blindés, fragile.
- **Rafale** : polyvalent.

Un avion ne fait pas de surplace : il tourne en attente, attaque par passes,
puis rentre se réarmer ou se réparer. Parades : la Sentinelle pour Karsk, le
Rempart pour Halden (depuis le 13 novembre 2026 ; le Lynx a perdu son bonus
antiaérien et redevient un blindé léger qui tire en l'air sans plus), et la
batterie mixte pour les deux camps. L'aviation n'existe qu'en escarmouche.

### Nouveautés du 13 novembre 2026 (escarmouche seulement)

Toutes interdites par défaut en mission, comme l'aviation : les 8 missions ne
changent pas.

| Unité | Camp | Prix / durée | PV | Arme | Rôle |
|---|---|---|---|---|---|
| Rempart (usine) | Halden | 300 / 14 s | 320 | DCA, 28 dégâts toutes les 0,45 s, portée 330 | Abat ce qui vole, vaisseau-mère compris ; jamais au sol |
| Frelon (aéroport) | Halden | 450 / 18 s | 450 | Mitrailleuse 14 / 0,25 s, portée 230 | Hélicoptère contre infanterie et blindés légers |
| Busard (aéroport) | Halden | 600 / 22 s | 620 | Missiles 70 / 2,2 s, portée 290 | Hélicoptère contre chars et bâtiments |
| Taon (aéroport) | Karsk | 380 / 16 s | 480 | Mitrailleuse 12 / 0,25 s, portée 220 | Comme le Frelon, moins cher |
| Vautour (aéroport) | Karsk | 520 / 20 s | 680 | Missiles 62 / 2,2 s, portée 280 | Comme le Busard, plus blindé |
| Mécano (caserne) | Halden | 120 / 9 s | 80 | aucune | Soigne l'infanterie (14 PV/s), répare les bâtiments (12 PV/s) |
| Atelier mobile (usine) | Halden | 350 / 15 s | 380 | aucune | Répare véhicules et hélicoptères (28 PV/s), bâtiments (18 PV/s) |
| Infirmier (caserne) | Karsk | 90 / 8 s | 80 | aucune | Comme le Mécano (12 et 10 PV/s) |
| Dépanneuse (usine) | Karsk | 300 / 14 s | 420 | aucune | Comme l'Atelier (24 et 15 PV/s) |

- **Hélicoptères** : surplace, vol bas, ni piste ni réarmement ; quatre au plus
  par aéroport, en plus des trois places d'avions. Ils ne tirent pas en l'air
  et n'atteignent pas le vaisseau-mère. Vulnérables à la DCA, à la batterie,
  aux chasseurs, et un peu aux mitraillettes et bazookas.
- **Réparateurs** : sans arme. Sans ordre, ils soignent seuls les alliés
  blessés à moins de 320 px de leur point de repos, puis y reviennent ; clic
  droit sur un allié pour le soigner. Le fantassin ne soigne que
  l'infanterie ; le véhicule les véhicules et les hélicoptères. Tous deux
  réparent les bâtiments.
- **Batterie mixte** (après l'usine, 550, 22 s, 1 100 PV, portée 300) :
  canon de 26 dégâts par seconde au sol, lance-missiles de 34 dégâts toutes
  les 0,7 s en l'air ; atteint le vaisseau-mère.
- **Ordinateur** : une DCA par tranche de deux appareils adverses (quatre au
  plus), deux réparateurs fantassins et des véhicules de dépannage qui suivent
  l'armée, un à trois hélicoptères d'appui selon la difficulté ; il bâtit sa
  batterie juste après l'aéroport quand l'adversaire a un aéroport ou des
  appareils, sinon en fin de plan.

**Valeurs changées le 13 novembre 2026** (relevées dans `jeu.js`, où chaque
changement est commenté ; ces réglages ont été faits en parallèle des
corrections d'Ultra, par une autre passe de travail) :

- **DCA** (arme `aa`) : efficacité contre les avions 1,0 → 0,33 (trois
  avions tombaient sans infliger de dégât devant la DCA à budget égal) ;
  contre les hélicoptères 1,35 → 0,55. La batterie mixte garde son ancien
  effet sur les hélicoptères grâce à un bonus propre (`bonusHelico` 2,4,
  soit 2,4 × 0,55 ≈ 1,35 en dégâts).
- **Hélicoptères** : PV et portées relevés (tableau ci-dessus) ; avant :
  Frelon 380 PV / portée 210, Busard 420 / 260, Taon 420 / 200,
  Vautour 480 / 250. Les lance-missiles restent sous la portée de la
  batterie (300).
- **F-35** : 240 → 320 PV (abattu par la DCA avant son premier largage).
- **Bombe du Rafale** : 220 dégâts (240 à l'origine, 170 quand le Lynx était
  la parade antiaérienne de Halden, 220 depuis que le Rempart l'est).
- **Bazookas contre le Lynx** : le Lynx a perdu son bonus antiaérien ;
  l'arme des bazookas (`roquetteAT`) vaut 1,8 contre les blindés légers.
  L'ancienne valeur de cette case n'est pas notée dans le code : je ne peux
  pas la donner avec certitude.

Duels chiffrés du 13 novembre 2026, **avant** le second réglage des
hélicoptères et de la DCA ci-dessus (3 hélicoptères contre…) :

| Contre | Frelon | Busard | Taon | Vautour |
|---|---|---|---|---|
| 2 DCA | perdu en 12 s | gagné en 11 s, 1 survivant | perdu en 12 s | gagné en 11 s, 1 survivant |
| 2 batteries | perdu en 10 s | perdu en 19 s | perdu en 11 s | perdu en 20 s |
| 6 mitraillettes | gagné en 5 s, sans perte | gagné en 21 s, 1 perte | gagné en 5 s | gagné en 19 s |
| 2 chars | gagné en 70 s | gagné en 13 s | gagné en 110 s | gagné en 20 s |

Les chars ne tirant pas en l'air, ils perdent toujours contre des
hélicoptères : seule la durée compte. Réparation d'un char à 30 % : 19 s pour
l'Atelier (Bastion), 30 s pour la Dépanneuse (Ours) ; un fantassin à 30 % est
soigné en 6,5 s ; une caserne à 30 % par un Mécano en 66 s.

### Campagnes

« Le contrat de Varenne » (Halden) et « La marche du Nord » (Karsk) : quatre
missions chacune, la même guerre vue des deux camps, sur huit cartes propres.
Briefing, objectifs principaux et secondaires, radio, débriefing ; la
progression est mémorisée dans le navigateur.

### Mode Surprises

Case à cocher de l'escarmouche. Entre la 4e et la 7e minute, le ciel
s'assombrit, puis une cinématique montre l'arrivée d'un vaisseau colossal. Le
jeu propose alors une alliance avec l'adversaire ; refusée, elle reste
proposable depuis la barre du haut. Le vaisseau a un bouclier, un rayon
annoncé par un cercle au sol, une défense rapprochée, et il largue des dards
(chasseurs) et des rôdeurs (marcheurs). Il ne récupère ni bouclier ni points
de vie, et il vise les deux bases tour à tour. Avec l'alliance, la victoire
est commune quand il tombe ; sans elle, il faut aussi détruire la base
adverse.

À la demande du propriétaire, qui le trouvait trop fort, le vaisseau a été
nettement affaibli le 12 novembre 2026 : 7 000 points de vie et 2 000 de
bouclier en difficulté Normale, contre 25 000 et 6 000 avant.

### Commandes

Souris pour sélectionner et ordonner, molette ou touches + et − (rangée
principale et pavé numérique), Page précédente et Page suivante pour le zoom.
La vue se déplace avec les flèches ou en amenant le curseur au bord de la
fenêtre ; clic droit sur un allié avec un réparateur sélectionné : le soigner.
Le bouton « Commandes » du jeu donne la liste complète.

## Essais et outils

- `?demo` : vitrine de toutes les unités et de tous les bâtiments. Dans la
  console : `demoVue('combat')`, `'aeroport'`, `'aliens'`, `'baseJ'`…
- `?mission=halden-1` … `karsk-4` : ouvre directement une mission.
- `?surprise=30` : escarmouche avec l'invasion à 30 secondes.
- `?carte=gorgesVarseche` (ou `deltaOmbrine`, `capMorvent`, `valBrunelles`,
  `portCalmes`) : ouvre l'escarmouche sur cette carte ; combinable avec
  `?surprise=30`.
- `?qualite=basse` (ou `moyenne`, `haute`) : impose une qualité graphique.
- `?verif` : charge `verif-missions-moteur.js` (robots de test, duels, parties
  simulées ; `duelIA`, `partieOrdinateurs` et `confierAOrdinateur` pour faire
  jouer le camp J par l'ordinateur à une difficulté donnée).
- `?diff=ultra` (ou `facile`, `normal`, `difficile`) : difficulté imposée.
- `verif-missions.html`, `verif-missions-karsk.html` : contrôle statique des
  fichiers de mission.
- `test-musique.html` : écoute des pistes une à une.

## Ce qui a été vérifié, et comment

Par des robots et par simulation accélérée dans le navigateur de l'outil de
développement, le 11 novembre 2026 :

- les 8 missions se gagnent et se perdent, sans erreur ;
- le cycle complet des trois avions (production, décollage, attaque, retour,
  réarmement) ;
- l'invasion jusqu'au bout, avec alliance et avec refus ; la cinématique,
  passée ou non ;
- les trois qualités graphiques et les quatre ambiances de lumière.

## Limites connues

- Connexion Internet nécessaire au démarrage.
- **Jamais joué à la souris par un humain.** L'équilibre vient de robots.
- **Musique jamais écoutée** : seuls les niveaux sonores ont été mesurés.
- La fluidité n'a pas été mesurée sur le portable cible. En qualité Élevée,
  la scène de combat dépasse un million de triangles.
- Équilibre de l'invasion : avec l'alliance, un robot gagne en 8 à 9 minutes
  dans les deux camps (une seule partie par camp). Seule la difficulté
  Normale a été réglée ; Facile et Difficile ont été baissées dans les mêmes
  proportions sans essai.
- À prix égal, les bazookas perdent encore contre les blindés légers (Lynx,
  Grêle) : ils servent surtout contre les chars et les bâtiments.
- Un camp (joueur compris) qui a un QG ou un dépôt mais plus aucun collecteur,
  ni en service ni en file, et moins de 400 en réserve, reçoit un revenu de
  secours de 7 par seconde (un collecteur en une minute environ) ; le joueur en
  est averti une fois. Escarmouche seulement : les missions n'en ont pas.
- Les cristaux des champs de minerai se détachent mal sur le sable à midi.
- L'ordinateur construit son aéroport mais se sert peu de ses avions : une à
  trois sorties par partie.
- `halden-2` et `karsk-3` restent courtes (4 à 5 minutes pour un robot).
- Pas de brouillard de guerre, pas de sauvegarde en cours de partie, pas de
  bruitages.
- Les unités peuvent se bousculer dans les passages étroits et sur les ponts.
- Outil de test seulement : lancer deux missions de suite sans recharger la
  page fausse la seconde.

## Choix faits sans le propriétaire, à valider

- Les deux camps construisent les trois avions, aux couleurs de leur camp.
- La bombe du Rafale avait été affaiblie quand le Lynx était la parade
  antiaérienne de Halden ; le Rempart a pris ce rôle le 13 novembre 2026,
  sans que la bombe soit revue.
- Valeurs des hélicoptères, des réparateurs et de la batterie (tableau plus
  haut), réglées par duels de robots seulement.
- Une unité au repos sous le feu d'une défense de plus longue portée ne
  charge pas d'elle-même.
- Le vaisseau des envahisseurs est un dessin original.

## Pistes pour la suite (à décider)

1. Jouer de vraies parties et régler l'équilibre.
2. Mode deux joueurs en ligne (un joueur héberge, l'autre le rejoint par un
   code) : gros chantier dans le moteur, à faire dans un lot séparé.
3. Copie locale de three.js, pour jouer hors ligne.
4. Bruitages.
5. Troisième camp jouable, le Réseau Mistral.
6. Brouillard de guerre.

## Réglages de rendu du 13 novembre 2026

À la demande du propriétaire, après des captures d'essai (dossier
`captures/realisme`), quatre réglages légers ont été appliqués dans
`r3d-scene.js` et `r3d-post.js` :

- lumière plus contrastée et ombres de contact plus marquées, réglées par
  ambiance (tables de lumière de `r3d-scene.js`, anciennes valeurs gardées en
  commentaire) ;
- étalonnage plus photographique dans la passe finale (noirs, sable moins
  jaune, grain très léger en qualité Élevée) ;
- brume du lointain renforcée et teintée par le ciel ;
- ombres de nuages sur le terrain et les objets, absentes en qualité Basse.

Le sable est nettement moins jaune qu'avant : c'est un choix de goût, réglable
par la valeur `sable` de chaque ambiance. Non vérifié : la fluidité avant et
après, la qualité Basse à l'écran, les cinématiques. Pistes écartées pour
l'instant : végétation, flou de profondeur, caméra basse, sol plus détaillé.

## Fluidité (13 novembre 2026, `?v=22`) : moteur et interface (`jeu.js`)

Le propriétaire signale « quelques lags » sur un portable à carte graphique
intégrée. La mesure « avant » montre que la simulation et l'IA comptent peu
(0,13 à 0,33 ms par pas) : les à-coups viennent de la compilation des
shaders en pleine partie, et le coût de chaque image vient de la carte
graphique (fichiers `r3d-*.js`, traités à part). Dans `jeu.js`, on a
fait ceci, sans toucher aux règles ni aux décisions des ordinateurs.

- **Préchauffage** : `R3D.prechauffer()` est appelé une fois pendant le
  chargement, après le choix de la qualité, puis à chaque changement de
  qualité au menu. S'il n'existe pas, rien ne se passe. Sa durée est lue dans
  `dureePrechauffage`.
- **Vignettes** (`R3D.Vignettes.suspendre`) : leur production est suspendue
  dans trois cas. Pendant le chargement, jusqu'à 1,5 s après la première
  image. Pendant les cinématiques. Pendant les grosses batailles, à partir de
  `SEUIL_BATAILLE` = 40 projectiles et effets en cours ; elle reprend après
  3 s sous ce seuil.
- **Interface** : la barre du haut, le panneau et la barre de construction
  sont rafraîchis 10 fois par seconde, et aussi tout de suite après un clic
  ou une touche. Le DOM n'est modifié que si une valeur change
  (`ecrireTexte`). La minicarte est redessinée au plus 8 fois par seconde,
  et aussi à chaque image où la vue bouge.
- **Boucle** : un pas de simulation reste borné à 0,05 s, sans rattrapage.
  Quand l'onglet est caché puis revient, la première image repart d'un écart
  nul.
- **Allocations** : `projectiles`, `evenements`, `effets` et `ents` sont
  compactés sur place (`compacter`), dans le même ordre de traitement
  qu'avant. `separer` remplit en un seul passage trois tableaux réutilisés.
- **Ordinateurs** : une seule réflexion par pas. Ce garde-fou ne s'est jamais
  déclenché sur 4 800 pas mesurés à quatre camps : les décalages de départ
  suffisent déjà.
- **Réglages** : la case « Résolution adaptative » du menu (cochée par
  défaut, mémorisée) règle `R3D.adaptatif`. La case « Afficher les
  performances » de la fenêtre Commandes (mémorisée), ou la touche **F8**,
  affiche au-dessus de la minicarte : images par seconde, ms par image, appels
  de dessin, triangles et résolution. Ces chiffres viennent de `R3D.perf()`
  s'il existe, sinon de `renderer.info`.

Mesures (navigateur intégré, onglet en arrière-plan, carte graphique AMD
intégrée partagée avec d'autres essais) :

- **Décisions inchangées** : `avecGraine(7)` 240 s et `avecGraine(11)` 480 s,
  parties à quatre ordinateurs (Ultra, Ultra, Difficile, Ultra) avec
  `partieOrdinateurs`. L'empreinte (valeur d'armée, réserves, collecte,
  éliminations par camp) est identique avant et après.
- **Coût du moteur avant** : un pas coûte au plus 2,8 ms une fois le
  JavaScript optimisé. Une réflexion d'ordinateur coûte au plus 1,7 ms et une
  recherche de chemin au plus 1,4 ms. Les pics de 10 à 17 ms ne viennent
  qu'au premier lancement, tant que le code n'est pas encore optimisé. La
  recherche de chemin n'a donc pas été mise en file d'attente : cela aurait
  changé le comportement des unités pour un gain inférieur à 1 ms.
- **Interface** : comparaison alternée dans la même page, 3 × 120 images, à
  quatre camps avec le QG sélectionné. Mutations du DOM : 9 par image avant,
  0,02 à 0,03 après. Temps des trois fonctions d'interface : 0,30 à
  0,36 ms par image avant, 0,03 à 0,06 ms après. Minicarte : 120 dessins
  pour 120 images avant, 11 à 12 après, vue immobile.
- **Tri des unités dans `separer`** : 10 à 12 µs avant, 3,4 à 4,6 µs après,
  pour 54 unités.

Non mesuré ou pas encore effectif : le gain du préchauffage dépend de
`R3D.prechauffer`, absent des modules au moment de cet essai. Une escarmouche
de 3 minutes montrait encore une première image de 1 096 ms et des images de
109 à 276 ms. La fluidité ressentie sur le portable du propriétaire reste à
confirmer avec F8.
