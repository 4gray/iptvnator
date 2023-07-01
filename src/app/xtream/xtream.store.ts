import { Injectable } from '@angular/core';
import { ComponentStore } from '@ngrx/component-store';
import { XtreamCategory } from '../../../shared/xtream-category.interface';

export interface XtreamState {
    liveStreams: any[];
    series: any[];
    vods: any[];
    vodCategories: XtreamCategory[];
}

@Injectable({ providedIn: 'root' })
export class XtreamStore extends ComponentStore<XtreamState> {
    constructor() {
        super({ liveStreams: [], series: [], vods: [], vodCategories: [] });
    }

    readonly liveStreams = this.selectSignal((state) => state.liveStreams);
    readonly series = this.selectSignal((state) => state.series);
    readonly vods = this.selectSignal((state) => state.vods);
    readonly vodCategories = this.selectSignal((state) => state.vodCategories);

    readonly setLiveStreams = this.updater(
        (state, liveStreams: any[]): XtreamState => ({
            ...state,
            liveStreams,
        })
    );

    readonly setSerials = this.updater(
        (state, series: any[]): XtreamState => ({
            ...state,
            series,
        })
    );

    readonly setVods = this.updater(
        (state, vods: any[]): XtreamState => ({
            ...state,
            vods,
        })
    );
}
