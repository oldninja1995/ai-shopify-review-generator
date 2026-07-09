import { env } from "./env.js";
import { createServer } from "./server.js";
import "./queues/shopify-sync.worker.js";

const app = createServer();

app.listen(env.WORKER_PORT, () => {
  console.log(`[worker] listening on port ${env.WORKER_PORT}`);
});
