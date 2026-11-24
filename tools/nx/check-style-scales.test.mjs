import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    TOKEN_FILES,
    compareToBaseline,
    countDistinct,
    findLiterals,
    findUndersized,
    isLiteral,
    listScannedFiles,
    normalizeValue,
    stripComments,
} from './check-style-scales.mjs';

test('finds literal sizes, radii, z-index values and shadows', () => {
    const source = [
        '.row {',
        '    font-size: 13px;',
        '    border-radius: 10px;',
        '    border-top-left-radius: 4px;',
        '    z-index: 1000;',
        '    box-shadow:',
        '        0 18px 40px rgba(0, 0, 0, 0.35),',
        '        inset 0 0 0 1px var(--app-line-strong);',
        '}',
    ].join('\n');

    assert.deepEqual(
        findLiterals('a.scss', source).map(({ line, category, value }) => [
            line,
            category,
            value,
        ]),
        [
            [2, 'fontSize', '13px'],
            [3, 'radius', '10px'],
            [4, 'radius', '4px'],
            [5, 'zIndex', '1000'],
            [
                6,
                'boxShadow',
                '0 18px 40px rgba(0, 0, 0, 0.35), inset 0 0 0 1px var(--app-line-strong)',
            ],
        ]
    );
});

test('token reads, Sass variables, zero and none are not literals', () => {
    for (const value of [
        'var(--app-text-sm)',
        'var(--app-radius-lg) var(--app-radius-lg) 0 0',
        'controls.$radius-sm',
        '$radius',
        '#{$size}',
        'var(--app-z-overlay)',
        'var(--app-elev-4)',
        'var(--app-widget-shadow, 0 12px 28px rgba(15, 23, 42, 0.16))',
        '0',
        'none',
        'inherit',
    ]) {
        assert.equal(isLiteral(normalizeValue(value)), false, value);
    }
    for (const value of ['0.78rem', '50%', '-1', 'inset 0 0 0 1px var(--x)']) {
        assert.equal(isLiteral(normalizeValue(value)), true, value);
    }
});

test('ignores comments, custom properties, Sass map keys and lookalikes', () => {
    const source = [
        '// font-size: 99px;',
        '/* z-index: 9999; */',
        '.a {',
        '    --row-font-size: 13px;',
        '    $font-size: 12px;',
        '    @include mat.dialog-overrides((container-shape: 16px));',
        '    background: url(https://example.com/a.png);',
        '    &:hover { color: red; }',
        '}',
    ].join('\n');

    assert.deepEqual(findLiterals('b.scss', source), []);
    assert.match(stripComments('a: url(//cdn.example.com/x); // c'), /cdn/);
});

test('counts distinct normalized values per category', () => {
    const findings = [
        ...findLiterals('a.scss', '.a { font-size: 13px; z-index: 2; }'),
        ...findLiterals('b.scss', '.b { font-size: 13px !important; }'),
        ...findLiterals('c.scss', '.c { font-size: 0.78rem; }'),
    ];
    assert.deepEqual(countDistinct(findings), {
        fontSize: 2,
        radius: 0,
        zIndex: 1,
        boxShadow: 0,
    });
});

test('flags text below the 11px floor, in font-size and the font shorthand', () => {
    const source = [
        '.a { font-size: 10.5px; }',
        '.b { font-size: 0.62rem !important; }',
        '.c { font: 600 9px $font-mono; }',
        '.d { font: 500 var(--app-text-2xs) $font-mono; }',
        '.e { font-size: 11px; font-size: 0.6875rem; }',
        '.f { font-size: clamp(9px, 2vw, 14px); font-size: 0.8em; }',
        '.g { font-size: var(--app-text-2xs); --tiny: 8px; }',
    ].join('\n');
    assert.deepEqual(
        findUndersized('a.scss', source).map(({ line, value }) => [
            line,
            value,
        ]),
        [
            [1, '10.5px'],
            [2, '0.62rem'],
            [3, '600 9px $font-mono'],
        ]
    );
});

test('the baseline only moves down', () => {
    const baseline = { fontSize: 3, radius: 2, zIndex: 1, boxShadow: 4 };
    assert.deepEqual(
        compareToBaseline(
            { fontSize: 4, radius: 2, zIndex: 0, boxShadow: 4 },
            baseline
        ),
        {
            grown: [{ key: 'fontSize', count: 4, allowed: 3 }],
            shrunk: [{ key: 'zIndex', count: 0, allowed: 1 }],
        }
    );
    assert.deepEqual(
        compareToBaseline(
            { fontSize: 0, radius: 0, zIndex: 0, boxShadow: 0 },
            { fontSize: 0 }
        ).grown.map(({ key }) => key),
        ['radius', 'zIndex', 'boxShadow']
    );
});

test('scans the web stylesheets and skips the token files', () => {
    const files = listScannedFiles(process.cwd());
    assert.ok(files.length > 100, `only ${files.length} stylesheets`);
    assert.ok(files.includes('libs/ui/styles/_panel-header.scss'));
    assert.ok(files.every((file) => !TOKEN_FILES.has(file)));
    assert.ok(files.every((file) => !file.startsWith('apps/tv/')));
});
