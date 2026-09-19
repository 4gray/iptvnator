import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { GroupManagementDialogComponent } from './group-management-dialog.component';

describe('GroupManagementDialogComponent', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [GroupManagementDialogComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        groups: [
                            { key: 'Sports', count: 2 },
                            { key: 'Sports News', count: 3 },
                            { key: 'Science Fiction', count: 1 },
                        ],
                        hiddenGroupTitles: [],
                    },
                },
                {
                    provide: MatDialogRef,
                    useValue: { close: jest.fn() },
                },
            ],
        }).compileComponents();
    });

    it('filters local M3U groups with terms, quoted phrases, and exclusions', () => {
        const fixture = TestBed.createComponent(GroupManagementDialogComponent);
        const component = fixture.componentInstance;

        component.searchTerm.set('sports -news');
        expect(component.filteredGroups().map((group) => group.key)).toEqual([
            'Sports',
        ]);

        component.searchTerm.set('sports -"sports news"');
        expect(component.filteredGroups().map((group) => group.key)).toEqual([
            'Sports',
        ]);

        component.searchTerm.set('"science fiction"');
        expect(component.filteredGroups().map((group) => group.key)).toEqual([
            'Science Fiction',
        ]);
    });
});
