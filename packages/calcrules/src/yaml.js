// A small YAML reader/writer covering the subset rule files need:
// block maps, block sequences, flow sequences and maps, plain/single/double
// quoted scalars, block scalars (| and >) with chomping, and comments.
//
// Deliberately not full YAML — no anchors, aliases, tags, complex keys or
// multi-document streams. Anything outside the subset raises YamlError with a
// line number rather than silently doing the wrong thing.

export class YamlError extends Error {
  constructor(message, line) {
    super(line == null ? message : `${message} (line ${line + 1})`);
    this.name = 'YamlError';
    this.line = line;
  }
}

/* ====================== reading ====================== */

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        if (quote === "'" && text[i + 1] === "'") i++;
        else quote = null;
      } else if (quote === '"' && c === '\\') i++;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

function scan(text) {
  return String(text).split(/\r?\n/).map((raw, n) => {
    const indent = raw.search(/\S/);
    if (indent === -1) return { raw, n, indent: 0, text: '', blank: true };
    const body = stripComment(raw.slice(indent)).trimEnd();
    return { raw, n, indent, text: body, blank: body === '' };
  });
}

class Ctx {
  constructor(records) {
    this.records = records;
    this.i = 0;
    this.pushed = [];
  }
  peek() {
    if (this.pushed.length) return this.pushed[this.pushed.length - 1];
    while (this.i < this.records.length && this.records[this.i].blank) this.i++;
    return this.i < this.records.length ? this.records[this.i] : null;
  }
  next() {
    if (this.pushed.length) return this.pushed.pop();
    const r = this.peek();
    if (r) this.i++;
    return r;
  }
  push(record) {
    this.pushed.push(record);
  }
}

const isSeqItem = (text) => text === '-' || text.startsWith('- ');

/** Split `key: value`, ignoring colons inside quotes or flow collections. */
function splitKey(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        if (quote === "'" && text[i + 1] === "'") i++;
        else quote = null;
      } else if (quote === '"' && c === '\\') i++;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ':' && depth === 0 && (i + 1 === text.length || text[i + 1] === ' ')) {
      const rawKey = text.slice(0, i).trim();
      if (rawKey === '') return null;
      return { key: unquote(rawKey), rest: text.slice(i + 1).trim() };
    }
  }
  return null;
}

function unquote(text) {
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    return JSON.parse(text);
  }
  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

export function parseYaml(text) {
  const ctx = new Ctx(scan(text));
  let first = ctx.peek();
  if (first && first.text === '---') {
    ctx.next();
    first = ctx.peek();
  }
  if (!first) return null;
  const value = parseBlock(ctx, first.indent);
  const leftover = ctx.peek();
  if (leftover && leftover.text !== '...' && leftover.text !== '---') {
    throw new YamlError(`unexpected content "${leftover.text}"`, leftover.n);
  }
  return value;
}

function parseBlock(ctx, indent) {
  const rec = ctx.peek();
  if (!rec || rec.indent < indent) return null;
  if (isSeqItem(rec.text)) return parseSeq(ctx, rec.indent);
  if (splitKey(rec.text)) return parseMap(ctx, rec.indent);
  ctx.next();
  return parseScalar(rec.text, rec.n);
}

function parseSeq(ctx, indent) {
  const out = [];
  for (;;) {
    const rec = ctx.peek();
    if (!rec || rec.indent !== indent || !isSeqItem(rec.text)) break;
    ctx.next();
    if (rec.text === '-') {
      const nxt = ctx.peek();
      out.push(nxt && nxt.indent > indent ? parseBlock(ctx, nxt.indent) : null);
      continue;
    }
    // `- id: foo` starts a nested block whose column is where the content begins.
    const rest = rec.text.slice(2);
    const lead = rest.length - rest.trimStart().length;
    const col = indent + 2 + lead;
    ctx.push({ raw: rec.raw, n: rec.n, indent: col, text: rest.trim(), blank: false });
    out.push(parseBlock(ctx, col));
  }
  return out;
}

function parseMap(ctx, indent) {
  const out = {};
  for (;;) {
    const rec = ctx.peek();
    if (!rec || rec.indent !== indent) break;
    const kv = splitKey(rec.text);
    if (!kv) break;
    ctx.next();
    const { key, rest } = kv;
    if (rest === '') {
      const nxt = ctx.peek();
      if (nxt && nxt.indent > indent) out[key] = parseBlock(ctx, nxt.indent);
      // YAML allows a sequence to sit at the same column as its key.
      else if (nxt && nxt.indent === indent && isSeqItem(nxt.text)) out[key] = parseSeq(ctx, indent);
      else out[key] = null;
    } else if (/^[|>][-+]?\d*$/.test(rest)) {
      out[key] = parseBlockScalar(ctx, rest, indent);
    } else {
      out[key] = parseScalar(rest, rec.n);
    }
  }
  return out;
}

function parseBlockScalar(ctx, header, parentIndent) {
  const style = header[0];
  const chomp = (header.match(/[-+]/) || [''])[0];
  const explicit = (header.match(/\d+/) || [null])[0];
  let contentIndent = explicit ? parentIndent + Number(explicit) : null;
  const lines = [];

  while (ctx.i < ctx.records.length) {
    const rec = ctx.records[ctx.i];
    if (rec.raw.trim() === '') {
      lines.push('');
      ctx.i++;
      continue;
    }
    const ind = rec.raw.search(/\S/);
    if (ind <= parentIndent) break;
    if (contentIndent === null) contentIndent = ind;
    if (ind < contentIndent) break;
    lines.push(rec.raw.slice(contentIndent));
    ctx.i++;
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  let body;
  if (style === '|') {
    body = lines.join('\n');
  } else {
    // Folded: newlines between non-empty lines become spaces, blank lines
    // become real newlines.
    const parts = [];
    for (const line of lines) {
      if (line === '') parts.push('\n');
      else if (parts.length && parts[parts.length - 1] !== '\n') parts[parts.length - 1] += ' ' + line;
      else parts.push(line);
    }
    body = parts.join('').replace(/\n(?!$)/g, '\n');
  }
  if (chomp === '-') return body;
  if (chomp === '+') return body + '\n';
  return body === '' ? '' : body + '\n';
}

function parseScalar(text, line) {
  const t = text.trim();
  if (t === '' || t === '~' || t === 'null' || t === 'Null' || t === 'NULL') return null;
  if (t === 'true' || t === 'True' || t === 'TRUE') return true;
  if (t === 'false' || t === 'False' || t === 'FALSE') return false;
  if (t[0] === '[' || t[0] === '{') return parseFlow(t, line);
  if (t[0] === '"' || t[0] === "'") return unquote(t);
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

function parseFlow(text, line) {
  const st = { text, i: 0, line };
  const value = flowValue(st);
  skipWs(st);
  if (st.i < st.text.length) {
    throw new YamlError(`unexpected "${st.text.slice(st.i)}" in flow value`, line);
  }
  return value;
}

const skipWs = (st) => {
  while (st.i < st.text.length && /\s/.test(st.text[st.i])) st.i++;
};

function flowValue(st) {
  skipWs(st);
  const c = st.text[st.i];
  if (c === '[') return flowSeq(st);
  if (c === '{') return flowMap(st);
  return parseScalar(flowPlain(st), st.line);
}

function flowSeq(st) {
  st.i++; // [
  const out = [];
  for (;;) {
    skipWs(st);
    if (st.i >= st.text.length) throw new YamlError('unterminated [', st.line);
    if (st.text[st.i] === ']') {
      st.i++;
      return out;
    }
    out.push(flowValue(st));
    skipWs(st);
    if (st.text[st.i] === ',') st.i++;
    else if (st.text[st.i] !== ']') throw new YamlError(`expected , or ] near "${st.text.slice(st.i)}"`, st.line);
  }
}

function flowMap(st) {
  st.i++; // {
  const out = {};
  for (;;) {
    skipWs(st);
    if (st.i >= st.text.length) throw new YamlError('unterminated {', st.line);
    if (st.text[st.i] === '}') {
      st.i++;
      return out;
    }
    const key = String(flowValue(st));
    skipWs(st);
    if (st.text[st.i] !== ':') throw new YamlError(`expected : after "${key}"`, st.line);
    st.i++;
    out[key] = flowValue(st);
    skipWs(st);
    if (st.text[st.i] === ',') st.i++;
    else if (st.text[st.i] !== '}') throw new YamlError(`expected , or } near "${st.text.slice(st.i)}"`, st.line);
  }
}

function flowPlain(st) {
  const q = st.text[st.i];
  if (q === '"' || q === "'") {
    const start = st.i;
    st.i++;
    while (st.i < st.text.length) {
      if (st.text[st.i] === '\\' && q === '"') st.i += 2;
      else if (st.text[st.i] === q) {
        if (q === "'" && st.text[st.i + 1] === "'") st.i += 2;
        else {
          st.i++;
          return st.text.slice(start, st.i);
        }
      } else st.i++;
    }
    throw new YamlError('unterminated quoted string', st.line);
  }
  const start = st.i;
  while (st.i < st.text.length) {
    const c = st.text[st.i];
    if (c === ',' || c === ']' || c === '}') break;
    // A colon ends a plain scalar only when it is acting as a key separator.
    if (c === ':') {
      const nxt = st.text[st.i + 1];
      if (nxt === undefined || /[\s,\]}]/.test(nxt)) break;
    }
    st.i++;
  }
  return st.text.slice(start, st.i).trim();
}

/* ====================== writing ====================== */

const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

function needsQuote(text) {
  if (text === '') return true;
  if (/^\s|\s$/.test(text)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return true;
  if (/: |\s#/.test(text)) return true;
  if (RESERVED.test(text)) return true;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return true;
  return false;
}

function scalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new YamlError(`cannot serialise ${value}`);
    return String(value);
  }
  const text = String(value);
  return needsQuote(text) ? JSON.stringify(text) : text;
}

const isScalar = (v) => v === null || v === undefined || typeof v !== 'object';

function flowify(value) {
  if (Array.isArray(value)) return `[${value.map(flowify).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([k, v]) => `${scalar(k)}: ${flowify(v)}`).join(', ')}}`;
  }
  return scalar(value);
}

/** Short, all-scalar collections read far better inline. */
function fitsFlow(value) {
  if (Array.isArray(value)) {
    if (!value.every((v) => isScalar(v) || (Array.isArray(v) && v.every(isScalar)))) return false;
    return flowify(value).length <= 72;
  }
  if (value && typeof value === 'object') {
    return Object.values(value).every((v) => isScalar(v) || (Array.isArray(v) && v.every(isScalar)))
      && flowify(value).length <= 72;
  }
  return false;
}

export function stringifyYaml(value) {
  const lines = [];
  emit(value, 0, lines);
  return lines.length ? lines.join('\n') + '\n' : '';
}

function emit(value, indent, lines) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(pad + '[]');
      return;
    }
    for (const item of value) emitSeqItem(item, indent, lines);
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      lines.push(pad + '{}');
      return;
    }
    for (const [k, v] of entries) emitPair(k, v, indent, lines);
    return;
  }
  emitScalarLine(value, pad, lines);
}

function emitSeqItem(item, indent, lines) {
  const pad = ' '.repeat(indent);
  if (item !== null && typeof item === 'object' && !fitsFlow(item)) {
    const sub = [];
    emit(item, indent + 2, sub);
    if (sub.length === 0) {
      lines.push(pad + '-');
      return;
    }
    lines.push(pad + '- ' + sub[0].slice(indent + 2));
    for (let i = 1; i < sub.length; i++) lines.push(sub[i]);
    return;
  }
  if (item !== null && typeof item === 'object') {
    lines.push(pad + '- ' + flowify(item));
    return;
  }
  if (typeof item === 'string' && item.includes('\n')) {
    lines.push(pad + '- |-');
    for (const line of item.replace(/\n+$/, '').split('\n')) lines.push(' '.repeat(indent + 4) + line);
    return;
  }
  lines.push(pad + '- ' + scalar(item));
}

function emitPair(key, value, indent, lines) {
  const pad = ' '.repeat(indent);
  const k = scalar(key);
  if (typeof value === 'string' && value.includes('\n')) {
    lines.push(`${pad}${k}: |-`);
    for (const line of value.replace(/\n+$/, '').split('\n')) lines.push(' '.repeat(indent + 2) + line);
    return;
  }
  if (value !== null && typeof value === 'object') {
    if (fitsFlow(value)) {
      lines.push(`${pad}${k}: ${flowify(value)}`);
      return;
    }
    lines.push(`${pad}${k}:`);
    emit(value, Array.isArray(value) ? indent : indent + 2, lines);
    return;
  }
  lines.push(`${pad}${k}: ${scalar(value)}`);
}

function emitScalarLine(value, pad, lines) {
  if (typeof value === 'string' && value.includes('\n')) {
    lines.push(pad + '|-');
    for (const line of value.replace(/\n+$/, '').split('\n')) lines.push(pad + '  ' + line);
    return;
  }
  lines.push(pad + scalar(value));
}
