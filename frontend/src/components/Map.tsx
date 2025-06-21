import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';

type MapProps = {
  onSTLGenerated: () => void;
}

export default function Map({ onSTLGenerated }: MapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [geojson, setGeojson] = useState(null);
  const [generating, setGenerating] = useState(false);

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
        polygon: {},
        rectangle: {},
        marker: false,
        circle: false,
        polyline: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems }
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, function (event) {
      drawnItems.clearLayers();
      const layer = event.propagatedFrom ?? event.layer;
      drawnItems.addLayer(layer);
      const geo = layer.toGeoJSON();
      setGeojson(geo);
    });
  }, []);

  const handleGenerateSTL = () => {
    if (!geojson) return;

    setGenerating(true);

      fetch('http://localhost:3001/generate-model', {
        method: 'POST',
        headers: { 'Content-Type': 'applicatin/json' },
        body: JSON.stringify({ geojson })
      })
      .then((res) => {
        if (!res.ok) throw new Error('Erros generating');
        console.log('Generated!');
        onSTLGenerated?.();
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
