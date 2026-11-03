// A ruleset is the key -> bindings index, plus the depth cap that keeps key
// generation bounded.

import { compileRule, ruleToSpec, RuleError, DEFAULT_MODE } from './rule.js';
import { parseYaml, stringifyYaml } from './yaml.js';

export class RuleSet {
  constructor(rules = []) {
    /** @type {Map<string, object[]>} structure key -> candidate bindings */
    this.index = new Map();
    this.rules = [];
    /** Deepest pattern present; key generation never goes beyond it. */
    this.maxDepth = 0;
    this.name = '';
    /** Cached single-mode sub-rulesets, dropped whenever the rules change. */
    this.views = new Map();
    for (const r of rules) this.add(r);
  }

  add(spec) {
    const rule = spec && spec.bindings ? spec : compileRule(spec);
    if (this.rules.some((r) => r.id === rule.id)) {
      throw new RuleError(`duplicate rule id "${rule.id}"`);
    }
    this.rules.push(rule);
    if (rule.enabled) this.link(rule);
    if (rule.depth > this.maxDepth) this.maxDepth = rule.depth;
    this.views.clear();
    return rule;
  }

  /**
   * The rules belonging to one mode, as a ruleset of their own. Each mode gets
   * its own key index and its own depth cap, so simplification rules cost
   * nothing while differentiating and vice versa.
   */
  view(mode) {
    if (!mode) return this;
    let sub = this.views.get(mode);
    if (!sub) {
      sub = new RuleSet(this.rules.filter((r) => r.mode === mode));
      sub.name = this.name;
      this.views.set(mode, sub);
    }
    return sub;
  }

  /** Modes present, with `simplify` first when it is there at all. */
  modes() {
    const found = [...new Set(this.rules.map((r) => r.mode))];
    return found.sort((a, b) => (a === DEFAULT_MODE ? -1 : b === DEFAULT_MODE ? 1 : a.localeCompare(b)));
  }

  link(rule) {
    for (const binding of rule.bindings) {
      let list = this.index.get(binding.key);
      if (!list) this.index.set(binding.key, (list = []));
      list.push(binding);
      // More specific patterns first, then explicit priority, then insertion.
      list.sort((a, b) => b.rule.priority - a.rule.priority || b.rule.depth - a.rule.depth);
    }
  }

  remove(id) {
    const i = this.rules.findIndex((r) => r.id === id);
    if (i === -1) return false;
    this.rules.splice(i, 1);
    this.reindex();
    return true;
  }

  setEnabled(id, enabled) {
    const rule = this.get(id);
    if (!rule) return false;
    rule.enabled = !!enabled;
    this.reindex();
    return true;
  }

  reindex() {
    this.index = new Map();
    this.maxDepth = 0;
    this.views.clear();
    for (const rule of this.rules) {
      if (rule.enabled) this.link(rule);
      if (rule.depth > this.maxDepth) this.maxDepth = rule.depth;
    }
  }

  get(id) {
    return this.rules.find((r) => r.id === id) || null;
  }

  candidates(key) {
    return this.index.get(key) || null;
  }

  get size() {
    return this.rules.length;
  }

  /**
   * Accepts either a bare list of rules or `{ name, rules: [...] }`.
   * Collects every compile error instead of dying on the first one, so a
   * typo in rule 12 still tells you about the typo in rule 30.
   */
  static fromYaml(text, { strict = true } = {}) {
    const doc = parseYaml(text);
    return RuleSet.fromSpecs(doc, { strict });
  }

  static fromSpecs(doc, { strict = true } = {}) {
    let specs = doc;
    let name = '';
    if (doc && !Array.isArray(doc) && typeof doc === 'object') {
      specs = doc.rules;
      name = doc.name ? String(doc.name) : '';
    }
    if (!Array.isArray(specs)) {
      throw new RuleError('expected a list of rules, or a mapping with a "rules" list');
    }
    const set = new RuleSet();
    set.name = name;
    const errors = [];
    for (let i = 0; i < specs.length; i++) {
      try {
        set.add(specs[i]);
      } catch (err) {
        errors.push(`#${i + 1}: ${err.message}`);
      }
    }
    if (errors.length && strict) {
      throw new RuleError(`${errors.length} rule(s) failed to compile:\n  ${errors.join('\n  ')}`);
    }
    set.errors = errors;
    return set;
  }

  toSpecs() {
    return this.rules.map(ruleToSpec);
  }

  toYaml() {
    const specs = this.toSpecs();
    return this.name ? stringifyYaml({ name: this.name, rules: specs }) : stringifyYaml(specs);
  }

  /** Debug view: which shapes are covered, and by what. */
  keyReport() {
    return [...this.index.entries()]
      .map(([key, bindings]) => ({ key, rules: bindings.map((b) => b.rule.id) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
}
