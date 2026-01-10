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
| Database | SQLite (`health.db`, ~1.9 GB) |
| Frontend | Vanilla JavaScript + CSS |
| Deployment | Docker container on Raspberry Pi |
| External Access | NGINX Proxy Manager |

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
- Sync: Every 30 minutes

## Change Pipeline

Future enhancements tracked in Obsidian:
- Workouts tab map visualization (requires location-service integration)
- Goals section with configurable targets applied to charts

---

**Last Updated**: 2026-01-10
