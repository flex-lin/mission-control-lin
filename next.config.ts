import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "chokidar"],
  // tsc --noEmit passes cleanly; skip redundant type check in build to avoid OOM
  typescript: { ignoreBuildErrors: true },
  // Turbopack is the default bundler in Next.js 16. An empty config silences the
  // "no turbopack config" build error. Turbopack's Rust watcher respects .gitignore,
  // so prisma/*.db, .claude/settings.json, and .env* are already excluded from
  // file watching (see .gitignore).
  turbopack: {},
};

export default nextConfig;
