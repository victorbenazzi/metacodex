(function () {
  if (window.__mcxInstalled) return;
  window.__mcxInstalled = true;

  var state = { mode: "browse", readyMode: "browse", captureBarrier: null };
  var bridgeToken = "__MCX_BRIDGE_TOKEN__";
  var nativeOpen = window.open.bind(window);
  var nativeEncode = encodeURIComponent;
  var nativeCharCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt);
  var nativeStringSlice = Function.prototype.call.bind(String.prototype.slice);
  var nativeRaf = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : function (callback) { return setTimeout(callback, 16); };
  var nativeSetTimeout = window.setTimeout.bind(window);
  var nativeClearTimeout = window.clearTimeout.bind(window);
  var highlight = null;
  var highlightLabel = null;
  var captureBox = null;
  var canvas = null;
  var ctx = null;
  var drawing = false;
  var strokes = [];
  var currentStroke = null;
  var captureStart = null;
  var suppressNextClick = false;
  var hoverBase = null;
  var hoverTarget = null;
  var targetDepth = 0;

  function bridge(path, params) {
    var url = "https://mcx.invalid/" + path;
    url += "?token=" + bridgeToken;
    if (params) url += "&" + params;
    nativeOpen(url, "_blank");
  }

  function encodeFields(fields) {
    return Object.keys(fields)
      .filter(function (key) { return fields[key] !== null && fields[key] !== undefined; })
      .map(function (key) {
        return nativeEncode(key) + "=" + nativeEncode(String(fields[key]));
      })
      .join("&");
  }

  function utf8Prefix(value, maxBytes) {
    var bytes = 0;
    var end = 0;
    while (end < value.length) {
      var code = nativeCharCodeAt(value, end);
      var size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
      var units = 1;
      if (code >= 0xd800 && code <= 0xdbff && end + 1 < value.length) {
        var next = nativeCharCodeAt(value, end + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          size = 4;
          units = 2;
        }
      }
      if (bytes + size > maxBytes) break;
      bytes += size;
      end += units;
    }
    return nativeStringSlice(value, 0, end);
  }

  function afterVisualFrame(callback) {
    var finished = false;
    var timer = nativeSetTimeout(run, 50);
    function run() {
      if (finished) return;
      finished = true;
      nativeClearTimeout(timer);
      callback();
    }
    nativeRaf(run);
  }

  function selectionFields(pick) {
    return encodeFields({
      kind: pick.kind,
      url: pick.url,
      selector: pick.selector,
      tag: pick.tag,
      id: pick.id,
      classes: JSON.stringify(pick.classes),
      text: pick.text,
      x: pick.rect.x,
      y: pick.rect.y,
      width: pick.rect.width,
      height: pick.rect.height,
      component: pick.component,
      file: pick.file,
      line: pick.line,
      fullPath: pick.fullPath,
      accessibility: pick.accessibility,
      styles: pick.styles,
      viewportWidth: pick.viewport.width,
      viewportHeight: pick.viewport.height,
      dpr: pick.viewport.dpr,
    });
  }

  function host() {
    var el = document.getElementById("__mcx-overlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "__mcx-overlay";
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
    (document.documentElement || document.body).appendChild(el);
    var cursorStyle = document.getElementById("__mcx-cursor-style");
    if (!cursorStyle) {
      cursorStyle = document.createElement("style");
      cursorStyle.id = "__mcx-cursor-style";
      cursorStyle.textContent =
        "html.__mcx-crosshair,html.__mcx-crosshair *{cursor:crosshair!important;}";
      (document.head || document.documentElement).appendChild(cursorStyle);
    }
    highlight = document.createElement("div");
    highlight.style.cssText =
      "position:absolute;border:1.5px solid #f54e00;background:rgba(245,78,0,0.12);pointer-events:none;display:none;";
    el.appendChild(highlight);
    highlightLabel = document.createElement("div");
    highlightLabel.style.cssText =
      "position:absolute;max-width:calc(100vw - 16px);padding:3px 6px;border-radius:3px;background:#f54e00;color:white;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;display:none;";
    el.appendChild(highlightLabel);
    captureBox = document.createElement("div");
    captureBox.style.cssText =
      "position:absolute;border:1.5px solid #f54e00;background:rgba(245,78,0,0.10);pointer-events:none;display:none;";
    el.appendChild(captureBox);
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

  function classTokens(el) {
    if (!el.classList) return [];
    return Array.prototype.slice.call(el.classList, 0, 3)
      .map(function (name) { return shortIdentifier(name, 48); })
      .filter(function (name) { return Boolean(name); });
  }

  function shortIdentifier(value, max) {
    if (!value) return "";
    var text = String(value);
    if (text.length > max) return "";
    return text;
  }

  function parentAcrossShadow(el) {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    var root = el.getRootNode && el.getRootNode();
    return root && root.host ? root.host : null;
  }

  function deepElementFromPoint(x, y) {
    var element = document.elementFromPoint(x, y);
    if (!element) return null;
    while (element.shadowRoot && element.shadowRoot.elementFromPoint) {
      var deeper = element.shadowRoot.elementFromPoint(x, y);
      if (!deeper || deeper === element) break;
      element = deeper;
    }
    if (element.id === "__mcx-overlay" || (element.closest && element.closest("#__mcx-overlay"))) {
      return null;
    }
    if (element === document.documentElement || element === document.body) return null;
    return element;
  }

  function targetAtDepth(base, depth) {
    var target = base;
    for (var i = 0; i < depth && target; i++) {
      var parent = parentAcrossShadow(target);
      if (!parent || parent === document.body || parent === document.documentElement) break;
      target = parent;
    }
    return target;
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    var id = shortIdentifier(el.id, 64);
    if (id) return "#" + CSS.escape(id);
    var testId = el.getAttribute && el.getAttribute("data-testid");
    testId = shortIdentifier(testId, 96);
    if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 3) {
      var sel = node.tagName.toLowerCase();
      var nodeId = shortIdentifier(node.id, 64);
      if (nodeId) {
        parts.unshift("#" + CSS.escape(nodeId));
        break;
      }
      var tokens = classTokens(node);
      if (tokens.length) {
        var cls = tokens.slice(0, 2)
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

  function fullElementPath(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      if (node === document.documentElement) {
        parts.unshift("html");
        break;
      }
      var part = node.tagName.toLowerCase();
      var nodeId = shortIdentifier(node.id, 64);
      if (nodeId) {
        part += "#" + CSS.escape(nodeId);
      } else {
        var tokens = classTokens(node);
        if (tokens.length) part += "." + CSS.escape(tokens[0]);
      }
      parts.unshift(part);
      node = parentAcrossShadow(node);
    }
    return parts.join(" > ");
  }

  var TEXT_TAGS = {
    h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
    p: true, span: true, a: true, button: true, label: true, li: true,
    strong: true, em: true, small: true, blockquote: true, figcaption: true,
    caption: true, th: true, td: true, dt: true, dd: true, code: true, pre: true,
  };

  function isTextTarget(tag) {
    return Boolean(TEXT_TAGS[tag]);
  }

  function directText(el, tag) {
    if (!TEXT_TAGS[tag]) return null;
    var value = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return value ? value.slice(0, 240) : null;
  }

  function selectedTextForTarget(el, tag) {
    if (!isTextTarget(tag)) return null;
    var selection = window.getSelection && window.getSelection();
    var value = selection ? selection.toString().replace(/\s+/g, " ").trim() : "";
    if (value && selection.anchorNode && el.contains(selection.anchorNode)) {
      return value.slice(0, 240);
    }
    return directText(el, tag);
  }

  function accessibilityInfo(el) {
    var attrs = ["role", "aria-label", "aria-labelledby", "aria-describedby", "alt", "title"];
    var parts = [];
    for (var i = 0; i < attrs.length; i++) {
      var value = el.getAttribute && el.getAttribute(attrs[i]);
      if (value) parts.push(attrs[i] + "=" + value.replace(/\s+/g, " ").slice(0, 80));
    }
    return parts.length ? parts.join(" ") : null;
  }

  function diagnosticStyles(el, tag) {
    var computed = window.getComputedStyle(el);
    var props = isTextTarget(tag)
      ? ["color", "font-size", "font-weight", "font-family", "line-height", "text-align"]
      : ["display", "position", "width", "height", "padding", "margin", "gap", "background-color"];
    var parts = [];
    for (var i = 0; i < props.length; i++) {
      var value = computed.getPropertyValue(props[i]);
      if (!value || value === "normal" || value === "none" || value === "0px" || value === "auto") continue;
      parts.push(props[i] + ":" + value.trim());
    }
    return parts.length ? parts.join("; ") : null;
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

  function renderHighlight() {
    if (!highlight || !highlightLabel || !hoverBase) return;
    var el = targetAtDepth(hoverBase, targetDepth);
    if (!el) return;
    hoverTarget = el;
    var r = el.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.left = r.left + "px";
    highlight.style.top = r.top + "px";
    highlight.style.width = r.width + "px";
    highlight.style.height = r.height + "px";
    highlightLabel.textContent = cssPath(el);
    highlightLabel.style.display = "block";
    highlightLabel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 220)) + "px";
    highlightLabel.style.top = (r.top >= 26 ? r.top - 24 : Math.min(window.innerHeight - 22, r.bottom + 3)) + "px";
  }

  function syncOverlay() {
    if (state.mode === "browse") {
      var existing = document.getElementById("__mcx-overlay");
      if (existing) existing.style.display = "none";
      hoverBase = null;
      hoverTarget = null;
      targetDepth = 0;
      document.documentElement.classList.remove("__mcx-crosshair");
      document.documentElement.style.removeProperty("cursor");
      return;
    }
    host();
    var overlay = document.getElementById("__mcx-overlay");
    overlay.style.display = "block";
    overlay.style.pointerEvents = state.mode === "capture" ? "auto" : "none";
    overlay.style.setProperty("cursor", "crosshair", "important");
    if (canvas) {
      canvas.style.pointerEvents = state.mode === "draw" ? "auto" : "none";
      canvas.style.setProperty(
        "cursor",
        state.mode === "draw" ? "crosshair" : "default",
        "important"
      );
    }
    if (highlight) highlight.style.display = state.mode === "pick" ? "block" : "none";
    if (highlightLabel) highlightLabel.style.display = state.mode === "pick" && hoverTarget ? "block" : "none";
    if (state.mode !== "pick" && highlight) highlight.style.display = "none";
    if (state.mode !== "capture" && captureBox) captureBox.style.display = "none";
    document.documentElement.classList.add("__mcx-crosshair");
  }

  function onMove(e) {
    if (state.mode !== "pick" || !highlight) return;
    var el = deepElementFromPoint(e.clientX, e.clientY);
    if (!el) {
      highlight.style.display = "none";
      if (highlightLabel) highlightLabel.style.display = "none";
      hoverBase = null;
      hoverTarget = null;
      return;
    }
    if (hoverBase !== el) {
      hoverBase = el;
      targetDepth = 0;
    }
    renderHighlight();
  }

  function collectPick(el) {
    var r = el.getBoundingClientRect();
    var react = reactInfo(el);
    var tag = el.tagName.toLowerCase();
    return {
      kind: isTextTarget(tag) ? "text" : "element",
      url: utf8Prefix(location.href, 8192),
      selector: cssPath(el),
      tag: tag,
      id: shortIdentifier(el.id, 64) || null,
      classes: classTokens(el),
      text: selectedTextForTarget(el, tag),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      component: react ? react.component : null,
      file: react ? react.file : null,
      line: react ? react.line : null,
      fullPath: fullElementPath(el),
      accessibility: accessibilityInfo(el),
      styles: diagnosticStyles(el, tag),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
    };
  }

  function onClick(e) {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!e.isTrusted || state.mode !== "pick") return;
    e.preventDefault();
    e.stopPropagation();
    var base = deepElementFromPoint(e.clientX, e.clientY);
    if (base && base !== hoverBase) {
      hoverBase = base;
      hoverTarget = null;
      targetDepth = 0;
    }
    var el = hoverTarget || targetAtDepth(hoverBase, targetDepth);
    if (!el) return;
    bridge("selection", selectionFields(collectPick(el)));
  }

  function onDown(e) {
    if (state.mode === "capture") {
      if (!e.isTrusted) return;
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick = true;
      captureStart = { x: e.clientX, y: e.clientY };
      if (captureBox) {
        captureBox.style.display = "block";
        captureBox.style.left = e.clientX + "px";
        captureBox.style.top = e.clientY + "px";
        captureBox.style.width = "0px";
        captureBox.style.height = "0px";
      }
      return;
    }
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
    if (state.mode === "capture" && captureStart && captureBox) {
      e.preventDefault();
      var left = Math.min(captureStart.x, e.clientX);
      var top = Math.min(captureStart.y, e.clientY);
      var width = Math.abs(e.clientX - captureStart.x);
      var height = Math.abs(e.clientY - captureStart.y);
      captureBox.style.left = left + "px";
      captureBox.style.top = top + "px";
      captureBox.style.width = width + "px";
      captureBox.style.height = height + "px";
      return;
    }
    if (!drawing || !ctx || !currentStroke) return;
    currentStroke.push({ x: e.clientX, y: e.clientY });
    ctx.lineTo(e.clientX, e.clientY);
    ctx.stroke();
  }

  function onUp(e) {
    if (state.mode === "capture" && captureStart) {
      if (!e.isTrusted) return;
      e.preventDefault();
      e.stopPropagation();
      var rect = {
        x: Math.min(captureStart.x, e.clientX),
        y: Math.min(captureStart.y, e.clientY),
        width: Math.abs(e.clientX - captureStart.x),
        height: Math.abs(e.clientY - captureStart.y),
      };
      captureStart = null;
      if (rect.width < 8 || rect.height < 8) {
        if (captureBox) captureBox.style.display = "none";
        return;
      }
      nativeRaf(function () {
        nativeRaf(function () {
          bridge("capture", encodeFields(rect));
        });
      });
      return;
    }
    drawing = false;
    currentStroke = null;
  }

  function onKey(e) {
    if (state.mode === "pick" && hoverBase &&
        (e.code === "BracketLeft" || e.code === "BracketRight")) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "BracketLeft") {
        var current = targetAtDepth(hoverBase, targetDepth);
        var parent = targetAtDepth(hoverBase, targetDepth + 1);
        if (parent && parent !== current) targetDepth += 1;
      } else if (e.code === "BracketRight" && targetDepth > 0) {
        targetDepth -= 1;
      }
      renderHighlight();
      return;
    }
    if (e.isTrusted && e.key === "Escape" && state.mode !== "browse") {
      e.preventDefault();
      e.stopPropagation();
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
    var href = utf8Prefix(location.href || "", 8192);
    if (!href || href.indexOf("mcx.invalid") !== -1) return;
    if (href === "about:blank" || href.indexOf("about:") === 0) return;
    var title = utf8Prefix(document.title || "", 1024);
    var snapshot = href + "\n" + title + "\n" + (loading ? "1" : "0");
    if (snapshot === lastLocationSnapshot) return;
    lastLocationSnapshot = snapshot;
    bridge(
      "location",
      "url=" + nativeEncode(href) +
        "&title=" + nativeEncode(title) +
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

  var hostControls = Object.freeze({
    setMode: function (token, mode) {
      if (token !== bridgeToken) return false;
      var nextMode = mode === "pick" || mode === "draw" || mode === "capture"
        ? mode
        : "browse";
      if (state.mode === nextMode) return state.readyMode === nextMode;
      state.mode = nextMode;
      state.readyMode = null;
      state.captureBarrier = null;
      if (state.mode !== "draw") {
        drawing = false;
      }
      if (state.mode !== "capture") captureStart = null;
      syncOverlay();
      if (state.mode === "draw") redraw();
      var acknowledgedMode = state.mode;
      afterVisualFrame(function () {
        afterVisualFrame(function () {
          if (state.mode === acknowledgedMode) state.readyMode = acknowledgedMode;
        });
      });
      return false;
    },
    prepareCapture: function (token, mode, barrierId) {
      if (token !== bridgeToken || state.mode !== mode) return false;
      var barrier = state.captureBarrier;
      if (!barrier || barrier.id !== barrierId || barrier.mode !== mode) {
        barrier = { id: barrierId, mode: mode, ready: false };
        state.captureBarrier = barrier;
        afterVisualFrame(function () {
          afterVisualFrame(function () {
            if (state.captureBarrier === barrier && state.mode === mode) barrier.ready = true;
          });
        });
        return false;
      }
      return barrier.ready === true;
    },
    clearDraw: function (token) {
      if (token !== bridgeToken) return false;
      strokes = [];
      redraw();
      return true;
    },
  });
  Object.defineProperty(window, "__mcx", {
    value: hostControls,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})();
