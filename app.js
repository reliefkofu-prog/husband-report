/* 夫の通知表：画面の動き・採点・結果のURL共有。文言と配点は questions.js にあります */
(() => {
"use strict";
const C = window.REPORT;
const CATS = C.categories, Q = C.questions, MODES = C.modes;
// 上位％の目安に使う仮の分布。全国の分布データがないため。値を変えるときは画面の注記も直すこと
const DIST = { mean: 50, sd: 15 };
const KEY = "husband-report-v2";
const RULE = "━".repeat(23);
const app = document.getElementById("app");

// 回答は「質問順の点数（3〜0）」の配列で持つ。URLにもこの数字がそのまま入る
let st = { view: "start" };
let locked = false;

/* ---------- 保存（この端末の localStorage だけ） ---------- */
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }

/* ---------- 小さな道具 ---------- */
const other = m => (m === "h" ? "w" : "h");
const fmt = (t, m) => t.replaceAll("{s}", MODES[m].s).replaceAll("{w}", MODES[m].w);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const r1 = v => Math.round(v * 10) / 10;
const encode = pts => pts.map(p => (p == null ? "-" : p)).join("");
const decode = a => [...a].map(ch => (ch === "-" ? null : +ch));
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y !== new Date().getFullYear() ? y + "年" : ""}${m}月${d}日`;
}

/* ---------- 採点 ---------- */
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const cdf = x => 0.5 * (1 + erf((x - DIST.mean) / (DIST.sd * Math.SQRT2)));

function compute(pts) {
  const cats = CATS.map(c => {
    const idx = Q.map((q, i) => (q.cat === c.id ? i : -1)).filter(i => i >= 0);
    const raw = idx.reduce((a, i) => a + pts[i], 0), max = idx.length * 3;
    return { ...c, raw, max, pts: max ? c.points * raw / max : 0 };
  });
  const total = Math.round(cats.reduce((a, c) => a + c.pts, 0));
  const top = Math.min(99, Math.max(1, Math.round((1 - cdf(total)) * 100)));
  const rank = C.ranks.find(r => total >= r.min) || C.ranks[C.ranks.length - 1];
  // 次の一手：0〜1点の質問を「1問あたりの配点 × 失った点」の大きい順に最大5件
  const steps = Q.map((q, i) => {
    const c = cats.find(x => x.id === q.cat), gap = 3 - pts[i];
    return { i, gap, weight: c.points / (c.max / 3) * gap, cat: c.short, adv: q.advice };
  }).filter(x => x.gap >= 2).sort((a, b) => b.weight - a.weight || a.i - b.i).slice(0, 5);
  const weakest = [...cats].sort((a, b) => a.pts / a.points - b.pts / b.points)[0];
  return { cats, total, top, rank, steps, weakest };
}

/* ---------- 結果のURL（#r=点数40桁&m=回答者&d=回答日&v=質問の版） ---------- */
function shareUrl(rec) {
  return `${location.href.split("#")[0]}#r=${encode(rec.pts)}&m=${rec.mode}&d=${rec.d.replaceAll("-", "")}&v=${C.version}`;
}
function setHash(rec) { history.replaceState(null, "", shareUrl(rec)); }
function clearHash() { if (location.hash) history.replaceState(null, "", location.pathname + location.search); }

function parseHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has("r")) return null;
  if ((p.get("v") || "1") !== String(C.version)) return { error: "old" };
  const r = p.get("r"), m = p.get("m"), d = p.get("d") || "";
  if (!new RegExp(`^[0-3]{${Q.length}}$`).test(r) || !MODES[m]) return { error: "broken" };
  const iso = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : today();
  return { rec: { mode: m, pts: decode(r), d: iso } };
}
const HASH_ERRORS = {
  old: "この結果のURLは、質問を変える前の古い版で作られているため表示できません。お手数ですが、もう一度回答してください。",
  broken: "結果のURLが途中で切れているか、形式が正しくないため表示できませんでした。URLを最後までコピーできているか確かめてください。",
};

// 比較相手：この端末で答えた結果と、URLで受け取った結果のうち新しいほう
function partnerOf(mode) {
  const sv = load(), m = other(mode);
  const cands = [
    sv[m] && { mode: m, pts: decode(sv[m].a), d: sv[m].d, from: "この端末で回答" },
    sv.got && sv.got[m] && { mode: m, pts: decode(sv.got[m].a), d: sv.got[m].d, from: "受け取ったURL" },
  ].filter(x => x && x.pts.length === Q.length && x.pts.every(v => v != null));
  return cands.sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : 0))[0] || null;
}

/* ---------- 画面 ---------- */
function render() {
  app.className = "wrap" + (st.view === "q" ? " is-quiz" : "");
  app.innerHTML = st.view === "q" ? qView() : st.view === "result" ? resultView() : startView();
  const qt = document.getElementById("qtext");
  if (qt) qt.focus({ preventScroll: true });
}
function go(next) { clearTimeout(interTimer); st = next; locked = false; render(); window.scrollTo(0, 0); }

function startView() {
  const sv = load(), draft = sv.draft && sv.draft.a.length === Q.length ? sv.draft : null;
  const done = m => (draft && draft.mode === m ? decode(draft.a).filter(v => v != null).length : 0);
  const hist = [
    ...["h", "w"].filter(m => sv[m]).map(m => ({ key: m, rec: sv[m], label: `${MODES[m].who}の回答`, tag: "この端末" })),
    ...["h", "w"].filter(m => sv.got && sv.got[m]).map(m => ({ key: "got-" + m, rec: sv.got[m], label: `${MODES[m].who}の回答`, tag: "受け取ったURL" })),
  ].filter(x => x.rec.a.length === Q.length);
  return `<header class="cover">
  <span class="cover-stamp" aria-hidden="true">優</span>
  <span class="label">家事・育児・お金・会話の${Q.length}問</span>
  <h1>${esc(C.appName)}</h1>
  <p>小さな子どもがいる共働き家庭を想定した、夫の採点アプリです。夫が自分で答えても、妻が夫について答えても使えます。採点されるのは夫だけです。</p>
  <div class="meta small muted"><span>全${Q.length}問・1問ずつ選ぶだけ</span><span>${CATS.length}つの観点・100点満点</span><span>回答は送信せず、この端末と結果のURLの中だけ</span></div>
 </header>
 ${st.notice ? `<div class="notice" role="alert">${esc(st.notice)}</div>` : ""}
 <section class="panel">
  <h2>誰が答えますか</h2>
  <div class="modes">
   ${["h", "w"].map(m => `<button class="mode" data-act="start" data-mode="${m}">
    <strong>${m === "h" ? "夫が自分で答える" : "妻が夫について答える"}</strong>
    <span class="small muted">「${MODES[m].s}は〜」の形で質問します</span>
    ${done(m) ? `<span class="resume">続きから（${done(m)}/${Q.length}問 回答済み）</span>` : ""}</button>`).join("")}
  </div>
  <p class="small muted">選ぶと自動で次の質問に進みます。夫婦それぞれが回答すると、二人の評価のズレを比べられます。別々のスマホで答えても、結果のURLをLINEで送れば比べられます。</p>
  <div class="row"><button class="btn ghost" data-act="sample">サンプル回答で結果を見る</button>
   ${draft ? `<button class="link" data-act="clear-draft">途中の回答を消す</button>` : ""}</div>
 </section>
 ${hist.length ? `<section class="panel"><h3>前回の結果</h3><div class="history">
  ${hist.map(x => `<button data-act="open" data-slot="${x.key}"><span>${x.label}<span class="small muted">（${fmtDate(x.rec.d)}・${x.tag}）</span></span><strong>${compute(decode(x.rec.a)).total}点</strong></button>`).join("")}
 </div></section>` : ""}
 <section class="panel">
  <h3>採点する${CATS.length}つの観点</h3>
  <ul class="cats small">${CATS.map(c => `<li><span>${esc(c.name)}</span><span class="num muted">${c.points}点</span></li>`).join("")}</ul>
  <p class="note">上位・下位％は全国統計ではなく、このアプリ独自の仮の分布で計算した目安です。</p>
 </section>`;
}

// 進み具合：観点ごとに区切った段
function segsView(ci) {
  const answered = st.pts.filter(v => v != null).length;
  return `<div class="segs" role="progressbar" aria-label="回答の進み具合" aria-valuemin="0" aria-valuemax="${Q.length}" aria-valuenow="${answered}">
  ${CATS.map((c, k) => {
    const idx = Q.map((q, i) => (q.cat === c.id ? i : -1)).filter(i => i >= 0);
    const done = idx.filter(i => st.pts[i] != null).length;
    return `<div class="seg${k === ci ? " now" : ""}"><span style="width:${idx.length ? done / idx.length * 100 : 0}%"></span></div>`;
  }).join("")}</div>`;
}

function qView() {
  const i = st.step, q = Q[i], m = st.mode, ci = CATS.findIndex(c => c.id === q.cat), c = CATS[ci];
  const cur = st.pts[i];
  const top = `<div class="quiz-top">
  <div class="row"><button class="link" data-act="back">${i === 0 ? "← 最初の画面へ" : "← 前の質問"}</button><span class="small muted num">${i + 1} / ${Q.length}</span></div>
  ${segsView(st.interlude ? ci - 1 : ci)}
 </div>`;
  if (st.interlude) {
    const prev = CATS[ci - 1];
    return `${top}
 <button class="interlude" data-act="skip" aria-live="polite">
  <span class="done">済</span>
  <span class="small muted">観点 ${ci}/${CATS.length}「${esc(prev.name)}」おわり</span>
  <strong>次は「${esc(c.name)}」</strong>
  <span class="small muted">観点 ${ci + 1}/${CATS.length} へ進みます</span>
 </button>`;
  }
  return `${top}
 <div class="quiz-body enter">
  <span class="label">観点 ${ci + 1}/${CATS.length}　${esc(c.name)}</span>
  <h2 class="q-text" id="qtext" tabindex="-1"><span class="q-no">Q${i + 1}</span>${esc(fmt(q.text, m))}</h2>
  <div class="choices" role="group" aria-labelledby="qtext">
   ${q.choices.map((o, k) => `<button type="button" class="choice${cur === 3 - k ? " is-on" : ""}" aria-pressed="${cur === 3 - k}" data-act="pick" data-k="${k}"><span class="key">${k + 1}</span><span>${esc(fmt(o, m))}</span></button>`).join("")}
  </div>
 </div>
 <div class="quiz-foot"><span class="hint">選ぶと次へ進みます</span>
  ${cur != null ? `<button class="link" data-act="fwd">${i === Q.length - 1 ? "結果を見る →" : "次の質問 →"}</button>` : ""}</div>`;
}

function curveSVG(score) {
  const W = 400, H = 130, x = v => 20 + v * 3.6, pdf = v => Math.exp(-((v - DIST.mean) ** 2) / (2 * DIST.sd ** 2));
  let d = "", area = `M${x(0)},100`;
  for (let v = 0; v <= 100; v += 2) { const y = 100 - pdf(v) * 80; d += (v ? "L" : "M") + x(v).toFixed(1) + "," + y.toFixed(1); area += `L${x(v).toFixed(1)},${y.toFixed(1)}`; }
  let hi = `M${x(score)},100`;
  for (let v = score; v <= 100; v += 1) hi += `L${x(v).toFixed(1)},${(100 - pdf(v) * 80).toFixed(1)}`;
  hi += `L${x(100)},100Z`; area += `L${x(100)},100Z`;
  const sy = 100 - pdf(score) * 80;
  return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="点数の分布（仮）と自分の位置">
  <path d="${area}" fill="var(--accent-soft)"/><path d="${hi}" fill="var(--accent)" opacity=".28"/>
  <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>
  <line x1="${x(0)}" y1="100" x2="${x(100)}" y2="100" stroke="var(--line)"/>
  ${[0, 25, 50, 75, 100].map(v => `<line x1="${x(v)}" y1="100" x2="${x(v)}" y2="104" stroke="var(--muted)"/><text x="${x(v)}" y="118" font-size="11" text-anchor="middle" fill="var(--muted)">${v}</text>`).join("")}
  <line x1="${x(score)}" y1="${sy - 6}" x2="${x(score)}" y2="100" stroke="var(--stamp)" stroke-width="2"/>
  <circle cx="${x(score)}" cy="${sy}" r="4" fill="var(--stamp)"/>
  <text x="${Math.min(Math.max(x(score), 40), 360)}" y="${Math.max(sy - 12, 12)}" font-size="12" font-weight="700" text-anchor="middle" fill="var(--ink)">${score}点</text>
 </svg>`;
}

function radarSVG(cats) {
  const cx = 180, cy = 150, r = 105, n = cats.length;
  const pt = (i, f) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * r * f, cy + Math.sin(a) * r * f]; };
  const poly = f => cats.map((_, i) => pt(i, f).map(v => v.toFixed(1)).join(",")).join(" ");
  const val = cats.map((c, i) => pt(i, c.pts / c.points).map(v => v.toFixed(1)).join(",")).join(" ");
  return `<svg class="radar" viewBox="0 0 360 300" role="img" aria-label="観点別の達成率">
  ${[.25, .5, .75, 1].map(f => `<polygon points="${poly(f)}" fill="none" stroke="var(--line)"/>`).join("")}
  ${cats.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line)"/>`; }).join("")}
  <polygon points="${val}" fill="var(--accent)" fill-opacity=".22" stroke="var(--accent)" stroke-width="2"/>
  ${cats.map((c, i) => { const [x, y] = pt(i, 1.2); const anc = Math.abs(x - cx) < 8 ? "middle" : (x > cx ? "start" : "end");
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="12" text-anchor="${anc}" fill="var(--ink)">${esc(c.short)} <tspan fill="var(--muted)">${Math.round(c.pts / c.points * 100)}%</tspan></text>`; }).join("")}
  <text x="${cx + 3}" y="${cy - r * .5 + 4}" font-size="10" fill="var(--muted)">50%</text>
 </svg>`;
}

function markOf(p) { return p >= .8 ? ["◎", "var(--good)"] : p >= .55 ? ["○", "var(--accent)"] : p >= .35 ? ["△", "var(--warn)"] : ["×", "var(--bad)"]; }

function compareView(rec, res, pr) {
  // 夫＝藍、妻＝朱の2本の棒。差は「妻の回答 − 夫の回答」
  const self = { d: rec.d, res, from: st.src === "got" ? "受け取ったURL" : "この端末で回答" };
  const pair = { d: pr.d, res: compute(pr.pts), from: pr.from };
  const [h, w] = rec.mode === "h" ? [self, pair] : [pair, self];
  const rows = CATS.map((c, i) => { const hv = r1(h.res.cats[i].pts), wv = r1(w.res.cats[i].pts); return { c, hv, wv, diff: r1(wv - hv) }; });
  const big = [...rows].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).filter(r => Math.abs(r.diff) >= 2).slice(0, 2);
  const sign = v => (v > 0 ? "+" : "") + v;
  const bar = (who, v, max, color) => `<div class="bar"><span>${who}</span><div class="t"><span style="width:${v / max * 100}%;background:${color}"></span></div><span class="v">${v}/${max}</span></div>`;
  return `<section class="panel" id="sec-cmp"><h2>夫婦の評価のズレ</h2>
  <p class="small muted">夫の回答：${fmtDate(h.d)}（${h.from}）／妻の回答：${fmtDate(w.d)}（${w.from}）</p>
  <div class="legend"><span><i style="background:var(--accent)"></i>夫の回答</span><span><i style="background:var(--stamp)"></i>妻の回答</span></div>
  <ul class="cmp">${rows.map(r => `<li><span class="name">${esc(r.c.name)}</span><span class="diff${Math.abs(r.diff) >= 2 ? " big" : ""}">差 ${sign(r.diff)}</span>
   <div class="bars">${bar("夫", r.hv, r.c.points, "var(--accent)")}${bar("妻", r.wv, r.c.points, "var(--stamp)")}</div></li>`).join("")}</ul>
  <div class="cmp-total"><span>合計</span><span>夫 ${h.res.total}点／妻 ${w.res.total}点（差 ${sign(w.res.total - h.res.total)}）</span></div>
  <p class="small muted">差は「妻の回答 − 夫の回答」です。マイナスの観点は、夫の自己評価より妻から見た評価が低いところです。</p>
  ${big.length ? `<p class="note">ズレが大きいのは「${big.map(b => esc(b.c.short)).join("」「")}」です。ここは「どの作業を、誰が、どのくらいやっているか」を二人で書き出して確かめるのがおすすめです。</p>` : `<p class="note">二人の認識はほぼ同じです。</p>`}
 </section>`;
}

function shareView(rec, res) {
  const line = `https://line.me/R/share?text=${encodeURIComponent(summary(rec, res))}`;
  return `<div class="row">
   <a class="btn" href="${line}" target="_blank" rel="noopener">LINEで送る</a>
   <button class="btn ghost" data-act="copy">結果をコピー</button>
  </div>
  <div class="row"><button class="link" data-act="copy-url">URLだけコピー</button>${navigator.share ? `<button class="link" data-act="share">ほかのアプリで送る</button>` : ""}</div>
  <p class="toast" id="toast" aria-live="polite"></p>
  <textarea id="copybox" readonly hidden aria-label="コピー用の文章"></textarea>
  <p class="small muted">回答はURLの中に数字で入っているだけで、どこにも送信されません。URLを開くと、この結果がそのまま表示されます。</p>`;
}

function resultView() {
  const rec = st.rec, m = rec.mode, res = compute(rec.pts), R0 = res.rank, o = other(m);
  const pr = st.src === "sample" ? null : partnerOf(m);
  const toc = [["sec-cats", "観点別"], ["sec-steps", "次の一手"], ...(pr ? [["sec-cmp", "夫婦の比較"]] : []), ["sec-next", pr ? "見直す" : `${MODES[o].who}にも聞く`]];
  const rankRule = C.ranks.map((r, i) => `${esc(r.mark)}${i === 0 ? r.min + "点以上" : i === C.ranks.length - 1 ? C.ranks[i - 1].min - 1 + "点以下" : r.min + "〜" + (C.ranks[i - 1].min - 1)}`).join("／");
  return `${st.src === "got" ? `<div class="notice" role="status">
   <p>共有された結果を表示しています（回答者：${MODES[m].label}・${fmtDate(rec.d)}）。</p>
   ${pr ? "" : `<p>${MODES[o].who}のあなたも答えると、二人の評価のズレが表示されます。</p>
   <div class="row"><button class="btn" data-act="start" data-mode="${o}">${MODES[o].who}として答えて比べる</button></div>`}
  </div>` : ""}
 <section class="panel hero">
  <div class="card-head"><div><span class="label">${st.src === "sample" ? "サンプル回答（例）" : "採点結果"}</span><h2>${esc(C.appName)}</h2></div>
   <div class="small muted" style="text-align:right">回答者：${MODES[m].label}<br>${fmtDate(rec.d)}</div></div>
  <div class="hero-main"><div class="score">${res.total}<small> / 100点</small></div>
   <div class="stamp" aria-label="評価 ${esc(R0.mark)}">${esc(R0.mark)}</div></div>
  <div><p class="rank-title">${esc(R0.title)}</p><p class="small muted">${esc(R0.msg)}</p></div>
  <p class="pct-line">上位 約<span class="num">${res.top}</span>%・下位 約<span class="num">${100 - res.top}</span>%<span class="small muted">（目安）</span></p>
  <p class="note">上位・下位％は、全国の夫の点数分布のデータがないため、平均50点・標準偏差（点数のばらつきの幅）15点の分布を仮に置いて計算した目安です。</p>
  ${st.src === "sample" ? "" : shareView(rec, res)}
  <details class="more"><summary>分布のグラフとランクの基準を見る</summary>${curveSVG(res.total)}<p class="small muted">評価：${rankRule}</p></details>
 </section>
 <nav class="toc" aria-label="結果の目次">${toc.map(([id, l]) => `<button data-act="jump" data-to="${id}">${l}</button>`).join("")}</nav>
 <section class="panel" id="sec-cats"><h2>観点別の成績</h2>
  <div class="two"><div class="tbl-wrap" style="min-width:0"><table><thead><tr><th>観点</th><th class="n">点数</th><th></th><th>評価</th></tr></thead><tbody>
  ${res.cats.map(c => { const p = c.pts / c.points, [mk, col] = markOf(p); return `<tr><td>${esc(c.name)}</td><td class="n">${r1(c.pts)}<span class="muted"> / ${c.points}</span></td><td style="width:26%"><div class="mini"><span style="width:${p * 100}%;background:${col}"></span></div></td><td class="mark" style="color:${col}">${mk}</td></tr>`; }).join("")}
  </tbody></table></div>${radarSVG(res.cats)}</div>
  <p class="small muted">◎ 80%以上　○ 55%以上　△ 35%以上　× 35%未満</p>
 </section>
 <section class="panel" id="sec-steps"><h2>次の一手</h2>
  <p class="small muted">点数が低かった質問のうち、配点の大きいものから順に並べています。まず1番目だけ、来週から始めてください。</p>
  ${res.steps.length ? `<ol class="steps">${res.steps.map(s => `<li><span class="tag">${esc(s.cat)}・Q${s.i + 1}</span>${esc(s.adv)}</li>`).join("")}</ol>` : `<p>大きな弱点はありません。今の分担を、3か月に1回二人で見直すことを続けてください。</p>`}
  <p class="note"><strong>一番伸びしろがある観点：${esc(res.weakest.name)}</strong><br>${esc(res.weakest.advice)}</p>
 </section>
 ${pr ? compareView(rec, res, pr) : ""}
 <section class="panel" id="sec-next">
  ${pr ? "" : `<h3>次は${MODES[o].who}にも答えてもらう</h3>
  <p class="small">${o === "w" ? "同じ質問に妻が「夫は〜」の形で答えると、二人の評価のズレが分かります。" : "夫本人にも「あなたは〜」の形で答えてもらうと、二人の評価のズレが分かります。"}同じスマホで続けて答えても、別のスマホで答えて結果のURLをLINEで送ってもらっても比べられます。点数より、ズレが大きい観点を話し合うきっかけにしてください。</p>`}
  <div class="row">
   ${pr ? "" : `<button class="btn" data-act="start" data-mode="${o}">${MODES[o].label}の回答を始める</button>`}
   ${st.src === "own" ? `<button class="btn ghost" data-act="edit">回答を見直す</button>` : ""}
   <button class="btn ghost" data-act="home">最初の画面へ</button>
  </div>
 </section>`;
}

function summary(rec, res) {
  const top2 = res.steps.slice(0, 2);
  return [
    `${C.appName}の結果です（回答：${MODES[rec.mode].label}・${fmtDate(rec.d)}）`,
    `合計 ${res.total}点（${res.rank.mark}・${res.rank.title}）`,
    `上位 約${res.top}%（仮の分布で計算した目安）`,
    "",
    RULE, "■ 観点別", RULE,
    ...res.cats.map(c => `・${c.short} ${r1(c.pts)}/${c.points}`),
    ...(top2.length ? [RULE, "■ 次の一手", RULE, ...top2.map(s => `・${s.adv}`)] : []),
    "",
    "結果を開く（あなたも答えると、二人の評価を比べられます）",
    shareUrl(rec),
  ].join("\n");
}

/* ---------- 回答の操作 ---------- */
function saveDraft() { const sv = load(); sv.draft = { mode: st.mode, a: encode(st.pts) }; save(sv); }

function startQuiz(mode) {
  const sv = load(), dr = sv.draft;
  const pts = dr && dr.mode === mode && dr.a.length === Q.length ? decode(dr.a) : Array(Q.length).fill(null);
  const first = pts.indexOf(null);
  clearHash();
  go({ view: "q", mode, step: first < 0 ? Q.length - 1 : first, pts });
}

function pick(k) {
  if (locked) return;
  locked = true;
  st.pts[st.step] = 3 - k;
  saveDraft();
  app.querySelectorAll(".choice").forEach((b, j) => { b.classList.toggle("is-on", j === k); b.setAttribute("aria-pressed", j === k); });
  app.classList.add("locked");
  setTimeout(forward, 230);
}

// 観点が変わるときは区切りを1秒見せる（まだ答えていない観点に進むときだけ）
let interTimer = 0;
function endInterlude() { clearTimeout(interTimer); st.interlude = false; locked = false; render(); }

function forward() {
  if (st.step < Q.length - 1) {
    const next = st.step + 1;
    st.step = next;
    if (Q[next].cat !== Q[next - 1].cat && st.pts[next] == null) {
      st.interlude = true; locked = true; render();
      interTimer = setTimeout(endInterlude, 1000);
      return;
    }
    locked = false; render(); return;
  }
  const miss = st.pts.indexOf(null);
  if (miss >= 0) { st.step = miss; locked = false; render(); return; }
  const rec = { mode: st.mode, pts: st.pts, d: today() };
  const sv = load(); sv[rec.mode] = { a: encode(rec.pts), d: rec.d }; delete sv.draft; save(sv);
  setHash(rec);
  go({ view: "result", rec, src: "own" });
}

function back() {
  if (st.interlude) { clearTimeout(interTimer); st.interlude = false; locked = false; }
  if (st.step === 0) { go({ view: "start" }); return; }
  st.step--; render();
}

function toast(msg) { const t = document.getElementById("toast"); if (t) t.textContent = msg; }
async function copyText(txt, ok) {
  try { await navigator.clipboard.writeText(txt); toast(ok); }
  catch (e) {
    // 古いブラウザやアプリ内ブラウザ向けの予備。それでもだめなら枠に出して手でコピーしてもらう
    const box = document.getElementById("copybox");
    box.value = txt; box.hidden = false; box.focus(); box.select();
    let done = false;
    try { done = document.execCommand("copy"); } catch (err) {}
    if (done) { box.hidden = true; toast(ok); }
    else toast("自動でコピーできなかったため、下の枠の文章を長押しして全部コピーしてください。");
  }
}

/* ---------- 画面の切り替え ---------- */
function route() {
  const h = parseHash();
  if (h && h.rec) {
    const sv = load(), a = encode(h.rec.pts);
    const own = sv[h.rec.mode] && sv[h.rec.mode].a === a;
    if (!own) { sv.got = sv.got || {}; sv.got[h.rec.mode] = { a, d: h.rec.d }; save(sv); }
    go({ view: "result", rec: h.rec, src: own ? "own" : "got" });
  } else if (h && h.error) {
    clearHash();
    go({ view: "start", notice: HASH_ERRORS[h.error] });
  } else go({ view: "start" });
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act;
  if (act === "pick") pick(+b.dataset.k);
  else if (act === "fwd") { if (!locked) forward(); }
  else if (act === "back") back();
  else if (act === "start") startQuiz(b.dataset.mode);
  else if (act === "sample") { clearHash(); go({ view: "result", rec: { mode: "h", pts: C.sample.slice(), d: today() }, src: "sample" }); }
  else if (act === "open") {
    const sv = load(), slot = b.dataset.slot, isGot = slot.startsWith("got-"), m = slot.slice(-1);
    const s = isGot ? sv.got[m] : sv[m], rec = { mode: m, pts: decode(s.a), d: s.d };
    setHash(rec); go({ view: "result", rec, src: isGot ? "got" : "own" });
  }
  else if (act === "clear-draft") { const sv = load(); delete sv.draft; save(sv); render(); }
  else if (act === "edit") { const rec = st.rec; clearHash(); go({ view: "q", mode: rec.mode, step: 0, pts: rec.pts.slice() }); }
  else if (act === "home") { clearHash(); go({ view: "start" }); }
  else if (act === "copy") copyText(summary(st.rec, compute(st.rec.pts)), "結果をコピーしました。LINEなどに貼り付けて送れます。");
  else if (act === "copy-url") copyText(shareUrl(st.rec), "URLをコピーしました。");
  else if (act === "share") {
    const txt = summary(st.rec, compute(st.rec.pts));
    navigator.share({ title: C.appName, text: txt }).catch(() => {});
  }
  else if (act === "skip") endInterlude();
  // 目次：URLの #r= を壊さないよう、リンクではなくスクロールで移動する
  else if (act === "jump") {
    const el = document.getElementById(b.dataset.to);
    if (el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
});

document.addEventListener("keydown", e => {
  if (st.view !== "q" || e.altKey || e.ctrlKey || e.metaKey) return;
  if (/^[1-4]$/.test(e.key)) { e.preventDefault(); pick(+e.key - 1); }
  else if (e.key === "ArrowLeft") back();
  else if (e.key === "ArrowRight" && st.pts[st.step] != null && !locked) forward();
});

window.addEventListener("hashchange", route);
// 再読み込みで前のスクロール位置に戻さない（結果はいつも上から見せる）
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

// questions.js を編集したときの書き間違いを画面に出す
const problems = [];
const ids = CATS.map(c => c.id);
Q.forEach((q, i) => {
  if (!ids.includes(q.cat)) problems.push(`Q${i + 1}：観点「${q.cat}」が categories にありません`);
  if (!Array.isArray(q.choices) || q.choices.length !== 4) problems.push(`Q${i + 1}：選択肢が4つではありません`);
});
if (C.sample.length !== Q.length) problems.push(`sample の数（${C.sample.length}）が質問の数（${Q.length}）と合いません`);
const sum = CATS.reduce((a, c) => a + c.points, 0);
if (sum !== 100) problems.push(`観点の配点の合計が${sum}点です（100点にしてください）`);
if (problems.length) {
  app.innerHTML = `<div class="notice" role="alert"><strong>questions.js に直すところがあります</strong><ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
} else route();
})();
