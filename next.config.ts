import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Product photos may be up to 2 MB (IMAGE_MAX_BYTES); the default Server Action limit is 1 MB.
    serverActions: { bodySizeLimit: '3mb' },
  },
};

export default nextConfig;
