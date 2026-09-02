import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: process.env.NEXT_PUBLIC_SITE_URL ?? true });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

app.get("/health", async () => ({ ok: true }));
await app.register(publicRoutes, { prefix: "/v1" });
await app.register(adminRoutes, { prefix: "/admin" });

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((e) => { app.log.error(e); process.exit(1); });
