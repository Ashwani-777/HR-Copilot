import { config } from '../config.js';
import type { ChatProvider } from './types.js';
import { MockChatProvider } from './mock-chat.js';
import { OpenAIChatProvider } from './openai-chat.js';
import { AnthropicChatProvider } from './anthropic-chat.js';

export { getEmbeddingProvider } from './embeddings.js';

let chat: ChatProvider | null = null;

export function getChatProvider(): ChatProvider {
  if (!chat) {
    switch (config.LLM_PROVIDER) {
      case 'openai':
        chat = new OpenAIChatProvider();
        break;
      case 'anthropic':
        chat = new AnthropicChatProvider();
        break;
      default:
        chat = new MockChatProvider();
    }
  }
  return chat;
}

/** Test hook */
export function setChatProvider(provider: ChatProvider | null): void {
  chat = provider;
}
