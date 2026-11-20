# How MathZetta works

```
"2x^2 + \sin x"
      │  clean          src/parse/clean/      spellings → one compact form
      ▼
"2x^{2}+sinx"
      │  tokenize       src/parse/tokenize.js
      ▼
2x  ^  {  2  }  +  sin  x
      │  parse          src/parse/parser.js
      ▼
2 x * 2 ^ … (raw postfix: commas and bracket groups still in it)
      │  build          src/parse/build.js    argument lists, defaults, arity checks
      ▼
tree  ⇄  standard postfix                     src/tree.js, docs/postfix.md
      │  render         src/render/
      ▼
LaTeX · MathML · speech · JavaScript · Python · GLSL · SQL · Excel · text
```

`parseSteps(text)` returns the output of every stage, including the text
after each cleaning phase. Start there when an input parses wrongly.

## 1. Cleaning (`src/parse/clean/`)

People write the same thing many ways: `\sin`, `sin`, `Math.sin`; `<=`,
`\le`, `≤`; `\frac{a}{b}`, `a/b`. The cleaner rewrites them all into one
spelling, in phases (`clean/index.js`):

1. **strings** — quoted text is swapped for placeholders so nothing inside
   it is rewritten (`strings.js`). Then `{{…}}` blocks are calculated and
   replaced by their value, using `calculateBlock()` in `calculate.js` — no
   code is run. Answers stay exact where they can (`{{1/3+1/6}}` → `1/2`,
   `{{sqrt(8)}}` → `2√2`, `{{sin(pi/3)}}` → `√3/2`); `{{~ pi}}` asks for a
   decimal and `{{~3 pi}}` for three places. A block with no answer
   (`{{1/0}}`) becomes the string "undefined"; one that can't be worked out
   (`{{x+1}}` with no value for x) is left as written. `parse(text, { scope })`
   supplies variable values. In LaTeX a block can sit right inside an argument:
   where one is expected (after `\frac`, `\sqrt`, `^`, `_`, or the `}` or `]`
   ending an earlier one) the first of three braces is the argument's, so
   `\frac{{{2+2}}}{4}` is `\frac{ {{2+2}} }{4}`; a block that is the whole
   argument by itself is braced (`\frac{{2+2}}{4}` → `\frac{4}{4}`); and `\{`
   is an escaped brace (`\{{{1+1}}, 3\}` is the set {2, 3}). Without LaTeX,
   `{{{1,2}}}` is still a block holding the set {1, 2}. LaTeX that uses `\text{}` for words, not names,
   is rewritten before names are protected: `\begin{cases} a & \text{if } p
   \\ b & \text{otherwise} \end{cases}` → `((p) ? (a) : (b))`; and a
   function MathZetta knows stays one: `\text{round}(x, 2)`, `\operatorname{sin} x`.
2. **code** — programming spellings (`code.js`), so every code format
   MathZetta writes reads back: `np.where(c, a, b)`, `a if c else b`,
   `np.logical_and`, `np.isin(x, [1, 2])`, `[1, 2].includes(x)`,
   `Number.isInteger(x)`, `float(x).is_integer()`, `math.factorial(n)`,
   `sum(f for i in range(1, n + 1))`, `scipy.integrate.quad(lambda x: f, a, b)[0]`,
   `CASE WHEN … THEN … ELSE … END`, `POWER`/`GREATEST`/`LOG(b, x)`/`PI()`,
   `x IN (1, 2)`, `<>`, `CAST(… AS REAL)`, GLSL's `mz_sq` and `fract`,
   JavaScript's inline helpers (`js-helpers.js`, shared with the writer),
   `1e-9`, `True`, and `%` before a bracket or call. Calls are rewritten
   innermost first with bracket matching. `test/unit/roundtrip.test.js`
   writes every test input in each code format and parses it back.
3. **words** — `WORD_REPLACEMENTS` in `replacements.js`, while spaces still
   mark word boundaries: ` And ` → `&`, ` choose ` → `\comb`.
4. **spaced** — structural rewrites that need the spaces (`latex.js`):
   `if c then a else b` → `(c) ? (a) : (b)` (innermost first, so chains
   and nesting work; no `else` means `unchanged`), the argument of
   `\lim x→0 f`, `\text{…}`, log bases, `a ? b : c`, numeric exponents
   `x^-12` → `x^{-12}`.
5. **squeeze** — whitespace goes, except one space between two letters,
   which keeps words apart: `cos t` is cos(t), `cost` is a word.
6. **symbols** — `SYMBOL_REPLACEMENTS` plus generated trig spellings:
   `\cdot` → `*`, `>=` → `≥`, `Math.PI` → `π`, `\sin` → `sin`,
   `sin^{-1}` → `arcsin`.
7. **compact** — structural rewrites on the squeezed text (`latex.js`):
   Leibniz notation (`\frac{d}{dx} f`, `d/dx f`, `dy/dx`, `\frac{d^2y}{dx^2}`)
   → `der(…)`, `\int_a^b f dx` → `int(f,x,a,b)`, `(fg)′`, `\sqrt[n]{x}`,
   `⌊x⌋`, matrices. Before strings are lifted out, an apostrophe after a
   letter or bracket becomes a prime ′, so `f'(x)` and `y''` survive.

Replacement tables match the longest key at each position and never
cascade (`trie.js`). Entries are case-insensitive unless marked: `Max`
also covers `max` and `MAX`.

## 2. Tokenizing (`src/parse/tokenize.js`)

Brackets and `_` are single tokens; words in the parser's vocabulary
(`src/parse/vocabulary.js`) are cut out greedily (`sin` inside `3sin`);
everything else gathers into operand tokens. A word right before `(`
is a function call — unknown names become custom functions `\:name`.

## 3. Parsing (`src/parse/parser.js`)

A precedence-climbing (Pratt) parser. Each operator has a binding power —
its precedence in `vocabulary.js` — and an expression keeps absorbing
operators that bind more tightly than the context it started in. Before
parsing, operand tokens are split: `4x` → 4 x, `10%3` → 10 mod 3.

**Words or variables?** The tokenizer gathers each run of letters and
`words.js` decides what it is, most certain first:

1. Names the caller declares (`parse(text, { names: ['cost'] })`) and names
   the author marked (`\text{rate}`, `\mathrm{rate}`, `\operatorname{sgn}`)
   are protected before cleaning and always stay whole.
2. Words that are always one thing: function names, constants, Greek
   letters, `true`/`false`, and a short word list of ordinary words that
   contain a function name (cost, sine, point, order, tank, …).
3. LaTeX input (anything with a `\command`) follows TeX: letters side by
   side are a product, so `\frac{rate}{time}` is r·a·t·e / t·i·m·e.
4. Plain input: runs of one or two letters split (`xy`, `dx`); longer runs
   stay whole (`speed`, `msg`, `basin`, `topic`) with two exceptions: a
   function name with at most one letter before it and two after
   (`sinx`, `xsinx`, `sint`), provided something follows for it to apply
   to; and π in a three-letter word (`pir`). A space between letters
   always separates words: `cos t`, `x y`. Digits after a variable stay
   part of its name: `x1`, `v0`. When in doubt, declare the name.

The rules that make it read the way a person does:

- **Implicit multiplication.** Side by side means times: `2x`,
  `(x+1)(x-2)`, `x sin x`, `|a||b|`. It binds like `*` and `/`, so `1/2x`
  is (1/2)·x and `2x/3` is (2x)/3.
- **Calls and bare functions.** `sin(x)` takes only its brackets:
  `sin(x)^2` = (sin x)², `sin(x)cos(x)` is a product. Without brackets a
  function takes the product after it, stopping at the next function or a
  `+ - * /`: `sin 2x` = sin(2x), `sin x^2` = sin(x²), `sin x cos x` =
  sin x · cos x, `sin x/x` = (sin x)/x. `sin^2 x` squares the result.
- **Function or product?** `f g h u v F G H` followed by `(` are functions,
  as is any letter applied to one other letter or a number: `x(t)`,
  `a(t)`, `y(0)`. With more inside the brackets it is a product: `x(x+1)`,
  `x(2t)`, `a(b+c)` — and so are `x(x)` and `e(…)`. Words of three or more
  letters are custom functions: `myFunction(x)`.
- **mod.** Written as a word (`mod`, `\bmod`) it follows math: it takes
  everything to its left, back to an `=` or comparison, and one factor on
  its right — `2 + 3 mod 4` is (2+3) mod 4, `c = m^e mod n`, `a mod 2n` is
  a mod (2n), `(2 mod 3)·4`. The symbol `%` follows programming and binds
  like `*`: `2 + 3 % 4` is 2 + (3 mod 4). A congruence `a ≡ b (mod n)` or
  `\pmod{n}` applies to the whole statement: `a b ≡ n pmod`. Renderers add
  brackets wherever the two readings could differ.
- **Limits, sums, products** read their subscript, then the term after
  them up to the next `+` or `-`: `lim_{x→2} (x²-4)/(x-2)`.
- **Signs.** `-x^2` = -(x²); a minus on a number folds into it (`-5`).
- **Bars.** `|` opens an absolute value where an operand is expected and
  closes one where an operator is expected; outside one it means "or"
  unless an even number of bars remain (`|a||b|`). `\lor` and `∨` are
  always "or".
- `!` is a factorial after an operand and logical not before one.

Commas stay in the output as binary "list" operators, and a bracket pair
that held commas emits a group token, so `max(1,2,3)` is
`1 2 , 3 , () max` at this point; empty brackets emit `∅ ()`, so `f()`
becomes a call with no arguments.

**Errors.** `parse()` throws on malformed input, with the message naming
the problem: `Unmatched ')'`, `'sin' needs 1 operand`, `Empty expression`,
`'max' needs at least one argument`, `A list of values needs brackets
around it`. `parseSteps()` returns the same message in `error` without
throwing, together with every stage that completed. An unclosed bracket is
tolerated and closes at the end of the input.

## 4. Building the tree (`src/parse/build.js`)

The raw postfix becomes a tree. Comma lists are gathered; a function
applied directly to a group takes the group's items as arguments, and a
group anywhere else is a value (a tuple, list, set or interval). Then each
operator is put in standard form (`normalize()`): `pow(a,b)` → `^`,
`sqrt(n,x)` → `root`, `round(x)` → `round(x, 0)`, `der(f)` → `der(f, x)`,
`log_e` → `ln`, `IF(c, a)` → `?:` with `unchanged` as the third argument, and
the argument count is checked against the operator table.

## 5. The tree and postfix (`src/tree.js`)

Four node types: `number`, `symbol`, `string`, and `op` with `args`.
`fromPostfix` reads standard postfix and numbers each node by its token
index (`id`); `toPostfix` writes it back.

**How a product was written.** The postfix has one multiplication, `*`, but
`a \cdot b` and `a \times b` can mean different things (a dot or a cross
product), so the parser remembers them beside the postfix. The cleaner writes
`\cdot` `·` `⋅` and `\times` `×` as two private-use characters
(`DOT_TIMES`, `CROSS_TIMES` in vocabulary.js) that the tokenizer and parser
treat exactly like `*`; `buildTree` makes each one a `*` node with
`written: 'dot'` or `'cross'`, and `toPostfix(tree, written)` collects them by
postfix index. `parseSteps()` returns that map as `written` (`{ 2: 'cross' }`
for `a × b`) and puts `written` on the tree's nodes, so `parseTree()` has it
too. `parse()` still returns plain postfix, and the stages `parseSteps` shows
(cleaned text, tokens, raw postfix) show `*`. The math displays use it:
LaTeX writes `\cdot` or `\times`, MathML `⋅` or `×`, text `·` or `×` (so it
reads back marked), Inline Math draws the sign, and speech says "dot" or
"cross" between vectors (`\vec`, `\hat`; the `words` option renames them) and
"times" for any other typed sign. The code outputs, `evaluate`, `calculate` and
every postfix consumer see an ordinary product; postfix input carries no marks.
Products written as words (`times`), with `*` or side by side carry nothing.

## 6. Rendering (`src/render/`)

One file per format, each a small recursive function over the tree:
`latex.js`, `mathml.js`, `speech.js`, `code.js` (JavaScript and
Python: math, numpy and SymPy are three language tables there, each a few
fields and an `ops` table of overrides), `glsl.js`, `sql.js`, `text.js`. Each has a thin public entry in
`src/` (`src/latex.js` exports `toLaTeX`, and so on) that accepts text,
postfix or a tree; `package.json` maps them to `mathzetta/latex`, …, so a
page or bundle takes only the formats it uses. Shared decisions live in
`src/common.js`, exported from the core so Inline Math brackets the same way:

- **brackets** — `needsBrackets(parent, child, side)` from precedence and
  associativity in the operator table; groups are never bracketed again.
- **implicit products** — `2x`, `3\sin x`, `αβ`, but `2 \cdot 3^x` and
  `2 \cdot -3`.

### Pointing at parts of an expression

Every renderer that produces markup labels each node with its postfix
index, so the same number means the same part everywhere:

- MathML: `id="mz-4"` on the node's element.
- Inline Math (`packages/inlinemath`, the HTML drawing): `data-node="4"` on the node's element.
- LaTeX: `toLaTeX(input, { wrap: (node, tex) => … })` lets you tag each
  node, e.g. with KaTeX's `\htmlId{mz-4}{…}`.
- Speech: `toSpeechSegments()` returns `[{ text, id }]`.

`toUnified()` fills `getMathMLIdMap()`, `mz-4` → every format of that
subexpression; entries are computed on first use, so the map costs nothing
until a page looks something up.

### Speech (`speech.js`)

`toSpeech()` reads the expression as a teacher would: "the quantity x
plus 1, squared", "sine of x, over x", "the integral from 0 to 1 of x
squared, d x", "f prime of x". Commas are pauses for a text-to-speech
voice and mark where a group ends. The choices that matter:

- **Grouping.** A sum or comparison inside something else is fenced with
  "the quantity … ,": a product, a power's base, a function's argument.
  Roots and absolute values skip it (their extent is clear) and get a pause
  after a compound argument instead: "the square root of x squared plus 1,
  plus 2".
- **Powers.** "squared", "cubed", "to the fourth"; `e^{2x}` "e to the 2 x";
  a compound exponent is "to the power of n minus 1,". `sin^2 x` is "sine
  squared of x".
- **Fractions.** "one half", "three quarters", "five eighths" for small
  numbers; otherwise "x over 2", "the quantity x plus 1, over the quantity
  x minus 1".
- **Products.** "2 x", "2 pi r", "x squared sine of x" are juxtaposed;
  "times" appears where that would mislead: "x times 2", "rate times
  time", "2 times the square root of x".
- **Calculus.** "d y d x", "d squared y d x squared", "the derivative with
  respect to x of …", "the limit as x approaches 0 from the right of …",
  "the sum from i equals 1 to n of …".

To change how something is said, pass options — from the smallest change
to the largest:

```js
toSpeech(x, { words: { negative: 'minus', sub: '' } })   // "minus 3", "x 1"
toSpeech(x, { names: { ln: 'log', arcsin: 'arc sine' } })
toSpeech(x, { say: { sqrt: ([a]) => `root ${a}` } })     // a whole phrase
```

**Without the drawing: `toAudioSpeech()`.** Everything above assumes the
listener can see the math — a pause is enough to end "the square root of x
plus 1," because the radical shows where it ends. A screen reader or an
audio-only lesson has no picture, and a pause is easy to miss, so
`toAudioSpeech()` puts the grouping in the words. It is the same speaker with
two more rules:

- anything compound inside a radical, exponent, subscript, absolute value,
  floor, ceiling, denominator, factor, function argument, limit, sum or
  derivative opens with "the quantity" (as a fraction's parts already do), and
- closes with an end word — "end root", "end exponent", "end sub", "end
  absolute value", "end fraction", "end quantity", … (in SPEECH_WORDS, so they
  can be changed) — which is dropped when nothing follows.

```
√(x+1)        toSpeech: the square root of x plus 1           toAudioSpeech: the square root of the quantity x plus 1
√x + 1        toSpeech: the square root of x plus 1           toAudioSpeech: the square root of x plus 1
√(x+1) + 2    toSpeech: the square root of x plus 1, plus 2   toAudioSpeech: … of the quantity x plus 1, end root, plus 2
x^(n+1) + 2   toSpeech: x to the power of n plus 1, plus 2    toAudioSpeech: … of the quantity n plus 1, end exponent, plus 2
```

Inline Math's `aria-label` uses `toAudioSpeech()`; its live view's
`segments()` (narration that lights up the part being read) stays on
`toSpeech()`. test/cases/speech.tsv has both columns, and
test/unit/render.test.js checks that every pair the eye tells apart reads
differently by ear.

`SPEECH_WORDS` and `SPEECH_NAMES` are the defaults, exported so you can
see every key. A `say` entry gets the operands already spoken, the node,
and a `speak(node)` helper, and returns the phrase; keys are operator
tokens (`'^'`, `'sqrt'`, `'\\:f'`) or node types (`'number'`, `'symbol'`).
`test/cases/speech.tsv` has 79 expressions with their spoken form.

### GLSL (`glsl.js`)

(The shareable filter format and WebGL runner that use this moved to the
`qblur` package on 2026-10-16; its docs/filters.md is the guide.)

`toGLSL()` writes a shader expression for image filters and procedural
textures: `(r - 0.5)^2 * 4` → `mz_sq(r - 0.5) * 4.0`. GLSL is typed, so
the output differs from the JavaScript in a few deliberate ways:

- Every number is a float literal, so `1/2` isn't integer division and
  `pow(x, 2)` type-checks. Variables are assumed to be floats or vectors.
- `x^2` is `mz_sq(x)`, `x^3` `mz_cube(x)`, `x^-1` `1.0 / x`: GLSL's
  `pow()` is undefined for a negative base, which `(r - 0.5)^2` hits all
  the time. `e^x` is `exp(x)`, `2^x` `exp2(x)`, `x^{1/2}` `sqrt(x)`.
- `GLSL_HELPERS` is a string of `mz_*` functions to paste above `main()`:
  what GLSL ES 1.0 (WebGL 1) lacks — `round`, `sinh`, `asinh`, cube
  roots, factorial, gcd, infinity — with vec2/vec3/vec4 overloads so an
  expression over a color works. `{ version: 300 }` uses the native
  functions where GLSL ES 3.0 has them.
- `30°` is `radians(30.0)`; `mod` is GLSL's `mod()`; `(r, g, b)` is
  `vec3(r, g, b)`; `±x` is `vec2(x, -x)`; `x ∈ ℤ` is `fract(x) == 0.0`.
- Logic and comparisons need bool operands, as GLSL has no implicit
  conversion: `a & b` compiles only if `a` and `b` are bools, and `2 < x < 7`
  doesn't compile at all. Symbolic operators (der, int, lim, ∪) become
  calls to functions you supply, as in the JavaScript output; strings and
  nested lists have no GLSL form.

Shareable filters (a JSON format of math, parameters and chains, and the WebGL runner) are
[qblur](https://qblur.com), built on this.

`filterShader(spec)` wraps all this into a complete fragment shader for
an image: it defines `r g b a rgb gray x y px py w h t`, `pixel(px, py)`
and friends, protects those names from being read as products (`px` is
not `p * x`), and accepts a whole-colour expression or one per channel,
with `unchanged` as the fallback of an `if` without `else`. `t` is a
uniform for the frame index.

`test/cases/glsl.tsv` has filter-style expressions and their output, and
every parsable expression in the test tables (851 of them) has been
compiled as a fragment shader with WebGL in headless Chrome; the ones that
fail are the typing cases above.

## Performance

Parsing is linear in practice: a 2,000-term sum parses in about 15 ms and
2,000 nested brackets in 2 ms (Node 22, Apple silicon). Rendering is
linear too. The parser and renderers are recursive, so an expression nested
tens of thousands deep would overflow the stack; nothing a person types
comes close. `evaluate()` caps factorials at 170! (beyond which a double is
infinite anyway). `calculate()`, which `{{…}}` blocks use, keeps whole
numbers exact up to about 60,000 digits, computes n! exactly to 20000!, adds
at most 100,000 terms one by one and gives up beyond those, so `{{10^9!}}`
in an input can't stall the cleaner either.

## Recipes

**Accept a new spelling** (`\dfrac` for `\frac`, `×` for `*`): add a
`[from, to]` pair to `SYMBOL_REPLACEMENTS` in `replacements.js` — or to
`WORD_REPLACEMENTS` if it needs spaces around it.

**Accept a new code spelling** (a library's function, a dialect's
keyword): `prefixes()` or `CALLS` in `clean/code.js`, and a row in the
"code people type" suite of `test/unit/roundtrip.test.js`. When a renderer
starts writing something new, the round-trip test fails until the parser
reads it.

**Accept a new LaTeX construct** that needs bracket matching: add a
rewrite to `compactRewrites()` in `clean/latex.js` that turns it into
function-call syntax.

**Add an operator:**
1. `src/operators.js` — its precedence, associativity, arity and fixity.
2. `src/parse/vocabulary.js` — if users can type its name.
3. Each renderer in `src/render/` — the operator test in
   `test/unit/operators.test.js` fails until every format handles it.
4. `src/evaluate.js` — if it has a numeric value.
5. Rows in a `test/cases/*.tsv` file.

**Add a test:** a row in any `test/cases/*.tsv` (columns are described in
`test/checks.js`), or a check in `test/unit/`, then `npm test`. `npm run coverage` lists what the
tables don't cover yet. The same checks run in a browser on
[mathzetta.com's test runner](https://mathzetta.com/demos/test-runner.html).

## Known gaps

`test/cases/calculus.tsv` lists the Calculus I notation that works. Not yet:

- Chained inequalities read left to right: `-2 < x < 2` is (−2 < x) < 2
  (it still displays correctly).
- A bare list of answers, `x = -1, 2`, needs brackets: `x ∈ {-1, 2}`.
- Set-builder notation `{x | x > 0}`, piecewise functions, and the
  "evaluated at" bar `\left.\frac{dy}{dx}\right|_{x=1}`.
- Primes and Leibniz derivatives are kept as notation: `f′(x)` is a
  function named f′, and `dy/dx` is `der(y, x)` — nothing computes them.
