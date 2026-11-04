# MathZetta CAS

Exact computer algebra with steps you can read: simplify, expand, factor, cancel, differentiate,
integrate, solve, approximate to any number of digits, and complex numbers if you ask for them. What
it knows about functions is YAML rules you can read, change, add to or replace; the engine under it
applies any rules you give it.

Zero dependencies, ES modules with TypeScript declarations, works in the browser and in Node.

```bash
npm install @mathzetta/cas
```

```js
import { createCAS } from '@mathzetta/cas';
const cas = createCAS();
cas.solve('x 2 ^ 5 x * - 6 + 0 =', 'x', { steps: 'brief' })   // x = 2 or x = 3, with steps
cas.integrate('x x sin *', 'x').text                           // -x·cos(x) + sin(x)

import { parse } from 'mathzetta';                              // or read ordinary maths first
const typed = createCAS({ read: (text) => parse(text) });
typed.diff('x^3 sin(x)', 'x').text                             // x^3·cos(x) + 3x^2·sin(x)
```

Expressions are [MathZetta](https://github.com/triplelog/mathzetta/tree/main/packages/mathzetta)
postfix, and [Inline Math](https://github.com/triplelog/mathzetta/tree/main/packages/inlinemath)
draws the results (`@mathzetta/inlinemath/cas` puts the CAS and its steps in drawn maths). The
guide to the CAS is [docs/cas.md](docs/cas.md); try it at [mathzetta.com/cas/](https://mathzetta.com/cas/).

## The rule engine: `@mathzetta/cas/engine`

Under the CAS is a rule engine you can use on its own:

```js
import { RuleSet, parse, simplify } from '@mathzetta/cas/engine';
```

It simplifies expressions by applying rules you can add and change without touching the engine.
Rules live in YAML; the engine figures out which one applies where, what the result is, and how to
say it in words. Two modes ship with it: **simplify** tidies an expression up, **differentiate**
breaks a derivative down. They are just rules, in the same format, tagged with a `mode`.

## The idea

Every rule is stored under a **structure key** — the shape of an expression
with its operands blanked out. The trick is that one expression has *many*
shapes, because any operation can be collapsed into a single opaque operand.

`3 + 4*(5-6)`, written postfix as `3 4 5 6 - * +`, collapses three ways at the
root:

| key | reads as | i.e. |
| --- | --- | --- |
| `_ _ +` | ⟨3⟩ + ⟨4*(5-6)⟩ | `3 + (-4)` |
| `_ _ _ * +` | ⟨3⟩ + ⟨4⟩*⟨5-6⟩ | `3 + 4*(-1)` |
| `_ _ _ _ - * +` | the whole shape | `3 + 4*(5-6)` |

Generate those keys at every node, look each one up in a Map, and you have your
candidate rules in O(1) per key. The operands are deliberately anonymous in the
key; everything a rule needs to know about them lives in its **requirements**.

Collapsings grow fast with depth (2, 5, 26, 677, 458330 for a balanced binary
tree), so key generation is capped at the depth of the deepest pattern in the
ruleset. With rules of depth ≤ 3 that is at most 26 keys per node. Matching a
classroom-sized expression takes about 20 microseconds.

## Writing a rule

```yaml
- id: add-zero
  name: Adding zero
  pattern: a 0 +
  commutative: true
  output: a
  explain: "Adding 0 changes nothing, so this is just {a}."
```

- **pattern** — postfix. Identifiers are slots that bind to *any* subexpression;
  numeric leaves are literals, so `a 0 +` only fires when the operand really is
  `0`. Repeat a slot name to demand the same subexpression twice (`a a -`).
  Prefix with `=` for a literal non-numeric operand (`a =pi *`).
- **output** — postfix, built from the slot names. `fold: true` additionally
  evaluates the result numerically wherever that is exact.
- **when** / **require** — see below.
- **explain** — `{slot}` and `{result}` are filled in when the rule fires.
- **commutative** — also register the mirrored operand orders, so one rule
  covers `a + 0` and `0 + a`.
- **priority** — breaks ties when several rules match the same node. Deeper
  (more specific) patterns already win by default.
- **mode** — which pass the rule belongs to; defaults to `simplify`. Rules only
  ever run alongside others in the same mode.

A rule using every part:

```yaml
- id: collect-like-terms
  name: Collect like terms
  pattern: x m * y n * +
  commutative: true
  when:
    m: [isNumber]
    n: [isNumber]
  require:
    - [sameAs, x, y]
  output: x m n + *
  fold: true
  explain: "{m} lots of {x} plus {n} lots of {x} makes {result}."
```

`2x + 3x` and `x*2 + x*3` both become `5x`.

### Requirements

`when` constrains one slot; `require` relates several. Both are **data, not
code** — a rule file is never executed, so importing someone else's ruleset is
safe. Entries are `name` or `[name, arg]`.

Predicates are conservative: anything not *provably* true is false. `x` is not
provably non-zero, so `isNonZero` rejects it — use `isNotZeroLiteral` where you
want the looser reading.

```
shape     isLeaf isCompound isSymbol isOperation(op)
numbers   isNumber isInteger isZero isOne isPositive isNegative isNonNegative
          isNonZero isNotZeroLiteral isPositiveInteger isNegativeInteger
          isEven isOdd greaterThan(n) lessThan(n) isValue(n)
content   isNumeric isVar(name) contains(token) isFree(token)
          hasOperation(op) equals(postfix)
relations sameAs differs sameValue freeOf dependsOn
```

`isFree(token)` takes a literal; `freeOf` compares two slots. Use the relation
whenever the thing you are testing against is itself a slot.

Add your own with `definePredicate('isTau', node => …)`; it shows up in the
editor's dropdown immediately.

## The postfix dialect

Expressions are MathZetta postfix ([its docs/postfix.md](https://github.com/triplelog/mathzetta/blob/main/packages/mathzetta/docs/postfix.md)),
so anything MathZetta parses can be rewritten here and anything MathZetta CAS
produces can be drawn or read aloud there — `fromPostfix(parse('e^(2x)'))`
is the whole bridge. The operator names and arities in `src/ops.js` mirror
MathZetta's: `neg` for unary minus, `e u ^` for e^u (there is no `exp`),
`der` for d/dx, counts before variadic operators (`a b c 3 max`) and
`\:name` for user functions (`x 1 \:f` is f(x)). MathZetta CAS has no
dependency on MathZetta; it only agrees on the names.

## Differentiating

`u v der` means d(u)/dv, and `der` is an ordinary binary operator — the engine
never evaluates it, the rules rewrite it away. So d/dx of x² is `x 2 ^ x der`.

The rules cover constants, sums, products, quotients, powers (`x^n`, `a^x`,
`e^u`, roots), the trig, inverse trig and hyperbolic families, `ln`,
`log_a`, `|u|`, and the chain rule through all of them; `x^x` is left as it
is (it needs logarithmic differentiation).

Each differentiation step replaces one derivative with smaller ones. The
product rule is the clearest case: one derivative becomes two, each wrapping
something simpler than what it started with.

```
d/dx( x² · sin x )                        x 2 ^ x sin * x der

1. Product rule       x 2 ^ x der x sin * x 2 ^ x sin x der * +     <- two derivatives now
2. Power rule                 2 x 1 ^ * x sin * x 2 ^ x sin x der * +
3. Derivative of sine         2 x 1 ^ * x sin * x 2 ^ x cos x x der * * +
4. Derivative of the variable 2 x 1 ^ * x sin * x 2 ^ x cos 1 * * +

then switch to Simplify:      2 x * x sin * x 2 ^ x cos * +
```

That is why the two modes are separate: differentiating to completion first,
then tidying, gives a trace you can read. Interleaving them does not.

Because the variable is a slot rather than a fixed letter, the same rules do
d/dt: `t 2 ^ t der` gives `2t`. The `freeOf` and `dependsOn` relations are what
make that work — they ask whether one operand mentions whatever the variable
slot bound to, which a predicate taking a literal token cannot do.

Rules sharing a structure key are separated by their requirements, and priority
picks the one that reads better:

| expression | key | fires | why |
| --- | --- | --- | --- |
| `3 x 2 ^ * x der` | `_ _ * _ der` | constant multiple | `3` is free of `x`; outranks the product rule |
| `x sin x cos * x der` | `_ _ * _ der` | product rule | both sides depend on `x` |
| `x 2 ^ x der` | `_ _ ^ _ der` | power rule | base *is* the variable |
| `2 x ^ x der` | `_ _ ^ _ der` | constant to a power | base is free of `x` |
| `x x ^ x der` | `_ _ ^ _ der` | nothing | needs logarithmic differentiation |
| `2 3 ^ x der` | `_ _ der` | constant | priority 10 beats the deeper power rule |

Differentiation always terminates: every rule strictly shrinks what sits under
a `der`, and running to a fixed point removes them all.

## Using it

```js
import { RuleSet, parse, findMatches, simplify } from '@mathzetta/cas/engine';
import { readFileSync } from 'node:fs';

// The shipped rule files (in a browser, fetch them); a RuleSet can hold several modes.
const load = (name) => RuleSet.fromYaml(readFileSync(new URL(import.meta.resolve(`@mathzetta/cas/rules/${name}.yaml`)), 'utf8'));
const S = load('arithmetic').view('simplify');      // one mode's rules, indexed on their own
const D = load('calculus').view('differentiate');

// What could apply, and where?
for (const m of findMatches('x 0 + 2 *', S)) {
  console.log(m.rule.name, m.node.s, '->', m.after.s, '|', m.explanation);
}

// Run to a fixed point.
const out = simplify(parse('3 4 5 6 - * +'), S);
out.expr.s;                        // '-1'
out.steps.map(s => s.explanation); // one sentence per step
out.stopped;                       // 'fixpoint' | 'cycle' | 'maxSteps'

// Differentiate to completion, then tidy — the two modes in sequence.
const d = simplify(parse('x 2 ^ x sin * x der'), D, { order: 'pre' });
simplify(d.expr, S).expr.s;        // '2 x * x sin * x 2 ^ x cos * +'
```

Each view carries its own key index and depth cap, so simplification rules cost
nothing while differentiating and vice versa.

`order: 'post'` (the default) rewrites innermost-first; `'pre'` goes
outermost-first. Both reach the same place with these rules, by different
routes.

**Rulesets are not guaranteed to terminate.** Commutativity and distribution
will happily rewrite in circles. `simplify` guards with a step cap and a
visited-set of canonical expression strings, and reports `stopped: 'cycle'`
rather than hanging.

## The two pages

[mathzetta.com/cas/](https://mathzetta.com/cas/) has a playground (enter an
expression, see every rule that applies and where, apply them one at a time or run to a fixed point,
read the step-by-step explanation, with the structure keys it is looked up under) and a rule editor
(build a rule with live feedback: which keys it lands under, which rules share them, whether it fires
on your samples; Download writes the ruleset back out as YAML).

## Layout

```
src/index.js       the engine's exports ('@mathzetta/cas/engine'); src/cas/index.js is '@mathzetta/cas'
src/ops.js         operator registry: arity, commutativity, numeric folding
src/expr.js        nodes and postfix parsing; every node caches its canonical
                   text, which doubles as structural identity
src/keys.js        collapse-key generation (the core idea)
src/predicates.js  the requirement vocabulary
src/rule.js        rule spec -> structure keys + slot bindings
src/ruleset.js     the key -> rules index
src/match.js       binding slots and checking requirements
src/apply.js       building the replacement, numeric folding, explanations
src/simplify.js    stepping and running to a fixed point
src/yaml.js        small YAML reader/writer (no dependencies; also '@mathzetta/cas/yaml')
src/types.d.ts     the TypeScript declarations
src/cas/           the CAS: form.js (the normal form: exact fractions, like terms, roots),
                   rules.js (loading rule files, the rewrite driver), steps.js, poly.js
                   (expand, factor, cancel), solve.js, integrate.js, approx.js, rational.js,
                   text.js, default-rules.js (rules/ bundled; npm run build:rules)
rules/             arithmetic.yaml and calculus.yaml (the engine's two modes);
                   cas/*.yaml (what the CAS knows about functions), cas/complex/ (complex: true)
docs/cas.md        the CAS guide
```

## Working on it

```bash
npm test              # the engine, the shipped rules and the CAS (mathzetta, a dev dependency, reads the CAS tests' inputs)
npm run check:sympy   # the CAS against SymPy (python3 with sympy)
npm run build:rules   # after editing rules/*.yaml: regenerates src/cas/default-rules.js (a test fails if it is stale)
```

## Notation

Input is postfix, whitespace separated: `3 4 5 6 - * +`. Any token that is not
a registered operator is an operand, so `3`, `-2`, `x` and `theta` all work; `=pi`
in a rule pattern is the literal symbol π.

The built-in operators are MathZetta's, with the same names and arities:

```
binary    + - * / ^ mod root log _ der round atan2 perm comb  = ≠ < > ≤ ≥ ≈ ∈ ∉ ∪ ∩ & | …
unary     neg abs floor ceil sqrt ! ln sin cos tan csc sec cot sinh cosh tanh
          arcsin arccos arctan arcsinh arccosh arctanh expm1 …
ternary   ?: (a piecewise choice)
variadic  int lim max min gcd sum prod, and the groups () [] {} — a count comes first: a b c 3 max
```

`der` is d/dx (`u x der`), and e^u is `e u ^` (there is no `exp`). `\:name` is a function of
your own: `x 1 \:f` is f(x). Add operators with `defineOperator`; `operators()` lists them.

Division and powers fold only when the result stays exact, so `1/3` and `2^0.5`
survive as they are instead of turning into floats. `der` never folds at all.

## Rule files

`rules/arithmetic.yaml` and `rules/calculus.yaml` are the shipped rules; the playground loads and
merges both. The authored files stay the source of truth.
