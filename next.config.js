/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  turbopack: {
    // Explicitly set root to avoid confusion with lockfile at home directory
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pbs.twimg.com",
      },
      {
        protocol: "https",
        hostname: "abs.twimg.com",
      },
      {
        protocol: "https",
        hostname: "video.twimg.com",
      },
    ],
  },
  async headers() {
    const coopCoepHeaders = [
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
      {
        key: "Cross-Origin-Embedder-Policy",
        value: "credentialless",
      },
    ];
    return [
      {
        // Enable SharedArrayBuffer for ONNX multi-threaded inference
        source: "/tools/remove-and-change-background",
        headers: coopCoepHeaders,
      },
      {
        source: "/tools/resize-image",
        headers: coopCoepHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
