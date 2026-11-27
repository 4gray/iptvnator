import {
    coerceProvidedDefaultOnSettings,
    resolveDefaultOnSettings,
} from './settings-opt-out.util';

describe('default-on settings coercion', () => {
    it('resolves every default-on flag, treating only explicit false as an opt-out', () => {
        expect(
            resolveDefaultOnSettings({
                webPlayerSharedControls: false,
                portalConnectivityGuard: 'false' as unknown as boolean,
            })
        ).toEqual({
            epgEnabled: true,
            webPlayerSharedControls: false,
            portalConnectivityGuard: true,
            embeddedMpvAutoReconnect: true,
            seriesAutoplay: true,
            showCoverTitles: true,
            m3uCatalogTabs: true,
        });
    });

    it('coerces only the flags an update actually carries', () => {
        expect(
            coerceProvidedDefaultOnSettings({
                showCoverTitles: false,
                seriesAutoplay: false,
                embeddedMpvAutoReconnect: undefined,
                language: undefined,
            })
        ).toEqual({ showCoverTitles: false, seriesAutoplay: false });
        expect(coerceProvidedDefaultOnSettings({})).toEqual({});
    });
});
