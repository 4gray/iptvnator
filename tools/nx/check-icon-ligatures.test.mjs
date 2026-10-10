import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    FONT_PACKAGE,
    findUnknownIcons,
    listScannedFiles,
    loadLigatures,
} from './check-icon-ligatures.mjs';
import { isIconName } from './icon-ligature-sources.mjs';

const ligatures = await loadLigatures();
const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const unknown = (file, source) =>
    findUnknownIcons(file, source, ligatures).map(
        ({ line, name, source: from }) => ({ line, name, source: from })
    );

test('reads the font the web app loads', () => {
    const styles = readFileSync(
        path.join(repoRoot, 'apps/web/src/styles.scss'),
        'utf8'
    );

    assert.match(styles, new RegExp(`@import '${FONT_PACKAGE}/`));
    assert.ok(ligatures.has('error_outline'));
    assert.ok(ligatures.has('open_in_new'));
    assert.ok(!ligatures.has('file_off'));
    assert.ok(!ligatures.has('arrow_outward'));
});

test('drops codepoints the font has no ligature for', () => {
    assert.ok(!ligatures.has('rounded_corner'));
    assert.ok(!ligatures.has('stairs'));
});

test('reports unknown static <mat-icon> text on the line of the name', () => {
    const template = [
        '<button>',
        '    <mat-icon>play_arrow</mat-icon>',
        '    <mat-icon aria-hidden="true">',
        '        arrow_outward',
        '    </mat-icon>',
        '</button>',
    ].join('\n');

    assert.deepEqual(unknown('a.html', template), [
        { line: 4, name: 'arrow_outward', source: '<mat-icon> text' },
    ]);
});

test('reads only the results of a <mat-icon> interpolation', () => {
    const template = [
        '<mat-icon>',
        "    {{ reason === 'file-missing'",
        "        ? 'file_off'",
        "        : 'error' }}",
        '</mat-icon>',
        "<mat-icon>{{ name ?? 'no_such_icon' }}</mat-icon>",
        "<mat-icon>{{ 'mystery_' + kind }}</mat-icon>",
        '<mat-icon>prefix_{{ kind }}</mat-icon>',
        '<mat-icon>{{ statusIcon(row) }}</mat-icon>',
    ].join('\n');

    assert.deepEqual(unknown('b.html', template), [
        { line: 3, name: 'file_off', source: '<mat-icon> binding' },
        { line: 6, name: 'no_such_icon', source: '<mat-icon> binding' },
    ]);
});

test('checks icon inputs but not classes, attributes or SVG icons', () => {
    const template = [
        '<app-empty-state icon="tv_offf" actionIcon="chevron_right" />',
        "<app-button [icon]=\"on ? 'favorite' : 'favourite_border'\" />",
        '<div [class.icon]="true" [attr.data-icon]="\'not_a_name\'"></div>',
        '<mat-icon svgIcon="custom_logo"></mat-icon>',
        '<app-logo icon="https://example.test/logo.png" />',
        "@if (show) { <mat-icon>{{ on ? 'lock' : 'unlockk' }}</mat-icon> }",
        '@for (x of xs; track x) { <app-row [auxActionIcon]="\'delete\'" /> }',
    ].join('\n');

    assert.deepEqual(unknown('c.html', template), [
        { line: 1, name: 'tv_offf', source: 'icon attribute' },
        { line: 2, name: 'favourite_border', source: '[icon] binding' },
        { line: 6, name: 'unlockk', source: '<mat-icon> binding' },
    ]);
});

test('reads icon-named TypeScript declarations and inline templates', () => {
    const source = `
const STATUS_ICONS: Record<Status, string> = {
    queued: 'schedule',
    failed: 'error_bad',
};
const AUDIO_TRACK_ICON = '<svg viewBox="0 0 24 24"></svg>';
const LABEL = 'not_an_icon_name';

@Component({
    selector: 'app-row',
    template: \`
        <mat-icon>chevron_right</mat-icon>
        <mat-icon>chevron_rightt</mat-icon>
    \`,
})
export class RowComponent {
    readonly icon = input('live_tvv');
    readonly sortIcon = computed(() =>
        this.ascending() ? 'arrow_upward' : 'arrow_downward_x'
    );
    readonly options = [{ value: 'a', icon: 'grid_view' }, { icon: 'listt' }];
    readonly emptyIcon = '';

    statusIcon(row: Row): string {
        if (row.missing) {
            return 'file_off';
        }
        const label = () => 'nested_closure_result';
        return STATUS_ICONS[row.status] ?? \`x_\${row.kind}\`;
    }
}
`;

    assert.deepEqual(unknown('d.component.ts', source), [
        { line: 4, name: 'error_bad', source: 'STATUS_ICONS value' },
        { line: 13, name: 'chevron_rightt', source: '<mat-icon> text' },
        { line: 17, name: 'live_tvv', source: 'icon value' },
        { line: 19, name: 'arrow_downward_x', source: 'sortIcon value' },
        { line: 21, name: 'listt', source: 'icon value' },
        { line: 26, name: 'file_off', source: 'statusIcon value' },
    ]);
});

test('reads quoted inline templates, but not other template properties', () => {
    const source = [
        "@Component({ selector: 'a', template: '<mat-icon>file_off</mat-icon>' })",
        'export class A {}',
        "@Component({ selector: 'b', template: \"<mat-icon>{{ on ? 'x' : 'unlockk' }}</mat-icon>\" })",
        'export class B {}',
        "const notAComponent = { template: '<mat-icon>not_checked</mat-icon>' };",
    ].join('\n');

    assert.deepEqual(unknown('e.component.ts', source), [
        { line: 1, name: 'file_off', source: '<mat-icon> text' },
        { line: 3, name: 'x', source: '<mat-icon> binding' },
        { line: 3, name: 'unlockk', source: '<mat-icon> binding' },
    ]);
});

test('names icon sources by convention, not SVG icon inputs', () => {
    for (const name of [
        'icon',
        'statusIcon',
        'STATUS_ICON',
        'sourceIcons',
        'STATUS_ICONS',
    ]) {
        assert.ok(isIconName(name), name);
    }
    for (const name of ['svgIcon', 'Icon', 'icons', 'iconSize', 'lexicon']) {
        assert.ok(!isIconName(name), name);
    }
});

test('selects tracked web and lib sources at any depth, but not specs', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'icon-guard-'));
    const git = (...args) =>
        execFileSync('git', args, { cwd: rootDir, stdio: 'pipe' });
    try {
        git('init', '-q');
        const files = {
            'libs/ui/feature/src/lib/deep/panel.component.html': '',
            'libs/ui/feature/src/lib/deep/panel.component.ts': '',
            'libs/ui/feature/src/lib/deep/panel.component.spec.ts': '',
            'apps/web/src/app/app.component.html': '',
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
            'apps/web/src/app/app.component.html',
            'libs/ui/feature/src/lib/deep/panel.component.html',
            'libs/ui/feature/src/lib/deep/panel.component.ts',
        ]);
    } finally {
        await rm(rootDir, { recursive: true, force: true });
    }
});
