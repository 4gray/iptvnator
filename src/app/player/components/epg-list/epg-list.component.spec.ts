import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { EpgListComponent } from './epg-list.component';
import { MatListModule } from '@angular/material/list';
import { MockModule } from 'ng-mocks';
import { ElectronService } from 'app/services/electron.service';
import { ElectronServiceStub } from 'app/home/home.component.spec';

describe('EpgListComponent', () => {
    let component: EpgListComponent;
    let fixture: ComponentFixture<EpgListComponent>;

    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [EpgListComponent],
            imports: [MockModule(MatListModule)],
            providers: [
                { provide: ElectronService, useClass: ElectronServiceStub },
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(EpgListComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
