# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: builder — install ALL deps + build the React/Vite frontend
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# Native build tools needed for better-sqlite3's C++ addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (layer-cache friendly — only re-runs when lockfile changes)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build the frontend
COPY . .
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: production — lean runtime image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS production

# Install build tools temporarily to recompile better-sqlite3 native addon
# in the SAME node:22-slim environment (same ABI) — then purge tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && apt-get clean

WORKDIR /app

# Install production deps only (rebuilds better-sqlite3 native addon here)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server TypeScript source — tsx interprets it at runtime, no pre-compile needed
COPY server.ts db.ts discovery.ts ./
COPY server/ ./server/
COPY src/types.ts ./src/types.ts

# Non-root user (built into official Node image)
USER node

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node_modules/.bin/tsx", "server.ts"]
