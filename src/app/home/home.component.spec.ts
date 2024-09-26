import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MockComponent, MockModule, MockProvider } from 'ng-mocks';
import { Observable } from 'rxjs';
import { DataService } from '../services/data.service';
import { ElectronServiceStub } from '../services/electron.service.stub';
import { HomeComponent } from './home.component';
import { RecentPlaylistsComponent } from './recent-playlists/recent-playlists.component';

describe('HomeComponent', () => {
    let component: HomeComponent;
    let fixture: ComponentFixture<HomeComponent>;
    let electronService: DataService;
    let mockStore: MockStore;
    const actions$ = new Observable<Actions>();

    beforeEach(() => {
        TestBed.configureTestingModule({
            declarations: [HomeComponent],
            imports: [
                CommonModule,
                MockComponent(RecentPlaylistsComponent),
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
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(DataService);

        mockStore = TestBed.inject(MockStore);
        mockStore.setState({});
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
