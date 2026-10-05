import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { VodSourceDiscoveryService } from '@iptvnator/portal/shared/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { EMBEDDED_MPV_SUPPORT_RECHECK_MS } from '@iptvnator/shared/interfaces';
import { SETTINGS_SEARCH_ENTRIES } from './settings-search-entries';
import { SETTINGS_SECTION_DEFINITIONS } from './settings-search-sections';
import { SettingsSearchService } from './settings-search.service';

const TRANSLATIONS: Record<string, string> = {
    'SETTINGS.THEME': 'Theme',
    'SETTINGS.THEME_DESCRIPTION': 'Light, dark or system',
    'SETTINGS.VIDEO_PLAYER_LABEL': 'Video player',
    'SETTINGS.VIDEO_PLAYER_DESCRIPTION': 'Engine used for playback',
    'SETTINGS.EPG_VIEW_MODE': 'Programme guide layout',
    'SETTINGS.REMOTE_CONTROL': 'Remote control',
    'SETTINGS.NAV_GENERAL': 'General',
    'SETTINGS.NAV_PLAYBACK': 'Playback',
};

interface RuntimeStub {
    isElectron: boolean;
    supportsEpgImport: boolean;
    supportsEpgDataManagement: boolean;
    supportsRemoteControl: boolean;
    supportsStartupWindowMode: boolean;
    supportsPortalConnectivityGuard: boolean;
    supportsManagedExternalPlayers: boolean;
    supportsExternalPlayerPathSettings: boolean;
    supportsEmbeddedMpv: boolean;
}

function setup(runtime: Partial<RuntimeStub> = {}) {
    const router = { navigate: jest.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
        providers: [
            {
                provide: RuntimeCapabilitiesService,
                useValue: {
                    isElectron: false,
                    supportsEpgImport: false,
                    supportsEpgDataManagement: false,
                    supportsRemoteControl: false,
                    supportsStartupWindowMode: false,
                    supportsPortalConnectivityGuard: false,
                    supportsManagedExternalPlayers: false,
                    supportsExternalPlayerPathSettings: false,
                    supportsEmbeddedMpv: false,
                    ...runtime,
                },
            },
            {
                provide: VodSourceDiscoveryService,
                useValue: { isAvailable: false },
            },
            { provide: Router, useValue: router },
            {
                provide: TranslateService,
                useValue: {
                    instant: (key: string) => TRANSLATIONS[key] ?? key,
                },
            },
        ],
    });
    return { service: TestBed.inject(SettingsSearchService), router };
}

const DESKTOP: Partial<RuntimeStub> = {
    isElectron: true,
    supportsEpgImport: true,
    supportsEpgDataManagement: true,
    supportsRemoteControl: true,
    supportsStartupWindowMode: true,
    supportsPortalConnectivityGuard: true,
    supportsManagedExternalPlayers: true,
    supportsExternalPlayerPathSettings: true,
};

describe('SettingsSearchService', () => {
    it('gives every entry a unique id and a known section', () => {
        const ids = SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id);
        const sectionIds = new Set(
            SETTINGS_SECTION_DEFINITIONS.map((section) => section.id)
        );

        expect(new Set(ids).size).toBe(ids.length);
        for (const entry of SETTINGS_SEARCH_ENTRIES) {
            expect(sectionIds.has(entry.section)).toBe(true);
        }
    });

    it('points every fallback at a row of the same section', () => {
        const byId = new Map(
            SETTINGS_SEARCH_ENTRIES.map((entry) => [entry.id, entry])
        );

        for (const entry of SETTINGS_SEARCH_ENTRIES) {
            if (entry.fallbackId) {
                expect(byId.get(entry.fallbackId)?.section).toBe(entry.section);
                // A fallback must itself always render, or it cannot help.
                expect(byId.get(entry.fallbackId)?.fallbackId).toBeUndefined();
            }
        }
    });

    it('hides sections and rows the runtime cannot render', () => {
        const { service } = setup();

        const sections = service.visibleSections().map(({ id }) => id);
        const entries = service.visibleEntries().map(({ id }) => id);

        expect(sections).not.toContain('epg');
        expect(sections).not.toContain('remote-control');
        expect(entries).not.toContain('epg-view-mode');
        expect(entries).not.toContain('recording-folder');
        expect(entries).not.toContain('mpv-player-path');
        expect(entries).toContain('theme');
        expect(service.search('guide')).toEqual([]);
    });

    it('offers the desktop rows that need no probe on a capable runtime', () => {
        const { service } = setup(DESKTOP);

        const entries = service.visibleEntries().map(({ id }) => id);

        expect(entries).toContain('epg-view-mode');
        expect(entries).toContain('remote-control-port');
        expect(entries).toContain('mpv-player-path');
        expect(entries).not.toContain('vod-auto-failover');
        // Embedded MPV rows wait for the support probe.
        expect(entries).not.toContain('embedded-mpv-extra-options');
        expect(entries).not.toContain('embedded-mpv-frame-copy');
        expect(entries.length).toBe(SETTINGS_SEARCH_ENTRIES.length - 4);
    });

    describe('embedded MPV probe', () => {
        const originalElectron = window.electron;

        afterEach(() => {
            window.electron = originalElectron;
        });

        function probeWith(support: {
            supported: boolean;
            inconclusive?: boolean;
            frameCopyAvailable?: boolean;
        }) {
            const getEmbeddedMpvSupport = jest
                .fn()
                .mockResolvedValue({ platform: 'darwin', ...support });
            window.electron = {
                getEmbeddedMpvSupport,
            } as unknown as typeof window.electron;
            return getEmbeddedMpvSupport;
        }

        it('reveals embedded MPV rows once support resolves, frame copy only when available', async () => {
            const getEmbeddedMpvSupport = probeWith({ supported: true });
            const { service } = setup({
                ...DESKTOP,
                supportsEmbeddedMpv: true,
            });

            await service.ensureEmbeddedMpvSupportLoaded();
            const entries = service.visibleEntries().map(({ id }) => id);

            expect(entries).toContain('embedded-mpv-extra-options');
            expect(entries).toContain('embedded-mpv-auto-reconnect');
            // Frame copy is not available on this machine, so the row the
            // settings page never renders must not be offered either.
            expect(entries).not.toContain('embedded-mpv-frame-copy');
            expect(service.ensureEmbeddedMpvSupportLoaded()).toBeUndefined();
            expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(1);
        });

        it('offers frame copy where the machine can run it', async () => {
            probeWith({ supported: true, frameCopyAvailable: true });
            const { service } = setup({
                ...DESKTOP,
                supportsEmbeddedMpv: true,
            });

            await service.ensureEmbeddedMpvSupportLoaded();

            expect(service.visibleEntries().map(({ id }) => id)).toContain(
                'embedded-mpv-frame-copy'
            );
        });

        it('asks again after an inconclusive answer and keeps the final one', async () => {
            // A slow login shell: mpv was looked up before its PATH arrived.
            const getEmbeddedMpvSupport = probeWith({
                supported: false,
                inconclusive: true,
            });
            const { service } = setup({
                ...DESKTOP,
                supportsEmbeddedMpv: true,
            });
            const entries = () => service.visibleEntries().map(({ id }) => id);

            await service.ensureEmbeddedMpvSupportLoaded();
            expect(entries()).not.toContain('embedded-mpv-extra-options');

            // The shell answered meanwhile, and mpv is there.
            getEmbeddedMpvSupport.mockResolvedValue({
                platform: 'linux',
                supported: true,
            });
            await service.ensureEmbeddedMpvSupportLoaded();
            expect(entries()).toContain('embedded-mpv-extra-options');
            expect(service.ensureEmbeddedMpvSupportLoaded()).toBeUndefined();
            expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(2);
        });

        it('asks again after a failed request instead of giving up for the session', async () => {
            const getEmbeddedMpvSupport = probeWith({ supported: true });
            getEmbeddedMpvSupport.mockRejectedValueOnce(
                new Error('bridge failed')
            );
            const { service } = setup({
                ...DESKTOP,
                supportsEmbeddedMpv: true,
            });
            const entries = () => service.visibleEntries().map(({ id }) => id);

            await service.ensureEmbeddedMpvSupportLoaded();
            expect(entries()).not.toContain('embedded-mpv-extra-options');

            await service.ensureEmbeddedMpvSupportLoaded();
            expect(entries()).toContain('embedded-mpv-extra-options');
            expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(2);
        });

        describe('while the settings page stays open', () => {
            const inconclusive = { supported: false, inconclusive: true };
            const mountedSetup = () =>
                setup({ ...DESKTOP, supportsEmbeddedMpv: true });

            beforeEach(() => jest.useFakeTimers());
            afterEach(() => jest.useRealTimers());

            it('follows an inconclusive answer without being asked again', async () => {
                const getEmbeddedMpvSupport = probeWith(inconclusive);
                const { service } = mountedSetup();
                const entries = () =>
                    service.visibleEntries().map(({ id }) => id);

                // The page starts following once, when it is created.
                service.followEmbeddedMpvSupport();
                await jest.advanceTimersByTimeAsync(0);
                expect(entries()).not.toContain('embedded-mpv-extra-options');

                getEmbeddedMpvSupport.mockResolvedValue({
                    platform: 'linux',
                    supported: true,
                });
                await jest.advanceTimersByTimeAsync(
                    EMBEDDED_MPV_SUPPORT_RECHECK_MS
                );

                expect(entries()).toContain('embedded-mpv-extra-options');
                expect(
                    service.ensureEmbeddedMpvSupportLoaded()
                ).toBeUndefined();
                await jest.advanceTimersByTimeAsync(
                    EMBEDDED_MPV_SUPPORT_RECHECK_MS * 20
                );
                expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(2);
            });

            it('stops asking once the page is closed, and asks again on the next use', async () => {
                const getEmbeddedMpvSupport = probeWith(inconclusive);
                const { service } = mountedSetup();
                const stopFollowing = service.followEmbeddedMpvSupport();
                await jest.advanceTimersByTimeAsync(0);

                // Nothing shows these rows any more: no polling is left.
                stopFollowing();
                await jest.advanceTimersByTimeAsync(
                    EMBEDDED_MPV_SUPPORT_RECHECK_MS * 20
                );
                expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(1);

                await service.ensureEmbeddedMpvSupportLoaded();
                expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(2);
            });

            it('ends on a failed recheck, and the next use asks again', async () => {
                const getEmbeddedMpvSupport = probeWith(inconclusive);
                const { service } = mountedSetup();
                service.followEmbeddedMpvSupport();
                await jest.advanceTimersByTimeAsync(0);

                getEmbeddedMpvSupport.mockRejectedValueOnce(
                    new Error('bridge failed')
                );
                await jest.advanceTimersByTimeAsync(
                    EMBEDDED_MPV_SUPPORT_RECHECK_MS * 20
                );
                expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(2);

                getEmbeddedMpvSupport.mockResolvedValue({
                    platform: 'linux',
                    supported: true,
                });
                await service.ensureEmbeddedMpvSupportLoaded();
                expect(service.visibleEntries().map(({ id }) => id)).toContain(
                    'embedded-mpv-extra-options'
                );
                expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(3);
            });

            it('has nothing to follow once a final answer is in hand', async () => {
                const getEmbeddedMpvSupport = probeWith({ supported: true });
                const { service } = mountedSetup();
                await service.ensureEmbeddedMpvSupportLoaded();

                service.followEmbeddedMpvSupport();
                await jest.advanceTimersByTimeAsync(
                    EMBEDDED_MPV_SUPPORT_RECHECK_MS * 20
                );

                expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(1);
            });
        });

        it('does not probe where the runtime has no embedded MPV bridge', () => {
            const getEmbeddedMpvSupport = probeWith({ supported: true });
            const { service } = setup(DESKTOP);

            expect(service.ensureEmbeddedMpvSupportLoaded()).toBeUndefined();
            expect(getEmbeddedMpvSupport).not.toHaveBeenCalled();
        });
    });

    it('returns translated, ranked results with their section', () => {
        const { service } = setup();

        const [first] = service.search('theme');

        expect(first.entry.id).toBe('theme');
        expect(first.label).toBe('Theme');
        expect(first.description).toBe('Light, dark or system');
        expect(first.sectionLabel).toBe('General');
        expect(first.section.icon).toBe('tune');
    });

    it('matches untranslated keywords and caps results', () => {
        const { service } = setup(DESKTOP);

        expect(service.search('dark')[0].entry.id).toBe('theme');
        expect(service.search('mpv').length).toBeGreaterThan(3);
        expect(service.search('mpv', 2)).toHaveLength(2);
        expect(service.search('   ')).toEqual([]);
    });

    it('keeps settings page order for equal scores', () => {
        const { service } = setup(DESKTOP);

        const ids = service.search('vlc').map(({ entry }) => entry.id);
        const pageOrder = SETTINGS_SEARCH_ENTRIES.map(({ id }) => id).filter(
            (id) => ids.includes(id)
        );

        expect(ids.slice().sort()).toEqual(pageOrder.slice().sort());
        expect(ids.indexOf('vlc-player-path')).toBeLessThan(
            ids.indexOf('vlc-reuse-instance')
        );
    });

    it('navigates to the section and records a reveal request', () => {
        const { service, router } = setup();
        const entry = SETTINGS_SEARCH_ENTRIES.find(
            ({ id }) => id === 'tmdb-api-key'
        );
        if (!entry) {
            throw new Error('missing tmdb-api-key entry');
        }

        service.reveal(entry);

        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace/settings',
            'tmdb',
        ]);
        expect(service.pendingReveal()).toEqual(
            expect.objectContaining({
                id: 'tmdb-api-key',
                section: 'tmdb',
                fallbackId: 'tmdb-enable',
            })
        );
    });

    it('notifies reveal listeners before navigating, until unsubscribed', () => {
        const { service, router } = setup();
        const calls: string[] = [];
        router.navigate.mockImplementation(() => {
            calls.push('navigate');
            return Promise.resolve(true);
        });
        const stop = service.onReveal(() => calls.push('listener'));

        service.reveal(SETTINGS_SEARCH_ENTRIES[0]);
        stop();
        service.reveal(SETTINGS_SEARCH_ENTRIES[1]);

        expect(calls).toEqual(['listener', 'navigate', 'navigate']);
    });

    it('completes only the reveal request that is still pending', () => {
        const { service } = setup();
        const [first, second] = SETTINGS_SEARCH_ENTRIES;

        service.reveal(first);
        const stale = service.pendingReveal();
        service.reveal(second);
        if (!stale) {
            throw new Error('expected a pending reveal');
        }

        service.completeReveal(stale);
        expect(service.pendingReveal()?.id).toBe(second.id);

        const current = service.pendingReveal();
        if (!current) {
            throw new Error('expected a pending reveal');
        }
        service.completeReveal(current);
        expect(service.pendingReveal()).toBeNull();
    });
});
