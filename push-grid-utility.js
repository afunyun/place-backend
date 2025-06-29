#!/usr/bin/env node

/**
 * Grid Push Utility
 * Pushes .json grid data to a deployed Cloudflare Worker without requiring redeployment
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WORKER_URL = "https://place-worker.afunyun.workers.dev";
const DEFAULT_GRID_FILE = "./grid_data_backup.json";
const BATCH_SIZE = 50;
const BATCH_DELAY = 100;

async function pushGridToWorker(options = {}) {
	const {
		workerUrl = DEFAULT_WORKER_URL,
		gridFile = DEFAULT_GRID_FILE,
		batchSize = BATCH_SIZE,
		batchDelay = BATCH_DELAY,
		dryRun = false,
	} = options;

	console.log("🚀 Grid Push Utility");
	console.log(`📍 Worker URL: ${workerUrl}`);
	console.log(`📄 Grid file: ${gridFile}`);
	console.log(`📦 Batch size: ${batchSize}`);
	console.log(dryRun ? "🔍 DRY RUN MODE" : "");
	console.log("=".repeat(50));

	if (!fs.existsSync(gridFile)) {
		console.error(`❌ Grid file not found: ${gridFile}`);
		process.exit(1);
	}

	let gridData;
	try {
		console.log("📂 Reading grid data...");
		gridData = JSON.parse(fs.readFileSync(gridFile, "utf8"));
	} catch (error) {
		console.error(`❌ Failed to read grid file: ${error.message}`);
		process.exit(1);
	}

	if (!Array.isArray(gridData) || gridData.length === 0) {
		console.error("❌ Invalid grid data format - expected 2D array");
		process.exit(1);
	}

	console.log(
		`📊 Grid dimensions: ${gridData.length}x${gridData[0]?.length || 0}`,
	);

	console.log("🎨 Analyzing pixels...");
	const updates = [];
	const defaultColor = "#FFFFFF";

	for (let y = 0; y < gridData.length; y++) {
		for (let x = 0; x < gridData[y].length; x++) {
			const color = gridData[y][x];
			if (color && color !== defaultColor) {
				updates.push({ x, y, color });
			}
		}
	}

	console.log(`✅ Found ${updates.length} pixels to update`);

	if (updates.length === 0) {
		console.log("ℹ️ No pixels to update - grid is all default color");
		return;
	}

	if (dryRun) {
		console.log("🔍 DRY RUN - Would update these pixels:");
		updates.slice(0, 10).forEach(({ x, y, color }) => {
			console.log(`   (${x},${y}) -> ${color}`);
		});
		if (updates.length > 10) {
			console.log(`   ... and ${updates.length - 10} more pixels`);
		}
		return;
	}

	console.log("🔌 Testing worker connectivity...");
	try {
		const response = await fetch(`${workerUrl}/health`);
		if (!response.ok) {
			console.warn("⚠️ Health check failed, but continuing...");
		} else {
			console.log("✅ Worker is responsive");
		}
	} catch (error) {
		console.warn(`⚠️ Worker connectivity test failed: ${error.message}`);
		console.log("🔄 Continuing with pixel updates...");
	}

	let successCount = 0;
	let failCount = 0;
	const totalBatches = Math.ceil(updates.length / batchSize);

	console.log("🔄 Starting pixel updates...");

	for (let i = 0; i < updates.length; i += batchSize) {
		const batch = updates.slice(i, i + batchSize);
		const batchNum = Math.floor(i / batchSize) + 1;

		console.log(
			`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} pixels)...`,
		);

		const promises = batch.map(async (update) => {
			try {
				const response = await fetch(`${workerUrl}/pixel`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(update),
				});

				if (response.ok) {
					successCount++;
					return { success: true, update };
				} else {
					const errorText = await response.text();
					failCount++;
					return {
						success: false,
						update,
						error: `${response.status}: ${errorText}`,
					};
				}
			} catch (error) {
				failCount++;
				return { success: false, update, error: error.message };
			}
		});

		const results = await Promise.all(promises);

		const failures = results.filter((r) => !r.success);
		if (failures.length > 0) {
			console.log(`⚠️ ${failures.length} failures in batch ${batchNum}:`);
			failures.slice(0, 5).forEach((f) => {
				console.log(`   (${f.update.x},${f.update.y}) -> ${f.error}`);
			});
			if (failures.length > 5) {
				console.log(`   ... and ${failures.length - 5} more failures`);
			}
		} else {
			console.log(`✅ Batch ${batchNum} completed successfully`);
		}

		const processed = Math.min(i + batchSize, updates.length);
		const progress = ((processed / updates.length) * 100).toFixed(1);
		console.log(`📈 Progress: ${processed}/${updates.length} (${progress}%)`);

		if (i + batchSize < updates.length && batchDelay > 0) {
			await new Promise((resolve) => setTimeout(resolve, batchDelay));
		}
	}

	console.log("\n🎉 Grid push completed!");
	console.log(`📊 Results: ${successCount} successful, ${failCount} failed`);

	if (failCount > 0) {
		console.log(
			"⚠️ Some pixels failed to update. Check worker logs or try again.",
		);
		process.exit(1);
	} else {
		console.log("✅ All pixels updated successfully!");
	}
}

function printUsage() {
	console.log(`
Grid Push Utility - Push .json grid data to Cloudflare Worker

Usage:
  node push-grid-utility.js [options]

Options:
  --url <url>           Worker URL (default: ${DEFAULT_WORKER_URL})
  --file <path>         Grid JSON file path (default: ${DEFAULT_GRID_FILE})
  --batch-size <size>   Batch size for requests (default: ${BATCH_SIZE})
  --batch-delay <ms>    Delay between batches in ms (default: ${BATCH_DELAY})
  --dry-run             Show what would be updated without making changes
  --help               Show this help message

Examples:
  node push-grid-utility.js
  node push-grid-utility.js --url https://my-worker.workers.dev
  node push-grid-utility.js --file ./my-grid.json --dry-run
  node push-grid-utility.js --batch-size 25 --batch-delay 200
  `);
}

function parseArgs() {
	const args = process.argv.slice(2);
	const options = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
				break;
			case "--url":
				options.workerUrl = args[++i];
				break;
			case "--file":
				options.gridFile = args[++i];
				break;
			case "--batch-size":
				options.batchSize = parseInt(args[++i], 10);
				break;
			case "--batch-delay":
				options.batchDelay = parseInt(args[++i], 10);
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			default:
				console.error(`Unknown option: ${arg}`);
				printUsage();
				process.exit(1);
		}
	}

	return options;
}

if (require.main === module) {
	const options = parseArgs();

	pushGridToWorker(options).catch((error) => {
		console.error("❌ Grid push failed:", error.message);
		process.exit(1);
	});
}

module.exports = { pushGridToWorker };
