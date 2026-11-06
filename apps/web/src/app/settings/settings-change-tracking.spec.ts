import { createSettingsForm } from './settings-form.utils';
import { FormBuilder } from '@angular/forms';
import {
    diffSettingsValues,
    sectionOfSettingsPath,
    SETTINGS_CONTROL_SECTIONS,
    SETTINGS_RESTART_CONTROLS,
} from './settings-change-tracking';

describe('settings change tracking', () => {
    it('lists the leaf values that differ, nested groups per leaf', () => {
        const saved = {
            theme: 'dark',
            dashboardRails: { hero: true, continueWatching: true },
            epgUrl: ['a'],
            tmdb: { enabled: false, apiKey: '' },
        };
        const current = {
            theme: 'light',
            dashboardRails: { hero: false, continueWatching: false },
            epgUrl: ['a', 'b'],
            tmdb: { enabled: false, apiKey: '' },
        };

        expect(diffSettingsValues(current, saved)).toEqual([
            'theme',
            'dashboardRails.hero',
            'dashboardRails.continueWatching',
            'epgUrl',
        ]);
        expect(diffSettingsValues(saved, saved)).toEqual([]);
    });

    it('treats a missing value and null alike, and arrays as one value', () => {
        expect(diffSettingsValues({ a: null }, { a: undefined })).toEqual([]);
        expect(diffSettingsValues({ a: [1, 2] }, { a: [2, 1] })).toEqual([
            'a',
        ]);
        expect(diffSettingsValues({ a: 1 }, {})).toEqual(['a']);
    });

    it('maps a changed path to the page it is edited on', () => {
        expect(sectionOfSettingsPath('dashboardRails.hero')).toBe('dashboard');
        expect(sectionOfSettingsPath('tmdb.apiKey')).toBe('tmdb');
        expect(sectionOfSettingsPath('showCaptions')).toBe('playback');
        expect(sectionOfSettingsPath('unknownControl')).toBeNull();
    });

    it('maps every control of the settings form to a page', () => {
        const form = createSettingsForm(new FormBuilder(), true);
        const unmapped = Object.keys(form.controls).filter(
            (control) => !(control in SETTINGS_CONTROL_SECTIONS)
        );

        expect(unmapped).toEqual([]);
    });

    it('names the row label for every restart control', () => {
        for (const control of Object.keys(SETTINGS_RESTART_CONTROLS)) {
            expect(control in SETTINGS_CONTROL_SECTIONS).toBe(true);
            expect(SETTINGS_RESTART_CONTROLS[control]).toMatch(/^SETTINGS\./);
        }
    });
});
