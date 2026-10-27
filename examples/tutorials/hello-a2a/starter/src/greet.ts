export type Lang = "en" | "es" | "fr";

const GREETINGS: Record<Lang, string> = {
  en: "Hello",
  es: "Hola",
  fr: "Bonjour",
};

/** Greets `name` in `lang`, for example `greet("Ada", "fr")` is `Bonjour, Ada!`. */
export function greet(name: string, lang: Lang): string {
  return `${GREETINGS[lang]}, ${name}!`;
}

export function isLang(value: string): value is Lang {
  return Object.hasOwn(GREETINGS, value);
}
