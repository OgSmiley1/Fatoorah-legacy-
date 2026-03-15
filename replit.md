# MyFatoorah Merchant Acquisition Engine

## Overview
A full-stack merchant discovery and lead management engine for MyFatoorah. Finds fresh, reachable GCC merchants via multi-platform Arabic+English search, eliminates duplicates across sessions, scores contact quality honestly, and supports fully browser-independent Telegram hunts.

## Architecture
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Socket.io client
- **Backend**: Express, Socket.io, better-sqlite3 (wizard.db), Telegram polling
- **AI**: Google Gemini API (@google/genai) — server-side only via `POST /api/ai-search`
- **Single process**: `server.ts` runs both backend API and Vite dev server (middleware mode)

## Project Structure
- `server.ts` — Main Express + Socket.io + Vite dev server + Telegram bot (port 5000)
- `db.ts` — SQLite database initialization (wizard.db)
- `discovery.ts` — Merchant ingestion logic with scoring and dedup
- `server/searchService.ts` — Multi-platform Arabic+English DuckDuckGo search
- `server/scoringService.ts` — Fit scoring (COD/WhatsApp/social signals), contact scoring, contact confidence
- `server/dedupService.ts` — Deduplication: exact name, phone, email, IG, URL/domain, fuzzy name (Levenshtein)
- `server/logger.ts` — Structured logging
- `src/components/HunterDashboard.tsx` — Main dashboard with hunt UI, net-new filtering
- `src/components/MerchantCard.tsx` — Lead card with confidence badges, fit rationale
- `src/components/PipelineView.tsx` — Sales pipeline with lead workflow (notes, next action, follow-up date)
- `src/components/TelegramModal.tsx` — Telegram bot configuration UI
- `src/services/apiClient.ts` — Frontend API client (calls server endpoints only, no direct external API calls)
- `src/services/telegramService.ts` — Telegram send via server proxy (`/api/telegram/send`, `/api/telegram/test`)
- `src/utils/exportExcel.ts` — Excel export with contact quality columns
- `src/types.ts` — TypeScript types including ContactConfidence, ContactabilityLevel
- `vite.config.ts` — Vite config (no API keys exposed)

## Key Features
- **Multi-platform search**: 4 targeted queries (Arabic social, English social, Arabic ecommerce, English ecommerce)
- **Arabic business name extraction**: Handles Arabic titles, strips platform suffixes
- **Contact confidence**: Per-field VERIFIED/LIKELY/WEAK/MISSING + overall HIGH/MEDIUM/LOW/NONE
- **Fit scoring**: COD signals, WhatsApp ordering, no payment gateway, social selling, GCC location, Arabic business
- **Deduplication**: Exact name, phone, email, IG handle, source URL, domain, fuzzy name (85% threshold)
- **Net-new by default**: UI hides duplicates with toggle to show them
- **Telegram bot**: Fully server-side `/hunt`, `/status`, `/export`, `/recent` commands
- **Lead workflow**: Notes, next action, follow-up date, outcome editing in pipeline

## Environment Variables
- `SESSION_SECRET` — Secret for express-session (optional, has default)
- `TELEGRAM_BOT_TOKEN` — Telegram bot token for remote control (optional)
- `GEMINI_API_KEY` — Google Gemini API key for AI search (server-side only, optional)

## Running
- Dev: `npm run dev` (runs `tsx server.ts` on port 5000)
- Build: `npm run build` (Vite build to `dist/`)

## Database
SQLite file: `wizard.db` (auto-created on startup)
Tables: `merchants`, `leads`, `search_runs`, `logs`
Indexes: normalized_name, phone, email, source_url, lead status, merchant_id

## Deployment
Configured as VM deployment (needs persistent process for Socket.io + Telegram bot polling).
Run command: `npx tsx server.ts`
