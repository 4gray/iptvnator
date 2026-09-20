import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { validateAgentGuidance } from './validate-agent-guidance.mjs';

const map = 'docs/maintenance/agent-context-map.md';
const migration = 'docs/maintenance/agent-guidance-migration.md';
async function fixture(t, overrides = {}) {
    const rootDir = await mkdtemp(join(tmpdir(), 'agent-guidance-'));
    t.after(() => rm(rootDir, { recursive: true, force: true }));
    for (const [path, body] of Object.entries({
        'AGENTS.md': '# Guidance\n',
        'CLAUDE.md': '@AGENTS.md\n',
        [map]: '# Context\n',
        [migration]: '# Migration\n',
        'docs/example.md': '# Hello, `World`!\n\n## Repeat\n## Repeat\n',
        ...overrides,
    })) {
        await mkdir(dirname(join(rootDir, path)), { recursive: true });
        await writeFile(join(rootDir, path), body);
    }
    return rootDir;
}
async function diagnostics(t, overrides) {
    return (
        await validateAgentGuidance({ rootDir: await fixture(t, overrides) })
    ).diagnostics;
}

test('valid guidance and remote links pass', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '[Doc](docs/example.md#hello-world) and `@iptvnator/services`\n',
            [map]: '[Repeat](../example.md#repeat-1)\n',
            [migration]:
                '[Original](https://github.com/example/repo/blob/main/AGENTS.md#old)\n',
        }),
        []
    );
});
for (const [path, limit] of [
    ['AGENTS.md', 200],
    ['CLAUDE.md', 30],
]) {
    for (const eol of ['\n', '\r\n']) {
        test(`${path}: exact line limit accepts ${JSON.stringify(eol)}`, async (t) => {
            const prefix = path === 'CLAUDE.md' ? '@AGENTS.md' : '# Guidance';
            assert.deepEqual(
                await diagnostics(t, {
                    [path]:
                        [prefix, ...Array(limit - 1).fill('x')].join(eol) + eol,
                }),
                []
            );
        });
        test(`${path}: one line over fails ${JSON.stringify(eol)}`, async (t) => {
            const prefix = path === 'CLAUDE.md' ? '@AGENTS.md' : '# Guidance';
            assert.match(
                (
                    await diagnostics(t, {
                        [path]: [prefix, ...Array(limit).fill('x')].join(eol),
                    })
                ).join('\n'),
                /lines/
            );
        });
    }
}
for (const [path, limit] of [
    ['AGENTS.md', 16384],
    ['CLAUDE.md', 2048],
]) {
    test(`${path}: UTF-8 byte budget is exact`, async (t) => {
        const prefix = path === 'CLAUDE.md' ? '@AGENTS.md\n' : '';
        const remaining = limit - Buffer.byteLength(prefix);
        const body =
            prefix +
            'é'.repeat(Math.floor(remaining / 2)) +
            'x'.repeat(remaining % 2);
        assert.deepEqual(await diagnostics(t, { [path]: body }), []);
        assert.match(
            (await diagnostics(t, { [path]: body + 'é' })).join('\n'),
            /bytes/
        );
    });
}
for (const body of [
    '',
    'See @AGENTS.md',
    '@AGENTS.md\n@AGENTS.md',
    '@AGENTS.md\n@docs/example.md',
    '@AGENTS.md\nRead @docs/example.md for more.',
]) {
    test(`rejects invalid CLAUDE imports: ${JSON.stringify(body)}`, async (t) => {
        assert.match(
            (await diagnostics(t, { 'CLAUDE.md': body })).join('\n'),
            /import/
        );
    });
}
for (const source of ['AGENTS.md', 'CLAUDE.md']) {
    for (const target of [
        'package.json',
        'libs/extra.txt',
        'arbitrary.custom',
        'tools/instructions',
        'LICENSE',
        '.nvmrc',
        './instructions',
    ]) {
        test(`${source}: rejects inline file import @${target}`, async (t) => {
            const prefix = source === 'CLAUDE.md' ? '@AGENTS.md\n' : '';
            assert.match(
                (
                    await diagnostics(t, {
                        [source]: `${prefix}Read @${target} for instructions.\n`,
                    })
                ).join('\n'),
                /import/
            );
        });
    }
}
test('AGENTS forbids imports while aliases in prose stay valid', async (t) => {
    assert.match(
        (await diagnostics(t, { 'AGENTS.md': '@docs/example.md\n' })).join(
            '\n'
        ),
        /import/
    );
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                'Use @iptvnator/services and `@iptvnator/ui/components`.\n',
        }),
        []
    );
});
for (const path of ['AGENTS.md', 'CLAUDE.md', map, migration]) {
    test(`${path}: missing local links and anchors fail`, async (t) => {
        const prefix = path === 'CLAUDE.md' ? '@AGENTS.md\n' : '';
        const target = path.startsWith('docs/')
            ? '../example.md'
            : 'docs/example.md';
        const errors = await diagnostics(t, {
            [path]:
                prefix + `[Missing](missing.md) [Anchor](${target}#missing)`,
        });
        assert.match(errors.join('\n'), /missing.md/);
        assert.match(errors.join('\n'), /anchor.*missing/);
    });
}
test('literal root paths validate without interpreting commands or globs', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            [map]: '`docs/example.md` `pnpm nx test web` `apps/*` `libs/<domain>/` `.plans/YYYY-MM-DD-short-topic.md`',
        }),
        []
    );
    assert.match(
        (await diagnostics(t, { [map]: '`docs/missing.md`' })).join('\n'),
        /does not exist/
    );
});
test('rejects traversal and symlink escapes', async (t) => {
    const rootDir = await fixture(t, {
        'AGENTS.md': '[Escape](../outside.md) [Symlink](outside)',
    });
    await symlink(tmpdir(), join(rootDir, 'outside'));
    const errors = (await validateAgentGuidance({ rootDir })).diagnostics;
    assert.equal(errors.filter((error) => error.includes('escapes')).length, 2);
});
test('requires all four guidance surfaces', async (t) => {
    const rootDir = await fixture(t);
    await rm(join(rootDir, map));
    assert.match(
        (await validateAgentGuidance({ rootDir })).diagnostics.join('\n'),
        /agent-context-map.md.*missing/
    );
});
