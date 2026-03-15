import { Merchant } from '../types';

export const telegramService = {
  async sendMessage(token: string, chatId: string, merchant: Merchant): Promise<boolean> {
    const message = this.formatMerchantMessage(merchant);
    
    try {
      const response = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, chatId, message })
      });

      const data = await response.json() as { ok: boolean };
      return data.ok;
    } catch (error) {
      console.error('Failed to send Telegram message:', error);
      return false;
    }
  },

  async sendBulkMessages(token: string, chatId: string, merchants: Merchant[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const merchant of merchants) {
      const ok = await this.sendMessage(token, chatId, merchant);
      if (ok) success++;
      else failed++;
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return { success, failed };
  },

  formatMerchantMessage(m: Merchant): string {
    const name = m.businessName || 'Unknown';
    const category = m.category || 'N/A';
    const ig = m.instagramHandle || 'N/A';
    const location = m.location || m.platform || 'N/A';
    const contactQuality = m.contactConfidence?.overall || 'N/A';
    const url = m.url || '';
    const script = m.scripts?.english || `Hi ${name}, we'd love to help you accept payments online with MyFatoorah!`;

    return `
${name}
Category: ${category}
IG: @${ig}
Location: ${location}

QUALIFICATION:
Fit Score: ${m.fitScore || 0}/100
Contact Quality: ${m.contactScore || 0}/100 (${contactQuality})
Confidence: ${m.confidenceScore || 0}/100

OUTREACH SCRIPT:
${script}

${url}
    `.trim();
  },

  async testConnection(token: string, chatId: string): Promise<boolean> {
    try {
      const response = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, chatId })
      });

      const data = await response.json() as { ok: boolean };
      return data.ok;
    } catch {
      return false;
    }
  }
};
