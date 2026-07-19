/** @type {import('next').NextConfig} */
const basePath = '/wortschatz-b2';

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

module.exports = nextConfig;
