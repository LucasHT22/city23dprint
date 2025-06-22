import json
import sys
import osmnx as ox
import shapely
import trimesh
import geopandas as gpd
from shapely.ops import transform
from shapely.geometry import shape
import pyproj

try:
    data = json.load(sys.stdin)
    
    if 'features' not in data or not data['features']:
        raise Exception("No features in GeoJSON")
    
    gdf = gpd.GeoDataFrame.from_features(data["features"])

    unified_geom = gdf.unary_union

    if not unified_geom.is_valid:
        unified_geom = unified_geom.buffer(0)
    
    if not unified_geom.is_valid or unified_geom.is_empty:
        raise Exception("Invalid or empty geometry")

    geometry_utm, utm_crs = ox.projection.project_geometry(unified_geom)

    tags = {"building": True}
    buildings = ox.features_from_polygon(geometry_utm, tags=tags)
    if buildings.empty:
        raise Exception("No buildings found in the area")

    buildings = buildings.to_crs(utm_crs)
    
    meshes = []

    for _, row in buildings.iterrows():
        geom = row.geometry

        if geom is None or geom.is_empty or not geom.is_valid:
            continue

        try:
            if geom.geom_type == 'Polygon':
                base = trimesh.creation.extrude_polygon(geom, height=10)
                print(f"Polygon: vertices={len(base.vertices)}, faces={len(base.faces)}", file=sys.stderr)
                meshes.append(base)
            elif geom.geom_type == 'MultiPolygon':
                for poly in geom.geoms:
                    if not poly.is_valid:
                        continue
                    base = trimesh.creation.extrude_polygon(poly, height=10)
                    print(f"Multipolygon part: vertices={len(base.vertices)}, faces={len(base.faces)}", file=sys.stderr)
                    meshes.append(base)
        except Exception as extrusion_error:
            print(f"Skipping geometry due to extrusion error: {extrusion_error}", file=sys.stderr)
            continue
    
    if not meshes:
        raise Exception("No buildings found.")
    
    combined = trimesh.util.concatenate(meshes)
    stl_data = combined.export(file_type='stl')
    sys.stdout.buffer.write(stl_data)

except Exception as e:
    sys.stderr.write(f"ERROR {str(e)}\n")
    sys.exit(1)