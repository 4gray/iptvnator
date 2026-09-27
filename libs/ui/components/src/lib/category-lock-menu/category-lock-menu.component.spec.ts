import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { CategoryLockMenuComponent } from './category-lock-menu.component';

@Component({
    imports: [CategoryLockMenuComponent],
    template: `<app-category-lock-menu
        (toggleRequested)="requested.push($event)"
    />`,
})
class HostComponent {
    readonly menu = viewChild.required(CategoryLockMenuComponent);
    readonly requested: boolean[] = [];
}

describe('CategoryLockMenuComponent', () => {
    it('opens at the pointer and requests the opposite lock state', async () => {
        await TestBed.configureTestingModule({
            imports: [
                HostComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        const host = fixture.componentInstance;
        const event = new MouseEvent('contextmenu', {
            clientX: 40,
            clientY: 60,
            cancelable: true,
        });

        host.menu().open(event, true);
        await Promise.resolve();
        fixture.detectChanges();

        expect(event.defaultPrevented).toBe(true);
        expect(host.menu().position()).toEqual({ x: '40px', y: '60px' });
        const item = document.querySelector<HTMLButtonElement>(
            '[data-test-id="category-lock-menu-toggle"]'
        );
        expect(item?.textContent).toContain('PARENTAL_LOCK.UNLOCK_CATEGORY');
        item?.click();
        expect(host.requested).toEqual([false]);
    });
});
