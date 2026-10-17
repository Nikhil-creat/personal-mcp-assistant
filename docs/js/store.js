const DB_KEY = "mcp.assistant.v1", SET_KEY = "mcp.assistant.settings";
const empty = () => ({ notes: [], events: [], docs: [], memories: [], audit: [] });
let db = empty();
try { db = { ...empty(), ...JSON.parse(localStorage.getItem(DB_KEY) || "{}") }; } catch { db = empty(); }

export const data = () => db;
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export function save() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  catch { document.dispatchEvent(new CustomEvent("toast", { detail: "Storage full — export and clear old data" })); }
  document.dispatchEvent(new Event("datachanged"));
}
export function wipe() { db = empty(); save(); }

const defaults = { groqKey: "", model: "llama-3.3-70b-versatile", tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata", api: "" };
export const settings = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(SET_KEY) || "{}") }; } catch { return { ...defaults }; } };
export const saveSettings = (s) => localStorage.setItem(SET_KEY, JSON.stringify({ ...settings(), ...s }));

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function tzOffset(tz) {
  try {
    const v = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName").value;
    if (v === "GMT") return "+00:00";
    return v.replace("GMT", "").replace(/^([+-])(\d):/, "$10$2:");
  } catch { return "+00:00"; }
}
export const fmt = (iso) => { try { return new Date(iso).toLocaleString("en-IN", { timeZone: settings().tz, dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } };
