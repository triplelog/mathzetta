/**
 * '@mathzetta/inlinemath/lite' — Inline Math's drawing only: `toHTML()` and nothing live. The same layout,
 * glyphs, colours, highlights and accessible (spoken) labels as the full build, without the live
 * view (render, step animation, events), Markdown, the CAS or the calculator.
 *
 *   import { toHTML } from '@mathzetta/inlinemath/lite';
 *   el.innerHTML = toHTML('\\int_0^1 x^2 dx');
 *
 * `{{…}}` blocks: load the calculator too (`import 'mathzetta/calculate'`) and they are worked out
 * ('3+4={{3+4}}' draws 3 + 4 = 7); without it they are drawn as written. For variables in them,
 * pass `{ blocks: calculateBlock, scope }`.
 *
 * Needs inlinemath.css on the page (and optionally fonts/fonts.css), like the full build.
 */

export { toHTML, treeOf } from './draw.js';
export { layout, DEFAULTS } from './layout.js';
export { select, numberTree } from './select.js';
