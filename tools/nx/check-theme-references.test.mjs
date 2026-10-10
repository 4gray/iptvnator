import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
    findColorSchemeQueries,
    findUndeclaredReads,
    listScannedFiles,
    stripComments,
} from './check-theme-references.mjs';

const lines = (...rows) => rows.join('\n');

test('reports a var() read that nothing declares, with its location', () => {
    const sources = [
        {
            file: 'a.scss',
            source: lines(
                '.title {',
                '    color: var(--app-heading-color);',
                '    border-color: var(--settings-muted, #888);',
                '}'
            ),
        },
        { file: 'theme.scss', source: 'html { --app-heading-color: #111; }' },
    ];

    assert.deepEqual(findUndeclaredReads(sources), [
        { file: 'a.scss', line: 3, name: '--settings-muted' },
    ]);
});

test('accepts properties declared in another file, from TS or by a binding', () => {
    const sources = [
        {
            file: 'reads.scss',
            source: lines(
                '.a { width: var(--overlay-width, 400px); }',
                '.b { box-shadow: 0 0 4px var(--radio-accent); }',
                '.c { flex: 0 0 var(--guide-col); }',
                '.d { left: var(--rail-offset); }',
                '.e { color: var(--chip-color); }',
                '.f { opacity: var(--dim-opacity); }'
            ),
        },
        {
            file: 'player.component.ts',
            source: lines(
                'el.style.setProperty(',
                "    '--radio-accent',",
                '    color',
                ');',
                "document.documentElement.style.setProperty('--overlay-width', w);",
                "host: { '[style.--rail-offset]': 'offset()' },",
                "const style = { '--chip-color': accent };"
            ),
        },
        {
            file: 'guide.component.html',
            source: '<div [style.--guide-col.px]="width"></div>',
        },
        { file: 'page.scss', source: ':host {\n    --dim-opacity: 0.6;\n}' },
    ];

    assert.deepEqual(findUndeclaredReads(sources), []);
});

test('a BEM modifier before a pseudo-class is not a declaration', () => {
    const sources = [
        {
            file: 'row.scss',
            source: lines(
                '.row--current:hover { color: var(--current); }',
                '.row { &--open:focus { color: var(--open); } }'
            ),
        },
    ];

    assert.deepEqual(
        findUndeclaredReads(sources).map(({ name }) => name),
        ['--current', '--open']
    );
});

test('ignores comments, Material internals and known third-party properties', () => {
    const sources = [
        {
            file: 'b.scss',
            source: lines(
                '// var(--from-a-comment) is not a read.',
                '/* nor var(--from-a-block',
                '   comment) */',
                '.a { color: var(--mat-sys-error); }',
                '.b { border-color: var(--mdc-outline, red); }',
                '.c { bottom: var(--art-subtitle-bottom); }',
                '.d { background: url(https://example.test/a.png); }'
            ),
        },
        {
            file: 'c.html',
            source: '<!-- <div style="color: var(--in-html-comment)"> -->',
        },
    ];

    assert.deepEqual(findUndeclaredReads(sources), []);
});

test('a comment is blanked without moving later lines', () => {
    const source = lines('/* one', 'two */ a', 'b // c', 'https://d');
    const stripped = stripComments(source);

    assert.equal(stripped.split('\n').length, 4);
    assert.equal(stripped.split('\n')[1].trim(), 'a');
    assert.equal(stripped.split('\n')[2].trim(), 'b');
    assert.equal(stripped.split('\n')[3], 'https://d');
});

test('reports prefers-color-scheme in app styles, outside the settings resolver', () => {
    const query = lines(
        '.card { color: var(--app-heading-color); }',
        '@media (prefers-color-scheme: light) {',
        '    .card { color: #111; }',
        '}'
    );

    assert.deepEqual(
        findColorSchemeQueries('libs/ui/card/card.component.scss', query),
        [{ file: 'libs/ui/card/card.component.scss', line: 2 }]
    );
    assert.deepEqual(
        findColorSchemeQueries(
            'apps/web/src/app/services/settings.service.ts',
            "window.matchMedia('(prefers-color-scheme: dark)')"
        ),
        []
    );
    assert.deepEqual(
        findColorSchemeQueries(
            'libs/ui/card/card.component.scss',
            '// Not @media (prefers-color-scheme: light): it follows the OS.'
        ),
        []
    );
});

test('selects tracked runtime sources at any depth, not tests, E2E, mocks or the website', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'theme-ref-guard-'));
    const git = (...args) =>
        execFileSync('git', args, { cwd: rootDir, stdio: 'pipe' });
    try {
        git('init', '-q');
        const files = {
            'libs/ui/feature/src/lib/deep/panel.component.scss': '',
            'libs/ui/feature/src/lib/deep/panel.component.html': '',
            'libs/ui/feature/src/lib/deep/panel.component.ts': '',
            'libs/ui/feature/src/lib/deep/panel.component.spec.ts': '',
            'libs/ui/feature/src/lib/deep/panel.test-helpers.ts': '',
            'libs/ui/feature/src/lib/deep/panel.test-stubs.ts': '',
            'libs/shared/testing/src/index.ts': '',
            'apps/web/src/styles.scss': '',
            'apps/web/src/vendor.css': '',
            'apps/electron-backend-e2e/src/rail.e2e.ts': '',
            'apps/electron-backend-e2e/src/theme-contrast.ts': '',
            'apps/web-e2e/src/recent.e2e-support.ts': '',
            'apps/xtream-mock-server/src/main.ts': '',
            'apps/website/src/styles/global.css': '',
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
