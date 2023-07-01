import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { NgxWhatsNewModule } from 'ngx-whats-new';
import { PlaylistItemComponent } from '../home/recent-playlists/playlist-item/playlist-item.component';
import { RecentPlaylistsComponent } from '../home/recent-playlists/recent-playlists.component';
import { MaterialModule } from '../material.module';
import { HeaderComponent } from './components/';
import { FilterPipe } from './pipes/filter.pipe';
import { MomentDatePipe } from './pipes/moment-date.pipe';

@NgModule({
    declarations: [
        HeaderComponent,
        MomentDatePipe,
        RecentPlaylistsComponent,
        PlaylistItemComponent,
    ],
    imports: [
        FilterPipe,
        CommonModule,
        FormsModule,
        MaterialModule,
        NgxWhatsNewModule,
        ReactiveFormsModule,
        TranslateModule,
        DragDropModule,
        NgxSkeletonLoaderModule.forRoot({
            animation: 'pulse',
            loadingText: 'This item is actually loading...',
        }),
    ],
    exports: [
        DragDropModule,
        FilterPipe,
        FormsModule,
        HeaderComponent,
        MaterialModule,
        NgxWhatsNewModule,
        MomentDatePipe,
        ReactiveFormsModule,
        TranslateModule,
        RecentPlaylistsComponent,
        PlaylistItemComponent,
    ],
})
export class SharedModule {}
