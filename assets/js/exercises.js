/* ==========================================================================
   exercises.js — общие движки упражнений и итоговый экран
   Страница описывается данными и вызывает Trainer.mount(PAGE):

   PAGE = {
     id, title, subtitle, kicker,
     exercises: [{ id, type, title, color, topic, instr, hint, wrongHint, items: [...] }]
   }

   Типы (type): match, gapBank, choice, typeFix, order, typeWord, sort, writing.
   Пункт (item) — обычно { text, answer } или { text, full }:
     text   — что видит ученик (___ — место пропуска);
     answer — правильный ответ (для match, gapBank, choice, sort);
     full   — правильное предложение с разметкой (для typeFix, order, typeWord;
              в choice — для разбора);
     alts   — другие правильные варианты (typeFix);
     hint   — подсказка после первой ошибки (по-русски);
     topic / topics — тема (to_be, there_is_are, plural, articles, vocab …).
   Разметка в full и hint: {s|подлежащее} {v|глагол} {e|окончание} {a|артикль}.

   Баллы: 1 за верный ответ с первой попытки, 0,5 со второй, 0 если показан ответ.
   ========================================================================== */
(function () {
  'use strict';

  // ---------- помощники ----------

  function h(tag, props) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(k => add(el, k));
    else el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MARKS = { s: 'g-subj', v: 'g-verb', e: 'g-end', a: 'g-art' };
  const mark = s => esc(s).replace(/\{([svea])\|([^}]*)\}/g, (_, k, t) => '<span class="' + MARKS[k] + '">' + t + '</span>');
  const plain = s => String(s).replace(/\{[svea]\|([^}]*)\}/g, '$1');
  const fmt = n => String(Math.round(n * 10) / 10).replace('.', ',');

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // перемешать так, чтобы порядок не совпал с исходным
  function shuffleNot(arr) {
    if (arr.length < 2) return arr.slice();
    let a, n = 0;
    do { a = shuffle(arr); } while (a.join('\u0001') === arr.join('\u0001') && ++n < 20);
    return a;
  }
  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // Сравнение ответов: регистр, двойные пробелы, конечная точка, апострофы, сокращения
  const CONTRACTIONS = [
    [/\bi'm\b/g, 'i am'], [/\bisn't\b/g, 'is not'], [/\baren't\b/g, 'are not'],
    [/\bthere's\b/g, 'there is'], [/\bit's\b/g, 'it is'], [/\bhe's\b/g, 'he is'],
    [/\bshe's\b/g, 'she is'], [/\bthat's\b/g, 'that is'], [/\bwe're\b/g, 'we are'],
    [/\bthey're\b/g, 'they are'], [/\byou're\b/g, 'you are'], [/\bthere're\b/g, 'there are']
  ];
  function norm(s) {
    let t = String(s == null ? '' : s).toLowerCase()
      .replace(/[’‘ʼ`´]/g, "'")
      .replace(/[“”«»]/g, '"')
      .replace(/[.,!?;:"]/g, ' ');
    CONTRACTIONS.forEach(([re, full]) => { t = t.replace(re, full); });
    return t.replace(/\s+/g, ' ').trim();
  }

  const PRAISE = ['Great!', 'Well done!', 'Exactly!', 'Perfect!', 'Super!', 'Nice work!', 'Brilliant!', 'Good job!', 'Excellent!', 'You got it!'];
  let lastPraise = '';
  function praise() {
    let p;
    do { p = PRAISE[Math.floor(Math.random() * PRAISE.length)]; } while (p === lastPraise);
    lastPraise = p;
    return p;
  }

  const TOPICS = {
    to_be: 'am / is / are',
    there_is_are: 'there is / there are',
    plural: 'множественное число (-s)',
    articles: 'a / an / the',
    vocab: 'слова урока',
    present_simple: 'Present Simple',
    present_continuous: 'Present Continuous',
    writing: 'письмо'
  };
  const topicName = t => TOPICS[t] || t;

  function shake(el) {
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  // ======================================================================
  //  Перетаскивание: мышь и тач (Pointer Events) + «кликни карточку → кликни место»
  //  Зона (.dz): data-kind = bank | slot (одна карточка) | list (много, по порядку)
  //  Карточки и зоны одной группы (data-group) работают только друг с другом.
  // ======================================================================

  const DnD = (() => {
    const groups = {};
    let selected = null;
    let drag = null;
    let suppressClick = false;

    const isLocked = el => el && el.dataset.locked === '1';
    const zoneOf = chip => chip.parentElement && chip.parentElement.closest('.dz');
    const q = (g, kind) => document.querySelector('.dz[data-group="' + g + '"][data-kind="' + kind + '"]');

    function group(name, opts) { groups[name] = opts || {}; }

    function chip(text, g) {
      return h('span', { class: 'chip', role: 'button', tabindex: '0', 'data-group': g }, text);
    }
    function zone(kind, g, label, cls, tag) {
      return h(tag || 'div', {
        class: 'dz ' + (cls || ''), 'data-kind': kind, 'data-group': g,
        tabindex: kind === 'bank' ? null : '0', role: kind === 'bank' ? 'group' : 'button', 'aria-label': label
      });
    }
    function lock(el) {
      el.dataset.locked = '1';
      if (el.classList.contains('chip')) { el.setAttribute('aria-disabled', 'true'); el.removeAttribute('tabindex'); }
      else el.removeAttribute('tabindex');
    }

    function select(c) {
      if (selected) selected.classList.remove('is-selected');
      selected = c;
      document.querySelectorAll('.dz.is-target').forEach(z => z.classList.remove('is-target'));
      if (!c) return;
      c.classList.add('is-selected');
      document.querySelectorAll('.dz[data-group="' + c.dataset.group + '"]').forEach(z => {
        if (z.dataset.kind !== 'bank' && !isLocked(z) && z !== zoneOf(c)) z.classList.add('is-target');
      });
    }

    function refresh(z) {
      if (z && z.dataset.kind === 'slot') z.classList.toggle('is-filled', !!z.querySelector('.chip'));
    }

    // переложить карточку в зону (в слоте старая карточка уходит туда, откуда пришла новая)
    function move(c, z, before) {
      const from = zoneOf(c);
      if (z === from && z.dataset.kind !== 'list') { select(null); return; }
      const hadFocus = document.activeElement === c;
      if (z.dataset.kind === 'slot') {
        const other = z.querySelector('.chip');
        if (other && other !== c) {
          const back = from && from.dataset.kind === 'slot' && !isLocked(from) ? from : q(c.dataset.group, 'bank');
          if (back) { back.appendChild(other); refresh(back); }
        }
      }
      if (before && before !== c) z.insertBefore(c, before); else z.appendChild(c);
      refresh(z); refresh(from);
      select(null);
      if (hadFocus) c.focus({ preventScroll: true });
      const g = groups[c.dataset.group];
      if (g && g.onChange) g.onChange(c, from, z);
    }

    function activateChip(c) {
      if (isLocked(c)) return;
      const g = groups[c.dataset.group] || {};
      const z = zoneOf(c);
      if (g.mode === 'quick') {               // «собери предложение»: клик сразу перекладывает
        const target = z && z.dataset.kind === 'bank' ? q(c.dataset.group, 'list') : q(c.dataset.group, 'bank');
        if (target && !isLocked(target)) move(c, target);
        return;
      }
      if (selected === c) { select(null); return; }
      if (selected && selected.dataset.group === c.dataset.group && z && z.dataset.kind !== 'bank' && !isLocked(z)) {
        move(selected, z);
        return;
      }
      select(c);
    }
    function activateZone(z) {
      if (!selected || selected.dataset.group !== z.dataset.group || isLocked(z)) return;
      move(selected, z);
    }

    document.addEventListener('click', e => {
      if (suppressClick) { suppressClick = false; return; }
      const c = e.target.closest('.chip[data-group]');
      if (c) { activateChip(c); return; }
      const z = e.target.closest('.dz');
      if (z) activateZone(z);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { select(null); return; }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target;
      if (!t.matches) return;
      if (t.matches('.chip[data-group]')) { e.preventDefault(); activateChip(t); }
      else if (t.matches('.dz')) { e.preventDefault(); activateZone(t); }
    });

    function insertBefore(z, x, y, c) {
      const kids = Array.from(z.children).filter(k => k.classList.contains('chip') && k !== c);
      for (const k of kids) {
        const r = k.getBoundingClientRect();
        if (y < r.top) return k;
        if (y <= r.bottom && x < r.left + r.width / 2) return k;
      }
      return null;
    }

    function zoneAt(x, y, g) {
      const el = document.elementFromPoint(x, y);
      const z = el && el.closest('.dz[data-group="' + g + '"]');
      return z && !isLocked(z) ? z : null;
    }

    document.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const c = e.target.closest('.chip[data-group]');
      if (!c || isLocked(c)) return;
      drag = { chip: c, id: e.pointerId, x: e.clientX, y: e.clientY, started: false, ghost: null, over: null };
    });

    document.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.started) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        drag.started = true;
        const r = drag.chip.getBoundingClientRect();
        drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
        drag.ghost = drag.chip.cloneNode(true);
        drag.ghost.classList.add('chip--ghost');
        drag.ghost.classList.remove('is-selected');
        drag.ghost.style.width = r.width + 'px';
        document.body.appendChild(drag.ghost);
        select(drag.chip);
        drag.chip.classList.add('is-dragging');
      }
      e.preventDefault();
      drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
      drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
      const z = zoneAt(e.clientX, e.clientY, drag.chip.dataset.group);
      if (z !== drag.over) {
        if (drag.over) drag.over.classList.remove('is-over');
        drag.over = z;
        if (z) z.classList.add('is-over');
      }
      if (e.clientY < 70) window.scrollBy(0, -14);
      else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
    }, { passive: false });

    function endDrag(e, cancel) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const d = drag;
      drag = null;
      if (!d.started) return;               // это был обычный клик
      d.ghost.remove();
      d.chip.classList.remove('is-dragging');
      if (d.over) d.over.classList.remove('is-over');
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (!cancel && d.over) {
        const before = d.over.dataset.kind === 'list' ? insertBefore(d.over, e.clientX, e.clientY, d.chip) : null;
        move(d.chip, d.over, before);
      } else {
        select(null);
      }
    }
    document.addEventListener('pointerup', e => endDrag(e, false));
    document.addEventListener('pointercancel', e => endDrag(e, true));

    return { group, chip, zone, lock, move, select, q };
  })();

  // ======================================================================
  //  Движки. Каждый возвращает { el, getAnswer(item), setStatus(item, status) }
  //  и по желанию active() / afterCheck() / isCorrect().
  //  status: correct | wrong (можно исправить) | revealed (показан правильный ответ)
  // ======================================================================

  function itemRow(it, n, q) {
    it._fb = h('div', { class: 'item__fb', 'aria-live': 'polite' });
    it._row = h('li', { class: 'item' },
      h('span', { class: 'item__n' }, String(n)),
      h('div', { class: 'item__body' }, q, it._fb));
    return it._row;
  }

  // текст с пропуском ___ → [до, элемент, после]
  function withGap(text, gapEl) {
    const i = text.indexOf('___');
    if (i < 0) return [text + ' ', gapEl];
    return [text.slice(0, i), gapEl, text.slice(i + 3)];
  }

  // --- choice: кнопки-таблетки ---
  function choiceEngine(ex, items, ctx) {
    const list = h('ol', { class: 'items' });
    items.forEach((it, i) => {
      const blank = h('span', { class: 'blank' }, '___');
      const options = it.options || ex.options;
      const pills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Варианты ответа' });
      it._pills = options.map(o => {
        const b = h('button', {
          type: 'button', class: 'pill', 'aria-pressed': 'false', lang: 'en',
          onclick: () => {
            if (it.done) return;
            it._sel = o;
            it._pills.forEach(p => { p.setAttribute('aria-pressed', String(p === b)); p.classList.remove('is-wrong'); });
            blank.textContent = o;
            blank.classList.add('is-set');
            ctx.clearItem(it);
          }
        }, o);
        pills.appendChild(b);
        return b;
      });
      it._blank = blank;
      list.appendChild(itemRow(it, i + 1,
        h('div', { class: 'item__q' }, h('span', { lang: 'en' }, withGap(it.text, blank)), pills)));
    });
    return {
      el: list,
      getAnswer: it => it._sel,
      setStatus(it, st) {
        const sel = it._pills.find(p => p.textContent === it._sel);
        if (st === 'wrong') { if (sel) sel.classList.add('is-wrong'); return; }
        it._pills.forEach(p => {
          p.disabled = true;
          if (p.textContent === it.correct) p.classList.add('is-correct');
        });
        if (st === 'revealed' && sel) sel.classList.add('is-wrong');
        it._blank.textContent = it.correct;
      }
    };
  }

  // --- match и gapBank: карточки из банка в места-«слоты» ---
  function slotEngine(ex, items, ctx, layout) {
    const wrap = h('div');
    const rounds = chunk(items, ex.roundSize || items.length);
    let current = 0;

    rounds.forEach((ritems, r) => {
      const g = ex._uid + '-r' + r;
      DnD.group(g, {
        mode: 'select',
        onChange: (c, from, to) => [from, to].forEach(z => { if (z && z._item) ctx.clearItem(z._item); })
      });
      const bank = DnD.zone('bank', g, 'Карточки', 'bank');
      shuffle(ritems.map(it => it.answer)).forEach(w => bank.appendChild(DnD.chip(w, g)));
      const list = h('ol', { class: 'items' });
      ritems.forEach(it => {
        const slot = DnD.zone('slot', g, 'Место для ответа', 'drop', 'span');
        slot._item = it;
        it._slot = slot;
        it._bank = bank;
        const q = layout === 'pair'
          ? h('div', { class: 'item__q item__q--pair' }, h('span', { class: 'pair__en', lang: 'en' }, it.text), slot)
          : h('div', { class: 'item__q item__q--sentence', lang: 'en' }, withGap(it.text, slot));
        list.appendChild(itemRow(it, items.indexOf(it) + 1, q));
      });
      const block = h('div', { class: 'round', hidden: r > 0 },
        rounds.length > 1 ? h('p', { class: 'round__label' }, 'Раунд ' + (r + 1) + ' из ' + rounds.length) : null,
        bank, list);
      ritems._block = block;
      wrap.appendChild(block);
    });

    return {
      el: wrap,
      active: () => rounds[current].filter(it => !it.done),
      getAnswer(it) {
        const c = it._slot.querySelector('.chip');
        return c ? c.textContent : null;
      },
      setStatus(it, st) {
        const slot = it._slot;
        slot.classList.remove('is-wrong');
        if (st === 'wrong') { slot.classList.add('is-wrong'); return; }
        if (st === 'correct') {
          slot.classList.add('is-correct');
          DnD.lock(slot);
          slot.querySelectorAll('.chip').forEach(DnD.lock);
          return;
        }
        // revealed: чужую карточку возвращаем в банк, нужную убираем из банка
        const mine = slot.querySelector('.chip');
        if (mine) DnD.move(mine, it._bank);
        const right = Array.from(it._bank.querySelectorAll('.chip')).find(c => c.textContent === it.correct);
        if (right) right.remove();
        slot.innerHTML = '';
        slot.appendChild(h('span', { class: 'chip chip--shown' }, it.correct));
        slot.classList.add('is-shown');
        DnD.lock(slot);
      },
      afterCheck() {
        // карточки с уже показанными/угаданными ответами из банка убираем
        const r = rounds[current];
        const used = r.filter(it => it.done).map(it => it.correct);
        Array.from(r[0]._bank.querySelectorAll('.chip')).forEach(c => {
          const k = used.indexOf(c.textContent);
          if (k >= 0) { used.splice(k, 1); c.remove(); }
        });
        if (r.every(it => it.done)) r[0]._bank.hidden = true;
        if (current < rounds.length - 1 && r.every(it => it.done)) {
          current++;
          const block = rounds[current]._block;
          block.hidden = false;
          block.classList.add('is-new');
          setTimeout(() => block.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600);
          return 'Раунд пройден! Следующий раунд ниже.';
        }
        return '';
      }
    };
  }

  // --- order: собрать предложение из слов ---
  function orderEngine(ex, items, ctx) {
    const list = h('ol', { class: 'items' });
    items.forEach((it, i) => {
      const g = ex._uid + '-' + it.id;
      DnD.group(g, { mode: 'quick', onChange: () => ctx.clearItem(it) });
      const bank = DnD.zone('bank', g, 'Слова', 'bank bank--small');
      shuffleNot(it.words).forEach(w => bank.appendChild(DnD.chip(w, g)));
      const line = DnD.zone('list', g, 'Предложение', 'drop drop--line');
      line.setAttribute('data-empty', 'Нажимай на слова по порядку или перетаскивай их сюда');
      line.setAttribute('lang', 'en');
      it._bank = bank;
      it._line = line;
      list.appendChild(itemRow(it, i + 1, h('div', null, bank, line)));
    });
    return {
      el: list,
      getAnswer(it) {
        if (it._bank.querySelector('.chip')) return null;          // использованы не все слова
        let s = Array.from(it._line.querySelectorAll('.chip')).map(c => c.textContent).join(' ')
          .replace(/\s+([?.!,])/g, '$1');
        if (!/[?.!]$/.test(s)) s += '.';
        return s;
      },
      setStatus(it, st) {
        it._line.classList.remove('is-wrong');
        if (st === 'wrong') { it._line.classList.add('is-wrong'); return; }
        it._line.classList.add(st === 'correct' ? 'is-correct' : 'is-wrong');
        [it._line, it._bank].forEach(DnD.lock);
        it._line.querySelectorAll('.chip').forEach(DnD.lock);
      }
    };
  }

  // --- typeFix и typeWord: напечатать ответ ---
  function inputEngine(ex, items, ctx, kind) {
    const list = h('ol', { class: 'items' });
    const inputs = [];
    items.forEach((it, i) => {
      const input = h('input', {
        type: 'text', class: 'input' + (kind === 'word' ? ' input--word' : ''), lang: 'en',
        autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
        'aria-label': kind === 'word' ? 'Множественное число от ' + it.text : 'Исправленное предложение',
        placeholder: kind === 'word' ? '' : 'Напиши предложение целиком'
      });
      input.addEventListener('input', () => { input.classList.remove('is-wrong'); ctx.clearItem(it); });
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = inputs.slice(inputs.indexOf(input) + 1).find(x => !x.readOnly);
        if (next) next.focus(); else ctx.check();
      });
      inputs.push(input);
      it._input = input;
      const q = kind === 'word'
        ? h('div', { class: 'item__q' }, h('span', { class: 'word-src', lang: 'en' }, it.text), h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'), input)
        : h('div', null, h('div', { class: 'item__src', lang: 'en' }, it.text), input);
      list.appendChild(itemRow(it, i + 1, q));
    });
    return {
      el: list,
      getAnswer: it => it._input.value.trim() || null,
      setStatus(it, st) {
        const inp = it._input;
        inp.classList.remove('is-wrong', 'is-correct');
        inp.classList.add(st === 'correct' ? 'is-correct' : 'is-wrong');
        if (st !== 'wrong') inp.readOnly = true;
      }
    };
  }

  // --- sort: разложить карточки по колонкам ---
  function sortEngine(ex, items, ctx) {
    const g = ex._uid;
    DnD.group(g, { mode: 'select', onChange: c => c.classList.remove('is-wrong') });
    const bank = DnD.zone('bank', g, 'Карточки', 'bank');
    const cols = {};
    const colsEl = h('div', { class: 'sort-cols' }, ex.columns.map(title => {
      const z = DnD.zone('list', g, 'Колонка ' + title, 'drop');
      z._col = title;
      cols[title] = z;
      return h('div', { class: 'sort-col' }, h('p', { class: 'sort-col__title' }, title), z);
    }));
    shuffle(items).forEach(it => {
      const c = DnD.chip(it.text, g);
      c.setAttribute('lang', 'en');
      it._chip = c;
      bank.appendChild(c);
    });
    return {
      el: h('div', null, bank, colsEl),
      getAnswer(it) {
        const z = it._chip.parentElement.closest('.dz');
        return z && z._col ? z._col : null;
      },
      setStatus(it, st) {
        const c = it._chip;
        c.classList.remove('is-wrong');
        if (st === 'wrong') { c.classList.add('is-wrong'); return; }
        if (st === 'revealed') { cols[it.correct].appendChild(c); c.classList.add('chip--shown'); }
        else c.classList.add('is-correct');
        DnD.lock(c);
      }
    };
  }

  // --- writing: свободный текст с чек-листом ---
  function writingEngine(ex) {
    const ta = h('textarea', { class: 'input', lang: 'en', spellcheck: 'true', 'aria-label': 'Твой текст', placeholder: 'I live in …' });
    const count = h('div', { class: 'word-count', 'aria-live': 'polite' }, 'Слов: 0');
    const words = () => (ta.value.match(/[A-Za-zÀ-ɏ']+/g) || []).length;
    ta.addEventListener('input', () => { count.textContent = 'Слов: ' + words(); });
    const sample = h('div', { class: 'sample', lang: 'en', hidden: true }, ex.sample || '');
    const sampleBtn = h('button', {
      type: 'button', class: 'btn btn--ghost btn--small',
      onclick: () => { sample.hidden = !sample.hidden; sampleBtn.textContent = sample.hidden ? 'Нужен пример?' : 'Спрятать пример'; }
    }, 'Нужен пример?');
    const checklist = h('ul', { class: 'checklist', 'aria-label': 'Чек-лист' },
      (ex.checklist || []).map(t => h('li', null, h('label', null, h('input', { type: 'checkbox' }), h('span', { html: mark(t) })))));
    return {
      el: h('div', { class: 'writing' },
        h('div', null, ta, count, ex.sample ? h('div', { style: 'margin-top:14px' }, sampleBtn, sample) : null),
        h('div', null, h('p', { class: 'small muted', style: 'margin:0 0 8px' }, 'Отмечай, что уже есть в тексте:'), checklist)),
      isWriting: true,
      getText: () => ta.value.trim(),
      words
    };
  }

  const ENGINES = {
    match: (ex, items, ctx) => slotEngine(ex, items, ctx, 'pair'),
    gapBank: (ex, items, ctx) => slotEngine(ex, items, ctx, 'sentence'),
    choice: choiceEngine,
    typeFix: (ex, items, ctx) => inputEngine(ex, items, ctx, 'fix'),
    typeWord: (ex, items, ctx) => inputEngine(ex, items, ctx, 'word'),
    order: orderEngine,
    sort: sortEngine,
    writing: writingEngine
  };

  // ======================================================================
  //  Страница: шапка, упражнения, проверка, итог, «ошибки ещё раз»
  // ======================================================================

  let page = null;
  let states = [];
  let renderNo = 0;
  let retryMode = false;
  const ui = {};

  function prepItem(ex, raw, i) {
    const it = Object.assign({}, raw);
    it.raw = raw;
    it.id = raw.id || ex.id + '-' + (i + 1);
    it.topics = raw.topics || [raw.topic || ex.topic];
    it.correct = raw.answer != null ? raw.answer : plain(raw.full);
    it.alts = raw.alts || [];
    if (raw.full) it.reveal = mark(raw.full);
    else if (ex.type === 'match') it.reveal = esc(raw.text) + ' — <span class="g-fill">' + esc(it.correct) + '</span>';
    else if (raw.text && raw.text.indexOf('___') >= 0) it.reveal = esc(raw.text).replace('___', '<span class="g-fill">' + esc(it.correct) + '</span>');
    else it.reveal = esc(it.correct);
    it.prompt = raw.words ? raw.words.join(' / ') : (raw.text || '');
    it.attempt = 0;
    it.done = false;
    it.points = 0;
    it.firstWrong = null;
    return it;
  }

  function clearItem(it) {
    if (it.done || !it._fb) return;
    it._fb.innerHTML = '';
  }

  function feedback(st, it, status) {
    if (!it._fb) return;
    let el;
    if (status === 'correct') {
      el = h('div', { class: 'fb fb--ok' }, h('span', { class: 'fb__icon', 'aria-hidden': 'true' }),
        h('span', null, h('span', { class: 'praise', lang: 'en' }, praise()), it.attempt > 1 ? ' Со второй попытки.' : ''));
    } else if (status === 'wrong') {
      el = h('div', { class: 'fb fb--bad' }, h('span', { class: 'fb__icon', 'aria-hidden': 'true' }),
        h('span', { html: mark(it.hint || st.ex.wrongHint || 'Не совсем. Попробуй ещё раз.') }));
      shake(it._row.querySelector('.item__q') || it._row);
    } else {
      el = h('div', { class: 'fb fb--show' }, h('span', { class: 'fb__icon', 'aria-hidden': 'true' }),
        h('span', null, 'Правильно: ', h('span', { lang: 'en', html: it.reveal })));
    }
    it._fb.innerHTML = '';
    it._fb.appendChild(el);
  }

  function say(st, text, kind) {
    st.msg.textContent = text;
    st.msg.className = 'ex__msg' + (kind ? ' is-' + kind : '');
  }

  function points(items) { return items.reduce((s, it) => s + it.points, 0); }

  function check(st) {
    if (st.done && !st.engine.isWriting) return;
    const e = st.engine;

    if (e.isWriting) {
      if (!e.getText()) { say(st, 'Сначала напиши хотя бы пару предложений.', 'bad'); return; }
      st.done = true;
      st.btn.textContent = 'Сохранить ещё раз';
      say(st, 'Сохранено ✓ Текст уйдёт учителю вместе с итогом.', 'ok');
      complete(st);
      return;
    }

    const active = e.active ? e.active() : st.items.filter(it => !it.done);
    const missing = active.filter(it => { const a = e.getAnswer(it); return a == null || a === ''; });
    if (missing.length) {
      say(st, 'Сначала ответь на все пункты. Осталось: ' + missing.length + '.', 'bad');
      missing.forEach(it => shake(it._row ? (it._row.querySelector('.item__q') || it._row) : it._chip));
      return;
    }

    const rows = [];
    let ok = 0;
    active.forEach(it => {
      const ans = e.getAnswer(it);
      it.attempt++;
      const right = e.isCorrect ? e.isCorrect(it, ans)
        : [it.correct].concat(it.alts).some(a => norm(a) === norm(ans));
      let status;
      if (right) {
        it.done = true;
        it.points = it.attempt === 1 ? 1 : 0.5;
        status = 'correct';
        ok++;
      } else {
        if (it.firstWrong == null) it.firstWrong = ans;
        if (it.attempt >= 2) { it.done = true; it.points = 0; status = 'revealed'; }
        else status = 'wrong';
      }
      rows.push({
        exercise_id: st.ex.id, exercise_title: st.ex.title, item_id: it.id,
        prompt: it.prompt, student_answer: ans, correct_answer: it.correct,
        is_correct: right, attempt: it.attempt, topic: it.topics.join('+')
      });
      e.setStatus(it, status, ans);
      feedback(st, it, status);
    });
    if (window.Tracker) Tracker.sendAnswers(rows);

    const roundMsg = e.afterCheck ? e.afterCheck() : '';
    const left = st.items.filter(it => !it.done).length;
    if (!left) {
      complete(st);
    } else if (ok === active.length) {
      say(st, roundMsg || 'Всё верно!', 'ok');
      st.btn.textContent = 'Проверить';
    } else {
      const wrongLeft = active.filter(it => !it.done).length;
      say(st, 'Верно: ' + ok + ' из ' + active.length + '.' +
        (wrongLeft ? ' Исправь отмеченные красным и проверь ещё раз.' : (roundMsg ? ' ' + roundMsg : '')), wrongLeft ? 'bad' : 'ok');
      st.btn.textContent = wrongLeft ? 'Проверить ещё раз' : 'Проверить';
    }
    updateScore(st);
    updateProgress();
  }

  function complete(st) {
    st.done = true;
    st.section.classList.add('is-complete');
    if (!st.engine.isWriting) {
      st.btn.hidden = true;
      const p = points(st.items);
      say(st, (p === st.items.length ? 'Всё верно с первого раза! ' : 'Задание выполнено. ') +
        'Баллы: ' + fmt(p) + ' из ' + st.items.length + '.', 'ok');
    }
    const idx = states.indexOf(st);
    st.next.hidden = idx === states.length - 1;
    updateProgress();
  }

  function updateScore(st) {
    if (st.engine.isWriting) return;
    const done = st.items.filter(it => it.done).length;
    st.score.textContent = done ? 'Отвечено ' + done + ' из ' + st.items.length + ' · баллы ' + fmt(points(st.items)) : '';
  }

  function updateProgress() {
    const curr = states.findIndex(s => !s.done);
    ui.progress.innerHTML = '';
    states.forEach((s, i) => {
      const errors = s.items.some(it => it.done && it.points < 1);
      ui.progress.appendChild(h('span', {
        class: 'progress__seg' + (s.done ? ' is-done' : '') + (errors ? ' has-errors' : '') + (i === curr ? ' is-current' : '')
      }));
    });
    const doneCount = states.filter(s => s.done).length;
    ui.progressLabel.textContent = 'Выполнено заданий: ' + doneCount + ' из ' + states.length;

    const scored = states.filter(s => !s.engine.isWriting);
    const left = scored.filter(s => !s.done).length;
    const writing = states.find(s => s.engine.isWriting);
    ui.finishBtn.disabled = left > 0;
    ui.finishText.textContent = left
      ? 'Чтобы увидеть итог, осталось выполнить заданий: ' + left + '.'
      : (writing && !writing.done
        ? 'Все задания с баллами готовы! Письменное задание можно сделать до итога — или сразу смотреть результат.'
        : 'Всё готово! Нажми, чтобы увидеть результат и отправить его учителю.');
  }

  function buildExercise(ex, i) {
    const items = (ex.items || []).map((raw, k) => prepItem(ex, raw, k));
    const st = { ex, items, done: false };
    const exx = Object.assign({}, ex, { _uid: ex.id + '-' + renderNo });
    const ctx = { check: () => check(st), clearItem };
    st.engine = ENGINES[ex.type](exx, items, ctx);
    st.btn = h('button', { type: 'button', class: 'btn', onclick: () => check(st) }, st.engine.isWriting ? 'Готово' : 'Проверить');
    st.next = h('button', {
      type: 'button', class: 'btn btn--ghost btn--small', hidden: true,
      onclick: () => {
        const nxt = states[states.indexOf(st) + 1];
        if (nxt) nxt.section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 'Дальше ↓');
    st.score = h('span', { class: 'ex__score' });
    st.msg = h('span', { class: 'ex__msg', role: 'status', 'aria-live': 'polite' });
    st.section = h('section', { class: 'ex', 'data-color': ex.color || 'olive', id: 'ex-' + ex.id, 'aria-label': 'Упражнение ' + (ex.num || i + 1) },
      h('div', { class: 'ex__tab' }, h('span', { class: 'ex__num' }, String(ex.num || i + 1)), h('span', { lang: 'en' }, ex.title)),
      h('div', { class: 'ex__card' },
        h('p', { class: 'ex__instr', lang: 'en' }, ex.instr),
        ex.hint ? h('details', { class: 'hint' }, h('summary', null, 'Подсказка'), h('div', { class: 'hint__body', html: mark(ex.hint) })) : null,
        st.engine.el,
        h('div', { class: 'ex__actions' }, st.btn, st.next, st.score, st.msg)));
    return st;
  }

  function renderExercises(list) {
    renderNo++;
    ui.exercises.innerHTML = '';
    states = list.map(buildExercise);
    states.forEach(s => ui.exercises.appendChild(s.section));
    ui.finish.hidden = false;
    ui.results.hidden = true;
    ui.results.innerHTML = '';
    updateProgress();
  }

  // ---------- итог ----------

  function finish() {
    const scored = states.filter(s => !s.engine.isWriting);
    const all = [];
    scored.forEach(s => s.items.forEach(it => all.push({ it, ex: s.ex })));
    const score = all.reduce((sum, x) => sum + x.it.points, 0);
    const max = all.length;
    const percent = max ? Math.round(score / max * 100) : 0;
    const mistakes = all.filter(x => x.it.points < 1);

    const topics = {};
    const byTopic = {};
    all.forEach(({ it }) => it.topics.forEach(t => {
      topics[t] = topics[t] || { got: 0, max: 0 };
      topics[t].got += it.points;
      topics[t].max += 1;
      if (it.points < 1) byTopic[t] = (byTopic[t] || 0) + 1;
    }));

    const writing = states.find(s => s.engine.isWriting);
    const freeText = writing ? writing.engine.getText() : '';

    if (window.Tracker) {
      Tracker.sendSession({
        score, max_score: max, percent,
        mistakes_count: mistakes.length, mistakes_by_topic: byTopic, free_text: freeText
      });
    }
    renderResults({ score, max, percent, mistakes, topics, freeText });
  }

  function renderResults(r) {
    const cheer = r.percent >= 90 ? ['Excellent!', 'Почти без ошибок — так держать.']
      : r.percent >= 70 ? ['Good job!', 'Хороший результат. Осталось добить несколько ошибок.']
      : ['Keep going!', 'Ошибки — это нормально. Пройди их ещё раз, и станет легче.'];

    ui.status = h('span', { class: 'status', hidden: true });
    const bars = h('div', { class: 'bars' }, Object.keys(r.topics).map(t => {
      const s = r.topics[t];
      const pct = Math.round(s.got / s.max * 100);
      const fill = h('div', { class: 'bar__fill', style: 'width:0%' });
      setTimeout(() => { fill.style.width = pct + '%'; }, 60);
      return h('div', { class: 'bar' },
        h('div', { class: 'bar__head' }, h('span', null, topicName(t)), h('span', { class: 'muted' }, fmt(s.got) + ' из ' + s.max + ' · ' + pct + ' %')),
        h('div', { class: 'bar__track', role: 'img', 'aria-label': topicName(t) + ': ' + pct + ' %' }, fill));
    }));

    const mistakes = r.mistakes.length
      ? h('ol', { class: 'mistakes' }, r.mistakes.map(({ it, ex }) => h('li', null,
          h('div', { class: 'mistakes__q' }, 'Задание ' + ex.num + ' · ', h('span', { lang: 'en' }, it.prompt)),
          h('div', { lang: 'en' },
            h('span', { class: 'g-was' }, it.firstWrong == null ? '—' : String(it.firstWrong)),
            ' → ', h('span', { html: it.reveal })))))
      : h('p', null, 'Ошибок нет. Wow!');

    const actions = h('div', { class: 'ex__actions' },
      r.mistakes.length ? h('button', { type: 'button', class: 'btn', onclick: retry }, 'Пройти ошибки ещё раз') : null,
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => location.reload() }, 'Начать всю страницу заново'));

    ui.results.innerHTML = '';
    ui.results.appendChild(h('section', { class: 'ex result', 'data-color': 'lavender', id: 'result' },
      h('div', { class: 'ex__tab' }, h('span', { class: 'ex__num' }, '★'), retryMode ? 'Итог: работа над ошибками' : 'Итог'),
      h('div', { class: 'ex__card' },
        h('div', { class: 'result__top' },
          h('span', { class: 'result__score' }, fmt(r.score) + ' из ' + r.max),
          h('span', { class: 'result__pct' }, r.percent + ' %')),
        h('p', { class: 'result__cheer' }, h('strong', { lang: 'en' }, cheer[0]), ' ', cheer[1]),
        ui.status,
        h('h3', null, 'Результат по темам'), bars,
        h('h3', null, 'Мои ошибки'),
        r.mistakes.length ? h('div', { class: 'legend', style: 'margin-bottom:6px' },
          h('span', null, h('span', { class: 'g-was' }, 'было'), ' → стало')) : null,
        mistakes,
        r.freeText ? h('p', { class: 'small muted', style: 'margin-top:18px' }, 'Твой текст из письменного задания тоже отправлен учителю.') : null,
        actions)));
    ui.results.hidden = false;
    ui.finish.hidden = true;
    if (window.Tracker) showStatus(Tracker.status());
    ui.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showStatus(st) {
    if (!ui.status) return;
    const cls = { sent: 'status--ok', sending: 'status--wait', queued: 'status--bad', not_configured: 'status--wait' }[st.state];
    ui.status.hidden = !st.text;
    ui.status.className = 'status ' + (cls || '');
    ui.status.textContent = st.text;
  }

  function retry() {
    const list = states
      .filter(s => !s.engine.isWriting && s.items.some(it => it.points < 1))
      .map(s => Object.assign({}, s.ex, {
        items: s.items.filter(it => it.points < 1).map(it => Object.assign({}, it.raw, { id: it.id }))
      }));
    if (!list.length) return;
    if (window.Tracker) Tracker.newSession();
    retryMode = true;
    ui.sub.textContent = 'Работа над ошибками: здесь только те пункты, где были ошибки. Вперёд!';
    renderExercises(list);
    ui.exercises.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- сборка страницы ----------

  function mount(p, rootEl) {
    page = p;
    page.exercises.forEach((ex, i) => { ex.num = ex.num || i + 1; });
    const root = rootEl || document.getElementById('app') || document.body;

    ui.hello = h('span', { class: 'hello', lang: 'en' }, 'Hi!');
    ui.sub = h('p', { class: 'page-sub' }, p.subtitle || '');
    ui.progress = h('div', { class: 'progress', 'aria-hidden': 'true' });
    ui.progressLabel = h('div', { class: 'progress__label', 'aria-live': 'polite' });
    ui.exercises = h('div', { class: 'exercises' });
    ui.finishText = h('p', { class: 'finish__text' });
    ui.finishBtn = h('button', { type: 'button', class: 'btn btn--olive', onclick: finish, disabled: true }, 'Показать итог');
    ui.finish = h('div', { class: 'finish' }, ui.finishText, ui.finishBtn);
    ui.results = h('div', { hidden: true });

    root.appendChild(h('main', { class: 'wrap' },
      h('header', { class: 'page-head' },
        h('div', { class: 'page-head__top' }, h('span', { class: 'kicker' }, p.kicker || ''), ui.hello),
        h('h1', { class: 'page-title', lang: 'en' }, p.title),
        ui.sub,
        h('div', { class: 'legend', style: 'margin-top:14px' },
          h('span', null, h('span', { class: 'g-subj' }, 'кто/что'), ' подлежащее'),
          h('span', null, h('span', { class: 'g-verb' }, 'is'), ' глагол'),
          h('span', null, 'park', h('span', { class: 'g-end' }, 's'), ' окончание'),
          h('span', null, h('span', { class: 'g-art' }, 'a'), ' артикль')),
        h('div', { class: 'progress-bar' }, ui.progress, ui.progressLabel)),
      ui.exercises, ui.finish, ui.results));

    renderExercises(p.exercises);

    if (window.Tracker) {
      Tracker.start({ pageId: p.id, pageTitle: p.title }).then(s => {
        ui.hello.textContent = 'Hi, ' + s.name + '!';
      });
      Tracker.onStatus(showStatus);
    }
  }

  window.Trainer = { mount, _norm: norm, _mark: mark };
})();
