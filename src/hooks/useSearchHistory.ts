import { useState, useEffect, useCallback } from 'react';
import { SearchHistory } from '../types';
import { storageService } from '../services/storageService';

export const useSearchHistory = () => {
  const [history, setHistory] = useState<SearchHistory[]>([]);

  const refreshHistory = useCallback(() => {
    setHistory(storageService.getSearchHistory());
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const saveSearch = useCallback((search: Omit<SearchHistory, 'id' | 'date'>) => {
    storageService.saveSearch(search);
    refreshHistory();
  }, [refreshHistory]);

  const clearHistory = useCallback(() => {
    storageService.clearHistory();
    refreshHistory();
  }, [refreshHistory]);

  return {
    history,
    saveSearch,
    clearHistory,
    refreshHistory
  };
};
