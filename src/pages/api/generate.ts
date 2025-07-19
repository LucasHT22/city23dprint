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
        if (height <= 0) continue;

        const [outer, ...holes] = coords as [[number, number][], ...[number, number][][]];
        if (!outer || outer.length < 3) continue;

        const cleanOuter = removeDuplicatePoints(outer);
        if (cleanOuter.length < 3) continue;

        const points = [...cleanOuter];
        const paths = [cleanOuter.map((_, i) => i)];

        holes.forEach(hole => {
          const cleanHole = removeDuplicatePoints(hole);
          if (cleanHole.length < 3) {
            const holeStartIndex = points.length;
            points.push(...cleanHole);
            paths.push(cleanHole.map((_, i) => i + holeStartIndex));
          }
        });

        try {
          const shape = polygon({ points, paths });
          const mesh = extrudeLinear({ height }, shape);
          
          if (processedCount <= 3) {
            console.log(`Mesh ${processedCount} details:`, {
              hasPolygons: !!mesh?.polygons,
              polygonCount: mesh?.polygons?.length || 0,
              hasVertices: mesh?.polygons?.[0]?.vertices?.length > 0,
              height: height,
              pointsCount: points.length,
              pathsCount: paths.length
            });
          }

          if (mesh && isValidMesh(mesh)) {
            meshes.push(mesh);
          } else {
            console.warn('Invalid mesh generated, skipping');
            errorCount++;
          }
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
      if (meshes.length === 1) {
        combined = meshes[0];
      } else {
        console.log('Starting union operation...');
        // combined = unionInBatches(meshes, 50);
        console.log('Skipping union, will serialize individual meshes...');

        let testMesh = meshes[0];
        try {
          const testStl = serialize(testMesh, { binary: false });
          console.log('Individual mesh serialization test: SUCCESS');

          const allStls: string[] = [];
          for (let i = 0; i < meshes.length; i++) {
            if (i % 500 === 0) {
              console.log(`Serializing mesh ${i + 1}/${meshes.length}`);
            }
            try {
              const stl = serialize(meshes[i], { binary: false });
              allStls.push(stl);
            } catch (meshError) {
              console.warn(`Failed to serialize mesh ${i + 1}:`, meshError);
            }
          }

          console.log(`Successfully serialized ${allStls.length}/${meshes.length} meshes`);
          const combinedStl = allStls.join('\n');
          
          return new Response(combinedStl, {
            status: 200,
            headers: {
              'Content-Type': 'model/stl',
              'Content-Disposition': 'attachment; filename="buildings.stl"',
            },
          });
        } catch (testError) {
          console.error('Individual mesh test failed:', testError);
          throw new Error('Individual meshes cannot be serialized: ' + testError.message);
        }
      }

      console.log('Union operation completed successfully');
    } catch (unionError) {
      console.error('Failed to process meshes:', unionError);
      return new Response('Failed to combine 3D models: ' + unionError.message, { status: 500 });
    }
    let stlData;
    try {
      console.log('Starting STL serialization...');
      
      console.log('Combined mesh details:', {
        type: typeof combined,
        hasPolygons: !!combined?.polygons,
        polygonCount: combined?.polygons?.length || 0,
        hasVertices: combined?.polygons?.[0]?.vertices?.length > 0,
        firstPolygonVertexCount: combined?.polygons?.[0]?.vertices?.length || 0,
        sampleVertex: combined?.polygons?.[0]?.vertices?.[0]
      });
      
      stlData = serialize(combined, { binary: false });
      console.log('STL serialization completed successfully');
    } catch (serializeError) {
      console.error('Failed to serialize STL:', serializeError);
      console.log('Attempting fallback: serializing individual meshes...');

      try {
        const individualStls: string[] = [];
        let successCount = 0;
        
        for (let i = 0; i < Math.min(meshes.length, 10); i++) {
          try {
            const mesh = meshes[i];
            console.log(`Testing mesh ${i + 1}:`, {
              hasPolygons: !!mesh?.polygons,
              polygonCount: mesh?.polygons?.length || 0,
              hasVertices: mesh?.polygons?.[0]?.vertices?.length > 0
            });
            
            const individualStl = serialize(mesh, { binary: false });
            individualStls.push(individualStl);
            successCount++;
          } catch (meshError) {
            console.warn(`Failed to serialize individual mesh ${i + 1}:`, meshError);
          }
        }
        if (successCount > 0) {
          console.log(`Successfully serialized ${successCount} individual meshes`);
          const combinedStl = individualStls.join('\n');
          
          return new Response(combinedStl, {
            status: 200,
            headers: {
              'Content-Type': 'model/stl',
              'Content-Disposition': 'attachment; filename="buildings.stl"',
            },
          });
        } else {
          throw new Error('No individual meshes could be serialized');
        }
      } catch (fallbackError) {
        console.error('Fallback serialization also failed:', fallbackError);
        return new Response('Failed to generate STL file: ' + serializeError.message, { status: 500 });
      }
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

function removeDuplicatePoints(points: [number, number][]): [number, number][] {
  const result: [number, number][] = [];
  const tolerance = 1e-10;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    
    if (Math.abs(current[0] - next[0]) > tolerance || Math.abs(current[1] - next[1]) > tolerance) {
      result.push(current);
    }
  }
  
  return result;
}

function isValidMesh(mesh: any): boolean {
  try {
    if (!mesh || !mesh.polygons || !Array.isArray(mesh.polygons)) {
      return false;
    }
    
    if (mesh.polygons.length === 0) {
      return false;
    }
    
    for (const polygon of mesh.polygons) {
      if (!polygon.vertices || polygon.vertices.length < 3) {
        return false;
      }
    }
    
    return true;
  } catch (e) {
    return false;
  } 
}

function unionInBatches(meshes: any[], batchSize: number): any {
  if (meshes.length === 0) return null;
  if (meshes.length === 1) return meshes[0];
  
  let result = meshes[0];
  
  for (let i = 1; i < meshes.length; i += batchSize) {
    const batch = meshes.slice(i, i + batchSize);
    
    try {
      let batchResult = batch[0];
      for (let j = 1; j < batch.length; j++) {
        batchResult = union(batchResult, batch[j]);
      }
      
      result = union(result, batchResult);
      
      console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil((meshes.length - 1) / batchSize)}`);
    } catch (e) {
      console.warn(`Failed to union batch starting at ${i}:`, e);
    }
  }
  
  return result;
}