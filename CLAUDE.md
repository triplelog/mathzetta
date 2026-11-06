# CLAUDE.md — triplelog/mathzetta (public)

Three libraries as npm workspaces, each with its own CLAUDE.md — open it before editing that package:

- `packages/mathzetta` — the parser and every output (npm `mathzetta`, 1.x). The contract is its
  `docs/postfix.md`: renaming an operator or changing a postfix touches all three packages.
- `packages/inlinemath` — drawing (npm `@mathzetta/inlinemath`, unpublished 0.x). Peer of mathzetta; MathZetta CAS
  is an optional peer for `@mathzetta/inlinemath/cas`.
- `packages/cas` — rule rewriting and the CAS (npm `@mathzetta/cas/engine`, unpublished 0.x). `src/ops.js`
  mirrors mathzetta's operator table.

```bash
npm install          # at the root: links the packages to each other (node_modules/<name> → packages/<name>)
npm test             # build, then every package's tests
npm test -w mathzetta    # one package
npm run build        # packages/mathzetta/build/ and packages/inlinemath/dist/ (both gitignored)
```

## Rules

- **This repository is public.** Libraries only: no web pages, no site chrome, nothing from the closed
  projects (the tabdn servers, pyslots, mathtutor, the videos, the sites' registry). Link to them by
  public URL only. The web sites (mathzetta.com, inlinemath.com, the MathZetta CAS playground) live in the
  private repository mathzetta-website, which uses these packages through `file:` links.
- Packages import each other by name (`'mathzetta'`, `'mathzetta/speech'`, `'@mathzetta/cas'`), never
  by path; inside the repository a relative path between packages is only for test data
  (inlinemath's test reads mathzetta's `test/cases/calculus.tsv` through `import.meta.resolve`).
- Each package keeps its own version. A release is `npm publish` in the package's folder.
- Keep every existing test; update expectations only after reviewing the diff.
- After changing mathzetta's parser, `evaluate` or `html`, the projects built on it outside this
  repository have tests too (the collection's `tools/test-all.sh`, in the folder above).
