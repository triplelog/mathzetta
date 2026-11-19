# Inline Math

Draws calculus-level maths as plain HTML and CSS (the `@mathzetta/inlinemath` package, at inlinemath.com). The input is anything
[MathZetta](https://github.com/triplelog/mathzetta/tree/main/packages/mathzetta) reads (`sin^2 x`, `\frac{d}{dx}(x^2)`, `x**2/2`, `√x`).
Every part of the drawing can be found, coloured, clicked and animated.

Inline Math is not a LaTeX engine. It covers what a Calculus course writes:
- fractions, exponents and subscripts, radicals, brackets that grow;
- `d/dx` and `dy/dx`, integrals with limits, `lim` with its subscript, `∑`/`∏`;
- absolute value, floor and ceiling, sets and intervals;
- piecewise functions, `\boxed`, `\cancel`, `\vec`, `\hat`, `\overline`.

It needs nothing besides MathZetta: no KaTeX, no fonts (Latin Modern is
optional), and no build step.

```bash
npm install @mathzetta/inlinemath mathzetta     # mathzetta 1.x is a peer; add @mathzetta/cas for @mathzetta/inlinemath/cas
```

Inline Math is ES modules (`import`). TypeScript declarations come with it. `require('@mathzetta/inlinemath')`
works where Node can require ES modules (Node 20.19+ and 22.12+); in the browser, use the bundles
in `dist/` (below).

```js
import { toHTML, render } from '@mathzetta/inlinemath';

toHTML('\\int_0^1 x^2\\,dx');              // HTML string; works in Node too

const view = render(div, 'x^2 + 2x');       // a live view
view.highlight('2x');                       // name a part by writing it
view.color('x^2', 'crimson');
view.on('click', ({ node, id, path }) => …);   // also from the keyboard: Tab to it, arrows walk the parts, Enter picks one
view.set('2x + x^2', { animate: true });    // the next step: matching parts glide over (instant under reduced motion; 'always' to insist)
render(div, 'x^2', { announce: true });     // read each new step to a screen reader (a polite live region after the div)
view.announce('Step 2: expand');            // your own words, through the same region
view.segments();                            // [{ text: 'x', id: 3 }, { text: 'squared', id: 5 }, …]
view.editable({ toText, onEdit: ({ text }) => … }); // double-click a part (or F2 on it) to edit it in place
view.destroy();                                // stop listening (handlers, keys, editing) before drawing a new view into el
```

**Editing a part.** `view.editable({ toText })` (`import { toText } from 'mathzetta/text'`; in the
`<script>` build it is `InlineMath.toText`) opens a text box over a part when it is double-clicked,
or when F2 is pressed on the part the keyboard is on, holding that part as text. Enter puts what
was typed in its place (the rest of the expression glides over), Escape leaves it as it was, and
text that doesn't read keeps the box open, marked. `onEdit` gets the new expression as a tree and
as text, the edited part's path and what was typed; `view.edit(target)` opens the box from code.

**Keyboard and screen readers.** Every drawing has an accessible name (`role="math"`, its spoken form for a listener
who can't see it). Once a view listens for `'click'`, the drawing is one tab stop: the arrow keys walk its parts (Down
into a part, Up out, Left/Right between neighbours, Home or Escape back to the whole), each part is spoken through a
polite live region and ringed, and Enter or Space calls the click listener for the current part (`event` is then the
KeyboardEvent). `view.focusPart(node)` moves there from code.

Inline Math needs its stylesheet on the page (the fonts are optional):

```js
import '@mathzetta/inlinemath/inlinemath.css';     // with a bundler
import '@mathzetta/inlinemath/fonts/fonts.css';    // optional: Latin Modern, the TeX look
```

```html
<!-- or from the CDN -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mathzetta/inlinemath@0.2/inlinemath.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mathzetta/inlinemath@0.2/fonts/fonts.css">  <!-- optional -->
```

### Lite: drawing only

`@mathzetta/inlinemath/lite` is `toHTML()` and nothing live: the same layout, glyphs, colours, highlights and
spoken labels for screen readers, without the live view (`render`, step animation, events), Markdown
or the CAS — about a third smaller. `{{…}}` blocks are worked out only if MathZetta's calculator is
loaded too (`import 'mathzetta/calculate'`, or `@mathzetta/inlinemath/lite-calc`, which brings it); otherwise
they are drawn as written.

```js
import { toHTML } from '@mathzetta/inlinemath/lite';
el.innerHTML = toHTML('\\frac{d}{dx} x^2 = 2x', { colors: { '2x': 'crimson' } });
```

## Try it

```bash
npm test          # 253 checks; every input in mathzetta/test/cases/calculus.tsv
```

[inlinemath.com](https://inlinemath.com) has the live editor, steps and the gallery; its
[Markdown](https://inlinemath.com/markdown.html) and [CAS](https://inlinemath.com/cas.html) pages are playgrounds.

## Files

| File | What |
| --- | --- |
| `src/mathzetta.js`, `src/calculator.js` | The **only** imports from MathZetta (a peer dependency; in this repository, the workspace's `packages/mathzetta`): the core and speech, and the calculator, which lite leaves out. |
| `src/draw.js`, `src/html.js`, `src/lite.js` | `toHTML` without the calculator (shared), the full build's `toHTML` (with it), and the lite entry. |
| `src/layout.js` | Turns a tree into HTML. All notation choices live here. |
| `src/glyphs.js` | SVG paths for `( ) { } √ ∫ ∑ ∏`. Change a shape here. |
| `src/select.js` | Picks parts by id, expression, path or test. Also `numberTree`. |
| `src/view.js` | The live view: highlight, colour, events, speech segments, step animation. |
| `src/html.js` | `toHTML`, `treeOf`, and the `colors` / `highlight` options. |
| `inlinemath.css` | All the styling. The numbers marked *metric* must match the constants in layout.js. |

## How it lays maths out

- **Estimated, not measured.** Each piece knows roughly how far it reaches above and below the baseline, in em.
  - From that, `layout.js` writes `vertical-align` values that put fraction bars on the maths axis, lift exponents above tall bases, and size `∫` to its integrand.
  - The same string comes out in Node, in a browser or in a video frame, with no layout pass after rendering.
- **Self-stretching delimiters.** Brackets, bars, floors and braces are drawn at `height: 100%` of what they enclose (SVG or CSS borders), so they need no estimate at all.
  - This is the best idea from inline-math's imcss renderer. Inline Math fixes its aspect-ratio bug: shapes use `preserveAspectRatio="none"` with a fixed width.
- **Stable ids.** Every node's element has `data-node` = MathZetta's postfix index. MathML ids and `toSpeechSegments()` ids use the same number, so a spoken phrase can light up the part it describes.
  - Decoration (signs, brackets, bars) has no id. A click on it belongs to the node that drew it.

## Options

These go to `toHTML(input, options)` and `render(el, input, options)`.

| Option | Default | |
| --- | --- | --- |
| `display` | `true` | Limits above and below `∑`. `false` gives running-text style (smaller fractions, limits as scripts). |
| `fnParens` | `'auto'` | `sin x`, `sin 2x`, `ln|x|`, but `sin(x + 1)`. `'always'` gives `sin(x)`. |
| `trigPowers` | `true` | `sin(x)^2` → sin²x |
| `inverseTrig` | `'arc'` | `'power'` gives sin⁻¹x |
| `derivativeBrackets` | `'['` | `'('` for d/dx (x² + 1) |
| `scriptFractions` | `'slash'` | x^{3/2} written with a slash. `'stack'` stacks it. |
| `cases` | `true` | `c ? a : b` drawn as a piecewise brace |
| | | A product typed with `·` (`\cdot`) or `×` (`\times`) is drawn with that sign (MathZetta's `node.written`); other products get a sign only where one is needed. Postfix input has no such marks. |
| `colors` | | `{ 'x^2': 'red', 5: 'blue' }` (number keys are ids) or `[[target, colour]]` |
| `highlight` | | target(s) that get the `mv-hl` class |
| `attributes`, `style` | | `(node) => ({…})` / `(node) => 'css'` for each node's element |
| `mathml` | | MathZetta's `toMathML` (`import { toMathML } from 'mathzetta/mathml'`): also write the expression as visually hidden MathML (no ids), which screen readers can step through part by part and show in math braille; the drawing stays hidden from them and the label is dropped (MathML carries the meaning). A keyboard-enabled view keeps its label on the focusable element |
| `label` | `true` | the accessible name of the expression (`role="math" aria-label`): `true` = its spoken form for a listener who can't see it (MathZetta's `toAudioSpeech`: "the square root of the quantity x plus 1, end root, plus 2"), or a string, `(tree) => string`, or `false` |
| `prefix` | `'mv'` | class prefix |

A *target* can be any of these:
- an id, e.g. `4`;
- an expression, e.g. `'x^2'`, which matches every part that is exactly that subtree;
- `{ path: [0, 1] }`;
- a function `(node) => bool`;
- an array of any of the above.

## A static build: `npm run build`

```bash
npm install          # at the repository root: links mathzetta and MathZetta CAS, installs rollup
npm run build        # dist/ (a few seconds)
```

- **`dist/`** — Inline Math with everything inside, no import map or `node_modules` needed:
  - `inlinemath.js`, `markdown.js`, `cas.js` — ES modules (shared code in `dist/chunks/`);
  - `inlinemath.global.min.js` (183 KB, 62 KB gzipped) — a classic `<script>`: `window.InlineMath`, with Inline Math and the Markdown;
  - `inlinemath-cas.global.min.js` (323 KB, 104 KB gzipped) — the same plus the CAS (`InlineMath.mathCAS`, `casBlocks`, `stepsHTML`);
  - `inlinemath.css` and `fonts/` — put both on the page.

```html
<!-- dist/ copied beside the page as inlinemath/ -->
<link rel="stylesheet" href="inlinemath/fonts/fonts.css">
<link rel="stylesheet" href="inlinemath/inlinemath.css">
<script src="inlinemath/inlinemath.global.min.js"></script>
<script>
  el.innerHTML = InlineMath.markdownToHTML('The area is $\\pi r^2$; for $r = 3$ it is ${{pi r^2}}$.');
</script>
<!-- or as a module from the same copy: import { toHTML } from './inlinemath/inlinemath.js'; -->
```

Both folders are build output (git-ignored); run the build again after changing `src/`.

## From a CDN

Every npm release's `dist/` is on jsDelivr (and unpkg); the bundles carry MathZetta inside, so a
page needs nothing else:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mathzetta/inlinemath@0.2/dist/fonts/fonts.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mathzetta/inlinemath@0.2/dist/inlinemath.css">

<!-- a script tag: window.InlineMath -->
<script src="https://cdn.jsdelivr.net/npm/@mathzetta/inlinemath@0.2/dist/inlinemath.global.min.js"></script>
<script>document.getElementById('out').innerHTML = InlineMath.toHTML('\\frac{d}{dx} x^2');</script>

<!-- or modules: inlinemath.js, markdown.js, cas.js (the CAS one holds MathZetta CAS too) -->
<script type="module">
  import { toHTML } from 'https://cdn.jsdelivr.net/npm/@mathzetta/inlinemath@0.2/dist/inlinemath.js';
  import { markdownToHTML } from 'https://cdn.jsdelivr.net/npm/@mathzetta/inlinemath@0.2/dist/markdown.js';
</script>
```

`@0.2` follows the latest 0.2.x; `@0.2.0` pins a release.

**The stylesheet is required** — the drawing is HTML laid out by `inlinemath.css` (10.4 KB, 3.2 KB
gzipped): without it fractions, radicals and brackets don't line up. The classic builds
(`*.global.min.js`) carry it and add it to the page themselves (`<style id="inlinemath-css">`; a
`<link>` to `dist/inlinemath.css` is still fine, it is only added when absent); the ES modules
don't, so a page using them links `dist/inlinemath.css`. **The fonts are optional**: `fonts/fonts.css`
declares Latin Modern Roman (the TeX look) in two files, regular 45 KB and italic 47 KB (woff2), and
its Greek letters, which Latin Modern lacks, from New Computer Modern in the same design (10 KB each,
`fonts/README-inlinemath-greek.txt`). Each file is downloaded only when text uses it, so a page without
Greek never fetches those two; without the link the maths is drawn in the system serif.

Every build comes **with MathZetta inside, or without it** (`*.external.*`), with or without the
CAS (MathZetta CAS). Sizes, gzipped:

| | ES module | classic `<script>` (`window.InlineMath`) |
|---|---|---|
| Lite (drawing only), MathZetta inside | `lite.js` 35 KB | `inlinemath-lite.global.min.js` 38 KB |
| Lite with the calculator (`{{…}}` worked out) | `lite-calc.js` 48 KB | `inlinemath-lite-calc.global.min.js` 52 KB |
| Lite without MathZetta | `lite.external.js` 8 KB | `inlinemath-lite.external.global.min.js` 11 KB |
| Inline Math (+ Markdown in the classic build), MathZetta inside | `inlinemath.js` 51 KB, `markdown.js` 55 KB | `inlinemath.global.min.js` 62 KB |
| …without MathZetta | `inlinemath.external.js` **12 KB**, `markdown.external.js` 15 KB | `inlinemath.external.global.min.js` 21 KB |
| with the CAS, MathZetta inside | `cas.js` 90 KB | `inlinemath-cas.global.min.js` 104 KB |
| with the CAS, without MathZetta | `cas.external.js` 50 KB | `inlinemath-cas.external.global.min.js` 63 KB |

Without MathZetta, the page loads it once itself: a classic page puts a MathZetta `<script>` first —
`mathzetta.min.js`, or the `maths-display` flavour, since speech, text and calculate are used (for
lite, `display`, or `maths-display` to work out `{{…}}`) — and
the external classic build reads `window.MathZetta`; a module page maps the names with an import
map (every name can point at the one MathZetta bundle). The fonts are 94 KB more (and 20 KB for Greek, only where it appears), only if linked.

```html
<script type="importmap">
{ "imports": { "mathzetta":           "https://cdn.jsdelivr.net/npm/mathzetta@1/build/mathzetta.esm.min.js",
               "mathzetta/speech":    "https://cdn.jsdelivr.net/npm/mathzetta@1/build/mathzetta.esm.min.js",
               "mathzetta/calculate": "https://cdn.jsdelivr.net/npm/mathzetta@1/build/mathzetta.esm.min.js" } }
</script>
<script type="module">
  import { toHTML } from 'https://cdn.jsdelivr.net/npm/@mathzetta/inlinemath@0.2/dist/inlinemath.external.js';
</script>
```

Publishing is `npm publish` (`prepublishOnly` runs the tests and the build).

## Markdown with maths: `@mathzetta/inlinemath/markdown`

```js
import { markdownToHTML } from '@mathzetta/inlinemath/markdown';
el.innerHTML = markdownToHTML(text);                          // needs inlinemath.css
el.innerHTML = markdownToHTML(text, { blocks: casBlocks() }); // {{solve(…)}}, {{diff(…)}} too
```

- **Maths:** `$…$` inline, `$$…$$` or a ` ```math ` fence on its own (centred), and
  `\(…\)` / `\[…\]`. MathZetta reads it, so LaTeX, plain text (`$sqrt(x)/2$`) and
  code all work.
- **Working out:** `{{…}}` inside maths is worked out (the calculator, or the CAS with
  `blocks`). A definition like `$r = 3$` is remembered, exactly, for the `{{…}}` after it
  (`define: false` turns that off; `scope: { r: 3 }` gives values).
- **Saved variables:** `$A := 2+2$` saves A (drawn A ≔ 2 + 2), and `$_A := 2+2$` saves it
  without drawing anything. After that, A in any maths is drawn as its expression and `{{A}}`
  is its value, so `$A = {{A}}$` draws 2 + 2 = 4 and `$3A$` draws 3(2 + 2). A name is a letter
  (Greek too), optionally with a subscript (`A_1`); a variable may use the ones before it
  (`$_B := 2A$`), and saving it again replaces it from there on. A plain `$r = 3$` still only
  remembers the number: r keeps being drawn as r.
- **Matrices:** `\begin{pmatrix}…`, `bmatrix`, `vmatrix` (and `[[1, 2], [3, 4]]`) are drawn as
  a grid in brackets as tall as it, and worked out exactly: `{{A^2}}`, `{{A^{-1}}}`, `{{A^T}}`,
  `{{det(A)}}`, `{{A [5, 6]}}`, `{{linsolve(A, b)}}`. A saved variable can hold one:
  `$_M := [[2, 1], [1, 3]]$` then `$M^2 = {{M^2}}$`.
- **With the CAS:** `{ blocks: casBlocks() }` works out `{{der(x^2, x)}}` (also `diff`,
  `derivative`, `d/dx …`), `{{integral(x^2, x)}}`, `{{solve(…, x)}}`, `{{factor(…)}}` …, and a
  saved variable stands for its expression there: after `$_f := x^3 + 2x$`, `{{der(f, x)}}` is
  3x² + 2.
- **Inputs:** `$A := [[2+2]]$` is a textbox that sets A, `$f := [[x^2 | sin(x) | 2x]]$` a
  dropdown, `$n := [[1..10]]$` a slider (`[[0..1 step 0.05 = 0.5]]`: a step and a starting
  value); with `$_…$` only the input is shown. `renderMarkdownInto(el, text)` makes them live:
  every part of the page drawn with it shares the page's store (`variables`), so a variable
  saved in one part is used in the others, and changing an input redraws everything that uses
  it. `variables.set('A', 'x^2')` sets one from code, `variables.get('A')` reads it;
  `{ variables: createVariables() }` gives a part a store of its own, `{ variables: false }` none.
  `markdownToHTML` is static: inputs drawn at their starting values.
- **Editing by double-click:** in `renderMarkdownInto`, a part drawn from a textbox variable is
  edited where it is drawn with `{ editable: { toText } }` (the whole variable is written back
  into its textbox, so everything using it redraws); without `toText` the textbox is focused.
  Double-clicking any other part fires `inlinemath:select` on the element with where that maths
  is in the Markdown (`detail.start`, `detail.end`, `detail.raw`; for a part drawn from a
  variable saved in the same text, where it was saved), so an editor beside it can select it.
  `extractMath` gives every piece's `start` and `end` too.
- **Dollars:** a `$` is maths only when it looks like it (Pandoc's rule): "$5 and $10"
  stays text, and `\$` is a dollar sign. Code spans and fences are left alone.
- **Bad maths:** maths that doesn't read is shown as written, marked, with the reason as
  its tooltip.
- **The Markdown:** a small built-in renderer — headings, emphasis, links, images, lists,
  quotes, code, tables, rules. Raw HTML is shown as text unless `html: true`, and
  `javascript:` links are dropped. `render: (md) => html` uses another renderer
  (marked, markdown-it); the maths is taken out first and put back into its output.
- **Options:** `math` passes options to every drawing (`fnParens`, `colors` …);
  `delimiters` picks which marks count.
- **Playground:** [inlinemath.com/markdown.html](https://inlinemath.com/markdown.html), an editor with a live preview.

## The CAS: `@mathzetta/inlinemath/cas`

MathZetta CAS (exact simplify, factor, solve, d/dx, ∫ …; @mathzetta/cas's docs/cas.md)
in drawn maths:

```js
import { toHTML } from '@mathzetta/inlinemath';
import { casBlocks, stepsHTML, mathCAS } from '@mathzetta/inlinemath/cas';

toHTML("f'(x) = {{diff(x^3 sin(x), x)}}", { blocks: casBlocks() })
toHTML('{{solve(x^2 - 5x + 6 = 0, x)}}', { blocks: casBlocks() })    // x = 2 or x = 3
el.innerHTML = stepsHTML(mathCAS().solve('sqrt(x + 1) = x - 1', 'x', { steps: 'brief' }).steps)
```

Block functions: `simplify`, `expand`, `factor`, `cancel`, `diff(f, x[, n])`,
`integrate(f, x[, a, b])`, `solve(eq, x)`, `approx(x[, digits])`; `d/dx …` and
`∫ … dx` go to the CAS too; every other block is the calculator, as before.
`stepsHTML` draws each step with the rewritten part highlighted and its
explanation. `mathCAS({ rules, names })` uses rule files of your own;
`mathCAS({ complex: true })` makes i the imaginary unit (and reads Re, Im, conj,
arg; the conjugate is drawn with an overline). Pages map
`@mathzetta/cas/engine` and `@mathzetta/cas` in their import map ([inlinemath.com/cas.html](https://inlinemath.com/cas.html) is a
playground: any input, any operation, detail level, and a live rule editor).

## What still needs doing

**Notation MathZetta doesn't read yet** (Inline Math can only draw what parses):
- **Evaluation bars:** `[F(x)]_0^1` reads as a power of a subscript, and `\left. F \right|_0^1` is rejected.
- **Partial derivatives:** `\partial f / \partial x` becomes products.
- **Derivative orders:** `f^{(4)}` becomes a power.
- **Lists of answers:** `x = 2, x = -3` is rejected.
- **Accents:** `\dot x` becomes a product.

**Inline Math features worth adding next:**
1. **Exit animation.** Parts that disappear in a step should fade out where they were (ghost copies). Today they vanish, and new signs and bars just appear.
2. **Step-diff helper.** Given `step.before`, `step.after` and `step.path`, return what changed, then highlight → animate → un-highlight in one call. That would be the video's main move.
3. **Narration sync.** Something like `view.follow(segments, timings)`: drive highlights from a text-to-speech engine's word timings (`words: [{start, end, i, j}]`).
4. **Copy as LaTeX or text** from a selection.
5. **Line breaking and alignment.** Multi-line derivations with the `=` signs lined up (an `align` helper), and breaking long sums.
6. **A DOM refine pass, optional.** Measure once after fonts load, to nudge fraction bars and script heights where the em estimates are off with unusual fonts.
7. **Spacing table.** Move the per-operator spacing (bin, rel, thin) into one table so a house style is one edit.

## Known rough edges

- **Fonts.** The placement estimates are tuned for Latin Modern and Times-like serifs. Fonts with unusual ascent and descent will sit a little off.
- **Accents.** `\vec`, `\hat`, `\tilde`, `\dot` and the overline are placed for Latin Modern: lower over a letter with no ascender (x, u, α), and leaning right over an italic letter. Other fonts can leave them a little high or low.
- **Unbalanced fractions.** Taller-than-usual numerators on fractions are placed from estimates. Very deep nesting can drift by a few hundredths of an em.
