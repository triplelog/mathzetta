/**
 * Formulas over table columns: `Value * 2 + Count`, where `Value` and
 * `Count` are column names. Used by the formula demo to filter and compute
 * over rows of a spreadsheet.
 *
 * Column names are matched case-insensitively as whole words and swapped
 * for placeholders before parsing, so names that look like math (`e`,
 * `max`) still mean the column.
 */

import { parse } from './parse/index.js';
import { isOperator, isCustomFunction } from './operators.js';
import { isNumber } from './parse/vocabulary.js';
import { fromPostfix } from './tree.js';
import { percentDecimal } from './common.js';
import { checkGeneratedJs } from './safe.js';

export { checkGeneratedJs, isSafeGeneratedJs, UnsafeCodeError } from './safe.js';
import { toCode } from './render/code.js';
import { toMathml } from './render/mathml.js';
import { toSqlCode } from './render/sql.js';
import { toExcelFormula } from './render/excel.js';
import { replaceColumnNames, columnIndexOf, placeholderFor } from './columns.js';


/**
 * Compile a formula to JavaScript that reads columns as `c0`, `c1`, ...
 *
 * @param {string[]} header column names
 * @param {string} formula
 * @param {Map<string, {type, value}>} [unknownStringSelections] what to do
 *   with words that are neither columns nor math: `{ type: 'column' |
 *   'integer' | 'float' | 'string', value }`
 * @returns {{ success: true, jsFunction, postfixArray, types, unknownStrings,
 *   mathMLOriginal, mathMLSubbed } | { success: false, error, unknownStrings }}
 */
export function strToFunction(header, formula, unknownStringSelections = new Map()) {
    const compiled = compile(header, formula, unknownStringSelections);
    if (!compiled.success) return compiled;
    const { columnsAsIndexes, columnsAsNames } = compiled;
    let mathml;
    let jsFunction;
    try {   // what JavaScript has no way to write (a limit, a derivative) is an answer, not an exception
        mathml = toMathml(namedTree(compiled));
        jsFunction = toCode(fromPostfix(columnsAsIndexes));
    } catch (error) {
        return { success: false, error: error.message, unknownStrings: compiled.unknownStrings };
    }
    return {
        success: true,
        jsFunction,
        postfixArray: columnsAsIndexes,
        mathMLOriginal: mathml,
        mathMLSubbed: mathml,
        unknownStrings: compiled.unknownStrings,
        types: compiled.types,
    };
}

/**
 * Like strToFunction, but produces a SQL expression with "quoted" column
 * names and 'single-quoted' strings.
 *
 * @param {object} [options]
 * @param {'postgres'|'sqlite'} [options.dialect] default 'postgres'. In the
 *   sqlite dialect an operator SQLite can't run (5!, gcd, ...) gives
 *   `{ success: false, error }` rather than SQL that fails later.
 */
export function strToSQL(header, formula, unknownStringSelections = new Map(), options = {}) {
    const compiled = compile(header, formula, unknownStringSelections);
    if (!compiled.success) return compiled;
    // a name that is no column (and wasn't mapped to one) would reach the database as an identifier
    const unknown = unknownNames(compiled, options);
    if (unknown) return { success: false, error: unknown, unknownStrings: compiled.unknownStrings };
    const columns = compiled.columnsAsNames.filter((_, i) => compiled.types[i] === 'column');
    let sqlExpression;
    try {
        sqlExpression = toSqlCode(namedTree(compiled),
            { dialect: options.dialect, quoteIdentifiers: true, stringQuote: "'", columns, functions: options.functions });
    } catch (error) {
        return { success: false, error: error.message, unknownStrings: compiled.unknownStrings };
    }
    return {
        success: true,
        sqlExpression,
        postfixArray: compiled.columnsAsIndexes,
        unknownStrings: compiled.unknownStrings,
        types: compiled.types,
    };
}

/**
 * Like strToFunction, but a spreadsheet formula: `excelFormula(cellOf)`
 * writes it with each column as `cellOf(columnIndex)` — a row's cells
 * (`(i) => 'BCD'[i] + 7`) — so it is parsed once and written for every row.
 * A formula a spreadsheet can't hold (∞, a derivative) gives
 * `{ success: false, error }`.
 *
 * @param {object} [options] { ranges: (columnIndex) => 'B2:B101' } for one-argument sum, mean, max … of a column
 * @returns {{ success: true, excelFormula: (cellOf: (column: number) => string, rangeOf?) => string, tree, postfixArray, types, unknownStrings }
 *   tree: the formula with columns under their own names, to draw it
 *   | { success: false, error, unknownStrings }}
 */
export function strToExcel(header, formula, unknownStringSelections = new Map(), options = {}) {
    const compiled = compile(header, formula, unknownStringSelections);
    if (!compiled.success) return compiled;
    // A name that is no column is written as a name (a spreadsheet reads it as a named range, or #NAME?): unlike
    // SQL, where it would reach the database, nothing is refused — it is in unknownStrings for the caller to decide
    // (tabview writes values only; the Sheets sidebar asks). f(…) is written only for the functions listed.
    const tree = fromPostfix(compiled.columnsAsIndexes);
    const COLUMN = '\u0000column:';   // a name no formula can type
    (function visit(node) {
        if (node.type === 'op') node.args.forEach(visit);
        else if (compiled.types[node.id] === 'column') node.value = COLUMN + node.value.slice(1);
    })(tree);
    const index = (name) => (name.startsWith(COLUMN) ? Number(name.slice(COLUMN.length)) : -1);
    // rangeOf (or options.ranges): a column as a range, for one-argument sum, mean, max …
    const excelFormula = (cellOf, rangeOf = options.ranges) => toExcelFormula(tree, {
        cells: (name) => (index(name) >= 0 ? cellOf(index(name)) : undefined),
        ranges: (name) => (index(name) >= 0 && rangeOf ? rangeOf(index(name)) : undefined),
        functions: options.functions,   // the spreadsheet functions f(…) may be written as: a list, or (name) => boolean
    });
    try {
        excelFormula((i) => `X${i + 1}`);
    } catch (error) {
        return { success: false, error: error.message, unknownStrings: compiled.unknownStrings };
    }
    return {
        success: true, excelFormula, tree: namedTree(compiled), postfixArray: compiled.columnsAsIndexes,
        types: compiled.types, unknownStrings: compiled.unknownStrings,
    };
}

const CONSTANTS = new Set(['pi', 'π', 'e', 'tau', 'τ', '°', '∞', '-∞']);   // written as SQL's or a spreadsheet's own (PI(), EXP(1) …)

/** The names that are neither columns, constants nor functions the caller lists: an error message, or null. */
function unknownNames(compiled, options) {
    const listed = (name) => (typeof options.functions === 'function' ? options.functions(name) : (options.functions ?? []).includes(name));
    const unknown = compiled.columnsAsIndexes.filter((t, i) => (compiled.types[i] === 'unknown' && !CONSTANTS.has(t))
        || (isCustomFunction(t) && !listed(t.slice(2))));
    return unknown.length ? `unknown name ${unknown.map((t) => (isCustomFunction(t) ? t.slice(2) + '(…)' : t.replace(/^_(?=c\d+$)/, ''))).join(', ')}` : null;
}

/**
 * Turn strToFunction's `jsFunction` into a function of one row (an array
 * of values in header order).
 *
 * The code is compiled with `new Function`, and only after checkGeneratedJs
 * has found nothing but whitelisted pieces in it (safe.js); code that would
 * reach any other name, a computed member or a template literal is never
 * compiled — the function returned just gives 'Error: not allowed …'. Call
 * checkGeneratedJs yourself to get an exception instead.
 */
export function createRowEvaluator(jsCode) {
    if (!jsCode || typeof jsCode !== 'string') return () => 'Error: Invalid JavaScript code';
    // Only code made of whitelisted pieces is compiled — column values, Math, operators; see safe.js.
    // Like any code that can't be compiled, refused code gives a function that returns the reason.
    try {
        checkGeneratedJs(jsCode, { variables: /^c\d+$/, keywords: false });   // a formula is one expression: no let / for / return
    } catch (error) {
        return () => `Error: ${error.message}`;
    }
    // c0, c1, ... become row[0], row[1], ... — but not inside a string literal like "c1".
    const body = jsCode.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\bc(\d+)\b/g,
        (match, string, i) => (string ? string : `row[${i}]`));
    try {
        return new Function('row', `try { return ${body}; } catch (error) { return 'Error: ' + error.message; }`);
    } catch (error) {
        return () => `Error creating function: ${error.message}`;
    }
}

/**
 * The formula's tree with columns under their own names. Built from the
 * index form, because a column may be called like an operator (`neg`,
 * `max`, `sum`) and would be read as one if the names went back through
 * fromPostfix.
 */
function namedTree({ columnsAsIndexes, columnsAsNames, types }) {
    const tree = fromPostfix(columnsAsIndexes);
    (function visit(node) {
        if (node.type === 'op') node.args.forEach(visit);
        else if (types[node.id] === 'column') node.value = columnsAsNames[node.id];
    })(tree);
    return tree;
}

function compile(header, formula, selections) {
    if (!Array.isArray(header)) throw new Error('Header must be an array of column names');
    if (!formula || typeof formula !== 'string') throw new Error('Formula must be a non-empty string');

    let postfix;
    try {
        // the placeholders kept whole: in LaTeX (\sqrt{x}) letters side by side are a product, and tktkA would be t·k·t·k·A
        postfix = parse(replaceColumnNames(formula, header), { names: header.map((_, i) => placeholderFor(i)) });
    } catch (error) {
        return { success: false, error: error.message, unknownStrings: [] };
    }

    const columnsAsIndexes = [];
    const columnsAsNames = [];
    const types = [];
    const unknownStrings = [];
    postfix.forEach((token) => {
        let { type, value } = classify(token, header);
        if (type === 'unknown') {
            unknownStrings.push(token);
            const chosen = resolveUnknown(selections.get(token), header);
            if (chosen) ({ type, value } = chosen);
        }
        types.push(type);
        // an unknown name spelt like a column's slot (c1) must not become one in the JavaScript: it stays
        // unknown there, and the row evaluator refuses it like any other name
        if (type === 'unknown' && /^c\d+$/.test(value)) value = `_${value}`;
        columnsAsIndexes.push(type === 'column' ? `c${value}` : value);
        columnsAsNames.push(type === 'column' ? header[value] : value);
    });
    // f(x), alert(x): a function that isn't MathZetta's is reported like an unknown name
    for (const token of postfix) if (isCustomFunction(token)) unknownStrings.push(token.slice(2));
    return { success: true, columnsAsIndexes, columnsAsNames, types, unknownStrings };
}

function classify(token, header) {
    if (isOperator(token)) return { type: 'operator', value: token };
    if (isNumber(token, true) || percentDecimal(token) !== null) return { type: 'number', value: token };   // 50% is 0.5
    if (['true', 'false', 'null', 'undefined'].includes(token)) return { type: 'boolean', value: token };
    if (token.length > 1 && /^(["'`]).*\1$/s.test(token)) return { type: 'string', value: token };
    const index = columnIndexOf(token, header);
    if (index >= 0) return { type: 'column', value: index };
    return { type: 'unknown', value: token };
}

function resolveUnknown(selection, header) {
    if (!selection || selection.value === undefined) return null;
    switch (selection.type) {
        case 'column': {
            const index = header.indexOf(selection.value);
            return index < 0 ? null : { type: 'column', value: index };
        }
        case 'integer': {
            const n = parseInt(selection.value, 10);
            return Number.isNaN(n) ? null : { type: 'number', value: String(n) };
        }
        case 'float': {
            const n = parseFloat(selection.value);
            return Number.isNaN(n) ? null : { type: 'number', value: String(n) };
        }
        case 'string':
            return { type: 'string', value: `"${selection.value}"` };
    }
    return null;
}
