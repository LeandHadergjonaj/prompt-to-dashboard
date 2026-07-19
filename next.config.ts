import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM modules the bundler must not try to inline:
  // better-sqlite3 (native addon), libpg-query (loads a .wasm file at runtime).
  serverExternalPackages: ["better-sqlite3", "libpg-query"],
};

export default nextConfig;
