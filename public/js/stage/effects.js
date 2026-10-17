/* Reused geometry, with at most four lightweight accents per performer. */
let performerEffectRingGeometry;
let performerEffectSparkGeometry;

function updatePerformerEffectVisuals(ped, slot, elapsed, reducedMotion) {
    if (ped.effectVisualSource !== slot.effects) {
        ped.effectVisualSource = slot.effects;
        const active = (slot.effects || []).filter(effect => effect.enabled && effect.amount > 0);
        const key = active.map(effect => effect.id).join('|');
        if (key !== ped.effectVisualKey) {
            ped.effectVisualKey = key;
            if (ped.effectVisuals) {
                ped.effectVisuals.children.forEach(mesh => mesh.material.dispose());
                ped.rootGroup.remove(ped.effectVisuals);
                ped.effectVisuals = null;
            }
            if (active.length) {
                if (!performerEffectRingGeometry) {
                    performerEffectRingGeometry = new THREE.TorusGeometry(0.96, 0.016, 4, 48);
                    performerEffectSparkGeometry = new THREE.BufferGeometry();
                    const positions = [];
                    for (let i = 0; i < 12; i++) {
                        const angle = (i / 12) * Math.PI * 2;
                        positions.push(Math.sin(angle) * 0.9, 0.25 + (i % 4) * 0.28, Math.cos(angle) * 0.9);
                    }
                    performerEffectSparkGeometry.setAttribute(
                        'position',
                        new THREE.Float32BufferAttribute(positions, 3),
                    );
                }
                ped.effectVisuals = new THREE.Group();
                active.forEach(effect => {
                    const definition = PERFORMER_EFFECT_BY_ID.get(effect.id);
                    const sparks = definition.visual === 'spark';
                    const material = sparks
                        ? new THREE.PointsMaterial({
                              color: definition.color,
                              size: 0.075,
                              transparent: true,
                              depthWrite: false,
                          })
                        : new THREE.MeshBasicMaterial({
                              color: definition.color,
                              transparent: true,
                              depthWrite: false,
                          });
                    const mesh = sparks
                        ? new THREE.Points(performerEffectSparkGeometry, material)
                        : new THREE.Mesh(performerEffectRingGeometry, material);
                    mesh.userData = { id: effect.id, visual: definition.visual };
                    mesh.renderOrder = 1;
                    ped.effectVisuals.add(mesh);
                });
                ped.rootGroup.add(ped.effectVisuals);
            }
        }
    }
    if (!ped.effectVisuals) return;
    ped.effectVisuals.visible = !!slot.preset && isSlotAudible(slot, stageState.slots);
    if (!ped.effectVisuals.visible) return;
    const moving = !reducedMotion && (appState.isPlaying || slot.energy > 0.01);
    const time = moving ? elapsed : 0;
    ped.effectVisuals.children.forEach((mesh, index) => {
        const effect = slot.effects.find(effect => effect.id === mesh.userData.id);
        const amount = effect?.amount || 0;
        const phase = time * (0.7 + amount) + index * 1.6;
        const energy = reducedMotion ? 0 : slot.energy;
        mesh.material.opacity = (stageTheme === 'light' ? 0.65 : 0.5) * (0.35 + amount * 0.65);
        if (mesh.userData.visual === 'pulse') {
            mesh.rotation.set(-Math.PI / 2, 0, 0);
            mesh.position.y = 0.12 + index * 0.045;
            mesh.scale.setScalar(1.12 + index * 0.13 + energy * amount * 0.35);
        } else if (mesh.userData.visual === 'orbit') {
            mesh.position.y = 0.8 + index * 0.22;
            mesh.rotation.set(Math.PI / 2 + Math.sin(phase) * 0.25, Math.cos(phase) * 0.35, phase * 0.2);
            mesh.scale.setScalar(1.15 + index * 0.12 + energy * 0.08);
        } else if (mesh.userData.visual === 'warp') {
            mesh.position.y = 0.75 + Math.sin(phase) * 0.13;
            mesh.rotation.set(phase * 0.4 + 0.6, phase * 0.6, 0.4 + index);
            mesh.scale.set(1.05 + amount * 0.15, 1.1 + Math.sin(phase) * amount * 0.18, 1);
        } else {
            mesh.position.y = energy * 0.18;
            mesh.rotation.y = phase * 0.5;
            mesh.scale.setScalar(1 + amount * 0.15 + energy * 0.12);
        }
    });
}
