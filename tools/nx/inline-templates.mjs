import ts from 'typescript';
import { literalLineResolver } from './literal-source-lines.mjs';

/**
 * `template` of an `@Component({...})` decorator, quoted or backticked. A
 * template with `${...}` substitutions is built at runtime and skipped.
 */
export function isInlineTemplate(node) {
    const call = node.parent?.parent;
    return (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        node.name.text === 'template' &&
        (ts.isNoSubstitutionTemplateLiteral(node.initializer) ||
            ts.isStringLiteral(node.initializer)) &&
        call !== undefined &&
        ts.isCallExpression(call) &&
        ts.isIdentifier(call.expression) &&
        call.expression.text === 'Component' &&
        ts.isDecorator(call.parent)
    );
}

/**
 * The inline component templates of a TypeScript source, each with a
 * mapping from a template offset to its zero-based source line.
 */
export function inlineTemplates(source, file) {
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const found = [];
    const visit = (node) => {
        if (isInlineTemplate(node)) {
            found.push({
                template: node.initializer.text,
                lineAt: literalLineResolver(node.initializer, sourceFile),
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}
