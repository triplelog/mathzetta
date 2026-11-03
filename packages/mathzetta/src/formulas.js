/**
 * Formulas over table columns: `Value * 2 + Count`, where `Value` and
 * `Count` are column names. Used by the formula demo to filter and compute
 * over rows of a spreadsheet.
 *
 * Column names are matched case-insensitively as whole words and swapped
 * for placeholders before parsing, so names that look like maths (`e`,
 * `max`) still mean the column.
 */

import { parse } from './parse/index.js';
import { isOperator, isCustomFunction } from './operators.js';
import { isNumber } from './parse/vocabulary.js';
import { fromPostfix } from './tree.js';
import { checkGeneratedJs } from './safe.js';

export { checkGeneratedJs, isSafeGeneratedJs, UnsafeCodeError } from './safe.js';
import { toCode } from './render/code.js';
import { toMathml } from './render/mathml.js';
import { toSqlCode } from './render/sql.js';
import { toExcelFormula } from './render/excel.js';
import { replaceColumnNames, columnIndexOf } from './columns.js';


/**
 * Compile a formula to JavaScript that reads columns as `c0`, `c1`, ...
 *
 * @param {string[]} header column names
 * @param {string} formula
 * @param {Map<string, {type, value}>} [unknownStringSelections] what to do
 *   with words that are neither columns nor maths: `{ type: 'column' |
 *   'integer' | 'float' | 'string', value }`
 * @returns {{ success: true, jsFunction, postfixArray, types, unknownStrings,
 *   mathMLOriginal, mathMLSubbed } | { success: false, error, unknownStrings }}
 */
export function strToFunction(header, formula, unknownStringSelections = new Map()) {
    const compiled = compile(header, formula, unknownStringSelections);
    if (!compiled.success) return compiled;
    const { columnsAsIndexes, columnsAsNames } = compiled;
    const mathml = toMathml(namedTree(compiled));
    return {
        success: true,
        jsFunction: toCode(fromPostfix(columnsAsIndexes)),
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
    const CONSTANT = new Set(['pi', 'π', 'e', 'tau', 'τ', '°', '∞', '-∞']);   // written as SQL's own (PI(), EXP(1) …)
    const unknown = compiled.columnsAsIndexes.filter((t, i) => (compiled.types[i] === 'unknown' && !CONSTANT.has(t))
        || (isCustomFunction(t) && !(typeof options.functions === 'function' ? options.functions(t.slice(2)) : (options.functions ?? []).includes(t.slice(2)))));
    if (unknown.length) return { success: false, error: `unknown name ${unknown.map((t) => (isCustomFunction(t) ? t.slice(2) + '(…)' : t)).join(', ')}`, unknownStrings: compiled.unknownStrings };
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
        postfix = parse(replaceColumnNames(formula, header));
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
        columnsAsIndexes.push(type === 'column' ? `c${value}` : value);
        columnsAsNames.push(type === 'column' ? header[value] : value);
    });
    // f(x), alert(x): a function that isn't MathZetta's is reported like an unknown name
    for (const token of postfix) if (isCustomFunction(token)) unknownStrings.push(token.slice(2));
    return { success: true, columnsAsIndexes, columnsAsNames, types, unknownStrings };
}

function classify(token, header) {
    if (isOperator(token)) return { type: 'operator', value: token };
    if (isNumber(token, true)) return { type: 'number', value: token };
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
