# Front de Sel — peut-on rendre l'image plus réaliste ?

Réponse courte : **oui, il reste de la marge**, surtout sur la lumière, le sol
et l'atmosphère. Ce dossier montre des essais, rien de plus : **aucun fichier
du jeu n'a été modifié**. Les effets ont été ajoutés à la main dans une page
ouverte pour l'occasion, puis la page a été refermée.

Essais du 13 novembre 2026, carte Port-Calmes (celle de l'escarmouche), scène
de démonstration (`?demo`), qualité Élevée.

## Comment lire les images

Chaque paire montre exactement le même instant et le même cadrage :

- **avant** : le jeu tel qu'il est aujourd'hui en qualité Élevée ;
- **après** : la même image avec les essais activés.

Les images font 1280 × 720. Elles montrent l'image du jeu **sans les panneaux
de l'interface** (barre du haut, panneau du bas, minicarte) : seuls les
anneaux de sélection et les barres de vie sont conservés. Aucune retouche
après coup : ce sont les images calculées par la page.

## Les quatre paires

### 1. Combat rapproché
`01-combat-avant.jpg` → `01-combat-apres.jpg`

Ce qui change : soleil plus franc et ciel moins présent (ombres plus
marquées), ombres de contact renforcées sous les véhicules et les rochers,
sol plus détaillé (grain, cailloux, petites rides, grandes plages de teinte),
touffes d'herbe sèche, couleurs moins « jaune vif » et plus photographiques,
léger grain d'image.

### 2. Base avec aéroport
`02-base-aeroport-avant.jpg` → `02-base-aeroport-apres.jpg`
et, en plus, `02-base-aeroport-apres-camera-basse.jpg`

La deuxième image reprend les essais de la paire 1, avec un flou de
profondeur très léger en haut et en bas de l'image. La troisième montre la
même base avec une **caméra plus basse** et une brume de distance : c'est un
autre cadrage, donc pas une vraie paire, mais c'est l'essai le plus parlant.

### 3. Vue large de la carte
`03-vue-large-avant.jpg` → `03-vue-large-apres.jpg`

Ce qui change : ombres de nuages qui glissent sur le terrain, lumière plus
contrastée, végétation, couleurs retravaillées. Vu d'aussi haut, le gain est
plus discret que de près.

### 4. Vaisseau des envahisseurs
`04-vaisseau-avant.jpg` → `04-vaisseau-apres.jpg`
et, en plus, `04-vaisseau-apres-camera-basse.jpg`

Mêmes essais. La troisième image, caméra basse avec horizon, brume et flou
de profondeur, donne l'impression la plus « cinéma ».

## Ce que ces essais ne disent pas

- **La fluidité n'a pas été mesurée de façon fiable.** Les chronométrages
  faits pendant les essais variaient du simple au triple d'une fois à l'autre
  (un autre travail utilisait la carte graphique en même temps). Aucun chiffre
  n'est donc avancé. À mesurer sur le portable avant toute décision ferme.
- Les touffes d'herbe de l'essai sont posées sur toute la carte sans aucune
  économie (26 000 touffes, environ 300 000 triangles de plus). Une vraie
  version n'en afficherait qu'autour de la caméra.
- La caméra basse est une vue « photo » : on y joue mal (on voit moins de
  terrain, les unités se cachent les unes les autres). Elle conviendrait à une
  touche de rotation libre ou aux cinématiques, pas comme vue par défaut.
- Les unités, les bâtiments et les rochers n'ont pas été touchés : ils gardent
  leurs formes simples à facettes. C'est aujourd'hui ce qui limite le plus le
  réalisme, et cela ne se montre pas sans un vrai travail de modélisation.

## Ce qui n'a pas pu être illustré sans le développer vraiment

Modèles plus détaillés (véhicules, bâtiments, rochers lissés), fantassins
animés par squelette, textures photographiques, usure et saleté sur les
véhicules, eau avec reflets réels, ombres à bords doux, poussière soulevée
par les chenilles, traces de pneus qui restent au sol.

## Ce qui restera hors de portée dans un navigateur

Le rendu des grands jeux récents : lancer de rayons, éclairage indirect
calculé en direct, végétation dense animée par le vent sur toute la carte,
milliers d'objets très détaillés, destruction physique des bâtiments. Sur un
portable à carte graphique intégrée, il faut viser « belle maquette
crédible », pas « photo ».

## Décision attendue

Rien n'est lancé. Les pistes sont indépendantes : on peut en retenir une,
plusieurs ou aucune. Chacune resterait réservée à la qualité Élevée (ou
réglable), pour que les qualités Moyenne et Basse gardent leur fluidité
actuelle.
