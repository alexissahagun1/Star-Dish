import React from 'react';
import { Marker } from 'react-native-maps';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';
import type { ClusterPoint } from '../utils/markerClustering';

type Props = {
  cluster: ClusterPoint;
  onPress: (cluster: ClusterPoint) => void;
};

function ClusterMarkerInner({ cluster, onPress }: Props) {
  const pressHandledRef = React.useRef(false);

  const handlePress = React.useCallback(() => {
    // Prevent double calls
    if (pressHandledRef.current) return;
    pressHandledRef.current = true;
    onPress(cluster);
    setTimeout(() => {
      pressHandledRef.current = false;
    }, 100);
  }, [onPress, cluster]);

  const pointCount = cluster.properties.point_count;
  const [lat, lng] = cluster.geometry.coordinates;

  // Determine cluster size based on point count
  const getClusterSize = () => {
    if (pointCount < 10) return 40;
    if (pointCount < 50) return 50;
    if (pointCount < 100) return 60;
    return 70;
  };

  const size = getClusterSize();
  const fontSize = pointCount < 10 ? 12 : pointCount < 100 ? 14 : 16;

  return (
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      onSelect={handlePress}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View
        style={[
          styles.clusterContainer,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      >
        <Text
          style={[
            styles.clusterText,
            {
              fontSize,
            },
          ]}
        >
          {pointCount < 1000 ? pointCount.toString() : cluster.properties.point_count_abbreviated}
        </Text>
      </View>
    </Marker>
  );
}

/**
 * Memoized cluster marker to prevent unnecessary re-renders during panning/zooming.
 * Only re-renders when cluster data actually changes.
 */
export const ClusterMarker = React.memo(
  ClusterMarkerInner,
  (prev, next) => {
    // Re-render if cluster ID or point count changes
    return (
      prev.cluster.properties.cluster_id === next.cluster.properties.cluster_id &&
      prev.cluster.properties.point_count === next.cluster.properties.point_count &&
      prev.cluster.geometry.coordinates[0] === next.cluster.geometry.coordinates[0] &&
      prev.cluster.geometry.coordinates[1] === next.cluster.geometry.coordinates[1] &&
      prev.onPress === next.onPress
    );
  }
);

const styles = StyleSheet.create({
  clusterContainer: {
    backgroundColor: theme.colors.brand,
    borderWidth: 3,
    borderColor: theme.colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  clusterText: {
    color: theme.colors.white,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

