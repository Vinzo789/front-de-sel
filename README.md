# Ordre and Command : IA RISE

(Nom du jeu depuis le 20 novembre 2026 ; il s'appelait « Front de Sel », nom que gardent
l'adresse de la page, le dépôt et les fichiers.)

Jeu de stratégie en temps réel en 3D, jouable dans le navigateur, sans
installation. Univers original : en 2034, sur la côte de Varenne, le Groupe
Halden et la République de Karsk se disputent les usines de dessalement.

C'est un prototype de loisir.

## Jouer

Ouvrir la page du jeu (`index.html`). Une connexion Internet est nécessaire :
la bibliothèque 3D three.js est chargée au démarrage.

- Deux campagnes de quatre missions.
- Escarmouche contre un à trois ordinateurs, sur cinq cartes, avec des équipes
  libres et quatre niveaux de difficulté.
- Réglages de l'escarmouche : réserves de départ (de 0 à 2 500) et charge des
  collecteurs (50 ou 100 par voyage).
- Mode « Surprises », à cocher sur l'écran de l'escarmouche.
- « Galeries de tir », à cocher sur le même écran (et, en ligne, par l'hôte
  dans le salon) : un abri enterré d'où sortent des lanceurs de
  missiles. Fermé, il est intouchable ; on ne peut le détruire que pendant les
  17,5 secondes où il tire. Pour s'en défendre : la Batterie Parasol et ses
  radars de veille, qui tentent d'abattre les missiles en vol. La galerie peut
  aussi fabriquer un missile lourd, plus cher et plus lent, qui vole en haute
  altitude : seule la Batterie Zénith peut l'arrêter (15 % de chances sans
  radar, jusqu'à 75 % avec trois).
- Escarmouche en ligne, de 2 à 4 joueurs (voir plus bas).

Le bouton « Commandes », en jeu, donne la liste des touches. La touche F11 du
navigateur passe en plein écran, ce qui rend le défilement à la souris plus
confortable.

## Jouer à plusieurs en ligne

Un joueur héberge la partie, les autres le rejoignent. Rien à installer, aucun
compte : seul un pseudonyme est demandé.

- **Héberger** : « Escarmouche », choisir la carte, puis « Héberger une
  partie » et « Ouvrir le salon ». Un code de 6 signes s'affiche, avec un lien
  d'invitation à envoyer aux amis. Quand tout le monde est prêt, « Lancer la
  partie ». L'onglet de l'hôte doit rester ouvert jusqu'à la fin : c'est lui
  qui fait tourner la partie.
- **Rejoindre** : ouvrir le lien reçu, ou « Escarmouche », « Rejoindre une
  partie », et taper le code. Choisir son camp, puis « Je suis prêt ».

À savoir :

- La partie passe par un serveur de messages public et gratuit, sans garantie
  de disponibilité.
- Les messages sont signés (personne ne peut les falsifier sans le code du
  salon) mais pas chiffrés : ne mettez aucune donnée personnelle dans le
  pseudonyme, et ne donnez le code qu'à des personnes de confiance.
- Un joueur qui ferme son onglet par erreur, ou dont la connexion tombe, retrouve
  sa place s'il revient en moins de 2 minutes (en rouvrant le lien dans le même
  navigateur) ; ensuite, l'ordinateur prend son camp. Si l'hôte part, la partie
  s'arrête pour tous.
- Les galeries de tir et la défense antimissile se jouent en ligne si l'hôte
  coche « Galeries de tir » dans le salon, avant de lancer la partie.
- L'hôte peut changer la difficulté des ordinateurs en cours de partie (liste
  à côté du bouton Pause) ; tous les joueurs en sont prévenus.
- Les campagnes et le mode « Surprises » restent en solo.

Le détail, les limites connues et ce qui a été vérifié sont dans
`NOTES-CONCEPTION.md`, section « Multijoueur ».

## Pour aller plus loin

`NOTES-CONCEPTION.md` décrit l'organisation des fichiers, le contenu du jeu,
les outils de test et les limites connues.
