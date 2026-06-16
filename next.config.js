/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: '/wortschatz-b2',
  images: { unoptimized: true },
};

module.exports = nextConfig;
