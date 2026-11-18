// Nudge Preview — Supertails. Buzz shows .html attachments as code; this plugin plays them.
// Clicking an .html file card opens a side panel with the file running in a sandboxed iframe
// at phone size (390x844), over an app-grey backdrop. CleverTap / webkit bridge calls are
// stubbed: they are listed in the panel (event name + properties), never sent anywhere.
export const inject = ["react", "panels", "conversation"];

const SCHEME = "supertails-nudge:";
const PHONE_W = 390, PHONE_H = 844;

const isHtml = (a) =>
  a && a.kind === "file" &&
  (/\.html?$/i.test(a.name || "") || /^text\/html\b/i.test(a.mime || ""));

const toTarget = (source, name) =>
  SCHEME + encodeURIComponent(JSON.stringify({ s: source, n: name || "nudge.html" }));
function fromTarget(t) {
  if (typeof t !== "string" || !t.startsWith(SCHEME)) return null;
  try {
    const v = JSON.parse(decodeURIComponent(t.slice(SCHEME.length)));
    return v && typeof v.s === "string" ? v : null;
  } catch (e) { return null; }
}

// Runs inside the iframe before the nudge's own scripts.
const STUB = `<script>(function(){
  function post(kind, name, args){ try{ parent.postMessage({__nudgePreview:1, kind:kind, name:String(name), args:JSON.parse(JSON.stringify(Array.prototype.slice.call(args||[])))}, "*"); }catch(e){ try{ parent.postMessage({__nudgePreview:1, kind:kind, name:String(name), args:[String(args&&args[0])]}, "*"); }catch(_){} } }
  var ct = new Proxy({}, { get: function(_, k){ return function(){ post("clevertap", k, arguments); }; } });
  window.CleverTap = ct;
  var handler = function(n){ return { postMessage: function(m){ post("webkit", n, [m]); } }; };
  window.webkit = { messageHandlers: new Proxy({}, { get: function(_, k){ return handler(k); } }) };
  window.open = function(u){ post("open", "window.open", [u]); return null; };
  document.addEventListener("click", function(e){ var a = e.target && e.target.closest && e.target.closest("a[href]"); if(a){ e.preventDefault(); post("open", "link", [a.getAttribute("href")]); } }, true);
})();<\/script>`;

function withStub(html) {
  const m = /<head[^>]*>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + STUB + html.slice(m.index + m[0].length);
  return STUB + html;
}

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
    const [html, setHtml] = useState(null);
    const [err, setErr] = useState(null);
    const [run, setRun] = useState(0);
    const [events, setEvents] = useState([]);
    const [closed, setClosed] = useState(false);
    const [scale, setScale] = useState(0.8);
    const box = useRef(null), frame = useRef(null);

    useEffect(() => {
      if (!info) return;
      let live = true;
      setHtml(null); setErr(null);
      fetch(info.s).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then((t) => { if (live) setHtml(withStub(t)); })
        .catch((e) => { if (live) setErr(String((e && e.message) || e)); });
      return () => { live = false; };
    }, [target]);

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

    const replay = useCallback(() => { setClosed(false); setEvents([]); setRun((n) => n + 1); }, []);

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
          : !html ? h("div", { style: { padding: 20, fontSize: 13, color: "#555" } }, "Loading…")
          : h("iframe", {
              key: run, ref: frame, srcDoc: html, title: info.n,
              sandbox: "allow-scripts allow-forms allow-pointer-lock",
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

  ctx.conversation.registerAttachment({
    id: "nudge-html",
    title: "Nudge Preview",
    order: -10,
    matches: isHtml,
    component: function NudgeCard({ attachment, source, placement, FileCard, open }) {
      const preview = () => { if (source) void open(toTarget(source, attachment.name)); };
      if (FileCard) {
        return h(FileCard, {
          attachment, source, onOpenLink: open, typeLabel: "Nudge · tap to preview",
          ...(placement === "message" && source ? { onPreview: preview } : {}),
        });
      }
      return h("button", { onClick: preview, style: { font: "inherit", padding: "8px 12px", borderRadius: 10, cursor: "pointer" } },
        "▶ Preview " + (attachment.name || "nudge"));
    },
  });
}
