import { Command } from "commander";
import { prisma } from "@civic/db";
import { persistRun } from "./run.js";
import { novemberCalendar, mayCalendar, iso, deadlinesNeedingReview } from "./adapters/tx-uniform-dates.js";
import { resolveDistricts } from "./adapters/districts.js";
import { fetchIsdRoster } from "./adapters/dallas-isd.js";
import { fetchCouncilRoster } from "./adapters/dallas-city-secretary.js";
import { fetchFederalRosters, formatFecName } from "./adapters/fec.js";
import {
  fetchCongressMemberSite,
  fetchCongressMembers,
  fetchFecSites,
  fetchOpenStatesPeople,
  preferSite,
  siteFromOpenStatesLinks,
  type CandidateSite,
} from "./adapters/candidate-sites.js";
import { NOVEMBER_2026, fetchCertifiedRoster } from "./adapters/tx-sos.js";
import { billKey, fetchMemberVotes, fetchRollCalls, rollCallUrl } from "./adapters/congress-votes.js";
import { resolveCouncilSeat, resolveFederalSeat } from "./seats.js";
import { proposePairsInRace } from "@civic/core";
import { createHash } from "node:crypto";
import { crawlCampaignSite } from "./crawl.js";
import { diffRoster, nameKey } from "./roster.js";

const program = new Command("civic-ingest");

program
  .command("calendar")
  .description("Generate the Texas statutory election calendar for a year. No network.")
  .requiredOption("--year <yyyy>")
  .action((o) => {
    for (const c of [mayCalendar(Number(o.year)), novemberCalendar(Number(o.year))]) {
      console.log(`\n${c.kind} ${iso(c.electionDate)}`);
      console.log(`  filing opens        ${iso(c.filingOpensAt)}`);
      console.log(`  filing deadline     ${iso(c.filingDeadline)}`);
      console.log(`  write-in deadline   ${iso(c.writeInFilingDeadline)}`);
      console.log(`  withdrawal deadline ${iso(c.withdrawalDeadline)}`);
      const review = deadlinesNeedingReview(c);
      if (review.length) {
        console.log(
          `  NEEDS CONFIRMATION (weekend, §1.006 may roll it): ` +
            review.map((r) => `${r.name} ${iso(r.date)}`).join(", "),
        );
      }
      console.log(`  derived from: ${c.derivedFrom}`);
    }
  });

program
  .command("districts")
  .description("Resolve an address to its districts. The address is discarded.")
  .requiredOption("--address <addr>")
  .action(async (o) => {
    const r = await resolveDistricts(o.address);
    if (!r) return console.log("no match");
    console.log(`matched: ${r.matchedAddress}`);
    for (const p of r.provenance) console.log(`  ${p.value.padEnd(38)} ${p.layer}`);
  });

program
  .command("roster")
  .description("Fetch a roster and diff it. Never writes; prints the verdict.")
  .requiredOption("--adapter <name>", "dallas-isd")
  .requiredOption("--election <yyyy-mm-dd>")
  .action(async (o) => {
    if (o.adapter !== "dallas-isd") throw new Error(`unknown adapter ${o.adapter}`);
    const run = await fetchIsdRoster(o.election, new Date());
    console.log(`page: ${run.page.url}`);
    console.log(`documents that could justify a removal: ${run.documents.length}`);
    for (const r of run.rosters) {
      const d = diffRoster(null, r);
      console.log(`\n${r.raceKey}  ${d.verdict}`);
      for (const e of r.entries) console.log(`  - ${e.name}`);
      for (const reason of d.reasons) console.log(`  ! ${reason}`);
    }
  });

program
  .command("ingest")
  .description("Fetch a roster and PERSIST it: snapshot, diff, and apply if additive.")
  .requiredOption("--adapter <name>", "dallas-isd | dallas-city-secretary | fec | tx-sos")
  .option("--sos-election <id>", "Texas SOS election id (default: 2026 November general)")
  .requiredOption("--election <slug>", "e.g. 2027-11-dallas")
  .requiredOption("--date <yyyy-mm-dd>", "the election date the source must match")
  .option("--dry-run")
  .action(async (o) => {
    // An adapter never creates a Race. Unresolvable rosters quarantine instead.
    let rosters;
    let basis: "FILED" | "CERTIFIED" = "FILED";
    let resolve: (raceKey: string) => Promise<string | null>;

    if (o.adapter === "dallas-isd") {
      rosters = (await fetchIsdRoster(o.date, new Date())).rosters;
      resolve = async (raceKey: string) => {
        const m = raceKey.match(/^disd-trustee-(\d+)$/);
        if (!m) return null;
        const race = await prisma.race.findFirst({
          where: {
            election: { slug: o.election },
            office: { title: { contains: "Trustee" }, district: { name: `District ${m[1]}` } },
          },
        });
        return race?.id ?? null;
      };
    } else if (o.adapter === "dallas-city-secretary") {
      const year = Number(String(o.date).slice(0, 4));
      const run = await fetchCouncilRoster(year, new Date());
      rosters = run.rosters;
      console.log(`basis: ${run.basis} (${run.sourceUrl})`);
      // Filed-vs-certified differences are printed, never merged into the roster.
      for (const r of run.reconciliation) {
        const notes = [
          r.filedOnly.length ? `filed but not on ballot: ${r.filedOnly.join(", ")}` : "",
          r.certifiedOnly.length ? `on ballot but never filed: ${r.certifiedOnly.join(", ")}` : "",
          ...r.probableRespellings.map((x) => `possible respelling: ${x.filed} / ${x.certified}`),
          r.placeholders ? `${r.placeholders} unnamed ballot line(s)` : "",
        ].filter(Boolean);
        if (notes.length) console.log(`  Place ${r.place}: ${notes.join("; ")}`);
      }
      resolve = async (raceKey: string) => {
        const { raceId, reason } = await resolveCouncilSeat(o.election, raceKey);
        if (!raceId) console.log(`  ! ${raceKey}: ${reason}`);
        return raceId;
      };
    } else if (o.adapter === "fec") {
      const cycle = Number(String(o.date).slice(0, 4));
      const run = await fetchFederalRosters("TX", cycle, new Date());
      rosters = run.rosters;
      console.log(
        `basis: ${run.basis} — ${run.candidateCount} statutory candidates across ` +
          `${run.rosters.length} races. FILED is not the ballot: the FEC does not know ` +
          `who qualified, so primary losers and inactive filers are included.`,
      );
      for (const m of run.merged) {
        console.log(`  merged ${m.raceKey}: ${m.name} held ${m.candidateIds.length} FEC ids (${m.candidateIds.join(", ")})`);
      }
      resolve = async (raceKey: string) => {
        const { raceId, reason } = await resolveFederalSeat(o.election, raceKey);
        if (!raceId) console.log(`  ! ${raceKey}: ${reason}`);
        return raceId;
      };
    } else if (o.adapter === "tx-sos") {
      const run = await fetchCertifiedRoster(Number(o.sosElection ?? NOVEMBER_2026), new Date());
      rosters = run.rosters;
      basis = "CERTIFIED";
      console.log(
        `basis: ${run.basis} — ${run.candidateCount} candidates in ${run.rosters.length} modelled races. ` +
          `This is the ballot, not the filers.`,
      );
      const unmappedTotal = run.unmapped.reduce((n, u) => n + u.count, 0);
      console.log(
        `  ${unmappedTotal} certified candidates are in ${run.unmapped.length} offices this product ` +
          `does not model yet (top: ${run.unmapped.slice(0, 3).map((u) => `${u.officeName} x${u.count}`).join(", ")})`,
      );
      resolve = async (raceKey: string) => {
        const { raceId, reason } = await resolveFederalSeat(o.election, raceKey);
        if (!raceId) console.log(`  ! ${raceKey}: ${reason}`);
        return raceId;
      };
    } else {
      throw new Error(`unknown adapter ${o.adapter}`);
    }

    const out = await persistRun(
      { adapter: o.adapter, electionSlug: o.election, basis, dryRun: !!o.dryRun },
      rosters,
      resolve,
    );
    for (const r of out.races) {
      console.log(`${r.raceKey.padEnd(20)} ${r.verdict}${r.applied ? " (applied)" : ""}`);
      if (r.added.length) console.log(`  + ${r.added.join(", ")}`);
      if (r.removed.length) console.log(`  - ${r.removed.join(", ")}`);
      for (const reason of r.reasons) console.log(`  ! ${reason}`);
    }
    await prisma.$disconnect();
  });

program
  .command("sites")
  .description("Find campaign websites for candidates, from FEC Form 1, OpenStates and Congress.gov.")
  .requiredOption("--election <slug>")
  .option("--state <xx>", "two-letter state", "TX")
  .option("--cycle <yyyy>", "FEC election year", (v) => Number(v), 2026)
  .option("--congress <n>", "Congress number for the official-site lookup", (v) => Number(v), 119)
  .option("--only-missing", "look up only candidates that have no website yet")
  .option("--dry-run")
  .action(async (o) => {
    const found = new Map<string, CandidateSite>();

    // Candidates already in this election, with whatever ids the ingest recorded.
    // Deliberately NOT refetching the roster to recover FEC ids: the first version of
    // this command did that and spent an entire hourly quota rediscovering ids that
    // were already stored.
    const candidates = await prisma.candidate.findMany({
      where: { candidacies: { some: { race: { election: { slug: o.election } } } } },
      select: { id: true, slug: true, fullName: true, websiteUrl: true, externalIds: true },
    });

    // 1. FEC Form 1. The campaign told the government its own address, which is the
    //    most direct assertion available and covers about half of filers.
    const nameByFecId = new Map<string, string>();
    for (const c of candidates) {
      const fec = (c.externalIds as { fec?: string } | null)?.fec;
      if (fec) nameByFecId.set(fec, c.fullName);
    }
    // A partial run leaves failed lookups behind. Re-running the whole state to
    // recover them costs another full quota, so --only-missing narrows to candidates
    // that still have no website. Failures and genuine absences are indistinguishable
    // from here, which is fine: looking again at both is exactly what is wanted.
    const needed = o.onlyMissing ? candidates.filter((c) => !c.websiteUrl) : candidates;
    const neededFec = new Set(
      needed.map((c) => (c.externalIds as { fec?: string } | null)?.fec).filter(Boolean) as string[],
    );
    const fecIds = [...nameByFecId.keys()].filter((id) => neededFec.has(id));
    if (o.onlyMissing) {
      console.log(`only-missing: ${needed.length} of ${candidates.length} candidates still have no website`);
    }
    const { sites: byFecId, failed: fecFailed } = await fetchFecSites(fecIds);
    for (const [id, site] of byFecId) {
      const name = nameByFecId.get(id);
      if (name) found.set(nameKey(name), site);
    }
    console.log(
      `FEC Form 1:    ${byFecId.size} of ${fecIds.length} federal candidates` +
        (fecFailed.length ? `  (${fecFailed.length} lookups FAILED — not the same as no website)` : ""),
    );

    // 2. Congress.gov, for sitting members. An official .gov site, tiered lower.
    let congressHits = 0;
    const bioguideByName = new Map<string, string>();
    for (const m of await fetchCongressMembers(o.state, o.congress)) {
      const site = await fetchCongressMemberSite(m.bioguideId);
      if (!site) continue;
      congressHits++;
      const key = nameKey(formatFecName(m.name));
      found.set(key, preferSite(found.get(key) ?? null, site)!);
      // The bioguide id is how a roll-call vote joins to a candidate. Recording it
      // here rather than matching names later: two members of one delegation have
      // shared a surname, and a vote attributed to the wrong person is unrecoverable.
      bioguideByName.set(key, m.bioguideId);
    }
    console.log(`Congress.gov:  ${congressHits} sitting members`);

    // 3. OpenStates, for sitting state legislators. Officeholders, never candidates —
    //    there is no candidate endpoint, so this adds no state roster.
    let osHits = 0;
    const people = await fetchOpenStatesPeople("Texas");
    for (const p of people) {
      const site = siteFromOpenStatesLinks(p.links ?? [], p.openstates_url);
      if (!site) continue;
      osHits++;
      const key = nameKey(p.name);
      found.set(key, preferSite(found.get(key) ?? null, site)!);
    }
    console.log(`OpenStates:    ${osHits} of ${people.length} sitting state legislators`);

    let wrote = 0;
    let already = 0;
    let bioguidesWritten = 0;
    for (const c of candidates) {
      const bioguide = bioguideByName.get(nameKey(c.fullName));
      if (bioguide && !(c.externalIds as { bioguide?: string } | null)?.bioguide && !o.dryRun) {
        await prisma.candidate.update({
          where: { id: c.id },
          data: {
            externalIds: {
              ...((c.externalIds as Record<string, string> | null) ?? {}),
              bioguide,
            },
          },
        });
        bioguidesWritten++;
      }
      const site = found.get(nameKey(c.fullName));
      if (!site) continue;
      if (c.websiteUrl === site.url) {
        already++;
        continue;
      }
      if (!o.dryRun) {
        await prisma.candidate.update({ where: { id: c.id }, data: { websiteUrl: site.url } });
      }
      wrote++;
    }

    // Report the state of the database, not the contents of this run's lookup map.
    // With --only-missing the map covers a narrowed set, and computing coverage from
    // it printed "27 of 241 (11%)" for a database that was 67% covered. A number whose
    // meaning changes with the flags is worse than no number.
    const total = await prisma.candidate.count({
      where: { candidacies: { some: { race: { election: { slug: o.election } } } } },
    });
    const withSite = await prisma.candidate.count({
      where: {
        candidacies: { some: { race: { election: { slug: o.election } } } },
        NOT: { websiteUrl: null },
      },
    });

    if (bioguidesWritten) console.log(`recorded ${bioguidesWritten} bioguide ids for vote lookup`);
    console.log(
      `\nthis run: ${wrote} written, ${already} already current` +
        (o.dryRun ? "  (dry run, nothing written)" : ""),
    );
    console.log(
      `${o.election}: ${withSite} of ${total} candidates have a website ` +
        `(${Math.round((100 * withSite) / Math.max(total, 1))}%)`,
    );
    console.log(
      `${total - withSite} have none recorded. That is recorded as none, not guessed at — ` +
        `a wrong website attributes one candidate's words to another.`,
    );
    if (fecFailed.length) {
      console.log(
        `${fecFailed.length} FEC lookups did not complete. Those are not absences; ` +
          `re-run with --only-missing to retry just them.`,
      );
    }
    await prisma.$disconnect();
  });

program
  .command("archive")
  .description("Crawl each candidate's site for pages that state positions, and store them as Sources.")
  .requiredOption("--election <slug>")
  .option("--certified-only", "only candidates on the certified ballot")
  .option("--concurrency <n>", "parallel sites", (v) => Number(v), 4)
  .option("--home-only", "fetch only the homepage (the old behaviour)")
  .action(async (o) => {
    const candidates = await prisma.candidate.findMany({
      where: {
        candidacies: { some: { race: { election: { slug: o.election } } }, ...(o.certifiedOnly ? { some: { race: { election: { slug: o.election } }, isCertified: true } } : {}) },
        NOT: { websiteUrl: null },
      },
      select: { id: true, fullName: true, websiteUrl: true },
    });
    console.log(`${candidates.length} candidates with a website`);

    let stored = 0, unchanged = 0, sitesWithPolicy = 0, sitesEmpty = 0;
    const outcomes: Record<string, number> = {};
    const empty: string[] = [];
    const queue = [...candidates];

    const worker = async () => {
      for (;;) {
        const c = queue.shift();
        if (!c) return;
        const r = await crawlCampaignSite(c.websiteUrl!, {
          ...(o.homeOnly ? { probePaths: [], maxLinks: 0 } : {}),
        });
        for (const [k, v] of Object.entries(r.outcomes)) outcomes[k] = (outcomes[k] ?? 0) + v;

        if (r.pages.length === 0) {
          sitesEmpty++;
          empty.push(`${c.fullName}: nothing archivable (${Object.keys(r.outcomes).join(", ") || "no pages"})`);
          continue;
        }
        // A site whose only page is the homepage is a poster. Counting it as covered
        // is what made the first yield number meaningless.
        if (r.pages.some((p) => p.via !== "home")) sitesWithPolicy++;

        for (const pg of r.pages) {
          const contentHash = createHash("sha256").update(pg.text).digest("hex");
          const existing = await prisma.source.findUnique({ where: { url_contentHash: { url: pg.url, contentHash } } });
          if (existing) { unchanged++; continue; }
          await prisma.source.create({
            data: {
              kind: "CANDIDATE_WEBSITE",
              tier: "CAMPAIGN_PLATFORM",
              url: pg.url,
              title: `${c.fullName} — ${pg.via === "home" ? "campaign website" : "policy page"}`,
              capturedAt: new Date(),
              contentHash,
              text: pg.text,
              candidateId: c.id,
            },
          });
          stored++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(o.concurrency, queue.length) }, worker));

    console.log(`\n${stored} pages archived, ${unchanged} unchanged`);
    console.log(`${sitesWithPolicy} of ${candidates.length} sites had a page beyond the homepage`);
    console.log(`${sitesEmpty} sites yielded nothing`);
    for (const [k, v] of Object.entries(outcomes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(16)} ${v}`);
    }
    for (const e of empty.slice(0, 12)) console.log(`  ! ${e}`);
    if (empty.length > 12) console.log(`  ... and ${empty.length - 12} more`);
    await prisma.$disconnect();
  });

program
  .command("votes")
  .description("Record how sitting members voted. Facts only — no interpretation of what a vote means.")
  .requiredOption("--election <slug>")
  .option("--congress <n>", "Congress number", (v) => Number(v), 119)
  .option("--session <n>", "session number", (v) => Number(v), 2)
  .option("--limit <n>", "roll calls to pull, newest first", (v) => Number(v), 60)
  .action(async (o) => {
    // Only candidates we can join a vote to. The bioguide id is the join, and it
    // comes from Congress.gov rather than from name matching — two members have
    // shared a surname in one delegation before.
    const candidates = await prisma.candidate.findMany({
      where: { candidacies: { some: { race: { election: { slug: o.election } } } } },
      select: { id: true, fullName: true, externalIds: true },
    });
    const byBioguide = new Map<string, { id: string; fullName: string }>();
    for (const c of candidates) {
      const b = (c.externalIds as { bioguide?: string } | null)?.bioguide;
      if (b) byBioguide.set(b, { id: c.id, fullName: c.fullName });
    }
    if (byBioguide.size === 0) {
      console.log(
        "No candidate carries a bioguide id yet. Run `sites` first — it reads the " +
          "Congress.gov member list and is where that id is recorded.",
      );
      await prisma.$disconnect();
      return;
    }
    console.log(`${byBioguide.size} sitting members in ${o.election}`);

    const rollCalls = await fetchRollCalls(o.congress, o.session, { limit: o.limit });
    console.log(`${rollCalls.length} roll calls in Congress ${o.congress} session ${o.session}`);

    let written = 0, unchanged = 0, skipped = 0;
    for (const rc of rollCalls) {
      const bill = billKey(rc);
      if (!bill) { skipped++; continue; } // a procedural vote with no bill attached
      const votes = await fetchMemberVotes(o.congress, o.session, rc.rollCallNumber);
      for (const v of votes) {
        const cand = byBioguide.get(v.bioguideId);
        if (!cand) continue;
        const existing = await prisma.voteRecord.findUnique({
          where: { candidateId_billId: { candidateId: cand.id, billId: bill } },
        });
        if (existing) { unchanged++; continue; }
        await prisma.voteRecord.create({
          data: {
            candidateId: cand.id,
            body: "U.S. House",
            billId: bill,
            billTitle: `${bill} — roll call ${rc.rollCallNumber} (${rc.result ?? "result unrecorded"})`,
            vote: v.voteCast.toUpperCase().replace(/\s+/g, "_"),
            votedAt: rc.startDate ? new Date(rc.startDate) : new Date(),
            sourceUrl: rollCallUrl(rc),
            // Deliberately empty. Which propositions a bill bears on is decided once
            // per bill by a reviewer, not inferred here from its number.
            issueSlugs: [],
          },
        });
        written++;
      }
    }

    console.log(`\n${written} votes recorded, ${unchanged} already held, ${skipped} roll calls had no bill`);
    console.log(
      "No vote has been interpreted. A vote becomes a position only when a reviewer " +
        "decides what a Yea on that bill means for a proposition — one decision per bill.",
    );
    await prisma.$disconnect();
  });

program
  .command("identities")
  .description("Propose candidate records that may be the same person. Never merges; opens review tasks.")
  .requiredOption("--election <slug>")
  .option("--apply", "write ReviewTasks (default is to print only)")
  .option("--merge-strong", "merge the strong proposals via the admin API")
  .option("--api <url>", "admin API base", process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000")
  .option("--reviewer <name>", "who is accountable for the merges")
  .action(async (o) => {
    const races = await prisma.race.findMany({
      where: { election: { slug: o.election } },
      include: {
        office: { include: { district: true } },
        candidacies: { include: { candidate: { select: { id: true, fullName: true, websiteUrl: true, externalIds: true } } } },
      },
    });

    let proposed = 0;
    let written = 0;
    const strongPairs: Array<{
      keepId: string; keepName: string; mergeId: string; mergeName: string; reason: string;
    }> = [];

    for (const race of races) {
      // Same-race is what makes this safe enough to propose at all: two Sylvia
      // Garcias on one ballot is vanishingly unlikely, two in Texas is certain.
      const people = race.candidacies.map((c) => c.candidate);
      for (const pair of proposePairsInRace(people)) {
        proposed++;
        const label = `${race.office.title} ${race.office.district?.name ?? race.office.seatLabel ?? ""}`.trim();
        const detail =
          `Possible duplicate in ${label}: "${pair.a.fullName}" and "${pair.b.fullName}" ` +
          `(${pair.confidence} — ${pair.reason}). ` +
          `Sources spell people differently; the record carrying the website is often not ` +
          `the record on the ballot. Merging is a removal, so confirm before applying.`;
        console.log(`${pair.confidence.padEnd(8)} ${label}: ${pair.a.fullName}  ||  ${pair.b.fullName}`);

        if (pair.confidence === "strong") {
          // Keep the record that is on the certified ballot: that is the name a voter
          // will see. The other record is usually the FEC filing, and it is the one
          // carrying the website worth absorbing.
          const aCert = race.candidacies.find((c) => c.candidateId === pair.a.id)?.isCertified ?? false;
          const bCert = race.candidacies.find((c) => c.candidateId === pair.b.id)?.isCertified ?? false;
          const [keepC, mergeC] = aCert && !bCert ? [pair.a, pair.b] : [pair.b, pair.a];
          strongPairs.push({
            keepId: keepC.id, keepName: keepC.fullName,
            mergeId: mergeC.id, mergeName: mergeC.fullName,
            reason: pair.reason,
          });
        }

        if (o.apply) {
          const existing = await prisma.reviewTask.findFirst({
            where: { kind: "CANDIDATE_PROFILE", targetId: pair.a.id, reason: { contains: pair.b.fullName }, resolvedAt: null },
          });
          if (!existing) {
            await prisma.reviewTask.create({
              data: { kind: "CANDIDATE_PROFILE", targetId: pair.a.id, reason: detail },
            });
            written++;
          }
        }
      }
    }

    console.log(
      `\n${proposed} proposed across ${races.length} races` +
        (o.apply ? `, ${written} new review tasks` : "  (no review tasks written; pass --apply)"),
    );

    if (!o.mergeStrong) {
      console.log("Nothing was merged. Merging two records deletes one, and that needs a person.");
      await prisma.$disconnect();
      return;
    }

    // Merging goes through the admin API rather than straight to the database, so it
    // takes the same path, the same checks and the same audit trail as a merge done
    // by hand in the review console. A second implementation would drift from it.
    if (!o.reviewer) throw new Error("--merge-strong requires --reviewer: someone is accountable for a removal");
    const token = process.env.ADMIN_TOKEN;
    if (!token || token === "change-me") throw new Error("ADMIN_TOKEN is not configured");

    let mergedOk = 0;
    const failures: string[] = [];
    for (const m of strongPairs) {
      const res = await fetch(`${o.api}/admin/candidates/merge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
          "x-reviewer": o.reviewer,
        },
        body: JSON.stringify({ keepId: m.keepId, mergeId: m.mergeId, note: m.reason }),
      });
      if (res.ok) {
        mergedOk++;
        console.log(`  merged "${m.mergeName}" into "${m.keepName}"`);
      } else {
        failures.push(`${m.keepName} / ${m.mergeName}: ${res.status} ${await res.text()}`);
      }
    }
    console.log(`\n${mergedOk} merged, ${failures.length} failed`);
    for (const f of failures) console.log(`  ! ${f}`);
    await prisma.$disconnect();
  });

program
  .command("heartbeat")
  .description("Assert every scheduled job ran recently. Railway documents no cron retry.")
  .option("--within-hours <n>", "expected max age of the newest run", (v) => Number(v), 26)
  .action(async (o) => {
    const expected = ["dallas-isd", "dallas-city-secretary"];
    const cutoff = new Date(Date.now() - o.withinHours * 3600_000);
    let bad = 0;
    for (const adapter of expected) {
      const last = await prisma.ingestRun.findFirst({
        where: { adapter },
        orderBy: { startedAt: "desc" },
      });
      if (!last) {
        console.log(`MISSING  ${adapter} — has never run`);
        bad++;
      } else if (last.startedAt < cutoff) {
        console.log(`STALE    ${adapter} — last ran ${last.startedAt.toISOString()}`);
        bad++;
      } else if (!last.finishedAt) {
        console.log(`HUNG     ${adapter} — started ${last.startedAt.toISOString()}, never finished`);
        bad++;
      } else {
        console.log(`ok       ${adapter} — ${last.startedAt.toISOString()} ${last.status}`);
      }
    }
    await prisma.$disconnect();
    // A job that never fires produces no error anywhere else. This is the error.
    if (bad > 0) process.exit(1);
  });

program.parseAsync();
