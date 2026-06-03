const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PORT = 8443;
const KEY_FILE = path.join(__dirname, 'key.pem');
const CERT_FILE = path.join(__dirname, 'cert.pem');

// 1. Automatically generate self-signed certificates using system openssl if missing
function checkOrGenerateCertificates() {
  if (!fs.existsSync(KEY_FILE) || !fs.existsSync(CERT_FILE)) {
    console.log('SSL Certificates not found. Generating self-signed certificates using OpenSSL...');
    try {
      execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${KEY_FILE}" -out "${CERT_FILE}" -sha256 -days 365 -nodes -subj "/CN=localhost"`, { stdio: 'inherit' });
      console.log('Self-signed SSL certificates generated successfully.');
    } catch (error) {
      console.error('Failed to generate SSL certificates. Please install openssl and run the command manually:');
      console.error('openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -sha256 -days 365 -nodes -subj "/CN=localhost"');
      process.exit(1);
    }
  }
}

checkOrGenerateCertificates();

// 2. Map file extensions to mime-types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// 3. Create the server
const server = https.createServer({
  key: fs.readFileSync(KEY_FILE),
  cert: fs.readFileSync(CERT_FILE)
}, (req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  // Intercept AI analysis requests
  if (req.url.startsWith('/api/analyze') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        
        // Define prompt instructions for local Ollama model
        const prompt = `You are a road safety telemetry assistant. Analyze this road surface anomaly:
- Type: ${data.type}
- Peak vertical G-force shock: ${data.gForce} G (Note: normal gravity baseline is 1.0G; shocks over 2.5G are severe; bumps over 1.5G are moderate)
- Vehicle speed: ${data.speed} km/h

Determine the probability (0% to 100%) that this represents a major pothole or significant road hazard.
Format your output exactly as follows:
PROBABILITY: [X]%
REASON: [Short 1-sentence assessment]`;

        const ollamaResponse = await fetch('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'smollm:135m',
            prompt: prompt,
            stream: false,
            options: {
              temperature: 0.1,
              num_predict: 40
            }
          })
        });

        if (!ollamaResponse.ok) {
          throw new Error(`Ollama API error: ${ollamaResponse.status}`);
        }

        const json = await ollamaResponse.json();
        const text = json.response || '';
        
        // 1. Calculate a realistic probability based on physics/telemetry rules
        const gForceVal = parseFloat(data.gForce) || 1.0;
        const speedVal = parseFloat(data.speed) || 0;
        let calculatedProb = 10;
        
        if (data.type === 'pothole') {
          // Potholes: higher G-force means much higher hazard probability
          calculatedProb = Math.min(Math.round((gForceVal - 1.0) * 22 + (speedVal * 0.2)), 98);
        } else {
          // Speed bumps: designed to be driven over, so lower hazard probability
          calculatedProb = Math.min(Math.round((gForceVal - 1.0) * 12), 45);
        }
        calculatedProb = Math.max(calculatedProb, 5); // Minimum 5%
        const probability = `${calculatedProb}%`;

        // 2. Extract a clean, single-sentence reason from the LLM's response
        let reason = text.trim();
        // Remove code blocks, markdown asterisks and backticks
        reason = reason.replace(/```[a-z]*\n[\s\S]*?\n```/g, '')
                       .replace(/`+/g, '')
                       .replace(/\*+/g, '')
                       .replace(/PROBABILITY:.*(\n|$)/gi, '')
                       .replace(/REASON:.*(\n|$)/gi, '')
                       .replace(/System:.*(\n|$)/gi, '')
                       .replace(/User:.*(\n|$)/gi, '')
                       .replace(/Assistant:.*(\n|$)/gi, '')
                       .replace(/[\r\n]+/g, ' ')
                       .trim();

        // Regex to extract the first complete sentence
        const sentenceMatch = reason.match(/^[^.!?]+[.!?]/);
        if (sentenceMatch) {
          reason = sentenceMatch[0].trim();
        }
        
        // Limit length and add fallback
        if (reason.length > 120) {
          reason = reason.substring(0, 117) + '...';
        }
        if (!reason || reason.length < 10) {
          reason = `A ${data.type} detected with a vertical shock of ${data.gForce}G.`;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ probability, reason }));
      } catch (err) {
        console.error('Error generating AI analysis:', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'AI analysis failed: ' + err.message, probability: 'N/A', reason: 'Service unavailable' }));
      }
    });
    return;
  }
  
  // Resolve path, preventing directory traversal
  let filePath = req.url === '/' ? 'index.html' : req.url;
  filePath = path.join(__dirname, filePath.split('?')[0]);
  
  if (!filePath.startsWith(__dirname)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('404 Not Found');
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    
    // Disable caching for development
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// 4. Start the server and display IP address
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n======================================================');
  console.log(`RoadPulse HTTPS Development Server running!`);
  console.log(`Local Access: https://localhost:${PORT}`);
  console.log('======================================================');
  console.log('To access from your mobile phone, connect to the same');
  console.log('Wi-Fi network and open the following address:');
  
  // Retrieve and log local IP address
  const networkInterfaces = os.networkInterfaces();
  let foundIp = false;
  
  for (const interfaceName in networkInterfaces) {
    for (const iface of networkInterfaces[interfaceName]) {
      // Skip loopback and IPv6
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`Mobile Access: https://${iface.address}:${PORT}`);
        foundIp = true;
      }
    }
  }
  
  if (!foundIp) {
    console.log('Mobile Access: Check your computer\'s local IP address');
  }
  console.log('======================================================');
  console.log('Note: Since this uses a self-signed certificate, your');
  console.log('browser will show a warning. Click "Advanced" and');
  console.log('"Proceed to site" to bypass it.\n');
});
