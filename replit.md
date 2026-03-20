# MyFatoorah Merchant Acquisition Engine

## Overview
A full-stack merchant discovery and lead management engine for MyFatoorah. Discovers real GCC sellers lacking payment gateways via multi-AI parallel search (Perplexity, Grok, Gemini, DuckDuckGo), qualifies leads with multi-signal scoring and revenue estimation, deduplicates across sessions, manages outreach via React dashboard and Telegram bot.

## Architecture
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Socket.io client, Framer Motion
- **Backend**: Express, Socket.io, better-sqlite3 (wizard.db), Telegram polling
- **AI Search**: Perplexity (sonar), Grok (grok-3-mini), Google Gemini (with Google Search grounding), DuckDuckGo scraper — all run in parallel via Promise.allSettled
- **AI Scripts**: Ollama (local, free) → Gemini fallback → enriched static templates
- **Single process**: `server.ts` runs backend API + Vite dev server (middleware mode) on port 5000

## Project Structure
- `server.ts` — Main Express + Socket.io + Vite dev server + Telegram bot
- `db.ts` — SQLite initialization with safe column migration (wizard.db)
- `discovery.ts` — Manual merchant ingestion with scoring, scripts, and dedup
- `server/searchService.ts` — Unified `huntMerchants()`: parallel multi-AI search + DuckDuckGo, dedup, scoring, gateway detection, script generation
- `server/aiSearchService.ts` — Perplexity/Grok/Gemini search adapters, payment gateway fingerprinting (fetches merchant page), Ollama/Gemini script generation, `getAiStatus()` health check
- `server/scoringService.ts` — Fit scoring (COD/WhatsApp/social/gateway signals), contact scoring, contact confidence (VERIFIED/LIKELY/WEAK/MISSING), `estimateRevenue()` with 4 tiers and setup fee ranges
- `server/dedupService.ts` — 7-layer deduplication: exact name, phone, email, IG handle, source URL, domain, fuzzy name (Levenshtein ≥85%)
- `server/logger.ts` — Structured logging
- `src/components/HunterDashboard.tsx` — Main dashboard: AI source status dots, net-new enforcement with duplicate toggle, source breakdown
- `src/components/MerchantCard.tsx` — Lead card: confidence badges, revenue tier, gateway badges, discovery source pill, fit rationale, Instagram DM script
- `src/components/PipelineView.tsx` — Sales pipeline with lead workflow (notes, next action, follow-up date)
- `src/components/TelegramModal.tsx` — Telegram bot configuration UI
- `src/services/apiClient.ts` — Frontend API client (`/api/hunt`, `/api/ai-status`, `/api/leads`, `/api/stats`)
- `src/services/telegramService.ts` — Telegram send via server proxy
- `src/utils/exportExcel.ts` — Excel export with revenue, gateway, source fields + Summary sheet
- `src/utils/scripts.ts` — Static outreach script generation (client-side fallback)
- `src/types.ts` — TypeScript types including ContactConfidence, AiSourceStatus, RevenueEstimate
- `scripts/post-merge.sh` — Post-merge setup script (npm install + DB migration)

## Key Features
- **Multi-AI parallel search**: DuckDuckGo HTML scraper (always free, no API key) + Groq + OpenRouter (free tier) + Perplexity + Grok + Gemini run simultaneously; results merged by URL before dedup. Works out-of-the-box with zero API keys via DuckDuckGo.
- **Payment gateway detection**: Fetches merchant website (3s timeout), scans for Stripe/PayPal/Tap/Checkout.com/MyFatoorah/HyperPay/PayFort/Tabby/Tamara; reduces fit score by 20pts if found
- **Revenue estimation**: 4 tiers (Micro <500K AED/yr $1K–$2.5K setup, Small-Med $2.5K–$4.5K, Med-High $4.5K–$6K, High-Volume $6K+)
- **Contact confidence**: Per-field VERIFIED/LIKELY/WEAK/MISSING with GCC phone code validation, wa.me link detection, business email domain checks
- **Personalized outreach scripts**: Ollama (free local AI) → Groq → OpenRouter → enriched static templates; Arabic + English + WhatsApp + Instagram DM
- **Net-new enforcement**: UI shows only new leads by default; collapsible duplicate banner with toggle
- **Deduplication**: 7 layers across sessions (exact name, phone, email, IG handle, URL, domain, fuzzy name 85%)
- **Telegram bot**: Server-side `/hunt`, `/status`, `/export`, `/recent` commands with AI source status
- **Excel export**: Revenue tier, gateway info, discovery source, contact quality + Summary sheet

## API Endpoints
- `POST /api/hunt` — Unified multi-AI search (replaces old /api/search + /api/ai-search)
- `POST /api/search` — Legacy alias for /api/hunt
- `GET /api/ai-status` — AI source availability check
- `GET /api/leads` — Get all leads (optional ?status= filter)
- `PATCH /api/leads/:id` — Update lead status/notes/outcome
- `GET /api/stats` — Dashboard statistics
- `POST /api/merchants/ingest` — Manual merchant ingestion
- `POST /api/telegram/test` — Test Telegram bot connection
- `POST /api/telegram/send` — Send message via Telegram bot

## Environment Variables
- `SESSION_SECRET` — Secret for express-session (optional, has default)
- `TELEGRAM_BOT_TOKEN` — Telegram bot token for remote control (optional)
- `GROQ_API_KEY` — Groq API key for free-tier AI search (optional, free at groq.com)
- `OPENROUTER_API_KEY` — OpenRouter API key for free models (optional, free at openrouter.ai)
- `PPLX_API_KEY` — Perplexity API key for sonar web search (optional, paid)
- `XAI_API_KEY` — Grok/xAI API key for web search (optional, paid)
- `GEMINI_API_KEY` — Google Gemini API key for search + script generation (optional, paid)
- `OLLAMA_URL` — Local Ollama instance URL, default http://localhost:11434 (optional)
- `OLLAMA_MODEL` — Ollama model name, default llama3.2 (optional)

## Running
- Dev: `npm run dev` (runs `tsx server.ts` on port 5000)
- Build: `npm run build` (Vite build to `dist/`)

## Database
SQLite file: `wizard.db` (auto-created on startup)
Tables: `merchants`, `leads`, `search_runs`, `logs`
Columns added via safe migration: `discovery_source`, `has_payment_gateway`, `detected_gateways`
Indexes: normalized_name, phone, email, source_url, lead status, merchant_id

## Deployment
Configured as VM deployment (needs persistent process for Socket.io + Telegram bot polling).
Run command: `npx tsx server.ts`
