import { useClipboard } from '@vueuse/core'
import { computed, inject, provide, proxyRefs } from 'vue'
import type { InjectionKey, ShallowUnwrapRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import IconFilePlus from '~icons/lucide/file-plus'
import IconFolderOpen from '~icons/lucide/folder-open'
import IconImageDown from '~icons/lucide/image-down'
import IconSave from '~icons/lucide/save'
import IconZoomIn from '~icons/lucide/zoom-in'

import { useEditorCommands, useI18n } from '@open-pencil/vue'

import { DEFAULT_COLLAB_STATE, useCollabInjected } from '@/app/collab/use'
import { useEditorStore } from '@/app/editor/active-store'
import { toolIcons } from '@/app/editor/icons'
import { isHostedCollabEnabled } from '@/app/hosted/flags'
import { openFileDialog } from '@/app/shell/menu/use'
import { toast } from '@/app/shell/ui'
import type { ToolbarActionItem } from '@/components/Toolbar/types'

type MenuAction = ToolbarActionItem

function createMobileHudContext() {
  const route = useRoute()
  const router = useRouter()
  const collab = useCollabInjected()
  const store = useEditorStore()
  const { copy } = useClipboard()
  const { dialogs } = useI18n()
  const { getCommand } = useEditorCommands()

  const collabState = computed(() => collab?.state.value ?? DEFAULT_COLLAB_STATE)
  const collabPeers = computed(() => collab?.remotePeers.value ?? [])
  const followingPeer = computed(() => collab?.followingPeer.value ?? null)
  const onlineCount = computed(() => collabPeers.value.length + 1)
  const activeToolIcon = computed(() => toolIcons[store.state.activeTool])
  const actionToast = computed(() => store.state.actionToast)
  const pendingDocumentId = computed(() =>
    typeof route.params.documentId === 'string' ? route.params.documentId : null
  )
  const isHostedDocument = computed(() => isHostedCollabEnabled() && !!pendingDocumentId.value)

  const menuItems: MenuAction[] = [
    {
      icon: IconFilePlus,
      label: 'New',
      action: () => void import('@/app/tabs').then((m) => m.createTab())
    },
    { icon: IconFolderOpen, label: 'Open…', action: () => void openFileDialog() },
    { icon: IconSave, label: 'Save', action: () => void store.saveFigFile() },
    { icon: IconImageDown, label: 'Export…', action: () => void store.exportSelection(1, 'png') },
    { icon: IconZoomIn, label: 'Zoom to fit', action: () => getCommand('view.zoomFit').run() }
  ]

  function undo() {
    getCommand('edit.undo').run()
  }

  function redo() {
    getCommand('edit.redo').run()
  }

  function share() {
    if (!collab) return
    if (isHostedDocument.value && pendingDocumentId.value) {
      collab.connectHostedDocument(pendingDocumentId.value)
      void router.push(`/hosted/${pendingDocumentId.value}`)
      void copy(`${window.location.origin}/hosted/${pendingDocumentId.value}`)
    } else {
      const roomId = collab.shareCurrentDoc()
      void router.push(`/share/${roomId}`)
      void copy(`${window.location.origin}/share/${roomId}`)
    }
    toast.info('Link copied to clipboard')
  }

  function disconnect() {
    if (!collab) return
    collab.disconnect()
    void router.push('/')
  }

  function toggleFollowPeer(clientId: number) {
    collab?.followPeer(followingPeer.value === clientId ? null : clientId)
  }

  return {
    store,
    dialogs,
    collabState,
    collabPeers,
    followingPeer,
    onlineCount,
    activeToolIcon,
    actionToast,
    menuItems,
    undo,
    redo,
    share,
    disconnect,
    toggleFollowPeer
  }
}

export type MobileHudContext = ShallowUnwrapRef<ReturnType<typeof createMobileHudContext>>

const MOBILE_HUD_KEY: InjectionKey<MobileHudContext> = Symbol('MobileHudContext')

export function provideMobileHud() {
  const ctx = proxyRefs(createMobileHudContext())
  provide(MOBILE_HUD_KEY, ctx)
  return ctx
}

export function useMobileHudContext(): MobileHudContext {
  const ctx = inject(MOBILE_HUD_KEY)
  if (!ctx) throw new Error('Mobile HUD controls must be used within MobileHud')
  return ctx
}
