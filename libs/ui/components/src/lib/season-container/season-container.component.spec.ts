import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MediaStreamMetadata, XtreamSerieEpisode } from 'shared-interfaces';
import {
    DownloadsService,
    MediaMetadataService,
    SettingsStore,
} from 'services';
import { SeasonContainerComponent } from './season-container.component';

const downloadsStart = jest.fn().mockResolvedValue(undefined);
const redirectIndirectStreamsToDirectSource = signal(false);
const downloadsServiceStub = {
    isAvailable: signal(false),
    downloads: () => [],
    startDownload: downloadsStart,
    isDownloaded: () => false,
    isDownloading: () => false,
    getDownloadedFilePath: () => '',
    playDownload: async () => undefined,
};

const mediaMetadataProbe = jest.fn();
const mediaMetadataServiceStub = {
    probe: mediaMetadataProbe,
};

async function flushPromises(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function createEpisode(
    overrides: Partial<XtreamSerieEpisode> = {}
): XtreamSerieEpisode {
    return {
        id: '101',
        episode_num: 1,
        title: 'Pilot',
        container_extension: 'mp4',
        info: {
            duration: '45 min',
            plot: 'Pilot episode',
            movie_image: 'https://example.com/poster.jpg',
        },
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
        ...overrides,
    };
}

describe('SeasonContainerComponent', () => {
    let fixture: ComponentFixture<SeasonContainerComponent>;
    let component: SeasonContainerComponent;

    const setRequiredInputs = (
        seasons: Record<string, XtreamSerieEpisode[]>,
        isLoading = false
    ) => {
        fixture.componentRef.setInput('seasons', seasons);
        fixture.componentRef.setInput('seriesId', 1);
        fixture.componentRef.setInput('playlistId', 'playlist-1');
        fixture.componentRef.setInput('isLoading', isLoading);
    };

    beforeEach(async () => {
        downloadsStart.mockClear();
        redirectIndirectStreamsToDirectSource.set(false);
        mediaMetadataProbe.mockReset();
        mediaMetadataProbe.mockResolvedValue({
            available: false,
            audioLanguages: [],
            audioCodecs: [],
            subtitleLanguages: [],
            subtitleCodecs: [],
            reason: 'not configured',
        });

        await TestBed.configureTestingModule({
            imports: [
                NoopAnimationsModule,
                SeasonContainerComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: DownloadsService,
                    useValue: downloadsServiceStub,
                },
                {
                    provide: MediaMetadataService,
                    useValue: mediaMetadataServiceStub,
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        redirectIndirectStreamsToDirectSource,
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SeasonContainerComponent);
        component = fixture.componentInstance;
    });

    it('renders the series-level placeholder when no seasons are available', () => {
        setRequiredInputs({});
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain(
            'No episodes available'
        );
        expect(fixture.nativeElement.textContent).toContain(
            'This series is listed by your provider, but no seasons or episodes are available to play.'
        );
        expect(fixture.nativeElement.querySelector('.season-card')).toBeNull();
    });

    it('renders the loading state instead of the placeholder while seasons are loading', () => {
        setRequiredInputs({}, true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '.loading-container mat-spinner'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).toBeNull();
    });

    it('renders the season-level placeholder when the selected season has no episodes', () => {
        setRequiredInputs({ '1': [] });
        fixture.detectChanges();

        fixture.nativeElement.querySelector('.season-card').click();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'This season is empty'
        );
        expect(fixture.nativeElement.textContent).toContain(
            'This season is listed by your provider, but no playable episodes are available.'
        );
        expect(fixture.nativeElement.querySelector('.view-toggle')).toBeNull();
    });

    it('renders season cards and episode cards when episodes exist', () => {
        const episode = createEpisode();

        setRequiredInputs({
            '1': [episode],
            '2': [],
        });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelectorAll('.season-card').length
        ).toBe(2);
        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).toBeNull();

        fixture.nativeElement.querySelector('.season-card').click();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelectorAll('.episode-card').length
        ).toBe(1);
        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).toBeNull();
    });

    it('clears a stale selected season when the input seasons change', () => {
        const episode = createEpisode();

        setRequiredInputs({ '1': [episode] });
        fixture.detectChanges();

        fixture.nativeElement.querySelector('.season-card').click();
        fixture.detectChanges();

        fixture.componentRef.setInput('seasons', { '2': [episode] });
        fixture.detectChanges();

        expect(component.selectedSeason).toBeUndefined();
        expect(
            fixture.nativeElement.querySelector('.season-card__number')
                ?.textContent
        ).toContain('2');
    });

    it('probes media quality for each episode and emits a shared series quality only when all match', async () => {
        const emissions: Array<MediaStreamMetadata | null> = [];
        component.seriesMediaMetadataChanged.subscribe((metadata) =>
            emissions.push(metadata)
        );
        mediaMetadataProbe.mockResolvedValue({
            available: true,
            qualityLabel: '2160p HEVC',
            width: 3840,
            height: 2160,
            videoCodec: 'HEVC',
            audioLanguages: ['ITA'],
            audioCodecs: [],
            subtitleLanguages: ['ITA'],
            subtitleCodecs: [],
            source: 'ffprobe',
        });

        setRequiredInputs({
            '1': [
                createEpisode({ id: '1001' }),
                createEpisode({ id: '1002', episode_num: 2 }),
            ],
        });
        fixture.componentRef.setInput('xtreamDownloadContext', {
            serverUrl: 'http://xtream.example',
            username: 'user',
            password: 'pass',
            userAgent: 'test-agent',
            origin: 'http://origin.example',
            referrer: 'http://referrer.example',
        });

        fixture.detectChanges();
        await fixture.whenStable();
        await flushPromises();
        fixture.detectChanges();

        expect(mediaMetadataProbe).toHaveBeenCalledTimes(2);
        expect(mediaMetadataProbe).toHaveBeenCalledWith({
            url: 'http://xtream.example/series/user/pass/1001.mp4',
            headers: {
                'User-Agent': 'test-agent',
                Origin: 'http://origin.example',
                Referer: 'http://referrer.example',
            },
        });
        expect(mediaMetadataProbe).toHaveBeenCalledWith({
            url: 'http://xtream.example/series/user/pass/1002.mp4',
            headers: {
                'User-Agent': 'test-agent',
                Origin: 'http://origin.example',
                Referer: 'http://referrer.example',
            },
        });
        expect(emissions[emissions.length - 1]).toEqual(
            expect.objectContaining({
                available: true,
                qualityLabel: '2160p HEVC',
                audioLanguages: ['ITA'],
                source: 'derived',
            })
        );
    });

    it('does not emit a shared series quality when episode qualities differ', async () => {
        const emissions: Array<MediaStreamMetadata | null> = [];
        component.seriesMediaMetadataChanged.subscribe((metadata) =>
            emissions.push(metadata)
        );
        mediaMetadataProbe.mockImplementation(({ url }: { url: string }) =>
            Promise.resolve({
                available: true,
                qualityLabel: url.includes('1002')
                    ? '1080p H.264'
                    : '2160p HEVC',
                audioLanguages: ['ITA'],
                audioCodecs: [],
                subtitleLanguages: [],
                subtitleCodecs: [],
                source: 'ffprobe',
            })
        );

        setRequiredInputs({
            '1': [
                createEpisode({ id: '1001' }),
                createEpisode({ id: '1002', episode_num: 2 }),
            ],
        });
        fixture.componentRef.setInput('xtreamDownloadContext', {
            serverUrl: 'http://xtream.example',
            username: 'user',
            password: 'pass',
        });

        fixture.detectChanges();
        await fixture.whenStable();
        await flushPromises();
        fixture.detectChanges();

        expect(mediaMetadataProbe).toHaveBeenCalledTimes(2);
        expect(emissions[emissions.length - 1]).toBeNull();
    });

    it('uses direct_source for episode probes and downloads when the setting is enabled', async () => {
        redirectIndirectStreamsToDirectSource.set(true);
        const episode = createEpisode({
            id: '1001',
            direct_source: 'https://cdn.example/direct-episode.mp4',
        });

        setRequiredInputs({ '1': [episode] });
        fixture.componentRef.setInput('xtreamDownloadContext', {
            serverUrl: 'http://xtream.example',
            username: 'user',
            password: 'pass',
            userAgent: 'test-agent',
            origin: 'http://origin.example',
            referrer: 'http://referrer.example',
        });

        fixture.detectChanges();
        await fixture.whenStable();
        await flushPromises();

        expect(mediaMetadataProbe).toHaveBeenCalledWith({
            url: 'https://cdn.example/direct-episode.mp4',
            headers: {
                'User-Agent': 'test-agent',
                Origin: 'http://origin.example',
                Referer: 'http://referrer.example',
            },
        });

        await component.downloadEpisode(
            { stopPropagation: jest.fn() } as unknown as Event,
            episode
        );

        expect(downloadsStart).toHaveBeenCalledWith(
            expect.objectContaining({
                playlistId: 'playlist-1',
                xtreamId: 1001,
                contentType: 'episode',
                url: 'https://cdn.example/direct-episode.mp4',
                headers: {
                    userAgent: 'test-agent',
                    origin: 'http://origin.example',
                    referer: 'http://referrer.example',
                },
            })
        );
    });
});
