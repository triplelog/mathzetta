/**
 * Runs the table tests in test/cases/ under `npm test`. How each cell is
 * checked lives in checks.js, which the browser test runner uses too.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { checkTable, parseData } from './checks.js';
import { suite, test, eq } from './harness.js';

const CASES = new URL('./cases/', import.meta.url);
const read = (name) => readFileSync(new URL(name, CASES), 'utf8');

export const counts = { known: 0 };

export function runTables() {
    const known = JSON.parse(read('../known-failures.json'));
    const data = parseData(read('formula-data.csv'));

    for (const file of readdirSync(CASES).filter((f) => f.endsWith('.tsv')).sort()) {
        const { results } = checkTable(file, read(file), { known, data });
        suite(file, () => {
            for (const r of results) {
                const name = r.column === 'formula' ? r.input : `${r.input} [${r.column}]`;
                test(name, () => {
                    if (r.status === 'known') counts.known++;
                    if (r.status === 'fixed') throw new Error(`now passes: remove it from test/known-failures.json (${r.reason})`);
                    if (r.status !== 'fail') return;
                    if (r.problems) throw new Error(r.problems.slice(0, 3).join('; '));
                    eq(r.got, r.expected);
                });
            }
        });
    }
}
