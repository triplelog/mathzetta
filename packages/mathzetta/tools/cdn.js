#!/usr/bin/env node
/**
 * The CDN addresses of this version's bundles, with their integrity hashes:
 *
 *   npm run cdn            print the <script> / import snippets for the version in package.json
 *   npm run cdn -- --check fetch each file from jsDelivr and unpkg and compare it with the local
 *                          build (exit 1 if a file is missing there or differs — i.e. this version
 *                          isn't published yet, or the local build has changed since)
 *   npm run cdn -- --sizes measure every file in build/ (raw and gzipped bytes, and which files an ES
 *                          module imports) into build/sizes.json — the site's CDN page reads it;
 *                          `npm run build` runs this last
 *
 * Publishing is `npm publish` (prepublishOnly runs the tests and the build); jsDelivr and unpkg
 * serve every npm release on their own, a few minutes later.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRIES, FLAVOURS, PLAIN_FLAVOURS, flavourFile } from './flavours.js';

const root = new URL('../', import.meta.url);
const { name, version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const FILES = ['build/mathzetta.min.js', 'build/mathzetta.esm.min.js', ...Object.keys(FLAVOURS).map(flavourFile), ...Object.keys(PLAIN_FLAVOURS).map(flavourFile), 'build/mathzetta.core.esm.min.js', 'build/mathzetta.plain.esm.min.js', 'build/esm/core.js', 'build/esm/chunks/core.js', 'build/esm-plain/chunks/core.js', 'build/mathzetta.js', 'build/mathzetta.esm.js'];

if (process.argv.includes('--sizes')) {
    const buildDir = fileURLToPath(new URL('build/', root));
    const files = {};
    const walk = (dir) => { for (const f of readdirSync(dir).sort()) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|cjs)$/.test(f)) files['build/' + relative(buildDir, p)] = p; } };
    walk(buildDir);
    const sizes = {};
    for (const [key, p] of Object.entries(files)) {
        const code = readFileSync(p, 'utf8');
        const imports = [...code.matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/g)].map((m) => m[1]);
        sizes[key] = { raw: Buffer.byteLength(code), gz: gzipSync(code, { level: 9 }).length, ...(imports.length ? { imports } : {}) };
    }
    writeFileSync(new URL('build/sizes.json', root), JSON.stringify({ name, version, entries: ENTRIES, flavours: { ...FLAVOURS, all: ENTRIES }, plain: PLAIN_FLAVOURS, files: sizes }, null, 1) + '\n');
    const kb = (n) => (n / 1024).toFixed(1).padStart(6) + ' KB';
    for (const [key, s] of Object.entries(sizes)) if (!key.includes('chunks/')) console.log(`${key.padEnd(40)} ${kb(s.raw)}  gz ${kb(s.gz)}`);
    console.log(`build/sizes.json: ${Object.keys(sizes).length} files`);
    process.exit(0);
}
const sri = (bytes) => 'sha384-' + createHash('sha384').update(bytes).digest('base64');
const cdns = (file, v = version) => [`https://cdn.jsdelivr.net/npm/${name}@${v}/${file}`, `https://unpkg.com/${name}@${v}/${file}`];

if (process.argv.includes('--check')) {
    let bad = 0;
    for (const file of FILES) {
        const local = sri(readFileSync(new URL(file, root)));
        for (const url of cdns(file)) {
            try {
                const res = await fetch(url);
                if (!res.ok) { console.log(`missing  ${url} (${res.status})`); bad++; continue; }
                const remote = sri(Buffer.from(await res.arrayBuffer()));
                console.log(`${remote === local ? 'same    ' : 'DIFFERS '} ${url}`);
                if (remote !== local) bad++;
            } catch (e) { console.log(`error    ${url}: ${e.message}`); bad++; }
        }
    }
    process.exit(bad ? 1 : 0);
}

const major = version.split('.')[0];
const hash = (file) => sri(readFileSync(new URL(file, root)));
console.log(`MathZetta ${version} on a CDN (after \`npm publish\`):

<!-- a script tag: everything on window.MathZetta -->
<script src="${cdns('build/mathzetta.min.js')[0]}"
        integrity="${hash('build/mathzetta.min.js')}" crossorigin="anonymous"></script>

<!-- a module -->
<script type="module">
  import { parse, toLaTeX } from '${cdns('build/mathzetta.esm.min.js')[0]}';
</script>

<!-- an import map: code written for npm runs unchanged (every entry point is in the bundle) -->
<script type="importmap">
{ "imports": { "mathzetta": "${cdns('build/mathzetta.esm.min.js')[0]}",
               "mathzetta/latex": "${cdns('build/mathzetta.esm.min.js')[0]}" } }
</script>

Less than everything, for a script tag (each sets window.MathZetta; the core — parse, the tree tools,
the operator table — is in every one):
${Object.entries(FLAVOURS).map(([f, outs]) => `  ${f.padEnd(18)} ${cdns(flavourFile(f))[0].padEnd(78)} ${outs.length ? '+ ' + outs.join(', ') : 'the core alone'}`).join('\n')}
Plain — the same without the code-spelling reader (maths and LaTeX in, not numpy/SQL/spreadsheet spellings), ~5 KB less:
${Object.entries(PLAIN_FLAVOURS).map(([f, outs]) => `  ${f.padEnd(18)} ${cdns(flavourFile(f))[0].padEnd(78)} ${outs.length ? '+ ' + outs.join(', ') : 'the core alone'}`).join('\n')}
  (ES modules: build/mathzetta.plain.esm.min.js, and build/esm-plain/<entry>.js like build/esm/)
Any combination, as ES modules sharing one core (the site's cdn.html page writes these for you):
  import { toLaTeX } from '${cdns('build/esm/latex.js')[0]}'
  import { toSpeech } from '${cdns('build/esm/speech.js')[0]}'
  (or an import map: "mathzetta" → build/esm/core.js, "mathzetta/latex" → build/esm/latex.js, …)

Pinned to this release (immutable, cacheable forever): the URLs above.
Following the latest ${major}.x (no integrity attribute — the file changes):
  ${cdns('build/mathzetta.min.js', major)[0]}
  ${cdns('build/mathzetta.esm.min.js', major)[0]}
unpkg serves the same files: ${cdns('build/mathzetta.min.js')[1]}
`);
