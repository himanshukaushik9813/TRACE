/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Optimized delivery of the generated brand artwork (transparent PNGs).
  images: {
    formats: ['image/avif', 'image/webp'],
  },
};

module.exports = nextConfig;
