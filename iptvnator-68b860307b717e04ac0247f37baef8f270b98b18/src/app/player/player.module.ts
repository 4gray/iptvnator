import { EpgListItemComponent } from './components/epg-list/epg-list-item/epg-list-item.component';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChannelListContainerComponent } from './components/channel-list-container/channel-list-container.component';
import { HtmlVideoPlayerComponent } from './components/html-video-player/html-video-player.component';
import { VideoPlayerComponent } from './components/video-player/video-player.component';
import { VjsPlayerComponent } from './components/vjs-player/vjs-player.component';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { EpgListComponent } from './components/epg-list/epg-list.component';
import { EpgItemDescriptionComponent } from './components/epg-list/epg-item-description/epg-item-description.component';
import { InfoOverlayComponent } from './components/info-overlay/info-overlay.component';

const routes: Routes = [{ path: '', component: VideoPlayerComponent }];

@NgModule({
    imports: [CommonModule, RouterModule.forChild(routes), SharedModule],
    declarations: [
        ChannelListContainerComponent,
        EpgItemDescriptionComponent,
        EpgListComponent,
        EpgListItemComponent,
        InfoOverlayComponent,
        HtmlVideoPlayerComponent,
        VideoPlayerComponent,
        VjsPlayerComponent,
    ],
})
export class PlayerModule {}
