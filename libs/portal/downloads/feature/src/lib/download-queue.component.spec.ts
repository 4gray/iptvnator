import { OverlayContainer } from '@angular/cdk/overlay';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatProgressBarHarness } from '@angular/material/progress-bar/testing';
import { MatTooltipHarness } from '@angular/material/tooltip/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { DownloadItem } from '@iptvnator/services';
import type { DownloadItemAction } from './download-actions';
import type { DownloadListItemViewModel } from './download-manager.viewmodel';
import {
    DownloadQueueComponent,
    formatDownloadBytes,
} from './download-queue.component';

const TEST_TRANSLATIONS = {
    DOWNLOADS: {
        DOWNLOADING_NOW: 'Downloading now',
        NEEDS_ATTENTION: 'Needs attention',
        STATUS: {
            QUEUED: 'Queued',
            DOWNLOADING: 'Downloading',
            PAUSED: 'Paused',
            FAILED: 'Failed',
            CANCELED: 'Canceled',
            FILE_MISSING: 'File missing',
        },
        DOWNLOAD_AGAIN: 'Download again',
        ARIA: {
            OPEN: 'Open {{title}}',
            POSTER_UNAVAILABLE: 'Artwork unavailable for {{title}}',
            PROGRESS: 'Download progress for {{title}}',
            PAUSE: 'Pause {{title}}',
            CANCEL: 'Cancel {{title}}',
            RESUME: 'Resume {{title}}',
            REMOVE: 'Remove {{title}} from manager',
            RETRY: 'Retry {{title}}',
            MORE_ACTIONS: 'More actions for {{title}}',
            COPY_URL: 'Copy URL for {{title}}',
            DOWNLOAD_AGAIN: 'Download {{title}} again',
        },
    },
    PORTALS: {
        MULTI_SOURCE: {
            SOURCE: 'Source',
        },
    },
};

function createItem(
    id: number,
    status: DownloadItem['status'],
    overrides: Partial<DownloadItem> = {}
): DownloadItem {
    return {
        id,
        playlistId: 'playlist-a',
        xtreamId: id * 10,
        contentType: 'vod',
        title: `Download ${id}`,
        url: `https://example.test/${id}`,
        status,
        createdAt: '2026-07-30T10:00:00Z',
        ...overrides,
    };
}

function createRow(
    id: number,
    status: DownloadItem['status'],
    overrides: Partial<DownloadListItemViewModel> = {}
): DownloadListItemViewModel {
    return {
        attentionReason: 'transfer',
        item: createItem(id, status),
        episodeLabel: '',
        seriesTitle: '',
        sourceName: '',
        ...overrides,
    };
}

describe('DownloadQueueComponent', () => {
    let fixture: ComponentFixture<DownloadQueueComponent>;
    let overlayContainer: OverlayContainer;

    function render(
        activeItems: readonly DownloadListItemViewModel[] = [],
        attentionItems: readonly DownloadListItemViewModel[] = [],
        pendingIds: ReadonlySet<number> = new Set()
    ): void {
        fixture.componentRef.setInput('activeItems', activeItems);
        fixture.componentRef.setInput('attentionItems', attentionItems);
        fixture.componentRef.setInput('pendingIds', pendingIds);
        fixture.detectChanges();
    }

    function row(id: number): HTMLElement {
        const element = fixture.nativeElement.querySelector(
            `[data-test-id="download-queue-item-${id}"]`
        );
        expect(element).not.toBeNull();
        return element;
    }

    function actionButton(host: ParentNode, action: string): HTMLButtonElement {
        const button = host.querySelector<HTMLButtonElement>(
            `[data-test-action="${action}"]`
        );
        expect(button).not.toBeNull();
        return button as HTMLButtonElement;
    }

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                DownloadQueueComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', TEST_TRANSLATIONS);
        translate.use('en');
        overlayContainer = TestBed.inject(OverlayContainer);
        fixture = TestBed.createComponent(DownloadQueueComponent);
    });

    afterEach(() => {
        overlayContainer.getContainerElement().replaceChildren();
    });

    it('omits empty sections and renders named sections with stable row IDs', () => {
        const queued = createRow(1, 'queued');
        const failed = createRow(2, 'failed');

        render([queued], []);

        const activeSection: HTMLElement = fixture.nativeElement.querySelector(
            '[data-test-id="downloads-active-section"]'
        );
        expect(activeSection).not.toBeNull();
        expect(activeSection.querySelector('h2')?.textContent?.trim()).toBe(
            'Downloading now'
        );
        expect(activeSection.getAttribute('aria-labelledby')).toBeTruthy();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="downloads-attention-section"]'
            )
        ).toBeNull();
        expect(row(1)).not.toBeNull();

        render([], [failed]);

        const attentionSection: HTMLElement =
            fixture.nativeElement.querySelector(
                '[data-test-id="downloads-attention-section"]'
            );
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="downloads-active-section"]'
            )
        ).toBeNull();
        expect(attentionSection.querySelector('h2')?.textContent?.trim()).toBe(
            'Needs attention'
        );
        expect(row(2)).not.toBeNull();

        render();

        expect(fixture.nativeElement.querySelector('section')).toBeNull();
    });

    it.each([
        ['queued', 'Queued', 'schedule'],
        ['downloading', 'Downloading', 'downloading'],
        ['paused', 'Paused', 'pause_circle'],
        ['failed', 'Failed', 'error'],
        ['canceled', 'Canceled', 'cancel'],
    ] as const)(
        'renders translated %s status text with its semantic icon',
        (status, text, icon) => {
            const item = createRow(1, status);
            render(
                status === 'failed' || status === 'canceled' ? [] : [item],
                status === 'failed' || status === 'canceled' ? [item] : []
            );

            const statusPill = row(1).querySelector<HTMLElement>(
                '.download-queue__status'
            );
            expect(statusPill?.textContent).toContain(text);
            expect(statusPill?.getAttribute('role')).toBe('status');
            expect(statusPill?.getAttribute('aria-live')).toBe('polite');
            expect(statusPill?.getAttribute('aria-atomic')).toBe('true');
            expect(
                statusPill?.querySelector('mat-icon')?.textContent?.trim()
            ).toBe(icon);
        }
    );

    it('renders a missing completed file as recoverable attention', async () => {
        const viewModel = createRow(8, 'completed', {
            attentionReason: 'file-missing',
            item: createItem(8, 'completed', {
                bytesDownloaded: 2 * 1024 ** 2,
                fileAvailability: 'missing',
                filePath: '/downloads/missing.mp4',
            }),
            sourceName: 'Alpha Source',
        });
        const emitted: DownloadItemAction[] = [];
        fixture.componentInstance.itemAction.subscribe((action) =>
            emitted.push(action)
        );
        render([], [viewModel]);

        const host = row(8);
        const status = host.querySelector<HTMLElement>(
            '.download-queue__status'
        );
        const renderedActions = Array.from(
            host.querySelectorAll<HTMLButtonElement>(
                '[data-test-action]:not([data-test-action="more"])'
            )
        ).map((button) => button.dataset['testAction']);
        expect(status?.textContent).toContain('File missing');
        expect(status?.querySelector('mat-icon')?.textContent?.trim()).toBe(
            'file_off'
        );
        expect(renderedActions).toEqual(['redownload']);
        expect(host.querySelector('[data-test-action="play"]')).toBeNull();
        expect(host.querySelector('[data-test-action="reveal"]')).toBeNull();
        expect(host.querySelector('.download-queue__source')).toBeNull();

        actionButton(host, 'redownload').click();
        expect(emitted).toEqual([
            { type: 'redownload', item: viewModel.item },
        ]);

        actionButton(host, 'more').click();
        fixture.detectChanges();
        await fixture.whenStable();

        const menu = overlayContainer.getContainerElement();
        const header = menu.querySelector<HTMLElement>(
            '.download-source-menu-header'
        );
        const copy = actionButton(menu, 'copy-url');
        const remove = actionButton(menu, 'remove');
        expect(header?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
            'Source Alpha Source'
        );
        expect(header?.querySelector('strong')?.textContent).toContain(
            'Alpha Source'
        );
        expect(
            header &&
                header.compareDocumentPosition(copy) &
                    Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(
            copy.compareDocumentPosition(remove) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it('disables Download again while pending and omits an empty source header', async () => {
        const viewModel = createRow(9, 'completed', {
            attentionReason: 'file-missing',
            item: createItem(9, 'completed', {
                fileAvailability: 'missing',
                filePath: '/downloads/missing.mp4',
            }),
            sourceName: '   ',
        });
        render([], [viewModel], new Set([9]));

        expect(actionButton(row(9), 'redownload').disabled).toBe(true);
        fixture.componentRef.setInput('pendingIds', new Set());
        fixture.detectChanges();
        actionButton(row(9), 'more').click();
        fixture.detectChanges();
        await fixture.whenStable();

        expect(
            overlayContainer
                .getContainerElement()
                .querySelector('.download-source-menu-header')
        ).toBeNull();
    });

    it.each([
        ['queued', ['pause', 'cancel']],
        ['downloading', ['pause', 'cancel']],
        ['paused', ['resume', 'cancel', 'remove']],
        ['failed', ['retry', 'remove']],
        ['canceled', ['retry', 'remove']],
    ] as const)(
        'exposes the exact primary action contract for %s',
        (status, expectedActions) => {
            const viewModel = createRow(7, status);
            const emitted: DownloadItemAction[] = [];
            const opened = jest.fn();
            fixture.componentInstance.itemAction.subscribe((action) =>
                emitted.push(action)
            );
            fixture.componentInstance.openRequested.subscribe(opened);
            render(
                status === 'failed' || status === 'canceled' ? [] : [viewModel],
                status === 'failed' || status === 'canceled' ? [viewModel] : []
            );

            const host = row(7);
            const renderedActions = Array.from(
                host.querySelectorAll<HTMLButtonElement>(
                    '[data-test-action]:not([data-test-action="more"])'
                )
            ).map((button) => button.dataset['testAction']);
            expect(renderedActions).toEqual(expectedActions);

            for (const action of expectedActions) {
                actionButton(host, action).click();
            }

            expect(emitted.map(({ type }) => type)).toEqual(expectedActions);
            for (const event of emitted) {
                expect(event.item).toBe(viewModel.item);
            }
            expect(opened).not.toHaveBeenCalled();
        }
    );

    it('emits copy-url with the original item only through the Material overflow menu', async () => {
        const viewModel = createRow(11, 'queued');
        const emitted = jest.fn<void, [DownloadItemAction]>();
        const opened = jest.fn();
        fixture.componentInstance.itemAction.subscribe(emitted);
        fixture.componentInstance.openRequested.subscribe(opened);
        render([viewModel]);

        expect(
            row(11).querySelector('[data-test-action="copy-url"]')
        ).toBeNull();
        actionButton(row(11), 'more').click();
        fixture.detectChanges();
        await fixture.whenStable();

        const copyButton = actionButton(
            overlayContainer.getContainerElement(),
            'copy-url'
        );
        expect(copyButton.closest('.mat-mdc-menu-panel')).not.toBeNull();
        expect(copyButton.textContent).toContain('Copy URL for Download 11');
        copyButton.click();

        expect(emitted).toHaveBeenCalledTimes(1);
        expect(emitted.mock.calls[0][0]).toEqual({
            type: 'copy-url',
            item: viewModel.item,
        });
        expect(emitted.mock.calls[0][0].item).toBe(viewModel.item);
        expect(opened).not.toHaveBeenCalled();
    });

    it('opens the original item from real artwork and title buttons only', () => {
        const viewModel = createRow(5, 'downloading');
        const opened: DownloadItem[] = [];
        fixture.componentInstance.openRequested.subscribe((item) =>
            opened.push(item)
        );
        render([viewModel]);

        const artwork = row(5).querySelector<HTMLButtonElement>(
            '[data-test-control="artwork"]'
        );
        const title = row(5).querySelector<HTMLButtonElement>(
            '[data-test-control="title"]'
        );
        expect(artwork?.tagName).toBe('BUTTON');
        expect(artwork?.type).toBe('button');
        expect(title?.tagName).toBe('BUTTON');
        expect(title?.type).toBe('button');

        artwork?.click();
        title?.click();

        expect(opened).toEqual([viewModel.item, viewModel.item]);
        expect(opened[0]).toBe(viewModel.item);
        expect(opened[1]).toBe(viewModel.item);
    });

    it('disables navigation, primary actions, overflow, and an open menu command while pending', async () => {
        const viewModel = createRow(17, 'paused');
        const emitted = jest.fn();
        const opened = jest.fn();
        fixture.componentInstance.itemAction.subscribe(emitted);
        fixture.componentInstance.openRequested.subscribe(opened);
        render([viewModel]);
        expect(row(17).getAttribute('aria-busy')).toBeNull();

        actionButton(row(17), 'more').click();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(
            actionButton(overlayContainer.getContainerElement(), 'copy-url')
                .disabled
        ).toBe(false);

        fixture.componentRef.setInput('pendingIds', new Set([17]));
        fixture.detectChanges();

        const itemButtons = Array.from(
            row(17).querySelectorAll<HTMLButtonElement>('button')
        );
        expect(row(17).getAttribute('aria-busy')).toBe('true');
        expect(
            row(17).querySelector('.download-queue__metadata')
        ).not.toBeNull();
        expect(itemButtons).toHaveLength(6);
        expect(itemButtons.every(({ disabled }) => disabled)).toBe(true);
        expect(
            actionButton(overlayContainer.getContainerElement(), 'copy-url')
                .disabled
        ).toBe(true);

        fixture.componentInstance.emitAction('remove', viewModel.item);
        fixture.componentInstance.requestOpen(viewModel.item);
        expect(emitted).not.toHaveBeenCalled();
        expect(opened).not.toHaveBeenCalled();
    });

    it('renders determinate and indeterminate progress, omits meaningless paused progress, and clamps values', async () => {
        const known = createRow(1, 'downloading', {
            item: createItem(1, 'downloading', {
                bytesDownloaded: 250,
                totalBytes: 200,
            }),
        });
        const unknown = createRow(2, 'queued', {
            item: createItem(2, 'queued', {
                bytesDownloaded: 10,
                totalBytes: undefined,
            }),
        });
        const pausedUnknown = createRow(3, 'paused', {
            item: createItem(3, 'paused', {
                bytesDownloaded: 20,
                totalBytes: 0,
            }),
        });
        const pausedKnown = createRow(4, 'paused', {
            item: createItem(4, 'paused', {
                bytesDownloaded: -50,
                totalBytes: 100,
            }),
        });
        render([known, unknown, pausedUnknown, pausedKnown]);

        const loader = TestbedHarnessEnvironment.loader(fixture);
        const bars = await loader.getAllHarnesses(MatProgressBarHarness);
        expect(bars).toHaveLength(3);
        expect(await Promise.all(bars.map((bar) => bar.getMode()))).toEqual([
            'determinate',
            'indeterminate',
            'determinate',
        ]);
        expect(await bars[0].getValue()).toBe(100);
        expect(await bars[2].getValue()).toBe(0);
        expect(
            fixture.componentInstance.progressValue(
                createItem(5, 'queued', {
                    bytesDownloaded: Number.POSITIVE_INFINITY,
                    totalBytes: 100,
                })
            )
        ).toBe(0);
        expect(row(3).querySelector('.download-queue__progress')).toBeNull();
        expect(
            Array.from(
                fixture.nativeElement.querySelectorAll<HTMLElement>(
                    '.download-queue__progress'
                )
            ).map((bar) => bar.getAttribute('aria-label'))
        ).toEqual([
            'Download progress for Download 1',
            'Download progress for Download 2',
            'Download progress for Download 4',
        ]);
        expect(
            fixture.nativeElement.querySelector(
                '.download-queue__progress[aria-live]'
            )
        ).toBeNull();
    });

    it.each([
        [undefined, '0 B'],
        [0, '0 B'],
        [-1, '0 B'],
        [Number.NaN, '0 B'],
        [Number.POSITIVE_INFINITY, '0 B'],
        [0.5, '0.5 B'],
        [1023, '1023 B'],
        [1024, '1 KB'],
        [1.5 * 1024 ** 2, '1.5 MB'],
        [2 * 1024 ** 3, '2 GB'],
        [3.25 * 1024 ** 4, '3.3 TB'],
        [1024 ** 5, '1024 TB'],
    ])('formats byte metadata %p as %s', (bytes, expected) => {
        expect(formatDownloadBytes(bytes)).toBe(expected);
    });

    it('renders downloaded/total bytes and episode/error metadata without a permanent source', () => {
        const longError =
            'https://downloads.example.test/a/very/long/unbroken/path/that/must/remain/readable/error-code-connection-reset';
        const detailed = createRow(21, 'failed', {
            item: createItem(21, 'failed', {
                contentType: 'episode',
                bytesDownloaded: 1.5 * 1024 ** 2,
                totalBytes: 2 * 1024 ** 2,
                errorMessage: longError,
            }),
            episodeLabel: 'S02E04',
            seriesTitle: 'Example series',
            sourceName: 'Alpha Source',
        });
        const noSource = createRow(22, 'canceled', {
            item: createItem(22, 'canceled', {
                bytesDownloaded: undefined,
                totalBytes: undefined,
            }),
            sourceName: '   ',
        });
        render([], [detailed, noSource]);

        expect(
            row(21)
                .querySelector('.download-queue__bytes')
                ?.textContent?.replace(/\s+/g, ' ')
                .trim()
        ).toBe('1.5 MB / 2 MB');
        expect(
            row(21)
                .querySelector('.download-queue__episode')
                ?.textContent?.trim()
        ).toBe('S02E04');
        expect(row(21).querySelector('.download-queue__source')).toBeNull();
        const error = row(21).querySelector<HTMLElement>(
            '.download-queue__error'
        );
        expect(error?.textContent?.trim()).toBe(longError);
        expect(row(22).querySelector('.download-queue__source')).toBeNull();
        expect(
            row(22).querySelector('.download-queue__bytes')?.textContent
        ).toContain('0 B');
    });

    it('uses a lazy decorative image and swaps missing or broken posters for a semantic placeholder', () => {
        const withPoster = createRow(31, 'queued', {
            item: createItem(31, 'queued', {
                title: 'Poster title',
                posterUrl: 'https://example.test/poster.jpg',
            }),
        });
        const missingPoster = createRow(32, 'queued', {
            item: createItem(32, 'queued', {
                title: 'Missing title',
                posterUrl: ' ',
            }),
        });
        render([withPoster, missingPoster]);

        const image = row(31).querySelector<HTMLImageElement>('img');
        expect(image?.getAttribute('loading')).toBe('lazy');
        expect(image?.alt).toBe('');
        expect(
            row(32).querySelector('[role="img"]')?.getAttribute('aria-label')
        ).toBe('Artwork unavailable for Missing title');

        image?.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        expect(row(31).querySelector('img')).toBeNull();
        expect(
            row(31).querySelector('[role="img"]')?.getAttribute('aria-label')
        ).toBe('Artwork unavailable for Poster title');
        fixture.componentInstance.markPosterFailed(withPoster.item);
        expect(fixture.componentInstance.hasPoster(withPoster.item)).toBe(
            false
        );
    });

    it('gives every command an item-specific translated accessible name and tooltip', async () => {
        const queued = createRow(41, 'queued', {
            item: createItem(41, 'queued', { title: 'Named movie' }),
        });
        const paused = createRow(42, 'paused', {
            item: createItem(42, 'paused', { title: 'Paused episode' }),
        });
        const failed = createRow(43, 'failed', {
            item: createItem(43, 'failed', { title: 'Failed movie' }),
        });
        render([queued, paused], [failed]);

        const loader = TestbedHarnessEnvironment.loader(fixture);
        const commands = [
            [41, 'pause', 'Pause Named movie'],
            [41, 'cancel', 'Cancel Named movie'],
            [41, 'more', 'More actions for Named movie'],
            [42, 'resume', 'Resume Paused episode'],
            [42, 'remove', 'Remove Paused episode from manager'],
            [43, 'retry', 'Retry Failed movie'],
        ] as const;

        for (const [id, action, accessibleName] of commands) {
            expect(
                actionButton(row(id), action).getAttribute('aria-label')
            ).toBe(accessibleName);

            const tooltip = await loader.getHarness(
                MatTooltipHarness.with({
                    selector: `[data-test-id="download-queue-item-${id}"] [data-test-action="${action}"]`,
                })
            );
            await tooltip.show();
            expect(await tooltip.getTooltipText()).toBe(accessibleName);
            await tooltip.hide();
        }

        actionButton(row(41), 'more').click();
        fixture.detectChanges();
        await fixture.whenStable();
        const copyButton = actionButton(
            overlayContainer.getContainerElement(),
            'copy-url'
        );
        expect(copyButton.type).toBe('button');
        expect(copyButton.getAttribute('aria-label')).toBe(
            'Copy URL for Named movie'
        );
        const documentLoader =
            TestbedHarnessEnvironment.documentRootLoader(fixture);
        const copyTooltip = await documentLoader.getHarness(
            MatTooltipHarness.with({
                selector: '[data-test-action="copy-url"]',
            })
        );
        await copyTooltip.show();
        expect(await copyTooltip.getTooltipText()).toBe(
            'Copy URL for Named movie'
        );
        await copyTooltip.hide();
    });
});
