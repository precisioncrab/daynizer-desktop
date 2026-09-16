# Standalone Radicale — for a dedicated always-on server

Daynizer is a **desktop app**. It bundles an optional built-in sync server so it works with zero setup
if you don't already have one — but if you want a server that runs 24/7 on its own hardware (a
Raspberry Pi, a Proxmox VM/LXC, an old laptop, a NAS with Docker support), the better fit is to run a
**standalone** copy of [Radicale](https://github.com/Kozea/Radicale) there and point Daynizer, your
phone, and anything else at it — rather than trying to keep a full desktop app alive headless on that
box.

Radicale is the easiest of the standalone CalDAV/CardDAV servers to stand up (if you already have a
Synology, its built-in Calendar + Contacts apps are just as easy and need no install at all — see the
main [README](../../README.md#connecting-a-caldav--carddav-server-synology-nextcloud-)). Any other
RFC-compliant CalDAV/CardDAV server (Baïkal, Nextcloud, Xandikos, DAViCal, SOGo, …) works with Daynizer
too — Radicale is just the lightest-weight option to self-host from scratch.

This folder has a ready-to-run Docker Compose setup: Radicale + [Caddy](https://caddyserver.com/) in
front of it for HTTPS (self-signed, LAN-only — same trust model as Daynizer's own bundled server, so
the "click through the certificate warning once" experience is familiar either way). Modern Android
(Tasks.org's direct CalDAV, some DAVx5 setups) refuses plain HTTP, so TLS isn't optional if a phone is
in the picture.

**Not yet smoke-tested end-to-end against a real client** — this is copy-paste-and-verify, not
copy-paste-and-trust. Report back what breaks.

## Prerequisites

Docker + the Docker Compose plugin on the target box. On Raspberry Pi OS / Debian / Ubuntu:

```
curl -fsSL https://get.docker.com | sh
```

(adds Docker's own repo and installs `docker` + the `compose` plugin; safe to re-run.)

## Setup

All commands from this folder (`server/standalone/`) on the target box.

1. **Create a user.** No local Python needed — this uses the Radicale image itself, which already has
   `bcrypt` available (it needs it to read bcrypt htpasswd files):

   ```
   mkdir -p config data
   docker run --rm -it tomsquest/docker-radicale python3 -c "
   import bcrypt, getpass
   u = input('Username: ')
   p = getpass.getpass('Password: ')
   print(f'{u}:{bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()}')
   " >> config/users
   ```

   (Alternative, if you already have this repo cloned and Python available: `server/make-user.py` — the
   same script Daynizer's own bundled server uses to create its self-account — does the same thing:
   `python3 make-user.py config/users <username> <password>`.)

   Repeat for more than one user; each gets its own line in `config/users`, and — because of the
   `owner_only` rights model this compose file sets — its own private calendars/address books.

2. **Start it:**

   ```
   docker compose up -d
   ```

   First run, Caddy generates its own local certificate authority and a certificate for itself — no
   external calls, no domain needed.

3. **Point clients at `https://<box-ip>:5232/`** — same address for both CalDAV and CardDAV, same as
   Daynizer's own bundled server. In Daynizer: **Settings → Add account**, paste that URL into both the
   CalDAV URL and CardDAV URL fields, with the username/password from step 1. Click **Test connection**
   first — first-time connections need **Allow self-signed certificates** ticked (see the main
   README's self-hosted-HTTPS note) since the cert is self-signed.

4. **Phone / other apps:** same address, same credentials — see the main README's "Other servers"
   section for the exact URL shape (`https://<box-ip>:5232/` or `https://<box-ip>:5232/<user>/`).

## Browsing it directly

Radicale ships its own minimal web UI by default (Daynizer's bundled server has the same thing — see
**Settings → Sync Server → "Advanced: browse the server directly"** there). Open
`https://<box-ip>:5232/` in a plain browser tab and log in with the same username/password to see (and
manually create/delete) collections — useful for troubleshooting, not needed for normal use.

## If you don't need HTTPS (Thunderbird / desktop clients only, no phone)

Drop the `caddy` service from `docker-compose.yml` and change Radicale's port mapping to
`"5232:5232"` (currently `127.0.0.1:5232:5232`, loopback-only, since Caddy is normally the only thing
meant to be reachable from the LAN). Plain HTTP is simpler but modern Android will refuse to sync
against it.

## Updating

```
docker compose pull && docker compose up -d
```

Your data (`./data/`) and users (`./config/users`) aren't touched by an image update.
