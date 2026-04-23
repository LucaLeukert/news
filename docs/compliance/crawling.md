# Crawling Compliance

The crawler must:

- Use a clear user agent with contact email.
- Respect robots.txt and per-source policy rows.
- Back off on `403`, `429`, and `5xx`.
- Avoid paywall bypassing and login-wall scraping.
- Store raw HTML only in R2 when legally allowed.
- Display only metadata, short snippets, and publisher links publicly.
- Honor `no_snippet` and `do_not_crawl` source policy fields.
- Keep a takedown workflow visible in admin tooling.

RSS and Google News RSS entries are not final article records. They must be verified against canonical publisher pages before clustering unless a source has an explicit manual exception.
