import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SETTINGS_SEARCH_ENTRIES } from '@iptvnator/workspace/shell/util/settings-search';

/**
 * The settings search index is hand-maintained next to templates whose
 * labels are hard-coded translate keys. This spec keeps the two in step: a
 * new settings row without an index entry (or a renamed key) fails here
 * instead of silently becoming unsearchable.
 */
interface TemplateRow {
    file: string;
    id: string | null;
    labelKey: string | null;
    descriptionKey: string | null;
}

// The web jest config runs as ESM, so there is no `__dirname` here.
const SETTINGS_DIR = resolve(process.cwd(), 'apps/web/src/app/settings');
const EN = JSON.parse(
    readFileSync(join(SETTINGS_DIR, '../../assets/i18n/en.json'), 'utf8')
);

function readTemplateRows(): TemplateRow[] {
    const rows: TemplateRow[] = [];
    const files = readdirSync(SETTINGS_DIR).filter((file) =>
        /^settings-.+-section\.component\.html$/.test(file)
    );

    for (const file of files) {
        const html = readFileSync(join(SETTINGS_DIR, file), 'utf8');
        // Row containers only: `setting-item` itself, not `__meta` etc.
        const starts = [
            ...html.matchAll(/<div\b[^>]*class="setting-item(?:\s[^"]*)?"/g),
        ];
        starts.forEach((match, index) => {
            const end = starts[index + 1]?.index ?? html.length;
            const chunk = html.slice(match.index, end);
            const tag = chunk.slice(0, chunk.indexOf('>') + 1);
            const meta = chunk.split('setting-item__control')[0];
            rows.push({
                file,
                id: tag.match(/data-setting-id="([^"]+)"/)?.[1] ?? null,
                labelKey:
                    chunk.match(
                        /<h4[^>]*>\s*\{\{\s*'(SETTINGS\.[A-Z0-9_]+)'/
                    )?.[1] ?? null,
                descriptionKey:
                    meta.match(
                        /<p[^>]*>\s*\{\{\s*'(SETTINGS\.[A-Z0-9_]+)'/
                    )?.[1] ?? null,
            });
        });
    }
    return rows;
}

function translationExists(key: string): boolean {
    return (
        typeof key
            .split('.')
            .reduce<unknown>(
                (node, part) =>
                    node && typeof node === 'object'
                        ? (node as Record<string, unknown>)[part]
                        : undefined,
                EN
            ) === 'string'
    );
}

describe('settings search registry', () => {
    const rows = readTemplateRows();
    const titledRows = rows.filter((row) => row.labelKey !== null);
    const byId = new Map(SETTINGS_SEARCH_ENTRIES.map((e) => [e.id, e]));

    it('finds the settings rows in the section templates', () => {
        expect(titledRows.length).toBeGreaterThan(40);
    });

    it('anchors every titled settings row with a registered id', () => {
        const missing = titledRows
            .filter((row) => !row.id || !byId.has(row.id))
            .map((row) => `${row.file}: ${row.labelKey}`);

        expect(missing).toEqual([]);
    });

    it('registers every anchored row exactly once', () => {
        const templateIds = rows.flatMap((row) => (row.id ? [row.id] : []));

        expect(new Set(templateIds).size).toBe(templateIds.length);
        expect(templateIds.slice().sort()).toEqual(
            SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id).sort()
        );
    });

    it('indexes the same title and description the row renders', () => {
        const mismatches = titledRows.flatMap((row) => {
            const entry = row.id ? byId.get(row.id) : undefined;
            if (!entry) {
                return [];
            }
            const problems: string[] = [];
            if (entry.labelKey !== row.labelKey) {
                problems.push(`${row.id}: label ${row.labelKey}`);
            }
            if (entry.descriptionKey !== (row.descriptionKey ?? undefined)) {
                problems.push(`${row.id}: description ${row.descriptionKey}`);
            }
            if (!row.file.includes(`settings-${entry.section}-section`)) {
                problems.push(`${row.id}: rendered in ${row.file}`);
            }
            return problems;
        });

        expect(mismatches).toEqual([]);
    });

    it('uses translation keys that exist in English', () => {
        const missing = SETTINGS_SEARCH_ENTRIES.flatMap((entry) =>
            [entry.labelKey, entry.descriptionKey].filter(
                (key): key is string => !!key && !translationExists(key)
            )
        );

        expect(missing).toEqual([]);
    });
});
