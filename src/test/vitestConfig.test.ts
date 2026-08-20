import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

describe("Vitest configuration", () => {
  it("discovers TypeScript and TSX tests with explicit environments", () => {
    const config = readFileSync(new URL("vite.config.ts", root), "utf8");

    expect(config).toContain('environment: "node"');
    expect(config).toContain('include: ["src/**/*.test.{ts,tsx}"]');
    expect(config).toContain('setupFiles: ["./src/test/setup.ts"]');
  });

  it("pins the package manager and browser test dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("package.json", root), "utf8"),
    ) as {
      packageManager?: string;
      devDependencies?: Record<string, string>;
    };

    expect(manifest.packageManager).toBe("pnpm@11.17.0");
    expect(manifest.devDependencies).toMatchObject({
      "@testing-library/react": expect.any(String),
      "@testing-library/user-event": expect.any(String),
      jsdom: expect.any(String),
    });
  });
});
