# SonicStage song file format

This guide explains how SonicStage song files work and how to create, validate, import, and share them. Save songs as UTF-8 `.json` files, such as `midnight-groove.json`. A song file contains synthesized instrument patterns and arrangement data; audio recordings, MIDI files, sample URLs, and lyrics are not song imports.

## Creating a song file

1. Choose a tempo, meter, root key, scale, and song structure.
2. Choose existing instrument IDs from `public/js/music/presets.js`. Inspect each preset's `steps` and `synthType` before writing its events.
3. Create one object per bar in `measures`. Each bar contains its own complete instrument patterns and mix settings. Nothing carries forward automatically from the preceding bar.
4. Keep a consistent slot index for each player across bars. Omit a player from a bar when it should be absent.
5. Write exactly 16 `steps` and 16 `heights` per included player, even in a shorter meter.
6. Validate the JSON with the real importer using the command below. Then open it in the studio and listen: structural validation does not verify instrument-specific event shapes or musical quality.
7. Save or share the JSON file. When sharing, include its title, tempo, key, and bar count. No application changes are needed to add a song.

The source of truth is `readSongDocument()` in [song.js](public/js/music/song.js). This guide describes the current version 1 contract; check the source again if the app changes.

## Complete, importable example

Save this JSON as `midnight-groove.json`. It is a one-bar C-Dorian loop with drums, bass, and Rhodes chords. Extend `measures` to write a full arrangement.

```json
{
  "format": "sonicstage-song",
  "version": 1,
  "title": "Midnight Groove",
  "bpm": 108,
  "timeSignature": "4/4",
  "rootKey": 0,
  "scaleMode": "dorian",
  "globalSwing": 0.08,
  "masterEffects": [],
  "loop": true,
  "selected": 0,
  "measures": [
    {
      "label": "Groove",
      "slots": [
        {
          "index": 0,
          "presetId": "drums_boombap",
          "steps": ["K", "H", null, "H", "S", "H", null, "H", "K", "H", "K", "H", "S", "H", null, "H"],
          "heights": [1, 0.35, 0, 0.4, 0.9, 0.35, 0, 0.4, 0.95, 0.35, 0.8, 0.4, 0.9, 0.35, 0, 0.45],
          "volume": 0.72,
          "pan": 0,
          "effects": [],
          "pitchShift": 0,
          "muted": false,
          "solo": false
        },
        {
          "index": 1,
          "presetId": "bass_upright",
          "steps": [36, null, null, 43, null, null, 46, null, 36, null, 39, null, 43, null, null, 34],
          "heights": [0.9, 0, 0, 0.65, 0, 0, 0.7, 0, 0.85, 0, 0.65, 0, 0.75, 0, 0, 0.6],
          "volume": 0.65,
          "pan": 0,
          "effects": [],
          "pitchShift": 0,
          "muted": false,
          "solo": false
        },
        {
          "index": 2,
          "presetId": "chords_rhodes",
          "steps": [
            [60, 63, 67, 70],
            null,
            null,
            null,
            null,
            null,
            [60, 63, 67, 70],
            null,
            null,
            null,
            [58, 62, 65, 69],
            null,
            null,
            null,
            null,
            null
          ],
          "heights": [0.75, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0.65, 0, 0, 0, 0, 0],
          "volume": 0.48,
          "pan": -0.15,
          "effects": [{ "id": "room", "amount": 0.2, "enabled": true }],
          "pitchShift": 0,
          "muted": false,
          "solo": false
        }
      ]
    }
  ]
}
```

## Song fields

All numeric values below must be JSON numbers, not quoted strings, and must be finite.

| Field           | Contract                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`        | Required; exactly `"sonicstage-song"`.                                                                                                                                                   |
| `version`       | Required; number `1`.                                                                                                                                                                    |
| `bpm`           | Required; 1–2400 inclusive. Quarter-note tempo in every meter.                                                                                                                           |
| `rootKey`       | Required integer, 0–11: C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B.                                                                                                                         |
| `scaleMode`     | Required; `dorian`, `minor`, `major`, `harmonicMinor`, `phrygian`, `lydian`, or `mixolydian`. Case matters.                                                                              |
| `globalSwing`   | Required; 0–0.65. Use e.g. `0.08` for 8%. Playback disables swing above 260 BPM.                                                                                                         |
| `measures`      | Required array of 1–1024 bar objects, played in array order.                                                                                                                             |
| `title`         | Optional string; applied title is limited to 60 characters. Defaults to `"Untitled song"` for a non-string or absent value.                                                              |
| `timeSignature` | Optional; defaults to `"4/4"`. Supported values are in the timing table below.                                                                                                           |
| `masterEffects` | Optional effect array; defaults to `[]`. Applies across the whole song.                                                                                                                  |
| `loop`          | Optional; only literal `false` disables song looping. Write an explicit boolean.                                                                                                         |
| `selected`      | Optional zero-based editor bar index; integer values are clamped to available bars, otherwise defaults to 0. Use 0 for new songs.                                                        |
| `id`            | Optional project identity. Omit for a new composition so opening it creates an identity. For an existing project, valid IDs are 8–80 ASCII word characters or hyphens (`^[\w-]{8,80}$`). |

Tempo, key, meter, and swing are global; there is no per-bar tempo or key automation in this format. Extra fields such as generator `style` are not included by the normal song exporter. Do not rely on arbitrary metadata surviving a save.

## Bars and players

Each measure requires `label` (string, truncated to 40 characters on import) and `slots` (array of 0–100 player objects). An empty `slots` array creates a silent bar.

Each included player requires:

| Field        | Contract                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `index`      | Unique integer 0–99 within that bar; identifies the stage/player position.                      |
| `presetId`   | Exact existing ID in `INSTRUMENT_PRESETS`; a display name or `synthType` is not an ID.          |
| `steps`      | Exactly 16 events; use `null` for a rest. Event types depend on the preset (see below).         |
| `heights`    | Exactly 16 numbers from 0 to 1. Controls visual intensity and playback velocity.                |
| `volume`     | Number 0–1. Slots at or below 0.001 are inaudible.                                              |
| `pan`        | Number -1 (left) to 1 (right); 0 is center.                                                     |
| `pitchShift` | Exactly -12, 0, or 12; octave shift for pitched events.                                         |
| `muted`      | Boolean.                                                                                        |
| `solo`       | Boolean. If any populated player is soloed in a bar, only soloed players can sound in that bar. |
| `effects`    | Optional effect array; defaults to `[]`.                                                        |

The importer expands omitted positions to empty players; it does not copy previous patterns. Reusing an index with a different preset is allowed, but consistent player identities make an arrangement easier to edit. Multiple players can use the same preset if their indices differ.

For authored songs, use height 0 on rests and positive heights on hits (e.g. 0.3 ghost note, 0.7 regular, 1 accent). Height 0 alone does **not** silence an event: the engine falls back to a default velocity for nonpositive heights. Silence requires a `null` step or a muted/inaudible slot. Velocity for a positive height is `0.25 + 0.75 * height`.

## Timing and note length

| Meter | Played indices (zero-based) | Sixteenth steps per bar |
| ----- | --------------------------- | ----------------------- |
| `2/4` | 0–7                         | 8                       |
| `3/4` | 0–11                        | 12                      |
| `4/4` | 0–15                        | 16                      |
| `5/8` | 0–9                         | 10                      |
| `6/8` | 0–11                        | 12                      |
| `7/8` | 0–13                        | 14                      |

Always store 16 entries; pad unused positions with `null` steps and zero heights. In 4/4, quarter-note beats start at indices 0, 4, 8, and 12. Each step lasts `15 / bpm` seconds before swing. A bar lasts `playedSteps * 15 / bpm` seconds. Global swing alternates longer and shorter sixteenths; some presets add their own offbeat swing.

Events trigger at step boundaries. A rest skips a trigger; it does not send a note-off or stop an existing release tail. Instruments choose their own envelope lengths, so notes can ring across bars. There is no general tie, sustain, or configurable duration event: `dur`, `vel`, and `to` are accepted object keys by the validator but do not provide general note-duration, velocity, or slide controls in playback. Use `heights` for velocity and supported vocal `slide` events for pitch glides.

## Instrument event shapes

Inspect the selected preset's default pattern and the `triggerInstrument()` switch in [audio-engine.js](public/js/music/audio-engine.js). Match its shape, even if another shape passes validation.

| Instrument/example                             | Non-rest event                                          | Meaning                                                              |
| ---------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `drums_boombap`                                | `"K"`, `"S"`, `"H"`                                     | Kick, snare, hi-hat.                                                 |
| `drums_trap808`                                | `"K"`, `"S"`, `"H"`, `"R"`                              | Includes a hi-hat roll.                                              |
| `bass_upright`, `melody_sax`, `strings_violin` | `48`                                                    | Single source MIDI pitch.                                            |
| `chords_rhodes`, `strings_frenchhorn`          | `[60, 63, 67]`                                          | Simultaneous source pitches. Use arrays even for one-note chords.    |
| `vocal_talkbox`                                | `{"n": 60, "v": "O", "v2": "A", "c": "t", "slide": 58}` | Single pitch, vowel morph, optional consonant and glide destination. |
| `vocal_choir`                                  | `{"notes": [60, 63, 67], "v": "A", "v2": "O"}`          | Vocal chord and vowel morph.                                         |
| `vocal_beatbox`                                | `{"b": "B", "v": "U"}`                                  | Beatbox syllable; presets also use `TS`, `K`, and `PF`.              |

Drum tokens vary by kit; `"S"` is not universally a snare. Categories do not reliably determine event shape: some strings use arrays, some use numbers; `vocal_whistle` uses a number. Copy the specific preset's convention. Vowels are uppercase `A`, `E`, `I`, `O`, `U`. Vocal events synthesize sounds, not arbitrary sung text.

The generic validator accepts `null`, numbers in -128–255, strings of at most 16 characters, numeric arrays of up to 16 elements, and objects whose keys are drawn from `n`, `slide`, `notes`, `v`, `v2`, `c`, `b`, `to`, `dur`, `vel`. Object values must be numbers in that range, strings up to 16 characters, or numeric arrays up to 16 elements. It does not check that a step suits the chosen synth. For example, giving Rhodes a number instead of an array can pass import and fail playback.

## Pitch mapping: compose in source C Dorian

Pitches are MIDI-like source notes, then transformed by the global scale and root. Prefer source pitch classes `0, 2, 3, 5, 7, 9, 10` (C, D, Eb, F, G, A, Bb). Examples: bass `36, 38, 39, 41, 43, 45, 46`; upper octave `60, 62, 63, 65, 67, 69, 70`. Use practical registers rather than the validator's extreme numeric bounds.

`midiToFreq()` maps source pitch classes through `SCALE_DEFINITIONS[scaleMode].chromaMap`, then adds the root shift. Roots 7–11 shift down by an octave equivalent (G is -5 semitones, A is -3) to keep registers centered. This is a mapping, not a general scale quantizer.

For example, source `[60, 63, 67]` with root C and `dorian` sounds C–Eb–G. The same stored pitches with root C and `major` sound C–E–G. With root D and `major`, they sound D–F#–A. Write source C-Dorian pitches and let the global settings transpose them; pre-transposing to the target key would transpose twice. A slot's octave shift is applied before the global mapping.

## Effects

Both `masterEffects` and each player's `effects` accept at most four entries, in signal-chain order. IDs must be unique within each chain. Every entry requires an existing `id`, numeric `amount` from 0 to 1, and boolean `enabled`:

```json
[
  { "id": "warmth", "amount": 0.3, "enabled": true },
  { "id": "echo", "amount": 0.18, "enabled": false }
]
```

Supported IDs: `bass-boost`, `warmth`, `air`, `telephone`, `underwater`, `wah`, `overdrive`, `fuzz`, `bitcrush`, `echo`, `slapback`, `dub-delay`, `room`, `hall`, `cavern`, `chorus`, `flanger`, `vibrato`, `tremolo`, `auto-pan`, `ring-mod`.

Player effects are stored separately in every bar. Master inserts apply to the whole arrangement. The format does not serialize every live Pro FX control; use the fields emitted by `songDocument()` rather than inventing EQ, compressor, or reverb fields. See [effects.js](public/js/music/effects.js) for the current registry.

## Validate with the actual importer

Run this from the repository root after saving the song. Replace `midnight-groove.json` with your path. It uses the same source-loading approach as `tests/song-generator.test.cjs` and requires Node.js 18+ with no additional packages.

```sh
node - midnight-groove.json <<'NODE'
const fs = require('node:fs');
const vm = require('node:vm');
const { appSource } = require('./tests/app-source.cjs');
const source = appSource();
const start = source.indexOf('const KEY_NAMES =');
const end = source.indexOf('function applySongDocument(');
if (start < 0 || end <= start) throw new Error('App source boundaries changed');
const context = vm.createContext({
  structuredClone,
  window: { matchMedia: () => ({ matches: false }) },
  document: { getElementById: () => ({ value: 'Validation' }) }
});
vm.runInContext(source.slice(start, end), context);
const filename = process.argv[2];
if (fs.statSync(filename).size > 128 * 1024 * 1024) {
  throw new Error('Song file exceeds the 128 MB import limit');
}
context.input = JSON.parse(fs.readFileSync(filename, 'utf8'));
const parsed = vm.runInContext('readSongDocument(input)', context);
console.log(`Valid SonicStage song: ${parsed.measures.length} bars`);
NODE
```

This validates the document without opening audio or replacing a song. The parsed result contains expanded runtime slots and preset objects; use the original JSON file for importing and sharing.

Before importing or sharing a song, also check that every non-rest event matches its preset; shorter meters have silent padding; instruments use sensible source registers; `solo` is false unless intentional; and sections develop through changes in rhythm, harmony, orchestration, and dynamics. Keep dense ensembles reasonable: playback schedules at most 18 player triggers per step, prioritizing synth variety and rotating remaining players.

## Opening and saving

Start the app with `npm run dev`, open `http://127.0.0.1:4173`, and choose **Open** on the start page (click the SonicStage wordmark to return there). Select the JSON file. The UI rejects files larger than 128 MiB, parses JSON, and validates the entire document before replacing the current song. A successful import stops playback, loads the selected bar, enters the studio, and autosaves in the browser. Use Enter to play from the beginning and listen through the arrangement.

**Save song** exports the current song as `sonicstage-song.json`. Browser autosave uses local storage key `sonicstage-song-v1`; keep an exported file for a portable copy.

Typical import errors:

| Error                                            | Check                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Unable to read this song file.                   | Malformed JSON: comments, trailing commas, or unquoted keys.                       |
| Choose a SonicStage song file (1–1024 measures). | Format/version markers and bar count.                                              |
| Invalid song tempo, meter, or harmony.           | Required global fields, numeric ranges, and exact scale/meter names.               |
| Invalid measure data.                            | String label, slots array, maximum 100 players per bar.                            |
| Invalid instrument data.                         | Preset ID, unique slot index, 16-element arrays, mix ranges, octave, and booleans. |
| Invalid beat data.                               | Unsupported event keys, types, or values.                                          |
| Invalid performer/master effects.                | Existing IDs, unique entries, maximum four, amount range, enabled boolean.         |

## Source references

- [song.js](public/js/music/song.js): `songDocument`, `readSongDocument`, `applySongDocument`, and import/export handlers.
- [presets.js](public/js/music/presets.js): instrument IDs, example event shapes, and modal pitch mapping.
- [app-state.js](public/js/music/app-state.js): meters, slot limits, and audibility rules.
- [audio-engine.js](public/js/music/audio-engine.js): timing, velocity, synth event handling, and envelope behavior.
- [effects.js](public/js/music/effects.js): effect IDs and chain limits.
- [song-generator.js](public/js/music/song-generator.js): reference composition logic and version 1 document construction.
- [song-generator.test.cjs](tests/song-generator.test.cjs): examples of generated songs being checked by the real importer.
