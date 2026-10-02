"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { OFFER_STATUS_LABEL, tagColorClass } from "@/lib/labels";
import { cn } from "@/lib/utils";

const ALL = "__all__";

/**
 * Busca, filtros e ordenação. Tudo fica na URL (?q=&status=&tag=&ordem=),
 * então sobrevive ao recarregar e pode ser salvo nos favoritos.
 */
export function OffersToolbar({ tags }: { tags: { id: string; name: string; color: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Mantém o campo em sincronia só quando a URL muda por fora (ex.: "Limpar
  // filtros"). O que o próprio campo enviou não volta para ele — senão o espaço
  // recém-digitado sumiria ao buscar "promo x".
  const urlQ = params.get("q") ?? "";
  const pushed = useRef(urlQ);
  useEffect(() => {
    if (urlQ !== pushed.current) {
      pushed.current = urlQ;
      setQ(urlQ);
    }
  }, [urlQ]);
  useEffect(() => () => clearTimeout(debounce.current), []);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const status = params.get("status") ?? ALL;
  const tag = params.get("tag") ?? ALL;
  const sort = params.get("ordem") ?? "recentes";
  const hasFilters = Boolean(params.get("q") || params.get("status") || params.get("tag"));
  // Sem nenhuma tag criada, o filtro de tags não tem o que mostrar.
  const showTags = tags.length > 0 || tag !== ALL;

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative col-span-2 sm:w-72">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          placeholder="Buscar por nome, tag ou link…"
          className="pl-8"
          aria-label="Buscar ofertas"
          onChange={(e) => {
            const value = e.target.value;
            setQ(value);
            clearTimeout(debounce.current);
            debounce.current = setTimeout(() => {
              pushed.current = value.trim();
              setParam("q", value.trim() || null);
            }, 250);
          }}
        />
        {pending && <Spinner className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />}
      </div>

      <Select value={status} onValueChange={(v) => setParam("status", v === ALL ? null : v)}>
        <SelectTrigger className="w-full sm:w-40" aria-label="Filtrar por status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos os status</SelectItem>
          {(Object.keys(OFFER_STATUS_LABEL) as (keyof typeof OFFER_STATUS_LABEL)[]).map((s) => (
            <SelectItem key={s} value={s}>
              {OFFER_STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showTags && (
        <Select value={tag} onValueChange={(v) => setParam("tag", v === ALL ? null : v)}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por tag">
            <SelectValue placeholder="Tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as tags</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className={cn("size-2 rounded-full", tagColorClass(t.color).dot)} />
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={sort} onValueChange={(v) => setParam("ordem", v === "recentes" ? null : v)}>
        <SelectTrigger className={cn("w-full sm:w-44", showTags && !hasFilters && "col-span-2")} aria-label="Ordenar">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recentes">Últimas editadas</SelectItem>
          <SelectItem value="criacao">Últimas criadas</SelectItem>
          <SelectItem value="nome">Nome (A–Z)</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button
          variant="ghost"
          className={cn(!showTags && "col-span-2")}
          onClick={() => {
            clearTimeout(debounce.current);
            const next = new URLSearchParams(params.toString());
            for (const k of ["q", "status", "tag"]) next.delete(k);
            const qs = next.toString();
            startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
          }}
        >
          <XIcon />
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
