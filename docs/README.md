# Docs

Where to look, depending on what you need.

| Doc                                      | Audience                         | What it answers                                                         |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| [README](../README.md)                   | Everyone                         | Install, tools, config, quick start                                     |
| [README (فارسی)](../README.fa.md)        | Persian speakers                 | Same as the README, in Persian                                          |
| [DEPLOY.md](DEPLOY.md)                   | Operators                        | Where to run it, egress blocking, Docker / VPS / Fly / Railway          |
| [PRIVACY.md](PRIVACY.md)                 | Users & operators                | Exactly what reaches Torob, and what never does                         |
| [SECURITY.md](../SECURITY.md)            | Reporters                        | How to report a vulnerability; in/out of scope                          |
| [THREAT_MODEL.md](THREAT_MODEL.md)       | Security review                  | Assets, trust boundaries, threats T1–T10 and residual risk              |
| [ARCHITECTURE.md](ARCHITECTURE.md)       | Contributors                     | Runtime boundary, client, cache/cursors, tools, transports              |
| [ENDPOINTS.md](ENDPOINTS.md)             | Contributors                     | Upstream URL map, params, field maps, silent-parameter gotchas          |
| [DEPENDENCIES.md](DEPENDENCIES.md)       | Contributors                     | Why each runtime dep exists; what we refuse to add                      |
| [CONTRIBUTING.md](../CONTRIBUTING.md)    | Contributors                     | Setup, non-negotiable rules, PR expectations                            |

## Start here

- **Just want to use it?** → [README](../README.md) (or [فارسی](../README.fa.md)).
- **Deploying remotely?** → [DEPLOY.md](DEPLOY.md) — read the egress warning first.
- **Changing how we talk to Torob?** → [ENDPOINTS.md](ENDPOINTS.md) + fixture + zod schema together.
- **Adding a dependency?** → Justify it in [DEPENDENCIES.md](DEPENDENCIES.md) first.
