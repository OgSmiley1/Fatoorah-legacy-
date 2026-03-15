# Smiley Wizard Merchant Hunter

## Overview
A full-stack merchant discovery and lead management tool built with React + Vite (frontend) and Express + Socket.io (backend). The server also integrates a Telegram bot for remote control.

## Architecture
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Socket.io client
- **Backend**: Express, Socket.io, better-sqlite3 (wizard.db), Telegram polling
- **AI**: Google Gemini API (@google/genai)
- **Single process**: `server.ts` runs both backend API and Vite dev server (middleware mode)

## Project Structure
- `server.ts` — Main Express + Socket.io + Vite dev server entry point (port 5000)
- `db.ts` — SQLite database initialization (wizard.db)
- `discovery.ts` — Merchant ingestion logic
- `server/` — Backend services: searchService, scoringService, dedupService, logger
- `src/` — React frontend (App, components, hooks, services, utils)
- `vite.config.ts` — Vite config with Tailwind and React plugins

## Environment Variables
See `.env.example`:
- `SESSION_SECRET` — Secret for express-session (optional, has default)
- `TELEGRAM_BOT_TOKEN` — Telegram bot token for remote control (optional)
- `GEMINI_API_KEY` — Google Gemini API key for AI features

## Running
- Dev: `npm run dev` (runs `tsx server.ts` on port 5000)
- Build: `npm run build` (Vite build to `dist/`)

## Database
SQLite file: `wizard.db` (auto-created on startup)
Tables: `merchants`, `leads`, `search_runs`, `logs`

## Deployment
Configured as VM deployment (needs persistent process for Socket.io + Telegram bot polling).
Run command: `npx tsx server.ts`
