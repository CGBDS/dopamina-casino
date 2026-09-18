// Dopamina Casino — servidor.
// Todo el dinero, juegos y progreso se calculan aquí (el cliente solo muestra).
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const passport = require('passport');

const { db, Q, getUser } = require('./db');
const games = require('./games');
const D = require('./dopamine');
const shop = require('./shop');

const PORT = process.env.PORT || 3000;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const app = express();
app.set('trust proxy', 1);

// rachas de victorias en memoria (se reinician al reiniciar el servidor)
const streaks = new Map();

// ---------- sesiones ----------
const SQLiteStore = require('connect-sqlite3')(session);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, '..') }),
  secret: process.env.SESSION_SECRET || 'dopamina-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 3600e3, httpOnly: true },
}));

// ---------- webhook de Stripe (body crudo, antes del json) ----------
app.post('/api/shop/webhook', express.raw({ type: 'application/json' }), (req, res) => shop.handleWebhook(req, res));

app.use(express.json({ limit: '64kb' }));

// ---------- Google OAuth (solo si hay claves) ----------
const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
if (googleEnabled) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE}/auth/google/callback`,
  }, (at, rt, profile, done) => {
    try {
      let u = Q.getUserByGoogle.get(profile.id);
      if (!u) {
        const r = Q.createUser.run(profile.id, (profile.displayName || 'Jugador').slice(0, 24),
          (profile.photos && profile.photos[0] && profile.photos[0].value) || null, 0);
        u = getUser(r.lastInsertRowid);
      }
      done(null, u.id);
    } catch (e) { done(e); }
  }));
  passport.serializeUser((id, done) => done(null, id));
  passport.deserializeUser((id, done) => done(null, id));
  app.use(passport.initialize());
  app.use(passport.session());
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));
  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/?login=error' }),
    (req, res) => { req.session.userId = req.user; res.redirect('/'); });
}

// ---------- auth ----------
app.get('/api/auth/status', (req, res) => res.json({ googleEnabled }));
app.post('/api/auth/guest', (req, res) => {
  const name = String(req.body.name || 'Jugador').replace(/[<>"]/g, '').trim().slice(0, 16) || 'Jugador';
  const r = Q.createUser.run(null, `${name}#${Math.floor(1000 + Math.random() * 9000)}`, null, 1);
  req.session.userId = r.lastInsertRowid;
  res.json({ ok: true, me: publicMe(getUser(req.session.userId)) });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

function requireAuth(req, res, next) {
  const u = req.session.userId && getUser(req.session.userId);
  if (!u) return res.status(401).json({ error: 'login' });
  req.user = u;
  next();
}

function publicMe(u) {
  if (!u) return null;
  const w = D.wheelStatus(u);
  const daily = Q.getDaily.get(u.id, D.today()) || { rounds: 0, wagered: 0, profit: 0 };
  return {
    id: u.id, name: u.name, avatar: u.avatar, coins: u.coins, xp: u.xp, level: u.level,
    streak: u.streak, isGuest: !!u.is_guest, biggestWin: u.biggest_win,
    canClaim: u.last_claim !== D.today(), wheelReady: w.ready, wheelWaitMs: w.waitMs,
    daily: { rounds: daily.rounds, wagered: daily.wagered, profit: daily.profit },
    nextLevelXp: (u.level * u.level) * 100,
  };
}
app.get('/api/me', requireAuth, (req, res) => res.json({ me: publicMe(req.user) }));

// ---------- límite de apuestas ----------
const playLimit = rateLimit({ windowMs: 60e3, max: 90, standardHeaders: false, legacyHeaders: false });
app.use('/api/play', playLimit);
app.use('/api/blackjack', playLimit);
app.use('/api/hilo', playLimit);

// ---------- núcleo de apuesta ----------
const GAME_LABEL = { slots: 'Tragamonedas', blackjack: 'Blackjack', roulette: 'Ruleta', coinflip: 'Cara o cruz', hilo: 'Mayor o menor', dice: 'Dados' };

function finalize(userId, bet, game, res) {
  let streak = streaks.get(userId) || 0;
  const won = res.win > bet;
  if (won) streak += 1; else if (res.win < bet) streak = 0;
  streaks.set(userId, streak);
  const bonus = won ? Math.floor(res.win * Math.min(streak, 10) * 0.02) : 0;
  const total = res.win + bonus;
  if (total > 0) Q.addCoins.run(total, userId);

  // stats diarias
  const date = D.today(), profit = total - bet;
  Q.upsertDaily.run(userId, date, bet, profit, '[]', res.mult || 0, 0);
  let row = Q.getDaily.get(userId, date);
  const set = new Set(JSON.parse(row.games_json || '[]'));
  const isNewGame = !set.has(game);
  set.add(game);
  Q.addDailyGame.run(JSON.stringify([...set]), userId, date);
  row = Q.getDaily.get(userId, date);
  if (streak > row.best_streak) db.prepare('UPDATE daily SET best_streak = ? WHERE user_id = ? AND date = ?').run(streak, userId, date);

  // dopamina: XP, misiones, feed
  const xpRes = D.awardXP(getUser(userId), bet);
  const fresh = getUser(userId);
  const evs = [{ type: 'round' }, { type: 'wager', amount: bet }];
  if (isNewGame) evs.push({ type: 'game', name: game });
  if (won && streak >= 1) evs.push({ type: 'streak', n: streak });
  if ((res.mult || 0) >= 8) evs.push({ type: 'bigwin' });
  const done = new Set();
  for (const e of evs) D.missionEvent(fresh, e, row).forEach(id => done.add(id));
  if (total > fresh.biggest_win) Q.setBiggestWin.run(total, userId);
  D.feedWin(fresh, GAME_LABEL[game], res.mult || 0, total);

  const me = getUser(userId);
  return { ...res, win: total, bonus, streak, balance: me.coins, xp: me.xp, level: me.level, levelUp: xpRes.leveled ? { level: xpRes.level, reward: xpRes.reward } : null, missionsDone: [...done] };
}

function play(userId, betRaw, game, fn) {
  const bet = Math.floor(Number(betRaw));
  const user = getUser(userId);
  if (!Number.isFinite(bet) || bet < 10) return { error: 'Apuesta mínima: 10 fichas' };
  if (bet > 100000) return { error: 'Apuesta máxima: 100,000 fichas' };
  if (bet > user.coins) return { error: 'No tienes suficientes fichas' };
  Q.addCoins.run(-bet, userId);
  const res = fn();
  return finalize(userId, bet, game, res);
}

// ---------- juegos de una ronda ----------
app.post('/api/play/slots', requireAuth, (req, res) => {
  res.json(play(req.user.id, req.body.bet, 'slots', () => games.playSlots(Math.floor(Number(req.body.bet)))));
});
app.post('/api/play/roulette', requireAuth, (req, res) => {
  const t = req.body.type, n = Number(req.body.number);
  const okTypes = ['red', 'black', 'even', 'odd', 'low', 'high', 'number'];
  if (!okTypes.includes(t)) return res.json({ error: 'Apuesta inválida' });
  if (t === 'number' && (!Number.isInteger(n) || n < 0 || n > 36)) return res.json({ error: 'Número inválido' });
  res.json(play(req.user.id, req.body.bet, 'roulette', () => games.playRoulette(Math.floor(Number(req.body.bet)), t, n)));
});
app.post('/api/play/coinflip', requireAuth, (req, res) => {
  if (!['cara', 'cruz'].includes(req.body.choice)) return res.json({ error: 'Elige cara o cruz' });
  res.json(play(req.user.id, req.body.bet, 'coinflip', () => games.playCoinflip(Math.floor(Number(req.body.bet)), req.body.choice)));
});
app.post('/api/play/dice', requireAuth, (req, res) => {
  res.json(play(req.user.id, req.body.bet, 'dice', () => games.playDice(Math.floor(Number(req.body.bet)))));
});

// ---------- blackjack (varias rondas) ----------
app.post('/api/blackjack/start', requireAuth, (req, res) => {
  const bet = Math.floor(Number(req.body.bet));
  const user = req.user;
  if (!Number.isFinite(bet) || bet < 10) return res.json({ error: 'Apuesta mínima: 10 fichas' });
  if (bet > 100000) return res.json({ error: 'Apuesta máxima: 100,000 fichas' });
  if (bet > user.coins) return res.json({ error: 'No tienes suficientes fichas' });
  Q.addCoins.run(-bet, user.id);
  const r = games.bjStart(bet);
  if (r.done) {
    const f = finalize(user.id, bet, 'blackjack', { mult: r.mult, win: Math.floor(bet * r.mult), label: r.label });
    return res.json({ ...f, player: r.player, dealer: r.dealer, playerVal: games.handValue(r.player), dealerVal: games.handValue(r.dealer) });
  }
  r.state.bet = bet;
  Q.setGameState.run(user.id, 'blackjack', JSON.stringify(r.state));
  res.json({ done: false, player: r.player, playerVal: games.handValue(r.player), dealerHidden: r.dealerHidden, balance: getUser(user.id).coins });
});
function bjAction(req, res, fn) {
  const gs = Q.getGameState.get(req.user.id);
  if (!gs || gs.game !== 'blackjack') return res.json({ error: 'No hay mano activa' });
  const state = JSON.parse(gs.state_json);
  const r = fn(state);
  const bet = state.bet;
  if (!r.done) {
    Q.setGameState.run(req.user.id, 'blackjack', JSON.stringify(r.state));
    return res.json({ done: false, player: r.player, playerVal: games.handValue(r.player), dealerHidden: r.dealerHidden });
  }
  Q.clearGameState.run(req.user.id);
  const f = finalize(req.user.id, bet, 'blackjack', { mult: r.mult, win: Math.floor(bet * r.mult), label: r.label });
  res.json({ ...f, player: r.player, dealer: r.dealer, playerVal: games.handValue(r.player), dealerVal: games.handValue(r.dealer) });
}
app.post('/api/blackjack/hit', requireAuth, (req, res) => bjAction(req, res, s => games.bjHit(s)));
app.post('/api/blackjack/stand', requireAuth, (req, res) => bjAction(req, res, s => games.bjStand(s)));

// ---------- mayor o menor ----------
app.post('/api/hilo/new', requireAuth, (req, res) => {
  const c = games.hiloNew();
  Q.setGameState.run(req.user.id, 'hilo', JSON.stringify({ card: c.card }));
  res.json({ card: c.card, name: c.name });
});
app.post('/api/hilo/guess', requireAuth, (req, res) => {
  const gs = Q.getGameState.get(req.user.id);
  if (!gs || gs.game !== 'hilo') return res.json({ error: 'Pide una carta primero' });
  if (!['higher', 'lower'].includes(req.body.guess)) return res.json({ error: 'Elige mayor o menor' });
  const { card } = JSON.parse(gs.state_json);
  const bet = Math.floor(Number(req.body.bet));
  const user = getUser(req.user.id);
  if (!Number.isFinite(bet) || bet < 10) return res.json({ error: 'Apuesta mínima: 10 fichas' });
  if (bet > user.coins) return res.json({ error: 'No tienes suficientes fichas' });
  Q.clearGameState.run(req.user.id);
  Q.addCoins.run(-bet, user.id);
  const r = games.hiloGuess(bet, card, req.body.guess);
  res.json(finalize(user.id, bet, 'hilo', r));
});

// ---------- dopamina ----------
app.post('/api/claim', requireAuth, (req, res) => {
  const r = D.claimDaily(getUser(req.user.id));
  if (!r.ok) return res.json(r);
  res.json({ ...r, balance: getUser(req.user.id).coins });
});
app.get('/api/missions', requireAuth, (req, res) => res.json({ missions: D.getMissions(req.user) }));
app.post('/api/missions/claim', requireAuth, (req, res) => {
  const r = D.claimMission(req.user, req.body.id);
  res.json({ ...r, balance: r.ok ? getUser(req.user.id).coins : undefined });
});
app.get('/api/wheel', requireAuth, (req, res) => res.json(D.wheelStatus(req.user)));
app.post('/api/wheel', requireAuth, (req, res) => {
  const r = D.spinWheel(getUser(req.user.id));
  res.json({ ...r, balance: r.ok ? getUser(req.user.id).coins : undefined });
});
app.get('/api/leaderboard', requireAuth, (req, res) => {
  const settled = D.settleTournament();
  res.json({
    byCoins: Q.topByCoins.all(), byWin: Q.topByWin.all(),
    tournament: D.tournamentBoard(), settled,
  });
});
app.get('/api/feed', requireAuth, (req, res) => res.json({ feed: Q.getFeed.all() }));

// ---------- tienda ----------
app.get('/api/shop', requireAuth, (req, res) => {
  res.json({ packs: shop.PACKS.map(p => ({ id: p.id, coins: p.coins, price: p.price, name: p.name, emoji: p.emoji })), configured: shop.configured() });
});
app.post('/api/shop/checkout', requireAuth, async (req, res) => {
  const r = await shop.createCheckout(req.user, req.body.pack, BASE);
  res.json(r);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- frontend ----------
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => console.log(`Dopamina Casino en puerto ${PORT} | Google: ${googleEnabled ? 'ON' : 'OFF'} | Stripe: ${shop.configured() ? 'ON' : 'OFF'}`));
