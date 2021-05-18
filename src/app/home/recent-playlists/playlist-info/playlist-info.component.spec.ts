import { MatCheckboxModule } from '@angular/material/checkbox';
import { PLAYLIST_SAVE_DETAILS } from './../../../../../ipc-commands';
/* eslint-disable @typescript-eslint/unbound-method */
import { ElectronServiceStub } from './../../home.component.spec';
import { ElectronService } from './../../../services/electron.service';
import { TranslatePipe } from '@ngx-translate/core';
import { MockModule, MockPipe } from 'ng-mocks';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { DatePipe } from '@angular/common';
import { PlaylistInfoComponent } from './playlist-info.component';
import { FormsModule, ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { Playlist } from '../../playlist.interface';

describe('PlaylistInfoComponent', () => {
    let component: PlaylistInfoComponent;
    let fixture: ComponentFixture<PlaylistInfoComponent>;
    let electronService: ElectronService;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                imports: [
                    FormsModule,
                    MockModule(MatDialogModule),
                    MockModule(MatCheckboxModule),
                    MockModule(MatFormFieldModule),
                    ReactiveFormsModule,
                ],
                declarations: [
                    PlaylistInfoComponent,
                    MockPipe(TranslatePipe),
                    MockPipe(DatePipe),
                ],
                providers: [
                    { provide: MAT_DIALOG_DATA, useValue: {} },
                    { provide: ElectronService, useClass: ElectronServiceStub },
                    FormBuilder,
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(PlaylistInfoComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(ElectronService);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should send an event to the main process after save', () => {
        const playlistToSave = { _id: 'a12345', title: 'Playlist' } as Playlist;
        spyOn(electronService.ipcRenderer, 'send');
        component.saveChanges(playlistToSave);
        expect(electronService.ipcRenderer.send).toHaveBeenCalledTimes(1);
        expect(electronService.ipcRenderer.send).toHaveBeenCalledWith(
            PLAYLIST_SAVE_DETAILS,
            playlistToSave
        );
    });
});
