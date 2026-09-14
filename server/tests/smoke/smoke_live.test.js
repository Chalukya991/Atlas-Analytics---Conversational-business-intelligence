/* End-to-end smoke test against a running server. Usage: SMOKE_BASE=http://localhost:4000/api/v1 npm run test:smoke:live */
const { runFlow } = require('./flow');

const BASE = process.env.SMOKE_BASE || 'http://localhost:4000/api/v1';

runFlow(BASE)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SMOKE TEST FAILED:', err.message);
    process.exit(1);
  });
