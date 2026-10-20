#!/usr/bin/env python3
"""Generate the fill-in HTML form from a UAT markdown file.

    python generate_uat_html.py path/to/UAT-myapp-2026-08-23.md [-o out.html]

Standard library only. Also normalises the markdown in place: injects any missing
answer/summary/findings blocks so the author only has to write the tests.

See ../references/uat-file-format.md for the file contract.
"""

import argparse
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")

ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
META_START = re.compile(r"^<!--\s*uat:meta\s*$")
SECTION_RE = re.compile(r"^<!--\s*uat:section\s+(.*?)-->\s*$")
TEST_RE = re.compile(r"^<!--\s*uat:test\s+(.*?)-->\s*$")
URL_RE = re.compile(r"^<!--\s*uat:url\s+(\S+)\s*-->\s*$")
ANS_START_RE = re.compile(r"^<!--\s*uat:answer:start\s+id=([^\s]+)\s*-->\s*$")
ANS_END_RE = re.compile(r"^<!--\s*uat:answer:end\s+id=([^\s]+)\s*-->\s*$")
ATTR_RE = re.compile(r'(\w+)=("([^"]*)"|\S+)')

EMPTY_ANSWER = [
    "- [ ] **Status:** _not answered_",
    "- **Notes:**",
    "- **Look & feel concern:**",
    "- **Screenshots:**",
]
SUMMARY_BLOCK = [
    "<!-- uat:summary:start -->",
    "_This UAT has not been run yet._",
    "<!-- uat:summary:end -->",
]
FINDINGS_BLOCK = [
    "<!-- uat:findings:start -->",
    "## Anything else the tester noticed",
    "",
    "_No tester-reported findings yet._",
    "<!-- uat:findings:end -->",
]


class UatError(Exception):
    pass


# --------------------------------------------------------------------- markdown

INLINE_RE = re.compile(r"`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*")


def esc(text):
    return html.escape(text, quote=False)


def inline(text):
    """One pass over the text: code, links, bold, italic. Everything else is escaped."""
    out, last = [], 0
    for m in INLINE_RE.finditer(text):
        out.append(esc(text[last:m.start()]))
        if m.group(1) is not None:
            out.append("<code>%s</code>" % esc(m.group(1)))
        elif m.group(2) is not None:
            out.append('<a href="%s" rel="noreferrer">%s</a>'
                       % (esc(m.group(3)).replace('"', "&quot;"), inline(m.group(2))))
        elif m.group(4) is not None:
            out.append("<strong>%s</strong>" % inline(m.group(4)))
        else:
            out.append("<em>%s</em>" % inline(m.group(5)))
        last = m.end()
    out.append(esc(text[last:]))
    return "".join(out)


def _indent(line):
    return len(line) - len(line.lstrip(" "))


LIST_ITEM = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")


def render_list(lines, i, base_indent, out):
    m = LIST_ITEM.match(lines[i])
    ordered = not m.group(2) in ("-", "*", "+")
    tag = "ol" if ordered else "ul"
    out.append("<%s>" % tag)
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            # blank line: keep going only if the next non-blank line is still in this list
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines) and LIST_ITEM.match(lines[j]) and _indent(lines[j]) >= base_indent:
                i = j
                continue
            break
        m = LIST_ITEM.match(line)
        if not m:
            break
        ind = len(m.group(1))
        if ind < base_indent:
            break
        if ind > base_indent:
            i = render_list(lines, i, ind, out)
            continue
        text = m.group(3)
        i += 1
        # a wrapped item continues on the next indented line — keep it inside the <li>
        while i < len(lines) and lines[i].strip() and not LIST_ITEM.match(lines[i]) \
                and _indent(lines[i]) > base_indent:
            text += " " + lines[i].strip()
            i += 1
        out.append("<li>%s" % inline(text))
        # nested list directly under this item
        if i < len(lines):
            nm = LIST_ITEM.match(lines[i])
            if nm and len(nm.group(1)) > base_indent:
                i = render_list(lines, i, len(nm.group(1)), out)
        out.append("</li>")
    out.append("</%s>" % tag)
    return i


def render_md(lines):
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("<!--"):
            i += 1
            continue
        if stripped.startswith("```"):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append("<pre><code>%s</code></pre>" % html.escape("\n".join(buf), quote=False))
            continue
        if stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            out.append("<h%d>%s</h%d>" % (min(level + 1, 6), inline(stripped.lstrip("# ").strip()), min(level + 1, 6)))
            i += 1
            continue
        if stripped.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip("> "))
                i += 1
            out.append("<blockquote>%s</blockquote>" % inline(" ".join(buf)))
            continue
        if LIST_ITEM.match(line):
            i = render_list(lines, i, _indent(line), out)
            continue
        buf = []
        while i < len(lines) and lines[i].strip() and not LIST_ITEM.match(lines[i]) \
                and not lines[i].strip().startswith(("#", "```", "<!--", ">")):
            buf.append(lines[i].strip())
            i += 1
        out.append("<p>%s</p>" % inline(" ".join(buf)))
    return "\n".join(out)


ABSOLUTE_URL = re.compile(r"^[a-zA-Z][\w+.-]*://")


def resolve_url(url, base):
    """A uat:url may be absolute, or relative to the meta block's base_url."""
    url = (url or "").strip()
    if not url or ABSOLUTE_URL.match(url):
        return url
    if not base:
        return url
    return base + ("" if url.startswith("/") else "/") + url


# ----------------------------------------------------------------------- parse

def parse_attrs(raw):
    attrs = {}
    for m in ATTR_RE.finditer(raw):
        attrs[m.group(1)] = m.group(3) if m.group(3) is not None else m.group(2)
    return attrs


def parse(lines, path):
    """Return (meta, sections, spans) where spans records line ranges we care about."""
    meta, sections = {}, []
    spans = {"answers": {}, "summary": None, "findings": None, "meta": None}
    cur_section = cur_test = None
    heading = None
    seen_ids = set()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if META_START.match(stripped):
            start = i
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("-->"):
                if ":" in lines[i]:
                    k, v = lines[i].split(":", 1)
                    meta[k.strip()] = v.strip()
                i += 1
            spans["meta"] = (start, i)
            i += 1
            continue
        if stripped == "<!-- uat:summary:start -->":
            start = i
            while i < len(lines) and lines[i].strip() != "<!-- uat:summary:end -->":
                i += 1
            spans["summary"] = (start, i)
            i += 1
            continue
        if stripped == "<!-- uat:findings:start -->":
            start = i
            while i < len(lines) and lines[i].strip() != "<!-- uat:findings:end -->":
                i += 1
            spans["findings"] = (start, i)
            i += 1
            continue

        m = ANS_START_RE.match(stripped)
        if m:
            aid = m.group(1)
            start = i
            while i < len(lines) and not ANS_END_RE.match(lines[i].strip()):
                i += 1
            if i >= len(lines):
                raise UatError("answer block for id=%s is never closed" % aid)
            end_id = ANS_END_RE.match(lines[i].strip()).group(1)
            if end_id != aid:
                raise UatError("answer block id mismatch: starts as %s, ends as %s" % (aid, end_id))
            if cur_test is None or cur_test["id"] != aid:
                raise UatError("answer block id=%s does not belong to the test above it" % aid)
            spans["answers"][aid] = (start, i)
            cur_test["_answer"] = (start, i)
            cur_test = None
            i += 1
            continue

        if stripped.startswith("## ") and not stripped.startswith("###"):
            heading = stripped[3:].strip()
        elif stripped.startswith("### "):
            heading = stripped[4:].strip()

        m = SECTION_RE.match(stripped)
        if m:
            a = parse_attrs(m.group(1))
            sid = a.get("id")
            if not sid or not ID_RE.match(sid):
                raise UatError("line %d: section needs a valid id" % (i + 1))
            title = a.get("title") or heading or ("Section " + sid)
            title = re.sub(r"^Section\s+%s\s*[—:-]\s*" % re.escape(sid), "", (heading or title)).strip() or title
            cur_section = {"id": sid, "title": title, "tests": [], "_line": i}
            sections.append(cur_section)
            cur_test = None
            i += 1
            continue

        m = TEST_RE.match(stripped)
        if m:
            a = parse_attrs(m.group(1))
            tid = a.get("id")
            if not tid or not ID_RE.match(tid):
                raise UatError("line %d: test needs a valid id (letters, digits, . _ -)" % (i + 1))
            if tid in seen_ids:
                raise UatError("duplicate test id %s (line %d)" % (tid, i + 1))
            seen_ids.add(tid)
            if cur_section is None:
                raise UatError("test %s is not inside any section (add a <!-- uat:section --> marker)" % tid)
            title = re.sub(r"^%s\s*" % re.escape(tid), "", (heading or tid)).strip() or tid
            cur_test = {"id": tid, "title": title, "url": "",
                        "_body_start": i + 1, "_marker": i, "_answer": None}
            cur_section["tests"].append(cur_test)
            i += 1
            continue

        m = URL_RE.match(stripped)
        if m:
            if cur_test is None:
                raise UatError("line %d: uat:url must sit inside a test" % (i + 1))
            cur_test["url"] = m.group(1)
            i += 1
            continue

        # body terminator: a new heading with no marker ends the current test body
        if cur_test is not None and (stripped.startswith("## ") or stripped.startswith("### ")):
            cur_test["_body_end"] = i
            cur_test = None
            continue

        i += 1

    return meta, sections, spans


def body_lines(lines, test):
    end = test["_answer"][0] if test["_answer"] else test.get("_body_end", len(lines))
    return lines[test["_body_start"]:end]


# ------------------------------------------------------------------- normalise

def normalise(lines, meta, sections, spans, path):
    """Insert missing answer/summary/findings blocks. Returns (lines, changed)."""
    inserts = []  # (index, [lines])
    for sec in sections:
        for t in sec["tests"]:
            if t["_answer"]:
                continue
            end = t.get("_body_end", len(lines))
            while end > t["_body_start"] and not lines[end - 1].strip():
                end -= 1
            block = ["", "<!-- uat:answer:start id=%s -->" % t["id"]] + EMPTY_ANSWER + \
                    ["<!-- uat:answer:end id=%s -->" % t["id"], ""]
            inserts.append((end, block))

    if spans["summary"] is None:
        at = spans["meta"][1] + 1 if spans["meta"] else 1
        inserts.append((at, [""] + SUMMARY_BLOCK))
    if spans["findings"] is None:
        inserts.append((len(lines), [""] + FINDINGS_BLOCK + [""]))

    if not inserts:
        return lines, False
    for at, block in sorted(inserts, key=lambda x: -x[0]):
        lines[at:at] = block
    return lines, True


# ------------------------------------------------------------------ html build

def build_model(md_path, lines, meta, sections, spans):
    slug = os.path.splitext(os.path.basename(md_path))[0]
    base = meta.get("base_url", "").strip().rstrip("/")
    title = meta.get("app") or slug
    for line in lines:
        if line.startswith("# "):
            title = line[2:].strip()
            break

    first = sections[0]["_line"] if sections else len(lines)
    # the "## Section N — ..." heading belongs to the section, not to the intro
    probe = first - 1
    while probe > 0 and not lines[probe].strip():
        probe -= 1
    if probe > 0 and lines[probe].strip().startswith("## "):
        first = probe
    intro_start = 0
    for idx, line in enumerate(lines):
        if line.startswith("# "):
            intro_start = idx + 1
            break
    hidden = set()
    for key in ("meta", "summary"):
        if spans.get(key):
            hidden.update(range(spans[key][0], spans[key][1] + 1))
    intro_lines = [lines[idx] for idx in range(intro_start, first)
                   if idx not in hidden and not lines[idx].strip().startswith("<!--")]
    intro = render_md(intro_lines)

    last_end = 0
    for sec in sections:
        for t in sec["tests"]:
            e = t["_answer"][1] if t["_answer"] else t.get("_body_end", 0)
            last_end = max(last_end, e)
    findings_span = spans.get("findings")
    outro_lines = []
    for idx in range(last_end + 1, len(lines)):
        if findings_span and findings_span[0] <= idx <= findings_span[1]:
            continue
        if lines[idx].strip().startswith("<!--"):
            continue
        outro_lines.append(lines[idx])
    outro = render_md(outro_lines)

    has_urls = any(t["url"] for sec in sections for t in sec["tests"])
    model = {
        "file": os.path.basename(md_path),
        "slug": slug,
        "title": title,
        "app": meta.get("app", ""),
        "level": meta.get("tester_level", "").strip().lower(),
        "generated": meta.get("generated", ""),
        "intro": intro,
        "outro": outro,
        "annotator": read_asset("annotate.js") if has_urls else "",
        "sections": [
            {"id": s["id"], "title": s["title"],
             "tests": [{"id": t["id"], "title": t["title"], "url": resolve_url(t["url"], base),
                        "body": render_md(body_lines(lines, t))}
                       for t in s["tests"]]}
            for s in sections
        ],
    }
    return model


def read_asset(name):
    with open(os.path.join(ASSETS, name), "r", encoding="utf-8") as fh:
        return fh.read()


def build_html(model):
    payload = (json.dumps(model, ensure_ascii=False, separators=(",", ":"))
               .replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>%s</title>\n<style>\n%s\n</style>\n</head>\n<body>\n"
        "<noscript><p style=\"padding:20px\">This checklist form needs JavaScript switched on.</p></noscript>\n"
        "<script id=\"uat-model\" type=\"application/json\">%s</script>\n"
        "<script>\n%s\n</script>\n</body>\n</html>\n"
        % (html.escape(model["title"]), read_asset("uat.css"), payload, read_asset("uat.js"))
    )


# ------------------------------------------------------------------------ main

def generate(md_path, out_path=None, quiet=False):
    with open(md_path, "r", encoding="utf-8") as fh:
        lines = fh.read().replace("\r\n", "\n").split("\n")

    meta, sections, spans = parse(lines, md_path)
    if not sections:
        raise UatError("no sections found — every section needs a <!-- uat:section id=N title=\"...\" --> marker")
    total = sum(len(s["tests"]) for s in sections)
    if not total:
        raise UatError("no tests found — every test needs a <!-- uat:test id=N.M --> marker")

    lines, changed = normalise(lines, meta, sections, spans, md_path)
    if changed:
        with open(md_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines))
        meta, sections, spans = parse(lines, md_path)
        if not quiet:
            print("normalised %s (added missing answer/summary/findings blocks)" % md_path)

    model = build_model(md_path, lines, meta, sections, spans)
    out_path = out_path or os.path.splitext(md_path)[0] + ".html"
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(build_html(model))
    if not quiet:
        print("wrote %s  (%d sections, %d tests)" % (out_path, len(sections), total))
    return out_path


def main(argv=None):
    ap = argparse.ArgumentParser(description="Generate the UAT HTML form from a UAT markdown file.")
    ap.add_argument("markdown", help="path to the UAT .md file")
    ap.add_argument("-o", "--out", help="output .html path (default: alongside the .md)")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)
    try:
        generate(args.markdown, args.out, args.quiet)
    except UatError as exc:
        print("UAT file problem: %s" % exc, file=sys.stderr)
        return 2
    except FileNotFoundError:
        print("No such file: %s" % args.markdown, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
