// Migration script to transfer grid_data.json to Cloudflare Workers
const fs = require('fs');
const path = require('path');

async function migrateGridData() {
    console.log('🔄 Starting grid data migration...');
    
    // Path to the existing grid data file
    const gridFilePath = path.join(__dirname, '..', 'grid_data.json');
    
    if (!fs.existsSync(gridFilePath)) {
        console.log('ℹ️ No grid_data.json found - no migration needed');
        return;
    }
    
    try {
        // Read existing grid data
        console.log('📂 Reading grid_data.json...');
        const gridData = JSON.parse(fs.readFileSync(gridFilePath, 'utf8'));
        
        if (!Array.isArray(gridData) || gridData.length === 0) {
            console.log('⚠️ Invalid grid data format');
            return;
        }
        
        console.log(`📊 Found grid: ${gridData.length}x${gridData[0]?.length || 0}`);
        
        // Count non-white pixels
        let pixelCount = 0;
        const defaultColor = '#FFFFFF';
        
        // Generate migration commands
        console.log('🎨 Generating pixel update commands...');
        const updates = [];
        
        for (let y = 0; y < gridData.length; y++) {
            for (let x = 0; x < gridData[y].length; x++) {
                const color = gridData[y][x];
                if (color && color !== defaultColor) {
                    updates.push({
                        x: x,
                        y: y,
                        color: color
                    });
                    pixelCount++;
                }
            }
        }
        
        console.log(`✅ Found ${pixelCount} non-default pixels to migrate`);
        
        if (pixelCount === 0) {
            console.log('ℹ️ No pixel updates needed - grid is all default color');
            return;
        }
        
        // Generate curl commands for migration
        console.log('\n📝 Migration commands (run these while worker is running):');
        console.log('=' .repeat(60));
        
        for (const update of updates.slice(0, 10)) { // Show first 10 as example
            const curlCommand = `curl -X POST http://localhost:8787/pixel -H "Content-Type: application/json" -d '${JSON.stringify(update)}'`;
            console.log(curlCommand);
        }
        
        if (updates.length > 10) {
            console.log(`... and ${updates.length - 10} more commands`);
        }
        
        // Save migration script
        const migrationScript = updates.map(update => 
            `curl -X POST http://localhost:8787/pixel -H "Content-Type: application/json" -d '${JSON.stringify(update)}'`
        ).join('\n');
        
        fs.writeFileSync(path.join(__dirname, 'migration-commands.sh'), migrationScript);
        console.log('\n💾 Saved all migration commands to: migration-commands.sh');
        console.log('   Run: bash migration-commands.sh (while worker is running)');
        
        // Also save as JSON for programmatic migration
        fs.writeFileSync(path.join(__dirname, 'migration-data.json'), JSON.stringify(updates, null, 2));
        console.log('💾 Saved migration data to: migration-data.json');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
    }
}

// Run migration if this script is called directly
if (require.main === module) {
    migrateGridData();
}