// Scope
targetScope = 'subscription'

// Parameters
param location string = 'australiaeast'
param resourceGroupName string = 'processpro-global'

@description('Resource group that contains the storage account and file share (may differ from resourceGroupName).')
param storageResourceGroupName string = resourceGroupName

@description('Region for the storage account and file share. When the account already exists, this must match its region because storage location cannot be changed.')
param storageLocation string = location

param appServicePlanName string = 'processpro-status'
param appServicePlanSku string = 'B1'
param appServicePlanTier string = 'Basic'
param webAppName string = 'processpro-status-page'
param storageName string = 'processprostorage01'
param fileShareName string = 'processpro-status'

// Variables
var dockerRegistryHost = 'docker.io'
var linuxFxVersion = 'DOCKER|louislam/uptime-kuma:latest'
var fsMountPath = '/app/data'
var storageRg = resourceGroup(subscription().subscriptionId, storageResourceGroupName)

// create resource group
resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
}

// create storage account
module stg '../modules/storageAccount.bicep' = {
  scope: storageRg
  name: storageName
  dependsOn: [
    rg
  ]
  params: {
    storageName: storageName
    location: storageLocation
  }  
}

// create file share to use as persistent storage for docker container
module fs '../modules/fileShare.bicep' = {
  scope: storageRg
  name: fileShareName
  dependsOn: [
    rg
  ]
  params: {
    fileShareName: fileShareName
    storageName: stg.outputs.storageName
  }
}

// create app service plan
module asp '../modules/appServicePlan.bicep' = {
  scope: rg
  name: appServicePlanName
  params: {
    appServicePlanName: appServicePlanName
    sku: appServicePlanSku
    tier: appServicePlanTier
    location: location
  }
}

// create app service
module wapp '../modules/appServiceDockerPublic.bicep' = {
  scope: rg
  name: webAppName
  params: {
    webAppName: webAppName
    appServicePlanId: asp.outputs.appServicePlanId
    dockerRegistryHost: dockerRegistryHost
    linuxFxVersion: linuxFxVersion
    location: location
  }
}

// mount fileshare as persistent storage
module mnt '../modules/appServiceStorageMount.bicep' = {
  scope: rg
  name: 'mount-fileshare'
  params: {
    mountPath: fsMountPath
    shareName: fs.outputs.fileShareName
    storageName: stg.outputs.storageName
    storageResourceGroupName: storageResourceGroupName
    webAppName: wapp.outputs.webAppName
  }
}
