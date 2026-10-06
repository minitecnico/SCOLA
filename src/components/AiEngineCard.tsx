import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Cpu, Loader2, Pencil, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { ia, type EngineHealth, type EngineInfo, type EngineMode } from '../lib/ia';
import { Button, Card, Field, Input, Modal } from './ui';

/**
 * Motor de IA (só o administrador). Vários motores compatíveis com a API da OpenAI (OpenRouter, OpenAI,
 * 9Router…) mais os modelos da NVIDIA de reserva. O sistema mede cada um (acertos, velocidade, falhas),
 * escolhe o melhor para cada pedido e troca sozinho quando algum cai. Chaves ficam cifradas no servidor.
 */
const PRESETS = [
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', hint: 'Chave começa com sk-or-v1-… (openrouter.ai/keys). "openrouter/auto" escolhe o melhor modelo para cada pergunta; "openrouter/free" usa só modelos grátis.' },
  { label: '9Router (servidor público)', baseUrl: 'https://', model: 'auto', hint: 'O 9Router precisa estar num servidor com endereço https público (VPS ou túnel). "localhost" não funciona: o SCOLA roda na nuvem.' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: 'Chave começa com sk-… (platform.openai.com).' },
  { label: 'Outro', baseUrl: 'https://', model: '', hint: 'Qualquer serviço compatível com a API da OpenAI (/v1/chat/completions).' },
];
const MODES: { value: EngineMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Inteligente', hint: 'Pedidos curtos vão para modelos rápidos e os difíceis para os mais fortes. Quem falha ou fica lento desce na fila.' },
  { value: 'rapido', label: 'Mais rápido', hint: 'Sempre tenta primeiro o motor que está respondendo mais depressa.' },
  { value: 'prioridade', label: 'Ordem fixa', hint: 'Segue exatamente a ordem da lista; só pula quem está fora do ar.' },
];
const TASK = { texto: 'Texto', visao: 'Imagens (leitura)', imagem: 'Imagens (criação)' } as const;

type Form = { id?: string; baseUrl: string; key: string; model: string; label: string };
const EMPTY: Form = { baseUrl: PRESETS[0].baseUrl, key: '', model: PRESETS[0].model, label: '' };

const ago = (iso: string | null) => {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.floor(m / 60)} h` : `há ${Math.floor(m / 1440)} d`;
};

/** Verde-escuro/cinza/vermelho: estado de saúde pelo histórico recente. */
function health(h: EngineHealth, enabled: boolean) {
  if (!enabled) return { label: 'Desligado', dot: 'bg-neutral-300' };
  if (h.restingUntil) return { label: `Em descanso (${Math.max(1, Math.ceil((h.restingUntil - Date.now()) / 60000))} min)`, dot: 'bg-red-600' };
  if (!h.calls) return { label: 'Sem uso ainda', dot: 'bg-neutral-400' };
  if (h.streak > 0 || (h.successRate ?? 100) < 80) return { label: 'Instável', dot: 'bg-orange-500' };
  return { label: 'Saudável', dot: 'bg-green-600' };
}

export function AiEngineCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['ai-engine'], queryFn: ia.engine, refetchInterval: 30_000 });
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Form | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-engine'] });
    qc.invalidateQueries({ queryKey: ['ai-status'] });
  };
  const config = useMutation({ mutationFn: ia.setConfig, onSuccess: refresh });
  const test = useMutation({ mutationFn: ia.testEngine, onSettled: refresh });
  const remove = useMutation({ mutationFn: (id: string) => ia.clearEngine(id), onSuccess: refresh });
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!data) return <Card><p className="text-sm text-muted-foreground">Carregando o motor de IA…</p></Card>;

  const active = data.engines.filter((e) => e.enabled);
  const models = data.models.filter((m) => m.enabled);
  const all = [...data.engines, ...data.models];
  const bad = all.filter((e) => e.enabled && (e.restingUntil || e.streak > 0)).length;
  const status = !active.length && !models.length ? { label: 'Sem motor ativo', cls: 'bg-red-50 text-red-700' } : bad ? { label: `${bad} com problema`, cls: 'bg-neutral-200 text-neutral-900' } : { label: 'Tudo funcionando', cls: 'bg-neutral-900 text-white' };
  const mode = MODES.find((m) => m.value === data.mode)!;

  async function runTest(id: string) {
    setTesting(id);
    setResult(null);
    const label = all.find((e) => e.id === id)?.label ?? 'Motor';
    try {
      const r = await test.mutateAsync(id);
      setResult(r.ok ? { ok: true, text: `${label}: funcionando (${(r.ms / 1000).toFixed(1)} s).` } : { ok: false, text: `${label}: falhou — ${r.error ?? 'sem detalhe'}` });
    } catch (e) {
      setResult({ ok: false, text: `${label}: ${(e as Error).message}` });
    } finally {
      setTesting(null);
    }
  }
  function move(id: string, dir: -1 | 1) {
    const ids = data!.engines.map((e) => e.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    config.mutate({ order: ids });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-neutral-900 text-brand"><Cpu size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold">Motor de IA</p>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', status.cls)}>{status.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {active.length ? `${active.length} motor(es) externo(s)` : 'Nenhum motor externo'}
            {data.nvidia ? ` · NVIDIA com ${models.length} modelos de reserva` : ' · sem reserva NVIDIA'}. Modo: <b>{mode.label}</b>.
          </p>
        </div>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Fechar' : 'Gerenciar'}</Button>
        <Button onClick={() => setEdit({ ...EMPTY })}><Plus size={16} /> Conectar motor</Button>
      </div>

      {open ? (
        <div className="mt-5 space-y-5 border-t border-border pt-5">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Como o SCOLA escolhe o motor</p>
            <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
              {MODES.map((m) => (
                <button key={m.value} onClick={() => config.mutate({ mode: m.value })} className={cn('rounded-md px-3 py-1.5 text-sm font-semibold transition', data.mode === m.value ? 'bg-neutral-900 text-white' : 'text-muted-foreground hover:text-foreground')}>
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{mode.hint}</p>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Seus motores (do primeiro ao último)</p>
            {data.engines.length === 0 ? (
              <p className="rounded-lg bg-muted px-3 py-4 text-sm text-muted-foreground">Nenhum motor externo. A IA usa os modelos da NVIDIA. Conecte um OpenRouter ou OpenAI para respostas mais fortes.</p>
            ) : (
              <ul className="space-y-2">
                {data.engines.map((e, i) => (
                  <Row key={e.id} h={e} enabled={e.enabled} title={e.label} sub={`${e.model} · ${e.baseUrl} · chave ${e.keyHint}`} testing={testing === e.id}
                    onToggle={(v) => config.mutate({ enabled: { [e.id]: v } })} onTest={() => void runTest(e.id)}>
                    <button disabled={i === 0} onClick={() => move(e.id, -1)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted disabled:opacity-30" aria-label="Subir"><ArrowUp size={15} /></button>
                    <button disabled={i === data.engines.length - 1} onClick={() => move(e.id, 1)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted disabled:opacity-30" aria-label="Descer"><ArrowDown size={15} /></button>
                    <button onClick={() => setEdit({ id: e.id, baseUrl: e.baseUrl, key: '', model: e.model, label: e.label })} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted" aria-label="Editar"><Pencil size={15} /></button>
                    <button onClick={() => confirm(`Remover "${e.label}"?`) && remove.mutate(e.id)} className="grid h-8 w-8 place-items-center rounded-md text-red-600 hover:bg-red-50" aria-label="Remover"><Trash2 size={15} /></button>
                  </Row>
                ))}
              </ul>
            )}
          </div>

          {data.nvidia ? <Nvidia data={data} testing={testing} onToggle={(id, v) => config.mutate({ enabled: { [id]: v } })} onTest={(id) => void runTest(id)} /> : null}
          {result ? <p role="status" className={cn('rounded-lg px-3 py-2 text-sm font-medium', result.ok ? 'bg-neutral-100 text-neutral-900' : 'bg-red-50 text-red-700')}>{result.text}</p> : null}
          <p className="text-[11px] text-muted-foreground">Cada chamada alimenta a saúde dos motores. Quem falha várias vezes descansa (2 min, depois 4, 8… até 1 hora) e volta sozinho. O botão de teste faz uma pergunta curta ao motor (nos de imagem, desenha uma figura pequena).</p>
        </div>
      ) : null}

      {edit ? <EngineModal initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} /> : null}
    </Card>
  );
}

function Row({ h, enabled, title, sub, testing, onToggle, onTest, children }: { h: EngineHealth; enabled: boolean; title: string; sub: string; testing: boolean; onToggle: (v: boolean) => void; onTest: () => void; children?: React.ReactNode }) {
  const st = health(h, enabled);
  return (
    <li className={cn('rounded-lg border border-border px-3 py-2.5', !enabled && 'bg-muted/50')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', st.dot)} title={st.label} />
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-semibold">{title} <span className="text-xs font-normal text-muted-foreground">· {st.label}</span></p>
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        </div>
        <div className="flex items-center gap-4 text-xs tabular-nums text-muted-foreground">
          <span title="Taxa de sucesso">{h.successRate != null ? `${h.successRate}%` : '—'} <span className="hidden sm:inline">acertos</span></span>
          <span title="Velocidade média para começar a responder">{h.avgMs != null ? `${(h.avgMs / 1000).toFixed(1)} s` : '—'}</span>
          <span title="Chamadas registradas">{h.calls} <span className="hidden sm:inline">chamadas</span></span>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={onTest} disabled={testing} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted" aria-label="Testar" title="Testar agora">
            {testing ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
          </button>
          {children}
          <label className="ml-1 inline-flex cursor-pointer items-center" title={enabled ? 'Desligar' : 'Ligar'}>
            <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="peer sr-only" />
            <span className="relative h-5 w-9 rounded-full bg-neutral-300 transition peer-checked:bg-neutral-900 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
          </label>
        </div>
      </div>
      {h.lastError && (h.streak > 0 || h.restingUntil) ? <p className="mt-1.5 truncate pl-5 text-[11px] text-red-600" title={h.lastError}>Último erro {ago(h.lastFailAt)}: {h.lastError}</p> : null}
    </li>
  );
}

function Nvidia({ data, testing, onToggle, onTest }: { data: EngineInfo; testing: string | null; onToggle: (id: string, v: boolean) => void; onTest: (id: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Reserva NVIDIA (entra sozinha quando o principal falha)</p>
      {(['texto', 'visao', 'imagem'] as const).map((task) => (
        <div key={task} className="mb-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><RefreshCw size={11} /> {TASK[task]}</p>
          <ul className="space-y-2">
            {data.models.filter((m) => m.task === task).map((m) => (
              <Row key={`${task}-${m.id}`} h={m} enabled={m.enabled} title={m.label} sub={m.id} testing={testing === m.id} onToggle={(v) => onToggle(m.id, v)} onTest={() => onTest(m.id)} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EngineModal({ initial, onClose, onSaved }: { initial: Form; onClose: () => void; onSaved: () => void }) {
  const [preset, setPreset] = useState(initial.id ? -1 : 0);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editing = !!initial.id;

  async function save() {
    setBusy(true);
    setError('');
    try {
      await ia.setEngine(form);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? 'Editar motor de IA' : 'Conectar motor de IA'}>
      <div className="space-y-3">
        {!editing ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p, i) => (
                <button key={p.label} onClick={() => { setPreset(i); setForm((f) => ({ ...f, baseUrl: p.baseUrl, model: p.model })); }} className={cn('rounded-full px-3 py-1 text-xs font-semibold', preset === i ? 'bg-neutral-900 text-white' : 'bg-muted')}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{PRESETS[preset].hint}</p>
          </>
        ) : null}
        <Field label="Endereço da API"><Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://…/v1" /></Field>
        <Field label={editing ? 'Chave da API (deixe em branco para manter)' : 'Chave da API'}><Input type="password" autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="Cole a chave aqui (fica cifrada no servidor)" /></Field>
        <Field label="Modelo"><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="ex.: openrouter/auto" /></Field>
        <Field label="Nome que aparece para os professores (opcional)"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ex.: IA SCOLA" /></Field>
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
        <Button onClick={() => void save()} disabled={busy || (!editing && !form.key.trim())} className="w-full">
          {busy ? <><Loader2 size={16} className="animate-spin" /> Testando a conexão…</> : 'Testar e salvar'}
        </Button>
        <p className="text-[11px] text-muted-foreground">O SCOLA faz uma pergunta de teste antes de salvar. Você pode conectar vários motores: se um cair, o próximo assume.</p>
      </div>
    </Modal>
  );
}
