# Setup: Cloudflare Tunnel + Zero Trust Access

Expose the Jarvis server securely over the internet using Cloudflare Tunnel with Service Token authentication.

## Overview

```
Claude Code Plugin ──► Cloudflare Edge ──► Cloudflare Tunnel ──► Jarvis Server (LAN)
                       (Access policy)     (cloudflared)
```

No public ports, no port forwarding. Cloudflare validates credentials before traffic reaches your server.

## Prerequisites

- Cloudflare account with a domain
- `cloudflared` installed on the Docker host
- Jarvis server running

## 1. Create a Cloudflare Tunnel

```bash
# On the Docker host
cloudflared tunnel login
cloudflared tunnel create jarvis
```

Configure the tunnel to route to your local services. Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: jarvis.yourdomain.com
    service: http://localhost:8000
  - hostname: memu.yourdomain.com
    service: http://localhost:8011
  - service: http_status:404
```

```bash
# Add DNS records
cloudflared tunnel route dns jarvis jarvis.yourdomain.com
cloudflared tunnel route dns jarvis memu.yourdomain.com

# Start the tunnel
cloudflared tunnel run jarvis
```

## 2. Create a Service Token

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com)
2. **Access** > **Service Auth** > **Service Tokens**
3. Click **Create Service Token**
4. Name: `jarvis-plugin`
5. Copy both values (secret is only shown once):
   - `CF-Access-Client-Id`
   - `CF-Access-Client-Secret`

## 3. Create Access Application

1. **Access** > **Applications** > **Add an application** > **Self-hosted**
2. **Application name:** `Jarvis API`
3. **Subdomain:** `jarvis.yourdomain.com`
4. Add policy:
   - **Policy name:** `Service Token`
   - **Action:** Service Auth
   - **Include:** Service Token > `jarvis-plugin`
5. Save

## 4. Configure the Plugin

In Claude Code, go to `/plugin` > **Installed** > **jarvis-plugin** > **Configure**:

| Setting | Value |
|---------|-------|
| **Server URL** | `https://jarvis.yourdomain.com` |
| **API Key** | Your `JARVIS_API_KEY` |
| **Extra Headers** | `{"CF-Access-Client-Id":"<your-id>","CF-Access-Client-Secret":"<your-secret>"}` |

## 5. Verify

```bash
# Should return 200 with health data
curl -s https://jarvis.yourdomain.com/health \
  -H "CF-Access-Client-Id: <your-id>" \
  -H "CF-Access-Client-Secret: <your-secret>" \
  -H "Authorization: Bearer <JARVIS_API_KEY>"
```

## Auto-Start Tunnel (Optional)

```bash
cloudflared service install
systemctl enable cloudflared
```
