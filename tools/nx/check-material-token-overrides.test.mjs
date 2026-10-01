import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
    findDeadMaterialTokens,
    listScannedFiles,
} from './check-material-token-overrides.mjs';

test('reports retired --mdc-* declarations and reads with their location', () => {
    const source = [
        '.field {',
        '    --mdc-outlined-text-field-container-shape: 10px;',
        '    color: var(--mdc-theme-primary, #6366f1);',
        '}',
    ].join('\n');

    assert.deepEqual(findDeadMaterialTokens('a.scss', source), [
        {
            file: 'a.scss',
            line: 2,
            token: '--mdc-outlined-text-field-container-shape',
        },
        { file: 'a.scss', line: 3, token: '--mdc-theme-primary' },
    ]);
});

test('accepts current --mat-* tokens and override mixins', () => {
    const source = [
        '.field {',
        '    @include mat.form-field-overrides((outlined-container-shape: 10px));',
        '    --mat-icon-button-state-layer-size: 32px;',
        '    color: var(--mat-sys-error);',
        '}',
    ].join('\n');

    assert.deepEqual(findDeadMaterialTokens('b.scss', source), []);
});

test('selects tracked app and lib sources at any depth, but not specs', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mat-token-guard-'));
    const git = (...args) =>
        execFileSync('git', args, { cwd: rootDir, stdio: 'pipe' });
    try {
        git('init', '-q');
        const files = {
            'libs/ui/feature/src/lib/deep/panel.component.scss': '',
            'libs/ui/feature/src/lib/deep/panel.component.html': '',
            'libs/ui/feature/src/lib/deep/panel.component.ts': '',
            'libs/ui/feature/src/lib/deep/panel.component.spec.ts': '',
            'apps/web/src/styles.scss': '',
            'apps/web/src/vendor.css': '',
            'tools/outside.scss': '',
        };
        for (const [file, content] of Object.entries(files)) {
            await mkdir(path.dirname(path.join(rootDir, file)), {
                recursive: true,
            });
            await writeFile(path.join(rootDir, file), content);
        }
        git('add', '.');
        // Untracked files are not part of the checkout CI sees.
        await writeFile(path.join(rootDir, 'apps/web/src/untracked.scss'), '');

        assert.deepEqual(listScannedFiles(rootDir).sort(), [
            'apps/web/src/styles.scss',
            'apps/web/src/vendor.css',
            'libs/ui/feature/src/lib/deep/panel.component.html',
            'libs/ui/feature/src/lib/deep/panel.component.scss',
            'libs/ui/feature/src/lib/deep/panel.component.ts',
        ]);
    } finally {
        await rm(rootDir, { recursive: true, force: true });
    }
});
