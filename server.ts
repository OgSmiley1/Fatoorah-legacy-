import 'dotenv/config';
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import session from "express-session";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import db from "./db";
import { huntMerchants } from "./server/searchService";
import { initWhatsAppBot, getWAStatus, sendWAMessage } from "./server/whatsappBot";
import {
  computeQualityScore, computeReliabilityScore, computeComplianceScore,
  estimateRevenue, computeRiskAssessment, computeContactScore, computeConfidence,
  calculateMyFatoorahOffer
} from "./server/scoringService";

// SQLite-backed session store — no memory leaks, survives restarts
class SqliteStore extends session.Store {
  private cleanup: ReturnType<typeof setInterval>;
  constructor() {
    super();
    // Purge expired sessions every 15 minutes
    this.cleanup = setInterval(() => {
      try { db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now()); } catch {}
    }, 15 * 60 * 1000);
    if (this.cleanup.unref) this.cleanup.unref();
  }
  get(sid: string, cb: (err: any, session?: session.SessionData | null) => void) {
    try {
      const row = db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid) as any;
      if (!row || row.expired < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid: string, sess: session.SessionData, cb?: (err?: any) => void) {
    try {
      const maxAge = (sess.cookie?.maxAge ?? 86400) * 1000;
      const expired = Date.now() + maxAge;
      db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(sess), expired);
      cb?.();
    } catch (e) { cb?.(e); }
  }
  destroy(sid: string, cb?: (err?: any) => void) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb?.(); }
    catch (e) { cb?.(e); }
  }
  touch(sid: string, sess: session.SessionData, cb?: (err?: any) => void) {
    this.set(sid, sess, cb);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  const isProd = process.env.NODE_ENV === 'production';

  app.use(session({
    store: new SqliteStore(),
    secret: process.env.SESSION_SECRET || 'smiley-wizard-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: process.env.ALLOWED_ORIGIN || '*', methods: ["GET", "POST"] }
  });

  const huntRequests = new Map<string, number>();

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('hunt-finished', async (data: any) => {
      const { merchants, query } = data;
      if (!Array.isArray(merchants)) return;
      const chatId = huntRequests.get(query);
      if (chatId) {
        const newLeads = merchants.filter((m: any) => m.status === 'NEW');
        if (newLeads.length === 0) {
          await sendTelegram(chatId, `⚠️ No new merchants found for "${query}".`);
        } else {
          await sendTelegram(chatId, `🎯 FOUND ${newLeads.length} NEW LEADS FOR "${query}":`);
          for (const m of newLeads) {
            const msg = `
🏢 *${m.businessName || 'Unknown Business'}*
📂 Category: ${m.category || 'N/A'}
📱 IG: @${m.instagramHandle || 'N/A'}
⭐ Fit Score: ${m.fitScore || 0}/100
📞 Phone: ${m.phone || 'N/A'}
💬 WhatsApp: ${m.whatsapp || 'N/A'}
🔗 ${m.url || 'No URL'}
            `.trim();
            await sendTelegram(chatId, msg, 'Markdown');
          }
        }
        huntRequests.delete(query);
      }
    });
  });

  const PORT = parseInt(process.env.PORT || '3000', 10);

  // --- API ROUTES ---

  app.get("/api/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

  // MyFatoorah webhook receiver — idempotent upsert into existing merchants table
  app.post("/api/webhooks/myfatoorah", express.raw({ type: '*/*' }), async (req: any, res: any) => {
    try {
      const secret = process.env.WEBHOOK_SECRET || '';
      const sig = req.headers['x-myfatoorah-signature'] as string | undefined;
      if (secret && sig) {
        const { createHmac, timingSafeEqual } = await import('crypto');
        const hmac = createHmac('sha256', secret).update(req.body as Buffer).digest('hex');
        try {
          if (!timingSafeEqual(Buffer.from(hmac), Buffer.from(sig))) {
            return res.status(401).json({ ok: false, reason: 'invalid signature' });
          }
        } catch {
          return res.status(401).json({ ok: false, reason: 'invalid signature' });
        }
      }
      const payload = JSON.parse((req.body as Buffer).toString('utf8'));
      const m = payload.merchant || payload.data || payload;
      const name = m.name || m.merchantName || '';
      const phone = m.phone || m.contactPhone || '';
      if (!name) return res.status(400).json({ ok: false, reason: 'missing merchant name' });

      const { normalizeName, canonicalKey, canonicalIdFromKey } = await import('./src/lib/normalize.js');
      const { v4: uuidv4 } = await import('uuid');
      const canonicalId = canonicalIdFromKey(canonicalKey(name, m.address || '', phone));
      const normalizedName = normalizeName(name);
      const now = new Date().toISOString();

      // Upsert into existing merchants table
      const existing = db.prepare('SELECT id FROM merchants WHERE normalized_name = ?').get(normalizedName) as any;
      if (existing) {
        db.prepare('UPDATE merchants SET phone = COALESCE(phone, ?), email = COALESCE(email, ?), website = COALESCE(website, ?), metadata_json = ?, last_validated = ? WHERE id = ?')
          .run(phone || null, m.email || null, m.website || null, JSON.stringify({ webhookSource: 'myfatoorah', canonicalId, receivedAt: now }), now, existing.id);
      } else {
        const id = uuidv4();
        db.prepare(`INSERT INTO merchants (id, business_name, normalized_name, source_platform, phone, email, website, metadata_json, last_validated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, name, normalizedName, 'myfatoorah_webhook', phone || null, m.email || null, m.website || null, JSON.stringify({ webhookSource: 'myfatoorah', canonicalId, receivedAt: now }), now);
        db.prepare('INSERT INTO leads (id, merchant_id, status) VALUES (?, ?, ?)').run(uuidv4(), id, 'NEW');
      }
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[webhook] myfatoorah error:', err.message);
      return res.status(500).json({ ok: false });
    }
  });

  // Discovery Search
  app.post("/api/search", async (req, res) => {
    const { keywords, location, maxResults, onlyQualified, hunterType } = req.body;
    try {
      io.emit('hunt-started', { query: keywords });
      const result = await huntMerchants(
        { keywords, location, maxResults, onlyQualified, hunterType },
        (count: number, stage?: string) =>
          io.emit('hunt-progress', { query: keywords, count, stage: stage || 'searching' })
      );
      io.emit('hunt-completed', { query: keywords, merchants: result.merchants });
      res.json(result);
    } catch (error: any) {
      io.emit('hunt-error', { query: keywords, error: error.message });
      res.status(500).json({ error: error.message });
    }
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
    const { status, limit = '500', offset = '0' } = req.query;
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

    query += ` ORDER BY l.created_at DESC LIMIT ${parseInt(limit as string, 10) || 500} OFFSET ${parseInt(offset as string, 10) || 0}`;

    const leads = db.prepare(query).all(...params) as any[];
    const safeParseJson = (str: string | null, fallback: any) => {
      if (!str) return fallback;
      try { return JSON.parse(str); } catch { return fallback; }
    };
    const processedLeads = leads.map(l => {
      const metadata = safeParseJson(l.metadata_json, {});

      // Normalised merchant shape for scoring functions
      const mForScoring = {
        phone: l.phone,
        physicalAddress: l.physical_address,
        dulNumber: l.dul_number,
        instagramHandle: l.instagram_handle,
        facebookUrl: l.facebook_url,
        tiktokHandle: l.tiktok_handle,
        url: l.source_url,
        platform: l.source_platform,
        category: l.category,
        followers: l.followers ?? null,
        isCOD: Boolean(metadata.isCOD),
        email: l.email,
        whatsapp: l.whatsapp,
        evidence: safeParseJson(l.evidence_json, []),
      };

      // Use stored scores when present; compute live for old rows
      const qualityScore = l.quality_score || computeQualityScore(mForScoring);
      const reliabilityScore = l.reliability_score || computeReliabilityScore(mForScoring);
      const complianceScore = l.compliance_score || computeComplianceScore(mForScoring);

      // Persist computed scores back to DB so next fetch is instant
      if (!l.quality_score || !l.reliability_score || !l.compliance_score) {
        try {
          db.prepare(
            `UPDATE merchants SET quality_score=?, reliability_score=?, compliance_score=? WHERE id=?`
          ).run(qualityScore, reliabilityScore, complianceScore, l.merchant_id || l.id);
        } catch {}
      }

      // Revenue — use stored value or compute live
      const revenueEst = (metadata.revenue?.monthly != null && metadata.revenue.monthly > 0)
        ? metadata.revenue
        : estimateRevenue({ followers: mForScoring.followers, platform: mForScoring.platform, category: mForScoring.category, isCOD: mForScoring.isCOD });

      // Risk, scores and offer — live compute if not stored
      const risk = (metadata.risk?.category) ? metadata.risk : computeRiskAssessment(mForScoring);
      const contactScore = l.contactability_score || computeContactScore(mForScoring);
      const confidenceScore = l.confidence_score || computeConfidence(mForScoring);
      const pricing = (metadata.pricing?.transactionRate) ? metadata.pricing : calculateMyFatoorahOffer(mForScoring, risk, revenueEst);

      return {
        ...l,
        ...metadata,
        businessName: l.business_name,
        normalizedName: l.normalized_name,
        platform: l.source_platform,
        url: l.source_url,
        subCategory: l.subcategory,
        instagramHandle: l.instagram_handle,
        confidenceScore,
        contactScore,
        fitScore: l.myfatoorah_fit_score,
        qualityScore,
        reliabilityScore,
        complianceScore,
        dulNumber: l.dul_number,
        facebookUrl: l.facebook_url,
        twitterHandle: l.twitter_handle,
        linkedinUrl: l.linkedin_url,
        tiktokHandle: l.tiktok_handle,
        telegramHandle: l.telegram_handle,
        physicalAddress: l.physical_address,
        revenue: revenueEst,
        risk,
        pricing,
        contactValidation: safeParseJson(l.contact_validation_json, { status: 'UNVERIFIED', sources: [] }),
        evidence: safeParseJson(l.evidence_json, [])
      };
    });
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

    if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });

    updates.push("updated_at = CURRENT_TIMESTAMP");

    const sql = `UPDATE leads SET ${updates.join(", ")} WHERE id = ?`;
    params.push(id);

    db.prepare(sql).run(...params);
    res.json({ success: true });
  });

  // Apify-style dataset export — CSV and JSON
  app.get("/api/export/merchants.:format", (req, res) => {
    const format = (req.params.format || '').toLowerCase();
    if (format !== 'csv' && format !== 'json') {
      return res.status(400).json({ error: "format must be 'csv' or 'json'" });
    }
    const rows = db.prepare(`
      SELECT
        m.id, m.business_name, m.source_platform, m.source_url,
        m.phone, m.whatsapp, m.email, m.instagram_handle,
        m.facebook_url, m.tiktok_handle, m.physical_address,
        m.category, m.dul_number,
        m.confidence_score, m.contactability_score, m.myfatoorah_fit_score,
        m.metadata_json, m.first_seen as created_at,
        l.status as lead_status
      FROM merchants m
      LEFT JOIN leads l ON l.merchant_id = m.id
      ORDER BY m.myfatoorah_fit_score DESC, m.first_seen DESC
      LIMIT 5000
    `).all() as any[];

    const records = rows.map(r => {
      let metadata: any = {};
      try { metadata = r.metadata_json ? JSON.parse(r.metadata_json) : {}; } catch {}
      return {
        id: r.id,
        businessName: r.business_name,
        platform: r.source_platform,
        url: r.source_url,
        phone: r.phone,
        whatsapp: r.whatsapp,
        email: r.email,
        instagramHandle: r.instagram_handle,
        facebookUrl: r.facebook_url,
        tiktokHandle: r.tiktok_handle,
        physicalAddress: r.physical_address,
        category: r.category,
        dulNumber: r.dul_number,
        confidenceScore: r.confidence_score,
        contactScore: r.contactability_score,
        fitScore: r.myfatoorah_fit_score,
        isCOD: Boolean(metadata.isCOD),
        hasGateway: Boolean(metadata.hasGateway),
        paymentMethods: Array.isArray(metadata.paymentMethods) ? metadata.paymentMethods.join('|') : '',
        codEvidence: Array.isArray(metadata.codEvidence) ? metadata.codEvidence.join('|') : '',
        leadStatus: r.lead_status || 'NEW',
        createdAt: r.created_at,
      };
    });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="merchants.json"');
      return res.json(records);
    }

    // CSV — RFC4180 quoting
    const columns = records.length ? Object.keys(records[0]) : [
      'id', 'businessName', 'platform', 'url', 'phone', 'whatsapp', 'email',
      'instagramHandle', 'facebookUrl', 'tiktokHandle', 'physicalAddress',
      'category', 'dulNumber', 'confidenceScore', 'contactScore', 'fitScore',
      'isCOD', 'hasGateway', 'paymentMethods', 'codEvidence', 'leadStatus', 'createdAt',
    ];
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [columns.join(',')];
    for (const r of records) {
      lines.push(columns.map(c => esc((r as any)[c])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="merchants.csv"');
    res.send(lines.join('\n'));
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

  // --- AI CHAT (WizardChat) ---

  app.post("/api/ai-chat", async (req, res) => {
    const { message, history, systemPrompt } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    // Try Gemini
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2 || 'AIzaSyDcgWrhfvAqPui2Pm2gNSjuvyVAY0Toa9w';
    if (geminiKey) {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const contents = [
          ...(history || []).map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          { role: 'user', parts: [{ text: message }] }
        ];
        const response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents,
          config: systemPrompt ? { systemInstruction: systemPrompt } : {}
        });
        return res.json({ response: response.text, provider: 'gemini' });
      } catch (e: any) {
        console.warn('[ai-chat] Gemini failed:', e.message);
      }
    }

    // Try Grok
    const grokKey = process.env.GROK_API_KEY;
    if (grokKey) {
      try {
        const messages = [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          ...(history || []).map((m: any) => ({ role: m.role, content: m.content })),
          { role: 'user', content: message }
        ];
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30000);
        try {
          const r = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${grokKey}` },
            body: JSON.stringify({ model: 'grok-2-1212', messages, max_tokens: 1024 }),
            signal: ctrl.signal
          });
          const data: any = await r.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content) return res.json({ response: content, provider: 'grok' });
        } finally { clearTimeout(t); }
      } catch (e: any) {
        console.warn('[ai-chat] Grok failed:', e.message);
      }
    }

    // Try Groq
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      try {
        const messages = [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          ...(history || []).map((m: any) => ({ role: m.role, content: m.content })),
          { role: 'user', content: message }
        ];
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30000);
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens: 1024 }),
            signal: ctrl.signal
          });
          const data: any = await r.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content) return res.json({ response: content, provider: 'groq' });
        } finally { clearTimeout(t); }
      } catch (e: any) {
        console.warn('[ai-chat] Groq failed:', e.message);
      }
    }

    // Rule-based fallback — works even with zero AI keys configured.
    // Extract keywords from the message and detect location so hunts still fire.
    const lower = message.toLowerCase();
    const LOCATION_MAP: [RegExp, string][] = [
      [/\bdubai\b/i, 'Dubai'],
      [/\babu.?dhabi\b/i, 'Abu Dhabi'],
      [/\bsharjah\b/i, 'Sharjah'],
      [/\bajman\b/i, 'Ajman'],
      [/\bfujairah\b/i, 'Fujairah'],
      [/\bras.?al.?khaimah\b/i, 'Ras Al Khaimah'],
      [/\bumm.?al.?quwain\b/i, 'Umm Al Quwain'],
      [/\bal.?ain\b/i, 'Al Ain'],
      [/\b(uae|emirates)\b/i, 'United Arab Emirates'],
      [/\bsaudi\b|\bksa\b/i, 'Saudi Arabia'],
      [/\bkuwait\b/i, 'Kuwait'],
      [/\bqatar\b/i, 'Qatar'],
      [/\bbahrain\b/i, 'Bahrain'],
      [/\boman\b/i, 'Oman'],
      [/\bgcc\b/i, 'GCC'],
    ];
    const detectedLocation = LOCATION_MAP.find(([re]) => re.test(message))?.[1] || 'United Arab Emirates';
    const isStats = /\b(stats|pipeline|numbers|count|how many|total)\b/i.test(lower);
    if (isStats) {
      return res.json({ response: '{"action":"stats"}', provider: 'rule-based' });
    }
    // Strip location and filler words, keep the substance as keywords
    const keywords = message
      .replace(/\b(find|hunt|search|locate|discover|show|get|me|please|some|all|for|around|near|in|at|the|a|an)\b/gi, ' ')
      .replace(new RegExp(detectedLocation, 'gi'), ' ')
      .replace(/\bUAE\b|\bGCC\b|\bemirates\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'instagram shop whatsapp order cash on delivery';
    return res.json({
      response: JSON.stringify({ action: 'search', keywords, location: detectedLocation }),
      provider: 'rule-based',
    });
  });

  // --- AI AGENT (Autonomous actions) ---

  app.post("/api/ai-agent", async (req, res) => {
    const { command } = req.body;

    // Gather pipeline context from DB
    const pipelineStats = {
      total: (db.prepare("SELECT COUNT(*) as c FROM merchants").get() as any).c,
      new_leads: (db.prepare("SELECT COUNT(*) as c FROM leads WHERE status='NEW'").get() as any).c,
      contacted: (db.prepare("SELECT COUNT(*) as c FROM leads WHERE status='CONTACTED'").get() as any).c,
      qualified: (db.prepare("SELECT COUNT(*) as c FROM leads WHERE status='QUALIFIED'").get() as any).c,
      onboarded: (db.prepare("SELECT COUNT(*) as c FROM leads WHERE status='ONBOARDED'").get() as any).c,
      follow_up: (db.prepare("SELECT COUNT(*) as c FROM leads WHERE status='FOLLOW_UP'").get() as any).c,
    };

    const hotLeads = db.prepare(`
      SELECT l.id as lead_id, m.business_name, m.phone, m.whatsapp, m.email, m.category,
             m.myfatoorah_fit_score as fit_score, m.confidence_score, m.physical_address
      FROM leads l JOIN merchants m ON l.merchant_id = m.id
      WHERE l.status = 'NEW'
      ORDER BY m.myfatoorah_fit_score DESC LIMIT 10
    `).all() as any[];

    const coldLeads = db.prepare(`
      SELECT l.id as lead_id, m.business_name, m.phone, m.whatsapp, m.email, m.category,
             m.myfatoorah_fit_score as fit_score, l.follow_up_date, l.notes
      FROM leads l JOIN merchants m ON l.merchant_id = m.id
      WHERE l.status IN ('FOLLOW_UP', 'CONTACTED')
      ORDER BY l.updated_at ASC LIMIT 10
    `).all() as any[];

    let prompt = '';
    if (command === 'hot-leads') {
      prompt = `You are a UAE sales expert for MyFatoorah payment gateway. Analyze these NEW leads and rank the top 5 by priority. For each, give: 1 line action recommendation + a WhatsApp outreach script in Arabic and English.

Pipeline: ${JSON.stringify(pipelineStats)}
Hot Leads: ${JSON.stringify(hotLeads)}

Respond as JSON: { "brief": "2-sentence summary", "leads": [{ "lead_id": "", "name": "", "fit_score": 0, "action": "", "script_arabic": "", "script_english": "" }] }`;

    } else if (command === 'cold-leads') {
      prompt = `You are a UAE sales expert for MyFatoorah. These leads went cold or need follow-up. Suggest a re-engagement strategy for each.

Pipeline: ${JSON.stringify(pipelineStats)}
Cold/Follow-up Leads: ${JSON.stringify(coldLeads)}

Respond as JSON: { "brief": "2-sentence summary", "leads": [{ "lead_id": "", "name": "", "action": "", "script_arabic": "", "script_english": "" }] }`;

    } else if (command === 'audit') {
      prompt = `You are a UAE sales manager reviewing the MyFatoorah acquisition pipeline. Give a strategic audit.

Pipeline Stats: ${JSON.stringify(pipelineStats)}
Top Hot Leads: ${JSON.stringify(hotLeads.slice(0, 5))}
Stale Leads: ${JSON.stringify(coldLeads.slice(0, 5))}

Respond as JSON: { "brief": "3-sentence executive summary", "health_score": 0-100, "recommendations": ["...", "...", "..."], "leads": [] }`;

    } else { // autopilot
      prompt = `You are the SMILEY WIZARD — autonomous sales AI for MyFatoorah UAE. Run a full pipeline audit and generate today's battle plan.

Pipeline Stats: ${JSON.stringify(pipelineStats)}
Top New Leads: ${JSON.stringify(hotLeads.slice(0, 5))}
Stale/Follow-up Leads: ${JSON.stringify(coldLeads.slice(0, 5))}

Respond as JSON: {
  "brief": "3-sentence daily briefing",
  "health_score": 0-100,
  "recommendations": ["...", "..."],
  "leads": [{ "lead_id": "", "name": "", "priority": "HOT|WARM|COLD", "action": "", "script_arabic": "", "script_english": "" }]
}`;
    }

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2 || 'AIzaSyDcgWrhfvAqPui2Pm2gNSjuvyVAY0Toa9w';

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });
      const text = response.text || '{}';
      const result = JSON.parse(text);
      res.json({ ...result, command });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- BUSINESS CARD SCANNER ---

  app.post("/api/scan-card", async (req, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "image (base64) required" });

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2 || 'AIzaSyDcgWrhfvAqPui2Pm2gNSjuvyVAY0Toa9w';

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      // Strip data URL prefix if present
      const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, '');
      const mimeType = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{
          role: 'user',
          parts: [
            {
              text: 'Extract business card information from this image. Return ONLY valid JSON with these fields: { "name": "", "company": "", "phone": "", "email": "", "address": "", "website": "", "title": "" }. If a field is not found, use empty string.'
            },
            {
              inlineData: { mimeType, data: base64Data }
            }
          ]
        }],
        config: { responseMimeType: "application/json" }
      });

      const text = response.text || '{}';
      const cardData = JSON.parse(text);
      res.json(cardData);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- WHATSAPP API ROUTES ---

  app.get("/api/whatsapp/status", (req, res) => {
    res.json(getWAStatus());
  });

  app.get("/api/whatsapp/uncontacted", (req, res) => {
    const leads = db.prepare(`
      SELECT l.id as lead_id, m.business_name, m.phone, m.whatsapp, m.email,
             m.category, m.myfatoorah_fit_score as fit_score
      FROM leads l JOIN merchants m ON l.merchant_id = m.id
      WHERE l.status = 'NEW' AND m.whatsapp IS NOT NULL AND m.whatsapp != ''
      ORDER BY m.myfatoorah_fit_score DESC
    `).all();
    res.json(leads);
  });

  app.post("/api/whatsapp/send-bulk", async (req, res) => {
    const { message } = req.body;
    const leads = db.prepare(`
      SELECT l.id as lead_id, m.business_name, m.phone, m.whatsapp, m.email, m.category
      FROM leads l JOIN merchants m ON l.merchant_id = m.id
      WHERE l.status = 'NEW' AND m.whatsapp IS NOT NULL AND m.whatsapp != ''
      ORDER BY m.myfatoorah_fit_score DESC LIMIT 50
    `).all() as any[];

    if (leads.length === 0) return res.json({ sent: 0, message: 'No uncontacted leads with WhatsApp numbers' });

    const { status } = getWAStatus();
    if (status !== 'connected') {
      return res.status(503).json({ error: 'WhatsApp is not connected. Scan the QR code first.' });
    }

    const defaultMsg = message || '👋 Hello! We are MyFatoorah, the UAE\'s leading payment gateway. We\'d love to help your business accept payments easily and securely. Are you open to a quick chat? 🚀';

    let sent = 0;
    const errors: string[] = [];

    for (const lead of leads) {
      const recipient = lead.whatsapp || lead.phone;
      if (!recipient) {
        errors.push(`${lead.business_name}: No phone number available`);
        continue;
      }
      try {
        await sendWAMessage(recipient, defaultMsg);
        // Mark as contacted
        db.prepare("UPDATE leads SET status='CONTACTED', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(lead.lead_id);
        sent++;
        await new Promise(r => setTimeout(r, 800));
      } catch (e: any) {
        errors.push(`${lead.business_name}: ${e.message}`);
      }
    }

    res.json({ sent, total: leads.length, errors });
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
              const parts = query.split(' ');
              const location = parts.length > 1 ? parts.pop() : 'Dubai';
              const keywords = parts.join(' ');

              const result = await huntMerchants(
                { keywords, location: location || 'Dubai' },
                (count: number) => io.emit('hunt-progress', { query, count })
              );

              io.emit('hunt-completed', { query, merchants: result.merchants });

              if (result.newLeadsCount === 0) {
                await sendTelegram(chatId, `⚠️ No new merchants found for "${query}".`);
              } else {
                await sendTelegram(chatId, `🎯 FOUND ${result.newLeadsCount} NEW LEADS FOR "${query}":`);
                for (const m of result.merchants) {
                  const msg = `
🏢 *${m.businessName || 'Unknown Business'}*
📂 Category: ${m.category || 'N/A'}
📱 IG: @${m.instagramHandle || 'N/A'}
⭐ Fit Score: ${m.fitScore || 0}/100
📞 Phone: ${m.phone || 'N/A'}
💬 WhatsApp: ${m.whatsapp || 'N/A'}
🔗 ${m.url || 'No URL'}
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
              try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore cleanup error */ }
            }
          } else if (text === '/status') {
            try {
              const stats: any = db.prepare("SELECT COUNT(*) as count FROM merchants").get();
              const newLeads: any = db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'NEW'").get();
              await sendTelegram(chatId, `📊 *WIZARD STATUS*\n\nMerchants in DB: ${stats.count}\nNew Leads: ${newLeads.count}`, 'Markdown');
            } catch (e: any) {
              await sendTelegram(chatId, `❌ DB error: ${e.message}`);
            }
          } else if (text === '/recent') {
            try {
              const recentQuery = `
                SELECT m.*, l.status as lead_status
                FROM leads l
                JOIN merchants m ON l.merchant_id = m.id
                ORDER BY l.created_at DESC
                LIMIT 5
              `;
              const recentLeads = db.prepare(recentQuery).all() as any[];
              if (recentLeads.length === 0) {
                await sendTelegram(chatId, "📭 No leads in database yet.");
              } else {
                await sendTelegram(chatId, "🕒 *RECENT LEADS:*", 'Markdown');
                for (const m of recentLeads) {
                  const msg = `🏢 *${m.business_name}* (${m.lead_status})\n📂 ${m.category}\n⭐ Fit: ${m.myfatoorah_fit_score}/100`;
                  await sendTelegram(chatId, msg, 'Markdown');
                }
              }
            } catch (e: any) {
              await sendTelegram(chatId, `❌ DB error: ${e.message}`);
            }
          } else if (text === '/start') {
            await sendTelegram(chatId, "👋 Welcome to Smiley Wizard Merchant Hunter!\n\nCommands:\n/hunt <keywords> - Start discovery\n/status - View DB stats\n/export <status> - Export leads to CSV (default: NEW)\n/recent - Last 5 leads");
          }
        }
      }
    } catch (error) {
      console.error("[Telegram] Polling error:", error);
      // Back off for 10s on error to avoid hammering the API on persistent failures
      setTimeout(pollTelegram, 10000);
      return;
    }
    setTimeout(pollTelegram, 1000);
  }

  async function sendTelegram(chatId: number, text: string, parseMode?: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode })
      });
    } catch (e: any) {
      console.warn('[Telegram] sendMessage failed:', e.message);
    }
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

  // --- WHATSAPP BOT ---
  // Requires ENABLE_WHATSAPP=true to start (Chromium must be available)
  if (process.env.ENABLE_WHATSAPP === 'true') {
    const waSessionPath = process.env.WA_SESSION_PATH || path.join(process.cwd(), 'wa_session');
    initWhatsAppBot(io, db, huntMerchants, waSessionPath);
  } else {
    console.log('[WhatsApp] Disabled. Set ENABLE_WHATSAPP=true to enable.');
  }

  // --- VITE / STATIC SERVING ---
  // Check dist/index.html — if it exists (Railway always builds first) serve static.
  // Only load Vite dev server if no built assets exist (local dev without build).
  // This avoids ERR_INVALID_URL_SCHEME from tsx+Vite ESM interop in production.
  const distPath = path.join(__dirname, 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  if (hasDist) {
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
    console.log('[server] Serving built assets from dist/');
  } else {
    // No built assets — tell user to build (never load Vite at runtime)
    app.get("*", (_req, res) => res.status(503).send(
      '<h1>App not built</h1><p>Run: <code>npm run build</code></p>'
    ));
    console.warn('[server] dist/ not found — run npm run build');
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
