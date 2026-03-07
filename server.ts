import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import cookieParser from "cookie-parser";
import axios from "axios";

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  
  // Session configuration for cross-origin iframe
  app.use(session({
    secret: process.env.SESSION_SECRET || 'smiley-wizard-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // GitHub OAuth Routes
  app.get('/api/auth/github/url', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: 'GitHub Client ID not configured' });
    }

    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'repo',
      state: Math.random().toString(36).substring(7)
    });

    res.json({ url: `https://github.com/login/oauth/authorize?${params.toString()}` });
  });

  app.get('/api/auth/github/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code provided');

    try {
      const response = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }, {
        headers: { Accept: 'application/json' }
      });

      const { access_token } = response.data;
      if (access_token) {
        (req.session as any).githubToken = access_token;
        
        // Get user info to store in session
        const userResponse = await axios.get('https://api.github.com/user', {
          headers: { Authorization: `token ${access_token}` }
        });
        (req.session as any).githubUser = userResponse.data.login;

        res.send(`
          <html>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'github' }, '*');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              </script>
              <p>Authentication successful. You can close this window.</p>
            </body>
          </html>
        `);
      } else {
        res.status(400).send('Failed to obtain access token');
      }
    } catch (error) {
      console.error('GitHub OAuth Error:', error);
      res.status(500).send('Authentication failed');
    }
  });

  app.get('/api/github/status', (req, res) => {
    const session = req.session as any;
    res.json({ 
      connected: !!session.githubToken,
      user: session.githubUser || null
    });
  });

  app.post('/api/github/create-repo', async (req, res) => {
    const session = req.session as any;
    const { name, description, isPrivate } = req.body;

    if (!session.githubToken) {
      return res.status(401).json({ error: 'GitHub not connected' });
    }

    try {
      const response = await axios.post('https://api.github.com/user/repos', {
        name,
        description,
        private: isPrivate,
        auto_init: true
      }, {
        headers: { 
          Authorization: `token ${session.githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      });

      res.json({ success: true, repo: response.data });
    } catch (error: any) {
      console.error('GitHub Create Repo Error:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({ 
        error: error.response?.data?.message || 'Failed to create repository' 
      });
    }
  });

  app.post('/api/github/logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // Telegram Polling Logic
  let lastUpdateId = 0;
  
  async function pollTelegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN; // We'll assume the user sets this in .env
    if (!token) return;

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
      const data: any = await response.json();

      if (data.ok && data.result) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          const message = update.message;
          if (message && message.text) {
            const text = message.text.trim();
            if (text.startsWith('/hunt')) {
              const query = text.replace('/hunt', '').trim();
              if (query) {
                console.log(`[Telegram] Received hunt command: ${query}`);
                io.emit('remote-hunt', {
                  query,
                  chatId: message.chat.id,
                  user: message.from.first_name
                });
                
                // Acknowledge to user
                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: message.chat.id,
                    text: `🧙‍♂️ SMILEY WIZARD: Intelligence request received for "${query}". Searching the GCC...`
                  })
                });
              } else {
                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: message.chat.id,
                    text: "❌ Please provide keywords. Example: /hunt Luxury Abayas Dubai"
                  })
                });
              }
            } else if (text === '/start') {
              await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: message.chat.id,
                  text: "👋 Welcome to Smiley Wizard Merchant Hunter!\n\nUse /hunt <keywords> to start a search.\nExample: /hunt Coffee Shops Riyadh"
                })
              });
            }
          }
        }
      }
    } catch (error) {
      console.error("[Telegram] Polling error:", error);
    }
    
    // Continue polling
    setTimeout(pollTelegram, 1000);
  }

  // Start polling if token is present
  pollTelegram();

  // Socket.io event handlers
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("manual-hunt", async (data) => {
      const { chatId, query } = data;
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token || !chatId) return;

      console.log(`[Telegram] Manual hunt started for "${query}"`);
      
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🧙‍♂️ DASHBOARD ACTION: Manual hunt started for "${query}". Results will be mirrored here shortly.`
        })
      });
    });

    socket.on("hunt-results", async (data) => {
      const { chatId, merchants, query } = data;
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token || !chatId) return;

      console.log(`[Telegram] Sending ${merchants.length} results to chat ${chatId}`);

      if (merchants.length === 0) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `⚠️ No new merchants found for "${query}".`
          })
        });
        return;
      }

      // Send a summary first
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🎯 FOUND ${merchants.length} LEADS FOR "${query}":`
        })
      });

      // Send each merchant (limit to 5 to avoid flooding)
      const limit = Math.min(merchants.length, 5);
      for (let i = 0; i < limit; i++) {
        const m = merchants[i];
        const text = `
🏢 *${m.businessName}*
📂 Category: ${m.category}
📱 IG: @${m.instagramHandle || 'N/A'}
👥 Followers: ${m.followers.toLocaleString()}
💰 Est. Monthly Loss: ${m.leakage.estimatedMonthlyLoss} AED
⚠️ Risk: ${m.risk.category}

📉 *REVENUE LEAKAGE:*
${m.leakage.missingMethods.map((method: string) => `• Missing ${method}`).join('\n')}
🚀 Solution: ${m.leakage.solution}

💬 *SUPREME OUTREACH SCRIPT (EN):*
\`\`\`
${m.scripts.english}
\`\`\`

🔗 [View Profile](${m.url})
        `.trim();

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
          })
        });
      }

      if (merchants.length > 5) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `...and ${merchants.length - 5} more. View them all in the dashboard!`
          })
        });
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
