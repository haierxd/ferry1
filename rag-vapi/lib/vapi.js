import OpenAI from 'openai';
import { createEmbedder } from './embeddings.js';
import { AppError } from './errors.js';
export function createVapi(config) {
  // Always explicit: never fall back to OPENAI_API_KEY / OpenAI's default endpoint.
  return new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey,
    timeout: config.timeoutMs, maxRetries: 2 });
}

// Explicit dependencies; these functions never create a second SDK instance.
export async function embedText(text, { sdk, config, signal } = {}) {
  return (await createEmbedder(sdk, config)([text], { signal }))[0];
}

export function chat(messages, { sdk, config, stream = false, signal } = {}) {
  if (!config?.chatModel || config.chatModel === config.embeddingModel || /embedding/i.test(config.chatModel)) {
    throw new AppError('CONFIG_ERROR', 'VAPI_CHAT_MODEL 必须是独立的聊天模型，不能使用嵌入模型');
  }
  return sdk.chat.completions.create({ model: config.chatModel, messages,
    stream, max_tokens: 1500 }, { signal });
}

// Exactly one SDK per running agent. A receives no chat capability or raw SDK.
export function createAgentVapi(config, { role = 'ask', sdk } = {}) {
  if (!['ingest', 'ask'].includes(role)) throw new AppError('CONFIG_ERROR', '未知智能体角色');
  const client = sdk ?? createVapi(config);
  const embed = createEmbedder(client, config);
  return Object.freeze({ embedTexts: embed,
    embedText: (text, options = {}) => embedText(text, { ...options, sdk: client, config }),
    ...(role === 'ask' ? { chat: (messages, options = {}) => chat(messages, { ...options, sdk: client, config }) } : {}) });
}
