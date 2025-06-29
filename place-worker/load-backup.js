// Script to load grid_data_backup.json into the deployed Worker
const fs = require('fs');
const path = require('path');

async function loadBackupGrid() {
    console.log('🔄 Starting backup grid loading...');
    
    const backupFilePath = path.join(__dirname, 'grid_data_backup.json');
    
    if (!fs.existsSync(backupFilePath)) {
        console.log('❌ grid_data_backup.json not found');
        return;
    }
    
    try {
        // Read backup grid data
        console.log('📂 Reading grid_data_backup.json...');
        const gridData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
        
        if (!Array.isArray(gridData) || gridData.length !== 500 || gridData[0]?.length !== 500) {
            console.log('❌ Invalid grid data format - expected 500x500 array');
            return;
        }
        
        console.log(`📊 Loaded grid: ${gridData.length}x${gridData[0].length}`);
        
        // Count non-white pixels
        let pixelCount = 0;
        const defaultColor = '#FFFFFF';
        const updates = [];
        
        console.log('🎨 Processing pixels...');
        
        for (let y = 0; y < gridData.length; y++) {
            for (let x = 0; x < gridData[y].length; x++) {
                const color = gridData[y][x];
                if (color && color !== defaultColor) {
                    updates.push({ x, y, color });
                    pixelCount++;
                }
            }
        }
        
        console.log(`✅ Found ${pixelCount} non-default pixels to load`);
        
        if (pixelCount === 0) {
            console.log('ℹ️ No pixel updates needed - grid is all default color');
            return;
        }
        
        // Upload in batches to avoid overwhelming the Worker
        const batchSize = 100;
        const totalBatches = Math.ceil(updates.length / batchSize);
        
        let successCount = 0;
        let failCount = 0;
        
        console.log(`🚀 Uploading ${pixelCount} pixels in ${totalBatches} batches...`);
        
        for (let i = 0; i < updates.length; i += batchSize) {
            const batch = updates.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            
            console.log(`🔄 Batch ${batchNum}/${totalBatches} (${batch.length} pixels)...`);
            
            const promises = batch.map(async (update) => {
                try {
                    const response = await fetch('https://place-worker.afunyun.workers.dev/pixel', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(update)
                    });
                    
                    if (response.ok) {
                        successCount++;
                        return { success: true };
                    } else {
                        const error = await response.text();
                        failCount++;
                        console.log(`   ⚠️ Failed: (${update.x},${update.y}) - ${error}`);
                        return { success: false, error };
                    }
                } catch (error) {
                    failCount++;
                    console.log(`   ❌ Error: (${update.x},${update.y}) - ${error.message}`);
                    return { success: false, error: error.message };
                }
            });
            
            await Promise.all(promises);
            
            // Small delay between batches
            if (i + batchSize < updates.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            // Progress update
            const processed = Math.min(i + batchSize, updates.length);
            const percent = ((processed / updates.length) * 100).toFixed(1);
            console.log(`   📊 Progress: ${processed}/${updates.length} (${percent}%)`);
        }
        
        console.log('\n✅ Backup grid loading completed!');
        console.log(`📊 Results: ${successCount} successful, ${failCount} failed`);
        
        if (failCount > 0) {
            console.log('⚠️ Some pixels failed to load. The Worker should still be functional.');
        } else {
            console.log('🎉 All pixels from backup loaded successfully!');
        }
        
    } catch (error) {
        console.error('❌ Backup loading failed:', error.message);
    }
}

// Run backup loading if this script is called directly
if (require.main === module) {
    loadBackupGrid().catch(error => {
        console.error('❌ Script failed:', error.message);
        process.exit(1);
    });
}

module.exports = { loadBackupGrid };