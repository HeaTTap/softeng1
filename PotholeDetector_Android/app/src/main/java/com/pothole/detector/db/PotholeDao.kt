package com.pothole.detector.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PotholeDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAnomaly(anomaly: PotholeEntity)

    @Query("SELECT * FROM road_anomalies ORDER BY timestamp DESC")
    fun getAllAnomalies(): Flow<List<PotholeEntity>>

    @Query("DELETE FROM road_anomalies")
    suspend fun clearAllAnomalies()
}
