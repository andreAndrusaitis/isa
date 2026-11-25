/**
 * Cliente do Azure Blob Storage para anexos de tickets.
 *
 * Se as variáveis AZURE_STORAGE_* não estiverem configuradas, `blobEnabled` é
 * false e o sistema mantém o comportamento legado (anexo em base64 no banco).
 */

import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
  type ContainerClient,
} from '@azure/storage-blob'
import { env } from './env'

const account = env.AZURE_STORAGE_ACCOUNT
const accountKey = env.AZURE_STORAGE_KEY

export const blobAccount = account
export const blobContainer = env.AZURE_STORAGE_CONTAINER
export const blobEnabled = Boolean(account && accountKey)

let credential: StorageSharedKeyCredential | null = null
let containerClient: ContainerClient | null = null

if (blobEnabled) {
  credential = new StorageSharedKeyCredential(account!, accountKey!)
  const service = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    credential,
  )
  containerClient = service.getContainerClient(blobContainer)
}

export function getContainerClient(): ContainerClient {
  if (!containerClient) throw new Error('Azure Blob Storage não configurado')
  return containerClient
}

export function getSharedKeyCredential(): StorageSharedKeyCredential {
  if (!credential) throw new Error('Azure Blob Storage não configurado')
  return credential
}

export { generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol }
