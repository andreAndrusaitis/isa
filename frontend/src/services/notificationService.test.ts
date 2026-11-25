import { describe, expect, it, vi } from 'vitest'
import { refreshUnreadNotifications } from './notificationService'

describe('refreshUnreadNotifications', () => {
  it('updates notifications after the primary page data has rendered', async () => {
    const items = [{ id: 'notification-1' }]
    const load = vi.fn().mockResolvedValue(items)
    const onLoaded = vi.fn()

    await refreshUnreadNotifications(load, onLoaded)

    expect(load).toHaveBeenCalledOnce()
    expect(onLoaded).toHaveBeenCalledWith(items)
  })

  it('does not throw when notification loading fails', async () => {
    const onLoaded = vi.fn()

    await expect(
      refreshUnreadNotifications(async () => { throw new Error('offline') }, onLoaded),
    ).resolves.toBeUndefined()
    expect(onLoaded).not.toHaveBeenCalled()
  })
})
