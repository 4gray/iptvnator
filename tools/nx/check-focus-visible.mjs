import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripScssComments } from './check-stylesheet-inputs.mjs';

/**
 * The web app's global stylesheets used to remove the outline from every
 * `input`, `button`, `textarea` and `:focus`, so keyboard users saw no focus
 * at all. A global rule may remove the outline only where focus is not
 * visible (`:focus:not(:focus-visible)`), or on an element the selector
 * scopes by class, id or attribute; and a bare `:focus-visible` rule must
 * draw the fallback ring. Component styles are out of scope: Angular scopes
 * them, and they may replace the ring with an indicator of their own.
 */

/** The global entry stylesheets and the partials beside them. */
const SCANNED_PATHSPECS = [':(glob)apps/web/src/*.scss'];

const OUTLINE_DECLARATION =
    /^(outline(?:-style|-width|-color)?)\s*:\s*(.+?)\s*(?:!important)?$/i;

/** A zero length: `0`, `0px`, `0.0em`. */
const ZERO_WIDTH = /^[+-]?0*\.?0+(?:[a-z]+)?$/i;
/** `none`, `hidden`, or a keyword that resets the outline to `none`. */
const NO_STYLE = /^(?:none|hidden|initial|unset)$/i;
/** A style that draws, or a `var()` that may carry one. */
const DRAWN_STYLE =
    /^(?:auto|solid|dashed|dotted|double|groove|ridge|inset|outset|inherit|revert|revert-layer|var\(.*\))$/i;
/** `transparent`, or a colour whose alpha (4th or slashed) is zero. */
const NO_COLOR =
    /^(?:transparent|#[0-9a-f]{3}0|#[0-9a-f]{6}00|(?:rgb|hsl)a?\((?:[^,()]+,){3}\s*0*\.?0+%?\s*\)|(?:rgb|hsl)a?\([^/()]*\/\s*0*\.?0+%?\s*\))$/i;

/** Splits `text` on `separator` outside parentheses and brackets. */
export function splitTopLevel(text, separator) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (char === '(' || char === '[') depth += 1;
        else if (char === ')' || char === ']') depth -= 1;
        else if (depth === 0 && separator.test(char)) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim()).filter(Boolean);
}

/** Resolves a nested selector list against its parent selectors. */
function resolveSelectors(parents, selectorList) {
    const own = splitTopLevel(selectorList, /,/);
    if (parents.length === 0) return own;
    return parents.flatMap((parent) =>
        own.map((selector) =>
            selector.includes('&')
                ? selector.replaceAll('&', parent)
                : `${parent} ${selector}`
        )
    );
}

/**
 * Whether an `outline*` declaration leaves no visible outline: a `none` or
 * `hidden` style, a zero width or a transparent colour, in the longhands or
 * anywhere in the shorthand (`outline: 0 solid transparent`). A shorthand
 * without a style (`outline: 2px`, `outline: red`) resets it to `none`.
 */
export function removesOutline(declaration) {
    const match = OUTLINE_DECLARATION.exec(declaration);
    if (!match) return false;
    const property = match[1].toLowerCase();
    const tokens = splitTopLevel(match[2], /\s/);
    const invisible = {
        'outline-style': (token) => NO_STYLE.test(token),
        'outline-width': (token) => ZERO_WIDTH.test(token),
        'outline-color': (token) => NO_COLOR.test(token),
        outline: (token) =>
            NO_STYLE.test(token) ||
            ZERO_WIDTH.test(token) ||
            NO_COLOR.test(token),
    }[property];
    const styleless =
        property === 'outline' &&
        !tokens.some((token) => DRAWN_STYLE.test(token));
    return styleless || tokens.some(invisible);
}

/** Whether a declaration draws a visible outline. */
function drawsOutline(declaration) {
    return /^outline\s*:/i.test(declaration) && !removesOutline(declaration);
}

/** Expands `:is()` / `:where()` / `:matches()` lists into plain branches. */
export function expandBranches(selector) {
    const match = /:(?:is|where|matches)\(/i.exec(selector);
    if (!match) return [selector];
    const open = match.index + match[0].length;
    let depth = 1;
    let close = open;
    while (close < selector.length && depth > 0) {
        if (selector[close] === '(') depth += 1;
        else if (selector[close] === ')') depth -= 1;
        close += 1;
    }
    const head = selector.slice(0, match.index);
    const tail = selector.slice(close);
    return splitTopLevel(selector.slice(open, close - 1), /,/).flatMap(
        (branch) => expandBranches(`${head}${branch}${tail}`)
    );
}

/** The last compound selector, the element the rule actually styles. */
function subjectOf(selector) {
    const compounds = splitTopLevel(selector, /[\s>+~]/);
    return compounds[compounds.length - 1] ?? '';
}

/** A compound without its `:not(...)` arguments. */
function withoutNegations(compound) {
    let out = '';
    for (let i = 0; i < compound.length; i += 1) {
        if (/^:not\(/i.test(compound.slice(i))) {
            let depth = 0;
            for (; i < compound.length; i += 1) {
                if (compound[i] === '(') depth += 1;
                else if (compound[i] === ')' && --depth === 0) break;
            }
        } else {
            out += compound[i];
        }
    }
    return out;
}

/**
 * Whether removing the outline here strips it from elements nothing else
 * styles: the subject has no class, id or attribute of its own, and does
 * not limit the removal to focus that is not visible.
 */
export function isBlanketSelector(selector) {
    return expandBranches(selector).some((branch) => {
        const subject = subjectOf(branch);
        if (subject.includes('::')) return false;
        if (/:not\(\s*:focus-visible\s*\)/i.test(subject)) return false;
        return !/[.#[]/.test(withoutNegations(subject));
    });
}

/**
 * Whether a selector is the global `:focus-visible` fallback: the whole
 * selector, not only its subject, so `.panel :focus-visible` (which leaves
 * everything outside the panel without a ring) is not one.
 */
function isFallbackSelector(selector) {
    return expandBranches(selector).some((branch) =>
        /^\*?:focus-visible$/i.test(branch.replace(/\s+/g, ''))
    );
}

/** One line number per offset, for reports. */
function lineAt(source, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
    return line;
}

/**
 * Walks the rules of a stylesheet: each declaration and `@include` with the
 * fully resolved selectors it applies to. Mixin bodies are walked as if they
 * were included at the top level, the widest place a caller could use them.
 * `conditional` marks a declaration inside an at-rule (`@mixin`, `@media`,
 * `@if`, an `@include` content block…), which may never reach the page;
 * `mixin` names the mixin whose body holds it.
 */
export function walkDeclarations(source) {
    const text = stripScssComments(source);
    const items = [];
    const stack = [{ selectors: [], conditional: false, mixin: null }];
    let start = 0;
    let quote = '';
    let interpolation = 0;
    const statement = (end) => {
        const raw = text.slice(start, end);
        const value = raw.trim();
        const offset = start + raw.indexOf(value);
        start = end + 1;
        return { value, offset };
    };
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quote) {
            if (char === '\\') i += 1;
            else if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (text.startsWith('#{', i)) {
            interpolation += 1;
            i += 1;
        } else if (interpolation > 0 && char === '}') interpolation -= 1;
        else if (interpolation > 0) continue;
        else if (char === '{') {
            const { value } = statement(i);
            const parent = stack[stack.length - 1];
            const mixin = /^@mixin\s+([\w-]+)/i.exec(value)?.[1];
            if (mixin) stack.push({ selectors: [], conditional: true, mixin });
            else if (value.startsWith('@'))
                stack.push({ ...parent, conditional: true });
            else
                stack.push({
                    ...parent,
                    selectors: resolveSelectors(parent.selectors, value),
                });
        } else if (char === ';' || char === '}') {
            const { value, offset } = statement(i);
            if (value) {
                const { selectors, conditional, mixin } =
                    stack[stack.length - 1];
                items.push({
                    selectors,
                    conditional,
                    mixin,
                    declaration: value.replace(/\s+/g, ' '),
                    line: lineAt(text, offset),
                });
            }
            if (char === '}' && stack.length > 1) stack.pop();
        }
    }
    return items;
}

/** Blanket outline removals in one stylesheet. */
export function findBlanketOutlineRemovals(file, source) {
    return walkDeclarations(source).flatMap(
        ({ selectors, declaration, line }) =>
            removesOutline(declaration)
                ? selectors.filter(isBlanketSelector).map((selector) => ({
                      file,
                      line,
                      selector,
                      declaration,
                  }))
                : []
    );
}

/**
 * Whether a stylesheet always draws the bare `:focus-visible` fallback ring:
 * an unconditional rule, not one in a mixin body nobody may include or under
 * a media query.
 */
export function hasFocusVisibleFallback(source) {
    return walkDeclarations(source).some(
        ({ selectors, conditional, declaration }) =>
            !conditional &&
            selectors.some(isFallbackSelector) &&
            (drawsOutline(declaration) ||
                /^@include\s+[\w.-]*focus-ring/i.test(declaration))
    );
}

/** Tracked global stylesheets under `rootDir`. */
export function listScannedFiles(rootDir) {
    // No shell: `cmd.exe` treats single quotes as literal characters, so a
    // POSIX-quoted pathspec reaches git intact on Windows and matches nothing.
    return execFileSync('git', ['ls-files', ...SCANNED_PATHSPECS], {
        cwd: rootDir,
        encoding: 'utf8',
    })
        .trim()
        .split('\n')
        .filter(Boolean);
}

/** Every problem across the global stylesheets, as printable lines. */
export function checkFocusVisible(sources) {
    const problems = sources.flatMap(({ file, source }) =>
        findBlanketOutlineRemovals(file, source).map(
            ({ file: at, line, selector, declaration }) =>
                `${at}:${line} \`${selector}\` sets \`${declaration}\``
        )
    );
    if (!sources.some(({ source }) => hasFocusVisibleFallback(source))) {
        problems.push(
            'No global `:focus-visible` rule draws the fallback outline (`@include focus-ring.focus-ring-declarations`).'
        );
    }
    return problems;
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
    const problems = checkFocusVisible(sources);
    if (problems.length > 0) {
        console.error(
            'Global styles hide keyboard focus. Remove the outline only under `:focus:not(:focus-visible)` or on a scoped selector, and keep the `:focus-visible` fallback ring:'
        );
        for (const problem of problems) console.error(`- ${problem}`);
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${files.length} global stylesheets; keyboard focus keeps its fallback ring.`
        );
    }
}
