import type { Contact } from "../src/dedupe.ts";

/** How many contacts the bench makes, and how many duplicate groups they hold. */
export const CONTACT_COUNT = 50_000;
export const GROUP_COUNT = 2_500;

const FIRST = ["Ada", "Grace", "Alan", "Edsger", "Barbara", "Donald", "Frances", "Ken", "Radia", "Tim"];
const LAST = ["Lovelace", "Hopper", "Turing", "Dijkstra", "Liskov", "Knuth", "Allen", "Thompson", "Perlman", "Berners-Lee"];

/** A seeded generator (mulberry32), so every run makes the same contacts. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ten digits that no other person shares. */
function digits(person: number): string {
  return String(2_000_000_000 + person * 37);
}

function formatPhone(tenDigits: string, style: number): string {
  const [area, exchange, line] = [tenDigits.slice(0, 3), tenDigits.slice(3, 6), tenDigits.slice(6)];
  return [`(${area}) ${exchange}-${line}`, `${area}.${exchange}.${line}`, `${area}-${exchange}-${line}`, tenDigits][style % 4];
}

function emailOf(person: number, name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${person}@example.com`;
}

/**
 * 50,000 contacts, shuffled, that hold exactly 2,500 duplicate groups: 1,500 pairs that share an
 * email written differently, 500 pairs that share a phone written differently, and 500 groups of
 * three joined by an email and then a phone. Every other contact is someone else, and one in ten of
 * those has no email or no phone.
 */
export function makeContacts(): Contact[] {
  const next = random(20261024);
  const contacts: Omit<Contact, "id">[] = [];
  let person = 0;

  const someone = () => {
    person += 1;
    const name = `${FIRST[person % FIRST.length]} ${LAST[Math.floor(person / FIRST.length) % LAST.length]}`;
    return { person, name, email: emailOf(person, name), phone: digits(person) };
  };

  for (let group = 0; group < GROUP_COUNT; group++) {
    const p = someone();
    const q = someone();
    if (group < 1_500) {
      contacts.push({ name: p.name, email: p.email, phone: formatPhone(p.phone, group) });
      contacts.push({ name: p.name, email: ` ${p.email.toUpperCase()} `, phone: formatPhone(q.phone, group + 1) });
    } else if (group < 2_000) {
      contacts.push({ name: p.name, email: p.email, phone: formatPhone(p.phone, group) });
      contacts.push({ name: p.name, email: q.email, phone: formatPhone(p.phone, group + 1) });
    } else {
      const r = someone();
      contacts.push({ name: p.name, email: p.email, phone: formatPhone(p.phone, group) });
      contacts.push({ name: p.name, email: p.email.replace(/^./, (c) => c.toUpperCase()), phone: formatPhone(q.phone, group) });
      contacts.push({ name: p.name, email: r.email, phone: formatPhone(q.phone, group + 2) });
    }
  }

  while (contacts.length < CONTACT_COUNT) {
    const p = someone();
    const blank = person % 20;
    contacts.push({
      name: p.name,
      email: blank === 0 ? "" : p.email,
      phone: blank === 10 ? "" : formatPhone(p.phone, person),
    });
  }

  for (let i = contacts.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [contacts[i], contacts[j]] = [contacts[j], contacts[i]];
  }
  return contacts.map((contact, index) => ({ id: `c${String(index + 1).padStart(5, "0")}`, ...contact }));
}
