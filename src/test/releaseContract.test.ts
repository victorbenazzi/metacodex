import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("metacodex 1.0 release contract", () => {
  it("keeps the application version aligned across package manifests", () => {
    const packageJson = JSON.parse(read("package.json")) as { version: string };
    const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
      version: string;
    };
    const cargoManifest = read("src-tauri/Cargo.toml");

    expect(packageJson.version).toBe("1.0.0");
    expect(tauriConfig.version).toBe("1.0.0");
    expect(cargoManifest).toMatch(/^version = "1\.0\.0"$/m);
  });

  it("publishes the versioned notes and all public screenshots", () => {
    const notes = read("docs/releases/v1.0.0.md");
    const portugueseNotes = read("docs/releases/v1.0.0.pt-BR.md");
    const screenshots = [
      "workspace-overview.jpg",
      "browser-workflow.jpg",
      "whats-new.jpg",
    ];

    for (const screenshot of screenshots) {
      expect(notes).toContain(`/assets/v1.0.0/${screenshot}`);
      expect(portugueseNotes).toContain(`/assets/v1.0.0/${screenshot}`);
      expect(
        existsSync(new URL(`docs/releases/assets/v1.0.0/${screenshot}`, root)),
      ).toBe(true);
    }
  });

  it("loads the release body from the versioned notes", () => {
    const workflow = read(".github/workflows/release.yml");
    const qualityWorkflow = read(".github/workflows/quality.yml");

    expect(workflow).toContain("Load versioned release notes");
    expect(workflow).toContain('NOTES_PATH="docs/releases/${VERSION}.md"');
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
    expect(qualityWorkflow).toContain("checkout_ref:");
    expect(
      qualityWorkflow.match(
        /ref: \$\{\{ inputs\.checkout_ref \|\| github\.ref \}\}/g,
      ),
    ).toHaveLength(3);
  });
});
