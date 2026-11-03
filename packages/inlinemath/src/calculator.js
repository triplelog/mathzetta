/**
 * MathZetta's calculator. Loading 'mathzetta/calculate' is what makes `{{3+4}}` in an input draw as
 * 7: it registers the calculator with the parser. The full Inline Math (index.js, markdown, cas)
 * imports this; the lite build (lite.js) doesn't.
 */
export { calculateBlock, calculate } from 'mathzetta/calculate';
