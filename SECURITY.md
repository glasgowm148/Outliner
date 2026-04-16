# Security Policy

TabRows is a small self-hosted app with basic email/password authentication. It is suitable for private or small-team deployments, but it is not a hardened enterprise identity system.

## Supported Versions

Security fixes target the current `main` branch.

## Reporting A Vulnerability

If GitHub private vulnerability reporting is enabled for this repository, use that first. Otherwise, open a minimal public issue that describes the affected area without exploit details, and the maintainer can arrange a private follow-up channel.

Please include:

- affected route or file
- impact
- reproduction steps
- whether authentication is required
- any suggested fix

## Deployment Baseline

Before exposing TabRows beyond localhost:

- serve it only over HTTPS
- set `TABROWS_SECURE_COOKIES=1`
- set `TABROWS_ALLOW_REGISTRATION=0` after creating intended accounts, unless open registration is deliberate
- keep `data/tabrows.sqlite` backed up and outside any static web root
- put Node behind a reverse proxy with request and body size limits
- keep Node and npm dependencies updated

## Current Security Model

- sessions use `HttpOnly`, `SameSite=Lax` cookies
- mutating API routes require same-origin requests
- mutating API routes require the bundled client header `X-TabRows-Request: 1`
- JSON bodies require `application/json`
- auth attempts are rate-limited in-process
- markdown rendering sanitizes links and image URLs
- public list responses are read-only and omit owner email addresses

These controls reduce common risks, but they do not replace HTTPS, backups, operational monitoring, or external abuse protection.
