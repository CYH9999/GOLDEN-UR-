/* ============================================================
   بيئة تشغيل مصغّرة تحمّل دوال index.html الحقيقية داخل Node.
   ما تنسخ أي كود من الإنتاج: تقرأ <script> من الملف نفسها وتشغّله
   فوق DOM مزيّف، فأي تعديل بالبرنامج ينعكس على الاختبار فوراً.
   ملف اختبار فقط — الإنتاج لا يعرف بوجوده ولا يعتمد عليه.
   ============================================================ */
"use strict";
const fs = require("fs");

function makeEnv(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const a = html.indexOf("<script>"), b = html.lastIndexOf("</script>");
  if (a < 0 || b < 0) throw new Error("ما لكيت وسم <script> داخل " + htmlPath);
  const src = html.slice(a + 8, b);

  const nodes = new Map();
  const alerts = [], confirms = [];
  let confirmAnswer = () => true;

  function mkClassList(set) {
    return {
      add(c) { set.add(c); },
      remove(c) { set.delete(c); },
      toggle(c, on) { if (on === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else { on ? set.add(c) : set.delete(c); } },
      contains(c) { return set.has(c); }
    };
  }
  function mkNode(id) {
    const cls = new Set(["hidden"]);          // كل الأقسام مخفية بالافتراض
    const handlers = {};
    const n = {
      id, value: "", textContent: "", innerHTML: "", disabled: false,
      checked: false, files: [], style: {}, dataset: {},
      classList: mkClassList(cls), _cls: cls, _handlers: handlers,
      addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
      removeEventListener() {},
      setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
      focus() {}, select() {}, click() {}, scrollIntoView() {},
      appendChild() {}, remove() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      closest() { return null; },
      getContext() { return null; },
      toDataURL() { return ""; }, toBlob() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    };
    return n;
  }
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, mkNode(id));
    return nodes.get(id);
  }

  const store = new Map();
  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); }
  };

  const document = {
    getElementById: (id) => node(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => mkNode("_tmp"),
    addEventListener: () => {},
    documentElement: { style: { setProperty() {} } },
    body: { appendChild() {}, removeChild() {} },
    visibilityState: "visible"
  };
  const windowObj = { addEventListener() {}, open() { return null; } };

  const sandbox = {
    document, window: windowObj, localStorage,
    alert: (m) => { alerts.push(String(m)); },
    confirm: (m) => { confirms.push(String(m)); return confirmAnswer(String(m)); },
    prompt: () => null,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    Image: function () { this.onload = null; this.width = 0; this.height = 0; },
    Blob: function () {}, URL: { createObjectURL: () => "" },
    BroadcastChannel: function () { throw new Error("no bc in test env"); },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    TextEncoder, setTimeout, clearTimeout, console,
    Intl, Date, Math, JSON, Number, String, Object, Array, Map, Set,
    isFinite, parseInt, parseFloat, Promise, Error, RegExp, Uint8Array,
    Uint32Array, DataView, ArrayBuffer, Buffer
  };

  const exportNames = [
    "C","S","state","curDate","buildReport","totalsOf","migrate","ensureFields",
    "blankCompany","newWorker","setWorkerStatus","applyWorkerStatus","openStatusModal",
    "getWorkerStatus","statusBadge","serviceStart","serviceEnd","inService","compute",
    "dayRec","stateOf","roundDinar","roundNet","netUnit","dailyRateFor","dayDeductFor",
    "penaltyAmount","achAmount","overlappingLeave","requireInService","reviseRecord",
    "missedDaysIn","payMonthOf","calDays","isTimedLeaveType","policyOfLeave","leaveAt",
    "defaultLeavePolicy","el","uid","todayISO","monthOf","fmtMoney","fmtNum",
    "runReport","renderReport","renderTally","refresh","workerRecordCounts",
    "recordedDays","workdaysBetween","serviceDaysIn","excusedTally","RP",
    "addDays","parseISO","isHoliday","leaveEnd","salaryFor",
    "WS_ACTIVE","WS_END","WS_CUT","WS_FIRE","WS_MOVED","WSTATUSES","WS_VARIABLE",
    "lvEditId","pnEditId","acEditId","mtEditId","nextLeaveNo","nextPenaltyNo"
  ];
  /* كل اسم يُصدَّر بـ getter داخل try: البناء القديم ما عنده الدوال
     الجديدة، والقارئ يحصل undefined بدل ReferenceError يكسر التحميل. */
  const props = exportNames.map(n =>
    `get ${n}(){ try{ return ${n}; }catch(e){ return undefined; } },\n    ` +
    `set ${n}(v){ try{ ${n}=v; }catch(e){} }`
  ).join(",\n    ");

  const tail = `\n;return {\n    ${props}\n  };\n`;
  const keys = Object.keys(sandbox);
  const fn = new Function(...keys, src + tail);
  const api = fn(...keys.map(k => sandbox[k]));

  return {
    api, node, nodes, alerts, confirms,
    setConfirm(fn2) { confirmAnswer = fn2; },
    clear() { alerts.length = 0; confirms.length = 0; },
    /* إطلاق مستمع مسجّل بـ addEventListener مع هدف مزيّف */
    fire(id, type, sel, data) {
      const n = node(id);
      const target = {
        closest(q) { return q === sel ? { dataset: data } : null; }
      };
      (n._handlers[type] || []).forEach(h => h({ target }));
    }
  };
}
module.exports = { makeEnv };
