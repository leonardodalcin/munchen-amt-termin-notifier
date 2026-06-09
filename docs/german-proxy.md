# German HTTP proxy for captcha-gated services

The captcha that gates high-demand immigration services is verified against
`captcha-prod.muenchen.de`, which **only resolves from inside Germany**. GitHub's
runners are outside Germany, so those checks need to exit through a German
HTTP(S) proxy. This guide sets up a tiny, cheap one on a German VPS and wires it
into CI via the `MUC_PROXY_URL` secret.

Non-captcha services (Führerschein, Einbürgerung, …) run direct and need none of
this — only services marked `"captcha": true` in `services.json` use the proxy.

## 1. Create a German VPS

Any provider with a German region works. [Hetzner Cloud](https://www.hetzner.com/cloud)
is a good fit (German company, Nuremberg/Falkenstein datacenters, ~€4/month):

- Image: **Ubuntu 24.04**
- Type: the smallest (e.g. **CX22**) is plenty
- Location: **Nuremberg** or **Falkenstein** (Germany)

Note the server's public IP (referred to as `VPS_IP` below).

## 2. Install & configure tinyproxy

SSH in (`ssh root@VPS_IP`) and run:

```bash
apt update && apt install -y tinyproxy

# Pick a long random password for the proxy.
PROXY_USER=munich
PROXY_PASS="$(openssl rand -hex 24)"
echo "MUC_PROXY_URL = http://$PROXY_USER:$PROXY_PASS@VPS_IP:8888"

# Configure tinyproxy: listen publicly, require auth, allow HTTPS CONNECT.
cat >/etc/tinyproxy/tinyproxy.conf <<EOF
User tinyproxy
Group tinyproxy
Port 8888
Listen 0.0.0.0
Timeout 600
BasicAuth $PROXY_USER $PROXY_PASS
ConnectPort 443
ConnectPort 563
EOF

systemctl restart tinyproxy
systemctl enable tinyproxy
```

> There are no `Allow` lines, so access is controlled by `BasicAuth` only. The
> long random password is what protects the proxy — keep it secret. **Copy the
> `MUC_PROXY_URL` line printed above** (with `VPS_IP` replaced by the real IP).

## 3. Firewall

Open SSH and the proxy port only:

```bash
ufw allow 22/tcp
ufw allow 8888/tcp
ufw --force enable
```

For extra safety you can install `fail2ban` (`apt install -y fail2ban`).

## 4. Test it

From your laptop, a captcha-gated request should now succeed through the proxy:

```bash
curl -x "http://munich:PASS@VPS_IP:8888" \
  "https://www48.muenchen.de/buergeransicht/api/citizen/captcha-details/"
# -> {"siteKey":"zms-prod", ... ,"captchaEnabled":true}
```

You can also run the checker locally against the proxy:

```bash
MUC_PROXY_URL="http://munich:PASS@VPS_IP:8888" \
  SERVICE_ID=10339028 OFFICE_ID=10461 bun start
```

## 5. Add the secret to GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

- **Name:** `PROXY_URL`
- **Value:** `http://munich:PASS@VPS_IP:8888`

(The workflow reads the `PROXY_URL` secret and passes it to the client as
`MUC_PROXY_URL`.)

That's it. The scheduled workflow now routes captcha-gated services through the
German proxy; if the secret is missing, those jobs fail with a clear connection
error while the others keep working.

## Security notes

- The proxy is reachable from the internet and protected only by the password —
  use a long random one and rotate it if leaked.
- Consider restricting inbound `8888/tcp` to GitHub Actions IP ranges
  (published at <https://api.github.com/meta>) if you want defense in depth,
  though those ranges are large and change.
- Keep the VPS updated (`apt upgrade`) and the secret out of logs (it already
  is — the client never prints the proxy URL).
