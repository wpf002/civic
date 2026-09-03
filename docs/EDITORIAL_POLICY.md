# Editorial policy (draft, Phase 0 deliverable)

1. Every published position has at least one verbatim quote and a source URL.

   "Verbatim" means the candidate's words, in order, with their punctuation, taken from the
   archived copy of the source. The check ignores differences in whitespace and nothing else:
   archived pages are hard-wrapped, and an extractor that unwraps a line while copying has
   altered no words. Changed words, reordered words, changed punctuation (including a curly
   quote where the source has a straight one), or text joined from two passages all fail.
   On a match we store the span from the archived source rather than the extractor's rendering
   of it, so a stored quote is a byte-exact slice of the source by construction.
2. Summaries describe what the candidate says. No adjectives about the candidate. No motive.
3. Party, endorsements, and other candidates are never used to infer a position.
4. NO_STATED_POSITION is a first-class output and is shown as such. We do not fill gaps.
5. Issue taxonomy and question wording change only by written editorial decision with a changelog entry.
6. Every candidate in a covered race gets the same source-gathering effort. Coverage gaps are disclosed per race.
7. Corrections are public. Superseded positions stay in the history table.
8. User quiz answers are never stored server-side.

## Summary style guide

A **summary** is the at-most-two-sentence plain-language line under a candidate's stance chip. It describes what the candidate says they will do or believe, drawn from **one** source document, and sits directly above the verbatim quote it came from. It is drafted by a model and approved by a human reviewer. A summary that fails any rule below is rejected and redrafted — it is never published and edited later.

### Rules

1. **One source, one summary.** Every claim in the summary must be supported by the single source document the quote came from. If you need a second document to justify a sentence, that sentence does not belong.
2. **Report speech, not the speaker.** The summary says what the candidate says, proposes, opposes, or commits to. No adjectives describing the candidate (experienced, moderate, evasive, pro-business, progressive).
3. **No motive, no cause.** Never state why the candidate holds the position, who they are appealing to, or what they are responding to, unless the candidate says it in the source.
4. **No evaluation.** Never assert or imply that the policy would work, is affordable, is popular, or is a good idea. No "which would," "in order to reduce," or "to address the shortage."
5. **Name the actor in every verb.** Active voice, with the candidate or the body they would act in as the subject. "Would be reviewed" is a rejection; "she would direct the city manager to review" is a pass.
6. **Numbers, dates, and dollar figures must appear in the source.** No rounding, no converting a range to a point, no adding a fiscal year the candidate did not name. If the source is vague, the summary is vague in the same way.
7. **Match the stance chip's strength.** A SUPPORT summary states the position plainly. Hedges that erase the position ("seems open to," "has suggested he may") are rejections. NO_STATED_POSITION is written as an absence, never as a soft yes.
8. **Not a quote.** The summary is paraphrase in plain language. If it is a lightly trimmed copy of the quote below it, or contains quoted fragments, it is rejected — the quote is already on screen.
9. **Nothing from party, endorsements, or opponents.** Party label, slate, donor, or a rival's characterization may never appear in or inform a summary.
10. **Plain language, at most two sentences.** No jargon the candidate did not use; expand or drop terms like TIF, ADU, HB 3, recapture on first use. Ballot-relevant, present or future tense.

### Examples

| Bad | Good | What the bad one did |
|---|---|---|
| Veteran neighborhood advocate Renata Villalobos brings a practical approach to permitting, calling for a 30-day cap on residential plan review. | Villalobos would set a 30-day cap on residential plan review in the Development Services Department. | Adjectives about the candidate ("veteran," "practical"). The summary describes the person, not the policy. |
| Dewayne Marsh opposes the Pleasant Grove TIF extension because he wants to protect his base of longtime homeowners from displacement. | Marsh opposes extending the Pleasant Grove tax increment financing district past its current end date. | Imputed motive. The source states the position; the reason was invented. |
| As a Democrat, Kiara Odom supports raising the city's minimum wage for contracted workers. | Odom supports raising the required wage for city-contracted workers to $20 an hour. | Inferred from party, and the party label is doing the work of evidence. |
| "We cannot keep asking Oak Cliff to absorb every new shelter bed while District 13 absorbs none." | Sandoval opposes siting additional shelter beds in Oak Cliff until other council districts add capacity. | It is the quote, not a summary. It duplicates the verbatim line directly beneath it. |
| Trustee candidate Priya Raghunathan appears to be somewhat open to the idea of possibly revisiting the DISD start-time policy. | Raghunathan would move DISD high school start times to 8:30 a.m. or later. | Hedging that erases the position. If the source truly hedges, the stance is MIXED and the summary says plainly that the candidate did not commit. |
| Cardenas supports a homestead exemption increase to 20 percent, which would lower tax bills for Dallas homeowners and slow displacement in gentrifying neighborhoods. | Cardenas supports raising the city's homestead exemption to 20 percent. | Asserts the policy would work. The second clause is the guide predicting outcomes. |
| Boone supports expanding DART bus frequency, adding sidewalks along Lancaster Road, and rethinking the city's parking minimums. | Boone supports increasing DART bus frequency on high-ridership routes to every 15 minutes. | Scope creep. Sidewalks and parking minimums are not in the source document the quote came from. |
| Zoning changes near Fair Park would be paused while a community land trust is established. | Whitmore would ask the City Plan Commission to pause zoning changes near Fair Park until a community land trust is created. | Passive voice hides who acts. The reader cannot tell what the candidate would actually do. |
| Ellery Nakamura is generally supportive of stronger short-term rental enforcement. | Nakamura has not stated a position on short-term rental regulation in the sources we reviewed. | A NO_STATED_POSITION dressed as a weak SUPPORT. "Generally supportive" was not in the source. |
| State Rep. candidate Tobias Ferrell would add $4.2 billion to the basic allotment, raising it to $7,000 per student by fiscal 2029. | Ferrell says the basic allotment is too low and would vote to increase it. He did not name an amount. | False precision. The source said "raise the basic allotment"; the figures, the per-student number, and the year were fabricated. |

### Reviewer checklist

Run these three against every summary before approving it for publication:

1. **Underline every claim.** Can you point to the exact words in the source document that support each one? If not, cut the claim.
2. **Circle every adjective, causal word ("because," "to," "in order to"), and number.** Adjectives about the candidate, motive not stated by the candidate, and figures not in the source are all rejections.
3. **Cover the quote and read the summary alone.** Does it say plainly who would do what? If it reads as a hedge, a compliment, a criticism, or a copy of the quote, send it back.