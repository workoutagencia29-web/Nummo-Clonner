"use client";

import type { Editor } from "grapesjs";
import { FilePlus2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { plural } from "@/lib/format";
import { freePageNames, LINK_LATER, PAGE_NAME_MAX, PRODUCT_PAGES_MAX } from "@/lib/product-pages";
import { createProductPagesAction } from "@/server/actions/store";
import type { EditorPayload } from "@/server/services/documents";
import { linkOptionLabel } from "../grapes/components";
import { focusSettings, guardDeleteKeys } from "../grapes/delete-keys";
import type { ProductPagesRequest } from "../grapes/product-pages";
import { linkProductPage, type ProductPagePlanItem, productPagePlan } from "../widgets/products";
import { storeHeaderCopy } from "../widgets/store-header";

interface Row {
  item: ProductPagePlanItem;
  /** Nome da página nova (só para quem vai ganhar uma). */
  pageName: string;
  /** Chave do link da oferta do "Comprar agora", ou LINK_LATER. */
  link: string;
}

/** Página a que os cartões de um produto passaram a levar (criada agora ou que já existia). */
export interface ProductPageResult {
  id: string;
  name: string;
  /** Documento que abre no editor (null = a página não tem). */
  documentId: string | null;
  /** Criada agora (false = o produto já tinha esta página). */
  created: boolean;
  /** Cartões ligados a ela (o do pedido e os iguais nas outras vitrines da página). */
  cards: number;
}

interface Props {
  editor: Editor;
  payload: EditorPayload;
  request: ProductPagesRequest | null;
  onClose: () => void;
  /** Páginas criadas (ou já existentes) e cartões já ligados a elas (na ordem do pedido). */
  onCreated: (request: ProductPagesRequest, pages: ProductPageResult[]) => void;
}

/** Lista "Botão “Comprar agora” leva para": os links da oferta e "— escolher depois —". */
function LinkSelect({
  payload,
  value,
  onChange,
  id,
  label,
  placeholder,
}: {
  payload: EditorPayload;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={LINK_LATER}>— escolher depois —</SelectItem>
        {payload.links.map((l) => (
          <SelectItem key={l.key} value={l.key}>
            {linkOptionLabel(l)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "e os outros 3 cartões dele na página" (cartões iguais em outras vitrines). */
const extraText = (n: number) =>
  n === 1 ? "o outro cartão dele nesta página" : `os outros ${n} cartões dele nesta página`;

/**
 * Cria a página de um produto da vitrine (cartão) ou as páginas de todos os
 * produtos que ainda não levam a lugar nenhum (vitrine), no modelo "Página do
 * produto", e liga cada cartão à página dele. Uma página por produto: o mesmo
 * produto em outras vitrines da página vai junto, e o produto que já tem página
 * (de outra vitrine, do layout do celular, de outra versão) é ligado a ela, sem
 * criar outra. O cabeçalho de loja desta página vai junto, e o logo e o
 * "‹ Voltar para a loja" levam de volta a ela.
 */
export function ProductPageDialog({ editor, payload, request, onClose, onCreated }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  /** Produtos sem página além do limite de uma vez (ficam para a próxima). */
  const [left, setLeft] = useState(0);
  /** Um produto que já tem página: usar ela (true) ou criar outra (false). */
  const [reuse, setReuse] = useState(true);
  /** A página tem cabeçalho de loja (ele vai junto para as páginas novas). */
  const [withHeader, setWithHeader] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const create = useAction(createProductPagesAction);
  const batch = Boolean(request?.widget);

  useEffect(() => {
    if (!request) return;
    const plan = productPagePlan(editor, request.cards, { pages: payload.pages, known: payload.storeProducts });
    // Só os produtos com nome ganham página (os sem nome aparecem, com o aviso); até PRODUCT_PAGES_MAX de uma vez.
    const fresh = plan.filter((item) => item.key && !item.existing);
    const now = new Set(fresh.slice(0, PRODUCT_PAGES_MAX));
    // Um produto só, que já tem página: o "criar outra" também precisa de um nome.
    const named = batch ? [...now] : plan.filter((item) => item.key);
    const names = freePageNames(
      named.map((item) => item.info.name),
      payload.pages.map((p) => p.name),
    );
    const keys = new Set(payload.links.map((l) => l.key));
    setRows(
      plan
        .filter((item) => !item.key || item.existing || now.has(item))
        .map((item) => {
          const at = named.indexOf(item);
          return {
            item,
            pageName: at >= 0 ? names[at] : "",
            // Cartão já ligado a um link da oferta (ainda sem endereço): o "Comprar agora" nasce nele.
            link: item.info.linkKey && keys.has(item.info.linkKey) ? item.info.linkKey : LINK_LATER,
          };
        }),
    );
    setLeft(fresh.length - now.size);
    setReuse(true);
    setWithHeader(Boolean(editor.getWrapper()?.find('[data-os-widget="store-header"]').length));
    setError(null);
  }, [request, editor, batch, payload.pages, payload.links, payload.storeProducts]);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row, at) => (at === i ? { ...row, ...patch } : row)));

  const single = rows[0];
  /** Ganha página nova agora. */
  const creates = (row: Row) => Boolean(row.item.key) && (!row.item.existing || (!batch && !reuse));
  /** Só passa a levar à página que já tem. */
  const links = (row: Row) => Boolean(row.item.existing) && (batch || reuse);
  const toCreate = rows.filter(creates);
  const toLink = rows.filter(links);
  const nameless = rows.filter((row) => !row.item.key);
  const sameLink = toCreate.length && toCreate.every((r) => r.link === toCreate[0].link) ? toCreate[0].link : "";
  const extra = rows.reduce((n, row) => n + (creates(row) || links(row) ? row.item.extra : 0), 0);

  // Backspace/Delete num botão do diálogo não apagam o elemento selecionado no editor.
  const unguard = useRef<(() => void) | null>(null);
  const contentRef = useCallback((el: HTMLDivElement | null) => {
    unguard.current?.();
    unguard.current = el ? guardDeleteKeys(el) : null;
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!request || (!toCreate.length && !toLink.length)) return;
    let created: { id: string; name: string; documentId: string }[] = [];
    if (toCreate.length) {
      const res = await create.run(
        {
          offerId: payload.offer.id,
          storePageId: payload.page.id,
          header: storeHeaderCopy(editor),
          products: toCreate.map((row) => ({
            pageName: row.pageName,
            name: row.item.info.name,
            photo: row.item.info.photo,
            data: row.item.info.data,
            currency: row.item.info.currency,
            lang: row.item.info.lang,
            linkKey: row.link === LINK_LATER ? null : row.link,
          })),
        },
        { silentError: true },
      );
      if (!res.ok) {
        setError({ message: res.error, field: res.field });
        return;
      }
      created = res.data;
      for (const page of res.data) {
        payload.pages.push({
          id: page.id,
          name: page.name,
          slug: page.slug,
          type: page.type,
          isHome: page.isHome,
          documentId: page.documentId,
        });
      }
    }
    // Liga os cartões (tudo de uma vez: um passo só no Desfazer).
    const results: ProductPageResult[] = [];
    toCreate.forEach((row, i) => {
      const page = created[i];
      if (!page) return;
      for (const card of row.item.cards) linkProductPage(card, page.id);
      // Desligada pelo Desfazer, a página volta a ser achada (e não vira "Nome 2").
      if (!payload.storeProducts) payload.storeProducts = [];
      payload.storeProducts.push({ pageId: page.id, name: row.item.info.name });
      results.push({
        id: page.id,
        name: page.name,
        documentId: page.documentId,
        created: true,
        cards: row.item.cards.length,
      });
    });
    for (const row of toLink) {
      const page = row.item.existing;
      if (!page) continue;
      for (const card of row.item.cards) linkProductPage(card, page.id);
      const documentId = payload.pages.find((p) => p.id === page.id)?.documentId ?? null;
      results.push({ id: page.id, name: page.name, documentId, created: false, cards: row.item.cards.length });
    }
    onCreated(request, results);
    onClose();
  }

  const reusable = !batch && single?.item.existing && single.item.key ? single.item.existing : null;
  const submitText = toCreate.length
    ? batch
      ? `Criar ${plural(toCreate.length, "página", "páginas")}`
      : "Criar página"
    : batch
      ? `Ligar ${plural(toLink.length, "produto", "produtos")}`
      : "Ligar à página";

  return (
    <Dialog open={request !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        ref={contentRef}
        className={batch ? "sm:max-w-xl" : "sm:max-w-md"}
        // O botão que abriu o diálogo some (as Configurações são refeitas): o foco volta
        // para as Configurações, nunca para o <body> (lá o Delete apagaria o cartão).
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusSettings(batch ? undefined : "os-page");
        }}
      >
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FilePlus2Icon className="size-4" />
              {batch ? "Criar as páginas que faltam" : "Nova página do produto"}
            </DialogTitle>
            <DialogDescription>
              {batch
                ? "Uma página para cada produto desta vitrine que ainda não leva a lugar nenhum, no modelo “Página do produto”, com a foto, o nome e o preço de cada um. Cada produto passa a levar à página dele; o que já tem página passa a levar a ela."
                : "Uma página no modelo “Página do produto”, com a foto, o nome e o preço deste produto. O produto passa a levar a ela."}{" "}
              {withHeader
                ? "O cabeçalho de loja desta página vai junto, e o logo e o “‹ Voltar para a loja” levam de volta para cá."
                : "O logo e o “‹ Voltar para a loja” levam de volta para cá."}
            </DialogDescription>
          </DialogHeader>

          {!batch && single && !single.item.key && (
            <p className="my-4 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
              Este produto está sem nome: escreva o nome dele no cartão (dois cliques no nome) e tente de novo.
            </p>
          )}

          {!batch && single && single.item.key && (
            <FieldGroup className="my-4">
              {reusable && (
                <RadioGroup
                  value={reuse ? "usar" : "criar"}
                  onValueChange={(v) => setReuse(v === "usar")}
                  aria-label="Página deste produto"
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="usar" id="pagina-produto-usar" className="mt-0.5" />
                    <Label htmlFor="pagina-produto-usar" className="font-normal leading-snug">
                      Usar a página “{reusable.name}”, que já é deste produto
                    </Label>
                  </div>
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="criar" id="pagina-produto-criar" className="mt-0.5" />
                    <Label htmlFor="pagina-produto-criar" className="font-normal leading-snug">
                      Criar outra página
                    </Label>
                  </div>
                </RadioGroup>
              )}
              {(!reusable || !reuse) && (
                <>
                  <Field>
                    <FieldLabel htmlFor="pagina-produto-nome">Nome da página</FieldLabel>
                    <Input
                      id="pagina-produto-nome"
                      value={single.pageName}
                      onChange={(e) => setRow(0, { pageName: e.target.value })}
                      maxLength={PAGE_NAME_MAX}
                      autoFocus={!reusable}
                      aria-invalid={error?.field?.endsWith("pageName")}
                    />
                    <FieldDescription>É o nome na lista de páginas da oferta (e o endereço sai dele).</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="pagina-produto-link">Botão “Comprar agora” leva para</FieldLabel>
                    <LinkSelect
                      id="pagina-produto-link"
                      payload={payload}
                      value={single.link}
                      onChange={(link) => setRow(0, { link })}
                    />
                    <FieldDescription>
                      O carrinho do cabeçalho vai para o mesmo lugar. Sem link agora, a página avisa até você escolher.
                    </FieldDescription>
                  </Field>
                </>
              )}
              {single.item.extra > 0 && (
                <p className="text-xs text-muted-foreground">
                  O mesmo produto aparece em outras vitrines desta página: {extraText(single.item.extra)} também passa
                  {single.item.extra === 1 ? "" : "m"} a levar à página.
                </p>
              )}
            </FieldGroup>
          )}

          {batch && (
            <div className="my-4 flex flex-col gap-3">
              {left > 0 && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
                  Dá para criar até {PRODUCT_PAGES_MAX} páginas de uma vez: as dos primeiros {PRODUCT_PAGES_MAX}{" "}
                  produtos agora, as outras depois (o botão continua na vitrine).
                </p>
              )}
              {toCreate.length > 1 && payload.links.length > 0 && (
                <Field>
                  <FieldLabel htmlFor="pagina-produto-todos">Botão “Comprar agora” de todos leva para</FieldLabel>
                  <LinkSelect
                    id="pagina-produto-todos"
                    payload={payload}
                    value={sameLink}
                    placeholder="Destinos diferentes"
                    onChange={(link) => setRows((prev) => prev.map((row) => (creates(row) ? { ...row, link } : row)))}
                  />
                </Field>
              )}
              <ul className="flex max-h-[45vh] flex-col divide-y overflow-y-auto rounded-md border">
                {rows.map((row, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: a lista não muda de ordem enquanto o diálogo está aberto
                    key={i}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    {row.item.info.photo ? (
                      // biome-ignore lint/performance/noImgElement: foto do cartão (data: ou arquivo local), só uma miniatura
                      <img
                        src={row.item.info.photo}
                        alt=""
                        className="size-10 shrink-0 rounded border object-contain"
                      />
                    ) : (
                      <span className="size-10 shrink-0 rounded border bg-muted" />
                    )}
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate" title={row.item.info.name}>
                        {row.item.info.name || "Produto sem nome"}
                      </span>
                      {row.item.cards.length > 1 && (
                        <span className="block text-xs text-muted-foreground">
                          {plural(row.item.cards.length, "cartão", "cartões")} nesta página
                        </span>
                      )}
                    </span>
                    {row.item.existing ? (
                      <span className="w-44 shrink-0 text-xs text-muted-foreground">
                        Já tem a página “{row.item.existing.name}”: passa a levar a ela
                      </span>
                    ) : !row.item.key ? (
                      <span className="w-44 shrink-0 text-xs text-warning-foreground dark:text-warning">
                        Sem nome: escreva o nome no cartão para criar a página dele
                      </span>
                    ) : (
                      <div className="w-44 shrink-0">
                        <LinkSelect
                          payload={payload}
                          label={`Botão “Comprar agora” de ${row.item.info.name}`}
                          value={row.link}
                          onChange={(link) => setRow(i, { link })}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Uma página por produto: o mesmo produto em outras vitrines desta página passa a levar à mesma página
                {extra > 0 ? ` (${plural(extra, "cartão a mais", "cartões a mais")})` : ""}. As páginas recebem o nome
                do produto; o carrinho do cabeçalho de cada uma vai para o mesmo lugar do “Comprar agora”; sem link
                agora, a página avisa até você escolher.
                {nameless.length > 0 &&
                  ` ${nameless.length === 1 ? "O produto sem nome fica" : "Os produtos sem nome ficam"} de fora.`}
              </p>
            </div>
          )}

          {error && <FieldError className="mb-3">{error.message}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.pending || (!toCreate.length && !toLink.length)}>
              {create.pending && <Spinner />}
              {submitText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
