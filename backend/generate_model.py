import json
import osmnx as ox
import shapely
import trimesh

with open('backend/input.geojson', 'r') as f:
    data = json.load(f)

geometry = shapely.geometry.shape(data['geometry'])
buildings = ox.geometries_from_polygon(geometry, tags={'building': True})
meshes = []

for _, row in buildings.iterrows():
    geom = row.geometry
    if geom.geom_type == 'Polygon':
        base = trimesh.creation.extrude_polygon(geom, height=10)
        meshes.append(base)
    elif geom.geom_type == 'MultiaPolygon':
        for poly in geom:
            base = trimesh.creation.extrude_polygon(poly, height=10)
            meshes.append(base)

scene = trimesh.Scene(meshes)
scene.dump().export('backend/model.stl')