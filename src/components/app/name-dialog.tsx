"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel: string;
  maxLength?: number;
  pending?: boolean;
  error?: string | null;
  onSubmit: (value: string) => void;
}

/** Diálogo simples de um campo: criar/renomear pasta, oferta, tag… */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  submitLabel,
  maxLength = 120,
  pending,
  error,
  onSubmit,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [localError, setLocalError] = useState<string | null>(null);
  // Ao abrir para renomear, o nome vem selecionado (digitar já substitui).
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setLocalError(null);
    }
  }, [open, initialValue]);

  const shownError = localError ?? error ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const input = inputRef.current;
          input?.focus();
          // Depois do valor inicial entrar no campo.
          requestAnimationFrame(() => {
            if (document.activeElement === input) input?.select();
          });
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = value.trim();
            if (!trimmed) {
              setLocalError(`Preencha o campo "${label}".`);
              return;
            }
            onSubmit(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Field className="my-5" data-invalid={Boolean(shownError)}>
            <FieldLabel htmlFor="name-dialog-input">{label}</FieldLabel>
            <Input
              id="name-dialog-input"
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              aria-invalid={Boolean(shownError)}
              onChange={(e) => {
                setValue(e.target.value);
                setLocalError(null);
              }}
              ref={inputRef}
            />
            <FieldError>{shownError}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
