/* あなたはホントにいい夫？（旧名 夫の通知表）：画面の動き・採点・結果のURL共有。文言と配点は questions.js にあります */
(() => {
"use strict";
const C = window.REPORT;
const CATS = C.categories, Q = C.questions, MODES = C.modes;
// 上位％の目安に使う仮の分布。全国の分布データがないため。値を変えるときは画面の注記も直すこと
const DIST = { mean: 70, sd: 10 };
// 点数の底上げ：観点の点数＝配点×（取得点÷満点）^CURVE。0.48 は「1問平均1.5点（真ん中）」の人が約72点になる値
// （全問を均等にランダムに選ぶと平均約70.6点・標準偏差約4.4点。全部1点→59点、全部2点→82点。全部0点→0点、全部3点→100点は変わらない）
const CURVE = 0.48;
const KEY = "husband-report-v2";
const RULE = "━".repeat(23);
const app = document.getElementById("app");

// 回答は「質問順の点数（3〜0）」の配列で持つ。URLにもこの数字がそのまま入る
let st = { view: "start" };
let locked = false;

/* ---------- 保存（この端末の localStorage だけ） ---------- */
function load() {
  let o;
  try { o = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { o = {}; }
  // 質問の版（questions.js の version）が変わったら、前の版の回答は使わない（名前だけ残す）
  if ((o.qv || 1) !== C.version) o = { name: o.name };
  return o;
}
function save(o) { try { o.qv = C.version; localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }

/* ---------- 小さな道具 ---------- */
const other = m => (m === "h" ? "w" : "h");
// 夫の名前（任意・10文字まで）。妻が答えるときは「夫は」を「◯◯さんは」にする。表示は必ず esc を通す
// 制御文字・文字の向きを変える記号・壊れた絵文字の片割れを除き、「さん」などの敬称は外す（画面で「さん」を付けるため）
// （古いiPhoneのSafariで読めない書き方＝後読みの正規表現は使わない。家族の絵文字をつなぐ U+200D は名前の中では残す）
const cleanName = s => {
  const t = Array.from(String(s || "").replace(/[\u0000-\u001f\u007f-\u009f<>\u200b\u200c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ""))
    .filter(ch => !/^[\ud800-\udfff]$/.test(ch)).join("")
    .replace(/^[\s\u200d]+|[\s\u200d]+$/g, "").replace(/\s*(さん|さま|様|くん|君|ちゃん)$/, "");
  return Array.from(t).slice(0, 10).join("").replace(/[\s\u200d]+$/, "");
};
const titleOf = n => (n ? `${n}さんの${C.resultName || "結果"}` : C.resultName || C.appName);
const fmt = (t, m, n) => t.replaceAll("{s}", m === "w" && n ? `${n}さん` : MODES[m].s).replaceAll("{w}", MODES[m].w);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const r1 = v => Math.round(v * 10) / 10;
const f1 = v => r1(v).toFixed(1);
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
// URLの回答日（YYYYMMDD）を確かめる。あり得ない日付・未来の日付は null
function isoOf(d) {
  if (!/^\d{8}$/.test(d)) return null;
  const y = +d.slice(0, 4), mo = +d.slice(4, 6), da = +d.slice(6), t = new Date(y, mo - 1, da);
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === da && t <= new Date() ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null;
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
    return { ...c, raw, max, pts: max ? c.points * Math.pow(raw / max, CURVE) : 0 };
  });
  // 合計は、画面に出す観点の点数（小数1桁）を足してから四捨五入する。表の合計と食い違わないように
  const total = Math.round(cats.reduce((a, c) => a + Math.round(c.pts * 10), 0) / 10);
  const top = Math.min(99, Math.max(1, Math.round((1 - cdf(total)) * 100)));
  // 偏差値（目安）：同じ仮の分布で 50＋10×(点数−平均)÷標準偏差。マイナスにはしない
  const hensa = Math.max(0, Math.round(50 + 10 * (total - DIST.mean) / DIST.sd));
  const rank = C.ranks.find(r => total >= r.min) || C.ranks[C.ranks.length - 1];
  // 次の一手：0〜1点の質問を、その1問を最高の答えにしたとき合計が伸びる点（底上げの曲線込み）の大きい順に最大5件
  const steps = Q.map((q, i) => {
    const c = cats.find(x => x.id === q.cat), gap = 3 - pts[i];
    const gain = c.max ? c.points * (Math.pow((c.raw + gap) / c.max, CURVE) - Math.pow(c.raw / c.max, CURVE)) : 0;
    return { i, gap, weight: gain, cat: c.short, adv: q.advice };
  }).filter(x => x.gap >= 2).sort((a, b) => b.weight - a.weight || a.i - b.i).slice(0, 5);
  const weakest = [...cats].sort((a, b) => a.pts / a.points - b.pts / b.points)[0];
  return { cats, total, top, hensa, rank, steps, weakest };
}

/* ---------- 結果のURL（#r=点数40桁&m=回答者&d=回答日&v=質問の版&n=夫の名前&p=相手の点数40桁&pd=相手の回答日） ---------- */
// 相手（pr）の回答も入れておくと、受け取った人の端末に相手の記録がなくても「ふたりの答え合わせ」が出る
function shareUrl(rec, pr) {
  const dd = s => s.replaceAll("-", "");
  return `${location.href.split(/[?#]/)[0].replace(/\/index\.html$/, "/")}#r=${encode(rec.pts)}&m=${rec.mode}&d=${dd(rec.d)}&v=${C.version}${rec.n ? "&n=" + encodeURIComponent(rec.n) : ""}${pr ? `&p=${encode(pr.pts)}&pd=${dd(pr.d)}` : ""}`;
}
// 今の履歴の印（state）は残したまま、URL だけを書き換える
function setHash(rec, pr) { history.replaceState(history.state, "", shareUrl(rec, pr)); }
function clearHash() { if (location.hash) history.replaceState(null, "", location.pathname + location.search); }

function parseHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has("r")) return null;
  if ((p.get("v") || "1") !== String(C.version)) return { error: "old" };
  const re = new RegExp(`^[0-3]{${Q.length}}$`);
  const r = p.get("r"), m = p.get("m"), pa = p.get("p");
  if (!re.test(r) || !MODES[m]) return { error: "broken" };
  const partner = pa && re.test(pa) ? { mode: other(m), pts: decode(pa), d: isoOf(p.get("pd") || "") || today() } : null;
  return { rec: { mode: m, pts: decode(r), d: isoOf(p.get("d") || "") || today(), n: cleanName(p.get("n")) }, partner };
}
const HASH_ERRORS = {
  old: "この結果のURLは、質問を変える前の古い版で作られているため表示できません。お手数ですが、もう一度回答してください。",
  broken: "結果のURLが途中で切れているか、形式が正しくないため表示できませんでした。URLを最後までコピーできているか確かめてください。",
};

// 比較相手：この端末で答えた結果と、URLで受け取った結果のうち新しいほう
function partnerOf(mode) {
  const sv = load(), m = other(mode);
  const cands = [
    sv[m] && { mode: m, pts: decode(sv[m].a), d: sv[m].d, n: sv[m].n, from: "この端末" },
    sv.got && sv.got[m] && { mode: m, pts: decode(sv.got[m].a), d: sv.got[m].d, n: sv.got[m].n, from: "受け取ったURL" },
  ].filter(x => x && x.pts.length === Q.length && x.pts.every(v => v != null));
  return cands.sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : 0))[0] || null;
}
// 表示中の結果と比べる相手。受け取ったURLの結果は「うちの結果として残す」までは、URLに入っていた相手の回答とだけ比べる
// （ほかの家庭の結果URLを開いたときに、この端末の回答と混ざらないように）
function pairFor(rec) {
  if (st.src === "sample") return null;
  if (st.src === "got" && !st.kept) return st.urlPartner ? { ...st.urlPartner, n: rec.n, from: "受け取ったURL" } : null;
  return partnerOf(rec.mode);
}
// 受け取った結果を、この端末の「前回の結果」に残す。自分の回答や、もっと新しい記録は上書きしない
function keepGot() {
  const sv = load(), r = st.rec; sv.got = sv.got || {};
  // 残せた（または同じ回答がある）ときは true、この端末に同じ回答者の同じ日以降の回答があるときは "newer"、入れ替えを断られたときは false
  const put = (m, v) => {
    if (sv[m] && sv[m].a === v.a) return true;
    if (sv[m] && sv[m].d >= v.d) return "newer";
    const old = sv.got[m];
    if (old && old.a !== v.a && !confirm(old.d > v.d
      ? `前に受け取った${MODES[m].who}の回答（${fmtDate(old.d)}）のほうが新しい回答です。古い${fmtDate(v.d)}の回答に入れ替えます。よろしいですか？`
      : `前に受け取った${MODES[m].who}の回答（${fmtDate(old.d)}）と入れ替えます。よろしいですか？`)) return false;
    sv.got[m] = { ...v, n: v.n || (old && old.n) || "" };
    return true;
  };
  const done = put(r.mode, { a: encode(r.pts), d: r.d, n: r.n });
  if (!done) return false;
  // この端末に同じ回答者の同じ日以降の回答があるときは何も残さない（受け取った結果のまま表示する）
  if (done === "newer") return "newer";
  if (st.urlPartner) put(st.urlPartner.mode, { a: encode(st.urlPartner.pts), d: st.urlPartner.d, n: r.n });
  save(sv); st.kept = true;
  return true;
}

/* ---------- 画面 ---------- */
function render(focusSel) {
  app.className = "wrap" + (st.view === "q" ? " is-quiz" : "");
  app.innerHTML = st.view === "q" ? qView() : st.view === "result" ? resultView() : startView();
  // 読み上げで画面が変わったことが伝わるよう、質問か見出しにフォーカスを移す（枠は出さない）。
  // 観点の区切りは1秒で消えるので移さない（観点が変わったことは次の質問の見出しで読ませる）
  // focusSel は文字列か配列（配列は書いた順に探す）
  const first = sels => { for (const q of [].concat(sels || [])) { const el = app.querySelector(q); if (el) return el; } return null; };
  const t = first(focusSel) || app.querySelector("#qtext") || app.querySelector("h1, h2");
  if (t) { if (!t.matches("button, input, [tabindex]")) t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); }
}
const showSample = () => go({ view: "result", rec: { mode: "h", pts: C.sample.slice(), d: today() }, src: "sample" });
function go(next) { clearTimeout(interTimer); clearTimeout(pickTimer); st = next; locked = false; render(); window.scrollTo(0, 0); }

// 途中の回答は回答者ごとに1つずつ（前の版の1枠だけの保存も読む）
function draftsOf(sv) { return sv.drafts || (sv.draft ? { [sv.draft.mode]: sv.draft.a } : {}); }

function startView() {
  const sv = load(), drafts = draftsOf(sv);
  const done = m => (drafts[m] && drafts[m].length === Q.length ? decode(drafts[m]).filter(v => v != null).length : 0);
  const hist = [
    ...["h", "w"].filter(m => sv[m]).map(m => ({ key: m, rec: sv[m], label: `${MODES[m].who}の回答`, tag: "この端末" })),
    ...["h", "w"].filter(m => sv.got && sv.got[m]).map(m => ({ key: "got-" + m, rec: sv.got[m], label: `${MODES[m].who}の回答`, tag: "受け取ったURL" })),
  ].filter(x => x.rec.a.length === Q.length);
  return `<header class="cover">
  <span class="cover-stamp" aria-hidden="true">優</span>
  <span class="label">家事・育児・お金・会話の${Q.length}問</span>
  <h1>${(C.appNameWrap || C.appName).split("｜").map(t => `<span class="nb">${esc(t)}</span>`).join("")}</h1>
  <p class="lead">夫の自己採点と、妻の採点。<br>何点ズレるか、比べてみませんか。</p>
  <div class="meta small muted"><span>小さな子どもがいる共働き家庭向け</span><span>1問ずつ選ぶだけ・100点満点</span><span>回答は送信せず、この端末と結果のURLの中だけ</span></div>
 </header>
 ${st.notice ? `<div class="notice" role="alert">${esc(st.notice)}</div>` : ""}
 <section class="panel">
  <h2>誰が答えますか</h2>
  <label class="name-field"><span>夫の名前<span class="small muted">（なくてもOK）</span></span>
   <input id="hname" type="text" maxlength="10" autocomplete="off" enterkeyhint="done" placeholder="例：たかし" value="${esc(sv.name || "")}"></label>
  <p class="small muted" style="margin-top:-6px">「さん」なし・10文字まで（結果のURLに入ります）</p>
  <div class="modes">
   ${["h", "w"].map(m => `<button class="mode" data-act="start" data-mode="${m}">
    <strong>${m === "h" ? "夫が自分で答える" : "妻が夫について答える"}</strong>
    <span class="small muted">「${MODES[m].s}は〜」の形で質問します</span>
    ${done(m) ? `<span class="resume">続きから（${done(m)}/${Q.length}問 回答済み）</span>` : ""}</button>`).join("")}
  </div>
  <p class="small muted">${Q.length}問に答えると、夫の点数・偏差値（目安）・次の一手が出ます。採点されるのは夫だけです。選ぶと自動で次の質問に進みます。夫婦それぞれが回答すると、二人の評価のズレを比べられます。別々のスマホで答えたときは、結果のURLをLINEで送れば大丈夫です。</p>
  <div class="row"><button class="btn ghost" data-act="sample">サンプル回答で結果を見る</button>
   ${["h", "w"].filter(m => done(m)).map(m => `<button class="link" data-act="clear-draft" data-mode="${m}">${MODES[m].who}の途中の回答を消す</button>`).join("")}</div>
 </section>
 ${hist.length ? `<section class="panel"><h3>前回の結果</h3><div class="history">
  ${hist.map(x => `<div class="hist-row"><button data-act="open" data-slot="${x.key}"><span>${x.rec.n ? esc(x.rec.n) + "さん・" : ""}${x.label}<span class="small muted">（${fmtDate(x.rec.d)}・${x.tag}）</span></span><strong>${compute(decode(x.rec.a)).total}点</strong></button><button class="link" data-act="forget" data-slot="${x.key}" aria-label="${x.label}（${x.tag}）の記録を消す">消す</button></div>`).join("")}
 </div><div class="row"><button class="link" data-act="wipe">この端末の記録をすべて消す</button></div></section>` : ""}
 <section class="panel">
  <h3>採点する${CATS.length}つの観点</h3>
  <ul class="cats small">${CATS.map(c => `<li><span>${esc(c.name)}</span><span class="num muted">${c.points}点</span></li>`).join("")}</ul>
  <p class="note">偏差値と上位％は全国統計ではなく、このアプリ独自の仮の分布（平均${DIST.mean}点・標準偏差${DIST.sd}点）で計算した目安です。</p>
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
  const cur = st.pts[i], last = i === Q.length - 1, allDone = st.pts.every(v => v != null);
  const top = `<div class="quiz-top">
  <div class="row"><button class="link" data-act="back">${i === 0 ? "← 戻る" : "← 前の質問"}</button><span class="small muted num">${i + 1} / ${Q.length}</span></div>
  ${segsView(st.interlude ? ci - 1 : ci)}
 </div>`;
  if (st.interlude) {
    const prev = CATS[ci - 1];
    return `${top}
 <button class="interlude" data-act="skip">
  <span class="done">済</span>
  <span class="small muted">観点 ${ci}/${CATS.length}「${esc(prev.name)}」おわり</span>
  <strong>次は「${esc(c.name)}」</strong>
  <span class="small muted">観点 ${ci + 1}/${CATS.length} へ進みます</span>
 </button>`;
  }
  // 全問答えたあと（見直しのとき）は、どの質問からでも結果に進める
  const next = cur != null && !last ? `<button class="link" data-act="fwd">次の質問 →</button>`
    : cur != null && last && !allDone ? `<button class="link" data-act="fwd">答えていない質問へ →</button>` : "";
  return `${top}
 <div class="quiz-body enter">
  <span class="label">観点 ${ci + 1}/${CATS.length}　${esc(c.name)}</span>
  <h2 class="q-text" id="qtext" tabindex="-1">${i > 0 && Q[i - 1].cat !== q.cat ? `<span class="sr-only">観点 ${ci + 1}/${CATS.length}「${esc(c.name)}」に進みました。</span>` : ""}<span class="q-no">Q${i + 1}</span>${esc(fmt(q.text, m, st.name))}</h2>
  <div class="choices" role="group" aria-labelledby="qtext">
   ${q.choices.map((o, k) => `<button type="button" class="choice${cur === 3 - k ? " is-on" : ""}" aria-pressed="${cur === 3 - k}" data-act="pick" data-k="${k}"><span class="key">${k + 1}</span><span>${esc(fmt(o, m, st.name))}</span></button>`).join("")}
  </div>
 </div>
 <div class="quiz-foot">${allDone ? "" : `<span class="hint">選ぶと次へ進みます</span>`}
  <span class="foot-acts">${next}${allDone ? `<button class="link" data-act="finish">結果を見る →</button>` : ""}</span></div>`;
}

function curveSVG(score) {
  const W = 400, H = 132, x = v => 20 + v * 3.6, pdf = v => Math.exp(-((v - DIST.mean) ** 2) / (2 * DIST.sd ** 2));
  let d = "", area = `M${x(0)},100`;
  for (let v = 0; v <= 100; v += 2) { const y = 100 - pdf(v) * 76; d += (v ? "L" : "M") + x(v).toFixed(1) + "," + y.toFixed(1); area += `L${x(v).toFixed(1)},${y.toFixed(1)}`; }
  let hi = `M${x(score)},100`;
  for (let v = score; v <= 100; v += 1) hi += `L${x(v).toFixed(1)},${(100 - pdf(v) * 76).toFixed(1)}`;
  hi += `L${x(100)},100Z`; area += `L${x(100)},100Z`;
  const sy = 100 - pdf(score) * 76;
  return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="点数の分布（仮）と自分の位置">
  <path d="${area}" fill="var(--accent-soft)"/>${score >= DIST.mean ? `<path d="${hi}" fill="var(--accent)" opacity=".28"/>` : ""}
  <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>
  <line x1="${x(0)}" y1="100" x2="${x(100)}" y2="100" stroke="var(--line)"/>
  ${[0, 25, 50, 75, 100].map(v => `<line x1="${x(v)}" y1="100" x2="${x(v)}" y2="104" stroke="var(--muted)"/><text x="${x(v)}" y="124" font-size="16" text-anchor="middle" fill="var(--muted)">${v}</text>`).join("")}
  <line x1="${x(score)}" y1="${sy - 6}" x2="${x(score)}" y2="100" stroke="var(--stamp)" stroke-width="2"/>
  <circle cx="${x(score)}" cy="${sy}" r="4" fill="var(--stamp)"/>
  <text x="${Math.min(Math.max(x(score), 44), 356)}" y="${Math.max(sy - 12, 18)}" font-size="18" font-weight="700" text-anchor="middle" fill="var(--ink)">${score}点</text>
 </svg>`;
}

function radarSVG(cats) {
  const cx = 200, cy = 160, r = 100, n = cats.length;
  const pt = (i, f) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * r * f, cy + Math.sin(a) * r * f]; };
  const poly = f => cats.map((_, i) => pt(i, f).map(v => v.toFixed(1)).join(",")).join(" ");
  const val = cats.map((c, i) => pt(i, c.pts / c.points).map(v => v.toFixed(1)).join(",")).join(" ");
  return `<svg class="radar" viewBox="0 0 400 320" role="img" aria-label="観点別の点数の割合（換算後）">
  ${[.25, .5, .75, 1].map(f => `<polygon points="${poly(f)}" fill="none" stroke="var(--line)"/>`).join("")}
  ${cats.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line)"/>`; }).join("")}
  <polygon points="${val}" fill="var(--accent)" fill-opacity=".22" stroke="var(--accent)" stroke-width="2"/>
  ${cats.map((c, i) => {
    // 観点名と％を2行に分けて、小さい画面でも文字を大きく出す
    const [x, y] = pt(i, 1.2), mid = Math.abs(x - cx) < 8, anc = mid ? "middle" : (x > cx ? "start" : "end");
    const y1 = mid ? (y < cy ? y - 20 : y + 8) : y - 6;
    return `<text x="${x.toFixed(1)}" y="${y1.toFixed(1)}" font-size="20" text-anchor="${anc}" fill="var(--ink)">${esc(c.short)}<tspan x="${x.toFixed(1)}" dy="22" fill="var(--muted)">${Math.round(c.pts / c.points * 100)}%</tspan></text>`; }).join("")}
  <text x="${cx + 3}" y="${cy - r * .5 + 5}" font-size="14" fill="var(--muted)">50%</text>
 </svg>`;
}

function markOf(p) { return p >= .8 ? ["◎", "var(--good)"] : p >= .55 ? ["○", "var(--accent)"] : p >= .35 ? ["△", "var(--warn)"] : ["×", "var(--bad)"]; }

// 二人の回答を突き合わせる。差はいつも「妻の回答 − 夫の回答」
function compareData(rec, res, pr) {
  const self = { d: rec.d, pts: rec.pts, res, from: st.src === "got" ? "受け取ったURL" : "この端末" };
  const pair = { d: pr.d, pts: pr.pts, res: compute(pr.pts), from: pr.from };
  const [h, w] = rec.mode === "h" ? [self, pair] : [pair, self];
  const who = cleanName(rec.n || pr.n) ? `${cleanName(rec.n || pr.n)}さん` : "夫";
  const plain = t => t.replaceAll("{s}", who).replaceAll("{w}", "妻");
  const rows = CATS.map((c, i) => { const hv = r1(h.res.cats[i].pts), wv = r1(w.res.cats[i].pts); return { c, hv, wv, diff: r1(wv - hv) }; });
  const big = rows.filter(r => Math.abs(r.diff) >= 2);
  const per = id => CATS.find(c => c.id === id).points / Q.filter(q => q.cat === id).length;
  // 1問ずつ：答えが2段階以上分かれた質問（差が大きい順、同じなら配点の大きい順）。画面には上から5問だけ出す
  const all = Q.map((q, i) => ({ i, q, hp: h.pts[i], wp: w.pts[i], diff: w.pts[i] - h.pts[i], wt: per(q.cat),
    text: plain(q.text), ha: plain(q.choices[3 - h.pts[i]]), wa: plain(q.choices[3 - w.pts[i]]) }));
  const split = all.filter(g => Math.abs(g.diff) >= 2).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.wt - a.wt);
  const gaps = split.slice(0, 5), gapCount = split.length;
  // 来週から夫が引き受ける1つ：妻の答えが低い質問のうち、夫の自己評価との差が大きく、配点の大きいもの
  const focus = all.filter(g => g.wp <= 1).sort((a, b) => a.diff - b.diff || b.wt - a.wt || a.wp - b.wp)[0] || null;
  const diff = w.res.total - h.res.total;
  const headline = Math.abs(diff) <= 5
    ? (gapCount || big.length
      ? `合計の差は${Math.abs(diff)}点と近い結果です。${gapCount ? `ただ、1問ずつ見ると、答えが2段階以上分かれた質問が${gapCount}問あります。` : "観点ごとに見ると、差が出たところもあります。"}`
      : `二人の見え方はかなり近く、合計の差は${Math.abs(diff)}点です。お互いのことをよく見ている夫婦です。`)
    : diff > 0
      ? `妻から見た${who}は、自己評価より${diff}点高い結果です。${who}が思っている以上に、妻に届いていることがあります。`
      : `${who}の自己評価が、妻から見た評価より${-diff}点高い結果です。この差は、${who}が引き受けられることを見つけるチャンスです。`;
  // 画面では下に質問の一覧が続くので、ひと言足す（LINEの文章には足さない）
  const lead = headline + (diff < -5 ? (gapCount ? "下の質問を二人で見ると、どこから始めればいいかがはっきりします。" : big.length ? "下の観点ごとの差を二人で見ると、どこから始めればいいかがはっきりします。" : "下の観点別で、差のマイナスがいちばん大きいところから二人で話してみると、始めやすくなります。") : "");
  return { h, w, who, rows, big, gaps, gapCount, focus, diff, headline, lead };
}

function compareView(rec, res, pr) {
  const D = compareData(rec, res, pr), { h, w, who } = D;
  const sign = v => (v > 0 ? "+" : "") + v;
  const bar = (label, v, max, color) => `<div class="bar"><span>${label}</span><div class="t"><span style="width:${v / max * 100}%;background:${color}"></span></div><span class="v">${v.toFixed(1)}/${max}</span></div>`;
  const neg = D.big.filter(r => r.diff < 0).map(r => esc(r.c.short)), pos = D.big.filter(r => r.diff > 0).map(r => esc(r.c.short));
  const catNote = [
    neg.length ? `「${neg.join("」「")}」は、${esc(who)}が思っているほどには、まだ妻に届いていない観点です。` : "",
    pos.length ? `「${pos.join("」「")}」は、${esc(who)}の自己評価より、妻の評価のほうが高い観点です。` : "",
  ].join("") || (Math.abs(D.diff) <= 5 ? "観点ごとに見ても、二人の見え方はほぼ同じです。" : `どの観点も差は2点未満ですが、小さな差が重なって、合計で${Math.abs(D.diff)}点の差になっています。`);
  // 差がいちばん大きい観点（観点ごとの差がどれも小さいときの話のきっかけに使う）
  const widest = [...D.rows].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
  // 妻の評価が夫の自己評価をいちばん下回った観点（差を縮める先の勧めに使う）
  const lowest = [...D.rows].sort((a, b) => a.diff - b.diff)[0];
  const PRAISE = ["が思っている以上に、妻はここを評価しています。今のやり方が、ちゃんと届いています。", "のここは、妻からの評価が高いところです。続けるほど、妻の安心につながります。"];
  const tagOf = g => `<span class="tag">${esc(CATS.find(c => c.id === g.q.cat).short)}・Q${g.i + 1}</span>`;
  const gapItem = (g, k) => `<li><p class="gq">${tagOf(g)}${esc(g.text)}</p>
   <div class="ga"><span class="who h">夫</span>${esc(g.ha)}</div><div class="ga"><span class="who w">妻</span>${esc(g.wa)}</div>
   <p class="small">${g.diff < 0 ? `妻には、まだ届ききっていないところです。${esc(g.q.advice)}` : `${esc(who)}${PRAISE[k % 2]}`}</p></li>`;
  // 引き受ける1つが上の一覧にも出ているときは、同じアドバイスを2回出さない
  const focusShown = D.focus && D.gaps.some(g => g.i === D.focus.i);
  const plan = [
    [`今週：15分だけ、ふたりで答え合わせ`, D.gaps.length
      ? `上の「答えが分かれた質問」を1つずつ、妻にそう答えた理由を聞いてみると、${esc(who)}が気づいていなかった家事や気持ちが見えてきます。`
      : Math.abs(D.diff) <= 5 && !D.big.length
        ? (D.w.res.total >= 55
          ? `答えが近かった理由を二人で話してみると、今の分担のいいところがはっきりして、自信になります。`
          : `二人とも、同じところを低めに見ています。下の「来週から」の1つを、いつ・どこまでやるかまで二人で決めると、すぐに動き出せます。`)
        : `上の観点別で${D.big.length ? "差が大きかった観点を1つ選んで" : D.diff < 0 ? `妻の評価が${esc(who)}の自己評価をいちばん下回った「${esc(lowest.c.short)}」について` : `いちばん差が大きかった「${esc(widest.c.short)}」について`}、妻にそう答えた理由を聞いてみると、${esc(who)}が気づいていなかった家事や気持ちが見えてきます。`],
    D.focus
      ? [`来週から：${esc(who)}が引き受ける1つ`, `${tagOf(D.focus)}${focusShown
        ? `上の「答えが分かれた質問」にもある1問です。ここを1つ受け持つと、妻がいちばん変化を感じやすくなります。`
        : esc(D.focus.q.advice)}`]
      : D.diff > 5
        ? [`来週から：今のやり方を続けながら`, `妻の答えが0〜1点の質問はありません。妻から見ると、${esc(who)}は自己評価以上にできています。今のやり方を続けながら「ほかに受け持てることある？」と妻に1つ聞いてみると、次の答え合わせも楽しみになります。`]
        : Math.abs(D.diff) <= 5 && !neg.length
          ? [`来週から：今の分担のままで`, `妻の答えが低めの質問は見当たりません。今の分担を二人で書き出して残しておくと、忙しい時期が来ても同じ形に戻しやすくなります。`]
          : [`来週から：${esc(who)}がもう1つ受け持つこと`, `妻の答えが0〜1点の質問はありません。${neg.length ? `上の観点別で妻の評価が${esc(who)}の自己評価を下回った観点` : D.gaps.length || D.big.length ? `上の観点別で妻の評価が${esc(who)}の自己評価をいちばん下回った「${esc(lowest.c.short)}」` : `今週話した「${esc(lowest.c.short)}」`}から、${esc(who)}が受け持てることを1つ妻と決めると、次の答え合わせで差が縮みやすくなります。`],
    ...(pos.length ? [[`続けたいこと：妻の評価が高めのところ`, `「${pos.join("」「")}」は、妻の評価が${esc(who)}の自己評価を上回った観点です。「ここ、助かってる？」と聞いてみると、うれしい言葉が返ってくるかもしれません。`]] : []),
    [`1か月後：もう一度ふたりで答え合わせ`, `同じ質問にもう一度答えると、差が縮んだところが数字で分かります。小さな変化も、二人の励みになります。`],
  ];
  return `<section class="panel" id="sec-cmp"><h2>ふたりの答え合わせ</h2>
  <p class="cmp-lead">${esc(D.lead)}</p>
  <p class="small muted">夫の回答：${fmtDate(h.d)}（${h.from}）／妻の回答：${fmtDate(w.d)}（${w.from}）</p>
  <div class="legend"><span><i style="background:var(--accent)"></i>夫の回答</span><span><i style="background:var(--stamp)"></i>妻の回答</span></div>
  <ul class="cmp">${D.rows.map(r => `<li><span class="name">${esc(r.c.name)}</span><span class="diff${r.diff <= -2 ? " big" : r.diff >= 2 ? " good" : ""}">差 ${(r.diff > 0 ? "+" : "") + r.diff.toFixed(1)}</span>
   <div class="bars">${bar("夫", r.hv, r.c.points, "var(--accent)")}${bar("妻", r.wv, r.c.points, "var(--stamp)")}</div></li>`).join("")}</ul>
  <div class="cmp-total"><span>合計</span><span>夫 ${h.res.total}点／妻 ${w.res.total}点（差 ${sign(D.diff)}）</span></div>
  <p class="small muted">差は「妻の回答 − 夫の回答」です。マイナスは妻から見た評価のほうが低いところ、プラスは妻から見た評価のほうが高いところです。点数は、答えの点を高めに換算した値です。</p>
  <p class="note">${catNote}</p>
  <h3 class="sub">答えが分かれた質問</h3>
  ${D.gapCount > D.gaps.length ? `<p class="small muted">答えが2段階以上分かれた質問は${D.gapCount}問あります。差の大きい順に${D.gaps.length}問を出しています。</p>` : ""}
  ${D.gaps.length ? `<ul class="gaps">${D.gaps.map(gapItem).join("")}</ul>` : Math.abs(D.diff) <= 5 && !D.big.length
    ? `<p class="small">1問ずつ見ても、答えが大きく分かれた質問はありません。${D.w.res.total >= 55 ? "二人の見え方がそろっている、いい状態です。" : "二人とも同じところを低めに見ているので、どこから始めるかを決めやすい状態です。"}</p>`
    : `<p class="small">2段階以上分かれた質問はありません。${D.big.length ? "1段階ずつの小さなズレが積み重なって、上の観点ごとの差になっています。" : "差は、1段階ずつの小さなズレから生まれています。"}</p>`}
  <h3 class="sub">ふたりのアクションプラン</h3>
  <ol class="plan">${plan.map(([t, d]) => `<li><strong>${t}</strong><span>${d}</span></li>`).join("")}</ol>
 </section>`;
}

function shareView(rec, res, pr) {
  const line = `https://line.me/R/share?text=${encodeURIComponent(summary(rec, res))}`;
  const inUrl = [pr && !st.noPr ? "相手の回答" : "", rec.n ? "名前" : ""].filter(Boolean).join("と");
  return `${pr ? `<label class="check small"><input type="checkbox" data-act="toggle-pr"${st.noPr ? "" : " checked"}>${MODES[other(rec.mode)].who}の回答と答え合わせも入れて送る（夫婦の間で送るとき）</label>` : ""}
  <div class="row">
   <a class="btn" href="${line}" target="_blank" rel="noopener">LINEで送る</a>
   <button class="btn ghost" data-act="copy">結果をコピー</button>
  </div>
  <div class="row"><button class="link" data-act="copy-url">URLだけコピー</button>${navigator.share ? `<button class="link" data-act="share">ほかのアプリで送る</button>` : ""}</div>
  <p class="toast" id="toast" aria-live="polite"></p>
  <textarea id="copybox" readonly hidden aria-label="コピー用の文章"></textarea>
  <p class="small muted">回答はURLの中に数字で入っているだけです${inUrl ? `（${inUrl}もURLに入ります）` : ""}。このアプリから自動で送信されることはなく、LINEなどで送ったときだけ、送った相手にこの結果が見えます。</p>`;
}

function resultView() {
  const rec = st.rec, m = rec.mode, res = compute(rec.pts), R0 = res.rank, o = other(m);
  const sample = st.src === "sample", got = st.src === "got", pr = pairFor(rec);
  // 画面を読んでいる人：受け取った結果なら回答者の相手、それ以外は回答者
  const viewer = got ? o : m;
  // 受け取った結果で、この端末に読む人（回答者の相手）の回答がもうあるとき：残せばすぐ答え合わせが出る
  const mine = got && !st.kept && st.justKept !== "newer" && !pr ? load()[o] : null;
  // 残した／この端末に同じ日以降の回答があって残せなかったときは、「残す」の案内とボタンを出さない
  const noKeep = st.kept || st.justKept === "newer";
  // 残せなかったとき：答えて比べる相手は、受け取った結果ではなくこの端末にある回答になる
  // 比べる相手は partnerOf と同じ選び方（この端末で答えた回答と、受け取って残した回答のうち新しいほう）
  const newerRec = got && st.justKept === "newer" && !pr ? partnerOf(o) : null, newerMine = newerRec ? load()[o] : null;
  const above = res.total >= DIST.mean;
  const toc = pr
    ? [["sec-cmp", "答え合わせ"], ["sec-cats", "観点別"], ["sec-steps", "次の一手"]]
    : [["sec-cats", "観点別"], ["sec-steps", "次の一手"], ["sec-next", sample ? "答えてみる" : mine ? "答え合わせを出す" : newerMine ? "前回の結果" : got ? "答えて比べる" : `${MODES[o].who}にも聞く`]];
  const rankRule = C.ranks.map((r, i) => `${esc(r.mark)}${i === 0 ? r.min + "点以上" : i === C.ranks.length - 1 ? C.ranks[i - 1].min - 1 + "点以下" : r.min + "〜" + (C.ranks[i - 1].min - 1) + "点"}`).join("／");
  const askOther = got
    ? `<h2>${MODES[o].who}のあなたが答えると、ズレが分かります</h2>
  <p class="small">${o === "h" ? "同じ質問に「あなたは〜」の形で答えると、妻の採点と自己採点が何点ズレるかが出ます。" : "同じ質問に「夫は〜」の形で答えると、夫の自己採点と妻の採点が何点ズレるかが出ます。"}${newerRec ? `受け取った結果はこの端末に残していないため、このスマホで答えると、この端末にある${MODES[m].who}の回答（${fmtDate(newerRec.d)}）と比べます。` : "このスマホで答えれば、受け取った結果とそのまま比べられます。"}</p>`
    : `<h2>${MODES[o].who}も答えると、ズレが分かります</h2>
  <p class="small">${o === "w" ? "同じ質問に妻が「夫は〜」の形で答えると、二人の評価のズレが分かります。" : "夫本人にも「あなたは〜」の形で答えてもらうと、二人の評価のズレが分かります。"}同じスマホで続けて答えても、別のスマホで答えて結果のURLをLINEで送ってもらっても比べられます。点数そのものより、ズレが大きい観点こそ、二人で話すいちばんのきっかけになります。</p>`;
  const nextBody = sample
    ? `<h2>自分たちで答えてみる</h2>
  <p class="small">サンプルと同じ${Q.length}問に答えると、自分たちの点数と次の一手が出ます。夫婦それぞれが答えると、二人の評価のズレも比べられます。</p>
  <div class="row"><button class="btn" data-act="start" data-mode="h">夫が自分で答える</button><button class="btn ghost" data-act="start" data-mode="w">妻が夫について答える</button></div>
  <div class="row"><button class="link" data-act="home">最初の画面へ</button></div>`
    : `${pr ? "" : mine ? `<h2>答え合わせを出す</h2>
  <p class="small">この端末にある${MODES[o].who}のあなたの回答（${fmtDate(mine.d)}）と、受け取った結果を比べられます。うちの家庭の結果なら、残すとすぐに答え合わせが出ます。</p>` : newerMine ? `<h2>答え合わせは「前回の結果」から</h2>
  <p class="small">この端末には、${MODES[m].who}が同じ日かそれより後に答えた回答（${fmtDate(newerRec.d)}）があるため、受け取った結果は残していません。その回答と${MODES[o].who}のあなたの回答（${fmtDate(newerMine.d)}）の答え合わせは、最初の画面の「前回の結果」から開けます。</p>` : askOther}
  <div class="row">
   ${pr || newerMine ? "" : mine ? `<button class="btn" data-act="keep">うちの結果として残す</button>` : `<button class="btn" data-act="start" data-mode="${o}">${got ? `${MODES[o].who}として答えて比べる` : `${MODES[o].label}の回答を始める`}</button>`}
   ${st.src === "own" ? `<button class="btn ghost" data-act="edit">回答を見直す</button>` : ""}
   <button class="btn ghost" data-act="home">最初の画面へ</button>
  </div>`;
  return `${got ? `<div class="notice" role="status">
   <p>共有された結果を表示しています（回答者：${MODES[m].label}・${fmtDate(rec.d)}）。</p>
   ${st.justKept === true && pr ? `<p>この端末に残し、${MODES[o].who}のあなたの回答と比べた「ふたりの答え合わせ」を下に出しました。</p>`
    : st.justKept === "newer" ? `<p>この端末に、${MODES[m].who}が同じ日かそれより後に答えた回答があるため、受け取った結果は残していません。${pr ? "下の「ふたりの答え合わせ」は、この画面を開いている間だけの表示です。" : ""}</p>`
    // justKept は「残す」を押すまで undefined（「前回の結果」から開いた画面には出さない）
    : st.kept && st.justKept !== undefined ? `<p>この端末の「前回の結果」に残しました。次からは最初の画面から開けます。</p>` : ""}
   ${pr || st.justKept === "newer" ? "" : mine
    ? `<p>この端末に、${MODES[o].who}のあなたの回答（${fmtDate(mine.d)}）があります。うちの家庭の結果なら「うちの結果として残す」を押すと、すぐに答え合わせが出ます。</p>`
    : `<p>${MODES[o].who}のあなたも答えると、二人の評価のズレが表示されます。</p>`}
   ${noKeep || mine ? "" : `<p class="small">うちの家庭の結果なら、残しておくと最初の画面の「前回の結果」から開けて、この端末の回答とも比べられます。ほかの家庭の結果なら、残さなくて大丈夫です。</p>`}
   ${(pr || st.justKept === "newer") && noKeep ? "" : `<div class="row">${pr || mine ? "" : `<button class="btn" data-act="start" data-mode="${o}">${MODES[o].who}として答えて比べる</button>`}${noKeep ? "" : `<button class="btn${mine ? "" : " ghost"}" data-act="keep">うちの結果として残す</button>`}</div>`}
  </div>` : ""}
 <section class="panel hero">
  <div class="card-head"><div><span class="label">${sample ? "サンプル回答の結果" : "採点結果"}</span><h1 class="result-title">${esc(titleOf(rec.n))}</h1></div>
   <div class="small muted" style="text-align:right;margin-left:auto">回答者：${MODES[m].label}・${fmtDate(rec.d)}</div></div>
  <div class="hero-main"><div class="score">${res.total}<small> / 100点</small></div>
   <div class="stamp" role="img" aria-label="評価 ${esc(R0.mark)}">${esc(R0.mark)}</div></div>
  <div><p class="rank-title">${esc(R0.title)}</p><p class="small muted">${esc(got && !st.kept ? R0.msg.replaceAll("{s}", rec.n ? `${rec.n}さん` : "夫").replaceAll("{w}", "妻") : fmt(R0.msg, viewer, rec.n))}</p></div>
  <p class="pct-line">偏差値 <span class="num hensa">${res.hensa}</span><span class="small muted">（目安）</span>　<span class="small" style="white-space:nowrap">${above ? `上位 約${res.top}%` : `仮の平均まで あと${DIST.mean - res.total}点`}</span></p>
  ${sample ? "" : shareView(rec, res, pr)}
  <p class="note">偏差値・上位％・仮の平均は、全国の夫の点数分布のデータがないため、平均${DIST.mean}点・標準偏差（点数のばらつきの幅）${DIST.sd}点の分布を仮に置いて計算した目安です。</p>
  <details class="more"><summary>分布のグラフとランクの基準を見る</summary>${curveSVG(res.total)}<p class="small muted">山の形は平均${DIST.mean}点・標準偏差${DIST.sd}点の仮の分布で、実際の回答を集めたものではありません。${above ? `濃い部分が「上位 約${res.top}%」にあたります。` : ""}</p><p class="small muted">評価：${rankRule}</p></details>
 </section>
 <nav class="toc" aria-label="結果の目次">${toc.map(([id, l]) => `<button data-act="jump" data-to="${id}">${l}</button>`).join("")}</nav>
 ${pr ? compareView(rec, res, pr) : ""}
 <section class="panel" id="sec-cats"><h2>観点別の成績</h2>
  <div class="two"><div class="tbl-wrap" style="min-width:0"><table><thead><tr><th>観点</th><th class="n">点数</th><th></th><th>評価</th></tr></thead><tbody>
  ${res.cats.map(c => { const p = c.pts / c.points, [mk, col] = markOf(p); return `<tr><td>${esc(c.name)}</td><td class="n">${f1(c.pts)}<span class="muted"> / ${c.points}</span></td><td style="width:26%"><div class="mini"><span style="width:${p * 100}%;background:${col}"></span></div></td><td class="mark" style="color:${col}">${mk}</td></tr>`; }).join("")}
  </tbody></table></div>${radarSVG(res.cats)}</div>
  <p class="small muted">◎ 80%以上　○ 55%以上　△ 35%以上　× 35%未満</p>
  <p class="small muted">点数と％は、答えの点をそのまま割合にせず、高めに換算しています（全問で上から3番目の答え＝満点の3分の1でも59点、2番目なら82点）。</p>
 </section>
 <section class="panel" id="sec-steps"><h2>次の一手</h2>
  ${res.steps.length ? `<p class="small muted">点数が低めだった質問を、伸ばせる点の大きい順に並べています。${viewer === "w"
    ? "夫が1つ引き受けるたびに、毎日に少しずつゆとりが生まれます。まずは1番目を、来週1回だけ夫に受け持ってもらうところから始められます。"
    : "1つ引き受けるたびに、妻の毎日に少しずつゆとりが生まれます。まずは1番目を来週1回やってみるだけでも、妻にはちゃんと伝わります。"}</p>
  <ol class="steps">${res.steps.map(s => `<li><span class="tag">${esc(s.cat)}・Q${s.i + 1}</span>${esc(s.adv)}</li>`).join("")}</ol>`
  : `<p>${m === "h" && pr && pr.pts.some(v => v <= 1)
    ? `${viewer === "h" ? "あなた" : "夫"}の回答では、0〜1点の質問はありません。上の「ふたりの答え合わせ」で妻の答えが低めだった質問から1つ選ぶと、それがそのまま次の一手になります。`
    : "回答を見ると、どの質問も上から1〜2番目の答えで、低めの質問はありません。3か月に1回、二人で分担を見直す時間があると、今の形を続けやすくなります。"}</p>`}
  ${res.weakest.pts / res.weakest.points < 0.8 ? `<p class="note"><strong>妻がいちばん喜びそうな観点：${esc(res.weakest.name)}</strong><br>${esc(res.weakest.advice)}</p>` : ""}
 </section>
 <section class="panel" id="sec-next">
  ${nextBody}
 </section>`;
}

function summary(rec, res) {
  const top2 = res.steps.slice(0, 2);
  const pair = pairFor(rec), pr = st.noPr ? null : pair, D = pr && compareData(rec, res, pr);
  const cmp = D ? [
    RULE, "■ ふたりの答え合わせ", RULE,
    `・夫の自己採点 ${D.h.res.total}点／妻の採点 ${D.w.res.total}点（差 ${D.diff > 0 ? "+" : ""}${D.diff}）`,
    `・${D.headline}`,
    // 合計が近いときは、上の文に同じ数が入っているので重ねない
    ...(D.gapCount && Math.abs(D.diff) <= 5 ? [] : [`・答えが2段階以上分かれた質問：${D.gapCount}問`]),
    ...(D.focus ? [`・来週から：${D.focus.q.advice}`] : []),
  ] : [];
  return [
    `「${C.appName}」の結果です（回答：${MODES[rec.mode].label}・${fmtDate(rec.d)}）`,
    `${titleOf(rec.n)} ${res.total}点（${res.rank.mark}・${res.rank.title}）`,
    `偏差値 ${res.hensa}・${res.total >= DIST.mean ? `上位 約${res.top}%` : `仮の平均（${DIST.mean}点）まであと${DIST.mean - res.total}点`}（全国統計ではなく、平均${DIST.mean}点・標準偏差${DIST.sd}点の仮の分布で計算した目安）`,
    "",
    RULE, "■ 観点別（答えの点を高めに換算した点数）", RULE,
    ...res.cats.map(c => `・${c.short} ${f1(c.pts)}/${c.points}`),
    ...(D ? cmp : top2.length ? [RULE, "■ 次の一手", RULE, ...top2.map(s => `・${s.adv}`)] : []),
    "",
    D ? "結果を開く（ふたりの答え合わせも見られます）" : pair ? "結果を開く" : "結果を開く（あなたも答えると、二人の採点が何点ズレるか比べられます）",
    shareUrl(rec, pr),
  ].join("\n");
}

/* ---------- 回答の操作 ---------- */
function saveDraft() { const sv = load(); sv.drafts = draftsOf(sv); sv.drafts[st.mode] = encode(st.pts); delete sv.draft; save(sv); }

// 質問画面に入るときは履歴を1件積む。スマホの「戻る」で、アプリの外に出ずに前の質問へ戻れるように
function enterQuiz(next) {
  // 質問に入る前の画面（最初の画面・サンプル・結果）を覚えておく（答え終わったあとの「最初の画面へ」で使う）
  const below = location.hash ? "result" : history.state && history.state.sample ? "sample" : "start";
  history.pushState({ q: 1 }, "", location.pathname + location.search);
  go({ ...next, below });
}

// backTo：答え始めをやめたとき、フォーカスを戻す場所（押したボタンのある欄）
function startQuiz(mode, backTo = "#sec-next h2") {
  // 受け取った結果から答え始めるときは、うちの家庭の結果かを先に確かめて残す（ほかの家庭の結果と混ざらないように）
  let inherit = st.view === "result" && st.rec && st.src === "own" ? st.rec.n : "";
  // 「残す」で残せなかった（この端末に同じ回答者の同じ日以降の回答がある）結果は、残さず名前も引き継がない
  if (st.view === "result" && st.src === "got" && st.justKept !== "newer") {
    const cur = load()[st.rec.mode];
    if (!st.kept && cur && cur.d >= st.rec.d) {
      // この端末に同じ回答者の同じ日以降の回答があるときは残せない（keepGot が "newer" を返す条件と同じ）。比べる相手だけを確かめ、名前も引き継がない
      st.justKept = "newer";
      if (!confirm(`この端末に、${MODES[st.rec.mode].who}が同じ日かそれより後に答えた回答（${fmtDate(cur.d)}）があるため、表示中の結果は残しません。答えたあとは、この端末にある${MODES[st.rec.mode].who}の回答と比べます。よろしいですか？`)) { render(backTo); return; }
    } else {
      if (!st.kept && !confirm(`表示中の結果（${st.rec.n ? st.rec.n + "さん・" : ""}${MODES[st.rec.mode].label}・${fmtDate(st.rec.d)}）を、うちの家庭の結果としてこの端末に残し、答えたあとに比べます。よろしいですか？\n（ほかの家庭の結果なら「キャンセル」を押して、最初の画面から答えてください）`)) return;
      if (!st.kept && !keepGot()) return;
      inherit = st.rec.n;
    }
  }
  const sv = load(), dr = draftsOf(sv)[mode];
  const pts = dr && dr.length === Q.length ? decode(dr) : Array(Q.length).fill(null);
  const first = pts.indexOf(null);
  // この端末に名前がなければ、表示中の結果（受け取ったURL）の名前を引き継ぐ
  const name = cleanName(sv.name) || cleanName(inherit);
  if (name && !sv.name) { sv.name = name; save(sv); }
  enterQuiz({ view: "q", mode, step: first < 0 ? Q.length - 1 : first, pts, name });
}

function pick(k) {
  if (locked) return;
  locked = true;
  st.pts[st.step] = 3 - k;
  if (!st.editing) saveDraft();
  app.querySelectorAll(".choice").forEach((b, j) => { b.classList.toggle("is-on", j === k); b.setAttribute("aria-pressed", j === k); });
  app.classList.add("locked");
  pickTimer = setTimeout(forward, 230);
}

// 観点が変わるときは区切りを1秒見せる（まだ答えていない観点に進むときだけ）
let interTimer = 0, pickTimer = 0;
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
  finish();
}

function finish() {
  const miss = st.pts.indexOf(null);
  if (miss >= 0) { st.step = miss; st.interlude = false; locked = false; render(); return; }
  const rec = { mode: st.mode, pts: st.pts, d: today(), n: st.name || "" };
  const sv = load(), old = sv[rec.mode], a = encode(rec.pts);
  // 見直して答え直す前の版を5つまで覚えておく（ブラウザで戻って前の版のURLを開いたとき、自分の回答だと分かるように）
  const prev = old ? [old.a, ...(old.prev || [])].filter((x, i, arr) => x !== a && arr.indexOf(x) === i).slice(0, 5) : [];
  sv[rec.mode] = { a, d: rec.d, n: rec.n, ...(prev.length ? { prev } : {}) };
  if (sv.drafts) delete sv.drafts[rec.mode];
  delete sv.draft; save(sv);
  // 質問の画面の履歴を結果に置き換える。最初の画面から答えたときは、「最初の画面へ」で下の履歴に戻れるよう印を付ける
  history.replaceState(st.below === "start" && !st.editing ? { view: 1 } : null, "", shareUrl(rec, partnerOf(rec.mode)));
  go({ view: "result", rec, src: "own" });
}

function back() {
  clearTimeout(pickTimer); locked = false; app.classList.remove("locked");
  if (st.interlude) { clearTimeout(interTimer); st.interlude = false; }
  if (st.step === 0) {
    // 質問に入るときに積んだ履歴を戻す（popstate で前の画面に戻る）
    if (history.state && history.state.q) history.back(); else go({ view: "start" });
    return;
  }
  st.step--; render();
}

// 同じ文でも読み上げ直されるよう、いったん空にしてから入れる
function toast(msg) { const t = document.getElementById("toast"); if (!t) return; t.textContent = ""; setTimeout(() => { t.textContent = msg; }, 60); }
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
    // 受け取った結果は、ここでは残さない（「うちの結果として残す」を押すか、答えて比べるときに残す）
    const sv = load(), a = encode(h.rec.pts);
    const own = sv[h.rec.mode] && sv[h.rec.mode].a === a;
    // この端末で前に答えた版（見直す前の回答）と同じなら、自分の結果として扱う。ほかの家庭の結果は日付にかかわらず「受け取った結果」
    const mineOld = !own && !!sv[h.rec.mode] && (sv[h.rec.mode].prev || []).includes(a);
    const kept = !own && !mineOld && !!(sv.got && sv.got[h.rec.mode] && sv.got[h.rec.mode].a === a);
    // この端末に同じ回答者の同じ日以降の回答があるときは、残せないこと（keepGot の "newer" と同じ条件）を開いた時点で示す
    const newer = !own && !mineOld && !kept && !!sv[h.rec.mode] && sv[h.rec.mode].d >= h.rec.d;
    go({ view: "result", rec: h.rec, src: own || mineOld ? "own" : "got", kept, urlPartner: h.partner, ...(newer ? { justKept: "newer" } : {}) });
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
  else if (act === "finish") { if (!locked) finish(); }
  else if (act === "back") back();
  else if (act === "start") startQuiz(b.dataset.mode, b.closest(".notice") ? ".notice" : "#sec-next h2");
  else if (act === "sample") { history.pushState({ sample: 1, view: 1 }, "", location.pathname + location.search); showSample(); }
  else if (act === "open") {
    const sv = load(), slot = b.dataset.slot, isGot = slot.startsWith("got-"), m = slot.slice(-1);
    const s = isGot ? sv.got[m] : sv[m], rec = { mode: m, pts: decode(s.a), d: s.d, n: cleanName(s.n) };
    st = { view: "result", rec, src: isGot ? "got" : "own", kept: true };
    // 履歴を積む（スマホの「戻る」で最初の画面に戻れるように）
    history.pushState({ view: 1 }, "", shareUrl(rec, partnerOf(m))); go(st);
  }
  // 1件だけ消す（ほかの家庭の結果URLを開いてしまったときなど）
  else if (act === "forget") {
    const sv = load(), slot = b.dataset.slot, m = slot.slice(-1);
    if (!confirm("この結果の記録を、この端末から消します。よろしいですか？")) return;
    if (slot.startsWith("got-")) { if (sv.got) delete sv.got[m]; } else delete sv[m];
    save(sv); render([".history [data-act='open']", ".modes .mode"]);
  }
  else if (act === "clear-draft") {
    const m = b.dataset.mode;
    if (!confirm(`${MODES[m].who}が途中まで答えた回答を消します。よろしいですか？`)) return;
    const sv = load(); sv.drafts = draftsOf(sv); delete sv.drafts[m]; delete sv.draft; save(sv); render(".modes .mode");
  }
  else if (act === "keep") {
    const had = !!pairFor(st.rec);
    const k = keepGot();
    if (!k) return;
    const msg = k === "newer" ? `この端末に、${MODES[st.rec.mode].who}が同じ日かそれより後に答えた回答があるため、受け取った結果は残していません。` : "この端末の「前回の結果」に残しました。";
    // true＝残して初めて答え合わせが出た／"newer"＝残さなかった／false＝前から答え合わせが出ていた
    st.justKept = k === true ? !had : k;
    // 残して初めて答え合わせが出たときだけ、そこへ移る
    if (st.justKept === true && pairFor(st.rec)) {
      render("#sec-cmp h2");
      const el = document.getElementById("sec-cmp");
      if (el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    } else render(b.closest("#sec-next") ? "#sec-next h2" : ".notice");
    toast(msg);
  }
  else if (act === "toggle-pr") { st.noPr = !b.checked; setHash(st.rec, st.noPr ? null : pairFor(st.rec)); render("[data-act='toggle-pr']"); }
  else if (act === "wipe") {
    if (!confirm("このアプリが端末に残した回答・受け取った結果・夫の名前をすべて消します（ブラウザの閲覧履歴やLINEのトークに残った結果のURLは消えません）。よろしいですか？")) return;
    try { localStorage.removeItem(KEY); } catch (err) {}
    clearHash(); go({ view: "start" });
  }
  else if (act === "edit") { const rec = st.rec; enterQuiz({ view: "q", mode: rec.mode, step: 0, pts: rec.pts.slice(), name: rec.n || "", editing: true }); }
  // 「前回の結果」やサンプルから来たときは、積んだ履歴を戻る（スマホの「戻る」が空振りしないように）
  else if (act === "home") { if (history.state && history.state.view) { history.back(); return; } clearHash(); go({ view: "start" }); }
  else if (act === "copy") copyText(summary(st.rec, compute(st.rec.pts)), "結果をコピーしました。LINEなどに貼り付けて送れます。");
  else if (act === "copy-url") copyText(shareUrl(st.rec, st.noPr ? null : pairFor(st.rec)), "URLをコピーしました。");
  else if (act === "share") {
    const txt = summary(st.rec, compute(st.rec.pts));
    navigator.share({ title: titleOf(st.rec.n), text: txt }).catch(() => {});
  }
  else if (act === "skip") endInterlude();
  // 目次：URLの #r= を壊さないよう、リンクではなくスクロールで移動する
  else if (act === "jump") {
    const el = document.getElementById(b.dataset.to);
    if (el) {
      el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      // 読み上げ・キーボードでも移った先から読めるよう、見出しにフォーカスを移す
      const hd = el.querySelector("h2, h3");
      if (hd) { hd.setAttribute("tabindex", "-1"); hd.focus({ preventScroll: true }); }
    }
  }
});

// 夫の名前は打つたびにこの端末に保存する（次に開いたときも残る）
document.addEventListener("input", e => {
  if (e.target.id !== "hname") return;
  const sv = load(); sv.name = cleanName(e.target.value); save(sv);
});

document.addEventListener("keydown", e => {
  if (e.target.id === "hname" && e.key === "Enter") { e.target.blur(); return; }
  if (st.view !== "q" || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
  if (/^[1-4]$/.test(e.key)) { e.preventDefault(); pick(+e.key - 1); }
  else if (e.key === "ArrowLeft") back();
  else if (e.key === "ArrowRight" && st.pts[st.step] != null && !locked) forward();
});

// 質問の途中で、下の popstate が積み直した履歴に戻ったとき（#なし）と、サンプルの履歴に戻ったときは、popstate に任せる
window.addEventListener("hashchange", () => { if (!location.hash && (st.view === "q" || (history.state && history.state.sample))) return; route(); });
// スマホの「戻る」：質問の途中なら1問前へ、最初の質問なら前の画面（サンプルか最初の画面）へ。結果のURLに戻るときは hashchange の route に任せる
window.addEventListener("popstate", () => {
  const onSample = !location.hash && !!(history.state && history.state.sample);
  if (st.view !== "q") {
    if (onSample) { if (st.src !== "sample") showSample(); }
    else if (st.view === "result" && st.src === "sample") go({ view: "start" });
    return;
  }
  if (st.step > 0 || st.interlude) { back(); history.pushState({ q: 1 }, "", location.pathname + location.search); }
  else if (!location.hash) { if (onSample) showSample(); else go({ view: "start" }); }
});
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
