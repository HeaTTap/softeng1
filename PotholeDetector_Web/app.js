// RoadPulse - Anomaly Detection Engine

// State Management
const state = {
  // Sensor Configuration
  potholeThreshold: 2.8,
  bumpThreshold: 1.6,
  audioAlerts: true,
  
  // Real-time metrics
  currentG: 1.00,
  peakG: 0.00,
  speed: 0,
  latitude: null,
  longitude: null,
  eventsCount: 0,
  isRecording: false,
  
  // Sensor Buffers
  rollingBuffer: [], // size ~10 samples for peak-to-peak detection (200ms at 50Hz)
  chartBuffer: [],   // size ~150 samples for rendering
  maxBufferSize: 10,
  maxChartSize: 150,
  
  // Maps & Location
  map: null,
  userMarker: null,
  routeLine: null,
  routeCoords: [],
  markers: [],
  
  // Timers and Debounce
  lastTriggerTime: 0,
  debounceWindow: 1500, // ms between detections
  
  // Simulation State
  isSimulatingDrive: false,
  simInterval: null,
  simStep: 0,
  simCoords: [
    {lat: -6.2088, lng: 106.8456, speed: 30},
    {lat: -6.2092, lng: 106.8465, speed: 45},
    {lat: -6.2096, lng: 106.8474, speed: 40},
    {lat: -6.2100, lng: 106.8483, speed: 35}, // Speed bump here
    {lat: -6.2105, lng: 106.8492, speed: 48},
    {lat: -6.2110, lng: 106.8501, speed: 50},
    {lat: -6.2114, lng: 106.8510, speed: 45}, // Pothole here
    {lat: -6.2118, lng: 106.8518, speed: 42},
    {lat: -6.2122, lng: 106.8527, speed: 38},
    {lat: -6.2126, lng: 106.8536, speed: 20}
  ],
  
  // Audio Context for Sound Effects
  audioCtx: null
};

// Elements
const el = {
  gforce: document.getElementById('telemetry-gforce'),
  peakGforce: document.getElementById('telemetry-peak-gforce'),
  speed: document.getElementById('telemetry-speed'),
  eventsCount: document.getElementById('telemetry-events-count'),
  connectionStatus: document.getElementById('connection-status'),
  permissionOverlay: document.getElementById('sensor-permission-overlay'),
  enableSensorsBtn: document.getElementById('enable-sensors-btn'),
  dismissOverlayBtn: document.getElementById('dismiss-overlay-btn'),
  canvas: document.getElementById('sensor-chart'),
  sliderPothole: document.getElementById('slider-pothole-threshold'),
  valPothole: document.getElementById('val-pothole-threshold'),
  sliderBump: document.getElementById('slider-bump-threshold'),
  valBump: document.getElementById('val-bump-threshold'),
  toggleAudio: document.getElementById('toggle-audio-alerts'),
  logBody: document.getElementById('log-body'),
  gpsCoords: document.getElementById('gps-coords'),
  simSmoothBtn: document.getElementById('sim-smooth-btn'),
  simBumpBtn: document.getElementById('sim-bump-btn'),
  simPotholeBtn: document.getElementById('sim-pothole-btn'),
  simAutoDriveBtn: document.getElementById('sim-auto-drive-btn'),
  exportJsonBtn: document.getElementById('export-json-btn'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  clearLogBtn: document.getElementById('clear-log-btn'),
  tabs: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content')
};

// Canvas drawing context
let ctx = null;

// Initialize Web App
window.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  initMap();
  setupEventListeners();
  fillChartBufferWithBaseline();
  
  // Show permission overlay on mobile browsers
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (!isMobile) {
    // Hide overlay on desktop, default to simulated or ready mode
    el.permissionOverlay.classList.add('fade-out');
    updateStatus('ready', 'Simulator Ready');
  }
});

// Canvas Setup
function initCanvas() {
  ctx = el.canvas.getContext('2d');
  // Fit canvas to layout size
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const rect = el.canvas.parentElement.getBoundingClientRect();
  el.canvas.width = rect.width;
  el.canvas.height = rect.height;
  drawChart();
}

function fillChartBufferWithBaseline() {
  state.chartBuffer = Array(state.maxChartSize).fill(1.0);
}

// Leaflet Map Setup
function initMap() {
  // Default coordinate (Jakarta, Indonesia)
  const defaultLatLng = [-6.2088, 106.8456];
  
  state.map = L.map('leaflet-map', {
    zoomControl: false,
    attributionControl: false
  }).setView(defaultLatLng, 15);
  
  // Modern Dark Map tiles (CartoDB DarkMatter)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20
  }).addTo(state.map);
  
  // Add customized zoom control at the bottom right
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  
  // Polyline for track tracing
  state.routeLine = L.polyline([], {
    color: '#3b82f6',
    weight: 5,
    opacity: 0.8
  }).addTo(state.map);
  
  // Glowing User location marker
  const customUserIcon = L.divIcon({
    className: 'custom-user-marker',
    html: '<div class="user-marker-pulse"></div>',
    iconSize: [20, 20]
  });
  
  state.userMarker = L.marker(defaultLatLng, { icon: customUserIcon }).addTo(state.map);
}

// Setup Interaction Events
function setupEventListeners() {
  // Tab Switcher
  el.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.tabs.forEach(t => t.classList.remove('active'));
      el.tabContents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      const contentId = tab.getAttribute('data-tab');
      document.getElementById(contentId).classList.add('active');
    });
  });

  // Setup permission trigger
  el.enableSensorsBtn.addEventListener('click', initializeSensors);
  el.dismissOverlayBtn.addEventListener('click', () => {
    el.permissionOverlay.classList.add('fade-out');
    initAudioContext();
    updateStatus('ready', 'Simulator Ready');
  });

  // Calibration Controls
  el.sliderPothole.addEventListener('input', (e) => {
    state.potholeThreshold = parseFloat(e.target.value);
    el.valPothole.textContent = `${state.potholeThreshold.toFixed(1)} G`;
  });
  
  el.sliderBump.addEventListener('input', (e) => {
    state.bumpThreshold = parseFloat(e.target.value);
    el.valBump.textContent = `${state.bumpThreshold.toFixed(2)} G`;
  });

  el.toggleAudio.addEventListener('change', (e) => {
    state.audioAlerts = e.target.checked;
  });

  // Simulation buttons
  el.simSmoothBtn.addEventListener('click', () => injectSignature('smooth'));
  el.simBumpBtn.addEventListener('click', () => injectSignature('bump'));
  el.simPotholeBtn.addEventListener('click', () => injectSignature('pothole'));
  
  el.simAutoDriveBtn.addEventListener('click', toggleAutoDrive);

  // Exporters
  el.exportJsonBtn.addEventListener('click', exportDataJSON);
  el.exportCsvBtn.addEventListener('click', exportDataCSV);
  el.clearLogBtn.addEventListener('click', clearLog);
}

// Web Audio API Synth initialization
function initAudioContext() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// Play custom sound effects using synth oscillator
function playDetectionSound(type) {
  if (!state.audioAlerts) return;
  initAudioContext();
  
  const ctx = state.audioCtx;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  
  const now = ctx.currentTime;
  
  if (type === 'pothole') {
    // Sharp high pitch to low frequency siren
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.3);
    
    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    
    osc.start(now);
    osc.stop(now + 0.35);
    
    // Voice speech alert
    speakMessage('Pothole!');
  } else if (type === 'speed-bump') {
    // Soft double pulse tone
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(250, now);
    osc.frequency.setValueAtTime(320, now + 0.1);
    
    gainNode.gain.setValueAtTime(0.15, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    
    osc.start(now);
    osc.stop(now + 0.25);
    
    // Voice speech alert
    speakMessage('Speed bump.');
  }
}

function speakMessage(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.volume = 0.8;
    window.speechSynthesis.speak(utterance);
  }
}

// Initialize Mobile Web Sensors
async function initializeSensors() {
  initAudioContext();
  el.permissionOverlay.classList.add('fade-out');
  updateStatus('warning', 'Connecting Sensors...');
  
  let motionPermission = true;
  
  // Request DeviceMotion permissions on iOS 13+ devices
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const response = await DeviceMotionEvent.requestPermission();
      motionPermission = (response === 'granted');
    } catch (e) {
      console.warn("DeviceMotion permission error:", e);
      motionPermission = false;
    }
  }

  if (motionPermission) {
    window.addEventListener('devicemotion', handleDeviceMotion, true);
    updateStatus('success', 'Sensors Connected');
    state.isRecording = true;
  } else {
    updateStatus('danger', 'Motion Blocked');
    alert("Motion sensors were blocked. Switching to simulator mode.");
  }
  
  // Request GPS Geolocation
  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
      handleGPSPosition,
      (err) => {
        console.warn(`Geolocation error: ${err.message}`);
        el.gpsCoords.textContent = "GPS Unavailable";
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );
  } else {
    el.gpsCoords.textContent = "GPS Not Supported";
  }
}

// Handle real-time accelerometer events
function handleDeviceMotion(event) {
  let acc = event.accelerationIncludingGravity;
  if (!acc) return;
  
  // Fallback to acceleration without gravity if available
  if (event.acceleration && event.acceleration.x !== null) {
    acc = event.acceleration;
  }
  
  // Compute total acceleration magnitude in Gs
  const x = acc.x || 0;
  const y = acc.y || 0;
  const z = acc.z || 0;
  
  // Magnitude calculation: sqrt(x^2 + y^2 + z^2)
  const totalAcc = Math.sqrt(x*x + y*y + z*z);
  
  // If we used acceleration including gravity, base G-force is ~9.81m/s2. If not, baseline is 0.
  // We divide by 9.81 to express in G-force units (e.g. 1G normal gravity).
  let gForce = totalAcc / 9.81;
  
  // If baseline is 0 (acceleration without gravity), add 1G to match expected baseline scale.
  if (event.acceleration && event.acceleration.x !== null) {
    gForce += 1.0;
  }

  processSensorReading(gForce);
}

// GPS positioning handler
function handleGPSPosition(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  const speed = position.coords.speed ? Math.round(position.coords.speed * 3.6) : 0; // m/s to km/h
  
  state.latitude = lat;
  state.longitude = lng;
  state.speed = speed;
  
  el.speed.innerHTML = `${speed} <span class="unit">km/h</span>`;
  el.gpsCoords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  
  const latLng = [lat, lng];
  
  // Move marker and map view
  if (state.map) {
    state.userMarker.setLatLng(latLng);
    state.map.setView(latLng);
    
    // Draw route line
    state.routeCoords.push(latLng);
    state.routeLine.setLatLngs(state.routeCoords);
  }
}

// Core sensor algorithm pipeline
function processSensorReading(gForce) {
  state.currentG = gForce;
  el.gforce.innerHTML = `${gForce.toFixed(2)} <span class="unit">G</span>`;
  
  // Feed chart buffers
  state.chartBuffer.push(gForce);
  if (state.chartBuffer.length > state.maxChartSize) {
    state.chartBuffer.shift();
  }
  
  state.rollingBuffer.push(gForce);
  if (state.rollingBuffer.length > state.maxBufferSize) {
    state.rollingBuffer.shift();
  }
  
  // Draw frame
  requestAnimationFrame(drawChart);
  
  // Main detection processor
  evaluateAnomalies();
}

// Anomaly Detection Algorithm
function evaluateAnomalies() {
  const now = Date.now();
  if (now - state.lastTriggerTime < state.debounceWindow) return; // Debounce window active
  
  if (state.rollingBuffer.length < state.maxBufferSize) return;
  
  // Compute Peak-to-Peak in the current rolling window (e.g. last 10 samples)
  const max = Math.max(...state.rollingBuffer);
  const min = Math.min(...state.rollingBuffer);
  const peakToPeak = max - min;
  
  // Update Peak shock telemetry
  if (peakToPeak > state.peakG) {
    state.peakG = peakToPeak;
    el.peakGforce.innerHTML = `${state.peakG.toFixed(2)} <span class="unit">G</span>`;
    
    if (state.peakG > state.potholeThreshold) {
      el.peakGforce.className = 'telemetry-value text-danger';
    } else if (state.peakG > state.bumpThreshold) {
      el.peakGforce.className = 'telemetry-value text-warning';
    } else {
      el.peakGforce.className = 'telemetry-value text-safe';
    }
  }

  // 1. Pothole signature check: sudden high frequency vertical shock (Peak-to-Peak spikes over threshold)
  if (peakToPeak >= state.potholeThreshold) {
    triggerAnomaly('pothole', peakToPeak);
  }
  // 2. Speed Bump signature check: moderate peak deviation
  else if (peakToPeak >= state.bumpThreshold) {
    // Confirm it's not a tiny wobble by checking the maximum amplitude is above threshold
    triggerAnomaly('speed-bump', peakToPeak);
  }
}

// Action when anomaly is triggered
function triggerAnomaly(type, intensity) {
  state.lastTriggerTime = Date.now();
  state.eventsCount++;
  el.eventsCount.textContent = state.eventsCount;
  
  // Visual Alert triggers
  flashScreen(type);
  playDetectionSound(type);
  
  // Coordinates (fallback to simulation center if offline)
  const lat = state.latitude || -6.2088;
  const lng = state.longitude || 106.8456;
  
  const anomalyEvent = {
    id: Date.now(),
    time: new Date().toLocaleTimeString(),
    type: type,
    gForce: intensity.toFixed(2),
    speed: state.speed,
    lat: lat.toFixed(5),
    lng: lng.toFixed(5),
    aiProbability: null,
    aiReason: null
  };
  
  state.logList.unshift(anomalyEvent);
  updateHistoryTable();
  
  // Asynchronously request AI assessment from the local backend proxy
  analyzeAnomalyWithAI(anomalyEvent);
  
  // Pin Map
  dropMapMarker(type, [lat, lng], intensity);
}

// Asynchronous call to proxy endpoint for AI analysis
async function analyzeAnomalyWithAI(event) {
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: event.type,
        gForce: event.gForce,
        speed: event.speed
      })
    });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Update local state event record
    event.aiProbability = data.probability || 'N/A';
    event.aiReason = data.reason || 'No assessment';
    
    // Update UI directly to avoid redrawing full table
    const cellEl = document.getElementById(`ai-col-${event.id}`);
    if (cellEl) {
      let badgeColorClass = 'ai-badge-low';
      const numVal = parseInt(data.probability);
      if (!isNaN(numVal)) {
        if (numVal >= 70) badgeColorClass = 'ai-badge-high';
        else if (numVal >= 40) badgeColorClass = 'ai-badge-medium';
      }
      
      cellEl.innerHTML = `
        <div class="ai-analysis-cell">
          <span class="ai-badge ${badgeColorClass}">${data.probability}</span>
          <span class="ai-reason" title="${data.reason}">${data.reason}</span>
        </div>
      `;
    }
  } catch (err) {
    console.error('AI analysis error:', err);
    event.aiProbability = 'Error';
    event.aiReason = 'Could not generate analysis.';
    
    const cellEl = document.getElementById(`ai-col-${event.id}`);
    if (cellEl) {
      cellEl.innerHTML = `
        <div class="ai-analysis-cell">
          <span class="ai-badge ai-badge-error">Error</span>
          <span class="ai-reason">Ollama connection failed</span>
        </div>
      `;
    }
  }
}

function flashScreen(type) {
  const flashClass = type === 'pothole' ? 'flash-danger' : 'flash-warning';
  document.body.classList.remove('flash-danger', 'flash-warning');
  // Trigger reflow
  void document.body.offsetWidth;
  document.body.classList.add(flashClass);
}

// Add markers on leaflet map
function dropMapMarker(type, latLng, intensity) {
  if (!state.map) return;
  
  const markerClass = type === 'pothole' ? 'marker-pothole' : 'marker-bump';
  const color = type === 'pothole' ? '#f43f5e' : '#f59e0b';
  
  // Circle Marker with Pulse Ripple effect
  const circleMarker = L.circleMarker(latLng, {
    radius: 10,
    fillColor: color,
    color: '#fff',
    weight: 2,
    opacity: 0.9,
    fillOpacity: 0.85
  }).addTo(state.map);
  
  const label = type === 'pothole' ? '🚨 Pothole' : '⚡ Speed Bump';
  circleMarker.bindPopup(`
    <div style="font-family: var(--font-sans); color: #fff; background: #030712; padding: 6px;">
      <b style="color: ${color};">${label}</b><br/>
      Peak: <b>${intensity.toFixed(2)} G</b><br/>
      Speed: <b>${state.speed} km/h</b>
    </div>
  `);
  
  state.markers.push(circleMarker);
}

// Update History Table UI
state.logList = [];
function updateHistoryTable() {
  if (state.logList.length === 0) {
    el.logBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">No road anomalies detected yet. Move device or start simulation.</td>
      </tr>
    `;
    return;
  }
  
  el.logBody.innerHTML = state.logList.map(item => {
    const badgeClass = item.type === 'pothole' ? 'pothole' : 'speed-bump';
    const typeLabel = item.type === 'pothole' ? 'Pothole' : 'Speed Bump';
    
    let aiContent = '';
    if (item.aiProbability) {
      let badgeColorClass = 'ai-badge-low';
      const numVal = parseInt(item.aiProbability);
      if (!isNaN(numVal)) {
        if (numVal >= 70) badgeColorClass = 'ai-badge-high';
        else if (numVal >= 40) badgeColorClass = 'ai-badge-medium';
      } else if (item.aiProbability === 'Error' || item.aiProbability === 'N/A') {
        badgeColorClass = 'ai-badge-error';
      }
      
      aiContent = `
        <div class="ai-analysis-cell">
          <span class="ai-badge ${badgeColorClass}">${item.aiProbability}</span>
          <span class="ai-reason" title="${item.aiReason}">${item.aiReason}</span>
        </div>
      `;
    } else {
      aiContent = `
        <div class="ai-analyzing">
          🤖 Analyzing...
        </div>
      `;
    }

    return `
      <tr id="log-row-${item.id}">
        <td>${item.time}</td>
        <td><span class="badge-anomaly ${badgeClass}">${typeLabel}</span></td>
        <td><b>${item.gForce} G</b></td>
        <td>${item.speed} km/h</td>
        <td>
          <button class="btn btn-text" onclick="panToCoords(${item.lat}, ${item.lng})">
            📍 ${item.lat}, ${item.lng}
          </button>
        </td>
        <td id="ai-col-${item.id}">
          ${aiContent}
        </td>
      </tr>
    `;
  }).join('');
}

// Expose map panning globally
window.panToCoords = function(lat, lng) {
  if (state.map) {
    state.map.setView([lat, lng], 18);
  }
};

// Canvas drawing functions (realtime graph plotting)
function drawChart() {
  if (!ctx) return;
  
  const width = el.canvas.width;
  const height = el.canvas.height;
  
  ctx.clearRect(0, 0, width, height);
  
  // Grid Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  const gridRows = 4;
  for (let i = 0; i <= gridRows; i++) {
    const y = (height / gridRows) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  
  // Baseline (1.0 G)
  const baselineY = height - (1.0 / 4.0) * height; // Max height shows 4.0G
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(0, baselineY);
  ctx.lineTo(width, baselineY);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Draw threshold lines
  // Speed Bump Threshold
  const bumpY = height - (state.bumpThreshold / 4.0) * height;
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(0, bumpY);
  ctx.lineTo(width, bumpY);
  ctx.stroke();
  ctx.fillStyle = 'rgba(245, 158, 11, 0.5)';
  ctx.font = '10px monospace';
  ctx.fillText(`Bump limit (${state.bumpThreshold}G)`, 10, bumpY - 4);
  
  // Pothole Threshold
  const potholeY = height - (state.potholeThreshold / 4.0) * height;
  ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(0, potholeY);
  ctx.lineTo(width, potholeY);
  ctx.stroke();
  ctx.fillStyle = 'rgba(244, 63, 94, 0.5)';
  ctx.fillText(`Pothole limit (${state.potholeThreshold}G)`, 10, potholeY - 4);
  ctx.setLineDash([]);
  
  // Plot Accelerometer values
  if (state.chartBuffer.length < 2) return;
  
  ctx.beginPath();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#3b82f6';
  
  const step = width / (state.maxChartSize - 1);
  
  for (let i = 0; i < state.chartBuffer.length; i++) {
    // Map value (0.0G to 4.0G) to screen canvas height
    const valVal = Math.min(state.chartBuffer[i], 4.0);
    const x = i * step;
    const y = height - (valVal / 4.0) * height;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

// Indicator status updates
function updateStatus(status, text) {
  el.connectionStatus.className = `status-indicator ${status}`;
  el.connectionStatus.querySelector('.status-text').textContent = text;
}

// Injects an isolated bump signature for testing
let isInjecting = false;
function injectSignature(type) {
  if (isInjecting) return;
  isInjecting = true;
  
  let frame = 0;
  let signature = [];
  
  if (type === 'smooth') {
    // Just tiny vibration noise
    signature = Array(20).fill(0).map(() => 1.0 + (Math.random() * 0.15 - 0.07));
  } else if (type === 'bump') {
    // Smooth peak: rising to 1.7G and returning to 1G
    const totalFrames = 25;
    for (let i = 0; i < totalFrames; i++) {
      const angle = (i / totalFrames) * Math.PI;
      const amplitude = Math.sin(angle) * 0.75;
      const noise = Math.random() * 0.1 - 0.05;
      signature.push(1.0 + amplitude + noise);
    }
  } else if (type === 'pothole') {
    // Sudden dip (free-fall) then massive recovery peak
    signature = [
      1.0, 0.95, 0.9, 0.7, 0.4, // Falling in
      0.9, 1.8, 3.2, 2.5, 1.4, // Hitting the rim
      0.8, 1.1, 0.95, 1.0      // Normalizing
    ];
  }
  
  // Inject into process loop framing
  const timer = setInterval(() => {
    if (frame >= signature.length) {
      clearInterval(timer);
      isInjecting = false;
    } else {
      processSensorReading(signature[frame]);
      frame++;
    }
  }, 20); // 50Hz sample emulation
}

// Continuous Automated Drive Simulator
function toggleAutoDrive() {
  if (state.isSimulatingDrive) {
    // Stop simulation
    clearInterval(state.simInterval);
    state.isSimulatingDrive = false;
    el.simAutoDriveBtn.textContent = "Start Automated Simulated Drive";
    el.simAutoDriveBtn.className = "btn btn-primary w-full";
    updateStatus('ready', 'Simulator Ready');
    state.speed = 0;
    el.speed.innerHTML = `0 <span class="unit">km/h</span>`;
  } else {
    // Start simulation
    state.isSimulatingDrive = true;
    state.simStep = 0;
    state.routeCoords = [];
    state.routeLine.setLatLngs([]);
    
    // Clear markers
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];
    
    el.simAutoDriveBtn.textContent = "⏹ Stop Simulated Drive";
    el.simAutoDriveBtn.className = "btn btn-danger w-full";
    updateStatus('success', 'Simulating Drive...');
    
    // Position at starting coordinate
    const startPt = state.simCoords[0];
    state.latitude = startPt.lat;
    state.longitude = startPt.lng;
    state.speed = startPt.speed;
    
    const latLng = [startPt.lat, startPt.lng];
    state.userMarker.setLatLng(latLng);
    state.map.setView(latLng, 16);
    
    state.routeCoords.push(latLng);
    
    // Drive execution loop: updates location every 2.5s, feeds sensors constantly
    let innerFrame = 0;
    state.simInterval = setInterval(() => {
      // Accelerometer noise simulation
      let g = 1.0 + (Math.random() * 0.12 - 0.06);
      
      // Inject anomalies at specific path steps
      if (innerFrame === 45) {
        // Step 4: Speed bump
        injectSignature('bump');
      } else if (innerFrame === 95) {
        // Step 8: Pothole
        injectSignature('pothole');
      } else {
        processSensorReading(g);
      }
      
      // Move coordinates every 50 frames (approx 1 second)
      if (innerFrame > 0 && innerFrame % 50 === 0) {
        state.simStep++;
        if (state.simStep >= state.simCoords.length) {
          // Loop drive simulation
          state.simStep = 0;
          state.routeCoords = [];
          state.routeLine.setLatLngs([]);
        }
        
        const pt = state.simCoords[state.simStep];
        state.latitude = pt.lat;
        state.longitude = pt.lng;
        state.speed = pt.speed;
        
        el.speed.innerHTML = `${pt.speed} <span class="unit">km/h</span>`;
        el.gpsCoords.textContent = `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`;
        
        const currentLatLng = [pt.lat, pt.lng];
        state.userMarker.setLatLng(currentLatLng);
        state.map.panTo(currentLatLng);
        
        state.routeCoords.push(currentLatLng);
        state.routeLine.setLatLngs(state.routeCoords);
      }
      
      innerFrame++;
    }, 20); // 50Hz updates
  }
}

// History Operations
function clearLog() {
  if (confirm("Are you sure you want to clear the detection log?")) {
    state.logList = [];
    state.eventsCount = 0;
    state.peakG = 0;
    el.eventsCount.textContent = 0;
    el.peakGforce.innerHTML = `0.00 <span class="unit">G</span>`;
    el.peakGforce.className = 'telemetry-value text-safe';
    
    // Remove markers
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];
    
    updateHistoryTable();
  }
}

// Data Export Utilities
function exportDataJSON() {
  if (state.logList.length === 0) return alert("No logs to export!");
  
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.logList, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `roadpulse_anomalies_${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function exportDataCSV() {
  if (state.logList.length === 0) return alert("No logs to export!");
  
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Time,Type,GForce,Speed,Latitude,Longitude\n";
  
  state.logList.forEach(item => {
    csvContent += `"${item.time}","${item.type}","${item.gForce}","${item.speed}","${item.lat}","${item.lng}"\n`;
  });
  
  const encodedUri = encodeURI(csvContent);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", encodedUri);
  downloadAnchor.setAttribute("download", `roadpulse_anomalies_${Date.now()}.csv`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}
