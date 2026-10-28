import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { GridListComponent } from './grid-list.component';
import { GRID_WINDOW_KILL_SWITCH_KEY } from './grid-window';

/**
 * A tiny layout engine for jsdom: 4 columns, rows 300px apart, the grid 16px
 * below the top of a 600px scroll viewport. Card tops follow the grid's
 * padding-top (the top spacer) and the card's position among its siblings,
 * like a real CSS grid would place them.
 */
const COLUMNS = 4;
const PITCH = 300;
const GRID_OFFSET = 16;
const VIEWPORT = 600;

const rect = (top: number, height: number) =>
    ({ top, height, bottom: top + height, left: 0, right: 600 }) as DOMRect;

function installLayout(host: HTMLElement): void {
    let scrollTop = 0;
    Object.defineProperty(host, 'scrollTop', {
        get: () => scrollTop,
        set: (value: number) => (scrollTop = value),
    });
    Object.defineProperty(host, 'clientHeight', { value: VIEWPORT });
    host.getBoundingClientRect = () => rect(0, VIEWPORT);

    const realStyle = window.getComputedStyle.bind(window);
    jest.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
        if (element === host) {
            return { overflowY: 'auto' } as CSSStyleDeclaration;
        }
        if ((element as HTMLElement).classList?.contains('grid-list__grid')) {
            return {
                gridTemplateColumns: Array(COLUMNS).fill('140px').join(' '),
                rowGap: '16px',
            } as CSSStyleDeclaration;
        }
        return realStyle(element);
    });
    jest.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect'
    ).mockImplementation(function (this: HTMLElement) {
        const grid = this.closest<HTMLElement>('.grid-list__grid');
        const gridTop = GRID_OFFSET - host.scrollTop;
        if (this.matches('.grid-list__grid')) {
            return rect(gridTop, 100_000);
        }
        if (this.tagName !== 'MAT-CARD' || !grid) {
            return rect(0, 0);
        }
        const index = Array.from(
            grid.querySelectorAll(':scope > mat-card')
        ).indexOf(this);
        const padding = Number.parseFloat(grid.style.paddingTop) || 0;
        const row = Math.floor(index / COLUMNS);
        return rect(gridTop + padding + row * PITCH, PITCH - 16);
    });
}

const movies = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
        stream_id: 1000 + index,
        name: `Movie ${index}`,
    }));

describe('GridListComponent row windowing', () => {
    let fixture: ComponentFixture<GridListComponent>;
    let host: HTMLElement;

    const cards = () =>
        Array.from(host.querySelectorAll<HTMLElement>('mat-card'));
    const labels = () => cards().map((card) => card.getAttribute('aria-label'));
    const grid = () =>
        host.querySelector<HTMLElement>('.grid-list__grid') as HTMLElement;
    const render = async () => {
        for (let pass = 0; pass < 3; pass++) {
            TestBed.tick();
            await fixture.whenStable();
        }
    };
    const scrollTo = async (top: number) => {
        host.scrollTop = top;
        host.dispatchEvent(new Event('scroll'));
        await render();
    };

    async function create(items: object[], tvShell = true): Promise<void> {
        document.documentElement.classList.toggle('tv-shell', tvShell);
        await TestBed.configureTestingModule({
            imports: [GridListComponent],
        })
            .overrideComponent(GridListComponent, {
                remove: { imports: [TranslatePipe] },
                add: {
                    imports: [
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();
        fixture = TestBed.createComponent(GridListComponent);
        host = fixture.nativeElement;
        installLayout(host);
        fixture.componentRef.setInput('items', items);
        await render();
    }

    afterEach(() => {
        document.documentElement.classList.remove('tv-shell');
        localStorage.removeItem(GRID_WINDOW_KILL_SWITCH_KEY);
        jest.restoreAllMocks();
    });

    it('renders every card, without spacers, outside the TV shell', async () => {
        await create(movies(200), false);

        expect(cards()).toHaveLength(200);
        expect(grid().getAttribute('style')).toBeNull();
        expect(host.classList).not.toContain('grid-list--windowed');
    });

    it('renders only the rows around the viewport in the TV shell', async () => {
        await create(movies(200));

        // rows 0..2 visible + 3 overscan rows, 50 rows in all
        expect(cards()).toHaveLength(6 * COLUMNS);
        expect(labels()[0]).toBe('Movie 0');
        expect(grid().style.paddingTop).toBe('0px');
        expect(grid().style.paddingBottom).toBe(`${(50 - 6) * PITCH}px`);
        expect(host.classList).toContain('grid-list--windowed');
    });

    it('moves the window with the scroll and keeps the full height', async () => {
        await create(movies(200));

        await scrollTo(GRID_OFFSET + 20 * PITCH);

        expect(labels()[0]).toBe(`Movie ${17 * COLUMNS}`);
        expect(labels().at(-1)).toBe(`Movie ${26 * COLUMNS - 1}`);
        expect(grid().style.paddingTop).toBe(`${17 * PITCH}px`);
        expect(grid().style.paddingBottom).toBe(`${(50 - 26) * PITCH}px`);

        await scrollTo(0);
        expect(labels()[0]).toBe('Movie 0');
        expect(grid().style.paddingTop).toBe('0px');
    });

    it('keeps the cards still in the window when it shifts', async () => {
        await create(movies(200));
        await scrollTo(GRID_OFFSET + 20 * PITCH);
        const focused = cards().find(
            (card) => card.getAttribute('aria-label') === 'Movie 84'
        ) as HTMLElement;
        focused.focus();

        await scrollTo(GRID_OFFSET + 21 * PITCH);

        expect(labels()[0]).toBe(`Movie ${18 * COLUMNS}`);
        expect(cards()).toContain(focused);
        expect(focused.getAttribute('aria-label')).toBe('Movie 84');
        expect(document.activeElement).toBe(focused);
    });

    it('catches up with a scroll not yet reported before the next key', async () => {
        await create(movies(200));
        await scrollTo(GRID_OFFSET + 20 * PITCH);
        const focused = cards().find(
            (card) => card.getAttribute('aria-label') === 'Movie 92'
        ) as HTMLElement;

        // A held key scrolled 4 rows; the scroll event waits for a frame.
        host.scrollTop = GRID_OFFSET + 24 * PITCH;
        focused.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
        );

        // Synchronously, before the remote layer looks for the next row.
        expect(labels()[0]).toBe(`Movie ${21 * COLUMNS}`);
        expect(labels().at(-1)).toBe(`Movie ${30 * COLUMNS - 1}`);
        expect(cards()).toContain(focused);
    });

    it('opens on a restored deep offset and grows the bottom spacer on append', async () => {
        await create(movies(200));
        await scrollTo(GRID_OFFSET + 40 * PITCH);
        expect(labels()[0]).toBe(`Movie ${37 * COLUMNS}`);

        fixture.componentRef.setInput('items', movies(400));
        await render();

        expect(labels()[0]).toBe(`Movie ${37 * COLUMNS}`);
        expect(grid().style.paddingBottom).toBe(`${(100 - 46) * PITCH}px`);
    });

    it('honours the kill switch', async () => {
        localStorage.setItem(GRID_WINDOW_KILL_SWITCH_KEY, 'off');
        await create(movies(200));

        expect(cards()).toHaveLength(200);
        expect(grid().getAttribute('style')).toBeNull();
    });
});
