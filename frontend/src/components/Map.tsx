import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import osmtogeojson from 'osmtogeojson';

declare module 'leaflet' {
  namespace Control {
    class Draw extends L.Control {
      constructor(options?: any);
    }
  }
  namespace Draw {
    const Event: {
      CREATED: string;
    };
  }
}

type MapProps = {
  onSTLGenerated: (blob: Blob) => void;
};

export default function Map({ onSTLGenerated }: MapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [geojson, setGeojson] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const map = L.map('map').setView([-23.5505, -46.6333], 13);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      draw: {
        polygon: false,
        rectangle: {
          shapeOptions: { color: '#3388ff', weight: 5 },
        },
        marker: false,
        circle: false,
        polyline: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems },
    });

    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (event) => {
      drawnItems.clearLayers();
      const layer = event.propagatedFrom ?? event.layer;
      drawnItems.addLayer(layer);
      const geo = layer.toGeoJSON();

      const coords = geo.geometry.coordinates[0];
      const allEqual = coords.every(
        ([lng, lat]: [number, number]) =>
          lng === coords[0][0] && lat === coords[0][1]
      );
      if (allEqual) {
        alert('Invalid area: select a real rectangle');
        return;
      }

      const bounds = layer.getBounds();
      const area = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
      if (area > 5000) {
        alert('Please select a smaller area');
        return;
      }

      setGeojson(geo);
      setStatus('Area selected. Click "Generate STL" to continue.');
    });

    return () => {
      map.remove();
    };
  }, []);

  async function fetchBuildingsFromOverpass(polygon: GeoJSON.Polygon) {
    const coords = polygon.coordinates[0];
    const lats = coords.map((c) => c[1]);
    const lngs = coords.map((c) => c[0]);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const query = `
      [out:json][timeout:30];
      (
        way["building"](${minLat},${minLng},${maxLat},${maxLng});
        relation["building"](${minLat},${minLng},${maxLat},${maxLng});
      );
      out body;
      >;
      out skel qt;
    `;

    setStatus('Fetching buildings...');

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: query,
    });

    if (!response.ok) throw new Error(`Overpass error: ${response.statusText}`);

    const osmData = await response.json();
    if (!osmData.elements?.length) throw new Error('No buildings found.');

    const geojson = osmtogeojson(osmData);
    if (!geojson.features?.length) throw new Error('Invalid OSM to GeoJSON conversion');

    setStatus(`${geojson.features.length} buildings found.`);
    return geojson;
  }

  const handleGenerateSTL = async () => {
    if (!geojson) return;

    setGenerating(true);
    setLoadingBuildings(true);

    try {
      const buildingsGeoJSON = await fetchBuildingsFromOverpass(geojson.geometry);
      setLoadingBuildings(false);
      setStatus('Generating 3D model...');

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'model/stl',
        },
        body: JSON.stringify(buildingsGeoJSON),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to generate STL');
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error('Generated STL is empty');

      setStatus(`STL ready: ${(blob.size / 1024).toFixed(1)} KB`);
      onSTLGenerated(blob);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'buildings.stl';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenerating(false);
      setLoadingBuildings(false);
    }
  };

  return (
    <div>
      <div id="map" style={{ height: '600px' }}></div>

      {status && (
        <div style={{
          marginTop: '10px',
          padding: '10px',
          backgroundColor: '#f0f8ff',
          border: '1px solid #ccc',
          borderRadius: '4px'
        }}>
          {status}
        </div>
      )}

      {geojson && (
        <button
          onClick={handleGenerateSTL}
          disabled={generating}
          style={{
            marginTop: '10px',
            padding: '10px 20px',
            background: generating ? '#999' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: generating ? 'not-allowed' : 'pointer',
          }}
        >
          {loadingBuildings ? 'Loading buildings...' :
            generating ? 'Generating STL...' :
            'Generate STL'}
        </button>
      )}
    </div>
  );
}