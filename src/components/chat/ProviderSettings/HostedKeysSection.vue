<script setup lang="ts">
import { useInputUI } from '@/components/ui/input'
import { useProviderSettingsContext } from '@/components/chat/ProviderSettings/context'

const ctx = useProviderSettingsContext()
</script>

<template>
  <div
    v-if="ctx.hostedSession.isSignedIn"
    class="flex flex-col gap-2 rounded border border-border/70 p-2"
  >
    <div class="flex items-center justify-between gap-2">
      <div>
        <div class="text-[10px] font-medium text-surface">Hosted account keys</div>
        <div class="text-[9px] text-muted">
          Save server-side keys for the managed `OpenPencil` provider.
        </div>
      </div>
      <span
        v-if="ctx.accountStatus?.user.isCh5Managed"
        class="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent"
      >
        CH5 managed
      </span>
    </div>

    <div v-if="ctx.accountStatusError" class="text-[9px] text-red-400">
      {{ ctx.accountStatusError }}
    </div>

    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between">
        <label class="text-[10px] text-muted">OpenRouter key</label>
        <button
          v-if="ctx.accountStatus?.saved.openrouter"
          class="cursor-pointer text-[10px] text-muted hover:text-surface"
          @click="void ctx.clearSavedAccountKey('openrouter')"
        >
          Clear
        </button>
      </div>
      <input
        v-model="ctx.openRouterAccountKeyInput"
        type="password"
        data-test-id="provider-settings-account-openrouter-key"
        :placeholder="
          ctx.accountStatus?.managed.openrouter
            ? 'CH5 managed key active — enter personal key to save too'
            : ctx.accountStatus?.saved.openrouter
              ? 'Key saved — enter new to replace'
              : 'sk-or-…'
        "
        :class="useInputUI({ size: 'sm' }).base"
        @change="void ctx.save()"
      />
    </div>

    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between">
        <label class="text-[10px] text-muted">Scenario key</label>
        <button
          v-if="ctx.accountStatus?.saved.scenario"
          class="cursor-pointer text-[10px] text-muted hover:text-surface"
          @click="void ctx.clearSavedAccountKey('scenario')"
        >
          Clear
        </button>
      </div>
      <input
        v-model="ctx.scenarioAccountKeyInput"
        type="password"
        data-test-id="provider-settings-account-scenario-key"
        :placeholder="
          ctx.accountStatus?.managed.scenario
            ? 'CH5 managed key active — enter personal key to save too'
            : ctx.accountStatus?.saved.scenario
              ? 'Key saved — enter new to replace'
              : 'Scenario key:secret'
        "
        :class="useInputUI({ size: 'sm' }).base"
        @change="void ctx.save()"
      />
    </div>

    <div class="text-[9px] text-muted">
      {{
        ctx.providerID === 'openpencil'
          ? 'The OpenPencil hosted provider uses these keys on the server. Browser storage is not used for this lane.'
          : 'These saved keys power the hosted OpenPencil provider. Direct provider mode still uses the local key field below.'
      }}
    </div>
    <div class="text-[9px] text-muted">
      Scenario credentials use `key:secret` unless the server provides the secret separately.
    </div>
  </div>
</template>
