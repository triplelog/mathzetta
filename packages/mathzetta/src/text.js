/** 'mathzetta/text' — readable plain text: √(x), x ∈ {1, 2}. */

import { treeOf, isEmpty } from './input.js';
import { toPlainText } from './render/text.js';

/** @param {string|string[]|object} input expression text, standard postfix or a tree */
export function toText(input) {
    if (isEmpty(input)) return '';
    return toPlainText(treeOf(input));
}
