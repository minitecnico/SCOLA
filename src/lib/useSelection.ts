import { useState } from 'react';

export function useSelection() {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(false);

  return {
    ids,
    active,
    size: ids.size,
    has: (id: string) => ids.has(id),
    toggle: (id: string) =>
      setIds((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      }),
    setAll: (all: string[]) => setIds(new Set(all)),
    clear: () => setIds(new Set()),
    enable: () => setActive(true),
    disable: () => {
      setActive(false);
      setIds(new Set());
    },
  };
}
