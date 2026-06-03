package com.pothole.detector.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [PotholeEntity::class], version = 1, exportSchema = false)
abstract class PotholeDatabase : RoomDatabase() {
    abstract fun potholeDao(): PotholeDao

    companion object {
        @Volatile
        private var INSTANCE: PotholeDatabase? = null

        fun getDatabase(context: Context): PotholeDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    PotholeDatabase::class.java,
                    "roadpulse_database"
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }
}
