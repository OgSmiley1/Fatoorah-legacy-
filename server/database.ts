import Database from 'better-sqlite3';
import path from 'path';
import { logger } from './logger.js';

let db: Database.Database;

export function initDatabase(): Database.Database {
  const dbPath = path.join(process.cwd(), 'merchants.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      business_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      platform TEXT,
      url TEXT,
      normalized_url TEXT,
      maps_place_id TEXT,
      instagram_handle TEXT,
      normalized_instagram TEXT,
      tiktok_handle TEXT,
      normalized_tiktok TEXT,
      telegram_handle TEXT,
      category TEXT,
      sub_category TEXT,
      followers INTEGER DEFAULT 0,
      bio TEXT,
      email TEXT,
      normalized_email TEXT,
      phone TEXT,
      normalized_phone TEXT,
      whatsapp TEXT,
      normalized_whatsapp TEXT,
      website TEXT,
      normalized_domain TEXT,
      location TEXT,
      country TEXT,
      city TEXT,
      last_active TEXT,
      is_cod INTEGER DEFAULT 0,
      payment_methods TEXT DEFAULT '[]',
      other_profiles TEXT DEFAULT '[]',
      registration_info TEXT,
      trade_license TEXT,
      risk_score INTEGER DEFAULT 30,
      risk_category TEXT DEFAULT 'HIGH',
      risk_factors TEXT DEFAULT '[]',
      contact_score INTEGER DEFAULT 0,
      contact_best_route TEXT,
      phone_confidence TEXT DEFAULT 'MISSING',
      whatsapp_confidence TEXT DEFAULT 'MISSING',
      email_confidence TEXT DEFAULT 'MISSING',
      website_confidence TEXT DEFAULT 'MISSING',
      social_confidence TEXT DEFAULT 'MISSING',
      fit_score INTEGER DEFAULT 0,
      fit_reason TEXT,
      revenue_monthly REAL DEFAULT 0,
      revenue_annual REAL DEFAULT 0,
      setup_fee REAL DEFAULT 0,
      transaction_rate TEXT,
      settlement_cycle TEXT,
      leakage_monthly_loss REAL DEFAULT 0,
      leakage_missing_methods TEXT DEFAULT '[]',
      status TEXT DEFAULT 'NEW',
      notes TEXT,
      follow_up_date TEXT,
      first_contact_date TEXT,
      last_contact_date TEXT,
      contact_outcome TEXT,
      discovery_run_id TEXT,
      search_session_id TEXT,
      first_found_date TEXT NOT NULL,
      last_validated_date TEXT,
      scripts_arabic TEXT,
      scripts_english TEXT,
      scripts_whatsapp TEXT,
      scripts_instagram TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      uri TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS search_runs (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      location TEXT,
      categories TEXT DEFAULT '[]',
      platforms TEXT DEFAULT '[]',
      filters TEXT DEFAULT '{}',
      total_candidates INTEGER DEFAULT 0,
      duplicates_removed INTEGER DEFAULT 0,
      new_merchants_saved INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      error_detail TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dedup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_run_id TEXT,
      candidate_name TEXT,
      matched_merchant_id TEXT,
      match_reason TEXT,
      match_detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lead_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_merchants_normalized_name ON merchants(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_merchants_normalized_phone ON merchants(normalized_phone);
    CREATE INDEX IF NOT EXISTS idx_merchants_normalized_email ON merchants(normalized_email);
    CREATE INDEX IF NOT EXISTS idx_merchants_normalized_domain ON merchants(normalized_domain);
    CREATE INDEX IF NOT EXISTS idx_merchants_normalized_instagram ON merchants(normalized_instagram);
    CREATE INDEX IF NOT EXISTS idx_merchants_normalized_url ON merchants(normalized_url);
    CREATE INDEX IF NOT EXISTS idx_merchants_normalized_tiktok ON merchants(normalized_tiktok);
    CREATE INDEX IF NOT EXISTS idx_merchants_maps_place_id ON merchants(maps_place_id);
    CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status);
    CREATE INDEX IF NOT EXISTS idx_merchants_fit_score ON merchants(fit_score);
    CREATE INDEX IF NOT EXISTS idx_merchants_contact_score ON merchants(contact_score);
  `);

  logger.info('database.initialized', { path: dbPath });
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ─── Merchant CRUD ───

export interface MerchantRow {
  id: string;
  business_name: string;
  normalized_name: string;
  platform?: string;
  url?: string;
  normalized_url?: string;
  maps_place_id?: string;
  instagram_handle?: string;
  normalized_instagram?: string;
  tiktok_handle?: string;
  normalized_tiktok?: string;
  telegram_handle?: string;
  category?: string;
  sub_category?: string;
  followers?: number;
  bio?: string;
  email?: string;
  normalized_email?: string;
  phone?: string;
  normalized_phone?: string;
  whatsapp?: string;
  normalized_whatsapp?: string;
  website?: string;
  normalized_domain?: string;
  location?: string;
  country?: string;
  city?: string;
  last_active?: string;
  is_cod?: number;
  payment_methods?: string;
  other_profiles?: string;
  registration_info?: string;
  trade_license?: string;
  risk_score?: number;
  risk_category?: string;
  risk_factors?: string;
  contact_score?: number;
  contact_best_route?: string;
  phone_confidence?: string;
  whatsapp_confidence?: string;
  email_confidence?: string;
  website_confidence?: string;
  social_confidence?: string;
  fit_score?: number;
  fit_reason?: string;
  revenue_monthly?: number;
  revenue_annual?: number;
  setup_fee?: number;
  transaction_rate?: string;
  settlement_cycle?: string;
  leakage_monthly_loss?: number;
  leakage_missing_methods?: string;
  status?: string;
  notes?: string;
  follow_up_date?: string;
  first_contact_date?: string;
  last_contact_date?: string;
  contact_outcome?: string;
  discovery_run_id?: string;
  search_session_id?: string;
  first_found_date: string;
  last_validated_date?: string;
  scripts_arabic?: string;
  scripts_english?: string;
  scripts_whatsapp?: string;
  scripts_instagram?: string;
  created_at?: string;
  updated_at?: string;
}

export function insertMerchant(merchant: MerchantRow): boolean {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO merchants (
      id, business_name, normalized_name, platform, url, normalized_url,
      maps_place_id, instagram_handle, normalized_instagram, tiktok_handle, normalized_tiktok,
      telegram_handle, category, sub_category, followers, bio,
      email, normalized_email, phone, normalized_phone, whatsapp, normalized_whatsapp,
      website, normalized_domain, location, country, city, last_active,
      is_cod, payment_methods, other_profiles, registration_info, trade_license,
      risk_score, risk_category, risk_factors,
      contact_score, contact_best_route, phone_confidence, whatsapp_confidence,
      email_confidence, website_confidence, social_confidence,
      fit_score, fit_reason,
      revenue_monthly, revenue_annual, setup_fee, transaction_rate, settlement_cycle,
      leakage_monthly_loss, leakage_missing_methods,
      status, notes, follow_up_date, first_contact_date, last_contact_date, contact_outcome,
      discovery_run_id, search_session_id, first_found_date, last_validated_date,
      scripts_arabic, scripts_english, scripts_whatsapp, scripts_instagram
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  const result = stmt.run(
    merchant.id, merchant.business_name, merchant.normalized_name,
    merchant.platform || null, merchant.url || null, merchant.normalized_url || null,
    merchant.maps_place_id || null, merchant.instagram_handle || null, merchant.normalized_instagram || null,
    merchant.tiktok_handle || null, merchant.normalized_tiktok || null,
    merchant.telegram_handle || null, merchant.category || null, merchant.sub_category || null,
    merchant.followers || 0, merchant.bio || null,
    merchant.email || null, merchant.normalized_email || null,
    merchant.phone || null, merchant.normalized_phone || null,
    merchant.whatsapp || null, merchant.normalized_whatsapp || null,
    merchant.website || null, merchant.normalized_domain || null,
    merchant.location || null, merchant.country || null, merchant.city || null,
    merchant.last_active || null,
    merchant.is_cod || 0, merchant.payment_methods || '[]',
    merchant.other_profiles || '[]', merchant.registration_info || null,
    merchant.trade_license || null,
    merchant.risk_score || 30, merchant.risk_category || 'HIGH', merchant.risk_factors || '[]',
    merchant.contact_score || 0, merchant.contact_best_route || null,
    merchant.phone_confidence || 'MISSING', merchant.whatsapp_confidence || 'MISSING',
    merchant.email_confidence || 'MISSING', merchant.website_confidence || 'MISSING',
    merchant.social_confidence || 'MISSING',
    merchant.fit_score || 0, merchant.fit_reason || null,
    merchant.revenue_monthly || 0, merchant.revenue_annual || 0,
    merchant.setup_fee || 0, merchant.transaction_rate || null, merchant.settlement_cycle || null,
    merchant.leakage_monthly_loss || 0, merchant.leakage_missing_methods || '[]',
    merchant.status || 'NEW', merchant.notes || null,
    merchant.follow_up_date || null, merchant.first_contact_date || null,
    merchant.last_contact_date || null, merchant.contact_outcome || null,
    merchant.discovery_run_id || null, merchant.search_session_id || null,
    merchant.first_found_date, merchant.last_validated_date || null,
    merchant.scripts_arabic || null, merchant.scripts_english || null,
    merchant.scripts_whatsapp || null, merchant.scripts_instagram || null
  );

  return result.changes > 0;
}

export interface MerchantFilters {
  status?: string;
  minFitScore?: number;
  minContactScore?: number;
  category?: string;
  location?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'fit_score' | 'contact_score' | 'first_found_date' | 'follow_up_date';
  sortOrder?: 'ASC' | 'DESC';
  includeOld?: boolean; // if false (default), only NEW status
}

export function getMerchants(filters: MerchantFilters = {}): MerchantRow[] {
  const d = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.minFitScore) {
    conditions.push('fit_score >= ?');
    params.push(filters.minFitScore);
  }
  if (filters.minContactScore) {
    conditions.push('contact_score >= ?');
    params.push(filters.minContactScore);
  }
  if (filters.category) {
    conditions.push('category = ?');
    params.push(filters.category);
  }
  if (filters.location) {
    conditions.push('location LIKE ?');
    params.push(`%${filters.location}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortBy = filters.sortBy || 'first_found_date';
  const sortOrder = filters.sortOrder || 'DESC';
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const rows = d.prepare(`
    SELECT * FROM merchants ${where}
    ORDER BY ${sortBy} ${sortOrder}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as MerchantRow[];

  return rows;
}

export function getMerchantById(id: string): MerchantRow | undefined {
  const d = getDb();
  return d.prepare('SELECT * FROM merchants WHERE id = ?').get(id) as MerchantRow | undefined;
}

export function updateMerchantStatus(id: string, status: string, notes?: string): boolean {
  const d = getDb();
  const merchant = getMerchantById(id);
  if (!merchant) return false;

  const oldStatus = merchant.status;
  d.prepare(`
    UPDATE merchants SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now')
    WHERE id = ?
  `).run(status, notes || null, id);

  logAction(id, 'status_change', oldStatus || '', status, notes);
  return true;
}

export function updateMerchantNotes(id: string, notes: string): boolean {
  const d = getDb();
  d.prepare(`UPDATE merchants SET notes = ?, updated_at = datetime('now') WHERE id = ?`).run(notes, id);
  logAction(id, 'note_added', '', '', notes);
  return true;
}

export function setFollowUp(id: string, date: string): boolean {
  const d = getDb();
  d.prepare(`UPDATE merchants SET follow_up_date = ?, updated_at = datetime('now') WHERE id = ?`).run(date, id);
  logAction(id, 'follow_up_set', '', date);
  return true;
}

// ─── Dedup helpers ───

export function getAllNormalizedFields(): {
  names: Set<string>;
  phones: Set<string>;
  emails: Set<string>;
  domains: Set<string>;
  instagrams: Set<string>;
  tiktoks: Set<string>;
  urls: Set<string>;
  hashes: Set<string>;
  mapsIds: Set<string>;
} {
  const d = getDb();
  const rows = d.prepare(`
    SELECT id, normalized_name, normalized_phone, normalized_email,
           normalized_domain, normalized_instagram, normalized_tiktok,
           normalized_url, maps_place_id
    FROM merchants
  `).all() as any[];

  const result = {
    names: new Set<string>(),
    phones: new Set<string>(),
    emails: new Set<string>(),
    domains: new Set<string>(),
    instagrams: new Set<string>(),
    tiktoks: new Set<string>(),
    urls: new Set<string>(),
    hashes: new Set<string>(),
    mapsIds: new Set<string>(),
  };

  for (const row of rows) {
    if (row.id) result.hashes.add(row.id);
    if (row.normalized_name) result.names.add(row.normalized_name);
    if (row.normalized_phone) result.phones.add(row.normalized_phone);
    if (row.normalized_email) result.emails.add(row.normalized_email);
    if (row.normalized_domain) result.domains.add(row.normalized_domain);
    if (row.normalized_instagram) result.instagrams.add(row.normalized_instagram);
    if (row.normalized_tiktok) result.tiktoks.add(row.normalized_tiktok);
    if (row.normalized_url) result.urls.add(row.normalized_url);
    if (row.maps_place_id) result.mapsIds.add(row.maps_place_id);
  }

  return result;
}

// ─── Evidence ───

export function insertEvidence(merchantId: string, type: string, title: string, uri: string): void {
  const d = getDb();
  d.prepare(`INSERT INTO evidence (merchant_id, type, title, uri) VALUES (?, ?, ?, ?)`).run(merchantId, type, title, uri);
}

export function getEvidenceForMerchant(merchantId: string): Array<{ type: string; title: string; uri: string }> {
  const d = getDb();
  return d.prepare(`SELECT type, title, uri FROM evidence WHERE merchant_id = ?`).all(merchantId) as any[];
}

// ─── Search Runs ───

export function insertSearchRun(run: {
  id: string;
  query: string;
  location?: string;
  categories?: string;
  platforms?: string;
  filters?: string;
}): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO search_runs (id, query, location, categories, platforms, filters)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(run.id, run.query, run.location || '', run.categories || '[]', run.platforms || '[]', run.filters || '{}');
}

export function updateSearchRun(id: string, updates: {
  total_candidates?: number;
  duplicates_removed?: number;
  new_merchants_saved?: number;
  status?: string;
  error_detail?: string;
}): void {
  const d = getDb();
  const sets: string[] = ['completed_at = datetime(\'now\')'];
  const params: any[] = [];

  if (updates.total_candidates !== undefined) { sets.push('total_candidates = ?'); params.push(updates.total_candidates); }
  if (updates.duplicates_removed !== undefined) { sets.push('duplicates_removed = ?'); params.push(updates.duplicates_removed); }
  if (updates.new_merchants_saved !== undefined) { sets.push('new_merchants_saved = ?'); params.push(updates.new_merchants_saved); }
  if (updates.status) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.error_detail) { sets.push('error_detail = ?'); params.push(updates.error_detail); }

  params.push(id);
  d.prepare(`UPDATE search_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function getSearchRuns(limit: number = 20): any[] {
  const d = getDb();
  return d.prepare('SELECT * FROM search_runs ORDER BY started_at DESC LIMIT ?').all(limit);
}

// ─── Dedup Log ───

export function logDedupMatch(searchRunId: string, candidateName: string, matchedId: string, reason: string, detail?: string): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO dedup_log (search_run_id, candidate_name, matched_merchant_id, match_reason, match_detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(searchRunId, candidateName, matchedId, reason, detail || '');
}

// ─── Lead Actions ───

export function logAction(merchantId: string, action: string, oldValue?: string, newValue?: string, notes?: string): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO lead_actions (merchant_id, action, old_value, new_value, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(merchantId, action, oldValue || '', newValue || '', notes || '');
}

// ─── Stats ───

export function getStats(): {
  total: number;
  byStatus: Record<string, number>;
  avgFitScore: number;
  avgContactScore: number;
  newThisWeek: number;
} {
  const d = getDb();
  const total = (d.prepare('SELECT COUNT(*) as count FROM merchants').get() as any).count;

  const statusRows = d.prepare('SELECT status, COUNT(*) as count FROM merchants GROUP BY status').all() as any[];
  const byStatus: Record<string, number> = {};
  for (const row of statusRows) {
    byStatus[row.status || 'NEW'] = row.count;
  }

  const avgFit = (d.prepare('SELECT AVG(fit_score) as avg FROM merchants').get() as any).avg || 0;
  const avgContact = (d.prepare('SELECT AVG(contact_score) as avg FROM merchants').get() as any).avg || 0;
  const newThisWeek = (d.prepare(`
    SELECT COUNT(*) as count FROM merchants
    WHERE first_found_date >= datetime('now', '-7 days')
  `).get() as any).count;

  return {
    total,
    byStatus,
    avgFitScore: Math.round(avgFit),
    avgContactScore: Math.round(avgContact),
    newThisWeek
  };
}

export function getMerchantCount(): number {
  const d = getDb();
  return (d.prepare('SELECT COUNT(*) as count FROM merchants').get() as any).count;
}
