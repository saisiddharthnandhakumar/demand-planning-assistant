"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_TYPE_LABEL, MAX_NOTE_LENGTH, type Confidence, type EventType } from "@/lib/gemini/events";
import { useRunAction } from "../runs/[id]/use-run-action";
import { confirmNoteAction, discardNoteAction, parseNoteAction, setActiveAction } from "./actions";

export interface NoteCard {
  id: string;
  text: string;
  createdBy: string | null;
  createdAt: string;
  confirmed: boolean;
  active: boolean;
  timing: "expired" | "upcoming" | "current" | null;
  tag: {
    summary: string;
    eventType: EventType;
    confidence: Confidence;
    startWeek: string;
    endWeek: string;
    skus: string[];
    categories: string[];
    distributors: string[];
    warnings: string[];
  } | null;
}

export function EventsPanel({ notes }: { notes: NoteCard[] }) {
  const [name, setName] = useState("");
  const drafts = notes.filter((n) => !n.confirmed);
  const confirmed = notes.filter((n) => n.confirmed);

  return (
    <div className="space-y-8">
      <NoteForm name={name} onNameChange={setName} />

      <section className="space-y-3" aria-labelledby="drafts-heading">
        <h2 id="drafts-heading" className="text-lg font-semibold">
          Waiting for your confirmation {drafts.length > 0 && <Badge>{drafts.length}</Badge>}
        </h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is waiting. A note you write above appears here as proposed tags.</p>
        ) : (
          drafts.map((n) => <DraftCard key={n.id} note={n} name={name} />)
        )}
      </section>

      <section className="space-y-3" aria-labelledby="confirmed-heading">
        <h2 id="confirmed-heading" className="text-lg font-semibold">
          Confirmed events
        </h2>
        {confirmed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No confirmed events yet.</p>
        ) : (
          confirmed.map((n) => <ConfirmedCard key={n.id} note={n} name={name} />)
        )}
      </section>
    </div>
  );
}

function NoteForm({ name, onNameChange }: { name: string; onNameChange: (v: string) => void }) {
  const [note, setNote] = useState("");
  const act = useRunAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Write a note</CardTitle>
        <CardDescription>
          For example: “Competitor running a buy-one-get-one scheme on mango drinks this week.” Name the product, category or distributor, and say when.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="event-note">Note</Label>
          <Textarea id="event-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_NOTE_LENGTH} />
          <p className="text-xs text-muted-foreground">
            {note.length} / {MAX_NOTE_LENGTH}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="event-name">Your name</Label>
          <Input id="event-name" value={name} maxLength={80} onChange={(e) => onNameChange(e.target.value)} className="max-w-xs" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={act.pending || note.trim() === ""}
            onClick={() => act.run(() => parseNoteAction({ note, name }), () => setNote(""))}
          >
            {act.pending ? "Reading the note…" : "Turn into tags"}
          </Button>
          <span className="text-xs text-muted-foreground">The AI only proposes tags. Nothing is saved as active until you confirm.</span>
        </div>
        {act.error && (
          <p role="alert" className="text-sm text-destructive">
            {act.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TagDetails({ tag }: { tag: NonNullable<NoteCard["tag"]> }) {
  const targets = [...tag.skus, ...tag.categories.map((c) => `All ${c} SKUs`), ...tag.distributors.map((d) => `Distributor ${d}`)];
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{EVENT_TYPE_LABEL[tag.eventType]}</Badge>
        <Badge variant={tag.confidence === "low" ? "destructive" : "outline"}>Confidence: {tag.confidence}</Badge>
        <span className="text-muted-foreground">
          {tag.startWeek === tag.endWeek ? `Week ${tag.startWeek}` : `Weeks ${tag.startWeek} to ${tag.endWeek}`}
        </span>
      </div>
      <p>{tag.summary}</p>
      <div>
        <span className="font-medium">Affects: </span>
        {targets.length === 0 ? <span className="text-destructive">nothing was identified</span> : targets.join("; ")}
      </div>
      {tag.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {tag.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftCard({ note, name }: { note: NoteCard; name: string }) {
  const act = useRunAction();
  const hasTargets = !!note.tag && note.tag.skus.length + note.tag.categories.length + note.tag.distributors.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Proposed tags</CardTitle>
        <CardDescription>
          From the note by {note.createdBy ?? "unknown"} on {note.createdAt}: “{note.text}”
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {note.tag ? <TagDetails tag={note.tag} /> : <p className="text-sm text-destructive">The saved tags are unreadable. Discard this and write the note again.</p>}
        {!hasTargets && note.tag && (
          <Alert variant="destructive">
            <AlertTitle>Cannot be confirmed</AlertTitle>
            <AlertDescription>The tag does not cover any SKU, category or distributor. Discard it and rewrite the note naming what it covers.</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={act.pending || !hasTargets || name.trim() === ""}
            aria-label={`Confirm tags for note: ${note.text.slice(0, 40)}`}
            onClick={() => act.run(() => confirmNoteAction(note.id, name))}
          >
            {act.pending ? "Working…" : "Confirm tags"}
          </Button>
          <Button variant="outline" disabled={act.pending} onClick={() => act.run(() => discardNoteAction(note.id))}>
            Discard
          </Button>
          {name.trim() === "" && hasTargets && <span className="text-xs text-muted-foreground">Enter your name above to confirm.</span>}
        </div>
        {act.error && (
          <p role="alert" className="text-sm text-destructive">
            {act.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const TIMING_LABEL = { current: "In effect", upcoming: "Upcoming", expired: "Expired: no longer affects runs" } as const;

function ConfirmedCard({ note, name }: { note: NoteCard; name: string }) {
  const act = useRunAction();
  const effective = note.active && note.timing !== "expired";
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={effective ? "default" : "outline"}>{note.active ? (note.timing ? TIMING_LABEL[note.timing] : "Active") : "Switched off"}</Badge>
          <span className="text-xs text-muted-foreground">
            “{note.text}” · {note.createdBy ?? "unknown"} · {note.createdAt}
          </span>
        </div>
        {note.tag && <TagDetails tag={note.tag} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={act.pending || name.trim() === ""}
            onClick={() => act.run(() => setActiveAction(note.id, !note.active, name))}
          >
            {note.active ? "Switch off" : "Switch on"}
          </Button>
          {name.trim() === "" && <span className="text-xs text-muted-foreground">Enter your name above to change this.</span>}
        </div>
        {act.error && (
          <p role="alert" className="text-sm text-destructive">
            {act.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
