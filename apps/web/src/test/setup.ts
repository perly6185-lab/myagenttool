// Node 25+ (also observed on Node 26) exposes an experimental global
// `localStorage` accessor
// that returns undefined unless --localstorage-file is configured. It prevents
// jsdom from installing its own implementation, so give tests a deterministic,
// per-worker in-memory Storage instead of depending on a Node CLI flag or disk.
const values = new Map<string, string>();
const memoryLocalStorage: Storage = {
  get length() {
    return values.size;
  },
  clear() {
    values.clear();
  },
  getItem(key) {
    return values.get(String(key)) ?? null;
  },
  key(index) {
    return [...values.keys()][index] ?? null;
  },
  removeItem(key) {
    values.delete(String(key));
  },
  setItem(key, value) {
    values.set(String(key), String(value));
  },
};

for (const target of [globalThis, window]) {
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    enumerable: true,
    value: memoryLocalStorage,
    writable: true,
  });
}
