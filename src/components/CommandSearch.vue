<script setup lang="ts">
import { editorCommandMetadata, useEditorCommands } from "@open-pencil/vue";
import { useEventListener } from "@vueuse/core";
import { computed, ref } from "vue";

import { useDialogUI } from "@/components/ui/dialog";

const { open } = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [boolean] }>();

const { commands } = useEditorCommands();
const dialog = useDialogUI({ content: "w-[min(560px,92vw)] overflow-hidden p-0" });
const query = ref("");
const selected = ref(0);
const editingShortcut = ref<string | null>(null);
const shortcutOverrides = ref<Record<string, string>>({});

const commandIds = Object.keys(commands) as Array<keyof typeof commands>;
const entries = computed(() =>
  commandIds
    .map((id) => commands[id])
    .filter((command) => {
      const needle = query.value.trim().toLowerCase();
      return !needle || command.label.toLowerCase().includes(needle) || command.id.includes(needle);
    }),
);

const active = computed(() => entries.value[selected.value] ?? null);

function close() {
  emit("update:open", false);
}

function runActive() {
  active.value?.run();
  close();
}

function shortcutFor(id: keyof typeof commands) {
  return shortcutOverrides.value[id] ?? editorCommandMetadata(id).shortcut ?? "";
}

function captureShortcut(event: KeyboardEvent, id: keyof typeof commands) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    editingShortcut.value = null;
    return;
  }
  const parts = [
    event.metaKey || event.ctrlKey ? "MOD" : "",
    event.altKey ? "ALT" : "",
    event.shiftKey ? "SHIFT" : "",
    event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase(),
  ].filter(Boolean);
  if (parts.length === 1 && ["MOD", "ALT", "SHIFT"].includes(parts[0])) return;
  shortcutOverrides.value[id] = parts.join("+");
  editingShortcut.value = null;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    close();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    selected.value = Math.min(selected.value + 1, entries.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    selected.value = Math.max(selected.value - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    runActive();
  }
}

function reset() {
  query.value = "";
  selected.value = 0;
  editingShortcut.value = null;
}

useEventListener(window, "keydown", onKeydown);
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[14vh]"
    data-test-id="command-search-overlay"
    @click.self="close"
  >
    <section :class="[dialog.content, 'rounded-lg border border-border bg-surface shadow-2xl']">
      <div class="border-b border-border p-3">
        <input
          v-model="query"
          autofocus
          data-test-id="command-search-input"
          class="w-full bg-transparent text-sm text-surface outline-none placeholder:text-muted"
          placeholder="Search commands"
          @input="selected = 0"
        />
      </div>
      <div class="max-h-[52vh] overflow-y-auto p-1">
        <div
          v-for="(command, index) in entries"
          :key="command.id"
          :data-test-id="`command-search-${command.id}`"
          class="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs"
          :class="index === selected ? 'bg-hover text-surface' : 'text-muted'"
          :aria-disabled="!command.enabled.value"
          role="option"
          tabindex="0"
          @mouseenter="selected = index"
          @click="command.enabled.value && (command.run(), close())"
        >
          <span class="min-w-0 flex-1 truncate">{{ command.label }}</span>
          <span
            v-if="editingShortcut === command.id"
            class="rounded border border-accent px-1.5 py-0.5 text-[10px] text-accent"
            tabindex="0"
            @keydown="captureShortcut($event, command.id)"
          >
            Press keys
          </span>
          <button
            v-else
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-active hover:text-surface"
            :data-test-id="`shortcut-edit-${command.id}`"
            @click.stop="editingShortcut = command.id"
          >
            {{ shortcutFor(command.id) || "Set shortcut" }}
          </button>
        </div>
        <p v-if="entries.length === 0" class="px-3 py-5 text-center text-xs text-muted">
          No commands found
        </p>
      </div>
      <div class="flex items-center justify-between border-t border-border px-3 py-2 text-[10px] text-muted">
        <span>Up/Down navigate - Enter run - Esc close</span>
        <button type="button" class="hover:text-surface" @click="reset">Reset</button>
      </div>
    </section>
  </div>
</template>
