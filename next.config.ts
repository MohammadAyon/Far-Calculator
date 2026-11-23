import type { NextConfig } from "next";

const allowedDevOrigins = process.env.ALLOWED_DEV_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    const securityHeaders = [
      {
        key: "Content-Security-Policy",
        // React dev mode needs eval() for debugging; production never uses it.
        value: `default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/rules/import",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/api/rules/revert",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
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
