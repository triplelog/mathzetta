/** 'mathzetta/javascript' — a JavaScript expression using Math.*; see 'mathzetta/formulas' to run it over table rows. */

import { treeOf, isEmpty } from './input.js';
import { toCode } from './render/code.js';

/**
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {'javascript'|'python'|'numpy'} [language]
 */
export function toJavaScript(input, language = 'javascript') {
    if (isEmpty(input)) return '0';
    return toCode(treeOf(input), language);
}
