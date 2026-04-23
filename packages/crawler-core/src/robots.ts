export type RobotsPolicy = {
  allowed: boolean;
  crawlDelayMs: number;
  matchedRule: string | null;
};

export function parseRobotsTxt(text: string, userAgent = "*") {
  const groups: Array<{
    agents: string[];
    rules: Array<{ type: "allow" | "disallow"; path: string }>;
    delay?: number;
  }> = [];
  let current: (typeof groups)[number] | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      current = { agents: [value.toLowerCase()], rules: [] };
      groups.push(current);
    } else if (current && key === "allow") {
      current.rules.push({ type: "allow", path: value });
    } else if (current && key === "disallow") {
      current.rules.push({ type: "disallow", path: value });
    } else if (current && key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) current.delay = seconds * 1000;
    }
  }

  return {
    evaluate(pathname: string): RobotsPolicy {
      const group =
        groups.find((candidate) =>
          candidate.agents.includes(userAgent.toLowerCase()),
        ) ?? groups.find((candidate) => candidate.agents.includes("*"));

      if (!group)
        return { allowed: true, crawlDelayMs: 1000, matchedRule: null };

      const matching = group.rules
        .filter((rule) => rule.path && pathname.startsWith(rule.path))
        .sort((a, b) => b.path.length - a.path.length)[0];

      return {
        allowed: matching?.type !== "disallow",
        crawlDelayMs: group.delay ?? 1000,
        matchedRule: matching ? `${matching.type}:${matching.path}` : null,
      };
    },
  };
}
