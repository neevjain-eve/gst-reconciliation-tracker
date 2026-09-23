/**
 * GSTR-2B download helper – a bookmarklet the user runs in their own browser,
 * on the GST portal, AFTER logging in themselves.
 *
 * What it does: navigates to the Returns Dashboard, selects the financial year /
 * quarter / month the user types in, presses Search, opens the GSTR-2B tile and,
 * on the GSTR-2B page, asks the portal to generate / download the Excel file.
 *
 * What it never does: read, fill or submit the login form, password or captcha;
 * send anything anywhere (no network calls of its own); run unless the user clicks it.
 * If the portal's layout differs from what it expects it stops and tells the user
 * what to click instead.
 *
 * The code is kept as plain ES2017 strings (no template placeholders) so it can be
 * embedded in a javascript: URL. Chrome strips newlines from URLs, so every
 * statement ends in a semicolon and there are no line comments inside.
 */

export const HELPERS_SRC = String.raw`
var MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function periodInfo(p) {
  var m = /^\s*(\d{1,2})\s*[-\/]\s*(\d{4})\s*$/.exec(p || "");
  if (!m) return null;
  var mo = +m[1], y = +m[2];
  if (mo < 1 || mo > 12 || y < 2017 || y > 2100) return null;
  var fyStart = mo >= 4 ? y : y - 1;
  var q = mo <= 3 ? 4 : mo <= 6 ? 1 : mo <= 9 ? 2 : 3;
  return { month: mo, year: y, monthName: MONTHS[mo - 1], fy: fyStart + "-" + pad2((fyStart + 1) % 100), fyLong: fyStart + "-" + (fyStart + 1), quarter: q };
}
function defaultPeriod(now) { var d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return pad2(d.getMonth() + 1) + "-" + d.getFullYear(); }
function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }
function classify(opts) {
  var t = opts.map(norm);
  if (t.some(function (x) { return /^\d{4}\s*-\s*\d{2,4}$/.test(x); })) return "fy";
  if (t.some(function (x) { return /quarter|apr\s*-\s*jun|jul\s*-\s*sep|oct\s*-\s*dec|jan\s*-\s*mar/.test(x); })) return "quarter";
  if (t.some(function (x) { return MONTHS.some(function (m) { return x === m || x.indexOf(m + " ") === 0; }); })) return "month";
  return null;
}
var QUARTER_RE = [null, /quarter\s*-?\s*1\b|\bq1\b|apr\s*-\s*jun/, /quarter\s*-?\s*2\b|\bq2\b|jul\s*-\s*sep/, /quarter\s*-?\s*3\b|\bq3\b|oct\s*-\s*dec/, /quarter\s*-?\s*4\b|\bq4\b|jan\s*-\s*mar/];
function returnNames(t) {
  var m = String(t).match(/gstr\s*-?\s*[1-9][ab]?/g) || [], out = [];
  for (var i = 0; i < m.length; i++) {
    var name = m[i].replace(/[\s-]/g, "");
    if (out.indexOf(name) < 0) out.push(name);
  }
  return out;
}
function pickIndex(kind, opts, info) {
  var t = opts.map(norm);
  for (var i = 0; i < t.length; i++) {
    var x = t[i], compact = x.replace(/\s/g, "");
    if (kind === "fy" && (compact === info.fy || compact === info.fyLong)) return i;
    if (kind === "quarter" && QUARTER_RE[info.quarter].test(x)) return i;
    if (kind === "month" && (x === info.monthName || x === info.monthName + " " + info.year || x.indexOf(info.monthName + " ") === 0)) return i;
  }
  return -1;
}
`;

export const MAIN_SRC = String.raw`
var DASHBOARD = "https://return.gst.gov.in/returns/auth/dashboard";
function toast(msg, kind) {
  var id = "__gst2b_helper", el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div"); el.id = id; el.title = "Click to dismiss";
    el.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:380px;padding:12px 14px;border-radius:8px;font:14px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);color:#fff;cursor:pointer";
    el.onclick = function () { el.remove(); };
    document.body.appendChild(el);
  }
  el.style.background = kind === "err" ? "#b42318" : kind === "ok" ? "#067647" : "#1d2939";
  el.textContent = "GSTR-2B helper: " + msg;
}
function visible(e) { return !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length)); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function waitFor(fn, ms) { var end = Date.now() + ms; while (Date.now() < end) { var v = fn(); if (v) return v; await sleep(250); } return fn(); }
function byText(sel, re) {
  var els = document.querySelectorAll(sel);
  for (var i = 0; i < els.length; i++) { if (visible(els[i]) && re.test(norm(els[i].textContent || els[i].value))) return els[i]; }
  return null;
}
function optionTexts(s) { return [].map.call(s.options, function (o) { return o.text; }); }
function findSelect(kind) {
  var ss = document.querySelectorAll("select");
  for (var i = 0; i < ss.length; i++) { if (visible(ss[i]) && classify(optionTexts(ss[i])) === kind) return ss[i]; }
  return null;
}
function setSelect(s, idx) {
  s.selectedIndex = idx;
  s.dispatchEvent(new Event("input", { bubbles: true }));
  s.dispatchEvent(new Event("change", { bubbles: true }));
}
function highlight(e) { try { e.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) {} e.style.outline = "3px solid #f79009"; e.style.outlineOffset = "3px"; }
function find2bDownload() {
  var btns = document.querySelectorAll("button, a, input[type=button]");
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i];
    if (!visible(b) || !/^download$/.test(norm(b.textContent || b.value))) continue;
    var a = b.parentElement;
    for (var d = 0; a && d < 8; d++, a = a.parentElement) {
      var names = returnNames(norm(a.textContent));
      if (names.length > 1) break;
      if (names.length === 1) { if (names[0] === "gstr2b") return b; break; }
    }
  }
  return null;
}
async function onDashboard() {
  var p = window.prompt("GSTR-2B for which month? (MM-YYYY)", defaultPeriod(new Date()));
  if (p === null) return;
  var info = periodInfo(p);
  if (!info) { toast("“" + p + "” isn't a valid month. Use MM-YYYY, e.g. 04-2026.", "err"); return; }
  var label = info.monthName.charAt(0).toUpperCase() + info.monthName.slice(1) + " " + info.year;
  toast("Selecting " + label + "…");
  var steps = ["fy", "quarter", "month"];
  for (var k = 0; k < steps.length; k++) {
    var kind = steps[k];
    var s = await waitFor(function () { return findSelect(kind); }, kind === "quarter" ? 2500 : 5000);
    if (!s) {
      if (kind === "quarter") continue;
      toast("Couldn't find the " + (kind === "fy" ? "Financial Year" : "Period") + " dropdown. Select " + label + " yourself and press Search, then Download on the GSTR-2B tile.", "err");
      return;
    }
    var idx = await waitFor(function () { var i = pickIndex(kind, optionTexts(s), info); return i >= 0 ? i + 1 : 0; }, 4000);
    if (!idx) { toast((kind === "fy" ? "Financial year " + info.fy : kind === "quarter" ? "Quarter " + info.quarter : label) + " isn't in the dropdown yet. Select it yourself.", "err"); return; }
    setSelect(s, idx - 1);
    await sleep(500);
  }
  var search = byText("button, input[type=submit], input[type=button]", /^search$/);
  if (!search) { toast(label + " selected. Press Search, then Download on the GSTR-2B tile.", "info"); return; }
  search.click();
  toast("Searching " + label + "…");
  var dl = await waitFor(find2bDownload, 12000);
  if (!dl) { toast("Couldn't spot the GSTR-2B tile. If it's there, click its Download button; if not, GSTR-2B may not be generated for " + label + " yet.", "err"); return; }
  highlight(dl);
  toast("Opening GSTR-2B for " + label + ". On the next page, click this bookmark again to get the Excel file.", "ok");
  await sleep(600);
  dl.click();
}
async function on2bPage() {
  var ready = await waitFor(function () { return byText("a, button", /click here to download|download (excel|the file)/); }, 1500);
  if (ready) { highlight(ready); ready.click(); toast("Downloading. Now upload the file in GST Reconciliation Tracker → Data sources → Upload files.", "ok"); return; }
  var gen = await waitFor(function () { return byText("button, a, input[type=button]", /generate\s+excel/); }, 4000);
  if (gen) { highlight(gen); gen.click(); toast("Asked the portal to prepare the Excel file. When the download link appears, click it (or click this bookmark again).", "ok"); return; }
  toast("On this page, click ‘Generate Excel file to download’, then the download link. Then upload it in the tracker.", "info");
}
try {
  var host = location.hostname;
  if (!/(^|\.)gst\.gov\.in$/.test(host)) { toast("Open the GST portal (gst.gov.in), log in yourself, then click this bookmark.", "err"); }
  else if ([].some.call(document.querySelectorAll("input[type=password]"), visible) || /login/i.test(location.pathname)) { toast("Log in to the portal yourself first (password + captcha). Then click this bookmark again.", "info"); }
  else if (/2b/i.test(host + location.pathname + location.hash) || byText("button, a", /generate\s+(excel|json)/)) { on2bPage(); }
  else if (host === "return.gst.gov.in" && /dashboard/i.test(location.pathname + location.hash)) { onDashboard(); }
  else { toast("Opening your Returns Dashboard… click this bookmark again once it loads."); location.href = DASHBOARD; }
} catch (e) { toast("Something went wrong (" + (e && e.message) + "). Continue manually: Returns Dashboard → GSTR-2B → Download.", "err"); }
`;

/** Chrome strips newlines from URLs, so collapse them (the sources never rely on ASI). */
const oneLine = (s: string) => s.replace(/\n\s*/g, " ").trim();

export function buildBookmarklet(): string {
  return "javascript:" + encodeURIComponent(`void (function(){${oneLine(HELPERS_SRC)} ${oneLine(MAIN_SRC)}})();`);
}
