/* Arrangement edits address an explicit bar and player, independently of playback. */
function arrangementEffectPlan(slots, effectId) {
    const changes = [];
    let full = 0,
        existing = 0;
    if (!PERFORMER_EFFECT_BY_ID.has(effectId)) return { changes, full, existing };
    slots
        .filter(slot => slot?.preset)
        .forEach(slot => {
            const effects = normalizePerformerEffects(slot.effects);
            if (effects.some(effect => effect.id === effectId)) existing++;
            else if (effects.length >= MAX_PERFORMER_EFFECTS) full++;
            else changes.push({ slot, effects: [...effects, { id: effectId, amount: 0.5, enabled: true }] });
        });
    return { changes, full, existing };
}

function applyArrangementEffect(effectId, measureIndex, slotIndex = null) {
    const measure = songState.measures[measureIndex];
    const definition = PERFORMER_EFFECT_BY_ID.get(effectId);
    if (!Number.isInteger(measureIndex) || !measure || !definition) return false;
    const slots = slotIndex === null ? measure.slots : [measure.slots[slotIndex]];
    const { changes, full, existing } = arrangementEffectPlan(slots, effectId);
    if (!changes.length) {
        showStageToast(
            full
                ? 'These player racks are full · remove an effect first.'
                : existing
                  ? `${definition.name} is already applied here.`
                  : 'Add a performer to this bar first.',
            definition.color,
        );
        return false;
    }
    checkpointSong();
    audioEngine.init();
    changes.forEach(({ slot, effects }) => (slot.effects = effects));
    appState.effectsScope = slotIndex === null ? 'bar' : 'player';
    appState.effectsSlotIndex = slotIndex ?? changes[0].slot.index;
    selectSongMeasure(measureIndex);
    songChanged();
    const skipped = full ? ` · ${full} full ${full === 1 ? 'rack' : 'racks'} skipped` : '';
    showStageToast(
        `${definition.name} → bar ${measureIndex + 1}${slotIndex === null ? ` · ${changes.length} players` : ` · ${changes[0].slot.preset.shortName}`}${skipped}`,
        definition.color,
    );
    return true;
}

function openArrangementEffects(measureIndex, slotIndex = null) {
    const measure = songState.measures[measureIndex];
    if (!Number.isInteger(measureIndex) || !measure || (slotIndex !== null && !measure.slots[slotIndex]?.preset))
        return;
    appState.effectsScope = slotIndex === null ? 'bar' : 'player';
    if (slotIndex !== null) appState.effectsSlotIndex = slotIndex;
    selectSongMeasure(measureIndex);
    setStudioPanel('effects', true);
    studioById('fx-performer')?.focus({ preventScroll: true });
}

function selectArrangementClip(measureIndex, slotIndex) {
    appState.effectsScope = 'player';
    appState.effectsSlotIndex = slotIndex;
    selectSongMeasure(measureIndex);
}

function effectsRackSlots() {
    if (appState.effectsScope === 'master') return [{ effects: appState.masterEffects }];
    return songState.view === 'song' && appState.effectsScope === 'bar'
        ? appState.slots.filter(slot => slot.preset)
        : [appState.slots[appState.effectsSlotIndex]].filter(slot => slot?.preset);
}

function arrangementEffectEntries(slots) {
    const entries = new Map();
    slots.forEach(slot =>
        normalizePerformerEffects(slot.effects).forEach(effect => {
            let entry = entries.get(effect.id);
            if (!entry) {
                entry = { ...effect, count: 0, totalAmount: 0, mixed: false };
                entries.set(effect.id, entry);
            }
            entry.mixed ||= entry.amount !== effect.amount;
            entry.enabled ||= effect.enabled;
            entry.totalAmount += effect.amount;
            entry.count++;
        }),
    );
    return [...entries.values()].map(entry => ({ ...entry, amount: entry.totalAmount / entry.count }));
}

function mutateEffectsRack(change, rebuild = true) {
    if (appState.effectsScope === 'master') {
        const effects = normalizePerformerEffects(appState.masterEffects);
        change(effects);
        commitMasterEffects(effects, rebuild);
        return;
    }
    const slots = effectsRackSlots();
    if (!slots.length) return;
    slots.forEach(slot => {
        const effects = normalizePerformerEffects(slot.effects);
        change(effects);
        commitPerformerEffects(slot.index, effects, false);
    });
    if (rebuild) {
        renderTimelineTracks();
        updatePedestalHUDBadges();
        renderEffectsLibrary();
    }
}

function copyArrangementEffects(destination) {
    if (appState.effectsScope === 'master') return false;
    const source = effectsRackSlots();
    const indexes =
        destination === 'next'
            ? [songState.selected + 1]
            : songState.measures.map((_, index) => index).filter(index => index !== songState.selected);
    const updates = [];
    const bars = new Set();
    indexes.forEach(index => {
        const measure = songState.measures[index];
        if (!measure) return;
        source.forEach(slot => {
            const target = measure.slots[slot.index];
            if (!target?.preset) return;
            const effects = normalizePerformerEffects(slot.effects);
            if (JSON.stringify(effects) === JSON.stringify(normalizePerformerEffects(target.effects))) return;
            updates.push({ target, effects });
            bars.add(index);
        });
    });
    if (!updates.length) {
        showStageToast('No matching players need a change in those bars.', '#a58ac6');
        return false;
    }
    checkpointSong();
    updates.forEach(({ target, effects }) => (target.effects = effects));
    songChanged();
    renderSongArrangement();
    showStageToast(
        `Copied ${updates.length} ${updates.length === 1 ? 'chain' : 'chains'} across ${bars.size} ${bars.size === 1 ? 'bar' : 'bars'}.`,
        '#a58ac6',
    );
    return true;
}

function arrangementRows(measures) {
    // Repeated instruments still represent different performers with different inserts.
    const rows = new Map();
    measures.forEach(measure =>
        measure.slots.forEach(slot => {
            if (slot.preset) rows.set(`${slot.index}:${slot.preset.id}`, { index: slot.index, preset: slot.preset });
        }),
    );
    return [...rows.values()].sort((a, b) => a.index - b.index || a.preset.id.localeCompare(b.preset.id));
}

function arrangementClipEffects(slot, measureIndex) {
    const effects = normalizePerformerEffects(slot.effects);
    const open = `openArrangementEffects(${measureIndex},${slot.index})`;
    return `<div class="song-clip-effects">${
        effects.length
            ? effects
                  .map(effect => {
                      const definition = PERFORMER_EFFECT_BY_ID.get(effect.id);
                      return `<button type="button" class="song-effect-badge${effect.enabled && effect.amount > 0 ? '' : ' is-bypassed'}" style="--effect-color:${definition.color}" onclick="${open}" aria-label="Edit ${definition.name} for player ${slot.index + 1}, bar ${measureIndex + 1}" title="${definition.name} · ${Math.round(effect.amount * 100)}%${effect.enabled ? '' : ' · bypassed'}">${definition.name}</button>`;
                  })
                  .join('')
            : `<button type="button" class="song-add-effect" onclick="${open}" aria-label="Add effects for player ${slot.index + 1}, bar ${measureIndex + 1}">＋ FX</button>`
    }</div>`;
}

function arrangementBarEffects(measure, index) {
    const count = measure.slots.reduce(
        (sum, slot) => sum + (slot.preset ? normalizePerformerEffects(slot.effects).length : 0),
        0,
    );
    return `<button type="button" class="measure-effects${count ? ' has-effects' : ''}" onclick="openArrangementEffects(${index})" aria-label="Effects for bar ${index + 1}, ${count} inserts" title="Edit all performers’ effects in this bar">FX${count ? ` · ${count}` : ' ＋'}</button>`;
}
