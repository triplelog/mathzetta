import { suite, test, assert, equal, deepEqual, throws } from './harness.js';
import {
  parse, format, depth, walk, replaceAt, at, num, sym, op,
  keysAt, collapsings, shapeKey, SLOT,
  compileRule, RuleSet,
  matchNode, findMatches, step, simplify, simplifyText,
  foldNumeric, instantiate,
  parseYaml, stringifyYaml,
  definePredicate, getPredicate,
} from '../src/index.js';

/* ============================ expressions ============================ */

suite('expr', () => {
  test('parses postfix into a tree', () => {
    const e = parse('3 4 5 6 - * +');
    equal(e.op, '+');
    equal(e.args[0].s, '3');
    equal(e.args[1].s, '4 5 6 - *');
    equal(depth(e), 3);
  });

  test('round-trips through canonical text', () => {
    equal(format(parse('3 4 5 6 - * +')), '3 4 5 6 - * +');
    equal(parse('  x   y  +  ').s, 'x y +');
  });

  test('treats non-operator tokens as operands', () => {
    const e = parse('x -2 *');
    equal(e.args[0].type, 'sym');
    equal(e.args[1].value, -2);
  });

  test('normalizes numeric spellings so 3.0 and 3 are the same subtree', () => {
    equal(parse('3.0').s, parse('3').s);
  });

  test('unary operators work', () => {
    equal(parse('x neg neg').s, 'x neg neg');
    equal(depth(parse('x neg neg')), 2);
  });

  test('rejects malformed postfix', () => {
    throws(() => parse('3 +'), 'needs 2 operand');
    throws(() => parse('3 4'), 'leaves 2 values');
    // The usual cause is an unregistered operator, so the message names it.
    throws(() => parse('x foo x der'), 'Read as operands: x, foo');
    throws(() => parse(''), 'empty');
  });

  test('replaceAt rebuilds only the path', () => {
    const e = parse('3 4 5 6 - * +');
    const next = replaceAt(e, [1, 1], num(9));
    equal(next.s, '3 4 9 * +');
    equal(e.s, '3 4 5 6 - * +', 'original untouched');
    equal(at(next, [1, 1]).s, '9');
  });

  test('walk order controls innermost vs outermost', () => {
    const pre = walk(parse('1 2 + 3 +'), 'pre').map((w) => w.node.s);
    const post = walk(parse('1 2 + 3 +'), 'post').map((w) => w.node.s);
    equal(pre[0], '1 2 + 3 +');
    equal(post[post.length - 1], '1 2 + 3 +');
    equal(post[0], '1');
  });
});

/* ============================== keys ================================= */

suite('keys', () => {
  test('produces exactly the collapsings from the design example', () => {
    // 3 + 4*(5-6) collapses three ways at the root.
    const keys = keysAt(parse('3 4 5 6 - * +'), 3).map((k) => k.key);
    deepEqual(keys, ['_ _ +', '_ _ _ * +', '_ _ _ _ - * +']);
  });

  test('slots line up with the subtrees they stand for', () => {
    const found = keysAt(parse('3 4 5 6 - * +'), 3).find((k) => k.key === '_ _ _ * +');
    deepEqual(found.slots.map((s) => s.s), ['3', '4', '5 6 -']);
  });

  test('depth cap bounds the blowup', () => {
    const e = parse('3 4 5 6 - * +');
    equal(keysAt(e, 1).length, 1);
    equal(keysAt(e, 2).length, 2);
    equal(keysAt(e, 3).length, 3);
    equal(keysAt(e, 9).length, 3, 'never exceeds the real depth');
  });

  test('a leaf has only the fully collapsed form', () => {
    deepEqual(collapsings(parse('x'), 3).map((c) => c.key), [SLOT]);
    equal(keysAt(parse('x'), 3).length, 0);
  });

  test('balanced depth-3 tree hits the documented 26 collapsings', () => {
    const e = parse('a b + c d + * e f + g h + * *');
    equal(collapsings(e, 3).length, 26);
  });

  test('shapeKey is the full-depth skeleton', () => {
    equal(shapeKey(parse('a b c + *')), '_ _ _ + *');
    equal(shapeKey(parse('x')), '_');
  });
});

/* ============================== rules ================================ */

suite('rule compilation', () => {
  test('indexes a rule under its pattern shape', () => {
    const r = compileRule({ id: 'x', pattern: 'a b +', output: 'a' });
    equal(r.bindings.length, 1);
    equal(r.bindings[0].key, '_ _ +');
    deepEqual(r.bindings[0].slots.map((s) => s.name), ['a', 'b']);
  });

  test('numeric pattern leaves become literal constraints, not slots', () => {
    const r = compileRule({ id: 'x', pattern: 'a 0 +', output: 'a' });
    deepEqual(r.slots, ['a']);
    equal(r.bindings[0].slots[1].literal, 0);
  });

  test('commutative rules register the mirrored operand order', () => {
    const r = compileRule({ id: 'x', pattern: 'a 0 +', output: 'a', commutative: true });
    equal(r.bindings.length, 2);
    deepEqual(r.bindings.map((b) => b.key), ['_ _ +', '_ _ +']);
    deepEqual(r.bindings[1].slots.map((s) => s.literal ?? s.name), [0, 'a']);
  });

  test('mirroring a nested operation changes the key itself', () => {
    const r = compileRule({ id: 'x', pattern: 'a b c + *', output: 'a', commutative: true });
    const keys = new Set(r.bindings.map((b) => b.key));
    assert(keys.has('_ _ _ + *'), 'original shape');
    assert(keys.has('_ _ + _ *'), 'mirrored shape is a different key');
  });

  test('identical operands do not produce a redundant mirror', () => {
    const r = compileRule({ id: 'x', pattern: 'a a +', output: 'a', commutative: true });
    equal(r.bindings.length, 1);
  });

  test('rejects requirements that name a missing slot', () => {
    throws(
      () => compileRule({ id: 'x', pattern: 'a b +', when: { q: ['isZero'] }, output: 'a' }),
      'not a slot',
    );
  });

  test('rejects unknown predicates and relations', () => {
    throws(() => compileRule({ id: 'x', pattern: 'a b +', when: { a: ['isBlue'] }, output: 'a' }), 'unknown requirement');
    throws(() => compileRule({ id: 'x', pattern: 'a b +', require: [['near', 'a', 'b']], output: 'a' }), 'unknown relation');
  });

  test('operator tokens in a pattern stay operators, so they cannot be slots', () => {
    // `neg` is parsed as the unary operator, which has nothing to consume.
    throws(() => compileRule({ id: 'x', pattern: 'neg b +', output: 'b' }), '"neg" at position 1 needs 1 operand');
  });

  test('flags output symbols that are not slots', () => {
    const r = compileRule({ id: 'x', pattern: 'a b +', output: 'a c +' });
    deepEqual(r.freeSymbols, ['c']);
  });
});

/* ============================= matching ============================== */

const RULES = `
rules:
  - id: add-zero
    pattern: a 0 +
    commutative: true
    output: a
    explain: "Adding 0 leaves {a} unchanged."
  - id: fold-add
    pattern: a b +
    when: { a: [isNumber], b: [isNumber] }
    output: a b +
    fold: true
    explain: "{a} + {b} = {result}."
  - id: sub-self
    pattern: a a -
    output: "0"
    explain: "{a} minus itself is 0."
  - id: distribute
    pattern: a b c + *
    output: a b * a c * +
    explain: "Share {a} across {b} and {c}."
`;

suite('matching', () => {
  const set = RuleSet.fromYaml(RULES);

  test('finds a rule through the collapsed key', () => {
    const m = matchNode(parse('x 0 +'), set);
    equal(m.length, 1);
    equal(m[0].rule.id, 'add-zero');
    equal(m[0].bound.a.s, 'x');
  });

  test('matches the mirrored order too', () => {
    const m = matchNode(parse('0 x +'), set);
    equal(m.length, 1);
    equal(m[0].bound.a.s, 'x');
  });

  test('an operand slot happily binds a whole subtree', () => {
    const m = matchNode(parse('x y * 0 +'), set);
    equal(m[0].bound.a.s, 'x y *');
  });

  test('repeated slot names demand structurally equal subtrees', () => {
    equal(matchNode(parse('x y * x y * -'), set).length, 1);
    equal(matchNode(parse('x y * x z * -'), set).length, 0);
  });

  test('requirements filter same-shape candidates', () => {
    // Same key "_ _ +" for both rules; only fold-add survives on numbers.
    const numeric = matchNode(parse('2 3 +'), set).map((m) => m.rule.id);
    deepEqual(numeric, ['fold-add']);
    const symbolic = matchNode(parse('x 3 +'), set).map((m) => m.rule.id);
    deepEqual(symbolic, []);
  });

  test('deeper rules match against deeper collapsings', () => {
    const m = matchNode(parse('2 x y + *'), set);
    equal(m.length, 1);
    equal(m[0].rule.id, 'distribute');
    equal(m[0].key, '_ _ _ + *');
  });

  test('findMatches reports every site with its path and result', () => {
    const zeros = findMatches(parse('x 0 + y 0 + *'), set).filter((m) => m.rule.id === 'add-zero');
    equal(zeros.length, 2);
    deepEqual(zeros.map((m) => m.path), [[0], [1]]);
    deepEqual(zeros.map((m) => m.result.s), ['x y 0 + *', 'x 0 + y *']);
  });

  test('a partly collapsed key lets one slot swallow a whole subexpression', () => {
    // "_ _ _ + *" also matches x*(y) where the x side is collapsed entire.
    const m = findMatches(parse('x 0 + y 0 + *'), set).find((r) => r.rule.id === 'distribute');
    equal(m.bound.a.s, 'x 0 +');
    equal(m.bound.b.s, 'y');
    equal(m.result.s, 'x 0 + y * x 0 + 0 * +');
  });

  test('explanations interpolate the bound operands', () => {
    equal(findMatches(parse('x y * 0 +'), set)[0].explanation, 'Adding 0 leaves x y * unchanged.');
    equal(findMatches(parse('2 3 +'), set)[0].explanation, '2 + 3 = 5.');
  });
});

/* ============================ application =========================== */

suite('applying', () => {
  const set = RuleSet.fromYaml(RULES);

  test('rewrites in place and leaves the rest of the tree alone', () => {
    const applied = step(parse('x 0 + y *'), set);
    equal(applied.expr.s, 'x y *');
    equal(applied.rule.id, 'add-zero');
  });

  test('fold evaluates the produced expression', () => {
    equal(step(parse('2 3 +'), set).expr.s, '5');
  });

  test('fold leaves inexact results symbolic', () => {
    equal(foldNumeric(parse('1 3 /')).s, '1 3 /');
    equal(foldNumeric(parse('6 3 /')).s, '2');
    equal(foldNumeric(parse('2 0.5 ^')).s, '2 0.5 ^');
  });

  test('fold works bottom-up through a whole subtree', () => {
    equal(foldNumeric(parse('2 3 + 4 *')).s, '20');
  });

  test('instantiate builds the output from the bindings', () => {
    const rule = compileRule({ id: 'd', pattern: 'a b c + *', output: 'a b * a c * +' });
    const m = matchNode(parse('2 x y + *'), new RuleSet([rule]))[0];
    equal(instantiate(rule.outputTemplate, m.bound).s, '2 x * 2 y * +');
  });
});

/* ============================= simplify ============================== */

suite('simplify', () => {
  const set = RuleSet.fromYaml(RULES);

  test('runs to a fixed point and records each step', () => {
    const out = simplify(parse('2 x y + * 0 +'), set);
    equal(out.stopped, 'fixpoint');
    equal(out.expr.s, '2 x * 2 y * +');
    // Innermost first: the inner product is rewritten before the outer "+ 0".
    deepEqual(out.steps.map((s) => s.ruleId), ['distribute', 'add-zero']);
  });

  test('outermost order rewrites the root first instead', () => {
    const out = simplify(parse('2 x y + * 0 +'), set, { order: 'pre' });
    deepEqual(out.steps.map((s) => s.ruleId), ['add-zero', 'distribute']);
    equal(out.expr.s, '2 x * 2 y * +', 'same destination, different route');
  });

  test('innermost order rewrites the deepest site first', () => {
    const out = simplify(parse('1 2 + 3 + 4 +'), set);
    equal(out.expr.s, '10');
    equal(out.steps.length, 3);
  });

  test('leaves an expression alone when nothing applies', () => {
    const out = simplify(parse('x y +'), set);
    equal(out.expr.s, 'x y +');
    equal(out.steps.length, 0);
    equal(out.stopped, 'fixpoint');
  });

  test('detects a rule that loops instead of spinning forever', () => {
    const looping = RuleSet.fromSpecs([
      { id: 'swap', pattern: 'a b +', output: 'b a +' },
    ]);
    const out = simplify(parse('x y +'), looping, { maxSteps: 50 });
    equal(out.stopped, 'cycle');
    assert(out.steps.length <= 1, `stopped early, took ${out.steps.length} steps`);
  });

  test('honors the step budget', () => {
    const out = simplify(parse('1 1 + 1 + 1 + 1 +'), set, { maxSteps: 2 });
    equal(out.steps.length, 2);
    equal(out.stopped, 'maxSteps');
  });

  test('simplifyText is the one-liner form', () => {
    equal(simplifyText('x x - 0 +', set), '0');
  });
});

/* ============================ predicates ============================= */

suite('predicates', () => {
  const check = (name, text, ...args) => getPredicate(name).fn(parse(text), ...args);

  test('numeric predicates only fire on literals', () => {
    equal(check('isZero', '0'), true);
    equal(check('isZero', 'x'), false);
    equal(check('isPositiveInteger', '3'), true);
    equal(check('isPositiveInteger', '3.5'), false);
    equal(check('isEven', '-4'), true);
    equal(check('isOdd', '-3'), true);
  });

  test('unprovable claims are false, with an explicit looser alternative', () => {
    equal(check('isNonZero', 'x'), false, 'x is not provably non-zero');
    equal(check('isNotZeroLiteral', 'x'), true, 'but it is not a literal 0 either');
    equal(check('isNotZeroLiteral', '0'), false);
  });

  test('content predicates look through the whole subtree', () => {
    equal(check('contains', 'x 2 * 3 +', 'x'), true);
    equal(check('isFree', 'x 2 * 3 +', 'y'), true);
    equal(check('isNumeric', '2 3 + 4 *'), true);
    equal(check('isNumeric', '2 x +'), false);
    equal(check('hasSymbol', '2 x +'), true);
    equal(check('hasSymbol', '2 3 /'), false);
    equal(check('notOperation', 'x 2 +', '+'), false);
    equal(check('notOperation', 'x 2 *', '+'), true);
    equal(check('hasOperation', 'x 2 * 3 +', '*'), true);
  });

  test('custom predicates plug straight in', () => {
    definePredicate('isTau', (n) => n.type === 'sym' && n.token === 'tau');
    const set = RuleSet.fromSpecs([
      { id: 'tau', pattern: 'a b *', when: { b: ['isTau'] }, output: '6.28 a *' },
    ]);
    equal(simplifyText('3 tau *', set), '6.28 3 *');
  });
});

/* =============================== yaml ================================ */

suite('yaml', () => {
  test('reads block maps, sequences and flow collections', () => {
    const doc = parseYaml(`
name: demo
rules:
  - id: a
    pattern: a 0 +
    when: { a: [isNumber, [contains, "x"]] }
    output: a
  - id: b
    pattern: a a -
    require:
      - [sameAs, a, b]
    output: "0"
`);
    equal(doc.name, 'demo');
    equal(doc.rules.length, 2);
    deepEqual(doc.rules[0].when, { a: ['isNumber', ['contains', 'x']] });
    deepEqual(doc.rules[1].require, [['sameAs', 'a', 'b']]);
    equal(doc.rules[1].output, '0', 'quoted zero stays a string');
  });

  test('handles comments, booleans, numbers and nulls', () => {
    const doc = parseYaml(`
# leading comment
a: 1        # trailing
b: true
c: null
d: -2.5
e: "not # a comment"
f: 'it''s fine'
`);
    deepEqual(doc, { a: 1, b: true, c: null, d: -2.5, e: 'not # a comment', f: "it's fine" });
  });

  test('reads block scalars', () => {
    const doc = parseYaml(`
literal: |-
  line one
  line two
folded: >-
  wrapped text
  joined up
`);
    equal(doc.literal, 'line one\nline two');
    equal(doc.folded, 'wrapped text joined up');
  });

  test('accepts sequences at the key column', () => {
    deepEqual(parseYaml('rules:\n- id: a\n- id: b\n'), { rules: [{ id: 'a' }, { id: 'b' }] });
  });

  test('reports the line for malformed input', () => {
    throws(() => parseYaml('a: [1, 2\n'), 'line 1');
  });

  test('round-trips a ruleset through YAML', () => {
    const set = RuleSet.fromYaml(RULES);
    const again = RuleSet.fromYaml(set.toYaml());
    equal(again.size, set.size);
    deepEqual(again.toSpecs(), set.toSpecs());
  });

  test('quotes scalars that would otherwise change meaning', () => {
    const text = stringifyYaml({ a: '0', b: 'true', c: '', d: 'plain text', e: 'has: colon' });
    deepEqual(parseYaml(text), { a: '0', b: 'true', c: '', d: 'plain text', e: 'has: colon' });
  });
});

/* ============================== ruleset ============================== */

suite('ruleset', () => {
  test('maxDepth tracks the deepest pattern', () => {
    equal(RuleSet.fromYaml(RULES).maxDepth, 2);
    equal(RuleSet.fromSpecs([{ id: 'a', pattern: 'a b +', output: 'a' }]).maxDepth, 1);
  });

  test('rejects duplicate ids', () => {
    throws(() => RuleSet.fromSpecs([
      { id: 'a', pattern: 'a b +', output: 'a' },
      { id: 'a', pattern: 'a b -', output: 'a' },
    ]), 'duplicate rule id');
  });

  test('collects every compile error, not just the first', () => {
    const set = RuleSet.fromSpecs([
      { id: 'ok', pattern: 'a b +', output: 'a' },
      { id: 'bad1', pattern: 'a +', output: 'a' },
      { id: 'bad2', pattern: 'a b +', when: { z: ['isZero'] }, output: 'a' },
    ], { strict: false });
    equal(set.size, 1);
    equal(set.errors.length, 2);
  });

  test('disabling a rule takes it out of the index', () => {
    const set = RuleSet.fromYaml(RULES);
    equal(findMatches(parse('x 0 +'), set).length, 1);
    set.setEnabled('add-zero', false);
    equal(findMatches(parse('x 0 +'), set).length, 0);
    set.setEnabled('add-zero', true);
    equal(findMatches(parse('x 0 +'), set).length, 1);
  });

  test('keyReport shows which shapes are covered', () => {
    const report = RuleSet.fromYaml(RULES).keyReport();
    const byKey = Object.fromEntries(report.map((r) => [r.key, r.rules]));
    deepEqual(byKey['_ _ +'].sort(), ['add-zero', 'add-zero', 'fold-add']);
    deepEqual(byKey['_ _ _ + *'], ['distribute']);
  });
});
