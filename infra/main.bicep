// Matchlight on Azure. Deploy with `azd up` (see docs/DEPLOY.md).
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('azd environment name, used to name resources')
param environmentName string

@description('Primary region. Must offer Azure OpenAI gpt-4o-mini (GlobalStandard), e.g. eastus2, swedencentral.')
param location string

@description('Region for Static Web Apps (limited availability).')
param staticWebAppLocation string = 'westeurope'

@description('Azure OpenAI chat model deployment')
param openAiModel string = 'gpt-4o-mini'
param openAiModelVersion string = '2024-07-18'
param openAiCapacity int = 30

@description('Container image for the API (set by azd deploy)')
param apiImage string = ''

@description('Container image for the Microsoft Agent Framework sidecar (set by azd deploy)')
param mafImage string = ''

var tags = { 'azd-env-name': environmentName, app: 'matchlight' }
var token = toLower(uniqueString(subscription().id, environmentName, location))

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-matchlight-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'matchlight-resources'
  scope: rg
  params: {
    location: location
    staticWebAppLocation: staticWebAppLocation
    token: token
    tags: tags
    openAiModel: openAiModel
    openAiModelVersion: openAiModelVersion
    openAiCapacity: openAiCapacity
    apiImage: apiImage
    mafImage: mafImage
  }
}

output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.registryLoginServer
output API_URL string = resources.outputs.apiUrl
output WEB_URL string = resources.outputs.webUrl
output AZURE_OPENAI_ENDPOINT string = resources.outputs.openAiEndpoint
output WEBPUBSUB_ENDPOINT string = resources.outputs.webPubSubEndpoint
output COSMOS_ENDPOINT string = resources.outputs.cosmosEndpoint
