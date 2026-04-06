import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { MockModule } from 'ng-mocks';
import { EpgProgram } from 'shared-interfaces';
import { EpgItemDescriptionComponent } from './epg-item-description.component';

describe('EpgItemDescriptionComponent', () => {
    let component: EpgItemDescriptionComponent;
    let fixture: ComponentFixture<EpgItemDescriptionComponent>;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [
                EpgItemDescriptionComponent,
                MockModule(MatDialogModule),
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        start: '2026-04-05T11:30:00.000Z',
                        stop: '2026-04-05T12:30:00.000Z',
                        title: 'TV Show 1',
                        desc: 'Highly interesting show about pets',
                        category: 'Fun',
                    } as unknown as EpgProgram,
                },
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(EpgItemDescriptionComponent);
        component = fixture.componentInstance;
        component.epgProgram = TestBed.inject(MAT_DIALOG_DATA);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render epg details in the dialog', () => {
        fixture.detectChanges();
        const titleElement = fixture.debugElement.query(
            By.css('.program-title')
        );
        expect(titleElement.nativeElement.textContent.trim()).toContain(
            'TV Show 1'
        );

        const categoryElement = fixture.debugElement.query(
            By.css('.category-tag')
        );
        expect(categoryElement.nativeElement.textContent.trim()).toContain(
            'Fun'
        );

        const descElement = fixture.debugElement.query(
            By.css('.program-description')
        );
        expect(descElement.nativeElement.textContent.trim()).toContain(
            'Highly interesting show about pets'
        );
    });
});
