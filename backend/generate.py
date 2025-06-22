import json
import sys
import osmnx as ox
import shapely
import trimesh
import geopandas as gpd

try:
    data = json.load(sys.stdin)
    geometry = shapely.geometry.shape(data['geometry'])

    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    
    if not geometry.is_valid:
        raise Exception("Invalid geometry.")
    
    if geometry.is_empty:
        raise Exception("Empty geometry")

    print("Geometry:", geometry)

    tags = {"building": True}
    buildings = ox.features_from_polygon(geometry, tags={'building': True})
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
                meshes.append(base)
            elif geom.geom_type == 'MultiPolygon':
                for poly in geom.geoms:
                    if not poly.is_valid:
                        continue
                    base = trimesh.creation.extrude_polygon(poly, height=10)
                    meshes.append(base)
        except Exception as extrusion_error:
            sys.stderr.write(f"Skipping geometry due to extrusion error: {extrusion_error}\n")
            continue
    
    if not meshes:
        raise Exception("No buildings found.")
    
    scene = trimesh.Scene(meshes)
    stl_data = scene.export(file_type='stl')
    sys.stdout.buffer.write(stl_data)

except Exception as e:
    sys.stderr.write(f"ERROR {str(e)}\n")
    sys.exit(1)