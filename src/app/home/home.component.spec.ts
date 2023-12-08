import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterTestingModule } from '@angular/router/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
    TranslateModule,
    TranslatePipe,
    TranslateService,
} from '@ngx-translate/core';
import { MockComponent, MockModule, MockPipe, MockProvider } from 'ng-mocks';
import { NgxIndexedDBModule, NgxIndexedDBService } from 'ngx-indexed-db';
import { Observable } from 'rxjs';
import { FileUploadComponent } from '../home/file-upload/file-upload.component';
import { RecentPlaylistsComponent } from '../home/recent-playlists/recent-playlists.component';
import { UrlUploadComponent } from '../home/url-upload/url-upload.component';
import { DataService } from '../services/data.service';
import { ElectronServiceStub } from '../services/electron.service.stub';
import { HeaderComponent } from '../shared/components/header/header.component';
import { HomeComponent } from './home.component';

describe('HomeComponent', () => {
    let component: HomeComponent;
    let fixture: ComponentFixture<HomeComponent>;
    let electronService: DataService;
    let mockStore: MockStore;
    const actions$ = new Observable<Actions>();

    beforeEach(() => {
        TestBed.configureTestingModule({
            declarations: [
                HomeComponent,
                MockComponent(HeaderComponent),
                MockComponent(FileUploadComponent),
                MockComponent(RecentPlaylistsComponent),
                MockComponent(UrlUploadComponent),
                MockPipe(TranslatePipe),
            ],
            imports: [
                MockModule(MatTabsModule),
                MockModule(MatIconModule),
                MockModule(MatProgressBarModule),
                MockModule(MatSnackBarModule),
                MockModule(RouterTestingModule),
                MockModule(NgxIndexedDBModule),
                MockModule(TranslateModule),
            ],
            providers: [
                MockProvider(MatSnackBar),
                { provide: DataService, useClass: ElectronServiceStub },
                MockProvider(TranslateService),
                MockProvider(NgxIndexedDBService),
                provideMockStore(),
                provideMockActions(actions$),
            ],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(DataService);

        mockStore = TestBed.inject(MockStore);
        mockStore.setState({});

        TestBed.inject(NgxIndexedDBService);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should set IPC event listeners', () => {
        jest.spyOn(electronService, 'listenOn');
        component.setRendererListeners();
        expect(electronService.listenOn).toHaveBeenCalledTimes(
            component.commandsList.length
        );
    });

    it('should remove all ipc listeners on destroy', () => {
        jest.spyOn(electronService, 'removeAllListeners');
        component.ngOnDestroy();
        expect(electronService.removeAllListeners).toHaveBeenCalledTimes(
            component.commandsList.length
        );
    });
});
