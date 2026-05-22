import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { PORTAL_NAVIGATION_ACTIONS } from '@iptvnator/portal/shared/util';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { NavigationComponent } from './navigation.component';

describe('NavigationComponent', () => {
    let playlist: ReturnType<typeof signal<Partial<Playlist> | undefined>>;
    let runtime: {
        supportsDownloads: boolean;
    };

    beforeEach(async () => {
        playlist = signal<Partial<Playlist> | undefined>({
            _id: 'xtream-1',
        });
        runtime = {
            supportsDownloads: true,
        };

        await TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), NavigationComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            params: {
                                id: 'xtream-1',
                            },
                        },
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        selectSignal: jest.fn(() => playlist),
                    },
                },
                {
                    provide: PORTAL_NAVIGATION_ACTIONS,
                    useValue: {
                        openAccountInfo: jest.fn(),
                        openPlaylistInfo: jest.fn(),
                        openSettings: jest.fn(),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
            ],
        }).compileComponents();
    });

    function createComponent(): NavigationComponent {
        return TestBed.createComponent(NavigationComponent).componentInstance;
    }

    it('includes downloads in portal rail links when downloads are supported', () => {
        runtime.supportsDownloads = true;

        const component = createComponent();

        expect(component.secondaryLinks().map((link) => link.section)).toEqual([
            'recently-added',
            'search',
            'downloads',
        ]);
    });

    it('hides downloads in portal rail links when downloads are unsupported', () => {
        runtime.supportsDownloads = false;

        const component = createComponent();

        expect(component.secondaryLinks().map((link) => link.section)).toEqual([
            'recently-added',
            'search',
        ]);
    });

    it('uses the Stalker rail shape for Stalker playlists', () => {
        runtime.supportsDownloads = true;
        playlist.set({
            _id: 'stalker-1',
            macAddress: '00:1A:79:00:00:01',
        });

        const component = createComponent();

        expect(component.primaryLinks().map((link) => link.section)).toEqual([
            'vod',
            'itv',
            'radio',
            'series',
        ]);
        expect(component.secondaryLinks().map((link) => link.section)).toEqual([
            'search',
            'downloads',
        ]);
    });

    it('hides Stalker downloads when downloads are unsupported', () => {
        runtime.supportsDownloads = false;
        playlist.set({
            _id: 'stalker-1',
            macAddress: '00:1A:79:00:00:01',
        });

        const component = createComponent();

        expect(component.secondaryLinks().map((link) => link.section)).toEqual([
            'search',
        ]);
    });
});
