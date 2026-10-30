import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { registerWorkspaceBack } from './register-workspace-back';
import { WorkspaceBackNavigationService } from './workspace-back-navigation.service';

@Component({ template: '' })
class PageComponent {
    readonly available = signal(true);
    readonly run = jest.fn();

    constructor() {
        registerWorkspaceBack({
            available: this.available,
            phoneDrawerToggle: 'beside',
            run: () => this.run(),
        });
    }
}

describe('registerWorkspaceBack', () => {
    function setup() {
        TestBed.resetTestingModule();
        const fixture = TestBed.createComponent(PageComponent);
        fixture.detectChanges();
        const backNavigation = TestBed.inject(WorkspaceBackNavigationService);
        return { fixture, backNavigation, page: fixture.componentInstance };
    }

    it('offers a generic Back without Escape that runs the page handler', () => {
        const { backNavigation, page } = setup();
        const target = backNavigation.target();

        expect(target?.label()).toBeNull();
        expect(target?.escapeShortcut()).toBe(false);
        expect(target?.phoneDrawerToggle).toBe('beside');
        expect(backNavigation.goBack()).toBe(true);
        expect(page.run).toHaveBeenCalledTimes(1);
    });

    it('registers only while available and releases with the page', () => {
        const { fixture, backNavigation, page } = setup();

        page.available.set(false);
        TestBed.tick();
        expect(backNavigation.target()).toBeNull();

        page.available.set(true);
        TestBed.tick();
        expect(backNavigation.target()).not.toBeNull();

        fixture.destroy();
        expect(backNavigation.target()).toBeNull();
    });
});
