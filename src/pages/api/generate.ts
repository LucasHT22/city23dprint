export const prerender = false;

import type { APIRoute } from 'astro';
import { polygon as turfPolygon } from '@turf/helpers';
import booleanValid from '@turf/boolean-valid';
import pkg from '@jscad/modeling';
const { primitives, extrusions } = pkg;

const { polygon } = primitives;
const { extrudeLinear } = extrusions;

interface ScaleAnalysis {
  geographicBounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
    widthKm: number;
    heightKm: number;
    areaKm2: number;
  };
  complexity: {
    buildingCount: number;
    totalVertices: number;
    averageVerticesPerBuilding: number;
    maxVerticesPerBuilding: number;
  };
  recommendedScale: {
    factor: number;
    description: string;
    finalSizeDescription: string;
  };
}

function analyzeAreaAndComplexity(geojson: any): ScaleAnalysis {
  console.log('Analyzing area and complexity for automatic scaling...');

  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  let totalVertices = 0;
  let buildingCount = 0;
  let maxVerticesPerBuilding = 0;

  for (const feature of geojson.features) {
    const geom = feature.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;

    buildingCount++;
    let buildingVertices = 0;

    const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

    for (const coords of polygons) {
      for (const ring of coords) {
        buildingVertices += ring.length;
        for (const [lon, lat] of ring) {
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLon = Math.min(minLon, lon);
          maxLon = Math.max(maxLon, lon);
        }
      }
    }

    totalVertices += buildingVertices;
    maxVerticesPerBuilding = Math.max(maxVerticesPerBuilding, buildingVertices);
  }

  const widthKm = haversineDistance(
    { lat: (minLat + maxLat) / 2, lon: minLon },
    { lat: (minLat + maxLat) / 2, lon: maxLon }
  );

  const heightKm = haversineDistance(
    { lat: minLat, lon: (minLon + maxLon) / 2 },
    { lat: maxLat, lon: (minLon + maxLon) / 2 }
  );

  const areaKm2 = widthKm * heightKm;
  const recommendedScale = calculateOptimalScale({
    widthKm, heightKm, areaKm2, buildingCount, totalVertices, maxVerticesPerBuilding
  });

  const analysis: ScaleAnalysis = {
    geographicBounds: { minLat, maxLat, minLon, maxLon, widthKm, heightKm, areaKm2 },
    complexity: {
      buildingCount,
      totalVertices,
      averageVerticesPerBuilding: Math.round(totalVertices / buildingCount),
      maxVerticesPerBuilding
    },
    recommendedScale
  };

  console.log('AREA ANALYSIS:', {
    dimensions: `${widthKm.toFixed(2)}km x ${heightKm.toFixed(2)}km`,
    area: `${areaKm2.toFixed(2)} km²`,
    buildings: buildingCount,
    scale: `1:${recommendedScale.factor}`,
    finalSize: recommendedScale.finalSizeDescription
  });

  return analysis;
}

function calculateOptimalScale(params: {
  widthKm: number;
  heightKm: number;
  areaKm2: number;
  buildingCount: number;
  totalVertices: number;
  maxVerticesPerBuilding: number;
}): { factor: number; description: string; finalSizeDescription: string } {
  
  const { widthKm, heightKm, areaKm2, buildingCount, totalVertices } = params;

  let baseFactor: number;
  let description: string;

  if (areaKm2 < 0.1) {
    baseFactor = 1000;
    description = 'Square';
  } else if (areaKm2 < 0.5) {
    baseFactor = 2000;
    description = 'Small Neighborhood';
  } else if (areaKm2 < 2.0) {
    baseFactor = 5000;
    description = 'Medium Neighborhood';
  } else if (areaKm2 < 10.0) {
    baseFactor = 10000;
    description = 'District';
  } else {
    baseFactor = 20000;
    description = 'Metropolitan Area';
  }

  let complexityAdjustment = 1.0;
  const density = buildingCount / areaKm2;
  const avgComplexity = totalVertices / buildingCount;

  if (density > 1000) complexityAdjustment *= 1.5;
  else if (density > 500) complexityAdjustment *= 1.3;
  else if (density < 50) complexityAdjustment *= 0.8;

  if (avgComplexity > 50) complexityAdjustment *= 1.2;
  else if (avgComplexity < 10) complexityAdjustment *= 0.9;

  const adjustedFactor = Math.round(baseFactor * complexityAdjustment);
  const finalWidthCm = (widthKm * 1000) / adjustedFactor * 100;
  const finalHeightCm = (heightKm * 1000) / adjustedFactor * 100;

  const finalSizeDescription = `${finalWidthCm.toFixed(1)}cm x ${finalHeightCm.toFixed(1)}cm (1:${adjustedFactor})`;

  return {
    factor: adjustedFactor,
    description,
    finalSizeDescription
  };
}

function haversineDistance(point1: { lat: number; lon: number }, point2: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = (point2.lat - point1.lat) * Math.PI / 180;
  const dLon = (point2.lon - point1.lon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) * Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function convertToLocalCoordinates(
  coordinates: [number, number][], 
  origin: [number, number],
  scaleFactor: number
): [number, number][] {
  const earthRadius = 6378137;
  const toRadians = Math.PI / 180;
  const refLatRad = origin[1] * toRadians;

  return coordinates.map(coord => {
    const deltaLat = (coord[1] - origin[1]) * toRadians;
    const deltaLon = (coord[0] - origin[0]) * toRadians;
    const x = (deltaLon * earthRadius * Math.cos(refLatRad)) / scaleFactor;
    const y = (deltaLat * earthRadius) / scaleFactor;

    return [x, y];
  });
}

function generateOptimizedBase(geojson: any, origin: [number, number], scaleFactor: number): any {
  console.log('Generating optimized base for buildings...');
  
  const baseThickness = 2 / scaleFactor;
  const bufferDistance = 5 / scaleFactor;
  
  const allPoints: [number, number][] = [];
  
  for (const feature of geojson.features) {
    const geom = feature.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    
    const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    
    for (const coords of polygons) {
      const outer = coords[0];
      if (!outer || outer.length < 3) continue;
      
      const cleanOuter = removeDuplicatePoints(outer);
      const localPoints = convertToLocalCoordinates(cleanOuter, origin, scaleFactor);
      allPoints.push(...localPoints);
    }
  }
  
  if (allPoints.length === 0) return null;
  
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (const [x, y] of allPoints) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  
  minX -= bufferDistance;
  maxX += bufferDistance;
  minY -= bufferDistance;
  maxY += bufferDistance;
  
  const basePoints: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY]
  ];
  
  try {
    const baseShape = polygon({ 
      points: basePoints, 
      paths: [[0, 1, 2, 3]] 
    });
    
    const baseMesh = extrudeLinear({ height: baseThickness }, baseShape);
    
    console.log(`Base generated: ${(maxX-minX).toFixed(1)}x${(maxY-minY).toFixed(1)} units, thickness: ${baseThickness.toFixed(3)}`);
    return baseMesh;
    
  } catch (error) {
    console.warn('Failed to generate base:', error);
    return null;
  }
}

function shouldGenerateBase(buildingCount: number, areaKm2: number): boolean {
  if (buildingCount > 50 && areaKm2 < 5) return true;
  if (buildingCount > 100 && areaKm2 < 10) return true;
  return false;
}

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
    if (!mesh || typeof mesh !== 'object') return false;
    if (!mesh.polygons || !Array.isArray(mesh.polygons)) return false;
    if (mesh.polygons.length === 0) return false;
    let validCount = 0;
    const checkLimit = Math.min(5, mesh.polygons.length);
    for (let i = 0; i < checkLimit; i++) {
      const polygon = mesh.polygons[i];
      if (polygon?.vertices && Array.isArray(polygon.vertices) && polygon.vertices.length >= 3) {
        validCount++;
      }
    }
    return validCount > 0;
  } catch (e) {
    return false;
  }
}

async function generateSTLManually(meshes: any[]): Promise<string> {
  console.log(`\nSTARTING MANUAL STL GENERATION WITH ${meshes.length} MESHES`);
  
  const stlParts: string[] = [];
  let successCount = 0;
  const maxMeshes = 200;
  const processLimit = Math.min(maxMeshes, meshes.length);
  
  for (let i = 0; i < processLimit; i++) {
    try {
      const stl = meshToSTL(meshes[i], i);
      if (stl && stl.length > 100) {
        stlParts.push(stl);
        successCount++;
      }
    } catch (meshError) {
      console.warn(`Failed to convert mesh ${i} to STL:`, meshError.message);
      continue;
    }
  } 
  
  if (successCount > 0) {
    console.log(`Manual STL generation: SUCCESS - ${successCount}/${meshes.length} meshes converted`);
    return stlParts.join('\n');
  } else {
    throw new Error('Manual STL generation failed for all meshes');
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

    const maxFeatures = 500;
    if (geojson.features.length > maxFeatures) {
      console.log(`Limiting features from ${geojson.features.length} to ${maxFeatures}`);
      geojson.features = geojson.features.slice(0, maxFeatures);
    }

    const scaleAnalysis = analyzeAreaAndComplexity(geojson);
    const scaleFactor = scaleAnalysis.recommendedScale.factor;
    const origin: [number, number] = [
      (scaleAnalysis.geographicBounds.minLon + scaleAnalysis.geographicBounds.maxLon) / 2,
      (scaleAnalysis.geographicBounds.minLat + scaleAnalysis.geographicBounds.maxLat) / 2
    ];

    console.log(`\nUSING AUTOMATIC SCALE: 1:${scaleFactor}`);
    console.log(`Final miniature size: ${scaleAnalysis.recommendedScale.finalSizeDescription}`);
    console.log(`Origin point: [${origin[0].toFixed(6)}, ${origin[1].toFixed(6)}]`);

    console.log('\nSTARTING MESH GENERATION');
    const meshes = [];
    
    const needsBase = shouldGenerateBase(
      scaleAnalysis.complexity.buildingCount, 
      scaleAnalysis.geographicBounds.areaKm2
    );
    
    if (needsBase) {
      console.log('Generating base for miniature...');
      const baseMesh = generateOptimizedBase(geojson, origin, scaleFactor);
      
      if (baseMesh && isValidMesh(baseMesh)) {
        meshes.push(baseMesh);
        console.log('Base mesh added successfully');
      } else {
        console.log('Base generation failed, continuing without base');
      }
    }
    
    let processedCount = 0;
    let errorCount = 0;
    let validMeshCount = meshes.length;
    let maxProcessingTime = needsBase ? 30000 : 25000;

    for (const feature of geojson.features) {
      if (Date.now() - startTime > maxProcessingTime) {
        console.log(`Timeout protection: stopping at ${processedCount} features`);
        break;
      }
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
          const turfValid = coords.length >= 1 && coords[0].length >= 4;
          if (!turfValid) {
            errorCount++;
            continue;
          }
        } catch (turfError) {
          console.warn(`Invalid polygon coordinates for feature ${processedCount}:`, turfError.message);
          errorCount++;
          continue;
        }

        const height = getHeight(feature.properties) / scaleFactor;
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

        const localOuter = convertToLocalCoordinates(cleanOuter, origin, scaleFactor);
        const points = [...localOuter];
        const paths = [localOuter.map((_, i) => i)];

        holes.forEach(hole => {
          const cleanHole = removeDuplicatePoints(hole);
          if (cleanHole.length >= 3) {
            const localHole = convertToLocalCoordinates(cleanHole, origin, scaleFactor);
            const holeStartIndex = points.length;
            points.push(...localHole);
            paths.push(localHole.map((_, i) => i + holeStartIndex));
          }
        });

        try {
          const shape = polygon({ points, paths });
          const mesh = extrudeLinear({ height }, shape);

          if (mesh && isValidMesh(mesh)) {
            meshes.push(mesh);
            validMeshCount++;
          } else {
            errorCount++;
          }
        } catch (extrudeError) {
          errorCount++;
          continue;
        }
      }
    }

    console.log(`\nMESH GENERATION COMPLETE ${needsBase ? '(WITH BASE)' : '(NO BASE)'}`);
    console.log(`Total meshes: ${meshes.length} (${needsBase ? 'including base' : 'buildings only'})`);
    console.log(`Processed: ${processedCount}, Errors: ${errorCount}, Valid meshes: ${validMeshCount}`);

    if (meshes.length === 0) {
      return new Response('No valid buildings to generate STL', { status: 400 });
    }

    const stlData = await generateSTLManually(meshes);
    
    const endTime = Date.now();
    console.log(`\nGENERATION COMPLETE`);
    console.log(`Total time: ${endTime - startTime}ms`);
    console.log(`STL size: ${(stlData.length / 1024).toFixed(1)} KB`);
    console.log(`Buildings processed: ${validMeshCount}`);

    return new Response(stlData, {
      status: 200,
      headers: {
        'Content-Type': 'model/stl',
        'Content-Disposition': `attachment; filename="miniature_1-${scaleFactor}${needsBase ? '_with_base' : ''}.stl"`,
        'X-Miniature-Scale': `1:${scaleFactor}`,
        'X-Miniature-Size': scaleAnalysis.recommendedScale.finalSizeDescription,
        'X-Has-Base': needsBase.toString(),
      },
    });

  } catch (error) {
    const endTime = Date.now();
    console.error(`\nGENERATION FAILED`);
    console.error(`Total time: ${endTime - startTime}ms`);
    console.error('Error:', error);
    
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }

    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
        processingTime: endTime - startTime
      }),
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
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