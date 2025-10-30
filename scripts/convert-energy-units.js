#!/usr/bin/env node

/**
 * Energy Unit Conversion Script
 *
 * Converts active_energy values to standardized kcal in metric_value_converted column.
 *
 * Strategy:
 * - Records with unit 'kcal': Copy value as-is
 * - Records with unit 'kJ': Convert by dividing by 4.184 (kJ to kcal)
 * - Preserves original values in metric_value column
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/health.db');
const KJ_TO_KCAL = 4.184;

async function runConversion() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Failed to connect to database:', err);
        reject(err);
        return;
      }
      console.log('Connected to health database');
    });

    // Begin transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // Get statistics before conversion
      db.get(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN metric_unit = 'kcal' THEN 1 ELSE 0 END) as kcal_count,
          SUM(CASE WHEN metric_unit = 'kJ' THEN 1 ELSE 0 END) as kj_count,
          SUM(CASE WHEN metric_value_converted IS NOT NULL THEN 1 ELSE 0 END) as already_converted
        FROM health_metrics
        WHERE metric_type = 'active_energy'
      `, (err, stats) => {
        if (err) {
          console.error('Failed to get statistics:', err);
          db.run('ROLLBACK');
          reject(err);
          return;
        }

        console.log('\n=== Before Conversion ===');
        console.log(`Total active_energy records: ${stats.total}`);
        console.log(`  - kcal records: ${stats.kcal_count}`);
        console.log(`  - kJ records: ${stats.kj_count}`);
        console.log(`  - Already converted: ${stats.already_converted}`);

        // Step 1: Convert kcal records (copy value as-is)
        console.log('\n[1/3] Converting kcal records (copy as-is)...');
        db.run(`
          UPDATE health_metrics
          SET metric_value_converted = metric_value
          WHERE metric_type = 'active_energy'
            AND metric_unit = 'kcal'
            AND metric_value_converted IS NULL
        `, function(err) {
          if (err) {
            console.error('Failed to convert kcal records:', err);
            db.run('ROLLBACK');
            reject(err);
            return;
          }
          console.log(`  ✓ Converted ${this.changes} kcal records`);

          // Step 2: Convert kJ records (divide by 4.184)
          console.log('\n[2/3] Converting kJ records (kJ ÷ 4.184 = kcal)...');
          db.run(`
            UPDATE health_metrics
            SET metric_value_converted = metric_value / ?
            WHERE metric_type = 'active_energy'
              AND metric_unit = 'kJ'
              AND metric_value_converted IS NULL
          `, [KJ_TO_KCAL], function(err) {
            if (err) {
              console.error('Failed to convert kJ records:', err);
              db.run('ROLLBACK');
              reject(err);
              return;
            }
            console.log(`  ✓ Converted ${this.changes} kJ records`);

            // Step 3: Verify conversion
            console.log('\n[3/3] Verifying conversion...');
            db.get(`
              SELECT
                COUNT(*) as total,
                SUM(CASE WHEN metric_value_converted IS NULL THEN 1 ELSE 0 END) as null_count,
                MIN(metric_value_converted) as min_val,
                MAX(metric_value_converted) as max_val,
                AVG(metric_value_converted) as avg_val
              FROM health_metrics
              WHERE metric_type = 'active_energy'
            `, (err, verify) => {
              if (err) {
                console.error('Failed to verify:', err);
                db.run('ROLLBACK');
                reject(err);
                return;
              }

              console.log('\n=== After Conversion ===');
              console.log(`Total records: ${verify.total}`);
              console.log(`NULL values: ${verify.null_count}`);
              console.log(`Value range: ${verify.min_val.toFixed(2)} - ${verify.max_val.toFixed(2)} kcal`);
              console.log(`Average: ${verify.avg_val.toFixed(2)} kcal/sample`);

              if (verify.null_count > 0) {
                console.error(`\n⚠️  WARNING: ${verify.null_count} records still have NULL converted values!`);
                db.run('ROLLBACK');
                reject(new Error('Conversion incomplete - some NULL values remain'));
                return;
              }

              // Sample verification for Oct 10
              console.log('\n=== Sample Verification (Oct 10, 2025) ===');
              db.all(`
                SELECT
                  metric_unit,
                  SUM(metric_value) as original_sum,
                  SUM(metric_value_converted) as converted_sum,
                  COUNT(*) as samples
                FROM health_metrics
                WHERE metric_type = 'active_energy'
                  AND DATE(metric_date) = '2025-10-10'
                GROUP BY metric_unit
              `, (err, oct10) => {
                if (err) {
                  console.error('Failed to verify Oct 10:', err);
                  db.run('ROLLBACK');
                  reject(err);
                  return;
                }

                oct10.forEach(row => {
                  console.log(`\n  ${row.metric_unit} records:`);
                  console.log(`    Samples: ${row.samples}`);
                  console.log(`    Original sum: ${row.original_sum.toFixed(2)} ${row.metric_unit}`);
                  console.log(`    Converted sum: ${row.converted_sum.toFixed(2)} kcal`);
                  if (row.metric_unit === 'kJ') {
                    const expected = row.original_sum / KJ_TO_KCAL;
                    const diff = Math.abs(row.converted_sum - expected);
                    console.log(`    Expected: ${expected.toFixed(2)} kcal`);
                    console.log(`    Difference: ${diff.toFixed(6)} kcal (${diff < 0.01 ? '✓ OK' : '⚠️ CHECK'})`);
                  }
                });

                // Commit transaction
                db.run('COMMIT', (err) => {
                  if (err) {
                    console.error('Failed to commit:', err);
                    db.run('ROLLBACK');
                    reject(err);
                    return;
                  }

                  console.log('\n✅ Conversion completed successfully!');
                  console.log('\nAll active_energy records now have converted values in kcal.');

                  db.close((err) => {
                    if (err) {
                      console.error('Error closing database:', err);
                      reject(err);
                    } else {
                      resolve();
                    }
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

// Run the conversion
console.log('=== Energy Unit Conversion Script ===');
console.log(`Database: ${DB_PATH}`);
console.log(`Conversion: kJ ÷ ${KJ_TO_KCAL} = kcal\n`);

runConversion()
  .then(() => {
    console.log('\nScript completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });
