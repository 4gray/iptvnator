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
