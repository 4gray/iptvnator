import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
    SeriesResumeTarget,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { GlobalCollectionDetailHostComponent } from './global-collection-route.component';

@Component({
    selector: 'app-xtream-collection-detail',
    template: '',
})
class MockXtreamCollectionDetailComponent {
    readonly item = input<UnifiedCollectionItem | null>(null);
    readonly seriesResume = input<SeriesResumeTarget | null>(null);
    readonly closeRequested = output<void>();
}

jest.unstable_mockModule('@iptvnator/portal/xtream/feature', () => ({
    XtreamCollectionDetailComponent: MockXtreamCollectionDetailComponent,
}));

@Component({
    imports: [GlobalCollectionDetailHostComponent],
    template: `
        <app-global-collection-detail-host
            [item]="item()"
            [seriesResume]="seriesResume()"
            (closeRequested)="closeCount = closeCount + 1"
        />
    `,
})
class WrapperComponent {
    readonly item = signal<UnifiedCollectionItem | null>(null);
    readonly seriesResume = signal<SeriesResumeTarget | null>(null);
    closeCount = 0;
}

const xtreamSeriesItem: UnifiedCollectionItem = {
    uid: 'xtream::xtream-1::series:103',
    name: 'Resume Series',
    contentType: 'series',
    sourceType: 'xtream',
    playlistId: 'xtream-1',
    playlistName: 'Xtream One',
    xtreamId: 103,
    categoryId: 3,
};

describe('GlobalCollectionDetailHostComponent', () => {
    let fixture: ComponentFixture<WrapperComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WrapperComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(WrapperComponent);
    });

    afterEach(() => {
        fixture?.destroy();
    });

    function queryDetail() {
        return fixture.debugElement.query(
            By.directive(MockXtreamCollectionDetailComponent)
        );
    }

    async function stabilize(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    it('mocks the xtream feature barrel', async () => {
        const mod = await import('@iptvnator/portal/xtream/feature');
        expect(mod.XtreamCollectionDetailComponent).toBe(
            MockXtreamCollectionDetailComponent as never
        );
    });

    it('renders nothing until an item arrives', async () => {
        await stabilize();

        expect(queryDetail()).toBeNull();
    });

    it('ignores sources without a collection detail component', async () => {
        fixture.componentInstance.item.set({
            ...xtreamSeriesItem,
            uid: 'm3u::pl-1::vod:1',
            sourceType: 'm3u' as UnifiedCollectionItem['sourceType'],
            playlistId: 'pl-1',
        });
        await stabilize();

        expect(queryDetail()).toBeNull();
    });

    it('creates the Xtream detail with the series resume target attached', async () => {
        const seriesResume = {
            seriesXtreamId: 103,
            contentXtreamId: 2001,
            seasonNumber: 2,
            episodeNumber: 1,
        };
        fixture.componentInstance.seriesResume.set(seriesResume);
        fixture.componentInstance.item.set(xtreamSeriesItem);
        await stabilize();

        const detail = queryDetail();
        expect(detail).not.toBeNull();

        const instance =
            detail?.componentInstance as MockXtreamCollectionDetailComponent;
        expect(instance.item()?.xtreamId).toBe(103);
        expect(instance.seriesResume()).toEqual(seriesResume);
    });

    it('re-emits close requests and clears the detail with the item', async () => {
        fixture.componentInstance.item.set(xtreamSeriesItem);
        await stabilize();

        const instance = queryDetail()
            ?.componentInstance as MockXtreamCollectionDetailComponent;
        instance.closeRequested.emit();
        expect(fixture.componentInstance.closeCount).toBe(1);

        fixture.componentInstance.item.set(null);
        await stabilize();

        expect(queryDetail()).toBeNull();
    });
});
