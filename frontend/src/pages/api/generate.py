import json
import os
import osmnx as ox
import trimesh
import geopandas as gpd
from shapely.geometry import shape
from io import BytesIO
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import warnings

warnings.filterwarnings("ignore")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_building_height(row):
    height = 15.0

    if hasattr(row, 'height') and row.height:
        try:
            height_str = str(row.height).replace('m', '').replace(' ', '')
            height = float(height_str)
            height = max(min(height, 300), 3)
        except Exception:
            pass
    elif hasattr(row, 'building:levels') and row['building:levels']:
        try:
            height = int(row['building:levels']) * 3.5
        except Exception:
            pass
    elif hasattr(row, 'building') and row.building:
        b = str(row.building).lower()
        if b in ['house', 'detached', 'residential']:
            height = 8.0
        elif b in ['apartments', 'commercial', 'retail']:
            height = 25.0
        elif b in ['office', 'tower']:
            height = 45.0
        elif b == 'skyscraper':
            height = 120.0
    return height

@app.post("/api/generate")
async def generate_model(request: Request):
    try:
        data = await request.json()

        if 'features' not in data or not data['features']:
            return Response(content="Invalid GeoJSON", status_code=400)

        gdf = gpd.GeoDataFrame.from_features(data["features"])
        if gdf.empty:
            return Response(content="Empty GeoDataFrame", status_code=400)

        if gdf.crs is None:
            gdf = gdf.set_crs('EPSG:4326')
        gdf = gdf.to_crs('EPSG:31983')

        meshes = []
        for idx, row in gdf.iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty or not geom.is_valid:
                continue
            height = get_building_height(row)

            try:
                if geom.geom_type == 'Polygon':
                    if len(geom.exterior.coords) > 100:
                        geom = geom.simplify(tolerance=1.0)
                    if geom.area > 10:
                        meshes.append(trimesh.creation.extrude_polygon(geom, height=height))
                elif geom.geom_type == 'MultiPolygon':
                    for poly in geom.geoms:
                        if poly.area < 10 or not poly.is_valid:
                            continue
                        if len(poly.exterior.coords) > 100:
                            poly = poly.simplify(tolerance=1.0)
                        meshes.append(trimesh.creation.extrude_polygon(poly, height=height))
            except Exception:
                continue

        if not meshes:
            return Response(content="No valid buildings", status_code=400)

        combined = trimesh.util.concatenate(meshes)
        bounds = combined.bounds
        center = (bounds[0] + bounds[1]) / 2
        combined.vertices -= center

        buffer = BytesIO()
        combined.export(buffer, file_type='stl')
        buffer.seek(0)

        return StreamingResponse(buffer, media_type="model/stl", headers={
            "Content-Disposition": "attachment; filename=buildings.stl"
        })

    except Exception as e:
        return Response(content=f"Internal error: {str(e)}", status_code=500)
