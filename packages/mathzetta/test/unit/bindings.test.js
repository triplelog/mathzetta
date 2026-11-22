// Bound names (common.js substitute / bindsName): [F]_a^b and y ∈ {x | P} put a value for a name, except where
// something inside binds that name again (∑_{x=…}, ∫ … dx, a set {x | …}). Values from evaluate and calculate,
// and the code outputs that write the substitution out.
import { suite, test, eq } from '../harness.js';
import { parse, evaluate, calculate, toJavaScript, toPython, toSQL } from '../../src/all.js';

const SUM_1_TO_3 = '(()=>{let sum = 0; let loopCount = 0; for (let x=1;x<=3;x++) {if (loopCount++ > 1000000){break};sum += x;}; return sum;})()';

suite('bindings: evaluation bars [F]_a^b', () => {
    const bar = '[x + \\sum_{x=1}^3 x]_0^1';   // the sum keeps its own x: (1 + 6) − (0 + 6)
    test('reads as evaluated', () => {
        eq(parse(bar), ['x', 'x', 'x', '1', '=', '3', '3', '\\sumidx', '+', 'x', '0', '1', 'evaluated']);
    });
    test('the inner sum keeps its x: the value is 1', () => {
        eq(evaluate(bar), 1);
        eq(calculate(bar).text, '1');
    });
    test('code writes the outer x only', () => {
        eq(toJavaScript(bar), `(1 + ${SUM_1_TO_3} - (0 + ${SUM_1_TO_3}))`);
        eq(toPython(bar), '(1 + sum(x for x in range(1, 3 + 1)) - (0 + sum(x for x in range(1, 3 + 1))))');
    });
    test('an integral with bounds inside a bar', () => {
        const s = '[x \\cdot \\int_0^1 x\\,dx]_0^2';   // 2·½ − 0·½
        eq(calculate(s).text, '1');
        eq(toPython(s), '(2 * scipy.integrate.quad(lambda x: x, 0, 1)[0] - 0 * scipy.integrate.quad(lambda x: x, 0, 1)[0])');
    });
    test('an indefinite integral inside a bar is refused where it cannot be worked out', () => {
        const s = '[\\int x\\,dx]_0^1';
        eq(parse(s), ['x', 'x', '2', 'int', 'x', '0', '1', 'evaluated']);
        eq(toPython(s, { sympy: true }), '(sympy.integrate(x, x) - sympy.integrate(x, x))');
        let refused = 0;
        for (const run of [() => calculate(s), () => evaluate(s), () => toJavaScript(s), () => toPython(s), () => toSQL(s)]) {
            try { run(); } catch { refused++; }
        }
        eq(refused, 5);
    });
    test('x \\int_0^1 x\\,dx is x times the integral (the command stays one after a name)', () => {
        eq(parse('x \\int_0^1 x\\,dx'), ['x', 'x', 'x', '0', '1', '4', 'int', '*']);
        eq(calculate('[x \\int_0^1 x\\,dx]_0^2').text, '1');
        eq(parse('x \\sum_{i=1}^3 i'), ['x', 'i', 'i', '1', '=', '3', '3', '\\sumidx', '*']);
        eq(parse('a \\frac{1}{2}'), ['a', '1', '2', '/', '*']);
    });
    test('a bound written in terms of the outer name is still substituted', () => {
        const s = '[\\sum_{x=1}^{x} x]_0^2';   // (1 + 2) − (empty sum)
        eq(evaluate(s), 3);
        eq(calculate(s).text, '3');
        eq(toPython(s), '(sum(x for x in range(1, 2 + 1)) - sum(x for x in range(1, 0 + 1)))');
        eq(new Function(`return ${toJavaScript(s)}`)(), 3);   // renderer output, as createRowEvaluator compiles it
        const t = '[\\int_0^x x\\,dx]_0^2';   // x²/2 from 0 to 2
        eq(calculate(t).text, '2');
        eq(toPython(t), '(scipy.integrate.quad(lambda x: x, 0, 2)[0] - scipy.integrate.quad(lambda x: x, 0, 0)[0])');
        eq(toPython(t, { sympy: true }), '(sympy.integrate(x, (x, 0, 2)) - sympy.integrate(x, (x, 0, 0)))');
    });
});

suite('bindings: set conditions y ∈ {x | P}', () => {
    const set = 'y ∈ \\{x \\mid x + \\sum_{x=1}^3 x > 7\\}';   // y + 6 > 7: the sum's x is its own
    test('reads as setbuilder', () => {
        eq(parse(set), ['y', 'x', 'x', 'x', 'x', '1', '=', '3', '3', '\\sumidx', '+', '7', '>', 'setbuilder', '∈']);
    });
    test('P with y for x, the sum left alone', () => {
        eq(evaluate(set, { y: 2 }), true);
        eq(evaluate(set, { y: 1 }), false);
        eq(calculate(set, { y: 2 }).value, true);
        eq(calculate(set, { y: 1 }).value, false);
    });
    test('code writes the condition', () => {
        eq(toJavaScript(set), `(y + ${SUM_1_TO_3} > 7)`);
        eq(toPython(set), '(y + sum(x for x in range(1, 3 + 1)) > 7)');
        eq(toPython(set, { sympy: true }), '(y + sympy.summation(x, (x, 1, 3)) > 7)');
    });
    test('a condition whose only x is bound does not depend on y', () => {
        const s = 'y ∈ \\{x \\mid \\sum_{x=1}^3 x > 0\\}';
        eq(evaluate(s, { y: -5 }), true);
        eq(calculate(s, { y: -5 }).value, true);
        eq(toPython(s), '(sum(x for x in range(1, 3 + 1)) > 0)');
    });
    test('∉, and {x ∈ S | P}', () => {
        eq(evaluate('y ∉ \\{x : x > 2\\}', { y: 2 }), true);
        eq(evaluate('y ∉ \\{x : x > 2\\}', { y: 3 }), false);
        eq(toSQL('y ∉ \\{x : x > 2\\}'), '(NOT (y > 2))');
        eq(evaluate('y ∈ \\{x ∈ ℤ \\mid x > 2\\}', { y: 3 }), true);
        eq(evaluate('y ∈ \\{x ∈ ℤ \\mid x > 2\\}', { y: 3.5 }), false);
        eq(toJavaScript('y ∈ \\{x ∈ ℤ \\mid x > 2\\}'), '((Number.isInteger(y) && y > 2))');
    });
    test('{x | P} in plain text braces is a set holding x or P, not set-builder', () => {
        eq(parse('y ∈ {x | x > 2}'), ['y', 'x', 'x', '2', '>', '|', '1', '{}', '∈']);
    });
});
