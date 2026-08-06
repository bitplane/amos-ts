/**
 * The three AMOS vector tables extensions reach through a5.
 *
 * An extension is supposed to call AMOS with `Rjsr routine N`, the sanctioned
 * interface the developer kit documents and the two official extension
 * sources (`extensions/+Music.s`, `+Compact.s`) use exclusively. Plenty of
 * third-party ones instead do
 *
 *     movea.l -$4(a5),a0
 *     jsr     $c4(a0)
 *
 * which is not a routine number at all. `+WEqu.s:31-45` defines the three
 * slots with a macro that counts DOWN from zero:
 *
 *     RwReset  MACRO / Count SET 0            / ENDM
 *     Rl       MACRO / Count SET Count-4*(\2) / T_\1 equ Count / ENDM
 *              RwReset
 *              Rl  SyVect,1        ->  T_SyVect = -4
 *              Rl  EcVect,1        ->  T_EcVect = -8
 *              Rl  WiVect,1        ->  T_WiVect = -12
 *
 * Each slot holds a table of `bra`s, four bytes apiece, which is why AMOS's
 * own `SyCall` / `EcCall` / `WiCall` macros (`+Equ.s:394`, `:660`, `:768`) are
 *
 *     SyCall: MACRO / move.l T_SyVect(a5),a0 / jsr \1*4(a0) / ENDM
 *
 * The offset an extension writes literally IS the index times four. These are
 * the index names, transcribed from the equate lists that sit immediately
 * above each of those macros; the tables they name are commented entry by
 * entry in `+W.s` — `SyIn` at :9952, `EcIn` at :2524.
 *
 * Confirmed against behaviour before the lists were found: Range's List Bobs
 * calls Sy $11c, which comes out `Patch` — "Patch icon/bob!" in the table's
 * own comment — and its Float Bob pair call $c4/$c8, `SetBob` and `OffBob`.
 */

/** T_SyVect at -$4(a5) — the system library (+Equ.s:291-391) */
export const SY_VECTORS = [
  'Inkey', 'ClearKey', 'Shifts', 'Instant', 'KeyMap', 'Joy', 'PutKey', 'Hide',
  'Show', 'ChangeM', 'XyMou', 'XyHard', 'XyScr', 'MouseKey', 'SetM', 'ScIn',
  'XyWin', 'LimitM', 'ZoHd', 'ResZone', 'RazZone', 'SetZone', 'GetZone',
  'WaitVbl', 'SetHs', 'USetHs', 'SetFunk', 'GetFunk', 'AffHs', 'SetSpBank',
  'NXYAHs', 'XOffHs', 'OffHs', 'ActHs', 'SBufHs', 'StActHs', 'ReActHs',
  'StoreM', 'RecallM', 'PriHs', 'AMALTok', 'AMALCre', 'AMALMvO', 'AMALDAll',
  'AMAL', 'AMALReg', 'AMALClr', 'AMALFrz', 'AMALUFrz', 'SetBob', 'OffBob',
  'OffBobS', 'ActBob', 'AffBob', 'EffBob', 'SyChip', 'SyFast', 'LimBob',
  'ZoGr', 'SprGet', 'MaskMk', 'SpotHot', 'ColBob', 'ColGet', 'ColSpr',
  'SetSync', 'Synchro', 'PlaySet', 'XYBob', 'XYSp', 'PutBob', 'Patch',
  'MouRel', 'LimitMEc', 'SyFree', 'SetHCol', 'GetHCol', 'MovOn', 'KeySpeed',
  'ChanA', 'ChanM', 'SPrio', 'GetDisc', 'RestartVBL', 'StopVBL', 'KeyWaiting',
  'MouScrFront', 'MemReserve', 'MemFree', 'MemCheck', 'MemFastClear',
  'MemChipClear', 'MemFast', 'MemChip', 'Send_FakeEvent', 'Test_Cyclique',
  'AddFlushRoutine', 'MemFlush', 'AddRoutine', 'CallRoutines', 'Request_OnOff',
]

/** T_EcVect at -$8(a5) — the screen library (+Equ.s:582-656) */
export const EC_VECTORS = [
  'Raz', 'CopMake', '?', 'Cree', 'Del', 'First', 'Last', 'Active', 'CopForce',
  'AView', 'OffSet', 'Visible', 'DelAll', 'GCol', 'SCol', 'SPal', 'SColB',
  'FlRaz', 'Flash', 'ShRaz', 'Shift', 'EHide', 'CBlGet', 'CBlPut', 'CBlDel',
  'CBlRaz', 'Libre', 'CCloEc', 'Current', 'Double', 'SwapSc', 'SwapScS',
  'AdrEc', 'SetDual', 'PriDual', 'ClsEc', 'Pattern', 'GFonts', 'FFonts',
  'GFont', 'SFont', 'SetClip', 'BlGet', 'BlDel', 'BlRaz', 'BlPut', 'VerSli',
  'HorSli', 'SetSli', 'MnStart', 'MnStop', 'RainDel', 'RainSet', 'RainDo',
  'RainHide', 'RainVar', 'FadeOn', 'FadeOf', 'CopOnOff', 'CopReset', 'CopSwap',
  'CopWait', 'CopMove', 'CopMoveL', 'CopBase', 'AutoBack1', 'AutoBack2',
  'AutoBack3', 'AutoBack4', 'SuPaint', 'BlRev', 'DoRev', 'AMOS_WB', 'ScCpyW',
  'MaxRaw', 'NTSC', 'PourSli',
]

/** T_WiVect at -$c(a5) — the window library (+Equ.s:747-767) */
export const WI_VECTORS = [
  'ChrOut', 'Print', 'Centre', 'WindOp', 'Locate', 'QWindow', 'WinDel',
  'SBord', 'STitle', 'GAdr', 'MoveWi', 'ClsWi', 'SizeWi', 'SCurWi', 'XYCuWi',
  'XGrWi', 'YGrWi', 'Print2', 'Print3', 'SXSYCuWi',
]

/** which a5 slot holds which table, by the negative displacement */
const TABLES: Record<number, { call: string; names: string[] }> = {
  4: { call: 'SyCall', names: SY_VECTORS },
  8: { call: 'EcCall', names: EC_VECTORS },
  12: { call: 'WiCall', names: WI_VECTORS },
}

/**
 * Name `jsr $NN(a0)` given the displacement of the `movea.l -$N(a5),a0` that
 * set a0. `null` when a0 came from somewhere else, or the index is past the
 * end of the table — which would mean the reading is wrong, so say nothing
 * rather than guess.
 */
export function amosVector(a5Displacement: number, offset: number): string | null {
  const t = TABLES[a5Displacement]
  if (!t || offset % 4 !== 0) return null
  const name = t.names[offset / 4]
  return name === undefined || name === '?' ? null : `${t.call} ${name}`
}
