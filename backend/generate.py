import json
import sys
import osmnx as ox
import shapely
import trimesh
import geopandas as gpd
from shapely.ops import transform
import pyproj

try:
    data = json.load(sys.stdin)
    geometry = shapely.geometry.shape(data['geometry'])

    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    if not geometry.is_valid or geometry.is_empty:
        raise Exception("Invalid geometry.")
    
    proj_latlon = pyproj.CRS("EPSG:4326")
    utm_zone = ox.projection.project_geometry(geometry, to_crs='utm')
    geometry_utm = utm_zone[0]

    print("Geometry:", geometry_utm)

    tags = {"building": True}
    buildings = ox.features_from_polygon(geometry_utm, tags={'building': True})
    if buildings.empty:
        raise Exception("No buildings found in the area")

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