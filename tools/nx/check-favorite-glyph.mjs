import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
    iconNamesInTemplate,
    iconNamesInTypeScript,
} from './icon-ligature-sources.mjs';

/**
 * The heart means "favourite" and the star means "rating" (UI-46). Before the
 * registry, favourite toggles used stars in some views and hearts in others.
 * This guard keeps every star and heart ligature in
 * `@iptvnator/ui/components/app-icons`, where the key (`favorite`,
 * `favoriteOutline`, `rating`, ...) states the meaning, and checks that the
 * registry maps each meaning to the right glyph family.
 */
export const REGISTRY_FILE =
    'libs/ui/components/src/lib/app-icons/app-icons.ts';

/** Every Material Icons ligature that draws a star. */
export const STAR_GLYPHS = new Set([
    'grade',
    'star',
    'star_border',
    'star_half',
    'star_outline',
    'star_purple500',
    'star_rate',
    'stars',
]);

/** Every Material Icons ligature that draws a heart. */
export const HEART_GLYPHS = new Set([
    'favorite',
    'favorite_border',
    'favorite_outline',
]);

/** Registry keys and the glyph family each must use. */
const KEY_FAMILIES = [
    { pattern: /^favorite/i, family: HEART_GLYPHS, name: 'a heart' },
    { pattern: /^rating/i, family: STAR_GLYPHS, name: 'a star' },
];

const SCANNED_PATHSPECS = [
    'apps/web/*.html',
    'apps/web/*.ts',
    'libs/*.html',
    'libs/*.ts',
];

function isScanned(file) {
    return file !== REGISTRY_FILE && !/\.(spec|test)\.[cm]?[jt]s$/.test(file);
}

/** Star or heart ligatures written outside the registry. */
export function findLiteralGlyphs(file, source) {
    const found = file.endsWith('.html')
        ? iconNamesInTemplate(source, file)
        : iconNamesInTypeScript(source, file);
    return found
        .filter(({ name }) => STAR_GLYPHS.has(name) || HEART_GLYPHS.has(name))
        .map((entry) => ({
            file,
            ...entry,
            reason: STAR_GLYPHS.has(entry.name)
                ? 'use APP_ICONS.rating / ratingOutline (a star is a rating only)'
                : 'use APP_ICONS.favorite / favoriteOutline or favoriteIcon()',
        }));
}

function unwrap(node) {
    while (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isTypeAssertionExpression(node)
    ) {
        node = node.expression;
    }
    return node;
}

/** Text of an identifier, string or template literal without substitutions. */
function staticText(node) {
    if (
        ts.isIdentifier(node) ||
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
    ) {
        return node.text;
    }
    return undefined;
}

/** `APP_ICONS` entries whose glyph does not match the meaning of the key. */
export function findRegistryMismatches(source, file = REGISTRY_FILE) {
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    let registry;
    const visit = (node) => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'APP_ICONS'
        ) {
            registry = node.initializer && unwrap(node.initializer);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (!registry || !ts.isObjectLiteralExpression(registry)) {
        return [{ file, line: 1, name: 'APP_ICONS', reason: 'not found' }];
    }

    const findings = [];
    for (const property of registry.properties) {
        const line =
            sourceFile.getLineAndCharacterOfPosition(
                property.getStart(sourceFile)
            ).line + 1;
        const key = ts.isPropertyAssignment(property)
            ? staticText(property.name)
            : undefined;
        const value = ts.isPropertyAssignment(property)
            ? unwrap(property.initializer)
            : undefined;
        const glyph = value && staticText(value);
        if (key === undefined || glyph === undefined) {
            findings.push({
                file,
                line,
                name: property.getText(sourceFile).split('\n')[0],
                reason: "registry entries must be static `key: 'ligature'` pairs",
            });
            continue;
        }
        const rule = KEY_FAMILIES.find(({ pattern }) => pattern.test(key));
        if (rule && !rule.family.has(glyph)) {
            findings.push({
                file,
                line,
                name: `${key}: '${glyph}'`,
                reason: `must be ${rule.name}`,
            });
        }
        if (!rule && STAR_GLYPHS.has(glyph)) {
            findings.push({
                file,
                line,
                name: `${key}: '${glyph}'`,
                reason: 'a star is reserved for rating* keys',
            });
        }
    }
    return findings;
}

export function listScannedFiles(rootDir) {
    // No shell, so the pathspecs reach git intact on Windows too.
    return execFileSync('git', ['ls-files', ...SCANNED_PATHSPECS], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })
        .trim()
        .split('\n')
        .filter(Boolean)
        .filter(isScanned);
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    const files = listScannedFiles(rootDir);
    const findings = findRegistryMismatches(
        await readFile(path.join(rootDir, REGISTRY_FILE), 'utf8')
    );
    for (const file of files) {
        const source = await readFile(path.join(rootDir, file), 'utf8');
        findings.push(...findLiteralGlyphs(file, source));
    }

    if (findings.length > 0) {
        console.error(
            `Star and heart icons must come from APP_ICONS (${REGISTRY_FILE}): the heart means favourite, the star means rating.`
        );
        for (const { file, line, name, reason } of findings) {
            console.error(`- ${file}:${line} ${name} — ${reason}`);
        }
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} renderer files and the APP_ICONS registry; every star and heart icon goes through the registry.`
        );
    }
}
