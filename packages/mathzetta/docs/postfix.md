# The postfix format

`parse()` turns any input into **standard postfix**: an array of string
tokens in reverse Polish order. It is the one representation everything
else reads — the renderers, `evaluate()`, and (eventually) calcrules.

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
| sign | `\+` `\-` | a lone sign, as in `x^+` or `{-}`. |

Names can carry primes: `y′′` is the symbol for y″, and `\:f′` is the
function f′, as in `x 1 \:f′` = f′(x). The inverse of f is `\:f⁻¹`.
`Δx` is a single symbol.

## Operators

Fixed arity — no count token:

| Token | Arity | Meaning | Example postfix |
| --- | --- | --- | --- |
| `+` `-` `*` `/` `^` | 2 | arithmetic | `a b ^` = a<sup>b</sup> |
| `mod` | 2 | remainder | `a n mod` |
| `≡` | 2 | congruent | `a b ≡` |
| `pmod` | 2 | a statement taken mod n | `a b ≡ n pmod` = a ≡ b (mod n) |
| `±` | 2 | plus or minus | `a b ±` |
| `neg` | 1 | unary minus | `x neg` = −x |
| `pm` | 1 | unary ± | `3 sqrt pm` = ±√3 |
| `!` | 1 | factorial | `n !` |
| `_` | 2 | subscript | `x 1 _` = x<sub>1</sub> |
| `sqrt` `abs` `floor` `ceil` | 1 | | `x sqrt` |
| `root` | 2 | n-th root: index, radicand | `3 x root` = ∛x |
| `ln` | 1 | natural log | `x ln` |
| `log` | 2 | log with a base: base, value | `2 8 log` = log₂ 8 |
| `loglog` `logloglog` | 1 | ln ln x, ln ln ln x | |
| `expm1` | 1 | eˣ − 1 | |
| `sin` `cos` `tan` `csc` `sec` `cot` | 1 | | `x sin` |
| `sinh` `cosh` `tanh` | 1 | | |
| `arcsin` `arccos` `arctan` `arcsinh` `arccosh` `arctanh` | 1 | inverses | |
| `atan2` | 2 | y, x | `y x atan2` |
| `round` | 2 | value, decimal places | `x 0 round` |
| `fixed` | 2 | value, decimal places: rounded, then written with exactly that many decimals — a text (`2.500`); code outputs give a string, GLSL rounds | `x 2 fixed` |
| `perm` `comb` | 2 | ⁿPₖ, (n choose k) | `5 2 comb` |
| `random` | 0 | | `random` |
| `der` | 2 | derivative: expression, variable | `x 2 ^ x der` = d/dx x² |
| `=` `≠` `<` `>` `≤` `≥` | 2 | comparison | |
| `===` `≠=` | 2 | strict (in)equality, from `===` and `!==` | |
| `∈` `∉` | 2 | membership; the right side is usually a group | `x 0 1 2 [] ∈` |
| `→` | 2 | "tends to", inside limits | `x 0 →` |
| `≈` | 2 | approximately equal | `x 1.414 ≈` |
| `∪` `∩` | 2 | union, intersection | `-∞ 0 2 () 0 ∞ 2 () ∪` |
| `&` `\|` `\not` `\xor` `\nand` `\nor` | 2 (`\not`: 1) | logic | |
| `?:` | 3 | condition, then, else | `c a b ?:` |

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
| `\:name` | a function the parser didn't know | `x y 2 \:f` = f(x, y) |

`int` arguments, by count: `(f)`, `(f, x)` or `(f, a)`, `(f, x, a)` or
`(f, a, b)`, `(f, x, a, b)` — the second argument is the variable when it
is a single letter. `lim`: `(f)`, `(f, x→a)`, `(f, x, a)`, `(f, x, a, side)`
where side `r`/`l` means from the right/left (`x→0^+` becomes `x, 0, r`).
`der(f, x, n)` is `der` applied n times; Leibniz notation `dy/dx` is
`y x der`.

The full table, with precedences, is `src/operators.js`; `operator(token)`
looks one up at run time.

## Compared with calcrules

calcrules (`../calcrules`) uses the same idea — whitespace-separated postfix
— with a smaller vocabulary. Where they differ:

| | MathZetta | calcrules |
| --- | --- | --- |
| unary minus | `neg` | `neg` (same) |
| eˣ | `e x ^` | `x exp` |
| derivative | `f x der` | `f x D` |
| natural log | `x ln` | `x ln` (same) |
| sin, sqrt, abs | `x sin` (no count) | `x sin` (same) |
| everything else in its table | same token, same order | |

Making calcrules read MathZetta postfix directly means renaming `D` to
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
