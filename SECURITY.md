# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in LumenFlow, please report it
responsibly. **Do not open a public GitHub issue.**

Email: security@hellm.ai

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 5 business days
- **Fix timeline**: depends on severity, but we aim for:
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: next release

## Supported Versions

| Version  | Supported |
| -------- | --------- |
| latest   | Yes       |
| < latest | No        |

We only provide security fixes for the latest release. We recommend always
running the most recent version.

## Scope

The following are in scope for security reports:

- **LumenFlow Kernel** — policy bypass, sandbox escape, evidence tampering
- **Runtime** — daemon privilege escalation, socket permission issues
- **Packs** — tool execution outside declared scopes
- **Surfaces** — input injection, authentication bypass
- **Control Plane SDK** — credential leakage, MITM vulnerabilities

Out of scope:

- Vulnerabilities in dependencies (report upstream, but let us know)
- Social engineering attacks
- Denial of service via resource exhaustion (unless trivially exploitable)

## Recognition

We credit security researchers in our release notes (unless you prefer to
remain anonymous). We do not currently offer a bug bounty program.
