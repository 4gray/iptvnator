import { Component, ElementRef, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { createGroupsRailReveal } from './groups-rail-reveal';

@Component({
    selector: 'app-groups-rail-reveal-harness',
    template: `
        <div class="groups-nav-list">
            @for (key of rows(); track key) {
                <button type="button" [attr.data-group-key]="key">
                    {{ key }}
                </button>
            }
        </div>
    `,
})
class GroupsRailRevealHarnessComponent {
    readonly rows = signal(['Alpha', 'Middle', 'Zulu', 'Omega']);
    readonly selectedGroupKey = signal<string | null>(null);

    constructor() {
        createGroupsRailReveal({
            host: inject(ElementRef<HTMLElement>).nativeElement,
            selectedGroupKey: this.selectedGroupKey,
            rowsChanged: () => this.rows(),
        });
    }
}

describe('createGroupsRailReveal', () => {
    let fixture: ComponentFixture<GroupsRailRevealHarnessComponent>;
    let component: GroupsRailRevealHarnessComponent;
    let scrollTo: jest.Mock;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [GroupsRailRevealHarnessComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(GroupsRailRevealHarnessComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
    });

    afterEach(() => fixture.destroy());

    function mockRailGeometry(rowTops: number[]): HTMLElement {
        const container = fixture.nativeElement.querySelector(
            '.groups-nav-list'
        ) as HTMLElement;
        Object.defineProperties(container, {
            clientHeight: { value: 400 },
            scrollHeight: { value: 3000 },
        });
        container.scrollTop = 500;
        container.getBoundingClientRect = () => new DOMRect(0, 100, 200, 400);
        scrollTo = jest.fn();
        container.scrollTo = scrollTo;
        const rows = Array.from(
            container.querySelectorAll<HTMLElement>('[data-group-key]')
        );
        rows.forEach((row, index) => {
            row.getBoundingClientRect = () =>
                new DOMRect(0, rowTops[index] ?? 150, 200, 40);
        });
        return container;
    }

    it('only stops any in-flight scroll when the selected group is already fully visible', async () => {
        mockRailGeometry([150, 250, 350, 450]);

        component.selectedGroupKey.set('Middle');
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

    it('centres the selected group when it is off-screen', async () => {
        mockRailGeometry([150, 250, 350, 2200]);

        component.selectedGroupKey.set('Omega');
        fixture.detectChanges();
        await fixture.whenStable();

        expect(scrollTo).toHaveBeenCalledWith({
            behavior: 'smooth',
            top: 2420,
        });
    });

    it('reveals the group again after the selection clears and returns', async () => {
        const container = mockRailGeometry([150, 250, 350, 2200]);

        component.selectedGroupKey.set('Omega');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(scrollTo).toHaveBeenCalledWith({
            behavior: 'smooth',
            top: 2420,
        });

        scrollTo.mockClear();
        component.selectedGroupKey.set(null);
        fixture.detectChanges();
        await fixture.whenStable();
        container.scrollTop = 0;

        component.selectedGroupKey.set('Omega');
        fixture.detectChanges();
        await fixture.whenStable();

        expect(scrollTo).toHaveBeenCalledWith({
            behavior: 'smooth',
            top: 1920,
        });
    });
});
