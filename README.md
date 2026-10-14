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

## Modes, saves and co-op
- **Career**: start with an old DSLR and $300; earn money from images and challenges.
- **Sandbox**: unlimited money, all gear unlocked, optional always-clear skies.
- Any number of save slots (main menu → New / Load). Esc opens the pause menu.
- **Co-op multiplayer**: host from the main menu (Multiplayer → Host) or in-game (Esc → Invite
  friends) and share the 6-letter room code. Friends join the host's night: same sky, same rig,
  avatars, chat. The host runs the simulation; guests' actions are sent to the host.
  Online uses PeerJS (WebRTC) — the public PeerJS server only introduces players.
  **LAN**: Host on LAN shows your IP; friends on the same network type it into Join (port 47800).

## Run

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
