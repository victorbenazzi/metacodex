import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const rootPath = new URL("../../", import.meta.url).pathname;
const sourceExtensions = new Set([".js", ".rs", ".ts", ".tsx"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

describe("source ownership and structure limits", () => {
  const files = [
    ...sourceFiles(join(rootPath, "src")),
    ...sourceFiles(join(rootPath, "src-tauri", "src")),
  ];

  it("keeps every source file under 1000 lines", () => {
    const oversized = files
      .map((path) => ({
        path: relative(rootPath, path),
        lines: readFileSync(path, "utf8").split("\n").length,
      }))
      .filter(({ lines }) => lines > 1_000);

    expect(oversized).toEqual([]);
  });

  it("keeps operating system access out of frontend production modules", () => {
    const violations = files
      .filter((path) => path.startsWith(join(rootPath, "src")))
      .filter((path) => !path.includes(".test.") && !path.endsWith("/test/setup.ts"))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const forbidden = [
          /from\s+["'](?:node:)?fs["']/,
          /from\s+["'](?:node:)?child_process["']/,
          /\bDeno\./,
          /\bBun\.(?:file|spawn|write)\b/,
        ];
        return forbidden.some((pattern) => pattern.test(source))
          ? [relative(rootPath, path)]
          : [];
      });

    expect(violations).toEqual([]);
  });

  it("routes every frontend Tauri invocation through the IPC mirror", () => {
    const violations = files
      .filter((path) => path.startsWith(join(rootPath, "src")))
      .filter((path) => !path.includes(".test.") && !path.endsWith("src/lib/ipc.ts"))
      .filter((path) => /\binvoke\s*\(\s*["']/.test(readFileSync(path, "utf8")))
      .map((path) => relative(rootPath, path));

    expect(violations).toEqual([]);
  });
});
