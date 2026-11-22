/**
 * The core's tree and operator-table tools: postfix ⇄ tree (fromPostfix, toPostfix, asTree, leaf, node ids),
 * validatePostfix, isNumeric, operator(), isOperator, precedenceOf, needsParens, isCustomFunction, getSupportedOperations.
 */
import { suite, test, eq, throws } from '../harness.js';
import {
    CUSTOM_PREFIX, VARIADIC, asTree, firstVariable, fromPostfix, getOperatorPrecedence, getSupportedOperations,
    isCustomFunction, isNumeric, isOperator, leaf, needsParens, num, op, operator, precedenceOf, sym, toLaTeX,
    toPostfix, validatePostfix,
} from '../../src/all.js';

suite('tree: fromPostfix, toPostfix, node ids, firstVariable', () => {
    test('postfix round-trips through a tree', () => {
        const postfix = ['x', '2', '^', '3', 'x', '*', '+'];
        eq(toPostfix(fromPostfix(postfix)), postfix);
    });

    test('node ids are postfix indexes', () => {
        const tree = fromPostfix(['x', '2', '^', '3', '+']);
        eq(tree.id, 4);
        eq(tree.args[0].id, 2);
        eq(tree.args[0].args.map((n) => n.id), [0, 1]);
    });

    test('variadic operators read their count', () => {
        const tree = fromPostfix(['1', '2', '3', '3', 'max']);
        eq(tree.op, 'max');
        eq(tree.args.map((n) => n.value), ['1', '2', '3']);
        eq(toPostfix(tree), ['1', '2', '3', '3', 'max']);
    });

    test('leaf types', () => {
        eq(fromPostfix(['-2.5']).type, 'number');
        eq(fromPostfix(['θ']).type, 'symbol');
        eq(fromPostfix(['"hi"']).type, 'string');
    });

    test('old spellings are accepted when reading', () => {
        eq(toPostfix(fromPostfix(['x', '0-'])), ['x', 'neg']);
        eq(toPostfix(fromPostfix(['3', 'x', 'sqrtpow'])), ['3', 'x', 'root']);
    });

    test('malformed postfix is rejected', () => {
        throws(() => fromPostfix(['1', '+']), /needs 2 operands/);
        throws(() => fromPostfix(['1', '2']), /leaves 2 values/);
        throws(() => fromPostfix(['x', 'max']), /count/);
        throws(() => fromPostfix([]), /Empty/);
    });

    test('firstVariable finds the leftmost single letter', () => {
        eq(firstVariable(fromPostfix(['2', 't', '*', 'y', '+'])), 't');
        eq(firstVariable(fromPostfix(['2', '3', '+'])), '');
    });
});

suite('core: validatePostfix()', () => {
    test('well-formed postfix', () => {
        eq(validatePostfix(['x', '1', '+']), true);
        eq(validatePostfix(['x']), true);
        eq(validatePostfix(['x', 'sin']), true);
    });
    test('malformed postfix, never an exception', () => {
        eq(validatePostfix(['x', '+']), false);    // too few operands
        eq(validatePostfix(['1', '2']), false);    // two values left over
        eq(validatePostfix([]), false);
        eq(validatePostfix('x'), false);           // not an array
    });
});

suite('core: isNumeric()', () => {
    test('numbers, with a leading minus', () => {
        for (const t of ['3', '-3', '3.5', '.5', '0']) eq(isNumeric(t), true, t);
    });
    test('anything else', () => {
        for (const t of ['', '-', 'x', '1e5', '- 3', '3-', '--3', 'π']) eq(isNumeric(t), false, t);
    });
    test('a lone dot or two dots is not a number; a repeating decimal and 1. are', () => {
        for (const t of ['.', '-.', '1.2.3', '..', '1..']) eq(isNumeric(t), false, t);
        for (const t of ['1.', '-.5', '1.333..', '0.1212..', '-0.5..']) eq(isNumeric(t), true, t);
    });
});

suite('core: isOperator(), precedenceOf(), isCustomFunction()', () => {
    test('operators and their precedence', () => {
        eq(isOperator('+'), true);
        eq(isOperator('sin'), true);
        eq(isOperator('det'), true);
        eq(precedenceOf('+'), 50);
        eq(precedenceOf('neg'), 75);
        eq(precedenceOf('sin'), 100);
        eq(precedenceOf('*') > precedenceOf('+'), true);
        eq(precedenceOf('^') > precedenceOf('*'), true);
    });
    test('getOperatorPrecedence is precedenceOf', () => {
        eq(getOperatorPrecedence, precedenceOf);
        eq(getOperatorPrecedence('+'), 50);
    });
    test('operands are not operators', () => {
        for (const t of ['x', 'foo', '3', 'constructor', 'toString', '__proto__']) {
            eq(isOperator(t), false, t);
            eq(precedenceOf(t), undefined, t);
        }
    });
    test('custom functions: the \\: prefix and a name', () => {
        eq(CUSTOM_PREFIX, '\\:');
        eq(isCustomFunction('\\:f'), true);
        eq(isCustomFunction('\\:std'), true);
        eq(isCustomFunction('\\:'), false);   // the prefix alone
        eq(isCustomFunction('f'), false);
        eq(isCustomFunction('sin'), false);
        eq(isCustomFunction(undefined), false);
        eq(isOperator('\\:f'), true);
        eq(precedenceOf('\\:f'), 100);
    });
});

suite('core: asTree() and leaf()', () => {
    test('postfix becomes a tree, a tree is returned as it is', () => {
        eq(asTree(['x', '1', '+']), {
            type: 'op', op: '+', id: 2,
            args: [{ type: 'symbol', value: 'x', id: 0 }, { type: 'number', value: '1', id: 1 }],
        });
        const tree = fromPostfix(['x']);
        eq(asTree(tree) === tree, true);
    });
    test('anything else is refused', () => {
        throws(() => asTree('x+1'), /Expected a postfix array or an expression tree/);
        throws(() => asTree(null), /Expected a postfix array or an expression tree/);
        throws(() => asTree({ value: 'x' }), /Expected a postfix array or an expression tree/);
        throws(() => asTree(['x', '+']));
    });
    test('leaf(): numbers, strings, symbols', () => {
        eq(leaf('3'), { type: 'number', value: '3' });
        eq(leaf('-2.5'), { type: 'number', value: '-2.5' });
        eq(leaf('x'), { type: 'symbol', value: 'x' });
        eq(leaf('π'), { type: 'symbol', value: 'π' });
        eq(leaf('"hi"'), { type: 'string', value: '"hi"' });
        eq(leaf("'a'"), { type: 'string', value: "'a'" });
    });
});

suite('core: the operator table (operator, isOperator, needsParens)', () => {
    test('custom functions are variadic', () => {
        eq(operator('\\:f').arity, VARIADIC);
        eq(toLaTeX(op('\\:f', [sym('x')])), 'f\\left(x\\right)');
    });
    test('operands are not operators', () => {
        eq(operator('x'), undefined);
        eq(operator('3'), undefined);
    });
    test('brackets follow precedence and associativity', () => {
        eq(needsParens('*', '+', 'left'), true);
        eq(needsParens('+', '*', 'right'), false);
        eq(needsParens('-', '-', 'right'), true);    // a - (b - c)
        eq(needsParens('-', '-', 'left'), false);    // (a - b) - c
        eq(needsParens('^', '^', 'left'), true);     // (a^b)^c
        eq(needsParens('^', '^', 'right'), false);   // a^(b^c)
        eq(needsParens('*', null, 'left'), false);   // leaves never
    });
    test('a number node is not an operator', () => {
        for (const token of ['5', '-2.5', 'x', 'pi', '"text"', 'toString', '__proto__', 'constructor']) {
            eq(operator(token), undefined, token);
            eq(isOperator(token), false, token);
        }
        eq([isOperator('+'), isOperator('sin'), isOperator('\\:f')], [true, true, true]);   // a custom function is one too
        eq(toLaTeX(num(5)), '5');
    });
});

suite('core: getSupportedOperations()', () => {
    test('every operator is in a group', () => {
        const groups = getSupportedOperations();
        const grouped = new Set(Object.entries(groups).filter(([k]) => k !== 'all').flatMap(([, v]) => v));
        eq(groups.all.filter((name) => !grouped.has(name)), []);
        eq([...grouped].filter((name) => !groups.all.includes(name)), []);
    });
});
