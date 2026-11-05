// Test-only stub so the frontend data layer (src/lib/live.ts) can be imported
// under plain Node. Hooks are never *called* at import time, so no-op
// exports are sufficient; the module's pure logic (adapters, demo paths) is
// what the tests exercise. NOT part of the app build.
export function useState(v) {
  return [v, () => {}];
}
export function useEffect() {}
export default {};
