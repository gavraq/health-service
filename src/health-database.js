const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

// How long a statement waits for a lock before giving up. A large import can
// hold the write lock for ~20s, so this needs comfortable headroom.
const BUSY_TIMEOUT_MS = 60_000;

// How many Auto Export payload bodies to retain. The table doubles as a replay
// log, but each body is megabytes and the app can re-send the same window many
// times a day — by 2026-09-06 it held 1,073 rows totalling 3.5 GB, essentially
// the whole 6.1 GB database. Cap by COUNT, not by age: a time window does not
// bound size when the export cadence misbehaves, which is exactly what
// happened (140 imports totalling 2.2 GB on 26 Aug alone). Metadata rows are
// kept forever — they are tiny, and they are how that problem was diagnosed.
const AUTO_EXPORT_PAYLOAD_RETENTION = 40;

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

      // Wait for a lock rather than failing on it. Overlapping Auto Export
      // imports used to abort with SQLITE_BUSY and silently lose the whole
      // payload — on 2026-09-06 that left heart_rate frozen two days behind
      // every other metric. Queue instead.
      this.db.configure('busyTimeout', BUSY_TIMEOUT_MS);

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
      },
      {
        // GPS tracks for outdoor workouts, from Auto Export's route data.
        //
        // These are a genuinely independent location source: when OwnTracks
        // stopped publishing (2-6 Sept 2026) the runs and walks were still
        // recorded by the Watch, so the tracks survive here even when the
        // background GPS trail does not.
        //
        // One row per workout with the track as a compact JSON array of
        // [epochSeconds, lat, lon, altitude] tuples, rather than a row per
        // point: reads are always "give me the whole track for this day", and
        // 24,000 points a week as individual rows is how databases get fat.
        // A long run is ~5,700 points, roughly 170 KB stored this way.
        //
        // UNIQUE(workout_start, workout_name) matters — the 7-day export
        // window re-sends the same workouts every 6 hours, so without it each
        // track would be stored ~28 times a week.
        name: 'workout_routes',
        sql: `
          CREATE TABLE IF NOT EXISTS workout_routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_start TEXT NOT NULL,
            workout_end TEXT,
            workout_name TEXT NOT NULL,
            workout_date TEXT NOT NULL,
            point_count INTEGER NOT NULL,
            distance_km REAL,
            min_lat REAL, min_lon REAL, max_lat REAL, max_lon REAL,
            track_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(workout_start, workout_name)
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
      'CREATE INDEX IF NOT EXISTS idx_sleep_cycle_date ON sleep_cycle_data(sleep_date)',
      'CREATE INDEX IF NOT EXISTS idx_workout_routes_date ON workout_routes(workout_date)'
    ];

    for (const indexSql of indexes) {
      await this.runQuery(indexSql);
    }

    await this.ensureWorkoutRouteInstantKey();
  }

  /**
   * UNIQUE(workout_start, workout_name) is not enough on its own.
   *
   * workout.start is rendered in the phone's timezone *at export time*, so a
   * run recorded abroad and re-exported after coming home arrives as a
   * different string for the same instant ("2026-08-03 08:28:57 -0500" vs
   * "2026-08-03 14:28:57 +0100"). health_metrics has already accumulated ten
   * such pairs from the Minnesota trip. Key on the parsed instant instead, so
   * travel cannot duplicate a track.
   */
  async ensureWorkoutRouteInstantKey() {
    const cols = await this.allQuery('PRAGMA table_info(workout_routes)');
    if (!cols.some((c) => c.name === 'workout_start_utc')) {
      await this.runQuery('ALTER TABLE workout_routes ADD COLUMN workout_start_utc INTEGER');
      logger.info('Added workout_routes.workout_start_utc');
    }

    const stale = await this.allQuery(
      'SELECT id, workout_start FROM workout_routes WHERE workout_start_utc IS NULL'
    );
    for (const row of stale) {
      const t = Date.parse(row.workout_start);
      if (Number.isNaN(t)) continue;
      await this.runQuery('UPDATE workout_routes SET workout_start_utc = ? WHERE id = ?', [t, row.id]);
    }
    if (stale.length) logger.info(`Backfilled workout_start_utc on ${stale.length} route row(s)`);

    try {
      await this.runQuery(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_routes_instant ON workout_routes(workout_start_utc, workout_name)'
      );
    } catch (e) {
      // Pre-existing duplicates would block the index. Report rather than
      // silently carry on without the protection.
      logger.error('Could not create unique index on workout_routes(workout_start_utc, workout_name)', e);
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

  async getParkrunProfile(userId) {
    if (!this.isReady) throw new Error('Database not initialized');
    const sql = `SELECT * FROM parkrun_profile WHERE user_id = ? LIMIT 1`;
    try {
      const rows = await this.allQuery(sql, [userId]);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to get parkrun profile', error);
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

  /**
   * Record an incoming Auto Export payload and return immediately.
   *
   * This is the fast half of the ingest, split out so the webhook can
   * acknowledge before the (much slower) parse. Writing the row takes ~80ms;
   * parsing 34,000 data points out of it takes ~94s, which is longer than the
   * iPhone app's 60s request timeout. The app was therefore timing out on
   * every single import, never recording a completed run, and re-firing
   * constantly — its lastRunDate sat at 2026-07-15 for seven weeks while data
   * committed fine on this end. See processAutoExportImport().
   *
   * Status starts as 'pending' and is moved to 'success' or 'error' by the
   * background pass.
   */
  async recordAutoExportImport(payload) {
    if (!this.isReady) throw new Error('Database not initialized');

    const timestamp = new Date().toISOString();
    const metricsCount = payload.data?.metrics?.length || 0;
    const workoutsCount = payload.data?.workouts?.length || 0;

    const importSql = `
      INSERT INTO apple_health_auto_export
      (import_timestamp, source, metrics_count, workouts_count, payload_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const importResult = await this.runQuery(importSql, [
      timestamp,
      'health_auto_export',
      metricsCount,
      workoutsCount,
      JSON.stringify(payload),
      'pending',
      timestamp
    ]);

    logger.info(`Recorded Auto Export import ID ${importResult.id}: metrics ${metricsCount}, workouts ${workoutsCount} (parse queued)`);
    return { importId: importResult.id, metricsCount, workoutsCount, timestamp };
  }

  async setAutoExportStatus(importId, status, errorMessage = null) {
    if (!this.isReady) return;
    try {
      await this.runQuery(
        'UPDATE apple_health_auto_export SET status = ?, error_message = ? WHERE id = ?',
        [status, errorMessage, importId]
      );
    } catch (e) {
      logger.error(`Failed to set status ${status} on import ${importId}`, e);
    }
  }

  /**
   * The slow half: parse a recorded payload into health_metrics. Runs after the
   * HTTP response has already gone back, so its duration is invisible to the
   * phone.
   */
  async processAutoExportImport(importId, payload) {
    if (!this.isReady) throw new Error('Database not initialized');

    try {
      const timestamp = new Date().toISOString();

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
          // Route points are dropped by saveHealthMetric — keep them.
          await this.saveWorkoutRoute(workout);
          workoutsStored++;
        }
      }

      // Log the sync activity
      await this.logSync('health_auto_export', 'success', metricsStored + workoutsStored);

      // Keep the payload table bounded. Never let this fail an import — the
      // metrics are already committed by this point and are what matters.
      try {
        await this.pruneAutoExportPayloads();
      } catch (pruneError) {
        logger.warn('Auto Export payload prune failed (import itself succeeded)', pruneError);
      }

      await this.setAutoExportStatus(importId, 'success');
      logger.info(`Processed Auto Export import ${importId}: ${metricsStored} metric data points, ${workoutsStored} workouts`);

      return { importId, metricsStored, workoutsStored, timestamp };
    } catch (error) {
      logger.error(`Failed to process Auto Export import ${importId}`, error);
      // The row already exists — mark it rather than inserting a second one.
      await this.setAutoExportStatus(importId, 'error', error.message);
      await this.logSync('health_auto_export', 'error', 0, error.message);
      throw error;
    }
  }

  /**
   * Kept for callers that want the old blocking behaviour (tests, backfills).
   * The webhook does not use this — see health-api.js.
   */
  async saveAutoExportData(payload) {
    const recorded = await this.recordAutoExportImport(payload);
    return this.processAutoExportImport(recorded.importId, payload);
  }

  /**
   * Store a workout's GPS track, if it has one.
   *
   * Silently does nothing for indoor workouts and for outdoor ones exported
   * before "Include Route Data" was enabled — both legitimately have no route.
   *
   * INSERT OR REPLACE against the UNIQUE(workout_start, workout_name) key, so
   * re-exports of the same workout overwrite rather than accumulate. Replace
   * rather than ignore because a later export can carry a more complete track
   * (a workout exported mid-session has only the points recorded so far).
   */
  async saveWorkoutRoute(workout) {
    if (!this.isReady) throw new Error('Database not initialized');

    const route = Array.isArray(workout.route) ? workout.route : null;
    if (!route || route.length === 0) return 0;

    const track = [];
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;

    for (const p of route) {
      const lat = Number(p.latitude);
      const lon = Number(p.longitude);
      const ts = Date.parse(p.timestamp);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Number.isNaN(ts)) continue;
      // Six decimal places is ~0.1m — far finer than GPS, and it keeps the
      // stored track roughly half the size of full float precision.
      track.push([
        Math.round(ts / 1000),
        Number(lat.toFixed(6)),
        Number(lon.toFixed(6)),
        Number.isFinite(Number(p.altitude)) ? Math.round(Number(p.altitude)) : null
      ]);
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }

    if (track.length === 0) return 0;
    track.sort((a, b) => a[0] - b[0]);

    // workout.start looks like "2026-09-04 06:40:00 +0100"; the date prefix is
    // what the location pipeline queries on.
    const workoutDate = String(workout.start || '').slice(0, 10);
    const distanceKm = typeof workout.distance?.qty === 'number'
      ? workout.distance.qty
      : (typeof workout.distance === 'number' ? workout.distance : null);

    const startUtc = Date.parse(workout.start);

    await this.runQuery(
      `INSERT OR REPLACE INTO workout_routes
       (workout_start, workout_start_utc, workout_end, workout_name, workout_date,
        point_count, distance_km, min_lat, min_lon, max_lat, max_lon, track_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workout.start, Number.isNaN(startUtc) ? null : startUtc,
        workout.end, workout.name, workoutDate, track.length,
        distanceKm, minLat, minLon, maxLat, maxLon,
        JSON.stringify(track), new Date().toISOString()
      ]
    );

    logger.info(`Stored route for ${workout.name} ${workout.start}: ${track.length} points`);
    return track.length;
  }

  /**
   * Workout tracks for a date. `includeTrack` false returns just the summary
   * rows, which is all a listing needs — the tracks are large.
   */
  async getWorkoutRoutes(date, includeTrack = true) {
    if (!this.isReady) throw new Error('Database not initialized');

    const cols = 'workout_start, workout_end, workout_name, workout_date, point_count, ' +
      'distance_km, min_lat, min_lon, max_lat, max_lon' + (includeTrack ? ', track_json' : '');
    const rows = await this.allQuery(
      `SELECT ${cols} FROM workout_routes WHERE workout_date = ? ORDER BY workout_start`,
      [date]
    );
    return rows.map((r) => {
      const out = { ...r };
      if (includeTrack) {
        // [epochSeconds, lat, lon, altitude] -> named fields for consumers
        out.track = JSON.parse(r.track_json).map(([t, lat, lon, alt]) => ({
          timestamp: new Date(t * 1000).toISOString(), lat, lon, altitude: alt
        }));
        delete out.track_json;
      }
      return out;
    });
  }

  /**
   * Clear payload bodies outside the most recent AUTO_EXPORT_PAYLOAD_RETENTION
   * imports. The rows themselves stay — only the multi-megabyte payload_json
   * column is nulled, so the import history (when, how many metrics, status)
   * survives in full while the bytes do not.
   *
   * Note this reclaims space inside the file for reuse; it does not shrink
   * health.db on disk. That needs a VACUUM, which takes an exclusive lock and
   * so belongs in a maintenance window, not in the import path.
   */
  async pruneAutoExportPayloads() {
    if (!this.isReady) throw new Error('Database not initialized');

    const sql = `
      UPDATE apple_health_auto_export
      SET payload_json = NULL
      WHERE payload_json IS NOT NULL
        AND id NOT IN (
          SELECT id FROM apple_health_auto_export ORDER BY id DESC LIMIT ?
        )
    `;
    const result = await this.runQuery(sql, [AUTO_EXPORT_PAYLOAD_RETENTION]);
    if (result.changes > 0) {
      logger.info(`Pruned Auto Export payload bodies from ${result.changes} old import(s)`);
    }
    return result.changes;
  }

  async getRecentAutoExportData(days = 7) {
    if (!this.isReady) throw new Error('Database not initialized');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffDateStr = cutoffDate.toISOString();

    // Exclude payload_json: the raw export blobs can be tens of MB each and
    // loading a week of them OOM-kills the Node process.
    const sql = `
      SELECT id, import_timestamp, source, metrics_count, workouts_count,
             status, error_message, created_at,
             length(payload_json) as payload_bytes
      FROM apple_health_auto_export
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