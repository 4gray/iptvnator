import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

import { MockModule, MockPipe } from 'ng-mocks';
import { TextImportComponent } from './text-import.component';

describe('TextImportComponent', () => {
    let component: TextImportComponent;
    let fixture: ComponentFixture<TextImportComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [TextImportComponent, MockPipe(TranslatePipe)],
                imports: [
                    MockModule(MatInputModule),
                    MockModule(FormsModule),
                    MockModule(ReactiveFormsModule),
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(TextImportComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
