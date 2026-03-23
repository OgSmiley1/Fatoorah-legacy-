import 'dotenv/config';
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import db from "./db";
import { v4 as uuidv4 } from "uuid";
import { huntMerchants } from "./server/searchService";
import { logger } from "./server/logger";
import { computeFitScore } from "./server/scoringService";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  
  if (!process.env.SESSION_SECRET) {
    console.warn('[WARN] SESSION_SECRET not set. Using default secret. Set SESSION_SECRET env var for production.');
  }
  app.use(session({
    secret: process.env.SESSION_SECRET || 'smiley-wizard-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  const huntRequests = new Map<string, number>();

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('hunt-finished', async (data: any) => {
      const { merchants, query } = data;
      const chatId = huntRequests.get(query);
      if (chatId) {
        const newLeads = merchants.filter((m: any) => m.status === 'NEW');
        if (newLeads.length === 0) {
          await sendTelegram(chatId, `⚠️ No new merchants found for "${query}".`);
        } else {
          await sendTelegram(chatId, `🎯 FOUND ${newLeads.length} NEW LEADS FOR "${query}":`);
          for (const m of newLeads) {
            const msg = `
🏢 *${m.businessName}*
📂 Category: ${m.category}
📱 IG: @${m.instagramHandle || 'N/A'}
⭐ Fit Score: ${m.fitScore}/100
📞 Phone: ${m.phone || 'N/A'}
💬 WhatsApp: ${m.whatsapp || 'N/A'}
🔗 [View Source](${m.url})
            `.trim();
            await sendTelegram(chatId, msg, 'Markdown');
          }
        }
        huntRequests.delete(query);
      }
    });
  });

  const PORT = parseInt(process.env.PORT || '3000');

  // --- API ROUTES ---

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Discovery Search
  app.post("/api/search", async (req, res) => {
    const { keywords, location, maxResults } = req.body;
    try {
      const result = await huntMerchants(
        { keywords, location, maxResults },
        (count) => io.emit('hunt-progress', { query: keywords, count })
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Server-side Gemini AI search — keeps API key on server, not exposed to browser
  app.post("/api/ai-search", async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
    }

    const { keywords, location, maxResults, emirate } = req.body;
    const targetLocation = emirate && emirate !== 'All' ? emirate : (location || 'UAE');

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Find ${maxResults || 30} real, currently active merchants and businesses in ${targetLocation}, United Arab Emirates related to: ${keywords}.

CRITICAL REQUIREMENTS:
- Only return REAL businesses with verifiable contact information
- Each MUST have at least one: phone number (UAE format +971 or 05x), email, or WhatsApp number
- Prioritize businesses that offer Cash on Delivery (COD) or currently lack online payment gateways — these are high-value leads for payment solution providers
- Include their Instagram handle (@handle format) if they have one
- Include their website URL if available
- Focus on local SMEs, home businesses, Instagram sellers, and independent retailers — NOT international chains
- Diversify across at least 5 different business categories
- For each business, note whether they appear to accept COD payments

For each merchant provide:
- businessName: The actual registered or trading name
- platform: Where you found them (instagram, facebook, tiktok, website)
- url: Direct link to their profile or website
- instagramHandle: Their Instagram username without @
- phone: UAE phone number (+971 format preferred)
- email: Business email address
- category: Specific category (e.g., "Handmade Jewelry", "Cloud Kitchen", "Luxury Abayas")
- physicalAddress: Their location/address in the UAE
- isCOD: Whether they appear to offer Cash on Delivery ("true" or "false")
- evidence: A short snippet explaining why this is a real, active business
- website: Their website URL if different from main url
- whatsapp: WhatsApp number if different from phone`;

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                businessName: { type: Type.STRING },
                platform: { type: Type.STRING },
                url: { type: Type.STRING },
                instagramHandle: { type: Type.STRING },
                phone: { type: Type.STRING },
                email: { type: Type.STRING },
                facebookUrl: { type: Type.STRING },
                tiktokHandle: { type: Type.STRING },
                physicalAddress: { type: Type.STRING },
                category: { type: Type.STRING },
                dulNumber: { type: Type.STRING },
                isCOD: { type: Type.STRING },
                evidence: { type: Type.STRING },
                website: { type: Type.STRING },
                whatsapp: { type: Type.STRING }
              },
              required: ['businessName', 'platform', 'url']
            }
          }
        }
      });

      const text = response.text;
      if (!text) {
        return res.json({ merchants: [] });
      }

      const merchants = JSON.parse(text);
      const { computeWeightedScore, computeRiskAssessment: riskAssess, computeVerification } = await import('./server/scoringService');

      const enriched = merchants.map((m: any) => {
        const isCOD = m.isCOD === 'true' || m.isCOD === true;
        const merchantData = {
          ...m,
          isCOD,
          whatsapp: m.whatsapp || m.phone,
          location: targetLocation,
          verificationSources: ['gemini_ai', 'google_search'],
          _phoneSources: m.phone ? ['gemini_ai'] : [],
          _emailSources: m.email ? ['gemini_ai'] : [],
          _enrichmentSources: ['google_search'],
        };

        const weighted = computeWeightedScore(merchantData);
        const risk = riskAssess(merchantData);
        const verification = computeVerification(merchantData);

        return {
          ...merchantData,
          qualityScore: weighted.composite,
          evaluationGrade: weighted.grade,
          evaluationBreakdown: weighted.breakdown,
          evaluationRecommendation: weighted.recommendation,
          risk,
          verification,
          evidence: [{ title: "AI + Google Search Verified", uri: m.url, snippet: m.evidence || "Found via Gemini AI with Google Search grounding" }],
          contactValidation: {
            status: verification.status === 'VERIFIED' ? 'VERIFIED' : (m.phone || m.email) ? 'PARTIALLY_VERIFIED' : 'UNVERIFIED',
            sources: ["Gemini AI", "Google Search", m.platform]
          }
        };
      });

      logger.info('ai_search_completed', { keywords, location: targetLocation, count: enriched.length });
      res.json({ merchants: enriched });
    } catch (error: any) {
      logger.error('ai_search_failed', { keywords, error: error.message });
      res.status(500).json({ error: error.message, merchants: [] });
    }
  });

  // Server-side Gemini chat endpoint
  app.post("/api/ai-chat", async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({ text: "AI chat is not available — GEMINI_API_KEY not configured.", functionCalls: [] });
    }

    const { message, history } = req.body;
    try {
      const ai = new GoogleGenAI({ apiKey });
      const chat = ai.chats.create({
        model: "gemini-2.0-flash",
        config: {
          systemInstruction: `You are the "SMILEY WIZARD", the intelligent core of the MyFatoorah Acquisition Engine.
          Your mission is to help sales teams find, qualify, and manage merchants across the UAE.
          Be bold, efficient, and professional. Use emojis like 🧙‍♂️, ⚡, 📊, and 🎯.
          If a user asks to "find" or "hunt" merchants, respond with search instructions.
          Always mention you are using "Multi-Engine Intelligence" to gather data.`,
          tools: [{
            functionDeclarations: [
              {
                name: "search_merchants",
                parameters: {
                  type: Type.OBJECT,
                  description: "Search for new merchants/leads.",
                  properties: {
                    keywords: { type: Type.STRING },
                    location: { type: Type.STRING }
                  },
                  required: ["keywords", "location"]
                }
              },
              {
                name: "get_pipeline_stats",
                parameters: { type: Type.OBJECT, description: "Get pipeline stats.", properties: {} }
              }
            ]
          }]
        },
        history: history || []
      });

      const response = await chat.sendMessage({ message });
      res.json({
        text: response.text || '',
        functionCalls: response.functionCalls || []
      });
    } catch (error: any) {
      res.json({ text: `Error: ${error.message}`, functionCalls: [] });
    }
  });

  // Check if Gemini API key is available
  app.get("/api/ai-status", (req, res) => {
    res.json({ available: !!process.env.GEMINI_API_KEY });
  });

  // Ingestion
  app.post("/api/merchants/ingest", async (req, res) => {
    const { merchants, query, location } = req.body;
    try {
      const { ingestMerchants } = await import("./discovery");
      const result = await ingestMerchants({ merchants, query, location });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Leads Management
  app.get("/api/leads", (req, res) => {
    const { status } = req.query;
    let query = `
      SELECT l.*, m.*, l.id as lead_id 
      FROM leads l 
      JOIN merchants m ON l.merchant_id = m.id
    `;
    const params: any[] = [];
    
    if (status) {
      query += " WHERE l.status = ?";
      params.push(status);
    }
    
    query += " ORDER BY l.created_at DESC";
    
    const leads = db.prepare(query).all(...params) as any[];
    const safeParse = (json: string | null | undefined, fallback: any) => {
      if (!json) return fallback;
      try { return JSON.parse(json); } catch { return fallback; }
    };

    const processedLeads = leads.map(l => ({
      ...l,
      dulNumber: l.dul_number,
      facebookUrl: l.facebook_url,
      twitterHandle: l.twitter_handle,
      linkedinUrl: l.linkedin_url,
      tiktokHandle: l.tiktok_handle,
      telegramHandle: l.telegram_handle,
      physicalAddress: l.physical_address,
      qualityScore: l.quality_score,
      reliabilityScore: l.reliability_score,
      complianceScore: l.compliance_score,
      risk: safeParse(l.risk_assessment_json, { category: 'LOW', factors: [] }),
      revenue: { monthly: l.estimated_revenue || 0, annual: (l.estimated_revenue || 0) * 12 },
      pricing: { setupFee: l.setup_fee || 0, transactionRate: '2.5% + 1 AED', settlementCycle: 'T+1' },
      paymentGateway: l.payment_gateway,
      scripts: safeParse(l.scripts_json, {}),
      contactValidation: safeParse(l.contact_validation_json, { status: 'UNVERIFIED', sources: [] }),
      evidence: safeParse(l.evidence_json, [])
    }));
    res.json(processedLeads);
  });

  app.patch("/api/leads/:id", (req, res) => {
    const { id } = req.params;
    const { status, notes, next_action, follow_up_date, outcome } = req.body;
    
    const updates: string[] = [];
    const params: any[] = [];
    
    if (status) { updates.push("status = ?"); params.push(status); }
    if (notes !== undefined) { updates.push("notes = ?"); params.push(notes); }
    if (next_action !== undefined) { updates.push("next_action = ?"); params.push(next_action); }
    if (follow_up_date !== undefined) { updates.push("follow_up_date = ?"); params.push(follow_up_date); }
    if (outcome !== undefined) { updates.push("outcome = ?"); params.push(outcome); }
    
    updates.push("updated_at = CURRENT_TIMESTAMP");
    
    if (updates.length === 1) return res.status(400).json({ error: "No fields to update" });
    
    const sql = `UPDATE leads SET ${updates.join(", ")} WHERE id = ?`;
    params.push(id);
    
    db.prepare(sql).run(...params);
    res.json({ success: true });
  });

  // Stats
  app.get("/api/stats", (req, res) => {
    const stats = {
      total_merchants: db.prepare("SELECT COUNT(*) as count FROM merchants").get() as any,
      total_leads: db.prepare("SELECT COUNT(*) as count FROM leads").get() as any,
      new_leads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'NEW'").get() as any,
      onboarded: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'ONBOARDED'").get() as any,
      recent_runs: db.prepare("SELECT * FROM search_runs ORDER BY created_at DESC LIMIT 5").all()
    };
    res.json(stats);
  });

  // Logs
  app.get("/api/logs", (req, res) => {
    const logs = db.prepare("SELECT * FROM logs ORDER BY created_at DESC LIMIT 50").all();
    res.json(logs);
  });

  // --- TELEGRAM BOT (SERVER-SIDE) ---

  let lastUpdateId = 0;
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
          if (!message || !message.text) continue;

          const text = message.text.trim();
          const chatId = message.chat.id;

          if (text.startsWith('/hunt')) {
            const query = text.replace('/hunt', '').trim();
            if (!query) {
              await sendTelegram(chatId, "❌ Please provide keywords. Example: /hunt Luxury Abayas Dubai");
              continue;
            }

            await sendTelegram(chatId, `🧙‍♂️ SMILEY WIZARD: Starting server-side hunt for "${query}"...`);
            io.emit('hunt-started', { query });
            
            try {
              // Split query into keywords and location if possible, or just use as keywords
              const parts = query.split(' ');
              const location = parts.length > 1 ? parts.pop() : 'Dubai';
              const keywords = parts.join(' ');
              
              const result = await huntMerchants(
                { keywords, location: location || 'Dubai' },
                (count) => io.emit('hunt-progress', { query, count })
              );
              
              io.emit('hunt-completed', { query, merchants: result.merchants });

              if (result.newLeadsCount === 0) {
                await sendTelegram(chatId, `⚠️ No new merchants found for "${query}".`);
              } else {
                await sendTelegram(chatId, `🎯 FOUND ${result.newLeadsCount} NEW LEADS FOR "${query}":`);
                for (const m of result.merchants) {
                  const msg = `
🏢 *${m.businessName}*
📂 Category: ${m.category}
📱 IG: @${m.instagramHandle || 'N/A'}
⭐ Fit Score: ${computeFitScore(m.platform, 0)}/100
📞 Phone: ${m.phone || 'N/A'}
💬 WhatsApp: ${m.whatsapp || 'N/A'}
🔗 [View Source](${m.url})
                  `.trim();
                  await sendTelegram(chatId, msg, 'Markdown');
                }
              }
            } catch (error: any) {
              await sendTelegram(chatId, `❌ Hunt failed: ${error.message}`);
            }
          } else if (text.startsWith('/export')) {
            const status = text.replace('/export', '').trim().toUpperCase() || 'NEW';
            const query = `
              SELECT m.*, l.status as lead_status, l.created_at as lead_date
              FROM leads l
              JOIN merchants m ON l.merchant_id = m.id
              WHERE l.status = ?
              ORDER BY l.created_at DESC
            `;
            const leads = db.prepare(query).all(status) as any[];

            if (leads.length === 0) {
              await sendTelegram(chatId, `⚠️ No leads found with status "${status}".`);
              continue;
            }

            await sendTelegram(chatId, `📊 Exporting ${leads.length} leads with status "${status}"...`);

            const headers = [
              "Business Name", "Category", "Sub-Category", "Website", "IG Handle", 
              "Email", "Phone", "WhatsApp", "Confidence", "Fit Score", "Contact Score"
            ];
            
            const escapeCsv = (val: any) => {
              if (val === null || val === undefined) return "";
              const str = String(val);
              return (str.includes(",") || str.includes("\"") || str.includes("\n")) 
                ? `"${str.replace(/"/g, '""')}"` 
                : str;
            };

            const rows = leads.map(m => [
              m.business_name, m.category, m.subcategory, m.website, m.instagram_handle,
              m.email, m.phone, m.whatsapp, m.confidence_score, m.myfatoorah_fit_score, m.contactability_score
            ].map(escapeCsv).join(","));

            const csvContent = [headers.join(","), ...rows].join("\n");
            const fileName = `SmileyWizard_Leads_${status}_${new Date().toISOString().split('T')[0]}.csv`;
            const filePath = path.join(process.cwd(), fileName);

            fs.writeFileSync(filePath, csvContent);

            try {
              await sendTelegramDocument(chatId, filePath, `🎯 Exported ${leads.length} leads (${status})`);
            } finally {
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
          } else if (text === '/status') {
            const stats: any = db.prepare("SELECT COUNT(*) as count FROM merchants").get();
            const newLeads: any = db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'NEW'").get();
            await sendTelegram(chatId, `📊 *WIZARD STATUS*\n\nMerchants in DB: ${stats.count}\nNew Leads: ${newLeads.count}`, 'Markdown');
          } else if (text === '/recent') {
            const query = `
              SELECT m.*, l.status as lead_status
              FROM leads l
              JOIN merchants m ON l.merchant_id = m.id
              ORDER BY l.created_at DESC
              LIMIT 5
            `;
            const leads = db.prepare(query).all() as any[];
            if (leads.length === 0) {
              await sendTelegram(chatId, "📭 No leads in database yet.");
            } else {
              await sendTelegram(chatId, "🕒 *RECENT LEADS:*", 'Markdown');
              for (const m of leads) {
                const msg = `🏢 *${m.business_name}* (${m.lead_status})\n📂 ${m.category}\n⭐ Fit: ${m.myfatoorah_fit_score}/100`;
                await sendTelegram(chatId, msg, 'Markdown');
              }
            }
          } else if (text === '/start') {
            await sendTelegram(chatId, "👋 Welcome to Smiley Wizard Merchant Hunter!\n\nCommands:\n/hunt <keywords> - Start discovery\n/status - View DB stats\n/export <status> - Export leads to CSV (default: NEW)\n/recent - Last 5 leads");
          }
        }
      }
    } catch (error) {
      console.error("[Telegram] Polling error:", error);
    }
    setTimeout(pollTelegram, 1000);
  }

  async function sendTelegram(chatId: number, text: string, parseMode?: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode })
    });
  }

  async function sendTelegramDocument(chatId: number, filePath: string, caption: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('caption', caption);
    
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: 'text/csv' });
    formData.append('document', blob, path.basename(filePath));

    await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData
    });
  }

  pollTelegram();

  // --- VITE / STATIC SERVING ---

  // Enhanced CSV export — must be before Vite middleware
  // (Vite would intercept /api/export-csv otherwise in dev mode)
  app.get('/api/export-csv', (req, res) => {
    try {
      const leads = db.prepare(`
        SELECT
          m.business_name, m.category, m.city, m.phone, m.email, m.whatsapp,
          m.instagram_handle, m.facebook_url, m.tiktok_handle, m.physical_address,
          m.source_url, m.source_platform, m.dul_number, m.quality_score,
          m.reliability_score, m.compliance_score, m.confidence_score,
          m.contactability_score, m.myfatoorah_fit_score, m.payment_gateway,
          m.estimated_revenue, m.setup_fee, m.risk_assessment_json,
          m.contact_validation_json, m.metadata_json,
          l.status, l.created_at
        FROM leads l
        JOIN merchants m ON l.merchant_id = m.id
        ORDER BY m.quality_score DESC, l.created_at DESC
      `).all() as any[];

      if (leads.length === 0) {
        return res.status(404).send('No leads to export');
      }

      const safeParse = (json: string | null, fallback: any) => {
        if (!json) return fallback;
        try { return JSON.parse(json); } catch { return fallback; }
      };

      const headers = [
        'Business Name', 'Emirate', 'Category', 'Phone', 'WhatsApp', 'Email',
        'Instagram', 'Facebook', 'TikTok', 'Address', 'DUL Number',
        'COD Status', 'Verification Level', 'Composite Score', 'Grade',
        'Contact Score', 'Reliability Score', 'Compliance Score',
        'Payment Gateway', 'Est. Revenue (AED/mo)', 'Risk Level', 'Risk Flags',
        'Platform', 'Source URL', 'Status', 'Discovered At'
      ];

      const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return "";
        const str = String(val);
        return (str.includes(",") || str.includes("\"") || str.includes("\n"))
          ? `"${str.replace(/"/g, '""')}"` : str;
      };

      const rows = leads.map((l: any) => {
        const risk = safeParse(l.risk_assessment_json, { category: 'LOW', factors: [] });
        const validation = safeParse(l.contact_validation_json, { status: 'UNVERIFIED' });
        const meta = safeParse(l.metadata_json, {});
        const isCOD = meta.isCOD ? 'YES' : 'NO';
        const score = l.quality_score || 0;
        const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';

        return [
          l.business_name, l.city || '', l.category, l.phone, l.whatsapp, l.email,
          l.instagram_handle, l.facebook_url, l.tiktok_handle, l.physical_address, l.dul_number,
          isCOD, validation.status, score, grade,
          l.contactability_score, l.reliability_score, l.compliance_score,
          l.payment_gateway, l.estimated_revenue, risk.category,
          (risk.factors || []).join('; '),
          l.source_platform, l.source_url, l.status, l.created_at
        ].map(escapeCsv).join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=MyFatoorah_Leads_${new Date().toISOString().split('T')[0]}.csv`);
      res.status(200).send(csvContent);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- VITE / STATIC SERVING (must be AFTER all API routes) ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => res.sendFile("dist/index.html", { root: "." }));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
