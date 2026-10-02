import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { aiEngineInfo, clearAiEngine, setAiEngine } from '../lib/queries';
import { Button, Field, Input, Modal } from './ui';

/**
 * Motor de IA (só o administrador): conecta qualquer API compatível com OpenAI (OpenRouter,
 * um 9Router publicado num servidor, OpenAI…). A chave fica cifrada no servidor e nunca volta para a tela.
 */
const PRESETS = [
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', hint: 'Chave começa com sk-or-v1-… (openrouter.ai/keys). "openrouter/auto" escolhe o melhor modelo para cada pergunta; "openrouter/free" usa só modelos grátis.' },
  { label: '9Router (servidor público)', baseUrl: 'https://', model: 'auto', hint: 'O 9Router precisa estar num servidor com endereço https público (VPS ou túnel). "localhost" não funciona: o SCOLA roda na nuvem.' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: 'Chave começa com sk-… (platform.openai.com).' },
  { label: 'Outro', baseUrl: 'https://', model: '', hint: 'Qualquer serviço compatível com a API da OpenAI (/v1/chat/completions).' },
];

export function AiEngineCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['ai-engine'], queryFn: aiEngineInfo });
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(0);
  const [form, setForm] = useState({ baseUrl: PRESETS[0].baseUrl, key: '', model: PRESETS[0].model, label: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-engine'] });
    qc.invalidateQueries({ queryKey: ['ai-status'] });
  };

  async function save() {
    setBusy(true);
    setError('');
    try {
      await setAiEngine(form);
      setOpen(false);
      setForm((f) => ({ ...f, key: '' }));
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-neutral-900 text-brand"><Cpu size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Motor de IA</p>
        <p className="text-xs text-muted-foreground">
          {data?.custom ? <>Principal: <b>{data.custom.label}</b> ({data.custom.baseUrl}, chave {data.custom.keyHint}). </> : 'Principal: nenhum motor externo. '}
          {data?.nvidia ? 'Reserva: NVIDIA (troca sozinha se o principal falhar).' : 'Sem reserva NVIDIA.'}
        </p>
      </div>
      {data?.custom ? (
        <Button variant="ghost" onClick={async () => { if (confirm('Desconectar o motor externo? A IA volta a usar só a NVIDIA.')) { await clearAiEngine(); refresh(); } }}>
          Desconectar
        </Button>
      ) : null}
      <Button onClick={() => setOpen(true)}>{data?.custom ? 'Trocar motor' : 'Conectar motor'}</Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Conectar motor de IA">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                onClick={() => { setPreset(i); setForm((f) => ({ ...f, baseUrl: p.baseUrl, model: p.model })); }}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${preset === i ? 'bg-neutral-900 text-brand' : 'bg-muted'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{PRESETS[preset].hint}</p>
          <Field label="Endereço da API"><Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://…/v1" /></Field>
          <Field label="Chave da API"><Input type="password" autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="Cole a chave aqui (fica cifrada no servidor)" /></Field>
          <Field label="Modelo"><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="ex.: openrouter/auto" /></Field>
          <Field label="Nome que aparece para os professores (opcional)"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ex.: IA SCOLA" /></Field>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
          <Button onClick={() => void save()} disabled={busy || !form.key.trim()} className="w-full">
            {busy ? <><Loader2 size={16} className="animate-spin" /> Testando a conexão…</> : 'Testar e salvar'}
          </Button>
          <p className="text-[11px] text-muted-foreground">O SCOLA faz uma pergunta de teste antes de salvar. Se o motor cair depois, a IA usa a NVIDIA automaticamente.</p>
        </div>
      </Modal>
    </div>
  );
}
