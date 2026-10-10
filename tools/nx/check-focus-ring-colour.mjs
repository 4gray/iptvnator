import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { removesOutline, walkDeclarations } from './check-focus-visible.mjs';

/**
 * Every keyboard focus ring is the app ring: the `focus-ring-declarations`
 * mixin from `libs/ui/styles/_focus-ring.scss`, or `var(--app-focus-ring)`.
 * Rings drawn in their own colour drifted from it: the selection blue many
 * components used falls to 2.6:1 on the stronger selection tint, where the
 * token keeps 3:1 on every surface. Surfaces over video keep the player's
 * `--pc-*` palette; the few deliberate exceptions are listed below.
 */

/** Every app and library stylesheet. */
const SCANNED_PATHSPECS = [
    ':(glob)apps/web/src/**/*.scss',
    ':(glob)libs/**/*.scss',
];

/** A rule that styles focus. */
const FOCUS_SELECTOR =
    /:focus(?:-visible|-within)?\b|\.is-focused\b|\.cdk-keyboard-focused\b/i;

/** The app ring token, or the player's own palette over video. */
const APP_RING = /var\(\s*--(?:app-focus-ring|pc-)/i;

/** Rings that deliberately differ, matched by file and value. */
export const RING_EXCEPTIONS = [
    {
        file: 'libs/ui/playback/src/lib/player-controls/player-controls.component.scss',
        value: '#ffffff',
        reason: 'the play button rings white around its own blue fill',
    },
    {
        file: 'libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.scss',
        value: '#ffb24c',
        reason: "the diagnostic's amber accent on its near-black scrim (a spec loads this stylesheet as raw CSS)",
    },
    {
        file: 'apps/web/src/app/settings/settings.component.scss',
        value: 'color-mix(in srgb, var(--app-selection-color) 60%, transparent)',
        reason: 'marks a row that settings search revealed (tabindex="-1", not a Tab stop)',
    },
];

function isException(file, declaration) {
    return RING_EXCEPTIONS.some(
        (exception) =>
            exception.file === file && declaration.includes(exception.value)
    );
}

/** Focus rings in one stylesheet that bypass the app ring. */
export function findOffTokenRings(file, source) {
    return walkDeclarations(source).flatMap(
        ({ selectors, declaration, line }) => {
            const focus = selectors.find((selector) =>
                FOCUS_SELECTOR.test(selector)
            );
            const drawsRing =
                /^outline(?:-color)?\s*:/i.test(declaration) &&
                !removesOutline(declaration);
            return focus &&
                drawsRing &&
                !APP_RING.test(declaration) &&
                !isException(file, declaration)
                ? [{ file, line, selector: focus, declaration }]
                : [];
        }
    );
}

/** Exceptions that no longer match any declaration, so the list cannot rot. */
export function findUnusedExceptions(sources) {
    return RING_EXCEPTIONS.filter(
        (exception) =>
            !sources.some(
                ({ file, source }) =>
                    file === exception.file &&
                    walkDeclarations(source).some(({ declaration }) =>
                        declaration.includes(exception.value)
                    )
            )
    );
}

/** Tracked app and library stylesheets under `rootDir`. */
export function listScannedFiles(rootDir) {
    // No shell: `cmd.exe` treats single quotes as literal characters, so a
    // POSIX-quoted pathspec reaches git intact on Windows and matches nothing.
    return execFileSync('git', ['ls-files', ...SCANNED_PATHSPECS], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })
        .trim()
        .split('\n')
        .filter(Boolean);
}

/** Every problem across the stylesheets, as printable lines. */
export function checkFocusRingColour(sources) {
    return [
        ...sources.flatMap(({ file, source }) =>
            findOffTokenRings(file, source).map(
                ({ file: at, line, selector, declaration }) =>
                    `${at}:${line} \`${selector}\` sets \`${declaration}\``
            )
        ),
        ...findUnusedExceptions(sources).map(
            ({ file, value }) =>
                `${file}: the exception for \`${value}\` matches nothing; remove it from RING_EXCEPTIONS`
        ),
    ];
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    const files = listScannedFiles(rootDir);
    const sources = await Promise.all(
        files.map(async (file) => ({
            file,
            source: await readFile(path.join(rootDir, file), 'utf8'),
        }))
    );
    const problems = checkFocusRingColour(sources);
    if (problems.length > 0) {
        console.error(
            'Focus rings bypass the app ring. Use `@include focus-ring.focus-ring-declarations` (libs/ui/styles/_focus-ring.scss) or `var(--app-focus-ring)`:'
        );
        for (const problem of problems) console.error(`- ${problem}`);
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} stylesheets; every focus ring uses the app ring.`
        );
    }
}
