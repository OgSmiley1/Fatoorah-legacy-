// server/salesHuntService.ts
// Wraps the existing hunter with the Merchant Truth Engine.
// Purpose: keep the mature collector/enrichment pipeline intact while ensuring
// API consumers receive sales-scored merchants with explicit APPROVE/REVIEW/REJECT decisions.

import { huntMerchants as baseHuntMerchants } from './searchService';
import { applyMerchantTruth } from './merchantTruthEngine';

interface SearchParams {
  keywords: string;
  location: string;
  maxResults?: number;
  onlyQualified?: boolean;
  includeReview?: boolean;
  truthMinScore?: number;
}

export async function huntMerchants(
  params: SearchParams,
  onProgress?: (count: number, stage?: string) => void
) {
  const result: any = await baseHuntMerchants(params, onProgress);
  const rawMerchants = Array.isArray(result?.merchants) ? result.merchants : [];
  const includeReview = params.includeReview ?? true;
  const minScore = params.truthMinScore ?? 0;

  const truthScored = rawMerchants
    .map((m: any) => applyMerchantTruth(m))
    .filter((m: any) => m.salesScore >= minScore)
    .filter((m: any) => m.truth.decision === 'APPROVE' || (includeReview && m.truth.decision === 'REVIEW'))
    .sort((a: any, b: any) => b.salesScore - a.salesScore);

  return {
    ...result,
    merchants: truthScored,
    newLeadsCount: truthScored.filter((m: any) => m.status === 'NEW' || !m.status).length,
    truthSummary: {
      totalRaw: rawMerchants.length,
      returned: truthScored.length,
      approved: truthScored.filter((m: any) => m.truth.decision === 'APPROVE').length,
      review: truthScored.filter((m: any) => m.truth.decision === 'REVIEW').length,
      rejected: rawMerchants.length - truthScored.length,
    },
  };
}
