import { Merchant, SearchParams, Lead } from "../types";

export const geminiService = {
  async searchMerchants(params: SearchParams): Promise<Merchant[]> {
    try {
      const response = await fetch('/api/hunt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Search failed');
      }
      
      const result = await response.json();
      return result.merchants;
    } catch (error) {
      console.error("Search error in geminiService:", error);
      throw error;
    }
  },

  async getLeads(status?: string): Promise<any[]> {
    const url = status ? `/api/leads?status=${status}` : '/api/leads';
    const response = await fetch(url);
    return response.json();
  },

  async updateLead(id: string, updates: any): Promise<void> {
    await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  },

  async getStats(): Promise<any> {
    const response = await fetch('/api/stats');
    return response.json();
  }
};
