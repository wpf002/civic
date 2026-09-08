import { describe, expect, it, vi } from "vitest";
import { looksClientRendered, renderPage } from "./render.js";

describe("deciding when a browser is worth launching", () => {
  it("does not launch for a page that already has text", () => {
    // Rendering everything is twenty times the cost for a handful of sites.
    expect(looksClientRendered('<div id="root"></div>', "x".repeat(500))).toBe(false);
  });

  it("recognises the app shells the real failures had", () => {
    for (const shell of [
      '<html><body><div id="root"></div><script src="/static/js/main.a1b2.js"></script></body></html>',
      '<html><body><div id="__next"></div><script id="__NEXT_DATA__">{}</script></body></html>',
      '<html><body><div id="app" data-reactroot></div></body></html>',
      '<html><body><app-root ng-version="17.0"></app-root></body></html>',
    ]) {
      expect(looksClientRendered(shell, "Home About Donate")).toBe(true);
    }
  });

  it("does not launch for a genuinely short page or an empty response", () => {
    // A one-line page and a 404 are answers. Neither is worth a browser.
    expect(looksClientRendered("<html><body><p>Coming soon.</p></body></html>", "Coming soon.")).toBe(false);
    expect(looksClientRendered("", "")).toBe(false);
  });
});

describe("rendering", () => {
  it("returns the text and the URL it landed on, and always closes the browser", async () => {
    const close = vi.fn(async () => {});
    const contextClose = vi.fn(async () => {});
    const fake = async () =>
      ({
        newContext: async () => ({
          newPage: async () => ({
            route: async () => {},
            goto: async () => {},
            content: async () => "<html><body><main><p>I will vote to raise the minimum wage.</p></main></body></html>",
            url: () => "https://example.org/issues",
          }),
          close: contextClose,
        }),
        close,
      }) as never;

    const r = await renderPage("https://example.org/", { launchImpl: fake });
    expect(r.text).toContain("raise the minimum wage");
    expect(r.url).toBe("https://example.org/issues");
    expect(close).toHaveBeenCalled();
  });

  it("closes the browser even when the page throws", async () => {
    // A leaked browser process outlives the run and there is no cleanup path.
    const close = vi.fn(async () => {});
    const fake = async () =>
      ({
        newContext: async () => ({
          newPage: async () => ({
            route: async () => {},
            goto: async () => {
              throw new Error("net::ERR_CONNECTION_REFUSED");
            },
          }),
          close: async () => {},
        }),
        close,
      }) as never;

    await expect(renderPage("https://example.org/", { launchImpl: fake })).rejects.toThrow(/CONNECTION_REFUSED/);
    expect(close).toHaveBeenCalled();
  });
});
