// Nudge Preview — Supertails. Buzz shows .html attachments as code; this plugin plays them.
//
// Buzz's CSP is `script-src 'self' blob:` and a frame inherits it, so a nudge's inline <script>
// never runs in a plain iframe. The plugin rewrites the file: every inline script and inline
// on* handler becomes a blob: script (allowed by that CSP), then the result plays in a same-origin
// iframe at phone size. Same-origin means the nudge runs with Buzz's access, so previews are only
// offered for files sent by TRUSTED people (Jermy + the Supertails Buzz bots). CleverTap / iOS bridge
// calls are stubbed and listed under the phone; nothing is sent.
export const inject = ["react", "panels", "conversation"];

// pubkeys whose .html attachments may be previewed (Jermy, Nudge Builder, Comms Orchestrator, Designer)
const TRUSTED = new Set([
  "12e99c820ac913b04092c72564d52c16125171caf061a8c432fddb4e3fa42a32",
  "286f9af3d3bf6365209a0b18f5f818f7061644302bd9cda355aea11ffcb48398",
  "c7e97c5c0b12855cbdee79bcad7c0e3c70bbec3d75b28d09070e3c937837f6af",
  "51c081783b2a603bcb0b2911255a8eed62c889d398d4a08662f86a24d0c5bae9",
]);
const SCHEME = "supertails-nudge:";
const PHONE_W = 390, PHONE_H = 844;

const isHtml = (a) =>
  a && a.kind === "file" &&
  (/\.html?$/i.test(a.name || "") || /^text\/html\b/i.test(a.mime || ""));
const trusted = (m) => !!m && TRUSTED.has(m.authorId) && (!m.signerId || TRUSTED.has(m.signerId));

const toTarget = (source, name) =>
  SCHEME + encodeURIComponent(JSON.stringify({ s: source, n: name || "nudge.html" }));
function fromTarget(t) {
  if (typeof t !== "string" || !t.startsWith(SCHEME)) return null;
  try {
    const v = JSON.parse(decodeURIComponent(t.slice(SCHEME.length)));
    return v && typeof v.s === "string" ? v : null;
  } catch (e) { return null; }
}

// BEGIN-BUILD (kept self-contained: the test harness extracts this block)
const STUB_JS = `(function(){
  function post(kind, name, args){ var a; try{ a = JSON.parse(JSON.stringify(Array.prototype.slice.call(args||[]))); }catch(e){ a = [String(args && args[0])]; }
    try{ parent.postMessage({__nudgePreview:1, kind:kind, name:String(name), args:a}, "*"); }catch(e){} }
  window.CleverTap = new Proxy({}, { get: function(_, k){ return function(){ post("clevertap", k, arguments); }; } });
  var handler = function(n){ return { postMessage: function(m){ post("webkit", n, [m]); } }; };
  window.webkit = { messageHandlers: new Proxy({}, { get: function(_, k){ return handler(k); } }) };
  window.open = function(u){ post("open", "window.open", [u]); return null; };
  document.addEventListener("click", function(e){ var a = e.target && e.target.closest && e.target.closest("a[href]"); if(a){ e.preventDefault(); post("open", "link", [a.getAttribute("href")]); } }, true);
})();`;

// Returns { html, urls }: inline scripts and on* attributes moved into blob: scripts.
function buildDoc(html) {
  const urls = [];
  const blob = (code) => { const u = URL.createObjectURL(new Blob([code], { type: "text/javascript" })); urls.push(u); return u; };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const handlers = [];
  let n = 0;
  doc.querySelectorAll("*").forEach((el) => {
    for (const at of Array.from(el.attributes)) {
      if (/^on[a-z]+$/i.test(at.name) && at.value.trim()) {
        const id = "np" + (n++);
        el.setAttribute("data-np", id);
        handlers.push("(function(){var el=document.querySelector('[data-np=\"" + id + "\"]');if(el)el.addEventListener(" +
          JSON.stringify(at.name.slice(2).toLowerCase()) + ",function(event){" + at.value + "\n}.bind(el));})();");
        el.removeAttribute(at.name);
      }
    }
  });
  doc.querySelectorAll("script").forEach((s) => {
    const type = (s.getAttribute("type") || "").trim().toLowerCase();
    if (s.src || (type && !/javascript|ecmascript|^module$/.test(type))) return;
    const r = doc.createElement("script");
    for (const at of Array.from(s.attributes)) r.setAttribute(at.name, at.value);
    r.setAttribute("src", blob(s.textContent || ""));
    s.replaceWith(r);
  });
  const head = doc.head || doc.documentElement;
  const stub = doc.createElement("script");
  stub.setAttribute("src", blob(STUB_JS));
  head.insertBefore(stub, head.firstChild);
  if (handlers.length) {
    const hs = doc.createElement("script");
    hs.setAttribute("src", blob(handlers.join("\n")));
    (doc.body || doc.documentElement).appendChild(hs);
  }
  return { html: "<!doctype html>\n" + doc.documentElement.outerHTML, urls };
}
// END-BUILD

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const { useState, useEffect, useRef, useCallback } = React;

  function summarize(ev) {
    const a = ev.args || [];
    if (ev.kind === "clevertap") {
      if (/^pushEvent$/i.test(ev.name)) return { title: String(a[0]), props: a[1] };
      return { title: "CleverTap." + ev.name, props: a.length ? a : undefined };
    }
    if (ev.kind === "webkit") {
      const m = a[0];
      if (m && typeof m === "object" && m.action === "recordEventWithProps") return { title: String(m.event), props: m.properties || m.props };
      if (m && typeof m === "object" && m.action) return { title: "iOS " + ev.name + ": " + m.action, props: m };
      return { title: "iOS " + ev.name, props: m };
    }
    return { title: ev.name, props: a[0] };
  }

  function Preview({ target }) {
    const info = fromTarget(target);
    if (typeof ctx.panels.useTabTitle === "function") ctx.panels.useTabTitle(info ? info.n : "Nudge Preview");
    const [raw, setRaw] = useState(null);
    const [built, setBuilt] = useState(null);
    const [err, setErr] = useState(null);
    const [run, setRun] = useState(0);
    const [events, setEvents] = useState([]);
    const [closed, setClosed] = useState(false);
    const [scale, setScale] = useState(0.8);
    const box = useRef(null), frame = useRef(null);

    useEffect(() => {
      if (!info) return;
      let live = true;
      setRaw(null); setErr(null);
      fetch(info.s).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then((t) => { if (live) setRaw(t); })
        .catch((e) => { if (live) setErr(String((e && e.message) || e)); });
      return () => { live = false; };
    }, [target]);

    // fresh blob scripts for every run (Replay), revoked when replaced
    useEffect(() => {
      if (raw == null) return;
      let b;
      try { b = buildDoc(raw); setBuilt(b.html); } catch (e) { setErr("Could not prepare the file: " + e.message); }
      return () => { if (b) b.urls.forEach((u) => URL.revokeObjectURL(u)); };
    }, [raw, run]);

    useEffect(() => {
      const on = (e) => {
        const d = e.data;
        if (!d || !d.__nudgePreview || !frame.current || e.source !== frame.current.contentWindow) return;
        if (d.kind === "clevertap" && /dismissInApp|closeInApp|close/i.test(d.name)) setClosed(true);
        if (d.kind === "webkit" && d.args && d.args[0] && /dismiss|close/i.test(String(d.args[0].action || ""))) setClosed(true);
        if (d.kind === "webkit" && d.name === "haptic") return;
        const ev = { t: new Date(), ...summarize(d) };
        // nudges fire the same event on the Android and the iOS bridge: list it once
        setEvents((x) => (x[0] && x[0].title === ev.title && ev.t - x[0].t < 400) ? x : [ev, ...x].slice(0, 50));
      };
      window.addEventListener("message", on);
      return () => window.removeEventListener("message", on);
    }, []);

    useEffect(() => {
      const el = box.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => {
        const w = el.clientWidth - 24;
        const hgt = Math.max(420, window.innerHeight - 260);
        setScale(Math.max(0.4, Math.min(1, w / PHONE_W, hgt / PHONE_H)));
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const replay = useCallback(() => { setClosed(false); setEvents([]); setBuilt(null); setRun((n) => n + 1); }, []);

    const btn = (label, onClick) => h("button", {
      onClick, style: { font: "inherit", fontSize: 12, padding: "5px 12px", borderRadius: 999, cursor: "pointer",
        border: "1px solid var(--border, rgba(128,128,128,.35))", background: "transparent", color: "inherit" } }, label);

    if (!info) return h("div", { style: { padding: 16 } }, "Not a nudge file.");
    return h("div", { ref: box, style: { display: "flex", flexDirection: "column", gap: 10, padding: 12, height: "100%", overflow: "auto", boxSizing: "border-box" } },
      h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
        h("div", { style: { fontSize: 12, opacity: .7, flex: 1 } }, "390 × 844 · CleverTap calls are captured, not sent"),
        btn("Replay", replay)),
      h("div", { style: { width: PHONE_W * scale, height: PHONE_H * scale, margin: "0 auto", flex: "none", position: "relative",
          borderRadius: 28 * scale + 8, overflow: "hidden", boxShadow: "0 0 0 6px #111, 0 10px 30px rgba(0,0,0,.35)",
          background: "linear-gradient(#f4f5f7 0 12%, #e6e8ec 12% 100%)" } },
        err ? h("div", { style: { padding: 20, color: "#b42318", fontSize: 13 } }, "Could not load the file: " + err)
          : !built ? h("div", { style: { padding: 20, fontSize: 13, color: "#555" } }, "Loading…")
          : h("iframe", {
              key: run, ref: frame, srcDoc: built, title: info.n,
              style: { width: PHONE_W, height: PHONE_H, border: 0, transform: "scale(" + scale + ")", transformOrigin: "0 0",
                position: "absolute", left: 0, top: 0, background: "transparent", visibility: closed ? "hidden" : "visible" } }),
        closed ? h("div", { style: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 10,
            alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13 } },
          "Nudge dismissed", btn("Replay", replay)) : null),
      h("div", { style: { fontSize: 12, fontWeight: 600, marginTop: 4 } }, "Events (" + events.length + ")"),
      events.length === 0 ? h("div", { style: { fontSize: 12, opacity: .6 } }, "Tap the nudge; events show here.")
        : h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
            events.map((e, i) => h("details", { key: events.length - i, style: { fontSize: 12, border: "1px solid rgba(128,128,128,.25)", borderRadius: 8, padding: "6px 8px" } },
              h("summary", { style: { cursor: "pointer" } }, e.t.toLocaleTimeString() + "  " + e.title),
              e.props !== undefined ? h("pre", { style: { margin: "6px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, opacity: .85 } },
                JSON.stringify(e.props, null, 2)) : null))));
  }

  ctx.panels.register({
    id: "nudge-preview",
    title: "Nudge Preview",
    order: -10,
    matches: (t) => fromTarget(t) !== null,
    component: Preview,
  });

  // matches() only sees the attachment, not the sender: trust is decided inside the component
  ctx.conversation.registerAttachment({
    id: "nudge-html-card",
    title: "Nudge Preview",
    order: -10,
    matches: isHtml,
    component: function NudgeCard({ attachment, source, placement, message, FileCard, open }) {
      const ok = trusted(message) && !!source && placement === "message";
      const preview = () => { if (ok) void open(toTarget(source, attachment.name)); };
      if (FileCard) {
        return h(FileCard, {
          attachment, source, onOpenLink: open,
          typeLabel: ok ? "Nudge · tap to play" : "HTML · preview only for files from Jermy or the bots",
          ...(ok ? { onPreview: preview } : {}),
        });
      }
      return ok ? h("button", { onClick: preview, style: { font: "inherit", padding: "8px 12px", borderRadius: 10, cursor: "pointer" } },
        "▶ Play " + (attachment.name || "nudge")) : null;
    },
  });
}
