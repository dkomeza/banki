import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useThemeChoice } from "@/lib/theme";

/**
 * shadcn's Sonner, mounted once in the shell and styled to Paper & ink: a
 * card-coloured toast at the bottom centre, kept clear of the tab bar below
 * 1024 px, with its action as a primary pill.
 */
export function Toaster(props: ToasterProps) {
  const [theme] = useThemeChoice();
  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      mobileOffset={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-2xl !border !border-border !bg-card !font-sans !text-card-foreground !shadow-lg",
          title: "!text-[0.95rem] !font-medium",
          actionButton:
            "!h-9 !rounded-full !bg-primary !px-4 !text-sm !font-medium !text-primary-foreground",
          error: "!text-destructive",
        },
      }}
      {...props}
    />
  );
}
