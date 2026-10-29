// PROTOTYPE (#370). Lets Node run the prototype's extensionless TS imports:
//   node --experimental-transform-types --import ./scale/register.mjs scale/<script>.ts
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) {
    try { return await next(specifier + ".ts", context); } catch {}
  }
  return next(specifier, context);
}`),
  import.meta.url,
);
