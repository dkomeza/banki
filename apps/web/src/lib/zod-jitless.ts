import { config } from "zod";

// zod compiles object schemas with `new Function` when it can, probing for it
// as each object schema is created. The CSP (script-src 'self', no
// 'unsafe-eval') forbids that, so the probe would report a violation: parse
// without compiling. main.tsx imports this before any module that defines a
// schema, @banki/shared's included.
config({ jitless: true });
