// 長い鼻歌（同じ曲を3回くり返し、30〜50秒）で、歌っているうちに音程が大きくずれていく場合
'use strict';
const fs = require('fs'), vm = require('vm');
const { SR, humanHum, editDistance, melodyScore, TUNES, LEVELS } = require('./sim.js');
const html = fs.readFileSync(process.argv[2], 'utf8');
const all = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const core = all.slice(0, all.indexOf('状態と、設定から結果を組み立てる処理'));
const cut = core.slice(0, core.lastIndexOf('/* ===')).replace('const $ = (id) => document.getElementById(id);', '');
const ctx = { performance, MessageChannel, setTimeout, console, Float32Array, Float64Array, Uint8Array, Uint32Array, Int16Array, Int32Array, Math, Number, Array, Object, Set, Map, Infinity, NaN };
vm.createContext(ctx); vm.runInContext(cut + ';this.api = { analyze, deriveNotes, makeKey, solfaOf };', ctx);
const A = ctx.api;
(async () => {
  const rows = [];
  for (const drift of [0.5, 1.0, 1.6, 2.4]) for (const df of [true, false]) {
    let mel = 0, sol = 0, n = 0;
    for (const [name, tune] of Object.entries(TUNES)) for (let s = 0; s < 6; s++) {
      const notes = [...tune.notes, [null, 1], ...tune.notes, [null, 1], ...tune.notes];
      const seed = 5000 + s * 31 + name.length * 7;
      const { x, truth } = humanHum(notes, Object.assign({ seed, detune: (s % 5) * 0.2 - 0.4, base: -12, bpm: 96 }, LEVELS['ふつう'], { drift }));
      const res = await A.analyze(x, SR, 'mono');
      const d = A.deriveNotes(res.notes, res.tuning, { key: 'auto', bpm: 'auto', meter: 4, grid: 2, snap: 1, octave: 0, pickup: 0, fill: true, tuneFix: true, driftFix: df, free: true });
      const est = d.q.map((q) => q.out), tr = truth.map((t) => t.m), tkey = A.makeKey(tune.key[0], tune.key[1]);
      mel += Math.max(0, melodyScore(est, tr).acc);
      sol += Math.max(0, 1 - editDistance(d.q.map((q) => A.solfaOf(q.out, d.key, true)), tr.map((m) => A.solfaOf(m, tkey, true))) / tr.length); n++;
    }
    rows.push({ 'ずれていく幅(半音)': drift, 追従: df ? 'あり' : 'なし', 本数: n, 'メロディの形': (100 * mel / n).toFixed(0) + '%', ドレミ: (100 * sol / n).toFixed(0) + '%' });
  }
  console.table(rows); process.exit(0);
})();
