// Programmatic migration script to upload pixels via API
const fs = require('node:fs');
const path = require('node:path');

async function runMigration() {
  console.log('🚀 Starting programmatic migration...');

  const migrationDataPath = path.join(__dirname, 'migration-data.json');

  if (!fs.existsSync(migrationDataPath)) {
    console.log('❌ migration-data.json not found. Run migrate-data.js first.');
    return;
  }

  const updates = JSON.parse(fs.readFileSync(migrationDataPath, 'utf8'));
  console.log(`📊 Migrating ${updates.length} pixels...`);

  let successCount = 0;
  let failCount = 0;

  // Process in batches to avoid overwhelming the server
  const batchSize = 50;
  const totalBatches = Math.ceil(updates.length / batchSize);

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    console.log(
      `🔄 Processing batch ${batchNum}/${totalBatches} (${batch.length} pixels)...`,
    );

    const promises = batch.map(async (update) => {
      try {
        const response = await fetch('http://localhost:8787/pixel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(update),
        });

        if (response.ok) {
          successCount++;
          return { success: true, update };
        } else {
          const error = await response.text();
          failCount++;
          return { success: false, update, error };
        }
      } catch (error) {
        failCount++;
        return { success: false, update, error: error.message };
      }
    });

    const results = await Promise.all(promises);

    // Log any failures
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      console.log(`⚠️ ${failures.length} failures in batch ${batchNum}:`);
      failures.forEach((f) => {
        console.log(`   Failed: (${f.update.x},${f.update.y}) - ${f.error}`);
      });
    }

    // Small delay between batches
    if (i + batchSize < updates.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  console.log('\n✅ Migration completed!');
  console.log(`📊 Results: ${successCount} successful, ${failCount} failed`);

  if (failCount > 0) {
    console.log('⚠️ Some pixels failed to migrate. Check the worker logs.');
  }
}

// Run migration if this script is called directly
if (require.main === module) {
  runMigration().catch((error) => {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  });
}
