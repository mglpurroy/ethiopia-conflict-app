import type { NextConfig } from "next";

const backendOrigin = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {},
  async rewrites() {
    // In local dev, keep frontend calls same-origin (/api/*) and forward to backend.
    // If NEXT_PUBLIC_API_URL is explicitly provided, skip rewrite routing.
    if (process.env.NEXT_PUBLIC_API_URL) {
      return [];
    }
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
