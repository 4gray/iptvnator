/**
 * Single source of truth for the max-lines rule.
 *
 * Both eslint.config.mjs (which enforces the rule) and
 * generate-max-lines-baseline.mjs (which lists the files that predate it) import
 * from here, so the enforced limit and the generated baseline can never drift
 * apart.
 */

/**
 * Production TypeScript. CLAUDE.md asks for under 300 lines; this is the hard
 * ceiling CI enforces.
 */
export const MAX_LINES_PROD = 400;

/**
 * Tests and test infrastructure. A spec is a flat list of independent cases:
 * splitting one at the production limit yields arbitrary `-2.spec.ts` files and
 * makes coverage harder to find, and a long spec signals thorough coverage
 * rather than the design debt the production limit is meant to catch. The
 * ceiling is still bounded so a runaway fixture gets noticed.
 */
export const MAX_LINES_TEST = 1200;

/**
 * Comments and blank lines are not counted. This repo mandates documentation
 * (see "Documentation After Changes" in CLAUDE.md), so a docblock must never be
 * the reason a file has to be split.
 */
export const MAX_LINES_OPTIONS = {
    skipBlankLines: true,
    skipComments: true,
};

/**
 * Specs, E2E specs, and everything inside the E2E apps — the latter covers
 * fixtures, harnesses and performance capture helpers, which are test
 * infrastructure even though they carry no `.spec`/`.e2e` suffix.
 */
export const TEST_FILE_GLOBS = [
    '**/*.spec.ts',
    '**/*.e2e.ts',
    'apps/*-e2e/**/*.ts',
];
