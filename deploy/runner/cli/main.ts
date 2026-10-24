import { errorText } from "../lib/config";
import { parseArgs, USAGE } from "./args";
import { runStage } from "./stage";

// `runner <command>`, run from the clone of `main` by the `runner` wrapper on
// PATH (bin/runner), so a merged change applies on the next tick:
//
//   docker compose -f deploy/runner/compose.yaml exec runner runner stage implement BAN-94

const parsed = parseArgs(process.argv.slice(2));
switch (parsed.command) {
  case "help":
    console.log(USAGE);
    break;
  case "error":
    console.error(parsed.message);
    process.exit(2);
    break;
  case "stage":
    try {
      process.exit(await runStage(parsed.kind, parsed.issue));
    } catch (error) {
      console.error(`The ${parsed.kind} Stage on ${parsed.issue} failed: ${errorText(error)}`);
      process.exit(1);
    }
}
