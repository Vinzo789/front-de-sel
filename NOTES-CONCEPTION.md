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
| `reseau.js` | Multijoueur : transport MQTT, salon, ordres, événements, codec binaire des instantanés (voir « Multijoueur ») |

Principe : le moteur ne dessine rien en 3D. Il tient des listes d'entités et
d'effets, et les modules 3D les mettent en scène à chaque image, à travers
l'objet global `R3D`. On peut donc modifier les règles sans toucher au rendu,
et inversement.

Chaque balise `<script>` porte un numéro de version (`?v=33` au 16 novembre 2026 : délai de retour d'un joueur porté à 120 secondes ; `?v=32` : annonce du salon liée à son serveur, issue de la partie annoncée par l'hôte ; `?v=31` : écran de fin de l'invité seulement sur la fin confirmée par l'hôte, clés des joueurs partis jamais oubliées, voir « Multijoueur » ; `?v=30` : compteurs datés dans le futur et identifiant d'un joueur sorti du salon ; `?v=29` : retour d'un invité et fin de partie protégés ; `?v=28` : messages en ligne signés ; `?v=26` et `?v=27` : multijoueur corrigé et protégé ; `?v=25` : multijoueur en ligne ; `?v=24` : seconde passe de fluidité, voir « Fluidité » à la fin ; la version publiée sur GitHub Pages est encore la 24, solo seulement). **Il faut
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

## Multijoueur (13 novembre 2026, `?v=25` ; corrigé le 14 novembre 2026, `?v=26`, `?v=27`, `?v=28` : messages signés, puis `?v=29`, `?v=30`, `?v=31` et `?v=32` le 15 novembre, `?v=33` le 16)

Escarmouche en ligne de 2 à 4 joueurs humains, places restantes tenues par l'ordinateur ou fermées. Un
joueur **héberge** : son navigateur fait tourner la partie et fait autorité. Les autres **rejoignent** :
leur navigateur ne simule rien, il reçoit l'état 10 fois par seconde, lisse les mouvements et envoie les
ordres du joueur, que l'hôte vérifie avant de les appliquer. Conception et mesures détaillées :
`travaux/multijoueur/` (`INVENTAIRE-MOTEUR.md`, `ESSAIS-MQTT.md`, `INTERFACE-RESEAU.md`). Code :
`reseau.js` (transport, salon, codec) et `jeu.js`, sections « 11 ter » (instantanés, lissage, mode d'essai
`?echo`) et « 11 quater » (salon, partie en ligne, cas limites).

### Héberger
1. Escarmouche, choisir la carte, puis « Héberger une partie ».
2. Pseudonyme (16 caractères au plus, rien d'autre n'est demandé), difficulté des ordinateurs, camp et
   équipe de l'hôte, puis pour chaque autre place : joueur (en attente), ordinateur Halden, Karsk ou
   aléatoire, ou fermé, et son équipe. Les raccourcis d'équipes de l'escarmouche solo sont repris.
3. « Ouvrir le salon » : le code (6 signes, par exemple `K7M-4QX`) s'affiche en grand, avec le lien
   d'invitation à copier. Les arrivées, les camps choisis, l'état « prêt » et la latence de chacun se
   mettent à jour en direct ; « Retirer » expulse un joueur.
4. « Lancer la partie » s'active quand au moins un autre joueur est là et que tous sont prêts. Une place de
   joueur restée vide au lancement est fermée.

### Rejoindre
- Ouvrir le lien reçu (`…?salon=CODE&srv=h`) : l'écran « Rejoindre » s'ouvre avec le code ; ou bien
  Escarmouche, « Rejoindre une partie », et taper le code (tirets et minuscules acceptés).
- Si l'hôte joue une autre carte, la page se recharge d'elle-même sur cette carte et rejoint seule le salon.
- Depuis `?v=32`, quand le code est tapé à la main, l'adresse de la page reçoit `?salon=CODE` : recharger la page
  (F5) ramène seul dans le salon ou dans la partie, comme avec le lien.
- Choisir Halden ou Karsk, éventuellement une autre place libre, puis « Je suis prêt ». Les équipes sont
  fixées par l'hôte.
- Refus annoncés en clair : version du jeu différente, salon complet, partie déjà commencée, code inconnu,
  salon fermé, serveur injoignable, carte différente (empreinte de la grille), place libérée par l'hôte, et
  (depuis `?v=28`) navigateur sans les fonctions cryptographiques nécessaires (page ouverte hors https).
- Pendant la connexion, le bouton dit où l'on en est : « Connexion au serveur HiveMQ… », « Recherche du salon
  sur HiveMQ et Mosquitto… » (sans serveur indiqué, les deux sont essayés en même temps), « Nouvelle
  tentative… », serveur de secours, « Salon trouvé : en attente de la réponse de l'hôte… ». Un code inconnu a été
  annoncé en 6,6 s puis 7,9 s (deux essais ; 13 s avant le 14 novembre).
- Le pseudonyme tapé est proposé la fois suivante (gardé dans le navigateur, clé `frontDeSel.pseudo`).

### Reprendre son siège (14 novembre 2026)
- **Onglet rechargé, ou fermé puis lien rouvert** dans le même navigateur : le jeu rentre seul dans la partie en
  cours, au même camp, s'il revient **avant 2 minutes** (120 secondes depuis `?v=33`, 60 avant ; ensuite le camp est
  confié à l'ordinateur). Pour cela,
  le navigateur garde, pour chaque salon, un identifiant d'onglet et un « jeton » de siège (clé
  `frontDeSel.reseau.<CODE>`, avec la date). Cette mémoire est effacée à une fin de partie certaine (depuis
  `?v=29` : annoncée par l'hôte dans un message que lui seul peut signer pour ce joueur), quand le joueur quitte, après un refus définitif à l'arrivée (partie commencée, camp confié,
  joueur retiré, salon fermé ou inconnu…) et au bout de 3 heures. Depuis `?v=27`, une fin annoncée par le réseau
  sans être certaine (hôte parti, salon fermé, camp confié) la laisse en place : si l'annonce était fausse, le
  lien rouvert rend le siège ; si elle était vraie, il trouve le salon fermé et l'efface. Sans elle (autre
  navigateur, autre ordinateur, navigation privée fermée), le retour est impossible.
- **Deux onglets ouverts en même temps** sur le même lien : le second ne prend pas le siège du premier. Dans le
  salon, il prend une autre place ; en partie, il affiche « Cette partie est déjà ouverte dans un autre onglet de
  ce navigateur ». Depuis `?v=27`, l'onglet entré tient un **verrou du navigateur** (Web Locks) toute sa vie :
  même figé ou occupé, il garde son siège (avant, il devait répondre en 250 ms). Depuis `?v=28`, ce verrou est
  aussi rendu quand on quitte le salon par le bouton, quand le salon ou la partie se termine, et quand l'onglet
  entre dans un autre salon (avant, un autre onglet pouvait se croire doublon à tort). Si deux connexions tiennent
  quand même le même siège, l'hôte recale la numérotation des ordres de celle qui est en retard au lieu de jeter
  ses ordres en silence : les ordres qu'elle a envoyés pendant ce recalage sont perdus (« doublons jetés » visible
  au F8). Depuis `?v=28`, si les deux connexions n'ont pas la même horloge, les messages de celle qui est en
  retard sont jetés (limite L5 plus bas).
- **Retour au menu après une partie interrompue** (hôte parti, salon fermé) : depuis `?v=28`, la mémoire du siège
  est effacée, puisque le joueur a choisi de partir (avant, elle restait 3 heures).
- **Retour protégé** (`?v=29`) : pendant qu'un invité revient, il n'accepte plus que la réponse de l'hôte signée
  avec sa clé de siège, et liée à cette arrivée précise. Avant, quelqu'un qui écoutait le serveur (même sans le
  code) pouvait rejouer une ancienne réponse de l'hôte, ou un autre joueur pouvait en forger une : l'invité revenait
  avec une clé que l'hôte ne connaissait pas, ses ordres étaient sans effet et son camp passait à l'ordinateur sans
  qu'il le sache. Un « refus » qui ne porte que la signature commune du salon (qu'un autre joueur peut forger) n'est
  plus cru pendant un retour : l'invité attend la vraie réponse 8 s, puis affiche « L'hôte n'a pas confirmé votre
  retour : réessayez dans un instant » et garde sa place mémorisée.
- **Retour protégé dans le salon** (`?v=30`) : quand un invité a quitté le salon sans le dire (onglet fermé ou
  rechargé), l'hôte garde sa clé de siège et n'accepte plus son identifiant qu'avec elle. Avant, un autre joueur
  (qui a le code) pouvait prendre cet identifiant, s'asseoir à sa place sous un faux pseudonyme et l'empêcher de
  revenir pendant 3 heures. Depuis `?v=31`, l'hôte **n'oublie plus jamais** ces clés tant que le salon vit (avant,
  il n'en gardait que 32 : un autre joueur pouvait les faire oublier en entrant et sortant 32 fois, puis refaire
  le même vol). Si la table est pleine (4 096 entrées et sorties : salon attaqué), les nouveaux venus sont refusés
  (« salon complet ») ; un joueur qui revient avec sa place mémorisée entre toujours.
- Après un refus définitif, le lien ouvre l'écran « Rejoindre » avec un message clair et n'essaie plus seul.
- Si l'hôte est en pause (ou la partie finie) au moment du retour, le monde s'affiche quand même tout de suite.

### En partie
- Chacun tient son camp ; les ordinateurs complètent. Bandeau discret en haut : état de la connexion,
  latence, joueurs déconnectés ; F8 ajoute débit, aller-retour, instantanés et, s'il y en a, les messages jetés
  par la vérification des signatures.
- **Pause** : l'hôte seul (touche P, bouton, ou fenêtre Commandes) ; tous voient la pause. Depuis `?v=27`,
  chaque instantané porte l'état de pause de l'hôte et c'est lui qui fait foi chez l'invité (un faux message
  « pause » ne fige plus son affichage plus d'un dixième de seconde). Depuis `?v=28`, l'invité en pause montre
  exactement l'état où l'hôte s'est arrêté (avant, il restait figé un peu plus tôt, d'environ 0,1 s).
- **Ordre refusé** : un pouvoir sans assez de points ou en recharge, ou un ordre d'un camp éliminé, est refusé
  tout de suite chez l'invité, comme en solo (avant, il partait et rien ne se passait) ; si l'hôte le refuse quand
  même (état changé entre-temps), le motif s'affiche chez l'invité.
- **Invité parti** (onglet fermé, coupure) : annonce à tous environ 2,5 s après la coupure (une coupure plus
  brève n'est pas annoncée) ; son camp reste immobile ; s'il revient dans les 2 minutes (même onglet
  rechargé, ou lien rouvert dans le même navigateur : voir « Reprendre son siège »), il reprend son siège ;
  sinon son camp est confié à l'ordinateur, le bandeau des camps l'indique chez tous (« ordinateur (Alice
  parti) ») et un retour est refusé. **Délai porté de 60 à 120 secondes en `?v=33`** (décision du propriétaire, le
  16 novembre 2026) : le bandeau de l'hôte décompte « confié dans … s » à partir de 120. Si c'est la connexion de
  l'invité qui tombe sans qu'il ferme l'onglet, son jeu attend maintenant lui aussi 2 minutes le retour de la
  connexion et reprend seul (avant, il renonçait au bout d'une minute) ; passé ce délai, il affiche « Votre
  connexion au serveur est coupée depuis plus de deux minutes… ». Inchangé : si c'est l'hôte qui ne donne plus de
  nouvelles pendant une minute, la partie se termine pour tous (au pire 3 minutes chez un invité dont la connexion
  tombe et revient sans arrêt pendant ce temps).
- **Hôte parti** : la partie se termine pour tous (écran « Partie interrompue », retour au menu). Si l'hôte
  quitte par le bouton, l'annonce arrive en 3 s environ (vérification : l'invité attend que l'hôte se taise,
  `?v=27` ; elle était immédiate avant) ; s'il ferme brutalement l'onglet, les invités attendent 10 secondes
  son retour.
- **Fin** par équipe : une équipe gagne quand toutes les autres sont éliminées ; un joueur éliminé alors que
  son équipe tient encore reste spectateur. Chaque joueur a son écran de fin, avec la même durée partout et
  ses propres statistiques (unités produites, pertes, ennemis détruits) : l'hôte, qui seul les compte, les
  envoie à tous à la fin de la partie. Un joueur dont l'équipe a perdu avant la fin les voit apparaître à la
  fin de la partie. Depuis `?v=28`, chez un invité, l'écran de fin n'apparaît que sur la fin confirmée par
  l'hôte ou quand l'élimination est restée vraie pendant au moins une seconde de jeu reçue sans interruption ; un
  état reçu qui marquait un camp éliminé à tort est corrigé par le suivant. Depuis `?v=29`, l'hôte confirme la fin
  à chaque invité par un message signé avec sa clé de siège : l'écran de fin arrive donc presque aussitôt (en
  `?v=28`, environ 3 s après). Une fin annoncée sans ce message (qu'un autre joueur aurait pu forger, avec un faux
  état ne laissant qu'une équipe en vie) ne fait plus quitter la partie ni oublier le siège : elle n'est crue que si
  l'hôte se tait ensuite 3 s. La durée affichée reste la même des deux côtés. Depuis `?v=30`, « l'hôte se tait »
  tient aussi compte de ses réponses aux battements de l'invité (signées avec la clé de siège, qu'aucun autre joueur
  ne peut ni forger ni faire jeter), et une telle fin non certaine ne libère plus le siège chez l'hôte.
  **Depuis `?v=31`, chez un invité, l'écran de fin (VICTOIRE ou DÉFAITE) n'apparaît plus que sur la fin confirmée
  par l'hôte.** Une élimination lue dans les états reçus ne donne plus que l'état « spectateur » (message à l'écran),
  qui se défait de lui-même si les états suivants la démentent. Avant, une seconde de faux états, forgés par un
  autre joueur, affichait une DÉFAITE définitive, et le bouton « Retour au menu » faisait alors perdre sa place à la
  victime. Deux conséquences à connaître : (1) l'écran de fin d'un invité arrive un peu après celui de l'hôte :
  environ 3,5 s en `?v=31` (l'hôte annonçait la fin 3 s après le dernier état, et non « presque aussitôt » comme
  écrit plus haut pour `?v=29`), **environ 1,6 s depuis `?v=32`** (l'hôte l'annonce 1,5 s après ; mesuré : VICTOIRE
  chez l'hôte 0,6 s après la destruction, DÉFAITE chez l'invité 2,2 s après) ; depuis `?v=32` aussi, VICTOIRE ou
  DÉFAITE se lit dans l'équipe gagnante que l'hôte annonce, pas dans l'état affiché ; (2) dans une partie à 3 ou 4 équipes, un invité dont
  toute l'équipe est éliminée **reste spectateur jusqu'à la fin générale** (il peut regarder ou quitter), alors que
  l'hôte, lui, voit son écran de fin tout de suite.
- **Onglet caché** : la simulation de l'hôte et la réception des invités continuent par un minuteur de Web
  Worker (le navigateur fige l'affichage et ralentit les minuteries d'un onglet caché) ; le rendu est sauté.
  Le titre de l'onglet de l'hôte devient « partie hébergée en cours » et un message rappelle au retour que
  la fenêtre doit rester ouverte.
- Campagnes et mode Surprises : **solo seulement** (phrase d'explication sur l'écran du salon).
- Le jeu en solo ne charge ni la bibliothèque MQTT ni aucune connexion : `reseau.js` est inclus mais
  n'agit qu'au clic sur « Ouvrir le salon » ou « Rejoindre ».

### Serveurs
Serveurs MQTT publics et gratuits, par WebSocket sécurisé (`wss://`, seul possible depuis GitHub Pages) :
HiveMQ (`broker.hivemq.com:8884`) par défaut, Mosquitto (`test.mosquitto.org:8081`) en secours si HiveMQ
ne répond pas. Le lien d'invitation indique le serveur (`&srv=h` ou `&srv=m`). Pour en imposer un autre,
ajouter à l'adresse, chez l'hôte **et** dans le lien des invités : `&srv=m` (Mosquitto), `&srv=e` (EMQX,
plus limité en cadence) ou `&srv=wss://mon.serveur:port/chemin` (adresse complète, encodée). La liste
est dans `reseau.js` (`SERVEURS_MQTT`, `CHAINE_DEFAUT`).

### Limites, honnêtement
- **Serveurs publics sans aucune garantie** : disponibilité, lenteurs (connexions à HiveMQ de 6 à 7 s une
  fois sur deux le 13 novembre ; un échec de connexion observé pendant les essais), règles qui peuvent
  changer sans préavis.
- **Messages signés depuis `?v=28`, mais pas chiffrés.** Le serveur est public : n'importe qui peut lire tout le
  trafic et y publier. Pour cette raison, chaque message porte désormais une **signature** (un « sceau »), calculée
  avec une clé que seuls les joueurs qui ont le code du salon peuvent obtenir ; le code lui-même ne passe jamais sur
  le serveur. Puis chaque invité, en arrivant, convient avec l'hôte d'une **clé de siège** que personne d'autre ne
  connaît, pas même les autres joueurs : ses ordres, ses demandes et les messages privés de l'hôte vers lui sont
  signés avec elle. Un message sans signature valable, ou déjà vu (rejoué), est jeté sans rien changer (le F8 compte
  « messages jetés : … sans sceau valable, … rejoués »). Ce que cela apporte : **quelqu'un qui n'a pas le code ne
  peut plus rien changer**, ni chez l'hôte ni chez un invité (avant, il pouvait par exemple terminer la partie chez
  tous les invités en moins d'une seconde, ou y afficher une fausse défaite). Les limites qui restent sont dites
  plus bas (L1 à L6). Seul le pseudonyme circule : n'y mettre aucune donnée personnelle.
- **L1 — pas de chiffrement** : quiconque écoute le serveur lit les pseudonymes et tout l'état de la partie.
- **L2 — gêne passagère possible sans le code** : un inconnu peut noyer les sujets du salon de messages faux (jetés
  à faible coût), écraser la description du salon (l'hôte la republie dans la seconde, une arrivée reste possible
  en quelques secondes) ou republier un vieux message. Tant qu'il publie, cela gêne ; cela ne change rien à la partie.
  Depuis `?v=32`, l'annonce d'un salon dit sur quel serveur il vit, et un joueur ignore une annonce qui ne correspond
  pas au serveur où il la lit : avant, un inconnu pouvait recopier une seule fois l'annonce sur l'autre serveur public,
  et un joueur qui tapait le code à la main (le jeu cherche alors sur les deux serveurs) tombait une fois sur deux
  sur « L'hôte ne répond pas ». Le lien d'invitation, qui nomme le serveur, n'était pas touché. Gênes qui restent,
  sans effet sur la partie : le bandeau « hôte injoignable » peut clignoter chez un invité tant qu'un inconnu rejoue
  la dernière annonce de fermeture de l'hôte ; après la fermeture d'un salon, quelqu'un peut rejouer sa dernière
  annonce « ouvert », et un arrivant lit alors « L'hôte ne répond pas » au lieu de « salon fermé » ; un déluge de très
  gros messages faux coûterait du temps de calcul à un invité (6 ms par faux de 256 Ko, mesuré ; non essayé à travers
  les vrais serveurs, qui limitent sans doute ce débit).
- **L3 — un joueur invité (qui a le code) peut tricher contre les autres invités** : il peut forger ce que l'hôte
  diffuse à tous (description du salon, état de la partie, annonces), donc fausser ou figer un moment l'affichage des autres
  invités, ou intercepter l'arrivée d'un nouveau joueur. Il ne peut **pas** donner d'ordres à
  un autre camp, ni prendre ou libérer le siège d'un autre, ni rien changer chez l'hôte autrement que par ses propres
  ordres, vérifiés comme ceux de tout joueur (depuis `?v=29`, ni pendant le retour d'un autre joueur, ni par une
  fausse fin de partie : deux failles trouvées en `?v=28` et corrigées ; depuis `?v=30`, ni en datant ses faux
  messages dans le futur pour faire jeter les vrais pendant des heures, ni en prenant l'identifiant d'un joueur
  sorti du salon : deux failles trouvées en `?v=29` et corrigées). Ce qui reste : tant qu'il publie, il peut faire
  jeter les vrais états de la partie chez les autres invités (au plus 10 s après son dernier message), sans pouvoir
  leur faire quitter la partie tant que l'hôte leur répond. Pour limiter le dégât, depuis `?v=31`, un invité n'affiche
  son écran de fin que sur la fin confirmée par l'hôte (message que ce joueur malveillant ne peut pas forger) : de
  faux états peuvent au plus lui afficher un moment « vous êtes spectateur », ce qui se corrige seul (attention : un
  joueur qui y croit et clique lui-même « Quitter » puis confirme perd bien sa place) ; depuis `?v=32`, VICTOIRE ou
  DÉFAITE se lit dans l'équipe gagnante annoncée par l'hôte, et non dans l'état affiché. Il peut aussi fausser les
  statistiques de l'écran de fin des autres invités, et bloquer l'arrivée de nouveaux joueurs : en entrant et sortant
  sans arrêt pendant un quart d'heure (4 096 fois), il sature le salon, qui refuse alors tout nouveau venu jusqu'à sa
  fermeture (l'hôte n'en est pas averti ; les joueurs déjà venus reviennent toujours). Remède : ouvrir un nouveau
  salon, avec un nouveau code.
  **Ne partagez le code qu'avec des personnes de confiance.**
- **L4 — code devinable par la force** : quelqu'un d'équipé peut essayer tous les codes hors ligne (25 puissance 6
  possibilités, rendues lentes exprès). Ordre de grandeur estimé, **non mesuré** : des heures de carte graphique.
- **L5 — horloge du PC** : si l'horloge de l'ordinateur d'un invité recule entre deux chargements de la page, son
  retour dans la partie peut être refusé.
- **L6 — l'hôte fait autorité** : rien n'empêche un hôte de tricher (c'est son navigateur qui calcule la partie).
- **Ce qui est protégé** (14 novembre 2026). Tout ce qui arrive du réseau est contrôlé deux fois, par
  `reseau.js` (forme des messages) puis par `jeu.js` (sens : camps, factions, équipes, cartes, types d'unités
  connus, nombres bornés à la carte, couleurs des camps toujours locales, texte toujours affiché comme du
  texte). Un message forgé, quel qu'en soit l'auteur (inconnu, invité ou hôte), **ne peut pas** : exécuter du script dans la page, ouvrir une autre adresse (seules
  les cartes du jeu sont admises au rechargement), écrire dans le stockage du navigateur (seuls la mémoire du
  siège et le pseudonyme y sont écrits, par le jeu lui-même), faire planter la page, ni figer un invité
  durablement (un instantané à l'heure aberrante est écarté au bout de 3 instantanés, soit 0,3 s ; une
  description écrasée est republiée par l'hôte dans la seconde).
- **Un seul message ne termine plus une partie** (`?v=27`) : un faux « partie finie », « salon fermé », « camp
  confié » ou « retiré » est vérifié avant d'être cru (depuis `?v=29` : l'hôte me l'a-t-il confirmé par un message
  signé avec ma clé de siège ? sinon, se tait-il ou cesse-t-il de me répondre pendant 3 s ?) et ignoré si l'hôte continue de jouer ; un faux
  lancement publié avant le vrai n'est plus pris (l'invité démarre sur le message privé de l'hôte) ; un faux
  « pause » est démenti par l'instantané suivant ; un battement de cœur capté puis republié est refusé
  (compteur), donc un camp abandonné est bien confié à l'ordinateur. Prix : la fermeture par l'hôte met 3 s à
  arriver chez les invités. Limite : une annonce forgée qui tombe pendant un vrai silence de l'hôte de plus de
  3 s est crue.
- **Ce qui n'était pas protégé avant `?v=28`** (pour mémoire) : les messages n'étant pas signés, quelqu'un qui
  lisait le trafic voyait passer les jetons des sièges et pouvait se faire passer pour un joueur ou forger de
  faux états. Le jeton circule toujours en clair (L1), mais il ne suffit plus à rien : les ordres d'un siège ne
  sont acceptés que signés avec sa clé de siège, qui ne circule jamais.
- **Pare-feu** : un réseau d'entreprise ou d'école peut bloquer les WebSockets vers ces ports ; le message
  « Aucun serveur n'est joignable » s'affiche alors.
- **L'onglet de l'hôte doit rester ouvert** jusqu'à la fin : il porte la partie. Pas de migration d'hôte.
- **Jamais essayé entre deux réseaux ni deux ordinateurs** : tous les essais ont été faits avec plusieurs
  onglets d'un même navigateur, sur un même poste, à travers HiveMQ. Jamais joué à la souris en ligne.
- Latence : 60 à 100 ms d'aller-retour mesurés ce soir-là ; un ordre d'invité met donc au moins un
  aller-retour (plus le lissage de 0,15 s depuis le 14 novembre, 0,12 s avant) à se voir.
- Deux onglets d'un même navigateur dans un même salon : un onglet dupliqué ne vole pas le siège de
  l'autre, il prend une autre place (ou il est refusé).

### Vérifié le 13 novembre 2026 (onglets du navigateur intégré, serveur HiveMQ réel)
Panneau du navigateur caché pendant tous les essais : les onglets étaient donc « cachés » (affichage figé),
la partie a tourné par le minuteur du Worker. L'affichage normal (requestAnimationFrame) et le jeu à la
souris en ligne n'ont **pas** été observés.
- Salon : création en 0,6 s ; lien d'invitation qui ouvre l'écran « Rejoindre » avec le code ; arrivée en
  6,9 s (connexion à HiveMQ) ; choix du camp, « prêt », latence affichée chez l'hôte ; lancement.
- Partie à 3 camps (2 humains, 1 ordinateur) : ordres de l'invité acceptés par l'hôte (construction d'une
  caserne, production d'un ouvrier, d'un collecteur et de deux fantassins, ralliement, déplacement,
  attaque-déplacement) ; ordre sur une unité adverse refusé ; mêmes réserves et même nombre d'entités des
  deux côtés ; pause de l'hôte vue par l'invité (horloges figées), pause refusée à l'invité avec message.
- Rechargement de la page de l'invité en partie : retour au même siège ; coupure franche du transport
  (`couperTransport`) : reconnexion en 1,8 s, 3 événements rattrapés, 0 perdu, entités identiques.
- Fin de partie naturelle à 4 min 30 : « Victoire » chez l'hôte, « Défaite » chez l'invité, salon fermé.
- Partie à 3 humains : invité parti, annonce chez l'autre invité, camp confié à l'ordinateur après 61 s,
  retour ensuite refusé (« Votre camp a été confié à l'ordinateur ») ; puis « Quitter » chez l'hôte :
  l'autre invité voit « L'hôte a fermé la partie » en moins de 0,1 s.
- Refus : salon complet, version différente (24 contre 25), partie commencée, code inconnu (6,5 s),
  serveur inexistant ; messages malformés, au mauvais jeton, trop gros, en rafale (40 sur 60 refusés par
  l'invité lui-même) : rejetés sans erreur JavaScript.
- Carte de l'hôte différente (Gorges de Varsèche) : rechargement automatique de l'invité et retour dans le
  salon (au second essai : le premier a échoué sur la connexion à HiveMQ).
- Règle d'or : empreintes d'état identiques à la copie `travaux/reference-v24` (même hasard fixé) pour un
  duel de 600 s, une partie à 4 camps (Ultra, Difficile, Facile) et une partie en mode Surprises ;
  8 missions jouées par les robots sans erreur (`halden-3` non conclue en 1 800 s et `karsk-4` perdue par le
  robot, comme dans la référence) ; rien laissé dans `localStorage`.

### Vérifié le 14 novembre 2026 (`?v=26`, même poste, onglets cachés du navigateur intégré)
Mesures ponctuelles, une seule séance, d'autres programmes actifs sur le poste : les durées sont bruitées.
Panneau du navigateur caché : l'affichage normal et le jeu à la souris en ligne n'ont **toujours pas** été
observés ; **jamais essayé entre deux ordinateurs ni entre deux réseaux**.
- **Messages forgés**, dans la page réelle du jeu (écran du salon et partie en cours), par un intrus branché sur
  la boucle locale et par injection directe dans `jeu.js` (pour éprouver ses contrôles sans ceux de
  `reseau.js`) : description à index et pseudonyme piégés, couleur piégée dans le lancement, textes HTML dans
  les messages, coordonnées démesurées, faction ou carte « `constructor` », 10 000 unités, nombres non finis,
  types inconnus, identifiants hors bornes, ordres d'invité visant `__proto__` ou une unité adverse. Aucun
  script exécuté, aucune image injectée, aucune erreur JavaScript ; l'invité n'est pas resté figé (temps
  aberrant écarté, flux réel repris) ; siège d'un invité présent conservé malgré une présence vide et un faux
  « parti ». Essais de `reseau.js` (`essai-codec.html?essai=tout`) : 32 verdicts sur 32.
- **Partie entre deux onglets à travers HiveMQ** (3 minutes de jeu) : salon ouvert en 0,4 s, invité arrivé par
  le lien en 0,7 s ; ordres de l'invité appliqués (déplacement, production), sa demande de pause refusée ;
  pause de l'hôte ; **onglet de l'invité fermé pendant la pause, lien rouvert dans un nouvel onglet** : retour
  automatique dans la partie en 5 à 6 s, même camp, monde affiché tout de suite malgré la pause ; un second
  onglet ouvert pendant ce temps n'a pas pris le siège (« déjà ouverte dans un autre onglet ») ; reprise ;
  fin de partie : « Victoire » chez l'hôte, « Défaite » chez l'invité, **durée 03:00 des deux côtés**, et chez
  l'invité ses propres statistiques ; mémoire du siège effacée à la fin.
- **Cadence** (hôte mené par le minuteur du Worker, 20 s par mesure) : avant correction 7,6 instantanés par
  seconde (écart médian 140 ms, 160 prolongations de l'affichage) ; après, 10 par seconde (écart médian 97 à
  100 ms ; 58 puis 99 prolongations, écarts de 100 ou 150 ms) ; avec un retard d'affichage porté à 0,15 s,
  38 prolongations : retard fixé à 0,15 s. L'hôte à l'affichage normal n'a pas pu être mesuré.
- **Bandeau** : camp d'un invité parti confié à l'ordinateur affiché « ordinateur (… parti) » chez l'hôte
  (essai sur la boucle locale, délai raccourci à 8 s pour l'essai) et chez un invité (instantané marquant le
  camp comme ordinateur).
- **Règle d'or** : empreintes identiques à `travaux/reference-v24` (servie sur un autre port, même hasard
  fixé, pages neuves) pour un duel de 300 s (`7d442efb`), une partie à 4 camps Ultra/Difficile/Facile/Normale
  de 600 s (`58b863c6`) et une partie en mode Surprises (`de0bf6e9`), refaites après les dernières
  corrections ; 8 missions jouées par les robots avec les mêmes empreintes que la référence (`halden-3` et
  `halden-4` non conclues en 1 800 s dans les deux ; jouées avant les dernières retouches, qui ne touchent que
  le code en ligne) ; aucune bibliothèque MQTT chargée en solo.

### Vérifié le 14 novembre 2026, second tour (`?v=27`, mêmes conditions, durées bruitées)
- Boucle locale, intrus abonné à `fds/#` : faux `debut` publié avant le lancement (graine 666) → les deux invités
  démarrent sur la vraie (42) ; faux `fin` au numéro suivant → annonce démentie, partie continue, siège « là »,
  le vrai événement de même numéro livré en retard ; faux `ferme` à +20 → jeté par le rattrapage ; faux refus
  `confie` et `expulse` avec la preuve lue dans un battement → démentis ; deux connexions sur un même siège →
  1 doublon, 1 recalage, ordres suivants acceptés ; battements de B rejoués 16 s après son départ → 16 rejets
  `rejeu`, départ puis camp confié (délai raccourci à 8 s) ; vraie fin de l'hôte → vue en 3,1 s.
- Mode `?echo` (jeu réel) : faux `pause` → affichage non figé (horloge 3,9 → 15,0 s avec l'hôte), tampon 1 ou 2 ;
  vraie pause vue, reprise vue ; 200 instantanés injectés d'un coup → tampon 50 ; faux `fin` (équipe B) et faux
  refus `confie` → aucun écran de fin, siège « là ».
- Partie réelle entre deux onglets à travers HiveMQ : salon 1,4 s, arrivée 1,7 s, lancement par le message privé,
  2 ordres acceptés, pause vue ; troisième onglet sur le lien → « déjà ouverte dans un autre onglet » par le
  verrou (BroadcastChannel non utilisé) ; fin : « Victoire » / « Défaite », durée et statistiques identiques,
  mémoire du siège effacée. `essai-codec.html?essai=tout` : 32 verdicts sur 32.
- Règle d'or (référence v24 servie sur un autre port, pages neuves, même hasard) : duel difficile/normal 300 s
  graine 4242 `7d442efb` ; 4 camps Ultra/Difficile/Facile/Normale 600 s graine 99 `ab7323d2` ; missions
  `halden-1` (`6053f9be`, victoire à 549 s) et `karsk-4` (`b81d2921`, victoire à 409 s), sans erreur ni
  avertissement, identiques des deux côtés.

### Vérifié le 14 novembre 2026, troisième tour (`?v=28`, messages signés ; mêmes conditions, durées bruitées)
Onglets du navigateur intégré, cachés (la partie tourne par le minuteur du Worker), d'autres programmes actifs sur
le poste : durées ponctuelles. **Toujours jamais joué à la souris en ligne, jamais entre deux ordinateurs ni entre
deux réseaux.** La signature elle-même (`reseau.js`) a été éprouvée par `travaux/multijoueur/essai-codec.html`
(voir `INTERFACE-RESEAU.md`) ; ce qui suit porte sur le jeu.
- **Mode `?echo`, intrus sans le code branché sur le bus et abonné à tout** : faux « partie finie » (deux formes),
  faux état marquant le camp de l'invité éliminé et en pause, faux « pause », faux lancement privé (« debut ») et
  faux refus privé, plus des messages authentiques rejoués : 7 jetés « sans sceau valable », 11 jetés « rejoués » ;
  à l'écran de l'invité rien n'a changé pendant 4 s (pas d'écran de fin, camp non éliminé, pas de pause, horloge qui
  avance, 35 états appliqués), aucune erreur.
- **Même mode, faux état injecté directement dans `jeu.js`** (ce qu'un joueur qui a le code pourrait envoyer, L3) :
  camp marqué éliminé pendant un instant, puis rétabli par l'état suivant, aucun écran de fin ; contre-épreuve,
  vraie destruction des bâtiments de l'invité chez l'hôte : écran « Défaite » 1,1 s après l'élimination.
- **Pause** (`?echo`) : l'invité affiche l'instant exact où l'hôte s'est arrêté (41,85 s des deux côtés), puis
  reprend. **Ordre refusé** : pouvoir sans assez de points refusé tout de suite chez l'invité ; envoyé quand même
  à l'hôte, refusé par lui et motif affiché chez l'invité.
- **Partie réelle entre deux onglets à travers HiveMQ** (un peu plus de 3 minutes de jeu) : salon ouvert en 0,6 s ;
  invité par le lien d'invitation, arrivé en 6,4 s (connexion à HiveMQ lente, comme souvent) ; bouton « Quitter le
  salon » : verrou du navigateur rendu, mémoire du siège effacée ; retour dans le salon, prêt, lancement ; ordres
  de l'invité acceptés par l'hôte (déplacement, construction d'une caserne, production d'un sapeur, puis un second
  déplacement) ; pause de l'hôte vue au même instant chez l'invité, reprise vue ; **onglet de l'invité fermé, lien
  rouvert dans un nouvel onglet** : retour automatique au même camp en 5 s (moins de 25 s après la fermeture), hôte
  qui le voit « là » ; fin (bâtiments de l'invité détruits chez l'hôte) : « Victoire » chez l'hôte, « Défaite » chez
  l'invité, **durée 03:05 des deux côtés**, mémoire du siège effacée et verrou rendu chez l'invité ; 0 message jeté
  par le sceau chez l'invité ; **aucune erreur JavaScript** dans les deux onglets.
- **Hôte parti** (onglet de l'hôte fermé brutalement, autre partie) : « Partie interrompue » chez l'invité 10,5 s
  plus tard, mémoire du siège encore là, puis « Retour au menu » : mémoire effacée.
- **Règle d'or** (référence v24 servie sur un autre port, pages neuves, même hasard, même position dans la suite
  d'appels) : duel difficile/normale 300 s graine 4242 `7d442efb` ; 4 camps Ultra/Difficile/Facile/Normale 600 s
  graine 99 `58b863c6` ; missions `halden-1` (`6053f9be`, victoire à 549 s) et `karsk-4` (`b81d2921`, victoire à
  409 s), sans erreur ni avertissement, identiques des deux côtés ; refaites sur la version finale. En solo :
  aucune bibliothèque MQTT ni autre fichier téléchargé, mode réseau resté nul et minuteur du réseau jamais démarré
  (la création d'un Worker n'a pas été espionnée directement), rien laissé dans `localStorage`.
  Le mode Surprises n'a pas été rejoué dans ce tour.

### Vérifié le 14 novembre 2026, quatrième tour (`?v=29` : retour et fin protégés ; mêmes conditions, durées bruitées)
Même poste, onglets cachés, d'autres programmes actifs : durées ponctuelles. **Toujours jamais joué à la souris
en ligne, jamais entre deux ordinateurs ni entre deux réseaux.**
- `travaux/multijoueur/essai-codec.html` : nouvel essai (r) qui rejoue les quatre défauts sur la boucle locale
  (accueils captés rejoués pendant le retour par quelqu'un sans le code ; accueil forgé par un joueur qui a le code ;
  refus « camp confié » forgé pendant le retour ; faux état « une équipe en vie » suivi d'un faux « partie finie ») :
  12 verdicts sur 12. Dans chaque cas, l'invité garde sa clé de siège, reprend son siège et ses ordres sont acceptés,
  ou bien sa partie continue, sa mémoire est gardée et l'hôte ne voit aucun départ. Page entière : 74 verdicts sur
  74. Le verdict S1 (essai e1) échouait par intermittence dans la page entière, à cause d'une description de l'hôte
  retardée par le navigateur dans l'onglet caché ; l'essai attend maintenant qu'elle soit partie.
- Partie réelle entre deux onglets à travers HiveMQ, deux fois : salon ouvert en 7,8 s puis 9,3 s, invité par le
  lien en 0,8 s puis 9,3 s (lenteur de connexion à HiveMQ) ; ordres de déplacement de l'invité acceptés par l'hôte
  (unité arrivée au point visé) ; **onglet de l'invité fermé, lien rouvert dans un nouvel onglet** : retour
  automatique au même camp en 5,8 s puis 10,2 s, ordre suivant accepté, hôte qui le voit « là », camp non confié ;
  fin (camp de l'invité détruit chez l'hôte) : « Victoire » chez l'hôte, « Défaite » chez l'invité, même durée des
  deux côtés, fin confirmée chez l'invité par le message privé de l'hôte (relevé dans le code de l'invité : motif
  « fin », mémoire à effacer : oui), mémoire du siège effacée ; aucun message jeté par le sceau (hors l'effacement
  normal d'un message conservé), aucune erreur JavaScript.
- Règle d'or (référence v24 servie sur un autre port, pages neuves, même hasard, même position dans la suite
  d'appels) : duel difficile/normale 300 s graine 4242 `7d442efb` ; 4 camps Ultra/Difficile/Facile/Normale 600 s
  graine 99 (factions Halden, Karsk, Halden, Karsk ; équipes A à D) `d5a481f` ; missions `halden-1` (`6053f9be`,
  victoire à 549 s) et `karsk-4` (`b81d2921`, victoire à 409 s), identiques des deux côtés, sans erreur. En solo :
  bibliothèque MQTT non chargée, mode réseau nul. Le mode Surprises n'a pas été rejoué dans ce tour.

### Vérifié le 15 novembre 2026, cinquième tour (`?v=30` : compteurs datés dans le futur, identifiant d'un joueur sorti du salon ; mêmes conditions, durées bruitées)
Même poste, onglets cachés, d'autres programmes actifs : durées ponctuelles. **Toujours jamais joué à la souris
en ligne, jamais entre deux ordinateurs ni entre deux réseaux.**
- Scénarios des contrôles, rejoués sur la boucle locale par un script injecté dans `essai-codec.html` (pas ajouté
  à la page) : enveloppes de l'hôte forgées à + 24 h (`h/etat`, `h/vie`, `h/evt` « fin ») → jetées (`avance`, 3 sur 3),
  instantanés toujours appliqués, ni fin ni départ ; forgées à + 5 s (sous la borne) → vrais instantanés bloqués
  environ 5 s, « fin » démenti par les réponses aux battements (`finForgee` 1), ni fin ni départ ; enveloppes à
  + 24 h rejouées toutes les 100 ms pendant un retour → siège repris, 65 instantanés appliqués en 6,5 s ; fin non
  sûre (hôte réellement muet) → confirmée, mémoire gardée, aucun départ « volontaire » ; dans le salon, « la »
  forgé à la clé de salon pour l'identifiant d'un joueur sorti → jeté (sceau), le joueur revient avec sa clé et
  son pseudonyme. Contre-épreuve sur une copie de `reseau.js` où ces corrections sont retirées : les deux défauts se
  reproduisent (fin « fin » et départs « volontaire » ; siège pris par « Intrus », retour en `sansReponse`).
- `essai-codec.html` en entier : 72 sur 74. Les deux échecs sont des essais anciens dont la prémisse change avec ce
  tour : (r) « défaut 4 » attend que l'annonce forgée soit lue puis démentie, alors qu'elle est maintenant jetée
  avant d'être lue (compteur + 60 s, au-delà de la borne de 10 s) ; (e) « défaut 5 (contre-épreuve) » arrête les
  minuteries de l'hôte mais le laisse répondre aux battements, que l'invité compte désormais comme signe de vie.
  Le même essai avec un hôte qui ne répond plus du tout donne bien `hoteInjoignable`. Ces deux essais sont à adapter.
- Partie réelle à travers HiveMQ, deux onglets : salon ouvert en 1,0 s, invité entré en 1,2 s au camp I, prêt,
  lancement ; deux ordres acceptés (unité 11 au point visé des deux côtés) ; onglet de l'invité fermé, lien rouvert
  dans un onglet neuf : retour automatique au camp I en 3,2 s, même identifiant ; troisième ordre accepté (hôte :
  3 reçus, 3 acceptés, siège « la ») ; fin (camp I détruit chez l'hôte) : « Victoire » chez l'hôte, « Défaite » chez
  l'invité, même durée (100,854 s), fin par le chemin sûr (motif « fin », mémoire effacée) ; aucun rejet de sceau hors
  un effacement normal, aucune erreur.
- Règle d'or : mêmes quatre empreintes que le tour précédent, identiques à la référence v24 (`7d442efb`, `d5a481f`,
  `6053f9be` victoire à 549 s, `b81d2921` victoire à 409 s). Le mode Surprises n'a pas été rejoué.

### Vérifié le 15 novembre 2026, sixième tour (`?v=31` : écran de fin de l'invité, clés des joueurs partis ; mêmes conditions, durées bruitées)
Même poste, onglets cachés du navigateur intégré, quatre contrôles automatiques actifs en même temps (poste très
chargé : les durées sont ponctuelles et pessimistes). **Toujours jamais joué à la souris en ligne, jamais entre deux
ordinateurs ni entre deux réseaux.**
- Corrections de ce tour : voir « Reprendre son siège » (clés jamais oubliées) et « En partie », Fin (écran de fin
  de l'invité sur la seule fin confirmée). Petites corrections : le bouton « Retour » de l'écran « Rejoindre » ne
  retire plus de l'adresse que `salon` et `auto` (avant, il effaçait toute l'adresse : `?diff=`, `?qualite=`…) ; le
  message « Retour dans la partie… » ne reste plus affiché dans un salon dont la partie n'a pas commencé.
- `essai-codec.html` : les deux essais restés en échec au tour précédent sont adaptés ; nouvelle famille (i),
  `?essai=sixieme` : 40 entrées et sorties n'effacent pas la clé d'un joueur parti, un « la » forgé à la clé de
  salon ne prend pas son identifiant, il revient avec la même clé ; table pleine : nouveau venu refusé « plein »,
  retour du joueur accepté (3 verdicts sur 3). Le même scénario prenait le siège sous le pseudonyme « Intrus » en
  `?v=30` (reproduit par le contrôle du tour précédent).
- Partie réelle à travers HiveMQ, deux onglets, hôte contre invité : salon ouvert en 4,4 s, invité entré par le lien
  en 4,7 s (poste chargé), latence 64 ms ; trois ordres de l'invité acceptés (déplacement, production, construction
  d'une caserne), mêmes entités et mêmes réserves des deux côtés ; 480 états reçus, 480 appliqués, aucun trou ; pause
  de l'hôte vue chez l'invité au même temps de jeu (54,35 s), reprise ; fin (camp de l'invité détruit chez l'hôte) :
  VICTOIRE chez l'hôte 0,4 s après, DÉFAITE chez l'invité 3,5 s après, par la fin confirmée (message privé de l'hôte),
  même durée (01:28) et statistiques des deux côtés ; aucun message jeté par le sceau hors un effacement normal,
  aucune erreur ni avertissement JavaScript.
- Partie réelle à trois équipes (hôte, invité, un ordinateur ; chacun pour soi) : onglet de l'invité fermé, lien
  rouvert dans un onglet neuf : l'hôte voit le départ, puis le retour au même camp avec le même identifiant
  (52 s après la fermeture, dont environ 40 s de chargement de la page sur ce poste chargé : juste sous le délai de
  60 s) ; un ordre de l'invité revenu est accepté ; camp de l'invité détruit en premier : état « spectateur » 1,4 s
  après, **pas d'écran de fin**, la partie continue à s'afficher ; dernier camp adverse détruit : VICTOIRE chez l'hôte
  0,8 s après, DÉFAITE chez l'invité 3,9 s après (fin confirmée), mémoire du siège effacée ; aucune erreur.
- Règle d'or, pages neuves, premier appel : `7d442efb` (duel 300 s, graine 4242), `22f9e99a` (quatre camps 480 s,
  graine 12), `6053f9be` (halden-1, graine 5, victoire à 549 s) : identiques aux valeurs relevées sur la référence
  v24 aux tours précédents. Bibliothèque MQTT non chargée en solo.
- Contrôles indépendants (quatre agents en lecture seule, même soir). « Invité malveillant » : aucun moyen trouvé de
  prendre l'identifiant ou le siège d'un autre, ni d'empêcher son retour ; `essai-codec.html` complet : 77 verdicts sur
  77 ; constats mineurs, repris dans « Limites » (salon saturé, statistiques de fin faussées, faux état spectateur) ou
  corrigés en `?v=32` (issue lue dans l'annonce de l'hôte ; « Retour au menu » et « Quitter » gardent les paramètres de
  l'adresse). « Inconnu sans le code » : tout message forgé, tronqué, rejoué ou déplacé est jeté (265 faux sur 10
  sujets, aucun effet) ; 200 faux par seconde pendant 10 s ne ralentissent pas l'invité (10,0 états par seconde) ; un
  défaut important trouvé et corrigé en `?v=32` : l'annonce du salon recopiée sur l'autre serveur (voir L2).
- `?v=32`, essai `essai-codec.html?essai=septieme` (deux bus locaux d'adresses différentes) : annonce recopiée sur
  l'autre « serveur » → ignorée, salon déclaré introuvable là ; la même copie sous l'adresse de l'hôte est crue
  (contre-épreuve : le défaut d'avant) ; sur le serveur de l'hôte, l'arrivée réussit (3 verdicts sur 3). Non essayé
  entre les deux vrais serveurs publics.
- Contrôle indépendant « vraies parties entre onglets » (HiveMQ, `?v=31`, poste très chargé) : partie honnête à
  deux de bout en bout (lien d'invitation, 4 ordres de l'invité acceptés, pause vue au même temps de jeu, 5
  rechargements de l'onglet de l'invité, onglet fermé puis lien rouvert, 5 coupures de connexion de chaque côté
  réparées en 1,2 s, fin : VICTOIRE et DÉFAITE cohérentes, même durée 08:02, statistiques de chacun, mémoire du siège
  effacée), sans aucune erreur JavaScript. Ses constats : (1) le retour d'un invité prend surtout le temps de
  chargement de la page (20 à 40 s sur ce poste saturé par les essais, non mesuré sur un PC ordinaire) : sur un PC lent,
  le délai de 60 s peut être dépassé, voir « Choix faits sans le propriétaire » ; (2) corrigés en `?v=32` : au retour
  dans une partie en cours, le jeu n'attend plus 2 s les vignettes ; une coupure de 6 s de l'hôte n'annonce plus à tort
  le départ d'un invité ; l'hôte annonce la fin 1,5 s après le dernier état (3 s avant), pour que l'écran de fin des
  invités ne tarde plus ; (3) laissé tel quel : après une reconnexion, le F8 compte un « message rejoué » (c'est le
  serveur qui renvoie l'annonce du salon, pas une attaque).
- Version finale `?v=32`, poste au calme (15 novembre au soir et 16 novembre au matin), HiveMQ, deux onglets :
  entrée en **tapant le code** avec tiret et minuscules (recherche sur les deux serveurs : salon trouvé sur HiveMQ),
  l'adresse reçoit `?salon=` ; page rechargée dans le salon : retour seul à la même place, même identifiant ;
  « Quitter le salon » puis « Retour » : place libérée chez l'hôte, mémoire effacée, adresse rendue sans le salon,
  `?qualite=basse` gardé. Partie : onglet de l'invité fermé, lien rouvert dans un onglet neuf : départ vu par l'hôte
  2,7 s après, siège repris 15 s après la fermeture (dont 10 s de chargement de la page), sans l'attente des
  vignettes ; ordre de l'invité revenu accepté ; fin : VICTOIRE chez l'hôte 0,6 s après la destruction, DÉFAITE chez
  l'invité 2,2 s après, même durée (01:34), statistiques des deux côtés, mémoire du siège effacée ; « Retour au
  menu » : `?diff=facile` gardé chez l'hôte, salon et serveur retirés chez l'invité ; aucune erreur ni avertissement
  JavaScript. Boucle locale : coupure de 7 s de l'hôte (seuil de silence 5 s) : aucun départ annoncé, l'invité reste
  présent. `essai-codec.html` complet sur cette version : 80 verdicts sur 80. Règle d'or refaite sur cette version, pages
  neuves : `7d442efb`, `22f9e99a`, `6053f9be` (victoire à 549 s), identiques à la référence v24, aucune erreur en
  console. Petite curiosité relevée : après une reconnexion de l'hôte, son F8 peut compter un
  message « sans sceau valable » ; c'est la première présence de l'invité, gardée par le serveur et signée avec la clé
  commune, que l'hôte n'accepte plus pour un joueur assis (aucune attaque, aucun effet).
- Remarque de méthode : les pages d'essai effacent en fin d'essai les mémoires de siège créées pendant qu'elles
  tournent, sur la même adresse locale. Un essai de retour mené en même temps doit donc se faire sur une autre
  adresse (par exemple `127.0.0.1` au lieu de `localhost`), sinon la place mémorisée disparaît en cours de route.

### Vérifié le 16 novembre 2026, huitième tour (`?v=33` : délai de retour d'un joueur porté de 60 à 120 secondes)
Même poste, onglets cachés du navigateur intégré. **Toujours jamais joué à la souris en ligne, jamais entre deux
ordinateurs ni entre deux réseaux.**
- Ce qui change : voir « En partie », Invité parti. En plus du délai de l'hôte : l'invité dont la connexion tombe
  en partie attend lui aussi (125 s : les 120 s, plus les 5 s que l'hôte met à remarquer son silence) ; à sa
  reconnexion, l'hôte a au moins 15 s pour répondre avant d'être déclaré injoignable ; sans aucun vrai signe de l'hôte
  pendant 3 minutes, la partie de l'invité se termine quoi que fasse sa connexion ; le refus affiché à la réouverture
  d'un lien trop tardive dit maintenant « (absence de plus de 2 minutes) ».
- `essai-codec.html` complet : 82 verdicts sur 82, dont trois nouveaux ou refaits : invité coupé plus longtemps que
  l'ancien délai et moins que le nouveau (aucune fin, siège gardé, états repris) ; hôte réellement parti et connexion
  de l'invité qui clignote (fin au bout de la borne, 11,9 s pour 12 s avec les délais d'essai) ; coupure de 100 s aux
  délais réels (siège gardé, tous les événements rattrapés).
- Partie réelle à travers HiveMQ, deux onglets : coupure brève de la connexion de l'invité réparée en 1,2 s, sans
  fin ni annonce ; onglet de l'invité fermé : départ vu par l'hôte 2,8 s après, bandeau de l'hôte « confié dans
  91 s » à 30 s ; lien rouvert dans un onglet neuf : **siège repris 72 s après la fermeture** (refusé avant
  `?v=33`), même identifiant, ordre accepté ; fin : VICTOIRE et DÉFAITE, même durée (02:13) ; aucune erreur.
- Contrôles indépendants (deux agents en lecture seule), aucun défaut bloquant ni important. Vrais onglets, délais
  réels : retour à 76 s accepté ; absence de 150 s : camp confié à l'ordinateur 120,0 s après le départ, refus clair
  au retour, mémoire du siège effacée, aucune nouvelle tentative ; annonce « dans 2 minutes » et décompte du bandeau
  relevés mot pour mot. Boucle locale : retour rendu à 0,9 fois le délai, refusé à 1,1 fois ; salon : 60 s inchangé ;
  hôte muet, connexion bonne : fin à 60 s, inchangée. Leurs constats mineurs sont corrigés dans cette version (borne de
  3 minutes ci-dessus, texte du refus, essais renforcés).
- Règle d'or, pages neuves : `7d442efb`, `22f9e99a`, `6053f9be` (victoire à 549 s), identiques à la référence v24 ;
  aucune erreur en console.

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

- (`?v=31`, `?v=32`) Chez un invité, l'écran de fin n'apparaît que sur la fin confirmée par l'hôte : il arrive
  environ 1,6 s après celui de l'hôte (l'attente de l'hôte avant l'annonce est passée de 3 s à 1,5 s en `?v=32`), et
  un invité dont toute l'équipe est éliminée dans une partie à 3 ou 4 équipes reste spectateur jusqu'à la fin
  générale.
- (`?v=32`) Après une partie en ligne, « Retour au menu » et « Quitter » gardent les paramètres de l'adresse
  (`?diff=`, `?qualite=`…) et n'en retirent que le salon (et le serveur venu avec un lien d'invitation). Quand un
  joueur tape le code à la main, l'adresse de sa page reçoit `?salon=CODE` : un rechargement (F5) le ramène alors
  seul dans le salon ou dans la partie.
- (`?v=33`) Le délai de retour d'un invité est passé de 60 à 120 secondes : **décidé par le propriétaire** le
  16 novembre 2026 (sur un PC lent, le chargement de la page pouvait prendre une bonne partie des 60 secondes).
  Choix d'accompagnement, à valider : l'invité dont la connexion tombe en partie attend lui aussi 120 secondes ;
  le délai laissé à l'hôte, lui, reste à 60 secondes (hôte muet une minute : fin de la partie pour tous).
- (`?v=31`) Le code du salon reste à 6 signes. Un code à 8 signes résisterait bien plus longtemps à la recherche
  par force (limite L4), au prix d'un code plus long à dicter (à décider).
- (`?v=31`) Les messages restent signés mais non chiffrés (limite L1) : les pseudonymes sont lisibles sur le
  serveur public. Les chiffrer est possible (à décider).
- (`?v=30`, revu en `?v=31`) Un invité qui revient sans obtenir de réponse de l'hôte garde sa place mémorisée et
  doit réessayer ; aucun bouton « entrer comme nouveau joueur » n'a été ajouté (proposé par le contrôle, à décider).
  Depuis `?v=31`, l'hôte ne perd plus la clé d'un joueur parti.
- (`?v=30`) « Retour au menu » sur l'écran de fin efface toujours la mémoire du siège, même après une fin non
  certaine : le joueur a choisi de partir (choix de `?v=28`, gardé).

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
2. Multijoueur en ligne : fait (voir « Multijoueur »). Reste à faire : un vrai
   essai entre deux maisons, à la souris ; puis, au choix, messages chiffrés,
   code à 8 signes, protection des diffusions de l'hôte contre un invité
   malveillant (limite L3).
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

## Fluidité (13 novembre 2026) : deux passes

Première passe (`?v=22` et `?v=23`) : à-coups supprimés (shaders compilés au chargement, interface
allégée) ; détail ci-dessous. Seconde passe (`?v=24`) : coût de chaque image (carte graphique
saturée) et derniers blocages ; détail dans « Seconde passe » plus bas. Ce qui suit, jusqu'à la
seconde passe, décrit l'état `?v=22` ; les points devenus faux sont signalés.

### Première passe (`?v=22`) : moteur et interface (`jeu.js`)

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
- **Vignettes** (`R3D.Vignettes.suspendre`) — *remplacé en `?v=24`, voir
  plus bas* : leur production est suspendue dans trois cas. Pendant le chargement, jusqu'à 1,5 s après la première
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
- **Réglages** : la case « Résolution adaptative » du menu (décochée par
  défaut depuis le 13 novembre, mémorisée) règle `R3D.adaptatif`. La case « Afficher les
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

Entre-temps (`?v=23`), les modules de rendu ont reçu leur `prechauffer` :
plus aucun programme de shaders n'est compilé en pleine partie.

### Seconde passe (`?v=24`)

Constat de départ (mesures de l'agent de la première passe, requêtes de
temps GPU) : la carte graphique est saturée à chaque image ; en vue de base,
le shader du sol prend 15 à 20 ms sur 26 à 33 ms de travail GPU ; en Moyenne
et Élevée, avec une densité d'écran de 1,25, le jeu calculait 1707 × 960
pixels pour une fenêtre de 1366 × 768. Décisions : **Moyenne devient le
réglage fluide** (densité plafonnée à 1, sol allégé), **Élevée garde tout**,
**Basse reste le repli le plus léger**. Les fichiers `r3d-*.js` (sol,
densité, modèles, effets) ont été traités par d'autres agents, chacun dans
son fichier ; ce qui suit concerne `jeu.js`, `front-de-sel.html` et
`r3d-vignettes.js`.

- **Vignettes : plus aucune production en pleine partie.** Une vignette
  bloque la page de 40 à 344 ms. Elles sont toutes produites pendant le
  chargement, le menu et le briefing ; leurs shaders sont compilés d'un coup
  dès que le module est prêt (`compilerShaders`). En partie non mise en
  pause : rien, sauf les images manquantes de l'onglet de la barre de
  construction que le joueur vient d'ouvrir (`autoriserVignettesOnglet`),
  une au plus toutes les 3 s. En pause : production normale. Si la partie est
  lancée avant la fin (lien direct `?mission=…`), l'écran de lancement attend
  au plus 2 s de plus (`ATTENTE_VIGNETTES_MS`) ; les vignettes restantes
  gardent leur pictogramme jusqu'à une pause.
- **Lancement d'une partie** (« Lancer la partie », « Commencer », `?demo`) :
  le bouton affiche « Préparation des effets… », puis, au tour suivant, la
  partie est créée, puis `R3D.Unites.preparerCamps()` (modèles aux couleurs
  des camps réels) et `R3D.prechauffer()` sont appelés s'ils existent. La
  première image ne construit ni ne compile rien. Durées dans
  `mesuresLancement`.
- **Changement de qualité au menu** : « Préparation des effets… » s'affiche à
  côté de la liste, puis le travail est lancé au tour suivant.
- **Liste « Graphismes »** : chaque qualité dit en une ligne ce qu'elle
  apporte (Basse : la plus légère ; Moyenne : fluide, recommandée ; Élevée :
  image la plus fine, pour carte graphique puissante).
- **Résolution adaptative** : case gardée, décochée par défaut. Elle ne
  concerne plus que la qualité Élevée sur un écran dense (`r3d-scene.js` ne
  descend jamais sous la résolution native de la fenêtre) ; l'info-bulle le
  dit.
- **Recherche de chemin** (`trouverChemin`) réécrite sans changer son
  résultat : tas binaire dans un tableau typé, voisins en tableaux plats,
  tests de case et heuristique en ligne. Même ordre d'exploration, mêmes
  égalités, même plafond de 7 000 itérations.

Mesures de cette passe (navigateur intégré, onglet en arrière-plan, carte
graphique et processeur partagés avec d'autres agents : temps bruités) :

- **Pics de simulation.** Chronométrage par sous-fonction (`majUnite`,
  `majBatiment`, `majIA`, `trouverChemin`, `compacter`, `separer`,
  `majMission`) et taille du tas mémoire avant et après chaque pas.
  - Missions `karsk-3` et `karsk-4` (robots de `?verif`) : les pas les plus
    longs (13 à 20 ms) tombaient tous sur des rafales de 15 à 40 recherches
    de chemin dans un même pas (ordres donnés à un groupe ; appelant :
    `allerVers`), sans ramassage de mémoire. Ils se reproduisaient au même
    instant d'une partie à l'autre (t = 13,1 s : 17 recherches). C'est donc
    du code. Après la réécriture, sur `karsk-3` : 5,4 ms à t = 13,1 s et
    7,7 ms au pire (39 recherches, 7 ms) au lieu de 20 ms (40 recherches,
    18,6 ms). Rejeu des 19 rafales réelles de `karsk-4` (300 recherches),
    ancienne et nouvelle fonction en alternance dans la même page, 5 fois :
    1,8 à 2,9 ms contre 0,4 à 0,6 ms pour la pire rafale, 9,7 à 14,2 ms
    contre 2,5 à 3,3 ms au total. Chemins identiques : 720 trajets tirés au
    hasard et ces 300 recherches. Décisions identiques : partie à quatre
    ordinateurs `avecGraine(7)` de 240 s, même empreinte (camps, réserves,
    effectifs, valeur d'armée) avec l'ancienne et la nouvelle fonction.
  - Duel `avecGraine(7, duelIA('ultra', 'ultra', 'halden', 300))` : le seul
    pas au-dessus de 15 ms (22,7 ms, t = 68,8 s) contenait une libération de
    131 Mo du tas : un ramassage de mémoire. Rejoué avec la même graine, et
    avec un autre duel (graine 11, Karsk), aucun pas au-dessus de 2,9 ms. Le
    pic de 36 ms à t = 214 s signalé avant cette passe n'a pas été reproduit.
  - Premier pas d'une mission : 5,1 ms (code pas encore optimisé), puis
    1,5 et 0,9 ms. Un premier pas à 43 ms vu une fois sur `karsk-4` ne s'est
    pas reproduit.
- **Vignettes.** Shaders des vignettes : 19 à 20 programmes, compilés en
  1,6 à 3,4 s au chargement (53 modèles). Ensuite, aucun programme nouveau
  pendant les 20 vignettes suivantes ni en partie. Une vignette coûte 38 à
  224 ms dans ces conditions. Escarmouche de 3 minutes simulées, mission
  `karsk-1` lancée par lien direct, `?demo` et `?surprise=30` (invasion,
  cinématique, alliance) : aucune vignette produite en partie non mise en
  pause ; en pause, la production reprend. Onglet ouvert en partie : deux
  images produites à 4,5 s d'écart. Attente au lancement : 2,0 s au plus
  (2001 à 2027 ms mesurées).
- **Lancement.** `preparerCamps` 167 à 359 ms, `prechauffer` 91 à 230 ms ;
  aucun programme compilé pendant les images qui suivent (compteur
  `renderer.info.programs` inchangé).
- **Changement de qualité au menu** (Moyenne vers Élevée) : 550 ms de
  préchauffage, message affiché pendant ce temps.

Non mesuré : le temps GPU par image après les changements des autres
fichiers (voir leurs comptes rendus) ; la fluidité ressentie sur le portable
du propriétaire (touche F8) ; le coût des vignettes produites en pause sur ce
portable. Pendant les essais, `r3d-scene.js`, en cours de modification par un
autre agent, affichait l'avertissement « U_SOLEIL_SOL is not defined » au
préchauffage : à revérifier une fois ce fichier terminé.
