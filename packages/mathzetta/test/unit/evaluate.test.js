/**
 * evaluate(): doubles, as JavaScript computes them — arithmetic, the scope, sets, intervals, chains, the inverse
 * reciprocal trig functions, and where a double runs out.
 */
import { suite, test, eq, throws } from '../harness.js';
import { evaluate, parse } from '../../src/all.js';

const E = (s, scope) => evaluate(parse(s), scope);

const near = (actual, expected, label = '') => {
    if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-12 * Math.max(1, Math.abs(expected))) {
        throw new Error(`${label ? label + ': ' : ''}expected ≈ ${expected}, got ${actual}`);
    }
};

suite('evaluate: arithmetic, scope, membership', () => {
    test('arithmetic and functions', () => {
        eq(E('2+3*4'), 14);
        eq(E('2^3^2'), 512);
        eq(E('sqrt(16) + 5!'), 124);
        eq(E('log_2(8)'), 3);
        eq(E('\\binom{5}{2}'), 10);
    });
    test('variables come from the scope', () => eq(E('x^2+1', { x: 3 }), 10));
    test('membership', () => {
        eq(E('2 ∈ {1, 2}'), true);
        eq(E('1 ∈ (1, 2]'), false);
    });
    test('unknown variables and symbolic operators throw', () => {
        throws(() => E('x+1'), /No value for 'x'/);
        throws(() => E('der(x^2, x)', { x: 1 }), /Can't evaluate 'der'/);
    });
});

suite('evaluate: factorials and permutations at the limits of a double', () => {
    test('huge factorials are Infinity at once', () => {
        eq(E('171!'), Infinity);
        eq(E('1000000000!'), Infinity);
        eq(E('5!'), 120);
    });
    test('permutations do not overflow through n!', () => {
        eq(E('perm(200, 3)'), 200 * 199 * 198);
        eq(Number.isNaN(E('perm(3, 5)')), true);
    });
});

suite('evaluate: sets, intervals, chains', () => {
    const E = (s, scope) => evaluate(s, scope);
    test('number sets', () => {
        eq(E('2 ∈ ℝ'), true); eq(E('2.5 ∈ ℤ'), false); eq(E('0 ∈ ℕ'), false); eq(E('3 ∈ ℕ'), true);
        eq(E('2 ∈ ℚ'), true); eq(E('2 ∈ ℂ'), true); eq(E('2.5 ∉ ℤ'), true);
    });
    test('intervals, open and closed at each end', () => {
        eq(E('1 ∈ (0, 1)'), false); eq(E('1 ∈ (0, 1]'), true); eq(E('0 ∈ [0, 1)'), true); eq(E('0 ∈ (0, 1]'), false);
        eq(E('1 ∈ [0, 1]'), true); eq(E('x ∉ [0, 1]', { x: 2 }), true);
    });
    test('finite sets, union, intersection, congruence', () => {
        eq(E('5 ∉ {1,2,3}'), true); eq(E('{1,2} ∪ {2,3}'), [1, 2, 3]); eq(E('{1,2} ∩ {2,3}'), [2]);
        eq(E('7 ≡ 2 (mod 5)'), true); eq(E('7 (mod 5)'), 2);
    });
    test('± gives both values; loglog is ln ln, as every renderer and calculate()', () => {
        eq(E('5 ± 2'), [7, 3]);
        eq(Math.abs(E('loglog(100)') - Math.log(Math.log(100))) < 1e-12, true);
        eq(Math.abs(E('logloglog(10^10)') - Math.log(Math.log(Math.log(1e10)))) < 1e-12, true);
    });
    test('indexed sums and products over a finite range', () => {
        eq(E('sum(i^2, i=1, 5)'), 55); eq(E('\\prod_{k=1}^{4} k'), 24); eq(E('\\sum_{i=1}^{n} i', { n: 10 }), 55);
        throws(() => E('\\sum_{i=1}^{\\infty} i'), /over that range/);
    });
    test('a chain of comparisons is read as math', () => {
        eq(E('3 < x < 7', { x: 5 }), true); eq(E('3 < x < 7', { x: 10 }), false); eq(E('1 ≤ x ≤ 1', { x: 1 }), true);
    });
    test('refusals: a name with no value, a symbolic operation', () => {
        throws(() => E('x + 1'), /No value for 'x'/);
        throws(() => E('der(x^2, x)', { x: 2 }), /Can't evaluate 'der'/);
    });
});

suite('evaluate: arcsec, arccsc, arccot', () => {
    test('arcsec(u) = arccos(1/u)', () => {
        near(evaluate('arcsec(2)'), Math.PI / 3);
        near(evaluate('arcsec(-2)'), 2 * Math.PI / 3);
        near(evaluate('arcsec(1)'), 0);
    });
    test('arccsc(u) = arcsin(1/u)', () => {
        near(evaluate('arccsc(2)'), Math.PI / 6);
        near(evaluate('arccsc(-2)'), -Math.PI / 6);
    });
    test('arccot runs from 0 to π (π/2 − arctan u), as in calculus books', () => {
        near(evaluate('arccot(1)'), Math.PI / 4);
        near(evaluate('arccot(-1)'), 3 * Math.PI / 4);
        near(evaluate('arccot(0)'), Math.PI / 2);
    });
    test('outside the domain: NaN', () => {
        eq(Number.isNaN(evaluate('arcsec(0.5)')), true);
    });
});

suite('evaluate: text search and sums past 2^53', () => {
    test('a list is still searched for a member, in evaluate', () => {
        eq(evaluate('"a" in L', { L: ['a', 'b'] }), true);
        eq(evaluate('"A" in L', { L: ['a', 'b'] }), false);
    });
    test('evaluate: a sum whose index is past 2^53 is refused at once (i++ stood still there)', () => {
        const t = Date.now();
        throws(() => evaluate('\\sum_{n=10^{20}}^{10^{20}} n'), /over that range/);
        throws(() => evaluate('\\prod_{n=-10^{17}}^{5} n'), /over that range/);
        eq(Date.now() - t < 50, true);
        eq(evaluate('\\sum_{n=1}^{10} n'), 55);
        eq(evaluate('\\sum_{n=-3}^{3} n^2'), 28);
    });
});
