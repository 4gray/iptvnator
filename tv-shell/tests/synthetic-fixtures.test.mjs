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

test('fixture URLs replace IP literals, numeric identifiers and signed paths', () => {
    const input = '#EXTM3U\n'
        + '#EXTINF:-1 tvg-id="123456",Synthetic channel\n'
        + "http://198.51.100.42:8080/123456/play'part(synthetic-original)/stream.syntheticTail?token=654321&syntheticKey=S11E12|User-Agent=Synthetic Agent\n"
        + '#EXTINF:-1,Synthetic channel\nhttp://[2001:db8::42]:8080/123456.ts\n';
    const result = syntheticFixture(input);
    for (const value of ['198.51.100.42', '2001:db8::42', '123456', '654321', 'synthetic-original', 'syntheticTail', 'syntheticKey', 'S11E12']) {
        assert.ok(!result.includes(value), 'original endpoint and identifiers must be absent');
    }
    assert.match(result, /http:\/\/192\.0\.2\.1:8080\/\d+\//);
    assert.ok(result.includes('http://[2001:db8::1]:8080/'));
    assert.ok(result.includes('|User-Agent=Synthetic Agent\n'));
});

test('generated fixtures contain only synthetic catalog labels and endpoints', () => {
    const output = mkdtempSync(join(tmpdir(), 'iptvnator-synthetic-fixtures-'));
    try {
        execFileSync(process.execPath, [fileURLToPath(new URL('../tools/gen-parser-fixtures.mjs', import.meta.url)), '--out', output]);
        const hosts = new Set(['synthetic.example', '192.0.2.1', '[2001:db8::1]']);
        const check = (value) => {
            if (typeof value === 'string') {
                for (const [endpoint] of value.matchAll(/\b[a-z][a-z\d+.-]*:\/\/[^\s"|<>]+/gi)) {
                    assert.ok(URL.canParse(endpoint), 'fixture endpoint must parse');
                    assert.ok(hosts.has(new URL(endpoint).hostname), 'fixture endpoint must use a reserved host');
                }
                return;
            }
            if (Array.isArray(value)) return value.forEach(check);
            if (!value || typeof value !== 'object') return;
            for (const [key, item] of Object.entries(value)) {
                if (['name', 'title', 'id'].includes(key) && typeof item === 'string' && /\p{L}/u.test(item)) {
                    assert.ok(/Synthetic|Синтетический/.test(item), 'catalog labels must be synthetic');
                }
                check(item);
            }
        };
        for (const file of readdirSync(output)) {
            const content = readFileSync(join(output, file), 'utf8');
            if (file.endsWith('.m3u')) check(content);
            if (file.endsWith('.expected.json')) check(JSON.parse(content));
        }
    } finally {
        rmSync(output, { recursive: true, force: true });
    }
});
