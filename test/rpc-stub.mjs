// A local JSON-RPC test double for unit-testing TRACE's on-chain verification
// logic (aquaClient). It answers only what a test scripts into it; it is never
// used by the application and its answers are never presented as chain data.
import { createServer } from "node:http";

export async function startRpcStub(handlers) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const msgs = JSON.parse(body);
      const one = async (m) => {
        calls.push(m);
        try {
          const h = handlers[m.method];
          if (!h) return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `stub: no handler for ${m.method}` } };
          const r = await h(m.params);
          if (r && r.__error) return { jsonrpc: "2.0", id: m.id, error: r.__error };
          return { jsonrpc: "2.0", id: m.id, result: r };
        } catch (e) {
          return { jsonrpc: "2.0", id: m.id, error: { code: -32000, message: e.message } };
        }
      };
      const out = Array.isArray(msgs) ? await Promise.all(msgs.map(one)) : await one(msgs);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

export const word = (v) => BigInt(v).toString(16).padStart(64, "0");
