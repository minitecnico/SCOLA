import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { successToast } from "../Feedback";
import { listSchools, saveSchool } from "../../lib/queries";
import { CityPicker, type Localidade } from "../CityPicker";
import { Button, Modal } from "../ui";
import { cn } from "../../lib/cn";
import type { OrgPerson } from "../../lib/types";


/* ------------------- Modal de participantes (quem pode editar) --------------------- */
export function EditorsModal({
  people,
  editors,
  onChange,
  onClose,
}: {
  people: OrgPerson[];
  editors: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const set = new Set(editors);
  const toggle = (id: string) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    onChange([...n]);
  };
  // Coordenação/direção já editam por papel — destacamos para não confundir.
  const alwaysEdit = (r: string) => r === "gestor" || r === "superadmin";

  return (
    <Modal open onClose={onClose} title="Participantes — quem pode editar" size="xl">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Todos da escola <b>veem</b> este calendário. Marque abaixo quem mais pode <b>editar</b>. A gestão já editam por
          padrão. As mudanças entram ao clicar em <b>Salvar</b>.
        </p>
        {people.length === 0 ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm font-bold text-muted-foreground">Nenhum usuário na escola ainda.</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
            {people.map((p) => {
              const byRole = alwaysEdit(p.role);
              const checked = byRole || set.has(p.user_id);
              return (
                <label
                  key={p.user_id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2 py-2 text-sm",
                    byRole ? "opacity-60" : "cursor-pointer hover:bg-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={byRole}
                    onChange={() => toggle(p.user_id)}
                    className="h-4 w-4 accent-neutral-900"
                  />
                  <span className="min-w-0 flex-1 truncate font-bold text-foreground">{p.full_name || p.email || p.user_id}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">{p.role}</span>
                  {byRole ? <span className="shrink-0 text-[10px] font-bold text-muted-foreground">edita por padrão</span> : null}
                </label>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button onClick={onClose}>Concluir</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------- Modal: cidade da escola (feriados locais) --------------------- */
export function CityModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: schools } = useQuery({ queryKey: ["schools"], queryFn: listSchools });
  const school = schools?.[0] ?? null;
  const [loc, setLoc] = useState<Localidade | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (school && !loc) setLoc({ city: school.city ?? "", uf: school.uf ?? "", ibge_code: school.ibge_code ?? "" });
  }, [school, loc]);

  const save = async () => {
    if (!school || !loc?.ibge_code) return;
    setBusy(true);
    try {
      await saveSchool({ ...school, city: loc.city, uf: loc.uf, ibge_code: loc.ibge_code });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["schools"] }),
        qc.invalidateQueries({ queryKey: ["local-holidays"] }),
      ]);
      successToast("Cidade da escola salva");
      onClose();
    } catch (e) {
      alert("Não foi possível salvar: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Cidade da escola" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Com a cidade definida, o calendário mostra também os <b>feriados do estado e do município</b> — para toda a escola.
          Você pode mudar isso depois em Configurações › Escola.
        </p>
        {loc ? <CityPicker value={loc} onChange={setLoc} /> : <p className="text-sm font-bold text-muted-foreground">Carregando…</p>}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !loc?.ibge_code}>{busy ? "Salvando…" : "Salvar cidade"}</Button>
        </div>
      </div>
    </Modal>
  );
}

