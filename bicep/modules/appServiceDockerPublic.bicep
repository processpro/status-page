// Scope
targetScope = 'resourceGroup'

// Parameters
param webAppName string = 'wapp-${uniqueString(resourceGroup().id)}'
param location string = resourceGroup().location
param appServicePlanId string
param dockerRegistryHost string = 'mcr.microsoft.com' // use 'docker.io' for Docker hub
param linuxFxVersion string = 'DOCKER|azuredocs/containerapps-helloworld:latest'
param appSettings array = []
param websitesPort string = ''
param dockerRegistryServerUser string = ''
@secure()
param dockerRegistryServerPassword string = ''

var baseAppSettings = [
  {
    name: 'DOCKER_REGISTRY_SERVER_URL'
    value: 'https://${dockerRegistryHost}'
  }
  {
    name: 'DOCKER_ENABLE_CI'
    value: 'true'
  }
]

var portSettings = empty(websitesPort) ? [] : [
  {
    name: 'WEBSITES_PORT'
    value: websitesPort
  }
]

var registryCredentialSettings = empty(dockerRegistryServerUser) ? [] : [
  {
    name: 'DOCKER_REGISTRY_SERVER_USERNAME'
    value: dockerRegistryServerUser
  }
  {
    name: 'DOCKER_REGISTRY_SERVER_PASSWORD'
    value: dockerRegistryServerPassword
  }
]

//Resources
resource appService 'Microsoft.Web/sites@2020-06-01' = {
  name: webAppName
  location: location
  properties: {
    serverFarmId: appServicePlanId
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      appSettings: concat(baseAppSettings, portSettings, registryCredentialSettings, appSettings)
    }
  }
}

output webAppName string = appService.name
