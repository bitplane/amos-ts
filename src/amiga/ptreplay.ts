/**
 * Public contract of `ptreplay.library` 6.6 (1996-03-20).
 *
 * The Game reaches the thirteen named vectors below. Playback itself uses
 * ./protracker.ts; this module keeps the binary-derived library boundary in
 * one place rather than scattering unexplained negative offsets through the
 * extension model.
 */
export const PTREPLAY_LIBRARY = {
  name: 'ptreplay.library',
  version: 6,
  revision: 6,
  librarySize: 52,
  lvo: {
    loadModule: -30,
    unloadModule: -36,
    playModule: -42,
    stopModule: -48,
    pauseModule: -54,
    unpauseModule: -60,
    setVolume: -72,
    getPosition: -78,
    getLength: -84,
    fadeModule: -126,
    channelOn: -132,
    channelOff: -138,
    setPosition: -144,
  },
} as const
