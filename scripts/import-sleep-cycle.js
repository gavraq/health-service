#!/usr/bin/env node
/**
 * Import Sleep Cycle CSV data into the database
 *
 * CSV Columns (29):
 * 1. Start - sleep start datetime
 * 2. End - sleep end datetime
 * 3. Sleep Quality - percentage
 * 4. Regularity - percentage
 * 5. Awake (seconds)
 * 6. Dream (seconds)
 * 7. Light (seconds)
 * 8. Deep (seconds)
 * 9. Mood - ignored
 * 10. Heart rate (bpm) - EXCLUDED per user request
 * 11. Steps - EXCLUDED per user request
 * 12. Alarm mode
 * 13. Air Pressure (Pa)
 * 14. City
 * 15. Movements per hour
 * 16. Time in bed (seconds)
 * 17. Time asleep (seconds)
 * 18. Time before sleep (seconds)
 * 19. Window start - ignored
 * 20. Window stop - ignored
 * 21. Snore time (seconds)
 * 22. Weather temperature (°C)
 * 23. Weather type
 * 24. Notes
 * 25. Body temperature deviation - ignored
 * 26. Ambient Noise (dB)
 * 27. Respiratory rate (breaths per minute)
 * 28. Coughs (per hour)
 * 29. Breathing disruptions (per hour)
 */

const fs = require('fs');
const path = require('path');

// CSV file path - adjust if needed
const CSV_PATH = process.argv[2] || path.join(process.env.HOME, 'Downloads', 'sleepdata 2.csv');
const API_BASE = process.argv[3] || 'http://localhost:3001';

function parseCSV(content) {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(';');

    console.log('CSV Headers:', headers);
    console.log(`Total rows: ${lines.length - 1}`);

    const records = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(';');

        // Parse start datetime to get sleep_date (the night of sleep)
        const startDateTime = values[0];
        const endDateTime = values[1];

        // Extract the date part - use the start date as the sleep date
        const sleepDate = startDateTime ? startDateTime.split(' ')[0] : null;

        if (!sleepDate) {
            console.log(`Skipping row ${i}: no start date`);
            continue;
        }

        // Parse percentage values (remove % sign)
        const parsePercent = (val) => {
            if (!val || val === '' || val === '0%') return null;
            return parseInt(val.replace('%', ''), 10);
        };

        // Parse numeric values
        const parseNum = (val) => {
            if (!val || val === '' || val === '0.0' || val === '0') return null;
            const num = parseFloat(val);
            return isNaN(num) ? null : num;
        };

        // Parse string values
        const parseStr = (val) => {
            if (!val || val === '' || val === 'Not set' || val === 'No weather') return null;
            return val.trim();
        };

        const record = {
            sleep_date: sleepDate,
            start_time: startDateTime || null,
            end_time: endDateTime || null,
            sleep_quality: parsePercent(values[2]),
            regularity: parsePercent(values[3]),
            time_in_bed_sec: parseNum(values[15]),
            time_asleep_sec: parseNum(values[16]),
            time_before_sleep_sec: parseNum(values[17]),
            awake_sec: parseNum(values[4]),
            dream_sec: parseNum(values[5]),
            light_sec: parseNum(values[6]),
            deep_sec: parseNum(values[7]),
            snore_time_sec: parseNum(values[20]),
            movements_per_hour: parseNum(values[14]),
            // heart_rate_bpm - excluded
            respiratory_rate: parseNum(values[26]),
            breathing_disruptions: parseNum(values[28]),
            coughs_per_hour: parseNum(values[27]),
            ambient_noise_db: parseNum(values[25]),
            weather_temp_c: parseNum(values[21]),
            weather_type: parseStr(values[22]),
            city: parseStr(values[13]),
            air_pressure_pa: parseNum(values[12]),
            notes: parseStr(values[23])
        };

        records.push(record);
    }

    return records;
}

async function importData() {
    console.log('\n=== Sleep Cycle CSV Import ===\n');
    console.log(`CSV File: ${CSV_PATH}`);
    console.log(`API Base: ${API_BASE}`);

    // Check if file exists
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`\nError: CSV file not found at ${CSV_PATH}`);
        console.error('Usage: node import-sleep-cycle.js [csv_path] [api_base_url]');
        process.exit(1);
    }

    // Read and parse CSV
    const content = fs.readFileSync(CSV_PATH, 'utf-8');
    const records = parseCSV(content);

    console.log(`\nParsed ${records.length} records`);

    // Show sample of first few records
    console.log('\nSample records (first 3):');
    records.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.sleep_date}: Quality=${r.sleep_quality}%, Regularity=${r.regularity}%, Asleep after=${r.time_before_sleep_sec ? Math.round(r.time_before_sleep_sec / 60) : 'N/A'}min`);
    });

    // Show sample of last few records
    console.log('\nSample records (last 3):');
    records.slice(-3).forEach((r, i) => {
        console.log(`  ${records.length - 2 + i}. ${r.sleep_date}: Quality=${r.sleep_quality}%, Regularity=${r.regularity}%, Asleep after=${r.time_before_sleep_sec ? Math.round(r.time_before_sleep_sec / 60) : 'N/A'}min`);
    });

    // Import to API
    console.log(`\nImporting to ${API_BASE}/api/sleep-cycle/import ...`);

    try {
        const response = await fetch(`${API_BASE}/api/sleep-cycle/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: records })
        });

        const result = await response.json();

        if (result.success) {
            console.log(`\n✓ Successfully imported ${result.imported} records`);
            if (result.errors && result.errors.length > 0) {
                console.log(`  Errors: ${result.errors.length}`);
            }
        } else {
            console.error(`\n✗ Import failed: ${result.error}`);
        }
    } catch (error) {
        console.error(`\n✗ Import failed: ${error.message}`);
        console.error('\nMake sure the health service is running at', API_BASE);
    }
}

importData();
