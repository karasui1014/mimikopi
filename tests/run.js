// 使い方: node run.js <index.htmlの場所> [回数]
// 人間らしい鼻歌を何通りも作って、採譜の「音の並び」「ドレミ」「リズム」がどれだけ合うかを数える。
'use strict';
const fs = require('fs'), vm = require('vm');
const { SR, humanHum, editDistance, melodyScore, TUNES, LEVELS } = require('./sim.js');

const html = fs.readFileSync(process.argv[2], 'utf8');
const all = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const core = all.slice(0, all.indexOf('状態と、設定から結果を組み立てる処理'));
const cut = core.slice(0, core.lastIndexOf('/* ===')).replace('const $ = (id) => document.getElementById(id);', '');
const ctx = { performance, MessageChannel, setTimeout, console, Float32Array, Float64Array, Uint8Array, Uint32Array, Int16Array, Int32Array, Math, Number, Array, Object, Set, Map, Infinity, NaN };
vm.createContext(ctx);
vm.runInContext(cut + `
;this.api = { analyze, detectKey, snapPitch, makeKey, solfaOf, median,
  estimateTempo: typeof estimateTempo === 'function' ? estimateTempo : null,
  quantizeNotes: typeof quantizeNotes === 'function' ? quantizeNotes : null,
  deriveNotes: typeof deriveNotes === 'function' ? deriveNotes : null };`, ctx);
const A = ctx.api;

// ページの derive() と同じ流れ。ページ側に deriveNotes があればそれを使う（＝新しい仕組み）
function derive(res, fromMic) {
  if (A.deriveNotes) return A.deriveNotes(res.notes, res.tuning, { key: 'auto', bpm: 'auto', meter: 4, grid: fromMic ? 2 : 1, snap: 1, octave: 0, pickup: 0, fill: true, tuneFix: true, driftFix: process.env.DRIFT !== '0', free: process.env.FREE !== '0' });
  const base = res.notes.map((nt) => ({ t0: nt.t0, t1: nt.t1, p: nt.pitch - res.tuning }));
  const cands = A.detectKey(base.map((nt) => ({ p: nt.p, w: Math.min(nt.t1 - nt.t0, 1.5) })));
  const key = cands[0];
  for (const nt of base) { nt.raw = Math.round(nt.p); nt.midi = A.snapPitch(nt.p, key, 1); }
  const tempo = A.estimateTempo(base.map((nt) => nt.t0));
  const q = A.quantizeNotes(base, tempo.bpm, parseInt(process.env.GRID || '1', 10), true, 0);
  for (const nt of q) nt.out = nt.midi;
  return { key, q, bpm: tempo.bpm };
}

(async () => {
  const N = parseInt(process.argv[3] || '8', 10);
  const rows = [];
  for (const [lvName, lv] of Object.entries(LEVELS)) {
    const agg = { takes: 0, mel: 0, solfa: 0, exact: 0, rhythm: 0, rhythmN: 0, keyOK: 0, extra: 0, missing: 0 };
    for (const [name, tune] of Object.entries(TUNES)) {
      for (let s = 0; s < N; s++) {
        const seed = 1000 + s * 17 + name.length * 131;
        const detune = ((seed * 37) % 100) / 100 - 0.5, base = -12 + ((s % 3) - 1) * 2;   // 人によって歌う高さが違う
        const { x, truth } = humanHum(tune.notes, Object.assign({ seed, detune, base, bpm: 84 + (s % 4) * 12 }, lv));
        const res = await A.analyze(x, SR, 'mono');
        if (!res.notes.length) { agg.takes++; continue; }
        const d = derive(res, true);
        const est = d.q.map((n) => n.out), tr = truth.map((n) => n.m);
        const ms = melodyScore(est, tr);
        // ドレミ（階名）で比べる。正解側は本当のキーで読む
        const tkey = A.makeKey(tune.key[0], tune.key[1]);
        const estS = d.q.map((n) => A.solfaOf(n.out, d.key, true)), trS = tr.map((m) => A.solfaOf(m, tkey, true));
        const sol = 1 - editDistance(estS, trS) / trS.length;
        agg.takes++; agg.mel += Math.max(0, ms.acc); agg.solfa += Math.max(0, sol);
        agg.extra += Math.max(0, est.length - tr.length); agg.missing += Math.max(0, tr.length - est.length);
        const tMaj = tune.key[1] ? (tune.key[0] + 3) % 12 : tune.key[0], eMaj = d.key.minor ? (d.key.tonic + 3) % 12 : d.key.tonic;
        if ((((eMaj - ms.off) % 12) + 12) % 12 === tMaj) agg.keyOK++;
        if (est.length === tr.length) {
          agg.exact++;
          // リズム: となりの音までの間隔（8分音符単位）が合っている割合。テンポの倍・半分の取り違えは許す
          let bestR = 0;
          for (const f of [0.5, 1, 2]) {
            let ok = 0, n = 0;
            for (let i = 0; i + 1 < d.q.length; i++) {
              const e8 = (d.q[i + 1].s - d.q[i].s) / 2 * f, t8 = (truth[i + 1].b0 - truth[i].b0) * 2;   // 楽譜どおりの間隔
              n++; if (Math.abs(e8 - t8) < 0.01) ok++;
            }
            bestR = Math.max(bestR, n ? ok / n : 0);
          }
          agg.rhythm += bestR; agg.rhythmN++;
        }
      }
    }
    rows.push({ レベル: lvName, 本数: agg.takes, 'メロディの形': (100 * agg.mel / agg.takes).toFixed(0) + '%', 'ドレミ': (100 * agg.solfa / agg.takes).toFixed(0) + '%',
      'キー的中': (100 * agg.keyOK / agg.takes).toFixed(0) + '%', '音数ぴったり': (100 * agg.exact / agg.takes).toFixed(0) + '%',
      '余分な音/本': (agg.extra / agg.takes).toFixed(1), '抜けた音/本': (agg.missing / agg.takes).toFixed(1),
      'リズム(音数が合った本のみ)': agg.rhythmN ? (100 * agg.rhythm / agg.rhythmN).toFixed(0) + '%' : '-' });
  }
  console.table(rows);
  process.exit(0);
})();
