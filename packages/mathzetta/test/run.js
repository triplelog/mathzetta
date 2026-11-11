/**
 * Run every test: `npm test` or `node test/run.js`.
 *
 *   test/unit/*.test.js   focused tests of each module
 *   test/cases/*.tsv      table-driven tests, checked by checks.js
 *
 * The same tables run in a browser at https://mathzetta.com/demos/test-runner.html
 */

import { readdirSync } from 'node:fs';
import { report } from './harness.js';
import { runTables, counts } from './suites.js';

const unit = new URL('./unit/', import.meta.url);
for (const file of readdirSync(unit).filter((f) => f.endsWith('.test.js')).sort()) {
    await import(new URL(file, unit));
}
runTables();

console.log(`(${counts.known} known failures, listed in test/known-failures.json)`);
process.exit((await report()) ? 0 : 1);
