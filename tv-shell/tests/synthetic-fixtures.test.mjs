import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticFixture } from '../tools/synthetic-fixtures.mjs';

test('fixture metadata becomes synthetic without losing syntax, Unicode or long URLs', () => {
    const input = '\uFEFF#EXTM3U\r\n  #EXTINF:-1 tvg-id="FixtureIdentifier" tvg-name="FixtureLabel" group-title="ГруппаПример",КаналПример "FixtureLabel" S01E02 &amp;\r\n'
        + 'http://fixture.example/FixtureLabel.ts?jwt=' + 'x'.repeat(2100) + '\r\n';
    const result = syntheticFixture(input);
    for (const value of ['FixtureIdentifier', 'FixtureLabel', 'ГруппаПример', 'КаналПример', 'fixture.example']) assert.ok(!result.includes(value));
    assert.ok(result.startsWith('\uFEFF#EXTM3U\r\n'));
    assert.ok(result.includes('\r\n  #EXTINF:'));
    assert.ok(result.includes('Синтетический'));
    assert.ok(result.includes('"Synthetic'));
    assert.ok(result.includes('S01E02 &amp;'));
    assert.ok(result.includes('.ts?jwt=' + 'e'.repeat(2100)));
    assert.equal(syntheticFixture(input), result);
});

test('malformed free-text records are synthetic while pipe directive syntax stays intact', () => {
    const input = '#EXTM3U\n  Fixture invalid record\n|User-Agent=Synthetic Agent\n';
    const result = syntheticFixture(input);
    assert.ok(!result.includes('Fixture'));
    assert.ok(result.includes('\n  Synthetic'));
    assert.ok(result.includes('|User-Agent=Synthetic Agent\n'));
    assert.ok(!syntheticFixture('#EXTINF:-1 broken="x,FixtureLabel\n').includes('FixtureLabel'));
});

test('regenerating every fixture cannot publish original catalog labels', () => {
    const output = mkdtempSync(join(tmpdir(), 'iptvnator-synthetic-fixtures-'));
    try {
        execFileSync(process.execPath, [fileURLToPath(new URL('../tools/gen-parser-fixtures.mjs', import.meta.url)), '--out', output]);
        const check = (value) => {
            if (Array.isArray(value)) return value.forEach(check);
            if (!value || typeof value !== 'object') return;
            for (const [key, item] of Object.entries(value)) {
                if (['name', 'title', 'id'].includes(key) && typeof item === 'string' && /\p{L}/u.test(item)) {
                    assert.ok(/Synthetic|Синтетический/.test(item), 'catalog labels must be synthetic');
                }
                check(item);
            }
        };
        for (const file of readdirSync(output).filter((name) => name.endsWith('.expected.json'))) {
            check(JSON.parse(readFileSync(join(output, file), 'utf8')));
        }
    } finally {
        rmSync(output, { recursive: true, force: true });
    }
});
