import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { RecordingItem } from '@iptvnator/services';
import type { RecordingItemAction } from './recording-actions';
import type { RecordingRowViewModel } from './recording-manager.viewmodel';
import { RecordingLibraryComponent } from './recording-library.component';

const TEST_TRANSLATIONS = {
    DOWNLOADS: {
        RECORDINGS: 'Recordings',
        RECORDING_BADGE: 'Recording',
        PLAY: 'Play',
        REVEAL: 'Show in folder',
        OPEN_DETAILS: 'Open details',
        REMOVE_FROM_MANAGER: 'Remove from manager',
        MORE_ACTIONS: 'More actions',
        STATUS: {
            INTERRUPTED: 'Interrupted',
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
    overrides: Partial<RecordingItem> = {}
): RecordingItem {
    return {
        id,
        status: 'completed',
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

describe('RecordingLibraryComponent', () => {
    let fixture: ComponentFixture<RecordingLibraryComponent>;
    let overlayContainer: OverlayContainer;

    function render(
        items: readonly RecordingRowViewModel[],
        pendingIds: ReadonlySet<number> = new Set()
    ): void {
        fixture.componentRef.setInput('items', items);
        fixture.componentRef.setInput('pendingIds', pendingIds);
        fixture.detectChanges();
    }

    function card(id: number): HTMLElement {
        const element = fixture.nativeElement.querySelector(
            `[data-test-id="recording-card-${id}"]`
        );
        expect(element).not.toBeNull();
        return element;
    }

    async function openCardMenu(host: HTMLElement): Promise<HTMLElement> {
        const more = host.querySelector<HTMLButtonElement>(
            '.recording-library__more'
        );
        expect(more).not.toBeNull();
        more?.click();
        fixture.detectChanges();
        await fixture.whenStable();
        return overlayContainer.getContainerElement();
    }

    function menuButton(menu: ParentNode, action: string): HTMLButtonElement {
        const button = menu.querySelector<HTMLButtonElement>(
            `[data-test-action="${action}"]`
        );
        expect(button).not.toBeNull();
        return button as HTMLButtonElement;
    }

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                RecordingLibraryComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', TEST_TRANSLATIONS);
        translate.use('en');
        overlayContainer = TestBed.inject(OverlayContainer);
        fixture = TestBed.createComponent(RecordingLibraryComponent);
    });

    afterEach(() => {
        overlayContainer.getContainerElement().replaceChildren();
    });

    it('renders no section without items', () => {
        render([]);

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="recordings-library-section"]'
            )
        ).toBeNull();
        expect(fixture.nativeElement.querySelector('section')).toBeNull();
    });

    it('renders cards with badge, duration chip, interrupted marker, and facts', () => {
        const finished = createRow(
            createItem(1, {
                programTitle: 'Evening news',
                fileSizeBytes: 1.5 * 1024 ** 2,
            }),
            { durationSeconds: 3480 }
        );
        const interrupted = createRow(
            createItem(2, { status: 'interrupted' }),
            { interrupted: true }
        );
        render([finished, interrupted]);

        const section: HTMLElement = fixture.nativeElement.querySelector(
            '[data-test-id="recordings-library-section"]'
        );
        expect(section).not.toBeNull();
        expect(section.querySelector('h2 span')?.textContent?.trim()).toBe(
            'Recordings'
        );
        expect(
            section.querySelector('.app-count-badge')?.textContent?.trim()
        ).toBe('2');

        const finishedCard = card(1);
        expect(
            finishedCard
                .querySelector('.recording-library__type')
                ?.textContent?.trim()
        ).toBe('Recording');
        const duration = finishedCard.querySelector<HTMLElement>(
            '.recording-library__duration'
        );
        expect(duration?.textContent).toContain('58 min');
        expect(duration?.textContent).not.toContain('Interrupted');
        const facts = finishedCard
            .querySelector('.recording-library__facts')
            ?.textContent?.replace(/\s+/g, ' ')
            .trim();
        expect(facts).toContain('Channel 1');
        expect(facts).toContain('Aug');
        expect(facts).toContain('1.5 MB');
        expect(
            finishedCard
                .querySelector('.recording-library__title-button')
                ?.textContent?.trim()
        ).toBe('Evening news');

        expect(
            card(2)
                .querySelector('.recording-library__duration')
                ?.textContent?.trim()
        ).toBe('Interrupted');
    });

    it('opens the item from the artwork and title buttons', () => {
        const item = createItem(3, { programTitle: 'Late movie' });
        const opened: RecordingItem[] = [];
        fixture.componentInstance.openRequested.subscribe((openedItem) =>
            opened.push(openedItem)
        );
        render([createRow(item)]);

        const host = card(3);
        const artwork = host.querySelector<HTMLButtonElement>(
            '.recording-library__artwork-button'
        );
        expect(artwork?.getAttribute('aria-label')).toBe('Open Late movie');
        artwork?.click();
        host.querySelector<HTMLButtonElement>(
            '.recording-library__title-button'
        )?.click();

        expect(opened).toEqual([item, item]);
        expect(opened[0]).toBe(item);
        expect(opened[1]).toBe(item);
    });

    it('routes play, reveal, remove, and details through the card menu', async () => {
        const item = createItem(4, {
            programTitle: 'Menu movie',
            playlistName: 'Alpha Source',
        });
        const emitted: RecordingItemAction[] = [];
        const opened = jest.fn();
        fixture.componentInstance.itemAction.subscribe((action) =>
            emitted.push(action)
        );
        fixture.componentInstance.openRequested.subscribe(opened);
        render([createRow(item)]);

        const firstMenu = await openCardMenu(card(4));
        expect(
            firstMenu
                .querySelector('.download-source-menu-header')
                ?.textContent?.replace(/\s+/g, ' ')
                .trim()
        ).toBe('Source Alpha Source');

        const menuActions = [
            ['play-recording', 'play'],
            ['reveal-recording', 'reveal'],
            ['remove-recording', 'remove'],
        ] as const;
        let menu = firstMenu;
        for (const [testAction] of menuActions) {
            menuButton(menu, testAction).click();
            fixture.detectChanges();
            await fixture.whenStable();
            menu = await openCardMenu(card(4));
        }

        expect(emitted).toEqual(
            menuActions.map(([, type]) => ({ type, item }))
        );
        expect(opened).not.toHaveBeenCalled();

        menuButton(menu, 'open-recording-detail').click();
        expect(opened).toHaveBeenCalledTimes(1);
        expect(opened).toHaveBeenCalledWith(item);
    });

    it('falls back to channel name and start date for an untitled recording', () => {
        const item = createItem(9);
        render([createRow(item)]);

        const title = card(9)
            .querySelector('.recording-library__title-button')
            ?.textContent?.replace(/\s+/g, ' ')
            .trim();
        expect(title?.startsWith('Channel 9 —')).toBe(true);
        expect(title).toContain('Aug');
        expect(
            card(9)
                .querySelector('.recording-library__artwork-button')
                ?.getAttribute('aria-label')
        ).toBe('Open Channel 9');
    });
});
