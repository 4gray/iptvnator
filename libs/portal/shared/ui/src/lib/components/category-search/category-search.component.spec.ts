import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { CategorySearchComponent } from './category-search.component';

describe('CategorySearchComponent', () => {
    let fixture: ComponentFixture<CategorySearchComponent>;
    let component: CategorySearchComponent;
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [CategorySearchComponent, TranslateModule.forRoot()],
        }).compileComponents();
        fixture = TestBed.createComponent(CategorySearchComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });
    it('uses AND by default and normalizes exclusion prefixes from the controls', () => {
        expect(component.mode()).toBe('all');
        const inputs = fixture.nativeElement.querySelectorAll('input');
        inputs[0].value = 'France Canada';
        inputs[0].dispatchEvent(new Event('input'));
        inputs[1].value = '-"Spanish Dub"';
        inputs[1].dispatchEvent(new Event('input'));
        const select = fixture.nativeElement.querySelector('select');
        select.value = 'any';
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        expect(component.keywords()).toEqual(['France', 'Canada']);
        expect(component.excludedKeywords()).toEqual(['Spanish Dub']);
        expect(component.mode()).toBe('any');
        expect(fixture.nativeElement.querySelectorAll('.keyword')).toHaveLength(
            3
        );
    });
    it.each([
        ['ES', 'ES'],
        ['-ES', 'ES'],
        ['"Spanish Dub"', 'Spanish Dub'],
        ['-"Spanish Dub"', 'Spanish Dub'],
    ])('normalizes the separate exclusion input %s', (query, expected) => {
        const input = fixture.nativeElement.querySelectorAll('input')[1];
        input.value = query;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        expect(component.excludedKeywords()).toEqual([expected]);
    });
    it('removes a chip without splitting remaining phrases and clears all controls', () => {
        component.query.set('France "Canada français"');
        component.exclusions.set('4K HD');
        component.mode.set('any');
        fixture.detectChanges();
        fixture.nativeElement.querySelector('.keyword').click();
        expect(component.query()).toBe('"Canada français"');
        component.remove(0, true);
        expect(component.exclusions()).toBe('HD');
        component.clear();
        fixture.detectChanges();
        expect(component.query()).toBe('');
        expect(component.exclusions()).toBe('');
        expect(component.mode()).toBe('all');
        expect(fixture.nativeElement.querySelectorAll('.keyword')).toHaveLength(
            0
        );
    });
});
