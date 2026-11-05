/**
 * How the table tests in test/cases/ are checked. Shared by `npm test`
 * (test/suites.js) and the browser test runner (mathzetta.com/demos/test-runner.html), so both
 * always report the same thing. No Node-only imports here.
 *
 * Expression tables (header starts with `Input`): every other column holds
 * the expected output for that input. Blank cells are not checked.
 *
 *   Clean       clean(input), with quoted strings put back
 *   Postfix     parse(input), as a JSON array
 *   Latex       toLaTeX(input)
 *   MathML      toMathML(input) — compared without ids if the expected
 *               value has none
 *   JavaScript  toJavaScript(input)
 *   Python      toPython(input)
 *   SQL         toSQL(input)
 *   Excel       toExcel(input)
 *   Text        toText(input)
 *   Speech      toSpeech(input)
 *   Audio       toAudioSpeech(input) — speech with no drawing in view
 *   GLSL        toGLSL(input)
 *   Evaluated   the value of the JavaScript output (numbers compared to
 *               1e-9; "abc" in quotes means the string abc)
 *
 * A cell can also expect an error: `ERROR` (any), or `ERROR: some text` (the
 * message must contain it) — for input that must be refused.
 *
 * Formula tables (header starts with `Formula`): a formula over the columns
 * of formula-data.csv, the columns it should use, and its value for each
 * row of that file (compared to 0.01, booleans as 1/0). `ERROR` in the
 * columns cell means the formula must be refused (an unknown name).
 *
 * Every check ends up with a status:
 *
 *   pass    output matches
 *   fail    output doesn't match
 *   known   doesn't match, and is listed in test/known-failures.json
 *   fixed   listed in known-failures.json but now matches — remove it there
 */

import {
    parse, clean, toLaTeX, toMathML, toJavaScript, toPython, toSQL, toExcel, toText, toSpeech, toGLSL, strToFunction, createRowEvaluator,
} from '../src/all.js';
import { toAudioSpeech } from '../src/speech.js';

/**
 * Split TSV text into rows of cells; blank and `#` lines are skipped.
 * Each row also has `line`: its 0-based line number in the file.
 */
export function parseTable(text) {
    const rows = [];
    text.split('\n').forEach((raw, line) => {
        const text = raw.replace(/\r$/, '');
        if (!text.trim() || text.startsWith('#')) return;
        rows.push(Object.assign(text.split('\t'), { line }));
    });
    return rows;
}

/** Read formula-data.csv: { headers, records } with numbers as numbers. */
export function parseData(csv) {
    const lines = csv.trim().split('\n').map((line) => line.replace(/\r$/, '').split(','));
    const records = lines.slice(1).map((r) => r.map((v) => (v === '' || Number.isNaN(Number(v)) ? v : Number(v))));
    return { headers: lines[0], records };
}

const COLUMN = {
    clean: 'clean', postfix: 'postfix', latex: 'latex', mathml: 'mathml',
    javascript: 'javascript', python: 'python', sql: 'sql', excel: 'excel', text: 'text', evaluated: 'evaluated', speech: 'speech', audio: 'audio', glsl: 'glsl',
};

const stripIds = (s) => s.replace(/ id="mz-\d+"/g, '');

/** What the library produces for `input` in a given column. */
export function actual(column, input, expected = '') {
    switch (column) {
        case 'clean': {
            const { cleaned, stringMap } = clean(input);
            let text = cleaned;
            for (const [id, original] of stringMap) text = text.split(id).join(original);
            return text;
        }
        case 'postfix': return JSON.stringify(parse(input));
        case 'latex': return toLaTeX(parse(input));
        case 'mathml': {
            const mathml = toMathML(parse(input));
            return expected.includes(' id="') ? mathml : stripIds(mathml);
        }
        case 'javascript': return toJavaScript(parse(input));
        case 'python': return toPython(parse(input));
        case 'sql': return toSQL(parse(input));
        case 'excel': return toExcel(parse(input));
        case 'text': return toText(parse(input));
        case 'speech': return toSpeech(parse(input));
        case 'audio': return toAudioSpeech(parse(input));
        case 'glsl': return toGLSL(parse(input));
        case 'evaluated': return String(new Function(`return (${toJavaScript(parse(input))});`)());
    }
    throw new Error(`unknown column ${column}`);
}

/** Does an actual value satisfy the expected cell? */
export function matches(column, expected, got) {
    if (/^ERROR\b/.test(expected)) {
        const want = expected.replace(/^ERROR:?\s*/, '');
        return got.startsWith('ERROR') && (!want || got.includes(want));
    }
    if (column === 'postfix') {
        try {
            return JSON.stringify(JSON.parse(expected.replace(/'/g, '"')).map(String)) === got;
        } catch {
            return expected === got;
        }
    }
    if (column === 'evaluated') {
        if (/^".*"$/.test(expected)) return JSON.parse(expected) === got;
        const e = Number(expected);
        const a = Number(got);
        if (expected.trim() !== '' && !Number.isNaN(e) && !Number.isNaN(a)) {
            return e === a || Math.abs(e - a) <= 1e-9 * Math.max(1, Math.abs(e));
        }
    }
    return expected === got;
}

function status(ok, knownReason) {
    if (knownReason) return ok ? 'fixed' : 'known';
    return ok ? 'pass' : 'fail';
}

/**
 * Check every cell of one table.
 * @param {string} file     file name, used to look up known failures
 * @param {string} text     the TSV text
 * @param {object} options  { known: parsed known-failures.json, data: parseData() result }
 * @returns {{ kind: 'expression'|'formula', header: string[], results: object[], empty: object[] }}
 *   each result: { input, column, expected, got, status, reason, line, accept }
 *   where `line` is the row's line in the file and `accept` is the list of
 *   { cell, value } edits that would make the expected values equal what the
 *   library produced (for the test runner's "accept" button);
 *   `empty` lists the rows that have an input but no expected value at all
 *   ({ input, line }) — not checks, but the page offers to fill them in.
 */
export function checkTable(file, text, { known = {}, data } = {}) {
    const rows = parseTable(text);
    if (!rows.length) return { kind: 'expression', header: [], results: [], empty: [] };
    const header = [...rows[0]];
    const knownFor = known[file] || {};
    if (header[0].trim().toLowerCase() === 'formula') {
        return { kind: 'formula', header, results: checkFormulas(rows, knownFor, data), empty: [] };
    }

    const columns = rows[0].map((h) => COLUMN[h.trim().toLowerCase()]);
    const results = [];
    const empty = [];
    for (const row of rows.slice(1)) {
        const input = row[0];
        if (!row.some((cell, i) => i > 0 && columns[i] && cell !== undefined && cell !== '')) empty.push({ input, line: row.line });
        columns.forEach((column, i) => {
            const expected = row[i];
            if (i === 0 || !column || expected === undefined || expected === '') return;
            let got;
            try {
                got = actual(column, input, expected);
            } catch (error) {
                got = 'ERROR: ' + error.message;
            }
            const reason = knownFor[input]?.[column];
            results.push({
                input, column, expected, got, reason,
                status: status(matches(column, expected, got), reason),
                line: row.line,
                accept: got.startsWith('ERROR') ? null : [{ cell: i, value: got }],
            });
        });
    }
    return { kind: 'expression', header, results, empty };
}

function checkFormulas(rows, knownFor, data) {
    if (!data) throw new Error('formula tables need formula-data.csv');
    const { headers, records } = data;
    return rows.slice(1).map((row) => {
        const [formula, columns, ...expectedValues] = row;
        const problems = [];
        let got = '';
        let accept = null;
        const compiled = strToFunction(headers, formula);
        if (/^ERROR\b/.test((columns || '').trim())) {
            // must be refused: either it doesn't compile, or every row says it isn't allowed
            const refused = !compiled.success || records.every((record) => String(createRowEvaluator(compiled.jsFunction)(record)).startsWith('Error'));
            if (!refused) problems.push('expected an error: the formula was accepted');
            got = refused ? 'ERROR (refused)' : 'accepted';
            const reason = knownFor[formula]?.formula;
            return { input: formula, column: 'formula', expected: 'ERROR', got, problems, status: status(problems.length === 0, reason), reason, line: row.line, accept: null };
        }
        if (!compiled.success) {
            problems.push(compiled.error);
            got = 'ERROR: ' + compiled.error;
        } else {
            const used = [...new Set(compiled.postfixArray
                .filter((_, i) => compiled.types[i] === 'column')
                .map((token) => headers[Number(token.slice(1))]))].sort();
            const wanted = (columns || '').split(',').map((c) => c.trim()).filter(Boolean).sort();
            if (columns && used.join() !== wanted.join()) problems.push(`columns ${used} instead of ${wanted}`);
            const evaluate = createRowEvaluator(compiled.jsFunction);
            const values = records.map((record, r) => {
                const value = evaluate(record);
                const expected = expectedValues[r];
                if (expected !== undefined && expected !== '') {
                    const e = Number(expected);
                    const a = Number(value);   // booleans become 1 / 0
                    const ok = !Number.isNaN(e) && !Number.isNaN(a) ? Math.abs(e - a) <= 0.01 : String(value) === expected;
                    if (!ok) problems.push(`row ${r + 1}: expected ${expected}, got ${value}`);
                }
                return typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
            });
            got = `columns: ${used.join(', ')}\nvalues: ${values.join(', ')}`;
            if (values.every((v) => typeof v !== 'string' || !v.startsWith('Error'))) {
                accept = [{ cell: 1, value: used.join(',') }, ...values.map((v, r) => ({ cell: 2 + r, value: String(v) }))];
            }
        }
        const reason = knownFor[formula]?.formula;
        return {
            input: formula,
            column: 'formula',
            expected: `columns: ${columns}\nvalues: ${expectedValues.filter((v) => v !== '').join(', ')}`,
            got,
            problems,
            status: status(problems.length === 0, reason),
            reason,
            line: row.line,
            accept,
        };
    });
}
