// A small infix printer for explanations: "x^2 + 3x - 1", "sqrt(2)/2", "sin(x)".
// It is not MathZetta's toText; a page that has MathZetta passes
// `format: (node) => toText(node.s.split(' '))` (or toLaTeX) to createCAS instead.

const PREC = { '=': 1, '≠': 1, '<': 1, '>': 1, '≤': 1, '≥': 1, '+': 2, '-': 2, '±': 2, '*': 3, '/': 3, neg: 4, pm: 4, '^': 5 };
const SYMBOLS = { pi: 'π', '≤': '≤', '≥': '≥' };

export function toText(node) {
  return print(node).text;
}

function wrap(part, need, right = false) {
  return part.prec < need || (right && part.prec === need) ? `(${part.text})` : part.text;
}

// a + (b + c) is written a + b + c, and 2·(x·y) 2·x·y: the same value however it's grouped.
// A negative on the right keeps its brackets (a + (-b), 2·(-3)), and so does anything looser.
const opOf = (node) => (node.type === 'op' ? node.op : null);
const negative = (part) => part.text.startsWith('-');
const BRACKETS = { '()': ['(', ')'], '[]': ['[', ']'], '{}': ['{', '}'], '(]': ['(', ']'], '[)': ['[', ')'] };

function print(node) {
  if (node.type === 'num') return { text: node.token, prec: node.token.startsWith('-') ? 4 : 9 };
  if (node.type === 'sym') return { text: SYMBOLS[node.token] ?? node.token, prec: 9 };
  const a = node.args.map(print);
  const p = PREC[node.op];
  switch (node.op) {
    case '+': case '-': case '±': {
      const tight = node.op === '+' && ['+', '-'].includes(opOf(node.args[1]));
      const right = negative(a[1]) ? `(${a[1].text})` : tight ? a[1].text : wrap(a[1], p, true);
      return { text: `${wrap(a[0], p)} ${node.op === '±' ? '±' : node.op} ${right}`, prec: p };
    }
    case '*': {
      // 2x, 2 sqrt(3), but x·y and 2·3
      const left = wrap(a[0], p);
      const right = negative(a[1]) ? `(${a[1].text})` : opOf(node.args[1]) === '*' ? a[1].text : wrap(a[1], p, true);
      // and πi, 2πi: the imaginary unit after a symbol
      const juxtapose = (node.args[0].type === 'num' && node.args[1].type !== 'num' && !/^[\d(-]/.test(right))
        || (node.args[1].type === 'sym' && node.args[1].token === 'i' && !/[\dA-Za-z]$/.test(left));
      return { text: juxtapose ? `${left}${right}` : `${left}·${right}`, prec: p };
    }
    case '/': return { text: `${wrap(a[0], p)}/${wrap(a[1], p, true)}`, prec: p };
    case '^': return { text: `${wrap(a[0], p + 1)}^${wrap(a[1], p)}`, prec: p };
    // -x·y needs no brackets (it is -(x·y) either way); -(x + y) does
    case 'neg': return { text: `-${wrap(a[0], 3)}`, prec: 4 };
    case 'pm': return { text: `±${wrap(a[0], 4)}`, prec: 4 };
    case '!': return { text: `${wrap(a[0], 9)}!`, prec: 6 };
    case 'abs': return { text: `|${a[0].text}|`, prec: 9 };
    case 'root': return { text: `root(${a[0].text}, ${a[1].text})`, prec: 9 };
    case 'der':   // at a point (der(f, x = a)): d/dx (f) at x = a
      if (node.args[1].type === 'op' && node.args[1].op === '=') return { text: `d/d${a[1].text.split(' = ')[0]} (${a[0].text}) at ${a[1].text}`, prec: 1 };
      return { text: `d/d${a[1].text} (${a[0].text})`, prec: 6 };
    case 'int':
      return { text: a.length === 4 ? `∫ from ${a[2].text} to ${a[3].text} of ${a[0].text} d${a[1].text}` : `∫ ${a[0].text} d${a[1].text}`, prec: 1 };
    case '|': return { text: `${a[0].text} or ${a[1].text}`, prec: 0 };
    case '_': return { text: `${wrap(a[0], 9)}_${a[1].prec >= 9 && !/\s/.test(a[1].text) ? a[1].text : `(${a[1].text})`}`, prec: 9 };
    case '()': case '[]': case '{}': case '(]': case '[)':
      return { text: `${BRACKETS[node.op][0]}${a.map((x) => x.text).join(', ')}${BRACKETS[node.op][1]}`, prec: 9 };
    case '&': return { text: `${a[0].text} and ${a[1].text}`, prec: 0 };
    default:
      if (p !== undefined) return { text: `${wrap(a[0], p)} ${node.op} ${wrap(a[1], p, true)}`, prec: p };
      return { text: `${node.op.replace(/^\\:?/, '')}(${a.map((x) => x.text).join(', ')})`, prec: 9 };
  }
}
