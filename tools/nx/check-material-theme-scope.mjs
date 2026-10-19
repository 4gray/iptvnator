import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isScanned, stripComments } from './check-theme-references.mjs';
import { componentTemplates } from './component-templates.mjs';

/**
 * `apps/web/src/m3-theme.scss` themes only the Material components the app
 * imports, through its `$material-components` list; `all-component-themes`
 * also emitted about 24 KB of tokens for components nothing uses. This guard
 * keeps the list in step with the imports in both directions: a component a
 * new `@angular/material/<entry>` import brings in must be themed, or it
 * renders with no colours at all, and a component whose last import went
 * must leave the list. The fab theme follows the templates instead: the
 * button chunk carries its directives either way, so only a rendered
 * `mat-fab` or `mat-mini-fab` earns its tokens.
 */

/** Angular renderer sources that load the theme (the remote control has its own styles). */
const SCANNED_PATHSPECS = ['apps/web/*.ts', 'libs/*.ts'];

export const THEME_FILE = 'apps/web/src/m3-theme.scss';

/**
 * Runtime imports of a Material entry point: a static import that is not
 * type-only (a `type` specifier list leaves nothing in the bundle) and a
 * dynamic `import()` such as the one LazyMatDialog makes. A type-only
 * import renders no component and so needs no theme.
 */
const STATIC_IMPORT =
    /(?<![\w$.])import\s+(?!type\s)[^;]*?from\s+['"]@angular\/material\/([a-z-]+)['"]/g;
const DYNAMIC_IMPORT =
    /\bimport\(\s*['"]@angular\/material\/([a-z-]+)['"]\s*\)/g;

/**
 * The theme mixins (`mat.<name>-theme`, `mat.<name>-color`) each Material
 * entry point needs. An entry point that is not listed has no themed
 * component.
 */
export const THEMES_BY_ENTRY_POINT = new Map([
    ['autocomplete', ['autocomplete']],
    ['badge', ['badge']],
    ['bottom-sheet', ['bottom-sheet']],
    ['button', ['button', 'icon-button']],
    ['button-toggle', ['button-toggle']],
    ['card', ['card']],
    ['checkbox', ['checkbox']],
    ['chips', ['chips']],
    ['core', ['core']],
    ['datepicker', ['datepicker']],
    ['dialog', ['dialog']],
    ['divider', ['divider']],
    ['expansion', ['expansion']],
    ['form-field', ['form-field']],
    ['grid-list', ['grid-list']],
    ['icon', ['icon']],
    ['input', ['input']],
    ['list', ['list']],
    ['menu', ['menu']],
    ['paginator', ['paginator']],
    ['progress-bar', ['progress-bar']],
    ['progress-spinner', ['progress-spinner']],
    ['radio', ['radio']],
    ['select', ['select']],
    ['sidenav', ['sidenav']],
    ['slide-toggle', ['slide-toggle']],
    ['slider', ['slider']],
    ['snack-bar', ['snack-bar']],
    ['sort', ['sort']],
    ['stepper', ['stepper']],
    ['table', ['table']],
    ['tabs', ['tabs']],
    ['timepicker', ['timepicker']],
    ['toolbar', ['toolbar']],
    ['tooltip', ['tooltip']],
    ['tree', ['tree']],
]);

/**
 * Themed whatever is imported: `core` carries the ripple, option, optgroup
 * and pseudo-checkbox tokens that select, menu and list render with.
 */
export const ALWAYS_THEMED = ['core'];

/**
 * Material entry points the runtime sources import at runtime, statically or
 * dynamically, with one importer each.
 */
export function usedEntryPoints(sources) {
    const importers = new Map();
    for (const { file, source } of sources) {
        const code = stripComments(source);
        for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
            for (const match of code.matchAll(pattern)) {
                if (!importers.has(match[1])) importers.set(match[1], file);
            }
        }
    }
    return importers;
}

/**
 * Themes a rendered element, not an import, calls for. The button entry
 * point carries the fab directives whether or not a template uses them, but
 * their tokens are about 6 KB of the initial stylesheet that only an element
 * with one of the fab attribute selectors reads. The pattern matches that
 * attribute on an element, never in text, a class value or a comment.
 */
export const THEMES_BY_TEMPLATE = new Map([
    [
        'fab',
        /<[a-z][^\s<>/]*(?:[^<>"']|"[^"]*"|'[^']*')*?\s(mat-fab|mat-mini-fab|matFab|matMiniFab)(?=[\s/>=])/i,
    ],
]);

/**
 * An Angular template knows HTML comments only: `//` there is text or part
 * of a URL, never a comment, so the source-code rules of `stripComments`
 * would blank a real element after it.
 */
function stripHtmlComments(template) {
    return template.replace(/<!--[\s\S]*?-->/g, ' ');
}

/**
 * The template-gated themes the runtime templates render, each with the
 * first component template that renders the element and the attribute it
 * carries. `readTemplate` reads a `templateUrl` relative to its component.
 */
export async function templateThemeUsers(sources, readTemplate) {
    const users = new Map();
    for (const { file, source } of sources) {
        if (users.size === THEMES_BY_TEMPLATE.size) break;
        const templates = await componentTemplates(file, source, readTemplate);
        for (const template of templates) {
            const markup = stripHtmlComments(template);
            for (const [name, element] of THEMES_BY_TEMPLATE) {
                const match = users.has(name) ? null : element.exec(markup);
                if (match) users.set(name, { file, selector: match[1] });
            }
        }
    }
    return users;
}

/**
 * The theme names the imported entry points and the rendered templates
 * need, each with a reason.
 */
export function requiredThemes(importers, templateUsers = new Map()) {
    const required = new Map(
        ALWAYS_THEMED.map((name) => [name, 'always themed'])
    );
    for (const [entryPoint, file] of importers) {
        for (const name of THEMES_BY_ENTRY_POINT.get(entryPoint) ?? []) {
            if (!required.has(name)) {
                required.set(
                    name,
                    `@angular/material/${entryPoint} in ${file}`
                );
            }
        }
    }
    for (const [name, { file, selector }] of templateUsers) {
        if (!required.has(name)) required.set(name, `${selector} in ${file}`);
    }
    return required;
}

/**
 * The components the theme file themes: the `$material-components` list
 * plus any `mat.<name>-theme` included directly. `all` means
 * `all-component-themes` is still included, which themes everything.
 */
export function themedComponents(scss) {
    const themed = new Set();
    const list = scss.match(/\$material-components\s*:\s*\(([^)]*)\)/);
    if (list) {
        for (const item of list[1].split(',')) {
            const name = item.replace(/\/\/.*$/gm, '').trim();
            if (name) themed.add(name);
        }
    }
    for (const match of scss.matchAll(/@include\s+mat\.([a-z-]+)-theme\(/g)) {
        themed.add(match[1]);
    }
    return {
        themed,
        all: /@include\s+mat\.all-component-themes\(/.test(scss),
    };
}

/**
 * Themes that imports need but the file lacks, and themes the file carries
 * that no import needs.
 */
export function compareThemeScope(required, { themed, all }) {
    const unthemed = all
        ? []
        : [...required].filter(([name]) => !themed.has(name));
    const unused = [...themed].filter((name) => !required.has(name));
    return { unthemed, unused };
}

/** Tracked renderer sources the guard reads, at any depth. */
export function listScannedFiles(rootDir) {
    // No shell: `cmd.exe` treats single quotes as literal characters, so a
    // POSIX-quoted pathspec reaches git intact on Windows and matches nothing.
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
    const sources = await Promise.all(
        files.map(async (file) => ({
            file,
            source: await readFile(path.join(rootDir, file), 'utf8'),
        }))
    );
    const readTemplate = (file) => readFile(path.join(rootDir, file), 'utf8');
    const required = requiredThemes(
        usedEntryPoints(sources),
        await templateThemeUsers(sources, readTemplate)
    );
    const scope = themedComponents(
        await readFile(path.join(rootDir, THEME_FILE), 'utf8')
    );
    const { unthemed, unused } = compareThemeScope(required, scope);

    if (unthemed.length > 0) {
        console.error(
            `Material components the app imports or renders but ${THEME_FILE} does not theme; they render without colours. Add them to $material-components:`
        );
        for (const [name, reason] of unthemed) {
            console.error(`- ${name} (${reason})`);
        }
        process.exitCode = 1;
    }
    if (unused.length > 0) {
        console.error(
            `Material components ${THEME_FILE} themes although no runtime source imports or renders them; their tokens only add to the initial stylesheet. Remove them from $material-components:`
        );
        for (const name of unused) {
            console.error(`- ${name}`);
        }
        process.exitCode = 1;
    }
    if (!process.exitCode) {
        console.log(
            scope.all
                ? `Checked ${files.length} renderer sources; ${THEME_FILE} themes every Material component through all-component-themes.`
                : `Checked ${files.length} renderer sources; ${THEME_FILE} themes exactly the ${scope.themed.size} Material components they use.`
        );
    }
}
