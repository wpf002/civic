/**
 * Paging the home page's election list.
 *
 * Every state holds a general election on the same day, so the list runs to 51
 * entries while the address form is what most people came for. Paging is in the URL
 * rather than in client state, so a page can be linked, bookmarked, crawled and read
 * with JavaScript off, which is the same reason the rest of this app renders on the
 * server.
 */
export const PER_PAGE = 10;

export const pageCount = (total: number): number => Math.max(1, Math.ceil(total / PER_PAGE));

/** The page asked for, clamped to a page that exists. Anything unreadable is page 1. */
export function pageNumber(raw: string | undefined, total: number): number {
  const asked = Number(raw);
  if (!Number.isInteger(asked) || asked < 1) return 1;
  return Math.min(asked, pageCount(total));
}

/** Page 1 is the bare path; the rest carry the number and land on the list itself. */
export const pageHref = (page: number): string =>
  page <= 1 ? "/#elections" : `/?page=${page}#elections`;

/** The slice of a list a page shows, with where it starts for "11–20 of 51". */
export function pageSlice<T>(items: T[], page: number): { from: number; shown: T[] } {
  const from = (page - 1) * PER_PAGE;
  return { from, shown: items.slice(from, from + PER_PAGE) };
}
