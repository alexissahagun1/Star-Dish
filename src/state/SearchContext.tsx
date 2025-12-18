import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

import type { ViewportBounds, RestaurantWithRanking } from '../types/database';

export type SearchState = {
  active: boolean;
  query: string;
  viewport: ViewportBounds | null;
};

export type RecommendationsState = {
  recentlyViewed: RestaurantWithRanking[];
  topPicks: RestaurantWithRanking[];
  bestRated: RestaurantWithRanking[];
  isLoading: boolean;
};

type SearchContextValue = {
  search: SearchState;
  setSearch: (next: { query: string; viewport: ViewportBounds }) => void;
  clearSearch: () => void;
  recommendations: RecommendationsState;
  setRecommendations: (next: RecommendationsState) => void;
};

const SearchContext = createContext<SearchContextValue | null>(null);

const INITIAL_STATE: SearchState = {
  active: false,
  query: '',
  viewport: null,
};

const INITIAL_RECOMMENDATIONS: RecommendationsState = {
  recentlyViewed: [],
  topPicks: [],
  bestRated: [],
  isLoading: false,
};

export function SearchProvider({ children }: PropsWithChildren) {
  const [search, setSearchState] = useState<SearchState>(INITIAL_STATE);
  const [recommendations, setRecommendationsState] = useState<RecommendationsState>(INITIAL_RECOMMENDATIONS);

  const setSearch = useCallback((next: { query: string; viewport: ViewportBounds }) => {
    setSearchState({
      active: true,
      query: next.query,
      viewport: next.viewport,
    });
  }, []);

  const clearSearch = useCallback(() => {
    setSearchState(INITIAL_STATE);
  }, []);

  const setRecommendations = useCallback((next: RecommendationsState) => {
    setRecommendationsState(next);
  }, []);

  const value = useMemo<SearchContextValue>(
    () => ({ search, setSearch, clearSearch, recommendations, setRecommendations }),
    [search, setSearch, clearSearch, recommendations, setRecommendations]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearch must be used within SearchProvider');
  return ctx;
}


