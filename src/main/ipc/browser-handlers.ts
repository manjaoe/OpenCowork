import {
  getBrowserEmulationStatus,
  getBuiltInBrowserStorageSessions,
  readBrowserUserDataSource
} from '../browser/browser-emulation'
import { importCookiesFromLocalBrowser } from '../browser/browser-cookie-import'
import { normalizeBrowserUserDataSource } from '../../shared/browser-plugin'
import { registerMessagePackHandler } from './messagepack-handler'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ImportCookiesArgs {
  source?: string
}

export function registerBrowserHandlers(): void {
  registerMessagePackHandler<undefined>('browser:clear-cookies', async () => {
    try {
      await Promise.all(
        getBuiltInBrowserStorageSessions().map((browserSession) =>
          browserSession.clearStorageData({ storages: ['cookies'] })
        )
      )
      return { success: true }
    } catch (error) {
      console.error('[Browser] Failed to clear cookies:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  registerMessagePackHandler<undefined>('browser:emulation-status', async () => {
    try {
      return { success: true, status: getBrowserEmulationStatus() }
    } catch (error) {
      console.error('[Browser] Failed to read browser emulation status:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  registerMessagePackHandler<ImportCookiesArgs | undefined>(
    'browser:import-cookies',
    async (args) => {
      try {
        const source = args?.source
          ? normalizeBrowserUserDataSource(args.source)
          : readBrowserUserDataSource()
        const result = await importCookiesFromLocalBrowser(source)
        return { success: true, result }
      } catch (error) {
        console.error('[Browser] Failed to import cookies:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )
}
