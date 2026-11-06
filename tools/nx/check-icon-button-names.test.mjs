import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
    findNamelessIconButtons,
    listScannedFiles,
} from './check-icon-button-names.mjs';

const nameless = (file, source) =>
    findNamelessIconButtons(file, source).map(({ line, icon }) => ({
        line,
        icon,
    }));

test('reports an icon-only button on the line its tag opens', () => {
    const template = [
        '<div>',
        '    <button mat-icon-button (click)="close()">',
        '        <mat-icon>close</mat-icon>',
        '    </button>',
        '</div>',
    ].join('\n');

    assert.deepEqual(nameless('a.html', template), [
        { line: 2, icon: 'close' },
    ]);
});

test('does not accept a tooltip or a title as the name', () => {
    const template = [
        '<button mat-icon-button matTooltip="Close">',
        '    <mat-icon>close</mat-icon>',
        '</button>',
        '<button mat-icon-button [matTooltip]="\'CLOSE\' | translate">',
        '    <mat-icon>close</mat-icon>',
        '</button>',
        '<button mat-icon-button title="Close"><mat-icon>close</mat-icon></button>',
    ].join('\n');

    assert.deepEqual(nameless('b.html', template), [
        { line: 1, icon: 'close' },
        { line: 4, icon: 'close' },
        { line: 7, icon: 'close' },
    ]);
});

test('accepts aria-label, its bindings and aria-labelledby', () => {
    const template = [
        '<button aria-label="Close"><mat-icon>close</mat-icon></button>',
        '<button [attr.aria-label]="\'CLOSE\' | translate"><mat-icon>close</mat-icon></button>',
        '<button [aria-label]="label"><mat-icon>close</mat-icon></button>',
        '<button [ariaLabel]="label"><mat-icon>close</mat-icon></button>',
        '<button aria-labelledby="heading"><mat-icon>close</mat-icon></button>',
        '<button [attr.aria-labelledby]="headingId"><mat-icon>close</mat-icon></button>',
    ].join('\n');

    assert.deepEqual(nameless('c.html', template), []);
});

test('rejects an empty static aria-label', () => {
    const template =
        '<button aria-label=" "><mat-icon>close</mat-icon></button>';

    assert.deepEqual(nameless('d.html', template), [
        { line: 1, icon: 'close' },
    ]);
});

test('accepts a button whose content includes text', () => {
    const template = [
        '<button><mat-icon>replay</mat-icon> Watch</button>',
        "<button><mat-icon>replay</mat-icon>{{ 'WATCH' | translate }}</button>",
        '<button><mat-icon>add</mat-icon><span class="sr-only">Add</span></button>',
        '<button>@if (busy) { <mat-icon>sync</mat-icon> } @else { Refresh }</button>',
    ].join('\n');

    assert.deepEqual(nameless('e.html', template), []);
});

test('ignores text and components hidden from assistive technology', () => {
    const template = [
        '<button><mat-icon>close</mat-icon><span aria-hidden="true">Close</span></button>',
        '<button>',
        '    <span aria-hidden="true">',
        '        <mat-icon>star</mat-icon>',
        "        {{ 'FAVORITE' | translate }}",
        '        <app-badge />',
        '    </span>',
        '</button>',
        '<button><span aria-hidden="true">Only hidden text</span></button>',
        '<button><mat-icon>add</mat-icon><span [attr.aria-hidden]="hide">Add</span></button>',
    ].join('\n');

    assert.deepEqual(nameless('e2.html', template), [
        { line: 1, icon: 'close' },
        { line: 2, icon: 'star' },
    ]);
});

test('looks through control flow, wrappers and spinners', () => {
    const template = [
        '<button mat-icon-button>',
        '    @if (busy) {',
        '        <mat-spinner diameter="18" />',
        '    } @else {',
        '        <mat-icon>sync</mat-icon>',
        '    }',
        '</button>',
        '<button>',
        '    @switch (state) {',
        '        @case (1) { <mat-icon>play_arrow</mat-icon> }',
        '        @default { <span class="glyph"><mat-icon>pause</mat-icon></span> }',
        '    }',
        '</button>',
        '<button><ng-container *ngIf="on"><mat-icon>star</mat-icon></ng-container></button>',
        '<button><!-- decorative --><mat-icon>{{ icon() }}</mat-icon></button>',
    ].join('\n');

    assert.deepEqual(nameless('f.html', template), [
        { line: 1, icon: 'sync' },
        { line: 8, icon: 'play_arrow / pause' },
        { line: 14, icon: 'star' },
        { line: 15, icon: '{{ icon() }}' },
    ]);
});

test('leaves content it cannot see into to the content', () => {
    const template = [
        '<button><ng-content /></button>',
        '<button><app-logo [channel]="c" /><mat-icon>tv</mat-icon></button>',
        '<button><img [src]="logo" alt="" /><mat-icon>tv</mat-icon></button>',
        '<button></button>',
        '<button mat-icon-button aria-hidden="true" tabindex="-1"><mat-icon>tv</mat-icon></button>',
        '<a mat-icon-button href="/"><mat-icon>home</mat-icon></a>',
    ].join('\n');

    assert.deepEqual(nameless('g.html', template), []);
});

test('finds buttons nested in other elements and blocks', () => {
    const template = [
        '@for (row of rows; track row.id) {',
        '    <div class="row" *ngIf="row.visible">',
        '        <button (click)="remove(row)"><mat-icon>delete</mat-icon></button>',
        '    </div>',
        '}',
        '@defer { <button><mat-icon>info</mat-icon></button> }',
    ].join('\n');

    assert.deepEqual(nameless('h.html', template), [
        { line: 3, icon: 'delete' },
        { line: 6, icon: 'info' },
    ]);
});

test('checks inline component templates on their source lines', () => {
    const source = [
        "import { Component } from '@angular/core';",
        '@Component({',
        "    selector: 'app-a',",
        '    template: `',
        '        <h2>Release</h2>',
        '        <button mat-icon-button (click)="previous()">',
        '            <mat-icon>chevron_left</mat-icon>',
        '        </button>',
        '    `,',
        '})',
        'export class A {}',
        "@Component({ selector: 'b', template: '<button><mat-icon>x</mat-icon></button>' })",
        'export class B {}',
        '@Component({ selector: "c", template: `<button><mat-icon>${icon}</mat-icon></button>` })',
        "const notAComponent = { template: '<button><mat-icon>x</mat-icon></button>' };",
    ].join('\n');

    assert.deepEqual(nameless('a.component.ts', source), [
        { line: 6, icon: 'chevron_left' },
        { line: 12, icon: 'x' },
    ]);
});

test('selects tracked Angular app and lib sources, but not specs', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'button-guard-'));
    const git = (...args) =>
        execFileSync('git', args, { cwd: rootDir, stdio: 'pipe' });
    try {
        git('init', '-q');
        const files = {
            'libs/ui/feature/src/lib/deep/panel.component.html': '',
            'libs/ui/feature/src/lib/deep/panel.component.ts': '',
            'libs/ui/feature/src/lib/deep/panel.component.spec.ts': '',
            'apps/web/src/app/app.component.html': '',
            'apps/remote-control-web/src/app/app.ts': '',
            'apps/website/src/page.html': '',
            'apps/electron-backend/src/main.ts': '',
            'tools/outside.ts': '',
        };
        for (const [file, content] of Object.entries(files)) {
            await mkdir(path.dirname(path.join(rootDir, file)), {
                recursive: true,
            });
            await writeFile(path.join(rootDir, file), content);
        }
        git('add', '.');

        assert.deepEqual(listScannedFiles(rootDir).sort(), [
            'apps/remote-control-web/src/app/app.ts',
            'apps/web/src/app/app.component.html',
            'libs/ui/feature/src/lib/deep/panel.component.html',
            'libs/ui/feature/src/lib/deep/panel.component.ts',
        ]);
    } finally {
        await rm(rootDir, { recursive: true, force: true });
    }
});
