<template>
  <Teleport to="body">
    <div v-if="open" class="share-dialog-overlay" @click.self="closeDialog">
      <div class="share-dialog">
        <h2>Share Document</h2>
        <div v-if="errors.length" class="errors">
          <p v-for="err in errors" :key="err">{{ err }}</p>
        </div>
        <div v-if="!shareLink">
          <button @click="createLink('viewer')" :disabled="loading">
            {{ loading ? 'Creating...' : 'Create viewer link' }}
          </button>
          <button @click="createLink('editor')" :disabled="loading">
            Create editor link
          </button>
        </div>
        <div v-else class="share-link-result">
          <input :value="shareLink" readonly />
          <button @click="copyLink">Copy</button>
        </div>
        <div v-if="members.length" class="members-list">
          <h3>People with access</h3>
          <ul>
            <li v-for="member in members" :key="member.id">
              <span>{{ member.name || member.email || member.id }}</span>
              <span class="member-role">{{ member.role }}</span>
            </li>
          </ul>
        </div>
        <button @click="closeDialog">Close</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useShareDialog } from './useShareDialog'

const { open, errors, shareLink, members, loading, closeDialog, createLink, copyLink } = useShareDialog()
</script>

<style scoped>
.share-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.share-dialog {
  background: white;
  padding: 24px;
  border-radius: 8px;
  max-width: 400px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.share-dialog h2 {
  margin: 0;
  font-size: 18px;
}
.errors p {
  color: red;
  margin: 4px 0;
  font-size: 14px;
}
.share-link-result {
  display: flex;
  gap: 8px;
}
.share-link-result input {
  flex: 1;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}
.members-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.members-list h3 {
  margin: 0;
  font-size: 14px;
}
.members-list ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.members-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.member-role {
  color: #666;
  text-transform: capitalize;
}
button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: #6750a4;
  color: white;
}
button:disabled {
  opacity: 0.6;
}
</style>
