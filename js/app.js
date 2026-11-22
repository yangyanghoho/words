/* ==========================================================
   拾词 · 界面逻辑
   背词 / 测验 / 词表 / 统计四个页面，外加导入导出与朗读。
   原则：任何一步出错都不能让页面停摆，存储和语音全部兜住。
   ========================================================== */
(function () {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const root = document.documentElement;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [r[i], r[j]] = [r[j], r[i]]; } return r; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const WKEY = 'shici-words';
  const BASE_WORDS = (window.WORDS || []).slice();
  const BASE_DECKS = (window.DECKS || []).slice();
  let words = BASE_WORDS;
  let decks = BASE_DECKS;
  let customCount = 0;

  /* ---------- 自定义词库 ---------- */
  function loadCustom() {
    const raw = store.get(WKEY);
    if (!raw) return;
    try {
      const o = JSON.parse(raw);
      if (!o || !Array.isArray(o.words) || !o.words.length) return;
      words = o.words.filter(validWord);
      customCount = words.filter((x) => x.custom).length;
      const ids = {};
      words.forEach((x) => { ids[x.d] = 1; });
      decks = BASE_DECKS.filter((d) => ids[d.id]);
      Object.keys(ids).forEach((id) => {
        if (!decks.some((d) => d.id === id)) decks.push({ id, name: id === 'custom' ? '我导入的词' : id, desc: '导入的词表' });
      });
    } catch (e) { /* 坏档就用内置词库 */ }
  }
  const validWord = (x) => x && typeof x.w === 'string' && x.w.trim() && typeof x.zh === 'string';
  function saveCustom() {
    const ok = store.set(WKEY, JSON.stringify({ v: 1, words }));
    if (!ok) toast('本地空间不足，词表没保存成功');
  }

  /* ---------- 主题 ---------- */
  const themeBtn = $('#themeBtn'), metaTheme = $('#metaTheme');
  function applyTheme(t) {
    root.dataset.theme = t;
    if (metaTheme) metaTheme.content = t === 'dark' ? '#16191a' : '#f6f3ee';
    themeBtn.setAttribute('aria-pressed', String(t === 'dark'));
  }
  applyTheme(root.dataset.theme || 'light');
  themeBtn.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set('shici-theme', next);
    applyTheme(next);
  });

  /* ---------- 提示 ---------- */
  const toastEl = $('#toast');
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2300);
  }

  /* ---------- 朗读 ---------- */
  let voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    try {
      const vs = speechSynthesis.getVoices() || [];
      if (!vs.length) return null;
      return vs.find((v) => /^en[-_]GB/i.test(v.lang)) ||
        vs.find((v) => /^en[-_]US/i.test(v.lang)) ||
        vs.find((v) => /^en/i.test(v.lang)) || null;
    } catch (e) { return null; }
  }
  if ('speechSynthesis' in window) {
    voice = pickVoice();
    try { speechSynthesis.addEventListener('voiceschanged', () => { voice = pickVoice(); }); } catch (e) {}
  }
  let speakWarned = false;
  function speak(text, btn) {
    if (!('speechSynthesis' in window)) {
      if (!speakWarned) { speakWarned = true; toast('这个浏览器不支持朗读'); }
      return false;
    }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = (voice && voice.lang) || 'en-US';
      u.rate = 0.88;
      if (voice) u.voice = voice;
      if (btn) {
        btn.classList.add('speaking');
        const off = () => btn.classList.remove('speaking');
        u.onend = off; u.onerror = off;
        setTimeout(off, 4000);
      }
      speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 页面切换 ---------- */
  const views = ['learn', 'quiz', 'list', 'stat'];
  let view = 'learn';
  function setView(v) {
    if (views.indexOf(v) < 0) return;
    view = v;
    views.forEach((x) => {
      $('#view-' + x).classList.toggle('on', x === v);
      $('#view-' + x).hidden = x !== v;
    });
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === v)));
    if (v === 'stat') renderStat();
    if (v === 'list') renderList();
    location.hash = v === 'learn' ? '' : '#' + v;
  }
  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) setView(t.dataset.view);
  });

  /* ---------- 词单下拉 ---------- */
  function deckOptions(sel, withStar) {
    const opts = ['<option value="all">全部词单（' + words.length + '）</option>'];
    if (withStar) {
      const n = words.filter((x) => SRS.isStar(x.w)).length;
      opts.push(`<option value="star">难词本（${n}）</option>`);
    }
    decks.forEach((d) => {
      const n = words.filter((x) => x.d === d.id).length;
      if (n) opts.push(`<option value="${esc(d.id)}">${esc(d.name)}（${n}）</option>`);
    });
    const keep = sel.value;
    sel.innerHTML = opts.join('');
    if (keep && $(`option[value="${keep}"]`, sel)) sel.value = keep;
  }
  function refreshDeckSelects() {
    deckOptions($('#deckSel'), true);
    deckOptions($('#quizDeck'), true);
    deckOptions($('#listDeck'), true);
    $('#deckSel').value = SRS.deck || 'all';
  }

  /* ---------- 背词 ---------- */
  let session = [], idx = 0, flipped = false;
  const card = $('#card');

  function newSession() {
    const deck = $('#deckSel').value;
    SRS.deck = deck;
    session = SRS.queue(words, deck);
    idx = 0;
    showCard();
  }

  function markEx(ex, w) {
    const safe = esc(ex);
    const word = w.toLowerCase();
    const parts = word.split(/\s+/).filter((p) => p.length > 2);
    let html = safe;
    (parts.length ? parts : [word]).forEach((p) => {
      const stem = p.slice(0, Math.max(3, Math.min(p.length, p.length - 1)));
      try {
        const re = new RegExp('\\b(' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]*)\\b', 'ig');
        html = html.replace(re, '<b>$1</b>');
      } catch (e) {}
    });
    return html;
  }

  function showCard() {
    const total = session.length;
    const done = Math.min(idx, total);
    $('#counter').textContent = `${done} / ${total}`;
    $('#sessionBar').style.width = total ? (done / total) * 100 + '%' : '0%';
    flipped = false;
    card.classList.remove('flipped');
    $('#gradeRow').hidden = true;

    if (idx >= total) {
      card.hidden = true;
      $('#emptyNote').hidden = false;
      $('#starBtn').disabled = true;
      return;
    }
    card.hidden = false;
    $('#emptyNote').hidden = true;
    $('#starBtn').disabled = false;

    const x = session[idx];
    $('#cPos').textContent = x.p || '';
    $('#cWord').textContent = x.w;
    $('#cIpa').textContent = x.ipa || '';
    $('#cZh').textContent = x.zh;
    $('#cEn').textContent = x.en || '';
    $('#cEx').innerHTML = x.ex ? markEx(x.ex, x.w) : '';
    $('#cSyn').textContent = x.syn || '';
    $('#cSyn').hidden = !x.syn;
    const star = SRS.isStar(x.w);
    $('#starBtn').textContent = star ? '★ 已在难词本' : '☆ 收进难词本';
    $('#starBtn').classList.toggle('starred', star);
  }

  function flip() {
    if (card.hidden || idx >= session.length) return;
    flipped = !flipped;
    card.classList.toggle('flipped', flipped);
    $('#gradeRow').hidden = !flipped;
  }
  card.addEventListener('click', (e) => { if (!e.target.closest('.speak')) flip(); });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); flip(); }
  });
  $('#speakBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const x = session[idx];
    if (x) speak(x.w, e.currentTarget);
  });
  $('#gradeRow').addEventListener('click', (e) => {
    const b = e.target.closest('.grade');
    if (!b) return;
    doGrade(+b.dataset.g);
  });
  function doGrade(g) {
    const x = session[idx];
    if (!x || !flipped) return;
    SRS.grade(x.w, g);
    if (g === 0) session.push(x);          // 忘了的词当天再出现一次
    idx++;
    updateStreak();
    showCard();
  }
  $('#starBtn').addEventListener('click', () => {
    const x = session[idx];
    if (!x) return;
    const on = SRS.toggleStar(x.w);
    $('#starBtn').textContent = on ? '★ 已在难词本' : '☆ 收进难词本';
    $('#starBtn').classList.toggle('starred', on);
    toast(on ? '已收进难词本' : '已移出难词本');
  });
  $('#deckSel').addEventListener('change', newSession);
  const goalInput = $('#goalInput');
  goalInput.value = SRS.goal;
  goalInput.addEventListener('change', () => {
    SRS.goal = clamp(parseInt(goalInput.value, 10) || 20, 5, 200);
    goalInput.value = SRS.goal;
    newSession();
    toast('每日目标改为 ' + SRS.goal + ' 词');
  });

  function updateStreak() {
    const s = SRS.stats(words, 'all');
    $('#streak').textContent = s.streak;
  }

  /* ---------- 测验 ---------- */
  let quiz = null;
  function buildQuiz() {
    const deck = $('#quizDeck').value;
    const mode = $('#quizMode').value;
    const pool = words.filter((x) => deck === 'all' || x.d === deck || (deck === 'star' && SRS.isStar(x.w)));
    if (pool.length < 4) { toast('这个范围里的词太少，至少需要 4 个'); return; }
    // 优先考到期和没学过的词
    const sorted = pool.slice().sort((a, b) => {
      const da = SRS.isDue(a.w) ? 0 : 1, db = SRS.isDue(b.w) ? 0 : 1;
      return da - db || Math.random() - 0.5;
    });
    const picks = shuffle(sorted.slice(0, Math.max(10, Math.min(sorted.length, 24)))).slice(0, 10);
    quiz = {
      mode, pool,
      items: picks.map((x) => makeItem(x, pool, mode)),
      i: 0, right: 0, wrong: [],
    };
    $('#quizResult').hidden = true;
    renderQuestion();
  }

  function makeItem(x, pool, mode) {
    if (mode === 'spell') return { w: x, answer: x.w };
    const key = mode === 'en2zh' ? 'zh' : 'w';
    const others = shuffle(pool.filter((y) => y.w !== x.w && y[key] !== x[key])).slice(0, 3);
    const opts = shuffle([x].concat(others));
    return { w: x, opts, correct: opts.indexOf(x) };
  }

  function renderQuestion() {
    const box = $('#quizBox');
    if (!quiz || quiz.i >= quiz.items.length) return finishQuiz();
    const it = quiz.items[quiz.i];
    const x = it.w;
    const head = `<div class="q-head"><span class="q-no">第 ${quiz.i + 1} / ${quiz.items.length} 题</span><span class="q-no">答对 ${quiz.right}</span></div>`;

    if (quiz.mode === 'spell') {
      box.innerHTML = head +
        `<div class="q-prompt"><span class="big">${esc(x.zh)}</span><span class="sub">${esc(x.p || '')} · 点喇叭听发音</span></div>
         <div class="spell-row">
           <input type="text" id="spellIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="拼出这个词…" aria-label="拼写答案" />
           <button class="btn" id="spellSpeak" type="button" aria-label="朗读">🔊</button>
           <button class="btn primary" id="spellGo" type="button">确认</button>
         </div>
         <p class="spell-feedback" id="spellFb"></p>`;
      const input = $('#spellIn');
      input.focus();
      $('#spellSpeak').addEventListener('click', (e) => speak(x.w, e.currentTarget));
      $('#spellGo').addEventListener('click', checkSpell);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkSpell(); });
      speak(x.w);
      return;
    }

    const prompt = quiz.mode === 'en2zh'
      ? `<span class="big">${esc(x.w)}</span><span class="sub">${esc(x.p || '')}</span>`
      : `<span class="big">${esc(x.zh)}</span><span class="sub">${esc(x.p || '')}</span>`;
    box.innerHTML = head + `<div class="q-prompt">${prompt}</div><div class="opts" id="opts">` +
      it.opts.map((o, i) => `<button class="opt" type="button" data-i="${i}"><span class="key">${i + 1}</span>${esc(quiz.mode === 'en2zh' ? o.zh : o.w)}</button>`).join('') +
      '</div>';
    $('#opts').addEventListener('click', (e) => {
      const b = e.target.closest('.opt');
      if (b) pickOption(+b.dataset.i);
    });
  }

  function quizAnswer(w, correct) {
    if (!correct) { SRS.grade(w, 0); return; }
    if (SRS.isDue(w) || SRS.card(w).seen === 0) SRS.grade(w, 2);
    else { const c = SRS.card(w); c.seen++; c.right++; SRS.save(); }
  }

  function pickOption(i) {
    const it = quiz.items[quiz.i];
    if (it.done) return;
    it.done = true;
    const good = i === it.correct;
    $$('#opts .opt').forEach((b, k) => {
      b.disabled = true;
      if (k === it.correct) b.classList.add('right');
      else if (k === i) b.classList.add('wrong');
    });
    if (good) quiz.right++; else quiz.wrong.push(it.w);
    quizAnswer(it.w.w, good);
    if (quiz.mode === 'en2zh' || !good) speak(it.w.w);
    setTimeout(() => { quiz.i++; renderQuestion(); }, good ? 550 : 1300);
  }

  function checkSpell() {
    const it = quiz.items[quiz.i];
    if (!it || it.done) return;
    const input = $('#spellIn');
    const val = (input.value || '').trim().toLowerCase();
    if (!val) return;
    it.done = true;
    const good = val === it.answer.toLowerCase();
    if (good) quiz.right++; else quiz.wrong.push(it.w);
    quizAnswer(it.w.w, good);
    $('#spellFb').innerHTML = good
      ? '<span style="color:var(--good)">对了 ✓</span>'
      : `拼错了，正确拼写是 <span class="ans">${esc(it.answer)}</span>`;
    input.disabled = true;
    $('#spellGo').disabled = true;
    setTimeout(() => { quiz.i++; renderQuestion(); }, good ? 650 : 1600);
  }

  function finishQuiz() {
    const n = quiz.items.length, r = quiz.right;
    $('#quizBox').innerHTML = '';
    $('#quizResult').hidden = false;
    const pct = Math.round((r / n) * 100);
    $('#qrTitle').textContent = pct >= 90 ? `${r} / ${n}　很稳` : pct >= 60 ? `${r} / ${n}　还行` : `${r} / ${n}　再练练`;
    $('#qrDetail').textContent = quiz.wrong.length ? '下面这些词已经放回复习队列：' : '全部答对，这组词可以往后推了。';
    $('#qrWrong').innerHTML = quiz.wrong.map((x) => `<span>${esc(x.w)}</span>`).join('');
    updateStreak();
  }
  $('#quizNew').addEventListener('click', buildQuiz);
  $('#qrAgain').addEventListener('click', buildQuiz);
  $('#quizMode').addEventListener('change', () => { if (quiz) buildQuiz(); });
  $('#quizDeck').addEventListener('change', () => { if (quiz) buildQuiz(); });

  /* ---------- 词表 ---------- */
  function renderList() {
    const q = ($('#search').value || '').trim().toLowerCase();
    const deck = $('#listDeck').value;
    const sort = $('#listSort').value;
    let rows = words.filter((x) => {
      if (deck !== 'all' && !(x.d === deck || (deck === 'star' && SRS.isStar(x.w)))) return false;
      if (sort === 'star' && !SRS.isStar(x.w)) return false;
      if (!q) return true;
      return (x.w + ' ' + x.zh + ' ' + (x.en || '') + ' ' + (x.ex || '') + ' ' + (x.syn || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (sort === 'az') rows.sort((a, b) => a.w.localeCompare(b.w));
    else if (sort === 'box') rows.sort((a, b) => (SRS.card(b.w).box - SRS.card(a.w).box) || a.w.localeCompare(b.w));

    $('#listCount').textContent = `共 ${rows.length} 条` + (q ? `（搜索「${q}」）` : '');
    const max = SRS.INTERVALS.length - 1;
    $('#wordList').innerHTML = rows.slice(0, 400).map((x) => {
      const c = SRS.card(x.w);
      const dots = Array.from({ length: max }, (_, i) => `<i class="${i < c.box ? 'on' : ''}"></i>`).join('');
      return `<div class="row" data-w="${esc(x.w)}">
        <div>
          <div class="row-top"><span class="row-w">${esc(x.w)}</span><span class="row-p">${esc(x.p || '')}</span><span class="row-zh">${esc(x.zh)}</span></div>
          ${x.ex ? `<p class="row-ex">${markEx(x.ex, x.w)}</p>` : ''}
        </div>
        <div class="row-side">
          <span class="box-dot" title="掌握度 ${c.box}/${max}">${dots}</span>
          <button class="mini" data-act="speak" aria-label="朗读 ${esc(x.w)}">🔊</button>
          <button class="mini ${SRS.isStar(x.w) ? 'on' : ''}" data-act="star" aria-label="收藏 ${esc(x.w)}">${SRS.isStar(x.w) ? '★' : '☆'}</button>
        </div>
      </div>`;
    }).join('') || '<p class="tip">没有匹配的词。</p>';
    if (rows.length > 400) $('#listCount').textContent += '（只显示前 400 条）';
  }
  $('#wordList').addEventListener('click', (e) => {
    const b = e.target.closest('.mini');
    if (!b) return;
    const w = b.closest('.row').dataset.w;
    if (b.dataset.act === 'speak') speak(w, b);
    else { SRS.toggleStar(w); renderList(); refreshDeckSelects(); }
  });
  let searchTimer = null;
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderList, 160); });
  $('#listDeck').addEventListener('change', renderList);
  $('#listSort').addEventListener('change', renderList);

  /* ---------- 统计 ---------- */
  function renderStat() {
    const s = SRS.stats(words, 'all');
    $('#sTotal').textContent = s.total;
    $('#sMastered').textContent = s.mastered;
    $('#sLearning').textContent = s.learning;
    $('#sFresh').textContent = s.fresh;
    $('#sDue').textContent = s.due;
    $('#sStreak').textContent = s.streak;
    $('#streak').textContent = s.streak;

    const h = SRS.history(7);
    const peak = Math.max(1, ...h.map((d) => d.n));
    $('#chart').innerHTML = h.map((d, i) => `
      <div class="col ${i === h.length - 1 ? 'today' : ''}">
        <span class="vl">${d.n || ''}</span>
        <i class="bar-i" style="height:${Math.round((d.n / peak) * 100)}%"></i>
        <span class="lb">${d.label}</span>
      </div>`).join('');

    $('#deckProgress').innerHTML = decks.map((d) => {
      const st = SRS.stats(words, d.id);
      const pct = st.total ? Math.round((st.mastered / st.total) * 100) : 0;
      return `<div class="dp-row"><span>${esc(d.name)}</span><span class="dp-bar"><i style="width:${pct}%"></i></span><span class="dp-num">${st.mastered}/${st.total}</span></div>`;
    }).join('');

    const note = $('#customNote');
    if (customCount) {
      note.hidden = false;
      note.textContent = `当前词库含 ${words.length} 条，其中 ${customCount} 条是你导入的。`;
    } else note.hidden = true;
  }

  /* ---------- 导入 / 导出 ---------- */
  function parseWords(text) {
    const t = text.trim();
    if (!t) return [];
    if (t[0] === '[' || t[0] === '{') {
      const o = JSON.parse(t);
      const arr = Array.isArray(o) ? o : (o.words || []);
      return arr.map((x) => ({
        w: String(x.w || x.word || '').trim(),
        p: String(x.p || x.pos || '').trim(),
        zh: String(x.zh || x.cn || x.meaning || '').trim(),
        en: String(x.en || x.def || '').trim(),
        ex: String(x.ex || x.example || '').trim(),
        syn: String(x.syn || '').trim(),
        ipa: String(x.ipa || x.phonetic || '').trim(),
        d: String(x.d || x.deck || 'custom').trim() || 'custom',
        custom: true,
      })).filter((x) => x.w && x.zh);
    }
    // CSV / TSV：逗号或制表符分隔，支持双引号包裹
    return t.split(/\r?\n/).map((line) => {
      if (!line.trim()) return null;
      const sep = line.indexOf('\t') >= 0 ? '\t' : ',';
      const cells = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
        else if (ch === sep && !inQ) { cells.push(cur); cur = ''; }
        else cur += ch;
      }
      cells.push(cur);
      const c = cells.map((x) => x.trim());
      if (!c[0] || !c[2]) return null;
      return { w: c[0], p: c[1] || '', zh: c[2], en: c[3] || '', ex: c[4] || '', syn: c[5] || '', ipa: c[6] || '', d: c[7] || 'custom', custom: true };
    }).filter(Boolean);
  }

  const impModal = $('#impModal');
  $('#impWordsBtn').addEventListener('click', () => { $('#impMsg').textContent = ''; impModal.showModal(); });
  $('#impClose').addEventListener('click', () => impModal.close());
  impModal.addEventListener('click', (e) => { if (e.target === impModal) impModal.close(); });

  const impText = $('#impText');
  ['dragover', 'dragenter'].forEach((t) => impText.addEventListener(t, (e) => { e.preventDefault(); impText.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach((t) => impText.addEventListener(t, () => impText.classList.remove('drag-over')));
  impText.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { impText.value = String(r.result || ''); $('#impMsg').textContent = '已读入 ' + f.name; };
    r.onerror = () => { $('#impMsg').textContent = '文件读取失败'; };
    r.readAsText(f, 'utf-8');
  });

  $('#impDo').addEventListener('click', () => {
    let list;
    try { list = parseWords(impText.value); }
    catch (e) { $('#impMsg').textContent = '解析失败：' + e.message; return; }
    if (!list.length) { $('#impMsg').textContent = '没解析出词条，检查一下格式'; return; }
    const mode = ($('input[name="impMode"]:checked') || {}).value || 'append';
    if (mode === 'replace') words = list;
    else {
      const seen = {};
      words.forEach((x) => { seen[x.w.toLowerCase()] = 1; });
      words = words.concat(list.filter((x) => !seen[x.w.toLowerCase()]));
    }
    customCount = words.filter((x) => x.custom).length;
    const ids = {};
    words.forEach((x) => { ids[x.d] = 1; });
    decks = BASE_DECKS.filter((d) => ids[d.id]);
    Object.keys(ids).forEach((id) => {
      if (!decks.some((d) => d.id === id)) decks.push({ id, name: id === 'custom' ? '我导入的词' : id, desc: '导入的词表' });
    });
    saveCustom();
    refreshDeckSelects();
    newSession();
    renderStat();
    impModal.close();
    toast(`导入成功，现在共 ${words.length} 条`);
  });

  function download(name, text, type) {
    try {
      const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) { toast('导出失败'); return false; }
  }
  $('#expWordsBtn').addEventListener('click', () => {
    const csv = ['单词,词性,中文,英文释义,例句,近义替换,音标,词单']
      .concat(words.map((x) => [x.w, x.p, x.zh, x.en, x.ex, x.syn, x.ipa || '', x.d]
        .map((v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')))
      .join('\n');
    if (download(`拾词-词表-${words.length}条.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8')) toast('词表已导出（Excel 可直接打开）');
  });
  $('#expProgBtn').addEventListener('click', () => {
    if (download(`拾词-进度备份-${SRS.todayStr()}.json`, SRS.exportProgress(), 'application/json')) toast('进度已备份');
  });
  $('#impProgBtn').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json,text/plain';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const n = SRS.importProgress(String(r.result || ''));
          refreshDeckSelects();
          newSession();
          renderStat();
          toast(`进度已恢复（${n} 个词）`);
        } catch (e) { toast('恢复失败：' + e.message); }
      };
      r.readAsText(f, 'utf-8');
    });
    inp.click();
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('清空全部学习进度？词库和导入的词表会保留。')) return;
    SRS.reset('all');
    newSession();
    renderStat();
    renderList();
    toast('进度已清空');
  });

  /* ---------- 快捷键 ---------- */
  addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof Element && t.matches('input, select, textarea, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ($$('dialog').some((d) => d.open)) return;
    const k = e.key.toLowerCase();
    if (view === 'learn') {
      if (e.code === 'Space') { e.preventDefault(); flip(); return; }
      if (/^[123]$/.test(k) && flipped) { doGrade(+k - 1); return; }
      if (k === 's') { const x = session[idx]; if (x) speak(x.w, $('#speakBtn')); return; }
      if (k === 'f') { $('#starBtn').click(); return; }
    } else if (view === 'quiz' && quiz && quiz.i < quiz.items.length) {
      const it = quiz.items[quiz.i];
      if (quiz.mode !== 'spell' && /^[1-4]$/.test(k) && it && !it.done) { pickOption(+k - 1); return; }
      if (k === 's') { const x = it && it.w; if (x) speak(x.w); return; }
    }
    if (/^[1-4]$/.test(k) && view !== 'quiz' && view !== 'learn') setView(views[+k - 1]);
  });

  $('#helpBtn').addEventListener('click', () => $('#helpModal').showModal());
  $('#helpClose').addEventListener('click', () => $('#helpModal').close());
  $('#helpModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  /* ---------- 装到桌面 / 离线 ---------- */
  const installBtn = $('#installBtn');
  let installEvent = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!installEvent) return;
      installBtn.hidden = true;
      try {
        installEvent.prompt();
        const r = await installEvent.userChoice;
        if (r && r.outcome === 'accepted') toast('已装到桌面，断网也能背');
      } catch (e) {}
      installEvent = null;
    });
  }
  addEventListener('appinstalled', () => { if (installBtn) installBtn.hidden = true; });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  /* ---------- 启动 ---------- */
  loadCustom();
  refreshDeckSelects();
  newSession();
  updateStreak();
  const h = (location.hash || '').replace('#', '');
  if (views.indexOf(h) >= 0) setView(h); else setView('learn');

  // 供自动化检查使用
  window.SC = {
    get words() { return words; },
    get decks() { return decks; },
    get session() { return session; },
    get idx() { return idx; },
    get flipped() { return flipped; },
    get quiz() { return quiz; },
    setView, flip, doGrade, newSession, buildQuiz, pickOption, checkSpell,
    parseWords, renderList, renderStat, speak, markEx,
    get customCount() { return customCount; },
  };
})();
