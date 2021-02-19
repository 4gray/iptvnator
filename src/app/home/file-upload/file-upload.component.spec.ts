import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { FileUploadComponent } from './file-upload.component';
import { MatIconModule } from '@angular/material/icon';
import { MockModule, MockPipe } from 'ng-mocks';
import { NgxUploaderModule } from 'ngx-uploader';
import { TranslateServiceStub } from '../../../testing/translate.stub';

describe('FileUploadComponent', () => {
    let component: FileUploadComponent;
    let fixture: ComponentFixture<FileUploadComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [FileUploadComponent, MockPipe(TranslatePipe)],
                imports: [MockModule(MatIconModule), NgxUploaderModule],
                providers: [
                    {
                        provide: TranslateService,
                        useClass: TranslateServiceStub,
                    },
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(FileUploadComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
