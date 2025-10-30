# Health Service Unit Conversion Fix

**Date**: October 13, 2025
**Issue**: Active energy values reported in kilojoules (kJ) but labeled as kilocalories (kcal)
**Impact**: Health metrics showing 2,413 "kcal" when actual value should be 577 kcal (4.2x overreporting)

## Problem Description

The `/api/apple-health/summary` endpoint was returning raw energy values in kilojoules (kJ) from the database without applying the conversion to kilocalories (kcal). This caused health reports to show inflated active energy values.

### Example Issue
- **Reported**: 2,413 kcal for Oct 12, 2025
- **Actual**: 577 kcal for Oct 12, 2025
- **Error**: 2,413 kJ was mislabeled as kcal (conversion factor: 1 kcal = 4.184 kJ)

## Root Cause

The `getAppleHealthSummary()` method in `health-api.js` was:
1. Querying only `metric_value` (raw kJ) from the database
2. Not using the pre-calculated `metric_value_converted` column (kcal)
3. Setting unit to the raw database unit (kJ) instead of converting to kcal

Meanwhile, the `getAppleHealthMetrics()` method was correctly using converted values, creating inconsistency between endpoints.

## Fix Applied

### Changes to `health-api.js`

**Line 449**: Added `metric_value_converted` to SQL query
```javascript
// Before:
SELECT metric_date, metric_type, metric_value, metric_unit, metric_source, additional_data

// After:
SELECT metric_date, metric_type, metric_value, metric_unit, metric_value_converted, metric_source, additional_data
```

**Lines 472-491**: Added energy metric conversion logic
```javascript
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
```

## Verification

### Before Fix
```bash
curl "http://localhost:3001/api/apple-health/summary?days=2"
# Oct 12: 744 samples = 2,413.81 kJ (labeled as kcal) ❌
```

### After Fix
```bash
curl "http://localhost:3001/api/apple-health/summary?days=2"
# Oct 12: 744 samples = 576.9 kcal ✅
```

### Database Verification
```sql
SELECT SUM(metric_value_converted) as total_kcal
FROM health_metrics
WHERE metric_date LIKE '2025-10-12%'
AND metric_type = 'active_energy';
-- Result: 576.915 kcal ✅
```

## Impact

### Fixed Endpoints
- ✅ `GET /api/apple-health/summary?days=N` - Now returns converted kcal values
- ✅ `GET /api/apple-health/daily/:date` - Uses summary endpoint, now fixed

### Already Working
- ✅ `GET /api/apple-health/metrics/active-energy` - Was already using converted values

### Affected Systems
- **Health-agent**: Will now receive correct kcal values when querying summary endpoint
- **Daily-journal-agent**: Morning/evening workflow will show correct active energy metrics
- **Health Dashboard**: Any visualization using the summary endpoint will show accurate data

## Technical Details

### Database Schema
The `health_metrics` table has both columns:
- `metric_value`: Raw value as stored by Health Auto Export (kJ for energy metrics)
- `metric_value_converted`: Converted value calculated during import (kcal for energy metrics)

### Conversion Logic
The conversion is applied during data import by `health-database.js`:
```javascript
if (type === 'active_energy' || type === 'basal_energy_burned') {
  if (unit === 'kJ') {
    convertedValue = value / 4.184;  // 1 kcal = 4.184 kJ
  }
}
```

The summary endpoint now correctly uses these pre-converted values.

## Testing Performed

1. ✅ Verified database has `metric_value_converted` column populated
2. ✅ Confirmed Oct 12 total: 576.9 kcal (matches expected ~577 kcal)
3. ✅ Checked sample values: 0.3650 kcal, 0.4728 kcal (reasonable per-minute values)
4. ✅ Verified unit labels: Now show "kcal" instead of "kJ"
5. ✅ Service restart successful with health check passing

## Follow-up Actions

- [x] Fix implemented and tested
- [x] Service restarted with updated code
- [x] Oct 12 daily note already corrected with accurate values
- [ ] Monitor next morning workflow to ensure correct values propagate
- [ ] Update health-service README if needed

## Related Files

- `/Users/gavinslater/projects/life/health-integration/health-service/src/health-api.js` (lines 438-519)
- `/Users/gavinslater/projects/life/health-integration/health-service/src/health-database.js` (lines 287-298)
- `/Users/gavinslater/Library/Mobile Documents/iCloud~md~obsidian/Documents/GavinsiCloudVault/Calendar/2025/10-October/2025-10-12-Sunday.md`

---

**Status**: ✅ RESOLVED - Health service now correctly returns active energy values in kcal across all endpoints
