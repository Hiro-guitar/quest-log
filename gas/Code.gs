// =====================================================
// クエストログ × Googleカレンダー 連携スクリプト
// 「やる日」を入れたチャレンジを「クエストログ」カレンダーに書き込みます。
// TOKEN は自分だけの合言葉に書き換えて使ってください（このファイルを公開しないこと）。
// =====================================================
const TOKEN = 'ここに合言葉を貼る';
const CAL_NAME = 'クエストログ';
const JST = 'Asia/Tokyo';

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.token !== TOKEN) return out_({ ok: false, error: '合言葉が違います' });
    const props = PropertiesService.getScriptProperties();
    // 読むだけの処理は順番待ちしない
    if (req.action === 'load') { const d = loadData_(props); return out_({ ok: true, rev: d.rev, data: d.data }); }
    if (req.action === 'backups') return out_({ ok: true, list: listBackups_(props) });
    if (req.action === 'restore') return out_({ ok: true, data: readBackup_(props, req.id) });
    if (req.action === 'backupnow') { dailyBackup(); return out_({ ok: true }); }
    const cal = cal_(props);
    if (req.action === 'ping') return out_({ ok: true, calendar: cal.getName() });
    if (req.action === 'pull') return out_({ ok: true, dates: pull_(cal, props) });
    lock.waitLock(25000);
    if (req.action === 'save') {
      const d = loadData_(props);
      if (d.rev > 0 && (req.baseRev || 0) !== d.rev) return out_({ ok: true, conflict: true, rev: d.rev, data: d.data });
      return out_({ ok: true, rev: saveData_(props, req.data) });
    }
    if (req.action === 'sync') {
      (req.upserts || []).forEach(function (q) { upsert_(cal, props, q); });
      (req.deletes || []).forEach(function (id) { remove_(cal, props, id); });
      return out_({ ok: true });
    }
    return out_({ ok: false, error: '不明な操作です' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// 初回の権限許可用（エディタで一度だけ実行）
function setup() {
  const cal = cal_(PropertiesService.getScriptProperties());
  Logger.log('準備OK：' + cal.getName());
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function cal_(props) {
  const id = props.getProperty('CAL_ID');
  let cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) {
    cal = CalendarApp.createCalendar(CAL_NAME, { timeZone: JST, summary: 'クエストログのチャレンジ（やる日）' });
    props.setProperty('CAL_ID', cal.getId());
  }
  return cal;
}

function event_(cal, props, id) {
  const evId = props.getProperty('ev_' + id);
  if (!evId) return null;
  try { return cal.getEventById(evId); } catch (_) { return null; }
}

function upsert_(cal, props, q) {
  const title = (q.done ? '✓ ' : '◇ ') + q.title;
  let ev = event_(cal, props, q.id);
  const oldLen = ev && !ev.isAllDayEvent() ? (ev.getEndTime().getTime() - ev.getStartTime().getTime()) : null;
  if (ev && ev.isAllDayEvent() !== !q.time) { ev.deleteEvent(); ev = null; }
  // 未達成はカレンダー本来の色に戻す（個別の色は作り直さないと消せないため）
  if (ev && !q.done && ev.getColor()) { ev.deleteEvent(); ev = null; }
  if (q.time) {
    const start = Utilities.parseDate(q.date + ' ' + q.time, JST, 'yyyy-MM-dd HH:mm');
    const len = ev ? (ev.getEndTime().getTime() - ev.getStartTime().getTime()) : (oldLen || 60 * 60000);
    const end = new Date(start.getTime() + len);
    if (ev) ev.setTime(start, end); else ev = cal.createEvent(title, start, end);
  } else {
    const day = Utilities.parseDate(q.date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (ev) ev.setAllDayDate(day); else ev = cal.createAllDayEvent(title, day);
  }
  ev.setTitle(title);
  ev.setDescription(desc_(q));
  if (q.done) ev.setColor(CalendarApp.EventColor.GRAY);
  props.setProperty('ev_' + q.id, ev.getId());
}

function remove_(cal, props, id) {
  const ev = event_(cal, props, id);
  if (ev) { try { ev.deleteEvent(); } catch (_) {} }
  props.deleteProperty('ev_' + id);
}

function pull_(cal, props) {
  const all = props.getProperties(), tz = Session.getScriptTimeZone(), out = {};
  // 予定を1回でまとめて取得（1件ずつ探すより速い）
  const now = new Date(), from = new Date(now.getTime() - 400 * 86400000), to = new Date(now.getTime() + 1100 * 86400000);
  const byId = {};
  cal.getEvents(from, to).forEach(function (ev) { byId[ev.getId()] = ev; });
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('ev_') !== 0) return;
    const ev = byId[all[k]];
    if (!ev) return;
    out[k.slice(3)] = ev.isAllDayEvent()
      ? { date: Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd'), time: '' }
      : { date: Utilities.formatDate(ev.getStartTime(), JST, 'yyyy-MM-dd'), time: Utilities.formatDate(ev.getStartTime(), JST, 'HH:mm') };
  });
  return out;
}

function desc_(q) {
  const lines = [];
  if (q.main) lines.push('◆ ' + q.main + ' のためのチャレンジ');
  if (q.memo) lines.push('', q.memo);
  if (q.steps && q.steps.length) {
    lines.push('', '【工程】');
    q.steps.forEach(function (s) { lines.push((s.d ? '☑ ' : '☐ ') + s.t); });
  }
  lines.push('', 'クエストログで開く：' + q.link);
  return lines.join('\n');
}

// ---- PCとスマホで共有するデータの保管（スクリプトのプロパティに分割して保存） ----
function loadData_(props) {
  const n = +(props.getProperty('data_n') || 0);
  let str = '';
  for (let i = 0; i < n; i++) str += props.getProperty('data_' + i) || '';
  return { rev: +(props.getProperty('data_rev') || 0), data: str ? JSON.parse(str) : null };
}

function saveData_(props, data) {
  const str = JSON.stringify(data), size = 2800, n = Math.ceil(str.length / size), obj = {};
  for (let i = 0; i < n; i++) obj['data_' + i] = str.slice(i * size, (i + 1) * size);
  const old = +(props.getProperty('data_n') || 0);
  for (let i = n; i < old; i++) props.deleteProperty('data_' + i);
  const rev = +(props.getProperty('data_rev') || 0) + 1;
  obj.data_n = String(n); obj.data_rev = String(rev);
  props.setProperties(obj);
  return rev;
}

// ---- 毎日のバックアップ（Googleドライブの「クエストログのバックアップ」フォルダに30日分） ----
function dailyBackup() {
  const props = PropertiesService.getScriptProperties();
  const d = loadData_(props);
  if (!d.data) return;
  const folder = backupFolder_(props);
  const name = 'questlog-' + Utilities.formatDate(new Date(), JST, 'yyyy-MM-dd') + '.json';
  const body = JSON.stringify(d.data);
  const same = folder.getFilesByName(name);
  if (same.hasNext()) same.next().setContent(body); else folder.createFile(name, body, 'application/json');
  const limit = Date.now() - 31 * 86400000, all = folder.getFiles();
  while (all.hasNext()) { const f = all.next(); if (f.getDateCreated().getTime() < limit) f.setTrashed(true); }
}

function backupFolder_(props) {
  const id = props.getProperty('BK_FOLDER');
  let f = null;
  if (id) { try { f = DriveApp.getFolderById(id); if (f.isTrashed()) f = null; } catch (_) { f = null; } }
  if (!f) { f = DriveApp.createFolder('クエストログのバックアップ'); props.setProperty('BK_FOLDER', f.getId()); }
  return f;
}

function listBackups_(props) {
  const out = [], it = backupFolder_(props).getFiles();
  while (it.hasNext()) { const f = it.next(); out.push({ id: f.getId(), name: f.getName(), at: f.getLastUpdated().getTime() }); }
  out.sort(function (a, b) { return b.name < a.name ? -1 : 1; });
  return out;
}

function readBackup_(props, id) {
  const folder = backupFolder_(props), f = DriveApp.getFileById(id);
  const parents = f.getParents();
  let ok = false;
  while (parents.hasNext()) { if (parents.next().getId() === folder.getId()) ok = true; }
  if (!ok) throw new Error('バックアップのファイルではありません');
  return JSON.parse(f.getBlob().getDataAsString());
}

// 初回だけエディタで実行：毎日3時のバックアップ設定＋1回目のバックアップ
function setupBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(3).inTimezone(JST).create();
  dailyBackup();
  Logger.log('バックアップ準備OK：毎日3時に保存します');
}
