import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    findLiteralGlyphs,
    findRegistryMismatches,
    listScannedFiles,
    REGISTRY_FILE,
} from './check-favorite-glyph.mjs';
import { loadLigatures } from './check-icon-ligatures.mjs';

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const names = (file, source) =>
    findLiteralGlyphs(file, source).map(({ line, name }) => ({ line, name }));
const registry = (body) => `export const APP_ICONS = {\n${body}\n} as const;\n`;

test('reports a star toggle in a favourite button template', () => {
    const template = [
        '<button class="favorite-button" [attr.aria-pressed]="isFavorite()">',
        "    <mat-icon>{{ isFavorite() ? 'star' : 'star_outline' }}</mat-icon>",
        '</button>',
    ].join('\n');

    assert.deepEqual(names('a.html', template), [
        { line: 2, name: 'star' },
        { line: 2, name: 'star_outline' },
    ]);
});

test('reports star and heart names in icon inputs and TypeScript icon values', () => {
    const template =
        "<app-detail-icon-button [icon]=\"on ? 'favorite' : 'favorite_border'\" />";
    const source = [
        "const FAVORITES_VIEW = { id: 'favorites', icon: 'star' };",
        "export const RATING_ICON = 'grade';",
    ].join('\n');

    assert.deepEqual(names('a.html', template), [
        { line: 1, name: 'favorite' },
        { line: 1, name: 'favorite_border' },
    ]);
    assert.deepEqual(names('a.ts', source), [
        { line: 1, name: 'star' },
        { line: 2, name: 'grade' },
    ]);
});

test('accepts registry references and unrelated icons', () => {
    const template = [
        '<mat-icon>{{ favoriteToggleIcon() }}</mat-icon>',
        '<mat-icon>{{ appIcons.rating }}</mat-icon>',
        '<app-detail-icon-button [icon]="favoriteIcon(isFavorite())" />',
        '<mat-icon>history</mat-icon>',
    ].join('\n');
    const source = "const VIEW = { icon: APP_ICONS.favorite, label: 'star' };";

    assert.deepEqual(names('a.html', template), []);
    assert.deepEqual(names('a.ts', source), []);
});

test('reports a registry that maps a favourite to a star', () => {
    const source = registry(
        [
            "    favorite: 'star',",
            "    favoriteOutline: 'favorite_border',",
            "    rating: 'favorite',",
            "    support: 'star_border',",
        ].join('\n')
    );

    assert.deepEqual(
        findRegistryMismatches(source).map(({ line, name, reason }) => ({
            line,
            name,
            reason,
        })),
        [
            { line: 2, name: "favorite: 'star'", reason: 'must be a heart' },
            { line: 4, name: "rating: 'favorite'", reason: 'must be a star' },
            {
                line: 5,
                name: "support: 'star_border'",
                reason: 'a star is reserved for rating* keys',
            },
        ]
    );
});

test('reads quoted keys, wrapped values and template literals', () => {
    const source = registry(
        [
            "    'favorite': ('star'),",
            '    favoriteOutline: `star_border`,',
            '    "rating": \'favorite\' as const,',
            "    ratingOutline: 'star_outline',",
        ].join('\n')
    );

    assert.deepEqual(
        findRegistryMismatches(source).map(({ line, reason }) => ({
            line,
            reason,
        })),
        [
            { line: 2, reason: 'must be a heart' },
            { line: 3, reason: 'must be a heart' },
            { line: 4, reason: 'must be a star' },
        ]
    );
});

test('rejects registry entries it cannot read statically', () => {
    const source = registry(
        ['    favorite: HEART,', '    ...EXTRA,', "    [KEY]: 'star',"].join(
            '\n'
        )
    );

    assert.deepEqual(
        findRegistryMismatches(source).map(({ line }) => line),
        [2, 3, 4]
    );
});

test('reports a missing registry', () => {
    assert.deepEqual(
        findRegistryMismatches('export const OTHER = {};').map(
            ({ reason }) => reason
        ),
        ['not found']
    );
});

test('the shipped registry is consistent and uses names the font draws', async () => {
    const source = readFileSync(path.join(repoRoot, REGISTRY_FILE), 'utf8');
    const ligatures = await loadLigatures();
    const values = [...source.matchAll(/^\s+\w+: '([a-z_]+)',$/gm)].map(
        ([, value]) => value
    );

    assert.deepEqual(findRegistryMismatches(source), []);
    assert.ok(values.length >= 4);
    for (const value of values) {
        assert.ok(ligatures.has(value), value);
    }
});

test('scans renderer sources but not the registry or specs', () => {
    const files = listScannedFiles(repoRoot);

    assert.ok(files.length > 0);
    assert.ok(!files.includes(REGISTRY_FILE));
    assert.ok(files.every((file) => !/\.(spec|test)\.ts$/.test(file)));
    assert.ok(
        files.some((file) => file.endsWith('channel-list-item.component.html'))
    );
});
