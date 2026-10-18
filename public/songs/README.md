# Song presets

Choose **Open** on the SonicStage start page and select a JSON file from this folder. These are complete editable songs following [SONG_FILE_GUIDE.md](../../SONG_FILE_GUIDE.md).

## Piano Keyboard Score — Full Band

Choose **Load Example**, select the **Piano Keyboard Score** style, and click **Load Example**, or import [the song JSON](keyboard-score-piano.json).

A transcription of the complete [supplied keyboard score](keyboard-score.txt), with the original grand piano part at the center of an evolving seven-player ensemble. Brackets play simultaneous notes; uppercase letters and shifted number keys retain their sharp pitches. Every source event is preserved in order, including repeated notes and pauses.

- **Tempo:** 128 BPM, straight 4/4 (tempo supplied by the user).
- **Timing:** each note/chord or dash occupies an eighth note; whitespace, including line breaks, separates notation without adding time. Lines have varying lengths, so phrases continue across bar boundaries. The last bar is padded with silence.
- **Pitch:** standard Virtual Piano mapping, starting at `1 = C2`; e.g. `7 = B2`, `r = B3`, `I = F#4`, `T = C#4`. C root and the engine's identity Dorian mapping preserve every chromatic pitch without scale remapping; this setting does not assert that the piece is in C Dorian.
- **Length:** 49 bars, about 1:32; looping disabled so the score ends naturally.
- **Form:** piano opening (4 bars), theme (12), lift (8), chorus (8), interlude (4), final chorus (8), coda (5).
- **Sound:** grand piano, Moog bass, gated Linndrum, hats, symphonic strings, crystal arpeggios, and cello. Bass and chord voicings follow the lower voice of the score in B major. The ensemble grows through the lift, drops to piano/bass/cello in the interlude, peaks with seven players in the final chorus, and fades back to piano. Note lengths use instrument envelopes; the notation does not specify exact sustain or pedal timing.
- **Style controls:** one fixed 49-bar length and original energy arrangement. Other styles retain their adjustable lengths and energies.
- **Title:** a descriptive placeholder; no song title was supplied.

Rebuild the preset from its source with `node scripts/build-keyboard-score.cjs`.

## Stay at Your House - Neon Echo

[Open the song JSON](stay-at-your-house-neon-echo.json).

An original synth-pop arrangement inspired by the shimmering, wistful sound of “I Really Want to Stay at Your House.” It uses synthesized vowel vocals and an original melodic motif, with warm chords, pulsing bass, crystal arpeggios, gated drums, and a brighter chorus.

- **Tempo:** 125 BPM, straight 4/4.
- **Key:** F# major, using C-Dorian source pitches as required by the engine.
- **Length:** 64 bars, about 2:03, looping enabled.
- **Form:** intro (8), verse (8), lift (8), chorus (16), breakdown (8), final chorus (12), outro (4).
- **Players:** up to eight, with consistent slot positions throughout the arrangement.

Tempo reference: [SongBPM's Rosa Walton recording listing](https://songbpm.com/%40rosa-walton/i-really-want-to-stay-at-your-house).
