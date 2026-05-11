import { spawn } from 'node:child_process';

const processes = [
  spawn('npm', ['run', 'dev', '--workspace', 'server'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['run', 'dev', '--workspace', 'client'], { stdio: 'inherit', shell: true })
];

function shutdown(signal) {
  for (const child of processes) child.kill(signal);
  process.exit(signal === 'SIGINT' ? 0 : 1);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const child of processes) {
  child.on('exit', (code) => {
    if (code !== 0) shutdown('SIGTERM');
  });
}
