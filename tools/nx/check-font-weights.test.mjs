import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    MONO_WEIGHT_CAP,
    blankComments,
    describeFinding,
    findIndirectWeights,
    findOffScaleWeights,
    findWorkspaceWeights,
    isScannedFile,
    nearestScaleWeight,
    scanWeights,
    validateScanCoverage,
} from './check-font-weights.mjs';
import { decodeEscapes } from './font-weight-lexer.mjs';

const offScale = (file, source) =>
    findOffScaleWeights(file, source).findings.map(
        ({ line, name, value }) => `${line} ${name}: ${value}`
    );

/** The findings across `files` (`{ path: source }`), scanned together. */
const workspace = (files) =>
    findWorkspaceWeights(
        Object.entries(files).map(([file, source]) => ({ file, source }))
    ).findings.map(
        ({ file, line, name, value }) => `${file}:${line} ${name}: ${value}`
    );

test('flags an off-scale font-weight with its line number', () => {
    const source = ['.title {', '    font-weight: 650;', '}'].join('\n');

    assert.deepEqual(offScale('libs/a.component.scss', source), [
        '2 font-weight: 650',
    ]);
});

test('accepts every scale weight and the keywords that resolve onto it', () => {
    const source = [
        'a { font-weight: 400; }',
        'b { font-weight: 500 !important; }',
        'c { font-weight: 600; }',
        'd { font-weight: 700; }',
        'e { font-weight: normal; }',
        'f { font-weight: bold; }',
        'g { font-weight: inherit; }',
        'h { font-weight: $title-weight; }',
        'i { font-weight: var(--error-view-title-weight); }',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), []);
});

test('flags weights fed through custom properties, Sass and token maps', () => {
    const source = [
        '.view {',
        '    --error-empty-title-weight: 610;',
        '    --error-view-title-weight: var(--error-empty-title-weight, 640);',
        '}',
        '@include detail-view.base(',
        '    $season-title-font-weight: 650,',
        ');',
        '@include mat.button-overrides((label-text-weight: 530));',
        '@include heading($title-weight: 650) {',
        '    color: red;',
        '}',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), [
        '2 --error-empty-title-weight: 610',
        '3 --error-view-title-weight: 640',
        '6 $season-title-font-weight: 650',
        '8 label-text-weight: 530',
        '9 $title-weight: 650',
    ]);
});

test('reads the weight of a font shorthand but not its line height', () => {
    const source = [
        '.a { font: 600 10.5px $font-mono; }',
        '.b { font: 800 12px/1 sans-serif; }',
        '.d { font: inherit; }',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), ['2 font: 800']);
});

test('reads a value wrapped over several lines to its end', () => {
    const source = [
        '.a {',
        '    font-weight: var(--title-weight,',
        '        650);',
        '}',
        '.b {',
        '    font-weight:',
        '        var(',
        '            --title-weight,',
        '            750',
        '        );',
        '}',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), [
        '2 font-weight: 650',
        '6 font-weight: 750',
    ]);
});

test('stops a value at the end of its map entry or style string', () => {
    const map = [
        '@include mat.button-overrides(',
        '    (',
        '        label-text-weight: 600,',
        '        label-text-line-height: 1,',
        '    )',
        ');',
    ].join('\n');
    const component = [
        "const style = 'font-weight: 600';",
        'const timeout = 300;',
    ].join('\n');

    const template = '<p style="font-weight: 600">Top 100 channels</p>';

    assert.deepEqual(offScale('libs/a.scss', map), []);
    assert.deepEqual(offScale('apps/web/src/a.ts', component), []);
    assert.deepEqual(offScale('apps/web/src/a.html', template), []);
});

test('checks the font shorthand in TypeScript, not a font property', () => {
    const component = [
        "styles: ['.chip { font: 650 12px sans-serif; }'],",
        'const chart = { font: 12, legend: { font: { size: 12 } } };',
        "const inherit = { font: 'inherit' };",
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '1 font: 650',
    ]);
});

test('compares every CSS number form with the scale', () => {
    const source = [
        '.a { font-weight: 650.0; }',
        '.b { font-weight: 600.0; }',
        '.c { font-weight: 6.5e2; }',
        '.d { font-weight: +700; }',
        '.e { font: 520.5 12px sans-serif; }',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), [
        '1 font-weight: 650.0',
        '3 font-weight: 6.5e2',
        '5 font: 520.5',
    ]);
});

test('reads a declaration to its terminator however long it is', () => {
    const source = `.a { font-weight: /* ${'x'.repeat(600)} */ 650; }`;

    assert.deepEqual(offScale('libs/a.scss', source), ['1 font-weight: 650']);
});

test('flags relative keywords in the font shorthand', () => {
    const source = '.a { font: bolder 1rem sans-serif; }';

    assert.deepEqual(offScale('libs/a.scss', source), ['1 font: bolder']);
});

test('follows variables a weight refers to, through chains and files', () => {
    const source = [
        ':root { --title: var(--title-base); --title-base: 650; --gap: 3; }',
        '$heading: 750;',
        '.a { font-weight: var(--title); gap: var(--gap); }',
        '.b { font-weight: $heading; }',
        '.c { font: 600 var(--size) $family; }',
        ':root { --size: 12; }',
        '$family: 1;',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), [
        '2 $heading: 750',
        '1 --title-base: 650',
    ]);

    const tokens = scanWeights('libs/tokens.scss', ':root { --title: 650; }');
    const usage = scanWeights(
        'libs/b.component.scss',
        '.b { font-weight: var(--title); }'
    );
    assert.deepEqual(
        findIndirectWeights([tokens, usage]).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        ),
        ['libs/tokens.scss:1 650']
    );
});

test('checks Angular style bindings and literal DOM writes', () => {
    const template = [
        '<p [style.font-weight]="active() ? 650 : 400">a</p>',
        '<p [style.fontWeight]="items.length > 3 ? 700 : 500">b</p>',
    ].join('\n');
    const component = [
        "host: { '[style.font-weight]': '750' },",
        "element.style.fontWeight = '650';",
        "element.style.setProperty('font-weight', '450');",
        'element.style.fontWeight = weight;',
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.html', template), [
        '1 [style.font-weight]: 650',
    ]);
    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '1 [style.font-weight]: 750',
        '2 .style.fontWeight: 650',
        "3 setProperty('font-weight': 450",
    ]);
});

test('reads `//` after `:` or `(` as a Sass comment outside url()', () => {
    const stylesheet = [
        '.x { font-weight:// old 650',
        '600; }',
        '.y { font-weight: (// note 650',
        '600); }',
        '.z { background: url(http://cdn.test/a.png); font-weight: 750; }',
        '.w { color: red; } // a note that ends in url(',
        '// font-weight: 650 was the old value',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', stylesheet), [
        '5 font-weight: 750',
    ]);
});

test('reads a TypeScript style object value as code', () => {
    const component = [
        'const style = { fontWeight: viewportWidth >= 768 ? 700 : 600 };',
        "const other = { 'font-weight': wide ? 650 : 400, color: 'red' };",
        'const css = `font-weight: ${w}; font: 650 12px x`;',
        'fontWeight: number;',
        "const keyed = { ['font-weight']: 650, [`fontWeight`]: 750 };",
    ].join('\n');

    assert.deepEqual(
        offScale('apps/web/src/a.component.ts', component).sort(),
        [
            '2 font-weight: 650',
            '3 font: 650',
            '5 font-weight: 650',
            '5 fontWeight: 750',
        ]
    );
    // HTML outside attributes is markup, not code: a `<style>` block's
    // shorthand keeps its `/line-height`.
    assert.deepEqual(
        offScale(
            'apps/web/src/a.component.html',
            '<style>.x { font: italic 12px/200 Roboto; }</style>'
        ),
        []
    );
});

test('treats JetBrains Mono after an always-available family as a fallback', () => {
    const source = [
        ".a { font: 700 16px Roboto, 'JetBrains Mono'; }",
        ".b { font-family: monospace, 'JetBrains Mono'; font-weight: 700; }",
        ".c { font-family: 'SF Mono', 'JetBrains Mono'; font-weight: 700; }",
        ".d { font: 700 12px/1.4 'JetBrains Mono'; }",
        ".e { font: 700 12px / 1.4 'JetBrains Mono'; }",
        ".f { font: 700 12px / 1.4 Roboto, 'JetBrains Mono'; }",
        ".g { font: 700 12px /1.4 Roboto, 'JetBrains Mono'; }",
        ".h { font-family: 'Roboto', 'JetBrains Mono'; font-weight: 700; }",
        // DM Sans is Latin-only: Russian or Greek text falls through to Mono.
        ".i { font-family: 'DM Sans', 'JetBrains Mono'; font-weight: 700; }",
        // A size from a variable: the family follows it.
        ".j { font: 700 var(--size, 12px) 'JetBrains Mono'; }",
        ".k { font: 700 var(--size, 12px) Roboto, 'JetBrains Mono'; }",
        ".l { font: 700 $size 'JetBrains Mono'; }",
        ".m { font: 700 var(--size) 'JetBrains Mono'; }",
        // The name is matched whole.
        ".n { font-family: 'Not JetBrains Mono'; font-weight: 700; }",
        // `emoji` covers special glyphs only; text falls through to Mono.
        ".o { font-family: emoji, 'JetBrains Mono'; font-weight: 700; }",
    ].join('\n');

    assert.deepEqual(offScale('libs/m6/a.scss', source).sort(), [
        '10 font: 700',
        '12 font: 700',
        '13 font: 700',
        '15 font-weight: 700',
        '3 font-weight: 700',
        '4 font: 700',
        '5 font: 700',
        '9 font-weight: 700',
    ]);
    assert.deepEqual(
        offScale(
            'apps/web/src/a.component.html',
            `<div style="font: 700 16px Roboto, 'JetBrains Mono'"></div>`
        ),
        []
    );
});

test('reads a family name as the browser does', () => {
    const source = [
        // Escapes decode: these all name JetBrains Mono.
        '.a { font-family: JetBrains\\ Mono; font-weight: 700; }',
        '.b { font-family: \\4a etBrains Mono; font-weight: 700; }',
        ".c { font-family: 'JetBrains\\20 Mono'; font-weight: 700; }",
        '.d { font: 700 12px JetBrains\\ Mono; }',
        // A quoted generic is a family name nobody has; an escaped one is
        // still the keyword.
        ".e { font-family: 'monospace', 'JetBrains Mono'; font-weight: 700; }",
        ".f { font-family: \\73 erif, 'JetBrains Mono'; font-weight: 700; }",
        // A string keeps its spaces and commas: neither is JetBrains Mono.
        ".g { font-family: 'JetBrains  Mono'; font-weight: 700; }",
        ".h { font-family: 'JetBrains Mono, x'; font-weight: 700; }",
        // Unquoted words join with one space; an escaped one is kept.
        '.i { font-family: JetBrains   Mono; font-weight: 700; }',
        '.j { font: 700 12px JetBrains\\  Mono; }',
        // Not one name: CSS drops the declaration.
        ".k { font-family: 'JetBrains Mono' Bold; font-weight: 700; }",
        '.l { font-family: JetBrains\\\n Mono; font-weight: 700; }',
        // A string's escaped quote is text; a line break in a string
        // continues it when escaped and ends it (unclosed) otherwise.
        ".m { font-family: 'x\\', JetBrains Mono, y'; font-weight: 700; }",
        ".n { font-family: 'JetBrains\\\n Mono'; font-weight: 700; }",
        ".o { font-family: 'JetBrains Mono\n; font-weight: 700; }",
        // An escape past the last code point is U+FFFD.
        '.p { font-family: \\110000 JetBrains Mono; font-weight: 700; }',
    ].join('\n');

    assert.deepEqual(offScale('libs/m6/escapes.scss', source).sort(), [
        '1 font-weight: 700',
        '16 font-weight: 700',
        '2 font-weight: 700',
        '3 font-weight: 700',
        '4 font: 700',
        '5 font-weight: 700',
        '9 font-weight: 700',
    ]);
});

test('reads escaped names as Sass and the browser do', () => {
    const source = [
        '.a { font-w\\65 ight: 650; fo\\6et-weight: 750; }',
        '.b { font\\2d weight: 650; font-\\77 eight: 750; }',
        '.c { --w\\65 ight: 650; font-weight: var(--weight); }',
        '$w\\65: 750; .d { font-weight: $we; }',
        ".e { font-family: 'JetBrains Mono'; font-weight: b\\6f ld; }",
        // An escape that ends at a line break keeps later lines in place.
        '.f { font-w\\65',
        'ight: 650; }',
        '.g { font-weight: 750; }',
    ].join('\n');

    assert.deepEqual(offScale('libs/m6/escaped.scss', source).sort(), [
        '1 font-weight: 650',
        '1 font-weight: 750',
        '2 font-weight: 650',
        '2 font-weight: 750',
        '3 --weight: 650',
        '4 $we: 750',
        '5 font-weight: bold',
        '6 font-weight: 650',
        '8 font-weight: 750',
    ]);
    assert.deepEqual(
        offScale(
            'apps/web/src/a.component.html',
            '<p style="font-w\\65 ight: 650">x</p>'
        ),
        ['1 font-weight: 650']
    );
    // An escape stays where its character would change the token: a digit
    // starting a name, anything after a number, a character no name has,
    // and past ASCII. TypeScript strings use JavaScript escapes instead.
    const kept = [
        '\\36 50',
        '6\\35 0',
        '6\\65 2',
        '-\\35',
        '.a\\:b',
        "'\\\\65'",
        'JetBrains\\20 Mono',
        'a\\10061',
    ].join(' ');
    assert.equal(decodeEscapes('a.scss', kept).text, kept);
    assert.equal(
        decodeEscapes('a.scss', '-\\77 x a\\31, \\5f x -w\\65 bkit').text,
        '-wx a1, _x -webkit'
    );
    assert.equal(
        decodeEscapes('a.ts', 'font-w\\65 ight').text,
        'font-w\\65 ight'
    );
    // A comment is no CSS, so an escape there cannot take the line break.
    assert.deepEqual(
        offScale('libs/m6/note.scss', '// note \\65\n.a { font-weight: 650; }'),
        ['2 font-weight: 650']
    );
});

test('reads markup character references as the browser does', () => {
    const template = [
        '<p style="font-weight: &#x36;50"></p>',
        '<p style="font-weight&colon; 650"></p>',
        '<p style="font-weight: 750&#x3b font-weight: 400"></p>',
        '<p style="font-w&#x65;ight: 650"></p>',
        '<p style="font-family: &quot;JetBrains Mono&quot;; font-weight: 700"></p>',
        "<p style='font-family: &quot;JetBrains Mono&quot;; font-weight: 700'></p>",
        // A decoded line break keeps later lines in place.
        '<p style="&#10;font-weight: 650"></p>',
        // Not decoded: `<style>` text, a reference to `&`, and comments.
        '<style>.a { font-weight: &#54;50; }</style>',
        '<p style="font-weight: &amp;#54;50"></p>',
        '<!-- <p style="font-weight: &#54;50"></p> -->',
        '<!-- &#45;&#45;> <p style="font-weight: 650"> -->',
        // `<` and `>` stay text: no tag opens or closes.
        '<p>&#60;i style="font-weight: 650"&#62;</p>',
        '<p title=a&#62;b style="font-weight: 750"></p>',
        // Past the last code point is U+FFFD.
        '<p title="&#99999999;" style="font-weight: 650"></p>',
    ].join('\n');
    const svg = [
        '<svg><text font-weight="&#54;50">x</text>',
        '<style>.a { font-weight: &#55;50; }</style>',
        '<style><![CDATA[.b { font-weight: &#54;50; }]]></style></svg>',
    ].join('\n');

    assert.deepEqual(
        offScale('apps/web/src/a.component.html', template).sort(),
        [
            '1 font-weight: 650',
            '13 font-weight: 750',
            '14 font-weight: 650',
            '2 font-weight: 650',
            '3 font-weight: 750',
            '4 font-weight: 650',
            '5 font-weight: 700',
            '6 font-weight: 700',
            '7 font-weight: 650',
        ]
    );
    // Lines hold through references that decode to two UTF-16 units, and
    // through references and escapes decoded together.
    const emoji = '&#x1F600;'.repeat(30);
    assert.deepEqual(
        offScale(
            'apps/web/src/a.component.html',
            `<p title="${emoji}"></p>\n<i style="font-weight: 650"></i>\n<b></b>`
        ),
        ['2 font-weight: 650']
    );
    assert.deepEqual(
        offScale(
            'apps/web/src/a.component.html',
            '<p title="&#10;&#10;&#10;"></p>\n<i style="font-w\\65 ight: 650"></i>'
        ),
        ['2 font-weight: 650']
    );
    assert.deepEqual(offScale('apps/web/src/assets/icon.svg', svg).sort(), [
        '1 font-weight: 650',
        '2 font-weight: 750',
    ]);
});

test('reads CSS text a string leaves to code', () => {
    const template = [
        `<div [style]="'font-weight:' + 650"></div>`,
        `<div [attr.style]="'font-weight: ' + (wide ? 750 : 600)"></div>`,
        `<div [style]='"font: " + 650 + " 12px Roboto"'></div>`,
        `<div [style]="'font-family: JetBrains Mono; font-weight:' + 600"></div>`,
        // An escaped quote stays in the string.
        `<div [style]="'a: it\\'s; font-weight:' + 650"></div>`,
        // The rest of the expression is not part of the value.
        `<div [style]="'font-weight:' + 600 + ';'"></div>`,
        `<div [style]="'font: ' + 14 + 'px Roboto'"></div>`,
        `<div [style]="'color: red; font-weight:' + w + ';'"></div>`,
        // Only a `+` concatenates.
        `<div [style]="'font-weight:' || 650"></div>`,
        // A blank string adds nothing.
        `<div [style]="'font-weight:' + ' ' + 650"></div>`,
        `<div [style]="'font-weight:' + '' + 750 + ';'"></div>`,
    ].join('\n');
    const component = [
        "el.style.cssText = 'font-weight:' + 650;",
        "el.style.cssText = 'font-weight: ' + (wide ? 750 : 600) + '; x: y';",
        "el.style.cssText = 'font-weight:' + w;",
    ].join('\n');

    assert.deepEqual(
        offScale('apps/web/src/a.component.html', template).sort(),
        [
            '1 font-weight: 650',
            '10 font-weight: 650',
            '11 font-weight: 750',
            '2 font-weight: 750',
            '3 font: 650',
            '4 font-weight: 600',
            '5 font-weight: 650',
        ]
    );
    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '1 font-weight: 650',
        '2 font-weight: 750',
    ]);
});

test('reads Sass nested font properties', () => {
    const source = [
        ".x { font: { family: 'JetBrains Mono'; weight: 700; } }",
        ".z { font-family: 'JetBrains Mono'; font: { weight: 700; } }",
        ".w { font: { family: 'JetBrains Mono'; } font-weight: 700; }",
        '.y { font: 12px { weight: 650; } }',
        '.u { font: { family: Roboto; weight: 700; } }',
        // `family`/`weight` outside a `font` block are other properties.
        ".t { family: 'JetBrains Mono'; font-weight: 700; }",
        // A nested weight and the rule's own replace each other in order;
        // a bare `weight:` is no weight at all.
        ".r { font-family: 'JetBrains Mono'; font: { weight: 700; } font-weight: 500; }",
        ".s { font-family: 'JetBrains Mono'; font-weight: 700; weight: 400; }",
    ].join('\n');

    assert.deepEqual(offScale('libs/n4/a.scss', source).sort(), [
        '1 weight: 700',
        '2 weight: 700',
        '3 font-weight: 700',
        '4 weight: 650',
        '8 font-weight: 700',
    ]);
});

test('reads CSS in markup only where it styles', () => {
    const template = [
        '<code>font-weight: 650</code>',
        '<p title="font-weight: 650">x</p>',
        '<p style="font-weight: 650">x</p>',
        '<style>.a { font-weight: 750; }</style>',
        `<div [ngStyle]="{ 'font-weight': 650 }"></div>`,
        '<style>/* font-weight: 650; */ .x { font-weight: 600; content: "/* kept"; }</style>',
        // A CSS string holds no comment; after `</style>` it is markup again.
        '<style>.y { content: "/* x"; font-weight: 750; }</style>',
        '<p>/* text</p>',
        '<p style="font-weight: 650">y</p>',
        '<code>font-weight: 650</code>',
        // An unquoted `style` value runs to a space or `>`.
        '<div style=font-weight:650>x</div>',
        '<div title=font-weight:650>y</div>',
        '<div style=font-weight:600 class=x>z</div>',
        // Text that reads like an attribute, and a non-style binding.
        '<p>Set style=font-weight:650 here</p>',
        `<div [title]="'font-weight: 650'"></div>`,
    ].join('\n');

    assert.deepEqual(
        offScale('apps/web/src/a.component.html', template).sort(),
        [
            '11 font-weight: 650',
            '3 font-weight: 650',
            '4 font-weight: 750',
            '5 font-weight: 650',
            '7 font-weight: 750',
            '9 font-weight: 650',
        ]
    );
});

test('reads @property initial values', () => {
    const report = (body) =>
        findOffScaleWeights('libs/p9/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );

    assert.deepEqual(
        report(
            "@property --title-weight { syntax: '<number>'; inherits: false; initial-value: 650; } .x { font-weight: var(--title-weight); }"
        ),
        ['--title-weight: 650']
    );
    assert.deepEqual(
        report(
            "@property --w { syntax: '<number>'; initial-value: 750; inherits: false; } .y { font-weight: var(--w); }"
        ),
        ['--w: 750']
    );
    // A `<number>` takes an exponent; an `<integer>` takes neither an
    // exponent nor a fraction.
    assert.deepEqual(
        report(
            "@property --w { syntax: '<number>'; inherits: false; initial-value: 6.5e2; } .y { font-weight: var(--w); }"
        ),
        ['--w: 6.5e2']
    );
    assert.deepEqual(
        report(
            "@property --w { syntax: '<integer>'; inherits: false; initial-value: 650; } .y { font-weight: var(--w); }"
        ),
        ['--w: 650']
    );
    assert.deepEqual(
        report(
            "@property --w { syntax: '<integer>'; inherits: false; initial-value: 6.5e2; } .y { font-weight: var(--w, 600); }"
        ),
        []
    );
    // A math function of plain numbers is a valid initial value, and a
    // computed weight; one with a unit is not valid.
    assert.deepEqual(
        report(
            "@property --w { syntax: '<number>'; inherits: false; initial-value: calc(600 + 50); } .y { font-weight: var(--w); }"
        ),
        ['--w: calc(600 + 50)']
    );
    assert.deepEqual(
        report(
            "@property --w { syntax: '<number>'; inherits: false; initial-value: calc(1px + 2px); } .y { font-weight: var(--w, 600); }"
        ),
        []
    );
    assert.deepEqual(
        report(
            "@property --w { syntax: '<number>'; inherits: false; initial-value: calc(50% + 600); } .y { font-weight: var(--w, 600); }"
        ),
        []
    );
    // It parses as CSS does: arguments per function, and spaces around a
    // `+` or `-`. Each value's validity is what Chromium makes of it.
    const math = {
        valid: [
            ...['calc(600 - -50)', 'calc(600 * 1.08)', 'calc((600 + 50))'],
            ...['round(up, 649.2)', 'round(649.6, 10)', 'log(e)', 'max(650)'],
            ...['calc(pi * 207)', 'MAX(600, 650)', 'calc(1300 / 2)'],
            ...['hypot(650)', 'calc(1e3 - 350)', 'clamp(600, 650, 700)'],
        ],
        invalid: [
            ...['min()', 'calc()', 'calc(600+50)', 'calc(600 +50)'],
            ...['calc(600+ 50)', 'calc(600 +(50))', 'clamp(600, 650)'],
            ...['clamp(600, 650, 700, 800)', 'max(600, )', 'calc(600 650)'],
            ...['calc(650)%', 'calc(600 + 50))', 'round(up 649)', 'foo(650)'],
            ...['calc(600 $ 50)', 'round(up / 1, 649)'],
        ],
    };
    const registered = (value) =>
        report(
            `@property --w { syntax: '<number>'; inherits: false; initial-value: ${value}; } .y { font-weight: var(--w, 600); }`
        );
    for (const value of math.valid) {
        assert.deepEqual(registered(value), [`--w: ${value}`], value);
    }
    for (const value of math.invalid) {
        assert.deepEqual(registered(value), [], value);
    }
    // CSS ignores an invalid registration: a syntax that rejects the value,
    // or a missing `inherits`.
    assert.deepEqual(
        report(
            "@property --title-weight { syntax: '<color>'; inherits: false; initial-value: 650; } .x { font-weight: var(--title-weight, 600); }"
        ),
        []
    );
    assert.deepEqual(
        report(
            "@property --w { syntax: '<number>'; initial-value: 750; } .y { font-weight: var(--w, 600); }"
        ),
        []
    );
    const reader = scanWeights(
        'libs/p9/b.scss',
        ".b { font-family: var(--face, 'JetBrains Mono'); font-weight: 700; }"
    );
    assert.deepEqual(
        findIndirectWeights([
            scanWeights(
                'libs/p9/_props.scss',
                "@property --face { syntax: '<length>'; inherits: true; initial-value: Roboto; }"
            ),
            reader,
        ]).map(({ value }) => value),
        ['700']
    );
    // A registered property always has a value, so a fallback never
    // applies, wherever it is registered.
    assert.deepEqual(
        findIndirectWeights([
            scanWeights(
                'libs/p9/_props.scss',
                "@property --face { syntax: '*'; inherits: true; initial-value: Roboto; }"
            ),
            scanWeights(
                'libs/p9/b.scss',
                ".b { font-family: var(--face, 'JetBrains Mono'); font-weight: 700; }"
            ),
        ]),
        []
    );
});

test('checks SVG presentation attributes and styles', () => {
    const svg = [
        '<svg><text font-weight="650">x</text>',
        '<style>.a { font-weight: 750; }</style>',
        '<!-- font-weight="900" --><text font-weight="700">y</text></svg>',
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/assets/logo.svg', svg).sort(), [
        '1 font-weight: 650',
        '2 font-weight: 750',
    ]);
});

test('caps inline JetBrains Mono declarations', () => {
    const template = [
        `<div style="font: 700 16px 'JetBrains Mono'"></div>`,
        `<div style="font-family: 'JetBrains Mono'; font-weight: 700"></div>`,
        '<div style="font-weight: 700"></div>',
        `<div style="font-family: 'JetBrains Mono'; font-family: sans-serif; font-weight: 700"></div>`,
        `<div style="font-family: 'JetBrains Mono' !important; font-family: sans-serif; font-weight: 700"></div>`,
        `<div style="font-family: 'JetBrains Mono'; font: 12px; font-weight: 700"></div>`,
    ].join('\n');
    const component = [
        `element.style.font = "700 16px 'JetBrains Mono'";`,
        "styles: [`.a { font-family: 'JetBrains Mono'; } .b { font-weight: 700; }`],",
        "styles: [`.c { font-family: 'JetBrains Mono'; font-weight: 600; }`],",
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.html', template), [
        '2 font-weight: 700',
        '5 font-weight: 700',
        '6 font-weight: 700',
        '1 font: 700',
    ]);
    assert.deepEqual(
        offScale('apps/web/src/a.component.ts', component).sort(),
        ['1 .style.font: 700', '3 font-weight: 600']
    );
});

test('reads Angular style bindings as code', () => {
    const template = [
        '<div [ngStyle]="{ fontWeight: viewportWidth >= 768 ? 700 : 600 }"></div>',
        `<div [ngStyle]="{ 'font-weight': wide ? 650 : 400 }"></div>`,
        `<div [style]="'font-weight: 750'"></div>`,
        '<p style="font-weight: 650">text</p>',
        `<div [ngStyle]='{ "font-weight": w >= 768 ? 700 : 600 }'></div>`,
        // A string in a binding is CSS, so `/200` is a line-height.
        '<div [style]="`font: italic 12px/200 Roboto`"></div>',
        `<div [style]='"font: italic 12px/200 Roboto"'></div>`,
    ].join('\n');
    const component =
        'template: `<div [ngStyle]="{ fontWeight: w >= 768 ? 700 : 600 }"></div>`,';

    assert.deepEqual(offScale('apps/web/src/a.component.html', template), [
        '2 font-weight: 650',
        '3 font-weight: 750',
        '4 font-weight: 650',
    ]);
    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), []);
});

test('reads a feature query test as a condition, not a declaration', () => {
    const source = [
        '@supports (font-weight: 650) { .x { font-weight: 600; } }',
        '@supports (min-width: #{10}px) and (font-weight: 650) { .v { font-weight: 600; } }',
        '@supports (font: 650 1px x) { .y { font: 600 12px x; } }',
        '@container style(--w: 650) { .z { font-weight: var(--w); } }',
        '@mixin m($title-weight: 400) { font-weight: $title-weight; }',
        '.w { @include m($title-weight: 650); }',
    ].join('\n');

    assert.deepEqual(offScale('libs/q3/a.scss', source), [
        '6 $title-weight: 650',
    ]);
});

test('reads an interpolated name every way it can compose', () => {
    assert.deepEqual(
        offScale(
            'libs/q3/c.scss',
            '$prop: font; @if $dark { $prop: font-weight; } .x { #{$prop}: 750; }'
        ),
        ['1 #{$prop}: 750']
    );
});

test('checks property names Sass builds by interpolation', () => {
    const source = [
        '$prop: font-weight;',
        '.z { #{$prop}: 650; }',
        '.x { font-#{weight}: 650; }',
        '.y { #{"font-weight"}: 750; }',
        '.w { margin-#{left}: 650px; }',
        '.v { font-#{$elsewhere}: 650; }',
        '.u { font-#{weight}: 600; }',
        // Another module's variable is not guessed; a literal `…weight`
        // tail is checked as written, once.
        '.t { font#{$elsewhere}: 650 12px x; }',
        '.s { #{$elsewhere}-weight: 650; }',
        '$pre: title; .r { #{$pre}-weight: 650; }',
        // A variable is read as it stands where the name is built.
        '$p: font-weight; .a { #{$p}: 650; } $p: margin-left;',
        '$q: margin-left; .b { #{$q}: 650; } $q: font-weight;',
        '$r: font-weight; .c { $r: color; } .d { #{$r}: 650; }',
    ].join('\n');

    assert.deepEqual(offScale('libs/q3/b.scss', source).sort(), [
        '10 -weight: 650',
        '11 #{$p}: 650',
        '13 #{$r}: 650',
        '2 #{$prop}: 650',
        '3 font-#{weight}: 650',
        '4 #{"font-weight"}: 750',
        '9 -weight: 650',
    ]);
});

test('follows Sass loop variables', () => {
    const source = [
        '@each $w in 400, 650 { .x-#{$w} { font-weight: $w; } }',
        '@each $w in 400, 600 { .y-#{$w} { font-weight: $w; } }',
        '@each $n, $w in (light: 400, heavy: 650) { .t-#{$n} { font-weight: $w; } }',
        '$weights: 400, 750;',
        '@each $w in $weights { .u-#{$w} { font-weight: $w; } }',
        '@for $w from 400 through 402 { .z-#{$w} { font-weight: $w; } }',
        '@for $w from 600 through 600 { .s { font-weight: $w; } }',
        '@for $i from 1 through 3 { .m-#{$i} { margin: $i * 4px; } }',
        '@for $w from 650 through 650 { .r { font-weight: $w; } }',
        // Inside its loop the variable shadows an outer one; after it, the
        // outer one is back.
        '$o: 650; @each $o in 400, 600 { .i { font-weight: $o; } }',
        '$v: 600; @each $v in 650 { .in { color: red; } } .after { font-weight: $v; }',
        '$p: margin; @each $p in font-weight, color { .l { #{$p}: 650; } }',
        '$q: margin; @each $q in font-weight { .in { color: red; } } .w { #{$q}: 650; }',
        // Destructuring: a map's keys and values, a list's positions.
        '@each $name, $w in (650: 400, 750: 600) { .k-#{$name} { font-weight: $w; } }',
        '@each $a, $w in (x 400, y 650) { .p { font-weight: $w; } }',
        '@each $prop, $value in (font-weight: 750, color: red) { .q { #{$prop}: $value; } }',
        '@each $key, $w in ((a b): 400, (c d): 650) { .pk { font-weight: $w; } }',
        '@each $k, $w in ((x: 650): 400, (y: 1): 600) { .nk { font-weight: $w; } }',
        // `to` stops before its end, so this loop never runs.
        '@for $w from 650 to 650 { .e { font-weight: $w; } }',
        // A space-separated list is one variable's list too.
        '@each $w in 400 650 600 { .s { font-weight: $w; } }',
        // A quoted element is one, its spaces, commas and colons included.
        '@each $label, $w in ("wide label" 650,) { .ql { font-weight: $w; } }',
        '@each $label, $w in ("a, b" 600, "c" 750) { .qc { font-weight: $w; } }',
        '@each $k, $w in ("a: b": 650, c: 600) { .qk { font-weight: $w; } }',
        '@each $l, $w in ("a\\", b" 600, "c" 750) { .qe { font-weight: $w; } }',
    ].join('\n');

    assert.deepEqual(offScale('libs/l3/a.scss', source).sort(), [
        '1 $w: 650',
        '12 #{$p}: 650',
        '15 $w: 650',
        '16 $value: 750',
        '16 font-weight: 750',
        '17 $w: 650',
        '20 $w: 650',
        '21 $w: 650',
        '22 $w: 750',
        '23 $w: 650',
        '24 $w: 750',
        '3 $w: 650',
        '4 $weights: 750',
        '6 $w: from 400 through 402',
        '9 $w: from 650 through 650',
    ]);
});

test('treats comment markers inside strings as text', () => {
    const stylesheet = [
        '.x { content: "//"; font-weight: 650; }',
        '.y { background: url(//cdn.test/a.png); font-weight: 750; }',
        '.z::after { content: "font-weight: 650"; }',
    ].join('\n');
    const component = `styles: ['.x { content: "//"; font-weight: 650; }'],`;

    assert.deepEqual(offScale('libs/a.scss', stylesheet), [
        '1 font-weight: 650',
        '2 font-weight: 750',
    ]);
    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '1 font-weight: 650',
    ]);
});

test('keeps a quoted family inside the font shorthand', () => {
    const stylesheet = ".a { font: 650 12px 'DM Sans', sans-serif; }";
    const component = `styles: ['.a { font: 650 12px "DM Sans"; }'],`;
    const template = [
        "<p>Don't wrap</p>",
        '<p style="font: 750 12px \'DM Sans\'">x</p>',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', stylesheet), ['1 font: 650']);
    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '1 font: 650',
    ]);
    assert.deepEqual(offScale('apps/web/src/a.component.html', template), [
        '2 font: 750',
    ]);
});

test('reads only the tokens before the shorthand size as its weight', () => {
    const valid = [
        '.a { font: 400 16px/1.5 "DM Sans"; }',
        '.b { font: 400 16px/1.5 Helvetica Neue; }',
        ".c { font: italic 600 1rem/1.25 'Open Sans', sans-serif; }",
        '.d { font: 500 small/1.4 Inter; }',
        '.e { font: 700 calc(1rem + 2px)/1.2 Inter; }',
        '.f { font: 600 16px / 1.5 Helvetica Neue; }',
    ].join('\n');
    const heavy = [
        '.a { font: 650 16px/1.5 "DM Sans"; }',
        '.b { font: small-caps 750 12px Helvetica Neue; }',
        '.c { font: 520 var(--size) / 1.5 "DM Sans"; }',
    ].join('\n');

    // Split at its space, the family would pass the size as a weight.
    const zeroSize = ':root { --size: 0; } .z { font: var(--size) "DM Sans"; }';

    assert.deepEqual(offScale('libs/a.scss', valid), []);
    assert.deepEqual(offScale('libs/z.scss', zeroSize), []);
    assert.deepEqual(offScale('libs/b.scss', heavy), [
        '1 font: 650',
        '2 font: 750',
        '3 font: 520',
    ]);
});

test('follows a shorthand that is one variable, fallback included', () => {
    const source = [
        ':root { --body-font: 650 1rem sans-serif; }',
        '$heading-font: 750 1.2rem sans-serif;',
        '.a { font: var(--body-font); }',
        '.b { font: var(--caption-font, 520 0.8rem sans-serif); }',
        '.c { font: $heading-font; }',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), [
        '4 font: 520',
        '2 $heading-font: 750',
        '1 --body-font: 650',
    ]);
});

test('matches CSS names, keywords and functions in any case', () => {
    const source = [
        '.a { font-weight: BOLDER; }',
        '.b { font: LiGhTeR 1rem sans-serif; }',
        '.c { FONT-WEIGHT: 650; }',
        ':root { --title: 750; }',
        '.d { font-weight: VAR(--title); }',
        '.e { FONT: 650 12px sans-serif; }',
        '.f { FONT: 400 16px/1.5 Inter; }',
    ].join('\n');
    const findings = findOffScaleWeights('libs/a.scss', source).findings;

    assert.deepEqual(
        findings.map(({ line, name, value }) => `${line} ${name}: ${value}`),
        [
            '1 font-weight: BOLDER',
            '3 FONT-WEIGHT: 650',
            '2 font: LiGhTeR',
            '6 FONT: 650',
            '4 --title: 750',
        ]
    );
    assert.match(describeFinding(findings[0]), /relative to the parent/);
});

test('reads numbers and variables inside interpolation', () => {
    const stylesheet = [
        '$w: 750;',
        '.a { font-weight: #{650}; }',
        '.b { font-weight: #{$w}; }',
        '.c { font-weight: #{600}; }',
    ].join('\n');
    const component = [
        'styles: [`',
        '    .a { font-weight: ${650}; }',
        '    .b { font-weight: ${700}; }',
        '    .c { font-weight: ${this.weight()}; }',
        '`],',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', stylesheet), [
        '2 font-weight: 650',
        '1 $w: 750',
    ]);
    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '2 font-weight: 650',
    ]);
});

test('reports a computed weight whole, since Sass compiles it', () => {
    const computed = [
        '.a { font-weight: 400 + 500; }',
        '.b { font-weight: 400+200; }',
        '.c { font-weight: $base * 1.5; }',
        '.d { font-weight: math.div(1300, 2); }',
        '.e { font-weight: calc(600 + 50); }',
        '.f { font-weight: map.get($weights, title); }',
        '.g { font-weight: #{400 + 300}; }',
        '.h { font-weight: var(--x, 400 + 300); }',
        '.i { font: 400 + 200 12px sans-serif; }',
        '.j { font-weight: -(-650); }',
        '.k { font-weight: -650; }',
        '.l { font-weight: +(650); }',
    ].join('\n');
    const written = [
        '.a { font-weight: +700; }',
        '.b { font-weight: var(--title-weight, 600); }',
        '.c { font-weight: $font-weight; }',
        '.d { font-weight: 600 !important; }',
        '.e { font-weight: #{$font-weight}; }',
    ].join('\n');
    const findings = findOffScaleWeights('libs/a.scss', computed).findings;

    assert.deepEqual(
        findings.map(({ line, value }) => `${line} ${value}`),
        [
            '1 400 + 500',
            '2 400+200',
            '3 $base * 1.5',
            '4 math.div(1300, 2)',
            '5 calc(600 + 50)',
            '6 map.get($weights, title)',
            '7 #{400 + 300}',
            '8 var(--x, 400 + 300)',
            '10 -(-650)',
            '11 -650',
            '12 +(650)',
            '9 400 + 200',
        ]
    );
    assert.match(describeFinding(findings[0]), /is computed/);
    assert.deepEqual(offScale('libs/b.scss', written), []);
});

test('treats `-` and `_` in Sass names alike, not in custom properties', () => {
    const source = [
        '$heavy_value: 650;',
        '$light-value: 750;',
        ':root { --a_b: 650; }',
        '.x { font-weight: $heavy-value; }',
        '.y { font-weight: $light_value; }',
        '.z { font-weight: var(--a-b); }',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), [
        '2 $light-value: 750',
        '1 $heavy_value: 650',
    ]);
});

test('follows a variable for any stretch of the font shorthand', () => {
    const source = [
        '$a-font: 650 1rem sans-serif;',
        ':root { --b-font: 750 1rem sans-serif; }',
        '$c-font: 520 1rem sans-serif;',
        '$d-weight-and-size: 450 12px;',
        '.a { font: italic $a-font; }',
        '.b { font: italic var(--b-font); }',
        '.c { font: italic #{$c-font}; }',
        '.d { font: italic $d-weight-and-size Inter; }',
    ].join('\n');
    const sizeAndFamily = [
        ':root { --size: 0; }',
        "$family: 'DM Sans';",
        '.e { font: 600 var(--size) $family; }',
        '.f { font: italic 600 var(--size) Helvetica Neue; }',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source).sort(), [
        '1 $a-font: 650',
        '2 --b-font: 750',
        '3 $c-font: 520',
        '4 $d-weight-and-size: 450',
    ]);
    assert.deepEqual(offScale('libs/b.scss', sizeAndFamily), []);
});

test('terminates on cyclic variables', { timeout: 5000 }, () => {
    const source = [
        ':root { --body: var(--body) sans-serif; }',
        '$a: $b 1rem;',
        '$b: $a sans-serif;',
        '.x { font: var(--body); }',
        '.y { font: italic $a Inter; }',
        '.z { font-weight: var(--body); }',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), []);
});

test('reports arithmetic in code weights, not calls or conditions', () => {
    const template = [
        '<p [style.font-weight]="600 + 50">a</p>',
        '<p [style.font-weight]="active() ? 700 : 400">b</p>',
    ].join('\n');
    const component = [
        'element.style.fontWeight = 600 + 50;',
        "element.style.setProperty('font-weight', String(base + 100));",
        'element.style.fontWeight = this.weight();',
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.html', template), [
        '1 [style.font-weight]: 600 + 50',
    ]);
    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '1 .style.fontWeight: 600 + 50',
        "2 setProperty('font-weight': String(base + 100)",
    ]);
});

test('resolves Sass variables within their module scope', () => {
    const scan = (file, source) => scanWeights(file, source);
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );

    // Same name, unrelated files: the spacing value never feeds the weight.
    const own = scan(
        'libs/a/a.scss',
        '$local: 600; .a { font-weight: $local; }'
    );
    const other = scan('libs/b/b.scss', '$local: 650; .b { margin: $local; }');
    assert.deepEqual(report([own, other]), []);

    // A loaded module, through a namespace.
    const tokens = scan('libs/c/_tokens.scss', '$title: 650;');
    const user = scan(
        'libs/c/c.scss',
        "@use './tokens' as t; .c { font-weight: t.$title; }"
    );
    assert.deepEqual(report([tokens, user]), ['libs/c/_tokens.scss:1 650']);

    // A mixin argument passed by the file that loads the mixin.
    const mixin = scan(
        'libs/d/_heading.scss',
        '@mixin heading($w: 500) { font-weight: $w; }'
    );
    const caller = scan(
        'libs/d/d.scss',
        "@use './heading'; .d { @include heading.heading($w: 750); }"
    );
    assert.deepEqual(report([mixin, caller]), ['libs/d/d.scss:1 750']);

    // Two files that only share a partial are not connected.
    const shared = scan('libs/e/_shared.scss', '$gap: 4px;');
    const reader = scan(
        'libs/e/x.scss',
        "@use './shared'; .x { font-weight: $v; }"
    );
    const sibling = scan(
        'libs/e/y.scss',
        "@use './shared'; $v: 650; .y { margin: $v; }"
    );
    assert.deepEqual(report([shared, reader, sibling]), []);
});

test('reads runtime writes to the end of the statement', () => {
    const component = [
        'element.style.fontWeight =',
        '    650;',
        'element.style.fontWeight = 600 +',
        '    50;',
        'element.style.fontWeight = 600',
        '    + 50;',
        'element.style.setProperty(',
        "    'font-weight',",
        '    750',
        ');',
        'element.style.fontWeight += 50;',
        "if (element.style.fontWeight === '650') {}",
        "if (element.style.fontWeight !== '650') {}",
        '[style.font-weight]="25 ** 2"',
        'element.style.fontWeight = 2 ** exponent;',
    ].join('\n');

    assert.deepEqual(
        offScale('apps/web/src/a.component.ts', component).sort(),
        [
            '1 .style.fontWeight: 650',
            '11 .style.fontWeight: += 50',
            '14 [style.font-weight]: 25 ** 2',
            '15 .style.fontWeight: 2 ** exponent',
            '3 .style.fontWeight: 600 +\n    50',
            '5 .style.fontWeight: 600\n    + 50',
            "7 setProperty('font-weight': 750",
        ]
    );
});

test('follows bare Sass loads and forwards', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const tokens = scanWeights('libs/c/_tokens.scss', '$heavy: 650;');
    const user = scanWeights(
        'libs/c/c.scss',
        "@use 'tokens' as t; .c { font-weight: t.$heavy; }"
    );
    const index = scanWeights('libs/s/_index.scss', "@forward 'panel-header';");
    const header = scanWeights('libs/s/_panel-header.scss', '$title: 750;');
    const consumer = scanWeights(
        'libs/x/x.scss',
        "@use '../s' as s; .x { font-weight: s.$title; }"
    );

    assert.deepEqual(report([tokens, user]), ['libs/c/_tokens.scss:1 650']);
    assert.deepEqual(report([index, header, consumer]), [
        'libs/s/_panel-header.scss:1 750',
    ]);
});

test('sees only what a loader passes into a loaded module', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    // `@use` never injects the loader's own variables.
    const heading = scanWeights(
        'libs/h/_heading.scss',
        '.h { font-weight: $local; }'
    );
    const caller = scanWeights(
        'libs/h/h.scss',
        "@use './heading'; $local: 650; .x { margin: $local; }"
    );
    // A `with (…)` configuration does pass one in.
    const config = scanWeights(
        'libs/f/_config.scss',
        '$w: 500 !default; .f { font-weight: $w; }'
    );
    const configured = scanWeights(
        'libs/f/f.scss',
        "@use './config' with ($w: 650);"
    );
    // Legacy `@import` is textual, so the importer's declarations count.
    const part = scanWeights('libs/g/_part.scss', '.g { font-weight: $v; }');
    const importer = scanWeights('libs/g/g.scss', "$v: 750; @import 'part';");
    // An interpolated value is still the configuration.
    const heavy = scanWeights(
        'libs/f/_heavy.scss',
        '$w: 650 !default; .f { font-weight: $w; }'
    );
    const interpolated = (value) =>
        scanWeights('libs/f/i.scss', `@use './heavy' with ($w: #{${value}});`);

    assert.deepEqual(report([heading, caller]), []);
    assert.deepEqual(report([config, configured]), ['libs/f/f.scss:1 650']);
    assert.deepEqual(report([heavy, interpolated(600)]), []);
    assert.deepEqual(report([heavy, interpolated(750)]), [
        'libs/f/i.scss:1 750',
    ]);
    assert.deepEqual(report([part, importer]), ['libs/g/g.scss:1 750']);
});

test('resolves a module member only through its namespace', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const a = scanWeights(
        'libs/n/_a.scss',
        '$heavy: 600; $font: 600 1rem sans-serif;'
    );
    const b = scanWeights(
        'libs/n/_b.scss',
        '$heavy: 650; $font: 750 1rem sans-serif;'
    );
    const uses = (body) =>
        scanWeights('libs/n/n.scss', `@use 'a'; @use 'b'; ${body}`);

    assert.deepEqual(report([a, b, uses('.x { font-weight: a.$heavy; }')]), []);
    assert.deepEqual(report([a, b, uses('.x { font-weight: b.$heavy; }')]), [
        'libs/n/_b.scss:1 650',
    ]);
    assert.deepEqual(report([a, b, uses('.y { font: italic b.$font; }')]), [
        'libs/n/_b.scss:1 750',
    ]);

    const tokens = scanWeights('libs/m/_tokens.scss', '$heavy: 750;');
    const star = scanWeights(
        'libs/m/star.scss',
        "@use 'tokens' as *; .x { font-weight: $heavy; }"
    );
    // A namespaced `@use` adds nothing unqualified (Sass would not compile).
    const plain = scanWeights(
        'libs/m/plain.scss',
        "@use 'tokens'; .x { font-weight: $heavy; }"
    );
    assert.deepEqual(report([tokens, star]), ['libs/m/_tokens.scss:1 750']);
    assert.deepEqual(report([tokens, plain]), []);
});

test('checks font-weight presentation attributes', () => {
    const template = [
        '<svg><text font-weight="650">a</text></svg>',
        "<svg><text font-weight='600'>b</text></svg>",
        '<svg><text [attr.font-weight]="600 + 50">c</text></svg>',
        '<p [style.font-weight]="650">d</p>',
        '<svg><text font-weight=750>e</text></svg>',
        '<svg><text font-weight=600>f</text></svg>',
        '<p>font-weight=750 and font-weight="650" as text</p>',
        '<svg><text aria-label="1 > 0" font-weight="520">g</text></svg>',
        '<p title="font-weight=650">a &lt; b</p><p>a < b font-weight=650</p>',
    ].join('\n');
    const component = [
        `template: '<svg><text font-weight="750">x</text></svg>',`,
        'template: "<svg><text aria-label=\\"x > y\\" font-weight=\\"450\\">"',
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.html', template), [
        '1 font-weight: 650',
        '5 font-weight: 750',
        '8 font-weight: 520',
        '3 [attr.font-weight]: 600 + 50',
        '4 [style.font-weight]: 650',
    ]);
    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '1 font-weight: 750',
        '2 font-weight: 450',
    ]);
    // Server-side artwork in system Arial is not app UI.
    assert.equal(
        isScannedFile(
            'apps/xtream-mock-server/src/app/generators/marketing.generator.ts'
        ),
        false
    );
    assert.equal(
        isScannedFile(
            'libs/shared/marketing-fixtures/src/lib/marketing-live-fixtures.ts'
        ),
        false
    );
});

test('counts a `with (…)` configuration of a namespaced module', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const tokens = scanWeights(
        'libs/w/_tokens.scss',
        '$heavy: 500 !default; $heavy-x: 500 !default;'
    );
    // Sass names match across `-`/`_`, configuration included.
    const aliased = scanWeights(
        'libs/w/k.scss',
        [
            "@use './tokens' with ($heavy_x: 750);",
            '.k { font-weight: tokens.$heavy-x; }',
        ].join('\n')
    );
    const configured = scanWeights(
        'libs/w/w.scss',
        [
            "@use './tokens' with ($heavy: 650);",
            '.x { font-weight: tokens.$heavy; }',
        ].join('\n')
    );
    // A mixin argument of the same name is not a configuration.
    const unrelated = scanWeights(
        'libs/w/u.scss',
        [
            "@use './tokens';",
            '.x { @include m($heavy: 650); font-weight: tokens.$heavy; }',
        ].join('\n')
    );
    // Configured through a forwarding module.
    const index = scanWeights(
        'libs/v/_index.scss',
        "@forward 'tokens' with ($light: 450 !default);"
    );
    const forwarded = scanWeights(
        'libs/v/_tokens.scss',
        '$light: 400 !default;'
    );
    const user = scanWeights(
        'libs/v/v.scss',
        "@use '.' as v; .y { font-weight: v.$light; }"
    );

    assert.deepEqual(report([tokens, configured]), ['libs/w/w.scss:1 650']);
    assert.deepEqual(report([tokens, unrelated]), []);
    assert.deepEqual(report([tokens, aliased]), ['libs/w/k.scss:1 750']);
    assert.deepEqual(report([index, forwarded, user]), [
        'libs/v/_index.scss:1 450',
    ]);
});

test('follows custom properties set from code', () => {
    const component = [
        "host: { '[style.--title-weight]': '650' },",
        "element.style.setProperty('--card-weight', '750');",
        "element.style.setProperty('--body-font', '520 1rem sans-serif');",
        '<p [style.--title]="active() ? 450 : 400"></p>',
        "element.style.setProperty('--gap', '12');",
        // A string is CSS text: the family's number is not a weight.
        "element.style.setProperty('--quiet-font', '600 1rem \"Font 900\"');",
    ].join('\n');
    const stylesheet = [
        '.a { font-weight: var(--title); }',
        '.b { font: var(--body-font); }',
        '.c { font: var(--quiet-font); }',
    ].join('\n');
    const scans = [
        scanWeights('apps/web/src/a.component.ts', component),
        scanWeights('libs/a.scss', stylesheet),
    ];

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '1 [style.--title-weight]: 650',
        "2 setProperty('--card-weight': 750",
    ]);
    assert.deepEqual(
        findIndirectWeights(scans)
            .map(({ file, line, value }) => `${file}:${line} ${value}`)
            .sort(),
        [
            'apps/web/src/a.component.ts:3 520',
            'apps/web/src/a.component.ts:4 450',
        ]
    );
});

test('reports signed and unary arithmetic in code weights', () => {
    const component = [
        'element.style.fontWeight = 600 - -50;',
        '[style.font-weight]="600 - -50"',
        'element.style.fontWeight = -(-650);',
        'element.style.fontWeight = active ? -650 : 400;',
        'element.style.fontWeight = +700;',
        'element.style.fontWeight = 600 + -offset;',
        'element.style.fontWeight = 600 + +50;',
        'element.style.fontWeight = offset + +600;',
    ].join('\n');

    assert.deepEqual(
        offScale('apps/web/src/a.component.ts', component).sort(),
        [
            '1 .style.fontWeight: 600 - -50',
            '2 [style.font-weight]: 600 - -50',
            '3 .style.fontWeight: -(-650)',
            '4 .style.fontWeight: -650',
            '6 .style.fontWeight: 600 + -offset',
            '7 .style.fontWeight: 600 + +50',
            '8 .style.fontWeight: offset + +600',
        ]
    );
});

test('reads non-decimal JavaScript numbers as the weight they make', () => {
    const component = [
        'element.style.fontWeight = 0x28a;',
        "renderer.setStyle(el, 'font-weight', 0o1212);",
        'element.style.fontWeight = 0b1010001010;',
        'element.style.fontWeight = 6_50;',
        'element.style.fontWeight = 650n;',
        'element.style.fontWeight = wide ? 0X28A : 400;',
        'element.style.fontWeight = 0x258 + 50;',
        'element.style.fontWeight = 0x258;',
        'element.style.fontWeight = 6_00;',
    ].join('\n');

    assert.deepEqual(
        offScale('apps/web/src/a.component.ts', component).sort(),
        [
            '1 .style.fontWeight: 650',
            "2 setStyle(el,'font-weight': 650",
            '3 .style.fontWeight: 650',
            '4 .style.fontWeight: 650',
            '5 .style.fontWeight: 650',
            '6 .style.fontWeight: 650',
            '7 .style.fontWeight: 600 + 50',
        ]
    );
});

test('reads only the values a code weight can take', () => {
    const component = [
        'element.style.fontWeight = viewportWidth >= 768 ? 700 : 600;',
        '[style.font-weight]="wide && width > 1024 ? 700 : 600"',
        'element.style.fontWeight = compact ? 600 : wide ? 650 : 700;',
        'element.style.fontWeight = (width >= 768 ? 750 : 600);',
        'element.style.fontWeight = item?.weight ?? 650;',
        'element.style.fontWeight = ready && 650;',
        'element.style.fontWeight = width > 1024;',
        'element.style.fontWeight = wide ? 600 + 50 : 600;',
        "element.style.fontWeight = wide ? '650' : '600';",
        'element.style.fontWeight = 1300 >> 1;',
        'element.style.fontWeight = (width > 1024 && 650) || 700;',
        'element.style.fontWeight = a ? w > 768 ? 650 : 700 : 600;',
        'element.style.fontWeight = item?.width > 768 ? 650 : 600;',
        'element.style.fontWeight = flags & 1024 ? custom ?? 600 : 700;',
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '3 .style.fontWeight: 650',
        '4 .style.fontWeight: 750',
        '5 .style.fontWeight: 650',
        '6 .style.fontWeight: 650',
        '8 .style.fontWeight: 600 + 50',
        '9 .style.fontWeight: 650',
        '10 .style.fontWeight: 1300',
        '11 .style.fontWeight: 650',
        '12 .style.fontWeight: 650',
        '13 .style.fontWeight: 650',
    ]);
});

test('checks setProperty with a template-literal name', () => {
    const component = [
        "element.style.setProperty(`font-weight`, '650');",
        "element.style.setProperty(`--title-weight`, '750');",
        "element.style.setProperty(`font-weight`, '600');",
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '1 setProperty(`font-weight`: 650',
        '2 setProperty(`--title-weight`: 750',
    ]);
});

test('checks indexed style writes', () => {
    const component = [
        "element.style['fontWeight'] = 650;",
        'element.style["font-weight"] = 750;',
        'element.style[`fontWeight`] += 50;',
        "if (element.style['fontWeight'] === 650) {}",
        "element.style['fontWeight'] = 600;",
        "element.style.fontWeight ||= '650';",
        "element.style['fontWeight'] ??= 750;",
        "element.style.fontWeight &&= '600';",
        "element.style.font = '650 16px sans-serif';",
        "element.style['font'] = '600 12px x';",
        "element.style.fontFamily = 'x 650';",
        "element.style.font = 'italic 12px/200 x';",
        'element.style.font = `600 ${size}px/200 Roboto`;',
        'element.style.font = `650 ${size}px Roboto`;',
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        "1 .style['fontWeight']: 650",
        '2 .style["font-weight"]: 750',
        '3 .style[`fontWeight`]: += 50',
        '6 .style.fontWeight: 650',
        "7 .style['fontWeight']: 750",
        '9 .style.font: 650',
        '14 .style.font: 650',
    ]);
});

test('checks HostBinding style weights', () => {
    const component = [
        "@HostBinding('style.fontWeight') weight = 650;",
        '@HostBinding("style.font-weight") get heavy(): number { return this.on ? 700 : 750; }',
        "@HostBinding('style.fontWeight') readonly ok = 600;",
        "@HostBinding('attr.font-weight') svg = '650';",
        "@HostBinding('class.bold') bold = 650;",
        "@HostBinding('attr.--title-weight') odd = '650';",
        "@HostBinding('style.fontWeight') get branchy() { if (this.on) { return 600; } return 650; }",
        "@HostBinding('style.fontWeight') get quoted() { const s = 'return 650'; return 600; }",
        "@HostBinding('style.fontWeight') get nested() { const f = () => { return 900; }; return 600; }",
        "@HostBinding('style.fontWeight') get named() { function pick() { return 900; } return 600; }",
        "@HostBinding('style.font') f = '650 12px x';",
        "@HostBinding('style.fontWeight') get inIf() { if (this.on) { return 750; } return 600; }",
        "@HostBinding('style.fontWeight') get typed() { function pick(): number { return 900; } return 600; }",
        "@HostBinding('style.fontWeight') get shaped() { function pick(): { w: number } { return { w: 900 }; } return 600; }",
        "@HostBinding('style.fontWeight') get later() { function pick(): Promise<{ w: number }> { return null; } return 650; }",
        "@HostBinding('style.fontWeight') get arrowType() { function pick(): () => number { return () => 900; } return 600; }",
        "@HostBinding('style.fontWeight') get bare() { const t = a ? f(b) : c; { return 750; } return 600; }",
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        "1 @HostBinding('style.fontWeight'): 650",
        '2 @HostBinding("style.font-weight"): 750',
        "4 @HostBinding('attr.font-weight'): 650",
        "7 @HostBinding('style.fontWeight'): 650",
        "11 @HostBinding('style.font'): 650",
        "12 @HostBinding('style.fontWeight'): 750",
        "15 @HostBinding('style.fontWeight'): 650",
        "17 @HostBinding('style.fontWeight'): 750",
    ]);
});

test('checks Renderer2 setStyle weights', () => {
    const component = [
        "this.renderer.setStyle(this.host.nativeElement, 'fontWeight', 650);",
        "renderer.setStyle(el(), 'font-weight', '750', RendererStyleFlags2.DashCase);",
        "renderer.setStyle(el, 'fontWeight', 600);",
        "renderer.setStyle(el, 'color', '650');",
        "renderer.setStyle(wrap(getEl(a, b)), 'fontWeight', 650);",
        "node.setAttributeNS(ns(), 'font-weight', '650');",
        'renderer.setStyle(el, `font-${kind}`, 650);',
        "node.setAttribute('--title-weight', '650');",
        "node.setAttributeNS('http://www.w3.org/2000/svg', 'font-weight', '650');",
        "renderer.setStyle(el, 'font', '650 16px sans-serif');",
        "el.style.setProperty('font', 'italic 12px/200 x');",
        '[style.font]="\'650 12px x\'"',
        "el.style.setProperty('font', '750 12px x');",
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '12 [style.font]: 650',
        "1 setStyle(this.host.nativeElement,'fontWeight': 650",
        "2 setStyle(el(),'font-weight': 750",
        "5 setStyle(wrap(getEl(a,b)),'fontWeight': 650",
        "6 setAttributeNS(ns(),'font-weight': 650",
        "9 setAttributeNS('http://www.w3.org/2000/svg','font-weight': 650",
        "10 setStyle(el,'font': 650",
        "13 setProperty('font': 750",
    ]);
});

test('checks font-weight attributes set at runtime', () => {
    const component = [
        "node.setAttribute('font-weight', '650');",
        'node.setAttributeNS(null, "font-weight", 750);',
        "node.setAttribute('font-weight', '600');",
        "node.setAttribute('aria-label', '650');",
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        "1 setAttribute('font-weight': 650",
        '2 setAttributeNS(null,"font-weight": 750',
    ]);
});

test('counts only the configuration of the `@use` a member comes from', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const a = scanWeights(
        'libs/q/_alpha-palette.scss',
        '$heavy: 500 !default;'
    );
    const b = scanWeights('libs/q/_beta-palette.scss', '$heavy: 500 !default;');
    const user = (reference) =>
        scanWeights(
            'libs/q/q.scss',
            [
                "/* Two palettes */ @use 'alpha-palette' as a with ($heavy: 600);",
                "@use 'beta-palette' as b with ($heavy: 650); // heavy",
                `.x { @include m($heavy: 750); font-weight: ${reference}; }`,
            ].join('\n')
        );

    assert.deepEqual(report([a, b, user('a.$heavy')]), []);
    assert.deepEqual(report([a, b, user('b.$heavy')]), ['libs/q/q.scss:2 650']);
    // An earlier `@use`'s configuration does not configure a later one.
    const reversed = scanWeights(
        'libs/q/r.scss',
        "@use 'alpha-palette' as a with ($heavy: 650); @use 'beta-palette' as b with ($heavy: 600); .x { font-weight: b.$heavy; }"
    );
    assert.deepEqual(report([a, b, reversed]), []);
});

test('resolves Sass variables within their block', () => {
    const local = [
        '.spacing { $local: 650; margin: $local; }',
        '.title { $local: 600; font-weight: $local; }',
    ].join('\n');
    const nested = '.a { $w: 650; .b { font-weight: $w; } }';
    const global = '.a { $w: 750 !global; } .b { font-weight: $w; }';
    const argument = [
        '@mixin heading($w: 500) { font-weight: $w; }',
        '.x { @include heading($w: 650); }',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', local), []);
    // Each block resolves its own `$w`, whichever is checked first.
    const twoBlocks = [
        '.b { $w: 650; font-weight: $w; }',
        '.a { $w: 600; font-weight: $w; }',
    ].join('\n');
    assert.deepEqual(offScale('libs/f.scss', twoBlocks), ['1 $w: 650']);
    assert.deepEqual(offScale('libs/b.scss', nested), ['1 $w: 650']);
    assert.deepEqual(offScale('libs/c.scss', global), ['1 $w: 750']);
    assert.deepEqual(offScale('libs/d.scss', argument), ['2 $w: 650']);
    // A chain continues from where the intermediate variable is defined.
    const chain =
        '.a { $base: 650; $w: $base !global; } .b { font-weight: $w; }';
    assert.deepEqual(offScale('libs/e.scss', chain), ['1 $base: 650']);

    // A block-local declaration is not a module member.
    const tokens = scanWeights(
        'libs/t/_tokens.scss',
        '.x { $heavy: 650; margin: 0; padding: 0; color: red; }'
    );
    const user = scanWeights(
        'libs/t/t.scss',
        "@use 'tokens' as t; .y { font-weight: t.$heavy; }"
    );
    assert.deepEqual(findIndirectWeights([tokens, user]), []);
});

test('runs a `!global` assignment in text order', () => {
    const read = '.x { font-weight: $w; }';

    for (const setter of [
        '.setter { $w: 600 !global; }',
        '.a { .b { $w: 600 !global; } }',
    ]) {
        assert.deepEqual(
            offScale('libs/g4/a.scss', `$w: 650; ${setter} ${read}`),
            []
        );
    }
    // Under flow control or in a mixin body it may not run first.
    for (const setter of [
        '@if $flag { .s { $w: 600 !global; } }',
        '@mixin set { $w: 600 !global; }',
    ]) {
        assert.deepEqual(
            offScale('libs/g4/a.scss', `$w: 650; ${setter} ${read}`),
            ['1 $w: 650']
        );
    }
    assert.deepEqual(
        offScale('libs/g4/a.scss', `.y { $w: 650 !global; } ${read}`),
        ['1 $w: 650']
    );
});

test('resolves the declaration in effect where a Sass name is read', () => {
    const cases = {
        // An inner declaration shadows the outer one.
        shadowed: '$local: 650; .title { $local: 600; font-weight: $local; }',
        // A reassignment after the reference does not reach it.
        later: '.t { $w: 600; font-weight: $w; $w: 650; }',
        // The last unconditional assignment wins.
        reassigned: '$w: 650; $w: 600; .a { font-weight: $w; }',
        heavier: '$w: 600; $w: 650; .a { font-weight: $w; }',
        // Flow control assigns the enclosing variable, conditionally.
        ifBlock: '.r { $w: 600; @if $c { $w: 650; } font-weight: $w; }',
        // A conditional assignment does not hide the value before it.
        ifKeepsOuter: '.r { $w: 650; @if $c { $w: 600; } font-weight: $w; }',
        elseBlock:
            '.r { $w: 600; @if $c { $w: 500; } @else { $w: 750; } font-weight: $w; }',
        eachBlock:
            '.r { $w: 600; @each $i in 1, 2 { $w: 700; } font-weight: $w; }',
        topLevelIf: '$w: 600; @if $dark { $w: 520; } .a { font-weight: $w; }',
        // A mixin body reads module variables when it is included.
        mixin: '@mixin m { font-weight: $w; } $w: 650; .x { @include m; }',
        mixinLocal: '@mixin m { $w: 600; font-weight: $w; } $w: 650;',
    };
    const found = Object.fromEntries(
        Object.entries(cases).map(([name, source]) => [
            name,
            offScale(`libs/${name}.scss`, source),
        ])
    );

    assert.deepEqual(found, {
        shadowed: [],
        later: [],
        reassigned: [],
        heavier: ['1 $w: 650'],
        ifBlock: ['1 $w: 650'],
        ifKeepsOuter: ['1 $w: 650'],
        elseBlock: ['1 $w: 750'],
        eachBlock: [],
        topLevelIf: ['1 $w: 520'],
        mixin: ['1 $w: 650'],
        mixinLocal: [],
    });

    // A file whose own declaration settles the value ignores an importer's.
    const part = scanWeights(
        'libs/p/_part.scss',
        '$v: 600; .g { font-weight: $v; }'
    );
    const importer = scanWeights('libs/p/p.scss', "$v: 750; @import 'part';");
    assert.deepEqual(findIndirectWeights([part, importer]), []);
});

test('passes an argument only to the callable it is given to', () => {
    const part = scanWeights(
        'libs/k/_part.scss',
        '@mixin heading($w: 500) { font-weight: $w; }'
    );
    const loader = scanWeights(
        'libs/k/k.scss',
        "@use 'part'; .x { @include unrelated($w: 650); @include part.heading; }"
    );
    const passing = scanWeights(
        'libs/k/p.scss',
        "@use 'part'; .x { @include part.heading($w: 750); }"
    );
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );

    assert.deepEqual(report([part, loader]), []);
    assert.deepEqual(report([part, passing]), ['libs/k/p.scss:1 750']);

    const sameFile = [
        '@mixin heading($w: 500) { font-weight: $w; }',
        '.x { @include other($w: 650); @include heading; }',
        '.y { @include other($v: 650); } $v: 600; .z { font-weight: $v; }',
    ].join('\n');
    assert.deepEqual(offScale('libs/same.scss', sameFile), []);
});

test('places imported declarations where the @import sits', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const part = scanWeights('libs/i/_part.scss', '$v: 950;');
    const after = scanWeights(
        'libs/i/after.scss',
        "$v: 600; @import 'part'; .a { font-weight: $v; }"
    );
    const before = scanWeights(
        'libs/i/before.scss',
        "@import 'part'; $v: 600; .a { font-weight: $v; }"
    );

    assert.deepEqual(report([part, after]), ['libs/i/_part.scss:1 950']);
    assert.deepEqual(report([part, before]), []);

    // A nested import takes effect where the outer `@import` sits.
    const outer = scanWeights('libs/j/_outer.scss', "@import 'inner';");
    const inner = scanWeights('libs/j/_inner.scss', '$v: 950;');
    const main = scanWeights(
        'libs/j/main.scss',
        "/* main */ $v: 600; @import 'outer'; .a { font-weight: $v; }"
    );
    assert.deepEqual(report([outer, inner, main]), [
        'libs/j/_inner.scss:1 950',
    ]);
});

test('reads module variables where a mixin is called', () => {
    // No caller in the file: the module's final value is what callers see.
    const superseded = '$w: 650; $w: 600; @mixin m { font-weight: $w; }';
    // A call between the two assignments reads the first one.
    const calledEarly = [
        '$w: 650; .x { @include m; } $w: 600;',
        '@mixin m { font-weight: $w; }',
    ].join('\n');

    // Callers elsewhere see the module's final value.
    const noCaller = '$w: 650; @mixin m { font-weight: $w; }';
    // A mixin's own signature is not a call.
    const signature = '$w: 650; @mixin m($x: 1) { font-weight: $w; } $w: 600;';

    assert.deepEqual(offScale('libs/m/superseded.scss', superseded), []);
    assert.deepEqual(offScale('libs/m/no-caller.scss', noCaller), [
        '1 $w: 650',
    ]);
    assert.deepEqual(offScale('libs/m/signature.scss', signature), []);
    assert.deepEqual(offScale('libs/m/early.scss', calledEarly), ['1 $w: 650']);
});

test('lets `!default` keep an earlier value', () => {
    const cases = {
        kept: '$heavy: 650; $heavy: 600 !default; .x { font-weight: $heavy; }',
        unset: '$heavy: 600 !default; .x { font-weight: $heavy; }',
        alone: '$heavy: 650 !default; .x { font-weight: $heavy; }',
        // A mixin included after both assignments reads the final value.
        included:
            '$w: 650; $w: 600; @mixin heading { font-weight: $w; } .title { @include heading; }',
        // A `!default` after a set value never applies, in any scope.
        ignored: '$w: 600; $w: 650 !default; .x { font-weight: $w; }',
        // `null` counts as unset, so a later `!default` applies.
        afterNull: '$w: null; $w: 650 !default; .x { font-weight: $w; }',
        resetToNull:
            '$w: 600; $w: null; $w: 650 !default; .x { font-weight: $w; }',
        innerIgnored: '$w: 600; .x { $w: 650 !default; font-weight: $w; }',
    };
    const found = Object.fromEntries(
        Object.entries(cases).map(([name, source]) => [
            name,
            offScale(`libs/d/${name}.scss`, source),
        ])
    );

    assert.deepEqual(found, {
        kept: ['1 $heavy: 650'],
        unset: [],
        alone: ['1 $heavy: 650'],
        included: [],
        ignored: [],
        innerIgnored: [],
        afterNull: ['1 $w: 650'],
        resetToNull: ['1 $w: 650'],
    });

    // The partial's default yields to the value its importer set first.
    const part = scanWeights(
        'libs/d/_part.scss',
        '$v: 600 !default; .g { font-weight: $v; }'
    );
    const importer = scanWeights(
        'libs/d/importer.scss',
        "$v: 750; @import 'part';"
    );
    assert.deepEqual(
        findIndirectWeights([part, importer]).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        ),
        ['libs/d/importer.scss:1 750']
    );
});

test('passes an argument to the module that owns the callable', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const a = scanWeights(
        'libs/o/_a.scss',
        '@mixin heading($w: 1) { margin: $w; }'
    );
    const b = scanWeights(
        'libs/o/_b.scss',
        '@mixin heading($w: 600) { font-weight: $w; }'
    );
    const loader = (body) => scanWeights('libs/o/o.scss', body);

    assert.deepEqual(
        report([
            a,
            b,
            loader(
                "@use 'a'; @use 'b'; .x { @include a.heading($w: 650); @include b.heading; }"
            ),
        ]),
        []
    );
    assert.deepEqual(
        report([a, b, loader("@use 'b'; .x { @include b.heading($w: 750); }")]),
        ['libs/o/o.scss:1 750']
    );
    assert.deepEqual(
        report([
            a,
            b,
            loader("@use 'b' as *; .x { @include heading($w: 750); }"),
        ]),
        ['libs/o/o.scss:1 750']
    );
    // A bare `heading(` also reaches a mixin in an `@import`ed file.
    assert.deepEqual(
        report([
            a,
            b,
            loader("@import 'b'; .x { @include heading($w: 750); }"),
        ]),
        ['libs/o/o.scss:1 750']
    );
    // A bare `heading(` resolves to `a` (`as *`), not to the namespaced `b`.
    assert.deepEqual(
        report([
            a,
            b,
            loader(
                "@use 'a' as *; @use 'b'; .x { @include heading($w: 650); @include b.heading; }"
            ),
        ]),
        []
    );
});

test('counts the configuration of a module loaded `as *`', () => {
    const tokens = scanWeights('libs/s2/_tokens.scss', '$w: 500 !default;');
    const loader = scanWeights(
        'libs/s2/s.scss',
        "@use 'tokens' as * with ($w: 650); .x { font-weight: $w; }"
    );

    assert.deepEqual(
        findIndirectWeights([tokens, loader]).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        ),
        ['libs/s2/s.scss:1 650']
    );
});

test('runs a partial again at every @import', { timeout: 5000 }, () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const common = scanWeights('libs/r/_common.scss', '$w: 650;');
    const a = scanWeights('libs/r/_a.scss', "@import 'common';");
    const b = scanWeights('libs/r/_b.scss', "@import 'common';");
    const siblings = scanWeights(
        'libs/r/siblings.scss',
        "@import 'a'; $w: 600; @import 'b'; .x { font-weight: $w; }"
    );
    const repeated = scanWeights(
        'libs/r/repeated.scss',
        "@import 'common'; $w: 600; @import 'common'; .x { font-weight: $w; }"
    );
    const x = scanWeights('libs/c2/_x.scss', "@import 'y';");
    const y = scanWeights('libs/c2/_y.scss', "@import 'x'; $w: 600;");
    const cyclic = scanWeights(
        'libs/c2/main.scss',
        "@import 'x'; .x { font-weight: $w; }"
    );

    assert.deepEqual(report([common, a, b, siblings]), [
        'libs/r/_common.scss:1 650',
    ]);
    assert.deepEqual(report([common, repeated]), ['libs/r/_common.scss:1 650']);
    assert.deepEqual(report([x, y, cyclic]), []);

    // Inside an inclusion, assignments keep their text order: the partial's
    // own `$w: 650` comes after its nested import's `$w: 600`.
    const nested = scanWeights('libs/r2/_nested.scss', '$w: 600;');
    const partial = scanWeights(
        'libs/r2/_partial.scss',
        "@import 'nested'; $w: 650;"
    );
    const reordered = scanWeights(
        'libs/r2/main.scss',
        "@import 'partial'; .x { font-weight: $w; }"
    );
    assert.deepEqual(report([nested, partial, reordered]), [
        'libs/r2/_partial.scss:1 650',
    ]);
});

test('runs a call inside a mixin body where that mixin runs', () => {
    const deferred = [
        '$w: 650; @mixin caller { @include m; } $w: 600;',
        '@mixin m { font-weight: $w; } .x { @include caller; }',
    ].join('\n');
    const calledEarly = [
        '$w: 650; @mixin caller { @include m; } .x { @include caller; }',
        '$w: 600; @mixin m { font-weight: $w; }',
    ].join('\n');

    assert.deepEqual(offScale('libs/n2/deferred.scss', deferred), []);
    assert.deepEqual(offScale('libs/n2/early.scss', calledEarly), [
        '1 $w: 650',
    ]);
});

test('follows members forwarded under a prefix', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const base = scanWeights('libs/f2/_base.scss', '$heavy: 650;');
    const bundle = scanWeights(
        'libs/f2/_bundle.scss',
        "@forward 'base' as prefix-*;"
    );
    const outer = scanWeights(
        'libs/f2/_outer.scss',
        "@forward 'bundle' as o-*;"
    );
    const user = (body) => scanWeights('libs/f2/user.scss', body);

    assert.deepEqual(
        report([
            base,
            bundle,
            user("@use 'bundle'; .x { font-weight: bundle.$prefix-heavy; }"),
        ]),
        ['libs/f2/_base.scss:1 650']
    );
    assert.deepEqual(
        report([
            base,
            bundle,
            outer,
            user("@use 'outer'; .x { font-weight: outer.$o-prefix-heavy; }"),
        ]),
        ['libs/f2/_base.scss:1 650']
    );
    // The forward exposes only the prefixed name.
    assert.deepEqual(
        report([
            base,
            bundle,
            user("@use 'bundle'; .x { font-weight: bundle.$heavy; }"),
        ]),
        []
    );
    assert.deepEqual(
        report([
            base,
            bundle,
            user("@use 'bundle' as *; .x { font-weight: $prefix-heavy; }"),
        ]),
        ['libs/f2/_base.scss:1 650']
    );
    // One file brought in under two prefixes reads under either.
    const other = scanWeights(
        'libs/f2/_other.scss',
        "@forward 'base' as other-*;"
    );
    assert.deepEqual(
        report([
            base,
            bundle,
            other,
            user(
                "@use 'bundle' as *; @use 'other' as *; .x { font-weight: $prefix-heavy; }"
            ),
        ]),
        ['libs/f2/_base.scss:1 650']
    );
});

test('renders an imported rule where the @import sits', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const part = scanWeights(
        'libs/g2/_part.scss',
        '$w: 600 !default; .g { font-weight: $w; }'
    );
    const importer = scanWeights('libs/g2/i.scss', "@import 'part'; $w: 650;");
    // A partial's mixin runs when called, after the importer's assignment.
    const mixin = scanWeights(
        'libs/g2/_mix.scss',
        '@mixin m { font-weight: $w; }'
    );
    const caller = scanWeights(
        'libs/g2/c.scss',
        "@import 'mix'; $w: 650; .x { @include m; }"
    );

    assert.deepEqual(report([part, importer]), []);
    assert.deepEqual(report([mixin, caller]), ['libs/g2/c.scss:1 650']);
});

test('skips a module default its configuration replaces', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const tokens = scanWeights('libs/w2/_tokens.scss', '$w: 650 !default;');
    const user = (body) => scanWeights('libs/w2/u.scss', body);

    assert.deepEqual(
        report([
            tokens,
            user(
                "@use 'tokens' with ($w: 600); .x { font-weight: tokens.$w; }"
            ),
        ]),
        []
    );
    assert.deepEqual(
        report([
            tokens,
            user("@use 'tokens' as * with ($w: 600); .x { font-weight: $w; }"),
        ]),
        []
    );
    assert.deepEqual(
        report([tokens, user("@use 'tokens'; .x { font-weight: tokens.$w; }")]),
        ['libs/w2/_tokens.scss:1 650']
    );
    // Another compilation loading it unconfigured does not change what
    // this one reads.
    assert.deepEqual(
        report([
            tokens,
            user(
                "@use 'tokens' with ($w: 600); .x { font-weight: tokens.$w; }"
            ),
            scanWeights('libs/w2/other.scss', "@use 'tokens';"),
        ]),
        []
    );
});

test('reads `-` and `_` in callable names alike', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const own = (body) => report([scanWeights('libs/h2/own.scss', body)]);
    const base = scanWeights(
        'libs/h2/_base.scss',
        '@mixin heading-style($w: 500) { font-weight: $w; }'
    );
    const mod = scanWeights('libs/h2/_mod.scss', "@forward 'base' as p-*;");
    const user = (body) => scanWeights('libs/h2/user.scss', body);

    assert.deepEqual(
        own(
            '@mixin heading_style($w: 500) { font-weight: $w; } .x { @include heading-style($w: 650); }'
        ),
        ['libs/h2/own.scss:1 650']
    );
    // Module variables are read where the mixin is called, by either name.
    for (const [defined, called] of [
        ['a-b', 'a_b'],
        ['a_b', 'a_b'],
    ]) {
        assert.deepEqual(
            own(
                `$w: 650; @mixin ${defined} { font-weight: $w; } .x { @include ${called}; } $w: 500;`
            ),
            ['libs/h2/own.scss:1 650']
        );
    }
    assert.deepEqual(
        report([
            base,
            user("@use 'base'; .x { @include base.heading_style($w: 650); }"),
        ]),
        ['libs/h2/user.scss:1 650']
    );
    assert.deepEqual(
        report([
            base,
            mod,
            user("@use 'mod'; .x { @include mod.p_heading-style($w: 650); }"),
        ]),
        ['libs/h2/user.scss:1 650']
    );
});

test('applies the show and hide lists of a @forward', { timeout: 5000 }, () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const a = scanWeights('libs/k2/_a.scss', '$w: 650;');
    const b = scanWeights('libs/k2/_b.scss', '$w: 600;');
    const mod = (body) => scanWeights('libs/k2/_mod.scss', body);
    const user = (body) => scanWeights('libs/k2/user.scss', body);
    const reads = user("@use 'mod'; .x { font-weight: mod.$w; }");
    const readsPrefixed = user("@use 'mod'; .x { font-weight: mod.$p-w; }");

    assert.deepEqual(
        report([a, b, mod("@forward 'a' hide $w; @forward 'b';"), reads]),
        []
    );
    assert.deepEqual(
        report([a, b, mod("@forward 'a' show $x; @forward 'b';"), reads]),
        []
    );
    assert.deepEqual(
        report([
            a,
            b,
            mod("@forward 'a' show $w; @forward 'b' hide $w;"),
            reads,
        ]),
        ['libs/k2/_a.scss:1 650']
    );
    // The lists name members as the `@forward` exposes them.
    assert.deepEqual(
        report([a, mod("@forward 'a' as p-* hide $p-w;"), readsPrefixed]),
        []
    );
    assert.deepEqual(
        report([a, mod("@forward 'a' as p-* hide $w;"), readsPrefixed]),
        ['libs/k2/_a.scss:1 650']
    );
    // A list further out names the prefixes added below it.
    const inner = scanWeights('libs/k2/_inner.scss', "@forward 'a' as p-*;");
    assert.deepEqual(
        report([
            a,
            inner,
            mod("@forward 'inner' as o-* hide $o-p-w;"),
            user("@use 'mod'; .x { font-weight: mod.$o-p-w; }"),
        ]),
        []
    );
    // A list below a prefix is read under that prefix.
    const hides = scanWeights(
        'libs/k2/_hides.scss',
        "@forward 'a' as p-* hide $p-w;"
    );
    assert.deepEqual(
        report([
            a,
            hides,
            mod("@forward 'hides' as o-*;"),
            user("@use 'mod'; .x { font-weight: mod.$o-p-w; }"),
        ]),
        []
    );
    // Forwarding cycles end, with lists and with prefixes.
    for (const [back, forward, read] of [
        ["@forward 'mod' hide $x;", "@forward 'loop' show $w;", '$w'],
        ["@forward 'mod' as l-*;", "@forward 'loop' as m-*;", '$m-w'],
    ]) {
        const loop = scanWeights('libs/k2/_loop.scss', `${back} @forward 'a';`);
        assert.deepEqual(
            report([
                a,
                loop,
                mod(forward),
                user(`@use 'mod'; .x { font-weight: mod.${read}; }`),
            ]),
            ['libs/k2/_a.scss:1 650']
        );
    }
    // An `@import`ed file brings in what it forwards.
    assert.deepEqual(
        report([
            a,
            mod("@forward 'a' as p-*;"),
            user("@import 'mod'; .x { font-weight: $p-w; }"),
        ]),
        ['libs/k2/_a.scss:1 650']
    );
});

test('reads a prefixed configuration the way Sass names it', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const tokens = scanWeights('libs/q2/_tokens.scss', '$w: 500 !default;');
    const rule = scanWeights(
        'libs/q2/_rule.scss',
        '$w: 500 !default; .r { font-weight: $w; }'
    );
    const mod = (body) => scanWeights('libs/q2/_mod.scss', body);
    const user = (body) => scanWeights('libs/q2/user.scss', body);

    // `with (…)` on a prefixed `@forward` names the member unprefixed.
    assert.deepEqual(
        report([
            tokens,
            mod("@forward 'tokens' as p-* with ($w: 650);"),
            user("@use 'mod'; .x { font-weight: mod.$p-w; }"),
        ]),
        ['libs/q2/_mod.scss:1 650']
    );
    // A loader of the forwarding module configures it under the prefix,
    // even where the `@forward` hides it.
    assert.deepEqual(
        report([
            rule,
            mod("@forward 'rule' as p-*;"),
            user("@use 'mod' with ($p-w: 650);"),
        ]),
        ['libs/q2/user.scss:1 650']
    );
    assert.deepEqual(
        report([
            rule,
            mod("@forward 'rule' as p-* hide $p-w;"),
            user("@use 'mod' with ($p-w: 650);"),
        ]),
        ['libs/q2/user.scss:1 650']
    );
    const outer = scanWeights('libs/q2/_outer.scss', "@forward 'mod' as o-*;");
    assert.deepEqual(
        report([
            rule,
            mod("@forward 'rule' as p-*;"),
            outer,
            user("@use 'outer' with ($o-p-w: 650);"),
        ]),
        ['libs/q2/user.scss:1 650']
    );
    const heavy = scanWeights('libs/q2/_heavy.scss', '$w: 650 !default;');
    assert.deepEqual(
        report([
            heavy,
            mod("@forward 'heavy' as p-*;"),
            user("@use 'mod' with ($p-w: 600); .x { font-weight: mod.$p-w; }"),
        ]),
        []
    );
});

test('keeps a module default that a `null` configuration leaves unset', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const tokens = scanWeights('libs/n2/_tokens.scss', '$w: 650 !default;');
    const user = (body) => scanWeights('libs/n2/u.scss', body);

    assert.deepEqual(
        report([
            tokens,
            user(
                "@use 'tokens' with ($w: null); .x { font-weight: tokens.$w; }"
            ),
        ]),
        ['libs/n2/_tokens.scss:1 650']
    );
    assert.deepEqual(
        report([
            tokens,
            user("@use 'tokens' as * with ($w: null); .x { font-weight: $w; }"),
        ]),
        ['libs/n2/_tokens.scss:1 650']
    );
});

test('counts a parameter default only where a call leaves it out', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const heading = '@mixin heading($w: 650) { font-weight: $w; }';
    const own = (body) =>
        report([scanWeights('libs/d2/own.scss', `${heading} ${body}`)]);

    assert.deepEqual(own('.x { @include heading($w: 600); }'), []);
    assert.deepEqual(
        own(
            '.x { @include heading($w: 600); } .y { content: "@include heading;"; }'
        ),
        []
    );
    for (const omitted of [
        '@include heading;',
        '@include heading();',
        '@include heading { color: red; }',
    ]) {
        assert.deepEqual(
            own(`.x { @include heading($w: 600); } .y { ${omitted} }`),
            ['libs/d2/own.scss:1 650']
        );
    }
    // Nothing calls it here, so it may be called from elsewhere.
    assert.deepEqual(own(''), ['libs/d2/own.scss:1 650']);
    // A comment between `@mixin` and the name is still a signature.
    assert.deepEqual(
        report([
            scanWeights(
                'libs/d2/note.scss',
                '@mixin /* a long note on the heading */ heading($w: 650) { font-weight: $w; } .x { @include heading($w: 600); }'
            ),
        ]),
        []
    );
    assert.deepEqual(
        report([
            scanWeights(
                'libs/d2/note.scss',
                '@mixin /* a long note on the heading */ heading($w: 650) { font-weight: $w; }'
            ),
        ]),
        ['libs/d2/note.scss:1 650']
    );
    assert.deepEqual(
        report([
            scanWeights(
                'libs/d2/note.scss',
                '$w: 650; @mixin /* a long note on the heading */ a-b() { font-weight: $w; } $w: 500; .x { @include a-b; }'
            ),
        ]),
        []
    );
    // A module's call reaches its own mixin, not a loader's namesake.
    const loaded = scanWeights(
        'libs/d2/_loaded.scss',
        '@mixin heading($w: 600) { font-weight: $w; } .x { @include heading($w: 600); }'
    );
    const loader = scanWeights(
        'libs/d2/loader.scss',
        `@use 'loaded'; ${heading}`
    );
    assert.deepEqual(report([loaded, loader]), ['libs/d2/loader.scss:1 650']);

    const a = scanWeights('libs/d2/_a.scss', heading);
    const b = scanWeights(
        'libs/d2/_b.scss',
        '@mixin heading($w: 500) { font-weight: $w; }'
    );
    const mod = scanWeights('libs/d2/_mod.scss', "@forward 'a' as p-*;");
    const user = (body) => scanWeights('libs/d2/user.scss', body);
    // A call that leaves the parameter out of another module's mixin does
    // not use this one's default.
    assert.deepEqual(
        report([
            a,
            b,
            user(
                "@use 'a'; @use 'b'; .x { @include a.heading($w: 600); @include b.heading; }"
            ),
        ]),
        []
    );
    assert.deepEqual(
        report([a, user("@use 'a'; .x { @include a.heading; }")]),
        ['libs/d2/_a.scss:1 650']
    );
    assert.deepEqual(
        report([
            a,
            mod,
            user("@use 'mod'; .x { @include mod.p-heading($w: 600); }"),
        ]),
        []
    );
});

test('caps JetBrains Mono rules at the heaviest bundled Mono face', () => {
    const source = [
        ".a { font-family: 'JetBrains Mono', monospace; font-weight: 700; }",
        '.b { font: 600 12px/1 "JetBrains Mono", monospace; }',
        ".c { font-family: ui-monospace, 'JetBrains Mono'; font-weight: bold; }",
        ".d { font-weight: 500; font-family: 'JetBrains Mono'; }",
        '.e { font-weight: 700; }',
        ".f { font-family: 'JetBrains Mono'; &:hover, .child { font-weight: 600; } }",
        ".g { font-family: 'JetBrains Mono'; &--wide { font-weight: 700; } }",
        ".h { font-family: 'JetBrains Mono'; .x { font-family: Roboto; font-weight: 700; } }",
        ".i { font-family: 'JetBrains Mono'; @media (min-width: 1px) { font-weight: 600; } }",
        "@font-face { font-family: 'JetBrains Mono'; font-weight: 700; }",
        ".j { font-family: 'JetBrains Mono'; font-weight: 650; }",
        ".k { font-family: 'JetBrains Mono'; --title-weight: 600; }",
        ".l { font-family: 'JetBrains Mono'; font-family: Roboto; font-weight: 700; }",
        "@mixin m { font-weight: 700; } .n { font-family: 'JetBrains Mono'; @include m; }",
        ".o { font-family: 'JetBrains Mono'; @include up { font-weight: 700; } }",
        ".p { font-family: 'JetBrains Mono'; @mixin local { font-weight: 700; } }",
        ".q { font-weight: 700; font: 400 12px 'JetBrains Mono'; }",
        ".r { font-weight: 700 !important; font: 400 12px 'JetBrains Mono'; }",
        ".s { font: 400 12px 'JetBrains Mono'; font-weight: 700; }",
        ".t { font-weight: 700; font-weight: 500; font-family: 'JetBrains Mono'; }",
        ".u { font-weight: 700; font: bogus; font-family: 'JetBrains Mono'; }",
        ".v { font-weight: 700; font: 12px; font-family: 'JetBrains Mono'; }",
        ".w { font-weight: 700; font: var(--f); font-family: 'JetBrains Mono'; }",
        ".x2 { font-weight: 700; font: inherit; font-family: 'JetBrains Mono'; }",
        ".y2 { font-weight: 700; font: 12px/1.4 sans-serif; font-family: 'JetBrains Mono'; }",
        ".z2 { font-weight: 700; font: 12px / 1.4; font-family: 'JetBrains Mono'; }",
        ".z3 { font: 700 12px 1.4; font-family: 'JetBrains Mono'; }",
        ".z4 { font-family: 'JetBrains Mono'; font: 12px; font-weight: 700; }",
    ].join('\n');

    assert.equal(MONO_WEIGHT_CAP, 500);
    assert.deepEqual(offScale('libs/m3/a.component.scss', source).sort(), [
        '1 font-weight: 700',
        '11 font-weight: 650',
        // A mixin's weight lands where it is included.
        '14 font-weight: 700',
        '15 font-weight: 700',
        '18 font-weight: 700',
        '19 font-weight: 700',
        '2 font: 600',
        '21 font-weight: 700',
        '22 font-weight: 700',
        '26 font-weight: 700',
        '28 font-weight: 700',
        '3 font-weight: bold',
        '6 font-weight: 600',
        '9 font-weight: 600',
    ]);
    for (const finding of findOffScaleWeights(
        'libs/m3/a.component.scss',
        source
    ).findings) {
        assert.match(describeFinding(finding), /JetBrains Mono.*Use 500\.$/);
    }
});

test('follows the JetBrains Mono family only where it is inherited', () => {
    const mono = "font-family: 'JetBrains Mono'";
    const source = [
        `.a { ${mono}; + .item { font-weight: 700; } }`,
        `.b { ${mono}; & ~ .item { font-weight: 700; } }`,
        `.c { ${mono}; &--wide, &:hover { font-weight: 700; } }`,
        `.d { ${mono}; :is(.x, .y) { font-weight: 700; } }`,
        `.e { ${mono}; .f { font-family: inherit; font-weight: 700; } }`,
        `.g { ${mono}; + .h { font-family: inherit; font-weight: 700; } }`,
        `.i { ${mono}; .u { font-family: Roboto; font-family: unset; font-weight: 700; } }`,
        `.j { ${mono}; .k { font-family: Roboto; font-family: inherit; font-weight: 700; } }`,
        `.l { ${mono}; &--wide:is(.x, .y) { font-weight: 700; } }`,
        `.m { ${mono} !important; font-family: sans-serif; font-weight: 700; }`,
        `.n { font-family: Roboto !important; ${mono}; font-weight: 700; }`,
        `.o { font-family: Roboto !important; ${mono} !important; font-weight: 700; }`,
    ].join('\n');

    assert.deepEqual(offScale('libs/m4/a.scss', source), [
        '3 font-weight: 700',
        '4 font-weight: 700',
        '5 font-weight: 700',
        '7 font-weight: 700',
        '8 font-weight: 700',
        '10 font-weight: 700',
        '12 font-weight: 700',
    ]);
});

test('resolves a JetBrains Mono family named through variables', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const rule = (body) => scanWeights('libs/m4/rule.scss', body);
    const theme = (body) => scanWeights('libs/m4/theme.scss', body);

    assert.deepEqual(
        report([
            theme(
                ':root { --face: ui-monospace, "JetBrains Mono", monospace; }'
            ),
            rule('.a { font-family: var(--face); font-weight: 600; }'),
        ]),
        ['libs/m4/rule.scss:1 600']
    );
    assert.deepEqual(
        report([
            theme(":root { --face: var(--brand); --brand: 'JetBrains Mono'; }"),
            rule('.a { font: 700 12px var(--face); }'),
        ]),
        ['libs/m4/rule.scss:1 700']
    );
    assert.deepEqual(
        report([
            theme(':root { --face: Roboto, sans-serif; }'),
            rule('.a { font-family: var(--face); font-weight: 700; }'),
        ]),
        []
    );
    // A `var()` fallback counts only where the property is never set.
    const fallback = (family) =>
        rule(`.a { font-family: ${family}; font-weight: 700; }`);
    const everything = (scans) => [
        ...scans.flatMap((scan) =>
            scan.findings.map(
                ({ file, line, value }) => `${file}:${line} ${value}`
            )
        ),
        ...report(scans),
    ];
    for (const family of [
        "var(--face, 'JetBrains Mono')",
        "var(--face, var(--y), 'JetBrains Mono')",
    ]) {
        assert.deepEqual(
            everything([theme(':root { --face: Roboto; }'), fallback(family)]),
            []
        );
    }
    for (const family of [
        "var(--nowhere, ui-monospace, 'JetBrains Mono', monospace)",
        "var(--x, var(--y, 'JetBrains Mono'))",
    ]) {
        assert.deepEqual(report([fallback(family)]), [
            'libs/m4/rule.scss:1 700',
        ]);
    }
    assert.deepEqual(
        report([
            theme(':root { --y: Roboto; }'),
            fallback("var(--x, var(--y, 'JetBrains Mono'))"),
        ]),
        []
    );
    assert.deepEqual(
        report([
            theme(":root { --face: var(--brand, 'JetBrains Mono'); }"),
            fallback('var(--face)'),
        ]),
        ['libs/m4/rule.scss:1 700']
    );
    // A property set to a CSS-wide keyword, or through an unset `var()`
    // without a fallback, can be unset too.
    for (const face of ['initial', 'inherit', 'var(--nope)']) {
        assert.deepEqual(
            report([
                theme(`:root { --face: ${face}; }`),
                fallback("var(--face, 'JetBrains Mono')"),
            ]),
            ['libs/m4/rule.scss:1 700']
        );
    }
    assert.deepEqual(
        report([
            theme(':root { --face: var(--nope, Roboto); }'),
            fallback("var(--face, 'JetBrains Mono')"),
        ]),
        []
    );
    // `inherit` takes what another rule sets; a fallback that is itself
    // unset leaves the value invalid.
    assert.deepEqual(
        report([
            theme(':root { --face: Roboto; } .child { --face: inherit; }'),
            fallback("var(--face, 'JetBrains Mono')"),
        ]),
        []
    );
    assert.deepEqual(
        report([
            theme(':root { --face: var(--missing, var(--also-missing)); }'),
            fallback("var(--face, 'JetBrains Mono')"),
        ]),
        ['libs/m4/rule.scss:1 700']
    );
    assert.deepEqual(
        report([
            rule(
                "$mono: 'JetBrains Mono', monospace; .a { font-family: $mono; font-weight: 600; }"
            ),
        ]),
        ['libs/m4/rule.scss:1 600']
    );
    assert.deepEqual(
        report([
            scanWeights('libs/m4/_type.scss', "$mono: 'JetBrains Mono';"),
            rule("@use 'type'; .a { font: 600 12px type.$mono; }"),
        ]),
        ['libs/m4/rule.scss:1 600']
    );
    // Its weights through variables are capped too, an off-scale one is
    // reported once, and a family set from code counts.
    assert.deepEqual(
        report([
            theme(":root { --face: 'JetBrains Mono'; }"),
            rule(
                '$w: 600; .a { font-family: var(--face); font-weight: $w; } .b { font-family: var(--face); font-weight: 650; }'
            ),
        ]),
        ['libs/m4/rule.scss:1 600']
    );
    assert.deepEqual(
        report([
            scanWeights(
                'libs/m4/x.component.ts',
                "el.style.setProperty('--face', \"'JetBrains Mono'\");"
            ),
            rule('.a { font-family: var(--face); font-weight: 700; }'),
        ]),
        ['libs/m4/rule.scss:1 700']
    );
    // A property in a cycle is invalid, so its readers take the fallback;
    // one read twice in a value is no cycle.
    const mono = rule(
        ".a { font-family: var(--face, 'JetBrains Mono'); font-weight: 700; }"
    );
    for (const cycle of [
        ':root { --face: var(--face); }',
        ':root { --face: var(--other); --other: var(--face); }',
    ]) {
        assert.deepEqual(
            report([theme(cycle), mono]),
            ['libs/m4/rule.scss:1 700'],
            cycle
        );
    }
    assert.deepEqual(
        report([
            theme(
                ':root { --base: Roboto; --face: var(--base), var(--base); }'
            ),
            mono,
        ]),
        []
    );
    // The same selector written again in the file sets it on the same
    // elements; another selector, a condition or another file does not.
    const read =
        ".a { font-family: var(--face, 'JetBrains Mono'); font-weight: 700; }";
    for (const [setter, expected] of [
        ['.a { --face: Roboto; }', []],
        ['.b { --face: Roboto; }', ['libs/m4/rule.scss:1 700']],
        [
            '@media (min-width: 1px) { .a { --face: Roboto; } }',
            ['libs/m4/rule.scss:1 700'],
        ],
        ['.p { .a { --face: Roboto; } }', ['libs/m4/rule.scss:1 700']],
    ]) {
        assert.deepEqual(report([rule(`${setter} ${read}`)]), expected, setter);
    }
    // Nested alike, or written with other spacing, it is the same selector.
    for (const same of [
        ".p { .a { --face: Roboto; } } .p { .a { font-family: var(--face, 'JetBrains Mono'); font-weight: 700; } }",
        ".p  .a { --face: Roboto; } .p .a { font-family: var(--face, 'JetBrains Mono'); font-weight: 700; }",
    ]) {
        assert.deepEqual(report([rule(same)]), [], same);
    }
    // A string's spacing is its own, past an escaped quote too: these match
    // different elements.
    for (const [setter, reader] of [
        ["[title='a  b']", "[title='a b']"],
        ["[title='a  \\'b']", "[title='a \\'b']"],
    ]) {
        assert.deepEqual(
            report([
                rule(
                    `${setter} { --face: Roboto; } ${reader} { font-family: var(--face, 'JetBrains Mono'); font-weight: 700; }`
                ),
            ]),
            ['libs/m4/rule.scss:1 700'],
            setter
        );
    }
    assert.deepEqual(report([theme('.a { --face: Roboto; }'), rule(read)]), [
        'libs/m4/rule.scss:1 700',
    ]);
});

test('reads `!important` however it is spaced or cased', () => {
    const mono = "'JetBrains Mono'";
    const report = (file, body) =>
        findOffScaleWeights(file, body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        [
            `.x { font-family: ${mono} ! important; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono} !/* why */important; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [`.x { font: 700 12px ${mono} ! IMPORTANT; }`, ['font: 700']],
        // It wins over a later declaration of its property.
        [
            `.x { font-family: ${mono} ! important; font-family: Roboto; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-weight: 700 ! important; font-family: ${mono}; font-weight: 400; }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono} ! important; } :root { --face: Roboto; } .x { font-family: var(--face); font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // A shorthand keyword with it still parses, so it sets the family.
        [
            `.x { font-family: ${mono}; font: inherit ! important; font-weight: 700; }`,
            [],
        ],
    ]) {
        assert.deepEqual(report('libs/s2/a.scss', source), expected, source);
    }
    assert.deepEqual(
        report(
            'apps/web/src/a.component.html',
            `<div style="font-family: ${mono} ! important; font-family: sans-serif; font-weight: 700"></div>`
        ),
        ['font-weight: 700']
    );
    // A shorthand that is all variables keeps its family from them.
    assert.deepEqual(
        findIndirectWeights([
            scanWeights(
                'libs/s2/theme.scss',
                `:root { --f: 400 12px ${mono}; }`
            ),
            scanWeights(
                'libs/s2/b.scss',
                '.x { font: var(--f) ! important; .y { font-weight: 700; } }'
            ),
        ]).map(({ name, value }) => `${name}: ${value}`),
        ['font-weight: 700']
    );
});

test('treats blocks with the same selector as one rule', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s1/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // Its family is the last one in source order, wherever the weight sits,
    // unless an earlier one is `!important`.
    for (const [source, expected] of [
        [
            `.x { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-weight: 700; } .x { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } .x { font-family: Roboto; } .x { font-weight: 700; }`,
            [],
        ],
        [
            `.x { font-family: ${mono} !important; } .x { font-family: Roboto; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.p { .x { font-family: ${mono}; } } .p { .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `@media (min-width: 1px) { .x { font-family: ${mono}; } } @media (min-width: 1px) { .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        // Another selector is another rule.
        [`.y { font-family: ${mono}; } .x { font-weight: 700; }`, []],
        // A later weight in the rule replaces an earlier one.
        [
            `.x { font-family: ${mono}; font-weight: 700; } .x { font-weight: 400; }`,
            [],
        ],
        // So does a custom property, unless an `@if` may skip the later one.
        [
            `:root { --face: ${mono}; } :root { --face: Roboto; } .x { font-family: var(--face); font-weight: 700; }`,
            [],
        ],
        [
            `:root { --face: Roboto; } :root { --face: ${mono}; } .x { font-family: var(--face); font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono} !important; } :root { --face: Roboto; } .x { font-family: var(--face); font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } @if $a { :root { --face: Roboto; } } .x { font-family: var(--face); font-weight: 700; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
    // An interpolated selector reads the literal its variable holds there,
    // so it is the same rule where the value is and another where it is not.
    const weight = `font-weight: 700;`;
    for (const [source, expected] of [
        [
            `$n: a; .#{$n} { font-family: ${mono}; ${weight} } $n: b; .#{$n} { font-family: Roboto; }`,
            ['font-weight: 700'],
        ],
        [
            `$n: a; .#{$n} { font-family: Roboto; ${weight} } $n: b; .#{$n} { font-family: ${mono}; }`,
            [],
        ],
        [
            `$n: a; .#{$n} { font-family: ${mono}; ${weight} } .#{$n} { font-weight: 500; }`,
            [],
        ],
        [
            `$n: a; .#{$n} { ${weight} } .#{$n} { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        [
            `$n: 'a'; .#{$n} { ${weight} } .a { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        [
            `.p { $n: a; .#{$n} { ${weight} } .#{$n} { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `$n: a; .#{$n} { ${weight} } @include m($n: b); .#{$n} { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        // A string or a mixin's local assignment is not another value.
        [
            `$n: a; .#{$n} { ${weight} } @debug "$n: b"; .#{$n} { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin m { $n: a; .#{$n} { ${weight} } .#{$n} { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `$n: a; .#{$n} { --face: Roboto; } .#{$n} { font-family: var(--face, ${mono}); ${weight} }`,
            [],
        ],
        [
            `$n: a; .#{$n} { --face: Roboto; } $n: b; .#{$n} { font-family: var(--face, ${mono}); ${weight} }`,
            ['font-weight: 700'],
        ],
        // A value the scan cannot know keeps each block its own rule.
        [`.#{$n} { ${weight} } .#{$n} { font-family: ${mono}; }`, []],
        [
            `$n: a; @if $c { $n: b; } .#{$n} { ${weight} } .#{$n} { font-family: ${mono}; }`,
            [],
        ],
        [
            `$n: a; .y { $n: b !global; } .#{$n} { ${weight} } .a { font-family: ${mono}; }`,
            [],
        ],
        [
            `$n: a !default; .#{$n} { ${weight} } .#{$n} { font-family: ${mono}; }`,
            [],
        ],
        [
            `.x { $n: a; } .#{$n} { ${weight} } .#{$n} { font-family: ${mono}; }`,
            [],
        ],
        [`$n: t.$v; .#{$n} { ${weight} } .#{$n} { font-family: ${mono}; }`, []],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test("prefers a rule's own custom property over an inherited one", () => {
    const mono = "'JetBrains Mono'";
    const read = 'font-family: var(--face); font-weight: 700;';
    const report = (body) =>
        findOffScaleWeights('libs/s3/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        [`:root { --face: ${mono}; } .x { --face: Roboto; ${read} }`, []],
        [
            `:root { --face: Roboto; } .x { --face: ${mono}; ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } .x { --face: Roboto; } .x { ${read} }`,
            [],
        ],
        [`.p { --face: ${mono}; .x { --face: Roboto; ${read} } }`, []],
        // Not its own: inherited on purpose, conditional, or another rule.
        [
            `:root { --face: ${mono}; } .x { --face: inherit; ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } .x { @if $a { --face: Roboto; } ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } @media (min-width: 1px) { .x { --face: Roboto; } } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } .y { --face: Roboto; } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } @if $a { .x { --face: Roboto; } } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        // Inside the same condition, it is its own.
        [
            `:root { --face: ${mono}; } .x { @if $a { --face: Roboto; ${read} } }`,
            [],
        ],
        // Sass variables keep Sass scoping: an `@if` may still assign Mono.
        [
            `.x { $f: Roboto; @if $a { $f: ${mono}; } font-family: $f; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
    // Another file's rule styles other elements (component styles).
    assert.deepEqual(
        findIndirectWeights([
            scanWeights('libs/s3/theme.scss', `:root { --face: ${mono}; }`),
            scanWeights('libs/s3/b.scss', '.x { --face: Roboto; }'),
            scanWeights('libs/s3/a.scss', `.x { ${read} }`),
        ]).map(({ value }) => value),
        ['700']
    );
    // A value set from code (an inline style) can still win.
    assert.deepEqual(
        findIndirectWeights([
            scanWeights(
                'libs/s3/x.component.ts',
                `el.style.setProperty('--face', "${mono}");`
            ),
            scanWeights('libs/s3/a.scss', `.x { --face: Roboto; ${read} }`),
        ]).map(({ value }) => value),
        ['700']
    );
});

test('prefers the nearest inherited custom property', () => {
    const mono = "'JetBrains Mono'";
    const read = 'font-family: var(--face); font-weight: 700;';
    const report = (body) =>
        findOffScaleWeights('libs/s4/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // `*` sets each element, an enclosing rule sits nearer than `body`,
    // `body` nearer than `:root`, and a registered initial value applies
    // only where nothing is set.
    for (const [source, expected] of [
        [
            `:root { --face: ${mono}; } body { --face: Roboto; } .x { ${read} }`,
            [],
        ],
        [
            `:root { --face: Roboto; } body { --face: ${mono}; } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        [`:root { --face: ${mono}; } * { --face: Roboto; } .x { ${read} }`, []],
        [
            `* { --face: ${mono}; } body { --face: Roboto; } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } .p { --face: Roboto; .x { ${read} } }`,
            [],
        ],
        [`.p { --face: ${mono}; .q { --face: Roboto; .x { ${read} } } }`, []],
        [
            `.p { --face: Roboto; .q { --face: ${mono}; .x { ${read} } } }`,
            ['font-weight: 700'],
        ],
        [
            `@property --face { syntax: '*'; inherits: true; initial-value: ${mono}; } body { --face: Roboto; } .x { ${read} }`,
            [],
        ],
        // Not settled: inherited on purpose, conditional, or not an
        // ancestor for sure; and `body` does not reach `:root`.
        [
            `:root { --face: ${mono}; } body { --face: inherit; } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } @media (min-width: 1px) { body { --face: Roboto; } } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } .y { --face: Roboto; } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } body { --face: Roboto; } :root { ${read} }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
    // Across files too; a value set from code can still win.
    const theme = (body) => scanWeights('libs/s4/theme.scss', body);
    const consumer = scanWeights('libs/s4/b.scss', `.x { ${read} }`);
    // A condition in another file is not the reader's, even at the same
    // place in its text.
    assert.deepEqual(
        findIndirectWeights([
            theme(`:root { --face: ${mono}; }`),
            scanWeights(
                'libs/s4/d.scss',
                '@media (min-width: 1px) { body { --face: Roboto; } }'
            ),
            scanWeights(
                'libs/s4/e.scss',
                `@media (min-width: 1px) { .x { ${read} } }`
            ),
        ]).map(({ value }) => value),
        ['700']
    );
    assert.deepEqual(
        findIndirectWeights([
            theme(`:root { --face: ${mono}; } body { --face: Roboto; }`),
            consumer,
        ]),
        []
    );
    assert.deepEqual(
        findIndirectWeights([
            theme('body { --face: Roboto; }'),
            scanWeights(
                'libs/s4/x.component.ts',
                `el.style.setProperty('--face', "${mono}");`
            ),
            consumer,
        ]).map(({ value }) => value),
        ['700']
    );
});

test('reads an interpolated family declaration whole', () => {
    const report = (body) =>
        findOffScaleWeights('libs/s4/c.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        [
            "$face: 'JetBrains Mono'; .x { font-family: #{$face}; font-weight: 700; }",
            ['font-weight: 700'],
        ],
        [
            "$face: 'JetBrains Mono'; .x { font-family: #{$face}, monospace; font-weight: 700; }",
            ['font-weight: 700'],
        ],
        [
            "$face: 'JetBrains Mono'; .x { font-family: #{$face}; .y { font-weight: 700; } }",
            ['font-weight: 700'],
        ],
        ['$face: Roboto; .x { font-family: #{$face}; font-weight: 700; }', []],
        // The list goes on past the interpolation, and past a quoted `;`.
        [
            "$face: 'Fira'; .x { font-family: #{$face}, 'JetBrains Mono'; font-weight: 700; }",
            ['font-weight: 700'],
        ],
        [
            ".x { font-family: 'Odd;Name', 'JetBrains Mono'; font-weight: 700; }",
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads a selector list as each of its selectors', () => {
    const mono = "'JetBrains Mono'";
    const read = 'font-family: var(--face); font-weight: 700;';
    const report = (body) =>
        findOffScaleWeights('libs/s5/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // A family set for one selector of a list reaches that selector.
        [
            `.x, .y { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } .x, .y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.y { font-family: ${mono}; } .x, .y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.a, .b { .x { font-family: ${mono}; } } .a { .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x, .y { font-family: ${mono}; } .x { font-family: Roboto; } .x { font-weight: 700; }`,
            [],
        ],
        [`.x, .y { font-family: ${mono}; } .z { font-weight: 700; }`, []],
        // A weight stays in effect while it is for any of its selectors.
        [
            `.x, .y { font-weight: 700; } .x { font-weight: 400; } .x, .y { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        [
            `.x, .y { font-weight: 700; } .x, .y { font-weight: 400; } .x { font-family: ${mono}; }`,
            [],
        ],
        // A custom property: set for the reader's selectors, replaced for them.
        [
            `:root { --face: ${mono}; } .x, .y { --face: Roboto; } .x { ${read} }`,
            [],
        ],
        [
            `:root { --face: ${mono}; } .x { --face: Roboto; } .x, .y { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `.x, .y { --face: ${mono}; } .x { --face: Roboto; } .x { ${read} }`,
            [],
        ],
        [
            `.x, .y { --face: ${mono}; } .x { --face: Roboto; } .y { ${read} }`,
            ['font-weight: 700'],
        ],
        // Selectors without a family of their own inherit one from outside;
        // one named through a variable is resolved later.
        [
            `.p { font-family: ${mono}; .x { font-family: Roboto; } .x, .y { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --f: ${mono}; } .x { font-family: var(--f); } .x, .y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // More than 16 chains keep the block its own rule.
        [
            `.a, .b, .c, .d, .e { .f, .g, .h, .i { font-family: ${mono}; } } .a { .f { font-weight: 700; } }`,
            [],
        ],
        // A comma in a string is no list; `:is(.x, .y)` is one selector
        // that every `.x` matches.
        [
            `[title="a, b"] { font-family: ${mono}; } [title="a"] { font-weight: 700; }`,
            [],
        ],
        [
            `:is(.x, .y) { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads `revert` on a custom property as inheriting', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s5/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // `revert` and `revert-layer` bring back the inherited value; only
    // `initial` leaves the property unset, for the fallback.
    for (const [keyword, expected] of [
        ['revert', ['font-weight: 700']],
        ['revert-layer', ['font-weight: 700']],
        ['unset', ['font-weight: 700']],
        ['initial', []],
    ]) {
        assert.deepEqual(
            report(
                `:root { --face: ${mono}; } .x { --face: ${keyword}; font-family: var(--face, Roboto); font-weight: 700; }`
            ),
            expected,
            keyword
        );
    }
    assert.deepEqual(
        report(
            `.p { font-family: ${mono}; .x { font-family: revert; font-weight: 700; } }`
        ),
        ['font-weight: 700']
    );
});

test("reads a mixin's declarations where it is included", () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s6/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // Its family, at the `@include`, in source order with the rule's own.
        [
            `@mixin mono { font-family: ${mono}; } .x { @include mono; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin mono { font-family: ${mono}; } .x { @include mono; font-family: Roboto; font-weight: 700; }`,
            [],
        ],
        [
            `@mixin mono { font-family: ${mono}; } .x { font-family: Roboto; @include mono; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin mono { font-family: ${mono}; } .x { @include mono; .y { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin m-o { font-family: ${mono}; } .x { @include m_o; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [`@mixin mono { font-family: ${mono}; } .x { font-weight: 700; }`, []],
        // Its weight, against the including rule's family unless it sets one.
        [
            `@mixin heavy { font-weight: 700; } .x { font-family: Roboto; @include heavy; }`,
            [],
        ],
        [
            `@mixin heavy { font-family: Roboto; font-weight: 700; } .x { font-family: ${mono}; @include heavy; }`,
            [],
        ],
        // A family named through a variable, resolved later.
        [
            `@mixin heavy { font-weight: 700; } :root { --f: ${mono}; } .x { font-family: var(--f); @include heavy; }`,
            ['font-weight: 700'],
        ],
        // Another module's mixin, or the text in a string, is not this one.
        [
            `@mixin t { font-family: ${mono}; } .x { @include t.other; font-weight: 700; }`,
            [],
        ],
        [
            `@mixin mono { font-family: ${mono}; } .x { content: "@include mono"; font-weight: 700; }`,
            [],
        ],
        // A variable from outside may change before the `@include`.
        [
            `$n: a; @mixin m { .#{$n} { font-family: ${mono}; font-weight: 700; } .a { font-weight: 500; } } $n: b; .x { @include m; }`,
            ['font-weight: 700'],
        ],
        [
            `$n: a; @mixin m { .#{$n} { font-family: ${mono}; font-weight: 700; } } $n: b; .a { font-weight: 500; } .b { @include m; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads a self-sibling selector as the parent element', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s6/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        [
            `.x { font-family: ${mono}; & + & { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; & ~ &.on { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [`.x { font-family: ${mono}; & + .y { font-weight: 700; } }`, []],
        [`.x { font-family: ${mono}; &-y { font-weight: 700; } }`, []],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('inherits a family from a flat ancestor selector', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s7/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // The nearest top-level rule naming an ancestor of the target gives its
    // family; a sibling is no ancestor.
    for (const [source, expected] of [
        [
            `.parent { font-family: ${mono}; } .parent .child { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.parent { font-family: ${mono}; } .parent > .child { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.a { font-family: ${mono}; } .a>.b { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.a { font-family: ${mono}; } .a .b + .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.a { font-family: ${mono}; } @media (min-width: 1px) { .a .b { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.a { font-family: Roboto; } .a .b { font-family: ${mono}; } .a .b .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.a { font-family: ${mono}; } .a .b { font-family: inherit; } .a .b .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.parent { font-family: ${mono}; } .parent + .child { font-weight: 700; }`,
            [],
        ],
        [
            `.a { font-family: ${mono}; } .a .b { font-family: Roboto; } .a .b .c { font-weight: 700; }`,
            [],
        ],
        [
            `.a { font-family: ${mono}; } .a .b { font-family: Roboto; font-weight: 700; }`,
            [],
        ],
        // Spaced one way: `.a>.b` names the same element as `.a > .b`, and
        // `.a.b` (one element with both classes) is no ancestor of `.a .b`.
        [
            `.a>.b { font-family: ${mono}; } .a > .b .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [`.a.b { font-family: ${mono}; } .a .b .c { font-weight: 700; }`, []],
        // In a selector list, any selector whose ancestor renders Mono counts.
        [
            `.p { font-family: Roboto; } .q { font-family: ${mono}; } .p .x, .q .y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --f: ${mono}; } .p { font-family: Roboto; } .q { font-family: var(--f); } .p .x, .q .y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads a non-inheriting registered property and a compound root', () => {
    const mono = "'JetBrains Mono'";
    const read = 'font-family: var(--face); font-weight: 700;';
    const registered = (initial, inherits) =>
        `@property --face { syntax: '*'; inherits: ${inherits}; initial-value: ${initial}; }`;
    const report = (body) =>
        findOffScaleWeights('libs/s7/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // `inherits: false`: no ancestor's value reaches the element.
        [
            `${registered(mono, 'false')} body { --face: Roboto; } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `${registered('Roboto', 'false')} body { --face: ${mono}; } .x { ${read} }`,
            [],
        ],
        [
            `${registered('Roboto', 'false')} * { --face: ${mono}; } .x { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `${registered('Roboto', 'false')} .x { --face: ${mono}; ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `${registered(mono, 'true')} body { --face: Roboto; } .x { ${read} }`,
            [],
        ],
        // A compound selector on the root element is beyond `body`'s reach,
        // past brackets, strings, parentheses and escapes in it.
        [
            `:root { --face: ${mono}; } body { --face: Roboto; } html:not(.a .b) { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } body { --face: Roboto; } html[data-x="a] b"] { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } body { --face: Roboto; } html.a\\ b { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } body { --face: Roboto; } html[data-x="a"] .x { ${read} }`,
            [],
        ],
        [
            `:root { --face: ${mono}; } body { --face: Roboto; } html.theme { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } body { --face: Roboto; } :root:not(.x) { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: ${mono}; } body { --face: Roboto; } html .x { ${read} }`,
            [],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads a Sass `@extend` as the extended rule applied to its own', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s8/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // The extended rule's family, where that rule is written.
        [
            `%mono { font-family: ${mono}; } .x { @extend %mono; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.m { font-family: ${mono}; } .x { @extend .m; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `%mono { font-family: ${mono}; } .x { @extend %mono !optional; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `%mono { font-family: ${mono}; } .x { @extend %mono; .y { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: Roboto; @extend %mono; font-weight: 700; } %mono { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        [
            `%mono { font-family: ${mono}; } .x { font-family: Roboto; @extend %mono; font-weight: 700; }`,
            [],
        ],
        [
            `%mono { font-family: ${mono}; } .x { @extend %other; font-weight: 700; }`,
            [],
        ],
        [
            `%mono { font-family: ${mono}; } .x { content: "@extend %mono;"; font-weight: 700; }`,
            [],
        ],
        [
            `.m { font-family: ${mono}; } .x { @extend .n, .m; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // Its weight, against each extending rule's family.
        [
            `%heavy { font-weight: 700; } .x { font-family: ${mono}; @extend %heavy; }`,
            ['font-weight: 700'],
        ],
        [
            `%heavy { font-weight: 700; } .x { font-family: Roboto; @extend %heavy; }`,
            [],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads custom properties per selector of a reading list', () => {
    const mono = "'JetBrains Mono'";
    const read = 'font-family: var(--face); font-weight: 700;';
    const report = (body) =>
        findOffScaleWeights('libs/s8/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // Each selector of `.x, .y` styles its own elements: an override for
    // one, or no value of its own there, decides that selector alone.
    for (const [source, expected] of [
        [
            `.x, .y { --face: Roboto; } .y { --face: ${mono}; } .x, .y { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `.x, .y { --face: ${mono}; } .y { --face: Roboto; } .x, .y { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `.x, .y { --face: ${mono}; } .x { --face: Roboto; } .y { --face: Roboto; } .x, .y { ${read} }`,
            [],
        ],
        [
            `:root { --face: ${mono}; } .x { --face: Roboto; } .x, .y { ${read} }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --face: Roboto; } .x { --face: Roboto; } .x, .y { ${read} }`,
            [],
        ],
        [
            `:root { --face: ${mono}; } .x, .y { --face: Roboto; } .x, .y { ${read} }`,
            [],
        ],
        // Every selector setting its own leaves no room for another rule's,
        // and one replaced for a selector is gone there.
        [
            `.z { --face: ${mono}; } .x { --face: Roboto; } .y { --face: Roboto; } .x, .y { ${read} }`,
            [],
        ],
        [
            `.x, .z { --face: ${mono}; } .x { --face: Roboto; } .y { --face: Roboto; } .x, .y { ${read} }`,
            [],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
    // A value set from code reads others through `var()`, with no selector.
    assert.deepEqual(
        findIndirectWeights([
            scanWeights(
                'libs/s8/x.component.ts',
                "el.style.setProperty('--face', 'var(--brand)');"
            ),
            scanWeights('libs/s8/theme.scss', `:root { --brand: ${mono}; }`),
            scanWeights('libs/s8/c.scss', `.x { ${read} }`),
        ]).map(({ value }) => value),
        ['700']
    );
});

test('reads a compound selector with the rules it contains', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s9/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // An element of `.x:hover` (or `.x.on`, `a.x`, `.p .x:hover`) is an `.x`.
    for (const [source, expected] of [
        [
            `.x { font-family: ${mono}; } .x:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } .x.on { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } a.x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } .p .x:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } .x::before { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } .x:hover, .y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.md\\:x { font-family: ${mono}; } .md\\:x:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } @media (min-width: 1px) { .x:hover { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        // The rule's own family wins, a base's beats an inherited one, and a
        // compound that only looks alike is another element.
        [
            `.x { font-family: ${mono}; } .x:hover { font-family: Roboto; font-weight: 700; }`,
            [],
        ],
        [
            `.x { font-family: Roboto; } .p { font-family: ${mono}; .x:hover { font-weight: 700; } }`,
            [],
        ],
        [`.x { font-family: ${mono}; } .xy:hover { font-weight: 700; }`, []],
        [`.x { font-family: ${mono}; } .y:not(.x) { font-weight: 700; }`, []],
        [`.x.on { font-family: ${mono}; } .x:hover { font-weight: 700; }`, []],
        [`.x { font-family: ${mono}; } .x#{$s} { font-weight: 700; }`, []],
        // A base that inherits, or covers only some selectors, leaves the
        // rest to the parent.
        [
            `.x { font-family: inherit; } .p { font-family: ${mono}; .x:hover { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: Roboto; } .p { font-family: ${mono}; .x:hover, .y { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads quoted family text as a name', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s9/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // In a string only a Sass `#{…}` is a variable.
    for (const [source, expected] of [
        [
            `:root { --face: Roboto; } .x { font-family: "var(--face)", ${mono}; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `$face: Roboto; .x { font-family: "$face", ${mono}; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `$face: Roboto; .x { font-family: "#{$face}", ${mono}; font-weight: 700; }`,
            [],
        ],
        [
            `:root { --face: Roboto; } .x { font-family: var(--face, "a)b"), ${mono}; font-weight: 700; }`,
            [],
        ],
        // A quoted `)` stays in the fallback, and a quoted `var()` in a
        // value is no reference that could leave it invalid.
        [
            `.x { font-family: var(--nope, "a)b", Roboto), ${mono}; font-weight: 700; }`,
            [],
        ],
        [
            `:root { --face: "var(--x)", Roboto; } .x { font-family: var(--face, ${mono}); font-weight: 700; }`,
            [],
        ],
        [
            `:root { --face: "a\\"var(--x)", Roboto; } .x { font-family: var(--face, ${mono}); font-weight: 700; }`,
            [],
        ],
        [
            `.x { font-family: "a\\"var(--face)", ${mono}; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads mixin weights where they land, through nested includes', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s10/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // A mixin's weight meets the including rule's family, a later one
        // of its own included.
        [
            `@mixin m { font-family: ${mono}; font-weight: 700; } .x { @include m; font-family: Roboto; }`,
            [],
        ],
        [
            `@mixin m { font-family: Roboto; font-weight: 700; } .x { @include m; font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin m { font-family: ${mono}; font-weight: 700; } .x { @include m; }`,
            ['font-weight: 700'],
        ],
        // Not included here: it is read where it is written.
        [
            `@mixin m { font-family: ${mono}; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // A mixin included in another goes on to that one's includes.
        [
            `@mixin inner { font-family: ${mono}; } @mixin outer { @include inner; } .x { @include outer; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin inner { font-weight: 700; } @mixin outer { @include inner; } .x { font-family: ${mono}; @include outer; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin a { @include b; } @mixin b { @include a; font-weight: 700; } .x { font-family: ${mono}; @include a; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin a { @include b; } @mixin b { @include a; font-family: ${mono}; } .x { @include a; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // Included in several rules: any whose family renders Mono counts.
        [
            `@mixin h { font-weight: 700; } .a { font-family: Roboto; @include h; } .b { font-family: ${mono}; @include h; }`,
            ['font-weight: 700'],
        ],
        [
            `:root { --f: ${mono}; } @mixin h { font-weight: 700; } .a { font-family: Roboto; @include h; } .b { font-family: var(--f); @include h; }`,
            ['font-weight: 700'],
        ],
        // Each include is a landing of its own: a later weight replaces it,
        // and an include after that replaces that weight in turn.
        [
            `@mixin m { font-weight: 700; } .x { font-family: ${mono}; @include m; font-weight: 500; }`,
            [],
        ],
        [
            `@mixin m { font-weight: 700; } .x { font-family: ${mono}; @include m; font-weight: 500; @include m; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin m { font-weight: 500; } .x { font-family: ${mono}; @include m; font-weight: 700; @include m; }`,
            [],
        ],
        [
            `@mixin m { font-weight: 700 !important; } .x { font-family: ${mono}; @include m; font-weight: 500; }`,
            ['font-weight: 700'],
        ],
        // Where it is replaced, its family is not the one it renders in.
        [
            `@mixin m { font-weight: 700; } .a { font-family: ${mono}; @include m; font-weight: 500; } .b { font-family: Roboto; @include m; }`,
            [],
        ],
        [
            `@mixin m { font-weight: 700; } .a { font-family: Roboto; @include m; font-weight: 500; } .b { font-family: ${mono}; @include m; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin m { font: { weight: 700; } } .x { font-family: ${mono}; @include m; }`,
            ['weight: 700'],
        ],
        // A content block is the including rule's where the mixin places
        // `@content` at its top level, in order there.
        [
            `@mixin w { font-weight: 700; @content; } .x { @include w { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin w { font-family: ${mono}; @content; } .x { @include w { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin w { font-weight: 700; @content; } .x { font-family: Roboto; @include w { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin w { font-weight: 700; @content; } .x { @include w { font-family: ${mono}; } font-family: Roboto; }`,
            [],
        ],
        [
            `@mixin w { @content; font-family: Roboto; } .x { font-weight: 700; @include w { font-family: ${mono}; } }`,
            [],
        ],
        [
            `@mixin w { @content; font-weight: 500; } .x { font-family: ${mono}; @include w { font-weight: 700; } }`,
            [],
        ],
        [
            `@mixin w { font-weight: 500; @content; } .x { font-family: ${mono}; @include w { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin w { @content; } .x { font-family: ${mono}; @include w { font-weight: 700; } font-weight: 500; }`,
            [],
        ],
        // Sass conditions are not evaluated: any branch may run.
        [
            `@mixin w { @if false { @content; } } .x { font-weight: 700; @include w { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin w { @if true { @content; } } .x { font-weight: 700; @include w { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin w { font-weight: 700; @content; } @mixin outer { @include w { font-family: ${mono}; } } .x { @include outer; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin w { @content; } .a { @include w { font-family: ${mono}; } } .b { font-weight: 700; @include w { font-family: Roboto; } }`,
            [],
        ],
        [
            `@mixin w { @content; font-weight: 500; @content; } .x { font-family: ${mono}; @include w { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin w { @content; } .a { font-family: ${mono}; @include w { font-weight: 700; } } .b { @include w { font-weight: 500; } }`,
            ['font-weight: 700'],
        ],
        // Through nested mixins, in the order Sass writes them out.
        [
            `@mixin inner { @content; } @mixin outer { font-weight: 500; @include inner { font-weight: 700; } } .x { font-family: ${mono}; @include outer; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin inner { @content; } @mixin outer { font-weight: 700; @include inner { font-weight: 500; } } .x { font-family: ${mono}; @include outer; }`,
            [],
        ],
        [
            `@mixin inner { @content; font-weight: 500; } @mixin outer { @include inner { font-weight: 700; } } .x { font-family: ${mono}; @include outer; }`,
            [],
        ],
        [
            `@mixin inner { font-weight: 500; } @mixin outer { font-weight: 700; @include inner; } .x { font-family: ${mono}; @include outer; }`,
            [],
        ],
        [
            `@mixin a { font-weight: 700; } @mixin b { @include a; } @mixin c { @include b; font-weight: 500; } .x { font-family: ${mono}; @include c; }`,
            [],
        ],
        [
            `@mixin inner { @content; } @mixin outer { @include inner { font-family: Roboto; } font-family: ${mono}; } .x { font-weight: 700; @include outer; }`,
            ['font-weight: 700'],
        ],
        [
            `@mixin inner { @content; } @mixin outer { font-family: ${mono}; @include inner { font-family: Roboto; } } .x { font-weight: 700; @include outer; }`,
            [],
        ],
        // Placed in a nested rule, it styles another element.
        [
            `@mixin w { font-weight: 700; .inner { @content; } } .x { @include w { font-family: ${mono}; } }`,
            [],
        ],
        // A placeholder styles nothing where it is written; a class still does.
        [
            `%h { font-family: ${mono}; font-weight: 700; } .x { @extend %h; font-family: Roboto; }`,
            [],
        ],
        [
            `.m { font-family: ${mono}; font-weight: 700; } .x { @extend .m; font-family: Roboto; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test("lands another module's mixin weights where they are included", () => {
    const mono = "'JetBrains Mono'";
    const type = [
        '@mixin heavy {',
        '    font-weight: 700;',
        '}',
        '@mixin light { font-weight: 400; }',
        '@mixin firm { font-weight: 700 !important; }',
        '@mixin settled { font-weight: 700; font-weight: 500; }',
    ].join('\n');
    const report = (rules) =>
        workspace({
            'libs/w1/_type.scss': type,
            'libs/w1/c.scss': `@use 'type';\n${rules}`,
        });
    const heavy = ['libs/w1/_type.scss:2 font-weight: 700'];
    for (const [rules, expected] of [
        [`.x { font-family: ${mono}; @include type.heavy; }`, heavy],
        [`.x { font-family: Roboto; @include type.heavy; }`, []],
        // At the `@include`, in Sass's output order with the rule's own.
        [
            `.x { font-family: ${mono}; @include type.heavy; font-weight: 500; }`,
            [],
        ],
        [
            `.x { font-family: ${mono}; font-weight: 500; @include type.heavy; }`,
            heavy,
        ],
        [`.x { @include type.heavy; font-family: ${mono}; }`, heavy],
        [
            `.x { font-family: ${mono}; @include type.heavy; @include type.light; }`,
            [],
        ],
        [
            `.x { font-family: ${mono}; @include type.firm; font-weight: 500; }`,
            ['libs/w1/_type.scss:5 font-weight: 700'],
        ],
        // And in its order within the mixin.
        [`.x { font-family: ${mono}; @include type.settled; }`, []],
        // A nested rule inherits the family; one named through a variable
        // is resolved once the workspace is scanned.
        [`.x { font-family: ${mono}; .y { @include type.heavy; } }`, heavy],
        [
            `:root { --face: ${mono}; } .x { font-family: var(--face); @include type.heavy; }`,
            heavy,
        ],
    ]) {
        assert.deepEqual(report(rules), expected, rules);
    }
});

test("reports another module's mixin weight once, at its own line", () => {
    const mono = "'JetBrains Mono'";
    const users = {
        'libs/w2/a.scss': `@use 'type'; .a { font-family: ${mono}; @include type.heavy; }`,
        'libs/w2/b.scss': [
            "@use 'type';",
            `:root { --face: ${mono}; }`,
            '.b { font-family: var(--face); @include type.heavy; }',
        ].join('\n'),
    };
    const heavy = ['libs/w2/_type.scss:1 font-weight: 700'];
    assert.deepEqual(
        workspace({
            'libs/w2/_type.scss': '@mixin heavy { font-weight: 700; }',
            ...users,
        }),
        heavy
    );
    // Its own module includes it in a JetBrains Mono rule too.
    assert.deepEqual(
        workspace({
            'libs/w2/_type.scss': `@mixin heavy { font-weight: 700; } .own { font-family: ${mono}; @include heavy; }`,
            ...users,
        }),
        heavy
    );
});

test("gives a rule the family another module's mixin sets there", () => {
    const mono = "'JetBrains Mono'";
    const report = (rules, face = `${mono}, monospace`) =>
        workspace({
            'libs/w3/_mono.scss': `$face: ${mono}, monospace;\n@mixin face {\n    font-family: ${face};\n}`,
            'libs/w3/_other.scss': '@mixin face { font-family: Roboto; }',
            'libs/w3/c.scss': `@use 'mono';\n@use 'other';\n${rules}`,
        });
    const heavy = ['libs/w3/c.scss:3 font-weight: 700'];
    for (const [rules, expected, face] of [
        [`.x { @include mono.face; font-weight: 700; }`, heavy],
        [
            `.x { @include mono.face; font-family: Roboto; font-weight: 700; }`,
            [],
        ],
        [
            `.x { font-family: Roboto; @include mono.face; font-weight: 700; }`,
            heavy,
        ],
        [`.x { @include mono.face; .y { font-weight: 700; } }`, heavy],
        [
            `.x { @include mono.face; &:hover { font-weight: 600; } }`,
            ['libs/w3/c.scss:3 font-weight: 600'],
        ],
        // Named through its own module's variable, resolved there.
        [`.x { @include mono.face; font-weight: 700; }`, heavy, '$face'],
        // A namesake in another module is not the mixin included.
        [`.x { @include other.face; font-weight: 700; }`, []],
    ]) {
        assert.deepEqual(report(rules, face), expected, rules);
    }
});

test('reads a mixin another module includes where it lands', () => {
    const mono = "'JetBrains Mono'";
    const report = (rules) =>
        workspace({
            'libs/w4/_badge.scss': `@mixin badge {\n    font-family: ${mono};\n    font-weight: 700;\n}`,
            'libs/w4/c.scss': `@use 'badge';\n${rules}`,
        });
    const heavy = ['libs/w4/_badge.scss:3 font-weight: 700'];
    assert.deepEqual(
        report('.x { @include badge.badge; font-family: Roboto; }'),
        []
    );
    assert.deepEqual(report('.x { @include badge.badge; }'), heavy);
    // Included nowhere, it is read where it is written.
    assert.deepEqual(report('.x { color: red; }'), heavy);
});

test("resolves another module's mixin as Sass does", () => {
    const mono = "'JetBrains Mono'";
    // A bare name a mixin of the file has is its own.
    assert.deepEqual(
        scanWeights(
            'libs/w5/a.scss',
            '@mixin m_a { color: red; } .x { @include m-a; @include n_b; @include t.c_d; }'
        ).includes.map(({ callee }) => callee),
        [
            { name: 'n-b', namespace: null },
            { name: 'c-d', namespace: 't' },
        ]
    );
    const type = { 'libs/w5/_type.scss': '@mixin heavy { font-weight: 700; }' };
    const heavy = ['libs/w5/_type.scss:1 font-weight: 700'];
    // Through a `@forward` prefix, and as a bare name `as *` or `@import`
    // brings in.
    assert.deepEqual(
        workspace({
            ...type,
            'libs/w5/_theme.scss': "@forward 'type' as type-*;",
            'libs/w5/c.scss': `@use 'theme'; .x { font-family: ${mono}; @include theme.type-heavy; }`,
        }),
        heavy
    );
    for (const load of ["@use 'type' as *;", "@import 'type';"]) {
        assert.deepEqual(
            workspace({
                ...type,
                'libs/w5/c.scss': `${load} .x { font-family: ${mono}; @include heavy; }`,
            }),
            heavy,
            load
        );
    }
    // A mixin that `hide` leaves out is not the one included.
    assert.deepEqual(
        workspace({
            ...type,
            'libs/w5/_quiet.scss': '@mixin heavy { font-weight: 400; }',
            'libs/w5/_theme.scss':
                "@forward 'type' hide heavy;\n@forward 'quiet';",
            'libs/w5/c.scss': `@use 'theme'; .x { font-family: ${mono}; @include theme.heavy; }`,
        }),
        []
    );
    // Nor one declared in a rule, which is local to it.
    assert.deepEqual(
        workspace({
            'libs/w5/_type.scss':
                '@mixin heavy { font-weight: 400; } .p { @mixin heavy { font-weight: 700; } @include heavy; }',
            'libs/w5/c.scss': `@use 'type'; .x { font-family: ${mono}; @include type.heavy; }`,
        }),
        []
    );
    // Two `@import`ed files that define it: Sass includes the later one,
    // which the scan does not order, so neither lands.
    assert.deepEqual(
        workspace({
            'libs/w5/_a.scss': '\n\n@mixin heavy { font-weight: 700; }',
            'libs/w5/_b.scss': '@mixin heavy { font-weight: 400; }',
            'libs/w5/c.scss': `@import 'a'; @import 'b'; .x { font-family: ${mono}; @include heavy; }`,
        }),
        []
    );
});

test("follows another module's mixin through the mixins it includes", () => {
    const mono = "'JetBrains Mono'";
    for (const [files, expected] of [
        // Its family, from a mixin it includes from a third module or its
        // own.
        [
            {
                'libs/w6/_inner.scss': `@mixin face { font-family: ${mono}; }`,
                'libs/w6/_outer.scss':
                    "@use 'inner'; @mixin title { @include inner.face; }",
                'libs/w6/c.scss':
                    "@use 'outer'; .x { @include outer.title; font-weight: 700; }",
            },
            ['libs/w6/c.scss:1 font-weight: 700'],
        ],
        [
            {
                'libs/w6/_outer.scss': `@mixin face { font-family: ${mono}; } @mixin title { @include face; }`,
                'libs/w6/c.scss':
                    "@use 'outer'; .x { @include outer.title; font-weight: 700; }",
            },
            ['libs/w6/c.scss:1 font-weight: 700'],
        ],
        // In the order Sass writes them out, wherever each is declared.
        [
            {
                'libs/w6/_outer.scss': `@mixin title { @include face; font-family: ${mono}; } @mixin face { font-family: Roboto; }`,
                'libs/w6/c.scss':
                    "@use 'outer'; .x { @include outer.title; font-weight: 700; }",
            },
            ['libs/w6/c.scss:1 font-weight: 700'],
        ],
        // Its weight, from a third module's mixin.
        [
            {
                'libs/w6/_inner.scss': '@mixin heavy { font-weight: 700; }',
                'libs/w6/_outer.scss':
                    "@use 'inner'; @mixin title { @include inner.heavy; }",
                'libs/w6/c.scss': `@use 'outer'; .x { font-family: ${mono}; @include outer.title; }`,
            },
            ['libs/w6/_inner.scss:1 font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(workspace(files), expected, JSON.stringify(files));
    }
});

test("reads another module's mixin while its animation runs and after", () => {
    const mono = "'JetBrains Mono'";
    const anim = {
        'libs/w8/_anim.scss': [
            `@keyframes face { from { font-family: ${mono}; } }`,
            '@keyframes swap { from { font-family: Roboto; } }',
            '@keyframes heavy { from { font-weight: 700; } }',
            '@mixin mono-hold { animation: face 1s forwards; }',
            '@mixin roboto-while { animation: swap 1s; }',
            '@mixin heavy { animation: heavy 1s; }',
            `@mixin mono { font-family: ${mono}; }`,
        ].join('\n'),
        'libs/w8/_outer.scss':
            "@use 'anim'; @mixin title { @include anim.roboto-while; }",
    };
    const report = (rules) =>
        workspace({ ...anim, 'libs/w8/c.scss': `@use 'anim';\n${rules}` });
    const own = ['libs/w8/c.scss:2 font-weight: 700'];
    for (const [rules, expected] of [
        // A frame it holds sets the family over the rule's own.
        [
            `.x { font-family: Roboto; @include anim.mono-hold; font-weight: 700; }`,
            own,
        ],
        // One it only runs leaves the rule its own family after, also
        // through a third module's mixin.
        [
            `.x { font-family: ${mono}; @include anim.roboto-while; font-weight: 700; }`,
            own,
        ],
        [
            `.x { font-family: Roboto; @include anim.roboto-while; font-weight: 700; }`,
            [],
        ],
        // Its family in a keyframe here outranks the rule's own too.
        [
            `@keyframes k { from { @include anim.mono; } } .x { animation: k 1s forwards; font-family: Roboto; font-weight: 700; }`,
            own,
        ],
        [
            `@use 'outer'; .x { font-family: ${mono}; @include outer.title; font-weight: 700; }`,
            own,
        ],
        // A keyframe's weight outranks the rule's own while it runs, a
        // later one too.
        [
            `.x { font-family: ${mono}; font-weight: 500; @include anim.heavy; }`,
            ['libs/w8/_anim.scss:3 font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; @include anim.heavy; font-weight: 500; }`,
            ['libs/w8/_anim.scss:3 font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(rules), expected, rules);
    }
});

test("caps a named argument another module's mixin sets a weight from", () => {
    const mono = "'JetBrains Mono'";
    const report = (mixin, rules) =>
        workspace({
            'libs/w7/_type.scss': mixin,
            'libs/w7/c.scss': `@use 'type';\n${rules}`,
        });
    assert.deepEqual(
        report(
            '@mixin heavy($w: 400) { font-weight: $w; }',
            `.x {\n    font-family: ${mono};\n    @include type.heavy($w: 700);\n}`
        ),
        ['libs/w7/c.scss:4 $w: 700']
    );
    // Its default, where the call leaves it out.
    assert.deepEqual(
        report(
            '@mixin heavy($w: 700) { font-weight: $w; }',
            `.x { font-family: ${mono}; @include type.heavy; }`
        ),
        ['libs/w7/_type.scss:1 $w: 700']
    );
});

test('runs the definition of a mixin Sass resolves at each include', () => {
    const mono = "'JetBrains Mono'";
    const heavy = {
        'libs/w9/_type.scss': '@mixin heavy { font-weight: 700; }',
    };
    const imported = ['libs/w9/_type.scss:1 font-weight: 700'];
    for (const [files, expected] of [
        // One declared in a rule is visible there, once declared; elsewhere
        // the name runs the one brought in.
        [
            {
                ...heavy,
                'libs/w9/c.scss': `@use 'type' as *;\n.p { @mixin heavy { font-weight: 400; } @include heavy; }\n.x { font-family: ${mono}; @include heavy; }`,
            },
            imported,
        ],
        [
            {
                ...heavy,
                'libs/w9/c.scss': `@use 'type' as *; .p { font-family: ${mono}; @mixin heavy { font-weight: 400; } @include heavy; }`,
            },
            [],
        ],
        [
            {
                ...heavy,
                'libs/w9/c.scss': `@use 'type' as *; .p { font-family: ${mono}; @include heavy; @mixin heavy { font-weight: 400; } }`,
            },
            imported,
        ],
        // A rule runs the definition declared before it.
        [
            {
                'libs/w9/c.scss': `@mixin m { font-weight: 700; } .x { font-family: ${mono}; @include m; } @mixin m { font-weight: 400; }`,
            },
            ['libs/w9/c.scss:1 font-weight: 700'],
        ],
        [
            {
                'libs/w9/c.scss': `@mixin m { font-weight: 700; } @mixin m { font-weight: 400; } .x { font-family: ${mono}; @include m; }`,
            },
            [],
        ],
        // A mixin body runs the definition in scope where it is included.
        [
            {
                'libs/w9/c.scss': `@mixin m { font-weight: 700 !important; }\n@mixin m { font-weight: 400; }\n@mixin outer { @include m; }\n.x { font-family: ${mono}; @include outer; }`,
            },
            [],
        ],
        [
            {
                'libs/w9/c.scss': `@mixin m { font-weight: 700; }\n@mixin outer { @include m; }\n.x { font-family: ${mono}; @include outer; }\n@mixin m { font-weight: 400; }\n.y { font-family: Roboto; @include outer; }`,
            },
            ['libs/w9/c.scss:1 font-weight: 700'],
        ],
        [
            {
                ...heavy,
                'libs/w9/c.scss': `@use 'type' as *;\n@mixin outer { @include heavy; }\n.x { font-family: ${mono}; @include outer; }\n@mixin heavy { font-weight: 400; }`,
            },
            imported,
        ],
        [
            {
                ...heavy,
                'libs/w9/c.scss': `@use 'type' as *;\n@mixin outer { @include heavy; }\n@mixin heavy { font-weight: 400; }\n.x { font-family: ${mono}; @include outer; }`,
            },
            [],
        ],
        // Where it is included both before and after a local definition,
        // each include runs its own.
        [
            {
                ...heavy,
                'libs/w9/c.scss': `@use 'type' as *;\n@mixin outer { @include heavy; }\n.x { font-family: ${mono}; @include outer; }\n@mixin heavy { font-weight: 400; }\n.y { font-family: Roboto; @include outer; }`,
            },
            imported,
        ],
        [
            {
                'libs/w9/_firm.scss':
                    '@mixin heavy { font-weight: 700 !important; }',
                'libs/w9/c.scss': `@use 'firm' as *;\n@mixin outer { @include heavy; }\n.x { font-family: Roboto; @include outer; }\n@mixin heavy { font-weight: 400; }\n.y { font-family: ${mono}; @include outer; }`,
            },
            [],
        ],
        [
            {
                'libs/w9/c.scss': `@mixin w { @content; font-weight: 400; }\n@mixin outer { @include w { font-weight: 700; } }\n.x { font-family: ${mono}; @include outer; }\n@mixin w { font-weight: 400; @content; }\n.y { font-family: Roboto; @include outer; }`,
            },
            [],
        ],
        // A call in a definition that does not run passes nothing.
        [
            {
                'libs/w9/c.scss': `@mixin w($weight) { font-weight: $weight; }\n@mixin m { @include w($weight: 700); }\n@mixin outer { @include m; }\n.x { font-family: Roboto; @include outer; }\n@mixin m { @include w($weight: 400); }\n.y { font-family: ${mono}; @include outer; }`,
            },
            [],
        ],
        // Included from another module, once its own module has run.
        [
            {
                ...heavy,
                'libs/w9/_c.scss':
                    "@use 'type' as *;\n@mixin outer { @include heavy; }\n@mixin heavy { font-weight: 400; }",
                'libs/w9/d.scss': `@use 'c'; .x { font-family: ${mono}; @include c.outer; }`,
            },
            [],
        ],
        [
            {
                ...heavy,
                'libs/w9/_c.scss':
                    "@use 'type' as *;\n@mixin outer { @include heavy; }",
                'libs/w9/d.scss': `@use 'c'; .x { font-family: ${mono}; @include c.outer; }`,
            },
            imported,
        ],
        // A content block goes where that definition places `@content`.
        [
            {
                'libs/w9/c.scss': `@mixin w { @content; font-weight: 500; } .x { font-family: ${mono}; @include w { font-weight: 700; } } @mixin w { font-weight: 500; @content; }`,
            },
            [],
        ],
        // Another module sees the last definition only.
        [
            {
                'libs/w9/_t.scss': `@mixin m { font-family: ${mono}; }\n@mixin m { font-weight: 700; }`,
                'libs/w9/c.scss': "@use 't'; .x { @include t.m; }",
            },
            [],
        ],
        [
            {
                'libs/w9/_t.scss':
                    '@mixin m { font-weight: 700; }\n@mixin m { font-weight: 400; }',
                'libs/w9/c.scss': `@use 't'; .x { font-family: ${mono}; @include t.m; }`,
            },
            [],
        ],
        [
            {
                'libs/w9/_t.scss':
                    '@mixin m { font-weight: 400; }\n@mixin m { font-weight: 700; }',
                'libs/w9/c.scss': `@use 't'; .x { font-family: ${mono}; @include t.m; }`,
            },
            ['libs/w9/_t.scss:2 font-weight: 700'],
        ],
        [
            {
                'libs/w9/_p.scss':
                    '@mixin m { font-weight: 700 !important; }\n@mixin outer { @include m; }\n.p { @include outer; }\n@mixin m { font-weight: 400; }',
                'libs/w9/d.scss': `@use 'p'; .x { font-family: ${mono}; @include p.outer; }`,
            },
            [],
        ],
    ]) {
        assert.deepEqual(workspace(files), expected, JSON.stringify(files));
    }
});

test('caps a parameter only with what calls in JetBrains Mono rules pass', () => {
    const mono = "'JetBrains Mono'";
    const w = (fallback) => ({
        'libs/w10/_m.scss': `@mixin w($weight: ${fallback}) { font-weight: $weight; }`,
    });
    const hops = {
        'libs/w10/_p.scss':
            '@mixin inner($weight) { font-weight: $weight; }\n@mixin outer($w: 400) { @include inner($weight: $w); }',
    };
    for (const [files, expected] of [
        // A call in a Roboto rule passes its own weight.
        [
            {
                ...w(400),
                'libs/w10/c.scss': `@use 'm';\n.a { font-family: ${mono}; @include m.w($weight: 400); }\n.b { font-family: Roboto; @include m.w($weight: 700); }`,
            },
            [],
        ],
        [
            {
                'libs/w10/c.scss': `@mixin w($weight: 400) { font-weight: $weight; }\n.a { font-family: ${mono}; @include w($weight: 400); }\n.b { font-family: Roboto; @include w($weight: 700); }`,
            },
            [],
        ],
        // Its default counts where a JetBrains Mono call leaves it out.
        [
            {
                ...w(700),
                'libs/w10/c.scss': `@use 'm';\n.a { font-family: ${mono}; @include m.w($weight: 400); }\n.b { font-family: Roboto; @include m.w; }`,
            },
            [],
        ],
        [
            {
                ...w(700),
                'libs/w10/c.scss': `@use 'm';\n.a { font-family: ${mono}; @include m.w; }\n.b { font-family: Roboto; @include m.w($weight: 400); }`,
            },
            ['libs/w10/_m.scss:1 $weight: 700'],
        ],
        // Through a mixin that passes its own parameter on.
        [
            {
                ...hops,
                'libs/w10/c.scss': `@use 'p';\n.a { font-family: ${mono}; @include p.outer($w: 400); }\n.b { font-family: Roboto; @include p.outer($w: 700); }`,
            },
            [],
        ],
        [
            {
                ...hops,
                'libs/w10/c.scss': `@use 'p';\n.a { font-family: ${mono}; @include p.outer($w: 700); }\n.b { font-family: Roboto; @include p.outer($w: 400); }`,
            },
            ['libs/w10/c.scss:2 $w: 700'],
        ],
        // A call's family named through a variable, resolved.
        [
            {
                ...w(400),
                'libs/w10/c.scss': `@use 'm';\n:root { --f: ${mono}; }\n.a { font-family: var(--f); @include m.w($weight: 700); }`,
            },
            ['libs/w10/c.scss:3 $weight: 700'],
        ],
        [
            {
                ...w(400),
                'libs/w10/c.scss': `@use 'm';\n:root { --f: Roboto; }\n.a { font-family: var(--f); @include m.w($weight: 700); }\n.b { font-family: ${mono}; @include m.w($weight: 400); }`,
            },
            [],
        ],
        // Or once a keyframe that sets another family for a while ends.
        [
            {
                ...w(400),
                'libs/w10/c.scss': `@use 'm';\n:root { --f: ${mono}; }\n@keyframes swap { from { font-family: Roboto; } }\n.a { font-family: var(--f); animation: swap 1s; @include m.w($weight: 700); }`,
            },
            ['libs/w10/c.scss:4 $weight: 700'],
        ],
    ]) {
        assert.deepEqual(workspace(files), expected, JSON.stringify(files));
    }
});

test("inherits the document root's family", () => {
    const mono = "'JetBrains Mono'";
    const media = '@media (min-width: 1px)';
    const report = (body) =>
        findOffScaleWeights('libs/s10/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        [
            `html { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:root { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `body { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:host { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // `*` sets each element itself, over what it inherits.
        [
            `* { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `* { font-family: ${mono}; } .p { font-family: Roboto; .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `* { font-family: Roboto; } html { font-family: ${mono}; } .x { font-weight: 700; }`,
            [],
        ],
        [
            `body { font-family: inherit; } html { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // A nearer family wins, and `:host(.dark)` is no plain host.
        [
            `html { font-family: ${mono}; } body { font-family: Roboto; } .x { font-weight: 700; }`,
            [],
        ],
        [
            `html { font-family: ${mono}; } .x { font-family: Roboto; font-weight: 700; }`,
            [],
        ],
        [
            `body { font-family: ${mono}; } .p { font-family: Roboto; .x { font-weight: 700; } }`,
            [],
        ],
        [`:host(.dark) { font-family: ${mono}; } .x { font-weight: 700; }`, []],
        // A root in the reader's `@media` applies with it; one in another
        // context does not always.
        [
            `${media} { html { font-family: ${mono}; } .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `html { font-family: Roboto; } ${media} { html { font-family: ${mono}; } .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { * { font-family: ${mono}; } .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { html { font-family: ${mono}; } } .x { font-weight: 700; }`,
            [],
        ],
        // There, the cascade picks the root's family: a later rule, or a
        // `:root` over `html` on the one root element, unless `!important`.
        [
            `:root { font-family: ${mono}; } ${media} { :root { font-family: Roboto; } .x { font-weight: 700; } }`,
            [],
        ],
        [
            `${media} { :root { font-family: Roboto; } } :root { font-family: ${mono}; } ${media} { .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `html { font-family: ${mono}; } ${media} { :root { font-family: Roboto; } .x { font-weight: 700; } }`,
            [],
        ],
        [
            `:root { font-family: Roboto; } html { font-family: ${mono}; } .x { font-weight: 700; }`,
            [],
        ],
        [
            `:root { font-family: ${mono} !important; } ${media} { :root { font-family: Roboto; } .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `html { font-family: ${mono}; } ${media} { html { font-family: inherit; } .x { font-weight: 700; } }`,
            [],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads a static Sass interpolation in a family as Sass writes it', () => {
    const report = (body) =>
        findOffScaleWeights('libs/s11/c.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        [`.x { font-family: #{'JetBrains'} Mono; font-weight: 700; }`, true],
        [`.x { font-family: #{"JetBrains Mono"}; font-weight: 700; }`, true],
        [`.x { font-family: #{JetBrains} Mono; font-weight: 700; }`, true],
        [`.x { font-family: '#{JetBrains} Mono'; font-weight: 700; }`, true],
        [`.x { font-family: Jet#{'Brains'} Mono; font-weight: 700; }`, true],
        [
            `.x { font-family: #{'Jet' + 'Brains'} Mono; font-weight: 700; }`,
            true,
        ],
        [
            `.x { font-family: #{null}#{'JetBrains Mono'}; font-weight: 700; }`,
            true,
        ],
        [
            `.x { font-family: #{'JetBrains'} #{'Mono'}, monospace; font-weight: 700; }`,
            true,
        ],
        [`.x { font: 12px #{'JetBrains'} Mono; font-weight: 700; }`, true],
        [
            `$f: #{'JetBrains'} Mono; .x { font-family: $f; font-weight: 700; }`,
            true,
        ],
        // Its strings' escapes decoded as Sass unquotes them.
        [
            `.x { font-family: #{'JetBrains\\20 Mono'}; font-weight: 700; }`,
            true,
        ],
        [
            `.x { font-family: #{"JetBrains\\20 Mono"}; font-weight: 700; }`,
            true,
        ],
        [
            `.x { font-family: #{'Jet' + 'Brains\\20 Mono'}; font-weight: 700; }`,
            true,
        ],
        [
            `.x { font-family: #{"JetBrains\\" Mono"}; font-weight: 700; }`,
            false,
        ],
        // A quote it writes out opens a string the browser never closes.
        [
            `.x { font-family: #{'JetBrains Mono\\', x'}; font-weight: 700; }`,
            false,
        ],
        // A string it writes out can hold the whole list.
        [
            `.x { font-family: #{'JetBrains Mono, monospace'}; font-weight: 700; }`,
            true,
        ],
        // Spaced operands are a list: `Jet Brains` is another face.
        [`.x { font-family: #{'Jet' 'Brains'}; font-weight: 700; }`, false],
        [`.x { font-family: #{'Roboto'}; font-weight: 700; }`, false],
        // One that calls a function is left to its value.
        [
            `.x { font-family: #{fn('JetBrains')} Mono; font-weight: 700; }`,
            false,
        ],
    ]) {
        assert.deepEqual(
            report(source),
            expected ? ['font-weight: 700'] : [],
            source
        );
    }
});

test('reads a complex rule as a base of the narrower ones it reaches', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s11/e.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // Compound by compound, last to last, each contained in the reader's.
        [
            `.parent .x { font-family: ${mono}; } .parent .x:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.parent .x { font-family: ${mono}; } .w .parent .x:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.parent .x { font-family: ${mono}; } .parent.on .x.a { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.p .x { font-family: ${mono}; } .z .x:hover { font-weight: 700; }`,
            [],
        ],
        // A descendant across `>` or ` ` chains, `~` across `+` or `~`.
        [
            `.a .b { font-family: ${mono}; } .a > .b.c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.p .x { font-family: ${mono}; } .p .q .x:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.a ~ .b { font-family: ${mono}; } .a + .b.c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [`.a > .b { font-family: ${mono}; } .a .b.c { font-weight: 700; }`, []],
        [
            `.a + .b { font-family: ${mono}; } .a ~ .b.c { font-weight: 700; }`,
            [],
        ],
        [
            `.a > .b { font-family: ${mono}; } .a > .q > .b { font-weight: 700; }`,
            [],
        ],
        [
            `.a + .b { font-family: ${mono}; } .a + .q + .b { font-weight: 700; }`,
            [],
        ],
        // Every place a span allows, not only the nearest match.
        [
            `.a > .b .x { font-family: ${mono}; } .a > .b .b .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.a + .b ~ .x { font-family: ${mono}; } .a + .b ~ .b ~ .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.a .b .c .x { font-family: ${mono}; } .a .c .b .x { font-weight: 700; }`,
            [],
        ],
        // A simple selector however it is spelled.
        [
            `.x { font-family: ${mono}; } [class~="x"] { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `#x { font-family: ${mono}; } [id="x"] { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `[ data-a = '1' ] { font-family: ${mono}; } [data-a="1"].on { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `div { font-family: ${mono}; } DIV.x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // Chromium matches an SVG type in any case, too.
        [
            `foreignobject { font-family: ${mono}; } foreignObject { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [`[class="x"] { font-family: ${mono}; } .x { font-weight: 700; }`, []],
        // As an ancestor's rule, and ranked in the cascade.
        [
            `.parent .x { font-family: ${mono}; } .parent .x:hover .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } .x.on .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.parent .x { font-family: ${mono}; } .parent .x:hover { font-family: Roboto; font-weight: 700; }`,
            [],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads a keyframe where a rule runs it, over its own', () => {
    const mono = "'JetBrains Mono'";
    const run = 'animation: k 1ms steps(1) forwards;';
    const report = (body) =>
        findOffScaleWeights('libs/s11/f.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // A family or weight a keyframe sets, where a rule runs it.
        [
            `.x { ${run} font-weight: 700; } @keyframes k { to { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; ${run} } @keyframes k { to { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { animation-name: k; font-weight: 700; } @keyframes k { to { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `.p { ${run} } .p .x { font-weight: 700; } @keyframes k { to { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        // Over the rule's own declarations, under `!important` ones.
        [
            `.x { font-family: Roboto; ${run} font-weight: 700; } @keyframes k { to { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: Roboto !important; ${run} font-weight: 700; } @keyframes k { to { font-family: ${mono}; } }`,
            [],
        ],
        [
            `.x { font-family: ${mono}; font-weight: 500 !important; ${run} } @keyframes k { to { font-weight: 700; } }`,
            [],
        ],
        // Whatever the order or specificity of the rule's own.
        [
            `.x { ${run} font-family: Roboto; font-weight: 700; } @keyframes k { to { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; ${run} font-weight: 500; } @keyframes k { to { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { ${run} } .x.y { font-family: Roboto; font-weight: 700; } @keyframes k { to { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { ${run} } .x.y { font-family: Roboto !important; font-weight: 700; } @keyframes k { to { font-family: ${mono}; } }`,
            [],
        ],
        // One that does not hold a frame is read both while it runs and after.
        [
            `.x { font-family: ${mono}; font-weight: 700; animation: k 1ms; } @keyframes k { to { font-family: Roboto; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: Roboto; font-weight: 700; animation: k 1ms; } @keyframes k { to { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; font-weight: 500; animation: k 1ms; } @keyframes k { to { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        // The keyframes it runs: the last definition, the last declaration,
        // a name rather than a keyword, and any for one read from a variable.
        [
            `@keyframes k { to { font-family: ${mono}; } } @keyframes k { to { opacity: 0.5; } } .x { ${run} font-weight: 700; }`,
            [],
        ],
        [
            `@keyframes k { to { opacity: 0.5; } } @keyframes k { to { font-family: ${mono}; } } .x { ${run} font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { ${run} animation: fade 1ms forwards; font-weight: 700; } @keyframes k { to { font-family: ${mono}; } } @keyframes fade { to { opacity: 0.5; } }`,
            [],
        ],
        [
            `@keyframes linear { to { font-family: ${mono}; } } .x { animation: fade 1ms linear forwards; font-weight: 700; } @keyframes fade { to { opacity: 0.5; } }`,
            [],
        ],
        [
            `.x { --n: k; animation: var(--n) 1ms forwards; font-weight: 700; } @keyframes k { to { font-family: ${mono}; } }`,
            ['font-weight: 700'],
        ],
        [
            `@keyframes linear { to { font-family: ${mono}; } } .x { animation: linear fade 1ms forwards; font-weight: 700; } @keyframes fade { to { opacity: 0.5; } }`,
            [],
        ],
        [
            `@keyframes k { to { font-family: ${mono}; font-weight: 600; } } @keyframes k { to { opacity: 0.5; } }`,
            [],
        ],
        // One that holds its frame replaces the rule's own after it, too.
        [
            `.x { font-family: ${mono}; font-weight: 700; ${run} } @keyframes k { to { font-family: Roboto; } }`,
            [],
        ],
        // Only the keyframes it names; a step's own family meets its weight,
        // wherever it is run from.
        [
            `.x { animation: fade 1ms; font-weight: 700; } @keyframes fade { to { opacity: 0.5; } } @keyframes k { to { font-family: ${mono}; } }`,
            [],
        ],
        [
            `@keyframes k { to { font-family: ${mono}; font-weight: 600; } }`,
            ['font-weight: 600'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads an `@at-root` rule where Sass writes it out', () => {
    const mono = "'JetBrains Mono'";
    const media = '@media (min-width: 1px)';
    const report = (body) =>
        findOffScaleWeights('libs/s11/d.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // At the root, by its own selector: its source parent is no ancestor.
        [
            `.x { font-family: ${mono}; @at-root .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [`.x { font-family: ${mono}; @at-root .y { font-weight: 700; } }`, []],
        [
            `.x { font-family: ${mono}; @at-root { .y { font-weight: 700; } } }`,
            [],
        ],
        [
            `.p { .x { font-family: ${mono}; } @at-root .x { font-weight: 700; } }`,
            [],
        ],
        [
            `.p { font-family: ${mono}; .q { @at-root .x { font-weight: 700; } } }`,
            [],
        ],
        [
            `.x { @at-root .x { font-family: ${mono}; } font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.w { @at-root .p { font-family: ${mono}; } } .p .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // A query leaves out the blocks it names, and only those.
        [
            `.x { font-family: ${mono}; @at-root (without: media) { .c { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; ${media} { @at-root (without: media) { .c { font-weight: 700; } } } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { .x { font-family: ${mono}; @at-root (without: media) { .c { font-weight: 700; } } } }`,
            [],
        ],
        [
            `${media} { .x { font-family: ${mono}; } } ${media} { .p { @at-root (without: media) { .x { font-weight: 700; } } } }`,
            [],
        ],
        [
            `.x { font-family: ${mono}; @at-root (without: rule) { .c { font-weight: 700; } } }`,
            [],
        ],
        [
            `.x { font-family: ${mono}; @at-root (with: rule) { .c { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; ${media} { @at-root (without: all) { .c { font-weight: 700; } } } }`,
            [],
        ],
        [
            `.x { font-family: ${mono}; @at-root (without: media) { .y & { font-weight: 700; } } } .y { font-family: Roboto; }`,
            ['font-weight: 700'],
        ],
        [
            `.p { font-family: ${mono}; .x { @at-root (without: media) { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { .x { @at-root (without: media) { .y & { font-weight: 700; } } } } .y { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        // Its `@media` stays, and a parent it names (`&`) is still one.
        [
            `${media} { .x { font-family: ${mono}; @at-root .x { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; @at-root &.y { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; @at-root .y { .x & { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads `:is()` and `:where()` as the selectors they hold', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s11/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // The same elements written another way, either side.
        [
            `:where(.parent .child) { font-family: ${mono}; } .parent .child { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.parent .child { font-family: ${mono}; } :where(.parent .child) { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:is(.a .b, .c) { font-family: ${mono}; } .a .b { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:is(.a .b, .c) { font-family: ${mono}; } .c:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:where(.a .b) { font-family: ${mono}; } .z .b { font-weight: 700; }`,
            [],
        ],
        // In any compound; whole selectors first or after a descendant
        // combinator, where they read as elements it matches.
        [
            `:where(.parent) .child { font-family: ${mono}; } .parent .child { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x :where(.p, .q) .c { font-family: ${mono}; } .x .q .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x :is(.a .b) { font-family: ${mono}; } .x .a .b { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x .a .b { font-family: ${mono}; } .x :is(.a .b) { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x > :is(.a .b) { font-family: ${mono}; } .x > .a .b { font-weight: 700; }`,
            [],
        ],
        // Beside other simples, which join its selectors' last compound.
        [
            `:where(.parent .child).active { font-family: ${mono}; } .parent .child.active { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.parent .child.active { font-family: ${mono}; } :where(.parent .child).active { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x :is(.a .b).on { font-family: ${mono}; } .x .a .b.on { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `span:where(.p .c) { font-family: ${mono}; } .p span.c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `*:where(.p .c) { font-family: ${mono}; } .p .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:is(.p .c, .d).on { font-family: ${mono}; } .d.on { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x > :is(.a .b).on { font-family: ${mono}; } .x > .a .b.on { font-weight: 700; }`,
            [],
        ],
        // Through wrappers nested in each other, however deep.
        [
            `:where(:is(.parent .child)) { font-family: ${mono}; } .parent .child { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.parent .child { font-family: ${mono}; } :where(:is(.parent .child)) { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:is(:where(.a .b), .c) .d { font-family: ${mono}; } .a .b .d { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:where(:is(:where(.p .c))).on { font-family: ${mono}; } .p .c.on { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x > :where(:is(.a .b)) { font-family: ${mono}; } .x > .a .b { font-weight: 700; }`,
            [],
        ],
        // An unclosed one cannot be read, but its rule's weight still is.
        [`.x:not(.a { font-weight: 650; }`, ['font-weight: 650']],
        // Specificity counts through them too: `#a` outranks the later `.x`.
        [
            `:is(:is(:is(#a))) { font-family: ${mono}; } .x { font-family: Roboto; } #a.x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // Ranked with its own specificity: `:where()` counts nothing.
        [
            `.parent .child { font-family: Roboto; } :where(.parent .child) { font-family: ${mono}; } .parent .child { font-weight: 700; }`,
            [],
        ],
        [
            `.parent .child { font-family: ${mono}; } :is(.parent .child) { font-family: Roboto; } .parent .child { font-weight: 700; }`,
            [],
        ],
        // As an ancestor or the document root.
        [
            `:where(.a .p) { font-family: ${mono}; } .a .p .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.p { font-family: ${mono}; } :where(.p .c) { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:where(html) { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads ancestors and bases as compiled, in their context', () => {
    const mono = "'JetBrains Mono'";
    const media = '@media (min-width: 1px)';
    const report = (body) =>
        findOffScaleWeights('libs/s11/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // An ancestor in the same `@media`, or one that always applies.
        [
            `${media} { .parent { font-family: ${mono}; } .parent .child { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.parent { font-family: ${mono}; } ${media} { .parent .child { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { .parent { font-family: ${mono}; } } .parent .child { font-weight: 700; }`,
            [],
        ],
        // A family whose conditions are all the reader's applies there too,
        // in any order; one under a further condition does not.
        [
            `${media} { .x { font-family: ${mono}; } @supports (display: grid) { .x { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
        [
            `@supports (display: grid) { .x { font-family: ${mono}; } } ${media} { @supports (display: grid) { .x { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { html { font-family: ${mono}; } @supports (display: grid) { .x { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
        [
            `@if $c { .x { font-family: ${mono}; } @if $d { .x { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { @supports (display: grid) { .x { font-family: ${mono}; } } .x { font-weight: 700; } }`,
            [],
        ],
        // Conditions compare however they are spaced or cased.
        [
            `${media} { .x { font-family: ${mono}; } } @media (min-width:1px) { @supports (display: grid) { .x { font-weight: 700; } } }`,
            ['font-weight: 700'],
        ],
        [
            `@MEDIA ( min-width : 1px ) { .x { font-family: ${mono}; } } ${media} { .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { .x { font-family: ${mono}; } } @media (min-width: 2px) { .x { font-weight: 700; } }`,
            [],
        ],
        // Quoted text in a condition is kept as written.
        [
            `@container style(--t: "a, b") { .x { font-family: ${mono}; } } @container style(--t: "a,b") { .x { font-weight: 700; } }`,
            [],
        ],
        [
            `@container style(--t: "a, b") { .x { font-family: ${mono}; } } @container style( --t : "a, b" ) { .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        // A parent after a prefix (`.x &`) names more ancestors, read once
        // the parent itself (the same element) sets no family.
        [
            `.y { .x & { font-weight: 700; } } .x { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        [
            `.y { font-family: Roboto; .x & { font-weight: 700; } } .x { font-family: ${mono}; }`,
            [],
        ],
        [
            `.x { font-family: ${mono}; } .w .y { .x & { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        // The ancestor's family is the cascade's winner there.
        [
            `.parent { font-family: ${mono}; } ${media} { .parent { font-family: Roboto; } .parent .child { font-weight: 700; } }`,
            [],
        ],
        [
            `${media} { .parent { font-family: Roboto; } } .parent { font-family: ${mono}; } ${media} { .parent .child { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.w .parent { font-family: Roboto; } .parent { font-family: ${mono}; } .w .parent .child { font-weight: 700; }`,
            [],
        ],
        // A nested selector's ancestors, as compiled, by whole selector or by
        // their own compound, nearest first.
        [
            `.wrapper { .parent .child { font-weight: 700; } } .parent { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        [
            `.wrapper { .parent { font-family: ${mono}; } .parent .child { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.wrapper .parent { font-family: ${mono}; } .wrapper { .parent .child { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.w { font-family: Roboto; .p .c { font-weight: 700; } } .w .p { font-family: ${mono}; }`,
            ['font-weight: 700'],
        ],
        // A base outside a `@media` reaches into it, not the other way.
        [
            `.x { font-family: ${mono}; } ${media} { .x { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: ${mono}; } ${media} { .x:hover { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { .x { font-family: ${mono}; } .x:hover { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { .x { font-family: ${mono}; } } .x:hover { font-weight: 700; }`,
            [],
        ],
        // The parent of `&:hover` is the same element: its family beats an
        // ancestor's, and `*`.
        [
            `.p { font-family: Roboto; } .p .x { font-family: ${mono}; &:hover { font-weight: 700; } }`,
            ['font-weight: 700'],
        ],

        [
            `.x { font-family: ${mono}; &:hover { font-weight: 700; } } * { font-family: Roboto; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads an explicit `inherit` of a non-inheriting registered property', () => {
    const mono = "'JetBrains Mono'";
    const read = 'font-family: var(--face); font-weight: 700;';
    const registered =
        "@property --face { syntax: '*'; inherits: false; initial-value: Roboto; }";
    const report = (body) =>
        findOffScaleWeights('libs/s11/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // `inherit` takes the parent's value; `unset` gives the initial one.
    for (const [own, expected] of [
        ['--face: inherit;', ['font-weight: 700']],
        ['--face: unset;', []],
        ['', []],
    ]) {
        assert.deepEqual(
            report(
                `${registered} body { --face: ${mono}; } .x { ${own} ${read} }`
            ),
            expected,
            own
        );
    }
    // Another rule's `inherit` is not the reader's.
    assert.deepEqual(
        report(
            `${registered} body { --face: ${mono}; } .y { --face: inherit; } .x { ${read} }`
        ),
        []
    );
});

test("picks the cascade's winner among the rules on an element", () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s12/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // `!important`, then specificity, then source order, over the element's
    // own rule, the bases it contains and `*`.
    for (const [source, expected] of [
        [
            `.x { font-family: ${mono}; } .y { font-family: Roboto; } .x.y { font-weight: 700; }`,
            [],
        ],
        [
            `.y { font-family: Roboto; } .x { font-family: ${mono}; } .x.y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `div { font-family: ${mono}; } .x { font-family: Roboto; } div.x:hover { font-weight: 700; }`,
            [],
        ],
        [
            `.x { font-family: Roboto; } div { font-family: ${mono}; } div.x:hover { font-weight: 700; }`,
            [],
        ],
        [
            `.x { font-family: ${mono}; } .x.active { font-family: Roboto; } .x.active:hover { font-weight: 700; }`,
            [],
        ],
        [
            `.x { font-family: ${mono} !important; } .x.active { font-family: Roboto; } .x.active:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x:hover { font-family: Roboto; font-weight: 700; } .x { font-family: ${mono}; }`,
            [],
        ],
        [
            `.x:hover { font-weight: 700; } .x { font-family: ${mono}; } * { font-family: Roboto; }`,
            ['font-weight: 700'],
        ],
        [
            `* { font-family: ${mono}; } .x { font-family: Roboto; } .x:hover { font-weight: 700; }`,
            [],
        ],
        // A rule's place is where its winning declaration is.
        [
            `.x { font-family: ${mono}; } .y { font-family: Roboto; } .x { font-family: ${mono}; } .x.y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // An id outranks any number of classes; `:is()` takes its most
        // specific argument.
        [
            `#a { font-family: Roboto; } .x { font-family: ${mono}; } #a.x { font-weight: 700; }`,
            [],
        ],
        [
            `:is(.x, #y) { font-family: Roboto; } .x { font-family: ${mono}; } .x:hover { font-weight: 700; }`,
            [],
        ],
        // `:nth-child(… of S)` counts `S` too, besides itself; nested
        // `:is()`/`:where()` open.
        [
            `:nth-child(1 of #i) { font-family: ${mono}; } #j { font-family: Roboto; } #j:nth-child(1 of #i) { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x:nth-child(1 of #item) { font-family: ${mono}; } .x.y { font-family: Roboto; } .x.y:nth-child(1 of #item):hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:is(:where(.x)) { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:is(.a, :where(.x, .y)) { font-family: ${mono}; } .y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // A reader's own `:where()`/`:is()` opens too.
        [
            `.x { font-family: ${mono}; } :where(.x) { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.y { font-family: ${mono}; } :is(.x, .y) { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [`.z { font-family: ${mono}; } :is(.x, .y) { font-weight: 700; }`, []],
        // More than 16 ways to read one is left unopened.
        [
            `:is(.a, .b, .c, .d, .e):is(.f, .g, .h, .i) { font-family: ${mono}; } .a.f { font-weight: 700; }`,
            [],
        ],
        // `:where()` and `:is()` open into their selectors; `:where()`
        // counts nothing toward specificity.
        [
            `:where(.x) { font-family: ${mono}; } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `:where(.x) { font-family: ${mono}; } .x { font-family: Roboto; font-weight: 700; }`,
            [],
        ],
        [
            `.x { font-family: Roboto; } :where(.x) { font-family: ${mono}; } .x:hover { font-weight: 700; }`,
            [],
        ],
        [
            `:is(.x, .y) { font-family: ${mono}; } .y { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [`:is(.x, .y) { font-family: ${mono}; } .z { font-weight: 700; }`, []],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('follows `@extend` through extenders and inside `@media`', () => {
    const mono = "'JetBrains Mono'";
    const media = '@media (min-width: 1px)';
    const report = (body) =>
        findOffScaleWeights('libs/s12/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        [
            `%mono { font-family: ${mono}; } %base { @extend %mono; } .x { @extend %base; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // Inside a `@media`, an `@extend` reaches only the same `@media`; from
        // outside, it reaches into one.
        [
            `${media} { %mono { font-family: ${mono}; } .x { @extend %mono; font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `${media} { %mono { font-family: ${mono}; } } .x { @extend %mono; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `%mono { font-family: ${mono}; } ${media} { .x { @extend %mono; font-weight: 700; } }`,
            [],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads cascade layers as always applying, ranked by layer', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s13/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // A layer is no condition. An unlayered declaration beats a layered one
    // whatever its specificity or place; `!important` turns that round.
    for (const [source, expected] of [
        // `revert-layer` rolls the cascade back past its own layer.
        [
            `@layer base { .x { font-family: ${mono}; } } @layer theme { .x { font-family: revert-layer; font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `@layer base { .x { font-family: ${mono}; } } @layer theme { .x { all: revert-layer; font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `@layer base { .x { font-family: ${mono}; } } .x { font-family: revert-layer; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `@layer base { .x { font-family: ${mono}; } } @layer theme { .x { font-family: Roboto; } } @layer top { .x { font-family: revert-layer; font-weight: 700; } }`,
            [],
        ],
        [
            `@layer base { .x { font-family: ${mono}; } } @layer theme { .x { font-family: revert-layer; } } @layer top { .x { font-family: revert-layer; font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `@layer base { .x { font-family: ${mono}; } } @layer theme { .x { font-family: Roboto; font-family: revert-layer; font-weight: 700; } }`,
            ['font-weight: 700'],
        ],
        [
            `@layer base { .x { font-family: ${mono}; } } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `@layer base { .x { font-family: ${mono}; } } .x:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `@layer base { .p { font-family: ${mono}; } } .p .c { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { font-family: Roboto; } @layer base { .x { font-family: ${mono}; } } .x:hover { font-weight: 700; }`,
            [],
        ],
        [
            `@layer base { .d.e { font-family: ${mono}; } } .d { font-family: Roboto; } .d.e:hover { font-weight: 700; }`,
            [],
        ],
        [
            `@layer base { .x { font-family: ${mono} !important; } } .x { font-family: Roboto !important; } .x:hover { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // Named layers rank in declared order (`@layer a, b;`, else as they
        // first appear), later winning; `!important` reverses it.
        [
            `@layer theme, base; @layer base { .x { font-family: ${mono}; } } @layer theme { .x { font-family: Roboto; } } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `@layer base, theme; @layer base { .x { font-family: ${mono}; } } @layer theme { .x { font-family: Roboto; } } .x { font-weight: 700; }`,
            [],
        ],
        [
            `@layer theme, base; @layer base { .x { font-family: ${mono} !important; } } @layer theme { .x { font-family: Roboto !important; } } .x { font-weight: 700; }`,
            [],
        ],
        [
            `@layer one { .x { font-family: Roboto; } } @layer two { .x { font-family: ${mono}; } } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `@layer { .x { font-family: Roboto; } } @layer two { .x { font-family: ${mono}; } } .x { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // A nested layer ranks with its top-level layer.
        [
            `@layer a, c; @layer a { @layer b { .x { font-family: ${mono}; } } } @layer c { .x { font-family: Roboto; } } .x { font-weight: 700; }`,
            [],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('ranks nested and unnamed cascade layers by their full place', () => {
    const mono = "'JetBrains Mono'";
    const weight = '.x { font-weight: 700; }';
    const report = (body) =>
        findOffScaleWeights('libs/s14/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // Sublayers rank in their declared order within their layer.
        [
            `@layer base { @layer theme, fonts; @layer fonts { .x { font-family: ${mono}; } } @layer theme { .x { font-family: Roboto; } } } ${weight}`,
            ['font-weight: 700'],
        ],
        [
            `@layer base { @layer fonts, theme; @layer fonts { .x { font-family: ${mono}; } } @layer theme { .x { font-family: Roboto; } } } ${weight}`,
            [],
        ],
        // Each unnamed layer is its own, the later winning.
        [
            `@layer named { .x { font-family: ${mono}; } } @layer { .x { font-family: Roboto; } } ${weight}`,
            [],
        ],
        [
            `@layer { .x { font-family: Roboto; } } @layer { .x { font-family: ${mono}; } } ${weight}`,
            ['font-weight: 700'],
        ],
        [
            `@layer { .x { font-family: ${mono}; } } @layer { .x { font-family: Roboto; } } ${weight}`,
            [],
        ],
        // A layer's own declarations beat its sublayers', `!important` the
        // other way; `x.y` is a sublayer of `x`.
        [
            `@layer p { .x { font-family: ${mono}; } @layer q { .x { font-family: Roboto; } } } ${weight}`,
            ['font-weight: 700'],
        ],
        [
            `@layer p { .x { font-family: ${mono} !important; } @layer q { .x { font-family: Roboto !important; } } } ${weight}`,
            [],
        ],
        [
            `@layer x.y { .x { font-family: Roboto; } } @layer x { .x { font-family: ${mono}; } } ${weight}`,
            ['font-weight: 700'],
        ],
        // A layer is placed where it first appears, a block with no family
        // or a dotted name (`x.y` places `x`) included.
        [
            `@layer a { .y { color: red; } } @layer b { .x { font-family: Roboto; } } @layer a { .x { font-family: ${mono}; } } ${weight}`,
            [],
        ],
        [
            `@layer x.y, z; @layer z { .x { font-family: Roboto; } } @layer x { .x { font-family: ${mono}; } } ${weight}`,
            [],
        ],
        // However deep: five levels compare as fully as one.
        [
            `@layer a.b.c.d.theme, a.b.c.d.fonts; @layer a.b.c.d.fonts { .x { font-family: ${mono}; } } @layer a.b.c.d.theme { .x { font-family: Roboto; } } ${weight}`,
            ['font-weight: 700'],
        ],
        [
            `@layer a.b.c.d.fonts, a.b.c.d.theme; @layer a.b.c.d.fonts { .x { font-family: ${mono}; } } @layer a.b.c.d.theme { .x { font-family: Roboto; } } ${weight}`,
            [],
        ],
        [
            `@layer a.b.c.d { .x { font-family: ${mono}; } } @layer a.b.c.d.e { .x { font-family: Roboto; } } ${weight}`,
            ['font-weight: 700'],
        ],
        [
            `@layer a.b.c.d { .x { font-family: ${mono} !important; } } @layer a.b.c.d.e { .x { font-family: Roboto !important; } } ${weight}`,
            [],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads an `all` reset as resetting the family and weight', () => {
    const mono = "'JetBrains Mono'";
    const parent = `.parent { font-family: ${mono}; }`;
    const report = (body) =>
        findOffScaleWeights('libs/s15/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    for (const [source, expected] of [
        // `unset` and `revert` inherit the family, `initial` takes the
        // browser's; a later or `!important` family still wins.
        [
            `${parent} .parent .a { font-family: Roboto; all: unset; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `${parent} .parent .a { font-family: Roboto; all: revert; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `${parent} .parent .a { font-family: Roboto; all: initial; font-weight: 700; }`,
            [],
        ],
        [
            `${parent} .parent .a { all: unset; font-family: Roboto; font-weight: 700; }`,
            [],
        ],
        [
            `${parent} .parent .a { font-family: Roboto !important; all: unset; font-weight: 700; }`,
            [],
        ],
        // A weight before it is reset too, unless `!important`; and it resets
        // the family either way.
        [`.a { font-family: ${mono}; font-weight: 700; all: unset; }`, []],
        [
            `.a { font-family: ${mono}; font-weight: 700 !important; all: unset; }`,
            [],
        ],
        [
            `.a { all: unset; font-family: ${mono}; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // An `!important` reset beats a later family, and a later weight
        // unless that is `!important` too.
        [
            `${parent} .parent .a { all: unset !important; font-family: Roboto; font-weight: 700 !important; }`,
            ['font-weight: 700'],
        ],
        [
            `${parent} .parent .a { all: unset !important; font-family: Roboto; font-weight: 700; }`,
            [],
        ],
        // A weight before it is gone even where the family is set again
        // after it, and an earlier `!important` weight outranks a later one.
        [`.a { font-weight: 700; all: unset; font-family: ${mono}; }`, []],
        [
            `.a { font-family: ${mono}; font-weight: 500 !important; font-weight: 700; }`,
            [],
        ],
        // Through a mixin, at its `@include`.
        [
            `@mixin reset { all: unset; } ${parent} .parent .a { font-family: Roboto; font-weight: 700; @include reset; }`,
            [],
        ],
        [
            `@mixin reset { all: unset; } ${parent} .parent .a { font-family: Roboto; @include reset; font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        // Only as a declaration: not in another value or a Sass map.
        [
            `${parent} .parent .a { font-family: Roboto; --token: all: unset; font-weight: 700; }`,
            [],
        ],
        [
            `${parent} .parent .a { font-family: Roboto; $m: (all: unset); font-weight: 700; }`,
            [],
        ],
        [`.a { --face: font-family: ${mono}; font-weight: 700; }`, []],
        [
            `.a { font-family: ${mono}; font-weight: 700; --x: font-weight: 400; }`,
            ['font-weight: 700'],
        ],
        [
            `.a { font-family: ${mono}; font-weight: 700; --t: all: unset; }`,
            ['font-weight: 700'],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('compiles a nested `&` after its parent', () => {
    const mono = "'JetBrains Mono'";
    const report = (body) =>
        findOffScaleWeights('libs/s13/b.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    // `.x { & .child {} }` is `.x .child`, not `.child .x`.
    for (const [source, expected] of [
        [
            `.x { & .child { font-family: ${mono}; } } .x .child .item { font-weight: 700; }`,
            ['font-weight: 700'],
        ],
        [
            `.x { & .child { font-family: ${mono}; } } .child .x .item { font-weight: 700; }`,
            [],
        ],
    ]) {
        assert.deepEqual(report(source), expected, source);
    }
});

test('reads template literals set from code', () => {
    const component = [
        "renderer.setStyle(el, 'font-weight', `65${0}`);",
        'el.style.fontWeight = `${wide ? 750 : 600}`;',
        "el.style.fontWeight = `${'6'}${'50'}`;",
        // An unknown value alone is that value; text around it computes one.
        'el.style.fontWeight = `${weight}`;',
        'el.style.fontWeight = `6${w}`;',
        // A shorthand's other tokens still read as CSS.
        'el.style.font = `${650} 12px Roboto`;',
        'el.style.font = `${w} 12px Roboto`;',
        // So does CSS text in a template.
        'el.style.cssText = `font-weight: 65${0}`;',
        'el.style.fontWeight = `600`;',
        // A number as JavaScript writes it into a string.
        'el.style.fontWeight = `${0x28a}`;',
        // A nested template, or more than 16 texts, is not expanded.
        'el.style.fontWeight = `${`6${5}`}0`;',
        'el.style.fontWeight = `${a ? 6 : 6}${b ? 5 : 5}${c ? 0 : 0}${d ? 0 : 0}${e ? 0 : 0}`;',
    ].join('\n');

    assert.deepEqual(
        findOffScaleWeights('apps/web/src/a.component.ts', component)
            .findings.map(({ line, value, computed }) =>
                computed ? `${line} ${value} (computed)` : `${line} ${value}`
            )
            .sort(),
        [
            '1 650',
            '10 650',
            '11 `${`6${5}`}0` (computed)',
            '12 `${a ? 6 : 6}${b ? 5 : 5}${c ? 0 : 0}${d ? 0 : 0}${e ? 0 : 0}` (computed)',
            '2 750',
            '3 650',
            '5 `6${w}` (computed)',
            '6 650',
            '8 650',
        ]
    );
});

test('reads custom properties as the cascade applies them', () => {
    const read = '.x { font-weight: var(--w); }';
    // A later declaration in the same rule replaces an earlier one.
    assert.deepEqual(
        offScale('libs/m5/a.scss', `:root { --w: 650; --w: 600; } ${read}`),
        []
    );
    for (const rule of [
        ':root { --w: 650 !important; --w: 600; }',
        ':root { --w: 650; @if $a { --w: 600; } }',
    ]) {
        assert.deepEqual(offScale('libs/m5/a.scss', `${rule} ${read}`), [
            '1 --w: 650',
        ]);
    }

    // A fallback stays live unless a rule that reaches the reading rule
    // sets the property: `:root`, the rule itself, an enclosing one, or the
    // component's `:host`.
    const mono =
        "font-family: var(--face, 'JetBrains Mono'); font-weight: 700;";
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const rule = (body) => scanWeights('libs/m5/rule.scss', body);
    assert.deepEqual(report([rule(`.a { --face: Roboto; } .b { ${mono} }`)]), [
        'libs/m5/rule.scss:1 700',
    ]);
    for (const body of [
        `.b { --face: Roboto; ${mono} }`,
        `.a { --face: Roboto; .b { ${mono} } }`,
        `:host { --face: Roboto; } .b { ${mono} }`,
        `html, .theme { --face: Roboto; } .b { ${mono} }`,
        `:where(:root) { --face: Roboto; } .b { ${mono} }`,
        `:is(html, .theme) { --face: Roboto; } .b { ${mono} }`,
        `:host, :host(.x) { --face: Roboto; } .b { ${mono} }`,
        `@media (min-width: 1px) { .b { --face: Roboto; ${mono} } }`,
    ]) {
        assert.deepEqual(report([rule(body)]), []);
    }
    // `body` sits below `html`, so it cannot set a property `html` reads.
    assert.deepEqual(
        report([rule(`body { --face: Roboto; } html { ${mono} }`)]),
        ['libs/m5/rule.scss:1 700']
    );
    assert.deepEqual(
        report([rule(`body { --face: Roboto; } .b { ${mono} }`)]),
        []
    );
    // A definition under a condition, or a host state, may not apply; one
    // the reading declaration shares does.
    assert.deepEqual(
        report([rule(`@if $on { .b { --face: Roboto; ${mono} } }`)]),
        []
    );
    for (const body of [
        `.b { @if $on { --face: Roboto; } ${mono} }`,
        `@media (min-width: 600px) { :root { --face: Roboto; } } .b { ${mono} }`,
        `@if $dark { :root { --face: Roboto; } } .b { ${mono} }`,
        `:host(.light) { --face: Roboto; } .b { ${mono} }`,
        `@media (min-width: #{$bp}) { :root { --face: Roboto; } } .b { ${mono} }`,
    ]) {
        assert.deepEqual(report([rule(body)]), ['libs/m5/rule.scss:1 700']);
    }
    assert.deepEqual(
        report([
            scanWeights('libs/m5/other.scss', ':host { --face: Roboto; }'),
            rule(`.b { ${mono} }`),
        ]),
        ['libs/m5/rule.scss:1 700']
    );
    // The same condition in another file is another rule's condition.
    const media = '@media (min-width: 1px) {';
    assert.deepEqual(
        report([
            scanWeights(
                'libs/m5/other.scss',
                `${media} :root { --face: Roboto; } }`
            ),
            rule(`${media} .b { ${mono} } }`),
        ]),
        ['libs/m5/rule.scss:1 700']
    );
});

test('reads a family Sass assembles from variables', () => {
    const report = (body) =>
        findIndirectWeights([scanWeights('libs/m5/s.scss', body)]).map(
            ({ line, value }) => `${line} ${value}`
        );
    const weight = 'font-weight: 700;';

    assert.deepEqual(
        report(
            `$prefix: JetBrains; .x { font-family: '#{$prefix} Mono'; ${weight} }`
        ),
        ['1 700']
    );
    assert.deepEqual(
        report(
            `$a: 'JetBrains'; $b: Mono; .x { font-family: $a $b, monospace; ${weight} }`
        ),
        ['1 700']
    );
    assert.deepEqual(
        report(
            `$base: JetBrains; $prefix: $base; .x { font-family: '#{$prefix} Mono'; ${weight} }`
        ),
        ['1 700']
    );
    assert.deepEqual(
        report(
            `$prefix: Roboto; .x { font-family: '#{$prefix} Mono'; ${weight} }`
        ),
        []
    );
    // Chains of any length resolve, and a cycle ends.
    assert.deepEqual(
        report(
            `$a: JetBrains; $b: $a; $c: $b; $d: $c; $prefix: $d; .x { font-family: '#{$prefix} Mono'; ${weight} }`
        ),
        ['1 700']
    );
    assert.deepEqual(
        report(`$a: $b; $b: $a; .x { font-family: '#{$a} Mono'; ${weight} }`),
        []
    );
    // A package module's variable cannot be resolved; the name written
    // beside it still counts.
    assert.deepEqual(
        report(
            `@use 'pkg:lib' as lib; $mono: 'JetBrains Mono', lib.$rest; .x { font-family: $mono; ${weight} }`
        ),
        ['1 700']
    );
});

test('resolves family variables in their place in the list', () => {
    const report = (body) =>
        findOffScaleWeights('libs/m8/a.scss', body).findings.map(
            ({ name, value }) => `${name}: ${value}`
        );
    const shorthand = "font: 700 var(--size) var(--face), 'JetBrains Mono';";

    // `var(--size)` is the size; `var(--face)` comes first in the list.
    assert.deepEqual(
        report(`:root { --face: Roboto; --size: 12px; } .x { ${shorthand} }`),
        []
    );
    assert.deepEqual(
        report(
            `:root { --face: 'SF Mono'; --size: 12px; } .x { ${shorthand} }`
        ),
        ['font: 700']
    );
    assert.deepEqual(
        report(
            ":root { --face: Roboto; } .y { font-family: var(--face), 'JetBrains Mono'; font-weight: 700; }"
        ),
        []
    );
    // A comma set apart still ends the entry before it.
    assert.deepEqual(
        report(
            ":root { --face: Roboto; --size: 12px; } .x { font: 700 var(--size) var(--face) , 'JetBrains Mono'; }"
        ),
        []
    );
    // Weight and size from variables: the family follows the size.
    assert.deepEqual(
        report(
            ":root { --weight: 700; --size: 12px; } .x { font: var(--weight) var(--size) 'JetBrains Mono'; }"
        ),
        ['--weight: 700']
    );
    // A whole shorthand from variables, its family a variable too.
    assert.deepEqual(
        report(
            ":root { --size: 16px; --face: 'JetBrains Mono'; --body: 700 var(--size) var(--face); } .x { font: var(--body); }"
        ),
        ['--body: 700']
    );
    // Any branch that can render Mono counts.
    assert.deepEqual(
        report(
            ":root { --face: Roboto; } .z { --face: 'SF Mono'; } .y { font-family: var(--face), 'JetBrains Mono'; font-weight: 700; }"
        ),
        ['font-weight: 700']
    );
});

test('caps a var() branch only where its own family can render Mono', () => {
    const report = (body) =>
        findIndirectWeights([scanWeights('libs/m7/a.scss', body)]).map(
            ({ line, value }) => `${line} ${value}`
        );
    const fallback = "font: var(--f, 500 16px 'JetBrains Mono');";

    assert.deepEqual(
        report(`.a { --f: 700 16px Roboto; } .x { ${fallback} }`),
        []
    );
    assert.deepEqual(
        report(`.a { --f: 700 16px 'JetBrains Mono'; } .x { ${fallback} }`),
        ['1 700']
    );
    assert.deepEqual(
        report(".a { --w: 700; } .x { font: var(--w) 16px 'JetBrains Mono'; }"),
        ['1 700']
    );
    // A whole shorthand from a variable is read as a shorthand.
    assert.deepEqual(
        report(".a { --f: 700 16px 'JetBrains Mono'; } .x { font: var(--f); }"),
        ['1 700']
    );
    // A family the shorthand reads through a variable may be Mono.
    assert.deepEqual(
        report(
            `.a { --face: 'JetBrains Mono'; --f: 700 16px var(--face); } .x { ${fallback} }`
        ),
        ['1 700']
    );
});

test('caps the weights a JetBrains Mono rule reads through variables', () => {
    const mono = "font-family: 'JetBrains Mono'";
    assert.deepEqual(
        offScale(
            'libs/m3/b.scss',
            `$mono-w: 600; .a { ${mono}; font-weight: $mono-w; } .b { font-weight: $mono-w; }`
        ),
        ['1 $mono-w: 600']
    );
    // A `…weight` name is checked where it is declared; the cap adds one
    // finding, and an off-scale value is not reported twice.
    assert.deepEqual(
        offScale(
            'libs/m3/c.scss',
            `$title-weight: 600; .a { ${mono}; font-weight: $title-weight; }`
        ),
        ['1 $title-weight: 600']
    );
    assert.deepEqual(
        offScale(
            'libs/m3/d.scss',
            `$title-weight: 650; .a { ${mono}; font-weight: $title-weight; }`
        ),
        ['1 $title-weight: 650']
    );
    assert.deepEqual(
        offScale(
            'libs/m3/e.scss',
            ".x { --w: 700; } .a { font: var(--w) 12px 'JetBrains Mono'; }"
        ),
        ['1 --w: 700']
    );
    // A `…weight` keyword is not reported again.
    assert.deepEqual(
        offScale(
            'libs/m3/f.scss',
            `$title-weight: bolder; .a { ${mono}; font-weight: $title-weight; }`
        ),
        ['1 $title-weight: bolder']
    );
    // A chain read from both kinds of rule keeps the cap, in either order.
    for (const rules of [
        `.n { font-weight: $a; } .m { ${mono}; font-weight: $a; }`,
        `.m { ${mono}; font-weight: $a; } .n { font-weight: $a; }`,
    ]) {
        assert.deepEqual(
            offScale('libs/m3/g.scss', `$b: 600; $a: $b; ${rules}`),
            ['1 $b: 600']
        );
    }
    // Custom properties set from code, as CSS text or as an expression.
    const host = scanWeights(
        'libs/m3/x.component.ts',
        [
            "host: { '[style.--mono-w]': \"'700'\",",
            "  '[style.--mono-v]': 'wide ? 700 : 500' }",
        ].join('\n')
    );
    const rule = scanWeights(
        'libs/m3/x.component.scss',
        `.a { ${mono}; font-weight: var(--mono-w); } .b { ${mono}; font-weight: var(--mono-v); }`
    );
    assert.deepEqual(
        findIndirectWeights([host, rule])
            .map(({ line, value }) => `${line} ${value}`)
            .sort(),
        ['1 700', '2 700']
    );
});

test('lets every configured load replace a partial default', () => {
    const report = (scans) =>
        findIndirectWeights(scans).map(
            ({ file, line, value }) => `${file}:${line} ${value}`
        );
    const rule = '$w: 650 !default; .t { font-weight: $w; }';
    const tokens = scanWeights('libs/c3/_tokens.scss', rule);
    const load = (file, body) => scanWeights(`libs/c3/${file}`, body);
    const configured = load('a.scss', "@use 'tokens' with ($w: 600);");
    const flagged = ['libs/c3/_tokens.scss:1 650'];

    assert.deepEqual(report([tokens, configured]), []);
    // A quoted `;` or `//` in the configuration is a value.
    assert.deepEqual(
        report([
            tokens,
            load(
                'a.scss',
                "@use 'tokens' with ($asset: 'data:image/svg+xml;utf8,x', $w: 600);"
            ),
        ]),
        []
    );
    assert.deepEqual(
        report([
            tokens,
            load('a.scss', "@use 'tokens' with ($asset: '//cdn/x', $w: 600);"),
        ]),
        []
    );
    assert.deepEqual(
        report([
            tokens,
            load('a.scss', "@use 'tokens' with ($asset: '//cdn/x', $w: 750);"),
        ]),
        ['libs/c3/a.scss:1 750']
    );
    assert.deepEqual(
        report([tokens, configured, load('b.scss', "@use 'tokens';")]),
        flagged
    );
    assert.deepEqual(report([tokens]), flagged);
    // Only a `with (…)` setting that name counts.
    assert.deepEqual(
        report([tokens, load('a.scss', "@use 'tokens' with ($other: 600);")]),
        flagged
    );
    assert.deepEqual(
        report([
            tokens,
            configured,
            load('b.scss', "@use 'tokens'; .x { @include m($w: 600); }"),
        ]),
        flagged
    );
    // A block's own `!default` is not a module setting.
    assert.deepEqual(
        report([
            scanWeights(
                'libs/c3/_local.scss',
                '.t { $w: 650 !default; font-weight: $w; }'
            ),
            load('a.scss', "@use 'local' with ($w: 600);"),
        ]),
        ['libs/c3/_local.scss:1 650']
    );
    // Forwarding cycles end.
    assert.deepEqual(
        report([
            scanWeights('libs/c3/_x.scss', `@forward 'y'; ${rule}`),
            load('_y.scss', "@forward 'x';"),
        ]),
        ['libs/c3/_x.scss:1 650']
    );
    assert.deepEqual(
        report([tokens, load('a.scss', "@use 'tokens' with ($w: null);")]),
        flagged
    );
    // A file that is not a partial may also be compiled on its own.
    assert.deepEqual(
        report([
            scanWeights('libs/c3/entry.scss', rule),
            load('a.scss', "@use 'entry' with ($w: 600);"),
        ]),
        ['libs/c3/entry.scss:1 650']
    );
    // Through a `@forward`, its own `with (…)` or its loads, under the prefix.
    assert.deepEqual(
        report([
            tokens,
            load('_mod.scss', "@forward 'tokens' with ($w: 600);"),
            load('u.scss', "@use 'mod';"),
        ]),
        []
    );
    const mod = load('_mod.scss', "@forward 'tokens' as p-*;");
    assert.deepEqual(
        report([tokens, mod, load('u.scss', "@use 'mod' with ($p-w: 600);")]),
        []
    );
    assert.deepEqual(
        report([
            tokens,
            mod,
            load('u.scss', "@use 'mod' with ($p-w: 600);"),
            load('v.scss', "@use 'mod';"),
        ]),
        flagged
    );
});

test('blanks every `//` comment in TypeScript', () => {
    const component = [
        'call(// font-weight: 650 was removed',
        '    value);',
        'const a = { b: // font-weight: 750',
        '    1 };',
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), []);
});

test('flags relative keywords, which can land off the scale', () => {
    const findings = findOffScaleWeights(
        'libs/a.scss',
        'strong { font-weight: bolder; }'
    ).findings;

    assert.deepEqual(
        findings.map(({ value }) => value),
        ['bolder']
    );
    assert.match(describeFinding(findings[0]), /relative to the parent/);
});

test('ignores weights in comments and keeps later line numbers exact', () => {
    const source = [
        '/* The heading used to be',
        '   font-weight: 650; */',
        '// font-weight: 750 looked too heavy',
        ".a { src: url('https://example.test/f.woff2'); }",
        '.b { font-weight: 450; }',
    ].join('\n');

    assert.deepEqual(offScale('libs/a.scss', source), ['5 font-weight: 450']);
    assert.equal(blankComments(source).split('\n').length, 5);
    assert.match(blankComments(source), /https:\/\/example\.test/);
});

test('treats a selector that merely contains "weight" as a selector', () => {
    const source = '.title-weight:nth-child(2) { font-weight: 600; }';

    assert.deepEqual(offScale('libs/a.scss', source), []);
});

test('checks CSS text in TypeScript and HTML, not variables named …Weight', () => {
    const component = [
        'const yearWeight = 100;',
        'const ranking = { popularityWeight: 0.3, titleWeight: 250 };',
        'styles: [',
        "    '.chip { font-size: 0.72rem; font-weight: 650; }',",
        '],',
        'const style = { fontWeight: 750 };',
    ].join('\n');
    const template = '<p style="font-weight: 300">Hi</p>';

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        '4 font-weight: 650',
        '6 fontWeight: 750',
    ]);
    assert.deepEqual(offScale('apps/web/src/index.html', template), [
        '1 font-weight: 300',
    ]);
});

test('suggests the scale step the audit mapping uses', () => {
    const mapping = Object.fromEntries(
        [300, 450, 520, 530, 610, 650, 680, 750, 760, 800].map((weight) => [
            weight,
            nearestScaleWeight(weight),
        ])
    );

    assert.deepEqual(mapping, {
        300: 400,
        450: 500,
        520: 500,
        530: 500,
        610: 600,
        650: 600,
        680: 600,
        750: 700,
        760: 700,
        800: 700,
    });
    assert.match(
        describeFinding({
            file: 'libs/a.scss',
            line: 3,
            name: 'font-weight',
            value: 650,
        }),
        /^libs\/a\.scss:3 font-weight: 650 is off the 400\/500\/600\/700 scale.*Use 600\.$/
    );
});

test('scans app and library styles and sources, not the landing site', () => {
    assert.equal(isScannedFile('libs/ui/styles/_detail-view.scss'), true);
    assert.equal(isScannedFile('apps/web/src/styles.scss'), true);
    assert.equal(isScannedFile('apps/web/src/app/app.component.ts'), true);
    assert.equal(isScannedFile('apps/web/src/index.html'), true);
    assert.equal(isScannedFile('apps/web/src/assets/images/logo.svg'), true);
    assert.equal(isScannedFile('apps/website/src/styles/global.css'), false);
    assert.equal(isScannedFile('tools/nx/check-font-weights.mjs'), false);
    assert.equal(isScannedFile('libs/ui/styles/README.md'), false);
});

test('fails instead of passing when the scan finds no stylesheets', () => {
    assert.match(validateScanCoverage([])[0], /No stylesheets were scanned/);
    assert.match(
        validateScanCoverage(['apps/web/src/app/app.component.ts'])[0],
        /No stylesheets were scanned/
    );
    assert.deepEqual(validateScanCoverage(['apps/web/src/styles.scss']), []);
});
