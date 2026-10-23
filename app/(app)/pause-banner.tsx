import Link from "next/link";
import { formatWhen } from "./rules/format-when";

/** Red banner shown on every page while the system is paused. Not dismissible: the pause is the point. */
export function PauseBanner({ reason, since, runIds }: { reason: string | null; since: Date | null; runIds: string[] }) {
  return (
    <div role="alert" className="border-b border-destructive/30 bg-destructive text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
        <strong className="font-semibold">System paused</strong>
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
