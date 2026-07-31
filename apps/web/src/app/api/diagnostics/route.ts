import { NextResponse } from "next/server";
import { prisma, findAiSettingsSafe } from "@ai-shopify/db";
import {
  apiFailure,
  apiSuccess,
  CLEAR_COOLDOWNS_CHANNEL,
  WORKER_SNAPSHOT_KEY,
  WORKER_SNAPSHOT_INTERVAL_MS,
  type DiagnosticsSnapshot,
} from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { connection, reviewGenerationQueue } from "@/lib/queue";

/** Severity, in the order the page sorts by. FAIL means generation cannot work right now; WARN
 * means it works but will not produce what was asked for; INFO is context, not a problem. */
export type CheckStatus = "FAIL" | "WARN" | "OK" | "INFO" | "UNKNOWN";

export type DiagnosticCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  /** One or two plain sentences: what is true, and what it means for generation. */
  detail: string;
  /** Populated when this app can actually repair the condition. */
  fix?: { action: FixAction; label: string };
};

export type FixAction = "clear-cooldowns" | "retry-failed-generation";

/** A snapshot older than this means the worker stopped publishing — it is down, redeploying, or
 * cannot reach Redis. Two intervals of slack so one missed write is not reported as an outage. */
const SNAPSHOT_STALE_MS = WORKER_SNAPSHOT_INTERVAL_MS * 2 + 10_000;

async function readWorkerSnapshot(): Promise<DiagnosticsSnapshot | null> {
  try {
    const raw = await connection.get(WORKER_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as DiagnosticsSnapshot) : null;
  } catch {
    return null;
  }
}

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), { status: 400 });
  }

  const checks: DiagnosticCheck[] = [];

  // --- Redis, and the worker's own heartbeat -------------------------------------------------
  // Everything else depends on these two, so they are checked first and reported plainly: if the
  // worker is not running, no amount of correct configuration produces a single review.
  let redisOk = true;
  try {
    await connection.ping();
  } catch {
    redisOk = false;
  }
  checks.push({
    id: "redis",
    label: "Job queue (Redis)",
    status: redisOk ? "OK" : "FAIL",
    detail: redisOk
      ? "Reachable. Jobs can be queued and picked up."
      : "Unreachable from the web app. Nothing can be queued, and any button that starts a job will fail.",
  });

  const snapshot = redisOk ? await readWorkerSnapshot() : null;
  const snapshotAge = snapshot ? Date.now() - snapshot.at : null;
  const workerAlive = snapshotAge !== null && snapshotAge < SNAPSHOT_STALE_MS;
  checks.push({
    id: "worker",
    label: "Worker process",
    status: workerAlive ? "OK" : redisOk ? "FAIL" : "UNKNOWN",
    detail: workerAlive
      ? `Reporting in as of ${formatAge(snapshotAge!)} ago.`
      : redisOk
        ? snapshot
          ? `Last reported ${formatAge(snapshotAge!)} ago and has gone quiet. Queued jobs will sit unprocessed until it is running again — restart the worker service.`
          : "Has never reported in, or has been down long enough for its status to expire. Queued jobs will sit unprocessed until it is running again. (If the worker was deployed before this diagnostics feature shipped, redeploy it — older builds do not publish status.)"
        : "Cannot be determined while Redis is unreachable.",
  });

  // --- What is actually in flight ------------------------------------------------------------
  // The most common report is "nothing is happening". Usually something is, and the panel showing
  // it simply stopped refreshing, so the real counts are stated here directly.
  const activeJob = await prisma.bulkGenerationJob.findFirst({
    where: { storeId: store.id, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (activeJob) {
    const processed = activeJob.completedCount + activeJob.failedCount;
    const elapsedMs = Date.now() - activeJob.createdAt.getTime();
    const rate = processed > 0 ? elapsedMs / processed : null;
    const remaining = activeJob.totalCount - processed;
    checks.push({
      id: "active-job",
      label: "Bulk generation in progress",
      status: "INFO",
      detail:
        `${processed} of ${activeJob.totalCount} products done (${activeJob.failedCount} failed), started ${formatAge(elapsedMs)} ago.` +
        (rate && remaining > 0
          ? ` At the rate observed so far, roughly ${formatAge(remaining * rate)} left.`
          : processed === 0
            ? " No product has finished yet — at a high per-product review count the first one can take a while."
            : ""),
    });
  }

  const reviewsLastHour = await prisma.generatedReview.count({
    where: { product: { storeId: store.id }, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  checks.push({
    id: "throughput",
    label: "Reviews written in the last hour",
    status: reviewsLastHour > 0 ? "OK" : activeJob ? "WARN" : "INFO",
    detail:
      reviewsLastHour > 0
        ? `${reviewsLastHour.toLocaleString()} review(s) saved in the last hour — generation is running.`
        : activeJob
          ? "A job is active but nothing has been saved in the last hour. Check the model and cooldown rows below."
          : "No reviews written in the last hour, and no job is running.",
  });

  // --- Queue depth ---------------------------------------------------------------------------
  let counts: Record<string, number> | null = null;
  if (redisOk) {
    try {
      counts = (await reviewGenerationQueue.getJobCounts()) as unknown as Record<string, number>;
    } catch {
      counts = null;
    }
  }
  if (counts) {
    const failed = counts.failed ?? 0;
    checks.push({
      id: "queue",
      label: "Review generation queue",
      status: failed > 0 ? "WARN" : "OK",
      detail: `${counts.waiting ?? 0} waiting, ${counts.active ?? 0} active, ${failed} failed, ${counts.delayed ?? 0} delayed.${
        failed > 0 ? " Failed jobs have exhausted their retries and will not run again on their own." : ""
      }`,
      ...(failed > 0
        ? { fix: { action: "retry-failed-generation" as const, label: `Retry ${failed} failed job(s)` } }
        : {}),
    });
  }

  // --- AI configuration ----------------------------------------------------------------------
  const aiSettings = await findAiSettingsSafe(store.id);
  const modelCount = (aiSettings?.models.length ?? 0) + (aiSettings?.groqModels.length ?? 0);
  checks.push({
    id: "ai-config",
    label: "AI configuration",
    status: !aiSettings?.enabled ? "INFO" : modelCount === 0 ? "FAIL" : "OK",
    detail: !aiSettings?.enabled
      ? "AI generation is off. Reviews come from the built-in phrase bank."
      : modelCount === 0
        ? "AI is on but no models are selected, so there is nothing to call."
        : `${modelCount} model(s) configured.`,
  });

  // --- Worker-local cooldowns: the failure the database cannot show --------------------------
  if (snapshot && aiSettings?.enabled) {
    const blocked = snapshot.blockedCount;
    const allBlocked = modelCount > 0 && blocked >= modelCount;
    checks.push({
      id: "cooldowns",
      label: "Model cooldowns inside the worker",
      status: allBlocked ? "FAIL" : blocked > 0 ? "WARN" : "OK",
      detail:
        blocked === 0
          ? "No models are in cooldown. The worker will try the full list."
          : `${blocked} model(s) are in cooldown after recent failures and are being skipped without being called.` +
            (allBlocked
              ? " Every configured model is blocked, so no review can currently be generated by AI."
              : "") +
            " This state lives in the worker's memory, so the AI settings page can report these same models as working. Clearing it makes the worker re-try them immediately.",
      ...(blocked > 0
        ? { fix: { action: "clear-cooldowns" as const, label: `Clear ${blocked} cooldown(s)` } }
        : {}),
    });
  }

  // --- AI-only mode: reported, never changed -------------------------------------------------
  // Deliberately has no fix button. Turning it off silently swaps AI-written reviews for
  // phrase-bank text, which is a content-quality decision, not a repair.
  if (aiSettings?.aiOnlyMode) {
    const skipLogs = await prisma.systemLog.count({
      where: {
        userId: user.id,
        level: "WARN",
        message: { contains: "AI could not produce" },
        createdAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    });
    checks.push({
      id: "ai-only-mode",
      label: "AI-only mode",
      status: skipLogs > 0 ? "WARN" : "INFO",
      detail:
        "On. A review that every configured model fails to produce is skipped rather than filled from the phrase bank — so a run can finish with fewer reviews than requested." +
        (skipLogs > 0
          ? ` ${skipLogs} product(s) hit this in the last 24 hours. Turn it off in AI settings if you would rather always get the full count.`
          : ""),
    });
  }

  const order: CheckStatus[] = ["FAIL", "WARN", "UNKNOWN", "INFO", "OK"];
  checks.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return NextResponse.json(apiSuccess({ checkedAt: new Date().toISOString(), checks }));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: FixAction };

  if (body.action === "clear-cooldowns") {
    // Pub/sub so every worker replica clears, not just whichever one would have read a key.
    const receivers = await connection.publish(CLEAR_COOLDOWNS_CHANNEL, "1");
    return NextResponse.json(
      apiSuccess({
        message:
          receivers > 0
            ? "Cooldowns cleared. The worker will retry every configured model on the next review."
            : "No worker was listening, so nothing was cleared — the worker is likely down or running a build from before this feature shipped.",
        receivers,
      }),
    );
  }

  if (body.action === "retry-failed-generation") {
    const failed = await reviewGenerationQueue.getFailed(0, 999);
    let retried = 0;
    for (const job of failed) {
      try {
        await job.retry();
        retried += 1;
      } catch {
        // A job that was already retried or removed by another request is not an error worth
        // failing the whole batch over.
      }
    }
    return NextResponse.json(apiSuccess({ message: `Requeued ${retried} failed job(s).`, retried }));
  }

  return NextResponse.json(apiFailure("Unknown action", { code: "VALIDATION_ERROR" }), { status: 400 });
}
