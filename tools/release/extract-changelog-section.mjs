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

const INTERNAL_DETAILS_BLOCK =
    /(?:^|\n\n)<details>\n<summary>Internal changes<\/summary>\n\n[\s\S]*?\n\n<\/details>(?=\n\n|$)/g;
const CLI_USAGE =
    'Usage: extract-changelog-section.mjs [--public] <version>';

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

/**
 * @param {string} changelog full CHANGELOG.md content
 * @param {string} version bare semver, e.g. `0.24.0`
 * @returns {string | null} public section body without internal details
 */
export function extractPublicSection(changelog, version) {
    const section = extractSection(changelog, version);

    return section === null
        ? null
        : section.replace(INTERNAL_DETAILS_BLOCK, '').trim();
}

export function parseExtractArguments(args) {
    const publicFlagCount = args.filter(
        (argument) => argument === '--public'
    ).length;
    const positional = args.filter(
        (argument) => argument !== '--public'
    );

    if (
        publicFlagCount > 1 ||
        positional.length !== 1 ||
        !/^\d+\.\d+\.\d+$/.test(positional[0])
    ) {
        return null;
    }

    return {
        version: positional[0],
        publicOnly: publicFlagCount === 1,
    };
}

export function runExtractorCli(changelog, args) {
    const options = parseExtractArguments(args);

    if (options === null) {
        return { exitCode: 2, stdout: '', stderr: `${CLI_USAGE}\n` };
    }

    const section = options.publicOnly
        ? extractPublicSection(changelog, options.version)
        : extractSection(changelog, options.version);

    if (section === null) {
        return {
            exitCode: 1,
            stdout: '',
            stderr: `${[
                `CHANGELOG.md has no section for ${options.version}.`,
                'The release flow writes it before tagging:',
                '  pnpm run release:notes:changelog',
                '  node tools/release/build-release-notes.mjs --consume',
                'Commit the changelog, then re-tag.',
            ].join('\n')}\n`,
        };
    }

    if (section === '' && !options.publicOnly) {
        return {
            exitCode: 1,
            stdout: '',
            stderr: `CHANGELOG.md section for ${options.version} is empty.\n`,
        };
    }

    return {
        exitCode: 0,
        stdout: section === '' ? '' : `${section}\n`,
        stderr: '',
    };
}

export function runExtractorProcess(args, readChangelog) {
    if (parseExtractArguments(args) === null) {
        return runExtractorCli('', args);
    }

    return runExtractorCli(readChangelog(), args);
}

function main() {
    const changelogPath = path.join(workspaceRoot, 'CHANGELOG.md');
    const result = runExtractorProcess(
        process.argv.slice(2),
        () => readFileSync(changelogPath, 'utf8')
    );

    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
}

// Allow importing extractSection from tests without running the CLI.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
