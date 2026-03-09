import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';

import { MockModule } from 'ng-mocks';
import { TextImportComponent } from './text-import.component';

describe('TextImportComponent', () => {
    let component: TextImportComponent;
    let fixture: ComponentFixture<TextImportComponent>;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [
                TextImportComponent,
                MockModule(MatInputModule),
                MockModule(FormsModule),
                MockModule(ReactiveFormsModule),
                TranslateModule.forRoot(),
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(TextImportComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
