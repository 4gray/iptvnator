/**
 * Where macOS draws the native window buttons (close, minimize, zoom), in
 * window points from the window's top-left corner. The main process places
 * them (`trafficLightPosition`); the workspace shell keeps its controls clear
 * of them at every app zoom, which scales CSS pixels but not the buttons.
 */
export const MACOS_TRAFFIC_LIGHTS_POSITION = { x: 16, y: 20 } as const;
