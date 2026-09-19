/* ============================================================
   سيناريوهات التحقق — تشغّل دوال index.html الحقيقية فعلاً.
   node tests/verify.js
   ملف اختبار مؤقت؛ الإنتاج لا يعتمد عليه إطلاقاً.
   ============================================================ */
"use strict";
const path = require("path");
const { makeEnv } = require("./harness.js");
const APP = path.join(__dirname, "..", "index.html");
const OLD = process.env.OLD_HTML || "";

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, detail) {
  if (cond) { pass++; lines.push("  ✅ " + name + (detail ? "  — " + detail : "")); }
  else { fail++; lines.push("  ❌ " + name + (detail ? "  — " + detail : "")); }
}
function head(t) { lines.push("\n" + t); }

/* ---------- تهيئة شركة اختبار موحّدة ---------- */
function setup(env) {
  const api = env.api;
  const c = api.blankCompany("شركة الاختبار");
  api.state = { v: 2, companies: [c], active: c.id };
  const S = c.settings;
  S.numerals = "latn";          // أرقام لاتينية حتى تسهل المطابقة النصية
  S.salary = 335000;
  S.dedMode = "auto";
  S.workDays = 30;
  S.netRound = 250;
  S.proRate = "yes";
  S.leavePolicy = "none";
  S.weekendDays = [5];          // الجمعة راحة
  S.holidays = [];
  return c;
}
function addWorker(env, c, name, extra) {
  const w = env.api.newWorker({ name: name, createdAt: "2026-01-01" });
  Object.assign(w, extra || {});
  c.workers.push(w);
  return w;
}
/* اعتماد كل أيام الشهر */
function confirmMonth(env, c, ym) {
  const api = env.api;
  const r = api.monthOf(ym + "-01");
  let d = r[0];
  while (d <= r[1]) { c.days[d] = { states: {}, notes: "", confirmed: true }; d = api.addDays(d, 1); }
  return r;
}
function rowOf(rep, name) { return rep.rows.filter(r => r.name === name)[0] || null; }

/* ================= ١ — عامل مستمر، أيلول كامل ================= */
head("السيناريو ١ — عامل مستمر، أيلول ٢٠٢٦ كامل، بلا غياب");
{
  const E = makeEnv(APP), c = setup(E);
  addWorker(E, c, "أحمد");
  confirmMonth(E, c, "2026-09");
  const rep = E.api.buildReport("2026-09-01", "2026-09-30");
  const r = rowOf(rep, "أحمد");
  ok("الأيام الفائتة = ٠", r.missedDays === 0, "missedDaysIn");
  ok("الراتب المستحق ٣٣٥٬٠٠٠", r.salary === 335000, "buildReport → gross");
  ok("الصافي ٣٣٥٬٠٠٠", r.net === 335000, "roundNet");
  ok("المجموع = الصف", rep.tot.net === 335000, "totalsOf");
}

/* ================= ٢ — يومان غياب ================= */
head("السيناريو ٢ — نفس العامل مع يومين غياب");
{
  const E = makeEnv(APP), c = setup(E);
  const w = addWorker(E, c, "أحمد");
  confirmMonth(E, c, "2026-09");
  c.days["2026-09-07"].states[w.id] = "absent";   // إثنين
  c.days["2026-09-08"].states[w.id] = "absent";   // ثلاثاء
  const rep = E.api.buildReport("2026-09-01", "2026-09-30");
  const r = rowOf(rep, "أحمد");
  ok("عدد الغياب = ٢", r.absent === 2, "buildReport → days loop");
  ok("استقطاع الغياب ٢٢٬٣٣٣", r.absDeduction === 22333, "roundDinar(2 × dayDeductFor)");
  ok("الصافي قبل التقريب ٣١٢٬٦٦٧", r.netExact === 312667, "gross − deduction");
  ok("الصافي بعد التقريب ٣١٢٬٧٥٠", r.net === 312750, "roundNet (وحدة ٢٥٠)");
}

/* ================= ٣ — عامل بلا تاريخ مباشرة ================= */
head("السيناريو ٣ — عامل بلا تاريخ مباشرة أُضيف للنظام ١٥ أيلول");
{
  const E = makeEnv(APP), c = setup(E);
  const w = addWorker(E, c, "علي", { createdAt: "2026-09-15", startDate: "" });
  confirmMonth(E, c, "2026-09");
  const rep = E.api.buildReport("2026-09-01", "2026-09-30");
  const r = rowOf(rep, "علي");
  ok("serviceStart فارغ (ما يرجع لـ createdAt)", E.api.serviceStart(w) === "", "serviceStart");
  ok("الأيام الفائتة = ٠", r.missedDays === 0, "missedDaysIn");
  ok("راتب كامل ٣٣٥٬٠٠٠ لا نسبي", r.salary === 335000 && r.net === 335000, "buildReport");
}

/* ================= ٤ — مباشرة ٢ شباط (شهر ٢٨ يوم) ================= */
head("السيناريو ٤ — عامل باشر ٢ شباط ٢٠٢٦");
{
  const E = makeEnv(APP), c = setup(E);
  addWorker(E, c, "حسين", { startDate: "2026-02-02" });
  confirmMonth(E, c, "2026-02");
  const rep = E.api.buildReport("2026-02-01", "2026-02-28");
  const r = rowOf(rep, "حسين");
  ok("أيام الشهر = ٢٨", r.monthDays === 28, "calDays");
  ok("يوم فائت واحد", r.missedDays === 1, "missedDaysIn");
  ok("الراتب المستحق ٣٢٣٬٨٣٣", r.salary === 323833, "الكامل − أجر اليوم × ١");
  ok("الصافي بعد التقريب ٣٢٣٬٧٥٠", r.net === 323750, "roundNet");
}

/* ================= ٥ — «منقول» بتاريخ ١٥ أيلول ================= */
head("السيناريو ٥ — «منقول» بتاريخ ١٥ أيلول عبر النافذة الموحّدة");
{
  const E = makeEnv(APP), c = setup(E);
  const w = addWorker(E, c, "كرار");
  confirmMonth(E, c, "2026-09");
  E.api.curDate = "2026-09-15";
  // عبر النافذة الموحّدة تماماً كما يفعل المستخدم
  E.api.openStatusModal(w.id);
  E.node("stSelect").value = E.api.WS_MOVED;
  E.node("stDate").value = "2026-09-15";
  E.node("stNote").value = "نُقل لشركة أخرى";
  E.node("stSave").onclick();

  ok("الحالة «منقول»", E.api.getWorkerStatus(w) === "منقول", "setWorkerStatus عبر النافذة");
  ok("تاريخ السريان محفوظ", w.statusChangedAt === "2026-09-15", "statusChangedAt");
  ok("سجل الحالات فيه قيد", (w.statusHistory || []).length === 1 &&
     w.statusHistory[0].to === "منقول", "statusHistory");
  ok("نهاية الخدمة = ١٥ أيلول", E.api.serviceEnd(w) === "2026-09-15", "serviceEnd");
  ok("يظهر بالجرد يوم ١٥", E.api.inService(w, "2026-09-15") === true, "inService");
  ok("يختفي من الجرد يوم ١٦", E.api.inService(w, "2026-09-16") === false, "inService");

  const rep = E.api.buildReport("2026-09-01", "2026-09-30");
  const r = rowOf(rep, "كرار");
  ok("١٥ يوم فائت", r.missedDays === 15, "missedDaysIn");
  ok("الراتب ١٦٧٬٥٠٠", r.salary === 167500, "الكامل − أجر اليوم × ١٥");
  ok("الصافي ١٦٧٬٥٠٠", r.net === 167500, "roundNet");
  ok("حالته بالكشف «منقول»", r.status === "منقول", "buildReport → row.status");
  // الشارة الموحّدة تخرج من دالة واحدة يستعملها كل تبويب
  ok("الشارة الموحّدة تقول «منقول»", E.api.statusBadge(w).indexOf("منقول") >= 0, "statusBadge");
}

/* ================= ٦ — قرار إنهاء خدمة ثم حذفه ================= */
head("السيناريو ٦ — قرار إنهاء خدمة ثم حذفه");
{
  const E = makeEnv(APP), c = setup(E);
  const w = addWorker(E, c, "عباس");
  confirmMonth(E, c, "2026-09");
  E.api.curDate = "2026-09-10";
  E.setConfirm(() => true);

  E.node("pnWorker").value = w.id;
  E.node("pnType").value = "إنهاء الخدمات";
  E.node("pnKind").value = "none";
  E.node("pnAmount").value = "0";
  E.node("pnDate").value = "2026-09-10";
  E.node("pnNo").value = "";
  E.node("pnSave").onclick();

  ok("انحفظ قرار واحد", c.penalties.length === 1, "pnSave");
  ok("الحالة صارت «إنهاء خدمات»", E.api.getWorkerStatus(w) === "إنهاء خدمات", "setWorkerStatus");
  ok("القرار خزّن الحالة السابقة", c.penalties[0].prevStatus === "مستمر", "prevStatus");
  const repEnd = E.api.buildReport("2026-09-01", "2026-09-30");
  ok("راتبه صار نسبياً قبل الحذف", rowOf(repEnd, "عباس").salary === 111667,
     "الكامل − أجر اليوم × ٢٠");

  // الحذف من نفس زر السجل
  E.fire("penaltiesList", "click", "[data-pdel]", { pdel: c.penalties[0].id });

  ok("انحذف القرار", c.penalties.length === 0, "penaltiesList → data-pdel");
  ok("رجع «مستمر»", E.api.getWorkerStatus(w) === "مستمر", "undoTermination");
  ok("ما بقى تاريخ نهاية", E.api.serviceEnd(w) === "", "serviceEnd");
  ok("رجع للجرد", E.api.inService(w, "2026-09-30") === true, "inService");
  const rep = E.api.buildReport("2026-09-01", "2026-09-30");
  ok("راتبه كامل ٣٣٥٬٠٠٠", rowOf(rep, "عباس").net === 335000, "buildReport");
}

/* ================= ٧ — تعديل عقوبة محفوظة ================= */
head("السيناريو ٧ — فتح عقوبة محفوظة (٢٥٬٠٠٠) وتعديلها إلى ٣٠٬٠٠٠");
{
  const E = makeEnv(APP), c = setup(E);
  const w = addWorker(E, c, "مهند");
  confirmMonth(E, c, "2026-09");
  E.api.curDate = "2026-09-10";
  E.setConfirm(() => true);

  E.node("pnWorker").value = w.id;
  E.node("pnType").value = "استقطاع من الراتب";
  E.node("pnKind").value = "amount";
  E.node("pnAmount").value = "25000";
  E.node("pnDate").value = "2026-09-10";
  E.node("pnNo").value = "";
  E.node("pnSave").onclick();
  const firstNo = c.penalties[0].no, firstId = c.penalties[0].id;
  ok("انحفظت عقوبة واحدة", c.penalties.length === 1, "pnSave");

  // «عرض» من السجل ثم تعديل المبلغ ثم «حفظ التعديل»
  E.node("pnNew").onclick();                       // تصفير التتبّع أولاً
  E.fire("penaltiesList", "click", "[data-popen]", { popen: firstId });
  ok("زر الحفظ صار «حفظ التعديل»", E.node("pnSave").textContent === "حفظ التعديل", "pnSyncSave");
  E.node("pnAmount").value = "30000";
  E.node("pnSave").onclick();

  ok("عدد العقوبات ما تغيّر", c.penalties.length === 1, "reviseRecord");
  ok("الرقم نفسه", c.penalties[0].no === firstNo, "no ثابت");
  ok("المبلغ ٣٠٬٠٠٠", c.penalties[0].amount === 30000, "reviseRecord");
  ok("النسخة السابقة محفوظة", (c.penalties[0].revisions || []).length === 1 &&
     c.penalties[0].revisions[0].amount === 25000, "rec.revisions");
  ok("تاريخ التعديل مسجّل", !!c.penalties[0].editedAt, "rec.editedAt");

  const rep = E.api.buildReport("2026-09-01", "2026-09-30");
  const r = rowOf(rep, "مهند");
  ok("الاستقطاع ٣٠٬٠٠٠ لا ٥٥٬٠٠٠", r.penDed === 30000, "penaltyAmount");
  ok("عدد الإشعارات ١", r.penCount === 1, "buildReport");
}

/* ================= ٨ — إجازة زمنية ساعتين ================= */
head("السيناريو ٨ — إجازة زمنية ساعتين");
{
  const E = makeEnv(APP), c = setup(E);
  const w = addWorker(E, c, "سيف");
  confirmMonth(E, c, "2026-09");
  E.api.curDate = "2026-09-10";
  E.setConfirm(() => true);

  E.node("lvWorker").value = w.id;
  E.node("lvType").value = "زمنية";
  E.node("lvFrom").value = "2026-09-10";
  E.node("lvDays").value = "2";              // ساعتان
  E.node("lvPolicy").value = "half";         // نحاول نفرض استقطاعاً
  E.node("lvNo").value = "";
  E.node("lvSave").onclick();

  ok("انحفظت الإجازة", c.leaves.length === 1, "lvSave");
  ok("تُخزَّن بالساعات", c.leaves[0].hours === 2, "lvHoursCount");
  ok("سياستها مقفلة على none", c.leaves[0].policy === "none", "lvIsTimed → policy");
  ok("policyOfLeave تقول none", E.api.policyOfLeave(c.leaves[0], w) === "none", "policyOfLeave");
  ok("ليست إجازة يوم كامل", E.api.leaveAt(w.id, "2026-09-10") === null, "leaveAt");

  const rep = E.api.buildReport("2026-09-01", "2026-09-30");
  const r = rowOf(rep, "سيف");
  ok("ما انعدّت يوم إجازة", r.leave === 0, "buildReport → leaveAtIn");
  ok("ساعات زمنية = ٢", r.timedHours === 2, "timedHoursIn");
  ok("استقطاع صفر", r.absDeduction === 0 && r.deduction === 0, "excusedDed");
  ok("الصافي كامل ٣٣٥٬٠٠٠", r.net === 335000, "buildReport");
}

/* ================= ٩ — إجازة متداخلة ================= */
head("السيناريو ٩ — إجازة ثانية تتداخل مع الأولى");
{
  const E = makeEnv(APP), c = setup(E);
  const w = addWorker(E, c, "زيد");
  confirmMonth(E, c, "2026-09");
  E.api.curDate = "2026-09-01";
  E.setConfirm(() => true);

  E.node("lvWorker").value = w.id;
  E.node("lvType").value = "اعتيادية";
  E.node("lvFrom").value = "2026-09-05";
  E.node("lvDays").value = "5";              // ٥ → ٩ أيلول
  E.node("lvNo").value = "";
  E.node("lvSave").onclick();
  ok("انحفظت الأولى", c.leaves.length === 1, "lvSave");

  E.node("lvNew").onclick();
  E.clear();
  E.node("lvWorker").value = w.id;
  E.node("lvFrom").value = "2026-09-08";     // يتداخل مع ٥–٩
  E.node("lvDays").value = "3";
  E.node("lvSave").onclick();

  ok("الحفظ مرفوض", c.leaves.length === 1, "overlappingLeave");
  ok("الرسالة تذكر رقم الوصل المتداخل",
     E.alerts.length === 1 && E.alerts[0].indexOf(c.leaves[0].no) >= 0,
     E.alerts[0] ? E.alerts[0].split("\n")[0] : "ماكو رسالة");

  // إجازة غير متداخلة تنحفظ عادي
  E.node("lvNew").onclick();
  E.node("lvWorker").value = w.id;
  E.node("lvFrom").value = "2026-09-20";
  E.node("lvDays").value = "2";
  E.node("lvSave").onclick();
  ok("غير المتداخلة تنحفظ", c.leaves.length === 2, "overlappingLeave");
}

/* ================= ١٠ — كشف من ١ آب إلى ٣٠ أيلول ================= */
head("السيناريو ١٠ — كشف من ١ آب إلى ٣٠ أيلول");
{
  const E = makeEnv(APP), c = setup(E);
  addWorker(E, c, "وسام");
  confirmMonth(E, c, "2026-08");
  confirmMonth(E, c, "2026-09");
  const rep = E.api.buildReport("2026-08-01", "2026-09-30");
  ok("payMonthOf ترفض المدى", E.api.payMonthOf("2026-08-01", "2026-09-30") === null, "payMonthOf");
  ok("الكشف معلّم crossMonth", rep.crossMonth === true, "buildReport");
  ok("كل المبالغ مصفّرة", rep.rows.every(r => r.salary === 0 && r.net === 0 && r.deduction === 0),
     "buildReport → تصفير");
  ok("الحضور لا يزال معروضاً", rep.rows.length === 1 && rep.rows[0].eligible > 0, "عرض الحضور مسموح");
  // المدى داخل شهر واحد يشتغل
  const good = E.api.buildReport("2026-09-01", "2026-09-30");
  ok("مدى داخل شهر واحد ينحسب", good.crossMonth === false && good.rows[0].net === 335000, "payMonthOf");
  // مدى أقصر من الشهر: الأيام خارجه تُعدّ فائتة
  const part = E.api.buildReport("2026-09-01", "2026-09-15");
  ok("مدى أقصر من الشهر → ١٥ يوم فائت", part.rows[0].missedDays === 15, "missedDaysIn");
}

/* ================= ١١ — ترحيل endDate ================= */
head("السيناريو ١١ — بيانات قديمة: «مستمر» عنده endDate = ١٠ أيلول");
{
  const E = makeEnv(APP);
  const c = setup(E);
  const w = addWorker(E, c, "ياسر");
  confirmMonth(E, c, "2026-09");
  // نبني نسخة خام تشبه بيانات v3.4 المحفوظة
  w.endDate = "2026-09-10";
  w.status = "مستمر";
  w.statusChangedAt = "";
  delete c.payV4;
  const raw = JSON.stringify(E.api.state);

  const N = makeEnv(APP);
  N.api.state = N.api.migrate(JSON.parse(raw));
  const nw = N.api.C().workers[0];
  ok("صار «إنهاء خدمات»", N.api.getWorkerStatus(nw) === "إنهاء خدمات", "ensureFields → payV4");
  ok("بتاريخ ١٠ أيلول", nw.statusChangedAt === "2026-09-10", "payV4");
  ok("ملاحظة الترحيل مكتوبة", nw.statusNote === "مرحَّل من تاريخ الانتهاء القديم", "payV4");
  ok("حقل endDate انحذف", !("endDate" in nw), "delete w.endDate");
  ok("علم الترحيل مرفوع", N.api.C().payV4 === true, "c.payV4");

  // الترحيل مرتين لا يغيّر شيئاً
  const once = JSON.stringify(N.api.state);
  N.api.state = N.api.migrate(JSON.parse(once));
  ok("تكرار الترحيل لا يغيّر شيئاً", JSON.stringify(N.api.state) === once, "idempotent");

  const nrep = N.api.buildReport("2026-09-01", "2026-09-30");
  const nr = nrep.rows[0];
  if (OLD) {
    const O = makeEnv(OLD);
    O.api.state = O.api.migrate(JSON.parse(raw));
    const ow = O.api.C().workers[0];
    const orep = O.api.buildReport("2026-09-01", "2026-09-30");
    const or = orep.rows[0];
    ok("الراتب كما كان قبل الترحيل",
       Math.round(or.salary) === nr.salary, "قديم " + Math.round(or.salary) + " · جديد " + nr.salary);
    let same = true;
    for (let d = "2026-09-01"; d <= "2026-09-30"; d = O.api.addDays(d, 1))
      if (O.api.inService(ow, d) !== N.api.inService(nw, d)) same = false;
    ok("الجرد كما كان قبل الترحيل (٣٠ يوم)", same, "inService");
  } else {
    ok("الراتب ١١١٬٦٦٧ (١٠ أيام خدمة)", nr.salary === 111667, "buildReport");
  }
  ok("يظهر بالجرد ١٠ أيلول", N.api.inService(nw, "2026-09-10") === true, "inService");
  ok("يختفي ١١ أيلول", N.api.inService(nw, "2026-09-11") === false, "inService");

  // غير مستمر بلا تاريخ: يأخذ تاريخاً مرة واحدة ويُخزَّن
  const E2 = makeEnv(APP), c2 = setup(E2);
  const w2 = addWorker(E2, c2, "بلا تاريخ", { status: "مفصول", statusChangedAt: "" });
  delete c2.payV4;
  const raw2 = JSON.stringify(E2.api.state);
  const M = makeEnv(APP);
  M.api.state = M.api.migrate(JSON.parse(raw2));
  const mw = M.api.C().workers[0];
  ok("غير المستمر بلا تاريخ أخذ تاريخ اليوم وخُزِّن",
     mw.statusChangedAt === M.api.todayISO(), "payV4 → تثبيت التاريخ");
}

/* ================= ١٢ — البحث بكشف الرواتب ================= */
head("السيناريو ١٢ — البحث بكشف الرواتب عن اسم واحد");
{
  const E = makeEnv(APP), c = setup(E);
  const a = addWorker(E, c, "أحمد");
  addWorker(E, c, "علي");
  addWorker(E, c, "حسن");
  confirmMonth(E, c, "2026-09");
  c.days["2026-09-07"].states[a.id] = "absent";

  E.node("rpFrom").value = "2026-09-01";
  E.node("rpTo").value = "2026-09-30";
  E.node("rpSearch").value = "";
  E.api.runReport();
  const all = E.api.RP.tot.net;
  ok("مجموع الكل = ٣ عمال", all === 335000 * 2 + 323750, "totalsOf · " + all);

  E.node("rpSearch").value = "أحمد";
  E.api.renderReport();
  const html = E.node("rpTable").innerHTML;
  const foot = html.slice(html.indexOf("<tfoot>"));
  const cells = foot.replace(/<[^>]+>/g, "|").split("|").filter(s => s.trim());
  ok("سطر المجموع يقول «مجموع نتائج البحث»", foot.indexOf("مجموع نتائج البحث") >= 0, "renderReport");
  ok("يذكر عامل واحد", foot.indexOf("(1 عامل)") >= 0, "rows المفلترة");
  ok("الصافي = صف أحمد فقط (323,750)", cells.join(" ").indexOf("323,750") >= 0,
     "totalsOf(rows المفلترة)");
  ok("ما يذكر مجموع الثلاثة (993,750)", cells.join(" ").indexOf("993,750") < 0, "لا مجموع كل العمال");
}

/* ---------- الخلاصة ---------- */
console.log(lines.join("\n"));
console.log("\n" + "─".repeat(52));
console.log("نجح: " + pass + "   ·   فشل: " + fail);
process.exit(fail ? 1 : 0);
