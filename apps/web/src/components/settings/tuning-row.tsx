import type { TuningResult } from "@banki/shared";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { FormError } from "@/components/auth-card";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  RESET_FAILED,
  TUNE_FAILED,
  TUNE_RESULTS,
  resetTuning,
  tuneNow,
  tuningQueryOptions,
  tuningStatusLines,
} from "@/lib/tuning";

/**
 * Advanced's scheduling row (CONTEXT.md: Tuning), in plain words: how
 * Banki's fit to the User's memory stands, Tune now with its result inline,
 * and Reset to defaults behind a confirmation, disabled while the defaults
 * are in use.
 */
export function TuningRow() {
  const queryClient = useQueryClient();
  const { data: status } = useSuspenseQuery(tuningQueryOptions());
  const [tuning, setTuning] = useState(false);
  const [result, setResult] = useState<TuningResult | "unreachable">();
  const [confirming, setConfirming] = useState(false);
  const label = useId();
  const hint = useId();

  const tune = async () => {
    setTuning(true);
    setResult(undefined);
    try {
      setResult(await tuneNow(queryClient));
    } catch {
      setResult("unreachable");
    } finally {
      setTuning(false);
    }
  };

  return (
    <div
      role="group"
      aria-labelledby={label}
      aria-describedby={hint}
      className="flex flex-col gap-3"
    >
      <span id={label} className="text-sm font-medium">
        Personal scheduling
      </span>
      <div className="flex flex-col gap-1 text-[0.95rem] text-pretty">
        {tuningStatusLines(status).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {status.running && !tuning && <p>A check is running now.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="lg"
          className={OUTLINE_PILL}
          disabled={tuning}
          onClick={() => void tune()}
        >
          {tuning && (
            <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
          )}
          {tuning ? "Checking…" : "Tune now"}
        </Button>
        <Button
          variant="outline"
          size="lg"
          className={OUTLINE_PILL}
          disabled={tuning || status.parameters === "default"}
          onClick={() => {
            setResult(undefined);
            setConfirming(true);
          }}
        >
          Reset to defaults
        </Button>
      </div>
      <p role="status" className="text-sm empty:hidden">
        {result === undefined ? "" : result === "unreachable" ? TUNE_FAILED : TUNE_RESULTS[result]}
      </p>
      <p id={hint} className="text-sm text-muted-foreground">
        Every 200 reviews, Banki checks whether scheduling fitted to how you remember would predict
        your recall better, and switches only if it would. Your cards keep their due dates.
      </p>
      <ConfirmReset
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          try {
            await resetTuning(queryClient);
            return undefined;
          } catch {
            return RESET_FAILED;
          }
        }}
      />
    </div>
  );
}

/**
 * Asks before Reset to defaults. `onConfirm` resets, answering a message
 * when that failed, which shows in the dialog.
 */
function ConfirmReset({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<string | undefined>;
}) {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string>();

  const confirm = async () => {
    setResetting(true);
    setError(undefined);
    const failed = await onConfirm();
    setResetting(false);
    setError(failed);
    if (failed === undefined) onClose();
  };

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (resetting || next) return;
        setError(undefined);
        onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[1.25rem] border bg-card p-6 text-card-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <AlertDialog.Title className="text-xl font-semibold tracking-tight">
            Reset scheduling to defaults?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[0.95rem] text-muted-foreground">
            Banki goes back to its standard scheduling and stops fitting it to how you remember
            until you press Tune now. Your cards keep their due dates.
          </AlertDialog.Description>
          {error !== undefined && <FormError>{error}</FormError>}
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close
              render={<Button variant="outline" className={OUTLINE_PILL} disabled={resetting} />}
            >
              Cancel
            </AlertDialog.Close>
            <Button className={PILL} disabled={resetting} onClick={() => void confirm()}>
              {resetting ? "Resetting…" : "Reset to defaults"}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
