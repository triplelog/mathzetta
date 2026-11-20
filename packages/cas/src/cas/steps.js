// Which steps to show, and which to explain.
//
//   steps: false                      no steps (fastest)
//   steps: true                       every step, explained (the default)
//   steps: 'brief'                    only the steps that carry the idea (see DETAIL)
//   steps: { show, hide, explain, detail }
//     show:    'all' or a list of rule ids and tags      steps to keep
//     hide:    a list of rule ids and tags                steps to fold away (after show)
//     explain: true | false | a list of ids and tags     which steps get their explanation
//     detail:  'full' | 'normal' | 'brief'               a preset for hide
//
// A hidden step is never lost: its change is folded into the next shown step,
// so each shown step goes from where the last one ended (the `from` of every
// step is the `to` of the one before). A shown step that absorbed hidden ones
// lists them in `also`.

/** Tags each detail level hides. Rules tag themselves (see rules/cas/*.yaml). */
export const DETAIL = {
  full: [],
  normal: ['hidden'],
  brief: ['hidden', 'tidy', 'identity', 'value', 'split', 'base', 'arithmetic'],
};

const matches = (step, list) => list === 'all' || list === '*' || (Array.isArray(list) && list.some((x) => x === step.id || step.tags?.includes(x)));

/** Normalize the `steps` option. */
export function stepOptions(option) {
  if (option === false) return null;
  if (option === undefined || option === true) return { show: 'all', hide: DETAIL.normal, explain: true };
  if (typeof option === 'string') {
    if (!DETAIL[option]) throw new Error(`steps: "${option}" is not one of ${Object.keys(DETAIL).join(', ')}`);
    return { show: 'all', hide: DETAIL[option], explain: true };
  }
  const detail = option.detail ?? 'normal';
  if (!DETAIL[detail]) throw new Error(`steps.detail: "${detail}" is not one of ${Object.keys(DETAIL).join(', ')}`);
  return {
    show: option.show ?? 'all',
    hide: [...DETAIL[detail], ...(option.hide ?? [])],
    explain: option.explain ?? true,
  };
}

/** The raw steps → the ones asked for. */
export function selectSteps(raw, options) {
  if (!options) return [];
  const out = [];
  let pending = null;   // hidden steps not yet folded into a shown one
  for (const step of raw) {
    const shown = matches(step, options.show) && !matches(step, options.hide);
    if (!shown) {
      pending = pending ?? { from: step.from, ids: [] };
      pending.ids.push(step.id);
      continue;
    }
    const s = { ...step };
    if (pending) {
      s.from = pending.from;
      s.also = pending.ids;
      // The highlighted part belongs to the expression before this step, not before the hidden ones.
      s.path = null;
      pending = null;
    }
    const explain = options.explain === true || (options.explain !== false && matches(step, options.explain));
    if (!explain) delete s.explanation;
    out.push(s);
  }
  // Hidden steps at the end belong to the last shown one (if every step was hidden, there are none).
  if (pending && out.length) {
    const last = out[out.length - 1];
    last.to = raw[raw.length - 1].to;
    last.also = [...(last.also ?? []), ...pending.ids];
  }
  return out;
}
