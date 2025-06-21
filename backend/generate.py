import json
import sys
import osmnx as ox
import shapely
import trimesh
import geopandas as gpd

try:
    data = json.load(sys.stdin)
    geometry = shapely.geometry.shape(data['geometry'])

    tags = {"building": True}
    buildings = ox.features_from_polygon(geometry, tags={'buildings': True})
    meshes = []

    for _, row in buildings.iterrows():
        geom = row.geometry
        if geom.geom_type == 'Polygon':
            base = trimesh.creation.extrude_polygon(geom, height=10)
            meshes.append(base)
        elif geom.geom_type == 'MultiPolygon':
            for poly in geom:
                base = trimesh.creation.extrude_polygon(poly, height=10)
                meshes.append(base)
    
    if not meshes:
        raise Exception("No buildings found.")
    
    scene = trimesh.Scene(meshes)
    stl_data = scene.dump().export(file_type='stl')
    sys.stdout.buffer.write(stl_data)

except Exception as e:
    sys.stderr.write(f"ERROR {str(e)}\n")
    sys.exit(1)