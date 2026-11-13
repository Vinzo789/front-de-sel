'use strict';
/* =====================================================================
   FRONT DE SEL — registre des campagnes et des missions.
   Ce fichier est chargé avant les fichiers de mission (campagnes/<id>.js),
   qui appellent tous enregistrerMission({...}). Le moteur (jeu.js) lit
   ensuite CAMPAGNES et MISSIONS.

   Le moteur applique le contrat des missions (objectifs, conditions,
   actions) dans jeu.js, section 12 ; campagnes/test.js en exerce chaque
   élément (front-de-sel.html?mission=test). Rappels utiles aux auteurs :
   - Objectif « construire » : le type de bâtiment va dans « batiment »
     (« type » vaut déjà 'construire').
   - Tout élément mal écrit est ignoré avec un avertissement en console
     « [Mission <id>] ... » : vérifier la console après chaque modification.
   - Une fin automatique (victoire) attend la fin des séquences d'actions
     qui ajoutent encore des objectifs ou décident de la fin.
   - Fin de mission (victoire ou défaite, automatique ou par action) :
     l'issue est acquise immédiatement — aucune défaite ou victoire
     ultérieure ne la renverse et les objectifs sont figés. Le jeu continue
     au moins 2,5 s, puis jusqu'à ce que la file radio soit vide et le
     dernier message lu, avant le débriefing.
   - Séquences « de fin » : celle qui contient l'action victoire / defaite
     qui a déclaré la fin (formes « radio, victoire » et « attendre, radio,
     victoire ») ; pour une fin automatique, celles lancées depuis que la
     condition de fin est devenue vraie (le déclencheur { objectif: X,
     etat: 'reussi' } du dernier objectif). À la fin, toutes les AUTRES
     séquences en cours sont arrêtées (plus de renforts, d'objectifs ni de
     radio hors sujet), sauf celles qui contiennent encore une action de
     la même issue (victoire pour une victoire, defaite pour une défaite).
   - Purge radio à la fin : les messages en file qui ne viennent pas d'une
     séquence de fin (consignes devenues hors sujet) sont retirés. Sont
     « répliques finales » ceux des séquences de fin et tous ceux ajoutés
     après la fin. Le message affiché, s'il n'est pas une réplique finale,
     est coupé au plus 2 s après la fin. Le débriefing vient au plus 12 s
     après le plus tard de ces instants : entrée en file de la dernière
     réplique finale (ou la fin s'il n'y en a pas), coupure du message en
     cours ; et jamais plus de 25 s après la fin. La forme « radio,
     attendre, victoire » reste valable (la réplique est déjà affichée).
     Un « attendre » avant la réplique finale n'est plus nécessaire pour
     laisser passer les consignes en file : elles sont purgées.
   - Les unités portant une étiquette (nom) ne sont jamais enrôlées dans
     les vagues automatiques de l'IA ni dans sa défense automatique de
     base : elles obéissent au script (actions attaque / deplacer). Sans
     ordre, elles ripostent si on les attaque, comme toute unité au repos.
   - Défense automatique de l'IA de mission (unités non étiquetées et hors
     vague seulement) : défense proportionnée. Une unité armée du joueur
     menace à moins de 550 px d'un bâtiment de l'IA ; un ouvrier ou une
     unité sans arme seulement à moins de 250 px. Les intrus voisins
     (moins de 220 px l'un de l'autre) forment une menace, dont la force
     est la somme de leurs coûts (moitié pour une unité sans arme). De la
     plus forte à la plus faible, chaque menace reçoit des défenseurs
     jusqu'à 1,5 fois sa force (les plus proches d'abord, à moins
     d'environ 700 px du bâtiment menacé, pouvant atteindre l'intrus sans
     rompre la laisse) ; les suivants vont à la menace suivante, les
     autres restent en place. La répartition est refaite en continu : un
     défenseur change de menace si une menace plus forte en a besoin ou si
     une autre est nettement plus proche de son poste. Les défenseurs d'une
     menace engagent ensemble son intrus de tête. Chacun garde comme poste
     sa position d'enrôlement et ne poursuit pas au-delà d'environ 700 px
     de ce poste (laisse). Quand il n'a plus de menace à engager, ou que la
     laisse est rompue, il revient au poste en attaque-déplacement : il ne
     riposte qu'à sa portée réelle, sans reprendre de poursuite. La laisse
     est levée à l'arrivée (ordre de retour terminé, au plus près si le
     poste est devenu inaccessible) ; si l'unité est encore en route 25 s
     après le début du retour, elle reçoit un ordre « aller » final vers le
     point libre le plus proche de son poste, et la laisse est levée à son
     arrivée.
   - L'IA évite de construire sur ses unités et sur les postes de ses
     défenseurs, en décalant le bâtiment d'au plus 3 cases ; faute de
     place, elle construit quand même au meilleur emplacement.
   - Unité au repos (sans ordre, joueur comme IA) : elle riposte et
     poursuit jusqu'à environ 250 px de son point de repos, puis y revient ;
     elle n'attaque d'elle-même un bâtiment qu'à sa portée réelle. Les
     ordres (attaque, attaque-déplacement, deplacer) ne sont pas limités.
     Les défenseurs non étiquetés de l'IA de mission ne poursuivent pas
     au-delà d'environ 700 px de leur poste (unités des vagues exceptées,
     voir « Défense automatique » ci-dessus).
   - Condition { pvSous: { nom, ratio } } (ratio 0,5 par défaut) : VRAIE
     DÈS QU'UNE SEULE entité du groupe passe sous le ratio de ses PV max,
     ou dès qu'une entité du groupe est détruite. Pour un groupe, c'est
     donc « le premier touché ». Option facultative :
       { pvSous: { nom: 'convoi', ratio: 0.5, ensemble: true } }
     compare alors la somme des PV du groupe à la somme de leurs PV max
     (une entité détruite compte pour 0 PV) : « le groupe a perdu la
     moitié de ses PV au total ».
   - Action { pouvoir: { camp, cle, x, y } } : sans effet (et signalée en
     console) si le pouvoir ne peut pas agir, par exemple « renforts »
     quand le camp n'a plus aucun bâtiment.
   - Économie (novembre 2026) : les ressources de la carte (« noeuds »)
     sont des champs de minerai, récoltés par les collecteurs (type
     'collecteur', produit au QG, toujours autorisé, même absent de
     « autorises »). Les ouvriers ne récoltent plus : ils construisent et
     réparent. Au lancement, tout camp J ou I qui a un QG reçoit deux
     collecteurs près de lui s'il reste du minerai sur la carte ; de même
     quand une action « batiment » pose le premier QG d'un camp. Ils
     partent seuls vers le champ le plus proche et font la navette avec le
     dépôt ou le QG le plus proche. L'objectif « recolter » compte ce que
     les collecteurs du joueur déchargent. L'IA qui construit rachète ses
     collecteurs (2 en facile, 3 sinon) et garde au plus 4 ouvriers.
   - Camps (novembre 2026) : l'escarmouche oppose de 2 à 4 camps (J, I, K,
     L) répartis en équipes. Les missions n'en sont pas touchées : elles
     restent J (le joueur) contre I (l'ordinateur), N neutre ; les camps
     K et L, les équipes et les couleurs de camp n'y existent pas, et un
     camp absent de CAMPS_VALIDES (J, I, N) reste refusé dans « depart ».
   - Infanterie spécialisée (javelot, traqueur pour Halden ; grenadier,
     guetteur pour Karsk) : réservée à l'escarmouche, comme l'aéroport et
     les avions. Une mission l'ouvre en la nommant dans « autorises » ou
     par une action « deverrouiller ».
   - Un objectif « cache: true » n'est ni affiché ni évalué tant qu'une
     action { objectif: { ajouter: { id: <même id> } } } ne l'a pas révélé.
   - Une action { ia: { vagues: {...} } } compte « premiere » à partir du
     moment où l'action s'exécute.
   ===================================================================== */

var CAMPAGNES = {
  halden: {
    id: 'halden',
    nom: 'Le contrat de Varenne',
    faction: 'halden',
    intro: 'Le gouvernement de Varenne, ruiné, a confié la sécurité de son eau au Groupe Halden. ' +
           'Le contrat est clair : tenir la côte. Le prix, lui, ne figure nulle part.',
  },
  karsk: {
    id: 'karsk',
    nom: 'La marche du Nord',
    faction: 'karsk',
    intro: 'Le Nord a soif. La République de Karsk a demandé, puis exigé. ' +
           'Le colonel Brannik a reçu l’ordre de prendre ce qu’on ne voulait pas partager.',
  },
};

// Nombre de missions prévues par campagne (une mission absente apparaît « indisponible »).
var MISSIONS_PAR_CAMPAGNE = 4;

var MISSIONS = {};

// Enregistre une mission. Tolérant : une mission incomplète est signalée en
// console mais enregistrée quand même si elle a un identifiant.
function enregistrerMission(m){
  try {
    if(!m || typeof m !== 'object'){ console.warn('[Missions] enregistrerMission : objet attendu.', m); return; }
    if(!m.id || typeof m.id !== 'string'){ console.warn('[Missions] mission sans identifiant (id) : ignorée.', m); return; }
    const manque = [];
    for(const champ of ['campagne', 'numero', 'titre', 'carte', 'joueur', 'adversaire', 'objectifs']) if(m[champ] == null) manque.push(champ);
    if(manque.length) console.warn('[Mission ' + m.id + '] champs manquants : ' + manque.join(', ') + '.');
    if(m.campagne && !CAMPAGNES[m.campagne] && m.campagne !== 'test') console.warn('[Mission ' + m.id + '] campagne inconnue : « ' + m.campagne + ' ».');
    if(MISSIONS[m.id]) console.warn('[Mission ' + m.id + '] enregistrée deux fois : la seconde remplace la première.');
    MISSIONS[m.id] = m;
  } catch(err){
    console.warn('[Missions] erreur à l’enregistrement :', err);
  }
}

// Missions d'une campagne, triées par numéro.
function missionsDeCampagne(idCampagne){
  return Object.values(MISSIONS).filter(m => m.campagne === idCampagne).sort((a, b) => (a.numero || 0) - (b.numero || 0));
}
