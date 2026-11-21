// The CAS (src/cas): exact answers, steps, customizing, and property checks
// against MathZetta's evaluate (simplified = original, d/dx by finite differences,
// d/dx ∫ f = f, every solution satisfies its equation).

import { readFileSync } from 'node:fs';
import { suite, test, equal, assert, deepEqual, throws } from './harness.js';
import { parse as mz } from 'mathzetta';
import { evaluate } from 'mathzetta/evaluate';
import { createCAS, approximate } from '../src/cas/index.js';
import { bundle } from '../tools/bundle-rules.mjs';
import { parse } from '../src/index.js';

const cas = createCAS({ read: (t) => mz(t) });
const text = (r) => r.text;

const table = (name, fn, rows) => suite(name, () => {
  for (const [input, want, ...rest] of rows) test(`${input} → ${want}`, () => equal(fn(input, ...rest), want));
});

table('cas: the normal form (exact arithmetic, like terms)', (x) => text(cas.simplify(x, { steps: false })), [
  ['2x + 3x', '5x'],
  ['x x^2', 'x^3'],
  ['sqrt(72)', '6sqrt(2)'],
  ['sqrt(2) sqrt(3)', 'sqrt(6)'],
  ['sqrt(12) + sqrt(27)', '5sqrt(3)'],
  ['\\sqrt[3]{-8}', '-2'],
  ['8^(2/3)', '4'],
  ['1/sqrt(2)', 'sqrt(2)/2'],
  ['1/3 + 1/6', '1/2'],
  ['0.1 + 0.2', '3/10'],
  ['2^100', '1267650600228229401496703205376'],
  ['x/2 + x/3', '5x/6'],
  ['2(x + 1)', '2x + 2'],
  ['a - (a - b)', 'b'],
  ['(2x)^3', '8x^3'],
  ['e^x e^y', 'e^(x + y)'],
  ['|-2x|', '2|x|'],
  ['25!', '15511210043330985984000000'],
  ['log_2(8) + log_10(0.001)', '0'],
  ['log_8(4)', '2/3'],
]);

// matrices and det are carried, not rewritten: they read, and like terms still combine
table('cas: matrices and det', (x) => text(cas.simplify(x, { steps: false })), [
  ['det(A) + det(A)', '2det(A)'],
  ['\\det(A) + 1', 'det(A) + 1'],
  ['det([[1,2],[3,4]])', 'det([[1, 2], [3, 4]])'],
]);

table('cas: simplify with rules', (x) => text(cas.simplify(x, { steps: false })), [
  ['sin(pi/6)', '1/2'],
  ['sin(7pi/6)', '-1/2'],
  ['cos(2pi/3)', '-1/2'],
  ['tan(5pi/4)', '1'],
  ['cos(-pi/3)', '1/2'],
  ['sin(-x)', '-sin(x)'],
  ['sin(x)^2 + cos(x)^2', '1'],
  ['3 sin(x)^2 + 3cos(x)^2 + 1', '4'],
  ['sin(x)^2 + cos(x)^2 + x', 'x + 1'],
  ['ln(e^(2x))', '2x'],
  ['e^(ln x)', 'x'],
  ['sqrt(x^2)', '|x|'],
  ['sin(x)/cos(x)', 'tan(x)'],
  ['arcsin(1/2) + arctan(1)', '5π/12'],
  ['|e - 3|', '-e + 3'],
  ['(x^2 - 1)/(x - 1)', 'x + 1'],
  ['(x + 1)^2 - x^2', '2x + 1'],
]);

table('cas: expand, factor, cancel', (x, how) => text(cas[how](x, { steps: false })), [
  ['(x + 1)^2', 'x^2 + 2x + 1', 'expand'],
  ['(a + b)^3', 'a^3 + 3a^2·b + 3a·b^2 + b^3', 'expand'],
  ['(sqrt(2) + 1)^2', '2sqrt(2) + 3', 'expand'],
  ['x^2 - 5x + 6', '(x - 2)·(x - 3)', 'factor'],
  ['x^2 - 1', '(x - 1)·(x + 1)', 'factor'],
  ['2x^2 + 4x + 2', '2·(x + 1)^2', 'factor'],
  ['6x^2 + 9x', '3x·(2x + 3)', 'factor'],
  ['x^4 - 1', '(x - 1)·(x + 1)·(x^2 + 1)', 'factor'],
  ['x^3 + 8', '(x + 2)·(x^2 - 2x + 4)', 'factor'],
  ['4x^2 - 9y^2', '(2x - 3y)·(2x + 3y)', 'factor'],
  ['2x^2 - x - 1', '(2x + 1)·(x - 1)', 'factor'],
  ['1 - x', '-(x - 1)', 'factor'],
  ['x^2 + 1', 'x^2 + 1', 'factor'],
  ['(x^2 - 1)/(2x - 2)', '(x + 1)/2', 'cancel'],
  ['1/x + 1/y', '(x + y)/(x·y)', 'cancel'],
  ['x/(x^2 + x)', '1/(x + 1)', 'cancel'],
]);

table('cas: derivatives', (x) => text(cas.diff(x, 'x', { steps: false })), [
  ['x^3', '3x^2'],
  ['x^2 sin(x)', 'x^2·cos(x) + 2x·sin(x)'],
  ['e^(2x)', '2e^(2x)'],
  ['ln(x^2 + 1)', '2x/(x^2 + 1)'],
  ['sqrt(x)', '1/(2sqrt(x))'],
  ['1/x', '-1/x^2'],
  ['(x + 1)/(x - 1)', '-2/(x - 1)^2'],
  ['a x^2 + b x', '2a·x + b'],
  ['x^x', 'x^x·(ln(x) + 1)'],
  ['\\sqrt[3]{x}', '1/(3x^(2/3))'],
  ['arctan(2x)', '2/(4x^2 + 1)'],
  // the inverses of sec, csc and cot (MathZetta 1.2 reads \sec^{-1} x as arcsec x)
  ['arcsec(x)', '1/(|x|·sqrt(x^2 - 1))'],
  ['arccsc(x)', '-1/(|x|·sqrt(x^2 - 1))'],
  ['arccot(x)', '-1/(x^2 + 1)'],
  ['\\cot^{-1}(x^2)', '-2x/(x^4 + 1)'],
]);

table('cas: integrals', (x) => text(cas.integrate(x, 'x', { steps: false })), [
  ['x^2', 'x^3/3'],
  ['3x^2 + 2x + 1', 'x^3 + x^2 + x'],
  ['1/x', 'ln(|x|)'],
  ['cos(3x + 1)', 'sin(3x + 1)/3'],
  ['e^(2x)', 'e^(2x)/2'],
  ['x e^x', 'x·e^x - e^x'],
  ['x^2 e^x', 'x^2·e^x - 2x·e^x + 2e^x'],
  ['x sin(x)', '-x·cos(x) + sin(x)'],
  ['ln(x)', 'x·ln(x) - x'],
  ['x ln(x)', 'x^2·ln(x)/2 - x^2/4'],
  ['1/(x^2 + 1)', 'arctan(x)'],
  ['sqrt(x)', '2x^(3/2)/3'],
  ['tan(x)', '-ln(|cos(x)|)'],
  ['\\int_0^1 x^2 dx', '1/3'],
  ['\\int_0^{pi} sin(x) dx', '2'],
  ['\\int_1^e 1/x dx', '1'],
  ['\\int_0^1 x e^x dx', '1'],
]);

table('cas: solving', (x) => text(cas.solve(x, 'x', { steps: false })), [
  ['2x + 3 = 7', 'x = 2'],
  ['3x - 5 = x + 1', 'x = 3'],
  ['x/2 = 3', 'x = 6'],
  ['x^2 = 4', 'x = -2 or x = 2'],
  ['x^2 = 2', 'x = -sqrt(2) or x = sqrt(2)'],
  ['x^2 - 5x + 6 = 0', 'x = 2 or x = 3'],
  ['x^2 + x - 1 = 0', 'x = -sqrt(5)/2 - 1/2 or x = sqrt(5)/2 - 1/2'],
  ['x^2 + 1 = 0', 'no solution'],
  ['x^3 - 6x^2 + 11x - 6 = 0', 'x = 1 or x = 2 or x = 3'],
  ['x^4 - 5x^2 + 4 = 0', 'x = -2 or x = -1 or x = 1 or x = 2'],
  ['x^3 = -8', 'x = -2'],
  ['e^x = 5', 'x = ln(5)'],
  ['ln(x) = 2', 'x = e^2'],
  ['2^x = 8', 'x = 3'],
  ['sqrt(x) = 3', 'x = 9'],
  ['sqrt(x) = -1', 'no solution'],
  ['sqrt(x + 1) = x - 1', 'x = 3'],
  ['sqrt(x) + x = 6', 'x = 4'],
  ['|x - 1| = 3', 'x = -2 or x = 4'],
  ['|2x - 1| = x + 2', 'x = -1/3 or x = 3'],
  ['sin(x) = 1/2', 'x = π/6 or x = 5π/6'],
  ['1/x = 4', 'x = 1/4'],
  ['3/(x - 1) = 2', 'x = 5/2'],
  ['(x - 1)/(x + 2) = 0', 'x = 1'],
  ['x ln(x) = 0', 'x = 1'],
  ['e^(2x) - 3e^x + 2 = 0', 'x = 0 or x = ln(2)'],
  ['a x + b = 0', 'x = -b/a'],
  ['x = x + 1', 'no solution'],
  ['2(x + 1) = 2x + 2', 'true for every x'],
  ['x^5 + x + 1 = 0', 'no exact solution found for x'],
]);

suite('cas: systems, substitution, equivalence', () => {
  test('a linear system', () => {
    const r = cas.solveSystem(['x + y = 3', 'x - y = 1'], ['x', 'y']);
    equal(r.text, 'x = 2, y = 1');
  });
  test('a system with symbols on the right', () => equal(cas.solveSystem(['x + y = a', 'x - y = b'], ['x', 'y']).text, 'x = a/2 + b/2, y = a/2 - b/2'));
  test('no solution / many', () => {
    equal(cas.solveSystem(['x + y = 1', 'x + y = 2'], ['x', 'y']).status, 'none');
    equal(cas.solveSystem(['x + y = 1', '2x + 2y = 2'], ['x', 'y']).status, 'many');
  });
  test('substitute', () => equal(cas.substitute('x^2 + y', { x: 3, y: 'z + 1' }).text, 'z + 10'));
  test('a derivative at a point, der(f, x = a), is worked out wherever it is read', () => {
    equal(cas.simplify('der(x^3, x = 2)', { steps: false }).text, '12');
    equal(cas.simplify('der(x^3, x = a, 2) + 1', { steps: false }).text, '6a + 1');   // the second derivative at a
    equal(cas.expand('der((x + 1)^3, x = y)', { steps: false }).text, '3y^2 + 6y + 3');
    throws(() => cas.diff('x^3', 'x = 2'));   // a point is not a variable name
  });
  test('equivalent: exactly and numerically', () => {
    deepEqual(cas.equivalent('(x + 1)^2', 'x^2 + 2x + 1'), { equal: true, how: 'exact' });
    equal(cas.equivalent('sin(2x)', '2 sin(x) cos(x)').equal, true);
    equal(cas.equivalent('sin(2x)', '2 sin(x)').equal, false);
  });
  test('approximately: on a solve, and numeric roots when asked', () => {
    equal(cas.solve('x^2 = 2', 'x', { approximate: 10 }).text, 'x = -1.414213562 or x = 1.414213562');
    equal(cas.solve('x^5 + x + 1 = 0', 'x', { approximate: true }).text, 'x = -0.754877666246693');
  });
});

suite('cas: exact, or as many digits as asked', () => {
  const digits = (x, d) => approximate(parse(mz(x).join(' ')), { digits: d }).text;
  test('π to 60 digits', () => equal(digits('pi', 60), '3.14159265358979323846264338327950288419716939937510582097494'));
  test('√2 to 50', () => equal(digits('sqrt(2)', 50), '1.4142135623730950488016887242096980785696718753769'));
  test('e to 40', () => equal(digits('e', 40), '2.718281828459045235360287471352662497757'));
  test('e^(π√163) is nearly whole', () => equal(digits('e^(pi sqrt(163))', 30), '262537412640768743.999999999999'));
  test('the functions agree with doubles', () => {
    for (const x of ['sin(1)', 'cos(2.5)', 'tan(0.3)', 'ln(10)', 'e^-10', 'arctan(3)', 'arcsin(0.2)', 'arccos(-0.7)', 'sinh(1.5)', 'arctanh(0.5)', 'log_2(10)', '2^0.5', 'sin(100)']) {
      const got = Number(digits(x, 15));
      const want = evaluate(x);
      assert(Math.abs(got - want) <= 1e-14 * Math.max(1, Math.abs(want)), `${x}: ${got} vs ${want}`);
    }
  });
  test('exact stays exact', () => {
    equal(approximate(parse('1 4 /')).exact, true);
    equal(approximate(parse('1 3 /')).exact, false);
  });
  test('not real', () => throws(() => digits('ln(-1)', 10), 'not positive'));
  test('a result with unknowns keeps them', () => equal(cas.approximate('pi x', { digits: 6 }).text, '3.14159x'));
  test('on any call: { approximate }', () => equal(cas.integrate('\\int_0^1 e^x dx', null, { approximate: 8 }).text, '1.7182818'));
});

suite('cas: steps', () => {
  const steps = (s) => cas.diff('x^2 sin(3x)', 'x', { steps: s }).steps;
  test('every step chains: each starts where the last ended', () => {
    for (const option of [true, 'brief', 'full', { hide: ['split'] }, { show: ['chain'] }]) {
      const list = steps(option);
      for (let i = 1; i < list.length; i++) equal(list[i].from, list[i - 1].to, JSON.stringify(option));
      if (list.length) equal(list[list.length - 1].to, cas.diff('x^2 sin(3x)', 'x', { steps: false }).result.s);
    }
  });
  test('steps: false gives none', () => equal(steps(false).length, 0));
  test("brief hides the routine ones, and says what each shown one absorbed", () => {
    const full = steps(true);
    const brief = steps('brief');
    assert(brief.length < full.length, `${brief.length} vs ${full.length}`);
    assert(brief.some((s) => s.also?.length), 'a merged step lists what it absorbed');
  });
  test('explain: false, or a list', () => {
    assert(steps({ explain: false }).every((s) => s.explanation === undefined));
    const some = steps({ explain: ['chain'] });
    assert(some.some((s) => s.explanation) && some.some((s) => s.explanation === undefined));
  });
  test('explanations fill in the parts', () => {
    const r = cas.solve('3x = 6', 'x');
    equal(r.steps.at(-1).explanation, 'Divide both sides by 3.');
  });
  test('a step has a path into the expression before it (for Inline Math)', () => {
    const first = steps(true)[0];
    assert(Array.isArray(first.path), 'path');
  });
  test('a rejected answer says why', () => {
    const r = cas.solve('sqrt(x + 1) = x - 1', 'x');
    assert(r.steps.some((s) => s.id === 'solve.reject' && /0 is not a solution/.test(s.explanation)));
  });
  test('an unknown detail level is an error', () => throws(() => steps('short'), 'is not one of'));
});

suite('cas: your own rules', () => {
  const mine = `
operators:
  - { symbol: sinc, arity: 1 }
messages:
  solve.divide: "Share both sides between {by}."
rules:
  - id: d-sinc
    mode: differentiate
    pattern: u sinc v der
    output: u cos u / u sin u 2 ^ / - u v der *
  - { id: sinc-0, pattern: 0 sinc, output: "1" }
  - { id: sinc-definition, mode: define, pattern: u sinc, output: u sin u / }
  - { id: sin-pi-6, explain: "From the 30-60-90 triangle: sin 30° = 1/2." }
  - { id: sqrt-of-square, enabled: false }
`;
  // MathZetta reads an unknown function as \:sinc when told its name; the CAS maps it to the declared operator
  const custom = createCAS({ read: (t) => mz(t, { names: ['sinc'] }), rules: [mine] });
  test('a new function: its derivative, a value, a definition for approximating', () => {
    equal(custom.diff('sinc(2x)', 'x', { steps: false }).text, 'cos(2x)/x - sin(2x)/(2x^2)');
    equal(custom.simplify('sinc(0) + 1').text, '2');
    equal(custom.approximate('sinc(1)', { digits: 10 }).text, '0.8414709848');
  });
  test('a shipped rule reworded, by id alone', () => equal(custom.simplify('sin(pi/6)').steps[0].explanation, 'From the 30-60-90 triangle: sin 30° = 1/2.'));
  test('a shipped rule turned off', () => equal(custom.simplify('sqrt(x^2)').text, 'sqrt(x^2)'));
  test('a coded step reworded', () => equal(custom.solve('3x = 6', 'x').steps.at(-1).explanation, 'Share both sides between 3.'));
  test('the shipped CAS is untouched', () => equal(cas.simplify('sqrt(x^2)').text, '|x|'));
  test('a mode of your own', () => {
    const c = createCAS({ rules: ['rules:\n  - { id: swap, mode: mirror, pattern: a b +, output: b a - }\n'], defaults: false });
    // every result is in normal form: y - x is drawn -x + y
    equal(c.rewrite('x y +', 'mirror').text, '-x + y');
  });
  test('a bad rule file says what is wrong', () => throws(() => createCAS({ rules: ['rules:\n  - { id: bad, pattern: u v, output: u }\n'] }), 'rule "bad": bad pattern'));
  test('without defaults, nothing is known but arithmetic', () => equal(createCAS({ defaults: false }).simplify('2 3 + =pi sin +').text, 'sin(=pi) + 5'));
});

// ---- complex numbers ----------------------------------------------------------------------

const complexCas = createCAS({ complex: true, read: (t) => mz(t, { names: ['Re', 'Im', 'conj', 'arg'] }) });

table('cas, complex: arithmetic and functions', (x) => text(complexCas.simplify(x, { steps: false })), [
  ['i^2', '-1'],
  ['i^-1', '-i'],
  ['i^101', 'i'],
  ['(2+3i)(1-i)', '5 + i'],
  ['(1+i)^10', '32i'],
  ['1/(1+i)', '1/2 - i/2'],
  ['(3+4i)/(1-2i)', '-1 + 2i'],
  ['(1+i)/(1-i)', 'i'],
  ['sqrt(-4)', '2i'],
  ['sqrt(-8)', '2sqrt(2)i'],
  ['sqrt(3+4i)', '2 + i'],
  ['sqrt(-3-4i)', '1 - 2i'],
  ['x + 2 + 3i', 'x + 2 + 3i'],
  ['\\operatorname{Re}(3+4i)', '3'],
  ['\\operatorname{Im}(3 - 4i)', '-4'],
  ['conj((1+i)^3)', '-2 - 2i'],
  ['|3+4i|', '5'],
  ['arg(1 + i)', 'π/4'],
  ['arg(-1 - i)', '-3π/4'],
  ['e^(i pi) + 1', '0'],
  ['e^(1 + i pi/2)', 'e·i'],   // ei would read as a name
  ['ln(-1)', 'πi'],
  ['ln(i)', 'πi/2'],
  ['i^i', 'e^(-π/2)'],
]);

table('cas, complex: solving', (x) => text(complexCas.solve(x, 'x', { steps: false })), [
  ['x^2 + 1 = 0', 'x = -i or x = i'],
  ['x^2 + 2x + 5 = 0', 'x = -1 - 2i or x = -1 + 2i'],
  ['x^4 = 16', 'x = -2 or x = 2 or x = -2i or x = 2i'],
  ['x^3 = 1', 'x = 1 or x = -1/2 - sqrt(3)i/2 or x = -1/2 + sqrt(3)i/2'],
  ['x^3 = -8', 'x = -2 or x = 1 - sqrt(3)i or x = 1 + sqrt(3)i'],
  ['x^2 + i = 0', 'x = -sqrt(2)/2 + sqrt(2)i/2 or x = sqrt(2)/2 - sqrt(2)i/2'],
  ['(1+i) x = 2', 'x = 1 - i'],
  ['e^x = -1', 'x = πi'],
  ['x^2 - 5x + 6 = 0', 'x = 2 or x = 3'],
]);

suite('cas, complex: approximation, and real mode untouched', () => {
  const digits = (x, d = 15) => complexCas.approximate(x, { digits: d }).text;
  test('complex decimals', () => {
    equal(digits('e^(i)', 20), '0.5403023058681397174 + 0.84147098480789650665i');
    equal(digits('(1+i)^0.5', 12), '1.09868411347 + 0.455089860562i');
    equal(digits('cos(1+i)'), '0.833730025131149 - 0.988897705762865i');
    equal(digits('1/(1+2i)'), '0.2 - 0.4i');
    equal(digits('i^i'), '0.207879576350762');
    equal(digits('e^(i pi)'), '-1');
  });
  test('{ approximate } on a solve, and numeric complex roots', () => {
    equal(complexCas.solve('x^3 = 2', 'x', { approximate: 6 }).text, 'x = 1.25992 or x = -0.629961 - 1.09112i or x = -0.629961 + 1.09112i');
    const r = complexCas.solve('x^5 + x + 1 = 0', 'x', { approximate: 8 });
    equal(r.solutions.length, 5);
  });
  test('without complex: true, i is an unknown and √-4 is not real', () => {
    equal(cas.simplify('i^2').text, 'i^2');
    equal(cas.simplify('sqrt(-4)').text, 'sqrt(-4)');
    equal(cas.solve('x^2 + 1 = 0', 'x').text, 'no solution');
  });
  test('every complex solution satisfies its equation', () => {
    for (const e of ['x^2 - 2x + 10 = 0', 'x^3 + 27 = 0', 'x^4 - 81 = 0', 'x^2 + (1 - i) x - i = 0', '2 x^2 + 3 = 0']) {
      const r = complexCas.solve(e, 'x', { steps: false });
      assert(r.solutions.length >= 2, `${e}: ${r.text}`);
      const [l, rhs] = e.split('=').map((t) => mz(t));
      for (const s of r.solutions) {
        const at = (side) => complexCas.approximate(complexCas.substitute(side, { x: s }, { steps: false }).result, { digits: 20 });
        const a = at(l);
        const b = at(rhs);
        assert(Math.hypot(a.re - b.re, a.im - b.im) < 1e-9, `${e}: x = ${complexCas.format(s)} gives ${a.text} and ${b.text}`);
      }
    }
  });
});

suite('cas: the shipped rules bundle is current', () => {
  test('src/cas/default-rules.js matches rules/*.yaml (npm run build:rules)', () => {
    equal(readFileSync(new URL('../src/cas/default-rules.js', import.meta.url), 'utf8'), bundle());
  });
});

// ---- properties, against MathZetta's evaluate --------------------------------------------

const POINTS = [0.37, 0.81, 1.3, 2.2];
const near = (a, b) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const valueAt = (postfix, x) => evaluate(postfix.split(' '), { x, a: 1.7, b: -0.6, y: 0.9 });

suite('cas: properties', () => {
  const functions = ['x^3 - 2x', 'x^2 sin(x)', 'e^(2x) cos(x)', 'ln(x^2 + 1)', 'sqrt(x + 1)', '(x + 1)/(x - 3)', 'sin(x)^2', 'arctan(x/2)', 'x^x',
    'tan(x) + sec(x)', 'e^(-x^2)', '\\sqrt[3]{x^2 + 1}', '1/(x^2 + 2x + 2)', 'x ln(x)', 'arcsin(x/3)', 'cosh(x) sinh(x)', 'log_2(x + 3)', '|x - 1|'];
  test('simplify keeps the value', () => {
    for (const f of [...functions, '(x^2 - 1)/(x - 1)', 'sin(x)^2 + cos(x)^2 + x', '(x + 1)^3 - (x - 1)^3', 'sqrt(8x^2)/x']) {
      const r = cas.simplify(f, { steps: false }).result.s;
      const original = mz(f).join(' ');
      for (const x of POINTS) assert(near(valueAt(r, x), valueAt(original, x)), `${f} → ${cas.simplify(f).text} at ${x}`);
    }
  });
  test('derivatives match finite differences', () => {
    const h = 1e-5;
    for (const f of functions) {
      const d = cas.diff(f, 'x', { steps: false }).result.s;
      const original = mz(f).join(' ');
      for (const x of POINTS) {
        if (f === '|x - 1|' && Math.abs(x - 1) < 0.01) continue;
        const fd = (valueAt(original, x + h) - valueAt(original, x - h)) / (2 * h);
        assert(Math.abs(valueAt(d, x) - fd) < 1e-4 * Math.max(1, Math.abs(fd)), `d/dx ${f} = ${cas.diff(f, 'x').text} at ${x}: ${valueAt(d, x)} vs ${fd}`);
      }
    }
  });
  test('differentiating an antiderivative gives the integrand', () => {
    for (const f of ['x^4 - 3x + 2', 'sin(2x)', 'cos(x/3)', 'e^(3x - 1)', 'x^2 e^x', 'x cos(x)', '1/(2x + 1)', '(3x + 2)^4', 'x^2 ln(x)', 'sqrt(4x + 1)', '1/sqrt(x)', 'x arctan(x)', '5^x', 'sinh(2x)']) {
      const F = cas.integrate(f, 'x', { steps: false }).result;
      const back = cas.diff(F, 'x', { steps: false }).result.s;
      const original = mz(f).join(' ');
      for (const x of POINTS) assert(near(valueAt(back, x), valueAt(original, x)), `∫ ${f} = ${cas.format(F)}; its derivative at ${x}: ${valueAt(back, x)} vs ${valueAt(original, x)}`);
    }
  });
  test('every solution satisfies its equation', () => {
    for (const e of ['x^2 - 3x - 10 = 0', '2x^2 + 3x - 4 = 0', 'x^3 - 7x + 6 = 0', 'e^(x + 1) = 7', 'ln(2x - 1) = 1', 'sqrt(3x + 1) = x - 1', '5/(x + 1) = x - 3', 'cos(x) = 1/3', '10^x = 50', 'x^4 = 81']) {
      const r = cas.solve(e, 'x', { steps: false });
      assert(r.solutions.length > 0, `${e}: no solutions`);
      const [l, rhs] = e.split('=').map((s) => mz(s).join(' '));
      for (const s of r.solutions) {
        const x = approximate(s, { digits: 20 }).number;
        assert(near(valueAt(l, x), valueAt(rhs, x)), `${e}: x = ${cas.format(s)}`);
      }
    }
  });
});

// ---- integration methods and inequalities (2026-11-20) -------------------------------------------
suite('cas: more integration methods', () => {
  // each antiderivative is checked by differentiating it numerically, at points inside the integrand's domain
  const checked = (f, points = [0.31, 0.77, 1.21]) => {
    const F = cas.integrate(f, 'x', { steps: false }).result.s;
    const original = mz(f).join(' ');
    const h = 1e-5;
    for (const x of points) {
      const slope = (valueAt(F, x + h) - valueAt(F, x - h)) / (2 * h);
      assert(Math.abs(slope - valueAt(original, x)) < 1e-5 * Math.max(1, Math.abs(slope)), `∫ ${f} = ${cas.integrate(f, 'x').text}: slope ${slope} vs ${valueAt(original, x)} at ${x}`);
    }
  };
  test('u-substitution: ∫ f(g)·g′', () => {
    for (const f of ['x e^(x^2)', 'ln(x)/x', 'x/(x^2 + 1)', 'sin(x) cos(x)', 'sin(x)^2 cos(x)', 'x^2 cos(x^3)', 'e^(sqrt(x))/sqrt(x)', 'cos(x)/(1 + sin(x))', 'tan(x) sec(x)^2', 'x sqrt(x^2 + 1)']) checked(f);
    equal(cas.integrate('x e^(x^2)', 'x').text, 'e^x^2/2');
    equal(cas.integrate('ln(x)/x', 'x').text, 'ln(x)^2/2');
    const steps = cas.integrate('x e^(x^2)', 'x').steps.map((s) => s.id);
    assert(steps.includes('integrate.u-substitution') && steps.includes('integrate.back'), steps.join(', '));
  });
  test('odd powers of sin and cos, secⁿ and cscⁿ, sec, csc, cot', () => {
    for (const f of ['cos(x)^3', 'sin(x)^3', 'sin(x)^2 cos(x)^3', 'sin(x)^5', 'sec(x)', 'csc(x)', 'cot(x)', 'sec(x)^3', 'sec(x)^4', 'csc(x)^3', 'sec(x) tan(x)']) checked(f);
    equal(cas.integrate('sec(x)', 'x').text, 'ln(|sec(x) + tan(x)|)');
  });
  test('high odd powers: the substitution at once (sin⁴¹ x took 4 s), and a cap past degree 100', () => {
    for (const f of ['sin(x)^7', 'cos(x)^9 sin(x)^2', 'sin(x)^5 cos(x)^4']) checked(f);
    const start = Date.now();
    equal(cas.integrate('sin(x)^41', 'x', { steps: false }).text.startsWith('-cos(x)^41/41 + 20cos(x)^39/39'), true);
    assert(Date.now() - start < 1000, `sin^41 took ${Date.now() - start} ms`);
    const ids = cas.integrate('sin(x)^3', 'x').steps.map((s) => s.id);
    deepEqual(ids, ['integrate.odd-power', 'integrate.u-substitution', 'integrate.back']);
    throws(() => cas.integrate('sin(x)^103', 'x'));
  });
  test('e^(ax)·sin(bx) by parts twice; products of sines and cosines', () => {
    for (const f of ['e^x sin(x)', 'e^(2x) cos(3x)', 'sin(3x) cos(2x)', 'cos(3x) cos(x)', 'sin(2x) sin(5x)']) checked(f);
    equal(cas.integrate('e^x sin(x)', 'x').text, 'e^x·(-cos(x) + sin(x))/2');
  });
  test('√(c − kx²) and 1/√(c − kx²): a trig substitution', () => {
    for (const f of ['sqrt(1 - x^2)', 'sqrt(4 - x^2)', '1/sqrt(4 - x^2)', 'sqrt(9 - 4x^2)']) checked(f, [0.2, 0.5, 0.7]);
    equal(cas.integrate('1/sqrt(4 - x^2)', 'x').text, 'arcsin(x/2)');
  });
  test('fractions with an irreducible quadratic: ln and arctan', () => {
    for (const f of ['1/(x^2 + 4)', '1/(x^2 + 2x + 5)', '(x + 3)/(x^2 + 2x + 5)', '1/(x (x^2 + 1))', 'x^3/(x^2 + 1)', '(2x^2 + 1)/((x - 1)(x^2 + 1))', '1/(3x^2 + 2)']) checked(f, [0.31, 0.77, 1.71]);
    equal(cas.integrate('1/(x^2 + 4)', 'x').text, 'arctan(x/2)/2');
    equal(cas.integrate('x/(x^2 + 1)', 'x').text, 'ln(|x^2 + 1|)/2');
  });
  test('arctan x and arcsin x alone, by parts', () => {
    checked('arctan(x)');
    checked('arcsin(x)', [0.2, 0.5, 0.7]);
    equal(cas.integrate('arctan(x)', 'x').text, 'x·arctan(x) - ln(|x^2 + 1|)/2');
  });
  test('what has no elementary antiderivative is refused quickly', () => {
    for (const f of ['e^(x^2)', 'sin(x)/x', 'x^x', 'sqrt(1 + x^3)', 'sin(x^2)', '1/(x^5 + x + 1)']) {
      const start = Date.now();
      throws(() => cas.integrate(f, 'x'));
      assert(Date.now() - start < 500, `${f} took ${Date.now() - start} ms`);
    }
  });
  test('the methods already there give the same answers', () => {
    equal(cas.integrate('(2x + 3)/(x^2 + 3x + 2)', 'x').text, 'ln(|x + 1|) + ln(|x + 2|)');
    equal(cas.integrate('x^2 e^x', 'x').text, 'x^2·e^x - 2x·e^x + 2e^x');
    equal(cas.integrate('1/(x^2 - 1)', 'x').text, '-ln(|x + 1|)/2 + ln(|x - 1|)/2');
  });
});

suite('cas: inequalities', () => {
  const both = (s) => { const r = cas.solve(s); return `${r.text} | ${r.intervals}`; };
  test('polynomials, absolute values, fractions', () => {
    equal(both('x^2 - 4 > 0'), 'x < -2 or x > 2 | (-∞, -2) ∪ (2, ∞)');
    equal(both('x^2 - 4 <= 0'), '-2 ≤ x ≤ 2 | [-2, 2]');
    equal(both('|2x + 1| < 5'), '-3 < x < 2 | (-3, 2)');
    equal(both('|x - 3| >= 2'), 'x ≤ 1 or x ≥ 5 | (-∞, 1] ∪ [5, ∞)');
    equal(both('(x - 1)/(x + 2) >= 0'), 'x < -2 or x ≥ 1 | (-∞, -2) ∪ [1, ∞)', 'where the bottom is 0: never included');
    equal(both('1/x > 0'), 'x > 0 | (0, ∞)');
    equal(both('(x^2 - 9)/x <= 0'), 'x ≤ -3 or 0 < x ≤ 3 | (-∞, -3] ∪ (0, 3]');
    equal(both('x^3 - x >= 0'), '-1 ≤ x ≤ 0 or x ≥ 1 | [-1, 0] ∪ [1, ∞)');
    equal(both('(x - 1)(x - 2)(x - 3) < 0'), 'x < 1 or 2 < x < 3 | (-∞, 1) ∪ (2, 3)');
    equal(both('x^2 > 2'), 'x < -sqrt(2) or x > sqrt(2) | (-∞, -sqrt(2)) ∪ (sqrt(2), ∞)');
  });
  test('linear, chains, roots, logs and exponentials', () => {
    equal(both('2x + 3 > 7'), 'x > 2 | (2, ∞)');
    equal(both('-1 < 2x + 1 < 5'), '-1 < x < 2 | (-1, 2)');
    equal(both('3 <= 1 - 2x < 7'), '-3 < x ≤ -1 | (-3, -1]');
    equal(both('sqrt(x - 1) < 2'), '1 ≤ x < 5 | [1, 5)', 'only where the root has a value');
    equal(both('ln(x) > 1'), 'x > e | (e, ∞)');
    equal(both('e^x > 2'), 'x > ln(2) | (ln(2), ∞)');
    equal(both('1 < x < 3 < 5'), '1 < x < 3 | (1, 3)', 'a chain of any length');
    equal(both('0 < x < 2 < 1'), 'no solution | ∅', 'a link with no x that fails');
    equal(both('ln(x) < 100'), '0 < x < e^100 | (0, e^100)', 'a test point near e^100 (it was written 1.3e+43, unread)');
  });
  test('small numbers: no exponent in test points, no snapping to 0 between the points', () => {
    equal(both('x (x - 1/10000000) < 0'), '0 < x < 1/10000000 | (0, 1/10000000)');
    equal(both('x^2 + 1/10^15 > 0'), 'true for every x | (-∞, ∞)');
    equal(both('x^2 - 1/10^15 < 0'), '-sqrt(10)/100000000 < x < sqrt(10)/100000000 | (-sqrt(10)/100000000, sqrt(10)/100000000)');
  });
  test('where the functions have values: arcsin, arccos, arctanh, arccosh, fractional powers', () => {
    equal(both('arcsin(x) > -2'), '-1 ≤ x ≤ 1 | [-1, 1]');
    equal(both('arccos(x) > -1'), '-1 ≤ x ≤ 1 | [-1, 1]');
    equal(both('arctanh(x) < 0'), '-1 < x < 0 | (-1, 0)');
    equal(both('arccosh(x) > -1'), 'x ≥ 1 | [1, ∞)');
    equal(both('x^(1/2) > -1'), 'x ≥ 0 | [0, ∞)');
  });
  test('always, never, a single point, a touching root', () => {
    equal(both('x^2 + 1 > 0'), 'true for every x | (-∞, ∞)');
    equal(both('x^2 + 1 < 0'), 'no solution | ∅');
    equal(both('x^2 <= 0'), 'x = 0 | {0}');
    equal(both('(x - 1)^2 > 0'), 'x < 1 or x > 1 | (-∞, 1) ∪ (1, ∞)');
  });
  test('trig inequalities are left unsolved; other unknowns are refused', () => {
    const r = cas.solve('sin(x) > 1/2');
    equal(r.pieces, null);
    equal(r.text, 'no exact solution found for x');
    throws(() => cas.solve('x < y', 'x'));
  });
  test('1/x = 0 has no solution (it was a crash)', () => equal(cas.solve('1/x = 0').text, 'no solution'));
  test('the sign chart is a step', () => {
    const steps = cas.solve('|2x + 1| < 5').steps.map((s) => s.id);
    assert(steps.includes('solve.sign-chart'), steps.join(', '));
  });
});

suite('cas: limits', () => {
  const L = (s, ...rest) => cas.limit(s, ...rest).text;
  test('continuous: put the point in', () => {
    equal(L('\\lim_{x \\to 2} x^2 + 1'), '5');
    equal(L('\\lim_{x \\to 0} \\frac{\\arctan x}{x}'), '1');
  });
  test('0/0: cancel, or L\'Hôpital', () => {
    equal(L('\\lim_{x \\to 1} \\frac{x^2-1}{x-1}'), '2');
    equal(L('\\lim_{h \\to 0} \\frac{(2+h)^2 - 4}{h}'), '4');
    equal(L('\\lim_{x \\to 0} \\frac{\\sin x}{x}'), '1');
    equal(L('\\lim_{x \\to 0} \\frac{1 - \\cos x}{x^2}'), '1/2');
    equal(L('\\lim_{x \\to 0} \\frac{x^2}{1 - \\cos x}'), '2', 'the decimal value of 0/0 is not taken for 0');
    equal(L('\\lim_{x \\to 0} \\frac{\\sin 5x}{\\sin 2x}'), '5/2', 'sin 0 / sin 0 is not canceled to 1');
    equal(L('\\lim_{x \\to 3} \\frac{\\sqrt{x+1} - 2}{x - 3}'), '1/4');
    equal(L('\\lim_{x \\to 0} \\frac{\\tan 3x}{x}'), '3');
    const ids = cas.limit('\\lim_{x \\to 0} \\frac{\\sin x}{x}').steps.map((s) => s.id);
    assert(ids.includes('limit.lhopital'), ids.join(', '));
  });
  test('at ±∞: leading terms, highest powers, the conjugate', () => {
    equal(L('\\lim_{x\\to\\infty} \\frac{3x^2 + 1}{2x^2 - x}'), '3/2');
    equal(L('\\lim_{x\\to\\infty} \\frac{x^3}{x^2 + 1}'), '∞');
    equal(L('\\lim_{x\\to -\\infty} \\frac{x^3}{x^2 + 1}'), '-∞');
    equal(L('\\lim_{x\\to\\infty} \\frac{x}{x^2 + 1}'), '0');
    equal(L('\\lim_{x\\to\\infty} \\left(\\sqrt{x^2 + x} - x\\right)'), '1/2');
    equal(L('\\lim_{x\\to\\infty} \\left(x - \\sqrt{x^2 - 3x}\\right)'), '3/2');
    equal(L('\\lim_{n\\to\\infty} \\frac{n}{n+1}'), '1');
    equal(L('\\lim_{x\\to\\infty} \\arctan x'), 'π/2');
  });
  test('exponentials and logs: 0·∞, ∞/∞, 1^∞, 0^0, ∞^0', () => {
    equal(L('\\lim_{x\\to\\infty} x e^{-x}'), '0');
    equal(L('\\lim_{x\\to\\infty} \\frac{e^x}{x^2}'), '∞');
    equal(L('\\lim_{x \\to 0^+} x \\ln x'), '0');
    equal(L('\\lim_{x \\to 0^+} x^x'), '1');
    equal(L('\\lim_{x\\to\\infty} \\frac{\\ln x}{x}'), '0');
    equal(L('\\lim_{x\\to\\infty} \\left(1 + \\frac{1}{x}\\right)^x'), 'e');
    equal(L('\\lim_{x\\to\\infty} \\left(1 + \\frac{2}{x}\\right)^{3x}'), 'e^6');
    equal(L('\\lim_{x\\to\\infty} x^{1/x}'), '1');
    equal(L('\\lim_{x \\to 0} \\frac{e^x - 1}{x}'), '1');
    equal(L('\\lim_{x\\to -\\infty} e^x'), '0');
  });
  test('∞ − ∞ and the squeeze theorem', () => {
    equal(L('\\lim_{x \\to 0} \\left(\\frac{1}{x} - \\frac{1}{\\sin x}\\right)'), '0');
    equal(L('\\lim_{x \\to 1} \\left(\\frac{1}{x-1} - \\frac{2}{x^2-1}\\right)'), '1/2');
    equal(L('\\lim_{x \\to 0} x \\sin(1/x)'), '0');
    equal(L('\\lim_{x\\to\\infty} \\frac{2x + \\sin x}{x}'), '2');
  });
  test('one-sided limits, infinite limits, and none', () => {
    equal(L('\\lim_{x \\to 0^+} \\frac{1}{x}'), '∞');
    equal(L('\\lim_{x \\to 0^-} \\frac{1}{x}'), '-∞');
    equal(L('\\lim_{x \\to 0} \\frac{1}{x^2}'), '∞');
    equal(L('\\lim_{x \\to \\pi/2^-} \\tan x'), '∞');
    equal(L('1/x', 'x', 0, { side: 'right' }), '∞');
    const none = cas.limit('\\lim_{x \\to 0} \\frac{1}{x}');
    deepEqual([none.exists, none.text, none.reason], [false, 'does not exist', 'from the left it goes to -∞, from the right to ∞']);
    equal(cas.limit('\\lim_{x \\to 0} \\frac{|x|}{x}').exists, false);
    equal(cas.limit('\\lim_{x\\to\\infty} \\sin x').exists, false);
    equal(cas.limit('\\lim_{x \\to 0} \\sin(1/x)').exists, false);
  });
  test('a side with no real values: no limit from there, nor a two-sided one', () => {
    equal(L('ln(x)', 'x', 0, { side: 'left' }), 'does not exist');
    equal(L('ln(x)', 'x', 0), 'does not exist');
    equal(L('ln(x)', 'x', 0, { side: 'right' }), '-∞');
    equal(L('sqrt(x)', 'x', 0), 'does not exist');
    equal(L('sqrt(x)', 'x', 0, { side: 'right' }), '0');
    equal(L('sqrt(1 - x^2)', 'x', 1, { side: 'left' }), '0');
    equal(L('cbrt(x)', 'x', 0), '0', 'an odd root is real on both sides');
    equal(L('e^(1/x)', 'x', 0, { side: 'right' }), '∞', 'too large is not "not real"');
    equal(createCAS({ read: (t) => mz(t), complex: true }).limit('sqrt(-x)', 'x', 1).text, 'i', 'complex mode: values off the line are values');
  });
  test('logs to any base; letters of unknown sign are refused', () => {
    equal(L('\\log_{1/2} x', 'x', '∞'), '-∞');
    equal(L('\\log_{10}(100 \\sin(x) / x)', 'x', 0), '2');
    equal(L('\\log_2 x', 'x', 0, { side: 'right' }), '-∞');
    throws(() => cas.limit('a x', 'x', '∞'), 'sign of a');
    throws(() => cas.limit('x / a', 'x', '∞'), 'sign of a');
  });
  test('powers: only 1^∞, 0^0 and ∞^0 are indeterminate', () => {
    equal(L('(2 + 1/x)^x', 'x', '∞'), '∞');
    equal(L('(1/2 + 1/x)^x', 'x', '∞'), '0');
    equal(L('x^(1/x)', 'x', 0, { side: 'right' }), '0');
    equal(L('0^x', 'x', '∞'), '0');
    equal(cas.limit('0^x', 'x', '-∞').reason, '0 to a negative power has no value');
    equal(L('(1 + x)^(1/x)', 'x', 0), 'e', 'the exponent has no two-sided limit, the power has');
    deepEqual(cas.limit('(2 + 1/x)^x', 'x', '∞').steps.map((s) => s.id), []);
    const forms = (f, ...rest) => cas.limit(f, ...rest).steps.filter((s) => s.id === 'limit.exp-log').map((s) => s.explanation.match(/is (\S+):/)[1]);
    deepEqual(forms('(1 + 1/x)^x', 'x', '∞'), ['1^∞']);
    deepEqual(forms('x^x', 'x', 0, { side: 'right' }), ['0^0']);
    deepEqual(forms('(1 + x)^(1/x)', 'x', 0).length, 1, 'the abandoned try leaves no steps');
  });
  test('limits inside an expression: the full answer, and ∞ refused', () => {
    const r = cas.limit('\\lim_{x \\to 2} x^2 + 1');
    deepEqual([r.text, r.exists, r.infinite], ['5', true, false]);
    throws(() => cas.limit('\\lim_{x \\to 0^+} (1/x) + 1'), 'infinite');
  });
  test('a wrong answer is refused, not given: the check against numbers near the point', async () => {
    const { verify, pointOf } = await import('../src/cas/limit.js');
    const { sym, exactNum } = await import('../src/expr.js');
    const check = (f, to, claim, side = 0) => { try { verify(cas.node(f), 'x', pointOf(to), side, claim); return 'accepted'; } catch { return 'refused'; } };
    equal(check('-1/ln(x)', sym('∞'), { fin: cas.node('0') }), 'accepted', 'slow, but closing in');
    equal(check('1 + 9/x', sym('∞'), { fin: cas.node('0') }), 'refused');
    equal(check('100/x + 1', sym('∞'), { fin: cas.node('0') }), 'refused');
    equal(check('sin(x)/x', exactNum('0'), { fin: cas.node('2') }), 'refused');
    equal(check('1/x', exactNum('0'), { inf: -1 }, 1), 'refused');
  });
  test('improper integrals', () => {
    equal(cas.integrate('\\int_1^{\\infty} \\frac{1}{x^2} dx').text, '1');
    equal(cas.integrate('\\int_0^{\\infty} e^{-x} dx').text, '1');
    equal(cas.integrate('\\int_0^{\\infty} x e^{-x} dx').text, '1');
    equal(cas.integrate('\\int_{-\\infty}^{\\infty} \\frac{1}{1+x^2} dx').text, 'π');
    equal(cas.integrate('\\int_2^{\\infty} \\frac{1}{x \\ln(x)^2} dx').text, '1/ln(2)');
    throws(() => cas.integrate('\\int_1^{\\infty} \\frac{1}{x} dx'));   // diverges
    throws(() => cas.integrate('\\int_0^{\\infty} \\sin x \\, dx'));   // no limit
    equal(cas.integrate('\\int_0^1 \\ln x \\, dx').text, '-1');
  });
});

table('cas: trigonometric identities', (x) => text(cas.simplify(x, { steps: false })), [
  ['tan(x) cos(x)', 'sin(x)'],
  ['cot(x) sin(x)', 'cos(x)'],
  ['sec(x) cos(x)', '1'],
  ['tan(x)/sin(x)', 'sec(x)'],
  ['sec(x)/csc(x)', 'tan(x)'],
  ['1/sec(x)', 'cos(x)'],
  ['sec(x)^2 - tan(x)^2', '1'],
  ['1 + tan(x)^2', 'sec(x)^2'],
  ['csc(x)^2 - cot(x)^2', '1'],
  ['1 + cot(x)^2', 'csc(x)^2'],
  ['2 sin(x) cos(x)', 'sin(2x)'],
  ['cos(x)^2 - sin(x)^2', 'cos(2x)'],
  ['2 cos(x)^2 - 1', 'cos(2x)'],
  ['1 - 2 sin(x)^2', 'cos(2x)'],
  ['sin(2x)/(2 sin(x))', 'cos(x)'],
  ['sin(x)^2/(1 - cos(x))', 'cos(x) + 1'],
  ['(sin(x) + cos(x))^2', 'sin(2x) + 1'],
  ['sin(x)^4 - cos(x)^4', '-cos(2x)'],
  ['cos(x)^4 - sin(x)^4', 'cos(2x)'],
  ['sin(x)/(1 + cos(x)) + (1 + cos(x))/sin(x)', '2csc(x)'],
  ['cos(x)/(1 - sin(x)) - cos(x)/(1 + sin(x))', '2tan(x)'],
  ['(1 - cos(2x))/sin(x)', '2sin(x)'],
  ['cos(2x)/(cos(x) - sin(x))', 'cos(x) + sin(x)'],
  ['sin(x + pi/2)', 'cos(x)'],
  ['cos(x - pi/2)', 'sin(x)'],
  ['sin(pi - x)', 'sin(x)'],
  ['cos(pi + x)', '-cos(x)'],
  ['tan(x + pi)', 'tan(x)'],
  ['sin(pi/2 - x)', 'cos(x)'],
  ['tan(pi/2 - x)', 'cot(x)'],
  ['sin(pi/12)', '-sqrt(2)/4 + sqrt(6)/4'],
  ['sin(7pi/12)', 'sqrt(2)/4 + sqrt(6)/4'],
  ['tan(pi/12)', '-sqrt(3) + 2'],
  ['cos(pi/8)', 'sqrt(sqrt(2) + 2)/2'],
  ['sin(arccos(x))', 'sqrt(-x^2 + 1)'],
  ['tan(arcsin(x))', 'x/sqrt(-x^2 + 1)'],
  ['cos(arctan(x))', '1/sqrt(x^2 + 1)'],
  ['sin(2 arcsin(x))', '2x·sqrt(-x^2 + 1)'],
  ['cos(2 arctan(x))', '(-x^2 + 1)/(x^2 + 1)'],
  ['sin(x) cos(y) + cos(x) sin(y)', 'sin(x + y)'],
  ['sin(x) cos(y) - cos(x) sin(y)', 'sin(x - y)'],
  ['cos(x) cos(y) - sin(x) sin(y)', 'cos(x + y)'],
  ['sin(2x) cos(x) + cos(2x) sin(x)', 'sin(3x)'],
  // left as they are: nothing shorter
  ['sin(x) cos(x)', 'cos(x)·sin(x)'],
  ['tan(x)', 'tan(x)'],
  ['sin(x)^2', 'sin(x)^2'],
]);

suite('cas: trig identities hold', () => {
  test('every simplified form has its input\'s value', () => {
    for (const f of ['tan(x) + cot(x)', 'sin(x)^2 cos(x)^2', 'sin(x)^3 + sin(x) cos(x)^2', 'sin(x)/csc(x) + cos(x)/sec(x)', '(sec(x) - cos(x))/tan(x)', 'cos(3x)', 'sin(x + y) - sin(x - y)']) {
      const back = cas.simplify(f, { steps: false }).result.s;
      const original = mz(f).join(' ');
      for (const x of POINTS) assert(near(valueAt(back, x), valueAt(original, x)), `${f} → ${cas.simplify(f).text} at ${x}`);
    }
  });
  test('identities are proved exactly', () => {
    for (const [a, b] of [['sec(x)^2 - tan(x)^2', '1'], ['tan(x) + cot(x)', 'sec(x) csc(x)'], ['sin(x)^2/(1 - cos(x))', '1 + cos(x)'], ['cos(x)^4 - sin(x)^4', 'cos(2x)']]) {
      deepEqual(cas.equivalent(a, b), { equal: true, how: 'exact' }, `${a} = ${b}`);
    }
  });
  test('the trig shape is a step', () => {
    const ids = cas.simplify('sec(x)^2 - tan(x)^2').steps.map((s) => s.id);
    assert(ids.includes('simplify.trig'), ids.join(', '));
  });
});
