/* =====================================================================
   db.js — طبقة الخادم (Supabase)
   كل ما يخص الخادم يمرّ من هنا حصراً: الاتصال، الجلسة، هوية المستخدم
   وصلاحياته — ولاحقاً القراءة والكتابة. index.html لا ينادي Supabase
   مباشرة أبداً، بل ينادي دوال هذا الملف.

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
