import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF extractor is a native Node addon (a platform-specific .node binary),
  // so it cannot be bundled — the bundler rewrites its require paths and the
  // binding fails to resolve at runtime.
  serverExternalPackages: ["@firecrawl/pdf-inspector"],
};

export default nextConfig;
