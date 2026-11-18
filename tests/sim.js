// 人間らしい鼻歌のシミュレータと、採点の道具。
// 以前のテスト用の合成音（音の間に無音・音程が安定・テンポ一定）より、ずっと意地悪にしてある。
'use strict';
const SR = 16000;

function rng(seed) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = () => { let x = 0; while (x === 0) x = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * u()); };
  return { u, g };
}
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// tune: [[midi|null, 拍], ...]
// o: bpm, seed, detune(半音), noteErr(1音ごとの音程誤差σ), drift(録音全体でのずれ幅), jitter(出だしのずれσ・秒),
//    tempoDrift(テンポの揺れ幅), legato(音をつなげる確率), vib(ビブラートの深さ), glide(音の移り変わり・秒), snr(dB), base(移調)
function humanHum(tune, o) {
  o = Object.assign({ bpm: 100, seed: 1, detune: 0, noteErr: 0.2, drift: 0.4, jitter: 0.045, tempoDrift: 0.06, legato: 0.7, vib: 0.35, glide: 0.09, snr: 30, base: -12 }, o);
  const R = rng(o.seed);
  // 1) 各音の開始・終了時刻（テンポはゆっくり揺れる）
  const ev = []; let t = 0.6, tf = 1, beatPos = 0;
  for (const [m, beats] of tune) {
    tf = Math.max(1 - o.tempoDrift, Math.min(1 + o.tempoDrift, tf + R.g() * o.tempoDrift * 0.25));
    const dur = beats * (60 / o.bpm) * tf;
    ev.push({ m, t0: t, t1: t + dur, beats, b0: beatPos }); t += dur; beatPos += beats;
  }
  const total = t + 1.0;
  // 出だしの時刻にばらつきを足す（前の音の終わりも一緒に動く）
  for (let i = 0; i < ev.length; i++) {
    const j = Math.max(-0.12, Math.min(0.12, R.g() * o.jitter));
    ev[i].t0 += j; if (i > 0) ev[i - 1].t1 = ev[i].t0;
  }
  // 2) 音ごとの狙いの高さ（全体のずれ＋だんだんずれる＋音ごとの誤差）
  const driftA = (R.u() - 0.5) * 2 * o.drift, driftB = (R.u() - 0.5) * o.drift * 0.6;
  const notes = ev.filter((e) => e.m != null);
  notes.forEach((e) => {
    const pos = e.t0 / total;
    e.target = e.m + o.base + o.detune + driftA * pos + driftB * Math.sin(pos * 5) + R.g() * o.noteErr;
  });
  // 3) つなげるか、切るか
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i], nx = ev[i + 1];
    e.legatoNext = !!(e.m != null && nx && nx.m != null && R.u() < o.legato);
    if (e.m != null && !e.legatoNext) e.t1 -= Math.min(0.18, (e.t1 - e.t0) * 0.3) * (0.5 + R.u());   // 切るときは少し早めに止める
  }
  // 4) 波形
  const x = new Float32Array(Math.ceil(total * SR));
  let ph = 0, pjit = 0, prevTarget = null, prevEnd = -1;
  const harm = [1, 0.5 + R.u() * 0.2, 0.2 + R.u() * 0.1, 0.1, 0.05, 0.025];
  for (let k = 0; k < ev.length; k++) {
    const e = ev[k]; if (e.m == null) { prevTarget = null; continue; }
    const connected = prevTarget != null && Math.abs(e.t0 - prevEnd) < 1e-6;
    const dur = e.t1 - e.t0, i0 = Math.floor(e.t0 * SR), i1 = Math.min(x.length, Math.floor(e.t1 * SR));
    const vibHz = 5 + R.u() * 1.2, vibD = o.vib * (0.5 + R.u()), scoop = connected ? 0 : -(0.5 + R.u() * 1.2), scoopT = 0.04 + R.u() * 0.05;
    const gl = o.glide * (0.6 + R.u() * 0.8), from = connected ? prevTarget : e.target;
    const same = connected && Math.abs(prevTarget - e.target) < 0.6;
    const dipDepth = connected ? (same ? 0.25 + R.u() * 0.15 : 0.6 + R.u() * 0.25) : 0, dipT = 0.04 + R.u() * 0.03;
    const amp = 0.25 * (0.8 + R.u() * 0.4);
    for (let i = i0; i < i1; i++) {
      const tt = (i - i0) / SR;
      let p = e.target;
      if (connected && tt < gl) p = from + (e.target - from) * (0.5 - 0.5 * Math.cos(Math.PI * tt / gl));
      if (!connected) p += scoop * Math.exp(-tt / scoopT);
      p += vibD * Math.sin(2 * Math.PI * vibHz * tt) * Math.min(1, Math.max(0, (tt - 0.22) / 0.2));
      pjit = pjit * 0.995 + R.g() * 0.006; p += pjit;
      ph += 2 * Math.PI * hz(p) / SR;
      let env = 1;
      if (!connected) env *= Math.min(1, tt / 0.035);
      else env *= 1 - (1 - dipDepth) * Math.exp(-0.5 * Math.pow((tt - 0.01) / dipT, 2));
      if (!e.legatoNext) env *= Math.min(1, (dur - tt) / 0.07);
      let v = 0; for (let h = 0; h < harm.length; h++) v += harm[h] * Math.sin((h + 1) * ph);
      x[i] += amp * env * v;
    }
    prevTarget = e.target; prevEnd = e.legatoNext ? e.t1 : -1;
    if (!e.legatoNext) prevTarget = null;
    // 切れ目で息の音が入ることがある
    if (!e.legatoNext && R.u() < 0.4) {
      const b0 = i1, b1 = Math.min(x.length, b0 + Math.floor((0.08 + R.u() * 0.12) * SR)); let lp = 0;
      for (let i = b0; i < b1; i++) { lp = lp * 0.7 + R.g() * 0.3; x[i] += 0.02 * lp * Math.sin(Math.PI * (i - b0) / (b1 - b0)); }
    }
  }
  // 5) 背景の雑音
  let pw = 0; for (let i = 0; i < x.length; i++) pw += x[i] * x[i];
  const nz = Math.sqrt(pw / x.length) * Math.pow(10, -o.snr / 20); let lp2 = 0;
  for (let i = 0; i < x.length; i++) { lp2 = lp2 * 0.6 + R.g() * 0.4; x[i] += nz * (0.6 * R.g() + 0.8 * lp2); }
  return { x, truth: notes.map((e) => ({ m: e.m, beats: e.beats, t0: e.t0, b0: e.b0 })) };
}

// 並びの違い（編集距離）
function editDistance(a, b) {
  const n = a.length, m = b.length; let prev = new Array(m + 1), cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    const t = prev; prev = cur; cur = t;
  }
  return prev[m];
}
// 移調を許して、メロディの形がどれだけ合っているか（1=完全一致）
function melodyScore(est, truth) {
  let best = { acc: -1, off: 0 };
  for (let off = -30; off <= 30; off++) {
    const acc = 1 - editDistance(est.map((v) => v - off), truth) / truth.length;
    if (acc > best.acc) best = { acc, off };
  }
  return best;
}

const TUNES = {
  きらきら星: { key: [0, false], notes: [[60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],[65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2]] },
  歓喜の歌: { key: [2, false], notes: [[66,1],[66,1],[67,1],[69,1],[69,1],[67,1],[66,1],[64,1],[62,1],[62,1],[64,1],[66,1],[66,1.5],[64,0.5],[64,2]] },
  かえるの歌: { key: [0, false], notes: [[60,1],[62,1],[64,1],[65,1],[64,1],[62,1],[60,1],[null,1],[64,1],[65,1],[67,1],[69,1],[67,1],[65,1],[64,1],[null,1],[60,1],[null,1],[60,1],[null,1],[60,.5],[60,.5],[62,.5],[62,.5],[64,.5],[64,.5],[65,.5],[65,.5],[64,1],[62,1],[60,1]] },
  ふるさと: { key: [5, false], notes: [[65,1],[65,1],[65,1],[67,1.5],[69,.5],[67,1],[69,1],[69,1],[70,1],[72,3],[70,1],[72,1],[69,1],[70,1.5],[69,.5],[67,1],[69,1],[65,1],[64,1],[65,3]] },
  短調のメロディ: { key: [9, true], notes: [[69,.5],[71,.5],[72,1],[71,.5],[69,.5],[68,1],[null,1],[64,.5],[69,.5],[72,.5],[76,.5],[74,.5],[72,.5],[71,1],[69,2],[null,1],[65,.5],[64,.5],[62,1],[64,1],[69,2]] },
};
const LEVELS = {
  ていねい: { noteErr: 0.12, drift: 0.15, jitter: 0.025, tempoDrift: 0.03, legato: 0.6, vib: 0.2, snr: 35 },
  ふつう: { noteErr: 0.2, drift: 0.45, jitter: 0.045, tempoDrift: 0.06, legato: 0.75, vib: 0.35, snr: 30 },
  ラフ: { noteErr: 0.28, drift: 0.8, jitter: 0.07, tempoDrift: 0.1, legato: 0.85, vib: 0.55, snr: 24 },
};

module.exports = { SR, humanHum, editDistance, melodyScore, TUNES, LEVELS };
