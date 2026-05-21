import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { DataService } from '@iptvnator/services';
import { PLAYLIST_PARSE_BY_URL } from '@iptvnator/shared/interfaces';
import { PlaylistType } from '@iptvnator/playlist/shared/ui';
import { AddPlaylistDialogComponent } from './add-playlist-dialog.component';

describe('AddPlaylistDialogComponent', () => {
    let component: AddPlaylistDialogComponent;
    let dataService: { sendIpcEvent: jest.Mock };
    let dialogRef: { close: jest.Mock };
    let store: { dispatch: jest.Mock };

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        dialogRef = {
            close: jest.fn(),
        };
        store = {
            dispatch: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: DataService,
                    useValue: dataService,
                },
                {
                    provide: MatDialogRef,
                    useValue: dialogRef,
                },
                {
                    provide: Store,
                    useValue: store,
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((value: string) => value),
                    },
                },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: null,
                },
            ],
        });

        component = TestBed.runInInjectionContext(
            () => new AddPlaylistDialogComponent()
        );
    });

    it('sends a trimmed custom title for URL playlists', () => {
        (component as { urlUpload: jest.Mock }).urlUpload = jest.fn(() => ({
            form: {
                getRawValue: () => ({
                    playlistName: '  My Playlist  ',
                    playlistUrl: ' https://example.com/list.m3u ',
                }),
            },
        }));

        component.submitUrlPlaylist();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_PARSE_BY_URL,
            {
                title: 'My Playlist',
                url: 'https://example.com/list.m3u',
            }
        );
        expect(dialogRef.close).toHaveBeenCalled();
    });

    it('omits the title when the optional name is blank', () => {
        (component as { urlUpload: jest.Mock }).urlUpload = jest.fn(() => ({
            form: {
                getRawValue: () => ({
                    playlistName: '   ',
                    playlistUrl: 'https://example.com/list.m3u',
                }),
            },
        }));

        component.submitUrlPlaylist();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_PARSE_BY_URL,
            {
                url: 'https://example.com/list.m3u',
            }
        );
        expect(dialogRef.close).toHaveBeenCalled();
    });

    it('dispatches imported text and closes the dialog', () => {
        component.uploadAsText('#EXTM3U');

        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.parsePlaylist({
                uploadType: 'TEXT',
                playlist: '#EXTM3U',
                title: 'HOME.IMPORTED_AS_TEXT',
            })
        );
        expect(dialogRef.close).toHaveBeenCalled();
    });

    it('closes the dialog after a successful file import', () => {
        component.onFileImported();

        expect(dialogRef.close).toHaveBeenCalled();
    });

    it.each([
        {
            type: 'url',
            childAccessor: 'urlUpload',
            clearMethod: 'clearForm',
        },
        {
            type: 'file',
            childAccessor: 'fileUpload',
            clearMethod: 'clearSelection',
        },
        {
            type: 'text',
            childAccessor: 'textImport',
            clearMethod: 'clearForm',
        },
        {
            type: 'xtream',
            childAccessor: 'xtreamImport',
            clearMethod: 'clearForm',
        },
        {
            type: 'stalker',
            childAccessor: 'stalkerImport',
            clearMethod: 'clearForm',
        },
    ] as const)(
        'clears the current $type import surface',
        ({ type, childAccessor, clearMethod }) => {
            const clear = jest.fn();
            (component as unknown as Record<string, jest.Mock>)[childAccessor] =
                jest.fn(() => ({
                    [clearMethod]: clear,
                }));
            selectType(type);

            component.clearCurrentForm();

            expect(clear).toHaveBeenCalledTimes(1);
        }
    );

    it('disables clear when a file upload has no selection', () => {
        (component as { fileUpload: jest.Mock }).fileUpload = jest.fn(() => ({
            isImporting: () => false,
            selectedFile: () => null,
        }));
        selectType('file');

        expect(component.isClearDisabled()).toBeTruthy();
    });

    it('defaults to the URL method when no deep-link type is provided', () => {
        // Constructor-injected MAT_DIALOG_DATA is null in this spec setup,
        // so the dialog should land on its default first-row method.
        expect(component.method()).toBe('url');
        expect(component.playlistType()).toBe('url');
    });

    it.each([
        ['url' as PlaylistType, 'url' as PlaylistType],
        ['file' as PlaylistType, 'file' as PlaylistType],
        ['text' as PlaylistType, 'text' as PlaylistType],
        ['xtream' as PlaylistType, 'xtream' as PlaylistType],
        ['stalker' as PlaylistType, 'stalker' as PlaylistType],
    ])(
        'opens directly on the %s method when MAT_DIALOG_DATA.type === %s (deep-link from rail / shell action)',
        (deepLinkType, expectedMethod) => {
            // Rebuild the component with a deep-link to confirm the
            // flat-method signal honours the legacy { type } payload shape.
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    { provide: DataService, useValue: dataService },
                    { provide: MatDialogRef, useValue: dialogRef },
                    { provide: Store, useValue: store },
                    { provide: MatSnackBar, useValue: { open: jest.fn() } },
                    {
                        provide: TranslateService,
                        useValue: {
                            instant: jest.fn((value: string) => value),
                        },
                    },
                    {
                        provide: MAT_DIALOG_DATA,
                        useValue: { type: deepLinkType },
                    },
                ],
            });
            const deepLinked = TestBed.runInInjectionContext(
                () => new AddPlaylistDialogComponent()
            );

            expect(deepLinked.method()).toBe(expectedMethod);
            expect(deepLinked.playlistType()).toBe(expectedMethod);
        }
    );

    function selectType(type: PlaylistType): void {
        // The dialog now uses a single `method` signal across all 5 source
        // types — no more category × subtype matrix.
        component.method.set(type);
    }
});
