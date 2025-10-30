# Health Service

REST API for managing Apple Health data with parkrun integration. Part of Gavin's Personal AI Infrastructure.

## Overview

The Health Service provides a unified API for:
- **Apple Health Data**: 5.3M+ records from Health Auto Export (2010-2025)
- **Parkrun Integration**: Performance tracking and external API access
- **Quantified Self**: Health metrics, trends, and insights

## Architecture

- **Service Type**: Self-hosted custom service
- **Data Storage**: SQLite database (health.db, ~1.9 GB)
- **API Framework**: Node.js + Express
- **Deployment**: Docker container on Raspberry Pi
- **External Access**: https://health.gavinslater.com (via NGINX Proxy Manager)

## Quick Start

### Development (Mac)

\`\`\`bash
# Install dependencies
npm install

# Configure environment
cp .env.template .env
# Edit .env with your settings

# Start development server
npm start
\`\`\`

### Production (Pi Docker)

\`\`\`bash
# Build and start
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs -f health-service

# Stop
docker-compose down
\`\`\`

## API Endpoints

### Health Endpoints

\`\`\`
GET  /health                    # Service health check
GET  /api/health/summary        # Overall health summary
GET  /api/health/metrics/:type  # Specific metric (steps, weight, heart_rate, etc.)
GET  /api/health/trends         # Trend analysis
GET  /api/health/goals          # Goal tracking
\`\`\`

### Apple Health Auto Export Webhook

\`\`\`
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
\`\`\`

### Parkrun Endpoints

\`\`\`
GET  /api/parkrun/profile/:athleteId    # Parkrun profile
GET  /api/parkrun/results/:athleteId    # All parkrun results
GET  /api/parkrun/stats/:athleteId      # Performance statistics
\`\`\`

## Integration with Agent Server

The health service is called by the \`health-agent\` via its API:

\`\`\`typescript
// In claude-agent-server: src/clients/health-client.ts
const response = await fetch(
  \`\${process.env.HEALTH_SERVICE_URL}/api/health/summary?date=\${date}\`
);
const summary = await response.json();
\`\`\`

## Repository

- **GitHub**: https://github.com/gavraq/health-service
- **Part of**: Personal AI Infrastructure

---

**Version**: 1.0
**Last Updated**: 2025-10-30
