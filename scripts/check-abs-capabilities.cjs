// Use the app client so credential rotation follows the normal signed-in flow.
const { spawnSync } = require('node:child_process');
const server = process.argv[2];
if (!server || new URL(server).protocol !== 'https:') throw new Error('Supply an HTTPS Audiobookshelf URL.');
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/lib/__tests__/abs-live.test.ts'], {
  stdio: 'inherit', env: { ...process.env, SPOKEN_PAGE_CHECK_SERVER: server, SPOKEN_PAGE_CHECK_REPORT: 'docs/ABS_CAPABILITIES.json' }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
