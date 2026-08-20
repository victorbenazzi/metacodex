import { describe, expect, it } from "vitest";

import type { DevServer } from "./browser.service";
import { hostLabel, portOfUrl, serverForUrl, serverTitle } from "./identity";

const server = (partial: Partial<DevServer> & Pick<DevServer, "port">): DevServer => ({
  id: `session:1:${partial.port}`,
  address: "localhost",
  url: `http://localhost:${partial.port}`,
  sessionId: "session",
  ...partial,
});

describe("serverTitle", () => {
  it("prefers the metacodex project name", () => {
    expect(
      serverTitle(
        server({
          port: 5173,
          projectName: "metacodex",
          folderName: "/thermo-nuclear-code-quality-review",
        }),
        "External",
      ),
    ).toBe("metacodex");
  });

  it("falls back to the folder label for processes outside the registry", () => {
    expect(
      serverTitle(
        server({ port: 4321, folderName: "/thermo-nuclear-code-quality-review" }),
        "External",
      ),
    ).toBe("/thermo-nuclear-code-quality-review");
  });

  it("uses the external label when cwd is unknown", () => {
    expect(serverTitle(server({ port: 3000 }), "External")).toBe("External");
  });
});

describe("serverForUrl", () => {
  it("matches a URL to its server by port", () => {
    const servers = [server({ port: 1420, projectName: "metacodex" })];
    expect(serverForUrl("http://localhost:1420/", servers)?.projectName).toBe("metacodex");
  });
});

describe("hostLabel", () => {
  it("strips the scheme", () => {
    expect(hostLabel("http://localhost:1420")).toBe("localhost:1420");
  });
});

describe("portOfUrl", () => {
  it("reads an explicit port", () => {
    expect(portOfUrl("http://127.0.0.1:4321/pricing")).toBe(4321);
  });
});
