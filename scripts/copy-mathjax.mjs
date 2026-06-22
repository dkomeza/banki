import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const source = path.join(process.cwd(), "node_modules", "mathjax", "es5");
const destination = path.join(process.cwd(), "public", "mathjax");
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
