import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

function leafKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("localization parity", () => {
  it("keeps English and Brazilian Portuguese keys equal", () => {
    const english = JSON.parse(
      readFileSync(new URL("src/features/i18n/locales/en.json", root), "utf8"),
    );
    const portuguese = JSON.parse(
      readFileSync(new URL("src/features/i18n/locales/pt-BR.json", root), "utf8"),
    );

    expect(leafKeys(english).sort()).toEqual(leafKeys(portuguese).sort());
  });
});
