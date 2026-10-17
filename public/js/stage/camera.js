/***********************************************************************
 * 6. CAMERA PRESETS, ORBIT CONTROLS & RAYCAST INTERACTION
 ***********************************************************************/
function updateCameraPresetTarget(mode) {
    appState.cameraMode = mode;
    const tierCfg = getActiveTierConfig();
    const outerR = tierCfg.outerR; // Ranges from 5.95 (6 stages) up to 32.0 (100 stages)
    const scaleFactor = outerR / 6.0;

    if (mode === 'closeup') {
        cameraTargetPos.set(0, 2.6 + scaleFactor * 1.0, 4.6 + scaleFactor * 2.7);
        cameraLookAtTarget.set(0, 0.7, 0);
    } else if (mode === 'overhead') {
        cameraTargetPos.set(0, 14.0 + scaleFactor * 7.8, 5.0 + scaleFactor * 2.8);
        cameraLookAtTarget.set(0, 0.0, 0);
    } else {
        // Default 'stage' — dynamically frames all unlocked concentric rings (from 6 up to 100 stages!)
        cameraTargetPos.set(0, 4.6 + scaleFactor * 2.8, 7.0 + scaleFactor * 6.1);
        cameraLookAtTarget.copy(STAGE_ORB_CENTER);
    }
    const framing = stageFraming(camera.aspect);
    cameraTargetPos.sub(cameraLookAtTarget).multiplyScalar(framing).add(cameraLookAtTarget);
    updateStageCameraRange();
    camera.updateProjectionMatrix();
    isTransitioningCamera = true;

    document.querySelectorAll('.cam-btn').forEach(btn => {
        if (btn.dataset.cam === mode) {
            btn.className =
                'cam-btn px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[10px] bg-amber-400/20 text-amber-200 transition-colors';
        } else {
            btn.className =
                'cam-btn px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[10px] text-slate-400 hover:text-white transition-colors';
        }
    });
}

// The director follows audible events, never the audio scheduler's look-ahead.
function startCinematic() {
    if (!songState.ready || !camera) return;
    if (!cinematicState.active) {
        cinematicState.saved = {
            view: songState.view,
            audition: songState.audition,
            position: camera.position.clone(),
            target: controls.target.clone(),
            fov: camera.fov,
            far: camera.far,
            fogDensity: scene.fog?.density,
            controlsEnabled: controls.enabled,
        };
        stopSong();
        cinematicState.active = true;
        setScopeWindowOpen(false);
        setSongView('stage');
        document.body.classList.add('cinematic-mode');
        document.getElementById('cinematic-overlay').hidden = false;
        controls.enabled = false;
        isTransitioningCamera = false;
    }
    appState.isPlaying = false;
    audioEngine.init();
    songState.audition = false;
    resetSongTransport(0);
    Object.assign(cinematicState, {
        phase: 'intro',
        paused: false,
        elapsed: 0,
        shotElapsed: 0,
        shotNumber: 0,
        lastBeat: -1,
        beatsSinceShot: 0,
        subject: -1,
    });
    cinematicState.visits.clear();
    syncStageToMeasure();
    setCinematicShot('opening');
    updateCinematicUI();
    document.getElementById('cinema-exit').focus({ preventScroll: true });
}

function exitCinematic() {
    if (!cinematicState.active) return;
    const saved = cinematicState.saved;
    cinematicState.active = false;
    cinematicState.phase = 'idle';
    if (audioEngine.ctx?.state === 'suspended') audioEngine.ctx.resume();
    stopSong();
    songState.audition = saved.audition;
    controls.enabled = saved.controlsEnabled;
    camera.position.copy(saved.position);
    controls.target.copy(saved.target);
    camera.fov = saved.fov;
    camera.far = saved.far;
    if (scene.fog && saved.fogDensity !== undefined) scene.fog.density = saved.fogDensity;
    camera.updateProjectionMatrix();
    isTransitioningCamera = false;
    controls.update();
    document.body.classList.remove('cinematic-mode');
    document.getElementById('cinematic-overlay').hidden = true;
    setSongView(saved.view);
    document.getElementById(saved.view === 'song' ? 'song-showcase' : 'btn-cinematic').focus({ preventScroll: true });
}

function toggleCinematicPause() {
    if (!cinematicState.active || cinematicState.phase === 'complete') return;
    cinematicState.paused = !cinematicState.paused;
    if (cinematicState.phase === 'playing') {
        appState.isPlaying = !cinematicState.paused;
        // Suspend the audio clock so queued notes, camera timing and tails pause together.
        if (cinematicState.paused) audioEngine.ctx.suspend();
        else audioEngine.ctx.resume();
    }
    updatePlayButtonUI();
    updateCinematicUI();
}

function setCinematicShot(kind) {
    const state = cinematicState;
    const slots = stageState.slots;
    const candidates = slots.filter(
        slot =>
            isSlotAudible(slot, slots) &&
            getSlotSteps(slot).some(step => step !== null && step !== undefined && step !== false),
    );
    let subject = null;
    if (kind === 'player' && candidates.length) {
        // Rotate through the ensemble, favouring performers with notes in this phrase.
        const score = slot =>
            (state.visits.get(slot.index) || 0) * 100 +
            (slot.index === state.subject ? 50 : 0) -
            getSlotSteps(slot)
                .slice(appState.currentStep, appState.currentStep + 8)
                .filter(v => v != null && v !== false).length;
        candidates.sort((a, b) => score(a) - score(b) || a.index - b.index);
        subject = candidates[0];
        state.visits.set(subject.index, (state.visits.get(subject.index) || 0) + 1);
        state.subject = subject.index;
    }
    if (kind === 'player' && !subject) kind = 'wide';
    const radius = getActiveTierConfig().outerR;
    const visibleHeight = Math.max(
        0.25,
        (window.innerHeight -
            document.querySelector('.cinema-top').offsetHeight -
            document.querySelector('.cinema-bottom').offsetHeight) /
            window.innerHeight,
    );
    const aspectScale = Math.max(1, 1.45 / camera.aspect, 0.72 / visibleHeight);
    const angle = 0.28 * Math.sin(state.shotNumber * 1.7);
    const target = new THREE.Vector3(0, 0.8, 0);
    let distance = (radius * 1.6 + 8) * aspectScale;
    let height = radius * 0.7 + 6;
    let fov = 40;
    if (subject) {
        const ped = pedestalMeshes[subject.index];
        target.copy(ped.rootGroup.position);
        target.y = ped.tierConfig.elev + 1.1;
        distance = (state.shotNumber % 3 === 0 ? 6.2 : 4.5) * aspectScale;
        height = target.y + 1.9;
        fov = 34;
    } else if (kind === 'overhead') {
        height = (radius * 2 + 13) * aspectScale;
        distance = radius * 0.65 + 3;
        fov = 44;
    }
    // Portrait framing can move beyond the normal stage's 120-unit clipping plane.
    camera.far = Math.max(state.saved.far, distance + height + radius * 3);
    const direction = subject ? pedestalMeshes[subject.index].rootGroup.rotation.y + angle : angle;
    state.shot = { kind, target, distance, height, direction, fov, presetId: subject?.preset.id };
    state.shotElapsed = 0;
    state.beatsSinceShot = 0;
    const labels = {
        opening: 'THE OPENING / WIDE',
        player: 'IN FOCUS / ' + (subject ? CATEGORY_META[subject.preset.category].name.toUpperCase() : ''),
        wide: 'THE ENSEMBLE / WIDE',
        overhead: 'ABOVE THE STAGE / CRANE',
        finale: 'THE FINAL NOTE / WIDE',
    };
    document.getElementById('cinema-shot').textContent = labels[kind];
    document.getElementById('cinema-subject').textContent = subject
        ? subject.preset.shortName
        : kind === 'opening'
          ? 'The stage is yours.'
          : kind === 'finale'
            ? 'A final bow.'
            : 'Every player. One song.';
}

function directCinematicStep(evt) {
    if (!cinematicState.active || cinematicState.phase !== 'playing') return;
    const state = cinematicState;
    const bar = songState.measures.indexOf(evt.measure);
    const beat = bar * getMeter().beats + Math.floor(evt.step / getMeter().stepsPerBeat);
    const subject = evt.measure.slots[state.subject];
    const subjectGone =
        state.shot?.kind === 'player' &&
        (!subject ||
            subject.preset?.id !== state.shot.presetId ||
            !isSlotAudible(subject, evt.measure.slots) ||
            !getSlotSteps(subject).some(v => v != null && v !== false));
    if (state.lastBeat < 0 || subjectGone) {
        setCinematicShot('player');
    } else if (beat !== state.lastBeat) {
        state.beatsSinceShot++;
        if (state.beatsSinceShot >= 4 && state.shotElapsed >= 1.8) {
            state.shotNumber++;
            const sequence = ['player', 'player', 'wide', 'player', 'overhead', 'player'];
            setCinematicShot(sequence[state.shotNumber % sequence.length]);
        }
    }
    state.lastBeat = beat;
    updateCinematicUI();
}

function updateCinematicUI() {
    const state = cinematicState;
    const measure = songState.heardMeasure || songState.measures[0];
    const index = Math.max(0, songState.measures.indexOf(measure));
    const complete = state.phase === 'complete';
    const progress = complete
        ? 100
        : state.phase === 'intro'
          ? 0
          : ((index * getStepsPerBar() + appState.currentStep) / (songState.measures.length * getStepsPerBar())) * 100;
    document.getElementById('cinema-status').textContent = state.paused
        ? 'PAUSED'
        : complete
          ? 'PERFORMANCE COMPLETE'
          : state.phase === 'intro'
            ? 'SETTING THE SCENE'
            : measure.label || 'LIVE PERFORMANCE';
    document.getElementById('cinema-position').textContent =
        state.phase === 'intro'
            ? 'From measure 1 · One complete performance'
            : complete
              ? `${songState.measures.length} ${songState.measures.length === 1 ? 'measure' : 'measures'} · Thank you for listening`
              : `MEASURE ${String(index + 1).padStart(2, '0')} / ${String(songState.measures.length).padStart(2, '0')} · BEAT ${Math.floor(appState.currentStep / getMeter().stepsPerBeat) + 1}`;
    const pause = document.getElementById('cinema-pause');
    pause.textContent = state.paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-label', state.paused ? 'Resume showcase' : 'Pause showcase');
    pause.disabled = complete;
    document.getElementById('cinema-progress-fill').style.width = `${progress}%`;
    document.querySelector('.cinema-progress').setAttribute('aria-valuenow', Math.round(progress));
}

function updateCinematicCamera(dt) {
    const state = cinematicState;
    if (!state.active || state.paused) return;
    state.elapsed += dt;
    state.shotElapsed += dt;
    if (state.phase === 'intro' && state.elapsed >= 2.4) {
        state.phase = 'playing';
        playSongFrom(0);
        updateCinematicUI();
    }
    const shot = state.shot;
    if (!shot) return;
    const motion = state.reducedMotion ? 0 : Math.min(state.shotElapsed, 16);
    const angle = shot.direction + motion * (shot.kind === 'player' ? 0.025 : 0.018);
    const distance = shot.distance * (1 - Math.min(motion * 0.007, 0.1));
    cameraTargetPos.set(
        shot.target.x + Math.sin(angle) * distance,
        shot.height,
        shot.target.z + Math.cos(angle) * distance,
    );
    const smoothing = 1 - Math.exp(-dt * (state.reducedMotion ? 5 : 1.9));
    camera.position.lerp(cameraTargetPos, smoothing);
    controls.target.lerp(shot.target, smoothing);
    if (scene.fog && state.saved.fogDensity !== undefined) {
        const fogDensity = state.saved.fogDensity * Math.min(1, 28 / shot.distance);
        scene.fog.density += (fogDensity - scene.fog.density) * smoothing;
    }
    camera.fov += (shot.fov - camera.fov) * smoothing;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
}

let pointerDownPos = { x: 0, y: 0 };
let playerDrag = null;
let suppressLabelClick = false;

// The landing page stage is view-only: players can't be dragged, edited, or muted.
function stagePlayersLocked() {
    return cinematicState.active || document.body.classList.contains('home-open');
}

// Clear models that fill the foreground when orbiting through the ensemble.
// Keep their pedestals and labels available, without changing pooled materials.
function updateStageCutaway() {
    const enabled = !stagePlayersLocked();
    for (const ped of pedestalMeshes) {
        if (!ped) continue;
        _tempVec3.copy(ped.rootGroup.position);
        _tempVec3.y += 0.9 * ped.baseScale;
        const distance = camera.position.distanceTo(_tempVec3) / ped.baseScale;
        // Separate entry/exit distances prevent flicker at the boundary.
        ped.cameraCutaway = enabled && distance < (ped.cameraCutaway ? 3.2 : 2.8);
        ped.performerGroup.visible = !ped.cameraCutaway;
        for (const outgoing of ped.departingPerformers) outgoing.visible = !ped.cameraCutaway;
        if (ped.cameraCutaway && ped.effectVisuals) ped.effectVisuals.visible = false;
    }
}

function pickStageSlot(clientX, clientY, excludeSlot = -1) {
    const bounds = renderer.domElement.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return -1;
    setStagePointer(clientX, clientY);
    raycaster.setFromCamera(mouseNDC, camera);
    const activeProxies = [];
    for (let i = 0; i < stageState.unlockedSlots; i++) {
        if (i === excludeSlot) continue;
        const ped = pedestalMeshes[i];
        if (!ped?.rootGroup.visible) continue;
        // A hidden model must not intercept a click intended for a player behind it.
        activeProxies.push(ped.cameraCutaway ? ped.baseCyl : pedestalHitProxies[i]);
    }
    const hit = raycaster.intersectObjects(activeProxies, false)[0];
    return hit?.object.userData.slotIndex ?? -1;
}

// Orbit controls stay off for the whole press so a player drag never spins the camera.
function beginPlayerDrag(slotIdx, clientX, clientY) {
    if (stagePlayersLocked() || !stageState.slots[slotIdx]?.preset) return;
    playerDrag = { from: slotIdx, x: clientX, y: clientY, active: false };
    controls.enabled = false;
}

function setDropTarget(slotIdx) {
    hudBadgeElements.forEach((badge, idx) =>
        badge?.classList.toggle('is-drop-target', idx === slotIdx && idx !== playerDrag?.from),
    );
}

function finishPlayerDrag(commit) {
    const drag = playerDrag;
    playerDrag = null;
    controls.enabled = true;
    if (!drag?.active) return;
    document.getElementById('drag-ghost').style.display = 'none';
    document.body.classList.remove('is-dragging-player');
    setDropTarget(-1);
    const target = appState.hoveredSlotIndex;
    appState.hoveredSlotIndex = -1;
    suppressLabelClick = true;
    setTimeout(() => {
        suppressLabelClick = false;
    }, 0);
    if (commit && target >= 0 && target !== drag.from) {
        editStageMeasure();
        moveStagePlayer(drag.from, target);
    } else updatePedestalHUDBadges();
}

window.onStageLabelClick = function (slotIdx) {
    if (!suppressLabelClick && !stagePlayersLocked()) focusStudioTrack(slotIdx);
};

function onStagePointerDown(e) {
    if (cinematicState.active || appState.draggedEffectId || e.target !== renderer.domElement) return;
    pointerDownPos.x = e.clientX;
    pointerDownPos.y = e.clientY;
    if (e.button === 0) {
        const slotIdx = pickStageSlot(e.clientX, e.clientY);
        if (slotIdx >= 0) beginPlayerDrag(slotIdx, e.clientX, e.clientY);
    }
}

function onStagePointerMove(e) {
    if (cinematicState.active) return;
    if (playerDrag) {
        if (!playerDrag.active && Math.hypot(e.clientX - playerDrag.x, e.clientY - playerDrag.y) > 6) {
            const preset = stageState.slots[playerDrag.from].preset;
            playerDrag.active = true;
            document.getElementById('drag-ghost-dot').style.backgroundColor = CATEGORY_META[preset.category].color;
            document.getElementById('drag-ghost-label').textContent = preset.shortName;
            document.getElementById('drag-ghost').style.display = 'flex';
            document.body.classList.add('is-dragging-player');
            updatePedestalHUDBadges();
        }
        if (playerDrag.active) {
            const ghost = document.getElementById('drag-ghost');
            ghost.style.left = `${e.clientX}px`;
            ghost.style.top = `${e.clientY}px`;
            appState.hoveredSlotIndex = pickStageSlot(e.clientX, e.clientY, playerDrag.from);
            setDropTarget(appState.hoveredSlotIndex);
        }
        return;
    }
    if (appState.draggedEffectId) {
        // Effect dragging owns its pointer listener and arrangement auto-scroll.
        return;
    } else if (appState.draggedPresetId) {
        const ghost = document.getElementById('drag-ghost');
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
        checkPedestalHover(e.clientX, e.clientY);
    } else if (stageState.unlockedSlots > 12 && e.target === renderer.domElement) {
        // Lightweight hover detection in 24..100 Crowd Mode to pop up HUD inspector on hovered outer performer
        checkPedestalHover(e.clientX, e.clientY);
    }
}

function onStagePointerUp(e) {
    if (cinematicState.active) return;
    if (playerDrag) {
        const dragged = playerDrag.active;
        finishPlayerDrag(true);
        if (dragged) return;
    }
    if (stagePlayersLocked() || appState.draggedEffectId) return;
    if (e.target === renderer.domElement && !appState.draggedPresetId) {
        const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        if (dist < 5) {
            const slotIdx = pickStageSlot(e.clientX, e.clientY);
            if (slotIdx >= 0) {
                if (stageState.slots[slotIdx].preset) {
                    if (typeof studioExperience !== 'undefined' && studioExperience === 'immersive') {
                        editStageMeasure();
                        openTrackControls(slotIdx);
                    } else if (stageState.slots !== appState.slots) editStageMeasure();
                    else toggleSlotMute(slotIdx);
                }
            }
        }
    }
}

function checkPedestalHover(clientX, clientY) {
    const prevHover = appState.hoveredSlotIndex;
    appState.hoveredSlotIndex = pickStageSlot(clientX, clientY);
    if (prevHover !== appState.hoveredSlotIndex && stageState.unlockedSlots > 12) {
        // Update visibility of hovered outer-ring HUD badge without full DOM rebuild
        [prevHover, appState.hoveredSlotIndex].forEach(idx => {
            if (idx >= 12 && idx < stageState.unlockedSlots && hudBadgeElements[idx]) {
                hudBadgeElements[idx].style.display =
                    idx === appState.hoveredSlotIndex && stageState.slots[idx].preset ? 'block' : 'none';
            }
        });
    }
}

let stageResizeFrame = 0;
function onWindowResize() {
    if (stageResizeFrame) return;
    stageResizeFrame = requestAnimationFrame(resizeStageViewport);
}

function resizeStageViewport() {
    stageResizeFrame = 0;
    if (!camera || !renderer) return;
    if (typeof syncHomeFrame === 'function') syncHomeFrame();
    const viewport = getStageViewport();
    // A hidden or collapsing layout must never become a 1px camera or drawing buffer.
    if (viewport.width < 2 || viewport.height < 2) return;
    const previousFraming = stageFraming(camera.aspect);
    frameStageViewport(viewport);
    const nextFraming = stageFraming(camera.aspect);
    if (!cinematicState.active && controls && Math.abs(nextFraming - previousFraming) > 0.001) {
        const ratio = nextFraming / previousFraming;
        camera.position.sub(controls.target).multiplyScalar(ratio).add(controls.target);
        cameraTargetPos.sub(cameraLookAtTarget).multiplyScalar(ratio).add(cameraLookAtTarget);
    }
    if (!cinematicState.active) updateStageCameraRange();
    camera.updateProjectionMatrix();
    const drawingSize = renderer.getSize(new THREE.Vector2());
    const pixelRatio = Math.min(window.devicePixelRatio, compactStageDevice ? 1.5 : 2);
    const ratioChanged = renderer.getPixelRatio() !== pixelRatio;
    const sizeChanged = drawingSize.x !== viewport.width || drawingSize.y !== viewport.height;
    if (ratioChanged) renderer.setPixelRatio(pixelRatio);
    if (sizeChanged) renderer.setSize(viewport.width, viewport.height, false);
    if (cinematicState.active && cinematicState.shot) {
        const visits = new Map(cinematicState.visits);
        const subject = cinematicState.subject;
        // Reframe the current shot without advancing the director's performer rotation.
        if (cinematicState.shot.kind === 'player') {
            cinematicState.visits.set(subject, -1);
        }
        setCinematicShot(cinematicState.shot.kind);
        cinematicState.visits = visits;
    }
    // setSize clears WebGL's buffer. Paint it in the same frame as the resize.
    if ((ratioChanged || sizeChanged) && songState.view === 'stage') {
        updateHUDProjections();
        renderer.render(scene, camera);
    }
}
