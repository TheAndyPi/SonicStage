/***********************************************************************
 * 9. TOKEN PALETTE, DRAG-AND-DROP & 16-STEP BEAT SEQUENCER UI
 ***********************************************************************/
function refreshAllUI() {
    syncStageToMeasure();
    renderTokenPalette();
    renderTimelineTracks();
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

function renderTokenPalette() {
    const palette = document.getElementById('token-palette');
    if (!palette) return;
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
        const assignedSlots = appState.slots.filter(s => s.preset && s.preset.id === preset.id);
        const isActive = assignedSlots.length > 0;
        const badgeText = isActive
            ? assignedSlots.length > 1
                ? `×${assignedSlots.length}`
                : `#${assignedSlots[0].index + 1}`
            : '+';

        const card = document.createElement('button');
        card.type = 'button';
        card.setAttribute('aria-label', `${isActive ? 'Remove' : 'Add'} ${preset.shortName}`);
        card.setAttribute('aria-pressed', isActive);
        card.className = `studio-token px-2.5 py-1.5 rounded-lg cursor-pointer flex items-center justify-between gap-1.5 select-none ${isActive ? meta.activeClass : ''}`;
        card.style.setProperty('--sound-color', meta.color);
        card.dataset.category = preset.category;
        card.innerHTML = `<span class="sound-icon" aria-hidden="true">${instrumentGlyph(preset.category)}</span><span class="sound-info"><strong>${preset.shortName}</strong><small>${meta.name}</small></span><span class="sound-add" aria-hidden="true">${isActive ? '✓' : '+'}</span>`;

        let pressTimer = null;
        let startedDrag = false;

        card.addEventListener('pointerdown', e => {
            startedDrag = false;
            if (e.pointerType !== 'mouse') return;
            pressTimer = setTimeout(() => {
                startedDrag = true;
                startTokenDrag(preset, e.clientX, e.clientY);
            }, 170);
        });

        card.addEventListener('click', () => {
            clearTimeout(pressTimer);
            if (!startedDrag && !appState.draggedPresetId) {
                assignPresetToSlot(preset.id);
            }
        });

        card.addEventListener('pointercancel', () => clearTimeout(pressTimer));
        card.addEventListener('pointerleave', () => {
            clearTimeout(pressTimer);
        });

        palette.appendChild(card);
    });
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

    const onUp = () => {
        if (appState.draggedPresetId) {
            if (appState.hoveredSlotIndex >= 0 && appState.hoveredSlotIndex < stageState.unlockedSlots) {
                editStageMeasure();
                assignPresetToSlot(appState.draggedPresetId, appState.hoveredSlotIndex);
            } else {
                assignPresetToSlot(appState.draggedPresetId);
            }
            endTokenDrag();
        }
        window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointerup', onUp);
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

function renderTimelineTracks() {
    songChanged();
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
    ruler.innerHTML = `<div class="beat-step-ruler">${[1, 5, 9, 13].map(n => `<span class="is-downbeat">${n}</span><span>${n + 1}</span><span>${n + 2}</span><span>${n + 3}</span>`).join('')}</div>`;
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
        for (let s = 0; s < 16; s++) {
            const stepEvt = stepsArr[s];
            const h = heightsArr[s] || 0;
            const hasHit = stepEvt !== null && stepEvt !== undefined && h > 0;
            const barHeightPct = hasHit ? Math.max(26, Math.round(h * 100)) : 16;
            const barColor = hasHit ? meta.color : 'rgba(255,255,255,0.07)';

            stepsHTML += `
                <button type="button" data-step="${s}" aria-label="${slot.preset.shortName}, step ${s + 1}" aria-pressed="${hasHit}"
                     onclick="handleStepCellClick(${slot.index}, ${s}, event)"
                     oncontextmenu="event.preventDefault(); handleStepCellClick(${slot.index}, ${s}, { button: 2 });"
                     class="timeline-cell relative rounded bg-[#0c1222] border border-white/5 flex items-end p-0.5 overflow-hidden"
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
                    <button onclick="cycleSlotOctave(${slot.index})" class="px-1 h-4 rounded text-[8px] font-mono font-semibold bg-white/10 hover:bg-white/20 text-amber-200" title="Transpose Octave (-12 / 0 / +12 semitones)">${octText}</button>
                    <button onclick="randomizeSlotPattern(${slot.index})" class="px-1 h-4 rounded text-[8px] font-mono font-semibold bg-white/10 hover:bg-purple-500/30 text-purple-200" title="Randomize 16-Step Pattern">RND</button>
                    <button onclick="resetSlotPattern(${slot.index})" class="px-1 h-4 rounded text-[8px] font-mono font-semibold bg-white/10 hover:bg-cyan-500/30 text-cyan-200" title="Reset Pattern">RST</button>
                    <button onclick="toggleSlotMute(${slot.index})" aria-label="Mute ${slot.preset.shortName}" aria-pressed="${slot.muted}" class="w-4 h-4 rounded text-[9px] font-mono font-bold ${slot.muted ? 'bg-amber-400 text-slate-950' : 'bg-white/10 hover:bg-white/20 text-slate-300'}" title="Mute">M</button>
                    <button onclick="toggleSlotSolo(${slot.index})" aria-label="Solo ${slot.preset.shortName}" aria-pressed="${slot.solo}" class="w-4 h-4 rounded text-[9px] font-mono font-bold ${slot.solo ? 'bg-cyan-400 text-slate-950' : 'bg-white/10 hover:bg-white/20 text-slate-300'}" title="Solo">S</button>
                    <button onclick="clearSlot(${slot.index})" aria-label="Remove ${slot.preset.shortName}" class="w-4 h-4 rounded text-[9px] font-mono font-bold bg-white/10 hover:bg-rose-500/35 text-slate-300 hover:text-rose-200" title="Remove">×</button>
                </div>
            </div>

            <div class="track-steps grid grid-cols-16 gap-1">
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
    if (lastHighlightedStep >= 0 && lastHighlightedStep < 16 && lastHighlightedStep !== stepIdx) {
        const prevCells = cachedStepColumns[lastHighlightedStep];
        for (let i = 0; i < prevCells.length; i++) {
            prevCells[i].classList.remove('ring-1', 'ring-amber-300/90', 'bg-white/15');
        }
    }

    if (stepIdx >= 0 && stepIdx < 16) {
        const nextCells = cachedStepColumns[stepIdx];
        for (let i = 0; i < nextCells.length; i++) {
            nextCells[i].classList.add('ring-1', 'ring-amber-300/90', 'bg-white/15');
        }
        lastHighlightedStep = stepIdx;
    }
}
