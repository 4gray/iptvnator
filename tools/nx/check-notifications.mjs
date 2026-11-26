import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Toasts go through `NotificationService`
 * (`@iptvnator/services/notifications`, UI-42). It owns the position, the
 * success/info/error look, the politeness and the durations, and takes
 * translation keys only, so an error never shows a provider's or an
 * exception's raw text. This guard reports, outside the service and the
 * lazy loader it builds on:
 *
 * - a call of `open`, `openFromComponent` or `openFromTemplate` on anything
 *   named like a snack bar (`snackBar.open(…)`, `this.snackbar.open(…)`,
 *   `deps.snackBar.openFromComponent(…)`);
 * - an import of `MatSnackBar` or `LazySnackBar`, the two ways to reach one.
 *
 * Specs, tests and their harnesses may stub either.
 */
export const ALLOWED_FILES = new Set([
    'libs/services/src/lib/notifications/notification.service.ts',
    'libs/services/src/lib/lazy-snack-bar/lazy-snack-bar.ts',
]);

const OPEN_METHODS = new Set(['open', 'openFromComponent', 'openFromTemplate']);
const SNACK_BAR_NAME = /snack_?bar/i;
const BANNED_IMPORTS = new Set(['MatSnackBar', 'LazySnackBar']);

const SCANNED_PATHSPECS = ['apps/*.ts', 'libs/*.ts'];

export function isScanned(file) {
    return (
        !ALLOWED_FILES.has(file) &&
        !/\.(spec|test|e2e)\.[cm]?[jt]s$/.test(file) &&
        // Test support (TestBed harnesses, stubs) may stub the snack bar too.
        !/(\.harness|\.test-harness)\.ts$|\/test-stubs\//.test(file) &&
        !/^apps\/[^/]*e2e[^/]*\//.test(file)
    );
}

/** The name a receiver ends in: `snackBar`, `this.snackBar`, `a.b.snackbar`. */
function receiverName(node) {
    while (
        ts.isParenthesizedExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isAsExpression(node)
    ) {
        node = node.expression;
    }
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) return receiverName(node.expression);
    if (ts.isCallExpression(node)) return receiverName(node.expression);
    return undefined;
}

/** Direct snack-bar opens and snack-bar imports in one TypeScript source. */
export function findDirectSnackBars(file, source) {
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const findings = [];
    const report = (node, name, reason) =>
        findings.push({
            file,
            line:
                sourceFile.getLineAndCharacterOfPosition(
                    node.getStart(sourceFile)
                ).line + 1,
            name,
            reason,
        });

    const visit = (node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            OPEN_METHODS.has(node.expression.name.text)
        ) {
            const receiver = receiverName(node.expression.expression);
            if (receiver && SNACK_BAR_NAME.test(receiver)) {
                report(
                    node,
                    `${receiver}.${node.expression.name.text}(…)`,
                    'open toasts with NotificationService.success/info/error'
                );
            }
        }
        if (
            ts.isImportDeclaration(node) &&
            node.importClause?.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings)
        ) {
            for (const element of node.importClause.namedBindings.elements) {
                const imported = (element.propertyName ?? element.name).text;
                if (BANNED_IMPORTS.has(imported)) {
                    report(
                        element,
                        `import ${imported}`,
                        'inject NotificationService (@iptvnator/services/notifications)'
                    );
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return findings;
}

export function listScannedFiles(rootDir) {
    // No shell, so the pathspecs reach git intact on Windows too.
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
        findings.push(...findDirectSnackBars(file, source));
    }

    if (findings.length > 0) {
        console.error(
            'Toasts must go through NotificationService (@iptvnator/services/notifications), not a snack bar opened directly:'
        );
        for (const { file, line, name, reason } of findings) {
            console.error(`- ${file}:${line} ${name} — ${reason}`);
        }
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} TypeScript files; 0 direct snack-bar calls outside NotificationService.`
        );
    }
}
