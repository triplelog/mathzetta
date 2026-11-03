/**
 * The <script> builds — build/mathzetta.<flavour>.min.js: the core (parse, the tree tools, the
 * operator table) plus these outputs, each setting window.MathZetta. rollup.config.js builds them,
 * `tools/cdn.js --sizes` lists them in build/sizes.json, and the site's cdn.html picks the smallest
 * one holding what a page ticks. `all` is build/mathzetta.min.js (src/all.js, plus toUnified).
 *
 * Two outputs come with company: GLSL brings formulas (what qblur's filters need), and formulas
 * brings the JavaScript, SQL and Excel outputs it is made of (what tabview's embed needs).
 */
export const ENTRIES = ['latex', 'mathml', 'text', 'speech', 'javascript', 'python', 'sql', 'excel', 'glsl', 'evaluate', 'calculate', 'formulas'];

const DISPLAY = ['latex', 'mathml', 'text', 'speech'];
const MATHS = ['evaluate', 'calculate'];
const CODE = { javascript: ['javascript'], python: ['python'], sql: ['sql'], excel: ['excel'], glsl: ['glsl', 'formulas'] };

export const FLAVOURS = {
    core: [],
    latex: ['latex'],
    display: DISPLAY,
    maths: MATHS,
    'maths-display': [...MATHS, ...DISPLAY],
    ...CODE,
    formulas: ['formulas', 'javascript', 'sql', 'excel'],
    ...Object.fromEntries(Object.entries(CODE).map(([name, outputs]) => [`maths-${name}`, [...MATHS, ...outputs]])),
    code: ['javascript', 'python', 'sql', 'excel', 'glsl', 'formulas'],
};

/**
 * The "plain" flavours: the same, built without the code-spelling reader (src/parse/clean/code.js:
 * numpy, SymPy, SQL, spreadsheet and GLSL spellings on input) — about 5 KB gzipped less — for pages
 * that read maths and LaTeX only. Only the flavours without a code output have one: writing code
 * out and reading it back belong together (the round-trip test).
 */
const CODE_OUTPUTS = ['javascript', 'python', 'sql', 'excel', 'glsl', 'formulas'];
export const PLAIN_FLAVOURS = Object.fromEntries(Object.entries(FLAVOURS)
    .filter(([, outputs]) => !outputs.some((o) => CODE_OUTPUTS.includes(o)))
    .map(([name, outputs]) => [name === 'core' ? 'plain' : `plain-${name}`, outputs]));
export const isPlain = (name) => name === 'plain' || name.startsWith('plain-');

/** The file a flavour is built to. */
export const flavourFile = (name) => (name === 'all' ? 'build/mathzetta.min.js' : `build/mathzetta.${name}.min.js`);
