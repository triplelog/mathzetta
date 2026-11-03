/** 'mathzetta/python' — a Python expression using math.*; a formula as a Python function; Python templates with formula slots. */

import { toJavaScript } from './javascript.js';

export { toPythonFunction, checkGeneratedPython, readPythonTemplate, fillPythonTemplate, preparePythonTemplate } from './python-function.js';
export { pythonName } from './render/code.js';
export { UnsafeCodeError } from './safe.js';

/**
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {{ numpy?: boolean, sympy?: boolean }} [options] numpy: element-wise over arrays (np.where,
 *   np.maximum …); sympy: symbolic and exact (Rational, Eq, Piecewise, diff, integrate, limit, summation),
 *   with variables for the caller to make symbols
 */
export function toPython(input, options = {}) {
    if (options.numpy && options.sympy) throw new Error('numpy or sympy, not both');
    return toJavaScript(input, options.sympy ? 'sympy' : options.numpy ? 'numpy' : 'python');
}
