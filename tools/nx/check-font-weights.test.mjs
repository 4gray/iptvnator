import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    blankComments,
    describeFinding,
    findIndirectWeights,
    findOffScaleWeights,
    isScannedFile,
    nearestScaleWeight,
    scanWeights,
    validateScanCoverage,
} from './check-font-weights.mjs';

const offScale = (file, source) =>
    findOffScaleWeights(file, source).findings.map(
        ({ line, name, value }) => `${line} ${name}: ${value}`
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

    assert.deepEqual(report([heading, caller]), []);
    assert.deepEqual(report([config, configured]), ['libs/f/f.scss:1 650']);
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

test('checks indexed style writes', () => {
    const component = [
        "element.style['fontWeight'] = 650;",
        'element.style["font-weight"] = 750;',
        'element.style[`fontWeight`] += 50;',
        "if (element.style['fontWeight'] === 650) {}",
        "element.style['fontWeight'] = 600;",
    ].join('\n');

    assert.deepEqual(offScale('apps/web/src/a.component.ts', component), [
        "1 .style['fontWeight']: 650",
        '2 .style["font-weight"]: 750',
        '3 .style[`fontWeight`]: += 50',
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
