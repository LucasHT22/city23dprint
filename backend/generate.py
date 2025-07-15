import json
import sys
import osmnx as ox
import trimesh
import geopandas as gpd
from shapely.geometry import shape
import warnings

warnings.filterwarnings('ignore')


def get_building_height(row):
    height = 15.0

    if hasattr(row, 'height') and row.height:
        try:
            height_str = str(row.height).replace('m', '').replace(' ', '')
            height = float(height_str)
            if height > 300:
                height = 300
            elif height < 3:
                height = 3
        except (ValueError, TypeError):
            pass

    elif hasattr(row, 'building:levels') and row['building:levels']:
        try:
            levels = int(row['building:levels'])
            height = levels * 3.5
        except (ValueError, TypeError):
            pass

    elif hasattr(row, 'building') and row.building:
        building_type = str(row.building).lower()
        if building_type in ['house', 'detached', 'residential']:
            height = 8.0
        elif building_type in ['apartments', 'commercial', 'retail']:
            height = 25.0
        elif building_type in ['office', 'tower']:
            height = 45.0
        elif building_type == 'skyscraper':
            height = 120.0

    return height


def main():
    try:
        if len(sys.argv) > 1:
            with open(sys.argv[1], 'r') as f:
                data = json.load(f)
        else:
            data = json.load(sys.stdin)

        if 'features' not in data or not data['features']:
            raise Exception("No features in GeoJSON")

        print(f"Processing {len(data['features'])} buildings...")

        gdf = gpd.GeoDataFrame.from_features(data["features"])

        if gdf.empty:
            raise Exception("Empty GeoDataFrame")

        if gdf.crs is None:
            gdf = gdf.set_crs('EPSG:4326')

        utm_crs = 'EPSG:31983'
        gdf_utm = gdf.to_crs(utm_crs)

        meshes = []
        processed_buildings = 0

        for idx, row in gdf_utm.iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty or not geom.is_valid:
                continue

            height = get_building_height(row)

            try:
                if geom.geom_type == 'Polygon':
                    if len(geom.exterior.coords) > 100:
                        geom = geom.simplify(tolerance=1.0)

                    if geom.area > 10:
                        base = trimesh.creation.extrude_polygon(geom, height=height)
                        print(f"Processing building {idx}: geom_type=Polygon, area={geom.area:.2f}, height={height}")
                        print(f" - Added Polygon mesh with volume {base.volume:.2f}")
                        meshes.append(base)
                        processed_buildings += 1

                elif geom.geom_type == 'MultiPolygon':
                    for poly in geom.geoms:
                        if not poly.is_valid or poly.area < 10:
                            continue
                        if len(poly.exterior.coords) > 100:
                            poly = poly.simplify(tolerance=1.0)
                        base = trimesh.creation.extrude_polygon(poly, height=height)
                        print(f"Processing building {idx}: geom_type=MultiPolygon part, area={poly.area:.2f}, height={height}")
                        print(f" - Added Polygon mesh with volume {base.volume:.2f}")
                        meshes.append(base)
                        processed_buildings += 1
            except Exception as extrusion_error:
                print(f"Skipping building {idx} due to extrusion error: {extrusion_error}")

        if not meshes:
            raise Exception("No valid buildings could be processed.")

        print(f"Successfully processed {processed_buildings} buildings")

        combined = trimesh.util.concatenate(meshes)

        bounds = combined.bounds
        center = (bounds[0] + bounds[1]) / 2
        combined.vertices -= center

        print(f"Watertight: {combined.is_watertight}")
        print(f"Vertices: {len(combined.vertices)}")
        print(f"Faces: {len(combined.faces)}")
        combined.export('buildings.obj')
        combined.export('buildings.3mf')
        combined.export('buildings.stl')
        print("Files successfully generated.")

    except Exception as e:
        import traceback
        print(f"ERROR: {str(e)}")
        traceback.print_exc()


if __name__ == "__main__":
    main()