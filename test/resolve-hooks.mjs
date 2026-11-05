// Node ESM resolve hooks for importing the FRONTEND data layer and the
// Express API under plain Node (test-only):
//   - `react`/`react/*` → a local stub (hooks are never invoked at import
//     time; the frontend module's pure logic — adapters, demo paths — is what
//     the tests exercise). The web app builds `react` through Next, so it is
//     not present in the offline monorepo.
//   - `express`         → a local stub that records routes and dispatches
//     them in-process (no socket). The API tests exercise the real route
//     handlers this way; a real deployment uses real express.
//   - `@/*`             → ./src/*   (the Next.js path alias, which plain Node
//     cannot resolve).
//
// Plain Node already type-strips `.ts` files (the source is ESM, parsed by
// Node's built-in stripping), so we deliberately do NOT shortCircuit `.ts`
// with a forced module format — doing so would bypass the stripping and the
// app's `export`/`type` syntax would fail. We only rewrite the specifiers
// above; the rest flows through the default loader. Strictly test
// scaffolding, never loaded by the product.
import { pathToFileURL, fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url)); // …/TRACE/src/
const stubUrl = (f) => pathToFileURL(fileURLToPath(new URL(f, import.meta.url))).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "react" || specifier.startsWith("react/")) {
    return { url: stubUrl("./react-stub.mjs"), shortCircuit: true, format: "module" };
  }
  if (specifier === "express" || specifier.startsWith("express/")) {
    return { url: stubUrl("./express-stub.mjs"), shortCircuit: true, format: "module" };
  }
  if (specifier.startsWith("@/")) {
    // Extensionless "@/<path>" → the .ts source. Let the default loader strip
    // the types: resolve to the file URL and do not force a module format.
    const rest = specifier.slice(2);
    return nextResolve(pathToFileURL(srcDir + rest + ".ts").href, context);
  }
  return nextResolve(specifier, context);
}
