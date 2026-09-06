import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { DataService } from '@iptvnator/services';
import {
    PLAYLIST_PARSE_BY_URL,
    ProviderImportCandidate,
} from '@iptvnator/shared/interfaces';
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
                    userAgent: '  IPTVnator-Test/1.0  ',
                    playlistUrl: ' https://example.com/list.m3u ',
                }),
            },
        }));

        component.submitUrlPlaylist();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_PARSE_BY_URL,
            {
                title: 'My Playlist',
                userAgent: 'IPTVnator-Test/1.0',
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
                    userAgent: '   ',
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
        {
            type: 'auto',
            childAccessor: 'autoImport',
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

    describe('auto-detect candidate handoff', () => {
        const applyPrefill = () =>
            (
                component as unknown as { applyPendingPrefill(): void }
            ).applyPendingPrefill();

        it.each([
            ['xtream', 'xtream'],
            ['stalker', 'stalker'],
            ['m3u-url', 'url'],
            ['m3u-text', 'text'],
        ] as const)(
            'switches to the %s import form for a %s candidate',
            (kind, expectedMethod) => {
                component.onCandidateSelected({
                    kind,
                    confidence: 'high',
                } as ProviderImportCandidate);

                expect(component.method()).toBe(expectedMethod);
            }
        );

        it('prefills the xtream form once the child exists and clears the pending candidate', () => {
            const patchValue = jest.fn();
            (component as { xtreamImport: jest.Mock }).xtreamImport = jest.fn(
                () => ({ form: { patchValue } })
            );

            component.onCandidateSelected({
                kind: 'xtream',
                confidence: 'high',
                serverUrl: 'http://tv.example.com:8080',
                username: 'alice',
                password: 's3cret',
                suggestedTitle: 'tv.example.com',
            });
            applyPrefill();

            expect(patchValue).toHaveBeenCalledWith({
                title: 'tv.example.com',
                serverUrl: 'http://tv.example.com:8080',
                username: 'alice',
                password: 's3cret',
            });

            // A second run must be a no-op — the candidate was consumed.
            applyPrefill();
            expect(patchValue).toHaveBeenCalledTimes(1);
        });

        it('drops the candidate when the user switches to another method first', () => {
            const patchValue = jest.fn();
            (component as { xtreamImport: jest.Mock }).xtreamImport = jest.fn(
                () => ({ form: { patchValue } })
            );

            component.onCandidateSelected({
                kind: 'xtream',
                confidence: 'high',
                username: 'alice',
            });
            // The user clicks another tile before the xtream form mounted.
            component.method.set('file');
            applyPrefill();

            // Coming back to the xtream form later must not prefill it.
            component.method.set('xtream');
            applyPrefill();

            expect(patchValue).not.toHaveBeenCalled();
        });

        it('keeps the candidate pending while the target form does not exist yet', () => {
            (component as { xtreamImport: jest.Mock }).xtreamImport = jest.fn(
                () => undefined
            );
            const patchValue = jest.fn();

            component.onCandidateSelected({
                kind: 'xtream',
                confidence: 'high',
                username: 'alice',
            });
            applyPrefill();

            // Child appears on a later change-detection pass.
            (component as { xtreamImport: jest.Mock }).xtreamImport = jest.fn(
                () => ({ form: { patchValue } })
            );
            applyPrefill();

            expect(patchValue).toHaveBeenCalledWith(
                expect.objectContaining({ username: 'alice' })
            );
        });

        it('prefills the stalker form including identity fields', () => {
            const patchValue = jest.fn();
            (component as { stalkerImport: jest.Mock }).stalkerImport =
                jest.fn(() => ({ form: { patchValue } }));

            component.onCandidateSelected({
                kind: 'stalker',
                confidence: 'high',
                portalUrl: 'http://stb.example.com/c/',
                macAddress: '00:1A:79:12:34:56',
                serialNumber: 'SN123',
                deviceId1: 'a'.repeat(64),
                deviceId2: 'b'.repeat(64),
                signature1: 'c'.repeat(64),
                signature2: 'd'.repeat(64),
                username: 'stbuser',
                password: 'stbpass',
                suggestedTitle: 'stb.example.com',
            });
            applyPrefill();

            expect(patchValue).toHaveBeenCalledWith({
                title: 'stb.example.com',
                portalUrl: 'http://stb.example.com/c/',
                macAddress: '00:1A:79:12:34:56',
                serialNumber: 'SN123',
                deviceId1: 'a'.repeat(64),
                deviceId2: 'b'.repeat(64),
                signature1: 'c'.repeat(64),
                signature2: 'd'.repeat(64),
                username: 'stbuser',
                password: 'stbpass',
            });
        });

        it('prefills the URL form for an m3u-url candidate', () => {
            const patchValue = jest.fn();
            (component as { urlUpload: jest.Mock }).urlUpload = jest.fn(() => ({
                form: { patchValue },
            }));

            component.onCandidateSelected({
                kind: 'm3u-url',
                confidence: 'high',
                url: 'https://lists.example.com/main.m3u',
                suggestedTitle: 'lists.example.com',
            });
            applyPrefill();

            expect(patchValue).toHaveBeenCalledWith({
                playlistUrl: 'https://lists.example.com/main.m3u',
                playlistName: 'lists.example.com',
            });
        });

        it('prefills the raw-text form for an m3u-text candidate', () => {
            const patchValue = jest.fn();
            (component as { textImport: jest.Mock }).textImport = jest.fn(
                () => ({ textForm: { patchValue } })
            );

            component.onCandidateSelected({
                kind: 'm3u-text',
                confidence: 'high',
                text: '#EXTM3U\nhttp://streams.example.com/1.ts',
            });
            applyPrefill();

            expect(patchValue).toHaveBeenCalledWith({
                text: '#EXTM3U\nhttp://streams.example.com/1.ts',
            });
        });
    });

    function selectType(type: PlaylistType): void {
        // The dialog now uses a single `method` signal across all 6 source
        // methods — no more category × subtype matrix.
        component.method.set(type);
    }
});
