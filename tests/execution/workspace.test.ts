import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { prepareExecutionWorkspace } from "../../src/execution/workspace.js";

describe("prepareExecutionWorkspace", () => {
  it("uses the real workspace", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-workspace-src-"));

    try {
      const workspace = await prepareExecutionWorkspace(cwd);
      expect(workspace.contextCwd).toBe(cwd);
      expect(workspace.agentCwd).toBe(cwd);
      await workspace.cleanup();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns a no-op cleanup", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-workspace-src-"));

    try {
      const workspace = await prepareExecutionWorkspace(cwd);
      await workspace.cleanup();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

