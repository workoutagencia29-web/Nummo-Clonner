"use client";

import {
  AnchorIcon,
  CheckIcon,
  CircleAlertIcon,
  CrosshairIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GlobeIcon,
  LinkIcon,
  MailIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  ShoppingCartIcon,
  Unlink2Icon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import {
  applyLinkOpInEditor,
  collectLinkGroups,
  completeUrl,
  type LinkGroup,
  type LinkOp,
  normalizeUrlKey,
  PAGE_LINK_PREFIX,
} from "@/lib/find-replace";
import { plural } from "@/lib/format";
import { displayUrl } from "@/lib/text";
import { cn } from "@/lib/utils";
import { bulkLinkAction, classifyLinksAction } from "@/server/actions/bulk-replace";
import { createOfferLinkAction, updateOfferLinkAction } from "@/server/actions/offer-links";
import type { LinkClassification } from "@/server/services/bulk-replace";
import type { EditorPayload } from "@/server/services/documents";
import type { EditorDialogProps } from "../editor-app";

type OfferLink = EditorPayload["links"][number];
type Kind = "CHECKOUT" | "UPSELL" | "DOWNSELL" | "WHATSAPP" | "OTHER";

const KIND_LABEL: Record<Kind, string> = {
  CHECKOUT: "Checkout",
  UPSELL: "Checkout do upsell",
  DOWNSELL: "Checkout do downsell",
  WHATSAPP: "WhatsApp",
  OTHER: "Outro",
};

type Editing = { groupId: string; mode: "bind" | "url" | "create" | "link-url" | "page" } | null;

/** Espera o editor registrar a mudança (o evento "update" dele sai no próximo ciclo). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

function isAbsolute(url: string) {
  return /^(https?:)?\/\//i.test(url.trim());
}

/** Plataforma para mostrar ("Hotmart"; "Desconhecida" vira só "Checkout"). */
function platformName(c: LinkClassification | undefined) {
  if (!c || c.kind !== "checkout") return null;
  return c.platform && c.platform !== "Desconhecida" ? c.platform : null;
}

function samples(group: LinkGroup) {
  const labels = [...new Set(group.items.map((i) => i.label).filter(Boolean))];
  if (!labels.length) return null;
  const shown = labels.slice(0, 3).map((l) => `“${l}”`);
  const rest = labels.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} e mais ${rest}` : shown.join(", ");
}

/**
 * Links e checkouts: todos os destinos de clique da página aberta, agrupados
 * por endereço. Cada grupo pode ser ligado a um link da oferta (checkout,
 * upsell, WhatsApp…), ter o endereço trocado ou virar um link da oferta novo —
 * nesta página ou em todas as páginas da oferta.
 */
export function LinksDialog({ editor, payload, open, onOpenChange, saveNow, navigate }: EditorDialogProps) {
  const [links, setLinks] = useState<OfferLink[]>(payload.links);
  const [groups, setGroups] = useState<LinkGroup[]>([]);
  const [classes, setClasses] = useState<Record<string, LinkClassification>>({});
  const [allPages, setAllPages] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const bulk = useAction(bulkLinkAction);
  const createLink = useAction(createOfferLinkAction);
  const updateLink = useAction(updateOfferLinkAction);

  const refresh = useCallback(() => setGroups(collectLinkGroups(editor)), [editor]);

  useEffect(() => {
    if (open) {
      // Links criados fora deste diálogo (＋ Criar link da oferta… nas configurações
      // do botão) entram em payload.links: a lista é lida de novo a cada abertura.
      setLinks([...payload.links]);
      refresh();
    } else {
      setEditing(null);
    }
  }, [open, refresh, payload.links]);

  /**
   * As configurações do botão (painel da direita) leem payload.links ao
   * selecionar um elemento: mantém a lista em dia com o que foi criado/editado aqui.
   */
  function updateLinks(next: OfferLink[]) {
    setLinks(next);
    payload.links.splice(0, payload.links.length, ...next);
  }

  const linkByKey = useMemo(() => new Map(links.map((l) => [l.key, l])), [links]);
  const pageById = useMemo(() => new Map(payload.pages.map((p) => [p.id, p])), [payload.pages]);

  /** Endereço efetivo do grupo (links da oferta: a URL do link). */
  const urlOf = useCallback(
    (g: LinkGroup) => (g.kind === "offer-link" ? (linkByKey.get(g.linkKey ?? "")?.url ?? "") : g.url),
    [linkByKey],
  );

  // Plataforma de checkout / WhatsApp (a detecção roda no servidor).
  useEffect(() => {
    if (!open) return;
    const urls = [...new Set([...groups.map(urlOf), ...links.map((l) => l.url)])].filter(
      (u) => u && isAbsolute(u) && !(u in classes),
    );
    if (!urls.length) return;
    let cancelled = false;
    classifyLinksAction({ urls })
      .then((res) => {
        if (!cancelled && res.ok) setClasses((prev) => ({ ...prev, ...res.data }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, groups, links, classes, urlOf]);

  const sorted = useMemo(() => {
    const rank = (g: LinkGroup) => {
      if (g.kind === "unlinked") return -1;
      if (g.kind === "offer-link") return 0;
      const c = classes[g.url];
      if (c?.kind === "checkout") return 1;
      if (c?.kind === "whatsapp") return 2;
      if (g.kind === "url") return 3;
      if (g.kind === "funnel-page") return 4;
      if (g.kind === "email" || g.kind === "phone") return 5;
      return 6;
    };
    return groups
      .map((g, i) => ({ g, i }))
      .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
      .map(({ g }) => g);
  }, [groups, classes]);

  const checkoutCount = groups.filter((g) => classes[urlOf(g)]?.kind === "checkout").length;
  const boundCount = groups.filter((g) => g.kind === "offer-link").reduce((n, g) => n + g.items.length, 0);
  const unlinkedCount = groups.find((g) => g.kind === "unlinked")?.items.length ?? 0;

  const offerLinksHref = `/ofertas/${payload.offer.id}?aba=links`;

  function showOnPage(group: LinkGroup) {
    const components = group.items.map((i) => i.component);
    onOpenChange(false);
    editor.select(components);
    editor.Canvas.scrollTo(components[0], { behavior: "smooth", block: "center" });
  }

  /** Aplica na página aberta (dá para desfazer) e, se pedido, nas outras páginas. */
  async function apply(group: LinkGroup, op: LinkOp, message: (count: number) => string) {
    setBusy(group.id);
    // Botões sem link valem só para esta página: nas outras (upsell, downsell…)
    // o checkout costuma ser outro.
    const everywhere = allPages && group.kind !== "unlinked";
    try {
      let otherPages = 0;
      if (everywhere) {
        if (!(await saveNow())) {
          toast.error("Não foi possível salvar esta página antes de aplicar nas outras. Tente de novo.");
          return false;
        }
        const res = await bulk.run({
          offerId: payload.offer.id,
          match: group.match,
          op,
          excludeDocumentIds: [payload.documentId],
        });
        if (!res.ok) return false;
        otherPages = res.data.documents.length;
      }
      const count = applyLinkOpInEditor(editor, group.match, op);
      refresh();
      setEditing(null);
      const extra = everywhere
        ? otherPages
          ? ` Também em ${plural(otherPages, "outra página", "outras páginas")}.`
          : " Nas outras páginas não havia esse destino."
        : "";
      toast.success(`${message(count)}${extra}`);
      await settle();
      await saveNow();
      return true;
    } finally {
      setBusy(null);
    }
  }

  function bind(group: LinkGroup, key: string, knownLabel?: string) {
    const label = knownLabel ?? linkByKey.get(key)?.label ?? key;
    return apply(
      group,
      { type: "bind", key },
      (n) =>
        `${plural(n, "elemento ligado", "elementos ligados")} a “${label}”. Para trocar o endereço depois, edite o link da oferta.`,
    );
  }

  function setUrl(group: LinkGroup, raw: string) {
    const url = completeUrl(raw);
    if (!url) {
      toast.error("Digite o novo endereço.");
      return;
    }
    void apply(group, { type: "set-url", url }, (n) => `Endereço trocado em ${plural(n, "elemento", "elementos")}.`);
  }

  function unbind(group: LinkGroup) {
    const url = urlOf(group) || undefined;
    void apply(
      group,
      { type: "unbind", url },
      (n) =>
        `${plural(n, "elemento desligado", "elementos desligados")} do link da oferta${url ? ", mantendo o endereço atual" : ""}.`,
    );
  }

  async function createAndBind(group: LinkGroup, label: string, kind: Kind, url?: string) {
    setBusy(group.id);
    const res = await createLink.run({
      offerId: payload.offer.id,
      label: label.trim(),
      url: completeUrl(url ?? urlOf(group)),
      kind,
    });
    setBusy(null);
    if (!res.ok) return;
    updateLinks([...links, res.data]);
    await bind(group, res.data.key, res.data.label);
  }

  async function editLinkUrl(group: LinkGroup, raw: string) {
    const link = linkByKey.get(group.linkKey ?? "");
    if (!link) return;
    setBusy(group.id);
    const res = await updateLink.run(
      { id: link.id, url: raw.trim() },
      {
        success:
          "Endereço do link atualizado. Todos os botões ligados a ele, em todas as páginas, já usam o novo endereço.",
      },
    );
    setBusy(null);
    if (!res.ok) return;
    updateLinks(links.map((l) => (l.id === link.id ? { ...l, url: completeUrl(raw) } : l)));
    setEditing(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-3rem)] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Links e checkouts</DialogTitle>
          <DialogDescription>
            Todos os destinos de clique desta página, agrupados por endereço.
            {groups.length > 0 &&
              ` ${plural(groups.length, "destino", "destinos")} · ${plural(checkoutCount, "checkout", "checkouts")} · ${plural(boundCount, "elemento ligado", "elementos ligados")} a links da oferta${unlinkedCount ? ` · ${plural(unlinkedCount, "botão de compra sem link", "botões de compra sem link")}` : ""}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Dica:</strong> ligue os botões de compra a um{" "}
          <strong className="text-foreground">link da oferta</strong> (Checkout principal, Upsell, WhatsApp…). Quando o
          checkout mudar, é só trocar a URL do link na aba{" "}
          <Link
            href={offerLinksHref}
            className="font-medium text-foreground underline underline-offset-2"
            onClick={(e) => {
              // Sai do editor salvando antes (clique com ⌘/Ctrl abre em outra aba normalmente).
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              onOpenChange(false);
              navigate(offerLinksHref);
            }}
          >
            Links e checkouts da oferta
          </Link>{" "}
          (ou aqui mesmo) e todos os botões ligados são atualizados, em todas as páginas.
        </div>

        <div className="flex items-start gap-3 rounded-md border p-3">
          <Switch id="os-links-all-pages" checked={allPages} onCheckedChange={setAllPages} className="mt-0.5" />
          <Label htmlFor="os-links-all-pages" className="flex-col items-start gap-1 font-normal">
            <span className="font-medium">Aplicar em todas as páginas da oferta</span>
            <span className="text-xs text-muted-foreground">
              Ligar, trocar ou desligar também vale para o mesmo endereço nas outras páginas (e versões A/B). Cada
              página alterada ganha um ponto no Histórico para você poder voltar.
            </span>
          </Label>
        </div>

        {groups.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Esta página ainda não tem links nem botões com destino. Arraste um bloco de botão (categoria Conversão) e
            ligue a um link da oferta.
          </div>
        ) : (
          <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1">
            {sorted.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                link={group.linkKey ? (linkByKey.get(group.linkKey) ?? null) : null}
                links={links}
                pageName={group.pageId ? (pageById.get(group.pageId)?.name ?? null) : null}
                pages={payload.pages}
                classification={classes[urlOf(group)]}
                effectiveUrl={urlOf(group)}
                editing={editing?.groupId === group.id ? editing.mode : null}
                setEditing={(mode) => setEditing(mode ? { groupId: group.id, mode } : null)}
                busy={busy === group.id}
                disabled={busy !== null}
                onShow={() => showOnPage(group)}
                onBind={(key) => void bind(group, key)}
                onSetUrl={(url) => setUrl(group, url)}
                onUnbind={() => unbind(group)}
                onCreate={(label, kind, url) => void createAndBind(group, label, kind, url)}
                onEditLinkUrl={(url) => void editLinkUrl(group, url)}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface GroupCardProps {
  group: LinkGroup;
  link: OfferLink | null;
  links: OfferLink[];
  pageName: string | null;
  pages: EditorPayload["pages"];
  classification: LinkClassification | undefined;
  effectiveUrl: string;
  editing: NonNullable<Editing>["mode"] | null;
  setEditing: (mode: NonNullable<Editing>["mode"] | null) => void;
  busy: boolean;
  disabled: boolean;
  onShow: () => void;
  onBind: (key: string) => void;
  onSetUrl: (url: string) => void;
  onUnbind: () => void;
  onCreate: (label: string, kind: Kind, url?: string) => void;
  onEditLinkUrl: (url: string) => void;
}

function groupTitle({
  group,
  link,
  pageName,
  classification,
}: Pick<GroupCardProps, "group" | "link" | "pageName" | "classification">) {
  if (group.kind === "offer-link") return link ? link.label : `Link “${group.linkKey}” (não existe mais)`;
  if (group.kind === "unlinked") return "Botões de compra sem link";
  if (group.kind === "funnel-page") return `Página do funil: ${pageName ?? "página excluída"}`;
  if (group.kind === "anchor") return `Rolagem até ${group.url}`;
  if (group.kind === "email") return "E-mail";
  if (group.kind === "phone") return "Telefone";
  if (classification?.kind === "whatsapp") return "WhatsApp";
  if (classification?.kind === "checkout") {
    const platform = platformName(classification);
    return platform ? `Checkout ${platform}` : "Checkout";
  }
  if (group.items.every((i) => i.destination?.attr === "action")) return "Envio de formulário";
  return displayUrl(group.url) ?? group.url;
}

function GroupIcon({ group, classification }: Pick<GroupCardProps, "group" | "classification">) {
  const cls = "size-4";
  if (group.kind === "offer-link") return <LinkIcon className={cls} />;
  if (group.kind === "unlinked") return <ShoppingCartIcon className={cls} />;
  if (group.kind === "funnel-page") return <FileTextIcon className={cls} />;
  if (group.kind === "anchor") return <AnchorIcon className={cls} />;
  if (group.kind === "email") return <MailIcon className={cls} />;
  if (group.kind === "phone") return <PhoneIcon className={cls} />;
  if (classification?.kind === "checkout") return <ShoppingCartIcon className={cls} />;
  if (classification?.kind === "whatsapp") return <MessageCircleIcon className={cls} />;
  return <GlobeIcon className={cls} />;
}

/** Nome ainda não usado ("Checkout principal", "Checkout principal 2"…). */
function uniqueLabel(base: string, links: OfferLink[]) {
  const taken = new Set(links.map((l) => l.label));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  return name;
}

function defaultLinkName(classification: LinkClassification | undefined, hasLinks: boolean, url: string) {
  if (classification?.kind === "whatsapp") return "WhatsApp";
  if (classification?.kind === "checkout") {
    if (!hasLinks) return "Checkout principal";
    const platform = platformName(classification);
    return platform ? `Checkout ${platform}` : "Checkout";
  }
  return (displayUrl(url) ?? "Link").slice(0, 60);
}

function GroupCard(props: GroupCardProps) {
  const { group, link, links, pages, classification, effectiveUrl, editing, setEditing, busy, disabled } = props;
  const isLink = group.kind === "offer-link";
  const unlinked = group.kind === "unlinked";
  const missing = isLink && !link;
  const platform = platformName(classification);
  const sample = samples(group);
  const otherLinks = links.filter((l) => l.key !== group.linkKey);
  // Já existe um link da oferta com este mesmo endereço? Então é só ligar.
  const sameUrlLink =
    !isLink && group.url
      ? links.find((l) => l.url && normalizeUrlKey(l.url) === normalizeUrlKey(group.url))
      : undefined;

  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        isLink && "border-primary/30 bg-primary/[0.03]",
        (missing || unlinked) && "border-warning/50",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground",
            isLink && "bg-primary/10 text-primary",
          )}
        >
          <GroupIcon group={group} classification={classification} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-medium">{groupTitle(props)}</p>
            {isLink && link && <Badge variant="secondary">Link da oferta</Badge>}
            {isLink && link && platform && <Badge variant="outline">{platform}</Badge>}
            {!isLink && classification?.kind === "checkout" && <Badge variant="outline">Sem link da oferta</Badge>}
            <Badge variant="outline" className="text-muted-foreground">
              {plural(group.items.length, "elemento", "elementos")}
            </Badge>
          </div>
          {effectiveUrl ? (
            <p className="flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground" title={effectiveUrl}>
              <span className="truncate">{effectiveUrl}</span>
              {isAbsolute(effectiveUrl) && (
                <a
                  href={effectiveUrl.startsWith("//") ? `https:${effectiveUrl}` : effectiveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 hover:text-foreground"
                  aria-label="Abrir o endereço em outra aba"
                >
                  <ExternalLinkIcon className="size-3" />
                </a>
              )}
            </p>
          ) : isLink && link ? (
            <p className="text-xs text-warning">
              Este link ainda não tem endereço: os botões ligados não levam a lugar nenhum.
            </p>
          ) : unlinked ? (
            <p className="text-xs text-warning">
              Estes botões ainda não levam a lugar nenhum. Ligue a um link da oferta (o checkout) — vale só para esta
              página.
            </p>
          ) : null}
          {missing && (
            <p className="mt-1 flex items-center gap-1 text-xs text-warning">
              <CircleAlertIcon className="size-3.5" />
              Esse link da oferta foi excluído. Ligue a outro link ou desligue.
            </p>
          )}
          {sample && <p className="mt-1 truncate text-xs text-muted-foreground">{sample}</p>}
          {!isLink && classification?.kind === "checkout" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Ligue a um link da oferta para trocar este checkout depois num lugar só.
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={props.onShow} title="Selecionar na página">
          <CrosshairIcon />
          Mostrar
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 pl-11">
        {isLink ? (
          <>
            {link && (
              <ActionButton active={editing === "link-url"} onClick={() => setEditing("link-url")} disabled={disabled}>
                <PencilIcon />
                Editar endereço do link
              </ActionButton>
            )}
            {otherLinks.length > 0 && (
              <ActionButton active={editing === "bind"} onClick={() => setEditing("bind")} disabled={disabled}>
                <LinkIcon />
                Trocar de link
              </ActionButton>
            )}
            <ActionButton onClick={props.onUnbind} disabled={disabled}>
              {busy && !editing ? <Spinner /> : <Unlink2Icon />}
              Desligar
            </ActionButton>
          </>
        ) : unlinked ? (
          <>
            {links.length > 0 && (
              <ActionButton active={editing === "bind"} onClick={() => setEditing("bind")} disabled={disabled}>
                <LinkIcon />
                Ligar a um link da oferta
              </ActionButton>
            )}
            <ActionButton active={editing === "create"} onClick={() => setEditing("create")} disabled={disabled}>
              <PlusIcon />
              Criar link da oferta
            </ActionButton>
          </>
        ) : (
          <>
            {sameUrlLink && (
              <Button
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => props.onBind(sameUrlLink.key)}
                disabled={disabled}
                title="Já existe um link da oferta com este mesmo endereço"
              >
                {busy && !editing ? <Spinner /> : <LinkIcon />}
                Ligar a “{sameUrlLink.label}”
              </Button>
            )}
            {links.length > 0 && (
              <ActionButton active={editing === "bind"} onClick={() => setEditing("bind")} disabled={disabled}>
                <LinkIcon />
                Ligar a um link da oferta
              </ActionButton>
            )}
            {group.kind === "funnel-page" ? (
              <ActionButton active={editing === "page"} onClick={() => setEditing("page")} disabled={disabled}>
                <FileTextIcon />
                Trocar página
              </ActionButton>
            ) : (
              <ActionButton active={editing === "url"} onClick={() => setEditing("url")} disabled={disabled}>
                <PencilIcon />
                Trocar endereço
              </ActionButton>
            )}
            {group.kind !== "funnel-page" && group.kind !== "anchor" && !sameUrlLink && (
              <ActionButton active={editing === "create"} onClick={() => setEditing("create")} disabled={disabled}>
                <PlusIcon />
                Criar link da oferta
              </ActionButton>
            )}
          </>
        )}
      </div>

      {editing === "bind" && (
        <BindForm
          links={isLink ? otherLinks : links}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSubmit={props.onBind}
          submitLabel={isLink ? "Trocar" : "Ligar"}
        />
      )}
      {editing === "url" && (
        <UrlForm
          initial={group.url}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSubmit={props.onSetUrl}
          hint="Troca o endereço em todos os elementos deste grupo."
        />
      )}
      {editing === "link-url" && link && (
        <UrlForm
          initial={link.url}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSubmit={props.onEditLinkUrl}
          hint={`Muda o link “${link.label}” da oferta: vale para todos os botões ligados a ele, em todas as páginas.`}
        />
      )}
      {editing === "page" && (
        <PageForm
          pages={pages.filter((p) => p.id !== group.pageId)}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSubmit={(pageId) => props.onSetUrl(`${PAGE_LINK_PREFIX}${pageId}`)}
        />
      )}
      {editing === "create" && (
        <CreateForm
          initialLabel={
            unlinked
              ? uniqueLabel("Checkout principal", links)
              : defaultLinkName(classification, links.length > 0, group.url)
          }
          initialKind={
            unlinked || classification?.kind === "checkout"
              ? "CHECKOUT"
              : classification?.kind === "whatsapp"
                ? "WHATSAPP"
                : "OTHER"
          }
          url={group.url}
          askUrl={unlinked}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSubmit={props.onCreate}
        />
      )}
    </li>
  );
}

function ActionButton({ active, children, ...props }: React.ComponentProps<typeof Button> & { active?: boolean }) {
  return (
    <Button variant={active ? "secondary" : "outline"} size="sm" className="h-7 px-2.5 text-xs" {...props}>
      {children}
    </Button>
  );
}

function InlineForm({
  children,
  onSubmit,
  onCancel,
  busy,
  submitLabel,
  canSubmit = true,
  hint,
}: {
  children: React.ReactNode;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  submitLabel: string;
  canSubmit?: boolean;
  hint?: string;
}) {
  return (
    <form
      className="mt-2 ml-11 flex flex-col gap-2 rounded-md border bg-background p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !busy) onSubmit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <div className="flex items-end gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{hint}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit || busy}>
          {busy ? <Spinner /> : <CheckIcon />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function BindForm({
  links,
  busy,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  links: OfferLink[];
  busy: boolean;
  onSubmit: (key: string) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [key, setKey] = useState(links[0]?.key ?? "");
  return (
    <InlineForm
      busy={busy}
      onCancel={onCancel}
      onSubmit={() => onSubmit(key)}
      submitLabel={submitLabel}
      canSubmit={!!key}
      hint="Na página publicada, estes elementos passam a usar o endereço do link escolhido."
    >
      <Select value={key} onValueChange={setKey}>
        <SelectTrigger size="sm" className="min-w-56 flex-1" aria-label="Link da oferta">
          <SelectValue placeholder="Escolha o link" />
        </SelectTrigger>
        <SelectContent>
          {links.map((l) => (
            <SelectItem key={l.key} value={l.key}>
              <span className="font-medium">{l.label}</span>
              <span className="max-w-56 truncate text-xs text-muted-foreground">
                {displayUrl(l.url) ?? "sem endereço"}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </InlineForm>
  );
}

function UrlForm({
  initial,
  busy,
  onSubmit,
  onCancel,
  hint,
}: {
  initial: string;
  busy: boolean;
  onSubmit: (url: string) => void;
  onCancel: () => void;
  hint: string;
}) {
  const [url, setUrl] = useState(initial);
  return (
    <InlineForm
      busy={busy}
      onCancel={onCancel}
      onSubmit={() => onSubmit(url)}
      submitLabel="Salvar"
      canSubmit={!!url.trim() && url.trim() !== initial.trim()}
      hint={hint}
    >
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://pay.hotmart.com/SEU_PRODUTO"
        aria-label="Novo endereço"
        className="h-8 min-w-56 flex-1 font-mono text-xs"
        maxLength={2000}
        autoFocus
      />
    </InlineForm>
  );
}

function PageForm({
  pages,
  busy,
  onSubmit,
  onCancel,
}: {
  pages: EditorPayload["pages"];
  busy: boolean;
  onSubmit: (pageId: string) => void;
  onCancel: () => void;
}) {
  const [pageId, setPageId] = useState(pages[0]?.id ?? "");
  if (!pages.length) {
    return <p className="mt-2 ml-11 text-xs text-muted-foreground">A oferta não tem outras páginas.</p>;
  }
  return (
    <InlineForm
      busy={busy}
      onCancel={onCancel}
      onSubmit={() => onSubmit(pageId)}
      submitLabel="Trocar"
      canSubmit={!!pageId}
    >
      <Select value={pageId} onValueChange={setPageId}>
        <SelectTrigger size="sm" className="min-w-56 flex-1" aria-label="Página do funil">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {pages.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </InlineForm>
  );
}

function CreateForm({
  initialLabel,
  initialKind,
  url,
  askUrl,
  busy,
  onSubmit,
  onCancel,
}: {
  initialLabel: string;
  initialKind: Kind;
  url: string;
  /** Botões sem endereço: o endereço do link novo é digitado aqui (pode ficar em branco). */
  askUrl?: boolean;
  busy: boolean;
  onSubmit: (label: string, kind: Kind, url?: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [newUrl, setNewUrl] = useState("");
  return (
    <InlineForm
      busy={busy}
      onCancel={onCancel}
      onSubmit={() => (askUrl ? onSubmit(label, kind, newUrl) : onSubmit(label, kind))}
      submitLabel="Criar e ligar"
      canSubmit={!!label.trim()}
      hint={
        askUrl
          ? "Estes botões já ficam ligados ao link novo. O endereço pode ficar em branco e ser preenchido depois."
          : `O link da oferta nasce com o endereço ${url} e estes elementos já ficam ligados a ele.`
      }
    >
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Nome do link (ex.: Checkout principal)"
        aria-label="Nome do link"
        className="h-8 min-w-44 flex-1"
        maxLength={60}
        autoFocus
      />
      <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <SelectTrigger size="sm" className="w-44" aria-label="Tipo do link">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <SelectItem key={k} value={k}>
              {KIND_LABEL[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {askUrl && (
        <Input
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="https://pay.hotmart.com/SEU_PRODUTO"
          aria-label="Endereço do link"
          inputMode="url"
          className="h-8 w-full font-mono text-xs"
          maxLength={2000}
        />
      )}
    </InlineForm>
  );
}
