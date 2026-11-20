/**
 * Inline Math — draws calculus-level math as HTML and CSS, from anything
 * MathZetta can read, with every part addressable.
 *
 *   import { toHTML, render } from '@mathzetta/inlinemath';
 *
 *   toHTML('\\int_0^1 x^2 dx')                 // a string, works in Node
 *   const view = render(div, 'd/dx sin(x^2)')   // live: highlight, click, animate
 *
 * Needs inlinemath.css on the page (and optionally fonts/fonts.css).
 */

export { toHTML, treeOf } from './html.js';
export { layout, DEFAULTS } from './layout.js';
export { View, render, shouldAnimate } from './view.js';
export { select, signature, nodeAt, pathOf, numberTree } from './select.js';
export { PATHS } from './glyphs.js';
