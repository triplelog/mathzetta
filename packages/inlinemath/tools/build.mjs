#!/usr/bin/env node
/**
 * `npm run build` — Inline Math with everything it needs inside, for a static host:
 *
 *   dist/inlinemath.js, dist/markdown.js, dist/cas.js   ES modules, minified (mathzetta, and calcrules for
 *                                                     cas.js, bundled in; shared code in dist/chunks/)
 *   dist/inlinemath.external.js, dist/markdown.external.js, dist/cas.external.js
 *                                     the same with MathZetta left out (bare imports 'mathzetta',
 *                                     'mathzetta/speech', 'mathzetta/text', 'mathzetta/calculate' remain):
 *                                     for a page that loads MathZetta itself and maps the names with an
 *                                     import map; cas.external.js still holds calcrules
 *   dist/inlinemath.external.global.min.js, dist/inlinemath-cas.external.global.min.js
 *                                     classic <script>s without MathZetta: they read window.MathZetta,
 *                                     which a MathZetta <script> put there first (mathzetta.min.js, or the
 *                                     maths-display flavour: speech, text and calculate are used)
 *   dist/inlinemath.global.min.js       a classic <script>: window.InlineMath (Inline Math + Markdown); it carries
 *                                       inlinemath.css and adds it to the page itself (<style id="inlinemath-css">)
 *   dist/inlinemath-cas.global.min.js   the same with the CAS: window.InlineMath.mathCAS, casBlocks …
 *   dist/lite.js, dist/lite-calc.js, dist/lite.external.js, dist/inlinemath-lite.global.min.js,
 *   dist/inlinemath-lite-calc.global.min.js, dist/inlinemath-lite.external.global.min.js
 *                                     the lite build: toHTML only (no live view, Markdown or CAS), without
 *                                     or with the calculator for {{…}} blocks (the external one calculates
 *                                     if the MathZetta <script> before it has calculate)
 *   dist/inlinemath.css, dist/fonts/    the styles and fonts (both needed on the page)
 *
 * Bare imports ('mathzetta', 'mathzetta/speech', 'calcrules/cas' …) resolve as Node resolves them
 * (import.meta.resolve: the packages' ES module sources). The inlinemath.com pages are built from
 * dist/ by the website (not in this repository).
 */
import { rollup } from 'rollup';
import terser from '@rollup/plugin-terser';
import { cp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const banner = `/* Inline Math ${pkg.version} — MIT licence; includes mathzetta (and calcrules, for the CAS) */`;

// the sibling packages, resolved as Node resolves them (in the workspace: packages/mathzetta, packages/calcrules)
const resolveLikeThePage = {
    name: 'packages',
    resolveId: (id) => (/^(mathzetta|calcrules)(\/|$)/.test(id) ? fileURLToPath(import.meta.resolve(id)) : null),
};
const VIRTUAL = '\0inlinemath-global';
// the stylesheet as a string, for the classic builds to carry and add to the page
const cssAsText = { name: 'css-text', transform: (code, id) => (id.endsWith('.css') ? { code: `export default ${JSON.stringify(code)};`, map: null } : null) };
// kind: 'full' (Inline Math + Markdown), 'cas' (the same + the CAS), 'lite', 'lite-calc'
const globalEntry = (kind) => ({
    name: 'global-entry',
    resolveId: (id) => (id === VIRTUAL ? id : null),
    load: (id) => (id === VIRTUAL
        ? [kind.startsWith('lite') ? `export * from ${JSON.stringify(join(ROOT, `src/${kind}.js`))};` : `export * from ${JSON.stringify(join(ROOT, 'src/index.js'))};`,
            kind.startsWith('lite') ? '' : `export { markdownToHTML, extractMath, renderMarkdown, renderMarkdownInto } from ${JSON.stringify(join(ROOT, 'src/markdown.js'))};`,
            kind === 'cas' ? `export { mathCAS, casBlocks, stepsHTML, tokensOf } from ${JSON.stringify(join(ROOT, 'src/cas.js'))};` : '',
            `import css from ${JSON.stringify(join(ROOT, 'inlinemath.css'))};`,
            `export const CSS = css;`,
            // a <script> tag should be enough: the stylesheet goes on the page unless it is there already
            `if (typeof document !== 'undefined' && !document.getElementById('inlinemath-css')) { const s = document.createElement('style'); s.id = 'inlinemath-css'; s.textContent = css; document.head.append(s); }`,
        ].join('\n')
        : null),
});
const quiet = (warning, warn) => { if (warning.code !== 'CIRCULAR_DEPENDENCY') warn(warning); };

await rm(DIST, { recursive: true, force: true });

// ES modules: three entries, shared code split out
const modules = await rollup({
    input: { inlinemath: join(ROOT, 'src/index.js'), markdown: join(ROOT, 'src/markdown.js'), cas: join(ROOT, 'src/cas.js'), lite: join(ROOT, 'src/lite.js'), 'lite-calc': join(ROOT, 'src/lite-calc.js') },
    plugins: [resolveLikeThePage],
    onwarn: quiet,
});
await modules.write({ dir: DIST, format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', banner, plugins: [terser({ format: { comments: /MIT licence/ } })] });
await modules.close();

// the same without MathZetta: for a page that already has it (an import map supplies the names)
const external = await rollup({
    input: { 'inlinemath.external': join(ROOT, 'src/index.js'), 'markdown.external': join(ROOT, 'src/markdown.js'), 'cas.external': join(ROOT, 'src/cas.js'), 'lite.external': join(ROOT, 'src/lite.js') },
    plugins: [resolveLikeThePage],   // calcrules still bundled into cas.external.js
    external: (id) => id.startsWith('mathzetta'),
    onwarn: quiet,
});
await external.write({ dir: DIST, format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', banner: banner.replace('; includes mathzetta (and calcrules, for the CAS)', '; MathZetta not included: map mathzetta, mathzetta/speech and mathzetta/calculate with an import map'), plugins: [terser({ format: { comments: /MIT licence/ } })] });
await external.close();

// classic <script> builds
for (const [file, kind] of [['inlinemath.global.min.js', 'full'], ['inlinemath-cas.global.min.js', 'cas'], ['inlinemath-lite.global.min.js', 'lite'], ['inlinemath-lite-calc.global.min.js', 'lite-calc']]) {
    const bundle = await rollup({ input: VIRTUAL, plugins: [globalEntry(kind), cssAsText, resolveLikeThePage], onwarn: quiet });
    await bundle.write({ file: join(DIST, file), format: 'iife', name: 'InlineMath', banner, plugins: [terser({ format: { comments: /MIT licence/ } })] });
    await bundle.close();
}

// the classic builds without MathZetta: every import of it becomes a read of window.MathZetta
for (const [file, kind] of [['inlinemath.external.global.min.js', 'full'], ['inlinemath-cas.external.global.min.js', 'cas'], ['inlinemath-lite.external.global.min.js', 'lite']]) {
    const bundle = await rollup({ input: VIRTUAL, plugins: [globalEntry(kind), cssAsText, resolveLikeThePage], external: (id) => id.startsWith('mathzetta'), onwarn: quiet });
    await bundle.write({ file: join(DIST, file), format: 'iife', name: 'InlineMath', globals: () => 'MathZetta', banner: banner.replace('; includes mathzetta (and calcrules, for the CAS)', '; MathZetta not included: load a MathZetta <script> (mathzetta.min.js or mathzetta.maths-display.min.js) first'), plugins: [terser({ format: { comments: /MIT licence/ } })] });
    await bundle.close();
}

await cp(join(ROOT, 'inlinemath.css'), join(DIST, 'inlinemath.css'));
await cp(join(ROOT, 'fonts'), join(DIST, 'fonts'), { recursive: true });

const size = async (dir) => (await readdir(dir)).filter((f) => f.endsWith('.js')).length;
console.log(`dist/: inlinemath.js, markdown.js, cas.js, lite.js, lite-calc.js (+ ${await size(join(DIST, 'chunks'))} shared chunks), inlinemath.global.min.js, inlinemath-cas.global.min.js, inlinemath.css, fonts/`);
