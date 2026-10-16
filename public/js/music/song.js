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
          ? songState.heardMeasure || (songState.audition ? selected : songState.playMeasure) || selected
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
        rootKey: appState.rootKey,
        scaleMode: appState.scaleMode,
        globalSwing: appState.globalSwing,
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
        !finite(data.globalSwing, 0, 0.65)
    )
        throw new Error('Invalid song tempo or harmony.');
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
            if (!saved.steps.every(validStep)) throw new Error('Invalid beat data.');
            used.add(saved.index);
            Object.assign(measure.slots[saved.index], {
                preset,
                customSteps: structuredClone(saved.steps),
                customHeights: [...saved.heights],
                volume: saved.volume,
                pan: saved.pan,
                pitchShift: saved.pitchShift,
                muted: saved.muted,
                solo: saved.solo,
            });
        });
        return measure;
    });
    return { ...data, measures };
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
    appState.rootKey = data.rootKey;
    appState.scaleMode = data.scaleMode;
    appState.globalSwing = data.globalSwing;
    document.getElementById('bpm-number-input').value = data.bpm;
    document.getElementById('bpm-slider').value = bpmToSlider(data.bpm);
    document.getElementById('key-select').value = data.rootKey;
    document.getElementById('scale-select').value = data.scaleMode;
    document.getElementById('fx-global-swing').value = (data.globalSwing / 0.55) * 100;
    document.getElementById('fx-global-swing-val').textContent = `${Math.round((data.globalSwing / 0.55) * 100)}%`;
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
    if (!songState.ready) return;
    document.getElementById('song-save-status').textContent = 'Saving…';
    clearTimeout(songState.saveTimer);
    songState.saveTimer = setTimeout(saveSongLocally, 500);
    if (songState.renderFrame === null)
        songState.renderFrame = requestAnimationFrame(() => {
            songState.renderFrame = null;
            syncStageToMeasure();
            renderSongArrangement();
        });
}

function selectSongMeasure(index, reveal = false) {
    if (!Number.isInteger(index) || index < 0 || index >= songState.measures.length) return;
    songState.selected = index;
    appState.slots = songState.measures[index].slots;
    // The editor selection never changes the song playback position.
    reconcileStageCapacity(false);
    refreshAllUI();
    renderSongArrangement();
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
    renderSongArrangement();
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
    renderSongArrangement();
}

function stopSong() {
    appState.isPlaying = false;
    resetSongTransport();
    updatePlayButtonUI();
    highlightSequencerStep(-1);
    updateSongPlayhead();
}

function updateTransportPosition() {
    const measure = songState.heardMeasure || songState.playMeasure || songState.measures[0];
    const index = Math.max(0, songState.measures.indexOf(measure));
    const beat = songState.heardMeasure ? Math.floor(appState.currentStep / 4) : 0;
    document.getElementById('transport-measure').textContent = `${index + 1} / ${songState.measures.length}`;
    document
        .getElementById('transport-position')
        .setAttribute('aria-label', `Measure ${index + 1} of ${songState.measures.length}, beat ${beat + 1} of 4`);
    for (let b = 0; b < 4; b++) {
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
        ? `${songState.audition ? 'Audition' : 'Playing'} · Measure ${measureIndex + 1} · Beat ${Math.floor(step / 4) + 1}`
        : appState.isPlaying
          ? 'Ready'
          : 'Stopped / paused';
    document
        .querySelectorAll('#song-sheet th.is-playing, #song-sheet td.is-playing-step')
        .forEach(el => el.classList.remove('is-playing', 'is-playing-step'));
    document.querySelectorAll('#song-sheet .playing-step').forEach(el => el.classList.remove('playing-step'));
    if (measureIndex >= 0 && songState.view === 'song') {
        document.querySelector(`#song-sheet th[data-measure-index="${measureIndex}"]`)?.classList.add('is-playing');
        document.querySelectorAll(`#song-sheet td[data-measure-index="${measureIndex}"]`).forEach(cell => {
            cell.classList.add('is-playing-step');
            cell.querySelector(`.song-clip span:nth-child(${step + 1})`)?.classList.add('playing-step');
        });
    }
}

function renderSongArrangement() {
    updateTransportPosition();
    const selected = songState.measures[songState.selected];
    document.getElementById('measure-editing-label').textContent =
        `Bar ${songState.selected + 1} of ${songState.measures.length}`;
    document.getElementById('measure-prev').disabled = songState.selected === 0;
    document.getElementById('measure-next').disabled = songState.selected === songState.measures.length - 1;
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
    const seconds = Math.round((songState.measures.length * 4 * 60) / appState.bpm);
    document.getElementById('song-summary').textContent =
        ` / ${songState.measures.length} ${songState.measures.length === 1 ? 'measure' : 'measures'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (songState.view !== 'song') return;
    const escape = value =>
        String(value).replace(
            /[&<>"']/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
        );
    const measures = songState.measures;
    const maps = measures.map(m => new Map(m.slots.filter(s => s.preset).map(s => [s.preset.id, s])));
    const presets = INSTRUMENT_PRESETS.filter(p => maps.some(map => map.has(p.id)));
    let html = '<thead><tr><th class="instrument-label">INSTRUMENT / BAR</th>';
    measures.forEach((m, i) => {
        html += `<th data-measure-index="${i}" class="${i === songState.selected ? 'is-selected' : ''}" scope="col"><button class="measure-select" aria-pressed="${i === songState.selected}" onclick="selectSongMeasure(${i})"><strong>MEASURE ${String(i + 1).padStart(2, '0')}</strong>${escape(m.label || `${maps[i].size} instruments`)}<span class="block mt-1 text-[8px] text-slate-500">1 · · · 2 · · · 3 · · · 4 · · ·</span></button></th>`;
    });
    html += '</tr></thead><tbody>';
    presets.forEach(preset => {
        const color = CATEGORY_META[preset.category].color;
        html += `<tr><th scope="row" class="instrument-label" style="color:${color};--track-color:${color}">${escape(preset.shortName)}</th>`;
        maps.forEach((map, i) => {
            const slot = map.get(preset.id);
            const steps = slot ? getSlotSteps(slot) : [];
            const heights = slot ? getSlotHeights(slot) : [];
            const muted = slot && !isSlotAudible(slot, measures[i].slots);
            html += `<td data-measure-index="${i}" class="${i === songState.selected ? 'is-selected' : ''}"><button class="song-clip ${muted ? 'is-muted' : ''}" onclick="selectSongMeasure(${i})" aria-label="Edit ${escape(preset.shortName)}, measure ${i + 1}${muted ? ', muted' : ''}">`;
            for (let s = 0; s < 16; s++)
                html += `<span${steps[s] != null ? ` style="background:${color};height:${Math.max(25, (heights[s] || 0.8) * 100)}%"` : ''}></span>`;
            html += '</button></td>';
        });
        html += '</tr>';
    });
    if (!presets.length)
        html += `<tr><td colspan="${measures.length + 1}" class="text-slate-400 p-6"><p style="padding:24px">Add a sound or generate a song to start.</p></td></tr>`;
    document.getElementById('song-sheet').innerHTML = html + '</tbody>';
    updateSongPlayhead();
}

function moveSongMeasure(from, to) {
    if (from === to || to < 0 || to >= songState.measures.length) return;
    if (typeof checkpointSong === 'function') checkpointSong();
    const [measure] = songState.measures.splice(from, 1);
    songState.measures.splice(to, 0, measure);
    selectSongMeasure(to, true);
}

// The sheet is re-rendered often, so dragging is delegated from its stable scroll container.
function initMeasureDragging() {
    const scroller = document.getElementById('song-sheet-scroll');
    let drag = null;
    const headers = () => [...document.querySelectorAll('#song-sheet thead th[data-measure-index]')];
    const clearMarkers = () =>
        document
            .querySelectorAll('#song-sheet .drop-before, #song-sheet .drop-after, #song-sheet .is-drag-source')
            .forEach(el => el.classList.remove('drop-before', 'drop-after', 'is-drag-source'));
    const insertionAt = clientX => {
        const cells = headers();
        const index = cells.findIndex(cell => {
            const r = cell.getBoundingClientRect();
            return clientX < r.left + r.width / 2;
        });
        return index === -1 ? cells.length : index;
    };
    const autoScroll = () => {
        if (!drag?.active) return;
        const r = scroller.getBoundingClientRect(),
            edge = 60;
        const speed =
            drag.x < r.left + edge
                ? -(r.left + edge - drag.x)
                : drag.x > r.right - edge
                  ? drag.x - (r.right - edge)
                  : 0;
        if (speed) {
            scroller.scrollLeft += speed * 0.35;
            mark();
        }
        drag.frame = requestAnimationFrame(autoScroll);
    };
    const mark = () => {
        clearMarkers();
        const cells = headers();
        cells[drag.from]?.classList.add('is-drag-source');
        drag.insert = insertionAt(drag.x);
        if (drag.insert === drag.from || drag.insert === drag.from + 1) return;
        if (drag.insert < cells.length) cells[drag.insert].classList.add('drop-before');
        else cells[cells.length - 1]?.classList.add('drop-after');
    };
    const end = commit => {
        if (!drag) return;
        const { active, from, insert, frame } = drag;
        drag = null;
        cancelAnimationFrame(frame);
        clearMarkers();
        document.body.classList.remove('is-dragging-measure');
        if (!active) return;
        const suppress = event => {
            event.stopPropagation();
            event.preventDefault();
        };
        window.addEventListener('click', suppress, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', suppress, { capture: true }), 0);
        if (commit) moveSongMeasure(from, insert > from ? insert - 1 : insert);
    };
    scroller.addEventListener('pointerdown', event => {
        const cell = event.button === 0 && event.target.closest('thead th[data-measure-index]');
        if (!cell) return;
        drag = {
            from: Number(cell.dataset.measureIndex),
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            active: false,
            insert: -1,
            frame: 0,
        };
    });
    window.addEventListener('pointermove', event => {
        if (!drag) return;
        drag.x = event.clientX;
        if (!drag.active) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
            drag.active = true;
            document.body.classList.add('is-dragging-measure');
            drag.frame = requestAnimationFrame(autoScroll);
        }
        mark();
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
            selectSongMeasure(target, true);
        }),
    );
    initMeasureDragging();
    bind('song-delete', () => {
        if (songState.measures.length === 1) return;
        const deleted = songState.measures[songState.selected];
        songState.measures.splice(songState.selected, 1);
        const index = Math.min(songState.selected, songState.measures.length - 1);
        if (songState.playMeasure === deleted || songState.heardMeasure === deleted) {
            songState.selected = index;
            stopSong();
        }
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
    bind('song-audition', () => {
        songState.audition = !songState.audition;
        resetSongTransport();
        if (songState.audition) {
            audioEngine.init();
            appState.isPlaying = true;
        }
        updatePlayButtonUI();
        renderSongArrangement();
    });
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
