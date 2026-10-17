/***********************************************************************
 * SONG ARRANGEMENT — independent measure data, shared selected editor
 ***********************************************************************/
const SONG_STORAGE_KEY = 'sonicstage-song-v1';
const MAX_MEASURES = 1024;
const songState = {
    measures: [{ label: '', slots: appState.slots }],
    selected: 0,
    playMeasure: null,
    heardMeasure: null,
    loop: true,
    audition: false,
    view: 'stage',
    ready: false,
    restored: false,
    renderFrame: null,
    saveTimer: null,
    projectId: null,
};
// Cache the sheet once per edit; transport updates only touch two columns.
const songSheetDOM = { columns: [], selected: -1, playing: -1, step: -1, dirty: true, measures: null };

function newProjectId() {
    return crypto.randomUUID?.() || `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const cinematicState = {
    active: false,
    phase: 'idle',
    paused: false,
    elapsed: 0,
    shotElapsed: 0,
    shotNumber: 0,
    lastBeat: -1,
    beatsSinceShot: 0,
    subject: -1,
    visits: new Map(),
    shot: null,
    saved: null,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};

// Rendering follows the audible measure; the editor keeps its own selection.
// Never bind the stage to the scheduler's look-ahead position.
const stageState = { measure: null, slots: appState.slots, unlockedSlots: 6, step: 0, hudKey: '' };
let homeStageOverride = null;
let homeEnsemble = null;

function homeEnsembleSlots() {
    if (homeEnsemble) return homeEnsemble;
    const ids = ['drums_boombap', 'bass_upright', 'chords_rhodes', 'melody_sax', 'strings_violin', 'vocal_choir'];
    homeEnsemble = appState.slots.map(slot => ({
        index: slot.index,
        tier: slot.tier,
        preset: null,
        customSteps: null,
        customHeights: null,
        volume: 0.85,
        pan: 0,
        effects: [],
        pitchShift: 0,
        muted: false,
        solo: false,
        energy: 0,
        hitCount: 0,
        vowelState: 'A',
    }));
    ids.forEach((id, index) => {
        const preset = INSTRUMENT_PRESETS.find(item => item.id === id);
        const slot = homeEnsemble[index];
        slot.preset = preset;
        slot.customSteps = preset.steps.map(cloneStepValue);
        slot.customHeights = [...preset.visualHeights];
    });
    return homeEnsemble;
}

function prepareHomeStage() {
    const modal = document.getElementById('welcome-modal');
    const open = document.body.classList.contains('home-open') && modal && !modal.classList.contains('is-hidden');
    if (!open) {
        homeStageOverride = null;
        return;
    }
    const selected = songState.measures[songState.selected];
    if (selected.slots.some(slot => slot.preset)) homeStageOverride = null;
    else {
        const other = songState.measures.find(measure => measure.slots.some(slot => slot.preset));
        homeStageOverride = other ? other.slots : homeEnsembleSlots();
    }
}

function syncStageToMeasure() {
    const selected = songState.measures[songState.selected];
    const measure = cinematicState.active
        ? cinematicState.phase === 'intro'
            ? songState.measures[0]
            : songState.heardMeasure || songState.playMeasure || selected
        : appState.isPlaying
          ? songState.heardMeasure || songState.playMeasure || selected
          : selected;
    const changed = stageState.measure !== measure;
    const previousCapacity = stageState.unlockedSlots;
    const homeOpen =
        document.body.classList.contains('home-open') &&
        !document.getElementById('welcome-modal').classList.contains('is-hidden');
    const displaySlots = homeOpen && homeStageOverride ? homeStageOverride : measure.slots;
    stageState.measure = measure;
    stageState.slots = displaySlots;
    stageState.step = appState.isPlaying && songState.heardMeasure === measure ? appState.currentStep : 0;
    stageState.unlockedSlots = homeOpen
        ? getRequiredSlotCapacity(displaySlots, false)
        : appState.isPlaying || cinematicState.active
          ? getRequiredSlotCapacity(measure.slots)
          : appState.unlockedSlots;
    if (!scene || !sharedPerformerGeometries) return;

    ensurePedestalsUpTo(stageState.unlockedSlots);
    if (changed) {
        measure.slots.forEach(slot => {
            slot.energy = 0;
        });
        pedestalMeshes.forEach(ped => {
            ped.waveMesh.material.opacity = 0;
        });
    }
    // Reuse each musician rig until its instrument category actually changes.
    pedestalMeshes.forEach((_, index) => rebuildPedestalPerformer(index));
    updateAllInstancedLEDColors();
    const hudKey =
        `${homeOpen ? 'home' : 'edit'}:${songState.selected}:${displaySlots === appState.slots}:${stageState.unlockedSlots}:` +
        displaySlots
            .filter(s => s.preset)
            .map(s => `${s.index}:${s.preset.id}:${s.muted}:${s.solo}:${s.volume > 0.001}`)
            .join('|');
    if (changed || hudKey !== stageState.hudKey) {
        stageState.hudKey = hudKey;
        updatePedestalHUDBadges();
    }
    // Retarget the camera only when the stage footprint changes, preserving orbit controls otherwise.
    if (!cinematicState.active && stageState.unlockedSlots !== previousCapacity)
        updateCameraPresetTarget(appState.cameraMode);
    updateStageHeaderUI();
}

function editStageMeasure() {
    const index = songState.measures.indexOf(stageState.measure);
    if (index >= 0 && index !== songState.selected) selectSongMeasure(index, true);
}

function cloneMeasure(source, empty = false) {
    return {
        label: empty ? '' : source.label,
        slots: source.slots.map(slot => ({
            ...slot,
            preset: empty ? null : slot.preset,
            customSteps: empty ? null : getSlotSteps(slot).map(value => structuredClone(value)),
            customHeights: empty ? null : [...getSlotHeights(slot)],
            muted: empty ? false : slot.muted,
            solo: empty ? false : slot.solo,
            volume: empty ? 0.85 : slot.volume,
            pan: empty ? 0 : slot.pan,
            effects: empty ? [] : normalizePerformerEffects(slot.effects),
            pitchShift: empty ? 0 : slot.pitchShift,
            energy: 0,
            hitCount: 0,
            vowelState: 'A',
        })),
    };
}

function songDocument() {
    const doc = {
        format: 'sonicstage-song',
        version: 1,
        title: document.getElementById('project-title').value || 'Untitled song',
        bpm: appState.bpm,
        timeSignature: appState.timeSignature,
        rootKey: appState.rootKey,
        scaleMode: appState.scaleMode,
        globalSwing: appState.globalSwing,
        masterEffects: normalizePerformerEffects(appState.masterEffects),
        loop: songState.loop,
        selected: songState.selected,
        measures: songState.measures.map(measure => ({
            label: measure.label,
            slots: measure.slots
                .filter(s => s.preset)
                .map(s => ({
                    index: s.index,
                    presetId: s.preset.id,
                    steps: getSlotSteps(s),
                    heights: getSlotHeights(s),
                    volume: s.volume,
                    pan: s.pan,
                    effects: normalizePerformerEffects(s.effects),
                    pitchShift: s.pitchShift,
                    muted: s.muted,
                    solo: s.solo,
                })),
        })),
    };
    if (songState.projectId) doc.id = songState.projectId;
    return doc;
}

function readSongDocument(data) {
    if (
        !data ||
        typeof data !== 'object' ||
        data.format !== 'sonicstage-song' ||
        data.version !== 1 ||
        !Array.isArray(data.measures) ||
        data.measures.length < 1 ||
        data.measures.length > MAX_MEASURES
    )
        throw new Error('Choose a SonicStage song file (1–1024 measures).');
    const finite = (value, low, high) =>
        typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
    if (
        !finite(data.bpm, 1, 2400) ||
        !Number.isInteger(data.rootKey) ||
        !finite(data.rootKey, 0, 11) ||
        !Object.hasOwn(SCALE_DEFINITIONS, data.scaleMode) ||
        !finite(data.globalSwing, 0, 0.65) ||
        (data.timeSignature !== undefined && !Object.hasOwn(TIME_SIGNATURES, data.timeSignature))
    )
        throw new Error('Invalid song tempo, meter, or harmony.');
    const readEffects = (effects, target) => {
        if (
            effects !== undefined &&
            (!Array.isArray(effects) ||
                effects.length > MAX_PERFORMER_EFFECTS ||
                effects.some(
                    effect =>
                        !effect ||
                        !PERFORMER_EFFECT_BY_ID.has(effect.id) ||
                        !finite(effect.amount, 0, 1) ||
                        typeof effect.enabled !== 'boolean',
                ) ||
                new Set(effects.map(effect => effect.id)).size !== effects.length)
        )
            throw new Error(`Invalid ${target} effects.`);
        return normalizePerformerEffects(effects);
    };
    const masterEffects = readEffects(data.masterEffects, 'master');
    // Build and validate the entire document before replacing the current song.
    const measures = data.measures.map(raw => {
        if (!raw || typeof raw.label !== 'string' || !Array.isArray(raw.slots) || raw.slots.length > MAX_SLOTS)
            throw new Error('Invalid measure data.');
        const measure = cloneMeasure(songState.measures[0], true);
        measure.label = raw.label.slice(0, 40);
        const used = new Set();
        raw.slots.forEach(saved => {
            const preset = INSTRUMENT_PRESETS.find(p => p.id === saved.presetId);
            if (
                !preset ||
                !Number.isInteger(saved.index) ||
                !finite(saved.index, 0, MAX_SLOTS - 1) ||
                used.has(saved.index) ||
                !Array.isArray(saved.steps) ||
                saved.steps.length !== 16 ||
                !Array.isArray(saved.heights) ||
                saved.heights.length !== 16 ||
                !saved.heights.every(h => finite(h, 0, 1)) ||
                !finite(saved.volume, 0, 1) ||
                !finite(saved.pan, -1, 1) ||
                ![0, -12, 12].includes(saved.pitchShift) ||
                typeof saved.muted !== 'boolean' ||
                typeof saved.solo !== 'boolean'
            )
                throw new Error('Invalid instrument data.');
            const validNote = value => finite(value, -128, 255);
            const validStep = value =>
                value === null ||
                validNote(value) ||
                (typeof value === 'string' && value.length <= 16) ||
                (Array.isArray(value) && value.length <= 16 && value.every(validNote)) ||
                (value &&
                    typeof value === 'object' &&
                    !Array.isArray(value) &&
                    Object.entries(value).every(
                        ([key, v]) =>
                            ['n', 'slide', 'notes', 'v', 'v2', 'c', 'b', 'to', 'dur', 'vel'].includes(key) &&
                            (validNote(v) ||
                                (typeof v === 'string' && v.length <= 16) ||
                                (Array.isArray(v) && v.length <= 16 && v.every(validNote))),
                    ));
            readEffects(saved.effects, 'performer');
            if (!saved.steps.every(validStep)) throw new Error('Invalid beat data.');
            used.add(saved.index);
            Object.assign(measure.slots[saved.index], {
                preset,
                customSteps: structuredClone(saved.steps),
                customHeights: [...saved.heights],
                volume: saved.volume,
                pan: saved.pan,
                effects: normalizePerformerEffects(saved.effects),
                pitchShift: saved.pitchShift,
                muted: saved.muted,
                solo: saved.solo,
            });
        });
        return measure;
    });
    return { ...data, timeSignature: data.timeSignature || '4/4', masterEffects, measures };
}

function applySongDocument(data) {
    if (typeof data.id === 'string' && /^[\w-]{8,80}$/.test(data.id)) songState.projectId = data.id;
    else if (!songState.projectId) songState.projectId = newProjectId();
    document.getElementById('project-title').value =
        typeof data.title === 'string' ? data.title.slice(0, 60) : 'Untitled song';
    songState.measures = data.measures;
    songState.selected = Number.isInteger(data.selected)
        ? Math.max(0, Math.min(data.measures.length - 1, data.selected))
        : 0;
    songState.loop = data.loop !== false;
    songState.playMeasure = data.measures[songState.selected];
    songState.heardMeasure = null;
    appState.slots = songState.playMeasure.slots;
    appState.bpm = data.bpm;
    appState.timeSignature = data.timeSignature;
    appState.rootKey = data.rootKey;
    appState.scaleMode = data.scaleMode;
    appState.globalSwing = data.globalSwing;
    appState.masterEffects = normalizePerformerEffects(data.masterEffects);
    audioEngine.setMasterEffects(appState.masterEffects);
    document.getElementById('bpm-number-input').value = data.bpm;
    document.getElementById('bpm-slider').value = bpmToSlider(data.bpm);
    applyMeterLayout();
    document.getElementById('key-select').value = data.rootKey;
    document.getElementById('scale-select').value = data.scaleMode;
    document.getElementById('fx-global-swing').value = data.globalSwing * 100;
    document.getElementById('fx-global-swing-val').textContent = `${Math.round(data.globalSwing * 100)}%`;
    const subtitle = document.getElementById('subtitle-key-info');
    subtitle.textContent = `${KEY_NAMES[data.rootKey]} ${SCALE_DEFINITIONS[data.scaleMode].label}`;
}

function saveSongLocally() {
    if (!songState.ready) return;
    clearTimeout(songState.saveTimer);
    try {
        localStorage.setItem(SONG_STORAGE_KEY, JSON.stringify(songDocument()));
        if (typeof rememberRecentSong === 'function') rememberRecentSong();
        document.getElementById('song-save-status').textContent = 'Saved on this browser';
    } catch (_) {
        document.getElementById('song-save-status').textContent = 'Use Save song to keep a copy';
    }
}

function songChanged() {
    songSheetDOM.dirty = true;
    if (!songState.ready) return;
    document.getElementById('song-save-status').textContent = 'Saving…';
    clearTimeout(songState.saveTimer);
    songState.saveTimer = setTimeout(saveSongLocally, 500);
    if (songState.renderFrame === null)
        songState.renderFrame = requestAnimationFrame(() => {
            songState.renderFrame = null;
            syncStageToMeasure();
            renderSongArrangement(false);
        });
}

function selectSongMeasure(index, reveal = false) {
    if (!Number.isInteger(index) || index < 0 || index >= songState.measures.length) return;
    songState.selected = index;
    appState.slots = songState.measures[index].slots;
    // The editor selection never changes the song playback position.
    reconcileStageCapacity(false);
    refreshAllUI(false);
    renderSongArrangement(false);
    if (reveal)
        document
            .querySelector(`[data-measure-index="${index}"]`)
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function setSongView(view) {
    songState.view = view;
    document.body.classList.toggle('song-view', view === 'song');
    document.getElementById('song-workspace').hidden = view !== 'song';
    document.getElementById('btn-stage-view').setAttribute('aria-pressed', view === 'stage');
    document.getElementById('btn-song-view').setAttribute('aria-pressed', view === 'song');
    renderSongArrangement(false);
    if (appState.libraryTab === 'effects') renderEffectsLibrary();
    if (view === 'stage') onWindowResize();
}

function insertSongMeasures(empty, count = 1) {
    const available = MAX_MEASURES - songState.measures.length;
    if (available <= 0) {
        showStageToast('Song limit: 1024 bars');
        return;
    }
    const copies = Math.max(1, Math.min(available, 128, Math.floor(Number(count) || 1)));
    const source = songState.measures[songState.selected];
    songState.measures.splice(
        songState.selected + 1,
        0,
        ...Array.from({ length: copies }, () => cloneMeasure(source, empty)),
    );
    songChanged();
    selectSongMeasure(songState.selected + 1, true);
}

function resetSongTransport(index = songState.selected) {
    songState.playMeasure = songState.measures[index];
    songState.heardMeasure = null;
    audioEngine.current16thStep = 0;
    audioEngine.songEndScheduled = false;
    audioEngine.stepQueue = [];
    audioEngine.nextNoteTime = audioEngine.ctx ? audioEngine.ctx.currentTime + 0.04 : 0;
    appState.currentStep = 0;
}

function playSongFrom(index) {
    audioEngine.init();
    songState.audition = false;
    resetSongTransport(index);
    appState.isPlaying = true;
    updatePlayButtonUI();
    renderSongArrangement(false);
}

// Moves the editor and the playhead together, so the stage shows the bar you picked.
function goToSongMeasure(index) {
    if (!Number.isInteger(index) || index < 0 || index >= songState.measures.length) return;
    selectSongMeasure(index, true);
    if (appState.isPlaying && !songState.audition) playSongFrom(index);
    else {
        resetSongTransport(index);
        updatePlayButtonUI();
        renderSongArrangement(false);
    }
}

function playFromMeasure(index) {
    selectSongMeasure(index);
    playSongFrom(index);
}

// While playing, the current bar always finishes; the loop takes over at the next barline.
function toggleMeasureLoop() {
    songState.audition = !songState.audition;
    if (songState.audition && !appState.isPlaying) {
        resetSongTransport();
        audioEngine.init();
        appState.isPlaying = true;
    }
    updatePlayButtonUI();
    renderSongArrangement(false);
}

function stopSong() {
    appState.isPlaying = false;
    resetSongTransport();
    updatePlayButtonUI();
    highlightSequencerStep(-1);
    updateSongPlayhead();
}

function applyMeterLayout() {
    const meter = getMeter();
    document.documentElement.style.setProperty('--bar-steps', getStepsPerBar());
    document.getElementById('meter-select').value = appState.timeSignature;
    document.getElementById('song-meter-hint').textContent = appState.timeSignature;
    for (let b = 0; b < 7; b++) document.getElementById(`beat-led-${b}`).hidden = b >= meter.beats;
}

function setTimeSignature(signature) {
    if (!Object.hasOwn(TIME_SIGNATURES, signature) || signature === appState.timeSignature) return;
    appState.timeSignature = signature;
    if (audioEngine.current16thStep >= getStepsPerBar()) audioEngine.current16thStep = 0;
    applyMeterLayout();
    refreshAllUI();
    renderSongArrangement();
}

function transportMeasureIndex() {
    const measure = songState.heardMeasure || songState.playMeasure || songState.measures[0];
    return Math.max(0, songState.measures.indexOf(measure));
}

function updateTransportPosition() {
    const index = transportMeasureIndex();
    document.getElementById('bar-prev').disabled = index === 0;
    document.getElementById('bar-next').disabled = index === songState.measures.length - 1;
    const meter = getMeter();
    const stepsPerBar = getStepsPerBar();
    const step = songState.heardMeasure ? Math.min(appState.currentStep, stepsPerBar - 1) : 0;
    const beat = Math.floor(step / meter.stepsPerBeat);
    const elapsed = (index * stepsPerBar + step) * getSecondsPerStep();
    const length = songState.measures.length * stepsPerBar * getSecondsPerStep();
    document.getElementById('transport-measure').textContent = `${index + 1} / ${songState.measures.length}`;
    document.getElementById('transport-time').textContent = formatSongTime(elapsed, true);
    document.getElementById('transport-duration').textContent = `/ ${formatSongTime(length)}`;
    document
        .getElementById('transport-position')
        .setAttribute(
            'aria-label',
            `Measure ${index + 1} of ${songState.measures.length}, beat ${beat + 1} of ${meter.beats}, ${formatSongTime(elapsed)} of ${formatSongTime(length)}`,
        );
    for (let b = 0; b < meter.beats; b++) {
        const led = document.getElementById(`beat-led-${b}`);
        const active = b === beat;
        led.className = 'beat-light';
        led.classList.toggle('is-active', active);
        led.setAttribute('aria-current', active ? 'step' : 'false');
        led.setAttribute('aria-label', `Beat ${b + 1}${active ? ', current' : ''}`);
        led.textContent = b + 1;
    }
}

function updateSongPlayhead() {
    updateTransportPosition();
    const playing = appState.isPlaying && songState.heardMeasure;
    const measureIndex = playing ? songState.measures.indexOf(songState.heardMeasure) : -1;
    const step = playing ? appState.currentStep : -1;
    document.getElementById('song-position').textContent = playing
        ? `${songState.audition ? 'Audition' : 'Playing'} · Measure ${measureIndex + 1} · Beat ${Math.floor(step / getMeter().stepsPerBeat) + 1}`
        : appState.isPlaying
          ? 'Ready'
          : 'Stopped / paused';
    const nextPlaying = songState.view === 'song' ? measureIndex : -1;
    if (songSheetDOM.playing === nextPlaying && songSheetDOM.step === step) return;
    const previous = songSheetDOM.columns[songSheetDOM.playing];
    const next = songSheetDOM.columns[nextPlaying];
    if (previous) {
        if (previous !== next) previous.header?.classList.remove('is-playing');
        previous.cells.forEach(({ cell, steps }) => {
            if (previous !== next) cell.classList.remove('is-playing-step');
            steps?.[songSheetDOM.step]?.classList.remove('playing-step');
        });
    }
    if (next) {
        if (previous !== next) next.header?.classList.add('is-playing');
        next.cells.forEach(({ cell, steps }) => {
            if (previous !== next) cell.classList.add('is-playing-step');
            steps?.[step]?.classList.add('playing-step');
        });
    }
    songSheetDOM.playing = nextPlaying;
    songSheetDOM.step = step;
}

function updateSongSheetSelection() {
    if (songSheetDOM.selected === songState.selected) return;
    const select = (index, active) => {
        const column = songSheetDOM.columns[index];
        if (!column) return;
        column.header?.classList.toggle('is-selected', active);
        column.header?.querySelector('.measure-select')?.setAttribute('aria-pressed', String(active));
        column.cells.forEach(({ cell }) => cell.classList.toggle('is-selected', active));
    };
    select(songSheetDOM.selected, false);
    select(songState.selected, true);
    songSheetDOM.selected = songState.selected;
}

function renderSongArrangement(rebuild = true) {
    if (rebuild) songSheetDOM.dirty = true;
    updateTransportPosition();
    const selected = songState.measures[songState.selected];
    document.getElementById('measure-editing-label').textContent =
        `Bar ${songState.selected + 1} of ${songState.measures.length}`;
    document.getElementById('measure-prev').disabled = songState.selected === 0;
    document.getElementById('measure-next').disabled = songState.selected === songState.measures.length - 1;
    document.getElementById('bar-loop').setAttribute('aria-pressed', songState.audition);
    document.getElementById('song-move-left').disabled = songState.selected === 0;
    document.getElementById('song-move-right').disabled = songState.selected === songState.measures.length - 1;
    document.getElementById('song-delete').disabled = songState.measures.length === 1;
    document.getElementById('song-jump').max = songState.measures.length;
    if (document.activeElement !== document.getElementById('song-jump'))
        document.getElementById('song-jump').value = songState.selected + 1;
    if (document.activeElement !== document.getElementById('song-measure-label'))
        document.getElementById('song-measure-label').value = selected.label;
    document.getElementById('song-loop').setAttribute('aria-pressed', songState.loop);
    document.getElementById('song-audition').setAttribute('aria-pressed', songState.audition);
    const stepsPerBar = getStepsPerBar();
    const stepsPerBeat = getMeter().stepsPerBeat;
    const seconds = songState.measures.length * stepsPerBar * getSecondsPerStep();
    document.getElementById('song-summary').textContent =
        ` / ${songState.measures.length} ${songState.measures.length === 1 ? 'measure' : 'measures'} · ${formatSongTime(seconds)}`;
    const beatRuler = Array.from({ length: stepsPerBar }, (_, s) =>
        s % stepsPerBeat === 0 ? s / stepsPerBeat + 1 : '·',
    ).join(' ');
    if (songState.view !== 'song') return;
    if (!songSheetDOM.dirty && songSheetDOM.measures === songState.measures) {
        updateSongSheetSelection();
        updateSongPlayhead();
        return;
    }
    const escape = value =>
        String(value).replace(
            /[&<>"']/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
        );
    const measures = songState.measures;
    const maps = measures.map(m => new Map(m.slots.filter(s => s.preset).map(s => [s.index, s])));
    const rows = arrangementRows(measures);
    let html = '<thead><tr><th class="instrument-label">INSTRUMENT / BAR</th>';
    measures.forEach((m, i) => {
        html += `<th data-measure-index="${i}" class="${i === songState.selected ? 'is-selected' : ''}" scope="col"><button class="measure-select" aria-pressed="${i === songState.selected}" onclick="selectSongMeasure(${i})"><strong>MEASURE ${String(i + 1).padStart(2, '0')}</strong>${escape(m.label || `${maps[i].size} instruments`)}<span class="block mt-1 text-[8px] text-slate-500">${beatRuler}</span></button>${arrangementBarEffects(m, i)}<button class="measure-play" onclick="playFromMeasure(${i})" aria-label="Play from measure ${i + 1}" title="Play from here"></button></th>`;
    });
    html += '</tr></thead><tbody>';
    rows.forEach(({ preset, index: playerIndex }) => {
        const color = CATEGORY_META[preset.category].color;
        html += `<tr><th scope="row" class="instrument-label" style="color:${color};--track-color:${color}">${escape(preset.shortName)}<small>PLAYER ${String(playerIndex + 1).padStart(2, '0')}</small></th>`;
        maps.forEach((map, i) => {
            const candidate = map.get(playerIndex);
            const slot = candidate?.preset.id === preset.id ? candidate : null;
            const steps = slot ? getSlotSteps(slot) : [];
            const heights = slot ? getSlotHeights(slot) : [];
            const muted = slot && !isSlotAudible(slot, measures[i].slots);
            html += `<td data-measure-index="${i}" ${slot ? `data-slot-index="${slot.index}"` : 'data-empty-clip'} class="${i === songState.selected ? 'is-selected' : ''}"><button class="song-clip ${muted ? 'is-muted' : ''}${slot?.effects?.length ? ' has-effects' : ''}" onclick="${slot ? `selectArrangementClip(${i},${slot.index})` : `selectSongMeasure(${i})`}" aria-label="Edit ${escape(preset.shortName)}, player ${playerIndex + 1}, measure ${i + 1}${slot ? '' : ', empty'}${muted ? ', muted' : ''}">`;
            for (let s = 0; s < stepsPerBar; s++)
                html += `<span${s % stepsPerBeat === 0 ? ' class="is-beat"' : ''}${steps[s] != null ? ` style="background:${color};height:${Math.max(25, (heights[s] || 0.8) * 100)}%"` : ''}></span>`;
            html += `</button>${slot ? arrangementClipEffects(slot, i) : ''}</td>`;
        });
        html += '</tr>';
    });
    if (!rows.length)
        html += `<tr><td colspan="${measures.length + 1}" class="text-slate-400 p-6"><p style="padding:24px">Add a sound or generate a song to start.</p></td></tr>`;
    const sheet = document.getElementById('song-sheet');
    sheet.innerHTML = html + '</tbody>';
    songSheetDOM.columns = [];
    sheet.querySelectorAll('[data-measure-index]').forEach(cell => {
        const index = Number(cell.dataset.measureIndex);
        const column = (songSheetDOM.columns[index] ||= { header: null, cells: [] });
        if (cell.tagName === 'TH') column.header = cell;
        else column.cells.push({ cell, steps: cell.querySelector('.song-clip')?.children });
    });
    songSheetDOM.measures = measures;
    songSheetDOM.dirty = false;
    songSheetDOM.selected = songState.selected;
    songSheetDOM.playing = -1;
    songSheetDOM.step = -1;
    fitSongSheet();
    updateSongPlayhead();
}

const SONG_ZOOM_KEY = 'sonicstage-song-zoom';
const SONG_ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];
let songZoom = 1;

// At 100% the sheet fills its window; cells only shrink below their base size when zoomed out.
function fitSongSheet() {
    const scroller = document.getElementById('song-sheet-scroll');
    const sheet = document.getElementById('song-sheet');
    const head = sheet.tHead;
    document.getElementById('song-zoom-fit').textContent = `${Math.round(songZoom * 100)}%`;
    document.getElementById('song-zoom-out').disabled = songZoom <= SONG_ZOOM_STEPS[0];
    document.getElementById('song-zoom-in').disabled = songZoom >= SONG_ZOOM_STEPS.at(-1);
    if (!head || !scroller.clientWidth) return;
    const style = getComputedStyle(scroller);
    const baseCol = parseFloat(style.getPropertyValue('--song-col-base')) || 176;
    const baseRow = parseFloat(style.getPropertyValue('--song-row-base')) || 44;
    const rows = sheet.querySelectorAll('tbody th[scope="row"]').length;
    const fitCol = (scroller.clientWidth - head.rows[0].cells[0].offsetWidth) / songState.measures.length - 1;
    const fitRow = rows ? (scroller.clientHeight - head.offsetHeight) / rows - 1 : baseRow;
    scroller.style.setProperty('--song-col-w', `${Math.max(64, Math.floor(Math.max(baseCol, fitCol) * songZoom))}px`);
    scroller.style.setProperty('--song-row-h', `${Math.max(18, Math.floor(Math.max(baseRow, fitRow) * songZoom))}px`);
}

function setSongZoom(zoom) {
    const scroller = document.getElementById('song-sheet-scroll');
    const next = Math.min(SONG_ZOOM_STEPS.at(-1), Math.max(SONG_ZOOM_STEPS[0], zoom));
    const ratio = next / songZoom;
    songZoom = next;
    try {
        localStorage.setItem(SONG_ZOOM_KEY, String(next));
    } catch (_) {}
    fitSongSheet();
    scroller.scrollLeft *= ratio;
    scroller.scrollTop *= ratio;
}

function initSongZoom() {
    try {
        songZoom = Math.min(
            SONG_ZOOM_STEPS.at(-1),
            Math.max(SONG_ZOOM_STEPS[0], Number(localStorage.getItem(SONG_ZOOM_KEY)) || 1),
        );
    } catch (_) {}
    const scroller = document.getElementById('song-sheet-scroll');
    const step = direction => {
        const steps = direction > 0 ? SONG_ZOOM_STEPS : [...SONG_ZOOM_STEPS].reverse();
        return steps.find(s => (direction > 0 ? s > songZoom + 0.001 : s < songZoom - 0.001)) ?? steps.at(-1);
    };
    document.getElementById('song-zoom-in').addEventListener('click', () => setSongZoom(step(1)));
    document.getElementById('song-zoom-out').addEventListener('click', () => setSongZoom(step(-1)));
    document.getElementById('song-zoom-fit').addEventListener('click', () => setSongZoom(1));
    // Trackpad pinch arrives as a ctrl+wheel event.
    scroller.addEventListener(
        'wheel',
        event => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            setSongZoom(songZoom * Math.exp(-event.deltaY * 0.01));
        },
        { passive: false },
    );
    new ResizeObserver(fitSongSheet).observe(scroller);
}

function moveSongMeasure(from, to) {
    if (from === to || to < 0 || to >= songState.measures.length) return;
    if (typeof checkpointSong === 'function') checkpointSong();
    const [measure] = songState.measures.splice(from, 1);
    songState.measures.splice(to, 0, measure);
    songChanged();
    selectSongMeasure(to, true);
}

// The sheet is re-rendered often, so dragging is delegated from its stable scroll container
// and the column layout is reapplied every frame.
function initMeasureDragging() {
    const scroller = document.getElementById('song-sheet-scroll');
    const sheet = document.getElementById('song-sheet');
    let drag = null;
    const columns = () => {
        if (drag.body !== sheet.tBodies[0]) {
            drag.body = sheet.tBodies[0];
            drag.cells = [];
            sheet.querySelectorAll('[data-measure-index]').forEach(cell => {
                (drag.cells[Number(cell.dataset.measureIndex)] ||= []).push(cell);
            });
            drag.applied = null;
        }
        return drag.cells;
    };
    const clearLayout = () =>
        sheet.querySelectorAll('[data-measure-index]').forEach(cell => {
            cell.style.transform = '';
            cell.classList.remove('is-drag-column');
        });
    const layout = () => {
        const cols = columns();
        const head = cols[drag.from]?.[0];
        if (!head) return;
        const width = head.offsetWidth;
        const dx = drag.x - drag.startX + scroller.scrollLeft - drag.startScroll;
        const center = head.offsetLeft + dx + width / 2;
        let to = 0;
        cols.forEach((cells, i) => {
            if (i !== drag.from && cells[0].offsetLeft + cells[0].offsetWidth / 2 < center) to++;
        });
        drag.to = to;
        cols[drag.from].forEach(cell => {
            cell.classList.add('is-drag-column');
            cell.style.transform = `translateX(${dx}px)`;
        });
        if (drag.applied === to) return;
        drag.applied = to;
        cols.forEach((cells, i) => {
            if (i === drag.from) return;
            const shift = i > drag.from && i <= to ? -width : i < drag.from && i >= to ? width : 0;
            cells.forEach(cell => {
                cell.style.transform = shift ? `translateX(${shift}px)` : '';
            });
        });
    };
    const frame = () => {
        if (!drag?.active) return;
        const r = scroller.getBoundingClientRect(),
            edge = 60;
        const speed =
            drag.x < r.left + edge
                ? -(r.left + edge - drag.x)
                : drag.x > r.right - edge
                  ? drag.x - (r.right - edge)
                  : 0;
        if (speed) scroller.scrollLeft += speed * 0.35;
        layout();
        drag.frame = requestAnimationFrame(frame);
    };
    const end = commit => {
        if (!drag) return;
        const { active, from, to, frame: pending } = drag;
        drag = null;
        cancelAnimationFrame(pending);
        document.body.classList.remove('is-dragging-measure');
        clearLayout();
        if (!active) return;
        const suppress = event => {
            event.stopPropagation();
            event.preventDefault();
        };
        window.addEventListener('click', suppress, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', suppress, { capture: true }), 0);
        if (commit) moveSongMeasure(from, to);
    };
    scroller.addEventListener('pointerdown', event => {
        if (
            event.button !== 0 ||
            appState.draggedEffectId ||
            event.target.closest('.measure-play,.measure-effects,.song-clip-effects')
        )
            return;
        const cell = event.target.closest('#song-sheet [data-measure-index]');
        if (!cell) return;
        drag = {
            from: Number(cell.dataset.measureIndex),
            to: Number(cell.dataset.measureIndex),
            startX: event.clientX,
            startY: event.clientY,
            startScroll: scroller.scrollLeft,
            x: event.clientX,
            active: false,
            frame: 0,
            body: null,
            cells: [],
            applied: null,
        };
    });
    window.addEventListener('pointermove', event => {
        if (!drag) return;
        drag.x = event.clientX;
        if (!drag.active) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
            drag.active = true;
            document.body.classList.add('is-dragging-measure');
            drag.frame = requestAnimationFrame(frame);
        }
        layout();
    });
    window.addEventListener('pointerup', () => end(true));
    window.addEventListener('pointercancel', () => end(false));
}

function initSongComposer() {
    try {
        const saved = localStorage.getItem(SONG_STORAGE_KEY);
        if (saved) {
            applySongDocument(readSongDocument(JSON.parse(saved)));
            songState.restored = true;
        }
    } catch (_) {
        document.getElementById('song-save-status').textContent = 'Use Open song to restore a backup';
    }
    songState.playMeasure = songState.measures[songState.selected];
    applyMeterLayout();
    document.getElementById('meter-select').addEventListener('change', event => {
        setTimeSignature(event.target.value);
        showStageToast(`${appState.timeSignature} time`, '#06b6d4');
    });
    const bind = (id, handler) => document.getElementById(id).addEventListener('click', handler);
    bind('btn-song-view', () => setSongView('song'));
    bind('btn-stage-view', () => setSongView('stage'));
    bind('measure-prev', () => selectSongMeasure(songState.selected - 1, true));
    bind('measure-next', () => selectSongMeasure(songState.selected + 1, true));
    bind('song-add', () => insertSongMeasures(true));
    bind('song-duplicate', () => insertSongMeasures(false));
    bind('song-repeat', () => insertSongMeasures(false, document.getElementById('song-repeat-count').value));
    [-1, 1].forEach(direction =>
        bind(direction < 0 ? 'song-move-left' : 'song-move-right', () => {
            const target = songState.selected + direction;
            if (target < 0 || target >= songState.measures.length) return;
            const [measure] = songState.measures.splice(songState.selected, 1);
            songState.measures.splice(target, 0, measure);
            songChanged();
            selectSongMeasure(target, true);
        }),
    );
    initMeasureDragging();
    initSongZoom();
    bind('song-delete', () => {
        if (songState.measures.length === 1) return;
        const deleted = songState.measures[songState.selected];
        songState.measures.splice(songState.selected, 1);
        const index = Math.min(songState.selected, songState.measures.length - 1);
        if (songState.playMeasure === deleted || songState.heardMeasure === deleted) {
            songState.selected = index;
            stopSong();
        }
        songChanged();
        selectSongMeasure(index, true);
    });
    bind('song-play-start', () => playSongFrom(0));
    bind('song-play-selected', () => playSongFrom(songState.selected));
    bind('song-stop', stopSong);
    bind('song-loop', () => {
        songState.loop = !songState.loop;
        songChanged();
        renderSongArrangement();
    });
    bind('song-audition', toggleMeasureLoop);
    bind('bar-loop', toggleMeasureLoop);
    bind('bar-prev', () => goToSongMeasure(transportMeasureIndex() - 1));
    bind('bar-next', () => goToSongMeasure(transportMeasureIndex() + 1));
    document.getElementById('song-jump').addEventListener('change', event => {
        const index = Math.max(
            0,
            Math.min(songState.measures.length - 1, Math.floor(Number(event.target.value) || 1) - 1),
        );
        selectSongMeasure(index, true);
    });
    document.getElementById('song-measure-label').addEventListener('input', event => {
        songState.measures[songState.selected].label = event.target.value;
        songChanged();
    });
    bind('song-export', () => {
        saveSongLocally();
        const url = URL.createObjectURL(new Blob([JSON.stringify(songDocument())], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'sonicstage-song.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    bind('song-import', () => document.getElementById('song-file').click());
    document.getElementById('song-file').addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            if (file.size > 128 * 1024 * 1024) throw new Error('Song file is too large (128 MB maximum).');
            const data = readSongDocument(JSON.parse(await file.text()));
            if (typeof data.id !== 'string') data.id = newProjectId();
            if (typeof rememberRecentSong === 'function') rememberRecentSong();
            checkpointSong();
            stopSong();
            applySongDocument(data);
            resetSongTransport();
            audioEngine.updateDelaySync();
            songChanged();
            selectSongMeasure(songState.selected, true);
            enterStudio();
            saveSongLocally();
            showStageToast('Song opened', '#34d399');
        } catch (error) {
            showStageToast(error instanceof SyntaxError ? 'Unable to read this song file.' : error.message, '#f43f5e');
        }
        event.target.value = '';
    });
    new ResizeObserver(() =>
        document.documentElement.style.setProperty(
            '--transport-height',
            `${document.getElementById('transport-header').getBoundingClientRect().bottom + 8}px`,
        ),
    ).observe(document.getElementById('transport-header'));
    window.addEventListener('pagehide', saveSongLocally);
    renderSongArrangement();
}

function showStageToast(message, colorHex = '#f59e0b') {
    const toast = document.getElementById('stage-toast');
    const dot = document.getElementById('stage-toast-dot');
    const text = document.getElementById('stage-toast-text');
    if (!toast) return;
    dot.style.backgroundColor = colorHex;
    text.textContent = message;
    toast.classList.remove('opacity-0', '-translate-y-2');
    toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', '-translate-y-2');
    }, 2600);
}

/**
 * Continuous 7-Tier Concentric Stage Scaling Rule (6 -> 12 -> 24 -> 40 -> 60 -> 80 -> 100):
 * - Whenever all slots in the current ring are filled (or activeCount reaches a tier's capacity),
 *   the next concentric amphitheater ring automatically unlocks and elevates!
 * - When removing an instrument, outer-ring performers compact inward into empty inner-ring slots,
 *   and any unused outer rings smoothly retract back into the arena floor.
 */
function reconcileStageCapacity(forceCompactOnRemove = false) {
    // Compact any sparse outer performers into empty lower-index slots when removing instruments
    if (forceCompactOnRemove) {
        let writeIdx = 0;
        for (let readIdx = 0; readIdx < MAX_SLOTS; readIdx++) {
            if (appState.slots[readIdx].preset !== null) {
                if (readIdx !== writeIdx) {
                    const src = appState.slots[readIdx];
                    const dst = appState.slots[writeIdx];
                    dst.preset = src.preset;
                    dst.customSteps = src.customSteps;
                    dst.customHeights = src.customHeights;
                    dst.volume = src.volume;
                    dst.pan = src.pan;
                    dst.effects = normalizePerformerEffects(src.effects);
                    if (appState.effectsSlotIndex === readIdx) appState.effectsSlotIndex = writeIdx;
                    dst.pitchShift = src.pitchShift;
                    dst.muted = src.muted;
                    dst.solo = src.solo;
                    dst.energy = src.energy;
                    audioEngine.setSlotGain(writeIdx, dst.volume);
                    audioEngine.setSlotPan(writeIdx, dst.pan);

                    src.preset = null;
                    src.customSteps = null;
                    src.customHeights = null;
                    src.volume = 0.85;
                    src.pan = 0.0;
                    src.effects = [];
                    src.pitchShift = 0;
                    src.muted = false;
                    src.solo = false;
                    src.energy = 0;
                    audioEngine.setSlotGain(readIdx, 0.85);
                    audioEngine.setSlotPan(readIdx, 0.0);
                }
                writeIdx++;
            }
        }
    }

    appState.unlockedSlots = getRequiredSlotCapacity(appState.slots, !forceCompactOnRemove);
    syncStageToMeasure();
}

// Pure capacity calculation shared by the editor and the playback stage.
function getRequiredSlotCapacity(slots, unlockNext = false) {
    const count = slots.filter(slot => slot.preset).length;
    let highest = -1;
    slots.forEach((slot, index) => {
        if (slot.preset) highest = index;
    });
    let capacity = 6;
    STAGE_TIERS.forEach((tier, index) => {
        if (highest >= tier.start) capacity = Math.max(capacity, tier.cumSlots);
        if (unlockNext && count >= tier.cumSlots && STAGE_TIERS[index + 1]) {
            capacity = Math.max(capacity, STAGE_TIERS[index + 1].cumSlots);
        }
    });
    return capacity;
}

function updateStageHeaderUI() {
    const count = stageState.slots.filter(slot => slot.preset).length;
    const tierText = document.getElementById('stage-tier-text');
    const tierDot = document.getElementById('stage-tier-dot');
    const matrixBadge = document.getElementById('matrix-capacity-badge');
    const bar = Math.max(0, songState.measures.indexOf(stageState.measure)) + 1;
    if (tierText)
        tierText.textContent = `${appState.isPlaying ? 'LIVE' : 'EDIT'} BAR ${bar} · ${count}/${stageState.unlockedSlots} STAGES`;
    document.getElementById('stage-status-pill').title = appState.isPlaying
        ? `Stage follows playback: measure ${bar}`
        : `Stage previews the selected measure: ${bar}`;
    if (tierDot) {
        tierDot.className =
            stageState.unlockedSlots > 12
                ? 'w-2 h-2 rounded-full bg-fuchsia-400'
                : stageState.unlockedSlots === 12
                  ? 'w-2 h-2 rounded-full bg-amber-400'
                  : 'w-2 h-2 rounded-full bg-cyan-400';
    }
    if (matrixBadge) {
        const editingCount = getActiveInstrumentCount();
        matrixBadge.textContent = `${appState.unlockedSlots}-STAGE ARENA (${editingCount} INSTRUMENTS)`;
    }
}
