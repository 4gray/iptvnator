import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { findDivergentDuplicates, run } from './check-duplicates.mjs';

const EN = {
    CLOSE: 'Close',
    DIALOG: { CLOSE: 'Close', SAVE: 'Save' },
    MENU: { SAVE: 'Save', TITLE: 'Menu' },
};

let dir;

beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'i18n-duplicates-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function writeLocale(locale, content) {
    writeFileSync(path.join(dir, `${locale}.json`), JSON.stringify(content));
}

function report(...argv) {
    const lines = [];
    const code = run({ i18nDir: dir, argv, log: (line) => lines.push(line) });
    return { code, output: lines.join('\n') };
}

test('groups keys by English text and keeps only diverging locales', () => {
    const en = new Map([
        ['CLOSE', 'Close'],
        ['DIALOG.CLOSE', 'Close'],
        ['DIALOG.SAVE', 'Save'],
        ['MENU.SAVE', 'Save'],
        ['MENU.TITLE', 'Menu'],
    ]);
    const locales = new Map([
        [
            'de',
            new Map([
                ['CLOSE', 'Schließen'],
                ['DIALOG.CLOSE', 'Schliessen'],
                ['DIALOG.SAVE', 'Speichern'],
                ['MENU.SAVE', 'Speichern'],
            ]),
        ],
        [
            'fr',
            new Map([
                ['CLOSE', 'Fermer'],
                ['DIALOG.CLOSE', 'Fermer'],
                ['DIALOG.SAVE', 'Save'],
                ['MENU.SAVE', 'Enregistrer'],
            ]),
        ],
    ]);

    const groups = findDivergentDuplicates(en, locales);

    assert.deepEqual(
        groups.map(({ english, keys, locales: diverging }) => ({
            english,
            keys,
            locales: [...diverging.keys()],
        })),
        [
            {
                english: 'Close',
                keys: ['CLOSE', 'DIALOG.CLOSE'],
                locales: ['de'],
            },
            {
                english: 'Save',
                keys: ['DIALOG.SAVE', 'MENU.SAVE'],
                locales: ['fr'],
            },
        ]
    );
    assert.deepEqual(
        [...groups[1].locales.get('fr')],
        [
            ['Save', ['DIALOG.SAVE']],
            ['Enregistrer', ['MENU.SAVE']],
        ]
    );
});

test('reports nothing when every locale agrees', () => {
    writeLocale('en', EN);
    writeLocale('de', {
        CLOSE: 'Schließen',
        DIALOG: { CLOSE: 'Schließen', SAVE: 'Speichern' },
        MENU: { SAVE: 'Speichern', TITLE: 'Menü' },
    });

    const { code, output } = report('--max', '0');

    assert.equal(code, 0);
    assert.match(output, /^ok 0 duplicate English string/m);
});

test('fails only when diverging groups exceed --max', () => {
    writeLocale('en', EN);
    writeLocale('de', {
        CLOSE: 'Schließen',
        DIALOG: { CLOSE: 'Schliessen', SAVE: 'Speichern' },
        MENU: { SAVE: 'Sichern', TITLE: 'Menü' },
    });

    assert.equal(report('--max', '2').code, 0);
    const { code, output } = report('--max', '1', '--verbose');

    assert.equal(code, 1);
    assert.match(output, /^"Close": 2 keys, 1 locale\(s\) differ \(de\)$/m);
    assert.match(output, /^ {2}de "Schliessen": DIALOG\.CLOSE$/m);
    assert.match(output, /^FAIL 2 duplicate English string/m);
});

test('rejects unsupported arguments', () => {
    writeLocale('en', EN);

    assert.equal(report('--max').code, 1);
    assert.equal(report('--strict').code, 1);
});
