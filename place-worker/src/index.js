// Grid configuration constants
const GRID_WIDTH = 500;
const GRID_HEIGHT = 500;

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Main Worker export
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    // Route: GET /grid - Return current grid state
    if (url.pathname === '/grid' && request.method === 'GET') {
      const gridState = env.GRID_STATE.get(env.GRID_STATE.idFromName('global'));
      const response = await gridState.fetch(request.clone());

      // Add CORS headers to the response
      const responseHeaders = {
        ...corsHeaders,
        'Content-Type': 'application/json'
      };

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    // Route: POST /pixel - Update a pixel
    if (url.pathname === '/pixel' && request.method === 'POST') {
      const gridState = env.GRID_STATE.get(env.GRID_STATE.idFromName('global'));
      const response = await gridState.fetch(request.clone());

      // Add CORS headers to the response
      const responseHeaders = {
        ...corsHeaders,
        'Content-Type': 'application/json'
      };

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    // Route: Root path - serve static assets or basic info
    if (url.pathname === '/') {
      return env.ASSETS.fetch(request);
    }

    // Route: WebSocket connection
    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected websocket', { status: 400 });
      }

      const gridState = env.GRID_STATE.get(env.GRID_STATE.idFromName('global'));
      return await gridState.fetch(request.clone());
    }

    // Default 404 response
    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders
    });
  }
};

// GridDurableObject class for managing grid state
export class GridDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    this.grid = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected websocket', { status: 400 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      await this.handleWebSocket(server);

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    // Initialize grid if not loaded
    if (!this.grid) {
      await this.loadGrid();
    }

    // Handle GET /grid
    if (url.pathname === '/grid' && request.method === 'GET') {
      return new Response(JSON.stringify(this.grid), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle POST /pixel
    if (url.pathname === '/pixel' && request.method === 'POST') {
      try {
        const { x, y, color } = await request.json();

        // Validate input
        if (x == null || y == null || !color ||
          x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) {
          return new Response(
            JSON.stringify({ message: 'Invalid pixel data. Coordinates or color missing/out of bounds.' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        // Update grid
        this.grid[y][x] = color;

        // Save to durable storage
        await this.state.storage.put(`pixel:${x}:${y}`, color);

        // Send Discord webhook notification
        await this.sendDiscordWebhook(x, y, color);

        // Broadcast to all WebSocket sessions
        this.broadcast({ type: 'pixelUpdate', x, y, color });

        return new Response(
          JSON.stringify({ message: 'Pixel updated successfully' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      } catch {
        return new Response(
          JSON.stringify({ message: 'Invalid JSON data' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    return new Response('Not Found', { status: 404 });
  }

  async loadGrid() {
    console.log('Loading grid from durable storage...');

    // Initialize default grid (white background)
    this.grid = Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill('#FFFFFF'));

    // Load individual pixels from storage
    const pixels = await this.state.storage.list({ prefix: 'pixel:' });

    for (const [key, color] of pixels) {
      const [, x, y] = key.split(':');
      const pixelX = parseInt(x);
      const pixelY = parseInt(y);

      if (pixelX >= 0 && pixelX < GRID_WIDTH && pixelY >= 0 && pixelY < GRID_HEIGHT) {
        this.grid[pixelY][pixelX] = color;
      }
    }

    console.log('Grid loaded with', pixels.size, 'custom pixels');
  }

  async handleWebSocket(webSocket) {
    webSocket.accept();
    this.sessions.add(webSocket);

    console.log('WebSocket connected. Total sessions:', this.sessions.size);

    webSocket.addEventListener('close', () => {
      this.sessions.delete(webSocket);
      console.log('WebSocket disconnected. Total sessions:', this.sessions.size);
    });

    webSocket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.sessions.delete(webSocket);
    });
  }

  async sendDiscordWebhook(x, y, color) {
    try {
      if (!this.env.DISCORD_WEBHOOK_URL) {
        console.log('Discord webhook URL not configured');
        return;
      }

      const webhookPayload = {
        embeds: [{
          title: "🎨 New Pixel Placed!",
          color: parseInt(color.replace('#', ''), 16),
          fields: [
            {
              name: "Position",
              value: `(${x}, ${y})`,
              inline: true
            },
            {
              name: "Color",
              value: color.toUpperCase(),
              inline: true
            },
            {
              name: "Timestamp",
              value: new Date().toISOString(),
              inline: true
            }
          ],
          thumbnail: {
            url: `https://singlecolorimage.com/get/${color.replace('#', '')}/100x100`
          }
        }]
      };

      const response = await fetch(this.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(webhookPayload)
      });

      if (!response.ok) {
        console.error('Discord webhook failed:', response.status, await response.text());
      }
    } catch (error) {
      console.error('Error sending Discord webhook:', error);
    }
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);

    // Remove closed connections and broadcast to active ones
    const toRemove = [];
    for (const session of this.sessions) {
      try {
        session.send(messageStr);
      } catch (error) {
        console.error('Error sending to WebSocket:', error);
        toRemove.push(session);
      }
    }

    // Clean up closed connections
    for (const session of toRemove) {
      this.sessions.delete(session);
    }
  }
}
