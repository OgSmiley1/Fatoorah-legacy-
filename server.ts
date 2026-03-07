import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import { initDatabase, getMerchants, getMerchantById, updateMerchantStatus, updateMerchantNotes, setFollowUp, getStats, getSearchRuns, getEvidenceForMerchant, getMerchantCount } from "./server/database.js";
import { searchMerchants, SearchParams } from "./server/searchService.js";
import { logger } from "./server/logger.js";

async function startServer() {
  // Initialize database
  initDatabase();

  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  const PORT = 3000;

  // ─── Health ───
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", merchants: getMerchantCount() });
  });

  // ─── Search ───
  app.post("/api/search", async (req, res) => {
    try {
      const params: SearchParams = req.body;
      if (!params.keywords) {
        return res.status(400).json({ error: "Keywords are required" });
      }
      const result = await searchMerchants(params);

      // Notify connected dashboards
      io.emit("search-completed", {
        searchRunId: result.searchRunId,
        newCount: result.merchants.length,
        duplicatesRemoved: result.duplicatesRemoved,
      });

      res.json(result);
    } catch (error: any) {
      logger.error("api.search.failed", { error: error.message });
      res.status(500).json({
        error: "Search failed",
        detail: error.message,
        stage: "api_handler"
      });
    }
  });

  // ─── Merchants ───
  app.get("/api/merchants", (req, res) => {
    try {
      const filters: any = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.minFitScore) filters.minFitScore = parseInt(req.query.minFitScore as string);
      if (req.query.minContactScore) filters.minContactScore = parseInt(req.query.minContactScore as string);
      if (req.query.category) filters.category = req.query.category;
      if (req.query.location) filters.location = req.query.location;
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
      if (req.query.offset) filters.offset = parseInt(req.query.offset as string);
      if (req.query.sortBy) filters.sortBy = req.query.sortBy;
      if (req.query.sortOrder) filters.sortOrder = req.query.sortOrder;

      const merchants = getMerchants(filters);
      res.json({ merchants, total: merchants.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/merchants/:id", (req, res) => {
    const merchant = getMerchantById(req.params.id);
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });
    const evidence = getEvidenceForMerchant(req.params.id);
    res.json({ ...merchant, evidence });
  });

  app.put("/api/merchants/:id/status", (req, res) => {
    const { status, notes } = req.body;
    const validStatuses = ['NEW', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'MEETING', 'QUALIFIED', 'NOT_QUALIFIED', 'REJECTED', 'ONBOARDED', 'ARCHIVED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    const success = updateMerchantStatus(req.params.id, status, notes);
    if (!success) return res.status(404).json({ error: "Merchant not found" });
    res.json({ success: true });
  });

  app.put("/api/merchants/:id/notes", (req, res) => {
    const { notes } = req.body;
    updateMerchantNotes(req.params.id, notes);
    res.json({ success: true });
  });

  app.put("/api/merchants/:id/followup", (req, res) => {
    const { date } = req.body;
    setFollowUp(req.params.id, date);
    res.json({ success: true });
  });

  // ─── Stats ───
  app.get("/api/stats", (_req, res) => {
    res.json(getStats());
  });

  // ─── Search Runs ───
  app.get("/api/search-runs", (_req, res) => {
    res.json(getSearchRuns());
  });

  // ─── Export ───
  app.post("/api/export", (req, res) => {
    const filters = req.body.filters || {};
    filters.limit = 10000;
    const merchants = getMerchants(filters);
    res.json({ merchants, count: merchants.length });
  });

  // ─── Telegram Server-Side Command Engine ───
  let lastUpdateId = 0;
  let isHunting = false;

  async function sendTelegramMessage(token: string, chatId: number | string, text: string): Promise<boolean> {
    try {
      // Truncate to Telegram limit
      const truncated = text.length > 4000 ? text.slice(0, 3997) + '...' : text;
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: truncated, parse_mode: 'Markdown' })
      });
      return response.ok;
    } catch (e: any) {
      logger.error('telegram.send.failed', { chatId, error: e.message });
      return false;
    }
  }

  function formatMerchantTelegram(m: any): string {
    return `🏢 *${m.business_name}*
📂 ${m.category || 'N/A'} | 📍 ${m.location || 'N/A'}
👥 Followers: ${(m.followers || 0).toLocaleString()}
⭐ Fit: ${m.fit_score}/100 | 📞 Contact: ${m.contact_score}/100
📱 Best route: ${m.contact_best_route || 'N/A'}
${m.fit_reason ? `💡 ${m.fit_reason}` : ''}
${m.phone ? `📞 ${m.phone}` : ''}${m.whatsapp ? ` | 💬 ${m.whatsapp}` : ''}
${m.email ? `📧 ${m.email}` : ''}
${m.url ? `🔗 ${m.url}` : ''}`;
  }

  async function handleTelegramCommand(token: string, chatId: number, text: string, userName: string) {
    const cmd = text.trim().toLowerCase();

    if (cmd.startsWith('/hunt')) {
      if (isHunting) {
        await sendTelegramMessage(token, chatId, '⏳ A hunt is already in progress. Please wait.');
        return;
      }

      const parts = text.replace('/hunt', '').trim();
      if (!parts) {
        await sendTelegramMessage(token, chatId, '❌ Usage: /hunt <keywords> [location]\nExample: /hunt Luxury Abayas Dubai');
        return;
      }

      // Parse keywords and optional location
      const words = parts.split(' ');
      let location = 'UAE';
      const cities = ['dubai', 'abu dhabi', 'sharjah', 'ajman', 'riyadh', 'jeddah', 'kuwait', 'doha', 'manama', 'muscat'];
      const lastWords = words.slice(-2).join(' ').toLowerCase();
      const lastWord = words[words.length - 1]?.toLowerCase();
      if (cities.some(c => lastWords.includes(c) || lastWord === c)) {
        location = words.pop()!;
        if (cities.some(c => words[words.length - 1]?.toLowerCase() === c.split(' ')[0])) {
          location = words.pop() + ' ' + location;
        }
      }
      const keywords = words.join(' ');

      isHunting = true;
      logger.info('telegram.hunt.started', { user: userName, keywords, location });
      await sendTelegramMessage(token, chatId, `🔍 Hunting for "${keywords}" in ${location}...`);

      try {
        const result = await searchMerchants({ keywords, location, maxResults: 10 });

        if (result.merchants.length === 0) {
          await sendTelegramMessage(token, chatId,
            `⚠️ No new merchants found for "${keywords}".\n${result.duplicatesRemoved > 0 ? `(${result.duplicatesRemoved} duplicates excluded)` : ''}\n${result.errors.length > 0 ? `Errors: ${result.errors[0]}` : ''}`
          );
        } else {
          await sendTelegramMessage(token, chatId,
            `🎯 Found ${result.merchants.length} NEW leads for "${keywords}"!\n📊 ${result.totalCandidates} candidates → ${result.duplicatesRemoved} dupes removed`
          );

          const limit = Math.min(result.merchants.length, 10);
          for (let i = 0; i < limit; i++) {
            await sendTelegramMessage(token, chatId, formatMerchantTelegram(result.merchants[i]));
            if (i < limit - 1) await new Promise(r => setTimeout(r, 500));
          }
        }

        // Notify dashboard
        io.emit("search-completed", { searchRunId: result.searchRunId, newCount: result.merchants.length, source: 'telegram' });
      } catch (e: any) {
        await sendTelegramMessage(token, chatId, `❌ Hunt failed: ${e.message}`);
        logger.error('telegram.hunt.failed', { error: e.message });
      } finally {
        isHunting = false;
      }
      return;
    }

    if (cmd === '/newonly') {
      const stats = getStats();
      await sendTelegramMessage(token, chatId, `📊 NEW leads: ${stats.byStatus['NEW'] || 0}\nTotal in DB: ${stats.total}`);
      return;
    }

    if (cmd === '/status') {
      const stats = getStats();
      let msg = '📊 *Pipeline Status*\n';
      for (const [status, count] of Object.entries(stats.byStatus)) {
        msg += `${status}: ${count}\n`;
      }
      msg += `\nAvg Fit: ${stats.avgFitScore} | Avg Contact: ${stats.avgContactScore}\nNew this week: ${stats.newThisWeek}`;
      await sendTelegramMessage(token, chatId, msg);
      return;
    }

    if (cmd === '/recent') {
      const merchants = getMerchants({ sortBy: 'first_found_date', sortOrder: 'DESC', limit: 5 });
      if (merchants.length === 0) {
        await sendTelegramMessage(token, chatId, '📭 No merchants in database yet. Use /hunt to start.');
        return;
      }
      await sendTelegramMessage(token, chatId, `📋 *Last 5 Merchants:*`);
      for (const m of merchants) {
        await sendTelegramMessage(token, chatId, formatMerchantTelegram(m));
        await new Promise(r => setTimeout(r, 500));
      }
      return;
    }

    if (cmd === '/contactable') {
      const merchants = getMerchants({ minContactScore: 50, sortBy: 'contact_score', sortOrder: 'DESC', limit: 5 });
      if (merchants.length === 0) {
        await sendTelegramMessage(token, chatId, '📭 No highly contactable merchants yet.');
        return;
      }
      await sendTelegramMessage(token, chatId, `📞 *Top 5 Contactable:*`);
      for (const m of merchants) {
        await sendTelegramMessage(token, chatId, formatMerchantTelegram(m));
        await new Promise(r => setTimeout(r, 500));
      }
      return;
    }

    if (cmd === '/highfit') {
      const merchants = getMerchants({ minFitScore: 60, sortBy: 'fit_score', sortOrder: 'DESC', limit: 5 });
      if (merchants.length === 0) {
        await sendTelegramMessage(token, chatId, '📭 No high-fit merchants yet.');
        return;
      }
      await sendTelegramMessage(token, chatId, `⭐ *Top 5 High-Fit:*`);
      for (const m of merchants) {
        await sendTelegramMessage(token, chatId, formatMerchantTelegram(m));
        await new Promise(r => setTimeout(r, 500));
      }
      return;
    }

    if (cmd === '/start' || cmd === '/help') {
      await sendTelegramMessage(token, chatId,
        `👋 *MyFatoorah Acquisition Engine*\n\nCommands:\n/hunt <keywords> [location] — Find merchants\n/newonly — Count of NEW leads\n/status — Pipeline stats\n/recent — Last 5 merchants\n/contactable — Top contactable leads\n/highfit — Top high-fit leads`
      );
      return;
    }

    await sendTelegramMessage(token, chatId, `❓ Unknown command. Use /help for available commands.`);
  }

  async function pollTelegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
      const data: any = await response.json();

      if (data.ok && data.result) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          const message = update.message;
          if (message?.text) {
            await handleTelegramCommand(token, message.chat.id, message.text.trim(), message.from?.first_name || 'User');
          }
        }
      }
    } catch (error: any) {
      logger.error("telegram.polling.error", { error: error.message });
    }

    setTimeout(pollTelegram, 1000);
  }

  pollTelegram();

  // ─── Socket.io ───
  io.on("connection", (socket) => {
    logger.info("socket.connected", { id: socket.id });

    // Frontend can trigger search too (for UI-initiated searches)
    socket.on("manual-hunt", async (data: { query: string; chatId?: string }) => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token && data.chatId) {
        await sendTelegramMessage(token, parseInt(data.chatId),
          `🖥️ Dashboard hunt started: "${data.query}"`
        );
      }
    });
  });

  // ─── Vite / Static ───
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
    logger.info("server.started", { port: PORT });
  });
}

startServer();
