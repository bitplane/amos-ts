import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OM_ADDMEMBER, OM_REMMEMBER, OM_SET, type BoopsiObject, type OpMember, type TagItem } from './boopsi'
import {
  MUI_BUILTIN_SUPER,
  MUI_MAXMAX,
  MUIM_APPLIST_BROADCAST,
  MUIM_APPLIST_FIND,
  MUIM_CCLIST_ADD_CLASS,
  MUIM_CCLIST_FILL_LIST,
  MUIM_DATASPACE_EQUAL,
  MUIM_DATASPACE_NEXT,
  MUIM_DATASPACE_PRUNE,
  MUIA_CONFIGDATA_FALLBACK,
  MUIA_CONFIGDATA_SELECTOR,
  MUIM_CONFIGDATA_ACCEPTS,
  MUIM_CONFIGDATA_GET,
  MUIM_CONFIGDATA_HAS,
  MUIM_CONFIGDATA_SET,
  MUIM_NOTIFY_IS_SELF,
  MUIM_NOTIFY_SET_CONTEXT,
  MUIM_FAMILY_EXCLUSIVE,
  MUIM_MENUSTRIP_BUILD,
  MUIM_MENUSTRIP_FREE,
  MUIM_MENUSTRIP_UPDATE,
  MUIM_MENU_SYNC,
  MUIM_WINDOW_REPLACE_ROOT,
  MUIM_WINDOW_TRUE,
  MUIM_AREA_CREATE_DRAG_IMAGE,
  MUIM_AREA_DELETE_DRAG_IMAGE,
  MUIM_AREA_DISABLE_NESTED,
  MUIM_AREA_ENABLE_NESTED,
  MUIM_AREA_FALSE,
  MUIM_AREA_FIND_AT,
  MUIM_AREA_HIT_TEST,
  MUIM_AREA_LAYOUT,
  MUIM_AREA_REDRAW,
  MUIM_AREA_DEACTIVATE,
  MUIM_AREA_TRUE,
  MUIM_LIST_COLUMN_OFFSET,
  MUIM_LIST_CREATE_DRAG_IMAGE,
  MUIM_LIST_DELETE_DRAG_IMAGE,
  MUIM_LIST_LAYOUT,
  MUIM_LIST_SET_DROP_MARK,
  MUIM_NUMERIC_APPLY_DEFAULT,
  MUIM_NUMERIC_MEASURE,
  MUIM_NUMERIC_STRINGIFY_CURRENT,
  MUIA_NUMERIC_APPLY_DEFAULT,
  MUIA_GADGET_ACTIVE,
  MUIA_GADGET_WINDOW,
  MUIA_MENUITEM_COPY_STRINGS,
  MuiMaster,
  type MuiWindowEvent,
  type MuiWindowGeometry,
  type MuiWindowHost,
  type MuiWindowSpec,
  type MuiAreaRenderSpec,
  type MuiImageRenderSpec,
  type MuiBitmapRenderSpec,
  type MuiTextRenderSpec,
  type MuiRectangleRenderSpec,
  type MuiBalanceRenderSpec,
  type MuiStringGadgetState,
  type MuiPropGadgetState,
  type MuiListRenderSpec,
  type MuiSliderRenderSpec,
  visibleLength,
} from './muimaster'
import { MUI, MUIC, MUI_ATTR, MUI_OWNER } from './muimaster.gen'
import { parseAmosFile } from '../loader/amosfile'

const tag = (t: number, data: number): TagItem => ({ tag: t, data })

class TestWindowHost implements MuiWindowHost {
  opened: MuiWindowSpec[] = []
  events: MuiWindowEvent[] = []
  calls: string[] = []
  draws: MuiAreaRenderSpec[] = []
  images: MuiImageRenderSpec[] = []
  bitmaps: MuiBitmapRenderSpec[] = []
  texts: MuiTextRenderSpec[] = []
  rectangles: MuiRectangleRenderSpec[] = []
  balances: MuiBalanceRenderSpec[] = []
  gadgets: Array<{ handle: unknown, address: number, box: { left: number, top: number, width: number, height: number }, disabled: boolean }> = []
  hiddenGadgets: number[] = []
  refreshedGadgets: number[] = []
  activatedGadgets: number[] = []
  stringGadgets = new Map<number, { state: MuiStringGadgetState, activation: number }>()
  propGadgets = new Map<number, { state: MuiPropGadgetState, horizontal: boolean }>()
  lists: MuiListRenderSpec[] = []
  sliders: MuiSliderRenderSpec[] = []
  geometryValue: MuiWindowGeometry = { left: 10, top: 12, width: 160, height: 80, screenAddress: 0x7777, active: true }
  open(spec: MuiWindowSpec): unknown { this.opened.push(spec); return {} }
  close(): void { this.calls.push('close') }
  geometry(): MuiWindowGeometry { return this.geometryValue }
  activate(): void { this.calls.push('activate') }
  toFront(): void { this.calls.push('front') }
  toBack(): void { this.calls.push('back') }
  screenToFront(): void { this.calls.push('screen-front') }
  screenToBack(): void { this.calls.push('screen-back') }
  setTitles(_handle: unknown, title: string, screenTitle: string): void { this.calls.push(`titles:${title}:${screenTitle}`) }
  poll(): MuiWindowEvent[] { return this.events.splice(0) }
  drawArea(_handle: unknown, spec: MuiAreaRenderSpec): void { this.draws.push(spec) }
  drawImage(_handle: unknown, spec: MuiImageRenderSpec): void { this.images.push(spec) }
  drawBitmap(_handle: unknown, spec: MuiBitmapRenderSpec): void { this.bitmaps.push(spec) }
  drawText(_handle: unknown, spec: MuiTextRenderSpec): void { this.texts.push(spec) }
  drawRectangle(_handle: unknown, spec: MuiRectangleRenderSpec): void { this.rectangles.push(spec) }
  drawBalance(_handle: unknown, spec: MuiBalanceRenderSpec): void { this.balances.push(spec) }
  drawList(_handle: unknown, spec: MuiListRenderSpec): void { this.lists.push(spec) }
  drawSlider(_handle: unknown, spec: MuiSliderRenderSpec): void { this.sliders.push(spec) }
  showGadget(handle: unknown, address: number, box: { left: number, top: number, width: number, height: number }, disabled: boolean): void {
    this.gadgets.push({ handle, address, box, disabled })
  }
  hideGadget(_handle: unknown, address: number): void { this.hiddenGadgets.push(address) }
  refreshGadget(_handle: unknown, address: number): void { this.refreshedGadgets.push(address) }
  activateGadget(_handle: unknown, address: number): void { this.activatedGadgets.push(address) }
  configureStringGadget(address: number, state: MuiStringGadgetState, activation: number): void {
    this.stringGadgets.set(address, { state, activation })
  }
  configurePropGadget(address: number, state: MuiPropGadgetState, horizontal: boolean): void {
    this.propGadgets.set(address, { state, horizontal })
  }
  disposeGadget(address: number): void { this.stringGadgets.delete(address); this.propGadgets.delete(address) }
}

describe('muimaster: the class tree', () => {
  it('registers every class the header names, under the right parent', () => {
    const m = new MuiMaster()
    expect(m.classNames).toHaveLength(35)
    expect(m.findClass('Cclist.mui')).not.toBeNull()

    const win = m.findClass(MUIC.MUIC_Window)!
    const notify = m.findClass(MUIC.MUIC_Notify)!
    const area = m.findClass(MUIC.MUIC_Area)!
    expect(win.superClass).toBe(notify)
    expect(area.superClass).toBe(notify)
    // Group is under Area, not Family, which is the one people misremember
    expect(m.findClass(MUIC.MUIC_Group)!.superClass).toBe(area)
    expect(m.findClass(MUIC.MUIC_Menustrip)!.superClass).toBe(m.findClass(MUIC.MUIC_Family))
    // Dtpic is a separately loaded .mui class, not part of muimaster itself.
    expect(m.findClass(MUIC.MUIC_Dtpic)).toBeNull()
  })

  it('every class descends from rootclass', () => {
    const m = new MuiMaster()
    for (const n of m.classNames) expect(m.findClass(n)!.isA(m.boopsi.rootClass)).toBe(true)
  })

  it('does not claim separately shipped classes are built in', () => {
    const m = new MuiMaster()
    expect(m.newObjectA(MUIC.MUIC_Gauge)).toBeNull()
    expect(m.newObjectA(MUIC.MUIC_Popasl)).toBeNull()
  })

  it('a name MUI does not have answers null, which a program sees as 0', () => {
    const m = new MuiMaster()
    expect(m.newObjectA('Nonsuch.mui')).toBeNull()
    expect(m.newObjectA('Window')).toBeNull() // the ".mui" is part of the name
  })
})

describe('muimaster: attributes go to the class that owns them', () => {
  it('stores an attribute on its owner and reads it back through the chain', () => {
    const m = new MuiMaster()
    const w = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_Title, 0x1234)])!
    expect(m.get(w, MUI.MUIA_Window_Title)).toBe(0x1234)
  })

  it('an inherited attribute is stored by the ancestor that declares it', () => {
    const m = new MuiMaster()
    // MUIA_UserData is Notify's and MUIA_Disabled is Area's; a Text is both
    const t = m.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_UserData, 7), tag(MUI.MUIA_Disabled, 1)])!
    expect(m.get(t, MUI.MUIA_UserData)).toBe(7)
    expect(m.get(t, MUI.MUIA_Disabled)).toBe(1)
    // a Window is a Notify but NOT an Area, so it has no Disabled at all
    const w = m.newObjectA(MUIC.MUIC_Window)!
    expect(m.get(w, MUI.MUIA_Disabled)).toBeNull()
    expect(m.get(w, MUI.MUIA_UserData)).toBe(0)
  })

  it('an unknown tag in a taglist is ignored rather than stored anywhere', () => {
    const m = new MuiMaster()
    const w = m.newObjectA(MUIC.MUIC_Window, [tag(0x8042_dead, 1)])!
    expect(m.get(w, 0x8042_dead)).toBeNull()
  })

  it('an "i.." attribute is taken at Init, never Set, and never readable', () => {
    const m = new MuiMaster()
    expect(MUI_ATTR.MUIA_Weight!.flags).toBe('i..')
    const t = m.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Weight, 50)])!
    // stored, but OM_GET answers "no such attribute" — which is the library's
    // behaviour, not a gap here, so `peek` is the only way to see it
    expect(m.peek(t, MUI.MUIA_Weight)).toBe(50)
    expect(m.get(t, MUI.MUIA_Weight)).toBeNull()
    expect(m.set(t, MUI.MUIA_Weight, 999)).toBe(0)
    expect(m.peek(t, MUI.MUIA_Weight)).toBe(50)
  })

  it('a ".s." attribute is Set but not given at Init, and not readable', () => {
    const m = new MuiMaster()
    expect(MUI_ATTR.MUIA_Application_Sleep!.flags).toBe('.s.')
    const a = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Sleep, 1)])!
    expect(m.peek(a, MUI.MUIA_Application_Sleep)).toBeUndefined()
    expect(m.set(a, MUI.MUIA_Application_Sleep, 1)).toBe(1)
    expect(m.peek(a, MUI.MUIA_Application_Sleep)).toBe(1)
    expect(m.get(a, MUI.MUIA_Application_Sleep)).toBeNull()
  })

  it('a "..g" attribute is MUI\'s own state, and setInternal is how it moves', () => {
    const m = new MuiMaster()
    expect(MUI_ATTR.MUIA_Window_CloseRequest!.flags).toBe('..g')
    const w = m.newObjectA(MUIC.MUIC_Window)!
    // a program may not Set it — the user is what sets it
    expect(m.set(w, MUI.MUIA_Window_CloseRequest, 1)).toBe(0)
    expect(m.get(w, MUI.MUIA_Window_CloseRequest)).toBe(0)
    expect(m.setInternal(w, MUI.MUIA_Window_CloseRequest, 1)).toBe(true)
    expect(m.get(w, MUI.MUIA_Window_CloseRequest)).toBe(1)
  })

  it('OM_SET answers how many attributes it used', () => {
    const m = new MuiMaster()
    const w = m.newObjectA(MUIC.MUIC_Window)!
    const msg = {
      MethodID: OM_SET,
      attrs: [tag(MUI.MUIA_Window_Title, 1), tag(MUI.MUIA_Window_Open, 1), tag(0x8042_dead, 1)],
    }
    expect(w.cl.dispatcher(w.cl, w, msg)).toBe(2)
  })
})

describe('muimaster: Window.mui 19.35', () => {
  const make = () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    const strings = new Map([[0x1000, 'Main'], [0x1100, 'Screen']])
    m.readString = (address) => strings.get(address) ?? ''
    m.windowHost = host
    const root = m.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 0x1000)])!
    const win = m.newObjectA(MUIC.MUIC_Window, [
      tag(MUI.MUIA_Window_Title, 0x1000),
      tag(MUI.MUIA_Window_ScreenTitle, 0x1100),
      tag(MUI.MUIA_Window_RootObject, root.address),
      tag(MUI.MUIA_Window_ID, 0x57494e31),
    ])!
    return { m, host, root, win }
  }

  it('opens through the platform boundary, exposes live geometry, and lays out its root', () => {
    const { m, host, root, win } = make()
    expect(m.set(win, MUI.MUIA_Window_Open, 1)).toBe(1)
    expect(host.opened[0]?.title).toBe('Main')
    expect(m.get(win, MUI.MUIA_Window_Open)).toBe(1)
    expect(m.get(win, MUI.MUIA_Window_Window)).not.toBe(0)
    expect(m.get(win, MUI.MUIA_Window_LeftEdge)).toBe(10)
    expect(m.get(win, MUI.MUIA_Window_Screen)).toBe(0x7777)
    expect(m.boxOf(root)).toEqual({ left: 0, top: 0, width: 160, height: 80 })
    m.set(win, MUI.MUIA_Window_Open, 0)
    expect(host.calls).toContain('close')
    expect(m.get(win, MUI.MUIA_Window_Window)).toBe(0)
  })

  it('drains Intuition events from Application input and raises CloseRequest', () => {
    const { m, host, win } = make()
    const app = m.newObjectA(MUIC.MUIC_Application)!
    m.addMember(app, win)
    m.set(win, MUI.MUIA_Window_Open, 1)
    host.events.push({ class: 0x200, code: 0, qualifier: 0, mouseX: 0, mouseY: 0, seconds: 0, micros: 0, iaddress: 0 })
    m.doMui(app, MUI.MUIM_Application_NewInput)
    expect(m.get(win, MUI.MUIA_Window_CloseRequest)).toBe(1)
  })

  it('implements ordering, nested sleep, cycle chain, aliases, and root replacement', () => {
    const { m, host, root, win } = make()
    m.set(win, MUI.MUIA_Window_Open, 1)
    m.doMui(win, MUI.MUIM_Window_ToFront)
    m.doMui(win, MUI.MUIM_Window_ScreenToBack)
    expect(host.calls).toEqual(expect.arrayContaining(['front', 'screen-back']))
    m.set(win, MUI.MUIA_Window_Sleep, 1)
    m.set(win, MUI.MUIA_Window_Sleep, 1)
    m.set(win, MUI.MUIA_Window_Sleep, 0)
    expect(m.get(win, MUI.MUIA_Window_Sleep)).toBe(1)
    m.doMui(win, MUI.MUIM_Window_SetCycleChain, [root.address, 0])
    expect(m.get(root, MUI.MUIA_CycleChain)).toBe(1)
    expect(m.doMui(win, MUIM_WINDOW_TRUE)).toBe(1)
    const replacement = m.newObjectA(MUIC.MUIC_Text)!
    expect(m.doMui(win, MUIM_WINDOW_REPLACE_ROOT, [replacement.address])).toBe(root.address)
    expect(m.get(win, MUI.MUIA_Window_RootObject)).toBe(replacement.address)
    expect(m.parent(root)).toBeNull()
  })
})

describe('muimaster: Area.mui 19.35', () => {
  it('installs the constructor defaults and normalises mutable state', () => {
    const m = new MuiMaster()
    const area = m.newObjectA(MUIC.MUIC_Area)!
    expect(m.peek(area, MUI.MUIA_Weight)).toBe(100)
    expect(m.get(area, MUI.MUIA_ShowMe)).toBe(1)
    expect(m.peek(area, MUI.MUIA_InputMode)).toBe(MUI.MUIV_InputMode_None)
    expect(m.get(area, MUI.MUIA_Selected)).toBe(0)
    expect(m.set(area, MUI.MUIA_Selected, 29)).toBe(1)
    expect(m.get(area, MUI.MUIA_Selected)).toBe(1)
  })

  it('sets up, lays out, draws through its window, and exposes live edges', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const area = m.newObjectA(MUIC.MUIC_Area, [
      tag(MUI.MUIA_Frame, MUI.MUIV_Frame_Button),
      tag(MUI.MUIA_Background, 5),
    ])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, area.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    // A bare Area contributes no stretchable content, so it keeps the box
    // but reports that a larger-than-maximum layout does not fit.
    expect(m.doMui(area, MUIM_AREA_LAYOUT, [3, 4, 30, 20])).toBe(0)
    expect(m.get(area, MUI.MUIA_LeftEdge)).toBe(3)
    expect(m.get(area, MUI.MUIA_RightEdge)).toBe(32)
    m.doMui(area, MUI.MUIM_Draw, [0x805])
    expect(host.draws.at(-1)).toMatchObject({ left: 3, top: 4, width: 30, height: 20, frame: MUI.MUIV_Frame_Button })
    m.doMui(area, MUI.MUIM_Hide)
    const count = host.draws.length
    m.doMui(area, MUI.MUIM_Draw)
    expect(host.draws).toHaveLength(count)
  })

  it('implements hit testing and all three selection input modes', () => {
    const m = new MuiMaster()
    const area = m.newObjectA(MUIC.MUIC_Area, [tag(MUI.MUIA_InputMode, MUI.MUIV_InputMode_RelVerify)])!
    m.layout(area, 10, 20, 40, 30)
    expect(m.doMui(area, MUI.MUIM_Setup)).toBe(1)
    expect(m.doMui(area, MUIM_AREA_FIND_AT, [15, 25])).toBe(area.address)
    expect(m.doMui(area, MUIM_AREA_HIT_TEST, [4, 4])).toBe(0)
    m.doMui(area, MUI.MUIM_HandleInput, [0x8, 0x68, 0, 15, 25])
    expect(m.get(area, MUI.MUIA_Selected)).toBe(1)
    m.doMui(area, MUI.MUIM_HandleInput, [0x8, 0xe8, 0, 15, 25])
    expect(m.get(area, MUI.MUIA_Selected)).toBe(0)
    m.set(area, MUI.MUIA_InputMode, MUI.MUIV_InputMode_Toggle)
    m.doMui(area, MUI.MUIM_HandleInput, [0x8, 0x68, 0, 15, 25])
    expect(m.get(area, MUI.MUIA_Selected)).toBe(1)
  })

  it('nests disabled state and implements constant and image-handle methods', () => {
    const m = new MuiMaster()
    const area = m.newObjectA(MUIC.MUIC_Area)!
    expect(m.doMui(area, MUIM_AREA_DISABLE_NESTED)).toBe(1)
    expect(m.doMui(area, MUIM_AREA_DISABLE_NESTED)).toBe(0)
    expect(m.get(area, MUI.MUIA_Disabled)).toBe(1)
    expect(m.doMui(area, MUIM_AREA_ENABLE_NESTED)).toBe(0)
    expect(m.doMui(area, MUIM_AREA_ENABLE_NESTED)).toBe(1)
    expect(m.get(area, MUI.MUIA_Disabled)).toBe(0)
    expect(m.doMui(area, MUIM_AREA_FALSE)).toBe(0)
    expect(m.doMui(area, MUIM_AREA_TRUE)).toBe(1)
    const image = m.doMui(area, MUIM_AREA_CREATE_DRAG_IMAGE, [1, 2])
    expect(image).not.toBe(0)
    expect(m.doMui(area, MUIM_AREA_DELETE_DRAG_IMAGE, [image])).toBe(0)
  })

  it('applies fixed dimensions after leaf sizing and persists Selected by ExportID', () => {
    const m = new MuiMaster()
    const fixed = m.newObjectA(MUIC.MUIC_Text, [
      tag(MUI.MUIA_Text_Contents, 0), tag(MUI.MUIA_FixWidth, 37),
      tag(MUI.MUIA_FixHeight, 19),
    ])!
    expect(m.askMinMax(fixed)).toEqual({ minW: 37, minH: 19, maxW: 37, maxH: 19, defW: 37, defH: 19 })
    const area = m.newObjectA(MUIC.MUIC_Area, [
      tag(MUI.MUIA_ExportID, 0x41524541), tag(MUI.MUIA_Selected, 1),
    ])!
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    expect(m.doMui(area, MUI.MUIM_Export, [ds.address])).toBe(0)
    m.set(area, MUI.MUIA_Selected, 0)
    expect(m.doMui(area, MUI.MUIM_Import, [ds.address])).toBe(0)
    expect(m.get(area, MUI.MUIA_Selected)).toBe(1)
  })
})

describe('muimaster: Image.mui 19.35', () => {
  it('defaults its seven attributes and standard images have native fixed bounds', () => {
    const m = new MuiMaster()
    const image = m.newObjectA(MUIC.MUIC_Image, [tag(MUI.MUIA_Image_Spec, MUI.MUII_CheckMark)])!
    expect(m.peek(image, MUI.MUIA_Image_State)).toBe(0)
    expect(m.peek(image, MUI.MUIA_Image_FreeHoriz)).toBe(0)
    expect(m.peek(image, MUI.MUIA_Image_FreeVert)).toBe(0)
    expect(m.askMinMax(image)).toEqual({ minW: 16, minH: 8, maxW: 16, maxH: 8, defW: 16, defH: 8 })
  })

  it('makes only the requested standard-image axes freely resizable', () => {
    const m = new MuiMaster()
    const horiz = m.newObjectA(MUIC.MUIC_Image, [
      tag(MUI.MUIA_Image_Spec, MUI.MUII_ArrowRight), tag(MUI.MUIA_Image_FreeHoriz, 1),
    ])!
    const vertical = m.newObjectA(MUIC.MUIC_Image, [
      tag(MUI.MUIA_Image_Spec, MUI.MUII_ArrowDown), tag(MUI.MUIA_Image_FreeVert, 1),
    ])!
    expect(m.askMinMax(horiz)).toMatchObject({ minW: 16, maxW: MUI_MAXMAX, minH: 8, maxH: 8 })
    expect(m.askMinMax(vertical)).toMatchObject({ minW: 16, maxW: 16, minH: 8, maxH: MUI_MAXMAX })
  })

  it('takes exact fixed dimensions from a conventional struct Image', () => {
    const m = new MuiMaster()
    const memory = new Uint8Array(32)
    memory[4] = 0
    memory[5] = 23
    memory[6] = 0
    memory[7] = 11
    m.readMemory = (address, length) => address >= 0x1000 && address + length <= 0x1020
      ? memory.slice(address - 0x1000, address - 0x1000 + length) : null
    const image = m.newObjectA(MUIC.MUIC_Image, [tag(MUI.MUIA_Image_OldImage, 0x1000)])!
    expect(m.askMinMax(image)).toEqual({ minW: 23, minH: 11, maxW: 23, maxH: 11, defW: 23, defH: 11 })
  })

  it('resolves on Setup and draws Selected as IDS_SELECTED through the host', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const image = m.newObjectA(MUIC.MUIC_Image, [
      tag(MUI.MUIA_Image_Spec, MUI.MUII_RadioButton), tag(MUI.MUIA_Selected, 1),
    ])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, image.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    expect(host.images.at(-1)).toMatchObject({ spec: MUI.MUII_RadioButton, oldImage: 0, state: 1 })
    m.set(image, MUI.MUIA_Selected, 0)
    m.set(image, MUI.MUIA_Image_State, 3)
    m.doMui(image, MUI.MUIM_Draw, [1])
    expect(host.images.at(-1)?.state).toBe(3)
    expect(m.doMui(image, MUI.MUIM_Cleanup)).toBe(0)
  })
})

describe('muimaster: Bitmap.mui 19.35', () => {
  it('installs the native constructor defaults and the 1..10000 size range', () => {
    const m = new MuiMaster()
    const bitmap = m.newObjectA(MUIC.MUIC_Bitmap)!
    expect(m.get(bitmap, MUI.MUIA_Bitmap_Bitmap)).toBe(0)
    expect(m.get(bitmap, MUI.MUIA_Bitmap_Transparent)).toBe(-1)
    expect(m.get(bitmap, MUI.MUIA_Bitmap_RemappedBitmap)).toBe(0)
    expect(m.askMinMax(bitmap)).toEqual({
      minW: 1, minH: 1, maxW: MUI_MAXMAX, maxH: MUI_MAXMAX, defW: 1, defH: 1,
    })
  })

  it('exposes its effective bitmap during Setup and clears it during Cleanup', () => {
    const m = new MuiMaster()
    const bitmap = m.newObjectA(MUIC.MUIC_Bitmap, [tag(MUI.MUIA_Bitmap_Bitmap, 0x1234)])!
    expect(m.doMui(bitmap, MUI.MUIM_Setup)).toBe(1)
    expect(m.get(bitmap, MUI.MUIA_Bitmap_RemappedBitmap)).toBe(0x1234)
    expect(m.doMui(bitmap, MUI.MUIM_Cleanup)).toBe(0)
    expect(m.get(bitmap, MUI.MUIA_Bitmap_RemappedBitmap)).toBe(0)
  })

  it('draws the declared source rectangle with mapping and transparency metadata', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const bitmap = m.newObjectA(MUIC.MUIC_Bitmap, [
      tag(MUI.MUIA_Bitmap_Bitmap, 0x2000), tag(MUI.MUIA_Bitmap_Width, 13),
      tag(MUI.MUIA_Bitmap_Height, 7), tag(MUI.MUIA_Bitmap_MappingTable, 0x3000),
      tag(MUI.MUIA_Bitmap_Transparent, 2),
    ])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, bitmap.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    expect(host.bitmaps.at(-1)).toMatchObject({
      bitmap: 0x2000, sourceWidth: 13, sourceHeight: 7, mappingTable: 0x3000, transparent: 2,
    })
    m.set(bitmap, MUI.MUIA_Bitmap_Width, 9)
    m.doMui(bitmap, MUI.MUIM_Draw, [1])
    expect(host.bitmaps.at(-1)?.sourceWidth).toBe(9)
  })
})

describe('muimaster: Bodychunk.mui 19.35', () => {
  it('stores and returns the six constructor fields decoded by the native class', () => {
    const m = new MuiMaster()
    const body = m.newObjectA(MUIC.MUIC_Bodychunk, [
      tag(MUI.MUIA_Bodychunk_Body, 0x4000), tag(MUI.MUIA_Bodychunk_Depth, 3),
      tag(MUI.MUIA_Bodychunk_Compression, 1), tag(MUI.MUIA_Bodychunk_Masking, 1),
      tag(MUI.MUIA_Bitmap_Width, 17), tag(MUI.MUIA_Bitmap_Height, 9),
    ])!
    expect(m.get(body, MUI.MUIA_Bodychunk_Body)).toBe(0x4000)
    expect(m.get(body, MUI.MUIA_Bodychunk_Depth)).toBe(3)
    expect(m.get(body, MUI.MUIA_Bodychunk_Compression)).toBe(1)
    expect(m.get(body, MUI.MUIA_Bodychunk_Masking)).toBe(1)
  })

  it('converts BODY data at Setup, delegates Bitmap drawing, and releases it at Cleanup', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const body = m.newObjectA(MUIC.MUIC_Bodychunk, [
      tag(MUI.MUIA_Bodychunk_Body, 0x4000), tag(MUI.MUIA_Bodychunk_Depth, 2),
      tag(MUI.MUIA_Bodychunk_Compression, 1), tag(MUI.MUIA_Bodychunk_Masking, 1),
      tag(MUI.MUIA_Bitmap_Width, 16), tag(MUI.MUIA_Bitmap_Height, 8),
    ])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, body.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    expect(m.get(body, MUI.MUIA_Bitmap_RemappedBitmap)).toBe(0x4000)
    expect(host.bitmaps.at(-1)).toMatchObject({
      body: 0x4000, depth: 2, compression: 1, masking: 1, sourceWidth: 16, sourceHeight: 8,
    })
    expect(m.doMui(body, MUI.MUIM_Cleanup)).toBe(0)
    expect(m.get(body, MUI.MUIA_Bitmap_RemappedBitmap)).toBe(0)
  })
})

describe('muimaster: Text.mui 19.35', () => {
  it('uses the native SetMin/SetMax/SetVMax defaults and owns Contents', () => {
    const m = new MuiMaster()
    m.readString = (address) => address === 0x1000 ? 'Hello' : ''
    const text = m.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 0x1000)])!
    expect(m.peek(text, MUI.MUIA_Text_SetMin)).toBe(1)
    expect(m.peek(text, MUI.MUIA_Text_SetMax)).toBe(0)
    expect(m.peek(text, MUI.MUIA_Text_SetVMax)).toBe(1)
    expect(m.get(text, MUI.MUIA_Text_Contents)).not.toBe(0x1000)
    expect(m.textOf(text, MUI.MUIA_Text_Contents)).toBe('Hello')
  })

  it('measures multiline preparsed text and applies all three sizing flags', () => {
    const m = new MuiMaster()
    m.readString = (address) => address === 0x1000 ? '\x1bcWide\nxx' : ''
    const fixed = m.newObjectA(MUIC.MUIC_Text, [
      tag(MUI.MUIA_Text_Contents, 0x1000), tag(MUI.MUIA_Text_SetMax, 1),
    ])!
    expect(m.askMinMax(fixed)).toEqual({ minW: 32, minH: 16, maxW: 32, maxH: 16, defW: 32, defH: 16 })
    const free = m.newObjectA(MUIC.MUIC_Text, [
      tag(MUI.MUIA_Text_Contents, 0x1000), tag(MUI.MUIA_Text_SetMin, 0),
      tag(MUI.MUIA_Text_SetVMax, 0),
    ])!
    expect(m.askMinMax(free)).toEqual({ minW: 0, minH: 16, maxW: MUI_MAXMAX, maxH: MUI_MAXMAX, defW: 32, defH: 16 })
  })

  it('draws contents and preparse through the live window host', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    m.readString = (address) => address === 0x1000 ? 'Label' : address === 0x1100 ? '\x1bc' : ''
    const text = m.newObjectA(MUIC.MUIC_Text, [
      tag(MUI.MUIA_Text_Contents, 0x1000), tag(MUI.MUIA_Text_PreParse, 0x1100),
    ])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, text.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    expect(host.texts.at(-1)).toMatchObject({ contents: 'Label', preparse: '\x1bc', disabled: false })
  })

  it('exports and imports the owned Contents string by ExportID', () => {
    const m = new MuiMaster()
    m.readString = (address) => address === 0x1000 ? 'First' : address === 0x1100 ? 'Second' : ''
    const text = m.newObjectA(MUIC.MUIC_Text, [
      tag(MUI.MUIA_Text_Contents, 0x1000), tag(MUI.MUIA_ExportID, 0x54455854),
    ])!
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    expect(m.doMui(text, MUI.MUIM_Export, [ds.address])).toBe(0)
    m.set(text, MUI.MUIA_Text_Contents, 0x1100)
    expect(m.textOf(text, MUI.MUIA_Text_Contents)).toBe('Second')
    expect(m.doMui(text, MUI.MUIM_Import, [ds.address])).toBe(0)
    expect(m.textOf(text, MUI.MUIA_Text_Contents)).toBe('First')
  })
})

describe('muimaster: Rectangle.mui 19.35', () => {
  it('keeps a plain rectangle as an unconstrained zero-size spacer', () => {
    const m = new MuiMaster()
    const rectangle = m.newObjectA(MUIC.MUIC_Rectangle)!
    expect(m.get(rectangle, MUI.MUIA_Rectangle_HBar)).toBe(0)
    expect(m.get(rectangle, MUI.MUIA_Rectangle_VBar)).toBe(0)
    expect(m.askMinMax(rectangle)).toEqual({ minW: 0, minH: 0, maxW: MUI_MAXMAX, maxH: MUI_MAXMAX, defW: 0, defH: 0 })
  })

  it('measures vertical, horizontal, and titled bars using native rules', () => {
    const m = new MuiMaster()
    m.readString = (address) => address === 0x1000 ? 'Title' : ''
    const vertical = m.newObjectA(MUIC.MUIC_Rectangle, [tag(MUI.MUIA_Rectangle_VBar, 1)])!
    const horizontal = m.newObjectA(MUIC.MUIC_Rectangle, [tag(MUI.MUIA_Rectangle_HBar, 1)])!
    const titled = m.newObjectA(MUIC.MUIC_Rectangle, [
      tag(MUI.MUIA_Rectangle_HBar, 1), tag(MUI.MUIA_Rectangle_BarTitle, 0x1000),
    ])!
    expect(m.askMinMax(vertical)).toMatchObject({ minW: 2, minH: 2 })
    expect(m.askMinMax(horizontal)).toMatchObject({ minW: 2, minH: 2 })
    expect(m.askMinMax(titled)).toMatchObject({ minW: 52, minH: 9 })
  })

  it('draws bar orientation and title through the live host', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    m.readString = (address) => address === 0x1000 ? 'Section' : ''
    const rectangle = m.newObjectA(MUIC.MUIC_Rectangle, [
      tag(MUI.MUIA_Rectangle_HBar, 1), tag(MUI.MUIA_Rectangle_BarTitle, 0x1000),
    ])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, rectangle.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    expect(host.rectangles.at(-1)).toMatchObject({ hbar: true, vbar: false, title: 'Section' })
  })
})

describe('muimaster: Balance.mui 19.35', () => {
  it('uses a fixed three-pixel split axis and stretches across its parent', () => {
    const m = new MuiMaster()
    const horizontal = m.newObjectA(MUIC.MUIC_Balance)!
    const hg = m.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Horiz, 1), tag(MUI.MUIA_Group_Child, horizontal.address),
    ])!
    expect(m.askMinMax(horizontal)).toEqual({ minW: 3, minH: 3, maxW: 3, maxH: MUI_MAXMAX, defW: 3, defH: 3 })
    const vertical = m.newObjectA(MUIC.MUIC_Balance)!
    m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Horiz, 0), tag(MUI.MUIA_Group_Child, vertical.address)])!
    expect(m.askMinMax(vertical)).toEqual({ minW: 3, minH: 3, maxW: MUI_MAXMAX, maxH: 3, defW: 3, defH: 3 })
    expect(m.parent(horizontal)).toBe(hg)
  })

  it('turns a mouse drag into adjacent sibling weights and immediate relayout', () => {
    const m = new MuiMaster()
    const left = m.newObjectA(MUIC.MUIC_Rectangle)!
    const balance = m.newObjectA(MUIC.MUIC_Balance)!
    const right = m.newObjectA(MUIC.MUIC_Rectangle)!
    const group = m.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Horiz, 1), tag(MUI.MUIA_Group_Spacing, 0),
      tag(MUI.MUIA_Group_Child, left.address), tag(MUI.MUIA_Group_Child, balance.address),
      tag(MUI.MUIA_Group_Child, right.address),
    ])!
    m.askMinMax(group)
    m.layout(group, 0, 0, 203, 20)
    m.doMui(balance, MUI.MUIM_Setup)
    const box = m.boxOf(balance)!
    m.doMui(balance, MUI.MUIM_HandleInput, [0x8, 0x68, 0, box.left, box.top])
    m.doMui(balance, MUI.MUIM_HandleInput, [0x10, 0, 0, box.left + 20, box.top])
    expect(m.boxOf(left)!.width).toBeGreaterThan(m.boxOf(right)!.width)
    m.doMui(balance, MUI.MUIM_HandleInput, [0x8, 0xe8, 0, box.left + 20, box.top])
  })

  it('draws the orientation and active state through its host', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const balance = m.newObjectA(MUIC.MUIC_Balance)!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, balance.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    expect(host.balances.at(-1)).toMatchObject({ horizontalGroup: false, dragging: false })
  })
})

describe('muimaster: Gadget.mui 19.35', () => {
  const make = () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const gadget = m.newObjectA(MUIC.MUIC_Gadget, [
      tag(MUI.MUIA_Gadget_Gadget, 0x123400),
      tag(MUI.MUIA_Frame, MUI.MUIV_Frame_Button),
      tag(MUI.MUIA_InnerLeft, 1),
      tag(MUI.MUIA_InnerTop, 2),
      tag(MUI.MUIA_Disabled, 1),
    ])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, gadget.address)])!
    return { m, host, gadget, win }
  }

  it('exposes its borrowed gadget and attaches it over Area\'s inner box', () => {
    const { m, host, gadget, win } = make()
    expect(m.get(gadget, MUI.MUIA_Gadget_Gadget)).toBe(0x123400)
    expect(m.get(gadget, MUIA_GADGET_ACTIVE)).toBe(0)
    expect(m.get(gadget, MUIA_GADGET_WINDOW)).toBe(0)
    m.set(win, MUI.MUIA_Window_Open, 1)
    expect(host.gadgets.at(-1)).toMatchObject({
      address: 0x123400,
      box: { left: 3, top: 4, width: 155, height: 74 },
      disabled: true,
    })
    expect(m.get(gadget, MUIA_GADGET_WINDOW)).not.toBe(0)
  })

  it('refreshes, deactivates, replaces, hides, and disposes without owning the gadget', () => {
    const { m, host, gadget, win } = make()
    m.set(win, MUI.MUIA_Window_Open, 1)
    host.refreshedGadgets.length = 0
    expect(m.doMui(gadget, MUIM_AREA_REDRAW)).toBe(1)
    expect(host.refreshedGadgets).toEqual([0x123400])
    expect(m.set(gadget, MUIA_GADGET_ACTIVE, 1)).toBe(1)
    expect(m.get(gadget, MUIA_GADGET_ACTIVE)).toBe(1)
    expect(m.doMui(gadget, MUIM_AREA_DEACTIVATE)).toBe(0)
    expect(m.get(gadget, MUIA_GADGET_ACTIVE)).toBe(0)
    expect(m.set(gadget, MUI.MUIA_Gadget_Gadget, 0x567800)).toBe(1)
    expect(host.hiddenGadgets).toContain(0x123400)
    expect(host.gadgets.at(-1)?.address).toBe(0x567800)
    m.set(win, MUI.MUIA_Window_Open, 0)
    expect(host.hiddenGadgets).toContain(0x567800)
    m.disposeObject(gadget)
    expect(host.hiddenGadgets.filter((address) => address === 0x567800)).toHaveLength(1)
  })
})

describe('muimaster: String.mui 19.35', () => {
  const poolText = (m: MuiMaster, address: number): string => {
    let result = ''
    for (let at = address - m.pool.base; m.pool.buffer[at] !== 0; at++) result += String.fromCharCode(m.pool.buffer[at]!)
    return result
  }

  it('builds the owned Intuition gadget with native defaults and exact min/max additions', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    m.readString = (at) => at === 0x1000 ? 'hello' : ''
    const string = m.newObjectA(MUIC.MUIC_String, [tag(MUI.MUIA_String_Contents, 0x1000)])!
    const address = m.get(string, MUI.MUIA_Gadget_Gadget)!
    expect(address).not.toBe(0)
    expect(m.get(string, MUI.MUIA_String_MaxLen)).toBe(127)
    expect(m.get(string, MUI.MUIA_String_Format)).toBe(MUI.MUIV_String_Format_Left)
    expect(poolText(m, m.get(string, MUI.MUIA_String_Contents)!)).toBe('hello')
    expect(host.stringGadgets.get(address)?.state).toMatchObject({ buffer: 'hello', maxChars: 128, secret: false })
    expect(m.askMinMax(string)).toEqual({ minW: 20, minH: 8, maxW: 10000, maxH: 8, defW: 100, defH: 8 })
  })

  it('shares live edits, filters settings, acknowledges gadget-up, and formats integers', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const strings = new Map([[0x1000, 'abc'], [0x1100, 'xyz'], [0x1200, '09'], [0x1300, '5']])
    m.readString = (at) => strings.get(at) ?? ''
    const string = m.newObjectA(MUIC.MUIC_String, [
      tag(MUI.MUIA_String_Contents, 0x1000), tag(MUI.MUIA_String_MaxLen, 5),
      tag(MUI.MUIA_String_Accept, 0x1200), tag(MUI.MUIA_String_Reject, 0x1300),
      tag(MUI.MUIA_String_Secret, 1), tag(MUI.MUIA_String_Format, MUI.MUIV_String_Format_Right),
    ])!
    const address = m.get(string, MUI.MUIA_Gadget_Gadget)!
    const state = host.stringGadgets.get(address)!.state
    expect(host.stringGadgets.get(address)!.activation & 0x400).not.toBe(0)
    expect(state).toMatchObject({ accept: '09', reject: '5', secret: true })
    state.buffer = '9876'
    state.bufferPos = 4
    m.doMui(string, MUI.MUIM_HandleInput, [0x40, 0, 0, 0, 0, 0, 0, address])
    expect(poolText(m, m.get(string, MUI.MUIA_String_Acknowledge)!)).toBe('9876')
    expect(m.set(string, MUI.MUIA_String_Integer, -42)).toBe(1)
    expect(m.get(string, MUI.MUIA_String_Integer)).toBe(-42)
    expect(poolText(m, m.get(string, MUI.MUIA_String_Contents)!)).toBe('-42')
  })

  it('exports and imports Contents and releases its platform gadget on disposal', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    m.readString = (at) => at === 0x1000 ? 'saved' : ''
    const source = m.newObjectA(MUIC.MUIC_String, [tag(MUI.MUIA_String_Contents, 0x1000), tag(MUI.MUIA_ExportID, 7)])!
    const address = m.get(source, MUI.MUIA_Gadget_Gadget)!
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    m.doMui(source, MUI.MUIM_Export, [ds.address])
    const target = m.newObjectA(MUIC.MUIC_String, [tag(MUI.MUIA_ExportID, 7)])!
    m.doMui(target, MUI.MUIM_Import, [ds.address])
    expect(poolText(m, m.get(target, MUI.MUIA_String_Contents)!)).toBe('saved')
    m.disposeObject(source)
    expect(host.stringGadgets.has(address)).toBe(false)
  })

  it('advances to the next cycle-chain string only after Return acceptance', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const first = m.newObjectA(MUIC.MUIC_String, [
      tag(MUI.MUIA_CycleChain, 1), tag(MUI.MUIA_String_AdvanceOnCR, 1),
    ])!
    const second = m.newObjectA(MUIC.MUIC_String, [tag(MUI.MUIA_CycleChain, 1)])!
    const group = m.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Child, first.address), tag(MUI.MUIA_Group_Child, second.address),
    ])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, group.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    const firstAddress = m.get(first, MUI.MUIA_Gadget_Gadget)!
    host.stringGadgets.get(firstAddress)!.state.accepted = true
    m.doMui(first, MUI.MUIM_HandleInput, [0x40, 0, 0, 0, 0, 0, 0, firstAddress])
    expect(m.get(win, MUI.MUIA_Window_ActiveObject)).toBe(second.address)
    expect(host.activatedGadgets).toEqual([m.get(second, MUI.MUIA_Gadget_Gadget)])
  })
})

describe('muimaster: Prop.mui 19.35', () => {
  it('normalises its range and exposes proportional Pot/Body state', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const prop = m.newObjectA(MUIC.MUIC_Prop, [
      tag(MUI.MUIA_Prop_Entries, 100), tag(MUI.MUIA_Prop_Visible, 20),
      tag(MUI.MUIA_Prop_First, 40), tag(MUI.MUIA_Prop_Horiz, 1),
    ])!
    const address = m.get(prop, MUI.MUIA_Gadget_Gadget)!
    const native = host.propGadgets.get(address)!
    expect(native.horizontal).toBe(true)
    expect(native.state.horizPot).toBeCloseTo(0x7fff, -1)
    expect(native.state.horizBody).toBeCloseTo(0x3333, -1)
    expect(m.get(prop, MUI.MUIA_Prop_First)).toBe(40)
    expect(m.set(prop, MUI.MUIA_Prop_First, 999)).toBe(1)
    expect(m.get(prop, MUI.MUIA_Prop_First)).toBe(80)
    expect(m.set(prop, MUI.MUIA_Prop_Visible, 120)).toBe(1)
    expect(m.get(prop, MUI.MUIA_Prop_First)).toBe(0)
  })

  it('uses the exact native normal and window-border min/max additions', () => {
    const m = new MuiMaster()
    const vertical = m.newObjectA(MUIC.MUIC_Prop)!
    expect(m.askMinMax(vertical)).toEqual({ minW: 6, minH: 12, maxW: 10000, maxH: 10000, defW: 6, defH: 50 })
    const horizontal = m.newObjectA(MUIC.MUIC_Prop, [tag(MUI.MUIA_Prop_Horiz, 1)])!
    expect(m.askMinMax(horizontal)).toEqual({ minW: 12, minH: 6, maxW: 10000, maxH: 10000, defW: 50, defH: 6 })
    const border = m.newObjectA(MUIC.MUIC_Prop, [tag(MUI.MUIA_Prop_UseWinBorder, MUI.MUIV_Prop_UseWinBorder_Right)])!
    expect(m.askMinMax(border)).toEqual({ minW: 0, minH: 0, maxW: 0, maxH: 10000, defW: 0, defH: 0 })
  })

  it('tracks live knob movement and implements increase/decrease with clamping', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const prop = m.newObjectA(MUIC.MUIC_Prop, [
      tag(MUI.MUIA_Prop_Entries, 10), tag(MUI.MUIA_Prop_Visible, 2), tag(MUI.MUIA_Prop_First, 1),
    ])!
    const address = m.get(prop, MUI.MUIA_Gadget_Gadget)!
    host.propGadgets.get(address)!.state.vertPot = 0xffff
    m.doMui(prop, MUI.MUIM_HandleInput, [0x200, 0, 0, 0, 0, 0, 0, address])
    expect(m.get(prop, MUI.MUIA_Prop_First)).toBe(8)
    expect(m.doMui(prop, MUI.MUIM_Prop_Decrease, [3])).toBe(0)
    expect(m.get(prop, MUI.MUIA_Prop_First)).toBe(5)
    m.doMui(prop, MUI.MUIM_Prop_Increase, [99])
    expect(m.get(prop, MUI.MUIA_Prop_First)).toBe(8)
    m.disposeObject(prop)
    expect(host.propGadgets.has(address)).toBe(false)
  })
})

describe('muimaster: List.mui 19.35', () => {
  const make = () => {
    const m = new MuiMaster()
    const strings = new Map<number, string>([[0x1000, 'Charlie'], [0x1100, 'alpha'], [0x1200, 'Bravo'], [0x1300, 'Title']])
    const longs = new Map<number, number>()
    const writes = new Map<number, number>()
    const byteWrites = new Map<number, Uint8Array>()
    m.readString = (at) => strings.get(at) ?? ''
    m.readLong = (at) => longs.get(at) ?? writes.get(at) ?? 0
    m.writeLong = (at, value) => { writes.set(at, value); return true }
    m.writeMemory = (at, bytes) => { byteWrites.set(at, bytes.slice()); return true }
    const list = m.newObjectA(MUIC.MUIC_List)!
    return { m, strings, longs, writes, byteWrites, list }
  }

  const entries = (m: MuiMaster, list: BoopsiObject): number[] => {
    const result: number[] = []
    for (let i = 0; ; i++) {
      m.doMui(list, MUI.MUIM_List_GetEntry, [i, 0x9000])
      const address = m.readLong?.(0x9000) ?? 0
      if (address === 0) return result
      result.push(address)
    }
  }

  it('implements insertion, retrieval, active normalization, removal, clear, and sorting', () => {
    const { m, writes, list } = make()
    m.doMui(list, MUI.MUIM_List_InsertSingle, [0x1000, MUI.MUIV_List_Insert_Bottom])
    m.doMui(list, MUI.MUIM_List_InsertSingle, [0x1100, MUI.MUIV_List_Insert_Top])
    m.doMui(list, MUI.MUIM_List_InsertSingle, [0x1200, MUI.MUIV_List_Insert_Sorted])
    expect(entries(m, list)).toEqual([0x1100, 0x1200, 0x1000])
    expect(m.get(list, MUI.MUIA_List_Entries)).toBe(3)
    expect(m.get(list, MUI.MUIA_List_InsertPosition)).toBe(1)
    m.set(list, MUI.MUIA_List_Active, MUI.MUIV_List_Active_Bottom)
    expect(m.get(list, MUI.MUIA_List_Active)).toBe(2)
    m.doMui(list, MUI.MUIM_List_GetEntry, [MUI.MUIV_List_GetEntry_Active, 0x9010])
    expect(writes.get(0x9010)).toBe(0x1000)
    m.doMui(list, MUI.MUIM_List_Remove, [MUI.MUIV_List_Remove_Active])
    expect(entries(m, list)).toEqual([0x1100, 0x1200])
    m.doMui(list, MUI.MUIM_List_Clear)
    expect(m.get(list, MUI.MUIA_List_Entries)).toBe(0)
  })

  it('inserts pointer arrays and owns copies only for the native String hooks', () => {
    const { m, longs } = make()
    longs.set(0x8000, 0x1000); longs.set(0x8004, 0x1100); longs.set(0x8008, 0)
    const list = m.newObjectA(MUIC.MUIC_List, [
      tag(MUI.MUIA_List_ConstructHook, MUI.MUIV_List_ConstructHook_String),
      tag(MUI.MUIA_List_DestructHook, MUI.MUIV_List_DestructHook_String),
      tag(MUI.MUIA_List_SourceArray, 0x8000),
    ])!
    expect(m.get(list, MUI.MUIA_List_Entries)).toBe(2)
    const copied = entries(m, list)
    expect(copied[0]).not.toBe(0x1000)
    expect(String.fromCharCode(...m.pool.buffer.slice(copied[0]! - m.pool.base, copied[0]! - m.pool.base + 8))).toBe('Charlie\0')
    m.disposeObject(list)
    expect(m.pool.alloc(8)).toBe(copied[0])
  })

  it('selects, iterates, exchanges, moves, and removes selected entries', () => {
    const { m, writes, list } = make()
    for (const address of [0x1000, 0x1100, 0x1200]) m.doMui(list, MUI.MUIM_List_InsertSingle, [address, MUI.MUIV_List_Insert_Bottom])
    m.doMui(list, MUI.MUIM_List_Select, [1, MUI.MUIV_List_Select_On, 0x9020])
    expect(writes.get(0x9020)).toBe(1)
    writes.set(0x9030, MUI.MUIV_List_NextSelected_Start)
    m.doMui(list, MUI.MUIM_List_NextSelected, [0x9030])
    expect(writes.get(0x9030)).toBe(1)
    m.doMui(list, MUI.MUIM_List_NextSelected, [0x9030])
    expect(writes.get(0x9030)).toBe(MUI.MUIV_List_NextSelected_End | 0)
    m.doMui(list, MUI.MUIM_List_Exchange, [0, MUI.MUIV_List_Exchange_Bottom])
    expect(entries(m, list)).toEqual([0x1200, 0x1100, 0x1000])
    m.doMui(list, MUI.MUIM_List_Move, [MUI.MUIV_List_Move_Bottom, MUI.MUIV_List_Move_Top])
    expect(entries(m, list)).toEqual([0x1000, 0x1200, 0x1100])
    m.doMui(list, MUI.MUIM_List_Remove, [MUI.MUIV_List_Remove_Selected])
    expect(entries(m, list)).toEqual([0x1000, 0x1200])
  })

  it('uses native default dimensions, computes visibility, draws, jumps, and tests positions', () => {
    const { m, byteWrites, list } = make()
    const host = new TestWindowHost()
    m.windowHost = host
    for (const address of [0x1000, 0x1100, 0x1200]) m.doMui(list, MUI.MUIM_List_InsertSingle, [address, MUI.MUIV_List_Insert_Bottom])
    expect(m.askMinMax(list)).toEqual({ minW: 40, minH: 24, maxW: 10000, maxH: 10000, defW: 100, defH: 64 })
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, list.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    expect(m.get(list, MUI.MUIA_List_Visible)).toBe(10)
    expect(host.lists.at(-1)?.rows.map((row) => row.text)).toEqual(['Charlie', 'alpha', 'Bravo'])
    m.doMui(list, MUI.MUIM_List_TestPos, [4, 12, 0x9100])
    const result = byteWrites.get(0x9100)!
    expect(new DataView(result.buffer).getInt32(0, false)).toBe(1)
    m.doMui(list, MUI.MUIM_List_Jump, [2])
    expect(m.get(list, MUI.MUIA_List_First)).toBe(0)
    m.set(win, MUI.MUIA_Window_Open, 0)
    expect(m.get(list, MUI.MUIA_List_Visible)).toBe(-1)
  })

  it('round-trips active state through Dataspace and manages list image handles', () => {
    const { m, list } = make()
    m.doMui(list, MUI.MUIM_List_InsertSingle, [0x1000, MUI.MUIV_List_Insert_Bottom])
    m.set(list, MUI.MUIA_List_Active, 0)
    m.setInternal(list, MUI.MUIA_ExportID, 77)
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    m.doMui(list, MUI.MUIM_Export, [ds.address])
    m.set(list, MUI.MUIA_List_Active, MUI.MUIV_List_Active_Off)
    m.doMui(list, MUI.MUIM_Import, [ds.address])
    expect(m.get(list, MUI.MUIA_List_Active)).toBe(0)
    const image = m.newObjectA(MUIC.MUIC_Image)!
    const handle = m.doMui(list, MUI.MUIM_List_CreateImage, [image.address, 0])
    expect(handle).not.toBe(0)
    expect(m.doMui(list, MUI.MUIM_List_DeleteImage, [handle])).toBe(0)
    expect(m.pool.alloc(8)).toBe(handle)
  })

  it('implements the five private 19.35 methods and same-list drag protocol', () => {
    const { m, list } = make()
    for (const address of [0x1000, 0x1100, 0x1200]) m.doMui(list, MUI.MUIM_List_InsertSingle, [address, MUI.MUIV_List_Insert_Bottom])
    m.set(list, MUI.MUIA_List_DragSortable, 1)
    expect(m.doMui(list, MUI.MUIM_DragQuery, [list.address])).toBe(MUI.MUIV_DragQuery_Accept)
    expect(m.doMui(list, MUI.MUIM_DragQuery, [0xdeadbeef])).toBe(MUI.MUIV_DragQuery_Refuse)
    expect(m.doMui(list, MUIM_LIST_SET_DROP_MARK, [99])).toBe(0)
    expect(m.get(list, MUI.MUIA_List_DropMark)).toBe(3)
    expect(m.doMui(list, MUIM_LIST_COLUMN_OFFSET, [0])).toBe(0)
    expect(m.doMui(list, MUIM_LIST_COLUMN_OFFSET, [1])).toBe(-1)
    expect(m.doMui(list, MUIM_LIST_LAYOUT)).toBe(0)
    const dragImage = m.doMui(list, MUIM_LIST_CREATE_DRAG_IMAGE)
    expect(dragImage).not.toBe(0)
    expect(m.doMui(list, MUIM_LIST_CREATE_DRAG_IMAGE)).toBe(dragImage)
    expect(m.doMui(list, MUIM_LIST_DELETE_DRAG_IMAGE, [dragImage])).toBe(0)
    expect(m.pool.alloc(8)).toBe(dragImage)
    expect(m.doMui(list, MUI.MUIM_DragReport, [list.address, 0, 0, 0])).toBe(MUI.MUIV_DragReport_Refresh)
  })
})

describe('muimaster: the object tree', () => {
  it('a child attribute makes a real parent/child link', () => {
    const m = new MuiMaster()
    const text = m.newObjectA(MUIC.MUIC_Text)!
    const group = m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Child, text.address)])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, group.address)])!
    expect(m.children(win)).toEqual([group])
    expect(m.children(group)).toEqual([text])
    expect(m.parent(text)).toBe(group)
    expect(m.parent(win)).toBeNull()
  })

  it('a reference is not a child — disposing a window keeps what it points at', () => {
    const m = new MuiMaster()
    const other = m.newObjectA(MUIC.MUIC_Window)!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RefWindow, other.address)])!
    expect(m.children(win)).toEqual([])
    m.disposeObject(win)
    expect(other.disposed).toBe(false)
  })

  it('a child that failed to create takes its parent down with it', () => {
    const m = new MuiMaster()
    // 0 is the address of nothing, which is what a failed Mui New answers
    expect(m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Child, 0)])).toBeNull()
  })

  it('DisposeObject is recursive over the children it owns', () => {
    const m = new MuiMaster()
    const text = m.newObjectA(MUIC.MUIC_Text)!
    const group = m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Child, text.address)])!
    const app = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Window, group.address)])!
    m.disposeObject(app)
    expect([app.disposed, group.disposed, text.disposed]).toEqual([true, true, true])
    expect(m.boopsi.objectAt(text.address)).toBeNull()
  })

  it('OM_ADDMEMBER and OM_REMMEMBER move a child in and out', () => {
    const m = new MuiMaster()
    const group = m.newObjectA(MUIC.MUIC_Group)!
    const text = m.newObjectA(MUIC.MUIC_Text)!
    group.cl.dispatcher(group.cl, group, { MethodID: OM_ADDMEMBER, object: text } as OpMember)
    expect(m.children(group)).toEqual([text])
    expect(m.parent(text)).toBe(group)
    group.cl.dispatcher(group.cl, group, { MethodID: OM_REMMEMBER, object: text } as OpMember)
    expect(m.children(group)).toEqual([])
    expect(m.parent(text)).toBeNull()
  })
})

describe('muimaster: Group.mui 19.35', () => {
  it('installs native defaults and exposes an addressable child MinList', () => {
    const m = new MuiMaster()
    const a = m.newObjectA(MUIC.MUIC_Rectangle)!
    const b = m.newObjectA(MUIC.MUIC_Rectangle)!
    const group = m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Child, a.address), tag(MUI.MUIA_Group_Child, b.address)])!
    expect(m.get(group, MUI.MUIA_Group_HorizSpacing)).toBe(1)
    const list = m.get(group, MUI.MUIA_Group_ChildList)!
    const view = new DataView(m.pool.buffer.buffer, m.pool.buffer.byteOffset, m.pool.buffer.byteLength)
    const first = view.getUint32(list - m.pool.base, false)
    expect(view.getUint32(first - m.pool.base + 8, false)).toBe(a.address)
  })

  it('lays out rows and columns as a grid', () => {
    const m = new MuiMaster()
    const kids = Array.from({ length: 4 }, () => m.newObjectA(MUIC.MUIC_Rectangle)!)
    const group = m.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Columns, 2),
      ...kids.map((child) => tag(MUI.MUIA_Group_Child, child.address)),
    ])!
    m.layout(group, 0, 0, 101, 81)
    expect(kids.map((child) => m.boxOf(child))).toEqual([
      { left: 0, top: 0, width: 50, height: 40 },
      { left: 51, top: 0, width: 50, height: 40 },
      { left: 0, top: 41, width: 50, height: 40 },
      { left: 51, top: 41, width: 50, height: 40 },
    ])
  })

  it('switches pages and batches membership changes until ExitChange', () => {
    const m = new MuiMaster()
    const a = m.newObjectA(MUIC.MUIC_Rectangle)!
    const b = m.newObjectA(MUIC.MUIC_Rectangle)!
    const group = m.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_PageMode, 1), tag(MUI.MUIA_Group_Child, a.address), tag(MUI.MUIA_Group_Child, b.address),
    ])!
    m.layout(group, 2, 3, 40, 20)
    m.set(group, MUI.MUIA_Group_ActivePage, MUI.MUIV_Group_ActivePage_Next)
    expect(m.get(group, MUI.MUIA_Group_ActivePage)).toBe(1)
    expect([m.get(a, MUI.MUIA_ShowMe), m.get(b, MUI.MUIA_ShowMe)]).toEqual([0, 1])
    expect(m.doMui(group, MUI.MUIM_Group_InitChange)).toBe(1)
    expect(m.doMui(group, MUI.MUIM_Group_Sort, [b.address, a.address, 0])).toBe(0)
    expect(m.children(group)).toEqual([b, a])
    expect(m.doMui(group, MUI.MUIM_Group_ExitChange)).toBe(0)
    m.setInternal(group, MUI.MUIA_ExportID, 44)
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    m.doMui(group, MUI.MUIM_Export, [ds.address])
    m.set(group, MUI.MUIA_Group_ActivePage, 0)
    m.doMui(group, MUI.MUIM_Import, [ds.address])
    expect(m.get(group, MUI.MUIA_Group_ActivePage)).toBe(1)
  })
})

describe('muimaster: Numeric.mui 19.35', () => {
  const poolText = (m: MuiMaster, address: number): string => {
    let out = ''
    for (let at = address - m.pool.base; m.pool.buffer[at] !== 0; at++) out += String.fromCharCode(m.pool.buffer[at]!)
    return out
  }

  it('installs binary defaults, starts at Default when Value is absent, and clips signed values', () => {
    const m = new MuiMaster()
    const plain = m.newObjectA(MUIC.MUIC_Numeric)!
    expect([
      m.get(plain, MUI.MUIA_Numeric_Min), m.get(plain, MUI.MUIA_Numeric_Max),
      m.get(plain, MUI.MUIA_Numeric_Value), m.get(plain, MUI.MUIA_Numeric_Default),
      m.get(plain, MUI.MUIA_Numeric_CheckAllSizes), m.get(plain, MUI.MUIA_Numeric_Reverse),
    ]).toEqual([0, 100, 0, 0, 0, 0])
    const numeric = m.newObjectA(MUIC.MUIC_Numeric, [
      tag(MUI.MUIA_Numeric_Min, -10), tag(MUI.MUIA_Numeric_Max, 10), tag(MUI.MUIA_Numeric_Default, 7),
    ])!
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(7)
    m.set(numeric, MUI.MUIA_Numeric_Value, 99)
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(10)
    m.set(numeric, MUI.MUIA_Numeric_Max, 4)
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(4)
    m.set(numeric, MUI.MUIA_Numeric_Min, 6)
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(6)
  })

  it('implements default, increase/decrease, formatting, and all three private methods', () => {
    const m = new MuiMaster()
    const numeric = m.newObjectA(MUIC.MUIC_Numeric, [
      tag(MUI.MUIA_Numeric_Min, -20), tag(MUI.MUIA_Numeric_Max, 20),
      tag(MUI.MUIA_Numeric_Default, 3), tag(MUI.MUIA_Numeric_Value, 10),
      tag(MUIA_NUMERIC_APPLY_DEFAULT, 1),
    ])!
    expect(m.doMui(numeric, MUI.MUIM_Numeric_Decrease, [4])).toBe(0)
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(6)
    expect(m.doMui(numeric, MUI.MUIM_Numeric_Increase, [2])).toBe(0)
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(8)
    expect(poolText(m, m.doMui(numeric, MUI.MUIM_Numeric_Stringify, [-12]))).toBe('-12')
    expect(poolText(m, m.doMui(numeric, MUIM_NUMERIC_STRINGIFY_CURRENT))).toBe('8')
    expect(m.doMui(numeric, MUIM_NUMERIC_APPLY_DEFAULT)).toBe(0)
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(3)
    const writes = new Map<number, number>()
    m.writeLong = (address, value) => { writes.set(address, value); return true }
    expect(m.doMui(numeric, MUIM_NUMERIC_MEASURE, [0x1000, 0x1004])).toBe(0)
    expect(writes.get(0x1000)).toBeGreaterThan(0)
    expect(writes.get(0x1004)).toBeGreaterThan(0)
  })

  it('uses the binary inclusive-range scale arithmetic and mirrors Reverse results', () => {
    const m = new MuiMaster()
    const numeric = m.newObjectA(MUIC.MUIC_Numeric, [
      tag(MUI.MUIA_Numeric_Min, -10), tag(MUI.MUIA_Numeric_Max, 10), tag(MUI.MUIA_Numeric_Value, 0),
    ])!
    expect(m.doMui(numeric, MUI.MUIM_Numeric_ValueToScale, [0, 99])).toBe(49)
    const scale = [0, 99, 75]
    expect(m.doMui(numeric, MUI.MUIM_Numeric_ScaleToValue, scale)).toBe(5)
    expect(scale[2]).toBe(47)
    m.set(numeric, MUI.MUIA_Numeric_Reverse, 1)
    expect(m.doMui(numeric, MUI.MUIM_Numeric_ValueToScale, [0, 99])).toBe(50)
    expect(m.doMui(numeric, MUI.MUIM_Numeric_ScaleToValue, [0, 99, 75])).toBe(-5)
  })

  it('handles MUI keys and round-trips Value through its ExportID', () => {
    const m = new MuiMaster()
    const numeric = m.newObjectA(MUIC.MUIC_Numeric, [
      tag(MUI.MUIA_Numeric_Min, 0), tag(MUI.MUIA_Numeric_Max, 100),
      tag(MUI.MUIA_Numeric_Default, 25), tag(MUI.MUIA_Numeric_Value, 50),
    ])!
    m.doMui(numeric, MUI.MUIM_HandleInput, [0, 9])
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(51)
    m.doMui(numeric, MUI.MUIM_HandleInput, [0, 1])
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(25)
    m.setInternal(numeric, MUI.MUIA_ExportID, 0x1234)
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    m.doMui(numeric, MUI.MUIM_Export, [ds.address])
    m.set(numeric, MUI.MUIA_Numeric_Value, 99)
    m.doMui(numeric, MUI.MUIM_Import, [ds.address])
    expect(m.get(numeric, MUI.MUIA_Numeric_Value)).toBe(25)
  })
})

describe('muimaster: Slider.mui 19.35', () => {
  it('injects the native slider frame/background and accepts both horizontal aliases', () => {
    const m = new MuiMaster()
    const slider = m.newObjectA(MUIC.MUIC_Slider)!
    expect(m.peek(slider, MUI.MUIA_Frame)).toBe(MUI.MUIV_Frame_Slider)
    expect(m.peek(slider, MUI.MUIA_Background)).toBe(MUI.MUII_SliderBack)
    expect(m.get(slider, MUI.MUIA_Slider_Horiz)).toBe(0)
    m.set(slider, MUI.MUIA_Group_Horiz, 1)
    expect(m.get(slider, MUI.MUIA_Slider_Horiz)).toBe(1)
    expect(m.get(slider, MUI.MUIA_Group_Horiz)).toBe(1)
  })

  it('adds the formatted knob dimensions on the correct axis', () => {
    const m = new MuiMaster()
    const vertical = m.newObjectA(MUIC.MUIC_Slider)!
    const horizontal = m.newObjectA(MUIC.MUIC_Slider, [tag(MUI.MUIA_Slider_Horiz, 1)])!
    const v = m.askMinMax(vertical)
    const h = m.askMinMax(horizontal)
    expect(v.minH).toBeGreaterThan(h.minH)
    expect(h.minW).toBeGreaterThan(v.minW)
    expect(v.maxH).toBe(MUI_MAXMAX)
    expect(h.maxW).toBe(MUI_MAXMAX)
  })

  it('draws the Stuntzi-style track, formatted knob, orientation, and quiet state', () => {
    const m = new MuiMaster()
    const host = new TestWindowHost()
    m.windowHost = host
    const slider = m.newObjectA(MUIC.MUIC_Slider, [
      tag(MUI.MUIA_Slider_Horiz, 1), tag(MUI.MUIA_Numeric_Value, 42), tag(MUI.MUIA_Slider_Quiet, 1),
    ])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, slider.address)])!
    m.set(win, MUI.MUIA_Window_Open, 1)
    m.doMui(slider, MUI.MUIM_Setup)
    m.doMui(slider, MUI.MUIM_Show)
    m.doMui(slider, MUI.MUIM_Draw, [3])
    expect(host.sliders.at(-1)).toMatchObject({ horizontal: true, label: '42', quiet: true })
    expect(host.sliders.at(-1)!.knob.width).toBeGreaterThan(0)
  })

  it('steps the track and preserves the grab offset while dragging', () => {
    const m = new MuiMaster()
    const slider = m.newObjectA(MUIC.MUIC_Slider, [
      tag(MUI.MUIA_Slider_Horiz, 1), tag(MUI.MUIA_Numeric_Min, 0),
      tag(MUI.MUIA_Numeric_Max, 100), tag(MUI.MUIA_Numeric_Value, 50),
    ])!
    m.layout(slider, 0, 0, 104, 16)
    m.doMui(slider, MUI.MUIM_HandleInput, [0x8, 0x68, 0, 100, 8])
    expect(m.get(slider, MUI.MUIA_Numeric_Value)).toBe(51)
    m.set(slider, MUI.MUIA_Numeric_Value, 50)
    m.doMui(slider, MUI.MUIM_HandleInput, [0x8, 0x68, 0, 52, 8])
    m.doMui(slider, MUI.MUIM_HandleInput, [0x10, 0, 0, 72, 8])
    expect(m.get(slider, MUI.MUIA_Numeric_Value)).toBeGreaterThan(50)
    const released = m.get(slider, MUI.MUIA_Numeric_Value)!
    m.doMui(slider, MUI.MUIM_HandleInput, [0x8, 0xe8, 0, 72, 8])
    m.doMui(slider, MUI.MUIM_HandleInput, [0x10, 0, 0, 20, 8])
    expect(m.get(slider, MUI.MUIA_Numeric_Value)).toBe(released)
    m.set(slider, MUI.MUIA_Numeric_Reverse, 1)
    m.set(slider, MUI.MUIA_Numeric_Value, 50)
    m.doMui(slider, MUI.MUIM_HandleInput, [0x8, 0x68, 0, 100, 8])
    expect(m.get(slider, MUI.MUIA_Numeric_Value)).toBe(49)
  })
})

describe('muimaster: Semaphore', () => {
  it('implements the five Exec semaphore operations exposed by 19.35', () => {
    const m = new MuiMaster()
    const sem = m.newObjectA('Semaphore.mui')!
    expect(send(sem, MUI.MUIM_Semaphore_Obtain)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_Attempt)).toBe(1)
    expect(send(sem, MUI.MUIM_Semaphore_Release)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_Release)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_ObtainShared)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_AttemptShared)).toBe(1)
    expect(send(sem, MUI.MUIM_Semaphore_Release)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_Release)).toBe(0)
  })

  it('is inherited by Dataspace', () => {
    const m = new MuiMaster()
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    expect(send(ds, MUI.MUIM_Semaphore_Attempt)).toBe(1)
    expect(send(ds, MUI.MUIM_Semaphore_Release)).toBe(0)
  })
})

describe('muimaster: Cclist 19.35', () => {
  it('parses unique $VER records and atomically fills a List with native record pointers', () => {
    const m = new MuiMaster()
    const strings = new Map<number, string>([
      [0x1000, '$VER: Foo.mui 1.2 (03.04.95) Copyright Stefan Stuntz'],
      [0x1100, '$VER: Bar.mui 2.0 (10.10.96) © Example Author'],
    ])
    const writes = new Map<number, number>()
    m.readString = (at) => strings.get(at) ?? ''
    m.readLong = () => 0
    m.writeLong = (at, value) => { writes.set(at, value); return true }
    const cc = m.newObjectA('Cclist.mui')!
    expect(send(cc, MUIM_CCLIST_ADD_CLASS, 0x1000)).toBe(0)
    send(cc, MUIM_CCLIST_ADD_CLASS, 0x1000)
    send(cc, MUIM_CCLIST_ADD_CLASS, 0x1100)
    const list = m.newObjectA(MUIC.MUIC_List)!
    expect(send(cc, MUIM_CCLIST_FILL_LIST, list.address)).toBe(0)
    expect(m.get(list, MUI.MUIA_List_Entries)).toBe(2)
    m.doMui(list, MUI.MUIM_List_GetEntry, [0, 0x9000])
    const record = writes.get(0x9000)!
    const offset = record - m.pool.base
    const view = new DataView(m.pool.buffer.buffer, m.pool.buffer.byteOffset, m.pool.buffer.byteLength)
    const name = view.getUint32(offset + 8, false)
    const version = view.getUint32(offset + 12, false)
    const date = view.getUint32(offset + 16, false)
    const owner = view.getUint32(offset + 20, false)
    expect([name, version, date, owner].map((at) => {
      let text = ''
      for (let i = at - m.pool.base; m.pool.buffer[i] !== 0; i++) text += String.fromCharCode(m.pool.buffer[i]!)
      return text
    })).toEqual(['Foo.mui', '1.2', '03.04.95', 'Stefan Stuntz'])
    expect(send(cc, MUI.MUIM_Semaphore_Attempt)).toBe(1)
    expect(send(cc, MUI.MUIM_Semaphore_Release)).toBe(0)
  })
})

describe('muimaster: Applist', () => {
  it('adds, removes and broadcasts to its applications', () => {
    const m = new MuiMaster()
    const list = m.newObjectA('Applist.mui')!
    const a = m.newObjectA(MUIC.MUIC_Application)!
    const b = m.newObjectA(MUIC.MUIC_Application)!
    expect(m.addMember(list, a)).toBe(0)
    expect(m.addMember(list, b)).toBe(0)
    expect(send(list, MUIM_APPLIST_BROADCAST, MUI.MUIM_Set, MUI.MUIA_Application_Sleep, 1)).toBe(0)
    expect([m.peek(a, MUI.MUIA_Application_Sleep), m.peek(b, MUI.MUIA_Application_Sleep)]).toEqual([1, 1])
    expect(m.remMember(list, a)).toBe(0)
    send(list, MUIM_APPLIST_BROADCAST, MUI.MUIM_Set, MUI.MUIA_Application_Sleep, 0)
    expect([m.peek(a, MUI.MUIA_Application_Sleep), m.peek(b, MUI.MUIA_Application_Sleep)]).toEqual([1, 0])
  })

  it('finds an application by string value or exact broker port', () => {
    const m = new MuiMaster()
    m.readString = (at) => new Map([[1, 'One'], [2, 'Two'], [3, 'Two']]).get(at) ?? ''
    const list = m.newObjectA('Applist.mui')!
    const a = m.newObjectA(MUIC.MUIC_Application, [
      tag(MUI.MUIA_Application_Title, 1),
    ])!
    m.setInternal(a, MUI.MUIA_Application_BrokerPort, 0x1234)
    const b = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Title, 2)])!
    m.addMember(list, a)
    m.addMember(list, b)
    expect(send(list, MUIM_APPLIST_FIND, MUI.MUIA_Application_Title, 3)).toBe(b.address)
    expect(send(list, MUIM_APPLIST_FIND, MUI.MUIA_Application_BrokerPort, 0x1234)).toBe(a.address)
    expect(send(list, MUIM_APPLIST_FIND, MUI.MUIA_Application_BrokerPort, 0x9999)).toBe(0)
  })
})

describe('muimaster: Dataspace', () => {
  function harness(): { m: MuiMaster; put: (bytes: number[]) => number; longs: Map<number, number> } {
    const m = new MuiMaster()
    const input = new Uint8Array(256)
    let used = 0
    const put = (bytes: number[]): number => {
      const at = 0x1000 + used
      input.set(bytes, used)
      used += bytes.length
      return at
    }
    m.readMemory = (address, length) => {
      if (address >= 0x1000 && address + length <= 0x1000 + input.length) {
        return input.slice(address - 0x1000, address - 0x1000 + length)
      }
      if (address >= m.pool.base && address + length <= m.pool.base + m.pool.buffer.length) {
        return m.pool.buffer.slice(address - m.pool.base, address - m.pool.base + length)
      }
      return null
    }
    const longs = new Map<number, number>()
    m.readLong = (address) => longs.get(address) ?? 0
    m.writeLong = (address, value) => (longs.set(address, value >>> 0), true)
    return { m, put, longs }
  }

  it('copies, finds, replaces, removes and clears addressable byte records', () => {
    const { m, put } = harness()
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    const first = send(ds, MUI.MUIM_Dataspace_Add, put([1, 2, 3]), 3, 42)
    expect(first).not.toBe(0)
    expect(send(ds, MUI.MUIM_Dataspace_Find, 42)).toBe(first)
    expect([...m.pool.buffer.slice(first - m.pool.base, first - m.pool.base + 3)]).toEqual([1, 2, 3])
    const second = send(ds, MUI.MUIM_Dataspace_Add, put([9, 8]), 2, 42)
    expect(send(ds, MUI.MUIM_Dataspace_Find, 42)).toBe(second)
    expect([...m.pool.buffer.slice(second - m.pool.base, second - m.pool.base + 2)]).toEqual([9, 8])
    expect(send(ds, MUI.MUIM_Dataspace_Remove, 42)).toBe(second)
    expect(send(ds, MUI.MUIM_Dataspace_Remove, 42)).toBe(0)
    send(ds, MUI.MUIM_Dataspace_Add, put([7]), 1, 1)
    expect(send(ds, MUI.MUIM_Dataspace_Clear)).toBe(0)
    expect(send(ds, MUI.MUIM_Dataspace_Find, 1)).toBe(0)
  })

  it('merges, compares and prunes records by id, length and contents', () => {
    const { m, put } = harness()
    const a = m.newObjectA(MUIC.MUIC_Dataspace)!
    const b = m.newObjectA(MUIC.MUIC_Dataspace)!
    send(a, MUI.MUIM_Dataspace_Add, put([1]), 1, 10)
    send(b, MUI.MUIM_Dataspace_Add, put([1]), 1, 10)
    send(b, MUI.MUIM_Dataspace_Add, put([2, 3]), 2, 20)
    expect(send(a, MUIM_DATASPACE_EQUAL, b.address)).toBe(0)
    expect(send(a, MUI.MUIM_Dataspace_Merge, b.address)).toBe(2)
    expect(send(a, MUIM_DATASPACE_EQUAL, b.address)).toBe(1)
    expect(send(a, MUIM_DATASPACE_PRUNE, b.address)).toBe(0)
    expect(send(a, MUI.MUIM_Dataspace_Find, 10)).toBe(0)
    expect(send(a, MUI.MUIM_Dataspace_Find, 20)).toBe(0)
  })

  it('the private iterator returns native record headers and advances its cursor', () => {
    const { m, put, longs } = harness()
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    const payload1 = send(ds, MUI.MUIM_Dataspace_Add, put([4]), 1, 11)
    const payload2 = send(ds, MUI.MUIM_Dataspace_Add, put([5]), 1, 12)
    const cursor = 0x2000
    expect(send(ds, MUIM_DATASPACE_NEXT, cursor)).toBe(payload1 - 16)
    expect(longs.get(cursor)).toBe(payload2 - 16)
    expect(send(ds, MUIM_DATASPACE_NEXT, cursor)).toBe(payload2 - 16)
    expect(longs.get(cursor)).toBe(0)
    expect(send(ds, MUIM_DATASPACE_NEXT, cursor)).toBe(payload1 - 16)
  })

  it('writes and reads the native id/length/data IFF chunk payload', () => {
    const { m, put } = harness()
    const source = m.newObjectA(MUIC.MUIC_Dataspace)!
    send(source, MUI.MUIM_Dataspace_Add, put([0xaa, 0xbb]), 2, 0x11223344)
    let saved: Uint8Array | null = null
    m.writeIffChunk = (handle, type, id, bytes) => {
      expect([handle, type, id]).toEqual([9, 0x50524546, 0x4d554943])
      saved = bytes.slice()
      return 0
    }
    expect(send(source, MUI.MUIM_Dataspace_WriteIFF, 9, 0x50524546, 0x4d554943)).toBe(0)
    expect(saved && [...saved]).toEqual([0x11, 0x22, 0x33, 0x44, 0, 0, 0, 2, 0xaa, 0xbb])

    const target = m.newObjectA(MUIC.MUIC_Dataspace)!
    m.readIffChunk = (handle) => (handle === 9 ? saved : -1)
    expect(send(target, MUI.MUIM_Dataspace_ReadIFF, 9)).toBe(0)
    const found = send(target, MUI.MUIM_Dataspace_Find, 0x11223344)
    expect([...m.pool.buffer.slice(found - m.pool.base, found - m.pool.base + 2)]).toEqual([0xaa, 0xbb])
  })
})

describe('muimaster: Configdata', () => {
  function configured(attrs: TagItem[] = []): { m: MuiMaster; obj: BoopsiObject; longs: Map<number, number> } {
    const m = new MuiMaster()
    const longs = new Map<number, number>()
    m.readLong = (address) => longs.get(address) ?? 0
    m.writeLong = (address, value) => (longs.set(address, value >>> 0), true)
    return { m, obj: m.newObjectA(MUIC.MUIC_Configdata, attrs)!, longs }
  }

  it('gets scalar and string defaults from the native 150-entry table', () => {
    const { m, obj, longs } = configured()
    expect(send(obj, MUIM_CONFIGDATA_GET, 1, 0x2000)).toBe(1)
    expect(longs.get(0x2000)).toBe(4)
    expect(send(obj, MUIM_CONFIGDATA_GET, 24, 0x2004)).toBe(1)
    const pointer = longs.get(0x2004)!
    expect(String.fromCharCode(...m.pool.buffer.slice(pointer - m.pool.base, pointer - m.pool.base + 7))).toBe('300000\0')
    expect(send(obj, MUIM_CONFIGDATA_GET, 151, 0x2008)).toBe(0)
  })

  it('sets scalar and string items, reports presence, and follows a fallback', () => {
    const { m, obj: fallback, longs } = configured()
    expect(send(fallback, MUIM_CONFIGDATA_SET, 1, 99)).not.toBe(0)
    m.readString = (address) => (address === 0x3000 ? '123456' : '')
    expect(send(fallback, MUIM_CONFIGDATA_SET, 24, 0x3000)).not.toBe(0)
    const obj = m.newObjectA(MUIC.MUIC_Configdata, [tag(MUIA_CONFIGDATA_FALLBACK, fallback.address)])!
    expect(m.get(obj, MUIA_CONFIGDATA_FALLBACK)).toBe(fallback.address)
    expect(send(obj, MUIM_CONFIGDATA_HAS, 1)).toBe(1)
    expect(send(obj, MUIM_CONFIGDATA_GET, 1, 0x2000)).toBe(1)
    expect(longs.get(0x2000)).toBe(99)
    expect(send(obj, MUIM_CONFIGDATA_GET, 24, 0x2004)).toBe(1)
    const pointer = longs.get(0x2004)!
    expect(String.fromCharCode(...m.pool.buffer.slice(pointer - m.pool.base, pointer - m.pool.base + 7))).toBe('123456\0')
  })

  it('applies positive and preference-group selectors to Dataspace mutations', () => {
    const one = configured([tag(MUIA_CONFIGDATA_SELECTOR, 24)])
    one.m.readMemory = (_address, length) => new Uint8Array(length)
    expect(send(one.obj, MUIM_CONFIGDATA_ACCEPTS, 24)).toBe(1)
    expect(send(one.obj, MUIM_CONFIGDATA_ACCEPTS, 25)).toBe(0)
    expect(send(one.obj, MUI.MUIM_Dataspace_Add, 0x1000, 1, 25)).toBe(0)
    expect(send(one.obj, MUI.MUIM_Dataspace_Add, 0x1000, 1, 24)).not.toBe(0)

    const group = configured([tag(MUIA_CONFIGDATA_SELECTOR, -2)]) // -(group + 1): group 1
    expect(send(group.obj, MUIM_CONFIGDATA_ACCEPTS, 1)).toBe(1)
    expect(send(group.obj, MUIM_CONFIGDATA_ACCEPTS, 5)).toBe(0)
    expect(send(group.obj, MUIM_CONFIGDATA_ACCEPTS, 0x80000001)).toBe(0)
  })

  it('prunes values equal to native defaults when no comparison object is supplied', () => {
    const { obj } = configured()
    expect(send(obj, MUIM_CONFIGDATA_SET, 1, 4)).not.toBe(0)
    expect(send(obj, MUIM_CONFIGDATA_HAS, 1)).toBe(1)
    send(obj, MUIM_DATASPACE_PRUNE, 0)
    expect(send(obj, MUIM_CONFIGDATA_HAS, 1)).toBe(0)
  })
})

describe('muimaster: Family', () => {
  it('adds at head, tail and after a predecessor, then removes and sorts', () => {
    const m = new MuiMaster()
    const family = m.newObjectA(MUIC.MUIC_Family)!
    const a = m.newObjectA(MUIC.MUIC_Notify)!
    const b = m.newObjectA(MUIC.MUIC_Notify)!
    const c = m.newObjectA(MUIC.MUIC_Notify)!
    expect(send(family, MUI.MUIM_Family_AddTail, a.address)).toBe(1)
    expect(send(family, MUI.MUIM_Family_AddHead, b.address)).toBe(1)
    expect(send(family, MUI.MUIM_Family_Insert, c.address, b.address)).toBe(1)
    expect(m.children(family)).toEqual([b, c, a])
    send(family, MUI.MUIM_Family_Sort, a.address, b.address, c.address, 0)
    expect(m.children(family)).toEqual([a, b, c])
    send(family, MUI.MUIM_Family_Sort, a.address, b.address, 0)
    expect(m.children(family)).toEqual([a, b, c])
    expect(send(family, MUI.MUIM_Family_Remove, b.address)).toBe(1)
    expect(m.children(family)).toEqual([a, c])
    expect(m.parent(b)).toBeNull()
  })

  it('accepts both Family_Child and Group_Child during construction', () => {
    const m = new MuiMaster()
    const a = m.newObjectA(MUIC.MUIC_Notify)!
    const b = m.newObjectA(MUIC.MUIC_Notify)!
    const family = m.newObjectA(MUIC.MUIC_Family, [
      tag(MUI.MUIA_Family_Child, a.address),
      tag(MUI.MUIA_Group_Child, b.address),
    ])!
    expect(m.children(family)).toEqual([a, b])
  })

  it('exposes an addressable MinList-shaped child list', () => {
    const m = new MuiMaster()
    const child = m.newObjectA(MUIC.MUIC_Notify)!
    const family = m.newObjectA(MUIC.MUIC_Family, [tag(MUI.MUIA_Family_Child, child.address)])!
    const list = m.get(family, MUI.MUIA_Family_List)!
    const long = (at: number): number => {
      const off = at - m.pool.base
      return (((m.pool.buffer[off]! << 24) | (m.pool.buffer[off + 1]! << 16) | (m.pool.buffer[off + 2]! << 8) | m.pool.buffer[off + 3]!) >>> 0)
    }
    const node = long(list)
    expect(node).not.toBe(0)
    expect(long(node + 8)).toBe(child.address)
  })

  it('transfers children in order and recursively searches and gets userdata', () => {
    const m = new MuiMaster()
    const child = m.newObjectA(MUIC.MUIC_Notify, [tag(MUI.MUIA_UserData, 77), tag(MUI.MUIA_ExportID, 88)])!
    const from = m.newObjectA(MUIC.MUIC_Family, [tag(MUI.MUIA_Family_Child, child.address)])!
    const to = m.newObjectA(MUIC.MUIC_Family)!
    expect(m.get(from, MUI.MUIA_ExportID)).toBe(88)
    expect(send(from, MUI.MUIM_FindUData, 77)).toBe(child.address)
    const values = new Map<number, number>()
    m.writeLong = (address, value) => (values.set(address, value), true)
    expect(send(from, MUI.MUIM_GetUData, 77, MUI.MUIA_ExportID, 0x2000)).toBe(1)
    expect(values.get(0x2000)).toBe(88)
    expect(send(from, MUI.MUIM_Family_Transfer, to.address)).toBe(0)
    expect(m.children(from)).toEqual([])
    expect(m.children(to)).toEqual([child])
  })

  it('broadcasts unowned methods and implements masked menu exclusivity', () => {
    const m = new MuiMaster()
    const a = m.newObjectA(MUIC.MUIC_Menuitem, [tag(MUI.MUIA_Menuitem_Checked, 1)])!
    const b = m.newObjectA(MUIC.MUIC_Menuitem, [tag(MUI.MUIA_Menuitem_Checked, 1)])!
    const family = m.newObjectA(MUIC.MUIC_Menu, [tag(MUI.MUIA_Family_Child, a.address), tag(MUI.MUIA_Family_Child, b.address)])!
    send(family, MUI.MUIM_SetUData, 0, MUI.MUIA_UserData, 9)
    expect([m.get(a, MUI.MUIA_UserData), m.get(b, MUI.MUIA_UserData)]).toEqual([9, 9])
    expect(send(family, MUIM_FAMILY_EXCLUSIVE, a.address, 3)).toBe(0)
    expect([m.get(a, MUI.MUIA_Menuitem_Checked), m.get(b, MUI.MUIA_Menuitem_Checked)]).toEqual([1, 0])
  })
})

describe('muimaster: Menustrip', () => {
  it('is enabled by default and exposes its settable enabled state', () => {
    const m = new MuiMaster()
    const strip = m.newObjectA(MUIC.MUIC_Menustrip)!
    expect(m.get(strip, MUI.MUIA_Menustrip_Enabled)).toBe(1)
    expect(m.set(strip, MUI.MUIA_Menustrip_Enabled, 0)).toBeGreaterThan(0)
    expect(m.get(strip, MUI.MUIA_Menustrip_Enabled)).toBe(0)
  })

  it('builds and frees a cleared twenty-byte NewMenu terminator', () => {
    const m = new MuiMaster()
    const strip = m.newObjectA(MUIC.MUIC_Menustrip)!
    const handle = send(strip, MUIM_MENUSTRIP_BUILD)
    expect(handle).not.toBe(0)
    expect(m.pool.sizeOf(handle)).toBe(24) // MemPool rounds the native 20 bytes to eight-byte alignment
    expect([...m.pool.buffer.slice(handle - m.pool.base, handle - m.pool.base + 20)]).toEqual(new Array(20).fill(0))
    expect(send(strip, MUIM_MENUSTRIP_FREE, handle)).toBe(0)
    expect(m.pool.sizeOf(handle)).toBe(0)
  })

  it('forwards family mutations and rebuilds only while a menu handle is live', () => {
    const m = new MuiMaster()
    const strip = m.newObjectA(MUIC.MUIC_Menustrip)!
    const menu = m.newObjectA(MUIC.MUIC_Menu)!
    let updates = 0
    m.menuChanged = (got) => {
      expect(got).toBe(strip)
      updates++
    }
    const handle = send(strip, MUIM_MENUSTRIP_BUILD)
    expect(send(strip, MUI.MUIM_Family_AddTail, menu.address)).toBe(0)
    expect(m.children(strip)).toEqual([menu])
    expect(updates).toBe(1)
    expect(send(strip, MUIM_MENUSTRIP_UPDATE, 1, 2)).toBe(0)
    expect(updates).toBe(2)
    expect(m.remMember(strip, menu)).toBe(0)
    expect(updates).toBe(3)
    send(strip, MUIM_MENUSTRIP_FREE, handle)
    m.addMember(strip, menu)
    expect(updates).toBe(3)
  })

  it('disposing a strip releases every outstanding built menu', () => {
    const m = new MuiMaster()
    const strip = m.newObjectA(MUIC.MUIC_Menustrip)!
    const a = send(strip, MUIM_MENUSTRIP_BUILD)
    const b = send(strip, MUIM_MENUSTRIP_BUILD)
    m.disposeObject(strip)
    expect([m.pool.sizeOf(a), m.pool.sizeOf(b)]).toEqual([0, 0])
  })
})

describe('muimaster: Menu', () => {
  const long = (m: MuiMaster, address: number): number => {
    const at = address - m.pool.base
    return (((m.pool.buffer[at]! << 24) | (m.pool.buffer[at + 1]! << 16) | (m.pool.buffer[at + 2]! << 8) | m.pool.buffer[at + 3]!) >>> 0)
  }

  it('defaults to an enabled menu titled Unnamed', () => {
    const m = new MuiMaster()
    const menu = m.newObjectA(MUIC.MUIC_Menu)!
    expect(m.get(menu, MUI.MUIA_Menu_Enabled)).toBe(1)
    const title = m.get(menu, MUI.MUIA_Menu_Title)!
    expect(String.fromCharCode(...m.pool.buffer.slice(title - m.pool.base, title - m.pool.base + 8))).toBe('Unnamed\0')
  })

  it('fills the exact 20-byte NewMenu title record used by Menustrip', () => {
    const m = new MuiMaster()
    const menu = m.newObjectA(MUIC.MUIC_Menu, [tag(MUI.MUIA_Menu_Title, 0x12345678)])!
    const strip = m.newObjectA(MUIC.MUIC_Menustrip, [tag(MUI.MUIA_Family_Child, menu.address)])!
    const handle = send(strip, MUIM_MENUSTRIP_BUILD)
    expect(handle).not.toBe(0)
    expect(m.pool.buffer[handle - m.pool.base]).toBe(1)
    expect(long(m, handle + 2)).toBe(0x12345678)
    const key = long(m, handle + 6)
    expect(String.fromCharCode(...m.pool.buffer.slice(key - m.pool.base, key - m.pool.base + 2))).toBe('a\0')
    expect(((m.pool.buffer[handle + 10 - m.pool.base]! << 8) | m.pool.buffer[handle + 11 - m.pool.base]!)).toBe(0)
    expect(long(m, handle + 16)).toBe(menu.address)
    expect([...m.pool.buffer.slice(handle - m.pool.base + 20, handle - m.pool.base + 40)]).toEqual(new Array(20).fill(0))
  })

  it('updates its parent for attributes and family mutations', () => {
    const m = new MuiMaster()
    const menu = m.newObjectA(MUIC.MUIC_Menu)!
    const strip = m.newObjectA(MUIC.MUIC_Menustrip, [tag(MUI.MUIA_Family_Child, menu.address)])!
    const handle = send(strip, MUIM_MENUSTRIP_BUILD)
    let updates = 0
    m.menuChanged = () => updates++
    m.set(menu, MUI.MUIA_Menu_Enabled, 0)
    m.set(menu, MUI.MUIA_Menu_Title, 0x1111)
    const item = m.newObjectA(MUIC.MUIC_Menuitem)!
    expect(send(menu, MUI.MUIM_Family_AddTail, item.address)).toBe(0)
    expect(updates).toBe(3)
    send(strip, MUIM_MENUSTRIP_FREE, handle)
  })

  it('synchronizes enabled state into bit zero of an Intuition Menu', () => {
    const m = new MuiMaster()
    const menu = m.newObjectA(MUIC.MUIC_Menu)!
    const memory = m.pool.alloc(16, { clear: true })
    expect(send(menu, MUIM_MENU_SYNC, memory)).toBe(0)
    expect(m.pool.buffer[memory + 13 - m.pool.base]! & 1).toBe(1)
    m.set(menu, MUI.MUIA_Menu_Enabled, 0)
    send(menu, MUIM_MENU_SYNC, memory)
    expect(m.pool.buffer[memory + 13 - m.pool.base]! & 1).toBe(0)
  })
})

describe('muimaster: Menuitem', () => {
  const long = (m: MuiMaster, address: number): number => {
    const at = address - m.pool.base
    return (((m.pool.buffer[at]! << 24) | (m.pool.buffer[at + 1]! << 16) | (m.pool.buffer[at + 2]! << 8) | m.pool.buffer[at + 3]!) >>> 0)
  }
  const word = (m: MuiMaster, address: number): number => {
    const at = address - m.pool.base
    return (m.pool.buffer[at]! << 8) | m.pool.buffer[at + 1]!
  }

  it('defaults exactly like the native constructor', () => {
    const m = new MuiMaster()
    const item = m.newObjectA(MUIC.MUIC_Menuitem)!
    expect(m.get(item, MUI.MUIA_Menuitem_Enabled)).toBe(1)
    expect(m.get(item, MUI.MUIA_Menuitem_Title)).not.toBe(0)
    expect(m.get(item, MUI.MUIA_Menuitem_Shortcut)).toBe(0)
    expect(m.get(item, MUI.MUIA_Menuitem_Exclude)).toBe(0)
    expect(m.get(item, MUI.MUIA_Menuitem_Trigger)).toBe(0)
  })

  it('fills its native NewMenu record and recursively advances subitem types', () => {
    const m = new MuiMaster()
    const sub = m.newObjectA(MUIC.MUIC_Menuitem, [tag(MUI.MUIA_Menuitem_Title, 0x2222)])!
    const item = m.newObjectA(MUIC.MUIC_Menuitem, [
      tag(MUI.MUIA_Menuitem_Title, 0x1111),
      tag(MUI.MUIA_Menuitem_Shortcut, 0x3333),
      tag(MUI.MUIA_Menuitem_Exclude, 0xa5a5),
      tag(MUI.MUIA_Menuitem_Checkit, 1),
      tag(MUI.MUIA_Menuitem_Checked, 1),
      tag(MUI.MUIA_Menuitem_Toggle, 1),
      tag(MUI.MUIA_Menuitem_CommandString, 1),
      tag(MUI.MUIA_Menuitem_Enabled, 0),
      tag(MUI.MUIA_Family_Child, sub.address),
    ])!
    const menu = m.newObjectA(MUIC.MUIC_Menu, [tag(MUI.MUIA_Family_Child, item.address)])!
    const strip = m.newObjectA(MUIC.MUIC_Menustrip, [tag(MUI.MUIA_Family_Child, menu.address)])!
    const handle = send(strip, MUIM_MENUSTRIP_BUILD)
    const at = handle + 20
    expect(m.pool.buffer[at - m.pool.base]).toBe(2)
    expect(long(m, at + 2)).toBe(0x1111)
    expect(long(m, at + 6)).toBe(0x3333)
    expect(word(m, at + 10)).toBe(0x11d)
    expect(long(m, at + 12)).toBe(0xa5a5)
    expect(long(m, at + 16)).toBe(item.address)
    expect(m.pool.buffer[at + 20 - m.pool.base]).toBe(3)
  })

  it('synchronizes checked and enabled into the live Intuition MenuItem flags', () => {
    const m = new MuiMaster()
    const item = m.newObjectA(MUIC.MUIC_Menuitem, [
      tag(MUI.MUIA_Menuitem_Checked, 1),
      tag(MUI.MUIA_Menuitem_Enabled, 1),
    ])!
    const memory = m.pool.alloc(24, { clear: true })
    send(item, MUIM_MENU_SYNC, memory)
    expect(word(m, memory + 12)).toBe(0x110)
    m.set(item, MUI.MUIA_Menuitem_Checked, 0)
    m.set(item, MUI.MUIA_Menuitem_Enabled, 0)
    send(item, MUIM_MENU_SYNC, memory)
    expect(word(m, memory + 12)).toBe(0)
  })

  it('applies exclusion through its parent and reports live menu changes', () => {
    const m = new MuiMaster()
    const a = m.newObjectA(MUIC.MUIC_Menuitem, [tag(MUI.MUIA_Menuitem_Checkit, 1), tag(MUI.MUIA_Menuitem_Exclude, 2)])!
    const b = m.newObjectA(MUIC.MUIC_Menuitem, [tag(MUI.MUIA_Menuitem_Checked, 1)])!
    const menu = m.newObjectA(MUIC.MUIC_Menu, [tag(MUI.MUIA_Family_Child, a.address), tag(MUI.MUIA_Family_Child, b.address)])!
    const strip = m.newObjectA(MUIC.MUIC_Menustrip, [tag(MUI.MUIA_Family_Child, menu.address)])!
    const handle = send(strip, MUIM_MENUSTRIP_BUILD)
    let changes = 0
    m.menuChanged = () => changes++
    m.set(a, MUI.MUIA_Menuitem_Checked, 1)
    expect(m.get(b, MUI.MUIA_Menuitem_Checked)).toBe(0)
    // One synchronization for this item and one for the excluded sibling.
    expect(changes).toBe(2)
    send(strip, MUIM_MENUSTRIP_FREE, handle)
  })

  it('imports and exports checked state only for checkable identified items', () => {
    const m = new MuiMaster()
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    const item = m.newObjectA(MUIC.MUIC_Menuitem, [
      tag(MUI.MUIA_ObjectID, 77),
      tag(MUI.MUIA_Menuitem_Checkit, 1),
      tag(MUI.MUIA_Menuitem_Checked, 1),
    ])!
    expect(send(item, MUI.MUIM_Export, ds.address)).toBe(0)
    m.set(item, MUI.MUIA_Menuitem_Checked, 0)
    expect(send(item, MUI.MUIM_Import, ds.address)).toBe(0)
    expect(m.get(item, MUI.MUIA_Menuitem_Checked)).toBe(1)
  })

  it('uses Trigger to mirror a selected native check item without retaining its pointer', () => {
    const m = new MuiMaster()
    const item = m.newObjectA(MUIC.MUIC_Menuitem, [tag(MUI.MUIA_Menuitem_Checkit, 1)])!
    const native = m.pool.alloc(24, { clear: true })
    m.pool.buffer[native + 12 - m.pool.base] = 1
    m.set(item, MUI.MUIA_Menuitem_Trigger, native)
    expect(m.get(item, MUI.MUIA_Menuitem_Checked)).toBe(1)
    expect(m.get(item, MUI.MUIA_Menuitem_Trigger)).toBe(0)
  })

  it('owns constructor and replacement strings when the private copy tag is set', () => {
    const m = new MuiMaster()
    const poolText = (address: number): string => {
      let text = ''
      for (let at = address - m.pool.base; m.pool.buffer[at] !== 0; at++) text += String.fromCharCode(m.pool.buffer[at]!)
      return text
    }
    const source = m.pool.alloc(8, { clear: true })
    m.pool.buffer.set(Uint8Array.from([79, 112, 101, 110, 0]), source - m.pool.base)
    const item = m.newObjectA(MUIC.MUIC_Menuitem, [
      tag(MUI.MUIA_Menuitem_Title, source),
      tag(MUIA_MENUITEM_COPY_STRINGS, 1),
    ])!
    const first = m.get(item, MUI.MUIA_Menuitem_Title)!
    expect(first).not.toBe(source)
    expect(m.pool.sizeOf(first)).not.toBe(0)
    m.pool.buffer[source - m.pool.base] = 88
    expect(poolText(first)).toBe('Open')

    m.set(item, MUI.MUIA_Menuitem_Title, source)
    const second = m.get(item, MUI.MUIA_Menuitem_Title)!
    expect(second).not.toBe(source)
    expect(m.pool.sizeOf(first)).toBe(0)
    expect(poolText(second)).toBe('Xpen')
  })
})

describe('muimaster: Application', () => {
  it('copies the exact native metadata defaults and enforces SingleTask by title', () => {
    const m = new MuiMaster()
    const text = (address: number): string => {
      let value = ''
      for (let at = address - m.pool.base; m.pool.buffer[at] !== 0; at++) value += String.fromCharCode(m.pool.buffer[at]!)
      return value
    }
    const first = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_SingleTask, 1)])!
    expect(text(m.get(first, MUI.MUIA_Application_Title)!)).toBe('Unnamed')
    expect(text(m.get(first, MUI.MUIA_Application_Version)!)).toBe('$VER: Unnamed 0.0')
    expect(text(m.get(first, MUI.MUIA_Application_Base)!)).toBe('UNNAMED')
    expect(m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_SingleTask, 1)])).toBeNull()
    expect(m.get(first, MUI.MUIA_Application_DoubleStart)).toBe(1)
  })

  it('owns windows, exposes a native list, and propagates application context', () => {
    const m = new MuiMaster()
    const text = m.newObjectA(MUIC.MUIC_Text)!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, text.address)])!
    const app = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Window, win.address)])!
    expect(m.parent(win)).toBe(app)
    expect(m.get(text, MUI.MUIA_ApplicationObject)).toBe(app.address)
    const list = m.get(app, MUI.MUIA_Application_WindowList)!
    const at = list - m.pool.base
    const node = (((m.pool.buffer[at]! << 24) | (m.pool.buffer[at + 1]! << 16) | (m.pool.buffer[at + 2]! << 8) | m.pool.buffer[at + 3]!) >>> 0)
    const no = node - m.pool.base + 8
    expect((((m.pool.buffer[no]! << 24) | (m.pool.buffer[no + 1]! << 16) | (m.pool.buffer[no + 2]! << 8) | m.pool.buffer[no + 3]!) >>> 0)).toBe(win.address)
  })

  it('drains return IDs before one copied PushMethod message', () => {
    const m = new MuiMaster()
    const app = m.newObjectA(MUIC.MUIC_Application)!
    const target = m.newObjectA(MUIC.MUIC_Notify)!
    expect(send(app, MUI.MUIM_Application_PushMethod, target.address, 3, MUI.MUIM_Set, MUI.MUIA_UserData, 42)).toBe(1)
    send(app, MUI.MUIM_Application_ReturnID, 7)
    expect(send(app, MUI.MUIM_Application_NewInput, 0)).toBe(7)
    expect(m.get(target, MUI.MUIA_UserData)).toBe(0)
    expect(send(app, MUI.MUIM_Application_NewInput, 0)).toBe(0)
    expect(m.get(target, MUI.MUIA_UserData)).toBe(42)
  })

  it('InputBuffered preserves an ID for the next ordinary input call', () => {
    const m = new MuiMaster()
    const app = m.newObjectA(MUIC.MUIC_Application)!
    const signal = m.pool.alloc(4, { clear: true })
    m.readLong = (address) => address === signal ? 1 : 0
    const writes = new Map<number, number>()
    m.writeLong = (address, value) => (writes.set(address, value), true)
    send(app, MUI.MUIM_Application_ReturnID, 9)
    expect(send(app, MUI.MUIM_Application_InputBuffered)).toBe(0)
    expect(send(app, MUI.MUIM_Application_NewInput, signal)).toBe(9)
    expect(writes.get(signal)).toBe(0)
  })

  it('adds and removes native input-handler nodes and invokes their method', () => {
    const m = new MuiMaster()
    const app = m.newObjectA(MUIC.MUIC_Application)!
    const node = m.pool.alloc(24, { clear: true })
    const signal = m.pool.alloc(4, { clear: true })
    const longs = new Map<number, number>([[signal, 4], [node + 8, app.address], [node + 12, 4], [node + 20, MUI.MUIM_Application_ReturnID]])
    m.readLong = (address) => longs.get(address) ?? 0
    m.writeLong = () => true
    expect(send(app, MUI.MUIM_Application_AddInputHandler, node)).toBe(0)
    expect(send(app, MUI.MUIM_Application_NewInput, signal)).toBe(0)
    expect(send(app, MUI.MUIM_Application_NewInput, 0)).toBe(4)
    expect(send(app, MUI.MUIM_Application_RemInputHandler, node)).toBe(0)
  })

  it('schedules MUIIHNF_TIMER handlers by their millisecond interval', () => {
    const m = new MuiMaster()
    const app = m.newObjectA(MUIC.MUIC_Application)!
    const node = m.pool.alloc(24, { clear: true })
    m.pool.buffer[node + 19 - m.pool.base] = 1
    const longs = new Map<number, number>([[node + 8, app.address], [node + 12, 100], [node + 20, MUI.MUIM_Application_ShowHelp]])
    m.readLong = (address) => longs.get(address) ?? 0
    let now = 0
    let calls = 0
    m.applicationNow = () => now
    m.applicationHelp = () => ++calls
    send(app, MUI.MUIM_Application_AddInputHandler, node)
    now = 99
    send(app, MUI.MUIM_Application_NewInput, 0)
    expect(calls).toBe(0)
    now = 100
    send(app, MUI.MUIM_Application_NewInput, 0)
    expect(calls).toBe(1)
    now = 199
    send(app, MUI.MUIM_Application_NewInput, 0)
    expect(calls).toBe(1)
    now = 200
    send(app, MUI.MUIM_Application_NewInput, 0)
    expect(calls).toBe(2)
  })

  it('sets and gets menu state by recursively finding Menuitem userdata', () => {
    const m = new MuiMaster()
    const item = m.newObjectA(MUIC.MUIC_Menuitem, [tag(MUI.MUIA_UserData, 55)])!
    const menu = m.newObjectA(MUIC.MUIC_Menu, [tag(MUI.MUIA_Family_Child, item.address)])!
    const strip = m.newObjectA(MUIC.MUIC_Menustrip, [tag(MUI.MUIA_Family_Child, menu.address)])!
    const app = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Menustrip, strip.address)])!
    expect(send(app, MUI.MUIM_Application_SetMenuCheck, 55, 1)).toBeGreaterThan(0)
    expect(send(app, MUI.MUIM_Application_GetMenuCheck, 55)).toBe(1)
    expect(send(app, MUI.MUIM_Application_SetMenuState, 55, 0)).toBeGreaterThan(0)
    expect(send(app, MUI.MUIM_Application_GetMenuState, 55)).toBe(0)
    expect(send(app, MUI.MUIM_Application_GetMenuState, 999)).toBe(2)
  })

  it('round-trips identified child state through the native Dataspace payload', () => {
    const m = new MuiMaster()
    const item = m.newObjectA(MUIC.MUIC_Menuitem, [
      tag(MUI.MUIA_ObjectID, 0x1234),
      tag(MUI.MUIA_Menuitem_Checkit, 1),
      tag(MUI.MUIA_Menuitem_Checked, 1),
    ])!
    const menu = m.newObjectA(MUIC.MUIC_Menu, [tag(MUI.MUIA_Family_Child, item.address)])!
    const strip = m.newObjectA(MUIC.MUIC_Menustrip, [tag(MUI.MUIA_Family_Child, menu.address)])!
    const app = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Menustrip, strip.address)])!
    let saved: Uint8Array | null = null
    m.applicationSave = (application, name, bytes) => {
      expect(application).toBe(app)
      expect(name).toBe(7)
      saved = bytes.slice()
      return true
    }
    expect(send(app, MUI.MUIM_Application_Save, 7)).toBe(1)
    expect(saved && [...saved]).toEqual([
      0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 24, 0x50, 0x52, 0x45, 0x46,
      0x4d, 0x55, 0x49, 0x43, 0, 0, 0, 12,
      0, 0, 0x12, 0x34, 0, 0, 0, 4, 0, 0, 0, 1,
    ])
    m.set(item, MUI.MUIA_Menuitem_Checked, 0)
    m.applicationLoad = (application, name) => application === app && name === 7 ? saved : null
    expect(send(app, MUI.MUIM_Application_Load, 7)).toBe(1)
    expect(m.get(item, MUI.MUIA_Menuitem_Checked)).toBe(1)
  })

  it('nests Sleep and exposes system helper operations through platform bridges', () => {
    const m = new MuiMaster()
    const app = m.newObjectA(MUIC.MUIC_Application)!
    m.set(app, MUI.MUIA_Application_Sleep, 1)
    m.set(app, MUI.MUIA_Application_Sleep, 1)
    m.set(app, MUI.MUIA_Application_Sleep, 0)
    expect(m.peek(app, MUI.MUIA_Application_Sleep)).toBe(1)
    m.set(app, MUI.MUIA_Application_Sleep, 0)
    expect(m.peek(app, MUI.MUIA_Application_Sleep)).toBe(0)

    let about = 0
    let config = 0
    m.applicationAbout = () => { about++ }
    m.applicationConfig = (_application, open) => (config += open ? 1 : -1)
    expect(send(app, MUI.MUIM_Application_AboutMUI, 0)).toBe(0)
    expect(send(app, MUI.MUIM_Application_OpenConfigWindow)).toBe(1)
    expect([about, config]).toEqual([1, 1])
  })
})

/** send a method the way EasyLife does: an id and a run of longwords */
function send(obj: BoopsiObject, method: number, ...params: number[]): number {
  return obj.cl.dispatcher(obj.cl, obj, { MethodID: method, params } as never)
}

describe('muimaster: notification', () => {
  it('MUIM_Set is a Set, which is what Mui Set sends', () => {
    const m = new MuiMaster()
    const w = m.newObjectA(MUIC.MUIC_Window)!
    send(w, MUI.MUIM_Set, MUI.MUIA_Window_Title, 0x99)
    expect(m.get(w, MUI.MUIA_Window_Title)).toBe(0x99)
  })

  it('fires only on the value named, unless that value is MUIV_EveryTime', () => {
    const m = new MuiMaster()
    const src = m.newObjectA(MUIC.MUIC_Window)!
    const dst = m.newObjectA(MUIC.MUIC_Window)!
    // when the source closes, put a title on the destination. The trigger is
    // "..g" — a program cannot Set it, the user does, so the change comes
    // through setInternal exactly as it would from an IDCMP_CLOSEWINDOW
    send(src, MUI.MUIM_Notify, MUI.MUIA_Window_CloseRequest, 1, dst.address, 3, MUI.MUIM_Set, MUI.MUIA_Window_Title, 42)
    expect(m.notifications(src).length).toBe(1)

    m.setInternal(src, MUI.MUIA_Window_CloseRequest, 0)
    expect(m.get(dst, MUI.MUIA_Window_Title)).toBe(0)
    m.setInternal(src, MUI.MUIA_Window_CloseRequest, 1)
    expect(m.get(dst, MUI.MUIA_Window_Title)).toBe(42)
  })

  it('MUIV_TriggerValue is replaced by the value that arrived', () => {
    const m = new MuiMaster()
    const src = m.newObjectA(MUIC.MUIC_Window)!
    const dst = m.newObjectA(MUIC.MUIC_Window)!
    send(
      src,
      MUI.MUIM_Notify,
      MUI.MUIA_Window_Activate,
      MUI.MUIV_EveryTime,
      dst.address,
      3,
      MUI.MUIM_Set,
      MUI.MUIA_Window_Title,
      MUI.MUIV_TriggerValue,
    )
    m.set(src, MUI.MUIA_Window_Activate, 7)
    expect(m.get(dst, MUI.MUIA_Window_Title)).toBe(7)
    m.set(src, MUI.MUIA_Window_Activate, 9)
    expect(m.get(dst, MUI.MUIA_Window_Title)).toBe(9)
  })

  it('MUIV_Notify_Self, _Parent, _Window and _Application resolve up the tree', () => {
    const m = new MuiMaster()
    const text = m.newObjectA(MUIC.MUIC_Text)!
    const group = m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Child, text.address)])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, group.address)])!
    const app = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Window, win.address)])!

    // a button several groups deep telling the application to quit is the
    // single most common line in a MUI program
    send(
      text,
      MUI.MUIM_Notify,
      MUI.MUIA_Pressed,
      0,
      MUI.MUIV_Notify_Application,
      3,
      MUI.MUIM_Set,
      MUI.MUIA_Application_Active,
      1,
    )
    m.setInternal(text, MUI.MUIA_Pressed, 0)
    expect(m.get(app, MUI.MUIA_Application_Active)).toBe(1)

    send(text, MUI.MUIM_Notify, MUI.MUIA_Disabled, 1, MUI.MUIV_Notify_Window, 3, MUI.MUIM_Set, MUI.MUIA_Window_Title, 5)
    m.set(text, MUI.MUIA_Disabled, 1)
    expect(m.get(win, MUI.MUIA_Window_Title)).toBe(5)

    // and Self, which is a notification an object sends to itself
    send(win, MUI.MUIM_Notify, MUI.MUIA_Window_Activate, 1, MUI.MUIV_Notify_Self, 3, MUI.MUIM_Set, MUI.MUIA_UserData, 3)
    m.set(win, MUI.MUIA_Window_Activate, 1)
    expect(m.get(win, MUI.MUIA_UserData)).toBe(3)
    expect(m.parent(text)).toBe(group)
  })

  it('MUIM_KillNotify drops the triggers on one attribute', () => {
    const m = new MuiMaster()
    const src = m.newObjectA(MUIC.MUIC_Window)!
    send(src, MUI.MUIM_Notify, MUI.MUIA_Window_Activate, 1, MUI.MUIV_Notify_Self, 3, MUI.MUIM_Set, 0, 0)
    expect(m.notifications(src).length).toBe(1)
    send(src, MUI.MUIM_KillNotify, MUI.MUIA_Window_Activate)
    expect(m.notifications(src).length).toBe(0)
  })

  it('kills only the first matching notification, optionally restricted by destination', () => {
    const m = new MuiMaster()
    const src = m.newObjectA(MUIC.MUIC_Window)!
    const a = m.newObjectA(MUIC.MUIC_Window)!
    const b = m.newObjectA(MUIC.MUIC_Window)!
    for (const dest of [a, b, a]) send(src, MUI.MUIM_Notify, MUI.MUIA_Window_Activate, 1, dest.address, 1, MUI.MUIM_Set)
    expect(send(src, MUI.MUIM_KillNotifyObj, MUI.MUIA_Window_Activate, a.address)).toBe(0)
    expect(m.notifications(src).map((n) => typeof n.dest === 'number' ? n.dest : n.dest.address)).toEqual([b.address, a.address])
    send(src, MUI.MUIM_KillNotify, MUI.MUIA_Window_Activate)
    expect(m.notifications(src)).toHaveLength(1)
  })

  it('NoNotifySet changes an attribute without firing its notification', () => {
    const m = new MuiMaster()
    const src = m.newObjectA(MUIC.MUIC_Window)!
    send(src, MUI.MUIM_Notify, MUI.MUIA_Window_Activate, MUI.MUIV_EveryTime, src.address, 3, MUI.MUIM_Set, MUI.MUIA_UserData, 7)
    expect(send(src, MUI.MUIM_NoNotifySet, MUI.MUIA_Window_Activate, 1)).toBe(1)
    expect(m.get(src, MUI.MUIA_Window_Activate)).toBe(1)
    expect(m.get(src, MUI.MUIA_UserData)).toBe(0)

    src.cl.dispatcher(src.cl, src, {
      MethodID: OM_SET,
      attrs: [tag(MUI.MUIA_Window_Activate, 2), tag(MUI.MUIA_NoNotify, 1)],
    } as never)
    expect(m.get(src, MUI.MUIA_Window_Activate)).toBe(2)
    expect(m.get(src, MUI.MUIA_UserData)).toBe(0)
  })

  it('SetAsString formats values and MultiSet updates each terminated object', () => {
    const m = new MuiMaster()
    const strings = new Map([[0x1000, 'value %ld / %s'], [0x1004, 'ok']])
    m.readString = (address) => strings.get(address) ?? ''
    const text = m.newObjectA(MUIC.MUIC_Text)!
    expect(send(text, MUI.MUIM_SetAsString, MUI.MUIA_Text_Contents, 0x1000, 42, 0x1004)).toBe(1)
    const pointer = m.get(text, MUI.MUIA_Text_Contents)!
    expect(String.fromCharCode(...m.pool.buffer.slice(pointer - m.pool.base, pointer - m.pool.base + 14))).toBe('value 42 / ok\0')
    const a = m.newObjectA(MUIC.MUIC_Text)!
    const b = m.newObjectA(MUIC.MUIC_Text)!
    expect(send(text, MUI.MUIM_MultiSet, MUI.MUIA_Disabled, 1, a.address, b.address, 0)).toBe(0)
    expect([m.get(a, MUI.MUIA_Disabled), m.get(b, MUI.MUIA_Disabled)]).toEqual([1, 1])
  })

  it('writes longwords and strings through the guest memory bridge', () => {
    const m = new MuiMaster()
    const obj = m.newObjectA(MUIC.MUIC_Notify)!
    let long: [number, number] | null = null
    let bytes: [number, number[]] | null = null
    m.writeLong = (address, value) => (long = [address, value], true)
    m.readString = (address) => address === 0x1000 ? 'hello' : ''
    m.writeMemory = (address, value) => (bytes = [address, [...value]], true)
    expect(send(obj, MUI.MUIM_WriteLong, 0x12345678, 0x2000)).toBe(0)
    expect(long).toEqual([0x2000, 0x12345678])
    expect(send(obj, MUI.MUIM_WriteString, 0x1000, 0x3000)).toBe(0)
    expect(bytes).toEqual([0x3000, [104, 101, 108, 108, 111, 0]])
  })

  it('implements local userdata search, set, get, and the private context methods', () => {
    const m = new MuiMaster()
    const obj = m.newObjectA(MUIC.MUIC_Notify, [tag(MUI.MUIA_UserData, 55)])!
    const longs = new Map<number, number>()
    m.writeLong = (address, value) => (longs.set(address, value), true)
    expect(send(obj, MUI.MUIM_FindUData, 55)).toBe(obj.address)
    expect(send(obj, MUI.MUIM_SetUData, 55, MUI.MUIA_ExportID, 99)).toBe(1)
    expect(send(obj, MUI.MUIM_GetUData, 55, MUI.MUIA_ExportID, 0x2000)).toBe(1)
    expect(longs.get(0x2000)).toBe(99)
    const app = m.newObjectA(MUIC.MUIC_Application)!
    expect(send(obj, MUIM_NOTIFY_SET_CONTEXT, app.address)).toBe(0)
    expect(m.get(obj, MUI.MUIA_UserData)).toBe(55)
    expect(m.get(obj, MUI.MUIA_ApplicationObject)).toBe(app.address)
    expect(send(obj, MUIM_NOTIFY_IS_SELF, obj.address)).toBe(obj.address)
    expect(send(obj, MUIM_NOTIFY_IS_SELF, 0xdead)).toBe(0)
  })

  it('answers computed Notify attributes and delegates GetConfigItem', () => {
    const m = new MuiMaster()
    const obj = m.newObjectA(MUIC.MUIC_Notify)!
    const longs = new Map<number, number>()
    m.writeLong = (address, value) => (longs.set(address, value), true)
    expect([m.get(obj, MUI.MUIA_Version), m.get(obj, MUI.MUIA_Revision)]).toEqual([19, 35])
    expect(m.get(obj, MUI.MUIA_AppMessage)).toBe(0)
    expect(send(obj, MUI.MUIM_GetConfigItem, 1, 0x2000)).toBe(1)
    expect(longs.get(0x2000)).toBe(4)
    expect(send(obj, MUI.MUIM_CallHook, 0x1000)).toBe(0)
  })
})

describe('muimaster: MUI_MakeObjectA', () => {
  it('MUIO_Button and MUIO_PopButton are the two EasyLife reaches', () => {
    const m = new MuiMaster()
    m.readString = (address) => address === 0x1000 ? 'Button' : ''
    const b = m.makeObjectA(MUI.MUIO_Button, [0x1000])!
    expect(b.cl).toBe(m.findClass(MUIC.MUIC_Text))
    expect(m.get(b, MUI.MUIA_Text_Contents)).not.toBe(0x1000)
    expect(m.textOf(b, MUI.MUIA_Text_Contents)).toBe('Button')
    // MUIA_Frame is "i.." and therefore invisible to a program, which is why
    // the check goes through peek rather than get
    expect(m.peek(b, MUI.MUIA_Frame)).toBe(MUI.MUIV_Frame_Button)

    const p = m.makeObjectA(MUI.MUIO_PopButton, [MUI.MUII_PopUp])!
    expect(p.cl).toBe(m.findClass(MUIC.MUIC_Image))
    expect(m.peek(p, MUI.MUIA_Image_Spec)).toBe(MUI.MUII_PopUp)
  })

  it('the shapes with no caller yet answer null rather than a wrong tree', () => {
    const m = new MuiMaster()
    expect(m.makeObjectA(MUI.MUIO_Slider, [0, 0, 10])).toBeNull()
  })
})

describe('muimaster: MUIM_AskMinMax', () => {
  const m = (): MuiMaster => {
    const x = new MuiMaster()
    // one pooled label, so a Text has something to measure
    x.readString = (at) => (at === 1 ? 'Quit' : at === 2 ? 'Hello there' : '')
    return x
  }

  it('a Text is as wide as its label and one line tall, and stretches sideways', () => {
    const x = m()
    const t = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!
    expect(x.askMinMax(t)).toEqual({ minW: 32, minH: 8, maxW: MUI_MAXMAX, maxH: 8, defW: 32, defH: 8 })
  })

  it("MUI's own escapes take no room in a label", () => {
    // "\033r" right-justifies and is two characters of formatting; a Text
    // measured with them in is two pixels-per-code too wide. Tag_Editor's
    // status lines are full of them
    expect(visibleLength('\x1brLength: 0')).toBe(9)
    expect(visibleLength('\x1bb\x1buBold')).toBe(4)
    const x = m()
    x.readString = () => '\x1brQuit'
    const t = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!
    expect(x.askMinMax(t).minW).toBe(32)
  })

  it('a Rectangle is a spacer: nothing of its own, unlimited both ways', () => {
    const x = m()
    const r = x.newObjectA(MUIC.MUIC_Rectangle)!
    expect(x.askMinMax(r)).toEqual({ minW: 0, minH: 0, maxW: MUI_MAXMAX, maxH: MUI_MAXMAX, defW: 0, defH: 0 })
  })

  it('a frame costs two pixels on every edge, added by Area', () => {
    const x = m()
    const plain = x.askMinMax(x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!)
    const framed = x.askMinMax(
      x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1), tag(MUI.MUIA_Frame, MUI.MUIV_Frame_Button)])!,
    )
    expect(framed.minW - plain.minW).toBe(4)
    expect(framed.minH - plain.minH).toBe(4)
  })

  it('a vertical group sums its children and adds the spacing between them', () => {
    const x = m()
    const a = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!
    const b = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 2)])!
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Child, a.address),
      tag(MUI.MUIA_Group_Child, b.address),
    ])!
    const mm = x.askMinMax(g)
    // heights add, with one pixel between; widths take the larger
    expect(mm.minH).toBe(8 + 8 + 1)
    expect(mm.minW).toBe(11 * 8)
  })

  it('a horizontal group does it the other way round', () => {
    const x = m()
    const a = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!
    const b = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 2)])!
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Horiz, 1),
      tag(MUI.MUIA_Group_Child, a.address),
      tag(MUI.MUIA_Group_Child, b.address),
    ])!
    const mm = x.askMinMax(g)
    expect(mm.minW).toBe(4 * 8 + 11 * 8 + 1)
    expect(mm.minH).toBe(8)
  })
})

describe('muimaster: layout', () => {
  const two = (horiz: boolean, wa: number, wb: number): { x: MuiMaster; g: BoopsiObject; a: BoopsiObject; b: BoopsiObject } => {
    const x = new MuiMaster()
    x.readString = () => ''
    const a = x.newObjectA(MUIC.MUIC_String, [tag(MUI.MUIA_Weight, wa)])!
    const b = x.newObjectA(MUIC.MUIC_String, [tag(MUI.MUIA_Weight, wb)])!
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Horiz, horiz ? 1 : 0),
      tag(MUI.MUIA_Group_Spacing, 0),
      tag(MUI.MUIA_Group_Child, a.address),
      tag(MUI.MUIA_Group_Child, b.address),
    ])!
    return { x, g, a, b }
  }

  it("equal weights halve the room, which is the autodoc's starting point", () => {
    const { x, g, a, b } = two(true, 100, 100)
    x.askMinMax(g)
    x.layout(g, 0, 0, 100, 20)
    expect(x.boxOf(a)!.width).toBe(50)
    expect(x.boxOf(b)!.width).toBe(50)
  })

  it('200 against 100 makes the left one twice as big — 66 and 34', () => {
    // "Because the left gadget is twice as heavy as the right gadget, it will
    // become twice as big (about 66 pixel) as the right one (34 pixel)"
    const { x, g, a, b } = two(true, 200, 100)
    x.askMinMax(g)
    x.layout(g, 0, 0, 100, 20)
    expect([x.boxOf(a)!.width, x.boxOf(b)!.width]).toEqual([66, 34])
  })

  it('a weight of zero keeps an object at its minimum', () => {
    const { x, g, a, b } = two(true, 0, 100)
    const min = x.askMinMax(a).minW
    x.askMinMax(g)
    x.layout(g, 0, 0, 200, 20)
    expect(x.boxOf(a)!.width).toBe(min)
    expect(x.boxOf(b)!.width).toBe(200 - min)
  })

  it('children are placed in order, with the spacing between them', () => {
    const x = new MuiMaster()
    x.readString = () => ''
    const kids = [0, 1, 2].map(() => x.newObjectA(MUIC.MUIC_Rectangle)!)
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Spacing, 4),
      ...kids.map((k) => tag(MUI.MUIA_Group_Child, k.address)),
    ])!
    x.askMinMax(g)
    x.layout(g, 10, 20, 100, 38)
    // 38 = three tens and two fours
    expect(kids.map((k) => x.boxOf(k)!.top)).toEqual([20, 34, 48])
    expect(kids.map((k) => x.boxOf(k)!.height)).toEqual([10, 10, 10])
    expect(kids.every((k) => x.boxOf(k)!.left === 10 && x.boxOf(k)!.width === 100)).toBe(true)
  })

  it('a frame pushes the children inside it', () => {
    const x = new MuiMaster()
    x.readString = () => ''
    const k = x.newObjectA(MUIC.MUIC_Rectangle)!
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Frame, MUI.MUIV_Frame_Group),
      tag(MUI.MUIA_Group_Child, k.address),
    ])!
    x.askMinMax(g)
    x.layout(g, 0, 0, 100, 100)
    expect(x.boxOf(k)).toEqual({ left: 2, top: 2, width: 96, height: 96 })
  })

  it('an object with nothing laid out on it has no box', () => {
    const x = new MuiMaster()
    expect(x.boxOf(x.newObjectA(MUIC.MUIC_Text)!)).toBeNull()
  })
})

/*
 * The cross-check that makes the generated table evidence rather than a
 * transcription: EasyLife ships its own copy of MUI's constants, by name, in
 * the Tags bank its Tag Editor writes. Two independent transcriptions of the
 * same numbers agreeing is worth more than either alone — and a disagreement
 * would be the most interesting result in this file.
 */
const TAG_EDITOR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  'fixtures',
  'extensions',
  'easylife-1.10',
  'demos',
  'Tag_Editor.AMOS',
)

/** every (name, value) in a Tags bank, by walking both links of every node */
function tagsBank(data: Uint8Array): Map<string, number> {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const out = new Map<string, number>()
  const seen = new Set<number>()
  const walk = (at: number): void => {
    if (at === 0 && seen.size > 0) return
    if (seen.has(at) || at + 10 > data.length) return
    seen.add(at)
    const len = v.getUint16(at + 8, false)
    if (at + 10 + len > data.length) return
    out.set(String.fromCharCode(...data.slice(at + 10, at + 10 + len)), v.getUint32(at + 4, false))
    for (const link of [v.getUint16(at, false), v.getUint16(at + 2, false)]) if (link !== 0) walk(link)
  }
  walk(0)
  return out
}

describe.skipIf(!existsSync(TAG_EDITOR))("muimaster.gen against EasyLife's own Tags bank", () => {
  const bank = (): Map<string, number> => {
    const a = parseAmosFile(new Uint8Array(readFileSync(TAG_EDITOR)))
    const b = a.banks.find((x) => x.kind === 'memory' && x.name === 'Tags')
    return tagsBank(b?.kind === 'memory' ? b.data : new Uint8Array())
  }

  it('the bank is the real thing and holds hundreds of MUI constants', () => {
    const t = bank()
    expect(t.size).toBeGreaterThan(300)
    expect(t.get('MUIA_Window_Title')).toBe(0x8042ad3d)
  })

  /**
   * Three constants differ, and all three are the version gap rather than an
   * error. EasyLife's guide tells the reader to install `mui22usr`, so the
   * bank was written against MUI 2.2 and the header here is 3.8:
   *
   *   MUII_Count     40 -> 42   two image types added between the releases
   *   MUII_LASTPAT  143 -> 145  the same two, at the end of the pattern range
   *   MUIMASTER_VMIN  8 -> 11   3.8 asks for more than 2.2 did
   *
   * The last one is the useful one: EasyLife's routine 233 opens the library
   * with `moveq #$8,d0`, and 8 is exactly what MUI 2.2's own header told it to
   * ask for. Two independent artifacts, one a shipped data bank and the other
   * a disassembled instruction, agreeing on a number.
   */
  const VERSION_DRIFT: Readonly<Record<string, [bank: number, header: number]>> = {
    MUII_Count: [40, 42],
    MUII_LASTPAT: [143, 145],
    MUIMASTER_VMIN: [8, 11],
  }

  it('every MUI_ name both tables have agrees, bar the three MUI 2.2 predates', () => {
    const t = bank()
    const disagree: string[] = []
    let checked = 0
    for (const [name, value] of t) {
      const ours = (MUI as Record<string, number>)[name]
      if (ours === undefined) continue
      checked++
      if (ours !== value) disagree.push(`${name}: header ${ours}, bank ${value}`)
    }
    expect(checked).toBeGreaterThan(300)
    expect(disagree.sort()).toEqual(
      Object.entries(VERSION_DRIFT)
        .map(([n, [b, h]]) => `${n}: header ${h}, bank ${b}`)
        .sort(),
    )
  })

  it("the bank's MUIMASTER_VMIN is the version EasyLife's moveq asks for", () => {
    // routine 233 ($31e6): lea "muimaster.library" / moveq #$8,d0 / OpenLibrary
    expect(bank().get('MUIMASTER_VMIN')).toBe(8)
  })

  it('the class names agree too', () => {
    const t = bank()
    for (const [k, v] of Object.entries(MUIC)) {
      // the bank stores a class name as a tag whose value is a string pointer
      // it cannot resolve, so only the NAME is comparable — its presence is
      // the check, and MUIC_ is how EasyLife programs spell it
      if (t.has(k)) expect(typeof v).toBe('string')
    }
    expect(MUIC.MUIC_Window).toBe('Window.mui')
  })
})

describe('muimaster: the generated table itself', () => {
  it('every built-in attribute owner exists', () => {
    const m = new MuiMaster()
    for (const [attr, cls] of Object.entries(MUI_OWNER)) {
      if (!(cls in MUI_BUILTIN_SUPER)) continue
      expect(m.findClass(`${cls}.mui`), `${attr} -> ${cls}`).not.toBeNull()
    }
  })

  it('the four LVOs EasyLife reaches are the FD file’s', () => {
    // ##bias 30, then NewObjectA, DisposeObject, RequestA at 30/36/42 and
    // MakeObjectA sixteenth at 120 — and EasyLife's moveq values sign-extend
    // to exactly those: $e2 -> -30, $dc -> -36, $d6 -> -42, $88 -> -120
    const ext = (b: number): number => (b << 24) >> 24
    expect([ext(0xe2), ext(0xdc), ext(0xd6), ext(0x88)]).toEqual([-30, -36, -42, -120])
  })
})
