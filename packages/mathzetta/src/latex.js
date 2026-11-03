/** 'mathzetta/latex' — LaTeX output. */

import { treeOf, isEmpty } from './input.js';
import { toLatex } from './render/latex.js';

/**
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {object} [options] `wrap(node, latex)` can tag each subexpression
 * @returns {string}
 */
export function toLaTeX(input, options = {}) {
    if (isEmpty(input)) return '';
    return toLatex(treeOf(input), options);
}
