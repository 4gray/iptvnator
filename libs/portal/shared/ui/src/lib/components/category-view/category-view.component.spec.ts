import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { CategoryViewComponent } from './category-view.component';

describe('CategoryViewComponent rail scrolling', () => {
    let fixture: ComponentFixture<CategoryViewComponent>;

    const items = [
        { category_id: '1', category_name: 'Alpha' },
        { category_id: '2', category_name: 'Middle' },
        { category_id: '3', category_name: 'Zulu' },
    ];

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                CategoryViewComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(CategoryViewComponent);
        fixture.componentRef.setInput('items', items);
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    function mockRailGeometry(rowTops: number[]): {
        container: HTMLElement;
        scrollTo: jest.Mock;
    } {
        const container = fixture.nativeElement as HTMLElement;
        Object.defineProperties(container, {
            clientHeight: { value: 400 },
            scrollHeight: { value: 3000 },
        });
        container.scrollTop = 500;
        container.getBoundingClientRect = () =>
            new DOMRect(0, 100, 200, 400);
        const scrollTo = jest.fn();
        container.scrollTo = scrollTo;
        const rows = Array.from(
            container.querySelectorAll<HTMLElement>('.category-item')
        );
        rows.forEach((row, index) => {
            row.getBoundingClientRect = () =>
                new DOMRect(0, rowTops[index] ?? 150, 200, 40);
        });
        return { container, scrollTo };
    }

    it('only stops any in-flight scroll when the selected category is already fully visible', async () => {
        const { scrollTo } = mockRailGeometry([150, 250, 350]);

        fixture.componentRef.setInput('selectedCategoryId', '2');
        fixture.detectChanges();
        await fixture.whenStable();

        expect(scrollTo).toHaveBeenCalledWith({
            behavior: 'instant',
            top: 500,
        });
        expect(scrollTo).not.toHaveBeenCalledWith(
            expect.objectContaining({ behavior: 'smooth' })
        );
    });

    it('centres the selected category when it is off-screen', async () => {
        const { scrollTo } = mockRailGeometry([150, 250, 2200]);

        fixture.componentRef.setInput('selectedCategoryId', '3');
        fixture.detectChanges();
        await fixture.whenStable();

        expect(scrollTo).toHaveBeenCalledWith({
            behavior: 'smooth',
            top: 2420,
        });
    });
});
