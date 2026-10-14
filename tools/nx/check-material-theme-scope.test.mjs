import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    compareThemeScope,
    requiredThemes,
    templateThemeUsers,
    themedComponents,
    usedEntryPoints,
} from './check-material-theme-scope.mjs';

const lines = (...rows) => rows.join('\n');

test('usedEntryPoints lists each Material entry point with its first importer', () => {
    const importers = usedEntryPoints([
        {
            file: 'a.component.ts',
            source: lines(
                "import { MatButtonModule } from '@angular/material/button';",
                'import {',
                '    MatDialog,',
                "} from '@angular/material/dialog';",
                'import { MatIcon } from "@angular/material/icon";'
            ),
        },
        {
            file: 'b.component.ts',
            source: "import { MatButton } from '@angular/material/button';",
        },
    ]);

    assert.deepEqual(
        [...importers],
        [
            ['button', 'a.component.ts'],
            ['dialog', 'a.component.ts'],
            ['icon', 'a.component.ts'],
        ]
    );
});

test('usedEntryPoints counts dynamic imports and ignores type-only ones and comments', () => {
    const importers = usedEntryPoints([
        {
            file: 'lazy-mat-dialog.ts',
            source: lines(
                "import type { MatDialog } from '@angular/material/dialog';",
                "type DialogModule = typeof import('@angular/material/dialog');",
                'loadDialogModule = () =>',
                "    import('@angular/material/dialog');"
            ),
        },
        {
            file: 'types-only.ts',
            source: lines(
                "import type { MatTooltip } from '@angular/material/tooltip';",
                "// import { MatChipsModule } from '@angular/material/chips';",
                "/* import { MatTabsModule } from '@angular/material/tabs'; */"
            ),
        },
    ]);

    assert.deepEqual([...importers], [['dialog', 'lazy-mat-dialog.ts']]);
});

test('requiredThemes always keeps core and expands the button entry point', () => {
    const required = requiredThemes(
        new Map([
            ['button', 'a.ts'],
            ['tooltip', 'b.ts'],
            ['testing', 'c.ts'],
        ])
    );

    assert.deepEqual(
        [...required],
        [
            ['core', 'always themed'],
            ['button', '@angular/material/button in a.ts'],
            ['icon-button', '@angular/material/button in a.ts'],
            ['tooltip', '@angular/material/tooltip in b.ts'],
        ]
    );
});

test('requiredThemes adds the themes rendered templates call for', () => {
    const required = requiredThemes(
        new Map([['button', 'a.ts']]),
        new Map([['fab', { file: 'b.component.ts', selector: 'mat-mini-fab' }]])
    );

    assert.deepEqual(
        [...required],
        [
            ['core', 'always themed'],
            ['button', '@angular/material/button in a.ts'],
            ['icon-button', '@angular/material/button in a.ts'],
            ['fab', 'mat-mini-fab in b.component.ts'],
        ]
    );
});

test('templateThemeUsers finds a fab element in the first template that renders one', async () => {
    const templates = {
        'libs/b/b.component.html':
            '<a [disabled]="count > 1" matFab href="#">Up</a>',
    };
    const users = await templateThemeUsers(
        [
            {
                file: 'libs/a/a.component.ts',
                source: lines(
                    '@Component({',
                    '    template: `',
                    '        <!-- <button mat-fab></button> -->',
                    '        <p title="a > b">Use mat-fab or matMiniFab here</p>',
                    '        <button class="mat-fab mat-mini-fab">mat-fab</button>',
                    '        <button mat-fab-like matFabulous></button>',
                    '    `,',
                    '})',
                    'export class A {}'
                ),
            },
            {
                file: 'libs/b/b.component.ts',
                source: lines(
                    '@Component({',
                    "    templateUrl: './b.component.html',",
                    '})',
                    'export class B {}'
                ),
            },
            {
                file: 'libs/c/c.component.ts',
                source: lines(
                    '@Component({',
                    '    template: `<button mat-mini-fab (click)="go()"></button>`,',
                    '})',
                    'export class C {}'
                ),
            },
        ],
        async (file) => templates[file]
    );

    assert.deepEqual(
        [...users],
        [['fab', { file: 'libs/b/b.component.ts', selector: 'matFab' }]]
    );
});

test('templateThemeUsers strips HTML comments only: a // in text or a URL hides nothing', async () => {
    const users = await templateThemeUsers(
        [
            {
                file: 'libs/e/e.component.ts',
                source: lines(
                    '@Component({',
                    '    template: `',
                    '        <!-- <button mat-fab></button> -->',
                    '        <span>now // later</span> <a href="https://x/up" mat-fab>Up</a>',
                    '        <button title="Help // tips" mat-mini-fab></button>',
                    '    `,',
                    '})',
                    'export class E {}'
                ),
            },
        ],
        async () => undefined
    );

    assert.deepEqual(
        [...users],
        [['fab', { file: 'libs/e/e.component.ts', selector: 'mat-fab' }]]
    );
});

test('templateThemeUsers finds nothing without a rendered fab', async () => {
    const users = await templateThemeUsers(
        [
            {
                file: 'libs/d/d.component.ts',
                source: lines(
                    '@Component({',
                    '    template: `<button mat-icon-button class="play-btn"></button>`,',
                    '})',
                    'export class D {}'
                ),
            },
            { file: 'libs/d/d.service.ts', source: 'export const fab = 1;' },
        ],
        async () => undefined
    );

    assert.deepEqual([...users], []);
});

test('themedComponents reads the list, direct includes and the all-components mixin', () => {
    assert.deepEqual(
        themedComponents(
            lines(
                '$material-components: (',
                '    core,',
                '    button, // used by every dialog',
                '    icon-button,',
                ');',
                '@include mat.tooltip-theme($theme);'
            )
        ),
        {
            themed: new Set(['core', 'button', 'icon-button', 'tooltip']),
            all: false,
        }
    );
    assert.deepEqual(
        themedComponents('html { @include mat.all-component-themes($t); }'),
        { themed: new Set(), all: true }
    );
});

test('compareThemeScope reports missing and surplus themes', () => {
    const required = new Map([
        ['core', 'always themed'],
        ['button', '@angular/material/button in a.ts'],
    ]);

    assert.deepEqual(
        compareThemeScope(required, {
            themed: new Set(['core', 'tabs']),
            all: false,
        }),
        {
            unthemed: [['button', '@angular/material/button in a.ts']],
            unused: ['tabs'],
        }
    );
    // all-component-themes leaves nothing unthemed, but is still surplus-free
    // only when the list is empty.
    assert.deepEqual(
        compareThemeScope(required, { themed: new Set(), all: true }),
        { unthemed: [], unused: [] }
    );
});
