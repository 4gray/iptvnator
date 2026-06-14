import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

import { buildSettingsSectionNavItems } from './settings-options';

/**
 * Every nav-item id must match the `id="..."` attribute on its
 * corresponding section component template, otherwise clicking the nav
 * link silently no-ops (the scroll directive runs `document.getElementById`
 * and falls through when no element is found).
 *
 * This bug bit the Remote section once already — its nav id was set to
 * the Nx library name (`@iptvnator/ui/remote-control`) instead of the
 * template's `id="remote-control"`. The guard below catches future
 * rename/copy-paste regressions before they ship.
 */
describe('buildSettingsSectionNavItems', () => {
    // Anchor on the Nx workspace root (Jest runs from there); avoids
    // depending on __dirname which isn't defined under the project's
    // ESM Jest preset.
    const settingsDir = resolve(
        process.cwd(),
        'apps/web/src/app/settings'
    );

    function collectSectionTemplateIds(): Set<string> {
        const ids = new Set<string>();
        for (const fileName of readdirSync(settingsDir)) {
            if (!/^settings-.+-section\.component\.html$/.test(fileName)) {
                continue;
            }
            const html = readFileSync(
                resolve(settingsDir, fileName),
                'utf-8'
            );
            // Match the FIRST `id="…"` on the <section> root only —
            // descendant elements (form controls, anchors) also use id=
            // attributes and would pollute the set.
            const rootMatch = /<section[^>]*\sid="([^"]+)"/i.exec(html);
            if (rootMatch) {
                ids.add(rootMatch[1]);
            }
        }
        return ids;
    }

    function collectSettingsComponentSectionOrder(): string[] {
        const html = readFileSync(
            resolve(settingsDir, 'settings.component.html'),
            'utf-8'
        );
        const idsByComponent = new Map<string, string>();

        for (const fileName of readdirSync(settingsDir)) {
            const componentMatch =
                /^settings-(.+)-section\.component\.html$/.exec(fileName);
            if (!componentMatch) {
                continue;
            }
            const sectionHtml = readFileSync(
                resolve(settingsDir, fileName),
                'utf-8'
            );
            const rootMatch = /<section[^>]*\sid="([^"]+)"/i.exec(
                sectionHtml
            );
            if (rootMatch) {
                idsByComponent.set(
                    `app-settings-${componentMatch[1]}-section`,
                    rootMatch[1]
                );
            }
        }

        return Array.from(
            html.matchAll(/<app-settings-[a-z-]+-section\b/g),
            (match) => idsByComponent.get(match[0].slice(1))
        ).filter((id): id is string => Boolean(id));
    }

    it('exposes feature-specific items only when their runtime capabilities are supported', () => {
        const supportedItems = buildSettingsSectionNavItems({
            supportsEpg: true,
            supportsRemoteControl: true,
        });
        const unsupportedItems = buildSettingsSectionNavItems({
            supportsEpg: false,
            supportsRemoteControl: false,
        });

        expect(supportedItems.map((item) => item.id)).toEqual(
            expect.arrayContaining(['dashboard', 'epg', 'remote-control'])
        );
        expect(
            unsupportedItems.find((item) => item.id === 'epg')?.visible
        ).toBe(false);
        expect(
            unsupportedItems.find((item) => item.id === 'remote-control')
                ?.visible
        ).toBe(false);
    });

    it('every nav id matches an existing section template id (regression: remote-control nav no longer maps to the Nx lib name)', () => {
        const navIds = new Set(
            buildSettingsSectionNavItems({
                supportsEpg: true,
                supportsRemoteControl: true,
            }).map((item) => item.id)
        );
        const templateIds = collectSectionTemplateIds();

        // Every nav id must exist as a section root id.
        const orphans = [...navIds].filter((id) => !templateIds.has(id));
        expect(orphans).toEqual([]);

        // And every section template id must be reachable from the nav
        // (catches the opposite drift — a new section added without a nav
        // entry would never get scrolled to).
        const unreachable = [...templateIds].filter((id) => !navIds.has(id));
        expect(unreachable).toEqual([]);
    });

    it('keeps Dashboard below EPG in both the settings rail and content order', () => {
        const expectedOrder = [
            'general',
            'playback',
            'epg',
            'dashboard',
            'remote-control',
            'backup',
            'reset',
            'about',
        ];

        expect(
            buildSettingsSectionNavItems({
                supportsEpg: true,
                supportsRemoteControl: true,
            }).map((item) => item.id)
        ).toEqual(expectedOrder);
        expect(collectSettingsComponentSectionOrder()).toEqual(expectedOrder);
    });
});
