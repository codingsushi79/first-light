# First Light — an astrophotography simulator

A desktop game (Tauri v2 + three.js) where you do astrophotography the way it's really done:
stand in a 3D field next to your rig, take the lens cap off, polar-align, focus, then sit at a
laptop running a full imaging OS (capture suite, planetarium, guiding, stacking, processing).

- **Real sky.** Every frame is simulated from real survey imagery (DSS2 / Mellinger via CDS
  hips2fits), so you can point at any object in the sky. Any SIMBAD name resolves (CDS Sesame).
- **Real physics.** Photon counts, QE, filters (incl. Hα/OIII/SII), Bortle sky glow, Moon,
  twilight, extinction, clouds, seeing, diffraction, defocus, coma, vignetting & dust, polar
  misalignment drift, periodic error, field rotation, read/shot noise, dark current, amp glow.
- **Anywhere on Earth.** The Atlas app shows NASA VIIRS night lights; pick any spot and its sky
  brightness is estimated from real satellite light data and the terrain from Blue Marble.

## Install

**macOS / Linux** — one line in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/codingsushi79/first-light/main/install.sh | sh
```

**Windows** — one line in PowerShell:

```powershell
irm https://raw.githubusercontent.com/codingsushi79/first-light/main/install.ps1 | iex
```

The script picks the right build for your machine (Apple Silicon or Intel Mac, x64 Linux AppImage,
Windows installer) from the [latest release](https://github.com/codingsushi79/first-light/releases/latest).
Or download it from the releases page yourself. Builds aren't code-signed yet; the macOS installer clears
the download quarantine so the app opens normally.

## First night
A new career starts with an interactive tutorial that walks you through taking, editing and posting your
first photo. Finish it (or skip it) and you get **$1,000** to buy your first real gear.

## Scripts
The **Scripts** app automates a whole project — travel, gear, polar alignment, framing, focus, sequences,
flats/darks, stacking, processing and posting — in a few readable lines. “From current setup” turns what
you've configured into a script, and every image made by a script has a **Retake** button on StarShare.

```
site atacama
gear mount=observatory optic=petz_100 corrector=reducer08 camera=mono_6200
wheel L R G B
target "Orion's Sword" ra=84.537 dec=-3.946
wait dark
center
rotation 116
focus auto
light L 20s x120 gain=0
light R 60s x80 gain=0
flat L R x20
dark 20s x30 gain=0
pack-up
stack
process preset=LRGB sat=0.7 title="Orion's Sword"
```

## Modes, saves and co-op
- **Career**: start with an old DSLR and $300; earn money from images and challenges.
- **Sandbox**: unlimited money, all gear unlocked, optional always-clear skies.
- Any number of save slots (main menu → New / Load). Esc opens the pause menu.
- **Co-op multiplayer**: host from the main menu (Multiplayer → Host) or in-game (Esc → Invite
  friends) and share the 6-letter room code. Friends join the host's night: same sky, same rig,
  avatars, chat. The host runs the simulation; guests' actions are sent to the host.
  Online uses PeerJS (WebRTC) — the public PeerJS server only introduces players.
  **LAN**: Host on LAN shows your IP; friends on the same network type it into Join (port 47800).

## Build from source

```bash
npm --prefix web install
npm --prefix desktop install
npm --prefix desktop run dev        # desktop app with live reload
npm --prefix desktop run build:mac  # → desktop/src-tauri/target/release/bundle/macos/First Light.app
```

`npm --prefix web run dev` runs the same game in a browser tab for quick iteration.
An internet connection is needed for sky imagery, catalogs and maps.

## Controls (outside)
Click to look around · WASD walk · **E** interact (lens cap, grab & aim the rig, focus, polar bolts,
sit at laptop) · **R** rig controls · **F** red headlamp · **Tab** laptop ↔ outside.

## Data credits
CDS Strasbourg (hips2fits, Sesame, DSS2 color & Mellinger HiPS), NASA GIBS (VIIRS Black Marble,
Blue Marble), d3-celestial (Hipparcos-based stars, constellations, Milky Way outline).

## Releasing
Push a version tag and GitHub Actions builds macOS (arm64 + x64), Windows and Linux and publishes a release:

```bash
git tag v0.2.0 && git push origin v0.2.0
```
