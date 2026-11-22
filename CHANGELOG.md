# Changes

Each package keeps its own version: `mathzetta`, `@mathzetta/inlinemath`, `@mathzetta/cas`.

## mathzetta 1.4.0

Text search in formulas over table columns. Not published yet.

- **`"ab" in name`** (or `"ab" ∈ name`, `contains(name, "ab")`): is the text somewhere in the value?
  **`startswith(name, "ab")`**: does the value start with it? Both ignore the case of the letters A to Z, and
  only those, so JavaScript and SQLite give the same answer for every text; nothing in the text is a pattern
  (`%`, `_`, `*`, `?` are themselves); a number is read by its digits and a missing value is empty text. `∉` and
  `not` give the opposite. `=` and membership in a written set (`team in {"NYA", "BOS"}`) are exact, as before.
- Written by `strToFunction` / `toJavaScript` (two inline helpers, which `checkGeneratedJs` knows and the parser
  reads back), `strToSQL` / `toSQL` (`INSTR(LOWER(…), LOWER(…))` in SQLite, `STRPOS` in PostgreSQL, whose
  `LOWER` folds what its locale says), `toExcel` (`FIND` and `LEFT` over `LOWER`: no wildcards) and `toPython`
  (inline helpers, below). SymPy and GLSL refuse text, as before; the other outputs show them as written.
- **Membership in a column is a text search.** In the formula functions (`strToFunction`, `strToSQL`, `strToExcel`)
  a column holds one value, never a list, so `team in name` and `contains(name, team)` with both columns search the
  text, as `"ab" in name` does (it was `name.includes(team)`, case-sensitive, and `team IN (name)`, exact: the
  table's backends disagreed). A quoted text on the right (`team in "NYA BOS"`) is a text search everywhere, and
  `evaluate` searches a name whose value in the scope is a text. Outside the formula functions a name may be a
  list, so `toJavaScript('team in name')` still tests membership.
- **A root whose index is only known as it runs** (`root(n, x)`, n a column or a variable, or a negative odd number)
  is real for an odd index in every output, as `evaluate` takes it: `root(n, x)` with n = 3, x = −8 is −2 in
  JavaScript (the `root` helper checks the index), Python and numpy, SQL, spreadsheets and GLSL (a new `mz_root`
  helper, also used for constant odd indexes past 3, where `pow` is undefined below 0). It was `x^(1/n)`: NaN.
- No new operator and no change to the postfix: `"ab" name ∈` and `name "ab" 2 \:startswith` are what these
  inputs already parsed to (docs/postfix.md). `startswith` is no longer reported among a formula's unknown names.
- `evaluate` and `calculate` give the same answers as the code (`"ab" in "CAB"` is true, `startswith("Abc", "ab")`
  too; a list in the scope is still searched for a member); test/unit/agreement.test.js holds all of them to one answer.
- Python and numpy write two inline helpers (in `js-helpers.js`, beside JavaScript's) that fold A to Z only, as
  JavaScript and SQLite do, read `None` and NaN as empty text and a whole float by its digits (62.0 is "62");
  numpy's work element by element (`np.vectorize`), and a numpy function keeps a searched parameter as text.
  `checkGeneratedPython` (so `toPythonFunction`) knows them as exact text, as `checkGeneratedJs` knows JavaScript's;
  nothing inside them (`.lower`, `.join`, a lambda's default) is allowed anywhere else. The parser reads the
  JavaScript, Python and numpy helpers back (they hold no string literal: JavaScript's empty text is `String()`).
- SQL: a missing searched text (a NULL column in `startswith(name, prefix)`) is empty text too, so the answer is
  never NULL. A spreadsheet's `startswith` is bracketed, so it nests in a larger formula.
- **Behavior change:** `"ab" in name` used to compile to JavaScript's `name.includes("ab")` (which told the
  case of letters apart) and to SQL's `'ab' IN ("name")` (equality).

## mathzetta 1.3.0, @mathzetta/inlinemath 0.4.0, @mathzetta/cas 0.3.0

Calculus II notation that was misread or refused (a survey of precalculus through Calculus II inputs).

### mathzetta

- **New operators** (docs/postfix.md): `arcsec`, `arccsc`, `arccot` (values of arccot from 0 to π), and `evaluated`,
  an evaluation bar: `F x a b evaluated` is F at x = b minus F at x = a. Every output has them; code writes
  `acos(1/x)`, `asin(1/x)`, `π/2 − atan(x)` and the difference with the limits put in.
- **Read now:** `\sec^{-1} x`, `\csc^{-1}`, `\cot^{-1}` (1.2 read them as 1/sec x), `arcsec(x)`, `asec(x)`;
  evaluation bars `\left[F\right]_a^b`, `\left.F\right|_a^b`, `F\Big|_a^b` (any size), `_{x=a}^{x=b}`,
  `evaluated(F, a, b)`; degrees `30^\circ`, `30^{\circ}`, `\degree`, with a value in `evaluate` and `calculate`
  (`sin(30°)` is 1/2); `\big`, `\Big`, `\bigg`, `\Bigg`; `\cdots`, `\ldots`, `...` as ⋯ (code refuses it by
  name); the empty set `\emptyset`, `\varnothing`, `∅`, `\{\}`; `_5C_2`, `{}_nC_r`, `_nP_r`; `f^{(4)}(x)` as
  f′′′′(x); repeating decimals `0.1\overline{6}`; `(f \circ g)(x)`; `cases` rows with a comma before the
  condition; a brace of equations as a system (all hold).
- **Misreads fixed:** a name, a space and a number are two factors (`n 3^n` was a name `n3`).
- **`calculate` does complex numbers and polynomials.** `i` is the imaginary unit (unless the scope or a ∑ gives
  it a value): `(3 + 2i)(1 - i)` is `5 - i` (value `{ re: 5, im: -1 }`), `e^{i\pi} + 1 = 0` is true, `|3 + 4i|` is 5;
  with an i in the input or `{ complex: true }`, `\sqrt{-4}` is `2*i` and `\ln(-1)` is `pi*i` (odd roots of
  negatives stay real). Unknowns that are only added, multiplied, raised to whole powers or divided exactly stay
  as a polynomial: `(x+1)^2` is `x^2 + 2*x + 1`, `(x^2-1)/(x-1)` is `x + 1`, a determinant of letters is
  `a*d - b*c`, `(x+1)^2 = x^2 + 2x + 1` is true. **Behavior change:** `calculate('x + 1')` returns `x + 1`
  where it threw "no value for 'x'"; anything that needs a value (`sin x`, `x < 3`, `x^2 = 4`) still throws that.
- **More notation:** differentials `dy = f'(x)\,dx`, `du = 2x\,dx`, `r\,d\theta`, `\mathrm{d}x` as one quantity each
  (written `\mathrm{d}x`, with a thin space before it); `arcsine(x)`, `sine(x)`, `cotangent x` (`arcsine(x)` was
  arcsin times e); `x = t^2, y = t^3` (equations side by side: each holds); new operators `\implies` and `\iff`
  (`\Rightarrow`, `⇒`, `\iff`, `\Leftrightarrow`) and `setbuilder` (`\{x \mid x > 2\}`, `\{x \in \mathbb{R} : P\}`;
  `y ∈ {x | P}` is P with y for x in every output).
- **Values:** a repeating decimal keeps its value in every code output (`0.33..` was written `0.33`) and in
  `evaluate` (it was NaN); `calculate` takes a sample that underflows to 0 as 0 inside limits and integrals
  (`\lim_{x\to-\infty} e^x` is 0, ∫ e^(−x²) over ℝ is √π; both were "too small to calculate").
- LaTeX writes `30^{\circ}`, `\cdots` and `0.1\overline{6}`; the GLSL reader reads `radians(x)` and `degrees(x)`.

### @mathzetta/cas

- `arcsec`, `arccsc`, `arccot` and `evaluated` in the operator table; derivative rules and approximations for the
  three inverses.
- **Integration:** u-substitution (∫ f(g)·g′: `x e^(x^2)`, `ln(x)/x`, `x/(x^2 + 1)`, `sin x cos x`); partial
  fractions with an irreducible quadratic, by completing the square (`1/(x^2 + 4)`, `(x + 3)/(x^2 + 2x + 5)`,
  `1/(x(x^2 + 1))`); odd powers of sin and cos; secⁿ and cscⁿ by reduction; `sec`, `csc`, `cot`, `sec·tan`,
  `csc·cot` in the table; `e^(ax) sin(bx)` (by parts twice); `sin A cos B` (product to sum); `√(c − kx²)` and
  `1/√(c − kx²)` (a trig substitution); `arctan x` and `arcsin x` alone by parts. Each new method has a step.
  `npm run check:sympy` covers the new integrals (142/142 agree).
- **Inequalities:** `solve` takes `<`, `>`, `≤`, `≥` and chains (`-1 < 2x + 1 < 5`) by a sign chart, with roots,
  logs, fractions and absolute values; the answer as conditions (`x < -2 or x > 2`) and as `intervals`
  (`(-∞, -2) ∪ (2, ∞)`), with `pieces` for code. Trig inequalities are left unsolved.
- `solve('1/x = 0')` says "no solution" (it crashed).
- **Limits:** `cas.limit(…)`, from a written `\lim_{x \to a} f` (one-sided `a^+`, `a^-`) or `limit(f, 'x', a, { side })`:
  substitution where continuous; for 0/0, ∞/∞, 0·∞, ∞ − ∞, 1^∞, 0^0 and ∞^0, cancelling, leading terms, dividing by the
  highest power, the conjugate of a root, one fraction, e^(g·ln f) and L'Hôpital's rule, each a step; ±∞ by the
  sign on each side; "does not exist" with the reason (sides that differ, swinging); the squeeze theorem for a
  bounded factor. Every answer is checked against numbers near the point and refused rather than given wrong.
  28 limits in `npm run check:sympy` (170/170 agree).
- **Trigonometric identities in `simplify`:** a trig shape (everything in sin and cos, sin² + cos² = 1 used either
  way or not at all, canceled, the double angles both ways, tan/sec/csc/cot named) kept when shorter:
  `tan x cos x → sin x`, `sec²x − tan²x → 1`, `sin 2x/(2 sin x) → cos x`, `sin⁴x − cos⁴x → −cos 2x`,
  `sin x/(1 + cos x) + (1 + cos x)/sin x → 2 csc x`, `cos 2x/(cos x − sin x) → cos x + sin x`; rules for shifts by π/2
  and π and the cofunctions, the angle sums read backward (`sin x cos y + cos x sin y → sin(x + y)`), exact values at
  π/12 and π/8, and sin(arccos x) and the other right-triangle compositions (`sin(2 arcsin x) → 2x√(1 − x²)`).
  `equivalent` proves such identities exactly. 22 identities in `npm run check:sympy` (192/192 agree).
- **Improper integrals:** an integral to ±∞ takes the antiderivative's limit at that end
  (`\int_1^{\infty} 1/x^2 dx = 1`, `\int_{-\infty}^{\infty} 1/(1+x^2) dx = π`), and diverges when it is infinite or has none.
- Before release (a review): a limit from a side where the function has no real values does not exist (`ln x` and
  `√x` from the left of 0, and so two-sided; both gave an answer); `log_b` keeps its base (`\log_{1/2} x → -∞`,
  `\log_{10}(100 sin x/x) → 2`); a letter of unknown sign is refused (`a·x` at ∞ gave an empty answer); 2^∞, (1/2)^∞,
  0^∞ and ∞^c are answered directly, and only 1^∞, 0^0 and ∞^0 are called indeterminate; `(1 + x)^(1/x)` at 0 is e
  (it said "does not exist"); `limit` runs in complex mode; a limit inside an expression returns `exists`, and an
  infinite one there is refused (`∞ + 1`). Inequalities: chains of any length, test points written without an
  exponent (`ln x < 100`, `x(x − 10⁻⁷) < 0` gave no solution), no snapping of small values to 0, and where arcsin,
  arccos, arctanh, arcsec, arccsc, arccosh, a log's base and fractional powers start to have values. `sin^41 x`
  integrates at once (it took 4 s and failed), up to degree 100; an improper integral from ∞ down to a finite end
  nears that end from inside.

### mathzetta (more)

- `\lim_{x \to \pi/2^-}`: the side marker belongs to the whole point (it was read as π/(2^-)).
- The CAS call words (`simplify`, `expand`, `factor`, `cancel`, `diff`, `integrate`, `solve`, `approx`, `limit`) are
  read whole next to LaTeX: `\frac{1}{2} + diff(x^3, x)` was d·i·f·f(…).
- Before release (a review): evaluation bars written without LaTeX (`[x^2]_0^1` was x^(2_0^1)) or with a Greek
  variable (`[\sin\theta]_{\theta=0}^{\theta=\pi}`); a differential ends a bare function's argument
  (`du = \cos x\,dx` is cos(x)·dx, not cos(x·dx)); a ternary in braces (`{x > 0 ? 1 : 0}`) is not set-builder;
  Python writes the empty set `set()` (`{}` is a dict) and reads it back; `calculate` takes a complex power whose
  exact value would pass 20,000 bits in polar form (`(3/5 + 4/5 i)^100000` took 3 s); `getSupportedOperations()`
  puts every operator in a group (new groups `sets` and `matrices`).

### @mathzetta/inlinemath

- CAS blocks read calls with LaTeX in them (`{{simplify(\sec^2 x - \tan^2 x)}}`): the call names are kept whole.
- Scope values reach CAS blocks, except the variable a call works in: with `a = 2`, `{{diff(x^3, x = a)}}` is 12
  (it was 3a²) and `{{solve(x^2 = a, x)}}` is x = ±√2, while with `x = 2` the x of `{{diff(x^3, x)}}` stays a variable.
- CAS blocks work out limits (`{{\lim_{x \to 0} \frac{\sin x}{x}}}`, `{{limit(f, x, a)}}`): a number, ∞, or "does not exist";
  one-sided as `{{limit(1/x, x, 0, right)}}` (or `left`, `r`, `l`) or `{{limit(1/x, x -> 0^+)}}`.
- Draws evaluation bars (`[F]` with both limits), the empty set as ∅, a repeating decimal with a bar over its
  block, and the new inverses (as sec⁻¹ with `inverseTrig: 'power'`).

## mathzetta 1.2.0, @mathzetta/inlinemath 0.3.0, @mathzetta/cas 0.2.0

### Changes in behavior

These change what an existing call returns:

- **Derivatives at a point.** `der(f, x = a)` is the derivative at a point (postfix `f x a = der`). It is read from
  `der(f, x = a)`, `der(f, x = a, n)` and `\left.\frac{d}{dx} f\right|_{x=a}`, and drawn with an evaluation bar.
  `calculate` works out a plain `der(f, x)` only where an enclosing ∫, ∑, lim or d/dx varies x. A value the
  caller gives x makes x a constant, so `calculate('der(x^2, x)', { x: 3 })` (6 in 1.1) now throws "a derivative
  needs a point". Write `calculate('der(x^2, x = 3)')` instead.
- **No output calls a function its language lacks.** JavaScript, numeric Python, PostgreSQL and GLSL now refuse
  derivatives, limits, integrals (and in SQL and GLSL, set union and intersection) with an error naming what is
  missing. In 1.1 they wrote calls such as `derivative(…)`, which don't exist. The SymPy flavor still has all of them.
- **One meaning in every output.** `mod` takes the divisor's sign (-7 mod 3 is 2) and `round` takes a half away
  from zero in every language. JavaScript, SQL and Python are written to match, so their results differ from 1.1
  for negative numbers.
- **PostgreSQL strings are in single quotes.** `"Bob"` was an identifier there.
- **A conditional after `=` is a definition.** `f(x) = x < 0 ? x^2 : 2x` reads as `f(x) = (x < 0 ? x^2 : 2x)`, no
  brackets needed: when what follows an `=` is true or false and a `?` comes after it, the conditional is the
  right side. A test is unchanged (`x = 1 ? a : b`, `Status = "Active" ? Value : 0`), and so is anything bracketed
  (`(y = x > 0) ? 1 : 2`). In 1.1 the first form compared f(x) with `x < 0`.
- **A numeric answer shows only the digits it knows.** `calculate('int(abs(x), x, -1, 2)')` is `2.5`, not `2.49999985339`.
- **`2^-3^2` is 2^(-(3^2)).** A minus before a number in an exponent takes the power that follows, as it already
  did for a name (`2^-x^2`): 1/512, where 1.1 read `2^((-3)^2)`, 512. `2^-3`, `x^-1/2` and `10^-2.5` are unchanged.
- **`x (mod n)` alone is `x mod n` in code.** JavaScript and SQL wrote their own remainder for it (`-7 (mod 8)` was
  -7); now it takes the divisor's sign there too, as `evaluate` and `calculate` always did. A congruence
  (`a ≡ b (mod n)`) is unchanged.
- **GLSL refuses text.** A quoted string was written into the shader as it stood; now it is "No GLSL for text".
- **PostgreSQL `mean`** divides by `3.0`, not `3`: `mean(1, 2)` was 1.
- **The code checkers are stricter.** `checkGeneratedJs` with `keywords: false` (what `createRowEvaluator` uses)
  refuses assignments (`=`, `+=`, `++` …), and no code may assign to a member (`Math.abs = …`).
  `checkGeneratedPython` refuses text in SymPy code other than a limit's `"+"`/`"-"` (SymPy evaluates strings),
  a called `sympy.S`, and a lambda or generator that binds the name of a Python built-in. None of this is code
  the renderers write; it matters to callers who check code that came from somewhere else.
- **Mixed numbers.** A whole number with a proper fraction right after it is their sum: `1½`, `2 ¾`, `1 1/2`,
  `3\frac{1}{4}` (1.1 read a product, and `1 1/2` as 11/2). An improper fraction (`2\frac{3}{2}`), a fraction with
  no number on top (`2\frac{x}{3}`), and anything after `^`, `_` or a name stay products; `1 000` and `1 234/567`
  still group digits. LaTeX output already wrote the product as `2 \cdot \frac{1}{3}`.
- **Small characters are one script.** `x₁` is `x_1` and `x₁₂` is `x_{12}` (1.1: x times a name `₁`); `x¹²` is
  `x^{12}` (1.1: `(x^1)^2`), `2⁻ⁿ` is `2^{-n}`. One small character reads as before (`x²`, `x⁻¹`).
- **`1e5` is 1·10⁵**, like `1e+5` and `1e-9` (1.1: 1 times a name `e5`). `2e`, `2e^3` and the name `e5` are unchanged.
- **`\sqrt` without braces** takes one letter, number or command, as TeX does: `\sqrt x`, `\sqrt 2`, `\sqrt\pi`,
  `\sqrt\frac{1}{2}`; `\sqrt 2x` is √2 · x (the plain word still reads on: `sqrt 2x` is √(2x)). 1.1 read a
  name called `\sqrt`.
- **One letter set upright is that letter:** `\mathrm{e}^x`, `\operatorname{f}(x)` (1.1: a function called `mathrm`).
  `\cfrac` is a fraction. `\int dx` is ∫ 1 dx (it was refused).
- **American spelling.** The GLSL constants are `NEIGHBORHOOD`, `COLOR_SPACES` and `COLOR_FUNCTIONS`. The 1.1
  names `NEIGHBOURHOOD`, `COLOUR_SPACES` and `COLOUR_FUNCTIONS` still work (the same arrays) but are deprecated.
  Error messages and docs say "color" and "math". The build flavors keep their file names (`mathzetta.maths.min.js`).

### Fixes

- Nothing runs for long (found in a second review before this release):
  - `log(8,2` with its bracket still open doubled the text until memory ran out (a 12-character input could end
    the process); it is an ordinary error now.
  - A definition of a conditional nested in another (`a=(a=(…)<2?3:4)<2?3:4`) was read twice per level: 24 levels
    took 9 seconds. Read once.
  - `(lambda x: x+x+…)(…)` nested six deep grew to a gigabyte; it stops at 100,000 characters like the other
    rewrites.
  - A `blocks` handler whose answer holds `{{…}}` was asked again for ever.
  - Every code output wrote some operands two to four times before choosing a rule, so `x/y/y/…` in SymPy,
    `x mod y mod y …` in JavaScript and nested `ceil(` in Excel doubled at each level (25 levels: 10 seconds).
    Each node is now written once.
  - `calculate` charges factorials, `perm`, `comb` and matrix products to its step budget: a sum of a thousand
    `0*20000!` ran for half a minute (and so did `parse` on a `{{…}}` block holding it), `identity(100)^(2^300)`
    for 16 seconds. `evaluate` charges matrix products too.
- `strToFunction` answers `{ success: false }` for a limit, derivative or integral instead of throwing.
- `calculate`: a root of a number past the largest double has its value (`root(12, 3^2000 + 2)` was ∞, and its
  reciprocal NaN); the reciprocal of a root with a large radicand is a number instead of 75 ms of exact work.
- `evaluate`: a sum or product whose index is past 2⁵³ is refused at once (it spun until the step budget ran out).
- Types: `derivativeOrder` returns `at`, `filterPictureCalls` takes `{ whole }`, `ParseOptions` has `maxLength`.
- Output size: round, odd roots and mod write an expression once (a JavaScript helper, or a Python
  `lambda`), so nesting no longer doubles the code at each level, and `x mod random()` draws one number.
- One-argument `max`/`min` keep their brackets in Python, SQLite, Excel and GLSL: `max(a + b) * 2` was `a + b * 2`.
- Plain Python `round` and `fixed` pass NaN and ±∞ through instead of raising.
- Python and numpy bracket a comparison inside another: `y = (x > 0)` is `y == (x > 0)`, which Python would
  otherwise chain as `(y == x) and (x > 0)`. A chain written as one (`3 < x < 7`) stays one.
- `§` inside a quoted string is text again (`name = "§3"`). Outside strings it is still refused.
- `strToSQL` and `strToExcel` take percentages (`50% * a`) as numbers, as `toSQL` writes them.
- Python and SymPy set operations take a number as a set of one: `{1,2} ∪ 3`.
- `calculate` of a tiny negative fraction (`-1/10^400`) is a tiny negative number, not `-1.09e-301`.
- From the review on 2026-11-11: security holes in the code checkers (comments, prefixed strings), escaping in
  LaTeX and MathML, cases that took far too long (§ loops, `(mod` and `%` chains), and a plain-English phase that
  runs only when needed (parsing is about 6× faster).

### Inline Math 0.3.0

- Needs mathzetta 1.2 (its peer range is `^1.2.0`): it draws the point form of derivatives.
- Greek letters in the TeX style: an "Inline Math Greek" font cut from New Computer Modern, fetched only
  where Greek appears.
- Accents placed by measurement. `·` and `×` are drawn as typed. Equations joined by "or" or "and" are read in words.
- Markdown fixes: links containing code, nested emphasis, entities, list starts, indented code blocks.
- View fixes: `on()` unsubscribes, `destroy()`, and one live region per view.

- Markdown from a reader can't stall or crash the page: a heading line with a long run of spaces took cubic time
  (4,000 spaces: 20 seconds), a line of 2,400 `>` or 1,300 `- ` overflowed the stack (nesting now stops at 100
  levels; the rest is a paragraph), and long runs of unclosed `\(`, `[` or `![` were quadratic.
- Headings: `# a#` keeps its `#` (a closing run of #s needs a space before it).
- `view.set()` with something that can't be drawn leaves the view as it was (its tree had already changed).
- The `attributes` hook: a `class` value is escaped, and a key that isn't an attribute name is left out.

### MathZetta CAS 0.2.0

- `der(f, x = a)` is worked out as it is read; `diff()` refuses a point as its variable.
