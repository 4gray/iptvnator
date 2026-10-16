import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Angular Material 19 renamed every `--mdc-*` component token to `--mat-*`,
 * and Material 22 reads none of the old names. An `--mdc-*` declaration
 * therefore compiles, looks intentional, and silently does nothing; a
 * `var(--mdc-*)` read always resolves to its fallback. Component tokens must
 * be set through the `mat.*-overrides()` mixins, which reject unknown names at
 * build time.
 */
const DEAD_MATERIAL_TOKEN = /--mdc-[a-z0-9-]+/g;

/** Source files whose styles or templates can carry component tokens. */
const SCANNED_PATHSPECS = [
    'apps/*.scss',
    'apps/*.css',
    'apps/*.ts',
    'apps/*.html',
    'libs/*.scss',
    'libs/*.css',
    'libs/*.ts',
    'libs/*.html',
];

/** Tests and this guard's own fixtures may name the retired prefix. */
function isScanned(file) {
    return !/\.(spec|test)\.[cm]?[jt]s$/.test(file);
}

export function findDeadMaterialTokens(file, source) {
    const findings = [];
    source.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(DEAD_MATERIAL_TOKEN)) {
            findings.push({ file, line: index + 1, token: match[0] });
        }
    });
    return findings;
}

/** Tracked files under `rootDir` that the guard reads, at any depth. */
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
    const files = listScannedFiles(rootDir);

    const findings = [];
    for (const file of files) {
        const source = await readFile(path.join(rootDir, file), 'utf8');
        findings.push(...findDeadMaterialTokens(file, source));
    }

    if (findings.length > 0) {
        console.error(
            'Retired Angular Material --mdc-* tokens found. Material 22 ignores them; use the matching mat.*-overrides() mixin instead:'
        );
        for (const { file, line, token } of findings) {
            console.error(`- ${file}:${line} ${token}`);
        }
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} source files; no retired --mdc-* Material tokens remain.`
        );
    }
}
