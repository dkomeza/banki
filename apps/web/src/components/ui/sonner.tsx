import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useThemeChoice } from "@/lib/theme";

/**
 * shadcn's Sonner, mounted once in the shell and styled to Paper & ink: a
 * card-coloured toast at the bottom centre, kept clear of the tab bar below
 * 1024 px (`--toast-bottom`, in index.css: Sonner's own breakpoint for
 * `mobileOffset` is narrower than the tab bar's), with its action as a primary
 * pill.
 */
export function Toaster(props: ToasterProps) {
  const [theme] = useThemeChoice();
  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      offset={{ bottom: "var(--toast-bottom)" }}
      mobileOffset={{ bottom: "var(--toast-bottom)" }}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-2xl !border !border-border !bg-card !font-sans !text-card-foreground !shadow-lg",
          title: "!text-[0.95rem] !font-medium",
          description: "!text-sm !text-muted-foreground",
          actionButton:
            "!h-9 !rounded-full !bg-primary !px-4 !text-sm !font-medium !text-primary-foreground",
          error: "!text-destructive",
        },
      }}
      {...props}
    />
  );
}
