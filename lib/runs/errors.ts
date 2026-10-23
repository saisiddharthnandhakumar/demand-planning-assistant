/**
 * The requested as-of date cannot be run (for example, no stock snapshot exists
 * on or before it). This is a problem with the request, not with the system, so
 * it is reported to the caller and not stored as a failed run.
 */
export class AsOfDateError extends Error {}
