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
for (const path of [
    'lib/definitely-missing.ts',
    'services/definitely-missing.ts',
    'electron-builder.json',
    'missing.scss',
    'custom.config-format',
    '.custom-config',
    '.env.local',
    '.eslintrc.json',
    'arbitrary/directory',
]) {
    test(`checks generic literal repository path ${path}`, async (t) => {
        assert.match(
            (await diagnostics(t, { [map]: '`' + path + '`' })).join('\n'),
            /does not exist/
        );
        assert.deepEqual(
            await diagnostics(t, { [map]: '`' + path + '`', [path]: '' }),
            []
        );
    });
}
test('AGENTS rejects the reported unlisted directory and root filename', async (t) => {
    const errors = await diagnostics(t, {
        'AGENTS.md':
            '`services/definitely-missing.ts` and `electron-builder.json`',
    });
    assert.equal(errors.length, 2);
    assert.match(
        errors.join('\n'),
        /does not exist: services\/definitely-missing\.ts/
    );
    assert.match(errors.join('\n'), /does not exist: electron-builder\.json/);
});
test('ambiguous dotted filenames can be explicitly marked as paths', async (t) => {
    for (const reference of ['`./custom.symbol`', '[File](custom.symbol)']) {
        assert.match(
            (await diagnostics(t, { [map]: reference })).join('\n'),
            /does not exist/
        );
    }
    assert.deepEqual(
        await diagnostics(t, {
            [map]: '`./custom.symbol`',
            'custom.symbol': '',
        }),
        []
    );
});
test('literal paths retain fragment checks', async (t) => {
    assert.deepEqual(
        await diagnostics(t, { [map]: '`docs/example.md#hello-world`' }),
        []
    );
    assert.match(
        (await diagnostics(t, { [map]: '`docs/example.md#missing`' })).join(
            '\n'
        ),
        /missing anchor/
    );
});
test('literal detection excludes commands, templates, URLs, aliases and code expressions', async (t) => {
    const examples = [
        'pnpm nx test web',
        'node tools/example.mjs',
        '--config=missing.json',
        'docs/*.md',
        'docs/{one,two}.md',
        'docs/<topic>.md',
        '.plans/YYYY-MM-DD-short-topic.md',
        'docs/.../example.md',
        'https://example.com/guide.md',
        'file:///tmp/example.md',
        '@iptvnator/services',
        '@angular/core',
        'node:fs/promises',
        'window.electron',
        'Date.now',
        'String.raw',
        'Buffer.from',
        'customStore.selectedItem',
        'process.env.NODE_ENV',
        'document.body',
        'process.env',
        'this.store',
        'store.setState()',
        'source?.id',
        'a/b+c',
        '$HOME/example.md',
    ];
    assert.deepEqual(
        await diagnostics(t, {
            [map]: examples.map((value) => '`' + value + '`').join(' '),
        }),
        []
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

test('balanced parentheses and formatted labels retain complete destinations', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '[Read **[the guide]**](docs/example(1).md#hello-world)\n',
            'docs/example(1).md': '# Hello, `World`!\n',
        }),
        []
    );
    const errors = await diagnostics(t, {
        'AGENTS.md': '[Read **[the guide]**](docs/missing(1).md)\n',
    });
    assert.match(errors.join('\n'), /does not exist: docs\/missing\(1\)\.md/);
});

test('angle and escaped Markdown destinations resolve literal filenames', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '[Angle](<docs/guide (one).md>)\n[Escaped](docs/example\\(1\\).md)\n',
            'docs/guide (one).md': '# Guide\n',
            'docs/example(1).md': '# Example\n',
        }),
        []
    );
});

test('reference definitions resolve full, collapsed and shortcut links', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '[Read **guide**][GUIDE]\n[Guide][]\n[Guide]\n\n[guide]: <docs/example(1).md#hello-world> "Title"\n',
            'docs/example(1).md': '# Hello, `World`!\n',
        }),
        []
    );
    const errors = await diagnostics(t, {
        'AGENTS.md': '[Read guide][guide]\n\n[guide]: docs/missing(1).md\n',
    });
    assert.match(errors.join('\n'), /does not exist: docs\/missing\(1\)\.md/);
});

for (const reference of [
    '[Guide][missing]',
    '[Guide][]',
    '[**Guide**][missing]',
    '[Guide `code`][missing]',
    '![Guide][missing]',
    '![Diagram]',
]) {
    test(`diagnoses unresolved explicit reference ${reference}`, async (t) => {
        assert.match(
            (await diagnostics(t, { 'AGENTS.md': reference + '\n' })).join(
                '\n'
            ),
            /unresolved.*reference/i
        );
    });
}

test('lexer visits navigation inside tables, lists, and blockquotes', async (t) => {
    const errors = await diagnostics(t, {
        'AGENTS.md':
            '| Guide |\n| --- |\n| [Table](docs/table(1).md) |\n\n- [List](docs/list(1).md)\n\n> [Quote][missing]\n',
    });
    assert.equal(errors.length, 3);
    assert.match(errors.join('\n'), /docs\/table\(1\)\.md/);
    assert.match(errors.join('\n'), /docs\/list\(1\)\.md/);
    assert.match(errors.join('\n'), /unresolved.*reference/i);
});

test('fenced, indented, inline and escaped examples are not navigation', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md': [
                '```md',
                '[Code](missing.md)',
                '[Code][missing]',
                '```',
                '',
                '    [Indented](missing.md)',
                '    [Indented][]',
                '',
                '`[Inline](missing.md)` and ``[Code `label`][missing]``.',
                '\\[Escaped][missing]',
            ].join('\n'),
        }),
        []
    );
});

test('heading anchors use nested token text, link labels and code spans', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '[Heading](docs/example.md#a-bold-emphasis-label-code-hi)\n[Duplicate](docs/example.md#a-bold-emphasis-label-code-hi-1)',
            'docs/example.md':
                '# A **bold *emphasis*** [Label `code`](one(two).md) <em>Hi</em>\n\n# A **bold *emphasis*** [Label `code`](one(two).md) <em>Hi</em>\n',
        }),
        []
    );
});

test('HTML heading tokens are ignored without rendering or tag stripping', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '[HTML](docs/example.md#safe-heading)\n[Nested](docs/example.md#unsafe-scriptalert1script)',
            'docs/example.md':
                '# Safe <span title="a > b">Heading</span>\n\n# Unsafe <scr<script>ipt>alert(1)</scr</script>ipt>\n',
        }),
        []
    );
});

test('explicit HTML anchors work but anchors in code examples do not', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md': '[Anchor](docs/example.md#explicit)',
            'docs/example.md': '<a id="explicit"></a>\n',
        }),
        []
    );
    const errors = await diagnostics(t, {
        'AGENTS.md': '[Fake](docs/example.md#fake)',
        'docs/example.md': '```html\n<a id="fake"></a>\n```\n',
    });
    assert.match(errors.join('\n'), /missing anchor/);
});

for (const source of ['AGENTS.md', 'CLAUDE.md']) {
    test(`${source}: fenced decorators are not root imports`, async (t) => {
        const prefix = source === 'CLAUDE.md' ? '@AGENTS.md\n' : '';
        assert.deepEqual(
            await diagnostics(t, {
                [source]:
                    prefix + '```ts\n@Injectable()\n@docs/missing.md\n```\n',
            }),
            []
        );
    });
}
test('a fenced import cannot satisfy the required CLAUDE import', async (t) => {
    assert.match(
        (
            await diagnostics(t, {
                'CLAUDE.md': '```text\n@AGENTS.md\n```\n',
            })
        ).join('\n'),
        /standalone @AGENTS.md/
    );
});
for (const [encoded, filename] of [
    ['guide%23one.md', 'guide#one.md'],
    ['guide%3Fone.md', 'guide?one.md'],
]) {
    test(`encoded filename delimiters stay in path: ${encoded}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': `[Doc](docs/${encoded}?view=1#hello%2Dworld)`,
                [`docs/${filename}`]: '# Hello World\n',
            }),
            []
        );
        assert.match(
            (
                await diagnostics(t, {
                    'AGENTS.md': `[Doc](docs/${encoded}#missing)`,
                    [`docs/${filename}`]: '# Hello World\n',
                })
            ).join('\n'),
            /missing anchor/
        );
    });
}
