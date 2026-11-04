// Checks the shipped ruleset actually behaves, in node only (needs fs).

import { readFileSync } from 'node:fs';
import { suite, test, equal, assert, deepEqual } from './harness.js';
import { RuleSet, simplify, simplifyText, findMatches, parse } from '../src/index.js';

const yaml = readFileSync(new URL('../rules/arithmetic.yaml', import.meta.url), 'utf8');

suite('rules/arithmetic.yaml', () => {
  const set = RuleSet.fromYaml(yaml);

  test('compiles cleanly', () => {
    assert(set.size > 15, `only ${set.size} rules loaded`);
    equal(set.name, 'Arithmetic and basic algebra');
  });

  const cases = [
    ['3 4 5 6 - * +', '-1'],
    ['x 0 +', 'x'],
    ['0 x +', 'x'],
    ['x 1 *', 'x'],
    ['1 x *', 'x'],
    ['x 0 *', '0'],
    ['x 0 -', 'x'],
    ['x x -', '0'],
    ['x x /', '1'],
    ['x neg neg', 'x'],
    ['x -1 *', 'x neg'],
    ['x x +', 'x 2 *'],
    ['x 2 * x 3 * +', 'x 5 *'],
    ['2 x * 3 x * +', 'x 5 *'],
    ['x 1 ^', 'x'],
    ['x 0 ^', '1'],
    ['1 2 + 3 4 + *', '21'],
    ['2 x 3 + *', '2 x * 6 +'],
    ['x y * 0 + 1 *', 'x y *'],
  ];

  for (const [input, expected] of cases) {
    test(`${input}  ->  ${expected}`, () => {
      const out = simplify(parse(input), set);
      equal(out.expr.s, expected, `stopped: ${out.stopped}`);
    });
  }

  test('every simplification terminates', () => {
    for (const [input] of cases) {
      const out = simplify(parse(input), set, { maxSteps: 40 });
      assert(out.stopped !== 'maxSteps', `${input} did not settle: ${out.expr.s}`);
    }
  });

  test('inexact division stays symbolic', () => {
    equal(simplifyText('1 3 /', set), '1 3 /');
  });

  test('does not invent a simplification for 0/0', () => {
    equal(simplifyText('0 0 /', set), '0 0 /');
  });

  test('explains its steps in words', () => {
    const out = simplify(parse('x 0 + 1 *'), set);
    deepEqual(out.steps.map((s) => s.explanation), [
      'Adding 0 changes nothing, so this is just x.',
      'Multiplying by 1 changes nothing, so this is just x.',
    ]);
  });

  test('mirrored bindings do not offer the same rewrite twice', () => {
    // Four commutative bindings fire here; they all produce x 5 *.
    const collect = findMatches(parse('x 2 * x 3 * +'), set).filter((m) => m.rule.id === 'collect-like-terms');
    equal(collect.length, 1);
    equal(collect[0].after.s, 'x 5 *');
  });

  test('offers every alternative at a branch point', () => {
    const matches = findMatches(parse('2 x 0 + *'), set);
    const ids = new Set(matches.map((m) => m.rule.id));
    assert(ids.has('add-zero'), 'should offer the inner cleanup');
  });

  test('round-trips through YAML without losing rules', () => {
    const again = RuleSet.fromYaml(set.toYaml());
    equal(again.size, set.size);
    for (const [input, expected] of cases) {
      equal(simplifyText(input, again), expected, `${input} after round-trip`);
    }
  });
});
