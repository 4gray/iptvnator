import { readFileSync } from 'fs';
import { resolve } from 'path';

import { buildSettingsSectionNavItems } from './settings-options';

/**
 * Every nav-item id must match a `@case ('...')` label in the settings page
 * template (or the `@default` general section), otherwise clicking the nav
 * link routes to `/workspace/settings/:id` and renders the fallback general
 * page instead of the intended section.
 *
 * The id coupling bit the Remote section once already in the scroll-anchor
 * era — its nav id was set to the Nx library name
 * (`@iptvnator/ui/remote-control`) instead of `remote-control`. The guard
 * below catches future rename/copy-paste regressions before they ship.
 */
describe('buildSettingsSectionNavItems', () => {
    // Anchor on the Nx workspace root (Jest runs from there); avoids
    // depending on __dirname which isn't defined under the project's
    // ESM Jest preset.
    const settingsDir = resolve(process.cwd(), 'apps/web/src/app/settings');

    /** Section ids the page template can render: @case labels + @default. */
    function collectRenderableSectionIds(): Set<string> {
        const html = readFileSync(
            resolve(settingsDir, 'settings.component.html'),
            'utf-8'
        );
        const ids = new Set<string>(
            Array.from(
                html.matchAll(/@case \('([a-z-]+)'\)/g),
                (match) => match[1]
            )
        );
        if (/@default\s*\{\s*<app-settings-general-section/.test(html)) {
            ids.add('general');
        }
        return ids;
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

    it('every nav id renders a section page in the settings template', () => {
        const navIds = new Set(
            buildSettingsSectionNavItems({
                supportsEpg: true,
                supportsRemoteControl: true,
            }).map((item) => item.id)
        );
        const renderableIds = collectRenderableSectionIds();

        // A nav id without a template case silently falls back to the
        // general page.
        const orphans = [...navIds].filter((id) => !renderableIds.has(id));
        expect(orphans).toEqual([]);

        // And every template case must be reachable from the nav (catches
        // the opposite drift — a new section page added without a nav entry
        // could never be opened).
        const unreachable = [...renderableIds].filter((id) => !navIds.has(id));
        expect(unreachable).toEqual([]);
    });

    it('keeps the settings rail in the expected order', () => {
        expect(
            buildSettingsSectionNavItems({
                supportsEpg: true,
                supportsRemoteControl: true,
            }).map((item) => item.id)
        ).toEqual([
            'general',
            'playback',
            'epg',
            'dashboard',
            'remote-control',
            'tmdb',
            'backup',
            'reset',
            'about',
        ]);
    });
});
