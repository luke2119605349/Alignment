import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Clerk auth reads cookies; keep Cache Components off for layout/auth routes.
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
