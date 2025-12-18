import { createContext, useCallback, useContext, useMemo, useRef, useState, type PropsWithChildren } from 'react';

export type MapFocusRequest = {
  restaurantId: string;
  name: string;
  lat: number;
  lng: number;
};

type FocusEvent = MapFocusRequest & { nonce: number };

type MapFocusContextValue = {
  lastFocus: FocusEvent | null;
  focusRestaurant: (req: MapFocusRequest) => void;
};

const MapFocusContext = createContext<MapFocusContextValue | null>(null);

export function MapFocusProvider({ children }: PropsWithChildren) {
  const [lastFocus, setLastFocus] = useState<FocusEvent | null>(null);
  const counterRef = useRef(0);

  const focusRestaurant = useCallback((req: MapFocusRequest) => {
    counterRef.current += 1;
    setLastFocus({ ...req, nonce: counterRef.current });
  }, []);

  const value = useMemo<MapFocusContextValue>(() => ({ lastFocus, focusRestaurant }), [lastFocus, focusRestaurant]);

  return <MapFocusContext.Provider value={value}>{children}</MapFocusContext.Provider>;
}

export function useMapFocus() {
  const ctx = useContext(MapFocusContext);
  if (!ctx) throw new Error('useMapFocus must be used within MapFocusProvider');
  return ctx;
}




