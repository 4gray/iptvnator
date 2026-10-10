import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    removesOutline,
    splitTopLevel,
    walkDeclarations,
} from './check-focus-visible.mjs';

/**
 * Every keyboard focus indicator is drawn in the app ring colour: the
 * `focus-ring-declarations` mixin from `libs/ui/styles/_focus-ring.scss`, or
 * `var(--app-focus-ring)` (also inside `color-mix()`, where every other
 * colour mixed in must be neutral). Indicators drawn in
 * their own colour drifted from it: the selection blue many components used
 * falls to 2.6:1 on the stronger selection tint, where the token keeps 3:1
 * on every surface. A focus rule's outline, its ring- or line-shaped shadows
 * (unblurred) and its border colours are checked; a neutral boundary and a
 * blurred lift shadow are not indicators. Surfaces over video keep the
 * player's `--pc-*` palette; the few deliberate exceptions are listed below.
 */

/** Every app and library stylesheet. */
const SCANNED_PATHSPECS = [
    ':(glob)apps/web/src/**/*.scss',
    ':(glob)libs/**/*.scss',
];

/** A rule that styles focus. */
const FOCUS_SELECTOR =
    /:focus(?:-visible|-within)?\b|\.is-focused\b|\.cdk-keyboard-focused\b/i;

/** The custom property a `var()` reads (its fallback aside), or null. */
function propertyRead(colour) {
    return /^var\(\s*(--[\w-]+)\s*[,)]/i.exec(colour)?.[1] ?? null;
}

/**
 * The app ring token, or the player's own palette over video, by exact
 * name: `--app-focus-ring-other` is not the token. A fallback is never
 * drawn, since these tokens are always declared, so it is not checked.
 */
function isAppRing(colour) {
    const property = propertyRead(colour);
    return property === '--app-focus-ring' || /^--pc-[\w-]+$/.test(property);
}

/** Boundary tokens that do not signal focus. */
const NEUTRAL_TOKENS = new Set([
    '--app-separator',
    '--app-widget-border',
    '--app-rail-border',
    '--app-search-border',
]);

/** A boundary colour that does not signal focus. */
function isNeutral(colour) {
    return (
        /^(?:transparent|none)$/i.test(colour) ||
        NEUTRAL_TOKENS.has(propertyRead(colour))
    );
}

/** Text colour: fine for a border, a colour of its own for a ring. */
const TEXT_COLOUR = /^(?:currentcolor|inherit)$/i;

const LENGTH = /^-?(?:\d+|\d*\.\d+)(?:px|em|rem)?$/i;
const WIDTH_KEYWORD = /^(?:thin|medium|thick)$/i;
const LINE_STYLE =
    /^(?:auto|none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i;

/** The plain colours of a colour expression: each `color-mix()` argument. */
export function colourAtoms(expression) {
    return splitTopLevel(expression, /\s/).flatMap((token) => {
        const mix = /^color-mix\((.*)\)$/is.exec(token);
        if (!mix) return [token];
        // The first argument is the colour space; each other one is a
        // colour with an optional percentage on either side.
        return splitTopLevel(mix[1], /,/)
            .slice(1)
            .flatMap((argument) =>
                colourAtoms(
                    argument.replace(/(?:^|\s)-?[\d.]+%(?=\s|$)/g, ' ').trim()
                )
            );
    });
}

/** Tokens of a value that name colours: not lengths, widths or styles. */
function colourTokens(value) {
    return splitTopLevel(value, /\s/).filter(
        (token) =>
            !LENGTH.test(token) &&
            !WIDTH_KEYWORD.test(token) &&
            !LINE_STYLE.test(token)
    );
}

/**
 * The plain colours a focus rule's declaration draws its indicator with, or
 * an empty list when it draws none: an outline, the shadows that are rings
 * or lines (no blur, with a spread or an offset), and border colours. An
 * outline or shadow without a colour is drawn in `currentcolor`.
 */
export function indicatorColours(declaration) {
    const match = /^([a-z-]+)\s*:\s*(.+?)\s*(?:!important)?$/i.exec(
        declaration
    );
    if (!match) return [];
    const property = match[1].toLowerCase();
    const value = match[2];
    if (/^outline(?:-color)?$/.test(property)) {
        if (removesOutline(declaration)) return [];
        const colours = colourTokens(value);
        return (colours.length ? colours : ['currentcolor']).flatMap(
            colourAtoms
        );
    }
    if (property === 'box-shadow') {
        return splitTopLevel(value, /,/).flatMap((shadow) => {
            const tokens = splitTopLevel(shadow, /\s/).filter(
                (token) => token.toLowerCase() !== 'inset'
            );
            const lengths = tokens.filter((token) => LENGTH.test(token));
            const [x = '0', y = '0', blur = '0', spread = '0'] = lengths;
            const drawn = [x, y, spread].some((n) => parseFloat(n) !== 0);
            if (parseFloat(blur) !== 0 || !drawn) return [];
            const colours = tokens.filter((token) => !LENGTH.test(token));
            return (colours.length ? colours : ['currentcolor']).flatMap(
                colourAtoms
            );
        });
    }
    if (/^border(?:-(?:top|right|bottom|left))?(?:-color)?$/.test(property)) {
        return colourTokens(value).flatMap(colourAtoms);
    }
    return [];
}

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
];

function exceptionFor(file, declaration) {
    return RING_EXCEPTIONS.find(
        (exception) =>
            exception.file === file && declaration.includes(exception.value)
    );
}

/**
 * Focus indicators in one stylesheet with a colour other than the app ring,
 * the player palette or a neutral boundary, before exceptions apply.
 */
function offTokenIndicators(file, source) {
    return walkDeclarations(source).flatMap(
        ({ selectors, declaration, line }) => {
            const focus = selectors.find((selector) =>
                FOCUS_SELECTOR.test(selector)
            );
            if (!focus) return [];
            const border = /^border/i.test(declaration);
            const offToken = indicatorColours(declaration).some(
                (colour) =>
                    !isAppRing(colour) &&
                    !isNeutral(colour) &&
                    !(border && TEXT_COLOUR.test(colour))
            );
            return offToken
                ? [{ file, line, selector: focus, declaration }]
                : [];
        }
    );
}

/** Focus indicators in one stylesheet that bypass the app ring colour. */
export function findOffTokenRings(file, source) {
    return offTokenIndicators(file, source).filter(
        ({ declaration }) => !exceptionFor(file, declaration)
    );
}

/**
 * Exceptions that no longer excuse any off-token focus indicator, so the list
 * cannot rot: the same value elsewhere (a text colour) does not count.
 */
export function findUnusedExceptions(sources) {
    const used = new Set(
        sources.flatMap(({ file, source }) =>
            offTokenIndicators(file, source)
                .map(({ declaration }) => exceptionFor(file, declaration))
                .filter(Boolean)
        )
    );
    return RING_EXCEPTIONS.filter((exception) => !used.has(exception));
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
