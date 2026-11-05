/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace package with zero runtime deps, shared by browser and server.
  transpilePackages: ["@trace/chain-config"],
  images: { formats: ["image/avif", "image/webp"] },
  webpack: (config) => {
    // Optional peers of connectors TRACE never loads (only the injected/MetaMask
    // connector is configured): stub them so the bundle doesn't try to resolve them.
    config.resolve.alias = { ...config.resolve.alias, "mppx/client": false, mppx: false, "pino-pretty": false, lokijs: false, encoding: false };
    return config;
  },
};

module.exports = nextConfig;
