import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    WorkspaceBackNavigationService,
    WorkspaceBackTarget,
} from './workspace-back-navigation.service';

describe('WorkspaceBackNavigationService', () => {
    function createService(): WorkspaceBackNavigationService {
        TestBed.resetTestingModule();
        return TestBed.inject(WorkspaceBackNavigationService);
    }

    function createTarget(run = jest.fn()): WorkspaceBackTarget {
        return {
            label: signal<string | null>(null),
            escapeShortcut: signal(true),
            run,
        };
    }

    it('has no target until a page registers one', () => {
        const service = createService();

        expect(service.target()).toBeNull();
        expect(service.goBack()).toBe(false);
    });

    it('runs the most recently registered target', () => {
        const service = createService();
        const first = createTarget();
        const second = createTarget();

        service.register(first);
        service.register(second);

        expect(service.target()).toBe(second);
        expect(service.goBack()).toBe(true);
        expect(second.run).toHaveBeenCalledTimes(1);
        expect(first.run).not.toHaveBeenCalled();
    });

    it('hands the slot back to the previous target on release', () => {
        const service = createService();
        const first = createTarget();
        const second = createTarget();

        service.register(first);
        const releaseSecond = service.register(second);
        releaseSecond();

        expect(service.target()).toBe(first);
    });

    it('keeps a replacement page when the replaced one releases afterwards', () => {
        const service = createService();
        const loading = createTarget();
        const loaded = createTarget();

        const releaseLoading = service.register(loading);
        service.register(loaded);
        releaseLoading();

        expect(service.target()).toBe(loaded);
    });

    it('moves a re-registered target to the top without duplicating it', () => {
        const service = createService();
        const first = createTarget();
        const second = createTarget();

        const releaseFirst = service.register(first);
        service.register(second);
        service.register(first);
        releaseFirst();

        expect(service.target()).toBe(second);
    });
});
