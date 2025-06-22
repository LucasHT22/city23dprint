const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/generate-model', (req, res) => {
    const geojson = req.body.geojson;
    
    if (!geojson) return res.status(400).json({ error: 'empty GeoJSON' });
    
    console.log("GEOJSON:", JSON.stringify(geojson, null, 2));
  
    const python = spawn('python', ['generate.py']);
    let stlBuffer = Buffer.alloc(0);
    let errorOutput = '';

    python.stdout.on('data', (data) => {
        stlBuffer = Buffer.concat([stlBuffer, data]);
    });

    python.stderr.on('data', (err) => {
        errorOutput += err.toString();
    });

    python.on('close', (code) => {
        if (code !== 0) {
            console.error('Python error: ', errorOutput);
            return res.status(500).send({
                error: 'Error generating STL1',
                details: errorOutput,
            });
        } 

        res.setHeader('Content-Type', 'application/sla');
        res.setHeader('Content-Disposition', 'inline; filename=model.stl');
        res.setHeader('Cache-Control', 'no-store');
        res.send(stlBuffer);
    });

    python.stdin.write(JSON.stringify(geojson));
    python.stdin.end();
});

app.listen(3001, () => console.log('Backend running http://localhost:3001'));