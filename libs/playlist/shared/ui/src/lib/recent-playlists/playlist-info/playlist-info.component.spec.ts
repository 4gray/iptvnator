import { Clipboard } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from 'm3u-state';
import { DatabaseService, PlaylistsService } from 'services';
import { Playlist } from 'shared-interfaces';
import { PlaylistInfoComponent } from './playlist-info.component';

describe('PlaylistInfoComponent source VPN settings', () => {
    let component: PlaylistInfoComponent;
    let originalElectron: unknown;
    let store: { dispatch: jest.Mock };

    beforeEach(() => {
        originalElectron = window.electron;
        (window as typeof window & { electron?: unknown }).electron = {};
        store = {
            dispatch: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                DatePipe,
                {
                    provide: Clipboard,
                    useValue: {
                        copy: jest.fn(),
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: {
                        updateXtreamPlaylistDetails: jest
                            .fn()
                            .mockResolvedValue(true),
                    },
                },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        _id: 'playlist-1',
                        id: 'playlist-1',
                        autoRefresh: false,
                        count: 0,
                        importDate: '2026-05-15T00:00:00.000Z',
                        lastUsage: '2026-05-15T00:00:00.000Z',
                        title: 'Source One',
                        url: 'https://example.com/source.m3u',
                        vpnProvider: 'proton',
                        vpnLocation: 'DE',
                        vpnAutoConnectOnOpen: false,
                        vpnAutoConnectWhenDefault: false,
                    } as Playlist & { id: string },
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getRawPlaylistById: jest.fn(),
                    },
                },
                {
                    provide: Store,
                    useValue: store,
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
            ],
        });

        component = TestBed.runInInjectionContext(
            () => new PlaylistInfoComponent()
        );
    });

    afterEach(() => {
        (window as typeof window & { electron?: unknown }).electron =
            originalElectron;
        TestBed.resetTestingModule();
    });

    it('loads the saved VPN country in the source settings form', () => {
        expect(component.isDesktop).toBe(true);
        expect(
            component.vpnLocationOptions.some((option) => option.code === 'HR')
        ).toBe(true);
        expect(component.playlistDetails.get('vpnProvider')?.value).toBe(
            'proton'
        );
        expect(component.playlistDetails.get('vpnLocation')?.value).toBe('DE');
    });

    it('saves source-scoped VPN country changes through playlist meta', async () => {
        component.playlistDetails.patchValue({
            vpnLocation: 'HR',
            vpnAutoConnectOnOpen: true,
            vpnAutoConnectWhenDefault: true,
        });

        await component.saveChanges(component.playlistDetails.value);

        const action = store.dispatch.mock.calls[0][0];
        expect(action.type).toBe(PlaylistActions.updatePlaylistMeta.type);
        expect(action.playlist).toEqual(
            expect.objectContaining({
                _id: 'playlist-1',
                vpnProvider: 'proton',
                vpnLocation: 'HR',
                vpnAutoConnectOnOpen: true,
                vpnAutoConnectWhenDefault: true,
            })
        );
    });
});
