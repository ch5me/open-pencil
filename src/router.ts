import { createRouter, createWebHistory } from 'vue-router'

import EditorView from './views/EditorView.vue'
import LoginView from './views/LoginView.vue'
import SignupView from './views/SignupView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: EditorView },
    { path: '/demo', component: EditorView, meta: { demo: true } },
    { path: '/share/:roomId', component: EditorView },
    { path: '/login', component: LoginView },
    { path: '/signup', component: SignupView }
  ]
})

export default router
