import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // Repo root, not web/: the analytics layer imports db/fifo-core.mjs so that
    // request-time "aging as of <date>" runs THE same FIFO algorithm as the
    // reconciled pipeline. Turbopack refuses to resolve outside its root, and a
    // duplicated copy of that algorithm would be free to drift.
    root: path.join(__dirname, '..'),
  },
};

export default nextConfig;
