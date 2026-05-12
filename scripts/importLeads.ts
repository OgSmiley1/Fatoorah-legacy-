#!/usr/bin/env tsx
// scripts/importLeads.ts
// One-shot CLI: import the 493 leads from the uploaded
// MF_Service_Leads_493_…xlsx into our SQLite via persistLead().
//
// Usage:
//   npx tsx scripts/importLeads.ts <path-to-xlsx> [--sheet="📋 All Leads"] [--dry-run]
//
// Idempotent: canonical_id dedup means re-runs report all as duplicates.

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { persistLead } from '../server/persistLead.ts';
import { logger } from '../server/logger.ts';

interface ImporterStats {
  rowsRead: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  errors: number;
}

const DEFAULT_SHEET = '📋 All Leads';
// Header row is 3 in the uploaded workbook; data starts at row 4.
const HEADER_ROW = 3;
const DATA_START_ROW = 4;

const COLS = {
  businessName: 'B',
  contacted: 'C',
  sector: 'D',
  emirate: 'E',
  phone: 'F',
  hasWebsite: 'G',
  website: 'H',
  address: 'I',
  rating: 'J',
  reviews: 'K',
  score: 'L',
  priority: 'M',
  whyPaymentLink: 'N',
  status: 'O',
  notes: 'P',
  mapsLink: 'Q',
  dateAdded: 'R',
  email: 'S',
  waClickLink: 'T',
  emailClickLink: 'U',
  monthlyRevenue: 'V',
  revenueBand: 'W',
} as const;

function cell(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr] as XLSX.CellObject | undefined;
  if (!c) return '';
  if (c.t === 'n') return String(c.v ?? '');
  if (c.t === 'b') return c.v ? 'true' : 'false';
  return String(c.v ?? '').trim();
}

function parseMonthlyRevenue(raw: string): number {
  // Accepts plain numbers, "AED 25,000", "25K", "1.2M"...
  if (!raw) return 0;
  const s = raw.replace(/[^0-9.kKmM]/g, '');
  if (!s) return 0;
  let mult = 1;
  let n = s;
  if (/[kK]$/.test(s)) { mult = 1_000; n = s.slice(0, -1); }
  else if (/[mM]$/.test(s)) { mult = 1_000_000; n = s.slice(0, -1); }
  const v = parseFloat(n);
  return Number.isFinite(v) ? Math.round(v * mult) : 0;
}

function parsePriority(raw: string): 'HOT' | 'WARM' | 'COLD' | null {
  const u = raw.toUpperCase();
  if (u.includes('HOT')) return 'HOT';
  if (u.includes('WARM')) return 'WARM';
  if (u.includes('COLD')) return 'COLD';
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const xlsxPath = args.find(a => !a.startsWith('--'));
  if (!xlsxPath) {
    console.error('Usage: tsx scripts/importLeads.ts <path-to-xlsx> [--sheet="📋 All Leads"] [--dry-run]');
    process.exit(2);
  }
  const sheetArg = args.find(a => a.startsWith('--sheet='));
  const sheetName = sheetArg ? sheetArg.split('=')[1].replace(/^["']|["']$/g, '') : DEFAULT_SHEET;
  const dryRun = args.includes('--dry-run');

  console.log(`[import] reading ${xlsxPath} sheet="${sheetName}" dryRun=${dryRun}`);
  // Use XLSX.read on a Buffer — readFile isn't exported under ESM imports.
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { cellDates: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error(`[import] sheet "${sheetName}" not found. Available: ${wb.SheetNames.join(', ')}`);
    process.exit(2);
  }

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const lastRow = range.e.r + 1; // 1-indexed
  console.log(`[import] sheet range: rows ${range.s.r + 1}–${lastRow}`);

  const stats: ImporterStats = { rowsRead: 0, inserted: 0, duplicates: 0, skipped: 0, errors: 0 };
  const runId = `import-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;

  for (let r = DATA_START_ROW; r <= lastRow; r++) {
    const businessName = cell(ws, `${COLS.businessName}${r}`);
    if (!businessName) continue;
    stats.rowsRead++;

    const phone = cell(ws, `${COLS.phone}${r}`);
    const email = cell(ws, `${COLS.email}${r}`);
    if (!phone && !email) {
      stats.skipped++;
      continue;
    }

    const sector = cell(ws, `${COLS.sector}${r}`);
    const emirate = cell(ws, `${COLS.emirate}${r}`);
    const website = cell(ws, `${COLS.website}${r}`);
    const address = cell(ws, `${COLS.address}${r}`);
    const ratingStr = cell(ws, `${COLS.rating}${r}`);
    const reviewsStr = cell(ws, `${COLS.reviews}${r}`);
    const scoreStr = cell(ws, `${COLS.score}${r}`);
    const priority = parsePriority(cell(ws, `${COLS.priority}${r}`));
    const monthlyRevenue = parseMonthlyRevenue(cell(ws, `${COLS.monthlyRevenue}${r}`));
    const revenueBand = cell(ws, `${COLS.revenueBand}${r}`);
    const whyPaymentLink = cell(ws, `${COLS.whyPaymentLink}${r}`);

    const rating = Number(ratingStr) || null;
    const reviews = Number(reviewsStr) || null;
    const fitScore = Number(scoreStr) || 0;
    const annualRevenue = monthlyRevenue ? monthlyRevenue * 12 : 0;

    const merchant = {
      businessName,
      platform: 'excel_import' as const,
      url: cell(ws, `${COLS.mapsLink}${r}`) || website || null,
      website: website || null,
      phone: phone || null,
      whatsapp: phone || null,
      email: email || null,
      instagramHandle: null,
      facebookUrl: null,
      tiktokHandle: null,
      githubUrl: null,
      physicalAddress: address || null,
      category: sector || null,
      dulNumber: null,
      followers: null,
      evidence: whyPaymentLink ? [whyPaymentLink] : [],
    } as any;

    const metadata = {
      source: 'excel_import',
      importedAt: new Date().toISOString(),
      rating,
      reviews,
      priority,
      revenueBand: revenueBand || null,
      estimatedAnnualRevenueAed: annualRevenue,
      estimatedMonthlyRevenueAed: monthlyRevenue,
      whyPaymentLink: whyPaymentLink || null,
      emirate,
      verifiedStatus: 'UNVERIFIED',
      agreementScore: 0,
      verifiedSources: ['excel_import'],
    };

    const contactValidation = {
      status: phone || email ? 'VERIFIED' : 'UNVERIFIED',
      sources: ['excel_import'],
    };

    if (dryRun) {
      console.log(`[dry] would insert: ${businessName} (${sector || '?'}, ${emirate || '?'}) priority=${priority} rev=${annualRevenue}`);
      continue;
    }

    try {
      const result = persistLead({
        merchantId: uuidv4(),
        runId,
        merchant,
        categoryHint: sector || 'service',
        confidenceScore: 60,
        contactScore: phone && email ? 60 : phone ? 40 : 20,
        fitScore,
        contactValidation,
        metadata,
      });

      if (result.ok) {
        stats.inserted++;
      } else if (result.reason === 'duplicate') {
        stats.duplicates++;
      } else {
        stats.errors++;
      }
    } catch (e: any) {
      stats.errors++;
      logger.warn('import_lead_failed', { row: r, name: businessName, error: e.message });
    }
  }

  console.log('\n[import] DONE');
  console.log(`  rows read:    ${stats.rowsRead}`);
  console.log(`  inserted:     ${stats.inserted}`);
  console.log(`  duplicates:   ${stats.duplicates}`);
  console.log(`  skipped:      ${stats.skipped} (no phone & no email)`);
  console.log(`  errors:       ${stats.errors}`);
  console.log(`  runId:        ${runId}`);
}

main();
