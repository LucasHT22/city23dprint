import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import osmtogeojson from 'osmtogeojson';

type MapProps = {
  onSTLGenerated: (blob: Blob) => void;
}

export default function Map({ onSTLGenerated }: MapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [geojson, setGeojson] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(false);

  useEffect(() => {
    const map = L.map('map').setView([-23.5505, -46.6333], 13);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      draw: {
        polygon: false,
        rectangle: {
          shapeOptions: {
            color: '#3388ff',
            weight: 5
          }
        },
        marker: false,
        circle: false,
        polyline: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems }
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, async function (event) {
      drawnItems.clearLayers();
      const layer = event.propagatedFrom ?? event.layer;
      drawnItems.addLayer(layer);
      const geo = layer.toGeoJSON();

      const coords = geo.geometry.coordinates[0];
      const allEqual = coords.every(
        ([lng, lat]: [number, number]) => lng === coords[0][0] && lat === coords[0][1]
      );
      if (allEqual) {
        alert('Invalid area: select a real rectangle');
        return;
      }

      setLoadingBuildings(true);
      try {
        const buildingsGeoJSON = await fetchBuildingsFromOverpass(drawnGeo.geometry);
        if (!buildingsGeoJSON.features || buildingsGeoJSON.features.length === 0) {
          alert('No buildings found in the selected area.');
          setGeojson(null);
          return;
        }
        setGeojson(buildingsGeoJSON);
      } catch (err) {
        console.error('Error fetching buildings: ', err);
        alert('Error fetching buildings data.');
        setGeojson(null);
      } finally {
        setLoadingBuildings(false);
      }
    });
  }, []);

async function fetchBuildingsFromOverpass(polygonGeometry:GeoJSON.Polygon) {
  const coords = polygonGeometry.coordinates[0];
  const lats = coords.map(c => c[1]);
  const lngs = coords.map(c => c[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const query = `
    [out:json][timeout:25];
    (
      way["building"](${minLat},${minLng},${maxLat},${maxLng});
      relation["building"](${minLat},${minLng},${maxLat},${maxLng});
    );
    out body;
    >;
    out skel qt;
  `;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query
  });
  
  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.statusText}`);
  }

  const osmData = await response.json();

  const geojson = osmtogeojson(osmData);
  return geojson;
}

  const handleGenerateSTL = () => {
    if (!geojson) return;

    setGenerating(true);

      fetch('http://localhost:3001/generate-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geojson })
      })
      .then((res) => {
        if (!res.ok) throw new Error('Erros generating');
        console.log('Generated!');
        return res.blob();
      })
      .then((blob) => {
        onSTLGenerated(blob);
      })
      .catch((err) => {
        console.error('ERROR: ', err);
        alert('Error generating STL!');
      })
      .finally(() => setGenerating(false));
  };

  return (
    <div>
      <div id="map" style={{ height: '600px' }}></div>

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
          }}>
            {generating ? 'Generating STL...' : 'Generate STL'}
          </button>
      )}
    </div>
  );
}