export interface PreparedExecutionWorkspace {
  contextCwd: string;
  agentCwd: string;
  cleanup(): Promise<void>;
}

export async function prepareExecutionWorkspace(
  cwd: string,
): Promise<PreparedExecutionWorkspace> {
  return {
    contextCwd: cwd,
    agentCwd: cwd,
    cleanup: async () => {},
  };
}
