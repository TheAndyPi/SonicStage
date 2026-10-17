/***********************************************************************
 * 9. TOKEN PALETTE, DRAG-AND-DROP & 16-STEP BEAT SEQUENCER UI
 ***********************************************************************/
function refreshAllUI(notifyChange = true) {
    syncStageToMeasure();
    audioEngine.syncPerformerEffects();
    renderTokenPalette();
    renderTimelineTracks(notifyChange);
    updatePedestalHUDBadges();
    updateStageHeaderUI();
    highlightSequencerStep(appState.currentStep);
}

function updatePlayButtonUI() {
    syncStageToMeasure();
    updateSongPlayhead();
    const btn = document.getElementById('btn-play-toggle');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const text = document.getElementById('play-status-text');
    if (appState.isPlaying) {
        iconPlay.classList.add('hidden');
        iconPause.classList.remove('hidden');
        text.textContent = 'PAUSE';
        btn.setAttribute('aria-label', 'Pause playback');
        btn.className =
            'flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg font-mono font-bold text-[10px] sm:text-[11px] bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors shrink-0';
    } else {
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
        text.textContent = 'PLAY';
        btn.setAttribute('aria-label', 'Resume playback');
        btn.className =
            'flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg font-mono font-bold text-[10px] sm:text-[11px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-colors shrink-0';
    }
}

function setBeatBarSize(sizeKey, customPxHeight = null) {
    const cfg = BEATBAR_SIZES[sizeKey] || BEATBAR_SIZES.md;
    appState.beatBarSize = sizeKey;
    const heights = { sm: 174, md: 258, lg: 350, xl: 450 };
    if (typeof setStudioBeatHeight === 'function') setStudioBeatHeight(customPxHeight || heights[sizeKey] || 258);
    const wrapper = document.getElementById('timeline-tracks-wrapper');
    wrapper.style.setProperty('--step-cell-h', cfg.stepCellPx);
    wrapper.style.setProperty('--row-pad-y', cfg.rowPadPx);
    document
        .querySelectorAll('.beatbar-size-btn')
        .forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.size === sizeKey));
}

// Mouse dragging follows movement; touch dragging requires a deliberate stationary hold.
// Track the whole press on window so releasing outside a card always cancels its timer.
function bindLibraryCardDrag(card, startDrag, activate, canDrag = () => true) {
    let press = null;
    let timer;
    let dragged = false;
    let scrolled = false;
    const cancel = () => {
        clearTimeout(timer);
        press = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('blur', cancel);
    };
    const release = event => {
        if (press && event.pointerId === press.id) cancel();
    };
    const begin = (x, y) => {
        cancel();
        if (!card.isConnected) return;
        dragged = true;
        startDrag(x, y);
    };
    const move = event => {
        if (!press || event.pointerId !== press.id) return;
        const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
        if (!press.touch && distance > 5) begin(event.clientX, event.clientY);
        else if (press.touch && distance > 10) {
            scrolled = true;
            cancel();
        }
    };
    card.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        cancel();
        dragged = false;
        scrolled = false;
        if (!canDrag(event)) return;
        press = { id: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType !== 'mouse' };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', cancel);
        if (press.touch) timer = setTimeout(() => press && begin(press.x, press.y), 500);
    });
    card.addEventListener(
        'touchmove',
        event => {
            if (dragged && (appState.draggedPresetId || appState.draggedEffectId)) event.preventDefault();
        },
        { passive: false },
    );
    card.addEventListener('contextmenu', event => {
        if (press || dragged) event.preventDefault();
    });
    card.addEventListener('click', event => {
        cancel();
        if (event.detail === 0 || (!dragged && !scrolled && !appState.draggedPresetId && !appState.draggedEffectId))
            activate(event);
    });
}

function renderTokenPalette() {
    if (appState.libraryTab === 'effects') return renderEffectsLibrary();
    const palette = document.getElementById('token-palette');
    if (!palette) return;
    const { scrollLeft, scrollTop } = palette;
    palette.innerHTML = '';

    const query = (document.getElementById('sound-search')?.value || '').trim().toLowerCase();
    const filtered = orderedStudioSounds().filter(
        p =>
            (appState.selectedCategory === 'all' || p.category === appState.selectedCategory) &&
            (p.shortName + ' ' + p.category).toLowerCase().includes(query),
    );
    if (!filtered.length) palette.innerHTML = '<p class="empty-search">No sounds found.</p>';

    filtered.forEach(preset => {
        const meta = CATEGORY_META[preset.category];
        const playerCount = appState.slots.filter(s => s.preset && s.preset.id === preset.id).length;
        const isActive = playerCount > 0;
        const countLabel = `${playerCount} ${preset.shortName} player${playerCount === 1 ? '' : 's'}`;

        const card = document.createElement('div');
        card.className = `studio-token px-2.5 py-1.5 rounded-lg cursor-pointer flex items-center justify-between gap-1.5 select-none ${isActive ? `is-active ${meta.activeClass}` : ''}`;
        card.style.setProperty('--sound-color', meta.color);
        card.dataset.category = preset.category;
        card.dataset.presetId = preset.id;
        card.innerHTML = `<button type="button" class="sound-main" data-sound-action="main" aria-label="${isActive ? countLabel : `Add ${preset.shortName}`}"><span class="sound-icon" aria-hidden="true">${instrumentGlyph(preset.category)}</span><span class="sound-info"><strong>${preset.shortName}</strong><small>${meta.name}</small></span></button>${
            isActive
                ? `<span class="sound-stepper" role="group" aria-label="${countLabel}"><button type="button" data-sound-action="remove" aria-label="Remove a ${preset.shortName} player" title="Remove a player">−</button><output aria-live="polite">${playerCount}</output><button type="button" data-sound-action="add" aria-label="Add another ${preset.shortName} player" title="Add another player">+</button></span>`
                : '<span class="sound-add" aria-hidden="true">+</span>'
        }`;

        bindLibraryCardDrag(
            card,
            (x, y) => startTokenDrag(preset, x, y),
            event => {
                const action = event.target.closest('[data-sound-action]')?.dataset.soundAction;
                if (action === 'remove') removePresetPlayer(preset.id);
                else if (action === 'add' || !isActive) assignPresetToSlot(preset.id);
            },
            event => !event.target.closest('.sound-stepper'),
        );

        palette.appendChild(card);
    });
    palette.scrollLeft = scrollLeft;
    palette.scrollTop = scrollTop;
}

function startTokenDrag(preset, clientX, clientY) {
    appState.draggedPresetId = preset.id;
    const meta = CATEGORY_META[preset.category];
    const ghost = document.getElementById('drag-ghost');
    document.getElementById('drag-ghost-dot').style.backgroundColor = meta.color;
    document.getElementById('drag-ghost-label').textContent = preset.shortName;
    ghost.style.left = `${clientX}px`;
    ghost.style.top = `${clientY}px`;
    ghost.style.display = 'flex';
    updatePedestalHUDBadges();

    const stopListening = () => {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
    };
    const onUp = e => {
        if (appState.draggedPresetId) {
            // A touch drop lands where the finger lifts, even if it never hovered first.
            if (e.pointerType !== 'mouse') checkPedestalHover(e.clientX, e.clientY);
            if (appState.hoveredSlotIndex >= 0 && appState.hoveredSlotIndex < stageState.unlockedSlots) {
                editStageMeasure();
                assignPresetToSlot(appState.draggedPresetId, appState.hoveredSlotIndex);
            } else {
                assignPresetToSlot(appState.draggedPresetId);
            }
            endTokenDrag();
        }
        stopListening();
    };
    const onCancel = () => {
        endTokenDrag();
        stopListening();
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
}

function endTokenDrag() {
    appState.draggedPresetId = null;
    appState.hoveredSlotIndex = -1;
    const ghost = document.getElementById('drag-ghost');
    if (ghost) ghost.style.display = 'none';
    updatePedestalHUDBadges();
}

let cachedStepColumns = Array.from({ length: 16 }, () => []);
let lastHighlightedStep = -1;

function renderTimelineTracks(notifyChange = true) {
    if (notifyChange) songChanged();
    const wrapper = document.getElementById('timeline-tracks-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    cachedStepColumns = Array.from({ length: 16 }, () => []);
    lastHighlightedStep = -1;

    const sizeCfg = BEATBAR_SIZES[appState.beatBarSize] || BEATBAR_SIZES.md;
    wrapper.style.setProperty('--step-cell-h', sizeCfg.stepCellPx);
    wrapper.style.setProperty('--row-pad-y', sizeCfg.rowPadPx);

    const activeSlots = appState.slots.filter(s => s.index < appState.unlockedSlots && s.preset !== null);

    document.querySelector('#timeline-panel .beat-ruler')?.remove();
    if (activeSlots.length === 0) {
        wrapper.innerHTML = `
            <div class="text-center py-3 text-[11px] font-mono text-slate-400">
                Choose a sound to start your beat.
            </div>
        `;
        return;
    }

    const frag = document.createDocumentFragment();
    const ruler = document.createElement('div');
    ruler.className = 'beat-ruler';
    ruler.setAttribute('aria-hidden', 'true');
    const stepsPerBar = getStepsPerBar();
    const stepsPerBeat = getMeter().stepsPerBeat;
    ruler.innerHTML = `<div class="beat-step-ruler">${Array.from({ length: stepsPerBar }, (_, s) => (s % stepsPerBeat === 0 ? `<span class="is-downbeat">${s + 1}</span>` : `<span>${s + 1}</span>`)).join('')}</div>`;
    document.querySelector('#timeline-panel > div:nth-child(2)')?.appendChild(ruler);

    activeSlots.forEach(slot => {
        const meta = CATEGORY_META[slot.preset.category];
        const audible = isSlotAudible(slot);
        const volPct = Math.round(slot.volume * 100);
        const panVal = slot.pan || 0;
        const panText =
            panVal === 0 ? 'C' : panVal < 0 ? `L${Math.round(Math.abs(panVal) * 50)}` : `R${Math.round(panVal * 50)}`;
        const octText = slot.pitchShift === 12 ? '+12' : slot.pitchShift === -12 ? '-12' : '0st';

        const stepsArr = getSlotSteps(slot);
        const heightsArr = getSlotHeights(slot);

        const row = document.createElement('div');
        row.dataset.slotIndex = slot.index;
        row.className = `timeline-track-row flex items-center gap-1.5 bg-[#070b16]/90 border border-white/5 rounded-lg px-2 ${audible ? '' : 'opacity-45'}`;

        let stepsHTML = '';
        for (let s = 0; s < stepsPerBar; s++) {
            const stepEvt = stepsArr[s];
            const h = heightsArr[s] || 0;
            const hasHit = stepEvt !== null && stepEvt !== undefined && h > 0;
            const barHeightPct = hasHit ? Math.max(26, Math.round(h * 100)) : 16;
            const barColor = hasHit ? meta.color : 'rgba(255,255,255,0.07)';

            stepsHTML += `
                <button type="button" data-step="${s}" aria-label="${slot.preset.shortName}, step ${s + 1}" aria-pressed="${hasHit}"
                     onclick="handleStepCellClick(${slot.index}, ${s}, event)"
                     oncontextmenu="event.preventDefault(); handleStepCellClick(${slot.index}, ${s}, { button: 2 });"
                     class="timeline-cell${s % stepsPerBeat === 0 ? ' is-beat-start' : ''} relative rounded bg-[#0c1222] border border-white/5 flex items-end p-0.5 overflow-hidden"
                     title="Step ${s + 1} • Click to toggle or customize">
                    <div class="w-full rounded-sm pointer-events-none" style="height:${barHeightPct}%; background:${barColor}"></div>
                </button>
            `;
        }

        row.innerHTML = `
            <div class="track-controls flex items-center gap-1.5">
                <div class="flex items-center gap-1.5 min-w-[105px]">
                    <span class="w-4 h-4 rounded text-[9px] font-mono font-bold flex items-center justify-center text-slate-950 shrink-0" style="background:${meta.color}">${slot.index + 1}</span>
                    <button class="track-name-button font-display" onclick="openTrackControls(${slot.index})" aria-haspopup="dialog" title="${slot.preset.shortName} track controls">${slot.preset.shortName}</button>
                </div>

                <!-- Volume Slider -->
                <div class="track-slider flex items-center gap-1 bg-[#05070f] border border-white/10 rounded px-1.5 py-0.5">
                    <span class="text-[8px] font-mono text-slate-400">VOL</span>
                    <input id="row-vol-slider-${slot.index}" aria-label="${slot.preset.shortName} volume" type="range" min="0" max="100" value="${volPct}" oninput="setSlotVolume(${slot.index}, this.value)" class="hw-slider w-12 sm:w-14">
                    <span id="row-vol-label-${slot.index}" class="font-mono text-[8px] text-amber-200 w-6 text-right">${volPct}%</span>
                </div>

                <!-- Stereo Pan Slider -->
                <div class="track-slider hidden sm:flex items-center gap-1 bg-[#05070f] border border-white/10 rounded px-1.5 py-0.5" title="Stereo Panning (Left / Center / Right)">
                    <span class="text-[8px] font-mono text-slate-400">PAN</span>
                    <input type="range" min="-1" max="1" step="0.05" value="${panVal}" aria-label="${slot.preset.shortName} pan" oninput="setSlotPan(${slot.index}, this.value)" class="hw-slider w-10">
                    <span id="row-pan-label-${slot.index}" class="font-mono text-[8px] text-cyan-200 w-5 text-right">${panText}</span>
                </div>

                <!-- Track Action Buttons -->
                <div class="flex items-center gap-0.5">
                    <button onclick="openPerformerEffects(${slot.index})" class="track-fx-button" aria-label="Effects for ${slot.preset.shortName}" title="Performer effects">FX${slot.effects?.length ? ` · ${slot.effects.length}` : ''}</button>
                    <button onclick="cycleSlotOctave(${slot.index})" class="px-1 h-4 rounded text-[8px] font-mono font-semibold bg-white/10 hover:bg-white/20 text-amber-200" title="Transpose Octave (-12 / 0 / +12 semitones)">${octText}</button>
                    <button onclick="randomizeSlotPattern(${slot.index})" class="px-1 h-4 rounded text-[8px] font-mono font-semibold bg-white/10 hover:bg-purple-500/30 text-purple-200" title="Randomize Pattern">RND</button>
                    <button onclick="resetSlotPattern(${slot.index})" class="px-1 h-4 rounded text-[8px] font-mono font-semibold bg-white/10 hover:bg-cyan-500/30 text-cyan-200" title="Reset Pattern">RST</button>
                    <button onclick="toggleSlotMute(${slot.index})" aria-label="Mute ${slot.preset.shortName}" aria-pressed="${slot.muted}" class="w-4 h-4 rounded text-[9px] font-mono font-bold ${slot.muted ? 'bg-amber-400 text-slate-950' : 'bg-white/10 hover:bg-white/20 text-slate-300'}" title="Mute">M</button>
                    <button onclick="toggleSlotSolo(${slot.index})" aria-label="Solo ${slot.preset.shortName}" aria-pressed="${slot.solo}" class="w-4 h-4 rounded text-[9px] font-mono font-bold ${slot.solo ? 'bg-cyan-400 text-slate-950' : 'bg-white/10 hover:bg-white/20 text-slate-300'}" title="Solo">S</button>
                    <button onclick="clearSlot(${slot.index})" aria-label="Remove ${slot.preset.shortName}" class="w-4 h-4 rounded text-[9px] font-mono font-bold bg-white/10 hover:bg-rose-500/35 text-slate-300 hover:text-rose-200" title="Remove">×</button>
                </div>
            </div>

            <div class="track-steps grid gap-1">
                ${stepsHTML}
            </div>
        `;

        const cells = row.querySelectorAll('.timeline-cell');
        for (let s = 0; s < cells.length; s++) {
            cachedStepColumns[s].push(cells[s]);
        }

        frag.appendChild(row);
    });

    wrapper.appendChild(frag);
    alignBeatRuler();
}

let beatRulerObserver;
function alignBeatRuler() {
    const wrapper = document.getElementById('timeline-tracks-wrapper');
    const steps = wrapper?.querySelector('.track-steps');
    const numbers = document.querySelector('#timeline-panel .beat-step-ruler');
    const header = document.querySelector('#timeline-panel > div:nth-child(2)');
    const title = header?.firstElementChild;
    if (!steps || !numbers || !header || !title) return;
    const apply = () => {
        const headerBox = header.getBoundingClientRect();
        const stepsBox = steps.getBoundingClientRect();
        const left = stepsBox.left - headerBox.left;
        numbers.style.left = `${left}px`;
        numbers.style.width = `${stepsBox.width}px`;
        numbers.style.visibility = left < title.getBoundingClientRect().right - headerBox.left + 8 ? 'hidden' : '';
    };
    apply();
    beatRulerObserver?.disconnect();
    beatRulerObserver = new ResizeObserver(apply);
    beatRulerObserver.observe(steps);
    beatRulerObserver.observe(header);
}

function highlightSequencerStep(stepIdx) {
    if (songState.heardMeasure && songState.heardMeasure.slots !== appState.slots) stepIdx = -1;
    if (lastHighlightedStep >= 0 && cachedStepColumns[lastHighlightedStep] && lastHighlightedStep !== stepIdx) {
        const prevCells = cachedStepColumns[lastHighlightedStep];
        for (let i = 0; i < prevCells.length; i++) {
            prevCells[i].classList.remove('ring-1', 'ring-amber-300/90', 'bg-white/15');
        }
    }

    if (stepIdx >= 0 && stepIdx < getStepsPerBar()) {
        const nextCells = cachedStepColumns[stepIdx];
        for (let i = 0; i < nextCells.length; i++) {
            nextCells[i].classList.add('ring-1', 'ring-amber-300/90', 'bg-white/15');
        }
        lastHighlightedStep = stepIdx;
    }
}
