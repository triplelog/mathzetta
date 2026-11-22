#!/usr/bin/env node
/**
 * What the table tests in test/cases/ cover, and what they don't:
 *
 *   node tools/test-coverage.js        (npm run coverage)
 *
 * For every operator in the table: does any row's postfix use it, and which operators does no row
 * check in each output column? For every output column: how many checks, in which files. Which rows have an input but no expected value. Which spellings the
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
const opsPerColumn = Object.fromEntries(COLUMNS.map((c) => [c, new Set()]));   // operators some row checks in that column
const usedOps = new Map();          // operator -> number of rows whose postfix uses it
const inputs = [];                  // every input, with its file
const empty = [];                   // rows with no expected value
const known = new Set(operatorNames());
let formulaRows = 0;
for (const file of files) {
    const rows = parseTable(readFileSync(new URL(file, CASES), 'utf8'));
    if (!rows.length) continue;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    if (header[0] === 'formula') { formulaRows += rows.length - 1; continue; }
    for (const row of rows.slice(1)) {
        inputs.push({ input: row[0], file });
        const checked = [];
        header.forEach((col, i) => {
            if (i === 0 || !row[i] || row[i].trim() === '') return;
            checked.push(col);
            if (perColumn[col]) perColumn[col][file] = (perColumn[col][file] || 0) + 1;
        });
        if (!checked.length) empty.push({ input: row[0], file });
        let postfix;
        try { postfix = parse(row[0]); } catch { continue; }
        for (const t of new Set(postfix)) {
            if (!known.has(t)) continue;
            usedOps.set(t, (usedOps.get(t) || 0) + 1);
            for (const col of checked) opsPerColumn[col]?.add(t);
        }
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
console.log('\noperators no row checks, per output column (a row counts for a column when it has an expected value there):');
for (const c of COLUMNS) {
    const missing = operatorNames().filter((op) => !opsPerColumn[c].has(op));
    console.log(`  ${c.padEnd(11)} ${String(opsPerColumn[c].size).padStart(3)} covered, ${String(missing.length).padStart(3)} not${missing.length ? ' — ' + missing.join('  ') : ''}`);
}
const rare = [...usedOps].filter(([, n]) => n === 1).map(([op]) => op);
console.log(`in exactly one row (${rare.length}): ${rare.join('  ')}`);

console.log(`\nrows with an input but no expected value (${empty.length}):`);
for (const { input, file } of empty) console.log(`  ${file}: ${input}`);

// spellings the code reader knows, and whether any input uses them, as the reader sees them: numpy names
// after np. or numpy., SymPy's after sympy., SQL's in capitals, a spreadsheet's in a formula starting with =
const code = readFileSync(new URL('../src/parse/clean/code.js', import.meta.url), 'utf8');
/** Every key of `const name = { … };` in code.js (several per line; templates, strings and comments skipped). */
const keysOf = (name) => {
    const m = code.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n?\\};`));
    if (!m) throw new Error(`test-coverage: no table ${name} in src/parse/clean/code.js`);
    const body = m[1].replace(/`[^`]*`/g, '``').replace(/\/\/[^\n]*/g, '');
    return [...body.matchAll(/(?:^|[{,\n])\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/g)].map((x) => x[1] ?? x[2]);
};
const esc = (n) => n.replace(/[.$]/g, '\\$&');
const text = inputs.map((i) => i.input).join('\n');
const sheetText = inputs.map((i) => i.input).filter((t) => /^\s*=(?!=)/.test(t)).join('\n');
const NP = '(?:np|numpy)\\.';
const spellings = [
    ['spreadsheet functions (SHEET_CALLS, in =formulas)', keysOf('SHEET_CALLS'), (n) => `(?<![\\w.])${esc(n)}\\s*\\(`, sheetText],
    ['SQL functions (SQL_NAMES)', keysOf('SQL_NAMES'), (n) => `(?<![\\w.])${esc(n)}\\s*\\(`],
    ['numpy names (np.… / numpy.…: NP_AS_MATH, NP_BARE)', [...keysOf('NP_AS_MATH'), ...keysOf('NP_BARE')], (n) => `(?<![\\w.])${NP}${esc(n)}(?!\\w)`],
    ['numpy / math constants (NP_CONSTANTS)', keysOf('NP_CONSTANTS'), (n) => `(?<![\\w.])(?:np|numpy|math|Math)\\.${esc(n)}(?!\\w)`],
    ['SymPy calls (sympy.…: SYMPY_CALLS)', keysOf('SYMPY_CALLS'), (n) => `(?<![\\w.])sympy\\.${esc(n)}(?!\\w)`],
    ['SymPy constants (SYMPY_CONSTANTS)', keysOf('SYMPY_CONSTANTS'), (n) => `(?<![\\w.])sympy\\.${esc(n)}(?!\\w)`],
    ['SymPy sets (sympy.S.… / sympy.…: SYMPY_SETS)', keysOf('SYMPY_SETS'), (n) => `(?<![\\w.])sympy\\.(?:S\\.)?${esc(n)}(?!\\w)`],
    ['SymPy intervals (sympy.Interval.…: SYMPY_INTERVALS)', keysOf('SYMPY_INTERVALS'), (n) => `(?<![\\w.])sympy\\.Interval\\.${esc(n)}\\s*\\(`],
    // sympy_* are the reader's own targets and union_ a writer's helper, not spellings; a prefix (np.where, GLSL's mz_sq) reaches these too
    ['other calls (CALLS)', keysOf('CALLS').filter((n) => !/^sympy_|_$/.test(n)), (n) => `(?<!\\w)(?:mz_)?${esc(n)}\\s*\\(`],
];
console.log('\ncode spellings the reader knows that no input uses:');
for (const [label, names, pattern, where = text] of spellings) {
    const unusedNames = names.filter((n) => !new RegExp(pattern(n), 'm').test(where));
    console.log(`  ${label}: ${names.length} known, ${unusedNames.length} untested${unusedNames.length ? ' — ' + unusedNames.join(' ') : ''}`);
}
