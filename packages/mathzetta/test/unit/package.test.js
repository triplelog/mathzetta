/**
 * What ships: the package's exports, files and bundles (the CDN flavours, the split ES modules, the CommonJS builds, the plain builds, sizes.json).
 */
import { createRequire } from 'node:module';
import { suite, test, eq } from '../harness.js';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from '../../src/index.js';
import { FLAVOURS, PLAIN_FLAVOURS, flavourFile } from '../../tools/flavours.js';

// ---- from package.test.js ----
const loadUmd = (file) => { const module = { exports: {} }; new Function('module', 'exports', readFileSync(new URL(file, root), 'utf8'))(module, module.exports); return module.exports; };

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const head = (file) => readFileSync(new URL(file, root), 'utf8').slice(0, 120);

suite('package', () => {
    test('every export points at a file that exists', () => {
        for (const [key, target] of Object.entries(pkg.exports)) {
            if (key.includes('*')) continue;
            const paths = typeof target === 'string' ? [target] : Object.values(target);
            for (const p of paths) eq(existsSync(new URL(p, root)), true, `${key} → ${p}`);
        }
    });
    test('the files list ships src, build, the types, the licence and the readme', () => {
        for (const f of ['src/', 'build/', 'README.md', 'LICENSE']) eq(pkg.files.includes(f), true, f);
        eq(existsSync(new URL('LICENSE', root)), true);
        eq(pkg.publishConfig?.access, 'public');
        eq(pkg.jsdelivr, 'build/mathzetta.min.js');
    });
    test('the bundles are built from this version', () => {
        for (const f of ['build/mathzetta.js', 'build/mathzetta.min.js', 'build/mathzetta.esm.js', 'build/mathzetta.esm.min.js', 'build/mathzetta.cjs', ...Object.keys(FLAVOURS).map(flavourFile), ...Object.keys(PLAIN_FLAVOURS).map(flavourFile), 'build/mathzetta.core.esm.min.js', 'build/mathzetta.plain.esm.min.js', 'build/mathzetta.plain.cjs', 'build/esm/core.js', 'build/esm/latex.js', 'build/esm/chunks/core.js', 'build/esm-plain/latex.js', 'build/esm-plain/chunks/core.js']) {
            eq(head(f).includes(`MathZetta ${pkg.version} `), true, `${f} banner has version ${pkg.version}`);
        }
    });
    test('the minified ES module (the CDN file) parses like the source', async () => {
        const cdn = await import(new URL('build/mathzetta.esm.min.js', root));
        eq(typeof cdn.parse, 'function');
        eq(typeof cdn.toLaTeX, 'function');
        eq(typeof cdn.calculate, 'function');
        eq(cdn.parse('2x sin x'), parse('2x sin x'));
        eq(cdn.version, pkg.version);
    });
    test('the split ES modules share one core and give the same answers', async () => {
        const latex = await import(new URL('build/esm/latex.js', root));
        const speech = await import(new URL('build/esm/speech.js', root));
        const core = await import(new URL('build/esm/core.js', root));
        eq(latex.toLaTeX('x^2/2'), (await import('../../src/latex.js')).toLaTeX('x^2/2'));
        eq(typeof speech.toSpeech, 'function');
        eq(core.parse('2x'), parse('2x'));
        const files = ['build/esm/latex.js', 'build/esm/speech.js'].map((f) => readFileSync(new URL(f, root), 'utf8'));
        eq(files.every((c) => c.includes('./chunks/core.js')), true, 'both import the shared core chunk');
    });
    test('build/sizes.json lists every file in build/ for this version', () => {
        const sizes = JSON.parse(readFileSync(new URL('build/sizes.json', root), 'utf8'));
        eq(sizes.version, pkg.version);
        for (const f of ['build/mathzetta.min.js', 'build/mathzetta.core.min.js', 'build/esm/latex.js', 'build/esm/chunks/core.js']) eq(typeof sizes.files[f]?.gz, 'number', f);
        eq(sizes.files['build/esm/latex.js'].imports.includes('./chunks/core.js'), true);
    });
    test('each <script> flavour carries its outputs and no others', () => {
        const MAIN = { latex: 'toLaTeX', mathml: 'toMathML', text: 'toText', speech: 'toSpeech', javascript: 'toJavaScript', python: 'toPython', sql: 'toSQL', excel: 'toExcel', glsl: 'toGLSL', evaluate: 'evaluate', calculate: 'calculate', formulas: 'strToFunction' };
        for (const [name, outputs] of [...Object.entries(FLAVOURS), ...Object.entries(PLAIN_FLAVOURS)]) {
            const mz = loadUmd(flavourFile(name));
            eq(typeof mz.parse, 'function', `${name}: parse`);
            for (const [output, fn] of Object.entries(MAIN)) eq(typeof mz[fn] === 'function', outputs.includes(output), `${name}: ${fn} ${outputs.includes(output) ? 'present' : 'absent'}`);
        }
        eq(typeof loadUmd('build/mathzetta.formulas.min.js').forXlsxFile, 'function', 'formulas brings what tabview needs');
    });
    test('require() reaches every entry point, each with the same exports as import', async () => {
        const exportsMap = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).exports;
        const requireHere = createRequire(import.meta.url);
        for (const [path, target] of Object.entries(exportsMap)) {
            if (typeof target !== 'object') continue;
            eq(typeof target.require, 'string', `${path} has a require target`);
            const required = requireHere(new URL(target.require, root).pathname);
            if (path === '.' || path === './plain') continue;   // require('mathzetta') is everything; plain is checked below
            const imported = await import(new URL(target.import, root));
            for (const name of Object.keys(imported)) eq(typeof required[name], typeof imported[name], `${path}: ${name}`);
        }
        const cjs = (entry) => requireHere(new URL(`build/cjs/${entry}.cjs`, root).pathname);
        eq(cjs('latex').toLaTeX('x^2/2'), (await import('../../src/latex.js')).toLaTeX('x^2/2'));
        eq(cjs('calculate').calculate('1/3 + 1/6'), (await import('../../src/calculate.js')).calculate('1/3 + 1/6'));    });
    test('the plain builds read maths and LaTeX like the core, and no code spellings', async () => {
        const plain = await import(new URL('build/mathzetta.plain.esm.min.js', root));
        for (const input of ['3x^2 + sin(x)', '\\frac{d}{dx} x^2', 'sqrt(8)/2', 'x_1 + y_2', '2^3^2', 'max(a, b+1)']) eq(plain.parse(input), parse(input), input);
        eq(parse('np.sin(x)'), ['x', 'sin'], 'the core reads numpy');
        eq(plain.parse('np.sin(x)')[1] !== 'sin', true, 'the plain build does not');
        const plainCjs = createRequire(import.meta.url)(new URL('build/mathzetta.plain.cjs', root).pathname);
        eq(plainCjs.parse('3x^2 + sin(x)'), parse('3x^2 + sin(x)'), 'require("mathzetta/plain") reads the same');
        eq(plainCjs.parse('np.sin(x)')[1] !== 'sin', true, 'and no code spellings');
        const code = readFileSync(new URL('build/mathzetta.plain.min.js', root), 'utf8');
        eq(code.includes('Piecewise'), false, 'the code reader is not in the plain script');
        eq(readFileSync(new URL('build/mathzetta.core.min.js', root), 'utf8').includes('Piecewise'), true, 'but it is in the core');
        const latex = await import(new URL('build/esm-plain/latex.js', root));
        eq(latex.toLaTeX('x^2/2'), (await import('../../src/latex.js')).toLaTeX('x^2/2'));
        const sizes = JSON.parse(readFileSync(new URL('build/sizes.json', root), 'utf8'));
        eq(sizes.files['build/mathzetta.plain.min.js'].gz < sizes.files['build/mathzetta.core.min.js'].gz, true, 'plain is smaller');
    });
    test('the core bundle parses but carries no outputter', async () => {
        const core = await import(new URL('build/mathzetta.core.esm.min.js', root));
        eq(core.parse('2x sin x'), parse('2x sin x'));
        eq(typeof core.operator, 'function');
        eq('toLaTeX' in core, false, 'no toLaTeX in the core');
        eq('calculate' in core, false, 'no calculate in the core');
    });
});
