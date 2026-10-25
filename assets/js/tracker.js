/* ==========================================================================
   tracker.js — общий модуль отслеживания
   • определяет ученика (?s=almina&n=Альмина, иначе спрашивает имя);
   • отправляет ответы и итог в Google Таблицу через Apps Script;
   • без сети складывает отправки в очередь (localStorage) и досылает позже.

   Использование на странице:
     Tracker.start({ pageId: 'spotlight7-u01-errors', pageTitle: '…' })
       .then(function (student) { … student.id, student.name … });
     Tracker.sendAnswers([{ exercise_id, exercise_title, item_id, prompt,
                            student_answer, correct_answer, is_correct, attempt, topic }]);
     Tracker.sendSession({ score, max_score, percent, mistakes_count,
                           mistakes_by_topic: { to_be: 2 }, free_text });
     Tracker.onStatus(function (st) { … st.state, st.pending, st.text … });
   ========================================================================== */
(function () {
  'use strict';

  var LS_STUDENT = 'et.student';
  var LS_QUEUE = 'et.queue';
  var RETRY_MS = 30000;
  var TIMEOUT_MS = 20000;

  function cfg() { return window.TRAINER_CONFIG || {}; }

  // ---------- localStorage (может быть недоступен — тогда работаем в памяти) ----------

  function lsGet(key) {
    try {
      var v = window.localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  // ---------- мелкие помощники ----------

  function uid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* старый браузер */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  var TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };

  // «Альмина» → «almina»: так имя, введённое вручную, совпадает со student_id из ссылки
  function slugify(name) {
    return String(name || '').toLowerCase().split('').map(function (ch) {
      return Object.prototype.hasOwnProperty.call(TRANSLIT, ch) ? TRANSLIT[ch] : ch;
    }).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  // ---------- ученик ----------

  function studentFromUrl() {
    var p = new URLSearchParams(window.location.search);
    var s = (p.get('s') || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(s)) return null;
    var n = (p.get('n') || '').trim().slice(0, 40);
    return { id: s, name: n || capitalize(s), fromLink: true };
  }

  function studentFromStorage() {
    var saved = lsGet(LS_STUDENT);
    if (saved && saved.id && /^[a-z0-9_-]{1,40}$/.test(saved.id)) {
      return { id: saved.id, name: saved.name || capitalize(saved.id), fromLink: false };
    }
    return null;
  }

  function askName() {
    return new Promise(function (resolve) {
      var gate = document.createElement('div');
      gate.className = 'gate';
      gate.setAttribute('role', 'dialog');
      gate.setAttribute('aria-modal', 'true');
      gate.setAttribute('aria-labelledby', 'gate-title');
      gate.innerHTML =
        '<div class="gate__box">' +
          '<h2 id="gate-title">Привет! Как тебя зовут?</h2>' +
          '<p class="muted">Напиши своё имя, чтобы учитель увидел твои результаты.</p>' +
          '<form novalidate>' +
            '<label class="sr-only" for="gate-name">Имя</label>' +
            '<input class="input" id="gate-name" name="name" autocomplete="given-name" maxlength="40" placeholder="Имя" required>' +
            '<button class="btn" type="submit">Начать</button>' +
          '</form>' +
        '</div>';
      document.body.appendChild(gate);
      var input = gate.querySelector('input');
      var form = gate.querySelector('form');
      setTimeout(function () { input.focus(); }, 50);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = input.value.trim().replace(/\s+/g, ' ');
        var id = slugify(name);
        if (!id) {
          input.classList.remove('shake');
          void input.offsetWidth;
          input.classList.add('is-wrong', 'shake');
          input.focus();
          return;
        }
        gate.remove();
        resolve({ id: id, name: capitalize(name), fromLink: false });
      });
    });
  }

  // ---------- очередь отправки ----------

  var queue = [];          // [{ batch_id, answers: [...], sessions: [...] }]
  var sending = null;      // текущий Promise отправки
  var retryTimer = null;
  var lastError = '';
  var listeners = [];
  var state = 'idle';      // idle | sending | sent | queued | not_configured

  function loadQueue() {
    var saved = lsGet(LS_QUEUE);
    if (Array.isArray(saved)) {
      var known = {};
      queue.forEach(function (b) { known[b.batch_id] = true; });
      saved.forEach(function (b) { if (b && b.batch_id && !known[b.batch_id]) queue.push(b); });
    }
  }
  function saveQueue() { lsSet(LS_QUEUE, queue); }

  var TEXTS = {
    idle: '',
    sending: 'Отправляем результат…',
    sent: 'Результат отправлен учителю ✓',
    queued: 'Не отправилось — попробуем ещё раз',
    not_configured: 'Сохранено на этом компьютере. Отправится, когда учитель подключит таблицу'
  };

  function setState(s) {
    state = s;
    var info = Tracker.status();
    listeners.forEach(function (fn) { try { fn(info); } catch (e) { /* ошибка в обработчике страницы */ } });
  }

  function post(batch) {
    var url = cfg().scriptUrl;
    if (!url) return Promise.reject(new Error('not_configured'));
    var payload = {
      key: cfg().studentKey || '',
      batch_id: batch.batch_id,
      answers: batch.answers || [],
      sessions: batch.sessions || []
    };
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    return fetch(url, {
      method: 'POST',
      // text/plain — «простой» запрос без CORS-preflight, Apps Script его принимает
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json();
    }).then(function (json) {
      if (!json || !json.ok) throw new Error((json && json.error) || 'bad_response');
      return json;
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () { retryTimer = null; flush(); }, RETRY_MS);
  }

  function flush() {
    if (sending) return sending;
    loadQueue();
    if (!queue.length) { if (state !== 'sent') setState('idle'); return Promise.resolve(true); }
    if (!cfg().scriptUrl) { setState('not_configured'); return Promise.resolve(false); }

    setState('sending');
    sending = (function next() {
      if (!queue.length) return Promise.resolve(true);
      var batch = queue[0];
      return post(batch).then(function () {
        queue = queue.filter(function (b) { return b.batch_id !== batch.batch_id; });
        saveQueue();
        return next();
      });
    })().then(function () {
      sending = null;
      lastError = '';
      setState('sent');
      return true;
    }, function (err) {
      sending = null;
      lastError = (err && err.message) || String(err);
      setState('queued');
      scheduleRetry();
      return false;
    });
    return sending;
  }

  function enqueue(answers, sessions) {
    loadQueue();
    queue.push({ batch_id: uid(), answers: answers || [], sessions: sessions || [] });
    saveQueue();
    return flush();
  }

  // ---------- публичный объект ----------

  var page = { id: '', title: '' };
  var startedAt = Date.now();

  var Tracker = {
    student: null,
    sessionId: uid(),

    // Определить ученика и подготовиться. Возвращает Promise<{ id, name }>.
    start: function (opts) {
      opts = opts || {};
      page.id = opts.pageId || '';
      page.title = opts.pageTitle || document.title;
      startedAt = Date.now();

      window.addEventListener('online', flush);
      loadQueue();
      if (queue.length) flush();

      var st = studentFromUrl() || studentFromStorage();
      var ready = st ? Promise.resolve(st) : askName();
      return ready.then(function (s) {
        lsSet(LS_STUDENT, { id: s.id, name: s.name });
        Tracker.student = s;
        return s;
      });
    },

    // Сменить ученика (например, кнопка «Это не я»)
    forget: function () {
      try { window.localStorage.removeItem(LS_STUDENT); } catch (e) { /* нет доступа */ }
    },

    // Пачка ответов за одно упражнение
    sendAnswers: function (rows) {
      var base = this._base();
      var answers = (rows || []).map(function (r) {
        return {
          timestamp: new Date().toISOString(),
          student_id: base.student_id,
          page_id: base.page_id,
          page_title: base.page_title,
          exercise_id: r.exercise_id || '',
          exercise_title: r.exercise_title || '',
          item_id: r.item_id || '',
          prompt: r.prompt || '',
          student_answer: r.student_answer == null ? '' : String(r.student_answer),
          correct_answer: r.correct_answer == null ? '' : String(r.correct_answer),
          is_correct: !!r.is_correct,
          attempt: r.attempt || 1,
          topic: r.topic || '',
          session_id: base.session_id
        };
      });
      return enqueue(answers, []);
    },

    // Итог прохождения страницы
    sendSession: function (s) {
      s = s || {};
      var base = this._base();
      var row = {
        timestamp: new Date().toISOString(),
        student_id: base.student_id,
        page_id: base.page_id,
        page_title: base.page_title,
        session_id: base.session_id,
        score: s.score || 0,
        max_score: s.max_score || 0,
        percent: s.percent != null ? s.percent
          : (s.max_score ? Math.round((s.score || 0) / s.max_score * 100) : 0),
        duration_sec: Math.round((Date.now() - startedAt) / 1000),
        mistakes_count: s.mistakes_count || 0,
        mistakes_by_topic: JSON.stringify(s.mistakes_by_topic || {}),
        free_text: s.free_text || ''
      };
      return enqueue([], [row]);
    },

    // Новое прохождение (например, «Пройти ошибки ещё раз»)
    newSession: function () {
      this.sessionId = uid();
      startedAt = Date.now();
    },

    flush: flush,

    onStatus: function (fn) {
      listeners.push(fn);
      fn(Tracker.status());
    },

    status: function () {
      return { state: state, pending: queue.length, text: TEXTS[state] || '', error: lastError };
    },

    _base: function () {
      return {
        student_id: (this.student && this.student.id) || 'unknown',
        page_id: page.id,
        page_title: page.title,
        session_id: this.sessionId
      };
    },

    _slugify: slugify
  };

  window.Tracker = Tracker;
})();
