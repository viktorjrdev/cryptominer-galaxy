// server.js — CryptoMiner Galaxy main server

require('dotenv').config();

const express    = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path       = require('path');
const cors       = require('cors');
const helmet     = require('helmet');
const db         = require('./db/database');

const app        = express();
const BOT_TOKEN  = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;   // e.g. https://your-app.railway.app
const PORT       = process.env.PORT || 3000;
const IS_PROD    = process.env.NODE_ENV === 'production';

if (!BOT_TOKEN)  throw new Error('❌  BOT_TOKEN missing in .env');
if (!WEBAPP_URL) throw new Error('❌  WEBAPP_URL missing in .env');

// ─────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP off — Telegram Mini App needs inline scripts
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────
//  TELEGRAM BOT
// ─────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: !IS_PROD });

// Webhook endpoint (production only)
if (IS_PROD) {
  app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
}

// Helper: format large numbers
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : Math.floor(n).toString();

// /start command
bot.onText(/\/start\s*(.*)/, async (msg, match) => {
  const chatId   = msg.chat.id;
  const userId   = msg.from.id;
  const username = msg.from.username || msg.from.first_name || `user_${userId}`;
  const refCode  = match[1].trim();

  // Create/fetch user
  db.createUser(userId, username, refCode);
  const user = db.getUser(userId);

  const welcomeText =
    `🚀 *Welcome to CryptoMiner Galaxy*, ${username}!\n\n` +
    `You're now a space crypto miner!\n\n` +
    `⛏️ *Tap* your planet to mine coins\n` +
    `🤖 *Upgrade* to earn while you sleep\n` +
    `💰 Current balance: *${fmt(user.coins)} 💎*\n` +
    `👥 Referrals: *${user.referral_count}*\n\n` +
    `🌌 Your galaxy awaits, commander!`;

  await bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Launch Game', web_app: { url: WEBAPP_URL } }],
        [
          { text: '👥 Invite Friends', callback_data: 'invite' },
          { text: '🏆 Leaderboard',    callback_data: 'leaderboard' }
        ],
        [{ text: '📊 My Stats', callback_data: 'stats' }]
      ]
    }
  });
});

// Callback queries
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  await bot.answerCallbackQuery(query.id);

  if (query.data === 'invite') {
    const user = db.getUser(userId);
    if (!user) return;
    const link = `https://t.me/${process.env.BOT_USERNAME}?start=${user.referral_code}`;
    await bot.sendMessage(chatId,
      `👥 *Your Referral Link*\n\n` +
      `${link}\n\n` +
      `💎 *You earn 500 coins* for every friend who joins!\n` +
      `🎁 Your friend gets *250 coins* welcome bonus too!`,
      { parse_mode: 'Markdown' }
    );
  }

  if (query.data === 'leaderboard') {
    const top = db.getLeaderboard(10);
    const medals = ['🥇','🥈','🥉'];
    const rows = top.map((u, i) =>
      `${medals[i] || `${i+1}.`} ${u.username} — ${fmt(u.coins)} 💎`
    ).join('\n');
    await bot.sendMessage(chatId, `🏆 *Top 10 Miners*\n\n${rows || 'No miners yet — be the first!'}`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🚀 Play Now', web_app: { url: WEBAPP_URL } }]] }
    });
  }

  if (query.data === 'stats') {
    const user = db.getUser(userId);
    if (!user) return;
    const tapPower = db.UPGRADES.tap.power[user.tap_level - 1];
    const idleRate = db.UPGRADES.idle.power[user.idle_level];
    const mult     = db.UPGRADES.multiplier.power[user.multiplier_level - 1];
    const isPremium = user.premium_expires && new Date(user.premium_expires) > new Date();
    await bot.sendMessage(chatId,
      `📊 *Your Stats*\n\n` +
      `💎 Coins: *${fmt(user.coins)}*\n` +
      `📈 Total earned: *${fmt(user.total_earned)}*\n` +
      `⚡ Tap power: *${tapPower * mult}*\n` +
      `🤖 Idle rate: *${(idleRate * mult).toFixed(1)}/s*\n` +
      `🔥 Daily streak: *${user.daily_streak} days*\n` +
      `👥 Referrals: *${user.referral_count}*\n` +
      `${isPremium ? '⭐ Premium: ACTIVE\n' : ''}`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🚀 Play Now', web_app: { url: WEBAPP_URL } }]] }
      }
    );
  }
});

// ─────────────────────────────────────────
//  API ROUTES
// ─────────────────────────────────────────
app.use('/api', require('./routes/api'));

// Catch-all → serve the Mini App
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────
//  START
// ─────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 CryptoMiner Galaxy server running on port ${PORT}`);
  console.log(`🌐 WEBAPP_URL: ${WEBAPP_URL}`);

  if (IS_PROD) {
    const webhookUrl = `${WEBAPP_URL}/webhook/${BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set: ${webhookUrl}`);
  } else {
    console.log('🔄 Bot polling started (dev mode)');
  }
});
