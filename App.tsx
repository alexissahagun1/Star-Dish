import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NavigationContainer } from '@react-navigation/native';

import { RootTabs } from './src/navigation/RootTabs';
import { MapFocusProvider } from './src/state/MapFocusContext';
import { SearchProvider } from './src/state/SearchContext';
import { SettingsProvider } from './src/state/SettingsContext';

export default function App() {
  // Note: Mapbox is lazy-loaded via React.lazy in MapScreen.web.lazy.tsx
  // This provides automatic code splitting without needing manual preloading
  // Metro bundler handles the code splitting automatically

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <SearchProvider>
            <MapFocusProvider>
              <NavigationContainer>
                <RootTabs />
              </NavigationContainer>
            </MapFocusProvider>
          </SearchProvider>
        </SettingsProvider>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
