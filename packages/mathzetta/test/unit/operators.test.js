import { suite, test, eq, throws } from '../harness.js';
import { operator, operatorNames, needsParens, VARIADIC } from '../../src/operators.js';
import { op, sym, num } from '../../src/tree.js';
import { toLaTeX, toMathML, toJavaScript, toPython, toSQL, toText, toSpeech, toGLSL, toExcel } from '../../src/all.js';

suite('operator table', () => {
    // A node for every operator, with as many arguments as it takes.
    const sample = (name) => {
        // a matrix's arguments are its rows: [[a, b], [c, d]]
        if (['pmatrix', 'bmatrix', 'vmatrix'].includes(name)) return op(name, [op('[]', [sym('a'), sym('b')]), op('[]', [sym('c'), sym('d')])]);
        const { arity } = operator(name);
        const count = arity === VARIADIC ? 3 : arity;
        return op(name, ['a', 'b', 'c'].slice(0, count).map(sym));
    };

    const formats = { toLaTeX, toMathML, toJavaScript, toPython, toSQL, toText, toSpeech, toGLSL };
    // What a language has no function for, and can't be written inline: refused with an error naming it,
    // never written as a call to a function that doesn't exist (gcd, det, union are written inline in JavaScript).
    const REFUSED = {
        toJavaScript: { der: 'a derivative', int: 'an integral', lim: 'a limit' },
        toPython: { der: 'a derivative', lim: 'a limit' },
        toSQL: { der: 'a derivative', int: 'an integral', lim: 'a limit', '\\sumidx': 'a sum to n', '\\prodidx': 'a product to n',
            '∪': 'a union of sets', '∩': 'an intersection of sets', vmatrix: 'a determinant', det: 'a determinant' },
        toGLSL: { der: 'a derivative', int: 'an integral', lim: 'a limit', '\\sumidx': 'a sum to n', '\\prodidx': 'a product to n',
            '∪': 'a union of sets', '∩': 'an intersection of sets', '∈': '∈ b', '∉': '∈ b' },
    };
    for (const name of operatorNames()) {
        for (const [format, render] of Object.entries(formats)) {
            test(`${name} renders with ${format}`, () => {
                const refused = REFUSED[format]?.[name];
                if (refused) return throws(() => render(sample(name)), new RegExp(`^No [\\w ]+ for ${refused.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
                const out = render(sample(name));
                if (typeof out !== 'string' || !out.length) throw new Error('empty output');
            });
        }
    }

    // SQLite has no function for these; the sqlite dialect throws rather than
    // writing SQL that fails later. Everything else must render.
    const SQLITE_UNSUPPORTED = new Set(['!', 'gcd', 'perm', 'comb', 'der', 'int', 'lim',
        '\\sumidx', '\\prodidx', '±', 'pm', '∪', '∩', '_', '→', 'pmatrix', 'bmatrix', 'vmatrix', 'det']);
    for (const name of operatorNames()) {
        test(`${name} renders with toSQL sqlite`, () => {
            const node = sample(name);
            const sqlite = () => toSQL(node, { dialect: 'sqlite' });
            if (SQLITE_UNSUPPORTED.has(name)) return throws(sqlite, /^No SQLite SQL for /);
            // A group of several items only means something on the right of ∈.
            if (operator(name).group) {
                throws(sqlite, /^No SQLite SQL for .* outside ∈/);
                eq(toSQL(op(name, [sym('a')]), { dialect: 'sqlite' }), '(a)');
                return;
            }
            const out = sqlite();
            if (typeof out !== 'string' || !out.length) throw new Error('empty output');
        });
    }

    // Spreadsheets have no symbolic math, ±, sets to combine, or an index into a list: toExcel says so.
    const EXCEL_UNSUPPORTED = new Set(['der', 'int', 'lim', '\\sumidx', '\\prodidx', '±', 'pm', '∪', '∩', '→',
        'pmatrix', 'bmatrix', 'vmatrix']);   // matrices: of numbers only (the sample's entries are letters)
    for (const name of operatorNames()) {
        test(`${name} renders with toExcel`, () => {
            const node = sample(name);
            if (EXCEL_UNSUPPORTED.has(name)) return throws(() => toExcel(node), /^No spreadsheet formula for /);
            if (operator(name).group) {   // a list means something only after ∈
                throws(() => toExcel(node), /^No spreadsheet formula for a list/);
                return eq(toExcel(op(name, [sym('a')])), '=(a)');
            }
            if (name === '∈' || name === '∉') return throws(() => toExcel(node), /^No spreadsheet formula for ∈ b/);   // a set known only by name
            const out = toExcel(node);
            if (typeof out !== 'string' || !out.startsWith('=')) throw new Error(`not a formula: ${out}`);
        });
    }

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
        eq(toLaTeX(num(5)), '5');
    });
});
