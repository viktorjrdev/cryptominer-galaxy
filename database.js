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
    energy            INTEGER DEFAULT 100,
    energy_updated_at TEXT    DEFAULT CURRENT_TIMESTAMP,
    created_at        TEXT    DEFAULT CURRENT_TIMESTAMP
  );
`);

// Safe migration — adds energy columns to databases created before this patch
const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!cols.includes('energy')) {
  db.exec(`ALTER TABLE users ADD COLUMN energy INTEGER DEFAULT 100`);
  db.exec(`ALTER TABLE users ADD COLUMN energy_updated_at TEXT DEFAULT CURRENT_TIMESTAMP`);
  // Seed existing rows so they don't start with NULL
  db.exec(`UPDATE users SET energy = 100, energy_updated_at = CURRENT_TIMESTAMP WHERE energy IS NULL`);
}

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
//  ENERGY CONSTANTS
// ─────────────────────────────────────────
const ENERGY = {
  max:          100,   // maximum energy pool
  regenPerSec:  1/3,   // 1 energy every 3 seconds
};

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
}

// Calculate how much energy a user has RIGHT NOW based on stored value + time elapsed
function calcCurrentEnergy(user) {
  const stored      = user.energy ?? ENERGY.max;
  const updatedAt   = new Date(user.energy_updated_at || user.last_seen || Date.now());
  const secondsSince = Math.max(0, (Date.now() - updatedAt.getTime()) / 1000);
  const regenned    = secondsSince * ENERGY.regenPerSec;
  return Math.min(ENERGY.max, stored + regenned);
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
  ENERGY,

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

  // Get user, apply idle earnings, and return with computed current energy
  getUser(telegramId) {
    const user = getUser(telegramId);
    if (!user) return null;

    const idleEarned    = calcIdleEarnings(user);
    const currentEnergy = Math.floor(calcCurrentEnergy(user));
    const now           = new Date().toISOString();

    if (idleEarned > 0.001) {
      db.prepare(`
        UPDATE users
        SET coins = coins + ?, total_earned = total_earned + ?, last_seen = ?
        WHERE telegram_id = ?
      `).run(idleEarned, idleEarned, now, String(telegramId));
    } else {
      db.prepare('UPDATE users SET last_seen = ? WHERE telegram_id = ?').run(now, String(telegramId));
    }

    const fresh = getUser(telegramId);
    // Attach computed energy — not stored yet, will be written on next tap
    return { ...fresh, energy: currentEnergy, maxEnergy: ENERGY.max };
  },

  // Record tap(s) — validates energy server-side, deducts coins and energy atomically
  recordTap(telegramId, taps = 1) {
    const user = getUser(telegramId);
    if (!user) return null;

    const now           = new Date();
    const currentEnergy = calcCurrentEnergy(user);

    // Server enforces energy limit — silently cap taps to available energy  (M-1 fix)
    const allowedTaps = Math.min(taps, Math.floor(currentEnergy));
    if (allowedTaps <= 0) {
      // Return user with current energy so client can sync
      return { ...user, energy: 0, maxEnergy: ENERGY.max };
    }

    const tapPower   = UPGRADES.tap.power[user.tap_level - 1];
    const mult       = UPGRADES.multiplier.power[user.multiplier_level - 1];
    const isPremium  = user.premium_expires && new Date(user.premium_expires) > now;
    const earned     = allowedTaps * tapPower * mult * (isPremium ? 2 : 1);
    const newEnergy  = Math.max(0, currentEnergy - allowedTaps);
    const nowIso     = now.toISOString();

    db.prepare(`
      UPDATE users
      SET coins = coins + ?, total_earned = total_earned + ?,
          last_seen = ?, energy = ?, energy_updated_at = ?
      WHERE telegram_id = ?
    `).run(earned, earned, nowIso, Math.floor(newEnergy), nowIso, String(telegramId));

    const fresh = getUser(telegramId);
    return { ...fresh, energy: Math.floor(newEnergy), maxEnergy: ENERGY.max };
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

    // All comparisons in UTC to avoid timezone mismatches  (M-2 fix)
    const now       = new Date();
    const today     = now.toISOString().slice(0, 10);          // "YYYY-MM-DD" UTC
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);

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

  // Get list of users referred by this user  (H-4 fix)
  getFriends(telegramId) {
    return db.prepare(`
      SELECT username, total_earned, created_at
      FROM users
      WHERE referred_by = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(String(telegramId));
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
