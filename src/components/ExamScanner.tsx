import { useQueryClient } from '@tanstack/react-query';
import { Camera, Check, ImageUp, RotateCcw, ScanLine, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { LETTERS, parseQr } from '../lib/omr/layout';
import { findSheet, locateCorners, project, readAt, type Img, type Pt, type ScanResult } from '../lib/omr/scan';
import { scoreAnswers } from '../lib/omr/score';
import { getExamByCode, saveExamAnswer, type ExamDetail } from '../lib/queries';
import { gradeTone, TONE } from '../lib/tone';

/**
 * Correção pela câmera: aponte para a folha de respostas; o QR identifica prova e
 * aluno, as marcas de canto corrigem a perspectiva e as bolinhas são lidas no aparelho.
 * Depois da leitura, o professor confere (pode tocar numa questão para ajustar) e salva.
 */
type Captured = {
  detail: ExamDetail;
  studentId: string | null;
  answers: string[];
  uncertain: number[];
  scan: ScanResult;
  frame: ImageData;
  edited: boolean;
};

const MAX_SIDE = 1600;
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

function toImg(src: CanvasImageSource, w: number, h: number, canvas: HTMLCanvasElement): ImageData {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function ExamScanner({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: ExamDetail | null }) {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cache = useRef(new Map<string, ExamDetail | { error: string }>());
  const stable = useRef<{ key: string; count: number }>({ key: '', count: 0 });
  const busy = useRef(false);

  const [phase, setPhase] = useState<'starting' | 'scanning' | 'review' | 'nocamera'>('starting');
  const [hint, setHint] = useState('Aponte a câmera para a folha de respostas.');
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  // Sempre a versão mais recente da prova (o gabarito pode ter mudado desde a última abertura).
  useEffect(() => {
    if (!open) return;
    cache.current.clear();
    if (initial) cache.current.set(initial.exam.code, initial);
  }, [open, initial]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setPhase('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('nocamera');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      stable.current = { key: '', count: 0 };
      setPhase('scanning');
    } catch {
      setPhase('nocamera');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    workRef.current ??= document.createElement('canvas');
    void startCamera();
    return () => stopCamera();
  }, [open, startCamera, stopCamera]);

  /** Resolve a prova pelo código do QR (com cache — não consulta o servidor a cada quadro). */
  async function examFor(code: string): Promise<ExamDetail | string> {
    const hit = cache.current.get(code);
    if (hit) return 'error' in hit ? hit.error : hit;
    try {
      const d = await getExamByCode(code);
      cache.current.set(code, d);
      return d;
    } catch (e) {
      const msg = (e as Error).message;
      cache.current.set(code, { error: msg });
      return msg;
    }
  }

  /** Processa um quadro/foto. Devolve true quando capturou uma leitura. */
  async function process(img: Img, single: boolean): Promise<boolean> {
    const found = await findSheet(img);
    if (!found) {
      setHint('Enquadre a folha inteira, de cima e com boa luz.');
      drawOverlay(null, img);
      return false;
    }
    if (!found.text) {
      setHint('Aproxime a câmera: a folha está longe e o QR code ficou pequeno.');
      drawOverlay(found.corners, img);
      return false;
    }
    const parsed = parseQr(found.text);
    if (!parsed) {
      setHint('Este QR code não é de uma folha de respostas do SCOLA.');
      return false;
    }
    const d = await examFor(parsed.code);
    if (typeof d === 'string') {
      setHint(d);
      return false;
    }
    const corners = found.corners ?? locateCorners(img, null);
    const scan = corners ? readAt(img, d.exam.questions, d.exam.choices, corners) : null;
    drawOverlay(scan?.corners ?? null, img);
    if (!scan) {
      setHint('Mostre os 4 quadrados pretos dos cantos da folha.');
      stable.current = { key: '', count: 0 };
      return false;
    }
    // Só captura quando duas leituras seguidas concordam (mão parada).
    const key = `${parsed.code}|${parsed.student}|${scan.answers.join('')}`;
    stable.current = stable.current.key === key ? { key, count: stable.current.count + 1 } : { key, count: 1 };
    if (!single && stable.current.count < 2) {
      setHint('Folha encontrada. Segure firme…');
      return false;
    }
    const student = parsed.student ? d.students.find((s) => s.short === parsed.student) ?? null : null;
    setCaptured({
      detail: d,
      studentId: student?.id ?? null,
      answers: scan.answers,
      uncertain: scan.uncertain,
      scan,
      frame: new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
      edited: false,
    });
    setPhase('review');
    return true;
  }

  function drawOverlay(corners: Pt[] | null, img: Img) {
    const cv = overlayRef.current;
    const v = videoRef.current;
    if (!cv || !v) return;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    // Mesmo enquadramento do vídeo (object-cover).
    const s = Math.max(W / img.width, H / img.height);
    const ox = (W - img.width * s) / 2;
    const oy = (H - img.height * s) / 2;
    const map = (p: Pt) => ({ x: ox + p.x * s, y: oy + p.y * s });
    if (corners) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      corners.map(map).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Laço de leitura (~4 quadros por segundo).
  useEffect(() => {
    if (!open || phase !== 'scanning') return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const v = videoRef.current;
      if (v && v.videoWidth && !busy.current) {
        busy.current = true;
        try {
          const img = toImg(v, v.videoWidth, v.videoHeight, workRef.current!);
          if (await process(img, false)) return;
        } finally {
          busy.current = false;
        }
      }
      if (alive) setTimeout(tick, 230);
    };
    const t = setTimeout(tick, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase]);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const img = toImg(bmp, bmp.width, bmp.height, workRef.current ?? (workRef.current = document.createElement('canvas')));
    stable.current = { key: '', count: 0 };
    const ok = await process(img, true);
    if (!ok) setFlash('Não consegui ler esta foto. Tire de cima, com a folha inteira e bem iluminada.');
  }

  function rescan() {
    setCaptured(null);
    stable.current = { key: '', count: 0 };
    setHint('Aponte a câmera para a folha de respostas.');
    setPhase(streamRef.current ? 'scanning' : 'nocamera');
  }

  async function save() {
    if (!captured?.studentId) return;
    const { detail, studentId, answers, edited } = captured;
    const r = await saveExamAnswer(detail.exam.id, studentId, answers, edited ? 'manual' : 'camera');
    // Atualiza o cache local para marcar o aluno como corrigido.
    const others = detail.answers.filter((a) => a.student_id !== studentId);
    cache.current.set(detail.exam.code, { ...detail, answers: [...others, { student_id: studentId, answers, source: edited ? 'manual' : 'camera', updated_at: new Date().toISOString() }] });
    qc.invalidateQueries({ queryKey: ['exams'] });
    qc.invalidateQueries({ queryKey: ['exam', detail.exam.id] });
    const name = detail.students.find((s) => s.id === studentId)?.name.split(' ')[0] ?? 'Aluno';
    setSavedCount((n) => n + 1);
    setFlash(`${name}: ${r.correct}/${r.total} acertos · nota ${fmt(r.score)}`);
    rescan();
  }

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  if (!open) return null;

  // Portal: tela cheia de verdade, fora de qualquer contêiner com transform.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-neutral-950 text-white">
      {/* Barra superior */}
      <div className="flex items-center gap-3 px-4 py-3">
        <ScanLine size={20} className="text-brand" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Corrigir provas</p>
          <p className="truncate text-xs text-white/60">{savedCount ? `${savedCount} folha(s) corrigida(s) agora` : 'Uma folha por vez'}</p>
        </div>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold hover:bg-white/15">
          <ImageUp size={16} /> <span className="hidden sm:inline">Usar foto</span>
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
        </label>
        <button onClick={() => { stopCamera(); onClose(); }} className="grid h-10 w-10 place-items-center rounded-lg bg-white/10 hover:bg-white/15" aria-label="Fechar">
          <X size={18} />
        </button>
      </div>

      {/* Câmera */}
      <div className={cn('relative flex-1 overflow-hidden', phase === 'review' && 'hidden')}>
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {/* Guia de enquadramento A4 */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <div className="aspect-[210/297] h-full max-h-[80vh] max-w-full rounded-xl border-2 border-dashed border-white/40" />
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-6 pt-12 text-center">
          {phase === 'nocamera' ? (
            <div className="mx-auto max-w-sm">
              <Camera size={28} className="mx-auto mb-2 text-brand" />
              <p className="text-sm font-semibold">Câmera indisponível</p>
              <p className="mt-1 text-xs text-white/70">Permita o uso da câmera no navegador ou toque em "Usar foto" para enviar uma foto da folha.</p>
            </div>
          ) : (
            <p className="text-sm font-medium">{phase === 'starting' ? 'Abrindo a câmera…' : hint}</p>
          )}
        </div>
      </div>

      {phase === 'review' && captured ? (
        <Review captured={captured} setCaptured={setCaptured} onRescan={rescan} onSave={save} />
      ) : null}

      {flash ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-neutral-950 shadow-lift">
            <Check size={16} className="text-green-600" /> {flash}
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/* --------------------------------- Revisão --------------------------------- */
function Review({
  captured,
  setCaptured,
  onRescan,
  onSave,
}: {
  captured: Captured;
  setCaptured: (c: Captured) => void;
  onRescan: () => void;
  onSave: () => Promise<void>;
}) {
  const { detail, studentId, answers, uncertain } = captured;
  const { exam } = detail;
  const [sel, setSel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [showPhoto, setShowPhoto] = useState(false);
  const photoRef = useRef<HTMLCanvasElement>(null);
  const r = scoreAnswers(exam.answer_key, answers, exam.questions, exam.points);
  const tone = gradeTone(r.score, exam.points);
  const already = studentId ? detail.answers.find((a) => a.student_id === studentId) : null;
  const done = useMemo(() => new Set(detail.answers.map((a) => a.student_id)), [detail.answers]);

  // Foto com as bolinhas lidas destacadas (confiança para o professor).
  useEffect(() => {
    if (!showPhoto) return;
    const cv = photoRef.current;
    if (!cv) return;
    const { frame, scan } = captured;
    cv.width = frame.width;
    cv.height = frame.height;
    const ctx = cv.getContext('2d')!;
    ctx.putImageData(frame, 0, 0);
    const scale = Math.hypot(scan.corners[1].x - scan.corners[0].x, scan.corners[1].y - scan.corners[0].y) / 176;
    for (const b of scan.layout.bubbles) {
      const mark = answers[b.q];
      if (mark !== LETTERS[b.a] && !(mark === '*' && scan.fill[b.q][b.a] > 0.35)) continue;
      const p = project(scan.h, { x: b.x, y: b.y });
      const key = exam.answer_key[b.q];
      ctx.strokeStyle = key === 'X' || mark === key ? '#16a34a' : '#dc2626';
      ctx.lineWidth = Math.max(2, scale * 0.6);
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.r * scale * 1.35, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [showPhoto, captured, answers, exam.answer_key]);

  function setAnswer(q: number, v: string) {
    const next = [...answers];
    next[q] = v;
    setCaptured({ ...captured, answers: next, uncertain: uncertain.filter((x) => x !== q), edited: true });
  }

  async function doSave() {
    setSaving(true);
    setErr('');
    try {
      await onSave();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">
              {exam.title} · {exam.class_name}
            </p>
            {studentId ? (
              <p className="text-lg font-bold">{detail.students.find((s) => s.id === studentId)?.name}</p>
            ) : (
              <div className="mt-1">
                <p className="mb-1 text-sm font-semibold text-orange-700">Folha avulsa: escolha o aluno</p>
                <select
                  className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
                  value=""
                  onChange={(e) => setCaptured({ ...captured, studentId: e.target.value || null })}
                >
                  <option value="">Selecione…</option>
                  {detail.students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {done.has(s.id) ? ' (já corrigida)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {already ? <p className="mt-1 text-xs text-orange-700">Este aluno já tinha correção. Ao salvar, ela será substituída.</p> : null}
          </div>

          {/* Nota */}
          <div className="flex items-end justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Nota</p>
              <p className={cn('text-4xl font-extrabold tabular-nums leading-none', TONE[tone].text)}>
                {fmt(r.score)}
                <span className="ml-1 text-base font-semibold text-muted-foreground">/ {fmt(exam.points)}</span>
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>
                <b className="text-foreground">{r.correct}</b> de {r.total} acertos
              </p>
              <p>
                {r.wrong} erradas · {r.blank} em branco{r.multiple ? ` · ${r.multiple} com 2 marcas` : ''}
              </p>
            </div>
          </div>

          {uncertain.length ? (
            <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-900 ring-1 ring-inset ring-orange-200">
              Confira {uncertain.length === 1 ? 'a questão destacada' : `as ${uncertain.length} questões destacadas`}: a marcação ficou fraca ou com rasura. Toque para ajustar.
            </p>
          ) : null}

          {/* Grade de respostas */}
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {answers.map((a, q) => {
              const key = exam.answer_key[q];
              const ok = key === 'X' || (!!key && a === key);
              return (
                <button
                  key={q}
                  onClick={() => setSel(sel === q ? null : q)}
                  className={cn(
                    'flex flex-col items-center rounded-lg py-1.5 text-xs ring-1 ring-inset transition',
                    ok ? TONE.ok.soft : a === '' ? TONE.none.soft : TONE.bad.soft,
                    uncertain.includes(q) && 'ring-2 ring-orange-500',
                    sel === q && 'outline outline-2 outline-neutral-950',
                  )}
                >
                  <span className="text-[10px] opacity-70">{String(q + 1).padStart(2, '0')}</span>
                  <span className="text-sm font-bold">{a === '*' ? '2+' : a || '—'}</span>
                  {!ok && key && key !== 'X' ? <span className="text-[10px] opacity-70">({key})</span> : null}
                </button>
              );
            })}
          </div>

          {sel != null ? (
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Questão {sel + 1}: o que o aluno marcou?{exam.answer_key[sel] ? ` (gabarito: ${exam.answer_key[sel] === 'X' ? 'anulada' : exam.answer_key[sel]})` : ''}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...LETTERS.slice(0, exam.choices), ''].map((v) => (
                  <button
                    key={v || 'blank'}
                    onClick={() => {
                      setAnswer(sel, v);
                      setSel(null);
                    }}
                    className={cn(
                      'h-10 min-w-10 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset ring-border',
                      answers[sel] === v ? 'bg-neutral-950 text-white ring-neutral-950' : 'bg-card hover:bg-muted',
                    )}
                  >
                    {v || 'Em branco'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <button onClick={() => setShowPhoto((v) => !v)} className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {showPhoto ? 'Ocultar foto' : 'Ver a foto com as marcações lidas'}
          </button>
          {showPhoto ? <canvas ref={photoRef} className="w-full rounded-lg border border-border" /> : null}
        </div>
      </div>

      <div className="border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          {err ? <p className="mr-auto text-xs font-semibold text-red-600">{err}</p> : null}
          <button onClick={onRescan} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-card text-sm font-semibold ring-1 ring-inset ring-border hover:bg-muted sm:flex-none sm:px-4">
            <RotateCcw size={16} /> Ler de novo
          </button>
          <button
            onClick={doSave}
            disabled={!studentId || saving}
            className="inline-flex h-11 flex-[2] items-center justify-center gap-2 rounded-lg bg-neutral-950 text-sm font-semibold text-white hover:bg-black disabled:opacity-40 sm:flex-none sm:px-5"
          >
            <Check size={16} /> {saving ? 'Salvando…' : 'Salvar e próxima'}
          </button>
        </div>
      </div>
    </div>
  );
}
