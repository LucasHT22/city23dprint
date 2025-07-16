const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/generate-model', async (req, res) => {
    const geojson = req.body;
  if (!geojson || !geojson.features) {
    return res.status(400).json({ error: 'Invalid or empty GeoJSON' });
  }

  const python = spawn('python', ['generate.py']);

  let errorLog = '';
  let chunks = [];

  python.stderr.on('data', (chunk) => {
    errorLog += chunk.toString();
  });

  python.stdout.on('data', (chunk) => {
    chunks.push(chunk);
  });

  python.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'Python process failed', details: errorLog });
    }

    const buffer = Buffer.concat(chunks);
    if (!buffer.length) {
      return res.status(500).json({ error: 'Empty STL output' });
    }

    res.setHeader('Content-Type', 'model/stl');
    res.setHeader('Content-Disposition', 'attachment; filename=buildings.stl');
    res.send(buffer);
  });

  python.stdin.write(JSON.stringify(geojson));
  python.stdin.end();
});

app.listen(3001, () => {
    console.log('Server listening at http://localhost:3001');
    console.log('Press Ctrl+C to quit.');
});