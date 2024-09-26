import { OverlayModule } from '@angular/cdk/overlay';
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RecentPlaylistsComponent } from '../home/recent-playlists/recent-playlists.component';
import { SharedModule } from '../shared/shared.module';
import { AudioPlayerComponent } from './components/audio-player/audio-player.component';
import { EpgItemDescriptionComponent } from './components/epg-list/epg-item-description/epg-item-description.component';
import { EpgListItemComponent } from './components/epg-list/epg-list-item/epg-list-item.component';
import { EpgListComponent } from './components/epg-list/epg-list.component';
import { HtmlVideoPlayerComponent } from './components/html-video-player/html-video-player.component';
import { InfoOverlayComponent } from './components/info-overlay/info-overlay.component';
import { MultiEpgContainerComponent } from './components/multi-epg/multi-epg-container.component';
import { SidebarComponent } from './components/video-player/sidebar/sidebar.component';
import { ToolbarComponent } from './components/video-player/toolbar/toolbar.component';
import { VideoPlayerComponent } from './components/video-player/video-player.component';
import { VjsPlayerComponent } from './components/vjs-player/vjs-player.component';

const routes: Routes = [{ path: '', component: VideoPlayerComponent }];

@NgModule({
    imports: [
        AudioPlayerComponent,
        CommonModule,
        EpgItemDescriptionComponent,
        HtmlVideoPlayerComponent,
        OverlayModule,
        RecentPlaylistsComponent,
        RouterModule.forChild(routes),
        SidebarComponent,
        SharedModule,
        VjsPlayerComponent,
    ],
    declarations: [
        EpgListComponent,
        EpgListItemComponent,
        InfoOverlayComponent,
        MultiEpgContainerComponent,
        ToolbarComponent,
        VideoPlayerComponent,
    ],
})
export class PlayerModule {}
