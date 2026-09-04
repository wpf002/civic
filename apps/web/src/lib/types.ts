import type { Stance } from "@civic/core";
import type { EvidenceRow, SourceRow } from "@/components/evidence";

export type { EvidenceRow, SourceRow };

export type Position = {
  id: string;
  stance: Stance;
  summary: string;
  confidence: number;
  publishedAt: string | null;
  supersedesId: string | null;
  issue: { slug: string; name: string; description: string; sortOrder: number };
  evidence: EvidenceRow[];
};

export type ElectionSummary = {
  slug: string;
  name: string;
  electionDate: string;
  counts: { races: number; candidates: number; positions: number; silent: number; stated: number };
};

export type IssueRow = {
  slug: string;
  name: string;
  description: string;
  candidates: number;
  stated: number;
  silent: number;
  distinctStances: number;
};

export type ElectionDetail = {
  slug: string;
  name: string;
  electionDate: string;
  regDeadline: string | null;
  earlyVoteFrom: string | null;
  earlyVoteTo: string | null;
  counts: { races: number; candidates: number; positions: number; silent: number };
  races: Array<{
    id: string;
    office: { title: string; jurisdiction: { name: string; level: string }; district: { name: string } | null };
  }>;
  issues: IssueRow[];
};

export type IssueCandidate = {
  slug: string;
  fullName: string;
  party: { name: string; abbreviation: string } | null;
  isIncumbent: boolean;
  ballotOrder: number | null;
  raceId: string;
  position: Position | null;
  sourcesRead: SourceRow[];
};

export type IssueComparison = {
  election: { slug: string; name: string; electionDate: string };
  issue: { slug: string; name: string; description: string };
  appliesToThisBallot: boolean;
  races: Array<{
    id: string;
    office: string;
    district: string | null;
    jurisdiction: string;
    level: string;
  }>;
  candidates: IssueCandidate[];
};

export type CandidateDetail = {
  slug: string;
  fullName: string;
  websiteUrl: string | null;
  bio: string | null;
  candidacies: Array<{
    electionSlug: string;
    electionName: string;
    electionDate: string;
    office: string;
    district: string | null;
    jurisdiction: string;
    termYears: number | null;
    party: { name: string; abbreviation: string } | null;
    isIncumbent: boolean;
    ballotOrder: number | null;
  }>;
  coverage: Array<{ slug: string; name: string; state: "stated" | "silent" | "declined" | "unattempted" }>;
  positions: Position[];
  sourcesRead: SourceRow[];
  votes: Array<{
    id: string;
    body: string;
    billId: string;
    billTitle: string;
    vote: string;
    votedAt: string;
    sourceUrl: string;
    issueSlugs: string[];
  }>;
};

export type QuizPayload = {
  election: { slug: string; name: string; electionDate: string };
  questions: Array<{
    id: string;
    prompt: string;
    issueSlug: string;
    issueName: string;
    issueDescription: string;
  }>;
  candidates: Array<{
    slug: string;
    fullName: string;
    party: string | null;
    isIncumbent: boolean;
    ballotOrder: number | null;
    office: string;
    district: string | null;
  }>;
  positions: Array<{
    candidateSlug: string;
    issueSlug: string;
    stance: Stance;
    summary: string;
    positionId: string;
  }>;
};
