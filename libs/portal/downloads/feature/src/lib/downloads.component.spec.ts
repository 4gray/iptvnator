import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    DatabaseService,
    DownloadItem,
    DownloadsService,
    PlaylistsService,
    SettingsStore,
} from 'services';
import { DialogService } from 'components';
import {
    PORTAL_SHELL_ACTIONS,
    PortalCollectionContextService,
} from '@iptvnator/portal/shared/util';
import { DownloadsComponent } from './downloads.component';

describe('DownloadsComponent', () => {
    let fixture: ComponentFixture<DownloadsComponent>;
    let downloadsService: MockDownloadsService;
    let settingsStore: MockSettingsStore;
    const originalElectron = window.electron;

    beforeEach(async () => {
        downloadsService = new MockDownloadsService();
        settingsStore = new MockSettingsStore();

        await TestBed.configureTestingModule({
            imports: [
                DownloadsComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                PortalCollectionContextService,
                {
                    provide: ActivatedRoute,
                    useValue: {
                        paramMap: of(convertToParamMap({})),
                        queryParamMap: of(convertToParamMap({})),
                        snapshot: {
                            params: {},
                            queryParamMap: convertToParamMap({}),
                        },
                    },
                },
                { provide: DatabaseService, useValue: {} },
                {
                    provide: DialogService,
                    useValue: { openConfirmDialog: jest.fn() },
                },
                { provide: DownloadsService, useValue: downloadsService },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getAllPlaylists: () =>
                            of([{ _id: 'playlist-1', title: 'Mock' }]),
                        getPlaylistById: () =>
                            of({ _id: 'playlist-1', title: 'Mock' }),
                    },
                },
                { provide: Router, useValue: { navigate: jest.fn() } },
                { provide: SettingsStore, useValue: settingsStore },
                {
                    provide: PORTAL_SHELL_ACTIONS,
                    useValue: { openAddPlaylistDialog: jest.fn() },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(DownloadsComponent);
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('renders the global benchmark action when downloads are available', () => {
        window.electron = createElectronBenchmarkMock();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="benchmark-visible-downloads"]'
            )
        ).not.toBeNull();
    });

    it('benchmarks a single download and stores the result', async () => {
        const electron = createElectronBenchmarkMock();
        window.electron = electron;
        fixture.detectChanges();

        await fixture.componentInstance.benchmarkDownload(mockDownload);

        expect(electron.benchmarkHttpDownload).toHaveBeenCalledWith(
            mockDownload.url,
            undefined,
            8 * 1024 * 1024,
            30000
        );
        expect(
            fixture.componentInstance.getBenchmarkState(mockDownload)?.result
                ?.status
        ).toBe(206);
    });

    it('benchmarks all visible downloads and exposes an aggregate report', async () => {
        const electron = createElectronBenchmarkMock();
        window.electron = electron;
        fixture.detectChanges();

        await fixture.componentInstance.benchmarkVisibleDownloads();
        fixture.detectChanges();

        expect(electron.benchmarkHttpDownload).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance.benchmarkReport()).toMatchObject({
            completedCount: 1,
            failedCount: 0,
            totalCount: 1,
            totalBytesRead: 1024,
        });
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="download-benchmark-summary"]'
            )
        ).not.toBeNull();
    });
});

const mockDownload: DownloadItem = {
    id: 1,
    playlistId: 'playlist-1',
    xtreamId: 101,
    contentType: 'vod',
    title: 'Mock Movie',
    url: 'https://example.test/movie.mp4',
    status: 'queued',
    createdAt: '2026-05-14T00:00:00.000Z',
};

class MockDownloadsService {
    readonly downloads = signal<DownloadItem[]>([mockDownload]);
    readonly downloadFolder = signal('C:\\Downloads');
    readonly isAvailable = signal(true);
    readonly isLoadingDownloads = signal(false);
    readonly hasLoadedDownloads = signal(true);
    readonly activeCount = signal(0);

    loadDownloads = jest.fn().mockResolvedValue(undefined);
    getProgressPercent = jest.fn().mockReturnValue(0);
    getThroughputBytesPerSecond = jest.fn().mockReturnValue(0);
    cancelDownload = jest.fn().mockResolvedValue(undefined);
    retryDownload = jest.fn().mockResolvedValue(undefined);
    removeDownload = jest.fn().mockResolvedValue(undefined);
    playDownload = jest.fn().mockResolvedValue({ success: true });
    revealFile = jest.fn().mockResolvedValue({ success: true });
    selectFolder = jest.fn().mockResolvedValue(undefined);
    clearCompleted = jest.fn().mockResolvedValue(undefined);

    formatBytes(bytes: number | undefined): string {
        return `${bytes ?? 0} B`;
    }
}

class MockSettingsStore {
    readonly acceleratedDownloads = signal(true);
    updateSettings = jest.fn().mockResolvedValue(undefined);
}

function createElectronBenchmarkMock(): typeof window.electron {
    return {
        benchmarkHttpDownload: jest.fn().mockResolvedValue({
            ok: true,
            status: 206,
            rangeSupported: true,
            ttfbMs: 42,
            durationMs: 1000,
            bytesRead: 1024,
            totalBytes: 2048,
            throughputBytesPerSecond: 1024,
            samples: [{ second: 1, bytes: 1024, bytesPerSecond: 1024 }],
        }),
        updateSettings: jest.fn(),
        downloadsGetList: jest.fn(),
    } as unknown as typeof window.electron;
}
