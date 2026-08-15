import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { RecordingItem } from '@iptvnator/services';
import type { RecordingItemAction } from './recording-actions';
import type { RecordingRowViewModel } from './recording-manager.viewmodel';
import { RecordingQueueComponent } from './recording-queue.component';

const TEST_TRANSLATIONS = {
    DOWNLOADS: {
        RECORDING_NOW: 'Recording now',
        NEEDS_ATTENTION: 'Needs attention',
        STOP_RECORDING: 'Stop recording',
        REMOVE_FROM_MANAGER: 'Remove from manager',
        REVEAL: 'Show in folder',
        MORE_ACTIONS: 'More actions',
        STATUS: {
            FILE_MISSING: 'File missing',
            FAILED: 'Failed',
        },
        ARIA: {
            OPEN: 'Open {{title}}',
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
    status: RecordingItem['status'],
    overrides: Partial<RecordingItem> = {}
): RecordingItem {
    return {
        id,
        status,
        filePath: `/recordings/${id}.ts`,
        channelName: `Channel ${id}`,
        startedAt: '2026-08-15T12:00:00Z',
        fileAvailability: 'available',
        ...overrides,
    };
}

function createRow(
    item: RecordingItem,
    overrides: Partial<RecordingRowViewModel> = {}
): RecordingRowViewModel {
    return {
        item,
        programTitle: item.programTitle?.trim() ?? '',
        channelName: item.channelName,
        attentionReason: null,
        durationSeconds: null,
        interrupted: false,
        ...overrides,
    };
}

describe('RecordingQueueComponent', () => {
    let fixture: ComponentFixture<RecordingQueueComponent>;
    let overlayContainer: OverlayContainer;

    function render(
        activeItems: readonly RecordingRowViewModel[] = [],
        attentionItems: readonly RecordingRowViewModel[] = [],
        pendingIds: ReadonlySet<number> = new Set()
    ): void {
        fixture.componentRef.setInput('activeItems', activeItems);
        fixture.componentRef.setInput('attentionItems', attentionItems);
        fixture.componentRef.setInput('pendingIds', pendingIds);
        fixture.detectChanges();
    }

    function row(id: number): HTMLElement {
        const element = fixture.nativeElement.querySelector(
            `[data-test-id="recording-queue-item-${id}"]`
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
                RecordingQueueComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', TEST_TRANSLATIONS);
        translate.use('en');
        overlayContainer = TestBed.inject(OverlayContainer);
        fixture = TestBed.createComponent(RecordingQueueComponent);
    });

    afterEach(() => {
        overlayContainer.getContainerElement().replaceChildren();
        jest.useRealTimers();
    });

    it('renders no sections for empty inputs', () => {
        render([], []);

        expect(fixture.nativeElement.querySelector('section')).toBeNull();
    });

    it('renders an active recording with REC elapsed chip and stop as the only primary action', () => {
        jest.useFakeTimers().setSystemTime(
            new Date('2026-08-15T12:01:30Z')
        );
        const item = createItem(1, 'recording', {
            programTitle: 'Evening news',
            fileSizeBytes: 1.5 * 1024 ** 2,
        });
        const emitted: RecordingItemAction[] = [];
        fixture.componentInstance.itemAction.subscribe((action) =>
            emitted.push(action)
        );
        render([createRow(item)], []);

        const section: HTMLElement = fixture.nativeElement.querySelector(
            '[data-test-id="recordings-active-section"]'
        );
        expect(section).not.toBeNull();
        expect(
            section
                .querySelector('.recording-queue__heading-label')
                ?.textContent?.trim()
        ).toBe('Recording now');
        expect(
            section.querySelector('.app-count-badge')?.textContent?.trim()
        ).toBe('1');
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="recordings-attention-section"]'
            )
        ).toBeNull();

        const host = row(1);
        const recChip = host.querySelector<HTMLElement>(
            '.recording-queue__rec-chip'
        );
        expect(recChip?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
            'REC 01:30'
        );
        expect(
            host.querySelector('.recording-queue__progress')
        ).not.toBeNull();
        expect(
            host.querySelector('.recording-queue__bytes')?.textContent
        ).toContain('1.5 MB');
        expect(
            host.querySelector('[data-test-action="remove-recording"]')
        ).toBeNull();

        jest.advanceTimersByTime(1000);
        fixture.detectChanges();
        expect(
            host
                .querySelector('.recording-queue__rec-chip')
                ?.textContent?.replace(/\s+/g, ' ')
                .trim()
        ).toBe('REC 01:31');

        actionButton(host, 'stop-recording').click();
        expect(emitted).toEqual([{ type: 'stop', item }]);
    });

    it('renders a missing-file recording as attention with remove and no reveal', async () => {
        const item = createItem(2, 'completed', {
            programTitle: 'Vanished show',
            fileAvailability: 'missing',
            playlistName: 'Alpha Source',
        });
        const viewModel = createRow(item, { attentionReason: 'file-missing' });
        const emitted: RecordingItemAction[] = [];
        fixture.componentInstance.itemAction.subscribe((action) =>
            emitted.push(action)
        );
        render([], [viewModel]);

        const section: HTMLElement = fixture.nativeElement.querySelector(
            '[data-test-id="recordings-attention-section"]'
        );
        expect(section).not.toBeNull();
        expect(
            section
                .querySelector('.recording-queue__heading-label')
                ?.textContent?.trim()
        ).toBe('Needs attention');
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="recordings-active-section"]'
            )
        ).toBeNull();

        const host = row(2);
        const warnChip = host.querySelector<HTMLElement>(
            '.recording-queue__warn-chip'
        );
        expect(warnChip?.textContent).toContain('File missing');
        expect(warnChip?.querySelector('mat-icon')?.textContent?.trim()).toBe(
            'file_off'
        );
        expect(host.querySelector('.recording-queue__progress')).toBeNull();
        expect(
            host.querySelector('[data-test-action="stop-recording"]')
        ).toBeNull();

        actionButton(host, 'remove-recording').click();
        expect(emitted).toEqual([{ type: 'remove', item }]);

        actionButton(host, 'more').click();
        fixture.detectChanges();
        await fixture.whenStable();

        const menu = overlayContainer.getContainerElement();
        expect(
            menu.querySelector('[data-test-action="reveal-recording"]')
        ).toBeNull();
        actionButton(menu, 'menu-remove-recording').click();
        expect(emitted).toEqual([
            { type: 'remove', item },
            { type: 'remove', item },
        ]);
    });

    it('shows the failed status chip for failed recordings', () => {
        const item = createItem(3, 'failed', {
            errorMessage: 'stream dropped',
        });
        render([], [createRow(item, { attentionReason: 'failed' })]);

        const host = row(3);
        const warnChip = host.querySelector<HTMLElement>(
            '.recording-queue__warn-chip'
        );
        expect(warnChip?.textContent).toContain('Failed');
        expect(warnChip?.querySelector('mat-icon')?.textContent?.trim()).toBe(
            'error'
        );
        expect(
            host.querySelector('.recording-queue__error')?.textContent?.trim()
        ).toBe('stream dropped');
    });

    it('falls back to channel name and start time for an untitled recording', () => {
        const item = createItem(4, 'completed');
        const opened: RecordingItem[] = [];
        fixture.componentInstance.openRequested.subscribe((openedItem) =>
            opened.push(openedItem)
        );
        render([], [createRow(item, { attentionReason: 'failed' })]);

        const title = row(4).querySelector<HTMLButtonElement>(
            '[data-test-control="title"]'
        );
        const text = title?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        expect(text.startsWith('Channel 4 —')).toBe(true);
        expect(text).toContain('Aug');
        expect(
            row(4)
                .querySelector('[data-test-control="artwork"]')
                ?.getAttribute('aria-label')
        ).toBe('Open Channel 4');

        title?.click();
        expect(opened).toEqual([item]);
        expect(opened[0]).toBe(item);
    });

    it('disables every control and suppresses emissions while pending', () => {
        const item = createItem(6, 'recording');
        const emitted = jest.fn();
        const opened = jest.fn();
        fixture.componentInstance.itemAction.subscribe(emitted);
        fixture.componentInstance.openRequested.subscribe(opened);
        render([createRow(item)], [], new Set([6]));

        const host = row(6);
        expect(host.getAttribute('aria-busy')).toBe('true');
        const buttons = Array.from(
            host.querySelectorAll<HTMLButtonElement>('button')
        );
        expect(buttons.length).toBeGreaterThan(0);
        expect(buttons.every(({ disabled }) => disabled)).toBe(true);

        fixture.componentInstance.emitAction('stop', item);
        fixture.componentInstance.requestOpen(item);
        expect(emitted).not.toHaveBeenCalled();
        expect(opened).not.toHaveBeenCalled();
    });
});
