import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "@civic/db";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { createReviewer, hashPassword, login, reviewerFromToken, verifyPassword } from "./auth.js";

const EMAIL = "zz-auth-test@example.org";
const PASSWORD = "correct-horse-battery-staple";

let app: FastifyInstance;

beforeAll(async () => {
  process.env.ADMIN_TOKEN = "test-admin-token";
  await prisma.reviewerSession.deleteMany({ where: { reviewer: { email: EMAIL } } });
  await prisma.reviewer.deleteMany({ where: { email: EMAIL } });
  await createReviewer(EMAIL, "ZZ Auth Test", PASSWORD);
  app = Fastify();
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(adminRoutes, { prefix: "/admin" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.reviewerSession.deleteMany({ where: { reviewer: { email: EMAIL } } });
  await prisma.reviewer.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

describe("passwords", () => {
  it("is never stored reversibly", async () => {
    const r = await prisma.reviewer.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(r.passwordHash).not.toContain(PASSWORD);
    expect(r.salt).toBeTruthy();
    expect(await verifyPassword(PASSWORD, r.passwordHash, r.salt)).toBe(true);
    expect(await verifyPassword("wrong", r.passwordHash, r.salt)).toBe(false);
  });

  it("salts per user, so the same password hashes differently", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a.hash).not.toBe(b.hash);
  });

  it("refuses a short password", async () => {
    await expect(createReviewer("zz-short@example.org", "x", "short")).rejects.toThrow(/12 characters/);
  });
});

describe("logging in", () => {
  it("gives the same answer for a wrong password and an unknown email", async () => {
    // Distinguishing them tells an attacker which addresses are real.
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: "not the password" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@example.org", password: "not the password" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("never stores the session token itself", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    const { token } = res.json();
    // Reading the database must not hand anyone a live session.
    const rows = await prisma.reviewerSession.findMany({ where: { reviewer: { email: EMAIL } } });
    for (const s of rows) expect(s.tokenHash).not.toBe(token);
    expect(await reviewerFromToken(token)).toMatchObject({ email: EMAIL });
  });
});

describe("revocation", () => {
  it("kills a session on the next request, not at expiry", async () => {
    const r = await login(EMAIL, PASSWORD);
    expect(await reviewerFromToken(r!.token)).toBeTruthy();

    await app.inject({
      method: "POST",
      url: "/auth/revoke-all",
      headers: { authorization: `Bearer ${r!.token}` },
    });
    // A signed cookie carrying its own claims could not do this.
    expect(await reviewerFromToken(r!.token)).toBeNull();
  });

  it("refuses a disabled reviewer, keeping their history", async () => {
    const r = await login(EMAIL, PASSWORD);
    await prisma.reviewer.update({ where: { email: EMAIL }, data: { disabledAt: new Date() } });
    expect(await reviewerFromToken(r!.token)).toBeNull();
    expect(await login(EMAIL, PASSWORD)).toBeNull();
    await prisma.reviewer.update({ where: { email: EMAIL }, data: { disabledAt: null } });
  });
});

describe("the admin routes", () => {
  it("accepts a reviewer session", async () => {
    const r = await login(EMAIL, PASSWORD);
    const res = await app.inject({
      method: "GET",
      url: "/admin/queue",
      headers: { authorization: `Bearer ${r!.token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("attributes an action to the verified session, not to a header", async () => {
    // Letting x-reviewer override a real identity makes the audit trail forgeable
    // by the one caller we can actually identify.
    const r = await login(EMAIL, PASSWORD);
    const issue = await prisma.issue.findFirstOrThrow();
    const cand = await prisma.candidate.create({
      data: { slug: "zz-auth-attrib", fullName: "ZZ Auth Attrib" },
    });
    const pos = await prisma.position.create({
      data: {
        candidateId: cand.id,
        issueId: issue.id,
        stance: "NO_STATED_POSITION",
        summary: "none",
        confidence: 0.9,
        status: "IN_REVIEW",
      },
    });

    await app.inject({
      method: "POST",
      url: `/admin/positions/${pos.id}/publish`,
      headers: { authorization: `Bearer ${r!.token}`, "x-reviewer": "Somebody Else" },
    });

    const after = await prisma.position.findUniqueOrThrow({ where: { id: pos.id } });
    expect(after.reviewedBy).toBe("ZZ Auth Test");

    await prisma.position.deleteMany({ where: { candidateId: cand.id } });
    await prisma.candidate.delete({ where: { id: cand.id } });
  });

  it("refuses the shared token entirely once it is turned off", async () => {
    process.env.ALLOW_SHARED_ADMIN_TOKEN = "false";
    const res = await app.inject({
      method: "GET",
      url: "/admin/queue",
      headers: { authorization: "Bearer test-admin-token" },
    });
    expect(res.statusCode).toBe(401);
    delete process.env.ALLOW_SHARED_ADMIN_TOKEN;
  });
});
