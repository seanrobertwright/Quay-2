#!/usr/bin/env python3
"""Local helper for filling in a UAT.

    python uat_server.py path/to/UAT-myapp-2026-08-23.md

Regenerates the HTML form, serves it at http://localhost:8777, and:
  * Save        -> writes .uat-progress-<slug>.json so nothing is ever lost
  * screenshots -> saved into assets/<slug>/ and linked from the markdown
  * Submit      -> validates, then writes the answers back into the markdown
                   and drops a machine-readable <name>.results.json

Standard library only. Binds to 127.0.0.1 (this computer only). Stop it with Ctrl+C.
"""

import argparse
import base64
import binascii
import datetime
import html
import json
import mimetypes
import os
import posixpath
import re
import urllib.parse
import socket
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_uat_html as gen  # noqa: E402

MAX_UPLOAD = 8 * 1024 * 1024
MAX_BODY = 24 * 1024 * 1024
EXT_BY_MIME = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
               "image/webp": ".webp", "image/avif": ".avif"}
STATUS_MD = {"pass": ("x", "PASS"), "fail": ("!", "FAIL"), "notdone": ("~", "NOT DONE")}
SEV_LABEL = {"cosmetic": "Cosmetic", "annoying": "Annoying", "blocker": "Blocks me"}


class Ctx(object):
    def __init__(self, md_path):
        self.md_path = os.path.abspath(md_path)
        self.dir = os.path.dirname(self.md_path)
        self.slug = os.path.splitext(os.path.basename(self.md_path))[0]
        self.html_path = os.path.join(self.dir, self.slug + ".html")
        self.progress_path = os.path.join(self.dir, ".uat-progress-%s.json" % self.slug)
        self.results_path = os.path.join(self.dir, self.slug + ".results.json")
        self.assets_dir = os.path.join(self.dir, "assets", self.slug)
        self.lock = threading.Lock()
        self.current_test = ""      # set by /goto, read by the annotator
        self.annotations = []       # parked until the checklist tab collects them
        self.port = 0               # set once the server is bound

    def own_origins(self):
        return {"http://localhost:%d" % self.port, "http://127.0.0.1:%d" % self.port}

    def own_hosts(self):
        return {"localhost:%d" % self.port, "127.0.0.1:%d" % self.port}

    def app_origins(self):
        """Origins of the app under test (base_url and absolute uat:url markers); the annotator runs there."""
        try:
            lines = self.load_md()
            meta, sections, _ = gen.parse(lines, self.md_path)
        except (OSError, gen.UatError):
            return set()
        base = meta.get("base_url", "").strip().rstrip("/")
        urls = [base] + [gen.resolve_url(t.get("url", ""), base) for s in sections for t in s["tests"]]
        origins = set()
        for u in urls:
            parts = urllib.parse.urlsplit(u or "")
            if parts.scheme in ("http", "https") and parts.netloc:
                origins.add("%s://%s" % (parts.scheme, parts.netloc.lower()))
        return origins - self.own_origins()

    def load_md(self):
        with open(self.md_path, "r", encoding="utf-8") as fh:
            return fh.read().replace("\r\n", "\n").split("\n")

    def url_for(self, test_id):
        """The app URL a test's uat:url marker points at, resolved against base_url."""
        lines = self.load_md()
        meta, sections, _ = gen.parse(lines, self.md_path)
        base = meta.get("base_url", "").strip().rstrip("/")
        for sec in sections:
            for t in sec["tests"]:
                if t["id"] == test_id:
                    return gen.resolve_url(t.get("url", ""), base)
        return ""

    def index(self):
        """{test_id: {title, section}} plus parsed spans, from the current markdown."""
        lines = self.load_md()
        meta, sections, spans = gen.parse(lines, self.md_path)
        info = {}
        for s in sections:
            for t in s["tests"]:
                info[t["id"]] = {"title": t["title"], "section": s["id"]}
        return lines, meta, sections, spans, info


# ------------------------------------------------------------------ validation

def validate(state, info, partial):
    problems = []
    if not (state.get("tester") or "").strip():
        problems.append({"id": None, "msg": "No tester name was filled in."})
    answers = state.get("answers") or {}
    for tid in info:
        a = answers.get(tid) or {}
        status = (a.get("status") or "").strip()
        notes = (a.get("notes") or "").strip()
        concern = (a.get("concern") or "").strip()
        if not status:
            if not partial:
                problems.append({"id": tid, "msg": "Test %s has no answer yet." % tid})
            continue
        if status not in STATUS_MD:
            problems.append({"id": tid, "msg": "Test %s has an unknown status %r." % (tid, status)})
            continue
        if status in ("fail", "notdone") and len(notes) < 10:
            problems.append({"id": tid, "msg": "Test %s is marked %s but has no explanation."
                             % (tid, STATUS_MD[status][1])})
        if concern and not (a.get("severity") or "").strip():
            problems.append({"id": tid, "msg": "Test %s has a look-and-feel comment with no severity." % tid})
    for f in state.get("findings") or []:
        fid = f.get("id", "?")
        if not (f.get("title") or "").strip():
            problems.append({"id": fid, "msg": "Finding %s has no title." % fid})
        if not (f.get("description") or "").strip():
            problems.append({"id": fid, "msg": "Finding %s has no description." % fid})
        if not (f.get("severity") or "").strip():
            problems.append({"id": fid, "msg": "Finding %s has no severity." % fid})
    return problems


def counts_of(state, info):
    c = {"pass": 0, "fail": 0, "notdone": 0, "unanswered": 0, "concerns": 0,
         "findings": len(state.get("findings") or [])}
    answers = state.get("answers") or {}
    for tid in info:
        a = answers.get(tid) or {}
        st = a.get("status") or ""
        c[st if st in STATUS_MD else "unanswered"] += 1
        if (a.get("concern") or "").strip():
            c["concerns"] += 1
    return c


# ------------------------------------------------------------- markdown writing

def shot_lines(owner, shots):
    out = []
    for i, s in enumerate(shots or []):
        path = s.get("path") if isinstance(s, dict) else s
        if not path or path.startswith("data:"):
            continue
        out.append("  - ![%s screenshot %d](%s)" % (owner, i + 1, path))
    return out


def answer_md(tid, a):
    a = a or {}
    status = a.get("status") or ""
    notes = (a.get("notes") or "").strip()
    concern = (a.get("concern") or "").strip()
    sev = SEV_LABEL.get((a.get("severity") or "").strip(), "")
    if status in STATUS_MD:
        box, label = STATUS_MD[status]
        head = "- [%s] **Status:** %s" % (box, label)
    else:
        head = "- [ ] **Status:** _not answered_"
    lines = [head]
    lines.append("- **Notes:** " + (notes.replace("\n", "\n  ") if notes else "_none_"))
    if concern:
        lines.append("- **Look & feel concern:** (%s) %s" % (sev or "unrated", concern.replace("\n", "\n  ")))
    else:
        lines.append("- **Look & feel concern:** _none_")
    shots = shot_lines(tid, a.get("screenshots"))
    lines.append("- **Screenshots:**" + ("" if shots else " _none_"))
    lines.extend(shots)
    return lines


def summary_md(state, info, counts, partial, when):
    tester = (state.get("tester") or "").strip() or "unnamed tester"
    answers = state.get("answers") or {}
    failed = sorted([t for t in info if (answers.get(t) or {}).get("status") == "fail"], key=natural)
    notdone = sorted([t for t in info if (answers.get(t) or {}).get("status") == "notdone"], key=natural)
    concerned = sorted([t for t in info if ((answers.get(t) or {}).get("concern") or "").strip()], key=natural)
    unanswered = sorted([t for t in info if not (answers.get(t) or {}).get("status")], key=natural)
    total = len(info)
    lines = [
        "> **Run status:** %s — submitted %s by %s" % ("PARTIAL (unfinished)" if partial else "COMPLETE", when, tester),
        "> **Result:** %d of %d passed · %d failed · %d not done · %d look-and-feel concerns · %d other findings"
        % (counts["pass"], total, counts["fail"], counts["notdone"], counts["concerns"], counts["findings"]),
        ">",
        "> | Status | Count |",
        "> |---|---|",
        "> | Pass | %d |" % counts["pass"],
        "> | Fail | %d |" % counts["fail"],
        "> | Not done | %d |" % counts["notdone"],
        "> | Unanswered | %d |" % counts["unanswered"],
        ">",
    ]
    lines.append("> **Failed tests:** " + (", ".join(failed) if failed else "none"))
    if notdone:
        lines.append("> **Not done:** " + ", ".join(notdone))
    lines.append("> **Tests with look-and-feel concerns:** " + (", ".join(concerned) if concerned else "none"))
    if unanswered:
        lines.append("> **Never answered:** " + ", ".join(unanswered))
    return lines


def findings_md(state):
    fs = state.get("findings") or []
    head = ["## Anything else the tester noticed", ""]
    if not fs:
        return head + ["_No tester-reported findings._"]
    out = list(head)
    for f in fs:
        fid = f.get("id", "F?")
        out.append("### %s — %s" % (fid, (f.get("title") or "").strip() or "(no title)"))
        sec = (f.get("section") or "").strip()
        out.append("- **Reported from:** " + ("Section %s" % sec if sec else "the end of the checklist"))
        out.append("- **Severity:** " + SEV_LABEL.get((f.get("severity") or "").strip(), "unrated"))
        out.append("- **What happened:** " + (f.get("description") or "").strip().replace("\n", "\n  "))
        shots = shot_lines(fid, f.get("screenshots"))
        out.append("- **Screenshots:**" + ("" if shots else " _none_"))
        out.extend(shots)
        out.append("")
    return out[:-1]


def natural(s):
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", str(s))]


def write_markdown(ctx, state, partial):
    with ctx.lock:
        lines, meta, sections, spans, info = ctx.index()
        counts = counts_of(state, info)
        when = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        answers = state.get("answers") or {}

        edits = []  # (start, end_inclusive, replacement_lines) — markers kept, body replaced
        for tid, span in spans["answers"].items():
            edits.append((span[0] + 1, span[1] - 1, answer_md(tid, answers.get(tid))))
        if spans["summary"]:
            edits.append((spans["summary"][0] + 1, spans["summary"][1] - 1,
                          summary_md(state, info, counts, partial, when)))
        if spans["findings"]:
            edits.append((spans["findings"][0] + 1, spans["findings"][1] - 1, findings_md(state)))

        for start, end, repl in sorted(edits, key=lambda e: -e[0]):
            lines[start:end + 1] = repl

        # refresh the meta block's tester/date lines if present
        if spans["meta"]:
            ms, me = spans["meta"]
            block = lines[ms:me + 1]
            block = [l for l in block if not l.strip().startswith(("tester:", "last_run:"))]
            block = block[:-1] + ["tester: " + (state.get("tester") or "").strip(),
                                  "last_run: " + when] + block[-1:]
            lines[ms:me + 1] = block

        with open(ctx.md_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines))

        results = {
            "uat": os.path.basename(ctx.md_path),
            "tester": (state.get("tester") or "").strip(),
            "submitted": datetime.datetime.now().isoformat(timespec="seconds"),
            "partial": bool(partial),
            "counts": counts,
            "answers": {},
            "findings": state.get("findings") or [],
        }
        for tid, meta_t in info.items():
            a = answers.get(tid) or {}
            results["answers"][tid] = {
                "status": a.get("status") or "unanswered",
                "title": meta_t["title"],
                "section": meta_t["section"],
                "notes": (a.get("notes") or "").strip(),
                "concern": (a.get("concern") or "").strip(),
                "severity": (a.get("severity") or "").strip(),
                "screenshots": [s.get("path") for s in (a.get("screenshots") or [])
                                if isinstance(s, dict) and s.get("path", "").startswith("assets/")],
            }
        with open(ctx.results_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(results, fh, indent=2, ensure_ascii=False)

        return counts, results


# ---------------------------------------------------------------------- server

class Handler(BaseHTTPRequestHandler):
    ctx = None
    server_version = "UATHelper/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    # --- helpers

    # routes the annotator calls from the app's origin; every other route is same-origin only
    ANNOTATOR_ROUTES = ("/api/current-test", "/api/annotate", "/annotate.js", "/receive")

    cors_origin = None

    def guard(self, path):
        """Refuse requests from any page but the checklist itself (and the app, on annotator routes).

        The Host check stops DNS rebinding; the Origin check stops another site in the same browser
        reading the run or posting to save/submit, which would rewrite the checklist.
        """
        self.cors_origin = None
        if (self.headers.get("Host") or "").lower() not in self.ctx.own_hosts():
            self.send_json({"error": "forbidden host"}, 403)
            return False
        origin = (self.headers.get("Origin") or "").lower()
        annotator = path in self.ANNOTATOR_ROUTES or path.startswith("/vendor/")
        if annotator and origin and origin in self.ctx.app_origins():
            self.cors_origin = origin
            return True
        if origin and origin not in self.ctx.own_origins():
            self.send_json({"error": "forbidden origin"}, 403)
            return False
        if not origin and self.command in ("POST", "OPTIONS"):
            # browsers always send Origin on these; a request without one is not from the checklist
            self.send_json({"error": "missing origin"}, 403)
            return False
        return True

    def cors(self):
        """Only the app's own origin, and only on annotator routes (see guard)."""
        self.send_header("Vary", "Origin")
        if self.cors_origin:
            self.send_header("Access-Control-Allow-Origin", self.cors_origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, markup, code=200):
        body = markup.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.guard(self.path.split("?", 1)[0]):
            return
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("request body missing or too large")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def safe_path(self, url_path):
        rel = posixpath.normpath(url_path.lstrip("/"))
        if rel in ("", "."):
            return self.ctx.html_path
        if rel.startswith("..") or os.path.isabs(rel):
            return None
        full = os.path.abspath(os.path.join(self.ctx.dir, *rel.split("/")))
        if os.path.commonpath([full, self.ctx.dir]) != self.ctx.dir:
            return None
        return full

    # --- routes

    def do_GET(self):
        parts = self.path.split("?", 1)
        path = parts[0]
        query = urllib.parse.parse_qs(parts[1]) if len(parts) > 1 else {}
        if not self.guard(path):
            return

        if path == "/goto":
            return self.handle_goto(query)
        if path == "/api/current-test":
            try:
                _, _, sections, _, _ = self.ctx.index()
            except gen.UatError:
                sections = []
            listing = [{"id": t["id"], "title": t["title"]} for s in sections for t in s["tests"]]
            cur = self.ctx.current_test
            title = next((t["title"] for t in listing if t["id"] == cur), "")
            return self.send_json({"test": cur, "title": title, "tests": listing})
        if path == "/api/annotations":
            after = int((query.get("after") or ["0"])[0] or 0)
            items = self.ctx.annotations[after:]
            return self.send_json({"items": items, "cursor": len(self.ctx.annotations)})
        if path == "/annotate.js":
            # the bookmarklet carries this inline (so a strict CSP cannot block it);
            # this route is the same code, for diagnostics and for pages without a CSP
            with open(os.path.join(gen.ASSETS, "annotate.js"), "rb") as fh:
                data = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.cors()
            self.end_headers()
            return self.wfile.write(data)
        if path.startswith("/vendor/"):
            name = posixpath.basename(path)
            full = os.path.join(gen.ASSETS, "vendor", name)
            if not os.path.isfile(full) or "/" in name or "\\" in name:
                return self.send_json({"error": "not found"}, 404)
            with open(full, "rb") as fh:
                data = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.cors()
            self.end_headers()
            return self.wfile.write(data)

        if path == "/api/state":
            state = {}
            if os.path.exists(self.ctx.progress_path):
                try:
                    with open(self.ctx.progress_path, "r", encoding="utf-8") as fh:
                        state = json.load(fh)
                except Exception:
                    state = {}
            return self.send_json({"state": state})
        full = self.safe_path(path)
        if not full or not os.path.isfile(full):
            return self.send_json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = self.path.split("?")[0]
        if not self.guard(path):
            return

        if path == "/receive":
            # CSP fallback: the annotator submits a form into a popup instead of fetching
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if 0 < length <= MAX_BODY else ""
            fields = urllib.parse.parse_qs(raw)
            try:
                data = json.loads((fields.get("payload") or ["{}"])[0])
            except ValueError:
                return self.send_html("<p>That did not arrive in one piece. Please try again.</p>", 400)
            result = self.store_annotation(data)
            if not result.get("ok"):
                return self.send_html("<p>Could not save: %s</p>"
                                      % html.escape(str(result.get("error", "unknown"))), 400)
            return self.send_html(
                "<title>Saved</title>"
                "<body style=\"font:16px system-ui;padding:28px;text-align:center\">"
                "<h2>Saved to test %s</h2><p>You can close this window and go back to the checklist.</p>"
                "<script>setTimeout(function(){window.close()},1500)</script>"
                % html.escape(str(data.get("test", "?"))))

        try:
            payload = self.read_json()
        except Exception as exc:
            return self.send_json({"error": "bad request: %s" % exc}, 400)

        if path == "/api/annotate":
            return self.send_json(self.store_annotation(payload))

        if path == "/api/save":
            state = payload.get("state") or {}
            state["updatedAt"] = int(datetime.datetime.now().timestamp() * 1000)
            with open(self.ctx.progress_path, "w", encoding="utf-8", newline="\n") as fh:
                json.dump(state, fh, indent=2, ensure_ascii=False)
            print("  saved progress (%d answers)" % len(state.get("answers") or {}))
            return self.send_json({"ok": True})

        if path == "/api/upload":
            return self.handle_upload(payload)

        if path == "/api/submit":
            return self.handle_submit(payload)

        return self.send_json({"error": "unknown endpoint"}, 404)

    def save_data_url(self, owner, data_url):
        """Write a base64 data: URL into the assets folder. Returns (relative_path, error)."""
        if not owner or not gen.ID_RE.match(owner):
            return None, "bad owner id"
        m = re.match(r"^data:([\w/+.-]+);base64,(.*)$", data_url or "", re.S)
        if not m:
            return None, "that file was not an image"
        mime, b64 = m.group(1), m.group(2)
        if mime not in EXT_BY_MIME:
            return None, "unsupported image type %s" % mime
        try:
            raw = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            return None, "the image could not be decoded"
        if len(raw) > MAX_UPLOAD:
            return None, "that image is larger than 8 MB"
        os.makedirs(self.ctx.assets_dir, exist_ok=True)
        ext = EXT_BY_MIME[mime]
        n = 1
        while os.path.exists(os.path.join(self.ctx.assets_dir, "%s-%d%s" % (owner, n, ext))):
            n += 1
        name = "%s-%d%s" % (owner, n, ext)
        with open(os.path.join(self.ctx.assets_dir, name), "wb") as fh:
            fh.write(raw)
        rel = "assets/%s/%s" % (self.ctx.slug, name)
        print("  saved image %s (%.0f KB)" % (rel, len(raw) / 1024.0))
        return rel, None

    def handle_upload(self, payload):
        rel, err = self.save_data_url(str(payload.get("owner") or "").strip(), payload.get("dataUrl"))
        if err:
            return self.send_json({"error": err}, 400)
        return self.send_json({"ok": True, "path": rel})

    def handle_goto(self, query):
        """Record which test the tester is about to look at, then send them to the app."""
        test = (query.get("test") or [""])[0]
        try:
            _, _, sections, _, _ = self.ctx.index()
        except gen.UatError as exc:
            return self.send_html("<p>The checklist file has a problem: %s</p>" % html.escape(str(exc)), 500)
        hit = next((t for s in sections for t in s["tests"] if t["id"] == test), None)
        if not hit:
            return self.send_html("<p>No test called %s in this checklist.</p>" % html.escape(test), 404)
        url = self.ctx.url_for(hit["id"])
        if not url:
            return self.send_html(
                "<p>Test %s has no <code>uat:url</code> marker, so there is nothing to open.</p>"
                % html.escape(test), 404)
        self.ctx.current_test = test
        print("  tester is now on test %s -> %s" % (test, url))
        self.send_response(302)
        self.send_header("Location", url)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def store_annotation(self, data):
        test = str(data.get("test") or "").strip()
        try:
            _, _, _, _, info = self.ctx.index()
        except gen.UatError as exc:
            return {"ok": False, "error": "the checklist file has a problem: %s" % exc}
        if test not in info:
            return {"ok": False, "error": "no test called %s in this checklist" % test}
        pins = [p for p in (data.get("pins") or []) if (p.get("comment") or "").strip()]
        if not pins:
            return {"ok": False, "error": "every pin needs a comment"}

        image = ""
        raw_image = data.get("image") or ""
        if raw_image:
            image, err = self.save_data_url(test + "-annot", raw_image)
            if err:
                return {"ok": False, "error": err}

        record = {
            "test": test,
            "title": info[test]["title"],
            "pins": [{"n": p.get("n"), "comment": (p.get("comment") or "").strip(),
                      "selector": p.get("selector") or "", "tag": p.get("tag") or "",
                      "text": p.get("text") or ""} for p in pins],
            "image": image,
            "url": data.get("url") or "",
            "viewport": data.get("viewport") or "",
            "browser": data.get("browser") or "",
            "consoleErrors": [str(e) for e in (data.get("consoleErrors") or [])][:5],
            "at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        }
        with self.ctx.lock:
            self.ctx.annotations.append(record)
            index = len(self.ctx.annotations)
        print("  annotation for test %s: %d pin(s)%s"
              % (test, len(pins), " + image" if image else " (no image)"))
        return {"ok": True, "index": index}

    def handle_submit(self, payload):
        state = payload.get("state") or {}
        partial = bool(payload.get("partial"))
        try:
            _, _, _, _, info = self.ctx.index()
        except gen.UatError as exc:
            return self.send_json({"error": "the checklist file has a problem: %s" % exc}, 500)
        problems = validate(state, info, partial)
        if problems:
            return self.send_json({"ok": False, "error": "Some answers are missing.", "problems": problems}, 200)

        state["updatedAt"] = int(datetime.datetime.now().timestamp() * 1000)
        with open(self.ctx.progress_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(state, fh, indent=2, ensure_ascii=False)

        try:
            counts, _ = write_markdown(self.ctx, state, partial)
        except Exception as exc:  # noqa: BLE001 - report anything back to the browser
            return self.send_json({"error": "could not write the checklist: %s" % exc}, 500)

        try:
            gen.generate(self.ctx.md_path, self.ctx.html_path, quiet=True)
        except Exception:
            pass

        summary = ("%d passed, %d failed, %d not done, %d look-and-feel concerns, %d other findings."
                   % (counts["pass"], counts["fail"], counts["notdone"], counts["concerns"], counts["findings"]))
        if partial:
            summary += " %d test(s) were left unanswered — the report is marked as unfinished." % counts["unanswered"]
        print("\n  SUBMITTED — %s" % summary)
        print("  wrote %s" % self.ctx.md_path)
        print("  wrote %s\n" % self.ctx.results_path)
        return self.send_json({
            "ok": True, "partial": partial, "summary": summary,
            "mdPath": self.ctx.md_path,
            "mdRel": os.path.basename(self.ctx.md_path),
            "results": self.ctx.results_path,
        })


def pick_port(preferred):
    for port in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("Could not find a free port between %d and %d." % (preferred, preferred + 19))


def main(argv=None):
    ap = argparse.ArgumentParser(description="Serve a UAT checklist form and write the answers back into the markdown.")
    ap.add_argument("markdown", help="path to the UAT .md file")
    ap.add_argument("-p", "--port", type=int, default=8777)
    ap.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    args = ap.parse_args(argv)

    if not os.path.isfile(args.markdown):
        print("No such file: %s" % args.markdown, file=sys.stderr)
        return 2
    ctx = Ctx(args.markdown)
    try:
        gen.generate(ctx.md_path, ctx.html_path, quiet=True)
    except gen.UatError as exc:
        print("UAT file problem: %s" % exc, file=sys.stderr)
        return 2

    if not 1 <= args.port <= 65535:
        print("Port must be between 1 and 65535, got %d." % args.port, file=sys.stderr)
        return 2
    port = pick_port(args.port)
    ctx.port = port
    Handler.ctx = ctx
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = "http://localhost:%d/" % port

    print("")
    print("  UAT helper is running.")
    print("  Checklist : %s" % ctx.md_path)
    print("  Open this in your web browser:  %s" % url)
    print("  Leave this window open while you work. Press Ctrl+C here when you are finished.")
    print("")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped. Your answers are in %s" % ctx.progress_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
