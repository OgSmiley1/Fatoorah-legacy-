import Database from 'better-sqlite3';

const db = new Database('wizard.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    source_platform TEXT,
    source_url TEXT,
    category TEXT,
    subcategory TEXT,
    country TEXT,
    city TEXT,
    website TEXT,
    phone TEXT,
    whatsapp TEXT,
    email TEXT,
    instagram_handle TEXT,
    tiktok_handle TEXT,
    telegram_handle TEXT,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_validated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confidence_score REAL DEFAULT 0,
    contactability_score REAL DEFAULT 0,
    myfatoorah_fit_score REAL DEFAULT 0,
    evidence_json TEXT,
    metadata_json TEXT,
    discovery_source TEXT,
    has_payment_gateway INTEGER DEFAULT 0,
    detected_gateways TEXT
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    status TEXT DEFAULT 'NEW',
    run_id TEXT,
    notes TEXT,
    next_action TEXT,
    follow_up_date TEXT,
    first_contact_at TEXT,
    last_contact_at TEXT,
    outcome TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS search_runs (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    source TEXT,
    results_count INTEGER DEFAULT 0,
    new_leads_count INTEGER DEFAULT 0,
    status TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT DEFAULT 'INFO',
    event TEXT NOT NULL,
    details TEXT,
    run_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_merchants_normalized_name ON merchants(normalized_name);
  CREATE INDEX IF NOT EXISTS idx_merchants_phone ON merchants(phone);
  CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
  CREATE INDEX IF NOT EXISTS idx_merchants_source_url ON merchants(source_url);
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_merchant_id ON leads(merchant_id);
`);

function safeAddColumn(table: string, column: string, type: string) {
  try {
    const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch {}
}

safeAddColumn('merchants', 'discovery_source', 'TEXT');
safeAddColumn('merchants', 'has_payment_gateway', 'INTEGER DEFAULT 0');
safeAddColumn('merchants', 'detected_gateways', 'TEXT');

export default db;
