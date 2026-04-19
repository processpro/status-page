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
