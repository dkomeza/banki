import type { ReactNode } from "react";
import { Wordmark } from "@/components/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** A full-screen page outside the shell, headed by the logo: sign-in, Setup and errors. */
export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 pt-[max(2rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
      <Wordmark />
      {children}
    </main>
  );
}

/** The centred card the Setup and sign-in pages put their form in. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <FullScreen>
      <Card className="w-full max-w-sm shadow-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-lg font-semibold tracking-tight">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </FullScreen>
  );
}

/** A form error, announced to screen readers. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-destructive" role="alert">
      {children}
    </p>
  );
}
