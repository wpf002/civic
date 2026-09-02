// Every source adapter produces the same shapes. Adapters never write positions.
export interface RawCandidate {
  fullName: string;
  externalIds: Record<string, string>;
  websiteUrl?: string;
  party?: string;
  officeTitle: string;
  jurisdictionName: string;
  districtName?: string;
  electionDate: string; // ISO
}

export interface RawDocument {
  url: string;
  kind: "CANDIDATE_WEBSITE" | "QUESTIONNAIRE" | "VOTING_RECORD" | "PUBLIC_STATEMENT" | "NEWS_INTERVIEW" | "DEBATE_TRANSCRIPT" | "SOCIAL_POST" | "OFFICIAL_FILING" | "OTHER";
  text: string;         // normalized plain text
  title?: string;
  publisher?: string;
  publishedAt?: string;
  candidateExternalId?: string;
}

export interface SourceAdapter {
  name: string;
  listCandidates(opts: { state: string; electionDate?: string }): Promise<RawCandidate[]>;
  fetchDocuments(candidate: RawCandidate): Promise<RawDocument[]>;
}
