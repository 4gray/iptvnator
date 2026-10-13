import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    parseTemplate,
    TmplAstRecursiveVisitor,
    tmplAstVisitAll,
} from '@angular/compiler';
import ts from 'typescript';

import { isScanned } from './check-theme-references.mjs';

/**
 * The app-wide form-field defaults (outlined, dynamic subscript) are not a
 * root provider: that import put the whole form-field chunk on the initial
 * path. `AppFormFieldModule` carries them on the element instead, so a
 * component that renders `<mat-form-field>` without importing it silently
 * gets Material's filled look. This guard requires the import.
 */

/** Angular renderer sources whose components can render a form field. */
const SCANNED_PATHSPECS = [
    'apps/web/*.ts',
    'apps/remote-control-web/*.ts',
    'libs/*.ts',
];

export const DEFAULTS_MODULE = 'AppFormFieldModule';
export const DEFAULTS_ALIAS = '@iptvnator/ui/components/form-field';
const DEFAULTS_SOURCE = /(^|\/)app-form-field\.module$/;

const FORM_FIELD_ELEMENT = 'mat-form-field';

/** Identifiers listed in an `imports: [...]` array, nested arrays included. */
function importIdentifiers(expression) {
    if (ts.isArrayLiteralExpression(expression)) {
        return expression.elements.flatMap(importIdentifiers);
    }
    return ts.isIdentifier(expression) ? [expression.text] : [];
}

function propertyNamed(object, name) {
    return object.properties.find(
        (property) =>
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
                ts.isStringLiteral(property.name)) &&
            property.name.text === name
    );
}

function stringValue(property) {
    const value = property?.initializer;
    return value &&
        (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
        ? value.text
        : undefined;
}

/**
 * The `@Component({...})` declarations of a TypeScript source: class name,
 * the line its decorator starts on, inline `template` or `templateUrl`, and
 * the identifiers of its `imports` array. Whether the source binds `AppFormFieldModule` from its
 * module is reported alongside, since a same-named local class would not
 * carry the defaults.
 */
export function componentDeclarations(source, file) {
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const components = [];
    let bindsDefaultsModule = false;

    const visit = (node) => {
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            (node.moduleSpecifier.text === DEFAULTS_ALIAS ||
                DEFAULTS_SOURCE.test(node.moduleSpecifier.text)) &&
            node.importClause?.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings) &&
            node.importClause.namedBindings.elements.some(
                (element) => element.name.text === DEFAULTS_MODULE
            )
        ) {
            bindsDefaultsModule = true;
        }
        if (
            ts.isDecorator(node) &&
            ts.isCallExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === 'Component' &&
            ts.isClassDeclaration(node.parent)
        ) {
            const [metadata] = node.expression.arguments;
            if (metadata && ts.isObjectLiteralExpression(metadata)) {
                const importsProperty = propertyNamed(metadata, 'imports');
                components.push({
                    className: node.parent.name?.text ?? '(anonymous)',
                    line:
                        sourceFile.getLineAndCharacterOfPosition(
                            node.parent.getStart(sourceFile)
                        ).line + 1,
                    template: stringValue(propertyNamed(metadata, 'template')),
                    templateUrl: stringValue(
                        propertyNamed(metadata, 'templateUrl')
                    ),
                    imports: importsProperty
                        ? importIdentifiers(importsProperty.initializer)
                        : [],
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return { components, bindsDefaultsModule };
}

class FormFieldVisitor extends TmplAstRecursiveVisitor {
    found = false;

    visitElement(element) {
        if (element.name === FORM_FIELD_ELEMENT) this.found = true;
        super.visitElement(element);
    }
}

/** Whether a template renders `<mat-form-field>` anywhere, control flow included. */
export function templateRendersFormField(template, file) {
    const parsed = parseTemplate(template, file, {
        preserveWhitespaces: true,
    });
    if (parsed.errors?.length) {
        throw new Error(
            `${file}: cannot parse template: ${parsed.errors[0].msg}`
        );
    }
    const visitor = new FormFieldVisitor();
    tmplAstVisitAll(visitor, parsed.nodes);
    return visitor.found;
}

/**
 * Components of one source that render a form field without importing the
 * defaults module. `readTemplate` resolves a `templateUrl` to its text.
 */
export async function findFormFieldsWithoutDefaults(
    file,
    source,
    readTemplate
) {
    const { components, bindsDefaultsModule } = componentDeclarations(
        source,
        file
    );
    const findings = [];
    for (const component of components) {
        const template =
            component.template ??
            (component.templateUrl
                ? await readTemplate(component.templateUrl)
                : undefined);
        if (template === undefined) continue;
        if (!templateRendersFormField(template, file)) continue;
        if (
            bindsDefaultsModule &&
            component.imports.includes(DEFAULTS_MODULE)
        ) {
            continue;
        }
        findings.push({
            file,
            line: component.line,
            className: component.className,
        });
    }
    return findings;
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

    const findings = [];
    for (const file of files) {
        const source = await readFile(path.join(rootDir, file), 'utf8');
        if (
            !source.includes(FORM_FIELD_ELEMENT) &&
            !source.includes('templateUrl')
        ) {
            continue;
        }
        findings.push(
            ...(await findFormFieldsWithoutDefaults(file, source, (url) =>
                readFile(path.resolve(rootDir, path.dirname(file), url), 'utf8')
            ))
        );
    }

    if (findings.length > 0) {
        console.error(
            `Components that render <mat-form-field> without ${DEFAULTS_MODULE} (from ${DEFAULTS_ALIAS}), so their fields lose the app defaults (outlined, dynamic subscript). Import it in place of MatFormFieldModule:`
        );
        for (const { file, line, className } of findings) {
            console.error(`- ${file}:${line} ${className}`);
        }
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} renderer sources; every component rendering <mat-form-field> imports ${DEFAULTS_MODULE}.`
        );
    }
}
