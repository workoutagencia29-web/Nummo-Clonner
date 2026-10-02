"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient, safeAuthCall } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/errors-client";
import { ForgotPassword } from "./forgot-password";

type Errors = Partial<Record<"name" | "email" | "password" | "confirm" | "form", string>>;

export function AuthForm({
  mode,
  next,
  defaultEmail,
  notice,
}: {
  mode: "signin" | "signup";
  next: string;
  /** E-mail já preenchido (ex.: a conta que veio no backup restaurado). */
  defaultEmail?: string;
  /** Aviso de sucesso acima do formulário (ex.: "Backup restaurado"). */
  notice?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const isSignup = mode === "signup";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    const found: Errors = {};
    if (isSignup && !name) found.name = "Digite seu nome.";
    if (!/^\S+@\S+\.\S+$/.test(email)) found.email = "Digite um e-mail válido.";
    if (password.length < 8) found.password = "A senha precisa ter pelo menos 8 caracteres.";
    if (isSignup && password !== confirm) found.confirm = "As senhas não são iguais.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setPending(true);
    const { error } = await safeAuthCall(() =>
      isSignup
        ? authClient.signUp.email({ name, email, password })
        : authClient.signIn.email({ email, password, rememberMe: true }),
    );
    if (error) {
      setPending(false);
      setErrors({ form: authErrorMessage(error) });
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <Card className="shadow-lg shadow-primary/5">
      <CardHeader>
        <CardTitle className="text-xl">{isSignup ? "Crie seu acesso" : "Entrar"}</CardTitle>
        <CardDescription>
          {isSignup
            ? "Primeiro acesso: defina o e-mail e a senha que vão proteger o seu Offer Studio."
            : "Use o e-mail e a senha que você cadastrou."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {notice && (
          <output className="mb-4 block rounded-md bg-success/10 px-3 py-2 text-sm text-success">{notice}</output>
        )}
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {isSignup && (
              <Field data-invalid={Boolean(errors.name)}>
                <FieldLabel htmlFor="name">Seu nome</FieldLabel>
                <Input id="name" name="name" autoComplete="name" aria-invalid={Boolean(errors.name)} autoFocus />
                <FieldError>{errors.name}</FieldError>
              </Field>
            )}
            <Field data-invalid={Boolean(errors.email)}>
              <FieldLabel htmlFor="email">E-mail</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                autoFocus={!isSignup && !defaultEmail}
                defaultValue={defaultEmail}
              />
              <FieldError>{errors.email}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.password)}>
              {isSignup ? (
                <FieldLabel htmlFor="password">Senha</FieldLabel>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="password">Senha</FieldLabel>
                  <ForgotPassword />
                </div>
              )}
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                aria-invalid={Boolean(errors.password)}
                autoFocus={!isSignup && Boolean(defaultEmail)}
              />
              <FieldError>{errors.password}</FieldError>
            </Field>
            {isSignup && (
              <Field data-invalid={Boolean(errors.confirm)}>
                <FieldLabel htmlFor="confirm">Confirme a senha</FieldLabel>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={Boolean(errors.confirm)}
                />
                <FieldError>{errors.confirm}</FieldError>
              </Field>
            )}
            {errors.form && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errors.form}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending && <Spinner />}
              {isSignup ? "Criar acesso e entrar" : "Entrar"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
