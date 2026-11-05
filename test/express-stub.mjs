// Test-only express stub: records the routes `createApi` registers and can
// dispatch them in-process (no socket, no real express). The route handlers
// run for real — this stub only stands in for the framework's plumbing
// (path matching, req.params, res.status/json). NOT part of the product;
// registered via ./resolve-hooks.mjs for the API tests alone.
import { URL } from "node:url";

export function matchPath(pattern, path) {
  const p = pattern.split("/").filter(Boolean);
  const a = path.split("?")[0].split("/").filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

function makeApp() {
  const routes = [];
  const app = {
    routes,
    use(..._mw) {
      return app;
    },
    get(path, ...handlers) {
      routes.push({ method: "GET", path, handlers });
      return app;
    },
    post(path, ...handlers) {
      routes.push({ method: "POST", path, handlers });
      return app;
    },
    listen(_port, _cb) {
      // The offline API tests never bind a socket; a real deployment uses
      // real express, where this is the standard listen.
      return { address: () => ({ port: 0 }) };
    },
    /**
     * In-process dispatch: find the registered route, run its (async)
     * handlers with a synthetic req/res, resolve to the sent response.
     */
    async dispatch(method, url, body) {
      const pathOnly = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;
      const route = app.routes.find((r) => r.method === method && matchPath(r.path, pathOnly) != null);
      if (!route) return { status: 404, body: { error: `no route: ${method} ${pathOnly}` } };

      const params = matchPath(route.path, pathOnly);
      const req = {
        method,
        url,
        params,
        query: new URL(url, "http://x/").searchParams,
        body: body === undefined ? {} : body, // express.json() equivalent
      };
      let status = 200;
      let sent = null;
      const res = {
        status(code) {
          status = code;
          return res;
        },
        json(payload) {
          sent = payload;
          return res;
        },
        send(payload) {
          sent = payload;
          return res;
        },
        setHeader() {
          return res;
        },
      };
      for (const h of route.handlers) {
        await h(req, res);
        if (sent !== null) break; // the route sent its response
      }
      return { status, body: sent };
    },
  };
  return app;
}

// Mirrors the real default export: callable, with factory middlewares attached.
const express = () => makeApp();
express.json = () => () => {};
express.urlencoded = () => () => {};
export default express;
