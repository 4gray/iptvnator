import { FormBuilder } from '@angular/forms';
import { Settings, Theme, VideoPlayer } from '@iptvnator/shared/interfaces';
import {
    epgUrlsAddedOutside,
    pickChangedSettings,
    readSettingsPath,
    settingsToFormValue,
    writeSettingsPath,
} from './settings-form-rebase';
import { createSettingsForm } from './settings-form.utils';

const stored = {
    player: VideoPlayer.Html5Player,
    showCaptions: false,
    dashboardRails: { hero: true, tmdbTrending: false },
    tmdb: { enabled: false, apiKey: 'synthetic-stored-key' },
} as unknown as Settings;

describe('pickChangedSettings', () => {
    const fromForm = {
        player: VideoPlayer.VideoJs,
        showCaptions: true,
        dashboardRails: { hero: false, tmdbTrending: true },
        tmdb: { enabled: true, apiKey: 'synthetic-form-key' },
    } as unknown as Settings;

    it('writes only the changed top-level settings', () => {
        expect(pickChangedSettings(fromForm, ['showCaptions'], stored)).toEqual(
            { showCaptions: true }
        );
    });

    it('lays a changed rail over the stored rails', () => {
        expect(
            pickChangedSettings(fromForm, ['dashboardRails.hero'], stored)
        ).toEqual({ dashboardRails: { hero: false, tmdbTrending: false } });
    });

    it('sends only the changed TMDB leaves, which the store merges itself', () => {
        expect(pickChangedSettings(fromForm, ['tmdb.enabled'], stored)).toEqual(
            { tmdb: { enabled: true } }
        );
    });

    it('ignores paths the settings object does not carry', () => {
        expect(pickChangedSettings(fromForm, ['unknown'], stored)).toEqual({});
    });
});

describe('settingsToFormValue', () => {
    const form = createSettingsForm(new FormBuilder(), true);

    it('takes the stored values the settings carry and keeps the rest', () => {
        const current = form.getRawValue();
        const next = settingsToFormValue(
            {
                player: VideoPlayer.Html5Player,
                dashboardRails: { hero: false },
                epgUrl: [' https://example.test/guide.xml ', ''],
                ageRatingCountry: 'not-a-country',
            } as unknown as Settings,
            current
        );

        expect(next.player).toBe(VideoPlayer.Html5Player);
        expect(next.dashboardRails).toEqual({
            ...current.dashboardRails,
            hero: false,
        });
        expect(next.epgUrl).toEqual(['https://example.test/guide.xml']);
        expect(next.ageRatingCountry).toBe('auto');
        expect(next.theme).toBe(current.theme);
        expect(next.tmdb).toEqual(current.tmdb);
    });

    it('uses the same System theme defaults as opening Settings', () => {
        const current = createSettingsForm(
            new FormBuilder(),
            true
        ).getRawValue();
        const next = settingsToFormValue(
            {
                systemLightTheme: Theme.DarkTheme,
                systemDarkTheme: Theme.LightTheme,
            } as Settings,
            current
        );

        expect(next.systemLightTheme).toBe(Theme.LightTheme);
        expect(next.systemDarkTheme).toBe(Theme.DarkTheme);
    });
});

describe('settings path helpers', () => {
    it('reads and writes dotted paths without sharing nested objects', () => {
        const form = createSettingsForm(new FormBuilder(), true);
        const value = form.getRawValue();
        const rails = value.dashboardRails;

        writeSettingsPath(value, 'dashboardRails.hero', false);

        expect(readSettingsPath(value, 'dashboardRails.hero')).toBe(false);
        expect(rails.hero).toBe(true);
        expect(readSettingsPath(undefined, 'player')).toBeUndefined();
    });

    it('lists EPG sources added outside a staged list', () => {
        expect(
            epgUrlsAddedOutside(
                ['https://example.test/staged.xml'],
                ['https://example.test/saved.xml'],
                [
                    'https://example.test/saved.xml',
                    'https://example.test/restored.xml',
                ]
            )
        ).toEqual(['https://example.test/restored.xml']);
    });

    it('matches source identities using the backup URL rules', () => {
        expect(
            epgUrlsAddedOutside(
                ['https://example.test/staged.xml'],
                ['https://example.test/saved.xml'],
                [
                    'https://EXAMPLE.test/saved.xml',
                    'https://EXAMPLE.test/staged.xml',
                    'https://example.test/restored.xml',
                ]
            )
        ).toEqual(['https://example.test/restored.xml']);
    });
});
