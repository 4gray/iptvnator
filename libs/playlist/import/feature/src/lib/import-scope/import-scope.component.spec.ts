import { signal } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatCheckbox } from '@angular/material/checkbox';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import { ImportScopeComponent } from './import-scope.component';

describe('ImportScopeComponent', () => {
    let component: ImportScopeComponent;
    let fixture: ComponentFixture<ImportScopeComponent>;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [ImportScopeComponent, TranslateModule.forRoot()],
            providers: [provideNoopAnimations()],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(ImportScopeComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('starts with both sections enabled', () => {
        expect(component.importLive()).toBe(true);
        expect(component.importVod()).toBe(true);
    });

    it('toggles one section off while the other stays on', () => {
        component.importVod.set(false);
        fixture.detectChanges();

        expect(component.importLive()).toBe(true);
        expect(component.importVod()).toBe(false);
    });

    it('disables the last checked box instead of letting it clear', () => {
        component.importVod.set(false);
        fixture.detectChanges();

        const boxes = fixture.debugElement.queryAll(By.directive(MatCheckbox));
        expect(boxes).toHaveLength(2);
        // A vetoed uncheck would desync the natively toggled checkbox from
        // the state (Angular skips same-value binding writes), so the box
        // is disabled while it is the only one keeping the source alive.
        expect(boxes[0].componentInstance.disabled).toBe(true);
        expect(boxes[1].componentInstance.disabled).toBe(false);
    });
});

describe('ImportScopeComponent while VOD is disabled globally', () => {
    it('shows and locks a live-only scope but keeps the source choice', async () => {
        await TestBed.configureTestingModule({
            imports: [ImportScopeComponent, TranslateModule.forRoot()],
            providers: [
                provideNoopAnimations(),
                {
                    provide: SettingsStore,
                    useValue: { disableVod: signal(true) },
                },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(ImportScopeComponent);
        fixture.detectChanges();

        const boxes = fixture.debugElement
            .queryAll(By.directive(MatCheckbox))
            .map((box) => box.componentInstance as MatCheckbox);
        expect(boxes.map((box) => box.checked)).toEqual([true, false]);
        expect(boxes.map((box) => box.disabled)).toEqual([true, true]);
        expect(fixture.nativeElement.textContent).toContain(
            'HOME.ADD_PLAYLIST.IMPORT_SCOPE_VOD_DISABLED'
        );
        // Not written to the source: turning the setting off restores VOD.
        expect(fixture.componentInstance.importVod()).toBe(true);
    });
});
