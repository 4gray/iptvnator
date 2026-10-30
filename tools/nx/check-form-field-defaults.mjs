import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
    componentMetadata,
    componentTemplate,
    property,
} from './component-templates.mjs';

/**
 * The app's `<mat-form-field>` defaults (outline, dynamic subscript) are
 * provided per component, not in the root injector: importing
 * MAT_FORM_FIELD_DEFAULT_OPTIONS in app.config.ts loads
 * `@angular/material/form-field` and, since Material 22.2, `@angular/forms`
 * on startup, although every form field lives in a lazy chunk. A component
 * that renders a form field without the provider silently falls back to the
 * `fill` appearance, so this guard requires it on each such component, and
 * allows the provider and the token nowhere else.
 */
export const DEFAULTS_FILE =
    'libs/ui/components/src/lib/form-field-defaults/form-field-defaults.ts';
const TOKEN = 'MAT_FORM_FIELD_DEFAULT_OPTIONS';
const PROVIDER = 'provideFormFieldDefaults';

const SCANNED_PATHSPECS = ['apps/web/*.ts', 'libs/*.ts'];

function isScanned(file) {
    return !/\.(spec|test)\.[cm]?[jt]s$/.test(file);
}

function isProviderCall(node) {
    return (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === PROVIDER
    );
}

/**
 * Findings for one TypeScript source. `readTemplate` resolves a
 * `templateUrl` relative to the component and returns its text.
 */
export async function checkComponentSource(file, source, readTemplate) {
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const lineOf = (node) =>
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;
    const findings = [];
    const components = [];
    const componentProviderCalls = new Set();

    const visit = (node) => {
        const metadata = componentMetadata(node);
        if (metadata) {
            const providers = property(metadata, 'providers');
            const calls =
                providers && ts.isArrayLiteralExpression(providers)
                    ? providers.elements.filter(isProviderCall)
                    : [];
            calls.forEach((call) => componentProviderCalls.add(call));
            components.push({ node, metadata, provides: calls.length > 0 });
        }
        if (ts.isIdentifier(node) && node.text === TOKEN) {
            if (file !== DEFAULTS_FILE) {
                findings.push({
                    file,
                    line: lineOf(node),
                    reason: `uses ${TOKEN}; provide the app defaults with ${PROVIDER}() from @iptvnator/ui/components/form-field-defaults`,
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const visitCalls = (node) => {
        if (isProviderCall(node) && !componentProviderCalls.has(node)) {
            findings.push({
                file,
                line: lineOf(node),
                reason: `calls ${PROVIDER}() outside a component's providers; a root or route provider loads Material's form field on startup`,
            });
        }
        ts.forEachChild(node, visitCalls);
    };
    visitCalls(sourceFile);

    for (const { node, metadata, provides } of components) {
        const template = await componentTemplate(metadata, file, readTemplate);
        if (provides || !/<mat-form-field\b/.test(template ?? '')) continue;
        findings.push({
            file,
            line: lineOf(node),
            reason: `renders <mat-form-field> without providers: [${PROVIDER}()]`,
        });
    }
    return findings.sort((a, b) => a.line - b.line);
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
