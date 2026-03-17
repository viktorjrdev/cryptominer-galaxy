// db/database.js — All database logic for CryptoMiner Galaxy

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'game.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// ─────────────────────────────────────────
//  SCHEMA
// ─────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id       TEXT    UNIQUE NOT NULL,
    username          TEXT    NOT NULL,
    coins             REAL    DEFAULT 0,
    total_earned      REAL    DEFAULT 0,
    tap_level         INTEGER DEFAULT 1,
    idle_level        INTEGER DEFAULT 0,
    multiplier_level  INTEGER DEFAULT 1,
    daily_streak      INTEGER DEFAULT 0,
    last_daily        TEXT,
    last_seen         TEXT    DEFAULT CURRENT_TIMESTAMP,
    referral_code     TEXT    UNIQUE,
    referred_by       TEXT,
    referral_count    INTEGER DEFAULT 0,
    premium_expires   TEXT,
    created_at        TEXT    DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─────────────────────────────────────────
//  UPGRADE TABLES (shared constants)
// ─────────────────────────────────────────
const UPGRADES = {
  tap: {
    costs:  [0, 100,  500,   2000,  10000, 50000 ],
    power:  [1,   2,    5,     10,     25,   100  ],
    maxLvl: 5
  },
  idle: {
    costs:  [0, 200,  1000,  5000,  20000, 100000],
    power:  [0, 0.5,    2,     8,     30,    150 ],
    maxLvl: 5
  },
  multiplier: {
    costs:  [0, 5000, 25000, 100000],
    power:  [1,  1.5,   2.5,      5],
    maxLvl: 3
  }
};

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
}

function calcIdleEarnings(user) {
  const now = new Date();
  const lastSeen = new Date(user.last_seen);
  // Cap idle earnings at 8 hours offline
  const secondsAway = Math.min((now - lastSeen) / 1000, 8 * 3600);

  const idleRate   = UPGRADES.idle.power[user.idle_level];
  const multiplier = UPGRADES.multiplier.power[user.multiplier_level - 1];
  const isPremium  = user.premium_expires && new Date(user.premium_expires) > now;
  const premiumMult = isPremium ? 2 : 1;

  return secondsAway * idleRate * multiplier * premiumMult;
}

// ─────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────
module.exports = {
  UPGRADES,

  // Create user (idempotent) — handles referral bonus
  createUser(telegramId, username, referralCode = '') {
    const existing = getUser(telegramId);
    if (existing) return existing;

    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    let referredBy = null;
    let startCoins = 0;

    if (referralCode) {
      const referrer = db.prepare('SELECT * FROM users WHERE referral_code = ?').get(referralCode);
      if (referrer && referrer.telegram_id !== String(telegramId)) {
        referredBy = referrer.telegram_id;
        startCoins = 250; // Welcome bonus for new user
        // Reward referrer
        db.prepare(`
          UPDATE users
          SET coins = coins + 500, total_earned = total_earned + 500,
              referral_count = referral_count + 1
          WHERE telegram_id = ?
        `).run(referrer.telegram_id);
      }
    }

    db.prepare(`
      INSERT INTO users (telegram_id, username, referral_code, referred_by, coins, total_earned)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(telegramId), username, code, referredBy, startCoins, startCoins);

    return getUser(telegramId);
  },

  // Get user and apply idle earnings
  getUser(telegramId) {
    const user = getUser(telegramId);
    if (!user) return null;

    const idleEarned = calcIdleEarnings(user);
    const now = new Date().toISOString();

    if (idleEarned > 0.001) {
      db.prepare(`
        UPDATE users
        SET coins = coins + ?, total_earned = total_earned + ?, last_seen = ?
        WHERE telegram_id = ?
      `).run(idleEarned, idleEarned, now, String(telegramId));
    } else {
      db.prepare('UPDATE users SET last_seen = ? WHERE telegram_id = ?').run(now, String(telegramId));
    }

    return getUser(telegramId);
  },

  // Record tap(s) and return updated user
  recordTap(telegramId, taps = 1) {
    const user = getUser(telegramId);
    if (!user) return null;

    const now = new Date();
    const tapPower  = UPGRADES.tap.power[user.tap_level - 1];
    const mult      = UPGRADES.multiplier.power[user.multiplier_level - 1];
    const isPremium = user.premium_expires && new Date(user.premium_expires) > now;
    const earned    = taps * tapPower * mult * (isPremium ? 2 : 1);

    db.prepare(`
      UPDATE users
      SET coins = coins + ?, total_earned = total_earned + ?, last_seen = ?
      WHERE telegram_id = ?
    `).run(earned, earned, now.toISOString(), String(telegramId));

    return getUser(telegramId);
  },

  // Buy an upgrade (tap | idle | multiplier)
  buyUpgrade(telegramId, type) {
    const user = getUser(telegramId);
    if (!user) return { error: 'User not found' };

    const upgrades = UPGRADES[type];
    if (!upgrades) return { error: 'Invalid upgrade type' };

    const currentLevel =
      type === 'tap'        ? user.tap_level :
      type === 'idle'       ? user.idle_level :
      /* multiplier */        user.multiplier_level;

    if (currentLevel >= upgrades.maxLvl) return { error: 'Already at max level!' };

    const nextLevel = currentLevel + 1;
    const cost = upgrades.costs[nextLevel];

    if (user.coins < cost) {
      return { error: `Need ${cost} 💎 (you have ${Math.floor(user.coins)})` };
    }

    const col =
      type === 'tap'        ? 'tap_level' :
      type === 'idle'       ? 'idle_level' :
      /* multiplier */        'multiplier_level';

    db.prepare(`UPDATE users SET coins = coins - ?, ${col} = ? WHERE telegram_id = ?`)
      .run(cost, nextLevel, String(telegramId));

    return getUser(telegramId);
  },

  // Claim daily reward — returns { reward, streak, user } or { error }
  claimDaily(telegramId) {
    const user = getUser(telegramId);
    if (!user) return { error: 'User not found' };

    const now     = new Date();
    const today   = now.toISOString().split('T')[0];
    const yesterday = new Date(now - 86400000).toISOString().split('T')[0];

    if (user.last_daily === today) {
      return { error: 'Already claimed today! Come back tomorrow.' };
    }

    const streak = user.last_daily === yesterday ? user.daily_streak + 1 : 1;
    const isPremium = user.premium_expires && new Date(user.premium_expires) > now;
    const reward = 100 * Math.min(streak, 7) * (isPremium ? 2 : 1);

    db.prepare(`
      UPDATE users
      SET coins = coins + ?, total_earned = total_earned + ?,
          daily_streak = ?, last_daily = ?
      WHERE telegram_id = ?
    `).run(reward, reward, streak, today, String(telegramId));

    return { reward, streak, user: getUser(telegramId) };
  },

  // Top 50 by total earned
  getLeaderboard(limit = 50) {
    return db.prepare(`
      SELECT username, total_earned AS coins, referral_count
      FROM users
      ORDER BY total_earned DESC
      LIMIT ?
    `).all(limit);
  },

  // Activate premium pass
  activatePremium(telegramId, days = 7) {
    const now    = new Date();
    const expires = new Date(now.getTime() + days * 86400000);
    db.prepare('UPDATE users SET premium_expires = ? WHERE telegram_id = ?')
      .run(expires.toISOString(), String(telegramId));
    return getUser(telegramId);
  }
};
