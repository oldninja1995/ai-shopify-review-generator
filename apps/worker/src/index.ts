import { env } from "./env.js";
import { createServer } from "./server.js";
import "./queues/shopify-sync.worker.js";
import "./queues/review-generation.worker.js";
import "./queues/review-upload.worker.js";
import "./queues/duplicate-check.worker.js";
import "./queues/uploaded-scan.worker.js";

const app = createServer();

app.listen(env.WORKER_PORT, () => {
  console.log(`[worker] listening on port ${env.WORKER_PORT}`);
});
