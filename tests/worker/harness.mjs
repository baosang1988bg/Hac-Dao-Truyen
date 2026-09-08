import { readFile } from 'node:fs/promises';

// Fresh module isolates the Worker's module-scoped rate limiter per test.
export async function loadWorker() {
  const source = await readFile(new URL('../../src/index.js', import.meta.url), 'utf8');
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`)).default;
}
