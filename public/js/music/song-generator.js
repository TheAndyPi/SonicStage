/*
 * Local song composer. Returns a regular SonicStage document without changing
 * the open song, so callers can take an undo snapshot before applying it.
 *
 * generateSong({ style: 'house', bars: 32, energy: 'medium', seed: 'optional' })
 * applySongDocument(readSongDocument(generateSong(options)))
 *
 * A song is written in layers: a form of sections, a chord progression for each
 * kind of section, then one part per role (drums, bass, chords, lead, ...).
 * Melodies are composed once per kind of section and repeated wherever that
 * section returns, which is what makes a chorus recognizable the second time.
 */
(function (scope) {
    'use strict';

    // Notes are encoded in the editor's source C Dorian scale. The audio engine
    // maps them to the document's key and mode at playback time, so every part
    // is written in scale degrees and stays in key for any mode.
    const SOURCE_SCALE = [0, 2, 3, 5, 7, 9, 10];
    const LENGTHS = [8, 16, 32, 64];
    const ENERGIES = ['low', 'medium', 'high'];

    const METERS = {
        '4/4': { steps: 16, beat: 4, strong: [0, 8] },
        '3/4': { steps: 12, beat: 4, strong: [0] },
        '6/8': { steps: 12, beat: 6, strong: [0, 6] },
    };

    const EDM = { intro: 'Intro', verse: 'Groove', pre: 'Build', chorus: 'Drop', bridge: 'Breakdown', outro: 'Outro' };
    const SONG = {
        intro: 'Intro',
        verse: 'Verse',
        pre: 'Pre-chorus',
        chorus: 'Chorus',
        bridge: 'Bridge',
        outro: 'Outro',
    };
    const JAM = { intro: 'Intro', verse: 'Head', pre: 'Turnaround', chorus: 'Hook', bridge: 'Solo', outro: 'Outro' };
    const SCORE = {
        intro: 'Opening',
        verse: 'Theme',
        pre: 'Rising',
        chorus: 'Climax',
        bridge: 'Interlude',
        outro: 'Coda',
    };
    const DRIFT = { intro: 'Dawn', verse: 'Drift', pre: 'Swell', chorus: 'Bloom', bridge: 'Still', outro: 'Fade' };

    const FORMS = {
        song: {
            8: [
                ['intro', 1],
                ['verse', 2],
                ['chorus', 4],
                ['outro', 1],
            ],
            16: [
                ['intro', 2],
                ['verse', 4],
                ['chorus', 4],
                ['bridge', 2],
                ['chorus', 4],
            ],
            32: [
                ['intro', 2],
                ['verse', 8],
                ['pre', 2],
                ['chorus', 8],
                ['bridge', 4],
                ['chorus', 8],
            ],
            64: [
                ['intro', 4],
                ['verse', 8],
                ['pre', 4],
                ['chorus', 8],
                ['verse', 8],
                ['pre', 4],
                ['chorus', 8],
                ['bridge', 8],
                ['chorus', 8],
                ['outro', 4],
            ],
        },
        edm: {
            8: [
                ['intro', 1],
                ['pre', 2],
                ['chorus', 4],
                ['outro', 1],
            ],
            16: [
                ['intro', 2],
                ['verse', 2],
                ['pre', 2],
                ['chorus', 4],
                ['bridge', 2],
                ['chorus', 4],
            ],
            32: [
                ['intro', 4],
                ['verse', 4],
                ['pre', 4],
                ['chorus', 8],
                ['bridge', 4],
                ['chorus', 8],
            ],
            64: [
                ['intro', 8],
                ['verse', 8],
                ['pre', 4],
                ['chorus', 8],
                ['bridge', 8],
                ['pre', 4],
                ['chorus', 8],
                ['verse', 8],
                ['outro', 8],
            ],
        },
    };

    // Four-chord loops in scale degrees (0 = tonic). Diminished triads are left
    // out of each mode's loops because they don't hold up as a home chord.
    const HARMONY = {
        minor: {
            loop: [
                [0, 5, 2, 6],
                [0, 6, 5, 6],
                [0, 3, 6, 2],
                [0, 5, 3, 4],
                [0, 2, 6, 5],
                [0, 3, 5, 6],
                [5, 6, 0, 0],
                [0, 6, 3, 5],
            ],
            bridge: [
                [3, 5, 6, 6],
                [5, 6, 3, 4],
                [3, 2, 5, 6],
                [5, 3, 6, 6],
            ],
            pre: [
                [3, 4],
                [5, 6],
                [3, 6],
                [5, 4],
            ],
        },
        major: {
            loop: [
                [0, 4, 5, 3],
                [5, 3, 0, 4],
                [0, 5, 3, 4],
                [3, 4, 2, 5],
                [0, 3, 5, 4],
                [0, 2, 3, 4],
                [3, 0, 4, 5],
                [0, 4, 3, 3],
            ],
            bridge: [
                [3, 4, 5, 5],
                [5, 3, 1, 4],
                [3, 2, 1, 4],
                [1, 3, 4, 4],
            ],
            pre: [
                [3, 4],
                [1, 4],
                [5, 4],
                [3, 1],
            ],
        },
        dorian: {
            loop: [
                [0, 3, 0, 3],
                [0, 6, 3, 0],
                [0, 2, 3, 3],
                [0, 4, 3, 0],
                [0, 3, 6, 3],
                [0, 1, 2, 3],
            ],
            bridge: [
                [3, 4, 6, 6],
                [2, 3, 4, 4],
                [6, 3, 2, 4],
            ],
            pre: [
                [3, 4],
                [6, 3],
                [2, 4],
            ],
        },
        mixolydian: {
            loop: [
                [0, 6, 3, 0],
                [0, 0, 6, 3],
                [0, 3, 6, 3],
                [0, 6, 4, 3],
                [3, 6, 0, 0],
            ],
            bridge: [
                [3, 4, 6, 6],
                [5, 3, 6, 4],
                [1, 3, 6, 6],
            ],
            pre: [
                [3, 6],
                [1, 4],
                [6, 3],
            ],
        },
        harmonicMinor: {
            loop: [
                [0, 5, 3, 4],
                [0, 3, 4, 0],
                [0, 3, 5, 4],
                [5, 3, 4, 4],
                [0, 0, 3, 4],
            ],
            bridge: [
                [3, 5, 4, 4],
                [5, 3, 4, 4],
            ],
            pre: [
                [3, 4],
                [5, 4],
            ],
        },
        phrygian: {
            loop: [
                [0, 1, 0, 1],
                [0, 1, 6, 1],
                [0, 6, 5, 1],
                [0, 1, 2, 1],
                [0, 0, 1, 6],
            ],
            bridge: [
                [5, 6, 1, 1],
                [3, 5, 1, 1],
            ],
            pre: [
                [1, 1],
                [5, 1],
            ],
        },
    };

    const COLORS = {
        triad: [0, 2, 4],
        seventh: [0, 2, 4, 6],
        ninth: [0, 2, 6, 8],
        sus: [0, 3, 4],
    };

    // Melody rhythm cells: onset steps for one bar.
    const CELLS = {
        16: {
            sparse: [
                [0, 6, 8],
                [0, 3, 8, 12],
                [0, 4, 10],
                [2, 8, 10],
                [0, 6, 10, 12],
                [4, 8, 12],
                [0, 8, 11],
                [0, 3, 6],
            ],
            straight: [
                [0, 2, 4, 8, 10, 12],
                [0, 4, 6, 8, 12],
                [0, 2, 4, 6, 8, 12],
                [0, 4, 8, 10, 12, 14],
                [2, 4, 6, 8, 12],
                [0, 2, 4, 6, 8],
            ],
            syncopated: [
                [0, 3, 6, 8, 11, 14],
                [0, 3, 6, 10, 12],
                [2, 5, 8, 11, 14],
                [0, 3, 7, 10, 12],
                [0, 6, 8, 11, 14],
                [3, 6, 8, 10, 14],
                [0, 3, 6, 8, 10],
            ],
            busy: [
                [0, 2, 3, 4, 6, 8, 10, 11, 12, 14],
                [0, 1, 2, 4, 6, 7, 8, 10, 12, 14],
                [0, 2, 4, 5, 6, 8, 10, 12, 13, 14],
                [0, 2, 3, 6, 8, 10, 11, 14],
            ],
        },
        12: {
            sparse: [
                [0, 6],
                [0, 4, 8],
                [0, 8],
                [0, 6, 10],
                [0, 3, 6],
            ],
            straight: [
                [0, 2, 4, 6, 8],
                [0, 4, 6, 8],
                [0, 2, 4, 8],
                [0, 6, 8, 10],
                [0, 2, 4, 6, 8, 10],
            ],
            syncopated: [
                [0, 3, 6, 9],
                [0, 2, 6, 10],
                [2, 4, 6, 8, 10],
                [0, 3, 6, 8],
            ],
            busy: [
                [0, 2, 4, 6, 8, 10],
                [0, 1, 2, 4, 6, 8, 10],
                [0, 2, 3, 4, 6, 8, 9, 10],
            ],
        },
    };

    const CONTOURS = {
        arch: t => Math.sin(t * Math.PI) * 3 - 0.5,
        rise: t => t * 4 - 1.5,
        fall: t => 2 - t * 4,
        wave: t => Math.sin(t * Math.PI * 2) * 2,
    };
    const ANSWER = { arch: 'fall', rise: 'fall', fall: 'rise', wave: 'arch' };

    // Groove strings: one character per step. Upper case is accented, lower
    // case is normal, `g` is a ghost snare, `,` a soft closed hat, `.` a rest.
    // K kick, S snare/clap, H closed hat, O open hat, X hat roll, R rim,
    // T low tom, M mid tom, P shaker or hand percussion, B cowbell.
    const KITS = {
        boombap: { k: 'K', s: 'S', h: 'H' },
        trap808: { k: 'K', s: 'S', h: 'H', x: 'R' },
        breakbeat: { k: 'K', s: 'S', h: 'H' },
        taiko: { k: 'T', t: 'T', m: 'M', s: 'M', p: 'S', h: 'S' },
        synthwave: { k: 'K', s: 'G', t: 'T', m: 'T', h: 'H' },
        funkyhats: { h: 'C', o: 'O', r: 'R' },
        afroperc: { k: 'L', t: 'L', m: 'H', s: 'H', r: 'O', p: 'S', h: 'S' },
        house909: { k: 'K', s: 'P', h: 'C', o: 'O' },
        ukgarage: { k: 'K', s: 'S', r: 'R', h: 'C', o: 'O' },
        bossa: { k: 'K', s: 'R', r: 'R', p: 'S', h: 'S' },
        industrial: { k: 'K', s: 'G', b: 'M', h: 'H' },
        jazzswing: { k: 'D', s: 'C', o: 'B', h: 'G', p: 'S', r: 'R' },
        cowbellperc: { k: 'L', s: 'B', b: 'B', r: 'H', p: 'S', h: 'S', m: 'L' },
        junkyard: { k: 'B', s: 'A', r: 'W', p: 'S', h: 'H' },
    };
    const KIT_FALLBACK = { o: ['h'], x: ['h'], t: ['m', 's'], m: ['t', 's'], p: ['h', 'r'], r: ['s'], b: ['r', 's'] };
    const FILLS = { 16: ['.sSS', 'ssSS', 'g.sS', 'sgsS', 'tTmM'], 12: ['.sSS', 'ssSS', 'gsSS'] };

    const CHORD_SYNTHS = new Set([
        'rhodes',
        'wurlitzer',
        'clavinet',
        'grandpiano',
        'b3organ',
        'dubchord',
        'accordion',
        'guitarstrum',
        'brass',
        'warmpad',
        'cyberarp',
        'frenchhorn',
        'brassstab',
        'glassarmonica',
        'singingbowls',
    ]);
    const VOICE_CHORD_SYNTHS = new Set(['choir', 'monks', 'vocoder', 'tuvancyborg']);
    const VOICE_SYNTHS = new Set(['talkbox', 'gospel', 'vocalchop', 'soprano']);

    // Relative loudness of a few synths, so each role sits at a similar level
    // whichever instrument is drawn for it.
    const LEVEL_TRIM = {
        chiptune: 0.72,
        teslacoil: 0.72,
        jawharp: 0.75,
        wobblebass: 0.85,
        acidbass: 0.9,
        cyberarp: 0.9,
        clavinet: 0.9,
        warmpad: 1.3,
        choir: 1.2,
        monks: 1.1,
        vocoder: 1.1,
        sax: 1.12,
        flute: 1.12,
        violin: 1.08,
        glassarmonica: 1.15,
        singingbowls: 1.1,
        brass: 1.1,
        accordion: 1.1,
    };

    const ROLE_ORDER = ['kit', 'bass', 'chords', 'lead', 'pad', 'hats', 'back', 'perc', 'arp', 'vocal'];
    const ROLE_LEVEL = {
        kit: 0.82,
        back: 0.6,
        hats: 0.38,
        perc: 0.42,
        bass: 0.72,
        chords: 0.46,
        pad: 0.34,
        lead: 0.6,
        arp: 0.3,
        vocal: 0.42,
    };
    const ROLE_PAN = {
        kit: 0,
        back: 0.04,
        hats: 0.22,
        perc: -0.26,
        bass: 0,
        chords: -0.2,
        pad: 0.18,
        lead: 0.08,
        arp: -0.32,
        vocal: 0.3,
    };
    const SECTION_GAIN = { intro: 0.8, verse: 0.9, pre: 0.92, chorus: 1, bridge: 0.84, outro: 0.86 };
    const VOWELS = [
        ['O', 'A'],
        ['A', 'E'],
        ['U', 'O'],
        ['A', 'I'],
        ['E', 'A'],
        ['O', 'U'],
    ];

    const STYLES = {
        house: {
            name: 'House',
            blurb: 'Four on the floor',
            bpm: [120, 126],
            swing: [0.02, 0.06],
            modes: ['minor', 'dorian'],
            labels: EDM,
            form: 'edm',
            intro: 'drums',
            verseLead: false,
            bridgeDrums: 'none',
            bridgeHook: true,
            colors: ['seventh', 'ninth'],
            sameLoop: 0.75,
            drums: {
                kit: ['drums_house909'],
                back: ['drums_techno', 'drums_synthwave'],
                hats: ['drums_hats'],
                grooves: [
                    {
                        kit: 'K...K...K...K...',
                        back: '....S.......S...',
                        hats: '..o...o...o...o.',
                        hatsFull: 'h,o,h,o,h,o,h,o,',
                    },
                    {
                        kit: 'K...K...K...K..k',
                        back: '....S.......S..s',
                        hats: '..o...o...o...o.',
                        hatsFull: ',,O,,,O,,,O,,,O,',
                    },
                    {
                        kit: 'K...K...K...K...',
                        back: '....S.......S...',
                        hats: 'h.o.h.o.h.o.h.o.',
                        hatsFull: 'h,o,h,o,h,o,h,oo',
                    },
                ],
            },
            bass: {
                presets: ['bass_moog', 'bass_synthwave', 'bass_donk', 'bass_sub808'],
                verse: ['..r...r...r...r.', 'R..r..r...r..r..'],
                chorus: ['..r...r...r...rn', '..rr..ro..rr..r.', 'R.r..r.oR.r..r.n'],
            },
            chords: {
                presets: ['chords_grand', 'chords_b3organ', 'chords_rhodes', 'chords_dx7', 'chords_juno'],
                verse: ['X..x..x.X..x..x.', '..x..x....x..x..', 'X.....x...x.....'],
                chorus: ['X..x..x.X..x..x.', '..x...x...x...x.', 'x.x..x.x..x..x.x'],
            },
            pad: { presets: ['strings_ensemble'] },
            lead: {
                presets: ['melody_bells', 'melody_marimba', 'melody_steelpan', 'melody_kalimba', 'melody_glock'],
                verse: 'sparse',
                chorus: 'syncopated',
            },
            arp: {
                presets: ['melody_kalimba', 'strings_pizz', 'melody_glock', 'strings_harp'],
                patterns: ['0.1.2.3.0.1.2.3.', '0..1..2.0..1..2.', '0.2.1.3.0.2.1.3.'],
            },
            vocal: { presets: ['vocal_chants', 'vocal_soulgroup', 'vocal_gospel'] },
            words: [
                ['Midnight', 'Neon', 'Velvet', 'Golden', 'Late', 'Glass', 'Warm'],
                ['Hours', 'Motion', 'Signal', 'Floor', 'Lights', 'Fever', 'Rooms'],
            ],
        },
        garage: {
            name: 'UK Garage',
            blurb: 'Shuffled two-step',
            bpm: [130, 134],
            swing: [0.12, 0.18],
            modes: ['minor', 'dorian'],
            labels: EDM,
            form: 'edm',
            intro: 'drums',
            verseLead: true,
            bridgeDrums: 'light',
            bridgeHook: true,
            colors: ['seventh', 'ninth'],
            sameLoop: 0.6,
            drums: {
                kit: ['drums_ukgarage'],
                hats: ['drums_hats'],
                grooves: [
                    { kit: 'K...S.....K.S...', hats: '..h...h...h...h.', hatsFull: ',.h,,.h,,.h,,.ho' },
                    { kit: 'K...S..k..K.S...', hats: '..h...h...h..hh.', hatsFull: '..h,..h,..h,.hh,' },
                    { kit: 'K...S.k...K.S..r', hats: '..o...o...o...o.', hatsFull: 'h.o,h.o,h.o,h.o,' },
                ],
            },
            bass: {
                presets: ['bass_reese', 'bass_sub808', 'bass_organped', 'bass_moog'],
                verse: ['R.....r...r.....', 'R......r..5.....'],
                chorus: ['R.....r...r..o..', 'R..r....r.5...n.'],
            },
            chords: {
                presets: ['chords_b3organ', 'chords_rhodes', 'chords_dx7', 'chords_wurli'],
                verse: ['..x...x...x.....', 'X.....x...x.....'],
                chorus: ['..x..x....x..x..', 'x..x..x...x..x..'],
            },
            pad: { presets: ['strings_ensemble'] },
            lead: { presets: ['vocal_chants', 'vocal_soprano', 'melody_bells'], verse: 'sparse', chorus: 'syncopated' },
            arp: { presets: ['melody_kalimba', 'melody_glock'], patterns: ['0..1..2.0..1..2.', '0.1.2.1.0.1.2.1.'] },
            vocal: { presets: ['vocal_soulgroup', 'vocal_choir'] },
            words: [
                ['Sunday', 'Pirate', 'Southside', 'Rewind', 'Silver', 'Late-night'],
                ['Radio', 'Shuffle', 'Bassline', 'Lovers', 'Weekend', 'Garage'],
            ],
        },
        techno: {
            name: 'Techno',
            blurb: 'Warehouse pulse',
            bpm: [128, 134],
            swing: [0, 0.03],
            modes: ['minor', 'phrygian'],
            labels: EDM,
            form: 'edm',
            intro: 'drums',
            verseLead: false,
            bridgeDrums: 'light',
            bridgeHook: true,
            colors: ['triad', 'sus'],
            sameLoop: 0.9,
            harmony: {
                minor: {
                    loop: [
                        [0, 0, 0, 0],
                        [0, 0, 6, 6],
                        [0, 0, 5, 6],
                        [0, 5, 0, 6],
                    ],
                },
                phrygian: {
                    loop: [
                        [0, 0, 1, 1],
                        [0, 1, 0, 1],
                        [0, 0, 0, 1],
                    ],
                },
            },
            drums: {
                kit: ['drums_techno'],
                back: ['drums_house909'],
                hats: ['drums_hats', 'drums_ukgarage'],
                grooves: [
                    {
                        kit: 'K...K...K...K...',
                        back: '....s.......s...',
                        hats: '..o...o...o...o.',
                        hatsFull: 'hho,hho,hho,hho,',
                    },
                    {
                        kit: 'K..bK...K.b.K...',
                        back: '....s.......s...',
                        hats: '..o...o...o...o.',
                        hatsFull: ',,o,,,o,,,o,,,oh',
                    },
                    {
                        kit: 'K...K..bK...K.b.',
                        back: '....S.......S...',
                        hats: 'h.o.h.o.h.o.h.o.',
                        hatsFull: 'hhohhhohhhohhhoh',
                    },
                ],
            },
            bass: { presets: ['bass_acid', 'bass_neuro', 'bass_moog'], acid: true },
            chords: {
                presets: ['chords_dubtechno', 'chords_juno', 'chords_supersaw'],
                verse: ['X...............', '..x.......x.....'],
                chorus: ['..x..x....x..x..', '...x..x....x..x.'],
            },
            pad: { presets: ['strings_ensemble', 'vocal_monks'] },
            lead: { presets: ['melody_teslacoil', 'melody_bells', 'vocal_chants'], verse: 'sparse', chorus: 'sparse' },
            arp: {
                presets: ['chords_arp', 'melody_glock', 'strings_pizz'],
                patterns: ['0123012301230123', '0.1.2.1.0.1.2.1.'],
            },
            vocal: { presets: ['vocal_hypeman', 'vocal_chants'] },
            words: [
                ['Concrete', 'Iron', 'Mercury', 'Black', 'Static', 'Engine'],
                ['Room', 'Cycle', 'Machine', 'Tunnel', 'Current', 'Hours'],
            ],
        },
        dnb: {
            name: 'Drum & Bass',
            blurb: 'Liquid and fast',
            bpm: [170, 176],
            swing: [0, 0.02],
            modes: ['minor', 'dorian'],
            labels: EDM,
            form: 'edm',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'none',
            bridgeHook: true,
            colors: ['seventh', 'ninth'],
            sameLoop: 0.5,
            drums: {
                kit: ['drums_dnb', 'drums_breakbeat'],
                hats: ['drums_hats'],
                grooves: [
                    { kit: 'K...S.....K.S...', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h,h,h,h,h,h,h,ho' },
                    { kit: 'K...S..k..K.S..g', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h,h,h,o,h,h,h,o,' },
                    { kit: 'K.g.S..gK.K.S.g.', hats: '..h...h...h...h.', hatsFull: 'h,h,h,h,h,h,h,h,' },
                ],
            },
            bass: {
                presets: ['bass_reese', 'bass_sub808', 'bass_organped'],
                verse: ['R.........r.....', 'R.....r.........'],
                chorus: ['R.....r...r...n.', 'R.........r..r..'],
            },
            chords: {
                presets: ['chords_rhodes', 'chords_dx7', 'chords_grand', 'chords_celesta'],
                verse: ['X.......x.......', 'X.........x.....'],
                chorus: ['X.....x...x.....', 'X.......x.....N.'],
            },
            pad: { presets: ['strings_ensemble', 'vocal_choir'] },
            lead: {
                presets: ['melody_bells', 'melody_flute', 'vocal_soprano', 'melody_kalimba'],
                verse: 'sparse',
                chorus: 'straight',
            },
            arp: {
                presets: ['strings_harp', 'melody_glock', 'melody_kalimba'],
                patterns: ['0.1.2.3.4.3.2.1.', '0.2.1.3.0.2.1.3.'],
            },
            vocal: { presets: ['vocal_choir', 'vocal_soulgroup', 'vocal_chants'] },
            words: [
                ['Liquid', 'Blue', 'Rolling', 'Rain', 'Distant', 'Open'],
                ['Skies', 'Horizon', 'Current', 'City', 'Tides', 'Lines'],
            ],
        },
        trap: {
            name: 'Trap',
            blurb: '808s and hat rolls',
            bpm: [136, 150],
            swing: [0, 0.03],
            modes: ['minor', 'harmonicMinor', 'phrygian'],
            labels: { ...SONG, pre: 'Pre-hook', chorus: 'Hook' },
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'light',
            colors: ['triad'],
            sameLoop: 0.85,
            drums: {
                kit: ['drums_trap808', 'drums_drill'],
                hats: ['drums_drill', 'drums_trap808'],
                grooves: [
                    { kit: 'K.......S.....k.', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h.hxh.h.h.hxh.xx' },
                    { kit: 'K......kS.....K.', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'hhh.hxh.hhh.x.xx' },
                    { kit: 'K..K....S...K...', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h.h.hxh.h.hxh.h.' },
                ],
            },
            bass: {
                presets: ['bass_sub808'],
                verse: ['R.......r.....r.', 'R......r..r.....'],
                chorus: ['R......r..r...N.', 'R..r....R.....r.'],
            },
            chords: {
                presets: ['chords_grand', 'chords_celesta', 'chords_glassarmonica'],
                verse: ['X.......x.......'],
                chorus: ['X.......x.......', 'X.....x.....x...'],
            },
            pad: { presets: ['vocal_choir', 'strings_ensemble', 'vocal_monks'] },
            lead: {
                presets: ['melody_bells', 'melody_glock', 'melody_flute', 'melody_kalimba', 'strings_pizz'],
                verse: 'syncopated',
                chorus: 'syncopated',
            },
            arp: { presets: ['strings_harp', 'melody_marimba'], patterns: ['0..1..2.0..1..2.', '0.1.2.1.0.1.2.1.'] },
            vocal: { presets: ['vocal_hypeman', 'vocal_chants'] },
            words: [
                ['Cold', 'Diamond', 'Ghost', 'Night', 'Chrome', 'Smoke'],
                ['Shift', 'Wave', 'Mode', 'Drive', 'City', 'Season'],
            ],
        },
        lofi: {
            name: 'Lo-fi',
            blurb: 'Dusty and mellow',
            bpm: [72, 88],
            swing: [0.14, 0.2],
            modes: ['dorian', 'minor', 'major'],
            labels: SONG,
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'groove',
            bridgeLead: 'solo',
            colors: ['seventh', 'ninth'],
            sameLoop: 0.6,
            drums: {
                kit: ['drums_boombap'],
                hats: ['drums_hats'],
                grooves: [
                    { kit: 'K...S..K..K.S...', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h.h,h.h.h.h,h.ho' },
                    { kit: 'K..gS...K.K.S..g', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h,h.h,h.h,h.h,h.' },
                    { kit: 'K...S.gK.gK.S...', hats: 'h...h...h...h...', hatsFull: 'h.h.h.h.h.h.h.h.' },
                ],
            },
            bass: {
                presets: ['bass_upright', 'bass_fretless', 'bass_picked'],
                verse: ['R......r..5.....', 'R.....r...5...n.'],
                chorus: ['R......r..5...n.', 'R..5..r...r...n.'],
            },
            chords: {
                presets: ['chords_rhodes', 'chords_wurli', 'chords_dx7', 'chords_grand'],
                verse: ['X......x..x.....', 'X.....x.........'],
                chorus: ['X......x..x...N.', 'X..x......x.....'],
            },
            pad: { presets: ['strings_ensemble', 'vocal_soulgroup'] },
            lead: {
                presets: ['melody_sax', 'melody_flute', 'melody_kalimba', 'melody_harmonica', 'vocal_whistle'],
                verse: 'sparse',
                chorus: 'syncopated',
            },
            arp: {
                presets: ['melody_kalimba', 'strings_harp', 'melody_glock'],
                patterns: ['0...1...2...3...', '0..1..2...1..0..'],
            },
            vocal: { presets: ['vocal_soulgroup', 'vocal_scat'] },
            words: [
                ['Slow', 'Rainy', 'Paper', 'Sleepy', 'Window', 'Quiet', 'Coffee'],
                ['Mornings', 'Rooms', 'Tapes', 'Streets', 'Sundays', 'Notes', 'Steam'],
            ],
        },
        funk: {
            name: 'Funk',
            blurb: 'Pocket & syncopation',
            bpm: [100, 112],
            swing: [0.05, 0.1],
            modes: ['mixolydian', 'dorian'],
            labels: JAM,
            form: 'song',
            intro: 'band',
            verseLead: true,
            bridgeDrums: 'groove',
            bridgeLead: 'solo',
            colors: ['seventh', 'ninth'],
            sameLoop: 0.4,
            drums: {
                kit: ['drums_breakbeat', 'drums_boombap'],
                hats: ['drums_hats'],
                grooves: [
                    { kit: 'K.gKS.g..KK.S.gk', hats: 'h.h.h.h.h.h.h.o.', hatsFull: 'h,h,h,h,h,h,h,o,' },
                    { kit: 'K..kS.g.K.k.S.gg', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h,h,o,h,h,h,o,h,' },
                    { kit: 'K.gkS..gK.g.S.k.', hats: 'h,h.h,h.h,h.h,h.', hatsFull: 'h,h,h,h,h,h,h,h,' },
                ],
            },
            bass: {
                presets: ['bass_slap', 'bass_disco', 'bass_moog', 'bass_fretless'],
                verse: ['R..o..5r..o5..n.', 'R.r..o.rR..5.o.n'],
                chorus: ['R..o..5r.ro5.on.', 'R.ro..5.r.o..5n.'],
            },
            chords: {
                presets: ['chords_clav', 'chords_guitar', 'chords_rhodes', 'chords_b3organ'],
                verse: ['..x..x.x..x..x..', '.x..x..x.x..x..x'],
                chorus: ['x..x.x..x..x.x..', '.x.x..x..x.x..x.'],
            },
            pad: {
                presets: ['strings_brass', 'strings_mariachi'],
                patterns: ['....X.......x.x.', 'X.........x.X...'],
                sections: ['pre', 'chorus'],
            },
            lead: {
                presets: ['melody_guitar', 'melody_sax', 'melody_clavlead', 'vocal_talkbox'],
                verse: 'syncopated',
                chorus: 'syncopated',
            },
            vocal: { presets: ['vocal_soulgroup', 'vocal_gospel', 'vocal_hypeman'] },
            words: [
                ['Get', 'Super', 'Hot', 'Deep', 'Slick', 'Uptown'],
                ['Down', 'Pocket', 'Strut', 'Groove', 'Shuffle', 'Thang'],
            ],
        },
        disco: {
            name: 'Disco',
            blurb: 'Strings and open hats',
            bpm: [116, 124],
            swing: [0, 0.03],
            modes: ['minor', 'dorian', 'major'],
            labels: SONG,
            form: 'song',
            intro: 'band',
            verseLead: true,
            bridgeDrums: 'light',
            colors: ['seventh'],
            sameLoop: 0.5,
            drums: {
                kit: ['drums_house909'],
                back: ['drums_ukgarage', 'drums_boombap'],
                hats: ['drums_hats'],
                grooves: [
                    {
                        kit: 'K...K...K...K...',
                        back: '....S.......S...',
                        hats: 'h.o.h.o.h.o.h.o.',
                        hatsFull: 'h,o,h,o,h,o,h,o,',
                    },
                    {
                        kit: 'K...K...K...K...',
                        back: '....S.......S..s',
                        hats: '..o...o...o...o.',
                        hatsFull: 'hhohhhohhhohhhoh',
                    },
                ],
            },
            bass: {
                presets: ['bass_disco', 'bass_slap', 'bass_moog'],
                verse: ['R.o.r.o.r.o.r.o.', 'R.o.r.o.5.o.r.on'],
                chorus: ['R.o.r.o.r.o.5.on', 'RoroRoro.ror.ron'],
            },
            chords: {
                presets: ['chords_grand', 'chords_guitar', 'chords_rhodes'],
                verse: ['..x...x...x...x.', 'x.x.x.x.x.x.x.x.'],
                chorus: ['..x...x...x...x.', 'X..x..x...x..x..'],
            },
            pad: { presets: ['strings_ensemble'] },
            lead: {
                presets: ['strings_violin', 'melody_flute', 'vocal_gospel', 'vocal_soprano'],
                verse: 'straight',
                chorus: 'syncopated',
            },
            arp: {
                presets: ['strings_pizz', 'strings_harp', 'melody_glock'],
                patterns: ['0.1.2.3.0.1.2.3.', '0123012301230123'],
            },
            vocal: { presets: ['vocal_soulgroup', 'vocal_choir', 'vocal_barbershop'] },
            words: [
                ['Mirror', 'Saturday', 'Glitter', 'Satin', 'Starlight', 'Roller'],
                ['Ball', 'Fever', 'Nights', 'Boogie', 'Rink', 'Dance'],
            ],
        },
        pop: {
            name: 'Pop',
            blurb: 'Big hooks, bright chords',
            bpm: [100, 122],
            swing: [0, 0.03],
            modes: ['major', 'major', 'minor', 'mixolydian'],
            labels: SONG,
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'light',
            colors: ['triad', 'triad', 'sus'],
            sameLoop: 0.35,
            drums: {
                kit: ['drums_synthwave', 'drums_boombap', 'drums_breakbeat'],
                hats: ['drums_hats'],
                grooves: [
                    { kit: 'K...S...K.K.S...', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h,h,h,h,h,h,h,o,' },
                    { kit: 'K...S..kK...S...', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h.h.h.o.h.h.h.o.' },
                    { kit: 'K..kS...K.k.S...', hats: '..h...h...h...h.', hatsFull: 'h.h.h.h.h.h.h.h.' },
                ],
            },
            bass: {
                presets: ['bass_moog', 'bass_synthwave', 'bass_picked', 'bass_sub808'],
                verse: ['R.......r.....r.', 'R.....r.R.......'],
                chorus: ['R.r...r.R.r...rn', 'R.rr..r.R.rr..rn'],
            },
            chords: {
                presets: ['chords_grand', 'chords_juno', 'chords_guitar', 'chords_supersaw', 'chords_ukulele'],
                verse: ['X.......x.......', 'X..x..x.X..x..x.'],
                chorus: ['X..x..x.X..x..x.', 'x.x.x.x.x.x.x.x.', 'X.....x.x.....N.'],
            },
            pad: { presets: ['strings_ensemble', 'vocal_choir'] },
            lead: {
                presets: ['vocal_soprano', 'vocal_gospel', 'melody_bells', 'strings_violin', 'vocal_whistle'],
                verse: 'straight',
                chorus: 'syncopated',
            },
            arp: {
                presets: ['melody_glock', 'melody_kalimba', 'strings_pizz', 'melody_marimba'],
                patterns: ['0.1.2.3.0.1.2.3.', '0.2.1.3.0.2.1.3.', '0..1..2.0..1..2.'],
            },
            vocal: { presets: ['vocal_choir', 'vocal_soulgroup', 'vocal_chants'] },
            words: [
                ['Electric', 'Golden', 'Paper', 'Summer', 'Brighter', 'Wild'],
                ['Hearts', 'Daylight', 'Fireworks', 'Promise', 'Youth', 'Signals'],
            ],
        },
        synthwave: {
            name: 'Synthwave',
            blurb: 'Neon eighties drive',
            bpm: [96, 112],
            swing: [0, 0.02],
            modes: ['minor', 'dorian'],
            labels: SONG,
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'none',
            colors: ['triad', 'sus', 'seventh'],
            sameLoop: 0.45,
            drums: {
                kit: ['drums_synthwave'],
                hats: ['drums_hats'],
                grooves: [
                    { kit: 'K...S...K...S...', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h,h,h,h,h,h,h,h,' },
                    { kit: 'K...S...K.K.S...', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h.h.h.h.h.h.h.o.' },
                ],
                fills: ['tTmM', '.TtM', 'sStT'],
            },
            bass: {
                presets: ['bass_synthwave', 'bass_moog'],
                verse: ['R.r.r.r.r.r.r.r.', 'R.rrr.rrR.rrr.rr'],
                chorus: ['R.r.r.r.r.r.r.o.', 'Rrr.rrr.Rrr.rrrn'],
            },
            chords: {
                presets: ['chords_juno', 'chords_supersaw', 'chords_dx7'],
                verse: ['X.......x.......'],
                chorus: ['X.......x.......', 'X.....x.....x...'],
            },
            pad: { presets: ['strings_ensemble'] },
            lead: {
                presets: ['melody_saw', 'melody_theremin', 'strings_violin', 'melody_chiptune', 'melody_bells'],
                verse: 'straight',
                chorus: 'straight',
            },
            arp: {
                presets: ['chords_arp', 'melody_glock', 'strings_pizz'],
                patterns: ['0123012301230123', '0.1.2.3.0.1.2.3.', '0121012101210121'],
            },
            vocal: { presets: ['vocal_vocoder', 'vocal_choir'] },
            words: [
                ['Neon', 'Chrome', 'Laser', 'Midnight', 'Turbo', 'Sunset'],
                ['Highway', 'Drive', 'Grid', 'Horizon', 'Arcade', 'Runner'],
            ],
        },
        reggaeton: {
            name: 'Reggaeton',
            blurb: 'Dembow bounce',
            bpm: [88, 98],
            swing: [0, 0.02],
            modes: ['minor', 'harmonicMinor'],
            labels: {
                intro: 'Intro',
                verse: 'Verso',
                pre: 'Pre-coro',
                chorus: 'Coro',
                bridge: 'Puente',
                outro: 'Outro',
            },
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'light',
            colors: ['triad'],
            sameLoop: 0.8,
            drums: {
                kit: ['drums_reggaeton'],
                hats: ['drums_hats', 'drums_drill'],
                grooves: [
                    { kit: 'K..SK.S.K..SK.S.', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h,h,h,h,h,h,h,h,' },
                    { kit: 'K..SK.S.K..SK.SS', hats: '..h...h...h...h.', hatsFull: 'h.h.h.h.h.h.h.hh' },
                ],
            },
            bass: {
                presets: ['bass_sub808', 'bass_moog'],
                verse: ['R...r...R...r...', 'R..r....R..r....'],
                chorus: ['R..r..r.R..r..rn', 'R...r...R...r..N'],
            },
            chords: {
                presets: ['chords_guitar', 'chords_grand', 'chords_juno'],
                verse: ['...x..x....x..x.', 'X.......x.......'],
                chorus: ['X..x..x.X..x..x.', '...x..x....x..x.'],
            },
            pad: { presets: ['strings_ensemble'] },
            lead: {
                presets: ['vocal_chants', 'melody_flute', 'melody_marimba', 'vocal_soprano', 'melody_steelpan'],
                verse: 'syncopated',
                chorus: 'syncopated',
            },
            arp: { presets: ['melody_marimba', 'strings_pizz'], patterns: ['0..1..2.0..1..2.'] },
            vocal: { presets: ['vocal_hypeman', 'vocal_soulgroup'] },
            words: [
                ['Noche', 'Fuego', 'Luna', 'Calle', 'Playa', 'Oro'],
                ['Caliente', 'Lenta', 'Perreo', 'Brillante', 'Eterna', 'Azul'],
            ],
        },
        afro: {
            name: 'Afrobeats',
            blurb: 'Congas and sunshine',
            bpm: [100, 112],
            swing: [0.05, 0.1],
            modes: ['major', 'dorian', 'mixolydian'],
            labels: SONG,
            form: 'song',
            intro: 'band',
            verseLead: true,
            bridgeDrums: 'groove',
            bridgeLead: 'solo',
            colors: ['triad', 'seventh'],
            sameLoop: 0.7,
            drums: {
                kit: ['drums_boombap', 'drums_reggaeton'],
                perc: ['drums_afro'],
                hats: ['drums_hats'],
                grooves: [
                    {
                        kit: 'K..kS...K..kS...',
                        perc: 'p.mtp.m.ptm.p.mt',
                        hats: '..h...h...h...h.',
                        hatsFull: 'h,h,h,h,h,h,h,h,',
                    },
                    {
                        kit: 'K...S..kK.k.S...',
                        perc: 'pmp.tmp.pmp.tmpm',
                        hats: 'h.h.h.h.h.h.h.h.',
                        hatsFull: 'h,h,h,o,h,h,h,o,',
                    },
                ],
            },
            bass: {
                presets: ['bass_fretless', 'bass_moog', 'bass_picked'],
                verse: ['R..5..o.r..5.rn.', 'R.....5.r..r..n.'],
                chorus: ['R..5..o.r..5.rn.', 'R.r..5.or..5..n.'],
            },
            chords: {
                presets: ['chords_guitar', 'chords_rhodes', 'chords_ukulele'],
                verse: ['..x..x..x..x..x.', '.x.x..x..x.x..x.'],
                chorus: ['.x.x..x..x.x..x.', 'X..x..x.X..x..x.'],
            },
            pad: { presets: ['strings_ensemble', 'vocal_soulgroup'] },
            lead: {
                presets: ['melody_steelpan', 'melody_marimba', 'melody_kalimba', 'vocal_soprano', 'melody_flute'],
                verse: 'syncopated',
                chorus: 'syncopated',
            },
            arp: {
                presets: ['melody_marimba', 'melody_kalimba', 'strings_koto'],
                patterns: ['0.1.2.1.0.1.2.1.', '0..1..2.0..1..2.'],
            },
            vocal: { presets: ['vocal_soulgroup', 'vocal_chants', 'vocal_choir'] },
            words: [
                ['Lagos', 'Sunshine', 'Golden', 'Sweet', 'Easy', 'Island'],
                ['Love', 'Vibes', 'Wine', 'Breeze', 'Motion', 'Feeling'],
            ],
        },
        bossa: {
            name: 'Bossa Nova',
            blurb: 'Rio after dark',
            bpm: [126, 138],
            swing: [0, 0.02],
            modes: ['major', 'dorian', 'minor'],
            labels: SONG,
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'groove',
            bridgeLead: 'solo',
            colors: ['seventh', 'ninth'],
            sameLoop: 0.3,
            harmony: {
                major: {
                    loop: [
                        [1, 4, 0, 0],
                        [0, 5, 1, 4],
                        [0, 3, 1, 4],
                        [3, 2, 1, 0],
                    ],
                },
            },
            drums: {
                kit: ['drums_bossa'],
                perc: ['drums_hats'],
                grooves: [
                    { kit: 'K.p.p.pkK.p.p.pk', perc: 'r..r..r...r..r..' },
                    { kit: 'K.pkp.p.K.pkp.p.', perc: 'r..r...r..r.r...' },
                ],
            },
            bass: {
                presets: ['bass_upright', 'bass_fretless', 'bass_picked'],
                verse: ['R.....5.5.....n.', 'R.....5.R.....5.'],
                chorus: ['R.....5.5.....n.', 'R..5..5.R..5..n.'],
            },
            chords: {
                presets: ['chords_guitar', 'chords_rhodes', 'chords_grand'],
                verse: ['X..x..x...x..x..', 'x.x..x.x..x..x..'],
                chorus: ['X..x..x...x..x..'],
            },
            pad: { presets: ['strings_ensemble'] },
            lead: {
                presets: ['melody_flute', 'melody_sax', 'vocal_soprano', 'vocal_whistle', 'melody_harmonica'],
                verse: 'straight',
                chorus: 'straight',
            },
            arp: { presets: ['strings_harp'], patterns: ['0.1.2.3.2.1.0.1.'] },
            vocal: { presets: ['vocal_scat', 'vocal_soulgroup'] },
            words: [
                ['Ipanema', 'Quiet', 'Copacabana', 'Blue', 'Late', 'Gentle'],
                ['Evening', 'Samba', 'Balcony', 'Breeze', 'Saudade', 'Waves'],
            ],
        },
        cinematic: {
            name: 'Cinematic',
            blurb: 'Space & tension',
            bpm: [80, 96],
            swing: [0, 0],
            modes: ['harmonicMinor', 'minor'],
            labels: SCORE,
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'none',
            colors: ['triad'],
            sameLoop: 0.3,
            drums: {
                kit: ['drums_taiko'],
                grooves: [
                    { kit: 'T.....m.T...m.m.', kitFull: 'T..mT.m.T..mT.mm' },
                    { kit: 'T.......T...m...', kitFull: 'T.mmT.mmT.mmTmTm' },
                ],
                fills: ['TmTm', 'mmTT', 'tmTM'],
            },
            bass: {
                presets: ['bass_organped', 'strings_cello', 'bass_tuba'],
                verse: ['R.......r.......'],
                chorus: ['R.....r.R.....r.', 'R...r...R...r...'],
            },
            chords: {
                presets: ['chords_grand', 'strings_frenchhorn', 'strings_trombone'],
                verse: ['X.......x.......', 'X...............'],
                chorus: ['X...x...x...x...', 'X.......x...x...'],
            },
            pad: { presets: ['strings_ensemble', 'vocal_choir'], always: true },
            lead: {
                presets: ['strings_violin', 'melody_flute', 'vocal_opera'],
                verse: 'sparse',
                chorus: 'straight',
            },
            arp: {
                presets: ['strings_spiccato', 'strings_pizz', 'strings_tremolo', 'strings_harp'],
                patterns: ['0.1.2.1.0.1.2.1.', '0.0.1.0.2.0.1.0.', '0121012101210121'],
            },
            vocal: { presets: ['vocal_choir', 'vocal_monks'] },
            words: [
                ['First', 'Last', 'Distant', 'Fallen', 'Silent', 'Rising'],
                ['Light', 'Kingdom', 'Shore', 'Empire', 'Frontier', 'Tide'],
            ],
        },
        ambient: {
            name: 'Ambient',
            blurb: 'Slow light, no rush',
            bpm: [60, 76],
            swing: [0, 0],
            modes: ['major', 'dorian', 'mixolydian'],
            labels: DRIFT,
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'none',
            drumSections: ['chorus'],
            colors: ['sus', 'seventh', 'ninth'],
            sameLoop: 0.5,
            drums: {
                kit: ['drums_afro', 'drums_taiko'],
                grooves: [{ kit: 't.......t.......' }, { kit: 't.....p.t.......' }],
            },
            bass: {
                presets: ['bass_organped', 'strings_cello'],
                verse: ['R...............'],
                chorus: ['R.......r.......'],
            },
            chords: {
                presets: ['chords_glassarmonica', 'chords_singingbowls', 'chords_celesta', 'chords_rhodes'],
                verse: ['X...............', 'X.......x.......'],
                chorus: ['X.......x.......'],
            },
            pad: { presets: ['strings_ensemble', 'vocal_choir'], always: true },
            lead: {
                presets: ['melody_kalimba', 'strings_harp', 'melody_bells', 'melody_panflute', 'melody_saw'],
                verse: 'sparse',
                chorus: 'sparse',
            },
            arp: {
                presets: ['strings_harp', 'melody_glock', 'melody_kalimba'],
                patterns: ['0...1...2...3...', '0.....1.....2...'],
            },
            vocal: { presets: ['vocal_choir', 'vocal_monks'] },
            words: [
                ['Slow', 'Pale', 'Northern', 'Soft', 'Floating', 'Endless'],
                ['Light', 'Snow', 'Water', 'Dawn', 'Gardens', 'Clouds'],
            ],
        },
        chiptune: {
            name: 'Chiptune',
            blurb: 'Eight-bit adventure',
            bpm: [140, 160],
            swing: [0, 0],
            modes: ['major', 'minor', 'mixolydian'],
            labels: { intro: 'Title', verse: 'Level', pre: 'Warp', chorus: 'Boss', bridge: 'Bonus', outro: 'Credits' },
            form: 'song',
            intro: 'band',
            verseLead: true,
            bridgeDrums: 'light',
            bridgeLead: 'solo',
            colors: ['triad'],
            sameLoop: 0.4,
            drums: {
                kit: ['drums_breakbeat', 'drums_synthwave'],
                hats: ['drums_hats'],
                grooves: [
                    { kit: 'K...S...K.K.S...', hats: 'h.h.h.h.h.h.h.h.', hatsFull: 'h,h,h,h,h,h,h,h,' },
                    { kit: 'K.K.S...K.K.S..s', hats: 'h.h.h.h.h.h.h.h.', hatsFull: ',h,h,h,h,h,h,h,h' },
                ],
            },
            bass: {
                presets: ['bass_moog', 'bass_synthwave'],
                verse: ['R.o.r.o.r.o.r.o.'],
                chorus: ['R.o.r.o.r.o.5.o.', 'RoRo5o5oRoRo5o5n'],
            },
            chords: {
                presets: ['chords_arp', 'chords_harpsichord'],
                verse: ['x.x.x.x.x.x.x.x.'],
                chorus: ['X..x..x.X..x..x.'],
            },
            lead: { presets: ['melody_chiptune'], verse: 'straight', chorus: 'busy' },
            arp: {
                presets: ['melody_glock', 'melody_bells'],
                patterns: ['0123012301230123', '0121012101210121'],
            },
            words: [
                ['Pixel', 'Super', 'Crystal', 'Turbo', 'Hidden', 'Final'],
                ['Quest', 'Castle', 'Kingdom', 'Dungeon', 'World', 'Stage'],
            ],
        },
        waltz: {
            name: 'Folk Waltz',
            blurb: 'Three-four, warm wood',
            bpm: [96, 120],
            meter: '3/4',
            swing: [0, 0.02],
            modes: ['major', 'minor', 'dorian'],
            labels: SONG,
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'light',
            colors: ['triad'],
            sameLoop: 0.35,
            drums: {
                kit: ['drums_jazzbrush', 'drums_bossa'],
                grooves: [
                    { kit: 'k...s...s...', kitFull: 'k...s.p.s.p.' },
                    { kit: 'K...s...s..p', kitFull: 'K.p.s.p.s.p.' },
                ],
            },
            bass: {
                presets: ['bass_upright', 'bass_picked', 'bass_tuba'],
                verse: ['R...........', 'R.......5...'],
                chorus: ['R.......5...', 'R...5...r...'],
            },
            chords: {
                presets: ['chords_accordion', 'chords_guitar', 'chords_grand', 'chords_ukulele'],
                verse: ['....x...x...'],
                chorus: ['....x...x...', '..x.x.x.x.x.'],
            },
            pad: { presets: ['strings_ensemble'] },
            lead: {
                presets: ['strings_violin', 'melody_flute', 'strings_hurdygurdy', 'melody_harmonica'],
                verse: 'straight',
                chorus: 'straight',
            },
            arp: {
                presets: ['strings_harp', 'strings_banjo', 'strings_pizz'],
                patterns: ['0.1.2.1.2.1.', '0...1...2...'],
            },
            vocal: { presets: ['vocal_choir', 'vocal_barbershop'] },
            words: [
                ['Old', 'Willow', 'Harvest', 'Little', 'Wandering', 'Lantern'],
                ['Lane', 'Waltz', 'Hill', 'Ferry', 'Meadow', 'Fair'],
            ],
        },
        soul: {
            name: 'Soul Ballad',
            blurb: 'Six-eight slow burn',
            bpm: [76, 90],
            meter: '6/8',
            swing: [0, 0],
            modes: ['major', 'minor'],
            labels: SONG,
            form: 'song',
            intro: 'keys',
            verseLead: true,
            bridgeDrums: 'light',
            colors: ['seventh', 'triad'],
            sameLoop: 0.35,
            drums: {
                kit: ['drums_boombap', 'drums_breakbeat'],
                hats: ['drums_hats'],
                grooves: [
                    { kit: 'K.....S.....', kitFull: 'K...k.S....g', hats: 'h.h.h.h.h.h.', hatsFull: 'h.h.h.h.h.o.' },
                    { kit: 'K.....S...k.', kitFull: 'K.k...S...k.', hats: 'h.h.h.h.h.h.', hatsFull: 'h,h,h,h,h,h,' },
                ],
            },
            bass: {
                presets: ['bass_upright', 'bass_fretless', 'bass_moog'],
                verse: ['R.....5.....'],
                chorus: ['R...5.r...n.', 'R.....5...n.'],
            },
            chords: {
                presets: ['chords_b3organ', 'chords_grand', 'chords_rhodes'],
                verse: ['X.x.x.X.x.x.'],
                chorus: ['X.x.x.X.x.x.', 'X.....X.x.x.'],
            },
            pad: { presets: ['strings_ensemble', 'vocal_soulgroup', 'vocal_choir'] },
            lead: {
                presets: ['vocal_gospel', 'vocal_soprano', 'melody_sax', 'strings_violin'],
                verse: 'sparse',
                chorus: 'straight',
            },
            vocal: { presets: ['vocal_choir', 'vocal_soulgroup'] },
            words: [
                ['Tender', 'Sweet', 'Midnight', 'Honey', 'Only', 'Velvet'],
                ['Prayer', 'Promise', 'River', 'Devotion', 'Tonight', 'Mercy'],
            ],
        },
    };

    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const round = value => Math.round(value * 1000) / 1000;
    const mod7 = degree => ((degree % 7) + 7) % 7;

    function randomSource(seed) {
        let state = 2166136261;
        for (const char of String(seed)) {
            state ^= char.charCodeAt(0);
            state = Math.imul(state, 16777619);
        }
        return function () {
            state += 0x6d2b79f5;
            let value = Math.imul(state ^ (state >>> 15), 1 | state);
            value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    function makeTools(random) {
        return {
            random,
            chance: probability => random() < probability,
            pick: list => list[Math.floor(random() * list.length)],
            between: ([low, high]) => low + random() * (high - low),
        };
    }

    function note(degree, base) {
        return base + Math.floor(degree / 7) * 12 + SOURCE_SCALE[mod7(degree)];
    }

    function weight(step, meter) {
        if (step === 0) return 3;
        if (meter.strong.includes(step)) return 2.5;
        if (step % meter.beat === 0) return 2;
        return step % 2 === 0 ? 1 : 0;
    }

    function emptyPart() {
        return { steps: Array(16).fill(null), vel: Array(16).fill(0) };
    }

    function hasNotes(part) {
        return Boolean(part) && part.steps.some(event => event !== null);
    }

    function presetPitches(preset) {
        const pitches = [];
        preset.steps.forEach(event => {
            if (typeof event === 'number') pitches.push(event);
            else if (Array.isArray(event)) pitches.push(...event);
            else if (event && typeof event === 'object') {
                if (typeof event.n === 'number') pitches.push(event.n);
                if (Array.isArray(event.notes)) pitches.push(...event.notes);
            }
        });
        return pitches.sort((a, b) => a - b);
    }

    function presetCenter(preset, fallback) {
        const pitches = presetPitches(preset);
        return pitches.length ? pitches[Math.floor(pitches.length / 2)] : fallback;
    }

    function kindOf(preset) {
        if (preset.category === 'drums') return 'drum';
        if (CHORD_SYNTHS.has(preset.synthType)) return 'chord';
        if (VOICE_CHORD_SYNTHS.has(preset.synthType)) return 'voices';
        if (VOICE_SYNTHS.has(preset.synthType)) return 'voice';
        return 'note';
    }

    // Writes pitches in whatever event shape the member's synth expects.
    function eventFor(member, pitches, index = 0, consonant = null) {
        const [v, v2] = member.vowels[index % member.vowels.length];
        if (member.kind === 'chord') return [...pitches];
        if (member.kind === 'voices') return { notes: [...pitches], v, v2 };
        const top = pitches[pitches.length - 1];
        if (member.kind === 'voice') return consonant ? { n: top, v, v2, c: consonant } : { n: top, v, v2 };
        return top;
    }

    function makeChord(degree, color) {
        const degrees = COLORS[color].map(interval => degree + interval);
        return { root: mod7(degree), degrees, pcs: new Set(degrees.map(mod7)) };
    }

    // Picks the inversion and octave closest to the previous voicing so chord
    // changes move by small steps instead of jumping around the keyboard.
    function voiceChord(chord, previous, center, spread = 13) {
        const base = chord.degrees.map(degree => note(degree, 48));
        let best = null;
        let bestCost = Infinity;
        for (let inversion = 0; inversion < base.length; inversion++) {
            const inverted = base.slice(inversion).concat(base.slice(0, inversion).map(pitch => pitch + 12));
            for (const shift of [-24, -12, 0, 12, 24]) {
                const candidate = inverted.map(pitch => pitch + shift);
                if (candidate[0] < center - spread || candidate.at(-1) > center + spread) continue;
                const average = candidate.reduce((sum, pitch) => sum + pitch, 0) / candidate.length;
                const movement = previous
                    ? candidate.reduce(
                          (sum, pitch, index) => sum + Math.abs(pitch - previous[Math.min(index, previous.length - 1)]),
                          0,
                      )
                    : 0;
                const muddy = candidate[1] - candidate[0] <= 2 && candidate[0] < 58 ? 4 : 0;
                const cost = movement + Math.abs(average - center) * 0.8 + muddy;
                if (cost < bestCost) {
                    best = candidate;
                    bestCost = cost;
                }
            }
        }
        return best || base;
    }

    function bassDegree(root) {
        return root >= 5 ? root - 7 : root;
    }

    function velocityFor(char) {
        if (char === ',') return 0.38;
        if (char === 'g') return 0.32;
        return char !== char.toLowerCase() ? 0.95 : 0.7;
    }

    function drumPart(pattern, kit, steps) {
        const part = emptyPart();
        if (!pattern) return part;
        [...pattern].slice(0, steps).forEach((char, step) => {
            if (char === '.') return;
            const voice = char === ',' ? 'h' : char === 'g' ? 's' : char.toLowerCase();
            const letter = kit[voice] ?? (KIT_FALLBACK[voice] || []).map(fallback => kit[fallback]).find(Boolean);
            if (!letter) return;
            part.steps[step] = letter;
            part.vel[step] = velocityFor(char);
        });
        return part;
    }

    const keep = (pattern, voices) =>
        pattern ? [...pattern].map(char => (voices.includes(char.toLowerCase()) ? char : '.')).join('') : pattern;
    const soften = pattern => (pattern ? pattern.replace(/[A-Z]/g, char => char.toLowerCase()) : pattern);
    const thin = pattern => (pattern ? [...pattern].map((char, step) => (step % 2 ? '.' : char)).join('') : pattern);
    const rest = steps => '.'.repeat(steps);

    // Overlays `top` onto `base`, keeping the base wherever it already plays.
    function layer(base, top) {
        if (!base) return top;
        if (!top) return base;
        return [...base].map((char, step) => (char !== '.' ? char : top[step] || '.')).join('');
    }

    function placeFill(pattern, fill, steps) {
        const start = steps - fill.length;
        const base = (pattern || rest(steps)).slice(0, start);
        return base + fill;
    }

    function snareBuild(bar, length, meter) {
        const steps = meter.steps;
        const final = bar === length - 1;
        const density = length === 1 ? 2 : bar < length / 2 ? 0 : final ? 2 : 1;
        return Array.from({ length: steps }, (_, step) => {
            const progress = (bar * steps + step) / (length * steps);
            const on =
                density === 0 ? step % meter.beat === 0 : density === 1 || step < steps / 2 ? step % 2 === 0 : true;
            if (!on) return '.';
            return progress < 0.35 ? 'g' : progress < 0.7 ? 's' : 'S';
        }).join('');
    }

    function drumPatterns(song, ctx) {
        const { config, groove, meter } = song;
        const steps = meter.steps;
        const { type, bar, length } = ctx;
        const verse = { kit: groove.kit, back: groove.back, hats: groove.hats, perc: groove.perc };
        const full = {
            kit: groove.kitFull || groove.kit,
            back: groove.backFull || groove.back,
            hats: groove.hatsFull || groove.hats,
            perc: groove.perc,
        };
        if (config.drumSections && !config.drumSections.includes(type)) return {};
        if (ctx.ending) return { kit: 'K' + rest(steps - 1), hats: 'O' + rest(steps - 1) };
        let out = {};
        if (type === 'intro') {
            if (config.intro === 'band') out = { ...verse };
            else if (config.intro === 'drums')
                out =
                    length > 1 && bar < Math.ceil(length / 2)
                        ? { hats: soften(groove.hats), perc: soften(groove.perc) }
                        : { kit: keep(groove.kit, 'kbt'), hats: groove.hats, perc: groove.perc };
            else if (length > 1 && bar === length - 1) out = { hats: soften(thin(groove.hats)) };
        } else if (type === 'verse') {
            out = { ...verse, hats: song.energy === 0 ? thin(groove.hats) : groove.hats };
        } else if (type === 'pre') {
            const final = bar === length - 1;
            let kicks = keep(groove.kit, 'kbt') || rest(steps);
            if (final) kicks = kicks.slice(0, steps / 2) + rest(steps / 2);
            const roll = snareBuild(bar, length, meter);
            out = groove.back ? { kit: kicks, back: roll } : { kit: layer(kicks, roll) };
            out.hats = groove.hats
                ? soften(Array.from({ length: steps }, (_, s) => (s % 2 ? '.' : 'h')).join(''))
                : null;
        } else if (type === 'chorus') {
            out = { ...full };
            if (bar === 0 && out.hats && song.kits.hats?.o) out.hats = 'O' + out.hats.slice(1);
        } else if (type === 'bridge') {
            if (config.bridgeDrums === 'groove') out = { ...verse, hats: soften(groove.hats) };
            else if (config.bridgeDrums === 'light')
                out = { kit: bar % 2 === 0 ? 'K' + rest(steps - 1) : null, hats: soften(thin(groove.hats)) };
        } else if (type === 'outro') {
            out = bar < length / 2 ? { ...verse } : { hats: soften(thin(groove.hats)), perc: soften(groove.perc) };
        }
        const drumsPlay = out.kit || out.back;
        const nextUp = ctx.nextType && ctx.nextType !== type;
        const endsSection = bar === length - 1 && nextUp && type !== 'pre';
        const midFill = length === 8 && bar === 3 && type !== 'pre';
        if ((endsSection || midFill) && (drumsPlay || type === 'intro')) {
            const fill = midFill ? song.fill.slice(-2) : song.fill;
            if (song.kits.back) out.back = placeFill(out.back, fill, steps);
            else out.kit = placeFill(out.kit, fill, steps);
        }
        return out;
    }

    function bassPart(pattern, ctx, steps) {
        const part = emptyPart();
        [...pattern].slice(0, steps).forEach((char, step) => {
            if (char === '.') return;
            const chord = ctx.chordAt(step);
            const root = bassDegree(chord.root);
            const target = bassDegree(ctx.nextAfter(step).root);
            let degree = root;
            if (char === 'o' || char === 'O') degree = root + 7;
            else if (char === '5') degree = root + 4;
            else if (char === '3') degree = root + 2;
            else if (char === '7') degree = root - 1;
            else if (char === 'N') degree = target;
            else if (char === 'n')
                degree = Math.abs(target - 1 - root) <= Math.abs(target + 1 - root) ? target - 1 : target + 1;
            part.steps[step] = note(degree, 36);
            part.vel[step] = char === 'R' || char === 'O' ? 0.95 : /\d/.test(char) ? 0.75 : char === 'N' ? 0.8 : 0.7;
        });
        return part;
    }

    function acidPattern(tools, meter, density) {
        return Array.from({ length: meter.steps }, (_, step) => {
            if (step === 0) return 'R';
            const level = weight(step, meter);
            const odds = (level >= 2 ? 0.75 : level === 1 ? 0.6 : 0.42) * density;
            return tools.chance(odds) ? tools.pick(['r', 'r', 'r', 'o', 'o', '5', 'R']) : '.';
        }).join('');
    }

    function compPart(member, pattern, ctx, steps, voicing) {
        const part = emptyPart();
        [...pattern].slice(0, steps).forEach((char, step) => {
            if (char === '.') return;
            const chord = char === 'N' ? ctx.nextAfter(step) : ctx.chordAt(step);
            let pitches = voicing(chord);
            if (char === 'u' && pitches.length > 2) pitches = pitches.slice(1);
            part.steps[step] = eventFor(member, pitches, step);
            part.vel[step] = char === 'X' ? 0.95 : char === 'N' ? 0.8 : char === 'u' ? 0.62 : 0.72;
        });
        return part;
    }

    function arpPart(member, pattern, ctx, steps, voicing) {
        const part = emptyPart();
        [...pattern].slice(0, steps).forEach((char, step) => {
            if (char === '.') return;
            const tones = voicing(ctx.chordAt(step));
            const ladder = [...tones, ...tones.map(pitch => pitch + 12)];
            const pitch = ladder[Math.min(Number(char), ladder.length - 1)];
            part.steps[step] = eventFor(member, [pitch], step);
            part.vel[step] = step % 4 === 0 ? 0.85 : 0.6;
        });
        return part;
    }

    function pickCell(tools, feel, steps) {
        return [...tools.pick(CELLS[steps][feel])];
    }

    function varyCell(tools, cell, steps) {
        const onsets = new Set(cell);
        if (onsets.size > 3 && tools.chance(0.5)) {
            const removable = cell.filter(step => step !== 0);
            onsets.delete(tools.pick(removable));
        }
        if (tools.chance(0.7)) {
            const open = Array.from({ length: steps }, (_, step) => step).filter(step => !onsets.has(step));
            if (open.length) onsets.add(tools.pick(open));
        }
        return [...onsets].sort((a, b) => a - b);
    }

    // A cadence bar keeps the start of the motif, then lands on a long note.
    function cadenceCell(cell, steps) {
        const half = steps / 2;
        const head = cell.filter(step => step < half).slice(0, 3);
        return [...new Set([...head, half])].sort((a, b) => a - b);
    }

    // Chooses one scale degree per onset. Strong beats land on chord tones,
    // weak beats move by step, and the line follows a contour around `center`.
    function melodize(tools, onsets, chordAt, meter, { start, center, contour, low, high, cadence }) {
        const notes = [];
        let previous = start;
        let repeats = 0;
        onsets.forEach((step, index) => {
            const progress = onsets.length > 1 ? index / (onsets.length - 1) : 0;
            const target = center + CONTOURS[contour](progress);
            const tones = chordAt(step).pcs;
            const strong = index === 0 || weight(step, meter) >= 2;
            const last = index === onsets.length - 1;
            let best = previous;
            let bestScore = Infinity;
            for (let degree = low; degree <= high; degree++) {
                const leap = Math.abs(degree - previous);
                const chordTone = tones.has(mod7(degree));
                let score = Math.abs(degree - target) * 0.55 + leap * 0.75 + (leap > 4 ? 3 : 0);
                if (strong && !chordTone) score += 4;
                if (!strong && !chordTone && leap !== 1) score += 1.5;
                if (degree === previous) score += repeats >= 1 ? 2.5 : 0.6;
                if (last && cadence) score += cadence.has(mod7(degree)) ? 0 : 6;
                score += tools.random() * 1.4;
                if (score < bestScore) {
                    bestScore = score;
                    best = degree;
                }
            }
            repeats = best === previous ? repeats + 1 : 0;
            previous = best;
            const level = weight(step, meter);
            const vel = last && cadence ? 0.9 : level === 3 ? 0.95 : level >= 2 ? 0.85 : level === 1 ? 0.72 : 0.62;
            notes.push({ step, degree: best, vel });
        });
        return notes;
    }

    // Moves a bar of melody onto a new chord. Equal chords give an exact
    // repeat; other chords shift the line by the root movement, like a sequence.
    function adaptNotes(notes, fromChord, toChord, meter, low, high) {
        return notes.map(item => {
            const from = fromChord(item.step);
            const to = toChord(item.step);
            let shift = mod7(to.root - from.root);
            if (shift > 3) shift -= 7;
            let degree = item.degree + shift;
            if (weight(item.step, meter) >= 2 && !to.pcs.has(mod7(degree)))
                degree = [degree - 1, degree + 1, degree - 2, degree + 2].find(d => to.pcs.has(mod7(d))) ?? degree;
            while (degree > high) degree -= 7;
            while (degree < low) degree += 7;
            return { ...item, degree };
        });
    }

    function cadenceTargets(chord, closing) {
        if (closing) return new Set([chord.pcs.has(0) ? 0 : chord.root]);
        const open = [mod7(chord.root + 2), mod7(chord.root + 4)].filter(pc => pc !== 0);
        return new Set(open.length ? open : [mod7(chord.root + 2)]);
    }

    // Builds four-bar phrases (motif, answer, contrast, cadence). An eight-bar
    // section restates the first phrase and closes it, so the idea is heard twice.
    function composeMelody(tools, meter, { bars, chordAt, feel, center, low, high, closing, contour }) {
        const steps = meter.steps;
        const cell = pickCell(tools, feel, steps);
        const contrast = tools.chance(0.5) ? varyCell(tools, cell, steps) : pickCell(tools, feel, steps);
        const shape = contour || tools.pick(Object.keys(CONTOURS));
        const phraseLength = Math.min(bars, 4);
        const plans = {
            1: [['C']],
            2: [['A', 'C']],
            3: [['A', 'B', 'C']],
            4: [
                ['A', 'A2', 'B', 'C'],
                ['A', 'B', 'A2', 'C'],
                ['A', 'A2', 'A', 'C'],
            ],
        };
        const plan = tools.pick(plans[phraseLength]);
        const phrases = Math.ceil(bars / phraseLength);
        const out = [];
        let motif = null;
        let previous = center;
        for (let phrase = 0; phrase < phrases; phrase++) {
            const finalPhrase = phrase === phrases - 1;
            plan.forEach((kind, index) => {
                const bar = phrase * phraseLength + index;
                if (bar >= bars) return;
                const chordFor = step => chordAt(bar, step);
                let notes;
                if (phrase > 0 && kind !== 'C') {
                    notes = adaptNotes(out[index], step => chordAt(index, step), chordFor, meter, low, high);
                } else if (kind === 'A' && motif) {
                    notes = adaptNotes(motif.notes, step => chordAt(motif.bar, step), chordFor, meter, low, high);
                } else if (kind === 'A') {
                    notes = melodize(tools, cell, chordFor, meter, {
                        start: previous,
                        center,
                        contour: shape,
                        low,
                        high,
                    });
                    motif = { notes, bar };
                } else if (kind === 'A2') {
                    notes = adaptNotes(motif.notes, step => chordAt(motif.bar, step), chordFor, meter, low, high);
                } else if (kind === 'B') {
                    notes = melodize(tools, contrast, chordFor, meter, {
                        start: previous,
                        center: center + 1,
                        contour: ANSWER[shape],
                        low,
                        high,
                    });
                } else {
                    const close = finalPhrase && closing;
                    const onsets = cadenceCell(cell, steps);
                    notes = melodize(tools, onsets, chordFor, meter, {
                        start: previous,
                        center: close ? center - 1 : center + 1,
                        contour: close ? 'fall' : 'rise',
                        low,
                        high,
                        cadence: cadenceTargets(chordAt(bar, onsets.at(-1)), close),
                    });
                    if (!finalPhrase && motif) {
                        // A pickup leads back into the restated motif.
                        const first = motif.notes[0]?.degree ?? center;
                        notes.push({ step: steps - 2, degree: clamp(first - 1, low, high), vel: 0.6 });
                    }
                }
                out[bar] = notes;
                if (notes.length) previous = notes.at(-1).degree;
            });
        }
        return out;
    }

    function freeSolo(tools, meter, { bars, chordAt, center, low, high }) {
        const out = [];
        let previous = center;
        for (let bar = 0; bar < bars; bar++) {
            const onsets = pickCell(tools, bar % 2 ? 'syncopated' : 'busy', meter.steps);
            const finalBar = bar === bars - 1;
            out[bar] = melodize(
                tools,
                finalBar ? cadenceCell(onsets, meter.steps) : onsets,
                s => chordAt(bar, s),
                meter,
                {
                    start: previous,
                    center: center + (bar % 2),
                    contour: tools.pick(Object.keys(CONTOURS)),
                    low,
                    high,
                    cadence: finalBar ? cadenceTargets(chordAt(bar, meter.steps / 2), false) : null,
                },
            );
            if (out[bar].length) previous = out[bar].at(-1).degree;
        }
        return out;
    }

    function linePart(member, notes, steps, base, { velocity = 1, filter = null } = {}) {
        const part = emptyPart();
        (notes || []).forEach((item, index) => {
            if (item.step >= steps || (filter && !filter(item))) return;
            const consonant = member.kind === 'voice' && index === 0 ? member.consonant : null;
            part.steps[item.step] = eventFor(member, [note(item.degree, base)], index, consonant);
            part.vel[item.step] = clamp(item.vel * velocity, 0.2, 1);
        });
        return part;
    }

    function chooseEnsemble(config, tools, energy) {
        const used = new Set();
        const choose = ids => {
            const options = (ids || []).filter(id => !used.has(id));
            if (!options.length) return null;
            const id = tools.pick(options);
            const preset = INSTRUMENT_PRESETS.find(item => item.id === id);
            if (!preset) throw new Error(`The sound library is missing ${id}.`);
            used.add(id);
            return preset;
        };
        const wants = {
            kit: Boolean(config.drums?.kit),
            back: Boolean(config.drums?.back),
            hats: Boolean(config.drums?.hats),
            perc: Boolean(config.drums?.perc),
            bass: Boolean(config.bass),
            chords: Boolean(config.chords),
            lead: Boolean(config.lead),
            pad: Boolean(config.pad) && (config.pad.always || tools.chance(energy === 0 ? 0.6 : 0.85)),
            arp: Boolean(config.arp) && (energy === 2 || (energy === 1 && tools.chance(0.65))),
            vocal: Boolean(config.vocal) && tools.chance([0.2, 0.65, 1][energy]),
        };
        const pools = {
            kit: config.drums?.kit,
            back: config.drums?.back,
            hats: config.drums?.hats,
            perc: config.drums?.perc,
            bass: config.bass?.presets,
            chords: config.chords?.presets,
            lead: config.lead?.presets,
            pad: config.pad?.presets,
            arp: config.arp?.presets,
            vocal: config.vocal?.presets,
        };
        const members = {};
        // Pick sounds in a fixed order so each role draws from what is left.
        ['kit', 'back', 'hats', 'perc', 'bass', 'lead', 'chords', 'pad', 'arp', 'vocal'].forEach(role => {
            if (!wants[role]) return;
            const preset = choose(pools[role]);
            if (!preset) return;
            members[role] = {
                role,
                preset,
                kind: kindOf(preset),
                center: presetCenter(preset, role === 'bass' ? 40 : 66),
                pan: round(clamp(ROLE_PAN[role] + (tools.random() - 0.5) * 0.1, -1, 1)),
                trim: LEVEL_TRIM[preset.synthType] || 1,
                vowels: Array.from({ length: 4 }, () => tools.pick(VOWELS)),
                consonant: tools.pick(['h', 'h', 'k', 't']),
            };
        });
        ROLE_ORDER.filter(role => members[role]).forEach((role, index) => {
            members[role].index = index;
        });
        return members;
    }

    function buildForm(config, bars) {
        const counts = {};
        return FORMS[config.form][bars].map(([type, length]) => {
            counts[type] = (counts[type] || 0) + 1;
            const name = config.labels[type];
            return {
                type,
                length,
                occurrence: counts[type] - 1,
                name: counts[type] > 1 ? `${name} ${counts[type]}` : name,
            };
        });
    }

    function harmonyFor(config, mode) {
        const library = HARMONY[mode];
        const custom = config.harmony?.[mode] || {};
        return {
            loop: custom.loop || library.loop,
            bridge: custom.bridge || library.bridge,
            pre: custom.pre || library.pre,
        };
    }

    function makeTitle(tools, config) {
        const [first, second] = config.words;
        return `${tools.pick(first)} ${tools.pick(second)}`;
    }

    scope.SONG_STYLES = Object.entries(STYLES).map(([id, style]) => ({
        id,
        name: style.name,
        blurb: style.blurb,
        meter: style.meter || '4/4',
    }));

    scope.generateSong = function generateSong(options = {}) {
        if (!options || typeof options !== 'object') throw new Error('Choose song settings to continue.');
        const requested = options.style ?? 'house';
        const bars = Number(options.bars ?? 16);
        const energy = ENERGIES.indexOf(options.energy ?? 'medium');
        if (requested !== 'random' && !Object.hasOwn(STYLES, requested))
            throw new Error('Choose a style from the list.');
        if (!LENGTHS.includes(bars)) throw new Error('Choose a length of 8, 16, 32, or 64 bars.');
        if (energy < 0) throw new Error('Choose low, medium, or high energy.');
        if (options.seed !== undefined && !['string', 'number'].includes(typeof options.seed))
            throw new Error('Use text or a number for the song seed.');
        const seed = options.seed ?? `${Date.now()}-${Math.random()}`;
        const tools = makeTools(randomSource(seed));
        const styleId = requested === 'random' ? tools.pick(Object.keys(STYLES)) : requested;
        const config = STYLES[styleId];
        const meterName = config.meter || '4/4';
        const meter = METERS[meterName];
        const steps = meter.steps;
        const mode = tools.pick(config.modes);
        const harmony = harmonyFor(config, mode);
        const verseLoop = tools.pick(harmony.loop);
        const otherLoops = harmony.loop.filter(loop => loop !== verseLoop);
        const chorusLoop = tools.chance(config.sameLoop) || !otherLoops.length ? verseLoop : tools.pick(otherLoops);
        const loops = {
            intro: verseLoop,
            verse: verseLoop,
            pre: tools.pick(harmony.pre),
            chorus: chorusLoop,
            bridge: config.bridgeHook ? chorusLoop : tools.pick(harmony.bridge),
            outro: chorusLoop,
        };
        const colorOf = {};
        for (let degree = 0; degree < 7; degree++) colorOf[degree] = tools.pick(config.colors);
        // Leave the tonic as a plain seventh or triad so the home chord sounds settled.
        if (colorOf[0] === 'sus') colorOf[0] = 'triad';
        const chordCache = new Map();
        const chordOf = degree => {
            const root = mod7(degree);
            if (!chordCache.has(root)) chordCache.set(root, makeChord(root, colorOf[root]));
            return chordCache.get(root);
        };

        const members = chooseEnsemble(config, tools, energy);
        const groove = tools.pick(config.drums?.grooves || [{}]);
        const kits = {};
        ['kit', 'back', 'hats', 'perc'].forEach(role => {
            if (members[role]) kits[role] = KITS[members[role].preset.synthType] || {};
        });
        const fills = config.drums?.fills || FILLS[steps];
        const song = {
            config,
            meter,
            energy,
            groove: {
                ...groove,
                back: members.back ? groove.back : null,
                hats: members.hats ? groove.hats : null,
                hatsFull: members.hats ? groove.hatsFull : null,
                perc: members.perc ? groove.perc : null,
            },
            kits,
            fill: tools.pick(fills),
        };
        const bassPatterns = config.bass?.acid
            ? { verse: acidPattern(tools, meter, 0.8), chorus: acidPattern(tools, meter, 1.1) }
            : { verse: tools.pick(config.bass.verse), chorus: tools.pick(config.bass.chorus) };
        const compPatterns = {
            verse: tools.pick(config.chords.verse),
            chorus: tools.pick(config.chords.chorus),
        };
        const padPattern = config.pad?.patterns
            ? tools.pick(config.pad.patterns)
            : steps === 16
              ? 'X.......x.......'
              : 'X.....x.....';
        const arpPattern = config.arp ? tools.pick(config.arp.patterns) : null;
        const chopCell = pickCell(tools, 'syncopated', steps);
        const vocalIsPad = members.vocal && members.vocal.kind !== 'voice';

        // Lay out every bar with its chords before writing any parts, so bass
        // pickups and chord anticipations can see the chord that comes next.
        const form = buildForm(config, bars);
        const timeline = [];
        form.forEach((section, sectionIndex) => {
            const loop = loops[section.type];
            for (let bar = 0; bar < section.length; bar++) {
                timeline.push({
                    section,
                    bar,
                    length: section.length,
                    type: section.type,
                    nextType: form[sectionIndex + 1]?.type || null,
                    chords: [chordOf(loop[bar % loop.length])],
                });
            }
        });
        const lastBar = timeline.at(-1);
        lastBar.ending = true;
        lastBar.chords = [chordOf(0)];

        const melodyCache = new Map();
        // Degree 0 sits a few semitones under the instrument's own register, so
        // verses stay low and choruses climb into its brightest octave.
        const leadBase = members.lead ? 12 * Math.round((members.lead.center - 3) / 12) : 72;
        const melodyFor = (type, length) => {
            const key = `${type}:${length}`;
            if (melodyCache.has(key)) return melodyCache.get(key);
            const loop = loops[type];
            const chordAt = bar => chordOf(loop[bar % loop.length]);
            let notes;
            if (type === 'bridge' && config.bridgeLead === 'solo') {
                notes = freeSolo(tools, meter, { bars: length, chordAt, center: 2, low: -3, high: 8 });
            } else if (type === 'chorus') {
                notes = composeMelody(tools, meter, {
                    bars: length,
                    chordAt,
                    feel: config.lead.chorus,
                    center: 2,
                    low: -2,
                    high: 7,
                    closing: true,
                });
            } else if (type === 'pre') {
                notes = composeMelody(tools, meter, {
                    bars: length,
                    chordAt,
                    feel: 'straight',
                    center: 1,
                    low: -3,
                    high: 7,
                    closing: false,
                    contour: 'rise',
                });
            } else {
                notes = composeMelody(tools, meter, {
                    bars: length,
                    chordAt,
                    feel: type === 'bridge' ? 'sparse' : config.lead.verse,
                    center: 0,
                    low: -4,
                    high: 5,
                    closing: false,
                });
            }
            melodyCache.set(key, notes);
            return notes;
        };
        // A bridge that reuses the chorus chords also reuses its hook.
        if (config.bridgeHook && members.lead) {
            const chorusLength = Math.max(...form.filter(s => s.type === 'chorus').map(s => s.length));
            const hook = melodyFor('chorus', chorusLength);
            form.filter(s => s.type === 'bridge').forEach(s =>
                melodyCache.set(`bridge:${s.length}`, hook.slice(0, s.length)),
            );
        }

        const voicings = {};
        const voicer = (role, center, spread) => chord => {
            const key = `${role}:${[...chord.degrees].join(',')}`;
            voicings[role] = voicings[role] || { last: null, cache: new Map() };
            const state = voicings[role];
            if (!state.cache.has(key)) state.cache.set(key, voiceChord(chord, state.last, center, spread));
            state.last = state.cache.get(key);
            return state.last;
        };
        const chordCenter = members.chords ? clamp(members.chords.center, 56, 70) : 64;
        const voiceChords = voicer('chords', chordCenter, 12);
        const voicePad = voicer('pad', 60, 12);
        const voiceArp = voicer('arp', members.arp ? clamp(members.arp.center, 64, 80) : 72, 8);
        const voiceVocal = voicer('vocal', 64, 9);

        const bpmRange = config.bpm;
        const bpm = Math.round(clamp(tools.between(bpmRange) + (energy - 1) * 3, bpmRange[0] - 4, bpmRange[1] + 4));
        const swing = round(tools.between(config.swing));
        const sectionGain = (type, bar, length) => {
            const progress = length < 2 ? 1 : bar / (length - 1);
            const ramp = type === 'intro' ? 0.86 + progress * 0.14 : type === 'pre' ? 0.9 + progress * 0.1 : 1;
            const fade = type === 'outro' ? 1 - progress * 0.18 : 1;
            return SECTION_GAIN[type] * ramp * fade * [0.88, 1, 1.05][energy];
        };

        const document = {
            format: 'sonicstage-song',
            version: 1,
            title: makeTitle(tools, config),
            style: styleId,
            bpm,
            timeSignature: meterName,
            rootKey: Math.floor(tools.random() * 12),
            scaleMode: mode,
            globalSwing: swing,
            loop: false,
            selected: 0,
            measures: [],
        };

        timeline.forEach((entry, index) => {
            const { type, bar, length, ending } = entry;
            const next = timeline[index + 1];
            const ctx = {
                ...entry,
                chordAt: () => entry.chords[0],
                nextAfter: () => (next ? next.chords[0] : chordOf(0)),
            };
            const parts = {};
            const drums = drumPatterns(song, ctx);
            ['kit', 'back', 'hats', 'perc'].forEach(role => {
                if (members[role] && drums[role]) parts[role] = drumPart(drums[role], kits[role], steps);
            });

            if (members.bass) {
                let pattern = null;
                const bassIntro = config.intro === 'band' || (config.intro === 'drums' && bar >= length / 2);
                if (ending) pattern = 'R';
                else if (type === 'intro') pattern = bassIntro ? bassPatterns.verse : null;
                else if (type === 'pre')
                    pattern = Array.from({ length: steps }, (_, s) => (s % 2 ? '.' : 'r')).join('');
                else if (type === 'bridge')
                    pattern = config.bridgeDrums === 'groove' ? bassPatterns.verse : 'R' + rest(steps / 2 - 1) + 'r';
                else if (type === 'chorus') pattern = bassPatterns.chorus;
                else pattern = bassPatterns.verse;
                if (pattern) parts.bass = bassPart(pattern, ctx, steps);
            }

            if (members.chords) {
                let pattern = type === 'chorus' ? compPatterns.chorus : compPatterns.verse;
                if (ending) pattern = 'X';
                else if (type === 'intro' && config.intro !== 'band')
                    pattern = steps === 16 ? 'X.......x.......' : 'X.....x.....';
                else if (type === 'bridge' && config.bridgeDrums !== 'groove') pattern = 'X' + rest(steps - 1);
                else if (type === 'pre')
                    pattern = Array.from({ length: steps }, (_, s) => (s % meter.beat ? '.' : 'x')).join('');
                parts.chords = compPart(members.chords, pattern, ctx, steps, voiceChords);
            }

            if (members.pad) {
                const allowed = config.pad.sections || ['intro', 'verse', 'pre', 'chorus', 'bridge', 'outro'];
                const verseOk = type !== 'verse' || energy === 2 || entry.section.occurrence > 0;
                const roomy = !(vocalIsPad && (type === 'chorus' || type === 'bridge'));
                if (ending) parts.pad = compPart(members.pad, 'X', ctx, steps, voicePad);
                else if (allowed.includes(type) && verseOk && roomy)
                    parts.pad = compPart(members.pad, padPattern, ctx, steps, voicePad);
            }

            if (members.lead) {
                const lead = members.lead;
                if (ending) {
                    parts.lead = linePart(lead, [{ step: 0, degree: 0, vel: 0.85 }], steps, leadBase);
                } else if (type === 'chorus' || type === 'pre' || (type === 'verse' && config.verseLead !== false)) {
                    const melody = melodyFor(type, length)[bar];
                    // A build that leads into a drop only teases the hook.
                    parts.lead = linePart(lead, melody, steps, leadBase, { velocity: type === 'pre' ? 0.8 : 1 });
                } else if (type === 'bridge' && config.bridgeLead !== 'rest') {
                    const melody = melodyFor('bridge', length)[bar];
                    const soft = config.bridgeLead !== 'solo';
                    parts.lead = linePart(lead, melody, steps, leadBase, {
                        velocity: soft ? 0.75 : 1,
                        filter: soft ? item => weight(item.step, meter) >= 1 : null,
                    });
                } else if (type === 'outro' && bar === 0) {
                    const hookLength = Math.max(...form.filter(s => s.type === 'chorus').map(s => s.length));
                    const hook = melodyFor('chorus', hookLength)[0];
                    parts.lead = linePart(lead, hook, steps, leadBase, {
                        velocity: 0.8,
                        filter: item => item.step < steps / 2,
                    });
                }
            }

            if (members.arp) {
                const busyChorus = members.vocal && !vocalIsPad;
                const plays =
                    type === 'intro' ||
                    type === 'pre' ||
                    type === 'bridge' ||
                    (type === 'chorus' && !busyChorus) ||
                    (type === 'verse' && (energy === 2 || entry.section.occurrence > 0));
                if (ending)
                    parts.arp = arpPart(members.arp, steps === 16 ? '0.1.2.3.' : '0.1.2.', ctx, steps, voiceArp);
                else if (plays) parts.arp = arpPart(members.arp, arpPattern, ctx, steps, voiceArp);
            }

            if (members.vocal) {
                const vocal = members.vocal;
                if (vocalIsPad && (type === 'chorus' || type === 'bridge' || ending)) {
                    parts.vocal = compPart(vocal, ending ? 'X' : padPattern, ctx, steps, voiceVocal);
                } else if (!vocalIsPad && type === 'chorus' && bar % 2 === 1) {
                    // Chops answer the lead on every second bar.
                    const tones = voiceVocal(ctx.chordAt(0));
                    const part = emptyPart();
                    chopCell.forEach((step, i) => {
                        const pitch = tones[tones.length - 1 - (i % Math.min(3, tones.length))];
                        part.steps[step] = eventFor(vocal, [pitch], i, tools.pick(['k', 't', 'p', null]));
                        part.vel[step] = i === 0 ? 0.9 : 0.72;
                    });
                    parts.vocal = part;
                }
            }

            const gain = sectionGain(type, bar, length);
            const label = entry.section.name + (bar ? ` · ${bar + 1}` : '');
            document.measures.push({
                label,
                slots: Object.entries(parts)
                    .filter(([, part]) => hasNotes(part))
                    .map(([role, part]) => {
                        const member = members[role];
                        return {
                            index: member.index,
                            presetId: member.preset.id,
                            steps: part.steps,
                            heights: part.steps.map((event, step) =>
                                event === null ? 0 : round(clamp(part.vel[step] * (energy === 0 ? 0.92 : 1), 0.2, 1)),
                            ),
                            volume: round(clamp(ROLE_LEVEL[role] * member.trim * gain, 0, 1)),
                            pan: member.pan,
                            pitchShift: 0,
                            muted: false,
                            solo: false,
                        };
                    })
                    .sort((a, b) => a.index - b.index),
            });
        });
        // Use the import validator as the authority for the document contract.
        // Validation builds independent runtime slots and does not apply them.
        readSongDocument(document);
        return document;
    };
})(globalThis);
