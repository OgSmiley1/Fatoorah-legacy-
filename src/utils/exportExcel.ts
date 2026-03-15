import * as XLSX from 'xlsx';
import { Merchant } from '../types';

export function exportMerchantsToExcel(merchants: Merchant[]) {
  const data = merchants.map((m) => ({
    'Business Name': m.businessName || 'N/A',
    'Category': m.category || 'N/A',
    'Sub-Category': m.subCategory || 'N/A',
    'Platform': m.platform || 'N/A',
    'Website URL': m.website || 'N/A',
    'Instagram Handle': m.instagramHandle || 'N/A',
    'Email': m.email || 'N/A',
    'Phone': m.phone || 'N/A',
    'WhatsApp': m.whatsapp || 'N/A',
    'Fit Score': m.fitScore || 0,
    'Contact Score': m.contactScore || 0,
    'Confidence Score': m.confidenceScore || 0,
    'Contact Quality': m.contactConfidence?.overall || 'UNKNOWN',
    'Phone Confidence': m.contactConfidence?.phone || 'N/A',
    'Email Confidence': m.contactConfidence?.email || 'N/A',
    'Risk Category': m.risk?.category || 'N/A',
    'Status': m.status || 'N/A',
    'Payment Methods Detected': (m.paymentMethods || []).join(', '),
    'First Found Date': m.foundDate ? new Date(m.foundDate).toLocaleDateString('en-GB') : 'N/A',
    'Direct Profile Link': m.url || 'N/A'
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MerchantLeads');

  const colWidths = Object.keys(data[0] || {}).map(key => ({ wch: Math.max(key.length, 15) }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, `MyFatoorah_Leads_${new Date().toISOString().split('T')[0]}.xlsx`);
}
