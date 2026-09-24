# Security policy

`torob-mcp` runs on other people's machines and its output is read by an LLM that can call other
tools. Security reports are welcome and taken seriously.

[Docs index](docs/README.md) · [Threat model](docs/THREAT_MODEL.md) · [Privacy](docs/PRIVACY.md)

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting:

1. Go to the [Security tab](https://github.com/siamak/torob-mcp/security/advisories/new).
2. Open a draft advisory describing the issue, affected versions, and a reproduction.

You should get a first response within a week. If a fix is warranted we will prepare it under the
advisory, credit you unless you prefer otherwise, and publish with a CVE where appropriate.

## In scope

- SSRF, or any way to make the server contact a host other than `torob.com` / `api.torob.com`.
- Prompt injection that survives `packages/core/src/lib/sanitize.ts` and reaches a tool result in a
  form the model is likely to act on.
- Anything reachable on the HTTP transport without the configured bearer token, DNS rebinding, or a
  bypass of the Origin/Host checks.
- Leaking data from the machine, the operator's environment, or a third party (for example the
  merchant billing fields `shop_profile` deliberately filters out).
- Dependency or release-pipeline compromise: unpinned actions, publish flows, the Docker image.

## Out of scope

- Vulnerabilities in torob.com itself. Report those to Torob; this project is unaffiliated.
- Prompt injection in general. Sanitization reduces the surface but cannot eliminate it — see
  T2 in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). Concrete bypasses of the specific controls
  are in scope; "an LLM can be persuaded by text" is not.
- Running with `--insecure`, or binding a public interface deliberately. Both are documented,
  require an explicit flag, and warn at startup.
- Denial of service against your own instance by configuring limits away.

## Supported versions

The latest minor release receives security fixes.

## What this server does with your data

No telemetry, no analytics, no disk persistence, no cookie jar. What reaches Torob is listed in
[`docs/PRIVACY.md`](docs/PRIVACY.md).
