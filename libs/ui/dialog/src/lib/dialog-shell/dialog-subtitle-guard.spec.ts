import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Every dialog header has an icon, a title and a one-line subtitle that says
 * what the dialog is for. The shell's required `subtitle` input makes the
 * compiler enforce it on `app-dialog-shell`; this guard covers what the
 * compiler cannot see: a dialog component that draws its own header instead
 * of using the shell.
 */
const ROOTS = ['apps/web/src', 'libs'];

/**
 * Dialog components that draw their own surface by design, with the reason.
 */
const OWN_SURFACE = new Map([
    [
        'libs/workspace/shell/feature/src/lib/workspace-command-palette/workspace-command-palette.component.ts',
        'a search field is its header',
    ],
]);

const SHELL_DIR = 'libs/ui/dialog/src/lib/dialog-shell/';

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return entry.name === 'node_modules' ? [] : sourceFiles(path);
        }
        return /\.(ts|html)$/.test(entry.name) &&
            !/\.spec\.ts$/.test(entry.name)
            ? [path]
            : [];
    });
}

/** The opening tags of `tag`, read up to the `>` outside attribute quotes. */
function openingTags(source: string, tag: string): string[] {
    const tags: string[] = [];
    let from = source.indexOf(`<${tag}`);
    while (from !== -1) {
        let quote: string | null = null;
        let end = from + tag.length + 1;
        for (; end < source.length; end++) {
            const char = source[end];
            if (quote) {
                if (char === quote) quote = null;
            } else if (char === '"' || char === "'") {
                quote = char;
            } else if (char === '>') {
                break;
            }
        }
        tags.push(source.slice(from, end + 1));
        from = source.indexOf(`<${tag}`, end);
    }
    return tags;
}

/** The component's template: inline, or the file its `templateUrl` names. */
function templateOf(file: string, source: string): string {
    const url = source.match(/templateUrl:\s*['"]([^'"]+)['"]/)?.[1];
    return url ? readFileSync(resolve(dirname(file), url), 'utf8') : source;
}

describe('dialog header guard', () => {
    const root = process.cwd();
    const files = ROOTS.flatMap((dir) => sourceFiles(resolve(root, dir))).map(
        (path) => ({
            path,
            // Forward slashes on every platform, as the lists above use.
            name: relative(root, path).split(sep).join('/'),
            source: readFileSync(path, 'utf8'),
        })
    );

    it('finds the dialogs it guards', () => {
        const shells = files.filter((file) =>
            file.source.includes('<app-dialog-shell')
        );
        expect(shells.length).toBeGreaterThan(25);
    });

    it('gives every dialog shell a subtitle', () => {
        const missing = files.flatMap((file) =>
            openingTags(file.source, 'app-dialog-shell')
                .filter((tag) => !/\s\[?subtitle\]?=/.test(tag))
                .map(() => file.name)
        );
        expect(missing).toEqual([]);
    });

    it('opens every dialog component in the shell, so its header has the subtitle', () => {
        const dialogs = files.filter(
            (file) =>
                file.name.endsWith('.ts') &&
                file.source.includes('@Component') &&
                /\b(MAT_DIALOG_DATA|MatDialogRef)\b/.test(file.source)
        );
        expect(dialogs.length).toBeGreaterThan(20);
        const ownHeader = dialogs
            .filter(
                (file) =>
                    !templateOf(file.path, file.source).includes(
                        '<app-dialog-shell'
                    )
            )
            .map((file) => file.name)
            .filter((name) => !OWN_SURFACE.has(name));
        expect(ownHeader).toEqual([]);
    });

    it('names dialogs only through the shell heading', () => {
        const titled = files
            .filter(
                (file) =>
                    !file.name.startsWith(SHELL_DIR) &&
                    /\bmat-dialog-title\b|\bmatDialogTitle\b/.test(file.source)
            )
            .map((file) => file.name);
        expect(titled).toEqual([]);
    });

    it('lists only dialogs that still exist as own-surface exceptions', () => {
        const names = new Set(files.map((file) => file.name));
        expect(
            [...OWN_SURFACE.keys()].filter((name) => !names.has(name))
        ).toEqual([]);
    });
});
