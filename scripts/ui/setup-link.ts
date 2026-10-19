/** The Setup token and the link to Setup that the API announces while Setup isn't done. */
export type SetupLink = { token: string; url: string };

const stringProperty = (properties: object, name: string): string | undefined => {
  const value: unknown = Object.entries(properties).find(([key]) => key === name)?.[1];
  return typeof value === "string" ? value : undefined;
};

/**
 * The latest Setup token and link in the API's JSON-lines log, or undefined if
 * it logged none. A restart (`bun --watch`) logs a new token, so the last wins.
 */
export function setupLinkFromLog(log: string): SetupLink | undefined {
  let latest: SetupLink | undefined;
  for (const line of log.split("\n")) {
    if (!line.startsWith("{")) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record !== "object" || record === null || !("properties" in record)) continue;
    const { properties } = record;
    if (typeof properties !== "object" || properties === null) continue;
    const token = stringProperty(properties, "setupToken");
    const url = stringProperty(properties, "setupUrl");
    if (token !== undefined && url !== undefined) latest = { token, url };
  }
  return latest;
}
