import "@testing-library/jest-dom/vitest";

/**
 * Node has no `navigator`. cli-registry reads `isWindows` at module load.
 */
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
  configurable: true,
});
