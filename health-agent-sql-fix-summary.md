# Health-Agent SQL Query Fix - October 15, 2025

## Issue Identified

**Problem**: Health-agent was reporting incorrect active energy values in daily notes, showing raw kilojoule (kJ) values instead of kilocalories (kcal).

**Example**:
- Oct 14 reported: 3,126 kcal ❌
- Oct 14 actual: 747 kcal ✅
- Error factor: 4.18x (the kJ to kcal conversion factor)

## Root Cause

The health-agent uses direct SQL queries to the health database via bash commands. The agent's documentation provided example queries using `SUM(metric_value)` which works correctly for most metrics but returns raw kJ values for energy metrics instead of converted kcal values.

### Example Query (WRONG):
```sql
SELECT SUM(metric_value) as total_energy
FROM health_metrics
WHERE metric_type = 'active_energy'
AND metric_date >= '2025-10-14 00:00:00'
AND metric_date < '2025-10-15 00:00:00';
-- Returns: 3,126 kJ ❌
```

### Why This Happened

1. **Database Schema**: The `health_metrics` table has two columns:
   - `metric_value`: Raw value as received from Health Auto Export (kJ for energy)
   - `metric_value_converted`: Converted value (kcal for energy)

2. **API vs Direct SQL**:
   - REST API endpoints were fixed on Oct 13 to use `metric_value_converted`
   - But health-agent bypasses API and queries database directly
   - Agent documentation only showed examples using `metric_value`

3. **Agent Behavior**:
   - Health-agent has Bash tool access
   - Uses sqlite3 commands to aggregate daily totals
   - Followed documentation examples which didn't specify converted column

## Fix Applied

### 1. Updated health-agent.md with Critical Warning

Added prominent warning at top of Data Access Methods section:

```markdown
**⚠️ CRITICAL: Energy Metrics Unit Conversion**
- **ALWAYS use `metric_value_converted` for active_energy and basal_energy_burned**
- Database stores raw kJ in `metric_value`, converted kcal in `metric_value_converted`
- Using `metric_value` for energy gives wrong results (4.2x too high)
- API endpoints automatically return converted values
- Direct SQL queries MUST use `metric_value_converted` column
```

### 2. Added Correct SQL Example

```sql
-- Correct: Use metric_value_converted for energy metrics (kJ → kcal)
SELECT SUM(metric_value_converted) as total_kcal
FROM health_metrics
WHERE metric_type = 'active_energy'
AND metric_date >= '2025-10-14 00:00:00'
AND metric_date < '2025-10-15 00:00:00';
-- Result: 747 kcal ✅

-- WRONG: Using metric_value gives kJ, not kcal
-- SELECT SUM(metric_value) ... → Returns 3,126 kJ (WRONG)
```

### 3. Corrected Oct 14 Daily Note

Updated `/Calendar/2025/10-October/2025-10-14-Tuesday.md`:
- Active Energy: ~~3,126 kcal~~ → 747 kcal ✅
- Weekly Average: ~~2,643 kcal~~ → 632 kcal ✅

## Why Two Separate Fixes Were Needed

### Oct 13: Fixed Health Service API
- Fixed `/api/apple-health/summary` endpoint
- Fixed `/api/apple-health/metrics/active-energy` endpoint
- Modified `getAppleHealthSummary()` and `getAppleHealthMetrics()` methods
- Impact: All API consumers now get correct kcal values

### Oct 15: Fixed Health-Agent Documentation
- Updated health-agent SQL query examples
- Added critical warning about unit conversion
- Impact: Agent will now use correct column in future queries

## Verification

### API Endpoint (Already Fixed Oct 13):
```bash
curl "http://localhost:3001/api/apple-health/summary?days=1"
# Oct 14: 747.1 kcal ✅
```

### Direct SQL Query (Now Documented):
```bash
sqlite3 data/health.db "SELECT SUM(metric_value_converted) FROM health_metrics WHERE metric_type='active_energy' AND metric_date LIKE '2025-10-14%'"
# Result: 747 kcal ✅
```

## Impact

### Files Modified
1. **`/.claude/agents/health-agent.md`**:
   - Added critical warning (lines 67-72)
   - Added correct SQL example (lines 149-161)

2. **`/Calendar/2025/10-October/2025-10-14-Tuesday.md`**:
   - Corrected active energy value (line 83)

### Affected Metrics
- `active_energy` - Active calories burned
- `basal_energy_burned` - Basal/resting energy

All other metrics (steps, heart rate, distance, etc.) use raw `metric_value` correctly.

## Prevention

### For Future Agents
Any agent that queries the health database directly must:
1. Read the critical warning in health-agent.md
2. Use `metric_value_converted` for ALL energy metrics
3. Use `metric_value` for all other metrics (steps, HR, distance, etc.)

### Database Query Checklist
- [ ] Querying active_energy or basal_energy_burned?
- [ ] Using `metric_value_converted` column?
- [ ] Verified results are ~200-800 kcal range (not 1000-3000)?

## Related Documentation

- **API Fix**: `unit-conversion-fix-summary.md` (Oct 13, 2025)
- **Combined Fixes**: `oct-13-fixes-summary.md` (Sleep + Energy API)
- **This Fix**: `health-agent-sql-fix-summary.md` (Oct 15, 2025)

---

**Status**: ✅ FIXED
**Date**: October 15, 2025
**Impact**: Health-agent will now report correct kcal values for all future queries
**Verification**: Next morning workflow (Oct 16) will validate fix
