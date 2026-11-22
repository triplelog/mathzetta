# The postfix format

`parse()` turns any input into **standard postfix**: an array of string
tokens in reverse Polish order. It is the one representation everything
else reads — the renderers, `evaluate()`, and (eventually) MathZetta CAS.

```
3x^2 + 2x - 1     →  3 x 2 ^ * 2 x * + 1 -
\sin^2 x          →  x sin 2 ^
max(a, b, c)      →  a b c 3 max
```

To learn the algorithm by hand, mathzetta.com has a [quiz](https://mathzetta.com/quiz.html): an expression becomes
postfix one move at a time, with an operator stack, and every answer is checked against `parse()`.

## Reading it

Walk the tokens left to right with a stack:

- an **operand** is pushed;
- an **operator** with arity *n* pops *n* values and pushes one result;
- a **variadic** operator first pops a count — a whole-number token pushed
  just before it — and then that many values.

A well-formed postfix leaves exactly one value. `fromPostfix()` does this
and returns a tree; `toPostfix()` writes a tree back. A node's `id` is the
index of its token, so `x 2 ^` has `x` = 0, `2` = 1 and `^` = 2. Renderers
put that id on what they draw (`<mi id="mz-0">`), which is how a display can
highlight exactly the part an explanation is talking about.

## Operands

| Kind | Examples | Notes |
| --- | --- | --- |
| number | `3` `-2` `0.5` `.5` `1.333..` | digits and dots, optional leading `-`. A minus written directly on a number is folded in: `-5`, not `5 neg`. A trailing `..` marks a repeating decimal (kept as written; code output drops the dots). |
| symbol | `x` `theta` `θ` `pi` `e` `∞` `-∞` `°` `true` `speed` | anything that isn't a number, string or operator. Greek letters arrive as unicode (`\alpha` → `α`); `π` arrives as `pi`. |
| string | `"abc"` `'abc'` | quotes included. |
| percentage | `50%` `12.5%` | a number with `%`: its value is the number / 100. Code outputs write the decimal (`0.5`); spreadsheets keep `50%`. |
| sign | `\+` `\-` | a lone sign, as in `x^+` or `{-}`. |

Names can carry primes: `y′′` is the symbol for y″, and `\:f′` is the
function f′, as in `x 1 \:f′` = f′(x). The inverse of f is `\:f⁻¹`.
`Δx` is a single symbol, and so is a differential, `dx` (`dθ`): read from `\mathrm{d}x`, a `d` after a thin space (`\,dx`), or two or more side by side (`dy = 2x\,dx`) — outside integrals and d/dx, whose own readers take their d. A bare `d x` is still d times x.

## Operators

Fixed arity — no count token:

| Token | Arity | Meaning | Example postfix |
| --- | --- | --- | --- |
| `+` `-` `*` `/` `^` | 2 | arithmetic | `a b ^` = a<sup>b</sup> |
| `mod` | 2 | remainder, with the divisor's sign (floored, as in math): `-7 mod 3` is 2. JavaScript and SQL, whose `%`/`MOD` take the dividend's, are written to match | `a n mod` |
| `≡` | 2 | congruent | `a b ≡` |
| `pmod` | 2 | a statement taken mod n | `a b ≡ n pmod` = a ≡ b (mod n) |
| `±` | 2 | plus or minus | `a b ±` |
| `neg` | 1 | unary minus | `x neg` = −x |
| `pm` | 1 | unary ± | `3 sqrt pm` = ±√3 |
| `!` | 1 | factorial | `n !` |
| `_` | 2 | subscript | `x 1 _` = x<sub>1</sub> |
| `sqrt` `abs` `floor` `ceil` | 1 | | `x sqrt` |
| `root` | 2 | n-th root: index, radicand. An odd root of a negative number is real: `3 -8 root` is −2 | `3 x root` = ∛x |
| `ln` | 1 | natural log | `x ln` |
| `log` | 2 | log with a base: base, value | `2 8 log` = log₂ 8 |
| `loglog` `logloglog` | 1 | ln ln x, ln ln ln x | |
| `expm1` | 1 | eˣ − 1 | |
| `sin` `cos` `tan` `csc` `sec` `cot` | 1 | | `x sin` |
| `sinh` `cosh` `tanh` | 1 | | |
| `arcsin` `arccos` `arctan` `arcsinh` `arccosh` `arctanh` | 1 | inverses | |
| `arcsec` `arccsc` `arccot` | 1 | inverses of sec, csc, cot: arccos(1/x), arcsin(1/x), and π/2 − arctan x (values 0 to π). Read from `\sec^{-1} x`, `arcsec(x)`, `asec(x)`; code outputs write those formulas | `x arcsec` |
| `atan2` | 2 | y, x | `y x atan2` |
| `round` | 2 | value, decimal places; a half goes away from zero (`round(-2.5)` is −3) in every output | `x 0 round` |
| `fixed` | 2 | value, decimal places: rounded, then written with exactly that many decimals — a text (`2.500`); code outputs give a string, GLSL rounds | `x 2 fixed` |
| `perm` `comb` | 2 | ⁿPₖ, (n choose k) | `5 2 comb` |
| `random` | 0 | | `random` |
| `setbuilder` | 2 | set-builder notation: the element (a name, or `x ∈ S`) and the condition. Read from `\{x \mid P\}`, `\{x : P\}`, `\left\{ … \middle\| … \right\}`, and `{x : P}` in plain text, which is what text writes. `y ∈ {x \| P}` is P with y for x in every output; the set alone has nothing to list, so code outputs refuse it | `x x 2 > setbuilder` = {x \| x > 2} |
| `evaluated` | 4 | an evaluation bar: expression, variable, lower, upper — F at x = upper minus F at x = lower. Read from `\left[F\right]_a^b`, `\left.F\right|_a^b`, `F\Big|_a^b` (any size), `_{x=a}^{x=b}`, and `evaluated(F, a, b)` (the variable is F's first) or `evaluated(F, x, a, b)`, which is what text writes. Code outputs write the difference, F with b put in for x minus F with a | `x 3 ^ 3 / x 0 1 evaluated` = [x³/3]₀¹ |
| `der` | 2 | derivative: expression, variable — or, at a point, expression and `x = a` (an `=` node, as `lim` takes `x → a`): `x 3 ^ x 2 = der` is d/dx x³ at x = 2, drawn with a bar \|ₓ₌₂ and read from `der(f, x = a)` or `\left.\frac{d}{dx} f\right|_{x=a}`. `calculate` works out the point form, and a plain `der(f, x)` only where an enclosing ∫, ∑, lim or d/dx varies x (a value the caller gives x makes it a constant). Drawn and spoken everywhere; worked out by `calculate` (at a point) and SymPy. JavaScript, numeric Python, SQL, GLSL and spreadsheets refuse it by name, as they refuse `int` (without numeric bounds in Python), `lim` and, in SQL and GLSL, indexed sums and products | `x 2 ^ x der` = d/dx x² |
| `=` `≠` `<` `>` `≤` `≥` | 2 | comparison | |
| `===` `≠=` | 2 | strict (in)equality, from `===` and `!==` | |
| `∈` `∉` | 2 | membership; the right side is usually a group. With a text on the left and no written-out set on the right it is a text search — `"ab" name ∈`, from `"ab" in name` or `contains(name, "ab")`: is the text somewhere in the value, whatever the case of the letters A to Z. JavaScript, Python, numpy, SQL and a spreadsheet write that test, and evaluate and calculate work it out (as they do `name "ab" 2 \:startswith`, from `startswith(name, "ab")`); no operator was added for either | `x 0 1 2 [] ∈` |
| `→` | 2 | "tends to", inside limits | `x 0 →` |
| `≈` | 2 | approximately equal | `x 1.414 ≈` |
| `∪` `∩` | 2 | union, intersection | `-∞ 0 2 () 0 ∞ 2 () ∪` |
| `&` `\|` `\not` `\xor` `\nand` `\nor` | 2 (`\not`: 1) | logic | |
| `\implies` `\iff` | 2 | p ⇒ q (not p, or q) and p ⇔ q (both or neither), looser than every other logic operator. Read from `\Rightarrow`, `\implies`, `⇒`, `\iff`, `\Leftrightarrow`, `⇔` | `p q \implies` |
| `?:` | 3 | condition, then, else | `c a b ?:` |

`=` binds tighter than `?:`, so `x = 1 ? a : b` tests x = 1 (`x 1 = a b ?:`). One exception reads a definition: when
what follows an `=` is itself true or false (a comparison, and, or, not) and a `?` comes after it within the same
brackets, the whole conditional is the right side. `f(x) = x < 0 ? x^2 : 2x` is `f(x) = (x < 0 ? x^2 : 2x)`
(`x 1 \:f x 0 < x 2 ^ 2 x * ?: =`), since comparing f(x) with a true/false value is never what is meant.
Brackets keep the test: `(y = x > 0) ? 1 : 2` is `y x 0 > = 1 2 ?:`, and the text, JavaScript and GLSL outputs
write that bracket so it reads back the same.

Variadic — a count token comes first:

| Token | Meaning | Example postfix |
| --- | --- | --- |
| `max` `min` `gcd` `mean` | | `1 2 3 3 max` |
| `sum` `prod` | a + b + …, a · b · … | `a b c 3 sum` |
| `int` | integral; see below | `x 2 ^ x 0 1 4 int` = ∫₀¹ x² dx |
| `lim` | limit; see below | `1 x / x 0 → 2 lim` |
| `\sumidx` `\prodidx` | ∑ / ∏ with an index: body, from, to | `i 2 ^ i 1 = n 3 \sumidx` |
| `()` `[]` `{}` | tuple, list, set | `1 2 3 3 {}` |
| `(]` `[)` | half-open intervals | `0 1 2 (]` = (0, 1] |
| `det` | the determinant of a matrix | `A det` |
| `pmatrix` `bmatrix` `vmatrix` | a matrix in ( ), [ ] or \| \| (the determinant); each operand is a row, a `[]` list (an operand that isn't one is a row of one entry) | `1 2 2 [] 3 4 2 [] 2 bmatrix` |
| `\:name` | a function the parser didn't know | `x y 2 \:f` = f(x, y) |

`int` arguments, by count: `(f)`, `(f, x)` or `(f, a)`, `(f, x, a)` or
`(f, a, b)`, `(f, x, a, b)` — the second argument is the variable when it
is a single letter. `lim`: `(f)`, `(f, x→a)`, `(f, x, a)`, `(f, x, a, side)`
where side `r`/`l` means from the right/left (`x→0^+` becomes `x, 0, r`).
A matrix written as a list of equally long lists, `[[1, 2], [3, 4]]`, stays `[]` of `[]`
(`1 2 2 [] 3 4 2 [] 2 []`); `calculate` and `evaluate` treat it as a matrix all the same
(`*` is the matrix product, `^ n` a power, `^ T` the transpose), and drawings show it as one.
`det` is the determinant (`A det`; `\det A` and `det(A)` read as it). `inv(A)`, `transpose(A)`,
`trace(A)`, `rank(A)`, `rref(A)`, `identity(n)`, `dot(u, v)`, `cross(u, v)` and `linsolve(A, b)` are
`\:name` functions the calculator knows; `A^T` (also `A^{\top}`) is the transpose there.
`der(f, x, n)` is `der` applied n times; Leibniz notation `dy/dx` is
`y x der`.

The full table, with precedences, is `src/operators.js`; `operator(token)`
looks one up at run time.

## Compared with MathZetta CAS

MathZetta CAS (`../cas`) uses the same idea — whitespace-separated postfix
— with a smaller vocabulary. Where they differ:

| | MathZetta | MathZetta CAS |
| --- | --- | --- |
| unary minus | `neg` | `neg` (same) |
| eˣ | `e x ^` | `x exp` |
| derivative | `f x der` | `f x D` |
| natural log | `x ln` | `x ln` (same) |
| sin, sqrt, abs | `x sin` (no count) | `x sin` (same) |
| everything else in its table | same token, same order | |

Making MathZetta CAS read MathZetta postfix directly means renaming `D` to
`der` (or mapping it on input) and treating `e x ^` as `x exp`.

## Changes from MathZetta 1

- Unary minus is `neg` (was `0-`).
- One-argument functions no longer carry a count: `x sin` (was `x 1 sin`);
  `atan2` likewise.
- `\:name` custom functions do carry one: `x y 2 \:f` (they used to lose
  their arguments).
- Natural log is `ln`, whatever the input spelling (was sometimes `e x log`).
- `sqrtpow` is `root`.
- Membership is composed from a group: `x 0 1 2 (] ∈` (was `x 0 1 2 ∈(]`),
  and works with any right-hand side: `x S ∈`.
- `der(f, x, n)` is `der` applied n times (was a malformed 3-operand `der`).
- `≡` and `pmod` are new, for congruences.
