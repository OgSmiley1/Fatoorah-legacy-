import { Merchant, DashboardStats } from '../types';

// API-backed storage service - replaces localStorage
export const storageService = {
  async getMerchants(filters: Record<string, any> = {}): Promise<Merchant[]> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const response = await fetch(`/api/merchants?${params}`);
    const data = await response.json();
    return data.merchants || [];
  },

  async updateStatus(id: string, status: string, notes?: string): Promise<boolean> {
    const response = await fetch(`/api/merchants/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes }),
    });
    return response.ok;
  },

  async updateNotes(id: string, notes: string): Promise<boolean> {
    const response = await fetch(`/api/merchants/${id}/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    return response.ok;
  },

  async setFollowUp(id: string, date: string): Promise<boolean> {
    const response = await fetch(`/api/merchants/${id}/followup`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    });
    return response.ok;
  },

  async getStats(): Promise<DashboardStats> {
    const response = await fetch('/api/stats');
    return response.json();
  },

  async getSearchRuns(): Promise<any[]> {
    const response = await fetch('/api/search-runs');
    return response.json();
  },

  // Kept for backward compatibility - returns count from backend
  async getExclusionCount(): Promise<number> {
    const stats = await this.getStats();
    return stats.total;
  },
};
