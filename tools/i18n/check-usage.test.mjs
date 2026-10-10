import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { findKeyReferences, run, stripComments } from './check-usage.mjs';

const EN = {
    CLOSE: 'Close',
    PORTALS: {
        ITEMS: 'items',
        DIALOG: { TITLE: 'Title', MESSAGE: 'Message' },
    },
};
const NAMESPACES = new Set(['PORTALS']);

let root;

beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'i18n-usage-'));
    writeFileSync(path.join(root, 'en.json'), JSON.stringify(EN));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function writeSource(relativePath, content) {
    const filePath = path.join(root, 'src', relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
}

function check() {
    const lines = [];
    const code = run({
        repoRoot: root,
        enPath: path.join(root, 'en.json'),
        sourceRoots: ['src'],
        log: (line) => lines.push(line),
    });
    return { code, output: lines.join('\n') };
}

function keys(source, kind = 'ts') {
    return findKeyReferences(source, kind, NAMESPACES).map(
        ({ key, kind: referenceKind }) => `${referenceKind}:${key}`
    );
}

test('fails on a piped key that en.json lacks and names its location', () => {
    writeSource(
        'view.component.html',
        `<p>{{ 'CLOSE' | translate }}</p>\n<p>{{ 'PORTALS.MISSING' | translate }}</p>\n`
    );

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(output, /^FAIL usage: 1 key\(s\)/m);
    assert.match(output, /PORTALS\.MISSING {2}src\/view\.component\.html:2$/m);
});

test('passes when every referenced key exists', () => {
    writeSource(
        'view.ts',
        `this.translate.instant('PORTALS.ITEMS');\nconst key = 'PORTALS.DIALOG';\n`
    );

    const { code, output } = check();

    assert.equal(code, 0);
    assert.match(output, /^ok usage: 1 files, 0 keys missing/m);
});

test('reads the first argument of translate calls, even across lines', () => {
    assert.deepEqual(
        keys(`this.translateService.instant(\n    'GHOST',\n    { n: 1 }\n);`),
        ['leaf:GHOST']
    );
    assert.deepEqual(keys(`translateWithFallback('CLOSE', 'x')`), [
        'leaf:CLOSE',
    ]);
    assert.deepEqual(keys(`this.translate.get('CLOSE')`), ['leaf:CLOSE']);
    assert.deepEqual(keys(`marker('CLOSE')`), ['leaf:CLOSE']);
});

test('reads the branches of a parenthesised pipe operand', () => {
    assert.deepEqual(
        keys(
            "{{ (expanded() ? 'SHOW_LESS' : 'SHOW_MORE') | translate }}",
            'html'
        ),
        ['leaf:SHOW_LESS', 'leaf:SHOW_MORE']
    );
    assert.deepEqual(
        keys("{{ (label() || 'CLOSE') | translate: { n: 1 } }}", 'html'),
        ['leaf:CLOSE']
    );
});

test('does not read a literal compared in the condition as a key', () => {
    assert.deepEqual(
        keys(
            "{{ (status() === 'ERROR' ? 'CLOSE' : other) | translate }}",
            'html'
        ),
        ['leaf:CLOSE']
    );
});

test('fails on a missing key in a parenthesised pipe operand', () => {
    writeSource(
        'hero.component.html',
        "<button>{{ (open() ? 'CLOSE' : 'SHOW_MORE') | translate }}</button>\n"
    );

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(output, /SHOW_MORE {2}src\/hero\.component\.html:1$/m);
    assert.doesNotMatch(output, /CLOSE {2}/);
});

test('ignores get() and similar calls on receivers that do not translate', () => {
    assert.deepEqual(keys(`params.get('ID'); map.get('NAME');`), []);
});

test('a translate call must name a string, not a group of keys', () => {
    writeSource('view.ts', `this.translate.instant('PORTALS.DIALOG');\n`);

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(output, /PORTALS\.DIALOG {2}src\/view\.ts:1$/m);
});

test('a constant may name a group of keys that code completes', () => {
    writeSource(
        'actions.ts',
        "const dialogKey = 'PORTALS.DIALOG';\nthis.translate.instant(`${dialogKey}.TITLE`);\n"
    );

    assert.equal(check().code, 0);
});

test('checks dotted literals in known namespaces outside translate calls', () => {
    writeSource(
        'keys.ts',
        `export const KEYS = { a: 'PORTALS.ITEMS', b: 'PORTALS.GONE' };\n`
    );

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(output, /PORTALS\.GONE {2}src\/keys\.ts:1$/m);
    assert.doesNotMatch(output, /PORTALS\.ITEMS/);
});

test('ignores dotted literals outside the en.json namespaces', () => {
    assert.deepEqual(keys(`const codec = 'H.264'; const id = 'DB.QUERY';`), []);
});

test('a template literal prefix must name a group of keys', () => {
    assert.deepEqual(keys('this.t(`PORTALS.DIALOG.${name}`)'), [
        'prefix:PORTALS.DIALOG',
    ]);
    writeSource('view.ts', 'this.translate.instant(`PORTALS.NOPE.${name}`);\n');

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(output, /PORTALS\.NOPE {2}src\/view\.ts:1$/m);
});

test('skips keys that only appear in comments', () => {
    writeSource(
        'view.ts',
        `// this.translate.instant('PORTALS.OLD')\n/* 'PORTALS.OLDER' | translate */\nconst url = 'https://example.com/a'; // 'PORTALS.TRAILING'\n`
    );
    writeSource('view.html', `<!-- {{ 'PORTALS.HTML' | translate }} -->\n`);
    writeSource(
        'inline.component.ts',
        "@Component({\n    template: `\n        <!-- {{ 'PORTALS.INLINE' | translate }} -->\n        <p>{{ 'CLOSE' | translate }}</p>\n    `,\n})\nexport class InlineComponent {}\n"
    );

    assert.equal(check().code, 0);
});

test('stripComments keeps string contents and line numbers', () => {
    const source = `const a = '// not a comment';\n/* one\ntwo */ const b = 1;`;

    const stripped = stripComments(source, 'ts');

    assert.equal(stripped.split('\n').length, 3);
    assert.match(stripped, /'\/\/ not a comment'/);
    assert.doesNotMatch(stripped, /one|two/);
});

test('skips spec files, test harnesses and test stubs', () => {
    writeSource('view.spec.ts', `translate.instant('PORTALS.SPEC_ONLY');\n`);
    writeSource('view.harness.ts', `translate.instant('PORTALS.HARNESS');\n`);
    writeSource('view.spec-data.ts', `const k = 'PORTALS.DATA';\n`);
    writeSource('test-stubs/stub.ts', `const k = 'PORTALS.STUB';\n`);

    assert.equal(check().code, 0);
});

test('fails clearly when en.json cannot be read', () => {
    writeFileSync(path.join(root, 'en.json'), '{');

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(output, /^FAIL .*en\.json: /m);
});
