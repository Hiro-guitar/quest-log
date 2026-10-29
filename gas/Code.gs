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
    lock.waitLock(20000);
    const props = PropertiesService.getScriptProperties();
    const cal = cal_(props);
    if (req.action === 'ping') return out_({ ok: true, calendar: cal.getName() });
    if (req.action === 'pull') return out_({ ok: true, dates: pull_(cal, props) });
    if (req.action === 'load') { const d = loadData_(props); return out_({ ok: true, rev: d.rev, data: d.data }); }
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
  if (ev && ev.isAllDayEvent() !== !q.time) { ev.deleteEvent(); ev = null; }
  if (q.time) {
    const start = Utilities.parseDate(q.date + ' ' + q.time, JST, 'yyyy-MM-dd HH:mm');
    const len = ev ? (ev.getEndTime().getTime() - ev.getStartTime().getTime()) : 60 * 60000;
    const end = new Date(start.getTime() + len);
    if (ev) ev.setTime(start, end); else ev = cal.createEvent(title, start, end);
  } else {
    const day = Utilities.parseDate(q.date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (ev) ev.setAllDayDate(day); else ev = cal.createAllDayEvent(title, day);
  }
  ev.setTitle(title);
  ev.setDescription(desc_(q));
  ev.setColor(q.done ? CalendarApp.EventColor.GRAY : CalendarApp.EventColor.CYAN);
  props.setProperty('ev_' + q.id, ev.getId());
}

function remove_(cal, props, id) {
  const ev = event_(cal, props, id);
  if (ev) { try { ev.deleteEvent(); } catch (_) {} }
  props.deleteProperty('ev_' + id);
}

function pull_(cal, props) {
  const all = props.getProperties(), tz = Session.getScriptTimeZone(), out = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('ev_') !== 0) return;
    let ev = null;
    try { ev = cal.getEventById(all[k]); } catch (_) {}
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
