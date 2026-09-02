import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@civic/db";

// Review console backend. Token auth in v0; swap for real auth before the pilot.
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${process.env.ADMIN_TOKEN}`) return reply.code(401).send();
  });

  app.get("/review/queue", async () =>
    prisma.reviewTask.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "asc" }, take: 100 }),
  );

  app.post("/positions/:id/publish", async (req) => {
    const { id } = req.params as { id: string };
    const reviewedBy = (req.headers["x-reviewer"] as string) ?? "unknown";
    return prisma.position.update({
      where: { id },
      data: { status: "PUBLISHED", reviewedBy, reviewedAt: new Date(), publishedAt: new Date() },
    });
  });

  app.post("/positions/:id/reject", async (req) => {
    const { id } = req.params as { id: string };
    return prisma.position.update({ where: { id }, data: { status: "REJECTED" } });
  });
};
