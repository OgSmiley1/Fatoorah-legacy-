import { Merchant, SearchParams, LeadStatus } from "../types";

export const geminiService = {
  // WizardChat uses /api/ai-chat directly via fetch — no client-side Gemini needed

  async aiSearchMerchants(params: SearchParams): Promise<Merchant[]> {
    // Route through backend so the API key stays server-side
    return geminiService.searchMerchants(params);
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
    if (!response.ok) throw new Error(`Failed to ingest merchants: ${response.statusText}`);
    return response.json();
  },

  async getLeads(status?: string): Promise<any[]> {
    const url = status ? `/api/leads?status=${status}` : '/api/leads';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch leads: ${response.statusText}`);
    return response.json();
  },

  async updateLead(id: string, updates: any): Promise<void> {
    const response = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error(`Failed to update lead: ${response.statusText}`);
  },

  async getStats(): Promise<any> {
    const response = await fetch('/api/stats');
    if (!response.ok) throw new Error(`Failed to fetch stats: ${response.statusText}`);
    const data = await response.json();
    return {
      totalMerchants: data?.total_merchants?.count ?? 0,
      totalLeads: data?.total_leads?.count ?? 0,
      newLeads: data?.new_leads?.count ?? 0,
      onboarded: data?.onboarded?.count ?? 0,
      recentRuns: data?.recent_runs ?? []
    };
  }
};
