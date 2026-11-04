// 'calcrules' — the rule engine: expressions, operators, structure keys, requirements, rules, rewriting. See types.d.ts.
export type { Expr, NumNode, SymNode, OpNode, ExprInput, OperatorSpec, Collapsing, Predicate, RuleSpec, Rule, Match, Candidate, Applied, Step } from './types.js';
export {
    NUM, SYM, OP, ExprError, numToken, num, sym, exactNum, leaf, op, isNum, isSym, isOp, isLeaf, equal, tokenize, parse, fromPostfix,
    format, depth, nodeCount, leafTokens, isNumeric, walk, at, replaceAt,
    VARIADIC, CUSTOM_PREFIX, isCustomFunction, defineOperator, getOperator, isOperator, operators, clearOperators, defineDefaultOperators,
    SLOT, collapsings, keysAt, shapeKey, shapeLeaves,
    RequirementError, definePredicate, defineRelation, getPredicate, getRelation, predicateNames, relationNames, predicateList, relationList, normalizeCheck,
    MAX_VARIANTS, RuleError, compileRule, ruleToSpec, freeSymbols, RuleSet,
    matchNode, matchAll, instantiate, foldNumeric, renderExplanation, rewriteOf, applyMatch, findMatches, matchesAt, step, simplify, simplifyText,
    YamlError, parseYaml, stringifyYaml,
} from './types.js';
