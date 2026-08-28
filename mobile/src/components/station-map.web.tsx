import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import type { Charger, Coordinate, Station } from '@/domain/models';

type StationMapProps = {
  stations: Station[];
  chargers: Charger[];
  userCoordinate: Coordinate;
  selectedStationId?: string;
  onSelectStation: (stationId: string) => void;
};

const POSITIONS = [
  { left: '44%', top: '30%' },
  { left: '66%', top: '58%' },
  { left: '27%', top: '70%' },
  { left: '53%', top: '77%' },
] as const;

export function StationMap({ stations, chargers, selectedStationId, onSelectStation }: StationMapProps) {
  return (
    <View
      accessibilityLabel="Mapa dos eletropostos"
      role="region"
      style={styles.map}>
      <View style={[styles.road, styles.roadOne]} />
      <View style={[styles.road, styles.roadTwo]} />
      <View style={[styles.road, styles.roadThree]} />
      <Text style={[styles.mapLabel, { left: 18, top: 18 }]}>São Paulo</Text>
      <Text style={[styles.neighborhood, { left: '12%', top: '48%' }]}>Pinheiros</Text>
      <Text style={[styles.neighborhood, { left: '57%', top: '18%' }]}>Jardins</Text>
      <Text style={[styles.neighborhood, { left: '60%', top: '82%' }]}>Moema</Text>
      {stations.map((station, index) => {
        const available = chargers.filter(
          (charger) => charger.stationId === station.id && charger.status === 'available',
        ).length;
        const selected = station.id === selectedStationId;
        return (
          <Pressable
            accessibilityLabel={`${station.name}, ${available} ${available === 1 ? 'vaga livre' : 'vagas livres'}`}
            accessibilityRole="button"
            key={station.id}
            onPress={() => onSelectStation(station.id)}
            style={[
              styles.marker,
              POSITIONS[index % POSITIONS.length],
              selected && styles.selectedMarker,
            ]}>
            <Text style={styles.markerText}>{available}</Text>
          </Pressable>
        );
      })}
      <View style={styles.userMarker} />
      <View style={styles.attribution}>
        <Text style={styles.attributionText}>© OpenStreetMap · OpenFreeMap</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    backgroundColor: '#171D22',
    borderColor: Colors.border,
    borderRadius: Radius.large,
    borderWidth: 1,
    height: 310,
    overflow: 'hidden',
    position: 'relative',
  },
  road: {
    backgroundColor: '#343B41',
    borderColor: '#454D54',
    borderWidth: 1,
    height: 18,
    position: 'absolute',
    width: '130%',
  },
  roadOne: { left: '-14%', top: '42%', transform: [{ rotate: '13deg' }] },
  roadTwo: { left: '-8%', top: '67%', transform: [{ rotate: '-23deg' }] },
  roadThree: { left: '28%', top: '38%', transform: [{ rotate: '72deg' }], width: '72%' },
  mapLabel: {
    color: Colors.text,
    fontFamily: Fonts.semiBold,
    fontSize: 13,
    position: 'absolute',
  },
  neighborhood: {
    color: Colors.textFaint,
    fontFamily: Fonts.medium,
    fontSize: 9,
    position: 'absolute',
  },
  marker: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderColor: Colors.coral,
    borderRadius: 19,
    borderWidth: 3,
    height: 38,
    justifyContent: 'center',
    marginLeft: -19,
    marginTop: -19,
    position: 'absolute',
    width: 38,
  },
  selectedMarker: {
    backgroundColor: Colors.coralAction,
    borderColor: Colors.white,
    transform: [{ scale: 1.18 }],
  },
  markerText: { color: Colors.white, fontFamily: Fonts.bold, fontSize: 11 },
  userMarker: {
    backgroundColor: Colors.blue,
    borderColor: Colors.white,
    borderRadius: 9,
    borderWidth: 3,
    height: 18,
    left: '48%',
    position: 'absolute',
    top: '49%',
    width: 18,
  },
  attribution: {
    backgroundColor: '#0B0C0FCC',
    bottom: 7,
    paddingHorizontal: 5,
    paddingVertical: 2,
    position: 'absolute',
    right: 7,
  },
  attributionText: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 7 },
});
