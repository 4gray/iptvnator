import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    compareThemeScope,
    requiredThemes,
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
            ['fab', '@angular/material/button in a.ts'],
            ['tooltip', '@angular/material/tooltip in b.ts'],
        ]
    );
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
