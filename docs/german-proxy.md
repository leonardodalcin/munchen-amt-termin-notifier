# German proxy on AWS Lightsail (for captcha-gated services)

The captcha that gates high-demand immigration services is verified against
`captcha-prod.muenchen.de`, which **only resolves from inside Germany**. GitHub's
runners are outside Germany, so those checks need to exit through a German
HTTP(S) proxy. This guide sets one up on a small **AWS Lightsail** instance in
Frankfurt and wires it into CI via the `PROXY_URL` secret.

Non-captcha services (Führerschein, Einbürgerung, …) run direct and need none of
this — only services marked `"captcha": true` in `services.json` use the proxy.

Lightsail is the right fit here: flat ~$5/month with data transfer bundled, a
free static IP, and a built-in firewall — no load balancers or per-GB egress
math.

## 1. Create the instance

[Lightsail console](https://lightsail.aws.amazon.com) → **Create instance**:

- **Region: Frankfurt (`eu-central-1`)** — must be Germany (not Lightsail's other
  EU regions).
- **Platform:** Linux/Unix → **Blueprint: OS Only → Ubuntu 24.04**.
- **Plan:** the smallest is plenty.
- Create it.

## 2. Attach a static IP

Instance → **Networking** tab → **Attach static IP** → create & attach. This is
your stable `VPS_IP` (free while attached) — it's what goes in `PROXY_URL`.

## 3. Open the proxy port

Same **Networking** tab → **IPv4 Firewall** → **Add rule**:

- **Application:** Custom · **Protocol:** TCP · **Port:** `8888`

Leave the default **SSH (22)** rule. If a wide-open **All TCP (0–65535)** rule
exists, delete it so only SSH + 8888 remain.

## 4. Connect to the instance

Easiest: the **Connect using SSH** button on the instance's **Connect** tab opens
a browser terminal (logs in as `ubuntu`, no local keys needed).

From your own terminal instead: download the region's default key
(console → **Account → SSH keys**), then:

```bash
chmod 400 ~/Downloads/LightsailDefaultKey-eu-central-1.pem
ssh -i ~/Downloads/LightsailDefaultKey-eu-central-1.pem ubuntu@VPS_IP
```

## 5. Install & configure tinyproxy

Paste this block (it generates a random password and writes the config with
`sudo tee` — a plain `sudo cat > file` fails, because the shell does the redirect,
not sudo):

```bash
sudo apt update && sudo apt install -y tinyproxy

PROXY_USER=munich
PROXY_PASS="$(openssl rand -hex 24)"

sudo tee /etc/tinyproxy/tinyproxy.conf >/dev/null <<EOF
User tinyproxy
Group tinyproxy
Port 8888
Listen 0.0.0.0
Timeout 600
BasicAuth $PROXY_USER $PROXY_PASS
ConnectPort 443
ConnectPort 563
EOF

sudo systemctl restart tinyproxy && sudo systemctl enable tinyproxy

echo "PROXY_URL = http://$PROXY_USER:$PROXY_PASS@VPS_IP:8888"
```

> Access is controlled by `BasicAuth` only, so the long random password is what
> protects the proxy. **Copy the `PROXY_URL` line** and replace `VPS_IP` with the
> real static IP.

## 6. Test it

From your laptop, a captcha-gated request should now succeed through Germany:

```bash
curl -x "http://munich:PASS@VPS_IP:8888" \
  "https://www48.muenchen.de/buergeransicht/api/citizen/captcha-details/"
# -> {"siteKey":"zms-prod", ... ,"captchaEnabled":true}
```

You can also run the checker locally against it:

```bash
MUC_PROXY_URL="http://munich:PASS@VPS_IP:8888" \
  SERVICE_ID=10339028 OFFICE_ID=10461 bun start
```

## 7. Add the secret to GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

- **Name:** `PROXY_URL`
- **Value:** `http://munich:PASS@VPS_IP:8888`

The workflow reads `PROXY_URL` and passes it to the client (as `MUC_PROXY_URL`)
only for captcha-gated services. If the secret is missing, those jobs fail with a
clear connection error while the others keep working.

## Security notes

- The proxy is reachable from the internet and protected only by the password —
  use a long random one and rotate it if it leaks (re-run the `PROXY_PASS=…`
  block and update the secret).
- For defense in depth, restrict the Lightsail **8888** firewall rule to GitHub
  Actions IP ranges (published at <https://api.github.com/meta>), though those
  ranges are large and change.
- Keep the instance patched (`sudo apt upgrade`). The client never logs the proxy
  URL, so it won't leak into Actions logs.
