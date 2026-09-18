// Sistemas de dopamina: XP/niveles, rachas, misiones, ruleta gratis, torneo diario, feed.
const { Q } = require('./db');

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => { const d = new Date(Date.now() - 864e5); return d.toISOString().slice(0, 10); };

// ---------- XP / NIVELES ----------
// Nivel n requiere n*400 XP acumulado aprox: level = floor(sqrt(xp/100)) + 1
function levelFor(xp) { return Math.floor(Math.sqrt(xp / 100)) + 1; }
function awardXP(user, bet) {
  const gain = Math.max(1, Math.floor(bet / 10));
  const newXp = user.xp + gain;
  const newLevel = levelFor(newXp);
  if (newLevel > user.level) {
    const reward = newLevel * 150;
    Q.addXp.run(gain, newLevel, user.id);
    Q.addCoins.run(reward, user.id);
    return { leveled: true, level: newLevel, reward, xp: newXp };
  }
  Q.addXp.run(gain, user.level, user.id);
  return { leveled: false, xp: newXp };
}

// ---------- BONO DIARIO + RACHA ----------
function claimDaily(user) {
  const t = today();
  if (user.last_claim === t) {
    return { ok: false, reason: 'already', streak: user.streak };
  }
  const streak = user.last_claim === yesterday() ? user.streak + 1 : 1;
  const reward = Math.min(500 + (streak - 1) * 150, 2000);
  Q.addCoins.run(reward, user.id);
  Q.setStreak.run(streak, t, user.id);
  return { ok: true, reward, streak };
}

// ---------- MISIONES DIARIAS ----------
const MISSION_POOL = [
  { id: 'rounds15', text: 'Juega 15 rondas', target: 15, reward: 300 },
  { id: 'wager5000', text: 'Apuesta 5,000 en total', target: 5000, reward: 500 },
  { id: 'streak3', text: 'Gana 3 rondas seguidas', target: 3, reward: 400 },
  { id: 'games3', text: 'Juega 3 juegos distintos', target: 3, reward: 350 },
  { id: 'bigwin', text: 'Consigue una ganancia de 8x o más', target: 1, reward: 600 },
  { id: 'rounds30', text: 'Juega 30 rondas', target: 30, reward: 700 },
];
function pickMissions(userId, dateStr) {
  // determinista por usuario+día (mulberry32)
  let h = 0; const s = `${userId}:${dateStr}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  let a = h >>> 0;
  const rand = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const idx = [0, 1, 2, 3, 4, 5];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1));[idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, 3).map(k => MISSION_POOL[k]);
}
function getOrCreateMissions(user) {
  const t = today();
  let row = Q.getMissions.get(user.id, t);
  if (!row) {
    const defs = pickMissions(user.id, t);
    const prog = {}; defs.forEach(d => prog[d.id] = 0);
    Q.saveMissions.run(user.id, t, JSON.stringify(defs), JSON.stringify(prog), '[]');
    row = Q.getMissions.get(user.id, t);
  }
  return row;
}
function getMissions(user) {
  const row = getOrCreateMissions(user);
  const defs = JSON.parse(row.defs_json), prog = JSON.parse(row.prog_json), claimed = JSON.parse(row.claimed_json);
  return defs.map(d => ({ ...d, progress: Math.min(prog[d.id] || 0, d.target), done: (prog[d.id] || 0) >= d.target, claimed: claimed.includes(d.id) }));
}
// event: {type:'round'} | {type:'wager', amount} | {type:'streak', n} | {type:'game', name} | {type:'bigwin'}
function missionEvent(user, event, dailyRow) {
  const t = today();
  const row = getOrCreateMissions(user);
  const defs = JSON.parse(row.defs_json), prog = JSON.parse(row.prog_json);
  const games = new Set(JSON.parse(dailyRow.games_json || '[]'));
  for (const d of defs) {
    if (prog[d.id] >= d.target) continue;
    // dailyRow ya incluye la ronda actual: usar sus valores directo
    if (d.id === 'rounds15' || d.id === 'rounds30') prog[d.id] = dailyRow.rounds;
    else if (d.id === 'wager5000') prog[d.id] = dailyRow.wagered;
    else if (d.id === 'streak3' && event.type === 'streak') prog[d.id] = Math.max(prog[d.id], event.n);
    else if (d.id === 'games3') prog[d.id] = games.size;
    else if (d.id === 'bigwin' && event.type === 'bigwin') prog[d.id] = 1;
  }
  const claimed = JSON.parse(row.claimed_json);
  Q.saveMissions.run(user.id, t, row.defs_json, JSON.stringify(prog), JSON.stringify(claimed));
  return defs.filter(d => prog[d.id] >= d.target && !claimed.includes(d.id)).map(d => d.id);
}
function claimMission(user, missionId) {
  const t = today();
  const row = Q.getMissions.get(user.id, t);
  if (!row) return { ok: false };
  const defs = JSON.parse(row.defs_json), prog = JSON.parse(row.prog_json);
  const claimed = JSON.parse(row.claimed_json);
  const def = defs.find(d => d.id === missionId);
  if (!def || (prog[def.id] || 0) < def.target || claimed.includes(def.id)) return { ok: false };
  claimed.push(def.id);
  Q.addCoins.run(def.reward, user.id);
  Q.saveMissions.run(user.id, t, row.defs_json, row.prog_json, JSON.stringify(claimed));
  return { ok: true, reward: def.reward };
}

// ---------- RULETA DE PREMIOS (gratis cada 6h) ----------
const WHEEL_PRIZES = [
  { coins: 100, w: 30 }, { coins: 250, w: 25 }, { coins: 500, w: 20 },
  { coins: 1000, w: 12 }, { coins: 2500, w: 8 }, { coins: 5000, w: 4 }, { coins: 15000, w: 1 },
];
function wheelStatus(user) {
  if (!user.wheel_at) return { ready: true, waitMs: 0 };
  const waitMs = (new Date(user.wheel_at).getTime() + 6 * 3600e3) - Date.now();
  return waitMs <= 0 ? { ready: true, waitMs: 0 } : { ready: false, waitMs };
}
function spinWheel(user) {
  const st = wheelStatus(user);
  if (!st.ready) return { ok: false, waitMs: st.waitMs };
  const total = WHEEL_PRIZES.reduce((a, p) => a + p.w, 0);
  let r = Math.random() * total, prize = WHEEL_PRIZES[0];
  for (const p of WHEEL_PRIZES) { r -= p.w; if (r <= 0) { prize = p; break; } }
  Q.addCoins.run(prize.coins, user.id);
  Q.setWheel.run(new Date().toISOString(), user.id);
  return { ok: true, prize: prize.coins };
}

// ---------- TORNEO DIARIO (más ganancia del día) ----------
const TOUR_PRIZES = [5000, 2500, 1000];
function tournamentBoard(dateStr) {
  const rows = Q.topProfitDaily.all(dateStr || today());
  return rows.map((r, i) => ({ ...r, prize: TOUR_PRIZES[i] || 0, pos: i + 1 }));
}
// Premia el torneo de AYER (evaluación perezosa: la primera petición del día lo liquida)
let lastSettled = '';
function settleTournament() {
  const t = today();
  if (lastSettled === t) return [];
  lastSettled = t;
  const y = yesterday();
  const winners = Q.topProfitDaily.all(y).slice(0, 3);
  const paid = [];
  for (let i = 0; i < winners.length; i++) {
    const u = require('./db').db.prepare('SELECT id FROM users WHERE name = ?').get(winners[i].name);
    if (u) { Q.addCoins.run(TOUR_PRIZES[i], u.id); paid.push({ name: winners[i].name, prize: TOUR_PRIZES[i] }); }
  }
  return paid;
}

// ---------- FEED EN VIVO ----------
function feedWin(user, gameLabel, mult, win) {
  if (mult >= 8 || win >= 3000) {
    Q.pushFeed.run(user.id, `${user.name} ganó ${win.toLocaleString('es')} en ${gameLabel} (x${mult})`, win);
    Q.trimFeed.run();
  }
}

module.exports = {
  today, levelFor, awardXP, claimDaily,
  getMissions, missionEvent, claimMission,
  wheelStatus, spinWheel,
  tournamentBoard, settleTournament,
  feedWin,
};
