import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    parseTemplate,
    TmplAstRecursiveVisitor,
    tmplAstVisitAll,
} from '@angular/compiler';

import { inlineTemplates } from './inline-templates.mjs';

/**
 * Buttons and pickers follow the UI kit (`libs/ui/styles/_app-controls.scss`,
 * "Forms" and "Icon-Only Buttons" in the UI guidelines). Button variants are
 * roles: `mat-flat-button` is a secondary or accent action, `mat-button` and
 * `mat-icon-button` are ghost row and header actions. This guard reports, in
 * runtime templates (component HTML and inline templates):
 *
 * - `variant`: a raised, tonal or fab button, which the kit has no role
 *   for, and an outlined one except as a destructive action
 *   (`app-destructive-button`, the danger tint). Both spellings count:
 *   `mat-raised-button`, `mat-stroked-button`, `mat-fab`, `mat-mini-fab`
 *   and `matFab`, `matMiniFab`, `matButton="elevated" | "outlined" |
 *   "tonal"`; a `[matButton]` the guard cannot read is reported too;
 * - `color`: a `color` attribute or binding on a Material element. It picks
 *   an M3 palette role the kit does not use; the look comes from the mixins;
 * - `native-select`: a `<select>`. A toolbar picker is a secondary button
 *   with a chevron that opens a `mat-menu`; a form field is a `mat-select`;
 * - `select-outside-field`: a `mat-select` without a `mat-form-field` around
 *   it in the same template.
 *
 * `ALLOWED` names the files that keep a finding, each with its reason.
 */
export const ALLOWED = {};

/** Attribute selectors of Material's buttons, mapped to their variant. */
const VARIANT_ATTRIBUTES = {
    'mat-raised-button': 'raised',
    'mat-stroked-button': 'outlined',
    'mat-fab': 'fab',
    'mat-mini-fab': 'fab',
    matFab: 'fab',
    matMiniFab: 'fab',
};
/** `matButton` appearances; `''` is Material's default, the text button. */
const APPEARANCES = {
    '': 'text',
    text: 'text',
    filled: 'filled',
    elevated: 'raised',
    outlined: 'outlined',
    tonal: 'tonal',
};
const OFF_KIT = new Set(['raised', 'tonal', 'fab']);
const DESTRUCTIVE_CLASS = 'app-destructive-button';

const SCANNED_PATHSPECS = [
    'apps/web/*.html',
    'apps/web/*.ts',
    'libs/*.html',
    'libs/*.ts',
];

export function isScanned(file) {
    return (
        !/\.(spec|test|e2e)\.[cm]?[jt]s$/.test(file) &&
        !/\.spec-stubs\.ts$/.test(file) &&
        !/(\.harness|\.test-harness)\.ts$/.test(file) &&
        !file.includes('/testing/') &&
        !file.includes('/test-stubs/')
    );
}

const MATERIAL_NAME = /^mat-|^mat[A-Z]/;

/** A Material element: a `mat-*` tag or a `mat-*` / `matX` directive. */
function isMaterialElement(element) {
    return (
        element.name.startsWith('mat-') ||
        element.attributes.some((attr) => MATERIAL_NAME.test(attr.name)) ||
        element.inputs.some((input) => MATERIAL_NAME.test(input.name))
    );
}

/**
 * The Material button variants an element declares, each with the
 * spelling that declared it: `{ variant: 'fab', via: 'matFab' }`.
 * `variant` is `unknown` for a `[matButton]` bound to an expression.
 */
export function buttonVariants(element) {
    const found = [];
    for (const attr of element.attributes) {
        if (attr.name in VARIANT_ATTRIBUTES) {
            found.push({
                variant: VARIANT_ATTRIBUTES[attr.name],
                via: attr.name,
            });
        } else if (attr.name === 'matButton') {
            found.push({
                variant: APPEARANCES[attr.value.trim()] ?? 'unknown',
                via: `matButton="${attr.value}"`,
            });
        }
    }
    for (const input of element.inputs) {
        if (input.name !== 'matButton') continue;
        const source = (input.value?.source ?? '').trim();
        const literal = /^(['"])([a-z]*)\1$/.exec(source);
        found.push({
            variant: literal
                ? (APPEARANCES[literal[2]] ?? 'unknown')
                : 'unknown',
            via: `[matButton]="${source}"`,
        });
    }
    return found;
}

/** Whether the element carries the destructive class, static or bound. */
function isDestructive(element) {
    const classAttr = element.attributes.find((attr) => attr.name === 'class');
    if (classAttr?.value.split(/\s+/).includes(DESTRUCTIVE_CLASS)) return true;
    return element.inputs.some(
        (input) =>
            input.name === DESTRUCTIVE_CLASS ||
            ((input.name === 'class' || input.name === 'ngClass') &&
                (input.value?.source ?? '').includes(DESTRUCTIVE_CLASS))
    );
}

class KitVisitor extends TmplAstRecursiveVisitor {
    constructor(lineAt) {
        super();
        this.lineAt = lineAt;
        this.formFieldDepth = 0;
        this.findings = [];
    }

    report(element, rule, detail) {
        const line = this.lineAt(element.startSourceSpan.start.offset) + 1;
        this.findings.push({ line, rule, detail });
    }

    visitElement(element) {
        const names = new Set(element.attributes.map((attr) => attr.name));
        for (const { variant, via } of buttonVariants(element)) {
            if (OFF_KIT.has(variant)) {
                this.report(element, 'variant', `${via}: no kit role`);
            } else if (variant === 'outlined' && !isDestructive(element)) {
                this.report(
                    element,
                    'variant',
                    `${via} without ${DESTRUCTIVE_CLASS}`
                );
            } else if (variant === 'unknown') {
                this.report(
                    element,
                    'variant',
                    `${via}: an appearance the guard cannot read`
                );
            }
        }
        if (isMaterialElement(element)) {
            const literal = names.has('color');
            const bound = element.inputs.some(
                (input) => input.name === 'color'
            );
            if (literal || bound) {
                this.report(element, 'color', `color on <${element.name}>`);
            }
        }
        if (element.name === 'select') {
            this.report(element, 'native-select', '<select>');
        }
        if (element.name === 'mat-select' && this.formFieldDepth === 0) {
            this.report(
                element,
                'select-outside-field',
                '<mat-select> outside <mat-form-field>'
            );
        }

        const field = element.name === 'mat-form-field';
        if (field) this.formFieldDepth += 1;
        super.visitElement(element);
        if (field) this.formFieldDepth -= 1;
    }
}

/** Kit findings of one template. */
export function kitFindingsInTemplate(
    template,
    file,
    lineAt = (offset) => template.slice(0, offset).split('\n').length - 1
) {
    const parsed = parseTemplate(template, file, {
        preserveWhitespaces: true,
    });
    if (parsed.errors?.length) {
        throw new Error(
            `${file}: cannot parse template: ${parsed.errors[0].msg}`
        );
    }
    const visitor = new KitVisitor(lineAt);
    tmplAstVisitAll(visitor, parsed.nodes);
    return visitor.findings;
}

/** Findings of one source file, its own template or its inline ones. */
export function findKitFindings(file, source) {
    const templates = file.endsWith('.html')
        ? [{ template: source, lineAt: undefined }]
        : inlineTemplates(source, file);
    return templates.flatMap(({ template, lineAt }) =>
        kitFindingsInTemplate(template, file, lineAt).map((entry) => ({
            file,
            ...entry,
        }))
    );
}

/**
 * Splits findings into the ones that fail and the allowlist entries that
 * no longer match anything (stale, to be removed).
 */
export function applyAllowlist(findings, allowed = ALLOWED) {
    const failing = findings.filter(
        ({ file, rule }) => !allowed[file]?.rules.includes(rule)
    );
    const stale = [];
    for (const [file, entry] of Object.entries(allowed)) {
        for (const rule of entry.rules) {
            const used = findings.some(
                (finding) => finding.file === file && finding.rule === rule
            );
            if (!used) stale.push({ file, rule });
        }
    }
    return { failing, stale };
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

const HINTS = {
    variant:
        'use mat-flat-button (secondary or accent), mat-button or mat-icon-button (ghost); stroked only with app-destructive-button',
    color: 'drop the color input; the kit mixins set the look',
    'native-select':
        'a toolbar picker is a secondary button + expand_more opening a mat-menu; a form field is a mat-select',
    'select-outside-field':
        'put the mat-select in a mat-form-field, or make it a menu trigger',
};

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    const files = listScannedFiles(rootDir);
    const findings = [];
    for (const file of files) {
        const source = await readFile(path.join(rootDir, file), 'utf8');
        findings.push(...findKitFindings(file, source));
    }
    const { failing, stale } = applyAllowlist(findings);

    if (failing.length > 0) {
        console.error(
            'Buttons and pickers outside the UI kit (tools/nx/check-kit-controls.mjs):'
        );
        for (const { file, line, rule, detail } of failing) {
            console.error(
                `- ${file}:${line} [${rule}] ${detail} — ${HINTS[rule]}`
            );
        }
    }
    if (stale.length > 0) {
        console.error(
            'Allowlist entries that match nothing any more; remove them from ALLOWED:'
        );
        for (const { file, rule } of stale) {
            console.error(`- ${file} [${rule}]`);
        }
    }
    if (failing.length > 0 || stale.length > 0) {
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} renderer files: every button and picker follows the UI kit (${findings.length} allowlisted).`
        );
    }
}
