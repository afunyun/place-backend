document.addEventListener("DOMContentLoaded", () => {
  // Initialize theme toggle button as early as possible
  const earlyThemeToggleBtn = document.getElementById("themeToggleBtn");
  if (earlyThemeToggleBtn) {
    console.log("Found theme toggle button early");
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
      const icon = earlyThemeToggleBtn.querySelector(".material-icons-round");
      if (icon) icon.textContent = "light_mode";
    }
  } else {
    console.log("Theme toggle button not found early");
  }

  const BACKEND_URL = "";
  const WEBSOCKET_URL = "wss://" + window.location.host + "/ws";
  const OAUTH_CLIENT_ID = "1388712213002457118";

  // OAuth redirect URI uses current origin so Discord can redirect back to the frontend
  // The frontend root then posts to the worker at /auth/discord
  const OAUTH_REDIRECT_URI = `${window.location.origin}/callback.html`;

  const PIXEL_SIZE = 10;

  const LIVE_VIEW_PIXEL_SIZE_FACTOR = 2;
  const LIVE_VIEW_CANVAS_WIDTH = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR;
  const LIVE_VIEW_CANVAS_HEIGHT = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR;

  const CLICK_THRESHOLD = 5;

  // Color palette - will be fetched from the server
  let PALETTE = [
    "#FFFFFF", // index 0 – background
    "#000000", // index 1 – black
    "#FF0000", // index 2 – red
    // Full palette will be loaded from server
  ];

  // Color history management
  let colorHistory =
    JSON.parse(localStorage.getItem("colorHistory")) ||
    new Array(10).fill(null);
  let eraserMode = false;

  function initializeColorHistory() {
    // Load existing history or create new one
    colorHistory =
      JSON.parse(localStorage.getItem("colorHistory")) ||
      new Array(10).fill(null);

    // If the top 5 slots are empty, populate them with random colors from the palette
    for (let i = 0; i < 5; i++) {
      if (!colorHistory[i] && PALETTE.length > 3) {
        // Skip white (#FFFFFF) and get a random vibrant color
        const vibrantColors = PALETTE.filter((color) => color !== "#FFFFFF");
        colorHistory[i] =
          vibrantColors[Math.floor(Math.random() * vibrantColors.length)];
      }
    }

    updateColorHistoryUI();
    saveColorHistory();
  }

  function updateColorHistoryUI() {
    const colorHistoryContainer = document.getElementById("colorHistory");
    if (!colorHistoryContainer) return;

    const slots = colorHistoryContainer.querySelectorAll(".color-history-slot");
    slots.forEach((slot, index) => {
      const color = colorHistory[index];
      if (color) {
        slot.style.backgroundColor = color;
        slot.classList.remove("empty");
        if (eraserMode && index >= 5) {
          slot.title = `${color} - Click to erase`;
        } else if (index < 5) {
          slot.title = `Random color: ${color}`;
        } else {
          slot.title = `Saved color: ${color}`;
        }
      } else {
        slot.style.backgroundColor = "";
        slot.classList.add("empty");
        if (index < 5) {
          slot.title = "Random color slot";
        } else {
          slot.title = "Empty - click to save current color";
        }
      }
    });
  }

  function saveColorHistory() {
    localStorage.setItem("colorHistory", JSON.stringify(colorHistory));
  }

  function addColorToHistory(color) {
    // Don't add if the color is already in history
    if (colorHistory.includes(color)) return;

    // Only add to bottom 5 slots (slots 5-9) which are user-controlled
    // Find the first empty slot in the bottom row
    for (let i = 5; i < 10; i++) {
      if (!colorHistory[i]) {
        colorHistory[i] = color;
        updateColorHistoryUI();
        saveColorHistory();
        return;
      }
    }

    // If all bottom slots are full, shift them left and add the new color at the end
    for (let i = 5; i < 9; i++) {
      colorHistory[i] = colorHistory[i + 1];
    }
    colorHistory[9] = color;
    updateColorHistoryUI();
    saveColorHistory();
  }

  function selectColorFromHistory(index) {
    const color = colorHistory[index];
    if (color) {
      currentColor = color;
      colorPicker.value = color;
      if (customColorSwatch) {
        customColorSwatch.style.backgroundColor = color;
      }
      // Update color picker text if it exists
      const colorPickerText = document.getElementById("colorPickerText");
      if (colorPickerText) {
        colorPickerText.textContent = color;
      }
    }
  }

  // Fetch the full palette from the server
  async function loadPalette() {
    try {
      console.log("Attempting to load palette from:", `${BACKEND_URL}/palette`);
      const response = await fetch(`${BACKEND_URL}/palette`);
      if (response.ok) {
        const data = await response.json();
        PALETTE = data.palette;
        console.log("Palette loaded from server:", PALETTE.length, "colors");
        console.log("First 10 palette colors:", PALETTE.slice(0, 10));
        initializeColorHistory();
      } else {
        console.warn(
          "Failed to load palette from server, using default. Status:",
          response.status
        );
        console.log("Default palette:", PALETTE);
        initializeColorHistory();
      }
    } catch (error) {
      console.warn("Error loading palette from server:", error);
      console.log("Using default palette:", PALETTE);
      initializeColorHistory();
    }
  }

  function toggleEraserMode() {
    eraserMode = !eraserMode;
    const eraserBtn = document.getElementById("eraserBtn");
    const colorHistoryContainer = document.getElementById("colorHistory");

    if (eraserMode) {
      eraserBtn.classList.add("eraser-active");
      eraserBtn.title = "Eraser active - Click on saved colors to erase them";
      colorHistoryContainer.classList.add("eraser-mode");
    } else {
      eraserBtn.classList.remove("eraser-active");
      eraserBtn.title = "Eraser - Click to erase saved colors";
      colorHistoryContainer.classList.remove("eraser-mode");
    }
  }

  function eraseColorSlot(slotIndex) {
    if (slotIndex >= 5 && slotIndex <= 9) {
      colorHistory[slotIndex] = null;
      updateColorHistoryUI();
      saveColorHistory();

      // Auto-disable eraser mode after erasing
      if (eraserMode) {
        toggleEraserMode();
      }
    }
  }

  // Function to find closest palette color
  function findClosestPaletteColor(hexColor) {
    // Convert hex to RGB
    const targetR = parseInt(hexColor.slice(1, 3), 16);
    const targetG = parseInt(hexColor.slice(3, 5), 16);
    const targetB = parseInt(hexColor.slice(5, 7), 16);

    let closestColor = PALETTE[0];
    let minDistance = Infinity;

    for (const paletteColor of PALETTE) {
      const r = parseInt(paletteColor.slice(1, 3), 16);
      const g = parseInt(paletteColor.slice(3, 5), 16);
      const b = parseInt(paletteColor.slice(5, 7), 16);

      // Calculate Euclidean distance in RGB space
      const distance = Math.sqrt(
        Math.pow(targetR - r, 2) +
          Math.pow(targetG - g, 2) +
          Math.pow(targetB - b, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestColor = paletteColor;
      }
    }

    return closestColor;
  }

  const canvas = document.getElementById("neuroCanvas");
  const ctx = canvas.getContext("2d");

  const liveViewCanvas = document.getElementById("liveViewCanvas");
  const liveViewCtx = liveViewCanvas.getContext("2d");

  const highlightCanvas = document.getElementById("neuroHighlightCanvas");
  const highlightCtx = highlightCanvas.getContext("2d");

  const pixelChatLog = document.getElementById("pixelChatLog");

  const colorPicker = document.getElementById("colorPicker");
  const customColorSwatch = document.getElementById("customColorSwatch");
  const placePixelBtn = document.getElementById("placePixelBtn");
  const selectedCoordsDisplay = document.getElementById("selectedCoords");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const themeToggleBtn = document.getElementById("themeToggleBtn");

  console.log("Theme toggle button found:", themeToggleBtn);

  let currentColor = colorPicker.value;
  let grid = [];
  const selectedPixel = { x: null, y: null };

  let socket = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 1000;
  const sessionId = generateSessionId();
  let userToken = localStorage.getItem("discord_token");
  let userData = JSON.parse(localStorage.getItem("user_data") || "null");

  window.initiateDiscordOAuth = () => initiateDiscordOAuth();
  window.logout = () => logout();
  window.handleOAuthCallback = () => handleOAuthCallback();

  const GRID_WIDTH = 500;
  const GRID_HEIGHT = 500;

  let scale = 1.0;
  let offsetX = 0;
  let offsetY = 0;

  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let lastClickX = 0;
  let lastClickY = 0;

  let initialPinchDistance = null;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchStartX = 0;
  let touchStartY = 0;

  let offscreenCanvas;
  let offscreenCtx;

  let liveViewImageData;
  let liveViewPixelData;

  const COOLDOWN_DURATION_MS = 60 * 1000;
  let lastPixelTime = parseInt(
    localStorage.getItem("lastPixelTime") || "0",
    10
  );
  let cooldownIntervalId = null;
  let enforceCooldown = true;
  let cooldownTimerDiv;

  function setCanvasSize() {
    const canvasContainer = document.querySelector(".canvas-container");
    if (canvasContainer) {
      canvas.width = canvasContainer.clientWidth;
      canvas.height = canvasContainer.clientHeight;
      highlightCanvas.width = canvasContainer.clientWidth;
      highlightCanvas.height = canvasContainer.clientHeight;
    }

    if (liveViewCanvas) {
      liveViewCanvas.width = LIVE_VIEW_CANVAS_WIDTH;
      liveViewCanvas.height = LIVE_VIEW_CANVAS_HEIGHT;
    }

    if (grid && grid.length > 0) {
      console.log(
        "setCanvasSize: Redrawing grids due to resize and existing data."
      );
      drawGrid();
      drawLiveViewGrid();
    } else {
      console.log("setCanvasSize: Grid data not yet available for redraw.");
    }
  }

  function hexToRgba(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b, 255];
  }

  // Convert RGB color to hex format
  function rgbToHex(rgb) {
    // If rgb is already a hex string, return it
    if (typeof rgb === "string" && rgb.startsWith("#")) {
      return rgb;
    }

    // If rgb is an array [r,g,b] or [r,g,b,a]
    if (Array.isArray(rgb)) {
      const [r, g, b] = rgb;
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }

    // If rgb is a string like "rgb(r,g,b)" or "rgba(r,g,b,a)"
    if (
      typeof rgb === "string" &&
      (rgb.startsWith("rgb(") || rgb.startsWith("rgba("))
    ) {
      const values = rgb.match(/\d+/g).map(Number);
      const [r, g, b] = values;
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }

    // Default fallback
    return "#000000";
  }

  async function getGrid() {
    try {
      console.log("Attempting to fetch grid from:", `${BACKEND_URL}/grid`);
      const response = await fetch(`${BACKEND_URL}/grid`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Get binary RLE data instead of JSON
      const rleData = new Uint8Array(await response.arrayBuffer());
      console.log(
        "Binary grid data fetched successfully, size:",
        rleData.length
      );

      // Decode RLE data back to full grid
      const grid = Array.from({ length: 500 }, () =>
        Array(500).fill("#FFFFFF")
      );

      let gridIndex = 0;
      let colorStats = {};
      for (let i = 0; i < rleData.length; i += 2) {
        const runLength = rleData[i];
        const colorIndex = rleData[i + 1];
        const color = PALETTE[colorIndex] || "#FFFFFF";

        // Track color usage for debugging
        colorStats[color] = (colorStats[color] || 0) + runLength;

        // Fill the run
        for (let j = 0; j < runLength; j++) {
          const x = gridIndex % 500;
          const y = Math.floor(gridIndex / 500);
          if (y < 500) {
            grid[y][x] = color;
          }
          gridIndex++;
        }
      }

      console.log("Grid color distribution:", colorStats);
      console.log("Total pixels processed:", gridIndex);
      console.log("Palette size:", PALETTE.length);

      return grid;
    } catch (error) {
      console.error("Error fetching grid:", error);
      alert(
        "Could not connect to backend to get initial grid. Is your backend running?"
      );
      return Array(GRID_HEIGHT)
        .fill(0)
        .map(() => Array(GRID_WIDTH).fill("#FFFFFF")); // Use palette background color
    }
  }

  async function placePixel(x, y, color) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (userToken) {
        headers.Authorization = `Bearer ${userToken}`;
      }

      const response = await fetch(`${BACKEND_URL}/pixel`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          x,
          y,
          color,
          sessionId,
          user: userData,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          `Failed to place pixel: ${errorData.message || response.statusText}`
        );
      }
      console.log(
        `Pixel placement request sent for (${x}, ${y}) with color ${color}`
      );
    } catch (error) {
      console.error("Error sending pixel update:", error);
      alert(`Failed to place pixel: ${error.message}`);
    }
  }

  function drawPixelToOffscreen(x, y, color) {
    if (!offscreenCtx) {
      console.error("Offscreen canvas context not available for drawPixel.");
      return;
    }

    // Calculate the exact pixel position
    const pixelX = x * PIXEL_SIZE;
    const pixelY = y * PIXEL_SIZE;

    offscreenCtx.fillStyle = color;
    offscreenCtx.fillRect(pixelX, pixelY, PIXEL_SIZE, PIXEL_SIZE);
  }

  function drawFullOffscreenGrid(grid) {
    if (!offscreenCtx || !offscreenCanvas) return;
    offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (grid[y] && grid[y][x] !== undefined) {
          drawPixelToOffscreen(x, y, grid[y][x]);
        }
      }
    }
    console.log("Full grid drawn to offscreen canvas.");
  }

  function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!offscreenCanvas) return;

    ctx.save();

    // Ensure we're using integer pixel values for the translation to avoid blurriness
    const intOffsetX = Math.round(offsetX);
    const intOffsetY = Math.round(offsetY);

    ctx.translate(intOffsetX, intOffsetY);
    ctx.scale(scale, scale);

    ctx.drawImage(offscreenCanvas, 0, 0);

    ctx.restore();

    // Draw highlight on separate canvas
    drawHighlight();
  }

  function drawHighlight() {
    highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

    if (selectedPixel.x !== null && selectedPixel.y !== null) {
      highlightCtx.save();

      // Use the same integer offsets as in drawGrid
      const intOffsetX = Math.round(offsetX);
      const intOffsetY = Math.round(offsetY);

      highlightCtx.translate(intOffsetX, intOffsetY);
      highlightCtx.scale(scale, scale);
      highlightCtx.strokeStyle = "var(--accent, orange)";
      highlightCtx.lineWidth = 3 / scale;
      highlightCtx.strokeRect(
        selectedPixel.x * PIXEL_SIZE,
        selectedPixel.y * PIXEL_SIZE,
        PIXEL_SIZE,
        PIXEL_SIZE
      );
      highlightCtx.restore();
    }
  }

  function initLiveViewImageData() {
    liveViewImageData = liveViewCtx.createImageData(
      LIVE_VIEW_CANVAS_WIDTH,
      LIVE_VIEW_CANVAS_HEIGHT
    );
    liveViewPixelData = liveViewImageData.data;
  }

  function drawLiveViewGrid() {
    if (!liveViewCtx || !liveViewPixelData) {
      console.error("Live View Canvas Context or ImageData not available.");
      return;
    }

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const color =
          grid[y] && grid[y][x] !== undefined ? grid[y][x] : "#000000";
        const [r, g, b, a] = hexToRgba(color);

        const targetX = Math.floor(x / LIVE_VIEW_PIXEL_SIZE_FACTOR);
        const targetY = Math.floor(y / LIVE_VIEW_PIXEL_SIZE_FACTOR);

        const imageDataIndex = (targetY * LIVE_VIEW_CANVAS_WIDTH + targetX) * 4;

        if (
          imageDataIndex >= 0 &&
          imageDataIndex + 3 < liveViewPixelData.length
        ) {
          liveViewPixelData[imageDataIndex] = r;
          liveViewPixelData[imageDataIndex + 1] = g;
          liveViewPixelData[imageDataIndex + 2] = b;
          liveViewPixelData[imageDataIndex + 3] = a;
        }
      }
    }
    liveViewCtx.putImageData(liveViewImageData, 0, 0);
  }

  function generateSessionId() {
    return `session_${Math.random()
      .toString(36)
      .substring(2, 11)}${Date.now().toString(36)}`;
  }

  function initiateDiscordOAuth() {
    const scopes = "identify+email";
    const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${OAUTH_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(
      OAUTH_REDIRECT_URI
    )}&scope=${scopes}`;
    window.location.href = oauthUrl;
  }

  async function handleOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (code) {
      try {
        const response = await fetch(`${BACKEND_URL}/auth/discord`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, redirect_uri: OAUTH_REDIRECT_URI }),
        });

        if (response.ok) {
          const data = await response.json();
          userToken = data.access_token;
          userData = data.user;
          localStorage.setItem("discord_token", userToken);
          localStorage.setItem("user_data", JSON.stringify(userData));
          updateUserInterface();
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          );
        }
      } catch (error) {
        console.error("OAuth callback error:", error);
      }
    }
  }

  function logout() {
    userToken = null;
    userData = null;
    localStorage.removeItem("discord_token");
    localStorage.removeItem("user_data");
    updateUserInterface();
  }

  function updateUserInterface() {
    const loginBtn = document.getElementById("discordLoginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const userInfo = document.getElementById("userInfo");

    if (userData && userToken) {
      if (loginBtn) loginBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "inline-block";
      if (userInfo) {
        userInfo.style.display = "flex";

        const avatarEl = document.getElementById("userAvatar");
        const nameEl = document.getElementById("userName");
        if (avatarEl) {
          avatarEl.src = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`;
        }
        if (nameEl) {
          nameEl.textContent = `${userData.username}#${userData.discriminator}`;
        }

        if (!document.getElementById("cooldownToggleContainer")) {
          const label = document.createElement("label");
          label.id = "cooldownToggleContainer";
          label.style.marginLeft = "8px";
          label.style.cursor = "pointer";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.id = "cooldownToggle";
          checkbox.checked = enforceCooldown;
          checkbox.style.marginRight = "4px";

          label.appendChild(checkbox);
          label.appendChild(document.createTextNode("Enable Cooldown"));
          userInfo.appendChild(label);

          checkbox.addEventListener("change", (e) => {
            enforceCooldown = e.target.checked;
            if (!enforceCooldown) {
              updateCooldownTimerDisplay();
            } else {
              if (isCooldownActive()) {
                updateCooldownTimerDisplay();
                if (!cooldownIntervalId) {
                  cooldownIntervalId = setInterval(
                    updateCooldownTimerDisplay,
                    1000
                  );
                }
              }
            }
          });
        }
      }
    } else {
      if (loginBtn) loginBtn.style.display = "inline-block";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (userInfo) userInfo.style.display = "none";

      const toggleContainer = document.getElementById(
        "cooldownToggleContainer"
      );
      if (toggleContainer) toggleContainer.remove();

      enforceCooldown = true;
      updateCooldownTimerDisplay();
    }
  }

  function addPixelLogEntry(x, y, color) {
    if (!pixelChatLog) {
      console.error("Pixel chat log element not found.");
      return;
    }

    const logEntry = document.createElement("div");
    logEntry.className = "log-entry";
    let finalContentHTML = ""; // This will hold the full HTML with colors

    // --- YOUR LOGIC TO DETERMINE finalContentHTML ---
    if (typeof y === "number" && typeof x === "number") {
      finalContentHTML = `<span style="color: #00ff00">${x}</span><span style="color: #00ff00">,</span> <span style="color: #00ff00">${y}</span> updated`;
    } else if (
      y === "Connected" ||
      y === "Disconnected" ||
      y === "Reconnecting..." ||
      y.startsWith("Connection Error")
    ) {
      finalContentHTML = `<span style="color: #00ff00">${x}</span><span style="color: #00ff00">,</span> <span style="color: #00ff00">${y}</span> updated`;
    } else {
      finalContentHTML = `<span style="color: #00ff00">${x}</span><span style="color: #00ff00">,</span> <span style="color: #00ff00">${y}</span> updated`;
    }
    // --- END YOUR LOGIC ---

    // The actual text content will be built incrementally within the 'typed-container'
    logEntry.innerHTML = `
        <i class="fa-solid fa-circle" style="font-size:10px; margin-right: 10px; margin-left: 6px; color: ${color}; font-weight: bold;"></i>
        <span class="typing-target"></span>
    `;

    pixelChatLog.appendChild(logEntry);
    pixelChatLog.scrollTop = pixelChatLog.scrollHeight; // Scroll to show the new entry immediately

    // Get the element where the typing will occur
    const typingTargetElement = logEntry.querySelector(".typing-target");
    if (!typingTargetElement) {
      console.error("Typing target element not found.");
      return;
    }

    // --- Typing Logic Adapted from CodePen ---
    let i = 0;
    let isTag = false; // Flag to indicate if we are inside an HTML tag
    const typingSpeed = 60; // Adjust this speed as needed (CodePen uses 60ms)
    const originalText = finalContentHTML; // The full HTML string to type

    function type() {
      // Get the current substring to display
      const text = originalText.slice(0, ++i);

      // If all text is typed, stop the animation
      if (text === originalText) {
        typingTargetElement.innerHTML = text; // Ensure final content is set without cursor
        pixelChatLog.scrollTop = pixelChatLog.scrollHeight; // Final scroll
        return;
      }

      // Check if the last character is '<' (start of tag) or '>' (end of tag)
      const char = text.slice(-1);
      if (char === "<") isTag = true;
      if (char === ">") isTag = false;

      // Update the element's HTML with the current text and the blinking cursor
      // The cursor should always be at the end of the visible text
      typingTargetElement.innerHTML =
        text + `<span class='blinker'>&#32;</span>`;

      // If currently inside a tag, call type() immediately without delay
      if (isTag) {
        type(); // No setTimeout, just call itself to quickly append the rest of the tag
      } else {
        // Otherwise, set a timeout for the next character
        setTimeout(type, typingSpeed);
      }

      // Optional: Scroll during typing if the content is long, but can be jumpy
      // pixelChatLog.scrollTop = pixelChatLog.scrollHeight;
    }

    // Start the typing animation
    type();
  }

  function getGridCoordsFromScreen(clientX, clientY) {
    // Use the bounding rectangle of the canvas itself for the most accurate calculation
    const rect = canvas.getBoundingClientRect();

    // Calculate the position within the canvas element
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;

    // Apply the inverse of the canvas transformation to get world coordinates
    // Use the same integer offsets as in drawGrid for consistency
    const intOffsetX = Math.round(offsetX);
    const intOffsetY = Math.round(offsetY);

    const worldX = (canvasX - intOffsetX) / scale;
    const worldY = (canvasY - intOffsetY) / scale;

    // Convert world coordinates to grid coordinates
    const gridX = Math.floor(worldX / PIXEL_SIZE);
    const gridY = Math.floor(worldY / PIXEL_SIZE);

    // Check if the grid coordinates are within bounds
    if (gridX >= 0 && gridX < GRID_WIDTH && gridY >= 0 && gridY < GRID_HEIGHT) {
      return { x: gridX, y: gridY };
    }
    return null;
  }

  function handleUserInteractionClick(event) {
    const gridCoords = getGridCoordsFromScreen(event.clientX, event.clientY);

    if (gridCoords) {
      console.log(
        `Click resolved to grid coordinates: (${gridCoords.x}, ${gridCoords.y})`
      );

      // Check if the selection has changed
      if (
        selectedPixel.x !== gridCoords.x ||
        selectedPixel.y !== gridCoords.y
      ) {
        // Selection changed
      }

      selectedPixel.x = gridCoords.x;
      selectedPixel.y = gridCoords.y;

      // Update color picker to show the current color at this position
      const currentColor =
        grid[gridCoords.y] && grid[gridCoords.y][gridCoords.x];

      if (currentColor) {
        const hexColor = rgbToHex(currentColor);
        document.getElementById("colorPicker").value = hexColor;
        document.getElementById("colorPickerText").textContent = hexColor;
      }

      // Update the selected coordinates display
      updateSelectedCoordsDisplay();

      // Redraw to show the highlight
      drawHighlight();
    } else {
      // Click was outside the grid
      if (selectedPixel.x !== null) {
        // Selection was cleared
      }

      selectedPixel.x = null;
      selectedPixel.y = null;

      // Update the selected coordinates display
      updateSelectedCoordsDisplay();

      // Redraw to clear the highlight
      drawHighlight();
    }
  }

  function handleMouseDown(event) {
    isDragging = true;

    // Store the exact client coordinates
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    lastClickX = event.clientX;
    lastClickY = event.clientY;

    canvas.classList.add("grabbing");
  }

  function handleMouseMove(event) {
    if (!isDragging) {
      return;
    }

    const dx = event.clientX - lastMouseX;
    const dy = event.clientY - lastMouseY;

    offsetX += dx;
    offsetY += dy;

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    drawGrid();
  }

  function handleMouseUp(event) {
    isDragging = false;
    canvas.classList.remove("grabbing");

    const dx = event.clientX - lastClickX;
    const dy = event.clientY - lastClickY;

    if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
      // Use the current mouse position for better accuracy
      handleUserInteractionClick({
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
  }

  function handleTouchStart(event) {
    event.preventDefault();

    if (event.touches.length === 1) {
      isDragging = true;
      lastTouchX = event.touches[0].clientX;
      lastTouchY = event.touches[0].clientY;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
      canvas.classList.add("grabbing");
      initialPinchDistance = null;
    } else if (event.touches.length === 2) {
      isDragging = false;
      initialPinchDistance = getPinchDistance(event);
    } else {
    }
  }

  function handleTouchMove(event) {
    event.preventDefault();

    if (event.touches.length === 1 && isDragging) {
      const dx = event.touches[0].clientX - lastTouchX;
      const dy = event.touches[0].clientY - lastTouchY;

      offsetX += dx;
      offsetY += dy;

      offsetX = Math.round(offsetX);
      offsetY = Math.round(offsetY);

      lastTouchX = event.touches[0].clientX;
      lastTouchY = event.touches[0].clientY;

      drawGrid();
    } else if (event.touches.length === 2 && initialPinchDistance !== null) {
      const currentPinchDistance = getPinchDistance(event);
      const scaleChange = currentPinchDistance / initialPinchDistance;

      const oldScale = scale;
      scale *= scaleChange;
      scale = Math.max(0.1, Math.min(scale, 10.0));

      const touchCenterX =
        (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const touchCenterY =
        (event.touches[0].clientY + event.touches[1].clientY) / 2;

      const rect = canvas.getBoundingClientRect();
      const mouseCanvasX = touchCenterX - rect.left;
      const mouseCanvasY = touchCenterY - rect.top;

      const mouseWorldX = (mouseCanvasX - offsetX) / oldScale;
      const mouseWorldY = (mouseCanvasY - offsetY) / oldScale;

      offsetX = mouseCanvasX - mouseWorldX * scale;
      offsetY = mouseCanvasY - mouseWorldY * scale;

      offsetX = Math.round(offsetX);
      offsetY = Math.round(offsetY);

      initialPinchDistance = currentPinchDistance;
      drawGrid();
    }
  }

  function handleTouchEnd(event) {
    canvas.classList.remove("grabbing");
    isDragging = false;
    initialPinchDistance = null;

    if (event.changedTouches.length === 1) {
      const finalX = event.changedTouches[0].clientX;
      const finalY = event.changedTouches[0].clientY;

      const dx = finalX - touchStartX;
      const dy = finalY - touchStartY;

      if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
        handleUserInteractionClick({
          clientX: touchStartX,
          clientY: touchStartY,
        });
      } else {
      }
    }
  }

  function getPinchDistance(event) {
    const touch1 = event.touches[0];
    const touch2 = event.touches[1];
    return Math.sqrt(
      (touch2.clientX - touch1.clientX) ** 2 +
        (touch2.clientY - touch1.clientY) ** 2
    );
  }

  function handleMouseWheel(event) {
    if (event.preventDefault) {
      event.preventDefault();
    }

    const zoomFactor = 0.1;
    const oldScale = scale;

    if (event.deltaY < 0) {
      scale *= 1 + zoomFactor;
    } else {
      scale /= 1 + zoomFactor;
    }

    scale = Math.max(0.1, Math.min(scale, 10.0));

    const rect = canvas.getBoundingClientRect();
    const mouseCanvasX = event.clientX - rect.left;
    const mouseCanvasY = event.clientY - rect.top;

    const mouseWorldX = (mouseCanvasX - offsetX) / oldScale;
    const mouseWorldY = (mouseCanvasY - offsetY) / oldScale;

    offsetX = mouseCanvasX - mouseWorldX * scale;
    offsetY = mouseCanvasY - mouseWorldY * scale;

    offsetX = Math.round(offsetX);
    offsetY = Math.round(offsetY);

    drawGrid();
  }

  function handlePlacePixelClick() {
    if (selectedPixel.x === null || selectedPixel.y === null) {
      alert("Please select a pixel on the canvas first!");
      return;
    }

    if (isCooldownActive()) {
      const remaining = Math.ceil(
        (COOLDOWN_DURATION_MS - (Date.now() - lastPixelTime)) / 1000
      );
      alert(`Please wait ${remaining}s before placing another pixel.`);
      return;
    }

    placePixel(selectedPixel.x, selectedPixel.y, currentColor);

    // Add the placed color to history
    addColorToHistory(currentColor);

    if (enforceCooldown) {
      startCooldownTimer();
    }
  }

  function handleColorChange() {
    const selectedColor = colorPicker.value.toUpperCase();

    // Check if color is in palette, if not find closest
    let validColor;
    if (PALETTE.includes(selectedColor)) {
      validColor = selectedColor;
    } else {
      validColor = findClosestPaletteColor(selectedColor);
      // Update the color picker to show the valid color
      colorPicker.value = validColor;
      console.log(
        `Color ${selectedColor} snapped to nearest palette color: ${validColor}`
      );
    }

    currentColor = validColor;
    if (customColorSwatch) {
      customColorSwatch.style.backgroundColor = currentColor;
    }
  }

  function setupColorHistoryListeners() {
    const colorHistoryContainer = document.getElementById("colorHistory");
    const eraserBtn = document.getElementById("eraserBtn");

    if (!colorHistoryContainer) return;

    // Eraser button click handler
    if (eraserBtn) {
      eraserBtn.addEventListener("click", toggleEraserMode);
    }

    colorHistoryContainer.addEventListener("click", (event) => {
      const slot = event.target.closest(".color-history-slot");
      if (!slot) return;

      const slotIndex = parseInt(slot.dataset.slot);

      if (eraserMode) {
        // Eraser mode - only allow erasing saved colors (bottom row)
        if (slotIndex >= 5 && colorHistory[slotIndex]) {
          eraseColorSlot(slotIndex);
        }
        return;
      }

      if (slotIndex < 5) {
        // Top row - select color if it exists
        if (colorHistory[slotIndex]) {
          selectColorFromHistory(slotIndex);
        }
      } else {
        // Bottom row - save current color if slot is empty, or select if it has a color
        if (colorHistory[slotIndex]) {
          selectColorFromHistory(slotIndex);
        } else {
          // Save current color to this slot
          colorHistory[slotIndex] = currentColor;
          updateColorHistoryUI();
          saveColorHistory();
        }
      }
    });

    // Add right-click to clear user-saved colors (bottom row) - alternative to eraser
    colorHistoryContainer.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const slot = event.target.closest(".color-history-slot");
      if (!slot) return;

      const slotIndex = parseInt(slot.dataset.slot);
      if (slotIndex >= 5) {
        // Bottom row - allow clearing
        eraseColorSlot(slotIndex);
      }
    });
  }

  function updateSelectedCoordsDisplay() {
    if (selectedPixel.x !== null && selectedPixel.y !== null) {
      selectedCoordsDisplay.textContent = `(${selectedPixel.x}, ${selectedPixel.y})`;
    } else {
      selectedCoordsDisplay.textContent = "None";
    }
  }

  function handleKeyDown(event) {
    if (event.defaultPrevented) return;

    // ESC key to exit eraser mode
    if (event.key === "Escape") {
      if (eraserMode) {
        toggleEraserMode();
        event.preventDefault();
        return;
      }
    }

    switch (event.key) {
      case "ArrowUp":
        if (selectedPixel.y > 0) selectedPixel.y--;
        break;
      case "ArrowDown":
        if (selectedPixel.y < GRID_HEIGHT - 1) selectedPixel.y++;
        break;
      case "ArrowLeft":
        if (selectedPixel.x > 0) selectedPixel.x--;
        break;
      case "ArrowRight":
        if (selectedPixel.x < GRID_WIDTH - 1) selectedPixel.x++;
        break;
      case " ":
      case "Spacebar":
      case "Space":
        event.preventDefault();
        handlePlacePixelClick();
        return;
      default:
        return;
    }
    event.preventDefault();
    if (selectedPixel.x === null || selectedPixel.y === null) {
      selectedPixel.x = 0;
      selectedPixel.y = 0;
    }
    updateSelectedCoordsDisplay();
    drawHighlight();
  }

  function createReconnectButton() {
    const btn = document.createElement("button");
    btn.id = "reconnectButton";
    btn.textContent = "Reconnect";
    btn.className = "btn btn-primary";
    btn.style.display = "none";
    btn.style.marginTop = "1rem";
    btn.style.width = "100%";

    btn.addEventListener("click", () => {
      if (!socket) return;
      addPixelLogEntry("System", "Reconnecting...", "#ffff00");
      btn.disabled = true;
      connectWebSocket();
    });

    if (placePixelBtn?.parentElement) {
      placePixelBtn.parentElement.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }
    return btn;
  }

  function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      socket = new WebSocket(WEBSOCKET_URL);

      socket.onopen = () => {
        console.log("Connected to backend WebSocket");
        addPixelLogEntry("System", "Connected", "#00ff00");
        reconnectButton.style.display = "none";
        reconnectButton.disabled = false;
        reconnectAttempts = 0;
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "pixelUpdate") {
            const { x, y, color } = data;

            if (grid[y]?.[x] !== undefined) {
              grid[y][x] = color;
            }

            drawPixelToOffscreen(x, y, color);

            if (liveViewPixelData) {
              const [r, g, b, a] = hexToRgba(color);
              const targetX = Math.floor(x / LIVE_VIEW_PIXEL_SIZE_FACTOR);
              const targetY = Math.floor(y / LIVE_VIEW_PIXEL_SIZE_FACTOR);
              const imageDataIndex =
                (targetY * LIVE_VIEW_CANVAS_WIDTH + targetX) * 4;

              if (
                imageDataIndex >= 0 &&
                imageDataIndex + 3 < liveViewPixelData.length
              ) {
                liveViewPixelData[imageDataIndex] = r;
                liveViewPixelData[imageDataIndex + 1] = g;
                liveViewPixelData[imageDataIndex + 2] = b;
                liveViewPixelData[imageDataIndex + 3] = a;
              }
              liveViewCtx.putImageData(liveViewImageData, 0, 0);
            }

            drawGrid();
            addPixelLogEntry(x, y, color);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      socket.onclose = (event) => {
        console.log("WebSocket connection closed:", event.code, event.reason);
        addPixelLogEntry("System", "Disconnected", "#ff0000");

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(
            `Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
          );
          setTimeout(
            () => connectWebSocket(),
            RECONNECT_DELAY * reconnectAttempts
          );
        } else {
          reconnectButton.style.display = "inline-block";
          alert("Connection lost. Please click reconnect to retry.");
        }
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        addPixelLogEntry("System", "Connection Error", "#ff9900");
      };
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
      addPixelLogEntry(
        "System",
        `Connection Error: ${error.message}`,
        "#ff9900"
      );
      reconnectButton.style.display = "inline-block";
    }
  }

  function setupWebSocket() {
    connectWebSocket();
  }

  function isCooldownActive() {
    if (!enforceCooldown) return false;
    return Date.now() - lastPixelTime < COOLDOWN_DURATION_MS;
  }

  function startCooldownTimer() {
    if (!enforceCooldown) return;
    lastPixelTime = Date.now();
    localStorage.setItem("lastPixelTime", lastPixelTime.toString());
    updateCooldownTimerDisplay();
    if (cooldownIntervalId) clearInterval(cooldownIntervalId);
    cooldownIntervalId = setInterval(updateCooldownTimerDisplay, 1000);
  }

  function updateCooldownTimerDisplay() {
    if (!cooldownTimerDiv) return;

    if (!enforceCooldown) {
      cooldownTimerDiv.style.display = "none";
      if (cooldownIntervalId) {
        clearInterval(cooldownIntervalId);
        cooldownIntervalId = null;
      }
      return;
    }

    const remaining = COOLDOWN_DURATION_MS - (Date.now() - lastPixelTime);
    if (remaining <= 0) {
      cooldownTimerDiv.style.display = "none";
      if (cooldownIntervalId) {
        clearInterval(cooldownIntervalId);
        cooldownIntervalId = null;
      }
      return;
    }

    cooldownTimerDiv.textContent = `Cooldown: ${Math.ceil(remaining / 1000)}s`;
    cooldownTimerDiv.style.display = "block";
  }

  function toggleDark() {
    console.log("Toggle dark mode called");
    document.documentElement.classList.toggle("dark");
    const isDark = document.documentElement.classList.contains("dark");
    console.log("Dark mode is now:", isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");

    const themeIcon = themeToggleBtn.querySelector(".material-icons-round");
    if (themeIcon) {
      themeIcon.textContent = isDark ? "light_mode" : "dark_mode";
      console.log("Theme icon updated to:", themeIcon.textContent);
    } else {
      console.log("Theme icon element not found");
    }
  }

  function initTheme() {
    console.log("initTheme called");
    const savedTheme = localStorage.getItem("theme");
    console.log("Saved theme from localStorage:", savedTheme);

    if (savedTheme === "dark") {
      console.log("Applying dark theme");
      document.documentElement.classList.add("dark");
      const themeIcon = themeToggleBtn.querySelector(".material-icons-round");
      if (themeIcon) {
        themeIcon.textContent = "light_mode";
        console.log("Theme icon set to light_mode");
      } else {
        console.log("Theme icon element not found in initTheme");
      }
    } else if (savedTheme === "light") {
      console.log("Applying light theme");
      document.documentElement.classList.remove("dark");
      const themeIcon = themeToggleBtn.querySelector(".material-icons-round");
      if (themeIcon) {
        themeIcon.textContent = "dark_mode";
        console.log("Theme icon set to dark_mode");
      } else {
        console.log("Theme icon element not found in initTheme");
      }
    } else {
      console.log("No saved theme, using default");
    }
  }

  async function init() {
    if (customColorSwatch && colorPicker) {
      customColorSwatch.style.backgroundColor = colorPicker.value;
    }

    cooldownTimerDiv = document.createElement("div");
    cooldownTimerDiv.id = "cooldownTimer";
    cooldownTimerDiv.style.position = "fixed";
    cooldownTimerDiv.style.top = "10px";
    cooldownTimerDiv.style.left = "50%";
    cooldownTimerDiv.style.transform = "translateX(-50%)";
    cooldownTimerDiv.style.padding = "6px 12px";
    cooldownTimerDiv.style.backgroundColor = "rgba(0,0,0,0.75)";
    cooldownTimerDiv.style.color = "#fff";
    cooldownTimerDiv.style.fontWeight = "bold";
    cooldownTimerDiv.style.borderRadius = "4px";
    cooldownTimerDiv.style.zIndex = "10000";
    cooldownTimerDiv.style.display = "none";
    document.body.appendChild(cooldownTimerDiv);

    const loginBtn = document.getElementById("discordLoginBtn");
    if (loginBtn) loginBtn.addEventListener("click", initiateDiscordOAuth);
    const logoutBtnElement = document.getElementById("logoutBtn");
    if (logoutBtnElement) logoutBtnElement.addEventListener("click", logout);

    if (isCooldownActive()) {
      updateCooldownTimerDisplay();
      cooldownIntervalId = setInterval(updateCooldownTimerDisplay, 1000);
    }

    // Load palette first, then initialize color history
    await loadPalette();

    setCanvasSize();

    offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = GRID_WIDTH * PIXEL_SIZE;
    offscreenCanvas.height = GRID_HEIGHT * PIXEL_SIZE;
    offscreenCtx = offscreenCanvas.getContext("2d");
    offscreenCtx.imageSmoothingEnabled = false;
    console.log("Offscreen Canvas created.");

    if (liveViewCanvas) {
      initLiveViewImageData();
    }
    liveViewCtx.imageSmoothingEnabled = false;

    grid = await getGrid();

    drawFullOffscreenGrid(grid);

    const gridPixelWidth = GRID_WIDTH * PIXEL_SIZE;
    const gridPixelHeight = GRID_HEIGHT * PIXEL_SIZE;

    const fitScaleX = canvas.width / gridPixelWidth;
    const fitScaleY = canvas.height / gridPixelHeight;
    scale = Math.min(fitScaleX, fitScaleY) * 0.9;
    scale = Math.max(scale, 0.1);

    offsetX = (canvas.width - gridPixelWidth * scale) / 2;
    offsetY = (canvas.height - gridPixelHeight * scale) / 2;

    offsetX = Math.round(offsetX);
    offsetY = Math.round(offsetY);

    ctx.imageSmoothingEnabled = false;

    drawGrid();
    drawLiveViewGrid();

    window.addEventListener("resize", setCanvasSize);
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseout", handleMouseUp);
    canvas.addEventListener("wheel", handleMouseWheel, { passive: false });
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("touchcancel", handleTouchEnd);

    colorPicker.addEventListener("input", handleColorChange);
    if (customColorSwatch) {
      customColorSwatch.addEventListener("click", () => {
        colorPicker.click();
      });
    }
    placePixelBtn.addEventListener("click", handlePlacePixelClick);

    // Set up color history event listeners
    setupColorHistoryListeners();

    if (zoomInBtn) {
      zoomInBtn.addEventListener("click", () => {
        const rect = canvas.getBoundingClientRect();
        handleMouseWheel({
          deltaY: -1,
          clientX: rect.left + canvas.clientWidth / 2,
          clientY: rect.top + canvas.clientHeight / 2,
          preventDefault: () => {},
        });
      });
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener("click", () => {
        const rect = canvas.getBoundingClientRect();
        handleMouseWheel({
          deltaY: 1,
          clientX: rect.left + canvas.clientWidth / 2,
          clientY: rect.top + canvas.clientHeight / 2,
          preventDefault: () => {},
        });
      });
    }

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener("click", toggleDark);
    }

    window.reconnectButton = createReconnectButton();

    updateSelectedCoordsDisplay();
    setupWebSocket();

    document.addEventListener("keydown", handleKeyDown);

    await handleOAuthCallback();
    updateUserInterface();
    initTheme();

    console.log("Frontend initialized!");
  }

  init();
});
