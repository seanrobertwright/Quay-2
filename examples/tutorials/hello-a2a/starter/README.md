# hello-a2a

A tiny package that greets people in English, Spanish or French:

```text
> node src/cli.ts Ada fr
Bonjour, Ada!
```

`src/greet.ts` holds `greet(name, lang)`, `src/cli.ts` is the command line, and
`test/greet.test.ts` has a test for each language. Everything here is finished and every test
passes.

This package is only something real for an agent to read. The tutorial it comes with is about
agents messaging each other, not about this code.

It needs Node 24 or later, which runs TypeScript as it is.
