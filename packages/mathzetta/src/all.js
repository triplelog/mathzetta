/**
 * 'mathzetta/all' — the core and every outputter in one import, plus
 * toUnified() (every format at once). This is what build/mathzetta.js
 * exposes as window.MathZetta. Loading it also switches on `{{…}}` blocks,
 * because it loads the calculator.
 *
 * For a smaller bundle import the core ('mathzetta') and the outputters
 * you use ('mathzetta/latex', …).
 */

import { parse } from './parse/index.js';
import { toPostfix, walk } from './tree.js';
import { treeOf, isEmpty } from './input.js';
import { bracketOp } from './common.js';
import { toLatex } from './render/latex.js';
import { render as mathmlNode } from './render/mathml.js';
import { toCode } from './render/code.js';
import { toSqlCode } from './render/sql.js';
import { toPlainText } from './render/text.js';
import { toSpeech as speak } from './render/speech.js';
import { toGlsl } from './render/glsl.js';
import { toLaTeX } from './latex.js';
import { toMathML } from './mathml.js';
import { toText } from './text.js';
import { toSpeech } from './speech.js';
import { toJavaScript } from './javascript.js';
import { toSQL } from './sql.js';
import { toGLSL } from './glsl.js';
import * as core from './index.js';
import * as latex from './latex.js';
import * as mathml from './mathml.js';
import * as text from './text.js';
import * as speech from './speech.js';
import * as javascript from './javascript.js';
import * as python from './python.js';
import * as sql from './sql.js';
import * as excel from './excel.js';
import { toExcel } from './excel.js';
import * as glsl from './glsl.js';
import * as evaluate from './evaluate.js';
import * as calculate from './calculate.js';   // registers calculateBlock for {{…}}
import * as formulas from './formulas.js';

export * from './index.js';
export * from './latex.js';
export * from './mathml.js';
export * from './text.js';
export * from './speech.js';
export * from './javascript.js';
export * from './python.js';
export * from './sql.js';
export * from './excel.js';
export * from './glsl.js';
export * from './evaluate.js';
export * from './calculate.js';
export * from './formulas.js';

const FORMATS = {
    latex: (node) => toLatex(node),
    mathml: (node) => mathmlNode(node),
    javascript: (node) => toCode(node, 'javascript'),
    python: (node) => toCode(node, 'python'),
    sql: (node) => toSqlCode(node),
    exp: (node) => toPlainText(node),
    speech: (node) => speak(node),
    glsl: (node) => toGlsl(node),
    op: (node) => bracketOp(node) ?? '#',
    postfix: (node) => toPostfix(node),
};

/**
 * Every format for one node, each computed on first use and then kept.
 * (Rendering every subtree of a big expression up front is quadratic;
 * most entries of the id map are never looked at.)
 */
function allFormats(node) {
    const formats = {};
    for (const [name, render] of Object.entries(FORMATS)) {
        let value;
        Object.defineProperty(formats, name, {
            enumerable: true,
            // a format that can't write this (no SQL for a function nobody listed) is '' rather than the end of every other
            get: () => (value ??= (() => { try { return render(node); } catch { return ''; } })()),
        });
    }
    return formats;
}

const idMap = new Map();

/**
 * Every format at once, as { latex, mathml, speech, javascript,
 * python, sql, glsl, exp, op, postfix }. `exp` is the plain-text form. A format
 * that can't be written for this input is ''.
 * Also refreshes getMathMLIdMap().
 */
export function toUnified(input) {
    idMap.clear();
    if (isEmpty(input)) {
        return { latex: '[empty]', mathml: '<math><mi>empty</mi></math>', javascript: '0', python: '0', sql: '0', exp: '[empty]', speech: '', glsl: '0.0', op: '', postfix: [] };
    }
    const tree = treeOf(input);
    walk(tree, (node) => {
        if (node.id !== undefined) idMap.set(`mz-${node.id}`, allFormats(node));
    });
    const result = { ...allFormats(tree) };   // spreading reads every getter once
    result.mathml = `<math>${result.mathml}</math>`;
    return result;
}

/**
 * After toUnified(): MathML element id (`mz-3`) → every format of the
 * subexpression that element shows. Lets a page show details on hover.
 */
export const getMathMLIdMap = () => idMap;

export const resetIdTracking = () => idMap.clear();

/**
 * Convert to a named format.
 * @param {'javascript'|'js'|'python'|'py'|'latex'|'tex'|'mathml'|'mml'|'speech'|'glsl'|'sql'|'excel'|'sheets'|'text'} format
 */
export function convert(input, format) {
    switch (String(format).toLowerCase()) {
        case 'javascript': case 'js': return toJavaScript(input);
        case 'python': case 'py': return toJavaScript(input, 'python');
        case 'latex': case 'tex': return toLaTeX(input);
        case 'mathml': case 'mml': return toMathML(input);
        case 'speech': return toSpeech(input);
        case 'glsl': return toGLSL(input);
        case 'sql': return toSQL(input);
        case 'excel': case 'sheets': return toExcel(input);
        case 'text': return toText(input);
    }
    throw new Error(`Unsupported format: ${format}`);
}

/**
 * Parse and convert in one call.
 * @param {string} expression
 * @param {string} [format] see convert()
 */
export default function mathZetta(expression, format = 'javascript') {
    return convert(parse(expression), format);
}

/** Everything as one object; also `window.MathZetta` in browsers. */
export const MathZetta = {
    ...core, ...latex, ...mathml, ...text, ...speech, ...javascript, ...python, ...sql, ...excel, ...glsl,
    ...evaluate, ...calculate, ...formulas,
    toUnified, getMathMLIdMap, resetIdTracking, convert,
};

if (typeof window !== 'undefined') window.MathZetta = MathZetta;

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [FORMATS]) Object.setPrototypeOf(table, null);
