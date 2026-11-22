/* ==========================================================
   拾词 · 间隔重复与进度存储
   ----------------------------------------------------------
   用的是 Leitner 盒子法的改良版：每个词有一个"盒号"，
   盒号越高，下次复习间隔越长。答错退回重学，答对往上升一格。
   选它而不是 SM-2，是因为规则简单、可预测、好验证，
   对背考试词汇来说效果差别很小。
     盒 0  当天再看
     盒 1  1 天后      盒 2  2 天后     盒 3  4 天后
     盒 4  7 天后      盒 5  15 天后    盒 6  30 天后
     盒 7  60 天后（视为已掌握）
   ========================================================== */
(function () {
  'use strict';

  const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60];
  const MASTER_BOX = 6;          // 到这一格起算"已掌握"
  const KEY = 'shici-progress';
  const DAY = 86400000;

  const todayStr = (d) => {
    const t = d || new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };
  // 以"当天零点"为单位计算天数，避免同一天内反复出现
  const dayStart = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  function emptyState() {
    return {
      v: 1,
      cards: {},     // { 单词: { box, due(天起点毫秒), seen, right, wrong, star, last } }
      days: {},      // { 'YYYY-MM-DD': 当天学习次数 }
      streak: 0,
      lastDay: '',
      deck: 'all',
      goal: 20,
    };
  }

  let state = emptyState();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      // 没有存档时也要把内存状态归零，保证 load() 始终等于"按存档重建"
      if (!raw) { state = emptyState(); return; }
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return;
      // 逐字段校验，坏档不至于让整个应用起不来
      const s = emptyState();
      if (o.cards && typeof o.cards === 'object') {
        Object.keys(o.cards).forEach((k) => {
          const c = o.cards[k];
          if (!c || typeof c !== 'object') return;
          s.cards[k] = {
            box: clampInt(c.box, 0, INTERVALS.length - 1),
            due: Number.isFinite(c.due) ? c.due : 0,
            seen: clampInt(c.seen, 0, 1e6),
            right: clampInt(c.right, 0, 1e6),
            wrong: clampInt(c.wrong, 0, 1e6),
            star: !!c.star,
            last: Number.isFinite(c.last) ? c.last : 0,
          };
        });
      }
      if (o.days && typeof o.days === 'object') {
        Object.keys(o.days).forEach((k) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(k)) s.days[k] = clampInt(o.days[k], 0, 1e6);
        });
      }
      s.streak = clampInt(o.streak, 0, 1e5);
      s.lastDay = typeof o.lastDay === 'string' ? o.lastDay : '';
      s.deck = typeof o.deck === 'string' ? o.deck : 'all';
      s.goal = clampInt(o.goal, 5, 200) || 20;
      state = s;
    } catch (e) {
      state = emptyState();
    }
  }
  const clampInt = (v, a, b) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : a;
  };

  let saveTimer = null;
  function save(now) {
    if (now) return writeNow();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 250);
  }
  function writeNow() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function card(w) {
    if (!state.cards[w]) state.cards[w] = { box: 0, due: 0, seen: 0, right: 0, wrong: 0, star: false, last: 0 };
    return state.cards[w];
  }

  /* ---------- 评级：忘了 / 模糊 / 会了 ---------- */
  // grade: 0 忘了 → 回到盒 0；1 模糊 → 退一格；2 会了 → 进一格
  function grade(w, g) {
    const c = card(w);
    c.seen++;
    c.last = Date.now();
    if (g === 2) { c.box = Math.min(INTERVALS.length - 1, c.box + 1); c.right++; }
    else if (g === 1) { c.box = Math.max(0, c.box - 1); }
    else { c.box = 0; c.wrong++; }
    const days = INTERVALS[c.box];
    c.due = dayStart(Date.now()) + days * DAY;
    countToday();
    save();
    return c;
  }

  function countToday() {
    const t = todayStr();
    state.days[t] = (state.days[t] || 0) + 1;
    if (state.lastDay !== t) {
      const y = todayStr(new Date(Date.now() - DAY));
      state.streak = state.lastDay === y ? state.streak + 1 : 1;
      state.lastDay = t;
    }
  }

  /* ---------- 取词 ---------- */
  const inDeck = (word, deck) => deck === 'all' || word.d === deck || (deck === 'star' && isStar(word.w));
  const isDue = (w) => {
    const c = state.cards[w];
    if (!c) return true;                       // 没学过，算待学
    return c.due <= dayStart(Date.now()) + DAY - 1;
  };

  // 今天该学的队列：先复习到期的，再补新词，上限为每日目标
  function queue(words, deck, limit) {
    const pool = words.filter((x) => inDeck(x, deck));
    const review = [], fresh = [];
    pool.forEach((x) => {
      const c = state.cards[x.w];
      if (!c || c.seen === 0) fresh.push(x);
      else if (isDue(x.w)) review.push(x);
    });
    review.sort((a, b) => (state.cards[a.w].due - state.cards[b.w].due) || (state.cards[a.w].box - state.cards[b.w].box));
    const cap = limit || state.goal || 20;
    const out = review.slice(0, cap);
    for (let i = 0; out.length < cap && i < fresh.length; i++) out.push(fresh[i]);
    return out;
  }

  function stats(words, deck) {
    const pool = words.filter((x) => inDeck(x, deck));
    let learning = 0, mastered = 0, fresh = 0, due = 0;
    pool.forEach((x) => {
      const c = state.cards[x.w];
      if (!c || c.seen === 0) { fresh++; return; }
      if (c.box >= MASTER_BOX) mastered++; else learning++;
      if (isDue(x.w)) due++;
    });
    return { total: pool.length, fresh, learning, mastered, due, streak: state.streak, today: state.days[todayStr()] || 0, goal: state.goal };
  }

  // 最近 n 天的学习量，用于画柱状图
  function history(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY);
      const k = todayStr(d);
      out.push({ day: k, label: `${d.getMonth() + 1}/${d.getDate()}`, n: state.days[k] || 0 });
    }
    return out;
  }

  const isStar = (w) => !!(state.cards[w] && state.cards[w].star);
  function toggleStar(w) {
    const c = card(w);
    c.star = !c.star;
    save();
    return c.star;
  }

  function reset(deck, words) {
    if (!deck || deck === 'all') state = Object.assign(emptyState(), { deck: state.deck, goal: state.goal });
    else (words || []).filter((x) => x.d === deck).forEach((x) => { delete state.cards[x.w]; });
    save(true);
  }

  /* ---------- 导出 / 导入进度 ---------- */
  function exportProgress() {
    return JSON.stringify({ app: 'shici', v: 1, exported: new Date().toISOString(), data: state }, null, 1);
  }
  function importProgress(text) {
    const o = JSON.parse(text);
    const src = o && o.data ? o.data : o;
    if (!src || typeof src !== 'object' || !src.cards) throw new Error('不是有效的进度文件');
    localStorage.setItem(KEY, JSON.stringify(src));
    load();
    return Object.keys(state.cards).length;
  }

  load();

  window.SRS = {
    INTERVALS, MASTER_BOX,
    get state() { return state; },
    get deck() { return state.deck; },
    set deck(v) { state.deck = v; save(); },
    get goal() { return state.goal; },
    set goal(v) { state.goal = clampInt(v, 5, 200); save(); },
    card, grade, queue, stats, history, isDue, isStar, toggleStar, reset,
    exportProgress, importProgress, save, load,
    todayStr, dayStart,
  };
})();
