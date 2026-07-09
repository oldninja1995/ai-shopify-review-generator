import express from "express";
import { connection } from "./redis.js";
import { prisma } from "@ai-shopify/db";
import { queues } from "./queues/index.js";

export function createServer() {
  const app = express();

  app.get("/health", async (_req, res) => {
    const [redisStatus, dbStatus] = await Promise.allSettled([
      connection.ping(),
      prisma.$queryRaw`SELECT 1`,
    ]);

    const healthy = redisStatus.status === "fulfilled" && dbStatus.status === "fulfilled";

    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      redis: redisStatus.status === "fulfilled" ? "connected" : "unreachable",
      database: dbStatus.status === "fulfilled" ? "connected" : "unreachable",
      queues: queues.map((queue) => queue.name),
    });
  });

  return app;
}
