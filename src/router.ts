import { createRouter, createWebHistory } from 'vue-router'

import { isHostedAuthEnabled } from '@/app/hosted/flags'
import { isAuthenticated, refreshSession } from '@/app/hosted/session'

import EditorView from './views/EditorView.vue'

async function requireHostedAccess(next: (value?: string | { path: string }) => void) {
  if (!isHostedAuthEnabled()) {
    next({ path: '/' })
    return
  }
  if (!isAuthenticated()) {
    await refreshSession()
  }
  if (!isAuthenticated()) {
    next({ path: '/' })
    return
  }
  next()
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: EditorView },
    { path: '/demo', component: EditorView, meta: { demo: true } },
    { path: '/share/:roomId', component: EditorView },
    {
      path: '/hosted',
      component: EditorView,
      meta: { hostedOnly: true },
      beforeEnter: async (_to, _from, next) => {
        await requireHostedAccess(next)
      }
    },
    {
      path: '/hosted/:documentId',
      component: EditorView,
      meta: { hostedOnly: true },
      beforeEnter: async (_to, _from, next) => {
        await requireHostedAccess(next)
      }
    }
  ]
})

export default router
