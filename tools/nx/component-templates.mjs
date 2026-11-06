import path from 'node:path';
import ts from 'typescript';

/**
 * The templates the app renders, found from the `@Component` decorators of
 * its TypeScript sources: an inline `template` literal, or the file a
 * `templateUrl` names. A guard that asks "does the app render this
 * element?" reads these, not every `.html` file: an orphaned template that
 * no component names never reaches a user.
 */

/** The object literal of an `@Component({...})` decorator, if `node` is one. */
export function componentMetadata(node) {
    if (
        !ts.isDecorator(node) ||
        !ts.isCallExpression(node.expression) ||
        !ts.isIdentifier(node.expression.expression) ||
        node.expression.expression.text !== 'Component'
    ) {
        return undefined;
    }
    const [metadata] = node.expression.arguments;
    return metadata && ts.isObjectLiteralExpression(metadata)
        ? metadata
        : undefined;
}

/** The initializer of the `name` property of a metadata literal. */
export function property(metadata, name) {
    return metadata.properties.find(
        (entry) =>
            ts.isPropertyAssignment(entry) &&
            (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
            entry.name.text === name
    )?.initializer;
}

/** Literal text of a quoted, backticked or interpolated template. */
function literalText(node) {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
        return [
            node.head.text,
            ...node.templateSpans.map((span) => span.literal.text),
        ].join('');
    }
    return undefined;
}

/**
 * The template text of one `@Component` metadata literal: its inline
 * `template`, or else the file its `templateUrl` names, which `readTemplate`
 * reads by a path relative to the component's `file`. Undefined when the
 * component declares neither as a literal.
 */
export async function componentTemplate(metadata, file, readTemplate) {
    const inline = property(metadata, 'template');
    const template = inline ? literalText(inline) : undefined;
    const url = property(metadata, 'templateUrl');
    if (template !== undefined || !url || !ts.isStringLiteralLike(url)) {
        return template;
    }
    return readTemplate(path.posix.join(path.posix.dirname(file), url.text));
}

/**
 * The template text of every `@Component` in a TypeScript source, in
 * declaration order. A source without a component decorator is not parsed.
 */
export async function componentTemplates(file, source, readTemplate) {
    if (!source.includes('@Component')) return [];
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const components = [];
    const visit = (node) => {
        const metadata = componentMetadata(node);
        if (metadata) components.push(metadata);
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    const templates = await Promise.all(
        components.map((metadata) =>
            componentTemplate(metadata, file, readTemplate)
        )
    );
    return templates.filter((template) => template !== undefined);
}
