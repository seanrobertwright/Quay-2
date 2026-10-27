# Notes

A notes app for two users, alice and bob. Each of them writes notes, can share a note with the
other, and sees their own notes plus every shared one. It has a JSON API under `/api/notes` and
two HTML pages, `/` and `/notes/<id>`, built from SQLite with `node:sqlite` and served by Hono.
Log in by visiting `/login/alice` or `/login/bob`.

`AGENTS.md` holds the rules the app must keep. `test/notes.test.ts` checks the everyday features.
Run it with `npm test`.

To run the server, copy `.env.example` to `.env`, then run `npm start` and open
<http://localhost:3000/login/alice>. It needs Node 24 or later, which runs TypeScript as it is.
