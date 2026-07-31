import { access, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS_ROOT = '.codex/skills';
const MIRRORED_SKILLS = ['release-cut', 'release-notes'];
const PATH_PREFIXES = [
    'apps/',
    'libs/',
    'docs/',
    'tools/',
    '.changes/',
    '.github/',
];
const ROOT_PATHS = new Set([
    'package.json',
    'pnpm-lock.yaml',
    'nx.json',
    'tsconfig.base.json',
    'eslint.config.mjs',
    'CHANGELOG.md',
    'AGENTS.md',
    'CLAUDE.md',
]);
const NON_LITERAL_PATH_CHARACTERS = /[*?[\]{}<>]/u;

function compareNames(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function unquoteScalar(value) {
    if (value.length < 2) return value;

    const firstCharacter = value[0];
    const lastCharacter = value.at(-1);
    const hasMatchingQuotes =
        (firstCharacter === '"' || firstCharacter === "'") &&
        lastCharacter === firstCharacter;

    return hasMatchingQuotes ? value.slice(1, -1) : value;
}

function parseFrontmatter(markdown) {
    const lines = markdown.split(/\r?\n/u);
    if (lines[0] !== '---') {
        return { fields: {}, continuedFields: new Set() };
    }

    const closingDelimiter = lines.indexOf('---', 1);
    if (closingDelimiter === -1) {
        return { fields: {}, continuedFields: new Set() };
    }

    const fields = {};
    const continuedFields = new Set();
    let activeField;

    for (const line of lines.slice(1, closingDelimiter)) {
        if (line.trim() === '') continue;

        if (/^[ \t]/u.test(line)) {
            if (activeField !== undefined) {
                continuedFields.add(activeField);
            }
            continue;
        }

        const separator = line.indexOf(':');
        if (separator <= 0) {
            activeField = undefined;
            continue;
        }

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        fields[key] = unquoteScalar(value);
        activeField = key;
    }

    return { fields, continuedFields };
}

function countWords(markdown) {
    const trimmedMarkdown = markdown.trim();
    return trimmedMarkdown === ''
        ? 0
        : trimmedMarkdown.split(/\s+/u).length;
}

function findLiteralRepositoryPaths(markdown) {
    const paths = new Set();

    for (const match of markdown.matchAll(/`([^`\r\n]+)`/gu)) {
        const token = match[1];
        const isRepositoryPath =
            ROOT_PATHS.has(token) ||
            PATH_PREFIXES.some((prefix) => token.startsWith(prefix));

        if (isRepositoryPath && !NON_LITERAL_PATH_CHARACTERS.test(token)) {
            paths.add(token);
        }
    }

    return [...paths].sort(compareNames);
}

async function pathExists(path) {
    try {
        await access(path);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
            return false;
        }
        throw error;
    }
}

function isPathWithinRoot(rootDir, absolutePath) {
    const relativePath = relative(resolve(rootDir), absolutePath);
    return (
        relativePath === '' ||
        (!isAbsolute(relativePath) &&
            relativePath !== '..' &&
            !relativePath.startsWith(`..${sep}`))
    );
}

async function readFileIfPresent(path) {
    try {
        return await readFile(path);
    } catch (error) {
        if (error?.code === 'ENOENT') return undefined;
        throw error;
    }
}

async function validateSkill({ rootDir, directoryName }) {
    const relativePath = `${SKILLS_ROOT}/${directoryName}/SKILL.md`;
    const markdown = await readFile(resolve(rootDir, relativePath), 'utf8');
    const { fields: frontmatter, continuedFields } =
        parseFrontmatter(markdown);
    const diagnostics = [];

    if (frontmatter.name !== directoryName) {
        diagnostics.push(
            `${relativePath}: frontmatter name "${frontmatter.name ?? ''}" must match directory "${directoryName}"`
        );
    }

    if (
        typeof frontmatter.description !== 'string' ||
        frontmatter.description === '' ||
        continuedFields.has('description')
    ) {
        diagnostics.push(
            `${relativePath}: description must be a one-line frontmatter value`
        );
    } else {
        if (!frontmatter.description.startsWith('Use when')) {
            diagnostics.push(
                `${relativePath}: description must start with "Use when"`
            );
        }
        if (frontmatter.description.length > 500) {
            diagnostics.push(
                `${relativePath}: description must be at most 500 characters (received ${frontmatter.description.length})`
            );
        }
    }

    const wordCount = countWords(markdown);
    if (wordCount > 500) {
        diagnostics.push(
            `${relativePath}: skill must be at most 500 words (received ${wordCount})`
        );
    }

    for (const referencedPath of findLiteralRepositoryPaths(markdown)) {
        const absolutePath = resolve(rootDir, referencedPath);
        if (!isPathWithinRoot(rootDir, absolutePath)) {
            diagnostics.push(
                `${relativePath}: referenced path escapes repository root: ${referencedPath}`
            );
            continue;
        }
        if (!(await pathExists(absolutePath))) {
            diagnostics.push(
                `${relativePath}: referenced path does not exist: ${referencedPath}`
            );
        }
    }

    return diagnostics;
}

async function validateReleaseMirrors(rootDir) {
    const diagnostics = [];

    for (const skillName of MIRRORED_SKILLS) {
        const codexPath = `.codex/skills/${skillName}/SKILL.md`;
        const claudePath = `.claude/skills/${skillName}/SKILL.md`;
        const [codexContents, claudeContents] = await Promise.all([
            readFileIfPresent(resolve(rootDir, codexPath)),
            readFileIfPresent(resolve(rootDir, claudePath)),
        ]);

        if (codexContents === undefined) {
            diagnostics.push(
                `${codexPath}: required release skill mirror is missing`
            );
        }
        if (claudeContents === undefined) {
            diagnostics.push(
                `${claudePath}: required release skill mirror is missing`
            );
        }
        if (
            codexContents !== undefined &&
            claudeContents !== undefined &&
            !codexContents.equals(claudeContents)
        ) {
            diagnostics.push(`${codexPath}: differs from ${claudePath}`);
        }
    }

    return diagnostics;
}

export async function validateRepositorySkills({ rootDir }) {
    const directoryEntries = (await readdir(resolve(rootDir, SKILLS_ROOT), {
        withFileTypes: true,
    }))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => compareNames(left.name, right.name));
    const skillDirectories = [];
    const diagnostics = [];

    for (const entry of directoryEntries) {
        if (
            await pathExists(
                resolve(rootDir, SKILLS_ROOT, entry.name, 'SKILL.md')
            )
        ) {
            skillDirectories.push(entry.name);
        }
    }

    for (const directoryName of skillDirectories) {
        diagnostics.push(
            ...(await validateSkill({ rootDir, directoryName }))
        );
    }

    diagnostics.push(...(await validateReleaseMirrors(rootDir)));

    return {
        checkedSkills: skillDirectories.length,
        diagnostics,
    };
}

async function runCli() {
    const { checkedSkills, diagnostics } = await validateRepositorySkills({
        rootDir: process.cwd(),
    });

    if (diagnostics.length > 0) {
        for (const diagnostic of diagnostics) {
            console.error(diagnostic);
        }
        process.exitCode = 1;
        return;
    }

    console.log(`Validated ${checkedSkills} repository skills.`);
}

const isCli =
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
    await runCli();
}
