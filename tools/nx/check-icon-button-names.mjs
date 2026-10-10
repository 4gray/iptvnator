import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    parseTemplate,
    TmplAstBoundText,
    TmplAstElement,
    TmplAstRecursiveVisitor,
    TmplAstText,
    tmplAstVisitAll,
} from '@angular/compiler';

import { inlineTemplates } from './inline-templates.mjs';

/**
 * A `<button>` whose only content is a `<mat-icon>` has no accessible name:
 * the icon font's ligature text is hidden from assistive technology, and a
 * `matTooltip` only adds a description that appears on hover or focus. This
 * guard requires such a button to carry `aria-label`, an `aria-label`
 * binding or `aria-labelledby`.
 */

/** Angular renderer sources, whose templates are standalone or inline. */
const SCANNED_PATHSPECS = [
    'apps/web/*.html',
    'apps/web/*.ts',
    'apps/remote-control-web/*.html',
    'apps/remote-control-web/*.ts',
    'libs/*.html',
    'libs/*.ts',
];

/** Attributes or bindings that give a button its accessible name. */
const NAME_ATTRIBUTES = new Set(['aria-label', 'aria-labelledby', 'ariaLabel']);

/** Visual-only content that never names a button. */
const DECORATIVE_ELEMENTS = new Set(['mat-spinner', 'mat-progress-spinner']);

function isScanned(file) {
    return !/\.(spec|test)\.[cm]?[jt]s$/.test(file);
}

function staticAttribute(element, name) {
    return element.attributes.find((attribute) => attribute.name === name)
        ?.value;
}

function hasName(element) {
    const named = element.attributes.some(
        (attribute) =>
            NAME_ATTRIBUTES.has(attribute.name) && attribute.value.trim() !== ''
    );
    return (
        named || element.inputs.some((input) => NAME_ATTRIBUTES.has(input.name))
    );
}

/**
 * What a button's content contributes to its name: icons, text, or
 * something this guard cannot see into (projected content, another
 * component, an image), which is assumed to name it.
 */
class ContentVisitor extends TmplAstRecursiveVisitor {
    icons = [];
    text = false;
    opaque = false;

    visitElement(element) {
        if (element.name === 'mat-icon') {
            this.icons.push(element);
        } else if (DECORATIVE_ELEMENTS.has(element.name)) {
            // A spinner beside the icon: still no name.
        } else if (
            (element.name.includes('-') && element.name !== 'ng-container') ||
            element.name === 'img'
        ) {
            this.opaque = true;
        } else {
            super.visitElement(element);
        }
    }

    visitText(text) {
        if (text.value.trim() !== '') {
            this.text = true;
        }
    }

    visitBoundText() {
        this.text = true;
    }

    visitIcu() {
        this.text = true;
    }

    visitContent() {
        this.opaque = true;
    }

    visitComponent() {
        this.opaque = true;
    }
}

function iconOnly(element) {
    const content = new ContentVisitor();
    tmplAstVisitAll(content, element.children);
    return content.icons.length > 0 && !content.text && !content.opaque
        ? content.icons
        : null;
}

function iconLabel(icon) {
    const text = icon.children
        .map((child) =>
            child instanceof TmplAstText
                ? child.value
                : child instanceof TmplAstBoundText
                  ? child.value.source
                  : ''
        )
        .join('')
        .trim();
    return text.replace(/\s+/g, ' ') || 'mat-icon';
}

class ButtonVisitor extends TmplAstRecursiveVisitor {
    constructor(lineAt) {
        super();
        this.lineAt = lineAt;
        this.found = [];
    }

    visitElement(element) {
        if (
            element instanceof TmplAstElement &&
            element.name === 'button' &&
            staticAttribute(element, 'aria-hidden') !== 'true' &&
            !hasName(element)
        ) {
            const icons = iconOnly(element);
            if (icons) {
                this.found.push({
                    line: this.lineAt(element.startSourceSpan.start.offset) + 1,
                    icon: icons.map(iconLabel).join(' / '),
                });
            }
        }
        super.visitElement(element);
    }
}

/**
 * Icon-only buttons without an accessible name in an Angular template.
 * `lineAt` maps a template offset to its zero-based source line.
 */
export function namelessIconButtonsInTemplate(
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
    const visitor = new ButtonVisitor(lineAt);
    tmplAstVisitAll(visitor, parsed.nodes);
    return visitor.found;
}

/** Nameless icon-only buttons in one source file. */
export function findNamelessIconButtons(file, source) {
    const templates = file.endsWith('.html')
        ? [{ template: source, lineAt: undefined }]
        : inlineTemplates(source, file);
    return templates.flatMap(({ template, lineAt }) =>
        namelessIconButtonsInTemplate(template, file, lineAt).map((entry) => ({
            file,
            ...entry,
        }))
    );
}

/** Tracked renderer files the guard reads, at any depth. */
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

    const findings = [];
    for (const file of files) {
        const source = await readFile(path.join(rootDir, file), 'utf8');
        findings.push(...findNamelessIconButtons(file, source));
    }

    if (findings.length > 0) {
        console.error(
            'Icon-only buttons without an accessible name. Add a translated aria-label (or [attr.aria-label] bound to the tooltip key) or aria-labelledby; a matTooltip alone does not name a button:'
        );
        for (const { file, line, icon } of findings) {
            console.error(`- ${file}:${line} <button> with ${icon}`);
        }
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} renderer files; every icon-only <button> has an accessible name.`
        );
    }
}
