/* RepoAtlas docs — API reference renderer (no dependencies).
 *
 * Fetches openapi.json (regenerated from the backend by .github/workflows/docs.yml on every
 * deploy), groups operations by tag and renders method, path, summary, auth level, parameters,
 * request body and response schemas ($refs resolved into nested tables), a curl example and a
 * per-operation anchor (#op-<method>-<path>). A search box filters operations.
 */
(function () {
  "use strict";

  // Routes that declare `OptionalUser` in backend/app/api/v1/routes/*.py. FastAPI lists the bearer
  // scheme under `security` for both optional and required auth, so the distinction lives here.
  var OPTIONAL_AUTH = {
    "POST /api/v1/repos/analyze": true,
    "GET /api/v1/tours": true,
    "GET /api/v1/tours/{tour_id}": true
  };
  var METHODS = ["get", "post", "put", "patch", "delete"];
  var MAX_DEPTH = 6;
  var EXAMPLES = {
    repo_url: "https://github.com/owner/repo",
    branch: "main",
    file_path: "src/app.py",
    title: "Where requests enter",
    body_markdown: "Explain what these lines do.",
    question: "Which file handles routing?",
    action: "accept_proposed"
  };

  var spec = null;

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function refName(ref) { return ref.split("/").pop(); }
  function schemas() { return (spec.components && spec.components.schemas) || {}; }
  function resolve(s) {
    var guard = 0;
    while (s && s.$ref && guard++ < 32) s = schemas()[refName(s.$ref)];
    return s || {};
  }
  function nonNull(list) { return list.filter(function (x) { return x.type !== "null"; }); }
  function stripNull(s) {
    if (s && s.anyOf) {
      var rest = nonNull(s.anyOf);
      if (rest.length === 1) return rest[0];
    }
    return s;
  }
  function slug(method, path) {
    return "op-" + method + "-" + path.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  }

  // ------------------------------------------------------------ schema text
  function typeLabel(s) {
    if (!s) return "any";
    if (s.$ref) return refName(s.$ref);
    var alts = s.anyOf || s.oneOf;
    if (alts) return alts.map(typeLabel).join(" | ");
    if (s.const !== undefined) return JSON.stringify(s.const);
    if (s.type === "array") return "array<" + typeLabel(s.items) + ">";
    if (s.type === "object" && !s.properties) {
      if (s.additionalProperties && typeof s.additionalProperties === "object" && Object.keys(s.additionalProperties).length) {
        return "map<" + (s.propertyNames ? typeLabel(s.propertyNames) : "string") + ", " + typeLabel(s.additionalProperties) + ">";
      }
      return "object";
    }
    var t = s.type || (s.properties ? "object" : "any");
    if (s.format) t += " (" + s.format + ")";
    return t;
  }

  function constraints(s) {
    var parts = [];
    var sources = [s].concat(s.anyOf ? nonNull(s.anyOf) : []);
    sources.forEach(function (x) {
      if (x.minLength != null) parts.push("min length " + x.minLength);
      if (x.maxLength != null) parts.push("max length " + x.maxLength);
      if (x.minimum != null) parts.push("≥ " + x.minimum);
      if (x.maximum != null) parts.push("≤ " + x.maximum);
      if (x.minItems != null) parts.push("min items " + x.minItems);
      if (x.maxItems != null) parts.push("max items " + x.maxItems);
      var e = x.enum ? x : x.$ref ? resolve(x) : null;
      if (e && e.enum) {
        parts.push('<span class="enum">one of ' + e.enum.map(function (v) { return "<code>" + esc(v) + "</code>"; }).join(", ") + "</span>");
      }
      if (x.items) {
        var it = x.items.$ref ? resolve(x.items) : x.items;
        if (it.enum) parts.push('<span class="enum">items one of ' + it.enum.map(function (v) { return "<code>" + esc(v) + "</code>"; }).join(", ") + "</span>");
        if (it.minLength != null) parts.push("item min length " + it.minLength);
        if (it.maxLength != null) parts.push("item max length " + it.maxLength);
      }
    });
    if (s.default !== undefined) parts.push("default <code>" + esc(JSON.stringify(s.default)) + "</code>");
    return parts;
  }

  // Object schemas worth expanding below a field.
  function expandable(s) {
    if (!s) return [];
    if (s.$ref) {
      var r = resolve(s);
      return r.properties ? [{ name: refName(s.$ref), schema: r }] : [];
    }
    var alts = s.anyOf || s.oneOf;
    if (alts) return nonNull(alts).reduce(function (acc, x) { return acc.concat(expandable(x)); }, []);
    if (s.type === "array") return expandable(s.items);
    if (s.type === "object" && !s.properties && s.additionalProperties && typeof s.additionalProperties === "object") {
      return expandable(s.additionalProperties);
    }
    if (s.properties) return [{ name: s.title || "object", schema: s }];
    return [];
  }

  function renderObject(schema, depth, stack) {
    var props = schema.properties || {};
    var names = Object.keys(props);
    if (!names.length) return '<p class="muted small">No fields.</p>';
    var required = schema.required || [];
    var rows = names.map(function (name) {
      var p = props[name];
      var desc = [];
      if (p.description) desc.push(esc(p.description));
      var cons = constraints(p);
      if (cons.length) desc.push(cons.join(" · "));
      var nested = "";
      if (depth < MAX_DEPTH) {
        expandable(p).forEach(function (item) {
          if (stack.indexOf(item.name) >= 0) return;
          nested += '<details><summary>' + esc(item.name) + " fields</summary>" +
            '<div class="nested">' + renderObject(item.schema, depth + 1, stack.concat(item.name)) + "</div></details>";
        });
      }
      return "<tr><td><code>" + esc(name) + "</code>" + (required.indexOf(name) >= 0 ? '<span class="req" title="required">*</span>' : "") +
        '</td><td><span class="type">' + esc(typeLabel(p)) + "</span></td><td>" + (desc.join("<br>") || '<span class="muted">—</span>') + nested + "</td></tr>";
    });
    return '<div class="table-wrap"><table><thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Details</th></tr></thead><tbody>' +
      rows.join("") + "</tbody></table></div>";
  }

  function renderSchemaBlock(s) {
    if (!s) return "";
    var label = '<p><span class="type">' + esc(typeLabel(s)) + "</span></p>";
    var items = expandable(s);
    if (!items.length) return label;
    return label + items.map(function (it) { return renderObject(it.schema, 1, [it.name]); }).join("");
  }

  // ------------------------------------------------------------ examples
  function sample(s, depth, name) {
    if (depth > 4 || !s) return null;
    if (name && Object.prototype.hasOwnProperty.call(EXAMPLES, name)) return EXAMPLES[name];
    if (s.$ref) return sample(resolve(s), depth, name);
    if (s.anyOf) return sample(nonNull(s.anyOf)[0], depth, name);
    if (s.default !== undefined) return s.default;
    if (s.const !== undefined) return s.const;
    if (s.enum) return s.enum[0];
    if (s.type === "string") {
      if (s.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      if (s.format === "date-time") return "2025-01-01T00:00:00Z";
      return "string";
    }
    if (s.type === "integer" || s.type === "number") return s.minimum != null ? Math.max(1, s.minimum) : 1;
    if (s.type === "boolean") return false;
    if (s.type === "array") {
      var one = sample(s.items, depth + 1);
      var n = s.minItems || 1;
      var arr = [];
      for (var i = 0; i < n; i++) arr.push(one);
      return arr;
    }
    if (s.properties) {
      var out = {};
      var req = s.required && s.required.length ? s.required : Object.keys(s.properties);
      req.forEach(function (k) { out[k] = sample(s.properties[k], depth + 1, k); });
      return out;
    }
    return null;
  }

  function curlFor(method, path, op, auth) {
    var base = (window.REPOATLAS_API_URL || "").trim().replace(/\/+$/, "") || "https://<your-api-host>";
    var query = (op.parameters || []).filter(function (p) { return p.in === "query" && p.required; })
      .map(function (p) { return p.name + "=" + (p.name === "path" ? "src/app.py" : "value"); });
    var url = base + path + (query.length ? "?" + query.join("&") : "");
    var lines = ["curl -X " + method.toUpperCase() + ' "' + url + '"'];
    if (auth !== "public") lines.push('  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"');
    var body = op.requestBody && op.requestBody.content && op.requestBody.content["application/json"];
    if (body && body.schema) {
      lines.push('  -H "Content-Type: application/json"');
      lines.push("  -d '" + JSON.stringify(sample(body.schema, 0)) + "'");
    }
    return lines.join(" \\\n");
  }

  // ------------------------------------------------------------ operations
  function authLevel(method, path, op) {
    if (!op.security || !op.security.length) return "public";
    return OPTIONAL_AUTH[method.toUpperCase() + " " + path] ? "optional" : "required";
  }
  var AUTH_PILL = {
    "public": '<span class="auth-pill">Public</span>',
    optional: '<span class="auth-pill">Auth optional</span>',
    required: '<span class="auth-pill req">Auth required</span>'
  };

  function renderParams(params) {
    if (!params || !params.length) return "";
    var rows = params.map(function (p) {
      var s = p.schema || {};
      var desc = [];
      if (p.description) desc.push(esc(p.description));
      var cons = constraints(s);
      if (cons.length) desc.push(cons.join(" · "));
      return "<tr><td><code>" + esc(p.name) + "</code>" + (p.required ? '<span class="req" title="required">*</span>' : "") +
        "</td><td>" + esc(p.in) + '</td><td><span class="type">' + esc(typeLabel(s)) + "</span></td><td>" +
        (desc.join("<br>") || '<span class="muted">—</span>') + "</td></tr>";
    });
    return '<h4>Parameters</h4><div class="schema"><div class="table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">In</th><th scope="col">Type</th><th scope="col">Details</th></tr></thead><tbody>' +
      rows.join("") + "</tbody></table></div></div>";
  }

  function renderRequestBody(rb) {
    if (!rb) return "";
    var c = rb.content && rb.content["application/json"];
    if (!c || !c.schema) return "";
    return "<h4>Request body" + (rb.required ? "" : " (optional)") + '</h4><div class="schema">' + renderSchemaBlock(c.schema) + "</div>";
  }

  function renderResponses(responses) {
    var codes = Object.keys(responses || {}).sort();
    var html = codes.map(function (code) {
      var r = responses[code];
      var c = r.content && r.content["application/json"];
      var s = c && c.schema;
      var head = '<p><strong>' + esc(code) + "</strong> · " + esc(r.description || "") + "</p>";
      if (code === "422" && s && s.$ref && refName(s.$ref) === "HTTPValidationError") {
        return head + '<p class="small muted">Returned in the standard error envelope with code <code>VALIDATION_ERROR</code> and <code>details.errors</code> = list of <code>{loc, msg, type}</code>. (The OpenAPI document lists FastAPI\'s default <code>HTTPValidationError</code> schema; the API\'s exception handler replaces it.)</p>';
      }
      if (!s) return head;
      var resolved = resolve(s);
      if (resolved.title && resolved.title.indexOf("ApiResponse[") === 0 && resolved.properties && resolved.properties.data) {
        var data = stripNull(resolved.properties.data);
        return head + '<p class="small">Envelope <code>{"success": true, "data": …, "error": null}</code> where <code>data</code> is:</p>' +
          '<div class="schema">' + renderSchemaBlock(data) + "</div>";
      }
      return head + '<div class="schema">' + renderSchemaBlock(s) + "</div>";
    }).join("");
    return "<h4>Responses</h4>" + html +
      '<p class="small muted">Errors use the <a href="#envelope">error envelope</a>; see <a href="#errors">error codes</a>.</p>';
  }

  function renderOperation(method, path, op) {
    var id = slug(method, path);
    var auth = authLevel(method, path, op);
    var search = [method, path, op.summary || "", (op.tags || []).join(" "), op.operationId || "", auth].join(" ").toLowerCase();
    var curl = curlFor(method, path, op, auth);
    return '<details class="op" id="' + esc(id) + '" data-search="' + esc(search) + '"' +
      (op.operationId ? ' data-operation-id="' + esc(op.operationId) + '"' : "") + ">" +
      "<summary>" +
      '<span class="method m-' + method + '">' + method.toUpperCase() + "</span>" +
      '<span class="op-path">' + esc(path) + "</span>" +
      AUTH_PILL[auth] +
      '<span class="op-summary">' + esc(op.summary || "") + "</span>" +
      "</summary>" +
      '<div class="op-body">' +
      '<p class="op-link"><a href="#' + esc(id) + '">Permalink</a>' + (op.operationId ? ' · operationId <code>' + esc(op.operationId) + "</code>" : "") + "</p>" +
      (op.description ? "<p>" + esc(op.description) + "</p>" : "") +
      renderParams(op.parameters) +
      renderRequestBody(op.requestBody) +
      renderResponses(op.responses) +
      "<h4>Example</h4><pre><code class=\"language-bash\">" + esc(curl) + "</code></pre>" +
      "</div></details>";
  }

  function render(root) {
    var tagMeta = {};
    var order = [];
    (spec.tags || []).forEach(function (t) { tagMeta[t.name] = t; order.push(t.name); });
    var groups = {};
    var total = 0;
    Object.keys(spec.paths || {}).forEach(function (path) {
      var item = spec.paths[path];
      METHODS.forEach(function (m) {
        if (!item[m]) return;
        var tag = (item[m].tags && item[m].tags[0]) || "other";
        if (!groups[tag]) { groups[tag] = []; if (order.indexOf(tag) < 0) order.push(tag); }
        groups[tag].push({ method: m, path: path, op: item[m] });
        total++;
      });
    });
    var html = order.filter(function (t) { return groups[t]; }).map(function (tag) {
      var ops = groups[tag].sort(function (a, b) {
        return a.path < b.path ? -1 : a.path > b.path ? 1 : METHODS.indexOf(a.method) - METHODS.indexOf(b.method);
      });
      var meta = tagMeta[tag] || {};
      return '<section class="api-tag" id="tag-' + esc(tag) + '" data-tag aria-labelledby="tag-h-' + esc(tag) + '">' +
        '<h3 id="tag-h-' + esc(tag) + '">' + esc(tag) + ' <a class="anchor" href="#tag-' + esc(tag) + '" aria-label="Permalink to ' + esc(tag) + '">#</a></h3>' +
        (meta.description ? "<p>" + esc(meta.description) + "</p>" : "") +
        ops.map(function (o) { return renderOperation(o.method, o.path, o.op); }).join("") +
        "</section>";
    }).join("");
    var info = spec.info || {};
    root.innerHTML = '<p class="small muted">' + esc(info.title || "API") + " · version " + esc(info.version || "?") +
      " · OpenAPI " + esc(spec.openapi || "") + " · " + total + " operations</p>" + html;
    if (window.RepoAtlasDocs && window.RepoAtlasDocs.initCode) window.RepoAtlasDocs.initCode(root);
    return total;
  }

  // ------------------------------------------------------------ search + anchors
  function initSearch(root, total) {
    var input = document.getElementById("api-search");
    var count = document.querySelector("[data-api-count]");
    var ops = Array.prototype.slice.call(root.querySelectorAll(".op"));
    var tags = Array.prototype.slice.call(root.querySelectorAll("[data-tag]"));
    function apply() {
      var terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      var shown = 0;
      ops.forEach(function (op) {
        var hay = op.getAttribute("data-search");
        var ok = terms.every(function (t) { return hay.indexOf(t) >= 0; });
        op.hidden = !ok;
        if (ok) shown++;
      });
      tags.forEach(function (t) { t.hidden = !t.querySelector(".op:not([hidden])"); });
      if (count) count.textContent = terms.length ? shown + " of " + total + " endpoints" : total + " endpoints";
    }
    input.disabled = false;
    input.addEventListener("input", apply);
    apply();
  }

  function openFromHash() {
    var id = decodeURIComponent((location.hash || "").slice(1));
    if (!id) return;
    var el = document.getElementById(id) || document.querySelector('[data-operation-id="' + id.replace(/"/g, "") + '"]');
    if (el && el.tagName === "DETAILS") {
      el.hidden = false;
      el.open = true;
      el.scrollIntoView({ block: "start" });
    }
  }

  function fail(state, err) {
    var isFile = location.protocol === "file:";
    state.innerHTML = isFile
      ? "<strong>The endpoint list can't load from a local file.</strong> Browsers block <code>fetch()</code> of <code>openapi.json</code> on <code>file://</code> pages. " +
        "Serve the folder over HTTP instead — for example <code>python3 -m http.server 8080 --directory docs</code> and open <code>http://localhost:8080/api.html</code> — " +
        'or read the <a href="openapi.json">raw OpenAPI document</a>. Everything above this section works offline.'
      : "<strong>Couldn't load the OpenAPI document.</strong> " + esc(err && err.message ? err.message : "Unknown error") +
        '. Try reloading, or open the <a href="openapi.json">raw OpenAPI document</a>.';
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    var root = document.querySelector("[data-api-root]");
    if (!root) return;
    var state = root.querySelector("[data-api-state]");
    if (!window.fetch) { fail(state, new Error("This browser does not support fetch()")); return; }
    fetch("openapi.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status + " for openapi.json");
        return res.json();
      })
      .then(function (json) {
        spec = json;
        var total = render(root);
        initSearch(root, total);
        openFromHash();
        window.addEventListener("hashchange", openFromHash);
      })
      .catch(function (err) { fail(state, err); });
  });
})();
