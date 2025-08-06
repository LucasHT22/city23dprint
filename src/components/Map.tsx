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
  const [status, setStatus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchMarkerRef = useRef<L.Marker | null>(null);

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
        polygon: {
          shapeOptions: { color: '#F46036', weight: 4 },
          allowIntersection: false,
          showArea: true,
          guidelineDistance: 10,
          maxPoints: 4,
        },
        rectangle: false,
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
      const layer = event.layer;
      drawnItems.addLayer(layer);

      const geo = layer.toGeoJSON();
      const coords = geo.geometry.coordinates[0];

      if (coords.length !== 5 || coords.slice(0, 4).length !== 4) {
        alert('You must select exactly 4 points.');
        return;
      }

      const bounds = layer.getBounds();
      const area = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
      if (area > 5000) {
        alert('Please select a smaller area.');
        return;
      }

      setGeojson(geo);
      setStatus('Area selected. Click "Generate STL" to continue.');
    });

    map.on('click', () => {
      setShowResults(false);
    });

    return () => {
      map.remove();
    };
  }, []);

  async function searchLocation(query:string) {
    if (!query.trim) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    setSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
      );

      if (!response.ok) throw new Error('Search failed');
      
      const results = await response.json();
      setSearchResults(results);
      setShowResults(results.length > 0);
    } catch (error) {
      setSearchResults([]);
      setShowResults(false);
    } finally {
      setSearching(false);
    }
  }

  function handleSearchInput(e: React.ChangeEvent<HTMLInputElement>) {
    const query = e.target.value;
    setSearchQuery(query);

    const timeoutId = setTimeout(() => {
      searchLocation(query);
    }, 300);

    return () => clearTimeout(timeoutId);
  }

  function selectSearchResult(result: any) {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    
    if (mapRef.current) {
      if (searchMarkerRef.current) {
        mapRef.current.removeLayer(searchMarkerRef.current);
      }

      searchMarkerRef.current = L.marker([lat, lon])
        .addTo(mapRef.current)
        .bindPopup(result.display_name)
        .openPopup();

      mapRef.current.setView([lat, lon], 15);
    }

    setSearchQuery(result.display_name);
    setShowResults(false);
  }

  async function fetchBuildingsFromOverpass(polygon: GeoJSON.Polygon) {
    const coords = polygon.coordinates[0];
    const lats = coords.map((c) => c[1]);
    const lngs = coords.map((c) => c[0]);

    const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
    const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];

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
    if (!geojson.features?.length) throw new Error('Invalid OSM to GeoJSON conversion.');

    setStatus(`${geojson.features.length} buildings found.`);
    return geojson;
  }

  async function handleGenerateSTL() {
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
          Accept: 'model/stl',
        },
        body: JSON.stringify(buildingsGeoJSON),
      });

      if (!response.ok) throw new Error(await response.text() || 'Failed to generate STL');

      const blob = await response.blob();
      if (blob.size === 0) throw new Error('Generated STL is empty');

      setStatus(`STL ready: ${(blob.size / 1024).toFixed(1)} KB`);

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
      const message = err instanceof Error ? err.message : 'Unknown error';
      setStatus(`Error: ${message}`);
      alert(`Error: ${message}`);
    } finally {
      setGenerating(false);
      setLoadingBuildings(false);
    }
  }

  return (
    <><div style={{ position: 'relative', marginBottom: 10, zIndex: 1000 }}>
      <div style={{ position: 'relative', marginBottom: 10, zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', background: 'white', border: '2px solid #ddd', borderRadius: 8, padding: '8px 12px' }}>
          <input 
            type="text" 
            placeholder="Search an address..." 
            value={searchQuery} 
            onChange={handleSearchInput} 
            style={{ 
              flex: 1, 
              border: 'none', 
              outline: 'none', 
              fontSize: 16, 
              backgroundColor: 'transparent' 
            }} 
          />
          {searching && (
            <div style={{ marginLeft: 8, fontSize: 14, color: '#666'}}>
              Searching...
            </div>
          )}
        </div>
        {showResults && searchResults.length > 0 && (
          <div style={{ 
            position: 'absolute', 
            top: '100%', 
            left: 0, 
            right: 0, 
            backgroundColor: 'white', 
            border: '1px solid #ddd', 
            borderRadius: 8, 
            maxHeight: 200, 
            overflowY: 'auto', 
            zIndex: 1001 
          }}>
            {searchResults.map((result, index) => (
              <div 
                key={index} 
                onClick={() => selectSearchResult(result)} 
                style={{ 
                  padding: '12px 16px', 
                  borderBottom: index < searchResults.length - 1 ? '1px solid #eee' : 'none', 
                  cursor: 'pointer', 
                  fontSize: 14, 
                  lineHeight: 1.5 
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f5f5f5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                }}
              >
                <div style={{ color: '#666', fontSize: 12 }}>
                  {result.display_name}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="map" style={{ height: 600 }}></div>

      {status && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            backgroundColor: '#f0f8ff',
            border: '1px solid #ccc',
            borderRadius: 4,
          }}
        >
          {status}
        </div>
      )}

      {geojson && (
        <button
          onClick={handleGenerateSTL}
          disabled={generating}
          style={{
            marginTop: 10,
            padding: '10px 20px',
            background: generating ? '#999' : '#F46036',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: generating ? 'not-allowed' : 'pointer',
          }}
        >
          {loadingBuildings
            ? 'Loading buildings...'
            : generating
              ? 'Generating STL...'
              : 'Generate STL'}
        </button>
      )}
      </div></>
  );
}