param location string
param staticWebAppLocation string
param token string
param tags object
param openAiModel string
param openAiModelVersion string
param openAiCapacity int
param apiImage string
param mafImage string

// ───────── Observability ─────────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${token}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${token}'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

// ───────── Identity (keyless access everywhere it is supported) ─────────
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-matchlight-${token}'
  location: location
  tags: tags
}

// ───────── Azure OpenAI (Azure AI Foundry model deployment) ─────────
resource openAi 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: 'oai-${token}'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: { customSubDomainName: 'oai-${token}', publicNetworkAccess: 'Enabled', disableLocalAuth: true }
}

resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAi
  name: openAiModel
  sku: { name: 'GlobalStandard', capacity: openAiCapacity }
  properties: { model: { format: 'OpenAI', name: openAiModel, version: openAiModelVersion } }
}

// ───────── Azure AI Translator + Azure AI Speech ─────────
resource translator 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: 'trl-${token}'
  location: location
  tags: tags
  kind: 'TextTranslation'
  sku: { name: 'S1' }
  properties: { customSubDomainName: 'trl-${token}', publicNetworkAccess: 'Enabled' }
}

resource speech 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: 'spch-${token}'
  location: location
  tags: tags
  kind: 'SpeechServices'
  sku: { name: 'S0' }
  properties: { customSubDomainName: 'spch-${token}', publicNetworkAccess: 'Enabled' }
}

// ───────── Azure Web PubSub (real-time push) ─────────
resource webPubSub 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: 'wps-${token}'
  location: location
  tags: tags
  sku: { name: 'Free_F1', capacity: 1 }
  properties: { disableLocalAuth: true, publicNetworkAccess: 'Enabled' }
}

// ───────── Azure Cosmos DB (serverless NoSQL) ─────────
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: 'cosmos-${token}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [{ locationName: location, failoverPriority: 0 }]
    capabilities: [{ name: 'EnableServerless' }]
    disableLocalAuth: true
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'matchlight'
  properties: { resource: { id: 'matchlight' } }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'matchdata'
  properties: { resource: { id: 'matchdata', partitionKey: { paths: ['/match_id'], kind: 'Hash' } } }
}

// ───────── Container registry + Container Apps (API + agents; browsers get pushes via Web PubSub) ─────────
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'cr${token}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${token}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-matchlight-api-${token}'
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8787
        transport: 'auto'
        corsPolicy: { allowedOrigins: ['https://${web.properties.defaultHostname}', 'http://localhost:5173'], allowedMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowedHeaders: ['*'] }
      }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [
        { name: 'translator-key', value: translator.listKeys().key1 }
        { name: 'speech-key', value: speech.listKeys().key1 }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: empty(apiImage) ? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest' : apiImage
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: [
            { name: 'PORT', value: '8787' }
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
            { name: 'MATCHLIGHT_LLM', value: 'azure' }
            { name: 'AZURE_OPENAI_ENDPOINT', value: openAi.properties.endpoint }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: chatDeployment.name }
            { name: 'AZURE_OPENAI_API_VERSION', value: '2024-10-21' }
            { name: 'AZURE_TRANSLATOR_KEY', secretRef: 'translator-key' }
            { name: 'AZURE_TRANSLATOR_REGION', value: location }
            { name: 'AZURE_SPEECH_KEY', secretRef: 'speech-key' }
            { name: 'AZURE_SPEECH_REGION', value: location }
            { name: 'WEBPUBSUB_ENDPOINT', value: 'https://${webPubSub.properties.hostName}' }
            { name: 'WEBPUBSUB_HUB', value: 'matchlight' }
            { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'COSMOS_DATABASE', value: 'matchlight' }
            { name: 'CORS_ORIGIN', value: 'https://${web.properties.defaultHostname}' }
            { name: 'TRACE_LOG', value: '1' }
            { name: 'MAF_ENDPOINT', value: 'http://${maf.name}' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
          probes: [{ type: 'Liveness', httpGet: { path: '/healthz', port: 8787 }, periodSeconds: 30 }]
        }
      ]
      // Live match sessions are held in memory by the replica that created them; keep a single replica.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [acrPull]
}

// ───────── Microsoft Agent Framework sidecar (Explainer <-> Critic workflow), internal only ─────────
resource maf 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-ml-maf-${token}'
  location: location
  tags: union(tags, { 'azd-service-name': 'maf' })
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: false, targetPort: 8790, transport: 'http' }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
    }
    template: {
      containers: [
        {
          name: 'maf'
          image: empty(mafImage) ? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest' : mafImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'PORT', value: '8790' }
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
            { name: 'AZURE_OPENAI_ENDPOINT', value: openAi.properties.endpoint }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: chatDeployment.name }
            { name: 'AZURE_OPENAI_API_VERSION', value: '2024-10-21' }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 2 }
    }
  }
  dependsOn: [acrPull]
}

// ───────── Static Web App (frontend) ─────────
resource web 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'swa-matchlight-${token}'
  location: staticWebAppLocation
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

// ───────── Role assignments (managed identity, least privilege) ─────────
var roles = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  openAiUser: '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
  webPubSubOwner: '12cf5a90-567b-43ae-8102-96cf46c7d9b4'
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, roles.acrPull)
  scope: registry
  properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull) }
}

resource openAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openAi.id, identity.id, roles.openAiUser)
  scope: openAi
  properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.openAiUser) }
}

resource wpsRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webPubSub.id, identity.id, roles.webPubSubOwner)
  scope: webPubSub
  properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.webPubSubOwner) }
}

// Cosmos DB Built-in Data Contributor (data-plane RBAC)
resource cosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, identity.id, 'data-contributor')
  properties: {
    principalId: identity.properties.principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    scope: cosmos.id
  }
}

output registryLoginServer string = registry.properties.loginServer
output apiUrl string = 'https://${api.properties.configuration.ingress.fqdn}'
output webUrl string = 'https://${web.properties.defaultHostname}'
output openAiEndpoint string = openAi.properties.endpoint
output webPubSubEndpoint string = 'https://${webPubSub.properties.hostName}'
output cosmosEndpoint string = cosmos.properties.documentEndpoint
