import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@civic/db";
import { SESSION_DAYS, login, logout, reviewerFromToken } from "../auth.js";

/**
 * Sign in and out of the review console.
 *
 * Rate-limited harder than the rest of the API: this is the one route where guessing
 * is the attack.
 */
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1).max(200) })
      .parse(req.body);

    const result = await login(body.email, body.password, req.headers["user-agent"]);
    if (!result) {
      // One message for a wrong password, an unknown email and a disabled account.
      // Distinguishing them tells an attacker which addresses are real.
      return reply.code(401).send({ error: "email or password is not correct" });
    }

    return reply.send({
      token: result.token,
      reviewer: result.reviewer,
      expiresInDays: SESSION_DAYS,
    });
  });

  app.post("/logout", async (req) => {
    await logout((req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || undefined);
    return { ok: true };
  });

  /** Who am I, for a console that wants to show a name rather than a token. */
  app.get("/me", async (req, reply) => {
    const me = await reviewerFromToken(
      (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || undefined,
    );
    if (!me) return reply.code(401).send({ error: "not signed in" });
    return me;
  });

  /** End every session for this reviewer. What you do when a laptop goes missing. */
  app.post("/revoke-all", async (req, reply) => {
    const me = await reviewerFromToken(
      (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || undefined,
    );
    if (!me) return reply.code(401).send({ error: "not signed in" });
    const r = await prisma.reviewerSession.updateMany({
      where: { reviewerId: me.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true, revoked: r.count };
  });
};
