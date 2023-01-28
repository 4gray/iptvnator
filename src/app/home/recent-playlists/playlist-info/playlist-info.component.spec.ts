import { MatCheckboxModule } from '@angular/material/checkbox';
import { PLAYLIST_SAVE_DETAILS } from './../../../../../shared/ipc-commands';
/* eslint-disable @typescript-eslint/unbound-method */
import { DatePipe } from '@angular/common';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import {
    FormsModule,
    ReactiveFormsModule,
    UntypedFormBuilder,
} from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { TranslateModule } from '@ngx-translate/core';
import { MockModule, MockPipe } from 'ng-mocks';
import { DataService } from '../../../services/data.service';
import { ElectronServiceStub } from '../../../services/electron.service.stub';
import { Playlist } from './../../../../../shared/playlist.interface';
import { PlaylistInfoComponent } from './playlist-info.component';

describe('PlaylistInfoComponent', () => {
    let component: PlaylistInfoComponent;
    let fixture: ComponentFixture<PlaylistInfoComponent>;
    let electronService: DataService;

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
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(PlaylistInfoComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(DataService);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should send an event to the main process after save', () => {
        const playlistToSave = { _id: 'a12345', title: 'Playlist' } as Playlist;
        jest.spyOn(electronService, 'sendIpcEvent');
        component.saveChanges(playlistToSave);
        expect(electronService.sendIpcEvent).toHaveBeenCalledTimes(1);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_SAVE_DETAILS,
            playlistToSave
        );
    });
});
