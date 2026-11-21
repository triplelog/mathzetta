/**
 * Reading: the pipeline from text to postfix (clean → tokenize → parse → tree), the postfix format, the tree tools, edge cases, conditionals, strings and {{blocks}}.
 */
import { suite, test, eq, throws } from '../harness.js';
import { parse, parseSteps, clean, toSpeech, toText, toJavaScript, toGLSL, toPython, evaluate, toLaTeX, calculate, toSQL } from '../../src/all.js';
import { tokenize } from '../../src/parse/tokenize.js';
import { toRawPostfix } from '../../src/parse/parser.js';
import { fromPostfix, toPostfix, firstVariable } from '../../src/tree.js';

// ---- from parse.test.js ----
const P = (s) => parse(s).join(' ');

suite('postfix format', () => {
    test('unary minus is neg, folded into numbers', () => {
        eq(P('-x'), 'x neg');
        eq(P('-5'), '-5');
        eq(P('-x^2'), 'x 2 ^ neg');
    });
    test('fixed-arity functions carry no count', () => {
        eq(P('sin(x)'), 'x sin');
        eq(P('atan2(y, x)'), 'y x atan2');
    });
    test('variadic functions carry a count', () => {
        eq(P('max(1,2,3)'), '1 2 3 3 max');
        eq(P('{1,2}'), '1 2 2 {}');
    });
    test('custom functions are variadic', () => {
        eq(P('f(x)'), 'x 1 \\:f');
        eq(P('myFunction(x, y)'), 'x y 2 \\:myFunction');
    });
    test('natural log is ln', () => {
        eq(P('ln(x)'), 'x ln');
        eq(P('log(x)'), 'x ln');
        eq(P('\\ln x'), 'x ln');
        eq(P('log_2(8)'), '2 8 log');
    });
    test('roots, powers and defaults', () => {
        eq(P('\\sqrt[3]{x}'), '3 x root');
        eq(P('pow(2,3)'), '2 3 ^');
        eq(P('round(2.5)'), '2.5 0 round');
        eq(P('der(x^2)'), 'x 2 ^ x der');
        eq(P('der(x^3,x,2)'), 'x 3 ^ x der x der');
    });
    test('set membership composes with groups', () => {
        eq(P('x ∈ (0, 1]'), 'x 0 1 2 (] ∈');
        eq(P('x ∈ S'), 'x S ∈');
    });
});

suite('parser fixes', () => {
    test('x^2-4 is (x^2)-4, not x^(2-4)', () => eq(P('x^2-4'), 'x 2 ^ 4 -'));
    test('2^0-1 is (2^0)-1: `0-` is no longer an operator', () => eq(P('2^0-1'), '2 0 ^ 1 -'));
    test('negative exponents still work', () => eq(P('x^-2'), 'x -2 ^'));
    test('LaTeX trig without brackets', () => {
        eq(P('\\sin x'), 'x sin');
        eq(P('\\csc pi + tau'), 'pi csc tau +');
        eq(P('\\sin^2 x'), 'x sin 2 ^');
    });
    test('an unclosed bracket closes at the end', () => eq(P('(2+3'), '2 3 +'));
    test('the ternary operator', () => eq(P('a ? b : c'), 'a b c ?:'));
    test('Math.SQRT1_2', () => eq(P('Math.SQRT1_2+3'), '1 2 / sqrt 3 +'));
    test('a bare list needs brackets', () => throws(() => parse('1,2'), /brackets/));
    test('wrong argument counts are reported', () => throws(() => parse('sin(1,2)'), /takes 1 argument/));
});

suite('unchanged: the value of a case nobody wrote', () => {
    // if … then with no else, \\begin{cases} with no otherwise row and IF(c, a) all end in the name `unchanged`;
    // LaTeX input splits letter runs into products, and it once split this one into u·n·c·h·a·n·g·e·d
    const tail = (s) => parse(s).slice(-3);
    test('it stays one name, with or without LaTeX in the input', () => {
        eq(tail('if x > 0 then 1'), ['1', 'unchanged', '?:']);
        eq(tail('if x \\le 0 then 1'), ['1', 'unchanged', '?:']);
        eq(tail('if x > 0 then \\frac{1}{2}'), ['/', 'unchanged', '?:']);
        eq(tail('IF(x \\le 0, 1)'), ['1', 'unchanged', '?:']);
        eq(parse('\\begin{cases}x & x>0\\\\-x & x\\le 0\\end{cases}'), ['x', '0', '>', 'x', 'x', '0', '≤', 'x', 'neg', 'unchanged', '?:', '?:']);
        eq(tail('\\begin{cases}\\frac{1}{x} & x>0\\end{cases}'), ['/', 'unchanged', '?:']);
    });
    test('other letter runs in LaTeX are still products', () => {
        eq(parse('\\frac{ab}{2}'), ['a', 'b', '*', '2', '/']);
        eq(parse('\\sqrt{xy}'), ['x', 'y', '*', 'sqrt']);
    });
});

suite('strings and {{blocks}}', () => {
    test('quoted strings are kept whole', () => eq(parse('x = "2+2<5"'), ['x', '"2+2<5"', '=']));
    test('review before 1.3: bars written plainly or with Greek, differentials after a bare function, a ternary in braces, set()', () => {
        eq(P('[x^2]_0^1'), 'x 2 ^ x 0 1 evaluated');
        eq(calculate('[x^2]_0^1').text, '1');
        eq(P('[\\sin\\theta]_{\\theta=0}^{\\theta=\\pi}'), 'θ sin θ 0 pi evaluated');
        eq(calculate('[\\cos θ]_{θ=0}^{θ=π}').text, '-2');
        eq(P('dy = \\cos x\\,dx'), 'dy x cos dx * =');
        eq(P('dr = \\cos\\theta\\,d\\theta'), 'dr θ cos dθ * =');
        eq(P('du = \\sec^2 x\\,dx'), 'du x sec 2 ^ dx * =');
        eq(P('\\sin x \\cos x'), 'x sin x cos *', 'a function still ends a bare argument as before');
        eq(P('\\int \\sin x\\,dx'), 'x sin x 2 int', 'an integral keeps its own d');
        eq(P('{x > 0 ? 1 : 0}'), 'x 0 > 1 0 ?:');
        eq(P('{x : x > 0 ? 1 : 0}'), 'x x 0 > 1 0 ?: setbuilder');
        eq(toPython('\\emptyset'), 'set()', "Python's {} is a dict");
        eq(P('x in set()'), 'x 0 {} ∈');
    });
    test('the CAS call words are kept whole, in LaTeX too', () => {
        eq(parse('\\frac{1}{2} + diff(x^3, x)'), ['1', '2', '/', 'x', '3', '^', 'x', '2', '\\:diff', '+']);
        eq(parse('\\sin x + simplify(x)'), ['x', 'sin', 'x', '1', '\\:simplify', '+']);
        eq(parse('solve(x^2 = 4, x)'), ['x', '2', '^', '4', '=', 'x', '2', '\\:solve']);
    });
    test('ten or more strings restore correctly', () => {
        const input = Array.from({ length: 12 }, (_, i) => `"s${i}"`).join('+');
        eq(parse(input).filter((t) => t.startsWith('"')), Array.from({ length: 12 }, (_, i) => `"s${i}"`));
    });
    test('{{expressions}} are evaluated', () => eq(clean('total={{(2 + 3) * 4}}').cleaned, 'total=20'));
    test('{{blocks}} never run code', () => {
        globalThis.__ran = false;
        clean('{{__ran = true}}');
        clean('{{alert(1)}}');
        eq(globalThis.__ran, false);
    });
    test('a block right inside a LaTeX argument needs no space: the first of three braces is the argument\'s', () => {
        for (const [braces, spaced] of [
            ['\\frac{{{2+2}}}{4}', '\\frac{ {{2+2}} }{4}'], ['\\frac{4}{{{2+2}}}', '\\frac{4}{ {{2+2}} }'],
            ['\\frac{{{1}}}{{{2}}}', '\\frac{ {{1}} }{ {{2}} }'], ['\\sqrt{{{8}}}', '\\sqrt{ {{8}} }'],
            ['\\sqrt[3]{{{8}}}', '\\sqrt[3]{ {{8}} }'], ['2^{{{1+1}}}', '2^{ {{1+1}} }'], ['\\frac{{{{2+2}}}}{4}', '\\frac{ {{ {2+2} }} }{4}'],
        ]) eq(parse(braces), parse(spaced), braces);
        eq(parse('\\frac{{{2+2}}}{4}'), ['4', '4', '/']);
    });
    test('a block that is a whole argument by itself fills it: \\frac{{2+2}}{4} is \\frac{4}{4}', () => {
        eq(parse('\\frac{{2+2}}{4}'), ['4', '4', '/']);
        eq(parse('x^{{1+1}}'), ['x', '2', '^']);
    });
    test('a derivative at a point: der(f, x = a), der(f, x = a, n), and the evaluation bar after a derivative', () => {
        eq(P('der(x^3, x = 2)'), 'x 3 ^ x 2 = der');
        eq(P('der(x^3, x = a, 2)'), 'x 3 ^ x der x a = der', 'the nth: n − 1 plain, then one at the point');
        eq(P('\\left.\\frac{d}{dx} x^3\\right|_{x=2}'), 'x 3 ^ x 2 = der');
        eq(P('\\left.\\frac{d}{dx} x^3\\right|_2'), 'x 3 ^ x 2 = der', 'a bare point is the variable\'s');
        eq(P('\\left.\\frac{dy}{dx}\\right|_{x=0}'), 'y x 0 = der');
        eq(P('\\left.\\frac{d}{dx}(x^2+1)\\right|_{x=a} + 1'), 'x 2 ^ 1 + x a = der 1 +');
        throws(() => parse('\\left. x^2 \\right|_{x=0}'));   // one limit after anything else is refused, by name
        eq(P('\\left. x^2 \\right|_0^1'), 'x 2 ^ x 0 1 evaluated', 'two limits: an evaluation bar')
        eq(P('x \\le 3'), 'x 3 ≤', '\\le is still ≤');
    });
    test('an escaped \\{ is a brace, not the start of a block', () => eq(parse('\\{{{1+1}}, 3\\}'), ['2', '3', '2', '{}']));
    test('without LaTeX, three braces still open the block first: {{{1,2}}} is a block holding the set {1, 2}', () => {
        eq(parse('{{{1,2}}}'), ['1', '2', '2', '{}']);
        eq(parse('{1,2}{{3}}'), ['1', '2', '2', '{}', '3', '*']);
    });
});

suite('pipeline', () => {
    test('parseSteps keeps every stage', () => {
        const steps = parseSteps('2x+1');
        eq(steps.cleaned, '2x+1');
        eq(steps.tokens, ['2', 'x', '+', '1']);
        eq(steps.rawPostfix, ['2', 'x', '*', '1', '+']);
        eq(steps.postfix, ['2', 'x', '*', '1', '+']);
        eq(steps.tree.op, '+');
    });
    test('parseSteps reports errors instead of throwing', () => {
        const steps = parseSteps('1 +');
        eq(typeof steps.error, 'string');
    });
    test('allowUnvalidated returns the raw postfix', () => {
        eq(parse('1,2', { allowUnvalidated: true }), ['1', '2', ',']);
    });
    test('raw postfix keeps argument lists', () => {
        eq(toRawPostfix(tokenize('max(1,2,3)')), ['1', '2', ',', '3', ',', '()', 'max']);
    });
    test('tokenizer cuts operator words out of text', () => {
        eq(tokenize('sin(x)'), ['sin', '(', 'x', ')']);
        eq(tokenize('a===b'), ['a', '===', 'b']);   // longest operator word wins
        eq(tokenize('3sin(x)'), ['3', 'sin', '(', 'x', ')']);
        eq(toRawPostfix(tokenize('3sin(x)')), ['3', 'x', 'sin', '*']);
        eq(tokenize('atan2(y,x)'), ['atan2', '(', 'y', ',', 'x', ')']);   // digits in an operator name
        eq(tokenize('foo(x)'), ['\\:foo', '(', 'x', ')']);
    });
});

suite('reading like a person', () => {
    test('letters run together multiply, words stay whole', () => {
        eq(P('xy'), 'x y *');
        eq(P('xsinx'), 'x x sin *');
        eq(P('speed'), 'speed');
        eq(P('Missing'), 'Missing');   // has "sin" inside, but isn't x·sin
        eq(P('cost + 1'), 'cost 1 +');   // a word, not cos(t)
        eq(P('cos t + 1'), 't cos 1 +'); // the space says otherwise
        eq(P('x1 + v0'), 'x1 v0 +');
    });
    test('LaTeX input follows TeX: letters side by side multiply', () => {
        eq(P('\\frac{ab}{c}'), 'a b * c /');
        eq(P('\\text{rate} \\cdot t'), 'rate t *');
        eq(P('\\operatorname{sgn}(x)'), 'x 1 \\:sgn');
    });
    test('names the caller declares', () => {
        eq(parse('2rt + rt', { names: ['rt'] }), ['2', 'rt', '*', 'rt', '+']);
        eq(parse('cost*x', { names: ['cost'] }), ['cost', 'x', '*']);
    });
    test('f(x) is a call, x(x+1) a product', () => {
        eq(P('f(x)'), 'x 1 \\:f');
        eq(P('x(x+1)'), 'x x 1 + *');
        eq(P('a(t)'), 't 1 \\:a');
        eq(P('a(b+c)'), 'a b c + *');
    });
    test('mod takes everything to its left, % binds like *', () => {
        eq(P('2+3 mod 4'), '2 3 + 4 mod');
        eq(P('c = m^e mod n'), 'c m e ^ n mod =');
        eq(P('a mod 2n'), 'a 2 n * mod');
        eq(P('2 mod 3*4'), '2 3 mod 4 *');
        eq(P('2 + 3 % 4'), '2 3 4 mod +');
    });
    test('congruence', () => {
        eq(P('x \\equiv 1 \\pmod{3}'), 'x 1 ≡ 3 pmod');
        eq(P('17 ≡ 2 (mod 5)'), '17 2 ≡ 5 pmod');
        eq(P('a = b (mod n)'), 'a b = n pmod');
    });
    test('x(t) and x(0) are functions, x(x+1) a product', () => {
        eq(P('x(t)'), 't 1 \\:x');
        eq(P('x(0)'), '0 1 \\:x');
        eq(P('x(x+1)'), 'x x 1 + *');
        eq(P('x(2t)'), 'x 2 t * *');
    });
    test('quoted strings are not primes', () => eq(parse("a = 'b'"), ['a', "'b'", '=']));
});

suite('malformed and edge-case input', () => {
    test('empty calls', () => {
        eq(P('f()'), '0 \\:f');
        eq(P('3 + f()'), '3 0 \\:f +');
        eq(P('random()'), 'random');
        throws(() => parse('max()'), /at least one argument/);
        throws(() => parse('2 + ()'), /Empty brackets/);
    });
    test('stray closing bracket', () => throws(() => parse('2)+3'), /Unmatched '\)'/));
    test('empty input', () => {
        throws(() => parse(''), /Empty expression/);
        throws(() => parse('   '), /Empty expression/);
    });
    test('unbraced log bases follow LaTeX: digits, or one letter', () => {
        eq(P('log_2x'), '2 x log');
        eq(P('log_10x'), '10 x log');
        eq(P('log_bx'), 'b x log');
        eq(P('log_2 x'), '2 x log');
    });
    test('protected names sit next to other things', () => {
        eq(P('\\text{rate}x'), 'rate x *');
        eq(P('2\\text{rate}'), '2 rate *');
        eq(P('\\text{rate}^2'), 'rate 2 ^');
        eq(P('\\mathrm{cost}(x)'), 'x 1 \\:cost');
    });
    test('∫ dx has an integrand of 1', () => eq(P('\\int_0^1 dx'), '1 x 0 1 4 int'));
    test('a prime on a call differentiates the call', () => {
        eq(P("sin(x)'"), 'x sin x der');
        eq(P("(fg)'"), 'f g * x der');
    });
    test('ordinary words with a function or pi inside stay whole', () => {
        for (const w of ['basin', 'topic', 'octane', 'distance', 'epic', 'capital', 'Missing']) eq(P(w + ' + 1'), `${w} 1 +`, w);
        eq(P('xsinx'), 'x x sin *');
        eq(P('sint'), 't sin');
        eq(P('pir^2'), 'pi r 2 ^ *');
    });
});

suite('conditionals', () => {
    test('if … then … else is a ternary', () => {
        eq(P('if x < 0.5 then 1 - r else r'), 'x 0.5 < 1 r - r ?:');
        eq(P('IF(r > 0.5, 1, 0)'), 'r 0.5 > 1 0 ?:');
        eq(P('r > 0.5 ? 1 : 0'), 'r 0.5 > 1 0 ?:');
    });
    test('without an else the value is unchanged', () => {
        eq(P('if r > 0.5 then 1'), 'r 0.5 > 1 unchanged ?:');
        eq(P('IF(r > 0.5, 1)'), 'r 0.5 > 1 unchanged ?:');
        eq(P('(if a then 1) + 2'), 'a 1 unchanged ?: 2 +');
    });
    test('chains and nesting', () => {
        eq(P('if a then 1 else if b then 2 else 3'), 'a 1 b 2 3 ?: ?:');
        eq(P('if x < 0.5 then (if y < 0.5 then r else g) else b'), 'x 0.5 < y 0.5 < r g ?: b ?:');
    });
    test('if() needs two or three arguments', () => throws(() => parse('if(x)'), /condition/));
    test('= before a conditional defines it when what follows the = is true or false', () => {
        eq(P('f(x) = x < 0 ? x^2 : x < 1 ? 1 : 2x - 1'), 'x 1 \\:f x 0 < x 2 ^ x 1 < 1 2 x * 1 - ?: ?: =');
        eq(P('f(x) = x < 0 ? x^2 : x < 1 ? 1 : 2x - 1'), P('f(x) = (x < 0 ? x^2 : x < 1 ? 1 : 2x - 1)'));
        eq(P('y = x > 0 and z < 1 ? 1 : 2'), 'y x 0 > z 1 < & 1 2 ?: =');
        eq(P('y = not z ? 1 : 2'), 'y z \\not 1 2 ?: =');
        eq(P('max(y = x > 0 ? 1 : 2, 3)'), 'y x 0 > 1 2 ?: = 3 2 max');
    });
    test('a test stays a test: a value after =, brackets, ===, and = only on the right of and', () => {
        eq(P('x = 1 ? a : b'), 'x 1 = a b ?:');
        eq(P('Status = "Active" ? Value : 0'), 'Status "Active" = Value 0 ?:');
        eq(P('(y = x > 0) ? 1 : 2'), 'y x 0 > = 1 2 ?:');
        eq(P('a = b and c = d ? 1 : 2'), 'a b = c d = & 1 2 ?:');
        eq(P('y = x > 0'), 'y x 0 > =');
    });
    test('the test written out is bracketed, so it reads back as a test', () => {
        const test = ['y', 'x', '0', '>', '=', '1', '2', '?:'];
        eq(toText(test), '(y = x > 0) ? 1 : 2');
        for (const code of [toText(test), toJavaScript(test), toGLSL(test), toPython(test)]) eq(P(code).replace(/\.0\b/g, ''), test.join(' '));
    });
});

// ---- from tree.test.js ----
suite('tree', () => {
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

// ---- added 2026-11-03: the reading fixes and malformed input ----
suite('reading: fixes from the 2026-11 review', () => {
    test('\\loglog and \\logloglog read whole, like loglog and \\log\\log', () => {
        for (const s of ['\\loglog x', '\\log\\log x', 'loglog x', 'loglog(x)']) eq(P(s), 'x loglog', s);
        for (const s of ['\\logloglog x', '\\log\\log\\log x', 'logloglog(x)']) eq(P(s), 'x logloglog', s);
    });
    test('sum(f, i=a, b) and prod(f, i ∈ S) are indexed; a list of values stays a list', () => {
        eq(P('sum(i^2, i=1, 5)'), 'i 2 ^ i 1 = 5 3 \\sumidx');
        eq(P('product(i, i \\in T)'), 'i i T ∈ 2 \\prodidx');
        eq(P('sum(1, 2, 3)'), '1 2 3 3 sum');
        eq(P('sum(a, b=1)'), 'a b 1 = 2 sum');   // two arguments and an =: not an index
    });
    test('a chain of comparisons keeps its written form in the postfix', () => {
        eq(P('3 < x < 7'), '3 x < 7 <');
    });
    test('∫_a^b without dx names its variable, so a letter bound is not read as one', () => {
        eq(P('\\int_{a}^{b} f(x)'), 'x 1 \\:f x a b 4 int');
        eq(P('\\int_a^b t^2'), 't 2 ^ t a b 4 int');
        eq(P('\\int_{0}^{7} x^2'), 'x 2 ^ 0 7 3 int');   // number bounds: unchanged
    });
    test('English: is, is in, is not in, between … and', () => {
        eq(P('x is 7'), 'x 7 =');
        eq(P('x is in {1,2,3}'), 'x 1 2 3 3 {} ∈');
        eq(P('x is not in {1,2}'), 'x 1 2 2 {} ∉');
        eq(P('x between 3 and 5'), 'x 3 5 2 [] ∈');
        eq(P('x between a and b and y > 2'), 'x a b 2 [] ∈ y 2 > &');
        eq(P('islands'), 'islands');   // whole words only
    });
    test('code spellings: =RAND(), trunc, sympy.Rationals, inversesqrt', () => {
        eq(P('=RAND()'), 'random');
        for (const s of ['np.trunc(x)', 'math.trunc(x)', 'Math.trunc(x)', '=TRUNC(x)']) eq(P(s), P('trunc(x)'), s);
        eq(P('x in sympy.Rationals'), 'x ℚ ∈');
        eq(P('x in sympy.Complexes'), 'x ℂ ∈');
        eq(P('inversesqrt(x)'), '1 x sqrt /');
    });
    test('text joined with || (SQL) and & (spreadsheets) reads back as +', () => {
        eq(P("'a' || 'b'"), "'a' 'b' +");
        eq(P('="a"&"b"'), '"a" "b" +');
        eq(P('"Beta"||Name=="Gamma"'), '"Beta" Name "Gamma" = |');   // JavaScript's or, not a join
    });
});

suite('malformed input is refused with a reason', () => {
    const refused = [
        ['a ? b', /Unmatched '\?'/], ['a : b', /Unmatched ':'/], ['2 +', /missing an operand/], ['()', /Empty brackets/],
        ['[1, 2}', /not connected/], ['x +* y', /missing an operand/], ['sin()', /takes 1 argument/],
    ];
    for (const [input, why] of refused) test(input, () => throws(() => parse(input), why));
    test('fromPostfix: too few operands, too many values, a variadic without its count', () => {
        throws(() => fromPostfix(['+']), /needs 2 operands/);
        throws(() => fromPostfix(['1', '2']), /leaves 2 values/);
        throws(() => fromPostfix(['1', '2', 'x', 'max']), /must follow a count/);
    });
});

suite('plain English reads back what speech says', () => {
    // toSpeech's words for these come back to the same postfix (src/parse/clean/english.js)
    const SAID = ['x > 3', 'x >= 3', 'x <= 3', 'x != 3', 'x ≈ 3', 'x ∈ [3,5]', 'x ∈ (3,5)', 'x ∉ [3,5]', 'sqrt(x)', 'x^2', 'x^3', '|x|',
        'x^5', 'x^n', 'x + y', 'x - y', 'x * y', 'x / y', 'x^2 + 1', 'x mod 3', 'x = 7', '3x^2 + 2x - 1', 'sin(x)', 'cos(x) + 1', 'ln(x)', 'e^x', 'floor(x)'];
    for (const input of SAID) test(input, () => eq(P(toSpeech(input)), P(input), toSpeech(input)));
    test('within: an absolute or a percentage tolerance', () => {
        eq(P('x is within 0.001 of 7'), 'x 7 - abs 0.001 ≤');
        eq(P('x is within 1% of 7'), 'x 7 - abs 1 100 / 7 * ≤');
        eq(P('x is within 5 percent of y'), 'x y - abs 5 100 / y abs * ≤');
        eq(P('x is not within 0.1 of 2'), 'x 2 - abs 0.1 >');
    });
    test('names that are also words stay names when they are not between operands', () => {
        eq(P('times + 1'), 'times 1 +');
        eq(P('plus'), 'plus');
        eq(P('cost is more than budget'), 'cost budget >');
    });
});

// ---- added 2026-11-11: the parser review (hangs, prototype keys, internal errors, spellings) ----
import { englishRewrites, PHRASES, TRIGGER } from '../../src/parse/clean/english.js';

suite('reading: what used to hang, crash or come out wrong', () => {
    const P = (s) => parse(s, { blocks: null }).join(' ');
    test('a typed § is refused, never looped on (it marks names inside MathZetta)', () => {
        for (const s of ['2§', '§', 'x+§', '§0§+ab']) throws(() => parse(s, { names: ['ab'] }), /§ can't be read/);
    });
    test('a lone % is refused, not read as the internal %mod', () => {
        for (const s of ['%', '%x', 'x+%']) throws(() => parse(s), /'%' is missing an operand/);
        eq(P('10%3'), '10 3 mod');
        eq(P('1%2%'), '1 2% mod');
        eq(P('1%1%1%1'), '1 1 mod 1 mod 1 mod');
    });
    test('log() and lim() are refused like max(), not with an internal TypeError', () => {
        throws(() => parse('log()'), /'log' takes 2 arguments/);
        throws(() => parse('x + log()'), /'log' takes 2 arguments/);
        throws(() => parse('lim()'), /'lim' needs at least one argument/);
    });
    test('names like constructor reach no lookup table: the postfix is all strings', () => {
        for (const s of ['lim(f, x, a^constructor)', 'lim_{x→a^{valueOf}} f', 'np.constructor', "(typeof(x) IN ('a', 'b') AND constructor)"]) {
            let postfix;
            try { postfix = parse(s); } catch { continue; }   // refusing is fine too
            eq(postfix.every((t) => typeof t === 'string' && !t.includes('native code') && t !== '[object Object]'), true, `${s} → ${JSON.stringify(postfix)}`);
        }
        eq(P('lim(f, x, a^constructor)'), 'f x a constructor ^ 3 lim');
    });
    test('a spreadsheet ^ groups left to right, however long the chain', () => {
        eq(P('=a^b^c'), 'a b ^ c ^');
        eq(P('=a^b^c^d'), 'a b ^ c ^ d ^');
        eq(P('=a^b^c^d^e'), 'a b ^ c ^ d ^ e ^');
        eq(P('=-x^2^3^4'), 'x neg 2 ^ 3 ^ 4 ^');
        eq(P('=SQRT(x)^2^3'), 'x sqrt 2 ^ 3 ^');
        eq(P('=(a+1)^b^c'), 'a 1 + b ^ c ^');
        eq(P('=a ^ b ^ SQRT(c) ^ d'), 'a b ^ c sqrt ^ d ^');
    });
    test('trunc is toward zero (floor below zero would be x - (x mod 1))', () => {
        for (const s of ['trunc(x)', 'np.trunc(x)', 'math.trunc(x)', 'Math.trunc(x)', '=TRUNC(x)']) eq(P(s), 'x 0 < x ceil x floor ?:', s);
    });
    test('a script that is a command alone: \\sum_{n=1}^\\infty \\frac{1}{n^2} is a sum to ∞, not ∞frac', () => {
        eq(P('\\sum_{n=1}^\\infty \\frac{1}{n^2}'), '1 n 2 ^ / n 1 = ∞ 3 \\sumidx');
        eq(P('x^\\pi'), 'x pi ^');
        eq(P('x^\\frac12'), 'x 1 2 / ^');   // \frac takes its digits
        eq(P('2! \\cdot 3'), '2 ! 3 *');    // the words phase's own _ is no subscript
    });
    test("LaTeX's \\% is a percent sign: 12\\% reads back as 12%", () => {
        eq(P('12\\% + 23\\% = 35\\%'), '12% 23% + 35% =');
    });
    test('the English phase is skipped unless a word it reads is there — and every phrase has one', () => {
        eq(PHRASES.filter((p) => !TRIGGER.test(p)), []);
        for (const s of ['sin x + 2', '\\frac{dy}{dx}', 'arctanh(x)', 'T(t) = T_s + (T_0 - T_s)e^{-kt}']) eq(englishRewrites(s), s);
        eq(P('x is at least 3'), 'x 3 ≥');
    });
    test('protected names: one placeholder per name, put back in one pass', () => {
        eq(parse('cost + cost*rate', { names: ['cost', 'rate'] }), ['cost', 'cost', 'rate', '*', '+']);
        eq(parse('"a"B + "b"'), ['"a"B', '"b"', '+']);
    });
});

suite('limits: inputs that were slow', () => {
    const quick = (s, ms = 300) => {
        const t = Date.now();
        try { parse(s); } catch { /* refusing is fine */ }
        eq(Date.now() - t < ms, true, `${JSON.stringify(s.slice(0, 20))}… took ${Date.now() - t} ms`);
    };
    test('(mod followed by spaces (was cubic: 39 s)', () => quick('(mod ' + ' '.repeat(4990)));
    test('a chain of % (was cubic: 22 s)', () => { quick('1%'.repeat(2400) + '1'); quick('x%'.repeat(2400) + 'x'); });
    test('∫∫∫… is refused past 100 integrals (each one re-read the rest)', () => {
        throws(() => parse('∫'.repeat(101) + 'x'), /More than 100 integrals/);
        quick('∫'.repeat(2000));
    });
    test('many strings, cells or names (restoring them was quadratic)', () => {
        quick('=' + 'A1+'.repeat(1600) + '1');
        quick('"a"+'.repeat(1200) + '1');
        const t = Date.now();
        try { parse('ab+'.repeat(1200) + '1', { names: ['ab'] }); } catch { /* too deep is fine */ }
        eq(Date.now() - t < 300, true);
    });
});

suite('{{…}} blocks: the hook', () => {
    test('blocks: null leaves them as groups; a handler of your own fills them; setBlockHandler sets the default', async () => {
        const { setBlockHandler } = await import('../../src/index.js');
        const { calculateBlock } = await import('../../src/calculate.js');   // loading it set calculateBlock
        eq(parse('2 + {{1+1}}', { blocks: null }), ['2', '1', '1', '+', '+']);
        eq(parse('2 + {{anything}}', { blocks: () => '7' }), ['2', '7', '+']);
        eq(parse('{{a/b}}', { blocks: (text, scope) => String(scope.a / scope.b), scope: { a: 1, b: 4 } }), ['0.25']);
        eq(parse('2 + {{1+1}}'), ['2', '2', '+']);
        setBlockHandler(null);
        try {
            eq(parse('2 + {{1+1}}'), ['2', '1', '1', '+', '+']);
        } finally {
            setBlockHandler(calculateBlock);
        }
        eq(parse('x = {{1/3 + 1/6}}'), ['x', '1', '2', '/', '=']);
    });
});

suite('how a product was written: · and × beside the postfix', () => {
    const W = (s) => parseSteps(s).written;
    const POSTFIX = (s) => parse(s).join(' ');
    test('· (\\cdot, ⋅) is dot and × (\\times) is cross, at the * they wrote', () => {
        eq(W('a \\cdot b'), { 2: 'dot' });
        eq(W('a·b'), { 2: 'dot' });
        eq(W('x⋅y'), { 2: 'dot' });
        eq(W('a \\times b'), { 2: 'cross' });
        eq(W('a×b'), { 2: 'cross' });
        eq(W('u \\times v \\cdot w'), { 2: 'cross', 4: 'dot' });
        eq(W('\\vec{u} \\times \\vec{v}'), { 6: 'cross' });
    });
    test('the postfix is exactly what it was: only *', () => {
        for (const [marked, plain] of [['a \\cdot b', 'a*b'], ['2 \\times -3', '2*-3'], ['3 × 10^8', '3*10^8'], ['a \\times (b + c)', 'a*(b+c)'],
            ['\\frac{a \\cdot b}{c}', '(a*b)/c'], ['\\sin x \\cdot \\cos x', 'sin(x)*cos(x)'], ['-a \\times b^2', '-a*b^2'], ['a \\cdot b \\cdot c', 'a*b*c']]) {
            eq(POSTFIX(marked), POSTFIX(plain), marked);
        }
    });
    test('products written any other way carry nothing', () => {
        for (const s of ['a*b', '2x', 'a b', 'sin x cos x', '2 times 3', 'a multiplied by b']) eq(W(s), {}, s);
    });
    test('parseTree-style trees carry it on the node; parse() is a plain array', () => {
        const { tree } = parseSteps('a \\times b + c \\cdot d');
        eq(tree.args[0].written, 'cross');
        eq(tree.args[1].written, 'dot');
        eq(tree.written, undefined);
        eq(Object.keys(parse('a \\times b')), ['0', '1', '2']);
    });
    test('the stages a caller sees show *, never the marks', () => {
        const steps = parseSteps('a \\times b \\cdot c');
        const seen = [steps.cleaned, ...steps.cleanSteps.map(([, t]) => t), ...steps.tokens, ...steps.rawPostfix, clean('a \\cdot b').cleaned].join(' ');
        eq(/[-]/.test(seen), false);
        eq(steps.cleaned.includes('*'), true);
    });
    test('toPostfix fills `written` by postfix index', () => {
        const written = {};
        eq(toPostfix({ type: 'op', op: '*', written: 'cross', args: [{ type: 'symbol', value: 'a' }, { type: 'symbol', value: 'b' }] }, written), ['a', 'b', '*']);
        eq(written, { 2: 'cross' });
    });
});

// ---- misreads found in the review before 1.2: each with the neighbors that must stay as they are ----
suite('reading: \\sqrt without braces', () => {
    test('one letter, one number, or one command with its arguments', () => {
        eq(P('\\sqrt x'), 'x sqrt');
        eq(P('\\sqrt 2'), '2 sqrt');
        eq(P('\\sqrt 23'), '23 sqrt');          // a number is taken whole, as x^12 is
        eq(P('\\sqrt 2.5x'), '2.5 sqrt x *');
        eq(P('\\sqrt -1'), '-1 sqrt');
        eq(P('\\sqrt\\pi'), 'pi sqrt');
        eq(P('\\sqrt\\alpha+1'), 'α sqrt 1 +');
        eq(P('\\sqrt\\frac{1}{2}'), '1 2 / sqrt');
        eq(P('\\sqrt\\frac12'), '1 2 / sqrt');
        eq(P('\\sqrt\\frac{x^{2}}{3}+1'), 'x 2 ^ 3 / sqrt 1 +');   // nested braces stay inside
        eq(P('2\\sqrt x + 1'), '2 x sqrt * 1 +');
        eq(P('\\sqrt x + \\sqrt y'), 'x sqrt y sqrt +');
    });
    test('only that much: what follows is outside the root, as it is typeset', () => {
        eq(P('\\sqrt 2x'), '2 sqrt x *');
        eq(P('\\sqrt xy'), 'x sqrt y *');
        eq(P('\\sqrt x^2'), 'x sqrt 2 ^');
        eq(P('\\sqrt{x}^2'), 'x sqrt 2 ^');
    });
    test('the plain word still reads on: sqrt 2x is √(2x)', () => {
        eq(P('sqrt 2x'), '2 x * sqrt');
        eq(P('sqrt xy'), 'x y * sqrt');
        eq(P('sqrt x'), 'x sqrt');
        eq(P('√x'), 'x sqrt');
    });
    test('roots in roots, and the forms that were already read', () => {
        eq(P('\\sqrt\\sqrt x'), 'x sqrt sqrt');
        eq(P('\\sqrt\\sqrt{x}'), 'x sqrt sqrt');
        eq(P('\\sqrt\\sqrt[3]{x}'), '3 x root sqrt');
        eq(P('\\sqrt{x}'), 'x sqrt');
        eq(P('\\sqrt[3]{x}'), '3 x root');
        eq(P('\\sqrt[3] x'), '3 x root');
        eq(P('\\sqrt(x+1)'), 'x 1 + sqrt');
        eq(P('\\sqrt\\left(x+1\\right)'), 'x 1 + sqrt');
    });
});

suite('reading: one letter set upright, \\cfrac, 1e5, ∫ dx', () => {
    test('\\mathrm{e}, \\operatorname{f}: a single letter is that letter', () => {
        eq(P('\\mathrm{e}^x'), 'e x ^');
        eq(P('\\mathrm{d}x'), 'dx', 'an upright d: a differential');
        eq(P('\\operatorname{f}(x)'), 'x 1 \\:f');
        eq(P('\\mathit{x}+1'), 'x 1 +');
        eq(P('\\text{a}+1'), 'a 1 +');
    });
    test('a longer name stays one name, and the d of calculus is still read', () => {
        eq(P('\\mathrm{ab}^x'), 'ab x ^');
        eq(P('\\operatorname{sgn}(x)'), P('sgn(x)'));
        eq(P('\\int x^2 \\mathrm{d}x'), 'x 2 ^ x 2 int');
        eq(P('\\int \\mathrm{d}x'), '1 x 2 int');
        eq(P('\\frac{\\mathrm{d}y}{\\mathrm{d}x}'), 'y x der');
        eq(P('\\frac{\\mathrm{d}}{\\mathrm{d}x} x^2'), 'x 2 ^ x der');
    });
    test('\\cfrac is a fraction, like \\dfrac and \\tfrac', () => {
        eq(P('\\cfrac{1}{2}'), '1 2 /');
        eq(P('\\cfrac{1}{1+\\cfrac{1}{x}}'), '1 1 1 x / + /');
        eq(P('\\dfrac{1}{2}'), '1 2 /');
        eq(P('\\tfrac12'), '1 2 /');
    });
    test('1e5 is 1·10^5, with or without a sign', () => {
        eq(P('1e5'), '1 10 5 ^ *');
        eq(P('1E5'), '1 10 5 ^ *');
        eq(P('1.5e3'), '1.5 10 3 ^ *');
        eq(P('1e+5'), '1 10 5 ^ *');
        eq(P('1e-9'), '1 10 -9 ^ *');
        eq(evaluate('2e3 + 1'), 2001);
    });
    test('…but e is still e where no digit follows, and a name is still a name', () => {
        eq(P('2e'), '2 e *');
        eq(P('2e^3'), '2 e 3 ^ *');
        eq(P('e5'), 'e5');
        eq(P('x1e5'), 'x1e5');
        eq(P('2e3x'), '2 e3x *');     // unchanged: not a number followed by a name
    });
    test('∫ dx is ∫ 1 dx, however it is spaced', () => {
        for (const s of ['\\int dx', '\\int  dx', '\\int\\,dx', '∫ dx', '∫dx']) eq(P(s), '1 x 2 int', s);
        eq(P('\\int_0^1 dx'), '1 x 0 1 4 int');
        eq(P('\\int x dx'), 'x x 2 int');
        eq(P('\\int dt'), '1 t 2 int');
    });
});

suite('reading: characters written small are one subscript or one power', () => {
    test('subscripts: x₁ is x_1, x₁₂ is x_{12}', () => {
        eq(P('x₁'), P('x_1'));
        eq(P('x₁'), 'x 1 _');
        eq(P('x₁₂'), 'x 12 _');
        eq(P('a₁+a₂'), 'a 1 _ a 2 _ +');
        eq(P('2x₁'), '2 x 1 _ *');
        eq(P('xₙ'), 'x n _');
        eq(P('xₙ₊₁'), P('x_{n+1}'));
        eq(P('xᵢⱼ'), P('x_{ij}'));
        eq(P('H₂O'), P('H_2O'));
        eq(P('log₂ 8'), P('log_2 8'));
        eq(evaluate('log₂ 8'), 3);
    });
    test('a subscript and a power on one name', () => {
        eq(P('x₁²'), P('x_1^2'));
        eq(P('x₁²'), 'x 1 _ 2 ^');
    });
    test('powers: x¹² is x^12, not (x^1)^2', () => {
        eq(P('x¹²'), 'x 12 ^');
        eq(P('x²³'), 'x 23 ^');
        eq(P('x⁻¹²'), 'x -12 ^');
        eq(P('2⁻ⁿ'), P('2^{-n}'));
        eq(P('e⁻ˣ'), P('e^{-x}'));
        eq(evaluate('2¹⁰'), 1024);
    });
    test('…and what one small character already meant', () => {
        eq(P('x²'), 'x 2 ^');
        eq(P('x⁻¹'), 'x -1 ^');
        eq(P('xⁿ'), 'x n ^');
        eq(P('x²y³'), 'x 2 ^ y 3 ^ *');     // two names, two powers
        eq(P('(a+b)²'), 'a b + 2 ^');
        eq(P('sin²x'), P('sin^2 x'));
    });
});

suite('reading: mixed numbers', () => {
    test('a whole number with a fraction character is their sum', () => {
        eq(P('1½'), '1 1 2 / +');
        eq(P('1 ½'), '1 1 2 / +');
        eq(P('3 ¾'), '3 3 4 / +');
        eq(P('2⅒'), '2 1 10 / +');
        eq(evaluate('1½'), 1.5);
        eq(evaluate('2½ * 2'), 5);
        eq(evaluate('-1½'), -1.5);          // the minus takes the whole of it
        eq(evaluate('5-1½'), 3.5);
        eq(P('2½x'), '2 1 2 / + x *');
    });
    test('written with a space and a slash, or with \\frac', () => {
        eq(P('1 1/2'), '1 1 2 / +');
        eq(P('12 3/4'), '12 3 4 / +');
        eq(P('1 2/3 + 1'), '1 2 3 / + 1 +');
        eq(P('1 1/2x'), '1 1 2 / + x *');
        eq(P('1\\frac{1}{2}'), '1 1 2 / +');
        eq(P('1\\frac12'), '1 1 2 / +');
        eq(P('3 \\dfrac{1}{4}'), '3 1 4 / +');
        eq(P('2\\frac{3}{4}x'), '2 3 4 / + x *');
        eq(evaluate('3\\frac{1}{4}'), 3.25);
    });
    test('a fraction by itself, or beside a name, is still a fraction or a product', () => {
        eq(P('½'), '1 2 /');
        eq(P('⅐'), '1 7 /');
        eq(P('x½'), 'x 1 2 / *');
        eq(P('\\frac{1}{2}'), '1 2 /');
        eq(P('2\\frac{x}{3}'), '2 x 3 / *');         // no number on top: a product
        eq(P('2\\cdot\\frac{1}{3}'), '2 1 3 / *');
        eq(P('1/2x'), '1 2 / x *');
    });
    test('only a proper fraction makes a mixed number', () => {
        eq(P('2\\frac{3}{2}'), '2 3 2 / *');
        eq(P('1 3/2'), '13 2 /');
    });
    test('never after ^, _, a point or a name: x^2\\frac{1}{2} is x² times a half', () => {
        eq(P('x^2\\frac{1}{2}'), 'x 2 ^ 1 2 / *');
        eq(P('1.5\\frac{1}{2}'), '1.5 1 2 / *');
        eq(P('x_1½'), P('x_1*(1/2)'));
    });
    test('a space still groups digits: 1 000, and 1 234/567', () => {
        eq(P('1 000'), '1000');
        eq(P('2 3'), '23');
        eq(P('1 234/567'), '1234 567 /');
        eq(P('1 000/3'), '1000 3 /');
    });
    test('what is written reads back: the product 2·⅓ is written with its dot', () => {
        eq(toLaTeX(['2', '1', '3', '/', '*']), '2 \\cdot \\frac{1}{3}');
        eq(P(toLaTeX(['2', '1', '3', '/', '*'])), '2 1 3 / *');
        eq(P(toLaTeX('2\\frac{1}{3}')), '2 1 3 / +');     // the mixed number, written as a sum, is read as that sum
        eq(P(toText('1½')), '1 1 2 / +');
    });
});

// ---- the Calculus II survey (2026-11-20): notation that was misread or refused ----
const V = (s, scope = {}) => evaluate(s, scope);
const C = (s, scope = {}) => calculate(s, scope).text;

suite('reading: a name, a space, a number', () => {
    test('two factors: n 3^n is n·3ⁿ (it was a name n3)', () => {
        eq(P('n 3^n'), 'n 3 n ^ *');
        eq(P('\\frac{(x-2)^n}{n 3^n}'), 'x 2 - n ^ n 3 n ^ * /');
        eq(P('a 2'), 'a 2 *');
        eq(P('x 1/2'), 'x 1 * 2 /');
        eq(P('k 10'), 'k 10 *');
    });
    test('…but a name written with its digits is still one name, digits still group, and a command takes its digits', () => {
        eq(P('x2'), 'x2');
        eq(P('n3'), 'n3');
        eq(P('2 3'), '23');
        eq(P('1 000'), '1000');
        eq(P('\\frac 1 2'), '1 2 /');
        eq(P('log 7'), '7 ln');
        eq(P('sin 2x'), '2 x * sin');
    });
});

suite('reading: arcsec, arccsc, arccot', () => {
    test('sec⁻¹, csc⁻¹ and cot⁻¹ are inverses, as sin⁻¹ is (they were read as 1/sec x)', () => {
        eq(P('\\sec^{-1} x'), 'x arcsec');
        eq(P('\\csc^{-1}(2)'), '2 arccsc');
        eq(P('\\cot^{-1} x'), 'x arccot');
        eq(P('sec^-1(x)'), 'x arcsec');
        eq(P('\\sin^{-1} x'), 'x arcsin');
    });
    test('every other spelling', () => {
        for (const s of ['arcsec(x)', 'asec(x)', '\\operatorname{arcsec}(x)', '\\text{arcsec}(x)', 'arcsecant of x']) eq(P(s), 'x arcsec', s);
        eq(P('\\operatorname{arccot} x'), 'x arccot');
        eq(P('acsc(x)'), 'x arccsc');
    });
    test('a power of sec is still a power, and (sec x)⁻¹ the reciprocal', () => {
        eq(P('\\sec^2 x'), 'x sec 2 ^');
        eq(P('(\\sec x)^{-1}'), 'x sec -1 ^');
    });
    test('values: arccot runs from 0 to π, as in calculus books', () => {
        eq(C('arcsec(2)'), 'pi/3');
        eq(C('arccsc(2)'), 'pi/6');
        eq(C('arccot(1)'), 'pi/4');
        eq(C('arccot(-1)'), '(3*pi)/4');
        eq(C('arcsec(-2)'), '(2*pi)/3');
        eq(Math.abs(V('arccot(-1)') - 3 * Math.PI / 4) < 1e-12, true);
        throws(() => calculate('arcsec(0.5)'), /not a real number/);
    });
    test('every output: code writes acos(1/u), asin(1/u), π/2 − atan u', () => {
        eq(toLaTeX('\\sec^{-1} x'), '\\operatorname{arcsec}\\left(x\\right)');
        eq(toJavaScript('arcsec(x)'), '(Math.acos(1 / x))');
        eq(toJavaScript('arccot(x)'), '(Math.PI / 2 - Math.atan(x))');
        eq(toSpeech('arccsc(x)'), 'inverse cosecant of x');
        eq(P(toLaTeX('arccot(x+1)')), 'x 1 + arccot');
        eq(P(toText('arcsec(x)')), 'x arcsec');
    });
});

suite('reading: degrees', () => {
    test('30^\\circ, 30^{\\circ}, \\degree and ° are degrees, and have a value', () => {
        for (const s of ['30^\\circ', '30^{\\circ}', '30\\degree', '30°']) eq(P(s), '30 ° *', s);
        eq(C('\\sin(30^\\circ)'), '1/2');
        eq(C('\\cos 60°'), '1/2');
        eq(Math.abs(V('\\sin(30^\\circ)') - 0.5) < 1e-12, true);
        eq(toLaTeX('30°'), '30^{\\circ}');
        eq(P('radians(30.0)'), '30.0 ° *');     // what GLSL writes reads back
    });
    test('\\circ on its own is not a degree', () => {
        eq(P('(f \\circ g)(x)'), 'x 1 \\:g 1 \\:f');
    });
});

suite('reading: sizes, cases with commas, systems', () => {
    test('\\big, \\Big, \\bigg, \\Bigg (and l/r/m) only size a bracket', () => {
        eq(P('\\Big( x \\Big)'), 'x');
        eq(P('\\bigg[ x + 1 \\bigg]'), 'x 1 +');
        eq(P('\\bigl( x \\bigr)^2'), 'x 2 ^');
        eq(P('\\Big| x \\Big|'), P('|x|'));
    });
    test('a case written with a comma before its condition', () => {
        eq(P('f(x) = \\begin{cases} x^2, & \\text{if } x < 0 \\\\ 2x, & \\text{otherwise} \\end{cases}'), 'x 1 \\:f x 0 < x 2 ^ 2 x * ?: =');
        eq(P('f(x) = \\begin{cases} x^2 & x < 0 \\\\ 2x & x \\ge 0 \\end{cases}'), 'x 1 \\:f x 0 < x 2 ^ x 0 ≥ 2 x * unchanged ?: ?: =');
    });
    test('a brace of equations is a system: all of them hold', () => {
        eq(P('\\begin{cases} x + y = 3 \\\\ x - y = 1 \\end{cases}'), 'x y + 3 = x y - 1 = &');
        eq(P('\\begin{cases} x + y = 3, \\\\ 2x - y \\le 1. \\end{cases}'), 'x y + 3 = 2 x * y - 1 ≤ &');
        eq(V('\\begin{cases} x + y = 3 \\\\ x - y = 1 \\end{cases}', { x: 2, y: 1 }), true);
        eq(P('\\begin{cases} 1 & x > 0 \\\\ 0 \\end{cases}'), 'x 0 > 1 0 ?:');   // a value and a condition: still a case
    });
});

suite('reading: evaluation bars', () => {
    const want = 'x 3 ^ 3 / x 0 1 evaluated';
    test('[F]_a^b in every way it is written', () => {
        for (const s of ['\\left[ \\frac{x^3}{3} \\right]_0^1', '\\left. \\frac{x^3}{3} \\right|_0^1', '\\frac{x^3}{3} \\Big|_0^1', '\\frac{x^3}{3}\\bigg|_{0}^{1}',
            '\\Big[ \\frac{x^3}{3} \\Big]_0^1', '\\left[ \\frac{x^3}{3} \\right]^1_0', 'evaluated(x^3/3, 0, 1)', 'evaluated(x^3/3, x, 0, 1)']) eq(P(s), want, s);
        eq(P('\\left[x^2 + t\\right]_{x=1}^{x=2}'), 'x 2 ^ t + x 1 2 evaluated', 'the limits name the variable');
        eq(P('evaluated(t^2, t, 0, 1)'), 't 2 ^ t 0 1 evaluated');
    });
    test('after an integral, the bar takes the term before it', () => {
        eq(P('\\int_0^1 x^2\\,dx = \\frac{x^3}{3}\\Big|_0^1 = \\frac{1}{3}'), 'x 2 ^ x 0 1 4 int x 3 ^ 3 / x 0 1 evaluated = 1 3 / =');
        eq(P('2\\left[x^2\\right]_0^1'), '2 x 2 ^ x 0 1 evaluated *');
    });
    test('values: F at b minus F at a, exactly', () => {
        eq(C('\\left[ \\frac{x^3}{3} \\right]_0^1'), '1/3');
        eq(C('\\left[ -\\cos x \\right]_0^{\\pi}'), '2');
        eq(C('\\left[ \\ln|x| \\right]_1^e'), '1');
        eq(C('\\int_0^1 x^2\\,dx = \\frac{x^3}{3}\\Big|_0^1'), 'true');
        eq(V('\\left[x\\right]_0^1', { x: 99 }), 1, 'x is bound: the scope\'s x is not used');
    });
    test('every output: code writes the difference; text and LaTeX read back', () => {
        eq(toJavaScript('\\left[ x^2 + c \\right]_0^2'), '(Math.pow(2, 2) + c - (Math.pow(0, 2) + c))');
        eq(toLaTeX('\\left[ x^2 \\right]_0^1'), '\\left[x^2\\right]_{0}^{1}');
        eq(toSpeech('\\left[ x^2 \\right]_0^1'), 'x squared, evaluated from 0 to 1');
        eq(P(toText('\\left[ x^2 \\right]_0^1')), 'x 2 ^ x 0 1 evaluated');
        eq(P(toLaTeX('\\left[ x^2 \\right]_{x=0}^{x=1}')), 'x 2 ^ x 0 1 evaluated');
    });
    test('what is not a bar stays as it was', () => {
        eq(P('\\left[x+1\\right]^2'), 'x 1 + 2 ^');                   // one script: a power
        eq(P('\\left|x\\right|'), 'x abs');
        eq(P('\\left(x+1\\right)_0^1'), 'x 1 + 0 _ 1 ^');               // round brackets
        eq(P('x_0^1'), 'x 0 _ 1 ^');
        eq(P('\\left.\\frac{d}{dx} x^3\\right|_{x=2}'), 'x 3 ^ x 2 = der');   // one limit after a derivative: at a point
    });
});

suite('reading: ⋯, ∅, ₙCᵣ, f⁽⁴⁾, repeating decimals, f ∘ g', () => {
    test('\\cdots, \\ldots, \\dots and ... are ⋯, which code refuses by name', () => {
        for (const s of ['1 + x + \\cdots', '1 + x + \\ldots', '1 + x + \\dots', '1 + x + ...']) eq(P(s), '1 x + ⋯ +', s);
        eq(toLaTeX('1 + \\cdots'), '1 + \\cdots');
        throws(() => toJavaScript('1 + \\cdots'), /^No JavaScript for ⋯/);
        eq(P('a === b'), 'a b ===');             // === is not three dots
        eq(P('1.333..'), '1.333..');             // nor is a repeating decimal
    });
    test('the empty set: \\emptyset, \\varnothing, ∅, \\{\\}', () => {
        for (const s of ['\\emptyset', '\\varnothing', '∅', '\\{\\}', '{}']) eq(P(s), '0 {}', s);
        eq(V('x \\in \\emptyset', { x: 1 }), false);
        eq(C('x \\notin \\emptyset', { x: 1 }), 'true');
        eq(toSQL('x \\in \\emptyset'), 'FALSE');
        eq(toSpeech('\\emptyset'), 'the empty set');
        throws(() => parse('()'), /Empty brackets/);     // other empty brackets are still refused
        eq(P('f()'), '0 \\:f');
    });
    test('n choose r and n permute r written with subscripts', () => {
        for (const s of ['_5C_2', '{}_5C_2', '{}_{5}\\mathrm{C}_{2}']) eq(P(s), '5 2 comb', s);
        eq(P('{}_{n}C_{r}'), 'n r comb');
        eq(P('_nP_r'), 'n r perm');
        eq(P('x_5C_2'), 'x 5 _ C 2 _ *', 'after a name: subscripts');
    });
    test('f^{(4)}(x) is the fourth derivative of f, as f′′′′(x) is', () => {
        eq(P('f^{(4)}(x)'), 'x 1 \\:f′′′′');
        eq(P('f⁽⁴⁾(x)'), 'x 1 \\:f′′′′');
        eq(P('x^{(2)}'), 'x 2 ^', 'no call after it: a power');
    });
    test('repeating decimals with \\overline, and their value in every output', () => {
        eq(P('0.\\overline{3}'), '0.33..');
        eq(P('0.1\\overline{6}'), '0.166..');
        eq(C('0.\\overline{142857}'), '1/7');
        eq(V('0.1\\overline{6}'), 1 / 6);
        eq(V('1.333..'), 4 / 3);
        eq(toJavaScript('0.\\overline{3}'), '0.33333333333333333');   // not 0.33
        eq(toLaTeX('0.1\\overline{6}'), '0.1\\overline{6}');
    });
    test('(f \\circ g)(x) is f(g(x))', () => eq(P('(f \\circ g)(x)'), P('f(g(x))')));
});

suite('calculate: what underflows inside a limit or an integral is 0 there', () => {
    test('limits and improper integrals of e^-x', () => {
        eq(C('\\lim_{x\\to -\\infty} e^x'), '0');
        eq(C('\\lim_{x\\to\\infty} x e^{-x}'), '0');
        eq(C('\\int_0^{\\infty} e^{-x} dx'), '1');
        eq(Math.abs(calculate('\\int_{-\\infty}^{\\infty} e^{-x^2} dx').value - Math.sqrt(Math.PI)) < 1e-9, true);
    });
    test('…and a number typed too small is still refused', () => throws(() => calculate('10^{-50000}'), /too small/));
});

// ---- the second Calculus II pass (2026-11-20) ----
suite('reading: trig functions by their names', () => {
    test('sine(x), arcsine(x) (it was arcsin times e), cotangent x', () => {
        eq(P('arcsine(x)'), 'x arcsin');
        eq(P('arccosine(x)'), 'x arccos');
        eq(P('arcsecant(x)'), 'x arcsec');
        eq(P('sine(x)'), 'x sin');
        eq(P('Cosine(2x)'), '2 x * cos');
        eq(P('sine x'), 'x sin');
        eq(P('sine \\theta'), 'θ sin');
        eq(P('the sine of x'), 'x sin');
    });
    test('a name with no argument after it is still a word', () => {
        eq(P('tangent'), 'tangent');
        eq(P('the tangent line'), 'the tangent * line *');
        eq(P('cosines(x)'), 'x 1 \\:cosines');
    });
});

suite('reading: differentials', () => {
    test('dy, dx, dθ as one quantity each, where they are clearly differentials', () => {
        eq(P("dy = f'(x)\\,dx"), 'dy x 1 \\:f′ dx * =');
        eq(P('du = 2x\\,dx'), 'du 2 x * dx * =');
        eq(P('dA = 2\\pi r\\,dr'), 'dA 2 pi * r * dr * =');
        eq(P('ds = \\sqrt{dx^2 + dy^2}'), 'ds dx 2 ^ dy 2 ^ + sqrt =');
        eq(P('x\\,dy - y\\,dx'), 'x dy * y dx * -');     // was the name xdy
        eq(P('r\\,d\\theta'), 'r dθ *');
        eq(P('\\mathrm{d}x'), 'dx');
        eq(P('dy = 2x dx'), 'dy 2 x * dx * =');
    });
    test('…and where they are not: one bare d x is a product; integrals and derivatives read their own', () => {
        eq(P('dx'), 'd x *');
        eq(P('d x'), 'd x *');
        eq(P('x d y'), 'x d * y *');
        eq(P('d(x)'), 'x 1 \\:d');
        eq(P('dog'), 'dog');
        eq(P('\\int x\\,dx'), 'x x 2 int');
        eq(P('\\frac{dy}{dx}'), 'y x der');
        eq(P('dy/dx'), 'y x der');
        eq(P('\\frac{d}{dx} x^2'), 'x 2 ^ x der');
        eq(P('\\left.\\frac{\\mathrm{d}^{2}}{\\mathrm{d}x^{2}} x^3\\right|_{x=2}'), 'x 3 ^ x der x 2 = der');
    });
    test('written as differentials', () => {
        eq(toLaTeX("dy = f'(x)\\,dx"), "\\mathrm{d}y = f'\\left(x\\right)\\,\\mathrm{d}x");
        eq(P(toLaTeX('dA = 2\\pi r\\,dr')), 'dA 2 pi * r * dr * =');
        eq(P(toLaTeX('x\\,dy - y\\,dx')), 'x dy * y dx * -');
        eq(toSpeech('r\\,d\\theta'), 'r d theta');
        eq(P(toLaTeX("dy = f'(x)\\,dx")), 'dy x 1 \\:f′ dx * =');
    });
});

suite('reading: equations listed side by side, implies and iff', () => {
    test('x = t^2, y = t^3: each holds', () => {
        eq(P('x = t^2, y = t^3'), 'x t 2 ^ = y t 3 ^ = &');
        eq(P('x = \\cos t, y = \\sin t, z = t'), 'x t cos = y t sin = & z t = &');
        eq(P('x > 0, y > 0'), 'x 0 > y 0 > &');
        throws(() => parse('1, 2'), /needs brackets/);      // a list of values still needs its brackets
        eq(P('(1, 2)'), '1 2 2 ()');
    });
    test('⇒ and ⇔ in every spelling', () => {
        for (const s of ['p \\Rightarrow q', 'p \\implies q', 'p ⇒ q', 'p \\Longrightarrow q']) eq(P(s), 'p q \\implies', s);
        for (const s of ['p \\iff q', 'p \\Leftrightarrow q', 'p ⇔ q']) eq(P(s), 'p q \\iff', s);
        eq(P('x > 0 \\Rightarrow x^2 > 0'), 'x 0 > x 2 ^ 0 > \\implies');
        eq(P('p \\land q \\Rightarrow r'), 'p q & r \\implies', 'looser than and');
        eq(P('x \\rightarrow 0'), 'x 0 →', 'a single arrow is still "tends to"');
    });
    test('truth tables and outputs', () => {
        for (const [p, q, implies, iff] of [[1, 1, true, true], [1, 0, false, false], [0, 1, true, false], [0, 0, true, true]]) {
            eq(evaluate('p \\implies q', { p, q }), implies);
            eq(evaluate('p \\iff q', { p, q }), iff);
            eq(calculate('p \\iff q', { p: Boolean(p), q: Boolean(q) }).text, String(iff));
        }
        eq(toLaTeX('p \\implies q'), 'p \\Rightarrow q');
        eq(toJavaScript('p \\implies q'), '(!(p) || q)');
        eq(toSpeech('p \\iff q'), 'p if and only if q');
        eq(P(toText('p \\iff q')), 'p q \\iff');
    });
});

suite('reading: set-builder notation', () => {
    test('\\{x \\mid P\\}, \\{x : P\\}, \\middle|, {x : P}', () => {
        for (const s of ['\\{x \\mid x > 2\\}', '\\{x : x > 2\\}', '\\left\\{ x \\middle| x > 2 \\right\\}', '{x : x > 2}', '\\{x | x > 2\\}']) eq(P(s), 'x x 2 > setbuilder', s);
        eq(P('\\{x \\in \\mathbb{R} : x \\ne 0\\}'), 'x ℝ ∈ x 0 ≠ setbuilder');
        eq(P('\\{ |x| \\mid x < 0 \\}'), 'x abs x 0 < setbuilder', 'a written \\mid wins over an absolute value\'s bar');
        eq(P('\\{x \\mid |x - 1| < 2\\}'), 'x x 1 - abs 2 < setbuilder');
    });
    test('…and sets of values, blocks and the empty set are as they were', () => {
        eq(P('\\{1, 2, 3\\}'), '1 2 3 3 {}');
        eq(P('{1, 2}'), '1 2 2 {}');
        eq(P('\\{\\}'), '0 {}');
        eq(P('{{1+1}}'), '2');
    });
    test('membership is the condition, in every output; the set alone is refused by code', () => {
        const s = 'y \\in \\{x \\in \\mathbb{R} \\mid x^2 < 4\\}';
        eq(evaluate(s, { y: 1 }), true);
        eq(evaluate(s, { y: 3 }), false);
        eq(calculate('3 \\notin \\{x \\mid x > 2\\}').text, 'false');
        eq(toJavaScript(s), '((Number.isFinite(y) && Math.pow(y, 2) < 4))');
        eq(toLaTeX('\\{x \\mid x > 2\\}'), '\\left\\{ x \\mid x > 2 \\right\\}');
        eq(toSpeech('\\{x \\in \\mathbb{R} \\mid x^2 < 4\\}'), 'the set of x in the real numbers such that x squared is less than 4');
        eq(P(toText('\\{x \\mid x > 2\\}')), 'x x 2 > setbuilder');
        throws(() => toJavaScript('\\{x \\mid x > 2\\}'), /^No JavaScript for a set described by a condition/);
    });
});
