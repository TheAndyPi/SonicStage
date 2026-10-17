/***********************************************************************
 * 8. SLOT ASSIGNMENT, REMOVAL, CUSTOM SEQUENCER & PRO CHANNEL CONTROLS
 ***********************************************************************/
function assignPresetToSlot(presetId, targetSlotIdx = -1) {
    audioEngine.init();
    const preset = INSTRUMENT_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    let slotIdx = targetSlotIdx;
    if (slotIdx === -1) {
        slotIdx = appState.slots.findIndex(s => s.preset === null);
    }
    if (slotIdx === -1) {
        showStageToast(`Stage is full · remove a player to add ${preset.shortName}`, '#f43f5e');
        return;
    }

    const slot = appState.slots[slotIdx];
    slot.preset = preset;
    initSlotSequenceFromPreset(slot, preset);
    slot.muted = false;
    slot.energy = 1.0;
    audioEngine.setSlotGain(slotIdx, slot.volume);
    audioEngine.setSlotPan(slotIdx, slot.pan);

    audioEngine.triggerPreview(preset, slotIdx);
    rebuildPedestalPerformer(slotIdx);

    reconcileStageCapacity(false);
    refreshAllUI();
}

// Removes the most recently placed player of this sound.
function removePresetPlayer(presetId) {
    const slotIdx = appState.slots.findLastIndex(s => s.preset && s.preset.id === presetId);
    if (slotIdx !== -1) clearSlot(slotIdx);
}

/**
 * Returns a list of 3 distinct musical variations (Low/Kick, Mid/Snare, High/Hat) for a preset
 * so users can either toggle steps On/Off or cycle through note/drum variations on any step.
 */
function getPresetStepVariations(preset) {
    const nonNull = preset.steps.filter(s => s !== null && s !== undefined);
    const primary = nonNull.length > 0 ? cloneStepValue(nonNull[0]) : 60;

    if (preset.category === 'drums') {
        // Collect unique drum tokens in this kit, fallback to standard kit hits
        const uniqueTokens = [];
        nonNull.forEach(t => {
            if (!uniqueTokens.includes(t)) uniqueTokens.push(t);
        });
        while (uniqueTokens.length < 3) {
            const fallback = ['K', 'S', 'H', 'R', 'O', 'C'].find(x => !uniqueTokens.includes(x)) || uniqueTokens[0];
            uniqueTokens.push(fallback);
        }
        return [
            { val: uniqueTokens[0], height: 1.0, label: String(uniqueTokens[0]) },
            { val: uniqueTokens[1], height: 0.78, label: String(uniqueTokens[1]) },
            { val: uniqueTokens[2], height: 0.45, label: String(uniqueTokens[2]) },
        ];
    }

    if (typeof primary === 'number') {
        return [
            { val: primary, height: 0.85, label: 'ROOT' },
            { val: primary + 7, height: 0.92, label: '+5TH' },
            { val: primary + 12, height: 1.0, label: '+OCT' },
        ];
    }

    if (Array.isArray(primary)) {
        return [
            { val: [...primary], height: 0.85, label: 'CHORD 1' },
            { val: primary.map(n => n + 2), height: 0.92, label: 'CHORD 2' },
            { val: primary.map(n => n + 5), height: 1.0, label: 'CHORD 3' },
        ];
    }

    if (typeof primary === 'object') {
        if (primary.b) {
            // Beatboxer syllables
            return [
                { val: { b: 'B', v: 'U' }, height: 1.0, label: 'B' },
                { val: { b: 'PF', v: 'O' }, height: 0.85, label: 'PF' },
                { val: { b: 'TS', v: 'I' }, height: 0.5, label: 'TS' },
            ];
        }
        const baseNote = primary.n || 60;
        return [
            { val: { ...primary, v: 'A', v2: 'O' }, height: 0.85, label: 'AH' },
            { val: { ...primary, n: baseNote + 3, v: 'E', v2: 'I' }, height: 0.92, label: 'EH' },
            { val: { ...primary, n: baseNote + 7, v: 'O', v2: 'U' }, height: 1.0, label: 'OH' },
        ];
    }

    return [{ val: primary, height: 0.88, label: 'HIT' }];
}

window.handleStepCellClick = function (slotIndex, stepIndex, event) {
    audioEngine.init();
    const slot = appState.slots[slotIndex];
    if (!slot || !slot.preset) return;

    const stepsArr = getSlotSteps(slot);
    const heightsArr = getSlotHeights(slot);
    const variations = getPresetStepVariations(slot.preset);
    const currentVal = stepsArr[stepIndex];
    const isCycleAction =
        appState.stepEditMode === 'cycle' || (event && (event.shiftKey || event.altKey || event.button === 2));

    if (!isCycleAction) {
        // Toggle Step ON / OFF
        if (currentVal !== null && currentVal !== undefined) {
            stepsArr[stepIndex] = null;
            heightsArr[stepIndex] = 0;
        } else {
            // Restore original preset step if it had one, otherwise use variation based on beat position
            const origStep = slot.preset.steps[stepIndex];
            if (origStep !== null && origStep !== undefined) {
                stepsArr[stepIndex] = cloneStepValue(origStep);
                heightsArr[stepIndex] = slot.preset.visualHeights[stepIndex] || 0.85;
            } else {
                const pickVar =
                    stepIndex % 4 === 0 ? variations[0] : stepIndex % 2 === 0 ? variations[1] : variations[2];
                stepsArr[stepIndex] = cloneStepValue(pickVar.val);
                heightsArr[stepIndex] = pickVar.height;
            }
            audioEngine.triggerPreview(slot.preset, slotIndex, stepsArr[stepIndex]);
        }
    } else {
        // Cycle through Low/Kick -> Mid/Snare -> High/Hat -> Off
        if (currentVal === null || currentVal === undefined) {
            stepsArr[stepIndex] = cloneStepValue(variations[0].val);
            heightsArr[stepIndex] = variations[0].height;
            audioEngine.triggerPreview(slot.preset, slotIndex, stepsArr[stepIndex]);
        } else {
            const curHeight = heightsArr[stepIndex] || 0.85;
            if (curHeight >= 0.96 && variations.length > 1) {
                stepsArr[stepIndex] = cloneStepValue(variations[1].val);
                heightsArr[stepIndex] = 0.76;
                audioEngine.triggerPreview(slot.preset, slotIndex, stepsArr[stepIndex]);
            } else if (curHeight >= 0.65 && variations.length > 2) {
                stepsArr[stepIndex] = cloneStepValue(variations[2].val);
                heightsArr[stepIndex] = 0.46;
                audioEngine.triggerPreview(slot.preset, slotIndex, stepsArr[stepIndex]);
            } else {
                stepsArr[stepIndex] = null;
                heightsArr[stepIndex] = 0;
            }
        }
    }

    renderTimelineTracks();
    highlightSequencerStep(appState.currentStep);
};

window.randomizeSlotPattern = function (slotIndex) {
    audioEngine.init();
    const slot = appState.slots[slotIndex];
    if (!slot || !slot.preset) return;
    const stepsArr = getSlotSteps(slot);
    const heightsArr = getSlotHeights(slot);
    const variations = getPresetStepVariations(slot.preset);
    const density = slot.preset.category === 'drums' ? 0.68 : slot.preset.category === 'chords' ? 0.38 : 0.52;

    for (let s = 0; s < 16; s++) {
        const isDownbeat = s % getMeter().stepsPerBeat === 0;
        if ((isDownbeat && Math.random() < 0.82) || Math.random() < density) {
            const vIdx = isDownbeat ? 0 : Math.floor(Math.random() * variations.length);
            stepsArr[s] = cloneStepValue(variations[vIdx].val);
            heightsArr[s] = variations[vIdx].height;
        } else {
            stepsArr[s] = null;
            heightsArr[s] = 0;
        }
    }
    showStageToast(`${slot.preset.shortName} pattern shuffled`, CATEGORY_META[slot.preset.category].color);
    renderTimelineTracks();
    highlightSequencerStep(appState.currentStep);
};

window.resetSlotPattern = function (slotIndex) {
    const slot = appState.slots[slotIndex];
    if (!slot || !slot.preset) return;
    initSlotSequenceFromPreset(slot, slot.preset);
    showStageToast(`${slot.preset.shortName} pattern reset`, '#06b6d4');
    renderTimelineTracks();
    highlightSequencerStep(appState.currentStep);
};

window.setSlotPan = function (slotIndex, rawPan) {
    audioEngine.init();
    const slot = appState.slots[slotIndex];
    if (!slot) return;
    const panVal = Math.max(-1, Math.min(1, Number(rawPan) || 0));
    slot.pan = panVal;
    audioEngine.setSlotPan(slotIndex, panVal);
    const panLabel = document.getElementById(`row-pan-label-${slotIndex}`);
    if (panLabel) {
        panLabel.textContent =
            panVal === 0 ? 'C' : panVal < 0 ? `L${Math.round(Math.abs(panVal) * 50)}` : `R${Math.round(panVal * 50)}`;
    }
    songChanged();
};

window.cycleSlotOctave = function (slotIndex) {
    audioEngine.init();
    const slot = appState.slots[slotIndex];
    if (!slot || !slot.preset) return;
    const order = [0, 12, -12];
    const nextIdx = (order.indexOf(slot.pitchShift || 0) + 1) % order.length;
    slot.pitchShift = order[nextIdx];
    renderTimelineTracks();
    highlightSequencerStep(appState.currentStep);
};

window.setSlotVolume = function (slotIndex, rawPercent) {
    audioEngine.init();
    const slot = appState.slots[slotIndex];
    if (!slot) return;
    const pct = Math.max(0, Math.min(100, parseInt(rawPercent, 10) || 0));
    slot.volume = pct / 100;
    if (slot.volume > 0 && slot.muted) {
        slot.muted = false;
    }
    audioEngine.setSlotGain(slotIndex, slot.volume);

    // Sync both 3D HUD slider & Timeline slider without full DOM rebuild during drag
    const hudSlider = document.getElementById(`hud-vol-slider-${slotIndex}`);
    const hudLabel = document.getElementById(`hud-vol-label-${slotIndex}`);
    const rowSlider = document.getElementById(`row-vol-slider-${slotIndex}`);
    const rowLabel = document.getElementById(`row-vol-label-${slotIndex}`);
    if (stageState.slots === appState.slots) {
        if (hudSlider && hudSlider.value !== String(pct)) hudSlider.value = pct;
        if (hudLabel) hudLabel.textContent = `${pct}%`;
    }
    if (rowSlider && rowSlider.value !== String(pct)) rowSlider.value = pct;
    if (rowLabel) rowLabel.textContent = `${pct}%`;

    // Scale step bar visual opacity/height subtly with volume
    const ped = pedestalMeshes[slotIndex];
    if (ped && slot.preset && stageState.slots === appState.slots) {
        const audible = isSlotAudible(slot);
        const catMats = sharedCategoryMaterials[slot.preset.category];
        ped.ringMesh.material = audible ? catMats.activeRing : sharedStudioMaterials.mutedRing;
    }
    songChanged();
};

window.toggleSlotMute = function (slotIndex) {
    const slot = appState.slots[slotIndex];
    if (!slot.preset) return;
    slot.muted = !slot.muted;
    rebuildPedestalPerformer(slotIndex);
    refreshAllUI();
};

window.toggleSlotSolo = function (slotIndex) {
    const slot = appState.slots[slotIndex];
    if (!slot.preset) return;
    slot.solo = !slot.solo;
    pedestalMeshes.forEach((_, idx) => rebuildPedestalPerformer(idx));
    refreshAllUI();
};

window.clearSlot = function (slotIndex) {
    appState.slots[slotIndex].effects = [];
    appState.slots[slotIndex].preset = null;
    appState.slots[slotIndex].customSteps = null;
    appState.slots[slotIndex].customHeights = null;
    appState.slots[slotIndex].pan = 0.0;
    appState.slots[slotIndex].pitchShift = 0;
    appState.slots[slotIndex].muted = false;
    appState.slots[slotIndex].solo = false;
    appState.slots[slotIndex].energy = 0;
    rebuildPedestalPerformer(slotIndex);

    // Whenever an instrument is removed and count < 7, compact outer ring into inner ring and reduce to 6 stages
    reconcileStageCapacity(true);
    refreshAllUI();
};

// Pedestals are a song-wide layout, so a move swaps the two spots in every measure.
window.moveStagePlayer = function (fromIdx, toIdx) {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= stageState.unlockedSlots) return;
    const fields = [
        'preset',
        'customSteps',
        'customHeights',
        'volume',
        'pan',
        'effects',
        'pitchShift',
        'muted',
        'solo',
        'energy',
        'hitCount',
        'vowelState',
    ];
    songState.measures.forEach(measure => {
        const a = measure.slots[fromIdx],
            b = measure.slots[toIdx];
        if (!a || !b) return;
        fields.forEach(key => {
            const held = a[key];
            a[key] = b[key];
            b[key] = held;
        });
    });
    if (appState.effectsSlotIndex === fromIdx) appState.effectsSlotIndex = toIdx;
    else if (appState.effectsSlotIndex === toIdx) appState.effectsSlotIndex = fromIdx;
    [fromIdx, toIdx].forEach(idx => {
        audioEngine.setSlotGain(idx, appState.slots[idx].volume);
        audioEngine.setSlotPan(idx, appState.slots[idx].pan);
        rebuildPedestalPerformer(idx);
    });
    reconcileStageCapacity(false);
    refreshAllUI();
};

window.removeStagePlayer = function (slotIdx) {
    editStageMeasure();
    const preset = appState.slots[slotIdx]?.preset;
    if (!preset) return;
    clearSlot(slotIdx);
    showStageToast(`Removed ${preset.shortName}`, CATEGORY_META[preset.category].color);
};

function clearAllSlots() {
    for (let i = 0; i < MAX_SLOTS; i++) {
        appState.slots[i].effects = [];
        appState.slots[i].preset = null;
        appState.slots[i].customSteps = null;
        appState.slots[i].customHeights = null;
        appState.slots[i].pan = 0.0;
        appState.slots[i].pitchShift = 0;
        appState.slots[i].muted = false;
        appState.slots[i].solo = false;
        appState.slots[i].energy = 0;
        rebuildPedestalPerformer(i);
    }
    reconcileStageCapacity(true);
    refreshAllUI();
}

function triggerAutoMix(countTarget = 5) {
    audioEngine.init();
    const clampedTarget = Math.max(1, Math.min(MAX_SLOTS, countTarget));
    ensurePedestalsUpTo(clampedTarget);

    for (let i = 0; i < MAX_SLOTS; i++) {
        appState.slots[i].effects = [];
        appState.slots[i].preset = null;
        appState.slots[i].customSteps = null;
        appState.slots[i].customHeights = null;
        appState.slots[i].pan = 0.0;
        appState.slots[i].pitchShift = 0;
        appState.slots[i].muted = false;
        appState.slots[i].solo = false;
        appState.slots[i].energy = 0;
    }

    const chosen = [];
    if (clampedTarget >= INSTRUMENT_PRESETS.length) {
        INSTRUMENT_PRESETS.slice(0, clampedTarget).forEach(p => chosen.push(p));
    } else {
        const pickRandom = (cat, excludeIds = []) => {
            const list = INSTRUMENT_PRESETS.filter(p => p.category === cat && !excludeIds.includes(p.id));
            return list[Math.floor(Math.random() * list.length)];
        };
        const cats = ['drums', 'bass', 'chords', 'melody', 'strings', 'vocals'];
        for (let i = 0; i < clampedTarget; i++) {
            const c = cats[i % cats.length];
            const p =
                pickRandom(
                    c,
                    chosen.map(x => x.id),
                ) || INSTRUMENT_PRESETS[i % INSTRUMENT_PRESETS.length];
            if (p) chosen.push(p);
        }
    }

    chosen.forEach((preset, idx) => {
        appState.slots[idx].preset = preset;
        initSlotSequenceFromPreset(appState.slots[idx], preset);
        const tCfg = getSlotTierConfig(idx);
        const angle = ((idx - tCfg.start) / tCfg.count) * Math.PI * 2 + tCfg.angleOffset;
        appState.slots[idx].pan = Math.round(Math.sin(angle) * 65) / 100;
        audioEngine.setSlotPan(idx, appState.slots[idx].pan);
        appState.slots[idx].energy = 0.95;
    });

    reconcileStageCapacity(false);
    for (let i = 0; i < pedestalMeshes.length; i++) rebuildPedestalPerformer(i);

    if (!appState.isPlaying) {
        appState.isPlaying = true;
        updatePlayButtonUI();
    }
    refreshAllUI();
}
