import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    XtreamApiService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { AccountInfoComponent } from './account-info.component';

describe('AccountInfoComponent', () => {
    let fixture: ComponentFixture<AccountInfoComponent>;
    let component: AccountInfoComponent;
    let xtreamApiService: {
        getAccountInfo: jest.Mock;
    };
    let currentPlaylist: WritableSignal<null>;

    beforeEach(async () => {
        xtreamApiService = {
            getAccountInfo: jest.fn().mockResolvedValue({
                user_info: {
                    active_cons: '0',
                    allowed_output_formats: [],
                    max_connections: '0',
                    status: 'Active',
                    username: 'dialog-user',
                },
                server_info: {
                    server_protocol: 'http',
                    url: 'dialog.example.test',
                },
            }),
        };
        currentPlaylist = signal(null);

        await TestBed.configureTestingModule({
            imports: [
                AccountInfoComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        playlist: {
                            id: 'dialog-playlist',
                            title: 'Dialog Xtream',
                            serverUrl: 'https://dialog.example.test',
                            username: 'dialog-user',
                            password: 'dialog-secret',
                        },
                        vodStreams: [
                            {
                                stream_id: 1,
                                name: 'The Matrix 2160p ITA SUB ENG',
                                imdb_id: 'tt0133093',
                                direct_source:
                                    'https://cdn.example.test/matrix',
                                mediaMetadata: {
                                    available: true,
                                    height: 2160,
                                    audioLanguages: ['it'],
                                    audioCodecs: [],
                                    subtitleLanguages: ['en'],
                                    subtitleCodecs: [],
                                },
                            },
                            {
                                stream_id: 2,
                                name: 'Matrix 1080p ENG',
                                imdb_id: 'tt0133093',
                                direct_source: '',
                                mediaMetadata: {
                                    available: true,
                                    height: 1080,
                                    audioLanguages: ['en'],
                                    audioCodecs: [],
                                    subtitleLanguages: [],
                                    subtitleCodecs: [],
                                },
                            },
                            {
                                stream_id: 3,
                                name: 'Amelie 720p FRA SUB ITA',
                                imdb_id: 'tt0211915',
                                direct_source: '',
                                mediaMetadata: {
                                    available: true,
                                    height: 720,
                                    audioLanguages: ['fr'],
                                    audioCodecs: [],
                                    subtitleLanguages: ['it'],
                                    subtitleCodecs: [],
                                },
                            },
                            {
                                stream_id: 4,
                                name: 'Unknown Documentary',
                                imdb_id: 'tt9999999',
                                direct_source: '',
                            },
                        ],
                    },
                },
                {
                    provide: XtreamApiService,
                    useValue: xtreamApiService,
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist,
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AccountInfoComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
    });

    it('loads account info from dialog-supplied playlist credentials', () => {
        expect(xtreamApiService.getAccountInfo).toHaveBeenCalledWith({
            serverUrl: 'https://dialog.example.test',
            username: 'dialog-user',
            password: 'dialog-secret',
        });
        expect(component.loadState()).toBe('ready');
        expect(component.playlistLabel()).toBe('Dialog Xtream');
    });

    it('shows unknown content counts when dashboard does not supply them', () => {
        expect(component.heroStats().map((stat) => stat.value)).toEqual([
            '0/0',
            '-',
            '-',
            '-',
        ]);
    });

    it('counts unique movies and exposes source overview filters', () => {
        const overview = component.vodOverview();

        expect(overview.totalUnique).toBe(3);
        expect(overview.filteredUnique).toBe(3);
        expect(overview.totalItems).toBe(4);
        expect(overview.filteredItems).toBe(4);
        expect(overview.audioUnknownUnique).toBe(1);
        expect(overview.subtitleUnknownUnique).toBe(1);
        expect(overview.qualityUnknownUnique).toBe(1);
        expect(overview.metadataAbsentUnique).toBe(1);
        expect(overview.metadataUnavailableUnique).toBe(0);
        expect(overview.diagnosticIssueUnique).toBe(1);
        expect(overview.diagnosticCards).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    labelKey: 'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_AUDIO_MISSING',
                    value: 1,
                    total: 3,
                }),
                expect.objectContaining({
                    labelKey:
                        'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_QUALITY_MISSING',
                    value: 1,
                    total: 3,
                }),
            ])
        );
        expect(
            overview.sourceOptions.find((option) => option.value === 'direct')
                ?.count
        ).toBe(1);
        expect(
            overview.sourceOptions.find((option) => option.value === 'indirect')
                ?.count
        ).toBe(3);
        expect(
            overview.qualityOptions.find((option) => option.value === '2160p')
                ?.count
        ).toBe(1);
        expect(
            overview.qualityOptions.find((option) => option.value === '1080p')
                ?.count
        ).toBe(1);
        expect(
            overview.qualityOptions.find((option) => option.value === '720p')
                ?.count
        ).toBe(1);
        expect(
            overview.qualityOptions.find((option) => option.value === 'unknown')
                ?.count
        ).toBe(1);
        expect(
            overview.audioOptions.find((option) => option.code === 'it')?.count
        ).toBe(1);
        expect(
            overview.subtitleOptions.find((option) => option.code === 'it')
                ?.count
        ).toBe(1);

        component.setSourceMode('direct');
        expect(component.vodOverview().filteredUnique).toBe(1);

        component.resetVodOverviewFilters();
        component.setQualityFilter('720p');
        expect(component.vodOverview().filteredUnique).toBe(1);
        expect(component.vodOverview().filteredItems).toBe(1);

        component.resetVodOverviewFilters();
        component.setSubtitleLanguage('it');
        expect(component.vodOverview().filteredUnique).toBe(1);
    });
});
