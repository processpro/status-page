using 'main.bicep'

param location = 'australiaeast'
param resourceGroupName = 'processpro-global'

param appServicePlanName = 'processpro-status'
param appServicePlanSku = 'B1'
param appServicePlanTier = 'Basic'

param storageName = 'processprostorage01'
param storageResourceGroupName = 'processpro-azure-global-resourcegroup'
param storageLocation = 'australiacentral'

param fileShareName = 'processpro-status'

param webAppName = 'processpro-status-page'

param dockerImage = 'ghcr.io/processpro/status-page:latest'
param statusBaseUrl = 'https://status.processpro.io'
param azureAdTenantId = '3e7621c2-c426-4849-8d9e-a6dc68f2dda9'
param singleAppServices = 'champion,freetrial,giltrapgroup,mcalpinehussmann,orc,toyota,vga,wisegroup'

// Provide at deploy time (Key Vault / pipeline secret):
// param azureAdClientId = '<entra-app-client-id>'
// param azureAdClientSecret = '<entra-app-client-secret>'
// param sessionSecret = '<random-session-secret>'
