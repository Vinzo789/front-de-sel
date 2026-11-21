'use strict';
/* =====================================================================
   Outil de contrôle (auteur des missions Halden) — à coller ou charger
   dans la console d'une page front-de-sel.html?mission=<id> une fois la
   carte chargée par le moteur. Contrôle, sur la VRAIE grille du moteur
   (rochers aléatoires compris) :
   - que les bâtiments et unités de départ sont sur des tuiles libres ;
   - que les points clés (zones, renforts, chemins) sont atteignables
     depuis le départ du joueur, avec la recherche de chemin du moteur.
   Renvoie la liste des problèmes (vide = tout va bien).
   Contient aussi, plus bas, les outils de contrôle de l'escarmouche et
   de l'aviation (testerEscarmouche, duelAerien), à lancer depuis la
   page d'accueil.
   ===================================================================== */
// ---------------------------------------------------------------------
//  Partie simulée sans rendu (utile quand le rendu 3D est indisponible) :
//  demarrerMission() puis simuler(secondes, robot) ; le journal SIMLOG
//  note chaque changement d'état des objectifs et la fin de mission.
//  « robot » est une fonction appelée chaque seconde de jeu pour donner
//  des ordres au camp J, comme le ferait un joueur.
// ---------------------------------------------------------------------
var SIMLOG = [];
function simuler(duree, robot){
  const dt = 0.05; let etatPrec = '';
  for(let k = 0; k < duree/dt; k++){
    try { miseAJour(dt); } catch(e){ SIMLOG.push('ERREUR t=' + temps.toFixed(1) + ' ' + e.message); return; }
    if(k % 20 === 0 && robot) robot();
    const etat = MS.objectifs.filter(o => o.visible).map(o => o.id + ':' + o.etat).join(' ');
    if(etat !== etatPrec){ SIMLOG.push(Math.round(temps) + 's ' + etat); etatPrec = etat; }
    if(MS.fin){ SIMLOG.push(Math.round(temps) + 's FIN ' + (MS.fin.victoire ? 'victoire' : 'défaite ' + (MS.fin.texte || ''))); return; }
  }
}
// Outils pour écrire un robot
const robotJ = () => ents.filter(e => e.camp === 'J' && !e.mort);
// Ordres du robot (novembre 2026, étape 1 du multijoueur) : comme un joueur, il passe par
// executerOrdre('J', ordre). OPTIONS_ROBOT.direct (comparaisons d'empreintes) : true = ancien robot, qui
// écrit directement dans les entités (fonction « direct ») ; 'imite' = ancien robot plus les écritures que
// l'exécution de l'ordre fait en plus (fonction « ajout »), pour prouver que l'écart vient de là.
// ROBOT_REFUS compte les ordres refusés par motif.
window.ROBOT_REFUS = {};
function ordreRobot(ordre, direct, ajout){
  const m = typeof OPTIONS_ROBOT !== 'undefined' && OPTIONS_ROBOT.direct;
  if(m && direct){ direct(); if(m === 'imite' && ajout) ajout(); return true; }
  const r = executerOrdre('J', ordre);
  if(!r.ok) ROBOT_REFUS[r.motif] = (ROBOT_REFUS[r.motif] || 0) + 1;
  return r.ok;
}
// Raccourcis : mise en file, chantier, attaque-déplacement d'une unité, clic droit d'une unité sur une entité.
const robotCommander = (b, t) => ordreRobot({type:'produire', batId:b.id, unite:t}, () => commander(b, t));
const robotConstruire = (type, c, r, o) => ordreRobot({type:'construire', bat:type, c, r, ouvrierIds:[o.id]}, () => construireBatiment('J', type, c, r, [o]));
const robotAttaqueDeplacement = (u, x, y) => ordreRobot({type:'attaqueDeplacement', ids:[u.id], x, y, cibleId:null},
  () => { u.ordre = {type:'attaqueDeplacement', x, y}; }, () => { u.cible = null; u.chemin = null; });
const robotPouvoir = (cle, x, y) => ordreRobot(x == null ? {type:'pouvoir', cle} : {type:'pouvoir', cle, x, y}, () => activerPouvoir('J', cle, x, y));
// Économie à collecteurs (novembre 2026) : les ouvriers ne récoltent plus. Le robot garde quatre
// ouvriers (chantiers, réparations) et rachète ses collecteurs jusqu'à trois, qui travaillent seuls.
// « armee » ne contient que des unités armées (ni ouvriers ni collecteurs).
const ROBOT_COLLECTEURS = 3, ROBOT_OUVRIERS = 4;
function robotEconomie(){
  const uns = robotJ().filter(e => e.est === 'unite'), ouv = uns.filter(u => u.def.ouvrier);
  const qg = robotJ().find(b => b.type === 'qg');
  const coll = uns.filter(u => u.def.collecteur).length + (qg ? qg.file.filter(t => t === 'collecteur').length : 0);
  if(qg && !qg.enCours && qg.file.length < 1){
    if(coll < ROBOT_COLLECTEURS && noeuds.some(n => n.reste > 0) && camps.J.reserves >= UNITES.collecteur.cout) robotCommander(qg, 'collecteur');
    else if(ouv.length < ROBOT_OUVRIERS && camps.J.reserves >= 50) robotCommander(qg, FACTIONS[camps.J.faction].ouvrier);
  }
  // Ouvriers inoccupés : ils réparent ce qui est entamé (clic droit sur le bâtiment).
  for(const o of ouv) if(!o.ordre){ const b = batimentAReparer(o, 1400); if(b) ordreRobot({type:'droit', ids:[o.id], x:b.x, y:b.y, cibleId:b.id},
    () => { o.ordre = {type:'reparer', bat:b}; }, () => { o.chemin = null; }); }
  return {qg, ouv, armee: uns.filter(u => !u.def.ouvrier && !u.def.collecteur)};
}
function robotBatir(type, pres){
  const bats = robotJ().filter(b => b.est === 'batiment');
  if(bats.some(b => b.type === type)) return;
  const D = BATIMENTS[type]; if(camps.J.reserves < D.cout) return;
  if(D.requiert && !bats.some(b => b.type === D.requiert && !b.enCours)) return;
  const o = robotJ().find(u => u.est === 'unite' && u.def.ouvrier); if(!o) return;
  const p = trouverEmplacement(type, pres || bats[0]); if(p) robotConstruire(type, p.c, p.r, o);
}
function robotProduire(type){
  for(const b of robotJ()) if(b.est === 'batiment' && !b.enCours && b.file.length < 2){
    const prod = FACTIONS[camps.J.faction].production[b.type] || [];
    // Commande seulement si les réserves suffisent (sinon commander() afficherait « Réserves
    // insuffisantes » à chaque passage du robot et fausserait le relevé des messages).
    // Même précaution pour un aéroport complet (trois places : avions présents + commandés).
    if(!prod.includes(type) || !UNITES[type] || camps.J.reserves < UNITES[type].cout) continue;
    if(UNITES[type].avion && (typeof aeroportPlein === 'function' ? aeroportPlein(b) : avionsDe(b).length + b.file.length >= PLACES_AEROPORT.length)) continue;
    if(UNITES[type].forme === 'helico' && typeof helicosPlein === 'function' && helicosPlein(b)) continue;   // quatre par aéroport
    robotCommander(b, type);
  }
}
function robotAttaquer(unites, x, y){
  for(const u of unites) if(!u.ordre && !u.cible){ const ax = x + (Math.random()-.5)*100, ay = y + (Math.random()-.5)*100; robotAttaqueDeplacement(u, ax, ay); }
}

// Frappe de précision sur la première cible d'un type donné proche de l'armée.
function robotFrappe(armee, types){
  if(camps.J.faction !== 'halden' || camps.J.points < 3) return;
  const c = ents.find(e => e.camp === 'I' && !e.mort && types.includes(e.type) && armee.some(u => Math.hypot(u.x-e.x, u.y-e.y) < 450));
  if(c) robotPouvoir('frappe', c.x, c.y);
}
// Esquive (missions Karsk) : comme un joueur qui voit le marqueur d'une Frappe ou d'un Essaim
// Halden au sol, les unités prises dans le cercle s'en écartent (2,2 s de préavis pour l'Essaim,
// 1,2 s pour la Frappe ; le robot ne regarde qu'une fois par seconde, l'esquive reste partielle).
// Renvoie la liste des unités libres (celles qui n'esquivent pas).
function robotEsquive(armee){
  for(const m of effets) if(m.type === 'marqueur' && (m.pouvoir === 'essaim' || m.pouvoir === 'frappe'))
    for(const u of armee){
      const d = Math.hypot(u.x-m.x, u.y-m.y);
      if(d > m.r + 30 || u.esquiveT > temps) continue;
      const a = d > 1 ? Math.atan2(u.y-m.y, u.x-m.x) : Math.random()*Math.PI*2;
      u.ordre = {type:'aller', x:m.x + Math.cos(a)*(m.r + 90), y:m.y + Math.sin(a)*(m.r + 90)};
      u.cible = null; u.chemin = null; u.esquiveT = temps + 4;
    }
  return armee.filter(u => !(u.esquiveT > temps));
}
// Chantier abandonné (missions Karsk) : robotBatir prend le premier ouvrier venu, qui peut être
// celui d'un chantier en cours ; le chantier resterait alors inachevé. Comme un joueur qui le
// voit, on y renvoie un ouvrier. Renvoie vrai s'il y a un chantier en cours.
function robotChantiers(){
  const ch = robotJ().filter(b => b.est === 'batiment' && b.enCours);
  for(const b of ch) if(!robotJ().some(u => u.ordre && u.ordre.type === 'construire' && u.ordre.bat === b)){
    const o = robotJ().filter(u => u.est === 'unite' && u.def.ouvrier).sort((a,c) => Math.hypot(a.x-b.x,a.y-b.y) - Math.hypot(c.x-b.x,c.y-b.y))[0];
    if(o) ordreRobot({type:'droit', ids:[o.id], x:b.x, y:b.y, cibleId:b.id}, () => { o.ordre = {type:'construire', bat:b}; o.chemin = null; o.cible = null; });
  }
  return ch.length > 0;
}
// Robots « joueur moyen » des missions Halden (ils ne font pas de micro-gestion).
const ROBOTS = {
  'halden-1': (() => { let phare = false; return () => {
    const {qg, armee} = robotEconomie();
    const esc = armee.filter(u => u.nom === 'escouade'), autres = armee.filter(u => u.nom !== 'escouade');
    if(!qg){ robotAttaquer(esc, 2000, 1100); return; }
    for(const u of esc) if(!u.ordre && !u.cible && Math.hypot(u.x-2000, u.y-1130) > 200) u.ordre = {type:'attaqueDeplacement', x:2000, y:1130};
    robotBatir('caserne', qg); robotProduire('operateur');
    const menace = ents.find(e => e.camp === 'I' && !e.mort && e.est === 'unite' && Math.hypot(e.x-qg.x, e.y-qg.y) < 600);
    if(menace) for(const u of autres) if(!u.cible) u.ordre = {type:'attaqueDeplacement', x:menace.x, y:menace.y};
    if(!phare && autres.length){ phare = true; autres[0].ordre = {type:'aller', x:1000, y:1680}; }
    if(autres.filter(u => !u.ordre && !u.cible).length >= 9) robotAttaquer(autres, 2700, 480);
    robotFrappe(autres, ['bunker', 'caserne', 'depot']);
  }; })(),
  'halden-2': () => {
    const {qg, armee} = robotEconomie();
    if(qg){ robotBatir('caserne', qg); robotBatir('usine', qg); }
    robotProduire('lynx'); if(camps.J.reserves > 400) robotProduire('operateur');
    const conv = ents.filter(e => e.nom === 'convoi' && !e.mort);
    if(!conv.length) return;
    const cx = conv.reduce((s,e) => s+e.x, 0)/conv.length, cy = conv.reduce((s,e) => s+e.y, 0)/conv.length;
    const o = conv[0].ordre && conv[0].ordre.points ? conv[0].ordre.points[conv[0].ordre.i || 0] : null;
    let tx = cx, ty = cy;
    if(o){ const d = Math.hypot(o.x-cx, o.y-cy) || 1; tx = cx + (o.x-cx)/d*Math.min(250, d); ty = cy + (o.y-cy)/d*Math.min(250, d); }
    const barrage = MS.objectifs.find(x => x.id === 'barrage' && x.etat === 'actif');
    if(barrage && armee.length >= 12){ tx = 2520; ty = 800; }
    for(const u of armee) if(!u.cible && (!u.ordre || Math.hypot(u.ordre.x-tx, u.ordre.y-ty) > 150) && Math.hypot(u.x-tx, u.y-ty) > 160)
      u.ordre = {type:'attaqueDeplacement', x:tx + (Math.random()-.5)*120, y:ty + (Math.random()-.5)*120};
    robotFrappe(armee, ['bunker', 'grele', 'ours']);
  },
  'halden-3': () => {
    const {qg, armee} = robotEconomie();
    if(qg){ robotBatir('usine', qg); }
    robotProduire('lynx'); robotProduire('operateur');
    if(MS.autorises && MS.autorises.unites && MS.autorises.unites.has('bastion')) robotProduire('bastion');
    const tenir = MS.objectifs.find(x => x.id === 'tenir' && x.etat === 'actif');
    let [tx, ty] = tenir ? [1400, 1000] : (armee.length >= 16 ? [1950, 1000] : [1400, 1000]);
    const menace = qg && ents.find(e => e.camp === 'I' && !e.mort && e.est === 'unite' && Math.hypot(e.x-qg.x, e.y-qg.y) < 700);
    if(menace){ tx = menace.x; ty = menace.y; }
    // Comme un joueur qui écoute la radio : à l'annonce du Marteau (déclencheur « marteauAnnonce »,
    // pouvoir 6 s plus tard, impacts de +8,6 s à +11,9 s, jusqu'à 300 px de 1420, 1000), sortie de
    // la zone vers l'ouest (x ≈ 1060, hors d'atteinte), puis retour sur la zone (cible habituelle).
    // Retour à +12 s plutôt qu'à +9 s : à +9 s, les unités revenaient sous les derniers impacts.
    const annonce = MS.declencheurs.find(d => d.id === 'marteauAnnonce');
    if(annonce && annonce.executeT != null && temps - annonce.executeT < 12){
      for(const u of armee) if(Math.hypot(u.x-1420, u.y-1000) < 330 && (!u.ordre || u.ordre.type !== 'aller' || u.ordre.x > 1100))
        { u.ordre = {type:'aller', x:1060 + (Math.random()-.5)*80, y:1000 + (Math.random()-.5)*160}; u.cible = null; u.chemin = null; }
      return;
    }
    // Comme la radio le demande (« allez la chercher ») : une Grêle qui pilonne la zone est prise en
    // chasse par les Lynx les plus proches (4 au plus). Sans cela, une seule Grêle tuait 15 à 19
    // unités groupées sur la zone en 30 s, et le robot perdait une partie sur deux.
    const grele = ents.find(e => e.camp === 'I' && !e.mort && e.type === 'grele' && Math.hypot(e.x-1420, e.y-1000) < 900);
    if(grele){
      const chasseurs = armee.filter(u => u.type === 'lynx').sort((a,b) => Math.hypot(a.x-grele.x,a.y-grele.y) - Math.hypot(b.x-grele.x,b.y-grele.y)).slice(0, 4);
      for(const u of chasseurs) if(!u.ordre || u.ordre.type !== 'attaquer' || u.ordre.cible !== grele){ u.ordre = {type:'attaquer', cible:grele}; u.chemin = null; }
    }
    for(const u of armee) if(!u.cible && Math.hypot(u.x-tx, u.y-ty) > 170 && (!u.ordre || Math.hypot(u.ordre.x-tx, u.ordre.y-ty) > 150))
      u.ordre = {type:'attaqueDeplacement', x:tx + (Math.random()-.5)*160, y:ty + (Math.random()-.5)*160};
    robotFrappe(armee, ['bunker', 'ours', 'grele']);
  },
  'halden-4': () => {
    const {qg, armee} = robotEconomie();
    if(qg){ robotBatir('usine', qg); robotBatir('relais', qg); }
    robotProduire('bastion'); robotProduire('lynx'); if(camps.J.reserves > 600) robotProduire('operateur');
    const menace = qg && ents.find(e => e.camp === 'I' && !e.mort && e.est === 'unite' && Math.hypot(e.x-qg.x, e.y-qg.y) < 700);
    let tx, ty;
    if(menace){ tx = menace.x; ty = menace.y; }
    else if(armee.length >= 28){
      const c = ents.filter(e => e.camp === 'I' && !e.mort && e.est === 'batiment').sort((a,b) => Math.hypot(a.x-400,a.y-1000) - Math.hypot(b.x-400,b.y-1000))[0];
      if(c){ tx = c.x; ty = c.y; }
    }
    if(tx != null) for(const u of armee) if(!u.cible && (!u.ordre || Math.hypot(u.ordre.x-tx, u.ordre.y-ty) > 200))
      u.ordre = {type:'attaqueDeplacement', x:tx + (Math.random()-.5)*120, y:ty + (Math.random()-.5)*120};
    // Frappe : jamais à moins de 250 px de la station (consigne de la mission)
    const st = ents.find(e => e.nom === 'stationUsine');
    const c = ents.find(e => e.camp === 'I' && !e.mort && ['bunker','ours','grele'].includes(e.type) && armee.some(u => Math.hypot(u.x-e.x, u.y-e.y) < 450) && (!st || Math.hypot(st.x-e.x, st.y-e.y) > 250));
    if(c && camps.J.points >= 3) robotPouvoir('frappe', c.x, c.y);
  },
  // Karsk 1 (novembre 2026) : comme la radio l'enseigne. Conscrits au rassemblement, Grêle sur
  // les tourelles (à 400 m), assaut de la caserne une fois les tourelles tombées ; puis base
  // (caserne, dépôt), conscrits, Renforts, et la patrouille reçue près du QG.
  'karsk-1': () => {
    const uns = robotJ().filter(e => e.est === 'unite');
    const qg = robotJ().find(b => b.type === 'qg');
    const greles = uns.filter(u => u.type === 'grele'), cons = uns.filter(u => u.type === 'conscrit');
    if(!qg){
      const tours = ents.filter(e => e.nom === 'poste' && !e.mort && e.type === 'tourelle');
      const caserne = ents.find(e => e.nom === 'poste' && !e.mort && e.type === 'caserne');
      for(const g of greles){
        const c = tours.sort((a,b) => Math.hypot(a.x-g.x,a.y-g.y) - Math.hypot(b.x-g.x,b.y-g.y))[0] || caserne;
        if(c && (!g.ordre || g.ordre.cible !== c)) g.ordre = {type:'attaquer', cible:c};
      }
      for(const u of cons) if(!u.cible){
        if(!tours.length && caserne){ if(!u.ordre || u.ordre.cible !== caserne) u.ordre = {type:'attaquer', cible:caserne}; }
        else if(!u.ordre && Math.hypot(u.x-1600, u.y-560) > 90) u.ordre = {type:'aller', x:1600 + (Math.random()-.5)*120, y:560 + (Math.random()-.5)*80};
      }
      return;
    }
    const {armee} = robotEconomie();
    if(!robotChantiers()){ robotBatir('caserne', qg); robotBatir('depot', qg); }
    robotProduire('conscrit');
    if(camps.J.points >= 3) robotPouvoir('renforts');
    const menace = ents.filter(e => e.camp === 'I' && !e.mort && e.est === 'unite' && Math.hypot(e.x-qg.x, e.y-qg.y) < 900)
      .sort((a,b) => (b.type === 'lynx') - (a.type === 'lynx'))[0];
    for(const u of armee) if(u.type !== 'grele'){
      if(menace){ if(!u.cible && (!u.ordre || u.ordre.cible !== menace)) u.ordre = {type:'attaquer', cible:menace}; }
      else if(!u.ordre && !u.cible && Math.hypot(u.x-qg.x, u.y-qg.y) > 250) u.ordre = {type:'aller', x:qg.x + (Math.random()-.5)*200, y:qg.y - 150 + (Math.random()-.5)*100};
    }
  },
  // Karsk 2 (novembre 2026) : défense de l'entrepôt. Économie, usine, deux bunkers près de
  // l'entrepôt, conscrits, Ours, Sentinelles dès leur déblocage ; l'armée se tient devant
  // l'entrepôt et charge tout ennemi à moins de 650 m de lui.
  'karsk-2': () => {
    const {qg, armee} = robotEconomie();
    robotChantiers();
    if(qg){ robotBatir('usine', qg); }
    const ent = ents.find(e => e.nom === 'entrepot' && !e.mort) || {x:1520, y:1200};
    const bunkers = robotJ().filter(b => b.type === 'bunker' && Math.hypot(b.x-ent.x, b.y-ent.y) < 300);
    const o = robotJ().find(u => u.est === 'unite' && u.def.ouvrier && !u.enConstruction);
    if(bunkers.length < 2 && !robotJ().some(b => b.type === 'bunker' && b.enCours) && camps.J.reserves >= BATIMENTS.bunker.cout + 100 && o){
      const p = trouverEmplacement('bunker', {x:ent.x + (bunkers.length ? 160 : -160), y:ent.y + 120});
      if(p) robotConstruire('bunker', p.c, p.r, o);
    }
    if(autorise('unites', 'sentinelle') && armee.filter(u => u.type === 'sentinelle').length < 4) robotProduire('sentinelle');
    if(camps.J.reserves > 250) robotProduire('ours');
    robotProduire('conscrit');
    if(camps.J.points >= 3) robotPouvoir('renforts');
    const menace = ents.filter(e => e.camp === 'I' && !e.mort && e.est === 'unite' && Math.hypot(e.x-ent.x, e.y-ent.y) < 650)
      .sort((a,b) => Math.hypot(a.x-ent.x,a.y-ent.y) - Math.hypot(b.x-ent.x,b.y-ent.y))[0];
    for(const u of armee){
      if(menace){ if(!u.cible && (!u.ordre || Math.hypot((u.ordre.x||0)-menace.x, (u.ordre.y||0)-menace.y) > 150)) u.ordre = {type:'attaqueDeplacement', x:menace.x, y:menace.y}; }
      else if(!u.ordre && !u.cible && Math.hypot(u.x-ent.x, u.y-ent.y-100) > 200) u.ordre = {type:'aller', x:ent.x + (Math.random()-.5)*300, y:ent.y + 100 + (Math.random()-.5)*120};
    }
  },
  // Karsk 4 : économie, armée lourde, défense de la base, assaut à 30 unités sur le bâtiment le plus
  // proche ; Grêle et Marteau jamais à moins de 380 px de la station (consigne de la mission).
  // Karsk 3 : une antenne après l'autre (Cabane, Est, Centre), armée groupée, Grêle derrière ;
  // retour à la base à l'alerte de la contre-attaque et tant qu'un ennemi la menace.
  // Révision de novembre 2026 (2e passe) : l'ancien robot fonçait sur l'antenne en passant sous les
  // tourelles et ne remplaçait pas ses Grêle ; il prenait la Cabane et le Centre en 2 min, puis
  // perdait armée sur armée devant l'Est (victoire à 25 min). Celui-ci abat d'abord les tourelles
  // qui gardent l'antenne visée, reconstruit ses Grêle et attend 22 unités pour les antennes suivantes.
  'karsk-3': () => {
    const eco = robotEconomie(), qg = eco.qg, armee = robotEsquive(eco.armee);
    if(qg && robotJ().filter(b => b.type === 'bunker').length < 2 && camps.J.reserves > 500) robotBatir('bunker', qg);
    if(armee.filter(u => u.type === 'sentinelle').length < 3) robotProduire('sentinelle');
    if(armee.filter(u => u.type === 'grele').length < 3) robotProduire('grele');
    if(camps.J.reserves > 300) robotProduire('ours');
    robotProduire('conscrit');
    if(camps.J.points >= 3 && qg) robotPouvoir('renforts');
    const base = qg || {x:400, y:400};
    const menace = ents.find(e => e.camp === 'I' && !e.mort && e.est === 'unite' && Math.hypot(e.x-base.x, e.y-base.y) < 750);
    const alerte = MS.declencheurs.find(d => d.id === 'contre_alerte');
    const colonne = alerte.executeT != null && ents.some(e => e.camp === 'I' && !e.mort && (e.nom === 'contre' || e.nom === 'contre_drones'));
    let tx, ty, cible = null;
    if(menace){ tx = menace.x; ty = menace.y; }
    else if(alerte.executeT != null && (temps - alerte.executeT < 40 || colonne)){ tx = base.x + 250; ty = base.y + 250; }
    // La Combe des Puits (1200 de réserves et deux Ours) dès que le Centre est tombé.
    else if(MS.objectifs.find(o => o.id === 'combe').etat === 'actif' && !ents.some(e => e.nom === 'antenne_centre' && !e.mort) && armee.length >= 14){
      tx = 1600; ty = 1650;
    }
    else if(armee.length >= (ents.some(e => e.nom === 'antenne_cabane' && !e.mort) ? 18 : 24)){
      const ant = ['antenne_cabane', 'antenne_est', 'antenne_centre'].map(n => ents.find(e => e.nom === n && !e.mort)).find(Boolean);
      if(ant){
        const tour = ents.filter(e => e.camp === 'I' && !e.mort && e.type === 'tourelle' && Math.hypot(e.x-ant.x, e.y-ant.y) < 350)
          .sort((a,b) => Math.hypot(a.x-base.x,a.y-base.y) - Math.hypot(b.x-base.x,b.y-base.y))[0];
        cible = tour || ant; tx = cible.x; ty = cible.y;
      }
    }
    if(tx == null) return;
    for(const u of armee){
      const d = Math.hypot(u.x-tx, u.y-ty);
      if(cible && d < 450 && (!u.ordre || u.ordre.type !== 'attaquer' || u.ordre.cible !== cible) && (!u.cible || u.cible.est === 'batiment')){ u.ordre = {type:'attaquer', cible}; u.cible = null; continue; }
      if(!u.cible && (!u.ordre || u.ordre.x == null || Math.hypot(u.ordre.x-tx, u.ordre.y-ty) > 200) && d > 180)
        u.ordre = {type:'attaqueDeplacement', x:tx + (Math.random()-.5)*120, y:ty + (Math.random()-.5)*120};
    }
  },
  // Révision de novembre 2026 : l'ancien robot (assaut à 40 unités sans attirer d'abord la
  // garnison) perdait toute son armée vers 4 min 30. Celui-ci suit le conseil de la radio : trois
  // conscrits servent d'appât au carrefour pour faire sortir la garnison, qu'on reçoit chez soi
  // (bunkers, hauteurs) ; l'assaut ne part qu'une fois la garnison battue, armée regroupée.
  'karsk-4': (() => { let phase = 'tenir', appat = null; return () => {
    const eco = robotEconomie(), qg = eco.qg, armee = robotEsquive(eco.armee);
    if(qg) robotBatir('depot', qg);
    if(qg && robotJ().filter(b => b.type === 'bunker').length < 2 && camps.J.reserves > 400) robotBatir('bunker', {x:1600, y:560});
    if(armee.filter(u => u.type === 'sentinelle').length < 5) robotProduire('sentinelle');
    if(armee.filter(u => u.type === 'grele').length < 4 && camps.J.reserves > 440) robotProduire('grele');
    if(camps.J.reserves > 300) robotProduire('ours');
    robotProduire('conscrit');
    if(camps.J.points >= 13) robotPouvoir('renforts');
    const st = ents.find(e => e.nom === 'station' && !e.mort);
    const loinStation = e => !st || Math.hypot(st.x-e.x, st.y-e.y) > 380;
    const sortie = MS.declencheurs.find(d => d.id === 'sortie_garnison').fait;
    const garnison = ents.filter(e => e.camp === 'I' && !e.mort && e.nom === 'garnison').length;
    if(!sortie && (armee.length >= 40 || temps > 330) && !appat){ appat = armee.filter(u => u.type === 'conscrit').slice(0, 3); for(const u of appat) u.ordre = {type:'aller', x:1600, y:700}; }
    if(sortie && appat && appat.length){ for(const u of appat) if(!u.mort) u.ordre = {type:'aller', x:1600, y:450}; appat = []; }
    const libres = armee.filter(u => u.type !== 'grele');
    // Assaut à 44 unités ; à 24 seulement quand il ne leur reste presque plus d'unités. Repli sous
    // 12 unités, sauf s'il n'y a plus personne pour contre-attaquer.
    const unitesI = ents.filter(e => e.camp === 'I' && !e.mort && e.est === 'unite').length;
    // Essai de novembre 2026 (2e passe) : avec un seuil à 44, l'armée plafonnait vers 30 unités
    // (réserves à sec) et l'assaut ne partait qu'à 25 min ; seuil ramené à 30 (18 si presque vide).
    if(phase === 'tenir' && sortie && garnison <= 2 && libres.length >= (unitesI < 5 ? 18 : 30)) phase = 'assaut';
    if(phase === 'assaut' && libres.length < 10 && unitesI >= 5) phase = 'tenir';
    window.R4etat = phase + ' garnison ' + garnison;
    const menace = ents.find(e => e.camp === 'I' && !e.mort && e.est === 'unite' && e.y < (phase === 'assaut' ? 2000 : 680));
    let tx, ty;
    if(menace){ tx = menace.x; ty = menace.y; }
    else if(phase === 'assaut'){
      const c = ents.filter(e => e.camp === 'I' && !e.mort && e.est === 'batiment').sort((a,b) => Math.hypot(a.x-1600,a.y-500) - Math.hypot(b.x-1600,b.y-500))[0];
      if(c){ tx = c.x; ty = c.y; }
    } else armee.forEach((u, i) => {
      // Trois postes espacés (la radio : « ne restez pas groupés ») : une armée en un seul tas
      // attirait l'Essaim ou la frappe de l'IA et fondait en quelques secondes.
      const [px, py] = [[1250, 430], [1600, 470], [1950, 430]][i % 3];
      if(!u.cible && !u.ordre && !(appat && appat.includes(u)) && Math.hypot(u.x-px, u.y-py) > 200)
        u.ordre = {type:'aller', x:px + (Math.random()-.5)*260, y:py + (Math.random()-.5)*160};
    });
    if(tx != null) for(const u of armee){
      if(appat && appat.includes(u)) continue;
      if(u.type === 'grele' && !loinStation({x:tx, y:ty})){ if(!u.ordre) u.ordre = {type:'aller', x:1600, y:600}; continue; }
      if(!u.cible && (!u.ordre || u.ordre.x == null || Math.hypot(u.ordre.x-tx, u.ordre.y-ty) > 200))
        u.ordre = {type:'attaqueDeplacement', x:tx + (Math.random()-.5)*120, y:ty + (Math.random()-.5)*120};
    }
    // Marteau : jamais à moins de 380 px de la station, ni sur ses propres unités.
    if(camps.J.points >= 10){
      const c = ents.find(e => e.camp === 'I' && !e.mort && loinStation(e) && armee.some(u => Math.hypot(u.x-e.x, u.y-e.y) < 500)
        && ents.filter(f => f.camp === 'I' && !f.mort && Math.hypot(f.x-e.x, f.y-e.y) < 220).length >= 4
        && !armee.some(u => Math.hypot(u.x-e.x, u.y-e.y) < 200));
      if(c) robotPouvoir('marteau', c.x, c.y);
    }
  }; })(),
};
// Accessibles depuis la console et les pages de contrôle (les « const » de haut niveau d'un script
// classique ne sont pas des propriétés de window).
window.robotJ = robotJ;
window.ROBOTS = ROBOTS;
// Lance la mission courante avec son robot : renvoie le journal.
function testerMission(duree){
  SIMLOG = [];
  demarrerMission();
  simuler(duree || 1800, ROBOTS[MISSION.id]);
  return {log: SIMLOG, avertissements: [...MS.avertis], radios: MS.radio.file.length,
          J: robotJ().length, I: ents.filter(e => e.camp === 'I' && !e.mort).length, stats: Object.assign({}, stats)};
}

// ---------------------------------------------------------------------
//  Escarmouche simulée et aviation (à lancer depuis la page d'accueil,
//  front-de-sel.html sans paramètre, une fois ce fichier chargé) :
//  - testerEscarmouche('halden' | 'karsk', secondes) : partie libre contre
//    l'ordinateur, jouée par robotEscarmouche ; le journal note les étapes
//    de l'aviation de l'IA et tout avion resté trop longtemps dans une
//    phase de piste ou d'approche (« BLOQUÉ »).
//  - duelAerien('f35', 3, 'sentinelle', 3) : trois avions du camp J, basés
//    sur un aéroport, attaquent trois unités du camp I ; renvoie le bilan.
// ---------------------------------------------------------------------
const TYPES_AVIONS = ['f15', 'f35', 'rafale'];
// Réglages du robot d'escarmouche (à changer depuis la console avant testerEscarmouche) :
// aviation : il bâtit un aéroport et emploie des avions ; attaque : nombre d'unités terrestres
// disponibles à partir duquel il part à l'assaut de la base adverse (0 : il se contente de défendre) ;
// apres : pas d'assaut avant cet instant (secondes de jeu), pour laisser l'ordinateur dérouler son plan.
// nouveautes : il produit aussi les unités et la batterie de novembre 2026 (hélicoptères, réparateurs, DCA).
const OPTIONS_ROBOT = {aviation:true, attaque:12, apres:0, nouveautes:true};
window.OPTIONS_ROBOT = OPTIONS_ROBOT;
// Robot « joueur moyen » d'escarmouche : économie, base complète avec aéroport, armée de terre
// qui défend puis attaque, avions employés selon leur rôle.
function robotEscarmouche(){
  const {qg, armee} = robotEconomie();
  const F = FACTIONS[camps.J.faction];
  const terre = armee.filter(u => !u.def.avion), avions = armee.filter(u => u.def.avion);
  // Chantiers : un seul à la fois, toujours avec un ouvrier dessus (robotBatir prend le premier
  // ouvrier venu : sans cette précaution, il abandonnerait un chantier pour le suivant).
  const ouvriers = robotJ().filter(u => u.est === 'unite' && u.def.ouvrier);
  // (Ouvriers et collecteurs : voir robotEconomie ; avant les collecteurs, il gardait neuf ouvriers récoltants.)
  const chantier = robotJ().find(b => b.est === 'batiment' && b.enCours);
  if(chantier){
    if(!ouvriers.some(o => o.ordre && o.ordre.type === 'construire' && o.ordre.bat === chantier)){
      const o = ouvriers.find(o => !o.ordre || o.ordre.type === 'reparer');
      if(o) ordreRobot({type:'droit', ids:[o.id], x:chantier.x, y:chantier.y, cibleId:chantier.id}, () => { o.ordre = {type:'construire', bat:chantier}; o.chemin = null; });
    }
  }
  // (Novembre 2026 : batterie mixte en fin de liste, quand elle existe.)
  const voulu = !qg ? null : ['caserne', 'usine', F.special, F.defense, OPTIONS_ROBOT.aviation ? 'aeroport' : null, OPTIONS_ROBOT.nouveautes ? 'batterie' : null]
    .find(t => t && BATIMENTS[t] && !robotJ().some(b => b.type === t));
  if(voulu && !chantier) robotBatir(voulu, qg);
  // Production. Une fois l'armée de terre à huit unités, il met de côté le prix du bâtiment suivant,
  // puis celui d'un avion (comme un joueur qui veut une aviation) ; en dessous, la terre passe d'abord.
  const aero = robotJ().find(b => b.type === 'aeroport' && !b.enCours);
  const nAvionsAero = aero ? avionsDe(aero).length + aero.file.filter(t => UNITES[t] && UNITES[t].avion).length : 0;
  const veutAvion = OPTIONS_ROBOT.aviation && aero && nAvionsAero < PLACES_AEROPORT.length;
  const epargne = terre.length < 8 ? 0 : voulu ? BATIMENTS[voulu].cout : veutAvion ? 700 : 0;
  if(veutAvion) robotProduire(TYPES_AVIONS[(nAvionsAero + 2) % 3]);   // rafale, f15, f35
  // Nouveautés de novembre 2026 (OPTIONS_ROBOT.nouveautes) : deux hélicoptères (un de chaque rôle),
  // un réparateur de chaque sorte, une DCA par tranche de deux appareils adverses (une au moins).
  const nb = t => robotJ().filter(e => e.type === t).length + robotJ().reduce((n, b) => n + (b.file ? b.file.filter(x => x === t).length : 0), 0);
  const nouveau = OPTIONS_ROBOT.nouveautes && F.helicos;
  // (Sans tenir compte de l'épargne : sinon, économie serrée, il n'en produisait aucun en 18 minutes.)
  if(nouveau && aero){
    const h = F.helicos.find(t => nb(t) < 1); if(h) robotProduire(h);
  }
  if(nouveau && terre.length >= 4) for(const t of F.reparateurs) if(nb(t) < 1) robotProduire(t);
  // Infanterie : un mélange comme un joueur moyen, mitrailleurs surtout, plus une part de bazookas
  // (contre les blindés) et de snipers (contre l'infanterie) : tour de rôle sur la liste ci-dessous.
  if(camps.J.reserves >= epargne + 110){
    const inf = F.production.caserne, tour = [inf[0], inf[0], inf[1], inf[0], inf[2]].filter(Boolean);
    robotEscarmouche.tourInf = robotEscarmouche.tourInf || 0;
    if(terre.filter(u => u.def.forme === 'infanterie').length < 8 || camps.J.reserves > 1500){
      const t = tour[robotEscarmouche.tourInf % tour.length];
      if(UNITES[t] && camps.J.reserves >= epargne + UNITES[t].cout){ robotProduire(t); robotEscarmouche.tourInf++; }
    }
  }
  if(camps.J.reserves >= epargne + 300) for(const t of F.production.usine){
    // DCA et dépannage : selon le besoin (sinon le robot en produirait autant que de chars).
    if(UNITES[t].repare) continue;
    if(t === F.antiair && F.reparateurs){
      const air = ents.filter(e => !e.mort && e.est === 'unite' && e.def.aerien && e.def.forme !== 'vaisseauMere' && hostile('J', e.camp)).length;
      if(nb(t) >= Math.max(1, Math.ceil(air/2))) continue;
    }
    robotProduire(t);
  }
  // Armée de terre : défense de la base, puis attaque à douze unités disponibles.
  // Ennemis : tout camp de joueur hostile au robot (plusieurs camps possibles depuis novembre 2026),
  // jamais un allié ni le camp neutre ; les envahisseurs restent l'affaire de robotInvasion.
  const ennemi = e => e.camp !== 'N' && e.camp !== 'X' && hostile('J', e.camp);
  const menace = qg && ents.find(e => ennemi(e) && !e.mort && e.est === 'unite' && !enVol(e) && Math.hypot(e.x-qg.x, e.y-qg.y) < 650);
  if(menace){ for(const u of terre) if(!u.cible) robotAttaqueDeplacement(u, menace.x, menace.y); }
  else if(OPTIONS_ROBOT.attaque && temps >= OPTIONS_ROBOT.apres && terre.filter(u => !u.ordre && !u.cible).length >= OPTIONS_ROBOT.attaque){
    // Le QG ennemi le plus proche, sinon le bâtiment ennemi le plus proche.
    const depuis = qg || terre[0], proche = l => l.sort((a, b) => Math.hypot(a.x-depuis.x, a.y-depuis.y) - Math.hypot(b.x-depuis.x, b.y-depuis.y))[0];
    const c = proche(ents.filter(e => ennemi(e) && !e.mort && e.type === 'qg')) || proche(ents.filter(e => ennemi(e) && !e.mort && e.est === 'batiment'));
    if(c) robotAttaquer(terre, c.x, c.y);
  }
  // Avions, une fois stationnés et réarmés : interception des appareils adverses proches de la base,
  // appui contre une menace au sol, sinon frappe sur un bâtiment adverse (même choix que l'IA).
  const intrus = qg && ents.filter(e => ennemi(e) && !e.mort && e.est === 'unite' && enVol(e) && Math.hypot(e.x-qg.x, e.y-qg.y) < 1100);
  const prets = avions.filter(u => u.phase === 'sol' && u.munitions >= u.def.munitions && !u.ordre);
  const frappeurs = prets.filter(u => u.def.armeSol && !u.def.chasse);
  const frappe = frappeurs.length ? cibleFrappe('J', frappeurs[0], risqueAccepte(frappeurs.length)) : null;
  for(const u of prets){
    let c = null;
    if(u.def.armeAir && intrus && intrus.length) c = plusProcheDe(u, intrus);
    if(!c && frappeurs.includes(u)) c = menace && peutCibler(u, menace) ? menace : frappe;
    // Attaque d'une cible désignée (attaque-déplacement sur elle). L'exécution pose aussi u.cible, et ne
    // donne pas l'ordre si l'appareil ne peut pas viser cette cible (peutCibler).
    if(c) ordreRobot({type:'attaqueDeplacement', ids:[u.id], x:c.x, y:c.y, cibleId:c.id}, () => { u.ordre = {type:'attaquer', cible:c}; },
      () => { if(peutCibler(u, c)) u.cible = c; else u.ordre = null; });
  }
}
// Mode Surprises, invasion avec alliance (page chargée avec ?verif&surprise=<s>) : robot « joueur
// raisonnable » = robotEscarmouche sans assaut contre l'allié, plus : esquive du rayon, tout ce qui peut
// toucher le vaisseau-mère l'attaque, le reste défend la base contre les dards et les rôdeurs.
function robotInvasion(){
  robotEscarmouche();
  const v = vaisseauMere(); if(!v) return;
  const qg = robotJ().find(b => b.type === 'qg') || robotJ().find(b => b.est === 'batiment');
  const uns = robotJ().filter(u => u.est === 'unite' && !u.def.ouvrier && !u.def.collecteur);
  const terre = uns.filter(u => !u.def.avion);
  esquiverRayon(terre);
  const mX = qg && ents.find(e => e.camp === 'X' && !e.mort && e !== v && Math.hypot(e.x-qg.x, e.y-qg.y) < 700);
  for(const u of terre){
    if(u.ordre && u.ordre.type === 'aller') continue;
    if(peutCibler(u, v) && efficacite(u.def.arme, v) > 0){ if(!(u.ordre && u.ordre.cible === v)) u.ordre = {type:'attaquer', cible:v}; }
    else if(mX && !u.cible) u.ordre = {type:'attaqueDeplacement', x:mX.x, y:mX.y};
  }
  for(const u of uns) if(u.def.avion && u.def.armeAir && u.phase === 'sol' && !u.ordre && u.munitions >= u.def.munitions) u.ordre = {type:'attaquer', cible:v};
}
// Partie complète avec invasion et alliance : renvoie l'issue, l'instant d'arrivée du vaisseau et les
// changements de base visée. À lancer sur front-de-sel.html?verif&surprise=<s> (une partie par page).
// config (facultatif) : comme pour testerEscarmouche (liste des camps ou raccourci, ex. 'chacun').
function testerInvasion(factionJ, duree, config){
  SIMLOG = [];
  window.enregistrerVictoire = () => {};
  const att = OPTIONS_ROBOT.attaque; OPTIONS_ROBOT.attaque = 0;
  if(!enJeu) demarrer(factionJ || 'halden', configTest(factionJ, config) || undefined);
  const dt = 0.05; let arrivee = null, vise = null, fin = null, mortVaisseau = null;
  const elimines = {};   // camp -> instant de son élimination et état du vaisseau à cet instant
  for(let k = 0; k < (duree || 1500)/dt; k++){
    if(arrivee != null && mortVaisseau == null && !vaisseauMere()) mortVaisseau = Math.round(temps);
    if(surprise.etat === 'cinematique') passerCinematique();
    if(surprise.etat === 'dialogue') repondreAlliance(true);
    try { miseAJour(dt); } catch(e){ SIMLOG.push('ERREUR t=' + temps.toFixed(1) + ' ' + e.message); break; }
    const v = vaisseauMere();
    if(surprise.arrivee && arrivee == null){ arrivee = temps; SIMLOG.push(Math.round(temps) + 's arrivée du vaisseau'); }
    if(v && v.campVise !== vise){ vise = v.campVise; SIMLOG.push(Math.round(temps) + 's vise ' + vise + ' (PV ' + Math.round(v.pv) + ', bouclier ' + Math.round(v.bouclier) + ')'); }
    if(k % 20 === 0){
      robotInvasion();
      for(const id of campsEnJeu()) if(camps[id] && camps[id].elimine && elimines[id] == null){
        const vv = vaisseauMere(); elimines[id] = Math.round(temps) + ' s (vaisseau ' + (vv ? Math.round(vv.pv) + ' PV, bouclier ' + Math.round(vv.bouclier) : 'détruit') + ')';
      }
    }
    if(k % 1200 === 0){
      const n = (camp, f) => ents.filter(e => e.camp === camp && !e.mort && f(e)).length, arme = e => e.est === 'unite' && !e.def.ouvrier && !e.def.collecteur;
      SIMLOG.push(Math.round(temps) + 's armées J ' + n('J', arme) + ' I ' + n('I', arme) + ' X ' + n('X', arme) + ' · collecteurs J ' + n('J', e => e.def.collecteur) + ' I ' + n('I', e => e.def.collecteur) +
        ' · bâtiments J ' + n('J', e => e.est === 'batiment') + ' I ' + n('I', e => e.est === 'batiment') + ' · réserves J ' + Math.round(camps.J.reserves) + ' I ' + Math.round(camps.I.reserves) + (v ? ' · vaisseau ' + Math.round(v.pv + v.bouclier) : ''));
    }
    if(partieFinie){ fin = issuePartie; break; }
  }
  OPTIONS_ROBOT.attaque = att;
  const v = vaisseauMere();
  if(arrivee != null && mortVaisseau == null && !v) mortVaisseau = Math.round(temps);   // détruit au dernier pas
  return {log:SIMLOG, issue:fin ? (fin.victoire ? 'victoire' : 'défaite') : 'non terminée', temps:Math.round(temps), elimines, mortVaisseau,
    apresArrivee: arrivee == null ? null : Math.round(temps - arrivee), vaisseau: v ? Math.round(v.pv) + ' PV / ' + Math.round(v.bouclier) + ' bouclier' : 'détruit',
    batsJ: ents.filter(e => e.camp === 'J' && e.est === 'batiment' && !e.mort).length, batsI: ents.filter(e => e.camp === 'I' && e.est === 'batiment' && !e.mort).length,
    I: ents.filter(e => e.camp === 'I' && !e.mort && e.est === 'unite').map(e => e.type).reduce((r, t) => (r[t] = (r[t] || 0) + 1, r), {})};
}
window.testerInvasion = testerInvasion;
// Remet le moteur à zéro pour enchaîner plusieurs parties simulées dans la même page (outil de test
// seulement : le décor 3D n'est pas remis en état, à n'utiliser que pour des parties sans affichage).
function reinitialiserPartie(){
  ents = []; projectiles = []; effets = []; evenements = []; selection = []; groupes = {};
  if(typeof issuePartie !== 'undefined') issuePartie = null;
  temps = 0; partieFinie = false; enJeu = false; enPause = false; mode = null;
  // Minuteur de verifierFin remis comme dans une page neuve (21 novembre 2026) : sans cela, une même graine donnait
  // une autre partie selon ce qui avait tourné avant dans la page. Sans effet sur les références (premier appel
  // d'une page neuve, où verifT vaut déjà 0).
  if(typeof verifT !== 'undefined') verifT = 0;
  chargerCarte(CARTE);
  if(typeof reinitialiserIA === 'function'){ reinitialiserIA(); alliance = false; }   // un état d'IA par camp ordinateur
  else Object.assign(ia, {t:0, vague:7, premiereVague:210, revenu:1, indexVeh:0, indexInf:0, indexAvion:0, tourAvion:true, nAvions:0, besoin:null, active:true,
    construit:true, vagues:null, cible:null, prochaineVague:Infinity, nVagues:0, attenteVague:0});
  document.getElementById('fin').classList.add('cache');
}
// Phases d'un avion qui doivent rester brèves : au-delà de PHASE_MAX secondes, il est signalé bloqué.
const PHASES_BREVES = ['sortie', 'decollage', 'approche', 'finale', 'roulage', 'rangement'], PHASE_MAX = 45;
// config (facultatif) : liste des camps comme pour demarrer ([{id, faction, equipe, ia}, ...]), ou un
// raccourci de l'écran ('duel', 'chacun', '2c2', '1c3', '2c1'), les factions alternant à partir de celle
// du joueur (factions : tableau facultatif pour les imposer, dans l'ordre J, I, K, L).
function configTest(factionJ, config, factions){
  if(Array.isArray(config)) return config;
  const R = (typeof RACCOURCIS_CAMPS !== 'undefined' ? RACCOURCIS_CAMPS : []).find(r => r[0] === config);
  if(!R) return null;
  const autre = f => f === 'halden' ? 'karsk' : 'halden', ids = ['J', 'I', 'K', 'L'], liste = [];
  let f = factionJ || 'halden';
  R[2].forEach((eq, i) => { if(eq === null) return; const k = liste.length; liste.push({id:ids[k], faction:(factions && factions[k]) || f, equipe:eq, ia:k > 0}); f = autre(f); });
  return liste;
}
function testerEscarmouche(factionJ, duree, robot, config, factions){
  SIMLOG = [];
  if(MISSION){ return {log:['testerEscarmouche se lance depuis la page d’accueil, pas depuis une mission']}; }
  window.enregistrerVictoire = () => {};
  const liste = configTest(factionJ, config, factions);
  if(!enJeu) demarrer(factionJ || 'halden', liste || undefined);
  const ids = typeof campsEnJeu === 'function' ? campsEnJeu() : ['J', 'I'];
  const parCamp = v => Object.fromEntries(ids.map(id => [id, v]));
  const dt = 0.05, suivi = new Map(), vus = {}, bilan = {decollages:parCamp(0), atterrissages:parCamp(0), tirs:parCamp(0), bloques:0};
  // Dégâts infligés par camp à chaque autre camp, et dégâts entre alliés (doivent rester à 0).
  const degats = {}; let entreAllies = 0;
  const infligerOrig = window.infliger;
  window.infliger = function(c, deg, auteur){
    if(c && !c.mort && deg > 0 && auteur && auteur.camp && auteur.camp !== c.camp){
      const k = auteur.camp + '>' + c.camp; degats[k] = (degats[k] || 0) + deg;
      if(allies(auteur.camp, c.camp)) entreAllies += deg;
    }
    return infligerOrig.apply(this, arguments);
  };
  try {
  const noter = (cle, texte) => { if(!vus[cle]){ vus[cle] = true; SIMLOG.push(Math.round(temps) + 's ' + texte); } };
  for(let k = 0; k < (duree || 480)/dt; k++){
    try { miseAJour(dt); }
    catch(e){ SIMLOG.push('ERREUR t=' + temps.toFixed(1) + ' ' + e.message + ' | ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ')); break; }
    for(const u of ents){
      if(!u.def.avion || u.mort) continue;
      let s = suivi.get(u);
      if(!s){ s = {phase:u.phase, depuis:temps, munitions:u.munitions, signale:false}; suivi.set(u, s); }
      if(u.munitions < s.munitions) bilan.tirs[u.camp] += s.munitions - u.munitions;
      s.munitions = u.munitions;
      if(u.phase !== s.phase){
        if(u.phase === 'decollage') bilan.decollages[u.camp]++;
        if(u.phase === 'sol') bilan.atterrissages[u.camp]++;
        s.phase = u.phase; s.depuis = temps; s.signale = false;
      } else if(!s.signale && PHASES_BREVES.includes(u.phase) && temps - s.depuis > PHASE_MAX){
        s.signale = true; bilan.bloques++;
        SIMLOG.push(Math.round(temps) + 's BLOQUÉ ' + u.type + ' ' + u.camp + ' en phase ' + u.phase + ' à (' + Math.round(u.x) + ', ' + Math.round(u.y) + ')');
      }
      if(!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.alt) || !isFinite(u.angle) || !isFinite(u.pv)) noter('nan' + u.id, 'VALEUR INVALIDE sur ' + u.type + ' ' + u.camp);
    }
    if(k % 20 === 0){
      if(robot !== null) (robot || robotEscarmouche)();
      for(const camp of ids){
        if(camps[camp] && camps[camp].elimine) noter('elim' + camp, 'camp ' + camp + ' éliminé');
        if(ents.some(e => e.camp === camp && e.enVague)) noter('vague' + camp, 'première vague terrestre de ' + camp);
        const a = ents.find(e => e.camp === camp && e.type === 'aeroport' && !e.mort);
        if(a) noter('chantier' + camp, 'aéroport ' + camp + ' en chantier');
        if(a && !a.enCours) noter('aero' + camp, 'aéroport ' + camp + ' terminé');
        for(const t of TYPES_AVIONS) if(ents.some(e => e.camp === camp && e.type === t)) noter(t + camp, 'premier ' + t + ' ' + camp);
        if(bilan.decollages[camp]) noter('dec' + camp, 'premier décollage ' + camp);
        if(bilan.tirs[camp]) noter('tir' + camp, 'premier tir d’un avion ' + camp);
        if(bilan.atterrissages[camp]) noter('att' + camp, 'premier retour à l’aéroport ' + camp);
      }
      if(ents.some(e => e.camp === 'I' && e.enVague)) noter('vague', 'première vague terrestre de l’ordinateur');
    }
    // Issue réelle, posée par le moteur (issuePartie) : victoire commune par alliance comprise. Repli
    // (ancien moteur) : la base adverse rasée.
    if(partieFinie){
      const fin = typeof issuePartie !== 'undefined' && issuePartie ? issuePartie : {victoire:!ents.some(e => e.camp === 'I' && e.est === 'batiment' && !e.mort), alliance:false};
      SIMLOG.push(Math.round(temps) + 's FIN : ' + (fin.victoire ? 'victoire du robot' + (fin.alliance ? ' (alliance)' : '') : 'défaite du robot'));
      break;
    }
  }
  } finally { window.infliger = infligerOrig; }
  const compter = camp => { const r = {}; for(const e of ents) if(e.camp === camp && !e.mort) r[e.type] = (r[e.type] || 0) + 1; return r; };
  const res = {log:SIMLOG, temps:Math.round(temps), bilan, reserves:{}, degats:Object.fromEntries(Object.entries(degats).map(([k, v]) => [k, Math.round(v)])),
          degatsEntreAllies:Math.round(entreAllies), issue:typeof issuePartie !== 'undefined' ? issuePartie : null,
          equipes:Object.fromEntries(ids.map(id => [id, (camps[id] && camps[id].equipe) || id])),
          avions: ents.filter(e => e.def.avion).map(u => u.camp + ' ' + u.type + ' ' + u.phase + ' mun ' + u.munitions + ' pv ' + Math.round(u.pv)),
          stats:Object.assign({}, stats)};
  for(const id of ids){ res[id] = compter(id); res.reserves[id] = camps[id] ? Math.round(camps[id].reserves) : null; }
  return res;
}
// Duel : nb avions du camp J (stationnés sur un aéroport, à 1 000 px) contre nbSol unités du camp I.
// Les avions reçoivent un ordre d'attaque-déplacement sur le groupe adverse et se réarment à leur
// aéroport entre deux sorties. Renvoie les survivants et la durée. À lancer depuis la page d'accueil.
function duelAerien(typeAvion, nb, typeSol, nbSol, duree){
  if(MISSION) return 'duelAerien se lance depuis la page d’accueil, pas depuis une mission';
  if(!enJeu) demarrer('halden');
  ia.active = false;
  // Table rase : seuls restent les deux QG (la partie ne se termine pas) ; l'ancien aéroport du duel
  // précédent libère ses tuiles.
  for(const e of ents){
    if(e.type === 'qg') continue;
    if(e.est === 'batiment'){ const t = e.def.taille; for(let r = e.r; r < e.r + t; r++) for(let c = e.c; c < e.c + t; c++) grille[r*COLS+c] = 0; }
    e.mort = true;
  }
  miseAJour(0.05);
  projectiles.length = 0;
  const X = 1900, Y = 520;
  const pos = trouverEmplacement('aeroport', {x:X - 1000, y:Y});
  if(!pos) return 'aucun emplacement pour l’aéroport du duel';
  const a = creerBatiment('aeroport', 'J', pos.c, pos.r, true);
  const types = Array.isArray(typeAvion) ? typeAvion : Array.from({length:nb}, () => typeAvion);
  const avions = types.slice(0, PLACES_AEROPORT.length).map((t, i) => stationnerAvion(creerUnite(t, 'J', a.x, a.y), a, i));
  const sol = [];
  for(let i = 0; i < nbSol; i++){ const p = pointLibre(X + (i % 3)*46 - 46, Y + Math.floor(i/3)*46); sol.push(creerUnite(typeSol, 'I', p.x, p.y)); }
  for(const u of avions) u.ordre = {type:'attaqueDeplacement', x:X, y:Y};
  const t0 = temps, dt = 0.05, pvSol = sol.reduce((s, u) => s + u.pvMax, 0), pvAir = avions.reduce((s, u) => s + u.pvMax, 0);
  let fin = 'durée écoulée', sorties = 0; const phases = new Map();
  for(let k = 0; k < (duree || 180)/dt; k++){
    miseAJour(dt);
    for(const u of avions){ if(!u.mort && u.phase === 'decollage' && phases.get(u) !== 'decollage') sorties++; phases.set(u, u.phase); }
    if(sol.every(u => u.mort)){ fin = 'les avions gagnent'; break; }
    if(avions.every(u => u.mort)){ fin = 'la défense gagne'; break; }
  }
  const reste = l => l.filter(u => !u.mort);
  return {duel: types.join('+') + ' contre ' + nbSol + ' ' + typeSol, issue:fin, duree:Math.round(temps - t0), sorties,
          avions: reste(avions).length + ' / ' + avions.length + ' (PV ' + Math.round(reste(avions).reduce((s, u) => s + u.pv, 0)) + ' / ' + pvAir + ')',
          sol: reste(sol).length + ' / ' + sol.length + ' (PV ' + Math.round(reste(sol).reduce((s, u) => s + u.pv, 0)) + ' / ' + pvSol + ')'};
}
// Table rase pour les duels : seuls restent les deux QG (la partie ne se termine pas), IA arrêtée.
function tableRase(){
  if(!enJeu) demarrer('halden');
  for(const id in etatsIA) etatsIA[id].active = false;
  ia.active = false;
  for(const e of ents){
    if(e.type === 'qg') continue;
    if(e.est === 'batiment'){ const t = e.def.taille; for(let r = e.r; r < e.r + t; r++) for(let c = e.c; c < e.c + t; c++) grille[r*COLS+c] = 0; }
    e.mort = true;
  }
  miseAJour(0.05);
  projectiles.length = 0;
}
// Duel (novembre 2026) : nbJ unités typeJ du camp J, à 450 px, en attaque-déplacement sur nbI unités ou
// bâtiments typeI du camp I (un bâtiment armé est posé fini). Renvoie l'issue, la durée et les PV restants.
// Ex. : duel('frelon', 3, 'rempart', 2) ; duel('busard', 3, 'batterie', 2) ; duel('taon', 3, 'conscrit', 6).
function duel(typeJ, nbJ, typeI, nbI, duree){
  if(MISSION) return 'duel se lance depuis la page d’accueil, pas depuis une mission';
  tableRase();
  const X = 1900, Y = 600, J = [], I = [];
  for(let i = 0; i < nbI; i++){
    if(BATIMENTS[typeI]){ const p = trouverEmplacement(typeI, {x:X + (i - (nbI-1)/2)*90, y:Y}); if(p) I.push(creerBatiment(typeI, 'I', p.c, p.r, true)); }
    else { const p = pointLibre(X + (i % 3)*40 - 40, Y + Math.floor(i/3)*40); I.push(creerUnite(typeI, 'I', p.x, p.y)); }
  }
  for(let i = 0; i < nbJ; i++){ const p = pointLibre(X - 450 + (i % 3)*36, Y - 40 + Math.floor(i/3)*36); J.push(creerUnite(typeJ, 'J', p.x, p.y)); }
  for(const u of J) u.ordre = {type:'attaqueDeplacement', x:X, y:Y};
  const pv = l => Math.round(l.filter(e => !e.mort).reduce((s, e) => s + e.pv, 0)), pvJ = pv(J), pvI = pv(I);
  const t0 = temps, dt = 0.05; let fin = 'durée écoulée';
  for(let k = 0; k < (duree || 180)/dt; k++){
    miseAJour(dt);
    if(I.every(e => e.mort)){ fin = typeJ + ' gagne'; break; }
    if(J.every(e => e.mort)){ fin = typeI + ' gagne'; break; }
  }
  const reste = l => l.filter(e => !e.mort).length;
  return {duel: nbJ + ' ' + typeJ + ' contre ' + nbI + ' ' + typeI, issue:fin, duree:Math.round(temps - t0),
    J: reste(J) + ' / ' + nbJ + ' (PV ' + pv(J) + ' / ' + pvJ + ')', I: reste(I) + ' / ' + nbI + ' (PV ' + pv(I) + ' / ' + pvI + ')'};
}
// Réparation : un blessé (typeBlesse, camp J) à part (0,3 = 30 %) de ses PV, un réparateur typeRep à
// 150 px, sans ordre (soin automatique) ou avec un ordre « soigner » (ordre = true). Renvoie la durée du
// soin complet, ou la part atteinte au bout de duree s.
function duelReparation(typeRep, typeBlesse, part, ordre, duree){
  if(MISSION) return 'duelReparation se lance depuis la page d’accueil';
  tableRase();
  const X = 1900, Y = 600;
  const b = BATIMENTS[typeBlesse] ? (p => creerBatiment(typeBlesse, 'J', p.c, p.r, true))(trouverEmplacement(typeBlesse, {x:X, y:Y})) : creerUnite(typeBlesse, 'J', X, Y);
  b.pv = b.pvMax * (part == null ? 0.3 : part);
  const p = pointLibre(X - 150, Y + 30), r = creerUnite(typeRep, 'J', p.x, p.y);
  if(ordre) r.ordre = {type:'soigner', cible:b};
  const t0 = temps, dt = 0.05; let soin = null, premier = null;
  for(let k = 0; k < (duree || 120)/dt; k++){
    miseAJour(dt);
    if(premier == null && r.repareT > t0) premier = Math.round((temps - t0)*10)/10;
    if(b.pv >= b.pvMax - 0.5){ soin = Math.round((temps - t0)*10)/10; break; }
  }
  return {reparateur:typeRep, blesse:typeBlesse, depart:Math.round((part == null ? 0.3 : part)*100) + ' %', premierSoin:premier, soinComplet:soin,
    pv:Math.round(b.pv) + ' / ' + b.pvMax, etat:etatUnite(r), cibleSoin:r.cibleSoin ? r.cibleSoin.type : null};
}
window.duel = duel; window.duelReparation = duelReparation;
// Raid (13 novembre 2026) : nb avions typeAvion du camp J, stationnés sur un aéroport à 1 000 px, en
// attaque-déplacement sur une base du camp I (QG, caserne, usine) gardée par nbDCA unités typeDCA posées
// autour du QG. À lancer après demarrer(faction du joueur) : le camp I garde sa faction. Renvoie les
// avions restants, les DCA restantes et les PV des bâtiments.
// Ex. : demarrer('karsk') puis raidAerien('rafale', 3, 'rempart', 2).
function raidAerien(typeAvion, nb, typeDCA, nbDCA, duree){
  if(MISSION) return 'raidAerien se lance depuis la page d’accueil';
  tableRase();
  const qg = ents.find(e => e.camp === 'I' && e.type === 'qg' && !e.mort);
  if(!qg) return 'pas de QG pour le camp I';
  const bats = [qg];
  for(const t of ['caserne', 'usine']){ const p = trouverEmplacement(t, qg); if(p) bats.push(creerBatiment(t, 'I', p.c, p.r, true)); }
  const dca = [];
  for(let i = 0; i < nbDCA; i++){ const a = i*Math.PI*2/Math.max(1, nbDCA); const p = pointLibre(qg.x + Math.cos(a)*90, qg.y + Math.sin(a)*90); dca.push(creerUnite(typeDCA, 'I', p.x, p.y)); }
  const pos = trouverEmplacement('aeroport', {x:qg.x + (qg.x < LARG/2 ? 1000 : -1000), y:qg.y});
  if(!pos) return 'aucun emplacement pour l’aéroport du raid';
  const aero = creerBatiment('aeroport', 'J', pos.c, pos.r, true);
  const avions = Array.from({length:nb}, (_, i) => stationnerAvion(creerUnite(typeAvion, 'J', aero.x, aero.y), aero, i));
  for(const u of avions) u.ordre = {type:'attaqueDeplacement', x:qg.x, y:qg.y};
  const pvBats = () => Math.round(bats.filter(b => !b.mort).reduce((s, b) => s + b.pv, 0)), pv0 = pvBats();
  const t0 = temps, dt = 0.05; let fin = 'durée écoulée';
  for(let k = 0; k < (duree || 180)/dt; k++){
    miseAJour(dt);
    for(const u of avions) if(!u.mort && !u.ordre && u.phase === 'sol' && u.munitions > 0) u.ordre = {type:'attaqueDeplacement', x:qg.x, y:qg.y};
    if(avions.every(u => u.mort)){ fin = 'la défense gagne'; break; }
    if(dca.every(u => u.mort) && bats.every(b => b.mort)){ fin = 'les avions rasent la base'; break; }
  }
  const reste = l => l.filter(e => !e.mort).length;
  return {raid: nb + ' ' + typeAvion + ' contre base ' + (camps.I && camps.I.faction) + ' + ' + nbDCA + ' ' + typeDCA, issue:fin, duree:Math.round(temps - t0),
    avions:reste(avions) + ' / ' + nb, dca:reste(dca) + ' / ' + nbDCA, batiments:reste(bats) + ' / ' + bats.length + ' (PV ' + pvBats() + ' / ' + pv0 + ')'};
}
window.raidAerien = raidAerien;
// ---------------------------------------------------------------------
//  Duels d'ordinateurs (difficulté Ultra, novembre 2026). Le camp J peut être joué par l'ordinateur à une
//  difficulté donnée (camps.J.ia = true après demarrer, etatIA('J').niveau), ou par le robot joueur
//  (niveau 'robot' : robotEscarmouche). Une partie par appel, dans la même page (reinitialiserPartie) ;
//  changer de carte demande de recharger la page avec ?verif&carte=<id>.
//  Contrôle d'absence de triche, par camp : chaque variation des réserves est attribuée à sa cause
//  (déchargement d'un collecteur, revenu de secours, commande d'unité, chantier) ; « inexplique » doit
//  rester à 0. « parCharge » : crédits reçus par unité de minerai déchargée (1 pour le joueur et pour Ultra,
//  1,35 pour Difficile). « unitesSansCommande » : unités apparues sans commande payée ni pouvoir.
//  Mesure du temps de calcul : moyenne et maximum de miseAJour (ms par pas de 0,05 s).
// ---------------------------------------------------------------------
function confierAOrdinateur(camp, niveau){
  const C = camps[camp]; if(!C) return;
  C.ia = true;
  const E = etatIA(camp), dk = DIFFICULTES[niveau] || DIFFICULTES.normal;
  E.niveau = niveau; E.revenu = dk.revenu; E.premiereVague = dk.premiereVague; E.vague = dk.vague; E.frappeT = 0; E.t = 0.3; E.active = true;
}
window.confierAOrdinateur = confierAOrdinateur;
// liste : [{id, faction, equipe, niveau}] (J en tête) ; opts : {surprise:true (cinématique passée, alliance
// acceptée), mesureApres:<s> (temps de calcul mesuré après cet instant), sansFin:true (ne s'arrête pas à la fin)}.
function partieOrdinateurs(liste, duree, opts){
  opts = opts || {};
  window.enregistrerVictoire = () => {};
  reinitialiserPartie();
  SIMLOG = [];
  const niveaux = {}; for(const k of liste) niveaux[k.id] = k.niveau;
  demarrer(liste[0].faction, liste.map(k => ({id:k.id, faction:k.faction, equipe:k.equipe, ia:k.id !== 'J', niveau:k.id !== 'J' ? k.niveau : undefined})));
  if(niveaux.J && niveaux.J !== 'robot') confierAOrdinateur('J', niveaux.J);
  if(opts.preparer) opts.preparer();   // (réglage d'un essai juste après le départ ; aucun outil ne s'en sert aujourd'hui)
  const ids = campsEnJeu();
  const compta = Object.fromEntries(ids.map(id => [id, {depart:camps[id].reserves, collecte:0, charge:0, dechargements:0, secours:0, depenses:0, unites:0, commandes:0, renforts:0}]));
  // Instruments (remis en place à la fin).
  const orig = {majCollecteur:window.majCollecteur, commander:window.commander, construireBatiment:window.construireBatiment, revenuSecours:window.revenuSecours, creerUnite:window.creerUnite, activerPouvoir:window.activerPouvoir,
    commanderMissile:window.commanderMissile, commanderMunition:window.commanderMunition};
  let enProduction = 0;
  // Défense antimissile (19 novembre 2026) : le prix des munitions d'interception compte aussi. Option décochée,
  // commanderMunition n'est jamais appelée : rien ne change.
  window.commanderMunition = function(b){
    const C = b && camps[b.camp], r0 = C ? C.reserves : 0;
    const ok = orig.commanderMunition.apply(this, arguments);
    if(C && compta[b.camp]) compta[b.camp].depenses += r0 - C.reserves;
    return ok;
  };
  // Galeries de tir (novembre 2026) : le prix des missiles compte dans les dépenses (contrôle anti-triche).
  // Option décochée, commanderMissile n'est jamais appelée : rien ne change.
  window.commanderMissile = function(b){
    const C = b && camps[b.camp], r0 = C ? C.reserves : 0;
    const ok = orig.commanderMissile.apply(this, arguments);
    if(C && compta[b.camp]) compta[b.camp].depenses += r0 - C.reserves;
    return ok;
  };
  window.majCollecteur = function(u, dt){
    const C = camps[u.camp], r0 = C ? C.reserves : 0, ch = u.charge || 0;
    const res = orig.majCollecteur.apply(this, arguments);
    if(C && compta[u.camp] && C.reserves !== r0){ const k = compta[u.camp]; k.collecte += C.reserves - r0; k.charge += ch; k.dechargements++; }
    return res;
  };
  window.commander = function(b, t){
    const C = camps[b.camp], r0 = C ? C.reserves : 0;
    const ok = orig.commander.apply(this, arguments);
    if(C && compta[b.camp]){ compta[b.camp].depenses += r0 - C.reserves; if(ok) compta[b.camp].commandes++; }
    return ok;
  };
  window.construireBatiment = function(camp){
    const C = camps[camp], r0 = C ? C.reserves : 0;
    const res = orig.construireBatiment.apply(this, arguments);
    if(C && compta[camp]) compta[camp].depenses += r0 - C.reserves;
    return res;
  };
  window.revenuSecours = function(){
    const r0 = Object.fromEntries(ids.map(id => [id, camps[id].reserves]));
    const res = orig.revenuSecours.apply(this, arguments);
    for(const id of ids) compta[id].secours += camps[id].reserves - r0[id];
    return res;
  };
  window.creerUnite = function(type, camp){
    const u = orig.creerUnite.apply(this, arguments);
    if(compta[camp] && temps > 0) compta[camp].unites++;
    return u;
  };
  window.activerPouvoir = function(camp, cle){
    const ok = orig.activerPouvoir.apply(this, arguments);
    if(ok && cle === 'renforts' && compta[camp]) compta[camp].renforts += 5;
    return ok;
  };
  // opts.pas (21 novembre 2026, mesureUltra) : pas de temps fixe (nombre, ex. 1/30) ou fonction qui rend le pas
  // suivant (pas irrégulier) ; la partie s'arrête alors à duree s de jeu. Sans opts.pas : 0,05 s et la boucle
  // d'avant, inchangée (empreinte de référence 7d442efb).
  const dt = 0.05; let tMax = 0, tSomme = 0, n = 0, erreur = null;
  const ech = opts.mesureApres || 0;
  const pasSuivant = opts.pas == null ? null : typeof opts.pas === 'function' ? opts.pas : () => opts.pas;
  const nPas = pasSuivant ? Infinity : (duree || 1500)/dt;
  try {
    for(let k = 0; k < nPas; k++){
      if(pasSuivant && temps >= (duree || 1500) - 1e-9) break;
      const dtk = pasSuivant ? pasSuivant() : dt;
      if(opts.surprise){ if(surprise.etat === 'cinematique') passerCinematique(); if(surprise.etat === 'dialogue') repondreAlliance(true); }
      const t0 = performance.now();
      try { miseAJour(dtk); } catch(e){ erreur = 't=' + temps.toFixed(1) + ' ' + e.message + ' | ' + String(e.stack || '').split('\n').slice(1, 3).join(' | '); break; }
      const d = performance.now() - t0;
      if(temps >= ech){ tSomme += d; n++; if(d > tMax) tMax = d; }
      if(k % 20 === 0 && niveaux.J === 'robot') robotEscarmouche();
      if(opts.instantanes && k % 20 === 0) noterInstantane(opts.instantanes, ids, compta);
      if(partieFinie && !opts.sansFin) break;   // sansFin : la simulation continue après la fin (essai de durée)
    }
  } finally { Object.assign(window, orig); }
  const fin = issuePartie;
  const valeur = id => ents.filter(e => e.camp === id && !e.mort).reduce((s, e) => s + (e.def.cout || 0), 0);
  const res = {temps:Math.round(temps), erreur, issue:fin ? (fin.victoire ? 'J' : 'adversaires de J') : 'non terminée',
    msParPas:n ? +(tSomme/n).toFixed(2) : 0, msMax:+tMax.toFixed(1), camps:{}};
  for(const id of ids){
    const k = compta[id], C = camps[id];
    res.camps[id] = {niveau:niveaux[id], faction:C.faction, elimine:!!C.elimine, valeur:valeur(id), reserves:Math.round(C.reserves),
      collecte:Math.round(k.collecte), parCharge:k.charge ? +(k.collecte/k.charge).toFixed(3) : null, dechargements:k.dechargements,
      secours:Math.round(k.secours), depenses:Math.round(k.depenses),
      inexplique:Math.round(C.reserves - (k.depart + k.collecte + k.secours - k.depenses)),
      unitesSansCommande:Math.max(0, k.unites - k.commandes - k.renforts)};
  }
  return res;
}
window.partieOrdinateurs = partieOrdinateurs;
// ---------------------------------------------------------------------
//  Équilibrage des camps (13 novembre 2026). Outils de mesure seulement.
// ---------------------------------------------------------------------
// Valeur d'armée : somme des coûts des unités armées en vie (ni ouvriers, ni collecteurs, ni réparateurs).
const valeurArmee = id => ents.filter(e => e.camp === id && !e.mort && e.est === 'unite' && e.def.arme && !e.def.collecteur && !e.def.ouvrier).reduce((s, e) => s + (e.def.cout || 0), 0);
// opts.instantanes : {temps:[180, 360, 540], releves:{}} ; à chaque instant franchi, note par camp la valeur
// d'armée, la collecte cumulée, les dépenses cumulées et les bâtiments en service.
function noterInstantane(I, ids, compta){
  I.releves = I.releves || {};
  for(const t of I.temps) if(temps >= t && !I.releves[t]){
    I.releves[t] = Object.fromEntries(ids.map(id => [camps[id].faction, {armee:valeurArmee(id), collecte:Math.round(compta[id].collecte), depenses:Math.round(compta[id].depenses),
      batiments:ents.filter(e => e.camp === id && !e.mort && e.est === 'batiment' && !e.enCours).map(e => e.type).join(',')}]));
  }
}
window.valeurArmee = valeurArmee;
// Série à niveau égal sur la carte chargée : pour chaque graine, une partie Halden à gauche et une Karsk à
// gauche. Renvoie la liste [graine, faction de J, vainqueur ('halden' / 'karsk' / 'aucun'), durée] et le
// bilan. Vainqueur 'aucun' : partie non terminée au bout de duree s.
function serieEquilibre(niveau, graines, duree, instantanes){
  const parties = [], bilan = {halden:0, karsk:0, aucun:0};
  for(const g of graines) for(const fJ of ['halden', 'karsk']){
    const I = instantanes ? {temps:instantanes} : null;
    const r = avecGraine(g, () => partieOrdinateurs([{id:'J', faction:fJ, equipe:'A', niveau}, {id:'I', faction:fJ === 'halden' ? 'karsk' : 'halden', equipe:'B', niveau}], duree || 1500, I ? {instantanes:I} : {}));
    const v = r.issue === 'non terminée' ? 'aucun' : (r.issue === 'J' ? fJ : (fJ === 'halden' ? 'karsk' : 'halden'));
    bilan[v]++;
    const p = {graine:g, J:fJ, vainqueur:v, duree:r.temps, erreur:r.erreur};
    if(v === 'aucun') p.valeurs = {halden:r.camps[fJ === 'halden' ? 'J' : 'I'].valeur, karsk:r.camps[fJ === 'karsk' ? 'J' : 'I'].valeur};
    if(I) p.releves = I.releves;
    parties.push(p);
  }
  return {carte:CARTE.id, niveau, bilan, parties};
}
window.serieEquilibre = serieEquilibre;
// Duel à budget égal : unités de J (liste [[type, nombre], ...]) contre celles de I, posées à 450 px ; aura
// facultative pour chaque camp (auraJ / auraI : true pose un relais pour Halden, un dépôt pour Karsk, au
// milieu de son groupe ; le camp J reçoit la faction de factionJ). defI : bâtiments de défense de I
// ([[type, nombre]]), posés finis devant le groupe I. Les deux groupes sont en attaque-déplacement l'un
// vers l'autre (J vers I ; I tient sa position quand il a des défenses). Renvoie l'issue et la valeur restante.
function duelBudget(factionJ, compoJ, compoI, opts){
  opts = opts || {};
  if(MISSION) return 'depuis la page d’accueil';
  window.enregistrerVictoire = () => {};
  reinitialiserPartie();
  demarrer(factionJ, [{id:'J', faction:factionJ, equipe:'A', ia:false}, {id:'I', faction:factionJ === 'halden' ? 'karsk' : 'halden', equipe:'B', ia:true}]);
  tableRase();
  const X = 1900, Y = 600, J = [], I = [], bats = [];
  const poser = (camp, type, x, y) => { const p = trouverEmplacement(type, {x, y}); if(p){ const b = creerBatiment(type, camp, p.c, p.r, true); bats.push(b); return b; } return null; };
  if(opts.defI) { let i = 0; for(const [t, n] of opts.defI) for(let k = 0; k < n; k++, i++){ const b = poser('I', t, X - 120, Y - 120 + i*90); if(b) I.push(b); } }
  let n = 0;
  for(const [t, nb] of compoI) for(let k = 0; k < nb; k++, n++){ const p = pointLibre(X + (n % 4)*38, Y - 60 + Math.floor(n/4)*38); I.push(creerUnite(t, 'I', p.x, p.y)); }
  n = 0;
  for(const [t, nb] of compoJ) for(let k = 0; k < nb; k++, n++){ const p = pointLibre(X - 450 - (n % 4)*38, Y - 60 + Math.floor(n/4)*38); J.push(creerUnite(t, 'J', p.x, p.y)); }
  const spe = camp => FACTIONS[camps[camp].faction].special;
  // Bâtiments d'aura hors d'atteinte (demo : jamais pris pour cible), sinon les unités qui avancent tirent
  // dessus au lieu de combattre et le duel ne mesure plus l'aura.
  if(opts.auraJ){ const b = poser('J', spe('J'), X - 520, Y); if(b) b.demo = true; }
  if(opts.auraI){ const b = poser('I', spe('I'), X + 80, Y + 100); if(b) b.demo = true; }
  const cible = opts.defI ? {x:X - 120, y:Y} : {x:X, y:Y};
  for(const u of J) u.ordre = {type:'attaqueDeplacement', x:cible.x, y:cible.y};
  if(!opts.defI) for(const u of I) if(u.est === 'unite') u.ordre = {type:'attaqueDeplacement', x:X - 450, y:Y};
  const val = l => l.filter(e => !e.mort).reduce((s, e) => s + (e.def.cout || 0), 0);
  const pvp = l => { const a = l.filter(e => !e.mort); return a.length ? Math.round(100*a.reduce((s, e) => s + e.pv, 0)/l.reduce((s, e) => s + e.pvMax, 0)) : 0; };
  const v0J = val(J), v0I = val(I), t0 = temps, dt = 0.05; let fin = 'durée écoulée';
  for(let k = 0; k < (opts.duree || 180)/dt; k++){
    miseAJour(dt);
    if(I.every(e => e.mort)){ fin = 'J'; break; }
    if(J.every(e => e.mort)){ fin = 'I'; break; }
  }
  return {J:camps.J.faction + ' ' + compoJ.map(c => c[1] + ' ' + c[0]).join('+') + (opts.auraJ ? ' (aura)' : ''), I:camps.I.faction + ' ' + compoI.map(c => c[1] + ' ' + c[0]).join('+') + (opts.defI ? ' + ' + opts.defI.map(c => c[1] + ' ' + c[0]).join('+') : '') + (opts.auraI ? ' (aura)' : ''),
    budget:[v0J, v0I], vainqueur:fin === 'J' ? camps.J.faction : fin === 'I' ? camps.I.faction : 'aucun', duree:Math.round(temps - t0),
    resteJ:val(J) + ' (' + pvp(J) + ' % PV)', resteI:val(I) + ' (' + pvp(I) + ' % PV)'};
}
window.duelBudget = duelBudget;
// Batterie de duels à budget voisin (Halden à gauche de chaque paire), joués dans les deux sens (chaque camp
// attaquant). Ex. : avecGraine(5, () => duelsEquilibre(false)) ; avec aura des deux camps : duelsEquilibre(true).
const DUELS_EQUILIBRE = [
  ['mitraillettes', [['operateur', 12]], [['conscrit', 20]]],
  ['bazookas', [['javelot', 6]], [['grenadier', 8]]],
  ['tireurs', [['traqueur', 7]], [['guetteur', 9]]],
  ['chars 5 contre 5', [['bastion', 5]], [['ours', 5]]],
  ['chars 6 contre 6', [['bastion', 6]], [['ours', 6]]],
  ['infanterie de base', [['operateur', 8], ['javelot', 2]], [['conscrit', 14], ['grenadier', 2]]],
  ['infanterie et blindés', [['operateur', 6], ['javelot', 2], ['lynx', 2], ['bastion', 2]], [['conscrit', 12], ['grenadier', 3], ['ours', 3]]],
  ['blindés lourds et bazookas', [['bastion', 4], ['javelot', 3]], [['ours', 4], ['grenadier', 4]]],
  ['artillerie et escorte (1)', [['bastion', 2], ['operateur', 3], ['lynx', 1]], [['grele', 2], ['conscrit', 4], ['ours', 1]]],
  ['artillerie et escorte (2)', [['bastion', 3], ['operateur', 4]], [['grele', 3], ['conscrit', 6]]],
];
function duelsEquilibre(aura){
  const r = [];
  for(const [nom, h, k] of DUELS_EQUILIBRE) for(const sens of [0, 1]){
    const o = {auraJ:aura, auraI:aura}, d = sens === 0 ? duelBudget('halden', h, k, o) : duelBudget('karsk', k, h, o);
    const [vH, vK] = sens === 0 ? d.budget : d.budget.slice().reverse(), [rH, rK] = sens === 0 ? [d.resteJ, d.resteI] : [d.resteI, d.resteJ];
    r.push(nom + (sens ? ' (Karsk attaque)' : ' (Halden attaque)') + (aura ? ', auras' : '') + ' : budget H ' + vH + ' / K ' + vK + ' -> ' + d.vainqueur + ' en ' + d.duree + ' s, reste H ' + rH + ', K ' + rK);
  }
  return r;
}
window.duelsEquilibre = duelsEquilibre;
// Moyennes par camp des relevés de serieEquilibre (valeur d'armée, collecte cumulée) à chaque instant.
function resumeEco(s){
  const r = {};
  for(const t of [180, 360, 540]) for(const f of ['halden', 'karsk']){
    const v = s.parties.map(p => p.releves && p.releves[t] && p.releves[t][f]).filter(Boolean);
    if(!v.length) continue;
    const m = k => Math.round(v.reduce((a, x) => a + x[k], 0)/v.length);
    r[t + ' s ' + f] = {armee:m('armee'), collecte:m('collecte'), parties:v.length};
  }
  return r;
}
window.resumeEco = resumeEco;
// Série résumée (graines 1 à 3 par défaut, 25 min au plus, relevés à 3, 6 et 9 min).
function serieCourte(niveau, graines){
  const s = serieEquilibre(niveau, graines || [1, 2, 3], 1500, [180, 360, 540]);
  return {carte:s.carte, niveau, bilan:s.bilan, parties:s.parties.map(p => p.graine + (p.J === 'halden' ? 'H' : 'K') + ' à gauche : ' + p.vainqueur + ' ' + p.duree + ' s' + (p.erreur ? ' ERREUR ' + p.erreur : '')), eco:resumeEco(s)};
}
window.serieCourte = serieCourte;
// Calcul long sans bloquer l'outil qui interroge la page : tache('cle', () => ...) puis lire RESULTATS.cle.
window.RESULTATS = {};
function tache(cle, fn, delai){ RESULTATS[cle] = 'en cours'; setTimeout(() => { try { RESULTATS[cle] = fn(); } catch(e){ RESULTATS[cle] = 'ERREUR ' + e.message; } }, delai || 10); }
window.tache = tache;
// Duel J contre I : niveauJ ('facile' … 'ultra', ou 'robot'), niveauI ; factionJ : camp de J.
function duelIA(niveauJ, niveauI, factionJ, duree){
  const fJ = factionJ || 'halden', fI = fJ === 'halden' ? 'karsk' : 'halden';
  return partieOrdinateurs([{id:'J', faction:fJ, equipe:'A', niveau:niveauJ}, {id:'I', faction:fI, equipe:'B', niveau:niveauI}], duree);
}
window.duelIA = duelIA;
// Duel d'Ultra (13 novembre 2026, preuves de NOTES-CONCEPTION.md) : niveauAdv ('facile' … 'difficile', ou
// 'robot', qui ne peut jouer que le camp J : passer alors ultraEnJ = false), ultraEnJ (Ultra à gauche, camp J,
// sinon à droite, camp I), factionUltra. Renvoie carte, vainqueur, durée, appareils produits par Ultra et le
// contrôle d'absence de triche (écarts inexpliqués J et I, unités sans commande J et I, crédits par unité).
function duelUltra(niveauAdv, ultraEnJ, factionUltra, duree){
  const fJ = ultraEnJ ? factionUltra : (factionUltra === 'halden' ? 'karsk' : 'halden'), u = ultraEnJ ? 'J' : 'I';
  let air = 0; const cu = window.creerUnite;
  window.creerUnite = function(type, camp){ const e = cu.apply(this, arguments); if(camp === u && temps > 0 && UNITES[type] && UNITES[type].aerien) air++; return e; };
  let r;
  try { r = ultraEnJ ? duelIA('ultra', niveauAdv, fJ, duree || 1500) : duelIA(niveauAdv, 'ultra', fJ, duree || 1500); }
  finally { window.creerUnite = cu; }
  const vainqueur = r.issue === 'non terminée' ? 'aucun' : ((r.issue === 'J') === ultraEnJ ? 'ultra' : niveauAdv);
  return {carte:CARTE.id, adversaire:niveauAdv, ultra:factionUltra + (ultraEnJ ? ' (J)' : ' (I)'), vainqueur, duree:r.temps, erreur:r.erreur, appareils:air,
    triche:[r.camps.J.inexplique, r.camps.I.inexplique, r.camps.J.unitesSansCommande, r.camps.I.unitesSansCommande, r.camps[u].parCharge].join(' / ')};
}
window.duelUltra = duelUltra;
// Galeries de tir, lot 2 (novembre 2026) : partie d'ordinateurs avec l'option cochée (remise ensuite dans son
// état d'avant), et relevé par camp de ce que fait sa galerie (journal de l'ordinateur : chantier, commandes,
// tirs datés), des unités produites avant et après la fin du chantier, et du résultat habituel (triche).
// Ex. : avecGraine(3, () => partieGaleries([{id:'J', faction:'halden', equipe:'A', niveau:'difficile'},
//        {id:'I', faction:'karsk', equipe:'B', niveau:'normal'}], 900)).
function partieGaleries(liste, duree, opts){
  const avant = optionGaleries, cu = window.creerUnite, prod = {};
  optionGaleries = true;
  window.creerUnite = function(type, camp){
    const e = cu.apply(this, arguments);
    if(temps > 0 && UNITES[type] && !UNITES[type].ouvrier){
      const p = prod[camp] || (prod[camp] = {avant:0, apres:0});
      const g = ents.find(b => b.camp === camp && estGalerie(b) && !b.enCours);
      if(g) p.apres++; else p.avant++;
    }
    return e;
  };
  let r;
  try { r = partieOrdinateurs(liste, duree, opts); }
  finally { window.creerUnite = cu; optionGaleries = avant; }
  const galeries = {};
  for(const id of Object.keys(r.camps)){
    const E = etatsIA[id], J = E && E.galerie ? E.galerie.journal : [];
    const b = ents.find(e => e.camp === id && estGalerie(e));
    galeries[id] = {niveau:r.camps[id].niveau, faction:r.camps[id].faction,
      chantier:(J.find(l => l.quoi === 'chantier') || {}).t, commandes:J.filter(l => l.quoi === 'commande').map(l => l.t),
      tirs:J.filter(l => l.quoi === 'tir').map(l => l.t + ' s → ' + l.cible + ' ' + l.camp + ' (valeur ' + Math.round(l.valeur) + ', ' + l.n + ' missile' + (l.n > 1 ? 's' : '') + ')'),
      etat:b ? (b.mort ? 'détruite' : b.enCours ? 'en chantier' : 'debout ' + Math.round(b.pv) + ' PV') : 'aucune',
      unites:prod[id] || {avant:0, apres:0}};
  }
  const triche = Object.fromEntries(Object.entries(r.camps).map(([id, c]) => [id, c.inexplique + ' / ' + c.unitesSansCommande + ' / réserves ' + c.reserves]));
  // Résumé d'une ligne (lecture rapide) ; triche : écart inexpliqué / unités sans commande / réserves finales.
  const resume = r.temps + ' s, ' + r.issue + (r.erreur ? ', ERREUR ' + r.erreur : '') + ', ' + r.msParPas + ' ms par pas | ' +
    Object.entries(galeries).map(([id, g]) => id + ' ' + g.niveau + ' ' + g.faction + ' : chantier ' + (g.chantier == null ? '—' : g.chantier + ' s') +
      ', ' + g.commandes.length + ' commande(s)' + (g.commandes.length ? ' dès ' + g.commandes[0] + ' s' : '') + ', tirs [' + g.tirs.join(' ; ') + '], ' + g.etat +
      ', unités ' + g.unites.avant + ' avant / ' + g.unites.apres + ' après, triche ' + triche[id]).join(' || ');
  return {temps:r.temps, issue:r.issue, erreur:r.erreur, msParPas:r.msParPas, galeries, triche, resume};
}
window.partieGaleries = partieGaleries;
// Galeries de tir, lot 2 (19 novembre 2026) : partieGaleries surveillée à chaque pas, pour les verdicts
// « ordinateur » du cahier (§ 9.7). Relève, en plus de partieGaleries :
//  - fautes : une unité qui garde pour cible ou pour ordre une galerie fermée depuis au moins un pas ; une
//    galerie fermée qui perd des PV ; un tir, un contre-tir ou une riposte par pouvoir de l'ordinateur dont la
//    cible était une galerie fermée ; une riposte (contre-tir ou pouvoir) arrivée après la fermeture de sa cible ;
//  - occasions de riposte, notées à chaque ouverture d'une galerie : pour chaque ordinateur hostile de niveau
//    Normale et au-dessus, contre-tir possible (Difficile, Ultra : sa galerie fermée, un missile prêt, aucune
//    retenue) et petit pouvoir à cible prêt (Frappe de Halden) ; puis ce qu'il en a fait (journal) ;
//  - réserves minimales de chaque camp.
// La graine est fixée ici (avecGraine), pour qu'une partie se rejoue seule à l'identique.
function partieGaleriesSurveillee(liste, duree, graine){
  const mj = window.miseAJour, S = {fautes:[], occasions:[], reservesMin:{}, arrivees:[]};
  const prec = new Map();   // galerie → {fermee, ouverte, pv} au pas précédent
  const vus = {};           // camp → nombre de lignes de journal déjà lues
  const faute = texte => { if(S.fautes.length < 12) S.fautes.push('t=' + temps.toFixed(1) + ' ' + texte); else S.fautes.length++; };
  window.miseAJour = function(dt){
    const r = mj.apply(this, arguments);
    for(const id of campsEnJeu()){ const v = camps[id].reserves; if(!(id in S.reservesMin) || v < S.reservesMin[id]) S.reservesMin[id] = v; }
    const gals = ents.filter(e => estGalerie(e) && !e.mort);
    for(const g of gals){
      const p = prec.get(g), f = galerieFermee(g);
      if(p && p.fermee && f){
        if(g.pv < p.pv) faute('galerie fermée ' + g.camp + ' touchée (' + Math.round(p.pv - g.pv) + ' PV)');
        for(const e of ents) if(!e.mort && hostile(e.camp, g.camp) && (e.cible === g || (e.ordre && (e.ordre.cible === g || e.ordre.bat === g)))) faute(e.type + ' ' + e.camp + ' vise la galerie fermée de ' + g.camp);
      }
      // Ouverture : occasions de riposte de chaque ordinateur hostile.
      if(p && !p.ouverte && g.galT != null){
        for(const id of campsEnJeu()){
          const R = camps[id].ia && !camps[id].elimine && hostile(id, g.camp) ? reglagesGalerieIA(id) : null;
          if(!R) continue;
          const b = ents.find(e => e.camp === id && estGalerie(e) && !e.enCours && !e.mort);
          const contre = !!(R.contreTir && b && b.gal.t0 === null && b.gal.stock >= 1 && !retenueGalerieIA(id, b, R));
          const C = camps[id], petit = (POUVOIRS[C.faction] || []).find(P => P.cible && !P.super);
          const pouvoir = !!(petit && pouvoirsActifs[id] && C.points >= petit.cout && !((C.recharges[petit.cle] || 0) > 0));
          S.occasions.push({t:temps, camp:id, niveau:niveauIA(id), cibleId:g.id, cibleCamp:g.camp, contre, pouvoir});
        }
      }
      prec.set(g, {fermee:f, ouverte:g.galT != null, pv:g.pv});
    }
    // Décisions de l'ordinateur depuis le pas précédent : la cible n'était jamais une galerie fermée ; une
    // riposte doit arriver avant la fermeture (vérifié à sa date d'arrivée).
    for(const id of campsEnJeu()){
      const E = etatsIA[id], J = E && E.galerie ? E.galerie.journal : null;
      if(!J) continue;
      for(let k = vus[id] || 0; k < J.length; k++){
        const l = J[k];
        if(!['tir', 'contreTir', 'ripostePouvoir'].includes(l.quoi)) continue;
        const c = l.cibleId != null ? ents.find(e => e.id === l.cibleId) : null;
        if(c && estGalerie(c) && galerieFermee(c) && prec.get(c) && prec.get(c).fermee) faute(id + ' ' + l.quoi + ' sur une galerie fermée');
        if(c && l.quoi !== 'tir'){
          const d = l.quoi === 'contreTir' ? delaiTirGalerie(l.n) : delaiPouvoir(POUVOIRS[camps[id].faction].find(P => P.cle === l.pouvoir));
          S.arrivees.push({camp:id, quoi:l.quoi, c, t:temps + d, ok:null});
        }
      }
      vus[id] = J.length;
    }
    for(const a of S.arrivees) if(a.ok === null && temps >= a.t - 1e-6){
      a.ok = a.c.mort || a.c.galT != null;
      if(!a.ok) faute(a.camp + ' ' + a.quoi + ' arrivé après la fermeture de sa cible');
    }
    return r;
  };
  let res;
  // (Étape 2 du lot 3 : partieRejouable, pour que la partie ne dépende plus de ce qui a tourné avant dans la page.)
  try { res = partieRejouable(() => avecGraine(graine, () => partieGaleries(liste, duree))); }
  finally { window.miseAJour = mj; }
  // Ce que chaque ordinateur a fait de ses occasions (journal daté) : contre-tir dans les 3 s, pouvoir dans
  // la durée d'ouverture (CYCLE_GALERIE.duree : 17,5 s depuis le 19 novembre 2026, 16 s avant), ou retenue notée
  // dans les 3 s (le contre-tir est alors refusé par la règle du tir ordinaire).
  for(const o of S.occasions){
    const J = (etatsIA[o.camp] && etatsIA[o.camp].galerie || {journal:[]}).journal;
    const dans = (quoi, s) => J.some(l => l.quoi === quoi && l.cibleId === o.cibleId && l.t >= o.t - 0.1 && l.t <= o.t + s);
    o.contreFait = dans('contreTir', 3); o.retenue = dans('retenue', 3); o.pouvoirFait = dans('ripostePouvoir', CYCLE_GALERIE.duree);
  }
  const ripostes = {};
  for(const id of Object.keys(res.galeries)){
    const J = (etatsIA[id] && etatsIA[id].galerie || {journal:[]}).journal;
    ripostes[id] = J.filter(l => l.quoi === 'contreTir' || l.quoi === 'ripostePouvoir').map(l => l.t + ' s ' + l.quoi + (l.pouvoir ? ' ' + l.pouvoir : '') + ' → ' + l.cible + ' ' + l.camp + ' (ouverte depuis ' + l.galT + ' s)');
    res.galeries[id].contreTirs = J.filter(l => l.quoi === 'contreTir').length;
    res.galeries[id].tirsTotal = J.filter(l => l.quoi === 'tir' || l.quoi === 'contreTir').length;
  }
  return Object.assign(res, {graine, fautes:S.fautes, occasions:S.occasions, ripostes, reservesMin:Object.fromEntries(Object.entries(S.reservesMin).map(([k, v]) => [k, Math.round(v)])),
    arrivees:S.arrivees.map(a => ({camp:a.camp, quoi:a.quoi, ok:a.ok}))});
}
window.partieGaleriesSurveillee = partieGaleriesSurveillee;
// ---------------------------------------------------------------------
//  Galeries de tir, lot 3 (19 novembre 2026) : séries « option décochée contre cochée » à graine fixe, pour
//  régler l'ordinateur par la mesure (cahier § 10, objectifs A et B). Outils de mesure seulement : rien ici
//  ne change le comportement des outils plus haut.
//  Ex. : serieGaleries('DH-NK', [1, 2, 3], 900)  (synchrone : environ 30 s par graine)
//        lancerSerieGaleries('s1', 'DH-NK', [1,2,3,4,5,6,7,8,9,10], 900)  puis lire RESULTATS.s1 (faits, bilan)
//        bilanGaleries(RESULTATS.s1.parties.concat(RESULTATS.s2.parties), 900)  (bilan de plusieurs séries)
// ---------------------------------------------------------------------
// Affrontements de l'objectif C (J à gauche ; D : Difficile, N : Normale, U : Ultra ; H : Halden, K : Karsk).
const campSerie = (id, faction, equipe, niveau) => ({id, faction, equipe, niveau});
const AFFRONTEMENTS_GALERIES = {
  'DH-NK': [campSerie('J', 'halden', 'A', 'difficile'), campSerie('I', 'karsk', 'B', 'normal')],
  'DK-NH': [campSerie('J', 'karsk', 'A', 'difficile'), campSerie('I', 'halden', 'B', 'normal')],
  'NH-DK': [campSerie('J', 'halden', 'A', 'normal'), campSerie('I', 'karsk', 'B', 'difficile')],
  'NK-DH': [campSerie('J', 'karsk', 'A', 'normal'), campSerie('I', 'halden', 'B', 'difficile')],
  'DH-DK': [campSerie('J', 'halden', 'A', 'difficile'), campSerie('I', 'karsk', 'B', 'difficile')],
  'NH-NK': [campSerie('J', 'halden', 'A', 'normal'), campSerie('I', 'karsk', 'B', 'normal')],
  'UH-DK': [campSerie('J', 'halden', 'A', 'ultra'), campSerie('I', 'karsk', 'B', 'difficile')],
  'UK-DH': [campSerie('J', 'karsk', 'A', 'ultra'), campSerie('I', 'halden', 'B', 'difficile')],
  // Hors objectif C : Ultra contre Ultra, où une armée Ultra peut être en retard (défaut 3 du cahier).
  'UH-UK': [campSerie('J', 'halden', 'A', 'ultra'), campSerie('I', 'karsk', 'B', 'ultra')],
  'quatre': [campSerie('J', 'karsk', 'A', 'difficile'), campSerie('I', 'halden', 'B', 'normal'),
             campSerie('K', 'karsk', 'C', 'normal'), campSerie('L', 'halden', 'D', 'difficile')],
};
window.AFFRONTEMENTS_GALERIES = AFFRONTEMENTS_GALERIES;
// Parties option décochée déjà jouées (clé « nom:graine:durée ») : l'option décochée ne dépend pas du réglage de
// l'ordinateur pour les galeries (règle d'or), on ne la rejoue donc pas d'une série à l'autre dans la même page.
// Après un rechargement, on peut les rendre par SANS_GALERIES = {...} (copie d'une page précédente).
window.SANS_GALERIES = {};
// Vainqueur d'une partie qui vient de finir : camps encore en jeu (ex. 'J', ou 'I+K' pour des alliés) ; null si
// la partie n'est pas terminée.
function vainqueurSerie(r){
  if(r.issue === 'non terminée') return null;
  return campsEnJeu().filter(id => !camps[id].elimine).join('+') || 'aucun';
}
// Une graine, jouée option décochée (ou reprise de SANS_GALERIES) puis cochée. Par camp, option cochée : date du
// chantier, commandes de missiles, tirs (contre-tirs compris), unités produites, triche (écart inexpliqué / unités
// sans commande / réserves finales), réserves minimales, et valeur d'armée (somme des prix des unités armées) du
// camp et de la plus forte armée hostile au moment où il pose sa galerie.
// Correction de l'étape 2 (19 novembre 2026) : une partie d'ordinateurs ne remet pas prochainId à 1 (numéros des
// entités) ; or quelques règles en dépendent (sens d'orbite d'un avion, prochainId % 2 ; durée de poursuite,
// u.id % 5). Une même graine donnait donc une partie différente selon ce qui avait tourné avant dans la page
// (relevé : Difficile contre Difficile, graine 2, option cochée, fin à 674, 700, 750 ou 900 s selon l'ordre).
// Les outils de série partent donc tous de prochainId = 1, comme le premier appel d'une page neuve.
function partieRejouable(fn){ prochainId = 1; return fn(); }
function partieSerieGaleries(nom, graine, duree){
  const liste = typeof nom === 'string' ? AFFRONTEMENTS_GALERIES[nom] : nom;
  const cle = (typeof nom === 'string' ? nom : JSON.stringify(nom)) + ':' + graine + ':' + duree;
  const cu = window.creerUnite, cb = window.construireBatiment, mj = window.miseAJour;
  let unites = {}, chantiers = {}, resMin = {};
  window.creerUnite = function(type, camp){
    const e = cu.apply(this, arguments);
    if(temps > 0 && UNITES[type] && !UNITES[type].ouvrier) unites[camp] = (unites[camp] || 0) + 1;
    return e;
  };
  window.construireBatiment = function(camp, type){
    const b = cb.apply(this, arguments);
    if(b && BATIMENTS[type] && BATIMENTS[type].galerie && !chantiers[camp]){
      let fort = 0; for(const id of campsEnJeu()) if(hostile(camp, id) && !camps[id].elimine) fort = Math.max(fort, valeurArmee(id));
      // (Étape 2 : place, contrôle de l'emplacement au moment du chantier, objectif D.)
      chantiers[camp] = {t:Math.round(temps), armee:valeurArmee(camp), plusForte:fort, place:controleEmplacementGalerie(b)};
    }
    return b;
  };
  window.miseAJour = function(){
    const r = mj.apply(this, arguments);
    for(const id of campsEnJeu()){ const v = camps[id].reserves; if(!(id in resMin) || v < resMin[id]) resMin[id] = v; }
    return r;
  };
  let sans, avec, uSans;
  try {
    sans = SANS_GALERIES[cle];
    if(!sans){
      const avant = optionGaleries; optionGaleries = false;
      try { const r = partieRejouable(() => avecGraine(graine, () => partieOrdinateurs(liste, duree))); sans = {fin:r.temps, vainqueur:vainqueurSerie(r), erreur:r.erreur, unites:unites}; }
      finally { optionGaleries = avant; }
      SANS_GALERIES[cle] = sans;
    }
    unites = {}; chantiers = {}; resMin = {};
    const r = partieRejouable(() => avecGraine(graine, () => partieGaleries(liste, duree)));
    avec = {fin:r.temps, vainqueur:vainqueurSerie(r), erreur:r.erreur, camps:{}};
    for(const id of Object.keys(r.galeries)){
      const g = r.galeries[id], E = etatsIA[id], J = E && E.galerie ? E.galerie.journal : [];
      // (Chantier : relevé aussi par l'instrument de construireBatiment, le journal étant limité à 200 lignes.)
      const ch = g.chantier != null ? g.chantier : chantiers[id] ? chantiers[id].t : null;
      avec.camps[id] = {niveau:g.niveau, faction:g.faction, chantier:ch, commandes:g.commandes.length,
        tirs:J.filter(l => l.quoi === 'tir' || l.quoi === 'contreTir').length, unites:unites[id] || 0, triche:r.triche[id],
        resMin:Math.round(resMin[id]), armeeAuChantier:chantiers[id] || null,
        repli:(E && E.galerie && E.galerie.repli) || 0};   // (étape 2 : emplacements pris faute de mieux, ancien calcul)
    }
  } finally { window.creerUnite = cu; window.construireBatiment = cb; window.miseAJour = mj; }
  return {nom:typeof nom === 'string' ? nom : 'liste', graine, duree, sans, avec};
}
window.partieSerieGaleries = partieSerieGaleries;
const medianeSerie = l => { const s = l.slice().sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1)/2] : (s[n/2 - 1] + s[n/2])/2) : null; };
const pourcent = (a, b) => b ? Math.round(100*a/b) : null;
// Bilan des objectifs du cahier (§ 10), directement en pourcentages.
//  A : parmi les parties terminées option décochée, part encore terminée option cochée (but ≥ 90 %), part au même
//      vainqueur (but ≥ 80 %), et durée médiane cochée / décochée sur ces parties (une partie non terminée compte
//      pour sa durée maximale ; but : hausse ≤ 15 %).
//  B : parmi les parties cochées d'au moins 700 s (terminées plus tard ou non terminées), par niveau et faction,
//      part des camps Normale ou Difficile qui bâtissent leur galerie (but ≥ 60 %) et qui tirent au moins une
//      fois (but ≥ 50 %) ; Ultra : nombre de chantiers posés alors que son armée était en retard (but : 0).
//  E : écarts inexpliqués, unités sans commande, réserves négatives, erreurs (but : 0 partout).
function bilanGaleries(parties, duree){
  duree = duree || (parties[0] && parties[0].duree) || 900;
  parties = parties.filter(p => p && p.sans && p.avec);
  const base = parties.filter(p => p.sans.vainqueur);
  const termine = base.filter(p => p.avec.vainqueur).length, meme = base.filter(p => p.avec.vainqueur === p.sans.vainqueur).length;
  const mS = medianeSerie(base.map(p => p.sans.fin)), mA = medianeSerie(base.map(p => p.avec.vainqueur ? p.avec.fin : duree));
  const A = {terminesSans:base.length, encoreTermines:termine + ' (' + pourcent(termine, base.length) + ' %)', memeVainqueur:meme + ' (' + pourcent(meme, base.length) + ' %)',
    medianeSans:mS, medianeAvec:mA, hausseMediane:mS ? Math.round(100*(mA/mS - 1)) + ' %' : null,
    atteint:!base.length || (termine >= 0.9*base.length && meme >= 0.8*base.length && mA <= 1.15*mS)};
  const longues = parties.filter(p => p.avec.fin >= 700);
  const B = {partiesLongues:longues.length, parCamp:{}, ultra:{chantiers:0, enRetard:0, details:[]}};
  const tous = {normal:{n:0, bati:0, tir:0}, difficile:{n:0, bati:0, tir:0}};
  for(const p of longues) for(const [id, c] of Object.entries(p.avec.camps)){
    if(c.niveau === 'ultra'){
      if(c.armeeAuChantier){ B.ultra.chantiers++; const a = c.armeeAuChantier; if(a.armee < a.plusForte) B.ultra.enRetard++;
        B.ultra.details.push(p.nom + ' g' + p.graine + ' ' + id + ' : ' + a.t + ' s, armée ' + a.armee + ' contre ' + a.plusForte); }
      continue;
    }
    if(!tous[c.niveau]) continue;
    const k = c.niveau + ' ' + c.faction, s = B.parCamp[k] || (B.parCamp[k] = {n:0, bati:0, tir:0});
    for(const x of [s, tous[c.niveau]]){ x.n++; if(c.chantier != null) x.bati++; if(c.tirs >= 1) x.tir++; }
  }
  const lire = s => s.n + ' camps : bâtie ' + pourcent(s.bati, s.n) + ' %, tir ' + pourcent(s.tir, s.n) + ' %';
  for(const k of Object.keys(B.parCamp)) B.parCamp[k] = Object.assign(B.parCamp[k], {lu:lire(B.parCamp[k])});
  B.normale = lire(tous.normal); B.difficile = lire(tous.difficile);
  B.atteint = Object.values(B.parCamp).every(s => s.bati >= 0.6*s.n && s.tir >= 0.5*s.n) && B.ultra.enRetard === 0;
  const E = {fautes:[]};
  for(const p of parties){
    if(p.sans.erreur || p.avec.erreur) E.fautes.push(p.nom + ' g' + p.graine + ' erreur ' + (p.sans.erreur || p.avec.erreur));
    for(const [id, c] of Object.entries(p.avec.camps)) if(!/^0 \/ 0 \//.test(c.triche) || c.resMin < 0) E.fautes.push(p.nom + ' g' + p.graine + ' ' + id + ' triche ' + c.triche + ', réserves min ' + c.resMin);
  }
  E.atteint = !E.fautes.length;
  // D (étape 2, 19 novembre 2026) : emplacements des galeries posées (toutes les parties cochées) : à moins de 3
  // cases du bord, loin de la base (plus de 450 px du QG), cases isolées, sorties bloquées ; cases distinctes par
  // affrontement et camp (une même case pour toutes les graines : « toujours au même endroit »).
  const D = {galeries:0, presDuBord:0, horsBase:0, coupe:0, sortiesBloquees:0, replis:0, distinctes:{}, exemples:[]};
  for(const p of parties) for(const [id, c] of Object.entries(p.avec.camps)){
    D.replis += c.repli || 0;
    const pl = c.armeeAuChantier && c.armeeAuChantier.place;
    if(!pl) continue;
    D.galeries++;
    const k = p.nom + ' ' + id, s = D.distinctes[k] || (D.distinctes[k] = {n:0, cases:{}});
    s.n++; s.cases[pl.c + ',' + pl.r] = 1;
    const f = [];
    if(pl.bord < 3) { D.presDuBord++; f.push('bord ' + pl.bord); }
    if(pl.qg > 450) { D.horsBase++; f.push('QG à ' + pl.qg + ' px'); }
    if(pl.coupe > 0) { D.coupe++; f.push(pl.coupe + ' cases isolées'); }
    if(pl.sortiesBloquees && pl.sortiesBloquees.length) { D.sortiesBloquees++; f.push('sorties ' + pl.sortiesBloquees.join(',')); }
    if(f.length && D.exemples.length < 10) D.exemples.push(p.nom + ' g' + p.graine + ' ' + id + ' : ' + f.join(', '));
  }
  for(const k of Object.keys(D.distinctes)){ const s = D.distinctes[k]; D.distinctes[k] = Object.keys(s.cases).length + ' cases / ' + s.n; }
  D.atteint = D.galeries > 0 && !D.presDuBord && !D.horsBase && !D.coupe && !D.sortiesBloquees &&
    Object.values(D.distinctes).every(v => { const m = v.split(' '); return +m[3] < 2 || +m[0] > 1; });
  return {parties:parties.length, A, B, D, E};
}
window.bilanGaleries = bilanGaleries;
// Lignes courtes d'une série (lecture rapide) : graine, fin et vainqueur sans / avec, puis par camp :
// chantier, commandes, tirs, unités (avec ; entre parenthèses : sans).
function lignesSerieGaleries(parties){
  return parties.filter(p => p && p.avec).map(p => p.nom + ' g' + p.graine + ' | sans ' + p.sans.fin + ' s ' + (p.sans.vainqueur || '—') + ' | avec ' + p.avec.fin + ' s ' + (p.avec.vainqueur || '—') + ' | ' +
    Object.entries(p.avec.camps).map(([id, c]) => id + ' ' + c.niveau.slice(0, 4) + ' ' + c.faction.slice(0, 1).toUpperCase() + ' ch ' + (c.chantier == null ? '—' : c.chantier) + ' cmd ' + c.commandes + ' tir ' + c.tirs +
      ' u ' + c.unites + '(' + ((p.sans.unites || {})[id] || 0) + ')' + (c.armeeAuChantier ? ' arm ' + c.armeeAuChantier.armee + '/' + c.armeeAuChantier.plusForte : '')).join(' ; '));
}
window.lignesSerieGaleries = lignesSerieGaleries;
// Série complète, synchrone (environ 15 s par partie : au-delà de deux graines, préférer lancerSerieGaleries).
function serieGaleries(nom, graines, duree){
  const parties = (graines || [1, 2, 3]).map(g => partieSerieGaleries(nom, g, duree || 900));
  return {nom, parties, lignes:lignesSerieGaleries(parties), bilan:bilanGaleries(parties, duree || 900)};
}
window.serieGaleries = serieGaleries;
// Même série, par morceaux : une graine par tour de la boucle du navigateur (setTimeout), résultat dans
// RESULTATS[cle] = {etat, faits, total, parties, lignes, bilan}, lisible à tout moment par de petits appels.
function lancerSerieGaleries(cle, nom, graines, duree){
  duree = duree || 900;
  const R = RESULTATS[cle] = {etat:'en cours', nom, faits:0, total:graines.length, parties:[], lignes:[], bilan:null};
  let i = 0;
  const pas = () => {
    if(i >= graines.length){ R.bilan = bilanGaleries(R.parties, duree); R.etat = 'fini'; return; }
    try { R.parties.push(partieSerieGaleries(nom, graines[i], duree)); }
    catch(e){ R.parties.push({nom, graine:graines[i], erreur:e.message}); }
    i++; R.faits = i; R.lignes = lignesSerieGaleries(R.parties);
    setTimeout(pas, 10);
  };
  setTimeout(pas, 10);
  return 'lancée : RESULTATS.' + cle;
}
window.lancerSerieGaleries = lancerSerieGaleries;
// Plusieurs séries à la suite, une graine à la fois (même principe) : noms = ['DH-NK', 'NH-NK', ...].
function lancerSeriesGaleries(cle, noms, graines, duree){
  duree = duree || 900;
  const R = RESULTATS[cle] = {etat:'en cours', faits:0, total:noms.length*graines.length, parties:[], lignes:[], bilan:null};
  const travaux = []; for(const n of noms) for(const g of graines) travaux.push([n, g]);
  let i = 0;
  const pas = () => {
    if(i >= travaux.length){ R.bilan = bilanGaleries(R.parties, duree); R.etat = 'fini'; return; }
    const [n, g] = travaux[i];
    try { R.parties.push(partieSerieGaleries(n, g, duree)); }
    catch(e){ R.parties.push({nom:n, graine:g, erreur:e.message}); }
    i++; R.faits = i; R.lignes = lignesSerieGaleries(R.parties);
    setTimeout(pas, 10);
  };
  setTimeout(pas, 10);
  return 'lancées : RESULTATS.' + cle;
}
window.lancerSeriesGaleries = lancerSeriesGaleries;
// Variante par morceaux SYNCHRONES, quand la page est en arrière-plan (le navigateur y ralentit les setTimeout
// enchaînés jusqu'à une graine par minute) : preparerSeriesGaleries('c', noms, graines, 900), puis
// avancerSeriesGaleries('c', 20000) autant de fois qu'il faut (chaque appel joue des graines pendant 20 s au
// plus, et rend ce qui reste) ; RESULTATS.c.bilan est rempli quand tout est joué. Un appel interrompu de
// l'extérieur perd au plus la partie en cours (elle reste dans la file).
function preparerSeriesGaleries(cle, noms, graines, duree){
  const travaux = []; for(const n of noms) for(const g of graines) travaux.push([n, g]);
  RESULTATS[cle] = {etat:'en cours', duree:duree || 900, travaux, faits:0, total:travaux.length, parties:[], lignes:[], bilan:null};
  return travaux.length + ' parties à jouer';
}
window.preparerSeriesGaleries = preparerSeriesGaleries;
function avancerSeriesGaleries(cle, limite){
  const R = RESULTATS[cle], t0 = performance.now();
  while(R.travaux.length && performance.now() - t0 < (limite || 20000)){
    const [n, g] = R.travaux[0];
    R.parties.push(partieSerieGaleries(n, g, R.duree));
    R.travaux.shift(); R.faits++;
  }
  R.lignes = lignesSerieGaleries(R.parties);
  if(!R.travaux.length){ R.bilan = bilanGaleries(R.parties, R.duree); R.etat = 'fini'; }
  return {reste:R.travaux.length, faits:R.faits};
}
window.avancerSeriesGaleries = avancerSeriesGaleries;
// Lot 3, étape 2 (19 novembre 2026), défaut 4 : chantiers d'une partie, datés, avec « aeroVide » vrai quand le
// camp a un aéroport terminé, sans avion ni commande (l'ordinateur attend alors son premier avion, et rien d'autre que
// la galerie ne doit passer option cochée). Ex. : chantiersPartieGaleries('DH-DK', 2, 900, true).batteriesAttente
function chantiersPartieGaleries(nom, graine, duree, cochee){
  const liste = typeof nom === 'string' ? AFFRONTEMENTS_GALERIES[nom] : nom;
  const cb = window.construireBatiment, l = [];
  window.construireBatiment = function(camp, type){
    const b = cb.apply(this, arguments);
    if(b){
      // (Comme dans economieIA : aéroport prêt SANS commande en cours ; avec un avion en commande, l'ordinateur
      // n'attend plus et tout bâtiment peut passer, option décochée comme cochée.)
      const aero = ents.find(e => e.camp === camp && e.def.aeroport && !e.enCours && !e.mort && !e.file.length);
      l.push({t:Math.round(temps), camp, type, aeroVide:!!aero && avionsDe(aero).length === 0});
    }
    return b;
  };
  const avant = optionGaleries; optionGaleries = !!cochee;
  let r;
  try { r = partieRejouable(() => avecGraine(graine, () => partieOrdinateurs(liste, duree || 900))); }
  finally { optionGaleries = avant; window.construireBatiment = cb; }
  const attente = l.filter(x => x.aeroVide && !BATIMENTS[x.type].galerie);
  return {fin:r.temps, issue:r.issue, erreur:r.erreur, chantiers:l, batteriesAttente:attente.filter(x => x.type === 'batterie').map(x => x.camp + ' ' + x.t + ' s'),
    autresAttente:attente.map(x => x.camp + ' ' + x.type + ' ' + x.t + ' s')};
}
window.chantiersPartieGaleries = chantiersPartieGaleries;
// Défaut 5 : contrôle de l'emplacement d'une galerie b (posée). Rend :
//  bord : cases entre la galerie et le bord de la carte (but ≥ 3) ; qg : px jusqu'au QG du camp (ou son bâtiment
//  le plus proche) ; batProche : px jusqu'au plus proche autre bâtiment du camp ;
//  coupe : cases libres que la galerie isole du reste (comptage des cases joignables depuis la sortie du QG, avec
//  et sans la galerie, moins ses 9 cases) : 0 attendu ; sortiesBloquees : bâtiments du camp dont la case de sortie
//  n'est plus joignable depuis celle du QG (0 attendu).
function controleEmplacementGalerie(b){
  const t = b.def.taille, c = Math.round(b.x/TUILE - t/2), r = Math.round(b.y/TUILE - t/2);
  const bord = Math.min(c, r, COLS - (c + t), LIGNES - (r + t));
  const miens = ents.filter(e => e.est === 'batiment' && !e.mort && e.camp === b.camp && e !== b);
  const qg = miens.find(e => e.type === 'qg') || miens[0];
  const caseSortie = e => [Math.max(0, Math.min(COLS-1, Math.floor(e.x/TUILE))), Math.max(0, Math.min(LIGNES-1, Math.floor((e.y + e.rayon + 20)/TUILE)))];
  const joignables = depart => {
    const vu = new Uint8Array(COLS*LIGNES), file = [depart[1]*COLS + depart[0]];
    if(grille[file[0]] !== 0) return {n:0, vu};
    vu[file[0]] = 1; let n = 0;
    while(file.length){
      const k = file.pop(); n++;
      const kc = k % COLS, kr = (k/COLS)|0;
      for(const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nc = kc + dc, nr = kr + dr, nk = nr*COLS + nc;
        if(nc < 0 || nr < 0 || nc >= COLS || nr >= LIGNES || vu[nk] || grille[nk] !== 0) continue;
        vu[nk] = 1; file.push(nk);
      }
    }
    return {n, vu};
  };
  if(!qg) return {bord, qg:null};
  const s0 = caseSortie(qg), avec = joignables(s0);
  const cases = [];
  for(let rr = r; rr < r + t; rr++) for(let cc = c; cc < c + t; cc++) if(rr >= 0 && cc >= 0 && rr < LIGNES && cc < COLS){ cases.push(rr*COLS + cc); }
  const avant = cases.map(k => grille[k]);
  for(const k of cases) grille[k] = 0;
  const sans = joignables(s0);
  cases.forEach((k, i) => { grille[k] = avant[i]; });
  const sortiesBloquees = miens.filter(e => { const s = caseSortie(e), k = s[1]*COLS + s[0]; return sans.vu[k] && !avec.vu[k]; }).map(e => e.type);
  let batProche = Infinity; for(const e of miens) batProche = Math.min(batProche, dist(e, b));
  return {c, r, bord, qg:Math.round(dist(qg, b)), batProche:Math.round(batProche), coupe:sans.n - avec.n - cases.length, sortiesBloquees};
}
window.controleEmplacementGalerie = controleEmplacementGalerie;
// Hasard fixé pour rejouer une partie à l'identique : avecGraine(5, () => duelUltra('difficile', false, 'halden')).
function avecGraine(graine, fn){
  let s = graine; const r0 = Math.random;
  Math.random = () => { s = (s*1103515245 + 12345) % 2147483648; return s/2147483648; };
  try { return fn(); } finally { Math.random = r0; }
}
window.avecGraine = avecGraine;

function verifierMissionMoteur(){
  const M = MISSION, pb = [];
  if(!M) return ['aucune mission chargée'];
  const libreT = (c, r) => c >= 0 && r >= 0 && c < COLS && r < LIGNES && grille[r*COLS+c] === 0;
  // --- Départ ---
  for(const camp of ['J','I','N']) for(const e of ((M.depart || {})[camp] || [])){
    if(BATIMENTS[e.type] && e.c != null){
      const t = BATIMENTS[e.type].taille;
      // Avant création des entités, la grille doit être libre ; après, elle vaut 3 (bâtiment).
      for(let r = e.r; r < e.r + t; r++) for(let c = e.c; c < e.c + t; c++){
        const v = grille[r*COLS+c];
        if(v !== 0 && v !== 3) pb.push('départ ' + camp + ' ' + e.type + ' (' + e.c + ',' + e.r + ') : tuile ' + c + ',' + r + ' = ' + v);
      }
    } else if(UNITES[e.type] && !UNITES[e.type].aerien){
      if(!libre(e.x, e.y)) pb.push('départ ' + camp + ' ' + e.type + ' (' + e.x + ',' + e.y + ') sur tuile non libre');
    }
  }
  // --- Accessibilité (recherche de chemin du moteur) ---
  const depJ = ((M.depart || {}).J || []).find(e => UNITES[e.type] && !UNITES[e.type].aerien);
  if(!depJ) return pb;
  const points = [];
  const zone = (z, q) => z && points.push([z.x, z.y, q]);
  for(const o of (M.objectifs || [])) zone(o.zone, 'objectif ' + o.id);
  for(const d of (M.declencheurs || [])){
    if(d.quand && d.quand.zone) zone(d.quand.zone, 'condition ' + d.id);
    for(const a of (d.faire || [])){
      if(a.zone) zone(a.zone, 'zone ' + a.zone.id);
      if(a.objectif && a.objectif.ajouter && a.objectif.ajouter.zone) zone(a.objectif.ajouter.zone, 'objectif ' + a.objectif.ajouter.id);
      if(a.renforts && !a.renforts.unites.every(u => UNITES[u.type] && UNITES[u.type].aerien)){
        points.push([a.renforts.depuis.x, a.renforts.depuis.y, 'renforts depuis (' + d.id + ')']);
        if(a.renforts.vers) points.push([a.renforts.vers.x, a.renforts.vers.y, 'renforts vers (' + d.id + ')']);
      }
      if(a.deplacer) for(const p of a.deplacer.chemin) points.push([p.x, p.y, 'chemin (' + d.id + ')']);
    }
  }
  for(const [x, y, q] of points){
    const ch = trouverChemin(depJ.x, depJ.y, x, y);
    if(!ch || !ch.length){ pb.push(q + ' : aucun chemin vers (' + x + ', ' + y + ')'); continue; }
    const f = ch[ch.length - 1];
    if(Math.hypot(f.x - x, f.y - y) > 120) pb.push(q + ' : le chemin s’arrête à ' + Math.round(Math.hypot(f.x - x, f.y - y)) + ' px du point (' + x + ', ' + y + ')');
  }
  return pb;
}

// ---------------------------------------------------------------------
//  Multijoueur, étapes 1 et 2 (novembre 2026) : ordres et retour au joueur par camp.
// ---------------------------------------------------------------------
// Empreinte de l'état (hachage FNV-1a 32 bits) : temps, réserves, points et élimination de chaque camp,
// puis, pour chaque entité dans l'ordre de ents : id, type, camp, position, points de vie, mort. Sert à
// comparer deux versions du moteur sur des parties à hasard fixé (avecGraine) : même code autonome que celui
// injecté dans la copie de référence.
function empreinteEtat(){
  let h = 2166136261 >>> 0;
  const aj = s => { s = String(s); for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  aj('t' + temps);
  for(const id of Object.keys(camps).sort()){ const C = camps[id]; aj(id + ':' + C.reserves + ':' + C.points + ':' + !!C.elimine); }
  const n = {};
  for(const e of ents){ aj(e.id + e.type + e.camp + ':' + e.x + ',' + e.y + ':' + e.pv + (e.mort ? 'm' : '')); n[e.camp] = (n[e.camp] || 0) + 1; }
  return {empreinte:h.toString(16), temps:+temps.toFixed(2), entites:n, reserves:Object.fromEntries(Object.keys(camps).sort().map(id => [id, Math.round(camps[id].reserves)]))};
}
window.empreinteEtat = empreinteEtat;
// Photographie détaillée de l'état (pour constater qu'un ordre refusé ne change rien) : en plus de
// l'empreinte, les ordres, cibles, chemins, files, points de ralliement, recharges, pause, grille.
function photoEtat(){
  const ref = x => x && typeof x === 'object' ? (x.id != null ? '#' + x.id : noeuds.indexOf(x) >= 0 ? 'n' + noeuds.indexOf(x) : JSON.stringify(x)) : String(x);
  const ordre = o => o ? Object.keys(o).sort().map(k => k + '=' + ref(o[k])).join(',') : '-';
  let g = 0; for(let i = 0; i < grille.length; i++) g = (g*31 + grille[i]) % 1000000007;
  return JSON.stringify({temps, enPause, partieFinie, alliance, mode:mode ? mode.type : null, g, selection:selection.map(e => e.id),
    camps:Object.keys(camps).sort().map(id => [id, camps[id].reserves, camps[id].points, JSON.stringify(camps[id].recharges || {}), !!camps[id].elimine, !!camps[id].ia]),
    ents:ents.map(e => [e.id, e.type, e.camp, e.x, e.y, e.pv, !!e.mort, ordre(e.ordre), ref(e.cible), e.chemin ? e.chemin.length : 0,
      e.file ? e.file.join('+') : '', e.rally ? e.rally.x + ',' + e.rally.y : '', !!e.gare, e.prodT, ref(e.cibleSoin), !!e.enCours]),
    n:[ents.length, projectiles.length, effets.length, evenements.length]});
}
window.photoEtat = photoEtat;
// Ordres invalides ou hostiles envoyés au nom du camp J (une partie en cours : demarrer() si besoin) : chacun
// doit être refusé (ok:false, motif) et l'état doit rester identique (photoEtat avant / après chaque ordre).
// Renvoie {refuses, acceptes:[...], changes:[...], motifs} : acceptes et changes doivent être vides.
function essaiOrdresHostiles(){
  window.enregistrerVictoire = () => {};
  if(!enJeu) demarrer('halden', configTest('halden', 'duel'));
  const de = (camp, f) => ents.find(e => e.camp === camp && !e.mort && f(e));
  const qgJ = de('J', e => e.type === 'qg'), qgI = de('I', e => e.type === 'qg');
  const uJ = de('J', e => e.est === 'unite' && e.def.arme && !e.def.ouvrier), uI = de('I', e => e.est === 'unite' && e.def.arme);
  const oJ = de('J', e => e.est === 'unite' && e.def.ouvrier), oI = de('I', e => e.est === 'unite' && e.def.ouvrier);
  const FJ = FACTIONS[camps.J.faction], FI = FACTIONS[camps.I.faction];
  const requis = Object.keys(BATIMENTS).find(t => BATIMENTS[t].requiert && batimentsConstructibles(FJ).includes(t) && !ents.some(b => b.camp === 'J' && b.type === BATIMENTS[t].requiert));
  const pouvoirI = (POUVOIRS[camps.I.faction] || []).find(p => !(POUVOIRS[camps.J.faction] || []).some(q => q.cle === p.cle));
  const pouvoirJ = (POUVOIRS[camps.J.faction] || []).find(p => p.cible);
  const nonProduit = Object.keys(UNITES).find(t => !(FJ.production.qg || []).includes(t) && !UNITES[t].aerien);
  const x = uJ.x, y = uJ.y, ids = [uJ.id];
  camps.J.points = 0;   // aucun pouvoir payable
  const essais = [
    ['unité d’un autre camp', 'J', {type:'droit', ids:[uI.id], x, y}],
    ['identifiant inconnu', 'J', {type:'droit', ids:[987654], x, y}],
    ['une unité à nous et une adverse', 'J', {type:'droit', ids:[uJ.id, uI.id], x, y}],
    ['x non fini (NaN)', 'J', {type:'droit', ids, x:NaN, y}],
    ['x infini', 'J', {type:'droit', ids, x:Infinity, y}],
    ['hors carte (négatif)', 'J', {type:'droit', ids, x:-50, y}],
    ['hors carte (au-delà)', 'J', {type:'droit', ids, x:LARG + 100, y:HAUT + 100}],
    ['x en texte', 'J', {type:'droit', ids, x:String(x), y}],
    ['ids n’est pas un tableau', 'J', {type:'droit', ids:String(uJ.id), x, y}],
    ['ids vide', 'J', {type:'droit', ids:[], x, y}],
    ['identifiant non entier', 'J', {type:'droit', ids:[uJ.id + 0.5], x, y}],
    ['identifiant en double', 'J', {type:'droit', ids:[uJ.id, uJ.id], x, y}],
    ['trop d’identifiants', 'J', {type:'droit', ids:Array.from({length:201}, (_, i) => i + 1), x, y}],
    ['cible inconnue', 'J', {type:'droit', ids, x, y, cibleId:987654}],
    ['champs manquants', 'J', {type:'droit'}],
    ['attaque-déplacement d’un bâtiment', 'J', {type:'attaqueDeplacement', ids:[qgJ.id], x, y}],
    ['arrêt d’une unité adverse', 'J', {type:'arret', ids:[uI.id]}],
    ['ralliement d’un bâtiment adverse', 'J', {type:'ralliement', ids:[qgI.id], x, y}],
    ['ralliement d’une unité', 'J', {type:'ralliement', ids, x, y}],
    ['bâtiment non constructible (QG)', 'J', {type:'construire', bat:'qg', c:10, r:10, ouvrierIds:[oJ.id]}],
    ['bâtiment inexistant', 'J', {type:'construire', bat:'chateau', c:10, r:10, ouvrierIds:[oJ.id]}],
    ['bâtiment « __proto__ »', 'J', {type:'construire', bat:'__proto__', c:10, r:10, ouvrierIds:[oJ.id]}],
    ['case hors carte', 'J', {type:'construire', bat:'caserne', c:-5, r:3, ouvrierIds:[oJ.id]}],
    ['case en texte', 'J', {type:'construire', bat:'caserne', c:'10', r:'10', ouvrierIds:[oJ.id]}],
    ['emplacement occupé (sur le QG)', 'J', {type:'construire', bat:'caserne', c:qgJ.c, r:qgJ.r, ouvrierIds:[oJ.id]}],
    ['bâtiment requis absent (' + requis + ')', 'J', {type:'construire', bat:requis, c:qgJ.c + 8, r:qgJ.r, ouvrierIds:[oJ.id]}],
    ['ouvrier d’un autre camp', 'J', {type:'construire', bat:'caserne', c:qgJ.c + 8, r:qgJ.r, ouvrierIds:[oI.id]}],
    ['« ouvrier » qui n’en est pas un', 'J', {type:'construire', bat:'caserne', c:qgJ.c + 8, r:qgJ.r, ouvrierIds:[uJ.id]}],
    ['production dans le QG adverse', 'J', {type:'produire', batId:qgI.id, unite:FI.ouvrier}],
    ['type non productible par ce bâtiment (' + nonProduit + ')', 'J', {type:'produire', batId:qgJ.id, unite:nonProduit}],
    ['type d’unité inconnu', 'J', {type:'produire', batId:qgJ.id, unite:'licorne'}],
    ['type « constructor »', 'J', {type:'produire', batId:qgJ.id, unite:'constructor'}],
    ['production par une unité', 'J', {type:'produire', batId:uJ.id, unite:FJ.ouvrier}],
    ['retrait de la file du QG adverse', 'J', {type:'retirer', batId:qgI.id, unite:FI.ouvrier}],
    ['retrait d’un type absent de la file', 'J', {type:'retirer', batId:qgJ.id, unite:FJ.ouvrier}],
    ['pouvoir de l’autre faction (' + (pouvoirI && pouvoirI.cle) + ')', 'J', {type:'pouvoir', cle:pouvoirI && pouvoirI.cle, x, y}],
    ['pouvoir sans points (' + pouvoirJ.cle + ')', 'J', {type:'pouvoir', cle:pouvoirJ.cle, x, y}],
    ['pouvoir, cible en texte', 'J', {type:'pouvoir', cle:pouvoirJ.cle, x:'100', y:'100'}],
    ['pouvoir, cible NaN', 'J', {type:'pouvoir', cle:pouvoirJ.cle, x:NaN, y}],
    ['type d’ordre inconnu', 'J', {type:'teleporter', ids, x, y}],
    ['ordre null', 'J', null],
    ['ordre en texte', 'J', 'droit'],
    ['ordre tableau', 'J', ['droit']],
    ['camp inconnu', 'Z', {type:'droit', ids, x, y}],
    ['camp des envahisseurs', 'X', {type:'arret', ids}],
    ['pause demandée par un camp distant', 'I', {type:'pause'}],
    ['pause, champ « oui » invalide', 'J', {type:'pause', oui:'oui'}],
    ['alliance sans dialogue', 'J', {type:'alliance', oui:true}],
    ['trêve sans invasion', 'J', {type:'proposerTreve'}],
    ['abandon par un camp distant', 'I', {type:'abandon'}],
    ['camp éliminé', 'I', {type:'arret', ids:[uI.id]}, () => { camps.I.elimine = true; }, () => { camps.I.elimine = false; }],
  ];
  const res = {refuses:0, acceptes:[], changes:[], motifs:{}};
  for(const [nom, camp, ordre, avant, apres] of essais){
    if(avant) avant();
    const p0 = photoEtat();
    let r;
    try { r = executerOrdre(camp, ordre); } catch(e){ r = {ok:'EXCEPTION ' + e.message}; }
    const p1 = photoEtat();
    if(apres) apres();
    if(r.ok) res.acceptes.push(nom + ' : ' + r.ok); else res.refuses++;
    if(p1 !== p0) res.changes.push(nom);
    res.motifs[nom] = r.motif;
  }
  // Contre-épreuve : un ordre valide est accepté et change bien l'état.
  const p0 = photoEtat(), r = executerOrdre('J', {type:'droit', ids, x:x + 120, y});
  res.controle = {ok:r.ok, change:photoEtat() !== p0};
  res.nombre = essais.length;
  return res;
}
window.essaiOrdresHostiles = essaiOrdresHostiles;
// Partie où le joueur local tient le camp « id » (I par défaut) : duel J (ordinateur) contre id (humain,
// interface locale). À lancer sur une page fraîche ; la vérification se fait ensuite à l'écran ou dans la console.
function essaiCampLocal(id, factionJ){
  id = id || 'I';
  window.enregistrerVictoire = () => {};
  if(!enJeu) demarrer(factionJ || 'halden', configTest(factionJ || 'halden', 'duel'));
  confierAOrdinateur('J', 'normal');
  camps[id].ia = false;
  definirCampLocal(id);
  return {campLocal:campLocal(), ia:Object.fromEntries(campsEnJeu().map(c => [c, !!camps[c].ia])), faction:camps[id].faction};
}
window.essaiCampLocal = essaiCampLocal;

// ---------------------------------------------------------------------
//  Multijoueur, étapes 3 à 5 (novembre 2026) : comparaison hôte / invité dans le mode d'essai ?echo.
// ---------------------------------------------------------------------
// Robot de l'invité : il joue le camp local de l'invité par des ordres envoyés à l'hôte (executerOrdre détourné
// vers le réseau) ; il ne lit que l'état affiché de l'invité. Production, une caserne, attaque toutes les 40 s.
function robotInvite(etat){
  const moi = campLocal(), C = camps[moi], F = FACTIONS[C.faction];
  const mes = ents.filter(e => e.camp === moi && !e.mort);
  const envoyer = o => { const r = executerOrdre(moi, o); etat.envoyes++; if(!r.ok){ etat.refusLocaux++; etat.motifs[r.code] = (etat.motifs[r.code] || 0) + 1; } };
  let budget = C.reserves;
  const nCol = mes.filter(e => e.def.collecteur).length;
  for(const b of mes){
    if(b.est !== 'batiment' || b.enCours || b.file.length >= 2) continue;
    const liste = (F.production[b.type] || []).filter(t => UNITES[t] && !UNITES[t].avion);
    if(!liste.length) continue;
    const armes = liste.filter(t => UNITES[t].arme && !UNITES[t].ouvrier && !UNITES[t].collecteur);
    const t = b.type === 'qg' ? (nCol < 3 ? liste.find(x => UNITES[x].collecteur) : null) : armes[etat.k++ % Math.max(1, armes.length)];
    if(!t || UNITES[t].cout > budget) continue;
    budget -= UNITES[t].cout;
    envoyer({type:'produire', batId:b.id, unite:t});
  }
  const qg = mes.find(b => b.type === 'qg');
  if(qg && mes.filter(b => b.type === 'caserne').length < 2 && budget >= BATIMENTS.caserne.cout && etat.t - etat.chantierT > 20){
    for(let d = 4; d < 14 && etat.t - etat.chantierT > 20; d++) for(const [dc, dr] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]){
      const c = qg.c + dc, r = qg.r + dr;
      if(emplacementValide('caserne', c, r, true)){ envoyer({type:'construire', bat:'caserne', c, r}); etat.chantierT = etat.t; break; }
    }
  }
  if(etat.t % 40 === 0){
    const armee = mes.filter(e => e.est === 'unite' && e.def.arme && !e.def.ouvrier && !e.def.collecteur);
    const cible = ents.find(e => e.type === 'qg' && !e.mort && hostile(moi, e.camp));
    if(armee.length >= 6 && cible) envoyer({type:'attaqueDeplacement', ids:armee.slice(0, 200).map(e => e.id), x:cible.x, y:cible.y, cibleId:null});
  }
  etat.t++;
}
window.robotInvite = robotInvite;
// Partie de « duree » secondes dans le mode ?echo (page ouverte avec ?echo&verif, retard et pertes réglés dans
// l'adresse : &retard=150&perte=5), menée en temps réel par le minuteur du Worker de reseau.js (non bridé en
// arrière-plan). Compare champ par champ l'hôte et l'invité :
//  - brut : dernier instantané appliqué par l'invité contre l'état de l'hôte au même instant (positions,
//    entités manquantes ou en trop, réserves, files de production) ;
//  - affichage : positions lissées de l'invité à son instant d'affichage contre celles de l'hôte au même instant
//    de jeu (interpolées entre deux pas de l'hôte) ;
//  - sauts : déplacements affichés de plus de 40 px en un pas de 0,05 s alors que l'hôte a bougé de moins de 20 px.
// Renvoie une promesse du rapport (chiffres mesurés, rien d'estimé).
function essaiEcho(opts){
  opts = Object.assign({duree:480, robot:true, dessin:1}, opts || {});
  if(modeReseau !== 'echo' || !echo.pret) return Promise.resolve({erreur:'ouvrir la page avec ?echo&verif et attendre echo.pret'});
  window.enregistrerVictoire = () => {};
  echo.piloteExterne = true;
  const histo = [];
  const photo = () => {
    const pos = new Map(), files = new Map(), res = {};
    for(const e of ents){ if(e.mort) continue; pos.set(e.id, e.est === 'unite' ? [e.x, e.y] : null); if(e.est === 'batiment') files.set(e.id, e.file.join('+')); }
    for(const id of campsEnJeu()) res[id] = camps[id].reserves;
    return {T:temps, pos, files, res};
  };
  const posHote = (id, T) => {
    for(let i = histo.length - 1; i > 0; i--){
      const a = histo[i - 1], b = histo[i];
      if(a.T <= T + 1e-9 && T <= b.T + 1e-9){
        const pa = a.pos.get(id), pb = b.pos.get(id);
        if(!pa || !pb) return pa || pb || null;
        const f = b.T > a.T ? (T - a.T)/(b.T - a.T) : 0;
        return [pa[0] + (pb[0] - pa[0])*f, pa[1] + (pb[1] - pa[1])*f];
      }
    }
    return null;
  };
  const M = {aff:[], brutMax:0, brutSomme:0, brutN:0, manquantes:0, enTrop:0, manquantesMax:0, enTropMax:0, reservesMax:0, files:0,
    echantillons:0, sansHote:0, sauts:0, sautsEx:[], erreurs:[], entitesHote:0, entitesInvite:0};
  const robot = {t:0, k:0, envoyes:0, refusLocaux:0, motifs:{}, chantierT:-99};
  echo.apresPasHote = () => { histo.push(photo()); if(histo.length > 80) histo.shift(); };
  let prec = new Map(), TaPrec = null;
  const comparer = final => {
    const s0 = invite.courant; if(!s0) return;
    const h0 = histo.find(h => Math.abs(h.T - s0.T) < 0.0015);
    if(!h0){ M.sansHote++; return; }
    M.echantillons++;
    for(const [id, r] of s0.unites){ const p = h0.pos.get(id); if(p){ const d = Math.hypot(r.x - p[0], r.y - p[1]); M.brutSomme += d; M.brutN++; if(d > M.brutMax) M.brutMax = d; } }
    let manq = 0, trop = 0;
    for(const id of h0.pos.keys()) if(!invite.index.has(id)) manq++;
    for(const id of invite.index.keys()) if(!h0.pos.has(id)) trop++;
    M.manquantes += manq; M.enTrop += trop; M.manquantesMax = Math.max(M.manquantesMax, manq); M.enTropMax = Math.max(M.enTropMax, trop);
    for(const id in h0.res) if(camps[id]) M.reservesMax = Math.max(M.reservesMax, Math.abs(camps[id].reserves - h0.res[id]));
    for(const [id, f] of h0.files){ const b = invite.index.get(id); if(b && b.file.join('+') !== f) M.files++; }
    // Affichage : positions lissées à l'instant d'affichage.
    for(const e of ents){ if(e.mort || e.est !== 'unite') continue; const p = posHote(e.id, invite.Ta); if(p) M.aff.push(Math.hypot(e.x - p[0], e.y - p[1])); }
    if(final){ M.entitesHote = h0.pos.size; M.entitesInvite = invite.index.size; M.final = {manquantes:manq, enTrop:trop}; }
  };
  echo.apresPasInvite = () => {
    // Sauts visibles d'un pas à l'autre.
    const Ta = invite.Ta, cur = new Map();
    for(const e of ents){
      if(e.mort || e.est !== 'unite') continue;
      cur.set(e.id, [e.x, e.y]);
      const q = prec.get(e.id);
      if(q && TaPrec != null){
        const d = Math.hypot(e.x - q[0], e.y - q[1]);
        if(d > 40){
          const a = posHote(e.id, TaPrec), b = posHote(e.id, Ta), dh = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : null;
          if(dh !== null && dh < 20){ M.sauts++; if(M.sautsEx.length < 5) M.sautsEx.push({id:e.id, type:e.type, d:+d.toFixed(1), hote:+dh.toFixed(1), Ta:+Ta.toFixed(2)}); }
        }
      }
    }
    prec = cur; TaPrec = Ta;
  };
  const debut = performance.now();
  let pas = 0;
  return new Promise(fin => {
    let arret = null, fini = false;
    const terminer = () => {
      if(fini) return; fini = true;
      if(arret) arret();
      echo.apresPasHote = echo.apresPasInvite = null; echo.piloteExterne = false;
      comparer(true);
      const aff = M.aff.sort((a, b) => a - b), duree = (performance.now() - debut)/1000;
      const H = echo.salonHote, I = echo.salonInvite, dh = H.debit(), di = I.debit();
      fin({
        dureeReelle:+duree.toFixed(1), tempsHote:+dansMonde(mondes.hote, () => temps).toFixed(2), tempsInvite:+invite.Ta.toFixed(2),
        reglages:{retard:echo.bus && echo.bus.params, stats:echo.bus && echo.bus.stats},
        debit:{hoteEnvoiOctetsParS:+(dh.envoi.octets/duree).toFixed(0), inviteReceptionOctetsParS:+(di.reception.octets/duree).toFixed(0),
          inviteEnvoiOctetsParS:+(di.envoi.octets/duree).toFixed(0), messagesHoteParS:+(dh.envoi.messages/duree).toFixed(1)},
        instantanes:{hote:H.statistiques().instantanes, invite:I.statistiques().instantanes, appliques:invite.appliques, recalages:invite.recalages},
        evenements:I.statistiques().evenements,
        ordres:{robot, hote:hoteReseau.ordres, invite:I.statistiques().ordres},
        ecartBrut:{moyen:M.brutN ? +(M.brutSomme/M.brutN).toFixed(4) : null, max:+M.brutMax.toFixed(4), mesures:M.brutN},
        ecartAffichage:{moyen:aff.length ? +(aff.reduce((s, v) => s + v, 0)/aff.length).toFixed(2) : null,
          median:aff.length ? +aff[aff.length >> 1].toFixed(2) : null, p95:aff.length ? +aff[Math.floor(aff.length*0.95)].toFixed(2) : null,
          max:aff.length ? +aff[aff.length - 1].toFixed(2) : null, mesures:aff.length},
        entites:{echantillons:M.echantillons, sansHote:M.sansHote, manquantesCumul:M.manquantes, enTropCumul:M.enTrop, manquantesMax:M.manquantesMax,
          enTropMax:M.enTropMax, final:M.final, hote:M.entitesHote, invite:M.entitesInvite},
        reservesEcartMax:+M.reservesMax.toFixed(2), filesDifferentes:M.files,
        sautsVisibles:M.sauts, exemplesSauts:M.sautsEx, erreurs:M.erreurs,
        camps:Object.fromEntries(campsEnJeu().map(id => [id, {elimine:!!camps[id].elimine, reserves:Math.round(camps[id].reserves)}])),
      });
    };
    const tic = () => {
      if(fini) return;
      const du = Math.min(4, Math.floor((performance.now() - debut)/50) - pas);
      for(let k = 0; k < du; k++){
        pasEcho(0.05); pas++;
        if(pas % 20 === 0){
          if(opts.robot) robotInvite(robot);
          comparer(false);
          if(opts.dessin && (pas/20) % opts.dessin === 0) dessiner(0.05);
        }
        if(pas*0.05 >= opts.duree){ terminer(); return; }
      }
    };
    arret = Reseau.minuteur(50, () => { try { tic(); } catch(e){ M.erreurs.push('t=' + invite.Ta.toFixed(1) + ' ' + e.message + ' | ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ')); terminer(); } });
  });
}
window.essaiEcho = essaiEcho;

// ---------------------------------------------------------------------
//  Galeries de tir en ligne, lot 1 (20 novembre 2026, travaux/multijoueur/CAHIER-GALERIES-EN-LIGNE.md § 8)
//  Page : front-de-sel.html?echo&galeries=1&camps=2&verif, attendre echo.pret, puis
//    tache('gel', () => 'lancé') ; testerGaleriesEnLigne().then(r => RESULTATS.gel = r)
//  (ou simplement testerGaleriesEnLigne('gel') : le rapport arrive dans RESULTATS.gel, environ 40 s plus tard).
//  Mené en temps réel par le minuteur du Worker (la boucle locale de reseau.js a un vrai retard). L'invité (I,
//  Karsk, monde affiché) donne ses ordres par executerOrdre → réseau simulé → hôte : construire la galerie,
//  fabriquer un missile, un tir refusé sur place (hors carte), puis tirer sur le QG de J. Pour aller vite, dans le
//  monde de l'hôte et par les seules données du moteur : réserves gonflées, usine posée, chantier achevé d'un coup,
//  fabrication raccourcie (fabT), galerie de J posée et chargée, son tir ordonné par executerOrdre chez l'hôte.
//  Comparé à chaque instantané appliqué par l'invité : état des deux galeries (stock, fab, fabT arrondi, t0 à
//  1/50 s, n, tires) contre celui de l'hôte au même instant. Renvoie une promesse de verdicts {nom, ok, detail}.
// ---------------------------------------------------------------------
function testerGaleriesEnLigne(cle){
  if(modeReseau !== 'echo' || !echo.pret || !mondes) return Promise.resolve([{nom:'page ?echo&galeries=1&verif prête', ok:false, detail:{modeReseau, pret:echo.pret}}]);
  const H = mondes.hote, V = [], verdict = (nom, ok, detail) => V.push({nom, ok:!!ok, detail});
  if(cle) RESULTATS[cle] = 'en cours';
  verdict('réglage galeries actif dans les deux mondes (?echo&galeries=1), barre de l’invité avec la galerie',
    galeriesEnLigne === true && galeriesActives() && dansMonde(H, () => galeriesActives())
    // (lot 2 : batterie et radar aussi, DEFENSE_EN_LIGNE retiré)
    && batimentsConstructibles(faction('I')).includes('terrier') && batimentsConstructibles(faction('I')).includes('parasol'),
    {galeriesEnLigne, liste:batimentsConstructibles(faction('I'))});
  echo.piloteExterne = true;
  window.enregistrerVictoire = () => {};
  const r2 = v => v == null ? v : Math.round(v*100)/100;
  const etatGal = g => g ? {stock:g.stock, fab:g.fab, fabS:Math.ceil(g.fabT - 1e-6), t0:g.t0, n:g.n, tires:g.tires} : null;
  // Monde de l'hôte : préparation.
  const prep = dansMonde(H, () => {
    camps.I.reserves = 6000; camps.J.reserves = Math.max(camps.J.reserves, 3000);
    const qI = ents.find(b => b.camp === 'I' && b.type === 'qg' && !b.mort), qJ = ents.find(b => b.camp === 'J' && b.type === 'qg' && !b.mort);
    let usine = ents.find(b => b.camp === 'I' && b.type === 'usine' && !b.mort && !b.enCours);
    if(!usine){ const p = trouverEmplacement('usine', {x:qI.x + 150, y:qI.y}); usine = creerBatiment('usine', 'I', p.c, p.r, true); }
    const pT = trouverEmplacement('terrier', {x:qI.x - 160, y:qI.y + 60});
    return {qI:{id:qI.id, x:qI.x, y:qI.y}, qJ:{id:qJ.id, x:qJ.x, y:qJ.y}, usine:usine.id, pT};
  });
  const histo = [];
  const G = {terrier:null, aiguille:null};   // identifiants (monde de l'hôte = mêmes chez l'invité)
  echo.apresPasHote = () => {
    const h = {T:temps, gal:{}, pvQG:{}};
    for(const e of ents) if(!e.mort && e.gal && !e.enCours) h.gal[e.id] = etatGal(e.gal);
    for(const e of ents) if(!e.mort && e.type === 'qg') h.pvQG[e.camp] = e.pv;
    histo.push(h); if(histo.length > 120) histo.shift();
  };
  const M = {ecarts:0, comparaisons:0, ecartsEx:[], galT:[], missiles:new Set(), marqueurs:new Set(), missilesParCamp:{}, erreurs:[], lignes:{},
    pvQGJ:[], pvEcart:0};
  echo.apresPasInvite = () => {
    // Effets recréés chez l'invité : chacun compté une fois (objets distincts).
    for(const f of effets){
      if(f.type === 'missile' && f.galerie && !M.missiles.has(f)){ M.missiles.add(f); M.missilesParCamp[f.camp] = (M.missilesParCamp[f.camp] || 0) + 1;
        if(!M.premierMissile) M.premierMissile = {camp:f.camp, galerie:f.galerie, x0:r2(f.x0), y0:r2(f.y0), duree:f.duree}; }
      if(f.type === 'marqueur' && f.pouvoir === 'galerie') M.marqueurs.add(f);
    }
    const t = G.terrier && invite.index.get(G.terrier);
    if(t && t.galT != null) M.galT.push(r2(t.galT));
    // Galeries de l'invité contre l'hôte au même instant (dernier instantané appliqué).
    const s0 = invite.courant; if(!s0) return;
    const h = histo.find(x => Math.abs(x.T - s0.T) < 0.0015); if(!h) return;
    for(const id in h.gal){
      const b = invite.index.get(+id); M.comparaisons++;
      const a = h.gal[id], g = b && etatGal(b.gal);
      const ok = g && a.stock === g.stock && a.fab === g.fab && a.fabS === g.fabS && a.n === g.n && a.tires === g.tires
        // t0 : deux arrondis au 1/50 s (heure de l'instantané et heure de t0), d'où 0,02 s au plus (mesuré : 0,02).
        && (a.t0 === null ? g.t0 === null : g.t0 !== null && Math.abs(a.t0 - g.t0) <= 0.0201);
      if(!ok){ M.ecarts++; if(M.ecartsEx.length < 5) M.ecartsEx.push({id, T:r2(s0.T), hote:a, invite:g}); }
    }
    const qJ = invite.index.get(prep.qJ.id);
    if(qJ && h.pvQG.J != null){ const d = Math.abs(qJ.pv - h.pvQG.J); if(d > M.pvEcart) M.pvEcart = d; }
  };
  let phase = 0, phaseT = performance.now(), pas = 0, tirT = null, recusAvant = 0, resAvant = 0;
  const debut = performance.now();
  const suite = () => { phase++; phaseT = performance.now(); };
  const delaiDepasse = s => performance.now() - phaseT > s*1000;
  const promesse = new Promise(fin => {
    let arret = null, fini = false;
    const terminer = raison => {
      if(fini) return; fini = true;
      if(arret) arret();
      echo.apresPasHote = echo.apresPasInvite = null; echo.piloteExterne = false;
      if(raison) verdict('déroulé complet (' + raison + ')', false, {phase});
      const g = M.galT;
      let monotone = true; for(let i = 1; i < g.length; i++) if(g[i] < g[i - 1] - 1e-9) monotone = false;
      verdict('invité : galT du terrier avance de 0 à 17,5 sans reculer, puis null (fermée)',
        g.length > 100 && g[0] <= 0.3 && Math.max(...g) >= 17.3 && Math.max(...g) <= 17.5 && monotone && invite.index.get(G.terrier) && invite.index.get(G.terrier).galT === null,
        {mesures:g.length, premier:g[0], max:g.length ? Math.max(...g) : null, monotone});
      verdict('invité : un missile de galerie par tir, recréé une fois (I : 1, J : 1), avec point de départ ; deux marqueurs « galerie »',
        M.missilesParCamp.I === 1 && M.missilesParCamp.J === 1 && M.marqueurs.size === 2 && M.premierMissile && M.premierMissile.x0 != null,
        {missiles:M.missilesParCamp, marqueurs:M.marqueurs.size, premier:M.premierMissile});
      verdict('aucun écart entre les galeries de l’invité et celles de l’hôte au même instant', M.comparaisons > 100 && M.ecarts === 0,
        {comparaisons:M.comparaisons, ecarts:M.ecarts, exemples:M.ecartsEx});
      const pvJ = M.pvQGJ;
      // (Comparaison au même instant de jeu seulement, M.pvEcart : relevés à la fin, l'hôte a de l'avance sur l'affichage
      // de l'invité, et un ouvrier de J peut réparer entre-temps ; vu le 20 novembre 2026, 12 PV d'écart ainsi.)
      verdict('invité : dégâts du missile visibles sur le QG de J, égaux à ceux de l’hôte au même instant (à 1/255 près)',
        pvJ.length === 2 && pvJ[1].invite < pvJ[0].invite - 50 && M.pvEcart <= pvJ[1].pvMax/255 + 1e-6,
        {pvJ, ecartMaxPendant:r2(M.pvEcart)});
      verdict('ordres de l’hôte : reçus et acceptés, aucun refus inattendu', hoteReseau.ordres.refuses === 0 && hoteReseau.ordres.acceptes >= 3, hoteReseau.ordres);
      verdict('aucune erreur pendant l’essai', !M.erreurs.length, M.erreurs);
      const res = {verdicts:V, reussis:V.filter(v => v.ok).length + ' / ' + V.length, dureeReelle:r2((performance.now() - debut)/1000), lignes:M.lignes};
      if(cle) RESULTATS[cle] = res;
      fin(res);
    };
    const etape = () => {
      if(phase === 0){
        // Ordre de construction de l'invité (camp local, monde affiché).
        recusAvant = hoteReseau.ordres.recus;
        const r = executerOrdre('I', {type:'construire', bat:'terrier', c:prep.pT.c, r:prep.pT.r});
        verdict('invité : ordre « construire terrier » envoyé', r.ok && r.envoye, r);
        suite();
      } else if(phase === 1){
        const ch = dansMonde(H, () => ents.find(b => b.camp === 'I' && b.type === 'terrier' && !b.mort));
        if(ch){
          G.terrier = ch.id;
          dansMonde(H, () => {
            ch.progres = 1; ch.enCours = false; ch.pv = ch.pvMax;   // chantier achevé d'un coup (essai)
            const pA = trouverEmplacement('aiguille', {x:prep.qJ.x + 170, y:prep.qJ.y + 60});
            const a = creerBatiment('aiguille', 'J', pA.c, pA.r, true); G.aiguille = a.id;
          });
          verdict('hôte : chantier du terrier ouvert par l’ordre de l’invité', true, {id:ch.id});
          suite();
        } else if(delaiDepasse(5)) terminer('chantier jamais ouvert');
      } else if(phase === 2){
        const b = invite.index.get(G.terrier);
        if(b && !b.enCours && b.gal){
          M.lignes.ferme = ligneEtatGalerie(b, true);
          verdict('invité : fiche du terrier terminé « Fermée — aucun missile (à fabriquer) », boutons possibles', M.lignes.ferme === 'Fermée — aucun missile (à fabriquer)'
            && empechementFabrication(b) === null && galerieFermee(b), {ligne:M.lignes.ferme, fab:empechementFabrication(b)});
          resAvant = dansMonde(H, () => camps.I.reserves);
          const r = executerOrdre('I', {type:'fabriquerMissile', id:G.terrier});
          verdict('invité : ordre « fabriquer un missile » envoyé', r.ok && r.envoye, r);
          suite();
        } else if(delaiDepasse(5)) terminer('terrier jamais vu terminé chez l’invité');
      } else if(phase === 3){
        const b = invite.index.get(G.terrier), gH = dansMonde(H, () => entiteParId(G.terrier).gal);
        if(b && b.gal.fab === 1 && gH.fab === 1){
          M.lignes.fabrication = ligneEtatGalerie(b, true);
          const paye = dansMonde(H, () => resAvant - camps.I.reserves);
          verdict('fabrication : hôte payé 220, invité « Fermée — Fabrication 60 s » (ou 59 s)', Math.abs(paye - 220) < 30 && /^Fermée — Fabrication (60|59) s$/.test(M.lignes.fabrication),
            {paye:r2(paye), ligne:M.lignes.fabrication});
          dansMonde(H, () => { gH.fabT = Math.min(gH.fabT, 0.6); });   // fabrication raccourcie (essai)
          suite();
        } else if(delaiDepasse(5)) terminer('fabrication jamais vue');
      } else if(phase === 4){
        const b = invite.index.get(G.terrier);
        if(b && b.gal.stock === 1 && b.gal.fab === 0){
          M.lignes.pret = ligneEtatGalerie(b, true);
          // Refus sur place (contrôle local, rien n'est envoyé), puis le vrai tir sur le QG de J.
          const recus = hoteReseau.ordres.recus, envoyes = echo.salonInvite.statistiques().ordres;
          const k = executerOrdre('I', {type:'tirGalerie', id:G.terrier, x:-5, y:100});
          const t = executerOrdre('I', {type:'tirGalerie', id:G.terrier, x:prep.qJ.x, y:prep.qJ.y});
          verdict('invité : tir hors carte refusé sur place (« Cible hors de la carte. », code coordonnees, non envoyé) ; vrai tir envoyé',
            !k.ok && k.motif === 'Cible hors de la carte.' && k.code === 'coordonnees' && k.genre === 'alerte' && t.ok && t.envoye && M.lignes.pret === 'Fermée — 1 missile prêt sur 2',
            {refus:k, tir:t, ligne:M.lignes.pret, envoyes});
          // Hôte (J, monde de l'hôte) : sa galerie chargée, tir ordonné sur le QG de I.
          const rJ = dansMonde(H, () => { const a = entiteParId(G.aiguille); a.gal.stock = 1; return executerOrdre('J', {type:'tirGalerie', id:a.id, x:prep.qI.x, y:prep.qI.y}); });
          verdict('hôte : tir de sa galerie accepté', rJ.ok, rJ);
          M.pvQGJ.push({invite:invite.index.get(prep.qJ.id).pv, hote:dansMonde(H, () => entiteParId(prep.qJ.id).pv), pvMax:invite.index.get(prep.qJ.id).pvMax});
          suite();
        } else if(delaiDepasse(5)) terminer('missile jamais prêt');
      } else if(phase === 5){
        const b = invite.index.get(G.terrier);
        if(b && b.galT != null && tirT === null){ tirT = performance.now(); M.lignes.ouverture = ligneEtatGalerie(b, true); }
        if(b && b.galT != null && b.galT > 11 && !M.lignes.impact) M.lignes.impact = ligneEtatGalerie(b, true);
        if(tirT !== null && b && b.galT === null && performance.now() - tirT > 15000){
          M.lignes.apres = ligneEtatGalerie(b, true);
          M.pvQGJ.push({invite:invite.index.get(prep.qJ.id).pv, hote:dansMonde(H, () => entiteParId(prep.qJ.id).pv), pvMax:invite.index.get(prep.qJ.id).pvMax});
          verdict('invité : fiche du terrier pendant et après le cycle', /\(vulnérable\)$/.test(M.lignes.ouverture || '') && /^Impact dans \d+ s \(vulnérable\)$/.test(M.lignes.impact || '')
            && M.lignes.apres === 'Fermée — aucun missile (à fabriquer)', {ouverture:M.lignes.ouverture, impact:M.lignes.impact, apres:M.lignes.apres});
          terminer();
        } else if(delaiDepasse(30)) terminer('cycle de tir jamais terminé chez l’invité');
      }
    };
    const tic = () => {
      if(fini) return;
      const du = Math.min(4, Math.floor((performance.now() - debut)/50) - pas);
      for(let k = 0; k < du && !fini; k++){ pasEcho(0.05); pas++; }
      if(!fini) etape();
    };
    arret = Reseau.minuteur(50, () => { try { tic(); } catch(e){ M.erreurs.push(e.message + ' | ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ')); terminer('erreur'); } });
  });
  return promesse;
}
window.testerGaleriesEnLigne = testerGaleriesEnLigne;

// ---------------------------------------------------------------------
//  Défense antimissile en ligne, lot 2 (20 novembre 2026, CAHIER-GALERIES-EN-LIGNE.md § 3 à 6 et 8)
//  Page : front-de-sel.html?echo&galeries=1&perte=0&verif (quatre camps : J et L Halden, K Karsk, ordinateurs ;
//  I Karsk, l'invité), attendre echo.pret, puis testerDefenseEnLigne('def') ; rapport dans RESULTATS.def (environ
//  70 s). Mené en temps réel (minuteur du Worker). L'invité donne tous ses ordres par executerOrdre → réseau simulé :
//  construire batterie, trois radars et terrier (ouvriers fournis), fabriquer trois munitions et un missile ;
//  il répond à la fenêtre par les fonctions de l'interface (majFenetreDefense, toucheDefense). Raccourcis dans le
//  monde de l'hôte, par les seules données du moteur : réserves, ouvriers, chantiers achevés, fabrications
//  raccourcies, galeries de J et K posées et chargées, leurs tirs ordonnés par executerOrdre chez l'hôte.
//    1. J et K tirent ensemble sur I : deux propositions, une réponse « Intercepter » (I) pour les deux.
//    2. I tire sur le QG de J (batterie de J posée chez l'hôte, J ordinateur : il répond seul).
//    3. J tire de nouveau : « Laisser passer » (L), puis une réponse forcée après le départ → refus « trop tard » dit.
//  Comparé à chaque instantané : para (stock, fab, fabT arrondi) et intT des batteries, invité contre hôte.
// ---------------------------------------------------------------------
function testerDefenseEnLigne(cle){
  if(modeReseau !== 'echo' || !echo.pret || !mondes || !camps.K) return Promise.resolve([{nom:'page ?echo&galeries=1&verif (quatre camps) prête', ok:false, detail:{modeReseau, pret:echo.pret}}]);
  const H = mondes.hote, V = [], verdict = (nom, ok, detail) => V.push({nom, ok:!!ok, detail});
  if(cle) RESULTATS[cle] = 'en cours';
  verdict('réglage actif : batterie et radar dans la barre de l’invité', galeriesActives() && batimentsConstructibles(faction('I')).includes('parasol')
    && batimentsConstructibles(faction('I')).includes('radar'), batimentsConstructibles(faction('I')));
  echo.piloteExterne = true;
  window.enregistrerVictoire = () => {};
  const r2 = v => v == null ? v : Math.round(v*100)/100;
  const etatPara = b => ({stock:b.para.stock, fab:b.para.fab, fabS:Math.ceil(b.para.fabT - 1e-6), intT:typeof b.intT === 'number' ? b.intT : null});
  const compteurs = r => r ? ['missiles', 'horsZone', 'sansMunition', 'tires', 'rencontres', 'abattus', 'parAllie'].map(k => r[k]).join(',') : null;
  // Monde de l'hôte : préparation.
  const prep = dansMonde(H, () => {
    camps.I.reserves = 9000; camps.J.reserves = Math.max(camps.J.reserves, 4000);
    const q = c => ents.find(b => b.camp === c && b.type === 'qg' && !b.mort);
    const qI = q('I'), qJ = q('J'), qK = q('K');
    if(!ents.some(b => b.camp === 'I' && b.type === 'usine' && !b.mort && !b.enCours)){ const p = trouverEmplacement('usine', {x:qI.x + 150, y:qI.y + 160}); creerBatiment('usine', 'I', p.c, p.r, true); }
    const sapeurs = []; for(let k = 0; k < 5; k++) sapeurs.push(creerUnite('sapeur', 'I', qI.x - 60 + k*24, qI.y + 110).id);
    const pos = {parasol:trouverEmplacement('parasol', {x:qI.x - 260, y:qI.y - 40}), r1:trouverEmplacement('radar', {x:qI.x - 120, y:qI.y - 240}),
      r2:trouverEmplacement('radar', {x:qI.x - 120, y:qI.y + 240}), r3:trouverEmplacement('radar', {x:qI.x - 400, y:qI.y + 200}),
      terrier:trouverEmplacement('terrier', {x:qI.x - 440, y:qI.y - 280})};
    // Galeries de J et K, batterie de J (ordinateur) avec deux munitions.
    const pA = trouverEmplacement('aiguille', {x:qJ.x + 170, y:qJ.y + 220}), a = creerBatiment('aiguille', 'J', pA.c, pA.r, true);
    const pB = trouverEmplacement('terrier', {x:qK.x, y:qK.y + 240}), k = creerBatiment('terrier', 'K', pB.c, pB.r, true);
    const pP = trouverEmplacement('parasol', {x:qJ.x + 200, y:qJ.y - 160}), pj = creerBatiment('parasol', 'J', pP.c, pP.r, true); pj.para.stock = 2;
    return {qI:{id:qI.id, x:qI.x, y:qI.y}, qJ:{id:qJ.id, x:qJ.x, y:qJ.y}, sapeurs, pos, aiguille:a.id, terrierK:k.id, parasolJ:pj.id};
  });
  const ids = {};   // parasol, r1, r2, r3, terrier (camp I), connus une fois les chantiers ouverts chez l'hôte
  const histo = [];
  echo.apresPasHote = () => {
    const h = {T:temps, para:{}};
    for(const e of ents) if(!e.mort && e.para && !e.enCours) h.para[e.id] = etatPara(e);
    histo.push(h); if(histo.length > 120) histo.shift();
  };
  const M = {comparaisons:0, ecarts:0, ecartsEx:[], erreurs:[], messages:[], intercepteurs:[], marqueursAbattus:0};
  const vus = new Set();
  echo.salonInvite.on('evenement', ev => { if(ev && ev.t === 'message' && ev.camp === 'I') M.messages.push(ev.texte); });
  echo.apresPasInvite = () => {
    for(const f of effets) if(f.type === 'intercepteur' && !vus.has(f)){ vus.add(f); M.intercepteurs.push({camp:f.camp, reussi:f.reussi, duree:r2(f.duree), h:r2(f.h)}); }
    const s0 = invite.courant; if(!s0) return;
    const h = histo.find(x => Math.abs(x.T - s0.T) < 0.0015); if(!h) return;
    for(const id in h.para){
      const b = invite.index.get(+id); M.comparaisons++;
      const a = h.para[id], g = b && b.para ? etatPara(b) : null;
      const ok = g && a.stock === g.stock && a.fab === g.fab && a.fabS === g.fabS
        && (a.intT === null || temps - a.intT > 5.1 ? true : g.intT !== null && Math.abs(a.intT - g.intT) <= 0.0201);
      if(!ok){ M.ecarts++; if(M.ecartsEx.length < 5) M.ecartsEx.push({id, T:r2(s0.T), hote:a, invite:g}); }
    }
  };
  const hoteE = () => dansMonde(H, () => camps.I.interception);
  let phase = 0, phaseT = performance.now(), pas = 0, info = {};
  const debut = performance.now();
  const suite = () => { phase++; phaseT = performance.now(); };
  const delaiDepasse = s => performance.now() - phaseT > s*1000;
  return new Promise(fin => {
    let arret = null, fini = false;
    const terminer = raison => {
      if(fini) return; fini = true;
      if(arret) arret();
      echo.apresPasHote = echo.apresPasInvite = null; echo.piloteExterne = false;
      if(raison) verdict('déroulé complet (' + raison + ')', false, {phase, info});
      verdict('para et intT des batteries : aucun écart entre l’invité et l’hôte au même instant', M.comparaisons > 100 && M.ecarts === 0,
        {comparaisons:M.comparaisons, ecarts:M.ecarts, exemples:M.ecartsEx});
      verdict('aucune erreur pendant l’essai', !M.erreurs.length, M.erreurs);
      const res = {verdicts:V, reussis:V.filter(v => v.ok).length + ' / ' + V.length, dureeReelle:r2((performance.now() - debut)/1000), info,
        messages:M.messages.slice(-12), intercepteurs:M.intercepteurs, ordres:hoteReseau.ordres};
      if(cle) RESULTATS[cle] = res;
      fin(res);
    };
    const sp = prep.sapeurs, P = prep.pos;
    const etape = () => {
      if(phase === 0){
        if(!sp.every(id => invite.index.has(id))){ if(delaiDepasse(5)) terminer('ouvriers jamais vus'); return; }
        const o = [['parasol', P.parasol, sp[0]], ['radar', P.r1, sp[1]], ['radar', P.r2, sp[2]], ['radar', P.r3, sp[3]], ['terrier', P.terrier, sp[4]]]
          .map(([bat, p, u]) => executerOrdre('I', {type:'construire', bat, c:p.c, r:p.r, ouvrierIds:[u]}));
        verdict('invité : cinq ordres « construire » envoyés (batterie, trois radars, terrier)', o.every(r => r.ok && r.envoye), o);
        suite();
      } else if(phase === 1){
        const l = dansMonde(H, () => ents.filter(b => b.camp === 'I' && !b.mort && b.enCours && ['parasol', 'radar', 'terrier'].includes(b.type)));
        if(l.length === 5){
          dansMonde(H, () => { for(const b of l){ b.progres = 1; b.enCours = false; b.pv = b.pvMax; } });
          for(const b of l){ if(b.type === 'radar') (ids.radars = ids.radars || []).push(b.id); else ids[b.type] = b.id; }
          verdict('hôte : cinq chantiers ouverts par les ordres de l’invité (limite de trois radars respectée)', true, ids);
          suite();
        } else if(delaiDepasse(6)) terminer('chantiers jamais tous ouverts (' + l.length + ')');
      } else if(phase === 2){
        const b = invite.index.get(ids.parasol);
        if(b && !b.enCours && b.para && ids.radars.every(id => invite.index.get(id) && !invite.index.get(id).enCours)){
          info.ficheAvant = ligneEtatDefense(b, true);
          const o = [1, 2, 3].map(() => executerOrdre('I', {type:'fabriquerMunition', id:ids.parasol}));
          const m = executerOrdre('I', {type:'fabriquerMissile', id:ids.terrier});
          verdict('invité : fiche de la batterie « Munitions : 0 / 4 » et « Chances : 75 % — 3 radars sur 3 » ; trois munitions et un missile commandés',
            info.ficheAvant.etat === 'Munitions : 0 / 4' && info.ficheAvant.chances === 'Chances : 75 % — 3 radars sur 3' && o.every(r => r.ok) && m.ok, {fiche:info.ficheAvant, o, m});
          suite();
        } else if(delaiDepasse(6)) terminer('batterie et radars jamais vus terminés chez l’invité');
      } else if(phase === 3){
        const pH = dansMonde(H, () => entiteParId(ids.parasol).para), gH = dansMonde(H, () => entiteParId(ids.terrier).gal);
        const b = invite.index.get(ids.parasol);
        if(pH.fab === 3 && gH.fab === 1 && b.para.fab === 3){
          info.ficheFab = ligneEtatDefense(b, true).etat;
          verdict('invité : fabrication vue « Munitions : 0 / 4 · fabrication 30 s (+2 en attente) » (ou 29 s)', /^Munitions : 0 \/ 4 · fabrication (30|29) s \(\+2 en attente\)$/.test(info.ficheFab), info.ficheFab);
          dansMonde(H, () => { pH.fabT = Math.min(pH.fabT, 0.4); gH.fabT = Math.min(gH.fabT, 0.4); });
          suite();
        } else if(delaiDepasse(6)) terminer('fabrication jamais vue');
      } else if(phase === 4){
        // Accélère les munitions suivantes chez l'hôte, jusqu'à trois prêtes.
        const pH = dansMonde(H, () => entiteParId(ids.parasol).para);
        if(pH.fab > 0 && pH.fabT > 0.4) dansMonde(H, () => { pH.fabT = 0.4; });
        const b = invite.index.get(ids.parasol), t = invite.index.get(ids.terrier);
        if(b.para.stock === 3 && t.gal.stock === 1){
          // 1. J et K tirent ensemble sur le QG de I.
          const rr = dansMonde(H, () => { entiteParId(prep.aiguille).gal.stock = 1; entiteParId(prep.terrierK).gal.stock = 2;
            return [executerOrdre('J', {type:'tirGalerie', id:prep.aiguille, x:prep.qI.x, y:prep.qI.y}), executerOrdre('K', {type:'tirGalerie', id:prep.terrierK, x:prep.qI.x, y:prep.qI.y + 20})]; });
          verdict('hôte : J et K ouvrent leur galerie sur le QG de I', rr.every(r => r.ok), rr);
          suite();
        } else if(delaiDepasse(8)) terminer('munitions ou missile jamais prêts');
      } else if(phase === 5){
        const p = propositionEnCours('I', FENETRE_DEFENSE.fermees);
        if(p && p.ouvertes === 2){
          majFenetreDefense();
          info.proposition = {ouvertes:p.ouvertes, departDans:r2(p.departDans), chances:Math.round(p.chances), munitions:p.munitions, affiche:FENETRE_DEFENSE.affiche,
            titre:(el('defense') && el('defense').querySelector('.titre') || {}).textContent};
          const pris = toucheDefense('i');
          const loc = propositionEnCours('I', FENETRE_DEFENSE.fermees);
          verdict('invité : deux propositions (J et K), fenêtre « 2 galeries ennemies en ouverture », décompte raccourci (< 9,5 − 0,35), « Intercepter » noté tout de suite',
            info.proposition.affiche === 'proposition' && /^2 galeries ennemies/.test(info.proposition.titre || '') && p.departDans <= 9.5 - 0.35 + 1e-6 && p.departDans > 7
              && pris && loc && loc.armees === 2, Object.assign({armeesApres:loc && loc.armees}, info.proposition));
          suite();
        } else if(delaiDepasse(6)) terminer('propositions jamais reçues par l’invité');
      } else if(phase === 6){
        const E = hoteE(), P2 = E && Object.values(E.propositions).filter(q => galerieDeProposition(q));
        if(P2 && P2.length === 2 && P2.every(q => q.reponse === true)){ info.hoteOui = r2(dansMonde(H, () => temps)); suite(); }
        else if(delaiDepasse(4)) terminer('réponses jamais notées chez l’hôte');
      } else if(phase === 7){
        // Attendre la fin des trois missiles (J : 1, K : 2) et des rencontres, puis comparer les résultats.
        const E = hoteE(), R = E ? Object.values(E.resultats) : [];
        const fini3 = R.length === 2 && R.every(r => r.missiles === r.n && r.tires === r.rencontres) && dansMonde(H, () => temps) > info.hoteOui + 12;
        if(fini3 && !info.fini3) info.fini3 = performance.now();
        const Ei = camps.I.interception, ok = fini3 && R.every(r => Ei && Ei.resultats[r.cle] && compteurs(Ei.resultats[r.cle]) === compteurs(r));
        // L'invité voit tout avec son retard d'affichage (0,15 s) plus le trajet : jusqu'à 3 s pour rejoindre l'hôte.
        if(fini3 && (ok || performance.now() - info.fini3 > 3000)){
          info.rattrapageMs = Math.round(performance.now() - info.fini3);
          const mun = invite.index.get(ids.parasol).para.stock, munH = dansMonde(H, () => entiteParId(ids.parasol).para.stock);
          const tiresTot = R.reduce((s, r) => s + r.tires, 0), abattus = R.reduce((s, r) => s + r.abattus + r.parAllie, 0);
          const interI = M.intercepteurs.filter(x => x.camp === 'I');
          const marqVivants = effets.filter(f => f.type === 'marqueur' && f.pouvoir === 'galerie' && f.vie > 0).length;
          info.salve1 = {hote:R.map(r => ({cle:r.cle, c:compteurs(r)})), invite:R.map(r => Ei && Ei.resultats[r.cle] ? compteurs(Ei.resultats[r.cle]) : null),
            munInvite:mun, munHote:munH, tiresTot, abattus, intercepteursI:interI, marqVivants};
          verdict('salve 1 : résultats de l’invité identiques à ceux de l’hôte (compteurs), munitions consommées une par tir (3 − tirs), un intercepteur recréé par tir, issue réussie/manquée identique',
            ok && mun === munH && mun === 3 - tiresTot && interI.length === tiresTot && interI.filter(x => x.reussi).length === R.reduce((s, r) => s + r.abattus, 0), info.salve1);
          // Juste après la dernière rencontre, avant les impacts (17,45 s et plus) : seuls les marqueurs des missiles
          // non abattus restent au sol chez l'invité.
          verdict('salve 1 : chez l’invité, le marqueur de chaque missile abattu est effacé, les autres restent', marqVivants === 3 - abattus,
            {marqVivants, abattus, rattrapageMs:info.rattrapageMs});
          suite();
        } else if(delaiDepasse(30)) terminer('salve 1 jamais terminée');
      } else if(phase === 8){
        // 2. I tire sur le QG de J (zone de la batterie de J).
        const t = invite.index.get(ids.terrier);
        if(t && t.gal.t0 === null && t.gal.stock === 1){
          info.avant2 = {munJ:dansMonde(H, () => entiteParId(prep.parasolJ).para.stock)};
          const r = executerOrdre('I', {type:'tirGalerie', id:ids.terrier, x:prep.qJ.x + 150, y:prep.qJ.y - 120});
          verdict('invité : tir du terrier sur la base de J envoyé', r.ok && r.envoye, r);
          suite();
        } else if(delaiDepasse(10)) terminer('terrier de I jamais prêt');
      } else if(phase === 9){
        const E = dansMonde(H, () => camps.J.interception), R = E ? Object.values(E.resultats).filter(r => r.tireur === 'I') : [];
        if(R.length === 1 && R[0].missiles === 1 && R[0].tires === R[0].rencontres && performance.now() - phaseT > 18000){
          const r = R[0], interJ = M.intercepteurs.filter(x => x.camp === 'J');
          const munJ = dansMonde(H, () => entiteParId(prep.parasolJ).para.stock);
          info.salve2 = {resultatHoteJ:compteurs(r), munJ, avant:info.avant2.munJ, intercepteursJ:interJ, messagesI:M.messages.filter(m => /intercept/i.test(m))};
          verdict('salve 2 : J (ordinateur) intercepte le missile de I ; l’invité voit un intercepteur de J ; munition de J consommée ; message dit à l’invité si abattu',
            r.tires === 1 && interJ.length === 1 && munJ === info.avant2.munJ - 1 && (r.abattus === 1 ? info.salve2.messagesI.includes('Missile intercepté !') : true), info.salve2);
          suite();
        } else if(delaiDepasse(30)) terminer('salve 2 jamais terminée');
      } else if(phase === 10){
        // 3. J tire de nouveau sur I : « Laisser passer », puis réponse forcée après le départ.
        const a = dansMonde(H, () => entiteParId(prep.aiguille));
        if(a && a.gal.t0 === null){
          info.munAvant3 = invite.index.get(ids.parasol).para.stock;
          const r = dansMonde(H, () => { a.gal.stock = 1; return executerOrdre('J', {type:'tirGalerie', id:a.id, x:prep.qI.x - 30, y:prep.qI.y}); });
          verdict('hôte : J tire une seconde fois sur I', r.ok, r);
          suite();
        } else if(delaiDepasse(20)) terminer('galerie de J jamais refermée');
      } else if(phase === 11){
        const p = propositionEnCours('I', FENETRE_DEFENSE.fermees);
        if(p){
          majFenetreDefense();
          info.cle3 = p.cle;
          const pris = toucheDefense('l');
          verdict('invité : « Laisser passer » ferme la fenêtre', pris && FENETRE_DEFENSE.fermees[p.cle] === true && propositionEnCours('I', FENETRE_DEFENSE.fermees) === null
            && FENETRE_DEFENSE.affiche !== 'proposition', {cle:p.cle, affiche:FENETRE_DEFENSE.affiche});
          suite();
        } else if(delaiDepasse(6)) terminer('troisième proposition jamais reçue');
      } else if(phase === 12){
        const a = dansMonde(H, () => entiteParId(prep.aiguille)), E = hoteE(), p = E && E.propositions[info.cle3];
        if(p && p.reponse === false && a.gal.tires >= 1){
          // Après le départ : réponse envoyée telle quelle sur le réseau (sans le contrôle local), comme un ordre en retard.
          info.messagesAvant = M.messages.length;
          echo.salonInvite.envoyerOrdre({o:'repInter', oui:true, cle:info.cle3});
          suite();
        } else if(delaiDepasse(15)) terminer('départ du troisième missile jamais vu');
      } else if(phase === 13){
        const dit = M.messages.slice(info.messagesAvant).includes('Réponse arrivée trop tard : le missile était déjà parti.');
        if(dit || delaiDepasse(4)){
          const munH = dansMonde(H, () => entiteParId(ids.parasol).para.stock);
          verdict('réponse arrivée après le départ : refusée par l’hôte, « Réponse arrivée trop tard… » dit à l’invité ; « Laisser passer » : aucune munition dépensée',
            dit && munH === info.munAvant3 && hoteReseau.ordres.motifs.etat >= 1, {dit, munH, munAvant:info.munAvant3, motifs:hoteReseau.ordres.motifs});
          terminer();
        }
      }
    };
    const tic = () => {
      if(fini) return;
      const du = Math.min(4, Math.floor((performance.now() - debut)/50) - pas);
      for(let k = 0; k < du && !fini; k++){ pasEcho(0.05); pas++; }
      if(!fini) etape();
    };
    arret = Reseau.minuteur(50, () => { try { tic(); } catch(e){ M.erreurs.push(e.message + ' | ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ')); terminer('erreur'); } });
  });
}
window.testerDefenseEnLigne = testerDefenseEnLigne;

// ---------------------------------------------------------------------
//  Galeries de tir (novembre 2026) : essais automatiques des règles du cahier des charges
//  (travaux/galerie/CAHIER-DES-CHARGES.md), pour les deux camps, par simulation sans rendu et sans attendre le
//  temps réel. À lancer depuis front-de-sel.html?verif (escarmouche, pas de mission) :
//    avecGraine(7, () => testerGaleries())               → règles (construction … ordres refusés en ligne)
//    avecGraine(7, () => testerGaleries('ordinateur', 0))   → partie d'ordinateurs n° 0, 1 ou 2 avec galeries
//                                                              (sans numéro : les trois, plus long)
//    testerGaleries('parties', 0)   → lot 2 (19 novembre 2026) : partie n° 0, 1 ou 2 de 900 s où l'ordinateur
//                                     gère seul sa galerie (graine fixée par partie ; sans numéro : les trois,
//                                     environ 15 s de calcul ; par tache('p', () => testerGaleries('parties')))
//  Renvoie une liste de verdicts {nom, ok, detail}. L'option « Galeries de tir » est cochée pendant l'essai puis
//  remise dans son état d'avant ; chaque scène repart d'une partie neuve (reinitialiserPartie). Rien n'est
//  changé aux outils existants : cette fonction n'est appelée par aucun d'eux.
// ---------------------------------------------------------------------
function testerGaleries(quoi, numero){
  if(MISSION) return [{nom:'page', ok:false, detail:'testerGaleries se lance depuis la page d’escarmouche (?verif), pas depuis une mission'}];
  window.enregistrerVictoire = () => {};
  const verdicts = [];
  const V = (nom, ok, detail) => { verdicts.push({nom, ok:!!ok, detail:typeof detail === 'string' ? detail : JSON.stringify(detail)}); };
  const DT = 0.05, EPS = 0.11;   // EPS : un pas de simulation et un peu plus (dates relevées au pas près)
  const pas = s => { for(let k = 0; k < Math.round(s/DT); k++) miseAJour(DT); };
  // Avance jusqu'à ce que cond() soit vraie (au plus max s) ; renvoie le temps écoulé, ou null.
  const jusqua = (cond, max) => { const t0 = temps; while(temps - t0 < max){ miseAJour(DT); if(cond()) return temps - t0; } return null; };
  const r1 = v => Math.round(v*10)/10, r2 = v => Math.round(v*100)/100;
  const qg = id => ents.find(e => e.camp === id && e.type === 'qg' && !e.mort);
  const typeGal = id => faction(id).galerie;
  // Scène : partie neuve à trois camps (J Halden et K Halden alliés, équipe A ; I Karsk, équipe B), ordinateurs
  // arrêtés, seuls les QG restent (tableRase), réserves larges (au-dessus de 400 : pas de revenu de secours).
  const scene = () => {
    reinitialiserPartie();
    demarrer('halden', configTest('halden', '2c1'));
    tableRase();
    for(const id of campsEnJeu()){ camps[id].reserves = 20000; camps[id].points = 0; camps[id].recharges = {}; }
  };
  const poserGalerie = id => { const t = typeGal(id), p = trouverEmplacement(t, qg(id)); return p ? creerBatiment(t, id, p.c, p.r, true) : null; };
  const unite = (type, id, x, y) => { const p = pointLibre(x, y); return creerUnite(type, id, p.x, p.y); };
  // Point dégagé à d px d'un QG, vers le centre de la carte (loin de tout bâtiment).
  const versCentre = (id, d) => { const q = qg(id), a = Math.atan2(HAUT/2 - q.y, LARG/2 - q.x); return pointLibre(q.x + Math.cos(a)*d, q.y + Math.sin(a)*d); };
  // Espions (remis en place à la fin) : effets créés, explosions de zone, dégâts réellement subis par cible.
  const orig = {effet:window.effet, explosionZone:window.explosionZone, infliger:window.infliger, notifier:window.notifier};
  let journal = null;   // {effets:[], zones:[], degats:Map(id → [{t, deg, auteur}])}
  const ecouter = () => { journal = {effets:[], zones:[], degats:new Map()}; };
  window.effet = function(type, p){ if(journal) journal.effets.push({type, t:temps, p}); return orig.effet.apply(this, arguments); };
  window.explosionZone = function(x, y, r, deg, arme, auteur){ if(journal) journal.zones.push({t:temps, x, y, r, deg, arme, auteur}); return orig.explosionZone.apply(this, arguments); };
  window.infliger = function(c, deg, auteur){
    const p0 = c ? c.pv : 0, res = orig.infliger.apply(this, arguments);
    if(journal && c && p0 - c.pv > 0){ const l = journal.degats.get(c.id) || []; l.push({t:temps, deg:p0 - c.pv, auteur}); journal.degats.set(c.id, l); }
    return res;
  };
  const subi = (e, filtre) => (journal.degats.get(e.id) || []).filter(d => !filtre || filtre(d)).reduce((s, d) => s + d.deg, 0);
  const parGalerie = d => d.auteur && d.auteur.galerie;
  const optAvant = optionGaleries, reseauAvant = modeReseau, roleAvant = roleMonde;
  try {
    optionGaleries = true;
    if(quoi === 'ordinateur') essaisOrdinateur();
    else if(quoi === 'parties') essaisParties();
    else essaisRegles();
  } catch(err){
    V('exécution de l’essai', false, 'ERREUR t=' + (typeof temps === 'number' ? temps.toFixed(2) : '?') + ' ' + err.message + ' | ' + String(err.stack || '').split('\n').slice(1, 3).join(' | '));
  } finally {
    Object.assign(window, orig);
    optionGaleries = optAvant; modeReseau = reseauAvant; roleMonde = roleAvant;
  }
  return verdicts;

  // ----------------------------------------------------------------- règles
  function essaisRegles(){
    // 1. Construction (une seule par camp, prérequis, option décochée → refus) : J (Halden) et I (Karsk).
    scene();
    for(const id of ['J', 'I']){
      const t = typeGal(id), D = BATIMENTS[t], q = qg(id);
      const o = unite(faction(id).ouvrier, id, q.x, q.y + 110), p = trouverEmplacement(t, q);
      const ordre = () => ({type:'construire', bat:t, c:p.c, r:p.r, ouvrierIds:[o.id]});
      optionGaleries = false;
      const rOff = executerOrdre(id, ordre());
      const absente = !batimentsConstructibles(faction(id)).includes(t);
      optionGaleries = true;
      V('construction ' + id + ' : option décochée → refus', !rOff.ok && absente && !ents.some(e => e.camp === id && estGalerie(e)),
        {motif:rOff.motif, absenteDeLaListe:absente});
      const rSans = executerOrdre(id, ordre());
      V('construction ' + id + ' : sans usine → refus', !rSans.ok && /Nécessite/.test(rSans.motif || ''), {motif:rSans.motif});
      const pu = trouverEmplacement('usine', {x:q.x, y:q.y - 200}); creerBatiment('usine', id, pu.c, pu.r, true);
      const p2 = trouverEmplacement(t, q);   // l'usine a pu prendre la place
      p.c = p2.c; p.r = p2.r;
      const autre = id === 'J' ? 'terrier' : 'aiguille';
      const rAutre = executerOrdre(id, {type:'construire', bat:autre, c:p.c, r:p.r, ouvrierIds:[o.id]});
      V('construction ' + id + ' : galerie de l’autre faction (' + autre + ') → refus', !rAutre.ok, {motif:rAutre.motif});
      const r0 = camps[id].reserves, rOk = executerOrdre(id, ordre()), g = rOk.ok ? entiteParId(rOk.id) : null;
      V('construction ' + id + ' : avec usine → acceptée, prix payé', rOk.ok && g && g.enCours && r0 - camps[id].reserves === D.cout,
        {ok:rOk.ok, motif:rOk.motif, paye:r0 - camps[id].reserves, prix:D.cout});
      const p3 = trouverEmplacement(t, {x:q.x, y:q.y + 300});
      const rDeux = executerOrdre(id, {type:'construire', bat:t, c:p3.c, r:p3.r, ouvrierIds:[o.id]});
      V('construction ' + id + ' : seconde galerie pendant le chantier → refus', !rDeux.ok && rDeux.motif === MOTIF_UNE_GALERIE, {motif:rDeux.motif});
      if(g){
        const duree = jusqua(() => !g.enCours, 200);
        const rTrois = executerOrdre(id, {type:'construire', bat:t, c:p3.c, r:p3.r, ouvrierIds:[o.id]});
        V('construction ' + id + ' : chantier terminé, seconde galerie toujours refusée', duree !== null && !rTrois.ok && rTrois.motif === MOTIF_UNE_GALERIE
          && Math.abs(g.pv - D.pv) < 0.5 && g.gal && g.gal.t0 === null && g.galT === null && g.galN === 0,
          {dureeChantier:duree === null ? 'non fini' : r1(duree), pv:g.pv, motif:rTrois.motif});
      }
    }

    // 2. Fabrication (prix, durée, plafond, pas pendant un cycle) ; option décochée → refus.
    scene();
    for(const id of ['J', 'I']){
      const g = poserGalerie(id), G = g.def.galerie;
      optionGaleries = false;
      const r0 = camps[id].reserves, rOff = executerOrdre(id, {type:'fabriquerMissile', id:g.id}), rOffTir = executerOrdre(id, {type:'tirGalerie', id:g.id, x:1600, y:1100});
      optionGaleries = true;
      V('fabrication ' + id + ' : option décochée → refus (fabriquer et tirer)', !rOff.ok && !rOffTir.ok && rOff.motif === MOTIF_SANS_GALERIES
        && rOffTir.motif === MOTIF_SANS_GALERIES && camps[id].reserves === r0 && g.gal.fab === 0, {motifs:[rOff.motif, rOffTir.motif]});
      const ra = camps[id].reserves, rA = executerOrdre(id, {type:'fabriquerMissile', id:g.id});
      V('fabrication ' + id + ' : prix payé à l’ordre', rA.ok && ra - camps[id].reserves === G.coutMissile && g.gal.fab === 1 && g.gal.fabT === G.tempsMissile,
        {paye:ra - camps[id].reserves, prix:G.coutMissile, fab:g.gal.fab, fabT:g.gal.fabT});
      const rB = executerOrdre(id, {type:'fabriquerMissile', id:g.id}), rC = executerOrdre(id, {type:'fabriquerMissile', id:g.id});
      const plafond = G.lanceurs === 1 ? !rB.ok : (rB.ok && !rC.ok);
      V('fabrication ' + id + ' : plafond stock + commandes ≤ ' + G.lanceurs, plafond && g.gal.fab === G.lanceurs, {fab:g.gal.fab, refus:(G.lanceurs === 1 ? rB : rC).motif});
      g._prets = [];
    }
    // Durées : un missile toutes les tempsMissile s (un à la fois).
    const gJ = ents.find(e => e.camp === 'J' && estGalerie(e)), gI = ents.find(e => e.camp === 'I' && estGalerie(e));
    const t0 = temps;
    for(let k = 0; k < Math.round(125/DT); k++){
      miseAJour(DT);
      for(const g of [gJ, gI]) while(g._prets.length < g.gal.stock) g._prets.push(r1(temps - t0));
    }
    V('fabrication J : durée 120 s', gJ._prets.length === 1 && Math.abs(gJ._prets[0] - 120) <= EPS, {prets:gJ._prets, stock:gJ.gal.stock});
    V('fabrication I : 60 s pièce, un à la fois', gI._prets.length === 2 && Math.abs(gI._prets[0] - 60) <= EPS && Math.abs(gI._prets[1] - 120) <= EPS,
      {prets:gI._prets, stock:gI.gal.stock});
    // Réserves insuffisantes → refus, rien de prélevé.
    {
      const rs = camps.I.reserves; gI.gal.stock = 0; camps.I.reserves = 100;
      const r = executerOrdre('I', {type:'fabriquerMissile', id:gI.id});
      V('fabrication I : réserves insuffisantes → refus', !r.ok && r.code === 'reserves' && camps.I.reserves === 100 && gI.gal.fab === 0, {motif:r.motif, code:r.code});
      camps.I.reserves = rs; gI.gal.stock = 2;
    }
    // Pas pendant un cycle : J tire, commande un missile pendant le cycle (accepté), la fabrication attend la fermeture.
    {
      const cible = qg('I'), r = executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:cible.x, y:cible.y});
      const rc = executerOrdre('J', {type:'fabriquerMissile', id:gJ.id});
      const f0 = gJ.gal.fabT;
      pas(10); const f10 = gJ.gal.fabT;
      pas(10); const f20 = gJ.gal.fabT;
      V('fabrication J : commande acceptée pendant un cycle, mais à l’arrêt jusqu’à la fermeture', r.ok && rc.ok && f0 === 120 && f10 === 120 && f20 < 120 && f20 > 110,
        {tir:r.ok, commande:rc.ok, fabT:[f0, r2(f10), r2(f20)]});
    }

    // 3. Cycle complet, deux camps en même temps ; dégâts au QG ; auteur et arme de l'impact.
    scene();
    {
      const gJ = poserGalerie('J'), gI = poserGalerie('I'), qJ = qg('J'), qI = qg('I');
      gJ.gal.stock = 1; gI.gal.stock = 2;
      const pvJ = qJ.pv, pvI = qI.pv;
      ecouter();
      const rJ = executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:qI.x, y:qI.y});
      const rI = executerOrdre('I', {type:'tirGalerie', id:gI.id, x:qJ.x, y:qJ.y});
      const t0 = temps;
      const alerteI = alertes.I && alertes.I.x === gJ.x && alertes.I.y === gJ.y, alerteJ = alertes.J && alertes.J.x === gI.x && alertes.J.y === gI.y;
      const debut = {J:[gJ.galT, gJ.galN, gJ.gal.stock], I:[gI.galT, gI.galN, gI.gal.stock]};
      const fermeture = {J:null, I:null}, suiviOk = {J:true, I:true}, ecarts = [];
      for(let k = 0; k < Math.round(20/DT); k++){
        miseAJour(DT);
        for(const [id, g] of [['J', gJ], ['I', gI]]){
          if(fermeture[id] !== null) continue;
          if(g.gal.t0 === null){ fermeture[id] = r2(temps - t0); if(g.galT !== null || g.galN !== 0) suiviOk[id] = false; continue; }
          if(Math.abs(g.galT - (temps - t0)) > 1e-6 || g.galN !== g.gal.n || galerieFermee(g)){ suiviOk[id] = false; ecarts.push([id, r2(temps - t0), g.galT, g.galN]); }
        }
      }
      const departs = id => journal.effets.filter(e => e.type === 'missile' && e.p.galerie && e.p.camp === id).map(e => r2(e.t - t0));
      const marqueurs = id => journal.effets.filter(e => e.type === 'marqueur' && e.p.pouvoir === 'galerie' && e.p.camp === id);
      const impacts = id => journal.zones.filter(z => z.arme === 'missileGalerie' && z.auteur && z.auteur.camp === id);
      const iJ = impacts('J'), iI = impacts('I');
      const pret = (l, attendu) => l.length === attendu.length && l.every((v, i) => Math.abs(v - attendu[i]) <= EPS);
      V('cycle : ordres de tir acceptés, stock engagé en entier, galerie ouverte dès t = 0', rJ.ok && rI.ok && debut.J[0] === 0 && debut.J[1] === 1 && debut.J[2] === 0
        && debut.I[0] === 0 && debut.I[1] === 2 && debut.I[2] === 0, debut);
      V('cycle : alerte Espace posée chez l’adversaire sur la galerie qui s’ouvre', alerteI && alerteJ, {alerteI:alertes.I, alerteJ:alertes.J});
      // (Cycle allongé de 1,5 s le 19 novembre 2026 : départs à 9,5 et 10,1 s, fermeture à 17,5 s ; avant 8, 8,6 et 16.)
      V('cycle J : départ à 9,5 s, impact à 14,5 s', pret(departs('J'), [9.5]) && pret(iJ.map(z => r2(z.t - t0)), [14.5]), {departs:departs('J'), impacts:iJ.map(z => r2(z.t - t0))});
      V('cycle I : départs à 9,5 et 10,1 s, impacts à 14,5 et 15,1 s', pret(departs('I'), [9.5, 10.1]) && pret(iI.map(z => r2(z.t - t0)), [14.5, 15.1]),
        {departs:departs('I'), impacts:iI.map(z => r2(z.t - t0))});
      const effOk = id => journal.effets.filter(e => e.type === 'missile' && e.p.galerie && e.p.camp === id).every(e => e.p.duree === 5 && e.p.x0 === (id === 'J' ? gJ : gI).x && e.p.y0 === (id === 'J' ? gJ : gI).y)
        && marqueurs(id).length === departs(id).length && marqueurs(id).every(m => m.p.duree === 5 && m.p.r === (id === 'J' ? gJ : gI).def.galerie.rayon);
      V('cycle : effets « missile » (vol de 5 s depuis la galerie) et « marqueur » pouvoir:galerie', effOk('J') && effOk('I'),
        {marqueursJ:marqueurs('J').length, marqueursI:marqueurs('I').length});
      V('cycle : impact = explosionZone missileGalerie, auteur {camp, est:galerie, galerie:true}, bord 0,5',
        iJ.concat(iI).every(z => z.auteur.est === 'galerie' && z.auteur.galerie === true) && iJ.every(z => z.r === 70 && z.deg === BATIMENTS.aiguille.galerie.degats) && iI.every(z => z.r === 95 && z.deg === BATIMENTS.terrier.galerie.degats),
        iJ.concat(iI).map(z => [z.auteur.camp, z.r, z.deg]));
      V('cycle : fermeture à 17,5 s, b.galT suit le temps du cycle puis null, b.galN = n puis 0', Math.abs(fermeture.J - 17.5) <= EPS && Math.abs(fermeture.I - 17.5) <= EPS && suiviOk.J && suiviOk.I
        && gJ.galT === null && gI.galT === null && gJ.galN === 0 && gI.galN === 0 && galerieFermee(gJ) && galerieFermee(gI),
        {fermeture, suiviOk, ecarts:ecarts.slice(0, 4)});
      const dI = pvI - qI.pv, dJ = pvJ - qJ.pv;
      // (Dégâts lus dans la table depuis le 20 novembre 2026 : 1 200 pour l'Aiguille, 600 par Brisant ; avant, 600 et 330.)
      V('dégâts : QG au centre, Aiguille à pleins dégâts, salve du Terrier entre 90 et 100 % de deux missiles (dispersion)', Math.abs(dI - BATIMENTS.aiguille.galerie.degats) < 0.01 && dJ >= 1.8*BATIMENTS.terrier.galerie.degats && dJ <= 2*BATIMENTS.terrier.galerie.degats + 0.01,
        {qgI:r1(dI), qgJ:r1(dJ), pointsImpactI:iI.map(z => [Math.round(z.x - qJ.x), Math.round(z.y - qJ.y)])});
      V('dispersion : Aiguille au point visé, Terrier à 45 px au plus', iJ.every(z => z.x === qI.x && z.y === qI.y) && iI.every(z => Math.hypot(z.x - qJ.x, z.y - qJ.y) <= 45.001),
        iI.map(z => r1(Math.hypot(z.x - qJ.x, z.y - qJ.y))));
    }

    // 4. Dégâts : collecteur de 520 PV au centre d'une salve du Terrier (survit) ; son camp et ses alliés épargnés.
    scene();
    {
      const gJ = poserGalerie('J'), gI = poserGalerie('I');
      gJ.gal.stock = 1; gI.gal.stock = 2;
      const P1 = versCentre('J', 520), P2 = versCentre('I', 520);
      const col = unite('collecteur', 'J', P1.x, P1.y); col.gare = true;
      // Voisins à 30 px (au-delà des rayons cumulés : la séparation ne les pousse pas), bien dans la zone.
      const propreI = unite('sapeur', 'I', P1.x + 30, P1.y);
      const ennemi = unite('collecteur', 'I', P2.x, P2.y); ennemi.gare = true;
      const propreJ = unite('technicien', 'J', P2.x + 30, P2.y), allieK = unite('technicien', 'K', P2.x - 30, P2.y);
      ecouter();
      executerOrdre('I', {type:'tirGalerie', id:gI.id, x:col.x, y:col.y});
      executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:ennemi.x, y:ennemi.y});
      pas(17);
      const dCol = subi(col, parGalerie);
      // (Depuis le 20 novembre 2026, à 600 par missile, une salve qui touche deux fois détruit un collecteur de 520 PV :
      // le propriétaire a demandé ces dégâts « sans rien adapter ». L'essai ne vérifie plus que les demi-dégâts.)
      V('dégâts : collecteur touché par la salve du Terrier, demi-dégâts au plus (léger 0,5)', dCol > 0 && dCol <= BATIMENTS.terrier.galerie.degats + 0.01,
        {degats:r1(dCol), pv:r1(col.pv), touches:(journal.degats.get(col.id) || []).filter(parGalerie).length});
      V('dégâts : unité du camp tireur épargnée (I sous sa propre salve)', subi(propreI) === 0 && !propreI.mort, {pv:propreI.pv});
      V('dégâts : Aiguille sur un collecteur adverse (léger 0,5 : demi-dégâts au plus), son camp (J) et son allié (K) épargnés',
        subi(ennemi, parGalerie) > 0 && subi(ennemi, parGalerie) <= BATIMENTS.aiguille.galerie.degats*0.5 + 0.01 && subi(propreJ) === 0 && subi(allieK) === 0 && !propreJ.mort && !allieK.mort,
        {ennemi:r1(subi(ennemi, parGalerie)), J:subi(propreJ), K:subi(allieK)});
    }

    // 5. Intouchable fermée : tir direct d'un char, Frappe de précision, Marteau ; vulnérable ouverte ; roquette de
    //    Grêle en vol qui arrive après la fermeture.
    scene();
    {
      const gJ = poserGalerie('J'), gI = poserGalerie('I');
      const pvJ = gJ.pv, pvI = gI.pv;
      // Char de I posé à 150 px de l'Aiguille fermée : il ne la prend pas pour cible.
      const ours = unite('ours', 'I', gJ.x + 150, gJ.y);
      // Ordre d'attaque sur une galerie fermée : soit refusé (« Galerie fermée : intouchable. »), soit accepté mais
      // transformé en déplacement vers le point, sans cible, avec un mot au joueur (règle de jeu.js depuis le
      // 18 novembre 2026). Dans les deux cas, l'unité ne doit ni viser la galerie ni en avoir l'ordre.
      const mots = [], notifierOrig = window.notifier;   // (remis aussi en place à la fin, avec les autres espions)
      window.notifier = function(camp, texte){ if(camp === 'I' && typeof texte === 'string') mots.push(texte); return notifierOrig.apply(this, arguments); };
      const essaiAttaque = type => {
        const r = executerOrdre('I', {type, ids:[ours.id], x:gJ.x, y:gJ.y, cibleId:gJ.id});
        const sansCible = ours.cible !== gJ && !(ours.ordre && ours.ordre.cible === gJ);
        const ok = r.ok ? sansCible && mots.some(m => /Galerie fermée/.test(m)) : /Galerie fermée : intouchable/.test(r.motif || '') && sansCible;
        return {ok, accepte:r.ok, motif:r.motif || null, ordre:ours.ordre ? ours.ordre.type : null, cibleGalerie:!sansCible};
      };
      const aDroit = essaiAttaque('droit'), aAD = essaiAttaque('attaqueDeplacement');
      window.notifier = notifierOrig;
      ours.ordre = null; ours.chemin = null; ours.cible = null;
      V('fermée : ordre d’attaque sur une galerie fermée refusé, ou changé en déplacement sans cible avec un mot au joueur', aDroit.ok && aAD.ok,
        {droit:aDroit, attaqueDeplacement:aAD, mot:mots[0] || null});
      ecouter();
      let vise = 0;
      for(let k = 0; k < Math.round(6/DT); k++){ miseAJour(DT); if(ours.cible === gJ) vise++; }
      // Ordre forcé (contourne la validation) : il tombe de lui-même, aucun dégât.
      ours.ordre = {type:'attaquer', cible:gJ}; ours.cible = gJ;
      for(let k = 0; k < Math.round(6/DT); k++){ miseAJour(DT); if(k > 0 && ours.cible === gJ) vise++; }
      V('fermée : un char ne la vise pas et ne lui fait aucun dégât (même sur ordre forcé)', gJ.pv === pvJ && vise === 0 && !peutCibler(ours, gJ)
        && !(ours.ordre && ours.ordre.cible === gJ), {pv:gJ.pv, pasVisee:vise, ordre:ours.ordre && ours.ordre.type});
      ours.mort = true;
      // Frappe de précision (J) sur le Terrier fermé, Marteau (I) sur l'Aiguille fermée ; un collecteur posé à côté
      // de chaque galerie prouve que l'explosion a bien eu lieu.
      const tI = unite('collecteur', 'I', gI.x, gI.y + gI.rayon + 14); tI.gare = true;
      const tJ = unite('collecteur', 'J', gJ.x, gJ.y + gJ.rayon + 14); tJ.gare = true;
      const okF = activerPouvoir('J', 'frappe', gI.x, gI.y, true), okM = activerPouvoir('I', 'marteau', gJ.x, gJ.y, true);
      pas(8);
      V('fermée : Frappe de précision et Marteau sans effet sur elle (le voisin, lui, est touché)', okF && okM && gI.pv === pvI && gJ.pv === pvJ
        && subi(tI) > 0 && subi(tJ) > 0 && subi(gI) === 0 && subi(gJ) === 0, {frappeVoisin:r1(subi(tI)), marteauVoisin:r1(subi(tJ)), pvGaleries:[gJ.pv, gI.pv]});
      V('fermée : infliger et explosionZone directs sans effet', (() => { const u = unite('conscrit', 'I', gJ.x + 200, gJ.y); infliger(gJ, 500, u); explosionZone(gJ.x, gJ.y, 80, 500, 'roquette', u); u.mort = true; return gJ.pv === pvJ; })(),
        {pv:gJ.pv});
      // Ouverte : vulnérable (peutCibler, infliger, explosionZone).
      gJ.gal.stock = 1;
      const cible = qg('I');
      executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:cible.x, y:cible.y});
      const t0 = temps;
      const u2 = unite('ours', 'I', gJ.x + 380, gJ.y); u2.recharge = 1e9;
      const p1 = gJ.pv; infliger(gJ, 100, u2); const dInf = p1 - gJ.pv;
      const p2 = gJ.pv; explosionZone(gJ.x, gJ.y, 80, 200, 'roquette', u2); const dZone = p2 - gJ.pv;
      V('ouverte : vulnérable (peutCibler, infliger, explosionZone)', peutCibler(u2, gJ) && dInf === 100 && dZone > 0, {peutCibler:peutCibler(u2, gJ), infliger:dInf, zone:r1(dZone)});
      u2.mort = true;
      // Grêle de I à 380 px : une salve tirée 4,5 s avant la fermeture (arrivée avant elle) porte ; une salve tirée
      // 1 s avant la fermeture (17,5 s depuis le 19 novembre 2026 ; 11,5 et 15 s avec l'ancien cycle de 16 s) est
      // encore en vol à la fermeture et se perd.
      const grele = unite('grele', 'I', gJ.x + 380, gJ.y); grele.recharge = 1e9;
      while(temps - t0 < CYCLE_GALERIE.duree - 4.5 - 1e-6) miseAJour(DT);
      const pvA = gJ.pv; tirer(grele, gJ);
      while(temps - t0 < CYCLE_GALERIE.duree - 1 - 1e-6) miseAJour(DT);
      const dAvant = pvA - gJ.pv;
      const pvB = gJ.pv; tirer(grele, gJ);
      while(gJ.gal.t0 !== null) miseAJour(DT);
      const enVolALaFermeture = projectiles.filter(p => p.auteur === grele).length;
      pas(4);
      const dApres = pvB - gJ.pv;
      V('Grêle : salve arrivée galerie ouverte → dégâts ; salve encore en vol à la fermeture → aucun dégât', dAvant > 0 && enVolALaFermeture > 0 && dApres === 0,
        {avantFermeture:r1(dAvant), roquettesEnVolALaFermeture:enVolALaFermeture, apresFermeture:r1(dApres), fermeA:r2(temps - 4 - t0)});
      grele.mort = true;
    }

    // 6. Détruite avant le départ (pas de missile, pas de remboursement ; points habituels pour le destructeur),
    //    et missile parti qui frappe même si la galerie meurt.
    for(const id of ['J', 'I']){
      scene();
      const adv = id === 'J' ? 'I' : 'J', g = poserGalerie(id), G = g.def.galerie, q = qg(adv);
      g.gal.stock = G.lanceurs;
      const tueur = unite(faction(adv).ouvrier, adv, q.x, q.y + 120);
      ecouter();
      executerOrdre(id, {type:'tirGalerie', id:g.id, x:q.x, y:q.y});
      const t0 = temps, res0 = camps[id].reserves, pvQ = q.pv;
      while(temps - t0 < 5 - 1e-6) miseAJour(DT);
      const pts0 = camps[adv].points;   // relevé juste avant le coup (les points montent aussi avec le temps)
      infliger(g, 1e6, tueur);
      const gainPoints = camps[adv].points - pts0;
      pas(15);
      const missiles = journal.effets.filter(e => e.type === 'missile' && e.p.galerie).length, impacts = journal.zones.filter(z => z.arme === 'missileGalerie').length;
      V('détruite avant le départ ' + id + ' : aucun missile, aucun impact, aucun remboursement', g.mort && missiles === 0 && impacts === 0 && q.pv === pvQ
        && camps[id].reserves === res0 && !evenements.length, {missiles, impacts, degatsQG:pvQ - q.pv, remboursement:camps[id].reserves - res0});
      V('détruire une galerie ' + id + ' rapporte les points habituels (prix / 180)', Math.abs(gainPoints - g.def.cout/180) < 0.01, {gain:r2(gainPoints), attendu:r2(g.def.cout/180)});
      // Missile parti, puis galerie détruite : il frappe quand même.
      scene();
      const g2 = poserGalerie(id), q2 = qg(adv);
      g2.gal.stock = G.lanceurs;
      const tueur2 = unite(faction(adv).ouvrier, adv, q2.x, q2.y + 120);
      ecouter();
      executerOrdre(id, {type:'tirGalerie', id:g2.id, x:q2.x, y:q2.y});
      const t1 = temps, pvQ2 = q2.pv;
      while(temps - t1 < CYCLE_GALERIE.departs[1] + 0.1 - 1e-6) miseAJour(DT);   // juste après le dernier départ (8,7 s avec l'ancien cycle)
      infliger(g2, 1e6, tueur2);
      pas(8);
      const imp2 = journal.zones.filter(z => z.arme === 'missileGalerie').length;
      V('missile parti puis galerie ' + id + ' détruite : il frappe quand même', g2.mort && imp2 === G.lanceurs && pvQ2 - q2.pv > 0,
        {impacts:imp2, attendus:G.lanceurs, degatsQG:r1(pvQ2 - q2.pv)});
    }

    // 7. Jamais réparée (ouvriers, réparateurs, ordre manuel), ouverte puis fermée.
    scene();
    for(const id of ['J', 'I']){
      const g = poserGalerie(id), adv = id === 'J' ? 'I' : 'J', q = qg(adv);
      g.gal.stock = 1;
      executerOrdre(id, {type:'tirGalerie', id:g.id, x:q.x, y:q.y});
      const frappeur = unite('conscrit', adv, g.x + 300, g.y); infliger(g, 500, frappeur); frappeur.mort = true;
      const pvBlesse = g.pv, F = faction(id);
      const ouvAuto = unite(F.ouvrier, id, g.x, g.y + g.rayon + 20);
      const ouvOrdre = unite(F.ouvrier, id, g.x + g.rayon + 20, g.y); ouvOrdre.ordre = {type:'reparer', bat:g};
      const ouvClic = unite(F.ouvrier, id, g.x - g.rayon - 20, g.y);
      const rClic = executerOrdre(id, {type:'droit', ids:[ouvClic.id], x:g.x, y:g.y, cibleId:g.id});
      const rep = unite(id === 'J' ? 'atelier' : 'depanneuse', id, g.x, g.y - g.rayon - 24); rep.ordre = {type:'soigner', cible:g};
      const fantassin = unite(id === 'J' ? 'mecano' : 'infirmier', id, g.x + 30, g.y - g.rayon - 24);
      const ordreClic = ouvClic.ordre && ouvClic.ordre.type;
      g._ref = {pvBlesse, ordreClic, rClic, rep, fantassin, ouvAuto, ouvOrdre, ouvClic};
    }
    pas(30);
    for(const id of ['J', 'I']){
      const g = ents.find(e => e.camp === id && estGalerie(e)), R = g._ref;
      V('jamais réparée ' + id + ' (ouvriers, réparateurs, ordre manuel ; ouverte puis fermée)', g.pv === R.pvBlesse && R.rClic.ok && R.ordreClic !== 'reparer'
        && !peutSoigner(R.rep, g) && !peutSoigner(R.fantassin, g) && batimentAReparer(R.ouvAuto, 2000) !== g && galerieFermee(g),
        {pv:g.pv, pvApresDegats:R.pvBlesse, ordreDuClicDroit:R.ordreClic, ordreReparateur:R.rep.ordre && R.rep.ordre.type, ordreOuvrier:R.ouvOrdre.ordre && R.ouvOrdre.ordre.type});
    }

    // 8. Aucune récompense en points pour les destructions dues à une galerie (contre-épreuve par une unité).
    scene();
    {
      const gJ = poserGalerie('J'); gJ.gal.stock = 1;
      const p = trouverEmplacement('caserne', qg('I')), cas = creerBatiment('caserne', 'I', p.c, p.r, true); cas.pv = 100;
      executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:cas.x, y:cas.y});
      let saut = 0, prec = camps.J.points;
      // (Impact + 2,5 s : 15 s avec l'ancien cycle de 16 s.)
      for(let k = 0; k < Math.round((CYCLE_GALERIE.departs[0] + CYCLE_GALERIE.vol + 2.5)/DT); k++){ const mortAvant = cas.mort; miseAJour(DT); if(cas.mort && !mortAvant) saut = camps.J.points - prec; prec = camps.J.points; }
      const p2 = trouverEmplacement('caserne', qg('I')), cas2 = creerBatiment('caserne', 'I', p2.c, p2.r, true); cas2.pv = 1;
      const tireur = unite('conscrit', 'J', cas2.x - 200, cas2.y), pts0 = camps.J.points;
      infliger(cas2, 50, tireur);
      const controle = camps.J.points - pts0, attendu = BATIMENTS.caserne.cout/180;
      V('aucun point de commandement pour une destruction par la galerie (contre-épreuve : unité)', cas.mort && Math.abs(saut) < 0.01 && Math.abs(controle - attendu) < 0.01,
        {casernetuee:cas.mort, pointsGalerie:r2(saut), pointsUnite:r2(controle), attendu:r2(attendu)});
    }

    // 9. Fin de partie : camp I réduit à sa galerie (fermée) → éliminé, galerie effondrée, victoire de l'équipe A.
    scene();
    {
      const gI = poserGalerie('I'), qI = qg('I'), tueur = unite('conscrit', 'J', qI.x - 250, qI.y);
      infliger(qI, 1e6, tueur);
      const renforts = batimentRenforts('I'), fermee = galerieFermee(gI);
      const duree = jusqua(() => camps.I.elimine, 3);
      pas(1.5);
      V('fin de partie : camp réduit à sa galerie → éliminé, galerie effondrée, partie gagnée', fermee && renforts === null && duree !== null && gI.mort && partieFinie
        && issuePartie && issuePartie.victoire === true, {eliminationApres:duree === null ? 'non' : r2(duree), galerieDetruite:gI.mort, partieFinie, victoire:issuePartie && issuePartie.victoire});
    }

    // 10. Ordres refusés en ligne (hôte, puis invité) ; pas de code réseau ; rien n'est changé.
    scene();
    {
      const gJ = poserGalerie('J'); gJ.gal.stock = 1;
      const q = qg('J'), o = unite('technicien', 'J', q.x, q.y + 110), pu = trouverEmplacement('usine', {x:q.x, y:q.y - 200});
      creerBatiment('usine', 'J', pu.c, pu.r, true);
      gJ.mort = true;   // (pour que la règle « une seule » ne masque pas le refus de construction)
      const pc = trouverEmplacement('aiguille', q); gJ.mort = false;
      const photo0 = photoEtat(), res = [], galEnLigneAvant = galeriesEnLigne;
      // (20 novembre 2026, galeries en ligne, lot 1 : en ligne, c'est le réglage du salon qui compte, galeriesEnLigne,
      // ici décoché ; les ordres ont maintenant un code réseau, CAHIER-GALERIES-EN-LIGNE.md § 5.)
      for(const [mr, rm] of [['hote', 'hote'], ['invite', 'invite'], ['echo', null]]){
        modeReseau = mr; roleMonde = rm; galeriesEnLigne = false;
        const a = executerOrdre('J', {type:'fabriquerMissile', id:gJ.id}), b = executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:1600, y:1100});
        let c = null;
        if(mr !== 'invite'){ gJ.mort = true; c = executerOrdre('J', {type:'construire', bat:'aiguille', c:pc.c, r:pc.r, ouvrierIds:[o.id]}); gJ.mort = false; }
        res.push({mode:mr, actif:galeriesActives(), fab:a.ok ? 'ACCEPTÉ' : a.motif, tir:b.ok ? 'ACCEPTÉ' : b.motif, construire:c ? (c.ok ? 'ACCEPTÉ' : c.motif) : '-',
          liste:batimentsConstructibles(faction('J')).includes('aiguille')});
        modeReseau = reseauAvant; roleMonde = roleAvant; galeriesEnLigne = galEnLigneAvant;
      }
      // Codes réseau (depuis le 20 novembre 2026) : fabMissile et tirGalerie, dans les deux sens.
      const om = ordreVersReseau({type:'fabriquerMissile', id:gJ.id}), ot = ordreVersReseau({type:'tirGalerie', id:gJ.id, x:1, y:1});
      const sansCode = !!om && om.o === 'fabMissile' && !!ot && ot.o === 'tirGalerie' && ot.x === 1
        && ordreDepuisReseau(om).type === 'fabriquerMissile' && ordreDepuisReseau(ot).type === 'tirGalerie';
      V('en ligne réglage décoché (hôte, invité, écho) : fabriquer, tirer et construire refusés, galerie absente de la liste ; codes réseau fabMissile et tirGalerie ; état inchangé',
        res.every(r => !r.actif && r.fab !== 'ACCEPTÉ' && r.tir !== 'ACCEPTÉ' && r.construire !== 'ACCEPTÉ' && !r.liste && r.fab === MOTIF_SANS_GALERIES)
        && sansCode && photoEtat() === photo0, {res, sansCode});
    }
    essaisRiposte();
  }

  // ----------------------------------------------------------------- riposte et esquive (lot 2, 19 novembre 2026)
  // Scènes courtes (cahier § 9.4 et 9.5) : règle du temps restant pour les pouvoirs (Facile et Ultra), petit
  // pouvoir et super-arme sur une galerie ouverte selon le niveau, contre-tir décidé par l'ordinateur lui-même
  // (sa boucle de réflexion tourne), limite des 2,5 s, tir ordinaire jamais gaspillé sur une galerie qui se
  // refermera, esquive de Difficile (et pas de Normale).
  function essaisRiposte(){
    const bats = id => ents.filter(e => e.camp === id && e.est === 'batiment' && !e.mort);
    // Niveau d'un camp sans faire tourner son ordinateur (appels directs) ; actif : il réfléchit aussi seul.
    const niveau = (id, n, actif) => { confierAOrdinateur(id, n); if(!actif) etatIA(id).active = false; };
    const journalIA = id => (etatIA(id).galerie || {journal:[]}).journal;
    const poserLoin = (id, d) => { const t = typeGal(id), p = trouverEmplacement(t, versCentre(id, d)); return p ? creerBatiment(t, id, p.c, p.r, true) : null; };
    // Ouvre la galerie g (stock rempli) sur un point vide du centre de la carte, puis avance jusqu'à galT ≈ a.
    const ouvrirJusqua = (g, a) => {
      g.gal.stock = g.def.galerie.lanceurs; g.gal.fab = 0;
      const ok = executerOrdre(g.camp, {type:'tirGalerie', id:g.id, x:LARG/2, y:HAUT/2}).ok;
      while(ok && g.galT !== null && g.galT < a - 1e-6) miseAJour(DT);
      return ok;
    };
    const pouvoirsPrets = (id, pts, rech) => { camps[id].points = pts; camps[id].recharges = Object.assign({}, rech); };

    // 1. Temps restant (tous niveaux) : Facile (pouvoirsIA, meilleurGroupe) et Ultra (meilleureZoneUltra).
    //    Galerie de I loin de sa base, un conscrit à côté : densité 3 (seuil du petit pouvoir) avec la galerie,
    //    1 sans elle. À galT ≈ 3, la Frappe (impact à 1,2 s) peut la toucher ; à 1,5 s de la fermeture (galT ≈ 16
    //    depuis le cycle de 17,5 s du 19 novembre 2026, 14,5 avant ; moins que 1,2 + 1), non.
    {
      scene();
      const gI = poserLoin('I', 650);
      niveau('K', 'facile');
      const conscrit = () => unite('conscrit', 'I', gI.x + 70, gI.y + 70);
      let u = conscrit();
      ouvrirJusqua(gI, 3);
      pouvoirsPrets('K', 10, {essaim:100});
      // Ultra (petit pouvoir) : la galerie, ramenée sous 400 PV le temps du calcul, vaut 720 ≥ 500.
      const pv = gI.pv; gI.pv = 300;
      etatIA('K').niveau = 'ultra';
      const ctxK = {uns:ents.filter(e => e.camp === 'K' && e.est === 'unite' && !e.mort), bats:bats('K')};
      const A3 = analyserUltra('K', etatUltra('K'), ctxK.bats, ctxK.uns);
      const zU3 = meilleureZoneUltra('K', A3, POUVOIRS.halden[0].rayon, ctxK, false, SEUIL_ZONE_ULTRA.petit, delaiPouvoir(POUVOIRS.halden[0]));
      gI.pv = pv; etatIA('K').niveau = 'facile';
      const g3 = meilleurGroupe('I', 1.2);
      pouvoirsIA(camps.K, [], []);
      const lance3 = (camps.K.recharges.frappe || 0) > 0;
      while(gI.galT !== null && gI.galT < CYCLE_GALERIE.duree - 1.5 - 1e-6) miseAJour(DT);
      if(u.mort) u = conscrit();
      const reste = r2(resteOuvertureGalerie(gI));
      const g14ancien = meilleurGroupe('I'), g14 = meilleurGroupe('I', 1.2);
      pouvoirsPrets('K', 10, {essaim:100});
      pouvoirsIA(camps.K, [], []);
      const lance14 = (camps.K.recharges.frappe || 0) > 0;
      gI.pv = 300; etatIA('K').niveau = 'ultra';
      const ctx14 = {uns:ents.filter(e => e.camp === 'K' && e.est === 'unite' && !e.mort), bats:bats('K')};
      const A14 = analyserUltra('K', etatUltra('K'), ctx14.bats, ctx14.uns);
      const zU14 = meilleureZoneUltra('K', A14, POUVOIRS.halden[0].rayon, ctx14, false, SEUIL_ZONE_ULTRA.petit, delaiPouvoir(POUVOIRS.halden[0]));
      const zU14ancien = meilleureZoneUltra('K', A14, POUVOIRS.halden[0].rayon, ctx14, false, SEUIL_ZONE_ULTRA.petit);
      gI.pv = pv;
      V('riposte : temps restant (tous niveaux) — Facile lance la Frappe sur la galerie ouverte depuis 3 s, pas à 1,5 s de la fermeture ; Ultra de même',
        g3 && g3.score >= 3 && lance3 && g14ancien && g14ancien.score >= 3 && g14 && g14.score < 3 && !lance14 && zU3 && Math.hypot(zU3.x - gI.x, zU3.y - gI.y) < 1 && !zU14 && zU14ancien,
        {densite3:g3 && g3.score, lance3, reste14:reste, densite14SansRegle:g14ancien && g14ancien.score, densite14:g14 && g14.score, lance14,
         ultra3:zU3 && Math.round(zU3.valeur), ultra14:zU14 && Math.round(zU14.valeur), ultra14SansRegle:zU14ancien && Math.round(zU14ancien.valeur)});
    }

    // 2. Petit pouvoir (Normale, Halden K) sur la galerie ouverte de I, même quand la super-arme est prête
    //    (3 points seulement : la règle habituelle garderait ces points) ; il touche la galerie avant sa
    //    fermeture. Normale ne contre-tire pas (sa galerie est prête) et ne lance pas la super-arme.
    {
      scene();
      const gI = poserLoin('I', 650), gK = poserGalerie('K');
      gK.gal.stock = 1;
      niveau('K', 'normal');
      ouvrirJusqua(gI, 0.5);
      pouvoirsPrets('K', 3, {});
      ecouter();
      riposteGalerieIA('K', camps.K, bats('K'));
      const jK = journalIA('K').slice(), prise = jK.find(l => l.quoi === 'ripostePouvoir');
      pas(2);
      const deg = subi(gI, d => d.auteur && d.auteur.pouvoir);
      // Super-arme prête, 10 points, Frappe en recharge, cinq unités autour de la galerie (densité 7) : rien.
      for(let k = 0; k < 5; k++) unite('conscrit', 'I', gI.x + 60*Math.cos(k), gI.y + 60*Math.sin(k));
      pouvoirsPrets('K', 10, {frappe:30});
      riposteGalerieIA('K', camps.K, bats('K'));
      const superNormale = (camps.K.recharges.essaim || 0) > 0;
      // Même situation pour Difficile : la super-arme part sur la galerie.
      etatIA('K').niveau = 'difficile';
      const densite = scoreGroupe(listeGroupe('I', delaiPouvoir(POUVOIRS.halden[1])), gI.x, gI.y);
      gK.gal.stock = 0;   // (pas de contre-tir ici : seule la super-arme est jugée)
      riposteGalerieIA('K', camps.K, bats('K'));
      const superDifficile = (camps.K.recharges.essaim || 0) > 0;
      V('riposte : Normale lance la Frappe sur une galerie ouverte (points gardés d’habitude pour la super-arme), elle la touche ; ni contre-tir ni super-arme',
        prise && prise.pouvoir === 'frappe' && prise.cibleId === gI.id && deg > 0 && !jK.some(l => l.quoi === 'contreTir') && gK.gal.t0 === null && !superNormale,
        {riposte:prise, degatsFrappe:Math.round(deg), superNormale});
      V('riposte : Difficile lance la super-arme sur une galerie ouverte dont le voisinage vaut le seuil (densité ≥ 6)',
        densite >= SEUIL_GROUPE_IA.super && superDifficile, {densite, superDifficile});
      journal = null;
    }

    // 3. Contre-tir décidé par l'ordinateur lui-même (Difficile, I Karsk, sa boucle de réflexion tourne) :
    //    J ouvre sa galerie ; I tire dans la seconde, ses deux missiles touchent la galerie de J encore ouverte.
    {
      scene();
      const gJ = poserGalerie('J'), gI = poserGalerie('I');
      niveau('I', 'difficile', true);
      pas(1);
      gI.gal.stock = 2; gI.gal.fab = 0; gJ.gal.stock = 1; gJ.gal.fab = 0;
      ecouter();
      const ok = executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:qg('I').x, y:qg('I').y}).ok, t0 = temps;
      let fermeT = null;
      while(temps - t0 < 20){ miseAJour(DT); if(fermeT === null && gJ.galT === null) fermeT = temps; }
      const ct = journalIA('I').find(l => l.quoi === 'contreTir');
      const coups = (journal.degats.get(gJ.id) || []).filter(parGalerie);
      V('contre-tir : Difficile (Karsk) voit l’ouverture adverse et tire dans la seconde ; ses missiles frappent la galerie de J avant sa fermeture',
        ok && ct && ct.cibleId === gJ.id && ct.t - t0 <= 0.9 && ct.n === 2 && coups.length > 0 && coups.every(c => c.t < fermeT),
        {ordreJ:ok, contreTir:ct, delaiReaction:ct && r2(ct.t - t0), impacts:coups.map(c => r2(c.t - t0) + ' s : ' + Math.round(c.deg)), fermetureJ:fermeT && r2(fermeT - t0)});
      journal = null;
    }

    // 4. Limite du contre-tir : Halden Difficile (K, un missile) contre la galerie de I ouverte depuis 2,3 s
    //    (14,5 + 0,5 < 15,2 restantes, cycle de 17,5 s ; 13 + 0,5 < 13,7 avec celui de 16 s) : tir ; depuis 2,7 s :
    //    pas de tir. Karsk (deux missiles) : 1,9 s au plus. Limites inchangées par l'allongement du cycle.
    {
      const essai = (camp, a) => {
        scene();
        const cible = poserLoin(camp === 'K' ? 'I' : 'J', 650), g = poserGalerie(camp);
        niveau(camp, 'difficile');
        g.gal.stock = g.def.galerie.lanceurs;
        ouvrirJusqua(cible, a);
        const galT = r2(cible.galT);
        riposteGalerieIA(camp, camps[camp], bats(camp));
        return {galT, tir:g.gal.t0 !== null};
      };
      const h23 = essai('K', 2.3), h27 = essai('K', 2.7), k18 = essai('I', 1.8), k22 = essai('I', 2.2);
      V('contre-tir : seulement si le dernier missile arrive avant la fermeture adverse (Halden : avant 2,5 s d’ouverture ; Karsk, deux missiles : avant 1,9 s)',
        h23.tir && !h27.tir && k18.tir && !k22.tir, {halden:[h23, h27], karsk:[k18, k22]});
    }

    // 5. Tir ordinaire (§ 9.3, correction de l'étape 1) : une galerie ouverte depuis 5 s n'est plus une cible
    //    (refermée avant l'impact, 14,5 s plus tard ; 13 s avec l'ancien cycle) ; ouverte depuis 1 s, elle l'est.
    {
      scene();
      const gI = poserLoin('I', 650);
      ouvrirJusqua(gI, 1);
      const a1 = ciblesGalerieIA('K', delaiTirGalerie(1)).cibles.includes(gI);
      while(gI.galT !== null && gI.galT < 5) miseAJour(DT);
      const a5 = ciblesGalerieIA('K', delaiTirGalerie(1)).cibles.includes(gI), sans = ciblesGalerieIA('K').cibles.includes(gI);
      V('tir ordinaire : une galerie ouverte qui se refermera avant l’impact n’est ni visée ni comptée', a1 && !a5 && sans, {ouverte1s:a1, ouverte5s:a5, sansDelai:sans});
    }

    // 5 bis. Journal (lot 3, défaut 6, 19 novembre 2026) : Difficile (I, sa boucle tourne), galerie chargée mais des
    //    unités de J valant plus que la retenue près d'elle ; J ouvre deux fois. Une seule ligne « retenue » par
    //    ouverture (avant : une par réflexion tant que le contre-tir restait possible), et aucun contre-tir.
    {
      scene();
      const gJ = poserGalerie('J'), gI = poserGalerie('I');
      niveau('I', 'difficile', true);
      pas(1);
      const R = reglagesGalerieIA('I');
      for(let k = 0; k < 40 && valeurEnnemiePres('I', gI.x, gI.y, R.retenueRayon) <= R.retenueValeur; k++)
        unite('conscrit', 'J', gI.x + 120*Math.cos(k), gI.y + 120*Math.sin(k));
      const valeur = valeurEnnemiePres('I', gI.x, gI.y, R.retenueRayon), lignes = [];
      for(let n = 0; n < 2; n++){
        gI.gal.stock = gI.def.galerie.lanceurs; gI.gal.fab = 0; gJ.gal.stock = 1; gJ.gal.fab = 0;
        const avant = journalIA('I').length, ok = executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:LARG/2, y:HAUT/2}).ok, t0 = temps;
        while(temps - t0 < 4) miseAJour(DT);
        const J = journalIA('I').slice(avant);
        lignes.push({ordreJ:ok, retenues:J.filter(l => l.quoi === 'retenue' && l.cibleId === gJ.id).length, contreTirs:J.filter(l => l.quoi === 'contreTir').length});
        while(gJ.galT !== null) miseAJour(DT);
      }
      V('journal : une retenue de contre-tir notée une seule fois par ouverture adverse (deux ouvertures, deux lignes)',
        valeur > R.retenueValeur && lignes.every(l => l.ordreJ && l.retenues === 1 && l.contreTirs === 0), {valeurPres:valeur, ouvertures:lignes});
    }

    // 6. Esquive (§ 9.5) : un conscrit de I au point de rassemblement de son ordinateur (rien d'autre ne le
    //    déplace) ; J tire dessus. Difficile : il reçoit l'ordre de sortir du cercle et n'est pas touché.
    //    Normale : il ne bouge pas et il est touché.
    {
      const essai = n => {
        scene();
        const gJ = poserGalerie('J');
        niveau('I', n, true);
        const c = qg('I'), dx = LARG/2 - c.x, dy = HAUT/2 - c.y, d = Math.hypot(dx, dy) || 1;
        const p = pointLibre(c.x + dx/d*280, c.y + dy/d*280), u = unite('conscrit', 'I', p.x, p.y);
        pas(1);
        gJ.gal.stock = 1; gJ.gal.fab = 0;
        ecouter();
        executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:u.x, y:u.y});
        const t0 = temps; let esquiveT = null;
        // (Impact + 1,5 s : 14,5 s avec l'ancien cycle de 16 s.)
        while(temps - t0 < CYCLE_GALERIE.departs[0] + CYCLE_GALERIE.vol + 1.5){ miseAJour(DT); if(esquiveT === null && u.ultraEsquive) esquiveT = r2(temps - t0); }
        const r = {niveau:n, esquive:esquiveT, touche:Math.round(subi(u, parGalerie)), mort:u.mort};
        journal = null;
        return r;
      };
      const dif = essai('difficile'), nor = essai('normal');
      V('esquive : Difficile sort ses unités du cercle annoncé d’un missile de galerie (Normale non)',
        dif.esquive !== null && dif.esquive >= CYCLE_GALERIE.departs[0] && dif.touche === 0 && !dif.mort && nor.esquive === null && nor.touche > 0, {difficile:dif, normale:nor});
    }
  }

  // ----------------------------------------------------------------- parties (lot 2, 19 novembre 2026)
  // Cahier § 9.7 : parties d'ordinateurs de 900 s, option cochée, où personne ne pose de galerie à leur place.
  // Graines choisies le 19 novembre 2026 parmi les premières essayées, pour que chaque partie montre ce qu'elle
  // doit montrer (sujets : le ou les camps qui doivent bâtir, fabriquer et tirer ; riposte : la riposte attendue).
  // Ultra gagne souvent contre Difficile avant que sa galerie ait tiré : sur 12 graines essayées (1 à 6, Ultra
  // Karsk puis Ultra Halden), seule la graine 6, Ultra Halden, le voit tirer ; Difficile n'y bâtit pas de galerie.
  // Graine 43 : la partie de l'étape 1 où les deux camps Difficile bâtissent ; on y voit un contre-tir.
  // Graines rechoisies le 19 novembre 2026 (lot 3 : l'ordinateur épargne désormais peu à peu pour sa galerie, les
  // parties ne se déroulent plus pareil), sans rien changer à ce que prouvent les verdicts. Les anciennes ne
  // montraient plus : graine 2, la riposte par pouvoir de Normale ; graine 6, le tir d'Ultra (partie finie à
  // 727 s, missile pas encore prêt) ; graine 43, le contre-tir. Premières graines qui montrent tout, parmi 1 à 20
  // (1 à 15 pour Ultra) : 13 (graines 13, 15, 16, 18, 19 conviennent), 11 (seule), 13 (13 et 14).
  // Rechoisies de nouveau à l'étape 2 (19 novembre 2026) : les parties partent désormais de prochainId = 1
  // (partieRejouable, voir partieSerieGaleries : avant, elles dépendaient de ce qui avait tourné avant dans la page),
  // et l'emplacement de la galerie est tiré au hasard (défaut 5). Graine 13 de la première partie : J bâtit et
  // fabrique mais ne tire pas, aucune riposte ; graine 13 de la troisième : seul I bâtit. Premières graines qui
  // montrent tout : 5 (parmi 1 à 5), 11 (inchangée), 33 (parmi 1 à 35, seule ; Difficile Halden bâtit rarement).
  // Rechoisies encore en fin d'étape 2 (19 novembre 2026) : la case de la galerie est désormais tirée parmi les quatre
  // plus proches du point visé (PLACE_GALERIE.choix), ce qui change la suite des parties. Graine 5 : J bâtit et
  // fabrique mais ne tire plus (partie finie à 620 s), aucune riposte ; graine 33 : aucun contre-tir. Mêmes critères
  // que les verdicts ci-dessous (hors temps de calcul) : 2 et 6 conviennent parmi 1 à 14 ; 25 seule parmi 1 à 30.
  function essaisParties(){
    const parties = [
      {nom:'Difficile (J, Karsk) contre Normale (I, Halden)', graine:2, sujets:['J'], riposte:'ripostePouvoir',
       liste:[{id:'J', faction:'karsk', equipe:'A', niveau:'difficile'}, {id:'I', faction:'halden', equipe:'B', niveau:'normal'}]},
      {nom:'Ultra (J, Halden) contre Difficile (I, Karsk)', graine:11, sujets:['J'], riposte:null,
       liste:[{id:'J', faction:'halden', equipe:'A', niveau:'ultra'}, {id:'I', faction:'karsk', equipe:'B', niveau:'difficile'}]},
      {nom:'Difficile (J, Halden) contre Difficile (I, Karsk)', graine:24, sujets:['J', 'I'], riposte:'contreTir',
       liste:[{id:'J', faction:'halden', equipe:'A', niveau:'difficile'}, {id:'I', faction:'karsk', equipe:'B', niveau:'difficile'}]},
    ];
    // Défense antimissile. Étape 4 (19 novembre 2026) : l'ordinateur bâtissait sa Batterie Parasol avant sa propre
    // galerie, et aucune graine ne montrait plus les deux galeries et un contre-tir ; cette 3e partie se jouait donc
    // sans la défense de l'ordinateur (sansDefenseIA). Correction du 20 novembre 2026 : la galerie passe avant la
    // défense (sauf tir déjà subi), et la partie se joue de nouveau AVEC la défense. Graine 24 (au lieu de 25,
    // qui ne montre plus de tir) : les deux galeries, des tirs des deux côtés, un contre-tir, et chez chacun une
    // batterie et deux radars. sansDefense reste possible dans la liste, pour mesurer.
    const DUREE = 900;
    for(const P of parties){
      if(typeof numero === 'number' && parties.indexOf(P) !== numero) continue;
      const t0 = performance.now();
      const r = P.sansDefense ? sansDefenseIA(() => partieGaleriesSurveillee(P.liste, DUREE, P.graine)) : partieGaleriesSurveillee(P.liste, DUREE, P.graine);
      const calcul = Math.round(performance.now() - t0);
      // Même partie, option décochée : temps de calcul par pas (comparaison seulement).
      optionGaleries = false;
      let sans;
      try { sans = avecGraine(P.graine, () => partieOrdinateurs(P.liste, DUREE)); } finally { optionGaleries = true; }
      const nom = P.nom + ' (graine ' + P.graine + ', ' + DUREE + ' s' + (P.sansDefense ? ', sans la défense antimissile de l’ordinateur' : '') + ')';
      const bilan = P.sujets.map(id => { const g = r.galeries[id]; return {camp:id, chantier:g.chantier, commandes:g.commandes.length, tirs:g.tirsTotal, contreTirs:g.contreTirs, etat:g.etat}; });
      V('partie ' + nom + ' : ' + P.sujets.join(' et ') + (P.sujets.length > 1 ? ' bâtissent leur galerie, fabriquent et tirent' : ' bâtit sa galerie, fabrique et tire') + ' au moins une fois',
        !r.erreur && bilan.every(b => b.chantier != null && b.commandes >= 1 && b.tirs >= 1), {bilan, fin:r.temps + ' s, ' + r.issue});
      V('partie ' + nom + ' : jamais une galerie fermée visée ni touchée ; chaque riposte arrive avant la fermeture de sa cible',
        !r.erreur && r.fautes.length === 0 && r.arrivees.every(a => a.ok === true), {fautes:r.fautes, arrivees:r.arrivees});
      const manquees = r.occasions.filter(o => (o.contre && !o.contreFait && !o.retenue) || (o.pouvoir && !o.pouvoirFait));
      const vues = Object.values(r.ripostes).flat();
      V('partie ' + nom + ' : riposte à chaque occasion (contre-tir ou petit pouvoir prêts à l’ouverture adverse)' + (P.riposte ? ', ' + P.riposte + ' vu' : ''),
        !r.erreur && manquees.length === 0 && (!P.riposte || vues.some(l => l.includes(P.riposte))),
        {occasions:r.occasions.map(o => ({t:r1(o.t), camp:o.camp, niveau:o.niveau, contrePossible:o.contre, contreFait:o.contreFait, retenue:o.retenue, pouvoirPret:o.pouvoir, pouvoirFait:o.pouvoirFait})), ripostes:r.ripostes});
      const camps0 = Object.keys(r.triche);
      V('partie ' + nom + ' : aucune triche (écart inexpliqué 0, aucune unité sans commande, réserves jamais négatives), aucune erreur',
        !r.erreur && camps0.every(id => /^0 \/ 0 \//.test(r.triche[id]) && r.reservesMin[id] >= 0), {triche:r.triche, reservesMin:r.reservesMin, erreur:r.erreur});
      // Mesure (volet du navigateur masqué : indicatif) : au plus deux fois le temps par pas option décochée.
      V('partie ' + nom + ' : temps de calcul par pas, option cochée contre décochée (au plus le double + 0,05 ms)',
        r.msParPas <= 2*sans.msParPas + 0.05, {cochee:r.msParPas + ' ms (partie finie à ' + r.temps + ' s)', decochee:sans.msParPas + ' ms (partie finie à ' + sans.temps + ' s)',
          calculPartieCochee:calcul + ' ms', resume:r.resume});
    }
  }

  // ----------------------------------------------------------------- ordinateurs
  // Parties d'ordinateurs (ordinaire et Ultra) où chaque camp a sa galerie, qui tire toutes les 40 s sur un
  // bâtiment adverse (stock rempli d'office). À chaque pas : aucune unité hostile ne garde pour cible ni pour
  // ordre une galerie fermée depuis au moins un pas, une galerie fermée ne perd aucun PV, et les fonctions de
  // cible de l'ordinateur (cibleFrappe, cibleVague, choisirObjectifUltra, cibleHarcelement) ne renvoient jamais
  // une galerie fermée. On compte aussi les fois où une galerie OUVERTE a été visée (l'essai voit bien quelque chose).
  function essaisOrdinateur(){
    const parties = [
      {nom:'difficile (J, Halden) contre normale (I, Karsk)', liste:[{id:'J', faction:'halden', equipe:'A', niveau:'difficile'}, {id:'I', faction:'karsk', equipe:'B', niveau:'normal'}], duree:600},
      {nom:'Ultra (J, Karsk) contre Ultra (I, Halden)', liste:[{id:'J', faction:'karsk', equipe:'A', niveau:'ultra'}, {id:'I', faction:'halden', equipe:'B', niveau:'ultra'}], duree:600},
      {nom:'Ultra (J, Halden) contre difficile (I, Karsk)', liste:[{id:'J', faction:'halden', equipe:'A', niveau:'ultra'}, {id:'I', faction:'karsk', equipe:'B', niveau:'difficile'}], duree:600},
    ];
    const fonctions = ['cibleFrappe', 'cibleVague', 'choisirObjectifUltra', 'cibleHarcelement'];
    const origIA = Object.fromEntries(fonctions.map(f => [f, window[f]]));
    const visee = r => r && (estGalerie(r) ? r : r.b && estGalerie(r.b) ? r.b : r.e && estGalerie(r.e) ? r.e : r.cible && estGalerie(r.cible) ? r.cible : null);
    for(const P of parties){
      if(typeof numero === 'number' && parties.indexOf(P) !== numero) continue;
      reinitialiserPartie();
      demarrer(P.liste[0].faction, P.liste.map(k => ({id:k.id, faction:k.faction, equipe:k.equipe, ia:k.id !== 'J', niveau:k.id !== 'J' ? k.niveau : undefined})));
      confierAOrdinateur('J', P.liste[0].niveau);
      const gals = ['J', 'I'].map(poserGalerie).filter(Boolean);
      const B = {fonctionsFermee:0, appelsFonctions:0, viseesFermee:0, ordresFermee:0, degatsFermee:0, viseesOuverte:0, degatsOuverte:0, tirs:0, erreur:null, exemples:[]};
      for(const f of fonctions) window[f] = function(){
        const r = origIA[f].apply(this, arguments); B.appelsFonctions++;
        const g = visee(r); if(g && galerieFermee(g)){ B.fonctionsFermee++; if(B.exemples.length < 4) B.exemples.push(f + ' t=' + r1(temps)); }
        return r;
      };
      const etat = new Map(gals.map(g => [g, {fermee:galerieFermee(g), pv:g.pv}]));
      let prochainTir = 30;
      try {
        for(let k = 0; k < Math.round(P.duree/DT); k++){
          if(temps >= prochainTir){
            prochainTir += 40;
            for(const g of gals){
              if(g.mort || g.gal.t0 !== null) continue;
              const cible = ents.find(e => e.est === 'batiment' && !e.mort && hostile(g.camp, e.camp) && !estGalerie(e));
              if(!cible) continue;
              g.gal.stock = g.def.galerie.lanceurs;
              if(executerOrdre(g.camp, {type:'tirGalerie', id:g.id, x:cible.x, y:cible.y}).ok) B.tirs++;
            }
          }
          try { miseAJour(DT); } catch(e){ B.erreur = 't=' + temps.toFixed(1) + ' ' + e.message; break; }
          for(const g of gals){
            const s = etat.get(g), f = galerieFermee(g);
            if(!g.mort){
              for(const e of ents){
                if(e.mort || !hostile(e.camp, g.camp)) continue;
                const vise = e.cible === g, ordre = !!(e.ordre && (e.ordre.cible === g || e.ordre.bat === g));
                if(f && s.fermee){ if(vise) B.viseesFermee++; if(ordre) B.ordresFermee++; if((vise || ordre) && B.exemples.length < 4) B.exemples.push(e.type + ' ' + e.camp + ' t=' + r1(temps)); }
                else if(!f && vise) B.viseesOuverte++;
              }
              if(g.pv < s.pv){ if(f && s.fermee) B.degatsFermee += s.pv - g.pv; else B.degatsOuverte += s.pv - g.pv; }
            }
            s.fermee = f; s.pv = g.pv;
          }
          if(partieFinie) break;
        }
      } finally { Object.assign(window, origIA); }
      V('ordinateur ' + P.nom + ' : jamais de galerie fermée visée, ordonnée ni touchée', !B.erreur && B.fonctionsFermee === 0 && B.viseesFermee === 0 && B.ordresFermee === 0
        && B.degatsFermee === 0 && B.tirs > 0, Object.assign({temps:Math.round(temps), galeries:gals.map(g => g.type + (g.mort ? ' (détruite)' : ''))}, B, {degatsOuverte:Math.round(B.degatsOuverte)}));
    }
  }
}
window.testerGaleries = testerGaleries;

// ---------------------------------------------------------------------
//  Défense antimissile, lot A (19 novembre 2026, cahier § 11.4 et 11.7) : parties d'ordinateurs mesurées, séries
//  « avec ou sans la défense de l'ordinateur », et essais automatiques des règles (testerDefense). Outils de
//  mesure seulement : rien ici ne change le comportement des outils plus haut.
// ---------------------------------------------------------------------
// L'ordinateur sans sa défense antimissile, le temps de fn (IA_DEFENSE vidé puis remis) : pour mesurer ce que
// l'ajout change, galeries cochées dans les deux cas.
function sansDefenseIA(fn){
  const copie = Object.assign({}, IA_DEFENSE);
  for(const k of Object.keys(IA_DEFENSE)) delete IA_DEFENSE[k];
  try { return fn(); } finally { Object.assign(IA_DEFENSE, copie); }
}
window.sansDefenseIA = sansDefenseIA;
// Une partie d'ordinateurs, option cochée, rejouable (graine et prochainId fixés), avec relevé par camp : galerie
// (chantier, tirs), défense (chantiers datés de la batterie et des radars, munitions commandées, intercepteurs tirés
// et réussis), triche (écart inexpliqué / unités sans commande / réserves finales), réserves minimales ; et les
// fautes : une batterie posée par un ordinateur avant qu'aucune galerie hostile n'ait existé (il ne peut pas le
// savoir), une munition commandée au-delà du stock visé, une défense chez Facile.
// opts : {sansDefense:true} (l'ordinateur ne bâtit pas de défense). Ex. : partieDefense('DH-DK', 25, 900).
function partieDefense(nom, graine, duree, opts){
  opts = opts || {};
  const liste = typeof nom === 'string' ? AFFRONTEMENTS_GALERIES[nom] : nom;
  const eff = window.effet, cb = window.construireBatiment, mj = window.miseAJour, cm = window.commanderMunition;
  const S = {inter:{}, missiles:{}, defense:{}, munitions:{}, vu:{}, resMin:{}, fautes:[]};
  const faute = t => { if(S.fautes.length < 10) S.fautes.push('t=' + Math.round(temps) + ' ' + t); };
  const camp = id => S.defense[id] || (S.defense[id] = {parasol:[], radar:[]});
  window.effet = function(type, p){
    if(type === 'intercepteur'){ const k = S.inter[p.camp] || (S.inter[p.camp] = {tires:0, reussis:0}); k.tires++; if(p.reussi) k.reussis++; }
    if(type === 'missile' && p.galerie) S.missiles[p.camp] = (S.missiles[p.camp] || 0) + 1;
    return eff.apply(this, arguments);
  };
  window.construireBatiment = function(id, type){
    const b = cb.apply(this, arguments);
    if(b && BATIMENTS[type].galerie) for(const v of campsEnJeu()) if(hostile(id, v)) S.vu[v] = true;
    if(b && BATIMENTS[type].defense){
      camp(id)[type].push(Math.round(temps));
      if(type === 'parasol' && !S.vu[id]) faute(id + ' bâtit une batterie sans avoir vu de galerie hostile');
      if(niveauIA(id) === 'facile') faute(id + ' (Facile) bâtit ' + type);
    }
    return b;
  };
  window.commanderMunition = function(b){
    const avant = b && b.para ? b.para.stock + b.para.fab : 0, R = b && reglagesDefenseIA(b.camp);
    const ok = cm.apply(this, arguments);
    if(ok){ S.munitions[b.camp] = (S.munitions[b.camp] || 0) + 1; if(R && avant >= R.stockVise) faute(b.camp + ' commande une munition au-delà du stock visé'); }
    return ok;
  };
  window.miseAJour = function(){
    const r = mj.apply(this, arguments);
    for(const id of campsEnJeu()){ const v = camps[id].reserves; if(!(id in S.resMin) || v < S.resMin[id]) S.resMin[id] = v; }
    return r;
  };
  let r, vainqueur;
  try {
    const jouer = () => partieRejouable(() => avecGraine(graine, () => partieGaleries(liste, duree || 900)));
    r = opts.sansDefense ? sansDefenseIA(jouer) : jouer();
    vainqueur = vainqueurSerie(r);
  } finally { window.effet = eff; window.construireBatiment = cb; window.miseAJour = mj; window.commanderMunition = cm; }
  const campsR = {};
  for(const id of Object.keys(r.galeries)){
    const g = r.galeries[id], d = S.defense[id] || {parasol:[], radar:[]};
    campsR[id] = {niveau:g.niveau, faction:g.faction, galerie:g.chantier == null ? null : g.chantier, tirs:g.tirs.length,
      parasol:d.parasol, radars:d.radar, munitions:S.munitions[id] || 0, intercepteurs:S.inter[id] || {tires:0, reussis:0},
      missilesTires:S.missiles[id] || 0, triche:r.triche[id], resMin:Math.round(S.resMin[id])};
  }
  return {nom:typeof nom === 'string' ? nom : 'liste', graine, duree:duree || 900, sansDefense:!!opts.sansDefense, fin:r.temps, vainqueur,
    erreur:r.erreur, camps:campsR, fautes:S.fautes};
}
window.partieDefense = partieDefense;
// Ligne courte d'une partie de partieDefense (lecture rapide).
function ligneDefense(p){
  return p.nom + ' g' + p.graine + (p.sansDefense ? ' (sans défense)' : '') + ' | ' + p.fin + ' s ' + (p.vainqueur || '—') + (p.erreur ? ' ERREUR ' + p.erreur : '') + ' | ' +
    Object.entries(p.camps).map(([id, c]) => id + ' ' + c.niveau.slice(0, 4) + ' ' + c.faction.slice(0, 1).toUpperCase() + ' gal ' + (c.galerie == null ? '—' : c.galerie) +
      ' tirs ' + c.tirs + ' para ' + (c.parasol.join('/') || '—') + ' rad ' + c.radars.length + ' mun ' + c.munitions + ' int ' + c.intercepteurs.reussis + '/' + c.intercepteurs.tires).join(' ; ') +
    (p.fautes.length ? ' | FAUTES ' + p.fautes.join(' ; ') : '');
}
window.ligneDefense = ligneDefense;
// Série « la défense affaiblit-elle l'ordinateur ? » : pour chaque affrontement et chaque graine, trois parties de
// même graine : option décochée (reprise de SANS_GALERIES si elle a déjà été jouée), galeries cochées sans la
// défense de l'ordinateur, puis avec. Par morceaux synchrones (une partie par travail), comme
// preparerSeriesGaleries : preparerSerieDefense('d', ['DH-NK', 'DH-DK', 'UH-DK'], [1,2,3,4,5], 900), puis
// avancerSerieDefense('d', 30000) jusqu'à reste 0 ; RESULTATS.d.bilan.
function preparerSerieDefense(cle, noms, graines, duree){
  const travaux = [];
  for(const n of noms) for(const g of graines) for(const v of ['decochee', 'sansDefense', 'avecDefense']) travaux.push([n, g, v]);
  RESULTATS[cle] = {etat:'en cours', duree:duree || 900, travaux, faits:0, total:travaux.length, parties:{}, lignes:[], bilan:null};
  return travaux.length + ' parties à jouer';
}
window.preparerSerieDefense = preparerSerieDefense;
function avancerSerieDefense(cle, limite){
  const R = RESULTATS[cle], t0 = performance.now();
  while(R.travaux.length && performance.now() - t0 < (limite || 30000)){
    const [n, g, v] = R.travaux[0], k = n + ':' + g, P = R.parties[k] || (R.parties[k] = {nom:n, graine:g});
    if(v === 'decochee'){
      const c = n + ':' + g + ':' + R.duree;
      if(!SANS_GALERIES[c]){
        const avant = optionGaleries; optionGaleries = false;
        try { const r = partieRejouable(() => avecGraine(g, () => partieOrdinateurs(AFFRONTEMENTS_GALERIES[n], R.duree))); SANS_GALERIES[c] = {fin:r.temps, vainqueur:vainqueurSerie(r), erreur:r.erreur}; }
        finally { optionGaleries = avant; }
      }
      P.decochee = SANS_GALERIES[c];
    } else {
      P[v] = partieDefense(n, g, R.duree, {sansDefense:v === 'sansDefense'});
      R.lignes.push(ligneDefense(P[v]));
    }
    R.travaux.shift(); R.faits++;
  }
  if(!R.travaux.length){ R.bilan = bilanDefense(Object.values(R.parties), R.duree); R.etat = 'fini'; }
  return {reste:R.travaux.length, faits:R.faits};
}
window.avancerSerieDefense = avancerSerieDefense;
// Bilan d'une série : pour chaque variante cochée (sans, avec la défense de l'ordinateur), parmi les parties terminées
// option décochée, part encore terminée, part au même vainqueur, durée médiane (non terminée : durée maximale) ; et,
// directement entre « sans défense » et « avec » : même vainqueur, durées médianes ; puis l'usage de la défense
// (camps qui bâtissent la batterie, radars, munitions, intercepteurs tirés et réussis) et les fautes.
function bilanDefense(parties, duree){
  duree = duree || 900;
  parties = parties.filter(p => p.decochee && p.sansDefense && p.avecDefense);
  const base = parties.filter(p => p.decochee.vainqueur), fin = p => p.vainqueur ? p.fin : duree;
  const variante = v => {
    const termine = base.filter(p => p[v].vainqueur).length, meme = base.filter(p => p[v].vainqueur === p.decochee.vainqueur).length;
    return {encoreTermines:termine + ' / ' + base.length, memeVainqueur:meme + ' / ' + base.length, mediane:medianeSerie(base.map(p => fin(p[v])))};
  };
  const ab = {memeVainqueur:parties.filter(p => p.sansDefense.vainqueur === p.avecDefense.vainqueur).length + ' / ' + parties.length,
    medianeSans:medianeSerie(parties.map(p => fin(p.sansDefense))), medianeAvec:medianeSerie(parties.map(p => fin(p.avecDefense))),
    terminesSans:parties.filter(p => p.sansDefense.vainqueur).length, terminesAvec:parties.filter(p => p.avecDefense.vainqueur).length};
  const usage = {campsMenaces:0, batteries:0, radars:0, munitions:0, intercepteurs:0, abattus:0, missilesTires:0};
  const fautes = [];
  for(const p of parties){
    const A = p.avecDefense;
    if(A.erreur || p.sansDefense.erreur || p.decochee.erreur) fautes.push(p.nom + ' g' + p.graine + ' erreur ' + (A.erreur || p.sansDefense.erreur || p.decochee.erreur));
    for(const f of A.fautes) fautes.push(p.nom + ' g' + p.graine + ' ' + f);
    for(const [id, c] of Object.entries(A.camps)){
      if(!/^0 \/ 0 \//.test(c.triche) || c.resMin < 0) fautes.push(p.nom + ' g' + p.graine + ' ' + id + ' triche ' + c.triche + ', réserves min ' + c.resMin);
      usage.missilesTires += c.missilesTires;
      const menace = Object.entries(A.camps).some(([k, d]) => k !== id && hostile(id, k) && d.galerie != null);
      if(menace && c.niveau !== 'facile') usage.campsMenaces++;
      if(c.parasol.length) usage.batteries++;
      usage.radars += c.radars.length; usage.munitions += c.munitions; usage.intercepteurs += c.intercepteurs.tires; usage.abattus += c.intercepteurs.reussis;
    }
  }
  return {parties:parties.length, terminesDecochee:base.length, galeriesSansDefense:variante('sansDefense'), galeriesAvecDefense:variante('avecDefense'),
    sansContreAvec:ab, usage, fautes};
}
window.bilanDefense = bilanDefense;

// Essais automatiques des règles de la défense antimissile (cahier § 11.7). À lancer depuis front-de-sel.html?verif :
//   avecGraine(7, () => testerDefense())   → règles (construction … option décochée) et ordinateur en scène courte
//   testerDefense('parties', 0)            → partie d'ordinateurs n° 0, 1 ou 2 de 900 s, graine fixée par partie
//                                            (sans numéro : les trois ; tache('d', () => testerDefense('parties')))
// Renvoie une liste de verdicts {nom, ok, detail}. L'option est cochée pendant l'essai puis remise dans son état
// d'avant ; chaque scène repart d'une partie neuve.
function testerDefense(quoi, numero){
  if(MISSION) return [{nom:'page', ok:false, detail:'testerDefense se lance depuis la page d’escarmouche (?verif), pas depuis une mission'}];
  window.enregistrerVictoire = () => {};
  const verdicts = [];
  const V = (nom, ok, detail) => { verdicts.push({nom, ok:!!ok, detail:typeof detail === 'string' ? detail : JSON.stringify(detail)}); };
  const DT = 0.05, EPS = 0.11;
  const pas = s => { for(let k = 0; k < Math.round(s/DT); k++) miseAJour(DT); };
  const jusqua = (cond, max) => { const t0 = temps; while(temps - t0 < max){ miseAJour(DT); if(cond()) return temps - t0; } return null; };
  const r1 = v => Math.round(v*10)/10, r2 = v => Math.round(v*100)/100;
  const qg = id => ents.find(e => e.camp === id && e.type === 'qg' && !e.mort);
  // Scène : J Halden et K Halden alliés (équipe A), I Karsk (équipe B) ; ordinateurs arrêtés, seuls les QG restent.
  const scene = () => {
    reinitialiserPartie();
    demarrer('halden', configTest('halden', '2c1'));
    tableRase();
    for(const id of campsEnJeu()){ camps[id].reserves = 20000; camps[id].points = 0; camps[id].recharges = {}; }
  };
  const poser = (type, id, pres) => { const p = trouverEmplacement(type, pres || qg(id)); return p ? creerBatiment(type, id, p.c, p.r, true) : null; };
  const unite = (type, id, x, y) => { const p = pointLibre(x, y); return creerUnite(type, id, p.x, p.y); };
  const versCentre = (id, d) => { const q = qg(id), a = Math.atan2(HAUT/2 - q.y, LARG/2 - q.x); return pointLibre(q.x + Math.cos(a)*d, q.y + Math.sin(a)*d); };
  // Espions (remis en place à la fin) : effets créés (avec l'objet rendu), explosions de zone, messages par camp ;
  // chances forcées par camp (forcees[camp] = 0 ou 100) pour rendre l'issue certaine.
  const orig = {effet:window.effet, explosionZone:window.explosionZone, chancesInterception:window.chancesInterception};
  const ecouteurAvant = ecouteurNotifications;
  let journal = null, forcees = {};
  const ecouter = () => { journal = {effets:[], zones:[], messages:[]}; };
  window.effet = function(type, p){ const f = orig.effet.apply(this, arguments); if(journal) journal.effets.push({type, t:temps, p, f}); return f; };
  window.explosionZone = function(x, y, r, deg, arme){ if(journal) journal.zones.push({t:temps, x, y, arme}); return orig.explosionZone.apply(this, arguments); };
  window.chancesInterception = function(camp){ return camp in forcees ? forcees[camp] : orig.chancesInterception.apply(this, arguments); };
  const optAvant = optionGaleries, reseauAvant = modeReseau, roleAvant = roleMonde;
  try {
    optionGaleries = true;
    ecouteurNotifications = (camp, texte) => { if(journal) journal.messages.push({camp, texte}); };
    if(quoi === 'parties') essaisParties();
    else { essaisRegles(); essaisCycles(); essaisOrdinateur(); essaisOption(); }
  } catch(err){
    V('exécution de l’essai', false, 'ERREUR t=' + (typeof temps === 'number' ? temps.toFixed(2) : '?') + ' ' + err.message + ' | ' + String(err.stack || '').split('\n').slice(1, 3).join(' | '));
  } finally {
    Object.assign(window, orig);
    ecouteurNotifications = ecouteurAvant;
    optionGaleries = optAvant; modeReseau = reseauAvant; roleMonde = roleAvant;
  }
  return verdicts;

  // ----------------------------------------------------------------- construction, limites, munitions, chances
  function essaisRegles(){
    // 1. Construction et limites, pour les deux factions.
    scene();
    for(const id of ['J', 'I']){
      const q = qg(id);
      // Un ouvrier par chantier (un ouvrier qui reçoit un nouvel ordre abandonne le chantier précédent).
      const ordre = (type, pres) => { const p = trouverEmplacement(type, pres || q), o = unite(faction(id).ouvrier, id, q.x, q.y + 110);
        return {type:'construire', bat:type, c:p.c, r:p.r, ouvrierIds:[o.id]}; };
      const liste = batimentsConstructibles(faction(id));
      const rSans = executerOrdre(id, ordre('parasol'));
      V('construction ' + id + ' : batterie et radar dans la liste ; sans usine → refus', liste.includes('parasol') && liste.includes('radar') && !rSans.ok && /Nécessite/.test(rSans.motif || ''), {motif:rSans.motif});
      poser('usine', id, {x:q.x, y:q.y - 220});
      const r0 = camps[id].reserves, rOk = executerOrdre(id, ordre('parasol')), b = rOk.ok ? entiteParId(rOk.id) : null;
      V('construction ' + id + ' : batterie acceptée avec usine, 600 payés', rOk.ok && b && b.enCours && r0 - camps[id].reserves === 600 && b.para && b.para.stock === 0 && b.para.fab === 0,
        {ok:rOk.ok, motif:rOk.motif, paye:r0 - camps[id].reserves});
      const rDeux = executerOrdre(id, ordre('parasol', {x:q.x + 300, y:q.y + 250}));
      V('construction ' + id + ' : seconde batterie pendant le chantier → refus', !rDeux.ok && rDeux.motif === MOTIFS_LIMITE_DEFENSE.parasol, {motif:rDeux.motif});
      const radars = [], r1r = camps[id].reserves;
      for(const [dx, dy] of [[-260, 0], [260, 0], [0, 260], [0, -400]]){
        const r = executerOrdre(id, ordre('radar', {x:q.x + dx, y:q.y + dy})); radars.push(r.ok ? 'accepté' : r.motif);
      }
      V('construction ' + id + ' : trois radars acceptés (250 pièce), le quatrième refusé', radars.slice(0, 3).every(x => x === 'accepté') && radars[3] === MOTIFS_LIMITE_DEFENSE.radar && r1r - camps[id].reserves === 750,
        {radars, paye:r1r - camps[id].reserves});
      const fini = jusqua(() => !ents.some(e => e.camp === id && e.def.defense && e.enCours && !e.mort), 400);
      const rTrois = executerOrdre(id, ordre('parasol', {x:q.x - 300, y:q.y + 250}));
      V('construction ' + id + ' : chantiers terminés (900 et 350 PV), seconde batterie toujours refusée', fini !== null && Math.abs(b.pv - 900) < 0.5 && !rTrois.ok && rTrois.motif === MOTIFS_LIMITE_DEFENSE.parasol
        && ents.filter(e => e.camp === id && estRadar(e) && !e.mort).every(e => Math.abs(e.pv - 350) < 0.5), {fini:fini === null ? 'non' : r1(fini), motif:rTrois.motif});
    }

    // 2. Munitions : prix, plafond de 4, une à la fois en 30 s, réserves, chantier.
    scene();
    {
      const b = poser('parasol', 'J'), D = b.def.defense, ordre = () => executerOrdre('J', {type:'fabriquerMunition', id:b.id});
      const r0 = camps.J.reserves, a = ordre();
      V('munitions : 120 payés à l’ordre, fabrication 30 s', a.ok && r0 - camps.J.reserves === 120 && b.para.fab === 1 && b.para.fabT === 30, {paye:r0 - camps.J.reserves, fab:b.para.fab, fabT:b.para.fabT});
      const l = [ordre(), ordre(), ordre(), ordre()];
      V('munitions : quatre au plus, prêtes ou en fabrication', l[0].ok && l[1].ok && l[2].ok && !l[3].ok && l[3].motif === MOTIF_MUNITIONS_PLEINES && b.para.fab === 4, {fab:b.para.fab, motif:l[3].motif});
      const prets = [], t0 = temps;
      for(let k = 0; k < Math.round(125/DT); k++){ miseAJour(DT); while(prets.length < b.para.stock) prets.push(r1(temps - t0)); }
      V('munitions : une à la fois, prêtes à 30, 60, 90 et 120 s', prets.length === 4 && [30, 60, 90, 120].every((v, i) => Math.abs(prets[i] - v) <= EPS), {prets});
      camps.J.reserves = 100; b.para.stock = 0;
      const rr = ordre();
      V('munitions : réserves insuffisantes → refus, rien de prélevé', !rr.ok && rr.code === 'reserves' && camps.J.reserves === 100 && b.para.fab === 0, {motif:rr.motif, code:rr.code});
      camps.J.reserves = 20000;
      const p = trouverEmplacement('parasol', qg('K')), bk = creerBatiment('parasol', 'K', p.c, p.r, false);
      const rc = executerOrdre('K', {type:'fabriquerMunition', id:bk.id}), rAutre = executerOrdre('I', {type:'fabriquerMunition', id:b.id});
      V('munitions : refus pour une batterie en chantier et pour la batterie d’un autre camp', !rc.ok && !rAutre.ok && b.para.fab === 0, {chantier:rc.motif, autreCamp:rAutre.motif});
    }

    // 3. Chances : 25, 42, 58 et 75 % selon les radars (fonction pure), puis 2 000 tirages à graine fixe par palier.
    {
      const attendu = [25, 25 + 50/3, 25 + 100/3, 75];
      V('chances : 25, 41,7, 58,3, 75 % selon 0 à 3 radars, jamais plus de 75', [0, 1, 2, 3].every(n => Math.abs(chancesDepuisRadars(n) - attendu[n]) < 1e-9) && chancesDepuisRadars(5) === 75,
        [0, 1, 2, 3, 5].map(chancesDepuisRadars).map(r2));
      const mesures = [];
      for(let n = 0; n <= 3; n++){
        scene();
        const b = poser('parasol', 'J'), gI = poser('terrier', 'I');
        for(let k = 0; k < n; k++) poser('radar', 'J', {x:qg('J').x + (k - 1)*240, y:qg('J').y + 260});
        gI.gal.t0 = temps; gI.gal.n = 1; gI.gal.tires = 0;
        proposerInterceptions(gI);
        repondreInterception('J', true);
        const tir = chancesInterception('J');
        let abattus = 0;
        avecGraine(1000 + n, () => { for(let k = 0; k < 2000; k++){ b.para.stock = 1; if(tenterInterceptions(gI, b.x, b.y, {}, {}, DT)) abattus++; } });
        mesures.push({radars:n, attendu:r1(attendu[n]), chancesDuCamp:r1(tir), mesure:r1(abattus/20)});
      }
      V('chances : 2 000 tirages par palier (0 à 3 radars) à ±3 points', mesures.every(m => Math.abs(m.mesure - m.attendu) <= 3 && Math.abs(m.chancesDuCamp - m.attendu) < 0.1), mesures);
      // Radars qui ne comptent pas : en chantier, détruit, ou d'un allié.
      scene();
      poser('parasol', 'J');
      const ra = poser('radar', 'J', {x:qg('J').x - 260, y:qg('J').y}), rb = poser('radar', 'J', {x:qg('J').x + 260, y:qg('J').y});
      const pc = trouverEmplacement('radar', {x:qg('J').x, y:qg('J').y + 260}); creerBatiment('radar', 'J', pc.c, pc.r, false);
      poser('radar', 'K');
      const avant = chancesInterception('J');
      rb.mort = true;
      const apres = chancesInterception('J');
      V('chances : radars en chantier, détruits ou alliés non comptés', Math.abs(avant - (25 + 100/3)) < 1e-9 && Math.abs(apres - (25 + 50/3)) < 1e-9 && radarsActifs('J') === 1,
        {deuxFinisUnChantierUnAllie:r1(avant), apresUnDetruit:r1(apres), radarsActifs:radarsActifs('J')});
      void ra;
    }
  }

  // ----------------------------------------------------------------- cycles de tir complets
  // I (Karsk, Terrier) tire sur le QG de J ; J a sa batterie près de son QG. Relevés : proposition, réponses,
  // intercepteurs, impacts, issues lues par l'interface et messages, datés depuis l'ordre de tir.
  function essaisCycles(){
    const prepa = (stockJ, missiles) => {
      scene();
      const bJ = poser('parasol', 'J'), gI = poser('terrier', 'I');
      bJ.para.stock = stockJ; gI.gal.stock = missiles;
      return {bJ, gI, cible:qg('J')};
    };
    // Cycle : ordre de tir de I sur (x, y), réponse de J (undefined : aucune), 17,6 s de jeu ; pendant(t) appelée
    // à chaque pas.
    const cycle = (gI, x, y, reponse, pendant) => {
      ecouter();
      const ordre = executerOrdre('I', {type:'tirGalerie', id:gI.id, x, y}), t0 = temps;
      const p0 = propositionEnCours('J');
      const rep = reponse === undefined ? null : executerOrdre('J', {type:'repondreInterception', oui:reponse});
      const issues = [], A = {};
      for(let k = 0; k < Math.round(17.6/DT); k++){
        miseAJour(DT);
        const t = temps - t0;
        if(pendant) pendant(t, A);
        const r = resultatInterception('J'), is = r ? r.issue : null;
        if(!issues.length || issues[issues.length - 1][1] !== is) issues.push([r2(t), is]);
      }
      const rel = l => l.map(e => r2(e.t - t0));
      return {ordre, p0, rep, A, issues,
        impacts:rel(journal.zones.filter(z => z.arme === 'missileGalerie')),
        inter:journal.effets.filter(e => e.type === 'intercepteur').map(e => ({t:r2(e.t - t0), camp:e.p.camp, duree:e.p.duree, reussi:e.p.reussi})),
        missiles:journal.effets.filter(e => e.type === 'missile' && e.p.galerie).map(e => e.f),
        marqueurs:journal.effets.filter(e => e.type === 'marqueur' && e.p.pouvoir === 'galerie').map(e => e.f),
        msg:(camp, re) => journal.messages.filter(m => m.camp === camp && re.test(m.texte)).length};
    };
    const issueA = (c, t) => { let v = null; for(const [ti, is] of c.issues) if(ti <= t + 1e-6) v = is; return v; };

    // A. Réussite (chances forcées à 100 %).
    {
      const {bJ, gI, cible} = prepa(2, 1);
      forcees = {J:100};
      // (Le marqueur est relevé juste avant et juste après la rencontre : à la fin du cycle, il aurait expiré de toute façon.)
      const marqueur = () => { const m = journal.effets.find(e => e.type === 'marqueur' && e.p.pouvoir === 'galerie'); return m ? m.f.vie : null; };
      const pvQG = cible.pv, c = cycle(gI, cible.x, cible.y, true, (t, A) => {
        if(A.stock95 == null && t >= 9.6) A.stock95 = bJ.para.stock;
        if(A.vieAvant == null && t >= 12.3) A.vieAvant = marqueur();
        if(A.vieApres == null && t >= 12.7) A.vieApres = marqueur();
      });
      forcees = {};
      V('réussite : proposition à l’ordre de tir (sans réponse, 1 missile, 25 % sans radar), réponse acceptée',
        c.ordre.ok && c.p0 && c.p0.reponse === null && c.p0.n === 1 && c.p0.radars === 0 && orig.chancesInterception('J') === 25 && c.rep && c.rep.ok, {p0:c.p0, rep:c.rep});
      V('réussite : un intercepteur au départ (9,5 s, rencontre à 3 s), une munition dépensée, b.intT posé', c.inter.length === 1 && Math.abs(c.inter[0].t - 9.5) <= EPS && c.inter[0].duree === 3
        && c.inter[0].reussi === true && c.A.stock95 === 1 && bJ.para.stock === 1 && typeof bJ.intT === 'number', {inter:c.inter, stock:bJ.para.stock, intT:bJ.intT});
      V('réussite : missile abattu (abattuA = 3), aucun impact, QG intact, marqueur effacé', c.missiles.length === 1 && c.missiles[0].abattuA === 3 && c.impacts.length === 0
        && cible.pv === pvQG && c.marqueurs.length === 1 && c.A.vieAvant > 1 && c.A.vieApres <= 0,
        {abattuA:c.missiles.map(m => m.abattuA), impacts:c.impacts, marqueur:[c.A.vieAvant, c.A.vieApres].map(v => v == null ? v : r2(v))});
      V('réussite : issue « en vol » puis « réussie » à la rencontre (12,5 s) ; messages au défenseur et au tireur', issueA(c, 12.4) === 'enVol' && issueA(c, 12.7) === 'reussie'
        && c.msg('J', /Interception réussie/) === 1 && c.msg('I', /Missile intercepté/) === 1, {issues:c.issues});
    }
    // B. Échec (0 %).
    {
      const {bJ, gI, cible} = prepa(2, 1);
      forcees = {J:0};
      const pvQG = cible.pv, c = cycle(gI, cible.x, cible.y, true);
      forcees = {};
      V('échec : intercepteur tiré, munition dépensée, impact à 14,5 s, QG touché, « manquée »', c.inter.length === 1 && c.inter[0].reussi === false && bJ.para.stock === 1
        && c.impacts.length === 1 && Math.abs(c.impacts[0] - 14.5) <= EPS && cible.pv < pvQG && issueA(c, 12.7) === 'manquee' && c.msg('J', /Interception manquée/) === 1 && c.msg('I', /intercepté/) === 0,
        {inter:c.inter, impacts:c.impacts, issues:c.issues});
    }
    // C. Hors zone : point d'impact à plus de 560 px (plus la dispersion) de la batterie.
    {
      const {bJ, gI} = prepa(2, 1), p = versCentre('J', 950);
      const loin = Math.hypot(p.x - bJ.x, p.y - bJ.y);
      const c = cycle(gI, p.x, p.y, true);
      V('hors zone : rien de tiré ni dépensé, l’impact a lieu, issue « horsZone »', loin > 560 + 45 && c.inter.length === 0 && bJ.para.stock === 2 && c.impacts.length === 1
        && issueA(c, 10) === 'horsZone' && c.msg('J', /hors de la zone/) === 1, {distance:Math.round(loin), impacts:c.impacts, issues:c.issues});
    }
    // D. Sans autorisation (aucune réponse), puis « laisser passer ».
    for(const reponse of [undefined, false]){
      const {bJ, gI, cible} = prepa(2, 1), c = cycle(gI, cible.x, cible.y, reponse);
      V('sans autorisation (' + (reponse === undefined ? 'aucune réponse' : 'laisser passer') + ') : rien de tiré ni dépensé, l’impact a lieu', c.inter.length === 0 && bJ.para.stock === 2
        && c.impacts.length === 1 && c.issues.every(([, is]) => is === null) && (reponse === undefined || (c.rep && c.rep.ok)), {impacts:c.impacts, rep:c.rep});
    }
    // E. Sans munition.
    {
      const {gI, cible} = prepa(0, 1), c = cycle(gI, cible.x, cible.y, true);
      V('sans munition : réponse acceptée, rien de tiré, l’impact a lieu, issue « sansMunition »', c.rep && c.rep.ok && c.inter.length === 0 && c.impacts.length === 1
        && issueA(c, 10) === 'sansMunition' && c.msg('J', /Aucune munition prête/) === 1, {impacts:c.impacts, issues:c.issues});
    }
    // F. Salve de deux missiles : deux munitions → deux tirs ; une seule → un sur deux.
    {
      const {bJ, gI, cible} = prepa(2, 2);
      forcees = {J:100};
      const c = cycle(gI, cible.x, cible.y, true);
      forcees = {};
      const r = resultatInterception('J');
      V('salve : deux munitions, deux intercepteurs (9,5 et 10,1 s), aucun impact, « réussie »', c.p0.n === 2 && c.inter.length === 2 && Math.abs(c.inter[1].t - 10.1) <= EPS && bJ.para.stock === 0
        && c.impacts.length === 0 && issueA(c, 13.2) === 'reussie', {inter:c.inter, issues:c.issues, r});
      const P = prepa(1, 2);
      forcees = {J:100};
      const c2 = cycle(P.gI, P.cible.x, P.cible.y, true);
      forcees = {};
      V('salve : une seule munition, un abattu sur deux, un impact (15,1 s), « partielle »', c2.inter.length === 1 && P.bJ.para.stock === 0 && c2.impacts.length === 1
        && Math.abs(c2.impacts[0] - 15.1) <= EPS && issueA(c2, 13.2) === 'partielle', {inter:c2.inter, impacts:c2.impacts, issues:c2.issues});
    }
    // Corrections du 20 novembre 2026 (constats du contrôle du lot A).
    {
      // Salve : le caisson ne retombe pas au second tir (b.intT reste l'heure du premier).
      const {bJ, gI, cible} = prepa(2, 2);
      forcees = {J:100};
      const c = cycle(gI, cible.x, cible.y, true, (t, A) => { if(t >= 10.3 && A.intT === undefined) A.intT = r2(bJ.intT - (temps - t)); });
      forcees = {};
      V('salve : le caisson reste levé au second tir (b.intT garde l’heure du premier, 9,5 s)', c.inter.length === 2 && Math.abs(c.A.intT - 9.5) <= EPS, {intT:c.A.intT, inter:c.inter});
    }
    {
      // Deux galeries adverses à la suite : deux propositions ouvertes, I et L valent pour toutes.
      const {bJ, gI, cible} = prepa(4, 1), g2 = poser('terrier', 'I', {x:gI.x, y:gI.y + 240});
      g2.gal.stock = 1;
      const o1 = executerOrdre('I', {type:'tirGalerie', id:gI.id, x:cible.x, y:cible.y});
      for(let k = 0; k < Math.round(2/DT); k++) miseAJour(DT);
      const o2 = executerOrdre('I', {type:'tirGalerie', id:g2.id, x:cible.x, y:cible.y});
      FENETRE_DEFENSE.fermees = {};
      const p = propositionEnCours('J', FENETRE_DEFENSE.fermees), props = () => Object.values(camps.J.interception.propositions).map(q => q.reponse);
      const local = campLocal() === 'J';
      let apresI = null, apresAnnuler = null, apresL = null, restante = undefined, titre = '';
      if(local){
        majFenetreDefense(); titre = (el('defense').querySelector('.titre') || {}).textContent || '';
        toucheDefense('i'); apresI = props();
        toucheDefense('l'); apresAnnuler = props();
        toucheDefense('l'); apresL = props(); restante = propositionEnCours('J', FENETRE_DEFENSE.fermees);
        FENETRE_DEFENSE.fermees = {}; majFenetreDefense();
      }
      V('deux galeries à la suite : deux propositions ouvertes, la fenêtre le dit, I autorise les deux, L annule les deux puis les ferme',
        o1.ok && o2.ok && p && p.ouvertes === 2 && p.cles.length === 2 && p.galerie === gI.id && local && /2 galeries/.test(titre)
        && apresI.every(x => x === true) && apresAnnuler.every(x => x === false) && apresL.every(x => x === false) && restante === null,
        {ordres:[o1.ok || o1.motif, o2.ok || o2.motif], ouvertes:p && p.ouvertes, local, titre, apresI, apresAnnuler, apresL, restante:restante === null ? null : 'encore ouverte'});
    }
    {
      // J sans munition, K (allié) abat : J ne lit pas « un impact », mais « réussie » (abattu par un allié).
      const {bJ, gI, cible} = prepa(0, 1), bK = poser('parasol', 'K', {x:cible.x, y:cible.y + 200});
      bK.para.stock = 2;
      forcees = {J:100, K:100};
      const c = cycle(gI, cible.x, cible.y, true);
      forcees = {};
      const rJ = Object.values(camps.J.interception.resultats)[0] || null;
      V('alliés : J sans munition, K abat au départ ; J compte le missile abattu par un allié (« réussie », pas « sans munition »)',
        c.inter.length === 1 && c.inter[0].camp === 'K' && c.inter[0].t === 9.5 && c.impacts.length === 0 && rJ && rJ.sansMunition === 0 && rJ.parAllie === 1 && issueA(c, 13.2) === 'reussie',
        {inter:c.inter, rJ, issues:c.issues});
    }
    {
      // Pas de temps irrégulier (jeu réel) : le tour de l'allié arrive un peu après 3 s de vol, il doit tirer quand même.
      const {bJ, gI, cible} = prepa(2, 1), bK = poser('parasol', 'K', {x:cible.x, y:cible.y + 200});
      bK.para.stock = 2;
      forcees = {J:0, K:100};
      ecouter();
      executerOrdre('I', {type:'tirGalerie', id:gI.id, x:cible.x, y:cible.y}); executerOrdre('J', {type:'repondreInterception', oui:true});
      const t0 = temps; let k = 0;
      while(temps - t0 < 17.6) miseAJour([0.016, 0.031, 0.05, 0.021][k++ % 4]);
      forcees = {};
      const inter = journal.effets.filter(e => e.type === 'intercepteur').map(e => ({t:r2(e.t - t0), camp:e.p.camp, duree:r2(e.p.duree)}));
      const impacts = journal.zones.filter(z => z.arme === 'missileGalerie').length;
      V('alliés, pas de temps irrégulier : K tire quand même après la rencontre manquée de J, et abat',
        inter.length === 2 && inter[1].camp === 'K' && inter[1].t >= 12.4 && inter[1].t <= 12.7 && impacts === 0 && bK.para.stock === 1, {inter, impacts, stockK:bK.para.stock});
    }
    {
      // Radar perdu : attente, puis deux reconstructions au plus (fonction de lecture radarPermisIA).
      const t = temps;
      V('ordinateur : radar perdu → pas de reconstruction avant 60 s, plus aucune après la troisième perte',
        radarPermisIA({}) && !radarPermisIA({radarsPerdus:[{x:0, y:0, t:t - 10}]}) && radarPermisIA({radarsPerdus:[{x:0, y:0, t:t - 61}]})
        && radarPermisIA({radarsPerdus:[{t:t - 300}, {t:t - 61}]}) && !radarPermisIA({radarsPerdus:[{t:t - 300}, {t:t - 200}, {t:t - 100}]}), {});
    }
    // G. Batterie détruite avant le départ.
    {
      const {bJ, gI, cible} = prepa(2, 1), tueur = unite('lynx', 'I', bJ.x + 150, bJ.y);
      const c = cycle(gI, cible.x, cible.y, true, (t, A) => { if(t >= 5 && !A.fait){ A.fait = true; infliger(bJ, 1e6, tueur); A.prop = null; } if(A.fait && t > 5.2 && A.prop === null) A.prop = propositionEnCours('J'); });
      V('batterie détruite avant le départ : aucun tir, l’impact a lieu, plus de proposition', bJ.mort && c.inter.length === 0 && c.impacts.length === 1 && c.A.prop === null, {mort:bJ.mort, impacts:c.impacts});
    }
    // H. Galerie détruite pendant son ouverture, avant le départ.
    {
      const {bJ, gI, cible} = prepa(2, 1), tueur = unite('lynx', 'J', gI.x - 150, gI.y);
      const c = cycle(gI, cible.x, cible.y, true, (t, A) => { if(t >= 5 && !A.fait){ A.fait = true; infliger(gI, 1e6, tueur); } if(A.fait && t > 5.2 && A.prop === undefined) A.prop = propositionEnCours('J'); });
      V('galerie détruite avant le départ : aucun missile, aucun tir, munitions intactes, plus de proposition', gI.mort && c.missiles.length === 0 && c.inter.length === 0 && bJ.para.stock === 2
        && c.A.prop === null && resultatInterception('J') === null, {mort:gI.mort, missiles:c.missiles.length, stock:bJ.para.stock});
    }
    // I. Alliés : J et K (ordinateur, qui accepte seul s'il a une munition) couvrent le même point.
    {
      for(const [cJ, cK] of [[0, 100], [100, 0]]){
        const {bJ, gI, cible} = prepa(2, 1), bK = poser('parasol', 'K', {x:cible.x, y:cible.y + 200});
        bK.para.stock = 2;
        forcees = {J:cJ, K:cK};
        const c = cycle(gI, cible.x, cible.y, true, (t, A) => { if(A.repK === undefined){ const E = camps.K.interception; const p = E && Object.values(E.propositions)[0]; A.repK = p ? p.reponse : null; } });
        forcees = {};
        const rJ = c.issues.length ? c.issues[c.issues.length - 1][1] : null;
        const rK = (camps.K.interception && Object.values(camps.K.interception.resultats)[0]) || null;
        if(cJ === 0) V('alliés : J manque, K (son allié) ne tire qu’à la rencontre manquée de J (12,5 s, rencontre 1,5 s plus tard) et abat ; pas d’impact ; J lit « réussie » (abattu par un allié)',
          c.A.repK === true && c.inter.length === 2 && c.inter[0].camp === 'J' && !c.inter[0].reussi && c.inter[1].camp === 'K' && c.inter[1].t === 12.5 && Math.abs(c.inter[1].duree - 1.5) < 1e-6 && c.inter[1].reussi
          && c.impacts.length === 0 && bJ.para.stock === 1 && bK.para.stock === 1 && issueA(c, 12.7) === 'manquee' && issueA(c, 13.2) === 'manquee' && issueA(c, 14.2) === 'reussie' && c.msg('J', /Notre allié a abattu/) === 1,
          {repK:c.A.repK, inter:c.inter, issuesJ:c.issues, stocks:[bJ.para.stock, bK.para.stock]});
        else V('alliés : J abat, K n’a pas à tirer (munition gardée) et compte le missile abattu par son allié',
          c.inter.length === 1 && c.inter[0].camp === 'J' && c.impacts.length === 0 && bK.para.stock === 2 && rK && rK.parAllie === 1 && rJ === 'reussie',
          {inter:c.inter, rK, stockK:bK.para.stock});
      }
      // L'ordinateur sans munition n'autorise pas.
      const {gI, cible} = prepa(2, 1), bK = poser('parasol', 'K', {x:cible.x, y:cible.y + 200});
      bK.para.stock = 0;
      executerOrdre('I', {type:'tirGalerie', id:gI.id, x:cible.x, y:cible.y});
      const pK = Object.values(camps.K.interception.propositions)[0];
      V('ordinateur : sans munition, il n’autorise pas (réponse « non » à l’ordre de tir)', pK && pK.reponse === false, {reponse:pK && pK.reponse});
    }
  }

  // ----------------------------------------------------------------- ordinateur, scène courte
  // I (Difficile) et K (Facile) jouent seuls depuis une base rasée (QG, usine, 20 000 en réserve). Sans galerie
  // hostile : aucune défense. J pose une galerie : I bâtit sa batterie près de son QG, deux radars écartés, commande
  // deux munitions (jamais au-delà), puis autorise d'office l'interception d'un tir de J ; K (Facile) ne fait rien.
  function essaisOrdinateur(){
    scene();
    poser('usine', 'I', {x:qg('I').x, y:qg('I').y - 220}); poser('usine', 'K', {x:qg('K').x, y:qg('K').y - 220});
    confierAOrdinateur('I', 'difficile'); confierAOrdinateur('K', 'facile');
    // (Pas de vague d'assaut : au premier essai, J, réduit à son QG, était éliminé avant la fin de la scène.)
    etatIA('I').premiereVague = Infinity; etatIA('K').premiereVague = Infinity;
    const defenses = id => ents.filter(e => e.camp === id && e.def.defense && !e.mort);
    pas(60);
    const avant = defenses('I').length + defenses('K').length;
    const gJ = poser('aiguille', 'J'), gJpos = {x:gJ.x, y:gJ.y};
    const cm = window.commanderMunition, depasse = [];
    window.commanderMunition = function(b){ const n = b.para.stock + b.para.fab, ok = cm.apply(this, arguments); if(ok && n >= 2) depasse.push(b.camp); return ok; };
    // (20 novembre 2026) L'ordinateur, qui a sa propre galerie à son plan, ne bâtit sa défense qu'après elle, sauf
    // s'il a subi un tir de galerie : 60 s sans tir, rien ; puis J tire un missile au milieu de la carte.
    pas(60);
    const avantTir = defenses('I').length;
    gJ.gal.stock = 1;
    const tirLoin = executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:LARG/2, y:HAUT/2});
    pas(20);
    V('ordinateur : pas de défense avant sa propre galerie tant qu’il n’a subi aucun tir de galerie ; un tir subi la déclenche',
      avantTir === 0 && tirLoin.ok && etatsIA.I.defense && etatsIA.I.defense.subi === true, {avantTir, tir:tirLoin.ok || tirLoin.motif, subi:etatsIA.I.defense && etatsIA.I.defense.subi});
    let t;
    try {
      t = jusqua(() => { const b = defenses('I').find(estParasol), rad = defenses('I').filter(e => estRadar(e) && !e.enCours);
        return b && !b.enCours && b.para.stock >= 2 && rad.length >= 2; }, 400);
    } finally { window.commanderMunition = cm; }
    const bI = defenses('I').find(estParasol), radars = defenses('I').filter(estRadar), qI = qg('I');
    const ecarts = [];
    for(let a = 0; a < radars.length; a++) for(let b = a + 1; b < radars.length; b++) ecarts.push(Math.round(dist(radars[a], radars[b])));
    V('ordinateur : rien sans galerie hostile ; puis batterie, deux radars (Difficile) et deux munitions', avant === 0 && t !== null && bI && radars.length === 2 && bI.para.stock + bI.para.fab === 2 && depasse.length === 0,
      {avantGalerie:avant, delai:t === null ? 'non' : r1(t), radars:radars.length, munitions:bI && [bI.para.stock, bI.para.fab], depasse, journal:(etatsIA.I.defense || {journal:[]}).journal.map(l => l.t + ' ' + l.quoi + ' ' + (l.type || ''))});
    V('ordinateur : batterie près du QG (zone sur le QG), radars dans la base et écartés', bI && dist(bI, qI) < 350 && radars.every(r => dist(r, qI) < 500) && ecarts.every(d => d >= 150),
      {batterieQG:bI && Math.round(dist(bI, qI)), radarsQG:radars.map(r => Math.round(dist(r, qI))), ecarts});
    V('ordinateur Facile : aucune défense, malgré la galerie hostile', defenses('K').length === 0 && !(etatsIA.K && etatsIA.K.defense), {defensesK:defenses('K').length});
    if(bI){
      gJ.gal.stock = 1;
      ecouter();
      const r = executerOrdre('J', {type:'tirGalerie', id:gJ.id, x:qI.x, y:qI.y});
      const p = camps.I.interception && Object.values(camps.I.interception.propositions).find(x => x.galerie === gJ.id);
      pas(11);
      const tirs = journal.effets.filter(e => e.type === 'intercepteur' && e.p.camp === 'I').length;
      V('ordinateur : autorise d’office l’interception et tire au départ du missile', r.ok && p && p.reponse === true && tirs === 1,
        {ordre:r.ok || r.motif, reponse:p && p.reponse, tirs, galerie:gJpos, galerieMorte:gJ.mort, campJ:camps.J.elimine ? 'éliminé' : 'en jeu', t:r1(temps)});
    }
  }

  // ----------------------------------------------------------------- option décochée, en ligne, mission
  function essaisOption(){
    scene();
    const q = qg('J'), o = unite('technicien', 'J', q.x, q.y + 110);
    poser('usine', 'J', {x:q.x, y:q.y - 220});
    const b = poser('parasol', 'J'), gI = poser('terrier', 'I'); gI.gal.stock = 1;
    const pc = trouverEmplacement('radar', {x:q.x + 260, y:q.y});
    const photo0 = photoEtat(), res = [], galEnLigneAvant = galeriesEnLigne;
    for(const [opt, mr, rm] of [[false, null, null], [true, 'hote', 'hote'], [true, 'invite', 'invite'], [true, 'echo', null]]){
      optionGaleries = opt; modeReseau = mr; roleMonde = rm; galeriesEnLigne = false;   // (en ligne : réglage du salon décoché)
      const a = executerOrdre('J', {type:'fabriquerMunition', id:b.id}), r = executerOrdre('J', {type:'repondreInterception', oui:true});
      const c = mr === 'invite' ? null : executerOrdre('J', {type:'construire', bat:'radar', c:pc.c, r:pc.r, ouvrierIds:[o.id]});
      const listes = ['halden', 'karsk'].map(f => batimentsConstructibles(FACTIONS[f])).every(l => !l.includes('parasol') && !l.includes('radar'));
      res.push({option:opt, mode:mr, actif:galeriesActives(), fab:a.ok ? 'ACCEPTÉ' : a.motif, reponse:r.ok ? 'ACCEPTÉ' : r.motif, construire:c ? (c.ok ? 'ACCEPTÉ' : c.motif) : '-', listes});
      optionGaleries = true; modeReseau = reseauAvant; roleMonde = roleAvant; galeriesEnLigne = galEnLigneAvant;
    }
    // (20 novembre 2026, défense antimissile en ligne : la table réseau des bâtiments les contient tous, batterie et
    // radar compris, et les deux ordres ont un code réseau, fabMunition et repInter, CAHIER-GALERIES-EN-LIGNE.md § 2 et 5.)
    const om = ordreVersReseau({type:'fabriquerMunition', id:b.id}), orep = ordreVersReseau({type:'repondreInterception', oui:true, cle:'1@2'});
    const sansCode = !!om && om.o === 'fabMunition' && !!orep && orep.o === 'repInter' && orep.cle === '1@2'
      && ordreDepuisReseau(om).type === 'fabriquerMunition' && ordreDepuisReseau(orep).type === 'repondreInterception'
      && tablesReseau().batiments.includes('parasol') && tablesReseau().batiments.includes('radar');
    V('option décochée et en ligne réglage décoché (hôte, invité, écho) : munition, réponse et radar refusés, absents des listes ; codes réseau fabMunition et repInter ; batterie et radar dans la table ; état inchangé',
      res.every(r => !r.actif && r.fab !== 'ACCEPTÉ' && r.reponse !== 'ACCEPTÉ' && r.construire !== 'ACCEPTÉ' && r.listes && r.fab === MOTIF_SANS_GALERIES) && sansCode && photoEtat() === photo0, {res, sansCode});
    V('mission : batterie et radar réservés à l’escarmouche, option jamais active en mission',
      RESERVES_ESCARMOUCHE.batiments.has('parasol') && RESERVES_ESCARMOUCHE.batiments.has('radar') && /!MISSION/.test(String(galeriesActives)), String(galeriesActives));
    // Ordinateur, option décochée : une galerie hostile posée à la main ne lui fait rien bâtir ni épargner.
    scene();
    poser('usine', 'I', {x:qg('I').x, y:qg('I').y - 220});
    confierAOrdinateur('I', 'difficile');
    poser('aiguille', 'J');
    optionGaleries = false;
    try { pas(90); } finally { optionGaleries = true; }
    V('ordinateur, option décochée : aucune défense ni mémoire de défense', !ents.some(e => e.camp === 'I' && e.def.defense) && !(etatsIA.I && etatsIA.I.defense), {defense:!!(etatsIA.I && etatsIA.I.defense)});
  }

  // ----------------------------------------------------------------- parties d'ordinateurs
  // Parties de 900 s à graine fixe, option cochée, où l'ordinateur gère seul galeries et défenses. Graines choisies
  // le 19 novembre 2026 pour que chaque partie montre ce qu'elle doit montrer (sujets : camps qui doivent bâtir leur
  // batterie ; tir : au moins un intercepteur tiré dans la partie).
  function essaisParties(){
    const parties = PARTIES_DEFENSE;
    for(const P of parties){
      if(typeof numero === 'number' && parties.indexOf(P) !== numero) continue;
      const r = partieDefense(P.nom, P.graine, 900);
      const nom = P.nom + ' (graine ' + P.graine + ', 900 s)';
      const bilan = P.sujets.map(id => ({camp:id, parasol:r.camps[id].parasol, radars:r.camps[id].radars, munitions:r.camps[id].munitions, intercepteurs:r.camps[id].intercepteurs}));
      const tirs = Object.values(r.camps).reduce((s, c) => s + c.intercepteurs.tires, 0);
      V('partie ' + nom + ' : ' + P.sujets.join(' et ') + (P.sujets.length > 1 ? ' bâtissent leur batterie et leurs radars, commandent' : ' bâtit sa batterie et ses radars, commande') + ' des munitions' + (P.tir ? ' ; au moins un intercepteur tiré' : ''),
        !r.erreur && bilan.every(b => b.parasol.length >= 1 && b.radars.length >= 1 && b.munitions >= 1) && (!P.tir || tirs >= 1), {bilan, tirs, ligne:ligneDefense(r)});
      V('partie ' + nom + ' : sans triche (écart 0, aucune unité sans commande, réserves ≥ 0), batterie jamais avant une galerie hostile, rien chez Facile, aucune erreur',
        !r.erreur && r.fautes.length === 0 && Object.values(r.camps).every(c => /^0 \/ 0 \//.test(c.triche) && c.resMin >= 0), {fautes:r.fautes, triche:Object.fromEntries(Object.entries(r.camps).map(([id, c]) => [id, c.triche + ', min ' + c.resMin]))});
    }
  }
}
window.testerDefense = testerDefense;
// Parties d'essai de testerDefense('parties') (affrontement de AFFRONTEMENTS_GALERIES, graine, camps qui doivent
// bâtir, intercepteur attendu). Graines : voir le commentaire de essaisParties.
// Relevé du 19 novembre 2026 (partieDefense, 900 s) : DH-NK, NH-NK, UH-DK graines 1 à 6 ; UH-UK, UK-DH 1 à 8 ;
// quatre 1 à 6. Retenues : DH-DK 25 (galerie de J à 454 s, batterie de I dans la seconde, deux radars, deux missiles
// abattus sur deux), NH-NK 4 (galerie de I à 595 s, batterie de J à 616 s, un radar, un intercepteur manqué) et
// quatre 3 (galerie de J à 449 s ; I et K bâtissent, K abat un missile sur deux). Aucune partie relevée ne montre
// Ultra bâtir radars et munitions (UH-UK 7 : batterie de I à 871 s seulement) : Ultra n'est donc pas couvert par ces
// parties d'essai (il passe par les mêmes fonctions que Normale et Difficile).
// Rechoisies le 20 novembre 2026 (l'ordinateur bâtit désormais sa galerie avant sa défense, sauf tir déjà subi ;
// relevé : DH-DK 22 à 24, NH-NK 1 à 10, quatre 1 à 8). Retenues : DH-DK 24 (galeries à 469 et 492 s, batteries à
// 516 et 594 s, deux radars chacun, 4 intercepteurs dont 3 réussis), NH-NK 6 (galeries à 588 et 637 s, batteries
// à 654 et 741 s, un radar chacun, un intercepteur réussi) et quatre 2 (J, sans galerie, subit deux tirs de K puis
// bâtit batterie et deux radars : la défense déclenchée par un tir subi ; aucun tir après, donc pas d'intercepteur).
// Vu dans ce relevé et pas corrigé : NH-NK 7 et 8, DH-DK 22, un ordinateur sans galerie subit un ou deux tirs en fin
// de partie et ne bâtit pas de batterie avant 900 s.
const PARTIES_DEFENSE = [
  {nom:'DH-DK', graine:24, sujets:['J', 'I'], tir:true},
  {nom:'NH-NK', graine:6, sujets:['J', 'I'], tir:true},
  {nom:'quatre', graine:2, sujets:['J'], tir:false},
];
window.PARTIES_DEFENSE = PARTIES_DEFENSE;
// =====================================================================
//  Mesures de l'ordinateur Ultra (21 novembre 2026, travaux/ia-ultra/CAHIER.md). Outil de mesure seulement :
//  les fonctions d'ordre de l'ordinateur sont enveloppées le temps d'une partie (remises ensuite) ; les
//  enveloppes ne font que lire l'état (aucun appel à Math.random, aucune écriture dans les entités ni dans
//  etatsIA) : la partie est la même avec et sans mesure (contrôle : verifierNeutraliteUltra).
//  Définitions du cahier, pour les seules unités armées au sol d'un camp Ultra :
//   - destination d'une unité (évaluée après chaque passage de majIA) : sa cible si elle la poursuit (hors de
//     portée), sinon le point de son ordre (aller, attaque-déplacement, attaquer, chemin), sinon son point de
//     repos si elle y retourne ; inchangée tant qu'elle tire à portée ;
//   - demi-tour : unité engagée (rôle 'assaut' ou 'diversion' au pas précédent ou au pas courant) dont la
//     destination change de plus de 200 px avec plus de 120° entre l'ancienne et la nouvelle direction (vues
//     de sa position) ; cause : le dernier code qui a changé l'ordre (ou la cible, si la destination vient de
//     la cible ou si la cible a changé après l'ordre) ; « voulu » : retraite générale, repli d'un blessé,
//     esquive, défense de notre base ;
//   - va-et-vient : demi-tour (tous motifs) d'une unité qui en a déjà fait un dans les 20 s précédentes ;
//   - assaut avorté : assaut (passage de 'regroupe' à 'diversion' ou 'assaut') terminé sans un seul tir de ses
//     unités, et relancé dans les 60 s ;
//   - coût d'une réflexion : durée de majIACamp pour un camp Ultra, temps des enveloppes retiré (ms).
//  En plus (hors cahier, pour le diagnostic) : retournements « moteur », une unité engagée qui repart à plus
//  de 120° de sa marche de la seconde précédente sans aucun changement d'ordre depuis 2 s (poursuite d'une
//  cible, ou trajet : chemin recalculé, poussée entre unités).
//  Ex. : mesureUltra([{id:'J', faction:'halden', equipe:'A', niveau:'ultra'}, {id:'I', faction:'karsk', equipe:'B',
//        niveau:'difficile'}], 1500, {graine:1, pas:1/30, galeries:false})
//  opts : graine (hasard du jeu), pas (nombre ; 1/30 par défaut), irregulier (graine d'un générateur à part :
//  pas tirés entre 1/60 et 1/20 s), galeries (case « Galeries de tir »), trace (true : liste des demi-tours et
//  retournements), suivre (numéro d'unité : trace de cette unité toutes les 0,25 s), sansMesure (partie nue,
//  pour la comparaison d'empreinte).
// =====================================================================
const FONCTIONS_ORDRES_ULTRA = ['majIACamp', 'analyserUltra', 'esquiverRayon', 'economieIA', 'majIAAviation', 'majUltra', 'esquiverZonesUltra',
  'eloignerDuVaisseauUltra', 'replierBlessesUltra', 'defendreUltra', 'gardesChampUltra', 'harcelerUltra', 'attaquerUltra',
  'combattreUltra', 'soutenirUltra', 'riposteGalerieIA', 'pouvoirsUltra', 'tirGalerieIA', 'esquiveGalerieIA'];
const CAUSES_VOULUES_ULTRA = ['replierBlessesUltra', 'esquiverZonesUltra', 'esquiveGalerieIA', 'esquiverRayon', 'eloignerDuVaisseauUltra',
  'attaquerUltra:retraite générale', 'defendreUltra:base menacée'];
function mesureUltra(liste, duree, opts){
  opts = opts || {};
  duree = duree || 1500;
  const ultras = new Set(liste.filter(k => k.niveau === 'ultra').map(k => k.id));
  const M = {demiTours:0, voulus:0, parCause:{}, vaEtVient:0, unitesVaEtVient:new Set(), pairesVaEtVient:{}, retournementsMoteur:{},
    horsAssaut:{}, vaEtVientHorsAssaut:0, collecteursBloques:{}, blocageMax:{}, premierBlocage:null, fugaces:0, assauts:[], couts:[], pics:[], tempsFn:{}, trace:[], suivi:[], transitions:[]};
  let campCourant = null;   // camp Ultra dont la réflexion est en cours (temps par fonction)
  const etat = new Map();   // id -> {o, ox, oy, c, ultra, auteurO, tO, auteurC, tC, dest, dernierDT, echant, dernierRet}
  const pile = [];
  let instru = 0;           // ms passées dans les enveloppes (retirées du coût des réflexions)
  const phases = {};        // camp -> phase vue
  const assautEnCours = {}; // camp -> enregistrement d'assaut
  const S_ = id => etatsIA[id] && etatsIA[id].ultra;
  const suivies = () => ents.filter(e => ultras.has(e.camp) && e.est === 'unite' && !e.mort && e.def.arme && !e.def.ouvrier && !e.def.collecteur && !e.def.aerien);
  const engage = r => r === 'assaut' || r === 'diversion';
  // Sous-cause d'un changement d'ordre ou de cible, selon le code qui l'a fait (pre : état relevé à l'entrée).
  const detail = (nom, u, quoi, pre) => {
    const o = u.ordre;
    if(nom === 'attaquerUltra'){
      const S = S_(u.camp), ph0 = pre && pre.phase[u.camp], ph1 = S && S.phase;
      if(quoi === 'cible') return 'cible';
      if(o && o.type === 'aller' && ph0 !== 'retraite' && ph1 === 'retraite') return 'retraite générale';
      if(ph0 === 'retraite') return 'retraite (vers le rassemblement)';
      if(u.ultra === 'diversion') return 'diversion';
      if(o && o.type === 'aller') return 'rassemblement';
      if(o && o.type === 'attaqueDeplacement' && u.ultra === 'assaut'){
        const b = pre && pre.bary[u.camp];
        return b && Math.hypot(o.x - b.x, o.y - b.y) < 120 ? 'marche : rejoindre le barycentre' : 'marche : point d’étape';
      }
      return o ? 'autre ' + o.type : 'ordre effacé';
    }
    if(nom === 'combattreUltra') return quoi === 'ordre' && o && o.type === 'aller' && u.ultraRecul === temps ? 'recul longue portée' : quoi === 'cible' ? 'changement de cible' : 'autre';
    if(nom === 'defendreUltra') return (S_(u.camp) && S_(u.camp).menace > 0) ? 'base menacée' : 'base alliée';
    if(nom === 'harcelerUltra') return o && o.type === 'aller' ? 'repli ou détour' : 'harcèlement';
    if(nom === 'replierBlessesUltra') return o ? 'repli' : 'fin du repli';
    if(nom === 'moteur'){
      if(quoi === 'cible') return u.cible ? 'cible prise' : 'cible perdue';
      return o ? 'ordre ' + o.type : 'ordre accompli';
    }
    return quoi;
  };
  // Relève les changements d'ordre et de cible depuis le dernier relevé et les attribue à « nom ».
  const rattraper = (nom, pre) => {
    const t0 = performance.now();
    for(const u of suivies()){
      let s = etat.get(u.id);
      if(!s){ s = {o:u.ordre, ox:u.ordre && u.ordre.x, oy:u.ordre && u.ordre.y, c:u.cible, ultra:u.ultra, auteurO:'création', tO:temps, auteurC:'création', tC:temps, dest:null, dernierDT:[], echant:[], dernierRet:-99}; etat.set(u.id, s); continue; }
      const o = u.ordre;
      if(o !== s.o || (o && (o.x !== s.ox || o.y !== s.oy))){ s.auteurO = nom + ':' + detail(nom, u, 'ordre', pre); s.tO = temps; s.o = o; s.ox = o && o.x; s.oy = o && o.y; }
      if(u.cible !== s.c){ s.auteurC = nom + ':' + detail(nom, u, 'cible', pre); s.tC = temps; s.c = u.cible; }
    }
    // Phases des camps Ultra (assauts lancés, terminés).
    for(const id of ultras){
      const S = S_(id); if(!S) continue;
      const p0 = phases[id], p1 = S.phase;
      if(p0 === p1) continue;
      phases[id] = p1;
      M.transitions.push({t:+temps.toFixed(1), camp:id, de:p0, vers:p1, par:nom});
      if((p0 === 'regroupe' || p0 === undefined) && (p1 === 'assaut' || p1 === 'diversion')){
        const membres = new Set(ents.filter(e => e.camp === id && !e.mort && (e.ultra === 'assaut' || e.ultra === 'diversion')).map(e => e.id));
        const A = {camp:id, debut:+temps.toFixed(1), fin:null, finPar:null, vers:null, tirs:0, membres, n:membres.size, valeur:Math.round(S.valeurDepart || 0),
          cible:S.cible ? S.cible.type : null};
        assautEnCours[id] = A; M.assauts.push(A);
      } else if((p0 === 'assaut' || p0 === 'diversion') && (p1 === 'retraite' || p1 === 'regroupe') && assautEnCours[id]){
        const A = assautEnCours[id]; A.fin = +temps.toFixed(1); A.finPar = nom; A.vers = p1; assautEnCours[id] = null;
      }
    }
    instru += performance.now() - t0;
  };
  const destination = u => {
    const c = u.cible;
    if(c && !c.mort){
      const d = distBord(u, c), portee = u.def.porteeAir && enVol(c) ? u.def.porteeAir : u.def.portee;
      // Poursuite : le point où elle arrivera à portée (sur la droite qui la mène à sa cible), pas la cible
      // elle-même (une cible à 10 px de la portée ne fait presque pas bouger l'unité).
      if(d > portee){ const dc = Math.hypot(c.x - u.x, c.y - u.y) || 1, k = Math.min(1, (d - portee + 10)/dc); return {x:u.x + (c.x - u.x)*k, y:u.y + (c.y - u.y)*k, src:'cible'}; }
      return 'garde';
    }
    const o = u.ordre;
    if(o){
      if(o.type === 'aller' || o.type === 'attaqueDeplacement') return {x:o.x, y:o.y, src:'ordre'};
      if(o.type === 'attaquer' && o.cible) return {x:o.cible.x, y:o.cible.y, src:'ordre'};
      if(o.type === 'chemin'){ const p = o.points[o.i]; return p ? {x:p.x, y:p.y, src:'ordre'} : null; }
      return null;
    }
    if(u.retourRepos && u.repos) return {x:u.repos.x, y:u.repos.y, src:'repos'};
    return null;
  };
  const ajouter = (T, k) => { T[k] = (T[k] || 0) + 1; };
  // Collecteurs d'Ultra immobiles (diagnostic, 21 novembre 2026 : six collecteurs coincés tête-bêche dans un
  // couloir, revenu nul pendant des minutes) : relevé toutes les secondes ; un collecteur qui a un ordre de
  // récolte, ne charge ni ne décharge et n'a pas bougé de 8 px en 10 s compte comme bloqué (secondes cumulées).
  const bloc = new Map(); let blocT = 0;
  const releverCollecteurs = () => {
    if(temps - blocT < 1) return; blocT = temps;
    for(const c of ents){
      if(c.mort || !c.def.collecteur || !camps[c.camp]) continue;   // tous les camps (comparaison avec l'adversaire)
      const b = bloc.get(c.id) || {pos:[], bloqueS:0};
      bloc.set(c.id, b);
      b.pos.push({t:temps, x:c.x, y:c.y}); if(b.pos.length > 11) b.pos.shift();
      const p0 = b.pos[0];
      const bloque = b.pos.length === 11 && c.ordre && c.ordre.type === 'recolter' && !c.travaille && Math.hypot(c.x - p0.x, c.y - p0.y) < 8;
      b.suite = bloque ? (b.suite || 0) + 1 : 0;   // secondes de blocage d'affilée (après les 10 s du critère)
      if(b.suite > (M.blocageMax[c.camp] || 0)) M.blocageMax[c.camp] = b.suite;
      if(bloque){
        b.bloqueS++; M.collecteursBloques[c.camp] = (M.collecteursBloques[c.camp] || 0) + 1;
        if(!M.premierBlocage && ultras.has(c.camp)) M.premierBlocage = {t:Math.round(temps), camp:c.camp, id:c.id, x:Math.round(c.x), y:Math.round(c.y)};
      }
    }
  };
  // Demi-tour confirmé (nouvelle destination tenue 0,5 s) : compté, avec sa cause, au moment où il a eu lieu.
  const confirmer = (u, s, K) => {
    const T = K.t, cause = K.cause, A = K.A, D = K.D;
    if(!K.eng){
      // Hors assaut (défense, réserve, harcèlement) : compté à part, pour le diagnostic seulement.
      ajouter(M.horsAssaut, (K.role || 'sans rôle') + ' / ' + cause);
      s.dernierHA = (s.dernierHA || []).filter(t => T - t <= 20);
      if(s.dernierHA.length) M.vaEtVientHorsAssaut++;
      s.dernierHA.push(T);
      if(opts.trace && M.trace.length < 800) M.trace.push({quoi:'demi-tour hors assaut', t:+T.toFixed(2), camp:u.camp, id:u.id, type:u.type, x:K.x, y:K.y,
        de:[Math.round(A.x), Math.round(A.y)], vers:[Math.round(D.x), Math.round(D.y)], cause, role:K.role, phase:K.phase});
      return;
    }
    const voulu = CAUSES_VOULUES_ULTRA.some(v => cause === v || cause.startsWith(v + ':'));
    M.demiTours++; if(voulu) M.voulus++;
    ajouter(M.parCause, cause);
    s.dernierDT = s.dernierDT.filter(x => T - x.t <= 20);
    let vev = false;
    if(s.dernierDT.length){ M.vaEtVient++; M.unitesVaEtVient.add(u.id); ajouter(M.pairesVaEtVient, s.dernierDT[s.dernierDT.length - 1].cause + ' → ' + cause); vev = true; }
    s.dernierDT.push({t:T, cause});
    if(opts.trace && M.trace.length < 800) M.trace.push({quoi:'demi-tour', t:+T.toFixed(2), camp:u.camp, id:u.id, type:u.type, x:K.x, y:K.y,
      de:[Math.round(A.x), Math.round(A.y)], vers:[Math.round(D.x), Math.round(D.y)], angle:Math.round(K.ang*180/Math.PI), cause, voulu, vaEtVient:vev,
      phase:K.phase, role:K.role, pv:K.pv});
  };
  // Après chaque passage de majIA : destinations, demi-tours, va-et-vient, retournements « moteur ».
  const evaluer = () => {
    const t0 = performance.now();
    releverCollecteurs();
    releverEco();
    for(const u of suivies()){
      const s = etat.get(u.id); if(!s) continue;
      const eng = engage(s.ultra) || engage(u.ultra);
      const D = destination(u);
      if(D !== 'garde'){
        // Demi-tour en attente de confirmation : il ne compte que si la nouvelle destination tient 0,5 s. Une
        // destination remplacée aussitôt (cible détruite, retour d'un pas vers un ordre périmé, puis nouvel ordre
        // au passage suivant de l'ordinateur) ne fait pas tourner l'unité : elle est notée « fugace », et l'ancienne
        // destination est rétablie pour la comparaison suivante.
        if(s.cand){
          const K = s.cand;
          if(D && Math.hypot(D.x - K.D.x, D.y - K.D.y) > 200 && temps - K.t < 0.5){ M.fugaces++; s.dest = K.A; s.destT = K.tA; s.cand = null; }
          else if(temps - K.t >= 0.5){ confirmer(u, s, K); s.cand = null; }
        }
        // Ancienne destination : la dernière connue, gardée 3 s après un ordre accompli (un recul de 150 px suivi
        // d'un nouvel ordre vers l'avant est un aller-retour). Ancienne direction : vers elle, ou, si l'unité y est
        // déjà (moins de 60 px), sa marche de la dernière seconde.
        const A = s.dest && temps - s.destT <= 3 ? s.dest : null;
        let dirA = null;
        if(A){
          if(Math.hypot(A.x - u.x, A.y - u.y) > 60) dirA = Math.atan2(A.y - u.y, A.x - u.x);
          else { const E = s.echant, a = E[E.length - 3], b = E[E.length - 1]; if(a && b && Math.hypot(b.x - a.x, b.y - a.y) > 15) dirA = Math.atan2(b.y - a.y, b.x - a.x); }
        }
        if(!s.cand && A && D && dirA !== null && Math.hypot(D.x - A.x, D.y - A.y) > 200 && Math.hypot(D.x - u.x, D.y - u.y) > 60){
          const ang = Math.abs(diffAngle(dirA, Math.atan2(D.y - u.y, D.x - u.x)));
          if(ang > Math.PI*2/3){
            // Cible finie (détruite, perdue) et retour au point d'un ordre plus ancien que la cible : la cause est cet
            // ordre resté en place pendant la poursuite (« ordre périmé »), pas le code qui avait choisi la cible.
            const cause = D.src === 'repos' ? 'moteur:retour au repos'
              : D.src === 'ordre' && A.src === 'cible' && s.tO < s.tC ? 'moteur:retour à un ordre périmé (' + s.auteurO + ')'
              : D.src === 'cible' || s.tC > s.tO ? s.auteurC : s.auteurO;
            s.cand = {t:temps, A, tA:s.destT, D, ang, cause, eng, role:s.ultra || u.ultra || null, phase:S_(u.camp) && S_(u.camp).phase,
              x:Math.round(u.x), y:Math.round(u.y), pv:Math.round(100*u.pv/u.pvMax)};
          }
        }
        if(D){ s.dest = D; s.destT = temps; }
      }
      // Retournement « moteur » : échantillons de position toutes les 0,5 s (2 s gardées).
      const E = s.echant;
      if(!E.length || temps - E[E.length - 1].t >= 0.5){
        E.push({t:temps, x:u.x, y:u.y}); if(E.length > 5) E.shift();
        if(E.length === 5 && eng && temps - s.tO > 2 && temps - s.dernierRet > 2){
          const ax = E[2].x - E[0].x, ay = E[2].y - E[0].y, bx = E[4].x - E[2].x, by = E[4].y - E[2].y;
          const v = u.def.vitesse*0.35;   // au moins 35 % de sa vitesse sur chaque seconde
          if(Math.hypot(ax, ay) > v && Math.hypot(bx, by) > v){
            const ang = Math.abs(diffAngle(Math.atan2(ay, ax), Math.atan2(by, bx)));
            if(ang > Math.PI*2/3){
              const k = (u.cible || temps - s.tC < 2) ? 'poursuite ou changement de cible' : 'trajet (chemin, poussée)';
              ajouter(M.retournementsMoteur, k); s.dernierRet = temps;
              if(opts.trace && M.trace.length < 600) M.trace.push({quoi:'retournement moteur', t:+temps.toFixed(2), camp:u.camp, id:u.id, type:u.type, x:Math.round(u.x), y:Math.round(u.y), cause:k,
                cible:u.cible ? u.cible.type + '#' + u.cible.id : null, ordre:u.ordre ? u.ordre.type : null});
            }
          }
        }
      }
      s.ultra = u.ultra;
      if(opts.suivre === u.id && (!M.suivi.length || temps - M.suivi[M.suivi.length - 1].t >= 0.25))
        M.suivi.push({t:+temps.toFixed(2), x:Math.round(u.x), y:Math.round(u.y), pv:Math.round(u.pv), ordre:u.ordre ? u.ordre.type + (u.ordre.x != null ? ' ' + Math.round(u.ordre.x) + ',' + Math.round(u.ordre.y) : '') : null,
          cible:u.cible ? u.cible.type + '#' + u.cible.id : null, role:u.ultra || null, auteurO:s.auteurO, auteurC:s.auteurC, dest:s.dest ? Math.round(s.dest.x) + ',' + Math.round(s.dest.y) : null,
          phase:S_(u.camp) && S_(u.camp).phase});
    }
    instru += performance.now() - t0;
  };
  // Enveloppes.
  const orig = {majIA:window.majIA, tirer:window.tirer};
  for(const n of FONCTIONS_ORDRES_ULTRA) orig[n] = window[n];
  const releverPre = () => {
    const t0 = performance.now(), pre = {phase:{}, bary:{}};
    for(const id of ultras){
      const S = S_(id); pre.phase[id] = S && S.phase;
      const l = ents.filter(e => e.camp === id && !e.mort && e.ultra === 'assaut');
      pre.bary[id] = barycentre(l);
    }
    instru += performance.now() - t0;
    return pre;
  };
  // Économie et combats (phase 3) : collecte par camp, relevés à 300 et 600 s, morts d'unités armées, unités au contact.
  const campsListe = liste.map(k => k.id), collecte = {}, releves = {}, morts = [], contacts = [];
  let contactT = -1;
  const releverEco = () => {
    for(const T of [300, 600]) if(temps >= T && !releves[T]) releves[T] = Object.fromEntries(campsListe.map(id => [id, {collecte:Math.round(collecte[id] || 0), armee:valeurArmee(id)}]));
    if(temps - contactT < 1) return; contactT = temps;
    const armes = {}; for(const id of campsListe) armes[id] = [];
    for(const e of ents) if(!e.mort && e.est === 'unite' && armes[e.camp] && e.def.arme && !e.def.collecteur && !e.def.ouvrier && !e.def.aerien) armes[e.camp].push(e);
    const l = {t:temps};
    for(const id of campsListe){
      let n = 0; for(const u of armes[id]) if(campsListe.some(o => o !== id && hostile(id, o) && armes[o].some(e => Math.abs(e.x - u.x) < 300 && Math.abs(e.y - u.y) < 300 && Math.hypot(e.x - u.x, e.y - u.y) < 300))) n++;
      l[id] = [n, armes[id].length];
    }
    contacts.push(l);
    // Poursuite inutile (phase 3) : unité d'Ultra qui poursuit une cible hors de portée alors qu'un ennemi qu'elle peut
    // toucher est déjà à portée (unités-secondes).
    if(!opts.poursuite) return;   // (coûteux : seulement sur demande, opts.poursuite)
    for(const id of ultras) for(const u of armes[id] || []){
      const c = u.cible;
      if(!c || c.mort || distBord(u, c) <= u.def.portee) continue;
      if(ents.some(e => !e.mort && e !== c && e.est === 'unite' && peutCibler(u, e) && efficacite(u.def.arme, e) > 0 && distBord(u, e) <= u.def.portee)) poursuiteInutile[id] = (poursuiteInutile[id] || 0) + 1;
    }
  };
  const poursuiteInutile = {};
  orig.majCollecteur = window.majCollecteur; orig.tuer = window.tuer;
  const installer = () => {
    if(!opts.coutSeul){
      window.majCollecteur = function(u){ const C = camps[u.camp], r0 = C ? C.reserves : 0; const r = orig.majCollecteur.apply(this, arguments); if(C && C.reserves > r0) collecte[u.camp] = (collecte[u.camp] || 0) + C.reserves - r0; return r; };
      window.tuer = function(c){ if(c && !c.mort && c.est === 'unite' && c.def.arme && !c.def.collecteur && !c.def.ouvrier) morts.push({t:temps, camp:c.camp, v:c.def.cout || 0}); return orig.tuer.apply(this, arguments); };
    }
    if(!opts.coutSeul) window.majIA = function(){
      rattraper('moteur');
      const r = orig.majIA.apply(this, arguments);
      rattraper('majIA'); evaluer();
      return r;
    };
    window.tirer = function(u){
      if(u && ultras.has(u.camp)){ const A = assautEnCours[u.camp]; if(A && A.membres.has(u.id)) A.tirs++; }
      return orig.tirer.apply(this, arguments);
    };
    for(const n of FONCTIONS_ORDRES_ULTRA){
      const f = orig[n]; if(typeof f !== 'function') continue;
      window[n] = function(){
        if(n === 'majIACamp'){
          const id = arguments[0], estU = ultras.has(id);
          const i0 = instru, t0 = performance.now();
          if(!opts.coutSeul) rattraper(pile.length ? pile[pile.length - 1] : 'moteur');
          pile.push(n); campCourant = estU ? id : null;
          let r; try { r = f.apply(this, arguments); } finally { pile.pop(); campCourant = null; }
          if(!opts.coutSeul) rattraper(n);
          if(estU){ const c = performance.now() - t0 - (instru - i0); M.couts.push(c); if(c > 2 && M.pics.length < 200) M.pics.push({t:+temps.toFixed(1), camp:id, ms:+c.toFixed(2)}); }
          return r;
        }
        if(opts.coutSeul) return f.apply(this, arguments);
        rattraper(pile.length ? pile[pile.length - 1] : 'moteur');
        const pre = n === 'attaquerUltra' ? releverPre() : null;
        pile.push(n);
        const i0 = instru, t0 = performance.now();
        let r; try { r = f.apply(this, arguments); } finally { pile.pop(); }
        if(campCourant){ const c = performance.now() - t0 - (instru - i0), T = M.tempsFn[n] || (M.tempsFn[n] = {somme:0, max:0, n:0}); T.somme += c; T.n++; if(c > T.max) T.max = c; }
        rattraper(n, pre);
        return r;
      };
    }
  };
  // Pas de temps : fixe (1/30 par défaut) ou irrégulier (générateur à part, qui ne touche pas Math.random).
  let pas = opts.pas || 1/30;
  if(opts.irregulier != null){ let g = opts.irregulier >>> 0 || 1; pas = () => { g = (Math.imul(g, 1103515245) + 12345) >>> 0; return 1/60 + (g/4294967296)*(1/20 - 1/60); }; }
  const avant = optionGaleries;
  optionGaleries = !!opts.galeries;
  let r;
  try {
    if(!opts.sansMesure) installer();
    // Minuteur de verifierFin remis comme dans une page neuve : reinitialiserPartie ne le remet pas, et la même
    // graine donnait une autre partie selon ce qui avait tourné avant dans la page (relevé du 21 novembre 2026).
    verifT = 0;
    // (Options ancien, cles et retraits de la phase 3 retirées avec l'interrupteur ultraV44 de jeu.js.)
    const jouer = () => partieRejouable(() => partieOrdinateurs(liste, duree, {pas}));
    r = opts.graine != null ? avecGraine(opts.graine, jouer) : jouer();
  } finally { Object.assign(window, orig); optionGaleries = avant; }
  const empreinte = empreinteEtat().empreinte;
  const gagnants = vainqueurSerie(r);
  const cs = M.couts.slice().sort((a, b) => a - b), q = p => cs.length ? +cs[Math.min(cs.length - 1, Math.floor(p*cs.length))].toFixed(2) : null;
  // Assauts avortés : aucun tir, relancé (même camp) dans les 60 s qui suivent sa fin.
  let avortes = 0;
  M.assauts.forEach((A, i) => {
    const suivant = M.assauts.slice(i + 1).find(B => B.camp === A.camp);
    A.avorte = A.fin != null && A.tirs === 0 && !!suivant && suivant.debut - A.fin <= 60;
    if(A.avorte) avortes++;
  });
  const parCamp = {};
  for(const k of liste) parCamp[k.id] = k.niveau + ' ' + k.faction;
  // Premier grand combat : première fenêtre de 30 s où meurent des unités armées pour au moins 1 000 (tous camps) ;
  // pertes de chaque camp dans la fenêtre, et unités au contact (à moins de 300 px d'un ennemi armé) : le plus haut
  // relevé entre 5 s avant et 10 s après le début de la fenêtre.
  let combat = null;
  for(let i = 0; i < morts.length && !combat; i++){
    const t0 = morts[i].t, f = morts.filter(m => m.t >= t0 && m.t < t0 + 30);
    if(f.reduce((s, m) => s + m.v, 0) >= 1000){
      combat = {t:Math.round(t0), pertes:{}, contact:{}};
      for(const id of campsListe) combat.pertes[id] = f.filter(m => m.camp === id).reduce((s, m) => s + m.v, 0);
      for(const l of contacts) if(l.t >= t0 - 5 && l.t <= t0 + 10) for(const id of campsListe) if(!combat.contact[id] || l[id][0] > combat.contact[id][0]) combat.contact[id] = l[id];
    }
  }
  const vainqueur = !gagnants ? 'aucun (non terminée)' : gagnants.split('+').map(id => id + ' ' + parCamp[id]).join(' + ');
  return {carte:CARTE.id, camps:parCamp, galeries:!!opts.galeries, graine:opts.graine, pas:opts.irregulier != null ? 'irrégulier ' + opts.irregulier : +(opts.pas || 1/30).toFixed(4),
    vainqueur, gagnants, duree:r.temps, erreur:r.erreur, empreinte, releves, combat, poursuiteInutile,
    demiTours:M.demiTours, voulus:M.voulus, defauts:M.demiTours - M.voulus, parCause:M.parCause,
    vaEtVient:M.vaEtVient, unitesVaEtVient:M.unitesVaEtVient.size, pairesVaEtVient:M.pairesVaEtVient, retournementsMoteur:M.retournementsMoteur,
    horsAssaut:M.horsAssaut, vaEtVientHorsAssaut:M.vaEtVientHorsAssaut, fugaces:M.fugaces, collecteursBloques:M.collecteursBloques, blocageMax:M.blocageMax, premierBlocage:M.premierBlocage,
    assautsLances:M.assauts.length, assautsAvortes:avortes,
    assauts:M.assauts.map(A => ({camp:A.camp, debut:A.debut, fin:A.fin, vers:A.vers, par:A.finPar, n:A.n, valeur:A.valeur, cible:A.cible, tirs:A.tirs, avorte:A.avorte})),
    reflexions:cs.length, coutMoyen:cs.length ? +(cs.reduce((a, b) => a + b, 0)/cs.length).toFixed(3) : null, coutMax:q(1), coutP99:q(0.99), coutP50:q(0.5),
    reflexionsPlusDe2ms:cs.filter(x => x > 2).length, reflexionsPlusDe5ms:cs.filter(x => x > 5).length, pics:M.pics.slice(0, 30),
    tempsParFonction:Object.fromEntries(Object.entries(M.tempsFn).map(([k, T]) => [k, {moyen:+(T.somme/T.n).toFixed(3), max:+T.max.toFixed(2), n:T.n}])),
    msParPas:r.msParPas, msMaxPas:r.msMax, collecte:Object.fromEntries(Object.entries(r.camps).map(([id, c]) => [id, c.collecte])), triche:Object.fromEntries(Object.entries(r.camps).map(([id, c]) => [id, c.inexplique + ' / ' + c.unitesSansCommande])),
    transitions:opts.trace ? M.transitions : undefined, trace:opts.trace ? M.trace : undefined, suivi:opts.suivre != null ? M.suivi : undefined};
}
window.mesureUltra = mesureUltra;
// Neutralité de l'instrument : même partie avec et sans mesure (même empreinte finale).
function verifierNeutraliteUltra(liste, duree, opts){
  const a = mesureUltra(liste, duree, Object.assign({}, opts, {sansMesure:true}));
  const b = mesureUltra(liste, duree, opts);
  return {sans:a.empreinte, avec:b.empreinte, identiques:a.empreinte === b.empreinte, duree:[a.duree, b.duree], vainqueur:[a.vainqueur, b.vainqueur]};
}
window.verifierNeutraliteUltra = verifierNeutraliteUltra;
// Plan de la série de référence (cahier) pour la carte chargée : Ultra contre Difficile (Ultra Halden et Karsk, en
// J et en I, galeries décochées et cochées, graines données) et Ultra contre Ultra (Halden en J puis Karsk en J).
const campU = (id, faction, niveau) => ({id, faction, equipe:id === 'J' ? 'A' : 'B', niveau});
function planSerieUltra(graines, grainesUU, opts){
  opts = opts || {};
  const plan = [];
  for(const gal of [false, true]){
    for(const g of graines) for(const [fU, cote] of [['halden', 'J'], ['karsk', 'J'], ['halden', 'I'], ['karsk', 'I']]){
      const fA = fU === 'halden' ? 'karsk' : 'halden';
      const liste = cote === 'J' ? [campU('J', fU, 'ultra'), campU('I', fA, 'difficile')] : [campU('J', fA, 'difficile'), campU('I', fU, 'ultra')];
      plan.push({nom:'U' + fU[0].toUpperCase() + '(' + cote + ')-D', liste, graine:g, galeries:gal});
    }
    for(const g of (grainesUU || [])) for(const fJ of ['halden', 'karsk'])
      plan.push({nom:'UU ' + fJ[0].toUpperCase() + '(J)', liste:[campU('J', fJ, 'ultra'), campU('I', fJ === 'halden' ? 'karsk' : 'halden', 'ultra')], graine:g, galeries:gal});
  }
  return plan.map(p => Object.assign(p, opts));
}
window.planSerieUltra = planSerieUltra;
// Ultra contre Ultra (biais de côté et de camp) : pour chaque graine, Halden (J) contre Karsk (I) puis Karsk (J) contre
// Halden (I). (Les outils « nouveau contre ancien » et l'étude par retrait de la phase 3 demandaient l'interrupteur
// ultraV44 de jeu.js, retiré ; ils sont décrits dans travaux/ia-ultra/MESURES-APRES.md, et la version de jeu.js qui
// les accepte est dans travaux/ia-ultra/jeu-avec-interrupteur.js.)
function planUltraContreUltra(graines){
  const plan = [];
  for(const g of graines) for(const fJ of ['halden', 'karsk']){
    const fI = fJ === 'halden' ? 'karsk' : 'halden';
    plan.push({nom:'UU ' + fJ[0].toUpperCase() + '(J)-' + fI[0].toUpperCase(), liste:[campU('J', fJ, 'ultra'), campU('I', fI, 'ultra')], graine:g, galeries:false});
  }
  return plan;
}
window.planUltraContreUltra = planUltraContreUltra;
// Biais de côté et de camp : victoires de J et de Karsk.
function biaisUltra(parties){
  let n = 0, j = 0, k = 0, nul = 0;
  for(const p of parties){ const m = p.mesure; if(!m || m.demiTours == null) continue; n++; if(!m.gagnants){ nul++; continue; } if(m.gagnants === 'J') j++; if(m.camps[m.gagnants].includes('karsk')) k++; }
  return {parties:n, victoiresJ:j, victoiresKarsk:k, nulles:nul};
}
window.biaisUltra = biaisUltra;
// Résumé économie / combat d'une série, par camp de faction : moyennes de la collecte et de l'armée à 300 et 600 s, des
// pertes subies et infligées et de la part des unités au contact dans le premier grand combat (mesureUltra).
function ecoCombatUltra(parties){
  const S = {};
  const aj = (o, k, v) => { if(v == null || isNaN(v)) return; o[k] = (o[k] || 0) + v; o[k + 'N'] = (o[k + 'N'] || 0) + 1; };
  for(const p of parties){
    const m = p.mesure; if(!m || !m.releves) continue;
    for(const id of Object.keys(m.camps)){
      const o = S[m.camps[id]] || (S[m.camps[id]] = {n:0}); o.n++;
      for(const T of [300, 600]) if(m.releves[T]){ aj(o, 'collecte' + T, m.releves[T][id].collecte); aj(o, 'armee' + T, m.releves[T][id].armee); }
      if(m.combat){
        const autre = Object.keys(m.camps).find(x => x !== id);
        aj(o, 'pertesCombat', m.combat.pertes[id]); aj(o, 'pertesInfligees', m.combat.pertes[autre]);
        if(m.combat.contact[id]) aj(o, 'partAuContact', m.combat.contact[id][1] ? m.combat.contact[id][0]/m.combat.contact[id][1] : 0);
      }
    }
  }
  for(const o of Object.values(S)) for(const k of Object.keys(o)) if(k.endsWith('N')){ const b = k.slice(0, -1); o[b] = +(o[b]/o[k]).toFixed(b === 'partAuContact' ? 2 : 0); delete o[k]; }
  return S;
}
window.ecoCombatUltra = ecoCombatUltra;
// Série par morceaux synchrones (une partie par appel d'avancerSerieUltra), résultats dans RESULTATS[cle].
function preparerSerieUltra(cle, plan, duree){
  RESULTATS[cle] = {etat:'en cours', duree:duree || 1500, travaux:plan.slice(), faits:0, total:plan.length, parties:[]};
  return plan.length + ' parties à jouer';
}
window.preparerSerieUltra = preparerSerieUltra;
function ligneMesureUltra(p, m){
  return p.nom + ' g' + p.graine + (p.galeries ? ' gal' : '') + ' : ' + m.vainqueur + ' ' + m.duree + ' s, demi-tours ' + m.demiTours + ' (voulus ' + m.voulus +
    '), va-et-vient ' + m.vaEtVient + ', collecteurs bloqués (s) ' + JSON.stringify(m.collecteursBloques || {}) + ', assauts ' + m.assautsLances + ' / avortés ' + m.assautsAvortes + ', réflexion ' + m.coutMoyen + ' ms (max ' + m.coutMax + ')' + (m.erreur ? ' ERREUR ' + m.erreur : '');
}
function avancerSerieUltra(cle, limite){
  const R = RESULTATS[cle], t0 = performance.now();
  while(R.travaux.length && performance.now() - t0 < (limite || 1)){
    const p = R.travaux[0];
    let m;
    try { m = mesureUltra(p.liste, R.duree, {graine:p.graine, galeries:p.galeries, pas:p.pas, irregulier:p.irregulier}); }
    catch(e){ m = {erreur:e.message}; }
    const res = {nom:p.nom, graine:p.graine, galeries:p.galeries, pas:p.irregulier != null ? 'irr' + p.irregulier : (p.pas || 1/30), mesure:m, ligne:ligneMesureUltra(p, m)};
    delete m.trace; delete m.suivi; delete m.transitions;
    R.parties.push(res); R.travaux.shift(); R.faits++;
  }
  if(!R.travaux.length) R.etat = 'fini';
  return {reste:R.travaux.length, faits:R.faits, derniere:R.parties.length ? R.parties[R.parties.length - 1].ligne : null};
}
window.avancerSerieUltra = avancerSerieUltra;
// Même chose sans bloquer les appels courts : une partie par tour de la boucle du navigateur.
function lancerSerieUltra(cle, plan, duree){
  preparerSerieUltra(cle, plan, duree);
  const pas = () => { if(!RESULTATS[cle].travaux.length) return; avancerSerieUltra(cle, 1); setTimeout(pas, 10); };
  setTimeout(pas, 10);
  return 'lancée : RESULTATS.' + cle;
}
window.lancerSerieUltra = lancerSerieUltra;
// Plusieurs séries par morceaux : SERIES_ULTRA = [[cle, plan], ...] ; avancerSeriesUltra(24000) autant de fois qu'il
// faut (chaque appel joue des parties pendant au plus ce nombre de ms).
window.SERIES_ULTRA = [];
function avancerSeriesUltra(lim){
  const t0 = performance.now();
  for(const [k, p] of SERIES_ULTRA){
    if(!RESULTATS[k]) preparerSerieUltra(k, p, 1500);
    while(RESULTATS[k].travaux.length && performance.now() - t0 < lim) avancerSerieUltra(k, 1);
  }
  return SERIES_ULTRA.map(([k]) => k + ' ' + RESULTATS[k].faits + '/' + RESULTATS[k].total).join(', ');
}
window.avancerSeriesUltra = avancerSeriesUltra;
// Tableau (lignes Markdown) et bilan condensé d'une série.
function resumerSerieUltra(k){
  const L = RESULTATS[k].parties.map(p => {
    const m = p.mesure, idU = Object.keys(m.camps).filter(id => m.camps[id].startsWith('ultra'));
    return '| ' + p.nom + ' | ' + p.graine + ' | ' + (p.galeries ? 'oui' : 'non') + ' | ' + m.vainqueur + ' | ' + m.duree + ' | ' + m.demiTours + ' (' + m.voulus + ') | ' +
      m.vaEtVient + ' | ' + m.fugaces + ' | ' + m.assautsLances + ' / ' + m.assautsAvortes + ' | ' + m.coutMoyen + ' / ' + m.coutMax + ' | ' +
      idU.map(id => id + ' ' + ((m.collecteursBloques || {})[id] || 0)).join(', ') + ' | `' + m.empreinte + '` |' + (m.erreur ? ' ERREUR ' + m.erreur : '');
  });
  const B = bilanSerieUltra(RESULTATS[k].parties);
  return L.join('\n') + '\nBILAN ' + JSON.stringify({vsD:B.contreDifficile, UU:B.ultraContreUltra, DT:B.demiTours, voulus:B.voulus, VEV:B.vaEtVient, VEVdefaut:B.vaEtVientDefaut, unitesVEV:B.unitesVaEtVient,
    fugaces:B.fugaces, assauts:B.assauts, avortes:B.avortes, parCause:B.parCause, paires:B.pairesVaEtVient, moteur:B.retournementsMoteur,
    cout:[B.coutMoyen, B.coutMax, B.reflexionsPlusDe2ms, B.reflexionsPlusDe5ms], bloques:[B.collecteursBloquesUltra, B.collecteursBloquesAdversaire],
    partiesBlocage:B.partiesBlocageUltra, ha:B.horsAssaut, vevHA:B.vaEtVientHorsAssaut, erreurs:B.erreurs});
}
window.resumerSerieUltra = resumerSerieUltra;
// Va-et-vient « défaut » : paire de demi-tours dont aucune des deux causes n'est voulue (CAUSES_VOULUES_ULTRA).
const causeVoulueUltra = c => CAUSES_VOULUES_ULTRA.some(v => c === v || c.startsWith(v + ':'));
function vaEtVientDefaut(paires){
  let n = 0;
  for(const [k, v] of Object.entries(paires || {})){ const [a, b] = k.split(' → '); if(!causeVoulueUltra(a) && !causeVoulueUltra(b)) n += v; }
  return n;
}
window.vaEtVientDefaut = vaEtVientDefaut;
// Va-et-vient des causes A1 à A5 du diagnostic : une des deux causes est le recul (A1), un ordre périmé (A2), un
// changement de cible de combattreUltra (A3), le repli d'un harceleur (A4), « rejoindre le barycentre » (A5), ou
// les deux sont des ordres de marche groupée (bascule A5). Les autres va-et-vient « défaut » viennent de la laisse du
// moteur (retour au repos, cible prise au balayage) : règle commune à tous les niveaux, comptée à part.
const CAUSE_A1A5 = /recul longue portée|ordre périmé|combattreUltra:changement de cible|harcelerUltra:repli|rejoindre le barycentre/;
function vaEtVientA1A5(paires){
  let n = 0;
  for(const [k, v] of Object.entries(paires || {})){
    const [a, b] = k.split(' → ');
    if(causeVoulueUltra(a) || causeVoulueUltra(b)) continue;
    if(CAUSE_A1A5.test(a) || CAUSE_A1A5.test(b) || (/attaquerUltra:marche/.test(a) && /attaquerUltra:marche/.test(b))) n += v;
  }
  return n;
}
window.vaEtVientA1A5 = vaEtVientA1A5;
// Essai rejouable de l'ordinateur Ultra (21 novembre 2026, phase 2) : les parties où le diagnostic a vu les défauts
// A1 à A5 et B1 (DIAGNOSTIC.md), sur la carte chargée (?verif&carte=portCalmes, puis ?verif&carte=gorgesVarseche),
// dont une à pas irrégulier. Par partie : aucun va-et-vient de cause A1 à A5 (vaEtVientA1A5), aucun collecteur
// d'Ultra bloqué plus de 30 s d'affilée (au-delà des 10 s du critère), aucune erreur, aucune triche ; victoire d'Ultra
// quand il joue contre Difficile (un vainqueur quand Ultra joue contre Ultra).
// Ex. : testerUltra()  →  {carte, bilan:'n / m', verdicts:[...]} (environ 10 s par carte).
const CAS_ULTRA = {
  portCalmes:[
    {nom:'UH(J)-D g1 (Bastion #50 : ordre périmé, bascule de cible)', liste:[campU('J', 'halden', 'ultra'), campU('I', 'karsk', 'difficile')], graine:1},
    {nom:'UU H(J) g1 (Lynx #60 : harceleur enrôlé dans l’assaut)', liste:[campU('J', 'halden', 'ultra'), campU('I', 'karsk', 'ultra')], graine:1, uu:true},
    {nom:'UH(I)-D g2 galeries, pas irrégulier 202 (Rempart #64 : recul / avance)', liste:[campU('J', 'karsk', 'difficile'), campU('I', 'halden', 'ultra')], graine:2, galeries:true, irregulier:202},
  ],
  gorgesVarseche:[
    {nom:'UH(J)-D g1 (Rempart #76 : recul / avance, seuil du barycentre)', liste:[campU('J', 'halden', 'ultra'), campU('I', 'karsk', 'difficile')], graine:1},
    {nom:'UH(I)-D g1 (six collecteurs coincés dans un couloir)', liste:[campU('J', 'karsk', 'difficile'), campU('I', 'halden', 'ultra')], graine:1},
    {nom:'UH(J)-D g2 (assaut au-devant d’une vague)', liste:[campU('J', 'halden', 'ultra'), campU('I', 'karsk', 'difficile')], graine:2},
    {nom:'UH(J)-D g1, pas irrégulier 101', liste:[campU('J', 'halden', 'ultra'), campU('I', 'karsk', 'difficile')], graine:1, irregulier:101},
  ],
};
window.CAS_ULTRA = CAS_ULTRA;
function testerUltra(){
  const cas = CAS_ULTRA[CARTE.id];
  if(!cas) return {carte:CARTE.id, bilan:'0 / 0', verdicts:[{nom:'carte prévue (portCalmes ou gorgesVarseche)', ok:false}]};
  const V = [];
  for(const c of cas){
    const m = mesureUltra(c.liste, 1500, {graine:c.graine, galeries:!!c.galeries, irregulier:c.irregulier});
    const ids = c.liste.filter(k => k.niveau === 'ultra').map(k => k.id);
    const bloque = Math.max(0, ...ids.map(id => (m.blocageMax || {})[id] || 0));
    const vevA = vaEtVientA1A5(m.pairesVaEtVient);
    const triche = Object.values(m.triche).every(t => t === '0 / 0');
    const victoire = c.uu ? !!m.gagnants : ids.includes(m.gagnants);
    const ok = !m.erreur && vevA === 0 && bloque <= 30 && triche && victoire;
    V.push({nom:c.nom, ok, detail:{vainqueur:m.vainqueur, duree:m.duree, vaEtVientA1A5:vevA, vaEtVientDefaut:vaEtVientDefaut(m.pairesVaEtVient), vaEtVient:m.vaEtVient,
      paires:m.pairesVaEtVient, collecteurBloqueDaffilee:bloque, collecteurBloqueTotal:ids.map(id => (m.collecteursBloques || {})[id] || 0), triche:m.triche, erreur:m.erreur, empreinte:m.empreinte}});
  }
  return {carte:CARTE.id, bilan:V.filter(v => v.ok).length + ' / ' + V.length, verdicts:V};
}
window.testerUltra = testerUltra;
// Bilan d'une ou plusieurs séries (tableau de parties de RESULTATS[cle].parties).
function bilanSerieUltra(parties){
  const B = {parties:parties.length, contreDifficile:{n:0, victoires:0, haldenContreKarsk:{n:0, v:0}, durees:[]}, ultraContreUltra:{n:0, J:0, I:0, aucun:0},
    demiTours:0, voulus:0, vaEtVient:0, unitesVaEtVient:0, assauts:0, avortes:0, parCause:{}, pairesVaEtVient:{}, retournementsMoteur:{},
    coutMoyen:null, coutMax:0, reflexionsPlusDe2ms:0, reflexionsPlusDe5ms:0, erreurs:0};
  let sc = 0, nc = 0;
  for(const p of parties){
    const m = p.mesure; if(!m || m.erreur){ B.erreurs++; if(!m || m.demiTours == null) continue; }
    const niv = Object.values(m.camps);
    if(niv.every(s => s.startsWith('ultra'))){
      B.ultraContreUltra.n++;
      if(!m.gagnants) B.ultraContreUltra.aucun++; else B.ultraContreUltra[m.gagnants]++;
    } else {
      B.contreDifficile.n++;
      const idU = Object.keys(m.camps).find(id => m.camps[id].startsWith('ultra'));
      const v = m.gagnants === idU;
      if(v){ B.contreDifficile.victoires++; B.contreDifficile.durees.push(m.duree); }
      if(m.camps[idU] === 'ultra halden'){ B.contreDifficile.haldenContreKarsk.n++; if(v) B.contreDifficile.haldenContreKarsk.v++; }
    }
    B.demiTours += m.demiTours; B.voulus += m.voulus; B.vaEtVient += m.vaEtVient; B.unitesVaEtVient += m.unitesVaEtVient;
    B.assauts += m.assautsLances; B.avortes += m.assautsAvortes;
    for(const [k, n] of Object.entries(m.parCause)) B.parCause[k] = (B.parCause[k] || 0) + n;
    for(const [k, n] of Object.entries(m.pairesVaEtVient)) B.pairesVaEtVient[k] = (B.pairesVaEtVient[k] || 0) + n;
    for(const [k, n] of Object.entries(m.retournementsMoteur)) B.retournementsMoteur[k] = (B.retournementsMoteur[k] || 0) + n;
    for(const [id, s] of Object.entries(m.collecteursBloques || {})){ const k = m.camps[id].startsWith('ultra') ? 'collecteursBloquesUltra' : 'collecteursBloquesAdversaire'; B[k] = (B[k] || 0) + s; if(s >= 60 && m.camps[id].startsWith('ultra')) (B.partiesBlocageUltra = B.partiesBlocageUltra || []).push(p.nom + ' g' + p.graine + (p.galeries ? ' gal' : '') + ' ' + id + ' ' + s + ' s'); }
    B.fugaces = (B.fugaces || 0) + (m.fugaces || 0);
    B.vaEtVientDefaut = (B.vaEtVientDefaut || 0) + vaEtVientDefaut(m.pairesVaEtVient);
    B.vaEtVientA1A5 = (B.vaEtVientA1A5 || 0) + vaEtVientA1A5(m.pairesVaEtVient);
    for(const [id, s] of Object.entries(m.blocageMax || {})) if(m.camps[id].startsWith('ultra')) B.blocageMaxUltra = Math.max(B.blocageMaxUltra || 0, s);
    B.horsAssaut = B.horsAssaut || {}; B.vaEtVientHorsAssaut = (B.vaEtVientHorsAssaut || 0) + (m.vaEtVientHorsAssaut || 0);
    for(const [k, n] of Object.entries(m.horsAssaut || {})) B.horsAssaut[k] = (B.horsAssaut[k] || 0) + n;
    if(m.reflexions){ sc += m.coutMoyen*m.reflexions; nc += m.reflexions; }
    B.coutMax = Math.max(B.coutMax, m.coutMax || 0); B.reflexionsPlusDe2ms += m.reflexionsPlusDe2ms || 0; B.reflexionsPlusDe5ms += m.reflexionsPlusDe5ms || 0;
  }
  B.coutMoyen = nc ? +(sc/nc).toFixed(3) : null;
  B.contreDifficile.mediane = medianeSerie(B.contreDifficile.durees);
  const tri = T => Object.fromEntries(Object.entries(T).sort((a, b) => b[1] - a[1]));
  B.parCause = tri(B.parCause); B.pairesVaEtVient = tri(B.pairesVaEtVient); if(B.horsAssaut) B.horsAssaut = tri(B.horsAssaut);
  return B;
}
window.bilanSerieUltra = bilanSerieUltra;
