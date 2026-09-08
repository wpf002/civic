import { describe, expect, it } from "vitest";
import { candidateIssues, proposeMappings, stanceFromVote, type BillInput, type PropositionInput } from "./bills.js";
import type { CompleteFn } from "./llm.js";

const reply = (output: unknown): CompleteFn =>
  (async () => ({ model: "recorded", output, costCents: 0.1 })) as unknown as CompleteFn;

const PROPS: PropositionInput[] = [
  {
    id: "p1",
    issueSlug: "guns",
    text: "Require a background check on every gun sale, including sales between private individuals.",
    yesMeans: "Private sales would require a background check.",
    noMeans: "Private sales would not require a background check.",
  },
];

const BILL: BillInput = { billId: "HR 1", title: "A Bill", summary: "Does a thing." };

describe("a Nay is the opposite of a Yea", () => {
  it.each([
    ["Yea", "SUPPORT", "SUPPORT"],
    ["Nay", "SUPPORT", "OPPOSE"],
    ["Yea", "STRONG_OPPOSE", "STRONG_OPPOSE"],
    ["Nay", "STRONG_OPPOSE", "STRONG_SUPPORT"],
    ["Nay", "MIXED", "MIXED"],
  ])("%s on a bill where Yea means %s -> %s", (vote, yea, expected) => {
    expect(stanceFromVote(vote, yea)).toBe(expected);
  });

  it("treats Present and Not Voting as no answer, not as opposition", () => {
    // Turning an absence into a stance invents a position the member never took.
    expect(stanceFromVote("Present", "SUPPORT")).toBeNull();
    expect(stanceFromVote("Not Voting", "SUPPORT")).toBeNull();
    expect(stanceFromVote("NOT_VOTING", "SUPPORT")).toBeNull();
  });
});

describe("proposing a mapping", () => {
  it("writes nothing when the bill does not bear on the proposition", async () => {
    const r = await proposeMappings([BILL], PROPS, {
      dryRun: true,
      complete: reply({ bearsOn: false, yeaMeans: null, basis: "", reasoning: "Unrelated." }),
    });
    expect(r.pairsChecked).toBe(1);
    expect(r.proposed).toBe(0);
  });

  it("ignores a direction offered without a bearsOn", async () => {
    // A model that says "no, but if it did it would be SUPPORT" must produce nothing.
    const r = await proposeMappings([BILL], PROPS, {
      dryRun: true,
      complete: reply({ bearsOn: false, yeaMeans: "SUPPORT", basis: "x", reasoning: "y" }),
    });
    expect(r.proposed).toBe(0);
  });

  it("records a mapping with the sentence it was decided from", async () => {
    const r = await proposeMappings([BILL], PROPS, {
      dryRun: true,
      complete: reply({
        bearsOn: true,
        yeaMeans: "SUPPORT",
        basis: "The bill extends background check requirements to private transfers.",
        reasoning: "A Yea enacts the change the proposition describes.",
      }),
    });
    expect(r.proposed).toBe(1);
    expect(r.details[0]).toMatchObject({ billId: "HR 1", issueSlug: "guns", yeaMeans: "SUPPORT" });
  });

  it("checks every bill against every proposition", async () => {
    const bills = [BILL, { ...BILL, billId: "HR 2" }, { ...BILL, billId: "HR 3" }];
    const props = [PROPS[0]!, { ...PROPS[0]!, id: "p2", issueSlug: "healthcare" }];
    const r = await proposeMappings(bills, props, {
      dryRun: true,
      complete: reply({ bearsOn: false, yeaMeans: null, basis: "", reasoning: "" }),
    });
    expect(r.pairsChecked).toBe(6);
  });

  it("survives a model error without losing the rest of the run", async () => {
    let n = 0;
    const flaky: CompleteFn = (async () => {
      if (++n === 1) throw new Error("boom");
      return { model: "recorded", output: { bearsOn: false, yeaMeans: null, basis: "", reasoning: "" }, costCents: 0 };
    }) as unknown as CompleteFn;
    const r = await proposeMappings([BILL, { ...BILL, billId: "HR 2" }], PROPS, {
      dryRun: true,
      concurrency: 1,
      complete: flaky,
    });
    expect(r.pairsChecked).toBe(2);
  });
});

describe("the policy-area pre-filter", () => {
  const props = [
    { ...PROPS[0]! },
    { ...PROPS[0]!, id: "p2", issueSlug: "healthcare" },
    { ...PROPS[0]!, id: "p3", issueSlug: "immigration" },
  ];

  it("only asks about propositions the bill's subject could touch", async () => {
    const r = await proposeMappings(
      [{ ...BILL, policyArea: "Immigration" }],
      props,
      { dryRun: true, complete: reply({ bearsOn: false, yeaMeans: null, basis: "", reasoning: "" }) },
    );
    expect(r.pairsChecked).toBe(1);
  });

  it("checks everything when the subject is unknown, rather than dropping the bill", async () => {
    // Silently skipping would remove a vote from a candidate's record.
    for (const area of [null, undefined, "Some New Category"]) {
      const r = await proposeMappings([{ ...BILL, policyArea: area }], props, {
        dryRun: true,
        complete: reply({ bearsOn: false, yeaMeans: null, basis: "", reasoning: "" }),
      });
      expect(r.pairsChecked).toBe(3);
    }
  });

  it("maps crime bills to policing, criminal justice and guns", () => {
    expect(candidateIssues("Crime and Law Enforcement")).toEqual([
      "public-safety-policing",
      "criminal-justice",
      "guns",
    ]);
  });
});
