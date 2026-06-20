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

    it('emits nearEnd when the results container is scrolled near the bottom', () => {
        const nearEndSpy = jest.fn();
        fixture.componentRef.setInput('searchTerm', 'matrix');
        fixture.componentRef.setInput('resultsCount', 1);
        fixture.componentInstance.nearEnd.subscribe(nearEndSpy);
        fixture.detectChanges();

        const resultsContainer = fixture.debugElement.query(
            By.css('.results-container')
        ).nativeElement as HTMLElement;
        Object.defineProperties(resultsContainer, {
            scrollHeight: {
                configurable: true,
                value: 1000,
            },
            scrollTop: {
                configurable: true,
                value: 700,
            },
            clientHeight: {
                configurable: true,
                value: 120,
            },
        });

        resultsContainer.dispatchEvent(new Event('scroll'));

        expect(nearEndSpy).toHaveBeenCalledTimes(1);
    });
});
