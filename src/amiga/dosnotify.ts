import type { AmigaFS, FsEvent } from './vfs'

/** One StartNotify subscription over the shared Amiga filesystem. */
export interface DosNotifySubscription {
  readonly path: string
  readonly directory: boolean
  stop(): void
}

const fold = (path: string): string => path.toLowerCase().replace(/\/+$/, '')

/** Shared dos.library notification matching for GUI and OS DevKit. */
export function startDosNotify(fs: AmigaFS, path: string, receive: (event: FsEvent) => void): DosNotifySubscription {
  const watched = fold(path)
  const directory = watched.endsWith(':') || fs.exists(path) === 'dir'
  const stop = fs.watch((event) => {
    const changed = fold(event.path)
    if (changed === watched || (directory && changed.startsWith(watched.endsWith(':') ? watched : `${watched}/`))) receive(event)
  })
  return { path, directory, stop }
}
