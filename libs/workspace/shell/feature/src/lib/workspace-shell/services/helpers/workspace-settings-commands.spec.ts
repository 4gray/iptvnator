import {
    SettingsSearchEntry,
    SettingsSearchResult,
    SettingsSearchService,
    SETTINGS_SECTION_DEFINITIONS,
} from '@iptvnator/workspace/shell/util/settings-search';
import {
    buildSettingsPaletteCommands,
    SETTINGS_PALETTE_RESULT_LIMIT,
} from './workspace-settings-commands';

const THEME: SettingsSearchEntry = {
    id: 'theme',
    section: 'general',
    labelKey: 'SETTINGS.THEME',
    keywords: ['dark'],
};
const PLAYER: SettingsSearchEntry = {
    id: 'video-player',
    section: 'playback',
    labelKey: 'SETTINGS.VIDEO_PLAYER_LABEL',
};

function createSettingsSearch() {
    return {
        visibleEntries: jest.fn(() => [THEME, PLAYER]),
        search: jest.fn((): SettingsSearchResult[] => [
            {
                entry: PLAYER,
                section: SETTINGS_SECTION_DEFINITIONS[1],
                label: 'Video player',
                description: '',
                sectionLabel: 'Playback',
                score: 10,
            },
        ]),
        reveal: jest.fn(),
    };
}

describe('buildSettingsPaletteCommands', () => {
    const translate = (key: string) => `t(${key})`;

    it('resolves one settings-group command per visible row', () => {
        const settingsSearch = createSettingsSearch();

        const { commands } = buildSettingsPaletteCommands(
            settingsSearch as unknown as SettingsSearchService,
            translate
        );

        expect(commands).toEqual([
            expect.objectContaining({
                id: 'settings:theme',
                group: 'settings',
                icon: 'tune',
                label: 't(SETTINGS.THEME)',
                description: 't(SETTINGS.NAV_GENERAL)',
                keywords: ['dark'],
                visible: true,
                enabled: true,
            }),
            expect.objectContaining({
                id: 'settings:video-player',
                icon: 'play_circle',
                description: 't(SETTINGS.NAV_PLAYBACK)',
            }),
        ]);
    });

    it('reveals the row when a command runs', () => {
        const settingsSearch = createSettingsSearch();
        const { commands } = buildSettingsPaletteCommands(
            settingsSearch as unknown as SettingsSearchService,
            translate
        );

        commands[1].run({ query: 'player' });

        expect(settingsSearch.reveal).toHaveBeenCalledWith(PLAYER);
    });

    it('delegates ranking to the settings search with the palette cap', () => {
        const settingsSearch = createSettingsSearch();
        const { search } = buildSettingsPaletteCommands(
            settingsSearch as unknown as SettingsSearchService,
            translate
        );

        expect(search('player')).toEqual(['settings:video-player']);
        expect(settingsSearch.search).toHaveBeenCalledWith(
            'player',
            SETTINGS_PALETTE_RESULT_LIMIT
        );
    });
});
