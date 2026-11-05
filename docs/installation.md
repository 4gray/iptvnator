# Installation

[Back to README](../README.md)

Download the latest version of the application for macOS, Windows, and Linux from the [release page](https://github.com/4gray/iptvnator/releases).

## Nightly builds

Every merge into `master` is published as a prerelease in
[4gray/iptvnator-nightly](https://github.com/4gray/iptvnator-nightly). The
desktop app can follow them: **Settings → About → Update channel → Nightly**
offers each new build through the built-in updater (macOS, Windows, and the
Linux AppImage). Nightly builds are untested snapshots — they may break, and
their database changes are permanent, so switching back to **Stable** keeps
the installed nightly until the next stable release is newer. Back up your
playlists first, and mention the version and commit shown in *About* when
reporting a bug from a nightly.

## Homebrew

```shell
brew install --cask iptvnator
```

## Snap

```shell
sudo snap install iptvnator
```

## Arch

Also available as an Arch PKG, [iptvnator-bin](https://aur.archlinux.org/packages/iptvnator-bin/), in the AUR (using your favourite AUR-helper, .e.g. `yay`)

```shell
yay -S iptvnator-bin
```

## Gentoo

You can install IPTVnator from the [gentoo-zh overlay](https://github.com/microcai/gentoo-zh)

```shell
sudo eselect repository enable gentoo-zh
sudo emerge --sync gentoo-zh
sudo emerge iptvnator-bin
```

## Linux Embedded MPV Support

Embedded MPV on Linux is experimental and currently supports x64 desktop
sessions where IPTVnator runs under X11 or Xwayland. Native Wayland embedding
is not supported yet. Linux package launchers request X11 with
`--ozone-platform=x11`, so Wayland desktops still need Xwayland available.

The Linux backend starts a system `mpv` executable with `--wid`, so `mpv` must
be installed and available on `PATH`. CI validates the Linux native addon and
standard packages on Ubuntu 22.04, with Flatpak packaging built on Ubuntu 24.04.
Expected user targets are Ubuntu/Debian `.deb`, Arch/Manjaro `pacman`, RPM
distributions, and AppImage on x64 systems with X11/Xwayland plus `mpv`
installed. Flatpak and Snap builds remain available, but embedded MPV is not
announced as supported there yet because those sandboxed formats do not expose
the host `mpv` executable to the embedded backend by default.

For Docker and client connections, see the [self-hosting reference](../docker/README.md). For startup problems, see [Troubleshooting](troubleshooting.md).
