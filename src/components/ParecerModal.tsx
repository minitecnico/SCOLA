import { Check, Copy, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { aiPareceres, type ParecerInput } from '../lib/queries';
import type { ReportPayload } from '../lib/types';
import { Button, Modal, fieldCls } from './ui';

/**
 * Pareceres descritivos com IA, a partir do relatório de notas na tela.
 * Os nomes ficam no navegador: a IA recebe só números e notas, e o nome volta aqui.
 */
const TONES = ['equilibrado e encorajador', 'formal, para boletim oficial', 'acolhedor, para as famílias'];
const BATCH = 12;

type Row = { name: string; text: string; busy?: boolean };

function studentsOf(payload: ReportPayload): ParecerInput['students'] {
  const term = payload.notasTerm ?? 0;
  const acts = payload.termActivities ?? [];
  const sel = payload.termSelectedActivities ?? acts.map((a) => a.id ?? a.name);
  return (payload.notasRows ?? []).map((r, i) => ({
    n: i + 1,
    terms: r.terms.slice(0, 3),
    final: r.final,
    activities: term >= 1 && term <= 3
      ? sel.flatMap((k) => {
          const a = acts.find((x) => (x.id ?? x.name) === k);
          return a ? [{ name: a.name, score: r.activityScores?.[k] ?? null, max: a.max }] : [];
        })
      : undefined,
  }));
}

export function ParecerModal({ payload, onClose }: { payload: ReportPayload; onClose: () => void }) {
  const names = (payload.notasRows ?? []).map((r) => r.name);
  const [tone, setTone] = useState(TONES[0]);
  const [extra, setExtra] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const stop = useRef(false);

  const base = (): Omit<ParecerInput, 'students'> => ({
    subject: payload.subject, className: payload.className, period: payload.period, term: payload.notasTerm ?? 0, tone, extra,
  });

  async function generateAll() {
    const all = studentsOf(payload);
    setRows(names.map((name) => ({ name, text: '' })));
    setError('');
    stop.current = false;
    for (let i = 0; i < all.length && !stop.current; i += BATCH) {
      setProgress({ done: i, total: all.length });
      try {
        const r = await aiPareceres({ ...base(), students: all.slice(i, i + BATCH) });
        setRows((cur) => cur && cur.map((row, k) => {
          const hit = r.items.find((it) => it.n === k + 1);
          return hit?.text ? { ...row, text: hit.text } : row;
        }));
      } catch (e) {
        setError((e as Error).message);
        break;
      }
    }
    setProgress(null);
  }

  async function redo(k: number) {
    setRows((cur) => cur && cur.map((r, i) => (i === k ? { ...r, busy: true } : r)));
    try {
      const r = await aiPareceres({ ...base(), students: [studentsOf(payload)[k]] });
      setRows((cur) => cur && cur.map((row, i) => (i === k ? { ...row, text: r.items[0]?.text || row.text, busy: false } : row)));
    } catch (e) {
      setError((e as Error).message);
      setRows((cur) => cur && cur.map((r, i) => (i === k ? { ...r, busy: false } : r)));
    }
  }

  const done = rows?.filter((r) => r.text) ?? [];
  const asText = () => done.map((r) => `${r.name}\n${r.text}`).join('\n\n');

  async function downloadWord() {
    const { docToDocx } = await import('../lib/docxConvert');
    const title = `Pareceres — ${payload.className}${payload.subject ? ` — ${payload.subject}` : ''}`;
    const json = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
        { type: 'paragraph', content: [{ type: 'text', text: payload.period }] },
        ...done.flatMap((r) => [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: r.name }] },
          { type: 'paragraph', content: [{ type: 'text', text: r.text }] },
        ]),
      ],
    };
    const blob = await docToDocx(json, title);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '-')}.docx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  return (
    <Modal open onClose={() => { stop.current = true; onClose(); }} title="Pareceres com IA" size="xl">
      <div className="space-y-3">
        {!rows ? (
          <>
            <p className="text-sm text-muted-foreground">
              A IA escreve um parecer curto para cada um dos <b className="text-foreground">{names.length} alunos</b> com base nas notas deste relatório.
              Os nomes não saem do SCOLA: a IA recebe só as notas, numeradas.
            </p>
            <label className="block text-sm font-semibold">
              Tom
              <select value={tone} onChange={(e) => setTone(e.target.value)} className={fieldCls}>
                {TONES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Orientação para a IA (opcional)
              <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ex.: conteúdo do trimestre foi frações e porcentagem" className={fieldCls} />
            </label>
            <Button onClick={() => void generateAll()} disabled={!names.length} className="w-full">
              <Sparkles size={16} /> Gerar pareceres
            </Button>
          </>
        ) : (
          <>
            {progress ? (
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Loader2 size={15} className="animate-spin" /> Escrevendo… {Math.min(progress.done + BATCH, progress.total)} de {progress.total}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => { void navigator.clipboard.writeText(asText()); setCopied(true); setTimeout(() => setCopied(false), 2000); }} disabled={!done.length}>
                  {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiado' : 'Copiar todos'}
                </Button>
                <Button variant="ghost" onClick={() => void downloadWord()} disabled={!done.length}><FileText size={16} /> Baixar Word</Button>
                <Button variant="ghost" onClick={() => setRows(null)}>Ajustar e gerar de novo</Button>
              </div>
            )}
            {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
            <ul className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {rows.map((r, k) => (
                <li key={k} className="rounded-xl border border-border bg-card p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">{k + 1}. {r.name}</span>
                    <button
                      onClick={() => void redo(k)}
                      disabled={!!progress || r.busy}
                      title="Escrever outro parecer para este aluno"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40"
                    >
                      <RefreshCw size={12} className={r.busy ? 'animate-spin' : ''} /> Refazer
                    </button>
                  </div>
                  {r.text || r.busy ? (
                    <textarea
                      value={r.text}
                      onChange={(e) => setRows((cur) => cur && cur.map((x, i) => (i === k ? { ...x, text: e.target.value } : x)))}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-neutral-900"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">{progress ? 'Aguardando…' : 'Sem parecer: use Refazer.'}</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="text-[11px] text-muted-foreground">A IA pode errar: revise e ajuste cada parecer antes de usar.</p>
      </div>
    </Modal>
  );
}
