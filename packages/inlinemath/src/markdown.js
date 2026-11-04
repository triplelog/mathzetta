/**
 * '@mathzetta/inlinemath/markdown' — Markdown with maths in it.
 *
 *   import { markdownToHTML } from '@mathzetta/inlinemath/markdown';
 *   el.innerHTML = markdownToHTML('The area is $\\pi r^2$, so for $r = 3$ it is ${{pi r^2}}$.');
 *
 * Maths: $…$ inline, $$…$$ (or a ```math fence) on its own, \(…\) and \[…\] too.
 * Each is read by MathZetta (LaTeX, plain text or code all work) and drawn by
 * Inline Math; {{…}} inside is worked out first (MathZetta's calculator, or the CAS:
 * { blocks: casBlocks() } from '@mathzetta/inlinemath/cas'). A definition such as $r = 3$ or
 * $g := 9.81$ is remembered for the {{…}} after it ({ define: false } turns that off).
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

import { toHTML } from './html.js';
import { calculate } from './calculator.js';

// ---- finding the maths --------------------------------------------------------------------

const OPEN = '';
const CLOSE = '';
const placeholder = (n) => `${OPEN}${n}${CLOSE}`;
const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g');

/**
 * The maths in a Markdown text, and the text with each piece replaced by a
 * placeholder (private-use characters, which no Markdown renderer touches).
 * @returns {{ text: string, math: Array<{ source, display, raw }> }}
 */
export function extractMath(markdown, { delimiters = ['$$', '$', '\\[', '\\('] } = {}) {
  const math = [];
  let out = '';
  let i = 0;
  const s = String(markdown);
  const atLineStart = (k) => k === 0 || s[k - 1] === '\n';
  const keep = (source, display, raw) => {
    math.push({ source, display, raw });
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

/** A definition: r = 3, g := 9.81 (a single name on the left). */
const DEFINITION = /^\s*([A-Za-zͰ-Ͽ](?:_\{?\w+\}?)?)\s*(?::=|=)\s*([^=<>≤≥]+)$/;

function drawMath(item, options, scope) {
  const { source, display } = item;
  try {
    const html = toHTML(source, { ...options.math, display, blocks: options.blocks, scope });
    if (options.define !== false) define(source, scope);
    return display ? `<span class="mv-md-display">${html}</span>` : `<span class="mv-md-math">${html}</span>`;
  } catch (error) {
    return `<span class="mv-md-error" title="${escape(error.message)}"><code>${escape(item.raw)}</code></span>`;
  }
}

/** $r = 3$: remember r (exactly, as the calculator's text) for later {{…}}. */
function define(source, scope) {
  const m = DEFINITION.exec(source);
  if (!m || /\{\{/.test(m[2])) return;
  try {
    const r = calculate(m[2], scope);
    if (typeof r.value === 'number' || typeof r.value === 'bigint') scope[m[1].replace(/[{}]/g, '')] = r.exact ? r.text : r.value;
  } catch {
    // not a number (x = y + 1): nothing to remember
  }
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

/**
 * Markdown with maths → HTML.
 * @param {string} markdown
 * @param {object} [options]
 * @param {object} [options.math] options for each drawing (toHTML's: fnParens, colors …)
 * @param {Function} [options.blocks] the {{…}} handler (default the calculator; casBlocks() for the CAS)
 * @param {object} [options.scope] values for {{…}}: { r: 3 }
 * @param {boolean} [options.define] remember $r = 3$ for later {{…}} (default true)
 * @param {boolean} [options.html] let raw HTML through (default false: it is shown as text)
 * @param {(markdown: string) => string} [options.render] another Markdown renderer
 * @param {string[]} [options.delimiters] which of '$$', '$', '\\[', '\\(' mark maths (default all)
 */
export function markdownToHTML(markdown, options = {}) {
  const { text, math } = extractMath(markdown, options);
  const scope = { ...(options.scope ?? {}) };
  // drawn in reading order, so a definition is known to the maths after it
  const drawn = math.map((item) => drawMath(item, options, scope));
  const sourceOf = (t) => t.replace(PLACEHOLDER, (_, n) => math[Number(n)].raw);
  const html = options.render ? options.render(text) : renderMarkdown(text, options, sourceOf);
  return html
    // display maths alone in a paragraph is a block of its own
    .replace(new RegExp(`<p>\\s*${OPEN}(\\d+)${CLOSE}\\s*</p>`, 'g'), (whole, n) => (math[Number(n)].display ? `<div class="mv-md-block">${drawn[Number(n)]}</div>` : whole))
    .replace(PLACEHOLDER, (_, n) => drawn[Number(n)]);
}

/** Draw Markdown with maths into an element. */
export function renderMarkdownInto(element, markdown, options = {}) {
  element.innerHTML = markdownToHTML(markdown, options);
  return element;
}
