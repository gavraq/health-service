# Health Service

REST API for managing Apple Health data with Parkrun integration. Part of Gavin's Personal AI Infrastructure.

## Overview

The Health Service provides a unified API for:
- **Apple Health Data**: 5.3M+ records from Health Auto Export (2010-2025)
- **Parkrun Integration**: Performance tracking and statistics
- **Quantified Self**: Health metrics, trends, and insights with flexible aggregation

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
| Sleep Analysis | `sleep` | 29,931 | daily |
| Step Count | `steps` | 493,525 | daily |
| Heart Rate | `heart-rate` | 938,199 | none |
| Active Energy | `active-energy` | 1,857,143 | daily |
| Walking Distance | `walking-distance` | 615,818 | daily |
| Body Weight | `body-weight` | 4,128 | none |
| Exercise Minutes | `exercise-minutes` | 133,293 | daily |
| Flights Climbed | `flights-climbed` | 51,140 | daily |
| Resting Heart Rate | `resting-heart-rate` | 2,491 | none |
| Heart Rate Variability | `hrv` | 14,654 | none |

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

**Version**: 2.0
**Last Updated**: 2025-10-31
**Changes**: Added comprehensive aggregation support, updated API documentation, clarified integration patterns
