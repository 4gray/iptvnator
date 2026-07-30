import assert from 'node:assert/strict';
import {
    mkdir,
    mkdtemp,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

import { validateRepositorySkills } from './validate-repository-skills.mjs';

const validReleaseSkills = {
    'release-cut': `---
name: release-cut
description: Use when preparing a repository release.
---

# Release Cut
`,
    'release-notes': `---
name: release-notes
description: Use when deciding whether a change needs release notes.
---

# Release Notes
`,
};

async function writeFixtureFile(rootDir, relativePath, contents) {
    const absolutePath = join(rootDir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
}

async function createRepository(
    t,
    {
        directoryName = 'example-skill',
        name = directoryName,
        description =
            '"Use when deciding whether type: internal applies to a change."',
        body = [
            '# Example Skill',
            '',
            'Inspect `package.json` and `tools/existing.mjs`.',
            'Examples such as `apps/*-e2e` and `libs/<domain>/feature` are not literal paths.',
            '',
        ].join('\n'),
        releaseMirrorTransform = (contents) => contents,
    } = {}
) {
    const rootDir = await mkdtemp(join(tmpdir(), 'repository-skills-'));
    t.after(() => rm(rootDir, { recursive: true, force: true }));

    await writeFixtureFile(rootDir, 'package.json', '{}\n');
    await writeFixtureFile(rootDir, 'tools/existing.mjs', 'export {};\n');
    await writeFixtureFile(
        rootDir,
        '.codex/skills/not-a-skill/README.md',
        'No SKILL.md lives here.\n'
    );
    await writeFixtureFile(
        rootDir,
        `.codex/skills/${directoryName}/SKILL.md`,
        `---
name: ${name}
description: ${description}
---

${body}`
    );
    await writeFixtureFile(
        rootDir,
        '.codex/skills/single-quoted-skill/SKILL.md',
        `---
name: single-quoted-skill
description: 'Use when deciding whether type: internal applies to a release.'
---

# Single-Quoted Skill
`
    );

    for (const [skillName, contents] of Object.entries(validReleaseSkills)) {
        await writeFixtureFile(
            rootDir,
            `.codex/skills/${skillName}/SKILL.md`,
            contents
        );
        await writeFixtureFile(
            rootDir,
            `.claude/skills/${skillName}/SKILL.md`,
            releaseMirrorTransform(contents, skillName)
        );
    }

    return rootDir;
}

test('accepts single- and double-quoted colon-space descriptions and skips path examples', async (t) => {
    const rootDir = await createRepository(t);

    const result = await validateRepositorySkills({ rootDir });

    assert.deepEqual(result, {
        checkedSkills: 4,
        diagnostics: [],
    });
});

test('reports a frontmatter name that differs from its directory', async (t) => {
    const rootDir = await createRepository(t, { name: 'different-name' });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        '.codex/skills/example-skill/SKILL.md: frontmatter name "different-name" must match directory "example-skill"',
    ]);
});

test('reports a description that does not begin with Use when', async (t) => {
    const rootDir = await createRepository(t, {
        description: 'Repository-specific implementation guidance.',
    });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        '.codex/skills/example-skill/SKILL.md: description must start with "Use when"',
    ]);
});

test('reports a description longer than 500 characters', async (t) => {
    const description = `Use when ${'x'.repeat(493)}`;
    assert.equal(description.length, 502);
    const rootDir = await createRepository(t, { description });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        '.codex/skills/example-skill/SKILL.md: description must be at most 500 characters (received 502)',
    ]);
});

test('rejects an indented plain-scalar description continuation', async (t) => {
    const rootDir = await createRepository(t, {
        description: `Use when editing a skill.\n  ${'x'.repeat(501)}`,
    });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        '.codex/skills/example-skill/SKILL.md: description must be a one-line frontmatter value',
    ]);
});

test('rejects a blank-separated plain-scalar description continuation', async (t) => {
    const rootDir = await createRepository(t, {
        description: `Use when editing a skill.\n\n  ${'x'.repeat(501)}`,
    });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        '.codex/skills/example-skill/SKILL.md: description must be a one-line frontmatter value',
    ]);
});

test('allows a blank frontmatter separator without treating it as a continuation', async (t) => {
    const rootDir = await createRepository(t, {
        description: 'Use when editing a skill.\n  ',
    });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, []);
});

test('reports a complete skill longer than 500 words', async (t) => {
    const rootDir = await createRepository(t, {
        body: `# Example Skill\n\n${Array.from({ length: 501 }, () => 'word').join(' ')}`,
    });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.equal(diagnostics.length, 1);
    assert.match(
        diagnostics[0],
        /^\.codex\/skills\/example-skill\/SKILL\.md: skill must be at most 500 words \(received \d+\)$/
    );
});

test('reports a backticked literal repository path that does not exist', async (t) => {
    const rootDir = await createRepository(t, {
        body: '# Example Skill\n\nInspect `docs/missing-file.md`.',
    });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        '.codex/skills/example-skill/SKILL.md: referenced path does not exist: docs/missing-file.md',
    ]);
});

test('rejects a literal path that escapes the repository even when it exists', async (t) => {
    const rootDir = await createRepository(t);
    const outsideName = `${basename(rootDir)}-outside.md`;
    const outsidePath = join(dirname(rootDir), outsideName);
    const referencedPath = `docs/../../${outsideName}`;
    t.after(() => rm(outsidePath, { force: true }));
    await writeFile(outsidePath, 'outside\n');
    await writeFixtureFile(
        rootDir,
        '.codex/skills/example-skill/SKILL.md',
        `---
name: example-skill
description: Use when validating a literal path.
---

Inspect \`${referencedPath}\`.
`
    );

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        `.codex/skills/example-skill/SKILL.md: referenced path escapes repository root: ${referencedPath}`,
    ]);
});

test(
    'propagates non-missing path access failures',
    { skip: process.platform === 'win32' },
    async (t) => {
        const rootDir = await createRepository(t, {
            body: '# Example Skill\n\nInspect `docs/loop/file.md`.',
        });
        await mkdir(join(rootDir, 'docs'));
        await symlink('loop', join(rootDir, 'docs/loop'));

        await assert.rejects(
            validateRepositorySkills({ rootDir }),
            (error) => {
                assert.equal(error.code, 'ELOOP');
                return true;
            }
        );
    }
);

test('reports byte-different release skill mirrors', async (t) => {
    const rootDir = await createRepository(t, {
        releaseMirrorTransform: (contents, skillName) =>
            skillName === 'release-notes' ? `${contents}\n` : contents,
    });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        '.codex/skills/release-notes/SKILL.md: differs from .claude/skills/release-notes/SKILL.md',
    ]);
});

test('reports a missing release skill mirror without stopping validation', async (t) => {
    const rootDir = await createRepository(t, {
        description: 'Implementation guidance.',
    });
    await rm(
        join(rootDir, '.claude/skills/release-cut/SKILL.md')
    );

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        '.codex/skills/example-skill/SKILL.md: description must start with "Use when"',
        '.claude/skills/release-cut/SKILL.md: required release skill mirror is missing',
    ]);
});

test('returns every diagnostic in deterministic order', async (t) => {
    const rootDir = await createRepository(t, {
        name: 'wrong-name',
        description: 'Implementation guidance.',
        body: 'Inspect `docs/z-missing.md` and `docs/a-missing.md`.',
        releaseMirrorTransform: (contents, skillName) =>
            skillName === 'release-notes' ? `${contents}\n` : contents,
    });

    const { diagnostics } = await validateRepositorySkills({ rootDir });

    assert.deepEqual(diagnostics, [
        '.codex/skills/example-skill/SKILL.md: frontmatter name "wrong-name" must match directory "example-skill"',
        '.codex/skills/example-skill/SKILL.md: description must start with "Use when"',
        '.codex/skills/example-skill/SKILL.md: referenced path does not exist: docs/a-missing.md',
        '.codex/skills/example-skill/SKILL.md: referenced path does not exist: docs/z-missing.md',
        '.codex/skills/release-notes/SKILL.md: differs from .claude/skills/release-notes/SKILL.md',
    ]);
});
