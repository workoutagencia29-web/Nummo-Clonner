"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient, safeAuthCall } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/errors-client";

export function AccountForm({ name: initialName, email: initialEmail }: { name: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [pending, setPending] = useState(false);
  const dirty = name.trim() !== initialName || email.trim().toLowerCase() !== initialEmail.toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: typeof errors = {};
    if (!name.trim()) found.name = "Digite seu nome.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) found.email = "Digite um e-mail válido.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setPending(true);
    try {
      if (name.trim() !== initialName) {
        const { error } = await safeAuthCall(() => authClient.updateUser({ name: name.trim() }));
        if (error) throw new Error(authErrorMessage(error));
      }
      if (email.trim().toLowerCase() !== initialEmail.toLowerCase()) {
        const { error } = await safeAuthCall(() => authClient.changeEmail({ newEmail: email.trim() }));
        if (error) {
          setErrors({ email: authErrorMessage(error) });
          return;
        }
      }
      toast.success("Conta atualizada.");
      router.refresh();
    } catch (err) {
      // As mensagens lançadas acima já vêm de authErrorMessage (português).
      toast.error(err instanceof Error && err.message ? err.message : "Não foi possível salvar. Tente de novo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup className="max-w-md">
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="account-name">Nome</FieldLabel>
          <Input
            id="account-name"
            value={name}
            maxLength={80}
            aria-invalid={Boolean(errors.name)}
            onChange={(e) => setName(e.target.value)}
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="account-email">E-mail</FieldLabel>
          <Input
            id="account-email"
            type="email"
            value={email}
            aria-invalid={Boolean(errors.email)}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FieldError>{errors.email}</FieldError>
        </Field>
        <div>
          <Button type="submit" disabled={pending || !dirty}>
            {pending && <Spinner />}
            Salvar conta
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: typeof errors = {};
    if (!current) found.current = "Digite sua senha atual.";
    if (next.length < 8) found.next = "A nova senha precisa ter pelo menos 8 caracteres.";
    if (next !== confirm) found.confirm = "As senhas não são iguais.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setPending(true);
    const { error } = await safeAuthCall(() =>
      authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      }),
    );
    setPending(false);
    if (error) {
      const msg = authErrorMessage(error);
      setErrors(error.code === "INVALID_PASSWORD" ? { current: msg } : { next: msg });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success("Senha alterada.");
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup className="max-w-md">
        <Field data-invalid={Boolean(errors.current)}>
          <FieldLabel htmlFor="pw-current">Senha atual</FieldLabel>
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            aria-invalid={Boolean(errors.current)}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <FieldError>{errors.current}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.next)}>
          <FieldLabel htmlFor="pw-next">Nova senha</FieldLabel>
          <Input
            id="pw-next"
            type="password"
            autoComplete="new-password"
            value={next}
            aria-invalid={Boolean(errors.next)}
            onChange={(e) => setNext(e.target.value)}
          />
          <FieldError>{errors.next}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.confirm)}>
          <FieldLabel htmlFor="pw-confirm">Confirme a nova senha</FieldLabel>
          <Input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            aria-invalid={Boolean(errors.confirm)}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <FieldError>{errors.confirm}</FieldError>
        </Field>
        <div>
          <Button type="submit" disabled={pending || !current || !next}>
            {pending && <Spinner />}
            Trocar senha
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
