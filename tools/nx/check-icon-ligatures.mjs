import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    iconNamesInTemplate,
    iconNamesInTypeScript,
} from './icon-ligature-sources.mjs';

/**
 * `<mat-icon>` draws its text through the Material Icons font's ligatures.
 * A name the font does not know renders as the literal text ("file_off"),
 * overflowing the 24px box, and nothing fails at build or test time. This
 * guard checks every statically visible icon name against the codepoints
 * file shipped with the font the app loads (`apps/web/src/styles.scss`).
 */
export const FONT_PACKAGE = 'material-design-icons-iconfont';
const CODEPOINTS = `${FONT_PACKAGE}/dist/fonts/MaterialIcons-Regular.json`;

/** Renderer sources: the font only exists in the Angular app. */
const SCANNED_PATHSPECS = [
    'apps/web/*.html',
    'apps/web/*.ts',
    'libs/*.html',
    'libs/*.ts',
];

function isScanned(file) {
    return !/\.(spec|test)\.[cm]?[jt]s$/.test(file);
}

/** Ligature names of the bundled font. */
export async function loadLigatures() {
    const require = createRequire(import.meta.url);
    const codepoints = JSON.parse(
        await readFile(require.resolve(CODEPOINTS), 'utf8')
    );
    return new Set(Object.keys(codepoints));
}

/** Icon names in one source file that the font cannot draw. */
export function findUnknownIcons(file, source, ligatures) {
    const found = file.endsWith('.html')
        ? iconNamesInTemplate(source, file)
        : iconNamesInTypeScript(source, file);
    return found
        .filter(({ name }) => looksLikeIconName(name))
        .filter(({ name }) => !ligatures.has(name))
        .map((entry) => ({ file, ...entry }));
}

/**
 * An `icon` value can legitimately be an image URL or inline SVG markup; only
 * single words are meant as ligatures.
 */
function looksLikeIconName(name) {
    return /^[A-Za-z0-9_-]+$/.test(name);
}

/** Tracked renderer files the guard reads, at any depth. */
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
        .filter(Boolean)
        .filter(isScanned);
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    const ligatures = await loadLigatures();
    const files = listScannedFiles(rootDir);

    const findings = [];
    for (const file of files) {
        const source = await readFile(path.join(rootDir, file), 'utf8');
        findings.push(...findUnknownIcons(file, source, ligatures));
    }

    if (findings.length > 0) {
        console.error(
            `Icon names missing from the Material Icons font (${CODEPOINTS}). The font renders them as plain text; pick a listed name:`
        );
        for (const { file, line, name, source } of findings) {
            console.error(`- ${file}:${line} ${name} (${source})`);
        }
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} renderer files against ${ligatures.size} Material Icons ligatures; every static icon name exists.`
        );
    }
}
