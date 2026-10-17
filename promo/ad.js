// Wizard's Chess promo recorder: runs inside the game page, scripts a game, composites motion graphics
// over the WebGL canvas at 1080x1080 and records it with MediaRecorder, then uploads the file.
(async function () {
    const W = 1080, H = 1080, FPS = 30;
    const GOLD = '#e5c158', LAV = '#d0bcff', WHITE = '#f3eff7', INK = '#0d0d14';
    const log = window.__adLog = { state: 'starting', events: [], errors: [] };

    // ---------------------------------------------------------------- timeline (seconds)
    const LINE = [
        { from: 'e2', to: 'e4', at: 4.00 }, { from: 'e7', to: 'e5', at: 4.85 },
        { from: 'g1', to: 'f3', at: 5.70 }, { from: 'd7', to: 'd6', at: 6.55 },
        { from: 'f1', to: 'c4', at: 7.40 }, { from: 'c8', to: 'g4', at: 8.25 },
        { from: 'b1', to: 'c3', at: 9.10 }, { from: 'g7', to: 'g6', at: 9.95 },
        { from: 'f3', to: 'e5', at: 11.30, capture: true },
        { from: 'g4', to: 'd1', at: 12.70, capture: true },
        { from: 'c4', to: 'f7', at: 14.10, capture: true },
        { from: 'e8', to: 'e7', at: 15.60 },
        { from: 'c3', to: 'd5', at: 16.70, mate: true }
    ];
    const T = {
        intro: [0.3, 4.0], play: 4.0, cap1: [4.0, 10.6], cap2: [11.0, 13.6], cap3: [13.6, 16.2],
        mate: 17.3, mateEnd: 20.3, features: 20.3, featuresEnd: 27.0, outro: 27.0, fadeOut: 30.6, total: 31.4
    };
    // Camera choreography. Each keyframe: time, orbit angles, distance and the point the camera looks at.
    // A keyframe marked `cut` snaps into place at its time (hard cut) instead of easing from the previous one.
    const sq = s => { const p = squareToWorld(s); return [p.x, 0.5, p.z]; };
    const CENTRE = [0, 0.6, 0];
    const CAMERA = [
        { t: 0.0, th: -1.30, ph: 0.55, r: 34.0, f: CENTRE },               // high, wide cathedral shot
        { t: 2.2, th: -0.70, ph: 0.85, r: 24.0, f: CENTRE },
        { t: 4.0, th: -0.35, ph: 0.95, r: 17.0, f: CENTRE },               // settled for the opening
        { t: 6.5, th: 0.00, ph: 0.90, r: 14.5, f: [0.8, 0.6, 1.5] },       // push in toward the white side
        { t: 9.0, th: 0.35, ph: 1.00, r: 19.0, f: CENTRE },                // pull back out
        { t: 11.1, th: 0.50, ph: 0.92, r: 17.5, f: CENTRE },
        { t: 11.25, th: 0.90, ph: 1.12, r: 9.0, f: sq('e5'), cut: true },  // close-up: knight takes e5
        { t: 12.6, th: 1.05, ph: 1.08, r: 10.5, f: sq('e5') },
        { t: 12.65, th: -0.60, ph: 1.10, r: 9.5, f: sq('d1'), cut: true }, // close-up: bishop takes the queen
        { t: 14.0, th: -0.40, ph: 1.05, r: 11.0, f: sq('d1') },
        { t: 14.05, th: 2.60, ph: 1.05, r: 10.0, f: sq('f7'), cut: true }, // close-up from behind black: Bxf7+
        { t: 15.5, th: 2.40, ph: 1.00, r: 12.0, f: sq('f7') },
        { t: 15.55, th: 0.40, ph: 0.95, r: 18.0, f: CENTRE, cut: true },   // wide for the king's escape
        { t: 16.6, th: 0.50, ph: 1.00, r: 16.0, f: [0.4, 0.5, -2.0] },
        { t: 17.3, th: 0.75, ph: 1.10, r: 12.0, f: [0.8, 0.6, -2.4] },     // low on the mated king
        { t: 20.3, th: 0.95, ph: 1.05, r: 10.5, f: [0.8, 0.6, -2.4] },
        { t: 20.35, th: 2.20, ph: 0.80, r: 26.0, f: CENTRE, cut: true },   // slow wide orbit behind the cards
        { t: 31.4, th: 3.40, ph: 0.90, r: 20.0, f: CENTRE }
    ];
    const CUT_TIMES = CAMERA.filter(k => k.cut).map(k => k.t);
    const CAPTURE_IMPACT = 0.568; // seconds after a capture move starts, when the game spawns the shatter
    const MOVE_DURATION = 0.52;

    // ---------------------------------------------------------------- helpers
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
    const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
    const easeOutBack = t => { t = clamp(t, 0, 1); const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
    const span = (t, a, b, fi = 0.4, fo = 0.4) => (t < a || t > b) ? 0 : Math.min(easeOut((t - a) / fi), easeOut((b - t) / fo), 1);

    function cameraAt(t) {
        let i = 0;
        while (i < CAMERA.length - 2 && t >= CAMERA[i + 1].t) i++;
        const a = CAMERA[i], b = CAMERA[i + 1];
        if (b.cut && t < b.t) return a;
        const p = smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
        const mix = (u, v) => u + (v - u) * p;
        return { th: mix(a.th, b.th), ph: mix(a.ph, b.ph), r: mix(a.r, b.r), f: [mix(a.f[0], b.f[0]), mix(a.f[1], b.f[1]), mix(a.f[2], b.f[2])] };
    }

    // The game orbits the camera around the board centre and looks at (0, 0.6, 0). Shift that orbit onto the
    // current focus point so close-ups can frame a single square.
    const focus = new THREE.Vector3(0, 0.6, 0);
    const originalLookAt = camera.lookAt.bind(camera);
    camera.lookAt = function () {
        camera.position.x += focus.x; camera.position.y += focus.y - 0.6; camera.position.z += focus.z;
        originalLookAt(focus.x, focus.y, focus.z);
    };

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });

    function goldGradient(y, size) {
        const g = ctx.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
        g.addColorStop(0, '#fff1c2'); g.addColorStop(0.45, '#e5c158'); g.addColorStop(1, '#b4892a');
        return g;
    }

    function text(str, x, y, o) {
        ctx.save();
        ctx.globalAlpha = o.alpha ?? 1;
        ctx.font = o.font;
        ctx.fillStyle = o.color || WHITE;
        ctx.textAlign = o.align || 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = o.spacing || '0px';
        if (o.glow) { ctx.shadowColor = o.glowColor || o.color || GOLD; ctx.shadowBlur = o.glow; }
        ctx.fillText(str, x, y);
        ctx.restore();
    }

    // Frosted glass: blurs what is already on the canvas under the panel, tints it, gradient edge
    function frosted(x, y, w, h, r, alpha, goldEdge = false) {
        ctx.save();
        ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
        ctx.filter = 'blur(18px)';
        ctx.drawImage(canvas, x - 30, y - 30, w + 60, h + 60, x - 30, y - 30, w + 60, h + 60);
        ctx.filter = 'none';
        ctx.fillStyle = `rgba(10,10,18,${0.5 * alpha})`; ctx.fillRect(x, y, w, h);
        const sheen = ctx.createLinearGradient(x, y, x, y + h);
        sheen.addColorStop(0, `rgba(255,255,255,${0.09 * alpha})`); sheen.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen; ctx.fillRect(x, y, w, h);
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, r);
        const edge = ctx.createLinearGradient(x, y, x + w, y + h);
        if (goldEdge) { edge.addColorStop(0, 'rgba(229,193,88,0.9)'); edge.addColorStop(0.5, 'rgba(229,193,88,0.35)'); edge.addColorStop(1, 'rgba(229,193,88,0.9)'); }
        else { edge.addColorStop(0, 'rgba(255,255,255,0.45)'); edge.addColorStop(0.5, 'rgba(255,255,255,0.08)'); edge.addColorStop(1, 'rgba(208,188,255,0.45)'); }
        ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
    }

    // Gradient rule that fades out at both ends
    function gline(x1, x2, y, alpha, color = '229,193,88') {
        ctx.save(); ctx.globalAlpha = alpha;
        const g = ctx.createLinearGradient(x1, 0, x2, 0);
        g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(0.5, `rgba(${color},0.95)`); g.addColorStop(1, `rgba(${color},0)`);
        ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.shadowColor = `rgba(${color},0.8)`; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.restore();
    }

    function diamond(x, y, s, color, alpha) {
        ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore();
    }

    function checkIcon(x, y, alpha) {
        ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.shadowColor = GOLD; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x - 2, y + 5); ctx.lineTo(x + 8, y - 6); ctx.stroke();
        ctx.restore();
    }

    // Vertical light sweep used as a transition between sections
    function sweep(t, t0, dur, color) {
        const p = (t - t0) / dur;
        if (p < 0 || p > 1) return;
        const y = -200 + (H + 400) * p;
        const g = ctx.createLinearGradient(0, y - 170, 0, y + 170);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, color); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, y - 170, W, 340);
    }

    // ---------------------------------------------------------------- assets & fonts
    const avatar = new Image();
    avatar.crossOrigin = 'anonymous';
    await new Promise((res, rej) => { avatar.onload = res; avatar.onerror = () => rej(new Error('avatar failed to load')); avatar.src = 'http://127.0.0.1:8766/avatar.jpg?' + Date.now(); });
    if (!document.getElementById('ad-font')) {
        const link = document.createElement('link'); link.id = 'ad-font'; link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap';
        document.head.appendChild(link);
        await new Promise(r => { link.onload = r; link.onerror = r; setTimeout(r, 4000); });
    }
    await Promise.all(['900 96px Montserrat', '800 60px Montserrat', '700 38px Inter', '600 38px Inter', '500 34px Inter', '700 26px Inter'].map(f => document.fonts.load(f).catch(() => null)));
    const HEAD = document.fonts.check('900 96px Montserrat') ? 'Montserrat' : 'Inter';
    log.headlineFont = HEAD;

    // Two-tone wordmark: "WIZARD'S" in white, "CHESS" in gradient gold, optional light sweep across the letters
    function wordmark(x, y, size, alpha, shine = -1, weight = 900) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `${weight} ${size}px ${HEAD}`;
        ctx.letterSpacing = `${Math.round(size * 0.02)}px`;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const a = "WIZARD'S ", b = 'CHESS';
        const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width;
        const x0 = x - (wa + wb) / 2;
        ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = size * 0.25; ctx.shadowOffsetY = size * 0.05;
        ctx.fillStyle = WHITE; ctx.fillText(a, x0, y);
        ctx.shadowColor = 'rgba(229,193,88,0.5)'; ctx.shadowOffsetY = 0; ctx.shadowBlur = size * 0.35;
        ctx.fillStyle = goldGradient(y, size); ctx.fillText(b, x0 + wa, y);
        if (shine >= 0 && shine <= 1) {
            ctx.shadowBlur = 0;
            const sx = x0 - 250 + (wa + wb + 500) * shine;
            const g = ctx.createLinearGradient(sx - 120, 0, sx + 120, 0);
            g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g; ctx.fillText(a, x0, y); ctx.fillText(b, x0 + wa, y);
        }
        ctx.restore();
    }

    // ---------------------------------------------------------------- particles (ambient dust + checkmate burst)
    const particles = [];
    function spawn(anywhere) {
        return { x: Math.random() * W, y: anywhere ? Math.random() * H : H + 12, vx: (Math.random() - 0.5) * 14, vy: -10 - Math.random() * 22, r: 1.4 + Math.random() * 2.4, gold: Math.random() < 0.6, ph: Math.random() * 6.28 };
    }
    for (let i = 0; i < 52; i++) particles.push(spawn(true));
    const burst = [];
    function spawnBurst(n) {
        for (let i = 0; i < n; i++) {
            const an = Math.random() * Math.PI * 2, sp = 180 + Math.random() * 520;
            burst.push({ x: W / 2, y: H / 2, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, r: 2 + Math.random() * 3.5, gold: Math.random() < 0.7, life: 1 });
        }
    }
    function drawParticles(t, dt, dim) {
        ctx.save();
        for (const p of particles) {
            p.x += (p.vx + Math.sin(t * 0.8 + p.ph) * 9) * dt; p.y += p.vy * dt;
            if (p.y < -12 || p.x < -12 || p.x > W + 12) Object.assign(p, spawn(false));
            const a = (0.18 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2.3 + p.ph))) * dim;
            ctx.globalAlpha = a; ctx.fillStyle = p.gold ? GOLD : LAV; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
        for (let i = burst.length - 1; i >= 0; i--) {
            const p = burst[i];
            p.life -= dt / 1.3; if (p.life <= 0) { burst.splice(i, 1); continue; }
            p.vx *= 0.96; p.vy = p.vy * 0.96 + 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
            ctx.globalAlpha = p.life; ctx.fillStyle = p.gold ? GOLD : WHITE; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life + 0.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    // ---------------------------------------------------------------- game state
    resetSanctuaryGame();
    if (playAgainstAI) modeBtn.click();
    audioFX.enabled = false;
    document.getElementById('sound-icon').textContent = 'volume_off';
    const src = renderer.domElement;
    const side = Math.min(src.width, src.height);
    const sx = (src.width - side) / 2, sy = (src.height - side) / 2;

    const impacts = [];
    let mateAt = null;
    let nextMove = 0;
    let burstDone = false;

    function scheduler(t) {
        if (nextMove >= LINE.length) return;
        const m = LINE[nextMove];
        if (t < m.at) return;
        if (isAnimatingAction) return;
        const before = game.history().length;
        handleSquareClick(m.from);
        handleSquareClick(m.to);
        if (game.history().length === before) { log.errors.push('move failed ' + m.from + m.to + ' at ' + t.toFixed(2)); nextMove++; return; }
        const san = game.history().slice(-1)[0];
        log.events.push({ name: 'move', san, t: +t.toFixed(3), planned: m.at });
        if (m.capture) { const ti = t + CAPTURE_IMPACT; impacts.push({ t: ti, kind: 'shatter' }); log.events.push({ name: 'impact', san, t: +ti.toFixed(3) }); }
        if (m.mate) { mateAt = t + MOVE_DURATION; impacts.push({ t: mateAt, kind: 'mate' }); log.events.push({ name: 'mate', t: +mateAt.toFixed(3) }); }
        nextMove++;
    }

    // ---------------------------------------------------------------- compositing
    function drawScene(t) {
        let scale = 1, shake = 0, flash = 0, red = 0;
        for (const im of impacts) {
            const d = t - im.t;
            if (d < 0) continue;
            if (im.kind === 'shatter' && d < 0.35) { scale = Math.max(scale, 1 + 0.045 * (1 - d / 0.35)); flash = Math.max(flash, 0.35 * (1 - d / 0.25)); shake = Math.max(shake, 7 * (1 - d / 0.35)); }
            if (im.kind === 'mate' && d < 0.6) { scale = Math.max(scale, 1 + 0.07 * (1 - d / 0.6)); red = Math.max(red, 0.45 * (1 - d / 0.5)); shake = Math.max(shake, 16 * (1 - d / 0.6)); if (!burstDone) { burstDone = true; spawnBurst(70); } }
        }
        for (const c of CUT_TIMES) { const d = t - c; if (d >= 0 && d < 0.18) flash = Math.max(flash, 0.22 * (1 - d / 0.18)); }
        const ox = (Math.random() - 0.5) * 2 * shake, oy = (Math.random() - 0.5) * 2 * shake;
        const dw = W * scale, dh = H * scale;
        ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(src, sx, sy, side, side, (W - dw) / 2 + ox, (H - dh) / 2 + oy, dw, dh);
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${clamp(flash, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
        if (red > 0) { ctx.fillStyle = `rgba(239,68,68,${clamp(red, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
    }

    function drawIntro(t) {
        const [a, b] = T.intro;
        const k = span(t, a, b, 0.9, 0.6);
        if (k <= 0) return;
        ctx.fillStyle = `rgba(8,8,14,${0.35 * k})`; ctx.fillRect(0, 0, W, H);
        const grow = 0.96 + 0.04 * easeOut((t - a) / 0.9);
        const cw = 900 * grow, ch = 270 * grow;
        frosted(W / 2 - cw / 2, 525 - ch / 2, cw, ch, 30, k);
        gline(W / 2 - 200, W / 2 + 200, 525 - ch / 2 + 1, k);
        const eyeK = Math.min(easeOut((t - a) / 0.6), k);
        text('•  3D CHESS  •', W / 2, 440, { font: '700 22px Inter', color: LAV, alpha: eyeK, spacing: '7px' });
        const titleK = Math.min(easeOut((t - a - 0.15) / 0.8), k);
        const rise = (1 - easeOut((t - a - 0.15) / 0.8)) * 26;
        if (titleK > 0) wordmark(W / 2, 515 + rise, 92, titleK, (t - a - 1.0) / 0.9);
        const subK = Math.min(easeOut((t - a - 0.8) / 0.7), k);
        if (subK > 0) text('A 3D chess game set in a gothic cathedral', W / 2, 602, { font: '500 32px Inter', color: 'rgba(255,255,255,0.85)', alpha: subK, spacing: '1px' });
    }

    function lowerThird(str, t, a, b) {
        const k = span(t, a, b, 0.35, 0.3);
        if (k <= 0) return;
        ctx.save();
        ctx.font = '600 38px Inter';
        const w = ctx.measureText(str).width + 104;
        const x = 60 - (1 - easeOutBack((t - a) / 0.5)) * 60;
        frosted(x, 928, w, 86, 22, k);
        ctx.save(); ctx.globalAlpha = k;
        const bar = ctx.createLinearGradient(0, 944, 0, 998); bar.addColorStop(0, GOLD); bar.addColorStop(1, LAV);
        ctx.fillStyle = bar; ctx.shadowColor = GOLD; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.roundRect(x + 18, 944, 6, 54, 3); ctx.fill(); ctx.restore();
        text(str, x + 48, 972, { font: '600 38px Inter', color: WHITE, align: 'left', alpha: k });
        ctx.restore();
    }

    function drawPlayHud(t) {
        const k = span(t, T.play, T.mate - 0.2, 0.6, 0.4);
        if (k <= 0) return;
        frosted(48, 44, 372, 60, 30, k);
        ctx.save(); ctx.globalAlpha = k; ctx.fillStyle = LAV; ctx.shadowColor = LAV; ctx.shadowBlur = 14 + 6 * Math.sin(t * 5);
        ctx.beginPath(); ctx.arc(80, 74, 7, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        text("WIZARD'S CHESS", 104, 75, { font: '700 24px Inter', color: WHITE, align: 'left', alpha: k, spacing: '4px' });
        frosted(W - 48 - 290, 44, 290, 60, 30, k, true);
        text('ACTUAL GAMEPLAY', W - 48 - 145, 75, { font: '700 20px Inter', color: GOLD, alpha: k, spacing: '3px' });
        lowerThird('Command living marble & obsidian', t, T.cap1[0], T.cap1[1]);
        lowerThird('Every capture is a battle', t, T.cap2[0], T.cap2[1]);
        lowerThird('Pieces shatter into shards', t, T.cap3[0], T.cap3[1]);
    }

    function drawMate(t) {
        const k = span(t, T.mate, T.mateEnd, 0.25, 0.35);
        if (k <= 0) return;
        const p = clamp((t - T.mate) / 0.55, 0, 1);
        const s = 1.9 - 0.9 * easeOutBack(p);
        const flare = clamp(1 - (t - T.mate) / 0.9, 0, 1);
        if (flare > 0) {
            const f = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 640);
            f.addColorStop(0, `rgba(255,236,170,${0.55 * flare})`); f.addColorStop(0.4, `rgba(229,193,88,${0.25 * flare})`); f.addColorStop(1, 'rgba(229,193,88,0)');
            ctx.fillStyle = f; ctx.fillRect(0, 0, W, H);
        }
        const g = ctx.createLinearGradient(0, H / 2 - 240, 0, H / 2 + 200);
        g.addColorStop(0, 'rgba(8,8,14,0)'); g.addColorStop(0.25, `rgba(8,8,14,${0.8 * k})`);
        g.addColorStop(0.75, `rgba(8,8,14,${0.8 * k})`); g.addColorStop(1, 'rgba(8,8,14,0)');
        ctx.fillStyle = g; ctx.fillRect(0, H / 2 - 240, W, 440);
        gline(W / 2 - 420, W / 2 + 420, H / 2 - 128, k);
        gline(W / 2 - 420, W / 2 + 420, H / 2 + 68, k);
        ctx.save(); ctx.translate(W / 2, H / 2 - 20); ctx.scale(s, s); ctx.globalAlpha = k;
        ctx.font = `900 128px ${HEAD}`; ctx.letterSpacing = '3px'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 10; ctx.fillStyle = goldGradient(0, 128); ctx.fillText('CHECKMATE', 0, 0);
        ctx.shadowColor = 'rgba(229,193,88,0.7)'; ctx.shadowBlur = 70; ctx.shadowOffsetY = 0; ctx.fillText('CHECKMATE', 0, 0);
        ctx.restore();
        const subK = Math.min(easeOut((t - T.mate - 0.5) / 0.5), k);
        if (subK > 0) text("LÉGAL'S MATE  •  7 MOVES", W / 2, H / 2 + 108, { font: '700 26px Inter', color: LAV, alpha: subK, spacing: '7px' });
    }

    function drawFeatures(t) {
        const k = span(t, T.features, T.featuresEnd, 0.5, 0.4);
        if (k <= 0) return;
        ctx.fillStyle = `rgba(8,8,14,${0.72 * k})`; ctx.fillRect(0, 0, W, H);
        wordmark(W / 2, 250, 66, k, (t - T.features - 0.6) / 0.9);
        gline(W / 2 - 220, W / 2 + 220, 312, k);
        const rows = ['Full chess rules, every move validated', 'Archmage AI opponent', 'Pass & play for two', 'Runs in any modern browser'];
        // All chips share one width, sized to the longest line so no text can run past the rounded end
        ctx.font = '500 36px Inter'; ctx.letterSpacing = '0px';
        const chipW = Math.max(...rows.map(r => ctx.measureText(r).width)) + 130;
        const chipX = (W - chipW) / 2;
        rows.forEach((r, i) => {
            const rk = Math.min(easeOut((t - T.features - 0.5 - i * 0.22) / 0.45), k);
            if (rk <= 0) return;
            const dx = (1 - easeOutBack(rk)) * 70;
            const y = 470 + i * 94;
            frosted(chipX + dx, y - 38, chipW, 76, 38, rk);
            checkIcon(chipX + 48 + dx, y, rk);
            text(r, chipX + 86 + dx, y, { font: '500 36px Inter', color: WHITE, align: 'left', alpha: rk });
        });
    }

    function drawOutro(t) {
        const k = span(t, T.outro, T.total + 1, 0.5, 0.1);
        if (k <= 0) return;
        ctx.fillStyle = `rgba(8,8,14,${0.8 * k})`; ctx.fillRect(0, 0, W, H);
        const cx = W / 2, cy = 420, r = 150;
        const ck = Math.min(easeOut((t - T.outro - 0.4) / 0.6), k);
        if (ck > 0) frosted(240, 600, 600, 250, 30, ck);
        const s = 0.6 + 0.4 * easeOutBack((t - T.outro) / 0.7);
        ctx.save(); ctx.globalAlpha = k; ctx.translate(cx, cy); ctx.scale(s, s);
        ctx.shadowColor = 'rgba(208,188,255,0.9)'; ctx.shadowBlur = 50;
        ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(208,188,255,0.25)'; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(avatar, -r, -r, r * 2, r * 2); ctx.restore();
        ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.strokeStyle = goldGradient(0, r * 2); ctx.lineWidth = 6; ctx.stroke();
        const sw = clamp((t - T.outro - 0.2) / 1.2, 0, 1);
        if (sw > 0) { ctx.beginPath(); ctx.arc(0, 0, r + 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * easeOut(sw)); ctx.strokeStyle = LAV; ctx.lineWidth = 4; ctx.shadowColor = LAV; ctx.shadowBlur = 18; ctx.stroke(); }
        ctx.restore();
        const k1 = Math.min(easeOut((t - T.outro - 0.5) / 0.5), k);
        if (k1 > 0) text('CREATED BY', cx, 650, { font: '700 22px Inter', color: LAV, alpha: k1, spacing: '7px' });
        const k2 = Math.min(easeOut((t - T.outro - 0.65) / 0.6), k);
        if (k2 > 0) text('Zain Ul Abideen', cx, 718 + (1 - k2) * 24, { font: `800 60px ${HEAD}`, color: WHITE, glow: 26, glowColor: 'rgba(229,193,88,0.6)', alpha: k2, spacing: '1px' });
        const k3 = Math.min(easeOut((t - T.outro - 1.0) / 0.5), k);
        if (k3 > 0) text('github.com/zainulabdn', cx, 782, { font: '500 28px Inter', color: 'rgba(255,255,255,0.75)', alpha: k3, spacing: '1px' });
        const k4 = Math.min(easeOut((t - T.outro - 1.2) / 0.8), k);
        if (k4 > 0) gline(cx - 150 * k4, cx + 150 * k4, 822, k4);
        const k5 = Math.min(easeOut((t - T.outro - 1.6) / 0.5), k);
        if (k5 > 0) text("WIZARD'S CHESS", cx, 900, { font: '700 22px Inter', color: GOLD, glow: 12, alpha: k5, spacing: '7px' });
    }

    let lastT = 0;
    function draw(t) {
        const dt = clamp(t - lastT, 0, 0.05); lastT = t;
        drawScene(t);
        const dim = t > T.features ? 0.7 : 1;
        drawParticles(t, dt, dim);
        drawIntro(t); drawPlayHud(t); drawMate(t); drawFeatures(t); drawOutro(t);
        sweep(t, T.features, 0.5, 'rgba(255,255,255,0.32)');
        sweep(t, T.outro, 0.5, 'rgba(229,193,88,0.28)');
        const fadeIn = clamp(t / 0.6, 0, 1), fadeOut = clamp((T.total - t) / (T.total - T.fadeOut), 0, 1);
        const black = 1 - Math.min(fadeIn, fadeOut);
        if (black > 0) { ctx.fillStyle = `rgba(0,0,0,${black})`; ctx.fillRect(0, 0, W, H); }
    }

    // ---------------------------------------------------------------- recording
    const mime = ['video/mp4;codecs=avc1.640028', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const stream = canvas.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 24e6 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
        const blob = new Blob(chunks, { type: mime });
        log.bytes = blob.size; log.file = 'wizards_chess_ad_raw.' + ext; log.state = 'uploading';
        window.__adBlob = blob;
        try {
            // text/plain keeps this a "simple" CORS request (no preflight); the server just stores the bytes
            const r = await fetch('http://127.0.0.1:8766/upload/' + log.file, { method: 'POST', body: new Blob([blob], { type: 'text/plain' }) });
            log.upload = await r.text(); log.state = 'done';
        } catch (e) {
            log.errors.push('upload failed: ' + e); log.state = 'error';
        }
    };
    log.mime = mime;

    function applyCamera(c) {
        camState.theta = camState.targetTheta = c.th; camState.phi = camState.targetPhi = c.ph; camState.radius = camState.targetRadius = c.r;
        focus.set(c.f[0], c.f[1], c.f[2]);
    }
    applyCamera(cameraAt(0));
    await new Promise(r => setTimeout(r, 200));
    draw(0);

    let lastFrame = -1, frames = 0;
    const t0 = performance.now();
    rec.start(250);
    log.state = 'recording';

    function tick(now) {
        try {
            const t = (now - t0) / 1000;
            applyCamera(cameraAt(t));
            scheduler(t);
            if (renderer.info.render.frame === lastFrame) renderer.render(scene, camera);
            lastFrame = renderer.info.render.frame;
            draw(t);
            frames++;
            log.t = +t.toFixed(2); log.frames = frames;
            if (t < T.total) { requestAnimationFrame(tick); return; }
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
            log.wallDuration = +((performance.now() - t0) / 1000).toFixed(3);
            setTimeout(() => rec.stop(), 400);
        } catch (e) {
            log.errors.push(String(e)); log.state = 'error';
            try { rec.stop(); } catch (_) { /* already stopped */ }
        }
    }
    requestAnimationFrame(tick);
})().catch(e => { window.__adLog = Object.assign(window.__adLog || {}, { state: 'error', errors: [String(e)] }); });
