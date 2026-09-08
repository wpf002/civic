import { describe, expect, it } from "vitest";
import { adminSessionToken } from "./admin-session.js";

const originalFetch = globalThis.fetch;

describe("a scripted run still acts as a person", () => {
  it("signs in and returns a real session token", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ token: "sess-abc" }) })) as never;
    try {
      const t = await adminSessionToken("http://api", {
        REVIEWER_EMAIL: "a@b.org",
        REVIEWER_PASSWORD: "correct-horse-battery",
      });
      expect(t).toBe("sess-abc");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails loudly rather than quietly downgrading to the shared token", async () => {
    // A wrong password must not silently fall through to the weaker path — the
    // whole point is that the run is attributable.
    globalThis.fetch = (async () => ({ ok: false, status: 401 })) as never;
    try {
      await expect(
        adminSessionToken("http://api", {
          REVIEWER_EMAIL: "a@b.org",
          REVIEWER_PASSWORD: "wrong",
          ADMIN_TOKEN: "a-shared-secret",
        }),
      ).rejects.toThrow(/could not sign in/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("says how to create an account when nothing is configured", async () => {
    await expect(adminSessionToken("http://api", {})).rejects.toThrow(/reviewers\.ts/);
  });

  it("uses the shared token only when no reviewer is configured at all", async () => {
    const t = await adminSessionToken("http://api", { ADMIN_TOKEN: "a-shared-secret" });
    expect(t).toBe("a-shared-secret");
  });

  it("does not treat the placeholder secret as configured", async () => {
    await expect(adminSessionToken("http://api", { ADMIN_TOKEN: "change-me" })).rejects.toThrow();
  });
});
