import { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';

export default function Map() {
  useEffect(() => {
    const map = L.map('map').setView([-23.5505, -46.6333], 13);

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
      const layer = event.layer;
      drawnItems.addLayer(layer);
      const geojson = layer.toGeoJSON();
      const bounds = layer.getBounds().toBBoxString();
      console.log('GeoJSON:', geojson);
      console.log('Bounds:', bounds);

      fetch('http://localhost:3001/generate-model', {
        method: 'POST',
        headers: { 'Content-Type': 'applicatin/json' },
        body: JSON.stringify({ geojson })
      })
      .then(response => response.blob())
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'modelo.stl';
        a.click();
      });
    });
  }, []);

  return <div id="map" style={{ height: '600px' }}></div>;
}
