# ProcessPro Status Page

Deploys [Uptime Kuma](https://github.com/louislam/uptime-kuma) to Azure App Service with persistent storage, plus a staff-only `/internal` gateway for single-tenant client apps.

## Public vs internal

| URL | Audience | Contents |
|---|---|---|
| `https://status.processpro.io/` | External | Regional ProcessPro instances, SQL servers, and other products (Uptime Kuma status page) |
| `https://status.processpro.io/internal` | Staff only | Individual single-app services such as `giltrapgroup.processpro.io` and `toyota.processpro.io` |

The public page must not list client-specific apps. Staff sign-in for `/internal` uses Entra ID and allows only `@processpro.io` and `@processpro.com` accounts (same domain gate as Sentinel).

## Architecture

The container image is based on `louislam/uptime-kuma` and adds a small Node gateway that:

1. Proxies all non-internal traffic to Uptime Kuma (public status + admin UI)
2. Protects `/internal` with Microsoft Entra ID (OIDC)
3. Probes configured `{client}.processpro.io` hosts and renders an internal status table

Persistent Kuma data remains on the Azure Files mount at `/app/data`.

## Entra app registration

Create (or reuse) an Entra app registration in tenant `3e7621c2-c426-4849-8d9e-a6dc68f2dda9`:

- Redirect URI (Web): `https://status.processpro.io/internal/callback`
- Front-channel logout URL (optional): `https://status.processpro.io/internal/logout`
- Issue a client secret

Set these App Service settings (also parameterized in Bicep):

- `AZURE_AD_TENANT_ID`
- `AZURE_AD_CLIENT_ID`
- `AZURE_AD_CLIENT_SECRET`
- `SESSION_SECRET` (random string)
- `BASE_URL=https://status.processpro.io`
- `ALLOWED_EMAIL_DOMAINS=processpro.io,processpro.com`
- `SINGLE_APP_SERVICES=champion,freetrial,giltrapgroup,mcalpinehussmann,orc,toyota,vga,wisegroup`
- `WEBSITES_PORT=8080`

Optional: `DEMO_APP_SERVICES` for demo tenants (comma-separated subdomains).

## Container image

GitHub Actions builds and pushes `ghcr.io/processpro/status-page:latest` from `main`.

Local gateway checks:

```bash
cd gateway
npm install
npm test
AUTH_DISABLED=true INTERNAL_ONLY=true npm start
# open http://localhost:8080/internal
```

## Azure deployment (Bicep)

This deployment creates/configures:

- Resource Group
- App Service Plan
- App Service (custom status-page image)
- Storage Account with file share (persistent `/app/data`)

### Deploy with Azure CLI

```bash
az deployment sub create --location australiaeast --template-file bicep/deploy/main.bicep --parameters bicep/deploy/main.bicepparam \
  azureAdClientId="<entra-app-client-id>" \
  azureAdClientSecret="<entra-app-client-secret>" \
  sessionSecret="<random-session-secret>"
```

If the GHCR package is private, also pass `dockerRegistryServerUser` / `dockerRegistryServerPassword`.

### Parameters

| Parameter | Default | Description |
|---|---|---|
| location | australiaeast | Location for the resource group / app resources |
| resourceGroupName | processpro-global | Resource group for the app service |
| appServicePlanName | processpro-status | App service plan name |
| appServicePlanSku | B1 | App service plan SKU |
| appServicePlanTier | Basic | App service plan tier |
| webAppName | processpro-status-page | Web app name / default hostname |
| storageName | processprostorage01 | Storage account for the Kuma file share |
| fileShareName | processpro-status | File share name |
| dockerImage | ghcr.io/processpro/status-page:latest | Gateway + Kuma image |
| statusBaseUrl | https://status.processpro.io | Public base URL for OIDC |
| azureAdTenantId | ProcessPro tenant | Entra tenant for staff login |
| azureAdClientId | _(empty)_ | Entra app client ID |
| azureAdClientSecret | _(empty)_ | Entra app client secret |
| sessionSecret | _(empty)_ | Gateway session secret |
| singleAppServices | production client list | Comma-separated client subdomains |

## Upstream docs

The original Uptime Kuma-on-Azure Bicep template this repo started from is documented upstream at [yzwijsen/deploy-uptime-kuma-azure](https://github.com/yzwijsen/deploy-uptime-kuma-azure).
