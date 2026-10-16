# SonicStage

A colorful music playground with a sound browser, editable 16-step beats, a song arrangement, and a live 3D stage.

## Run

```sh
npm run dev
```

Open **http://127.0.0.1:4173**. The checked-in app works without installing packages. You can also open `sonicstage_3d_interactive_instrument_loop_station.html` directly; serving locally gives browser storage and audio a consistent origin.

## Session controls

- **Immersive** is the default view: a full-width stage, player controls, a horizontal sound browser, and a compact floating transport. Tap a player to adjust its sound. **Pro** opens the full studio with arrangement, harmony, recording, and effects controls. Both views edit the same song; switching preserves your work.
- The sun/moon button switches between neutral light and dark themes, including the 3D stage. Theme and view preferences are remembered.
- **Sounds** and **Beats** slide their panels in and out. Immersive shows one drawer at a time; Pro allows both. Escape closes the current Immersive drawer.
- **New**, **Open**, **Continue**, and **Generate** are on the start page. Click the SonicStage wordmark to return there.
- **Generate** composes an editable 8-, 16-, or 32-bar song in House, Lo-fi, Funk, or Cinematic style. Composition runs locally and does not require an API key.
- **Save song** downloads a SonicStage JSON file. Sessions also autosave in the current browser. Undo/redo cover edits and session replacements during the current visit.
- Drag the border beside **Sounds** or above the **Beat editor** to resize. In Immersive and on phones, drag above Sounds to change its height. Double-click a divider or press Home to reset; focused dividers respond to arrow keys. Pro panel sizes are remembered separately for phones and desktops.
- Click a sound to add/remove it in the selected bar. Click a stage label to focus its track. Mute, solo, gain, pan, octave, shuffle, and reset controls sit beside the beat grid. Click a track name to open its full controls, including pan and pattern tools on phones.
- Click beat steps to toggle them; Shift-click cycles note or drum variations. Arrow keys move between focused steps and tracks.
- Space plays/pauses, Enter plays from the beginning, 0 stops, and `?` opens shortcuts, including when buttons, dropdowns, sliders, or beat steps have focus. Command/Control-S saves; Command/Control-Z undoes; Shift-Command/Control-Z redoes. Text and number fields retain normal typing and text undo; dialogs retain their native keyboard controls.
- **FX rack** contains master EQ, filter, drive, reverb, delay, swing, compression, and master level. **Record** captures the live master while you play; stopping the recording downloads the browser's supported audio format.

WebGL and Web Audio are required for the stage and playback. Fonts load from Google Fonts; JavaScript and compiled utility CSS are served locally. Motion follows the device's reduced-motion setting.

The 3D canvas fills the frame behind the controls. The camera and player labels follow the clear workspace above/beside the panels, so resizing or hiding a panel changes the composition without exposing a blank strip.

## Development

```sh
npm ci
npm run build:css
npm test
```

The source app remains in the original HTML file. `studio.css` and `studio.js` contain workspace interactions; `playful.css` and `experience.js` contain the theme, view switch, and animated panels. `brand-mark.svg` is the shared logo and favicon. `song-generator.js` contains procedural composition. Run `build:css` after changing utility classes. `vendor/` contains the pinned Three.js r128 build, OrbitControls, and generated utility CSS; third-party licenses are preserved in those files.

The generator suite checks 144 combinations of style, length, energy, and seed, including determinism, harmony, section development, dynamics, independent bars, validation, and import round trips. Desktop and 320/390-pixel phone layouts were reviewed in Chrome, including new/open, playback, undo/redo, resize, and restore workflows.

Workspace regressions exercise 150 camera layout changes, projection placement, clipping limits, zero-size recovery, drawing-buffer reuse, and shortcut routing across control and text-field focus. Portrait, landscape, and short ultrawide layouts were also checked in Chrome for matching canvas/buffer dimensions and active WebGL rendering.
