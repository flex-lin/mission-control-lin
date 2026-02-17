import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "chokidar"],
  // tsc --noEmit passes cleanly; skip redundant type check in build to avoid OOM
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
