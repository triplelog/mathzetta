# MathZetta

Maths written any way, read into one form, written out every way.

This repository holds three JavaScript libraries that share one format, MathZetta's
[standard postfix](packages/mathzetta/docs/postfix.md):

| Package | What it does | npm |
| --- | --- | --- |
| [**mathzetta**](packages/mathzetta) | Parses maths written almost any way (plain text, LaTeX, unicode, JavaScript, Python, SQL, GLSL, spreadsheet formulas, plain English) into standard postfix, and writes it out as LaTeX, MathML, HTML, spoken English, JavaScript, Python, SQL, Excel/Sheets, GLSL or plain text, with exact or numeric evaluation. No dependencies. | [`mathzetta`](https://www.npmjs.com/package/mathzetta) |
| [**inlinemath**](packages/inlinemath) | Draws those trees as HTML and CSS, every part addressable: highlight, colour, animate between steps, speech segments; Markdown with maths. `inlinemath/lite` is the drawing alone (about a third smaller). | not yet published |
| [**calcrules**](packages/calcrules) | Rewrites postfix with readable YAML rules (derivatives, simplification), and an exact CAS on top: simplify, factor, solve, integrate, with steps. | not yet published |

```bash
npm install mathzetta
```

```js
import { parse } from 'mathzetta';
import { toLaTeX } from 'mathzetta/latex';

parse('3x^2 + \\sin x')     // ['3', 'x', '2', '^', '*', 'x', 'sin', '+']
toLaTeX('3x^2 + sin(x)')    // '3x^2 + \\sin\\left(x\\right)'
```

Try them live: [mathzetta.com](https://mathzetta.com) (the playground, every operator, the API with
live examples, a CDN picker, a postfix quiz) and [inlinemath.com](https://inlinemath.com).

## Working on it

The packages are npm workspaces: one `npm install` at the root links them to each other.

```bash
npm install     # links the three packages, installs the build tools
npm test        # builds, then every package's tests
npm run build   # mathzetta's bundles (build/) and inlinemath's (dist/)
```

Each package has its own README, tests and `npm publish` (run in its folder; `prepublishOnly` tests
and builds it first). Node 18+ runs the libraries; building and testing them needs Node 20.6+.

## Licence and contact

MIT © Robert Wilcox · rwilcox@mathzetta.com. Security reports: [SECURITY.md](SECURITY.md).
