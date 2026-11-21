# MathZetta CAS (@mathzetta/cas) — a small computer algebra system

Simplify, expand, factor, cancel, differentiate, integrate, solve (one unknown,
or linear systems), substitute, check equivalence, and approximate to any number
of digits — exactly, with steps, and with what it knows about functions kept in
YAML rules anyone can change.

```js
import { createCAS } from '@mathzetta/cas';
import { parse } from 'mathzetta';                  // optional: read ordinary math

const cas = createCAS({ read: (text) => parse(text) });
cas.simplify('sin(x)^2 + cos(x)^2 + sin(7pi/6)').text   // '1/2'
cas.diff('x^2 sin(3x)', 'x').text                       // '3x^2·cos(3x) + 2x·sin(3x)'
cas.integrate('x e^x', 'x').text                        // 'x·e^x - e^x'
cas.integrate('\\int_0^1 x^2 dx').text                  // '1/3'
cas.solve('sqrt(x + 1) = x - 1', 'x').text              // 'x = 3'  (x = 0 is checked and dropped)
cas.factor('x^4 - 16').text                             // '(x - 2)·(x + 2)·(x^2 + 4)'
cas.solveSystem(['x + y = 3', 'x - y = 1']).text        // 'x = 2, y = 1'
cas.approximate('e^(pi sqrt(163))', { digits: 30 }).text // '262537412640768743.999999999999'
```

Without `read`, strings are MathZetta postfix (`'x 2 ^ 3 *'`); token arrays and
MathZetta CAS nodes work too. In Inline Math, `@mathzetta/inlinemath/cas` wires this up for you:
`{{solve(x^2 = 4, x)}}` in drawn math, and step lists drawn as math
([inlinemath.com/cas.html](https://inlinemath.com/cas.html) is a playground).

## Calls

Every call returns `{ result, text, steps }` (`result` a MathZetta CAS node, `text`
written by `format`), and takes `{ steps, approximate }` (below).

| call | gives |
| --- | --- |
| `simplify(x)` | the normal form, then the simplify rules to a fixed point; then canceled, multiplied out, factored or rewritten with the trig identities if that is shorter (see below) |
| `expand(x)`, `factor(x)`, `cancel(x)` | multiplied out; factored over the rationals; one fraction with common factors canceled |
| `diff(x, v, { order })` | the differentiate rules (rules/calculus.yaml + rules/cas/derivatives.yaml), then simplify |
| `integrate(x, v, { from, to, constant })` | the integrate rules, then (when no rule fits) multiplying out, taking a number out, a linear substitution, polynomial division and partial fractions (linear factors and one irreducible quadratic, by completing the square: ln and arctan), odd powers of sin and cos, the reduction formula for secⁿ and cscⁿ, eᵃˣ·sin bx (by parts twice), sin A cos B (product to sum), √(c − kx²) (a trig substitution), u-substitution (∫ f(g)·g′: x e^(x²), ln x / x, x/(x² + 1)), integration by parts (also ∫ arctan x, arcsin x alone). `from`/`to` (or an `int` with limits) gives F(b) − F(a), refused when the integrand has no value between the limits |
| `solve(eq, v)` | `{ solutions, result, text, steps, unsolved, always }` — see below; an inequality (`<` `>` `≤` `≥`, or a chain `-1 < 2x + 1 < 5`) gives `{ pieces, intervals, text }`: `'x < -2 or x > 2'`, `'(-∞, -2) ∪ (2, ∞)'` |
| `solveSystem(eqs, vars)` | linear equations, exact elimination: `{ solution: { x, y }, status: 'one' \| 'none' \| 'many' }` |
| `limit(x, v, to, { side })` | the limit as v → to (a number, `\\infty`, `-\\infty`; or a written `\\lim_{x \\to a} …`, one-sided `a^+`): a number, `∞`, `-∞`, or `does not exist` (`exists: false`, `reason`) — see below |
| `substitute(x, { x: 2, y: 'z + 1' })` | put values in, simplify |
| `equivalent(a, b)` | `{ equal, how: 'exact' \| 'numeric' }` |
| `approximate(x, { digits, scope })` | a decimal to `digits` significant figures (15; any number) |
| `rewrite(x, mode)` | one mode's rules only: `'expand-log'`, `'combine-log'`, or a mode of your own |
| `normal(x)` | the normal form alone |

**Solving**, in order: move the terms with the unknown left; one term left →
divide by its constant factors, then undo its outer function with an isolate
rule (rules/cas/solve.yaml) and repeat; several terms → a polynomial (factor
over the rationals, the quadratic formula), a product equal to 0, a fraction
(clear the denominator), one root among polynomial terms (isolate and undo it),
or a polynomial in e^x, sin x, ln x … (substitute). Every answer is checked in
the original equation, and one that doesn't fit is dropped with a step saying
why. `{ approximate: true }` finds real roots numerically when there is no
exact method (x⁵ + x + 1 = 0). Trigonometric equations give the solutions in one
turn, and the explanation says to add 2πk.

**Trigonometric identities.** Besides the rules (exact values at multiples of π/12 and π/8, shifts by π/2 and π, the
cofunctions, the angle sums read backward, sin(arccos x) and the other right-triangle compositions), `simplify` tries
three more shapes and keeps the shortest: everything in sin and cos, one fraction, sin² + cos² = 1 used one way, the
other way, or not at all, canceled, with the double angles both ways, and tan, sec, csc, cot named where they are left.
A trig function of an inverse one is written out even when that is a little longer. `equivalent(a, b)` proves an
identity exactly when a − b simplifies to 0.

```js
cas.simplify('sec(x)^2 - tan(x)^2').text                   // '1'
cas.simplify('sin(2x)/(2 sin(x))').text                    // 'cos(x)'
cas.simplify('sin(x)^4 - cos(x)^4').text                   // '-cos(2x)'
cas.simplify('sin(x)/(1 + cos(x)) + (1 + cos(x))/sin(x)').text   // '2csc(x)'
cas.simplify('sin(2 arcsin(x))').text                      // '2x·sqrt(-x^2 + 1)'
cas.equivalent('tan(x) + cot(x)', 'sec(x) csc(x)')          // { equal: true, how: 'exact' }
```

**Limits** go as a calculus course does: put the point in where the function is continuous; otherwise each part's
limit with ±∞ tracked, and for an indeterminate form — 0/0 (cancel a common factor, else L'Hôpital), ∞/∞ (the leading
terms of a fraction of polynomials, dividing by the highest power, else L'Hôpital), 0·∞ (a quotient), ∞ − ∞ (one
fraction, or the conjugate of a root), 1^∞, 0^0, ∞^0 (e^(g·ln f)). c/0 is ±∞ by the sign on each side; sides that
differ, or something that keeps swinging, have no limit; sin and cos of such stay bounded (times 0, or over ∞: 0, the
squeeze theorem). Each answer is held to numbers near the point, and refused rather than given if they disagree.
Integrals to ±∞ take F's limit at that end, and diverge when it is infinite or there is none.

```js
cas.limit('\\lim_{x \\to 0} \\frac{\\sin x}{x}').text                         // '1'   (L'Hôpital, as a step)
cas.limit('(1 + 1/x)^x', 'x', '\\infty').text                             // 'e'
cas.limit('\\lim_{x \\to 0} \\frac{1}{x}')                                       // { exists: false, reason: 'from the left it goes to -∞, from the right to ∞' }
cas.limit('1/x', 'x', 0, { side: 'right' }).text                          // '∞'
cas.integrate('\\int_1^{\\infty} \\frac{1}{x^2} dx').text                       // '1'
```

**Inequalities** are solved with a sign chart: the points where one side minus the other is 0 (found by the
equation solver), has no value (a zero denominator) or starts to have one (a root's or a log's argument at 0) cut
the line into intervals, and one number in each, and each point, is tested.

```js
cas.solve('x^2 - 4 > 0').text                 // 'x < -2 or x > 2'     .intervals: '(-∞, -2) ∪ (2, ∞)'
cas.solve('|2x + 1| < 5').text                // '-3 < x < 2'
cas.solve('(x - 1)/(x + 2) >= 0').intervals   // '(-∞, -2) ∪ [1, ∞)'
cas.solve('3 <= 1 - 2x < 7').text             // '-3 < x ≤ -1'
cas.solve('sqrt(x - 1) < 2').text             // '1 ≤ x < 5'
```

## Exact, unless you ask

Numbers are fractions of any size (BigInt): `2^100`, `1/3 + 1/6 = 1/2`,
`0.1 + 0.2 = 3/10`. Irrational values stay as they are: `√72 = 6√2`,
`√2·√3 = √6`, `∛(-8) = -2`, `log_2 8 = 3`, π, e, ln 5. A decimal only appears
when asked for:

- `approximate(x, { digits: 100 })` — 100 correct digits of π, √2, sin 1 …
  (BigInt fixed point: Machin's formula for π, series for exp, ln, sin, atan).
- `{ approximate: 10 }` on any call — the answer's numbers to 10 digits,
  unknowns kept: `π x` → `3.141592654x`.

## Complex numbers

`createCAS({ complex: true })` makes `i` the imaginary unit (off, `i` is an ordinary
unknown — a sum's index, say — and √-4 is not real):

```js
const cas = createCAS({ complex: true, read: (t) => parse(t, { names: ['Re', 'Im', 'conj', 'arg'] }) });
cas.simplify('(2 + 3i)(1 - i)').text      // '5 + i'
cas.simplify('1/(1 + i)').text            // '1/2 - i/2'
cas.simplify('sqrt(3 + 4i)').text         // '2 + i'   (principal roots, exactly)
cas.simplify('e^(i pi) + 1').text         // '0'
cas.simplify('arg(-1 - i)').text          // '-3π/4'
cas.solve('x^3 = 8', 'x').text            // 'x = 2 or x = -1 - sqrt(3)i or x = -1 + sqrt(3)i'
cas.approximate('cos(1 + i)').text        // '0.833730025131149 - 0.988897705762865i'
```

- Arithmetic is the normal form's: whole powers of i, √ of negative numbers, products
  and quotients of complex numbers multiplied out (a + bi), Re, Im, conj, arg (as
  atan2, then the atan2 rules) and |z|. Square roots of a + bi are exact when b is a
  number.
- Rules (rules/cas/complex/complex.yaml, loaded only in complex mode): Euler's
  formula for constant exponents, ln of negative and complex numbers, iⁱ.
  Principal values throughout.
- **Unknowns count as real**: Re(x + 3i) = x, conj(x) = x. Write a complex unknown as
  a + bi.
- Solving: a polynomial has all its roots (x⁴ = 16 gives ±2 and ±2i); the quadratic
  formula gives complex pairs; xⁿ = r gives all n roots, |r|^(1/n)(cos θ + i sin θ);
  `{ approximate }` finds every root of a polynomial numerically (Durand–Kerner).
- approximate() works with complex values to any number of digits.
- MathZetta reads `Re(z)` as R·e·z unless told: pass `names` (inlinemath's
  `mathCAS({ complex: true })` does). `\operatorname{Re}`, `\overline{z}` and `\bar z` work as written.

## Steps

Every step is `{ id, name, tags, from, to, path, before, after, explanation }`:
`from`/`to` are the whole expression (postfix) before and after, `path` the
part a rule rewrote (a Inline Math `{ path }`), `before`/`after` that part.

```js
cas.diff(f, 'x', { steps: true })        // every step, explained (default)
cas.diff(f, 'x', { steps: 'brief' })     // just the steps that carry the idea
cas.diff(f, 'x', { steps: false })       // none
cas.diff(f, 'x', { steps: { show: ['chain', 'product'], hide: ['tidy'], explain: ['chain'] } })
```

- `show` (default `'all'`) and `hide` take rule ids and tags; `detail` is a preset
  for `hide`: `full` (nothing), `normal` (rules tagged `hidden`), `brief` (also
  `tidy`, `identity`, `value`, `split`, `base`, `arithmetic`).
- `explain`: `true`, `false`, or the ids/tags whose explanations to keep.
- A hidden step is folded into the next shown one (which lists it in `also`),
  so each shown step starts where the previous one ended.
- In a rule file, `step: hidden` hides a rule's steps unless `detail: 'full'`.

## What is code, and what is rules

**Code** (src/cas): the normal form — exact arithmetic, like terms collected,
like bases combined, roots of numbers simplified, a number multiplied into a
sum, terms ordered x² + 3x + 1 — and the algorithms: polynomial expansion,
rational roots, factoring, canceling, the solver's strategy, numeric roots,
the integration strategies, approximation. Exact folds of functions of numbers
(|−3|, 5!, floor, mod, gcd, max, comb, log_b of a power of b) are code too.

**Rules** (rules/calculus.yaml, rules/cas/*.yaml) — everything about what a
function is: its values (sin π/6 = 1/2), symmetries and turns (sin(7π/6) =
−sin(π/6)), identities (sin² + cos² = 1, ln e^u = u, √(u²) = |u|), derivatives,
integrals, and its inverse for solving (ln u = r → u = e^r). And the wording of
every step: a rule's `explain`, and the code's own steps through `messages`.

## Your own version

```js
const cas = createCAS({ rules: [myYaml] });          // after the shipped rules
const bare = createCAS({ rules: [myYaml], defaults: false });   // instead of them
```

A rule file is MathZetta CAS YAML (see the README), with two more sections:

```yaml
operators:                    # new functions: patterns can use them
  - { symbol: sinc, arity: 1 }
messages:                     # reword the code's steps (keys: MESSAGES in src/cas/index.js)
  solve.divide: "Share both sides out between {by}."
rules:
  - id: d-sinc                # a derivative
    mode: differentiate
    pattern: u sinc v der
    output: u cos u / u sin u 2 ^ / - u v der *
    explain: "…"
  - { id: sinc-0, pattern: 0 sinc, output: "1", tags: [value] }        # a value
  - { id: sinc-definition, mode: define, pattern: u sinc, output: u sin u / }   # for approximate()
  - { id: sin-pi-6, explain: "From the 30-60-90 triangle: sin 30° = 1/2." }   # reword a shipped rule
  - { id: sqrt-of-square, enabled: false }                                    # turn one off
```

- A rule with a shipped rule's id changes only the fields it gives.
- Modes the CAS uses: `simplify`, `differentiate`, `integrate`, `isolate`
  (solving), `define` (definitions, used by approximate and equivalent);
  `expand-log` and `combine-log` ship as opt-in; any other mode name is yours,
  run with `cas.rewrite(x, 'mode')`.
- MathZetta reads a function it doesn't know as a product (s·i·n·c); give
  `read: (t) => parse(t, { names: ['sinc'] })` (or `mathCAS({ names })` in
  Inline Math) and its `\:sinc` becomes your declared `sinc`.

**Patterns see the normal form as drawn**, so write them the way the CAS writes:
x/2 is `x 2 /`, 2x − 3 is `2 x * 3 -`, −x is `x neg`, √x is `x sqrt`, ∛x is
`3 x root`, 1/x is `1 x /`, x⁻² is `1 x 2 ^ /`, e^x is `=e x ^`, π/6 is
`=pi 6 /`, ½ is `1 2 /`. A word is a slot; a fixed symbol is `=pi`, `=e`. Literal
parts are put in normal form when the rule loads (`2 =pi * 3 /` and
`=pi 2 * 3 /` are the same). `cas.normal(x).s` shows how anything is drawn.
Arithmetic happens before and after every rule, and a rule for a sum or product
of two parts also fires on any two parts of a longer one (sin²x + cos²x inside
sin²x + cos²x + 1).

Predicates for `when`, besides MathZetta CAS's own (isNumber, isSymbol, contains …):
`isRational`, `isWhole`, `isEvenWhole`, `isOddWhole`, `isPositiveRational`,
`isNegativeRational`, `isConstant` (no unknowns), `isPositiveConstant`,
`isNegativeConstant` (e, π, √2 …), `notOne`, `notMinusOne`, `hasMinusSign`,
`piMultipleAtLeast/Above/Below/AtMost: [k]` (rational multiples of π),
`hasVariable`/`freeOfVariable` (the unknown being solved for, in isolate rules).
Relations: `sameAs`, `freeOf`, `dependsOn`, `differs`.

## Not (yet) here

Integration beyond the methods above (repeated factors with a quadratic,
even powers of sin·cos together, other trig substitutions); trigonometric inequalities (infinitely many intervals);
factoring over the rationals only (x² − 2 stays) and multivariate factoring
beyond common factors and a² − b², a³ ± b³; trig solutions beyond one turn;
complex unknowns (in complex mode unknowns are real) and complex calculus;
assumptions (x > 0). Simplification is "shortest of a few
shapes", not a search.

## Checks

`npm test` runs the CAS tables and property tests: simplified = original,
derivatives against finite differences, d/dx ∫ f = f, every solution satisfies
its equation (values from MathZetta's evaluate). `npm run check:sympy` compares
121 answers (25 of them complex) with real SymPy (needs python3 with sympy). After editing a rule file,
`npm run build:rules` (src/cas/default-rules.js is generated; a test checks it).
