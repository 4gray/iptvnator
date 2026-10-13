import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The app's `<mat-form-field>` defaults (outline, dynamic subscript) are
 * provided per component, not in the root injector: importing
 * MAT_FORM_FIELD_DEFAULT_OPTIONS in app.config.ts loads
 * `@angular/material/form-field` and, since Material 22.2, `@angular/forms`
 * on startup, although every form field lives in a lazy chunk. A component
 * that renders a form field without the provider silently falls back to the
 * `fill` appearance, so this guard requires it on each such component and
 * keeps the token itself inside the shared provider.
 */
export const DEFAULTS_FILE =
    'libs/ui/components/src/lib/form-field-defaults/form-field-defaults.ts';
const TOKEN = 'MAT_FORM_FIELD_DEFAULT_OPTIONS';

const SCANNED_PATHSPECS = ['apps/web/*.ts', 'libs/*.ts'];

function isScanned(file) {
    return !/\.(spec|test)\.[cm]?[jt]s$/.test(file);
}

function lineOf(source, index) {
    return source.slice(0, index).split('\n').length;
}

/** Inline template text, or the path of the `templateUrl` file. */
export function componentTemplates(source) {
    const inline = [...source.matchAll(/\btemplate:\s*`([\s\S]*?)`/g)].map(
        (match) => ({ inline: match[1], index: match.index })
    );
    const urls = [...source.matchAll(/\btemplateUrl:\s*['"]([^'"]+)['"]/g)].map(
        (match) => ({ url: match[1], index: match.index })
    );
    return [...inline, ...urls].sort((a, b) => a.index - b.index);
}

function providesDefaults(source) {
    return /\bproviders:\s*\[[^\]]*\bprovideFormFieldDefaults\(\)/.test(source);
}

/**
 * Findings for one component source. `readTemplate` resolves a
 * `templateUrl` relative to the component and returns its text.
 */
export async function checkComponentSource(file, source, readTemplate) {
    const findings = [];
    if (file !== DEFAULTS_FILE) {
        for (const match of source.matchAll(
            new RegExp(`\\b${TOKEN}\\b`, 'g')
        )) {
            findings.push({
                file,
                line: lineOf(source, match.index),
                reason: `uses ${TOKEN}; provide the app defaults with provideFormFieldDefaults() from @iptvnator/ui/components/form-field-defaults`,
            });
        }
    }

    for (const template of componentTemplates(source)) {
        const text =
            template.inline ??
            (await readTemplate(
                path.posix.join(path.posix.dirname(file), template.url)
            ));
        if (!/<mat-form-field\b/.test(text) || providesDefaults(source)) {
            continue;
        }
        findings.push({
            file,
            line: lineOf(source, template.index),
            reason: 'renders <mat-form-field> without providers: [provideFormFieldDefaults()]',
        });
    }
    return findings;
}

/** Tracked renderer TypeScript files the guard reads, at any depth. */
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
    const readTemplate = (file) => readFile(path.join(rootDir, file), 'utf8');

    const findings = [];
    for (const file of files) {
        const source = await readFile(path.join(rootDir, file), 'utf8');
        findings.push(
            ...(await checkComponentSource(file, source, readTemplate))
        );
    }

    if (findings.length > 0) {
        console.error(
            'Form-field defaults must be provided per component, not in the root injector:'
        );
        for (const { file, line, reason } of findings) {
            console.error(`- ${file}:${line} ${reason}`);
        }
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} renderer files; every <mat-form-field> component provides the app defaults.`
        );
    }
}
