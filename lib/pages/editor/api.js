// lib/pages/editor/api.js
import { authHeaders } from "./auth-bridge.js";

export async function apiGet(url) {
  const sep = url.includes("?") ? "&" : "?";
  const bust = `${sep}ts=${Date.now()}`;
  const r = await fetch(url + bust, { headers: authHeaders(), cache: "no-store" });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) throw new Error((j && j.error) || r.statusText || ("GET " + url + " failed"));
  return j;
}

export async function apiSend(url, method, body) {
  const r = await fetch(url, {
    method,
    headers: authHeaders({ "content-type": "application/json" }),
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) throw new Error((j && j.error) || r.statusText || (method + " " + url + " failed"));
  return j;
}

export function asItem(resp) {
  if (!resp) return null;
  if (resp.item) return resp.item;
  if (resp.updated) return resp.updated;
  if (resp.created && Array.isArray(resp.created) && resp.created[0]) return resp.created[0];
  return resp;
}
