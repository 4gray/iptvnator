import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MockComponent, MockModule } from 'ng-mocks';
import { HomeComponent } from './home.component';
import { HeaderComponent } from '../shared/components/header/header.component';
import { RecentPlaylistsComponent } from '../home/recent-playlists/recent-playlists.component';
import { FileUploadComponent } from '../home/file-upload/file-upload.component';
import { UrlUploadComponent } from '../home/url-upload/url-upload.component';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ElectronService } from '../services/electron.service';

class MatSnackBarStub {
    open(): void {}
}

export class ElectronServiceStub {
    ipcRenderer = {
        send: jest.fn(),
        on: jest.fn(),
    };
    remote = {
        process: {
            platform: 'linux',
            argv: [0, 1],
        },
    };
}

describe('HomeComponent', () => {
    let component: HomeComponent;
    let fixture: ComponentFixture<HomeComponent>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            declarations: [
                HomeComponent,
                MockComponent(HeaderComponent),
                MockComponent(FileUploadComponent),
                MockComponent(RecentPlaylistsComponent),
                MockComponent(UrlUploadComponent),
            ],
            imports: [
                MockModule(MatTabsModule),
                MockModule(MatIconModule),
                MockModule(MatProgressBarModule),
                MockModule(MatSnackBarModule),
                RouterTestingModule,
            ],
            providers: [
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: ElectronService, useClass: ElectronServiceStub },
            ],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        TestBed.inject(ElectronService);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
