import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Recompile from source on local restarts after checkout changes.
    turbopackFileSystemCacheForDev: false,
  },
  webpack(config) {
    config.module.rules.push({
      // Preprocess Tailwind while retaining Next's built-in CSS loader chain.
      oneOf: [
        {
          test: /\.css$/i,
          exclude: /node_modules/,
          enforce: "pre",
          use: ["@tailwindcss/turbopack"],
        },
      ],
    });
    return config;
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
