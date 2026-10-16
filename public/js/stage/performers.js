/***********************************************************************
 * 5. DETAILED 3D PERFORMERS & 6 PHYSICAL INSTRUMENT RIGS (POOLED GEOMETRIES)
 ***********************************************************************/
function buildBaseMusicianFigure(accentMat, jacketMat, detailed = true) {
    const g = sharedPerformerGeometries;
    const group = new THREE.Group();
    const rig = {
        bodyPivot: new THREE.Group(),
        headGroup: new THREE.Group(),
        jawMesh: null,
        visorMesh: null,
        leftArmPivot: new THREE.Group(),
        rightArmPivot: new THREE.Group(),
        leftHand: null,
        rightHand: null,
        extraAnim: {}
    };

    const leftLeg = new THREE.Mesh(g.leg, sharedStudioMaterials.matteBlack);
    leftLeg.position.set(-0.11, 0.21, -0.14);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(g.leg, sharedStudioMaterials.matteBlack);
    rightLeg.position.set(0.11, 0.21, -0.14);
    group.add(rightLeg);
    if (detailed) [-0.11, 0.11].forEach(x => {
        const shoe = new THREE.Mesh(g.shoe, sharedStudioMaterials.matteBlack);
        shoe.position.set(x, 0.045, -0.10);
        group.add(shoe);
    });

    rig.bodyPivot.position.set(0, 0.42, -0.14);
    group.add(rig.bodyPivot);

    const torso = new THREE.Mesh(g.torso, jacketMat);
    torso.position.set(0, 0.25, 0);
    rig.bodyPivot.add(torso);
    const shirt = new THREE.Mesh(g.shirt, sharedStudioMaterials.ivoryKey);
    shirt.position.set(0, 0.30, 0.18);
    if (detailed) rig.bodyPivot.add(shirt);

    const collar = new THREE.Mesh(g.collar, accentMat);
    collar.position.set(0, 0.51, 0);
    rig.bodyPivot.add(collar);

    rig.headGroup.position.set(0, 0.56, 0);
    rig.bodyPivot.add(rig.headGroup);

    const cranium = new THREE.Mesh(g.cranium, sharedStudioMaterials.skinClay);
    cranium.position.set(0, 0.16, 0);
    cranium.scale.set(0.95, 1.08, 0.96);
    rig.headGroup.add(cranium);

    const jaw = new THREE.Mesh(g.jaw, sharedStudioMaterials.skinClay);
    jaw.position.set(0, 0.075, 0.03);
    if (detailed) rig.headGroup.add(jaw);
    rig.jawMesh = jaw;

    const visor = new THREE.Mesh(g.visor, sharedStudioMaterials.matteBlack);
    visor.position.set(0, 0.18, 0.12);
    rig.headGroup.add(visor);

    const visorRim = new THREE.Mesh(g.visorRim, accentMat);
    visorRim.position.set(0, 0.21, 0.12);
    if (detailed) rig.headGroup.add(visorRim);
    rig.visorMesh = visorRim;

    const headband = new THREE.Mesh(g.headband, sharedStudioMaterials.chrome);
    headband.position.set(0, 0.18, 0);
    if (detailed) rig.headGroup.add(headband);

    if (detailed) [-0.19, 0.19].forEach(xPos => {
        const cup = new THREE.Mesh(g.earcup, sharedStudioMaterials.matteBlack);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(xPos, 0.16, 0);
        rig.headGroup.add(cup);

        const cupRing = new THREE.Mesh(g.cupRing, accentMat);
        cupRing.rotation.z = Math.PI / 2;
        cupRing.position.set(xPos, 0.16, 0);
        rig.headGroup.add(cupRing);
    });

    rig.leftArmPivot.position.set(-0.23, 0.45, 0);
    rig.rightArmPivot.position.set(0.23, 0.45, 0);
    rig.bodyPivot.add(rig.leftArmPivot);
    rig.bodyPivot.add(rig.rightArmPivot);

    const leftArmMesh = new THREE.Mesh(g.armSleeve, jacketMat);
    leftArmMesh.position.set(0, -0.16, 0.08);
    leftArmMesh.rotation.x = -0.5;
    rig.leftArmPivot.add(leftArmMesh);

    const leftHand = new THREE.Mesh(g.hand, sharedStudioMaterials.skinClay);
    leftHand.position.set(0, -0.31, 0.17);
    rig.leftArmPivot.add(leftHand);
    rig.leftHand = leftHand;

    const rightArmMesh = new THREE.Mesh(g.armSleeve, jacketMat);
    rightArmMesh.position.set(0, -0.16, 0.08);
    rightArmMesh.rotation.x = -0.5;
    rig.rightArmPivot.add(rightArmMesh);

    const rightHand = new THREE.Mesh(g.hand, sharedStudioMaterials.skinClay);
    rightHand.position.set(0, -0.31, 0.17);
    rig.rightArmPivot.add(rightHand);
    rig.rightHand = rightHand;

    return { group, rig };
}

function rebuildPedestalPerformer(slotIndex) {
    const ped = pedestalMeshes[slotIndex];
    if (!ped) return;
    const slot = stageState.slots[slotIndex];
    const g = sharedPerformerGeometries;

    const category = slot.preset?.category || null;
    const audible = isSlotAudible(slot, stageState.slots);
    ped.ringMesh.material = category
        ? (audible ? sharedCategoryMaterials[category].activeRing : sharedStudioMaterials.mutedRing)
        : sharedStudioMaterials.inactiveRing;
    if (category) ped.waveMesh.material.color.setHex(CATEGORY_META[category].hex);
    if (ped.visualCategory === category) return;

    // Shrink only the outgoing model; shared geometries/materials remain reusable.
    if (ped.visualCategory && ped.performerGroup.children.length) {
        const outgoing = new THREE.Group();
        outgoing.position.copy(ped.performerGroup.position);
        outgoing.scale.copy(ped.performerGroup.scale);
        while (ped.performerGroup.children.length) outgoing.add(ped.performerGroup.children[0]);
        ped.rootGroup.add(outgoing);
        ped.departingPerformers.push(outgoing);
    }
    ped.visualCategory = category;
    ped.performerGroup.scale.setScalar(category ? 0.001 : 1);

    while (ped.performerGroup.children.length > 0) {
        ped.performerGroup.remove(ped.performerGroup.children[0]);
    }
    ped.rig = null;

    if (!slot.preset) {
        const socketCap = new THREE.Mesh(g.socketCap, sharedStudioMaterials.stageTrim);
        socketCap.position.y = 0.02;
        socketCap.userData = { slotIndex };
        ped.performerGroup.add(socketCap);

        ped.ringMesh.material = sharedStudioMaterials.inactiveRing;
        if (ped.stepLeds && Array.isArray(ped.stepLeds)) {
            ped.stepLeds.forEach(seg => seg.material.color.setHex(0x161f33));
        }
        return;
    }

    const cat = slot.preset.category;
    const catMats = sharedCategoryMaterials[cat];
    const accentMat = catMats.accent;
    const jacketMat = catMats.jacket;
    ped.ringMesh.material = audible ? catMats.activeRing : sharedStudioMaterials.mutedRing;
    ped.waveMesh.material.color.setHex(CATEGORY_META[cat].hex);

    const { group: musicianGroup, rig } = buildBaseMusicianFigure(accentMat, jacketMat, slotIndex < 24);
    rig.category = cat;

    if (cat === 'drums') {
        // 1. DRUMS: Acoustic Kick, Chrome Snare, Brass Crash Cymbal & Moving Drumsticks
        const kickGroup = new THREE.Group();
        kickGroup.position.set(0, 0.28, 0.36);
        const kickShell = new THREE.Mesh(g.kickShell, sharedStudioMaterials.walnutWood);
        kickShell.rotation.x = Math.PI / 2;
        kickGroup.add(kickShell);

        const kickHoopF = new THREE.Mesh(g.kickHoop, sharedStudioMaterials.chrome);
        kickHoopF.position.z = 0.17;
        kickGroup.add(kickHoopF);
        const kickHoopB = new THREE.Mesh(g.kickHoop, sharedStudioMaterials.chrome);
        kickHoopB.position.z = -0.17;
        kickGroup.add(kickHoopB);
        if (slotIndex < 24) {
            const lugs = new THREE.InstancedMesh(g.drumLug, sharedStudioMaterials.chrome, 8);
            for (let n = 0; n < 8; n++) {
                const a = n / 8 * Math.PI * 2;
                _tempDummy.position.set(Math.cos(a) * 0.269, Math.sin(a) * 0.269, 0);
                _tempDummy.rotation.set(Math.PI / 2, 0, 0);
                _tempDummy.scale.setScalar(1);
                _tempDummy.updateMatrix();
                lugs.setMatrixAt(n, _tempDummy.matrix);
            }
            kickGroup.add(lugs);
        }

        const kickHead = new THREE.Mesh(g.kickHead, sharedStudioMaterials.drumheadWhite);
        kickHead.position.z = 0.172;
        kickGroup.add(kickHead);

        const kickLogo = new THREE.Mesh(g.kickLogo, accentMat);
        kickLogo.position.z = 0.175;
        kickGroup.add(kickLogo);
        musicianGroup.add(kickGroup);
        rig.extraAnim.kickHead = kickHead;

        const snareStand = new THREE.Mesh(g.snareStand, sharedStudioMaterials.chrome);
        snareStand.position.set(-0.26, 0.26, 0.20);
        musicianGroup.add(snareStand);

        const snareShell = new THREE.Mesh(g.snareShell, sharedStudioMaterials.chrome);
        snareShell.position.set(-0.26, 0.54, 0.20);
        musicianGroup.add(snareShell);

        const snareHead = new THREE.Mesh(g.snareHead, sharedStudioMaterials.drumheadWhite);
        snareHead.position.set(-0.26, 0.60, 0.20);
        musicianGroup.add(snareHead);

        const cymbalStand = new THREE.Mesh(g.cymbalStand, sharedStudioMaterials.chrome);
        cymbalStand.position.set(0.32, 0.42, 0.22);
        musicianGroup.add(cymbalStand);

        const cymbalDisc = new THREE.Mesh(g.cymbalDisc, sharedStudioMaterials.brass);
        cymbalDisc.position.set(0.32, 0.86, 0.22);
        cymbalDisc.rotation.z = 0.15;
        cymbalDisc.rotation.x = 0.12;
        musicianGroup.add(cymbalDisc);
        rig.extraAnim.cymbalDisc = cymbalDisc;

        const stickL = new THREE.Mesh(g.drumstick, sharedStudioMaterials.mapleWood);
        stickL.rotation.x = Math.PI / 2.2;
        stickL.position.set(0, -0.02, 0.15);
        rig.leftHand.add(stickL);

        const stickR = new THREE.Mesh(g.drumstick, sharedStudioMaterials.mapleWood);
        stickR.rotation.x = Math.PI / 2.2;
        stickR.position.set(0, -0.02, 0.15);
        rig.rightHand.add(stickR);

        rig.leftArmPivot.rotation.set(-0.35, 0.18, 0);
        rig.rightArmPivot.rotation.set(-0.45, -0.22, 0);

    } else if (cat === 'bass') {
        // 2. BASS: 4-String Electric Bass + Twin-12" Amp Stack
        const ampCab = new THREE.Mesh(g.ampCab, sharedStudioMaterials.matteBlack);
        ampCab.position.set(0, 0.41, -0.46);
        musicianGroup.add(ampCab);
        const ampGrille = new THREE.Mesh(g.ampGrille, sharedStudioMaterials.charcoalFabric);
        ampGrille.position.set(0, 0.41, -0.27);
        musicianGroup.add(ampGrille);

        const ampHead = new THREE.Mesh(g.ampHead, sharedStudioMaterials.brushedAluminum);
        ampHead.position.set(0, 0.92, -0.46);
        musicianGroup.add(ampHead);

        const vuMeter = new THREE.Mesh(g.vuMeter, accentMat);
        vuMeter.position.set(0, 0.92, -0.285);
        musicianGroup.add(vuMeter);

        rig.extraAnim.woofers = [];
        [0.26, 0.58].forEach(yCone => {
            const surround = new THREE.Mesh(g.wooferSurround, sharedStudioMaterials.matteBlack);
            surround.position.set(0, yCone, -0.255);
            musicianGroup.add(surround);

            const dustCap = new THREE.Mesh(g.wooferCap, sharedStudioMaterials.charcoalFabric);
            dustCap.scale.z = 0.45;
            dustCap.position.set(0, yCone, -0.24);
            musicianGroup.add(dustCap);
            rig.extraAnim.woofers.push(dustCap);
        });

        const guitarGroup = new THREE.Group();
        guitarGroup.position.set(0, 0.22, 0.19);
        guitarGroup.rotation.z = 0.28;

        const guitarBody = new THREE.Mesh(g.guitarBody, accentMat);
        guitarBody.position.set(-0.06, 0, 0);
        guitarGroup.add(guitarBody);

        const pickguard = new THREE.Mesh(g.pickguard, sharedStudioMaterials.ivoryKey);
        pickguard.position.set(-0.04, -0.02, 0.035);
        guitarGroup.add(pickguard);

        const neck = new THREE.Mesh(g.guitarNeck, sharedStudioMaterials.mapleWood);
        neck.position.set(0.28, 0.03, 0);
        guitarGroup.add(neck);

        const headstock = new THREE.Mesh(g.headstock, accentMat);
        headstock.position.set(0.55, 0.04, 0);
        guitarGroup.add(headstock);
        const bridge = new THREE.Mesh(g.bridge, sharedStudioMaterials.chrome);
        bridge.position.set(-0.15, 0.024, 0.044);
        guitarGroup.add(bridge);
        if (slotIndex < 24) {
            guitarGroup.add(new THREE.LineSegments(g.bassStrings, sharedStudioMaterials.instrumentWire));
            guitarGroup.add(new THREE.LineSegments(g.bassFrets, sharedStudioMaterials.instrumentWire));
            const pegs = new THREE.InstancedMesh(g.tuningPeg, sharedStudioMaterials.chrome, 4);
            for (let p = 0; p < 4; p++) {
                _tempDummy.position.set(0.51 + p * 0.028, 0.09, 0);
                _tempDummy.rotation.set(0, 0, 0);
                _tempDummy.scale.setScalar(1);
                _tempDummy.updateMatrix();
                pegs.setMatrixAt(p, _tempDummy.matrix);
            }
            guitarGroup.add(pegs);
        }

        rig.bodyPivot.add(guitarGroup);
        rig.extraAnim.guitarGroup = guitarGroup;

        rig.leftArmPivot.rotation.set(-0.55, -0.35, -0.2);
        rig.rightArmPivot.rotation.set(-0.4, 0.35, 0.1);

    } else if (cat === 'chords') {
        // 3. CHORDS: Studio Electric Piano with Moving Keys
        const synthStandGroup = new THREE.Group();
        synthStandGroup.position.set(0, 0, 0.25);

        [-0.36, 0.36].forEach(xLeg => {
            const leg = new THREE.Mesh(g.synthLeg, sharedStudioMaterials.chrome);
            leg.position.set(xLeg, 0.33, 0);
            leg.rotation.z = xLeg > 0 ? 0.08 : -0.08;
            synthStandGroup.add(leg);
        });

        const chassis = new THREE.Mesh(g.synthChassis, sharedStudioMaterials.matteBlack);
        chassis.position.set(0, 0.66, 0);
        synthStandGroup.add(chassis);

        [-0.43, 0.43].forEach(xCheek => {
            const cheek = new THREE.Mesh(g.synthCheek, sharedStudioMaterials.walnutWood);
            cheek.position.set(xCheek, 0.67, 0);
            synthStandGroup.add(cheek);
        });

        const frontStrip = new THREE.Mesh(g.synthStrip, accentMat);
        frontStrip.position.set(0, 0.68, 0.16);
        synthStandGroup.add(frontStrip);
        const display = new THREE.Mesh(g.synthDisplay, accentMat);
        display.position.set(-0.19, 0.708, -0.12);
        synthStandGroup.add(display);
        if (slotIndex < 24) {
            const knobs = new THREE.InstancedMesh(g.controlKnob, sharedStudioMaterials.brushedAluminum, 5);
            for (let n = 0; n < 5; n++) {
                _tempDummy.position.set(0.01 + n * 0.062, 0.715, -0.12);
                _tempDummy.rotation.set(0, 0, 0);
                _tempDummy.scale.setScalar(1);
                _tempDummy.updateMatrix();
                knobs.setMatrixAt(n, _tempDummy.matrix);
            }
            synthStandGroup.add(knobs);
        }

        rig.extraAnim.pianoKeys = [];
        const distantKeys = slotIndex >= 24 ? new THREE.InstancedMesh(g.whiteKey, sharedStudioMaterials.ivoryKey, 9) : null;
        for (let k = 0; k < 9; k++) {
            if (distantKeys) {
                _tempDummy.position.set((k - 4) * 0.082, 0.71, -0.03);
                _tempDummy.rotation.set(0, 0, 0);
                _tempDummy.scale.setScalar(1);
                _tempDummy.updateMatrix();
                distantKeys.setMatrixAt(k, _tempDummy.matrix);
            } else {
                const wKey = new THREE.Mesh(g.whiteKey, sharedStudioMaterials.ivoryKey);
                wKey.position.set((k - 4) * 0.082, 0.71, -0.03);
                synthStandGroup.add(wKey);
                rig.extraAnim.pianoKeys.push(wKey);
            }
        }
        if (distantKeys) synthStandGroup.add(distantKeys);
        const blackKeys = new THREE.InstancedMesh(g.blackKey, sharedStudioMaterials.ebonyKey, 5);
        [-3, -2, 0, 1, 2].forEach((bIdx, instance) => {
            _tempDummy.position.set((bIdx + 0.5) * 0.082, 0.725, 0.0);
            _tempDummy.rotation.set(0, 0, 0);
            _tempDummy.scale.setScalar(1);
            _tempDummy.updateMatrix();
            blackKeys.setMatrixAt(instance, _tempDummy.matrix);
        });
        synthStandGroup.add(blackKeys);

        musicianGroup.add(synthStandGroup);
        rig.leftArmPivot.rotation.set(-0.52, 0.1, 0);
        rig.rightArmPivot.rotation.set(-0.52, -0.1, 0);

    } else if (cat === 'melody') {
        // 4. MELODY: Sculpted Brass Tenor Saxophone
        const saxGroup = new THREE.Group();
        saxGroup.position.set(0.04, 0.22, 0.25);
        saxGroup.rotation.x = 0.22;

        const saxBody = new THREE.Mesh(g.saxBody, sharedStudioMaterials.brass);
        saxBody.position.set(0, 0.02, 0);
        saxGroup.add(saxBody);

        const saxBow = new THREE.Mesh(g.saxBow, sharedStudioMaterials.brass);
        saxBow.position.set(0, -0.20, 0.075);
        saxBow.rotation.y = Math.PI / 2;
        saxBow.rotation.x = Math.PI;
        saxGroup.add(saxBow);

        const saxBell = new THREE.Mesh(g.saxBell, sharedStudioMaterials.brass);
        saxBell.position.set(0, -0.08, 0.16);
        saxBell.rotation.x = 0.25;
        saxGroup.add(saxBell);
        if (slotIndex < 24) {
            const keys = new THREE.InstancedMesh(g.saxKey, sharedStudioMaterials.chrome, 6);
            for (let n = 0; n < 6; n++) {
                _tempDummy.position.set(0.038, -0.12 + n * 0.055, 0.028);
                _tempDummy.rotation.set(Math.PI / 2, 0, 0);
                _tempDummy.scale.setScalar(1);
                _tempDummy.updateMatrix();
                keys.setMatrixAt(n, _tempDummy.matrix);
            }
            saxGroup.add(keys);
        }

        const neckTube = new THREE.Mesh(g.saxNeck, sharedStudioMaterials.brass);
        neckTube.position.set(0, 0.28, -0.04);
        neckTube.rotation.x = -0.55;
        saxGroup.add(neckTube);

        rig.bodyPivot.add(saxGroup);
        rig.extraAnim.saxGroup = saxGroup;

        rig.leftArmPivot.rotation.set(-0.68, 0.32, 0);
        rig.rightArmPivot.rotation.set(-0.52, -0.28, 0);

    } else if (cat === 'strings') {
        // 5. STRINGS & HORNS: Mahogany Concert Cello + Moving Horsehair Bow
        const celloGroup = new THREE.Group();
        celloGroup.position.set(-0.04, 0.48, 0.22);
        celloGroup.rotation.x = -0.18;
        celloGroup.rotation.z = -0.1;

        const celloBody = new THREE.Mesh(g.celloBody, sharedStudioMaterials.walnutWood);
        celloGroup.add(celloBody);

        const fingerboard = new THREE.Mesh(g.fingerboard, sharedStudioMaterials.ebonyKey);
        fingerboard.position.set(0, 0.26, 0.045);
        celloGroup.add(fingerboard);
        const celloBridge = new THREE.Mesh(g.celloBridge, sharedStudioMaterials.mapleWood);
        celloBridge.position.set(0, -0.10, 0.064);
        celloGroup.add(celloBridge);
        if (slotIndex < 24) {
            celloGroup.add(new THREE.LineSegments(g.celloStrings, sharedStudioMaterials.instrumentWire));
        }

        const endpin = new THREE.Mesh(g.endpin, sharedStudioMaterials.chrome);
        endpin.position.set(0, -0.35, 0);
        celloGroup.add(endpin);

        musicianGroup.add(celloGroup);

        // Moving Cello Bow attached to Right Hand
        const bowRod = new THREE.Mesh(g.bowRod, sharedStudioMaterials.mapleWood);
        bowRod.rotation.z = Math.PI / 2;
        bowRod.position.set(-0.2, 0, 0.08);
        rig.rightHand.add(bowRod);
        rig.extraAnim.bowRod = bowRod;

        rig.leftArmPivot.rotation.set(-0.65, 0.25, 0);
        rig.rightArmPivot.rotation.set(-0.48, -0.25, 0);

    } else if (cat === 'vocals') {
        // 6. VOCALS: Brass Studio Condenser Microphone + Shockmount + Pop Filter
        const micStandGroup = new THREE.Group();
        micStandGroup.position.set(0, 0, 0.28);

        const standBase = new THREE.Mesh(g.micBase, sharedStudioMaterials.matteBlack);
        standBase.position.y = 0.015;
        micStandGroup.add(standBase);

        const standPole = new THREE.Mesh(g.micPole, sharedStudioMaterials.chrome);
        standPole.position.y = 0.48;
        micStandGroup.add(standPole);

        const shockRing = new THREE.Mesh(g.shockRing, sharedStudioMaterials.chrome);
        shockRing.position.set(0, 1.0, -0.02);
        shockRing.rotation.x = Math.PI / 2;
        micStandGroup.add(shockRing);

        const micBody = new THREE.Mesh(g.micBody, sharedStudioMaterials.brass);
        micBody.position.set(0, 1.02, -0.02);
        micStandGroup.add(micBody);

        const micGrille = new THREE.Mesh(g.micGrille, sharedStudioMaterials.chrome);
        micGrille.scale.y = 1.25;
        micGrille.position.set(0, 1.10, -0.02);
        micStandGroup.add(micGrille);

        const popRim = new THREE.Mesh(g.popRim, accentMat);
        popRim.position.set(0, 1.07, -0.10);
        micStandGroup.add(popRim);

        const popScreen = new THREE.Mesh(g.popScreen, sharedStudioMaterials.popFilterDark);
        popScreen.position.set(0, 1.07, -0.10);
        micStandGroup.add(popScreen);

        musicianGroup.add(micStandGroup);

        rig.leftArmPivot.rotation.set(-0.45, 0.22, 0.1);
        rig.rightArmPivot.rotation.set(-0.35, -0.18, -0.1);
    }

    if (slotIndex < 12) {
        tagHierarchyWithSlot(musicianGroup, slotIndex);
    }
    ped.performerGroup.add(musicianGroup);
    ped.rig = rig;
}
