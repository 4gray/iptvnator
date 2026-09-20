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
        'tsconfig.base.json': JSON.stringify({
            compilerOptions: { paths: { '@iptvnator/*': ['libs/*'] } },
        }),
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

for (const source of ['AGENTS.md', 'CLAUDE.md']) {
    test(`${source}: indented decorators are not imports`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                [source]:
                    (source === 'CLAUDE.md' ? '@AGENTS.md\n\n' : '') +
                    '    @Injectable()\n    @docs/missing.md\n',
            }),
            []
        );
    });
}
for (const body of [
    '<!-- <a id="old"></a> -->',
    `<script>const s = '<a id="old"></a>';</script>`,
    '<template><a id="old"></a></template>',
]) {
    test(`non-rendered HTML does not define anchors: ${body}`, async (t) => {
        assert.match(
            (
                await diagnostics(t, {
                    'AGENTS.md': '[Old](docs/example.md#old)',
                    'docs/example.md': body,
                })
            ).join('\n'),
            /missing anchor/
        );
    });
}
for (const [heading, anchor] of [
    ['A &amp; B', 'a--b'],
    ['Caf&eacute; &#x41; &#66;', 'café-a-b'],
]) {
    test(`heading entities produce rendered anchors: ${heading}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': `[Heading](docs/example.md#${anchor})`,
                'docs/example.md': '# ' + heading,
            }),
            []
        );
    });
}

for (const html of [
    '<a href="docs/missing.md#section">Guide</a>',
    '<img src="docs/missing.png">',
]) {
    test(`validates rendered HTML navigation: ${html}`, async (t) => {
        assert.match(
            (await diagnostics(t, { 'AGENTS.md': html })).join('\n'),
            /does not exist/
        );
    });
}
test('HTML navigation supports valid anchors and decoded attributes', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '<a href="docs/example.md#hello-world">Guide</a> <img src="docs/a&amp;b.png">',
            'docs/a&b.png': '',
        }),
        []
    );
    assert.match(
        (
            await diagnostics(t, {
                'AGENTS.md': '<a href="docs/example.md#missing">Guide</a>',
            })
        ).join('\n'),
        /missing anchor/
    );
});
test('non-rendered HTML navigation is ignored', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '<!-- <a href="missing.md"> -->\n<script>const a = \'<img src="missing.png">\';</script>\n\n<template><a href="missing.md">Hidden</a></template>',
        }),
        []
    );
});

test('GitHub heading slugs remove non-ASCII whitespace', async (t) => {
    for (const heading of ['A&nbsp;B', 'A\u00a0B', 'A\u2003B']) {
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': '[Heading](docs/example.md#ab)',
                'docs/example.md': '# ' + heading,
            }),
            []
        );
        assert.match(
            (
                await diagnostics(t, {
                    'AGENTS.md': '[Heading](docs/example.md#a-b)',
                    'docs/example.md': '# ' + heading,
                })
            ).join('\n'),
            /missing anchor/
        );
    }
});

for (const body of [
    '> @AGENTS.md',
    '- @AGENTS.md',
    '# @AGENTS.md',
    '**@AGENTS.md**',
]) {
    test(`structured Markdown cannot satisfy Claude import: ${body}`, async (t) => {
        assert.match(
            (await diagnostics(t, { 'CLAUDE.md': body })).join('\n'),
            /standalone @AGENTS.md/
        );
    });
}

for (const tag of ['template', 'div']) {
    test(`HTML container cannot supply Claude import: ${tag}`, async (t) => {
        assert.match(
            (
                await diagnostics(t, {
                    'CLAUDE.md': `<${tag}>\n\n@AGENTS.md\n\n</${tag}>`,
                })
            ).join('\n'),
            /standalone @AGENTS.md/
        );
        assert.deepEqual(
            await diagnostics(t, {
                'CLAUDE.md': `<${tag}>\n\nExample\n\n</${tag}>\n\n@AGENTS.md`,
            }),
            []
        );
    });
}

for (const punctuation of ['"', "'", '[', '{', ':']) {
    test(`rejects inline imports after ${punctuation}`, async (t) => {
        assert.match(
            (
                await diagnostics(t, {
                    'CLAUDE.md':
                        '@AGENTS.md\n\nRead ' +
                        punctuation +
                        '@docs/example.md',
                })
            ).join('\n'),
            /imports are not allowed/
        );
    });
}
for (const image of [
    '![Diagram](docs/diagram.png#gh-dark-mode-only)',
    '<img src="docs/diagram.png#gh-light-mode-only">',
    '![Diagram][image]\n\n[image]: docs/diagram.png#gh-dark-mode-only',
]) {
    test(`image fragments are not Markdown headings: ${image}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': image,
                'docs/diagram.png': 'image fixture',
            }),
            []
        );
        assert.match(
            (await diagnostics(t, { 'AGENTS.md': image })).join('\n'),
            /does not exist/
        );
    });
}

test('sharing an image reference does not suppress document anchor checks', async (t) => {
    assert.match(
        (
            await diagnostics(t, {
                'AGENTS.md':
                    '![Preview][target] [Read][target]\n\n[target]: docs/example.md#missing',
            })
        ).join('\n'),
        /missing anchor/
    );
});

test('root literals cannot suppress source-relative definitions', async (t) => {
    assert.match(
        (
            await diagnostics(t, {
                [map]: '`README.md`\n\n[unused]: README.md',
                'README.md': '# Root',
            })
        ).join('\n'),
        /does not exist: README.md/
    );
});
test('visible HTML text cannot hide inline imports', async (t) => {
    assert.match(
        (
            await diagnostics(t, {
                'CLAUDE.md': '@AGENTS.md\n\n<p>Read @docs/example.md</p>',
            })
        ).join('\n'),
        /imports are not allowed/
    );
});
for (const html of [
    '<picture><source srcset="docs/dark.png"><img src="docs/light.png"></picture>',
    '<img src="docs/light.png" srcset="docs/light.png 1x, docs/dark.png 2x">',
]) {
    test(`validates every srcset asset: ${html}`, async (t) => {
        assert.match(
            (
                await diagnostics(t, {
                    'AGENTS.md': html,
                    'docs/light.png': '',
                })
            ).join('\n'),
            /does not exist: docs\/dark.png/
        );
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': html,
                'docs/light.png': '',
                'docs/dark.png': '',
            }),
            []
        );
    });
}

test('srcset data URLs do not become local filenames', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '<img srcset="data:image/png;base64,AAAA 1x, docs/image.png 2x">',
            'docs/image.png': '',
        }),
        []
    );
});
test('non-rendered HTML text and code do not introduce imports', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'CLAUDE.md':
                '@AGENTS.md\n\n<!-- @docs/missing.md -->\n<script>@docs/missing.md</script>\n<style>@docs/missing.md</style>\n<template>@docs/missing.md</template>\n<code>@docs/missing.md</code>',
        }),
        []
    );
});

test('declared scoped dependencies and aliases are not inline imports', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'package.json': JSON.stringify({
                dependencies: { '@angular/core': '*', '@nx/devkit': '*' },
            }),
            'tsconfig.base.json': JSON.stringify({
                compilerOptions: { paths: { '@custom/*': ['libs/*'] } },
            }),
            'AGENTS.md': 'Use @angular/core, @nx/* and @custom/services.',
        }),
        []
    );
});

test('TypeScript scope discovery supports JSONC', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'tsconfig.base.json':
                '{ // comment\n "compilerOptions": { "paths": { "@custom/*": ["libs/*"], }, }, }',
            'AGENTS.md': 'Use @custom/services.',
        }),
        []
    );
});
for (const target of [
    'angular/../docs/example.md',
    'angular/missing.md',
    'angular/undeclared',
]) {
    test(`declared scopes do not exempt undeclared imports: ${target}`, async (t) => {
        assert.match(
            (
                await diagnostics(t, {
                    'package.json': JSON.stringify({
                        dependencies: { '@angular/core': '*' },
                    }),
                    'CLAUDE.md': '@AGENTS.md\n\nRead @' + target,
                })
            ).join('\n'),
            /imports are not allowed/
        );
    });
}

test('Markdown destination entities resolve rendered filenames', async (t) => {
    for (const reference of [
        '[Guide](docs/a&amp;b.md)',
        '[Guide][ref]\n\n[ref]: docs/a&amp;b.md',
    ]) {
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': reference,
                'docs/a&b.md': '# Guide',
            }),
            []
        );
        assert.match(
            (
                await diagnostics(t, {
                    'AGENTS.md': reference,
                    'docs/a&amp;b.md': '# Wrong name',
                })
            ).join('\n'),
            /does not exist/
        );
    }
});
test('declared packages allow safe subpaths', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'package.json': JSON.stringify({
                dependencies: { '@angular/core': '*' },
            }),
            'AGENTS.md': 'Use @angular/core/testing.',
        }),
        []
    );
});

for (const filename of [
    'Dockerfile',
    'Makefile',
    'LICENSE',
    'NOTICE',
    'Procfile',
]) {
    test(`conventional extensionless filename is validated: ${filename}`, async (t) => {
        assert.match(
            (await diagnostics(t, { 'AGENTS.md': '`' + filename + '`' })).join(
                '\n'
            ),
            /does not exist/
        );
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': '`' + filename + '`',
                [filename]: '',
            }),
            []
        );
    });
}

for (const version of [
    '22.1.6',
    '^22.1.6',
    'next',
    '>=22.0.0',
    '<=22.0.0',
    '>22.0.0',
    '<22.0.0',
]) {
    test(`declared package can include version ${version}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'package.json': JSON.stringify({
                    dependencies: { '@angular/core': '*' },
                }),
                'AGENTS.md': 'Use @angular/core@' + version,
            }),
            []
        );
    });
}
for (const [path, fragment] of [
    ['apps/example.ts', 'L20'],
    ['docs/guide.pdf', 'page=3'],
]) {
    test(`non-Markdown fragments are not headings: ${path}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': `[Target](${path}#${fragment})`,
                [path]: 'fixture',
            }),
            []
        );
        assert.match(
            (
                await diagnostics(t, {
                    'AGENTS.md': `[Target](${path}#${fragment})`,
                })
            ).join('\n'),
            /does not exist/
        );
    });
}

for (const mention of [
    '@marked@17.0.0',
    '@marked@^17.0.0',
    '@angular/core?',
    '@angular/core!',
]) {
    test(`package mention accepts qualifier or punctuation: ${mention}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'package.json': JSON.stringify({
                    dependencies: { marked: '*', '@angular/core': '*' },
                }),
                'AGENTS.md': 'Use ' + mention,
            }),
            []
        );
    });
}

for (const content of [
    '[example](docs/missing.md)',
    '[example][ref]\n\n[ref]: docs/missing.md',
    '[unused]: docs/missing.md',
    '`docs/missing.md`',
    '[example][undefined]',
]) {
    test(`template Markdown is inert: ${content}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': '<template>\n\n' + content + '\n\n</template>',
            }),
            []
        );
    });
}

test('inert headings do not define or consume anchor slugs', async (t) => {
    const body =
        '<template>\n\n# Hidden\n\n# Visible\n\n</template>\n\n# Visible';
    assert.match(
        (
            await diagnostics(t, {
                'AGENTS.md': '[Hidden](docs/example.md#hidden)',
                'docs/example.md': body,
            })
        ).join('\n'),
        /missing anchor/
    );
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md': '[Visible](docs/example.md#visible)',
            'docs/example.md': body,
        }),
        []
    );
});
test('explicit relative literal paths support spaces', async (t) => {
    assert.match(
        (
            await diagnostics(t, {
                'AGENTS.md': '`./docs/My Guide.md`',
            })
        ).join('\n'),
        /does not exist/
    );
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md': '`./docs/My Guide.md`',
            'docs/My Guide.md': '',
        }),
        []
    );
});

for (const filename of ['./docs/Design - Copy.md', './docs/Design -Copy.md']) {
    test(`explicit spaced filename is checked: ${filename}`, async (t) => {
        assert.match(
            (await diagnostics(t, { 'AGENTS.md': '`' + filename + '`' })).join(
                '\n'
            ),
            /does not exist/
        );
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': '`' + filename + '`',
                [filename]: '',
            }),
            []
        );
    });
}
for (const html of [
    '<video><source src="docs/demo.mp4"></video>',
    '<video src="docs/demo.mp4"></video>',
    '<audio src="docs/demo.mp4"></audio>',
]) {
    test(`rendered media source is checked: ${html}`, async (t) => {
        assert.match(
            (await diagnostics(t, { 'AGENTS.md': html })).join('\n'),
            /does not exist/
        );
        assert.deepEqual(
            await diagnostics(t, { 'AGENTS.md': html, 'docs/demo.mp4': '' }),
            []
        );
    });
}

for (const heading of ['A&copy B', 'A&#169 B', 'A&#xA9 B']) {
    test(`semicolonless heading entities decode: ${heading}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': '[Heading](docs/example.md#a-b)',
                'docs/example.md': '# ' + heading,
            }),
            []
        );
    });
}
test('semicolonless definition entities match rendered destinations', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md': '[ref]: docs/a&copy.md',
            'docs/a©.md': '',
        }),
        []
    );
});
for (const html of [
    '<video poster="docs/asset.png"></video>',
    '<video><track src="docs/asset.png"></video>',
]) {
    test(`remaining media assets are checked: ${html}`, async (t) => {
        assert.match(
            (await diagnostics(t, { 'AGENTS.md': html })).join('\n'),
            /does not exist/
        );
        assert.deepEqual(
            await diagnostics(t, { 'AGENTS.md': html, 'docs/asset.png': '' }),
            []
        );
    });
}

for (const suffix of ["'s", '’s']) {
    test(`declared package may be possessive: ${suffix}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'package.json': JSON.stringify({
                    dependencies: { '@angular/core': '*' },
                }),
                'AGENTS.md': '@angular/core' + suffix + ' API',
            }),
            []
        );
    });
}

for (const suffix of ['', '.']) {
    test(`existing extensionless inline import is rejected: ${suffix}`, async (t) => {
        const result = await diagnostics(t, {
            'CLAUDE.md': '@AGENTS.md\n\nRead @INSTRUCTIONS' + suffix,
            INSTRUCTIONS: 'Additional guidance',
        });
        assert.ok(
            result.some((message) => message.includes('additional or inline'))
        );
    });
}
test('ordinary unknown handle is not a file import', async (t) => {
    assert.deepEqual(
        await diagnostics(t, { 'AGENTS.md': 'Ask @maintainer' }),
        []
    );
});

for (const wrapper of ['\\`', '&#96;']) {
    test(`visible literal backticks preserve imports: ${wrapper}`, async (t) => {
        const result = await diagnostics(t, {
            'CLAUDE.md':
                '@AGENTS.md\n\nRead ' + wrapper + '@docs/example.md' + wrapper,
        });
        assert.ok(
            result.some((message) => message.includes('additional or inline'))
        );
    });
}
for (const filename of [
    'Guide (old).md',
    "Author's guide.md",
    'Guide [draft].md',
]) {
    test(`explicit path punctuation is validated: ${filename}`, async (t) => {
        const guidance = '`./docs/' + filename + '`';
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': guidance,
                ['docs/' + filename]: '# Guide',
            }),
            []
        );
        assert.ok((await diagnostics(t, { 'AGENTS.md': guidance })).length > 0);
    });
}

for (const target of ['docs/missing.md', 'docs/example.md#missing']) {
    test(`image-map navigation is validated: ${target}`, async (t) => {
        assert.ok(
            (
                await diagnostics(t, {
                    'AGENTS.md': `<map><area href="${target}"></map>`,
                })
            ).length > 0
        );
    });
}
test('valid image-map navigation and inert areas pass', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '<map><area href="docs/example.md#repeat"></map>\n<template><map><area href="missing.md"></map></template>',
        }),
        []
    );
});

for (const ending of ['\n', '\r\n', '\r']) {
    for (const [source, limit] of [
        ['AGENTS.md', 200],
        ['CLAUDE.md', 30],
    ]) {
        test(`line budget handles ${JSON.stringify(ending)} in ${source}`, async (t) => {
            const lines = [
                source === 'CLAUDE.md' ? '@AGENTS.md' : '# Guidance',
                ...Array(limit - 1).fill('# Section'),
            ];
            assert.deepEqual(
                await diagnostics(t, { [source]: lines.join(ending) + ending }),
                []
            );
            const result = await diagnostics(t, {
                [source]: [...lines, '# Extra'].join(ending) + ending,
            });
            assert.ok(
                result.some((message) =>
                    message.includes(
                        `at most ${limit} lines allowed (received ${limit + 1})`
                    )
                )
            );
        });
    }
}

for (const punctuation of ['—its', '–its', '…', '，next', '。next', '”']) {
    test(`package mention stops at Unicode punctuation: ${punctuation}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'package.json': JSON.stringify({
                    dependencies: { '@angular/core': '*' },
                }),
                'AGENTS.md': 'Use @angular/core' + punctuation + ' APIs',
            }),
            []
        );
    });
}

for (const suffix of ['—then', '，next', '”']) {
    test(`extensionless imports stop at Unicode punctuation: ${suffix}`, async (t) => {
        const result = await diagnostics(t, {
            'CLAUDE.md':
                '@AGENTS.md\n\nRead @INSTRUCTIONS' + suffix + ' continue',
            INSTRUCTIONS: 'Additional guidance',
        });
        assert.ok(
            result.some((message) => message.includes('additional or inline'))
        );
    });
}

for (const name of ['INSTRUCTIONS—v2', 'INSTRUCTIONS,extra']) {
    test(`full punctuation filename remains an import: ${name}`, async (t) => {
        assert.ok(
            (
                await diagnostics(t, {
                    'CLAUDE.md': '@AGENTS.md\n\nRead @' + name,
                    [name]: 'Guidance',
                })
            ).some((message) => message.includes('additional or inline'))
        );
    });
}
for (const suffix of [',then', ';then', ':then', '!then', '?then']) {
    test(`ASCII prose boundary handles imports and packages: ${suffix}`, async (t) => {
        assert.ok(
            (
                await diagnostics(t, {
                    'CLAUDE.md': '@AGENTS.md\n\nRead @INSTRUCTIONS' + suffix,
                    INSTRUCTIONS: 'Guidance',
                })
            ).some((message) => message.includes('additional or inline'))
        );
        assert.deepEqual(
            await diagnostics(t, {
                'AGENTS.md': 'Use @angular/core' + suffix + ' continue',
                'package.json': JSON.stringify({
                    dependencies: { '@angular/core': '*' },
                }),
            }),
            []
        );
    });
}

for (const target of ['docs/missing.html', 'docs/example.md#missing']) {
    test(`iframe document target is validated: ${target}`, async (t) => {
        assert.ok(
            (
                await diagnostics(t, {
                    'AGENTS.md': `<iframe src="${target}"></iframe>`,
                })
            ).length > 0
        );
    });
}
test('valid iframe and inert iframe targets pass', async (t) => {
    assert.deepEqual(
        await diagnostics(t, {
            'AGENTS.md':
                '<iframe src="docs/example.md#repeat"></iframe>\n<template><iframe src="missing.html"></iframe></template>',
        }),
        []
    );
});

for (const suffix of [
    '.md#rules',
    '.md?view=raw#rules',
    '.txt#rules',
    '.json#rules',
]) {
    test(`package document imports retain suffix guards: ${suffix}`, async (t) => {
        assert.ok(
            (
                await diagnostics(t, {
                    'package.json': JSON.stringify({
                        dependencies: { '@angular/core': '*' },
                    }),
                    'CLAUDE.md':
                        '@AGENTS.md\n\nRead @angular/core/docs/extra' + suffix,
                })
            ).some((message) => message.includes('additional or inline'))
        );
    });
}

for (const suffix of [
    '.markdown',
    '.mdown',
    '.mkd',
    '.md%23rules',
    '.md%3Fraw',
    '%2Emd',
    '/%2e%2e/extra.md',
]) {
    test(`document package exemptions reject alternate and encoded paths: ${suffix}`, async (t) => {
        assert.ok(
            (
                await diagnostics(t, {
                    'package.json': JSON.stringify({
                        dependencies: { '@angular/core': '*' },
                    }),
                    'CLAUDE.md':
                        '@AGENTS.md\n\nRead @angular/core/docs/extra' + suffix,
                })
            ).some((message) => message.includes('additional or inline'))
        );
    });
}

for (const version of ['*', '22.*', '22.1.*']) {
    test(`wildcard package version is prose: ${version}`, async (t) => {
        assert.deepEqual(
            await diagnostics(t, {
                'package.json': JSON.stringify({
                    dependencies: { '@angular/core': '*' },
                }),
                'AGENTS.md': 'Use @angular/core@' + version,
            }),
            []
        );
    });
}
for (const extension of ['rst', 'rest', 'adoc', 'asciidoc']) {
    test(`non-Markdown document is not a package exemption: ${extension}`, async (t) => {
        assert.ok(
            (
                await diagnostics(t, {
                    'package.json': JSON.stringify({
                        dependencies: { '@angular/core': '*' },
                    }),
                    'CLAUDE.md':
                        '@AGENTS.md\n\nRead @angular/core/docs/guide.' +
                        extension,
                })
            ).some((message) => message.includes('additional or inline'))
        );
    });
}

for (const extension of ['pdf', 'doc', 'docx', 'odt', 'rtf', 'org', 'tex']) {
    test(`document format is not a package exemption: ${extension}`, async (t) => {
        assert.ok(
            (
                await diagnostics(t, {
                    'package.json': JSON.stringify({
                        dependencies: { '@angular/core': '*' },
                    }),
                    'CLAUDE.md':
                        '@AGENTS.md\n\nRead @angular/core/docs/guide.' +
                        extension,
                })
            ).some((message) => message.includes('additional or inline'))
        );
    });
}
for (const html of [
    '<a href=" docs/example.md#repeat ">Guide</a>',
    '<iframe src="&#9;docs/example.md&#10;"></iframe>',
    '<img src=" docs/example.md ">',
]) {
    test(`HTML URL edge whitespace is ignored: ${html}`, async (t) => {
        assert.deepEqual(await diagnostics(t, { 'AGENTS.md': html }), []);
    });
}

for (const name of [
    'guide.ods',
    'guide.odp',
    'guide.docm',
    'guide.dotx',
    'guide.latex',
    'AGENTS',
    'CLAUDE',
    'README',
    'INSTRUCTIONS',
    'LICENSE',
]) {
    test(`package subpath cannot import guidance document ${name}`, async (t) => {
        assert.ok(
            (
                await diagnostics(t, {
                    'package.json': JSON.stringify({
                        dependencies: { '@angular/core': '*' },
                    }),
                    'CLAUDE.md':
                        '@AGENTS.md\n\nRead @angular/core/docs/' + name,
                })
            ).some((message) => message.includes('additional or inline'))
        );
    });
}
