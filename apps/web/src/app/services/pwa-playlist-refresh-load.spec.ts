import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PLAYLIST_UPDATE } from '@iptvnator/shared/interfaces';
import { PwaService } from './pwa.service';

// A stale or offline PWA cannot fetch the lazily loaded refresh chunk.
// The ESM runner resolves `unstable_mockModule` paths from `src/test-setup.ts`,
// not from this file, so the path is relative to `apps/web/src`:
// `./pwa-playlist-refresh` fails with "Cannot find module".
jest.unstable_mockModule('./app/services/pwa-playlist-refresh', () => {
    throw new Error('Synthetic chunk load failure');
});

describe('PwaService playlist refresh chunk', () => {
    it('reports and settles when the refresh flow cannot load', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const open = jest.fn().mockResolvedValue(null);
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [
                PwaService,
                { provide: LazySnackBar, useValue: { open } },
                { provide: Store, useValue: { dispatch: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });

        const pending = TestBed.inject(PwaService).sendIpcEvent(
            PLAYLIST_UPDATE,
            { id: 'playlist-1', url: 'https://provider.example/list.m3u' }
        );

        await expect(pending).resolves.toBeUndefined();
        expect(open).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.PLAYLIST_UPDATE_FAILED',
            'CLOSE',
            { duration: 5000 }
        );
    });
});
