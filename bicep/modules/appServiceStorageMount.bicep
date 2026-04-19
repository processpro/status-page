// Scope
targetScope = 'resourceGroup'

// Parameters
param webAppName string
param storageName string
param storageResourceGroupName string = resourceGroup().name
param shareName string
param mountPath string

// Use subscription-qualified scope so nested deployments resolve the storage account
// in storageResourceGroupName (not the module's host resource group).
var storageAccountScope = resourceGroup(subscription().subscriptionId, storageResourceGroupName)

// Resources
resource storageAccount 'Microsoft.Storage/storageAccounts@2019-06-01' existing = {
  name: storageName
  scope: storageAccountScope
}

resource storageSetting 'Microsoft.Web/sites/config@2021-01-15' = {
  name: '${webAppName}/azurestorageaccounts'
  properties: {
    '${shareName}': {
      type: 'AzureFiles'
      shareName: shareName
      mountPath: mountPath
      accountName: storageAccount.name      
      accessKey: storageAccount.listKeys().keys[0].value
    }
  }
}
