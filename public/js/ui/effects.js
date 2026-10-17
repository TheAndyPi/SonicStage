/* The library is shared by both studio views; inserts target a player, bar, or master output. */
let effectsPreviousLibraryHeight = null;

function setStudioLibraryTab(tab) {
    const previousTab = appState.libraryTab;
    appState.libraryTab = tab === 'effects' ? 'effects' : 'sounds';
    const effects = appState.libraryTab === 'effects';
    if (studioExperience === 'immersive' && previousTab !== appState.libraryTab) {
        if (effects) {
            effectsPreviousLibraryHeight = parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue('--immersive-sound-height'),
            );
            setStudioLibrarySize(Math.max(effectsPreviousLibraryHeight || 186, 290));
        } else if (effectsPreviousLibraryHeight !== null) {
            setStudioLibrarySize(effectsPreviousLibraryHeight);
            effectsPreviousLibraryHeight = null;
        }
    }
    const tray = studioById('selector-tray-panel');
    tray.classList.toggle('effects-library', effects);
    tray.querySelector('.library-filters').hidden = effects;
    tray.querySelector('.library-caption').hidden = effects;
    tray.querySelector('.library-footer').textContent = effects
        ? 'CLICK TO APPLY · DRAG TO A PLAYER'
        : 'CLICK TO ADD · DRAG TO PLACE';
    const search = studioById('sound-search');
    search.value = '';
    search.placeholder = effects ? 'Search effects' : 'Search sounds';
    search.setAttribute('aria-label', search.placeholder);
    tray.querySelectorAll('[data-library-tab]').forEach(button => {
        button.setAttribute('aria-pressed', button.dataset.libraryTab === appState.libraryTab);
    });
    renderTokenPalette();
    syncStudioPanels();
}

function openPerformerEffects(index) {
    if (!appState.slots[index]?.preset) return;
    appState.effectsScope = 'player';
    appState.effectsSlotIndex = index;
    if (studioById('track-dialog').open) studioById('track-dialog').close();
    setStudioPanel('effects', true);
    studioById('fx-performer')?.focus({ preventScroll: true });
}

function openMasterEffects() {
    appState.effectsScope = 'master';
    if (appState.proFxOpen) studioById('btn-close-fx').click();
    setStudioPanel('effects', true);
    studioById('fx-performer')?.focus({ preventScroll: true });
}

function commitMasterEffects(effects, rebuild = true) {
    appState.masterEffects = normalizePerformerEffects(effects);
    audioEngine.setMasterEffects(appState.masterEffects);
    songChanged();
    if (rebuild && appState.libraryTab === 'effects') renderEffectsLibrary();
    return true;
}

function applyMasterEffect(effectId) {
    const definition = PERFORMER_EFFECT_BY_ID.get(effectId);
    if (!definition) return false;
    const effects = normalizePerformerEffects(appState.masterEffects);
    if (effects.some(effect => effect.id === effectId)) {
        showStageToast(`${definition.name} is already in the master rack.`, definition.color);
        return false;
    }
    if (effects.length >= MAX_PERFORMER_EFFECTS) {
        showStageToast('Four effects on the master · remove one to make room.', definition.color);
        return false;
    }
    checkpointSong();
    audioEngine.init();
    appState.effectsScope = 'master';
    effects.push({ id: effectId, amount: 0.5, enabled: true });
    commitMasterEffects(effects);
    showStageToast(`${definition.name} → Master track`, definition.color);
    return true;
}

function applyLibraryEffect(effectId) {
    return appState.effectsScope === 'master' ? applyMasterEffect(effectId) : applyPerformerEffect(effectId);
}

function commitPerformerEffects(index, effects, rebuild = true) {
    const slot = appState.slots[index];
    if (!slot?.preset) return false;
    const hadVisual = slot.effects?.some(effect => effect.enabled && effect.amount > 0);
    slot.effects = normalizePerformerEffects(effects);
    if (!rebuild && hadVisual !== slot.effects.some(effect => effect.enabled && effect.amount > 0))
        updatePedestalHUDBadges();
    if (!appState.isPlaying || songState.playMeasure?.slots === appState.slots)
        audioEngine.setSlotEffects(index, slot.effects);
    songChanged();
    if (rebuild) {
        renderTimelineTracks();
        updatePedestalHUDBadges();
        if (appState.libraryTab === 'effects') renderEffectsLibrary();
    }
    return true;
}

function applyPerformerEffect(effectId, index = appState.effectsSlotIndex) {
    if (songState.view === 'song')
        return applyArrangementEffect(effectId, songState.selected, appState.effectsScope === 'bar' ? null : index);
    const definition = PERFORMER_EFFECT_BY_ID.get(effectId);
    const slot = appState.slots[index];
    if (!definition || !slot?.preset) {
        showStageToast('Choose a performer first, or drag an effect onto one.', '#a58ac6');
        return false;
    }
    const effects = normalizePerformerEffects(slot.effects);
    if (effects.some(effect => effect.id === effectId)) {
        showStageToast(`${definition.name} is already in this player’s rack.`, definition.color);
        return false;
    }
    if (effects.length >= MAX_PERFORMER_EFFECTS) {
        showStageToast('Four effects per player · remove one to make room.', definition.color);
        return false;
    }
    checkpointSong();
    audioEngine.init();
    appState.effectsScope = 'player';
    appState.effectsSlotIndex = index;
    effects.push({ id: effectId, amount: 0.5, enabled: true });
    commitPerformerEffects(index, effects);
    slot.energy = 1;
    if (!appState.isPlaying) audioEngine.triggerPreview(slot.preset, index);
    showStageToast(`${definition.name} → ${slot.preset.shortName}`, definition.color);
    return true;
}

function renderEffectsLibrary() {
    const palette = studioById('token-palette');
    if (!palette) return;
    const focused = document.activeElement;
    const focusEffect = focused?.closest('[data-effect-id]')?.dataset.effectId;
    const focusAction = focused?.classList.contains('fx-power')
        ? 'fx-power'
        : focused?.classList.contains('fx-up')
          ? 'fx-up'
          : focused?.classList.contains('fx-remove')
            ? 'fx-remove'
            : null;
    const focusCategory = focused?.dataset.fxCategory;
    const players = appState.slots.filter(slot => slot.preset);
    if (!players.some(slot => slot.index === appState.effectsSlotIndex))
        appState.effectsSlotIndex = players[0]?.index ?? -1;
    const slot = appState.slots[appState.effectsSlotIndex];
    const arrange = songState.view === 'song';
    const masterScope = appState.effectsScope === 'master';
    const barScope = arrange && appState.effectsScope === 'bar';
    const rackSlots = effectsRackSlots();
    const effects = masterScope
        ? normalizePerformerEffects(appState.masterEffects)
        : barScope
          ? arrangementEffectEntries(rackSlots)
          : normalizePerformerEffects(slot?.effects);
    const insertCount = rackSlots.reduce((sum, player) => sum + (player.effects?.length || 0), 0);
    studioById('selector-tray-panel').querySelector('.library-footer').textContent = masterScope
        ? 'CLICK TO APPLY TO THE MASTER TRACK'
        : arrange
          ? 'DRAG TO A CLIP · DROP ON A HEADING FOR THE WHOLE BAR'
          : 'CLICK TO APPLY · DRAG TO A PLAYER';
    palette.innerHTML = `<section class="fx-rack" aria-label="${masterScope ? 'Master' : 'Performer'} effect rack">
        ${arrange && !masterScope ? `<div class="fx-bar-context"><button type="button" id="fx-bar-prev" aria-label="Effects in previous bar" ${songState.selected === 0 ? 'disabled' : ''}>‹</button><strong>BAR ${String(songState.selected + 1).padStart(2, '0')} <span>/ ${songState.measures.length}</span></strong><button type="button" id="fx-bar-next" aria-label="Effects in next bar" ${songState.selected === songState.measures.length - 1 ? 'disabled' : ''}>›</button></div>` : ''}
        <div class="fx-rack-heading"><span>${masterScope ? 'MASTER INSERTS' : barScope ? 'BAR INSERTS' : 'PLAYER INSERTS'}</span><span>${barScope ? `${insertCount} across ${players.length} players` : `${effects.length} / ${MAX_PERFORMER_EFFECTS}`}</span></div>
        <label class="fx-target-label" for="fx-performer">Apply effects to</label>
        <select id="fx-performer"></select>
        <div class="fx-chain"></div>
        ${masterScope ? `<div class="fx-arrange-actions"><button type="button" id="fx-clear-chain" ${!effects.length ? 'disabled' : ''}>Clear master effects</button></div>` : ''}
        ${arrange && !masterScope ? `<div class="fx-arrange-actions"><button type="button" id="fx-clear-chain" ${!insertCount ? 'disabled' : ''}>Clear ${barScope ? 'bar effects' : 'chain'}</button><span>Copy ${barScope ? 'player chains' : 'chain'} to</span><button type="button" id="fx-copy-next" title="Replace effects on matching player positions in the next bar; empty positions stay empty" ${songState.selected === songState.measures.length - 1 ? 'disabled' : ''}>Next bar</button><button type="button" id="fx-copy-all" title="Replace effects on matching player positions in all other bars; empty positions stay empty" ${songState.measures.length < 2 ? 'disabled' : ''}>All bars</button></div>` : ''}
        <p class="fx-rack-hint">${masterScope ? 'Processes the whole song, including reverb and delay returns. Top to bottom = signal order, before master level and limiting.' : !players.length ? 'Add a sound first. Every performer gets their own effects.' : arrange ? (barScope ? 'New effects go to every available player in this bar. Adjustments below affect players with that effect. Select a player to reorder its chain.' : 'Only this player in this bar. Drop on a bar heading to affect every player.') : 'Top to bottom = signal order. Drag a card onto any player.'}</p>
        </section><section class="fx-browser" aria-label="Effect collection"><div class="fx-filters" role="group" aria-label="Effect category"></div><div class="fx-cards"></div></section>`;
    const select = studioById('fx-performer');
    if (arrange && players.length) select.add(new Option('All performers in this bar', 'bar'));
    select.add(new Option('Master track · whole song', 'master'));
    if (!players.length && !masterScope) select.add(new Option('No performers yet', '-1'));
    players.forEach(player => select.add(new Option(`${player.index + 1} · ${player.preset.shortName}`, player.index)));
    select.value = masterScope ? 'master' : barScope && players.length ? 'bar' : appState.effectsSlotIndex;
    select.addEventListener('change', () => {
        appState.effectsScope = ['bar', 'master'].includes(select.value) ? select.value : 'player';
        if (appState.effectsScope === 'player') appState.effectsSlotIndex = Number(select.value);
        renderEffectsLibrary();
        studioById('fx-performer').focus();
    });
    if (arrange && !masterScope) {
        studioById('fx-bar-prev').addEventListener('click', () => {
            selectSongMeasure(songState.selected - 1);
            const previous = studioById('fx-bar-prev');
            (previous?.disabled ? studioById('fx-performer') : previous)?.focus({ preventScroll: true });
        });
        studioById('fx-bar-next').addEventListener('click', () => {
            selectSongMeasure(songState.selected + 1);
            const next = studioById('fx-bar-next');
            (next?.disabled ? studioById('fx-performer') : next)?.focus({ preventScroll: true });
        });
        studioById('fx-copy-next').addEventListener('click', () => copyArrangementEffects('next'));
        studioById('fx-copy-all').addEventListener('click', () => copyArrangementEffects('all'));
    }
    studioById('fx-clear-chain')?.addEventListener('click', () => {
        checkpointSong();
        mutateEffectsRack(next => next.splice(0));
        studioById('fx-performer').focus({ preventScroll: true });
    });
    const chain = palette.querySelector('.fx-chain');
    if (!effects.length)
        chain.innerHTML =
            '<p class="fx-chain-empty"><span>＋</span>Your sound, with a twist.<small>Pick an effect to start a chain.</small></p>';
    effects.forEach((effect, index) => {
        const definition = PERFORMER_EFFECT_BY_ID.get(effect.id);
        const row = document.createElement('div');
        row.dataset.effectId = effect.id;
        row.className = `fx-insert${effect.enabled ? '' : ' is-bypassed'}`;
        row.style.setProperty('--effect-color', definition.color);
        row.innerHTML = `<div class="fx-insert-title"><button type="button" class="fx-power" aria-label="${effect.enabled ? 'Bypass' : 'Enable'} ${definition.name}" aria-pressed="${effect.enabled}" title="${effect.enabled ? 'Bypass' : 'Enable'} effect">⏻</button><strong>${definition.name}${barScope ? `<small>${effect.count} / ${players.length} players</small>` : ''}</strong><button type="button" class="fx-up" aria-label="Move ${definition.name} earlier" title="Move earlier in chain" ${barScope || index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="fx-remove" aria-label="Remove ${definition.name}" title="Remove effect">×</button></div><label class="fx-amount"><span>Amount</span><input type="range" min="0" max="100" value="${Math.round(effect.amount * 100)}" aria-label="${definition.name} amount"><output>${effect.mixed ? 'Mixed' : `${Math.round(effect.amount * 100)}%`}</output></label>`;
        const mutate = change => {
            checkpointSong();
            mutateEffectsRack(change);
        };
        row.querySelector('.fx-power').addEventListener('click', () =>
            mutate(next => {
                const item = next.find(item => item.id === effect.id);
                if (item) item.enabled = !effect.enabled;
            }),
        );
        row.querySelector('.fx-remove').addEventListener('click', () =>
            mutate(next => {
                const at = next.findIndex(item => item.id === effect.id);
                if (at >= 0) next.splice(at, 1);
            }),
        );
        row.querySelector('.fx-up').addEventListener('click', () =>
            mutate(next => {
                const at = next.findIndex(item => item.id === effect.id);
                if (at > 0) [next[at - 1], next[at]] = [next[at], next[at - 1]];
            }),
        );
        row.querySelector('input').addEventListener('input', event => {
            row.querySelector('output').textContent = `${event.target.value}%`;
            mutateEffectsRack(next => {
                const item = next.find(item => item.id === effect.id);
                if (item) item.amount = Number(event.target.value) / 100;
            }, false);
        });
        chain.append(row);
    });
    const filters = palette.querySelector('.fx-filters');
    [
        { id: 'all', name: 'All' },
        ...Object.entries(EFFECT_CATEGORIES).map(([id, meta]) => ({ id, name: meta.name })),
    ].forEach(category => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = category.name;
        button.dataset.fxCategory = category.id;
        button.setAttribute('aria-pressed', appState.effectsCategory === category.id);
        button.addEventListener('click', () => {
            appState.effectsCategory = category.id;
            renderEffectsLibrary();
        });
        filters.append(button);
    });
    const query = studioById('sound-search').value.trim().toLowerCase();
    const collection = PERFORMER_EFFECTS.filter(
        effect =>
            (appState.effectsCategory === 'all' || effect.category === appState.effectsCategory) &&
            `${effect.name} ${effect.description} ${effect.category}`.toLowerCase().includes(query),
    );
    const cards = palette.querySelector('.fx-cards');
    if (!collection.length) cards.innerHTML = '<p class="empty-search">No effects found.</p>';
    collection.forEach(definition => {
        const appliedCount = rackSlots.filter(player =>
            player.effects?.some(effect => effect.id === definition.id),
        ).length;
        const applied = rackSlots.length > 0 && appliedCount === rackSlots.length;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `fx-card${applied ? ' is-applied' : ''}`;
        card.dataset.effectId = definition.id;
        card.style.setProperty('--effect-color', definition.color);
        card.setAttribute(
            'aria-label',
            `${definition.name}: ${definition.description}${applied ? ', already applied' : ''}`,
        );
        card.innerHTML = `<span class="fx-glyph" aria-hidden="true">${definition.glyph}</span><span class="fx-card-copy"><strong>${definition.name}</strong><small>${definition.description}</small></span><span class="fx-card-add" aria-hidden="true">${applied ? '✓' : appliedCount ? `${appliedCount}/${rackSlots.length}` : '+'}</span>`;
        bindEffectDrag(card, definition);
        cards.append(card);
    });
    if (focusEffect) {
        const target = focusAction
            ? palette.querySelector(`.fx-insert[data-effect-id="${focusEffect}"] .${focusAction}`)
            : palette.querySelector(`.fx-card[data-effect-id="${focusEffect}"]`);
        (target || select).focus({ preventScroll: true });
    } else if (focusCategory)
        palette.querySelector(`[data-fx-category="${focusCategory}"]`)?.focus({ preventScroll: true });
}

let highlightedEffectDrop = null;

function effectDropTarget(x, y) {
    const element = document.elementFromPoint(x, y);
    const cell = element?.closest('#song-sheet [data-measure-index]');
    if (cell) {
        const measureIndex = Number(cell.dataset.measureIndex);
        const measure = songState.measures[measureIndex];
        if (!measure) return null;
        if (cell.tagName === 'TH') return { kind: 'bar', measureIndex, element: cell };
        const slotIndex = cell.hasAttribute('data-slot-index') ? Number(cell.dataset.slotIndex) : -1;
        return { kind: measure.slots[slotIndex]?.preset ? 'clip' : 'empty', measureIndex, slotIndex, element: cell };
    }
    const badge = element?.closest('.pedestal-hud');
    const track = element?.closest('.timeline-track-row');
    if (badge) return { kind: 'stage', slotIndex: Number(badge.id.replace('pedestal-hud-', '')) };
    if (track) return { kind: 'track', slotIndex: Number(track.dataset.slotIndex) };
    if (element === renderer.domElement) {
        checkPedestalHover(x, y);
        return appState.hoveredSlotIndex >= 0 ? { kind: 'stage', slotIndex: appState.hoveredSlotIndex } : null;
    }
    return null;
}

function highlightEffectDrop(target, definition) {
    const element = target?.element || null;
    if (highlightedEffectDrop === element) return;
    document
        .querySelectorAll('#song-sheet .is-effect-drop-target, #song-sheet .is-effect-drop-blocked')
        .forEach(cell => {
            cell.classList.remove('is-effect-drop-target', 'is-effect-drop-blocked');
            cell.style.removeProperty('--effect-drop-color');
        });
    highlightedEffectDrop = element || null;
    if (!element) return;
    const slots =
        target.kind === 'bar'
            ? songState.measures[target.measureIndex].slots
            : [songState.measures[target.measureIndex].slots[target.slotIndex]];
    const allowed = arrangementEffectPlan(slots, definition.id).changes.length > 0;
    const cells =
        target.kind === 'bar'
            ? document.querySelectorAll(`#song-sheet [data-measure-index="${target.measureIndex}"]`)
            : [element];
    cells.forEach(cell => {
        cell.classList.add(allowed ? 'is-effect-drop-target' : 'is-effect-drop-blocked');
        cell.style.setProperty('--effect-drop-color', definition.color);
    });
}

function updateEffectDrag(x, y, definition) {
    const ghost = studioById('drag-ghost');
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
    const target = effectDropTarget(x, y);
    const stageIndex = target?.kind === 'stage' ? target.slotIndex : -1;
    appState.hoveredSlotIndex = stageIndex;
    setDropTarget(stageIndex >= 0 && stageState.slots[stageIndex]?.preset ? stageIndex : -1);
    highlightEffectDrop(target, definition);
    studioById('drag-ghost-label').textContent =
        target?.kind === 'bar'
            ? `${definition.name} → Bar ${target.measureIndex + 1} · all players`
            : target?.kind === 'clip'
              ? `${definition.name} → Bar ${target.measureIndex + 1} · ${songState.measures[target.measureIndex].slots[target.slotIndex].preset.shortName}`
              : target?.kind === 'empty'
                ? `${definition.name} · empty clip`
                : definition.name;
    return target;
}

function startEffectDrag(definition, x, y) {
    appState.draggedEffectId = definition.id;
    const controlsWereEnabled = controls.enabled;
    controls.enabled = false;
    const ghost = studioById('drag-ghost');
    studioById('drag-ghost-dot').style.backgroundColor = definition.color;
    ghost.style.display = 'flex';
    document.body.classList.add('is-dragging-effect');
    updatePedestalHUDBadges();
    let point = { x, y },
        frame;
    const move = event => {
        point = { x: event.clientX, y: event.clientY };
        updateEffectDrag(point.x, point.y, definition);
    };
    const scroll = () => {
        if (songState.view === 'song') {
            const scroller = studioById('song-sheet-scroll');
            const rect = scroller.getBoundingClientRect();
            if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
                const labels = scroller.querySelector('.instrument-label')?.getBoundingClientRect().width || 0;
                const speed = (value, low, high) =>
                    Math.max(
                        -14,
                        Math.min(
                            14,
                            value < low + 38
                                ? (value - low - 38) * 0.3
                                : value > high - 38
                                  ? (value - high + 38) * 0.3
                                  : 0,
                        ),
                    );
                scroller.scrollLeft += speed(point.x, rect.left + labels, rect.right);
                scroller.scrollTop += speed(point.y, rect.top + 45, rect.bottom);
            }
        }
        updateEffectDrag(point.x, point.y, definition);
        frame = requestAnimationFrame(scroll);
    };
    const end = () => {
        cancelAnimationFrame(frame);
        appState.draggedEffectId = null;
        appState.hoveredSlotIndex = -1;
        controls.enabled = controlsWereEnabled;
        ghost.style.display = 'none';
        document.body.classList.remove('is-dragging-effect');
        setDropTarget(-1);
        highlightEffectDrop(null, definition);
        updatePedestalHUDBadges();
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('blur', end);
        window.removeEventListener('keydown', key);
    };
    const up = event => {
        const target = effectDropTarget(event.clientX, event.clientY);
        let applied = false;
        try {
            if (target?.kind === 'bar' || target?.kind === 'clip') {
                applied = applyArrangementEffect(
                    definition.id,
                    target.measureIndex,
                    target.kind === 'bar' ? null : target.slotIndex,
                );
            } else if (target?.kind === 'track' && appState.slots[target.slotIndex]?.preset) {
                applied = applyPerformerEffect(definition.id, target.slotIndex);
            } else if (target?.kind === 'stage' && stageState.slots[target.slotIndex]?.preset) {
                editStageMeasure();
                applied = applyPerformerEffect(definition.id, target.slotIndex);
            } else
                showStageToast(
                    target?.kind === 'empty'
                        ? 'This clip is empty · drop on a performer or a bar heading.'
                        : 'Drop onto a performer, arrangement clip, or bar heading.',
                    definition.color,
                );
        } finally {
            end();
        }
        if (applied && songState.view === 'song') studioById('fx-performer')?.focus({ preventScroll: true });
    };
    const key = event => {
        if (event.key === 'Escape') end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    window.addEventListener('keydown', key);
    scroll();
}

function bindEffectDrag(card, definition) {
    let press = null;
    let timer;
    let dragged = false;
    const cancel = () => {
        clearTimeout(timer);
        press = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', cancel);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('blur', cancel);
    };
    const begin = (x, y) => {
        cancel();
        dragged = true;
        startEffectDrag(definition, x, y);
    };
    // Follow the press outside the card too, so a quick drag cannot outrun its bounds.
    const move = event => {
        if (!press || event.pointerId !== press.id) return;
        const dx = event.clientX - press.x,
            dy = event.clientY - press.y;
        if ((!press.touch && Math.hypot(dx, dy) > 5) || (press.touch && dy < -12 && Math.abs(dy) > Math.abs(dx) * 1.3))
            begin(event.clientX, event.clientY);
        else if (press.touch && Math.hypot(dx, dy) > 10) cancel();
    };
    card.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        dragged = false;
        press = { id: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType !== 'mouse' };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', cancel);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', cancel);
        timer = setTimeout(() => press && begin(press.x, press.y), press.touch ? 320 : 170);
    });
    card.addEventListener(
        'touchmove',
        event => {
            if (dragged && appState.draggedEffectId) event.preventDefault();
        },
        { passive: false },
    );
    card.addEventListener('contextmenu', event => {
        if (press || dragged) event.preventDefault();
    });
    card.addEventListener('click', event => {
        cancel();
        if (!dragged || event.detail === 0) applyLibraryEffect(definition.id);
    });
}

function initPerformerEffectsUI() {
    const heading = document.querySelector('.library-heading h2');
    heading.className = 'library-tabs';
    heading.setAttribute('role', 'group');
    heading.setAttribute('aria-label', 'Library');
    heading.innerHTML = `<button type="button" data-library-tab="sounds" aria-pressed="true">Sounds</button><button type="button" data-library-tab="effects" aria-pressed="false">Effects <span>${PERFORMER_EFFECTS.length}</span></button>`;
    heading
        .querySelectorAll('button')
        .forEach(button => button.addEventListener('click', () => setStudioLibraryTab(button.dataset.libraryTab)));
    studioById('btn-master-effects').addEventListener('click', openMasterEffects);
    studioById('track-effects').addEventListener('click', () =>
        openPerformerEffects(Number(studioById('track-dialog').dataset.slotIndex)),
    );
}
