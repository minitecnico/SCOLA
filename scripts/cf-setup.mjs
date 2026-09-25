// Configuração ÚNICA do Cloudflare: cria o banco D1 e o KV de anexos e grava os IDs no wrangler.jsonc.
// Antes: `npx wrangler login` (abre o navegador na sua conta Cloudflare).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const run = (...a) => execFileSync('npx', ['wrangler', ...a], { encoding: 'utf8' });
let cfg = readFileSync('wrangler.jsonc', 'utf8');

if (cfg.includes('"database_id": "PREENCHER')) {
  let id;
  try {
    const out = run('d1', 'create', 'scola');
    id = out.match(/"database_id":\s*"([^"]+)"/)?.[1] ?? out.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
  } catch {
    const list = JSON.parse(run('d1', 'list', '--json'));
    id = list.find((d) => d.name === 'scola')?.uuid;
  }
  if (!id) throw new Error('Não consegui obter o ID do banco D1. Veja `npx wrangler d1 list`.');
  cfg = cfg.replace(/"database_id": "PREENCHER[^"]*"/, `"database_id": "${id}"`);
  console.log('✔ Banco D1 "scola":', id);
}

if (cfg.includes('"id": "PREENCHER')) {
  let id;
  try {
    const out = run('kv', 'namespace', 'create', 'FILES');
    id = out.match(/"id":\s*"([^"]+)"/)?.[1] ?? out.match(/id\s*=\s*"([^"]+)"/)?.[1];
  } catch {
    const list = JSON.parse(run('kv', 'namespace', 'list'));
    id = list.find((n) => /FILES/.test(n.title))?.id;
  }
  if (!id) throw new Error('Não consegui obter o ID do KV. Veja `npx wrangler kv namespace list`.');
  cfg = cfg.replace(/"id": "PREENCHER[^"]*"/, `"id": "${id}"`);
  console.log('✔ KV de anexos:', id);
}

writeFileSync('wrangler.jsonc', cfg);
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'scola', '--remote'], { stdio: 'inherit' });
console.log('\nPronto. Faça commit do wrangler.jsonc e crie seu acesso: npm run admin -- seu@email.com "Seu Nome"');
