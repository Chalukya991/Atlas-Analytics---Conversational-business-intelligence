/* End-to-end smoke test that boots the API (with in-process workers) on an ephemeral port.
 * Needs DATABASE_URL, REDIS_URL and an LLM endpoint from server/.env. */
process.env.RUN_WORKERS = 'true';
const { runFlow } = require('./flow');

async function main() {
  const app = require('../../src/index');
  const config = require('../../src/config');
  config.validate();
  require('../../src/workers/worker');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  try {
    await runFlow(`http://127.0.0.1:${port}/api/v1`);
  } finally {
    server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SMOKE TEST FAILED:', err.message);
    process.exit(1);
  });
