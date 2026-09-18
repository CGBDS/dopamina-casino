// Capa de base de datos (SQLite). Todo el dinero y progreso vive aquí.
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE,
  name TEXT NOT NULL,
  avatar TEXT,
  coins INTEGER NOT NULL DEFAULT 1000,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  streak INTEGER NOT NULL DEFAULT 0,
  last_claim TEXT,
  wheel_at TEXT,
  biggest_win INTEGER NOT NULL DEFAULT 0,
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  rounds INTEGER NOT NULL DEFAULT 0,
  wagered INTEGER NOT NULL DEFAULT 0,
  profit INTEGER NOT NULL DEFAULT 0,
  games_json TEXT NOT NULL DEFAULT '[]',
  max_mult REAL NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS missions (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  defs_json TEXT NOT NULL,
  prog_json TEXT NOT NULL,
  claimed_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  stripe_session TEXT UNIQUE,
  pack TEXT NOT NULL,
  coins INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS game_state (
  user_id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const Q = {
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByGoogle: db.prepare('SELECT * FROM users WHERE google_id = ?'),
  createUser: db.prepare('INSERT INTO users (google_id, name, avatar, is_guest) VALUES (?, ?, ?, ?)'),
  addCoins: db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?'),
  setCoins: db.prepare('UPDATE users SET coins = ? WHERE id = ?'),
  addXp: db.prepare('UPDATE users SET xp = xp + ?, level = ? WHERE id = ?'),
  setStreak: db.prepare('UPDATE users SET streak = ?, last_claim = ? WHERE id = ?'),
  setWheel: db.prepare('UPDATE users SET wheel_at = ? WHERE id = ?'),
  setBiggestWin: db.prepare('UPDATE users SET biggest_win = ? WHERE id = ?'),
  getDaily: db.prepare('SELECT * FROM daily WHERE user_id = ? AND date = ?'),
  upsertDaily: db.prepare(`
    INSERT INTO daily (user_id, date, rounds, wagered, profit, games_json, max_mult, best_streak)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      rounds = rounds + 1,
      wagered = wagered + excluded.wagered,
      profit = profit + excluded.profit,
      max_mult = max(max_mult, excluded.max_mult),
      best_streak = max(best_streak, excluded.best_streak)`),
  addDailyGame: db.prepare(`UPDATE daily SET games_json = ? WHERE user_id = ? AND date = ?`),
  getMissions: db.prepare('SELECT * FROM missions WHERE user_id = ? AND date = ?'),
  saveMissions: db.prepare(`
    INSERT INTO missions (user_id, date, defs_json, prog_json, claimed_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET prog_json = excluded.prog_json, claimed_json = excluded.claimed_json`),
  pushFeed: db.prepare('INSERT INTO feed (user_id, text, amount) VALUES (?, ?, ?)'),
  getFeed: db.prepare('SELECT f.text, f.amount, f.created_at, u.name FROM feed f JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 15'),
  trimFeed: db.prepare('DELETE FROM feed WHERE id NOT IN (SELECT id FROM feed ORDER BY id DESC LIMIT 60)'),
  topByCoins: db.prepare('SELECT name, avatar, coins, level FROM users ORDER BY coins DESC LIMIT 20'),
  topByWin: db.prepare('SELECT name, avatar, biggest_win FROM users WHERE biggest_win > 0 ORDER BY biggest_win DESC LIMIT 20'),
  topProfitDaily: db.prepare(`
    SELECT u.name, u.avatar, d.profit FROM daily d JOIN users u ON u.id = d.user_id
    WHERE d.date = ? AND d.profit > 0 ORDER BY d.profit DESC LIMIT 10`),
  setGameState: db.prepare(`
    INSERT INTO game_state (user_id, game, state_json) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET game = excluded.game, state_json = excluded.state_json, updated_at = datetime('now')`),
  getGameState: db.prepare('SELECT * FROM game_state WHERE user_id = ?'),
  clearGameState: db.prepare('DELETE FROM game_state WHERE user_id = ?'),
  createPurchase: db.prepare('INSERT INTO purchases (user_id, stripe_session, pack, coins, status) VALUES (?, ?, ?, ?, ?)'),
  completePurchase: db.prepare("UPDATE purchases SET status = 'done' WHERE stripe_session = ? AND status = 'pending'"),
  getPurchase: db.prepare('SELECT * FROM purchases WHERE stripe_session = ?'),
};

function getUser(id) { return Q.getUserById.get(id); }

module.exports = { db, Q, getUser };
