/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Required for pdf.js worker
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
