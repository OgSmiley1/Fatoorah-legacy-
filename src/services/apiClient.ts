import { Merchant, SearchParams, LeadStatus } from "../types";

interface SearchResult {
  merchants: Merchant[];
  runId?: string;
  newLeadsCount?: number;
}

interface IngestResult {
  merchants: Merchant[];
  newLeadsCount: number;
}

interface StatsResponse {
  total_merchants: { count: number };
  total_leads: { count: number };
  new_leads: { count: number };
  onboarded: { count: number };
  duplicates: { count: number };
  recent_runs: Array<{ id: string; query: string; created_at: string }>;
}

interface DashboardStats {
  totalMerchants: number;
  totalLeads: number;
  newLeads: number;
  onboarded: number;
  duplicates: number;
  recentRuns: Array<{ id: string; query: string; created_at: string }>;
}

interface LeadUpdate {
  status?: LeadStatus;
  notes?: string;
  next_action?: string;
  follow_up_date?: string;
  outcome?: string;
}

export const apiClient = {
  async aiSearchMerchants(params: SearchParams): Promise<Merchant[]> {
    try {
      const response = await fetch('/api/ai-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: params.keywords,
          location: params.location,
          maxResults: params.maxResults
        })
      });

      if (!response.ok) {
        console.warn('AI search request failed');
        return [];
      }

      const result: SearchResult = await response.json();
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

      const result: SearchResult = await response.json();
      return result.merchants;
    } catch (error) {
      console.error("Search error:", error);
      throw error;
    }
  },

  async ingestMerchants(merchants: Merchant[], query: string, location: string): Promise<IngestResult> {
    const response = await fetch('/api/merchants/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchants, query, location })
    });
    return response.json();
  },

  async getLeads(status?: string): Promise<Merchant[]> {
    const url = status ? `/api/leads?status=${status}` : '/api/leads';
    const response = await fetch(url);
    return response.json();
  },

  async updateLead(id: string, updates: LeadUpdate): Promise<void> {
    await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  },

  async getStats(): Promise<DashboardStats> {
    const response = await fetch('/api/stats');
    const data: StatsResponse = await response.json();
    return {
      totalMerchants: data.total_merchants.count,
      totalLeads: data.total_leads.count,
      newLeads: data.new_leads.count,
      onboarded: data.onboarded.count,
      duplicates: data.duplicates?.count || 0,
      recentRuns: data.recent_runs
    };
  }
};
