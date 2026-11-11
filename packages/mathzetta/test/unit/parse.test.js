/**
 * Reading: the pipeline from text to postfix (clean → tokenize → parse → tree), the postfix format, the tree tools, edge cases, conditionals, strings and {{blocks}}.
 */
import { suite, test, eq, throws } from '../harness.js';
import { parse, parseSteps, clean, toSpeech } from '../../src/all.js';
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
