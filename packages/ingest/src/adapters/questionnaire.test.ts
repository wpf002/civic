import { describe, expect, it } from "vitest";
import { TEMPLATE_HEADER, parseQuestionnaire } from "./questionnaire.js";

const csv = (...rows: string[]) => [TEMPLATE_HEADER, ...rows].join("\n") + "\n";

describe("a questionnaire answer needs a source", () => {
  it("accepts an answer with the candidate's words and a URL", () => {
    const r = parseQuestionnaire(
      csv('chad-west,guns,SUPPORT,"I support universal background checks.",https://example.org/q,LWV Dallas,LWV,2026-09-01'),
    );
    expect(r.rejected).toEqual([]);
    expect(r.answers[0]).toMatchObject({
      candidateSlug: "chad-west",
      issueSlug: "guns",
      stance: "SUPPORT",
      publisher: "LWV",
    });
  });

  it("refuses a stance with no quote", () => {
    // This is the one path with no model between the file and a published claim, so
    // an unsourced assertion about a person must not get through.
    const r = parseQuestionnaire(csv("chad-west,guns,SUPPORT,,https://example.org/q,,,"));
    expect(r.answers).toEqual([]);
    expect(r.rejected[0]!.why).toMatch(/own words/);
  });

  it("refuses an answer with no URL a reader can check", () => {
    const r = parseQuestionnaire(csv('chad-west,guns,SUPPORT,"I support checks.",,,,'));
    expect(r.rejected[0]!.why).toMatch(/source_url is required/);
  });

  it("refuses a URL that is not one", () => {
    const r = parseQuestionnaire(csv('chad-west,guns,SUPPORT,"I support checks.",not-a-url,,,'));
    expect(r.rejected[0]!.why).toMatch(/is not a URL/);
  });
});

describe("absences", () => {
  it("accepts one with no quote", () => {
    const r = parseQuestionnaire(csv("chad-west,guns,NO_STATED_POSITION,,https://example.org/q,,,"));
    expect(r.rejected).toEqual([]);
    expect(r.answers[0]!.stance).toBe("NO_STATED_POSITION");
  });

  it("refuses one that carries a quote", () => {
    // A quote is the candidate saying something, which is not what "no stated
    // position" means. Storing both would publish a contradiction.
    const r = parseQuestionnaire(
      csv('chad-west,guns,NO_STATED_POSITION,"Actually I do support checks.",https://example.org/q,,,'),
    );
    expect(r.answers).toEqual([]);
    expect(r.rejected[0]!.why).toMatch(/cannot carry a quote/);
  });
});

describe("bad files", () => {
  it("names the missing columns rather than parsing to nothing", () => {
    const r = parseQuestionnaire("candidate_slug,stance\nchad-west,SUPPORT\n");
    expect(r.rejected[0]!.why).toMatch(/missing columns: issue_slug, quote, source_url/);
  });

  it("refuses an unknown stance", () => {
    const r = parseQuestionnaire(csv('chad-west,guns,MOSTLY_AGREES,"x",https://example.org/q,,,'));
    expect(r.rejected[0]!.why).toMatch(/is not a stance/);
  });

  it("reports the line number, and keeps the good rows", () => {
    const r = parseQuestionnaire(
      csv(
        'a,guns,SUPPORT,"ok",https://example.org/1,,,',
        "b,guns,NONSENSE,x,https://example.org/2,,,",
        'c,guns,OPPOSE,"ok",https://example.org/3,,,',
      ),
    );
    expect(r.answers.map((a) => a.candidateSlug)).toEqual(["a", "c"]);
    expect(r.rejected).toEqual([{ row: 3, why: '"NONSENSE" is not a stance' }]);
  });
});
