import type { SourceAdapter } from "./types.js";

// State legislators, districts, bills, votes. https://docs.openstates.org/api-v3/
export const openStates: SourceAdapter = {
  name: "openstates",
  async listCandidates() {
    throw new Error("TODO Phase 1");
  },
  async fetchDocuments() {
    throw new Error("TODO Phase 1");
  },
};
