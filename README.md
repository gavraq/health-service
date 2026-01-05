# Health Service

REST API and interactive dashboard for managing Apple Health data with Parkrun integration. Part of Gavin's Personal AI Infrastructure.

## Overview

The Health Service provides:
- **Interactive Dashboard**: Tab-based health monitoring at https://health.gavinslater.co.uk
- **Apple Health Data**: 5.6M+ records from Health Auto Export (2010-2026)
- **Parkrun Integration**: Performance tracking and statistics
- **Sleep Cycle Import**: CSV import from Sleep Cycle app
- **Quantified Self**: Health metrics, trends, and insights with flexible aggregation

## Dashboard (v3.12)

The Health Monitor dashboard provides a comprehensive view of health metrics with a tab-based interface:

### Tabs
- **Overview**: 5-ring activity display, quick stats (VO2 Max, HRV, Flights, Distance), metric cards
- **Activity**: 4-ring activity rings, 8 trend charts (Active/Resting Energy, Steps, Distance, Exercise, Flights, Stand Minutes/Hours)
- **Heart**: Heart rate metrics, HRV trends, VO2 Max tracking
- **Body**: Weight trend, Body Fat %, BMI charts
- **Recovery**: Sleep analysis with Sleep Cycle integration
- **Workouts**: Recent workout history and statistics
- **Parkrun**: Terminal-style Parkrun statistics display

### Activity Rings

**Overview Tab (5 rings)**:
| Ring | Color | Goal | Metric |
|------|-------|------|--------|
| Steps | Emerald (#10B981) | 10,000 | Daily step count |
| Move | Red (#EF4444) | 500 kcal | Active energy burned |
| Exercise | Lime (#84CC16) | 40 min | Exercise minutes |
| Stand | Cyan (#06B6D4) | 12 hrs | Stand hours |
| Sleep | Purple (#8B5CF6) | 8 hrs | Sleep duration |

**Activity Tab (4 rings)**: Same as above without Sleep ring.

The center percentage shows average completion across all rings (each capped at 100%).

### Date Controls
- **Daily Picker**: Select specific dates for daily metrics
- **Trend Presets**: 7D, 30D, 90D, 1Y quick selection
- **Custom Range**: Date range picker for trend charts

## Architecture

- **Service Type**: Self-hosted REST API
- **Data Storage**: SQLite database (health.db, ~1.9 GB)
- **API Framework**: Node.js + Express
- **Deployment**: Docker container on Raspberry Pi
- **External Access**: https://health.gavinslater.co.uk (via NGINX Proxy Manager)
- **Integration**: Called by health-agent via REST API

## Quick Start

### Development (Mac)

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Parkrun credentials

# Start development server
npm start
```

**Note**: Service will start even without valid Parkrun credentials. Parkrun endpoints will be unavailable but Apple Health endpoints will work.

### Production (Pi Docker)

```bash
# Build and start
docker-compose up -d

# Rebuild after code changes
docker-compose build && docker-compose up -d

# Check status
docker-compose ps
docker-compose logs -f health-service

# Stop
docker-compose down
```

## API Endpoints

### Service Health

```
GET  /health                    # Service health check
```

### Apple Health Metrics

All Apple Health endpoints support flexible aggregation with the `aggregate` parameter:
- **Aggregation levels**: `daily`, `weekly`, `monthly`, `yearly`, `total`, `none`
- **Default behavior**:
  - Cumulative metrics (steps, energy, distance, exercise, flights) default to `daily`
  - Point-in-time metrics (heart-rate, weight, HRV) default to `none` (individual samples)

```bash
# Query pattern: /api/apple-health/metrics/:type?days=N&aggregate=LEVEL

# Examples - Daily aggregation (default for cumulative metrics)
GET /api/apple-health/metrics/steps?days=7
GET /api/apple-health/metrics/active-energy?days=7
GET /api/apple-health/metrics/walking-distance?days=7
GET /api/apple-health/metrics/exercise-minutes?days=7
GET /api/apple-health/metrics/flights-climbed?days=7

# Examples - Individual samples (default for point-in-time metrics)
GET /api/apple-health/metrics/heart-rate?days=1&limit=100
GET /api/apple-health/metrics/body-weight?days=30
GET /api/apple-health/metrics/resting-heart-rate?days=30
GET /api/apple-health/metrics/hrv?days=30

# Examples - Custom aggregation
GET /api/apple-health/metrics/steps?days=30&aggregate=weekly     # Weekly totals
GET /api/apple-health/metrics/steps?days=90&aggregate=monthly    # Monthly totals
GET /api/apple-health/metrics/steps?days=365&aggregate=yearly    # Yearly totals
GET /api/apple-health/metrics/steps?days=365&aggregate=total     # Single total
GET /api/apple-health/metrics/steps?days=7&aggregate=none        # Individual samples

# Sleep analysis with detailed stages
GET /api/apple-health/metrics/sleep?days=7
```

**Response format (aggregated)**:
```json
{
  "success": true,
  "data": {
    "metric_type": "steps",
    "aggregation": "daily",
    "data": [
      {
        "period": "2025-10-30",
        "value": 2303,
        "unit": "count",
        "samples": 160,
        "first_sample": "2025-10-30 07:04:55 +0000",
        "last_sample": "2025-10-30 23:15:05 +0000"
      }
    ],
    "summary": {
      "total": 2303,
      "average_per_period": 2303,
      "periods": 1,
      "date_range": {
        "start": "2025-10-30",
        "end": "2025-10-31"
      }
    }
  }
}
```

### Available Metrics

| Metric Type | API Parameter | Records | Aggregation Default |
|-------------|---------------|---------|-------------------|
| Sleep Analysis | `sleep` | 35,191 | daily |
| Step Count | `steps` | 513,345 | daily |
| Heart Rate | `heart-rate` | 973,630 | none |
| Active Energy | `active-energy` | 1,911,767 | daily |
| Basal Energy | `basal-energy` | 731,444 | daily |
| Walking Distance | `walking-distance` | 635,576 | daily |
| Body Weight | `body-weight` | 8,268 | none |
| Body Fat % | `body-fat` | 7,954 | none |
| BMI | `bmi` | 8,696 | none |
| Exercise Minutes | `exercise-minutes` | 138,136 | daily |
| Flights Climbed | `flights-climbed` | 52,376 | daily |
| Stand Hours | `stand-hours` | 36,818 | daily |
| Stand Time | `stand-time` | 137,263 | daily |
| Resting Heart Rate | `resting-heart-rate` | 2,613 | none |
| Heart Rate Variability | `hrv` | 15,136 | none |
| VO2 Max | `vo2-max` | 1,714 | none |

### Apple Health Auto Export Webhook

Receives automated health data imports from Health Auto Export iOS app (configured for 30-minute sync):

```bash
POST /api/apple-health/auto-export
Content-Type: application/json

{
  "metrics": [
    {
      "type": "step_count",
      "value": 12453,
      "unit": "count",
      "start_date": "2025-10-30T06:00:00Z",
      "end_date": "2025-10-30T23:59:59Z",
      "source": "Apple Watch"
    }
  ]
}
```

### Auto Export Statistics

```bash
GET /api/apple-health/auto-export/stats         # Import statistics
GET /api/apple-health/auto-export/recent?days=7 # Recent imports
```

### Sleep Cycle Import

Import sleep data from Sleep Cycle app CSV exports:

```bash
# Import script
node scripts/import-sleep-cycle.js [csv_path] [api_base_url]

# Example
node scripts/import-sleep-cycle.js ~/Downloads/sleepdata.csv http://localhost:3001

# API endpoint for bulk import
POST /api/sleep-cycle/import
Content-Type: application/json

{
  "data": [
    {
      "sleep_date": "2025-01-04",
      "start_time": "2025-01-04 23:30:00",
      "end_time": "2025-01-05 07:15:00",
      "sleep_quality": 85,
      "time_asleep_sec": 25200,
      "deep_sec": 5400,
      "light_sec": 12600,
      "dream_sec": 7200
    }
  ]
}
```

### Parkrun Endpoints

```bash
GET  /api/parkrun/stats          # All statistics
GET  /api/parkrun/results/:year  # Results for specific year
GET  /api/parkrun/trends         # Performance trends
```

## Integration with Health Agent

The health service is called by the `health-agent` via its REST API. The agent uses environment variables to determine the service URL:

```python
import os
import requests

# Environment-aware service URL
base_url = os.getenv('HEALTH_SERVICE_URL', 'https://health.gavinslater.co.uk')

# Query with aggregation
response = requests.get(f'{base_url}/api/apple-health/metrics/steps?days=7')
steps_data = response.json()['data']
```

**Environment variable configuration:**
- **Production (Pi)**: `HEALTH_SERVICE_URL=http://health-service:3001` (Docker network)
- **Local Mac**: `HEALTH_SERVICE_URL=http://localhost:3001` (development)
- **External**: `HEALTH_SERVICE_URL=https://health.gavinslater.co.uk` (fallback)

## Data Sources

### Apple Health Auto Export
- **iOS App**: Health Auto Export (https://www.healthyapps.dev)
- **Sync Frequency**: Every 30 minutes
- **Webhook URL**: https://health.gavinslater.co.uk/api/apple-health/auto-export
- **Data Range**: 2010 - present
- **Total Records**: 5.3M+ health measurements

### Parkrun
- **Data Source**: Parkrun.org API
- **Authentication**: Username/password via .env file
- **Data**: Personal performance statistics and results

## Database Schema

**Main Tables:**
- `health_metrics` - All Apple Health data (5.3M records)
- `parkrun_results` - Parkrun performance history
- `parkrun_profile` - Parkrun athlete profile
- `health_sync_log` - Import history and statistics
- `apple_health_auto_export` - Auto-export metadata

**Key Fields:**
- `metric_type` - Type of health metric
- `metric_value` - Raw value (original units)
- `metric_value_converted` - Converted value (e.g., kJ → kcal)
- `metric_date` - Timestamp of measurement
- `metric_source` - Data source (Apple Watch, iPhone, etc.)

## Development Notes

### Step Count Special Handling
Step counts prioritize Apple Watch data over iPhone when both sources are available. The API automatically filters to use:
- `health_auto_export` source (real-time sync), OR
- `health_export_complete` source with `additional_data LIKE '%Watch%'`

This prevents double-counting when both devices record steps simultaneously.

### Aggregation Implementation
- Uses `SUBSTR(metric_date, 1, N)` for date extraction (SQLite-compatible with timezone strings)
- Cumulative metrics (steps, energy, distance, exercise, flights) use `SUM()` aggregation
- Point-in-time metrics (heart rate, weight, HRV) use `AVG()` or return individual samples
- All aggregated responses include summary statistics (total, average, period count, date range)

## Repository

- **GitHub**: https://github.com/gavraq/health-service
- **Part of**: Personal AI Infrastructure
- **Related**: health-agent in claude-agent-server

---

**Version**: 3.12
**Last Updated**: 2026-01-05
**Changes**:
- Dashboard V3 with 7-tab interface (Overview, Activity, Heart, Body, Recovery, Workouts, Parkrun)
- 5-ring activity display on Overview (Steps, Move, Exercise, Stand, Sleep)
- 4-ring activity display on Activity tab
- Body composition tracking (Body Fat %, BMI charts)
- Sleep Cycle CSV import integration
- Date picker controls for daily and trend views
- New metrics: basal-energy, body-fat, bmi, stand-hours, stand-time, vo2-max
