// The electron-performance build's environment: production values plus the
// change-detection tick counter the performance journeys read. See
// change-detection-tick-counter.ts; no other configuration imports this file.
import { installChangeDetectionTickCounter } from './change-detection-tick-counter';

installChangeDetectionTickCounter();

export { AppConfig } from './environment.prod';
