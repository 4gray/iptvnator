import { MatCheckboxModule } from '@angular/material/checkbox';
/* eslint-disable @typescript-eslint/unbound-method */
import { DatePipe } from '@angular/common';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import {
    FormsModule,
    ReactiveFormsModule,
    UntypedFormBuilder,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockModule, MockPipe, MockProvider } from 'ng-mocks';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { Observable } from 'rxjs';
import { DataService } from '../../../services/data.service';
import { ElectronServiceStub } from '../../../services/electron.service.stub';
import { Playlist } from './../../../../../shared/playlist.interface';
import { PlaylistInfoComponent } from './playlist-info.component';

describe('PlaylistInfoComponent', () => {
    let component: PlaylistInfoComponent;
    let fixture: ComponentFixture<PlaylistInfoComponent>;
    let mockStore: MockStore;
    const actions$ = new Observable<Actions>();

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                imports: [
                    FormsModule,
                    MockModule(MatDialogModule),
                    MockModule(MatCheckboxModule),
                    MockModule(MatFormFieldModule),
                    MockModule(TranslateModule),
                    ReactiveFormsModule,
                ],
                declarations: [PlaylistInfoComponent, MockPipe(DatePipe)],
                providers: [
                    { provide: MAT_DIALOG_DATA, useValue: {} },
                    { provide: DataService, useClass: ElectronServiceStub },
                    UntypedFormBuilder,
                    provideMockStore(),
                    provideMockActions(actions$),
                    MockProvider(NgxIndexedDBService),
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(PlaylistInfoComponent);
        component = fixture.componentInstance;
        mockStore = TestBed.inject(MockStore);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should dispatch an event to save changes in the store', () => {
        const playlistToSave = { _id: 'a12345', title: 'Playlist' } as Playlist;
        jest.spyOn(mockStore, 'dispatch');
        component.saveChanges(playlistToSave);
        expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
    });
});
