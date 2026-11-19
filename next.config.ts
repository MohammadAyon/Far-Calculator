import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["2bdsghn4-3000.inc1.devtunnels.ms"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
