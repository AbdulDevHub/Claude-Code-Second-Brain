---
name: api-rate-limits
description: The weather API allows 60 calls a minute; cache responses for 10 minutes
metadata:
  type: project
---

Cache every forecast for 10 minutes keyed by rounded coordinates.

**Why:** the free tier returns 429s past 60 calls a minute.
**How to apply:** go through `lib/cache.ts`, never call the API directly. Related: [[units-preference]]
