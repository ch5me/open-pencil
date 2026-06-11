/**
 * Shared helper for the "share/connect hosted" flow, used by CollabPanel and MobileHud.
 * Avoids duplicating the if/else routing + copy + toast logic.
 *
 * @module collab/share-link
 */

import type { Router } from 'vue-router'

import { toast } from '@/app/shell/ui'

type ShareContext = {
  collab: {
    connectHostedDocument(documentId: string): void
    shareCurrentDoc(): string
  }
  copy: (text: string) => Promise<void>
  router: Router
  isHostedDocument: boolean
  pendingDocumentId: string | null
}

export function shareCollabLink({
  collab,
  copy,
  router,
  isHostedDocument,
  pendingDocumentId
}: ShareContext): void {
  if (isHostedDocument && pendingDocumentId) {
    collab.connectHostedDocument(pendingDocumentId)
    void router.push(`/hosted/${pendingDocumentId}`)
    void copy(`${window.location.origin}/hosted/${pendingDocumentId}`)
  } else {
    const roomId = collab.shareCurrentDoc()
    void router.push(`/share/${roomId}`)
    void copy(`${window.location.origin}/share/${roomId}`)
  }
  toast.info('Link copied to clipboard')
}
