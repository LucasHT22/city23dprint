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

export const post: APIRoute = async ({ request }) => {
  try {
    const geojson = await request.json();

    if (!geojson.features || geojson.features.length === 0) {
      return new Response('Invalid GeoJSON: no features', { status: 400 });
    }

    const meshes = [];

    for (const feature of geojson.features) {
      const geom = feature.geometry;
      if (!geom) continue;

      let polygons: any[] = [];
      if (geom.type === 'Polygon') polygons = [geom.coordinates];
      else if (geom.type === 'MultiPolygon') polygons = geom.coordinates;
      else continue;

      for (const coords of polygons) {
        if (!booleanValid(turfPolygon(coords))) continue;

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
          continue;
        }
      }
    }

    if (meshes.length === 0) {
      return new Response('No valid buildings to generate STL', { status: 400 });
    }

    const combined = union(...meshes);

    const stlData = serialize(combined, { binary: false });

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