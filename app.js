(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const KEY = 'command-center-data-v2';
  const legacyKey = 'command-center-prototype-v1';
  const today = new Date();
  const dateKey = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const old = (() => { try { return JSON.parse(localStorage.getItem(legacyKey) || '{}'); } catch (_) { return {}; } })();
  const seedTasks = [
    ['企画書の下書き','特撮部 / 企画','today','high'], ['撮影機材の確認','EVIL CHASER / 準備','today','high'],
    ['AEのチュートリアル視聴','スキルアップ','today','medium'], ['図書館で資料を借りる','大学','today','medium'],
    ['日藝祭の広報素材確認','特撮部 / 広報','tomorrow','low']
  ].map(([title, category, day, priority], i) => ({ id: 'seed-' + i, title, category, priority, dueDate: dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + (day === 'tomorrow' ? 1 : 0))), done: Array.isArray(old.checks) && typeof old.checks[i] === 'boolean' ? old.checks[i] : false, sample: true }));
  const seedEvents = [
    ['大学 授業（映画演習）','09:00','12:00','日本大学'], ['編集作業','13:00','15:00','自宅'],
    ['特撮部 企画会議','17:00','19:00','日藝（部室）'], ['ジム / トレーニング','21:00','21:45','自宅']
  ].map(([title, start, end, location], i) => ({ id: 'event-' + i, title, date: dateKey(today), start, end, location, sample: true }));
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  let state = read() || {
    tasks: [...seedTasks, ...(Array.isArray(old.customTasks) ? old.customTasks.filter(x => x.type === 'task').map((x, i) => ({ id: 'legacy-' + i, title: x.name, category: x.group || '個人', priority: 'medium', dueDate: x.date || dateKey(today), done: !!x.done })) : [])],
    events: [...seedEvents, ...(Array.isArray(old.customTasks) ? old.customTasks.filter(x => x.type === 'event').map((x, i) => ({ id: 'legacy-event-' + i, title: x.name, date: x.date || dateKey(today), start: x.time || '09:00', end: '', location: x.group || '' })) : [])],
    theme: old.theme ? 'light' : 'dark'
  };
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { toast('保存できません。端末の空き容量を確認してください。'); } };
  const notice = $('#notice'); let noticeTimer;
  function toast(message) { notice.textContent = message; notice.classList.add('show'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice.classList.remove('show'), 2600); }
  function applyTheme() {
    const light = state.theme === 'light'; document.body.classList.toggle('light', light);
    const values = light ? {'--bg':'#edf3fb','--panel':'#fff','--text':'#132238','--muted':'#5f7188','--line':'#cbd7e5'} : null;
    ['--bg','--panel','--text','--muted','--line'].forEach(k => values ? document.body.style.setProperty(k, values[k]) : document.body.style.removeProperty(k));
  }
  function formatDate(value) {
    if (!value) return '期限なし';
    const d = new Date(value + 'T00:00:00');
    return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' });
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function updateProgress() {
    const open = state.tasks.filter(t => !t.done).length, done = state.tasks.filter(t => t.done).length;
    const total = Math.max(state.tasks.length, 1); $('#progressText').textContent = done + ' / ' + total;
    $('#progressBar').style.width = Math.round(done / total * 100) + '%';
  }
  function taskRow(t, compact = false) {
    const p = t.priority || 'medium';
    return '<div class="task-row" data-task-id="' + escapeHtml(t.id) + '"><input class="check" type="checkbox" aria-label="完了にする" ' + (t.done ? 'checked' : '') + '><div class="task-copy"><strong>' + escapeHtml(t.title) + '</strong><small>' + escapeHtml(t.category || '個人') + ' · ' + escapeHtml(formatDate(t.dueDate)) + '</small></div>' + (compact ? '' : '<span class="priority ' + (p === 'high' ? '' : p) + '">' + ({high:'高',medium:'中',low:'低'}[p] || '中') + '</span><button class="link-button edit-task" type="button" aria-label="編集">編集</button><button class="link-button delete-task" type="button" aria-label="削除">削除</button>') + '</div>';
  }
  function renderTasks() {
    const list = $('#taskTable');
    list.innerHTML = state.tasks.map(t => '<div class="task-row" data-day="' + (t.dueDate === dateKey(today) ? 'today' : t.dueDate === dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)) ? 'tomorrow' : 'later') + '" data-task-id="' + escapeHtml(t.id) + '"><input class="check" type="checkbox" aria-label="完了にする" ' + (t.done ? 'checked' : '') + '><div class="task-copy"><strong>' + escapeHtml(t.title) + '</strong><small>' + escapeHtml(t.category || '個人') + '</small></div><span class="task-time">' + escapeHtml(formatDate(t.dueDate)) + '</span><span class="priority ' + (t.priority === 'high' ? '' : (t.priority || 'medium')) + '">' + ({high:'高',medium:'中',low:'低'}[t.priority] || '中') + '</span><button class="link-button edit-task" type="button">編集</button><button class="link-button delete-task" type="button">削除</button></div>').join('') || '<p class="demo-note">タスクはありません。「＋ 追加」から作成できます。</p>';
    const todayList = $('.tasks-today');
    const rows = state.tasks.filter(t => !t.done).sort((a,b) => (a.dueDate || '').localeCompare(b.dueDate || '')).slice(0, 5);
    todayList.querySelectorAll('.task-row').forEach(n => n.remove());
    rows.forEach(t => todayList.insertAdjacentHTML('beforeend', taskRow(t, true)));
    const full = $('#fullTaskList');
    if (full) full.innerHTML = state.tasks.map(t => taskRow(t)).join('') || '<p class="demo-note">タスクはありません。</p>';
    const count = $('.tabs button[data-filter="all"]'); if (count) count.textContent = 'すべて (' + state.tasks.length + ')';
    updateProgress();
  }
  function renderEvents() {
    const root = $('#calendarEvents'); if (!root) return;
    const events = [...state.events].sort((a,b) => (a.date + a.start).localeCompare(b.date + b.start));
    root.innerHTML = events.length ? events.map(e => '<div class="event"><div class="name">' + escapeHtml(e.title) + '</div><small>' + escapeHtml(formatDate(e.date)) + (e.start ? ' · ' + escapeHtml(e.start) + (e.end ? '–' + escapeHtml(e.end) : '') : '') + (e.location ? ' · ' + escapeHtml(e.location) : '') + '</small><button class="link-button edit-event" data-event-id="' + escapeHtml(e.id) + '" type="button">編集</button> <button class="link-button delete-event" data-event-id="' + escapeHtml(e.id) + '" type="button">削除</button></div>').join('') : '<p class="demo-note">予定はありません。「＋ 予定を追加」から登録できます。</p>';
    const timeline = $('.schedule .timeline');
    if (timeline) {
      const todayEvents = events.filter(e => e.date === dateKey(today));
      timeline.innerHTML = todayEvents.length ? todayEvents.map((e, i) => '<div class="time">' + escapeHtml(e.start || '終日') + '</div><div class="event ' + (i % 3 === 1 ? 'green' : i % 3 === 2 ? 'purple' : '') + '"><div class="name">' + escapeHtml(e.title) + '</div><small>' + escapeHtml([e.end, e.location].filter(Boolean).join(' · ')) + '</small></div>').join('') : '<div class="time">—</div><div class="demo-note">今日の予定はありません。</div>';
    }
  }
  function render() { renderTasks(); renderEvents(); applyTheme(); save(); }
  function go(view) { $$('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view)); $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view)); window.scrollTo({top:0, behavior:'smooth'}); }
  $$('[data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('#todayHeading').textContent = today.getFullYear() + '年' + (today.getMonth()+1) + '月' + today.getDate() + '日（' + '日月火水木金土'[today.getDay()] + '）';
  let filter = 'all', editingId = null, modalType = 'task';
  $$('[data-filter]').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.filter; $$('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
    $$('#taskTable .task-row').forEach(row => { const task = state.tasks.find(t => t.id === row.dataset.taskId); const show = filter === 'all' || (filter === 'done' ? task?.done : !task?.done && row.dataset.day === filter); row.style.display = show ? 'flex' : 'none'; });
  }));
  function openModal(type, item = null) {
    modalType = type; editingId = item?.id || null;
    $('#modalTitle').textContent = (item ? '編集' : '追加') + (type === 'event' ? '予定' : 'タスク');
    $('#timeField').style.display = type === 'event' ? 'grid' : 'none';
    $('#itemName').value = item?.title || ''; $('#itemDate').value = item?.date || item?.dueDate || dateKey(today);
    $('#itemTime').value = item?.start || item?.time || '09:00'; $('#itemGroup').value = item?.category || item?.group || item?.location || '個人';
    $('#itemForm button[type="submit"]').textContent = item ? '変更を保存' : '追加';
    if (!$('#priorityField')) { const field = document.createElement('div'); field.id = 'priorityField'; field.className = 'field'; field.innerHTML = '<label for="itemPriority">優先度</label><select id="itemPriority"><option value="high">高</option><option value="medium" selected>中</option><option value="low">低</option></select>'; $('#timeField').after(field); }
    $('#priorityField').style.display = type === 'task' ? 'grid' : 'none'; $('#itemPriority').value = item?.priority || 'medium';
    $('#modalBackdrop').classList.add('open'); setTimeout(() => $('#itemName').focus(), 30);
  }
  $$('[data-modal]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.modal)));
  $('#cancelModal').addEventListener('click', () => $('#modalBackdrop').classList.remove('open'));
  $('#modalBackdrop').addEventListener('click', e => { if (e.target === $('#modalBackdrop')) $('#modalBackdrop').classList.remove('open'); });
  $('#itemForm').addEventListener('submit', e => {
    e.preventDefault(); const title = $('#itemName').value.trim(); if (!title) return;
    if (modalType === 'task') {
      const item = { id: editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), title, dueDate: $('#itemDate').value, category: $('#itemGroup').value, priority: $('#itemPriority').value, done: editingId ? !!state.tasks.find(t => t.id === editingId)?.done : false };
      if (editingId) state.tasks = state.tasks.map(t => t.id === editingId ? {...t, ...item} : t); else state.tasks.unshift(item);
    } else {
      const item = { id: editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), title, date: $('#itemDate').value, start: $('#itemTime').value, end: '', location: $('#itemGroup').value };
      if (editingId) state.events = state.events.map(x => x.id === editingId ? {...x, ...item} : x); else state.events.unshift(item);
    }
    $('#modalBackdrop').classList.remove('open'); render(); toast(editingId ? '変更を保存しました' : '追加しました'); editingId = null;
  });
  document.addEventListener('change', e => {
    if (!e.target.matches('.check')) return;
    const row = e.target.closest('[data-task-id]'); const task = state.tasks.find(t => t.id === row?.dataset.taskId); if (!task) return;
    task.done = e.target.checked; render(); if (filter !== 'all') $$('[data-filter="' + filter + '"]')[0]?.click();
  });
  document.addEventListener('click', e => {
    const row = e.target.closest('[data-task-id]');
    if (e.target.matches('.edit-task') && row) { const t = state.tasks.find(x => x.id === row.dataset.taskId); if (t) openModal('task', t); }
    if (e.target.matches('.delete-task') && row) { state.tasks = state.tasks.filter(t => t.id !== row.dataset.taskId); render(); toast('タスクを削除しました'); }
    const eventId = e.target.dataset.eventId;
    if (eventId && e.target.matches('.edit-event')) { const ev = state.events.find(x => x.id === eventId); if (ev) openModal('event', ev); }
    if (eventId && e.target.matches('.delete-event')) { state.events = state.events.filter(x => x.id !== eventId); render(); toast('予定を削除しました'); }
  });
  function download(name, type, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
  function exportIcs() {
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//COMMAND CENTER//JA'];
    state.events.forEach(e => { const day = (e.date || dateKey(today)).replaceAll('-', ''); const start = (e.start || '09:00').replace(':','') + '00'; const end = (e.end || e.start || '10:00').replace(':','') + '00'; lines.push('BEGIN:VEVENT','UID:' + icsEscape(e.id) + '@command-center','DTSTAMP:' + new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'').replace('Z','Z'),'DTSTART:' + day + 'T' + start,'DTEND:' + day + 'T' + end,'SUMMARY:' + icsEscape(e.title),'LOCATION:' + icsEscape(e.location),'END:VEVENT'); });
    lines.push('END:VCALENDAR'); download('command-center-calendar.ics','text/calendar;charset=utf-8',lines.join('\r\n')); toast('カレンダーを書き出しました');
  }
  $('#exportCalendar').addEventListener('click', exportIcs);
  $('#importCalendar').addEventListener('click', () => $('#icsFile').click());
  $('#icsFile').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = (await file.text()).replace(/\r?\n[ \t]/g, ''); const blocks = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
      const imported = blocks.map((block, i) => { const get = key => block.match(new RegExp('(?:^|\\n)' + key + '(?:;[^:]*)?:(.*)', 'm'))?.[1]?.replace(/\\n/g,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\'); const start = get('DTSTART') || ''; const date = start.slice(0,10).replaceAll('-',''); const parsedDate = date.length === 8 ? date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8) : dateKey(today); const time = start.match(/T(\d{2})(\d{2})/)?.slice(1).join(':') || '09:00'; return {id:'ics-'+Date.now()+'-'+i,title:get('SUMMARY') || '予定',date:parsedDate,start:time,end:'',location:get('LOCATION') || ''}; });
      state.events.push(...imported); render(); toast(imported.length + '件の予定を読み込みました');
    } catch (_) { toast('このICSファイルを読み込めませんでした'); } e.target.value = '';
  });
  $('#exportData').addEventListener('click', () => { download('command-center-backup.json','application/json',JSON.stringify({version:2,exportedAt:new Date().toISOString(),tasks:state.tasks,events:state.events,theme:state.theme},null,2)); toast('バックアップを書き出しました'); });
  $('#importData').addEventListener('click', () => $('#jsonFile').click());
  $('#jsonFile').addEventListener('change', async e => { const file = e.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); if (!Array.isArray(data.tasks) || !Array.isArray(data.events)) throw new Error(); state = {tasks:data.tasks,events:data.events,theme:data.theme === 'light' ? 'light' : 'dark'}; render(); toast('バックアップを読み込みました'); } catch (_) { toast('バックアップ形式を確認してください'); } e.target.value = ''; });
  function toggleTheme() { state.theme = state.theme === 'light' ? 'dark' : 'light'; render(); toast(state.theme === 'light' ? '明るい表示に切り替えました' : 'ダーク表示に戻しました'); }
  $('#themeBtn').addEventListener('click', toggleTheme); $('#themeToggle2').addEventListener('click', toggleTheme);
  $('#notifBtn').addEventListener('click', () => toast('通知機能は未実装です。現在はこの端末にデータを保存しています。'));
  $$('[data-action="connection"]').forEach(b => b.addEventListener('click', () => go('connections')));
  $$('[data-action="notification"]').forEach(b => b.addEventListener('click', () => toast('通知は今後の拡張項目です。')));
  $('#todayHeading').textContent = today.getFullYear() + '年' + (today.getMonth()+1) + '月' + today.getDate() + '日（' + '日月火水木金土'[today.getDay()] + '）';
  render();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
