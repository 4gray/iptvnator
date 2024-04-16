import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MockComponents, MockModule, MockProvider } from 'ng-mocks';
import { Observable } from 'rxjs';
import { RecentPlaylistsComponent } from '../home/recent-playlists/recent-playlists.component';
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

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            declarations: [
                HomeComponent,
                MockComponents(HeaderComponent, RecentPlaylistsComponent),
            ],
            imports: [
                MockModule(MatProgressBarModule),
                MockModule(MatSnackBarModule),
                MockModule(TranslateModule),
                MockModule(RouterModule),
                MockModule(MatDialogModule),
            ],
            providers: [
                MockProvider(ActivatedRoute, {
                    snapshot: { component: '' } as any,
                }),
                MockProvider(TranslateService),
                MockProvider(MatSnackBar),
                { provide: DataService, useClass: ElectronServiceStub },
                provideMockStore(),
                provideMockActions(actions$),
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(DataService);

        mockStore = TestBed.inject(MockStore);
        mockStore.setState({});

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
