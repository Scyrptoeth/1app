/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    // Explicitly set root to avoid confusion with lockfile at home directory
    root: __dirname,
  },
};

module.exports = nextConfig;
