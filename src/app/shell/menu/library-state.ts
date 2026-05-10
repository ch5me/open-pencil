import { ref } from 'vue'

const libraryOpen = ref(false)

export function openLibraryDialog() {
  libraryOpen.value = true
}

export function closeLibraryDialog() {
  libraryOpen.value = false
}

export function useLibraryState() {
  return {
    libraryOpen
  }
}
