# 🚀 CryptoMiner Galaxy

A Telegram Mini App clicker game where players mine crypto coins in space, upgrade their mining rigs, earn idle income, and compete on leaderboards.

---

## 📋 FULL DEPLOYMENT GUIDE (Beginner-Friendly)

Follow these steps **in order**. Each section takes about 5–10 minutes.

---

## STEP 1 — Create Your Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send the message: `/newbot`
3. Choose a name for your bot (e.g. `CryptoMiner Galaxy`)
4. Choose a username — must end in `bot` (e.g. `CryptoMinerGalaxyBot`)
5. **BotFather will give you a token** — it looks like:
   ```
   1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```
   ⚠️ Save this — you need it in Step 3!

6. Also run `/setmenubutton` in BotFather:
   - Select your bot
   - Set button text: `🚀 Play Game`
   - URL: `https://your-app.up.railway.app` ← (you get this in Step 4)

---

## STEP 2 — Upload Your Code to GitHub

1. Go to [github.com](https://github.com) and sign in (create free account if needed)
2. Click the **+** icon → **New repository**
3. Name it `cryptominer-galaxy`, set to **Public**, click **Create**
4. On your computer, open a terminal in the project folder and run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/cryptominer-galaxy.git
   git push -u origin main
   ```

---

## STEP 3 — Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `cryptominer-galaxy` repo
4. Railway will start building — wait ~2 minutes

### Add your environment variables:
5. Click on your project → **Variables** tab → **Raw Editor**, then paste:

```
BOT_TOKEN=your_bot_token_here
BOT_USERNAME=CryptoMinerGalaxyBot
WEBAPP_URL=https://your-app-name.up.railway.app
NODE_ENV=production
PORT=3000
DB_PATH=/data/game.db
```

> ⚠️ Replace `BOT_TOKEN` with your real token from Step 1
> ⚠️ Replace `BOT_USERNAME` with your bot's username (no @)
> ⚠️ Replace `WEBAPP_URL` — you'll find this in Railway under **Settings → Domains**

### Add persistent storage (important!):
6. In your Railway project, click **+ New** → **Volume**
7. Set mount path to `/data`
8. Click **Deploy**

### Get your public URL:
9. Go to **Settings → Networking → Generate Domain**
10. Copy the URL (e.g. `https://cryptominer-abc123.up.railway.app`)
11. **Update** `WEBAPP_URL` in your Variables with this URL

---

## STEP 4 — Configure Your Bot's Mini App

1. Go back to **@BotFather** in Telegram
2. Send `/mybots` → select your bot → **Bot Settings** → **Menu Button**
3. Set the URL to your Railway URL from Step 3
4. Also send `/setdomain` and set it to your Railway domain
   (this allows the Mini App to work properly)

---

## STEP 5 — Test It!

1. Open Telegram and search for your bot
2. Send `/start`
3. You should see the welcome message with a **🚀 Launch Game** button
4. Tap it — the game should open!

---

## 💰 MONETIZATION SETUP

### Telegram Stars (In-App Purchases)

1. In **@BotFather**, send `/mypayments`
2. Connect a payment provider
3. Create invoice links for Premium Pass (50 Stars)
4. In `public/index.html`, find `buyPremium()` and add:
   ```javascript
   async function buyPremium(){
     // 1. Call your backend to create an invoice
     const { invoice_link } = await api('/create-invoice', { days: 7 });
     // 2. Open Telegram payment
     tg.openInvoice(invoice_link, async (status) => {
       if(status === 'paid'){
         const { user } = await api('/premium', { days: 7 });
         G.user = user;
         refreshUI();
         showToast('⭐ Premium activated!');
       }
     });
   }
   ```

### Ads via Adsgram

1. Sign up at [adsgram.ai](https://adsgram.ai)
2. Create an ad block for your Mini App
3. Get your `blockId`
4. Add to `index.html` (inside the Mine tab):
   ```html
   <button onclick="showAd()" class="tap-info" style="cursor:pointer">
     📺 Watch Ad → +500 💎
   </button>
   ```
   ```javascript
   async function showAd(){
     const AdController = window.Adsgram?.init({ blockId: 'YOUR_BLOCK_ID' });
     AdController?.show().then(async result => {
       if(result.done){
         // Reward the user
         const { user } = await api('/tap', { taps: 500 });
         G.user = user; G.coins = user.coins;
         updateCoinsEl(); showToast('🎉 +500 coins reward!');
       }
     });
   }
   ```
5. Add Adsgram script to `<head>`:
   ```html
   <script src="https://sad.adsgram.ai/js/sad.min.js"></script>
   ```

---

## 🎮 GAME MECHANICS

### Upgrades & Costs
| Upgrade | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
|---------|---------|---------|---------|---------|---------|
| **Tap Power** | 2 coins | 5 coins | 10 coins | 25 coins | 100 coins |
| **Cost** | 100 💎 | 500 💎 | 2,000 💎 | 10,000 💎 | 50,000 💎 |
| **Idle Rate** | 0.5/s | 2/s | 8/s | 30/s | 150/s |
| **Cost** | 200 💎 | 1,000 💎 | 5,000 💎 | 20,000 💎 | 100,000 💎 |
| **Multiplier** | 1.5× | 2.5× | 5× | — | — |
| **Cost** | 5,000 💎 | 25,000 💎 | 100,000 💎 | — | — |

### Daily Rewards (streak)
| Day | Reward | Premium |
|-----|--------|---------|
| 1 | 100 💎 | 200 💎 |
| 2 | 200 💎 | 400 💎 |
| 3 | 300 💎 | 600 💎 |
| 7 | 700 💎 | 1,400 💎 |

### Referral System
- Referrer: **+500 💎** per friend
- New user: **+250 💎** welcome bonus
- Tracked via unique referral codes

---

## 📂 File Structure

```
cryptominer-galaxy/
├── server.js          ← Main server + Telegram bot
├── package.json       ← Dependencies
├── railway.toml       ← Railway deployment config
├── .env.example       ← Environment variables template
├── db/
│   └── database.js    ← SQLite database + all game logic
├── routes/
│   └── api.js         ← REST API endpoints
└── public/
    └── index.html     ← The entire game (HTML + CSS + JS)
```

---

## 🔧 Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env file
cp .env.example .env

# 3. Fill in your BOT_TOKEN in .env
# Set NODE_ENV=development

# 4. Run locally
npm run dev
# Bot will use polling mode in development

# 5. Open http://localhost:3000 in browser
# (Add ?devUserId=test to bypass Telegram auth)
```

---

## 🤖 Testing with Agents

To test with automated agents:
- Use the `devUserId` body parameter (any unique string)
- Set `NODE_ENV=development` in your .env
- API base: `http://localhost:3000/api`

Example test flow:
```bash
# Init user
curl -X POST http://localhost:3000/api/init \
  -H "Content-Type: application/json" \
  -d '{"devUserId":"agent_1"}'

# Tap 10 times
curl -X POST http://localhost:3000/api/tap \
  -H "Content-Type: application/json" \
  -d '{"devUserId":"agent_1","taps":10}'

# Buy upgrade
curl -X POST http://localhost:3000/api/upgrade \
  -H "Content-Type: application/json" \
  -d '{"devUserId":"agent_1","type":"tap"}'

# Claim daily reward
curl -X POST http://localhost:3000/api/daily \
  -H "Content-Type: application/json" \
  -d '{"devUserId":"agent_1"}'

# Get leaderboard
curl http://localhost:3000/api/leaderboard
```

---

## ❓ Common Issues

**Bot doesn't respond:**
- Check BOT_TOKEN is correct in Railway Variables
- Check Railway logs for errors (Dashboard → Logs)

**Game doesn't open:**
- Make sure WEBAPP_URL matches your exact Railway URL
- Ensure you set the domain in @BotFather → /setdomain

**Database resets on redeploy:**
- Make sure you added the Volume in Railway with mount path `/data`
- Make sure `DB_PATH=/data/game.db` is in your env variables

**Unauthorized errors:**
- This happens when testing outside Telegram
- Set NODE_ENV=development and use devUserId for local testing

---

## 📈 Growth Tips

1. **Launch on ProductHunt** + Telegram crypto groups
2. **Airdrop tokens** to top miners (use leaderboard data)
3. **Seasonal events** — double coins weekends
4. **Guilds/clans** — next feature to add
5. **NFT integration** — sell rare planet skins

---

Built with ❤️ by CryptoMiner Galaxy
