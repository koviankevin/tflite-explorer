// Shared capture/import/export budgets. Search keeps its separate work and
// cancellation budgets; increasing capture size must not remove those guards.
export const PATTERN_LIMITS=Object.freeze({operators:256,blocks:256,edges:4096,cfgNodes:4096,cfgEdges:8192});
