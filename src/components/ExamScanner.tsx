import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookCheck, Camera, Check, ChevronDown, CloudOff, ImageUp, KeyRound, Layers, RotateCcw, ScanLine, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { LETTERS, parseKeyQr, parseQr } from '../lib/omr/layout';
import { flushPending, isOffline, pendingAnswers, rememberExam, rememberedExam, saveOrQueue } from '../lib/omr/offline';
import { warmUpQr } from '../lib/omr/qr';
import { findSheet, locateCorners, project, readAt, type Img, type Pt, type ScanResult } from '../lib/omr/scan';
import { scoreAnswers } from '../lib/omr/score';
import { getExamByCode, type AutoGrade, type ExamDetail } from '../lib/queries';
import { gradeTone, TONE } from '../lib/tone';

/**
 * Correção pela câmera.
 *  - "Em massa" (padrão): passe as folhas uma atrás da outra; cada leitura segura é
 *    salva sozinha (e lançada no diário, se a prova tiver destino). Leituras duvidosas
 *    ou folhas avulsas vão para "Conferir", sem parar a fila.
 *  - "Uma a uma": cada folha abre a revisão antes de salvar.
 * O QR do gabarito do professor carrega a prova; o QR da folha identifica prova e aluno.
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
type Mode = 'massa' | 'conferir';
type Done = { key: string; name: string; exam: string; correct: number; total: number; score: number; points: number; grade: AutoGrade; queued: boolean; replaced: boolean };

const MAX_SIDE = 1600;
const MODE_KEY = 'scola:correcao:modo';
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const TERM = ['', '1º tri', '2º tri', '3º tri'];

function toImg(src: CanvasImageSource, w: number, h: number, canvas: HTMLCanvasElement): ImageData {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Sinal de "folha lida": vibração + bipe curto (agudo = ok, grave = conferir). */
function signal(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 70 : [60, 60, 60]);
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = (signal as unknown as { ac?: AudioContext }).ac ?? ((signal as unknown as { ac?: AudioContext }).ac = new AC());
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = ok ? 1175 : 440;
    g.gain.setValueAtTime(0.12, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.14);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.15);
  } catch {
    /* sem som: segue */
  }
}

const destino = (e: ExamDetail['exam']) => (e.grade_term ? `notas → diário (${TERM[e.grade_term]})` : 'sem lançar no diário');

export function ExamScanner({ open, onClose, initial, keyText }: { open: boolean; onClose: () => void; initial?: ExamDetail | null; keyText?: string | null }) {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cache = useRef(new Map<string, ExamDetail | { error: string }>());
  const stable = useRef<{ key: string; count: number }>({ key: '', count: 0 });
  const handled = useRef(new Set<string>()); // leituras já tratadas nesta sessão (não repete)
  const busy = useRef(false);

  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'conferir' ? 'conferir' : 'massa';
    } catch {
      return 'massa';
    }
  });
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ok */
    }
  };
  const [phase, setPhase] = useState<'starting' | 'scanning' | 'review' | 'nocamera'>('starting');
  const [hint, setHint] = useState('Aponte para o QR do gabarito do professor ou direto para a folha do aluno.');
  const [active, setActive] = useState<ExamDetail | null>(null);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [fromQueue, setFromQueue] = useState(false);
  const [toCheck, setToCheck] = useState<(Captured & { reason: string; key: string })[]>([]);
  const [done, setDone] = useState<Done[]>([]);
  const [pending, setPending] = useState(0);
  const [showList, setShowList] = useState(false);
  const [flash, setFlash] = useState<{ text: string; tone: 'ok' | 'warn' | 'info' } | null>(null);
  const [pulse, setPulse] = useState<'ok' | 'warn' | null>(null);

  const refreshPending = useCallback(() => setPending(pendingAnswers().length), []);

  // Sempre a versão mais recente da prova (o gabarito pode ter mudado desde a última abertura).
  useEffect(() => {
    if (!open) return;
    cache.current.clear();
    handled.current.clear();
    setDone([]);
    setToCheck([]);
    setActive(initial ?? null);
    if (initial) {
      cache.current.set(initial.exam.code, initial);
      rememberExam(initial);
    }
    warmUpQr();
    refreshPending();
    void flushPending().then((n) => {
      refreshPending();
      if (n) setFlash({ text: `${n} correção(ões) feitas sem internet foram enviadas`, tone: 'ok' });
    });
    const onOnline = () => void flushPending().then(refreshPending);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [open, initial, refreshPending]);

  // Aberto pelo link do QR do professor: já carrega a prova.
  useEffect(() => {
    if (open && keyText) void loadKey(keyText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, keyText]);

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

  /** Resolve a prova pelo código (cache → servidor → cópia guardada no aparelho). */
  async function examFor(code: string): Promise<ExamDetail | string> {
    const hit = cache.current.get(code);
    if (hit) return 'error' in hit ? hit.error : hit;
    try {
      const d = await getExamByCode(code);
      cache.current.set(code, d);
      rememberExam(d);
      return d;
    } catch (e) {
      const saved = isOffline(e) ? rememberedExam(code) : null;
      if (saved) {
        cache.current.set(code, saved);
        return saved;
      }
      const msg = isOffline(e) ? 'Sem internet: abra esta prova uma vez com internet neste aparelho.' : (e as Error).message;
      if (!isOffline(e)) cache.current.set(code, { error: msg });
      return msg;
    }
  }

  /** QR do gabarito do professor: carrega a prova para a correção em massa. */
  async function loadKey(text: string) {
    const k = parseKeyQr(text);
    if (!k) return;
    const d = await examFor(k.code);
    if (typeof d === 'string') {
      setHint(d);
      return;
    }
    if (active?.exam.code === d.exam.code) {
      setHint('Gabarito carregado. Agora passe as folhas dos alunos.');
      return;
    }
    setActive(d);
    signal(true);
    const stale = d.exam.answer_key.join('') !== k.key.join('');
    setFlash(
      stale
        ? { text: 'O gabarito impresso está diferente do sistema. Vale o do sistema — imprima de novo.', tone: 'warn' }
        : { text: `Gabarito carregado: ${d.exam.title}`, tone: 'ok' },
    );
    setHint('Agora passe as folhas dos alunos, uma atrás da outra.');
  }

  /**
   * Processa um quadro/foto.
   * 'review' = abriu a revisão (para o laço) · 'auto' = salvou/enfileirou · 'none' = nada ainda.
   */
  async function process(img: Img, single: boolean): Promise<'review' | 'auto' | 'none'> {
    const found = await findSheet(img);
    if (!found) {
      setHint(active ? 'Enquadre a folha inteira do aluno, de cima e com boa luz.' : 'Aponte para o QR do gabarito do professor ou para a folha do aluno.');
      drawOverlay(null, img);
      return 'none';
    }
    if (found.text && parseKeyQr(found.text)) {
      drawOverlay(null, img);
      await loadKey(found.text);
      return 'none';
    }
    if (!found.text) {
      setHint('Aproxime a câmera: a folha está longe e o QR code ficou pequeno.');
      drawOverlay(found.corners, img);
      return 'none';
    }
    const parsed = parseQr(found.text);
    if (!parsed) {
      setHint('Este QR code não é do SCOLA.');
      return 'none';
    }
    const d = await examFor(parsed.code);
    if (typeof d === 'string') {
      setHint(d);
      return 'none';
    }
    if (active?.exam.code !== d.exam.code) setActive(d);
    const corners = found.corners ?? locateCorners(img, null);
    const scan = corners ? readAt(img, d.exam.questions, d.exam.choices, corners) : null;
    drawOverlay(scan?.corners ?? null, img);
    if (!scan) {
      setHint('Mostre os 4 quadrados pretos dos cantos da folha.');
      stable.current = { key: '', count: 0 };
      return 'none';
    }
    // Só aceita quando duas leituras seguidas concordam (mão parada).
    const key = `${parsed.code}|${parsed.student}|${scan.answers.join('')}`;
    stable.current = stable.current.key === key ? { key, count: stable.current.count + 1 } : { key, count: 1 };
    if (!single && stable.current.count < 2) {
      setHint('Folha encontrada. Segure firme…');
      return 'none';
    }
    const student = parsed.student ? d.students.find((s) => s.short === parsed.student) ?? null : null;
    const cap: Captured = {
      detail: d,
      studentId: student?.id ?? null,
      answers: scan.answers,
      uncertain: scan.uncertain,
      scan,
      frame: new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
      edited: false,
    };

    if (mode === 'conferir') {
      setCaptured(cap);
      setFromQueue(false);
      setPhase('review');
      return 'review';
    }

    // Em massa: a mesma folha parada na frente da câmera não conta duas vezes.
    if (handled.current.has(key)) {
      setHint('Folha já lida. Passe a próxima.');
      return 'none';
    }
    handled.current.add(key);
    const name = student?.name.split(' ')[0];
    if (!student || scan.uncertain.length) {
      const reason = !student
        ? parsed.student
          ? 'Aluno não encontrado nesta turma'
          : 'Folha avulsa: escolha o aluno'
        : `${scan.uncertain.length} questão(ões) com marcação fraca ou rasura`;
      setToCheck((l) => [...l, { ...cap, reason, key }]);
      signal(false);
      setPulse('warn');
      setFlash({ text: `${name ?? 'Folha avulsa'}: separada para conferir`, tone: 'warn' });
      setHint('Passe a próxima folha.');
      return 'auto';
    }
    signal(true);
    setPulse('ok');
    setHint('Passe a próxima folha.');
    void commit(cap);
    return 'auto';
  }

  /** Salva a correção (ou guarda na fila sem internet) e registra na lista da sessão. */
  async function commit(cap: Captured) {
    const { detail, studentId, answers, edited } = cap;
    if (!studentId) return;
    const source = edited ? 'manual' : 'camera';
    const local = scoreAnswers(detail.exam.answer_key, answers, detail.exam.questions, detail.exam.points);
    const student = detail.students.find((s) => s.id === studentId);
    const replaced = detail.answers.some((a) => a.student_id === studentId);
    const r = await saveOrQueue(detail.exam.id, studentId, answers, source);
    // Atualiza o cache local para marcar o aluno como corrigido.
    const next = { ...detail, answers: [...detail.answers.filter((a) => a.student_id !== studentId), { student_id: studentId, answers, source, updated_at: new Date().toISOString() }] };
    cache.current.set(detail.exam.code, next);
    rememberExam(next);
    setActive((a) => (a?.exam.code === detail.exam.code ? next : a));
    if (r) {
      qc.invalidateQueries({ queryKey: ['exams'] });
      qc.invalidateQueries({ queryKey: ['exam', detail.exam.id] });
    } else refreshPending();
    const item: Done = {
      key: `${detail.exam.id}:${studentId}`,
      name: student?.name ?? 'Aluno',
      exam: detail.exam.title,
      correct: local.correct,
      total: local.total,
      score: local.score,
      points: detail.exam.points,
      grade: r?.grade ?? null,
      queued: !r,
      replaced,
    };
    setDone((l) => [item, ...l.filter((x) => x.key !== item.key)]);
    const g = r?.grade;
    setFlash({
      text: `${item.name.split(' ')[0]}: ${local.correct}/${local.total} · nota ${fmt(local.score)}${g?.column && g.value != null ? ` · diário ✓` : ''}${!r ? ' · envia quando a internet voltar' : ''}`,
      tone: g?.error ? 'warn' : 'ok',
    });
    if (g?.error) setFlash({ text: g.error, tone: 'warn' });
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
          if ((await process(img, false)) === 'review') return;
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
  }, [open, phase, mode, active]);

  /** Fotos da galeria: em massa, aceita várias de uma vez. */
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    let failed = 0;
    for (const file of files) {
      const bmp = await createImageBitmap(file);
      const img = toImg(bmp, bmp.width, bmp.height, workRef.current ?? (workRef.current = document.createElement('canvas')));
      stable.current = { key: '', count: 0 };
      const r = await process(img, true);
      if (r === 'none') failed++;
      if (r === 'review') break;
    }
    if (failed) setFlash({ text: failed === 1 ? 'Não consegui ler uma foto. Tire de cima, com a folha inteira e bem iluminada.' : `Não consegui ler ${failed} fotos.`, tone: 'warn' });
  }

  function backToCamera() {
    setCaptured(null);
    stable.current = { key: '', count: 0 };
    setHint(active ? 'Passe a próxima folha.' : 'Aponte a câmera para a folha de respostas.');
    setPhase(streamRef.current ? 'scanning' : 'nocamera');
  }

  /** Abre a próxima folha separada para conferir. */
  function openNextCheck(list = toCheck) {
    const [next, ...rest] = list;
    setToCheck(rest);
    if (!next) return backToCamera();
    setCaptured(next);
    setFromQueue(true);
    setPhase('review');
  }

  async function saveReviewed() {
    if (!captured?.studentId) return;
    await commit(captured);
    if (fromQueue && toCheck.length) openNextCheck();
    else backToCamera();
  }

  function skipReviewed() {
    // Descartou uma folha separada: ela pode ser lida de novo pela câmera.
    const k = (captured as Captured & { key?: string } | null)?.key;
    if (fromQueue && k) handled.current.delete(k);
    if (fromQueue && toCheck.length) openNextCheck();
    else backToCamera();
  }

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => setPulse(null), 450);
    return () => clearTimeout(t);
  }, [pulse]);

  if (!open) return null;
  const exam = active?.exam;

  // Portal: tela cheia de verdade, fora de qualquer contêiner com transform.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-neutral-950 text-white">
      {/* Barra superior */}
      <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <ScanLine size={20} className="shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{exam ? exam.title : 'Corrigir provas'}</p>
          <p className="truncate text-xs text-white/60">{exam ? `${exam.class_name} · ${destino(exam)}` : 'Comece pelo QR do gabarito do professor ou por uma folha'}</p>
        </div>
        <label className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold hover:bg-white/15">
          <ImageUp size={16} /> <span className="hidden sm:inline">{mode === 'massa' ? 'Usar fotos' : 'Usar foto'}</span>
          <input type="file" accept="image/*" multiple={mode === 'massa'} className="hidden" onChange={onPhoto} />
        </label>
        <button onClick={() => { stopCamera(); onClose(); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10 hover:bg-white/15" aria-label="Fechar">
          <X size={18} />
        </button>
      </div>

      {/* Modo */}
      {phase !== 'review' ? (
        <div className="flex justify-center px-4 pb-2">
          <div className="inline-flex rounded-lg bg-white/10 p-1 text-xs font-semibold">
            {(
              [
                ['massa', 'Em massa', <Layers key="m" size={14} />],
                ['conferir', 'Uma a uma', <BookCheck key="c" size={14} />],
              ] as const
            ).map(([v, label, icon]) => (
              <button
                key={v}
                onClick={() => setMode(v)}
                className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 transition', mode === v ? 'bg-brand text-neutral-950' : 'text-white/75 hover:text-white')}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Câmera */}
      <div className={cn('relative flex-1 overflow-hidden', phase === 'review' && 'hidden')}>
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {/* Guia de enquadramento A4 (pisca verde ao ler, laranja ao separar) */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <div
            className={cn(
              'aspect-[210/297] h-full max-h-[80vh] max-w-full rounded-xl border-2 transition-colors duration-150',
              pulse === 'ok' ? 'border-solid border-green-400 bg-green-400/10' : pulse === 'warn' ? 'border-solid border-orange-400 bg-orange-400/10' : 'border-dashed border-white/40',
            )}
          />
        </div>
        <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-14 text-center">
          {phase === 'nocamera' ? (
            <div className="mx-auto max-w-sm">
              <Camera size={28} className="mx-auto mb-2 text-brand" />
              <p className="text-sm font-semibold">Câmera indisponível</p>
              <p className="mt-1 text-xs text-white/70">Permita o uso da câmera no navegador ou toque em "Usar fotos" para enviar fotos das folhas.</p>
            </div>
          ) : (
            <p className="text-sm font-medium">{phase === 'starting' ? 'Abrindo a câmera…' : hint}</p>
          )}
          {!exam && phase !== 'nocamera' ? (
            <p className="mx-auto flex max-w-sm items-center justify-center gap-1.5 text-xs text-white/60">
              <KeyRound size={13} /> O QR do professor fica no gabarito impresso (ou na tela da prova).
            </p>
          ) : null}
          {mode === 'massa' && (done.length || toCheck.length || pending) ? (
            <div className="flex flex-wrap justify-center gap-2">
              {done.length ? (
                <button onClick={() => setShowList(true)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-bold text-neutral-950">
                  <Check size={16} className="text-green-600" /> {done.length} corrigida{done.length > 1 ? 's' : ''} <ChevronDown size={14} className="rotate-180 opacity-60" />
                </button>
              ) : null}
              {toCheck.length ? (
                <button onClick={() => openNextCheck()} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-orange-500 px-4 text-sm font-bold text-white">
                  <AlertTriangle size={15} /> Conferir {toCheck.length}
                </button>
              ) : null}
              {pending ? (
                <span className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-semibold">
                  <CloudOff size={15} /> {pending} aguardando internet
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {phase === 'review' && captured ? (
        <Review
          captured={captured}
          setCaptured={setCaptured}
          onRescan={skipReviewed}
          onSave={saveReviewed}
          reason={fromQueue ? (captured as Captured & { reason?: string }).reason : undefined}
          remaining={fromQueue ? toCheck.length : 0}
        />
      ) : null}

      {showList ? <SessionList items={done} onClose={() => setShowList(false)} /> : null}

      {flash ? (
        <div className="pointer-events-none absolute inset-x-0 top-28 flex justify-center px-4">
          <div
            className={cn(
              'flex max-w-md items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lift',
              flash.tone === 'warn' ? 'bg-orange-500 text-white' : 'bg-white text-neutral-950',
            )}
          >
            {flash.tone === 'warn' ? <AlertTriangle size={16} className="shrink-0" /> : <Check size={16} className="shrink-0 text-green-600" />} {flash.text}
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/* ------------------------- Corrigidas nesta sessão ------------------------- */
function SessionList({ items, onClose }: { items: Done[]; onClose: () => void }) {
  const avg = useMemo(() => (items.length ? items.reduce((s, x) => s + x.score, 0) / items.length : 0), [items]);
  return (
    <div className="absolute inset-0 z-10 flex items-end bg-black/60" onClick={onClose}>
      <div className="max-h-[75vh] w-full overflow-hidden rounded-t-2xl bg-card text-foreground" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{items.length} folha(s) corrigida(s) agora</p>
            <p className="text-xs text-muted-foreground">Média desta leva: {fmt(Math.round(avg * 100) / 100)}</p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted" aria-label="Fechar">
            <X size={17} />
          </button>
        </div>
        <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {items.map((x) => (
            <li key={x.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{x.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {x.correct}/{x.total} acertos
                  {x.queued ? ' · aguardando internet' : x.grade?.error ? ' · diário: coluna não encontrada' : x.grade?.column ? ` · no diário: ${x.grade.column}` : ''}
                  {x.replaced ? ' · substituiu a anterior' : ''}
                </span>
              </span>
              <span className={cn('rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ring-1 ring-inset', TONE[gradeTone(x.score, x.points)].soft)}>{fmt(x.score)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Review({
  captured,
  setCaptured,
  onRescan,
  onSave,
  reason,
  remaining = 0,
}: {
  captured: Captured;
  setCaptured: (c: Captured) => void;
  onRescan: () => void;
  onSave: () => Promise<void>;
  /** Veio da pilha "Conferir" da correção em massa: por que foi separada. */
  reason?: string;
  remaining?: number;
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
          {reason ? (
            <p className="flex items-center gap-2 rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-900 ring-1 ring-inset ring-orange-200">
              <AlertTriangle size={14} className="shrink-0" /> {reason}
              {remaining ? <span className="ml-auto font-normal">mais {remaining} para conferir</span> : null}
            </p>
          ) : null}
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
            {reason ? <X size={16} /> : <RotateCcw size={16} />} {reason ? 'Descartar' : 'Ler de novo'}
          </button>
          <button
            onClick={doSave}
            disabled={!studentId || saving}
            className="inline-flex h-11 flex-[2] items-center justify-center gap-2 rounded-lg bg-neutral-950 text-sm font-semibold text-white hover:bg-black disabled:opacity-40 sm:flex-none sm:px-5"
          >
            <Check size={16} /> {saving ? 'Salvando…' : reason && !remaining ? 'Salvar' : 'Salvar e próxima'}
          </button>
        </div>
      </div>
    </div>
  );
}
