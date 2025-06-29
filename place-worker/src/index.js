/**
 * Grid configuration constants
 */
const GRID_WIDTH = 500;
const GRID_HEIGHT = 500;

/**
 * CORS headers for all responses
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Main Cloudflare Worker export
 * Handles HTTP requests and routes them to appropriate handlers
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Route: GET /grid - Return current grid state
    if (url.pathname === '/grid' && request.method === 'GET') {
      const gridState = env.GRID_STATE.get(env.GRID_STATE.idFromName('global'));
      const response = await gridState.fetch(request.clone());

      // Add CORS headers to the response
      const responseHeaders = {
        ...corsHeaders,
        'Content-Type': 'application/json',
      };

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // Route: POST /pixel - Update a pixel
    if (url.pathname === '/pixel' && request.method === 'POST') {
      const gridState = env.GRID_STATE.get(env.GRID_STATE.idFromName('global'));
      const response = await gridState.fetch(request.clone());

      // Add CORS headers to the response
      const responseHeaders = {
        ...corsHeaders,
        'Content-Type': 'application/json',
      };

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // Route: POST /auth/discord - Discord OAuth token exchange
    if (url.pathname === '/auth/discord' && request.method === 'POST') {
      try {
        const { code, redirect_uri } = await request.json();

        if (!code) {
          return new Response(
            JSON.stringify({ message: 'Missing authorization code' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }

        // Get Discord client secret from Secrets Store
        if (!env.DISCORD_CLIENT_SECRET) {
          return new Response(
            JSON.stringify({ message: 'Discord client secret not configured' }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }

        const discordClientSecret = await env.DISCORD_CLIENT_SECRET.get();
        if (!discordClientSecret) {
          return new Response(
            JSON.stringify({ message: 'Discord client secret not found' }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }

        // Exchange code for access token
        const tokenParams = new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: discordClientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri,
        });

        const tokenResponse = await fetch(
          'https://discord.com/api/oauth2/token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams,
          },
        );

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error('Discord token exchange failed:', errorText);
          return new Response(
            JSON.stringify({ message: 'Token exchange failed' }),
            {
              status: 502,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }

        const tokenData = await tokenResponse.json();

        // Get user profile
        const userResponse = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        if (!userResponse.ok) {
          const errorText = await userResponse.text();
          console.error('Discord user fetch failed:', errorText);
          return new Response(
            JSON.stringify({ message: 'User fetch failed' }),
            {
              status: 502,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }

        const userData = await userResponse.json();

        return new Response(
          JSON.stringify({
            access_token: tokenData.access_token,
            user: {
              id: userData.id,
              username: userData.username,
              discriminator: userData.discriminator,
              avatar: userData.avatar,
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      } catch (error) {
        console.error('Discord OAuth error:', error);
        return new Response(
          JSON.stringify({ message: 'Internal server error' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
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
      headers: corsHeaders,
    });
  },
};

/**
 * GridDurableObject class for managing grid state
 * Handles persistent storage and WebSocket connections
 */
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
        webSocket: client,
      });
    }

    // Initialize grid if not loaded
    if (!this.grid) {
      await this.loadGrid();
    }

    // Handle GET /grid
    if (url.pathname === '/grid' && request.method === 'GET') {
      return new Response(JSON.stringify(this.grid), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle POST /pixel
    if (url.pathname === '/pixel' && request.method === 'POST') {
      try {
        // Check for authentication
        const token = extractBearerToken(request);
        if (!token) {
          return new Response(
            JSON.stringify({ message: 'Authentication required' }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        // Validate Discord token
        const user = await validateDiscordToken(token);
        if (!user) {
          return new Response(
            JSON.stringify({ message: 'Invalid or expired token' }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        const { x, y, color } = await request.json();

        // Validate input
        if (
          x == null ||
          y == null ||
          !color ||
          x < 0 ||
          x >= GRID_WIDTH ||
          y < 0 ||
          y >= GRID_HEIGHT
        ) {
          return new Response(
            JSON.stringify({
              message:
                'Invalid pixel data. Coordinates or color missing/out of bounds.',
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        // Update grid
        this.grid[y][x] = color;

        // Save to durable storage
        await this.state.storage.put(`pixel:${x}:${y}`, color);

        // Send Discord webhook notification (with user info)
        await this.sendDiscordWebhook(x, y, color, user);

        // Broadcast to all WebSocket sessions (with user info)
        this.broadcast({
          type: 'pixelUpdate',
          x,
          y,
          color,
          user: { id: user.id, username: user.username },
        });

        return new Response(
          JSON.stringify({ message: 'Pixel updated successfully' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      } catch {
        return new Response(JSON.stringify({ message: 'Invalid JSON data' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }

  async loadGrid() {
    console.log('Loading grid from durable storage...');

    // Initialize default grid (white background)
    this.grid = Array(GRID_HEIGHT)
      .fill(0)
      .map(() => Array(GRID_WIDTH).fill('#FFFFFF'));

    // Load individual pixels from storage
    const pixels = await this.state.storage.list({ prefix: 'pixel:' });

    for (const [key, color] of pixels) {
      const [, x, y] = key.split(':');
      const pixelX = Number.parseInt(x);
      const pixelY = Number.parseInt(y);

      if (
        pixelX >= 0 &&
        pixelX < GRID_WIDTH &&
        pixelY >= 0 &&
        pixelY < GRID_HEIGHT
      ) {
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
      console.log(
        'WebSocket disconnected. Total sessions:',
        this.sessions.size,
      );
    });

    webSocket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.sessions.delete(webSocket);
    });
  }

  async sendDiscordWebhook(x, y, color, user = null) {
    try {
      if (!this.env.DISCORD_WEBHOOK_URL) {
        console.log('Discord webhook URL not configured');
        return;
      }

      const fields = [
        {
          name: 'Position',
          value: `(${x}, ${y})`,
          inline: true,
        },
        {
          name: 'Color',
          value: color.toUpperCase(),
          inline: true,
        },
        {
          name: 'Timestamp',
          value: new Date().toISOString(),
          inline: true,
        },
      ];

      // Add user information if available
      if (user) {
        fields.push({
          name: 'User',
          value: `${user.username}#${user.discriminator || '0000'}`,
          inline: true,
        });
      }

      const webhookPayload = {
        embeds: [
          {
            title: '🎨 New Pixel Placed!',
            color: Number.parseInt(color.replace('#', ''), 16),
            fields,
            thumbnail: {
              url: `https://singlecolorimage.com/get/${color.replace('#', '')}/100x100`,
            },
          },
        ],
      };

      const response = await fetch(this.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(webhookPayload),
      });

      if (!response.ok) {
        console.error(
          'Discord webhook failed:',
          response.status,
          await response.text(),
        );
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

/**
 * Helper function to validate Discord access token
 * @param {string} token - Discord access token
 * @returns {Promise<object|null>} User data if valid, null if invalid
 */
async function validateDiscordToken(token) {
  try {
    const response = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Token validation error:', error);
    return null;
  }
}

/**
 * Helper function to extract Bearer token from Authorization header
 * @param {Request} request - The request object
 * @returns {string|null} The token if found, null otherwise
 */
function extractBearerToken(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove 'Bearer ' prefix
}
