/* config.js — настройки, которые заполняет учитель.
   После каждого изменения этого файла загрузите его заново на GitHub. */
window.TRAINER_CONFIG = {
  // URL веб-приложения Google Apps Script (Развернуть → Веб-приложение → URL).
  // Пока пусто, ответы копятся в очереди на устройстве ученика и уйдут, когда URL появится.
  scriptUrl: 'https://script.google.com/macros/s/AKfycby65eRJtw6b6vdarThal-IeNwbS6m3QABur7UQNXklDOocB-rMJBMsRy4Nv-Ugz5B-L/exec',

  // Общий ключ учеников. Такой же должен стоять в Apps Script: Script Properties → STUDENT_KEY.
  // Это защита от случайных запросов, а не настоящая безопасность.
  studentKey: 'picnic-7k2m9q',

  // Ссылка на вашу Google Таблицу (для кнопки «Открыть таблицу» на дашборде).
  sheetUrl: 'https://docs.google.com/spreadsheets/d/1FkCR4a0HzjA5Hw1sVhB2F5dUMh39ac4d_XYwtpenjUY/edit'
};
