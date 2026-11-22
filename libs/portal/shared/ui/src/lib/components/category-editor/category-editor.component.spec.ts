import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    CategoryEditorComponent,
    CategoryEditorRow,
} from './category-editor.component';

describe('CategoryEditorComponent', () => {
    let fixture: ComponentFixture<CategoryEditorComponent<CategoryEditorRow>>;
    let editor: CategoryEditorComponent<CategoryEditorRow>;
    let root: HTMLElement;
    const rows = [
        {
            id: '01',
            providerId: '01',
            name: 'Café',
            selected: true,
            lockedDraft: false,
        },
        {
            id: '1',
            providerId: '1',
            name: 'Studio',
            selected: true,
            lockedDraft: false,
            censored: true,
            count: 0,
        },
    ];

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [CategoryEditorComponent, TranslateModule.forRoot()],
        });
        fixture = TestBed.createComponent(CategoryEditorComponent);
        editor = fixture.componentInstance;
        root = fixture.nativeElement;
        fixture.componentRef.setInput('categories', rows);
        fixture.componentRef.setInput('subtitle', 'Categories');
        fixture.detectChanges();
    });

    function search(text: string) {
        const input =
            root.querySelector<HTMLInputElement>('input[type=search]')!;
        input.value = text;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
    }

    function button(label: string) {
        const result = Array.from(root.querySelectorAll('button')).find(
            (item) => item.textContent?.trim() === label
        );
        if (!result) throw new Error('Missing button ' + label);
        return result;
    }

    it('applies bulk visibility only to search matches and retains the draft when search is cleared', () => {
        const select = 'XTREAM.CATEGORY_MANAGEMENT.SELECT_FILTERED';
        const deselect = 'XTREAM.CATEGORY_MANAGEMENT.DESELECT_FILTERED';
        search('CAFÉ');
        expect(root.querySelectorAll('.category-item')).toHaveLength(1);
        expect(button(select).disabled).toBe(true);
        button(deselect).click();
        fixture.detectChanges();
        expect(editor.categories().map((row) => row.selected)).toEqual([
            false,
            true,
        ]);
        expect(button(deselect).disabled).toBe(true);
        button(select).click();
        fixture.detectChanges();
        expect(editor.selectedCount()).toBe(2);

        search('unknown');
        expect(root.querySelector('.empty-message')?.textContent).toContain(
            'NO_RESULTS'
        );
        expect(button(select).disabled).toBe(true);
        root.querySelector<HTMLButtonElement>('.search-inline__clear')!.click();
        fixture.detectChanges();
        expect(root.querySelectorAll('.category-item')).toHaveLength(2);
        expect(root.querySelector('.item-count')?.textContent).toContain('(0)');
    });

    it('keeps row selection independent of individual and bulk locks', () => {
        fixture.componentRef.setInput('showLocks', true);
        fixture.componentRef.setInput('showBulkLocks', true);
        fixture.detectChanges();
        const first = root.querySelector<HTMLElement>(
            '[data-category-id="01"]'
        )!;
        first.click();
        fixture.detectChanges();
        first.querySelector<HTMLButtonElement>('.lock-toggle')!.click();
        fixture.detectChanges();
        expect(first.querySelector<HTMLInputElement>('input')!.checked).toBe(
            false
        );
        expect(editor.lockedCount()).toBe(1);
        button('PARENTAL_LOCK.UNLOCK_ALL').click();
        fixture.detectChanges();
        button('PARENTAL_LOCK.LOCK_CENSORED').click();
        fixture.detectChanges();
        expect(
            editor.categories().map((row) => [row.selected, row.lockedDraft])
        ).toEqual([
            [false, false],
            [true, true],
        ]);
    });

    it('blocks submissions while loading or saving and emits each footer action when ready', () => {
        const save = jest.fn();
        const cancel = jest.fn();
        editor.saveRequested.subscribe(save);
        editor.cancelled.subscribe(cancel);
        fixture.componentRef.setInput('isLoading', true);
        fixture.detectChanges();
        expect(button('XTREAM.CATEGORY_MANAGEMENT.SAVE').disabled).toBe(true);
        expect(root.querySelectorAll('.category-item')).toHaveLength(0);
        fixture.componentRef.setInput('isLoading', false);
        fixture.componentRef.setInput('isSaving', true);
        fixture.detectChanges();
        button('CLOSE').click();
        root.querySelector<HTMLElement>('.category-item')!.click();
        expect(cancel).not.toHaveBeenCalled();
        expect(editor.selectedCount()).toBe(2);
        fixture.componentRef.setInput('isSaving', false);
        fixture.detectChanges();
        button('XTREAM.CATEGORY_MANAGEMENT.SAVE').click();
        button('CLOSE').click();
        expect(save).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledTimes(1);
    });
});
