import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { GridListComponent } from './grid-list.component';
import { measureGridGeometry } from './grid-window';

describe('measureGridGeometry under a hidden ancestor', () => {
    afterEach(() => jest.restoreAllMocks());

    it('returns null for a grid under a display:none ancestor', () => {
        // display:none: no layout boxes, so every rect is 0, but the
        // computed style still resolves (rowGap 16px, template unresolved).
        const host = document.createElement('app-grid-list');
        const grid = document.createElement('div');
        grid.className = 'grid-list__grid';
        host.appendChild(grid);
        document.body.appendChild(host);
        for (let i = 0; i < 25; i++) {
            const card = document.createElement('mat-card');
            card.getBoundingClientRect = () =>
                ({ top: 0, height: 0, bottom: 0 }) as DOMRect;
            grid.appendChild(card);
        }
        jest.spyOn(window, 'getComputedStyle').mockImplementation(
            () =>
                ({
                    gridTemplateColumns:
                        'repeat(auto-fill, minmax(148px, 1fr))',
                    rowGap: '16px',
                    overflowY: 'auto',
                }) as unknown as CSSStyleDeclaration
        );
        host.getBoundingClientRect = () =>
            ({ top: 0, height: 0, bottom: 0 }) as DOMRect;
        grid.getBoundingClientRect = () =>
            ({ top: 0, height: 0, bottom: 0 }) as DOMRect;

        expect(measureGridGeometry(host, grid)).toBeNull();
        host.remove();
    });
});

describe('GridListComponent windowing with id-less items', () => {
    let fixture: ComponentFixture<GridListComponent>;
    let host: HTMLElement;
    const COLUMNS = 4,
        PITCH = 300,
        OFFSET = 16,
        VIEWPORT = 600;
    const rect = (top: number, height: number) =>
        ({ top, height, bottom: top + height, left: 0, right: 600 }) as DOMRect;
    const render = async () => {
        for (let pass = 0; pass < 3; pass++) {
            TestBed.tick();
            await fixture.whenStable();
        }
    };

    afterEach(() => {
        document.documentElement.classList.remove('tv-shell');
        jest.restoreAllMocks();
    });

    it('keeps the focused card bound to the same item', async () => {
        document.documentElement.classList.add('tv-shell');
        await TestBed.configureTestingModule({ imports: [GridListComponent] })
            .overrideComponent(GridListComponent, {
                remove: { imports: [TranslatePipe] },
                add: {
                    imports: [
                        MockPipe(
                            TranslatePipe,
                            (v: string | null | undefined) => v ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();
        fixture = TestBed.createComponent(GridListComponent);
        host = fixture.nativeElement;
        let scrollTop = 0;
        Object.defineProperty(host, 'scrollTop', {
            get: () => scrollTop,
            set: (v: number) => (scrollTop = v),
        });
        Object.defineProperty(host, 'clientHeight', { value: VIEWPORT });
        host.getBoundingClientRect = () => rect(0, VIEWPORT);
        const realStyle = window.getComputedStyle.bind(window);
        jest.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
            if (el === host)
                return { overflowY: 'auto' } as CSSStyleDeclaration;
            if ((el as HTMLElement).classList?.contains('grid-list__grid'))
                return {
                    gridTemplateColumns: '140px 140px 140px 140px',
                    rowGap: '16px',
                } as CSSStyleDeclaration;
            return realStyle(el);
        });
        jest.spyOn(
            HTMLElement.prototype,
            'getBoundingClientRect'
        ).mockImplementation(function (this: HTMLElement) {
            const grid = this.closest<HTMLElement>('.grid-list__grid');
            const gridTop = OFFSET - host.scrollTop;
            if (this.matches('.grid-list__grid')) return rect(gridTop, 100_000);
            if (this.tagName !== 'MAT-CARD' || !grid) return rect(0, 0);
            const index = Array.from(
                grid.querySelectorAll(':scope > mat-card')
            ).indexOf(this);
            const padding = Number.parseFloat(grid.style.paddingTop) || 0;
            return rect(
                gridTop + padding + Math.floor(index / COLUMNS) * PITCH,
                PITCH - 16
            );
        });
        // Items without id / stream_id / series_id / xtream_id.
        fixture.componentRef.setInput(
            'items',
            Array.from({ length: 200 }, (_, i) => ({ name: `Movie ${i}` }))
        );
        await render();
        host.scrollTop = OFFSET + 20 * PITCH;
        host.dispatchEvent(new Event('scroll'));
        await render();
        const focused = Array.from(
            host.querySelectorAll<HTMLElement>('mat-card')
        ).find(
            (c) => c.getAttribute('aria-label') === 'Movie 84'
        ) as HTMLElement;
        focused.focus();

        host.scrollTop = OFFSET + 21 * PITCH;
        host.dispatchEvent(new Event('scroll'));
        await render();

        expect(focused.isConnected).toBe(true);
        expect(focused.getAttribute('aria-label')).toBe('Movie 84');

        // A consumer that re-maps its items on each change (progress badges,
        // an append) hands over new objects: the focused card stays.
        fixture.componentRef.setInput(
            'items',
            Array.from({ length: 260 }, (_, i) => ({ name: `Movie ${i}` }))
        );
        await render();

        expect(focused.isConnected).toBe(true);
        expect(focused.getAttribute('aria-label')).toBe('Movie 84');
    });
});
