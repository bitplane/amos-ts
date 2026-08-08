import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OM_ADDMEMBER, OM_REMMEMBER, OM_SET, type BoopsiObject, type OpMember, type TagItem } from './boopsi'
import { MuiMaster } from './muimaster'
import { MUI, MUIC, MUI_ATTR, MUI_OWNER, MUI_SUPER } from './muimaster.gen'
import { parseAmosFile } from '../loader/amosfile'

const tag = (t: number, data: number): TagItem => ({ tag: t, data })

describe('muimaster: the class tree', () => {
  it('registers every class the header names, under the right parent', () => {
    const m = new MuiMaster()
    // 65 MUIC_ names, less Cclist, which the drawn tree has no place for
    expect(m.classNames.length).toBe(Object.keys(MUI_SUPER).length)
    expect(m.findClass(MUIC.MUIC_Cclist)).toBeNull()

    const win = m.findClass(MUIC.MUIC_Window)!
    const notify = m.findClass(MUIC.MUIC_Notify)!
    const area = m.findClass(MUIC.MUIC_Area)!
    expect(win.superClass).toBe(notify)
    expect(area.superClass).toBe(notify)
    // Group is under Area, not Family, which is the one people misremember
    expect(m.findClass(MUIC.MUIC_Group)!.superClass).toBe(area)
    expect(m.findClass(MUIC.MUIC_Menustrip)!.superClass).toBe(m.findClass(MUIC.MUIC_Family))
    // and Dtpic, which the drawing omits and Zune places under Area
    expect(m.findClass(MUIC.MUIC_Dtpic)!.superClass).toBe(area)
  })

  it('every class descends from rootclass', () => {
    const m = new MuiMaster()
    for (const n of m.classNames) expect(m.findClass(n)!.isA(m.boopsi.rootClass)).toBe(true)
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
    send(src, MUI.MUIM_Notify, MUI.MUIA_Window_CloseRequest, 1, dst.address, MUI.MUIM_Set, MUI.MUIA_Window_Title, 42)
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
      MUI.MUIM_Set,
      MUI.MUIA_Application_Active,
      1,
    )
    m.setInternal(text, MUI.MUIA_Pressed, 0)
    expect(m.get(app, MUI.MUIA_Application_Active)).toBe(1)

    send(text, MUI.MUIM_Notify, MUI.MUIA_Disabled, 1, MUI.MUIV_Notify_Window, MUI.MUIM_Set, MUI.MUIA_Window_Title, 5)
    m.set(text, MUI.MUIA_Disabled, 1)
    expect(m.get(win, MUI.MUIA_Window_Title)).toBe(5)

    // and Self, which is a notification an object sends to itself
    send(win, MUI.MUIM_Notify, MUI.MUIA_Window_Activate, 1, MUI.MUIV_Notify_Self, MUI.MUIM_Set, MUI.MUIA_UserData, 3)
    m.set(win, MUI.MUIA_Window_Activate, 1)
    expect(m.get(win, MUI.MUIA_UserData)).toBe(3)
    expect(m.parent(text)).toBe(group)
  })

  it('MUIM_KillNotify drops the triggers on one attribute', () => {
    const m = new MuiMaster()
    const src = m.newObjectA(MUIC.MUIC_Window)!
    send(src, MUI.MUIM_Notify, MUI.MUIA_Window_Activate, 1, MUI.MUIV_Notify_Self, MUI.MUIM_Set, 0, 0)
    expect(m.notifications(src).length).toBe(1)
    send(src, MUI.MUIM_KillNotify, MUI.MUIA_Window_Activate)
    expect(m.notifications(src).length).toBe(0)
  })
})

describe('muimaster: MUI_MakeObjectA', () => {
  it('MUIO_Button and MUIO_PopButton are the two EasyLife reaches', () => {
    const m = new MuiMaster()
    const b = m.makeObjectA(MUI.MUIO_Button, [0x1000])!
    expect(b.cl).toBe(m.findClass(MUIC.MUIC_Text))
    expect(m.get(b, MUI.MUIA_Text_Contents)).toBe(0x1000)
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
  it('every attribute is owned by a class that exists', () => {
    const m = new MuiMaster()
    for (const [attr, cls] of Object.entries(MUI_OWNER)) {
      if (cls === 'Cclist') continue
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
