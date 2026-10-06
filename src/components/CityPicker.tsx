import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { Field, Input } from './ui';

/** Localidade da escola: nome da cidade (texto dos documentos) + UF + código IBGE (base dos feriados locais). */
export type Localidade = { city: string; uf: string; ibge_code: string };

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

type Municipio = { id: number; nome: string };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "Goiânia - GO", "Goiânia/GO", "Goiânia, GO" → { nome, uf }. */
export function parseCity(text: string): { nome: string; uf: string } {
  const m = /^(.*?)\s*[-–/,]\s*([A-Za-z]{2})\s*$/.exec(text.trim());
  return m && UFS.includes(m[2].toUpperCase()) ? { nome: m[1].trim(), uf: m[2].toUpperCase() } : { nome: text.trim(), uf: '' };
}
export const cityLabel = (nome: string, uf: string) => (nome ? (uf ? `${nome} - ${uf}` : nome) : '');

async function fetchMunicipios(uf: string): Promise<Municipio[]> {
  // API oficial do IBGE (sem chave, aceita chamadas do navegador).
  const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`);
  if (!res.ok) throw new Error('Não foi possível carregar a lista de cidades.');
  const rows = (await res.json()) as { id: number; nome: string }[];
  return rows.map((r) => ({ id: r.id, nome: r.nome }));
}

export function CityPicker({ value, onChange }: { value: Localidade; onChange: (v: Localidade) => void }) {
  const listId = useId();
  const parsed = useMemo(() => parseCity(value.city), [value.city]);
  const [uf, setUf] = useState(value.uf || parsed.uf);
  const [name, setName] = useState(parsed.nome);
  useEffect(() => {
    setUf(value.uf || parsed.uf);
    setName(parsed.nome);
  }, [value.city, value.uf]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: cities = [], isFetching, isError } = useQuery({
    queryKey: ['ibge-municipios', uf],
    queryFn: () => fetchMunicipios(uf),
    enabled: !!uf,
    staleTime: Infinity,
  });
  const match = cities.find((c) => fold(c.nome) === fold(name));

  // Cidade antiga digitada à mão (sem código): se bate com a lista, completa o código sozinho.
  useEffect(() => {
    if (match && (String(match.id) !== value.ibge_code || value.uf !== uf || value.city !== cityLabel(match.nome, uf))) {
      onChange({ city: cityLabel(match.nome, uf), uf, ibge_code: String(match.id) });
    }
  }, [match?.id, uf]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeName = (v: string) => {
    setName(v);
    const hit = cities.find((c) => fold(c.nome) === fold(v));
    onChange(hit ? { city: cityLabel(hit.nome, uf), uf, ibge_code: String(hit.id) } : { city: cityLabel(v, uf), uf, ibge_code: '' });
  };
  const pickUf = (next: string) => {
    setUf(next);
    onChange({ city: cityLabel(name, next), uf: next, ibge_code: '' });
  };

  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[110px_1fr]">
      <Field label="UF">
        <select
          value={uf}
          onChange={(e) => pickUf(e.target.value)}
          className="h-[42px] w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/15"
        >
          <option value="">UF</option>
          {UFS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </Field>
      <Field label="Cidade">
        <Input
          value={name}
          onChange={(e) => typeName(e.target.value)}
          list={listId}
          placeholder={uf ? 'Comece a digitar e escolha na lista' : 'Escolha a UF primeiro'}
          disabled={!uf}
          autoComplete="off"
        />
        <datalist id={listId}>
          {cities.map((c) => (
            <option key={c.id} value={c.nome} />
          ))}
        </datalist>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {isFetching
            ? 'Carregando cidades…'
            : isError
              ? 'Não foi possível carregar a lista de cidades. Verifique a conexão.'
              : match
                ? '✓ Cidade confirmada — os feriados estaduais e municipais aparecem no calendário.'
                : name
                  ? 'Escolha a cidade exatamente como aparece na lista para ativar os feriados locais.'
                  : 'Usada nos documentos e para mostrar os feriados do estado e do município no calendário.'}
        </p>
      </Field>
    </div>
  );
}
