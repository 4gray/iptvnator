import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findDeadMaterialTokens } from './check-material-token-overrides.mjs';

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
