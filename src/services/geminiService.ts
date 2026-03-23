import { Merchant, SearchParams, LeadStatus } from "../types";

export const geminiService = {
  async createWizardChat() {
    // Check if AI is available on the server
    const status = await fetch('/api/ai-status');
    const { available } = await status.json();
    if (!available) throw new Error("AI not available — set GEMINI_API_KEY on server");

    // Return a chat-like object that proxies to server
    const history: any[] = [];
    return {
      sendMessage: async ({ message }: { message: string }) => {
        const response = await fetch('/api/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history })
        });
        const result = await response.json();
        // Add to history for context
        history.push({ role: 'user', parts: [{ text: message }] });
        if (result.text) {
          history.push({ role: 'model', parts: [{ text: result.text }] });
        }
        return result;
      }
    };
  },

  async aiSearchMerchants(params: SearchParams): Promise<Merchant[]> {
    try {
      const response = await fetch('/api/ai-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: params.keywords,
          location: params.location,
          maxResults: params.maxResults || 30
        })
      });

      if (!response.ok) {
        console.warn('AI search failed:', response.status);
        return [];
      }

      const result = await response.json();
      return result.merchants || [];
    } catch (error) {
      console.error("AI Search error:", error);
      return [];
    }
  },

  async searchMerchants(params: SearchParams): Promise<Merchant[]> {
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: params.keywords,
          location: params.location,
          maxResults: params.maxResults
        })
      });

      if (!response.ok) {
        throw new Error('Failed to search merchants');
      }

      const result = await response.json();
      return result.merchants;
    } catch (error) {
      console.error("Search error:", error);
      throw error;
    }
  },

  async ingestMerchants(merchants: Merchant[], query: string, location: string): Promise<any> {
    const response = await fetch('/api/merchants/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchants, query, location })
    });
    if (!response.ok) throw new Error(`Ingest failed: ${response.status}`);
    return response.json();
  },

  async getLeads(status?: string): Promise<any[]> {
    const url = status ? `/api/leads?status=${encodeURIComponent(status)}` : '/api/leads';
    const response = await fetch(url);
    if (!response.ok) return [];
    return response.json();
  },

  async updateLead(id: string, updates: any): Promise<void> {
    const response = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error(`Update failed: ${response.status}`);
  },

  async getStats(): Promise<any> {
    const response = await fetch('/api/stats');
    if (!response.ok) return { totalMerchants: 0, totalLeads: 0, newLeads: 0, onboarded: 0, recentRuns: [] };
    const data = await response.json();
    return {
      totalMerchants: data.total_merchants?.count ?? 0,
      totalLeads: data.total_leads?.count ?? 0,
      newLeads: data.new_leads?.count ?? 0,
      onboarded: data.onboarded?.count ?? 0,
      recentRuns: data.recent_runs ?? []
    };
  }
};
