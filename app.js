/* NCS PASS — 완전 내장형.
 *
 * 문항은 `data/bank.json` 하나에 다 들어 있다. 서버에 물어보지 않는다.
 * 사용자 기록(푼 것·틀린 것·복습 일정)은 이 기기의 localStorage 에만 남는다.
 * 둘을 섞지 않는다 — 콘텐츠를 새로 배포해도 기록이 날아가지 않는다.
 */
'use strict';

// ─────────────────────────────────────────────────────── 저장소
const KEY = 'ncsbank.v1';

const Store = {
  //  att   낱개 진도 (회차 제출도 여기 들어간다 — 오답노트·복습이 이걸 본다)
  //  srs   복습 일정
  //  exams 회차 성적 이력
  //  sit   응시 중인 회차 (하나만. 중단하고 나가도 이어진다)
  //  mark  북마크(b)·확인 필요(f)·메모
  d: { att: {}, srs: {}, exams: {}, sit: null, mark: {}, admin: false, seen: 0 },

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.d, JSON.parse(raw));
    } catch (e) { console.warn('기록을 읽지 못했다', e); }
  },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.d)); }
    catch (e) { console.warn('기록을 쓰지 못했다', e); }
  },

  /** 한 문항의 마지막 시도. 없으면 null */
  last(id) { const a = this.d.att[id]; return a ? a[a.length - 1] : null; },
  tried(id) { return !!this.d.att[id]; },
  /** 마지막 시도가 오답인 것만 오답노트에 남긴다 — 다시 맞히면 빠진다 */
  isWrong(id) { const l = this.last(id); return !!l && !l.k; },

  record(id, chosen, ok, ms) {
    (this.d.att[id] ||= []).push({ c: chosen, k: ok ? 1 : 0, t: Date.now(), m: ms | 0 });
    this.schedule(id, ok);
    this.save();
  },

  /** SM-2 를 줄인 것. 틀리면 처음으로 돌아가고, 맞히면 간격이 벌어진다. */
  schedule(id, ok) {
    const s = this.d.srs[id] || { e: 2.5, i: 0, due: 0 };
    if (!ok) {
      s.e = Math.max(1.3, s.e - 0.2);
      s.i = 0;
      s.due = Date.now() + 10 * 60 * 1000;      // 10분 뒤 다시
    } else {
      s.e = Math.min(2.8, s.e + 0.1);
      s.i = s.i === 0 ? 1 : s.i === 1 ? 3 : Math.round(s.i * s.e);
      s.due = Date.now() + s.i * 86400000;
    }
    this.d.srs[id] = s;
  },

  dueIds(all) {
    const now = Date.now();
    return all.filter(i => { const s = this.d.srs[i.id]; return s && s.due <= now; })
              .map(i => i.id);
  },

  reset() {
    this.d = { att: {}, srs: {}, exams: {}, sit: null, mark: {},
               admin: false, seen: 0 };
    this.save();
  },

  // ── 표시 ──────────────────────────────────────────────────────────
  markOf(id) { return this.d.mark[id] || null; },
  toggleMark(id, key) {
    const m = this.d.mark[id] || {};
    m[key] = m[key] ? 0 : 1;
    m.at = Date.now();
    if (!m.b && !m.f && !m.memo) delete this.d.mark[id];
    else this.d.mark[id] = m;
    this.save();
  },
  setMemo(id, memo) {
    const m = this.d.mark[id] || {};
    m.memo = memo; m.at = Date.now();
    if (memo) m.f = 1;                       // 메모를 남기면 확인 대상이다
    if (!m.b && !m.f && !m.memo) delete this.d.mark[id];
    else this.d.mark[id] = m;
    this.save();
  },
  marked(key) {
    return Object.entries(this.d.mark).filter(([, m]) => m[key])
      .sort((a, b) => b[1].at - a[1].at).map(([id]) => id);
  },

  // ── 회차 ──────────────────────────────────────────────────────────
  best(tag) {
    const h = this.d.exams[tag] || [];
    return h.length ? Math.max(...h.map(r => r.score / r.n)) : null;
  },
  history(tag) { return this.d.exams[tag] || []; },
};

// ─────────────────────────────────────────────────────── 데이터
const DB = {
  raw: null, items: [], byId: new Map(), admin: null,

  async load() {
    const r = await fetch('data/bank.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`bank.json 을 불러오지 못했다 (${r.status})`);
    this.raw = await r.json();
    this.items = this.raw.items;
    this.items.forEach(i => this.byId.set(i.id, i));
  },

  /** 관리자 자료는 **관리자 모드일 때만** 받는다. 평소에는 내려받지도 않는다. */
  async loadAdmin() {
    if (this.admin) return this.admin;
    const r = await fetch('data/admin.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('admin.json 없음');
    this.admin = (await r.json()).items;
    return this.admin;
  },

  track(id) { return this.raw.tracks.find(t => t.id === id); },
  round(tag) { return (this.raw.rounds || []).find(r => r.tag === tag); },
  /** 회차 문항을 **번호 순으로**. 인쇄본과 같은 차례여야 한다 */
  roundItems(tag) {
    return this.items.filter(i => i.rd === tag).sort((a, b) => a.no - b.no);
  },
  subjects(tr) { return this.raw.subjects.filter(s => s.tr === tr); },
  types(tr, sj) { return this.raw.types.filter(t => t.tr === tr && t.sj === sj); },
  passage(n) { return this.raw.passages[n]; },
  kwName(n) { return this.raw.keywords[n] ? this.raw.keywords[n].t : ''; },

  filter(f) {
    return this.items.filter(i =>
      (!f.tr || i.tr === f.tr) &&
      (!f.sj || i.sj === f.sj) &&
      (!f.ty || i.ty === f.ty) &&
      (f.kw == null || i.kw.includes(f.kw)));
  },
};

// ─────────────────────────────────────────────────────── 도우미
const $ = s => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t);
  if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CIRC = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

/** 통과율·진도 — 목록마다 쓴다 */
function progress(items) {
  let done = 0, ok = 0;
  for (const i of items) {
    const l = Store.last(i.id);
    if (l) { done++; if (l.k) ok++; }
  }
  return { n: items.length, done, ok, rate: pct(ok, done) };
}

function bar(p) {
  const b = el('div', 'bar');
  const i = el('i');
  i.style.width = pct(p.done, p.n) + '%';
  if (p.done === p.n && p.n) i.classList.add('good');
  b.append(i);
  return b;
}

function progText(p) {
  if (!p.done) return `${p.n}문항`;
  return `${p.done}/${p.n} · 정답률 ${p.rate}%`;
}

// ─────────────────────────────────────────────────────── 라우터
const routes = [];
const route = (re, fn) => routes.push([re, fn]);

function go(hash) { location.hash = hash; }

function render() {
  const path = (location.hash || '#/').slice(1);
  for (const [re, fn] of routes) {
    const m = re.exec(path);
    if (m) {
      $('#view').scrollTop = 0;
      window.scrollTo(0, 0);
      $('#view').className = 'view';
      $('#topRight').innerHTML = '';
      stopTick();               // 응시 화면을 떠나면 타이머를 멈춘다
      const base = '/' + path.split(/[?/]/).filter(Boolean)[0];
      document.querySelectorAll('.tabs a').forEach(a =>
        a.classList.toggle('on', a.dataset.tab === (path === '/' ? '/' : base)));
      $('#back').hidden = path === '/';
      fn(...m.slice(1).map(x => x && decodeURIComponent(x)));
      updateBadges();
      return;
    }
  }
  go('/');
}

function setTitle(t) { $('#title').textContent = t; }
function paint(node) { const v = $('#view'); v.innerHTML = ''; v.append(node); }

function updateBadges() {
  const w = DB.items.filter(i => Store.isWrong(i.id)).length;
  const d = Store.dueIds(DB.items).length;
  for (const [sel, n] of [['#wrongBadge', w], ['#dueBadge', d]]) {
    const b = $(sel); b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
  }
  $('#sitBadge').hidden = !Store.d.sit;      // 응시 중이면 점 하나
}

// ─────────────────────────────────────────────────────── 화면: 홈
route(/^\/$/, () => {
  setTitle('NCS PASS');
  const f = document.createDocumentFragment();

  // 상단 우측 — 돋보기
  const s = el('button', null, '🔍');
  s.setAttribute('aria-label', '검색');
  s.onclick = () => go('/search');
  $('#topRight').append(s);

  const due = Store.dueIds(DB.items).length;
  const wrong = DB.items.filter(i => Store.isWrong(i.id)).length;
  const all = progress(DB.items);
  const sit = Store.d.sit;

  if (sit) {
    const r = DB.round(sit.tag);
    const left = sitLeft(sit);
    const a = el('a', 'resume');
    a.href = `#/exam/${sit.tag}`;
    a.innerHTML = `<div class="rt">「${esc(r.title)}」 푸는 중</div>
      <div class="rs">${Object.keys(sit.ans).length}/${r.n}문항 ·
        ${left ? `남은 시간 ${mmss(left)}` : '시간이 다 됐습니다'}</div>`;
    f.append(a);
  } else if (due || wrong) {
    const a = el('a', 'resume');
    a.href = due ? '#/review' : '#/wrong';
    a.innerHTML = due
      ? `<div class="rt">복습할 문제 ${due}개</div>
         <div class="rs">간격을 두고 다시 풀면 오래 남습니다</div>`
      : `<div class="rt">오답 ${wrong}개가 남아 있습니다</div>
         <div class="rs">틀린 것부터 다시 풀어 보세요</div>`;
    f.append(a);
  }

  const rounds = DB.raw.rounds || [];
  if (rounds.length) {
    f.append(el('h2', 'sec', '모의고사'));
    const a = el('a', 'row');
    a.href = '#/exams';
    const taken = rounds.filter(r => Store.history(r.tag).length).length;
    a.innerHTML =
      `<div class="row-main"><div class="row-t">회차 ${rounds.length}개</div>
        <div class="row-s">시간을 재고 실제 시험처럼 · ${
          taken ? `${taken}회차 응시함` : '아직 응시하지 않았습니다'}</div>
       </div><div class="row-go">›</div>`;
    f.append(a);
  }

  f.append(el('h2', 'sec', '직렬'));
  const list = el('div', 'list');
  for (const t of DB.raw.tracks) {
    const items = DB.filter({ tr: t.id });
    const p = progress(items);
    const a = el('a', 'hero');
    a.href = `#/t/${t.id}`;
    a.innerHTML =
      `<div class="hero-t">${esc(t.name)}</div>
       <div class="hero-s">${esc(t.sub)} · ${DB.subjects(t.id).length}과목</div>
       <div class="hero-n">전체 <b>${p.n}</b>문항 · 푼 것 <b>${p.done}</b>` +
      (p.done ? ` · 정답률 <b>${p.rate}%</b>` : '') + `</div>`;
    a.append(bar(p));
    list.append(a);
  }
  f.append(list);

  f.append(el('h2', 'sec', '무작위로'));
  const q = el('div', 'list');
  const mk = (t, s, href) => {
    const a = el('a', 'row');
    a.href = href;
    a.innerHTML = `<div class="row-main"><div class="row-t">${t}</div>
                   <div class="row-s">${s}</div></div><div class="row-go">›</div>`;
    return a;
  };
  q.append(mk('안 푼 문제 이어서', `아직 ${all.n - all.done}문항 남았습니다`,
              '#/q?mode=new'));
  q.append(mk('전체에서 무작위', `${all.n}문항 가운데 섞어서`, '#/q?mode=all'));
  f.append(q);

  paint(f);
});

// ─────────────────────────────────────────────────────── 화면: 과목
route(/^\/t\/([^/]+)$/, (tr) => {
  const t = DB.track(tr);
  if (!t) return go('/');
  setTitle(t.name);

  const f = document.createDocumentFragment();
  const all = DB.filter({ tr });
  const p = progress(all);

  const top = el('a', 'resume');
  top.href = `#/q?tr=${tr}&mode=new`;
  top.innerHTML = `<div class="rt">${esc(t.name)} 이어서 풀기</div>
    <div class="rs">안 푼 문제 ${p.n - p.done}개 · 전체 ${p.n}문항</div>`;
  f.append(top);

  f.append(el('h2', 'sec', '과목'));
  const list = el('div', 'list');
  for (const s of DB.subjects(tr)) {
    const sp = progress(DB.filter({ tr, sj: s.n }));
    const a = el('a', 'row');
    a.href = `#/s/${tr}/${encodeURIComponent(s.n)}`;
    a.innerHTML =
      `<div class="row-main"><div class="row-t">${esc(s.n)}</div>
        <div class="row-s">${progText(sp)} · 유형 ${DB.types(tr, s.n).length}종</div>
       </div><div class="row-go">›</div>`;
    a.querySelector('.row-main').append(bar(sp));
    list.append(a);
  }
  f.append(list);
  paint(f);
});

// ─────────────────────────────────────────────────────── 화면: 유형
route(/^\/s\/([^/]+)\/([^/]+)$/, (tr, sj) => {
  setTitle(sj);
  const f = document.createDocumentFragment();
  const all = DB.filter({ tr, sj });
  const p = progress(all);

  const top = el('a', 'resume');
  top.href = `#/q?tr=${tr}&sj=${encodeURIComponent(sj)}&mode=new`;
  top.innerHTML = `<div class="rt">${esc(sj)} 전체 풀기</div>
    <div class="rs">${progText(p)}</div>`;
  f.append(top);

  f.append(el('h2', 'sec', `유형 ${DB.types(tr, sj).length}종`));
  const list = el('div', 'list');
  for (const t of DB.types(tr, sj)) {
    const tp = progress(DB.filter({ tr, sj, ty: t.n }));
    const a = el('a', 'row');
    a.href = `#/q?tr=${tr}&sj=${encodeURIComponent(sj)}&ty=${encodeURIComponent(t.n)}`;
    a.innerHTML =
      `<div class="row-main"><div class="row-t">${esc(t.n)}</div>
        <div class="row-s">${progText(tp)}</div></div>
       <div class="row-go">›</div>`;
    a.querySelector('.row-main').append(bar(tp));
    list.append(a);
  }
  f.append(list);
  paint(f);
});

// ═══════════════════════════════════════════════════════ 회차 모드
//
// 낱개 풀이와 규칙이 다르다.
//   · 푸는 동안 **채점하지 않는다.** 고른 것만 담아 둔다
//   · 타이머는 **마감 시각**으로 잡는다. 남은 초를 깎으면 앱을 내렸다 켤 때
//     시간이 되살아난다 — 벽시계 기준이어야 백그라운드로 가도 맞다
//   · 중단하고 나가도 이어진다 (`Store.d.sit`)
//   · **제출할 때** 비로소 채점하고 `att` 에 기록한다. 중간 이탈이 오답이 되면 안 된다

const MIN = 60000;

function sitLeft(s) { return Math.max(0, s.endsAt - Date.now()); }
function mmss(ms) {
  const t = Math.ceil(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** 응시 시작. 이미 진행 중인 다른 회차가 있으면 확인받는다. */
function sitStart(tag) {
  const r = DB.round(tag);
  const cur = Store.d.sit;
  if (cur && cur.tag !== tag) {
    if (!confirm(`「${DB.round(cur.tag).title}」를 푸는 중입니다.\n`
                 + '그 답안은 사라집니다. 새로 시작할까요?')) return false;
  }
  Store.d.sit = {
    tag, at: Date.now(), endsAt: Date.now() + r.min * MIN,
    ans: {}, flag: {}, at_no: 1,
  };
  Store.save();
  return true;
}

/** 제출 — 여기서만 채점하고 기록한다. */
function sitSubmit(auto) {
  const s = Store.d.sit;
  if (!s) return;
  const items = DB.roundItems(s.tag);
  let score = 0;
  for (const it of items) {
    const chosen = s.ans[it.no] || null;
    const ok = chosen === it.an;
    if (ok) score++;
    // 회차에서 푼 것도 푼 것이다. 안 그러면 회차 오답이 복습에 안 뜬다.
    // 안 고른 문항도 **틀린 것으로** 기록한다 — 시험은 빈칸이 오답이다
    Store.record(it.id, chosen, ok, 0);
  }
  const rec = {
    at: Date.now(), score, n: items.length,
    sec: Math.round((Date.now() - s.at) / 1000),
    auto: auto ? 1 : 0,
    ans: { ...s.ans },
  };
  (Store.d.exams[s.tag] ||= []).push(rec);
  Store.d.sit = null;
  Store.save();
  LAST_EXAM = { tag: rec.at && s.tag, rec };
  location.hash = `#/result/${s.tag}`;
}

let LAST_EXAM = null;
let SIT_TICK = null;

function stopTick() { if (SIT_TICK) { clearInterval(SIT_TICK); SIT_TICK = null; } }

// ── 회차 목록 ────────────────────────────────────────────────────────
route(/^\/exams$/, () => {
  setTitle('모의고사');
  stopTick();
  const f = document.createDocumentFragment();
  const rounds = DB.raw.rounds || [];

  if (!rounds.length) {
    f.append(el('div', 'empty', '<b>회차가 없습니다</b>'));
    return paint(f);
  }

  const cur = Store.d.sit;
  if (cur) {
    const r = DB.round(cur.tag);
    const left = sitLeft(cur);
    const a = el('a', 'resume');
    a.href = `#/exam/${cur.tag}`;
    a.innerHTML = `<div class="rt">「${esc(r.title)}」 푸는 중</div>
      <div class="rs">${Object.keys(cur.ans).length}/${r.n}문항 · 남은 시간 ${mmss(left)}
      ${left ? '' : ' — 시간이 다 됐습니다'}</div>`;
    f.append(a);
  }

  f.append(el('h2', 'sec', `회차 ${rounds.length}개`));
  const list = el('div', 'list');
  for (const r of rounds) {
    const best = Store.best(r.tag);
    const hist = Store.history(r.tag);
    const a = el('a', 'row');
    a.href = `#/exam/${r.tag}`;
    const sub = hist.length
      ? `${hist.length}회 응시 · 최고 ${Math.round(best * 100)}점`
      : '아직 응시하지 않았습니다';
    a.innerHTML =
      `<div class="row-main">
         <div class="row-s">${esc(r.brand)}</div>
         <div class="row-t">${esc(r.title)}</div>
         <div class="row-s">${r.n}문항 · ${r.min}분 · ${sub}</div>
       </div><div class="row-go">›</div>`;
    if (hist.length) {
      const b = el('div', 'bar');
      const i = el('i'); i.style.width = Math.round(best * 100) + '%';
      if (best >= 0.8) i.classList.add('good');
      b.append(i); a.querySelector('.row-main').append(b);
    }
    list.append(a);
  }
  f.append(list);

  f.append(el('p', 'hint',
    '실제 시험처럼 시간을 재고, 푸는 동안 정답을 보여 주지 않습니다. '
    + '제출해야 채점하고 그때 오답노트와 복습에 들어갑니다.'));
  paint(f);
});

// ── 회차 시작 화면 ───────────────────────────────────────────────────
route(/^\/exam\/([^/]+)$/, (tag) => {
  const r = DB.round(tag);
  if (!r) return go('/exams');
  stopTick();
  setTitle(r.title);

  const f = document.createDocumentFragment();
  const cur = Store.d.sit && Store.d.sit.tag === tag ? Store.d.sit : null;

  const card = el('div', 'field');
  card.innerHTML =
    `<div class="row-s">${esc(r.brand)}</div>
     <div class="hero-t" style="margin:.15rem 0 .5rem">${esc(r.title)}</div>
     <div class="kpis">
       <div class="kpi"><div class="v">${r.n}</div><div class="k">문항</div></div>
       <div class="kpi"><div class="v">${r.min}</div><div class="k">분</div></div>
       <div class="kpi"><div class="v">${Math.round(r.min * 60 / r.n)}</div>
         <div class="k">문항당 초</div></div>
     </div>`;
  f.append(card);

  f.append(el('h2', 'sec', '영역 구성'));
  const comp = el('div', 'list');
  let from = 1;
  for (const [area, n] of r.areas) {
    const row = el('div', 'row');
    row.style.cursor = 'default';
    row.innerHTML = `<div class="row-main"><div class="row-t">${esc(area)}</div>
      <div class="row-s">${from}~${from + n - 1}번</div></div>
      <div class="row-n">${n}문항</div>`;
    from += n;
    comp.append(row);
  }
  f.append(comp);

  const hist = Store.history(tag);
  if (hist.length) {
    f.append(el('h2', 'sec', `지난 성적 ${hist.length}회`));
    const list = el('div', 'list');
    for (const h of hist.slice().reverse().slice(0, 5)) {
      const d = new Date(h.at);
      const row = el('div', 'row');
      row.style.cursor = 'default';
      row.innerHTML =
        `<div class="row-main">
           <div class="row-t">${h.score} / ${h.n}점</div>
           <div class="row-s">${d.getMonth() + 1}월 ${d.getDate()}일 ·
             ${Math.floor(h.sec / 60)}분 ${h.sec % 60}초 소요${h.auto ? ' · 시간 초과' : ''}</div>
         </div><div class="row-n">${Math.round(h.score / h.n * 100)}%</div>`;
      list.append(row);
    }
    f.append(list);
  }

  paint(f);

  const foot = el('div', 'foot');
  const inner = el('div', 'foot-in');
  if (cur) {
    const left = sitLeft(cur);
    const b = el('button', 'btn', left ? `이어하기 · ${mmss(left)} 남음` : '시간 초과 — 제출');
    b.onclick = () => left ? go(`#/sit/${tag}`) : sitSubmit(true);
    const c = el('button', 'btn ghost', '버리기');
    c.onclick = () => {
      if (!confirm('푼 답안이 사라집니다. 계속할까요?')) return;
      Store.d.sit = null; Store.save(); render();
    };
    inner.append(c, b);
  } else {
    const b = el('button', 'btn', `${r.min}분 시작`);
    b.onclick = () => { if (sitStart(tag)) go(`#/sit/${tag}`); };
    inner.append(b);
  }
  foot.append(inner);
  document.body.append(foot);
  $('#view').className = 'view solo';
});

// ── 응시 ─────────────────────────────────────────────────────────────
route(/^\/sit\/([^/]+)$/, (tag) => {
  const s = Store.d.sit;
  if (!s || s.tag !== tag) return go(`#/exam/${tag}`);
  if (sitLeft(s) <= 0) return sitSubmit(true);
  drawSit();
});

function drawSit() {
  const s = Store.d.sit;
  const r = DB.round(s.tag);
  const items = DB.roundItems(s.tag);
  const idx = Math.min(Math.max(s.at_no, 1), items.length) - 1;
  const it = items[idx];
  s.at_no = idx + 1;

  setTitle(`${it.no} / ${items.length}`);
  $('#view').className = 'view solo';

  // 상단 우측 — 타이머와 답안지
  const tr = $('#topRight');
  tr.innerHTML = '';
  const clock = el('button', 'clock', mmss(sitLeft(s)));
  clock.onclick = () => openOmr();
  const omr = el('button', null, '답안지');
  omr.onclick = () => openOmr();
  tr.append(clock, omr);

  stopTick();
  SIT_TICK = setInterval(() => {
    if (!Store.d.sit) return stopTick();
    const left = sitLeft(Store.d.sit);
    clock.textContent = mmss(left);
    clock.classList.toggle('warn', left <= 5 * MIN);
    if (left <= 0) { stopTick(); alert('시간이 다 됐습니다. 제출합니다.'); sitSubmit(true); }
  }, 500);

  const f = document.createDocumentFragment();

  const pr = el('div', 'qprog');
  pr.append(el('i'));
  pr.querySelector('i').style.width = (idx / items.length * 100) + '%';
  f.append(pr);

  const meta = el('div', 'qmeta');
  meta.innerHTML = `<span>${esc(it.sj)}</span>`;
  const flag = el('button', 'flagbtn' + (s.flag[it.no] ? ' on' : ''),
                  s.flag[it.no] ? '★ 표시함' : '☆ 나중에');
  flag.onclick = () => {
    s.flag[it.no] = s.flag[it.no] ? 0 : 1; Store.save(); drawSit();
  };
  meta.append(flag);
  f.append(meta);

  if (it.pg != null) {
    const pg = DB.passage(it.pg);
    if (pg.lead) f.append(el('div', 'lead', pg.lead));
    f.append(el('div', 'passage', pg.body));
  } else if (it.ld) {
    f.append(el('div', 'lead', it.ld));
  }
  if (it.mt) f.append(el('div', 'material', it.mt));

  // 발문은 **날것 그대로** 넣는다. esc() 를 씌우면 `&lt;보기&gt;` 가 이중으로
  // 이스케이프되어 화면에 그대로 나온다. 발문에는 태그가 못 들어간다(loader.py 가 막는다).
  f.append(el('h1', 'stem', it.st));

  const cs = el('div', 'choices');
  it.ch.forEach((c, n) => {
    const b = el('button', 'ch' + (s.ans[it.no] === n + 1 ? ' sel' : ''));
    b.innerHTML = `<span class="no">${CIRC[n]}</span><span class="tx">${c}</span>`;
    b.onclick = () => {
      // 같은 것을 다시 누르면 지운다 — 시험지에서 지우개를 쓰는 것과 같다
      s.ans[it.no] = s.ans[it.no] === n + 1 ? undefined : n + 1;
      if (s.ans[it.no] === undefined) delete s.ans[it.no];
      Store.save();
      cs.querySelectorAll('.ch').forEach((x, k) =>
        x.classList.toggle('sel', s.ans[it.no] === k + 1));
    };
    cs.append(b);
  });
  f.append(cs);
  paint(f);

  // 하단 — 이전 / 다음 / 제출
  document.querySelectorAll('.foot').forEach(x => x.remove());
  const foot = el('div', 'foot');
  const inner = el('div', 'foot-in');
  const prev = el('button', 'btn ghost', '‹ 이전');
  prev.disabled = idx === 0;
  prev.onclick = () => { s.at_no = idx; Store.save(); drawSit(); };
  inner.append(prev);
  if (idx < items.length - 1) {
    const nx = el('button', 'btn', '다음 ›');
    nx.onclick = () => { s.at_no = idx + 2; Store.save(); drawSit(); };
    inner.append(nx);
  } else {
    const sb = el('button', 'btn', '제출하기');
    sb.onclick = () => askSubmit();
    inner.append(sb);
  }
  foot.append(inner);
  document.body.append(foot);
}

function askSubmit() {
  const s = Store.d.sit;
  const items = DB.roundItems(s.tag);
  const blank = items.filter(i => !s.ans[i.no]).map(i => i.no);
  let msg = '제출하면 채점되고 답을 고칠 수 없습니다.';
  if (blank.length) {
    msg = `아직 답하지 않은 문항이 ${blank.length}개 있습니다.\n`
        + `(${blank.slice(0, 12).join(', ')}${blank.length > 12 ? ' …' : ''})\n\n`
        + '빈칸은 오답으로 처리됩니다. 그래도 제출할까요?';
  }
  if (confirm(msg)) { stopTick(); sitSubmit(false); }
}

/** OMR 답안지 — 번호 격자. 푼 것·표시한 것을 한눈에 보고 점프한다. */
function openOmr() {
  const s = Store.d.sit;
  if (!s) return;
  const items = DB.roundItems(s.tag);
  const wrap = el('div', 'sheet');
  const box = el('div', 'sheet-in');

  const head = el('div', 'sheet-head');
  head.innerHTML = `<b>답안지</b><span>${Object.keys(s.ans).length} / ${items.length} 표기</span>`;
  const x = el('button', 'sheet-x', '✕');
  x.onclick = () => wrap.remove();
  head.append(x);
  box.append(head);

  const grid = el('div', 'omr');
  for (const it of items) {
    const b = el('button', 'omr-c');
    if (s.ans[it.no]) b.classList.add('done');
    if (s.flag[it.no]) b.classList.add('flag');
    if (it.no === s.at_no) b.classList.add('here');
    b.innerHTML = `<i>${it.no}</i><em>${s.ans[it.no] ? CIRC[s.ans[it.no] - 1] : '·'}</em>`;
    b.onclick = () => { s.at_no = it.no; Store.save(); wrap.remove(); drawSit(); };
    grid.append(b);
  }
  box.append(grid);

  const sb = el('button', 'btn', '제출하기');
  sb.style.marginTop = '.8rem';
  sb.onclick = () => { wrap.remove(); askSubmit(); };
  box.append(sb);

  wrap.append(box);
  wrap.onclick = e => { if (e.target === wrap) wrap.remove(); };
  document.body.append(wrap);
}

// ── 결과 ─────────────────────────────────────────────────────────────
route(/^\/result\/([^/]+)$/, (tag) => {
  stopTick();
  const r = DB.round(tag);
  const hist = Store.history(tag);
  const rec = (LAST_EXAM && LAST_EXAM.rec) || hist[hist.length - 1];
  if (!r || !rec) return go('/exams');
  setTitle(`${r.title} 결과`);

  const items = DB.roundItems(tag);
  const f = document.createDocumentFragment();
  const rate = pct(rec.score, rec.n);

  const k = el('div', 'kpis');
  k.innerHTML =
    `<div class="kpi"><div class="v">${rec.score}</div><div class="k">/ ${rec.n}점</div></div>
     <div class="kpi"><div class="v">${rate}%</div><div class="k">정답률</div></div>
     <div class="kpi"><div class="v">${Math.floor(rec.sec / 60)}분</div>
       <div class="k">소요${rec.auto ? ' (시간 초과)' : ''}</div></div>`;
  f.append(k);

  if (hist.length > 1) {
    const prev = hist[hist.length - 2];
    const diff = rate - pct(prev.score, prev.n);
    f.append(el('p', 'hint', diff === 0 ? '지난번과 같은 점수입니다.'
      : `지난번보다 ${Math.abs(diff)}%p ${diff > 0 ? '올랐습니다.' : '내렸습니다.'}`));
  }

  f.append(el('h2', 'sec', '영역별'));
  const list = el('div', 'list');
  for (const [area] of r.areas) {
    const sub = items.filter(i => i.sj === area);
    const ok = sub.filter(i => rec.ans[i.no] === i.an).length;
    const row = el('div', 'row');
    row.style.cursor = 'default';
    row.innerHTML = `<div class="row-main"><div class="row-t">${esc(area)}</div>
      <div class="row-s">${ok} / ${sub.length}문항</div></div>
      <div class="row-n">${pct(ok, sub.length)}%</div>`;
    const b = el('div', 'bar');
    const i = el('i'); i.style.width = pct(ok, sub.length) + '%';
    if (ok === sub.length) i.classList.add('good');
    b.append(i); row.querySelector('.row-main').append(b);
    list.append(row);
  }
  f.append(list);

  f.append(el('h2', 'sec', '문항별 — 누르면 해설'));
  const grid = el('div', 'omr');
  for (const it of items) {
    const chosen = rec.ans[it.no];
    const ok = chosen === it.an;
    const b = el('button', 'omr-c ' + (ok ? 'ok' : chosen ? 'no' : 'skip'));
    b.innerHTML = `<i>${it.no}</i><em>${ok ? '○' : chosen ? '✕' : '·'}</em>`;
    b.onclick = () => go(`#/q?one=${encodeURIComponent(it.id)}`);
    grid.append(b);
  }
  f.append(grid);

  const miss = items.filter(i => rec.ans[i.no] !== i.an);
  if (miss.length) {
    const a = el('a', 'resume');
    a.style.marginTop = '1rem';
    a.href = `#/q?ids=${miss.map(i => i.id).join(',')}`;
    a.innerHTML = `<div class="rt">틀린 ${miss.length}문항 다시 풀기</div>
      <div class="rs">해설을 보며 하나씩</div>`;
    f.append(a);
  }
  paint(f);
});

// ─────────────────────────────────────────────────────── 화면: 키워드
route(/^\/kw$/, () => {
  setTitle('키워드');
  const f = document.createDocumentFragment();
  f.append(el('p', 'hint',
    '문항을 가로질러 묶는 용어입니다. 과목이 달라도 같은 개념이면 함께 나옵니다.'));

  const groups = new Map();
  DB.raw.keywords.forEach((k, idx) => {
    const its = DB.items.filter(i => i.kw.includes(idx));
    const sj = its.length ? its[0].sj : '기타';
    (groups.get(sj) || groups.set(sj, []).get(sj)).push({ ...k, idx });
  });

  for (const [sj, ks] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    f.append(el('h2', 'sec', `${sj} · ${ks.length}개`));
    const c = el('div', 'chips');
    for (const k of ks.sort((a, b) => b.n - a.n || a.t.localeCompare(b.t, 'ko'))) {
      const a = el('a', 'chip');
      a.href = `#/q?kw=${k.idx}`;
      a.innerHTML = `${esc(k.t)} <b>${k.n}</b>`;
      c.append(a);
    }
    f.append(c);
  }
  paint(f);
});

// ─────────────────────────────────────────────────────── 화면: 오답노트
route(/^\/wrong$/, () => {
  setTitle('오답노트');
  const wrong = DB.items.filter(i => Store.isWrong(i.id));
  const f = document.createDocumentFragment();

  if (!wrong.length) {
    f.append(el('div', 'empty',
      '<b>오답이 없습니다</b>틀린 문제가 여기 모입니다.<br>다시 풀어 맞히면 목록에서 빠집니다.'));
    return paint(f);
  }

  const a = el('a', 'resume');
  a.href = '#/q?mode=wrong';
  a.innerHTML = `<div class="rt">오답 ${wrong.length}개 다시 풀기</div>
    <div class="rs">맞히면 목록에서 사라집니다</div>`;
  f.append(a);

  const pdf = el('button', 'btn ghost');
  pdf.style.cssText = 'width:100%;margin-top:.5rem';
  pdf.textContent = '오답노트 PDF 용으로 내보내기';
  pdf.onclick = () => exportWrong();
  f.append(pdf);
  f.append(el('p', 'hint',
    '내려받은 파일로 <code>python tools/wrongnote_pdf.py</code> 를 돌리면 '
    + '문제와 해설이 함께 실린 인쇄본이 나옵니다.'));

  f.append(el('h2', 'sec', '틀린 문제'));
  const list = el('div', 'list');
  for (const i of wrong) {
    const cnt = (Store.d.att[i.id] || []).filter(x => !x.k).length;
    const b = el('a', 'row');
    b.href = `#/q?one=${encodeURIComponent(i.id)}`;
    b.innerHTML =
      `<div class="row-main">
         <div class="row-s">${esc(i.sj)} · ${esc(i.ty)}</div>
         <div class="row-t" style="font-weight:550;font-size:.95rem">${esc(plain(i.st).slice(0, 60))}</div>
       </div><div class="row-n">${cnt}회 틀림</div>`;
    list.append(b);
  }
  f.append(list);
  paint(f);
});

// ─────────────────────────────────────────────────────── 화면: 복습
route(/^\/review$/, () => {
  setTitle('복습');
  const due = Store.dueIds(DB.items);
  const f = document.createDocumentFragment();

  if (!due.length) {
    const upcoming = DB.items
      .map(i => ({ i, s: Store.d.srs[i.id] })).filter(x => x.s)
      .sort((a, b) => a.s.due - b.s.due)[0];
    let msg = '한 문제라도 풀면 복습 일정이 잡힙니다.';
    if (upcoming) {
      const d = Math.ceil((upcoming.s.due - Date.now()) / 86400000);
      msg = `다음 복습은 ${d <= 0 ? '곧' : d + '일 뒤'}입니다.`;
    }
    f.append(el('div', 'empty', `<b>지금 복습할 것이 없습니다</b>${msg}`));
    return paint(f);
  }

  const a = el('a', 'resume');
  a.href = '#/q?mode=due';
  a.innerHTML = `<div class="rt">복습 ${due.length}문항 시작</div>
    <div class="rs">맞히면 다음 복습이 뒤로 밀립니다</div>`;
  f.append(a);

  f.append(el('h2', 'sec', '오늘 볼 것'));
  const list = el('div', 'list');
  for (const id of due) {
    const i = DB.byId.get(id);
    const s = Store.d.srs[id];
    const b = el('a', 'row');
    b.href = `#/q?one=${encodeURIComponent(id)}`;
    b.innerHTML =
      `<div class="row-main">
         <div class="row-s">${esc(i.sj)} · ${esc(i.ty)}</div>
         <div class="row-t" style="font-weight:550;font-size:.95rem">${esc(plain(i.st).slice(0, 60))}</div>
       </div><div class="row-n">${s.i ? s.i + '일 간격' : '새로'}</div>`;
    list.append(b);
  }
  f.append(list);
  paint(f);
});

// ─────────────────────────────────────────────────────── 화면: 통계
route(/^\/stats$/, () => {
  setTitle('통계');
  const f = document.createDocumentFragment();
  const all = progress(DB.items);
  const atts = Object.values(Store.d.att).flat();

  const k = el('div', 'kpis');
  k.innerHTML =
    `<div class="kpi"><div class="v">${all.done}</div><div class="k">푼 문항</div></div>
     <div class="kpi"><div class="v">${all.done ? all.rate + '%' : '—'}</div>
       <div class="k">정답률</div></div>
     <div class="kpi"><div class="v">${atts.length}</div><div class="k">총 시도</div></div>`;
  f.append(k);

  if (!all.done) {
    f.append(el('div', 'empty', '<b>아직 기록이 없습니다</b>한 문제 풀어 보세요.'));
    return paint(f);
  }

  for (const t of DB.raw.tracks) {
    const subs = DB.subjects(t.id);
    if (!subs.length) continue;
    f.append(el('h2', 'sec', t.name));
    const list = el('div', 'list');
    for (const s of subs) {
      const p = progress(DB.filter({ tr: t.id, sj: s.n }));
      const row = el('div', 'row');
      row.style.cursor = 'default';
      row.innerHTML =
        `<div class="row-main"><div class="row-t">${esc(s.n)}</div>
          <div class="row-s">${progText(p)}</div></div>
         <div class="row-n">${p.done ? p.rate + '%' : '—'}</div>`;
      row.querySelector('.row-main').append(bar(p));
      list.append(row);
    }
    f.append(list);
  }
  paint(f);
});

// ─────────────────────────────────────────────────────── 화면: 더보기
route(/^\/more$/, () => {
  setTitle('더보기');
  stopTick();
  const f = document.createDocumentFragment();
  const mk = (t, s, href, n) => {
    const a = el('a', 'row');
    a.href = href;
    a.innerHTML = `<div class="row-main"><div class="row-t">${t}</div>
      <div class="row-s">${s}</div></div>` +
      (n != null ? `<div class="row-n">${n}</div>` : '') + `<div class="row-go">›</div>`;
    return a;
  };
  const list = el('div', 'list');
  list.append(mk('검색', '발문·선지·해설을 가로질러 찾습니다', '#/search'));
  list.append(mk('키워드', '과목을 가로지르는 용어', '#/kw',
                 DB.raw.keywords.length));
  list.append(mk('북마크 · 확인 필요', '표시해 둔 문항', '#/marks',
                 Object.keys(Store.d.mark).length || null));
  list.append(mk('통계', '과목별 정답률', '#/stats'));
  list.append(mk('설정', '기록 관리 · 관리자 모드', '#/settings'));
  f.append(list);
  paint(f);
});

// ─────────────────────────────────────────────────────── 화면: 검색
let SEARCH_Q = '';

route(/^\/search$/, () => {
  setTitle('검색');
  stopTick();
  const f = document.createDocumentFragment();

  const box = el('div', 'searchbar');
  const inp = el('input');
  inp.type = 'search'; inp.placeholder = '발문 · 선지 · 해설 · 키워드';
  inp.value = SEARCH_Q; inp.autocomplete = 'off';
  box.append(inp);
  f.append(box);
  const out = el('div', 'list');
  f.append(out);
  paint(f);

  const run = () => {
    const q = inp.value.trim();
    SEARCH_Q = q;
    out.innerHTML = '';
    if (q.length < 1) {
      out.append(el('div', 'empty',
        '<b>무엇을 찾을까요</b>「교착」「B+트리」「사자성어」처럼 적어 보세요.'));
      return;
    }
    const hits = searchItems(q);
    if (!hits.length) {
      out.append(el('div', 'empty', `<b>「${esc(q)}」 결과가 없습니다</b>`));
      return;
    }
    out.append(el('h2', 'sec', `${hits.length}문항`));
    for (const { it, where, snip } of hits.slice(0, 60)) {
      const a = el('a', 'row');
      a.href = `#/q?one=${encodeURIComponent(it.id)}`;
      a.innerHTML =
        `<div class="row-main">
           <div class="row-s">${esc(it.sj)} · ${esc(it.ty)}
             ${it.rd ? `· ${esc(DB.round(it.rd).title)} ${it.no}번` : ''}</div>
           <div class="row-t" style="font-weight:550;font-size:.95rem">${hl(it.st, q)}</div>
           ${where === 'stem' ? '' :
             `<div class="row-s">${where} — ${hl(snip, q)}</div>`}
         </div><div class="row-go">›</div>`;
      out.append(a);
    }
    if (hits.length > 60) {
      out.append(el('p', 'hint', `앞의 60개만 보입니다. 검색어를 좁혀 보세요.`));
    }
  };

  inp.oninput = run;
  run();
  inp.focus();
});

const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"',
              '&nbsp;': ' ', '&#39;': "'" };
const unent = s => String(s || '').replace(/&(?:lt|gt|amp|quot|nbsp|#39);/g, m => ENT[m]);

/** 목록·검색용 순수 텍스트.
 *
 *  두 가지를 지킨다 —
 *  ① 문자 참조를 푼다. 안 그러면 `&lt;보기&gt;` 가 화면에 그대로 나온다.
 *  ② 인라인 태그는 **붙여서** 지운다. 사이에 공백을 넣으면
 *     `cm<sup>2</sup>` 가 `cm 2` 가 되어 뜻이 바뀐다. */
const INLINE_TAG = /<\/?(?:sup|sub|u|b|strong|i|em|code|span|mark)\b[^>]*>/gi;
const plain = s => unent(String(s || '').replace(INLINE_TAG, '').replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ').trim();
const stripTags = plain;

/** 문항의 **모든 글**을 본다 — 발문·선지·유형·키워드·자료·지문·해설·단평.
 *
 * 좁게 잡으면 조용히 빠진다. 「정규화」가 유형 이름에만 있는 문항이 그랬다.
 * 먼저 걸린 곳을 함께 돌려주어 어디서 잡혔는지 보이게 한다.
 */
function searchItems(q) {
  const n = q.toLowerCase();
  const has = s => stripTags(s).toLowerCase().includes(n);
  /** 걸린 자리 앞뒤를 잘라 보여 준다 */
  const around = (s, pad = 24, len = 70) => {
    const t = stripTags(s).replace(/\s+/g, ' ').trim();
    const at = t.toLowerCase().indexOf(n);
    if (at < 0) return t.slice(0, len);
    return (at > pad ? '…' : '') + t.slice(Math.max(0, at - pad), at + len - pad).trim();
  };

  const hits = [];
  for (const it of DB.items) {
    if (has(it.st)) { hits.push({ it, where: 'stem' }); continue; }

    const ci = it.ch.findIndex(has);
    if (ci >= 0) { hits.push({ it, where: `선지 ${CIRC[ci]}`, snip: around(it.ch[ci]) }); continue; }

    if (has(it.ty) || has(it.sj)) {
      hits.push({ it, where: '분류', snip: `${it.sj} · ${it.ty}` }); continue;
    }
    const kw = it.kw.find(k => DB.kwName(k).toLowerCase().includes(n));
    if (kw != null) { hits.push({ it, where: '키워드', snip: DB.kwName(kw) }); continue; }

    if (it.mt && has(it.mt)) { hits.push({ it, where: '자료', snip: around(it.mt) }); continue; }
    if (it.pg != null && has(DB.passage(it.pg).body)) {
      hits.push({ it, where: '지문', snip: around(DB.passage(it.pg).body) }); continue;
    }
    if (it.ex && has(it.ex)) { hits.push({ it, where: '해설', snip: around(it.ex) }); continue; }

    const ei = (it.ea || []).findIndex(has);
    if (ei >= 0) { hits.push({ it, where: '선지 단평', snip: around(it.ea[ei]) }); }
  }
  return hits;
}

/** 찾은 말에 표시를 씌운다. **원문을 이스케이프한 뒤** 씌워야 안전하다. */
function hl(text, q) {
  const s = esc(stripTags(text));
  const t = esc(q);
  if (!t) return s;
  const i = s.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return s;
  return s.slice(0, i) + '<mark>' + s.slice(i, i + t.length) + '</mark>'
       + s.slice(i + t.length);
}

// ─────────────────────────────────────────────────────── 화면: 표시
route(/^\/marks$/, () => {
  setTitle('북마크 · 확인 필요');
  stopTick();
  const f = document.createDocumentFragment();
  const flags = Store.marked('f');
  const books = Store.marked('b');

  if (!flags.length && !books.length) {
    f.append(el('div', 'empty',
      '<b>표시한 문항이 없습니다</b>문제를 풀다가 ☆ 로 담아 두거나,<br>'
      + '이상한 점이 보이면 ⚑ 로 표시해 두세요.'));
    return paint(f);
  }

  const group = (title, ids, note) => {
    if (!ids.length) return;
    f.append(el('h2', 'sec', `${title} ${ids.length}개`));
    if (note) f.append(el('p', 'hint', note));
    const list = el('div', 'list');
    for (const id of ids) {
      const it = DB.byId.get(id);
      if (!it) continue;
      const m = Store.markOf(id) || {};
      const a = el('a', 'row');
      a.href = `#/q?one=${encodeURIComponent(id)}`;
      const rk = Store.d.admin && DB.admin && DB.admin[id] && DB.admin[id].rk;
      a.innerHTML =
        `<div class="row-main">
           <div class="row-s">${esc(it.sj)} · ${esc(it.ty)}
             ${rk ? `<span class="badge ${rk}">${rk.toUpperCase()}</span>` : ''}</div>
           <div class="row-t" style="font-weight:550;font-size:.95rem">${esc(plain(it.st).slice(0, 56))}</div>
           ${m.memo ? `<div class="memo">${esc(m.memo)}</div>` : ''}
         </div><div class="row-go">›</div>`;
      list.append(a);
    }
    f.append(list);
  };

  group('확인 필요', flags,
        '이상하다고 표시한 문항입니다. 아래에서 내보내 주시면 문항을 고칠 수 있습니다.');
  group('북마크', books, null);

  if (flags.length || books.length) {
    const b = el('button', 'btn');
    b.style.marginTop = '1.2rem';
    b.textContent = '표시 목록 내보내기 (.json)';
    b.onclick = () => exportMarks();
    f.append(b);
    f.append(el('p', 'hint',
      '내려받은 파일을 전달하시면 어느 문항의 무엇이 문제인지 그대로 읽힙니다. '
      + '문항 번호·과목·메모가 들어갑니다.'));
  }
  paint(f);
});

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
       + `${String(d.getDate()).padStart(2, '0')}`;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportMarks() {
  const items = Object.entries(Store.d.mark).map(([id, m]) => {
    const it = DB.byId.get(id);
    const o = { id, sj: it ? it.sj : '?', ty: it ? it.ty : '?',
                stem: it ? plain(it.st).slice(0, 80) : '' };
    if (it && it.rd) { o.round = it.rd; o.no = it.no; }
    if (m.f) o.flag = true;
    if (m.b) o.bookmark = true;
    if (m.memo) o.memo = m.memo;
    const rk = DB.admin && DB.admin[id] && DB.admin[id].rk;
    if (rk) o.risk = rk;
    return o;
  });
  download(`marks-${today()}.json`,
           JSON.stringify({ v: 1, at: new Date().toISOString(), n: items.length, items },
                          null, 2));
}

function exportWrong() {
  const ids = DB.items.filter(i => Store.isWrong(i.id)).map(i => i.id);
  download(`wrongnote-${today()}.json`,
           JSON.stringify({ v: 1, at: new Date().toISOString(), n: ids.length, ids },
                          null, 2));
}

// ─────────────────────────────────────────────────────── 화면: 설정
route(/^\/settings$/, () => {
  setTitle('설정');
  const f = document.createDocumentFragment();

  f.append(el('h2', 'sec', '관리자 모드'));
  const fd = el('div', 'field');
  if (Store.d.admin) {
    fd.innerHTML = `<div class="row-t">켜져 있습니다</div>
      <div class="hint">문제 화면에 <b>위험도</b>와 출제 이유서가 함께 나옵니다.</div>`;
    const b = el('button', 'btn ghost', '끄기');
    b.style.marginTop = '.7rem'; b.style.width = '100%';
    b.onclick = () => { Store.d.admin = false; Store.save(); render(); };
    fd.append(b);
  } else {
    fd.innerHTML = `<label for="pw">관리자 암호</label>
      <input id="pw" type="password" autocomplete="off" placeholder="암호를 입력하세요">
      <div class="hint">출제자용입니다. 문항의 <b>위험도(low·mid·high)</b>와
        출제 이유서(근거·설계·함정·검증)를 문제 화면에서 함께 봅니다.<br>
        <b>주의</b> — 이것은 화면 표시를 가리는 장치일 뿐 보안 장치가 아닙니다.
        브라우저 개발자 도구를 열 줄 아는 사람은 우회할 수 있습니다.</div>`;
    const b = el('button', 'btn', '켜기');
    b.style.marginTop = '.7rem'; b.style.width = '100%';
    b.onclick = async () => {
      const v = fd.querySelector('#pw').value;
      if (await sha(v) !== ADMIN_HASH) { b.textContent = '암호가 다릅니다';
        setTimeout(() => b.textContent = '켜기', 1400); return; }
      Store.d.admin = true; Store.save();
      try { await DB.loadAdmin(); } catch (e) { /* 파일이 없으면 배지만 안 나온다 */ }
      render();
    };
    fd.append(b);
  }
  f.append(fd);

  f.append(el('h2', 'sec', '기록'));
  const info = el('div', 'field');
  const n = Object.keys(Store.d.att).length;
  info.innerHTML = `<div class="row-t">이 기기에 ${n}문항의 기록이 있습니다</div>
    <div class="hint">푼 기록과 복습 일정은 <b>이 브라우저에만</b> 저장됩니다.
      서버로 올라가지 않으므로 다른 기기와 공유되지 않고, 방문 기록을 지우면 함께 사라집니다.</div>`;
  const del = el('button', 'btn ghost', '기록 전부 지우기');
  del.style.marginTop = '.7rem'; del.style.width = '100%';
  del.onclick = () => {
    if (!confirm('푼 기록·오답노트·복습 일정이 모두 사라집니다. 계속할까요?')) return;
    Store.reset(); render();
  };
  info.append(del);
  f.append(info);

  f.append(el('h2', 'sec', '문항'));
  const about = el('div', 'field');
  about.innerHTML =
    `<div class="row-t">${DB.raw.n}문항 · 키워드 ${DB.raw.keywords.length}개</div>
     <div class="hint">문항은 앱 안에 들어 있습니다. <b>비행기 모드에서도 전부 풀립니다.</b><br>
       모두 자작 문항이며 기출을 복원한 것이 아닙니다.</div>`;
  f.append(about);

  paint(f);
});

// 암호는 평문으로 두지 않는다. (그래도 보안 장치는 아니다 — 위 안내 참조)
const ADMIN_HASH = 'aa790a259912f75b16643edc4862b87fc60ca9cbf4c359da002a56c7294257f4';
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────────────── 화면: 문제 풀이
let SESSION = null;

route(/^\/q\?(.*)$/, (qs) => {
  const p = new URLSearchParams(qs);

  if (!SESSION || SESSION.key !== qs) {
    let pool;
    if (p.get('one')) {
      pool = [DB.byId.get(p.get('one'))].filter(Boolean);
    } else if (p.get('ids')) {
      pool = p.get('ids').split(',').map(i => DB.byId.get(i)).filter(Boolean);
    } else if (p.get('mode') === 'wrong') {
      pool = DB.items.filter(i => Store.isWrong(i.id));
    } else if (p.get('mode') === 'due') {
      const due = new Set(Store.dueIds(DB.items));
      pool = DB.items.filter(i => due.has(i.id));
    } else {
      const f = {};
      if (p.get('tr')) f.tr = p.get('tr');
      if (p.get('sj')) f.sj = p.get('sj');
      if (p.get('ty')) f.ty = p.get('ty');
      if (p.get('kw')) f.kw = +p.get('kw');
      pool = DB.filter(f);
      if (p.get('mode') === 'new') {
        const fresh = pool.filter(i => !Store.tried(i.id));
        if (fresh.length) pool = fresh;
      }
      if (p.get('mode') === 'all' || p.get('mode') === 'new') pool = shuffle(pool);
    }
    if (!pool.length) {
      setTitle('문제');
      return paint(el('div', 'empty',
        '<b>해당하는 문제가 없습니다</b>다른 분류를 골라 보세요.'));
    }
    SESSION = { key: qs, pool, at: 0, chosen: null, graded: false,
                start: Date.now(), right: 0 };
  }
  drawQuestion();
});

/** ☆ 북마크 · ⚑ 확인 필요. 문제를 풀다 바로 눌러 두는 자리다. */
function markBar(id) {
  const wrap = el('span', 'markbar');
  const m = () => Store.markOf(id) || {};

  const star = el('button', 'mk');
  const flag = el('button', 'mk');
  const paintBtns = () => {
    const c = m();
    star.className = 'mk' + (c.b ? ' on' : '');
    star.textContent = c.b ? '★ 북마크' : '☆ 북마크';
    flag.className = 'mk' + (c.f ? ' warn' : '');
    flag.textContent = c.f ? '⚑ 확인 필요' : '⚐ 확인 필요';
  };
  star.onclick = () => { Store.toggleMark(id, 'b'); paintBtns(); };
  flag.onclick = () => {
    const cur = m();
    if (cur.f) {
      Store.toggleMark(id, 'f');
      if (cur.memo && !confirm('메모도 함께 지울까요?')) Store.setMemo(id, cur.memo);
      else if (cur.memo) Store.setMemo(id, '');
    } else {
      const memo = prompt('무엇이 이상한가요? (그냥 확인만 눌러도 됩니다)',
                          cur.memo || '');
      if (memo === null) return;               // 취소
      Store.toggleMark(id, 'f');
      if (memo.trim()) Store.setMemo(id, memo.trim());
    }
    paintBtns();
  };
  paintBtns();
  wrap.append(star, flag);
  return wrap;
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawQuestion() {
  const S = SESSION;
  const it = S.pool[S.at];
  setTitle(`${S.at + 1} / ${S.pool.length}`);
  $('#view').className = 'view solo';

  const f = document.createDocumentFragment();

  const pr = el('div', 'qprog');
  pr.append(el('i'));
  pr.querySelector('i').style.width = ((S.at) / S.pool.length * 100) + '%';
  f.append(pr);

  const meta = el('div', 'qmeta');
  meta.innerHTML = `<span>${esc(it.sj)}</span><span class="sep">›</span>
    <span>${esc(it.ty)}</span>` +
    (it.rd ? `<span class="sep">·</span><span>${esc(DB.round(it.rd).title)}
      ${it.no}번</span>` : '') +
    (it.df ? `<span class="sep">·</span><span>난이도 ${esc(it.df)}</span>` : '');
  if (Store.d.admin && DB.admin && DB.admin[it.id] && DB.admin[it.id].rk) {
    const rk = DB.admin[it.id].rk;
    meta.append(el('span', `badge ${rk}`, rk.toUpperCase()));
  }
  meta.append(markBar(it.id));
  f.append(meta);

  if (it.pg != null) {
    const pg = DB.passage(it.pg);
    if (pg.lead) f.append(el('div', 'lead', pg.lead));
    f.append(el('div', 'passage', pg.body));
  } else if (it.ld) {
    f.append(el('div', 'lead', it.ld));
  }
  if (it.mt) f.append(el('div', 'material', it.mt));

  // 발문은 **날것 그대로** 넣는다. esc() 를 씌우면 `&lt;보기&gt;` 가 이중으로
  // 이스케이프되어 화면에 그대로 나온다. 발문에는 태그가 못 들어간다(loader.py 가 막는다).
  f.append(el('h1', 'stem', it.st));

  const cs = el('div', 'choices');
  it.ch.forEach((c, n) => {
    const b = el('button', 'ch');
    b.innerHTML = `<span class="no">${CIRC[n]}</span><span class="tx">${c}</span>`;
    b.onclick = () => {
      if (S.graded) return;
      S.chosen = n + 1;
      cs.querySelectorAll('.ch').forEach((x, k) => x.classList.toggle('sel', k === n));
      $('#gradeBtn').disabled = false;
    };
    if (S.chosen === n + 1) b.classList.add('sel');
    cs.append(b);
  });
  f.append(cs);

  paint(f);
  drawFoot();
  if (S.graded) grade(true);
}

function drawFoot() {
  document.querySelectorAll('.foot').forEach(x => x.remove());
  const S = SESSION;
  const foot = el('div', 'foot');
  const inner = el('div', 'foot-in');

  if (!S.graded) {
    const b = el('button', 'btn', '확인');
    b.id = 'gradeBtn';
    b.disabled = S.chosen == null;
    b.onclick = () => grade(false);
    inner.append(b);
  } else {
    const last = S.at >= S.pool.length - 1;
    const b = el('button', 'btn', last ? '끝내기' : '다음 문제');
    b.onclick = () => {
      if (last) { const done = S; SESSION = null; return finish(done); }
      S.at++; S.chosen = null; S.graded = false; S.start = Date.now();
      drawQuestion();
    };
    inner.append(b);
  }
  foot.append(inner);
  document.body.append(foot);
}

function grade(replay) {
  const S = SESSION;
  const it = S.pool[S.at];
  const ok = S.chosen === it.an;

  if (!replay) {
    S.graded = true;
    if (ok) S.right++;
    Store.record(it.id, S.chosen, ok, Date.now() - S.start);
    updateBadges();
  }

  document.querySelectorAll('.ch').forEach((b, n) => {
    b.classList.add('done');
    const isAns = n + 1 === it.an, isMine = n + 1 === S.chosen;
    b.classList.remove('sel');
    if (isAns) b.classList.add('ans');
    else if (isMine) b.classList.add('bad');
    if (it.ea && it.ea[n]) {
      const w = el('span', 'why', stripLead(it.ea[n]));
      b.querySelector('.tx').append(w);
    }
  });

  const v = el('div', `verdict ${ok ? 'o' : 'x'}`);
  v.innerHTML = ok
    ? `<span>맞았습니다</span><small>정답 ${CIRC[it.an - 1]}</small>`
    : `<span>틀렸습니다</span><small>정답은 ${CIRC[it.an - 1]}
       (고른 것 ${CIRC[S.chosen - 1]})</small>`;
  $('.choices').after(v);

  if (it.ex) {
    const ex = el('div', 'explain');
    ex.append(el('h3', null, '해설'));
    ex.insertAdjacentHTML('beforeend', it.ex);
    v.after(ex);
  }

  if (Store.d.admin && DB.admin && DB.admin[it.id]) {
    const a = DB.admin[it.id];
    const box = el('div', 'adm');
    box.append(el('h3', null,
      '출제자용 — 위험도 ' + (a.rk ? a.rk.toUpperCase() : '—')));
    const dl = el('dl');
    // `근거` 는 아래 출제이유서에도 있다. 후기 실측은 다른 칸이므로 이름을 나눈다.
    if (a.ev) { dl.append(el('dt', null, '후기'), el('dd', null, esc(a.ev))); }
    for (const k of ['근거', '설계', '함정', '검증']) {
      if (a.wy && a.wy[k]) {
        dl.append(el('dt', null, k), el('dd', null, esc(a.wy[k])));
      }
    }
    if (a.sn) { dl.append(el('dt', null, '스냅샷'), el('dd', null, esc(a.sn))); }
    if (a.rd) { dl.append(el('dt', null, '회차'), el('dd', null, esc(a.rd))); }
    box.append(dl);
    $('#view').append(box);
  }

  if (!replay) drawFoot();
}

/** `① (정답) …` 에서 앞의 기호를 뗀다 — 선지 옆에 붙으므로 중복이다.
 *
 *  esc() 를 씌우면 안 된다. 선지 단평에는 `<sup>5</sup>/<sub>72</sub>` 같은 것이 들어 있어
 *  이스케이프하면 분수 대신 태그 글자가 그대로 나온다. 선지 본문과 같은 규칙으로 둔다. */
function stripLead(s) {
  return String(s).replace(/^[①②③④⑤⑥⑦]\s*/, '');
}

let DONE = null;

function finish(S) {
  DONE = S;                 // 해시를 바꾸기 **전에** 담는다. 순서가 뒤집히면 홈으로 튄다
  location.hash = '#/done';
}

route(/^\/done$/, () => {
  setTitle('결과');
  const S = DONE;
  if (!S) return go('/');
  const f = document.createDocumentFragment();
  const rate = pct(S.right, S.pool.length);

  const k = el('div', 'kpis');
  k.innerHTML =
    `<div class="kpi"><div class="v">${S.pool.length}</div><div class="k">푼 문항</div></div>
     <div class="kpi"><div class="v">${S.right}</div><div class="k">맞힘</div></div>
     <div class="kpi"><div class="v">${rate}%</div><div class="k">정답률</div></div>`;
  f.append(k);

  const miss = S.pool.filter(i => Store.isWrong(i.id));
  if (miss.length) {
    f.append(el('h2', 'sec', `틀린 문제 ${miss.length}개`));
    const list = el('div', 'list');
    for (const i of miss) {
      const b = el('a', 'row');
      b.href = `#/q?one=${encodeURIComponent(i.id)}`;
      b.innerHTML = `<div class="row-main">
        <div class="row-s">${esc(i.sj)} · ${esc(i.ty)}</div>
        <div class="row-t" style="font-weight:550;font-size:.95rem">${esc(plain(i.st).slice(0, 60))}</div>
        </div><div class="row-go">›</div>`;
      list.append(b);
    }
    f.append(list);
  } else {
    f.append(el('div', 'empty', '<b>전부 맞혔습니다</b>다음 분류로 넘어가 보세요.'));
  }

  const home = el('a', 'resume');
  home.href = '#/';
  home.style.marginTop = '1rem';
  home.innerHTML = `<div class="rt">홈으로</div>
    <div class="rs">다른 과목·유형 고르기</div>`;
  f.append(home);
  paint(f);
});

// ─────────────────────────────────────────────────────── 시작
$('#back').onclick = () => history.length > 1 ? history.back() : go('/');
window.addEventListener('hashchange', () => {
  document.querySelectorAll('.foot').forEach(x => x.remove());
  render();
});

(async () => {
  Store.load();
  try {
    await DB.load();
  } catch (e) {
    const b = $('#boot');
    b.classList.add('err');
    b.querySelector('.boot-msg').textContent =
      '문항을 불러오지 못했습니다 — ' + e.message;
    return;
  }
  if (Store.d.admin) { try { await DB.loadAdmin(); } catch (e) { /* 없으면 넘어간다 */ } }

  $('#boot').remove();
  $('#top').hidden = false;
  $('#view').hidden = false;
  $('#tabs').hidden = false;
  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
