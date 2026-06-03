package com.pothole.detector.sensor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.pothole.detector.MainActivity
import com.pothole.detector.db.PotholeDatabase
import com.pothole.detector.db.PotholeEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.math.sqrt

class PotholeDetectorService : Service(), SensorEventListener, TextToSpeech.OnInitListener {

    private val binder = LocalBinder()
    private val scope = CoroutineScope(Dispatchers.IO)
    
    // Sensor & Location Managers
    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null
    
    // DB & TTS
    private lateinit var database: PotholeDatabase
    private var tts: TextToSpeech? = null
    private var isTtsInitialized = false

    // State Variables
    var potholeThreshold = 2.8
    var bumpThreshold = 1.6
    var isAudioEnabled = true

    private var currentSpeedKmH = 0
    private var lastLocation: Location? = null
    
    // Rolling buffers
    private val bufferSize = 10
    private val rollingBuffer = ArrayList<Double>()
    
    private var lastTriggerTime = 0L
    private val debounceWindow = 1500L // 1.5 seconds

    // Flows to communicate with UI
    private val _sensorFlow = MutableSharedFlow<Double>(extraBufferCapacity = 64)
    val sensorFlow = _sensorFlow.asSharedFlow()

    private val _anomalyFlow = MutableSharedFlow<PotholeEntity>(extraBufferCapacity = 16)
    val anomalyFlow = _anomalyFlow.asSharedFlow()

    private val _speedFlow = MutableSharedFlow<Int>(extraBufferCapacity = 16)
    val speedFlow = _speedFlow.asSharedFlow()

    private val _locationFlow = MutableSharedFlow<Location>(extraBufferCapacity = 16)
    val locationFlow = _locationFlow.asSharedFlow()

    inner class LocalBinder : Binder() {
        fun getService(): PotholeDetectorService = this@PotholeDetectorService
    }

    override fun onCreate() {
        super.onCreate()
        database = PotholeDatabase.getDatabase(this)
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        
        tts = TextToSpeech(this, this)
        
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification("Monitoring started. Drive safely."))
        
        startSensorMonitoring()
        startLocationUpdates()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder {
        return binder
    }

    // TTS Init Callback
    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            val result = tts?.setLanguage(Locale.US)
            if (result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED) {
                isTtsInitialized = true
            }
        }
    }

    private fun speakAlert(text: String) {
        if (isAudioEnabled && isTtsInitialized) {
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "anomaly_alert")
        }
    }

    // Register Sensors
    private fun startSensorMonitoring() {
        accelerometer?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) // ~50Hz
        }
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event == null || event.sensor.type != Sensor.TYPE_ACCELEROMETER) return
        
        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]
        
        // Total G-force magnitude = sqrt(x^2 + y^2 + z^2) / 9.81
        val magnitude = sqrt(x*x + y*y + z*z)
        val gForce = magnitude / SensorManager.GRAVITY_EARTH
        
        scope.launch {
            _sensorFlow.emit(gForce)
        }

        // Add to rolling window buffer
        synchronized(rollingBuffer) {
            rollingBuffer.add(gForce.toDouble())
            if (rollingBuffer.size > bufferSize) {
                rollingBuffer.removeAt(0)
            }
        }
        
        processAnomalyDetection()
    }

    private fun processAnomalyDetection() {
        val now = System.currentTimeMillis()
        if (now - lastTriggerTime < debounceWindow) return
        
        var bufferCopy: List<Double>
        synchronized(rollingBuffer) {
            if (rollingBuffer.size < bufferSize) return
            bufferCopy = ArrayList(rollingBuffer)
        }
        
        val max = bufferCopy.maxOrNull() ?: 1.0
        val min = bufferCopy.minOrNull() ?: 1.0
        val peakToPeak = max - min
        
        if (peakToPeak >= potholeThreshold) {
            triggerAnomaly("pothole", peakToPeak)
        } else if (peakToPeak >= bumpThreshold) {
            triggerAnomaly("speed-bump", peakToPeak)
        }
    }

    private fun triggerAnomaly(type: String, intensity: Double) {
        lastTriggerTime = System.currentTimeMillis()
        
        val displayType = if (type == "pothole") "Pothole" else "Speed Bump"
        speakAlert("$displayType detected!")
        
        // Update Persistent Notification text dynamically
        updateNotification("$displayType detected: ${String.format(Locale.US, "%.2f", intensity)} G")
        
        val lat = lastLocation?.latitude ?: 0.0
        val lng = lastLocation?.longitude ?: 0.0
        
        val anomaly = PotholeEntity(
            timestamp = System.currentTimeMillis(),
            type = type,
            gForce = intensity,
            speed = currentSpeedKmH,
            latitude = lat,
            longitude = lng
        )
        
        scope.launch {
            // Save to Local SQLite Room database
            database.potholeDao().insertAnomaly(anomaly)
            // Broadcast event to UI
            _anomalyFlow.emit(anomaly)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    // Location tracker configuration
    private fun startLocationUpdates() {
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000)
            .setWaitForAccurateLocation(false)
            .setMinUpdateIntervalMillis(1000)
            .build()
            
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                val location = locationResult.lastLocation ?: return
                lastLocation = location
                currentSpeedKmH = (location.speed * 3.6).toInt() // m/s to km/h
                
                scope.launch {
                    _speedFlow.emit(currentSpeedKmH)
                    _locationFlow.emit(location)
                }
            }
        }
        
        try {
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback!!,
                Looper.getMainLooper()
            )
        } catch (e: SecurityException) {
            // Log or handle missing permissions gracefully
        }
    }

    // Foreground service notification helpers
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "RoadPulse Active Service Channel",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }

    private fun createNotification(content: String): Notification {
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("RoadPulse is Active")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_menu_compass) // Standard OS fallback icon
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(content: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, createNotification(content))
    }

    override fun onDestroy() {
        super.onDestroy()
        sensorManager.unregisterListener(this)
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
        }
        tts?.stop()
        tts?.shutdown()
    }

    companion object {
        const val CHANNEL_ID = "RoadPulseServiceChannel"
        const val NOTIFICATION_ID = 455
    }
}
