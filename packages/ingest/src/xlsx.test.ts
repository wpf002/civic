import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { columnIndex, parseSharedStrings, parseSheet, readXlsx, readZip } from "./xlsx.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "adapters", "__fixtures__");
const me = readFileSync(join(here, "me-2026-general.xlsx"));
const co = readFileSync(join(here, "co-2026-general.xlsx"));

describe("empty cells", () => {
  it("keeps a self-closing cell as an empty column, not a shift", () => {
    // The bug this exists for: with the open-tag pattern matched first, `[^>]*`
    // consumes the trailing slash of `<c r="B2"/>`, the match hunts for the next
    // `</c>` and swallows the cells between. Every column after the first empty one
    // moves left, silently — Maine's file put candidate names in the suffix column.
    const xml =
      '<row><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1"/>' +
      '<c r="C1" t="inlineStr"><is><t>c</t></is></c></row>';
    expect(parseSheet(xml, [])).toEqual([["a", "", "c"]]);
  });

  it("reads the real Maine file with its columns in the right place", () => {
    const rows = readXlsx(me);
    const header = rows[0]!;
    expect(header.slice(0, 4)).toEqual(["Office", "Dist", "County", "Party"]);
    const collins = rows.find((r) => r[5] === "Collins")!;
    // Office, no district (statewide), party in the party column, town in the last.
    expect(collins[0]).toBe("US");
    expect(collins[1]).toBe("");
    expect(collins[3]).toBe("R");
    expect(collins[6]).toBe("Susan");
    expect(collins[9]).toBe("Bangor");
  });
});

describe("shared strings", () => {
  it("joins runs split by formatting, rather than keeping the first", () => {
    // A name broken across <t> runs would otherwise arrive truncated.
    expect(parseSharedStrings("<si><t>Smith</t><t>-Jones</t></si>")).toEqual(["Smith-Jones"]);
  });

  it("unescapes entities", () => {
    expect(parseSharedStrings("<si><t>Tom &amp; Jerry &#39;s</t></si>")).toEqual(["Tom & Jerry 's"]);
  });
});

describe("column references", () => {
  it.each([["A", 0], ["Z", 25], ["AA", 26], ["AB", 27], ["BA", 52]])("%s -> %i", (ref, i) => {
    expect(columnIndex(`${ref}1`)).toBe(i);
  });
});

describe("reading the container", () => {
  it("reads both real files", () => {
    expect(readXlsx(me).length).toBe(456);
    expect(readXlsx(co).length).toBe(406);
  });

  it("says what it found when a sheet is missing, rather than returning nothing", () => {
    expect(() => readXlsx(me, 9)).toThrow(/no xl\/worksheets\/sheet9\.xml/);
  });

  it("refuses a file that is not a zip", () => {
    expect(() => readZip(Buffer.from("<html>not a spreadsheet</html>"))).toThrow(/not a zip/);
  });
});
