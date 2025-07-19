# City23DPrint

This project allows you to select regions on an interactive map and generate corresponding 3D STL models of buildings using open data from OpenStreetMap, all without saving anything to disk. The STL is rendered live in the browser using in-memory processing.

## Features

- Select any area on the map via Leaflet
- Query buildings from OpenStreetMap (via Overpass API)
- Generate STL models from selected GeoJSON in real time
- Serverless architecture

## Run
```
yarn build
yarn add @turf/helpers @turf/boolean-valid
yarn add @jscad/modeling
yarn dev
```

---
Check my website devlucas.page :)