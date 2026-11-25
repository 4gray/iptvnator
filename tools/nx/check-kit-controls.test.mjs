import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    applyAllowlist,
    findKitFindings,
    isScanned,
} from './check-kit-controls.mjs';

const rules = (file, template) =>
    findKitFindings(file, template).map(({ line, rule }) => ({ line, rule }));

test('reports button variants without a kit role', () => {
    const template = [
        '<button mat-raised-button>A</button>',
        '<button mat-fab><mat-icon>add</mat-icon></button>',
        '<button mat-mini-fab><mat-icon>add</mat-icon></button>',
        '<button mat-fab extended>Add</button>',
        '<button mat-stroked-button>Save</button>',
    ].join('\n');
    assert.deepEqual(rules('a.html', template), [
        { line: 1, rule: 'variant' },
        { line: 2, rule: 'variant' },
        { line: 3, rule: 'variant' },
        { line: 4, rule: 'variant' },
        { line: 5, rule: 'variant' },
    ]);
});

test('reports the camelCase and appearance spellings too', () => {
    const template = [
        '<button matFab><mat-icon>add</mat-icon></button>',
        '<button matMiniFab><mat-icon>add</mat-icon></button>',
        '<button matButton="elevated">A</button>',
        '<button matButton="tonal">A</button>',
        '<button matButton="outlined">A</button>',
        '<button [matButton]="appearance">A</button>',
        '<button matFab color="primary"><mat-icon>add</mat-icon></button>',
    ].join('\n');
    assert.deepEqual(rules('a.html', template), [
        { line: 1, rule: 'variant' },
        { line: 2, rule: 'variant' },
        { line: 3, rule: 'variant' },
        { line: 4, rule: 'variant' },
        { line: 5, rule: 'variant' },
        { line: 6, rule: 'variant' },
        { line: 7, rule: 'variant' },
        { line: 7, rule: 'color' },
    ]);
});

test('keeps the kit appearances in either spelling', () => {
    const template = [
        '<button matButton>Text</button>',
        '<button matButton="text">Text</button>',
        '<button matButton="filled">Filled</button>',
        '<button [matButton]="\'filled\'">Filled</button>',
        '<button matIconButton aria-label="Close"><mat-icon>close</mat-icon></button>',
        '<button matButton="outlined" class="app-destructive-button">Delete</button>',
    ].join('\n');
    assert.deepEqual(rules('a.html', template), []);
});

test('keeps the kit roles and the destructive outlined button', () => {
    const template = [
        '<button mat-flat-button>Save</button>',
        '<button mat-button>Cancel</button>',
        '<button mat-icon-button aria-label="Close"><mat-icon>close</mat-icon></button>',
        '<button mat-stroked-button class="app-destructive-button">Delete</button>',
        '<button mat-stroked-button [class.app-destructive-button]="danger">Remove</button>',
    ].join('\n');
    assert.deepEqual(rules('a.html', template), []);
});

test('reports a palette color on a Material element, static or bound', () => {
    const template = [
        '<button mat-flat-button color="primary">Use</button>',
        '<mat-slide-toggle [color]="tone">On</mat-slide-toggle>',
        '<span class="dot" [style.color]="tone"></span>',
        '<svg><path color="red" /></svg>',
    ].join('\n');
    assert.deepEqual(rules('a.html', template), [
        { line: 1, rule: 'color' },
        { line: 2, rule: 'color' },
    ]);
});

test('reports native selects and a mat-select outside a form field', () => {
    const template = [
        '<select><option>One</option></select>',
        '<mat-select></mat-select>',
        '<mat-form-field>',
        '    @if (ready) {',
        '        <mat-select><mat-option value="a">A</mat-option></mat-select>',
        '    }',
        '</mat-form-field>',
    ].join('\n');
    assert.deepEqual(rules('a.html', template), [
        { line: 1, rule: 'native-select' },
        { line: 2, rule: 'select-outside-field' },
    ]);
});

test('reads inline component templates with their source lines', () => {
    const source = [
        "import { Component } from '@angular/core';",
        '@Component({',
        "    selector: 'app-x',",
        '    template: `',
        '        <button mat-stroked-button>Go</button>',
        '    `,',
        '})',
        'export class XComponent {}',
    ].join('\n');
    assert.deepEqual(rules('x.component.ts', source), [
        { line: 5, rule: 'variant' },
    ]);
});

test('allowlists a rule per file and reports stale entries', () => {
    const allowed = {
        'a.html': { rules: ['native-select'], reason: 'x' },
        'b.html': { rules: ['color'], reason: 'y' },
    };
    const findings = [
        { file: 'a.html', line: 1, rule: 'native-select' },
        { file: 'a.html', line: 2, rule: 'color' },
    ];
    const { failing, stale } = applyAllowlist(findings, allowed);
    assert.deepEqual(
        failing.map(({ rule }) => rule),
        ['color']
    );
    assert.deepEqual(stale, [{ file: 'b.html', rule: 'color' }]);
});

test('skips specs and test support', () => {
    assert.equal(isScanned('libs/a/b.component.html'), true);
    assert.equal(isScanned('libs/a/b.component.spec.ts'), false);
    assert.equal(isScanned('libs/a/testing/stub.component.ts'), false);
    assert.equal(isScanned('libs/a/b.spec-stubs.ts'), false);
});
