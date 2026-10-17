/***********************************************************************
 * 7. FLOATING 3D PEDESTAL LABELS (GPU TRANSLATE3D & CROWD CULLING)
 ***********************************************************************/
function initPedestalHUDLayer() {
    const container = document.getElementById('pedestal-hud-layer');
    container.innerHTML = '';
    hudBadgeElements.length = 0;
}

function createPedestalHUDBadge(i) {
    const container = document.getElementById('pedestal-hud-layer');
    if (!container || hudBadgeElements[i]) return;
    const badge = document.createElement('div');
    badge.id = `pedestal-hud-${i}`;
    badge.className = 'pedestal-hud absolute z-10';
    badge.addEventListener('pointerdown', e => {
        if (e.button === 0 && !appState.draggedEffectId && e.target.closest('.stage-track-label'))
            beginPlayerDrag(i, e.clientX, e.clientY);
    });
    badge.addEventListener('pointerup', () => {
        if (playerDrag?.active && i < stageState.unlockedSlots) appState.hoveredSlotIndex = i;
        if (appState.draggedPresetId && i < stageState.unlockedSlots) {
            editStageMeasure();
            assignPresetToSlot(appState.draggedPresetId, i);
            endTokenDrag();
        }
    });
    container.appendChild(badge);
    hudBadgeElements[i] = badge;
}

function updatePedestalHUDBadges() {
    for (let i = 0; i < pedestalMeshes.length; i++) {
        const slot = stageState.slots[i];
        const badge = hudBadgeElements[i];
        if (!badge) continue;
        const dragging = appState.draggedPresetId || appState.draggedEffectId || playerDrag?.active;
        const visible =
            i < stageState.unlockedSlots &&
            (slot?.preset || dragging) &&
            (i < 12 || i === appState.hoveredSlotIndex || dragging);
        badge.style.display = visible ? 'block' : 'none';
        if (!visible) continue;
        if (!slot.preset) {
            badge.innerHTML = `<div class="stage-slot-target">+ ${i + 1}</div>`;
        } else {
            const meta = CATEGORY_META[slot.preset.category];
            const muted = !isSlotAudible(slot, stageState.slots);
            const name = slot.preset.shortName;
            badge.innerHTML = `<div class="stage-track-chip"><button class="stage-track-label ${muted ? 'is-muted' : ''}" onclick="onStageLabelClick(${i})" aria-label="Edit ${name}" title="Edit ${name} · drag to move"><i style="background:${meta.color}"></i><span>${name}</span>${slot.effects?.some(effect => effect.enabled && effect.amount > 0) ? '<span class="stage-fx-mark" title="Effects active">FX</span>' : ''}<svg class="stage-edit-icon inline-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="stage-remove-btn" onclick="removeStagePlayer(${i})" aria-label="Remove ${name}" title="Remove ${name}">×</button></div>`;
        }
    }
}

function updateHUDProjections() {
    const bounds = document.getElementById('pedestal-hud-layer').getBoundingClientRect();
    const canvas = renderer.domElement.getBoundingClientRect();
    const w = bounds.width;
    const h = bounds.height;
    const isMobile = window.innerWidth <= 640;
    const scaleSuffix = isMobile ? ' scale(0.76)' : '';

    for (let i = 0; i < stageState.unlockedSlots; i++) {
        const badge = hudBadgeElements[i];
        if (!badge || badge.style.display === 'none') continue;
        const ped = pedestalMeshes[i];
        if (!ped || !ped.rootGroup.visible) continue;

        _tempVec3.copy(ped.rootGroup.position);
        _tempVec3.y -= 0.34;
        _tempVec3.project(camera);

        const x = (_tempVec3.x * 0.5 + 0.5) * canvas.width + canvas.left - bounds.left;
        const y = (-(_tempVec3.y * 0.5) + 0.5) * canvas.height + canvas.top - bounds.top;

        badge.style.visibility = _tempVec3.z > 1 || x < 0 || x > w || y < 35 || y > h - 10 ? 'hidden' : '';
        badge.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)${scaleSuffix}`;
    }
}
