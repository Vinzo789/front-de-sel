/* =====================================================================================
   reseau.js — couche réseau du multijoueur de Front de Sel (protocole 2 : messages signés)

   Autonome : ne dépend ni de jeu.js ni de three.js. Expose le global window.Reseau.
   Référence de l'interface : travaux/multijoueur/INTERFACE-RESEAU.md.
   Conception : travaux/multijoueur/ESSAIS-MQTT.md (§ 3) et INVENTAIRE-MOTEUR.md.

   Modèle : l'hôte fait autorité (lui seul simule) ; les invités reçoivent des instantanés
   binaires, envoient des ordres que l'hôte vérifie, et reçoivent des événements fiables.

   AVERTISSEMENT — sécurité : les serveurs MQTT publics sont ouverts à tous. Les messages sont SIGNÉS
   (section 2 ter : clé de salon tirée du code, clé de siège par ECDH) mais PAS CHIFFRÉS : quiconque écoute
   le serveur lit les pseudonymes et l'état de la partie. Sans le code, un inconnu ne peut plus rien changer
   (ses messages sont jetés) ; il peut encore inonder les sujets ou republier tels quels des messages conservés
   déjà vus (gêne passagère). Un joueur invité, qui a le code, peut forger les diffusions de l'hôte (affichage
   des autres invités), pas les ordres d'un autre siège. Le code de 6 signes se retrouve par force brute hors
   ligne avec du matériel dédié. L'hôte fait autorité : rien n'empêche un hôte de tricher. Limites L1 à L6 :
   travaux/multijoueur/INTERFACE-RESEAU.md § 4.4. Aucune donnée personnelle ne doit transiter : seulement
   un pseudonyme libre de 16 caractères au plus.
   Ce que reseau.js garantit malgré tout (14 novembre 2026) : tout message reçu est contrôlé avant
   d'être gardé ou émis vers le jeu (§ 2 bis) ; un message invalide est ignoré et compté, sans
   exception ni texte du réseau dans un message d'erreur ; un seul message forgé ne peut ni figer
   un invité, ni lui faire sauter les vrais événements, ni libérer un siège, ni tenir un absent
   pour présent. Les chaînes de données du jeu (textes, couleurs…) restent à échapper par jeu.js.
   ===================================================================================== */
(function(global){
'use strict';

// -------------------------------------------------------------------------------------
// 1. Réglages
// -------------------------------------------------------------------------------------
const PROTO = 2;   // 2 : messages signés (14 novembre 2026, troisième tour) ; incompatible avec le protocole 1 (autres sujets)

// Serveurs connus. La chaîne par défaut est HiveMQ puis Mosquitto (décision du propriétaire).
// EMQX reste disponible par sa clé 'e' (plafond observé d'environ 10 messages/s par client).
const SERVEURS_MQTT = [
  {cle:'h', nom:'HiveMQ',    url:'wss://broker.hivemq.com:8884/mqtt', cadenceMax:10},
  {cle:'m', nom:'Mosquitto', url:'wss://test.mosquitto.org:8081',     cadenceMax:10},
  {cle:'e', nom:'EMQX',      url:'wss://broker.emqx.io:8084/mqtt',    cadenceMax:8},
];
const CHAINE_DEFAUT = ['h', 'm'];

const BIBLIOTHEQUE = {
  url:'https://cdnjs.cloudflare.com/ajax/libs/mqtt/5.15.2/mqtt.min.js',
  integrite:'sha512-3kmSDJDp+Sk6XIt2AAkhFUrdlBwtWf6eFuksz407qMKcV/d1xfvsF/o4glnPWX/P3/X4yQJ2EBHEBTaWoXGf1g==',
};

// Alphabet sans ambiguïté des codes de salon (ni 0/O, 1/I/L, 2/Z, 5/S, 8/B) : 25 signes.
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
// Identifiants d'onglet : 32 signes (tirage sans biais sur un octet).
const ALNUM = 'abcdefghijkmnpqrstuvwxyz23456789';
const ID_RE = /^[a-z0-9]{8}$/;

const REGLAGES = {
  keepalive:10,              // s (MQTT) : coupure franche détectée par le serveur en 15 s
  reconnexionMs:1000,        // attente entre deux tentatives de reconnexion
  delaiConnexionMs:8000,     // au-delà, on essaie le serveur suivant
  battementMs:1000,          // battement de cœur (invité → hôte et hôte → invités)
  silenceInjoignableMs:5000, // invité muet depuis 5 s → « injoignable »
  // Invité parti depuis 120 s → camp confié à l'ordinateur (60 s avant le 16 novembre 2026, décision du propriétaire :
  // sur un PC lent, le chargement de la page mangeait presque tout le délai). L'invité dont la connexion tombe en
  // partie attend le même délai avant de renoncer (_surveiller de l'invité).
  delaiConfieMs:120000,
  hoteInjoignableMs:3000,    // rien reçu de l'hôte depuis 3 s → bandeau « hôte injoignable »
  graceHoteMs:10000,         // après le message de dernière volonté de l'hôte : 10 s pour revenir
  hoteAbandonMs:60000,       // hôte muet (ou hôte déconnecté) depuis 60 s → fin de partie ; invité coupé dans le salon : 60 s aussi
  reponseHoteMs:15000,       // invité qui vient de se reconnecter : l'hôte a au moins 15 s pour se manifester avant « injoignable »
  periodeCompletMs:2000,     // instantané complet toutes les 2 s
  memoireEvenements:200,     // événements gardés par l'hôte pour le rattrapage
  ordresParSeconde:20,       // par siège (seau de 20 jetons, rempli à 20 par seconde)
  idsParOrdre:200,
  tailleOrdreMax:4096, tailleCtlMax:1024, taillePresMax:512, tailleDescriptionMax:8192,
  tailleEvenementMax:65536, tailleInstantaneMax:262144,
  delaiSalonMs:6000,         // délai pour trouver la description du salon (« code inconnu »)
  delaiAccueilMs:8000,       // délai de réponse de l'hôte à une arrivée
  pseudoMax:16,
  // Grande carte en ligne (26 novembre 2026, décision du propriétaire) : 8 sièges et 8 équipes au plus, dont 4 humains
  // au plus (l'hôte et trois invités) ; un siège humain a toujours un indice inférieur à humainsMax (les sièges 4 à 7
  // sont des ordinateurs ou des places fermées). Ce sont les bornes de la FORME des messages ; jeu.js borne en plus
  // chaque carte (4 sièges et 4 équipes sur les cartes de 80 × 56, comme avant).
  equipesMax:8,
  siegesMax:8,
  humainsMax:4,
  // (20 novembre 2026, galeries de tir et défense antimissile en ligne : fabMissile, tirGalerie, fabMunition, repInter.)
  // (22 novembre 2026, lot B de la défense antimissile : fabLourd, commande d'un missile lourd.)
  // (26 novembre 2026, grande carte en ligne : capturer, capture d'un extracteur par des ouvriers.)
  typesOrdres:['aller', 'droit', 'attaqueDep', 'arreter', 'rally', 'batir', 'produire', 'retirer', 'pouvoir', 'fabMissile', 'tirGalerie', 'fabMunition', 'repInter', 'fabLourd', 'capturer'],
  // --- Défense contre les messages forgés (serveur public : n'importe qui peut publier) ---
  tailleRattrapageMax:262144,  // réponse de rattrapage (jusqu'à 200 événements)
  confirmationWillMs:2500,     // « parti » sans preuve (dernière volonté) : confirmé si aucun battement valable pendant ce délai
  arriveesParSeconde:5,        // hôte : arrivées traitées par seconde (seau de 5) ; au-delà, ignorées sans réponse
  vusMax:256,                  // hôte : identifiants d'onglet retenus (les plus anciens oubliés au-delà)
  instantanesParSecondeMax:30, // invité : avance maximale du numéro d'instantané (20/s + marge), plus 10
  margeTemps:1.5, margeTempsS:3, // invité : temps de jeu d'un instantané ≤ dernier + 1,5 × temps réel écoulé + 3 s
  resynchroMs:3000,            // invité : rejets continus pendant 3 s sans instantané appliqué → le complet suivant est accepté
  evenementsParSecondeMax:50,  // invité : numéro d'événement ≤ dernier rendu + 200 (mémoire) + 50 × secondes écoulées
  margeRattrapage:50,          // invité : événement en attente plus loin que le dernier annoncé par l'hôte + 50 → jeté
  dureeMemoireMs:3*3600e3,     // invité : identifiant et jeton mémorisés (localStorage) 3 heures au plus
  rafraichirMemoireMs:600e3,   // invité : date de la mémoire rafraîchie toutes les 10 minutes en partie
  // --- Ajouts du 14 novembre 2026 (second tour de correction) ---
  confirmationFinMs:3000,      // invité : fin annoncée par le réseau confirmée si l'hôte se tait pendant ce délai
  margeSigneVieMs:800,         // invité : signe de vie de l'hôte plus de 0,8 s après l'annonce → annonce fausse, ignorée
  compteursRetenus:16,         // hôte : compteurs de battements et de présences retenus par siège (refus du rejeu)
  recalageMs:1000,             // hôte : au plus un recalage des numéros d'ordre par siège et par seconde
  // Numéros d'ordre et de ctl (troisième tour) : une seule borne, partagée par l'hôte et l'invité, mesurée sur
  // l'horloge de l'INVITÉ (jamais sur celle de l'hôte, qui peut différer de plusieurs minutes). L'hôte refuse sans le
  // retenir un numéro en avance de plus de 12 h sur le compteur d'enveloppe du même message (= horloge de
  // l'invité) ; l'invité accepte tout recalage jusqu'à son propre compteur + 12 h, donc tout ce que l'hôte a pu retenir.
  recalageMaxMs:432e5,
  // --- Signature (protocole 2, troisième tour du 14 novembre 2026) ---
  sujetsRetenus:512,           // compteurs d'enveloppe retenus par famille de clés (les plus anciens oubliés)
  // hôte : clés de siège gardées après le départ d'un invité (son retour, ou lui répondre « refus »). Sixième tour
  // (15 novembre 2026) : jamais oubliées tant que le salon vit (un détenteur du code vidait les 32 places par des
  // entrées et sorties, puis prenait l'identifiant d'un invité parti). Table pleine : les nouveaux venus sont refusés.
  anciennesClesMax:4096,
  // --- Cinquième tour (14 novembre 2026) ---
  // Invité : avance admise du compteur d'un message de l'hôte scellé avec la clé de salon sur l'horloge de l'hôte
  // projetée (accueil, recalée par chaque message à la clé de siège, au moins un par seconde : réponses aux battements).
  avanceCompteurMaxMs:10000,
};

// Motifs reçus de l'hôte et acceptés tels quels (tout autre motif rend le message invalide, ou devient 'refuse').
const MOTIFS_REFUS = ['plein', 'version', 'commencee', 'expulse', 'confie', 'ferme', 'sansSiege'];
const MOTIFS_REPONSE = ['siegeOccupe', 'siegeInconnu', 'equipeInvalide', 'factionInvalide', 'commencee', 'demandeInconnue', 'refuse'];
const DEMANDES = ['pret', 'siege', 'equipe', 'faction'];
// Refus après lesquels la mémoire du siège (localStorage) est effacée : y revenir ne servirait à rien.
const REFUS_DEFINITIFS = ['plein', 'version', 'commencee', 'expulse', 'confie', 'ferme', 'inconnu', 'sansSiege'];

const MESSAGES = {
  plein:'Le salon est complet.',
  version:'Votre version du jeu diffère de celle de l’hôte : rechargez la page (Ctrl+F5).',
  commencee:'La partie a déjà commencé.',
  inconnu:'Aucun salon ne répond à ce code.',
  ferme:'Ce salon est fermé.',
  expulse:'L’hôte vous a retiré du salon.',
  confie:'Votre camp a été confié à l’ordinateur (absence de plus de 2 minutes).',
  sansReponse:'L’hôte ne répond pas.',
  serveur:'Aucun serveur n’est joignable.',
  code:'Code de salon invalide.',
  bibliotheque:'Impossible de charger la bibliothèque réseau.',
  hoteParti:'L’hôte a quitté la partie.',
  hoteInjoignable:'L’hôte est injoignable depuis trop longtemps.',
  coupure:'La connexion au serveur est perdue depuis trop longtemps.',
  fin:'La partie est terminée.',
  quitte:'Vous avez quitté la partie.',
  refus:'L’hôte a refusé l’arrivée.',
  config:'Réglage réseau invalide.',
  // Troisième tour (14 novembre 2026)
  sansSiege:'Vous n’avez plus de place dans ce salon : rejoignez-le de nouveau.',
  connexionPerdue:'Votre connexion au serveur est coupée depuis plus de deux minutes : la partie continue sans vous et votre camp passe à l’ordinateur.',
  connexionPerdueSalon:'Votre connexion au serveur est coupée depuis plus d’une minute : votre place dans le salon a été libérée.',
  crypto:'Ce navigateur ne fournit pas les fonctions cryptographiques nécessaires (la page doit être ouverte en https).',
  // Quatrième tour (14 novembre 2026)
  retourNonConfirme:'L’hôte n’a pas confirmé votre retour : réessayez dans un instant (votre place reste mémorisée).',
};

// Étapes de connexion annoncées par options.etape({etape, serveur, essai, texte}) : texte local, jamais du réseau.
const ETAPES = {
  bibliotheque:() => 'Chargement de la bibliothèque réseau…',
  connexion:n => 'Connexion au serveur ' + n + '…',
  nouvelleTentative:n => 'Nouvelle tentative de connexion à ' + n + '…',
  secours:n => 'Serveur de secours : ' + n + '…',
  recherche:n => 'Recherche du salon sur ' + n + '…',
  accueil:() => 'Salon trouvé : en attente de la réponse de l’hôte…',
  salon:() => 'Ouverture du salon…',
};
function signaleur(fn){
  return d => {
    if(typeof fn !== 'function') return;
    try{ fn(Object.assign({texte:ETAPES[d.etape] ? ETAPES[d.etape](d.serveur || '') : ''}, d)); }catch(e){ console.error('[Reseau] rappel etape :', e); }
  };
}

const ENC = new TextEncoder(), DEC = new TextDecoder();
const maintenant = () => performance.now();

function erreurReseau(motif, message, details){
  const e = new Error(message || MESSAGES[motif] || motif);
  e.motif = motif; if(details) e.details = details;
  return e;
}

// -------------------------------------------------------------------------------------
// 2. Petits outils : diffusion d'événements, journal, compteurs, minuteur, hasard
// -------------------------------------------------------------------------------------
class Diffuseur {
  constructor(){ this._ec = Object.create(null); }
  on(nom, fn){ (this._ec[nom] || (this._ec[nom] = [])).push(fn); return this; }
  off(nom, fn){ const l = this._ec[nom]; if(l){ const i = l.indexOf(fn); if(i >= 0) l.splice(i, 1); } return this; }
  _emettre(nom, d){
    const l = this._ec[nom]; if(!l) return;
    for(const fn of l.slice()){ try{ fn(d); }catch(e){ console.error('[Reseau] écouteur « ' + nom + ' » :', e); } }
  }
}

let journalActif = false;
const lignesJournal = [];
function journal(...p){
  if(!journalActif) return;
  const l = (maintenant()/1000).toFixed(3) + ' ' + p.map(x => typeof x === 'string' ? x : (x instanceof Error ? x.message : JSON.stringify(x))).join(' ');
  lignesJournal.push(l); if(lignesJournal.length > 500) lignesJournal.shift();
  console.log('[Reseau] ' + l);
}

// Compteurs de débit : totaux, et moyenne glissante sur les 5 dernières secondes.
const tousLesCompteurs = new Set();
class Compteur {
  constructor(){ this.envoi = {octets:0, messages:0}; this.reception = {octets:0, messages:0}; this._f = []; this.t0 = maintenant(); tousLesCompteurs.add(this); }
  noter(sens, n){
    const c = this[sens]; c.octets += n; c.messages++;
    const t = maintenant(); this._f.push(t, sens === 'envoi' ? 1 : 0, n); this._purger(t);
  }
  _purger(t){ let i = 0; while(i < this._f.length && t - this._f[i] > 5000) i += 3; if(i) this._f.splice(0, i); }
  lire(){
    const t = maintenant(); this._purger(t);
    const d = Math.min(5, Math.max(0.001, (t - this.t0)/1000));
    let eo = 0, em = 0, ro = 0, rm = 0;
    for(let i = 0; i < this._f.length; i += 3){ if(this._f[i+1]){ eo += this._f[i+2]; em++; } else { ro += this._f[i+2]; rm++; } }
    return {
      envoi:{octetsParS:eo/d, messagesParS:em/d, octets:this.envoi.octets, messages:this.envoi.messages},
      reception:{octetsParS:ro/d, messagesParS:rm/d, octets:this.reception.octets, messages:this.reception.messages},
    };
  }
}
function debitGlobal(){
  const r = {envoi:{octetsParS:0, messagesParS:0, octets:0, messages:0}, reception:{octetsParS:0, messagesParS:0, octets:0, messages:0}};
  for(const c of tousLesCompteurs){ const l = c.lire(); for(const s of ['envoi', 'reception']) for(const k in r[s]) r[s][k] += l[s][k]; }
  return r;
}

// Minuteur porté par un Worker : un onglet en arrière-plan bride setInterval, pas un Worker.
let travailleur = null; const rappels = new Map(); let numMinuteur = 0;
function minuteur(periodeMs, fn){
  const id = ++numMinuteur;
  const sur = () => { try{ fn(); }catch(e){ console.error('[Reseau] minuteur :', e); } };
  if(travailleur === null){
    try{
      travailleur = new Worker(URL.createObjectURL(new Blob([
        'const t={};onmessage=e=>{const d=e.data;clearInterval(t[d.id]);delete t[d.id];if(d.p>0)t[d.id]=setInterval(()=>postMessage(d.id),d.p);};'
      ], {type:'text/javascript'})));
      travailleur.onmessage = e => { const f = rappels.get(e.data); if(f) f(); };
    }catch(e){ travailleur = false; }
  }
  if(travailleur){
    rappels.set(id, sur); travailleur.postMessage({id, p:periodeMs});
    return () => { if(rappels.delete(id)) travailleur.postMessage({id, p:0}); };
  }
  const h = setInterval(sur, periodeMs);
  return () => clearInterval(h);
}

function tirer(n, alphabet){
  const lim = 256 - (256 % alphabet.length), r = [];
  while(r.length < n){
    const b = new Uint8Array(n * 2); crypto.getRandomValues(b);
    for(const x of b) if(x < lim && r.length < n) r.push(alphabet[x % alphabet.length]);
  }
  return r.join('');
}
const hex = buf => Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, '0')).join('');
function nouvelId(){ return tirer(8, ALNUM); }
function nouveauJeton(){ const b = new Uint8Array(16); crypto.getRandomValues(b); return hex(b); }

function lireJson(octets){ try{ return JSON.parse(DEC.decode(octets)); }catch(e){ return undefined; } }
// Construite à partir des codes (aucun caractère invisible dans ce fichier source) : contrôles C0 et C1, trait
// d'union conditionnel, marque arabe, largeur nulle et marques de sens (200B-200F), séparateurs de ligne et
// enchâssements (2028-202E), isolats (2060-2069), indicateur d'ordre (FEFF), et < > & " ' ` \.
const RE_PSEUDO_INTERDIT = (() => {
  const c = n => '\\u' + n.toString(16).padStart(4, '0'), plage = (a, b) => c(a) + '-' + c(b);
  return new RegExp('[' + plage(0, 0x1f) + plage(0x7f, 0x9f) + c(0xad) + c(0x61c) + plage(0x200b, 0x200f) + plage(0x2028, 0x202e)
    + plage(0x2060, 0x2069) + c(0xfeff) + '<>&"\'`\\\\]', 'g');
})();
function nettoyerPseudo(p){
  // Caractères de contrôle, de mise en forme invisibles (sens d'écriture, largeur nulle) et signes HTML retirés.
  return String(p == null ? '' : p).slice(0, 200).replace(RE_PSEUDO_INTERDIT, '')
    .replace(/\s+/g, ' ').trim().slice(0, REGLAGES.pseudoMax);
}

// -------------------------------------------------------------------------------------
// 2 bis. Validation de tout ce qui arrive du réseau (le serveur est public : tout peut être forgé)
//    Chaque fonction rend une copie propre, ou null (message ignoré et compté). Aucune ne lève.
// -------------------------------------------------------------------------------------
const CLES_INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);
const RE_CLE = /^[A-Za-z0-9_]{1,32}$/;
const LIMITES_STRUCTURE = {profondeur:6, noeuds:5000, chaine:1000, tableau:1000, cles:64};
const RE_VERSION = /^[A-Za-z0-9._-]{0,24}$/;
const RE_CARTE = /^[A-Za-z0-9_-]{1,40}$/;
const RE_EMPREINTE = /^[A-Za-z0-9_:.-]{1,80}$/;
const RE_JETON = /^[0-9a-f]{32}$/;
const RE_TYPE_EVT = /^[a-z][A-Za-z0-9]{0,23}$/;
const RE_NOM_LISTE = /^[a-z][a-z0-9]{0,15}$/;
const ETATS_SALON = ['ouvert', 'en-partie', 'ferme'];
const ETATS_PRESENCE = ['la', 'parti', 'injoignable'];
const estObjet = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const entier = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;

// Structure simple bornée : null, booléens, nombres finis, chaînes courtes, tableaux et objets ordinaires
// (profondeur, taille et nombre de clés bornés ; clés __proto__, constructor, prototype refusées).
function simplifier(v){
  const budget = {n:LIMITES_STRUCTURE.noeuds};
  try{ return {ok:true, v:simp(v, 0, budget)}; }catch(e){ return {ok:false}; }
}
function simp(v, prof, b){
  const L = LIMITES_STRUCTURE;
  if(--b.n < 0) throw 0;
  if(v === null || typeof v === 'boolean') return v;
  if(typeof v === 'number'){ if(!Number.isFinite(v)) throw 0; return v; }
  if(typeof v === 'string'){ if(v.length > L.chaine) throw 0; return v; }
  if(typeof v !== 'object' || prof >= L.profondeur) throw 0;
  if(Array.isArray(v)){
    if(v.length > L.tableau) throw 0;
    const r = new Array(v.length); for(let i = 0; i < v.length; i++) r[i] = simp(v[i], prof + 1, b); return r;
  }
  const cles = Object.keys(v); if(cles.length > L.cles) throw 0;
  const r = {};
  for(const k of cles){ if(CLES_INTERDITES.has(k) || !RE_CLE.test(k)) throw 0; r[k] = simp(v[k], prof + 1, b); }
  return r;
}
function campValide(c){ return typeof c === 'string' && (T ? T.idx.camps.has(c) : /^[A-Z]$/.test(c)); }
// Faction, niveau : null, ou nom de la liste fournie (options.factions / options.niveaux), sinon nom court en minuscules.
// Rend undefined si invalide.
function valeurListe(x, liste){
  if(x == null) return null;
  if(typeof x !== 'string') return undefined;
  return (Array.isArray(liste) ? liste.includes(x) : RE_NOM_LISTE.test(x)) ? x : undefined;
}
function validerSiege(e, o, avecEtat){
  if(!estObjet(e)) return null;
  if(!entier(e.index, 0, REGLAGES.siegesMax - 1) || !campValide(e.camp) || !entier(e.equipe, 1, REGLAGES.equipesMax) || !TYPES_SIEGE.includes(e.type)) return null;
  // (26 novembre 2026) Siège humain seulement aux indices 0 à humainsMax − 1 : jamais plus de quatre humains.
  if(e.type === 'humain' && e.index >= REGLAGES.humainsMax) return null;
  const faction = valeurListe(e.faction, o.factions), niveau = valeurListe(e.niveau, o.niveaux);
  if(faction === undefined || niveau === undefined) return null;
  if(e.pseudo != null && typeof e.pseudo !== 'string') return null;
  for(const k of ['hote', 'confie', 'pret', 'occupe']) if(e[k] != null && typeof e[k] !== 'boolean') return null;
  if(e.enLigne != null && typeof e.enLigne !== 'boolean') return null;
  const r = {index:e.index, camp:e.camp, equipe:e.equipe, type:e.type, faction, niveau,
    pseudo:e.pseudo == null ? null : (nettoyerPseudo(e.pseudo) || null), hote:e.hote === true, confie:e.confie === true};
  if(avecEtat){ r.pret = e.pret === true; r.occupe = e.occupe === true; r.enLigne = typeof e.enLigne === 'boolean' ? e.enLigne : null; }
  return r;
}
function validerSieges(l, o, avecEtat){
  if(!Array.isArray(l) || l.length < 1 || l.length > REGLAGES.siegesMax) return null;   // (4 jusqu'au 26 novembre 2026)
  const vus = new Set(), r = [];
  for(const e of l){ const s = validerSiege(e, o, avecEtat); if(!s || vus.has(s.index)) return null; vus.add(s.index); r.push(s); }
  return r;
}
const versionValide = v => v == null ? null : (typeof v === 'string' && RE_VERSION.test(v) ? v : undefined);
function validerDescription(d, o){
  if(!estObjet(d) || !entier(d.proto, 0, 255) || !ETATS_SALON.includes(d.etat)) return null;
  const jeu = versionValide(d.jeu); if(jeu === undefined) return null;
  const base = {proto:d.proto, jeu, carte:null, empreinte:null, etat:d.etat, extra:null, emplacements:[]};
  if(d.etat === 'ferme'){ base.will = d.will === true; return base; }
  if(d.proto !== PROTO) return base;                       // autre protocole : seul le refus de version compte
  // Autre version du jeu (26 novembre 2026) : même chose, AVANT de contrôler le reste. Sans cela, un joueur resté sur
  // une ancienne version voyait « aucun salon ne répond » au lieu de « version différente » dès que le format de la
  // description changeait (salon à huit places). o.versionJeu n'est donné qu'avant l'entrée dans le salon.
  if(o && o.versionJeu != null && jeu !== o.versionJeu) return base;
  if(d.carte != null){ if(typeof d.carte !== 'string' || !RE_CARTE.test(d.carte)) return null; base.carte = d.carte; }
  if(d.empreinte != null){ if(typeof d.empreinte !== 'string' || !RE_EMPREINTE.test(d.empreinte)) return null; base.empreinte = d.empreinte; }
  if(d.extra != null){ const x = simplifier(d.extra); if(!x.ok) return null; base.extra = x.v; }
  base.cle = typeof d.cle === 'string' && RE_CLE_PUB.test(d.cle) ? d.cle : null;   // clé publique ECDH de l'hôte
  // Adresse du serveur de l'hôte (comparée à celle de ma connexion, jamais affichée ni ouverte) ; mal formée : description invalide.
  if(d.srv != null){ if(typeof d.srv !== 'string' || d.srv.length > 300) return null; base.srv = d.srv; } else base.srv = null;
  const empl = validerSieges(d.emplacements, o, true); if(!empl) return null;
  base.emplacements = empl;
  return base;
}
// Données de lancement : structure simple bornée, et `sieges` contrôlés comme ceux de la description.
// Les autres champs (camps, couleurs, carte…) sont des données du jeu : à contrôler par jeu.js.
function validerDebut(x, o){
  const s = simplifier(x); if(!s.ok || !estObjet(s.v)) return null;
  const sieges = validerSieges(s.v.sieges, o, false); if(!sieges) return null;
  s.v.sieges = sieges;
  return s.v;
}
function validerEvenement(x, o){
  if(!estObjet(x) || !Number.isSafeInteger(x.s) || x.s < 1 || typeof x.t !== 'string' || !RE_TYPE_EVT.test(x.t)) return null;
  let m;
  if(x.t === 'debut') m = validerDebut(x, o);
  else { const s = simplifier(x); m = s.ok ? s.v : null; }
  if(!m) return null;
  if(m.t === 'presence' && !(entier(m.siege, 0, 3) && campValide(m.camp) && ETATS_PRESENCE.includes(m.etat))) return null;
  if(m.t === 'campConfie' && !(entier(m.siege, 0, 3) && campValide(m.camp))) return null;
  return m;
}
function validerAccueil(m, o){
  if(!entier(m.siege, 0, 3) || !campValide(m.camp) || !entier(m.equipe, 1, REGLAGES.equipesMax) || typeof m.jeton !== 'string' || !RE_JETON.test(m.jeton)
    || !Number.isSafeInteger(m.dernierEvt) || m.dernierEvt < 0) return null;
  const r = {t:'accueil', siege:m.siege, camp:m.camp, equipe:m.equipe, jeton:m.jeton, dernierEvt:m.dernierEvt, description:null, debut:null, inst:null,
    dernierOrdre:Number.isSafeInteger(m.dernierOrdre) ? m.dernierOrdre : null, dernierCtl:Number.isSafeInteger(m.dernierCtl) ? m.dernierCtl : null,
    cle:typeof m.cle === 'string' && RE_CLE_PUB.test(m.cle) ? m.cle : null};
  if(m.description != null){ r.description = validerDescription(m.description, o); if(!r.description || r.description.proto !== PROTO || r.description.etat === 'ferme') return null; }
  if(m.debut != null){ r.debut = validerDebut(m.debut, o); if(!r.debut) return null; }
  if(m.inst != null){
    if(!estObjet(m.inst) || !entier(m.inst.n, 0, 65535) || typeof m.inst.temps !== 'number' || !(m.inst.temps >= 0 && m.inst.temps < 4294968)) return null;
    r.inst = {n:m.inst.n, temps:m.inst.temps};
  }
  return r;
}
function validerRefus(m){
  if(!MOTIFS_REFUS.includes(m.motif)) return null;
  const jeu = versionValide(m.jeu);
  return {t:'refus', motif:m.motif, jeu:jeu === undefined ? null : jeu};
}
function validerReponse(m){
  if(!DEMANDES.includes(m.d) || !Number.isSafeInteger(m.ref) || typeof m.accepte !== 'boolean') return null;
  if(!entier(m.siege, 0, 3) || !campValide(m.camp) || !entier(m.equipe, 1, REGLAGES.equipesMax)) return null;
  const motif = m.motif == null ? null : (MOTIFS_REPONSE.includes(m.motif) ? m.motif : 'refuse');
  return {t:'reponse', d:m.d, ref:m.ref, accepte:m.accepte, motif, siege:m.siege, camp:m.camp, equipe:m.equipe};
}

// Refus du rejeu (battements, présences) : un compteur n'est accepté qu'une fois, et seulement s'il dépasse le plus
// petit des REGLAGES.compteursRetenus derniers acceptés. Un battement capté puis republié tel quel est donc refusé ;
// un seul compteur forgé très grand n'empêche pas les vrais suivants (on ne compare pas au plus grand).
function compteurNeuf(l, c){
  if(!Number.isSafeInteger(c) || c < 1 || l.includes(c)) return false;
  const n = REGLAGES.compteursRetenus;
  if(l.length >= n && c < Math.min(...l)) return false;
  l.push(c);
  if(l.length > n){ let i = 0; for(let k = 1; k < l.length; k++) if(l[k] < l[i]) i = k; l.splice(i, 1); }
  return true;
}

// Seau à jetons : au plus `n` ordres par seconde, rafale de `n` au plus.
function nouveauSeau(n){ return {n, jetons:n, t:maintenant()}; }
function prendre(seau){
  const t = maintenant(); seau.jetons = Math.min(seau.n, seau.jetons + (t - seau.t)/1000*seau.n); seau.t = t;
  if(seau.jetons < 1) return false; seau.jetons -= 1; return true;
}

// -------------------------------------------------------------------------------------
// 2 ter. Signature des messages (protocole 2, troisième tour du 14 novembre 2026)
//    SHA-256 et HMAC-SHA-256 écrits ici en JavaScript pur et SYNCHRONE : aucune promesse dans le chemin des
//    messages, l'ordre et le rythme de traitement restent ceux d'avant. Vérifiés contre crypto.subtle par
//    essai-codec.html. Enveloppe : corps || compteur (6 octets, grand-boutiste) || genre (1 octet : 0 normal,
//    1 dernière volonté) || sceau (12 octets) ; sceau = 12 premiers octets de
//    HMAC-SHA-256(clé, genre || sujet relatif (UTF-8) || 0x00 || compteur || corps). Signé, PAS chiffré.
// -------------------------------------------------------------------------------------
const K256 = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const H0_SHA = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const W_SHA = new Int32Array(64);
function blocSha(H, o, p){
  const w = W_SHA;
  for(let i = 0; i < 16; i++, p += 4) w[i] = (o[p] << 24) | (o[p+1] << 16) | (o[p+2] << 8) | o[p+3];
  for(let i = 16; i < 64; i++){
    const x = w[i-15], y = w[i-2];
    w[i] = (w[i-16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[i-7]
      + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
  }
  let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
  for(let i = 0; i < 64; i++){
    const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
    const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
  H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
}
// Hachage progressif. `etat`, `deja` : reprise d'un état après des blocs déjà traités (HMAC précalculé).
class Sha256 {
  constructor(etat, deja){ this.H = Int32Array.from(etat || H0_SHA); this.t = new Uint8Array(64); this.n = 0; this.total = deja || 0; }
  maj(o){
    const L = o.length; let p = 0; this.total += L;
    if(this.n){
      const k = Math.min(64 - this.n, L); this.t.set(o.subarray(0, k), this.n); this.n += k; p = k;
      if(this.n < 64) return this;
      blocSha(this.H, this.t, 0); this.n = 0;
    }
    for(; p + 64 <= L; p += 64) blocSha(this.H, o, p);
    if(p < L){ this.t.set(o.subarray(p), 0); this.n = L - p; }
    return this;
  }
  fin(){
    const t = this.t, total = this.total;
    t[this.n++] = 0x80;
    if(this.n > 56){ t.fill(0, this.n); blocSha(this.H, t, 0); this.n = 0; }
    t.fill(0, this.n, 56);
    const hi = Math.floor(total / 0x20000000), lo = (total * 8) >>> 0;
    t[56] = hi >>> 24; t[57] = hi >>> 16; t[58] = hi >>> 8; t[59] = hi; t[60] = lo >>> 24; t[61] = lo >>> 16; t[62] = lo >>> 8; t[63] = lo;
    blocSha(this.H, t, 0);
    const r = new Uint8Array(32);
    for(let i = 0; i < 8; i++){ const x = this.H[i]; r[4*i] = x >>> 24; r[4*i+1] = x >>> 16; r[4*i+2] = x >>> 8; r[4*i+3] = x; }
    return r;
  }
}
function versOctets(x){
  if(x instanceof Uint8Array) return x;
  if(typeof x === 'string') return ENC.encode(x);
  if(x instanceof ArrayBuffer) return new Uint8Array(x);
  if(ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if(Array.isArray(x)) return Uint8Array.from(x);
  throw new TypeError('octets attendus');
}
function sha256(donnees){ return new Sha256().maj(versOctets(donnees)).fin(); }
// HMAC : états après le bloc de clé intérieur et extérieur, gardés par clé (une clé n'est jamais modifiée).
const contextesHmac = new WeakMap();
function contexteHmac(cle){
  let c = typeof cle === 'object' ? contextesHmac.get(cle) : null; if(c) return c;
  let k = versOctets(cle); if(k.length > 64) k = sha256(k);
  const bi = new Uint8Array(64), bo = new Uint8Array(64);
  for(let i = 0; i < 64; i++){ const x = i < k.length ? k[i] : 0; bi[i] = x ^ 0x36; bo[i] = x ^ 0x5c; }
  const i = new Sha256(), o = new Sha256(); blocSha(i.H, bi, 0); blocSha(o.H, bo, 0);
  c = {i:i.H, o:o.H};
  if(typeof cle === 'object') contextesHmac.set(cle, c);
  return c;
}
const hmacDebut = cle => new Sha256(contexteHmac(cle).i, 64);
const hmacFin = (cle, h) => new Sha256(contexteHmac(cle).o, 64).maj(h.fin()).fin();
function hmac(cle, donnees){ return hmacFin(cle, hmacDebut(cle).maj(versOctets(donnees))); }

const SCEAU = 19;                                    // compteur 6 + genre 1 + sceau 12
const SEL_SALON = 'front-de-sel|salon|2', ITERATIONS_SALON = 300000;
const RE_CLE_PUB = /^04[0-9a-f]{128}$/;              // clé publique ECDH P-256, brute non compressée, en hexadécimal
const RE_CLE_HEX = /^[0-9a-f]{64}$/;
const OCTET_NUL = new Uint8Array([0]);
const octetsSujets = new Map();
function octetsSujet(s){
  let b = octetsSujets.get(s);
  if(!b){ b = ENC.encode(s); if(octetsSujets.size > 512) octetsSujets.clear(); octetsSujets.set(s, b); }
  return b;
}
function calculerSceau(cle, genre, sujet, compteur6, corps){
  return hmacFin(cle, hmacDebut(cle).maj(Uint8Array.of(genre)).maj(octetsSujet(sujet)).maj(OCTET_NUL).maj(compteur6).maj(corps));
}
// sceller(clé, sujet relatif à la racine du salon, corps, compteur, genre) → octets de l'enveloppe.
function sceller(cle, sujet, corps, compteur, genre = 0){
  const c = versOctets(corps), L = c.length;
  if(!Number.isSafeInteger(compteur) || compteur < 0 || compteur >= 281474976710656) throw new RangeError('compteur hors bornes');
  if(genre !== 0 && genre !== 1) throw new RangeError('genre inconnu');
  const r = new Uint8Array(L + SCEAU); r.set(c, 0);
  const hi = Math.floor(compteur / 4294967296), lo = compteur >>> 0;
  r[L] = hi >>> 8; r[L+1] = hi; r[L+2] = lo >>> 24; r[L+3] = lo >>> 16; r[L+4] = lo >>> 8; r[L+5] = lo; r[L+6] = genre;
  r.set(calculerSceau(cle, genre, String(sujet), r.subarray(L, L + 6), c).subarray(0, 12), L + 7);
  return r;
}
// ouvrir(clé, sujet relatif, octets) → {corps, compteur, genre} si le sceau est valable, sinon null. Ne lève pas.
function ouvrir(cle, sujet, o){
  try{
    if(!o || !(o.length >= SCEAU)) return null;
    const L = o.length - SCEAU, genre = o[L + 6];
    if(genre > 1) return null;
    const corps = o.subarray(0, L), s = calculerSceau(cle, genre, String(sujet), o.subarray(L, L + 6), corps);
    let d = 0; for(let i = 0; i < 12; i++) d |= s[i] ^ o[L + 7 + i];
    if(d) return null;
    const compteur = ((o[L] << 8) | o[L+1]) * 4294967296 + (((o[L+2] << 24) | (o[L+3] << 16) | (o[L+4] << 8) | o[L+5]) >>> 0);
    return {corps, compteur, genre};
  }catch(e){ return null; }
}
const deHex = h => { const b = new Uint8Array(h.length >> 1); for(let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(2*i, 2), 16); return b; };
// Clé de salon et racine des sujets, tirées du code normalisé (PBKDF2-SHA-256, 300 000 itérations). Le code ne
// circule jamais. Résultat gardé pour la page (16 codes au plus).
const salonsDerives = new Map();
function deriverSalon(code){
  const nc = normaliserCode(code); if(nc.erreur) return Promise.reject(erreurReseau('code', nc.erreur));
  let p = salonsDerives.get(nc.code);
  if(!p){
    p = (async () => {
      if(!(global.crypto && crypto.subtle)) throw erreurReseau('crypto');
      const k = await crypto.subtle.importKey('raw', ENC.encode(nc.code), 'PBKDF2', false, ['deriveBits']);
      const b = new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:ENC.encode(SEL_SALON), iterations:ITERATIONS_SALON}, k, 320));
      return {racine:'fds/' + PROTO + '/' + hex(b.subarray(0, 8)) + '/', cle:b.slice(8, 40)};
    })();
    p.catch(() => salonsDerives.delete(nc.code));
    salonsDerives.set(nc.code, p);
    while(salonsDerives.size > 16) salonsDerives.delete(salonsDerives.keys().next().value);
  }
  return p.then(r => ({racine:r.racine, cle:r.cle.slice()}));
}
// Clé de siège = HMAC-SHA-256(clé de salon, 'siege' || identifiant || secret ECDH).
function cleSiege(cleSalon, id, secret){
  const i = ENC.encode('siege' + String(id)), s = versOctets(secret), m = new Uint8Array(i.length + s.length);
  m.set(i, 0); m.set(s, i.length);
  return hmac(cleSalon, m);
}
async function nouvellePaire(){
  if(!(global.crypto && crypto.subtle)) throw erreurReseau('crypto');
  const p = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, false, ['deriveBits']);
  return {prive:p.privateKey, pub:hex(await crypto.subtle.exportKey('raw', p.publicKey))};
}
// Secret ECDH avec une clé publique reçue (hexadécimal) ; null si elle est invalide (point hors courbe…).
async function secretEcdh(prive, pubHex){
  if(typeof pubHex !== 'string' || !RE_CLE_PUB.test(pubHex)) return null;
  try{
    const k = await crypto.subtle.importKey('raw', deHex(pubHex), {name:'ECDH', namedCurve:'P-256'}, false, []);
    return new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH', public:k}, prive, 256));
  }catch(e){ return null; }
}
async function deriverSiege(cleSalon, id, prive, pubHex){ const s = await secretEcdh(prive, pubHex); return s ? cleSiege(cleSalon, id, s) : null; }

// Taille maximale du corps selon le sujet relatif (contrôle avant le calcul du sceau : un déluge de gros messages
// invalides coûte peu). 0 : sujet inconnu.
function tailleMaxSujet(rel){
  const R = REGLAGES;
  if(rel === 'h/salon') return R.tailleDescriptionMax;
  if(rel === 'h/etat') return R.tailleInstantaneMax;
  if(rel === 'h/evt') return R.tailleEvenementMax;
  if(rel === 'h/vie') return 64;
  if(rel.startsWith('h/a/')) return R.tailleRattrapageMax;
  if(rel.startsWith('h/v/')) return 64;
  if(rel.startsWith('j/')){
    const g = rel.slice(rel.lastIndexOf('/') + 1);
    return g === 'pres' ? R.taillePresMax : g === 'ordres' ? R.tailleOrdreMax : g === 'ctl' ? R.tailleCtlMax : g === 'vie' ? 64 : 0;
  }
  return 0;
}

// Couche de signature, entre le transport (MQTT ou boucle locale) et la logique du salon. Même interface que le
// transport. À la publication : scelle avec la clé de salon, ou la clé passée en option `cle` (un corps vide part
// tel quel : effacement d'un message conservé). À la réception : sceau vérifié AVANT toute autre lecture, avec les
// clés que le salon attend pour ce sujet et ce sens (`canal.cles(sujetRelatif, genre)` → [{nom, cle, memoire?}]),
// puis refus du rejeu (compteur strictement supérieur au dernier accepté sur ce sujet, pour cette famille de clés ;
// la dernière volonté n'y est pas soumise). Seul un message authentique monte ('message', avec genre, cle, compteur) ;
// les autres sont comptés (stats.rejets) et signalés par 'invalide' {sujet, motif}, sans leur contenu.
class Canal extends Diffuseur {
  constructor(transport, R, cleSalon, depart){
    super();
    this.transport = transport; this.R = R; this.cleSalon = cleSalon;
    this.c = Math.max(0, +depart || 0); this.dernierCompteur = 0;
    this.serveur = transport.serveur; this.compteur = transport.compteur;
    this.essais = transport.essais; this.dureeConnexion = transport.dureeConnexion;
    this.cles = () => [];
    this.vus = Object.create(null);
    // Plancher (invité, depuis le 14 novembre 2026, quatrième tour) : compteur d'enveloppe de l'accueil accepté. L'hôte
    // n'a qu'un compteur par connexion : sur ses sujets, tout message normal plus ancien que l'accueil est un rejeu,
    // même si cette connexion (neuve après un rechargement) ne l'a jamais vu.
    this.plancher = null;
    // Borne haute (invité, cinquième tour du 14 novembre 2026) : sur les sujets de l'hôte (h/…), un message scellé avec
    // la clé de salon (qu'un détenteur du code peut forger) n'est retenu qu'APRÈS l'accueil, et seulement si son
    // compteur ne dépasse pas l'horloge de l'hôte projetée (référence : accueil, puis tout message de l'hôte scellé avec
    // la clé de siège) + REGLAGES.avanceCompteurMaxMs. Au-delà, il est jeté sans être retenu (motif 'avance') : un
    // compteur poussé à + 24 h ne fait plus jeter les vrais messages de l'hôte pendant 24 h.
    this.bornerSalon = false;
    this.stats = {acceptes:0, rejets:{}};
    transport.on('message', m => this._recevoir(m));
    transport.on('deconnecte', () => this._emettre('deconnecte'));
    transport.on('reconnecte', () => this._emettre('reconnecte'));
  }
  get connecte(){ return this.transport.connecte; }
  get ferme(){ return this.transport.ferme; }
  // Compteur de l'émetteur : un seul par connexion, max(précédent + 1, Date.now()).
  suivant(){ this.c = Math.max(this.c + 1, Date.now()); return this.c; }
  get compteurActuel(){ return this.c; }
  publier(sujet, donnees, {qos = 0, retenir = false, cle = null} = {}){
    let corps;
    try{ corps = versOctets(donnees); }catch(e){ return Promise.resolve(false); }
    if(!corps.length) return this.transport.publier(sujet, corps, {qos, retenir});
    if(typeof sujet !== 'string' || !sujet.startsWith(this.R)) return Promise.resolve(false);
    const c = this.suivant(); this.dernierCompteur = c;
    return this.transport.publier(sujet, sceller(cle || this.cleSalon, sujet.slice(this.R.length), corps, c, 0), {qos, retenir});
  }
  // v : compteur ; sur(sujetRelatif) → vrai pour les sujets concernés (ceux de l'hôte).
  // La référence de la borne haute part du même compteur (ref, refT : temps local, horloge monotone).
  fixerPlancher(v, sur){ if(Number.isSafeInteger(v) && v > 0 && typeof sur === 'function') this.plancher = {v, sur, ref:v, refT:maintenant()}; }
  abonner(filtres){ return this.transport.abonner(filtres); }
  couper(dureeMs){ return this.transport.couper(dureeMs); }
  fermer(o){ return this.transport.fermer(o); }
  _jeter(sujet, motif){
    this.stats.rejets[motif] = (this.stats.rejets[motif] || 0) + 1;
    this._emettre('invalide', {sujet, motif});
  }
  _recevoir({sujet, octets, conserve}){
    try{
      if(typeof sujet !== 'string' || !sujet.startsWith(this.R)) return this._jeter(String(sujet).slice(0, 200), 'sujet');
      if(!octets || !octets.length) return this._jeter(sujet, 'vide');   // effacement d'un message conservé : sans auteur, sans effet
      const rel = sujet.slice(this.R.length), max = tailleMaxSujet(rel);
      if(!max) return this._jeter(sujet, 'sujet');
      if(octets.length > max + SCEAU) return this._jeter(sujet, 'taille');
      const genre = octets.length >= SCEAU ? octets[octets.length - 13] : -1;
      let r = null, k = null;
      for(const c of this.cles(rel, genre) || []){ r = ouvrir(c.cle, rel, octets); if(r){ k = c; break; } }
      if(!r) return this._jeter(sujet, 'sceau');
      if(r.genre === 0){
        const P = this.plancher;
        if(P && r.compteur <= P.v && P.sur(rel)) return this._jeter(sujet, 'rejeu');
        const famille = k.memoire || k.nom, m = this.vus[famille] || (this.vus[famille] = new Map()), d = m.get(rel);
        if(d !== undefined && r.compteur <= d) return this._jeter(sujet, 'rejeu');
        const borne = this.bornerSalon && famille === 'salon' && rel.startsWith('h/');
        if(borne && P && r.compteur > P.ref + (maintenant() - P.refT) + REGLAGES.avanceCompteurMaxMs) return this._jeter(sujet, 'avance');
        if(!borne || P){                             // avant l'accueil : rien n'est retenu à la clé de salon sur h/…
          m.delete(rel); m.set(rel, r.compteur);
          while(m.size > REGLAGES.sujetsRetenus) m.delete(m.keys().next().value);   // mémoire bornée (les plus anciens oubliés)
        }
        // Message de l'hôte scellé avec la clé de siège (infalsifiable) : il recale la référence de la borne haute (horloge
        // de l'hôte avancée en cours de partie).
        if(this.bornerSalon && P && famille === 'siege' && rel.startsWith('h/') && r.compteur > P.ref + (maintenant() - P.refT)){ P.ref = r.compteur; P.refT = maintenant(); }
      }
      this.stats.acceptes++;
      this._emettre('message', {sujet, octets:r.corps, conserve:!!conserve, genre:r.genre, cle:k.nom, compteur:r.compteur});
    }catch(e){ this.stats.rejets.exception = (this.stats.rejets.exception || 0) + 1; journal('canal : exception ' + (e && e.message)); }
  }
}

// -------------------------------------------------------------------------------------
// 3. Codes de salon, sujets, serveurs
// -------------------------------------------------------------------------------------
function normaliserCode(saisie){
  const s = String(saisie == null ? '' : saisie).slice(0, 100).toUpperCase().replace(/[\s\-_.]/g, '');
  // La longueur d'abord (« AB » : trop court, quel que soit le caractère), puis les caractères.
  if([...s].length !== 6) return {erreur:'Le code compte 6 caractères (par exemple K7M-4QX).'};
  for(const ch of s){
    if(ALPHABET.includes(ch)) continue;
    if('0O'.includes(ch)) return {erreur:'Les codes ne contiennent ni la lettre O ni le chiffre 0 : vérifiez ce caractère.'};
    if('1IL'.includes(ch)) return {erreur:'Les codes ne contiennent ni 1, ni I, ni L : vérifiez ce caractère.'};
    if('2Z'.includes(ch)) return {erreur:'Les codes ne contiennent ni 2 ni Z : vérifiez ce caractère.'};
    if('5S'.includes(ch)) return {erreur:'Les codes ne contiennent ni 5 ni S : vérifiez ce caractère.'};
    if('8B'.includes(ch)) return {erreur:'Les codes ne contiennent ni 8 ni B : vérifiez ce caractère.'};
    // Le caractère n'est recopié que s'il est une lettre ou un chiffre (le code peut venir d'un lien).
    return {erreur:/^[A-Z0-9]$/.test(ch) ? 'Caractère « ' + ch + ' » inconnu dans les codes de salon.' : 'Le code contient un caractère qui n’existe pas dans les codes de salon.'};
  }
  return {code:s};
}
const formaterCode = c => c.slice(0, 3) + '-' + c.slice(3);

// Racine des sujets : fds/2/<16 chiffres hexadécimaux>/, tirée du code par deriverSalon (section 2 ter).
function sujetsDe(R){
  return {
    salon:R + 'h/salon', etat:R + 'h/etat', evt:R + 'h/evt', vieH:R + 'h/vie',
    prive:id => R + 'h/a/' + id, pong:id => R + 'h/v/' + id,
    pres:id => R + 'j/' + id + '/pres', ordres:id => R + 'j/' + id + '/ordres',
    ctl:id => R + 'j/' + id + '/ctl', vie:id => R + 'j/' + id + '/vie',
    tousInvites:R + 'j/+/#',
  };
}

function resoudreServeurs(choix){
  if(choix == null || choix === '') return CHAINE_DEFAUT.map(k => SERVEURS_MQTT.find(s => s.cle === k));
  return [].concat(choix).map(c => {
    const s = SERVEURS_MQTT.find(x => x.cle === c); if(s) return s;
    if(typeof c === 'string' && /^wss:\/\/[^\s\/?#]+(\/[^\s]*)?$/i.test(c)) return {cle:c, nom:'personnalisé', url:c, cadenceMax:10};
    throw erreurReseau('serveur', 'Adresse de serveur refusée : seules les adresses wss:// complètes sont acceptées.');
  });
}

// -------------------------------------------------------------------------------------
// 4. Transport MQTT (MQTT.js) et transport en boucle locale (sans serveur)
//    Interface commune : publier(sujet, donnees, {qos, retenir}) → Promise<bool>,
//    abonner(filtres) → Promise, couper() (essai), fermer({brutal}) → Promise,
//    événements 'message' {sujet, octets, conserve}, 'deconnecte', 'reconnecte'.
// -------------------------------------------------------------------------------------
let promesseBiblio = null;
function chargerBibliotheque(){
  if(global.mqtt && global.mqtt.connect) return Promise.resolve(global.mqtt);
  if(promesseBiblio) return promesseBiblio;
  promesseBiblio = new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = BIBLIOTHEQUE.url; s.integrity = BIBLIOTHEQUE.integrite; s.crossOrigin = 'anonymous'; s.async = true;
    const echec = () => { clearTimeout(t); promesseBiblio = null; ko(erreurReseau('bibliotheque', 'Impossible de charger la bibliothèque MQTT (réseau coupé ou contrôle d’intégrité refusé).')); };
    const t = setTimeout(echec, 15000);
    s.onload = () => { clearTimeout(t); if(global.mqtt && global.mqtt.connect){ journal('bibliothèque MQTT chargée'); ok(global.mqtt); } else echec(); };
    s.onerror = echec;
    document.head.appendChild(s);
  });
  return promesseBiblio;
}

function connecterUn(mqtt, url, will){
  return new Promise((ok, ko) => {
    let fini = false, c;
    const opts = {clientId:'fds-' + tirer(10, ALNUM), keepalive:REGLAGES.keepalive, reconnectPeriod:0,
      connectTimeout:REGLAGES.delaiConnexionMs, clean:true, queueQoSZero:false, protocolVersion:4, resubscribe:true};
    if(will) opts.will = {topic:will.sujet, payload:will.donnees, qos:1, retain:true};
    const echec = m => { if(fini) return; fini = true; clearTimeout(t); try{ c && c.end(true); }catch(e){} ko(new Error(m)); };
    const t = setTimeout(() => echec('délai de connexion dépassé'), REGLAGES.delaiConnexionMs + 1000);
    try{ c = mqtt.connect(url, opts); }catch(e){ echec(String(e && e.message || e)); return; }
    c.once('connect', () => { if(fini) return; fini = true; clearTimeout(t); ok(c); });
    c.on('error', e => echec(String(e && e.message || e)));
    c.on('close', () => echec('connexion refusée ou fermée'));
  });
}

class TransportMqtt extends Diffuseur {
  constructor(client, serveur){
    super();
    this.client = client; this.serveur = serveur; this.compteur = new Compteur();
    this.connecte = true; this.ferme = false;
    client.on('message', (sujet, o, paquet) => {
      const octets = new Uint8Array(o.buffer, o.byteOffset, o.byteLength);
      this.compteur.noter('reception', octets.length);
      this._emettre('message', {sujet, octets, conserve:!!(paquet && paquet.retain)});
    });
    const perdu = () => { if(this.ferme || !this.connecte) return; this.connecte = false; journal('transport : coupure'); this._emettre('deconnecte'); };
    client.on('close', perdu); client.on('offline', perdu);
    client.on('connect', () => { if(this.connecte || this.ferme) return; this.connecte = true; journal('transport : reconnecté'); this._emettre('reconnecte'); });
    client.on('error', e => journal('transport : erreur', String(e && e.message || e)));
    client.options.reconnectPeriod = REGLAGES.reconnexionMs;   // reconnexion automatique, réabonnement par MQTT.js
  }
  // Essaie les serveurs dans l'ordre, puis une seconde fois le premier (HiveMQ échoue parfois une fois sur
  // un essai et accepte l'essai suivant). `etape` : rappel d'avancement (signaleur).
  static async ouvrir(serveurs, {will, etape} = {}){
    const signaler = etape || (() => {});
    if(!(global.mqtt && global.mqtt.connect)) signaler({etape:'bibliotheque'});
    const mqtt = await chargerBibliotheque();
    const essais = [], plan = serveurs.slice();
    if(serveurs.length) plan.push(serveurs[0]);
    for(let i = 0; i < plan.length; i++){
      const srv = plan[i], deja = plan.slice(0, i).includes(srv);
      signaler({etape:i === 0 ? 'connexion' : deja ? 'nouvelleTentative' : 'secours', serveur:srv.nom, essai:i + 1});
      if(deja) await new Promise(ok => setTimeout(ok, 1000));
      const t0 = maintenant();
      try{
        const c = await connecterUn(mqtt, srv.url, will);
        const tr = new TransportMqtt(c, srv);
        tr.dureeConnexion = maintenant() - t0;
        essais.push({url:srv.url, ok:true, ms:Math.round(tr.dureeConnexion)}); tr.essais = essais;
        journal('connecté à ' + srv.url + ' en ' + Math.round(tr.dureeConnexion) + ' ms');
        return tr;
      }catch(e){
        essais.push({url:srv.url, ok:false, ms:Math.round(maintenant() - t0), erreur:e.message});
        journal('échec de connexion à ' + srv.url + ' : ' + e.message);
      }
    }
    throw erreurReseau('serveur', MESSAGES.serveur, {essais});
  }
  publier(sujet, donnees, {qos = 0, retenir = false} = {}){
    if(this.ferme) return Promise.resolve(false);
    const octets = typeof donnees === 'string' ? ENC.encode(donnees) : donnees;
    this.compteur.noter('envoi', octets.length);
    return new Promise(ok => {
      try{ this.client.publish(sujet, octets.length ? octets : '', {qos, retain:retenir}, err => ok(!err)); }catch(e){ ok(false); }
    });
  }
  abonner(filtres){ return new Promise(ok => this.client.subscribe(filtres, {qos:1}, err => ok(!err))); }
  couper(){ try{ this.client.stream.destroy(); }catch(e){ journal('couper : ' + e.message); } }   // essai : coupure franche
  fermer({brutal = false} = {}){
    if(this.ferme) return Promise.resolve(); this.ferme = true; this.connecte = false;
    return new Promise(ok => { setTimeout(ok, 2000); try{ this.client.end(!!brutal, {}, () => ok()); }catch(e){ ok(); } });
  }
}

// Correspondance d'un filtre MQTT (+, #) avec un sujet.
function correspond(filtre, sujet){
  if(filtre === sujet) return true;
  const f = filtre.split('/'), s = sujet.split('/');
  for(let i = 0; i < f.length; i++){
    if(f[i] === '#') return true;
    if(i >= s.length) return false;
    if(f[i] !== '+' && f[i] !== s[i]) return false;
  }
  return f.length === s.length;
}

// Bus en boucle locale : simule un serveur MQTT dans la page, avec retard, gigue et pertes.
// Les pertes ne frappent que la QoS 0 ; la QoS 1 garde l'ordre par sujet et n'est perdue que
// pendant une coupure (comme en MQTT réel sans session persistante). Les messages conservés
// et les messages de dernière volonté sont simulés.
let numBoucle = 0;
class Bus {
  constructor(p){ this.clients = new Set(); this.conserves = new Map(); this._dernier = new Map(); this.stats = {livres:0, perdus:0}; this.regler(p || {}); }
  regler(p){
    if(p.retard != null) this.retard = Math.max(0, +p.retard || 0); else if(this.retard == null) this.retard = 0;
    if(p.gigue != null) this.gigue = Math.max(0, +p.gigue || 0); else if(this.gigue == null) this.gigue = 0;
    if(p.perte != null) this.perte = Math.min(1, Math.max(0, +p.perte || 0)); else if(this.perte == null) this.perte = 0;
    if(p.url != null) this.url = String(p.url);   // essais : deux bus d'adresses différentes jouent deux serveurs
    return this;
  }
  ouvrir({will} = {}){ const t = new TransportBoucle(this, will); this.clients.add(t); return t; }
  _publier(sujet, octets, qos, retenir){
    if(retenir){ if(octets.length) this.conserves.set(sujet, octets); else this.conserves.delete(sujet); }
    for(const c of this.clients) if(!c.coupe && !c.ferme && c._abonne(sujet)) this._livrer(c, sujet, octets, qos, false);
  }
  _livrer(c, sujet, octets, qos, conserve){
    if(qos === 0 && this.perte > 0 && Math.random() < this.perte){ this.stats.perdus++; return; }
    const m = maintenant(); let t = m + this.retard + Math.random()*this.gigue;
    if(qos > 0){ const k = c.num + '|' + sujet; t = Math.max(t, this._dernier.get(k) || 0); this._dernier.set(k, t); }
    const copie = octets.slice();
    this._planifier(t, () => { if(c.ferme || c.coupe) return; this.stats.livres++; c._recevoir(sujet, copie, conserve); });
  }
  // File d'attente datée, vidée par le minuteur du Worker (setTimeout est bridé à 1 s en arrière-plan).
  _planifier(t, fn){
    const f = this._file || (this._file = []);
    let i = f.length; while(i > 0 && f[i-1].t > t) i--;
    f.splice(i, 0, {t, fn});
    if(!this._arret) this._arret = minuteur(4, () => this._tic());
  }
  _tic(){
    const m = maintenant(), f = this._file;
    let i = 0; while(i < f.length && f[i].t <= m) i++;
    for(const d of f.splice(0, i)) d.fn();
    if(!f.length && this._arret){ this._arret(); this._arret = null; }
  }
}
class TransportBoucle extends Diffuseur {
  constructor(bus, will){
    super(); this.bus = bus; this.will = will; this.num = ++numBoucle; this.filtres = [];
    this.compteur = new Compteur(); this.connecte = true; this.ferme = false; this.coupe = false;
    this.serveur = {cle:'boucle', nom:'boucle locale', url:bus.url || 'boucle://', cadenceMax:100};
    this.dureeConnexion = 0; this.essais = [];
  }
  _abonne(sujet){ return this.filtres.some(f => correspond(f, sujet)); }
  _recevoir(sujet, octets, conserve){ this.compteur.noter('reception', octets.length); this._emettre('message', {sujet, octets, conserve}); }
  _conserves(f){ for(const [s, o] of this.bus.conserves) if(correspond(f, s)) this.bus._livrer(this, s, o, 1, true); }
  abonner(filtres){
    for(const f of [].concat(filtres)) if(!this.filtres.includes(f)){ this.filtres.push(f); this._conserves(f); }
    return Promise.resolve(true);
  }
  publier(sujet, donnees, {qos = 0, retenir = false} = {}){
    if(this.ferme) return Promise.resolve(false);
    const octets = typeof donnees === 'string' ? ENC.encode(donnees) : donnees;
    this.compteur.noter('envoi', octets.length);
    if(this.coupe) return Promise.resolve(false);
    this.bus._publier(sujet, octets, qos, retenir);
    return Promise.resolve(true);
  }
  _will(){ if(this.will) this.bus._publier(this.will.sujet, versOctets(this.will.donnees), 1, true); }
  couper(dureeMs = 1100){   // essai : coupure franche, le « serveur » publie la dernière volonté
    if(this.coupe || this.ferme) return; this.coupe = true; this.connecte = false; this._will();
    this._emettre('deconnecte');
    // Retour porté par le minuteur du Worker (un setTimeout long serait bridé dans un onglet en arrière-plan).
    const fin = maintenant() + dureeMs;
    const arret = minuteur(50, () => {
      if(maintenant() < fin) return; arret();
      if(this.ferme) return; this.coupe = false; this.connecte = true;
      for(const f of this.filtres) this._conserves(f);
      this._emettre('reconnecte');
    });
  }
  fermer({brutal = false} = {}){
    if(this.ferme) return Promise.resolve(); this.ferme = true; this.connecte = false;
    this.bus.clients.delete(this); if(brutal) this._will();
    return Promise.resolve();
  }
}
let busDefaut = null;

function ouvrirTransport(o, will, etape){
  const bus = o.transport || busDefaut;
  if(bus) return Promise.resolve(bus.ouvrir({will}));
  return TransportMqtt.ouvrir(resoudreServeurs(o.serveurs || o.serveur), {will, etape});
}

// -------------------------------------------------------------------------------------
// 5. Codec d'instantané (fonctions pures, sans réseau)
//    Format décrit dans INTERFACE-RESEAU.md § 5. Entiers petit-boutistes.
// -------------------------------------------------------------------------------------
const TABLES_VIDES = {unites:[], batiments:[], camps:[], pouvoirs:[], projectiles:[], armes:[], effets:[]};
let T = null;
function definirTypes(t){
  const r = {idx:{}};
  for(const k of Object.keys(TABLES_VIDES)){
    const l = (t && t[k]) || [];
    if(!Array.isArray(l) || l.length > 255) throw new Error('definirTypes : « ' + k + ' » doit être une liste de 255 noms au plus.');
    r[k] = l.map(String); r.idx[k] = new Map(r[k].map((n, i) => [n, i]));
    if(r.idx[k].size !== r[k].length) throw new Error('definirTypes : doublon dans « ' + k + ' ».');
  }
  // (26 novembre 2026) positionsLarges : positions à l'échelle large dans les instantanés encodés ici (voir qPos).
  r.positionsLarges = !!(t && t.positionsLarges === true);
  T = r;
  return true;
}
function indexDe(table, nom){
  if(!T) throw new Error('Codec : appeler Reseau.definirTypes avant d’encoder.');
  const i = T.idx[table].get(String(nom));
  if(i === undefined) throw new Error('Codec : « ' + nom + ' » absent de la table « ' + table + ' » (definirTypes).');
  return i;
}
function nomDe(table, i){ const n = T.idx && T[table][i]; if(n === undefined) throw new RangeError('indice ' + i + ' hors de la table ' + table); return n; }

const ENTETE = 20;
const borne = (x, a, b) => x < a ? a : x > b ? b : x;
const K_ANG = 256/(2*Math.PI);
// Positions (u16). Échelle normale : 1/16 px, de −400 à 3 695,9 px (cartes de 80 × 56 cases, 3 200 × 2 240 px).
// Échelle large (26 novembre 2026, grande carte en ligne, 140 × 98 cases = 5 600 × 3 920 px) : 1/10 px, de −400 à
// 6 153,5 px ; erreur d'arrondi 0,05 px au plus (0,031 en échelle normale). Mêmes deux octets par coordonnée : la taille
// des instantanés ne change pas. L'échelle est choisie par l'hôte (definirTypes, positionsLarges) et annoncée par le
// bit 3 de l'octet de drapeaux de chaque instantané ; le décodeur suit ce bit, jamais un réglage local. Échelle normale :
// bit à 0, octets identiques à ceux d'avant. echPos est posée au début de chaque encodage et de chaque décodage
// (fonctions synchrones), avant toute quantification.
const ECHELLE_POS = 16, ECHELLE_POS_LARGE = 10, BIT_POS_LARGE = 8;
let echPos = ECHELLE_POS;
const qPos = x => borne(Math.round(((+x || 0) + 400)*echPos), 0, 65535);
const dPos = q => q/echPos - 400;
function echelleEncodeur(){ echPos = T && T.positionsLarges ? ECHELLE_POS_LARGE : ECHELLE_POS; }
function qAng(a){ let v = Math.round((+a || 0)*K_ANG) % 256; if(v < 0) v += 256; return v; }
const dAng = q => q/K_ANG;
function qFrac(pv, pvMax){ if(!(pvMax > 0)) return 0; let f = Math.round((+pv || 0)/pvMax*255); if(pv > 0 && f < 1) f = 1; return borne(f, 0, 255); }
const qFrac01 = x => borne(Math.round((+x || 0)*255), 0, 255);
const horloge = t => (typeof t === 'number' && isFinite(t)) ? Math.round(t*50) : -1;   // 1/50 s
const u8r = x => borne(Math.round(+x || 0), 0, 255);
const u16r = x => borne(Math.round(+x || 0), 0, 65535);

class Ecrivain {
  constructor(n){ this.b = new Uint8Array(n || 2048); this.v = new DataView(this.b.buffer); this.p = 0; }
  _place(n){
    if(this.p + n <= this.b.length) return;
    let t = this.b.length*2; while(t < this.p + n) t *= 2;
    const nb = new Uint8Array(t); nb.set(this.b); this.b = nb; this.v = new DataView(nb.buffer);
  }
  u8(x){ this._place(1); this.b[this.p++] = x & 255; }
  i8(x){ this._place(1); this.v.setInt8(this.p++, x); }
  u16(x){ this._place(2); this.v.setUint16(this.p, x & 0xFFFF, true); this.p += 2; }
  u32(x){ this._place(4); this.v.setUint32(this.p, x >>> 0, true); this.p += 4; }
  fin(){ return this.b.slice(0, this.p); }
}
class Lecteur {
  constructor(o){ this.v = new DataView(o.buffer, o.byteOffset, o.byteLength); this.p = 0; this.n = o.byteLength; }
  u8(){ return this.v.getUint8(this.p++); }
  i8(){ return this.v.getInt8(this.p++); }
  u16(){ const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
  u32(){ const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
}

// --- Quantification (côté encodeur) ---
function qUnite(u){
  const vol = typeof u.alt === 'number', aCh = typeof u.charge === 'number';
  return {
    id:u.id & 0xFFFF, x:qPos(u.x), y:qPos(u.y), a:qAng(u.angle), at:qAng(u.angleT == null ? u.angle : u.angleT),
    pvMax:u16r(u.pvMax), pv:qFrac(u.pv, u.pvMax),
    dr:(u.auSol ? 1 : 0) | (u.travaille ? 2 : 0) | (borne(u.rang | 0, 0, 3) << 2),
    type:indexDe('unites', u.type), camp:indexDe('camps', u.camp),
    vol, alt:vol ? u8r(u.alt) : 0, vit:vol ? u8r((+u.vit || 0)/2) : 0,
    aCh, ch:aCh ? u16r(u.charge*100) : 0,
    cs:u.cibleSoin ? (u.cibleSoin & 0xFFFF) : 0,
    tir:horloge(u.tirT), rec:horloge(u.recolteT), rep:horloge(u.repareT),
  };
}
// Extension du bâtiment (20 novembre 2026, galeries de tir et défense antimissile en ligne ; CAHIER-GALERIES-EN-LIGNE.md
// § 4) : bit 64 de l'octet de drapeaux, puis un octet x (bit 0 galerie b.gal, bit 1 batterie b.para, bit 2 cycle de
// tir en cours, bit 3 intT présent). Galerie : u8 stock (4 bits bas) + fab (4 bits hauts), u8 fabT en secondes
// entières arrondies vers le haut ; si cycle, u16 âge de t0 en 1/50 s et u8 n (bas) + tires (haut). Batterie : u8
// stock/fab, u8 fabT ; si intT, u8 âge en 1/50 s (la pose du caisson dure 4,5 s : r3d-batiments.js,
// CYCLE_INTERCEPTION.repos). Les heures quantifiées gardées pour la comparaison (memeBat) sont absolues, comme tirT :
// le bâtiment n'est pas renvoyé à chaque instantané. Sans gal ni para : x = 0, rien d'écrit, octets d'avant.
// Lot B (22 novembre 2026, cahier galerie § 12.7) : bits 4, 5, 6 de x (libres jusque-là) = missile lourd prêt
// (gal.lourd), lourd commandé (gal.fabLourd), cycle de tir lourd (gal.cycleLourd) ; aucun octet de plus (fabT, partagé,
// tient sur l'u8 : 240 s au plus). Une galerie sans lourd s'encode exactement comme en version 45. La Batterie Zénith
// est une batterie comme la Parasol (bit 1, mêmes champs) ; sa pose de tir dure aussi 4,5 s (même
// CYCLE_INTERCEPTION dans r3d-batiments.js), l'âge de intT tient donc sur un u8.
// Extracteur (26 novembre 2026, grande carte en ligne) : bit 7 de x (libre jusque-là), puis u8 cap, [u8 k], u8 rev.
// cap = 0 sans capture en cours ; sinon bit 7 = capture en cours, bit 6 = contestée, bits 0-5 = indice du camp qui
// capture + 1 (0 : aucun camp, capture contestée dès l'arrivée). k (présent si capture) = s de capture cumulées en
// 1/20 s (12,75 s au plus ; la capture dure 10 s). rev = âge du dernier versement en 1/50 s (0-254 ; un versement
// toutes les 5 s, soit 250 au plus), 255 = aucun revenu (extracteur neutre). L'heure du dernier versement est gardée
// absolue (comme tirT) : entre deux versements l'enregistrement ne change pas et n'est pas renvoyé ; seule une capture
// en cours le fait renvoyer à chaque instantané. Données prises dans b.extr = {capture:{camp, t, conteste} | null,
// versementT (heure de jeu du dernier versement, ou null)}. Sans b.extr (tout autre bâtiment) : bit à 0, rien d'écrit,
// octets d'avant.
function qExtracteur(b){
  const e = b.extr && typeof b.extr === 'object' ? b.extr : null;
  if(!e) return null;
  const K = e.capture && typeof e.capture === 'object' ? e.capture : null;
  const ic = K && K.camp != null ? indexDe('camps', K.camp) + 1 : 0;
  if(ic > 63) throw new Error('Codec : indice de camp trop grand pour un extracteur.');
  return {cap:K ? 128 | (K.conteste === true ? 64 : 0) | ic : 0, k:K ? u8r((+K.t || 0)*20) : 0, rev:horloge(e.versementT)};
}
const nib = v => borne(Math.round(+v || 0), 0, 15);
const secHaut = t => borne(Math.ceil((+t || 0) - 1e-6), 0, 255);   // (1e-6 : comme l'affichage de la fiche, ligneEtatGalerie)
function qBatiment(b){
  const g = b.gal && typeof b.gal === 'object' ? b.gal : null, p = b.para && typeof b.para === 'object' ? b.para : null;
  const g0 = g ? horloge(g.t0) : -1, it = p ? horloge(b.intT) : -1, ex = qExtracteur(b);
  return {
    id:b.id & 0xFFFF, pvMax:u16r(b.pvMax), pv:qFrac(b.pv, b.pvMax), pr:qFrac01(b.progres), at:qAng(b.angleT),
    enC:!!b.enCours, bl:!!b.bloque,
    file:(b.file || []).slice(0, 255).map(t => indexDe('unites', t)), av:qFrac01(b.avancement),
    rally:b.rally ? [qPos(b.rally.x), qPos(b.rally.y)] : null, tir:horloge(b.tirT),
    type:indexDe('batiments', b.type), camp:indexDe('camps', b.camp), c:u8r(b.c), r:u8r(b.r),
    x:(g ? 1 : 0) | (p ? 2 : 0) | (g && g.lourd > 0 ? 16 : 0) | (g && g.fabLourd > 0 ? 32 : 0) | (g && g.cycleLourd === true ? 64 : 0) | (ex ? 128 : 0),
    ec:ex ? ex.cap : 0, ek:ex ? ex.k : 0, er:ex ? ex.rev : 0,
    gs:g ? nib(g.stock) | (nib(g.fab) << 4) : 0, gf:g ? secHaut(g.fabT) : 0, g0,
    gn:g && g0 >= 0 ? nib(g.n) | (nib(g.tires) << 4) : 0,
    ps:p ? nib(p.stock) | (nib(p.fab) << 4) : 0, pf:p ? secHaut(p.fabT) : 0, it,
  };
}
function quantifierEtat(etat){
  const unites = new Map(), bats = new Map();
  for(const u of etat.unites || []){ const q = qUnite(u); unites.set(q.id, q); }
  for(const b of etat.batiments || []){ const q = qBatiment(b); bats.set(q.id, q); }
  return {n:(etat.n | 0) & 0xFFFF, unites, bats};
}
const statUnite = (a, b) => a.type === b.type && a.camp === b.camp && a.pvMax === b.pvMax;
const memeUnite = (a, b) => a.x === b.x && a.y === b.y && a.a === b.a && a.at === b.at && a.pv === b.pv && a.dr === b.dr &&
  a.vol === b.vol && a.alt === b.alt && a.vit === b.vit && a.aCh === b.aCh && a.ch === b.ch && a.cs === b.cs &&
  a.tir === b.tir && a.rec === b.rec && a.rep === b.rep;
const statBat = (a, b) => a.type === b.type && a.camp === b.camp && a.pvMax === b.pvMax && a.c === b.c && a.r === b.r;
function memeBat(a, b){
  if(a.pv !== b.pv || a.pr !== b.pr || a.at !== b.at || a.enC !== b.enC || a.bl !== b.bl || a.av !== b.av || a.tir !== b.tir) return false;
  // Extension (galerie, batterie : 20 novembre 2026)
  if(a.x !== b.x || a.gs !== b.gs || a.gf !== b.gf || a.g0 !== b.g0 || a.gn !== b.gn || a.ps !== b.ps || a.pf !== b.pf || a.it !== b.it) return false;
  if(a.ec !== b.ec || a.ek !== b.ek || a.er !== b.er) return false;   // extracteur (26 novembre 2026)
  if(a.file.length !== b.file.length) return false;
  for(let i = 0; i < a.file.length; i++) if(a.file[i] !== b.file[i]) return false;
  if(!a.rally !== !b.rally) return false;
  return !a.rally || (a.rally[0] === b.rally[0] && a.rally[1] === b.rally[1]);
}
const age = (h, tq) => (h >= 0 && tq - h >= 0 && tq - h <= 255) ? tq - h : -1;
const age16 = (h, tq) => (h >= 0 && tq - h >= 0 && tq - h <= 65535) ? tq - h : -1;   // cycle d'une galerie (17,5 s = 875)

function ecrireUnite(w, q, nouveau, tq){
  const at = age(q.tir, tq), ar = age(q.rec, tq), ap = age(q.rep, tq);
  const sp = (q.vol ? 1 : 0) | (q.aCh ? 2 : 0) | (q.cs ? 4 : 0) | (at >= 0 ? 8 : 0) | (ar >= 0 ? 16 : 0) | (ap >= 0 ? 32 : 0);
  w.u16(q.id); w.u16(q.x); w.u16(q.y); w.u8(q.a); w.u8(q.at); w.u8(q.pv);
  w.u8(q.dr | (sp ? 16 : 0) | (nouveau ? 32 : 0));
  if(nouveau){ w.u8(q.type); w.u8(q.camp); w.u16(q.pvMax); }
  if(sp){
    w.u8(sp);
    if(q.vol){ w.u8(q.alt); w.u8(q.vit); }
    if(q.aCh) w.u16(q.ch);
    if(q.cs) w.u16(q.cs);
    if(at >= 0) w.u8(at); if(ar >= 0) w.u8(ar); if(ap >= 0) w.u8(ap);
  }
}
function ecrireBatiment(w, q, nouveau, tq){
  const at = age(q.tir, tq);
  const ag = (q.x & 1) ? age16(q.g0, tq) : -1, ai = (q.x & 2) ? age(q.it, tq) : -1;
  const x = q.x | (ag >= 0 ? 4 : 0) | (ai >= 0 ? 8 : 0);
  const dr = (q.enC ? 1 : 0) | (q.file.length ? 2 : 0) | (q.rally ? 4 : 0) | (at >= 0 ? 8 : 0) | (q.bl ? 16 : 0) | (nouveau ? 32 : 0) | (x ? 64 : 0);
  w.u16(q.id); w.u8(q.pv); w.u8(q.pr); w.u8(q.at); w.u8(dr);
  if(nouveau){ w.u8(q.type); w.u8(q.camp); w.u8(q.c); w.u8(q.r); w.u16(q.pvMax); }
  if(q.file.length){ w.u8(q.file.length); for(const t of q.file) w.u8(t); w.u8(q.av); }
  if(q.rally){ w.u16(q.rally[0]); w.u16(q.rally[1]); }
  if(at >= 0) w.u8(at);
  // Extension (20 novembre 2026), après tous les champs d'avant : voir qBatiment.
  if(x){
    w.u8(x);
    if(x & 1){ w.u8(q.gs); w.u8(q.gf); if(x & 4){ w.u16(ag); w.u8(q.gn); } }
    if(x & 2){ w.u8(q.ps); w.u8(q.pf); if(x & 8) w.u8(ai); }
    if(x & 128){ const av = age(q.er, tq); w.u8(q.ec); if(q.ec & 128) w.u8(q.ek); w.u8(av >= 0 && av < 255 ? av : 255); }   // extracteur (26 novembre 2026)
  }
}

// Cœur de l'encodeur : `q` = état quantifié, `baseQ` = base quantifiée (null → complet).
function encoderQ(etat, q, baseQ, n){
  const temps = +etat.temps || 0, tq = Math.round(temps*50);
  const w = new Ecrivain(2048 + 16*((etat.unites || []).length + (etat.batiments || []).length));
  const camps = (etat.camps || []).slice(0, 255);
  const proj = etat.projectiles || [], eff = etat.effets || [];
  const nP = Math.min(255, proj.length), nE = Math.min(255, eff.length);
  w.u8(PROTO); w.u8(baseQ ? 0 : 1); w.u16(n); w.u32(Math.round(temps*1000)); w.u16(baseQ ? baseQ.n : n);
  // Drapeaux : bits 0-1 troncature des projectiles et effets, bit 2 hôte en pause (etat.pause === true), bit 3 positions
  // à l'échelle large (26 novembre 2026, voir qPos).
  w.u8(camps.length); w.u8((proj.length > 255 ? 1 : 0) | (eff.length > 255 ? 2 : 0) | (etat.pause === true ? 4 : 0) | (echPos === ECHELLE_POS_LARGE ? BIT_POS_LARGE : 0));
  w.u16(0); w.u16(0); w.u16(0); w.u8(nP); w.u8(nE);   // effectifs complétés plus bas
  // Camps
  const pouvoirs = T.pouvoirs;
  for(const c of camps){
    w.u8(indexDe('camps', c.camp)); w.u8((c.elimine ? 1 : 0) | (c.ia ? 2 : 0));
    w.u32(Math.max(0, Math.round(+c.reserves || 0))); w.u16(u16r((+c.points || 0)*100)); w.u8(u8r(c.population));
    for(const cle of pouvoirs) w.u16(u16r(((c.recharges && c.recharges[cle]) || 0)*10));
  }
  // Unités
  let nU = 0;
  for(const u of q.unites.values()){
    const b = baseQ && baseQ.unites.get(u.id);
    const stat = b && statUnite(u, b);
    if(stat && memeUnite(u, b)) continue;
    ecrireUnite(w, u, !stat, tq); nU++;
  }
  // Bâtiments
  let nB = 0;
  for(const bt of q.bats.values()){
    const b = baseQ && baseQ.bats.get(bt.id);
    const stat = b && statBat(bt, b);
    if(stat && memeBat(bt, b)) continue;
    ecrireBatiment(w, bt, !stat, tq); nB++;
  }
  // Supprimés (présents dans la base, absents maintenant)
  let nS = 0;
  if(baseQ){
    for(const id of baseQ.unites.keys()) if(!q.unites.has(id)){ w.u16(id); nS++; }
    for(const id of baseQ.bats.keys()) if(!q.bats.has(id)){ w.u16(id); nS++; }
  }
  // Projectiles nés
  for(let i = 0; i < nP; i++){
    const p = proj[i];
    w.u8(indexDe('projectiles', p.genre)); w.u8(p.arme == null ? 255 : indexDe('armes', p.arme));
    w.u16(qPos(p.sx)); w.u16(qPos(p.sy)); w.u16(qPos(p.tx)); w.u16(qPos(p.ty));
    w.u8(u8r(p.h1)); w.u8(u8r(p.h2)); w.u8(u8r((+p.duree || 0)*50)); w.i8(borne(Math.round((+p.t0 || 0)*100), -128, 127));
    w.u16(p.cible ? (p.cible & 0xFFFF) : 0); w.u8(u8r(p.zone));
  }
  // Effets nés
  for(let i = 0; i < nE; i++){
    const e = eff[i];
    const deux = typeof e.x2 === 'number' && typeof e.y2 === 'number', haut = typeof e.h1 === 'number' || typeof e.h2 === 'number';
    w.u8(indexDe('effets', e.type)); w.u8((deux ? 1 : 0) | (haut ? 2 : 0));
    w.u16(qPos(e.x)); w.u16(qPos(e.y)); w.u16(u16r((+e.duree || 0)*100)); w.u8(u8r(e.p1)); w.u8(u8r(e.p2));
    if(deux){ w.u16(qPos(e.x2)); w.u16(qPos(e.y2)); }
    if(haut){ w.u8(u8r(e.h1)); w.u8(u8r(e.h2)); }
  }
  w.v.setUint16(12, nU, true); w.v.setUint16(14, nB, true); w.v.setUint16(16, nS, true);
  return w.fin();
}

const cacheBases = new WeakMap();
// encoder(etat, base) : base absente → instantané complet ; sinon différences contre `base`,
// un état déjà encodé en complet (il doit porter le même `n` que lors de cet encodage).
function encoder(etat, base){
  if(!T) throw new Error('Codec : appeler Reseau.definirTypes avant d’encoder.');
  echelleEncodeur();
  let bq = null;
  if(base){ bq = cacheBases.get(base); if(!bq){ bq = quantifierEtat(base); cacheBases.set(base, bq); } }
  return encoderQ(etat, quantifierEtat(etat), bq, (etat.n | 0) & 0xFFFF);
}

function lireEntete(octets){
  if(!octets || octets.byteLength < ENTETE) return null;
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  return {proto:v.getUint8(0), complet:v.getUint8(1) === 1, n:v.getUint16(2, true), temps:v.getUint32(4, true)/1000,
    base:v.getUint16(8, true), nbCamps:v.getUint8(10), drapeaux:v.getUint8(11), nbUnites:v.getUint16(12, true),
    nbBatiments:v.getUint16(14, true), nbSupprimes:v.getUint16(16, true), nbProjectiles:v.getUint8(18), nbEffets:v.getUint8(19),
    octets:octets.byteLength};
}

const cacheIndex = new WeakMap();
function indexDecode(r){
  let ix = cacheIndex.get(r);
  if(!ix){ ix = {unites:new Map(r.unites.map(u => [u.id, u])), bats:new Map(r.batiments.map(b => [b.id, b]))}; cacheIndex.set(r, ix); }
  return ix;
}

// decoder(octets, base) : `base` = résultat décodé de l'instantané complet de référence
// (exigé pour une différence). Renvoie l'état COMPLET reconstitué, ou {erreur, n, base}.
function decoder(octets, base){
  if(!T) return {erreur:'types'};
  const E = lireEntete(octets);
  if(!E) return {erreur:'invalide'};
  if(E.proto !== PROTO) return {erreur:'proto', n:E.n};
  let bi = null;
  if(!E.complet){
    if(!base || !base.complet || base.n !== E.base) return {erreur:'base', n:E.n, base:E.base};
    bi = indexDecode(base);
  }
  try{
    echPos = (E.drapeaux & BIT_POS_LARGE) ? ECHELLE_POS_LARGE : ECHELLE_POS;   // échelle annoncée par l'instantané
    const L = new Lecteur(octets); L.p = ENTETE;
    const temps = E.temps;
    const ageVers = a => Math.round((temps - a/50)*1000)/1000;
    const camps = [];
    for(let i = 0; i < E.nbCamps; i++){
      const camp = nomDe('camps', L.u8()), dr = L.u8();
      const c = {camp, elimine:!!(dr & 1), ia:!!(dr & 2), reserves:L.u32(), points:L.u16()/100, population:L.u8(), recharges:{}};
      for(const cle of T.pouvoirs) c.recharges[cle] = L.u16()/10;
      camps.push(c);
    }
    const unites = bi ? new Map(bi.unites) : new Map(), bats = bi ? new Map(bi.bats) : new Map();
    const nouvellesU = [], nouveauxB = [];
    for(let i = 0; i < E.nbUnites; i++){
      const id = L.u16(), x = dPos(L.u16()), y = dPos(L.u16()), angle = dAng(L.u8()), angleT = dAng(L.u8()), fpv = L.u8(), dr = L.u8();
      let type, camp, pvMax;
      if(dr & 32){ type = nomDe('unites', L.u8()); camp = nomDe('camps', L.u8()); pvMax = L.u16(); }
      else { const b = bi && bi.unites.get(id); if(!b) throw new Error('unité ' + id + ' absente de la base'); type = b.type; camp = b.camp; pvMax = b.pvMax; }
      const u = {id, type, camp, x, y, angle, angleT, pv:fpv*pvMax/255, pvMax, auSol:!!(dr & 1), travaille:!!(dr & 2), rang:(dr >> 2) & 3,
        alt:null, vit:null, charge:null, cibleSoin:null, tirT:null, recolteT:null, repareT:null};
      if(dr & 16){
        const sp = L.u8();
        if(sp & 1){ u.alt = L.u8(); u.vit = L.u8()*2; }
        if(sp & 2) u.charge = L.u16()/100;
        if(sp & 4) u.cibleSoin = L.u16();
        if(sp & 8) u.tirT = ageVers(L.u8());
        if(sp & 16) u.recolteT = ageVers(L.u8());
        if(sp & 32) u.repareT = ageVers(L.u8());
      }
      if(!(bi && bi.unites.has(id))) nouvellesU.push(id);
      unites.set(id, u);
    }
    for(let i = 0; i < E.nbBatiments; i++){
      const id = L.u16(), fpv = L.u8(), pr = L.u8(), at = L.u8(), dr = L.u8();
      let type, camp, c, r, pvMax;
      if(dr & 32){ type = nomDe('batiments', L.u8()); camp = nomDe('camps', L.u8()); c = L.u8(); r = L.u8(); pvMax = L.u16(); }
      else { const b = bi && bi.bats.get(id); if(!b) throw new Error('bâtiment ' + id + ' absent de la base'); type = b.type; camp = b.camp; c = b.c; r = b.r; pvMax = b.pvMax; }
      const b = {id, type, camp, c, r, pv:fpv*pvMax/255, pvMax, progres:pr/255, angleT:dAng(at), enCours:!!(dr & 1), bloque:!!(dr & 16),
        file:[], avancement:0, rally:null, tirT:null};
      if(dr & 2){ const nf = L.u8(); for(let k = 0; k < nf; k++) b.file.push(nomDe('unites', L.u8())); b.avancement = L.u8()/255; }
      if(dr & 4) b.rally = {x:dPos(L.u16()), y:dPos(L.u16())};
      if(dr & 8) b.tirT = ageVers(L.u8());
      // Extension (20 novembre 2026) : galerie (b.gal), batterie (b.para, b.intT). Absente : ni l'un ni l'autre.
      if(dr & 64){
        const x = L.u8();
        if(x & 1){
          const s = L.u8(), f = L.u8();
          b.gal = {stock:s & 15, fab:s >> 4, fabT:f, t0:null, n:0, tires:0};
          if(x & 4){ b.gal.t0 = ageVers(L.u16()); const n = L.u8(); b.gal.n = n & 15; b.gal.tires = n >> 4; }
          // Lot B (22 novembre 2026) : posés seulement quand l'un d'eux est vrai (galerie sans lourd : enregistrement d'avant).
          if(x & (16 | 32 | 64)){ b.gal.lourd = x & 16 ? 1 : 0; b.gal.fabLourd = x & 32 ? 1 : 0; b.gal.cycleLourd = (x & 64) !== 0; }
        }
        if(x & 2){
          const s = L.u8(), f = L.u8();
          b.para = {stock:s & 15, fab:s >> 4, fabT:f};
          b.intT = x & 8 ? ageVers(L.u8()) : null;
        }
        // Extracteur (26 novembre 2026) : voir qExtracteur.
        if(x & 128){
          const cap = L.u8(), k = cap & 128 ? L.u8() : 0, rev = L.u8(), ic = cap & 63;
          b.extr = {capture:cap & 128 ? {camp:ic ? nomDe('camps', ic - 1) : null, t:k/20, conteste:(cap & 64) !== 0} : null, versementT:rev === 255 ? null : ageVers(rev)};
        }
      }
      if(!(bi && bi.bats.has(id))) nouveauxB.push(id);
      bats.set(id, b);
    }
    const supprimes = [];
    for(let i = 0; i < E.nbSupprimes; i++){ const id = L.u16(); supprimes.push(id); unites.delete(id); bats.delete(id); }
    const projectiles = [];
    for(let i = 0; i < E.nbProjectiles; i++){
      const genre = nomDe('projectiles', L.u8()), ia = L.u8();
      const p = {genre, arme:ia === 255 ? null : nomDe('armes', ia), sx:dPos(L.u16()), sy:dPos(L.u16()), tx:dPos(L.u16()), ty:dPos(L.u16()),
        h1:L.u8(), h2:L.u8(), duree:L.u8()/50, t0:L.i8()/100, cible:L.u16() || null, zone:L.u8()};
      projectiles.push(p);
    }
    const effets = [];
    for(let i = 0; i < E.nbEffets; i++){
      const type = nomDe('effets', L.u8()), dr = L.u8();
      const e = {type, x:dPos(L.u16()), y:dPos(L.u16()), duree:L.u16()/100, p1:L.u8(), p2:L.u8(), x2:null, y2:null, h1:null, h2:null};
      if(dr & 1){ e.x2 = dPos(L.u16()); e.y2 = dPos(L.u16()); }
      if(dr & 2){ e.h1 = L.u8(); e.h2 = L.u8(); }
      effets.push(e);
    }
    if(L.p !== L.n) return {erreur:'invalide', n:E.n};
    const r = {n:E.n, complet:E.complet, base:E.base, temps, camps, unites:[...unites.values()], batiments:[...bats.values()],
      supprimes, nouveaux:nouvellesU.concat(nouveauxB), projectiles, effets, tronque:!!(E.drapeaux & 3), pause:!!(E.drapeaux & 4), octets:E.octets};
    if(E.complet) cacheIndex.set(r, {unites, bats});
    return r;
  }catch(e){
    return {erreur:'invalide', n:E.n, detail:e.message};
  }
}

const plusRecent = (a, b) => { const d = (a - b) & 0xFFFF; return d !== 0 && d < 0x8000; };

// Émetteur (côté hôte) : numérote, choisit complet ou différences, garde la base.
function creerEmetteur(opts = {}){
  const periode = opts.periodeCompletMs != null ? opts.periodeCompletMs : REGLAGES.periodeCompletMs;
  let n = 0, baseQ = null, dernierComplet = -1e12, demande = true;
  return {
    emettre(etat, {complet: forcer = false} = {}){
      if(!T) throw new Error('Codec : appeler Reseau.definirTypes avant d’encoder.');
      n = (n + 1) & 0xFFFF; if(n === 0) n = 1;
      const t = maintenant();
      const complet = forcer || demande || !baseQ || t - dernierComplet >= periode;
      echelleEncodeur();
      const q = quantifierEtat(etat);
      const octets = encoderQ(etat, q, complet ? null : baseQ, n);
      if(complet){ q.n = n; baseQ = q; dernierComplet = t; demande = false; }
      return {octets, complet, n};
    },
    demanderComplet(){ demande = true; },
    get completDemande(){ return demande; },   // vrai : le prochain envoi sera complet (accueil, retour, demande d'un invité)
    get n(){ return n; },
  };
}

// Récepteur (côté invité) : ordre, pertes, bases, entités disparues.
function creerRecepteur(){
  const bases = new Map();
  let dernier = null;
  const stats = {recus:0, appliques:0, complets:0, anciens:0, sansBase:0, invalides:0, trous:0};
  const garder = r => { bases.set(r.n, r); while(bases.size > 3) bases.delete(bases.keys().next().value); };
  return {
    // {forcer:true} (resynchronisation, complet seulement) : accepté même s'il paraît plus ancien que le dernier
    // appliqué ; les bases connues sont oubliées.
    recevoir(octets, opts){
      stats.recus++;
      const forcer = !!(opts && opts.forcer);
      const E = lireEntete(octets);
      if(!E || E.proto !== PROTO || (forcer && !E.complet)){ stats.invalides++; return {ignore:'invalide'}; }
      if(forcer) bases.clear();
      if(dernier && !forcer && !plusRecent(E.n, dernier.n)){
        // Trop ancien pour être appliqué ; un complet plus récent que nos bases reste utile.
        if(E.complet && !bases.has(E.n)){
          let plusNeuf = true; for(const k of bases.keys()) if(!plusRecent(E.n, k)) plusNeuf = false;
          if(plusNeuf){ const r = decoder(octets, null); if(!r.erreur) garder(r); }
        }
        stats.anciens++; return {ignore:'ancien', n:E.n};
      }
      const r = decoder(octets, E.complet ? null : (bases.get(E.base) || null));
      if(r.erreur === 'base'){ stats.sansBase++; return {ignore:'sansBase', n:E.n, demandeComplet:true}; }
      if(r.erreur){ stats.invalides++; return {ignore:'invalide', n:E.n, detail:r.detail}; }
      if(r.complet){ garder(r); stats.complets++; }
      if(dernier && !forcer){ const ecart = (E.n - dernier.n) & 0xFFFF; if(ecart > 1) stats.trous += ecart - 1; }
      // Entités disparues depuis le dernier état appliqué (mortes), et apparues.
      const avant = dernier ? indexDecode(dernier) : null;
      const ix = indexDecode(r);
      r.disparus = []; r.apparus = [];
      if(avant){
        for(const id of avant.unites.keys()) if(!ix.unites.has(id)) r.disparus.push(id);
        for(const id of avant.bats.keys()) if(!ix.bats.has(id)) r.disparus.push(id);
        for(const id of ix.unites.keys()) if(!avant.unites.has(id)) r.apparus.push(id);
        for(const id of ix.bats.keys()) if(!avant.bats.has(id)) r.apparus.push(id);
      } else { r.apparus = [...ix.unites.keys(), ...ix.bats.keys()]; }
      dernier = r; stats.appliques++;
      return {etat:r};
    },
    get dernier(){ return dernier; },
    stats,
  };
}

// -------------------------------------------------------------------------------------
// 6. Salon côté hôte
// -------------------------------------------------------------------------------------
const TYPES_SIEGE = ['humain', 'ordinateur', 'ferme'];
const CHAMPS_OCCUPANT = ['id', 'jeton', 'pseudo', 'pret', 'presence', 'dernierVie', 'horsLigneDepuis', 'rtt', 'seau', 'dernierOrdre', 'dernierCtl', 'motifHorsLigne', 'dernierRattrapage', 'derniereDemande', 'willT',
  'viesVues', 'presVues', 'recalageT', 'doublons', 'cle'];
const EMPLACEMENTS_DEFAUT = [
  {camp:'J', equipe:1, type:'humain'}, {camp:'I', equipe:2, type:'humain'},
  {camp:'K', equipe:3, type:'ferme'},  {camp:'L', equipe:4, type:'ferme'},
];
// `anciennes` (hôte) : la clé de siège de l'occupant qui s'en va y est gardée, pour son retour ou pour lui répondre
// « refus ». Aucune n'est oubliée (voir REGLAGES.anciennesClesMax : c'est l'arrivée de nouveaux venus qui est bornée).
function viderOccupant(s, anciennes){
  if(anciennes && s.id && s.cle){ anciennes.delete(s.id); anciennes.set(s.id, s.cle); }
  s.cle = null; s.id = null; s.jeton = null; s.pseudo = null; s.pret = false; s.presence = null; s.dernierVie = 0; s.horsLigneDepuis = 0; s.rtt = null; s.seau = null; s.dernierOrdre = 0; s.dernierCtl = 0; s.motifHorsLigne = null; s.dernierRattrapage = 0; s.derniereDemande = 0; s.willT = 0; s.viesVues = []; s.presVues = []; s.recalageT = 0; s.doublons = 0; }

async function creerSalon(options = {}){
  const o = Object.assign({}, options);
  let code;
  if(o.code){ const nc = normaliserCode(o.code); if(nc.erreur) throw erreurReseau('code', nc.erreur); code = nc.code; }
  else code = tirer(6, ALPHABET);
  const {racine:R, cle:cleSalon} = await deriverSalon(code), S = sujetsDe(R);
  const paire = await nouvellePaire();
  // Dernière volonté scellée AVANT l'ouverture du transport (elle est fixée à la connexion), genre 1.
  const c0 = Date.now();
  const will = {sujet:S.salon, donnees:sceller(cleSalon, 'h/salon', JSON.stringify({proto:PROTO, etat:'ferme', will:true}), c0, 1)};
  const etape = signaleur(o.etape);
  const transport = await ouvrirTransport(o, will, etape);
  etape({etape:'salon', serveur:transport.serveur.nom});
  const salon = new SalonHote(code, R, S, new Canal(transport, R, cleSalon, c0), o, {cleSalon, paire});
  await salon._demarrer();
  return salon;
}

class SalonHote extends Diffuseur {
  constructor(code, R, S, transport, o, secrets){
    super();
    this.role = 'hote'; this.code = code; this.codeAffiche = formaterCode(code);
    this.R = R; this.S = S; this.transport = transport; this.serveur = transport.serveur; this.o = o;
    // Clés (jamais publiées) : clé de salon, paire ECDH de l'hôte (sa clé publique figure dans la description).
    this.cleSalon = secrets.cleSalon; this.paire = secrets.paire; this.clePub = secrets.paire.pub;
    this.anciennesCles = new Map();                // identifiant → clé de siège d'un invité parti (jamais oubliée)
    this._fileArrivees = []; this._idsEnAttente = new Set(); this._arriveesEnCours = false; this._descCompteur = -1;
    transport.cles = (rel, genre) => this._clesPour(rel, genre);
    this.id = nouvelId(); this.versionJeu = String(o.versionJeu == null ? '' : o.versionJeu);
    this.carte = o.carte == null ? null : o.carte; this.empreinte = o.empreinteCarte == null ? null : o.empreinteCarte;
    this.etat = 'ouvert'; this.ferme = false; this.debut = null;
    // (26 novembre 2026, grande carte en ligne : 8 emplacements au plus, 4 jusque-là ; un emplacement humain au-delà
    // du quatrième est refusé, comme tout le salon : l'hôte ne peut pas ouvrir plus de quatre places humaines.)
    const empl = (o.emplacements || EMPLACEMENTS_DEFAUT).slice(0, REGLAGES.siegesMax);
    if(empl.length < 2) throw erreurReseau('config', 'Il faut au moins deux emplacements.');
    if(empl.some((e, i) => e && e.type === 'humain' && i >= REGLAGES.humainsMax)) throw erreurReseau('config', 'Quatre places de joueur au plus (les places 5 à 8 sont des ordinateurs ou fermées).');
    this.sieges = empl.map((e, i) => { const s = {index:i, camp:String(e.camp), equipe:(e.equipe | 0) || (i + 1),
      type:TYPES_SIEGE.includes(e.type) ? e.type : 'ferme', faction:e.faction == null ? null : e.faction, niveau:e.niveau == null ? null : e.niveau, hote:false};
      viderOccupant(s); return s; });
    const ih = o.siegeHote | 0, h = this.sieges[ih];
    if(!h || ih >= REGLAGES.humainsMax) throw erreurReseau('config', 'Siège de l’hôte inexistant.');
    Object.assign(h, {type:'humain', hote:true, id:this.id, pseudo:nettoyerPseudo(o.pseudonyme) || 'Hôte', pret:true, presence:'la'});
    this.siege = ih; this.camp = h.camp;
    this.vus = new Set(); this.expulses = new Set(); this.confies = new Set();
    this.assis = new Set();                        // identifiants qui ont réellement occupé un siège (nettoyés à la fermeture)
    this.seauArrivees = nouveauSeau(REGLAGES.arriveesParSeconde);
    this.evtS = 0; this.evts = [];
    this.emetteur = creerEmetteur({periodeCompletMs:o.periodeCompletMs});
    this.dernierInst = null;                       // {n, temps} du dernier instantané envoyé (donné à l'accueil)
    this.stats = {ordres:{recus:0, acceptes:0, rejets:{}}, instantanes:{envoyes:0, complets:0, octets:0}, evenements:0,
      ignores:{}, descriptionsEcrasees:0};
    this._arrets = []; this._descEnAttente = false; this._decoDepuis = 0; this._descOctets = null; this._republieT = 0;
  }
  _ignorer(genre){ this.stats.ignores[genre] = (this.stats.ignores[genre] || 0) + 1; }
  _noterVu(id){ this.vus.delete(id); this.vus.add(id); while(this.vus.size > REGLAGES.vusMax) this.vus.delete(this.vus.values().next().value); }
  _noterAssis(id){ this.assis.add(id); if(this.assis.size > 32) this.assis.delete(this.assis.values().next().value); }
  // Vrai quand le prochain instantané sera complet : le jeu doit alors en envoyer un même si son temps n'avance pas
  // (pause, fin de partie), sinon un invité arrivé ou rechargé à ce moment reste sans monde.
  get completDemande(){ return !this.ferme && this.emetteur.completDemande; }
  _demanderComplet(){ const avant = this.emetteur.completDemande; this.emetteur.demanderComplet(); if(!avant) this._emettre('completDemande', {}); }
  _preuve(s){ return s && s.jeton ? s.jeton.slice(0, 8) : null; }
  async _demarrer(){
    const T = this.transport;
    T.on('message', m => this._recevoir(m));
    // Description conservée remplacée par un message sans sceau valable (forgé, effacé, rejoué) : republiée.
    T.on('invalide', d => { if(!this.ferme && d.sujet === this.S.salon) this._descEcrasee(); });
    T.on('deconnecte', () => { this._decoDepuis = maintenant(); this._emettre('deconnecte', {}); });
    T.on('reconnecte', () => {
      this._decoDepuis = 0;
      // Pendant MA coupure, aucun invité n'a pu se faire entendre : leur silence repart de maintenant (septième tour :
      // une coupure de 6 s de l'hôte faisait annoncer à tous le faux départ d'un invité, puis son « retour »).
      const t = maintenant(); for(const s of this.sieges) if(s.id && !s.hote && s.presence === 'la') s.dernierVie = t;
      this._publierDescription(true);           // la dernière volonté a pu la remplacer
      this._demanderComplet();
      this._emettre('reconnecte', {});
    });
    // L'hôte écoute aussi sa propre description conservée : si quelqu'un l'écrase, il la republie.
    await T.abonner([this.S.tousInvites, this.S.salon]);
    await this._publierDescription(true);
    this._arrets.push(minuteur(500, () => this._surveiller()));
    this._arrets.push(minuteur(REGLAGES.battementMs, () => { if(!this.ferme) T.publier(this.S.vieH, new Uint8Array([1]), {qos:0}); }));
    journal('salon ' + this.codeAffiche + ' créé sur ' + this.serveur.url);
  }

  // --- Description publique (message conservé) ---
  // `srv` : adresse du serveur où vit ce salon (septième tour, 15 novembre 2026). Le sceau couvre le sujet, pas le
  // serveur : un inconnu recopiait telle quelle cette description conservée sur l'autre serveur public, et un joueur
  // qui tapait le code à la main (recherche sur les deux serveurs) pouvait s'y installer, là où l'hôte n'est pas.
  description(){
    return {proto:PROTO, jeu:this.versionJeu, carte:this.carte, empreinte:this.empreinte, etat:this.etat, extra:this.o.extra == null ? null : this.o.extra, cle:this.clePub,
      srv:this.serveur && typeof this.serveur.url === 'string' ? this.serveur.url : null,
      emplacements:this.sieges.map(s => ({index:s.index, camp:s.camp, equipe:s.equipe, type:s.type, faction:s.faction, niveau:s.niveau,
        pseudo:s.id ? s.pseudo : null, pret:!!s.pret, occupe:!!s.id, enLigne:s.id ? s.presence === 'la' : null, hote:!!s.hote, confie:!!s.confie}))};
  }
  _publierDescription(immediat){
    if(this.ferme) return Promise.resolve();
    const faire = () => { this._descEnAttente = false; if(this.ferme) return Promise.resolve(false);
      const d = this.description(); this._emettre('sieges', d);
      this._descOctets = ENC.encode(JSON.stringify(d));
      const p = this.transport.publier(this.S.salon, this._descOctets, {qos:1, retenir:true});
      this._descCompteur = this.transport.dernierCompteur;   // l'écho de la nôtre porte ce compteur
      return p; };
    if(immediat) return faire();
    if(!this._descEnAttente){ this._descEnAttente = true; setTimeout(faire, 30); }
    return Promise.resolve();
  }
  listeSieges(){
    const t = maintenant();
    return this.sieges.map(s => ({index:s.index, camp:s.camp, equipe:s.equipe, type:s.type, faction:s.faction, niveau:s.niveau, hote:!!s.hote,
      id:s.id, pseudo:s.pseudo, pret:!!s.pret, presence:s.presence, rtt:s.rtt, horsLigneDepuisMs:s.horsLigneDepuis ? t - s.horsLigneDepuis : 0, confie:!!s.confie}));
  }
  // Siège d'un invité (jamais celui de l'hôte, qui n'a pas de jeton : un message forgé à son nom est ignoré).
  _siegeDe(id){ for(const s of this.sieges) if(s.id === id && !s.hote) return s.index; return -1; }
  _info(s){ return {siege:s.index, camp:s.camp, equipe:s.equipe, pseudo:s.pseudo, id:s.id}; }
  // Message privé ; s'il s'adresse à un siège occupé, il porte la preuve du jeton (exigée par l'invité une fois entré)
  // et il est scellé avec la clé de siège. `mode` : 'salon' (accueil qui répond au premier « la » d'un identifiant
  // inconnu) ; 'ancienne' (identifiant non assis dont l'hôte garde la clé de siège passée, et qui s'est présenté avec
  // elle : refus scellé avec elle, qu'aucun autre détenteur du code ne peut forger) ; sinon clé de siège, et à défaut
  // clé de salon (refus à un identifiant inconnu).
  _prive(id, obj, mode){
    const i = this._siegeDe(id), s = i >= 0 ? this.sieges[i] : null, p = s ? this._preuve(s) : null;
    const cle = mode === 'salon' ? this.cleSalon : s && s.cle ? s.cle : (mode === 'ancienne' && this.anciennesCles.get(id)) || this.cleSalon;
    return this.transport.publier(this.S.prive(id), JSON.stringify(p ? Object.assign({preuve:p}, obj) : obj), {qos:1, cle});
  }
  // Clé publique ECDH du « la » auquel on répond (recopiée dans l'accueil et le refus : champ `pour`). La paire de
  // l'invité est neuve à chaque arrivée : un accueil ou un refus capté lors d'une arrivée passée ne vaut plus rien.
  _pour(p){ return p && typeof p.cp === 'string' && RE_CLE_PUB.test(p.cp) ? p.cp : null; }
  // Clés attendues pour un message reçu (choisies avant toute lecture du contenu ; `genre` : octet lu dans
  // l'enveloppe, couvert par le sceau). Identifiant assis : sa clé de siège seulement, sauf sa dernière volonté (clé
  // de salon). Identifiant non assis : présence à la clé de salon (premier « la ») ou à sa clé de siège passée ;
  // demande (ctl) à sa clé passée seulement (pour lui répondre « refus »). Tout le reste est jeté.
  _clesPour(rel, genre){
    const sal = {nom:'salon', cle:this.cleSalon};
    if(rel === 'h/salon') return [sal];
    if(!rel.startsWith('j/')) return [];
    const p = rel.split('/');
    if(p.length !== 3 || !ID_RE.test(p[1]) || p[1] === this.id) return [];
    const id = p[1], g = p[2], i = this._siegeDe(id);
    if(i >= 0){
      if(genre === 1) return g === 'pres' ? [sal] : [];
      const c = this.sieges[i].cle; return c ? [{nom:'siege', cle:c}] : [];
    }
    // Identifiant dont l'hôte garde la clé passée : sa présence n'est plus acceptée qu'avec elle (cinquième tour : un
    // détenteur du code prenait, à la clé de salon, l'identifiant d'un invité parti et lui volait son retour).
    const a = this.anciennesCles.get(id), anc = a ? [{nom:'ancienne', cle:a}] : [];
    if(g === 'pres') return genre === 1 ? [sal] : a ? anc : [sal];
    if(g === 'ctl' && genre === 0) return anc;
    return [];
  }
  _descRecue(m){
    if(this.ferme || !this._descOctets) return;
    if(m.genre === 0 && m.compteur === this._descCompteur) return;      // la nôtre
    this._descEcrasee();
  }
  _descEcrasee(){
    if(this.ferme || !this._descOctets) return;
    this.stats.descriptionsEcrasees++;
    const t = maintenant(), attente = 1000 - (t - this._republieT);
    if(attente > 0){ if(!this._republieEnAttente){ this._republieEnAttente = true; setTimeout(() => { this._republieEnAttente = false; this._republieT = maintenant(); this._publierDescription(true); }, attente); } return; }
    this._republieT = t; this._publierDescription(true);
  }
  _rejet(motif, idx){
    this.stats.ordres.rejets[motif] = (this.stats.ordres.rejets[motif] || 0) + 1;
    journal('rejet : ' + motif + (idx >= 0 ? ' (siège ' + idx + ')' : ''));
    this._emettre('ordreRejete', {siege:idx == null ? -1 : idx, motif});
  }

  // --- Réception ---
  _recevoir(m){
    try{ this._recevoir1(m); }catch(e){ this._ignorer('exception'); journal('exception à la réception : ' + (e && e.message)); }
  }
  // `m` : message authentique remis par le canal {sujet, octets (corps), conserve, genre, cle, compteur}.
  _recevoir1(m){
    if(this.ferme) return;
    const sujet = m.sujet;
    if(sujet === this.S.salon) return this._descRecue(m);
    if(!sujet.startsWith(this.R + 'j/')) return;
    const p = sujet.slice(this.R.length + 2).split('/');
    if(p.length !== 2 || !ID_RE.test(p[0])) return this._rejet('sujet', -1);
    const [id, genre] = p;
    if(genre === 'pres') return this._pres(id, m);
    if(m.genre !== 0) return;
    if(genre === 'ordres') return this._ordre(id, m);
    if(genre === 'ctl') return this._ctl(id, m);
    if(genre === 'vie') return this._vie(id, m.octets);
    this._rejet('sujet', -1);
  }
  _pres(id, m){
    const octets = m.octets, conserve = m.conserve;
    if(octets.length > REGLAGES.taillePresMax) return this._rejet('taille', -1);
    const idx = this._siegeDe(id);
    // (Une présence vide, effacement d'un message conservé, n'arrive plus ici : le canal la jette.)
    const p = lireJson(octets);
    if(!estObjet(p)) return this._rejet('format', idx);
    const s = idx >= 0 ? this.sieges[idx] : null;
    // Dernière volonté (genre 1, clé de salon, compteur ancien) : seulement « parti », confirmé par le silence de son
    // auteur (_surveiller). Rien d'autre : un invité qui a le code peut en forger une.
    if(m.genre === 1){ if(s && p.etat === 'parti' && !s.willT) s.willT = maintenant(); return; }
    const preuveOk = !!s && typeof p.preuve === 'string' && p.preuve === this._preuve(s);
    if(p.etat === 'parti'){
      if(!s) return;
      // Avec preuve : compteur neuf exigé (un « parti » capté puis republié est ignoré).
      if(preuveOk){ if(!compteurNeuf(s.presVues, p.c)) return this._rejet('rejeu', idx); return this._horsLigne(idx, 'volontaire'); }
      // Sans preuve : confirmé par _surveiller si aucun battement valable n'arrive pendant REGLAGES.confirmationWillMs.
      if(!s.willT) s.willT = maintenant();
      return;
    }
    if(p.etat !== 'la') return this._rejet('format', idx);
    if(s){
      if(conserve && s.presence === 'la') return;            // redélivrance après réabonnement
      if(!preuveOk) return this._rejet('preuve', idx);       // siège occupé : seul son titulaire peut s'y présenter
      // Présence captée puis republiée (pour tenir « présent » un absent) : compteur déjà vu ou trop ancien, refusée.
      if(!compteurNeuf(s.presVues, p.c)) return this._rejet('rejeu', idx);
      const revenu = s.presence !== 'la';
      s.presence = 'la'; s.horsLigneDepuis = 0; s.motifHorsLigne = null; s.dernierVie = maintenant(); s.willT = 0;
      this._accueillir(idx, p);
      if(revenu){ this._emettre('retour', this._info(s)); this._evtPresence(s, 'la'); this._publierDescription(); }
      return;
    }
    // Identifiant inconnu (présence scellée avec la clé de salon, ou avec sa clé de siège passée).
    // Clé de salon pour un identifiant dont l'hôte garde la clé passée : refusée sans réponse (déjà jetée par le canal).
    if(m.cle !== 'ancienne' && this.anciennesCles.has(id)){ this._ignorer('clePassee'); return; }
    if(conserve && this.vus.has(id)) return;
    if(this._idsEnAttente.has(id)){ this._ignorer('arriveeEnCours'); return; }   // même identifiant déjà en cours de dérivation
    if(!prendre(this.seauArrivees)){ this._ignorer('arrivees'); return; }   // trop d'arrivées : ignorées sans réponse
    this._noterVu(id);
    // Présence scellée avec sa clé passée : l'invité revient avec elle (mémoire du siège). Refus et accueil sont
    // scellés avec cette clé, qu'il est seul à partager avec l'hôte (il n'accepte plus d'accueil à la clé de salon).
    const ancienne = m.cle === 'ancienne' ? this.anciennesCles.get(id) || null : null;
    if(this._refuserArrivee(id, p, !!ancienne)) return;
    if(typeof p.cp !== 'string' || !RE_CLE_PUB.test(p.cp)){ this._ignorer('clePublique'); return; }
    // Place possible : clé de siège à dériver (ECDH, asynchrone), ou clé passée reprise. Arrivées traitées l'une après l'autre.
    this._idsEnAttente.add(id);
    this._fileArrivees.push({id, p, ancienne});
    this._traiterArrivees().catch(e => { this._ignorer('exception'); journal('arrivée : ' + (e && e.message)); });
  }
  _motifArrivee(id, p, parAncienne){
    if(p.proto !== PROTO || String(p.jeu) !== this.versionJeu) return 'version';
    if(this.expulses.has(id)) return 'expulse';
    if(this.confies.has(id)) return 'confie';
    if(this.etat !== 'ouvert') return 'commencee';
    if(!this.sieges.some(s => s.type === 'humain' && !s.id)) return 'plein';
    // Table des clés passées pleine (des milliers d'entrées et de sorties : salon attaqué) : plus de nouveau venu,
    // plutôt que d'oublier la clé d'un invité parti. Celui qui revient avec sa clé passée entre toujours.
    if(!parAncienne && this.anciennesCles.size >= REGLAGES.anciennesClesMax){ this._ignorer('memoirePleine'); return 'plein'; }
    return null;
  }
  _refuserArrivee(id, p, parAncienne){
    const motif = this._motifArrivee(id, p, parAncienne); if(!motif) return false;
    // Clé de salon (identifiant inconnu), ou sa clé passée s'il s'est présenté avec elle.
    this._prive(id, {t:'refus', motif, jeu:this.versionJeu, proto:PROTO, pour:this._pour(p)}, parAncienne ? 'ancienne' : undefined);
    journal('refus ' + motif + ' pour ' + id);
    this._emettre('refus', {id, motif});
    return true;
  }
  async _traiterArrivees(){
    if(this._arriveesEnCours) return;
    this._arriveesEnCours = true;
    try{
      while(this._fileArrivees.length && !this.ferme){
        const {id, p, ancienne} = this._fileArrivees.shift();
        let cle = null;
        try{ cle = ancienne || await deriverSiege(this.cleSalon, id, this.paire.prive, p.cp); }catch(e){ cle = null; }
        this._idsEnAttente.delete(id);
        if(this.ferme) break;
        if(!cle){ this._ignorer('clePublique'); continue; }
        // L'état a pu changer pendant l'attente : tout est revérifié.
        if(this._siegeDe(id) >= 0){ this._ignorer('arriveeEnCours'); continue; }
        if(this._refuserArrivee(id, p, !!ancienne)) continue;
        const libre = this.sieges.find(s => s.type === 'humain' && !s.id);
        Object.assign(libre, {id, cle, jeton:nouveauJeton(), pseudo:nettoyerPseudo(p.nom) || ('Joueur ' + (libre.index + 1)), pret:false, presence:'la',
          dernierVie:maintenant(), horsLigneDepuis:0, seau:nouveauSeau(REGLAGES.ordresParSeconde), dernierOrdre:0, dernierCtl:0, willT:0,
          viesVues:[], presVues:Number.isSafeInteger(p.c) && p.c > 0 ? [p.c] : [], recalageT:0, doublons:0});
        this.anciennesCles.delete(id);
        this._noterAssis(id);
        this._accueillir(libre.index, p, !ancienne);   // clé passée reprise : accueil scellé avec elle (clé du siège)
        journal('arrivée de ' + id + ' au siège ' + libre.index);
        this._emettre('arrivee', this._info(libre));
        this._publierDescription();
      }
    }finally{ this._arriveesEnCours = false; }
  }
  _accueillir(idx, p, parSalon){
    const s = this.sieges[idx];
    // dernierOrdre, dernierCtl : derniers numéros acceptés pour ce siège ; l'invité (nouvel onglet, horloge reculée)
    // repart au-delà, sinon tous ses ordres seraient jetés comme doublons (défaut des deux onglets).
    // cle : clé publique ECDH de l'hôte (l'invité nouveau en tire sa clé de siège).
    this._prive(s.id, {t:'accueil', siege:idx, camp:s.camp, equipe:s.equipe, jeton:s.jeton, dernierEvt:this.evtS,
      description:this.description(), debut:this.etat === 'en-partie' ? this.debut : null, inst:this.dernierInst,
      dernierOrdre:s.dernierOrdre || 0, dernierCtl:s.dernierCtl || 0, cle:this.clePub, pour:this._pour(p)}, parSalon ? 'salon' : undefined);
    if(this.etat === 'en-partie'){
      if(Number.isSafeInteger(p.dernierEvt) && p.dernierEvt >= 0 && p.dernierEvt < this.evtS) this._rattrapage(s, p.dernierEvt);
      this._demanderComplet();
    }
  }
  _rattrapage(s, depuis){
    const evts = this.evts.filter(e => e.s > depuis).map(e => e.m);
    const incomplet = this.evts.length > 0 && this.evts[0].s > depuis + 1;
    s.dernierRattrapage = maintenant();
    this._prive(s.id, {t:'rattrapage', evts, incomplet, dernier:this.evtS});   // dernier : sert à l'invité à jeter les faux
  }
  _evtPresence(s, etat){ this.envoyerEvenement('presence', {siege:s.index, camp:s.camp, etat}); }
  _horsLigne(idx, motif){
    const s = this.sieges[idx]; if(!s || s.hote) return;
    if(this.etat === 'ouvert'){                      // dans le salon : la place est libérée
      const info = this._info(s); viderOccupant(s, this.anciennesCles);
      this._emettre('depart', Object.assign(info, {motif, libere:true}));
      this._publierDescription(); return;
    }
    if(s.presence !== 'la'){ if(motif !== 'silence') s.motifHorsLigne = motif; return; }
    s.presence = motif === 'silence' ? 'injoignable' : 'parti'; s.motifHorsLigne = motif;
    if(!s.horsLigneDepuis) s.horsLigneDepuis = maintenant();
    journal('départ du siège ' + idx + ' (' + motif + ')');
    this._emettre('depart', Object.assign(this._info(s), {motif, libere:false}));
    this._evtPresence(s, s.presence);
    this._publierDescription();
  }
  _confier(idx){
    const s = this.sieges[idx]; if(!s.id) return;
    this.confies.add(s.id);
    this._prive(s.id, {t:'refus', motif:'confie'});
    const info = this._info(s);
    viderOccupant(s, this.anciennesCles); s.type = 'ordinateur'; s.confie = true;
    journal('camp ' + s.camp + ' confié à l’ordinateur');
    this._emettre('campConfie', info);
    this.envoyerEvenement('campConfie', {siege:idx, camp:s.camp});
    this._publierDescription();
  }
  _surveiller(){
    if(this.ferme) return;
    const t = maintenant();
    for(const s of this.sieges){
      if(s.hote || !s.id) continue;
      // « parti » sans preuve, confirmé par l'absence de tout battement valable depuis : départ daté de sa réception.
      if(s.willT && t - s.willT >= REGLAGES.confirmationWillMs){
        const w = s.willT; s.willT = 0;
        // Un battement encore en route au moment de la dernière volonté (moins d'une demi-période après) ne compte pas.
        if(s.dernierVie < w + REGLAGES.battementMs/2){ if(this.etat === 'en-partie' && s.presence === 'la') s.horsLigneDepuis = w; this._horsLigne(s.index, 'will'); continue; }
      }
      // (Pas pendant ma propre coupure : je n'entends alors personne.)
      if(!this._decoDepuis && s.presence === 'la' && t - s.dernierVie > REGLAGES.silenceInjoignableMs) this._horsLigne(s.index, 'silence');
      if(this.etat === 'en-partie' && s.presence !== 'la' && s.horsLigneDepuis && t - s.horsLigneDepuis >= REGLAGES.delaiConfieMs) this._confier(s.index);
    }
    if(this._decoDepuis && t - this._decoDepuis > REGLAGES.hoteAbandonMs){
      this._emettre('fin', {motif:'coupure', message:MESSAGES.coupure}); this.fermer();
    }
  }
  _vie(id, octets){
    const idx = this._siegeDe(id); if(idx < 0) return;
    if(octets.length !== 22) return this._rejet('format', idx);
    const s = this.sieges[idx], v = new DataView(octets.buffer, octets.byteOffset, 22);
    // Octets 10-13 : les 4 premiers octets du jeton du siège (preuve). Sans elle, le battement est ignoré.
    if(v.getUint32(10, false) !== parseInt(s.jeton.slice(0, 8), 16)) return this._rejet('preuve', idx);
    // Octets 14-21 : compteur strictement neuf (refus du rejeu : un battement capté puis republié tel quel ne tient
    // plus « présent » un invité parti).
    if(!compteurNeuf(s.viesVues, v.getFloat64(14, true))) return this._rejet('rejeu', idx);
    s.dernierVie = maintenant();
    const rtt = v.getUint16(8, true); s.rtt = rtt === 0xFFFF ? null : rtt;
    if((v.getUint8(2) & 1) && s.dernierVie - s.derniereDemande > 500){ s.derniereDemande = s.dernierVie; this._demanderComplet(); }
    this.transport.publier(this.S.pong(id), octets.slice(4, 8), {qos:0, cle:s.cle});
    if(s.presence !== 'la' && this.etat === 'en-partie'){
      s.presence = 'la'; s.horsLigneDepuis = 0; s.motifHorsLigne = null;
      this._emettre('retour', this._info(s)); this._evtPresence(s, 'la'); this._publierDescription();
    }
  }
  _ordre(id, msg){
    this.stats.ordres.recus++;
    const idx = this._siegeDe(id), octets = msg.octets;
    if(idx < 0) return this._rejet('inconnu', -1);
    if(octets.length > REGLAGES.tailleOrdreMax) return this._rejet('taille', idx);
    const m = lireJson(octets);
    if(!m || typeof m !== 'object' || Array.isArray(m)) return this._rejet('format', idx);
    const s = this.sieges[idx];
    if(m.j !== s.jeton) return this._rejet('jeton', idx);
    if(!Number.isSafeInteger(m.s)) return this._rejet('format', idx);
    // Numéro aberrant : plus de 12 h d'avance sur le compteur d'enveloppe du même message, c'est-à-dire sur
    // l'horloge de l'invité (jamais sur celle de l'hôte : une horloge mal réglée ne doit pas faire refuser un joueur
    // honnête). Rejeté sans être retenu. L'invité accepte tout recalage jusqu'à son compteur + 12 h : même borne.
    if(m.s > msg.compteur + REGLAGES.recalageMaxMs) return this._rejet('format', idx);
    if(m.s <= s.dernierOrdre){
      // Doublon (ou numérotation en retard : second onglet, horloge reculée) : compté, et l'invité est recalé au-delà
      // du dernier numéro accepté, sinon tous ses ordres suivants seraient jetés sans qu'il le sache.
      this.stats.ordres.rejets.doublon = (this.stats.ordres.rejets.doublon || 0) + 1; s.doublons++;
      this._emettre('ordreRejete', {siege:idx, motif:'doublon'});
      return this._recaler(s);
    }
    if(this.etat !== 'en-partie') return this._rejet('pasEnPartie', idx);
    if(!prendre(s.seau)) return this._rejet('debit', idx);
    const ordre = validerOrdre(m, this.o.typesOrdres || REGLAGES.typesOrdres);
    if(typeof ordre === 'string') return this._rejet(ordre, idx);
    s.dernierOrdre = m.s;                          // retenu seulement une fois l'ordre accepté
    this.stats.ordres.acceptes++;
    this._emettre('ordre', {camp:s.camp, siege:idx, ordre});    // camp tiré du siège, jamais du message
  }
  // Recalage (message privé, au plus un par seconde et par siège) : derniers numéros d'ordre et de contrôle acceptés.
  _recaler(s){
    const t = maintenant(); if(t - (s.recalageT || 0) < REGLAGES.recalageMs) return;
    s.recalageT = t;
    this._prive(s.id, {t:'recalage', ordre:s.dernierOrdre || 0, ctl:s.dernierCtl || 0});
  }
  _ctl(id, msg){
    const idx = this._siegeDe(id), octets = msg.octets;
    if(idx < 0){
      // Identifiant que l'hôte ne tient pas pour assis (place libérée, camp confié, retiré) : demande scellée avec sa
      // clé de siège passée (seule acceptée par le canal). Refus explicite, scellé avec cette clé passée, pour que
      // l'invité sache qu'il n'a plus de place au lieu d'attendre sans fin ; au plus 5 réponses par seconde.
      if(!prendre(this.seauArrivees)){ this._ignorer('arrivees'); return; }
      const motif = this.expulses.has(id) ? 'expulse' : this.confies.has(id) ? 'confie' : 'sansSiege';
      this._ignorer('ctlSansSiege');
      this._prive(id, {t:'refus', motif}, 'ancienne');
      return;
    }
    if(octets.length > REGLAGES.tailleCtlMax) return this._rejet('taille', idx);
    const m = lireJson(octets), s = this.sieges[idx];
    if(!m || typeof m !== 'object' || m.j !== s.jeton || !Number.isSafeInteger(m.s)) return this._rejet(m && m.j !== s.jeton ? 'jeton' : 'format', idx);
    if(m.s > msg.compteur + REGLAGES.recalageMaxMs) return this._rejet('format', idx);   // même borne que les ordres
    if(m.s <= s.dernierCtl) return this._recaler(s);
    s.dernierCtl = m.s;                            // message accepté (forme, jeton, borne) : numéro retenu
    const repondre = (accepte, motif) => { const ici = this.sieges[this._siegeDe(id)];   // le siège a pu changer
      return this._prive(id, {t:'reponse', d:m.d, ref:m.s, accepte, motif:motif || null, siege:ici.index, camp:ici.camp, equipe:ici.equipe}); };
    const arbitre = demande => {
      if(!this.o.arbitrer) return null;
      try{ const r = this.o.arbitrer(Object.assign({siege:idx, pseudo:s.pseudo}, demande)); return (r === true || r == null) ? null : (typeof r === 'string' ? r : 'refuse'); }
      catch(e){ return 'refuse'; }
    };
    if(m.d === 'rattrapage'){
      if(this.etat === 'en-partie' && maintenant() - s.dernierRattrapage > 1000 && Number.isSafeInteger(m.depuis)) this._rattrapage(s, m.depuis);
      return;
    }
    if(this.etat !== 'ouvert') return repondre(false, 'commencee');
    if(m.d === 'pret'){ s.pret = !!m.valeur; this._publierDescription(); return repondre(true); }
    if(m.d === 'siege'){
      const c = this.sieges[m.siege];
      if(!Number.isInteger(m.siege) || !c) return repondre(false, 'siegeInconnu');
      if(c === s) return repondre(true);
      if(c.type !== 'humain' || c.id) return repondre(false, 'siegeOccupe');
      const ref = arbitre({type:'siege', vers:m.siege}); if(ref) return repondre(false, ref);
      for(const k of CHAMPS_OCCUPANT) c[k] = s[k];
      viderOccupant(s); c.pret = false;
      this._emettre('siegeChange', {de:idx, vers:c.index, id});
      this._publierDescription(); return repondre(true);
    }
    if(m.d === 'equipe'){
      if(!Number.isInteger(m.equipe) || m.equipe < 1 || m.equipe > REGLAGES.equipesMax) return repondre(false, 'equipeInvalide');
      const ref = arbitre({type:'equipe', equipe:m.equipe}); if(ref) return repondre(false, ref);
      s.equipe = m.equipe; s.pret = false;
      this._emettre('equipeChangee', {siege:idx, equipe:m.equipe});
      this._publierDescription(); return repondre(true);
    }
    if(m.d === 'faction'){                         // camp choisi par l'invité (nom libre, contrôlé par arbitrer)
      if(typeof m.faction !== 'string' || !/^[a-z]{1,16}$/.test(m.faction)) return repondre(false, 'factionInvalide');
      const ref = arbitre({type:'faction', faction:m.faction}); if(ref) return repondre(false, ref);
      s.faction = m.faction; s.pret = false;
      this._publierDescription(); return repondre(true);
    }
    repondre(false, 'demandeInconnue');
  }

  // --- Commandes de l'hôte ---
  modifierEmplacement(i, champs = {}){
    const s = this.sieges[i]; if(!s || this.etat !== 'ouvert') return false;
    if(champs.type != null){
      if(!TYPES_SIEGE.includes(champs.type)) return false;
      if(s.hote && champs.type !== 'humain') return false;
      if(s.id && !s.hote && champs.type !== 'humain') return false;    // occupé : expulser d'abord
      if(champs.type === 'humain' && i >= REGLAGES.humainsMax) return false;   // (26 novembre 2026) quatre humains au plus
      s.type = champs.type;
    }
    if(champs.equipe != null){ const e = champs.equipe | 0; if(e < 1 || e > REGLAGES.equipesMax) return false; s.equipe = e; }
    if('faction' in champs) s.faction = champs.faction;
    if('niveau' in champs) s.niveau = champs.niveau;
    this._publierDescription(); return true;
  }
  expulser(i, motif){
    const s = this.sieges[i]; if(!s || s.hote || !s.id) return false;
    this.expulses.add(s.id);
    this._prive(s.id, {t:'expulse', motif:motif == null ? null : String(motif).slice(0, 80)});
    const info = this._info(s);
    if(this.etat === 'en-partie'){ viderOccupant(s, this.anciennesCles); s.type = 'ordinateur'; s.confie = true; this._emettre('campConfie', info); this.envoyerEvenement('campConfie', {siege:i, camp:s.camp}); }
    else viderOccupant(s, this.anciennesCles);
    this._emettre('depart', Object.assign(info, {motif:'expulse', libere:true}));
    this._publierDescription(); return true;
  }
  lancer(donnees = {}, {forcer = false} = {}){
    if(this.etat !== 'ouvert') return {erreur:'dejaLancee'};
    const humains = this.sieges.filter(s => s.type === 'humain' && s.id);
    const min = this.o.minHumains == null ? 2 : this.o.minHumains;
    if(humains.length < min && !forcer) return {erreur:'pasAssezDeJoueurs'};
    if(!forcer && humains.some(s => !s.pret || s.presence !== 'la')) return {erreur:'pasPrets'};
    for(const s of this.sieges) if(s.type === 'humain' && !s.id) s.type = this.o.placesLibres === 'ordinateur' ? 'ordinateur' : 'ferme';
    this.etat = 'en-partie';
    const sieges = this.sieges.map(s => ({index:s.index, camp:s.camp, equipe:s.equipe, type:s.type, faction:s.faction, niveau:s.niveau, pseudo:s.id ? s.pseudo : null, hote:!!s.hote}));
    this.debut = Object.assign({}, donnees, {sieges});
    this._publierDescription(true);
    const sD = this.envoyerEvenement('debut', this.debut);
    // Aussi en message privé (avec preuve) à chaque invité assis : l'invité ne démarre que sur celui-ci (ou sur le
    // rattrapage privé), jamais sur le seul événement public, qu'un inconnu peut publier avant le vrai (défaut 5).
    for(const s of this.sieges) if(s.id && !s.hote) this._prive(s.id, {t:'debut', s:sD, debut:this.debut});
    this._demanderComplet();
    return {ok:true, debut:this.debut};
  }
  envoyerEtat(etat, {complet = false} = {}){
    if(this.ferme) return null;
    const r = this.emetteur.emettre(etat, {complet});
    this.dernierInst = {n:r.n, temps:Math.max(0, +etat.temps || 0)};
    this.transport.publier(this.S.etat, r.octets, {qos:0});
    this.stats.instantanes.envoyes++; if(r.complet) this.stats.instantanes.complets++; this.stats.instantanes.octets += r.octets.length;
    return {n:r.n, complet:r.complet, octets:r.octets.length};
  }
  envoyerEvenement(t, donnees = {}){
    if(this.ferme) return 0;
    const s = ++this.evtS, m = Object.assign({}, donnees, {s, t:String(t)});
    this.evts.push({s, m}); if(this.evts.length > REGLAGES.memoireEvenements) this.evts.shift();
    this.transport.publier(this.S.evt, JSON.stringify(m), {qos:1});
    this.stats.evenements++;
    return s;
  }
  // Fin de partie : l'événement public « fin », puis le même en message privé (clé de siège, preuve) à chaque invité
  // assis. L'invité ne tient la fin pour sûre (mémoire effacée, « parti ») que sur ce message privé ou sur le
  // rattrapage privé ; l'événement public seul, qu'un détenteur du code peut forger, attend le silence de l'hôte.
  async terminer(donnees = {}){
    const s = this.envoyerEvenement('fin', donnees), d = this.evts.length ? this.evts[this.evts.length - 1] : null;
    if(s && d && d.s === s) for(const x of this.sieges) if(x.id && !x.hote) this._prive(x.id, {t:'fin', fin:d.m});
    this._finEnvoyee = true; await this.fermer();
  }
  async fermer(){
    if(this.ferme) return;
    if(!this._finEnvoyee) this.envoyerEvenement('ferme', {});
    const T = this.transport, att = [T.publier(this.S.salon, '', {qos:1, retenir:true})];
    // Seules les présences des invités réellement assis sont effacées (pas celles d'identifiants inconnus).
    for(const id of this.assis) att.push(T.publier(this.S.pres(id), '', {qos:1, retenir:true}));
    this.ferme = true; this.etat = 'ferme';
    for(const a of this._arrets) a(); this._arrets = [];
    await Promise.race([Promise.all(att), new Promise(ok => setTimeout(ok, 2000))]);
    await T.fermer();
    journal('salon ' + this.codeAffiche + ' fermé');
    this._emettre('ferme', {});
  }
  lien(base){
    const b = base || (location.origin + location.pathname);
    const k = this.serveur.cle, srv = SERVEURS_MQTT.some(s => s.cle === k) ? k : encodeURIComponent(this.serveur.url);
    return b + '?salon=' + this.code + (k === 'boucle' ? '' : '&srv=' + srv);
  }
  latences(){ return this.sieges.map(s => s.hote ? 0 : s.rtt); }
  debit(){ return this.transport.compteur.lire(); }
  // sceau : messages authentiques acceptés et messages jetés par la couche de signature (§ 6 d'INTERFACE-RESEAU).
  statistiques(){ return Object.assign(JSON.parse(JSON.stringify(this.stats)), {sceau:JSON.parse(JSON.stringify(this.transport.stats || {acceptes:0, rejets:{}}))}); }
  couperTransport(dureeMs){ this.transport.couper(dureeMs); }   // essais (boucle locale : durée de la coupure)
}

function validerOrdre(m, types){
  if(typeof m.o !== 'string' || !types.includes(m.o)) return 'type';
  const r = {o:m.o}; let n = 0;
  for(const k of Object.keys(m)){
    if(k === 's' || k === 'j' || k === 'o' || k === 'camp') continue;       // le camp ne vient jamais du message
    if(++n > 16 || !/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(k)) return 'format';
    const v = m[k];
    if(v === null || typeof v === 'boolean') r[k] = v;
    else if(typeof v === 'number'){ if(!Number.isFinite(v)) return 'format'; r[k] = v; }
    else if(typeof v === 'string'){ if(v.length > 32) return 'format'; r[k] = v; }
    else if(Array.isArray(v)){
      if(v.length > REGLAGES.idsParOrdre) return 'tropDIds';
      for(const x of v) if(typeof x !== 'number' || !Number.isFinite(x)) return 'format';
      r[k] = v.slice();
    }
    else return 'format';
  }
  return r;
}

// -------------------------------------------------------------------------------------
// 7. Salon côté invité
// -------------------------------------------------------------------------------------
// Mémoire du siège (décision du propriétaire) : identifiant d'onglet et jeton gardés dans localStorage, par code
// de salon, avec leur date, pour reprendre son siège en rouvrant le lien après avoir fermé l'onglet. Effacée à la
// fin de la partie, à un refus définitif, au départ volontaire, et au-delà de 3 heures (purge à chaque arrivée).
// Rien d'autre n'y est écrit ; tout accès est protégé (stockage bloqué ou plein : on fait sans).
const PREFIXE_MEMO = 'frontDeSel.reseau.';
const RE_CLE_MEMO = new RegExp('^frontDeSel\\.reseau\\.[' + ALPHABET + ']{6}$');
const cleMemo = code => PREFIXE_MEMO + code;
function stockage(){ try{ return global.localStorage || null; }catch(e){ return null; } }
function lireMemoBrut(st, cle){
  try{
    const v = JSON.parse(st.getItem(cle) || 'null'), t = Date.now();
    if(!estObjet(v) || typeof v.id !== 'string' || !ID_RE.test(v.id) || typeof v.t !== 'number' || !(t - v.t <= REGLAGES.dureeMemoireMs) || v.t > t + 60000) return null;
    return {id:v.id, jeton:typeof v.jeton === 'string' && RE_JETON.test(v.jeton) ? v.jeton : null,
      cle:typeof v.cle === 'string' && RE_CLE_HEX.test(v.cle) ? v.cle : null, t:v.t};
  }catch(e){ return null; }
}
function lireMemo(code){ const st = stockage(); return st ? lireMemoBrut(st, cleMemo(code)) : null; }
// Valeur : {id, jeton, cle (clé de siège, 64 signes hexadécimaux, depuis le protocole 2), t}.
function ecrireMemo(code, v){
  try{
    const st = stockage(); if(!st) return;
    if(v) st.setItem(cleMemo(code), JSON.stringify({id:v.id, jeton:v.jeton || null, cle:v.cle || null, t:Date.now()}));
    else st.removeItem(cleMemo(code));
  }catch(e){}
}
function purgerMemos(){
  let n = 0;
  try{
    const st = stockage(); if(!st) return 0;
    const cles = [];
    for(let i = 0; i < st.length; i++){ const k = st.key(i); if(k && RE_CLE_MEMO.test(k)) cles.push(k); }
    for(const k of cles) if(!lireMemoBrut(st, k)){ st.removeItem(k); n++; }
  }catch(e){}
  return n;
}
// Pour jeu.js : identifiant mémorisé pour ce code ({id, t} ou null ; jamais le jeton).
function memoire(code){
  const nc = normaliserCode(code); if(nc.erreur) return null;
  const m = lireMemo(nc.code); return m ? {id:m.id, t:m.t} : null;
}
function oublierMemoire(code){ const nc = normaliserCode(code); if(!nc.erreur) ecrireMemo(nc.code, null); }

async function rejoindre(code, pseudonyme, options = {}){
  const nc = normaliserCode(code); if(nc.erreur) throw erreurReseau('code', nc.erreur);
  code = nc.code;
  const memoriser = options.memoriser !== false;
  if(memoriser) purgerMemos();
  const {racine:R, cle:cleSalon} = await deriverSalon(code), S = sujetsDe(R);
  const memo = memoriser ? lireMemo(code) : null;
  const id = options.id || (memo && memo.id) || nouvelId();
  if(typeof id !== 'string' || !ID_RE.test(id)) throw erreurReseau('config', 'Identifiant d’onglet invalide.');
  let jeton = null, cleS = null;
  if(options.jeton != null){ if(typeof options.jeton !== 'string' || !RE_JETON.test(options.jeton)) throw erreurReseau('config', 'Jeton invalide.'); jeton = options.jeton; }
  else if(memo && memo.id === id) jeton = memo.jeton;
  // Clé de siège : mémoire (retour), ou options.cleSiege (essais, 64 signes hexadécimaux).
  if(options.cleSiege != null){ if(typeof options.cleSiege !== 'string' || !RE_CLE_HEX.test(options.cleSiege)) throw erreurReseau('config', 'Clé de siège invalide.'); cleS = options.cleSiege; }
  else if(memo && memo.id === id && memo.jeton === jeton) cleS = memo.cle;
  // Une paire ECDH neuve à chaque arrivée (la clé publique part dans chaque « la »).
  const paire = await nouvellePaire();
  // Dernière volonté scellée avant l'ouverture du transport, avec la clé de salon (genre 1).
  const c0 = Date.now();
  const will = {sujet:S.pres(id), donnees:sceller(cleSalon, 'j/' + id + '/pres', JSON.stringify({etat:'parti'}), c0, 1)};
  const etape = signaleur(options.etape);
  const secrets = {cleSalon, paire, cleSiege:cleS ? deHex(cleS) : null};
  const creer = tr => new SalonInvite(code, R, S, new Canal(tr, R, cleSalon, c0), options, id, pseudonyme, jeton, secrets);
  const definitif = e => { if(memoriser && e && REFUS_DEFINITIFS.includes(e.motif)) ecrireMemo(code, null); return e; };
  const entrer = async (salon, desc) => {
    try{ await salon._suite(desc, etape); }
    catch(e){ await salon._abandonner(); throw definitif(e); }   // salon trouvé mais refus : inutile d'essayer ailleurs
    salon._memoriser();
    return salon;
  };
  // Boucle locale
  const bus = options.transport || busDefaut;
  if(bus){
    const salon = creer(bus.ouvrir({will}));
    let desc; try{ desc = await salon._sonder(); }catch(e){ await salon._fermerDiscretement(); throw definitif(e); }
    return entrer(salon, desc);
  }
  const explicite = options.serveurs != null || (options.serveur != null && options.serveur !== '');
  const chaine = resoudreServeurs(options.serveurs || options.serveur);
  // Sans indication de serveur : le salon est cherché sur tous les serveurs de la chaîne en même temps.
  if(!explicite && chaine.length > 1 && options.parallele !== false){
    etape({etape:'recherche', serveur:chaine.map(s => s.nom).join(' et ')});
    let r; try{ r = await chercherEnParallele(chaine, will, creer, etape); }catch(e){ throw definitif(e); }
    return entrer(r.salon, r.desc);
  }
  let erreur = null;
  for(const srv of chaine){
    let transport;
    try{ transport = await TransportMqtt.ouvrir([srv], {will, etape}); }
    catch(e){ if(!erreur || erreur.motif === 'serveur') erreur = e; continue; }
    etape({etape:'recherche', serveur:srv.nom});
    const salon = creer(transport);
    let desc;
    try{ desc = await salon._sonder(); }
    catch(e){ await salon._fermerDiscretement(); erreur = e; if(e.motif === 'inconnu') continue; throw definitif(e); }
    return entrer(salon, desc);
  }
  throw definitif(erreur || erreurReseau('serveur'));
}

// Recherche simultanée : une connexion par serveur ; la première qui trouve une description ouverte l'emporte,
// les autres sont fermées proprement (sans dernière volonté). Rien n'est publié avant d'avoir trouvé le salon.
function chercherEnParallele(chaine, will, creer, etape){
  return new Promise((ok, ko) => {
    let gagnant = null, restants = chaine.length, connecte = false, fermeVu = false;
    const erreurs = [], candidats = [];
    for(const srv of chaine){
      (async () => {
        let tr;
        try{ tr = await TransportMqtt.ouvrir([srv], {will, etape}); }catch(e){ erreurs.push(e); return; }
        connecte = true;
        if(gagnant){ await tr.fermer(); return; }
        const s = creer(tr); candidats.push(s);
        let d;
        try{ d = await s._sonder(); }catch(e){ if(e && e.motif === 'ferme') fermeVu = true; await s._fermerDiscretement(); return; }
        if(gagnant){ await s._fermerDiscretement(); return; }
        gagnant = s;
        for(const c of candidats) if(c !== s) c._fermerDiscretement();
        ok({salon:s, desc:d});
      })().catch(e => { erreurs.push(e); }).finally(() => {
        if(--restants > 0 || gagnant) return;
        if(fermeVu) return ko(erreurReseau('ferme'));
        if(connecte) return ko(erreurReseau('inconnu'));
        const b = erreurs.find(e => e && e.motif === 'bibliotheque');
        ko(b || erreurReseau('serveur', MESSAGES.serveur, {essais:[].concat(...erreurs.map(e => (e && e.details && e.details.essais) || []))}));
      });
    }
  });
}

class SalonInvite extends Diffuseur {
  constructor(code, R, S, transport, o, id, pseudo, jeton, secrets){
    super();
    this.role = 'invite'; this.code = code; this.codeAffiche = formaterCode(code);
    this.R = R; this.S = S; this.transport = transport; this.serveur = transport.serveur; this.o = o;
    // Clés (jamais publiées) : clé de salon ; paire ECDH de cette arrivée ; clé de siège (mémoire du siège, ou tirée
    // de l'accueil) ; clé candidate, tirée de la clé publique de l'hôte lue dans la description, avant l'accueil.
    this.cleSalon = secrets.cleSalon; this.paire = secrets.paire; this.cleSiege = secrets.cleSiege || null; this.cleCandidate = null;
    // Retour avec une clé de siège (mémoire) : aucun accueil scellé avec la clé de salon n'est plus accepté (un
    // détenteur du code peut en forger un) ; un refus scellé avec elle n'est retenu qu'en dernier recours (_refusSalon).
    this._retour = !!this.cleSiege; this._refusSalon = null;
    this.descCle = null; this.decoDepuis = 0;
    transport.cles = (rel, genre) => this._clesPour(rel, genre);
    transport.bornerSalon = true;                  // borne haute des compteurs à la clé de salon (voir Canal)
    this.id = id; this.pseudo = nettoyerPseudo(pseudo);
    this.versionJeu = o.versionJeu == null ? null : String(o.versionJeu);
    this.memoriser = o.memoriser !== false; this.memoT = 0;
    // Contrôle des sièges reçus : listes de factions et de niveaux admis (sinon nom court en minuscules).
    this.vo = {factions:Array.isArray(o.factions) ? o.factions.map(String) : null, niveaux:Array.isArray(o.niveaux) ? o.niveaux.map(String) : null};
    // Jeton mémorisé (retour après fermeture de l'onglet) : sert de preuve pour reprendre un siège gardé.
    this.siege = -1; this.camp = null; this.equipe = null; this.jeton = jeton || null;
    this.refInst = null; this.rejetsDepuis = 0; this.tEvt = maintenant();
    this.descriptionSalon = null; this.debut = null; this.entre = false; this.fini = false;
    this.dernierEvt = 0; this.attenteEvts = new Map(); this.trouDepuis = 0; this.dernierRattrapage = 0;
    this.sOrdre = Date.now(); this.sCtl = Date.now(); this.seau = nouveauSeau(REGLAGES.ordresParSeconde);
    this.recepteur = creerRecepteur();
    this.rtt = null; this.echantillonsRtt = [];
    // dernierHote : dernier signe de l'hôte, avancé à ma reconnexion (voir « reconnecte ») ; dernierHoteReel : dernier
    // signe réellement reçu, jamais avancé autrement (borne absolue de _surveiller).
    this.dernierHote = this.dernierHoteReel = maintenant(); this.hoteInjoignable = false; this.willHote = 0;
    this.derniereDemandeComplet = 0; this.demandeComplet = true;
    // Compteurs des battements et des présences (refus du rejeu chez l'hôte) : partent de l'horloge, donc un onglet
    // rouvert repart au-delà de l'ancien.
    this.cVie = Date.now(); this.cPres = Date.now();
    // Fin annoncée par le réseau (événement fin ou ferme, refus ou expulsion privés) : vérifiée avant d'être
    // confirmée (_verifierFinAnnoncee). Signes de vie : instantané appliqué ou battement de l'hôte (vieHoteT),
    // réponse à mes battements (pongT).
    this.finAnnoncee = null; this.vieHoteT = maintenant(); this.pongT = 0;
    this.livres = new Map(); this.conflits = new Set(); this.debutPublic = null;
    this.stats = {evenements:{recus:0, doublons:0, rattrapes:0, perdus:0, conflits:0, tardifs:0}, ordres:{envoyes:0, refusesLocalement:0, recalages:0}, ignores:{}};
    this._attentes = {}; this._reponses = new Map(); this._arrets = [];
  }
  // Message reçu mais ignoré (invalide, hors bornes, sans preuve…) : compté, jamais signalé à l'écran.
  _ignorer(genre){ this.stats.ignores[genre] = (this.stats.ignores[genre] || 0) + 1; }
  get preuve(){ return this.jeton ? this.jeton.slice(0, 8) : null; }
  _memoriser(){ if(this.memoriser && this.jeton){ ecrireMemo(this.code, {id:this.id, jeton:this.jeton, cle:this.cleSiege ? hex(this.cleSiege) : null}); this.memoT = maintenant(); } }
  // Clés attendues pour un message reçu. Diffusions de l'hôte : clé de salon. Sujets privés (h/a/<id>, h/v/<id>) :
  // ma clé de siège (et, avant l'entrée, la candidate) ; sur h/a/<id>, la clé de salon aussi, mais _prive n'en
  // garde qu'un refus (et, avant l'entrée d'une première arrivée sans clé de siège, l'accueil).
  _clesPour(rel){
    const sal = {nom:'salon', cle:this.cleSalon};
    if(rel === 'h/salon' || rel === 'h/etat' || rel === 'h/evt' || rel === 'h/vie') return [sal];
    const prive = rel === 'h/a/' + this.id;
    if(!prive && rel !== 'h/v/' + this.id) return [];
    const l = [];
    if(this.cleSiege) l.push({nom:'siege', cle:this.cleSiege});
    if(!this.entre && this.cleCandidate && this.cleCandidate !== this.cleSiege) l.push({nom:'candidate', cle:this.cleCandidate, memoire:'siege'});
    if(prive) l.push(sal);
    return l;
  }
  // Clé à utiliser pour mes publications privées (présence, ordres, ctl, battements) : clé de siège, sinon de salon.
  get _cle(){ return this.cleSiege || this.cleSalon; }
  _attendre(cle, ms){
    return new Promise((ok, ko) => {
      const t = setTimeout(() => { delete this._attentes[cle]; ko(null); }, ms);
      this._attentes[cle] = v => { clearTimeout(t); delete this._attentes[cle]; ok(v); };
    });
  }
  _resoudre(cle, v){ const f = this._attentes[cle]; if(f){ f(v); return true; } return false; }

  // Première phase : abonnements et attente de la description conservée (rien n'est publié).
  async _sonder(){
    const T = this.transport, S = this.S;
    T.on('message', m => { try{ this._recevoir(m); }catch(e){ this._ignorer('exception'); journal('exception à la réception : ' + (e && e.message)); } });
    T.on('deconnecte', () => { if(!this.decoDepuis) this.decoDepuis = maintenant(); if(this.entre) this._emettre('deconnecte', {}); });
    T.on('reconnecte', () => {
      this.decoDepuis = 0;
      if(this.fini || !this.entre) return;
      // Pendant MA coupure, je n'ai pas pu entendre l'hôte : revenu après plus de hoteAbandonMs (permis en partie
      // jusqu'à delaiConfieMs), je le déclarerais injoignable avant sa réponse. Il reçoit donc au moins reponseHoteMs
      // pour se manifester ; pas davantage, sinon une connexion qui clignote masquerait sans fin un hôte parti.
      const t = maintenant();
      this.dernierHote = Math.max(this.dernierHote, Math.min(t, t - REGLAGES.hoteAbandonMs + REGLAGES.reponseHoteMs));
      this._publierPresence();                     // la dernière volonté l'a remplacée par « parti »
      this.demandeComplet = true; this._battre();
      this._emettre('reconnecte', {});
    });
    const pDesc = this._attendre('description', REGLAGES.delaiSalonMs);
    await T.abonner([S.salon, S.etat, S.evt, S.vieH, S.prive(this.id), S.pong(this.id)]);
    let desc;
    try{ desc = await pDesc; }catch(e){ throw erreurReseau('inconnu'); }
    if(!desc || desc.etat === 'ferme') throw erreurReseau('ferme');
    return desc;
  }
  // Seconde phase : contrôle de version, présence publiée, accueil.
  async _suite(desc, etape){
    // Le texte affiché vient de MESSAGES ; la version de l'hôte (contrôlée) n'est donnée qu'en details.
    if(desc.proto !== PROTO || (this.versionJeu != null && desc.jeu !== this.versionJeu))
      throw erreurReseau('version', MESSAGES.version, {hote:desc.jeu, invite:this.versionJeu});
    if(etape) etape({etape:'accueil', serveur:this.serveur.nom});
    // Nouvelle arrivée : clé de siège candidate tirée tout de suite de la clé publique de l'hôte (description), pour
    // vérifier sans attente les messages privés qui suivent l'accueil. L'accueil fait foi (sa clé `cle`).
    this.descCle = desc.cle || null;
    if(!this.cleSiege && this.descCle) this.cleCandidate = await deriverSiege(this.cleSalon, this.id, this.paire.prive, this.descCle);
    const pRep = this._attendre('accueil', REGLAGES.delaiAccueilMs);
    this._publierPresence();
    let rep;
    try{ rep = await pRep; }catch(e){
      // Retour sans accueil à ma clé de siège, mais avec un refus à la clé de salon (forgeable par un détenteur du
      // code) : échec NON définitif (motif sansReponse) ; mémoire gardée, aucun « parti » publié.
      if(this._refusSalon) throw erreurReseau('sansReponse', MESSAGES.retourNonConfirme, {refus:this._refusSalon.motif});
      throw erreurReseau('sansReponse');
    }
    if(rep.t === 'refus') throw erreurReseau(rep.motif, MESSAGES[rep.motif], rep.motif === 'version' ? {hote:rep.jeu, invite:this.versionJeu} : undefined);
    if(rep._cle === 'salon' && this._retour) throw erreurReseau('sansReponse');   // jamais atteint (_prive l'écarte)
    if(rep._cle === 'salon'){
      // Accueil d'une arrivée (clé de salon) : clé de siège tirée de MA paire et de la clé publique qu'il annonce.
      const k = rep.cle && rep.cle === this.descCle && this.cleCandidate ? this.cleCandidate
        : await deriverSiege(this.cleSalon, this.id, this.paire.prive, rep.cle);
      if(!k) throw erreurReseau('sansReponse');
      this.cleSiege = k;
    } else if(rep._cle === 'candidate') this.cleSiege = this.cleCandidate;
    this.cleCandidate = null; this._refusSalon = null;
    this._appliquerAccueil(rep, true);
    // Plancher : sur les sujets de l'hôte, tout message plus ancien que cet accueil est un rejeu (un seul compteur
    // par connexion chez l'hôte), même s'il n'a jamais été vu par cette connexion neuve.
    const id = this.id;
    this.transport.fixerPlancher(rep._compteur, rel => rel === 'h/etat' || rel === 'h/evt' || rel === 'h/vie' || rel === 'h/a/' + id || rel === 'h/v/' + id);
    this.entre = true;
    this._arrets.push(minuteur(REGLAGES.battementMs, () => this._battre()));
    this._arrets.push(minuteur(500, () => this._surveiller()));
    this._battre();
    if(rep.debut){ this.debut = rep.debut; setTimeout(() => this._emettre('debut', this.debut), 0); }
    journal('entré dans le salon ' + this.codeAffiche + ', siège ' + this.siege + ' (' + this.camp + ')');
  }
  // Départ : un « parti » portant la preuve du jeton (l'hôte libère le siège tout de suite), puis effacement de la
  // présence conservée.
  // sansParti : fin non sûre (cinquième tour) : aucun « parti » avec preuve ; l'hôte ne constate qu'un silence, et le
  // siège reste repris par le lien pendant le délai de grâce.
  async _publierDepart(sansParti){
    const att = [];
    if(this.jeton && this.entre && !sansParti) att.push(this.transport.publier(this.S.pres(this.id), JSON.stringify({etat:'parti', preuve:this.preuve, c:this._compteurPres()}), {qos:1, cle:this._cle}));
    att.push(this.transport.publier(this.S.pres(this.id), '', {qos:1, retenir:true}));
    await Promise.race([Promise.all(att), new Promise(ok => setTimeout(ok, 1500))]);
  }
  async _abandonner(){
    this.fini = true;
    for(const a of this._arrets) a(); this._arrets = [];
    await this._publierDepart();
    await this.transport.fermer();
  }
  // Fermeture sans rien publier (serveur où le salon n'a pas été trouvé) : pas de dernière volonté.
  async _fermerDiscretement(){
    if(this._fermeDiscret) return; this._fermeDiscret = true; this.fini = true;
    for(const a of this._arrets) a(); this._arrets = [];
    await this.transport.fermer();
  }
  _compteurPres(){ this.cPres = Math.max(this.cPres + 1, Date.now()); return this.cPres; }
  _publierPresence(){
    // cp : ma clé publique ECDH (l'hôte en tire la clé de siège s'il me donne une place). Scellée avec ma clé de siège
    // si j'en ai une (retour), sinon avec la clé de salon (premier « la »).
    const p = {etat:'la', proto:PROTO, jeu:this.versionJeu, nom:this.pseudo, c:this._compteurPres(), cp:this.paire.pub};
    if(this.jeton) p.preuve = this.preuve;          // exigée par l'hôte pour reprendre un siège gardé
    if(this.entre) p.dernierEvt = this.dernierEvt;
    return this.transport.publier(this.S.pres(this.id), JSON.stringify(p), {qos:1, retenir:true, cle:this._cle});
  }
  _appliquerAccueil(rep, premier){
    const change = rep.siege !== this.siege || rep.camp !== this.camp;
    this.siege = rep.siege; this.camp = rep.camp; this.equipe = rep.equipe; this.jeton = rep.jeton;
    this._recaler(rep.dernierOrdre, rep.dernierCtl);
    if(premier){
      this.dernierEvt = rep.dernierEvt; this.tEvt = maintenant();
      // Référence des bornes de vraisemblance : dernier instantané annoncé par l'hôte, sinon début de partie.
      // Sans instantané annoncé (salon), le temps de jeu du premier n'est pas borné (seul son numéro l'est).
      this.refInst = {n:rep.inst ? rep.inst.n : 0, temps:rep.inst ? rep.inst.temps : null, t:maintenant()};
    }
    if(rep.description) this.descriptionSalon = rep.description;
    if(!premier && change) this._emettre('siege', {siege:this.siege, camp:this.camp, equipe:this.equipe});
  }
  description(){ return this.descriptionSalon; }
  // Numéros d'ordre et de contrôle repartant au-delà des derniers acceptés par l'hôte (accueil, recalage). Jamais
  // en arrière. Borne : mon propre compteur d'enveloppe (mon horloge) + 12 h, la même que celle de l'hôte, qui ne
  // retient aucun numéro au-delà du compteur d'enveloppe du message + 12 h : tout recalage qu'il peut produire est
  // donc accepté ici (avant le 14 novembre 2026, troisième tour : hôte + 24 h, invité + 12 h, siège rendu muet).
  _recaler(o, c){
    const lim = Math.max(this.transport.compteurActuel || 0, Date.now()) + REGLAGES.recalageMaxMs;
    if(Number.isSafeInteger(o) && o > this.sOrdre && o <= lim){ this.sOrdre = o; this.stats.ordres.recalages++; }
    if(Number.isSafeInteger(c) && c > this.sCtl && c <= lim) this.sCtl = c;
  }

  // Chaque message est contrôlé avant d'être gardé ou émis ; « l'hôte est là » n'est noté qu'après ce contrôle.
  // `m` : message authentique remis par le canal {sujet, octets (corps), conserve, genre, cle, compteur}.
  _recevoir(m){
    if(this.fini) return;
    const S = this.S, sujet = m.sujet, octets = m.octets;
    if(sujet === S.salon) return this._description(octets, m.genre);
    if(m.genre !== 0){ this._ignorer('genre'); return; }   // seule la description de l'hôte a une dernière volonté
    if(sujet === S.etat) return this._instantane(octets);
    if(sujet === S.evt) return this._evenement(octets);
    if(sujet === S.prive(this.id)) return this._prive(octets, m.cle, m.compteur);
    if(sujet === S.pong(this.id)) return this._pong(octets);
    if(sujet === S.vieH){ if(octets.length === 1){ this._hoteVu(); this.vieHoteT = maintenant(); } else this._ignorer('vie'); }
  }
  _hoteVu(){
    this.dernierHote = this.dernierHoteReel = maintenant(); this.willHote = 0;
    if(this.hoteInjoignable){ this.hoteInjoignable = false; this._emettre('hoteRetrouve', {}); }
  }
  _description(octets, genre){
    if(octets.length > REGLAGES.tailleDescriptionMax){ this._ignorer('description'); return; }
    // (Une description vide, effacement du message conservé, n'arrive plus ici : le canal la jette sans effet.)
    const d = validerDescription(lireJson(octets), this.entre ? this.vo : Object.assign({}, this.vo, {versionJeu:this.versionJeu}));
    if(!d){ this._ignorer('description'); return; }
    // Description d'un salon qui vit sur un AUTRE serveur (recopiée telle quelle d'un serveur public à l'autre) : ignorée.
    // (Comparaison sans la casse ni la barre finale : la même adresse personnalisée tapée deux fois à la main.)
    const adr = u => String(u).trim().replace(/\/+$/, '').toLowerCase();
    if(d.srv != null && adr(d.srv) !== adr(this.serveur && this.serveur.url)){ this._ignorer('serveur'); return; }
    if(genre === 1 && d.etat !== 'ferme'){ this._ignorer('description'); return; }   // dernière volonté : « fermé » seulement
    if(!this.entre){
      // « Fermé » avant l'entrée : peut être une dernière volonté rejouée telle quelle (un inconnu le peut, limite L2)
      // pendant que l'hôte vit ; l'hôte republie alors sa description dans la seconde. On attend donc 2,5 s une
      // description ouverte avant de conclure « fermé ».
      if(d.etat === 'ferme'){
        if(!this._fermeT) this._fermeT = setTimeout(() => this._resoudre('description', d), REGLAGES.confirmationWillMs);
        return;
      }
      if(this._fermeT){ clearTimeout(this._fermeT); this._fermeT = 0; }
      this._resoudre('description', d); this.descriptionSalon = d; return;
    }
    if(d.etat === 'ferme'){
      // Dernière volonté de l'hôte (coupure, onglet fermé) ou description effacée. Une vraie fermeture arrive aussi
      // par l'événement fiable « ferme » (fin immédiate) ; ce message-ci, que n'importe qui peut publier, ne fait
      // qu'ouvrir le délai de grâce de 10 s (annulé dès que l'hôte se manifeste).
      if(!this.willHote) this.willHote = maintenant();
      if(!this.hoteInjoignable){ this.hoteInjoignable = true; this._emettre('hoteInjoignable', {will:true}); }
      return;
    }
    if(d.proto !== PROTO){ this._ignorer('description'); return; }
    this._hoteVu();
    this.descriptionSalon = d;
    this._emettre('description', d);
  }
  // Bornes de vraisemblance d'un instantané, d'après le temps réel écoulé depuis le dernier appliqué.
  _vraisemblable(E, t){
    const ref = this.refInst; if(!ref) return true;
    const dt = Math.max(0, (t - ref.t)/1000);
    const d = (E.n - ref.n) & 0xFFFF;
    if(d > 0 && d < 0x8000 && d > 10 + REGLAGES.instantanesParSecondeMax*dt) return false;   // numéro trop en avance
    if(ref.temps != null && E.temps > ref.temps + REGLAGES.margeTemps*dt + REGLAGES.margeTempsS) return false;   // temps de jeu trop en avance
    return true;
  }
  _instantane(octets){
    if(!this.entre) return;
    if(octets.length > REGLAGES.tailleInstantaneMax){ this._ignorer('instantane'); return; }
    const E = lireEntete(octets), t = maintenant();
    if(!E || E.proto !== PROTO){ this.recepteur.recevoir(octets); return; }   // compté invalide par le récepteur
    // Resynchronisation : rejets continus depuis 3 s sans rien appliquer (un faux a pu fausser la référence,
    // ou l'hôte a vraiment sauté) → le prochain complet est accepté et sert de nouvelle référence.
    const bloque = this.rejetsDepuis && t - this.rejetsDepuis >= REGLAGES.resynchroMs;
    let forcer = false;
    if(!this._vraisemblable(E, t)){
      this._ignorer('instantaneHorsBornes');
      if(!this.rejetsDepuis) this.rejetsDepuis = t;
      if(!(E.complet && bloque)) return;
      forcer = true;
    }
    let r = this.recepteur.recevoir(octets, forcer ? {forcer:true} : undefined);
    if(!r.etat && r.ignore === 'ancien' && E.complet && bloque){ forcer = true; r = this.recepteur.recevoir(octets, {forcer:true}); }
    if(r.demandeComplet) this._demanderComplet();
    if(r.etat){
      this.refInst = {n:E.n, temps:E.temps, t}; this.rejetsDepuis = 0;
      this._hoteVu(); this.vieHoteT = t;
      if(forcer){ r.etat.resynchro = true; this._ignorer('resynchro'); }
      if(r.etat.complet) this.demandeComplet = false;
      this._emettre('etat', r.etat);
    } else if(r.ignore === 'ancien' && !this.rejetsDepuis) this.rejetsDepuis = t;
  }
  _demanderComplet(){
    this.demandeComplet = true;
    const t = maintenant(); if(t - this.derniereDemandeComplet < 300) return;
    this.derniereDemandeComplet = t; this._battre();
  }
  _evenement(octets){
    if(!this.entre) return;
    if(octets.length > REGLAGES.tailleEvenementMax){ this._ignorer('evenement'); return; }
    const m = validerEvenement(lireJson(octets), this.vo);
    if(!m){ this._ignorer('evenement'); return; }
    if(this._traiterEvt(m)) this._hoteVu();
  }
  // Rend faux si l'événement est hors bornes (ignoré).
  _traiterEvt(m){
    // Numéro trop en avance sur le dernier rendu : un seul faux ne doit pas faire sauter les vrais suivants.
    const borne = this.dernierEvt + REGLAGES.memoireEvenements + REGLAGES.evenementsParSecondeMax*Math.max(0, maintenant() - this.tEvt)/1000;
    if(m.s > borne){ this._ignorer('evenementHorsBornes'); return false; }
    if(m.s <= this.dernierEvt || this.attenteEvts.has(m.s)){
      // Même numéro, autre contenu : l'un des deux est forgé (le premier arrivé a pu l'être). Les deux sont gardés
      // et le rattrapage privé de l'hôte tranche ; le vrai, s'il était le second, est alors livré en retard.
      const vu = m.s <= this.dernierEvt ? this.livres.get(m.s) : JSON.stringify(this.attenteEvts.get(m.s));
      if(vu !== undefined && vu !== JSON.stringify(m)){
        this.stats.evenements.conflits++;
        if(this.conflits.size < 64) this.conflits.add(m.s);
        this._demanderRattrapage(Math.min(...this.conflits) - 1);
      } else this.stats.evenements.doublons++;
      return true;
    }
    if(m.s === this.dernierEvt + 1){
      this._livrer(m);
      while(this.attenteEvts.has(this.dernierEvt + 1)){ const e = this.attenteEvts.get(this.dernierEvt + 1); this.attenteEvts.delete(e.s); this._livrer(e); }
      if(!this.attenteEvts.size) this.trouDepuis = 0;
      return true;
    }
    if(this.attenteEvts.size >= REGLAGES.memoireEvenements + REGLAGES.margeRattrapage){ this._ignorer('evenementHorsBornes'); return false; }
    this.attenteEvts.set(m.s, m);                  // trou : on attend les manquants
    if(!this.trouDepuis) this.trouDepuis = maintenant();
    this._demanderRattrapage();
    return true;
  }
  _demanderRattrapage(depuis){
    const t = maintenant(); if(t - this.dernierRattrapage < 1000) return;
    this.dernierRattrapage = t;
    let d = Number.isSafeInteger(depuis) && depuis >= 0 ? Math.min(depuis, this.dernierEvt) : this.dernierEvt;
    if(this.conflits.size) d = Math.max(0, Math.min(d, Math.min(...this.conflits) - 1));   // conflits encore à trancher
    this._ctl('rattrapage', {depuis:d});
  }
  _livrer(m){
    if(this.fini) return;
    this.dernierEvt = m.s; this.tEvt = maintenant(); this.stats.evenements.recus++;
    this._diffuser(m);
  }
  // Effets d'un événement livré (dans l'ordre, ou en retard après un conflit tranché par le rattrapage).
  _diffuser(m){
    this.livres.set(m.s, JSON.stringify(m));
    while(this.livres.size > REGLAGES.memoireEvenements) this.livres.delete(this.livres.keys().next().value);
    // Lancement : jamais sur le seul événement public (un inconnu peut le publier avant le vrai) ; on attend le
    // message privé de l'hôte, et à défaut on le redemande par le rattrapage privé (défaut 5).
    if(m.t === 'debut' && !this.debut){ this.debutPublic = m; this._demanderRattrapage(m.s - 1); }
    if(m.t === 'campConfie' && m.siege === this.siege) this._emettre('campConfie', m);
    this._emettre('evenement', m);
    // Fin de partie, fermeture : annoncées, puis confirmées ou ignorées (défauts 1 et 3).
    if(m.t === 'fin') this._annoncerFin('fin', m, 'public');
    else if(m.t === 'ferme') this._annoncerFin('ferme', null, 'public');
  }
  _debutConfirme(d){
    if(this.debut || !d) return;
    this.debut = d; this.debutPublic = null;
    this._emettre('debut', d);
  }
  // --- Fin annoncée par le réseau (défauts 1 et 3 du 14 novembre 2026) ---
  // Un motif de fin reçu du réseau (événement fin ou ferme, refus ou expulsion privés) n'a plus d'effet irréversible :
  // ni mémoire effacée, ni « parti » publié, ni connexion fermée. Il est confirmé : pour un motif public, si l'hôte se
  // tait pendant REGLAGES.confirmationFinMs (ni instantané appliqué ni battement) ; pour un motif privé, si l'hôte
  // cesse de répondre à mes battements pendant ce délai. Si l'hôte continue de se manifester, l'annonce est ignorée
  // (compteur ignores.finForgee). La fin de partie n'est SÛRE (mémoire effacée) que sur le message privé « fin » de
  // l'hôte ou sur une fin trouvée dans son rattrapage privé (quatrième tour : un détenteur du code pouvait forger un
  // instantané ne laissant qu'une équipe en vie, puis un « fin », et faire quitter le siège d'un autre invité).
  _annoncerFin(motif, donnees, genre){
    if(this.fini) return;
    this.finAnnoncee = {motif, donnees:donnees || null, genre, t:maintenant()};
    journal('fin annoncée (' + motif + '), vérification');
    this._emettre('finAnnoncee', {motif});
    this._verifierFinAnnoncee();
  }
  _verifierFinAnnoncee(){
    const a = this.finAnnoncee; if(!a || this.fini) return;
    const t = maintenant();
    if(t - a.t < REGLAGES.confirmationFinMs) return;
    // Annonce publique : la réponse à mes battements (pongT, clé de siège : ni forgeable ni bloquable par un détenteur
    // du code) compte aussi (cinquième tour : instantanés et battements de l'hôte bloqués par un compteur forgé).
    const vie = a.genre === 'prive' ? this.pongT : Math.max(this.vieHoteT, this.pongT);
    this.finAnnoncee = null;
    if(vie > a.t + REGLAGES.margeSigneVieMs){
      this._ignorer('finForgee'); journal('fin annoncée (' + a.motif + ') démentie par l’hôte : ignorée');
      this._emettre('finIgnoree', {motif:a.motif});
      return;
    }
    this._fin(a.motif, a.donnees, false);
  }
  // `cle` : clé qui a scellé le message ('siege', 'candidate' ou 'salon'). Scellé avec la clé de salon, seul un refus
  // est gardé (et, avant l'entrée d'une PREMIÈRE arrivée, l'accueil qui répond à mon premier « la ») : un invité qui a
  // le code peut en forger. `compteur` : compteur d'enveloppe (plancher posé par l'accueil).
  _prive(octets, cle, compteur){
    if(octets.length > REGLAGES.tailleRattrapageMax){ this._ignorer('prive'); return; }
    const m = lireJson(octets);
    if(!estObjet(m)){ this._ignorer('prive'); return; }
    const parSalon = cle === 'salon';
    if(parSalon && !(m.t === 'refus' || (m.t === 'accueil' && !this.entre && !this._retour))){ this._ignorer('cleSalon'); return; }
    // Une fois entré, tout message privé scellé par ma clé de siège doit porter la preuve de mon jeton (l'accueil :
    // le jeton lui-même). Un refus n'en porte pas forcément : il s'adresse à un identifiant que l'hôte ne tient plus
    // pour assis (scellé avec ma clé passée, ou avec la clé de salon).
    if(this.entre && !parSalon && m.t !== 'refus' && (m.t === 'accueil' ? m.jeton !== this.jeton : m.preuve !== this.preuve)){ this._ignorer('preuve'); return; }
    if(m.t === 'accueil' || m.t === 'refus'){
      // Lié à cette arrivée : l'hôte recopie la clé publique de ma paire, neuve à chaque arrivée (un accueil ou un
      // refus capté lors d'une arrivée passée, puis rejoué, est écarté). Exigé avant l'entrée, et pour tout accueil.
      if((!this.entre || m.t === 'accueil') && m.pour !== this.paire.pub){ this._ignorer('pour'); return; }
      const v = m.t === 'accueil' ? validerAccueil(m, this.vo) : validerRefus(m);
      if(!v){ this._ignorer('prive'); return; }
      this._hoteVu();
      v._cle = cle; v._compteur = compteur;
      // Retour : un refus à la clé de salon n'est retenu qu'à défaut d'accueil à ma clé de siège (fin du délai).
      if(!this.entre && parSalon && this._retour && v.t === 'refus'){ this._refusSalon = v; this._ignorer('refusSalonEnAttente'); return; }
      if(this._resoudre('accueil', v)) return;
      if(!this.entre) return;
      if(v.t === 'accueil') this._appliquerAccueil(v, false);
      else this._annoncerFin(v.motif, null, 'prive');   // confirmé seulement si l'hôte ne me répond plus
      return;
    }
    if(!this.entre) return;
    if(m.t === 'debut'){
      const d = validerDebut(m.debut, this.vo); if(!d){ this._ignorer('prive'); return; }
      this._hoteVu(); this._debutConfirme(d); return;
    }
    if(m.t === 'recalage'){ this._hoteVu(); this._recaler(m.ordre, m.ctl); return; }
    // Fin de partie confirmée par l'hôte lui-même (clé de siège, preuve) : seule fin tenue pour sûre.
    if(m.t === 'fin'){
      const e = validerEvenement(m.fin, this.vo); if(!e || e.t !== 'fin'){ this._ignorer('prive'); return; }
      this._hoteVu(); journal('fin confirmée par l’hôte (message privé)');
      return this._fin('fin', e, true);
    }
    if(m.t === 'reponse'){
      const v = validerReponse(m); if(!v){ this._ignorer('prive'); return; }
      this._hoteVu();
      if(v.accepte){
        const change = v.siege !== this.siege || v.equipe !== this.equipe;
        this.siege = v.siege; this.camp = v.camp; this.equipe = v.equipe;
        if(change) this._emettre('siege', {siege:this.siege, camp:this.camp, equipe:this.equipe});
      }
      const f = this._reponses.get(v.ref); if(f){ this._reponses.delete(v.ref); f({accepte:v.accepte, motif:v.motif, siege:v.siege, camp:v.camp, equipe:v.equipe}); }
      return;
    }
    if(m.t === 'expulse'){ this._hoteVu(); return this._annoncerFin('expulse', null, 'prive'); }   // le motif libre de l'hôte n'est pas transmis
    if(m.t === 'rattrapage'){
      if(!Array.isArray(m.evts) || m.evts.length > REGLAGES.memoireEvenements + REGLAGES.margeRattrapage){ this._ignorer('prive'); return; }
      this._hoteVu();
      const l = [];
      for(const x of m.evts){ const e = validerEvenement(x, this.vo); if(e) l.push(e); else this._ignorer('evenement'); }
      l.sort((a, b) => a.s - b.s);
      // La réponse de l'hôte fait foi : elle remplace les événements en attente de même numéro, et ceux qui
      // dépassent son dernier numéro sont des faux (marge nulle depuis le 14 novembre 2026 : un vrai événement
      // jeté à tort revient par le rattrapage suivant).
      for(const e of l){
        if(this.attenteEvts.has(e.s)) this.attenteEvts.set(e.s, e);
        if(e.t === 'debut') this._debutConfirme(e);
        // Conflit tranché : l'événement déjà livré sous ce numéro n'était pas celui de l'hôte → le vrai, en retard.
        if(e.s <= this.dernierEvt && this.conflits.has(e.s)){
          this.conflits.delete(e.s);
          const vu = this.livres.get(e.s);
          if(vu !== undefined && vu !== JSON.stringify(e)){ this._ignorer('evenementForge'); this.stats.evenements.tardifs++; this._diffuser(e); }
        }
      }
      // Conflit absent d'une réponse qui couvre son numéro (l'hôte ne l'a plus en mémoire) : abandonné.
      if(l.length) for(const k of [...this.conflits]) if(k >= l[0].s && k <= this.dernierEvt && !l.some(e => e.s === k)) this.conflits.delete(k);
      if(Number.isSafeInteger(m.dernier)){
        for(const k of [...this.attenteEvts.keys()]) if(k > m.dernier){ this.attenteEvts.delete(k); this._ignorer('evenementHorsBornes'); }
        if(!this.attenteEvts.size) this.trouDepuis = 0;
      }
      for(const e of l){ if(e.s > this.dernierEvt && !this.attenteEvts.has(e.s)) this.stats.evenements.rattrapes++; this._traiterEvt(e); }
      if(m.incomplet === true) this._sauterTrou();
      // Une fin retrouvée dans le rattrapage privé (réponse de l'hôte, clé de siège) est sûre.
      const f = l.find(e => e.t === 'fin');
      if(f && !this.fini){ journal('fin confirmée par l’hôte (rattrapage)'); this._fin('fin', f, true); }
    }
  }
  _sauterTrou(){
    if(!this.attenteEvts.size) return;
    const l = [...this.attenteEvts.values()].sort((a, b) => a.s - b.s);
    const de = this.dernierEvt + 1, a = l[0].s - 1;
    this.stats.evenements.perdus += a - de + 1;
    this._emettre('evenementsPerdus', {de, a});
    this.attenteEvts.clear(); this.trouDepuis = 0;
    this.dernierEvt = a;
    for(const e of l) this._traiterEvt(e);
  }
  _pong(octets){
    if(octets.length !== 4) return;
    const ts = new DataView(octets.buffer, octets.byteOffset, 4).getUint32(0, true);
    const x = ((Math.round(maintenant()) >>> 0) - ts) >>> 0;
    if(x > 60000) return;
    this.pongT = maintenant();                     // l'hôte me reconnaît (sert à démentir un refus forgé)
    this._hoteVu();                                // signe de vie authentifié (délais hoteInjoignableMs, hoteAbandonMs)
    this.rtt =this.rtt == null ? x : this.rtt*0.8 + x*0.2;
    this.echantillonsRtt.push(x); if(this.echantillonsRtt.length > 1000) this.echantillonsRtt.shift();
  }
  _battre(){
    if(this.fini || !this.entre || !this.jeton) return;
    const b = new Uint8Array(22), v = new DataView(b.buffer);
    const d = this.recepteur.dernier;
    v.setUint16(0, d ? d.n : 0, true); v.setUint8(2, this.demandeComplet ? 1 : 0);
    v.setUint32(4, Math.round(maintenant()) >>> 0, true); v.setUint16(8, this.rtt == null ? 0xFFFF : Math.min(65534, Math.round(this.rtt)), true);
    v.setUint32(10, parseInt(this.jeton.slice(0, 8), 16), false);   // preuve : 4 premiers octets du jeton
    this.cVie = Math.max(this.cVie + 1, Date.now());
    v.setFloat64(14, this.cVie, true);                               // compteur strictement croissant (refus du rejeu)
    this.transport.publier(this.S.vie(this.id), b, {qos:0, cle:this._cle});
  }
  _surveiller(){
    if(this.fini) return;
    this._verifierFinAnnoncee(); if(this.fini) return;
    if(this.debutPublic && !this.debut) this._demanderRattrapage(this.debutPublic.s - 1);   // message privé du lancement perdu ?
    const t = maintenant();
    if(!this.hoteInjoignable && t - this.dernierHote > REGLAGES.hoteInjoignableMs){ this.hoteInjoignable = true; this._emettre('hoteInjoignable', {will:false}); }
    if(this.willHote && t - this.willHote > REGLAGES.graceHoteMs) return this._fin('hoteParti');
    // Ma propre connexion est coupée : c'est elle qui est en cause, pas l'hôte (motif et texte le disent). En partie,
    // j'attends son retour aussi longtemps que l'hôte garde mon siège : delaiConfieMs, plus le temps qu'il met à
    // remarquer mon silence (il date mon absence de ce moment-là) ; dans le salon, hoteAbandonMs.
    const coupe = !!this.decoDepuis || !this.transport.connecte;
    const finCoupe = () => this._fin('connexionPerdue', null, false, this.debut ? MESSAGES.connexionPerdue : MESSAGES.connexionPerdueSalon);
    // Borne absolue : aucun signe réel de l'hôte depuis delaiConfieMs + hoteAbandonMs, quoi que fasse ma connexion.
    if(t - this.dernierHoteReel > REGLAGES.delaiConfieMs + REGLAGES.hoteAbandonMs) return coupe ? finCoupe() : this._fin('hoteInjoignable');
    if(coupe){
      if(t - this.dernierHote > (this.debut ? REGLAGES.delaiConfieMs + REGLAGES.silenceInjoignableMs : REGLAGES.hoteAbandonMs)) return finCoupe();
    } else if(t - this.dernierHote > REGLAGES.hoteAbandonMs) return this._fin('hoteInjoignable');
    if(this.memoT && t - this.memoT > REGLAGES.rafraichirMemoireMs) this._memoriser();   // partie de plus de 3 h
    if(this.attenteEvts.size){
      if(t - this.trouDepuis > 5000) this._sauterTrou(); else this._demanderRattrapage();
    }
  }
  _ctl(d, donnees){
    if(this.fini || !this.jeton) return 0;
    const s = ++this.sCtl;
    this.transport.publier(this.S.ctl(this.id), JSON.stringify(Object.assign({}, donnees, {s, j:this.jeton, d})), {qos:1, cle:this._cle});
    return s;
  }
  _demande(d, donnees){
    return new Promise(ok => {
      const s = this._ctl(d, donnees); if(!s) return ok({accepte:false, motif:'horsSalon'});
      const t = setTimeout(() => { this._reponses.delete(s); ok({accepte:false, motif:'sansReponse'}); }, 6000);
      this._reponses.set(s, r => { clearTimeout(t); ok(r); });
    });
  }

  // --- Commandes de l'invité ---
  pret(valeur = true){ return this._demande('pret', {valeur:!!valeur}); }
  demanderSiege(i){ return this._demande('siege', {siege:i | 0}); }
  demanderEquipe(e){ return this._demande('equipe', {equipe:e | 0}); }
  demanderFaction(f){ return this._demande('faction', {faction:String(f).slice(0, 16)}); }
  envoyerOrdre(ordre){
    if(this.fini || !this.entre || !ordre || typeof ordre !== 'object') return 0;
    if(!prendre(this.seau)){ this.stats.ordres.refusesLocalement++; journal('ordre refusé localement (débit)'); return 0; }
    const s = ++this.sOrdre, m = Object.assign({}, ordre, {s, j:this.jeton}); delete m.camp;
    const octets = ENC.encode(JSON.stringify(m));
    if(octets.length > REGLAGES.tailleOrdreMax){ this.stats.ordres.refusesLocalement++; return 0; }
    this.transport.publier(this.S.ordres(this.id), octets, {qos:1, cle:this._cle});
    this.stats.ordres.envoyes++;
    return s;
  }
  latence(){ return this.rtt; }
  debit(){ return this.transport.compteur.lire(); }
  statistiques(){
    const e = this.echantillonsRtt.slice().sort((a, b) => a - b), q = p => e.length ? e[Math.min(e.length - 1, Math.floor(p*e.length))] : null;
    return {instantanes:Object.assign({}, this.recepteur.stats), evenements:Object.assign({}, this.stats.evenements), ordres:Object.assign({}, this.stats.ordres),
      ignores:Object.assign({}, this.stats.ignores),
      sceau:JSON.parse(JSON.stringify(this.transport.stats || {acceptes:0, rejets:{}})),
      rtt:{lisse:this.rtt, mediane:q(0.5), p95:q(0.95), pire:e.length ? e[e.length - 1] : null, echantillons:e.length}};
  }
  couperTransport(dureeMs){ this.transport.couper(dureeMs); }   // essais (boucle locale : durée de la coupure)
  async quitter(){
    if(this.fini) return;
    if(this.memoriser) ecrireMemo(this.code, null);
    await this._abandonner();
  }
  // Rechargement de la page (carte de l'hôte, ajout du 14 novembre 2026 pour jeu.js) : connexion fermée proprement
  // sans annoncer de départ (ni « parti », ni dernière volonté) ; la mémoire du siège est gardée, et la page
  // rechargée reprend le même siège. L'hôte ne voit qu'un silence (départ « silence » après 5 s sans retour).
  async fermerSansPartir(){ await this._fermerDiscretement(); }
  // oublier : vrai seulement quand la fin est sûre (message privé « fin » de l'hôte, ou fin dans son rattrapage) ; c'est
  // aussi le seul cas où un « parti » avec preuve est publié. Sinon la
  // mémoire du siège est gardée jusqu'à son délai de 3 heures : si la fin était fausse (coïncidence d'une annonce
  // forgée et d'un silence de l'hôte), le lien rouvert rend le siège pendant le délai de grâce (delaiConfieMs) ; si elle était vraie,
  // le lien rouvert trouve un salon fermé et la mémoire est effacée à ce moment (refus définitif).
  async _fin(motif, donnees, oublier, message){
    if(this.fini) return;
    this.fini = true; this.finAnnoncee = null;
    for(const a of this._arrets) a(); this._arrets = [];
    for(const f of this._reponses.values()) f({accepte:false, motif:'fin'}); this._reponses.clear();
    if(this.memoriser && oublier === true) ecrireMemo(this.code, null);
    // Le texte vient toujours de MESSAGES (motif local) ; `donnees` = l'événement « fin » contrôlé, ou null.
    this._emettre('fin', {motif, message:message || MESSAGES[motif] || MESSAGES.fin, donnees:donnees || null});
    // Fin non sûre (annonce confirmée par un silence, hôte injoignable…) : pas de « parti » avec preuve (cinquième tour :
    // une fausse fin confirmée libérait le siège chez l'hôte).
    await this._publierDepart(oublier !== true);
    await this.transport.fermer();
  }
}

// -------------------------------------------------------------------------------------
// 8. Interface publique
// -------------------------------------------------------------------------------------
global.Reseau = {
  PROTO, SERVEURS_MQTT, CHAINE_DEFAUT, BIBLIOTHEQUE, ALPHABET, REGLAGES, MESSAGES, ETAPES,
  chargerBibliotheque,
  normaliserCode, formaterCode, nettoyerPseudo,
  creerSalon, rejoindre,
  memoire, oublierMemoire,
  definirTypes,
  // Fonctions pures de la signature (essais) : SHA-256 et HMAC synchrones, dérivation du salon (Promise), clé de
  // siège, enveloppe. Aucune n'agit sur un salon.
  Sceau:{sha256, hmac, deriverSalon, cleSiege, sceller, ouvrir},
  Codec:{encoder, decoder, lireEntete, creerEmetteur, creerRecepteur, types:() => T ? Object.fromEntries(Object.keys(TABLES_VIDES).map(k => [k, T[k].slice()])) : null},
  // Contrôles de forme des messages reçus (essais, 26 novembre 2026) : fonctions pures, rendent une copie propre ou null.
  Validation:{description:(d, o) => validerDescription(d, o || {}), debut:(x, o) => validerDebut(x, o || {}), sieges:(l, o) => validerSieges(l, o || {}, false)},
  simuler(p){ busDefaut = p ? new Bus(p) : null; return busDefaut; },
  nouveauBus(p){ return new Bus(p || {}); },
  journal(actif){ journalActif = !!actif; return journalActif; },
  lignesJournal(){ return lignesJournal.slice(); },
  debit:debitGlobal,
  minuteur,
};
})(window);
