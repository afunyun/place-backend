const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs"); // Node.js File System module
const path = require("path"); // Node.js Path module for safer file paths

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*", // Allows all origins for development. Be more restrictive in production.
		methods: ["GET", "POST"],
	},
});

const PORT = 3000;

// --- Grid Configuration ---
const GRID_WIDTH = 500;
const GRID_HEIGHT = 500;

// --- Persistence Configuration ---
const GRID_FILE_PATH = path.join(__dirname, "grid_data.json");

// --- Global Grid State (in-memory) ---
let grid = [];

// --- Middlewares ---
app.use(cors());
app.use(express.json());

// --- Persistence Functions ---

function initializeDefaultGrid() {
	// IMPORTANT: Changed default color to white for better visibility debugging
	grid = Array(GRID_HEIGHT)
		.fill(0)
		.map(() => Array(GRID_WIDTH).fill("#FFFFFF"));
	console.log("Backend: Default grid initialized.");
}

function loadGrid() {
	try {
		if (fs.existsSync(GRID_FILE_PATH)) {
			console.log(
				"Backend: Debugging loadGrid - File exists. Attempting to read and parse.",
			);
			const data = fs.readFileSync(GRID_FILE_PATH, "utf8");
			const loadedGrid = JSON.parse(data);

			console.log("Backend: Debugging loadGrid - JSON parsed successfully.");
			console.log(
				"Backend: Debugging loadGrid - Type of loadedGrid:",
				typeof loadedGrid,
			);
			console.log(
				"Backend: Debugging loadGrid - Is loadedGrid an Array?",
				Array.isArray(loadedGrid),
			);

			if (Array.isArray(loadedGrid) && loadedGrid.length > 0) {
				console.log(
					"Backend: Debugging loadGrid - Loaded grid rows:",
					loadedGrid.length,
				);
				const firstRowLength = loadedGrid[0] ? loadedGrid[0].length : "N/A";
				console.log(
					"Backend: Debugging loadGrid - Loaded grid first row length:",
					firstRowLength,
				);
				console.log(
					"Backend: Debugging loadGrid - Example pixel at (0,0):",
					loadedGrid[0][0],
				);
			} else {
				console.log(
					"Backend: Debugging loadGrid - Loaded grid is empty or not a valid array structure.",
				);
			}

			if (
				loadedGrid.length === GRID_HEIGHT &&
				loadedGrid.every((row) => row.length === GRID_WIDTH)
			) {
				grid = loadedGrid;
				console.log(
					"Backend: Grid loaded successfully from file:",
					GRID_FILE_PATH,
				);
			} else {
				console.warn(
					"Backend: Loaded grid dimensions do not match current constants.",
				);
				console.warn(
					"Backend: Expected:",
					GRID_HEIGHT,
					"x",
					GRID_WIDTH,
					"Got:",
					loadedGrid.length,
					"x",
					loadedGrid[0] ? loadedGrid[0].length : "N/A",
				);
				console.log(
					"Backend: Initializing new grid because dimensions mismatched.",
				);
				initializeDefaultGrid();
				saveGrid();
			}
		} else {
			console.log("Backend: No grid data file found. Initializing a new grid.");
			initializeDefaultGrid();
			saveGrid();
		}
	} catch (error) {
		console.error(
			"Backend: Error loading grid data (JSON parse error or file read error):",
			error,
		);
		console.log("Backend: Initializing a fresh grid due to load error.");
		initializeDefaultGrid();
		saveGrid();
	}
}

function saveGrid() {
	try {
		const data = JSON.stringify(grid);
		fs.writeFileSync(GRID_FILE_PATH, data, "utf8");
		console.log("Backend: Grid saved to file:", GRID_FILE_PATH);
	} catch (error) {
		console.error("Backend: Error saving grid data:", error);
	}
}

// --- HTTP Routes ---

app.get("/grid", (req, res) => {
	res.json(grid);
});

app.post("/pixel", (req, res) => {
	const { x, y, color } = req.body;

	if (
		x == null ||
		y == null ||
		!color ||
		x < 0 ||
		x >= GRID_WIDTH ||
		y < 0 ||
		y >= GRID_HEIGHT
	) {
		return res
			.status(400)
			.json({
				message:
					"Invalid pixel data. Coordinates or color missing/out of bounds.",
			});
	}

	grid[y][x] = color;
	console.log(`Backend: Pixel updated: (${x}, ${y}) to ${color}`);

	saveGrid(); // Save the grid after every update

	io.emit("pixelUpdate", { x, y, color });

	res.status(200).json({ message: "Pixel updated successfully" });
});

// --- WebSocket Connection Handling ---

io.on("connection", (socket) => {
	console.log("Backend: A user connected via WebSocket:", socket.id);

	socket.on("disconnect", () => {
		console.log("Backend: User disconnected via WebSocket:", socket.id);
	});
});

// --- Server Start ---
server.listen(PORT, () => {
	console.log(`Backend: Server running on http://localhost:${PORT}`);
	loadGrid(); // Load grid data when the server starts
});
