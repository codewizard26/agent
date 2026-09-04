import type { NextConfig } from "next";

const config: NextConfig = {
  // packages/* ship TypeScript source, not built output — Next must compile them.
  transpilePackages: ["@job-agent/core", "@job-agent/db"],

  // boards.yaml is read at runtime through a computed path, which output file
  // tracing cannot see. Without this the deployed fetch dies on a missing file.
  outputFileTracingIncludes: {
    "/api/**": ["../../sources/**"],
  },

  // PGlite loads its own wasm and filesystem shims at runtime; bundling it
  // breaks that resolution ("path argument must be of type string ... Received
  // an instance of URL"). Keep it external on the server.
  serverExternalPackages: ["@electric-sql/pglite"],

  webpack: (cfg, { isServer }) => {
    // serverExternalPackages does not win over transpilePackages for a
    // transitive import, so externalise PGlite on the server explicitly —
    // otherwise webpack copies it into vendor-chunks and its pglite.data
    // wasm payload goes missing at runtime.
    if (isServer) {
      cfg.externals = [
        ...(Array.isArray(cfg.externals) ? cfg.externals : [cfg.externals].filter(Boolean)),
        { "@electric-sql/pglite": "commonjs @electric-sql/pglite" },
      ];
    }

    // Core imports siblings as "./resume.js" (ESM-correct, and what tsc and
    // vitest resolve). Webpack does not map .js onto .ts without being told.
    cfg.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return cfg;
  },
};

export default config;
