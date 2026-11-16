import { Injectable } from '@angular/core';
import { AutoplayStreak } from '@iptvnator/shared/interfaces';

/**
 * The app-wide autoplay run for series playback (#2245). Hosts claim each
 * autoplay through `beginAutoplay()`; the inline player reports every
 * episode it starts. No limit yet, so autoplay is unchanged.
 */
@Injectable({ providedIn: 'root' })
export class AutoplayStreakService extends AutoplayStreak {}
