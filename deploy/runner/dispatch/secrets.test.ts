import { describe, expect, test } from "bun:test";
import { redactTokens } from "./secrets";

// What a stop comment's log tail never shows. Fake values, built at runtime
// so secret scanners don't flag them.

const join = (...parts: string[]) => parts.join("_");
const GH = [join("ghs", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"), join("ghp", "Z9y8X7w6V5u4T3s2R1q0P9o8N7")];
const PAT = join("github", "pat", "11ABCDEFG0123456789", "abcdefghijklmnopqrstuvwxyz");
const LIN = join("lin", "oauth", "0123456789abcdef0123456789abcdef");
const CLAUDE = ["sk", "ant", "oat01", "Ab3_dE-f6Gh9Jk2Lm5Np8Qr1St4Vw7Yz0"].join("-");

describe("a log's tail, redacted", () => {
  test("hides the tokens it is given, whatever they look like", () => {
    expect(redactTokens("token=s3cr3t-value-123 done", ["s3cr3t-value-123"])).toBe(
      "token=[redacted] done",
    );
  });

  test("hides anything shaped like a GitHub or Linear token", () => {
    for (const token of [...GH, PAT, LIN]) {
      expect(redactTokens(`tool: Bash echo ${token} | gh auth login`)).toBe(
        "tool: Bash echo [redacted] | gh auth login",
      );
    }
  });

  test("hides anything shaped like a Claude token, which the Dashboard doesn't hold to hide by value", () => {
    expect(redactTokens(`CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE} claude -p`)).toBe(
      "CLAUDE_CODE_OAUTH_TOKEN=[redacted] claude -p",
    );
    expect(redactTokens("tool: Bash grep -r sk-ant- .")).toBe("tool: Bash grep -r sk-ant- .");
  });

  test("hides the value after Bearer or an Authorization header", () => {
    expect(redactTokens('tool: Bash curl -H "Authorization: Bearer abc.def-ghi" https://x')).toBe(
      'tool: Bash curl -H "Authorization: Bearer [redacted]" https://x',
    );
    expect(redactTokens("Authorization: token zzz123 and more")).toBe(
      "Authorization: [redacted] and more",
    );
  });

  test("leaves ordinary text alone", () => {
    expect(redactTokens("tool: Bash bun test ./lin_x.ts")).toBe("tool: Bash bun test ./lin_x.ts");
  });
});
