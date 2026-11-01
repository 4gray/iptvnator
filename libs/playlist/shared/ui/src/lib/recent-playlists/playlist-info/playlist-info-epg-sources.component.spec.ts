import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistInfoComponent } from './playlist-info.component';
import { STALKER_PLAYLIST_CONNECTION_EDITOR } from './stalker-playlist-connection-editor.token';

/**
 * The component is OnPush: the playlist is replaced after the awaited EPG
 * cleanup, outside any template event, so the rendered source list has to
 * follow without a zone-triggered tick.
 */
describe('PlaylistInfoComponent playlist EPG source rows', () => {
    const keepUrl = 'https://playlist.example.com/keep.xml';
    const removeUrl = 'https://playlist.example.com/remove.xml';
    const playlist = {
        id: 'playlist-1',
        _id: 'playlist-1',
        title: 'My Playlist',
        count: 1,
        importDate: '2026-04-01T00:00:00.000Z',
        autoRefresh: false,
        url: 'https://example.com/playlist.m3u',
        epgUrls: [keepUrl, removeUrl],
        detectedEpgUrls: [keepUrl, removeUrl],
    } as Playlist & { id: string };

    function render(data = playlist) {
        const settings = signal({ epgUrl: [] as string[] });
        TestBed.configureTestingModule({
            imports: [PlaylistInfoComponent, TranslateModule.forRoot()],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: data },
                {
                    provide: PlaylistsService,
                    useValue: { getPlaylistById: jest.fn(() => of(data)) },
                },
                { provide: DatabaseService, useValue: {} },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        supportsDataManagement: true,
                        supportsFilePicker: true,
                        pickEpgFile: jest
                            .fn()
                            .mockResolvedValue('/home/user/epg/guide.xml.gz'),
                        clearEpgDataForSource: jest
                            .fn()
                            .mockResolvedValue({ success: true }),
                    },
                },
                { provide: Store, useValue: { dispatch: jest.fn() } },
                {
                    provide: SettingsStore,
                    useValue: {
                        getSettings: jest.fn(() => settings()),
                        updateSettings: jest.fn(
                            async (value: { epgUrl: string[] }) =>
                                settings.set(value)
                        ),
                    },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: MatDialogRef,
                    useValue: {
                        beforeClosed: () => new Subject<void>(),
                        close: jest.fn(),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsDesktopFileSave: false },
                },
                { provide: STALKER_PLAYLIST_CONNECTION_EDITOR, useValue: {} },
            ],
        });
        const fixture = TestBed.createComponent(PlaylistInfoComponent);
        fixture.detectChanges();
        return fixture;
    }

    const manualUrl = 'https://epg.test/manual.xml';
    const mixed = {
        ...playlist,
        epgUrls: [keepUrl, manualUrl],
        manualEpgUrls: [manualUrl],
        disabledEpgUrls: [removeUrl],
    };

    it('counts only enabled detected sources and preserves known provenance', () => {
        const component = render(mixed).componentInstance;
        expect(component.epg.enabledDetectedCount).toBe(1);
        expect(component.epg.detectedUrls).toEqual([keepUrl, removeUrl]);
        expect(component.epg.hiddenDetectedUrls).toEqual([removeUrl]);
        expect(component.epg.originKey(keepUrl)).toBe(
            'SETTINGS.PLAYLIST_EPG_FROM_PLAYLIST'
        );
        expect(component.epg.originKey(manualUrl)).toBe(
            'SETTINGS.PLAYLIST_EPG_ADDED_MANUALLY'
        );
    });

    it('does not infer playlist provenance for legacy sources', () => {
        const component = render({
            ...playlist,
            detectedEpgUrls: [],
            manualEpgUrls: [manualUrl],
        }).componentInstance;
        expect(component.epg.detectedUrls).toEqual([]);
        expect(component.epg.enabledDetectedCount).toBe(0);
        expect(component.epg.originKey(keepUrl)).toBe(
            'SETTINGS.PLAYLIST_EPG_SAVED_SOURCE'
        );
        expect(component.epg.originKey(manualUrl)).toBe(
            'SETTINGS.PLAYLIST_EPG_ADDED_MANUALLY'
        );
    });

    it('deduplicates detected URLs and never offers legacy local header sources', () => {
        const component = render({
            ...mixed,
            detectedEpgUrls: [keepUrl, ` ${keepUrl} `, 'file:///etc/passwd'],
        }).componentInstance;
        expect(component.epg.detectedUrls).toEqual([keepUrl]);
        expect(component.epg.enabledDetectedCount).toBe(1);
        component.epg.enableDetected('file:///etc/passwd');
        expect(TestBed.inject(Store).dispatch).not.toHaveBeenCalled();
    });

    it('enables a detected source without losing manual sources or unrelated exclusions', () => {
        const component = render({
            ...mixed,
            disabledEpgUrls: [removeUrl, 'https://epg.test/other.xml'],
        }).componentInstance;
        component.epg.enableDetected(removeUrl);
        expect(component.epg.enabledDetectedCount).toBe(2);
        expect(component.epg.hiddenDetectedUrls).toEqual([]);
        expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                playlist: expect.objectContaining({
                    epgUrls: [keepUrl, manualUrl, removeUrl],
                    manualEpgUrls: [manualUrl, removeUrl],
                    disabledEpgUrls: ['https://epg.test/other.xml'],
                }),
            })
        );
        component.epg.enableDetected('https://unrelated.test/guide.xml');
        expect(TestBed.inject(Store).dispatch).toHaveBeenCalledTimes(1);
    });

    it('shows global scope after adding a source to settings and avoids duplicates', async () => {
        const fixture = render(mixed);
        fixture.autoDetectChanges();
        const host = fixture.nativeElement as HTMLElement;
        const button = host.querySelector<HTMLButtonElement>(
            'button[aria-label="SETTINGS.PLAYLIST_EPG_ADD_GLOBAL"]'
        );
        if (!button) throw new Error('Missing global settings action');
        button.click();
        await fixture.whenStable();
        expect(button.disabled).toBe(true);
        expect(host.textContent).toContain('SETTINGS.PLAYLIST_EPG_IN_GLOBAL');
        expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
            'SETTINGS.PLAYLIST_EPG_ADDED_GLOBAL',
            'CLOSE',
            { duration: 3000 }
        );
        await fixture.componentInstance.epg.addToSettings(keepUrl);
        expect(
            TestBed.inject(SettingsStore).updateSettings
        ).toHaveBeenCalledTimes(1);
        expect(TestBed.inject(Store).dispatch).not.toHaveBeenCalled();
    });

    it('drops a removed source row once its cleanup resolves', async () => {
        const fixture = render();
        const renderedSources = () =>
            Array.from(
                (fixture.nativeElement as HTMLElement).querySelectorAll(
                    '[data-epg-source-state="enabled"] input[readonly]'
                ),
                (input) => (input as HTMLInputElement).value
            );
        expect(renderedSources()).toEqual([keepUrl, removeUrl]);

        // From here the fixture renders on its own: a forced detectChanges()
        // after the cleanup would hide a row update that schedules no render.
        fixture.autoDetectChanges();
        await fixture.componentInstance.epg.remove(removeUrl);
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));

        expect(renderedSources()).toEqual([keepUrl]);
    });

    it('finishes an authorized removal without focusing a closed dialog', async () => {
        const fixture = render();
        const section = (
            fixture.nativeElement as HTMLElement
        ).querySelector<HTMLElement>('[data-test-id="playlist-epg-sources"]');
        if (!section) throw new Error('Missing EPG section');
        const dispatch = TestBed.inject(Store).dispatch;
        const pending = fixture.componentInstance.epg.remove(
            removeUrl,
            section
        );
        section.remove();
        fixture.destroy();
        await expect(pending).resolves.toBeUndefined();
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                playlist: expect.objectContaining({ epgUrls: [keepUrl] }),
            })
        );
    });

    // The native file pick resolves after an await, with no template event.
    // The main Save button and the field must follow without a forced render.
    it('enables Save after a native EPG file pick without a forced render', async () => {
        const fixture = render();
        fixture.autoDetectChanges();
        await fixture.whenStable();
        const host = fixture.nativeElement as HTMLElement;
        const save = () =>
            host.querySelector<HTMLButtonElement>('button[type="submit"]');
        const field = () =>
            host.querySelector<HTMLInputElement>(
                '.playlist-epg-source-form .playlist-epg-source-row input'
            );
        expect(save()?.disabled).toBe(true);

        await fixture.componentInstance.epg.browseInput(0);
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));

        expect(field()?.value).toBe('/home/user/epg/guide.xml.gz');
        expect(save()?.disabled).toBe(false);
    });

    it('includes new EPG sources and the title in one main Save without persisting draft controls', async () => {
        const fixture = render();
        const component = fixture.componentInstance;
        component.playlistDetails.controls['title'].setValue('Renamed');
        component.epg.inputs.at(0).setValue(' https://epg.test/new.xml ');
        await component.saveChanges(component.playlistDetails.value);

        const dispatch = TestBed.inject(Store).dispatch as jest.Mock;
        expect(dispatch).toHaveBeenCalledTimes(1);
        const saved = dispatch.mock.calls[0][0].playlist;
        expect(saved).toMatchObject({
            title: 'Renamed',
            epgUrls: [keepUrl, removeUrl, 'https://epg.test/new.xml'],
            manualEpgUrls: ['https://epg.test/new.xml'],
            detectedEpgUrls: [keepUrl, removeUrl],
            disabledEpgUrls: [],
        });
        expect(saved).not.toHaveProperty('playlistEpgSourceInputs');
        expect(TestBed.inject(MatDialogRef).close).toHaveBeenCalledTimes(1);
    });

    it('deduplicates main-Save drafts and re-enables a disabled detected URL', async () => {
        const fixture = render();
        const component = fixture.componentInstance;
        component.playlist = {
            ...playlist,
            epgUrls: [keepUrl],
            manualEpgUrls: [],
            disabledEpgUrls: [removeUrl, 'https://epg.test/other.xml'],
        };
        component.epg.inputs.at(0).setValue(removeUrl);
        component.epg.addInput();
        component.epg.inputs.at(1).setValue(` ${removeUrl} `);
        await component.saveChanges(component.playlistDetails.value);
        expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                playlist: expect.objectContaining({
                    epgUrls: [keepUrl, removeUrl],
                    manualEpgUrls: [removeUrl],
                    disabledEpgUrls: ['https://epg.test/other.xml'],
                }),
            })
        );
    });

    it('does not save or close when a new EPG source is invalid', async () => {
        const fixture = render();
        const component = fixture.componentInstance;
        component.epg.inputs.at(0).setValue('not-a-source');
        await component.saveChanges(component.playlistDetails.value);
        expect(TestBed.inject(Store).dispatch).not.toHaveBeenCalled();
        expect(TestBed.inject(MatDialogRef).close).not.toHaveBeenCalled();
        expect(component.epg.inputs.at(0).value).toBe('not-a-source');
    });

    it('clears the rendered EPG draft after its independent save and keeps unsaved metadata separate', async () => {
        const fixture = render();
        fixture.autoDetectChanges();
        await fixture.whenStable();
        const component = fixture.componentInstance;
        component.playlistDetails.controls['title'].setValue('Unsaved title');
        const input = (
            fixture.nativeElement as HTMLElement
        ).querySelector<HTMLInputElement>('.playlist-epg-source-form input')!;
        if (!input) throw new Error('Missing EPG input');
        input.value = 'https://epg.test/manual.xml';
        input.dispatchEvent(new Event('input'));
        component.epg.save();
        await fixture.whenStable();
        const renderedInput = (
            fixture.nativeElement as HTMLElement
        ).querySelector<HTMLInputElement>('.playlist-epg-source-form input')!;
        if (!renderedInput) throw new Error('Missing reset EPG input');
        expect(renderedInput.value).toBe('');
        const dispatch = TestBed.inject(Store).dispatch as jest.Mock;
        expect(dispatch.mock.calls[0][0].playlist).not.toHaveProperty('title');
        expect(component.playlistDetails.controls['title'].value).toBe(
            'Unsaved title'
        );
        expect(TestBed.inject(MatDialogRef).close).not.toHaveBeenCalled();
    });
});
