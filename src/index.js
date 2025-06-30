import { Hono } from "hono";
import defaultPalette from "../palette.json";

// Hono app setup
const app = new Hono();

// CORS headers are now centralized in the Durable Object for relevant responses
const corsMiddleware = async (c, next) => {
  // Handle preflight OPTIONS requests
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*", // TODO: Consider using a specific origin from env for production
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization", // Ensure this covers all request headers
        "Access-Control-Max-Age": "86400", // Cache preflight for 1 day
      },
    });
  }

  // For actual requests, call next() to get the response from the route handler.
  // This populates c.res.
  await next();

  // After the route handler has set c.res, modify its headers.
  // This ensures that CORS headers are applied to actual responses from GET, POST, etc.
  if (c.res) {
    c.res.headers.set("Access-Control-Allow-Origin", "*"); // TODO: Consider using a specific origin from env for production
    // If using specific origins and credentials, you might also need:
    // c.res.headers.set("Access-Control-Allow-Credentials", "true");
    // And vary by origin:
    // c.res.headers.append("Vary", "Origin");
  }
  // Hono sends c.res after the middleware stack completes.
};

app.use("*", corsMiddleware);


app.get("/palette", async (c) => {
  try {
    const paletteJson = await c.env.PALETTE_KV.get("colors");
    if (!paletteJson) {
      return c.json({ message: "Palette not configured in PALETTE_KV" }, 500);
    }
    const palette = JSON.parse(paletteJson);
    return c.json({ palette });
  } catch (error) {
    console.error("Failed to fetch palette:", error);
    return c.json({ message: "Could not retrieve palette." }, 500);
  }
});

app.post("/auth/discord", async (c) => {
  try {
    const { code, redirect_uri } = await c.req.json();
    if (!code || !c.env.DISCORD_CLIENT_SECRET) {
      return c.json({ message: "Invalid request or configuration" }, 400);
    }
    const tokenParams = new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID || "1388712213002457118",
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri,
    });
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams,
    });
    if (!tokenResponse.ok) return c.json({ message: "Token exchange failed" }, 502);
    const tokenData = await tokenResponse.json();
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResponse.ok) return c.json({ message: "User fetch failed" }, 502);
    const userData = await userResponse.json();
    return c.json({
      access_token: tokenData.access_token,
      user: {
        id: userData.id,
        username: userData.username,
        discriminator: userData.discriminator,
        avatar: userData.avatar,
      },
    });
  } catch (error) {
    console.error("Discord OAuth error:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

app.all(/grid.*/, (c) => c.redirect("/grid", 301));
app.all(/pixel.*/, (c) => c.redirect("/pixel", 301));
app.all(/ws.*/, (c) => c.redirect("/ws", 301));
["/grid", "/pixel", "/ws", "/batch-update"].forEach((p) =>
  app.all(p, (c) => {
    const stub = c.env.GRID_STATE.get(c.env.GRID_STATE.idFromName("global"));
    return stub.fetch(c.req.raw);
  }),
);

app.get("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  GridDurableObject: GridDurableObject,
};

// --- Durable Object for Grid State ---
export class GridDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    this.grid = null; // Lazily loaded
    this.palette = null; // Lazily loaded
    this.colorIndex = null; // Lazily computed
    // console.log(`[DO CONSTRUCTOR] New GridDurableObject instance created/rehydrated. ID: ${this.state.id.toString()}`);
  }

  async initialize() {
    // console.log("[DO INITIALIZE] Attempting initialization...");
    // Check all required members, not just grid and palette
    if (this.grid && this.palette && this.colorIndex) {
      // console.log("[DO INITIALIZE] Already initialized. Skipping.");
      return;
    }

    try {
      // console.log("[DO INITIALIZE] Starting storage and KV operations.");
      const gridPromise = this.state.storage
        .list({ prefix: "pixel:" })
        .then(async (pixels) => {
          // console.log(`[DO INITIALIZE STORAGE] Fetched ${pixels.size} pixel entries from storage.`);
          const gridData = Array(500).fill(0).map(() => Array(500).fill(null));
          for (const [key, color] of pixels) {
            const [, yStr, xStr] = key.split(":");
            const y = parseInt(yStr, 10);
            const x = parseInt(xStr, 10);

            if (!isNaN(y) && !isNaN(x) && y >= 0 && y < 500 && x >= 0 && x < 500) {
              gridData[y][x] = color;
            } else {
              console.warn(`[DO INITIALIZE STORAGE WARN] Malformed pixel key or out-of-bounds: ${key}, color: ${color}`);
            }
          }
          // console.log("[DO INITIALIZE STORAGE] Finished processing pixels from storage.");
          return gridData;
        })
        .catch(storageError => {
            console.error("[DO INITIALIZE STORAGE ERROR] Error listing from storage:", storageError);
            throw storageError; // Re-throw to be caught by outer try-catch
        });

      let paletteFromKV;
      try {
        paletteFromKV = await this.env.PALETTE_KV.get("colors", "json");
        // console.log(`[DO INITIALIZE KV] Palette from KV: ${paletteFromKV ? 'Found' : 'Not Found'}.`);
      } catch (kvError) {
        console.error("[DO INITIALIZE KV ERROR] Error fetching palette from KV:", kvError);
        // paletteFromKV will remain undefined, fallback to defaultPalette will occur.
      }

      const grid = await gridPromise;
      // console.log("[DO INITIALIZE] Grid data awaited.");

      this.palette = paletteFromKV || defaultPalette;
      // console.log(`[DO INITIALIZE PALETTE] Using ${paletteFromKV ? 'KV palette' : 'default palette'}. Palette length: ${this.palette ? this.palette.length : 'null'}`);

      if (!Array.isArray(this.palette) || this.palette.length === 0) {
        console.error("[DO INITIALIZE PALETTE ERROR] Palette is invalid (not an array or empty). Using emergency fallback palette.");
        this.palette = ["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF"]; // Basic emergency palette
      }
      // console.log(`[DO INITIALIZE PALETTE] Final palette chosen. First color (default bg): ${this.palette[0]}`);

      if (!paletteFromKV) {
        try {
          // console.log("[DO INITIALIZE KV] Attempting to persist default palette to KV.");
          // Use defaultPalette for persisting, not this.palette which might be an emergency one
          await this.env.PALETTE_KV.put("colors", JSON.stringify(defaultPalette));
        } catch (err) {
          console.warn("[DO INITIALIZE KV WARN] Failed to persist default palette to KV:", err);
        }
      }

      this.grid = grid.map(row => row.map(cell => (cell === null ? this.palette[0] : cell)));
      // console.log("[DO INITIALIZE GRID] Grid initialized with default background color. Grid rows:", this.grid.length);

      try {
        this.colorIndex = Object.fromEntries(this.palette.map((c, i) => {
          if (typeof c !== 'string') {
            console.warn(`[DO INITIALIZE COLORINDEX WARN] Invalid non-string color in palette at index ${i}: '${c}'. Using '#000000'.`);
            return ["#000000", i]; // Ensure the key is a string
          }
          return [c, i];
        }));
        // console.log(`[DO INITIALIZE COLORINDEX] Color index created. Entries: ${Object.keys(this.colorIndex).length}`);
      } catch (e) {
        console.error("[DO INITIALIZE COLORINDEX ERROR] Failed to create colorIndex:", e);
        // Fallback colorIndex based on the (potentially emergency) palette
        this.colorIndex = { [this.palette[0]]: 0 };
        if (this.palette.length > 1 && typeof this.palette[1] === 'string') this.colorIndex[this.palette[1]] = 1;
        console.warn("[DO INITIALIZE COLORINDEX WARN] Using fallback colorIndex:", this.colorIndex);
      }
      // console.log("[DO INITIALIZE] Initialization process completed.");

    } catch (error) {
      console.error("[DO INITIALIZE CRITICAL ERROR] Unhandled exception during initialization:", error.message, error.stack ? error.stack : error);
      this.grid = null;
      this.palette = null;
      this.colorIndex = null;
      throw error; // Re-throw to ensure the current request fails
    }
  }

  async fetch(request) {
    // console.log(`[DO FETCH] Request received: ${request.method} ${request.url}`);
    try { // Wrap entire fetch for top-level error catching
      // Ensure grid, palette, and colorIndex are loaded before proceeding
      if (!this.grid || !this.palette || !this.colorIndex) {
        // console.log("[DO FETCH] State not fully initialized, calling initialize().");
        await this.initialize(); // This might throw if initialization fails critically
        // After initialize, check again. If it threw, this point isn't reached.
        // If it didn't throw but somehow failed to set members, this is a critical safeguard.
        if (!this.grid || !this.palette || !this.colorIndex) {
            console.error("[DO FETCH CRITICAL] Initialization seemed to complete but state members are still null/undefined. This should not happen if initialize() succeeded or threw an error.");
            return new Response("Internal Server Error: DO state initialization failed post-attempt.", { status: 500 });
        }
        // console.log("[DO FETCH] Initialization complete after check.");
      }

      const url = new URL(request.url);
      if (url.pathname === "/ws") {
        const [client, server] = Object.values(new WebSocketPair());
        await this.handleWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
      }

      if (url.pathname === "/grid" && request.method === "GET") {
        // console.log("[DO FETCH /grid] Handling /grid GET request.");
        // console.log(`[DO FETCH /grid] Grid dimensions: ${this.grid.length}x${this.grid[0] ? this.grid[0].length : 'unknown'}. Palette size: ${this.palette.length}. ColorIndex entries: ${Object.keys(this.colorIndex).length}`);
        const flat = new Uint8Array(500 * 500);
        let k = 0;
        for (let y = 0; y < 500; y++) {
          for (let x = 0; x < 500; x++) {
            const colorValue = this.grid[y][x];
            const colorMapIndex = this.colorIndex[colorValue];

            if (colorMapIndex === undefined) {
              console.warn(`[DO FETCH /grid WARN] Color "${colorValue}" at (${x},${y}) not in colorIndex. Defaulting to index 0.`);
              // Log current palette and colorIndex for debugging this specific scenario
              // console.warn(`Current Palette: ${JSON.stringify(this.palette)}`);
              // console.warn(`Current ColorIndex: ${JSON.stringify(this.colorIndex)}`);
              flat[k++] = 0; // Default to index 0 (e.g., background)
            } else {
              flat[k++] = colorMapIndex;
            }
          }
        }
        // console.log("[DO FETCH /grid] Flat array populated.");

        const rle = [];
        // This check is mostly for safety, flat.length should be 250000
        if (flat.length === 0) {
          // console.warn("[DO FETCH /grid WARN] Flat array is empty, returning empty RLE.");
          return new Response(new Uint8Array(), {
            headers: { "Content-Type": "application/octet-stream" },
          });
        }

        let runColour = flat[0];
        let runLen = 1;
        for (let i = 1; i < flat.length; i++) {
          const c = flat[i];
          if (c === runColour && runLen < 255) {
            runLen++;
          } else {
            rle.push(runLen, runColour);
            runColour = c;
            runLen = 1;
          }
        }
        rle.push(runLen, runColour);
        // console.log(`[DO FETCH /grid] RLE encoding complete. RLE length: ${rle.length}`);

        return new Response(Uint8Array.from(rle), {
          headers: { "Content-Type": "application/octet-stream" },
        });
      }

      // CORS headers for /pixel and /batch-update POST responses
      // These are simple JSON responses, so Content-Type is application/json
      // Access-Control-Allow-Origin is handled by the global middleware, so not strictly needed here
      // unless we want to override or be more specific.
      const postCorsHeaders = {
        "Content-Type": "application/json",
        // "Access-Control-Allow-Origin": "*", // Already handled globally
      };

      if (url.pathname === "/pixel" && request.method === "POST") {
        try {
          const token = extractBearerToken(request);
          if (!token) {
            return new Response(JSON.stringify({ message: "Authentication required" }), { status: 401, headers: postCorsHeaders });
          }
          const user = await validateDiscordToken(token, this.env);
          if (!user) {
            return new Response(JSON.stringify({ message: "Invalid or expired token" }), { status: 401, headers: postCorsHeaders });
          }
          const { x, y, color } = await request.json();

          if (x == null || y == null || !color || x < 0 || x >= 500 || y < 0 || y >= 500 || !this.colorIndex.hasOwnProperty(color)) {
            return new Response(JSON.stringify({ message: "Invalid pixel data" }), { status: 400, headers: postCorsHeaders });
          }

          this.grid[y][x] = color;
          await this.state.storage.put(`pixel:${y}:${x}`, color);

          this.broadcast({ type: "pixelUpdate", x, y, color, user: { id: user.id, username: user.username } });
          await this.sendDiscordWebhook(x, y, color, user);

          return new Response(JSON.stringify({ message: "Pixel updated" }), { status: 200, headers: postCorsHeaders });
        } catch (e) { // Catch JSON parsing errors or other unexpected errors
          console.error("[DO FETCH /pixel ERROR]", e);
          return new Response(JSON.stringify({ message: "Invalid JSON or server error" }), { status: 400, headers: postCorsHeaders });
        }
      }

      if (url.pathname === "/batch-update" && request.method === "POST") {
        const secret = request.headers.get('X-Admin-Secret');
        if (secret !== this.env.RESTORE_SECRET) {
          return new Response('Unauthorized', { status: 401, headers: postCorsHeaders });
        }

        try {
          const pixels = await request.json();
          if (!Array.isArray(pixels)) {
            return new Response(JSON.stringify({ success: false, message: "Invalid payload, expected an array of pixels." }), { status: 400, headers: postCorsHeaders });
          }

          let updateCount = 0;
          const pixelUpdates = new Map();

          for (const { x, y, color } of pixels) {
            if (x >= 0 && x < 500 && y >= 0 && y < 500 && this.colorIndex.hasOwnProperty(color)) {
              this.grid[y][x] = color;
              pixelUpdates.set(`pixel:${y}:${x}`, color);
              updateCount++;
            }
          }

          if (pixelUpdates.size > 0) {
            await this.state.storage.put(pixelUpdates);
          }
          // console.log(`Batch update: ${updateCount} pixels updated.`);
          this.broadcast({ type: "grid-refreshed" });
          return new Response(JSON.stringify({ success: true, count: updateCount }), { headers: postCorsHeaders });

        } catch (e) {
          console.error("[DO BATCH-UPDATE ERROR]:", e);
          return new Response(JSON.stringify({ success: false, message: "Error processing batch." }), { status: 500, headers: postCorsHeaders });
        }
      }

      return new Response("Not Found by DO", { status: 404 });

    } catch (error) {
        // This is the outermost error handler for the fetch method.
        console.error(`[DO FETCH CRITICAL ERROR] Unhandled exception in fetch method for ${request.url}:`, error.message, error.stack ? error.stack : error);
        // Ensure a Response object is always returned.
        return new Response(`Internal Server Error: ${error.message || "Unknown error in Durable Object."}`, { status: 500 });
    }
  }

  async handleWebSocket(webSocket) {
      let runLen = 1;
      for (let i = 1; i < flat.length; i++) {
        const c = flat[i];
        if (c === runColour && runLen < 255) {
          runLen++;
        } else {
          rle.push(runLen, runColour);
          runColour = c;
          runLen = 1;
        }
      }
      rle.push(runLen, runColour);
      return new Response(Uint8Array.from(rle), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    if (url.pathname === "/pixel" && request.method === "POST") {
      try {
        const token = extractBearerToken(request);
        if (!token) {
          return new Response(JSON.stringify({ message: "Authentication required" }), { status: 401, headers: corsHeaders });
        }
        const user = await validateDiscordToken(token, this.env);
        if (!user) {
          return new Response(JSON.stringify({ message: "Invalid or expired token" }), { status: 401, headers: corsHeaders });
        }
        const { x, y, color } = await request.json();

        // Validate input
        if (x == null || y == null || !color || x < 0 || x >= 500 || y < 0 || y >= 500 || !this.colorIndex.hasOwnProperty(color)) {
          return new Response(JSON.stringify({ message: "Invalid pixel data" }), { status: 400, headers: corsHeaders });
        }

        this.grid[y][x] = color;
        // Persist only the changed pixel
        await this.state.storage.put(`pixel:${y}:${x}`, color);

        this.broadcast({ type: "pixelUpdate", x, y, color, user: { id: user.id, username: user.username } });
        await this.sendDiscordWebhook(x, y, color, user);

        return new Response(JSON.stringify({ message: "Pixel updated" }), { status: 200, headers: corsHeaders });
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }), { status: 400, headers: corsHeaders });
      }
    }

    // Batch update endpoint for the restore script
    if (url.pathname === "/batch-update" && request.method === "POST") {
      const secret = request.headers.get('X-Admin-Secret');
      if (secret !== this.env.RESTORE_SECRET) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }

      try {
        const pixels = await request.json();
        if (!Array.isArray(pixels)) {
          return new Response(JSON.stringify({ success: false, message: "Invalid payload, expected an array of pixels." }), { status: 400, headers: corsHeaders });
        }

        let updateCount = 0;
        const pixelUpdates = new Map();

        for (const { x, y, color } of pixels) {
          if (x >= 0 && x < 500 && y >= 0 && y < 500 && this.colorIndex.hasOwnProperty(color)) {
            this.grid[y][x] = color;
            pixelUpdates.set(`pixel:${y}:${x}`, color);
            updateCount++;
          }
        }

        // Batch persist all changed pixels
        if (pixelUpdates.size > 0) {
          await this.state.storage.put(pixelUpdates);
        }

        console.log(`Batch update: ${updateCount} pixels updated.`);

        // Broadcasting might be too much for large batches, so just send a generic update signal
        this.broadcast({ type: "grid-refreshed" });

        return new Response(JSON.stringify({ success: true, count: updateCount }), { headers: corsHeaders });

      } catch (e) {
        console.error("Batch update error:", e);
        return new Response(JSON.stringify({ success: false, message: "Error processing batch." }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response("Not Found", { status: 404 });
  }

  async handleWebSocket(webSocket) {
    webSocket.accept();
    this.sessions.add(webSocket);
    webSocket.addEventListener("close", () => { this.sessions.delete(webSocket) });
    webSocket.addEventListener("error", () => { this.sessions.delete(webSocket) });
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(messageStr);
      } catch {
        this.sessions.delete(session);
      }
    }
  }

  async sendDiscordWebhook(x, y, color, user = null) {
    if (!this.env.DISCORD_WEBHOOK_URL) return;
    const fields = [
      { name: "Position", value: `(${x}, ${y})`, inline: true },
      { name: "Color", value: color.toUpperCase(), inline: true },
    ];
    if (user) {
      fields.push({ name: "User", value: `${user.username}`, inline: true });
    }
    const webhookPayload = {
      embeds: [{
        title: "🎨 New Pixel Placed!",
        color: Number.parseInt(color.replace("#", ""), 16),
        fields,
        thumbnail: { url: `https://singlecolorimage.com/get/${color.replace("#", "")}/100x100` },
      }],
    };
    await fetch(this.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });
  }
}

// --- Helper Functions ---
function extractBearerToken(request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.substring(7);
}

async function validateDiscordToken(token, _env) {
  try {
    const response = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
