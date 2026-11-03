import './tests.js';
import './rules.test.js';
import './calculus.test.js';
import './cas.test.js';
import { run } from './harness.js';
const { failed } = run();
process.exit(failed > 0 ? 1 : 0);
