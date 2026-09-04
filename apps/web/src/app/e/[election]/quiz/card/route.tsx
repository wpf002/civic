import { ImageResponse } from "next/og";
import { api } from "@/lib/api";
import type { ElectionDetail } from "@/lib/types";

export const runtime = "nodejs";

/**
 * The share card carries POSITIONS, not a personality score.
 *
 * Nothing about the user is in the URL beyond issue and candidate slugs — no
 * answers, no percentage, no ordering of the full field, because a full ranking
 * is a near-unique fingerprint of an answer set.
 *
 * The stance track is plain divs with background colors, so it renders in Satori
 * exactly as it does in the app. Same encoding, twice.
 */
const SLOTS = ["STRONG_OPPOSE", "OPPOSE", "MIXED", "SUPPORT", "STRONG_SUPPORT"] as const;

const INK = "#14130f";
const GROUND = "#faf8f4";
const SOFT = "#6b675e";
const RULE = "#8a8377";

function Track({ stance }: { stance: string }) {
  const active = SLOTS.indexOf(stance as (typeof SLOTS)[number]);
  const strong = stance === "STRONG_SUPPORT" || stance === "STRONG_OPPOSE";
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {SLOTS.map((s, i) => (
        <div
          key={s}
          style={{
            width: 22,
            height: 13,
            background: i === active ? (strong ? INK : SOFT) : "transparent",
            border: i === active ? "none" : `1px solid ${RULE}`,
          }}
        />
      ))}
    </div>
  );
}

export async function GET(req: Request, ctx: { params: Promise<{ election: string }> }) {
  const { election: slug } = await ctx.params;
  const url = new URL(req.url);
  // Only slugs travel. i=<issue-slug>&c=<candidate-slug>:<stance>
  const issues = url.searchParams.getAll("i").slice(0, 3);
  const picks = url.searchParams.getAll("c").slice(0, 6);
  const answered = url.searchParams.get("n");
  const silent = url.searchParams.get("s");

  const e = await api<ElectionDetail>(`/v1/elections/${slug}`).catch(() => null);
  const nameOf = new Map(e?.issues.map((i) => [i.slug, i.name]) ?? []);
  // UTC: the date is stored at UTC midnight and must not shift a day west of Greenwich.
  const date = e
    ? new Date(e.electionDate).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: GROUND,
          color: INK,
          padding: 32,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, border: `1px solid ${INK}`, padding: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 30, fontWeight: 700, borderBottom: `3px solid ${INK}`, paddingBottom: 4 }}>
                Civic
              </div>
            </div>
            <div style={{ fontSize: 16, letterSpacing: 1.6, color: SOFT, textTransform: "uppercase" }}>
              {`${e?.name ?? "Election"} · ${date}`}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 44, flex: 1 }}>
            {issues.map((issueSlug, idx) => {
              const row = picks[idx]?.split(",") ?? [];
              return (
                <div key={issueSlug} style={{ display: "flex", alignItems: "center", gap: 24 }}>
                  <div style={{ fontSize: 34, flex: 1, display: "flex" }}>
                    {nameOf.get(issueSlug) ?? issueSlug}
                  </div>
                  <div style={{ display: "flex", gap: 36 }}>
                    {row.map((p) => {
                      const [who, stance] = p.split(":");
                      return (
                        <div key={p} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ fontSize: 18, fontWeight: 600 }}>{who}</div>
                          <Track stance={stance ?? "MIXED"} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {answered ? (
              <div style={{ fontSize: 20 }}>
                {`Based on ${answered} issues.${silent ? ` ${silent} had no stated position.` : ""}`}
              </div>
            ) : null}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderTop: `1px solid ${RULE}`,
                paddingTop: 14,
                fontSize: 18,
                color: SOFT,
              }}
            >
              <div>{`civic.vote/e/${slug}`}</div>
              <div>Not a voting recommendation</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
