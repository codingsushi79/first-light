#!/bin/sh
# First Light installer for macOS and Linux:
#   curl -fsSL https://raw.githubusercontent.com/codingsushi79/first-light/main/install.sh | sh
# Optional: FIRST_LIGHT_DIR=<folder> to install elsewhere, FIRST_LIGHT_NO_OPEN=1 to not launch it.
set -eu
REPO="codingsushi79/first-light"
OS="$(uname -s)"; ARCH="$(uname -m)"
say() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }
command -v curl >/dev/null || die "curl is required"

say "Looking up the latest release of First Light…"
JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")" || die "could not reach GitHub"
asset() { printf '%s' "$JSON" | grep -o "\"browser_download_url\": *\"[^\"]*$1\"" | head -n 1 | sed 's/.*"\(https[^"]*\)"$/\1/'; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

case "$OS" in
  Darwin)
    if [ "$ARCH" = "arm64" ]; then SUF="aarch64.dmg"; else SUF="x64.dmg"; fi
    URL="$(asset "$SUF")"; [ -n "$URL" ] || die "no macOS build ($SUF) in the latest release"
    say "Downloading $(basename "$URL")…"
    curl -fL --progress-bar "$URL" -o "$TMP/FirstLight.dmg"
    MNT="$TMP/mnt"; mkdir -p "$MNT"
    hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$TMP/FirstLight.dmg" >/dev/null
    DEST="${FIRST_LIGHT_DIR:-/Applications}"; mkdir -p "$DEST" 2>/dev/null || true; [ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
    rm -rf "$DEST/First Light.app"
    cp -R "$MNT/First Light.app" "$DEST/"
    hdiutil detach "$MNT" -quiet || true
    # The app is not notarized yet; clear the download quarantine so it opens normally.
    xattr -dr com.apple.quarantine "$DEST/First Light.app" 2>/dev/null || true
    say "Installed to $DEST/First Light.app"
    [ -n "${FIRST_LIGHT_NO_OPEN:-}" ] || open "$DEST/First Light.app" || true
    ;;
  Linux)
    [ "$ARCH" = "x86_64" ] || die "only x86_64 Linux builds are published (you have $ARCH)"
    URL="$(asset "amd64.AppImage")"; [ -n "$URL" ] || die "no Linux AppImage in the latest release"
    say "Downloading $(basename "$URL")…"
    BIN="${FIRST_LIGHT_DIR:-$HOME/.local/bin}"; mkdir -p "$BIN"
    curl -fL --progress-bar "$URL" -o "$BIN/first-light"
    chmod +x "$BIN/first-light"
    APPS="$HOME/.local/share/applications"; mkdir -p "$APPS"
    printf '[Desktop Entry]\nName=First Light\nComment=Astrophotography simulator\nExec=%s\nTerminal=false\nType=Application\nCategories=Game;Education;\n' "$BIN/first-light" > "$APPS/first-light.desktop"
    say "Installed to $BIN/first-light (also in your app menu)."
    case ":$PATH:" in *":$BIN:"*) ;; *) say "Tip: add $BIN to your PATH to run 'first-light' from a terminal." ;; esac
    ;;
  *) die "unsupported system: $OS — on Windows use install.ps1" ;;
esac
