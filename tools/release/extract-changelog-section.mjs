#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md section for one version to stdout.
 *
 *   node tools/release/extract-changelog-section.mjs 0.24.0
 *
 * Used by the tag-build release job to put the authored notes into the
 * GitHub release body. `.changes/*.md` files are consumed before the tag
 * exists, so at tag time the changelog section IS the authored source of
 * truth — this reads what the generator already wrote.
 *
 * Exits non-zero when the section is missing so a forgotten
 * `release:notes:changelog` fails the release instead of silently shipping
 * PR-title-only notes.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

/**
 * @param {string} changelog full CHANGELOG.md content
 * @param {string} version bare semver, e.g. `0.24.0`
 * @returns {string | null} section body without its own H1 heading
 */
export function extractSection(changelog, version) {
    const lines = changelog.replace(/\r\n/g, '\n').split('\n');
    // The CLI validates its argument, but this function is exported on its
    // own — escape every regex metacharacter rather than only dots so no
    // caller can inject pattern syntax.
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Matches both heading shapes used in this file:
    //   # [0.24.0](compare-url) (2026-08-01)
    //   # 0.24.0 (2026-08-01)
    const headingPattern = new RegExp(
        `^#\\s+\\[?${escapedVersion}\\]?\\s*[( ]`
    );
    const start = lines.findIndex((line) => headingPattern.test(line));

    if (start === -1) {
        return null;
    }

    let end = lines.length;

    for (let index = start + 1; index < lines.length; index += 1) {
        if (/^#\s/.test(lines[index])) {
            end = index;
            break;
        }
    }

    return lines.slice(start + 1, end).join('\n').trim();
}

function main() {
    const version = process.argv[2];

    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
        console.error(
            'Usage: extract-changelog-section.mjs <version>  (for example 0.24.0)'
        );
        process.exit(2);
    }

    const changelogPath = path.join(workspaceRoot, 'CHANGELOG.md');
    const section = extractSection(readFileSync(changelogPath, 'utf8'), version);

    if (section === null) {
        console.error(
            [
                `CHANGELOG.md has no section for ${version}.`,
                'The release flow writes it before tagging:',
                '  pnpm run release:notes:changelog',
                '  node tools/release/build-release-notes.mjs --consume',
                'Commit the changelog, then re-tag.',
            ].join('\n')
        );
        process.exit(1);
    }

    if (section === '') {
        console.error(`CHANGELOG.md section for ${version} is empty.`);
        process.exit(1);
    }

    process.stdout.write(`${section}\n`);
}

// Allow importing extractSection from tests without running the CLI.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
