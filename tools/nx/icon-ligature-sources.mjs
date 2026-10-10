import {
    Binary,
    Conditional,
    Interpolation,
    LiteralPrimitive,
    NonNullAssert,
    ParenthesizedExpression,
    parseTemplate,
    TmplAstBoundAttribute,
    TmplAstBoundText,
    TmplAstRecursiveVisitor,
    TmplAstText,
    TmplAstTextAttribute,
    tmplAstVisitAll,
} from '@angular/compiler';
import ts from 'typescript';

/**
 * Collects the icon names a source can hand to `<mat-icon>`, where they are
 * statically visible:
 *
 * - the static text of a `<mat-icon>` and the string literals its
 *   interpolations can evaluate to (`{{ a ? 'lock' : 'lock_open' }}`);
 * - values given to an `icon` / `*Icon` input (`icon="live_tv"`,
 *   `[icon]="on ? 'star' : 'star_outline'"`);
 * - TypeScript members, properties, constants and parameters named `icon`,
 *   `*Icon`, `*_ICON`, or maps named `*Icons` / `*_ICONS`, which feed bindings
 *   such as `{{ option.icon }}` and `{{ statusIcon(row) }}`.
 *
 * A value built at runtime (`'x_' + y`, a service result) is not resolvable
 * and is skipped. Only string literals in result position count, so the
 * `'file-missing'` in `reason === 'file-missing' ? 'error' : 'info'` is not
 * read as an icon.
 */

const ICON_NAME = /^(icon|ICON|[a-z][A-Za-z0-9]*Icon|[A-Z][A-Z0-9_]*_ICON)$/;
const ICON_MAP_NAME = /^(ICONS|[a-z][A-Za-z0-9]*Icons|[A-Z][A-Z0-9_]*_ICONS)$/;
/** Registered SVG names, not font ligatures. */
const NON_LIGATURE_INPUTS = new Set(['svgIcon']);
/** Signal factories whose first argument is the value they hold. */
const SIGNAL_FACTORIES = new Set([
    'computed',
    'input',
    'linkedSignal',
    'model',
    'signal',
]);
/** Angular `BindingType.Property` and `BindingType.TwoWay`. */
const INPUT_BINDING_TYPES = new Set([0, 5]);

export function isIconName(name) {
    return (
        (ICON_NAME.test(name) || ICON_MAP_NAME.test(name)) &&
        !NON_LIGATURE_INPUTS.has(name)
    );
}

/** String literal nodes a template expression can evaluate to. */
function templateResults(ast, out = []) {
    if (ast instanceof LiteralPrimitive) {
        if (typeof ast.value === 'string') {
            out.push(ast);
        }
    } else if (ast instanceof Conditional) {
        templateResults(ast.trueExp, out);
        templateResults(ast.falseExp, out);
    } else if (ast instanceof Binary) {
        if (ast.operation === '??' || ast.operation === '||') {
            templateResults(ast.left, out);
        }
        if (['??', '||', '&&'].includes(ast.operation)) {
            templateResults(ast.right, out);
        }
    } else if (
        ast instanceof ParenthesizedExpression ||
        ast instanceof NonNullAssert
    ) {
        templateResults(ast.expression, out);
    } else if (ast instanceof Interpolation) {
        // `prefix_{{ name }}` builds a name at runtime: not resolvable.
        if (ast.strings.every((part) => part.trim() === '')) {
            for (const expression of ast.expressions) {
                templateResults(expression, out);
            }
        }
    }
    return out;
}

class TemplateIconVisitor extends TmplAstRecursiveVisitor {
    constructor(template, lineOffset) {
        super();
        this.template = template;
        this.lineOffset = lineOffset;
        this.found = [];
    }

    lineAt(offset) {
        return this.template.slice(0, offset).split('\n').length - 1;
    }

    /** A static value, reported on the line its text starts. */
    addText(name, span, source) {
        const raw = span.toString();
        const leading = raw.length - raw.trimStart().length;
        this.add(name, this.lineAt(span.start.offset + leading), source);
    }

    /** Literals from a binding, each reported on its own line. */
    addResults(ast, source) {
        for (const literal of templateResults(ast)) {
            this.add(
                literal.value,
                this.lineAt(literal.sourceSpan.start),
                source
            );
        }
    }

    add(name, line, source) {
        this.found.push({ name, line: this.lineOffset + line + 1, source });
    }

    visitElement(element) {
        for (const attribute of element.attributes) {
            if (
                attribute instanceof TmplAstTextAttribute &&
                isIconName(attribute.name) &&
                attribute.value.trim() !== ''
            ) {
                this.addText(
                    attribute.value.trim(),
                    attribute.valueSpan ?? attribute.sourceSpan,
                    `${attribute.name} attribute`
                );
            }
        }
        for (const input of element.inputs) {
            if (
                input instanceof TmplAstBoundAttribute &&
                INPUT_BINDING_TYPES.has(input.type) &&
                isIconName(input.name)
            ) {
                this.addResults(input.value.ast, `[${input.name}] binding`);
            }
        }
        const isSvgIcon = element.attributes.some(
            (attribute) => attribute.name === 'svgIcon'
        );
        if (element.name === 'mat-icon' && !isSvgIcon) {
            for (const child of element.children) {
                if (child instanceof TmplAstText && child.value.trim()) {
                    this.addText(
                        child.value.trim(),
                        child.sourceSpan,
                        '<mat-icon> text'
                    );
                } else if (child instanceof TmplAstBoundText) {
                    this.addResults(child.value.ast, '<mat-icon> binding');
                }
            }
        }
        super.visitElement(element);
    }
}

/**
 * Icon names in an Angular template. `lineOffset` is the zero-based line on
 * which an inline template starts inside its TypeScript file.
 */
export function iconNamesInTemplate(template, file, lineOffset = 0) {
    // Keep whitespace so text spans and values match the source lines.
    const parsed = parseTemplate(template, file, {
        preserveWhitespaces: true,
    });
    if (parsed.errors?.length) {
        throw new Error(
            `${file}: cannot parse template: ${parsed.errors[0].msg}`
        );
    }
    const visitor = new TemplateIconVisitor(template, lineOffset);
    tmplAstVisitAll(visitor, parsed.nodes);
    return visitor.found;
}

function unwrap(node) {
    while (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isTypeAssertionExpression(node)
    ) {
        node = node.expression;
    }
    return node;
}

/** Return statements of a function body, not of functions nested in it. */
function returnedExpressions(body, out = []) {
    ts.forEachChild(body, (child) => {
        if (ts.isReturnStatement(child)) {
            if (child.expression) {
                out.push(child.expression);
            }
        } else if (!ts.isFunctionLike(child) && !ts.isClassLike(child)) {
            returnedExpressions(child, out);
        }
    });
    return out;
}

/** String literal nodes a TypeScript expression can evaluate to. */
function typeScriptResults(expression, out = []) {
    const node = unwrap(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        out.push(node);
    } else if (ts.isConditionalExpression(node)) {
        typeScriptResults(node.whenTrue, out);
        typeScriptResults(node.whenFalse, out);
    } else if (ts.isBinaryExpression(node)) {
        const operator = node.operatorToken.kind;
        if (
            operator === ts.SyntaxKind.QuestionQuestionToken ||
            operator === ts.SyntaxKind.BarBarToken
        ) {
            typeScriptResults(node.left, out);
            typeScriptResults(node.right, out);
        } else if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
            typeScriptResults(node.right, out);
        }
    } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        functionResults(node.body, out);
    } else if (ts.isCallExpression(node)) {
        const callee = ts.isPropertyAccessExpression(node.expression)
            ? node.expression.expression
            : node.expression;
        if (
            ts.isIdentifier(callee) &&
            SIGNAL_FACTORIES.has(callee.text) &&
            node.arguments.length > 0
        ) {
            typeScriptResults(node.arguments[0], out);
        }
    } else if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
            if (ts.isPropertyAssignment(property)) {
                typeScriptResults(property.initializer, out);
            }
        }
    } else if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements) {
            typeScriptResults(element, out);
        }
    }
    return out;
}

function functionResults(body, out) {
    if (!body) {
        return out;
    }
    if (!ts.isBlock(body)) {
        return typeScriptResults(body, out);
    }
    for (const expression of returnedExpressions(body)) {
        typeScriptResults(expression, out);
    }
    return out;
}

function declarationName(node) {
    const name = node.name;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
        return name.text;
    }
    if (name && ts.isPrivateIdentifier(name)) {
        return name.text.slice(1);
    }
    return undefined;
}

/** Literal nodes behind one icon-named declaration. */
function declarationResults(node) {
    if (
        ts.isPropertyAssignment(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isParameter(node)
    ) {
        return node.initializer ? typeScriptResults(node.initializer) : [];
    }
    if (
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isFunctionDeclaration(node)
    ) {
        return functionResults(node.body, []);
    }
    return [];
}

/** `template` of an `@Component({...})` decorator. */
function isInlineTemplate(node) {
    const call = node.parent?.parent;
    return (
        ts.isPropertyAssignment(node) &&
        declarationName(node) === 'template' &&
        ts.isNoSubstitutionTemplateLiteral(node.initializer) &&
        call !== undefined &&
        ts.isCallExpression(call) &&
        ts.isIdentifier(call.expression) &&
        call.expression.text === 'Component' &&
        ts.isDecorator(call.parent)
    );
}

/**
 * Icon names in a TypeScript source, plus those in its inline component
 * templates.
 */
export function iconNamesInTypeScript(source, file) {
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const found = [];
    const lineOf = (node) =>
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line;
    const visit = (node) => {
        const name = declarationName(node);
        if (name !== undefined && isIconName(name)) {
            for (const literal of declarationResults(node)) {
                found.push({
                    name: literal.text,
                    line: lineOf(literal) + 1,
                    source: `${name} value`,
                });
            }
        }
        if (isInlineTemplate(node)) {
            found.push(
                ...iconNamesInTemplate(
                    node.initializer.text,
                    file,
                    lineOf(node.initializer)
                )
            );
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}
