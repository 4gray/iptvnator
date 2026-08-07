import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import ts from 'typescript';

const PROJECT_SOURCE_ROOT = join(process.cwd(), 'libs/playback/util/src');
const FORBIDDEN_IMPORT_PREFIXES = [
    '@angular/',
    '@iptvnator/ui/',
    'electron',
    '@ngx-pwa/',
] as const;
const FORBIDDEN_GLOBALS = new Set([
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'MediaSource',
    'MediaError',
    'HTMLMediaElement',
    'HTMLElement',
    'navigator',
    'indexedDB',
]);

describe('playback util boundary', () => {
    it('keeps production sources independent of UI and browser globals', () => {
        const violations = collectProductionSources(
            PROJECT_SOURCE_ROOT
        ).flatMap(findBoundaryViolations);

        expect(violations).toEqual([]);
    });

    it.each([
        ['import declaration', "import '@angular/core';", '@angular/core'],
        [
            're-export declaration',
            "export * from '@iptvnator/ui/components';",
            '@iptvnator/ui/components',
        ],
        [
            'import type node',
            "type AngularType = import('@angular/core').Type;",
            '@angular/core',
        ],
        [
            'dynamic import',
            "void import('@ngx-pwa/service-worker');",
            '@ngx-pwa/service-worker',
        ],
        [
            'import-equals declaration',
            "import Electron = require('electron'); void Electron;",
            'electron',
        ],
    ])('rejects forbidden sources in a %s', (_label, source, moduleName) => {
        const violations = findFixtureViolations(source);

        expect(violations).toEqual([expect.stringContaining(moduleName)]);
    });

    it('allows non-forbidden sources in every supported import form', () => {
        const violations = findFixtureViolations(`
            import './imported';
            export * from './exported';
            type LocalType = import('./typed').Type;
            void import('./dynamic');
            import Local = require('./required');
            void Local;
        `);

        expect(violations).toEqual([]);
    });

    it.each([
        ['direct identifier', 'void navigator;', 'navigator'],
        ['direct storage identifier', 'void indexedDB;', 'indexedDB'],
        [
            'globalThis property access',
            'void globalThis.MediaSource;',
            'MediaSource',
        ],
        ['self property access', 'void self.indexedDB;', 'indexedDB'],
        [
            'globalThis element access',
            "void globalThis['localStorage'];",
            'localStorage',
        ],
        [
            'self element access',
            "void self['sessionStorage'];",
            'sessionStorage',
        ],
        [
            'globalThis destructuring',
            'const { navigator } = globalThis;',
            'navigator',
        ],
        [
            'self destructuring',
            'const { indexedDB: database } = self; void database;',
            'indexedDB',
        ],
    ])(
        'rejects forbidden browser globals through %s',
        (_label, source, name) => {
            const violations = findFixtureViolations(source);

            expect(violations).toEqual([expect.stringContaining(name)]);
        }
    );

    it.each([
        ['property access', 'void source.navigator;'],
        ['element access', "void source['indexedDB'];"],
        ['destructuring', 'const { navigator } = source;'],
        [
            'property declaration',
            'const config = { MediaSource: source }; void config;',
        ],
        ['shadowed self', 'const self = source; void self.MediaSource;'],
        [
            'local forbidden-name binding',
            'const navigator = source.navigator; void navigator;',
        ],
    ])('allows ordinary local %s names', (_label, source) => {
        const violations = findFixtureViolations(source);

        expect(violations).toEqual([]);
    });
});

function findFixtureViolations(source: string): string[] {
    const directory = mkdtempSync(join(tmpdir(), 'playback-util-boundary-'));
    const filePath = join(directory, 'fixture.ts');
    try {
        writeFileSync(filePath, `${source}\nexport {};`);
        return findBoundaryViolations(filePath);
    } finally {
        rmSync(directory, { force: true, recursive: true });
    }
}

function collectProductionSources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return collectProductionSources(path);
        }
        return entry.isFile() &&
            entry.name.endsWith('.ts') &&
            !entry.name.endsWith('.spec.ts') &&
            !entry.name.endsWith('.test.ts')
            ? [path]
            : [];
    });
}

function findBoundaryViolations(filePath: string): string[] {
    const program = ts.createProgram({
        rootNames: [filePath],
        options: {
            lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            noEmit: true,
            noResolve: true,
            skipLibCheck: true,
            target: ts.ScriptTarget.ESNext,
        },
    });
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
        throw new Error(`Unable to parse ${filePath}`);
    }
    const checker = program.getTypeChecker();
    const violations: string[] = [];

    sourceFile.forEachChild(function visit(node): void {
        const moduleSpecifier = getExternalModuleSpecifier(node);
        if (moduleSpecifier && isForbiddenModuleSpecifier(moduleSpecifier)) {
            violations.push(formatViolation(sourceFile, node, moduleSpecifier));
        }
        for (const globalName of getForbiddenGlobalPropertyAccesses(
            node,
            checker,
            sourceFile
        )) {
            violations.push(formatViolation(sourceFile, node, globalName));
        }
        if (
            ts.isIdentifier(node) &&
            FORBIDDEN_GLOBALS.has(node.text) &&
            isAmbientIdentifierReference(node, checker, sourceFile)
        ) {
            violations.push(formatViolation(sourceFile, node, node.text));
        }
        node.forEachChild(visit);
    });

    return violations;
}

function getExternalModuleSpecifier(node: ts.Node): string | undefined {
    if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
    ) {
        return getStaticString(node.moduleSpecifier);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        return getStaticString(node.argument.literal);
    }
    if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
        return getStaticString(node.arguments[0]);
    }
    if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
    ) {
        return getStaticString(node.moduleReference.expression);
    }
    return undefined;
}

function getStaticString(node?: ts.Node): string | undefined {
    return node &&
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        ? node.text
        : undefined;
}

function isForbiddenModuleSpecifier(moduleSpecifier: string): boolean {
    return FORBIDDEN_IMPORT_PREFIXES.some((prefix) =>
        moduleSpecifier.startsWith(prefix)
    );
}

function getForbiddenGlobalPropertyAccesses(
    node: ts.Node,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
): string[] {
    if (
        ts.isPropertyAccessExpression(node) &&
        isAmbientGlobalRoot(node.expression, checker, sourceFile) &&
        FORBIDDEN_GLOBALS.has(node.name.text)
    ) {
        return [node.name.text];
    }
    if (
        ts.isElementAccessExpression(node) &&
        isAmbientGlobalRoot(node.expression, checker, sourceFile)
    ) {
        const propertyName = getStaticString(node.argumentExpression);
        return propertyName && FORBIDDEN_GLOBALS.has(propertyName)
            ? [propertyName]
            : [];
    }
    if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        isAmbientGlobalRoot(node.initializer, checker, sourceFile)
    ) {
        return node.name.elements.flatMap((element) => {
            const propertyName = getBindingPropertyName(element);
            return propertyName && FORBIDDEN_GLOBALS.has(propertyName)
                ? [propertyName]
                : [];
        });
    }
    return [];
}

function getBindingPropertyName(
    element: ts.BindingElement
): string | undefined {
    const property = element.propertyName ?? element.name;
    return ts.isIdentifier(property) || ts.isStringLiteral(property)
        ? property.text
        : undefined;
}

function isAmbientGlobalRoot(
    expression: ts.Expression,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
): boolean {
    return (
        ts.isIdentifier(expression) &&
        (expression.text === 'globalThis' || expression.text === 'self') &&
        isAmbientIdentifier(expression, checker, sourceFile)
    );
}

function isAmbientIdentifierReference(
    identifier: ts.Identifier,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
): boolean {
    return (
        !isPropertyName(identifier) &&
        isAmbientIdentifier(identifier, checker, sourceFile)
    );
}

function isAmbientIdentifier(
    identifier: ts.Identifier,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
): boolean {
    const symbol = checker.getSymbolAtLocation(identifier);
    return !symbol?.declarations?.some(
        (declaration) => declaration.getSourceFile() === sourceFile
    );
}

function isPropertyName(identifier: ts.Identifier): boolean {
    const { parent } = identifier;
    return (
        (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
        (ts.isBindingElement(parent) &&
            (parent.name === identifier ||
                parent.propertyName === identifier)) ||
        ((ts.isPropertyAssignment(parent) ||
            ts.isPropertyDeclaration(parent) ||
            ts.isPropertySignature(parent) ||
            ts.isMethodDeclaration(parent) ||
            ts.isMethodSignature(parent) ||
            ts.isEnumMember(parent)) &&
            parent.name === identifier)
    );
}

function formatViolation(
    sourceFile: ts.SourceFile,
    node: ts.Node,
    detail: string
): string {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return `${relative(process.cwd(), sourceFile.fileName)}:${line + 1}: ${detail}`;
}
