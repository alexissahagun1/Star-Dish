import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { setHapticsEnabled as setLibHapticsEnabled } from '../lib/haptics';

type Settings = {
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
};

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: PropsWithChildren) {
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);

  useEffect(() => {
    setLibHapticsEnabled(hapticsEnabled);
  }, [hapticsEnabled]);

  const setHapticsEnabled = useCallback((enabled: boolean) => {
    setHapticsEnabledState(enabled);
  }, []);

  const value = useMemo<Settings>(() => ({ hapticsEnabled, setHapticsEnabled }), [hapticsEnabled, setHapticsEnabled]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}




