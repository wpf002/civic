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
