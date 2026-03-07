import { Merchant, SearchHistory } from '../types';
import { generateMerchantHash } from '../utils/normalization';

const STORAGE_KEY_MERCHANTS = 'sw_merchants_history';
const STORAGE_KEY_SEARCH_HISTORY = 'sw_search_history';

export const storageService = {
  // Get all merchants ever found
  getAllMerchants: (): Merchant[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_MERCHANTS);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error('Failed to load merchants history', e);
      return [];
    }
  },

  // Save new merchants, preventing duplicates
  saveMerchants: (newMerchants: Merchant[]) => {
    try {
      const existing = storageService.getAllMerchants();
      const existingHashes = new Set(existing.map(m => m.merchantHash));
      
      const uniqueNew = newMerchants.filter(m => !existingHashes.has(m.merchantHash));
      // Cap history to 200 most recent to avoid localStorage limits
      const updated = [...uniqueNew, ...existing].slice(0, 200);
      
      localStorage.setItem(STORAGE_KEY_MERCHANTS, JSON.stringify(updated));
      return uniqueNew;
    } catch (e) {
      console.error('Failed to save merchants history (likely quota exceeded)', e);
      // If full, try to save only the new ones by clearing old ones
      try {
        localStorage.setItem(STORAGE_KEY_MERCHANTS, JSON.stringify(newMerchants.slice(0, 50)));
      } catch (e2) {
        console.error('Critical storage failure', e2);
      }
      return newMerchants;
    }
  },

  // Get exclusion list (names + urls)
  getExclusionList: (): { names: string[], urls: string[] } => {
    const merchants = storageService.getAllMerchants();
    return {
      names: merchants.map(m => m.businessName),
      urls: merchants.map(m => m.url).filter(Boolean)
    };
  },

  // Check if a merchant is excluded
  isExcluded: (merchant: Partial<Merchant>): boolean => {
    const merchants = storageService.getAllMerchants();
    const hash = generateMerchantHash(merchant as any);
    return merchants.some(m => m.merchantHash === hash);
  },

  // Search History
  getSearchHistory: (): SearchHistory[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SEARCH_HISTORY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  },

  saveSearch: (search: Omit<SearchHistory, 'id' | 'date'>) => {
    const history = storageService.getSearchHistory();
    const newSearch: SearchHistory = {
      ...search,
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString()
    };
    const updated = [newSearch, ...history].slice(0, 10); // Keep last 10
    localStorage.setItem(STORAGE_KEY_SEARCH_HISTORY, JSON.stringify(updated));
  },

  // Clear history
  clearHistory: () => {
    localStorage.removeItem(STORAGE_KEY_MERCHANTS);
    localStorage.removeItem(STORAGE_KEY_SEARCH_HISTORY);
  }
};
