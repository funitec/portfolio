/* =========================================================================
   Hero background: a walking skeleton drawn with a hand-rolled 3D
   projection on a 2D canvas.

   The figure starts as a plain, style-less walk and is then repeatedly
   "style transferred": the pose parameters morph into a character style
   (z_char) combined with an emotion (z_emo), hold, and fall back to the
   neutral walk — a live illustration of the research theme.
   No dependencies, no WebGL.
   ========================================================================= */
(() => {
  'use strict';

  const canvas = document.getElementById('skeleton');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  /* ---- camera ----
     Yaw past -pi/2 places the camera in front of the figure, so the chest
     faces the viewer and the walk reads to the right. Looking at the back
     (0 < yaw < pi/2) makes the front/back order of the limbs ambiguous. */
  const cam = { yaw: -2.55, pitch: 0.26, dist: 3.5, fov: 560 };
  let mx = 0, my = 0;
  window.addEventListener('pointermove', e => {
    mx = e.clientX / window.innerWidth - 0.5;
    my = e.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  const anchorX = () => (W > 980 ? W * 0.73 : W * 0.5);
  const anchorY = () => H * 0.62;

  const project = (p, yaw, pitch) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x = p[0] * cy - p[2] * sy;
    let   z = p[0] * sy + p[2] * cy;
    const y = p[1] * cp - z * sp;
    z = p[1] * sp + z * cp + cam.dist;
    const s = cam.fov / z;
    return [anchorX() + x * s, anchorY() - y * s, z, s];
  };

  /* ---- skeleton ---- */
  const L = { thigh: 0.44, shank: 0.44, foot: 0.15, upperArm: 0.3, foreArm: 0.28 };
  const BONES = [
    ['pelvis', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'],
    ['chest', 'shoulderR'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
    ['chest', 'shoulderL'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
    ['pelvis', 'hipR'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['ankleR', 'toeR'],
    ['pelvis', 'hipL'], ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['ankleL', 'toeL'],
  ];

  /* ---- style parameters -------------------------------------------------
     NEUTRAL is the "content only" walk. Every style below is a delta on it,
     mirroring how the research composes a character axis with an emotion axis.
  --------------------------------------------------------------------- */
  const NEUTRAL = {
    stride: 0.62, knee: 0.85, crouch: 0, lean: 0, bounce: 0.03,
    armSwing: 0.50, armRaise: 0, elbow: 0.45, stance: 0.10, head: 0,
    shrug: 0, speed: 1, quant: 0,
  };

  const STYLES = [
    { char: 'NEUTRAL', emo: 'NEUTRAL', tint: null, d: {} },
    { char: 'ROBOT', emo: 'NEUTRAL', tint: [108, 140, 255],
      d: { stride: -0.40, knee: -0.70, armSwing: -0.40, armRaise: 0.52,
           elbow: 1.10, bounce: -0.028, shrug: 0.05, speed: 0.92, quant: 1 } },
    { char: 'BASE', emo: 'HAPPY', tint: [240, 193, 75],
      d: { bounce: 0.055, armSwing: 0.48, armRaise: -0.28, stride: 0.22,
           head: -0.10, shrug: 0.03, speed: 1.22 } },
    { char: 'NINJA', emo: 'ANGRY', tint: [46, 230, 197],
      d: { crouch: 0.20, lean: 0.42, stance: 0.07, armSwing: -0.18,
           elbow: 0.85, stride: 0.06, speed: 1.1 } },
    { char: 'ZOMBIE', emo: 'SAD', tint: [176, 140, 255],
      d: { stride: -0.34, knee: -0.62, armRaise: 1.30, elbow: 0.28,
           lean: 0.20, head: 0.14, armSwing: -0.46, bounce: -0.012,
           speed: 0.72 } },
  ];

  const KEYS = Object.keys(NEUTRAL);
  const target = Object.assign({}, NEUTRAL);   // where we are morphing to
  const cur = Object.assign({}, NEUTRAL);      // current interpolated params
  let tintCur = [140, 152, 172];
  let tintTarget = [140, 152, 172];

  const rotSagittal = (pt, pivot, ang) => {
    const dy = pt[1] - pivot[1], dz = pt[2] - pivot[2];
    const c = Math.cos(ang), s = Math.sin(ang);
    return [pt[0], pivot[1] + dy * c - dz * s, pivot[2] + dy * s + dz * c];
  };

  /* rotate about the vertical axis through the pivot; a positive angle
     carries the +x side forward (+z) */
  const rotY = (pt, pivot, ang) => {
    const dx = pt[0] - pivot[0], dz = pt[2] - pivot[2];
    const c = Math.cos(ang), s = Math.sin(ang);
    return [pivot[0] + dx * c - dz * s, pt[1], pivot[2] + dx * s + dz * c];
  };

  const LEG_JOINTS = ['hipR', 'kneeR', 'ankleR', 'toeR', 'hipL', 'kneeL', 'ankleL', 'toeL'];
  const ARM_JOINTS = ['shoulderR', 'elbowR', 'wristR', 'shoulderL', 'elbowL', 'wristL'];
  const UPPER_JOINTS = ['spine', 'chest', 'neck', 'head'].concat(ARM_JOINTS);

  const pose = (t, p) => {
    const J = {};
    const bob  = p.bounce * Math.sin(t * 2);
    const sway = 0.02 * Math.sin(t);
    const py = 0.98 + bob - p.crouch;
    J.pelvis = [sway, py, 0];
    J.spine  = [sway * 0.6, py + 0.22, 0.01];
    J.chest  = [sway * 0.3, py + 0.40, 0.02];
    J.neck   = [0, py + 0.52 + p.shrug, 0.01];
    J.head   = [0, py + 0.66 + p.shrug, 0.02 + p.head];

    const leg = (side, ph) => {
      const hip = [p.stance * side + sway, py - 0.06, 0];
      const thighA = p.stride * Math.sin(ph);
      const kneeA  = p.knee * Math.max(0, Math.sin(ph - 1.35)) + 0.08 + p.crouch * 1.6;
      const knee = [hip[0], hip[1] - L.thigh * Math.cos(thighA), hip[2] + L.thigh * Math.sin(thighA)];
      const shankA = thighA - kneeA;
      const ankle = [knee[0], knee[1] - L.shank * Math.cos(shankA), knee[2] + L.shank * Math.sin(shankA)];
      const toe = [ankle[0], ankle[1] - 0.03, ankle[2] + L.foot];
      return { hip, knee, ankle, toe };
    };
    const R = leg(1, t), Lg = leg(-1, t + Math.PI);
    J.hipR = R.hip; J.kneeR = R.knee; J.ankleR = R.ankle; J.toeR = R.toe;
    J.hipL = Lg.hip; J.kneeL = Lg.knee; J.ankleL = Lg.ankle; J.toeL = Lg.toe;

    const arm = (side, ph) => {
      const sh = [0.21 * side + sway * 0.3, py + 0.38 + p.shrug, 0.01];
      const a = p.armSwing * Math.sin(ph) + p.armRaise;
      const el = [sh[0] + 0.02 * side, sh[1] - L.upperArm * Math.cos(a), sh[2] + L.upperArm * Math.sin(a)];
      /* the elbow flexes forward (unlike the knee, which flexes backward),
         so the forearm angle is a + bend, never a - bend */
      const bend = p.elbow + 0.25 * Math.max(0, Math.sin(ph));
      const wr = [el[0] + 0.01 * side, el[1] - L.foreArm * Math.cos(a + bend), el[2] + L.foreArm * Math.sin(a + bend)];
      return { sh, el, wr };
    };
    const AR = arm(1, t + Math.PI), AL = arm(-1, t);
    J.shoulderR = AR.sh; J.elbowR = AR.el; J.wristR = AR.wr;
    J.shoulderL = AL.sh; J.elbowL = AL.el; J.wristL = AL.wr;

    /* contralateral torso twist: when the right leg swings forward the right
       shoulder goes back, so upper and lower body read as one connected walk */
    const tw = 0.13 * Math.sin(t);
    for (const k of LEG_JOINTS) J[k] = rotY(J[k], J.pelvis, tw);
    for (const k of ARM_JOINTS) J[k] = rotY(J[k], J.chest, -tw);

    if (Math.abs(p.lean) > 1e-4) {
      const pivot = J.pelvis;
      for (const k of UPPER_JOINTS) J[k] = rotSagittal(J[k], pivot, p.lean);
    }
    return J;
  };

  /* ---- style sequencer + HUD ---- */
  const hud = document.querySelector('.style-hud');
  const hudChar = hud && hud.querySelector('[data-hud="char"]');
  const hudEmo  = hud && hud.querySelector('[data-hud="emo"]');
  const hudBar  = hud && hud.querySelector('.sh-bar i');

  const HOLD_NEUTRAL = 2000;
  const MORPH = 1300;
  const HOLD_STYLE = 4200;

  let idx = 0;            // index into STYLES (0 = neutral)
  let phase = 'hold';     // 'hold' | 'morph'
  let phaseT = 0;
  let styled = false;     // currently showing a style?

  const setTarget = i => {
    const s = STYLES[i];
    for (const k of KEYS) target[k] = NEUTRAL[k] + (s.d[k] || 0);
    tintTarget = s.tint || [140, 152, 172];
    if (hud) {
      hud.dataset.state = i === 0 ? 'input' : 'output';
      if (hudChar) hudChar.textContent = i === 0 ? '—' : s.char;
      if (hudEmo)  hudEmo.textContent  = i === 0 ? '—' : s.emo;
    }
  };

  const step = dt => {
    phaseT += dt;
    const dur = phase === 'morph' ? MORPH : (styled ? HOLD_STYLE : HOLD_NEUTRAL);
    if (hudBar) {
      const p = phase === 'morph' ? phaseT / MORPH : (styled ? 1 : 0);
      hudBar.style.width = (Math.min(1, Math.max(0, p)) * 100) + '%';
    }
    if (phaseT < dur) return;
    phaseT = 0;
    if (phase === 'hold') {
      phase = 'morph';
      if (styled) {              // styled -> back to the plain walk
        setTarget(0);
        styled = false;
      } else {                   // plain walk -> next style
        idx = idx % (STYLES.length - 1) + 1;
        setTarget(idx);
        styled = true;
      }
    } else {
      phase = 'hold';
    }
  };

  /* ---- drawing ---- */
  const parts = Array.from({ length: 46 }, () => ({
    x: (Math.random() - 0.5) * 5.2,
    y: Math.random() * 2.4,
    z: (Math.random() - 0.5) * 5.2,
    r: 0.9 + Math.random() * 1.5,
    v: 0.0008 + Math.random() * 0.0018,
    o: 0.2 + Math.random() * 0.5,
  }));

  const ACC2 = '108, 140, 255';
  const rgb = c => `${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}`;

  const drawFigure = (t, yaw, pitch, alpha, glow) => {
    const tint = rgb(tintCur);
    const J = pose(t, cur);
    const P = {};
    for (const k in J) P[k] = project(J[k], yaw, pitch);

    const sorted = BONES
      .map(([a, b]) => ({ a: P[a], b: P[b], z: (P[a][2] + P[b][2]) / 2 }))
      .sort((p, q) => q.z - p.z);

    ctx.lineCap = 'round';
    if (glow) { ctx.shadowColor = `rgba(${tint}, .55)`; ctx.shadowBlur = 14; }
    for (const bone of sorted) {
      const d = Math.min(1, 3.4 / bone.z);
      ctx.strokeStyle = `rgba(${tint}, ${(0.22 + d * 0.55) * alpha})`;
      ctx.lineWidth = 1.5 + d * 2.4;
      ctx.beginPath();
      ctx.moveTo(bone.a[0], bone.a[1]);
      ctx.lineTo(bone.b[0], bone.b[1]);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    if (alpha < 0.9) return;

    for (const k in P) {
      if (k === 'head') continue;
      const q = P[k], d = Math.min(1, 3.4 / q[2]);
      ctx.fillStyle = `rgba(8, 12, 16, ${0.85 * d})`;
      ctx.strokeStyle = `rgba(${tint}, ${0.45 + d * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(q[0], q[1], 2 + d * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const hd = P.head, hdd = Math.min(1, 3.4 / hd[2]);
    ctx.fillStyle = 'rgba(8, 12, 16, .9)';
    ctx.strokeStyle = `rgba(${tint}, ${0.5 + hdd * 0.45})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = `rgba(${tint}, .5)`;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(hd[0], hd[1], 7 + hdd * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  let cycleT = 2.1;        // walk-cycle phase (advances with the style's speed)
  let last = 0;

  const draw = time => {
    const dt = last ? Math.min(60, time - last) : 16;
    last = time;

    if (!reduce) {
      step(dt);
      /* ease params toward the target (exponential smoothing ~ MORPH ms) */
      const k = 1 - Math.exp(-dt / (MORPH * 0.32));
      for (const key of KEYS) cur[key] += (target[key] - cur[key]) * k;
      for (let i = 0; i < 3; i++) tintCur[i] += (tintTarget[i] - tintCur[i]) * k;
      cycleT += dt * 0.0032 * cur.speed;
    }

    ctx.clearRect(0, 0, W, H);

    /* mechanical styles quantise time -> stepped, robotic motion */
    const QSTEP = 0.42;
    const quantT = Math.round(cycleT / QSTEP) * QSTEP;
    const t = reduce ? 2.1 : cycleT + (quantT - cycleT) * Math.min(1, Math.max(0, cur.quant));

    const yaw = cam.yaw + (reduce ? 0 : Math.sin(time * 0.00012) * 0.34) + mx * 0.45;
    const pitch = cam.pitch + my * 0.18;

    /* floor grid */
    ctx.lineWidth = 1;
    const G = 5, STEP = 0.5;
    for (let i = -G; i <= G; i++) {
      const lines = [
        [[i * STEP, 0, -G * STEP], [i * STEP, 0, G * STEP]],
        [[-G * STEP, 0, i * STEP], [G * STEP, 0, i * STEP]],
      ];
      for (const line of lines) {
        const a = project(line[0], yaw, pitch);
        const b = project(line[1], yaw, pitch);
        if (a[2] <= 0.5 || b[2] <= 0.5) continue;
        const fade = Math.max(0, 0.5 - Math.abs(i) / (G * 2.4));
        ctx.strokeStyle = `rgba(${ACC2}, ${fade * 0.3})`;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    }

    /* particles */
    for (const p of parts) {
      if (!reduce) { p.y += p.v; if (p.y > 2.5) p.y = -0.1; }
      const q = project([p.x, p.y, p.z], yaw, pitch);
      if (q[2] <= 0.5) continue;
      const d = Math.min(1, 3.2 / q[2]);
      ctx.fillStyle = `rgba(${rgb(tintCur)}, ${p.o * d * 0.34})`;
      ctx.beginPath();
      ctx.arc(q[0], q[1], p.r * d, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ground contact shadow */
    const g = project([0, 0, 0.1], yaw, pitch);
    ctx.fillStyle = `rgba(${rgb(tintCur)}, .07)`;
    ctx.beginPath();
    ctx.ellipse(g[0], g[1], 52 * (g[3] / 120), 13 * (g[3] / 120), 0, 0, Math.PI * 2);
    ctx.fill();

    /* motion trail: past frames of the same generated cycle */
    if (!reduce) {
      drawFigure(t - 0.30, yaw, pitch, 0.16, false);
      drawFigure(t - 0.15, yaw, pitch, 0.30, false);
    }
    drawFigure(t, yaw, pitch, 1, true);
  };

  setTarget(0);
  if (hud) hud.dataset.state = 'input';

  if (reduce) {
    draw(0);
    window.addEventListener('resize', () => draw(0));
  } else {
    const loop = time => { draw(time); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
})();
