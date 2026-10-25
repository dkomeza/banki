import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The host's firewall rules for the runner's and the Dashboard's networks, run against a fake
// iptables that keeps the rules in a file, the way iptables keeps them in the
// kernel: so a test reads exactly what the script left in each chain.

const SCRIPT = join(import.meta.dir, "host-firewall");
const SUBNETS = ["10.213.94.0/24", "10.213.96.0/24"];
const PRIVATE = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "169.254.0.0/16",
];

const dir = mkdtempSync(join(tmpdir(), "banki-host-firewall-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The fake: `-w` is dropped; -N fails on a chain that exists; -F empties one;
// -A appends; -I <chain> 1 prepends; -C succeeds when the rule is there.
// Each rule is a line `<chain> <rule…>` in $RULES, and chains are `:<chain>`.
const fake = join(dir, "iptables");
writeFileSync(
  fake,
  `#!/usr/bin/env bash
set -u
[ "$1" = -w ] && shift
op="$1" chain="$2"; shift 2
touch "$RULES"
case "$op" in
  -N) grep -qx ":$chain" "$RULES" && exit 1; echo ":$chain" >>"$RULES" ;;
  -F) grep -v "^$chain " "$RULES" >"$RULES.tmp" || true; mv "$RULES.tmp" "$RULES" ;;
  -A) echo "$chain $*" >>"$RULES" ;;
  -I) shift; { echo "$chain $*"; cat "$RULES"; } >"$RULES.tmp"; mv "$RULES.tmp" "$RULES" ;;
  -C) grep -qx "$chain $*" "$RULES" ;;
  *) echo "fake iptables: $op" >&2; exit 2 ;;
esac
`,
);
chmodSync(fake, 0o755);

async function apply(rules: string) {
  const proc = Bun.spawn(["bash", SCRIPT], {
    env: { PATH: process.env.PATH ?? "", IPTABLES: fake, RULES: rules },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { stderr, exitCode };
}

/** The rules in one chain, in order. */
const chain = (rules: string, name: string) =>
  readFileSync(rules, "utf8")
    .split("\n")
    .filter((line) => line.startsWith(`${name} `))
    .map((line) => line.slice(name.length + 1));

describe("host-firewall", () => {
  test("passes bash -n", async () => {
    expect(await Bun.spawn(["bash", "-n", SCRIPT]).exited).toBe(0);
  });

  test.skipIf(Bun.which("shellcheck") === null)("passes shellcheck", async () => {
    const proc = Bun.spawn(["shellcheck", SCRIPT], { stdout: "pipe" });
    expect(await new Response(proc.stdout).text()).toBe("");
  });

  test("sends the runner's and the Dashboard's traffic, and only theirs, through the Runner's chains, first", async () => {
    const rules = join(dir, "forward");

    expect((await apply(rules)).exitCode).toBe(0);
    expect(chain(rules, "DOCKER-USER").toSorted()).toEqual(
      SUBNETS.map((subnet) => `-s ${subnet} -j BANKI-RUNNER-FORWARD`),
    );
    expect(chain(rules, "INPUT").toSorted()).toEqual(
      SUBNETS.map((subnet) => `-s ${subnet} -j BANKI-RUNNER-INPUT`),
    );
  });

  test("drops every private range, after letting DNS through", async () => {
    const rules = join(dir, "private");
    await apply(rules);

    expect(chain(rules, "BANKI-RUNNER-FORWARD")).toEqual([
      "-p udp --dport 53 -j RETURN",
      "-p tcp --dport 53 -j RETURN",
      ...PRIVATE.map((range) => `-d ${range} -j DROP`),
    ]);
  });

  test("drops everything to the host itself, at any of its addresses, but DNS and the replies to what the host started", async () => {
    const rules = join(dir, "host");
    await apply(rules);

    expect(chain(rules, "BANKI-RUNNER-INPUT")).toEqual([
      "-m conntrack --ctstate ESTABLISHED -j RETURN",
      "-p udp --dport 53 -j RETURN",
      "-p tcp --dport 53 -j RETURN",
      "-j DROP",
    ]);
  });

  test("names the subnets compose.yaml gives the runner and the Dashboard", async () => {
    const compose = await Bun.file(join(import.meta.dir, "compose.yaml")).text();

    for (const subnet of SUBNETS) expect(compose).toContain(`- subnet: ${subnet}`);
  });

  test("changes nothing when run again", async () => {
    const rules = join(dir, "again");
    const chains = ["DOCKER-USER", "INPUT", "BANKI-RUNNER-FORWARD", "BANKI-RUNNER-INPUT"];
    await apply(rules);
    const first = chains.map((name) => chain(rules, name));

    await apply(rules);

    expect(chains.map((name) => chain(rules, name))).toEqual(first);
  });

  test("puts its jump in front of rules already there, such as Docker's", async () => {
    const rules = join(dir, "docker");
    writeFileSync(rules, ":DOCKER-USER\nDOCKER-USER -j RETURN\n");

    await apply(rules);

    expect(chain(rules, "DOCKER-USER").at(-1)).toBe("-j RETURN");
    expect(chain(rules, "DOCKER-USER")).toHaveLength(3);
  });
});
