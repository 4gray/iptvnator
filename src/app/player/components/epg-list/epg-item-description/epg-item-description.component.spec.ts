import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { MockModule, MockPipe } from 'ng-mocks';
import { EpgProgram } from '../../../models/epg-program.model';
import { EpgItemDescriptionComponent } from './epg-item-description.component';

describe('EpgItemDescriptionComponent', () => {
    let component: EpgItemDescriptionComponent;
    let fixture: ComponentFixture<EpgItemDescriptionComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [
                    EpgItemDescriptionComponent,
                    MockPipe(TranslatePipe),
                ],
                imports: [MockModule(MatDialogModule)],
                providers: [{ provide: MAT_DIALOG_DATA, useValue: {} }],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(EpgItemDescriptionComponent);
        component = fixture.componentInstance;
        component.epgProgram = {} as EpgProgram;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render epg details in the dialog', () => {
        component.epgProgram = {
            title: [{ value: 'TV Show 1', lang: 'ru' }],
            desc: [{ value: 'Highly interesting show about pets' }],
            category: [{ value: 'Fun' }],
        } as EpgProgram;
        fixture.detectChanges();
        const title = fixture.debugElement.query(By.css('[data-test="title"]'));
        expect(title.nativeNode.innerHTML).toContain(
            component.epgProgram.title[0].value
        );
        const category = fixture.debugElement.query(
            By.css('[data-test="category"]')
        );
        expect(category.nativeNode.innerHTML).toContain(
            component.epgProgram.category[0].value
        );
        const desc = fixture.debugElement.query(By.css('[data-test="desc"]'));
        expect(desc.nativeNode.innerHTML).toContain(
            component.epgProgram.desc[0].value
        );
    });
});
