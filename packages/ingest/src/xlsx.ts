/**
 * A minimal xlsx reader.
 *
 * Several states publish their candidate list as a spreadsheet and nothing else.
 * An .xlsx is a ZIP of XML, and Node ships the inflate half of that, so this reads
 * one without adding a dependency to a project whose stack is deliberately fixed.
 *
 * It reads exactly what is needed: the shared string table and the cell values of
 * one sheet, as rows of strings. No formulas, no formatting, no dates-as-numbers
 * conversion, no writing. Anything beyond that should use a real library rather than
 * grow this file.
 */
import { inflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Read a ZIP from its central directory rather than by scanning local headers.
 *
 * The local header can carry a zeroed size with the real one in a trailing data
 * descriptor, which is exactly the case a naive scanner gets wrong — it reads a
 * truncated member and the failure looks like a corrupt spreadsheet.
 */
export function readZip(buf: Buffer): ZipEntry[] {
  // End of central directory: signature 0x06054b50, within the last 64KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file: no end-of-central-directory record");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // The local header's own name and extra lengths, which differ from the central
    // directory's and are what actually position the data.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    out.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const UNESCAPE: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeXml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => UNESCAPE[m] ?? m);
}

/** The shared string table. Cells of type "s" hold an index into this. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // A string can be split across several <t> runs by formatting. Joining them is
    // what keeps "Smith-Jones" from arriving as "Smith" with the rest dropped.
    const parts = [...si[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!));
    out.push(parts.join(""));
  }
  return out;
}

/** Column letters to a zero-based index: A=0, Z=25, AA=26. */
export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * One worksheet as rows of strings.
 *
 * Empty cells are preserved as empty strings rather than skipped: xlsx omits a cell
 * that has no value, so a row read by position would shift every later column left.
 */
export function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    // The self-closing form MUST be matched first. With the open-tag pattern first,
    // `[^>]*` happily consumes the trailing slash of `<c r="B2"/>`, the match then
    // hunts for the next `</c>` and swallows the cells in between — every column
    // after the first empty one shifts left, silently. Maine's file is full of them,
    // and the result was candidate names landing in the suffix column.
    for (const c of rowMatch[1]!.matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const attrs = c[1] ?? c[2] ?? "";
      const inner = c[3] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1] ?? "";
      const type = attrs.match(/t="([^"]+)"/)?.[1] ?? "";
      const idx = ref ? columnIndex(ref) : cells.length;
      while (cells.length < idx) cells.push("");

      let value = "";
      if (type === "inlineStr") {
        value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join("");
      } else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v !== undefined) value = type === "s" ? (shared[Number(v)] ?? "") : unescapeXml(v);
      }
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** Read the first worksheet of an xlsx as rows of strings. */
export function readXlsx(buf: Buffer, sheet = 1): string[][] {
  const entries = new Map(readZip(buf).map((e) => [e.name, e.data]));
  const sheetXml = entries.get(`xl/worksheets/sheet${sheet}.xml`);
  if (!sheetXml) {
    throw new Error(
      `xlsx has no xl/worksheets/sheet${sheet}.xml — found ${[...entries.keys()].filter((k) => k.startsWith("xl/worksheets/")).join(", ") || "no worksheets at all"}`,
    );
  }
  const shared = entries.has("xl/sharedStrings.xml")
    ? parseSharedStrings(entries.get("xl/sharedStrings.xml")!.toString("utf8"))
    : [];
  return parseSheet(sheetXml.toString("utf8"), shared);
}
