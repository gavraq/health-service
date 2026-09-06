# Health Service - Claude Code Context

## Project Overview

REST API and interactive dashboard for managing Apple Health data with Parkrun integration. Part of Gavin's Personal AI Infrastructure.

**Dashboard URL**: https://health.gavinslater.co.uk
**GitHub Repository**: https://github.com/gavraq/health-service
**Version**: 3.12

## Architecture

| Component | Technology |
|-----------|------------|
| Backend | Node.js + Express |
| Database | SQLite (`health.db`, ~6.1 GB as of Sep 2026 — see Auto Export retention below) |
| Frontend | Vanilla JavaScript + CSS |
| Deployment | Docker container on the **Hostinger VPS** (migrated off the Raspberry Pi 2026-08-26). App dir `/home/gavin/apps/health-service`, data bind-mounted from `./data` |
| External Access | **Cloudflare Tunnel** (`cloudflared`, ingress → `localhost:3001`). NGINX Proxy Manager is no longer in the path |

## Auto Export ingest — operational notes (2026-09-06)

The `apple_health_auto_export` table stores every raw payload as a replay log.
The iPhone app can re-send the same window repeatedly, so this table grows far
faster than the data it represents: by 6 Sep 2026 it held 1,073 rows totalling
3.5 GB, essentially the whole database (140 imports / 2.2 GB on 26 Aug alone).

- `pruneAutoExportPayloads()` runs after every successful import and nulls
  payload bodies outside the most recent `AUTO_EXPORT_PAYLOAD_RETENTION` (40).
  Metadata rows are kept forever — tiny, and they are the diagnostic trail.
- Retention is capped by **count, not age**. A time window does not bound size
  when the export cadence misbehaves.
- Nulling reclaims space *inside* the file. Shrinking `health.db` on disk needs
  a `VACUUM`, which takes an exclusive lock — maintenance window only, never in
  the import path.
- The connection sets `busyTimeout` (60s). Without it, overlapping imports
  aborted with `SQLITE_BUSY` and lost the entire payload, which left
  `heart_rate` two days behind every other metric in Sept 2026.

**Phone-side config** is documented in the vault at
`life-vault/docs/services/personal/health-auto-export-config.md` — Date Range,
sync frequency, Summarize Data and the workout-route settings, plus the
Withings → Apple Health weight gaps.

## Project Structure

```
health-service/
├── src/
│   ├── health-api.js        # Main Express server + API routes (entry point)
│   ├── health-database.js   # SQLite database operations
│   ├── parkrun-client.js    # Parkrun.org API integration
│   └── logger.js            # Winston logging config
├── static/
│   ├── index.html           # Dashboard HTML (65KB, all tabs)
│   ├── css/styles.css       # Dashboard styles
│   └── js/dashboard.js      # Dashboard logic + visualizations
├── data/
│   └── health.db            # SQLite database (5.3M+ records)
├── scripts/
│   └── import-sleep-cycle.js # Sleep Cycle CSV importer
├── config/                   # Configuration files
├── docker-compose.yml        # Docker deployment config
├── Dockerfile               # Container build
└── package.json             # Dependencies + scripts
```

## Development Commands

```bash
# Start development server (port 3001)
npm start

# Start with auto-reload
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

**Environment**: Requires `.env` file (copy from `.env.example`):
- `PARKRUN_USERNAME` - Parkrun login
- `PARKRUN_PASSWORD` - Parkrun password
- `PORT` - Server port (default: 3001)

## Deployment Pipeline

**Code Flow**: Local Dev → GitHub → Raspberry Pi (Docker)

### 1. Local Development (Mac)
```bash
# Make changes locally
npm start                          # Test at http://localhost:3001

# Commit and push
git add .
git commit -m "feat: description"
git push origin main
```

### 2. GitHub Repository
- **URL**: https://github.com/gavraq/health-service
- **Branch**: main

### 3. Production Deployment (Raspberry Pi)
```bash
# SSH to Pi, navigate to service directory
cd ~/docker/health-service

# Pull latest changes from GitHub
git pull origin main

# Rebuild and restart Docker container
docker-compose build --no-cache
docker-compose up -d

# Verify deployment
docker-compose ps
docker-compose logs -f health-service
```

### Docker Commands Reference
```bash
docker-compose up -d           # Start in background
docker-compose down            # Stop containers
docker-compose ps              # Check status
docker-compose logs -f         # Follow logs
docker-compose build --no-cache # Force rebuild
```

## API Quick Reference

### Health Check
```
GET /health
```

### Apple Health Metrics
```bash
# Pattern: /api/apple-health/metrics/:type?days=N&aggregate=LEVEL
# Aggregation: daily (default), weekly, monthly, yearly, total, none

GET /api/apple-health/metrics/steps?days=7
GET /api/apple-health/metrics/heart-rate?days=1&limit=100
GET /api/apple-health/metrics/steps?days=30&aggregate=weekly
```

### Available Metrics
| Type | Parameter | Records |
|------|-----------|---------|
| Steps | `steps` | 513K |
| Heart Rate | `heart-rate` | 973K |
| Active Energy | `active-energy` | 1.9M |
| Weight | `body-weight` | 8K |
| Sleep | `sleep` | 35K |
| Exercise | `exercise-minutes` | 138K |
| HRV | `hrv` | 15K |
| VO2 Max | `vo2-max` | 1.7K |

### Parkrun
```bash
GET /api/parkrun/stats
GET /api/parkrun/results?limit=10
GET /api/parkrun/results/:year
GET /api/parkrun/trends
GET /api/parkrun/profile
```

### Data Import
```bash
# Apple Health Auto Export webhook
POST /api/apple-health/auto-export

# Sleep Cycle import
POST /api/sleep-cycle/import
```

## Dashboard Tabs

| Tab | Features |
|-----|----------|
| Overview | 5-ring activity display, quick stats (VO2 Max, HRV, Flights, Distance) |
| Activity | 4-ring display, 8 trend charts (Energy, Steps, Distance, Exercise, Flights, Stand) |
| Heart | Heart rate metrics, HRV trends, VO2 Max tracking |
| Body | Weight trend, Body Fat %, BMI charts |
| Recovery | Sleep analysis with Sleep Cycle integration |
| Workouts | Recent workout history and statistics |
| Parkrun | Terminal-style stats display, Year in Pixels heatmap |

## Key Code Sections

### Main Server (`src/health-api.js`)
- Express routes configuration
- Middleware setup (CORS, Helmet, logging)
- API endpoint handlers
- Static file serving for dashboard

### Database (`src/health-database.js`)
- SQLite connection management
- Metric aggregation queries
- Data import/export functions

### Dashboard (`static/js/dashboard.js`)
- Tab navigation and state management
- API data fetching and caching
- Chart rendering (Chart.js)
- Activity ring visualizations
- Parkrun Year in Pixels heatmap

## Integration Points

### Health Agent
The service is called by `health-agent` via REST API:
```python
HEALTH_SERVICE_URL=https://health.gavinslater.co.uk
```

### Apple Health Auto Export
- iOS App: Health Auto Export
- Webhook: `POST /api/apple-health/auto-export`
- Sync: **every 6 hours**, Date Range "Previous 7 Days", Summarize Data on,
  app-side Timeout Interval 60s (was a fixed window from 16 Jul re-sent every
  ~3 minutes at 20.8 MB — see the operational notes above)

## Change Pipeline

Future enhancements tracked in Obsidian:
- Workouts tab map visualization (requires location-service integration)
- Goals section with configurable targets applied to charts

---

**Last Updated**: 2026-01-10
