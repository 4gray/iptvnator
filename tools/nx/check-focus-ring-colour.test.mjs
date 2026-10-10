import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
    RING_EXCEPTIONS,
    checkFocusRingColour,
    findOffTokenRings,
    findUnusedExceptions,
    indicatorColours,
    listScannedFiles,
} from './check-focus-ring-colour.mjs';

const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

test('reports focus rings drawn in their own colour, nested or in a mixin', () => {
    const source = [
        '.chip {',
        '    &:focus-visible {',
        '        outline: 2px solid var(--app-selection-color);',
        '        outline-offset: 2px;',
        '    }',
        '}',
        '.row:focus-within { outline-color: #2f7bff; }',
        '.cell.is-focused { outline: 2px solid $accent-blue; }',
        '@mixin ring { &:focus-visible { outline: 1px dashed red; } }',
    ].join('\n');

    assert.deepEqual(
        findOffTokenRings('a.scss', source).map(
            ({ line, selector, declaration }) =>
                `${line} ${selector} | ${declaration}`
        ),
        [
            '3 .chip:focus-visible | outline: 2px solid var(--app-selection-color)',
            '7 .row:focus-within | outline-color: #2f7bff',
            '8 .cell.is-focused | outline: 2px solid $accent-blue',
            '9 &:focus-visible | outline: 1px dashed red',
        ]
    );
});

test('accepts the app ring, the player palette, removals and decorative outlines', () => {
    const source = [
        '.a:focus-visible { @include focus-ring.focus-ring-declarations; }',
        '.b:focus-visible { outline: 2px solid var(--app-focus-ring); }',
        // A stylesheet a spec loads as raw CSS uses the token directly.
        '.c:focus-visible { outline: 2px solid var(--app-focus-ring, #1d63e0); }',
        // Over video the overlay keeps its own palette.
        ':host :is(button:focus-visible) { outline: 2px solid var(--pc-text); }',
        // Hiding the outline is the other guard's business.
        '.d:focus { outline: none; }',
        '.e:focus-visible { outline: 0 solid transparent; }',
        // Not a focus rule: a decorative outline.
        '.panel { outline: 1px solid rgba(255, 255, 255, 0.04); }',
    ].join('\n');

    assert.deepEqual(findOffTokenRings('b.scss', source), []);
});

test('reads ring-shaped shadows and border colours as focus indicators', () => {
    const source = [
        '.search:focus-within {',
        '    border-color: var(--mat-sys-primary);',
        '    box-shadow: 0 0 0 3px',
        '        color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);',
        '}',
        '.cell.is-focused { box-shadow: inset 0 0 0 2px $accent-blue; }',
        '.field:focus-within { border: 1px solid #2f7bff; }',
        '.tab:focus-visible { box-shadow: inset 0 -2px 0 var(--app-selection-color); }',
    ].join('\n');

    assert.deepEqual(
        findOffTokenRings('c.scss', source).map(({ line }) => line),
        [2, 3, 6, 7, 8]
    );
});

test('leaves neutral boundaries, lift shadows and token colours alone', () => {
    const source = [
        '.row:focus-within { border-color: var(--app-separator); }',
        '.row:focus-within { border-color: transparent; border-radius: 8px; }',
        '.card:focus-within { box-shadow: 0 12px 28px rgba(0, 0, 0, 0.14); }',
        '.search:focus-within {',
        '    border-color: var(--app-focus-ring);',
        '    box-shadow: 0 0 0 3px',
        '        color-mix(in srgb, var(--app-focus-ring) 12%, transparent);',
        '}',
        ':host(:focus-visible) {',
        '    box-shadow: 0 0 0 2px var(--pc-text), 0 12px 32px rgba(0, 0, 0, 0.45);',
        '}',
    ].join('\n');

    assert.deepEqual(findOffTokenRings('d.scss', source), []);
    // The blurred shadow in a mixed list is not an indicator.
    assert.deepEqual(
        indicatorColours(
            'box-shadow: 0 0 0 2px var(--pc-text), 0 12px 32px rgba(0, 0, 0, 0.45)'
        ),
        ['var(--pc-text)']
    );
});

test('lets a listed exception through only in its own file', () => {
    const [exception] = RING_EXCEPTIONS;
    const source = `.x:focus-visible { outline: 2px solid ${exception.value}; }`;

    assert.deepEqual(findOffTokenRings(exception.file, source), []);
    assert.equal(findOffTokenRings('elsewhere.scss', source).length, 1);
});

test('reports an exception that no longer matches anything', () => {
    const sources = RING_EXCEPTIONS.slice(1).map(({ file, value }) => ({
        file,
        source: `.x:focus-visible { outline: 2px solid ${value}; }`,
    }));

    assert.deepEqual(
        findUnusedExceptions(sources).map(({ file }) => file),
        [RING_EXCEPTIONS[0].file]
    );
    assert.match(
        checkFocusRingColour(sources).at(-1),
        /matches nothing; remove it from RING_EXCEPTIONS$/
    );
});

test('selects every tracked app and library stylesheet', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'focus-ring-colour-'));
    const git = (...args) =>
        execFileSync('git', args, { cwd: tempDir, stdio: 'pipe' });
    try {
        git('init', '-q');
        const files = [
            'apps/web/src/styles.scss',
            'apps/web/src/app/settings/settings.component.scss',
            'apps/website/src/styles/global.scss',
            'libs/ui/components/src/lib/deep/row.component.scss',
            'libs/ui/components/src/lib/deep/row.component.ts',
        ];
        for (const file of files) {
            await mkdir(path.dirname(path.join(tempDir, file)), {
                recursive: true,
            });
            await writeFile(path.join(tempDir, file), '');
        }
        git('add', '.');

        assert.deepEqual(listScannedFiles(tempDir).sort(), [
            'apps/web/src/app/settings/settings.component.scss',
            'apps/web/src/styles.scss',
            'libs/ui/components/src/lib/deep/row.component.scss',
        ]);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('the repository stylesheets pass, and one drifted ring would not', async () => {
    const sources = await Promise.all(
        listScannedFiles(rootDir).map(async (file) => ({
            file,
            source: await readFile(path.join(rootDir, file), 'utf8'),
        }))
    );
    assert.deepEqual(checkFocusRingColour(sources), []);

    const drifted = [
        ...sources,
        {
            file: 'libs/ui/components/src/lib/new/new.component.scss',
            source: '.new:focus-visible { outline: 2px solid var(--app-selection-color); }',
        },
    ];
    assert.equal(checkFocusRingColour(drifted).length, 1);
});
