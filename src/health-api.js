const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
require('dotenv').config();

const ParkrunClient = require('./parkrun-client');
const HealthDatabase = require('./health-database');
const logger = require('./logger');

class HealthDataService {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3001;
    this.host = process.env.HOST || 'localhost';
    this.database = new HealthDatabase();
    this.parkrunClient = new ParkrunClient();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' })); // Increase limit for health data payloads
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        services: {
          database: this.database.isHealthy(),
          parkrun: this.parkrunClient.isAuthenticated()
        }
      });
    });

    // Parkrun routes
    this.app.get('/api/parkrun/profile', async (req, res) => {
      try {
        const profile = await this.parkrunClient.getProfile();
        res.json({ success: true, data: profile });
      } catch (error) {
        logger.error('Failed to fetch parkrun profile', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/parkrun/results', async (req, res) => {
      try {
        const { limit = 50, offset = 0 } = req.query;
        const results = await this.parkrunClient.getResults(parseInt(limit), parseInt(offset));
        res.json({ success: true, data: results });
      } catch (error) {
        logger.error('Failed to fetch parkrun results', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/parkrun/stats', async (req, res) => {
      try {
        const stats = await this.parkrunClient.getStatistics();
        res.json({ success: true, data: stats });
      } catch (error) {
        logger.error('Failed to fetch parkrun statistics', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/parkrun/sync', async (req, res) => {
      try {
        const result = await this.parkrunClient.syncData();
        res.json({ success: true, data: result });
      } catch (error) {
        logger.error('Failed to sync parkrun data', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/parkrun/results/:year', async (req, res) => {
      try {
        const year = req.params.year;
        
        // Validate year parameter
        if (!/^\d{4}$/.test(year)) {
          return res.status(400).json({ 
            success: false, 
            error: 'Invalid year format. Please provide a 4-digit year (e.g., 2025)' 
          });
        }
        
        const allResults = await this.parkrunClient.getResults(1000, 0); // Get many results
        const yearResults = allResults.filter(result => 
          result.runDate && result.runDate.startsWith(year)
        );
        
        res.json({ 
          success: true, 
          data: {
            year: parseInt(year),
            totalRuns: yearResults.length,
            runs: yearResults
          }
        });
      } catch (error) {
        logger.error(`Failed to fetch ${req.params.year} parkrun results`, error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // General health data routes
    this.app.get('/api/health/summary', async (req, res) => {
      try {
        const { period = '30' } = req.query;
        const summary = await this.getHealthSummary(parseInt(period));
        res.json({ success: true, data: summary });
      } catch (error) {
        logger.error('Failed to generate health summary', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Apple Health comprehensive analytics endpoint
    this.app.get('/api/apple-health/summary', async (req, res) => {
      try {
        const { days = 7 } = req.query;
        const summary = await this.getAppleHealthSummary(parseInt(days));
        res.json({ success: true, data: summary });
      } catch (error) {
        logger.error('Failed to fetch Apple Health summary', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/apple-health/daily/:date', async (req, res) => {
      try {
        const { date } = req.params;
        const dailyData = await this.getAppleHealthDailyData(date);
        res.json({ success: true, data: dailyData });
      } catch (error) {
        logger.error(`Failed to fetch Apple Health data for ${req.params.date}`, error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/apple-health/metrics/:type', async (req, res) => {
      try {
        const { type } = req.params;
        const { days = 30, limit = 100 } = req.query;
        const metrics = await this.getAppleHealthMetrics(type, parseInt(days), parseInt(limit));
        res.json({ success: true, data: metrics });
      } catch (error) {
        logger.error(`Failed to fetch Apple Health metrics for ${req.params.type}`, error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Apple Health Auto Export webhook endpoint
    this.app.post('/api/apple-health/auto-export', async (req, res) => {
      try {
        // Validate payload structure
        if (!req.body || !req.body.data) {
          logger.warn('Invalid Auto Export payload received', { body: req.body });
          return res.status(400).json({
            success: false,
            error: 'Invalid payload structure. Expected { data: { metrics: [], workouts: [] } }'
          });
        }

        const payload = req.body;
        const metricsCount = payload.data?.metrics?.length || 0;
        const workoutsCount = payload.data?.workouts?.length || 0;

        logger.info('Received Apple Health Auto Export data', {
          metricsCount,
          workoutsCount,
          timestamp: new Date().toISOString()
        });

        // Store in database
        const result = await this.database.saveAutoExportData(payload);

        res.json({
          success: true,
          message: 'Apple Health data received and processed',
          data: {
            importId: result.importId,
            metricsStored: result.metricsStored,
            workoutsStored: result.workoutsStored,
            timestamp: result.timestamp
          }
        });
      } catch (error) {
        logger.error('Auto Export webhook failed', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // TEST ENDPOINT: Analyze Health Auto Export data without storing
    this.app.post('/api/apple-health/test-import', async (req, res) => {
      try {
        // Validate payload structure
        if (!req.body || !req.body.data) {
          logger.warn('Invalid test import payload received');
          return res.status(400).json({
            success: false,
            error: 'Invalid payload structure. Expected { data: { metrics: [], workouts: [] } }'
          });
        }

        const payload = req.body;
        const metricsCount = payload.data?.metrics?.length || 0;
        const workoutsCount = payload.data?.workouts?.length || 0;

        logger.info('Received TEST import data', { metricsCount, workoutsCount });

        // Analyze the data without storing
        const analysis = {
          import_timestamp: new Date().toISOString(),
          metrics_received: metricsCount,
          workouts_received: workoutsCount,
          metric_types: [],
          step_data_analysis: null
        };

        // Analyze each metric type
        if (payload.data?.metrics) {
          for (const metric of payload.data.metrics) {
            const metricInfo = {
              name: metric.name,
              units: metric.units,
              data_points: metric.data ? metric.data.length : 0,
              date_range: {
                earliest: null,
                latest: null
              },
              sources: new Set()
            };

            // Analyze data points
            if (metric.data && Array.isArray(metric.data)) {
              const dates = metric.data.map(d => d.date).filter(Boolean).sort();
              metricInfo.date_range.earliest = dates[0];
              metricInfo.date_range.latest = dates[dates.length - 1];

              // Collect unique sources
              metric.data.forEach(d => {
                if (d.source) {
                  metricInfo.sources.add(d.source);
                }
              });
              metricInfo.sources = Array.from(metricInfo.sources);
            }

            analysis.metric_types.push(metricInfo);

            // Detailed analysis for step_count
            if (metric.name === 'step_count' && metric.data) {
              const stepAnalysis = {
                total_samples: metric.data.length,
                total_steps: 0,
                by_source: {},
                by_date: {},
                duplicates_detected: [],
                sample_distribution: {
                  by_minute: 0,
                  by_second: 0
                }
              };

              // Analyze each step data point
              const timestampMap = new Map();

              for (const dataPoint of metric.data) {
                const steps = dataPoint.qty || 0;
                const source = dataPoint.source || 'unknown';
                const timestamp = dataPoint.date;
                const date = timestamp ? timestamp.split('T')[0] : 'unknown';

                // Total steps
                stepAnalysis.total_steps += steps;

                // By source
                if (!stepAnalysis.by_source[source]) {
                  stepAnalysis.by_source[source] = { samples: 0, steps: 0 };
                }
                stepAnalysis.by_source[source].samples++;
                stepAnalysis.by_source[source].steps += steps;

                // By date
                if (!stepAnalysis.by_date[date]) {
                  stepAnalysis.by_date[date] = { samples: 0, steps: 0 };
                }
                stepAnalysis.by_date[date].samples++;
                stepAnalysis.by_date[date].steps += steps;

                // Check for duplicate timestamps
                if (timestamp) {
                  if (!timestampMap.has(timestamp)) {
                    timestampMap.set(timestamp, []);
                  }
                  timestampMap.get(timestamp).push({ source, steps });
                }

                // Determine sample granularity
                if (timestamp) {
                  const hasSeconds = timestamp.includes(':') && timestamp.split(':').length === 3;
                  if (hasSeconds) {
                    stepAnalysis.sample_distribution.by_second++;
                  } else {
                    stepAnalysis.sample_distribution.by_minute++;
                  }
                }
              }

              // Find duplicates
              for (const [timestamp, samples] of timestampMap.entries()) {
                if (samples.length > 1) {
                  stepAnalysis.duplicates_detected.push({
                    timestamp,
                    count: samples.length,
                    samples: samples,
                    total_steps: samples.reduce((sum, s) => sum + s.steps, 0)
                  });
                }
              }

              analysis.step_data_analysis = stepAnalysis;
            }
          }
        }

        // Log the step analysis for debugging
        if (analysis.step_data_analysis) {
          logger.info('Step data analysis:', {
            total_samples: analysis.step_data_analysis.total_samples,
            total_steps: analysis.step_data_analysis.total_steps,
            by_source: analysis.step_data_analysis.by_source,
            by_date: analysis.step_data_analysis.by_date,
            duplicate_count: analysis.step_data_analysis.duplicates_detected.length,
            sample_distribution: analysis.step_data_analysis.sample_distribution
          });
        }

        // Return comprehensive analysis
        res.json({
          success: true,
          message: 'Test import analyzed (NOT stored in database)',
          analysis: analysis
        });

      } catch (error) {
        logger.error('Test import analysis failed', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get Auto Export statistics
    this.app.get('/api/apple-health/auto-export/stats', async (req, res) => {
      try {
        const stats = await this.database.getAutoExportStats();
        res.json({ success: true, data: stats });
      } catch (error) {
        logger.error('Failed to get Auto Export stats', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get recent Auto Export imports
    this.app.get('/api/apple-health/auto-export/recent', async (req, res) => {
      try {
        const { days = 7 } = req.query;
        const imports = await this.database.getRecentAutoExportData(parseInt(days));
        res.json({ success: true, data: imports });
      } catch (error) {
        logger.error('Failed to get recent Auto Export data', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Future API route placeholders
    this.app.get('/api/fitbit/*', (req, res) => {
      res.status(501).json({ 
        success: false, 
        error: 'Fitbit integration not yet implemented' 
      });
    });

    this.app.get('/api/strava/*', (req, res) => {
      res.status(501).json({ 
        success: false, 
        error: 'Strava integration not yet implemented' 
      });
    });
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found'
      });
    });

    // Global error handler
    this.app.use((error, req, res, next) => {
      logger.error('Unhandled error', error);
      res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    });
  }


  async getAppleHealthSummary(days) {
    try {
      logger.info(`Fetching Apple Health summary for ${days} days`);

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

      // Query all health metrics for the period
      const sql = `
        SELECT metric_date, metric_type, metric_value, metric_unit, metric_value_converted, metric_source, additional_data
        FROM health_metrics
        WHERE metric_date >= ?
        ORDER BY metric_date DESC, metric_type
      `;

      const rows = await this.database.allQuery(sql, [cutoffDateStr]);

      // Group data by date
      const dailyDataMap = new Map();

      for (const row of rows) {
        const date = row.metric_date;

        if (!dailyDataMap.has(date)) {
          dailyDataMap.set(date, {
            summary_date: date,
            metrics: {}
          });
        }

        const dayData = dailyDataMap.get(date);

        // Use converted value for energy metrics (kJ -> kcal conversion)
        const isEnergyMetric = (row.metric_type === 'active_energy' || row.metric_type === 'basal_energy_burned');
        const metricValue = isEnergyMetric && row.metric_value_converted ? row.metric_value_converted : row.metric_value;
        const metricUnit = isEnergyMetric ? 'kcal' : row.metric_unit;

        // Store metric value
        if (!dayData.metrics[row.metric_type]) {
          dayData.metrics[row.metric_type] = {
            value: metricValue,
            unit: metricUnit,
            source: row.metric_source,
            data_points: []
          };
        }

        // Add data point
        dayData.metrics[row.metric_type].data_points.push({
          value: metricValue,
          source: row.metric_source
        });

        // Parse additional data if present
        if (row.additional_data) {
          try {
            const additionalData = JSON.parse(row.additional_data);
            dayData.metrics[row.metric_type].additional = additionalData;
          } catch (e) {
            // Ignore parse errors
          }
        }
      }

      // Convert map to array and sort by date descending
      const daily_data = Array.from(dailyDataMap.values())
        .sort((a, b) => b.summary_date.localeCompare(a.summary_date));

      // Calculate aggregate statistics
      const summary = {
        period: `${days} days`,
        start_date: cutoffDateStr,
        end_date: new Date().toISOString().split('T')[0],
        total_days: daily_data.length,
        daily_data: daily_data
      };

      logger.info(`Retrieved Apple Health summary: ${daily_data.length} days with ${rows.length} total metrics`);

      return summary;
    } catch (error) {
      logger.error('Failed to get Apple Health summary', error);
      throw error;
    }
  }

  async getAppleHealthDailyData(date) {
    try {
      logger.info(`Fetching Apple Health daily data for ${date}`);
      
      // For now, return a subset of the summary data for the specific date
      const summary = await this.getAppleHealthSummary(30);
      const dailyData = summary.daily_data.find(day => 
        day.summary_date && day.summary_date.startsWith(date)
      );
      
      return dailyData || { 
        summary_date: date, 
        message: 'No data available for this date' 
      };
    } catch (error) {
      logger.error('Failed to get Apple Health daily data', error);
      throw error;
    }
  }

  async getAppleHealthMetrics(type, days, limit) {
    try {
      logger.info(`Fetching Apple Health metrics: ${type} for ${days} days (limit: ${limit})`);

      // Map API metric names to internal names
      const metricMap = {
        'steps': 'step_count',
        'heart-rate': 'heart_rate',
        'active-energy': 'active_energy',
        'walking-distance': 'walking_running_distance',
        'body-weight': 'weight_body_mass',
        'exercise-minutes': 'apple_exercise_time',
        'flights-climbed': 'flights_climbed',
        'resting-heart-rate': 'resting_heart_rate',
        'hrv': 'heart_rate_variability_sdnn',
        'sleep': 'sleep_analysis'
      };

      const internalType = metricMap[type];
      if (!internalType) {
        throw new Error(`Unknown metric type: ${type}. Supported types: ${Object.keys(metricMap).join(', ')}`);
      }

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

      // Query health_metrics table directly
      // For step_count, filter health_export_complete to Apple Watch only to avoid double counting
      let sql;
      if (internalType === 'step_count') {
        sql = `
          SELECT metric_date, metric_value, metric_unit, metric_value_converted, metric_source, additional_data
          FROM health_metrics
          WHERE metric_type = ? AND metric_date >= ?
            AND (
              metric_source = 'health_auto_export'
              OR (metric_source = 'health_export_complete' AND additional_data LIKE '%Watch%')
            )
          ORDER BY metric_date DESC
          LIMIT ?
        `;
      } else {
        sql = `
          SELECT metric_date, metric_value, metric_unit, metric_value_converted, metric_source, additional_data
          FROM health_metrics
          WHERE metric_type = ? AND metric_date >= ?
          ORDER BY metric_date DESC
          LIMIT ?
        `;
      }

      const rows = await this.database.allQuery(sql, [internalType, cutoffDateStr, limit]);

      // Transform to match expected format
      const results = rows.map(row => {
        // Use converted value for energy metrics (kJ -> kcal conversion)
        const value = (internalType === 'active_energy' || internalType === 'basal_energy_burned') && row.metric_value_converted
          ? row.metric_value_converted
          : row.metric_value;

        const result = {
          recorded_date: row.metric_date,
          value: value,
          unit: (internalType === 'active_energy' || internalType === 'basal_energy_burned') ? 'kcal' : row.metric_unit,
          device: row.metric_source
        };

        // Include additional data if present
        if (row.additional_data) {
          try {
            const additionalData = JSON.parse(row.additional_data);
            result.additional = additionalData;
          } catch (e) {
            // Ignore parse errors
          }
        }

        return result;
      });

      logger.info(`Retrieved ${results.length} records for ${type}`);

      return {
        metric_type: type,
        days_requested: days,
        records_found: results.length,
        data: results
      };
    } catch (error) {
      logger.error('Failed to get Apple Health metrics', error);
      throw error;
    }
  }

  async getHealthSummary(days) {
    // Aggregate health data from multiple sources
    const summary = {
      period: `${days} days`,
      parkrun: await this.parkrunClient.getRecentSummary(days),
      // Add other sources when implemented
      // fitbit: await this.fitbitClient.getRecentSummary(days),
      // strava: await this.stravaClient.getRecentSummary(days)
    };

    return summary;
  }

  async start() {
    try {
      // Initialize database
      await this.database.initialize();
      
      // Initialize parkrun client
      await this.parkrunClient.initialize();
      
      // Start server
      this.server = this.app.listen(this.port, this.host, () => {
        logger.info(`Health Data Service running on ${this.host}:${this.port}`);
      });

      return this.server;
    } catch (error) {
      logger.error('Failed to start Health Data Service', error);
      throw error;
    }
  }

  async stop() {
    if (this.server) {
      this.server.close();
      logger.info('Health Data Service stopped');
    }
  }
}

// Start the service if run directly
if (require.main === module) {
  const service = new HealthDataService();
  service.start().catch(error => {
    logger.error('Failed to start service', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    await service.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully');
    await service.stop();
    process.exit(0);
  });
}

module.exports = HealthDataService;