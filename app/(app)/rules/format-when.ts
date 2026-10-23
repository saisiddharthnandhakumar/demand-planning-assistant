const formatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** Dates are shown in IST, the planner's time zone, regardless of where the server runs. */
export function formatWhen(date: Date): string {
  return `${formatter.format(date)} IST`;
}
