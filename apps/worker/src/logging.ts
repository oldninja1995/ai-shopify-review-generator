import { prisma, type Prisma } from "@ai-shopify/db";

type LogLevel = "INFO" | "WARN" | "ERROR";

export async function logSystemEvent(
  level: LogLevel,
  message: string,
  options?: { userId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: {
        level,
        message,
        userId: options?.userId,
        metadata: options?.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    // Logging must never break the job it's instrumenting.
    console.error("[logging] failed to write system log:", error);
  }
}
