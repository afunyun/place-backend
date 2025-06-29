import { Hono } from "hono";

const PALETTE = [
  "#FFFFFF", // index 0 – background
  "#000000", // index 1 – black
  "#FF0000", // index 2 – red
  "#00FF00", // index 3 – green
  "#0000FF", // index 4 – blue
  "#FFFF00", // index 5 – yellow
  "#FF00FF", // index 6 – magenta
  "#00FFFF", // index 7 – cyan
  "#808080", // index 8 – gray
  "#800000", // index 9 – maroon
  "#008000", // index 10 – dark green
  "#000080", // index 11 – navy
  "#808000", // index 12 – olive
  "#800080", // index 13 – purple
  "#008080", // index 14 – teal
  "#C0C0C0", // index 15 – silver
  "#FF7F50", // index 16 – coral
  "#FFD700", // index 17 – gold
  "#ADFF2F", // index 18 – green yellow
  "#FF69B4", // index 19 – hot pink
  "#8A2BE2", // index 20 – blue violet
  "#D2691E", // index 21 – chocolate
  "#6495ED", // index 22 – cornflower blue
  "#DC143C", // index 23 – crimson
  "#B22222", // index 24 – firebrick
  "#FF4500", // index 25 – orange red
  "#2E8B57", // index 26 – sea green
  "#4682B4", // index 27 – steel blue
  "#6A5ACD", // index 28 – slate blue
  "#7FFF00", // index 29 – chartreuse
  "#FF8C00", // index 30 – dark orange
  "#9932CC", // index 31 – dark orchid
  "#FF1493", // index 32 – deep pink
  "#00BFFF", // index 33 – deep sky blue
  "#1E90FF", // index 34 – dodger blue
  "#32CD32", // index 35 – lime green
  "#FF6347", // index 36 – tomato
  "#40E0D0", // index 37 – turquoise
  "#BA55D3", // index 38 – medium orchid
  "#FF00FF", // index 39 – fuchsia
  "#7CFC00", // index 40 – lawn green
  "#FFB6C1", // index 41 – light pink
  "#ADD8E6", // index 42 – light blue
  "#90EE90", // index 43 – light green
  "#D3D3D3", // index 44 – light gray
  "#FFFAF0", // index 45 – floral white
  "#F0E68C", // index 46 – khaki
  "#E6E6FA", // index 47 – lavender
  "#FFF0F5", // index 48 – lavender blush
  "#FAFAD2", // index 49 – light goldenrod yellow
  "#FFE4E1", // index 50 – misty rose
  "#F5F5DC", // index 51 – beige
  "#FFF5EE", // index 52 – seashell
  "#F0FFF0", // index 53 – honeydew
  "#F0FFFF", // index 54 – azure
  "#F5FFFA", // index 55 – mint cream
  "#FFFFE0", // index 56 – light yellow
  "#FAF0E6", // index 57 – linen
  "#FFEBCD", // index 58 – blanched almond
  "#FFE4B5", // index 59 – moccasin
  "#FFDEAD", // index 60 – navajo white
  "#FFF8DC", // index 61 – cornsilk
  "#FDF5E6", // index 62 – old lace
  "#FFFFF0", // index 63 – ivory
  "#F8F8FF", // index 64 – ghost white
];
const INDEX = Object.fromEntries(PALETTE.map((c, i) => [c, i]));

const app = new Hono();

// CORS headers for all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Handle CORS preflight requests
app.options("*", () => {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
});

// Add endpoint to get the palette
app.get("/palette", (c) => {
  return c.json({ palette: PALETTE });
});

// Route: POST /auth/discord - Discord OAuth token exchange
app.post("/auth/discord", async (c) => {
  try {
    const { code, redirect_uri } = await c.req.json();

    if (!code) {
      return c.json(
        { message: "Missing authorization code" },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    // Get Discord client secret from environment
    if (!c.env.DISCORD_CLIENT_SECRET) {
      return c.json(
        { message: "Discord client secret not configured" },
        {
          status: 500,
          headers: corsHeaders,
        },
      );
    }

    if (!c.env.DISCORD_CLIENT_SECRET) {
      return c.json(
        { message: "Discord client secret not found" },
        {
          status: 500,
          headers: corsHeaders,
        },
      );
    }

    // Exchange code for access token
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

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Discord token exchange failed:", errorText);
      return c.json(
        { message: "Token exchange failed" },
        {
          status: 502,
          headers: corsHeaders,
        },
      );
    }

    const tokenData = await tokenResponse.json();

    // Get user profile
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error("Discord user fetch failed:", errorText);
      return c.json(
        { message: "User fetch failed" },
        {
          status: 502,
          headers: corsHeaders,
        },
      );
    }

    const userData = await userResponse.json();

    return c.json(
      {
        access_token: tokenData.access_token,
        user: {
          id: userData.id,
          username: userData.username,
          discriminator: userData.discriminator,
          avatar: userData.avatar,
        },
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    console.error("Discord OAuth error:", error);
    return c.json(
      { message: "Internal server error" },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
});

["/grid", "/pixel", "/ws"].forEach((p) =>
  app.all(p, (c) => {
    const stub = c.env.GRID_STATE.get(c.env.GRID_STATE.idFromName("global"));
    return stub.fetch(c.req.raw);
  }),
);

app.get("*", async (c) => {
  // Forward static file requests to the assets binding
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  GridDurableObject: GridDurableObject,
};

// --- Your Original Durable Object and Helper Functions ---
export class GridDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    this.grid = null;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        return new Response("Expected websocket", { status: 400 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      await this.handleWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!this.grid) {
      await this.loadGrid();
    }
    if (url.pathname === "/grid" && request.method === "GET") {
      // 1. Flatten the colour indexes
      const flat = new Uint8Array(500 * 500);
      let k = 0;
      for (let y = 0; y < 500; y++)
        for (let x = 0; x < 500; x++) flat[k++] = INDEX[this.grid[y][x]];

      // 2. Run-length encode: [count, colourIndex, count, colourIndex, …]
      const rle = [];
      let runColour = flat[0];
      let runLen = 1;
      for (let i = 1; i < flat.length; i++) {
        const c = flat[i];
        if (c === runColour && runLen < 255) runLen++;
        else {
          rle.push(runLen, runColour);
          runColour = c;
          runLen = 1;
        }
      }
      rle.push(runLen, runColour);

      return new Response(Uint8Array.from(rle), {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
    if (url.pathname === "/pixel" && request.method === "POST") {
      try {
        const token = extractBearerToken(request);
        if (!token) {
          return new Response(
            JSON.stringify({ message: "Authentication required" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }
        const user = await validateDiscordToken(token);
        if (!user) {
          return new Response(
            JSON.stringify({ message: "Invalid or expired token" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }
        const { x, y, color } = await request.json();
        if (
          x == null ||
          y == null ||
          !color ||
          x < 0 ||
          x >= 500 ||
          y < 0 ||
          y >= 500
        ) {
          return new Response(
            JSON.stringify({ message: "Invalid pixel data" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        this.grid[y][x] = color;
        await this.state.storage.put(`pixel:${x}:${y}`, color);
        await this.sendDiscordWebhook(x, y, color, user);
        this.broadcast({
          type: "pixelUpdate",
          x,
          y,
          color,
          user: { id: user.id, username: user.username },
        });
        return new Response(JSON.stringify({ message: "Pixel updated" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  }
  async loadGrid() {
    this.grid = Array(500)
      .fill(0)
      .map(() => Array(500).fill("#FFFFFF"));
    const pixels = await this.state.storage.list({ prefix: "pixel:" });
    for (const [key, color] of pixels) {
      const [, x, y] = key.split(":");
      if (this.grid[y] && this.grid[y][x] !== undefined) {
        this.grid[y][x] = color; // strings auto-coerce, no need parseInt
      }
    }
  }
  async handleWebSocket(webSocket) {
    webSocket.accept();
    this.sessions.add(webSocket);
    webSocket.addEventListener("close", () => {
      this.sessions.delete(webSocket);
    });
    webSocket.addEventListener("error", () => {
      this.sessions.delete(webSocket);
    });
  }
  async sendDiscordWebhook(x, y, color, user = null) {
    if (!this.env.DISCORD_WEBHOOK_URL) return;
    const fields = [
      { name: "Position", value: `(${x}, ${y})`, inline: true },
      { name: "Color", value: color.toUpperCase(), inline: true },
      { name: "Timestamp", value: new Date().toISOString(), inline: true },
    ];
    if (user) {
      fields.push({
        name: "User",
        value: `${user.username}#${user.discriminator || "0000"}`,
        inline: true,
      });
    }
    const webhookPayload = {
      embeds: [
        {
          title: "🎨 New Pixel Placed!",
          color: Number.parseInt(color.replace("#", ""), 16),
          fields,
          thumbnail: {
            url: `https://singlecolorimage.com/get/${color.replace(
              "#",
              "",
            )}/100x100`,
          },
        },
      ],
    };
    await fetch(this.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });
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
}
async function validateDiscordToken(token) {
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
function extractBearerToken(request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.substring(7);
}
