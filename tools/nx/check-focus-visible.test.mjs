import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
    checkFocusVisible,
    expandBranches,
    findBlanketOutlineRemovals,
    hasFocusVisibleFallback,
    isBlanketSelector,
    removesOutline,
    listScannedFiles,
} from './check-focus-visible.mjs';

const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

const fallback = [
    ':where(:focus:not(:focus-visible)) {',
    '    outline: none;',
    '}',
    ':where(:focus-visible) {',
    '    @include focus-ring.focus-ring-declarations;',
    '}',
].join('\n');

test('reports the old blanket rule once per unscoped selector', () => {
    const source = [
        'input,',
        'button,',
        'textarea,',
        ':focus {',
        '    outline: none;',
        '}',
    ].join('\n');

    assert.deepEqual(
        findBlanketOutlineRemovals('styles.scss', source).map(
            ({ line, selector }) => `${line} ${selector}`
        ),
        ['5 input', '5 button', '5 textarea', '5 :focus']
    );
});

test('reports every way of hiding the outline, nested or not', () => {
    const source = [
        '*:focus { outline: 0 !important; }',
        'button:focus { outline-style: none; }',
        'a { outline-width: 0; }',
        '[tabindex] :focus { outline-color: transparent; }',
        '.dark-theme {',
        '    :focus { outline: 0px; }',
        '    @media (min-width: 600px) {',
        '        & :focus-visible { outline: none; }',
        '    }',
        '}',
        '@mixin hide { :focus { outline: none; } }',
    ].join('\n');

    assert.deepEqual(
        findBlanketOutlineRemovals('a.scss', source).map(
            ({ selector }) => selector
        ),
        [
            '*:focus',
            'button:focus',
            'a',
            '[tabindex] :focus',
            '.dark-theme :focus',
            '.dark-theme :focus-visible',
            ':focus',
        ]
    );
});

test('reads an invisible outline from any part of the shorthand', () => {
    for (const hidden of [
        'outline: 0 solid transparent',
        'outline: 2px solid transparent',
        'outline: 1px solid rgba(0, 0, 0, 0)',
        'outline: 1px solid rgb(0 0 0 / 0%)',
        'outline: thin dotted #0000',
        'outline: 0.0em solid red',
        'outline-color: transparent',
        'outline-width: 0px',
        'outline-style: hidden',
    ]) {
        assert.equal(removesOutline(hidden), true, hidden);
    }
    for (const visible of [
        'outline: 2px solid var(--app-focus-ring)',
        // A zero blue channel is not a zero alpha.
        'outline: 2px solid rgb(255, 0, 0)',
        'outline: 2px solid rgba(0, 0, 0, 0.5)',
        'outline: 2px solid #ff000080',
        'outline: auto',
        'outline-offset: 0',
    ]) {
        assert.equal(removesOutline(visible), false, visible);
    }

    // Both checks use it: a transparent ring hides focus and is no fallback.
    const problems = checkFocusVisible([
        {
            file: 'f.scss',
            source: [
                ':focus { outline: 0 solid transparent; }',
                ':focus-visible { outline: 2px solid transparent; }',
            ].join('\n'),
        },
    ]);
    assert.deepEqual(problems, [
        'f.scss:1 `:focus` sets `outline: 0 solid transparent`',
        'f.scss:2 `:focus-visible` sets `outline: 2px solid transparent`',
        'No global `:focus-visible` rule draws the fallback outline (`@include focus-ring.focus-ring-declarations`).',
    ]);
});

test('accepts removals that keep visible focus or target scoped elements', () => {
    const source = [
        ':where(:focus:not(:focus-visible)) { outline: none; }',
        ':focus:not(:focus-visible) { outline: 0; }',
        '.setting-item:focus { outline: none; }',
        'input.search-field { outline: none; }',
        'button[mat-icon-button]:focus { outline: none; }',
        '#player:focus { outline: none; }',
        '.panel { &:focus { outline: none; } }',
        '::-webkit-scrollbar { outline: none; }',
        ':focus-visible { outline: 2px solid red; }',
    ].join('\n');

    assert.deepEqual(findBlanketOutlineRemovals('b.scss', source), []);
});

test('expands :is() and :where() so one unscoped branch is still caught', () => {
    assert.deepEqual(expandBranches(':is(input, .x):focus'), [
        'input:focus',
        '.x:focus',
    ]);
    assert.equal(isBlanketSelector(':is(input, .x):focus'), true);
    assert.equal(isBlanketSelector(':where(.x, [data-y]):focus'), false);
    // A class inside :not() does not scope the element.
    assert.equal(isBlanketSelector('button:not(.mat-button)'), true);
});

test('ignores commented-out rules and strings that look like rules', () => {
    const source = [
        '// :focus { outline: none; }',
        '/* button { outline: 0; } */',
        ".icon { content: '{ outline: none; }'; }",
        fallback,
    ].join('\n');

    assert.deepEqual(checkFocusVisible([{ file: 'c.scss', source }]), []);
});

test('requires a :focus-visible fallback that draws an outline', () => {
    const missing = checkFocusVisible([
        {
            file: 'd.scss',
            source: ':where(:focus:not(:focus-visible)) { outline: none; }',
        },
    ]);
    assert.equal(missing.length, 1);
    assert.match(missing[0], /No global `:focus-visible` rule/);

    assert.equal(hasFocusVisibleFallback(fallback), true);
    assert.equal(
        hasFocusVisibleFallback(
            ':focus-visible { outline: 2px solid var(--ring); }'
        ),
        true
    );
    // A scoped rule is not the global fallback: not on the focused element,
    // not on a container's descendants, not nested in one.
    for (const scoped of [
        '.card:focus-visible { outline: 2px solid red; }',
        '.panel :focus-visible { outline: 2px solid red; }',
        '.dark-theme { :focus-visible { outline: 2px solid red; } }',
        '.panel { :where(:focus-visible) { @include focus-ring.ring; } }',
    ]) {
        assert.equal(hasFocusVisibleFallback(scoped), false, scoped);
    }
    // Nor is one that may never reach the page.
    for (const conditional of [
        '@mixin ring { :focus-visible { outline: 2px solid red; } }',
        '@media print { :focus-visible { outline: 2px solid red; } }',
    ]) {
        assert.equal(hasFocusVisibleFallback(conditional), false, conditional);
    }
    assert.equal(
        hasFocusVisibleFallback('*:focus-visible { outline: 2px solid red; }'),
        true
    );
    // Neither is one that removes the outline, which is also reported.
    const removed = checkFocusVisible([
        { file: 'e.scss', source: ':focus-visible { outline: none; }' },
    ]);
    assert.equal(removed.length, 2);
    assert.match(
        removed[0],
        /^e\.scss:1 `:focus-visible` sets `outline: none`$/
    );
});

test('the fallback may live in another scanned stylesheet', () => {
    assert.deepEqual(
        checkFocusVisible([
            {
                file: 'apps/web/src/m3-theme.scss',
                source: 'html { color: red; }',
            },
            { file: 'apps/web/src/styles.scss', source: fallback },
        ]),
        []
    );
});

test('selects only the tracked top-level web stylesheets', async () => {
    const tempDir = await mkdtemp(
        path.join(os.tmpdir(), 'focus-visible-guard-')
    );
    const git = (...args) =>
        execFileSync('git', args, { cwd: tempDir, stdio: 'pipe' });
    try {
        git('init', '-q');
        const files = [
            'apps/web/src/styles.scss',
            'apps/web/src/_settings-theme.scss',
            'apps/web/src/app/settings/settings.component.scss',
            'apps/web/src/main.ts',
            'libs/ui/styles/_focus-ring.scss',
        ];
        for (const file of files) {
            await mkdir(path.dirname(path.join(tempDir, file)), {
                recursive: true,
            });
            await writeFile(path.join(tempDir, file), '');
        }
        git('add', '.');
        await writeFile(path.join(tempDir, 'apps/web/src/untracked.scss'), '');

        assert.deepEqual(listScannedFiles(tempDir).sort(), [
            'apps/web/src/_settings-theme.scss',
            'apps/web/src/styles.scss',
        ]);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('the repository global stylesheets pass, and the old rule would not', async () => {
    const sources = await Promise.all(
        listScannedFiles(rootDir).map(async (file) => ({
            file,
            source: await readFile(path.join(rootDir, file), 'utf8'),
        }))
    );
    assert.ok(sources.some(({ file }) => file === 'apps/web/src/styles.scss'));
    assert.deepEqual(checkFocusVisible(sources), []);

    const reverted = sources.map(({ file, source }) =>
        file === 'apps/web/src/styles.scss'
            ? {
                  file,
                  source: `${source}\ninput, button, textarea, :focus { outline: none; }\n`,
              }
            : { file, source }
    );
    assert.equal(checkFocusVisible(reverted).length, 4);
});
