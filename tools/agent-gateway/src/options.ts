import { AGENT_OPTIONS_SCHEMA } from '@open-pencil/agent-contracts'
import type {
  AgentOptionCatalog,
  AgentOptionCatalogEntry,
  AgentOptionSelection
} from '@open-pencil/agent-contracts'

export const AGENT_OPTION_CATALOG: AgentOptionCatalog = {
  schema: AGENT_OPTIONS_SCHEMA,
  options: [
    {
      optionId: 'agent-native-auto',
      label: 'Auto',
      group: 'Agent Native',
      description: 'Use the centrally managed default model.',
      capabilities: ['tools', 'vision'],
      efforts: []
    },
    {
      optionId: 'agent-native-gpt-5-6-luna',
      label: 'GPT-5.6 Luna',
      group: 'OpenAI',
      description: 'Fast Agent Native model for everyday work.',
      capabilities: ['tools', 'vision'],
      efforts: ['low', 'medium', 'high', 'xhigh'],
      default: true
    },
    {
      optionId: 'agent-native-gpt-5-6-terra',
      label: 'GPT-5.6 Terra',
      group: 'OpenAI',
      description: 'Higher-capability Agent Native model for complex work.',
      capabilities: ['tools', 'vision'],
      efforts: ['low', 'medium', 'high', 'xhigh']
    },
    {
      optionId: 'agent-native-gpt-5-6-sol',
      label: 'GPT-5.6 Sol',
      group: 'OpenAI',
      description: 'Highest-capability Agent Native OpenAI model.',
      capabilities: ['tools', 'vision'],
      efforts: ['low', 'medium', 'high', 'xhigh']
    },
    {
      optionId: 'agent-native-claude-haiku-4-5',
      label: 'Claude Haiku 4.5',
      group: 'Claude',
      description: 'Fast Claude model available in Agent Native.',
      capabilities: ['tools', 'vision'],
      efforts: ['low', 'medium', 'high', 'max']
    },
    {
      optionId: 'agent-native-claude-sonnet-5',
      label: 'Claude Sonnet 5',
      group: 'Claude',
      description: 'Balanced Claude model available in Agent Native.',
      capabilities: ['tools', 'vision'],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max']
    },
    {
      optionId: 'agent-native-claude-opus-4-8',
      label: 'Claude Opus 4.8',
      group: 'Claude',
      description: 'Highest-capability Claude model available in Agent Native.',
      capabilities: ['tools', 'vision'],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max']
    },
    {
      optionId: 'agent-native-gemini-3-5-flash',
      label: 'Gemini 3.5 Flash',
      group: 'Gemini',
      description: 'Fast Gemini model available in Agent Native.',
      capabilities: ['tools', 'vision'],
      efforts: ['low', 'medium', 'high']
    },
    {
      optionId: 'agent-native-gemini-3-1-pro',
      label: 'Gemini 3.1 Pro',
      group: 'Gemini',
      description: 'Higher-capability Gemini model available in Agent Native.',
      capabilities: ['tools', 'vision'],
      efforts: ['low', 'medium', 'high']
    }
  ]
}

export function findAgentOption(
  selection: AgentOptionSelection
): AgentOptionCatalogEntry | undefined {
  return AGENT_OPTION_CATALOG.options.find((option) => option.optionId === selection.optionId)
}

export function selectionError(selection: AgentOptionSelection | undefined): string | undefined {
  if (!selection) return undefined
  const option = findAgentOption(selection)
  if (!option) return `Unknown agent option: ${selection.optionId}.`
  if (selection.effort && !option.efforts.includes(selection.effort)) {
    return `Unknown effort ${selection.effort} for agent option ${selection.optionId}.`
  }
}
