import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { FileUploadComponent } from './file-upload.component';
import { MatIconModule } from '@angular/material/icon';
import { MockModule } from 'ng-mocks';
import { NgxUploaderModule } from 'ngx-uploader';

describe('FileUploadComponent', () => {
    let component: FileUploadComponent;
    let fixture: ComponentFixture<FileUploadComponent>;

    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [FileUploadComponent],
            imports: [MockModule(MatIconModule), NgxUploaderModule],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(FileUploadComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
