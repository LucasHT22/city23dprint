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

function debugMesh(mesh: any, index: number = 0): void {
  console.log(`MESH ${index} DEBUG`);
  console.log('Mesh type:', typeof mesh);
  console.log('Mesh constructor:', mesh?.constructor?.name);
  console.log('Mesh keys:', Object.keys(mesh || {}));

  if (mesh?.polygons) {
    console.log('Polygons count:', mesh.polygons.length);
    console.log('First polygon structure:', {
      hasVertices: !!mesh.polygons[0]?.vertices,
      verticesCount: mesh.polygons[0]?.vertices?.length || 0,
      hasPlane: !!mesh.polygons[0]?.plane,
      firstVertex: mesh.polygons[0]?.vertices?.[0],
      allVertices: mesh.polygons[0]?.vertices
    });

    if (mesh.polygons[0]?.vertices?.[0]) {
      const vertex = mesh.polygons[0].vertices[0];
      console.log('Vertex dimension check:', {
        isArray: Array.isArray(vertex),
        length: vertex?.length,
        is3D: Array.isArray(vertex) && vertex.length >= 3,
        values: vertex
      });
    }
  }
  if (mesh?.transforms) {
    console.log('Transforms: ', mesh.transforms);
  }

  console.log('END DEBUG\n');
}

// if you are reading this, know that it's 01 am on a Saturday and Lucas trying everything possible to make this work, that's the result of many talks with humans, duck debug and ai 

function meshToSTL(mesh: any, meshIndex: number = 0): string {
  console.log(`Converting mesh ${meshIndex} to STL manually...`);
  
  if (!mesh) {
    console.warn(`Mesh ${meshIndex} is null/undefined`);
    return '';
  }
  if (!mesh.polygons || !Array.isArray(mesh.polygons)) {
    console.warn(`Mesh ${meshIndex} has no valid polygons array`);
    return '';
  }
  if (mesh.polygons.length === 0) {
    console.warn(`Mesh ${meshIndex} has empty polygons array`);
    return '';
  }
  
  let stl = `solid building_${meshIndex}\n`;
  let validTriangles = 0;
  let invalidTriangles = 0;

  for (let polyIndex = 0; polyIndex < mesh.polygons.length; polyIndex++) {
    const polygon = mesh.polygons[polyIndex];
    if (!polygon?.vertices || !Array.isArray(polygon.vertices)) {
      invalidTriangles++;
      continue;
    }
    if (polygon.vertices.length < 3) {
      invalidTriangles++;
      continue;
    }

    let normal = [0, 0, 1];
    try {
      if (polygon.vertices.length >= 3) {
        const v1 = polygon.vertices[0];
        const v2 = polygon.vertices[1];
        const v3 = polygon.vertices[2];
        if (v1.length >= 3 && v2.length >= 3 && v3.length >= 3) {
          const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
          const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
          
          normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0]
          ];
          
          const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
          if (length > 0) {
            normal = [normal[0] / length, normal[1] / length, normal[2] / length];
          }
        }
      }
    } catch (normalError) {
      console.warn(`Failed to calculate normal for polygon ${polyIndex}:`, normalError);
    }

    for (let i = 1; i < polygon.vertices.length - 1; i++) {
      const v1 = polygon.vertices[0];
      const v2 = polygon.vertices[i];
      const v3 = polygon.vertices[i + 1];
      if (!Array.isArray(v1) || v1.length < 3 || !Array.isArray(v2) || v2.length < 3 || !Array.isArray(v3) || v3.length < 3) {
        invalidTriangles++;
        continue;
      }

      const area = calculateTriangleArea(v1, v2, v3);
      if (area < 1e-10) {
        invalidTriangles++;
        continue;
      }
      stl += `  facet normal ${normal[0].toFixed(6)} ${normal[1].toFixed(6)} ${normal[2].toFixed(6)}\n`;
      stl += '    outer loop\n';
      stl += `      vertex ${v1[0].toFixed(6)} ${v1[1].toFixed(6)} ${v1[2].toFixed(6)}\n`;
      stl += `      vertex ${v2[0].toFixed(6)} ${v2[1].toFixed(6)} ${v2[2].toFixed(6)}\n`;
      stl += `      vertex ${v3[0].toFixed(6)} ${v3[1].toFixed(6)} ${v3[2].toFixed(6)}\n`;
      stl += '    endloop\n';
      stl += '  endfacet\n';
      
      validTriangles++;
    }
  }
  stl += `endsolid building_${meshIndex}\n`;
  
  console.log(`Mesh ${meshIndex} STL conversion: ${validTriangles} valid triangles, ${invalidTriangles} invalid triangles`);
  
  if (validTriangles === 0) {
    console.warn(`Mesh ${meshIndex} produced no valid triangles!`);
    return '';
  }
  
  return stl;
}

function calculateTriangleArea(v1: number[], v2: number[], v3: number[]): number {
  const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
  const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
  
  const cross = [
    edge1[1] * edge2[2] - edge1[2] * edge2[1],
    edge1[2] * edge2[0] - edge1[0] * edge2[2],
    edge1[0] * edge2[1] - edge1[1] * edge2[0]
  ];

  const magnitude = Math.sqrt(cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]);
  return magnitude / 2;
}

function isValidMesh(mesh: any): boolean {
  try {
    if (!mesh || typeof mesh !== 'object') {
      console.warn('Mesh validation failed: not an object');
      return false;
    }
    if (!mesh.polygons || !Array.isArray(mesh.polygons)) {
      console.warn('Mesh validation failed: no polygons array');
      return false;
    }
    if (mesh.polygons.length === 0) {
      console.warn('Mesh validation failed: empty polygons array');
      return false;
    }

    let validPolygons = 0;
    for (const polygon of mesh.polygons) {
      if (polygon?.vertices && Array.isArray(polygon.vertices) && polygon.vertices.length >= 3) {
        let valid3D = true;
        for (const vertex of polygon.vertices) {
          if (!Array.isArray(vertex) || vertex.length < 3) {
            valid3D = false;
            break;
          }
        }
        if (valid3D) {
          validPolygons++;
        }
      }
    }
    console.log(`Mesh validation: ${validPolygons}/${mesh.polygons.length} valid polygons`);
    return validPolygons > 0;
  } catch (e) {
    console.warn('Mesh validation error:', e);
    return false;
  }
}

async function generateSTLWithFallbacks(meshes: any[]): Promise<string> {
  console.log(`\nSTARTING STL GENERATION WITH ${meshes.length} MESHES`);
  if (meshes.length) {
    try {
      console.log('Strategy 1: Attempting union and JSCAD serialization...');
      const combined = unionMeshes(meshes);
      if (combined) {
        debugMesh(combined, -1);
        const stl = serialize(combined, { binary: false });
        console.log('Strategy 1: SUCCESS - JSCAD serialization worked');
        return stl;
      }
    } catch (error) {
      console.log('Strategy 1: FAILED -', error.message);
    }
  }

  try {
    console.log('Strategy 2: Attempting JSCAD serialization on individual meshes...');
    const stlParts: string[] = [];
    let successCount = 0;
    
    for (let i = 0; i < meshes.length; i++) {
      try {
        debugMesh(meshes[i], i);
        const stl = serialize(meshes[i], { binary: false });
        if (stl && stl.length > 100) {
          stlParts.push(stl);
          successCount++;
        }
      } catch (meshError) {
        console.warn(`JSCAD serialization failed for mesh ${i}:`, meshError.message);
      }
    }
    
    if (successCount > 0) {
      console.log(`Strategy 2: PARTIAL SUCCESS - ${successCount}/${meshes.length} meshes serialized`);
      return stlParts.join('\n');
    } else {
      throw new Error('No meshes could be serialized with JSCAD');
    }
    
  } catch (error) {
    console.log('Strategy 2: FAILED -', error.message);
  }

  try {
    console.log('Strategy 3: Attempting manual STL generation...');
    const stlParts: string[] = [];
    let successCount = 0;
    
    for (let i = 0; i < meshes.length; i++) {
      debugMesh(meshes[i], i);
      const stl = meshToSTL(meshes[i], i);
      if (stl && stl.length > 100) {
        stlParts.push(stl);
        successCount++;
      }
    }

    if (successCount > 0) {
      console.log(`Strategy 3: SUCCESS - ${successCount}/${meshes.length} meshes converted manually`);
      return stlParts.join('\n');
    } else {
      throw new Error('Manual STL generation failed for all meshes');
    }
  } catch (error) {
    console.log('Strategy 3: FAILED -', error.message);
  }

  throw new Error('All STL generation strategies failed');
}

function unionMeshes(meshes: any[]): any {
  if (meshes.length === 0) return null;
  if (meshes.length === 1) return meshes[0];

  try {
    let result = meshes[0];

    for (let i = 1; i < meshes.length; i++) {
      try {
        result = union(result, meshes[i]);
        if (i % 10 === 0) {
          console.log(`Unique progress: ${i}/${meshes.length}`);
        }
      } catch (unionError) {
        console.warn(`Failed to union mesh ${i}:`, unionError.message);
      }
    }
    return result;
  } catch (error) {
    console.error('Union operation failed completely:', error);
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now();
  
  try {
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return new Response('Content-Type must be application/json', { status: 400 });
    }
    
    const rawBody = await request.text();
    console.log('Received Content-Type:', contentType);
    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.substring(0, 200) + '...');
    
    if (!rawBody || rawBody.trim() === '') {
      return new Response('Request body is empty', { status: 400 });
    }

    let geojson;
    try {
      geojson = JSON.parse(rawBody);
      console.log('Parsed GeoJSON successfully');
      console.log('Features count:', geojson.features?.length);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
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

    console.log('\nSTARTING MESH GENERATION');
    const meshes = [];
    let processedCount = 0;
    let errorCount = 0;
    let validMeshCount = 0;

    for (const feature of geojson.features) {
      processedCount++;
      if (processedCount % 50 === 0) {
        console.log(`Processing feature ${processedCount}/${geojson.features.length}`);
      }      
      const geom = feature.geometry;
      if (!geom) {
        errorCount++;
        continue;
      }

      let polygons: any[] = [];
      if (geom.type === 'Polygon') polygons = [geom.coordinates];
      else if (geom.type === 'MultiPolygon') polygons = geom.coordinates;
      else {
        errorCount++;
        continue;
      }

      for (const coords of polygons) {
        try {
          if (!booleanValid(turfPolygon(coords))) {
            errorCount++;
            continue;
          }
        } catch (turfError) {
          console.warn(`Invalid polygon coordinates for feature ${processedCount}:`, turfError.message);
          errorCount++;
          continue;
        }

        const height = getHeight(feature.properties);
        if (height <= 0) {
          errorCount++;
          continue;
        }

        const [outer, ...holes] = coords as [[number, number][], ...[number, number][][]];
        if (!outer || outer.length < 3) {
          errorCount++;
          continue;
        }

        const cleanOuter = removeDuplicatePoints(outer);
        if (cleanOuter.length < 3) {
          errorCount++;
          continue;
        }

        const points = [...cleanOuter];
        const paths = [cleanOuter.map((_, i) => i)];

        holes.forEach(hole => {
          const cleanHole = removeDuplicatePoints(hole);
          if (cleanHole.length >= 3) {
            const holeStartIndex = points.length;
            points.push(...cleanHole);
            paths.push(cleanHole.map((_, i) => i + holeStartIndex));
          }
        });

        try {
          const shape = polygon({ points, paths });
          const mesh = extrudeLinear({ height }, shape);
          
          if (validMeshCount < 3) {
            console.log(`\nMESH ${validMeshCount + 1} GENERATION DEBUG`);
            console.log('Input:', { height, pointsCount: points.length, pathsCount: paths.length });
            console.log('Shape created:', !!shape);
            debugMesh(mesh, validMeshCount + 1);
          }

          if (mesh && isValidMesh(mesh)) {
            meshes.push(mesh);
            validMeshCount++;
          } else {
            console.warn(`Invalid mesh generated for feature ${processedCount}, skipping`);
            errorCount++;
          }
        } catch (extrudeError) {
          console.warn(`Failed to extrude polygon for feature ${processedCount}:`, extrudeError.message);
          errorCount++;
          continue;
        }
      }
    }

    console.log(`\nMESH GENERATION COMPLETE`);
    console.log(`Processed: ${processedCount}, Errors: ${errorCount}, Valid meshes: ${validMeshCount}`);

    if (meshes.length === 0) {
      return new Response('No valid buildings to generate STL', { status: 400 });
    }

    const stlData = await generateSTLWithFallbacks(meshes);
    
    const endTime = Date.now();
    console.log(`\nGENERATION COMPLETE`);
    console.log(`Total time: ${endTime - startTime}ms`);
    console.log(`STL size: ${(stlData.length / 1024).toFixed(1)} KB`);
    console.log(`Buildings processed: ${validMeshCount}`);

    return new Response(stlData, {
      status: 200,
      headers: {
        'Content-Type': 'model/stl',
        'Content-Disposition': 'attachment; filename="buildings.stl"',
      },
    });

  } catch (error) {
    const endTime = Date.now();
    console.error(`\nGENERATION FAILED`);
    console.error(`Total time: ${endTime - startTime}ms`);
    console.error('Error:', error);
    
    return new Response(
      `Internal error: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 }
    );
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