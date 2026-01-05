/**
 * Health Monitor Dashboard v2.0
 * Tab-Based Biometric Telemetry Dashboard for Apple Health & Parkrun Data
 */

// =============================================================================
// Configuration
// =============================================================================

const API_BASE = '/api';

const CONFIG = {
    refreshInterval: 5 * 60 * 1000, // 5 minutes
    goals: {
        steps: 10000,
        activeMinutes: 30,
        sleepHours: 8,
        targetWeight: 170
    },
    defaults: {
        trendDays: 7,
        weightDays: 90
    }
};

const COLORS = {
    steps: '#10B981',
    stepsLight: '#34D399',
    activity: '#06B6D4',
    activityLight: '#22D3EE',
    heart: '#EF4444',
    heartLight: '#F87171',
    sleep: '#8B5CF6',
    sleepLight: '#A78BFA',
    weight: '#F59E0B',
    weightLight: '#FBBF24',
    grid: 'rgba(148, 163, 184, 0.1)',
    text: '#94A3B8',
    textMuted: '#64748B'
};

// Tab configuration - which date controls to show per tab
const TAB_DATE_CONFIG = {
    overview: { daily: true, trends: true, custom: true },
    activity: { daily: true, trends: true, custom: true },
    heart: { daily: true, trends: true, custom: true },
    body: { daily: true, trends: true, custom: true },
    recovery: { daily: true, trends: true, custom: true },
    workouts: { daily: false, trends: true, custom: true },
    parkrun: { daily: false, trends: false, custom: false }
};

// =============================================================================
// State
// =============================================================================

let charts = {};

let state = {
    activeTab: 'overview',
    // Daily date picker - controls Daily Activity section (summary, ring, etc.)
    selectedDate: new Date(),
    // Trend range - controls charts only
    trendRange: {
        preset: '7D',
        days: 7,
        from: null,
        to: null
    },
    tabDataLoaded: {},
    tabDataCache: {}
};

// =============================================================================
// API Functions
// =============================================================================

async function fetchAPI(endpoint) {
    try {
        console.log(`[API] Fetching: ${API_BASE}${endpoint}`);
        const response = await fetch(`${API_BASE}${endpoint}`);
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        const data = await response.json();
        console.log(`[API] Response for ${endpoint}:`, data?.data?.data?.length || 'N/A', 'records');
        return data;
    } catch (error) {
        console.error(`Failed to fetch ${endpoint}:`, error);
        return null;
    }
}

// =============================================================================
// Tab Navigation
// =============================================================================

function initTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-btn');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });

    // Handle URL state on load
    const urlParams = new URLSearchParams(window.location.search);
    const tabFromUrl = urlParams.get('tab');
    if (tabFromUrl && TAB_DATE_CONFIG[tabFromUrl]) {
        switchTab(tabFromUrl);
    }
}

function switchTab(tabName) {
    // Update state
    state.activeTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    // Update date controls visibility
    updateDateControlsVisibility(tabName);

    // Update URL
    updateURLState();

    // Load tab data if not already loaded
    loadTabData(tabName);
}

function updateDateControlsVisibility(tabName) {
    const config = TAB_DATE_CONFIG[tabName];
    const controls = document.getElementById('date-controls');
    const dailyGroup = document.querySelector('.control-group:first-child');
    const separator = document.querySelector('.control-separator');
    const trendGroup = document.getElementById('trend-controls-group');

    // Show the whole controls bar if either daily or trends are needed
    const showControls = config.daily || config.trends;
    if (controls) {
        controls.style.display = showControls ? 'flex' : 'none';
    }

    // Show/hide daily picker based on tab config
    if (dailyGroup) {
        dailyGroup.style.display = config.daily ? 'flex' : 'none';
    }

    // Show/hide separator (only if both are visible)
    if (separator) {
        separator.style.display = (config.daily && config.trends) ? 'block' : 'none';
    }

    // Show/hide trend controls based on tab config
    if (trendGroup) {
        trendGroup.style.display = config.trends ? 'flex' : 'none';
    }
}

function updateURLState() {
    const params = new URLSearchParams();
    params.set('tab', state.activeTab);

    // Store the selected daily date if not today
    const todayStr = formatDateISO(new Date());
    if (formatDateISO(state.selectedDate) !== todayStr) {
        params.set('date', formatDateISO(state.selectedDate));
    }

    // Store trend range
    if (state.trendRange.preset) {
        params.set('range', state.trendRange.preset);
    } else if (state.trendRange.from && state.trendRange.to) {
        params.set('from', formatDateISO(state.trendRange.from));
        params.set('to', formatDateISO(state.trendRange.to));
    }

    history.replaceState({}, '', `?${params}`);
}

// =============================================================================
// Date Controls
// =============================================================================

function initDateControls() {
    // === DAILY DATE PICKER (controls Daily Activity section) ===
    const dailyDate = document.getElementById('daily-date');
    const prevDay = document.getElementById('prev-day');
    const nextDay = document.getElementById('next-day');
    const todayBtn = document.getElementById('today-btn');

    // Set initial date
    dailyDate.value = formatDateISO(state.selectedDate);
    dailyDate.max = formatDateISO(new Date()); // Prevent future dates

    dailyDate.addEventListener('change', (e) => {
        state.selectedDate = new Date(e.target.value);
        console.log('[DAILY] Date changed to:', formatDateISO(state.selectedDate));
        refreshDailySummary();
    });

    prevDay.addEventListener('click', () => {
        state.selectedDate.setDate(state.selectedDate.getDate() - 1);
        dailyDate.value = formatDateISO(state.selectedDate);
        console.log('[DAILY] Previous day:', formatDateISO(state.selectedDate));
        refreshDailySummary();
    });

    nextDay.addEventListener('click', () => {
        if (state.selectedDate < new Date()) {
            state.selectedDate.setDate(state.selectedDate.getDate() + 1);
            dailyDate.value = formatDateISO(state.selectedDate);
            console.log('[DAILY] Next day:', formatDateISO(state.selectedDate));
            refreshDailySummary();
        }
    });

    todayBtn.addEventListener('click', () => {
        state.selectedDate = new Date();
        dailyDate.value = formatDateISO(state.selectedDate);
        console.log('[DAILY] Reset to today');
        refreshDailySummary();
    });

    // === TREND RANGE CONTROLS (controls charts) ===
    const trendPresets = document.getElementById('trend-presets');
    const rangeFrom = document.getElementById('range-from');
    const rangeTo = document.getElementById('range-to');
    const applyRange = document.getElementById('apply-range');

    // Trend presets
    if (trendPresets) {
        trendPresets.addEventListener('click', (e) => {
            if (e.target.classList.contains('preset-btn')) {
                const days = parseInt(e.target.dataset.days);
                setTrendPreset(days, e.target);
            }
        });
    }

    // Custom range - set default values
    const today = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    if (rangeTo) {
        rangeTo.value = formatDateISO(today);
        rangeTo.max = formatDateISO(today);
    }
    if (rangeFrom) {
        rangeFrom.value = formatDateISO(weekAgo);
    }

    if (applyRange) {
        applyRange.addEventListener('click', () => {
            if (rangeFrom.value && rangeTo.value) {
                const fromDate = new Date(rangeFrom.value);
                const toDate = new Date(rangeTo.value);

                console.log(`[TRENDS] Applying custom range: ${rangeFrom.value} to ${rangeTo.value}`);

                state.trendRange = {
                    preset: null,
                    days: null,
                    from: fromDate,
                    to: toDate
                };

                // Clear preset button active state
                document.querySelectorAll('.preset-btn').forEach(btn => {
                    btn.classList.remove('active');
                });

                console.log('[TRENDS] Range updated, refreshing charts...');
                refreshTrendCharts();
            }
        });
    }
}

function setTrendPreset(days, btnElement) {
    state.trendRange = {
        preset: days === 7 ? '7D' : days === 30 ? '30D' : days === 90 ? '90D' : '1Y',
        days: days,
        from: null,
        to: null
    };

    // Update active button
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    btnElement.classList.add('active');

    console.log(`[TRENDS] Preset changed to ${days}D`);
    refreshTrendCharts();
}

/**
 * Get query params for the selected daily date
 * Used for Daily Activity summary section
 */
function getDailyDateParams() {
    const dateStr = formatDateISO(state.selectedDate);
    return `start_date=${dateStr}&end_date=${dateStr}`;
}

/**
 * Get query params for trend charts
 * Returns 'days=N' for presets or 'start_date=X&end_date=Y' for custom ranges
 */
function getTrendQueryParams(minDays = null) {
    if (state.trendRange.from && state.trendRange.to) {
        // Custom date range
        const startDate = formatDateISO(state.trendRange.from);
        const endDate = formatDateISO(state.trendRange.to);
        return `start_date=${startDate}&end_date=${endDate}`;
    }

    // Preset range - use days parameter
    let days = state.trendRange.days || CONFIG.defaults.trendDays;

    // Apply minimum if specified (e.g., weight needs more history)
    if (minDays && days < minDays) {
        days = minDays;
    }

    return `days=${days}`;
}

/**
 * Refresh daily metrics for the active tab
 */
function refreshDailySummary() {
    console.log('[REFRESH] Refreshing daily data for tab:', state.activeTab, 'date:', formatDateISO(state.selectedDate));

    switch (state.activeTab) {
        case 'overview':
            loadTodaySummary();
            loadQuickStats();
            break;
        case 'activity':
            loadActivityRings();
            break;
        case 'heart':
            loadHeartDailyMetrics();
            break;
        case 'body':
            loadBodyDailyMetrics();
            break;
        case 'recovery':
            loadRecoveryDailyMetrics();
            break;
        // workouts and parkrun don't have daily date picker
    }
}

/**
 * Refresh trend charts for the active tab
 */
function refreshTrendCharts() {
    console.log('[REFRESH] Refreshing trend charts for tab:', state.activeTab, 'params:', getTrendQueryParams());

    switch (state.activeTab) {
        case 'overview':
            loadOverviewCharts();
            break;
        case 'activity':
            loadActivityCharts();
            break;
        case 'heart':
            loadHeartCharts();
            break;
        case 'body':
            loadBodyCharts();
            break;
        case 'recovery':
            loadSleepChart();
            break;
        case 'workouts':
            loadWorkoutsData();
            break;
        // parkrun doesn't have trend charts
    }
}

// =============================================================================
// Tab Data Loading
// =============================================================================

async function loadTabData(tabName) {
    console.log(`Loading data for tab: ${tabName}`);

    switch (tabName) {
        case 'overview':
            await loadOverviewData();
            break;
        case 'activity':
            await loadActivityData();
            break;
        case 'heart':
            await loadHeartData();
            break;
        case 'body':
            await loadBodyData();
            break;
        case 'recovery':
            await loadRecoveryData();
            break;
        case 'workouts':
            await loadWorkoutsData();
            break;
        case 'parkrun':
            await loadParkrunData();
            break;
    }

    state.tabDataLoaded[tabName] = true;
}

function refreshActiveTab() {
    console.log('[REFRESH] Refreshing active tab:', state.activeTab);
    state.tabDataLoaded[state.activeTab] = false;
    loadTabData(state.activeTab);
}

// =============================================================================
// Overview Tab
// =============================================================================

async function loadOverviewData() {
    await Promise.all([
        loadTodaySummary(),
        loadQuickStats(),
        loadOverviewCharts()
    ]);
}

async function loadTodaySummary() {
    // Use the selected date from daily picker (single day)
    const dailyParams = getDailyDateParams();
    const selectedDateStr = formatDateISO(state.selectedDate);
    const isToday = selectedDateStr === formatDateISO(new Date());

    console.log('[SUMMARY] Loading data for:', selectedDateStr, isToday ? '(Today)' : '');

    const [stepsData, activeEnergyData, exerciseData, standHoursData, sleepData, hrData, weightData] = await Promise.all([
        fetchAPI(`/apple-health/metrics/steps?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/active-energy?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/exercise-minutes?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/stand-hours?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/sleep?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/resting-heart-rate?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/body-weight?aggregate=daily&${dailyParams}`)
    ]);

    // Get single day values for 5-ring display
    const stepsToday = stepsData?.success && stepsData.data?.data?.[0]?.value || 0;
    const activeEnergy = activeEnergyData?.success && activeEnergyData.data?.data?.[0]?.value || 0;
    const exerciseMinutes = exerciseData?.success && exerciseData.data?.data?.[0]?.value || 0;
    const standHours = standHoursData?.success && standHoursData.data?.data?.[0]?.value || 0;
    const sleepHours = sleepData?.success && sleepData.data?.data?.[0]?.value || 0;
    const restingHR = hrData?.success && hrData.data?.data?.[0]?.value || 0;

    const KG_TO_LBS = 2.20462;
    const weightKg = weightData?.success && weightData.data?.data?.[0]?.value || 0;
    const weight = weightKg * KG_TO_LBS;

    console.log(`[SUMMARY] Values: Steps=${stepsToday}, Move=${activeEnergy}kcal, Exercise=${exerciseMinutes}min, Stand=${standHours}h, Sleep=${sleepHours.toFixed(1)}h`);

    // Update the date badge
    const ringDateBadge = document.getElementById('ring-date');
    if (ringDateBadge) {
        ringDateBadge.textContent = isToday ? 'Today' : formatDateShort(selectedDateStr);
    }

    // Update metric cards
    updateElement('metric-steps', Math.round(stepsToday).toLocaleString());
    updateElement('metric-active', Math.round(exerciseMinutes));
    updateElement('metric-hr', Math.round(restingHR));
    updateElement('metric-weight', weight > 0 ? weight.toFixed(1) : '--');

    // Update progress bar
    const stepsPercent = stepsToday / CONFIG.goals.steps;
    const progressEl = document.getElementById('progress-steps');
    if (progressEl) {
        progressEl.style.width = `${Math.min(stepsPercent * 100, 100)}%`;
    }

    // Update legend values for 5 rings
    const stepsK = stepsToday >= 1000 ? `${(stepsToday / 1000).toFixed(1)}K` : Math.round(stepsToday);
    updateElement('legend-steps', `${stepsK}/10K`);
    updateElement('legend-move', `${Math.round(activeEnergy)}/500`);
    updateElement('legend-exercise', `${Math.round(exerciseMinutes)}/40m`);
    updateElement('legend-stand', `${Math.round(standHours)}/12h`);
    updateElement('legend-sleep', `${formatHoursMinutes(sleepHours)}/8h`);

    // Update activity ring (5 rings: Steps, Move, Exercise, Stand, Sleep)
    const movePercent = activeEnergy / 500;  // 500 kcal goal
    const exercisePercent = exerciseMinutes / 40;  // 40 min goal
    const standPercent = standHours / 12;  // 12 hours goal
    const sleepPercent = sleepHours / CONFIG.goals.sleepHours;
    updateActivityRing(stepsPercent, movePercent, exercisePercent, standPercent, sleepPercent);

    // Update current weight in various places
    updateElement('current-weight', weight > 0 ? weight.toFixed(1) : '--');

    // Update sync time
    updateElement('sync-time', new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
    }));
}

async function loadQuickStats() {
    const dailyParams = getDailyDateParams();

    const [vo2Data, hrvData, flightsData, distanceData] = await Promise.all([
        // VO2 Max - use days=30 as it's a weekly metric, not daily
        fetchAPI('/apple-health/metrics/vo2-max?aggregate=daily&days=30'),
        // HRV, Flights, Distance - use selected date
        fetchAPI(`/apple-health/metrics/hrv?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/flights-climbed?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/walking-distance?aggregate=daily&${dailyParams}`)
    ]);

    // Get most recent values
    const vo2Max = vo2Data?.success && vo2Data.data?.data?.[0]?.value;
    const hrv = hrvData?.success && hrvData.data?.data?.[0]?.value;
    const flights = flightsData?.success && flightsData.data?.data?.[0]?.value;
    const distance = distanceData?.success && distanceData.data?.data?.[0]?.value;

    updateElement('quick-vo2max', vo2Max ? vo2Max.toFixed(1) : '--');
    updateElement('quick-hrv', hrv ? Math.round(hrv) : '--');
    updateElement('quick-flights', flights ? Math.round(flights) : '--');
    updateElement('quick-distance', distance ? distance.toFixed(1) : '--');
}

async function loadOverviewCharts() {
    const trendParams = getTrendQueryParams();
    const weightParams = getTrendQueryParams(30); // Weight needs more history

    console.log('[CHARTS] Loading trends with params:', trendParams);

    const [stepsData, weightData] = await Promise.all([
        fetchAPI(`/apple-health/metrics/steps?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/body-weight?${weightParams}&aggregate=none`)
    ]);

    // Steps chart
    if (stepsData?.success && stepsData.data?.data) {
        const chartData = stepsData.data.data.map(d => ({
            x: d.period,
            y: d.value
        })).reverse();

        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('overview-steps-avg', `Avg: ${Math.round(avg).toLocaleString()}`);

        renderBarChart('overviewStepsChart', chartData, COLORS.steps, CONFIG.goals.steps);
    }

    // Weight chart
    if (weightData?.success && weightData.data?.data?.length) {
        const KG_TO_LBS = 2.20462;
        const chartData = weightData.data.data.map(d => ({
            x: d.recorded_date.split(' ')[0],
            y: d.value * KG_TO_LBS
        })).reverse();

        const current = chartData[chartData.length - 1]?.y;
        updateElement('overview-weight-current', `Current: ${current ? current.toFixed(1) : '--'}`);

        renderWeightChart('overviewWeightChart', chartData);
    }
}

// =============================================================================
// Activity Tab
// =============================================================================

async function loadActivityData() {
    await Promise.all([
        loadActivityRings(),
        loadActivityCharts()
    ]);
}

async function loadActivityRings() {
    // Load selected date's metrics for the 4 activity rings
    const dailyParams = getDailyDateParams();
    const [stepsData, activeEnergyData, exerciseData, standHrsData] = await Promise.all([
        fetchAPI(`/apple-health/metrics/steps?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/active-energy?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/exercise-minutes?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/stand-hours?aggregate=daily&${dailyParams}`)
    ]);

    const steps = stepsData?.success && stepsData.data?.data?.[0]?.value || 0;
    const activeEnergy = activeEnergyData?.success && activeEnergyData.data?.data?.[0]?.value || 0;
    const exercise = exerciseData?.success && exerciseData.data?.data?.[0]?.value || 0;
    const standHrs = standHrsData?.success && standHrsData.data?.data?.[0]?.value || 0;

    // Update ring values (Activity tab uses 'activity-ring-' prefix)
    updateElement('activity-ring-steps-value', Math.round(steps).toLocaleString());
    updateElement('activity-ring-move-value', Math.round(activeEnergy).toLocaleString());
    updateElement('activity-ring-exercise-value', Math.round(exercise));
    updateElement('activity-ring-stand-value', Math.round(standHrs));

    // Update ring progress (SVG stroke-dashoffset)
    // Ring circumferences: steps=565.5, move=452.4, exercise=339.3, stand=226.2
    const stepsProgress = Math.min(steps / 10000, 1);  // 10K goal
    const moveProgress = Math.min(activeEnergy / 500, 1);  // 500 kcal goal
    const exerciseProgress = Math.min(exercise / 40, 1);  // 40 min goal
    const standProgress = Math.min(standHrs / 12, 1);  // 12 hrs goal

    const stepsRing = document.getElementById('activity-ring-steps');
    const moveRing = document.getElementById('activity-ring-move');
    const exerciseRing = document.getElementById('activity-ring-exercise');
    const standRing = document.getElementById('activity-ring-stand');

    if (stepsRing) stepsRing.style.strokeDashoffset = 565.5 * (1 - stepsProgress);
    if (moveRing) moveRing.style.strokeDashoffset = 452.4 * (1 - moveProgress);
    if (exerciseRing) exerciseRing.style.strokeDashoffset = 339.3 * (1 - exerciseProgress);
    if (standRing) standRing.style.strokeDashoffset = 226.2 * (1 - standProgress);
}

async function loadActivityCharts() {
    const trendParams = getTrendQueryParams();

    // Fetch all 8 metrics for trend charts
    const [stepsData, distanceData, flightsData, activeEnergyData,
           restingEnergyData, exerciseData, standMinData, standHrsData] = await Promise.all([
        fetchAPI(`/apple-health/metrics/steps?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/walking-distance?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/flights-climbed?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/active-energy?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/basal-energy?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/exercise-minutes?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/stand-time?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/stand-hours?aggregate=daily&${trendParams}`)
    ]);

    // Active Energy chart
    if (activeEnergyData?.success && activeEnergyData.data?.data) {
        const chartData = activeEnergyData.data.data.map(d => ({ x: d.period, y: Math.round(d.value) })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('active-energy-avg', `Avg: ${Math.round(avg)} kcal`);
        renderLineChart('activeEnergyChart', chartData, '#EF4444', 'kcal');
    }

    // Resting Energy chart
    if (restingEnergyData?.success && restingEnergyData.data?.data) {
        const chartData = restingEnergyData.data.data.map(d => ({ x: d.period, y: Math.round(d.value) })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('resting-energy-avg', `Avg: ${Math.round(avg)} kcal`);
        renderBarChart('restingEnergyChart', chartData, '#F97316', null);
    }

    // Steps chart
    if (stepsData?.success && stepsData.data?.data) {
        const chartData = stepsData.data.data.map(d => ({ x: d.period, y: d.value })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('steps-avg', `Avg: ${Math.round(avg).toLocaleString()}`);
        renderBarChart('stepsChart', chartData, COLORS.steps, CONFIG.goals.steps);
    }

    // Distance chart
    if (distanceData?.success && distanceData.data?.data) {
        const chartData = distanceData.data.data.map(d => ({ x: d.period, y: d.value })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('distance-avg', `Avg: ${avg.toFixed(1)} km`);
        renderLineChart('distanceChart', chartData, COLORS.activity, 'km');
    }

    // Exercise Minutes chart
    if (exerciseData?.success && exerciseData.data?.data) {
        const chartData = exerciseData.data.data.map(d => ({ x: d.period, y: Math.round(d.value) })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('exercise-avg', `Avg: ${Math.round(avg)} min`);
        renderBarChart('exerciseChart', chartData, '#84CC16', 40);  // 40 min goal
    }

    // Flights chart
    if (flightsData?.success && flightsData.data?.data) {
        const chartData = flightsData.data.data.map(d => ({ x: d.period, y: d.value })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('flights-avg', `Avg: ${Math.round(avg)}`);
        renderBarChart('flightsChart', chartData, COLORS.sleep, null);
    }

    // Stand Minutes chart
    if (standMinData?.success && standMinData.data?.data) {
        const chartData = standMinData.data.data.map(d => ({ x: d.period, y: Math.round(d.value) })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('stand-min-avg', `Avg: ${Math.round(avg)} min`);
        renderLineChart('standMinChart', chartData, '#06B6D4', 'min');
    }

    // Stand Hours chart
    if (standHrsData?.success && standHrsData.data?.data) {
        const chartData = standHrsData.data.data.map(d => ({ x: d.period, y: d.value })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('stand-hrs-avg', `Avg: ${avg.toFixed(1)} hrs`);
        renderBarChart('standHrsChart', chartData, '#06B6D4', 12);  // 12 hr goal
    }
}

// =============================================================================
// Heart Tab
// =============================================================================

async function loadHeartData() {
    await Promise.all([
        loadHeartDailyMetrics(),
        loadHeartCharts()
    ]);
}

async function loadHeartDailyMetrics() {
    // Load selected date's metrics
    const dailyParams = getDailyDateParams();
    const [restingHrData, hrvData, vo2Data] = await Promise.all([
        fetchAPI(`/apple-health/metrics/resting-heart-rate?aggregate=daily&${dailyParams}`),
        fetchAPI(`/apple-health/metrics/hrv?aggregate=daily&${dailyParams}`),
        // VO2 Max is measured weekly, not daily - use recent value
        fetchAPI('/apple-health/metrics/vo2-max?aggregate=daily&days=30')
    ]);

    const restingHr = restingHrData?.success && restingHrData.data?.data?.[0]?.value || 0;
    const hrv = hrvData?.success && hrvData.data?.data?.[0]?.value || 0;
    const vo2 = vo2Data?.success && vo2Data.data?.data?.[0]?.value || 0;

    updateElement('heart-resting', Math.round(restingHr));
    updateElement('heart-hrv', Math.round(hrv));
    updateElement('heart-vo2', vo2.toFixed(1));
}

async function loadHeartCharts() {
    const trendParams = getTrendQueryParams();
    const vo2Params = getTrendQueryParams(30); // VO2 Max needs more history

    const [hrData, hrvData, restingHrData, vo2Data] = await Promise.all([
        fetchAPI(`/apple-health/metrics/heart-rate?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/hrv?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/resting-heart-rate?aggregate=daily&${trendParams}`),
        fetchAPI(`/apple-health/metrics/vo2-max?aggregate=daily&${vo2Params}`)
    ]);

    // Heart rate chart with min/max bands
    if (hrData?.success && hrData.data?.data) {
        const chartData = hrData.data.data.map(d => ({
            x: d.period,
            min: d.additional?.min || d.value * 0.85,
            avg: d.value,
            max: d.additional?.max || d.value * 1.15
        })).reverse();
        renderHeartRateChart(chartData);
    }

    // HRV chart
    if (hrvData?.success && hrvData.data?.data) {
        const chartData = hrvData.data.data.map(d => ({ x: d.period, y: d.value })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('hrv-avg', `Avg: ${Math.round(avg)} ms`);
        renderLineChart('hrvChart', chartData, COLORS.activity, 'ms');
    }

    // Resting HR trend
    if (restingHrData?.success && restingHrData.data?.data) {
        const chartData = restingHrData.data.data.map(d => ({ x: d.period, y: d.value })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('resting-hr-avg', `Avg: ${Math.round(avg)} bpm`);
        renderLineChart('restingHrChart', chartData, COLORS.heart, 'bpm');
    }

    // VO2 Max trend
    if (vo2Data?.success && vo2Data.data?.data) {
        const chartData = vo2Data.data.data.map(d => ({ x: d.period, y: d.value })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('vo2-avg', `Avg: ${avg.toFixed(1)}`);
        renderLineChart('vo2Chart', chartData, COLORS.steps, 'mL/kg/min');
    }
}

// =============================================================================
// Body Tab
// =============================================================================

async function loadBodyData() {
    await Promise.all([
        loadBodyDailyMetrics(),
        loadBodyCharts()
    ]);
}

async function loadBodyDailyMetrics() {
    // Load selected date's metrics using daily date picker
    const dailyParams = getDailyDateParams();
    const [weightData, bodyFatData, bmiData] = await Promise.all([
        // Body composition uses aggregate=none since there's typically one measurement per day
        fetchAPI(`/apple-health/metrics/body-weight?${dailyParams}&aggregate=none`),
        fetchAPI(`/apple-health/metrics/body-fat?${dailyParams}&aggregate=none`),
        fetchAPI(`/apple-health/metrics/bmi?${dailyParams}&aggregate=none`)
    ]);

    const KG_TO_LBS = 2.20462;

    // Get value for selected date (first result if exists)
    const weightKg = weightData?.success && weightData.data?.data?.[0]?.value || 0;
    const weight = weightKg * KG_TO_LBS;
    const bodyFat = bodyFatData?.success && bodyFatData.data?.data?.[0]?.value || 0;
    const bmi = bmiData?.success && bmiData.data?.data?.[0]?.value || 0;

    updateElement('body-weight', weight > 0 ? weight.toFixed(1) : '--');
    updateElement('body-fat-pct', bodyFat > 0 ? bodyFat.toFixed(1) : '--');
    updateElement('body-bmi', bmi > 0 ? bmi.toFixed(1) : '--');
    updateElement('current-weight', weight > 0 ? weight.toFixed(1) : '--');
}

async function loadBodyCharts() {
    const weightParams = getTrendQueryParams(90); // Weight/body composition needs more history

    const [weightData, bodyFatData, bmiData] = await Promise.all([
        fetchAPI(`/apple-health/metrics/body-weight?${weightParams}&aggregate=none`),
        fetchAPI(`/apple-health/metrics/body-fat?${weightParams}&aggregate=none`),
        fetchAPI(`/apple-health/metrics/bmi?${weightParams}&aggregate=none`)
    ]);

    // Weight chart
    if (weightData?.success && weightData.data?.data?.length) {
        const KG_TO_LBS = 2.20462;
        const chartData = weightData.data.data.map(d => ({
            x: d.recorded_date.split(' ')[0],
            y: d.value * KG_TO_LBS
        })).reverse();
        renderWeightChart('weightChart', chartData);
    }

    // Body Fat % chart - don't start at zero for better visualization
    if (bodyFatData?.success && bodyFatData.data?.data?.length) {
        const chartData = bodyFatData.data.data.map(d => ({
            x: d.recorded_date.split(' ')[0],
            y: parseFloat(d.value.toFixed(1))
        })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('body-fat-avg', `Avg: ${avg.toFixed(1)}%`);
        renderLineChart('bodyFatChart', chartData, '#EC4899', '%', { beginAtZero: false });
    }

    // BMI chart - don't start at zero for better visualization
    if (bmiData?.success && bmiData.data?.data?.length) {
        const chartData = bmiData.data.data.map(d => ({
            x: d.recorded_date.split(' ')[0],
            y: parseFloat(d.value.toFixed(1))
        })).reverse();
        const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
        updateElement('body-bmi-avg', `Avg: ${avg.toFixed(1)}`);
        renderLineChart('bmiChart', chartData, '#6366F1', 'kg/m²', { beginAtZero: false });
    }
}

// =============================================================================
// Recovery Tab (Sleep)
// =============================================================================

async function loadRecoveryData() {
    await Promise.all([
        loadRecoveryDailyMetrics(),
        loadSleepChart()
    ]);
}

async function loadRecoveryDailyMetrics() {
    // Load selected date's sleep - use non-aggregated to get sleep stages from main session
    const dailyParams = getDailyDateParams();
    const selectedDateStr = formatDateISO(state.selectedDate);

    // Fetch both Health Auto Export data and Sleep Cycle CSV data in parallel
    const [sleepData, sleepCycleData] = await Promise.all([
        fetchAPI(`/apple-health/metrics/sleep?aggregate=none&${dailyParams}`),
        fetchAPI(`/sleep-cycle/date/${selectedDateStr}`)
    ]);

    if (sleepData?.success && sleepData.data?.data?.length > 0) {
        // Find the record with maximum duration (main sleep session)
        // Health Auto Export creates multiple overlapping records per sleep session
        const mainSession = sleepData.data.data.reduce((max, d) =>
            (d.value > max.value) ? d : max
        );

        const total = mainSession.value;
        const additional = mainSession.additional || {};

        // Extract values
        const deep = additional.deep || 0;
        const rem = additional.rem || 0;
        const core = additional.core || 0;
        const awake = additional.awake || 0;
        const inBed = additional.inBed || (total + awake);

        // Calculate sleep efficiency from Health Auto Export
        const efficiency = inBed > 0 ? Math.round((total / inBed) * 100) : 0;

        // Update efficiency stat (Health Auto Export calculation)
        updateElement('sleep-efficiency', `${efficiency}%`);

        // Quality ring will be updated by Sleep Cycle data if available
        // Otherwise show efficiency as fallback
        updateElement('sleep-quality', `${efficiency}%`);
        const qualityRing = document.getElementById('quality-ring');
        if (qualityRing) {
            const circumference = 326.73; // 2 * PI * 52
            const offset = circumference - (efficiency / 100) * circumference;
            qualityRing.style.strokeDashoffset = offset;
        }

        // Update time values
        updateElement('sleep-inbed', formatHoursMinutes(inBed));
        updateElement('sleep-total', formatHoursMinutes(total));

        // Update sleep schedule times
        if (additional.inBedStart) {
            const startTime = new Date(additional.inBedStart);
            updateElement('sleep-start-time', startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
            updateElement('stages-start', startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
        }
        if (additional.inBedEnd || additional.sleepEnd) {
            const endTime = new Date(additional.inBedEnd || additional.sleepEnd);
            updateElement('sleep-end-time', endTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
            updateElement('stages-end', endTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
        }

        // Update sleep stages breakdown
        updateElement('sleep-awake', formatHoursMinutes(awake));
        updateElement('sleep-rem', formatHoursMinutes(rem));
        updateElement('sleep-core', formatHoursMinutes(core));
        updateElement('sleep-deep', formatHoursMinutes(deep));

        // Update stacked bar chart
        const totalTime = awake + rem + core + deep;
        if (totalTime > 0) {
            const awakePercent = (awake / totalTime) * 100;
            const remPercent = (rem / totalTime) * 100;
            const corePercent = (core / totalTime) * 100;
            const deepPercent = (deep / totalTime) * 100;

            document.getElementById('bar-awake')?.style.setProperty('width', `${awakePercent}%`);
            document.getElementById('bar-rem')?.style.setProperty('width', `${remPercent}%`);
            document.getElementById('bar-light')?.style.setProperty('width', `${corePercent}%`);
            document.getElementById('bar-deep')?.style.setProperty('width', `${deepPercent}%`);
        }

        // Calculate sleep latency (time to fall asleep)
        // Check main session first, then look at other records if timestamps are same
        let latencyMinutes = 0;
        if (additional.inBedStart && additional.sleepStart) {
            const inBedTime = new Date(additional.inBedStart);
            const sleepTime = new Date(additional.sleepStart);
            latencyMinutes = Math.round((sleepTime - inBedTime) / 60000);
        }

        // If main session has 0 latency, check other records for different timestamps
        if (latencyMinutes <= 0 && sleepData.data.data.length > 1) {
            for (const record of sleepData.data.data) {
                const recAdd = record.additional || {};
                if (recAdd.inBedStart && recAdd.sleepStart) {
                    const inBedTime = new Date(recAdd.inBedStart);
                    const sleepTime = new Date(recAdd.sleepStart);
                    const recLatency = Math.round((sleepTime - inBedTime) / 60000);
                    // Use this latency if it's positive and reasonable (< 90 min)
                    if (recLatency > 0 && recLatency < 90) {
                        latencyMinutes = recLatency;
                        break;
                    }
                }
            }
        }

        updateElement('sleep-latency', latencyMinutes > 0 ? `${latencyMinutes} min` : 'N/A');

    } else {
        // No data - reset all fields
        updateElement('sleep-quality', '--%');
        updateElement('sleep-inbed', '--');
        updateElement('sleep-total', '--');
        updateElement('sleep-start-time', '--:--');
        updateElement('sleep-end-time', '--:--');
        updateElement('stages-start', '--:--');
        updateElement('stages-end', '--:--');
        updateElement('sleep-awake', '--');
        updateElement('sleep-rem', '--');
        updateElement('sleep-core', '--');
        updateElement('sleep-deep', '--');
        updateElement('sleep-efficiency', '--%');
        updateElement('sleep-latency', '--');

        // Reset bar chart
        document.getElementById('bar-awake')?.style.setProperty('width', '0%');
        document.getElementById('bar-rem')?.style.setProperty('width', '0%');
        document.getElementById('bar-light')?.style.setProperty('width', '0%');
        document.getElementById('bar-deep')?.style.setProperty('width', '0%');

        // Reset quality ring
        const qualityRing = document.getElementById('quality-ring');
        if (qualityRing) {
            qualityRing.style.strokeDashoffset = 326.73;
        }
    }

    // Handle Sleep Cycle CSV data
    const scSection = document.getElementById('sleep-cycle-section');
    if (sleepCycleData?.success && sleepCycleData.data) {
        const sc = sleepCycleData.data;

        // Show the Sleep Cycle section
        if (scSection) {
            scSection.style.display = 'block';
            scSection.style.opacity = '1';
        }

        // Override quality and latency with Sleep Cycle values if available
        if (sc.sleep_quality) {
            updateElement('sleep-quality', `${sc.sleep_quality}%`);
            const qualityRing = document.getElementById('quality-ring');
            if (qualityRing) {
                const circumference = 326.73;
                const offset = circumference - (sc.sleep_quality / 100) * circumference;
                qualityRing.style.strokeDashoffset = offset;
            }
        }

        // Update regularity
        updateElement('sleep-regularity', sc.regularity ? `${sc.regularity}%` : '--%');

        // Update latency from Sleep Cycle (more accurate than Health Auto Export)
        if (sc.time_before_sleep_sec && sc.time_before_sleep_sec > 0) {
            const latencyMin = Math.round(sc.time_before_sleep_sec / 60);
            updateElement('sleep-latency', `${latencyMin} min`);
        }

        // Update extended stats
        updateElement('sc-movements', sc.movements_per_hour ? sc.movements_per_hour.toFixed(1) : '--');
        updateElement('sc-snore', sc.snore_time_sec ? Math.round(sc.snore_time_sec / 60) : '--');
        updateElement('sc-respiratory', sc.respiratory_rate ? sc.respiratory_rate.toFixed(1) : '--');
        updateElement('sc-disruptions', sc.breathing_disruptions ? sc.breathing_disruptions.toFixed(1) : '--');
        updateElement('sc-coughs', sc.coughs_per_hour ? sc.coughs_per_hour.toFixed(1) : '--');
        updateElement('sc-noise', sc.ambient_noise_db ? Math.round(sc.ambient_noise_db) : '--');

        // Update environment
        updateElement('sc-temp', sc.weather_temp_c ? `${Math.round(sc.weather_temp_c)}°C` : '--');
        updateElement('sc-weather', sc.weather_type || '--');
        updateElement('sc-location', sc.city || '--');

        // Update notes
        const notesContainer = document.getElementById('sc-notes-container');
        if (sc.notes && notesContainer) {
            updateElement('sc-notes', sc.notes);
            notesContainer.style.display = 'block';
        } else if (notesContainer) {
            notesContainer.style.display = 'none';
        }
    } else {
        // Show Sleep Cycle section with "no data" state
        if (scSection) {
            scSection.style.display = 'block';
            scSection.style.opacity = '0.5';
        }
        updateElement('sleep-regularity', '--%');
        updateElement('sc-movements', '--');
        updateElement('sc-snore', '--');
        updateElement('sc-respiratory', '--');
        updateElement('sc-disruptions', '--');
        updateElement('sc-coughs', '--');
        updateElement('sc-noise', '--');
        updateElement('sc-temp', '--');
        updateElement('sc-weather', '--');
        updateElement('sc-location', '--');
        const notesContainer = document.getElementById('sc-notes-container');
        if (notesContainer) notesContainer.style.display = 'none';
    }
}

async function loadSleepChart() {
    const trendParams = getTrendQueryParams();
    const data = await fetchAPI(`/apple-health/metrics/sleep?aggregate=daily&${trendParams}`);
    if (!data?.success || !data.data?.data) return;

    const chartData = data.data.data.map(d => {
        const total = d.value;
        const additional = d.additional || {};
        return {
            x: d.period,
            deep: additional.deep || total * 0.2,
            core: additional.core || total * 0.5,
            rem: additional.rem || total * 0.2,
            awake: additional.awake || total * 0.1,
            total: total
        };
    }).reverse();

    const avgTotal = chartData.reduce((sum, d) => sum + d.total, 0) / chartData.length;
    updateElement('sleep-avg', `Avg: ${formatHoursMinutes(avgTotal)}`);

    renderSleepChart(chartData);
}

// =============================================================================
// Workouts Tab
// =============================================================================

async function loadWorkoutsData() {
    const trendParams = getTrendQueryParams();

    const data = await fetchAPI(`/apple-health/workouts?${trendParams}&limit=50`);

    if (data?.success && data.data) {
        const workouts = data.data.workouts || [];
        const summary = data.data.summary || {};

        // Update summary cards
        updateElement('workout-count', summary.totalWorkouts || workouts.length);
        updateElement('workout-time', Math.round((summary.totalDuration || 0) / 60)); // Convert seconds to minutes
        updateElement('workout-distance', (summary.totalDistance || 0).toFixed(1));

        // Render table
        renderWorkoutsTable(workouts);
    } else {
        document.getElementById('workouts-table-body').innerHTML =
            '<tr><td colspan="5" class="loading-row">No workouts found</td></tr>';
    }
}

function renderWorkoutsTable(workouts) {
    const tbody = document.getElementById('workouts-table-body');

    if (!workouts || workouts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-row">No workouts found</td></tr>';
        return;
    }

    tbody.innerHTML = workouts.map(w => `
        <tr>
            <td>${formatDate(w.date)}</td>
            <td class="workout-type">${w.type}</td>
            <td>${w.durationFormatted || '--'}</td>
            <td>${w.distance ? w.distance.toFixed(2) + ' ' + (w.distanceUnit || 'km') : '--'}</td>
            <td>${w.avgPaceFormatted ? w.avgPaceFormatted + ' /km' : '--'}</td>
        </tr>
    `).join('');
}

// =============================================================================
// Parkrun Tab
// =============================================================================

async function loadParkrunData() {
    const [profileData, statsData, recentData] = await Promise.all([
        fetchAPI('/parkrun/profile'),
        fetchAPI('/parkrun/stats'),
        fetchAPI('/parkrun/results?limit=5')
    ]);

    // Update profile
    const profileEl = document.getElementById('parkrun-profile');
    if (profileData?.success && profileData.data) {
        const p = profileData.data;
        profileEl.innerHTML = `
            <span class="term-stat"><span class="term-stat-label">Athlete:</span> <span class="term-stat-value">${p.firstName || 'Unknown'} ${p.lastName || ''}</span></span>
            <span class="term-stat"><span class="term-stat-label">Club:</span> <span class="term-stat-value">${p.clubName || 'None'}</span></span>
            <span class="term-stat"><span class="term-stat-label">Home Run:</span> <span class="term-stat-value">${p.homeRun || 'Bushy parkrun'}</span></span>
        `;
    } else {
        profileEl.innerHTML = '<span style="color: var(--text-muted)">Profile unavailable</span>';
    }

    // Update stats
    const statsEl = document.getElementById('parkrun-stats');
    if (statsData?.success && statsData.data) {
        const profile = statsData.data.profile || {};
        const perf = statsData.data.performance || {};
        const totalRuns = perf.totalRuns || profile.totalRuns || 0;
        const ageGrade = perf.averageAgeGrade ? `${perf.averageAgeGrade}%` : '--';

        statsEl.innerHTML = `
            <span class="term-stat"><span class="term-stat-label">Total Runs:</span> <span class="term-stat-value">${totalRuns}</span></span>
            <span class="term-stat"><span class="term-stat-label">PB:</span> <span class="term-stat-value">${perf.fastestTime || '--:--'}</span></span>
            <span class="term-stat"><span class="term-stat-label">Avg Time:</span> <span class="term-stat-value">${perf.averageTime || '--:--'}</span></span>
            <span class="term-stat"><span class="term-stat-label">Age Grade:</span> <span class="term-stat-value">${ageGrade}</span></span>
            <span class="term-stat"><span class="term-stat-label">Venues:</span> <span class="term-stat-value">${Object.keys(statsData.data.venues || {}).length}</span></span>
        `;

        // Update cards
        updateElement('parkrun-total-runs', totalRuns);
        updateElement('parkrun-pb', perf.fastestTime || '--:--');
        updateElement('parkrun-age-grade', ageGrade);
    } else {
        statsEl.innerHTML = '<span style="color: var(--text-muted)">Statistics unavailable</span>';
    }

    // Update recent runs table
    const recentEl = document.getElementById('parkrun-recent');
    if (recentData?.success && recentData.data?.length > 0) {
        const rows = recentData.data.map(r => `
            <tr>
                <td>${formatDate(r.runDate)}</td>
                <td>${r.eventName || 'Unknown'}</td>
                <td>${r.finishTime || '--:--'}</td>
                <td>${r.position || '--'}/${r.totalRunners || '--'}</td>
                <td>${r.ageGrade ? r.ageGrade : '--'}%${r.isPersonalBest ? ' <span class="pb-indicator">PB!</span>' : ''}</td>
            </tr>
        `).join('');

        recentEl.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Event</th>
                        <th>Time</th>
                        <th>Position</th>
                        <th>Age Grade</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    } else {
        recentEl.innerHTML = '<span style="color: var(--text-muted)">No recent runs found</span>';
    }
}

// =============================================================================
// Activity Ring
// =============================================================================

function updateActivityRing(stepsPercent, movePercent, exercisePercent, standPercent, sleepPercent) {
    // Ring circumferences for 5 rings (r=90, 74, 58, 42, 26)
    const stepsCircum = 565.5;    // 2 * PI * 90
    const moveCircum = 465.0;     // 2 * PI * 74
    const exerciseCircum = 364.4; // 2 * PI * 58
    const standCircum = 263.9;    // 2 * PI * 42
    const sleepCircum = 163.4;    // 2 * PI * 26

    // Calculate offsets (higher offset = less progress shown)
    const stepsOffset = stepsCircum * (1 - Math.min(stepsPercent, 1));
    const moveOffset = moveCircum * (1 - Math.min(movePercent, 1));
    const exerciseOffset = exerciseCircum * (1 - Math.min(exercisePercent, 1));
    const standOffset = standCircum * (1 - Math.min(standPercent, 1));
    const sleepOffset = sleepCircum * (1 - Math.min(sleepPercent, 1));

    // Get ring elements (Overview tab uses 'overview-ring-' prefix)
    const stepsRing = document.getElementById('overview-ring-steps');
    const moveRing = document.getElementById('overview-ring-move');
    const exerciseRing = document.getElementById('overview-ring-exercise');
    const standRing = document.getElementById('overview-ring-stand');
    const sleepRing = document.getElementById('overview-ring-sleep');

    // Update ring progress
    if (stepsRing) stepsRing.style.strokeDashoffset = stepsOffset;
    if (moveRing) moveRing.style.strokeDashoffset = moveOffset;
    if (exerciseRing) exerciseRing.style.strokeDashoffset = exerciseOffset;
    if (standRing) standRing.style.strokeDashoffset = standOffset;
    if (sleepRing) sleepRing.style.strokeDashoffset = sleepOffset;

    // Calculate overall completion (average of all 5 rings, each capped at 100%)
    const cappedSteps = Math.min(stepsPercent, 1);
    const cappedMove = Math.min(movePercent, 1);
    const cappedExercise = Math.min(exercisePercent, 1);
    const cappedStand = Math.min(standPercent, 1);
    const cappedSleep = Math.min(sleepPercent, 1);
    const overall = Math.round(((cappedSteps + cappedMove + cappedExercise + cappedStand + cappedSleep) / 5) * 100);
    const overallEl = document.getElementById('ring-overall');
    if (overallEl) {
        overallEl.textContent = `${overall}%`;
    }
}

// =============================================================================
// Chart Rendering
// =============================================================================

const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
        mode: 'index',
        intersect: false
    },
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: 'rgba(30, 41, 59, 0.95)',
            titleColor: '#F8FAFC',
            bodyColor: '#94A3B8',
            borderColor: 'rgba(148, 163, 184, 0.2)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
            titleFont: { family: "'JetBrains Mono', monospace", size: 12, weight: '600' },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 }
        }
    },
    scales: {
        x: {
            grid: { display: false },
            ticks: {
                color: COLORS.textMuted,
                font: { family: "'JetBrains Mono', monospace", size: 10 },
                maxRotation: 0
            }
        },
        y: {
            grid: { color: COLORS.grid, drawBorder: false },
            ticks: {
                color: COLORS.textMuted,
                font: { family: "'JetBrains Mono', monospace", size: 10 }
            }
        }
    }
};

function destroyChart(chartId) {
    if (charts[chartId]) {
        charts[chartId].destroy();
        delete charts[chartId];
    }
}

function renderBarChart(canvasId, data, color, goalLine = null) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    destroyChart(canvasId);

    const labels = data.map(d => formatDateShort(d.x));
    const values = data.map(d => d.y);

    const datasets = [{
        data: values,
        backgroundColor: goalLine ? values.map(v => v >= goalLine ? color : `${color}80`) : color,
        borderColor: color,
        borderWidth: 0,
        borderRadius: 4,
        barThickness: 'flex',
        maxBarThickness: 30
    }];

    if (goalLine) {
        datasets.push({
            type: 'line',
            data: values.map(() => goalLine),
            borderColor: 'rgba(148, 163, 184, 0.3)',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false
        });
    }

    charts[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            ...chartDefaults,
            scales: {
                ...chartDefaults.scales,
                x: { ...chartDefaults.scales.x, type: 'category' },
                y: {
                    ...chartDefaults.scales.y,
                    beginAtZero: true,
                    suggestedMax: goalLine ? Math.max(...values, goalLine) * 1.1 : Math.max(...values) * 1.1
                }
            }
        }
    });
}

function renderLineChart(canvasId, data, color, unit, options = {}) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    destroyChart(canvasId);

    const labels = data.map(d => formatDateShort(d.x));
    const values = data.map(d => d.y);
    const beginAtZero = options.beginAtZero !== false; // Default true, unless explicitly false

    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, `${color}66`);
    gradient.addColorStop(1, `${color}00`);

    // Calculate Y-axis range for better scaling when not starting at zero
    let yMin, yMax;
    if (!beginAtZero && values.length > 0) {
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const range = maxVal - minVal;
        const padding = range * 0.2 || 1; // 20% padding or 1 if no range
        yMin = Math.floor(minVal - padding);
        yMax = Math.ceil(maxVal + padding);
    }

    charts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: values,
                borderColor: color,
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: color,
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            ...chartDefaults,
            scales: {
                ...chartDefaults.scales,
                x: { ...chartDefaults.scales.x, type: 'category' },
                y: {
                    ...chartDefaults.scales.y,
                    beginAtZero: beginAtZero,
                    min: yMin,
                    max: yMax,
                    ticks: {
                        ...chartDefaults.scales.y.ticks,
                        callback: (value) => unit ? `${value} ${unit}` : value
                    }
                }
            },
            plugins: {
                ...chartDefaults.plugins,
                tooltip: {
                    ...chartDefaults.plugins.tooltip,
                    callbacks: {
                        label: (ctx) => unit ? `${ctx.raw} ${unit}` : ctx.raw
                    }
                }
            }
        }
    });
}

function renderHeartRateChart(data) {
    const ctx = document.getElementById('heartRateChart')?.getContext('2d');
    if (!ctx) return;

    destroyChart('heartRateChart');

    charts.heartRateChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => formatDateShort(d.x)),
            datasets: [
                {
                    label: 'Max',
                    data: data.map(d => d.max),
                    borderColor: 'rgba(248, 113, 113, 0.5)',
                    backgroundColor: 'rgba(248, 113, 113, 0.1)',
                    borderWidth: 1,
                    fill: '+1',
                    tension: 0.4,
                    pointRadius: 0
                },
                {
                    label: 'Avg',
                    data: data.map(d => d.avg),
                    borderColor: COLORS.heart,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 3,
                    pointBackgroundColor: COLORS.heart,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 1
                },
                {
                    label: 'Min',
                    data: data.map(d => d.min),
                    borderColor: 'rgba(6, 182, 212, 0.5)',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderWidth: 1,
                    fill: '-1',
                    tension: 0.4,
                    pointRadius: 0
                }
            ]
        },
        options: {
            ...chartDefaults,
            scales: {
                ...chartDefaults.scales,
                y: {
                    ...chartDefaults.scales.y,
                    suggestedMin: 40,
                    suggestedMax: 120,
                    ticks: {
                        ...chartDefaults.scales.y.ticks,
                        callback: (value) => `${value} bpm`
                    }
                }
            }
        }
    });
}

function renderSleepChart(data) {
    const ctx = document.getElementById('sleepChart')?.getContext('2d');
    if (!ctx) return;

    destroyChart('sleepChart');

    charts.sleepChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => formatDateShort(d.x)),
            datasets: [
                {
                    label: 'Deep',
                    data: data.map(d => d.deep),
                    backgroundColor: 'rgba(20, 184, 166, 0.9)',  // Teal
                    borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 }
                },
                {
                    label: 'Light',
                    data: data.map(d => d.core),
                    backgroundColor: 'rgba(34, 211, 238, 0.8)'   // Cyan
                },
                {
                    label: 'Dream',
                    data: data.map(d => d.rem),
                    backgroundColor: 'rgba(236, 72, 153, 0.8)'   // Magenta/Pink
                },
                {
                    label: 'Awake',
                    data: data.map(d => d.awake),
                    backgroundColor: 'rgba(156, 163, 175, 0.5)', // Gray
                    borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }
                }
            ]
        },
        options: {
            ...chartDefaults,
            scales: {
                ...chartDefaults.scales,
                x: { ...chartDefaults.scales.x, stacked: true },
                y: {
                    ...chartDefaults.scales.y,
                    stacked: true,
                    suggestedMax: 10,
                    ticks: {
                        ...chartDefaults.scales.y.ticks,
                        callback: (value) => `${value}h`
                    }
                }
            },
            plugins: {
                ...chartDefaults.plugins,
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: COLORS.textMuted,
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                        boxWidth: 12,
                        padding: 15
                    }
                }
            }
        }
    });
}

function renderWeightChart(canvasId, data) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    destroyChart(canvasId);

    const labels = data.map(d => formatDateShort(d.x));
    const values = data.map(d => d.y);

    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(245, 158, 11, 0.3)');
    gradient.addColorStop(1, 'rgba(245, 158, 11, 0.0)');

    charts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    data: values,
                    borderColor: COLORS.weight,
                    backgroundColor: gradient,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    pointBackgroundColor: COLORS.weight,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 1,
                    pointHoverRadius: 6
                },
                {
                    data: values.map(() => CONFIG.goals.targetWeight),
                    borderColor: COLORS.steps,
                    borderWidth: 2,
                    borderDash: [8, 4],
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            ...chartDefaults,
            scales: {
                ...chartDefaults.scales,
                x: {
                    ...chartDefaults.scales.x,
                    type: 'category',
                    ticks: { ...chartDefaults.scales.x.ticks, maxTicksLimit: 10 }
                },
                y: {
                    ...chartDefaults.scales.y,
                    suggestedMin: 165,
                    suggestedMax: 185,
                    ticks: {
                        ...chartDefaults.scales.y.ticks,
                        callback: (value) => `${value} lbs`
                    }
                }
            },
            plugins: {
                ...chartDefaults.plugins,
                tooltip: {
                    ...chartDefaults.plugins.tooltip,
                    filter: (tooltipItem) => tooltipItem.datasetIndex === 0,
                    callbacks: {
                        label: (ctx) => `${ctx.raw.toFixed(1)} lbs`
                    }
                }
            }
        }
    });
}

// =============================================================================
// Health Check
// =============================================================================

async function checkHealth() {
    const data = await fetchAPI('/health');
    if (data) {
        const apiLed = document.getElementById('led-api');
        const dbLed = document.getElementById('led-db');
        const syncLed = document.getElementById('led-sync');

        if (apiLed) apiLed.className = 'led led-healthy';
        if (dbLed) dbLed.className = data.services?.database ? 'led led-healthy' : 'led led-danger';
        if (syncLed) syncLed.className = data.services?.parkrun ? 'led led-healthy' : 'led led-warning';
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

function updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
        el.classList.add('value-flash');
        setTimeout(() => el.classList.remove('value-flash'), 500);
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function formatDateShort(dateStr) {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short'
    });
}

function formatDateISO(date) {
    return date.toISOString().split('T')[0];
}

/**
 * Format decimal hours as "Xh Ym" like Apple Health app
 * @param {number} hours - Decimal hours (e.g., 5.21)
 * @returns {string} Formatted string (e.g., "5h 12m")
 */
function formatHoursMinutes(hours) {
    if (!hours || hours <= 0) return '--';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

// =============================================================================
// Initialization
// =============================================================================

async function initDashboard() {
    console.log('Initializing Health Monitor Dashboard v2.0...');

    // Initialize tab navigation
    initTabNavigation();

    // Initialize date controls
    initDateControls();

    // Check health status
    await checkHealth();

    // Load initial tab data
    await loadTabData(state.activeTab);

    console.log('Dashboard initialized successfully');

    // Start auto-refresh
    setInterval(async () => {
        console.log('Auto-refreshing dashboard...');
        await checkHealth();
        if (state.activeTab === 'overview') {
            await loadTodaySummary();
        }
    }, CONFIG.refreshInterval);
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', initDashboard);
