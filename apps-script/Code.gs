/**
 * Тренажёры английского — приём результатов в Google Таблицу. Версия 1.1
 * (номер версии меняется при каждом обновлении кода — так легко проверить, что вставлен свежий).
 *
 * Как пользоваться (подробно — в README):
 *  1. Вставить этот код в Расширения → Apps Script таблицы.
 *  2. Один раз запустить функцию setup — она создаст листы и ключи.
 *  3. Развернуть → Новое развертывание → Веб-приложение
 *     (выполнять от моего имени, доступ: все). URL вставить в assets/js/config.js.
 *  После любого изменения кода: Развернуть → Управление развертываниями →
 *  карандаш → Версия: «Новая версия» → Развернуть. Иначе работает старый код.
 *
 * Ключи хранятся в Настройки проекта → Свойства скрипта:
 *  STUDENT_KEY — общий ключ учеников (такой же, как studentKey в config.js);
 *  TEACHER_KEY — ключ учителя для дашборда.
 */

var VERSION = '1.1';
var DEFAULT_STUDENT_KEY = 'picnic-7k2m9q';

var HEADERS = {
  Answers: ['timestamp', 'student_id', 'page_id', 'page_title', 'exercise_id', 'exercise_title',
            'item_id', 'prompt', 'student_answer', 'correct_answer', 'is_correct', 'attempt',
            'topic', 'session_id'],
  Sessions: ['timestamp', 'student_id', 'page_id', 'page_title', 'session_id', 'score', 'max_score',
             'percent', 'duration_sec', 'mistakes_count', 'mistakes_by_topic', 'free_text'],
  Students: ['student_id', 'имя', 'уровень', 'учебник', 'активен', 'заметки'],
  Pages: ['page_id', 'название', 'тип', 'темы', 'ссылка'],
  Summary: ['student_id', 'имя', 'прохождений', 'последнее прохождение', 'последняя страница',
            '% последнего', 'средний %', 'топ-3 тем с ошибками']
};

var SUMMARY_ROWS = 50;   // сколько учеников покрывают формулы на листе Summary

// ======================================================================
//  Настройка (запустить один раз из редактора)
// ======================================================================

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var answers = ensureSheet_(ss, 'Answers');
  var sessions = ensureSheet_(ss, 'Sessions');
  var students = ensureSheet_(ss, 'Students');
  var pages = ensureSheet_(ss, 'Pages');
  var summary = ensureSheet_(ss, 'Summary');

  if (students.getLastRow() < 2) {
    students.appendRow(['almina', 'Альмина', 'A2', 'Spotlight 7', true, '']);
  }
  if (pages.getLastRow() < 2) {
    pages.appendRow(['spotlight7-u01-errors', 'City mouse or country mouse? — Fix it!', 'errors',
                     'to_be, there_is_are, plural, articles, vocab', '']);
  }
  students.getRange(2, 5, SUMMARY_ROWS, 1).insertCheckboxes();
  answers.getRange('A2:A').setNumberFormat('dd.mm.yyyy hh:mm');
  sessions.getRange('A2:A').setNumberFormat('dd.mm.yyyy hh:mm');

  writeSummaryFormulas_(summary);

  // лишний пустой «Лист1»
  ['Лист1', 'Sheet1'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  // ключи
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('STUDENT_KEY')) props.setProperty('STUDENT_KEY', DEFAULT_STUDENT_KEY);
  if (!props.getProperty('TEACHER_KEY')) props.setProperty('TEACHER_KEY', 'teacher-' + randomString_(10));

  Logger.log('Готово! Листы созданы.');
  showKeys();
}

function showKeys() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('Ключ учеников (STUDENT_KEY): ' + props.getProperty('STUDENT_KEY'));
  Logger.log('Ключ учителя для дашборда (TEACHER_KEY): ' + props.getProperty('TEACHER_KEY'));
}

function ensureSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var headers = HEADERS[name];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#F3E7D3').setFontColor('#2E3A2F');
  sh.setFrozenRows(1);
  return sh;
}

function writeSummaryFormulas_(sh) {
  var rows = [];
  for (var r = 2; r <= SUMMARY_ROWS + 1; r++) {
    var id = 'A' + r;
    var lastSorted = 'SORT(FILTER({Sessions!A2:A,Sessions!D2:D,Sessions!H2:H},Sessions!B2:B=' + id + '),1,FALSE)';
    rows.push([
      '=IF(Students!A' + r + '="","",Students!A' + r + ')',
      '=IF(' + id + '="","",Students!B' + r + ')',
      '=IF(' + id + '="","",COUNTIF(Sessions!B:B,' + id + '))',
      '=IF(OR(' + id + '="",C' + r + '=0),"",MAXIFS(Sessions!A:A,Sessions!B:B,' + id + '))',
      '=IF(OR(' + id + '="",C' + r + '=0),"",INDEX(' + lastSorted + ',1,2))',
      '=IF(OR(' + id + '="",C' + r + '=0),"",INDEX(' + lastSorted + ',1,3))',
      '=IF(OR(' + id + '="",C' + r + '=0),"",ROUND(AVERAGEIF(Sessions!B:B,' + id + ',Sessions!H:H),0))',
      '=IF(' + id + '="","",IFERROR(TEXTJOIN(", ",TRUE,INDEX(QUERY({Answers!B2:B,Answers!M2:M,Answers!K2:K},' +
        '"select Col2, count(Col1) where Col1=\'"&' + id + '&"\' and Col3=false group by Col2 ' +
        'order by count(Col1) desc limit 3 label count(Col1) \'\'",0),0,1)),"нет ошибок"))'
    ]);
  }
  // Формулы написаны в английской записи (через запятую). Если таблица её не понимает
  // (русские настройки: «;» между аргументами), переводим в местную запись.
  var style = formulaStyle_(sh);
  Logger.log('Язык таблицы: ' + sh.getParent().getSpreadsheetLocale() + ', запись формул: ' + style);
  if (style === 'local') {
    rows = rows.map(function (row) { return row.map(localizeFormula_); });
  }
  sh.getRange(2, 1, rows.length, rows[0].length).clearContent();
  sh.getRange(2, 1, rows.length, rows[0].length).setFormulas(rows);
  sh.getRange(2, 4, rows.length, 1).setNumberFormat('dd.mm.yyyy hh:mm');
  sh.setColumnWidth(5, 280);
  sh.setColumnWidth(8, 300);
}

// Пробуем записать проверочную формулу и смотрим, посчиталась ли она
function formulaStyle_(sh) {
  var cell = sh.getRange('Z1');
  var tries = [['en', '=IF(1=1,"ok","no")'], ['local', '=IF(1=1;"ok";"no")']];
  var found = 'en';
  for (var i = 0; i < tries.length; i++) {
    cell.setFormula(tries[i][1]);
    SpreadsheetApp.flush();
    if (cell.getDisplayValue() === 'ok') { found = tries[i][0]; break; }
  }
  cell.clearContent();
  return found;
}

// «,» между аргументами → «;», «,» внутри {массива} → «\». Текст в кавычках не трогаем.
function localizeFormula_(f) {
  var out = '', inQuote = false, braces = 0;
  for (var i = 0; i < f.length; i++) {
    var ch = f.charAt(i);
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote) {
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === ',') ch = braces > 0 ? '\\' : ';';
    }
    out += ch;
  }
  return out;
}

// ======================================================================
//  Приём результатов со страниц (POST)
// ======================================================================

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    if (!body.key || body.key !== props.getProperty('STUDENT_KEY')) {
      return json_({ ok: false, error: 'bad_key' });
    }

    lock.waitLock(25000);
    locked = true;

    // одну и ту же пачку не записываем дважды (повтор из очереди после обрыва связи)
    var cache = CacheService.getScriptCache();
    var cacheKey = body.batch_id ? 'b_' + String(body.batch_id).slice(0, 80) : '';
    if (cacheKey && cache.get(cacheKey)) {
      return json_({ ok: true, duplicate: true });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var a = appendRows_(ss, 'Answers', body.answers);
    var s = appendRows_(ss, 'Sessions', body.sessions);

    if (cacheKey) cache.put(cacheKey, '1', 21600);
    return json_({ ok: true, answers: a, sessions: s });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function appendRows_(ss, name, items) {
  if (!items || !items.length) return 0;
  var sh = ss.getSheetByName(name) || ensureSheet_(ss, name);
  var headers = HEADERS[name];
  var values = items.slice(0, 500).map(function (item) {
    return headers.map(function (h) { return cell_(h, item[h]); });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  return values.length;
}

function cell_(header, v) {
  if (header === 'timestamp') {
    var d = v ? new Date(v) : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  }
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  var s = String(v).slice(0, 5000);
  // текст, похожий на формулу, записываем как текст
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

// ======================================================================
//  Данные для дашборда (GET)
//  ?action=ping                                   — проверка, что всё работает
//  ?action=data&key=<TEACHER_KEY>&student=<id|all> — сессии и ошибки
// ======================================================================

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ping' || !p.action) {
    return json_({ ok: true, app: 'english-trainers', version: VERSION });
  }
  if (p.action !== 'data') return json_({ ok: false, error: 'unknown_action' });

  var teacherKey = PropertiesService.getScriptProperties().getProperty('TEACHER_KEY');
  if (!p.key || p.key !== teacherKey) return json_({ ok: false, error: 'bad_key' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var student = String(p.student || 'all').toLowerCase();
  var byStudent = function (row) { return student === 'all' || String(row.student_id).toLowerCase() === student; };

  var sessions = readSheet_(ss, 'Sessions').filter(byStudent);
  var mistakes = readSheet_(ss, 'Answers').filter(function (row) {
    return byStudent(row) && !(row.is_correct === true || String(row.is_correct).toUpperCase() === 'TRUE');
  });
  var answersTotal = readSheet_(ss, 'Answers').filter(byStudent).length;

  return json_({
    ok: true,
    version: VERSION,
    students: readSheet_(ss, 'Students'),
    pages: readSheet_(ss, 'Pages'),
    sessions: sessions,
    mistakes: mistakes,
    answers_total: answersTotal
  });
}

function readSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getDataRange().getValues();
  var headers = data.shift();
  // строка считается пустой, если пуста первая колонка (в Students там могут стоять одни флажки)
  return data.filter(function (row) { return String(row[0]) !== ''; }).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) {
      var v = row[i];
      obj[h] = v instanceof Date ? v.toISOString() : v;
    });
    return obj;
  });
}

// ======================================================================
//  Меню в таблице и помощники
// ======================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Тренажёры')
    .addItem('Настроить листы', 'setup')
    .addToUi();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function randomString_(n) {
  var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  var s = '';
  for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
