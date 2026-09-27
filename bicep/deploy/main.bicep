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

@description('Container image for the status gateway + Uptime Kuma bundle.')
param dockerImage string = 'ghcr.io/processpro/status-page:latest'

@description('Public base URL used for Entra redirect URIs.')
param statusBaseUrl string = 'https://status.processpro.io'

@description('Entra tenant ID used for staff sign-in on /internal (same tenant as Sentinel).')
param azureAdTenantId string = '3e7621c2-c426-4849-8d9e-a6dc68f2dda9'

@description('Entra app registration client ID for the status /internal page.')
param azureAdClientId string = ''

@secure()
@description('Entra app registration client secret for the status /internal page.')
param azureAdClientSecret string = ''

@secure()
@description('Cookie session secret for the status gateway.')
param sessionSecret string = ''

@description('Comma-separated production single-app service names (subdomains of processpro.io).')
param singleAppServices string = 'champion,freetrial,giltrapgroup,mcalpinehussmann,orc,toyota,vga,wisegroup'

@description('Optional comma-separated demo app service names.')
param demoAppServices string = ''

@description('Optional GHCR username when the image is private.')
param dockerRegistryServerUser string = ''

@secure()
@description('Optional GHCR password/token when the image is private.')
param dockerRegistryServerPassword string = ''

// Variables
var dockerRegistryHost = 'ghcr.io'
var linuxFxVersion = 'DOCKER|${dockerImage}'
var fsMountPath = '/app/data'
var storageRg = resourceGroup(subscription().subscriptionId, storageResourceGroupName)

var gatewayAppSettings = [
  {
    name: 'BASE_URL'
    value: statusBaseUrl
  }
  {
    name: 'ALLOWED_EMAIL_DOMAINS'
    value: 'processpro.io,processpro.com'
  }
  {
    name: 'AZURE_AD_TENANT_ID'
    value: azureAdTenantId
  }
  {
    name: 'AZURE_AD_CLIENT_ID'
    value: azureAdClientId
  }
  {
    name: 'AZURE_AD_CLIENT_SECRET'
    value: azureAdClientSecret
  }
  {
    name: 'SESSION_SECRET'
    value: sessionSecret
  }
  {
    name: 'SINGLE_APP_SERVICES'
    value: singleAppServices
  }
  {
    name: 'DEMO_APP_SERVICES'
    value: demoAppServices
  }
]

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
    websitesPort: '8080'
    dockerRegistryServerUser: dockerRegistryServerUser
    dockerRegistryServerPassword: dockerRegistryServerPassword
    appSettings: gatewayAppSettings
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
