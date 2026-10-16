import { WorkspaceResolvedCommandItem } from '@iptvnator/portal/shared/util';
import {
    SETTINGS_SECTION_DEFINITIONS,
    SettingsSearchService,
} from '@iptvnator/workspace/shell/util/settings-search';
import { TranslateFn } from './workspace-shell-search-labels';

/** Palette rows reserved for settings matches, so commands stay visible. */
export const SETTINGS_PALETTE_RESULT_LIMIT = 6;

const SETTINGS_COMMAND_PREFIX = 'settings:';

export interface SettingsPaletteCommands {
    /** One command per visible settings row, for recents and selection. */
    readonly commands: WorkspaceResolvedCommandItem[];
    /** Ids of the best settings commands for `query`, best first. */
    readonly search: (query: string) => readonly string[];
}

/**
 * Settings rows as command palette entries. Ranking is delegated to
 * `SettingsSearchService` so the palette and the settings page search agree
 * on which settings match and in which order.
 */
export function buildSettingsPaletteCommands(
    settingsSearch: SettingsSearchService,
    translate: TranslateFn
): SettingsPaletteCommands {
    const sections = new Map(
        SETTINGS_SECTION_DEFINITIONS.map((section) => [section.id, section])
    );

    const commands = settingsSearch
        .visibleEntries()
        .map((entry): WorkspaceResolvedCommandItem => {
            const section = sections.get(entry.section);
            return {
                id: `${SETTINGS_COMMAND_PREFIX}${entry.id}`,
                group: 'settings',
                icon: section?.icon ?? 'settings',
                label: translate(entry.labelKey),
                description: section ? translate(section.navLabelKey) : '',
                keywords: entry.keywords ?? [],
                priority: 100,
                visible: true,
                enabled: true,
                run: () => settingsSearch.reveal(entry),
            };
        });

    return {
        commands,
        search: (query) =>
            settingsSearch
                .search(query, SETTINGS_PALETTE_RESULT_LIMIT)
                .map(({ entry }) => `${SETTINGS_COMMAND_PREFIX}${entry.id}`),
    };
}
