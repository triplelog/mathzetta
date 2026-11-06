/**
 * '@mathzetta/inlinemath/markdown' — Markdown with maths in it.
 *
 *   import { markdownToHTML } from '@mathzetta/inlinemath/markdown';
 *   el.innerHTML = markdownToHTML('The area is $\\pi r^2$, so for $r = 3$ it is ${{pi r^2}}$.');
 *
 * Maths: $…$ inline, $$…$$ (or a ```math fence) on its own, \(…\) and \[…\] too.
 * Each is read by MathZetta (LaTeX, plain text or code all work) and drawn by
 * Inline Math; {{…}} inside is worked out first (MathZetta's calculator, or the CAS:
 * { blocks: casBlocks() } from '@mathzetta/inlinemath/cas'). A definition such as $r = 3$ is
 * remembered, as a number, for the {{…}} after it ({ define: false } turns that off).
 *
 * Saved variables: $A := 2+2$ saves A (and draws A ≔ 2 + 2); $_A := 2+2$ saves it without drawing.
 * After it, A in any maths is drawn as its expression and {{A}} is its value: $A = {{A}}$ draws
 * 2 + 2 = 4. $A := [[2+2]]$ is a textbox that sets A, [[2+2 | x^2]] a dropdown, [[1..10]] a slider
 * ([[0..1 step 0.1 = 0.5]]). renderMarkdownInto keeps every part of a page in one store
 * (`variables`), so a variable saved in one part is used in the others, and changing an input
 * redraws everything that uses it.
 *
 * A $ is maths only when it looks like it (Pandoc's rule): the opening $ is not
 * followed by a space, the closing $ is not after a space or before a digit, so
 * "$5 and $10" stays text. \$ is a dollar sign. Code spans and fences are left alone.
 * Maths that doesn't read is shown as written, marked, with the reason as its title.
 *
 * The Markdown is a small built-in renderer (headings, emphasis, links, images,
 * lists, quotes, code, tables, rules). Raw HTML is shown as text unless { html: true }.
 * { render: (markdown) => html } uses another renderer (marked, markdown-it …):
 * the maths is taken out first and put back into its output.
 */

import { toHTML, treeOf } from './html.js';
import { calculate } from './calculator.js';
import { nameOf, bare, substitute, unexpand, inputOf, EXPRESSIONS, variables as pageVariables } from './variables.js';
import { toPostfix } from './mathzetta.js';
import { numberTree, select, pathOf, nodeAt } from './select.js';
import { openEditor, replaceAt } from './edit.js';

export { createVariables, variables, Variables } from './variables.js';

// ---- finding the maths --------------------------------------------------------------------

const OPEN = '';
const CLOSE = '';
const placeholder = (n) => `${OPEN}${n}${CLOSE}`;
const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g');

/**
 * The maths in a Markdown text, and the text with each piece replaced by a
 * placeholder (private-use characters, which no Markdown renderer touches).
 * @returns {{ text: string, math: Array<{ source, display, raw, start, end }> }} (start, end: where the raw text is)
 */
export function extractMath(markdown, { delimiters = ['$$', '$', '\\[', '\\('] } = {}) {
  const math = [];
  let out = '';
  let i = 0;
  const s = String(markdown);
  const atLineStart = (k) => k === 0 || s[k - 1] === '\n';
  const keep = (source, display, raw) => {
    math.push({ source, display, raw, start: i, end: i + raw.length });
    return placeholder(math.length - 1);
  };
  while (i < s.length) {
    // a fenced code block: copied as is, except ```math, which is display maths
    if (atLineStart(i)) {
      const fence = /^( {0,3})(`{3,}|~{3,})([^\n]*)\n?/.exec(s.slice(i));
      if (fence) {
        const marker = fence[2];
        const closeRe = new RegExp(`\\n {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*(?=\\n|$)`);
        const rest = s.slice(i + fence[0].length);
        const end = closeRe.exec(`\n${rest}`);
        const body = end ? rest.slice(0, Math.max(0, end.index - 1)) : rest;
        const length = fence[0].length + (end ? end.index - 1 + end[0].length : rest.length);
        const raw = s.slice(i, i + length);
        if (fence[3].trim() === 'math') out += keep(body, true, raw);
        else out += raw;
        i += length;
        continue;
      }
    }
    const c = s[i];
    // a code span: as many backticks to close it as opened it
    if (c === '`') {
      const run = /^`+/.exec(s.slice(i))[0];
      const close = s.indexOf(run, i + run.length);
      if (close > -1) {
        out += s.slice(i, close + run.length);
        i = close + run.length;
        continue;
      }
      out += run;
      i += run.length;
      continue;
    }
    if (c === '\\') {
      const two = s.slice(i, i + 2);
      const closer = two === '\\[' ? '\\]' : two === '\\(' ? '\\)' : null;
      if (closer && delimiters.includes(two)) {
        const end = s.indexOf(closer, i + 2);
        if (end > -1) {
          out += keep(s.slice(i + 2, end), two === '\\[', s.slice(i, end + 2));
          i = end + 2;
          continue;
        }
      }
      out += two;   // \$ and other escapes stay for the Markdown renderer
      i += 2;
      continue;
    }
    if (c === '$') {
      if (s[i + 1] === '$' && delimiters.includes('$$')) {
        const end = s.indexOf('$$', i + 2);
        if (end > -1) {
          out += keep(s.slice(i + 2, end), true, s.slice(i, end + 2));
          i = end + 2;
          continue;
        }
      } else if (delimiters.includes('$') && s[i + 1] && !/\s/.test(s[i + 1])) {
        const end = closingDollar(s, i + 1);
        if (end > -1) {
          out += keep(s.slice(i + 1, end), false, s.slice(i, end + 1));
          i = end + 1;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return { text: out, math };
}

/** The $ that closes inline maths opened before `from`: not after a space, not before a digit, within the paragraph. */
function closingDollar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') return -1;   // maths doesn't run into code
    if (c === '\n' && /^\n[ \t]*\n/.test(s.slice(j))) return -1;
    if (c === '$' && !/\s/.test(s[j - 1]) && !/\d/.test(s[j + 1] ?? '') && s[j + 1] !== '$') return j;
  }
  return -1;
}

// ---- drawing the maths --------------------------------------------------------------------

const escape = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A definition: r = 3, g = 9.81 (a single name on the left) — remembered as a number for {{…}}. */
const DEFINITION = /^\s*([A-Za-z\u0370-\u03ff](?:_\{?\w+\}?)?)\s*=\s*([^=<>≤≥]+)$/;

/**
 * Maths that saves a variable: `A := 2+2` (drawn), `_A := 2+2` or `_A = 2+2` (not drawn),
 * `A := [[…]]` (an input). Else null; `{ error }` for a `$_…$` that saves nothing.
 */
function savingOf(source) {
    let s = source.trim();
    const hidden = s.startsWith('_');
    if (hidden) s = s.slice(1).trimStart();
    let at = s.indexOf(':=');
    let width = 2;
    if (at < 0 && hidden) {
        at = s.search(/(?<![<>!≤≥=])=(?!=)/);
        width = 1;
    }
    const nothing = hidden ? { error: 'a hidden $_…$ saves a variable: $_A := 2+2$' } : null;
    if (at <= 0) return nothing;
    const lhs = s.slice(0, at).trim();
    const rhs = s.slice(at + width).trim();
    let name = null;
    try {
        name = /\{\{/.test(lhs) ? null : nameOf(treeOf(lhs));
    } catch {
        // not a name
    }
    if (name === null || !rhs) return nothing;
    return { hidden, lhs, name, rhs, input: inputOf(rhs) };
}

/** `A = …` drawn as `A ≔ …`: the first relation is the definition's. */
function asDefinition(html) {
    return html
        .replace('<span class="mv-rel">=</span>', '<span class="mv-rel mv-rel-def">≔</span>')
        .replace(/(aria-label="[^"]*?) equals /, '$1 is defined as ')
        .replace('<mo>=</mo>', '<mo>≔</mo>');
}

/** The input a definition's [[…]] asks for, holding `text`. */
function controlHTML(def, text) {
    const { input, name } = def;
    const attrs = `class="mv-md-input mv-md-${input.kind}" data-mv-var="${escape(name)}" aria-label="${escape(name)}"`;
    if (input.kind === 'dropdown') {
        const options = input.options.map((o) => `<option value="${escape(o)}"${o === text ? ' selected' : ''}>${escape(o)}</option>`);
        return `<select ${attrs}>${options.join('')}</select>`;
    }
    if (input.kind === 'slider') {
        return `<input type="range" ${attrs} min="${input.min}" max="${input.max}" step="${input.step}" value="${escape(text)}">`
            + `<output class="mv-md-output" data-mv-out="${escape(name)}">${escape(text)}</output>`;
    }
    return `<input type="text" ${attrs} value="${escape(text)}" size="${Math.max(4, text.length + 1)}" spellcheck="false" autocomplete="off">`;
}

/**
 * Every piece of maths drawn, in reading order: a variable is known to the maths after it, and
 * the variables already in `store` (the other parts of the page) to all of it.
 */
function drawAll(markdown, options, store, owner) {
    const { text, math } = extractMath(markdown, options);
    const defs = store ? store.definitions(owner) : new Map();
    const textOf = (def) => (store ? store.textOf(def) : def.text);
    const numbers = { ...(options.scope ?? {}) };   // options.scope and $r = 3$
    const scope = {};                                // what {{…}} sees: those and the saved variables' values
    const mine = new Map();
    const inputs = new Set();
    const trees = [];   // each piece's drawn tree, for finding what a double-click landed on
    // the saved variables' values, for {{…}}: worked out until nothing more can be (B := 2A before A := 3)
    const refresh = () => {
        for (const k of Object.keys(scope)) delete scope[k];
        Object.assign(scope, numbers);
        for (const name of defs.keys()) delete scope[name];   // x^2 has no value: {{A}} draws A, drawn as x^2
        let pending = [...defs.values()];
        while (pending.length) {
            const left = pending.filter((def) => {
                try {
                    const r = calculate(textOf(def), scope);
                    if (typeof r.value === 'number' || typeof r.value === 'bigint') {
                        scope[def.name] = r.exact ? r.text : r.value;
                        return false;
                    }
                } catch {
                    // not (yet) a number
                }
                return true;
            });
            if (left.length === pending.length) break;
            pending = left;
        }
        // and their expressions, for a CAS block: {{diff(f, x)}} differentiates what f stands for
        const expressions = {};
        const plain = lookupFor({});
        for (const name of defs.keys()) {
            const tree = plain(name);
            if (!tree) continue;
            try {
                expressions[name] = toPostfix(substitute(tree, (n) => (n === name ? null : plain(n))).tree);
            } catch {
                // an expression that can't be written as postfix: the CAS sees the name
            }
        }
        scope[EXPRESSIONS] = expressions;
    };
    const lookupFor = (drawOpts) => {
        const trees = new Map();
        return (name) => {
            const def = defs.get(name);
            if (!def) return null;
            if (!trees.has(name)) {
                let tree = null;
                try {
                    tree = treeOf(textOf(def), drawOpts);
                } catch {
                    // an input holding something that doesn't read: A is drawn as A
                }
                trees.set(name, tree);
            }
            return trees.get(name);
        };
    };

    refresh();

    const drawItem = (item, i) => {
        const { source, display } = item;
        const cls = display ? 'mv-md-display' : 'mv-md-math';
        const wrap = (html, extra = '') => `<span class="${cls}${extra}" data-mv-md="${i}">${html}</span>`;
        try {
            const drawOpts = { ...options.math, display, blocks: options.blocks, scope };
            const save = savingOf(source);
            if (save && save.error) throw new Error(save.error);
            if (save) {
                const { name, input, hidden } = save;
                const def = input
                    ? { name, text: input.default, input, key: `input:${JSON.stringify(input)}` }
                    : { name, text: save.rhs, input: null, key: `expr:${save.rhs}`, start: item.start, end: item.end };
                let html = '';
                if (input) {
                    const control = controlHTML(def, textOf(def));
                    html = hidden ? control : `${toHTML(save.lhs, drawOpts)}<span class="mv-md-assign" aria-hidden="true">≔</span>${control}`;
                    inputs.add(i);
                } else {
                    const rhs = substitute(treeOf(save.rhs, drawOpts), lookupFor(drawOpts)).tree;
                    if (!hidden) {
                        const tree = numberTree({ type: 'op', op: '=', args: [bare(treeOf(save.lhs)), rhs.id === undefined ? rhs : bare(rhs)] });
                        trees[i] = tree;
                        html = asDefinition(toHTML(tree, drawOpts));
                    }
                }
                defs.delete(name);
                defs.set(name, def);
                mine.set(name, def);
                refresh();
                if (hidden && !input) return '';
                return wrap(html, input ? ' mv-md-input-def' : '');
            }
            const { tree, changed } = substitute(treeOf(source, drawOpts), lookupFor(drawOpts));
            if (changed) numberTree(tree);
            trees[i] = tree;
            const html = toHTML(tree, drawOpts);
            if (!changed && options.define !== false && define(source, numbers, defs)) refresh();
            return wrap(html);
        } catch (error) {
            return `<span class="mv-md-error" data-mv-md="${i}" title="${escape(error.message)}"><code>${escape(item.raw)}</code></span>`;
        }
    };
    const drawn = math.map(drawItem);
    return { text, math, drawn, defs: mine, inputs, trees };
}

/** $r = 3$: remember r (exactly, as the calculator's text) for later {{…}} — unless r is a saved variable. */
function define(source, numbers, saved) {
    const m = DEFINITION.exec(source);
    if (!m || /\{\{/.test(m[2])) return false;
    const name = m[1].replace(/[{}]/g, '');
    if (saved.has(name)) return false;
    try {
        const r = calculate(m[2], numbers);
        if (typeof r.value === 'number' || typeof r.value === 'bigint') {
            numbers[name] = r.exact ? r.text : r.value;
            return true;
        }
    } catch {
        // not a number (x = y + 1): nothing to remember
    }
    return false;
}

// ---- the Markdown renderer ----------------------------------------------------------------

const SAFE_URL = /^(https?:|mailto:|#|\/|\.{0,2}\/|[^:]*$)/i;
const safeUrl = (u) => (SAFE_URL.test(u.trim()) ? escape(u.trim()) : '#');

/** Inline Markdown: code, links, images, emphasis, breaks. Placeholders pass through. */
function inline(text, options, sourceOf) {
  const parts = [];
  const hold = (html) => {
    parts.push(html);
    return `${parts.length - 1}`;
  };
  let t = text;
  // code spans (maths placeholders inside are written back as their source)
  t = t.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, run, code) => hold(`<code>${escape(sourceOf(code.trim()))}</code>`));
  // backslash escapes
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!|~$<>"'])/g, (_, ch) => hold(escape(ch)));
  // autolinks
  t = t.replace(/<((?:https?:\/\/|mailto:)[^\s>]+)>/g, (_, url) => hold(`<a href="${safeUrl(url)}">${escape(url)}</a>`));
  // raw HTML (only with { html: true })
  if (options.html) t = t.replace(/<\/?[A-Za-z][^>]*>/g, (tag) => hold(tag));
  // images and links
  // an address may hold balanced brackets: wiki/Function_(mathematics)
  t = t.replace(/!\[([^\]]*)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+"([^"]*)")?\s*\)/g, (_, alt, url, title) =>
    hold(`<img src="${safeUrl(url)}" alt="${escape(alt)}"${title ? ` title="${escape(title)}"` : ''}>`));
  t = t.replace(/\[([^\]]+)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+"([^"]*)")?\s*\)/g, (_, label, url, title) =>
    hold(`<a href="${safeUrl(url)}"${title ? ` title="${escape(title)}"` : ''}>${inline(label, options, sourceOf)}</a>`));
  t = escape(t);
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  t = t.replace(/(^|[^*\w])\*(?=\S)([\s\S]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_\w])_(?=\S)([\s\S]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
  t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  t = t.replace(/( {2,}|\\)\n/g, '<br>\n');
  return t.replace(/(\d+)/g, (_, n) => parts[Number(n)]);
}

const BLOCK_START = /^( {0,3})(#{1,6}\s|>|```|~~~|([-*+]|\d{1,9}[.)])\s|(\*[ \t]*){3,}$|(-[ \t]*){3,}$|(_[ \t]*){3,}$)/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(\s+|$)/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Block Markdown → HTML. */
function blocks(lines, options, sourceOf) {
  const out = [];
  let i = 0;
  const para = (text) => inline(text, options, sourceOf);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // fenced code
    const fence = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      const lang = fence[2] ? ` class="language-${escape(fence[2])}"` : '';
      out.push(`<pre><code${lang}>${escape(sourceOf(body.join('\n')))}</code></pre>`);
      continue;
    }
    // ATX heading
    const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${para(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    // thematic break
    if (/^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    // block quote
    if (/^ {0,3}>/.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && (/^ {0,3}>/.test(lines[i]) || body.length)) {
        body.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i++;
      }
      out.push(`<blockquote>\n${blocks(body, options, sourceOf)}\n</blockquote>`);
      continue;
    }
    // list
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const start = ordered ? parseInt(item[2], 10) : 1;
      const items = [];
      let loose = false;
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        const indent = m[0].length;
        const body = [lines[i].slice(indent)];
        i++;
        while (i < lines.length) {
          const next = lines[i];
          if (!next.trim()) {
            // a blank line inside an item, or between items (then the list is loose)
            const following = lines[i + 1];
            if (following !== undefined && (following.startsWith(' '.repeat(Math.min(indent, 4))) && following.trim())) {
              body.push('');
              loose = true;
              i++;
              continue;
            }
            if (following !== undefined && LIST_ITEM.test(following)) loose = true;
            break;
          }
          if (next.startsWith(' '.repeat(Math.min(indent, 4)))) body.push(next.slice(Math.min(indent, 4)));
          else if (LIST_ITEM.test(next) || BLOCK_START.test(next)) break;
          else body.push(next);   // a lazy continuation line
          i++;
        }
        items.push(body);
        while (i < lines.length && !lines[i].trim() && lines[i + 1] !== undefined && LIST_ITEM.test(lines[i + 1])) i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      const html = items.map((body) => {
        let inner = blocks(body, options, sourceOf);
        if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1').replace(/\n<p>([\s\S]*?)<\/p>/g, '\n$1');
        return `<li>${inner}</li>`;
      });
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>\n${html.join('\n')}\n</${tag}>`);
      continue;
    }
    // table
    if (line.includes('|') && lines[i + 1] !== undefined && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${para(c)}</${tag}>`;
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push(`<table>\n<thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>\n<tbody>\n${rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('\n')}\n</tbody>\n</table>`);
      continue;
    }
    // indented code
    if (/^( {4}|\t)/.test(line)) {
      const body = [];
      while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].replace(/^( {4}|\t)/, ''));
      while (body.length && !body[body.length - 1].trim()) body.pop();
      out.push(`<pre><code>${escape(sourceOf(body.join('\n')))}</code></pre>`);
      continue;
    }
    // paragraph (or a setext heading)
    const text = [];
    while (i < lines.length && lines[i].trim() && !(text.length && BLOCK_START.test(lines[i]) && !/^ {0,3}[-=]+\s*$/.test(lines[i]))) {
      if (text.length && /^ {0,3}(=+|-+)\s*$/.test(lines[i])) {
        const level = lines[i].trim()[0] === '=' ? 1 : 2;
        out.push(`<h${level}>${para(text.join('\n'))}</h${level}>`);
        text.length = 0;
        i++;
        break;
      }
      text.push(lines[i].replace(/^ {0,3}/, ''));
      i++;
    }
    if (text.length) out.push(`<p>${para(text.join('\n'))}</p>`);
  }
  return out.join('\n');
}

/** The built-in renderer: Markdown → HTML, raw HTML escaped unless options.html. */
export function renderMarkdown(markdown, options = {}, sourceOf = (t) => t) {
  return blocks(String(markdown).replace(/\r\n?/g, '\n').split('\n'), options, sourceOf);
}

// ---- together ---------------------------------------------------------------------------

/** The Markdown around the drawn maths. */
function assemble({ text, math, drawn }, options) {
    const sourceOf = (t) => t.replace(PLACEHOLDER, (_, n) => math[Number(n)].raw);
    const html = options.render ? options.render(text) : renderMarkdown(text, options, sourceOf);
    return html
        // display maths alone in a paragraph is a block of its own
        .replace(new RegExp(`<p>\\s*${OPEN}(\\d+)${CLOSE}\\s*</p>`, 'g'), (whole, n) => (math[Number(n)].display && drawn[Number(n)] ? `<div class="mv-md-block">${drawn[Number(n)]}</div>` : whole))
        .replace(PLACEHOLDER, (_, n) => drawn[Number(n)])
        // a paragraph that only saved variables ($_A := 2+2$) leaves nothing behind
        .replace(/<p>\s*<\/p>\n?/g, '');
}

/**
 * Markdown with maths → HTML.
 * @param {string} markdown
 * @param {object} [options]
 * @param {object} [options.math] options for each drawing (toHTML's: fnParens, colors …)
 * @param {Function} [options.blocks] the {{…}} handler (default the calculator; casBlocks() for the CAS)
 * @param {object} [options.scope] values for {{…}}: { r: 3 }
 * @param {boolean} [options.define] remember $r = 3$ for later {{…}} (default true)
 * @param {object} [options.variables] a store (createVariables()) whose variables the maths may use
 * @param {boolean} [options.html] let raw HTML through (default false: it is shown as text)
 * @param {(markdown: string) => string} [options.render] another Markdown renderer
 * @param {string[]} [options.delimiters] which of '$$', '$', '\\[', '\\(' mark maths (default all)
 */
export function markdownToHTML(markdown, options = {}) {
    return assemble(drawAll(markdown, options, options.variables || null), options);
}

const bindings = new WeakMap();
const live = new Set();   // every bound element's binding, to notice the ones taken off the page

/** Parts taken off the page take their variables with them. */
function sweep() {
    for (const b of live) if (b.connected() && !b.element.isConnected) b.stop(true);
}

/**
 * Draw Markdown with maths into an element, live: its variables join the page's store
 * (options.variables, default `variables`; false for none), its inputs set them, and its maths is
 * drawn again whenever a variable it can see changes. Drawing into the element again replaces it all.
 * Double-clicking a part drawn from a textbox variable edits it ({ editable: { toText } }, toText
 * from 'mathzetta/text'); any other part fires 'inlinemath:select' with where its maths is in the
 * Markdown ({ index, start, end, raw }).
 */
export function renderMarkdownInto(element, markdown, options = {}) {
    const store = options.variables === undefined ? pageVariables : options.variables || null;
    sweep();
    const old = bindings.get(element);
    if (old) old.stop(old.store !== store);
    let result = drawAll(markdown, options, store, element);
    element.innerHTML = assemble(result, options);
    if (!store) {
        bindings.delete(element);
        return element;
    }
    store.own(element, result.defs);

    let connected = element.isConnected;
    const redraw = () => {
        const next = drawAll(markdown, options, store, element);
        next.drawn.forEach((html, i) => {
            if (html === result.drawn[i] || next.inputs.has(i)) return;
            const at = element.querySelector(`[data-mv-md="${i}"]`);
            if (at) at.outerHTML = html;
        });
        // inputs for the same variable agree; a slider shows its value
        for (const el of element.querySelectorAll('[data-mv-var], [data-mv-out]')) {
            const def = next.defs.get(el.dataset.mvVar ?? el.dataset.mvOut);
            if (!def) continue;
            const text = store.textOf(def);
            if (el.dataset.mvOut !== undefined) el.textContent = text;
            else if (el.value !== text && el !== el.ownerDocument?.activeElement) el.value = text;
        }
        result = next;
    };
    const onInput = (event) => {
        const el = event.target;
        const name = el && el.dataset && el.dataset.mvVar;
        if (name === undefined || !element.contains(el)) return;
        if (el.type === 'text') {
            try {
                treeOf(el.value, { blocks: options.blocks, scope: {} });
                el.removeAttribute('aria-invalid');
            } catch {
                el.setAttribute('aria-invalid', 'true');   // keeps what it held last
                return;
            }
        }
        store.set(name, el.value);
    };
    // double-click a part: a part that came from a textbox variable is edited there (in place,
    // with options.editable = { toText }; else the textbox is focused); anything else tells the
    // page where that maths is in the Markdown, as an 'inlinemath:select' event
    const onDoubleClick = (event) => {
        const part = event.target.closest?.('[data-node]');
        const piece = part && part.closest('[data-mv-md]');
        if (!piece || !element.contains(piece)) return;
        const index = Number(piece.dataset.mvMd);
        const tree = result.trees[index];
        if (!tree) return;
        const id = Number(part.dataset.node);
        const path = pathOf(tree, id) || [];
        // the innermost variable the part sits in
        let at = null;
        for (let k = path.length; k >= 0 && !at; k--) {
            const n = nodeAt(tree, path.slice(0, k));
            if (n && n.from !== undefined) at = { node: n, depth: k };
        }
        const def = at && store.definitions().get(at.node.from);
        if (def && def.input && def.input.kind === 'textbox') {
            event.preventDefault();
            const name = def.name;
            const box = element.ownerDocument.querySelector(`[data-mv-var="${CSS.escape(name)}"]`);
            const toText = options.editable && options.editable.toText;
            if (!toText) {
                if (box) { box.focus(); box.select(); }
                return;
            }
            const named = (n) => treeOf(n);
            const node = nodeAt(tree, path);
            openEditor(part, toText(unexpand(node, named)), {
                label: `Edit ${name}`,
                parse: (text) => treeOf(text, { blocks: options.blocks }),
                commit: (typed) => {
                    const whole = replaceAt(unexpand(at.node, named), path.slice(at.depth), typed);
                    store.set(name, toText(whole));
                },
            });
            return;
        }
        // a saved variable defined here: point at its definition rather than where it is used
        const here = def && result.defs.get(def.name);
        const item = here && here.key === def.key && here.start !== undefined
            ? { ...result.math[index], start: here.start, end: here.end, raw: markdown.slice(here.start, here.end) }
            : result.math[index];
        element.dispatchEvent(new CustomEvent('inlinemath:select', {
            bubbles: true,
            detail: { index, start: item.start, end: item.end, raw: item.raw, source: item.source, id, path },
        }));
    };
    element.addEventListener('input', onInput);
    element.addEventListener('change', onInput);
    element.addEventListener('dblclick', onDoubleClick);
    const unsubscribe = store.subscribe((from) => {
        if (from === element) return;
        if (!element.isConnected) {
            if (connected) stop(true);   // taken off the page: its variables go with it
            return;
        }
        connected = true;
        sweep();
        redraw();
    });
    function stop(drop) {
        unsubscribe();
        element.removeEventListener('input', onInput);
        element.removeEventListener('change', onInput);
        element.removeEventListener('dblclick', onDoubleClick);
        live.delete(binding);
        bindings.delete(element);
        if (drop) store.own(element, null);
    }
    const binding = { element, store, stop, connected: () => connected };
    live.add(binding);
    bindings.set(element, binding);
    return element;
}
