package com.pothole.detector

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.pothole.detector.db.PotholeDatabase
import com.pothole.detector.db.PotholeEntity
import com.pothole.detector.sensor.PotholeDetectorService
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {

    private var detectorService: PotholeDetectorService? = null
    private var isBound = false

    // State states to display in compose
    private val sensorHistory = mutableStateListOf<Float>()
    private val maxHistorySize = 100

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as PotholeDetectorService.LocalBinder
            detectorService = binder.getService()
            isBound = true
            
            // Connect scope listeners to flows
            lifecycleScopeLaunch()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            detectorService = null
            isBound = false
        }
    }

    private fun lifecycleScopeLaunch() {
        val service = detectorService ?: return
        
        // Listen to sensor flow
        lifecycleScope.launch {
            service.sensorFlow.collectLatest { gForce ->
                sensorHistory.add(gForce.toFloat())
                if (sensorHistory.size > maxHistorySize) {
                    sensorHistory.removeAt(0)
                }
            }
        }
    }

    // Coroutine scope launcher helper
    private val lifecycleScope by lazy {
        (application as Context).let { CoroutinesScopeProvider.scope }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        checkAndRequestPermissions()
        startAndBindService()
        
        setContent {
            RoadPulseTheme {
                MainDashboardScreen(
                    detectorService = detectorService,
                    sensorHistory = sensorHistory,
                    db = PotholeDatabase.getDatabase(this)
                )
            }
        }
    }

    private fun startAndBindService() {
        val intent = Intent(this, PotholeDetectorService::class.java)
        startService(intent)
        bindService(intent, connection, Context.BIND_AUTO_CREATE)
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        
        val missingPermissions = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        
        if (missingPermissions.isNotEmpty()) {
            val launcher = registerForActivityResult(
                ActivityResultContracts.RequestMultiplePermissions()
            ) { result ->
                // Reload UI or bind services accordingly
            }
            launcher.launch(missingPermissions.toTypedArray())
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isBound) {
            unbindService(connection)
            isBound = false
        }
    }
}

// Global Coroutine Helper
object CoroutinesScopeProvider {
    val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main + kotlinx.coroutines.Job())
}

// Main Dashboard Composables
@Composable
fun MainDashboardScreen(
    detectorService: PotholeDetectorService?,
    sensorHistory: List<Float>,
    db: PotholeDatabase
) {
    val scope = rememberCoroutineScope()
    val dao = remember { db.potholeDao() }
    
    // UI reactive states
    var currentG by remember { mutableStateOf(1.00f) }
    var peakG by remember { mutableStateOf(0.00f) }
    var speed by remember { mutableStateOf(0) }
    var gpsCoords by remember { mutableStateOf("Waiting for GPS...") }
    var isAudioEnabled by remember { mutableStateOf(true) }
    
    var potholeThreshold by remember { mutableStateOf(2.8f) }
    var bumpThreshold by remember { mutableStateOf(1.6f) }
    
    val anomaliesFlow = dao.getAllAnomalies().collectAsState(initial = emptyList())

    // Update threshold references inside service on change
    LaunchedEffect(potholeThreshold, bumpThreshold, isAudioEnabled) {
        detectorService?.let {
            it.potholeThreshold = potholeThreshold.toDouble()
            it.bumpThreshold = bumpThreshold.toDouble()
            it.isAudioEnabled = isAudioEnabled
        }
    }

    // Flow Collectors from Foreground Service
    LaunchedEffect(detectorService) {
        detectorService?.let { service ->
            potholeThreshold = service.potholeThreshold.toFloat()
            bumpThreshold = service.bumpThreshold.toFloat()
            isAudioEnabled = service.isAudioEnabled
            
            launch {
                service.sensorFlow.collectLatest { gForce ->
                    currentG = gForce.toFloat()
                    val diff = kotlin.math.abs(gForce - 1.0f).toFloat()
                    if (diff > peakG) {
                        peakG = diff
                    }
                }
            }
            launch {
                service.speedFlow.collectLatest { s -> speed = s }
            }
            launch {
                service.locationFlow.collectLatest { loc ->
                    gpsCoords = "${String.format(Locale.US, "%.5f", loc.latitude)}, ${String.format(Locale.US, "%.5f", loc.longitude)}"
                }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF030712))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // App Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "RoadPulse",
                    fontSize = 24.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = Color.White,
                    fontFamily = FontFamily.SansSerif
                )
                Text(
                    text = "Android Native Sensor Node",
                    fontSize = 12.sp,
                    color = Color(0xFF9CA3AF)
                )
            }
            
            val statusColor by animateColorAsState(
                targetValue = if (detectorService != null) Color(0xFF10B981) else Color(0xFFF43F5E),
                label = "status_glow"
            )
            
            Box(
                modifier = Modifier
                    .background(Color(0xFF0B0F19), RoundedCornerShape(20.dp))
                    .padding(horizontal = 14.dp, vertical = 6.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(modifier = Modifier.size(8.dp).background(statusColor, RoundedCornerShape(50)))
                    Text(
                        text = if (detectorService != null) "Sensors Active" else "Disconnected",
                        color = Color(0xFF9CA3AF),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        // Telemetry grid row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            TelemetryCard(
                label = "Current G",
                value = String.format(Locale.US, "%.2f", currentG),
                unit = "G",
                modifier = Modifier.weight(1f)
            )
            TelemetryCard(
                label = "Peak Shock",
                value = String.format(Locale.US, "%.2f", peakG),
                unit = "G",
                valueColor = if (peakG > potholeThreshold) Color(0xFFF43F5E) else if (peakG > bumpThreshold) Color(0xFFF59E0B) else Color(0xFF10B981),
                modifier = Modifier.weight(1f)
            )
            TelemetryCard(
                label = "Speed",
                value = speed.toString(),
                unit = "km/h",
                modifier = Modifier.weight(1f)
            )
            TelemetryCard(
                label = "Total Events",
                value = anomaliesFlow.value.size.toString(),
                unit = "",
                valueColor = Color(0xFF3B82F6),
                modifier = Modifier.weight(1f)
            )
        }

        // Canvas Graph View
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0B0F19)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "LIVE ACCELEROMETER ACCELERATION",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF9CA3AF)
                )
                Spacer(modifier = Modifier.height(12.dp))
                
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val w = size.width
                    val h = size.height
                    
                    // Draw horizontal grids
                    for (i in 1..3) {
                        val gridY = (h / 4) * i
                        drawLine(
                            color = Color(0xFF1F2937),
                            start = Offset(0f, gridY),
                            end = Offset(w, gridY),
                            strokeWidth = 1f
                        )
                    }

                    // Base gravity line (1.0G)
                    val baselineY = h - (1.0f / 4.0f) * h
                    drawLine(
                        color = Color(0xFF374151),
                        start = Offset(0f, baselineY),
                        end = Offset(w, baselineY),
                        strokeWidth = 2f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 10f))
                    )

                    // Draw thresholds on Canvas
                    val pThresholdY = h - (potholeThreshold / 4.0f) * h
                    drawLine(
                        color = Color(0x66F43F5E),
                        start = Offset(0f, pThresholdY),
                        end = Offset(w, pThresholdY),
                        strokeWidth = 2f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 10f))
                    )
                    
                    val bThresholdY = h - (bumpThreshold / 4.0f) * h
                    drawLine(
                        color = Color(0x66F59E0B),
                        start = Offset(0f, bThresholdY),
                        end = Offset(w, bThresholdY),
                        strokeWidth = 2f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 10f))
                    )

                    // Plot sensor data path
                    if (sensorHistory.size >= 2) {
                        val stepX = w / (maxHistorySize - 1)
                        for (i in 0 until sensorHistory.size - 1) {
                            val x1 = i * stepX
                            val y1 = h - (kotlin.math.min(sensorHistory[i], 4.0f) / 4.0f) * h
                            val x2 = (i + 1) * stepX
                            val y2 = h - (kotlin.math.min(sensorHistory[i + 1], 4.0f) / 4.0f) * h
                            
                            drawLine(
                                color = Color(0xFF3B82F6),
                                start = Offset(x1, y1),
                                end = Offset(x2, y2),
                                strokeWidth = 4f
                            )
                        }
                    }
                }
            }
        }

        // Calibration Control Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0B0F19)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "SENSOR CALIBRATION",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF9CA3AF)
                )

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Voice Alerts", modifier = Modifier.weight(1f), color = Color.White, fontSize = 13.sp)
                    Switch(
                        checked = isAudioEnabled,
                        onCheckedChange = { isAudioEnabled = it },
                        colors = SwitchDefaults.colors(checkedThumbColor = Color(0xFF3B82F6))
                    )
                }

                Column {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Pothole Shock", color = Color.White, fontSize = 13.sp)
                        Text("${String.format(Locale.US, "%.1f", potholeThreshold)} G", color = Color(0xFF3B82F6), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                    Slider(
                        value = potholeThreshold,
                        onValueChange = { potholeThreshold = it },
                        valueRange = 1.5f..5.0f,
                        colors = SliderDefaults.colors(thumbColor = Color(0xFF3B82F6), activeTrackColor = Color(0xFF3B82F6))
                    )
                }

                Column {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Speed Bump Limit", color = Color.White, fontSize = 13.sp)
                        Text("${String.format(Locale.US, "%.2f", bumpThreshold)} G", color = Color(0xFF3B82F6), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                    Slider(
                        value = bumpThreshold,
                        onValueChange = { bumpThreshold = it },
                        valueRange = 1.1f..2.5f,
                        colors = SliderDefaults.colors(thumbColor = Color(0xFF3B82F6), activeTrackColor = Color(0xFF3B82F6))
                    )
                }
            }
        }

        // Database Logs Card
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0B0F19)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "DETECTED ANOMALIES",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF9CA3AF)
                    )
                    Text(
                        text = "Clear All",
                        fontSize = 11.sp,
                        color = Color(0xFFF43F5E),
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable {
                            scope.launch { dao.clearAllAnomalies() }
                        }
                    )
                }
                
                Spacer(modifier = Modifier.height(12.dp))
                
                if (anomaliesFlow.value.isEmpty()) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("No events recorded. Go drive!", color = Color(0xFF4B5563), fontSize = 13.sp)
                    }
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxSize()
                    ) {
                        items(anomaliesFlow.value) { anomaly ->
                            AnomalyRow(anomaly = anomaly, context = db.potholeDao().toString() /* just passing context placeholder */)
                        }
                    }
                }
            }
        }
        
        Text(
            text = "GPS: $gpsCoords",
            color = Color(0xFF4B5563),
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.align(Alignment.CenterHorizontally)
        )
    }
}

@Composable
fun TelemetryCard(
    label: String,
    value: String,
    unit: String,
    valueColor: Color = Color.White,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0B0F19)),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(label, fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFF9CA3AF))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(value, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = valueColor)
                if (unit.isNotEmpty()) {
                    Text(" $unit", fontSize = 10.sp, color = Color(0xFF9CA3AF), modifier = Modifier.padding(bottom = 2.dp))
                }
            }
        }
    }
}

@Composable
fun AnomalyRow(anomaly: PotholeEntity, context: String) {
    val sdf = SimpleDateFormat("HH:mm:ss", Locale.US)
    val timeStr = sdf.format(Date(anomaly.timestamp))
    
    val badgeColor = if (anomaly.type == "pothole") Color(0x33F43F5E) else Color(0x33F59E0B)
    val badgeTextColor = if (anomaly.type == "pothole") Color(0xFFF43F5E) else Color(0xFFF59E0B)
    val label = if (anomaly.type == "pothole") "Pothole" else "Speed Bump"

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF111827), RoundedCornerShape(8.dp))
            .padding(10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .background(badgeColor, RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(label, color = badgeTextColor, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
                Text(timeStr, color = Color(0xFF6B7280), fontSize = 11.sp)
            }
            Text(
                text = "${String.format(Locale.US, "%.5f", anomaly.latitude)}, ${String.format(Locale.US, "%.5f", anomaly.longitude)}",
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
                color = Color(0xFF9CA3AF)
            )
        }
        
        Column(horizontalAlignment = Alignment.End) {
            Text("${String.format(Locale.US, "%.2f", anomaly.gForce)} G", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text("${anomaly.speed} km/h", color = Color(0xFF6B7280), fontSize = 11.sp)
        }
    }
}

// Preview Mock Theme
@Composable
fun RoadPulseTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFF3B82F6),
            background = Color(0xFF030712),
            surface = Color(0xFF0B0F19)
        ),
        content = content
    )
}
