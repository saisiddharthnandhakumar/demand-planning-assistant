import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is deliberately off: every page here is authenticated and
  // dynamic, so the classic model (dynamic APIs opt a route into request-time
  // rendering) is simpler than wrapping each page's data in Suspense.
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
