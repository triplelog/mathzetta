// Tiny zero-dependency test harness that runs in node and the browser.

const suites = [];
let current = null;

export function suite(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function test(name, fn) {
  if (!current) throw new Error('test() must be called inside suite()');
  current.tests.push({ name, fn });
}

export function assert(cond, message = 'assertion failed') {
  if (!cond) throw new Error(message);
}

export function equal(actual, expected, message = '') {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}\n  expected: ${format(expected)}\n  actual:   ${format(actual)}`);
  }
}

export function deepEqual(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected: ${b}\n  actual:   ${a}`);
}

export function throws(fn, match, message = 'expected a throw') {
  try {
    fn();
  } catch (err) {
    if (match && !String(err.message).includes(match)) {
      throw new Error(`${message}: message "${err.message}" does not contain "${match}"`);
    }
    return;
  }
  throw new Error(message);
}

const format = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

export function run({ log = console.log } = {}) {
  let passed = 0;
  const failures = [];
  for (const s of suites) {
    log(`\n${s.name}`);
    for (const t of s.tests) {
      try {
        t.fn();
        passed++;
        log(`  ok   ${t.name}`);
      } catch (err) {
        failures.push({ suite: s.name, test: t.name, err });
        log(`  FAIL ${t.name}`);
      }
    }
  }
  log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) {
    log(`\n--- ${f.suite} > ${f.test}\n${f.err.message}`);
    if (f.err.stack && !f.err.message.includes('\n')) log(f.err.stack.split('\n').slice(1, 3).join('\n'));
  }
  return { passed, failed: failures.length, failures };
}
