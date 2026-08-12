import { createRouter, createWebHistory } from 'vue-router'

import { isHostedAuthEnabled } from '@/app/hosted/flags'
import { isAuthenticated, refreshSession } from '@/app/hosted/session'

import AuthCallbackView from './views/AuthCallbackView.vue'
import EditorView from './views/EditorView.vue'
import LoginView from './views/LoginView.vue'
import StorageView from './views/StorageView.vue'

async function requireHostedAuth() {
  if (!isHostedAuthEnabled()) return true
  if (!isAuthenticated()) await refreshSession()
  return isAuthenticated() ? true : { path: '/login' }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView },
    { path: '/auth/callback', component: AuthCallbackView },
    { path: '/', component: EditorView, beforeEnter: requireHostedAuth },
    { path: '/storage', component: StorageView },
    { path: '/demo', component: EditorView, meta: { demo: true }, beforeEnter: requireHostedAuth },
    { path: '/share/:roomId', component: EditorView, beforeEnter: requireHostedAuth },
    {
      path: '/hosted',
      component: EditorView,
      meta: { hostedOnly: true },
      beforeEnter: requireHostedAuth
    },
    {
      path: '/hosted/:documentId',
      component: EditorView,
      meta: { hostedOnly: true },
      beforeEnter: requireHostedAuth
    }
  ]
})

export default router
