import type { SourceAdapter } from "./types.js";

// CSV-driven adapter for local races with no API. This is the one that matters for the pilot.
// data/manual/<election>/candidates.csv and data/manual/<election>/sources.csv
export const manual: SourceAdapter = {
  name: "manual",
  async listCandidates() {
    throw new Error("TODO Phase 1");
  },
  async fetchDocuments() {
    throw new Error("TODO Phase 1");
  },
};
