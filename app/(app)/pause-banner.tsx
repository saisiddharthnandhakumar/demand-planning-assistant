import Link from "next/link";
import { formatWhen } from "./rules/format-when";

/** Banner shown on every page while the system is paused. Not dismissible: the pause is the point. */
export function PauseBanner({ reason, since, runIds }: { reason: string | null; since: Date | null; runIds: string[] }) {
  return (
    <div role="alert" className="rounded-lg border border-[var(--negative)]/25 border-l-[3px] border-l-[var(--negative)] bg-[var(--pill-negative-bg)] text-[var(--pill-negative-ink)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
        <strong className="font-medium">System paused</strong>
        <span>
          {reason ?? "No reason recorded."}
          {since && <> Since {formatWhen(since)}.</>}
          {runIds.length > 0 && (
            <>
              {" "}
              Runs involved:{" "}
              {runIds.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <Link href={`/runs/${id}`} className="underline underline-offset-2">
                    {id.slice(0, 8)}
                  </Link>
                </span>
              ))}
              .
            </>
          )}{" "}
          Runs, submitting and purchase orders are blocked.
        </span>
        <Link href="/settings" className="ml-auto font-medium underline underline-offset-2">
          Review and resume
        </Link>
      </div>
    </div>
  );
}
