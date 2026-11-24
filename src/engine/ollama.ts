import axios, { AxiosInstance } from 'axios';
import { OpenAI } from 'openai';
import { normalizeEngineError } from '../utils/engineErrorHandler';
import { ProviderConnectionError } from '../utils/errors';
import { removeContentTags } from '../utils/removeContentTags';
import { AiEngine, AiEngineConfig } from './Engine';

interface OllamaConfig extends AiEngineConfig {
  ollamaThink?: boolean;
  ollamaTimeout?: number;
}

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_CHAT_PATH = '/api/chat';
const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT'
]);

export class OllamaEngine implements AiEngine {
  config: OllamaConfig;
  client: AxiosInstance;
  private baseUrl: string;
  private chatUrl: string;
  private timeoutMs: number;

  constructor(config) {
    this.config = config;

    this.baseUrl = config.baseURL || DEFAULT_OLLAMA_URL;
    this.chatUrl = `${this.baseUrl}${OLLAMA_CHAT_PATH}`;
    this.timeoutMs = config.ollamaTimeout ?? DEFAULT_OLLAMA_TIMEOUT_MS;

    // Combine base headers with custom headers
    const headers = {
      'Content-Type': 'application/json',
      ...config.customHeaders
    };

    this.client = axios.create({ headers });
  }

  async generateCommitMessage(
    messages: Array<OpenAI.Chat.Completions.ChatCompletionMessageParam>
  ): Promise<string | undefined> {
    const params: Record<string, any> = {
      model: this.config.model ?? 'mistral',
      messages,
      options: { temperature: 0, top_p: 0.1 },
      stream: false
    };
    if (typeof this.config.ollamaThink === 'boolean') {
      params.think = this.config.ollamaThink;
    }
    try {
      // The signal bounds the whole request, including the TCP connect phase.
      const response = await this.client.post(this.chatUrl, params, {
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      const { message } = response.data;
      let content = message?.content;
      return removeContentTags(content, 'think');
    } catch (error) {
      throw (
        this.toConnectionError(error) ??
        normalizeEngineError(error, 'ollama', this.config.model)
      );
    }
  }

  private toConnectionError(error: unknown): ProviderConnectionError | null {
    if (axios.isCancel(error)) {
      return new ProviderConnectionError(
        'ollama',
        this.baseUrl,
        true,
        `Ollama at ${this.baseUrl} did not respond within ${this.timeoutMs} ms.`,
        'Check that Ollama is running and reachable at this address. For slow models, increase OCO_OLLAMA_TIMEOUT (milliseconds).'
      );
    }

    const code = axios.isAxiosError(error) ? error.code : undefined;
    if (code && CONNECTION_ERROR_CODES.has(code)) {
      return new ProviderConnectionError(
        'ollama',
        this.baseUrl,
        false,
        `Could not connect to Ollama at ${this.baseUrl} (${code}).`,
        'Check that Ollama is running, and that OCO_API_URL points to it.'
      );
    }

    return null;
  }
}
