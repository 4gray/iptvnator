import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MockModule } from 'ng-mocks';
import {
    PortalStatusService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { PlaylistItemComponent } from './playlist-item.component';

describe('PlaylistItemComponent', () => {
    let component: PlaylistItemComponent;
    let fixture: ComponentFixture<PlaylistItemComponent>;
    let runtime: {
        supportsPlaylistRefresh: boolean;
        supportsXtreamSqliteDataSource: boolean;
    };

    beforeEach(waitForAsync(() => {
        runtime = {
            supportsPlaylistRefresh: true,
            supportsXtreamSqliteDataSource: true,
        };

        TestBed.configureTestingModule({
            imports: [
                PlaylistItemComponent,
                MockModule(MatIconModule),
                MockModule(MatListModule),
                MockModule(MatTooltipModule),
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: PortalStatusService,
                    useValue: {
                        checkPortalStatus: jest
                            .fn()
                            .mockResolvedValue('active'),
                        getStatusClass: jest.fn(() => 'status-active'),
                        getStatusIcon: jest.fn(() => 'check_circle'),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(PlaylistItemComponent);
        component = fixture.componentInstance;
        component.item = {
            title: 'Playlist',
            _id: '1',
            count: 10,
            importDate: Date.now().toString(),
            autoRefresh: false,
        };
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('shows busy UI and suppresses playlist clicks while deleting', () => {
        const emitSpy = jest.spyOn(component.playlistClicked, 'emit');

        fixture.componentRef.setInput('isDeleting', true);
        fixture.detectChanges();

        const nativeElement = fixture.nativeElement as HTMLElement;
        const deleteButton = nativeElement.querySelector(
            '.delete-btn'
        ) as HTMLButtonElement;
        const editButton = nativeElement.querySelector(
            '.edit-btn'
        ) as HTMLButtonElement;

        expect(component.isBusy()).toBe(true);
        expect(deleteButton.disabled).toBe(true);
        expect(editButton.disabled).toBe(true);
        expect(nativeElement.querySelector('.action-spinner')).not.toBeNull();

        component.onPlaylistClick();
        expect(emitSpy).not.toHaveBeenCalled();
    });

    describe('keyboard activation', () => {
        const row = () => fixture.nativeElement as HTMLElement;
        const activation = () =>
            row().querySelector('[role="button"]') as HTMLElement;
        const keydown = (target: HTMLElement, key: string) => {
            const event = new KeyboardEvent('keydown', {
                key,
                bubbles: true,
                cancelable: true,
            });
            target.dispatchEvent(event);
            return event;
        };

        it('is a Tab stop named after the source that Enter and Space open', () => {
            const emitSpy = jest.spyOn(component.playlistClicked, 'emit');
            const surface = activation();

            expect(surface).not.toBeNull();
            expect(surface.getAttribute('tabindex')).toBe('0');
            expect(surface.getAttribute('aria-label')).toBe('Playlist');

            const enter = keydown(surface, 'Enter');
            const space = keydown(surface, ' ');

            expect(emitSpy).toHaveBeenNthCalledWith(1, '1');
            expect(emitSpy).toHaveBeenNthCalledWith(2, '1');
            expect(enter.defaultPrevented).toBe(true);
            // Space must not scroll the page.
            expect(space.defaultPrevented).toBe(true);
        });

        it('keeps the drag handle and actions outside the activation element so their keys never open the source', () => {
            fixture.componentRef.setInput('isDraggable', true);
            fixture.detectChanges();
            const emitSpy = jest.spyOn(component.playlistClicked, 'emit');
            const editSpy = jest.spyOn(component.editPlaylistClicked, 'emit');
            const controls = Array.from(
                row().querySelectorAll<HTMLElement>(
                    '.action-buttons button, .drag-icon'
                )
            );

            expect(activation()).not.toBeNull();
            expect(controls.length).toBeGreaterThan(1);
            // No interactive control nested inside a role="button".
            for (const control of controls) {
                expect(control.closest('[role="button"]')).toBeNull();
            }

            const editButton = row().querySelector(
                '.edit-btn'
            ) as HTMLButtonElement;
            keydown(editButton, 'Enter');
            const space = keydown(editButton, ' ');
            editButton.click();

            // The button's own activation edits; the row must neither open
            // the source nor swallow the Space the button relies on.
            expect(emitSpy).not.toHaveBeenCalled();
            expect(space.defaultPrevented).toBe(false);
            expect(editSpy).toHaveBeenCalledTimes(1);
        });

        it('opens once for a pointer click anywhere on the row', () => {
            const emitSpy = jest.spyOn(component.playlistClicked, 'emit');

            activation().click();
            (row().querySelector('.playlist-item') as HTMLElement).click();
            (row().querySelector('.playlist-icon') as HTMLElement).click();

            expect(emitSpy).toHaveBeenCalledTimes(3);
        });

        it('announces the selected source and ignores keys while busy', () => {
            const emitSpy = jest.spyOn(component.playlistClicked, 'emit');
            expect(activation().hasAttribute('aria-current')).toBe(false);
            expect(activation().hasAttribute('aria-disabled')).toBe(false);

            fixture.componentRef.setInput('isSelected', true);
            fixture.componentRef.setInput('isRefreshing', true);
            fixture.detectChanges();

            expect(activation().getAttribute('aria-current')).toBe('true');
            expect(activation().getAttribute('aria-disabled')).toBe('true');
            // Still a Tab stop, so focus is not lost when a refresh starts.
            expect(activation().getAttribute('tabindex')).toBe('0');

            const space = keydown(activation(), ' ');
            keydown(activation(), 'Enter');

            expect(emitSpy).not.toHaveBeenCalled();
            expect(space.defaultPrevented).toBe(true);
        });

        it('falls back to the file name for the accessible name', () => {
            fixture.destroy();
            fixture = TestBed.createComponent(PlaylistItemComponent);
            fixture.componentInstance.item = {
                title: '',
                filename: 'channels.m3u',
                _id: 'file-source',
                count: 10,
                importDate: Date.now().toString(),
                autoRefresh: false,
            };
            fixture.detectChanges();

            expect(activation().getAttribute('aria-label')).toBe(
                'channels.m3u'
            );
        });
    });

    it('renders a refresh action for file-backed M3U playlists', () => {
        fixture.destroy();
        runtime.supportsPlaylistRefresh = true;
        fixture = TestBed.createComponent(PlaylistItemComponent);
        component = fixture.componentInstance;
        component.item = {
            title: 'Local Source',
            _id: 'local-source',
            count: 10,
            importDate: Date.now().toString(),
            autoRefresh: false,
            filePath: '/tmp/local-source.m3u',
        };
        fixture.detectChanges();

        const nativeElement = fixture.nativeElement as HTMLElement;

        expect(nativeElement.querySelector('.refresh-btn')).not.toBeNull();
    });

    it('hides file-backed M3U refresh without the refresh bridge', () => {
        fixture.destroy();
        runtime.supportsPlaylistRefresh = false;
        fixture = TestBed.createComponent(PlaylistItemComponent);
        component = fixture.componentInstance;
        component.item = {
            title: 'Local Source',
            _id: 'local-source',
            count: 10,
            importDate: Date.now().toString(),
            autoRefresh: false,
            filePath: '/tmp/local-source.m3u',
        };
        fixture.detectChanges();

        expect(
            (fixture.nativeElement as HTMLElement).querySelector('.refresh-btn')
        ).toBeNull();
    });

    it('keeps URL-backed M3U refresh visible without the refresh bridge', () => {
        fixture.destroy();
        runtime.supportsPlaylistRefresh = false;
        fixture = TestBed.createComponent(PlaylistItemComponent);
        component = fixture.componentInstance;
        component.item = {
            title: 'Remote Source',
            _id: 'remote-source',
            count: 10,
            importDate: Date.now().toString(),
            autoRefresh: false,
            url: 'https://example.com/playlist.m3u',
        };
        fixture.detectChanges();

        expect(
            (fixture.nativeElement as HTMLElement).querySelector('.refresh-btn')
        ).not.toBeNull();
    });

    it('renders the Xtream refresh action only when the SQLite data source is available', () => {
        fixture.destroy();
        runtime.supportsXtreamSqliteDataSource = true;
        fixture = TestBed.createComponent(PlaylistItemComponent);
        component = fixture.componentInstance;
        component.item = {
            title: 'Xtream Source',
            _id: 'xtream-source',
            count: 10,
            importDate: Date.now().toString(),
            autoRefresh: false,
            serverUrl: 'https://example.com',
            username: 'demo',
            password: 'secret',
        };
        fixture.detectChanges();

        expect(
            (fixture.nativeElement as HTMLElement).querySelector('.refresh-btn')
        ).not.toBeNull();

        fixture.destroy();
        runtime.supportsXtreamSqliteDataSource = false;
        fixture = TestBed.createComponent(PlaylistItemComponent);
        component = fixture.componentInstance;
        component.item = {
            title: 'Xtream Source',
            _id: 'xtream-source',
            count: 10,
            importDate: Date.now().toString(),
            autoRefresh: false,
            serverUrl: 'https://example.com',
            username: 'demo',
            password: 'secret',
        };
        fixture.detectChanges();

        expect(
            (fixture.nativeElement as HTMLElement).querySelector('.refresh-btn')
        ).toBeNull();
    });

    // OnPush: the status arrives after an await outside any template event,
    // so it must reach the view without a zone-triggered tick.
    it('renders the portal status that resolves after the first render', async () => {
        fixture.destroy();
        fixture = TestBed.createComponent(PlaylistItemComponent);
        component = fixture.componentInstance;
        component.item = {
            title: 'Xtream Source',
            _id: 'xtream-source',
            count: 10,
            importDate: Date.now().toString(),
            autoRefresh: false,
            serverUrl: 'https://example.com',
            username: 'demo',
            password: 'secret',
        };
        const translate = TestBed.inject(TranslateService);
        // Not English text, so the label must come from the keys.
        translate.setTranslation('en', {
            HOME: {
                PLAYLISTS: {
                    PORTAL_STATUS: 'Portalstatus: {{status}}',
                    PORTAL_STATUS_ACTIVE: 'aktiv',
                },
            },
        });
        translate.use('en');
        // The fixture renders on its own: a forced detectChanges() after the
        // await would hide a status that does not schedule a render.
        fixture.autoDetectChanges();
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));

        const statusDot = (fixture.nativeElement as HTMLElement).querySelector(
            '.status-dot'
        );
        expect(statusDot?.getAttribute('aria-label')).toBe(
            'Portalstatus: aktiv'
        );
    });

    it('renders cancel and progress UI for long-running playlist actions', () => {
        fixture.componentRef.setInput('isDeleting', true);
        fixture.componentRef.setInput(
            'busyMessage',
            'Removing cached content...'
        );
        fixture.componentRef.setInput('busyProgress', 42);
        fixture.componentRef.setInput('canCancelBusyAction', true);
        fixture.detectChanges();

        const nativeElement = fixture.nativeElement as HTMLElement;

        expect(
            nativeElement.querySelector('.busy-state__message')?.textContent
        ).toContain('Removing cached content...');
        expect(
            nativeElement.querySelector('.busy-state__value')?.textContent
        ).toContain('42%');
        expect(nativeElement.querySelector('.cancel-btn')).not.toBeNull();
    });

    it.each([
        [
            { macAddress: '00:1A:79:00:00:01', url: 'http://portal.test' },
            'cast',
            true,
        ],
        [{ macAddress: '00:1A:79:00:00:01' }, 'cast', false],
        [{ serverUrl: 'http://xtream.test' }, 'cloud', false],
        [{ url: 'http://list.test/playlist.m3u' }, 'link', true],
        [{}, 'description', true],
    ])(
        'shows one provider icon for %o (%s) and keeps the auto-refresh badge: %s',
        (source, icon, autoRefreshBadge) => {
            fixture.destroy();
            fixture = TestBed.createComponent(PlaylistItemComponent);
            fixture.componentInstance.item = {
                title: 'Source',
                _id: 'source',
                count: 10,
                importDate: Date.now().toString(),
                autoRefresh: true,
                ...source,
            };
            fixture.detectChanges();

            const row = fixture.nativeElement as HTMLElement;
            const icons = Array.from(
                row.querySelectorAll('.upload-type-icon'),
                (element) => element.textContent?.trim()
            );
            expect(icons).toEqual([icon]);
            expect(row.querySelector('.auto-refresh-indicator') !== null).toBe(
                autoRefreshBadge
            );
        }
    );
});
