// tests/importLeads.test.ts
// Round-trip test: build a tiny XLSX fixture in memory that matches the
// uploaded workbook's column layout, then run the importer's persistence
// path and assert: 5 rows inserted, idempotent on re-run.

import { jest, describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as XLSX from 'xlsx';

// Point DB_PATH at a per-suite temp file BEFORE the db module is imported.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-leads-test-'));
const dbPath = path.join(tmpDir, 'wizard.db');
process.env.DB_PATH = dbPath;

// Dynamic import so the env var above is honoured by db.ts.
let persistLead: typeof import('../server/persistLead.ts').persistLead;
let merchantCanonicalId: typeof import('../server/dedupService.ts').merchantCanonicalId;
let db: any;

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ persistLead } = await import('../server/persistLead'));
  ({ merchantCanonicalId } = await import('../server/dedupService'));
  db = (await import('../db')).default;
});

afterAll(() => {
  try { db?.close?.(); } catch {}
  try {
    for (const f of ['', '-shm', '-wal']) {
      const p = dbPath + f;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    fs.rmdirSync(tmpDir);
  } catch {}
});

function buildFixtureXlsx(): XLSX.WorkBook {
  // Match the uploaded sheet's column layout. Header row at 3, data at 4+.
  const aoa: any[][] = [
    [], // row 1
    [], // row 2
    ['#', 'Business Name', 'Contacted', 'Service Sector', 'Emirate', 'Phone', 'Has Website?', 'Website', 'Address', 'Rating', 'Reviews', 'Score', 'Priority', 'Why Payment Link', 'Status', 'Notes', 'Maps', 'Date', 'Email', 'WA Link', 'Email Link', 'Monthly Rev', 'Band'],
    [1, 'Zenith Car Wash', '', 'Car Wash', 'Dubai', '0501234567', '❌ No Website', '', 'Al Quoz, Dubai', 4.5, 780, 95, '🔥 HOT', 'Subscriptions', 'New', '', '', '04/05/2026', 'info@zenith.ae', '', '', 150000, '500K-3M'],
    [2, 'Good Steam Auto', '', 'Car Wash', 'Dubai', '0547028764', '❌ No Website', '', 'Al Quoz, Dubai', 4.2, 472, 95, '🔥 HOT', 'Subscriptions', 'New', '', '', '04/05/2026', '', '', '', 80000, '500K-3M'],
    [3, 'CPH Studio', '', 'Photography Studio', 'Dubai', '0554969561', '❌ No Website', '', 'Al Satwa', 5, 1102, 95, '🔥 HOT', 'Booking deposits', 'New', '', '', '04/05/2026', 'studio@cph.ae', '', '', 25000, '< 500K'],
    [4, 'Quickfix Plumbing', '', 'Plumber', 'Sharjah', '0509876543', '✓ Has Website', 'quickfix.ae', 'Sharjah', 4.1, 280, 80, '🌡 WARM', 'On-site invoicing', 'New', '', '', '04/05/2026', 'hi@quickfix.ae', '', '', 60000, '500K-3M'],
    [5, 'Skipped (no contact)', '', 'Other', 'Dubai', '', '', '', '', 0, 0, 0, '', '', '', '', '', '', '', '', '', 0, ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '📋 All Leads');
  return wb;
}

describe('lead importer (xlsx → persistLead)', () => {
  test('imports rows with at least phone or email; skips empty contacts', () => {
    const wb = buildFixtureXlsx();
    const ws = wb.Sheets['📋 All Leads'];

    let inserted = 0;
    let duplicates = 0;
    let skipped = 0;
    const range = XLSX.utils.decode_range(ws['!ref']!);
    for (let r = 4; r <= range.e.r + 1; r++) {
      const get = (col: string): string => {
        const c = ws[`${col}${r}`];
        return c ? String(c.v ?? '') : '';
      };
      const businessName = get('B');
      if (!businessName) continue;
      const phone = get('F');
      const email = get('S');
      if (!phone && !email) { skipped++; continue; }

      const merchant = {
        businessName,
        platform: 'excel_import',
        url: get('Q') || get('H') || null,
        website: get('H') || null,
        phone: phone || null,
        whatsapp: phone || null,
        email: email || null,
        physicalAddress: get('I') || null,
        category: get('D') || null,
        followers: null,
        evidence: [],
      } as any;

      const result = persistLead({
        merchantId: `m-${r}`,
        runId: 'test-run',
        merchant,
        categoryHint: get('D') || 'service',
        confidenceScore: 60,
        contactScore: phone && email ? 60 : 40,
        fitScore: Number(get('L')) || 0,
        contactValidation: { status: 'VERIFIED', sources: ['excel_import'] },
        metadata: {
          source: 'excel_import',
          rating: Number(get('J')),
          reviews: Number(get('K')),
          priority: get('M'),
          emirate: get('E'),
          revenueBand: get('W'),
          estimatedMonthlyRevenueAed: Number(get('V')),
        },
      });

      if (result.ok) inserted++;
      else if (result.reason === 'duplicate') duplicates++;
    }

    expect(inserted).toBe(4);   // 4 rows have contact info
    expect(skipped).toBe(1);    // 1 row has no phone & no email
    expect(duplicates).toBe(0); // first run — no collisions
  });

  test('re-running with the same data is idempotent (every row is a duplicate)', () => {
    const wb = buildFixtureXlsx();
    const ws = wb.Sheets['📋 All Leads'];

    let inserted = 0;
    let duplicates = 0;
    const range = XLSX.utils.decode_range(ws['!ref']!);
    for (let r = 4; r <= range.e.r + 1; r++) {
      const get = (col: string): string => {
        const c = ws[`${col}${r}`];
        return c ? String(c.v ?? '') : '';
      };
      const businessName = get('B');
      if (!businessName) continue;
      const phone = get('F');
      const email = get('S');
      if (!phone && !email) continue;

      const result = persistLead({
        merchantId: `m-rerun-${r}`,
        runId: 'test-rerun',
        merchant: {
          businessName,
          platform: 'excel_import',
          url: get('H') || null,
          website: get('H') || null,
          phone: phone || null,
          whatsapp: phone || null,
          email: email || null,
          physicalAddress: get('I') || null,
          category: get('D') || null,
          followers: null,
          evidence: [],
        } as any,
        categoryHint: 'service',
        confidenceScore: 60,
        contactScore: 60,
        fitScore: 50,
        contactValidation: { status: 'VERIFIED', sources: [] },
        metadata: {},
      });

      if (result.ok) inserted++;
      else if (result.reason === 'duplicate') duplicates++;
    }

    expect(inserted).toBe(0);
    expect(duplicates).toBe(4);
  });

  test('canonical_id is deterministic across re-runs', () => {
    const a = merchantCanonicalId({
      businessName: 'Zenith Car Wash',
      physicalAddress: 'Al Quoz, Dubai',
      phone: '0501234567',
    });
    const b = merchantCanonicalId({
      businessName: 'Zenith Car Wash',
      physicalAddress: 'Al Quoz, Dubai',
      phone: '0501234567',
    });
    expect(a).toBe(b);
  });
});
