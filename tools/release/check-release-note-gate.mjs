#!/usr/bin/env node
/**
 * Release-note gate policy for pull requests.
 *
 * With --merge-checkout, CI passes live PR labels as a JSON array on stdin.
 * Changed files come from the checked-out merge commit and its first parent.
 * The default JSON input is `{files: [{filename, status}], labels: [...]}`.
 *
 * Policy: a PR that touches runtime code under `apps/` or `libs/` must add
 * one release note, unless it carries the `no-release-note` label. Test-only,
 * website, e2e, and mock-server changes never require a note.
 */

import { execFileSync } from 'node:child_process';
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
 * Only a note this PR actually authored satisfies the gate.
 *
 * `status: 'added'` exclusively: a note created and then renamed inside
 * the same PR still appears as added in the merge diff. A renamed entry
 * comes from a file already present on the base. The generator resolves PR
 * links from the commit that added a note, so moving an older note cannot
 * satisfy the gate.
 *
 * Direct children only: `loadNotes()` reads the immediate `.changes/`
 * directory, so a nested `.changes/sub/note.md` would satisfy a prefix check
 * while never being validated or rendered into any release surface.
 *
 * @param {{ filename: string, status: string }} file
 * @returns {boolean} true when this file satisfies the gate
 */
function isAddedNote(file) {
    const match = file.filename.match(/^\.changes\/([^/]+)\.md$/);

    return Boolean(match) && match[1] !== 'README' && file.status === 'added';
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
        const parsed = JSON.parse(raw);
        const input = process.argv.includes('--merge-checkout')
            ? { files: filesFromMergeCheckout(), labels: parsed }
            : parsed;

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

function filesFromMergeCheckout() {
    const diff = execFileSync(
        'git',
        [
            'diff',
            '--name-status',
            '-z',
            '--find-renames',
            '--ignore-submodules=none',
            'HEAD^1',
            'HEAD',
            '--',
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    const fields = diff.split('\0');
    const files = [];
    for (let index = 0; index < fields.length - 1; ) {
        const code = fields[index++][0];
        const filename = fields[index++];
        if (code === 'R') {
            files.push({ filename, status: 'removed' });
            files.push({ filename: fields[index++], status: 'renamed' });
        } else if (code === 'C') {
            files.push({ filename: fields[index++], status: 'added' });
        } else {
            files.push({ filename, status: code === 'A' ? 'added' : 'changed' });
        }
    }
    return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
