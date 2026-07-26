/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Setswana content and BWP formatting; keep output deterministic.
  experimental: { typedRoutes: true },
};

export default nextConfig;
