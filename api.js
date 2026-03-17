// routes/api.js — REST API endpoints for CryptoMiner Galaxy

const express    = require('express');
const router     = express.Router();
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');
const db         = require('../db/database');

// ─────────────────────────────────────────
//  Rate limiters  (H-7 fix)
// ─────────────────────────────────────────
const tapLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 60,
  keyGenerator: (req) => String(req.tgUser?.id || req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down! Too many taps.' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => String(req.tgUser?.id || req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});

// ─────────────────────────────────────────
//  Telegram initData validation  (C-3 confirmed implemented)
// ─────────────────────────────────────────
function validateTelegramData(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash   = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();

    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (hash !== expectedHash) return null;

    const userParam = params.get('user');
    return userParam ? JSON.parse(userParam) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────
//  Auth middleware
// ─────────────────────────────────────────
router.use((req, res, next) => {
  const initData = req.headers['x-telegram-init-data'] || req.body?.initData;

  // Dev-only bypass — strictly gated, never active in production  (C-3 fix)
  if (process.env.NODE_ENV !== 'production' && req.body?.devUserId) {
    req.tgUser = {
      id:         String(req.body.devUserId),
      first_name: 'DevUser',
      username:   'devuser'
    };
    return next();
  }

  const user = validateTelegramData(initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized — invalid Telegram data' });

  req.tgUser = user;
  next();
});

router.use(apiLimiter);

// ─────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────

router.post('/init', (req, res) => {
  const { id, username, first_name } = req.tgUser;
  const name = username || first_name || `user_${id}`;
  const ref  = req.body?.ref || '';

  db.createUser(id, name, ref);
  const user = db.getUser(id);  // applies idle earnings + computes energy

  res.json({
    user,
    upgrades: db.UPGRADES,
    config: {
      maxEnergy:      db.ENERGY.max,
      regenPerSec:    db.ENERGY.regenPerSec,
      referrerReward: 500,
      referreeReward: 250,
    }
  });
});

// Server-side tap cap at 30  (H-7 fix)
router.post('/tap', tapLimiter, (req, res) => {
  const taps = Math.max(1, Math.min(Number(req.body?.taps) || 1, 30));
  const user = db.recordTap(req.tgUser.id, taps);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// Balance check happens inside db.buyUpgrade  (H-6 confirmed)
router.post('/upgrade', (req, res) => {
  const { type } = req.body;
  if (!['tap', 'idle', 'multiplier'].includes(type)) {
    return res.status(400).json({ error: 'Invalid upgrade type' });
  }
  const result = db.buyUpgrade(req.tgUser.id, type);
  if (result?.error) return res.status(400).json({ error: result.error });
  res.json({ user: result });
});

router.post('/daily', (req, res) => {
  const result = db.claimDaily(req.tgUser.id);
  if (result?.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.get('/leaderboard', (req, res) => {
  res.json({ leaderboard: db.getLeaderboard(50) });
});

// GET /api/friends — referral list  (H-4 fix)
router.get('/friends', (req, res) => {
  const friends = db.getFriends(req.tgUser.id);
  res.json({ friends });
});

router.post('/premium', (req, res) => {
  const days = Math.max(1, Math.min(Number(req.body?.days) || 7, 30));
  const user = db.activatePremium(req.tgUser.id, days);
  res.json({ user });
});

router.get('/config', (req, res) => {
  res.json({
    botUsername:    process.env.BOT_USERNAME || '',
    referrerReward: 500,
    referreeReward: 250,
    maxEnergy:      db.ENERGY.max,
    regenPerSec:    db.ENERGY.regenPerSec,
  });
});

module.exports = router;
