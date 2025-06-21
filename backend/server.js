const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const { error } = require('console');
const { stderr } = require('process');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/generate-model', (req, res) => {
    const { geojson } = req.body;
    fs.writeFileSync('backend/input.geojson', JSON.stringify(geojson));

    exec('python backend/generate_model.py', (error, stdout, stderr) => {
        if (error) {
            console.log(stderr);
            return res.status(500).json({ error: 'Error generating 3d model'})
        }
        res.download('backend/model.stl');
    });
});

app.listen(3001, () => console.log('Backend running http://localhost:3001'));