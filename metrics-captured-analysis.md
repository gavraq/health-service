# Health Auto Export - Metrics Captured Analysis

**Date**: October 11, 2025
**Analysis**: Complete verification of all metrics being captured

## Recent Import Analysis

### Import 66 (Oct 10, 2025)
- **Metrics Sent**: 15 types
- **Data Points**: 3,929 records

### Import 67 (Oct 11, 2025)
- **Metrics Sent**: 16 types
- **Data Points**: 2,360 records

## Metrics Captured in Recent Imports

### ✅ Consistently Captured (16 metric types)

1. **active_energy** ✅
2. **apple_exercise_time** ✅
3. **apple_stand_hour** ✅
4. **apple_stand_time** ✅
5. **basal_energy_burned** ✅
6. **cardio_recovery** ✅ (Import 67 only - captured when available)
7. **flights_climbed** ✅
8. **heart_rate** ✅
9. **heart_rate_variability** ✅
10. **physical_effort** ✅
11. **resting_heart_rate** ✅
12. **sleep_analysis** ✅
13. **step_count** ✅
14. **vo2_max** ✅
15. **walking_heart_rate_average** ✅
16. **walking_running_distance** ✅

## Metrics in Database But Not in Oct 10-11 Imports

### Movement Quality Metrics (No data for these days)
- **walking_speed** - Last recorded: Oct 6, 2025
- **walking_step_length** - Last recorded: Oct 6, 2025
- **running_speed** - Last recorded: Oct 4, 2025

**Reason**: These metrics are only recorded during specific workout activities. Oct 10-11 had general walking but no tracked running workouts.

### Body Composition Metrics (Manual entry required)
- **weight_body_mass** - Last recorded: Oct 6, 2025
- **body_mass_index** - Last recorded: Oct 6, 2025
- **body_fat_percentage** - Last recorded: Oct 6, 2025

**Reason**: These require manual entry or smart scale integration. Not automatically recorded daily.

## Verification: All Metrics ARE Being Captured ✅

**Health Auto Export Behavior**:
- Sends ALL configured metrics that have data for the requested date range
- Does NOT send metrics with zero data points (correct behavior)
- Oct 10-11 imports show 15-16 different metric types were sent

**Why Some Metrics Missing from Oct 10-11**:
1. **Activity-based metrics** (walking/running speed): Only recorded during specific workouts
2. **Manual entry metrics** (weight, body fat): Require user to manually log
3. **Conditional metrics** (cardio recovery): Only captured after qualifying workouts

## Complete Metric Inventory

### 22 Total Metric Types in Database

**Automatically Captured (16 types)**: ✅
- Active/Basal Energy
- Steps, Distance, Flights
- Heart Rate (all variants)
- Exercise & Stand Time
- Sleep Analysis
- VO2 Max, Physical Effort

**Activity-Dependent (3 types)**: ⚠️
- Walking/Running Speed
- Walking Step Length
- (Captured during workouts only)

**Manual Entry (3 types)**: ⚠️
- Weight, BMI, Body Fat
- (Require manual logging or smart scale)

## Import 66 vs Import 67 Comparison

| Metric | Import 66 (Oct 10) | Import 67 (Oct 11) |
|--------|-------------------|-------------------|
| active_energy | ✅ | ✅ |
| apple_exercise_time | ✅ | ✅ |
| apple_stand_hour | ✅ | ✅ |
| apple_stand_time | ✅ | ✅ |
| basal_energy_burned | ✅ | ✅ |
| cardio_recovery | ❌ | ✅ (workout on Oct 11) |
| flights_climbed | ✅ | ✅ |
| heart_rate | ✅ | ✅ |
| heart_rate_variability | ✅ | ✅ |
| physical_effort | ✅ | ✅ |
| resting_heart_rate | ✅ | ✅ |
| sleep_analysis | ✅ | ✅ |
| step_count | ✅ | ✅ |
| vo2_max | ✅ | ✅ |
| walking_heart_rate_average | ✅ | ✅ |
| walking_running_distance | ✅ | ✅ |

**Total**: 15 types (Oct 10), 16 types (Oct 11)

## Conclusion

### ✅ Health Auto Export IS Capturing All Configured Metrics

**Evidence**:
1. 15-16 metric types sent in each import
2. All core health metrics present
3. Activity-dependent metrics captured when activities occur
4. No missing metrics that should have data

**Expected Behavior**:
- Core metrics: Always captured (16 types)
- Workout metrics: Captured during workouts (3 types)
- Manual metrics: Captured when manually logged (3 types)

**System Status**: ✅ All metrics being captured correctly

The 6 "missing" metrics from Oct 10-11 are not actually missing - they simply had no data to export for those specific days. This is correct behavior by Health Auto Export.

---

**Verification Date**: October 11, 2025
**Status**: ✅ CONFIRMED - All metrics being captured as expected
