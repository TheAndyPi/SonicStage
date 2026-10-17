/***********************************************************************
 * 10. SPECTRUM ANALYZER & MAIN 60FPS ANIMATION LOOP
 ***********************************************************************/
const clock = new THREE.Clock();

function sampleStageAnalyser() {
    if (audioEngine.analyser && appState.isPlaying) audioEngine.analyser.getByteFrequencyData(audioEngine.fftData);
}

// Shown only after a sustained drop, and hidden again once the frame rate has clearly recovered.
const fpsMonitor = { windowStart: 0, frames: 0, slowWindows: 0, fastWindows: 0, visible: false, resumed: true };
// Background tabs throttle rAF; the gap across a tab switch is not a rendering slowdown.
document.addEventListener('visibilitychange', () => {
    fpsMonitor.resumed = true;
});
function trackStageFrameRate() {
    const now = performance.now();
    if (document.hidden || songState.view !== 'stage' || fpsMonitor.resumed) {
        fpsMonitor.resumed = document.hidden;
        fpsMonitor.windowStart = now;
        fpsMonitor.frames = 0;
        return;
    }
    fpsMonitor.frames++;
    const span = now - fpsMonitor.windowStart;
    if (span < 500) return;
    const fps = (fpsMonitor.frames * 1000) / span;
    fpsMonitor.windowStart = now;
    fpsMonitor.frames = 0;
    fpsMonitor.slowWindows = fps < 40 ? fpsMonitor.slowWindows + 1 : 0;
    fpsMonitor.fastWindows = fps >= 50 ? fpsMonitor.fastWindows + 1 : 0;
    if (fpsMonitor.slowWindows >= 2) fpsMonitor.visible = true;
    else if (fpsMonitor.fastWindows >= 4) fpsMonitor.visible = false;

    const el = document.getElementById('stage-fps');
    el.hidden = !fpsMonitor.visible;
    if (!fpsMonitor.visible) return;
    el.textContent = `${Math.round(fps)} FPS`;
    const bounds = document.getElementById('pedestal-hud-layer').getBoundingClientRect();
    el.style.left = `${bounds.right - 10}px`;
    el.style.top = `${bounds.bottom - 10}px`;
}

function animateLoop() {
    requestAnimationFrame(animateLoop);
    trackStageFrameRate();

    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.getElapsedTime();
    const reducedStageMotion = stageMotionPreference.matches;
    const stageEase = reducedStageMotion ? 1 : 1 - Math.exp(-dt * 9);

    // 1. Dequeue Web Audio Step Triggers
    if (audioEngine.ctx && !(cinematicState.active && cinematicState.paused)) {
        const now = audioEngine.ctx.currentTime;
        let stepAdvanced = false;
        while (audioEngine.stepQueue.length > 0 && audioEngine.stepQueue[0].time <= now + 0.015) {
            const evt = audioEngine.stepQueue.shift();
            if (!appState.isPlaying) continue;
            if (evt.end) {
                appState.isPlaying = false;
                if (cinematicState.active) {
                    cinematicState.phase = 'complete';
                    setCinematicShot('finale');
                    updateCinematicUI();
                } else songState.heardMeasure = null;
                updatePlayButtonUI();
                highlightSequencerStep(-1);
                break;
            }
            const measureChanged = songState.heardMeasure !== evt.measure;
            songState.heardMeasure = evt.measure;
            appState.currentStep = evt.step;
            if (
                measureChanged &&
                !cinematicState.active &&
                evt.measure.slots !== appState.slots &&
                !document.body.classList.contains('is-dragging-measure') &&
                !appState.draggedEffectId &&
                !document.activeElement?.closest('.effects-library') &&
                document.activeElement?.id !== 'song-measure-label'
            ) {
                const index = songState.measures.indexOf(evt.measure);
                if (index >= 0) selectSongMeasure(index, songState.view === 'song');
            }
            if (stageState.measure !== evt.measure) syncStageToMeasure();
            stageState.step = evt.step;
            directCinematicStep(evt);
            stepAdvanced = true;
            const viewingPlayingMeasure = evt.measure.slots === appState.slots;
            highlightSequencerStep(viewingPlayingMeasure ? evt.step : -1);
            updateSongPlayhead();

            evt.triggeredSlots.forEach(trig => {
                const slot = evt.measure.slots[trig.slotIndex];
                slot.energy = Math.max(slot.energy, trig.intensity);
                slot.hitCount = (slot.hitCount + 1) % 12;
                slot.vowelState = trig.vowel;

                const ped = pedestalMeshes[trig.slotIndex];
                if (ped) {
                    ped.waveMesh.scale.set(1, 1, 1);
                    ped.waveMesh.material.opacity = reducedStageMotion ? 0 : 0.35;
                }
            });
        }
        if (stepAdvanced) {
            updateAllInstancedLEDColors();
        }
    }

    sampleStageAnalyser();
    drawMasterScope(dt, elapsed, reducedStageMotion);

    // 2. Audio-Reactive Radial Floor EQ Bars + Central Harmonic Gyroscope Core
    let avgAudioEnergy = 0;
    if (audioEngine.analyser && appState.isPlaying) {
        let sum = 0;
        for (let i = 0; i < 32; i++) sum += audioEngine.fftData[i];
        avgAudioEnergy = sum / (32 * 255);
    }

    floorEQBars.forEach((bar, i) => {
        const bin = Math.min(31, Math.floor((i % 32) * 0.9));
        const fftVal = appState.isPlaying && audioEngine.analyser ? audioEngine.fftData[bin] / 255 : 0;
        const target = reducedStageMotion ? 0.08 : fftVal;
        bar.value += (target - bar.value) * (1 - Math.exp(-dt * (target > bar.value ? 22 : 6)));
        const height = 0.04 + bar.value * 0.42;
        _tempDummy.position.set(Math.sin(bar.angle) * bar.radius, height * 0.5, Math.cos(bar.angle) * bar.radius);
        _tempDummy.rotation.set(0, bar.angle, 0);
        _tempDummy.scale.set(1, height / 0.04, 1);
        _tempDummy.updateMatrix();
        floorEQInstancedMesh.setMatrixAt(i, _tempDummy.matrix);
        _tempColor.copy(getStageSpectrumColor(i)).multiplyScalar(0.48 + bar.value * 0.52);
        floorEQInstancedMesh.setColorAt(i, _tempColor);
    });
    if (floorEQInstancedMesh) {
        floorEQInstancedMesh.instanceMatrix.needsUpdate = true;
        floorEQInstancedMesh.instanceColor.needsUpdate = true;
    }

    if (centerCoreGroup && centerCoreGroup.userData.crystalMesh) {
        const { crystalMesh, gyroRing1, gyroRing2 } = centerCoreGroup.userData;
        if (!reducedStageMotion && appState.isPlaying) {
            crystalMesh.rotation.y += dt * 0.22;
            gyroRing1.rotation.x += dt * 0.18;
            gyroRing1.rotation.y += dt * 0.11;
            gyroRing2.rotation.y -= dt * 0.15;
            gyroRing2.rotation.z += dt * 0.08;
        }
        const cScale = 1.0 + (reducedStageMotion ? 0 : avgAudioEnergy * 0.18);
        crystalMesh.scale.lerp(_tempVec3.setScalar(cScale), stageEase);
        crystalMesh.material.emissiveIntensity +=
            (0.12 + avgAudioEnergy * 0.35 - crystalMesh.material.emissiveIntensity) * stageEase;
    }

    if (bokehParticles) {
        bokehParticles.visible = !reducedStageMotion;
        if (appState.isPlaying && !reducedStageMotion) bokehParticles.rotation.y += dt * 0.012;
    }

    // 3. Smooth Camera Preset Transitions
    if (cinematicState.active) updateCinematicCamera(dt);
    else if (isTransitioningCamera) {
        const cameraEase = reducedStageMotion ? 1 : 1 - Math.exp(-dt * 6);
        camera.position.lerp(cameraTargetPos, cameraEase);
        controls.target.lerp(cameraLookAtTarget, cameraEase);
        if (camera.position.distanceTo(cameraTargetPos) < 0.08) {
            isTransitioningCamera = false;
        }
    }
    if (!cinematicState.active) controls.update();

    // 4. Smoothly Elevate Active Concentric Amphitheater Risers & Scale Main Stage Deck (Up to 100 Stages!)
    const activeTierCfg = getActiveTierConfig();
    const targetArenaScale = Math.max(1.0, (activeTierCfg.outerR + 1.55) / 11.45);
    if (mainArenaDeckMesh && outerBrassRimMesh) {
        mainArenaDeckMesh.scale.x += (targetArenaScale - mainArenaDeckMesh.scale.x) * stageEase;
        mainArenaDeckMesh.scale.z += (targetArenaScale - mainArenaDeckMesh.scale.z) * stageEase;
        outerBrassRimMesh.scale.x += (targetArenaScale - outerBrassRimMesh.scale.x) * stageEase;
        outerBrassRimMesh.scale.y += (targetArenaScale - outerBrassRimMesh.scale.y) * stageEase;
    }

    // Expand the 8 perimeter concert light towers so they always frame the outermost active ring
    const targetTowerRadius = Math.max(12.6, activeTierCfg.outerR + 2.4);
    lightPillars.forEach((pillar, idx) => {
        const tx = Math.sin(pillar.baseAngle) * targetTowerRadius;
        const tz = Math.cos(pillar.baseAngle) * targetTowerRadius;
        pillar.towerGroup.position.x += (tx - pillar.towerGroup.position.x) * stageEase;
        pillar.towerGroup.position.z += (tz - pillar.towerGroup.position.z) * stageEase;
        pillar.beamCone.visible = !compactStageDevice && !reducedStageMotion;
        pillar.beamCone.rotation.z = appState.isPlaying ? Math.sin(elapsed * 0.22 + idx) * 0.065 : 0;
        pillar.beamCone.material.opacity +=
            ((0.045 + avgAudioEnergy * 0.07) * (stageTheme === 'light' ? 2.6 : 1) - pillar.beamCone.material.opacity) *
            stageEase;
    });

    tierRiserGroups.forEach(rGroup => {
        const tCfg = rGroup.userData.tierConfig;
        const isUnlocked = stageState.unlockedSlots >= tCfg.cumSlots;
        const targetRiserY = isUnlocked ? 0.0 : -4.5;
        rGroup.position.y += (targetRiserY - rGroup.position.y) * stageEase;
        rGroup.visible = rGroup.position.y > -4.1;
    });

    const visualBpm = Math.min(260, Math.max(12, appState.bpm));
    const baseGrooveFreq = elapsed * (visualBpm / 60) * Math.PI;
    const isLargeCrowd = stageState.unlockedSlots > 24;

    for (let idx = 0; idx < pedestalMeshes.length; idx++) {
        const ped = pedestalMeshes[idx];
        if (!ped) continue;
        for (let i = ped.departingPerformers.length - 1; i >= 0; i--) {
            const outgoing = ped.departingPerformers[i];
            outgoing.scale.multiplyScalar(reducedStageMotion ? 0 : Math.exp(-dt * 22));
            if (outgoing.scale.x < 0.015) {
                outgoing.traverse(child => {
                    // Instance matrices are owned by this departing rig; its materials and geometry are pooled.
                    if (child.isInstancedMesh && child.dispose) child.dispose();
                });
                ped.rootGroup.remove(outgoing);
                ped.departingPerformers.splice(i, 1);
            }
        }
        const slot = stageState.slots[idx];
        const isHovered = appState.hoveredSlotIndex === idx;
        const isSlotUnlocked = idx < stageState.unlockedSlots;

        const targetPedY = isSlotUnlocked ? ped.tierConfig.elev : -4.5;
        if (Math.abs(targetPedY - ped.rootGroup.position.y) > 0.002) {
            ped.rootGroup.position.y += (targetPedY - ped.rootGroup.position.y) * stageEase;
            updatePedestalInstancedLEDPositions(idx, ped.rootGroup.position.y);
        } else if (ped.rootGroup.position.y !== targetPedY) {
            ped.rootGroup.position.y = targetPedY;
            updatePedestalInstancedLEDPositions(idx, targetPedY);
        }

        ped.rootGroup.visible = ped.rootGroup.position.y > -4.1;
        if (!ped.rootGroup.visible) continue;

        if (slot.energy > 0) {
            slot.energy = Math.max(0, slot.energy - dt * 4.2);
        }

        const hoverScale = isHovered ? 1.045 : 1.0;
        if (Math.abs(ped.performerGroup.scale.x - hoverScale) > 0.001) {
            _tempVec3.set(hoverScale, hoverScale, hoverScale);
            ped.performerGroup.scale.lerp(_tempVec3, reducedStageMotion ? 1 : 1 - Math.exp(-dt * 18));
        }

        updatePerformerEffectVisuals(ped, slot, elapsed, reducedStageMotion);

        // Shockwave ring decay
        if (reducedStageMotion) ped.waveMesh.material.opacity = 0;
        else if (ped.waveMesh.material.opacity > 0.01) {
            ped.waveMesh.scale.x += dt * 1.5;
            ped.waveMesh.scale.y += dt * 1.5;
            ped.waveMesh.material.opacity = Math.max(0, ped.waveMesh.material.opacity - dt * 1.6);
        }

        // 5. Articulate 3D Musician & Physical Instrument
        const rig = ped.rig;
        if (rig && slot.preset && isSlotAudible(slot, stageState.slots) && !reducedStageMotion) {
            const e = slot.energy;
            const groovePhase = appState.isPlaying ? baseGrooveFreq + idx : 0;
            if (!appState.isPlaying && document.body.classList.contains('home-open')) {
                const idle = elapsed * 0.55 + idx * 0.7;
                rig.bodyPivot.position.y = 0.42 + Math.sin(idle) * 0.018;
                rig.bodyPivot.rotation.z = Math.sin(idle * 0.45) * 0.035;
                rig.bodyPivot.rotation.y = Math.sin(idle * 0.22) * 0.05;
                rig.headGroup.rotation.x = Math.sin(idle * 0.4) * 0.06;
                rig.headGroup.rotation.y = Math.sin(idle * 0.3) * 0.16;
                if (rig.category === 'strings') rig.rightArmPivot.rotation.y = -0.25 + Math.sin(idle * 1.3) * 0.1;
                else if (rig.category === 'melody' && rig.extraAnim.saxGroup)
                    rig.extraAnim.saxGroup.rotation.x = 0.22 + Math.sin(idle * 0.8) * 0.06;
                else if (rig.category === 'drums') rig.rightArmPivot.rotation.x = -0.42 + Math.sin(idle) * 0.08;
                continue;
            }

            rig.bodyPivot.position.y = 0.42 + Math.abs(Math.sin(groovePhase)) * 0.026 + e * 0.032;
            rig.bodyPivot.rotation.z = Math.sin(groovePhase * 0.5) * 0.045;
            rig.headGroup.rotation.x = Math.sin(groovePhase) * 0.065 + e * 0.14;

            // In 40..100 stage modes, skip sub-part finger/key micro-animations on outer rings when energy is 0
            if (isLargeCrowd && idx >= 24 && e < 0.02) continue;

            if (rig.category === 'drums') {
                const isLeftHit = slot.hitCount % 2 === 0;
                rig.leftArmPivot.rotation.x = -0.35 - (isLeftHit ? e * 0.68 : e * 0.15);
                rig.rightArmPivot.rotation.x = -0.45 - (!isLeftHit ? e * 0.72 : e * 0.2);
                if (rig.extraAnim.kickHead) {
                    const kScale = 1.0 + e * 0.13;
                    rig.extraAnim.kickHead.scale.set(kScale, kScale, 1);
                }
                if (rig.extraAnim.cymbalDisc && e > 0.02) {
                    rig.extraAnim.cymbalDisc.rotation.z = 0.15 + Math.sin(elapsed * 18) * e * 0.16;
                }
            } else if (rig.category === 'bass') {
                rig.rightArmPivot.rotation.x = -0.4 - e * 0.45;
                rig.leftArmPivot.rotation.y = -0.35 + (slot.hitCount % 3) * 0.08 * e;
                if (rig.extraAnim.woofers && e > 0.01) {
                    rig.extraAnim.woofers[0].position.z = -0.24 + e * 0.025;
                    rig.extraAnim.woofers[1].position.z = -0.24 + e * 0.025;
                }
            } else if (rig.category === 'chords') {
                rig.leftArmPivot.rotation.x = -0.52 + e * 0.28;
                rig.rightArmPivot.rotation.x = -0.52 + e * 0.28;
                if (rig.extraAnim.pianoKeys && idx < 24) {
                    for (let kIdx = 0; kIdx < rig.extraAnim.pianoKeys.length; kIdx++) {
                        const activeKey = (kIdx + slot.hitCount) % 3 === 0 && e > 0.1;
                        rig.extraAnim.pianoKeys[kIdx].position.y = activeKey ? 0.71 - e * 0.018 : 0.71;
                    }
                }
            } else if (rig.category === 'melody') {
                rig.bodyPivot.rotation.x = -e * 0.12;
                if (rig.extraAnim.saxGroup) {
                    rig.extraAnim.saxGroup.rotation.x = 0.22 + e * 0.26;
                }
                rig.leftArmPivot.rotation.x = -0.68 - e * 0.15;
                rig.rightArmPivot.rotation.x = -0.52 - e * 0.15;
            } else if (rig.category === 'strings') {
                const bowStroke = appState.isPlaying ? Math.sin(elapsed * 8 + slot.hitCount) * (0.08 + e * 0.22) : 0;
                rig.rightArmPivot.rotation.y = -0.25 + bowStroke;
                rig.leftArmPivot.rotation.x = -0.65 - e * 0.18;
            } else if (rig.category === 'vocals') {
                const vData = VOWEL_FORMANTS[slot.vowelState] || VOWEL_FORMANTS.A;
                const jawDrop = e * 0.068 * vData.open;
                if (rig.jawMesh) {
                    rig.jawMesh.position.y = 0.075 - jawDrop;
                }
                rig.headGroup.rotation.z = Math.sin(groovePhase * 0.5) * 0.08;
                rig.leftArmPivot.rotation.x = -0.45 - e * 0.35;
                rig.rightArmPivot.rotation.x = -0.35 - e * 0.25;
            }
        }
    }

    if (renderer && scene && camera && songState.view === 'stage') {
        updateHUDProjections();
        renderer.render(scene, camera);
    }
}
