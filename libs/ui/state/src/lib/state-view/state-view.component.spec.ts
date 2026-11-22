import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    STATE_VIEW_DEFAULT_ICONS,
    StateViewComponent,
} from './state-view.component';

describe('StateViewComponent', () => {
    let fixture: ComponentFixture<StateViewComponent>;
    let host: HTMLElement;

    const buttons = () =>
        Array.from(host.querySelectorAll<HTMLButtonElement>('button'));

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [StateViewComponent, TranslateModule.forRoot()],
        });
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', { RETRY: 'Retry' });
        translate.use('en');
        fixture = TestBed.createComponent(StateViewComponent);
        host = fixture.nativeElement;
        fixture.componentRef.setInput('heading', 'Nothing here');
    });

    it('renders the heading, the description and the default icon', () => {
        fixture.componentRef.setInput('description', 'Add a source.');
        fixture.detectChanges();

        expect(host.querySelector('h2')?.textContent?.trim()).toBe(
            'Nothing here'
        );
        expect(
            host.querySelector('.app-state-view__description')?.textContent
        ).toContain('Add a source.');
        expect(host.querySelector('mat-icon')?.textContent?.trim()).toBe(
            STATE_VIEW_DEFAULT_ICONS.empty
        );
        expect(host.querySelector('[role="status"]')).not.toBeNull();
        expect(buttons()).toHaveLength(0);
    });

    it('uses a level-3 heading and the panel class in a panel', () => {
        fixture.componentRef.setInput('size', 'panel');
        fixture.detectChanges();

        expect(host.querySelector('h3')).not.toBeNull();
        expect(host.classList).toContain('app-state-view--panel');
    });

    it('leads an error with Retry and emits retry', () => {
        const retry = jest.fn();
        const action = jest.fn();
        fixture.componentInstance.retry.subscribe(retry);
        fixture.componentInstance.action.subscribe(action);
        fixture.componentRef.setInput('variant', 'error');
        fixture.componentRef.setInput('retryable', true);
        fixture.componentRef.setInput('actionLabel', 'Open settings');
        fixture.detectChanges();

        const [first, second] = buttons();
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(host.classList).toContain('app-state-view--warn');
        expect(first.textContent).toContain('Retry');
        expect(first.classList).toContain('app-state-view__button--accent');
        expect(second.textContent).toContain('Open settings');
        expect(second.classList).not.toContain(
            'app-state-view__button--accent'
        );

        first.click();
        second.click();
        expect(retry).toHaveBeenCalledTimes(1);
        expect(action).toHaveBeenCalledTimes(1);
    });

    it('offers Retry only on error and offline states', () => {
        fixture.componentRef.setInput('variant', 'no-results');
        fixture.componentRef.setInput('retryable', true);
        fixture.detectChanges();
        expect(buttons()).toHaveLength(0);

        fixture.componentRef.setInput('variant', 'offline');
        fixture.detectChanges();
        expect(buttons()[0].dataset['stateAction']).toBe('retry');
        expect(host.querySelector('mat-icon')?.textContent?.trim()).toBe(
            'cloud_off'
        );
    });

    it('shows at most two actions', () => {
        const secondary = jest.fn();
        fixture.componentInstance.secondaryAction.subscribe(secondary);
        fixture.componentRef.setInput('variant', 'error');
        fixture.componentRef.setInput('retryable', true);
        fixture.componentRef.setInput('actionLabel', 'One');
        fixture.componentRef.setInput('secondaryLabel', 'Two');
        fixture.detectChanges();

        expect(buttons().map((b) => b.dataset['stateAction'])).toEqual([
            'retry',
            'action',
        ]);

        fixture.componentRef.setInput('retryable', false);
        fixture.detectChanges();
        buttons()[1].click();
        expect(secondary).toHaveBeenCalledTimes(1);
    });
});
