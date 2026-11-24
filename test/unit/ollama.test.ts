import { createServer, RequestListener, Server } from 'http';
import { AddressInfo } from 'net';
import { ConfigType, OCO_AI_PROVIDER_ENUM } from '../../src/commands/config';
import { OllamaEngine } from '../../src/engine/ollama';
import { getEngine } from '../../src/utils/engine';
import { ProviderConnectionError } from '../../src/utils/errors';

describe('OllamaEngine', () => {
  it('sends think=false when configured', async () => {
    const engine = new OllamaEngine({
      apiKey: 'ollama',
      model: 'qwen3.5:2b',
      maxTokensOutput: 500,
      maxTokensInput: 4096,
      ollamaThink: false
    });

    const post = jest.fn().mockResolvedValue({
      data: {
        message: {
          content: 'feat: add support for ollama think config'
        }
      }
    });

    engine.client = { post } as any;

    await engine.generateCommitMessage([
      { role: 'user', content: 'diff --git a/file b/file' }
    ]);

    expect(post).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({
        think: false
      }),
      expect.anything()
    );
  });

  it('omits think when not configured', async () => {
    const engine = new OllamaEngine({
      apiKey: 'ollama',
      model: 'qwen3.5:2b',
      maxTokensOutput: 500,
      maxTokensInput: 4096
    });

    const post = jest.fn().mockResolvedValue({
      data: {
        message: {
          content: 'feat: add support for ollama think config'
        }
      }
    });

    engine.client = { post } as any;

    await engine.generateCommitMessage([
      { role: 'user', content: 'diff --git a/file b/file' }
    ]);

    expect(post).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.not.objectContaining({
        think: expect.anything()
      }),
      expect.anything()
    );
  });
});

describe('OllamaEngine connection failures', () => {
  const servers: Server[] = [];

  const listen = async (handler: RequestListener) => {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  const createEngine = (baseURL: string, ollamaTimeout?: number) =>
    new OllamaEngine({
      apiKey: 'ollama',
      model: 'qwen3.5:2b',
      maxTokensOutput: 500,
      maxTokensInput: 4096,
      baseURL,
      ollamaTimeout
    });

  const messages = [{ role: 'user' as const, content: 'diff --git a/f b/f' }];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('stops waiting for a server that never responds', async () => {
    const baseURL = await listen(() => {});

    const error = await createEngine(baseURL, 200)
      .generateCommitMessage(messages)
      .catch((e) => e);

    expect(error).toBeInstanceOf(ProviderConnectionError);
    expect(error.timedOut).toBe(true);
    expect(error.message).toContain(baseURL);
  });

  it('applies OCO_OLLAMA_TIMEOUT from the config', async () => {
    const baseURL = await listen(() => {});
    const engine = getEngine({
      OCO_AI_PROVIDER: OCO_AI_PROVIDER_ENUM.OLLAMA,
      OCO_MODEL: 'qwen3.5:2b',
      OCO_API_URL: baseURL,
      OCO_OLLAMA_TIMEOUT: 200
    } as ConfigType);

    const error = await engine.generateCommitMessage(messages).catch((e) => e);

    expect(error).toBeInstanceOf(ProviderConnectionError);
    expect(error.message).toContain('200 ms');
  });

  it('reports the base URL when the connection is refused', async () => {
    const baseURL = await listen(() => {});
    const server = servers.pop()!;
    await new Promise((resolve) => server.close(resolve));

    const error = await createEngine(baseURL)
      .generateCommitMessage(messages)
      .catch((e) => e);

    expect(error).toBeInstanceOf(ProviderConnectionError);
    expect(error.timedOut).toBe(false);
    expect(error.message).toContain(baseURL);
  });

  it('still returns the commit message from a responsive server', async () => {
    const baseURL = await listen((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: { content: 'fix: respond in time' } }));
    });

    await expect(
      createEngine(baseURL, 1000).generateCommitMessage(messages)
    ).resolves.toBe('fix: respond in time');
  });
});
