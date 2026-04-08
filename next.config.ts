import type { NextConfig } from "next";

const customDistDir = process.env.SPOKEN_PAGE_NEXT_DIST_DIR?.trim();

const nextConfig: NextConfig = {
  distDir: customDistDir || undefined,
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
