// src/index.js

// Helper function to return a JSON response
const jsonResponse = (data, status = 200, headers = {}) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
};

// The Durable Object class for the grid state
export class GridDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = [];
    this.gridCache = null; // In-memory cache for the grid
    this.paletteCache = null; // In-memory cache for the palette
    this.state.blockConcurrencyWhile(async () => {
        await this.initialize();
    });
  }

  async initialize() {
    // Initialize palette if not already done
    if (!this.paletteCache) {
        const palette = await this.env.PALETTE_KV.get('default_palette', 'json');
        if (palette) {
            this.paletteCache = palette;
        } else {
            // Default palette if nothing in KV
            const defaultPalette = ['#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];
            await this.env.PALETTE_KV.put('default_palette', JSON.stringify(defaultPalette));
            this.paletteCache = defaultPalette;
        }
    }

    // Initialize grid if not already done
    const storedGrid = await this.state.storage.get('grid');
    if (!storedGrid) {
        const width = 500;
        const height = 500;
        // Initialize with the first color of the palette (white)
        const grid = new Uint8Array(width * height).fill(0);
        await this.state.storage.put('grid', grid);
        this.gridCache = grid;
    } else {
        this.gridCache = storedGrid;
    }
  }

  // RLE encoding for the grid
  encodeRLE(data) {
    if (!data || data.length === 0) {
      return new Uint8Array(0);
    }
    const encoded = [];
    let count = 1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === data[i + 1] && count < 255) {
        count++;
      } else {
        encoded.push(count);
        encoded.push(data[i]);
        count = 1;
      }
    }
    return new Uint8Array(encoded);
  }

  async getGridRLE() {
    if (!this.gridCache) {
        await this.initialize();
    }
    return this.encodeRLE(this.gridCache);
  }

  async updatePixel(x, y, color) {
    if (!this.gridCache || !this.paletteCache) {
        await this.initialize();
    }

    const colorIndex = this.paletteCache.indexOf(color);
    if (colorIndex === -1) {
      // Color not in palette, maybe add it or return error
      return; // Or handle error
    }

    const width = 500;
    const index = y * width + x;
    if (this.gridCache[index] !== colorIndex) {
      this.gridCache[index] = colorIndex;
      await this.state.storage.put('grid', this.gridCache);
      this.broadcast({ type: 'pixelUpdate', x, y, color });
    }
  }

  handleWebSocket(ws) {
    ws.accept();
    this.sessions.push(ws);

    ws.addEventListener('close', (event) => {
      this.sessions = this.sessions.filter((session) => session !== ws);
    });
    ws.addEventListener('error', (event) => {
      this.sessions = this.sessions.filter((session) => session !== ws);
    });
  }

  broadcast(message) {
    const serializedMessage = JSON.stringify(message);
    this.sessions.forEach((session) => {
      if (session.readyState === WebSocket.OPEN) {
        session.send(serializedMessage);
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/grid': {
        const rleGrid = await this.getGridRLE();
        return new Response(rleGrid, { headers: { 'Content-Type': 'application/octet-stream' } });
      }
      case '/pixel': {
        if (request.method === 'POST') {
          const { x, y, color } = await request.json();
          await this.updatePixel(x, y, color);
          return new Response('OK', { status: 200 });
        }
        return new Response('Method not allowed', { status: 405 });
      }
      case '/ws': {
        const [client, server] = Object.values(new WebSocketPair());
        this.handleWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
      }
      default:
        return new Response('Not found', { status: 404 });
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/grid' || path === '/pixel' || path === '/ws') {
        const id = env.GRID_STATE.idFromName('main-grid');
        const stub = env.GRID_STATE.get(id);
        return stub.fetch(request);
    }

    if (path === '/palette') {
        let palette = await env.PALETTE_KV.get('default_palette', 'json');
        if (!palette) {
            const defaultPalette = ['#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];
            await env.PALETTE_KV.put('default_palette', JSON.stringify(defaultPalette));
            palette = defaultPalette;
        }
        return jsonResponse({ palette });
    }

    if (path === '/auth/discord' && request.method === 'POST') {
        try {
            const { code, redirect_uri } = await request.json();
            const DISCORD_CLIENT_SECRET = env.DISCORD_CLIENT_SECRET;
            const DISCORD_CLIENT_ID = env.DISCORD_CLIENT_ID;

            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: DISCORD_CLIENT_ID,
                    client_secret: DISCORD_CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirect_uri,
                }),
            });

            if (!tokenResponse.ok) {
                const error = await tokenResponse.json();
                return jsonResponse({ message: 'Discord token exchange failed', error }, { status: 400 });
            }

            const tokenData = await tokenResponse.json();

            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                },
            });

            if (!userResponse.ok) {
                return jsonResponse({ message: 'Failed to fetch Discord user' }, { status: 400 });
            }

            const userData = await userResponse.json();

            return jsonResponse({
                access_token: tokenData.access_token,
                user: userData,
            });
        } catch (error) {
            return jsonResponse({ message: 'Authentication error', error: error.message }, { status: 500 });
        }
    }

    // For everything else, serve from the assets
    return env.ASSETS.fetch(request);
  },
};
