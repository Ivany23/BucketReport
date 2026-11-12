// Cria um utilizador administrador.
// Uso: npm run criar-admin -- email@empresa.co.mz "Nome Apelido"      (pede a palavra-passe; ou ADMIN_SENHA no .env)
import { createInterface } from 'node:readline/promises';
import { ligarDaConfig } from '../server/ligar.js';
import { criarUtilizador } from '../server/auth.js';

const [email, nome, papel = 'admin'] = process.argv.slice(2);
if (!email || !nome) { console.error('Uso: npm run criar-admin -- email "Nome" [admin|leitor]'); process.exit(1); }
let senha = process.env.ADMIN_SENHA;
if (!senha) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  senha = await rl.question('Palavra-passe (mínimo 10 caracteres): ');
  rl.close();
}
const db = await ligarDaConfig();
try {
  const u = await criarUtilizador(db, { email, nome, papel, senha });
  console.log(`OK: ${u.nome} <${u.email}> (${u.papel})`);
} catch (e) {
  console.error('Erro:', e.message);
  process.exitCode = 1;
} finally {
  await db.fechar();
}
