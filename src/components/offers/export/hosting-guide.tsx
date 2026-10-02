"use client";

import { ChevronDownIcon, UploadIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EVENTOS_CONFIG_DIR } from "@/lib/export/php";
import { EVENTS_FILE } from "./logic";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="font-medium text-foreground">{title}</h4>
      {children}
    </section>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</code>
);

/**
 * O Safari (o navegador padrão do Mac, onde o Offer Studio abre) descompacta o
 * ZIP sozinho e manda o .zip para a Lixeira; compactar a pasta de novo põe uma
 * pasta a mais no ZIP. Usado no passo a passo e no aviso do "ZIP pronto" no Safari.
 */
export function SafariZipTip() {
  return (
    <>
      <p>
        O Safari pode abrir o ZIP sozinho: se em <strong>Downloads</strong> aparecer uma pasta em vez do arquivo{" "}
        <Code>.zip</Code>, pegue o .zip na <strong>Lixeira</strong>. Para não acontecer de novo: Safari →{" "}
        <strong>Ajustes</strong> → <strong>Geral</strong> → desmarque “Abrir arquivos ‘seguros’ após o download”.
      </p>
      <p>
        Não compacte a pasta de novo: o ZIP ficaria com uma pasta a mais e a página iria para
        seudominio.com.br/nome-da-pasta/.
      </p>
    </>
  );
}

/**
 * "Como subir na hospedagem": o ZIP baixado pelo Safari, passo a passo para a
 * Hostinger (hPanel) e a HostGator/cPanel com os nomes dos botões de cada
 * painel, conferência, atualização, subpasta, hospedagens sem PHP e como
 * testar depois de subir.
 * (O mesmo texto do LEIA-ME.txt, src/lib/export/readme.ts.)
 */
export function HostingGuide({
  open,
  onOpenChange,
  preserveJsPages = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Páginas no modo "Preservar JS" (só funcionam na raiz do domínio). */
  preserveJsPages?: string[];
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-lg border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left font-medium text-sm outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <UploadIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        Como subir na hospedagem
        <ChevronDownIcon
          className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 border-t px-4 py-4 text-muted-foreground text-sm leading-relaxed [&_strong]:text-foreground">
        <Section title="Baixou pelo Safari?">
          <SafariZipTip />
        </Section>

        <Section title="Hostinger (hPanel)">
          <ol className="ml-5 list-decimal space-y-1">
            <li>
              No hPanel, abra o <strong>Gerenciador de arquivos</strong> e entre na pasta <strong>public_html</strong>{" "}
              (é a raiz do seu domínio). Se nela houver um arquivo padrão da hospedagem (<Code>default.php</Code> ou{" "}
              <Code>index.php</Code>), apague: ele aparece no lugar da sua página.
            </li>
            <li>
              Clique no ícone <strong>Fazer upload de arquivos</strong> e escolha o ZIP que você baixou.
            </li>
            <li>
              Clique no ZIP com o botão direito e escolha <strong>Extrair</strong>. Deixe o nome da pasta em branco (ou{" "}
              <Code>.</Code>) e o destino como <strong>public_html</strong> — se escrever um nome, a página vai parar em
              seudominio.com.br/esse-nome/.
            </li>
          </ol>
        </Section>

        <Section title="HostGator, Locaweb e outras com cPanel">
          <ol className="ml-5 list-decimal space-y-1">
            <li>
              No cPanel, abra o <strong>Gerenciador de arquivos</strong> e entre na pasta <strong>public_html</strong>.
              Apague o <Code>default.php</Code> ou <Code>index.php</Code> da hospedagem, se houver.
            </li>
            <li>
              Clique em <strong>Carregar</strong> e escolha o ZIP que você baixou.
            </li>
            <li>
              Volte para a pasta, clique no ZIP com o botão direito e escolha <strong>Extrair</strong>, mantendo a pasta{" "}
              <strong>public_html</strong> como destino.
            </li>
          </ol>
        </Section>

        <Section title="Nas duas">
          <ul className="ml-5 list-disc space-y-1">
            <li>
              Confira que o <Code>index.html</Code> ficou <strong>direto</strong> em public_html (e não dentro de outra
              pasta com o nome do ZIP). Pronto: a página inicial abre em <strong>seudominio.com.br</strong>.
            </li>
            <li>
              Depois, apague de lá o arquivo .zip e o <Code>LEIA-ME.txt</Code> (ele lista as pastas da oferta e não
              precisa ficar no ar).
            </li>
            <li>
              Mudou algo? Gere um ZIP novo e extraia por cima, substituindo os arquivos (na Hostinger, marque{" "}
              <strong>Sobrescrever arquivos existentes</strong>). Se a hospedagem não deixar substituir, apague os
              arquivos antigos da oferta antes.
            </li>
          </ul>
        </Section>

        <Section title="Numa subpasta (ex.: seudominio.com.br/oferta/)">
          <p>
            Crie a pasta dentro de <strong>public_html</strong>, entre nela e envie e extraia o ZIP lá dentro. Os
            endereços do ZIP são relativos, então tudo funciona em qualquer pasta. Nos anúncios, use o endereço{" "}
            <strong>com a barra no fim</strong> (seudominio.com.br/oferta/): algumas hospedagens não completam a barra
            sozinhas e a página demora mais para abrir.
          </p>
          {preserveJsPages.length > 0 && (
            <p>
              Exceção: {preserveJsPages.length === 1 ? "a página" : "as páginas"}{" "}
              <strong>{preserveJsPages.join(", ")}</strong> (modo Preservar JS) só{" "}
              {preserveJsPages.length === 1 ? "funciona" : "funcionam"} na raiz do domínio.
            </p>
          )}
        </Section>

        <Section title="Netlify, Cloudflare Pages e outras sem PHP">
          <p>
            Extraia o ZIP no computador e envie a pasta: na Netlify, arraste para <strong>Deploy manually</strong>; na
            Cloudflare Pages, use <strong>Upload assets</strong>. Nessas hospedagens, deixe a opção do{" "}
            <Code>{EVENTS_FILE}</Code> desligada (sem PHP, o arquivo com o seu token ficaria visível).
          </p>
        </Section>

        <Section title="Depois de subir, teste">
          <ul className="ml-5 list-disc space-y-1">
            <li>
              Abra a página com <Code>?utm_source=teste</Code> no fim do endereço e clique no botão de compra: o link do
              checkout deve levar o <Code>utm_source=teste</Code>.
            </li>
            <li>
              Instale a extensão <strong>Meta Pixel Helper</strong> no Chrome e abra a página: ela mostra se o pixel
              disparou. Se aparecer o aviso de cookies, aceite antes de conferir.
            </li>
            <li>
              Se incluiu o <Code>{EVENTS_FILE}</Code>, abra <strong>seudominio.com.br/{EVENTS_FILE}</strong>: deve
              aparecer uma mensagem dizendo se ele está funcionando. Se o navegador baixar o arquivo ou mostrar o
              código, a hospedagem não tem PHP: apague na hora o <Code>{EVENTS_FILE}</Code> e a pasta{" "}
              <Code>{EVENTOS_CONFIG_DIR}</Code> (ela guarda o seu token).
            </li>
          </ul>
        </Section>
      </CollapsibleContent>
    </Collapsible>
  );
}
