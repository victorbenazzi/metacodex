(function () {
  if (window.__mcxInstalled) return;
  window.__mcxInstalled = true;

  var state = { mode: "browse" };
  var bridgeToken = "__MCX_BRIDGE_TOKEN__";
  var nativeOpen = window.open.bind(window);
  var pendingPick = null;
  var highlight = null;
  var canvas = null;
  var ctx = null;
  var drawing = false;
  var strokes = [];
  var currentStroke = null;
  var PEN_CURSOR =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M4.2 19.8l1.3-4.4 10.6-10.6 3.1 3.1L8.6 18.5z' fill='%23f54e00'/%3E%3Cpath d='M14.8 5.9l3.3 3.3' stroke='%23141412' stroke-width='1.2'/%3E%3C/svg%3E\") 2 22, crosshair";

  function bridge(path, params) {
    var url = "https://mcx.invalid/" + path;
    url += "?token=" + encodeURIComponent(bridgeToken);
    if (params) url += "&" + params;
    nativeOpen(url, "_blank");
  }

  function host() {
    var el = document.getElementById("__mcx-overlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "__mcx-overlay";
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
    (document.documentElement || document.body).appendChild(el);
    highlight = document.createElement("div");
    highlight.style.cssText =
      "position:absolute;border:1.5px solid #f54e00;background:rgba(245,78,0,0.12);pointer-events:none;display:none;";
    el.appendChild(highlight);
    canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;touch-action:none;";
    el.appendChild(canvas);
    ctx = canvas.getContext("2d");
    redraw();
    return el;
  }

  function sizeCanvas() {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function redraw() {
    host();
    sizeCanvas();
    if (!ctx) return;
    ctx.strokeStyle = "#f54e00";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (var s = 0; s < strokes.length; s++) {
      var pts = strokes[s];
      if (!pts.length) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + CSS.escape(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var sel = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      if (node.classList && node.classList.length) {
        var cls = Array.prototype.slice.call(node.classList, 0, 2)
          .map(function (c) { return CSS.escape(c); })
          .join(".");
        if (cls) sel += "." + cls;
      }
      var parent = node.parentElement;
      if (parent) {
        var same = 0;
        var idx = 0;
        for (var i = 0; i < parent.children.length; i++) {
          var child = parent.children[i];
          if (child.tagName === node.tagName) {
            same += 1;
            if (child === node) idx = same;
          }
        }
        if (same > 1) sel += ":nth-of-type(" + idx + ")";
      }
      parts.unshift(sel);
      node = parent;
    }
    return parts.join(" > ");
  }

  function reactInfo(el) {
    var key = Object.keys(el).find(function (k) {
      return k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0;
    });
    if (!key) return null;
    var fiber = el[key];
    for (var i = 0; i < 14 && fiber; i++, fiber = fiber.return) {
      var type = fiber.type;
      var name = typeof type === "string"
        ? null
        : (type && (type.displayName || type.name)) || null;
      if (name && name[0] >= "A" && name[0] <= "Z") {
        var src = fiber._debugSource;
        return {
          component: name,
          file: src && src.fileName ? String(src.fileName) : null,
          line: src && src.lineNumber ? src.lineNumber : null,
        };
      }
    }
    return null;
  }

  function targetFromPoint(x, y) {
    var list = document.elementsFromPoint(x, y) || [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.id === "__mcx-overlay" || (el.closest && el.closest("#__mcx-overlay"))) continue;
      if (el === document.documentElement || el === document.body) continue;
      return el;
    }
    return null;
  }

  function syncOverlay() {
    if (state.mode === "browse") {
      var existing = document.getElementById("__mcx-overlay");
      if (existing) existing.style.display = "none";
      return;
    }
    host();
    var overlay = document.getElementById("__mcx-overlay");
    overlay.style.display = "block";
    overlay.style.pointerEvents = "none";
    overlay.style.cursor =
      state.mode === "draw" ? PEN_CURSOR : state.mode === "pick" ? "crosshair" : "auto";
    if (canvas) {
      canvas.style.pointerEvents = state.mode === "draw" ? "auto" : "none";
      canvas.style.cursor = state.mode === "draw" ? PEN_CURSOR : "default";
    }
    if (highlight) highlight.style.display = state.mode === "pick" ? "block" : "none";
    if (state.mode !== "pick" && highlight) highlight.style.display = "none";
    document.documentElement.style.cursor =
      state.mode === "draw" ? PEN_CURSOR : state.mode === "pick" ? "crosshair" : "";
  }

  function onMove(e) {
    if (state.mode !== "pick" || !highlight) return;
    var el = targetFromPoint(e.clientX, e.clientY);
    if (!el) {
      highlight.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.left = r.left + "px";
    highlight.style.top = r.top + "px";
    highlight.style.width = r.width + "px";
    highlight.style.height = r.height + "px";
  }

  function collectPick(el) {
    var r = el.getBoundingClientRect();
    var styles = window.getComputedStyle(el);
    var react = reactInfo(el);
    return {
      url: location.href,
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      text: (el.innerText || "").trim().slice(0, 240),
      html: (el.outerHTML || "").slice(0, 1800),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      styles: {
        display: styles.display,
        color: styles.color,
        backgroundColor: styles.backgroundColor,
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
      },
      component: react ? react.component : null,
      file: react ? react.file : null,
      line: react ? react.line : null,
    };
  }

  function onClick(e) {
    if (!e.isTrusted || state.mode !== "pick") return;
    e.preventDefault();
    e.stopPropagation();
    var el = targetFromPoint(e.clientX, e.clientY);
    if (!el) return;
    pendingPick = collectPick(el);
    bridge("selection");
  }

  function onDown(e) {
    if (state.mode !== "draw" || !ctx) return;
    e.preventDefault();
    drawing = true;
    currentStroke = [{ x: e.clientX, y: e.clientY }];
    strokes.push(currentStroke);
    ctx.strokeStyle = "#f54e00";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(e.clientX, e.clientY);
  }

  function onDrag(e) {
    if (!drawing || !ctx || !currentStroke) return;
    currentStroke.push({ x: e.clientX, y: e.clientY });
    ctx.lineTo(e.clientX, e.clientY);
    ctx.stroke();
  }

  function onUp() {
    drawing = false;
    currentStroke = null;
  }

  function onKey(e) {
    if (e.isTrusted && e.key === "Escape" && state.mode !== "browse") {
      e.preventDefault();
      e.stopPropagation();
      state.mode = "browse";
      drawing = false;
      strokes = [];
      syncOverlay();
      document.documentElement.style.cursor = "";
      bridge("escape");
    }
  }

  window.addEventListener("resize", redraw, true);
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onDrag, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("keydown", onKey, true);

  var lastLocationSnapshot = "";

  function emitLocation(loading) {
    var href = location.href || "";
    if (!href || href.indexOf("mcx.invalid") !== -1) return;
    if (href === "about:blank" || href.indexOf("about:") === 0) return;
    var title = document.title || "";
    var snapshot = href + "\n" + title + "\n" + (loading ? "1" : "0");
    if (snapshot === lastLocationSnapshot) return;
    lastLocationSnapshot = snapshot;
    bridge(
      "location",
      "url=" + encodeURIComponent(href) +
        "&title=" + encodeURIComponent(title) +
        "&loading=" + (loading ? "1" : "0")
    );
  }

  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      emitLocation(false);
      return result;
    };
  });
  window.addEventListener("popstate", function () { emitLocation(false); });
  window.addEventListener("hashchange", function () { emitLocation(false); });
  document.addEventListener("DOMContentLoaded", function () { emitLocation(true); });
  window.addEventListener("load", function () { emitLocation(false); });
  if (document.readyState === "complete") emitLocation(false);
  else if (document.readyState === "interactive") emitLocation(true);

  window.__mcx = {
    setMode: function (mode) {
      state.mode = mode === "pick" || mode === "draw" ? mode : "browse";
      if (state.mode !== "draw") {
        drawing = false;
        strokes = [];
      }
      if (state.mode === "browse") document.documentElement.style.cursor = "";
      syncOverlay();
      if (state.mode === "draw") redraw();
    },
    takePick: function () {
      var pick = pendingPick;
      pendingPick = null;
      return pick;
    },
    clearDraw: function () {
      strokes = [];
      redraw();
    },
  };
})();
