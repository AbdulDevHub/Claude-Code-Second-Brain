// Opens index.html in the default browser (Windows, macOS or Linux).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const page = fileURLToPath(new URL('../index.html', import.meta.url));
const [cmd, args] = {
  win32: ['cmd', ['/c', 'start', '', page]],
  darwin: ['open', [page]],
}[process.platform] ?? ['xdg-open', [page]];

spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
console.log(`Opened ${page}`);
