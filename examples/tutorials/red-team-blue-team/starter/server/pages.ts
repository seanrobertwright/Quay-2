import type { Note } from "./db.ts";

/** A whole HTML page with `title` in the tab and `inner` in the body. */
export function layout(title: string, inner: string): string {
  return (
    "<!doctype html>" +
    '<html lang="en">' +
    '<head><meta charset="utf-8"><title>' + title + "</title></head>" +
    '<body><h1>Notes</h1><p><a href="/">All notes</a></p>' + inner + "</body>" +
    "</html>"
  );
}

/** One note as a card, its title linking to the note's own page. */
export function noteCard(note: Note): string {
  return (
    '<article class="note">' +
    '<h2><a href="/notes/' + note.id + '">' + note.title + "</a></h2>" +
    "<p>" + note.body + "</p>" +
    "</article>"
  );
}
