# CLAUDE.md

MathZetta parses maths written almost any way into **standard postfix**
(docs/postfix.md). The core (`mathzetta`) is the parser, the operator table
and the tree tools; each output format is its own entry point
(`mathzetta/latex`, `/mathml`, `/text`, `/speech`, `/javascript`,
`/python`, `/sql`, `/excel`, `/glsl`, `/evaluate`, `/calculate`, `/formulas`), and
`mathzetta/all` is everything (the `<script>` build). Zero runtime
dependencies; plain ES modules.

This package is `packages/mathzetta` of the public repository triplelog/mathzetta (an npm workspace,
see ../../CLAUDE.md); `../inlinemath` (display) and `../cas` (rule rewriting, the CAS) are its
neighbours there. Other projects build on it too (qblur, tabview, the tabdn servers, pyslots, the
calculus videos) from outside this repository. Keep MathZetta standalone — no imports from any of
them, and nothing here about the closed projects beyond a public link.

## Commands

```bash
npm test          # node test/run.js — unit tests (test/unit/*.test.js, 9 files by subject) + every TSV in test/cases
npm run coverage  # tools/test-coverage.js: what the tables cover — checks per output column, operators no row uses,
                  # rows with no expected value, code spellings the reader knows that no input uses
npm run build     # rollup → build/ (bundles, flavours, split ES modules and CommonJS; gitignored, shipped to npm)
npm run cdn       # the jsDelivr/unpkg addresses of this version's bundles, with integrity hashes; -- --check compares the CDN's copies with build/
npm publish       # a release: prepublishOnly runs the tests and the build; jsDelivr and unpkg pick it up by themselves
```

Rebuild after changing `src/`: the website's pages, tabc/sqldn and `npm test` (package.test.js) load `build/`.

## Where things are

- `src/index.js` — the core's exports. `src/all.js` — everything plus toUnified.
- `src/<format>.js` — one thin entry per outputter: accepts text, postfix or a tree, calls `src/render/<format>.js`.
- `src/operators.js` — the operator table (precedence, arity, fixity). Start here.
- `src/parse/` — clean/ (text rewriting) → tokenize → parser.js (Pratt parser) → build (tree).
  `clean/index.js` takes the code-spelling phase from `clean/code-phase.js`; the "plain" builds (rollup.config.js, `tools/flavours.js`)
  resolve that file to `code-phase.plain.js` (an identity) and read maths and LaTeX only.
  `clean/code.js` reads programming spellings (numpy, Python conditionals, SQL CASE/capitals, GLSL helpers,
  JavaScript's inline helpers from `src/js-helpers.js`). A renderer that starts writing something new fails
  test/unit/roundtrip.test.js until the parser reads it back — keep writer and reader in step.
  test/cases/calculus.tsv holds the Calculus I inputs and how a person reads them.
  `parseSteps(text)` shows every stage; use it to debug an input.
  `{{…}}` blocks are filled by the handler set with `setBlockHandler()`; loading `src/calculate.js` sets it.
- `src/tree.js` — tree ⇄ postfix. Node `id` = postfix index; every outputter and Inline Math use it.
- `src/common.js` — how a tree reads when written: brackets, implicit products. Exported from the core for Inline Math.
- `src/render/` — tree → string, one file per format. speech.js is what the calculus videos read aloud (`toSpeech`, the drawing in view) and, with its `audio` flag, what a screen reader hears (`toAudioSpeech`: compound groups opened with "the quantity" and closed with an end word, dropped at the very end) — one Speaker, two entry points; Inline Math's aria-label uses the audio one. Phrasing is in test/cases/speech.tsv (Speech and Audio columns); keep the video wording unchanged when touching the audio rules.
- `src/evaluate.js` — doubles; `src/calculate.js` — exact (BigInt fractions, surds, π) and numeric calculus.
- `src/formulas.js` — strToFunction / strToSQL for formulas over table columns (tabview, sqldn). Column-name matching is `src/columns.js`, shared with Python.
- `test/cases/` — the table tests, one file per subject (consolidated 2026-11-02 from 24 files; every distinct check kept):
  `reading.tsv` (how input is read: text, LaTeX, unicode, code spellings, words), `precedence.tsv`, `functions-and-sets.tsv`,
  `every-output.tsv` (155 inputs through JavaScript, LaTeX, MathML, SQL), `operators.tsv`, `calculus.tsv`, `speech.tsv`,
  `glsl.tsv`, `formulas.tsv` (over formula-data.csv). Columns: Clean, Postfix, Latex, MathML, JavaScript, Python, SQL, Excel,
  Text, Evaluated, Speech, GLSL — a blank cell isn't checked (test/checks.js). The website's test runner (mathzetta-website, private; its dev server edits these files) changes
  them in place: "Accept output", "Fill from current output" for rows with no expectations, "Mark known…" for test/known-failures.json. The run fails if a known failure starts passing.
  A cell `ERROR` (or `ERROR: text`) expects a refusal; in formulas.tsv, `ERROR` in the columns cell. test/known-failures.json
  is empty since 2026-11-03 (every stale expectation reviewed): keep it for genuinely unsolved checks, with a true reason.
- Plain English is a cleaning phase, `src/parse/clean/english.js` (after `code`): comparisons (`x is at least 3`), ranges (`x is between 3 and 5`, `exclusive`, `strictly`), properties (`n is even`, `x is a whole number`, `n is divisible by 3`), and the words `toSpeech` uses, so speech reads back (parse.test.js checks it). Operator words (plus, times…) only between operands.
- A chain of comparisons `3 < x < 7` keeps its written postfix (`3 x < 7 <`); `expandChain()` in common.js turns it into
  `(3 < x) & (x < 7)` for evaluate, calculate and the code outputs that don't chain (JS, SymPy, SQL, Excel, GLSL).
- `src/python-function.js` — toPythonFunction, checkGeneratedPython (the whitelist), Python templates with `# mathzetta:` slots; `tools/python-template.js` is the `mathzetta-python` command; `examples/python/logistic.py` and `test/fixtures/python/` are run by test/unit/python.test.js when python3 (and numpy) are there. `preparePythonTemplate` is what a form needs (every slot's error, latex, tree, never throws); ../pyslots is the web page built on it, with the matplotlib chart examples over baseball data.
- The web site (mathzetta.com: home, API page with live examples of every export, CDN picker, postfix quiz, playground,
  operators, test runner) is the private repository mathzetta-website. A new export or option also gets an entry in its
  `mathzetta/api-data.js` (its tests run every example).
- docs/how-it-works.md has the pipeline and recipes (new spelling, new operator, new test).

## Rules of thumb

- Changing output format: update docs/postfix.md, and expect TSV
  expectations to change — review the diffs, don't bulk-accept them.
- `test/known-failures.json` lists checks that fail today. The run fails if
  one starts passing, so remove fixed entries.
- Never evaluate user input with `eval`/`new Function`; `evaluate()` and
  `calculate()` exist for that. (`createRowEvaluator` compiles renderer output only.)
- Every operator in the table must render in every format —
  test/unit/operators.test.js enforces it.
- A new export goes in `src/types.d.ts` and the entry's `.d.ts`.
- **Input is untrusted** (typed into pages, stored in embeds, carried in links); the checks are in
  `test/unit/formulas.test.js` ("security: untrusted formulas"). Keep to them: a value written inside quotes in
  code is validated, never pasted (`lim`'s side is r or l); SQL and spreadsheet output write `f(…)` only for
  functions the caller lists (`functions`: a list or `(name) => boolean`); `strToSQL` refuses names that
  aren't columns; generated JS passes `checkGeneratedJs` (helpers matched as exact text, `keywords: false` for
  formulas); every top-level lookup table has a null prototype (a file ends with
  `Object.setPrototypeOf(table, null)` for each) — a new table goes in that list; names from a postfix array
  or tree are escaped in MathML and LaTeX; `filterShader` takes only GLSL identifiers for uniforms and pictures.
- **Nothing runs for long or grows without bound** (suite "limits: work, size and depth"): `parse` reads at most
  5000 characters (`maxLength`), trees are at most 1000 levels (`MAX_DEPTH`, src/tree.js), `evaluate` and
  `calculate` have a step budget (5,000,000 nodes per call, nested calls share it), perm/comb stop at ∞, a
  cleaning phase that grows past 100k characters and an output past a million (`guardLength`) are refused, a
  filter pass has at most 24 neighbourhood calls. A regex that starts with an operand anchors it to the start of
  a word (english.js), or a long word makes it quadratic. Generated JS sum loops cap each loop at a million but
  checkGeneratedJs refuses them, so only a caller running toJavaScript itself meets them.
