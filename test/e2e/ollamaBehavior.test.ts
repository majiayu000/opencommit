import 'cli-testing-library/extend-expect';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import {
  getShortGitStatus,
  prepareEnvironment,
  prepareRepo,
  runCli,
  waitForExit
} from './utils';

it('built CLI exits with the Ollama URL when Ollama never responds', async () => {
  const { tempDir, gitDir, cleanup } = await prepareEnvironment({
    remotes: 0
  });
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await prepareRepo(
      gitDir,
      { 'index.ts': 'console.log("Hello World");\n' },
      { stage: true }
    );

    const oco = await runCli(['--yes'], {
      cwd: gitDir,
      env: {
        HOME: tempDir,
        OCO_AI_PROVIDER: 'ollama',
        OCO_MODEL: 'llama3',
        OCO_API_URL: baseUrl,
        OCO_OLLAMA_TIMEOUT: '500',
        OCO_GITPUSH: 'false'
      }
    });

    expect(await oco.findByText(baseUrl)).toBeInTheConsole();
    expect(await waitForExit(oco)).toBe(1);
    expect(await getShortGitStatus(gitDir)).toBe('A  index.ts');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await cleanup();
  }
});
