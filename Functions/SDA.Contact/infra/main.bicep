targetScope = 'resourceGroup'
param location string
param functionName string
param storageName string
param allowedOrigins array
param challengeHostname string
param logDailyCapGB int = 1

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: { minimumTlsVersion: 'TLS1_2', allowBlobPublicAccess: false, allowSharedKeyAccess: false, supportsHttpsTrafficOnly: true }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = { parent: storage, name: 'default' }
resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobs, name: 'deployment', properties: { publicAccess: 'None' } }
resource tables 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = { parent: storage, name: 'default' }
resource counter 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = { parent: tables, name: 'contactDaily' }
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${functionName}-plan'
  location: location
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${functionName}-logs'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30, workspaceCapping: { dailyQuotaGb: logDailyCapGB } }
}
resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${functionName}-insights'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: workspace.id, DisableLocalAuth: true }
}
resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: functionName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      runtime: { name: 'node', version: '24' }
      deployment: { storage: { type: 'blobContainer', value: '${storage.properties.primaryEndpoints.blob}deployment', authentication: { type: 'SystemAssignedIdentity' } } }
      scaleAndConcurrency: { instanceMemoryMB: 512, maximumInstanceCount: 40, alwaysReady: [] }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      cors: { allowedOrigins: allowedOrigins, supportCredentials: false }
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', value: 'Authorization=AAD' }
        { name: 'MAIL_ENABLED', value: 'false' }
        { name: 'ALLOWED_ORIGINS', value: join(allowedOrigins, ',') }
        { name: 'TURNSTILE_HOSTNAME', value: challengeHostname }
        { name: 'TABLE_ENDPOINT', value: storage.properties.primaryEndpoints.table }
        { name: 'TABLE_NAME', value: counter.name }
      ]
    }
  }
}
// Function host storage + deployment need blob data and host queue access; app counter needs table data.
var roles = [
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b' // Storage Blob Data Owner (Function host requirements)
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88' // Storage Queue Data Contributor
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3' // Storage Table Data Contributor
]
resource assignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in roles: {
  name: guid(storage.id, app.id, role)
  scope: storage
  properties: { principalId: app.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role) }
}]
// Azure Monitor Entra ingestion requires this role on the new component only.
resource telemetryPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(insights.id, app.id, '3913510d-42f4-4e42-8a64-420c390055eb')
  scope: insights
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
  }
}
output endpoint string = 'https://${app.properties.defaultHostName}/api/contact'
