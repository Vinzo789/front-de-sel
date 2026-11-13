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
// Économie à collecteurs (novembre 2026) : les ouvriers ne récoltent plus. Le robot garde quatre
// ouvriers (chantiers, réparations) et rachète ses collecteurs jusqu'à trois, qui travaillent seuls.
// « armee » ne contient que des unités armées (ni ouvriers ni collecteurs).
const ROBOT_COLLECTEURS = 3, ROBOT_OUVRIERS = 4;
function robotEconomie(){
  const uns = robotJ().filter(e => e.est === 'unite'), ouv = uns.filter(u => u.def.ouvrier);
  const qg = robotJ().find(b => b.type === 'qg');
  const coll = uns.filter(u => u.def.collecteur).length + (qg ? qg.file.filter(t => t === 'collecteur').length : 0);
  if(qg && !qg.enCours && qg.file.length < 1){
    if(coll < ROBOT_COLLECTEURS && noeuds.some(n => n.reste > 0) && camps.J.reserves >= UNITES.collecteur.cout) commander(qg, 'collecteur');
    else if(ouv.length < ROBOT_OUVRIERS && camps.J.reserves >= 50) commander(qg, FACTIONS[camps.J.faction].ouvrier);
  }
  // Ouvriers inoccupés : ils réparent ce qui est entamé.
  for(const o of ouv) if(!o.ordre){ const b = batimentAReparer(o, 1400); if(b) o.ordre = {type:'reparer', bat:b}; }
  return {qg, ouv, armee: uns.filter(u => !u.def.ouvrier && !u.def.collecteur)};
}
function robotBatir(type, pres){
  const bats = robotJ().filter(b => b.est === 'batiment');
  if(bats.some(b => b.type === type)) return;
  const D = BATIMENTS[type]; if(camps.J.reserves < D.cout) return;
  if(D.requiert && !bats.some(b => b.type === D.requiert && !b.enCours)) return;
  const o = robotJ().find(u => u.est === 'unite' && u.def.ouvrier); if(!o) return;
  const p = trouverEmplacement(type, pres || bats[0]); if(p) construireBatiment('J', type, p.c, p.r, [o]);
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
    commander(b, type);
  }
}
function robotAttaquer(unites, x, y){ for(const u of unites) if(!u.ordre && !u.cible) u.ordre = {type:'attaqueDeplacement', x:x + (Math.random()-.5)*100, y:y + (Math.random()-.5)*100}; }

// Frappe de précision sur la première cible d'un type donné proche de l'armée.
function robotFrappe(armee, types){
  if(camps.J.faction !== 'halden' || camps.J.points < 3) return;
  const c = ents.find(e => e.camp === 'I' && !e.mort && types.includes(e.type) && armee.some(u => Math.hypot(u.x-e.x, u.y-e.y) < 450));
  if(c) activerPouvoir('J', 'frappe', c.x, c.y);
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
    if(o){ o.ordre = {type:'construire', bat:b}; o.chemin = null; o.cible = null; }
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
    if(c && camps.J.points >= 3) activerPouvoir('J', 'frappe', c.x, c.y);
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
    if(camps.J.points >= 3) activerPouvoir('J', 'renforts');
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
      if(p) construireBatiment('J', 'bunker', p.c, p.r, [o]);
    }
    if(autorise('unites', 'sentinelle') && armee.filter(u => u.type === 'sentinelle').length < 4) robotProduire('sentinelle');
    if(camps.J.reserves > 250) robotProduire('ours');
    robotProduire('conscrit');
    if(camps.J.points >= 3) activerPouvoir('J', 'renforts');
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
    if(camps.J.points >= 3 && qg) activerPouvoir('J', 'renforts');
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
    if(camps.J.points >= 13) activerPouvoir('J', 'renforts');
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
      if(c) activerPouvoir('J', 'marteau', c.x, c.y);
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
      if(o){ o.ordre = {type:'construire', bat:chantier}; o.chemin = null; }
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
  if(menace){ for(const u of terre) if(!u.cible) u.ordre = {type:'attaqueDeplacement', x:menace.x, y:menace.y}; }
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
    if(c) u.ordre = {type:'attaquer', cible:c};
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
  const ids = campsEnJeu();
  const compta = Object.fromEntries(ids.map(id => [id, {depart:camps[id].reserves, collecte:0, charge:0, dechargements:0, secours:0, depenses:0, unites:0, commandes:0, renforts:0}]));
  // Instruments (remis en place à la fin).
  const orig = {majCollecteur:window.majCollecteur, commander:window.commander, construireBatiment:window.construireBatiment, revenuSecours:window.revenuSecours, creerUnite:window.creerUnite, activerPouvoir:window.activerPouvoir};
  let enProduction = 0;
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
  const dt = 0.05; let tMax = 0, tSomme = 0, n = 0, erreur = null;
  const ech = opts.mesureApres || 0;
  try {
    for(let k = 0; k < (duree || 1500)/dt; k++){
      if(opts.surprise){ if(surprise.etat === 'cinematique') passerCinematique(); if(surprise.etat === 'dialogue') repondreAlliance(true); }
      const t0 = performance.now();
      try { miseAJour(dt); } catch(e){ erreur = 't=' + temps.toFixed(1) + ' ' + e.message + ' | ' + String(e.stack || '').split('\n').slice(1, 3).join(' | '); break; }
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
