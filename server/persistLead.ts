// server/persistLead.ts
// Single point of insert for hunt-discovered merchants. Extracted from
// searchService.huntMerchants so the persistence path is testable on its
// own and so concurrent hunts can share the canonical_id collision path.

import db from '../db.ts';
import { v4 as uuidv4 } from 'uuid';
import { merchantCanonicalId, normalizeName } from './dedupService.ts';
import { logger } from './logger.ts';

export interface PersistLeadInput {
  merchantId: string;
  runId: string;
  merchant: any;
  categoryHint: string;
  confidenceScore: number;
  contactScore: number;
  fitScore: number;
  qualityScore?: number;
  reliabilityScore?: number;
  complianceScore?: number;
  contactValidation: any;
  metadata: any;
}

export interface PersistLeadResult {
  ok: boolean;
  merchantId: string;
  reason?: 'duplicate' | 'insert_failed';
}

/**
 * Insert a merchant + lead pair atomically. Uses INSERT OR IGNORE on the
 * canonical_id unique partial index, so two concurrent hunts that surface
 * the same merchant collapse into one row instead of racing.
 *
 * Returns { ok: true, merchantId } when a NEW row was created. If the
 * canonical_id already exists, returns { ok: false, reason: 'duplicate',
 * merchantId: <existing id> } so the caller can skip without a 500.
 */
export function persistLead(input: PersistLeadInput): PersistLeadResult {
  const { merchantId, runId, merchant: m, categoryHint } = input;
  const canonicalId = merchantCanonicalId({
    businessName: m.businessName,
    physicalAddress: m.physicalAddress,
    phone: m.phone,
  });

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT OR IGNORE INTO merchants (
        id, business_name, normalized_name, source_platform, source_url,
        phone, whatsapp, email, instagram_handle, github_url,
        facebook_url, tiktok_handle, physical_address,
        category, dul_number, confidence_score, contactability_score,
        myfatoorah_fit_score, quality_score, reliability_score, compliance_score,
        followers, evidence_json, contact_validation_json,
        metadata_json, canonical_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      merchantId,
      m.businessName,
      normalizeName(m.businessName),
      m.platform,
      m.url,
      m.phone,
      m.whatsapp || m.phone,
      m.email,
      m.instagramHandle,
      m.githubUrl || null,
      m.facebookUrl,
      m.tiktokHandle,
      m.physicalAddress,
      m.category || categoryHint,
      m.dulNumber || null,
      input.confidenceScore,
      input.contactScore,
      input.fitScore,
      input.qualityScore ?? 0,
      input.reliabilityScore ?? 0,
      input.complianceScore ?? 0,
      typeof m.followers === 'number' && m.followers > 0 ? m.followers : null,
      JSON.stringify(m.evidence || []),
      JSON.stringify(input.contactValidation),
      JSON.stringify(input.metadata),
      canonicalId
    );

    if (info.changes === 0) {
      // Row collided on canonical_id — find the existing merchant and bail.
      const existing = db.prepare('SELECT id FROM merchants WHERE canonical_id = ?').get(canonicalId) as any;
      return { ok: false as const, merchantId: existing?.id || merchantId, reason: 'duplicate' as const };
    }

    db.prepare(
      `INSERT INTO leads (id, merchant_id, run_id, status) VALUES (?, ?, ?, 'NEW')`
    ).run(uuidv4(), merchantId, runId);

    return { ok: true as const, merchantId };
  });

  try {
    return tx();
  } catch (e: any) {
    logger.warn('merchant_insert_failed', { name: m.businessName, error: e.message });
    return { ok: false, merchantId, reason: 'insert_failed' };
  }
}
