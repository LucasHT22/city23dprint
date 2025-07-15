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
      EDITED: string;
      DELETED: string;
      DRAWSTART: string;
      DRAWSTOP: string;
      DRAWVERTEX: string;
      EDITSTART: string;
      EDITMOVE: string;
      EDITRESIZE: string;
      EDITSTOP: string;
      DELETESTART: string;
      DELETESTOP: string;
      TOOLBAROPENED: string;
      TOOLBARCLOSED: string;
      MARKERCONTEXT: string;
    };
  }
}

type MapProps = {
  onSTLGenerated: (blob: Blob) => void;
}

export default function Map({ onSTLGenerated }: MapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [geojson, setGeojson] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [status, setStatus] = useState<string>('')

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

      const bounds = layer.getBounds();
      const area = bounds.getNorthEast().distanceTo(bounds.getSouthWest());

      if (area > 5000) {
        alert("Please select a smaller area");
        return;
      }

      setGeojson(geo);
      setStatus('Selected area. Click on "Generate STL to continue.');
    });
    return () => {
      map.remove();
    };
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
  [out:json][timeout:30];
  (
    way["building"](${minLat},${minLng},${maxLat},${maxLng});
    relation["building"](${minLat},${minLng},${maxLat},${maxLng});
  );
  out body;
  >;
  out skel qt;
`;

setStatus('Searching for buildings...');

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: query
  });
  
  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.statusText}`);
  }

  const osmData = await response.json();

  if (!osmData.elements || osmData.elements.length === 0) {
    throw new Error('Data not found.');
  }

  const geojson = osmtogeojson(osmData);

  if (!geojson.features || geojson.features.length === 0) {
    throw new Error('No data bout buildings');
  }

  setStatus(`${geojson.features.length} buildings found`);

  return geojson;
}

  const handleGenerateSTL = async () => {
    if (!geojson) return;

    setGenerating(true);
    setLoadingBuildings(true);

    try {
      const buildingsGeoJSON = await fetchBuildingsFromOverpass(geojson.geometry);
      setLoadingBuildings(false);
      setStatus('Generating...');
      
      if (!buildingsGeoJSON.features || buildingsGeoJSON.features.length === 0) {
        alert('No buildings found in the area.');
        return;
      }

      const response = await fetch('http://localhost:3001/generate-model', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'model/stl' },
        body: JSON.stringify(buildingsGeoJSON)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `Error ${response.status}: ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error || errorMsg;
          if (errorJson.details) {
            console.error('Details:', errorJson.details);
          }
        } catch (e) {
          console.error('Response:', errorText);
        }
        throw new Error(errorMsg);
      }

      const blob = await response.blob();
      
      if (blob.size === 0) {
        throw new Error('Empty STL');
      }

      setStatus(`3D Model generated: (${(blob.size / 1024).toFixed(1)} KB)`);
      onSTLGenerated(blob);

    } catch (err) {
      console.error('ERROR: ', err);
      const errorMsg = err instanceof Error ? err.message : 'Error unknown';
      setStatus(`Error: ${errorMsg}`);
      alert(`Error generating: ${errorMsg}`);
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
          }}>
            {loadingBuildings ? 'Loading buildings...' : 
             generating ? 'Generating STL...' : 
             'Generate STL'}
          </button>
      )}
    </div>
  );
}