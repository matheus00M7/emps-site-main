import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { getStationChargers } from '@/data/mock-data';
import type { Coordinate, Station } from '@/domain/models';

type StationMapProps = {
  stations: Station[];
  userCoordinate: Coordinate;
  selectedStationId?: string;
  onSelectStation: (stationId: string) => void;
};

function buildMapHtml(stations: Station[], user: Coordinate, selectedStationId?: string) {
  const points = stations.map((station) => ({
    id: station.id,
    name: station.name,
    latitude: station.coordinates.latitude,
    longitude: station.coordinates.longitude,
    available: getStationChargers(station.id).filter((charger) => charger.status === 'available').length,
    selected: station.id === selectedStationId,
  }));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@6.6.0/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { height: 100%; width: 100%; margin: 0; background: #17191d; }
    .maplibregl-ctrl-attrib { font: 9px system-ui, sans-serif; opacity: .78; }
    .station-marker { width: 38px; height: 38px; border-radius: 19px; background: #202224; border: 3px solid #ff323a; box-shadow: 0 8px 18px rgba(0,0,0,.38); display: flex; align-items: center; justify-content: center; color: #fff; font: 700 12px system-ui, sans-serif; }
    .station-marker.selected { width: 46px; height: 46px; border-radius: 23px; background: #ff323a; border-color: #fff; }
    .station-marker.empty { border-color: #727981; color: #a7adb5; }
    .user-marker { width: 18px; height: 18px; border-radius: 9px; background: #4d91ff; border: 3px solid white; box-shadow: 0 4px 14px rgba(77,145,255,.65); }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@6.6.0/dist/maplibre-gl.js"></script>
  <script>
    const points = ${JSON.stringify(points)};
    const user = ${JSON.stringify(user)};
    const map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [user.longitude, user.latitude],
      zoom: 11.8,
      attributionControl: true
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const bounds = new maplibregl.LngLatBounds();
    points.forEach((point) => {
      const marker = document.createElement('button');
      marker.className = 'station-marker' + (point.selected ? ' selected' : '') + (point.available === 0 ? ' empty' : '');
      marker.textContent = String(point.available);
      marker.setAttribute('aria-label', point.name + ', ' + point.available + ' disponíveis');
      marker.onclick = () => window.ReactNativeWebView.postMessage('station:' + point.id);
      new maplibregl.Marker({ element: marker }).setLngLat([point.longitude, point.latitude]).addTo(map);
      bounds.extend([point.longitude, point.latitude]);
    });
    const userMarker = document.createElement('div');
    userMarker.className = 'user-marker';
    new maplibregl.Marker({ element: userMarker }).setLngLat([user.longitude, user.latitude]).addTo(map);
    bounds.extend([user.longitude, user.latitude]);
    map.on('load', () => {
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 54, maxZoom: 13, duration: 0 });
      window.ReactNativeWebView.postMessage('ready');
    });
    map.on('error', () => window.ReactNativeWebView.postMessage('map-error'));
  </script>
</body>
</html>`;
}

export function StationMap({ stations, userCoordinate, selectedStationId, onSelectStation }: StationMapProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const html = useMemo(
    () => buildMapHtml(stations, userCoordinate, selectedStationId),
    [selectedStationId, stations, userCoordinate],
  );

  if (error) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Mapa temporariamente indisponível</Text>
        <Text style={styles.fallbackCopy}>A lista de eletropostos continua disponível logo abaixo.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!ready ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.coral} />
          <Text style={styles.loadingText}>Carregando mapa…</Text>
        </View>
      ) : null}
      <WebView
        allowFileAccess={false}
        javaScriptEnabled
        onError={() => setError(true)}
        onMessage={(event) => {
          const message = event.nativeEvent.data;
          if (message === 'ready') setReady(true);
          if (message === 'map-error') setError(true);
          if (message.startsWith('station:')) onSelectStation(message.replace('station:', ''));
        }}
        originWhitelist={['https://*']}
        source={{ html, baseUrl: 'https://app.emps.com.br' }}
        style={styles.webview}
      />
      <View pointerEvents="none" style={styles.legend}>
        <View style={styles.legendDot} />
        <Text style={styles.legendText}>número de vagas livres</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.large,
    borderWidth: 1,
    height: 310,
    overflow: 'hidden',
  },
  webview: { backgroundColor: Colors.surface, flex: 1 },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    gap: 9,
    justifyContent: 'center',
    zIndex: 2,
  },
  loadingText: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 11 },
  legend: {
    alignItems: 'center',
    backgroundColor: '#111318E8',
    borderRadius: Radius.pill,
    bottom: 12,
    flexDirection: 'row',
    gap: 6,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    position: 'absolute',
  },
  legendDot: { backgroundColor: Colors.coral, borderRadius: 4, height: 7, width: 7 },
  legendText: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 9 },
  fallback: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.large,
    borderWidth: 1,
    gap: 5,
    height: 230,
    justifyContent: 'center',
    padding: 24,
  },
  fallbackTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 14 },
  fallbackCopy: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
    textAlign: 'center',
  },
});
