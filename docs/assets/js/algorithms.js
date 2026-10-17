/* RepoAtlas docs — interactive algorithm illustrations (vanilla JS + SVG, no dependencies).
 *
 * Each widget is a `.algo` block whose static markup already shows the algorithm's FINAL state,
 * so the page is complete without JavaScript. When this script runs it reveals the Prev / Next /
 * Play controls and replaces the static state with frames computed by faithful JavaScript ports of
 * backend/app/engine/graph_algorithms.py and backend/app/engine/drift_detector.py.
 *
 * prefers-reduced-motion: CSS transitions are disabled by docs.css and "Play" jumps straight to the
 * final frame instead of animating.
 */
(function () {
  "use strict";

  var REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ------------------------------------------------------------------ helpers
  function qs(root, sel) { return root.querySelector(sel); }
  function qsa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function copy(obj) { var o = {}; for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) o[k] = obj[k]; return o; }
  function round2(x) { return Math.round(x * 100) / 100; }
  function chips(list) {
    if (!list || !list.length) return '<span class="chip">empty</span>';
    return list.map(function (c) { return '<span class="chip">' + esc(c) + "</span>"; }).join("");
  }
  function adjacency(nodes, edges) {
    var adj = {};
    nodes.forEach(function (n) { adj[n] = []; });
    edges.forEach(function (e) { if (adj[e[0]].indexOf(e[1]) < 0) adj[e[0]].push(e[1]); });
    nodes.forEach(function (n) { adj[n].sort(); });
    return adj;
  }
  function reverseAdjacency(nodes, edges) {
    var rev = {};
    nodes.forEach(function (n) { rev[n] = []; });
    edges.forEach(function (e) { if (rev[e[1]].indexOf(e[0]) < 0) rev[e[1]].push(e[0]); });
    nodes.forEach(function (n) { rev[n].sort(); });
    return rev;
  }

  // ------------------------------------------------------------------ stepper
  function Stepper(root, render, opts) {
    opts = opts || {};
    this.root = root;
    this.render = render;
    this.frames = [];
    this.i = 0;
    this.timer = null;
    this.interval = opts.interval || 1100;
    var c = qs(root, "[data-controls]");
    this.btn = {
      reset: qs(c, '[data-act="reset"]'),
      prev: qs(c, '[data-act="prev"]'),
      play: qs(c, '[data-act="play"]'),
      next: qs(c, '[data-act="next"]')
    };
    this.progress = qs(c, "[data-progress]");
    this.narration = qs(root, "[data-narration]");
    var self = this;
    this.btn.reset.addEventListener("click", function () { self.stop(); self.go(0); });
    this.btn.prev.addEventListener("click", function () { self.stop(); self.go(self.i - 1); });
    this.btn.next.addEventListener("click", function () { self.stop(); self.go(self.i + 1); });
    this.btn.play.addEventListener("click", function () { if (self.timer) self.stop(); else self.play(); });
    if (REDUCED) this.btn.play.setAttribute("title", "Reduced motion is on: jumps to the final step");
    c.hidden = false;
  }
  Stepper.prototype.load = function (frames, start) {
    this.stop();
    this.frames = frames;
    this.go(start === undefined ? 0 : start);
  };
  Stepper.prototype.go = function (i) {
    var last = this.frames.length - 1;
    this.i = Math.max(0, Math.min(last, i));
    this.render(this.frames[this.i], this.i, this.frames.length);
    this.btn.prev.disabled = this.i === 0;
    this.btn.reset.disabled = this.i === 0;
    this.btn.next.disabled = this.i === last;
    if (this.progress) this.progress.textContent = "Step " + (this.i + 1) + " / " + this.frames.length;
  };
  Stepper.prototype.play = function () {
    var self = this, last = this.frames.length - 1;
    if (REDUCED) { this.go(last); return; }
    if (this.i >= last) this.go(0);
    this.btn.play.textContent = "❚❚ Pause";
    this.btn.play.setAttribute("aria-pressed", "true");
    if (this.narration) this.narration.setAttribute("aria-live", "off");
    this.timer = window.setInterval(function () {
      if (self.i >= last) { self.stop(); return; }
      self.go(self.i + 1);
      if (self.i >= last) self.stop();
    }, this.interval);
  };
  Stepper.prototype.stop = function () {
    if (this.timer) { window.clearInterval(this.timer); this.timer = null; }
    this.btn.play.textContent = "▶ Play";
    this.btn.play.setAttribute("aria-pressed", "false");
    if (this.narration) this.narration.setAttribute("aria-live", "polite");
  };

  // ------------------------------------------------------------- graph view
  var NODE_STATES = ["st-d0", "st-d1", "st-d2", "st-d3", "st-white", "st-grey", "st-black", "st-cycle"];
  var EDGE_STATES = ["hot", "back", "scc"];

  function GraphView(svg) {
    var self = this;
    this.prefix = svg.getAttribute("data-marker-prefix");
    this.nodes = {};
    this.edges = {};
    qsa(svg, "[data-node]").forEach(function (g) { self.nodes[g.getAttribute("data-node")] = g; });
    qsa(svg, "[data-edge]").forEach(function (p) { self.edges[p.getAttribute("data-edge")] = p; });
  }
  GraphView.prototype.paint = function (nodeStates, edgeStates, current) {
    var id, key;
    for (id in this.nodes) {
      var g = this.nodes[id];
      NODE_STATES.forEach(function (c) { g.classList.remove(c); });
      g.classList.remove("is-current");
      if (nodeStates[id]) g.classList.add(nodeStates[id]);
      if (current === id) g.classList.add("is-current");
    }
    for (key in this.edges) {
      var p = this.edges[key], st = edgeStates[key];
      EDGE_STATES.forEach(function (c) { p.classList.remove(c); });
      var marker = this.prefix + "-arrow";
      if (st) {
        p.classList.add(st);
        marker += st === "hot" ? "-hot" : "-bad";
      }
      p.setAttribute("marker-end", "url(#" + marker + ")");
    }
  };

  // ======================================================== 1. reverse BFS
  var BFS_NODES = ["app.py", "auth.py", "cli.py", "config.py", "db.py", "models.py", "routes.py", "utils.py"];
  var BFS_EDGES = [
    ["cli.py", "app.py"], ["app.py", "routes.py"], ["routes.py", "models.py"], ["routes.py", "auth.py"],
    ["routes.py", "utils.py"], ["models.py", "db.py"], ["auth.py", "db.py"], ["db.py", "config.py"]
  ];

  function depthClass(d) { return d === 0 ? "st-d0" : d === 1 ? "st-d1" : d === 2 ? "st-d2" : "st-d3"; }
  // graph_algorithms.risk_level: <5 LOW, <15 MEDIUM, <35 HIGH, otherwise CRITICAL
  function riskLevel(score) { return score < 5 ? "LOW" : score < 15 ? "MEDIUM" : score < 35 ? "HIGH" : "CRITICAL"; }

  function bfsFrames(target) {
    var rev = reverseAdjacency(BFS_NODES, BFS_EDGES);
    var N = BFS_NODES.length;
    var visited = {}, depth = {}, states = {}, edges = {};
    var queue = [[target, 0]];
    var frames = [];
    visited[target] = true;
    states[target] = "st-d0";
    function snap(text, current) {
      frames.push({
        states: copy(states), edges: copy(edges), current: current, depth: copy(depth), N: N, text: text,
        queue: queue.map(function (q) { return q[0] + " · d" + q[1]; })
      });
    }
    snap("Start: put the changed file " + target + " in the queue at depth 0. The search follows edges backwards, from a file to the files that import it.", target);
    while (queue.length) {
      var item = queue.shift(), node = item[0], d = item[1];
      var importers = rev[node], fresh = [], seen = [];
      importers.forEach(function (dep) {
        if (!visited[dep]) {
          visited[dep] = true;
          depth[dep] = d + 1;
          states[dep] = depthClass(d + 1);
          edges[dep + ">" + node] = "hot";
          queue.push([dep, d + 1]);
          fresh.push(dep);
        } else {
          seen.push(dep);
        }
      });
      var t = "Dequeue " + node + " (depth " + d + "). ";
      if (!importers.length) t += "No file imports it, so nothing new is reached.";
      else {
        t += "Imported by " + importers.join(", ") + ". ";
        if (fresh.length) t += "New at depth " + (d + 1) + ": " + fresh.join(", ") + ". ";
        if (seen.length) t += "Already visited (kept at its shorter depth): " + seen.join(", ") + ".";
      }
      snap(t, node);
    }
    var impacted = Object.keys(depth).length;
    var maxDepth = 0;
    for (var k in depth) maxDepth = Math.max(maxDepth, depth[k]);
    var safe = BFS_NODES.filter(function (n) { return n !== target && !(n in depth); });
    snap(
      impacted
        ? "Done: " + impacted + " of the " + (N - 1) + " other files are impacted, up to depth " + maxDepth + "." +
          (safe.length ? " Not impacted: " + safe.join(", ") + "." : "")
        : "Done: nothing imports " + target + ", so changing it cannot break any other file.",
      null
    );
    return frames;
  }

  function bfsFormula(frame) {
    var paths = Object.keys(frame.depth).sort(function (a, b) {
      return frame.depth[a] - frame.depth[b] || (a < b ? -1 : a > b ? 1 : 0);
    });
    var n1 = frame.N - 1;
    var impacted = paths.length;
    var weighted = 0;
    var terms = paths.map(function (p) { weighted += 1 / frame.depth[p]; return "1/" + frame.depth[p]; });
    var impact = n1 > 0 ? round2(impacted / n1 * 100) : 0;
    var risk = n1 > 0 ? round2(weighted / n1 * 100) : 0;
    var level = riskLevel(risk);
    return "impacted = " + impacted + " · N − 1 = " + n1 + "<br>" +
      "impact% = " + impacted + " / " + n1 + " × 100 = " + impact.toFixed(2) + "<br>" +
      "risk = (" + (terms.length ? terms.join(" + ") : "0") + ") / " + n1 + " × 100 = " + risk.toFixed(2) + "<br>" +
      'level: <span class="badge risk-' + level + '">' + level + "</span>";
  }

  function initBfs() {
    var root = document.getElementById("algo-bfs");
    if (!root) return;
    var svg = qs(root, "svg");
    var view = new GraphView(svg);
    // The nodes become buttons, so the SVG can no longer be a single atomic image for AT.
    svg.setAttribute("role", "group");
    var narration = qs(root, "[data-narration]");
    var chipBox = qs(root, "[data-chips]");
    var formula = qs(root, "[data-formula]");
    var label = qs(root, "[data-target-label]");
    var stepper = new Stepper(root, function (f) {
      view.paint(f.states, f.edges, f.current);
      narration.textContent = f.text;
      chipBox.innerHTML = chips(f.queue);
      formula.innerHTML = bfsFormula(f);
    });
    function select(target, autoplay) {
      label.textContent = target;
      stepper.load(bfsFrames(target), 0);
      if (autoplay) stepper.play();
    }
    Object.keys(view.nodes).forEach(function (id) {
      var g = view.nodes[id];
      g.classList.add("clickable");
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", "Simulate changing " + id);
      g.addEventListener("click", function () { select(id, true); });
      g.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(id, true); }
      });
    });
    var note = qs(root, "[data-js-note]");
    if (note) note.hidden = false;
    select("db.py", false);
  }

  // ================================================ 2. three-colour DFS + Tarjan
  var DFS_NODES = ["api.py", "main.py", "models.py", "repo.py", "service.py", "utils.py"];
  var DFS_EDGES = [
    ["main.py", "api.py"], ["api.py", "service.py"], ["api.py", "utils.py"], ["service.py", "repo.py"],
    ["repo.py", "models.py"], ["repo.py", "utils.py"], ["models.py", "service.py"]
  ];
  var WHITE = 0, GREY = 1, BLACK = 2;
  var COLOR_CLASS = ["st-white", "st-grey", "st-black"];

  // graph_algorithms._canonical_cycle: rotate so the smallest path comes first (direction kept)
  function canonical(path) {
    var min = path.slice().sort()[0], pivot = path.indexOf(min);
    return path.slice(pivot).concat(path.slice(0, pivot));
  }

  // Port of graph_algorithms._tarjan_scc (iterative); returns components in completion order.
  function tarjan(nodes, adj) {
    var index = {}, low = {}, onStack = {}, stack = [], comps = [], counter = 0;
    function visit(n) { index[n] = low[n] = counter++; stack.push(n); onStack[n] = true; }
    nodes.forEach(function (root) {
      if (root in index) return;
      visit(root);
      var work = [[root, 0]];
      while (work.length) {
        var top = work[work.length - 1], node = top[0], nbrs = adj[node], descended = false;
        while (top[1] < nbrs.length) {
          var nxt = nbrs[top[1]++];
          if (!(nxt in index)) { visit(nxt); work.push([nxt, 0]); descended = true; break; }
          if (onStack[nxt]) low[node] = Math.min(low[node], index[nxt]);
        }
        if (descended) continue;
        work.pop();
        if (work.length) { var parent = work[work.length - 1][0]; low[parent] = Math.min(low[parent], low[node]); }
        if (low[node] === index[node]) {
          var comp = [];
          for (;;) { var m = stack.pop(); onStack[m] = false; comp.push(m); if (m === node) break; }
          comps.push(comp.sort());
        }
      }
    });
    return comps;
  }

  function dfsFrames() {
    var adj = adjacency(DFS_NODES, DFS_EDGES);
    var state = {}, states = {}, edges = {}, cycles = [], frames = [], path = [];
    DFS_NODES.forEach(function (n) { state[n] = WHITE; states[n] = "st-white"; });
    function snap(text, current, chipList, formulaText) {
      frames.push({
        states: copy(states), edges: copy(edges), current: current, text: text,
        chips: chipList || (path.length ? ["path: " + path.join(" › ")] : []),
        formula: formulaText || (cycles.length ? cycles.map(function (c) { return "[" + c.join(", ") + "]"; }).join("<br>") : "none yet")
      });
    }
    function setState(n, s) { state[n] = s; states[n] = COLOR_CLASS[s]; }
    snap("Every file starts WHITE (unvisited). Roots are tried in sorted order: " + DFS_NODES.join(", ") + ".", null);
    DFS_NODES.forEach(function (root) {
      if (state[root] !== WHITE) return;
      setState(root, GREY);
      path = [root];
      var position = {};
      position[root] = 0;
      var stack = [[root, 0]];
      snap("Start a DFS at " + root + ": mark it GREY — it is on the current path.", root);
      while (stack.length) {
        var top = stack[stack.length - 1], node = top[0], nbrs = adj[node], descended = false;
        while (top[1] < nbrs.length) {
          var nxt = nbrs[top[1]++], key = node + ">" + nxt;
          if (state[nxt] === WHITE) {
            setState(nxt, GREY);
            position[nxt] = path.length;
            path.push(nxt);
            stack.push([nxt, 0]);
            edges[key] = "hot";
            snap("Edge " + node + " → " + nxt + ": " + nxt + " is WHITE, so descend and mark it GREY.", nxt);
            descended = true;
            break;
          }
          if (state[nxt] === GREY) {
            var cyc = canonical(path.slice(position[nxt]));
            var sig = cyc.join("|");
            if (!cycles.some(function (c) { return c.join("|") === sig; })) cycles.push(cyc);
            edges[key] = "back";
            snap("Edge " + node + " → " + nxt + ": " + nxt + " is GREY — it is on the current path, so this is a BACK EDGE. The path from " + nxt + " to " + node + " is a cycle: " + cyc.join(" → ") + " → " + cyc[0] + ".", node);
          } else {
            snap("Edge " + node + " → " + nxt + ": " + nxt + " is BLACK (already finished) — no cycle through here.", node);
          }
        }
        if (descended) continue;
        stack.pop();
        path.pop();
        delete position[node];
        setState(node, BLACK);
        snap(node + " has no unexplored imports: mark it BLACK and backtrack.", stack.length ? stack[stack.length - 1][0] : null);
      }
    });

    // Tarjan phase
    var comps = tarjan(DFS_NODES, adj);
    var cyclesText = cycles.map(function (c) { return "[" + c.join(", ") + "]"; }).join("<br>");
    snap("The DFS reported " + cycles.length + " cycle" + (cycles.length === 1 ? "" : "s") + ". A reported cycle is just one path, so Tarjan's strongly connected components now find every file and import that lies on any cycle.", null, [], cyclesText);
    var shown = [], nontrivialIds = {};
    var nontrivial = comps.filter(function (c) { return c.length > 1 || adj[c[0]].indexOf(c[0]) >= 0; })
      .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    nontrivial.forEach(function (c, i) { c.forEach(function (n) { nontrivialIds[n] = i; }); });
    comps.forEach(function (comp) {
      var isCycle = comp[0] in nontrivialIds;
      if (isCycle) {
        var sid = nontrivialIds[comp[0]];
        comp.forEach(function (n) { states[n] = "st-cycle"; });
        DFS_EDGES.forEach(function (e) {
          if (nontrivialIds[e[0]] === sid && nontrivialIds[e[1]] === sid) {
            var key = e[0] + ">" + e[1];
            if (edges[key] !== "back") edges[key] = "scc";
          }
        });
        shown.push("SCC " + sid + ": " + comp.join(", "));
        snap("Tarjan completes component {" + comp.join(", ") + "}: it has " + comp.length + " files, so every member is circular (scc_id " + sid + ") and so is every import between them.", comp[0], shown.slice(), cyclesText);
      } else {
        shown.push(comp[0] + " (trivial)");
        snap("Tarjan completes component {" + comp[0] + "}: a single file without a self-import is not circular.", comp[0], shown.slice(), cyclesText);
      }
    });
    var members = Object.keys(nontrivialIds).sort();
    snap("Result: " + cycles.length + " reported cycle" + (cycles.length === 1 ? "" : "s") + "; " +
      (members.length ? members.join(", ") + " are marked circular." : "no file is circular.") +
      " Everything else is not on any cycle.", null,
      nontrivial.map(function (c, i) { return "SCC " + i + ": " + c.join(", "); }), cyclesText);
    return frames;
  }

  function initDfs() {
    var root = document.getElementById("algo-dfs");
    if (!root) return;
    var view = new GraphView(qs(root, "svg"));
    var narration = qs(root, "[data-narration]");
    var chipBox = qs(root, "[data-chips]");
    var formula = qs(root, "[data-formula]");
    var stepper = new Stepper(root, function (f) {
      view.paint(f.states, f.edges, f.current);
      narration.textContent = f.text;
      chipBox.innerHTML = chips(f.chips);
      formula.innerHTML = f.formula;
    });
    stepper.load(dfsFrames(), 0);
  }

  // ======================================================= 3. role classifier
  var ROLE_LABELS = {
    ISOLATED: "Isolated", ENTRY_POINT: "Entry point", GOD_MODULE: "God module",
    CORE_UTILITY: "Core utility", LEAF: "Leaf", STANDARD: "Standard"
  };
  // graph_algorithms.classify_role (HIGH_IN_DEGREE = 5, HIGH_OUT_DEGREE = 5, LOW_OUT_DEGREE = 2)
  function classifyRole(inDeg, outDeg) {
    if (inDeg === 0) return outDeg === 0 ? "ISOLATED" : "ENTRY_POINT";
    if (inDeg >= 5 && outDeg >= 5) return "GOD_MODULE";
    if (inDeg >= 5 && outDeg <= 2) return "CORE_UTILITY";
    if (outDeg === 0) return "LEAF";
    return "STANDARD";
  }
  function initRoles() {
    var root = document.getElementById("algo-roles");
    if (!root) return;
    var inEl = document.getElementById("role-in"), outEl = document.getElementById("role-out");
    var out = qs(root, "[data-role-out]");
    function update() {
      var i = Math.max(0, parseInt(inEl.value, 10) || 0), o = Math.max(0, parseInt(outEl.value, 10) || 0);
      var role = classifyRole(i, o);
      out.innerHTML = '<span class="badge role-' + role + '">' + ROLE_LABELS[role] + "</span>";
    }
    inEl.addEventListener("input", update);
    outEl.addEventListener("input", update);
    root.hidden = false;
    update();
  }

  // ============================================================ 4. PageRank
  var PR_DAMPING = 0.85, PR_ITERATIONS = 50, PR_SCALE = 0.25;

  // Port of graph_algorithms.pagerank, keeping every iteration.
  function pagerankFrames() {
    var nodes = BFS_NODES, adj = adjacency(BFS_NODES, BFS_EDGES), n = nodes.length;
    var rank = {};
    nodes.forEach(function (v) { rank[v] = 1 / n; });
    var dangling = nodes.filter(function (v) { return !adj[v].length; });
    var frames = [{ iter: 0, rank: copy(rank), delta: null, dangling: dangling }];
    for (var it = 1; it <= PR_ITERATIONS; it++) {
      var share = 0;
      dangling.forEach(function (d) { share += rank[d]; });
      var base = (1 - PR_DAMPING) / n + PR_DAMPING * share / n;
      var next = {};
      nodes.forEach(function (v) { next[v] = base; });
      nodes.forEach(function (src) {
        var targets = adj[src];
        if (!targets.length) return;
        var s = PR_DAMPING * rank[src] / targets.length;
        targets.forEach(function (t) { next[t] += s; });
      });
      var delta = 0;
      nodes.forEach(function (v) { delta = Math.max(delta, Math.abs(next[v] - rank[v])); });
      rank = next;
      frames.push({ iter: it, rank: copy(rank), delta: delta, dangling: dangling });
    }
    return frames;
  }

  function initPagerank() {
    var root = document.getElementById("algo-pagerank");
    if (!root) return;
    var rows = qsa(root, "[data-pr-node]");
    var narration = qs(root, "[data-narration]");
    var chipBox = qs(root, "[data-chips]");
    var formula = qs(root, "[data-formula]");
    var stepper = new Stepper(root, function (f) {
      var sum = 0;
      rows.forEach(function (row) {
        var v = f.rank[row.getAttribute("data-pr-node")];
        sum += v;
        qs(row, ".bar").style.width = Math.min(100, v / PR_SCALE * 100).toFixed(2) + "%";
        qs(row, "[data-pr-val]").textContent = v.toFixed(3);
      });
      if (f.iter === 0) {
        narration.textContent = "Iteration 0: every file starts with 1/N = 1/" + rows.length + " = " + (1 / rows.length).toFixed(3) + ".";
      } else if (f.iter < PR_ITERATIONS) {
        narration.textContent = "Iteration " + f.iter + " of " + PR_ITERATIONS + ": each file keeps (1 − 0.85)/N plus its share of the dangling files' rank, and each importer passes 0.85 × its rank, split evenly over the files it imports. Rank flows towards db.py and config.py.";
      } else {
        narration.textContent = "Iteration 50 (final): config.py ranks highest — everything eventually flows into it through db.py — although only one file imports it directly. cli.py, which nothing imports, keeps only the base share.";
      }
      chipBox.innerHTML = chips(f.dangling);
      formula.innerHTML = "Σ rank = " + sum.toFixed(3) + (f.delta === null ? "" : "<br>largest change this iteration = " + f.delta.toFixed(5));
    }, { interval: 220 });
    stepper.load(pagerankFrames(), 0);
  }

  // ======================================================= 5. drift matcher
  var SNAPSHOT = ["def get_session():", "    with SessionLocal() as s:", "        yield s"];
  var ORIGINAL_START = 3; // 1-based start line at the base commit
  var AUTO_FIX_THRESHOLD = 0.75;
  var MOVED = [
    "import contextlib", "", "from app.core.config import settings", "", "engine = create_engine(settings.url)", "",
    "def get_session():", "    with SessionLocal() as s:", "        yield s", "", "def ping():", "    return True"
  ];
  var SCENARIOS = { moved: MOVED, edited: MOVED.slice() };
  SCENARIOS.edited[7] = "    with sessionmaker()() as s:";

  // drift_detector.normalize_lines: strip + collapse internal whitespace, blank lines kept
  function normalize(line) { var t = line.trim(); return t ? t.split(/\s+/).join(" ") : ""; }

  // difflib.SequenceMatcher(None, a, b, autojunk=False).ratio() — no junk, so the longest-match
  // search reduces to the dynamic programme below (ties: earliest in a, then earliest in b).
  function longestMatch(a, b, alo, ahi, blo, bhi) {
    var besti = alo, bestj = blo, bestsize = 0, j2len = {};
    for (var i = alo; i < ahi; i++) {
      var next = {};
      for (var j = blo; j < bhi; j++) {
        if (a.charAt(i) !== b.charAt(j)) continue;
        var k = (j2len[j - 1] || 0) + 1;
        next[j] = k;
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = next;
    }
    return [besti, bestj, bestsize];
  }
  function ratio(a, b) {
    var total = a.length + b.length;
    if (!total) return 1;
    var matched = 0, queue = [[0, a.length, 0, b.length]];
    while (queue.length) {
      var q = queue.pop(), m = longestMatch(a, b, q[0], q[1], q[2], q[3]);
      var i = m[0], j = m[1], k = m[2];
      if (!k) continue;
      matched += k;
      if (q[0] < i && q[2] < j) queue.push([q[0], i, q[2], j]);
      if (i + k < q[1] && j + k < q[3]) queue.push([i + k, q[1], j + k, q[3]]);
    }
    return 2 * matched / total;
  }

  function rangeLabel(start, len) { return "L" + start + "–" + (start + len - 1); }

  function driftFrames(name) {
    var lines = SCENARIOS[name];
    var norm = lines.map(normalize);
    var target = SNAPSHOT.map(normalize);
    var n = target.length, original = ORIGINAL_START - 1;
    var frames = [];
    var marks = {}; // 0-based line -> "match" | "miss"
    function snap(start, len, text, chipList, formula) {
      frames.push({ lines: lines, start: start, len: len, marks: copy(marks), text: text, chips: chipList, formula: formula });
    }
    function sameAt(i) { for (var k = 0; k < n; k++) if (norm[i + k] !== target[k]) return false; return true; }

    // 1. healthy check at the original range
    for (var h = original; h < original + n; h++) marks[h] = "miss";
    snap(original, n, "Healthy check: hash the same lines (" + rangeLabel(ORIGINAL_START, n) + ") of the new file. The SHA-256 differs from snippet_hash, so the code is no longer there.",
      [rangeLabel(ORIGINAL_START, n), "hash ≠"], "status = ? · checking for a moved copy next");
    marks = {};

    // 2. exact sliding window over the whole file
    var matches = [];
    for (var i = 0; i + n <= norm.length; i++) {
      var exact = sameAt(i);
      var why;
      if (exact) { matches.push(i); for (var m = i; m < i + n; m++) marks[m] = "match"; why = "all " + n + " normalised lines are equal ✓"; }
      else if (norm[i] !== target[0]) why = "first line ≠ “" + target[0] + "”";
      else why = "first line matches, but a later line differs";
      snap(i, n, "Exact search, window " + rangeLabel(i + 1, n) + ": " + why + ".", [rangeLabel(i + 1, n), exact ? "exact" : "no"],
        "exact matches so far: " + (matches.length ? matches.map(function (s) { return rangeLabel(s + 1, n); }).join(", ") : "none"));
    }
    if (matches.length) {
      var best = matches.slice().sort(function (a, b) { return Math.abs(a - original) - Math.abs(b - original) || a - b; })[0];
      marks = {};
      for (var b2 = best; b2 < best + n; b2++) marks[b2] = "match";
      snap(best, n, "Exact normalised match at " + rangeLabel(best + 1, n) + ", the match nearest the original " + rangeLabel(ORIGINAL_START, n) +
        " → AUTO-FIXED: the step is re-pinned to " + rangeLabel(best + 1, n) + " automatically, no review needed.",
        [rangeLabel(best + 1, n), "exact"],
        "status = DRIFTED_AUTO_FIXED · lines " + rangeLabel(ORIGINAL_START, n) + " → " + rangeLabel(best + 1, n) + " · similarity 1.0");
      return frames;
    }

    // 3. fuzzy: SequenceMatcher ratio per same-length window (the real matcher also tries n−2 … n+2)
    marks = {};
    snap(original, n, "No exact match anywhere: the code itself changed, so the step will need review. Now score windows with difflib's similarity ratio to propose a new location.",
      ["fuzzy"], "threshold = " + AUTO_FIX_THRESHOLD);
    var targetText = target.join("\n");
    var bestStart = -1, bestRatio = 0;
    for (var s = 0; s + n <= norm.length; s++) {
      var r = ratio(norm.slice(s, s + n).join("\n"), targetText);
      var better = r >= AUTO_FIX_THRESHOLD && (r > bestRatio ||
        (r === bestRatio && Math.abs(s - original) < Math.abs(bestStart - original)));
      if (better) { bestRatio = r; bestStart = s; }
      marks = {};
      if (bestStart >= 0) for (var q = bestStart; q < bestStart + n; q++) marks[q] = "match";
      snap(s, n, "Fuzzy window " + rangeLabel(s + 1, n) + ": similarity " + r.toFixed(2) + (r >= AUTO_FIX_THRESHOLD ? " (≥ 0.75)" : " (< 0.75)") + (better ? " — new best." : "."),
        [rangeLabel(s + 1, n), "ratio " + r.toFixed(2)],
        "best so far: " + (bestStart >= 0 ? rangeLabel(bestStart + 1, n) + " · " + bestRatio.toFixed(2) : "none ≥ 0.75"));
    }
    if (bestStart >= 0) {
      snap(bestStart, n, "Best window " + rangeLabel(bestStart + 1, n) + " reaches similarity " + bestRatio.toFixed(2) + " ≥ 0.75 → NEEDS REVIEW with this location proposed. The owner sees a side-by-side diff and can accept it, keep the original lines or re-pin.",
        [rangeLabel(bestStart + 1, n), "proposed"],
        "status = OUTDATED_NEEDS_REVIEW · proposed " + rangeLabel(bestStart + 1, n) + " · similarity " + bestRatio.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
    } else {
      marks = {};
      snap(original, n, "No window reaches 0.75 → NEEDS REVIEW at the original range (clamped to the file) so the owner can re-pin.",
        [rangeLabel(ORIGINAL_START, n), "clamped"], "status = OUTDATED_NEEDS_REVIEW · proposed = original range");
    }
    return frames;
  }

  function initDrift() {
    var root = document.getElementById("algo-drift");
    if (!root) return;
    var code = qs(root, "[data-code]");
    var narration = qs(root, "[data-narration]");
    var chipBox = qs(root, "[data-chips]");
    var formula = qs(root, "[data-formula]");
    var select = qs(root, "[data-scenario]");
    var rendered = null, lineEls = [], win = null;

    function build(lines) {
      code.innerHTML = "";
      lineEls = lines.map(function (text, i) {
        var div = document.createElement("div");
        div.className = "cl";
        var ln = document.createElement("span");
        ln.className = "ln";
        ln.textContent = String(i + 1);
        div.appendChild(ln);
        div.appendChild(document.createTextNode(text));
        if (i >= ORIGINAL_START - 1 && i < ORIGINAL_START - 1 + SNAPSHOT.length) div.classList.add("orig");
        code.appendChild(div);
        return div;
      });
      win = document.createElement("div");
      win.className = "window";
      win.setAttribute("aria-hidden", "true");
      code.appendChild(win);
      rendered = lines;
    }

    var stepper = new Stepper(root, function (f) {
      if (rendered !== f.lines) build(f.lines);
      lineEls.forEach(function (el, i) {
        el.classList.remove("match");
        el.classList.remove("miss");
        if (f.marks[i]) el.classList.add(f.marks[i]);
      });
      var first = lineEls[f.start], last = lineEls[Math.min(lineEls.length - 1, f.start + f.len - 1)];
      win.style.top = first.offsetTop + "px";
      win.style.height = (last.offsetTop + last.offsetHeight - first.offsetTop) + "px";
      narration.textContent = f.text;
      chipBox.innerHTML = chips(f.chips);
      formula.textContent = f.formula;
    }, { interval: 900 });

    select.addEventListener("change", function () { stepper.load(driftFrames(select.value), 0); });
    stepper.load(driftFrames(select.value), 0);
  }

  // ------------------------------------------------------------------ boot
  function ready(fn) {
    if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    [initBfs, initDfs, initRoles, initPagerank, initDrift].forEach(function (fn) {
      try { fn(); } catch (e) { if (window.console) console.error(e); } // a failing widget keeps its static final state
    });
  });
})();
