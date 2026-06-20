import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { SearchLayoutComponent } from './search-layout.component';

describe('SearchLayoutComponent', () => {
    let fixture: ComponentFixture<SearchLayoutComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SearchLayoutComponent],
        })
            .overrideComponent(SearchLayoutComponent, {
                remove: { imports: [TranslatePipe] },
                add: {
                    imports: [
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(SearchLayoutComponent);
    });

    function renderResultsContainer(): HTMLElement {
        fixture.componentRef.setInput('searchTerm', 'matrix');
        fixture.componentRef.setInput('resultsCount', 1);
        fixture.detectChanges();

        return fixture.debugElement.query(By.css('.results-container'))
            .nativeElement as HTMLElement;
    }

    function setScrollMetrics(
        element: HTMLElement,
        scrollTop: number,
        scrollHeight = 1000,
        clientHeight = 120
    ): void {
        Object.defineProperties(element, {
            scrollHeight: {
                configurable: true,
                value: scrollHeight,
            },
            scrollTop: {
                configurable: true,
                value: scrollTop,
            },
            clientHeight: {
                configurable: true,
                value: clientHeight,
            },
        });
    }

    it('emits nearEnd when the results container is scrolled near the bottom', () => {
        const nearEndSpy = jest.fn();
        fixture.componentInstance.nearEnd.subscribe(nearEndSpy);
        const resultsContainer = renderResultsContainer();

        setScrollMetrics(resultsContainer, 700);

        resultsContainer.dispatchEvent(new Event('scroll'));

        expect(nearEndSpy).toHaveBeenCalledTimes(1);
    });

    it('emits nearEnd only when crossing into the bottom threshold', () => {
        const nearEndSpy = jest.fn();
        fixture.componentInstance.nearEnd.subscribe(nearEndSpy);
        const resultsContainer = renderResultsContainer();

        setScrollMetrics(resultsContainer, 500);
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).not.toHaveBeenCalled();

        setScrollMetrics(resultsContainer, 700);
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).toHaveBeenCalledTimes(1);

        setScrollMetrics(resultsContainer, 710);
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).toHaveBeenCalledTimes(1);

        setScrollMetrics(resultsContainer, 500);
        resultsContainer.dispatchEvent(new Event('scroll'));
        setScrollMetrics(resultsContainer, 760);
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).toHaveBeenCalledTimes(2);
    });
});
