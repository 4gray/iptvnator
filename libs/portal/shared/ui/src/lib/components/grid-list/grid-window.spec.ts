import {
    computeGridWindow,
    GRID_WINDOW_KILL_SWITCH_KEY,
    GRID_WINDOW_OVERSCAN_ROWS,
    GridGeometry,
    isGridWindowingEnabled,
    measureGridGeometry,
    sameGridWindow,
} from './grid-window';

const GEOMETRY: GridGeometry = {
    columns: 7,
    rowPitch: 300,
    gridOffset: 16,
    viewportHeight: 600,
};

describe('computeGridWindow', () => {
    it('renders the first screen plus the overscan rows below it', () => {
        expect(computeGridWindow(2000, GEOMETRY, 0)).toEqual({
            start: 0,
            // rows 0..2 intersect the viewport, rows 3..5 are overscan
            end: 6 * 7,
            topPx: 0,
            bottomPx: (286 - 6) * 300,
        });
    });

    it('renders the rows around a deep offset with row-aligned spacers', () => {
        const scrollTop = 16 + 100 * 300 + 150;

        expect(computeGridWindow(2000, GEOMETRY, scrollTop)).toEqual({
            start: 97 * 7,
            end: 106 * 7,
            topPx: 97 * 300,
            bottomPx: (286 - 106) * 300,
        });
    });

    it('keeps the full grid height and a bounded slice at every offset', () => {
        const itemCount = 2003;
        const totalRows = Math.ceil(itemCount / GEOMETRY.columns);
        const maxRows =
            Math.ceil(GEOMETRY.viewportHeight / GEOMETRY.rowPitch) +
            1 +
            2 * GRID_WINDOW_OVERSCAN_ROWS;

        for (let scrollTop = 0; scrollTop <= 90_000; scrollTop += 137) {
            const window = computeGridWindow(itemCount, GEOMETRY, scrollTop);
            const renderedRows = Math.ceil(
                (window.end - window.start) / GEOMETRY.columns
            );

            expect(window.start % GEOMETRY.columns).toBe(0);
            expect(window.end).toBeGreaterThan(window.start);
            expect(renderedRows).toBeLessThanOrEqual(maxRows);
            expect(window.topPx + renderedRows * 300 + window.bottomPx).toBe(
                totalRows * 300
            );
        }
    });

    it('ends on the partial last row with no bottom spacer', () => {
        const window = computeGridWindow(2003, GEOMETRY, 1_000_000);

        expect(window.end).toBe(2003);
        expect(window.bottomPx).toBe(0);
    });

    it('still renders the last rows when the offset outlives a shrunk list', () => {
        expect(computeGridWindow(10, GEOMETRY, 50_000)).toEqual({
            start: 0,
            end: 10,
            topPx: 0,
            bottomPx: 0,
        });
    });

    it('renders everything for an unbounded viewport or unusable geometry', () => {
        const full = { start: 0, end: 500, topPx: 0, bottomPx: 0 };

        expect(
            computeGridWindow(
                500,
                { ...GEOMETRY, viewportHeight: Number.POSITIVE_INFINITY },
                0
            )
        ).toEqual(full);
        expect(computeGridWindow(500, { ...GEOMETRY, rowPitch: 0 }, 0)).toEqual(
            full
        );
        expect(computeGridWindow(500, { ...GEOMETRY, columns: 0 }, 0)).toEqual(
            full
        );
        expect(computeGridWindow(0, GEOMETRY, 0)).toEqual({
            start: 0,
            end: 0,
            topPx: 0,
            bottomPx: 0,
        });
    });

    it('compares windows by value', () => {
        expect(
            sameGridWindow(
                computeGridWindow(2000, GEOMETRY, 0),
                computeGridWindow(2000, GEOMETRY, 100)
            )
        ).toBe(true);
        expect(
            sameGridWindow(
                computeGridWindow(2000, GEOMETRY, 0),
                computeGridWindow(2000, GEOMETRY, 1000)
            )
        ).toBe(false);
        expect(sameGridWindow(null, computeGridWindow(1, GEOMETRY, 0))).toBe(
            false
        );
    });
});

describe('isGridWindowingEnabled', () => {
    afterEach(() => {
        document.documentElement.classList.remove('tv-shell');
        localStorage.removeItem(GRID_WINDOW_KILL_SWITCH_KEY);
        jest.restoreAllMocks();
    });

    it('is off outside the TV shell', () => {
        expect(isGridWindowingEnabled(document)).toBe(false);
        expect(isGridWindowingEnabled(null)).toBe(false);
    });

    it('is on in the TV shell unless the kill switch is set', () => {
        document.documentElement.classList.add('tv-shell');
        expect(isGridWindowingEnabled(document)).toBe(true);

        localStorage.setItem(GRID_WINDOW_KILL_SWITCH_KEY, 'off');
        expect(isGridWindowingEnabled(document)).toBe(false);
    });

    it('stays on when storage is unavailable', () => {
        document.documentElement.classList.add('tv-shell');
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });

        expect(isGridWindowingEnabled(document)).toBe(true);
    });
});

describe('measureGridGeometry', () => {
    let host: HTMLElement;
    let grid: HTMLElement;
    let styles: Pick<
        CSSStyleDeclaration,
        'gridTemplateColumns' | 'rowGap' | 'overflowY'
    >;

    const rect = (top: number, height = 280) =>
        ({ top, height, bottom: top + height }) as DOMRect;
    const addCards = (count: number, columns: number, top: number) => {
        for (let index = 0; index < count; index++) {
            const card = document.createElement('mat-card');
            const cardTop = top + Math.floor(index / columns) * 296;
            card.getBoundingClientRect = () => rect(cardTop);
            grid.appendChild(card);
        }
    };

    beforeEach(() => {
        host = document.createElement('app-grid-list');
        grid = document.createElement('div');
        grid.className = 'grid-list__grid';
        host.appendChild(grid);
        document.body.appendChild(host);
        styles = {
            gridTemplateColumns: '150px 150px 150px 150px',
            rowGap: '16px',
            overflowY: 'auto',
        };
        jest.spyOn(window, 'getComputedStyle').mockImplementation(
            () => styles as unknown as CSSStyleDeclaration
        );
        Object.defineProperty(host, 'clientHeight', { value: 640 });
        Object.defineProperty(host, 'scrollTop', { value: 900 });
        host.getBoundingClientRect = () => rect(100, 640);
        // The grid starts 16px below the host's content top, scrolled 900px.
        grid.getBoundingClientRect = () => rect(100 + 16 - 900, 20_000);
    });

    afterEach(() => {
        host.remove();
        jest.restoreAllMocks();
    });

    it('reads columns, row pitch, grid offset and viewport', () => {
        addCards(10, 4, 116 - 900);

        expect(measureGridGeometry(host, grid)).toEqual({
            columns: 4,
            rowPitch: 296,
            gridOffset: 16,
            viewportHeight: 640,
        });
    });

    it('counts the first row when the track list is not resolved', () => {
        styles.gridTemplateColumns = 'repeat(auto-fill, minmax(148px, 1fr))';
        addCards(10, 3, 0);

        expect(measureGridGeometry(host, grid)?.columns).toBe(3);
    });

    it('derives the pitch from one card and the row gap on a single row', () => {
        addCards(3, 4, 0);

        expect(measureGridGeometry(host, grid)?.rowPitch).toBe(280 + 16);
    });

    it('gives a host that does not scroll an unbounded viewport', () => {
        styles.overflowY = 'visible';
        addCards(10, 4, 0);

        expect(measureGridGeometry(host, grid)?.viewportHeight).toBe(
            Number.POSITIVE_INFINITY
        );
    });

    it('has nothing to measure without cards or layout', () => {
        expect(measureGridGeometry(host, grid)).toBeNull();

        addCards(1, 4, 0);
        (grid.firstElementChild as HTMLElement).getBoundingClientRect = () =>
            rect(0, 0);
        styles.rowGap = 'normal';
        expect(measureGridGeometry(host, grid)).toBeNull();
    });
});
