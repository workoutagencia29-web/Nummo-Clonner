"use client";

import { FileArchiveIcon, FileCode2Icon, LinkIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { startHtmlCloneAction, startUrlCloneAction } from "@/server/actions/clone";
import { SAFARI_SAVE_NOTE, SAVE_PAGE_STEPS } from "./import-steps";

type DeviceKey = "desktop" | "mobile";
export type CloneTab = "link" | "zip" | "html";

/**
 * Limite do HTML colado (mesmo valor de startHtmlCloneAction). Conferido aqui,
 * antes do envio: um corpo grande demais seria cortado no caminho e a ação
 * falharia sem explicar o motivo.
 */
const HTML_MAX_BYTES = 10 * 1024 * 1024;
const HTML_TOO_BIG = "O HTML pode ter no máximo 10 MB. Para páginas maiores, use o ZIP.";

function DeviceOptions({
  devices,
  onChange,
  maxVideoMb,
  onVideoChange,
}: {
  devices: DeviceKey[];
  onChange: (d: DeviceKey[]) => void;
  maxVideoMb?: number;
  onVideoChange?: (mb: number) => void;
}) {
  const toggle = (d: DeviceKey, on: boolean) =>
    onChange(on ? [...new Set([...devices, d])] : devices.filter((x) => x !== d));
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <span className="text-sm font-medium">Capturar:</span>
      {(
        [
          ["desktop", "Computador"],
          ["mobile", "Celular"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="flex items-center gap-2">
          <Checkbox
            id={`dev-${key}`}
            checked={devices.includes(key)}
            onCheckedChange={(v) => toggle(key, v === true)}
          />
          <Label htmlFor={`dev-${key}`} className="font-normal">
            {label}
          </Label>
        </div>
      ))}
      {onVideoChange && (
        <div className="flex items-center gap-2">
          <Label htmlFor="max-video" className="font-normal text-muted-foreground">
            Vídeos até
          </Label>
          <Select value={String(maxVideoMb)} onValueChange={(v) => onVideoChange(Number(v))}>
            <SelectTrigger id="max-video" size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Não baixar</SelectItem>
              <SelectItem value="50">50 MB</SelectItem>
              <SelectItem value="200">200 MB</SelectItem>
              <SelectItem value="500">500 MB</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function CloneStartForm({ initialTab = "link" }: { initialTab?: CloneTab }) {
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceKey[]>(["desktop", "mobile"]);
  const [maxVideoMb, setMaxVideoMb] = useState(200);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const startUrl = useAction(startUrlCloneAction);
  const startHtml = useAction(startHtmlCloneAction);

  const noDevice = devices.length === 0 ? "Escolha o que capturar: computador, celular ou os dois." : null;

  function goTo(id: string) {
    router.push(`/clonar/${id}`);
  }

  function submitUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return setUrlError("Cole o link da página que você quer clonar.");
    if (noDevice) return setUrlError(noDevice);
    void startUrl.run(
      { url, devices, maxVideoMb },
      { silentError: true, onError: setUrlError, onSuccess: (job) => goTo(job.id) },
    );
  }

  function submitHtml(e: React.FormEvent) {
    e.preventDefault();
    if (!html.trim()) return setHtmlError("Cole o código HTML da página.");
    if (new Blob([html]).size > HTML_MAX_BYTES) return setHtmlError(HTML_TOO_BIG);
    if (noDevice) return setHtmlError(noDevice);
    void startHtml.run(
      { html, baseUrl: baseUrl || null, devices, maxVideoMb },
      { silentError: true, onError: setHtmlError, onSuccess: (job) => goTo(job.id) },
    );
  }

  function pickZip(file: File | undefined | null) {
    setZipError(null);
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) return setZipError("Escolha um arquivo .zip.");
    if (file.size > 200 * 1024 * 1024) return setZipError("O ZIP pode ter no máximo 200 MB.");
    setZip(file);
  }

  function submitZip(e: React.FormEvent) {
    e.preventDefault();
    if (!zip) return setZipError("Escolha o arquivo .zip da página.");
    if (noDevice) return setZipError(noDevice);
    // XMLHttpRequest para mostrar o progresso do envio.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/clone/zip");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(zip.name));
    xhr.setRequestHeader("X-Devices", devices.join(","));
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setUploading(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => {
      setUploading(null);
      try {
        const body = JSON.parse(xhr.responseText) as { id?: string; error?: string };
        if (xhr.status === 200 && body.id) goTo(body.id);
        else setZipError(body.error ?? "Não foi possível enviar o ZIP.");
      } catch {
        setZipError("Não foi possível enviar o ZIP.");
      }
    };
    xhr.onerror = () => {
      setUploading(null);
      toast.error("O envio falhou. O Offer Studio ainda está aberto?");
    };
    setUploading(0);
    xhr.send(zip);
  }

  return (
    <Card>
      <CardContent>
        <Tabs defaultValue={initialTab}>
          <TabsList className="mb-5">
            <TabsTrigger value="link">
              <LinkIcon />
              Link
            </TabsTrigger>
            <TabsTrigger value="zip">
              <FileArchiveIcon />
              Arquivo ZIP
            </TabsTrigger>
            <TabsTrigger value="html">
              <FileCode2Icon />
              Colar HTML
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link">
            <form onSubmit={submitUrl} noValidate>
              <FieldGroup>
                <Field data-invalid={Boolean(urlError)}>
                  <FieldLabel htmlFor="clone-url">Link da página</FieldLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="clone-url"
                      type="url"
                      inputMode="url"
                      placeholder="https://exemplo.com.br/oferta"
                      value={url}
                      aria-invalid={Boolean(urlError)}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setUrlError(null);
                      }}
                      autoFocus={initialTab === "link"}
                    />
                    <Button type="submit" disabled={startUrl.pending} className="sm:w-40">
                      {startUrl.pending && <Spinner />}
                      Clonar página
                    </Button>
                  </div>
                  <FieldError>{urlError}</FieldError>
                </Field>
                <DeviceOptions
                  devices={devices}
                  onChange={setDevices}
                  maxVideoMb={maxVideoMb}
                  onVideoChange={setMaxVideoMb}
                />
              </FieldGroup>
            </form>
          </TabsContent>

          <TabsContent value="zip">
            <form onSubmit={submitZip} noValidate>
              <FieldGroup>
                <Field data-invalid={Boolean(zipError)}>
                  <FieldLabel htmlFor="clone-zip">Arquivo .zip da página</FieldLabel>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      pickZip(e.dataTransfer.files[0]);
                    }}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition-colors",
                      dragOver ? "border-primary bg-primary/5" : "border-input hover:bg-muted/50",
                    )}
                  >
                    <UploadIcon className="size-6 text-muted-foreground" />
                    {zip ? (
                      <span className="font-medium">
                        {zip.name} ({formatBytes(zip.size)})
                      </span>
                    ) : (
                      <span>
                        <span className="font-medium text-primary">Escolha o arquivo</span> ou arraste aqui
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">Até 200 MB</span>
                  </button>
                  <input
                    ref={fileInput}
                    id="clone-zip"
                    type="file"
                    accept=".zip,application/zip"
                    className="sr-only"
                    onChange={(e) => pickZip(e.target.files?.[0])}
                  />
                  <FieldDescription>
                    Use para páginas protegidas. {SAVE_PAGE_STEPS} aqui. {SAFARI_SAVE_NOTE}
                  </FieldDescription>
                  <FieldError>{zipError}</FieldError>
                </Field>
                <DeviceOptions devices={devices} onChange={setDevices} />
                <div>
                  <Button type="submit" disabled={uploading !== null}>
                    {uploading !== null && <Spinner />}
                    {uploading !== null ? `Enviando… ${uploading}%` : "Importar ZIP"}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </TabsContent>

          <TabsContent value="html">
            <form onSubmit={submitHtml} noValidate>
              <FieldGroup>
                <Field data-invalid={Boolean(htmlError)}>
                  <FieldLabel htmlFor="clone-html">Código HTML</FieldLabel>
                  <Textarea
                    id="clone-html"
                    rows={10}
                    className="font-mono text-xs"
                    placeholder="<!doctype html>…"
                    value={html}
                    aria-invalid={Boolean(htmlError)}
                    onChange={(e) => {
                      setHtml(e.target.value);
                      setHtmlError(null);
                    }}
                  />
                  <FieldError>{htmlError}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="clone-base">Link de origem (opcional)</FieldLabel>
                  <Input
                    id="clone-base"
                    type="url"
                    placeholder="https://exemplo.com.br/oferta"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                  <FieldDescription>
                    Informe o endereço de onde o HTML veio para baixarmos as imagens e o CSS com caminhos relativos.
                  </FieldDescription>
                </Field>
                <DeviceOptions devices={devices} onChange={setDevices} />
                <div>
                  <Button type="submit" disabled={startHtml.pending}>
                    {startHtml.pending && <Spinner />}
                    Importar HTML
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
