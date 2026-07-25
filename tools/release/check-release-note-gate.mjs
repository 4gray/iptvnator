#!/usr/bin/env node
/**
 * Release-note gate policy for pull requests.
 *
 * The CI job feeds it `{files: [{filename, status}], labels: [...]}` on
 * stdin (from the GitHub PR API) and it decides whether the PR needs a
 * `.changes/*.md` note. Kept as a pure function so the policy is unit-tested
 * instead of living in workflow bash.
 *
 * Policy: a PR that touches runtime code under `apps/` or `libs/` must add
 * one release note, unless it carries the `no-release-note` label. Test-only,
 * website, e2e, and mock-server changes never require a note.
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const GATE_LABEL = 'no-release-note';

/** Paths that count as user-visible runtime code. */
const TRIGGER_PREFIXES = ['apps/', 'libs/'];

/**
 * Changes matching any of these never require a note, even under a trigger
 * prefix. Mirrors the "when a note is not needed" list in .changes/README.md.
 */
const EXEMPT_PATTERNS = [
    /^apps\/website\//, // marketing site, not the app
    /^apps\/[^/]*-e2e\//, // e2e projects
    /^apps\/[^/]*mock-server\//, // dev/e2e fixtures
    /\.spec\.[jt]s$/,
    /\.e2e\.[jt]s$/,
    /\/__snapshots__\//,
    /\/testing\//, // libs/shared/testing and test-helper folders
    /\.md$/, // docs anywhere
];

/**
 * @param {{ filename: string }} file
 * @returns {boolean} true when this change requires a release note
 */
function requiresNote(file) {
    const { filename } = file;

    if (!TRIGGER_PREFIXES.some((prefix) => filename.startsWith(prefix))) {
        return false;
    }

    return !EXEMPT_PATTERNS.some((pattern) => pattern.test(filename));
}

/**
 * @param {{ filename: string, status: string }} file
 * @returns {boolean} true when this file satisfies the gate
 */
function isAddedNote(file) {
    return (
        file.filename.startsWith('.changes/') &&
        file.filename.endsWith('.md') &&
        !file.filename.endsWith('README.md') &&
        (file.status === 'added' || file.status === 'renamed')
    );
}

/**
 * @param {{ files: {filename: string, status: string}[], labels: string[] }} input
 * @returns {{ ok: boolean, message: string }}
 */
export function evaluateGate({ files, labels }) {
    if (labels.includes(GATE_LABEL)) {
        return {
            ok: true,
            message: `Label \`${GATE_LABEL}\` present — release note not required.`,
        };
    }

    const triggering = files.filter(requiresNote);

    if (triggering.length === 0) {
        return {
            ok: true,
            message:
                'No runtime code changed under apps/ or libs/ — release note not required.',
        };
    }

    const notes = files.filter(isAddedNote);

    if (notes.length > 0) {
        return {
            ok: true,
            message: `Release note present: ${notes.map((note) => note.filename).join(', ')}`,
        };
    }

    const shown = triggering.slice(0, 10).map((file) => `  ${file.filename}`);
    const more =
        triggering.length > shown.length
            ? [`  … and ${triggering.length - shown.length} more`]
            : [];

    return {
        ok: false,
        message: [
            'This PR changes runtime code but adds no release note.',
            '',
            'Changed files that require one:',
            ...shown,
            ...more,
            '',
            'Add a file like `.changes/<area>-<short-slug>.md` describing the',
            'change for a user (see .changes/README.md for the format), or apply',
            `the \`${GATE_LABEL}\` label if this PR has no user-visible effect`,
            '(pure refactor, CI plumbing, tests).',
        ].join('\n'),
    };
}

function main() {
    let raw = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
        raw += chunk;
    });
    process.stdin.on('end', () => {
        const input = JSON.parse(raw);

        if (!Array.isArray(input.files) || !Array.isArray(input.labels)) {
            console.error(
                'Expected {files: [{filename, status}], labels: [...]} on stdin.'
            );
            process.exit(2);
        }

        const verdict = evaluateGate(input);

        console.log(verdict.message);
        process.exit(verdict.ok ? 0 : 1);
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
