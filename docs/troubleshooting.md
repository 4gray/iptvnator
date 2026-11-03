# Troubleshooting

[Back to README](../README.md)

### macOS: "App is damaged and can't be opened"

Older unsigned macOS builds may require removing the quarantine flag from the downloaded application:

```bash
xattr -c /Applications/IPTVnator.app
```

Alternatively, if the app is located in a different directory:

```bash
xattr -c ~/Downloads/IPTVnator.app
```

### Linux: chrome-sandbox Issues

If you encounter the following error when launching IPTVnator:

```
The SUID sandbox helper binary was found, but is not configured correctly.
Rather than run without sandboxing I'm aborting now.
You need to make sure that chrome-sandbox is owned by root and has mode 4755.
```

**Solution 1: Fix chrome-sandbox permissions (Recommended for .deb/.rpm installations)**

Navigate to the IPTVnator installation directory and run:

```bash
sudo chown root:root chrome-sandbox
sudo chmod 4755 chrome-sandbox
```

**Solution 2: Launch with --no-sandbox flag**

Edit the desktop launcher file to add the `--no-sandbox` flag:

1. Find your desktop file location:
    - **Ubuntu/Debian**: `~/.local/share/applications/iptvnator.desktop`
    - **System-wide**: `/usr/share/applications/iptvnator.desktop`

2. Edit the file and modify the `Exec` line:

    ```
    Exec=iptvnator --no-sandbox %U
    ```

3. Save the file and relaunch the application from your application menu.

Alternatively, you can launch IPTVnator from the terminal with the flag:

```bash
iptvnator --no-sandbox
```

### GNU/Linux: Wayland startup failure

If IPTVnator exits on GNU/Linux with errors about failing to connect to
Wayland or initialize the Ozone platform, force X11/XWayland instead:

```bash
iptvnator --ozone-platform=x11
```

This workaround is mainly for older or problematic Linux graphics stacks. The
Snap package already includes this X11 override by default. For AppImage,
direct binaries, and other Linux package formats, pass the flag manually when
needed.

For Docker connection and playback problems, see the [self-hosting reference](../docker/README.md).
