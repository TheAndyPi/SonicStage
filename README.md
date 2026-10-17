# SonicStage

SonicStage is a music studio that runs entirely in the browser. You pick sounds from a library of 100 synthesized instruments, program them on a 16-step beat grid, arrange bars into a full song, and watch a band of 3D performers play it live on stage.

Everything happens on the client. Sound is synthesized with the Web Audio API, the stage is rendered with Three.js, and the song generator composes locally, so there is no backend and no API key.

This project was built for fun to test out Cursor alongside Opus 5.5 and Gemini 4 Argon.

## Features

- **Two views of one song.** _Immersive_ is a full-screen stage with a sound browser and compact transport. _Pro_ adds the arrangement sheet, harmony controls, recording, and the effects rack. Switching views keeps your work.
- **100 instruments** across drums, bass, chords, melody, strings and horns, and vocals, all synthesized in real time.
- **16-step beat editor** with per-track mute, solo, gain, pan, octave, shuffle, and reset.
- **Song arrangement** of up to 1,024 independent bars, with copy, reorder, and labels. Drop an effect onto a clip to affect that player in that bar, or onto a bar heading to affect all its performers. Effect badges open the relevant rack; bar scope supports shared amount/bypass controls and clearing, with chain copying to the next bar or all other bars. Repeated instruments have separate player rows.
- **Song generator** that writes editable 8- to 64-bar songs in 18 styles, from House, Drum & Bass, and Trap to Bossa Nova, a 3/4 folk waltz, and a 6/8 soul ballad. Each song has a real form (intro, verses, builds, choruses, a bridge, and an ending), voice-led chord progressions, and a repeating melodic hook.
- **21 performer effects** in both views: bass boost, warmth, air, telephone, underwater, auto wah, overdrive, fuzz, bitcrush, echo, slapback, dub delay, room, hall, cavern, chorus, flanger, vibrato, tremolo, auto pan, and ring modulation. Stack up to four per player with amount, bypass, and signal-order controls. Click to apply to the selected player, or drag onto a performer or beat row. Stage halos, ripples, or sparks reflect the active effects. Effects save with each bar and follow players when moved.
- **Master effects rack** with master EQ, filter, drive, reverb, delay, swing, compression, and master level.
- **Recording** of the master output, downloaded in the browser's supported audio format.
- **Save and open** songs as SonicStage JSON files. Sessions also autosave in the browser, with undo and redo for the current visit.
- **Light and dark themes**, including the 3D stage. Motion follows the system's reduced-motion setting.

## Quick start

You need [Node.js](https://nodejs.org/) 18 or newer and Python 3 (used only for the local web server).

```sh
npm install
npm run dev
```

Then open <http://127.0.0.1:4173>.

The compiled CSS is committed, so you can also serve the `public/` folder with any static file server without installing anything.

## Using the studio

| Action                                | How                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Play / pause                          | <kbd>Space</kbd>                                                          |
| Play from the beginning               | <kbd>Enter</kbd>                                                          |
| Stop                                  | <kbd>0</kbd>                                                              |
| Show all shortcuts                    | <kbd>?</kbd>                                                              |
| Save song                             | <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>S</kbd>                               |
| Undo / redo                           | <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd>, add <kbd>Shift</kbd> to redo |
| Cycle a step's note or drum variation | <kbd>Shift</kbd>-click the step                                           |
| Move between steps and tracks         | Arrow keys while a step is focused                                        |

Some other things worth knowing:

- Click a sound to add it to (or remove it from) the selected bar. Click a performer's label on stage to focus that track, or a track name in the beat editor to open its full controls.
- Drag the border beside **Sounds** or above the **Beat editor** to resize them. Double-click a divider or press <kbd>Home</kbd> to reset it.
- Click the SonicStage wordmark to return to the start page, where **New**, **Open**, **Continue**, and **Generate** live.
- Shortcuts work while buttons, sliders, and beat steps have focus. Text fields keep their normal typing and undo behavior.

SonicStage needs a browser with WebGL and Web Audio, which covers all current desktop and mobile browsers.

## Project structure

```text
SonicStage/
├── public/                     # The deployable site; served as-is
│   ├── index.html              # Page markup and script load order
│   ├── favicon.svg
│   ├── images/brand-mark.svg   # Logo
│   ├── css/
│   │   ├── tailwind.css        # Generated by `npm run build`; do not edit
│   │   ├── base.css            # Core layout and component styles
│   │   ├── workspace.css       # Studio panels, beat editor, arrangement, start page
│   │   └── theme.css           # Light/dark theme, Immersive view, panel animation
│   ├── js/
│   │   ├── music/
│   │   │   ├── presets.js          # Keys, scales, tempo curve, and the 100 instrument presets
│   │   │   ├── app-state.js        # Track slots and stage capacity
│   │   │   ├── song.js             # Song arrangement, autosave, import/export
│   │   │   ├── audio-engine.js     # Web Audio synthesis, mixer, and effects
│   │   │   └── song-generator.js   # Procedural song composition
│   │   ├── stage/
│   │   │   ├── scene.js            # Three.js scene, lighting, and adaptive stage
│   │   │   ├── performers.js       # 3D musicians and instrument rigs
│   │   │   ├── camera.js           # Camera presets, orbit controls, picking
│   │   │   ├── labels.js           # Floating performer labels
│   │   │   └── render-loop.js      # Spectrum analyzer and animation loop
│   │   ├── ui/
│   │   │   ├── tracks.js           # Track assignment and per-track controls
│   │   │   ├── sequencer.js        # Sound palette, drag-and-drop, beat grid
│   │   │   ├── workspace.js        # Undo/redo, shortcuts, resizable panels, dialogs
│   │   │   └── views.js            # Theme switch, Immersive/Pro views, drawers
│   │   └── main.js                 # Startup and event wiring
│   └── vendor/                 # Pinned Three.js r128 and OrbitControls
├── src/tailwind.css            # Tailwind input
├── tests/                      # Node test suites
├── tailwind.config.cjs
├── vercel.json
└── package.json
```

### How the code fits together

The app has no bundler. Each file in `public/js/` is a plain `<script>`, and `index.html` loads them in a fixed order. Classic scripts share one global scope, so later files can use functions and state declared in earlier ones. Files mostly declare things; the actual startup happens in `main.js` when the page finishes loading.

If you add a script, add it to `index.html` in dependency order. The tests read the same list from `index.html`, so they stay in sync automatically.

Styling comes from two layers: Tailwind utility classes in the markup (compiled into `public/css/tailwind.css`), and the hand-written stylesheets in `public/css/`, which load after Tailwind and take precedence.

## Development

| Command                | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Serves `public/` at <http://127.0.0.1:4173>           |
| `npm run build`        | Compiles Tailwind into `public/css/tailwind.css`      |
| `npm test`             | Runs all four test suites                             |
| `npm run format`       | Formats HTML, CSS, JS, and config files with Prettier |
| `npm run format:check` | Checks formatting without changing files              |

Run `npm run build` after adding or changing Tailwind classes, and commit the regenerated `public/css/tailwind.css` so the site still works without a build step. If a class only ever appears in markup generated at runtime, add it to the `safelist` in `tailwind.config.cjs`.

### Tests

The tests run in plain Node with no browser:

- `tests/song-generator.test.cjs` generates 540 songs across every style, length, energy, and seed combination. It checks that seeds are deterministic, pitches stay in the scale, songs have distinct sections and dynamics, and that every generated song reopens through the real importer.
- `tests/arrangement-effects.test.cjs` checks clip and whole-bar applications, batch undo checkpoints, full and empty racks, playback isolation, scoped copying, duplicate players, badge markup, drop targets, and persistence.
- `tests/effects.test.cjs` checks all 21 effect graphs, isolated routing, bypass, node cleanup, song persistence, legacy imports, copied bars, and stage visuals.
- `tests/workspace.test.cjs` runs the real camera-framing code through 150 layout changes (desktop, portrait, landscape, and ultrawide) to check projection, clipping, and drawing-buffer reuse. It also checks keyboard shortcut routing across focused buttons, sliders, text fields, and dialogs.

## Deploying to Vercel

The repository is ready to deploy as a static site. `vercel.json` sets the build command (`npm run build`) and serves the `public/` folder, with no framework preset.

**From the Vercel dashboard:** push this repository to GitHub, GitLab, or Bitbucket, then choose **Add New → Project** in Vercel and import it. The settings in `vercel.json` are picked up automatically, so you can deploy with the defaults.

**From the command line:**

```sh
npm install --global vercel
vercel          # create a preview deployment
vercel --prod   # deploy to production
```

The deployment also:

- Serves clean URLs (no `.html` suffixes).
- Permanently redirects the old `/sonicstage_3d_interactive_instrument_loop_station.html` address to `/`.
- Sends basic security headers and caches the pinned files in `vendor/` for a week.

## Credits

- [Three.js](https://threejs.org/) r128 and its OrbitControls (MIT). License headers are kept in `public/vendor/`.
- [Tailwind CSS](https://tailwindcss.com/) for utility classes.
- Fonts: [DM Sans](https://fonts.google.com/specimen/DM+Sans), [Manrope](https://fonts.google.com/specimen/Manrope), and [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono), loaded from Google Fonts.

The effects suite also checks player moves, stage compaction, and fast drag handling. To verify actual Web Audio output, copy `tests/effects-audio.html` to `public/__effects-audio-test.html`, start the dev server, and open that page. It renders every effect at zero and 80% amount plus five four-effect chains in `OfflineAudioContext`; remove the copied page afterward.
