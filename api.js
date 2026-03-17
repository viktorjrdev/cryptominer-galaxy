// routes/api.js — REST API endpoints for the Mini App

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db/database');

// ─────────────────────────────────────────
//  Telegram initData validation middleware
// ─────────────────────────────────────────
function validateTelegramData(initData) {
  if (!initData) return null;
  try {
    const params    = new URLSearchParams(initData);
    const hash      = params.get('hash');
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

// Auth middleware
router.use((req, res, next) => {
  const initData = req.headers['x-telegram-init-data'] || req.body?.initData;

  // ⚠️  Dev-only bypass — remove in production
  if (process.env.NODE_ENV !== 'production' && req.body?.devUserId) {
    req.tgUser = {
      id: req.body.devUserId,
      first_name: 'DevUser',
      username: 'devuser'
    };
    return next();
  }

  const user = validateTelegramData(initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized — invalid Telegram data' });

  req.tgUser = user;
  next();
});

// ─────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────

// POST /api/init — called on every app load
router.post('/init', (req, res) => {
  const { id, username, first_name } = req.tgUser;
  const name = username || first_name || `user_${id}`;
  const ref  = req.body?.ref || '';

  db.createUser(id, name, ref);
  const user = db.getUser(id); // also applies idle earnings

  res.json({ user, upgrades: db.UPGRADES });
});

// POST /api/tap — batch tap submission
router.post('/tap', (req, res) => {
  // Accept up to 50 taps per request to prevent abuse
  const taps = Math.max(1, Math.min(Number(req.body?.taps) || 1, 50));
  const user = db.recordTap(req.tgUser.id, taps);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// POST /api/upgrade — buy an upgrade
router.post('/upgrade', (req, res) => {
  const { type } = req.body;
  if (!['tap', 'idle', 'multiplier'].includes(type)) {
    return res.status(400).json({ error: 'Invalid upgrade type' });
  }
  const result = db.buyUpgrade(req.tgUser.id, type);
  if (result?.error) return res.status(400).json({ error: result.error });
  res.json({ user: result });
});

// POST /api/daily — claim daily reward
router.post('/daily', (req, res) => {
  const result = db.claimDaily(req.tgUser.id);
  if (result?.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// GET /api/leaderboard — top 50
router.get('/leaderboard', (req, res) => {
  res.json({ leaderboard: db.getLeaderboard(50) });
});

// POST /api/premium — activate premium (call after verifying Stars payment)
router.post('/premium', (req, res) => {
  const days = Number(req.body?.days) || 7;
  const user = db.activatePremium(req.tgUser.id, days);
  res.json({ user });
});

// GET /api/config — public config for the frontend
router.get('/config', (req, res) => {
  res.json({ botUsername: process.env.BOT_USERNAME || '' });
});

module.exports = router;
