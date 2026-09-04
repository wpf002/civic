import { describe, expect, it } from "vitest";
import { findVerbatim } from "@civic/core";
import { htmlToText } from "./html-text.js";

describe("htmlToText", () => {
  it("does not manufacture a space before punctuation at a tag boundary", () => {
    // The real shape from bazaldua4dallas.com.
    const html = "<p>For the past six years<em>,</em> Deputy Mayor Pro Tem Adam Bazaldua has been a fighter for District 7<span>—</span>championing safer neighborhoods.</p>";
    const text = htmlToText(html);
    expect(text).toBe(
      "For the past six years, Deputy Mayor Pro Tem Adam Bazaldua has been a fighter for District 7—championing safer neighborhoods.",
    );
    expect(text).not.toContain(" ,");
    expect(text).not.toContain(" —");
  });

  it("keeps a quote copied from the rendered page passing the verbatim gate", () => {
    // This is the whole point: a naive converter fails this and the failure is silent.
    const html = "<p>I will vote to end parking minimums<strong>,</strong> citywide<em>.</em></p>";
    const archived = htmlToText(html);
    const asAModelWouldCopyIt = "I will vote to end parking minimums, citywide.";
    expect(findVerbatim(archived, asAModelWouldCopyIt)).not.toBeNull();
  });

  it("turns block tags into line breaks and inline tags into nothing", () => {
    expect(htmlToText("<div>One</div><div>Two</div>")).toBe("One\nTwo");
    expect(htmlToText("<p>a <b>bold</b> word</p>")).toBe("a bold word");
  });

  it("drops scripts, styles and comments entirely", () => {
    const html = "<p>Real</p><script>var x='Fake'</script><style>.a{}</style><!-- hidden -->";
    expect(htmlToText(html)).toBe("Real");
  });

  it("decodes the entities campaign sites actually use", () => {
    expect(htmlToText("<p>Dallas&#8217; future &amp; our &ldquo;plan&rdquo;</p>")).toBe(
      "Dallas’ future & our “plan”",
    );
  });

  it("does not swallow a space between words", () => {
    expect(htmlToText("<span>parking</span><span> minimums</span>")).toBe("parking minimums");
    expect(htmlToText("<span>parking</span> <span>minimums</span>")).toBe("parking minimums");
  });

  it("joins across an inline tag without inventing a space", () => {
    // The distinction that makes the punctuation case work at all.
    expect(htmlToText("<p>re<em>-</em>elect</p>")).toBe("re-elect");
    expect(htmlToText("<p>re <em>-</em> elect</p>")).toBe("re - elect");
  });

  it("is deterministic", () => {
    const html = "<p>a<em>,</em> b</p>";
    expect(htmlToText(html)).toBe(htmlToText(html));
  });
});
