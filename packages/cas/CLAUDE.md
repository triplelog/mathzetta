# CLAUDE.md — MathZetta CAS

Rule-driven rewriting of MathZetta postfix: differentiation and
simplification as YAML rules, matched by structure keys, and a CAS on top
(`@mathzetta/cas`, docs/cas.md). Zero dependencies; `mathzetta` is only a dev
dependency (the playground, the CAS tests, check:sympy).

```bash
npm test        # test/run.mjs — engine, rules, CAS (tables + property checks against mathzetta's evaluate)
npm run build:rules   # rules/calculus.yaml + rules/cas/*.yaml → src/cas/default-rules.js (a test fails if stale)
npm run check:sympy   # CAS answers vs real SymPy (python3 + sympy)
```

## Where things are

- `src/ops.js` — the operator registry. **Names and arities mirror MathZetta's table** (mathzetta/docs/postfix.md): `der`, `neg`, `e u ^` for e^u (no `exp`), counts before variadic operators, `\:name` for user functions. Add an operator here when MathZetta gains one.
- `src/expr.js` — nodes (`{ type: 'num'|'sym'|'op', token, args, s }`, `s` = canonical postfix string), `parse(text)`, `fromPostfix(tokens)`.
- `src/keys.js`, `src/match.js`, `src/apply.js`, `src/simplify.js` — the engine; `src/rule.js` compiles a rule; `src/predicates.js` the `when`/`require` vocabulary; `src/yaml.js` its own YAML parser.
- `rules/calculus.yaml`, `rules/arithmetic.yaml` — the shipped rules. Pattern notes at the top of arithmetic.yaml; `=e` in a pattern is the literal symbol e.
- The playground and rule editor (mathzetta.com/cas/) are in the private mathzetta-website repository.
- `src/cas/` — the CAS: `form.js` the normal form (exact BigInt fractions, like terms, roots of numbers — code, not rules), `rules.js` loading rule files (`operators:`, `messages:`, override by id) + CAS predicates + the rewrite driver, `steps.js` step selection, `poly.js` expand/factor/cancel, `solve.js`, `integrate.js`, `approx.js` (any-precision decimals), `index.js` createCAS + MESSAGES. `rules/cas/*.yaml` hold function knowledge (values, identities, integrals, isolate rules for solving, extra derivatives); `rules/cas/complex/` is added only by `createCAS({ complex: true })`.
- Complex mode is a flag (`settings.complex` in form.js, set around every CAS call by `withComplex`): `i` is the unit, the canon memo is keyed by mode. Anything that treats `i` specially must check the flag — off, `i` is an ordinary unknown.

## Rules

- A new export or option goes in `src/types.d.ts` and the entry's `.d.ts` (`src/index.d.ts`, `src/cas/index.d.ts`, `src/yaml.d.ts`); README examples are written against the published package (`from '@mathzetta/cas/engine'`), so keep them runnable.
- **Nothing runs away on a short input** (test/limits.test.js): polynomials past degree 256 (`MAX_DEGREE`, poly.js) aren't made dense; complex powers are multiplied out to the 60th; an exact power n^(a/s) too large for `MAX_BITS` stays as written; `approximate` refuses results past 4·MAX_BITS bits (exp, whole powers, factorials) with a CasError, takes roots past index 64 by logarithms, and calls residue that shrinks as precision grows 0.
- Structure keys are written like postfix: a variadic operator's count comes before it (`_ _ _ 3 max`). The engine folds +, -, *, neg and whole powers on the exact decimal tokens (apply.js), never on doubles.
- Postfix in, postfix out; nothing here evaluates transcendental functions (folds are exact-only).
- A rule file change must keep `npm test` green and `calcvidnew`'s pipeline test (it drives these rules).
- calcvidnew is the main consumer: it wraps input in `der` and runs `differentiate` then `simplify` with its own driver (`web/js/solver.js`).
- CAS rules match the normal form *as drawn* (x/2 is `x 2 /`, π/6 `=pi 6 /`, √x `x sqrt`); check a shape with `cas.normal(x).s`. Function knowledge goes in rules/cas/*.yaml, not code; a new rule gets a table row in test/cas.test.js. Derivatives the CAS adds go in rules/cas/derivatives.yaml (rules/calculus.yaml is shared with calcvidnew).
- Number tokens keep every digit (`exactNum`): `leaf('123456789012345678901')` is exact; `value` is the nearest double.
