import assert from 'node:assert/strict';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { parseBaseline, run, serializeBaseline } from './check-drift.mjs';

const EN = {
    APP: { TITLE: 'IPTVnator', SAVE: 'Save' },
    PIN: 'PIN',
};

let root;
let dir;
let baselinePath;

beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'i18n-drift-'));
    dir = path.join(root, 'i18n');
    mkdirSync(dir);
    baselinePath = path.join(root, 'identical-en-baseline.json');
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function writeLocale(locale, content) {
    writeFileSync(path.join(dir, `${locale}.json`), JSON.stringify(content));
}

function writeBaseline(content) {
    writeFileSync(baselinePath, JSON.stringify(content));
}

function check(...argv) {
    const lines = [];
    const code = run({
        i18nDir: dir,
        baselinePath,
        argv,
        log: (line) => lines.push(line),
    });
    return { code, output: lines.join('\n') };
}

function readBaselineFile() {
    return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

test('fails on a new English-identical key that the baseline does not list', () => {
    writeLocale('en', { ...EN, APP: { ...EN.APP, NEW: 'New label' } });
    writeLocale('de', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Speichern', NEW: 'New label' },
        PIN: 'PIN',
    });
    writeBaseline({ de: { 'APP.TITLE': 'IPTVnator', PIN: 'PIN' } });

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(output, /^FAIL de\.json: .*identical_en=3 baselined=2$/m);
    assert.match(output, /de\.json APP\.NEW: "New label"/);
});

test('passes a translated key', () => {
    writeLocale('en', EN);
    writeLocale('de', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Speichern' },
        PIN: 'PIN-Code',
    });
    writeBaseline({ de: { 'APP.TITLE': 'IPTVnator' } });

    const { code, output } = check();

    assert.equal(code, 0);
    assert.match(output, /^ok de\.json: .*identical_en=1 baselined=1$/m);
});

test('passes an English-identical key listed in the baseline', () => {
    writeLocale('en', EN);
    writeLocale('de', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Speichern' },
        PIN: 'PIN',
    });
    writeBaseline({ de: { 'APP.TITLE': 'IPTVnator', PIN: 'PIN' } });

    assert.equal(check().code, 0);
});

test('a baseline entry only covers the English text it recorded', () => {
    // English was reworded and the new text copied into the locale: that is
    // new untranslated text, not the value the baseline accepted.
    writeLocale('en', { ...EN, APP: { ...EN.APP, SAVE: 'Save changes' } });
    writeLocale('de', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Save changes' },
        PIN: 'PIN-Code',
    });
    writeBaseline({ de: { 'APP.TITLE': 'IPTVnator', 'APP.SAVE': 'Save' } });

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(output, /de\.json APP\.SAVE: "Save changes"/);
});

test('reports baseline entries that are no longer identical without failing', () => {
    writeLocale('en', EN);
    writeLocale('de', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Speichern' },
        PIN: 'PIN-Code',
    });
    writeBaseline({
        de: { 'APP.TITLE': 'IPTVnator', 'APP.SAVE': 'Save', PIN: 'PIN' },
        fr: { PIN: 'PIN' },
    });

    const { code, output } = check();

    assert.equal(code, 0);
    assert.match(
        output,
        /^note de\.json: 2 baseline entries .*\(APP\.SAVE, PIN\)$/m
    );
    assert.match(output, /^note fr: baseline lists a locale with no file$/m);
    assert.match(
        output,
        /^note 3 stale baseline entries; run .*i18n:baseline:update/m
    );
});

test('a locale without baseline entries fails on every identical value', () => {
    writeLocale('en', EN);
    writeLocale('uk', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Зберегти' },
        PIN: 'PIN-код',
    });

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(output, /uk\.json APP\.TITLE: "IPTVnator"/);
});

test('still fails on missing and extra keys', () => {
    writeLocale('en', EN);
    writeLocale('de', { APP: { TITLE: 'IPTVnator', OLD: 'Alt' }, PIN: 'PIN' });
    writeBaseline({ de: { 'APP.TITLE': 'IPTVnator', PIN: 'PIN' } });

    const { code, output } = check();

    assert.equal(code, 1);
    assert.match(
        output,
        /^FAIL de\.json: missing=1 \(APP\.SAVE\) extra=1 \(APP\.OLD\)/m
    );
});

test('--fail-on-identical ignores the baseline', () => {
    writeLocale('en', EN);
    writeLocale('de', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Speichern' },
        PIN: 'PIN',
    });
    writeBaseline({ de: { 'APP.TITLE': 'IPTVnator', PIN: 'PIN' } });

    const { code, output } = check('--fail-on-identical');

    assert.equal(code, 1);
    assert.match(output, /de\.json APP\.TITLE: "IPTVnator"/);
    assert.match(output, /de\.json PIN: "PIN"/);
});

test('--update-baseline records current identical values and drops resolved ones', () => {
    writeLocale('en', EN);
    writeLocale('de', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Speichern' },
        PIN: 'PIN',
    });
    writeLocale('fr', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Enregistrer' },
        PIN: 'Code PIN',
    });
    writeBaseline({ de: { 'APP.SAVE': 'Save' }, fr: { PIN: 'PIN' } });

    const { code, output } = check('--update-baseline');

    assert.equal(code, 0);
    assert.match(output, /^ {2}\+ de PIN: "PIN"$/m);
    assert.match(output, /Baseline written: 3 added, 2 removed\./);
    assert.deepEqual(readBaselineFile(), {
        de: { 'APP.TITLE': 'IPTVnator', PIN: 'PIN' },
        fr: { 'APP.TITLE': 'IPTVnator' },
    });
    assert.equal(check().code, 0);
});

test('--update-baseline keeps the old baseline when a locale is unreadable', () => {
    writeLocale('en', EN);
    writeFileSync(path.join(dir, 'de.json'), '{ broken');
    writeBaseline({ de: { PIN: 'PIN' } });

    const { code, output } = check('--update-baseline');

    assert.equal(code, 1);
    assert.match(output, /baseline not written/);
    assert.deepEqual(readBaselineFile(), { de: { PIN: 'PIN' } });
});

test('--update-baseline keeps the old baseline while keys are missing or extra', () => {
    writeLocale('en', EN);
    writeLocale('de', { APP: { TITLE: 'IPTVnator', OLD: 'Alt' }, PIN: 'PIN' });
    writeBaseline({ de: { 'APP.SAVE': 'Save', PIN: 'PIN' } });

    const { code, output } = check('--update-baseline');

    assert.equal(code, 1);
    assert.match(output, /baseline not written/);
    assert.deepEqual(readBaselineFile(), {
        de: { 'APP.SAVE': 'Save', PIN: 'PIN' },
    });
});

test('--fail-on-identical audits even when the baseline is damaged', () => {
    writeLocale('en', EN);
    writeLocale('de', {
        APP: { TITLE: 'IPTVnator', SAVE: 'Speichern' },
        PIN: 'PIN-Code',
    });
    writeFileSync(baselinePath, '{ broken');

    const { code, output } = check('--fail-on-identical');

    assert.equal(code, 1);
    assert.match(output, /^FAIL de\.json: missing=0 extra=0 identical_en=1$/m);
    assert.match(output, /de\.json APP\.TITLE: "IPTVnator"/);
    assert.equal(check().code, 1);
});

test('rejects unknown and conflicting flags', () => {
    writeLocale('en', EN);

    assert.equal(check('--update').code, 1);
    assert.equal(check('--fail-on-identical', '--update-baseline').code, 1);
});

test('rejects a malformed baseline', () => {
    assert.throws(() => parseBaseline({ de: ['PIN'] }), /object of keys/);
    assert.throws(() => parseBaseline({ de: { PIN: 1 } }), /English text/);
});

test('serialises locales and keys in a stable order', () => {
    const serialized = serializeBaseline(
        new Map([
            [
                'fr',
                new Map([
                    ['B', 'b'],
                    ['A', 'a'],
                ]),
            ],
            ['de', new Map()],
            ['ar', new Map([['Z', 'z']])],
        ])
    );

    assert.equal(
        serialized,
        '{\n    "ar": {\n        "Z": "z"\n    },\n    "fr": {\n        "A": "a",\n        "B": "b"\n    }\n}\n'
    );
});
