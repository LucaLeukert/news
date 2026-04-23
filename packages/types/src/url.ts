export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  const removableParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
  ];

  for (const key of removableParams) {
    url.searchParams.delete(key);
  }

  const sorted = [...url.searchParams.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  url.search = "";
  for (const [key, value] of sorted) {
    url.searchParams.append(key, value);
  }

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

export function sameRegistrableHost(a: string, b: string): boolean {
  const hostA = new URL(a).hostname.replace(/^www\./, "");
  const hostB = new URL(b).hostname.replace(/^www\./, "");
  return (
    hostA === hostB ||
    hostA.endsWith(`.${hostB}`) ||
    hostB.endsWith(`.${hostA}`)
  );
}
