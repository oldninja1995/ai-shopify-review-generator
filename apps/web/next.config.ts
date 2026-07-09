import path from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// The monorepo keeps a single .env at the repo root; Next.js only
// auto-loads .env files from this app's own directory, so load it explicitly.
config({ path: path.resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
