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

## Planets, the Moon & lucky imaging
Real positions for every planet (JPL elements), Jupiter's four big moons with their shadow transits,
Saturn's rings at their true tilt, phases of Venus & Mercury, and a cratered Moon with real maria.
Planets need focal length: an SCT + **Barlow** + a **planetary camera** (AstroMart). In AstroCap →
**Planetary**, center the planet, watch it "boil" in Live view, then record a video (thousands of
millisecond frames). DeepStack → *Planetary videos* keeps the sharpest frames (lucky imaging);
PixelLab's **wavelets** bring the detail out. Low planets suffer atmospheric dispersion — use an ADC
or *RGB align*.

## Also new in 0.2
- **Auroras** at high geomagnetic latitudes (nightly Kp index, storms), in the sky and in photos.
- **Sound**: wind, crickets, distant traffic, owls, shutters, mount motors, footsteps.
- **Logbook**: Messier checklist, planets, achievements (cash rewards in career), records.
- **Storage**: every file has a realistic size (raw frames, SER videos, 32-bit stacks). The laptop's
  SSD fills up — buy drives in AstroMart or free space in Files.
- **Global StarShare**: published images also go to a shared online gallery where players like,
  comment and buy prints (authors earn in-game money). Opt out in StarShare → My images.
- Compass and sky markers outside; Spotlight (⌘K), Notification Center (click the clock) and
  window snapping on the laptop; frames now render at 2048 px (Settings: up to 4096).

## StarShare server
`server/` is the global StarShare API (Vercel serverless function + Postgres). Deploy it with
`vercel deploy --prod` from that folder after setting `DATABASE_URL` in the Vercel project; the
schema is created automatically. The game talks to `https://first-light-starshare.vercel.app`
(change `API` in `web/js/starshare-net.js` for your own deployment).

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
Click to look around · WASD walk · compass & sky markers show the target and where the scope points · **E** interact (lens cap, grab & aim the rig, focus, polar bolts,
sit at laptop) · **R** rig controls · **F** red headlamp · **Tab** laptop ↔ outside.

## Data credits
CDS Strasbourg (hips2fits, Sesame, DSS2 color & Mellinger HiPS), NASA GIBS (VIIRS Black Marble,
Blue Marble), d3-celestial (Hipparcos-based stars, constellations, Milky Way outline).

## Releasing
Push a version tag and GitHub Actions builds macOS (arm64 + x64), Windows and Linux and publishes a release:

```bash
git tag v0.2.0 && git push origin v0.2.0
```
