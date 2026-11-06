import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SeasonTabsComponent } from './season-tabs.component';

describe('Season tabs keyboard navigation', () => {
    it('uses one stop and moves selection with arrows, Home and End', () => {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
        });
        const fixture = TestBed.createComponent(SeasonTabsComponent);
        fixture.componentRef.setInput('seasonKeys', ['1', '2', '3']);
        fixture.componentRef.setInput('selectedSeason', '2');
        fixture.detectChanges();
        const tabs = Array.from(
            fixture.nativeElement.querySelectorAll('[role="tab"]')
        ) as HTMLButtonElement[];
        const selected = jest.fn((key: string) => {
            fixture.componentRef.setInput('selectedSeason', key);
            fixture.detectChanges();
        });
        fixture.componentInstance.seasonSelected.subscribe(selected);
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
        tabs[1].focus();
        for (const [key, index] of [
            ['ArrowRight', 2],
            ['ArrowRight', 0],
            ['End', 2],
            ['Home', 0],
        ] as const) {
            tabs.find((tab) => tab === document.activeElement)!.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key,
                    bubbles: true,
                    cancelable: true,
                })
            );
            fixture.detectChanges();
            expect(document.activeElement).toBe(tabs[index]);
            expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([
                tabs[index],
            ]);
            expect(tabs[index].getAttribute('aria-selected')).toBe('true');
        }
        const modified = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        tabs[0].dispatchEvent(modified);
        expect(document.activeElement).toBe(tabs[0]);
        expect(modified.defaultPrevented).toBe(false);
        tabs[0].style.direction = 'rtl';
        tabs[0].dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowLeft',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(document.activeElement).toBe(tabs[1]);
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
        fixture.destroy();
    });
    it('keeps rapid keys ordered before the parent renders the selected input', () => {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
        });
        const fixture = TestBed.createComponent(SeasonTabsComponent);
        fixture.componentRef.setInput('seasonKeys', ['1', '2', '3']);
        fixture.componentRef.setInput('selectedSeason', '1');
        fixture.detectChanges();
        const tabs = Array.from(
            fixture.nativeElement.querySelectorAll('[role="tab"]')
        ) as HTMLButtonElement[];
        const selected = jest.fn();
        fixture.componentInstance.seasonSelected.subscribe(selected);
        tabs[0].dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'End',
                bubbles: true,
                cancelable: true,
            })
        );
        tabs[2].dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Home',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(selected.mock.calls).toEqual([['3'], ['1']]);
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
        expect(document.activeElement).toBe(tabs[0]);
        fixture.destroy();
    });
});
