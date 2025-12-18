import * as Location from 'expo-location';

export type UserLocation = {
  latitude: number;
  longitude: number;
};

export type LocationPermissionState =
  | { status: 'granted'; location: UserLocation }
  | { status: 'denied' }
  | { status: 'error'; message: string };

export async function getUserLocationBestEffort(): Promise<LocationPermissionState> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { status: 'denied' };

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      status: 'granted',
      location: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
    };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Unknown error' };
  }
}




