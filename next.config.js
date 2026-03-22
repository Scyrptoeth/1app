/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer }) => {
    // Required for pdf.js worker
    config.resolve.alias.canvas = false;

    // ExcelJS needs 'fs' polyfill for browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        stream: false,
        crypto: false,
      };
    }

    return config;
  },
};

module.exports = nextConfig;
