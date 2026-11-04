# CLAUDE.md — inlinemath

Draws maths (anything MathZetta reads) as HTML+CSS; every node's element
carries `data-node` = MathZetta's postfix index, which is the id speech
segments and MathZetta CAS paths use. Standalone library; depends on
`mathzetta` as a package (in this workspace, `../mathzetta`; npm install at the repository root links it).

```bash
npm install     # at the repository root: links mathzetta and MathZetta CAS
npm test        # test/run.js — every input in mathzetta's calculus.tsv renders, plus notation/selection checks
npm run build   # dist/ (ES modules + <script> builds, mathzetta and @mathzetta/cas bundled in; gitignored)
```

## Where things are

- `src/mathzetta.js` (`'mathzetta'`, `'mathzetta/speech'`) and `src/calculator.js` (`'mathzetta/calculate'`) — the **only** imports from MathZetta. Keep it that way: every buildless page that uses Inline Math maps exactly these, and the lite build is everything that doesn't import calculator.js.
- `src/lite.js` — `@mathzetta/inlinemath/lite`: `toHTML` from `src/draw.js` (the drawing without the calculator; `src/html.js` adds it for the full build), layout, select; no view, Markdown or CAS. `src/lite-calc.js` is lite plus the calculator (for the dist bundles, which carry their own MathZetta). test/run.js checks lite draws every Calculus I input like the full build, and runs lite in a fresh process to check `{{…}}` stays uncalculated. The one exception is `src/cas.js`, which also imports `'mathzetta/text'` and `'@mathzetta/cas'` (pages using `@mathzetta/inlinemath/cas` map those too).
- `src/layout.js` — tree → HTML with em-based box estimates (no DOM measuring, so `toHTML` works in Node). Metrics at the top must match `inlinemath.css`.
- `src/glyphs.js` — SVG paths for `( ) { } √ ∫ ∑ ∏`.
- `src/select.js` — targets: id, expression text, `{ path }`, test function.
- `src/view.js` — live view: highlight, colour, events, speech segments, step animation (`set(next, { animate })`).
- `src/html.js` — `toHTML`, `treeOf` (parses text with `{{…}}` via calculateBlock, or `options.blocks`).
- `src/markdown.js` — `@mathzetta/inlinemath/markdown`: `markdownToHTML(text, options)` (maths in `$…$`/`$$…$$`/`\(…\)`/`\[…\]` taken out first as private-use placeholders, then a built-in Markdown renderer or `options.render`, then the drawings put back), `extractMath`, `renderMarkdown`. Raw HTML escaped by default — keep it that way. The playground is inlinemath.com/markdown.html (mathzetta-website).
- `src/cas.js` — `@mathzetta/inlinemath/cas`: `mathCAS()` (MathZetta CAS reading MathZetta text), `casBlocks()` (`{{simplify(…)}}`, `{{solve(…, x)}}`, `{{diff(…)}}` …; everything else still calculateBlock), `stepsHTML(steps)`, `tokensOf(node)` (declared functions → `\:name`). MathZetta CAS is an optional peer dependency. The playground is inlinemath.com/cas.html (mathzetta-website).

## Rules

- A new export or option goes in `src/types.d.ts` and the entry's `.d.ts` (index, lite, lite-calc, markdown, cas); peers are `mathzetta ^1` and, optional, `MathZetta CAS ^0.1`.

- Check looks with a headless-Chrome screenshot of the gallery (the demos are inlinemath.com's pages, in the private
  mathzetta-website repository; its dev server serves them over this package). The tests can't see layout.
- A MathZetta CAS expression draws as `toHTML(expr.s.split(' '))`; its rewrite `path` is a Inline Math `{ path }` — no adapter.
- Open work is listed in README.md ("What still needs doing").
