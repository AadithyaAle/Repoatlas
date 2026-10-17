/* RepoAtlas docs — shared behaviour (no dependencies).
   Theme toggle, mobile navigation drawer, code highlighting + copy buttons, heading anchors,
   "On this page" table of contents, screenshot slots and deployment config (assets/config.js). */
(function () {
  "use strict";

  var THEME_KEY = "repoatlas-docs-theme";
  var root = document.documentElement;

  // ------------------------------------------------------------------ theme
  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    var btn = document.querySelector("[data-theme-toggle]");
    if (btn) {
      btn.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
      btn.setAttribute("aria-label", theme === "light" ? "Switch to dark theme" : "Switch to light theme");
    }
  }
  applyTheme(storedTheme() || root.getAttribute("data-theme") || systemTheme());
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: light)");
    var onChange = function () { if (!storedTheme()) applyTheme(systemTheme()); };
    if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange);
  }

  function initThemeToggle() {
    var btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return;
    applyTheme(root.getAttribute("data-theme") || "dark");
    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
      applyTheme(next);
    });
  }

  // ------------------------------------------------------------- navigation
  function initNav() {
    var body = document.body;
    var menuBtn = document.querySelector("[data-menu-toggle]");
    var sidebar = document.getElementById("sidebar");
    var overlay = document.querySelector(".nav-overlay");
    var closeBtn = document.querySelector("[data-menu-close]");
    if (!menuBtn || !sidebar) return;

    function open() {
      body.classList.add("nav-open");
      menuBtn.setAttribute("aria-expanded", "true");
      var first = sidebar.querySelector("a, button");
      if (first) first.focus();
    }
    function close(restoreFocus) {
      body.classList.remove("nav-open");
      menuBtn.setAttribute("aria-expanded", "false");
      if (restoreFocus) menuBtn.focus();
    }
    menuBtn.addEventListener("click", function () {
      if (body.classList.contains("nav-open")) close(true); else open();
    });
    if (overlay) overlay.addEventListener("click", function () { close(true); });
    if (closeBtn) closeBtn.addEventListener("click", function () { close(true); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && body.classList.contains("nav-open")) close(true);
    });
    sidebar.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) close(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 920 && body.classList.contains("nav-open")) close(false);
    });
  }

  // ------------------------------------------------------------ highlighter
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var PY_KW = "False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case";
  var JS_KW = "abstract|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|null|of|private|protected|public|readonly|return|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|with|yield";

  var LANGS = {
    bash: [
      ["com", /(?:^|(?<=\s))#.*$/.source],
      ["str", /"(?:\\.|[^"\\])*"|'[^']*'/.source],
      ["var", /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/.source],
      ["kw", /\b(?:if|then|else|fi|for|do|done|while|case|esac|export|function|in)\b/.source],
      ["fn", /(?:^|(?<=[\s;&|(]))(?:docker|uv|npm|npx|node|git|cd|cp|mv|curl|python|python3|alembic|uvicorn|pytest|ruff|mypy|echo|source|cat|psql)\b/.source],
      ["prop", /(?:^|(?<=\s))--?[A-Za-z][\w-]*/.source],
      ["num", /\b\d+\b/.source]
    ],
    python: [
      ["com", /#.*$/.source],
      ["str", /[rbfuRBFU]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/.source],
      ["prop", /@[A-Za-z_][\w.]*/.source],
      ["kw", "\\b(?:" + PY_KW + ")\\b"],
      ["num", /\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/.source],
      ["fn", /\b[A-Za-z_]\w*(?=\()/.source]
    ],
    ts: [
      ["com", /\/\/.*$|\/\*[\s\S]*?\*\//.source],
      ["str", /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/.source],
      ["kw", "\\b(?:" + JS_KW + ")\\b"],
      ["num", /\b\d[\d_]*(?:\.\d+)?\b/.source],
      ["fn", /\b[A-Za-z_$][\w$]*(?=\s*\()/.source],
      ["prop", /\b[A-Z][A-Za-z0-9_]*\b/.source]
    ],
    json: [
      ["prop", /"(?:\\.|[^"\\])*"(?=\s*:)/.source],
      ["str", /"(?:\\.|[^"\\])*"/.source],
      ["kw", /\b(?:true|false|null)\b/.source],
      ["num", /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/.source]
    ],
    yaml: [
      ["com", /(?:^|(?<=\s))#.*$/.source],
      ["prop", /^\s*-?\s*[A-Za-z_][\w.-]*(?=\s*:)/.source],
      ["str", /"(?:\\.|[^"\\])*"|'[^']*'/.source],
      ["kw", /\b(?:true|false|null|yes|no)\b/.source],
      ["num", /\b\d+(?:\.\d+)?\b/.source]
    ],
    env: [
      ["com", /^\s*#.*$/.source],
      ["prop", /^[A-Z_][A-Z0-9_]*(?==)/.source],
      ["str", /"(?:\\.|[^"\\])*"|'[^']*'/.source]
    ],
    text: []
  };
  LANGS.js = LANGS.ts; LANGS.typescript = LANGS.ts; LANGS.javascript = LANGS.ts; LANGS.tsx = LANGS.ts;
  LANGS.sh = LANGS.bash; LANGS.shell = LANGS.bash; LANGS.py = LANGS.python; LANGS.yml = LANGS.yaml; LANGS.dotenv = LANGS.env;

  var compiled = {};
  function compile(lang) {
    if (compiled[lang] !== undefined) return compiled[lang];
    var rules = LANGS[lang];
    if (!rules || !rules.length) { compiled[lang] = null; return null; }
    var src = rules.map(function (r) { return "(" + r[1] + ")"; }).join("|");
    var re;
    try { re = new RegExp(src, "gm"); } catch (e) { re = null; } // very old engines without lookbehind
    compiled[lang] = re ? { re: re, names: rules.map(function (r) { return r[0]; }) } : null;
    return compiled[lang];
  }

  function highlight(code, lang) {
    var c = compile(lang);
    if (!c) return escapeHtml(code);
    var out = "", last = 0, m;
    c.re.lastIndex = 0;
    while ((m = c.re.exec(code)) !== null) {
      if (m[0] === "") { c.re.lastIndex++; continue; }
      var idx = 1;
      while (idx < m.length && m[idx] === undefined) idx++;
      out += escapeHtml(code.slice(last, m.index));
      out += '<span class="tok-' + c.names[idx - 1] + '">' + escapeHtml(m[0]) + "</span>";
      last = m.index + m[0].length;
    }
    return out + escapeHtml(code.slice(last));
  }
  window.RepoAtlasDocs = { highlight: highlight, escapeHtml: escapeHtml };

  var LANG_LABELS = { bash: "bash", sh: "bash", shell: "bash", python: "python", py: "python", ts: "typescript", typescript: "typescript", tsx: "tsx", js: "javascript", javascript: "javascript", json: "json", yaml: "yaml", yml: "yaml", env: ".env", dotenv: ".env", text: "text" };

  function enhanceCodeBlock(pre) {
    if (pre.dataset.enhanced) return;
    pre.dataset.enhanced = "1";
    var code = pre.querySelector("code");
    if (!code) return;
    var m = /language-([\w-]+)/.exec(code.className);
    var lang = m ? m[1] : null;
    var raw = code.textContent;
    if (lang) code.innerHTML = highlight(raw, lang);
    var wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    if (lang && LANG_LABELS[lang]) {
      var label = document.createElement("span");
      label.className = "code-lang";
      label.textContent = LANG_LABELS[lang];
      label.setAttribute("aria-hidden", "true");
      wrap.appendChild(label);
    } else {
      pre.classList.add("no-lang");
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.addEventListener("click", function () {
      var text = raw.replace(/\n$/, "");
      var done = function () {
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1600);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else { fallbackCopy(text); done(); }
    });
    wrap.appendChild(btn);
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }
  function initCode(scope) {
    var pres = (scope || document).querySelectorAll("pre");
    for (var i = 0; i < pres.length; i++) enhanceCodeBlock(pres[i]);
  }
  window.RepoAtlasDocs.initCode = initCode;

  // ----------------------------------------------------- anchors + TOC
  function initAnchors() {
    var heads = document.querySelectorAll(".prose h2[id], .prose h3[id]");
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      if (h.querySelector(".anchor")) continue;
      var a = document.createElement("a");
      a.className = "anchor";
      a.href = "#" + h.id;
      a.textContent = "#";
      a.setAttribute("aria-label", "Permalink to " + h.textContent.trim());
      h.appendChild(a);
    }
  }
  function initToc() {
    var toc = document.querySelector("[data-toc]");
    if (!toc) return;
    var heads = document.querySelectorAll(".prose h2[id]");
    if (!heads.length) { toc.parentNode.removeChild(toc); return; }
    var ul = document.createElement("ul");
    var links = [];
    for (var i = 0; i < heads.length; i++) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + heads[i].id;
      a.textContent = heads[i].textContent.replace(/#$/, "").trim();
      li.appendChild(a); ul.appendChild(li); links.push(a);
    }
    toc.appendChild(ul);
    if (!("IntersectionObserver" in window)) return;
    var visible = {};
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
      var current = null;
      for (var j = 0; j < heads.length; j++) { if (visible[heads[j].id]) { current = heads[j].id; break; } }
      if (!current) return;
      links.forEach(function (l) { l.classList.toggle("active", l.getAttribute("href") === "#" + current); });
    }, { rootMargin: "-70px 0px -65% 0px" });
    for (var k = 0; k < heads.length; k++) obs.observe(heads[k]);
  }

  // ------------------------------------------------------- screenshots
  // <figure class="shot missing"><img src="data:…" data-src="assets/screenshots/x.png" onerror=… onload=…>
  // The markup ships a 1×1 inline placeholder so the HTML stays valid and the CI link checker never
  // sees a missing file; the real path is swapped in here. If the PNG exists, `onload` removes
  // `.missing` and the screenshot replaces the illustrated fallback; otherwise `onerror` keeps it.
  // To add screenshots, just drop PNGs with the documented names into assets/screenshots/.
  function initShots() {
    var imgs = document.querySelectorAll("figure.shot img[data-src]");
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].setAttribute("src", imgs[i].getAttribute("data-src"));
    }
  }

  // --------------------------------------------------------- deployment config
  function initConfig() {
    var appUrl = (window.REPOATLAS_APP_URL || "").trim();
    var apiUrl = (window.REPOATLAS_API_URL || "").trim().replace(/\/+$/, "");
    var links = document.querySelectorAll("[data-app-link]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.dataset.appReady) continue;
      a.dataset.appReady = "1";
      if (appUrl) {
        a.href = appUrl;
        a.removeAttribute("hidden");
      } else if (a.hasAttribute("data-app-optional")) {
        a.setAttribute("hidden", "");
      } else {
        markAppUnconfigured(a);
      }
    }
    var apiEls = document.querySelectorAll("[data-api-url]");
    for (var j = 0; j < apiEls.length; j++) {
      apiEls[j].textContent = apiUrl || apiEls[j].getAttribute("data-api-url-fallback") || "https://<your-api-host>";
    }
  }
  function markAppUnconfigured(a) {
    a.classList.add("is-disabled");
    a.setAttribute("aria-disabled", "true");
    a.setAttribute("title", "The hosted app URL has not been configured yet");
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var note = document.querySelector("[data-app-note]");
      if (note) {
        note.hidden = false;
        note.focus && note.focus();
      }
    });
  }
  window.RepoAtlasDocs.markAppUnconfigured = markAppUnconfigured;

  function ready(fn) {
    if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    initThemeToggle();
    initNav();
    initCode();
    initAnchors();
    initToc();
    initShots();
    initConfig();
  });
})();
