import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { SourceStatusService } from '@iptvnator/portal/shared/data-access';
import { SourceRemovalService } from '@iptvnator/playlist/shared/ui';
import { SourcesViewStateService } from '@iptvnator/playlist/shared/util';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspaceShellContextDrawerService,
} from '@iptvnator/workspace/shell/util';
import { WorkspaceSourcesFiltersPanelComponent } from './workspace-sources-filters-panel.component';

const PLAYLISTS = [
    { _id: 'm3u', title: 'a', url: 'https://a.example/list.m3u' },
    { _id: 'file', title: 'b' },
    { _id: 'xtream', title: 'c', serverUrl: 'http://x.example' },
    { _id: 'stalker', title: 'd', macAddress: 'm', portalUrl: 'http://p' },
] as PlaylistMeta[];
const BUCKETS: Record<string, string> = {
    m3u: 'ok',
    xtream: 'bad',
    stalker: 'ok',
};

describe('WorkspaceSourcesFiltersPanelComponent', () => {
    let fixture: ComponentFixture<WorkspaceSourcesFiltersPanelComponent>;
    let supportsStatusFilter: boolean;
    let openAddPlaylistDialog: jest.Mock;

    const render = () => {
        fixture = TestBed.createComponent(
            WorkspaceSourcesFiltersPanelComponent
        );
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    };
    const rows = (element: HTMLElement) =>
        Array.from(
            element.querySelectorAll<HTMLButtonElement>('.side-list__row')
        );
    const counts = (element: HTMLElement) =>
        rows(element).map(
            (row) =>
                `${row.dataset['filter']}:${row.querySelector('.side-list__row-count')?.textContent?.trim()}`
        );

    beforeEach(() => {
        localStorage.clear();
        supportsStatusFilter = true;
        openAddPlaylistDialog = jest.fn();
        TestBed.configureTestingModule({
            imports: [
                WorkspaceSourcesFiltersPanelComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                provideMockStore({
                    selectors: [
                        { selector: selectAllPlaylistsMeta, value: PLAYLISTS },
                    ],
                }),
                {
                    provide: SourceStatusService,
                    useValue: {
                        get supportsStatusFilter() {
                            return supportsStatusFilter;
                        },
                        statusOf: (p: PlaylistMeta) =>
                            BUCKETS[p._id]
                                ? {
                                      reachability:
                                          BUCKETS[p._id] === 'ok'
                                              ? 'ok'
                                              : 'bad',
                                  }
                                : null,
                    },
                },
                {
                    provide: SourceRemovalService,
                    useValue: { pendingIds: signal(new Set<string>()) },
                },
                {
                    provide: WORKSPACE_SHELL_ACTIONS,
                    useValue: { openAddPlaylistDialog },
                },
            ],
        });
    });

    it('counts each group within the other group’s choice', () => {
        const element = render();
        expect(counts(element)).toEqual([
            'all:4',
            'm3u:2',
            'xtream:1',
            'stalker:1',
            'status-all:4',
            'status-ok:2',
            'status-bad:1',
        ]);

        rows(element)[6].click();
        fixture.detectChanges();
        expect(counts(element).slice(0, 4)).toEqual([
            'all:1',
            'm3u:0',
            'xtream:1',
            'stalker:0',
        ]);
        expect(TestBed.inject(SourcesViewStateService).filter()).toEqual({
            type: 'all',
            status: 'bad',
        });
    });

    it('marks the chosen row of each group as pressed', () => {
        const element = render();
        rows(element)[2].click();
        fixture.detectChanges();
        expect(
            rows(element).map((row) => row.getAttribute('aria-pressed'))
        ).toEqual([
            'false',
            'false',
            'true',
            'false',
            'true',
            'false',
            'false',
        ]);
    });

    it('has no status group where source health is unknown', () => {
        supportsStatusFilter = false;
        const element = render();
        expect(rows(element)).toHaveLength(4);
    });

    it('adds a playlist from the header, closing the phone drawer first', () => {
        const drawer = TestBed.inject(WorkspaceShellContextDrawerService);
        drawer.open();
        let drawerOpenAtDialog: boolean | null = null;
        openAddPlaylistDialog.mockImplementation(() => {
            drawerOpenAtDialog = drawer.isOpen();
        });
        const element = render();
        element
            .querySelector<HTMLButtonElement>(
                '[data-test-id="sources-add-playlist"]'
            )
            ?.click();
        expect(openAddPlaylistDialog).toHaveBeenCalled();
        // Two focus-trapped modals must not stack.
        expect(drawerOpenAtDialog).toBe(false);
    });
});
