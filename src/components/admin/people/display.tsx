import type { AssignmentState } from "@/generated/prisma/enums";
import { ASSIGNMENT_STATE } from "@/lib/labels";
import { StatusBadge } from "@/components/shared/status-badge";
import { computeSla } from "@/server/services/assignments";

export function AssignmentStateBadge({ customer }: { customer: { assignmentState: AssignmentState; assignmentRequestedAt: Date | null; assignmentDueAt: Date | null } }) {
  const sla = computeSla(customer);
  const entry = ASSIGNMENT_STATE[sla.state];
  if (sla.isLate && sla.state !== "LATE") {
    return <StatusBadge tone="danger" label={`${entry.label} · en retard`} />;
  }
  return <StatusBadge tone={entry.tone} label={entry.label} />;
}

export function DemoBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="ml-1.5 inline-flex h-5 items-center rounded-md bg-foreground/90 px-1.5 text-[0.62rem] font-semibold tracking-wide text-background uppercase">Démo</span>;
}

export function KeyValue({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children ?? "—"}</dd>
    </div>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="-mx-5 overflow-x-auto px-5">{children}</div>;
}
