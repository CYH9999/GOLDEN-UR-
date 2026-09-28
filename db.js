/* =====================================================================
   db.js — طبقة الخادم (Supabase)
   كل ما يخص الخادم يمرّ من هنا حصراً: الاتصال، الجلسة، هوية المستخدم
   وصلاحياته، تحميل البيانات كلها وبناؤها بشكل البرنامج، وكتابة كل تعديل سجلاً واحداً.
   index.html لا ينادي Supabase مباشرة أبداً، بل ينادي دوال هذا الملف.

   المفتاح anon علني بطبيعته. الحماية الفعلية كلها بسياسات RLS على
   الخادم: أي إخفاء بالواجهة ترتيب للعرض فقط، لا يُبنى عليه أمان.
   ===================================================================== */
"use strict";

const SUPABASE_URL = "https://qwtmrgwnxkntarifjvlk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3dG1yZ3dueGtudGFyaWZqdmxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1MjExMzEsImV4cCI6MjEwNjA5NzEzMX0.ISCatkx2oXnovZfCGCVZMKvrKya8AYmY2qE_S7m6cwg";

/* مفتاح الجلسة بالمتصفح — ثابت ومعروف حتى يقدر الخروج يمسحه يدوياً
   لو تعذّر الوصول للخادم لحظة الخروج (راجع dbSignOut). */
const DB_AUTH_KEY = "jard-auth";

/* العميل: الجلسة تُحفظ بالمتصفح وتتجدّد تلقائياً، فلا يُطلب الدخول مع كل فتح.
   إذا لم تُحمَّل المكتبة (انقطاع إنترنت أو حجب) يبقى sb فارغاً وتقول
   الواجهة ذلك بوضوح بدل أن تنكسر بصمت. */
const sb = (typeof window !== "undefined" && window.supabase && typeof window.supabase.createClient === "function")
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: DB_AUTH_KEY }
    })
  : null;

function dbReady() { return !!sb; }

/* ==================== مفردات الصلاحيات ====================
   نفس المفاتيح التي تفحصها سياسات الخادم. القراءة لا تحتاج صلاحية:
   أي رول يمنح صاحبه الاطلاع على مناطق نطاقه. */
const PERM_LABELS = {
  "roster.mark":      "تأشير الجرد اليومي",
  "roster.confirm":   "اعتماد اليوم",
  "workers.manage":   "إضافة وتعديل العمال والرواتب والحالات",
  "docs.manage":      "إصدار وتعديل الوصولات والكتب",
  "structure.manage": "المناطق والأقسام",
  "month.lock":       "قفل الشهر وفتحه",
  "trash.restore":    "استعادة المحذوفات",
  "audit.read":       "سجل التدقيق",
  "requests.decide":  "البتّ بطلبات الوصول",
  "company.settings": "إعدادات الشركة",
  "users.manage":     "المستخدمون والرولات"
};

/* ==================== المستخدم الحالي ====================
   ME = { id, email, name, active, perms:Set, zones:Set, allZones:bool, roles:[…] }
   perms و zones و allZones مجموع كل الرولات — للأسئلة العامة («عنده هذه
   الصلاحية بأي مكان؟»، «يرى هذه المنطقة؟»).
   roles تحفظ كل رول بنطاقه الخاص: الصلاحية تسري داخل نطاق الرول الذي
   يحملها فقط. لو جمعناها بلا نطاق، مستخدم يملك «تأشير» على البناية الجديدة
   ورولاً ثانياً للاطلاع على كل المناطق يظهر وكأنه يؤشّر بكل المناطق. */
let ME = null;

/* هل يملك المستخدم الصلاحية بأي منطقة؟ — لإظهار زر أو تبويب */
function can(perm) {
  return !!ME && ME.perms.has(perm);
}
/* هل يملكها على هذه المنطقة تحديداً؟ — رول واحد يجمع الصلاحية والنطاق معاً */
function canZone(perm, zoneId) {
  if (!ME) return false;
  return ME.roles.some(r => r.perms.has(perm) && (r.allZones || r.zones.has(zoneId)));
}
/* هل يرى المنطقة؟ — أي رول نطاقه يشملها يكفي للاطلاع */
function seesZone(zoneId) {
  return !!ME && (ME.allZones || ME.zones.has(zoneId));
}

/* ==================== الأخطاء ====================
   رسالة عربية يفهمها المستخدم، والأصل محفوظ بـ cause لمن يفحص الكونسول. */
function dbErr(e, fallback) {
  const raw = String((e && (e.message || e.error_description || e.msg)) || e || "");
  const status = e && (e.status || e.code);
  let msg = fallback || "تعذّر إكمال العملية.";
  if (/invalid login credentials|invalid_credentials|invalid_grant/i.test(raw))
    msg = "الإيميل أو كلمة المرور غير صحيحة.";
  else if (/email not confirmed/i.test(raw))
    msg = "الحساب غير مفعّل بعد — راجع مالك النظام.";
  else if (/banned|user_banned/i.test(raw))
    msg = "هذا الحساب موقوف — راجع مالك النظام.";
  else if (status === 429 || /rate limit|too many/i.test(raw))
    msg = "محاولات كثيرة متتالية — انتظر دقيقة ثم أعد المحاولة.";
  else if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(raw) ||
           (e && e.name === "AuthRetryableFetchError"))
    msg = "تعذّر الاتصال بالخادم — تأكد من الإنترنت ثم أعد المحاولة.";
  const err = new Error(msg);
  err.cause = e;
  return err;
}

/* ==================== الجلسة ==================== */

/* الجلسة المحفوظة بهذا المتصفح، أو null إن لم يدخل أحد */
async function dbSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw dbErr(error, "تعذّر التحقق من الجلسة.");
  return (data && data.session) || null;
}

/* الدخول بالإيميل وكلمة المرور — يُرجع المستخدم أو يرمي خطأً مفهوماً */
async function dbSignIn(email, password) {
  let res;
  try { res = await sb.auth.signInWithPassword({ email: email, password: password }); }
  catch (e) { throw dbErr(e, "تعذّر تسجيل الدخول."); }
  if (res.error) throw dbErr(res.error, "تعذّر تسجيل الدخول.");
  return res.data.user;
}

/* الخروج من هذا المتصفح فقط (scope:local). الافتراضي بالمكتبة «global» يُخرج
   المستخدم من كل أجهزته — الخروج من الحاسبة لا يُخرجه من هاتفه.
   لو تعذّر الوصول للخادم تبقى الجلسة محفوظة، فتُمسح يدوياً حتى يتم الخروج
   فعلاً بهذا الجهاز مهما كان حال الشبكة. */
async function dbSignOut() {
  let failed = false;
  try { const { error } = await sb.auth.signOut({ scope: "local" }); if (error) failed = true; }
  catch (e) { failed = true; }
  if (failed) {
    try {
      [DB_AUTH_KEY, DB_AUTH_KEY + "-code-verifier", DB_AUTH_KEY + "-user"]
        .forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }
  ME = null;
}

/* إشعار بتغيّر الجلسة: خروج من نافذة ثانية، انتهاء الجلسة، أو دخول مستخدم
   آخر بنفس المتصفح. النداء يُؤجَّل حتى لا يُستدعى الخادم من داخل مستمع
   المكتبة نفسه (المكتبة تحذّر من ذلك لأنه قد يعلّق). */
function dbOnAuthChange(cb) {
  sb.auth.onAuthStateChange((event, session) => { setTimeout(() => cb(event, session), 0); });
}

/* ==================== تحميل الهوية ====================
   profiles + user_roles أولاً، ثم roles + role_zones للرولات التي يحملها.
   أربعة استعلامات صريحة بدل الاستعلام المتداخل حتى لا يعتمد الدخول على
   أسماء العلاقات بالخادم. أسماء المناطق للعرض فقط — فشلها لا يمنع الدخول. */
async function dbLoadMe(user) {
  if (!user || !user.id) throw new Error("لا توجد جلسة دخول.");
  const uid = user.id;
  const fail = (r, what) => { if (r.error) throw dbErr(r.error, "تعذّر تحميل " + what + "."); };

  let pr, ur;
  try {
    [pr, ur] = await Promise.all([
      sb.from("profiles").select("id,full_name,active").eq("id", uid).maybeSingle(),
      sb.from("user_roles").select("role_id").eq("user_id", uid)
    ]);
  } catch (e) { throw dbErr(e, "تعذّر تحميل بيانات الحساب."); }
  fail(pr, "بيانات الحساب");
  fail(ur, "رولات الحساب");
  if (!pr.data) throw new Error("هذا الحساب غير مسجّل بقائمة مستخدمي النظام — راجع مالك النظام.");

  const roleIds = Array.from(new Set((ur.data || []).map(x => x.role_id).filter(Boolean)));
  let roleRows = [], zoneRows = [];
  if (roleIds.length) {
    let rr, rz;
    try {
      [rr, rz] = await Promise.all([
        sb.from("roles").select("id,company_id,name,color,perms,all_zones,is_system,sort_order").in("id", roleIds),
        sb.from("role_zones").select("role_id,zone_id").in("role_id", roleIds)
      ]);
    } catch (e) { throw dbErr(e, "تعذّر تحميل الرولات."); }
    fail(rr, "الرولات");
    fail(rz, "نطاقات الرولات");
    roleRows = rr.data || [];
    zoneRows = rz.data || [];
  }

  const zonesOf = {};
  zoneRows.forEach(z => { (zonesOf[z.role_id] = zonesOf[z.role_id] || new Set()).add(z.zone_id); });

  const roles = roleRows.map(r => ({
    id: r.id,
    companyId: r.company_id,
    name: String(r.name || ""),
    color: String(r.color || ""),
    perms: new Set(Array.isArray(r.perms) ? r.perms : []),
    allZones: r.all_zones === true,
    zones: zonesOf[r.id] || new Set(),
    isSystem: r.is_system === true,
    sortOrder: Number(r.sort_order) || 0
  })).sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, "ar"));

  const perms = new Set(), zones = new Set();
  roles.forEach(r => { r.perms.forEach(p => perms.add(p)); r.zones.forEach(z => zones.add(z)); });

  /* أسماء مناطق النطاق — لشرح الرول للمستخدم فقط */
  const zoneNames = {};
  if (zones.size) {
    try {
      const zr = await sb.from("zones").select("id,name").in("id", Array.from(zones));
      (zr.data || []).forEach(z => { zoneNames[z.id] = String(z.name || ""); });
    } catch (e) {}
  }

  ME = {
    id: uid,
    email: String(user.email || ""),
    name: String(pr.data.full_name || "").trim() || String(user.email || ""),
    active: pr.data.active !== false,
    perms: perms,
    zones: zones,
    allZones: roles.some(r => r.allZones),
    roles: roles,
    zoneNames: zoneNames
  };
  return ME;
}

/* هوية الفحص المحلي (tests/): مالك بكل الصلاحيات على كل المناطق، حتى تمرّ
   الفحوص بكل مسارات الواجهة بلا خادم. لا تُنادى إلا مع __JARD_TEST__ —
   ولا تمنح شيئاً فعلياً: الخادم لا يعرفها، وكل حماية حقيقية بسياسات RLS. */
function dbLocalOwner() {
  const all = new Set(Object.keys(PERM_LABELS));
  ME = {
    id: "local", email: "", name: "فحص محلي", active: true,
    perms: all, zones: new Set(), allZones: true, zoneNames: {},
    roles: [{ id: "local", companyId: "", name: "مالك النظام", color: "#4B2E83",
      perms: all, allZones: true, zones: new Set(), isSystem: true, sortOrder: 0 }]
  };
  return ME;
}

/* ==================== تحميل البيانات (القراءة) ====================
   كل شيء يُسحب عند الإقلاع ويُبنى بنفس شكل state الذي تقرأ منه الواجهة
   والمحرّك، فلا تتغيّر أي دالة حساب. البيانات كلها عشرات الكيلوبايت، فلا
   تحميل جزئي بالشهور — الاستثناء سجل التدقيق: آخر ٢٠٠ قيد.
   التحميل (dbFetchAll) منفصل عن البناء (dbBuildState): البناء دالة خالصة بلا
   خادم، فتُفحص بالفحص الذاتي على صفوف مصنوعة بيد. */

const DB_PAGE = 1000;          // حجم صفحة القراءة
const DB_AUDIT_LIMIT = 200;    // سجل التدقيق: أحدث ٢٠٠ قيد فقط

/* الشركة من رولات المستخدم — كل رولاته في شركة واحدة */
function dbCompanyId() {
  const ids = ME ? Array.from(new Set(ME.roles.map(r => r.companyId).filter(Boolean))) : [];
  return ids[0] || null;
}
/* الشركة المحمّلة — كل كتابة تحمل معرّفها */
let DB_CID = null;

/* جدول كامل على صفحات. الخادم يقصّ الطلب الواحد عند حدّ (١٠٠٠ صف افتراضياً
   وقد يُضبط أقل)، فقراءة بطلب واحد تقصّ الجرد بصمت بعد أشهر قليلة. العدد
   الكلي يُطلب مع الصفحة الأولى، والقراءة تستمر حتى يكتمل مهما كان الحدّ.
   shape تضيف الفلاتر والترتيب — الترتيب الثابت شرط حتى لا تتداخل الصفحات. */
async function dbReadAll(table, cols, what, cid, shape) {
  const out = [];
  let total = null;
  for (let guard = 0; guard < 100000; guard++) {
    let q = sb.from(table).select(cols, out.length ? undefined : { count: "exact" }).eq("company_id", cid);
    if (shape) q = shape(q);
    let r;
    try { r = await q.range(out.length, out.length + DB_PAGE - 1); }
    catch (e) { throw dbErr(e, "تعذّر تحميل " + what + "."); }
    if (r.error) throw dbErr(r.error, "تعذّر تحميل " + what + ".");
    const rows = r.data || [];
    if (total === null && typeof r.count === "number") total = r.count;
    for (let i = 0; i < rows.length; i++) out.push(rows[i]);
    /* بلا عدد كلي لا يُحكم بقصر الصفحة (حدّ الخادم قد يكون أقل من DB_PAGE): القراءة
       تستمر حتى صفحة فارغة */
    if (!rows.length) break;
    if (total !== null && out.length >= total) break;
  }
  return out;
}

/* الصفوف الخام من كل الجداول. الخادم يعيد لكل مستخدم ما تسمح به سياساته فقط
   (مناطق نطاقه وعمالها وأيامهم ووثائقهم) — فلا فلترة أمنية هنا. */
async function dbFetchAll() {
  const cid = dbCompanyId();
  if (!cid) throw new Error("حسابك غير مرتبط بأي شركة — راجع مالك النظام.");
  const live = q => q.is("deleted_at", null);

  let co;
  try { co = await sb.from("companies").select("id,name,theme,accent,settings").eq("id", cid).maybeSingle(); }
  catch (e) { throw dbErr(e, "تعذّر تحميل بيانات الشركة."); }
  if (co.error) throw dbErr(co.error, "تعذّر تحميل بيانات الشركة.");
  if (!co.data) throw new Error("تعذّر الوصول إلى بيانات الشركة — راجع مالك النظام.");
  DB_CID = co.data.id;

  const auditQ = (async () => {
    let r;
    try {
      r = await sb.from("audit_log").select("id,user_id,kind,what,before_val,after_val,reason,at")
        .eq("company_id", cid).order("at", { ascending: false }).order("id", { ascending: false })
        .limit(DB_AUDIT_LIMIT);
    } catch (e) { throw dbErr(e, "تعذّر تحميل سجل التدقيق."); }
    if (r.error) throw dbErr(r.error, "تعذّر تحميل سجل التدقيق.");
    return r.data || [];
  })();

  const [buildings, zones, sections, workers, dayStates, dayZones, documents, materials, holidays, locks, audit] =
    await Promise.all([
      dbReadAll("buildings", "id,name,short,sort_order", "الجهات", cid,
        q => q.order("sort_order").order("id")),
      dbReadAll("zones", "id,building_id,name,short,color,sort_order", "المناطق", cid,
        q => live(q).order("sort_order").order("id")),
      dbReadAll("sections", "id,zone_id,name,sort_order", "الأقسام", cid,
        q => live(q).order("sort_order").order("id")),
      dbReadAll("workers",
        "id,seq,name,mother_name,dob,phone,phone2,address,section_id,status,status_changed_at," +
        "status_note,status_history,start_date,salary,deduct,leave_policy,off_weekdays,off_dates",
        "العمال", cid, q => live(q).order("seq").order("id")),
      dbReadAll("day_states", "date,worker_id,state", "تأشيرات الجرد", cid,
        q => q.order("date").order("worker_id")),
      dbReadAll("day_zones", "date,zone_id,notes,confirmed", "اعتماد الأيام والملاحظات", cid,
        q => q.order("date").order("zone_id")),
      dbReadAll("documents", "id,kind,no,worker_id,zone_id,date,date_to,data,revisions",
        "الوثائق", cid, q => live(q).order("id")),
      dbReadAll("materials", "id,name,unit,qty,sort_order", "المواد", cid,
        q => live(q).order("sort_order").order("id")),
      dbReadAll("holidays", "date,name", "العطل", cid, q => q.order("date")),
      dbReadAll("month_locks", "month,locked_at,snapshot", "أقفال الأشهر", cid, q => q.order("month")),
      auditQ
    ]);

  return { company: co.data, buildings, zones, sections, workers, dayStates, dayZones,
    documents, materials, holidays, locks, audit };
}

/* ---- أدوات التحويل ----
   التاريخ (عمود date) يبقى نصاً YYYY-MM-DD كما جاء، ولا يمرّ عبر new Date —
   المنطقة الزمنية تزيحه يوماً. أما الطوابع الزمنية (timestamptz) فلحظات
   حقيقية، فتُحوَّل لوقت الجهاز المحلي. */
function dbDay(v) { return v == null ? "" : String(v).slice(0, 10); }
function dbStamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function dbStr(v) { return v == null ? "" : String(v); }
/* null يبقى null: الراتب والاستقطاع الفارغان يعنيان «الافتراضي»، والصفر
   مبلغ حقيقي. Number(null) = 0 كان سيعطي راتباً صفراً بصمت. */
function dbNumOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
/* أرقام داخل jsonb الوثيقة: إن وصلت نصاً تُقرأ رقماً بدقتها كاملة، بلا تقريب */
const DB_DOC_NUMS = ["amount", "days", "dayRate", "hours"];
function dbFixNums(o) {
  DB_DOC_NUMS.forEach(k => {
    if (typeof o[k] === "string" && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(o[k].trim())) o[k] = Number(o[k]);
  });
  return o;
}
const DB_AR = (function () {
  try { return new Intl.Collator("ar", { numeric: true }); }
  catch (e) { return { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) }; }
})();

/* أعمدة التاريخ في جدول الوثائق ← حقول الوثيقة بالبرنامج، لكل نوع.
   حقل kind داخل العقوبة (none/days/amount) يبقى من data كما هو — غير documents.kind. */
const DB_DOC_LISTS = { leave: "leaves", penalty: "penalties", achievement: "achievements",
  issue: "issues", letter: "letters", pass: "passes" };
const DB_DOC_DATES = { leave: ["from", "to"], issue: ["from", "to"], penalty: ["date"],
  achievement: ["date"], letter: ["date"], pass: ["date"] };

/* وثيقة بشكلها بالبرنامج: data أساسها، والأعمدة (المعرّف، الرقم، العامل،
   التواريخ، النسخ السابقة) هي المرجع لأنها ما يفحصه الخادم (قفل الشهر،
   تفرّد الرقم) وما تكتبه المرحلة التالية. */
function dbDoc(r) {
  const d = (r.data && typeof r.data === "object" && !Array.isArray(r.data)) ? r.data : {};
  const o = dbFixNums(Object.assign({}, d));   // لا حقل يُخترع: الشكل كما حُفظ
  o.id = r.id;
  if (r.no != null) o.no = String(r.no);
  if (r.kind !== "letter") o.workerId = r.worker_id != null ? r.worker_id : dbStr(d.workerId);
  const f = DB_DOC_DATES[r.kind] || [];
  if (f[0] && r.date != null) o[f[0]] = dbDay(r.date);
  if (f[1] && r.date_to != null) o[f[1]] = dbDay(r.date_to);
  const rv = Array.isArray(r.revisions) ? r.revisions : (Array.isArray(d.revisions) ? d.revisions : []);
  if (rv.length) o.revisions = rv; else delete o.revisions;
  return o;
}

function dbWorker(r) {
  const w = {
    id: r.id,
    name: dbStr(r.name),
    sectionId: dbStr(r.section_id),
    salary: dbNumOrNull(r.salary),
    deduct: dbNumOrNull(r.deduct),
    offWeekdays: Array.isArray(r.off_weekdays) ? r.off_weekdays.map(Number) : [],
    /* التاريخ الفارغ نص فارغ لا null — بنفس شكل البيانات المحلية */
    startDate: dbDay(r.start_date),
    dob: dbStr(r.dob),
    motherName: dbStr(r.mother_name),
    status: dbStr(r.status),
    statusChangedAt: dbDay(r.status_changed_at),
    statusNote: dbStr(r.status_note),
    statusHistory: Array.isArray(r.status_history) ? r.status_history : [],
    phone: dbStr(r.phone),
    phone2: dbStr(r.phone2),
    address: dbStr(r.address),
    seq: Number(r.seq) || 0
  };
  if (Array.isArray(r.off_dates) && r.off_dates.length) w.offDates = r.off_dates.map(dbDay);
  if (r.leave_policy) w.leavePolicy = String(r.leave_policy);
  return w;
}

/* الصفوف الخام ← state بنفس شكل البرنامج { v:2, companies:[c], active }.
   دالة خالصة: لا خادم ولا صفحة، فتُفحص مستقلة. */
function dbBuildState(raw) {
  const co = raw.company || {};
  /* الإعدادات كلها كما هي (أربعون مفتاحاً) — لا تصفية ولا قائمة مفترضة */
  const settings = Object.assign({}, (co.settings && typeof co.settings === "object" && !Array.isArray(co.settings)) ? co.settings : {});
  /* العطل من جدولها، لا من settings */
  settings.holidays = (raw.holidays || []).filter(h => h && h.date)
    .map(h => ({ date: dbDay(h.date), name: dbStr(h.name) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const buildings = (raw.buildings || []).map(b => ({ id: b.id, name: dbStr(b.name), short: dbStr(b.short),
    sortOrder: Number(b.sort_order) || 0 }))
    .sort((a, b) => (a.sortOrder - b.sortOrder) || DB_AR.compare(a.name, b.name));
  const bIdx = {};
  buildings.forEach((b, i) => { bIdx[b.id] = i; });
  const bOf = id => (id in bIdx ? bIdx[id] : 999);

  /* المناطق مرتّبة بجهتها ثم بترتيبها داخل الجهة — ترتيب خانات العدّاد والورقة */
  const zones = (raw.zones || []).slice()
    .sort((a, b) => (bOf(a.building_id) - bOf(b.building_id)) ||
      ((Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)) || DB_AR.compare(dbStr(a.name), dbStr(b.name)))
    .map(z => ({ id: z.id, name: dbStr(z.name), short: dbStr(z.short), color: dbStr(z.color),
      buildingId: z.building_id || "" }));

  /* الأقسام بترتيبها المقصود داخل منطقتها (ترتيب ورقة الجرد)، والمناطق بترتيبها أعلاه.
     sortOrder يُحفظ مع القسم حتى يُكتب عند التحريك لأعلى/لأسفل. */
  const zIdx = {};
  zones.forEach((z, i) => { zIdx[z.id] = i; });
  const zOf = id => (id in zIdx ? zIdx[id] : 999);
  const sections = (raw.sections || []).map(s => ({ id: s.id, name: dbStr(s.name), zoneId: dbStr(s.zone_id),
    sortOrder: Number(s.sort_order) || 0 }))
    .sort((a, b) => (zOf(a.zoneId) - zOf(b.zoneId)) || (a.sortOrder - b.sortOrder) ||
      DB_AR.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));

  const workers = (raw.workers || []).map(dbWorker).sort((a, b) => (a.seq - b.seq) || (a.id < b.id ? -1 : 1));

  /* الأيام: الحاضر لا يُخزَّن — الصف موجود للغائب والمتفرقة فقط.
     الملاحظات والاعتماد لكل منطقة على حدة. */
  const days = {};
  const day = k => days[k] || (days[k] = { states: {}, zones: {} });
  (raw.dayStates || []).forEach(r => {
    if (r && (r.state === "absent" || r.state === "misc")) day(dbDay(r.date)).states[r.worker_id] = r.state;
  });
  (raw.dayZones || []).forEach(r => {
    if (r && r.zone_id) day(dbDay(r.date)).zones[r.zone_id] = { notes: dbStr(r.notes), confirmed: r.confirmed === true };
  });

  /* وثيقة عامل محذوف (حذف منطقي) لا تظهر بالقوائم — كما كان حذف العامل يحذف وثائقه —
     وتبقى على الخادم فترجع باستعادته */
  const wIds = new Set(workers.map(w => w.id));
  const lists = { leaves: [], penalties: [], achievements: [], issues: [], letters: [], passes: [] };
  (raw.documents || []).forEach(r => {
    const k = r && DB_DOC_LISTS[r.kind];
    if (k && !(r.worker_id && !wIds.has(r.worker_id))) lists[k].push(dbDoc(r));
  });
  /* الوصولات الأحدث أولاً كما يضيفها البرنامج، والكتب بترتيب إصدارها */
  const byNo = (a, b) => DB_AR.compare(dbStr(a.no), dbStr(b.no));
  ["leaves", "penalties", "achievements", "issues", "passes"].forEach(k => lists[k].sort((a, b) => byNo(b, a)));
  lists.letters.sort(byNo);

  const materials = (raw.materials || []).map(m => ({ id: m.id, name: dbStr(m.name), unit: dbStr(m.unit),
    qty: Number(m.qty) || 0 }));

  /* قفل الشهر: الصورة كلها (at, net, n, rows) كما حُفظت */
  const locks = {};
  (raw.locks || []).forEach(r => {
    if (!r || !r.month) return;
    const s = (r.snapshot && typeof r.snapshot === "object" && !Array.isArray(r.snapshot)) ? Object.assign({}, r.snapshot) : {};
    if (!s.at && r.locked_at) s.at = dbStamp(r.locked_at);
    locks[String(r.month)] = s;
  });

  /* سجل التدقيق بالترتيب الزمني (الأقدم أولاً) كما يضيفه البرنامج */
  const audit = (raw.audit || []).slice().reverse().map(r => {
    const a = { at: dbStamp(r.at), kind: dbStr(r.kind), what: dbStr(r.what),
      before: dbStr(r.before_val), after: dbStr(r.after_val) };
    if (r.reason) a.reason = String(r.reason);
    if (r.user_id) a.userId = r.user_id;
    return a;
  });

  const c = {
    id: co.id, name: dbStr(co.name), theme: co.theme || "#4B2E83", accent: co.accent || "#B8912E",
    settings: settings,
    buildings: buildings, zones: zones, sections: sections, workers: workers, days: days,
    leaves: lists.leaves, penalties: lists.penalties, achievements: lists.achievements,
    issues: lists.issues, letters: lists.letters, passes: lists.passes,
    materials: materials, locks: locks, audit: audit,
    /* الكود يقرأ شهر بدء إصلاح أشهر الـ٣١ يوماً من c.pay31From مباشرة (buildReport)،
       وهو على الخادم داخل settings. يبقى في settings أيضاً حتى لا يسقط عند حفظها. */
    pay31From: settings.pay31From ? String(settings.pay31From) : "",
    /* البيانات مرحّلة سلفاً: علامات الترحيلات القديمة مضبوطة فلا يُعاد أيٌّ منها */
    matSeeded: true, payV3: true, payV5: true, payV6: true, auditV1: true, formV1: true
  };
  return { v: 2, companies: [c], active: c.id };
}

/* التحميل الكامل: الصفوف من الخادم ثم البناء */
async function dbLoadState() {
  return dbBuildState(await dbFetchAll());
}

/* ==================== الكتابة ====================
   كل تعديل = كتابة سجل واحد (أو صفوف جهة واحدة بطلب واحد) — لا تُكتب الحالة ككتلة أبداً.
   الكتابات تُرسل بالترتيب في طابور واحد: تأشير ثم تصحيحه لا ينقلبان على الخادم.
   الرفض لا يُبلع: الخطأ يُعاد برسالة عربية — نص الخادم كما هو إن كان عربياً (الحُرّاس
   كقفل الشهر ترفع رسائلها بالعربية)، وإلا ترجمة مفهومة لرمزه — وتُبلَّغ الواجهة
   (dbOnWrite) فتعرضه وتعيد مزامنة بياناتها. لا ترسل الكتابات updated_by ولا updated_at
   ولا seq: الخادم يختمها ويعطيها.
   بلا خادم (الفحوص) الكتابة لا تفعل شيئاً، والتعديل يبقى بالذاكرة كما كان. */
function dbLocal() {
  return !sb || (typeof window !== "undefined" && !!window.__JARD_TEST__);
}
let dbQ = Promise.resolve(), dbBusy = 0, dbWriteCb = null;
/* cb(حالة, خطأ, صامت): "saving" يحفظ · "saved" محفوظ · "rejected" رفضه الخادم ·
   "offline" تعذّر الاتصال. صامت: المستدعي يعرض الخطأ بنفسه. */
function dbOnWrite(cb) { dbWriteCb = cb; }
function dbEmit(st, err, quiet) { if (dbWriteCb) { try { dbWriteCb(st, err, !!quiet); } catch (e) {} } }
function dbMe() { return ME ? ME.id : null; }
function dbNow() { return new Date().toISOString(); }

function dbWriteErr(e, what) {
  const raw = String((e && (e.message || e.msg || e.error_description)) || e || "");
  const code = e && e.code;
  const w = what ? "«" + what + "»" : "التعديل";
  let msg, net = false;
  if (/[؀-ۿ]/.test(raw)) msg = raw;
  else if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|aborted/i.test(raw) ||
           (e && (e.name === "TypeError" || e.name === "AbortError"))) {
    net = true; msg = "تعذّر الاتصال بالخادم — " + w + " لم يُحفظ.";
  }
  else if (code === "42501" || /row-level security|permission denied/i.test(raw))
    msg = "الخادم رفض " + w + ": لا تملك صلاحية هذا التعديل.";
  else if (code === "23505")
    msg = "الخادم رفض " + w + ": القيمة مستعملة من قبل" + (/documents|\bno\b/i.test(raw) ? " — رقم الوثيقة موجود." : ".");
  else if (code === "23503")
    msg = "الخادم رفض " + w + ": يشير إلى سجل غير موجود (ربما حُذف من جهاز آخر).";
  else if (code === "23502" || code === "23514" || code === "22P02" || code === "22007")
    msg = "الخادم رفض " + w + ": قيمة ناقصة أو غير مقبولة.";
  else msg = "الخادم رفض " + w + (raw ? " (" + raw + ")" : "") + ".";
  const err = new Error(msg);
  err.cause = e; err.network = net; err.code = code;
  return err;
}

/* كتابة واحدة بالطابور. fn تُرجع وعد استعلام Supabase.
   opts.quiet: المستدعي يعرض الخطأ بنفسه (الوثائق: لا تتغيّر الذاكرة إلا بعد القبول).
   opts.expect: تعديل سجل موجود — صفر صفوف معدّلة رفضٌ صامت من السياسات، فيُعلن. */
function dbWrite(what, fn, opts) {
  opts = opts || {};
  if (dbLocal()) return Promise.resolve(opts.local === undefined ? null : opts.local);
  dbBusy++; dbEmit("saving");
  const run = dbQ.then(async () => {
    let r;
    try { r = await fn(); } catch (e) { throw dbWriteErr(e, what); }
    if (r && r.error) throw dbWriteErr(r.error, what);
    if (opts.expect && !(r && Array.isArray(r.data) && r.data.length))
      throw dbWriteErr({ message: "لم يتغيّر أي سجل على الخادم — السجل غير موجود أو لا تملك تعديله." }, what);
    return r ? r.data : null;
  });
  dbQ = run.catch(() => {});
  return run.then(
    d => { if (!--dbBusy) dbEmit("saved"); return d; },
    e => { dbBusy--; dbEmit(e.network ? "offline" : "rejected", e, opts.quiet); throw e; });
}
/* كتابة تتفاؤلية: الذاكرة تغيّرت سلفاً، والرفض تعالجه الواجهة مركزياً (dbOnWrite) */
function dbFire(what, fn, opts) { return dbWrite(what, fn, opts).catch(() => null); }
function dbPendingWrites() { return dbBusy; }

/* ---- اليوم: day_states (صف لكل غائب أو متفرقة؛ الحاضر بلا صف) و day_zones ---- */
function dbSaveDayState(iso, wid, st, what) {
  return dbFire(what, () => (st === "absent" || st === "misc")
    ? sb.from("day_states").upsert({ company_id: DB_CID, date: iso, worker_id: wid, state: st },
        { onConflict: "company_id,date,worker_id" })
    : sb.from("day_states").delete().eq("company_id", DB_CID).eq("date", iso).eq("worker_id", wid));
}
/* «الكل حاضر»: حذف تأشيرات عمال جهة بيوم — الحذف الفعلي الوحيد المسموح */
function dbClearDayStates(iso, wids, what) {
  if (!wids.length) return Promise.resolve(null);
  return dbFire(what, () => sb.from("day_states").delete()
    .eq("company_id", DB_CID).eq("date", iso).in("worker_id", wids));
}
/* اعتماد و/أو ملاحظة لمناطق (مناطق جهة واحدة عادة) بأيام — طلب واحد.
   patch: { confirmed?: bool, notes?: string } */
function dbSaveDayZones(isos, zids, patch, what) {
  const rows = [];
  [].concat(isos).forEach(d => zids.forEach(z => {
    const r = { company_id: DB_CID, date: d, zone_id: z };
    if (patch.notes !== undefined) r.notes = String(patch.notes || "");
    if (patch.confirmed !== undefined) {
      r.confirmed = !!patch.confirmed;
      r.confirmed_by = patch.confirmed ? dbMe() : null;
      r.confirmed_at = patch.confirmed ? dbNow() : null;
    }
    rows.push(r);
  }));
  if (!rows.length) return Promise.resolve(null);
  return dbFire(what, () => sb.from("day_zones").upsert(rows, { onConflict: "company_id,date,zone_id" }));
}

/* ---- العمال ----
   النصوص الحرة تُرسل نصاً (الفارغ ""), والتواريخ والمعرّفات والقيم المحدّدة null للفارغ:
   عمود التاريخ لا يحمل نصاً فارغاً، والبرنامج يقرأ null نصاً فارغاً كما كان. */
function dbWorkerRow(w) {
  const t = v => (v == null ? "" : String(v));
  const n = v => (v == null || v === "" ? null : v);
  return { name: t(w.name), mother_name: t(w.motherName), dob: t(w.dob), phone: t(w.phone), phone2: t(w.phone2),
    address: t(w.address), section_id: n(w.sectionId), status: w.status || "مستمر",
    status_changed_at: n(w.statusChangedAt), status_note: t(w.statusNote),
    status_history: Array.isArray(w.statusHistory) ? w.statusHistory : [], start_date: n(w.startDate),
    salary: dbNumOrNull(w.salary), deduct: dbNumOrNull(w.deduct), leave_policy: n(w.leavePolicy),
    off_weekdays: (w.offWeekdays || []).map(Number), off_dates: (w.offDates || []).slice() };
}
/* إدراج عمال (واحد أو دفعة بطلب واحد) بلا seq — يعطيه الخادم ويُقرأ من ردّه.
   الوعد يُحلّ بـ { id: seq } */
function dbInsertWorkers(ws, what) {
  const rows = ws.map(w => Object.assign({ id: w.id, company_id: DB_CID, created_by: dbMe() }, dbWorkerRow(w)));
  return dbWrite(what, () => sb.from("workers").insert(rows).select("id,seq"), { local: [] })
    .then(d => { const m = {}; (d || []).forEach(r => { m[r.id] = Number(r.seq) || 0; }); return m; })
    .catch(() => null);
}
function dbUpdateWorker(w, what) {
  return dbFire(what, () => sb.from("workers").update(dbWorkerRow(w)).eq("company_id", DB_CID).eq("id", w.id).select("id"),
    { expect: true });
}
function dbDeleteWorker(id, what) {
  return dbFire(what, () => sb.from("workers").update({ deleted_at: dbNow(), deleted_by: dbMe() })
    .eq("company_id", DB_CID).eq("id", id).select("id"), { expect: true });
}

/* ---- الوثائق ----
   الرقم من العدّاد الذرّي على الخادم حصراً (next_doc_no) — لا تخمين بالواجهة. بلا خادم
   (الفحوص) يقوم مقامه عدّاد من القائمة نفسها. */
function dbNextDocNo(kind, prefix, yr, list) {
  if (dbLocal()) {
    let mx = 0;
    const re = new RegExp("^" + prefix + "-" + yr + "-(\\d+)$");
    (list || []).forEach(x => { const m = re.exec(String((x && x.no) || "")); if (m) mx = Math.max(mx, +m[1]); });
    return Promise.resolve(prefix + "-" + yr + "-" + String(mx + 1).padStart(3, "0"));
  }
  return dbWrite("رقم وثيقة جديد", () => sb.rpc("next_doc_no", { cid: DB_CID, k: kind, prefix: prefix, yr: String(yr) }),
    { quiet: true })
    .then(no => { if (!no) throw dbWriteErr({ message: "الخادم لم يُعطِ رقماً للوثيقة." }, "رقم وثيقة جديد"); return String(no); });
}
/* الوثيقة ← صف: الأعمدة (الرقم، العامل، التاريخان، النسخ السابقة) وما بقي في data —
   عكس dbDoc تماماً */
function dbDocRow(kind, rec) {
  const f = DB_DOC_DATES[kind] || [];
  const data = Object.assign({}, rec);
  ["id", "no", "revisions", "workerId"].concat(f).forEach(k => { delete data[k]; });
  return { no: String(rec.no || ""), worker_id: kind === "letter" ? null : (rec.workerId || null),
    date: rec[f[0]] || null, date_to: f[1] ? (rec[f[1]] || null) : null, data: data,
    revisions: Array.isArray(rec.revisions) ? rec.revisions : [] };
}
function dbInsertDoc(kind, rec, zoneId, what) {
  const row = Object.assign({ id: rec.id, company_id: DB_CID, kind: kind, zone_id: zoneId || null, created_by: dbMe() },
    dbDocRow(kind, rec));
  return dbWrite(what, () => sb.from("documents").insert(row), { quiet: true });
}
/* تعديل وثيقة: الصف كله مع revisions (النسخة السابقة مدفوعة فيها). zoneId يُرسل فقط إذا
   تغيّر العامل — المنطقة تُثبَّت وقت الإصدار. */
function dbUpdateDoc(kind, rec, zoneId, what) {
  const row = dbDocRow(kind, rec);
  if (zoneId !== undefined) row.zone_id = zoneId || null;
  return dbWrite(what, () => sb.from("documents").update(row).eq("company_id", DB_CID).eq("id", rec.id).select("id"),
    { quiet: true, expect: true });
}
/* تعديل وثيقة بالخلفية (تصحيح اسم عامل بنسختها مثلاً): الرفض يُعالج مركزياً */
function dbUpdateDocBg(kind, rec, what) {
  return dbFire(what, () => sb.from("documents").update(dbDocRow(kind, rec)).eq("company_id", DB_CID).eq("id", rec.id)
    .select("id"), { expect: true });
}
function dbDeleteDoc(id, what) {
  return dbWrite(what, () => sb.from("documents").update({ deleted_at: dbNow(), deleted_by: dbMe() })
    .eq("company_id", DB_CID).eq("id", id).select("id"), { quiet: true, expect: true });
}

/* ---- الشركة: الإعدادات صف واحد. العطل ليست فيها (جدولها مستقل) ---- */
function dbSaveCompany(c, what) {
  const settings = Object.assign({}, c.settings || {});
  delete settings.holidays;
  return dbFire(what, () => sb.from("companies").update({ name: c.name, theme: c.theme, accent: c.accent, settings: settings })
    .eq("id", DB_CID).select("id"), { expect: true });
}

/* ---- الهيكل: المناطق والأقسام (الحذف منطقي) ---- */
function dbInsertZone(z, sortOrder, what) {
  return dbFire(what, () => sb.from("zones").insert({ id: z.id, company_id: DB_CID, building_id: z.buildingId || null,
    name: z.name, short: z.short || "", color: z.color || null, sort_order: sortOrder }));
}
function dbUpdateZone(z, sortOrder, what) {
  const row = { name: z.name, short: z.short || "", color: z.color || null };
  if (sortOrder !== undefined) row.sort_order = sortOrder;
  return dbFire(what, () => sb.from("zones").update(row).eq("company_id", DB_CID).eq("id", z.id).select("id"), { expect: true });
}
function dbDeleteZone(id, what) {
  return dbFire(what, () => sb.from("zones").update({ deleted_at: dbNow(), deleted_by: dbMe() })
    .eq("company_id", DB_CID).eq("id", id).select("id"), { expect: true });
}
function dbInsertSection(sec, what) {
  return dbFire(what, () => sb.from("sections").insert({ id: sec.id, company_id: DB_CID, zone_id: sec.zoneId || null,
    name: sec.name, sort_order: Number(sec.sortOrder) || 0 }));
}
function dbUpdateSection(sec, what) {
  return dbFire(what, () => sb.from("sections").update({ zone_id: sec.zoneId || null, name: sec.name,
    sort_order: Number(sec.sortOrder) || 0 }).eq("company_id", DB_CID).eq("id", sec.id).select("id"), { expect: true });
}
function dbDeleteSection(id, what) {
  return dbFire(what, () => sb.from("sections").update({ deleted_at: dbNow(), deleted_by: dbMe() })
    .eq("company_id", DB_CID).eq("id", id).select("id"), { expect: true });
}

/* ---- كتالوج المواد ---- */
function dbInsertMaterial(m, sortOrder, what) {
  return dbFire(what, () => sb.from("materials").insert({ id: m.id, company_id: DB_CID, name: m.name, unit: m.unit || "",
    qty: Number(m.qty) || 0, sort_order: sortOrder }));
}
function dbUpdateMaterial(m, sortOrder, what) {
  const row = { name: m.name, unit: m.unit || "", qty: Number(m.qty) || 0 };
  if (sortOrder !== undefined) row.sort_order = sortOrder;
  return dbFire(what, () => sb.from("materials").update(row).eq("company_id", DB_CID).eq("id", m.id).select("id"), { expect: true });
}
function dbDeleteMaterial(id, what) {
  return dbFire(what, () => sb.from("materials").update({ deleted_at: dbNow(), deleted_by: dbMe() })
    .eq("company_id", DB_CID).eq("id", id).select("id"), { expect: true });
}

/* ---- العطل وأقفال الأشهر ----
   لا سياسة حذف على الجدولين: حذف عطلة وفتح قفل يُطلبان كحذف، وصفر صفوف محذوفة يُعلن
   رفضاً صريحاً بدل أن يمرّ بصمت. */
function dbInsertHolidays(hs, what) {
  if (!hs.length) return Promise.resolve(null);
  return dbFire(what, () => sb.from("holidays").insert(hs.map(h =>
    ({ company_id: DB_CID, date: h.date, name: h.name || "", added_by: dbMe() }))));
}
function dbDeleteHoliday(date, what) {
  return dbFire(what, () => sb.from("holidays").delete().eq("company_id", DB_CID).eq("date", date).select("date"),
    { expect: true });
}
function dbInsertLock(month, snapshot, what) {
  return dbWrite(what, () => sb.from("month_locks").insert({ company_id: DB_CID, month: month, snapshot: snapshot,
    locked_by: dbMe(), locked_at: dbNow() }), { quiet: true });
}
function dbDeleteLock(month, what) {
  return dbWrite(what, () => sb.from("month_locks").delete().eq("company_id", DB_CID).eq("month", month).select("month"),
    { quiet: true, expect: true });
}

/* ---- سجل التدقيق: إضافة فقط ---- */
function dbAudit(a) {
  return dbFire("قيد سجل التدقيق", () => sb.from("audit_log").insert({ company_id: DB_CID, user_id: dbMe(),
    kind: String(a.kind || ""), what: String(a.what || ""), before_val: String(a.before || ""),
    after_val: String(a.after || ""), reason: (a.reason || a.ref) ? String(a.reason || a.ref) : null }));
}
/* يُحلّ حين يفرغ طابور الكتابة */
function dbIdle() { return dbQ.then(() => {}); }
