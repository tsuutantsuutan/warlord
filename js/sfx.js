// =====================================================================
// 音：すべて Web Audio で合成（音声ファイルなし）
// ・立体音響（左右・距離で小さく）＋遠い音ほど高音が削れ、音速(343m/s)で遅れて届く
// ・屋外の残響（短いこだま）を全体に薄くかける
// ・金属は「非整数倍の倍音」を重ねて鳴らす（剣同士=高く長く響く、鎧=鈍いガチャ、盾=木のゴツ）
// ・戦場の環境音：風、遠くの喚声、近くの斬り合いのざわめき、行軍の地鳴り
// =====================================================================
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const R = (a, b) => a + Math.random() * (b - a);
const MAX_VOICES = 48;

export const SFX = {
  ctx: null, last: {}, voices: 0, battle: [], cam: null, stepAcc: 0, clatT: 0, amT: 0,
  init() {
    if (this.ctx) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext, c = this.ctx = new C();
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25; comp.connect(c.destination);
      this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(comp);
      this.bus = c.createGain(); this.bus.connect(this.master);
      const rev = c.createConvolver(); rev.buffer = this.makeIR(2.4); const wet = c.createGain(); wet.gain.value = 0.28; rev.connect(wet).connect(this.master);
      this.send = c.createGain(); this.send.gain.value = 1; this.send.connect(rev);
      this.white = this.noise(2, 'white'); this.brown = this.noise(4, 'brown'); this.pink = this.noise(3, 'pink');
      // 環境音（ずっと鳴らして音量だけ動かす）
      const loop = (buf, ...nodes) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); let n = s; for (const x of nodes) n = n.connect(x); s.start(0, Math.random() * buf.duration); return nodes[nodes.length - 1]; };
      const lp = (f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; return b; };
      const bp = (f, q) => { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; return b; };
      const gain = v => { const g = c.createGain(); g.gain.value = v; return g; };
      // 風：低いうなり＋ときどき強くなる
      this.windF = lp(380); this.windG = gain(0.05); loop(this.brown, this.windF, this.windG).connect(this.bus);
      // 遠くの喚声：大勢の声のかたまり（母音の響きの帯域を3つ重ねる）
      this.roarG = gain(0); const roarIn = c.createGain();
      this.roarF = [[420, 4], [880, 5], [2300, 6]].map(([f, q], i) => { const b = bp(f, q), g = gain([1, 0.7, 0.3][i]); roarIn.connect(b).connect(g).connect(this.roarG); return g; });
      loop(this.pink, gain(1.4)).connect(roarIn); this.roarG.connect(this.bus); this.roarG.connect(this.send);
      // さらに遠くの戦の響き（こもった地鳴り）
      this.farG = gain(0); loop(this.brown, lp(220), this.farG).connect(this.bus); this.farG.connect(this.send);
      // 行軍・蹄の地鳴り
      this.marchG = gain(0); loop(this.brown, lp(140, 1.2), this.marchG).connect(this.bus);
    } catch (e) { this.ctx = null; }
  },
  noise(sec, kind) {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0); let l = 0, p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1;
      if (kind === 'brown') { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; }
      else if (kind === 'pink') { p0 = 0.997 * p0 + w * 0.029591; p1 = 0.985 * p1 + w * 0.032534; p2 = 0.95 * p2 + w * 0.048056; d[i] = (p0 + p1 + p2 + w * 0.05) * 1.6; }
      else d[i] = w; }
    return b;
  },
  // 屋外の残響：はじめに地面や木からの数回の反射、そのあと薄く伸びる余韻
  makeIR(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) { const t = i / c.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.2) * 0.35 * (t < 0.012 ? t / 0.012 : 1); }
      for (const [t, a] of [[0.021, 0.5], [0.047, 0.35], [0.083, 0.28], [0.13, 0.2], [0.19, 0.12]]) { const i = Math.floor((t + (ch ? 0.004 : 0)) * c.sampleRate); for (let k = 0; k < 40; k++) d[i + k] += a * (1 - k / 40) * (Math.random() > 0.5 ? 1 : -1); } }
    return b;
  },
  can(k, gap) { const t = performance.now(), l = this.last[k]; if (l !== undefined && l + gap > t) return false; this.last[k] = t; return true; },
  dist(x, y, z) { const p = this.cam ? this.cam.position : { x: 0, y: 0, z: 0 }; return Math.hypot(x - p.x, (y ?? p.y) - p.y, z - p.z); },
  // 鳴らす場所につなぐ入口を返す：空気で高音が削れる → 左右と距離 → 残響
  at(x, y, z, wetAmt = 1, roll = 1.15) {
    const c = this.ctx, d = this.dist(x, y, z);
    const air = c.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = clamp(18000 / (1 + d / 18), 900, 18000);
    const pn = c.createPanner(); pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'; pn.refDistance = 4; pn.maxDistance = 500; pn.rolloffFactor = roll;
    if (pn.positionX) { pn.positionX.value = x; pn.positionY.value = y; pn.positionZ.value = z; } else pn.setPosition(x, y, z);
    air.connect(pn); pn.connect(this.bus);
    const sg = c.createGain(); sg.gain.value = clamp(0.25 + d / 120, 0.25, 1.2) * wetAmt; pn.connect(sg).connect(this.send); // 遠いほど残響の割合が増える
    return { node: air, t: c.currentTime + Math.min(d / 343, 0.7) + 0.005, d };
  },
  direct() { return { node: this.bus, t: this.ctx.currentTime + 0.003, d: 0 }; },
  voice(dur) { if (this.voices >= MAX_VOICES) return false; this.voices++; setTimeout(() => this.voices--, (dur + 0.8) * 1000); return true; },
  // ---- 部品 ----
  tone(dst, t, f, type, a, dur, glide) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * glide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dst); o.start(t); o.stop(t + dur + 0.02);
  },
  burst(dst, t, buf, type, f, q, a, dur, att = 0.001, f2) {
    const c = this.ctx, s = c.createBufferSource(), b = c.createBiquadFilter(), g = c.createGain(); s.buffer = buf; b.type = type; b.frequency.setValueAtTime(f, t); if (f2) b.frequency.exponentialRampToValueAtTime(f2, t + dur); b.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(b).connect(g).connect(dst); s.start(t, Math.random() * (buf.duration - dur - 0.05)); s.stop(t + dur + 0.02);
  },
  // 金属：棒や板の振動の倍音（1 : 2.76 : 5.40 : 8.93 …）を少しずらして重ねる
  metal(dst, t, f, a, dur, bright = 1) {
    const P = [[1, 1], [2.76, 0.7], [5.4, 0.45], [8.93, 0.3], [13.3, 0.18 * bright]];
    for (let i = 0; i < P.length; i++) this.tone(dst, t, f * P[i][0] * R(0.985, 1.015), 'sine', a * P[i][1], dur / (1 + i * 0.55));
    this.burst(dst, t, this.white, 'bandpass', 3600 * bright, 1.2, a * 0.5, 0.025);
  },
  // ---- 効果音 ----
  hit(x, y, z, kind, big) {
    if (!this.ctx || !this.can('hit' + kind, kind === 'flesh' ? 35 : 28)) return; const S = this.at(x, y + 1.3, z); if (S.d > 110 || !this.voice(0.8)) return; const n = S.node, t = S.t, k = big ? 1.4 : 1;
    if (kind === 'clang') { this.metal(n, t, R(780, 1350), 0.32 * k, R(0.5, 0.9)); this.burst(n, t, this.white, 'highpass', 2500, 0.7, 0.12 * k, 0.05); } // 刃と刃
    else if (kind === 'clank') { this.metal(n, t, R(330, 560), 0.3 * k, R(0.16, 0.26), 0.6); this.tone(n, t, R(90, 130), 'sine', 0.35 * k, 0.12, 0.6); } // 鎧に当たる鈍い音
    else if (kind === 'wood') { this.tone(n, t, R(150, 210), 'sine', 0.5 * k, 0.14, 0.7); this.tone(n, t, R(380, 470), 'triangle', 0.18 * k, 0.07); this.burst(n, t, this.white, 'lowpass', 1300, 0.8, 0.45 * k, 0.07); } // 木の盾
    else if (kind === 'ting') { this.metal(n, t, R(1800, 2600), 0.15, 0.22); } // 矢が鎧ではじかれる
    else if (kind === 'arrow') { this.burst(n, t, this.white, 'bandpass', 1100, 2, 0.3, 0.05); this.tone(n, t, 210, 'sine', 0.2, 0.06, 0.7); }
    else { this.burst(n, t, this.pink, 'lowpass', 700, 1, 0.55 * k, 0.11, 0.004, 260); this.tone(n, t, R(80, 110), 'sine', 0.45 * k, 0.13, 0.55); } // 肉を斬る・殴る
  },
  // うめき声・叫び：のこぎり波を声の響き（フォルマント）に通す
  grunt(x, y, z, hi) {
    if (!this.ctx || !this.can('grunt', 140)) return; const S = this.at(x, y + 1.6, z); if (S.d > 60 || !this.voice(0.6)) return; const c = this.ctx, t = S.t, f0 = R(95, 150) * (hi ? 1.25 : 1), dur = R(0.22, 0.45);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.15, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g);
    for (const [f, q, a] of [[R(550, 700), 6, 1], [R(1000, 1250), 8, 0.6], [2600, 9, 0.25]]) { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const gg = c.createGain(); gg.gain.value = a * 3.5; g.connect(b).connect(gg).connect(S.node); }
    this.burst(S.node, t, this.white, 'bandpass', 1800, 1, 0.25, dur * 0.8, 0.02); o.start(t); o.stop(t + dur + 0.05);
  },
  // 鬨の声：何十人もの「オォォー！」。声ごとに高さ・始まり・母音をずらす
  warcry(x, z, n) {
    if (!this.ctx || !this.can('cry' + Math.round(x / 30) + Math.round(z / 30), 2500)) return; const S = this.at(x, 1.7, z, 1.3, 0.5); if (S.d > 300) return; const c = this.ctx, voices = clamp(Math.round(n / 3), 6, 16);
    const out = c.createGain(); out.gain.value = clamp(1.6 * Math.sqrt(voices / 6), 1, 2.4); out.connect(S.node); // 鬨の声は遠くまで届く
    for (let i = 0; i < voices; i++) { if (!this.voice(2)) break; const t = S.t + R(0, 0.45), f0 = R(100, 185), dur = R(1.1, 1.8);
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 0.85, t); o.frequency.linearRampToValueAtTime(f0 * 1.12, t + 0.35); o.frequency.linearRampToValueAtTime(f0 * 0.92, t + dur);
      const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = R(4.5, 6.5); vg.gain.value = f0 * 0.025; vib.connect(vg).connect(o.frequency);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.12); g.gain.setValueAtTime(0.35, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g);
      const v = Math.random() < 0.5 ? [[700, 1150, 2600]] : [[560, 900, 2500]]; // 「アー」と「オー」
      for (const [k, f] of v[0].entries()) { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f * R(0.95, 1.05); b.Q.value = 3.5 + k * 1.5; const gg = c.createGain(); gg.gain.value = [0.9, 0.5, 0.2][k]; g.connect(b).connect(gg).connect(out); }
      o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05); }
    this.burst(out, S.t, this.pink, 'bandpass', 900, 0.8, 0.5, 1.6, 0.25); // 息と足音のざわめき
  },
  // 自分の振り：風を切る音（左右に流れる）
  whoosh(heavy) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, pn = c.createStereoPanner(); pn.pan.setValueAtTime(0.5, t); pn.pan.linearRampToValueAtTime(-0.5, t + 0.25); pn.connect(this.bus);
    this.burst(pn, t, this.white, 'bandpass', heavy ? 220 : 380, 1.4, 0.45, heavy ? 0.36 : 0.26, 0.09, heavy ? 1100 : 1900);
    this.burst(pn, t + 0.03, this.pink, 'lowpass', 300, 0.7, 0.3, 0.25, 0.08);
  },
  bow(x, z) { if (!this.ctx || !this.can('bow', 70)) return; const S = this.at(x, 1.5, z); if (S.d > 90 || !this.voice(0.3)) return; this.tone(S.node, S.t, R(85, 110), 'triangle', 0.6, 0.18, 0.8); this.burst(S.node, S.t, this.white, 'bandpass', 2400, 2, 0.4, 0.03); },
  whiz(x, y, z) { if (!this.ctx || !this.can('whiz', 60)) return; const S = this.at(x, y, z, 0.3); if (!this.voice(0.4)) return; this.burst(S.node, S.t, this.white, 'bandpass', 3200, 6, 0.7, 0.28, 0.12, 1500); },
  thunk(x, y, z) { if (!this.ctx || !this.can('thunk', 45)) return; const S = this.at(x, y, z); if (S.d > 45 || !this.voice(0.2)) return; this.burst(S.node, S.t, this.white, 'bandpass', 900, 1.5, 0.22, 0.05); this.tone(S.node, S.t, 140, 'sine', 0.2, 0.07, 0.6); },
  // 蹄：重い打撃＋土を蹴る音
  hoof(x, z, v = 1) { if (!this.ctx || !this.can('hoof', 45)) return; const S = this.at(x, 0.2, z); if (S.d > 80 || !this.voice(0.2)) return; this.tone(S.node, S.t, R(70, 95), 'sine', 0.9 * v, 0.11, 0.5); this.burst(S.node, S.t, this.brown, 'lowpass', 1500, 0.7, 0.9 * v, 0.08); },
  thud(x, z, v = 1) { if (!this.ctx || !this.can('thud', 30)) return; const S = this.at(x, 1, z); if (S.d > 80 || !this.voice(0.2)) return; this.tone(S.node, S.t, 120, 'sine', 0.45 * v, 0.15, 0.4); this.burst(S.node, S.t, this.pink, 'lowpass', 500, 0.7, 0.35 * v, 0.1); },
  // 自分の足音：土を踏む音＋鎧のこすれ
  step(heavy) { if (!this.ctx) return; const D = this.direct(), t = D.t; this.burst(D.node, t, this.brown, 'lowpass', 900, 0.7, 0.16, 0.08); this.burst(D.node, t + 0.01, this.white, 'bandpass', R(5000, 7000), 3, heavy ? 0.06 : 0.035, 0.09, 0.01); if (Math.random() < 0.5) this.metal(D.node, t + 0.02, R(1800, 2600), 0.018, 0.12); },
  // 角笛：金管らしく、吹き始めに音が明るくなり、少し揺れる
  horn() {
    if (!this.ctx) return; const c = this.ctx, t0 = c.currentTime + 0.05, out = c.createGain(); out.gain.value = 0.22; out.connect(this.bus); out.connect(this.send);
    for (const [f, d0, d1] of [[147, 0, 1.1], [220, 1.15, 2.1], [196, 2.15, 3.6]]) {
      const lpf = c.createBiquadFilter(); lpf.type = 'lowpass'; lpf.Q.value = 2; lpf.frequency.setValueAtTime(300, t0 + d0); lpf.frequency.exponentialRampToValueAtTime(1600, t0 + d0 + 0.18); lpf.frequency.setValueAtTime(1600, t0 + d1 - 0.2); lpf.frequency.exponentialRampToValueAtTime(400, t0 + d1);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0 + d0); g.gain.exponentialRampToValueAtTime(0.5, t0 + d0 + 0.08); g.gain.setValueAtTime(0.5, t0 + d1 - 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d1); lpf.connect(g).connect(out);
      const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5; vg.gain.value = f * 0.006;
      for (const det of [0.997, 1, 1.004]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * det; vib.connect(vg).connect(o.frequency); o.connect(lpf); o.start(t0 + d0); o.stop(t0 + d1 + 0.05); }
      vib.start(t0 + d0); vib.stop(t0 + d1 + 0.05); }
  },
  // 太鼓（布陣中のうしろで鳴る）
  drum() { if (!this.ctx) return; const D = this.direct(), t = D.t; this.tone(D.node, t, 62, 'sine', 0.35, 0.45, 0.7); this.burst(D.node, t, this.brown, 'lowpass', 400, 0.8, 0.25, 0.2); },
  // ---- 毎フレーム：聞き手の位置と環境音 ----
  setBattle(list, march, far) { this.battle = list; this.march = march; this.far = far; },
  update(dt, cam, p) {
    if (!this.ctx) return; this.cam = cam; const c = this.ctx, L = c.listener, t = c.currentTime, pos = cam.position, f = cam.getWorldDirection(this._v || (this._v = pos.clone()));
    if (L.positionX) { L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
    // 近くの戦いの量（距離で重み）
    let near = 0, nx = 0, nz = 0; for (const b of this.battle) { const d = Math.hypot(b.x - pos.x, b.z - pos.z), w = b.n * clamp(1 - d / 160, 0, 1) ** 1.5; near += w; nx += b.x * w; nz += b.z * w; }
    this.amT -= dt; if (this.amT <= 0) { this.amT = 0.13; // 声のかたまりを揺らす（大勢がばらばらに叫んでいる感じ）
      for (const g of this.roarF) g.gain.setTargetAtTime(R(0.4, 1.1), t, 0.08);
      this.roarG.gain.setTargetAtTime(clamp(near / 260, 0, 1) * 0.42 * R(0.8, 1.1), t, 0.25);
      this.farG.gain.setTargetAtTime(clamp((this.far || 0) / 700, 0, 1) * 0.5, t, 0.8);
      this.marchG.gain.setTargetAtTime(clamp((this.march || 0) / 300, 0, 1) * 0.45, t, 0.6);
      this.windF.frequency.setTargetAtTime(R(250, 600), t, 1.2); this.windG.gain.setTargetAtTime(R(0.03, 0.09), t, 1.5); }
    // 斬り合いのざわめき：近くの戦いの場所から細かい金属音をばらまく
    this.clatT -= dt * clamp(near / 25, 0, 14); if (this.clatT <= 0 && near > 2) { this.clatT = R(0.6, 1.4); const b = this.pickBattle(pos);
      if (b) { const S = this.at(b.x + R(-6, 6), 1.3, b.z + R(-6, 6), 1.2); if (this.voice(0.4)) { const r = Math.random();
        if (r < 0.55) this.metal(S.node, S.t, R(600, 1600), 0.12, R(0.2, 0.5)); else if (r < 0.8) this.hit2(S); else this.burst(S.node, S.t, this.white, 'bandpass', 1800, 1.5, 0.12, 0.05); } } }
    // 自分の足音
    if (p && p.alive && !p.mounted && (p.spd || 0) > 0.8) { this.stepAcc += p.spd * dt; if (this.stepAcc > (p.spd > 6 ? 2.1 : 1.45)) { this.stepAcc = 0; this.step(p.spd > 6); } }
  },
  hit2(S) { this.tone(S.node, S.t, R(140, 200), 'sine', 0.2, 0.12, 0.7); this.burst(S.node, S.t, this.white, 'lowpass', 1200, 0.8, 0.15, 0.06); },
  pickBattle(pos) { let tot = 0; const w = this.battle.map(b => { const v = b.n * clamp(1 - Math.hypot(b.x - pos.x, b.z - pos.z) / 160, 0, 1) ** 2; tot += v; return v; }); let r = Math.random() * tot; for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return this.battle[i]; } return null; },
  ambient() {},
};
