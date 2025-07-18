export const prerender = false;

import type { APIRoute } from 'astro';
import { polygon as turfPolygon } from '@turf/helpers';
import booleanValid from '@turf/boolean-valid';

import primitivesPkg from '@jscad/modeling/src/primitives';
import extrusionsPkg from '@jscad/modeling/src/operations/extrusions';
import booleansPkg from '@jscad/modeling/src/operations/booleans';
import stlSerializerPkg from '@jscad/stl-serializer';

const { polygon } = primitivesPkg;
const { extrudeLinear } = extrusionsPkg;
const { union } = booleansPkg;
const { serialize } = stlSerializerPkg;

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return new Response('Content-Type must be application/json', { status: 400 });
    }
    console.log('Received Content-Type: ', contentType);
    const rawBody = await request.text();
    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.substring(0, 200) + '...');
    if (!rawBody || rawBody.trim() == '') {
      return new Response('Request body is empty', { status: 400 });
    }

    let geojson;
    try {
      geojson = JSON.parse(rawBody);
      console.log('Parsed GeoJSON successfully');
      console.log('Features count:', geojson.features?.length);
    } catch (parseError) {
      console.error('JSON Parse Error: ', parseError);
      return new Response('Invalid JSON in request body', { status: 400 });
    }

    if (!geojson || typeof geojson !== 'object') {
      return new Response('Invalid GeoJSON: not an object', { status: 400 });
    }

    if (!geojson.features || !Array.isArray(geojson.features)) {
      return new Response('Invalid GeoJSON: features must be an array', { status: 400 });
    }

    if (geojson.features.length === 0) {
      return new Response('Invalid GeoJSON: no features', { status: 400 });
    }

    console.log('Starting to process features...');
    const meshes = [];
    let processedCount = 0;
    let errorCount = 0;

    for (const feature of geojson.features) {
      processedCount++;
      if (processedCount % 100 === 0) {
        console.log(`Processing feature ${processedCount}/${geojson.features.length}`);
      }
      const geom = feature.geometry;
      if (!geom) continue;

      let polygons: any[] = [];
      if (geom.type === 'Polygon') polygons = [geom.coordinates];
      else if (geom.type === 'MultiPolygon') polygons = geom.coordinates;
      else continue;

      for (const coords of polygons) {
        try {
          if (!booleanValid(turfPolygon(coords))) continue;
        } catch (turfError) {
          console.warn('Invalid polygon coordinates:', turfError);
          errorCount++;
          continue;
        }

        const height = getHeight(feature.properties);

        const [outer, ...holes] = coords as [[number, number][], ...[number, number][][]];

        const points = [...outer];
        const paths = [outer.map((_, i) => i)];

        holes.forEach(hole => {
          const holeStartIndex = points.length;
          points.push(...hole);
          paths.push(hole.map((_, i) => i + holeStartIndex));
        });

        try {
          const shape = polygon({ points, paths });
          const mesh = extrudeLinear({ height }, shape);
          meshes.push(mesh);
        } catch (e) {
          console.warn('Failed to extrude polygon:', e);
          errorCount++;
          continue;
        }
      }
    }

    console.log(`Processing complete. Processed: ${processedCount}, Errors: ${errorCount}, Valid meshes: ${meshes.length}`);

    if (meshes.length === 0) {
      return new Response('No valid buildings to generate STL', { status: 400 });
    }

    let combined;
    try {
      combined = union(...meshes);
    } catch (unionError) {
      console.error('Failed to union meshes:', unionError);
      return new Response('Failed to combine 3D models', { status: 500 });
    }

    let stlData;
    try {
      stlData = serialize(combined, { binary: false });
    } catch (serializeError) {
      console.error('Failed to serialize STL:', serializeError);
      return new Response('Failed to generate STL file', { status: 500 });
    }

    return new Response(stlData, {
      status: 200,
      headers: {
        'Content-Type': 'model/stl',
        'Content-Disposition': 'attachment; filename="buildings.stl"',
      },
    });
  } catch (e) {
    console.error('Error generating STL:', e);
    return new Response('Internal error: ' + (e instanceof Error ? e.message : String(e)), {
      status: 500,
    });
  }
};

function getHeight(props: any): number {
  if (!props) return 15;

  if (props.height) {
    const h = parseFloat(props.height.toString().replace('m', '').trim());
    if (!isNaN(h)) return Math.min(Math.max(h, 3), 300);
  }

  if (props['building:levels']) {
    const lvl = parseInt(props['building:levels']);
    if (!isNaN(lvl)) return lvl * 3.5;
  }

  if (props.building) {
    const b = props.building.toLowerCase();
    if (['house', 'detached', 'residential'].includes(b)) return 8;
    if (['apartments', 'commercial', 'retail'].includes(b)) return 25;
    if (['office', 'tower'].includes(b)) return 45;
    if (b === 'skyscraper') return 120;
  }

  return 15;
}