import { SettingsSectionDefinition } from './settings-search.types';

/**
 * Settings section pages in navigation order. Single source for the settings
 * page navigation, the settings search index and the command palette.
 */
export const SETTINGS_SECTION_DEFINITIONS: readonly SettingsSectionDefinition[] =
    [
        { id: 'general', navLabelKey: 'SETTINGS.NAV_GENERAL', icon: 'tune' },
        {
            id: 'playback',
            navLabelKey: 'SETTINGS.NAV_PLAYBACK',
            icon: 'play_circle',
        },
        {
            id: 'epg',
            navLabelKey: 'SETTINGS.NAV_EPG',
            icon: 'calendar_month',
            requires: ['epg'],
        },
        {
            id: 'dashboard',
            navLabelKey: 'SETTINGS.NAV_DASHBOARD',
            icon: 'dashboard',
        },
        {
            id: 'remote-control',
            navLabelKey: 'SETTINGS.NAV_REMOTE',
            icon: 'smartphone',
            requires: ['remote-control'],
        },
        { id: 'tmdb', navLabelKey: 'SETTINGS.NAV_TMDB', icon: 'movie' },
        {
            id: 'parental',
            navLabelKey: 'SETTINGS.NAV_PARENTAL',
            icon: 'family_restroom',
        },
        { id: 'backup', navLabelKey: 'SETTINGS.NAV_BACKUP', icon: 'backup' },
        {
            id: 'reset',
            navLabelKey: 'SETTINGS.NAV_RESET',
            icon: 'delete_sweep',
        },
        { id: 'about', navLabelKey: 'SETTINGS.NAV_ABOUT', icon: 'info' },
    ];

export function meetsSettingsRequirements(
    requires: SettingsSectionDefinition['requires'],
    capabilities: Readonly<Record<string, boolean>>
): boolean {
    return (requires ?? []).every((requirement) => capabilities[requirement]);
}
