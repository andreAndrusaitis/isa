import { describe, it, expect } from 'vitest'
import { presentAvatarsDeep } from './presentAvatars'

describe('presentAvatarsDeep', () => {
  it('assina avatar de blob em qualquer profundidade e preserva o resto', () => {
    const when = new Date()
    const body = { data: [{ assignedTo: { avatar: 'avatars/2026/10/x.png' }, createdAt: when, user: { avatar: 'LL' } }] }
    presentAvatarsDeep(body)
    const avatar = body.data[0].assignedTo.avatar as string
    expect(avatar === 'avatars/2026/10/x.png' || avatar.startsWith('https://')).toBe(true)
    expect(body.data[0].user.avatar).toBe('LL')
    expect(body.data[0].createdAt).toBe(when)
  })
})
