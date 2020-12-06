import { TestBed, async } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AppComponent } from './app.component';
import { TranslateModule } from '@ngx-translate/core';
import { ElectronService } from './services/electron.service';
import { ElectronServiceStub } from './home/home.component.spec';

jest.mock('custom-electron-titlebar', () => {
    return {
        Titlebar: jest.fn().mockImplementation(() => {
            return {};
        }),
        Color: {
            fromHex: jest.fn(),
        },
    };
});

describe('AppComponen t', () => {
    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [AppComponent],
            providers: [
                { provide: ElectronService, useClass: ElectronServiceStub },
            ],
            imports: [RouterTestingModule, TranslateModule.forRoot()],
        }).compileComponents();
    }));

    it('should create the app', async(() => {
        const fixture = TestBed.createComponent(AppComponent);
        const app = fixture.debugElement.componentInstance;
        expect(app).toBeTruthy();
    }));
});
