const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class HealthDatabase {
  constructor() {
    this.db = null;
    this.dbPath = process.env.DATABASE_PATH || './data/health.db';
    this.isReady = false;
  }

  async initialize() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        logger.info(`Created data directory: ${dataDir}`);
      }

      // Open database connection
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Failed to open database', err);
          throw err;
        }
        logger.info(`Connected to SQLite database: ${this.dbPath}`);
      });

      // Create tables
      await this.createTables();
      
      this.isReady = true;
      logger.info('Health database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize health database', error);
      throw error;
    }
  }

  async createTables() {
    const tables = [
      {
        name: 'parkrun_profile',
        sql: `
          CREATE TABLE IF NOT EXISTS parkrun_profile (
            id INTEGER PRIMARY KEY,
            user_id TEXT UNIQUE,
            first_name TEXT,
            last_name TEXT,
            club_name TEXT,
            home_run TEXT,
            total_runs INTEGER,
            total_volunteers INTEGER,
            join_date TEXT,
            last_updated TEXT
          )
        `
      },
      {
        name: 'parkrun_results',
        sql: `
          CREATE TABLE IF NOT EXISTS parkrun_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            run_date TEXT,
            event_name TEXT,
            event_location TEXT,
            finish_time TEXT,
            position INTEGER,
            age_grade REAL,
            is_personal_best BOOLEAN,
            total_runners INTEGER,
            age_category TEXT,
            gender_position INTEGER,
            created_at TEXT,
            UNIQUE(user_id, run_date, event_name)
          )
        `
      },
      {
        name: 'health_sync_log',
        sql: `
          CREATE TABLE IF NOT EXISTS health_sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service TEXT,
            sync_time TEXT,
            status TEXT,
            records_updated INTEGER,
            error_message TEXT
          )
        `
      },
      {
        name: 'health_metrics',
        sql: `
          CREATE TABLE IF NOT EXISTS health_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metric_type TEXT,
            metric_source TEXT,
            metric_date TEXT,
            metric_value REAL,
            metric_unit TEXT,
            additional_data TEXT,
            created_at TEXT,
            metric_value_converted REAL
          )
        `
      },
      {
        name: 'apple_health_auto_export',
        sql: `
          CREATE TABLE IF NOT EXISTS apple_health_auto_export (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_timestamp TEXT NOT NULL,
            source TEXT DEFAULT 'health_auto_export',
            metrics_count INTEGER DEFAULT 0,
            workouts_count INTEGER DEFAULT 0,
            payload_json TEXT,
            status TEXT DEFAULT 'success',
            error_message TEXT,
            created_at TEXT NOT NULL
          )
        `
      },
      {
        name: 'sleep_cycle_data',
        sql: `
          CREATE TABLE IF NOT EXISTS sleep_cycle_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sleep_date TEXT NOT NULL UNIQUE,
            start_time TEXT,
            end_time TEXT,
            sleep_quality INTEGER,
            regularity INTEGER,
            time_in_bed_sec REAL,
            time_asleep_sec REAL,
            time_before_sleep_sec REAL,
            awake_sec REAL,
            dream_sec REAL,
            light_sec REAL,
            deep_sec REAL,
            snore_time_sec REAL,
            movements_per_hour REAL,
            heart_rate_bpm REAL,
            respiratory_rate REAL,
            breathing_disruptions REAL,
            coughs_per_hour REAL,
            ambient_noise_db REAL,
            weather_temp_c REAL,
            weather_type TEXT,
            city TEXT,
            air_pressure_pa REAL,
            notes TEXT,
            created_at TEXT NOT NULL
          )
        `
      }
    ];

    for (const table of tables) {
      await this.runQuery(table.sql);
      logger.info(`Created/verified table: ${table.name}`);
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_parkrun_results_date ON parkrun_results(run_date)',
      'CREATE INDEX IF NOT EXISTS idx_parkrun_results_user ON parkrun_results(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_health_metrics_date ON health_metrics(metric_date)',
      'CREATE INDEX IF NOT EXISTS idx_health_metrics_type ON health_metrics(metric_type)',
      'CREATE INDEX IF NOT EXISTS idx_auto_export_timestamp ON apple_health_auto_export(import_timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_auto_export_status ON apple_health_auto_export(status)',
      'CREATE INDEX IF NOT EXISTS idx_sleep_cycle_date ON sleep_cycle_data(sleep_date)'
    ];

    for (const indexSql of indexes) {
      await this.runQuery(indexSql);
    }
  }

  async saveParkrunProfile(profile) {
    if (!this.isReady) throw new Error('Database not initialized');

    const sql = `
      INSERT OR REPLACE INTO parkrun_profile 
      (user_id, first_name, last_name, club_name, home_run, total_runs, total_volunteers, join_date, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      profile.id,
      profile.firstName,
      profile.lastName,
      profile.clubName,
      profile.homeRun,
      profile.totalRuns,
      profile.totalVolunteers,
      profile.joinDate,
      new Date().toISOString()
    ];

    try {
      await this.runQuery(sql, values);
      logger.info(`Saved parkrun profile for user ${profile.id}`);
    } catch (error) {
      logger.error('Failed to save parkrun profile', error);
      throw error;
    }
  }

  async saveParkrunResults(userId, results) {
    if (!this.isReady) throw new Error('Database not initialized');
    if (!results || results.length === 0) return;

    const sql = `
      INSERT OR REPLACE INTO parkrun_results 
      (user_id, run_date, event_name, event_location, finish_time, position, age_grade, 
       is_personal_best, total_runners, age_category, gender_position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
      const stmt = this.db.prepare(sql);
      
      for (const result of results) {
        const values = [
          userId,
          result.runDate,
          result.eventName,
          result.eventLocation,
          result.finishTime,
          result.position,
          result.ageGrade,
          result.isPersonalBest ? 1 : 0,
          result.totalRunners,
          result.ageCategory,
          result.genderPosition,
          new Date().toISOString()
        ];
        
        stmt.run(values);
      }
      
      stmt.finalize();
      logger.info(`Saved ${results.length} parkrun results for user ${userId}`);
    } catch (error) {
      logger.error('Failed to save parkrun results', error);
      throw error;
    }
  }

  async getParkrunResults(userId, limit = 50, offset = 0) {
    if (!this.isReady) throw new Error('Database not initialized');

    const sql = `
      SELECT * FROM parkrun_results 
      WHERE user_id = ?
      ORDER BY run_date DESC 
      LIMIT ? OFFSET ?
    `;

    try {
      const results = await this.allQuery(sql, [userId, limit, offset]);
      logger.info(`Retrieved ${results.length} parkrun results for user ${userId}`);
      return results;
    } catch (error) {
      logger.error('Failed to get parkrun results', error);
      throw error;
    }
  }

  async getRecentParkrunResults(userId, days = 30) {
    if (!this.isReady) throw new Error('Database not initialized');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    const sql = `
      SELECT * FROM parkrun_results 
      WHERE user_id = ? AND run_date >= ?
      ORDER BY run_date DESC
    `;

    try {
      const results = await this.allQuery(sql, [userId, cutoffDateStr]);
      logger.info(`Retrieved ${results.length} recent parkrun results for user ${userId}`);
      return results;
    } catch (error) {
      logger.error('Failed to get recent parkrun results', error);
      throw error;
    }
  }

  async logSync(service, status, recordsUpdated = 0, errorMessage = null) {
    if (!this.isReady) throw new Error('Database not initialized');

    const sql = `
      INSERT INTO health_sync_log (service, sync_time, status, records_updated, error_message)
      VALUES (?, ?, ?, ?, ?)
    `;

    const values = [
      service,
      new Date().toISOString(),
      status,
      recordsUpdated,
      errorMessage
    ];

    try {
      await this.runQuery(sql, values);
      logger.info(`Logged sync for ${service}: ${status}`);
    } catch (error) {
      logger.error('Failed to log sync', error);
    }
  }

  async saveHealthMetric(type, source, date, value, unit, additionalData = null) {
    if (!this.isReady) throw new Error('Database not initialized');

    // Calculate converted value for energy metrics
    let convertedValue = value;
    if (type === 'active_energy' || type === 'basal_energy_burned') {
      if (unit === 'kJ') {
        // Convert kilojoules to kilocalories
        convertedValue = value / 4.184;
      }
      // If unit is already kcal, use value as-is
    }

    const sql = `
      INSERT OR IGNORE INTO health_metrics (metric_type, metric_source, metric_date, metric_value, metric_unit, metric_value_converted, additional_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      type,
      source,
      date,
      value,
      unit,
      convertedValue,
      additionalData ? JSON.stringify(additionalData) : null,
      new Date().toISOString()
    ];

    try {
      await this.runQuery(sql, values);
      // Note: INSERT OR IGNORE will silently skip duplicates based on UNIQUE constraint
      logger.debug(`Saved health metric: ${type} from ${source} at ${date} (original: ${value} ${unit}, converted: ${convertedValue})`);
    } catch (error) {
      logger.error('Failed to save health metric', error);
      throw error;
    }
  }

  async logHealthKitData(healthData) {
    if (!this.isReady) throw new Error('Database not initialized');

    try {
      // Store the raw HealthKit data as JSON for now
      // Later we can parse specific metrics into structured format
      const sql = `
        INSERT INTO health_metrics (metric_type, metric_source, metric_date, metric_value, metric_unit, additional_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        'healthkit_batch',
        healthData.source,
        new Date().toISOString().split('T')[0], // Today's date
        0, // We'll use additional_data for the actual values
        'batch',
        JSON.stringify(healthData.data),
        healthData.timestamp
      ];

      const result = await this.runQuery(sql, values);
      logger.info(`Stored HealthKit data batch with ID: ${result.id}`);

      // Also log the sync activity
      await this.logSync('healthkit_shortcuts', 'success', Object.keys(healthData.data).length);

      return result;
    } catch (error) {
      logger.error('Failed to log HealthKit data', error);
      await this.logSync('healthkit_shortcuts', 'error', 0, error.message);
      throw error;
    }
  }

  async saveAutoExportData(payload) {
    if (!this.isReady) throw new Error('Database not initialized');

    try {
      const timestamp = new Date().toISOString();
      const metricsCount = payload.data?.metrics?.length || 0;
      const workoutsCount = payload.data?.workouts?.length || 0;

      // Store the import record
      const importSql = `
        INSERT INTO apple_health_auto_export
        (import_timestamp, source, metrics_count, workouts_count, payload_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const importValues = [
        timestamp,
        'health_auto_export',
        metricsCount,
        workoutsCount,
        JSON.stringify(payload),
        'success',
        timestamp
      ];

      const importResult = await this.runQuery(importSql, importValues);
      logger.info(`Stored Auto Export import with ID: ${importResult.id}, metrics: ${metricsCount}, workouts: ${workoutsCount}`);

      // Process and store individual metrics
      let metricsStored = 0;
      if (payload.data?.metrics) {
        for (const metric of payload.data.metrics) {
          if (metric.data && Array.isArray(metric.data)) {
            for (const dataPoint of metric.data) {
              // Special handling for metrics with non-standard structure
              if (metric.name === 'sleep_analysis') {
                // Sleep data has totalSleep, deep, core, rem, awake instead of qty
                await this.saveHealthMetric(
                  metric.name,
                  'health_auto_export',
                  dataPoint.date,
                  dataPoint.totalSleep || 0,
                  metric.units,
                  {
                    source: dataPoint.source || 'iPhone',
                    deep: dataPoint.deep,
                    core: dataPoint.core,
                    rem: dataPoint.rem,
                    awake: dataPoint.awake,
                    inBed: dataPoint.inBed,
                    sleepStart: dataPoint.sleepStart,
                    sleepEnd: dataPoint.sleepEnd,
                    inBedStart: dataPoint.inBedStart,
                    inBedEnd: dataPoint.inBedEnd
                  }
                );
              } else if (metric.name === 'heart_rate') {
                // Heart rate has Avg, Min, Max instead of qty
                await this.saveHealthMetric(
                  metric.name,
                  'health_auto_export',
                  dataPoint.date,
                  dataPoint.Avg || 0,
                  metric.units,
                  {
                    source: dataPoint.source || 'iPhone',
                    min: dataPoint.Min,
                    max: dataPoint.Max,
                    avg: dataPoint.Avg
                  }
                );
              } else {
                // Regular metric handling
                await this.saveHealthMetric(
                  metric.name,
                  'health_auto_export',
                  dataPoint.date,
                  dataPoint.qty,
                  metric.units,
                  { source: dataPoint.source || 'iPhone' }
                );
              }
              metricsStored++;
            }
          }
        }
      }

      // Process and store workouts
      let workoutsStored = 0;
      if (payload.data?.workouts) {
        for (const workout of payload.data.workouts) {
          await this.saveHealthMetric(
            `workout_${workout.name}`,
            'health_auto_export',
            workout.start,
            workout.duration || 0,
            'seconds',
            {
              end: workout.end,
              calories: workout.calories,
              distance: workout.distance,
              source: workout.source || 'iPhone'
            }
          );
          workoutsStored++;
        }
      }

      // Log the sync activity
      await this.logSync('health_auto_export', 'success', metricsStored + workoutsStored);

      logger.info(`Processed Auto Export data: ${metricsStored} metric data points, ${workoutsStored} workouts`);

      return {
        importId: importResult.id,
        metricsStored,
        workoutsStored,
        timestamp
      };
    } catch (error) {
      logger.error('Failed to save Auto Export data', error);

      // Try to log the error import
      try {
        const errorSql = `
          INSERT INTO apple_health_auto_export
          (import_timestamp, source, metrics_count, workouts_count, payload_json, status, error_message, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await this.runQuery(errorSql, [
          new Date().toISOString(),
          'health_auto_export',
          0,
          0,
          JSON.stringify(payload),
          'error',
          error.message,
          new Date().toISOString()
        ]);
      } catch (logError) {
        logger.error('Failed to log error import', logError);
      }

      await this.logSync('health_auto_export', 'error', 0, error.message);
      throw error;
    }
  }

  async getRecentAutoExportData(days = 7) {
    if (!this.isReady) throw new Error('Database not initialized');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffDateStr = cutoffDate.toISOString();

    const sql = `
      SELECT * FROM apple_health_auto_export
      WHERE import_timestamp >= ?
      ORDER BY import_timestamp DESC
    `;

    try {
      const results = await this.allQuery(sql, [cutoffDateStr]);
      logger.info(`Retrieved ${results.length} Auto Export imports from last ${days} days`);
      return results;
    } catch (error) {
      logger.error('Failed to get recent Auto Export data', error);
      throw error;
    }
  }

  async getAutoExportStats() {
    if (!this.isReady) throw new Error('Database not initialized');

    const sql = `
      SELECT
        COUNT(*) as total_imports,
        SUM(metrics_count) as total_metrics,
        SUM(workouts_count) as total_workouts,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_imports,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed_imports,
        MAX(import_timestamp) as last_import,
        MIN(import_timestamp) as first_import
      FROM apple_health_auto_export
    `;

    try {
      const stats = await this.getQuery(sql);
      logger.info('Retrieved Auto Export statistics');
      return stats;
    } catch (error) {
      logger.error('Failed to get Auto Export stats', error);
      throw error;
    }
  }

  // Sleep Cycle CSV data methods
  async saveSleepCycleData(record) {
    if (!this.isReady) throw new Error('Database not initialized');

    const sql = `
      INSERT OR REPLACE INTO sleep_cycle_data
      (sleep_date, start_time, end_time, sleep_quality, regularity,
       time_in_bed_sec, time_asleep_sec, time_before_sleep_sec,
       awake_sec, dream_sec, light_sec, deep_sec,
       snore_time_sec, movements_per_hour, heart_rate_bpm,
       respiratory_rate, breathing_disruptions, coughs_per_hour,
       ambient_noise_db, weather_temp_c, weather_type, city,
       air_pressure_pa, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      record.sleep_date,
      record.start_time,
      record.end_time,
      record.sleep_quality,
      record.regularity,
      record.time_in_bed_sec,
      record.time_asleep_sec,
      record.time_before_sleep_sec,
      record.awake_sec,
      record.dream_sec,
      record.light_sec,
      record.deep_sec,
      record.snore_time_sec,
      record.movements_per_hour,
      record.heart_rate_bpm,
      record.respiratory_rate,
      record.breathing_disruptions,
      record.coughs_per_hour,
      record.ambient_noise_db,
      record.weather_temp_c,
      record.weather_type,
      record.city,
      record.air_pressure_pa,
      record.notes,
      new Date().toISOString()
    ];

    return this.runQuery(sql, values);
  }

  async getSleepCycleDataByDate(date) {
    if (!this.isReady) throw new Error('Database not initialized');

    const sql = `SELECT * FROM sleep_cycle_data WHERE sleep_date = ?`;
    return this.getQuery(sql, [date]);
  }

  async getSleepCycleDataRange(startDate, endDate) {
    if (!this.isReady) throw new Error('Database not initialized');

    const sql = `
      SELECT * FROM sleep_cycle_data
      WHERE sleep_date >= ? AND sleep_date <= ?
      ORDER BY sleep_date DESC
    `;
    return this.allQuery(sql, [startDate, endDate]);
  }

  async getSleepCycleStats() {
    if (!this.isReady) throw new Error('Database not initialized');

    const sql = `
      SELECT
        COUNT(*) as total_records,
        MIN(sleep_date) as earliest_date,
        MAX(sleep_date) as latest_date,
        AVG(sleep_quality) as avg_quality,
        AVG(time_asleep_sec / 3600.0) as avg_sleep_hours
      FROM sleep_cycle_data
    `;
    return this.getQuery(sql);
  }

  isHealthy() {
    return this.isReady && this.db !== null;
  }

  async close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          logger.error('Error closing database', err);
        } else {
          logger.info('Database connection closed');
        }
      });
    }
  }

  // Utility methods for database operations
  runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  getQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  allQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
}

module.exports = HealthDatabase;