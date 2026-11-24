import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    ALLOWED_FILES,
    findDirectSnackBars,
    isScanned,
    listScannedFiles,
} from './check-notifications.mjs';

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const names = (source) =>
    findDirectSnackBars('a.ts', source).map(({ line, name }) => ({
        line,
        name,
    }));

test('reports snack-bar opens on fields, parameters and dependency bags', () => {
    const source = [
        "this.snackBar.open('Saved');",
        "void this.snackbar.open('Saved', 'Close', { duration: 2000 });",
        'snackBar.openFromComponent(ToastComponent, {});',
        'deps.snackBar.open(message);',
        'this.config.snackBar',
        '    .open(message)',
        '    .onAction();',
        'this.snack_bar.openFromTemplate(template);',
    ].join('\n');

    assert.deepEqual(names(source), [
        { line: 1, name: 'snackBar.open(…)' },
        { line: 2, name: 'snackbar.open(…)' },
        { line: 3, name: 'snackBar.openFromComponent(…)' },
        { line: 4, name: 'snackBar.open(…)' },
        { line: 5, name: 'snackBar.open(…)' },
        { line: 8, name: 'snack_bar.openFromTemplate(…)' },
    ]);
});

test('reports MatSnackBar and LazySnackBar imports, also renamed or type-only', () => {
    const source = [
        "import { MatSnackBar } from '@angular/material/snack-bar';",
        "import type { MatSnackBar as Bar } from '@angular/material/snack-bar';",
        "import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';",
    ].join('\n');

    assert.deepEqual(names(source), [
        { line: 1, name: 'import MatSnackBar' },
        { line: 2, name: 'import MatSnackBar' },
        { line: 3, name: 'import LazySnackBar' },
    ]);
});

test('accepts notifications, dialogs, other opens and snack-bar refs', () => {
    const source = [
        "import type { MatSnackBarRef } from '@angular/material/snack-bar';",
        "import { NotificationService } from '@iptvnator/services/notifications';",
        "this.notifications.error('EPG.ERROR');",
        'this.dialog.open(ConfirmDialogComponent);',
        "window.open('https://example.com');",
        'this.menuTrigger()?.openMenu();',
        'removal.snackBar?.dismiss();',
    ].join('\n');

    assert.deepEqual(names(source), []);
});

test('skips the service, its lazy loader, specs, harnesses and E2E projects', () => {
    for (const file of ALLOWED_FILES) {
        assert.equal(isScanned(file), false);
    }
    assert.equal(isScanned('libs/a/src/lib/a.service.spec.ts'), false);
    assert.equal(isScanned('apps/web-e2e/src/xtream.e2e.ts'), false);
    assert.equal(isScanned('apps/electron-backend-e2e/src/fixtures.ts'), false);
    assert.equal(isScanned('libs/a/src/lib/a.harness.ts'), false);
    assert.equal(isScanned('libs/a/src/lib/a.test-harness.ts'), false);
    assert.equal(isScanned('apps/web/src/app/x/test-stubs/stub.ts'), false);
    assert.equal(isScanned('apps/web/src/app/app.component.ts'), true);
});

test('the repository has no direct snack-bar call outside the service', async () => {
    const { readFile } = await import('node:fs/promises');
    const files = listScannedFiles(repoRoot);
    assert.ok(files.length > 500, 'scans the renderer sources');
    const findings = [];
    for (const file of files) {
        const source = await readFile(path.join(repoRoot, file), 'utf8');
        findings.push(...findDirectSnackBars(file, source));
    }
    assert.deepEqual(findings, []);
});
