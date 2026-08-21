import { describe, expect, it } from "vitest";

import type { DevServer } from "./devServers";
import { hostLabel, serverTitle } from "./identity";

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

describe("hostLabel", () => {
  it("strips the scheme", () => {
    expect(hostLabel("http://localhost:1420")).toBe("localhost:1420");
  });
});
