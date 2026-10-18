/** @type {import('next').NextConfig} */
const basePath = '/spello';

// One id per build, shared by Next itself and the page's own code, so the
// running app can tell when a newer version has been deployed (see
// components/UpdateOnResume.tsx). Must be deterministic: this file is
// loaded more than once per build (worker processes), so anything like
// Date.now() gives Next and the page two different ids and the app would
// reload on every resume. The commit hash is the same everywhere.
const { execSync } = require('child_process');
function commitId() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try { return execSync('git rev-parse --short=12 HEAD').toString().trim(); } catch { return 'dev'; }
}
const buildId = commitId();

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  generateBuildId: async () => buildId,
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_BUILD_ID: buildId },
};

module.exports = nextConfig;
