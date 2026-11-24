# Running Jobhunter on a server

Server mode runs the same engine and web UI as the desktop app, inside one Docker container. Use it to keep Jobhunter running all the time on a home server, a NAS or a small VPS. It is built for **one person**: one password, one data volume.

What is different from the desktop app:

| | Desktop | Server |
|---|---|---|
| Sign-in | none (only your user account can reach it) | one password, session cookie |
| Secrets | OS keychain | AES-256-GCM encrypted file in the data volume, key from `JOBHUNTER_MASTER_KEY` |
| Claude login | `claude auth login` on your computer | `claude auth login` inside the container, saved in the data volume |
| Applying | visible browser window, you can step in | headless browser; anything needing a login, CAPTCHA or 2FA stops and waits for you to finish by hand |
| Notifications | OS notifications | in-app notifications and the daily digest |

## 1. Start it

```bash
git clone https://github.com/Pizajolo/Jobhunter.git
```

```bash
cd Jobhunter && cp docker/.env.example docker/.env
```

Generate a master key and put it in `docker/.env` as `JOBHUNTER_MASTER_KEY=`:

```bash
openssl rand -base64 32
```

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

You can also use the published image: replace the `build:` block in `docker-compose.yml` with `image: ghcr.io/pizajolo/jobhunter:latest`.

The master key encrypts the secrets file (API key, Gmail refresh token, IMAP app password). **Keep it outside the data volume**, for example in your password manager. Without it the secrets file cannot be read, so you would have to enter those secrets again. Instead of the variable you can mount a file and set `JOBHUNTER_MASTER_KEY_FILE=/run/secrets/jobhunter_master_key`, for example as a Docker secret.

## 2. Choose your password

On first start no password exists yet. The engine prints a one-time **setup code** to its log:

```bash
docker compose -f docker/docker-compose.yml logs jobhunter | grep "setup code"
```

Open Jobhunter (see step 4), enter the setup code and choose a password of at least 12 characters. The password is stored only as an argon2id hash. Sign-in attempts are rate-limited (10 per 15 minutes). The session cookie is `HttpOnly` and `SameSite=Strict`, and every state-changing request needs a CSRF token as well.

To set the setup code yourself instead of reading the log, add `JOBHUNTER_SETUP_CODE=...` to `docker/.env` before the first start. Forgot your password? Add `JOBHUNTER_RESET_PASSWORD=1` to `docker/.env` and restart the container. The old password and all sessions are removed and a new setup code is printed to the log. Choose a new password, then remove the line again. Your data stays.

You can change the password while signed in under Settings → General.

## 3. Sign in to Claude

Using your Claude subscription (the default):

```bash
docker compose -f docker/docker-compose.yml exec -it jobhunter claude auth login
```

This is the official Claude Code login. It opens a link you visit in your own browser. Jobhunter never sees your Claude credentials; Claude Code stores them in `/data/claude` in the data volume. See [CLAUDE_ACCOUNT.md](CLAUDE_ACCOUNT.md) for API keys and other options.

## 4. Reach it safely

The compose file publishes the port on **127.0.0.1 only**. Do not change it to `0.0.0.0:4317`. Pick one of these:

- **SSH tunnel** (nothing to set up): run the command below, then open http://127.0.0.1:4317.

  ```bash
  ssh -L 4317:127.0.0.1:4317 your-server
  ```

- **Tailscale** (recommended for phone access): install Tailscale on the server and your devices, then publish Jobhunter inside your tailnet only. Run the command below and open the `https://<server>.<tailnet>.ts.net` URL it prints.

  ```bash
  tailscale serve --bg 4317
  ```

  Don't use `tailscale funnel`: it makes the service public on the internet.

- **Reverse proxy with TLS** (Caddy example):

  ```
  jobhunter.example.com {
      reverse_proxy 127.0.0.1:4317
  }
  ```

  Caddy gets the certificate automatically. Serve Jobhunter only over HTTPS, so the session cookie is never sent in plain text.

If you use Gmail OAuth through a reverse proxy, set `JOBHUNTER_PUBLIC_URL=https://jobhunter.example.com` so the redirect URL is correct, and add that redirect URL to your OAuth client. The SSH tunnel and IMAP options need no extra setup ([GMAIL_OAUTH.md](GMAIL_OAUTH.md), [GMAIL_IMAP.md](GMAIL_IMAP.md)).

## Backups and updates

Everything lives in the `jobhunter-data` volume: the SQLite database, generated documents, screenshots, the browser profile, the Claude login and the encrypted secrets file.

```bash
docker run --rm -v jobhunter_jobhunter-data:/data -v "$PWD":/backup alpine tar czf /backup/jobhunter-backup.tgz -C /data .
```

To update, pull or rebuild and restart. Database migrations run automatically on start.

```bash
git pull && docker compose -f docker/docker-compose.yml up -d --build
```

## Settings reference

| Variable | Default (in the image) | Meaning |
|---|---|---|
| `JOBHUNTER_MASTER_KEY` / `JOBHUNTER_MASTER_KEY_FILE` | required | Key for the encrypted secrets file |
| `JOBHUNTER_SETUP_CODE` | random, printed to the log | One-time code for choosing the first password |
| `JOBHUNTER_PUBLIC_URL` | unset | Public HTTPS URL, used for the Gmail OAuth redirect |
| `JOBHUNTER_PORT` | `4317` | Port inside the container |
| `JOBHUNTER_DATA_DIR` | `/data` | Data folder |
| `JOBHUNTER_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `TZ` | `Europe/Zurich` | Time zone for the daily scan and the digest |

`JOBHUNTER_HOST=0.0.0.0` inside the container is needed so Docker can forward the port; the host side is still bound to 127.0.0.1 by the compose file.
