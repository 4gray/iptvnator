import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SourceStatusService } from '@iptvnator/portal/shared/data-access';
import { PlaylistMeta, SourceStatus } from '@iptvnator/shared/interfaces';
import { SourceClock } from './source-clock';
import { SourceRowComponent } from './source-row.component';

const M3U: PlaylistMeta = {
    _id: 'm3u',
    title: 'get.php?username=joe&password=hunter2&type=m3u_plus',
    url: 'http://biggie.to:8080/get.php?username=joe&password=hunter2&type=m3u_plus',
    count: 1803,
    importDate: new Date(2026, 8, 18).toISOString(),
    autoRefresh: false,
};
const LOCAL: PlaylistMeta = {
    _id: 'local',
    title: 'playlist (13)',
    count: 3220,
    importDate: new Date(2026, 8, 30).toISOString(),
    autoRefresh: false,
};

describe('SourceRowComponent', () => {
    let fixture: ComponentFixture<SourceRowComponent>;
    let statuses: Map<string, SourceStatus>;
    let statusService: {
        statusOf: jest.Mock;
        tracks: jest.Mock;
        ensureChecked: jest.Mock;
        recheck: jest.Mock;
    };

    const render = (
        playlist: PlaylistMeta,
        inputs: Record<string, unknown> = {}
    ): HTMLElement => {
        fixture = TestBed.createComponent(SourceRowComponent);
        fixture.componentRef.setInput('playlist', playlist);
        for (const [name, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(name, value);
        }
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    };

    beforeEach(() => {
        statuses = new Map();
        statusService = {
            statusOf: jest.fn((p: PlaylistMeta) =>
                p.url || p.serverUrl ? (statuses.get(p._id) ?? null) : null
            ),
            tracks: jest.fn((p: PlaylistMeta) => !!(p.url || p.serverUrl)),
            ensureChecked: jest.fn(),
            recheck: jest.fn(),
        };
        TestBed.configureTestingModule({
            imports: [
                SourceRowComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: SourceStatusService, useValue: statusService },
            ],
        });
    });

    it('shows the host and a credential-free URL, never the password', () => {
        const element = render(M3U);
        expect(element.querySelector('.source-row__name')?.textContent).toBe(
            'biggie.to:8080'
        );
        expect(
            element.querySelector('.source-row__part--url')?.textContent
        ).toBe('http://biggie.to:8080/get.php?type=m3u_plus');
        expect(element.textContent).not.toMatch(/hunter2|password=/);
        expect(
            element
                .querySelector('.source-row__body')
                ?.getAttribute('aria-label')
        ).toBe('biggie.to:8080');
    });

    it('draws no status dot for a local file', () => {
        const element = render(LOCAL);
        expect(element.querySelector('.source-tile__dot')).toBeNull();
        expect(element.querySelector('.source-row__part--url')).toBeNull();
    });

    it('tags a failing source and offers Retry, which rechecks it', () => {
        statuses.set('m3u', { reachability: 'bad' });
        const element = render(M3U, { canRefresh: true });
        expect(element.querySelector('.source-row__tag')?.textContent).toBe(
            'WORKSPACE.SOURCES.ROW.UNREACHABLE'
        );
        const retry =
            element.querySelector<HTMLButtonElement>('.source-row__retry');
        expect(retry).not.toBeNull();
        retry?.click();
        expect(statusService.recheck).toHaveBeenCalledWith(M3U);
        expect(
            element
                .querySelector('.source-tile__dot')
                ?.getAttribute('data-state')
        ).toBe('bad');
    });

    it("names the check's cause on the dot, and an M3U check's scope", () => {
        const dotLabel = (element: HTMLElement) =>
            element
                .querySelector('.source-tile__dot')
                ?.getAttribute('aria-label');
        statuses.set('m3u', { reachability: 'bad', reason: 'auth' });
        expect(dotLabel(render(M3U))).toBe(
            'SOURCE_HEALTH.REASON.auth · SOURCE_HEALTH.M3U_SCOPE'
        );

        // Without a kept cause the dot falls back to its colour's wording.
        statuses.set('xtream', { reachability: 'bad' });
        expect(
            dotLabel(
                render({
                    ...M3U,
                    _id: 'xtream',
                    url: undefined,
                    serverUrl: 'http://portal.test',
                    username: 'joe',
                    password: 'hunter2',
                })
            )
        ).toBe('SOURCE_HEALTH.REASON.network');
    });

    it("keeps counting a failure's duration while the list stays open", () => {
        const start = Date.UTC(2026, 9, 13, 12);
        const now = signal(start);
        TestBed.overrideProvider(SourceClock, { useValue: { now } });
        statuses.set('m3u', {
            reachability: 'bad',
            failingSince: start - 10 * 60_000,
        });
        const element = render(M3U);
        const tag = () =>
            element.querySelector('.source-row__tag')?.textContent?.trim();
        expect(tag()).toBe('WORKSPACE.SOURCES.ROW.UNREACHABLE');

        now.set(start + 2 * 60 * 60_000);
        fixture.detectChanges();
        expect(tag()).toBe('WORKSPACE.SOURCES.ROW.UNREACHABLE_FOR');
    });

    it('opens on click and on Enter, but not while busy', () => {
        const element = render(M3U);
        const opened = jest.fn();
        fixture.componentInstance.activated.subscribe(opened);

        element.querySelector<HTMLElement>('.source-row')?.click();
        element
            .querySelector('.source-row__body')
            ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(opened).toHaveBeenCalledTimes(2);

        fixture.componentRef.setInput('deleting', true);
        fixture.detectChanges();
        element.querySelector<HTMLElement>('.source-row')?.click();
        expect(opened).toHaveBeenCalledTimes(2);
    });

    it('does not open the source from a click on the drag handle', () => {
        const element = render(M3U, { draggable: true });
        const opened = jest.fn();
        fixture.componentInstance.activated.subscribe(opened);
        element.querySelector<HTMLElement>('.source-row__handle')?.click();
        expect(opened).not.toHaveBeenCalled();
    });

    it('refreshes the focused row with R', () => {
        const element = render(M3U, { canRefresh: true });
        const refresh = jest.fn();
        fixture.componentInstance.refreshRequested.subscribe(refresh);
        const row = element.querySelector('.source-row');

        row?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'r', bubbles: true })
        );
        row?.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'r',
                metaKey: true,
                bubbles: true,
            })
        );
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('is a plain option in the switcher, with a pointer-only menu', () => {
        const element = render(M3U, { size: 'compact', current: true });
        expect(
            element.querySelector('.source-row__body')?.getAttribute('role')
        ).toBeNull();
        expect(element.querySelector('button')).toBeNull();
        expect(
            element
                .querySelector('.source-row__more--compact')
                ?.getAttribute('aria-hidden')
        ).toBe('true');
        expect(element.querySelector('.source-row__check')).not.toBeNull();
        expect(element.querySelector('.source-row__part--url')).toBeNull();
    });

    it('checks the source while shown and cancels when removed', () => {
        render(M3U);
        expect(statusService.ensureChecked).toHaveBeenCalledWith(
            M3U,
            expect.any(AbortSignal)
        );
        const signal = statusService.ensureChecked.mock.calls[0][1];
        fixture.destroy();
        expect((signal as AbortSignal).aborted).toBe(true);
    });

    it('does not check the source when told not to', () => {
        render(M3U, { checkHealth: false });
        expect(statusService.ensureChecked).not.toHaveBeenCalled();
    });
});
