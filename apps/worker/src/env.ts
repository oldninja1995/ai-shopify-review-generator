import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  REDIS_URL: requireEnv("REDIS_URL", "redis://localhost:6379"),
  WORKER_PORT: Number(process.env.WORKER_PORT ?? 4000),
  DATABASE_URL: requireEnv("DATABASE_URL"),
  ENCRYPTION_KEY: requireEnv("ENCRYPTION_KEY"),
};
