# SCOLA — Sistema de Gestão Escolar

Chamadas, notas por trimestre, Central de Avaliações, boletins/relatórios, planejamento, avisos e calendário.
Multi-escola: **você (administrador) cria as bases**; cada base é uma escola ou um professor autônomo.

## Quem faz o quê

| Papel | Onde | O que faz |
|---|---|---|
| **Administrador** (você) | Painel do administrador | Cria bases, define plano e limite de alunos, suspende/reativa, gera senhas, entra em qualquer base em modo suporte |
| **Gestão / Coordenação** | Dentro da base | Tudo da base: equipe, cadastros, notas, revisão de planejamentos, avisos |
| **Professor(a)** | Dentro da base | Chamadas, notas, avaliações, planejamento, relatórios |
| **Secretaria** | Dentro da base | Turmas, alunos, relatórios, avisos, calendário |

Não existe autocadastro. Você cria a base e o gestor; o gestor cria a equipe em **Equipe**. Toda conta nova recebe uma
senha provisória (mostrada uma vez, com botão de enviar pelo WhatsApp) e troca no primeiro acesso.
Um professor que trabalha em duas escolas usa o mesmo login nas duas e alterna pelo menu.

## Arquitetura (100% plano gratuito)

- **GitHub**: código + deploy automático (GitHub Actions) a cada push na `main`.
- **Cloudflare Workers**: um único Worker serve o site (React) e a API (`/api/*`).
- **Cloudflare D1**: banco de dados (SQLite). **Cloudflare KV**: anexos (até 20 MB por arquivo).
- Login próprio (e-mail + senha, cookie seguro de 30 dias). Nenhum outro serviço.

## Colocar no ar (uma vez só)

Pré-requisitos: Node 20+, uma conta gratuita no [Cloudflare](https://dash.cloudflare.com) e uma no GitHub.

```bash
npm install
npx wrangler login              # abre o navegador na sua conta Cloudflare
npm run cf:setup                # cria o banco D1 e o KV e grava os IDs no wrangler.jsonc
npm run deploy                  # primeira publicação
npm run admin -- seu@email.com "Seu Nome"   # cria o SEU acesso de administrador (mostra a senha)
```

O endereço aparece no final do deploy (ex.: `https://scola.SEU-USUARIO.workers.dev`).
Domínio próprio: Cloudflare → Workers → scola → Settings → Domains & Routes.

### Deploy automático pelo GitHub

1. Crie um repositório (privado) e envie o código:
   ```bash
   git init && git add . && git commit -m "SCOLA" && git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/scola.git && git push -u origin main
   ```
2. No Cloudflare: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"**, adicione a permissão
   **Account · D1 · Edit** e crie.
3. No GitHub: **Settings → Secrets and variables → Actions** e cadastre:
   - `CLOUDFLARE_API_TOKEN` — o token do passo 2
   - `CLOUDFLARE_ACCOUNT_ID` — o Account ID (barra lateral do painel Cloudflare)

Pronto: todo `git push` na `main` aplica as migrações do banco e publica.

## Trazer os professores que já usam o sistema antigo (Supabase)

O script só **lê** o Supabase. Mantém escolas, turmas, alunos, chamadas, notas, avaliações, avisos, calendários,
planejamentos, anexos — e **os professores continuam entrando com o mesmo e-mail e senha**.

```bash
export SUPABASE_DB_URL="postgresql://postgres.xxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
export SUPABASE_URL="https://xxxx.supabase.co"          # opcional: para copiar os anexos
export SUPABASE_SERVICE_KEY="eyJ..."                    # opcional: service_role (Settings → API)

npm run migrar                 # simula: mostra o resumo e avisos, não grava nada
npm run migrar -- --aplicar    # grava no Cloudflare
```

- `SUPABASE_DB_URL`: Supabase → Project Settings → Database → Connection string (Session pooler).
- Rode **uma vez**, logo depois do `cf:setup`, antes de os professores começarem a usar a versão nova.
- A pasta `migracao/` gerada contém dados pessoais: não a envie ao GitHub (já está no `.gitignore`).
- Quem entrava só pelo Google não tinha senha: o script avisa, e você gera a senha em **Equipe**.

## Provas e correção pela câmera

Menu **Provas e correção** (gestão e professores):

1. **Gabarito:** cria a prova (turma, nº de questões até 60, alternativas A–D ou A–E, valor) e marca a resposta certa. "Anular" conta a questão como certa para todos.
2. **Folhas:** imprime uma folha de respostas por aluno, com o nome e um QR code (`S1:<código da prova>:<aluno>`). Também há folhas avulsas.
3. **Corrigir:** a câmera do celular lê o QR (identifica prova e aluno), acha as 4 marcas dos cantos, corrige a perspectiva e lê as bolinhas. O professor confere e salva.
4. **Resultados:** notas, acerto por questão (com aviso de possível erro no gabarito), Excel e **Lançar no diário**, que grava a nota proporcional ao valor da coluna escolhida em Notas, sem mexer nas outras colunas.

Tudo roda no aparelho (sem custo de servidor). A câmera ao vivo exige HTTPS; no computador de desenvolvimento acessado pelo IP da rede, use "Usar foto".
Código: `src/lib/omr/` (geometria da folha, leitura e nota), `src/components/ExamScanner.tsx`, `worker/handlers/provas.ts`.

## App no celular (PWA)

O SCOLA instala como aplicativo, sem loja:
- **Android/Chrome:** aparece o convite "Instale o SCOLA no celular" (ou menu do usuário → Instalar app).
- **iPhone/iPad (Safari):** Compartilhar → Adicionar à Tela de Início (o app mostra o passo a passo).

Abre em tela cheia, funciona com internet fraca (a interface fica guardada no aparelho) e tem atalhos ao segurar o ícone: Fazer chamada, Lançar notas e Corrigir provas. Quando sai versão nova, o app **pergunta** antes de atualizar, para não interromper uma chamada. Excel, PDF e ZIP não entram no download inicial (baixam só quando usados). Configuração em `vite.config.ts` e `public/_headers`; avisos em `src/components/PwaPrompts.tsx`.

## Rodar no computador (desenvolvimento)

```bash
npm run db:local                                   # cria o banco local
npm run admin -- admin@teste.com "Admin" teste123 --local
npm run dev                                        # http://localhost:5173 (API em :8787)
```

## Limites do plano gratuito

| Recurso | Limite grátis | Na prática |
|---|---|---|
| Requisições (Workers) | 100 mil/dia | ~100 escolas pequenas usando o dia todo |
| Banco D1 | 5 GB (500 MB por banco), 5 mi leituras/dia | Dezenas de escolas por anos |
| Anexos (KV) | 1 GB, 1.000 gravações/dia | Avisos e planejamentos com arquivos |

Quando crescer, o plano pago do Workers (US$ 5/mês) multiplica todos esses limites sem mudar nada no código.

## Estrutura do código

```
worker/                API (Cloudflare Worker)
  index.ts             rotas: login, /api/rpc/:operação, arquivos, rotina diária
  auth.ts              senhas (PBKDF2; aceita bcrypt migrado), sessões, papéis
  handlers/            regras de negócio por área (cadastros, chamadas, notas, comunicação, contas)
migrations/            esquema do banco D1 (aplicado automaticamente no deploy)
src/                   site (React + Vite + Tailwind)
  lib/queries.ts       todas as chamadas à API (mesmo nome das operações do worker)
  lib/types.ts         tipos e regras de cálculo (média, crédito variável, recuperação)
  pages/               uma tela por arquivo; pages/admin = painel do administrador
scripts/               cf-setup, criar-admin, migrar-supabase
```

Regras de notas (inalteradas): 3 trimestres; atividades de valor 10 contam como uma nota cada, as menores somam
como uma nota; média = soma ÷ 3; recuperação substitui a menor nota se melhorar a média; aprovação com 6.
