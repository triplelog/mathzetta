# MathZetta

Parse maths written almost any way — plain text, LaTeX, unicode,
JavaScript, Python (math, numpy or SymPy), SQL, GLSL or a spreadsheet formula — into **standard postfix**,
then add the outputs you need: LaTeX, MathML, spoken English, JavaScript,
Python, SQL, Excel/Sheets, GLSL, plain text, and exact or numeric evaluation. It reads
every code format it writes (`test/unit/roundtrip.test.js`), so code can go
out and come back; [mathzetta-convert](https://mathzetta.com/convert/) is the page for that.

```bash
npm install mathzetta
```

```js
import { parse } from 'mathzetta';
import { toLaTeX } from 'mathzetta/latex';
import { toSpeech } from 'mathzetta/speech';
import { calculate } from 'mathzetta/calculate';

parse('3x^2 + \\sin x')        // ['3', 'x', '2', '^', '*', 'x', 'sin', '+']
parse('Math.pow(x, 2) / 2')    // ['x', '2', '^', '2', '/']
parse('x² ≤ √y')               // ['x', '2', '^', 'y', 'sqrt', '≤']
parse('d/dx (x^2 + 1)')        // ['x', '2', '^', '1', '+', 'x', 'der']

toLaTeX('3x^2 + sin(x)')       // '3x^2 + \\sin\\left(x\\right)'
toSpeech('(x+1)^2')            // 'the quantity x plus 1, squared'
calculate('sqrt(8)').text      // '2*sqrt(2)'
parse('3+4={{3+4}}')           // ['3', '4', '+', '7', '='] — once mathzetta/calculate is loaded
```

In CommonJS the same entry points work with `require`: `require('mathzetta/latex')` loads the core
and LaTeX (`build/cjs/`), while `require('mathzetta')` is everything at once, like `mathzetta/all`.

No runtime dependencies; ES modules for the browser and Node 18+. A
`<script src="build/mathzetta.min.js">` tag exposes everything as
`window.MathZetta`. Maths *display* is a separate library,
[Inline Math](https://inlinemath.com), which draws these trees with every part addressable.

## From a CDN

Every npm release is on jsDelivr (and unpkg) by itself — nothing to install or build:

```html
<!-- a script tag: everything on window.MathZetta -->
<script src="https://cdn.jsdelivr.net/npm/mathzetta@1/build/mathzetta.min.js"></script>

<!-- a module -->
<script type="module">
  import { parse, toLaTeX } from 'https://cdn.jsdelivr.net/npm/mathzetta@1/build/mathzetta.esm.min.js';
</script>

<!-- an import map: code written for npm (import … from 'mathzetta', 'mathzetta/latex') runs unchanged,
     since the bundle holds every entry point -->
<script type="importmap">
{ "imports": { "mathzetta": "https://cdn.jsdelivr.net/npm/mathzetta@1/build/mathzetta.esm.min.js",
               "mathzetta/latex": "https://cdn.jsdelivr.net/npm/mathzetta@1/build/mathzetta.esm.min.js" } }
</script>
```

Less than everything — pick on the site's [CDN page](https://mathzetta.com/cdn.html), which writes
the snippet and totals the size:

- **`<script>` tags come in flavours** (`tools/flavours.js`; `build/mathzetta.<flavour>.min.js`, each
  setting `window.MathZetta`): `core` (parse, the tree tools, the operator table; 22 KB gzipped);
  the core plus one output — `latex`, `javascript`, `python`, `sql`, `excel`, `glsl` (which
  brings `formulas`); `formulas` (with the JavaScript, SQL and Excel outputs it is made of);
  `display` (LaTeX, MathML, text, speech; 30 KB); `maths` (evaluate, calculate; 31 KB) and
  `maths-display`, `maths-javascript`, `maths-python`, `maths-sql`, `maths-excel`,
  `maths-glsl`; `code` (every code output; 50 KB); and `mathzetta.min.js`, everything (65 KB —
  56 KB with brotli, which the CDN uses). `npm run cdn` lists them with their addresses.
- **Plain** — the same without the code-spelling reader (`src/parse/clean/code.js`: numpy, SymPy,
  SQL, spreadsheet and GLSL spellings on input), about 5 KB gzipped less, for pages that read
  maths and LaTeX only: `mathzetta.plain.min.js` (17 KB) and `plain-latex`,
  `plain-display`, `plain-maths`, `plain-maths-display`; as modules
  `mathzetta.plain.esm.min.js` (`import … from 'mathzetta/plain'`; `require('mathzetta/plain')` loads `mathzetta.plain.cjs`) and `build/esm-plain/`. The code
  outputs keep the full reader: writing code out and reading it back belong together.
- **ES modules, any combination:** `build/esm/<entry>.js` is one file per entry point
  (`esm/latex.js`, `esm/speech.js`, …), all sharing `esm/chunks/core.js` (22 KB), so a page imports
  the outputs it wants and the core loads once — LaTeX is 2 KB more, speech 4.5 KB, GLSL 9 KB. An
  import map (`"mathzetta"` → `esm/core.js`, `"mathzetta/latex"` → `esm/latex.js`) lets code
  written for npm run unchanged. `build/sizes.json` has every file's size; `npm run build` writes it.

`@1` follows the latest 1.x; `@1.0.0` pins one release, which never changes (cache it forever, add
an `integrity` hash — `npm run cdn` prints the snippets with the hashes for the version in
package.json, and `npm run cdn -- --check` confirms the CDN's copies match the local build). `src/`
is on the CDN too (`…/mathzetta@1/src/latex.js`), for a page that wants one output and nothing
else. Publishing is `npm publish` (`prepublishOnly` runs the tests and the build).

## Entry points

The core is the parser; every output is optional. Each entry accepts an
expression string, standard postfix, or a tree.

| Import | Gives |
| --- | --- |
| `mathzetta` | `parse`, `parseTree`, `parseSteps`, `clean`; `fromPostfix`, `toPostfix`, `walk`, `treeOf`; the operator table (`operator`, `operatorNames`, `needsParens`, …); the tree-reading helpers outputters share (`needsBrackets`, `isImplicitProduct`, `GREEK`, …) |
| `mathzetta/latex` | `toLaTeX(x, { wrap })` — `wrap(node, latex)` can tag each subexpression |
| `mathzetta/mathml` | `toMathML(x)` — each node's element has `id="mz-<index>"` |
| `mathzetta/text` | `toText(x)` — readable text: `√(x)`, `x ∈ {1, 2}` |
| `mathzetta/speech` | `toSpeech(x, { words, names, say })` — read aloud as a teacher would, every word changeable; `toSpeechSegments(x)` — the same in pieces tagged with node ids, for captions that follow the maths |
| `mathzetta/javascript` | `toJavaScript(x)` — code using `Math.*` |
| `mathzetta/python` | `toPython(x, { numpy, sympy })` — code using `math.*`, numpy element-wise, or SymPy (exact; `diff`, `integrate`, `limit`, `summation`); `toPythonFunction(f, { numpy, sympy, errors })` — a checked `def` (with sympy, the x of d/dx is a Symbol and a parameter x is substituted after) (1/0 raises, or `errors: 'nan'`); `fillPythonTemplate(program, formulas)` / `preparePythonTemplate` (per-slot results for a form) — a Python program with `# mathzetta: growth(P, r, K) = …` slots, including formulas over a dataset's columns (`keep(data: columns) = HR >= 30`); `mathzetta-python chart.py x='H / AB' --run out.png` fills and runs one. `examples/python/logistic.py` is a model; [pyslots](https://tabdn.com/pyslots/) makes templates into web pages (Pyodide or Flask), with matplotlib charts over baseball data |
| `mathzetta/excel` | `toExcel(x, { cells, ranges })` — an Excel / Google Sheets formula (`=IF(x>0, SQRT(x), 0)`), bracketed for a spreadsheet's own rules; read back too (`=…` is read as a spreadsheet formula); `forXlsxFile` adds `_xlfn.` for an .xlsx file |
| `mathzetta/sql` | `toSQL(x, { dialect, quoteIdentifiers, stringQuote })` — PostgreSQL by default, or `dialect: 'sqlite'` |
| `mathzetta/glsl` | `toGLSL(x, { version })` — a shader expression, floats throughout; `GLSL_HELPERS`; `filterShader(spec)` — a whole fragment shader over an image's pixels (the filter format and WebGL runner on top of it are [qblur](https://qblur.com)) |
| `mathzetta/evaluate` | `evaluate(x, scope)` — a value in double precision, without running generated code |
| `mathzetta/calculate` | `calculate(x, scope, { decimal, places })` → `{ value, text, exact }` — exact where possible (fractions, 2¹⁰⁰, `2*sqrt(2)`, π, trig at standard angles, exact logs), numeric derivatives, definite integrals, limits and infinite sums otherwise (`∑ 1/n²` → `pi^2/6`). Throws `MathError` when there is no answer, `UnknownError` when it can't be worked out. **Loading this entry switches on `{{…}}` blocks** in every input: `{{1/3+1/6}}` → `1/2`, `{{~3 pi}}` → `3.142` |
| `mathzetta/formulas` | `strToFunction(header, formula)`, `createRowEvaluator(js)`, `strToSQL(header, formula, selections, { dialect })` — formulas over table columns |
| `mathzetta/all` | all of the above, plus `toUnified(x)` (every format at once) and `convert(x, format)` |

`parse(text, options)`: `names` lists multi-letter variables to keep whole
(`['cost', 'rate']`); `values` names that are never functions; `blocks`
sets how `{{…}}` is filled for this call (`null` leaves them as a plain
group) and `scope` gives its variables values; `keepIntermediateSteps` (or
`parseSteps`) returns every stage — cleaned text, tokens, raw postfix,
tree, postfix, error.

## Try it

[mathzetta.com](https://mathzetta.com) tries every output live: the
[playground](https://mathzetta.com/demos/) shows every stage and format of what you type,
[operators](https://mathzetta.com/demos/operations.html) lists what each one reads and writes as,
the [API page](https://mathzetta.com/api.html) has every function and option with a live example,
the [CDN page](https://mathzetta.com/cdn.html) builds a script tag or import map for the outputs you
pick, and the [postfix quiz](https://mathzetta.com/quiz.html) teaches the algorithm.

```bash
npm test                # ~6,400 checks: unit tests and every table in test/cases
npm run build           # the bundles in build/ (what npm and the CDN ship)
npm run coverage        # what the test tables don't cover yet
```

## The postfix format

[docs/postfix.md](docs/postfix.md) lists every token. In short: operands
and operators in reverse Polish order; fixed-arity operators are bare
(`x sin`, `a b ^`), variadic ones follow a count (`a b c 3 max`), unary
minus is `neg`. It is the format every sibling library speaks: Inline Math
draws it, MathZetta CAS rewrites it, speech segments are tagged by it.

## How it works

[docs/how-it-works.md](docs/how-it-works.md) walks through the pipeline —
clean → tokenize → parse → tree → render — and has recipes for
adding spellings, operators and tests, plus the known parsing gaps.

## Layout

```
src/
  index.js          the core: parser, operator table, tree tools
  all.js            everything, plus toUnified — what build/ bundles
  latex.js mathml.js text.js speech.js javascript.js python.js sql.js excel.js glsl.js
                    one entry per outputter (each a few lines over render/)
  evaluate.js       doubles          calculate.js   exact + numeric calculus
  formulas.js       formulas over table columns
  operators.js      the operator table: precedence, arity, ...
  tree.js           tree ⇄ postfix    common.js      how a tree reads when written
  parse/            clean/ → tokenize → parser (Pratt) → build
  render/           tree → string, one file per format
  types.d.ts        every declaration; index.d.ts and <entry>.d.ts pick from it
test/
  run.js            npm test
  unit/             focused tests
  cases/            table tests (TSV); checked by test/checks.js
  known-failures.json   checks that fail today, with reasons
tools/              the build's flavour list, the CDN addresses and sizes, test coverage, mathzetta-python
docs/
```
