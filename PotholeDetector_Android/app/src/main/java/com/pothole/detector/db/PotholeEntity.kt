package com.pothole.detector.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "road_anomalies")
data class PotholeEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long,
    val type: String, // "pothole" or "speed-bump"
    val gForce: Double,
    val speed: Int,
    val latitude: Double,
    val longitude: Double
)
