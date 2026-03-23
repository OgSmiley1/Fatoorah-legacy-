import * as XLSX from 'xlsx';
import { Merchant } from '../types';

export function exportMerchantsToExcel(merchants: Merchant[]) {
  if (merchants.length === 0) { alert('No data to export'); return; }

  const data = merchants.map((m) => ({
    'Business Name': m.businessName,
    'Category': m.category || 'N/A',
    'Emirate': m.location || 'N/A',
    'Platform': m.platform || 'N/A',
    'Instagram': m.instagramHandle ? `@${m.instagramHandle}` : 'N/A',
    'Phone': m.phone || 'N/A',
    'WhatsApp': m.whatsapp || 'N/A',
    'Email': m.email || 'N/A',
    'Facebook': m.facebookUrl || 'N/A',
    'TikTok': m.tiktokHandle ? `@${m.tiktokHandle}` : 'N/A',
    'Address': m.physicalAddress || 'N/A',
    'DUL Number': m.dulNumber || 'N/A',
    'COD': m.isCOD ? 'YES' : 'NO',
    'Composite Score': m.qualityScore || 0,
    'Grade': m.evaluationGrade || 'N/A',
    'Verification': m.verification?.status || m.contactValidation?.status || 'UNVERIFIED',
    'Risk Level': m.risk?.category || 'LOW',
    'Risk Factors': (m.risk?.factors || []).join('; '),
    'Payment Gateway': m.paymentGateway || 'None detected',
    'Est. Revenue (AED/mo)': m.revenue?.monthly || 0,
    'Setup Fee (AED)': m.pricing?.setupFee || 0,
    'Recommendation': m.evaluationRecommendation || 'N/A',
    'Source URL': m.url,
    'Website': m.website || 'N/A'
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MyFatoorahLeads');
  ws['!cols'] = Object.keys(data[0]).map(key => ({ wch: Math.max(key.length, 15) }));
  XLSX.writeFile(wb, `MyFatoorah_Leads_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export function exportVendorShortlist(merchants: Merchant[]) {
  // Sort by score descending — include all merchants, not just >70
  const sorted = [...merchants].sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));

  if (sorted.length === 0) { alert('No data to export'); return; }

  // Summary sheet
  const summaryData = sorted.map((m, i) => ({
    'RANK': i + 1,
    'VENDOR NAME': m.businessName.toUpperCase(),
    'GRADE': m.evaluationGrade || 'N/A',
    'COMPOSITE SCORE': m.qualityScore || 0,
    'COD': m.isCOD ? 'YES' : 'NO',
    'VERIFICATION': m.verification?.status || m.contactValidation?.status || 'UNVERIFIED',
    'RISK': m.risk?.category || 'LOW',
    'CONTACT': m.phone || m.email || 'N/A',
    'WHATSAPP': m.whatsapp || 'N/A',
    'INSTAGRAM': m.instagramHandle ? `@${m.instagramHandle}` : 'N/A',
    'CATEGORY': m.category || 'N/A',
    'EMIRATE': m.location || 'N/A',
    'DUL': m.dulNumber || 'NOT VERIFIED',
    'GATEWAY': m.paymentGateway || 'None',
    'EST. REVENUE': `AED ${(m.revenue?.monthly || 0).toLocaleString()}`,
    'STRENGTHS': getStrengths(m).join('; '),
    'CONCERNS': getConcerns(m).join('; '),
    'NEXT ACTION': m.evaluationRecommendation || getNextAction(m),
    'SOURCE': m.url
  }));

  const ws = XLSX.utils.json_to_sheet(summaryData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'VendorShortlist');
  ws['!cols'] = Object.keys(summaryData[0]).map(key => ({ wch: Math.max(key.length, 18) }));

  // Breakdown sheet if evaluation data available
  const breakdownData = sorted.filter(m => m.evaluationBreakdown).map(m => ({
    'VENDOR': m.businessName,
    'Contact Quality (25%)': m.evaluationBreakdown!.contactQuality.score.toFixed(1),
    'Payment Readiness (20%)': m.evaluationBreakdown!.paymentReadiness.score.toFixed(1),
    'Business Legitimacy (20%)': m.evaluationBreakdown!.businessLegitimacy.score.toFixed(1),
    'Social Presence (15%)': m.evaluationBreakdown!.socialPresence.score.toFixed(1),
    'Revenue Potential (10%)': m.evaluationBreakdown!.revenuePotential.score.toFixed(1),
    'Risk Factors (10%)': m.evaluationBreakdown!.riskFactors.score.toFixed(1),
    'COMPOSITE': m.qualityScore || 0
  }));

  if (breakdownData.length > 0) {
    const ws2 = XLSX.utils.json_to_sheet(breakdownData);
    XLSX.utils.book_append_sheet(wb, ws2, 'ScoreBreakdown');
    ws2['!cols'] = Object.keys(breakdownData[0]).map(key => ({ wch: Math.max(key.length, 20) }));
  }

  XLSX.writeFile(wb, `Vendor_Shortlist_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
}

function getStrengths(m: Merchant): string[] {
  const strengths: string[] = [];
  if (m.isCOD) strengths.push('COD merchant - high conversion potential');
  if (m.phone && m.email) strengths.push('Multiple contact channels');
  if (m.dulNumber) strengths.push('Licensed business (DUL verified)');
  if (m.physicalAddress) strengths.push('Physical location confirmed');
  if ((m.qualityScore || 0) >= 70) strengths.push('High composite score');
  if (m.paymentGateway && m.paymentGateway !== 'None detected' && !m.paymentGateway.includes('MyFatoorah')) {
    strengths.push(`Uses ${m.paymentGateway} — switching opportunity`);
  }
  return strengths.length > 0 ? strengths : ['Newly discovered'];
}

function getConcerns(m: Merchant): string[] {
  return m.risk?.factors || [];
}

function getNextAction(m: Merchant): string {
  if (m.paymentGateway?.includes('MyFatoorah')) return 'SKIP — Already uses MyFatoorah';
  if ((m.qualityScore || 0) >= 70 && (m.whatsapp || m.phone)) return 'Contact via WhatsApp immediately';
  if ((m.qualityScore || 0) >= 50) return 'Schedule outreach this week';
  if (m.risk?.category === 'HIGH') return 'Needs more verification before outreach';
  return 'Archive or revisit later';
}
