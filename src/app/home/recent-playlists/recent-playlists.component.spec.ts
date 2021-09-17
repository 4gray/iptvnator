import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MockModule, MockPipe, MockProvider } from 'ng-mocks';
import { ElectronService } from '../../services/electron.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RecentPlaylistsComponent } from './recent-playlists.component';
import { PlaylistMeta } from '../home.component';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';

export class ElectronServiceStub {
    sendIpcEvent(): void {}
}

describe('RecentPlaylistsComponent', () => {
    let component: RecentPlaylistsComponent;
    let fixture: ComponentFixture<RecentPlaylistsComponent>;
    let electronService: ElectronService;
    let dialog: MatDialog;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [
                    RecentPlaylistsComponent,
                    MockPipe(TranslatePipe),
                ],
                imports: [
                    MockModule(MatDialogModule),
                    MockModule(MatListModule),
                    MockModule(MatIconModule),
                    MockModule(MatTooltipModule),
                ],
                providers: [
                    { provide: ElectronService, useClass: ElectronServiceStub },
                    MockProvider(TranslateService),
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(RecentPlaylistsComponent);
        component = fixture.componentInstance;
        component.playlists = [];
        dialog = TestBed.inject(MatDialog);
        electronService = TestBed.inject(ElectronService);
        TestBed.inject(ElectronService);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should open the info dialog', () => {
        spyOn(dialog, 'open');
        component.openInfoDialog({} as PlaylistMeta);
        expect(dialog.open).toHaveBeenCalledTimes(1);
    });

    it('should send an ipc event after drop event', () => {
        const event = {
            previousIndex: 0,
            currentIndex: 1,
            item: undefined,
            container: undefined,
            previousContainer: undefined,
            isPointerOverContainer: true,
            distance: { x: 0, y: 0 },
            dropPoint: { x: 0, y: 0 },
        };
        spyOn(electronService, 'sendIpcEvent');
        component.drop(event);
        expect(electronService.sendIpcEvent).toHaveBeenCalledTimes(1);
    });
});
