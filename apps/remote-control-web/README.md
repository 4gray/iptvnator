# Remote Control Web App

A lightweight, mobile-optimized web application that provides remote control functionality for IPTVnator. Control live channel switching from your phone or tablet on the same network.

## Overview

This is a standalone Angular application designed to be served by IPTVnator's Electron backend via an HTTP server. It provides a beautiful, Apple TV-inspired remote control interface that communicates with the main IPTVnator desktop application to change channels.

## Features

- **Apple TV-Inspired Design** - Premium dark theme with glass morphism effects
- **Mobile-Optimized** - Touch-friendly interface designed for phones and tablets
- **Real-time Control** - Instant channel switching via REST API
- **Multi-Portal Support** - Works with M3U playlists, Xtream Live TV, and Stalker ITV sections
- **Minimal & Fast** - Lightweight app (~55 KB compressed) with no external dependencies
- **Responsive** - Adapts to different screen sizes (320px - 480px+)

## How It Works

### Architecture

```
┌─────────────────┐         HTTP          ┌──────────────────┐
│   Phone/Tablet  │ ◄──────────────────► │  HTTP Server     │
│  (Browser App)  │    REST API calls    │  (Electron Main) │
└─────────────────┘                       └──────────────────┘
                                                    │ IPC
                                                    ▼
                                          ┌──────────────────┐
                                          │  Main App        │
                                          │  (Renderer)      │
                                          └──────────────────┘
```

1. **HTTP Server**: Electron backend starts an HTTP server (default port: 8765)
2. **Static Files**: Serves this Angular app's built files
3. **REST API**: Exposes `/api/remote-control/channel/up` and `/api/remote-control/channel/down` endpoints
4. **IPC Communication**: HTTP server sends events to the main Electron window
5. **Channel Switching**: Main app receives events and switches to next/previous live channel in the active live view

### API Endpoints

- `GET /` - Serves the remote control web interface
- `POST /api/remote-control/channel/up` - Switch to previous channel
- `POST /api/remote-control/channel/down` - Switch to next channel

## Usage

### Enable Remote Control

1. Open IPTVnator desktop app
2. Go to **Settings**
3. Enable **"Remote Control"** checkbox
4. Optionally change the port (default: 8765)
5. The HTTP server starts automatically

### Access from Mobile Device

1. Ensure your phone/tablet is on the **same network** as your computer
2. Find your computer's IP address:
   - **Windows**: `ipconfig` (look for IPv4)
   - **macOS**: `ifconfig` or System Preferences → Network
   - **Linux**: `ip addr` or `hostname -I`
3. Open browser on your mobile device
4. Navigate to: `http://<YOUR_IP>:8765`
   - Example: `http://192.168.1.100:8765`

### Controls

- **Top half of circle**: Previous channel (Channel Up)
- **Bottom half of circle**: Next channel (Channel Down)
- **Center blue dot**: Status indicator (glowing = ready)

## Development

### Build

```bash
# Production build
nx build remote-control-web --configuration=production

# Development build
nx build remote-control-web
```

Built files are output to `dist/apps/remote-control-web/browser/`

### Serve Locally

The app is designed to be served by the Electron backend's HTTP server. To test:

```bash
# Start Electron backend (includes HTTP server)
nx serve electron-backend

# Access at http://localhost:8765
```

### Project Structure

```
apps/remote-control-web/
├── src/
│   ├── app/
│   │   ├── app.component.ts       # Root component
│   │   ├── app.config.ts          # Angular configuration
│   │   └── app.routes.ts          # Routes (single route)
│   ├── assets/                    # Static assets (if any)
│   ├── index.html                 # HTML entry point
│   └── main.ts                    # Bootstrap Angular app
├── project.json                   # Nx project configuration
├── tsconfig.json                  # TypeScript config
└── README.md                      # This file
```

## Shared UI Library

The remote control component is located in:
```
libs/ui/remote-control/
├── src/lib/remote-control/
│   ├── remote-control.component.ts    # Main component logic
│   ├── remote-control.component.html  # Template
│   ├── remote-control.component.scss  # Apple TV-inspired styles
│   └── remote-control.service.ts      # HTTP service for API calls
```

This library is shared and can be reused in other applications if needed.

## Technical Details

- **Framework**: Angular 18+ (Standalone components)
- **HTTP Client**: Angular HttpClient
- **Styling**: SCSS with BEM methodology
- **Design System**: Apple TV-inspired with glass morphism
- **Animations**: CSS-only (no JavaScript animations)
- **Bundle Size**: ~55 KB gzipped (production build)
- **Browser Support**: Modern browsers (Chrome, Safari, Firefox, Edge)

## Design Philosophy

The interface is inspired by Apple TV's remote control:
- **Minimalism**: Clean, uncluttered design with essential controls only
- **Glass Morphism**: Frosted glass effects with subtle reflections
- **Touch-Optimized**: Large touch targets (50% of circle per button)
- **Feedback**: Visual feedback on hover/press with ripple effects
- **Accessibility**: Supports reduced motion preferences

## Security Considerations

- **Local Network Only**: The HTTP server should only be accessible on your local network
- **No Authentication**: Currently no authentication - ensure your network is trusted
- **CORS**: Server accepts requests from any origin on the local network

## Future Enhancements

Potential improvements:
- Volume control
- Play/pause functionality
- Channel search
- Favorites quick access
- Authentication/PIN protection
- WebSocket for real-time status updates
- Multi-device support with channel sync

## Related Files

- **HTTP Server**: `apps/electron-backend/src/app/server/http-server.ts`
- **Remote Control Events**: `apps/electron-backend/src/app/events/remote-control.events.ts`
- **M3U Handler**: `apps/web/src/app/home/video-player/video-player.component.ts` (handleRemoteChannelChange method)
- **Xtream Live Handler**: `apps/web/src/app/xtream-tauri/live-stream-layout/live-stream-layout.component.ts`
- **Stalker ITV Handler**: `apps/web/src/app/stalker/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`
- **Settings UI**: `apps/web/src/app/settings/settings.component.html`

## License

Same as IPTVnator main project.
