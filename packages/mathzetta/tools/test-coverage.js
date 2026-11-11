#!/usr/bin/env node
/**
 * What the table tests in test/cases/ cover, and what they don't:
 *
 *   node tools/test-coverage.js        (npm run coverage)
 *
 * For every operator in the table: does any row's postfix use it? For every output column: how
 * many checks, in which files. Which rows have an input but no expected value. Which spellings the
 * code reader knows (numpy, SymPy, SQL, spreadsheet, GLSL) appear in no input. The gaps are what to
 * write next (a row in a test/cases file, or "Add a test" on the website's test runner).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { operatorNames, parse } from '../src/index.js';
import { parseTable } from '../test/checks.js';

const CASES = new URL('../test/cases/', import.meta.url);
const files = readdirSync(CASES).filter((f) => f.endsWith('.tsv')).sort();
const COLUMNS = ['clean', 'postfix', 'latex', 'mathml', 'javascript', 'python', 'sql', 'excel', 'text', 'evaluated', 'speech', 'audio', 'glsl'];

const perColumn = Object.fromEntries(COLUMNS.map((c) => [c, {}]));
const usedOps = new Map();          // operator -> number of rows whose postfix uses it
const inputs = [];                  // every input, with its file
const empty = [];                   // rows with no expected value
let formulaRows = 0;
for (const file of files) {
    const rows = parseTable(readFileSync(new URL(file, CASES), 'utf8'));
    if (!rows.length) continue;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    if (header[0] === 'formula') { formulaRows += rows.length - 1; continue; }
    for (const row of rows.slice(1)) {
        inputs.push({ input: row[0], file });
        let any = false;
        header.forEach((col, i) => {
            if (i === 0 || !row[i] || row[i].trim() === '') return;
            any = true;
            if (perColumn[col]) perColumn[col][file] = (perColumn[col][file] || 0) + 1;
        });
        if (!any) empty.push({ input: row[0], file });
        let postfix;
        try { postfix = parse(row[0]); } catch { continue; }
        for (const t of new Set(postfix)) if (operatorNames().includes(t)) usedOps.set(t, (usedOps.get(t) || 0) + 1);
    }
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log(`${files.length} files, ${inputs.length} expression rows, ${formulaRows} formula rows\n`);
console.log('checks per output column:');
for (const c of COLUMNS) {
    const n = sum(perColumn[c]);
    console.log(`  ${c.padEnd(11)} ${String(n).padStart(5)}   ${Object.entries(perColumn[c]).map(([f, k]) => `${f} ${k}`).join(', ') || '— no checks at all'}`);
}

const unused = operatorNames().filter((op) => !usedOps.has(op));
console.log(`\noperators in the table: ${operatorNames().length}; used by some row's postfix: ${usedOps.size}; in no row (${unused.length}):`);
console.log('  ' + unused.join('  '));
const rare = [...usedOps].filter(([, n]) => n === 1).map(([op]) => op);
console.log(`in exactly one row (${rare.length}): ${rare.join('  ')}`);

console.log(`\nrows with an input but no expected value (${empty.length}):`);
for (const { input, file } of empty) console.log(`  ${file}: ${input}`);

// spellings the code reader knows, and whether any input uses them
const code = readFileSync(new URL('../src/parse/clean/code.js', import.meta.url), 'utf8');
const block = (name) => { const m = code.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`)); return m ? [...m[1].matchAll(/^\s*'?([A-Za-z_][\w.]*)'?\s*:/gm)].map((x) => x[1]) : []; };
const spellings = { 'spreadsheet functions (SHEET_CALLS)': block('SHEET_CALLS'), 'SQL functions (SQL_NAMES)': block('SQL_NAMES'), 'numpy / math names (NP_AS_MATH, NP_BARE)': [...block('NP_AS_MATH'), ...block('NP_BARE')], 'SymPy calls (SYMPY_CALLS)': block('SYMPY_CALLS'), 'other calls (CALLS)': block('CALLS').filter((n) => !/^sympy_|_$/.test(n)) };   // sympy_* are the reader's own targets, not spellings
const text = inputs.map((i) => i.input).join('\n');
console.log('\ncode spellings the reader knows that no input uses:');
for (const [label, names] of Object.entries(spellings)) {
    const unusedNames = names.filter((n) => !new RegExp(`(^|[^\\w.])${n.replace(/\./g, '\\.')}\\s*\\(`, 'm').test(text) && !text.includes(n + '('));
    console.log(`  ${label}: ${names.length} known, ${unusedNames.length} untested${unusedNames.length ? ' — ' + unusedNames.join(' ') : ''}`);
}
