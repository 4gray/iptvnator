import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { MockModule } from 'ng-mocks';
import { PortalStatusService } from '@iptvnator/services';
import { PlaylistItemComponent } from './playlist-item.component';

describe('PlaylistItemComponent', () => {
    let component: PlaylistItemComponent;
    let fixture: ComponentFixture<PlaylistItemComponent>;

    beforeEach(waitForAsync(() => {
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

    it('renders a refresh action for file-backed M3U playlists', () => {
        fixture.destroy();
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

    it('renders cancel and progress UI for long-running playlist actions', () => {
        fixture.componentRef.setInput('isDeleting', true);
        fixture.componentRef.setInput('busyMessage', 'Removing cached content...');
        fixture.componentRef.setInput('busyProgress', 42);
        fixture.componentRef.setInput('canCancelBusyAction', true);
        fixture.detectChanges();

        const nativeElement = fixture.nativeElement as HTMLElement;

        expect(nativeElement.querySelector('.busy-state__message')?.textContent).toContain(
            'Removing cached content...'
        );
        expect(nativeElement.querySelector('.busy-state__value')?.textContent).toContain(
            '42%'
        );
        expect(nativeElement.querySelector('.cancel-btn')).not.toBeNull();
    });
});
