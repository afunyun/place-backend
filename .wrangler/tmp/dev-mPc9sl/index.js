var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-gVRexq/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/index.js
var jsonResponse = /* @__PURE__ */ __name((data, status = 200, headers = {}) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}, "jsonResponse");
var GridDurableObject = class {
  static {
    __name(this, "GridDurableObject");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = [];
    this.gridCache = null;
    this.paletteCache = null;
    this.state.blockConcurrencyWhile(async () => {
      await this.initialize();
    });
  }
  async initialize() {
    if (!this.paletteCache) {
      const palette = await this.env.PALETTE_KV.get("default_palette", "json");
      if (palette) {
        this.paletteCache = palette;
      } else {
        const defaultPalette = ["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"];
        await this.env.PALETTE_KV.put("default_palette", JSON.stringify(defaultPalette));
        this.paletteCache = defaultPalette;
      }
    }
    const storedGrid = await this.state.storage.get("grid");
    if (!storedGrid) {
      const width = 500;
      const height = 500;
      const grid = new Uint8Array(width * height).fill(0);
      await this.state.storage.put("grid", grid);
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
      return;
    }
    const width = 500;
    const index = y * width + x;
    if (this.gridCache[index] !== colorIndex) {
      this.gridCache[index] = colorIndex;
      await this.state.storage.put("grid", this.gridCache);
      this.broadcast({ type: "pixelUpdate", x, y, color });
    }
  }
  handleWebSocket(ws) {
    ws.accept();
    this.sessions.push(ws);
    ws.addEventListener("close", (event) => {
      this.sessions = this.sessions.filter((session) => session !== ws);
    });
    ws.addEventListener("error", (event) => {
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
      case "/grid": {
        const rleGrid = await this.getGridRLE();
        return new Response(rleGrid, { headers: { "Content-Type": "application/octet-stream" } });
      }
      case "/pixel": {
        if (request.method === "POST") {
          const { x, y, color } = await request.json();
          await this.updatePixel(x, y, color);
          return new Response("OK", { status: 200 });
        }
        return new Response("Method not allowed", { status: 405 });
      }
      case "/ws": {
        const [client, server] = Object.values(new WebSocketPair());
        this.handleWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
      }
      default:
        return new Response("Not found", { status: 404 });
    }
  }
};
var src_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/grid" || path === "/pixel" || path === "/ws") {
      const id = env.GRID_STATE.idFromName("main-grid");
      const stub = env.GRID_STATE.get(id);
      return stub.fetch(request);
    }
    if (path === "/palette") {
      let palette = await env.PALETTE_KV.get("default_palette", "json");
      if (!palette) {
        const defaultPalette = ["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"];
        await env.PALETTE_KV.put("default_palette", JSON.stringify(defaultPalette));
        palette = defaultPalette;
      }
      return jsonResponse({ palette });
    }
    if (path === "/auth/discord" && request.method === "POST") {
      try {
        const { code, redirect_uri } = await request.json();
        const DISCORD_CLIENT_SECRET = env.DISCORD_CLIENT_SECRET;
        const DISCORD_CLIENT_ID = env.DISCORD_CLIENT_ID;
        const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri
          })
        });
        if (!tokenResponse.ok) {
          const error = await tokenResponse.json();
          return jsonResponse({ message: "Discord token exchange failed", error }, { status: 400 });
        }
        const tokenData = await tokenResponse.json();
        const userResponse = await fetch("https://discord.com/api/users/@me", {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`
          }
        });
        if (!userResponse.ok) {
          return jsonResponse({ message: "Failed to fetch Discord user" }, { status: 400 });
        }
        const userData = await userResponse.json();
        return jsonResponse({
          access_token: tokenData.access_token,
          user: userData
        });
      } catch (error) {
        return jsonResponse({ message: "Authentication error", error: error.message }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-gVRexq/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-gVRexq/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  GridDurableObject,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
