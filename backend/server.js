const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { error } = require('console');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/generate-model', (req, res) => {
    const geojson = req.body;
    
    if (!geojson || !geojson.features) return res.status(400).json({ error: 'Invalid or empty GeoJSON' });
    
    console.log("Received buildings:", geojson.features.length);
    
    const tempFile = path.join(__dirname, 'temp_buildings.json');
    fs.writeFileSync(tempFile, JSON.stringify(geojson));

    const python = spawn('python', ['generate.py']);
    let stlBuffer = Buffer.alloc(0);
    let errorOutput = '';

    python.stdout.on('data', (data) => {
        stlBuffer = Buffer.concat([stlBuffer, data]);
    });

    python.stderr.on('data', (err) => {
        errorOutput += err.toString();
        console.error('Python stderr:', err.toString())
    });

    python.on('close', (code) => {
        try {
            fs.unlinkSync(tempFile);
        } catch (e) {
            console.warn('Could not delete temp file', e.message);
        }
        if (code !== 0) {
            console.error('Error: ', code)
            console.error('Python error: ', errorOutput);
            return res.status(500).send({
                error: 'Error generating STL',
                details: errorOutput,
            });
        } 

        if (stlBuffer.length === 0) {
            return res.status(500).json({
                error: 'Empty STL file'
            });
        }

        res.setHeader('Content-Type', 'model/stl');
        res.setHeader('Content-Disposition', 'attachment; filename=buildings.stl');
        res.setHeader('Cache-Control', 'no-store');
        res.send(stlBuffer);

        python.on('error', (err) => {
            console.error('Failed to spawn process: ', err);
            res.status(500).json({
                error: 'Failed to start Python process',
                details: err.message
            });
        });
    });
});

app.listen(3001, () => console.log('Backend running http://localhost:3001'));