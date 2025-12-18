import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform } from 'react-native';

import { HomeScreen } from '../screens/HomeScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { FloatingTabBar } from './FloatingTabBar';

const MapScreenComponent =
  Platform.OS === 'web' ? require('../screens/MapScreen.web').MapScreen : require('../screens/MapScreen').MapScreen;

export type RootTabParamList = {
  Home: undefined;
  Map: undefined;
  Profile: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export function RootTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Map"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        // Prevent screens from unmounting when switching tabs
        // This prevents Map component from remounting and triggering new Map Loads
        lazy: false,
        unmountOnBlur: false,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Map" component={MapScreenComponent} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}



