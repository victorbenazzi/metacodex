import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("metacodex 1.0.2 release contract", () => {
  it("keeps the application version aligned across package manifests", () => {
    const packageJson = JSON.parse(read("package.json")) as { version: string };
    const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
      version: string;
    };
    const cargoManifest = read("src-tauri/Cargo.toml");

    expect(packageJson.version).toBe("1.0.2");
    expect(tauriConfig.version).toBe("1.0.2");
    expect(cargoManifest).toMatch(/^version = "1\.0\.2"$/m);
  });

  it("publishes bilingual Linux release notes", () => {
    const notes = read("docs/releases/v1.0.2.md");
    const portugueseNotes = read("docs/releases/v1.0.2.pt-BR.md");

    expect(notes).toContain("## Linux fixes");
    expect(portugueseNotes).toContain("## Correções no Linux");
    expect(notes).toContain("metacodex_1.0.2_amd64.deb");
    expect(notes).toContain("metacodex-1.0.2-1.x86_64.rpm");
    expect(portugueseNotes).toContain("metacodex_1.0.2_amd64.deb");
  });

  it("loads the release body from the versioned notes", () => {
    const workflow = read(".github/workflows/release.yml");
    const qualityWorkflow = read(".github/workflows/quality.yml");

    expect(workflow).toContain("Load versioned release notes");
    expect(workflow).toContain('NOTES_PATH="docs/releases/v${VERSION}.md"');
    expect(workflow).toContain(
      'NOTES_PATH="docs/releases/v${STABLE_VERSION}.md"',
    );
    expect(workflow).toContain(
      "releaseBody: ${{ steps.release-notes.outputs.body }}",
    );
    expect(workflow).toContain("prerelease: ${{ contains(");
    expect(workflow).toContain("releaseDraft: true");
    expect(workflow).toMatch(/finalize-release:\s*[\s\S]*?needs:\s*publish-tauri/);
    expect(workflow).toContain('gh release edit "$RELEASE_TAG"');
    expect(workflow).toContain(
      "checkout_ref: ${{ github.event.inputs.tag || github.ref }}",
    );
    expect(workflow).toContain("node-version: 22");
    expect(workflow).not.toContain("node-version: 20");
    expect(workflow).toContain("--bundles deb,rpm");
    expect(workflow).not.toContain("macos-latest");
    expect(workflow).not.toContain("windows-latest");
    expect(qualityWorkflow).toContain("checkout_ref:");
    expect(
      qualityWorkflow.match(
        /ref: \$\{\{ inputs\.checkout_ref \|\| github\.ref \}\}/g,
      ),
    ).toHaveLength(3);
  });
});
