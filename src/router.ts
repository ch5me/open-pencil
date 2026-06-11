import { createRouter, createWebHistory } from 'vue-router'

import { isHostedAuthEnabled } from '@/app/hosted/flags'
import { isAuthenticated, refreshSession } from '@/app/hosted/session'

import AuthCallbackView from './views/AuthCallbackView.vue'
import EditorView from './views/EditorView.vue'
import LoginView from './views/LoginView.vue'

async function requireAuth(next: (value?: string | { path: string }) => void, hostedOnly = false) {
  if (!isHostedAuthEnabled()) {
    if (hostedOnly) {
      next({ path: '/' })
      return
    }
    next()
    return
  }
  if (!isAuthenticated()) {
    await refreshSession()
  }
  if (!isAuthenticated()) {
    next({ path: '/login' })
    return
  }
  next()
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      component: LoginView,
      meta: { requiresGuest: true }
    },
    {
      path: '/auth/callback',
      component: AuthCallbackView
    },
    {
      path: '/',
      component: EditorView,
      beforeEnter: async (_to, _from, next) => {
        await requireAuth(next)
      }
    },
    {
      path: '/demo',
      component: EditorView,
      meta: { demo: true },
      beforeEnter: async (_to, _from, next) => {
        await requireAuth(next)
      }
    },
    {
      path: '/share/:roomId',
      component: EditorView,
      beforeEnter: async (_to, _from, next) => {
        await requireAuth(next)
      }
    },
    {
      path: '/hosted',
      component: EditorView,
      meta: { hostedOnly: true },
      beforeEnter: async (_to, _from, next) => {
        await requireAuth(next, true)
      }
    },
    {
      path: '/hosted/:documentId',
      component: EditorView,
      meta: { hostedOnly: true },
      beforeEnter: async (_to, _from, next) => {
        await requireAuth(next, true)
      }
    }
  ]
})

export default router
