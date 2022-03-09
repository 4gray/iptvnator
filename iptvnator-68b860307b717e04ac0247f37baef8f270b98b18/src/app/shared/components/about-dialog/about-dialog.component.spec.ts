import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MockModule } from 'ng-mocks';
import { DataService } from '../../../services/data.service';
import { ElectronServiceStub } from '../../../services/electron.service.stub';
import { AboutDialogComponent } from './about-dialog.component';

describe('AboutDialogComponent', () => {
    let component: AboutDialogComponent;
    let fixture: ComponentFixture<AboutDialogComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [AboutDialogComponent],
            providers: [
                {
                    provide: DataService,
                    useClass: ElectronServiceStub,
                },
            ],
            imports: [MockModule(MatIconModule)],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(AboutDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
