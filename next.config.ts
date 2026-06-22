import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@open-spaced-repetition/binding"],
  experimental: { serverActions: { bodySizeLimit: "64mb" } },
  allowedDevOrigins: ["192.168.55.108"],
};

export default nextConfig;
